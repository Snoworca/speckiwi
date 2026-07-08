import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import type { MutationResult, ProjectRoot } from "../types.js";
import { mutationOk } from "./guards.js";

// @req FR-NODE-056
/**
 * FR-NODE-056 — vibe-to-SRS synthesis engine.
 *
 * Merges a task `intent.md`, the per-session trace shards, the step task-name code
 * comments, and the final git diff into step SRS under docs/spec/steps/<TaskName>/.
 * It is idempotent (a no-op when the step SRS already exists), caps diff size, excludes
 * gitignored paths, redacts recognized secret patterns, and merges trace shards in
 * timestamp order while recovering from a torn trailing JSONL line.
 */
export interface SynthesizeStepSrsInput {
  task: string;
  dryRun?: boolean;
}

export interface SynthesizeStepSrsValue {
  task: string;
  written: boolean;
  skipped: boolean;
  diffCapped: boolean;
  redactions: number;
  traceEntries: number;
}

// Byte budget for the embedded diff section (AC-3 "caps the diff size"): an oversized diff is
// truncated to fit within this budget minus the fixed scaffolding around it. This caps the diff,
// not the whole SRS — intent/trace/comment sections are not counted against this budget.
const MAX_SRS_BYTES = 64 * 1024;

// @req FR-NODE-056
/**
 * Recognized secret patterns. Each match is replaced by REDACTION_MARKER before any input
 * reaches the committed SRS. Patterns are intentionally specific to avoid over-redaction; the
 * `-` is placed last in each character class so it is a literal range delimiter, not an escape.
 */
const SECRET_PATTERNS: readonly RegExp[] = [
  /AKIA[0-9A-Z]{16}/g, // AWS access key id
  /ghp_[0-9A-Za-z]{36}/g, // GitHub personal access token
  /github_pat_[0-9A-Za-z_]+/g, // GitHub fine-grained personal access token
  /Bearer\s+[0-9A-Za-z._~+/-]{16,}=*/g, // Bearer authorization token
  // Full PEM private key block: redact the BEGIN...END envelope and the base64 body between
  // them so the key material never reaches the committed SRS (not just the header line). The `i`
  // flag also catches lowercase headers (e.g. `-----begin private key-----`).
  /-----BEGIN[^-]*PRIVATE KEY-----[\s\S]*?-----END[^-]*PRIVATE KEY-----/gi,
  // Bare PEM private key header/footer (e.g. an unterminated block) — defense in depth so a
  // lone BEGIN/END line is still redacted even when its counterpart is absent (any case).
  /-----(?:BEGIN|END)[^-]*PRIVATE KEY-----/gi,
  // key=value / key: value credential assignments (case-insensitive key names). A leading word
  // boundary keeps an identifier like `KEEP_TOKEN` (no boundary before `TOKEN`) from matching
  // while still catching a standalone `token=` / `api_key:` assignment. The value side is
  // narrowed to a plausible literal credential so normal code/prose is preserved: either a
  // quoted token, or a bare credential token (charset, length >= 6) that contains a digit. This
  // excludes code expressions like `= computeToken();`, `=== storedHash`, and `: design uses ...`
  // (no digit, or value too short / not in the charset) while still redacting real secrets such
  // as `password=hunter2` and `api_key: sk_live_abc123XYZ`.
  /\b(?:password|passwd|pwd|secret|token|api[_-]?key)\s*[:=]\s*(?:["'][A-Za-z0-9+/=_.-]{6,}["']|(?=[A-Za-z0-9+/=_.-]*[0-9])[A-Za-z0-9+/=_.-]{6,})/gi,
  /eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, // JWT (header.payload.signature)
  /xox[baprs]-[A-Za-z0-9-]+/g, // Slack token
  /sk-[A-Za-z0-9_-]{20,}/g // OpenAI-style secret key
];

const REDACTION_MARKER = "[REDACTED]";

interface RedactionResult {
  text: string;
  count: number;
}

// @req FR-NODE-056
/** Replace every recognized secret with REDACTION_MARKER, counting each replacement. */
function redactSecrets(input: string): RedactionResult {
  let count = 0;
  let text = input;
  for (const pattern of SECRET_PATTERNS) {
    text = text.replace(pattern, () => {
      count += 1;
      return REDACTION_MARKER;
    });
  }
  return { text, count };
}

// @req FR-NODE-056
interface IgnoreRule {
  /** Literal directory/path prefix form (e.g. `secret-build`). */
  prefix?: string;
  /** Compiled matcher for glob forms (e.g. `*.env` or a leading double-star directory glob). */
  glob?: RegExp;
}

// @req FR-NODE-056
/**
 * Parse a .gitignore into ignore rules. Literal prefix/dir forms (e.g. `secret-build/`) are
 * matched by path prefix. Trailing-glob forms common to secret files (`*.env`, `*.key`,
 * `*.pem`) and a leading double-star directory glob are compiled to a basename/path matcher.
 * Other glob features are intentionally unsupported to avoid surprising over-redaction.
 */
function parseGitignore(text: string): IgnoreRule[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"))
    .map((line) => compileIgnoreRule(line));
}

// @req FR-NODE-056
function compileIgnoreRule(raw: string): IgnoreRule {
  const cleaned = raw.replace(/\/$/, "");
  if (cleaned.includes("*")) {
    return { glob: globToRegExp(cleaned) };
  }
  return { prefix: cleaned.replace(/^\//, "") };
}

// @req FR-NODE-056
/**
 * Compile the supported subset of gitignore globs into a RegExp. `*` matches any run of
 * non-slash characters; a leading double-star directory glob (or a pattern without any `/`)
 * matches at any directory depth. Everything else is escaped literally.
 */
function globToRegExp(pattern: string): RegExp {
  const anchored = pattern.replace(/^\//, "");
  // A pattern with no slash (e.g. `*.env`) matches in any directory; so does a `**/` prefix.
  const depthFree = anchored.startsWith("**/") || !anchored.includes("/");
  const body = (anchored.startsWith("**/") ? anchored.slice(3) : anchored)
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, "[^/]*");
  const prefix = depthFree ? "(?:.*/)?" : "";
  return new RegExp(`^${prefix}${body}$`);
}

// @req FR-NODE-056
/** True when a POSIX-relative path is covered by one of the gitignore rules. */
function isIgnored(relPosix: string, ignores: readonly IgnoreRule[]): boolean {
  return ignores.some((rule) => {
    if (rule.prefix !== undefined) {
      return relPosix === rule.prefix || relPosix.startsWith(`${rule.prefix}/`);
    }
    return rule.glob !== undefined && rule.glob.test(relPosix);
  });
}

interface TraceEntry {
  ts: string;
  raw: string;
  record: Record<string, unknown>;
}

// @req FR-NODE-056
/**
 * Parse one trace shard's JSONL body. Well-formed lines become entries; a torn (unparseable)
 * trailing line is dropped silently, recovering the shard rather than failing the whole run.
 */
function parseShard(body: string): TraceEntry[] {
  const entries: TraceEntry[] = [];
  for (const line of body.split("\n")) {
    const trimmed = line.trim();
    if (trimmed === "") continue;
    try {
      const record = JSON.parse(trimmed) as Record<string, unknown>;
      const ts = typeof record.ts === "string" ? record.ts : "";
      entries.push({ ts, raw: trimmed, record });
    } catch {
      // Torn / partially written JSONL line — discard only this line.
    }
  }
  return entries;
}

// @req FR-NODE-056
/** Recursively collect file paths under a directory, skipping .git and the spec tree itself. */
async function collectSourceFiles(dir: string, root: string, acc: string[]): Promise<void> {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    const relPosix = path.relative(root, full).replace(/\\/g, "/");
    if (entry.isDirectory()) {
      if (entry.name === ".git" || relPosix === "docs/spec") continue;
      await collectSourceFiles(full, root, acc);
    } else {
      acc.push(full);
    }
  }
}

// @req FR-NODE-056
/**
 * Drop diff hunks whose `diff --git a/<path> b/<path>` header references a gitignored path, so
 * gitignored content does not reach the SRS through the diff channel (AC-3). A hunk runs from
 * its `diff --git` header up to (but not including) the next header. Content before the first
 * header is preserved.
 */
function filterDiffByGitignore(diff: string, ignores: readonly IgnoreRule[]): string {
  if (ignores.length === 0 || diff === "") return diff;
  const lines = diff.split("\n");
  const out: string[] = [];
  let dropping = false;
  const headerRe = /^diff --git a\/(\S+) b\/(\S+)/;
  for (const line of lines) {
    const match = headerRe.exec(line);
    if (match) {
      const aPath = (match[1] ?? "").replace(/\\/g, "/");
      const bPath = (match[2] ?? "").replace(/\\/g, "/");
      dropping = isIgnored(aPath, ignores) || isIgnored(bPath, ignores);
    }
    if (!dropping) out.push(line);
  }
  return out.join("\n");
}

// @req FR-NODE-056
/** Extract `// @step <task>:` / `# @step <task>:` comment text from source file contents. */
function extractStepComments(task: string, contents: string): string[] {
  const out: string[] = [];
  const marker = `@step ${task}:`;
  for (const line of contents.split(/\r?\n/)) {
    const idx = line.indexOf(marker);
    if (idx >= 0) {
      out.push(line.slice(idx + marker.length).trim());
    }
  }
  return out;
}

// @req FR-NODE-056
async function exists(filePath: string): Promise<boolean> {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}

// @req FR-NODE-056
/**
 * Synthesize the step SRS for `input.task`. See the file-level contract above for the merge,
 * idempotency, diff-cap, gitignore, redaction, and shard-ordering guarantees.
 */
export async function synthesizeStepSrs(
  root: ProjectRoot,
  input: SynthesizeStepSrsInput
): Promise<MutationResult<SynthesizeStepSrsValue>> {
  const task = input.task;
  const stepDir = path.join(root.root, "docs", "spec", "steps", task);
  const outPath = path.join(stepDir, `${task}.srs.md`);

  // AC-2: idempotent no-op when the step SRS already exists.
  if (await exists(outPath)) {
    return mutationOk({ task, written: false, skipped: true, diffCapped: false, redactions: 0, traceEntries: 0 });
  }

  let totalRedactions = 0;

  // Gitignore exclusion set (AC-3).
  const gitignorePath = path.join(root.root, ".gitignore");
  const ignores = (await exists(gitignorePath)) ? parseGitignore(await readFile(gitignorePath, "utf8")) : [];

  // --- intent.md (AC-1) ---
  const intentPath = path.join(stepDir, "intent.md");
  let intent = (await exists(intentPath)) ? await readFile(intentPath, "utf8") : "";
  const intentRedacted = redactSecrets(intent);
  intent = intentRedacted.text;
  totalRedactions += intentRedacted.count;

  // --- trace shards merged in timestamp order, torn tail discarded (AC-5) ---
  const traceDir = path.join(stepDir, "trace");
  const shardNames = (await readdir(traceDir, { withFileTypes: true }).catch(() => []))
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name);
  const traceEntries: TraceEntry[] = [];
  for (const name of shardNames) {
    const body = await readFile(path.join(traceDir, name), "utf8");
    traceEntries.push(...parseShard(body));
  }
  traceEntries.sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0));
  // AC-3: drop shard entries that reference a gitignored path.
  const keptTrace = traceEntries.filter((entry) => {
    const p = entry.record.path;
    return !(typeof p === "string" && isIgnored(p.replace(/\\/g, "/"), ignores));
  });
  const traceLines: string[] = [];
  for (const entry of keptTrace) {
    const redacted = redactSecrets(entry.raw);
    totalRedactions += redacted.count;
    traceLines.push(redacted.text);
  }

  // --- step comments scanned from source files (AC-1), gitignored files excluded (AC-3) ---
  const sourceFiles: string[] = [];
  await collectSourceFiles(root.root, root.root, sourceFiles);
  const commentLines: string[] = [];
  for (const file of sourceFiles) {
    const relPosix = path.relative(root.root, file).replace(/\\/g, "/");
    if (isIgnored(relPosix, ignores)) continue;
    if (relPosix.startsWith("docs/spec/")) continue;
    const contents = await readFile(file, "utf8").catch(() => "");
    for (const comment of extractStepComments(task, contents)) {
      const redacted = redactSecrets(comment);
      totalRedactions += redacted.count;
      commentLines.push(redacted.text);
    }
  }

  // --- final diff: gitignored hunks dropped (AC-3), then redacted (AC-4), then capped (AC-3) ---
  const diffPath = path.join(stepDir, "diff.patch");
  let diff = (await exists(diffPath)) ? await readFile(diffPath, "utf8") : "";
  diff = filterDiffByGitignore(diff, ignores);
  const diffRedacted = redactSecrets(diff);
  diff = diffRedacted.text;
  totalRedactions += diffRedacted.count;

  // Assemble the body, then cap the diff section so the embedded diff stays within its budget.
  const header = [
    `# Step SRS — ${task}`,
    "",
    "## Intent",
    "",
    intent.trimEnd(),
    "",
    "## Trace",
    "",
    traceLines.length > 0 ? traceLines.join("\n") : "(no trace entries)",
    "",
    "## Step Comments",
    "",
    commentLines.length > 0 ? commentLines.join("\n") : "(no step comments)",
    "",
    "## Diff",
    "",
    "```diff",
    ""
  ].join("\n");
  const footer = "\n```\n";

  const truncationNotice = "\n... [diff truncated: capped at 64KiB]";
  // Budget for the diff = diff cap minus the fixed scaffolding around the diff section, minus a
  // small margin so the assembled diff section stays strictly within the diff budget.
  const overhead = Buffer.byteLength(header, "utf8") + Buffer.byteLength(footer, "utf8");
  const diffBudget = MAX_SRS_BYTES - overhead - Buffer.byteLength(truncationNotice, "utf8") - 1;

  let diffSection = diff;
  let diffCapped = false;
  if (Buffer.byteLength(diff, "utf8") > diffBudget) {
    diffCapped = true;
    // Truncate to the byte budget without splitting a multi-byte char, then append the notice.
    const buf = Buffer.from(diff, "utf8").subarray(0, Math.max(0, diffBudget));
    diffSection = buf.toString("utf8").replace(/�+$/, "") + truncationNotice;
  }

  const srs = header + diffSection + footer;

  if (input.dryRun !== true) {
    await mkdir(stepDir, { recursive: true });
    await writeFile(outPath, srs, "utf8");
  }

  return mutationOk({ task, written: input.dryRun !== true, skipped: false, diffCapped, redactions: totalRedactions, traceEntries: keptTrace.length });
}
