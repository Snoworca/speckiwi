import { createHash } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { diagnostic } from "../diagnostic.js";
import { summarizeDiagnostics } from "../diagnostic.js";
import { resolveInsideRoot, toPosixPath } from "../fs/safe-path.js";
import type { Diagnostic, DiagnosticsSummary, ProjectRoot } from "../types.js";

/**
 * The closed artifact-kind vocabulary, declared once so the set is inspectable at runtime.
 *
 * @req FR-NODE-126 — `waves`, `resume-card` and `handoff` are the orchestrator's three artifacts;
 * `lane-manifest` is deliberately absent because the lane manifest is a phase-2 artifact (05 §3.1).
 */
export const WORKFLOW_ARTIFACT_KINDS = [
  "plan",
  "sidecar",
  "validator",
  "analysis",
  "pipeline",
  "pm-state",
  "coder-state",
  "task-state",
  "worklog",
  "lock",
  "waves",
  "resume-card",
  "handoff",
  "legacy",
  "unknown"
] as const;

export type WorkflowArtifactKind = (typeof WORKFLOW_ARTIFACT_KINDS)[number];

export interface WorkflowArtifactCandidate {
  relativePath: string;
  absolutePath: string;
  kind: WorkflowArtifactKind;
  legacy: boolean;
  confidence: number;
  score: number;
  runId?: string;
  target?: string;
  generatedAt?: string;
  mtimeMs: number;
  sha256?: string;
  parseErrors: string[];
  companion?: {
    sidecarPath?: string;
    validatorPath?: string;
  };
}

export interface ResolveWorkflowArtifactOptions {
  explicitPath?: string;
  runId?: string;
  target?: string;
  kind?: WorkflowArtifactKind;
  allowAmbiguous?: boolean;
}

export interface WorkflowArtifactResolution {
  workspaceRoot: string;
  selected: WorkflowArtifactCandidate | null;
  candidates: WorkflowArtifactCandidate[];
  diagnostics: Diagnostic[];
  diagnosticsSummary: DiagnosticsSummary;
}

interface ArtifactMetadata {
  runId?: string;
  target?: string;
  generatedAt?: string;
  sidecarPath?: string;
  parseErrors: string[];
}

const CURRENT_DIRS = ["docs/plans", ".kiwi/sessions", "kiwi"] as const;
const LEGACY_DIRS = ["docs/plan", ".snoworca/sessions"] as const;

function posixRelative(root: string, filePath: string): string {
  return toPosixPath(path.relative(root, filePath));
}

// @req FR-NODE-126 — a lane handoff document, at the run contract's fixed convention
// `waves/wave-{n}/lanes/lane-{k}.md` (05 §11.2), wherever the work root places it.
const HANDOFF_DOCUMENT_PATTERN = /(?:^|\/)waves\/wave-\d+\/lanes\/lane-[^/]+\.md$/;
// @req FR-NODE-126 — the resume card, at `kiwi/orchestrator/{run_id}/resume-card.json` (05 §3.2).
const RESUME_CARD_PATTERN = /^kiwi\/orchestrator\/[^/]+\/resume-card\.json$/;

function inferKind(relativePath: string): WorkflowArtifactKind {
  const posix = toPosixPath(relativePath);
  const name = path.posix.basename(posix);
  if (posix === "kiwi/waves.jsonl") return "waves";
  if (RESUME_CARD_PATTERN.test(posix)) return "resume-card";
  if (HANDOFF_DOCUMENT_PATTERN.test(posix)) return "handoff";
  if (name.endsWith(".plan.md")) return "plan";
  if (name.endsWith(".sidecar.json") || name.endsWith(".plan.json")) return "sidecar";
  if (name.endsWith(".validator.json")) return "validator";
  if (name === "pipeline.jsonl") return "pipeline";
  if (name === "pm-state.json") return "pm-state";
  if (name === "state.json") return "coder-state";
  if (name === "worklog.jsonl") return "worklog";
  if (name.endsWith(".lock")) return "lock";
  if (toPosixPath(relativePath).includes("/tasks/") && name.endsWith(".json")) return "task-state";
  if (toPosixPath(relativePath).startsWith("docs/analysis/")) return "analysis";
  if (toPosixPath(relativePath).startsWith("docs/plan/") || toPosixPath(relativePath).startsWith(".snoworca/")) return "legacy";
  return "unknown";
}

function isInterestingArtifact(relativePath: string): boolean {
  const kind = inferKind(relativePath);
  if (kind !== "unknown") return true;
  const normalized = toPosixPath(relativePath);
  return normalized.startsWith("docs/analysis/") && (normalized.endsWith(".json") || normalized.endsWith(".md"));
}

async function walk(root: string, relativeDir: string, maxDepth = 4): Promise<string[]> {
  const dir = path.join(root, relativeDir);
  const found: string[] = [];
  async function visit(current: string, depth: number): Promise<void> {
    if (depth > maxDepth) return;
    let entries;
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const absolute = path.join(current, entry.name);
      const relative = posixRelative(root, absolute);
      if (entry.isDirectory()) {
        await visit(absolute, depth + 1);
      } else if (entry.isFile() && isInterestingArtifact(relative)) {
        found.push(relative);
      }
    }
  }
  await visit(dir, 0);
  return found;
}

function parseFrontmatter(text: string): Record<string, string> {
  if (!text.startsWith("---\n")) return {};
  const end = text.indexOf("\n---", 4);
  if (end < 0) return {};
  const values: Record<string, string> = {};
  for (const line of text.slice(4, end).split(/\r?\n/)) {
    const match = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line);
    if (!match) continue;
    const key = match[1];
    const value = match[2];
    if (key && value !== undefined) values[key] = value.trim().replace(/^"|"$/g, "");
  }
  return values;
}

function metadataFromJson(value: unknown): Omit<ArtifactMetadata, "parseErrors"> {
  if (typeof value !== "object" || value === null) return {};
  const record = value as Record<string, unknown>;
  return {
    ...(typeof record.run_id === "string" ? { runId: record.run_id } : {}),
    ...(typeof record.target === "string" ? { target: record.target } : {}),
    ...(typeof record.generated_at === "string" ? { generatedAt: record.generated_at } : {}),
    ...(typeof record.sidecar_path === "string" ? { sidecarPath: record.sidecar_path } : {})
  };
}

function runIdFromSessionPath(relativePath: string): string | undefined {
  const match = /^\.kiwi\/sessions\/([^/]+)\//.exec(toPosixPath(relativePath));
  return match?.[1];
}

async function readMetadata(absolutePath: string, kind: WorkflowArtifactKind): Promise<ArtifactMetadata> {
  const parseErrors: string[] = [];
  if (!["plan", "sidecar", "validator", "pm-state", "coder-state", "task-state", "legacy"].includes(kind)) return { parseErrors };
  let text = "";
  try {
    text = await readFile(absolutePath, "utf8");
  } catch (error) {
    parseErrors.push((error as Error).message);
    return { parseErrors };
  }
  if (kind === "plan" || absolutePath.endsWith(".md")) {
    const frontmatter = parseFrontmatter(text);
    return {
      ...(typeof frontmatter.run_id === "string" ? { runId: frontmatter.run_id } : {}),
      ...(typeof frontmatter.target === "string" ? { target: frontmatter.target } : {}),
      ...(typeof frontmatter.generated_at === "string" ? { generatedAt: frontmatter.generated_at } : {}),
      ...(typeof frontmatter.sidecar_path === "string" ? { sidecarPath: frontmatter.sidecar_path } : {}),
      parseErrors
    };
  }
  try {
    return { ...metadataFromJson(JSON.parse(text)), parseErrors };
  } catch (error) {
    parseErrors.push((error as Error).message);
    return { parseErrors };
  }
}

async function sha256File(absolutePath: string): Promise<string | undefined> {
  try {
    return createHash("sha256").update(await readFile(absolutePath)).digest("hex");
  } catch {
    return undefined;
  }
}

interface CandidateScoringInput {
  relativePath: string;
  kind: WorkflowArtifactKind;
  legacy: boolean;
  runId?: string;
  target?: string;
  generatedAt?: string;
  parseErrors: string[];
}

/** The canonical session-state basenames a `{run_id}` session directory may hold. */
const CANONICAL_SESSION_FILES = ["worklog.jsonl", "pm-state.json", "state.json"] as const;

/**
 * Whether a path is one of {@link CANONICAL_SESSION_FILES} for `runId`, under either the plain
 * session directory or the lane-suffixed one.
 *
 * @req FR-NODE-126 — `kiwi-pm --session-suffix w{n}s{s}l{k}` relocates the session directory under
 * `lanes/{lane}/`, and 05 §5.14's executor re-enters with `--resume` only when the suffixed
 * `pm-state.json` resolves. Scoring the suffixed path lower than the unsuffixed one would let an
 * unrelated candidate outrank it, and the re-entry would start a new session that re-executes the
 * unit's completed Tasks.
 */
function isCanonicalSessionPath(relativePath: string, runId: string): boolean {
  const prefix = `.kiwi/sessions/${runId}/`;
  const posix = toPosixPath(relativePath);
  if (!posix.startsWith(prefix)) return false;
  const rest = posix.slice(prefix.length);
  const lane = /^lanes\/[^/]+\/(.+)$/.exec(rest);
  const tail = lane?.[1] ?? rest;
  return (CANONICAL_SESSION_FILES as readonly string[]).includes(tail);
}

function canonicalPathBonus(candidate: CandidateScoringInput, options: ResolveWorkflowArtifactOptions): number {
  if (candidate.kind === "pipeline" && candidate.relativePath === "kiwi/pipeline.jsonl") return 30;
  if (options.runId && isCanonicalSessionPath(candidate.relativePath, options.runId)) return 30;
  return 0;
}

function scoreCandidate(candidate: CandidateScoringInput, options: ResolveWorkflowArtifactOptions, explicit = false): number {
  let score = 0;
  if (explicit) score += 1000;
  if (!candidate.legacy) score += 100;
  else score -= 50;
  if (options.kind && candidate.kind === options.kind) score += 40;
  if (options.runId && candidate.runId === options.runId) score += 80;
  else if (options.runId && candidate.runId) score -= 25;
  if (options.target && candidate.target === options.target) score += 50;
  else if (options.target && candidate.target) score -= 25;
  if (candidate.generatedAt) score += 5;
  score += canonicalPathBonus(candidate, options);
  score -= candidate.parseErrors.length * 100;
  return score;
}

function sameSelectionRank(a: WorkflowArtifactCandidate, b: WorkflowArtifactCandidate): boolean {
  return a.score === b.score && (a.generatedAt ?? "") === (b.generatedAt ?? "") && a.mtimeMs === b.mtimeMs;
}

async function fileExists(absolutePath: string): Promise<boolean> {
  try {
    return (await stat(absolutePath)).isFile();
  } catch {
    return false;
  }
}

async function companionForPlan(root: string, candidate: WorkflowArtifactCandidate, metadata: ArtifactMetadata, diagnostics: Diagnostic[]): Promise<NonNullable<WorkflowArtifactCandidate["companion"]>> {
  const baseDir = path.posix.dirname(candidate.relativePath);
  const baseName = path.posix.basename(candidate.relativePath).replace(/\.plan\.md$/, "");
  const sidecarCandidates = [
    metadata.sidecarPath ? toPosixPath(path.posix.normalize(path.posix.join(baseDir, metadata.sidecarPath))) : undefined,
    `${baseDir}/${baseName}.sidecar.json`,
    `${baseDir}/${baseName}.plan.json`
  ].filter((item): item is string => typeof item === "string");
  for (const relativePath of sidecarCandidates) {
    if (await fileExists(path.join(root, relativePath))) return { sidecarPath: relativePath };
  }
  diagnostics.push(
    diagnostic("SRS-W051", "warning", `Workflow artifact companion is missing: ${candidate.relativePath}`, { filePath: candidate.relativePath }, { kind: "missing-companion", companionKind: "sidecar" })
  );
  return {};
}

async function buildCandidate(root: string, relativePath: string, options: ResolveWorkflowArtifactOptions, explicit = false): Promise<{ candidate: WorkflowArtifactCandidate; diagnostics: Diagnostic[] }> {
  const absolutePath = await resolveInsideRoot(root, relativePath);
  const info = await stat(absolutePath);
  const kind = inferKind(relativePath);
  const metadata = await readMetadata(absolutePath, kind);
  const diagnostics = metadata.parseErrors.map((message) =>
    diagnostic("SRS-W050", "warning", `Workflow artifact parse warning: ${relativePath}`, { filePath: relativePath }, { message })
  );
  const sha256 = await sha256File(absolutePath);
  const runId = metadata.runId ?? runIdFromSessionPath(relativePath);
  const base = {
    relativePath,
    absolutePath,
    kind,
    legacy: toPosixPath(relativePath).startsWith("docs/plan/") || toPosixPath(relativePath).startsWith(".snoworca/"),
    mtimeMs: info.mtimeMs,
    parseErrors: metadata.parseErrors,
    ...(runId ? { runId } : {}),
    ...(metadata.target ? { target: metadata.target } : {}),
    ...(metadata.generatedAt ? { generatedAt: metadata.generatedAt } : {}),
    ...(sha256 ? { sha256 } : {})
  };
  const score = scoreCandidate(base, options, explicit);
  const candidate: WorkflowArtifactCandidate = { ...base, score, confidence: Math.max(0, Math.min(100, score)) };
  if (candidate.kind === "plan") {
    const companion = await companionForPlan(root, candidate, metadata, diagnostics);
    if (Object.keys(companion).length > 0) candidate.companion = companion;
  }
  return { candidate, diagnostics };
}

async function candidatePaths(root: string, options: ResolveWorkflowArtifactOptions): Promise<{ paths: Array<{ relativePath: string; explicit: boolean }>; diagnostics: Diagnostic[] }> {
  const diagnostics: Diagnostic[] = [];
  const paths = new Map<string, boolean>();
  if (options.explicitPath) {
    try {
      const explicitAbsolute = await resolveInsideRoot(root, options.explicitPath);
      paths.set(posixRelative(root, explicitAbsolute), true);
    } catch {
      diagnostics.push(
        diagnostic("SRS-E050", "error", `Workflow artifact path is outside the project root: ${options.explicitPath}`, {}, { path: options.explicitPath })
      );
    }
    return { paths: [...paths.entries()].map(([relativePath, explicit]) => ({ relativePath, explicit })), diagnostics };
  }
  for (const dir of [...CURRENT_DIRS, ...LEGACY_DIRS]) {
    for (const relativePath of await walk(root, dir)) paths.set(relativePath, paths.get(relativePath) ?? false);
  }
  return { paths: [...paths.entries()].map(([relativePath, explicit]) => ({ relativePath, explicit })), diagnostics };
}

export async function resolveWorkflowArtifacts(root: ProjectRoot, options: ResolveWorkflowArtifactOptions = {}): Promise<WorkflowArtifactResolution> {
  const workspaceRoot = await resolveInsideRoot(root.root, ".");
  const pathResult = await candidatePaths(workspaceRoot, options);
  const diagnostics = [...pathResult.diagnostics];
  const candidates: WorkflowArtifactCandidate[] = [];
  for (const item of pathResult.paths) {
    if (options.kind && inferKind(item.relativePath) !== options.kind) continue;
    const built = await buildCandidate(workspaceRoot, item.relativePath, options, item.explicit);
    diagnostics.push(...built.diagnostics);
    candidates.push(built.candidate);
  }
  candidates.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if ((b.generatedAt ?? "") !== (a.generatedAt ?? "")) return (b.generatedAt ?? "").localeCompare(a.generatedAt ?? "");
    if (b.mtimeMs !== a.mtimeMs) return b.mtimeMs - a.mtimeMs;
    return a.relativePath.localeCompare(b.relativePath);
  });
  let selected = candidates[0] ?? null;
  const next = candidates[1];
  if (!options.allowAmbiguous && selected && next && sameSelectionRank(selected, next)) {
    diagnostics.push(
      diagnostic("SRS-E051", "error", "Workflow artifact resolution is ambiguous", { filePath: selected.relativePath }, { candidates: candidates.slice(0, 2).map((item) => item.relativePath) })
    );
    selected = null;
  }
  return {
    workspaceRoot,
    selected,
    candidates,
    diagnostics,
    diagnosticsSummary: summarizeDiagnostics(diagnostics)
  };
}
