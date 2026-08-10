import { createHash } from "node:crypto";
import { mkdir, open, readFile } from "node:fs/promises";
import path from "node:path";
import { diagnostic } from "../diagnostic.js";
import { summarizeDiagnostics } from "../diagnostic.js";
import { resolveInsideRoot } from "../fs/safe-path.js";
import type { Diagnostic, DiagnosticsSummary, MutationEnvelope, MutationResult, ProjectRoot } from "../types.js";
import { mutationFail, mutationOk } from "../mutation/guards.js";
import { withMutationEnvelope } from "../mutation/envelope.js";
import { workflowRecordReclassificationProvenance } from "./identity.js";

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
  recordClass?: string;
  effectiveRecordClass?: string;
  reclassifiedBy?: string;
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

function sha256Bytes(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function jsonObject(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function artifactRecordType(relativePath: string): "pipeline" | "worklog" | null {
  const name = path.posix.basename(relativePath.replace(/\\/g, "/"));
  if (name === "pipeline.jsonl") return "pipeline";
  if (name === "worklog.jsonl") return "worklog";
  return null;
}

function applyRecordReclassifications(relativePath: string, text: string, entries: WorkflowJsonlEntry[]): Set<WorkflowJsonlEntry> {
  const excluded = new Set<WorkflowJsonlEntry>();
  const recordType = artifactRecordType(relativePath);
  const validOverlays: Array<{ overlay: WorkflowJsonlEntry; target: WorkflowJsonlEntry }> = [];
  const overlayClaimsByLine = new Map<number, number>();
  for (const entry of entries) {
    if (entry.event.event !== "record_reclassification") continue;
    const operation = jsonObject(entry.event.operation);
    if (!operation || operation.kind !== "record_reclassification" || operation.source_path !== relativePath || typeof operation.source_line !== "number") continue;
    overlayClaimsByLine.set(operation.source_line, (overlayClaimsByLine.get(operation.source_line) ?? 0) + 1);
  }
  for (const overlay of entries) {
    if (overlay.event.event !== "record_reclassification") continue;
    excluded.add(overlay);
    const operation = jsonObject(overlay.event.operation);
    if (!operation || recordType === null) continue;
    const owner = overlay.event.owner;
    const reason = overlay.event.reason;
    const workflowRunId = overlay.event.workflow_run_id;
    const taskId = overlay.event.task_id;
    const reqId = overlay.event.req_id;
    if (
      overlay.event.schema_version !== "1.0.0" ||
      overlay.event.skill !== "speckiwi" ||
      overlay.event.recordClass !== "meta" ||
      overlay.event.effectiveRecordClass !== "audit_note" ||
      overlay.event.status !== undefined ||
      overlay.event.corrects_run_id !== undefined ||
      operation.kind !== "record_reclassification" ||
      operation.record_type !== recordType ||
      operation.source_path !== relativePath ||
      typeof owner !== "string" ||
      owner.length === 0 ||
      typeof reason !== "string" ||
      reason.length === 0 ||
      operation.owner !== owner ||
      operation.reason !== reason ||
      typeof workflowRunId !== "string" ||
      workflowRunId.trim().length === 0 ||
      overlay.event.ts !== "1970-01-01T00:00:00.000Z" ||
      (taskId !== undefined && (typeof taskId !== "string" || taskId.trim().length === 0)) ||
      (reqId !== undefined && (typeof reqId !== "string" || reqId.trim().length === 0))
    ) continue;

    const target = entries.find((entry) => entry.line === operation.source_line && entry !== overlay);
    if (!target || target.event.status !== "CORRECTION") continue;
    const targetValue = target.event.corrects_run_id;
    if (typeof targetValue === "string" && targetValue.trim().length > 0) continue;
    const targetRawHash = sha256Bytes(Buffer.from(target.raw, "utf8"));
    const textBytes = Buffer.from(text, "utf8");
    const prefixHash = sha256Bytes(textBytes.subarray(0, overlay.byteOffset));
    const unterminatedPrefixHash = overlay.byteOffset > 0 && textBytes[overlay.byteOffset - 1] === 0x0a
      ? sha256Bytes(textBytes.subarray(0, overlay.byteOffset - 1))
      : null;
    if (
      operation.byte_offset !== target.byteOffset ||
      operation.raw_sha256 !== targetRawHash ||
      operation.event_key !== target.eventKey ||
      operation.target_run_id !== target.event.run_id ||
      operation.preimage_prefix_sha256 !== prefixHash && operation.preimage_prefix_sha256 !== unterminatedPrefixHash
    ) continue;
    const identity = {
      path: relativePath,
      recordType,
      line: target.line,
      byteOffset: target.byteOffset,
      rawSha256: targetRawHash,
      eventKey: target.eventKey,
      targetRunId: String(target.event.run_id),
      preimagePrefixSha256: String(operation.preimage_prefix_sha256)
    };
    const provenance = workflowRecordReclassificationProvenance({
      runId: workflowRunId,
      ...(typeof taskId === "string" && taskId.length > 0 ? { taskId } : {}),
      ...(typeof reqId === "string" && reqId.length > 0 ? { reqId } : {}),
      args: { ...identity, effectiveRecordClass: "audit_note", owner, reason }
    });
    if (
      overlay.event.run_id !== provenance.overlayRunId ||
      overlay.event.journal_key !== provenance.journalKey ||
      overlay.event.idempotency_key !== provenance.idempotencyKey
    ) continue;
    validOverlays.push({ overlay, target });
  }
  const countsByTarget = new Map<WorkflowJsonlEntry, number>();
  for (const candidate of validOverlays) {
    countsByTarget.set(candidate.target, (countsByTarget.get(candidate.target) ?? 0) + 1);
  }
  for (const candidate of validOverlays) {
    if (countsByTarget.get(candidate.target) !== 1 || overlayClaimsByLine.get(candidate.target.line) !== 1) continue;
    candidate.target.recordClass = "meta";
    candidate.target.effectiveRecordClass = "audit_note";
    candidate.target.reclassifiedBy = candidate.overlay.eventKey;
    excluded.add(candidate.target);
  }
  return excluded;
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
  eventKeying: "skill-run" | "none",
  excluded: Set<WorkflowJsonlEntry> = new Set()
): WorkflowJsonlEntry[] {
  const byRunId = new Map<string, WorkflowJsonlEntry>();
  for (const entry of entries) {
    if (excluded.has(entry)) continue;
    if (typeof entry.event.run_id === "string") byRunId.set(entry.event.run_id, entry);
    if (entry.event.status === "DELETED") diagnostics.push(invalidDeletedStatusDiagnostic(relativePath, entry));
  }

  // @req FR-NODE-125 — an append-only journal has no correction chain to resolve; every line stands,
  // including one whose `status` happens to read CORRECTION. The DELETED scan above is a data-shape
  // check rather than correction resolution, so it runs under both keyings.
  if (eventKeying === "none") return entries;

  for (const entry of entries) {
    if (excluded.has(entry)) continue;
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
    if (excluded.has(entry)) continue;
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

  if (includeDeleted) return entries.filter((entry) => !excluded.has(entry) && (!entry.correctedBy || entry.correctedBy.length === 0));
  return entries.filter((entry) => {
    if (excluded.has(entry)) return false;
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
    const rawWithCr = parseLines[index] ?? "";
    const raw = rawWithCr.endsWith("\r") ? rawWithCr.slice(0, -1) : rawWithCr;
    const line = index + 1;
    if (raw.trim().length === 0) {
      byteOffset += Buffer.byteLength(rawWithCr) + 1;
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
    byteOffset += Buffer.byteLength(rawWithCr) + 1;
  }

  const hasTrailingLf = existing.text.length === 0 || existing.text.endsWith("\n");
  if (!hasTrailingLf) {
    diagnostics.push(diagnostic("SRS-W056", "warning", "Workflow JSONL file is missing trailing LF", { filePath: relativePath }, { byteOffset: Buffer.byteLength(existing.text) }));
  }
  const excluded = eventKeying === "skill-run" ? applyRecordReclassifications(relativePath, existing.text, entries) : new Set<WorkflowJsonlEntry>();
  const latestEntries = computeCorrections(relativePath, entries, maxDepth, diagnostics, options.includeDeleted ?? false, eventKeying, excluded);
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
    const handle = await open(absolutePath, "a");
    try {
      await handle.writeFile(`${prefix}${line}\n`, { encoding: "utf8" });
      await handle.sync();
    } finally {
      await handle.close();
    }
  }
  return withMutationEnvelope(
    mutationOk({ relativePath, written: !dryRun, eventKey: eventKey(event) }, diagnostics),
    appendEnvelope(relativePath, dryRun, !dryRun, line)
  );
}
