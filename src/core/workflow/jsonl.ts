import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { diagnostic } from "../diagnostic.js";
import { summarizeDiagnostics } from "../diagnostic.js";
import { resolveInsideRoot } from "../fs/safe-path.js";
import type { Diagnostic, DiagnosticsSummary, MutationEnvelope, MutationResult, ProjectRoot } from "../types.js";
import { mutationFail, mutationOk } from "../mutation/guards.js";
import { withMutationEnvelope } from "../mutation/envelope.js";

export interface WorkflowJsonlEvent {
  schema_version?: string;
  skill?: string;
  run_id?: string;
  status?: string;
  ts?: string;
  corrects_run_id?: string;
  [key: string]: unknown;
}

export interface WorkflowJsonlEntry {
  line: number;
  byteOffset: number;
  raw: string;
  event: WorkflowJsonlEvent;
  eventKey: string;
  correctedBy?: string[];
  deletedBy?: string[];
  logicalDeleteTarget?: string;
}

export interface WorkflowJsonlInvalidLine {
  line: number;
  byteOffset: number;
  excerpt: string;
  message: string;
}

export interface WorkflowJsonlParseOptions {
  supportedSchemaVersions?: string[];
  maxCorrectionDepth?: number;
  includeDeleted?: boolean;
  /**
   * "skill-run" (default) keys events as `${skill}|${run_id}`, diagnoses duplicate keys and resolves
   * CORRECTION chains. "none" is for append-only journals where many lines per run are the contract:
   * no duplicate diagnostics, no correction resolution.
   *
   * @req FR-NODE-125 — `kiwi/waves.jsonl` carries no `skill` and many lines per `run_id`, so under
   * the default every append after the first line of a run is denied by the halt policy.
   */
  eventKeying?: "skill-run" | "none";
}

export interface WorkflowJsonlParseResult {
  relativePath: string;
  absolutePath: string;
  entries: WorkflowJsonlEntry[];
  tail: WorkflowJsonlEntry[];
  latestEntries: WorkflowJsonlEntry[];
  invalidLines: WorkflowJsonlInvalidLine[];
  hasTrailingLf: boolean;
  sha256?: string;
  diagnostics: Diagnostic[];
  diagnosticsSummary: DiagnosticsSummary;
}

export interface AppendWorkflowJsonlOptions extends WorkflowJsonlParseOptions {
  dryRun?: boolean;
  policy?: "best-effort" | "halt";
  expectedSha256?: string;
}

export interface AppendWorkflowJsonlOutput {
  relativePath: string;
  written: boolean;
  eventKey: string;
}

const DEFAULT_SCHEMA_VERSIONS = ["1.0.0"];
const CONTROL_CHAR_RE = new RegExp(
  `[${String.fromCharCode(0)}-${String.fromCharCode(8)}${String.fromCharCode(11)}${String.fromCharCode(12)}${String.fromCharCode(14)}-${String.fromCharCode(31)}]`,
  "g"
);

function eventKey(event: WorkflowJsonlEvent): string {
  return `${String(event.skill ?? "")}|${String(event.run_id ?? "")}`;
}

function rawExcerpt(line: string): string {
  return line.replace(CONTROL_CHAR_RE, "?").slice(0, 120);
}

function sha256Text(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

async function readExisting(absolutePath: string): Promise<{ text: string; exists: boolean }> {
  try {
    return { text: await readFile(absolutePath, "utf8"), exists: true };
  } catch {
    return { text: "", exists: false };
  }
}

function unsupportedSchemaDiagnostic(relativePath: string, entry: WorkflowJsonlEntry): Diagnostic {
  return diagnostic(
    "SRS-W055",
    "warning",
    "Unsupported workflow JSONL schema version",
    { filePath: relativePath, line: entry.line },
    { schema_version: entry.event.schema_version, eventKey: entry.eventKey }
  );
}

function duplicateEventDiagnostic(relativePath: string, entry: WorkflowJsonlEntry): Diagnostic {
  return diagnostic("SRS-W053", "warning", "Duplicate workflow JSONL event key", { filePath: relativePath, line: entry.line }, { eventKey: entry.eventKey });
}

function correctionDiagnostic(relativePath: string, entry: WorkflowJsonlEntry, reason: string): Diagnostic {
  return diagnostic("SRS-W054", "warning", "Invalid workflow JSONL correction chain", { filePath: relativePath, line: entry.line }, { eventKey: entry.eventKey, reason });
}

function invalidDeletedStatusDiagnostic(relativePath: string, entry: WorkflowJsonlEntry): Diagnostic {
  return diagnostic("SRS-W069", "warning", "Workflow JSONL status=DELETED is invalid; use a logical-delete tombstone", { filePath: relativePath, line: entry.line }, { eventKey: entry.eventKey });
}

function eventRunId(entry: WorkflowJsonlEntry): string {
  return String(entry.event.run_id ?? entry.eventKey);
}

function isLogicalDelete(entry: WorkflowJsonlEntry): boolean {
  const operation = entry.event.operation;
  return entry.event.status === "CORRECTION" && typeof operation === "object" && operation !== null && (operation as { kind?: unknown }).kind === "logical_delete";
}

function computeCorrections(
  relativePath: string,
  entries: WorkflowJsonlEntry[],
  maxDepth: number,
  diagnostics: Diagnostic[],
  includeDeleted: boolean,
  eventKeying: "skill-run" | "none"
): WorkflowJsonlEntry[] {
  const byRunId = new Map<string, WorkflowJsonlEntry>();
  for (const entry of entries) {
    if (typeof entry.event.run_id === "string") byRunId.set(entry.event.run_id, entry);
    if (entry.event.status === "DELETED") diagnostics.push(invalidDeletedStatusDiagnostic(relativePath, entry));
  }

  // @req FR-NODE-125 — an append-only journal has no correction chain to resolve; every line stands,
  // including one whose `status` happens to read CORRECTION. The DELETED scan above is a data-shape
  // check rather than correction resolution, so it runs under both keyings.
  if (eventKeying === "none") return entries;

  for (const entry of entries) {
    if (entry.event.status !== "CORRECTION") continue;
    const targetRunId = entry.event.corrects_run_id;
    if (typeof targetRunId !== "string" || targetRunId.length === 0) {
      diagnostics.push(correctionDiagnostic(relativePath, entry, "missing correction target"));
      continue;
    }
    const target = byRunId.get(targetRunId);
    if (!target) {
      diagnostics.push(correctionDiagnostic(relativePath, entry, "correction target not found"));
      continue;
    }
    if (isLogicalDelete(entry)) {
      if (target.event.status === "CORRECTION") {
        diagnostics.push(correctionDiagnostic(relativePath, entry, "logical-delete target is a correction or tombstone"));
        continue;
      }
      entry.logicalDeleteTarget = targetRunId;
      target.deletedBy = [...(target.deletedBy ?? []), eventRunId(entry)];
      continue;
    }
    if (isLogicalDelete(target)) {
      diagnostics.push(correctionDiagnostic(relativePath, entry, "correction target is a logical-delete tombstone"));
      continue;
    }
    target.correctedBy = [...(target.correctedBy ?? []), String(entry.event.run_id ?? entry.eventKey)];
  }

  for (const entry of entries) {
    const seen = new Set<string>();
    let current: WorkflowJsonlEntry | undefined = entry;
    let depth = 0;
    while (current?.event.status === "CORRECTION" && typeof current.event.corrects_run_id === "string") {
      const runId = String(current.event.run_id ?? current.eventKey);
      if (seen.has(runId)) {
        diagnostics.push(correctionDiagnostic(relativePath, entry, "correction cycle"));
        break;
      }
      seen.add(runId);
      depth += 1;
      if (depth > maxDepth) {
        diagnostics.push(correctionDiagnostic(relativePath, entry, "correction depth exceeded"));
        break;
      }
      current = byRunId.get(current.event.corrects_run_id);
    }
  }

  if (includeDeleted) return entries.filter((entry) => !entry.correctedBy || entry.correctedBy.length === 0);
  return entries.filter((entry) => {
    if (entry.correctedBy && entry.correctedBy.length > 0) return false;
    if (entry.deletedBy && entry.deletedBy.length > 0) return false;
    if (entry.event.status === "CORRECTION") return false;
    if (entry.event.status === "DELETED") return false;
    return true;
  });
}

export async function parseWorkflowJsonl(root: ProjectRoot, relativePath: string, options: WorkflowJsonlParseOptions = {}): Promise<WorkflowJsonlParseResult> {
  const absolutePath = await resolveInsideRoot(root.root, relativePath);
  const existing = await readExisting(absolutePath);
  const supported = options.supportedSchemaVersions ?? DEFAULT_SCHEMA_VERSIONS;
  const maxDepth = options.maxCorrectionDepth ?? 5;
  const eventKeying = options.eventKeying ?? "skill-run";
  const diagnostics: Diagnostic[] = [];
  const invalidLines: WorkflowJsonlInvalidLine[] = [];
  const entries: WorkflowJsonlEntry[] = [];
  const duplicateKeys = new Set<string>();
  const seenKeys = new Set<string>();
  let byteOffset = 0;
  const lines = existing.text.length > 0 ? existing.text.split(/\n/) : [];
  const parseLines = existing.text.endsWith("\n") ? lines.slice(0, -1) : lines;
  for (let index = 0; index < parseLines.length; index += 1) {
    const raw = parseLines[index] ?? "";
    const line = index + 1;
    if (raw.trim().length === 0) {
      byteOffset += Buffer.byteLength(raw) + 1;
      continue;
    }
    try {
      const parsed = JSON.parse(raw) as WorkflowJsonlEvent;
      const entry: WorkflowJsonlEntry = { line, byteOffset, raw, event: parsed, eventKey: eventKey(parsed) };
      entries.push(entry);
      if (!supported.includes(String(parsed.schema_version ?? ""))) diagnostics.push(unsupportedSchemaDiagnostic(relativePath, entry));
      if (eventKeying === "skill-run" && seenKeys.has(entry.eventKey)) {
        duplicateKeys.add(entry.eventKey);
        diagnostics.push(duplicateEventDiagnostic(relativePath, entry));
      }
      seenKeys.add(entry.eventKey);
    } catch (error) {
      invalidLines.push({ line, byteOffset, excerpt: rawExcerpt(raw), message: (error as Error).message });
      diagnostics.push(
        diagnostic("SRS-W052", "warning", "Invalid workflow JSONL line", { filePath: relativePath, line }, { byteOffset, excerpt: rawExcerpt(raw), message: (error as Error).message })
      );
    }
    byteOffset += Buffer.byteLength(raw) + 1;
  }

  const hasTrailingLf = existing.text.length === 0 || existing.text.endsWith("\n");
  if (!hasTrailingLf) {
    diagnostics.push(diagnostic("SRS-W056", "warning", "Workflow JSONL file is missing trailing LF", { filePath: relativePath }, { byteOffset: Buffer.byteLength(existing.text) }));
  }
  const latestEntries = computeCorrections(relativePath, entries, maxDepth, diagnostics, options.includeDeleted ?? false, eventKeying);
  void duplicateKeys;
  return {
    relativePath,
    absolutePath,
    entries,
    tail: entries,
    latestEntries,
    invalidLines,
    hasTrailingLf,
    ...(existing.exists ? { sha256: sha256Text(existing.text) } : {}),
    diagnostics,
    diagnosticsSummary: summarizeDiagnostics(diagnostics)
  };
}

function appendEnvelope(relativePath: string, dryRun: boolean, written: boolean, line: string): MutationEnvelope {
  return {
    kind: "append_workflow_jsonl",
    filePath: relativePath,
    dryRun,
    written,
    operations: [{ type: "appendLines", lineCount: 1, lines: [line] }],
    preview: [line]
  };
}

function validateAppendEvent(event: WorkflowJsonlEvent, supported: string[]): Diagnostic[] {
  if (supported.includes(String(event.schema_version ?? ""))) return [];
  return [
    diagnostic("SRS-W055", "warning", "Unsupported workflow JSONL schema version", {}, { schema_version: event.schema_version, eventKey: eventKey(event) })
  ];
}

export async function appendWorkflowJsonl(
  root: ProjectRoot,
  relativePath: string,
  event: WorkflowJsonlEvent,
  options: AppendWorkflowJsonlOptions = {}
): Promise<MutationResult<AppendWorkflowJsonlOutput>> {
  const absolutePath = await resolveInsideRoot(root.root, relativePath);
  const dryRun = options.dryRun ?? false;
  const policy = options.policy ?? "halt";
  const supported = options.supportedSchemaVersions ?? DEFAULT_SCHEMA_VERSIONS;
  const parsed = await parseWorkflowJsonl(root, relativePath, options);
  const eventDiagnostics = validateAppendEvent(event, supported);
  const diagnostics = [...parsed.diagnostics, ...eventDiagnostics];
  if (options.expectedSha256 && parsed.sha256 && options.expectedSha256 !== parsed.sha256) {
    const stale = diagnostic("SRS-E032", "error", "Mutation snapshot is stale", { filePath: relativePath }, { expectedSha256: options.expectedSha256, actualSha256: parsed.sha256 });
    return mutationFail("STALE_PATCH", "Workflow JSONL snapshot is stale", [stale], { staleGuard: { filePath: relativePath, retry: "rerun workflow jsonl append" } });
  }
  if (policy === "halt" && diagnostics.length > 0) {
    return mutationFail("MUTATION_DENIED", "Workflow JSONL append halted by diagnostics", diagnostics);
  }
  const line = JSON.stringify(event);
  if (line.includes("\n") || line.includes("\r")) return mutationFail("USAGE", "Workflow JSONL event must serialize to one line");
  if (!dryRun) {
    await mkdir(path.dirname(absolutePath), { recursive: true });
    const prefix = parsed.hasTrailingLf ? "" : "\n";
    const existing = await readExisting(absolutePath);
    await writeFile(absolutePath, `${existing.text}${prefix}${line}\n`, "utf8");
  }
  return withMutationEnvelope(
    mutationOk({ relativePath, written: !dryRun, eventKey: eventKey(event) }, diagnostics),
    appendEnvelope(relativePath, dryRun, !dryRun, line)
  );
}
