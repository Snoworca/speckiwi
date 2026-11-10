import { isUtf8 } from "node:buffer";
import { fail, ok, type Result } from "../result.js";
import { testFileMatcher } from "../testing/test-citations.js";
import { exportSurface, type ExportSurface } from "./js-export-surface.js";
import { lexJsSource, type JsSource } from "./js-source-lexer.js";
import { testCaseSurface, type TestCaseRecord, type TestCaseSurface } from "./js-test-cases.js";
import { runGit, type GitRunner } from "./pinning.js";

// @req FR-NODE-252 — `speckiwi orchestrate preservation check --base <rev> [--head <rev>]`: the
// preservation layer of a diff computed by running a command instead of by a verifier reading the
// diff. It reports the rows kiwi-coder §0.20 names — a deleted or moved file, a removed or re-signed
// export, a deleted or weakened test — and lists every changed file it could not read the public
// surface of under `unchecked`, which fails the check as surely as a row does. Whether a row is an
// `intended-improvement` (kiwi-coder §0.20.4) stays the host's decision.

/** The AC-4 statement every report carries: the two weakenings of §0.20.3 this tool does not judge. */
export const PRESERVATION_NOT_CHECKED =
  "A replaced expected value and a loosened assertion predicate are not checked; they remain the verifier's to judge.";

export type UncheckedReason =
  | "language-not-parsed"
  | "unparsable-source"
  | "unrecognized-export-form"
  | "unrecognized-test-form"
  | "non-regular-file"
  | "oversize"
  | "not-utf8";

export interface UncheckedFile {
  readonly path: string;
  readonly reason: UncheckedReason;
}

export type PreservationRow =
  | { readonly kind: "existing-file-deleted-or-moved"; readonly path: string; readonly change: "deleted" }
  | { readonly kind: "existing-file-deleted-or-moved"; readonly path: string; readonly newPath: string; readonly change: "renamed" }
  | {
      readonly kind: "existing-public-contract-change";
      readonly path: string;
      readonly newPath?: string;
      readonly symbol: string;
      readonly change: "removed" | "signature-changed";
    }
  | TestRow;

type TestRow = { readonly kind: "existing-test-weakened-or-deleted"; readonly path: string; readonly newPath?: string } & (
  | { readonly case: null; readonly change: "test-file-deleted" }
  | { readonly case: string; readonly change: "case-removed" | "case-commented-out" }
  | { readonly case: string; readonly change: "assertion-removed"; readonly baseAssertions: number; readonly headAssertions: number }
  | { readonly case: string; readonly change: "skip-added" | "only-added"; readonly marker: string }
);

/** One side of a changed file: its text, or why it could not be read. */
export type FileSide = { readonly text: string } | { readonly unreadable: UncheckedReason };

/** A file that existed at base and differs at head. Files added at head have nothing to preserve. */
export type ChangedFile =
  | { readonly status: "modified"; readonly path: string; readonly base: FileSide; readonly head: FileSide }
  | { readonly status: "renamed"; readonly path: string; readonly newPath: string; readonly base: FileSide; readonly head: FileSide }
  | { readonly status: "deleted"; readonly path: string; readonly base: FileSide; readonly head: null };

export interface FilePreservation {
  readonly rows: PreservationRow[];
  readonly unchecked: UncheckedFile[];
}

const PARSED_EXTENSION = /\.(?:ts|tsx|mts|cts|js|jsx|mjs|cjs)$/;
/** Documentation and data files: no public surface to check, so neither unchecked nor failing (AC-3). */
const DOCUMENT_OR_DATA_EXTENSION = /\.(?:md|json|jsonl|yaml|yml|txt|csv|svg)$/;
const isTestFile = testFileMatcher();

/** The file's path at base and, for a rename, at head. */
function pathsOf(path: string, newPath: string | undefined): string[] {
  return newPath === undefined ? [path] : [path, newPath];
}

/** Whether the reader parses the file at every path it has (a rename to another language does not). */
function isParsed(paths: readonly string[]): boolean {
  return paths.every((path) => PARSED_EXTENSION.test(path));
}
const EMPTY_SOURCE: JsSource = { tokens: [], comments: [] };

function contractRows(path: string, newPath: string | undefined, base: ExportSurface, head: ExportSurface): PreservationRow[] {
  const rows: PreservationRow[] = [];
  for (const [symbol, signature] of base) {
    const headSignature = head.get(symbol);
    if (headSignature === signature) continue;
    rows.push({
      kind: "existing-public-contract-change",
      path,
      ...(newPath !== undefined ? { newPath } : {}),
      symbol,
      change: headSignature === undefined ? "removed" : "signature-changed"
    });
  }
  return rows;
}

/**
 * The markers a case gained between base and head, comparing the branches it may run on: a marker
 * that more branches carry, or — when a branch that ran the case unmarked is gone and no marker
 * gained — every marker the head branches carry (`cond ? it : it.skip` → `it.skip`).
 */
function addedMarkers(base: TestCaseRecord["branches"], head: TestCaseRecord["branches"]): string[] {
  const count = (branches: TestCaseRecord["branches"], marker: string | null): number =>
    branches.filter((markers) => (marker === null ? markers.length === 0 : markers.includes(marker))).length;
  const headMarkers = [...new Set(head.flat())];
  const gained = headMarkers.filter((marker) => count(head, marker) > count(base, marker));
  if (gained.length > 0) return gained;
  return count(head, null) < count(base, null) ? headMarkers : [];
}

function testRows(path: string, newPath: string | undefined, base: TestCaseSurface, head: TestCaseSurface): PreservationRow[] {
  const at = { kind: "existing-test-weakened-or-deleted", path, ...(newPath !== undefined ? { newPath } : {}) } as const;
  const headCases = new Map(head.cases.map((item) => [item.key, item]));
  const rows: PreservationRow[] = [];
  for (const baseCase of base.cases) {
    const headCase = headCases.get(baseCase.key);
    if (headCase === undefined) {
      rows.push({ ...at, case: baseCase.key, change: head.commentedTitles.has(baseCase.title) ? "case-commented-out" : "case-removed" });
      continue;
    }
    if (headCase.assertions < baseCase.assertions) {
      rows.push({ ...at, case: baseCase.key, change: "assertion-removed", baseAssertions: baseCase.assertions, headAssertions: headCase.assertions });
    }
    // @req FR-NODE-282 AC-3 — each count on its own: a hand-off swapped for a direct skip still raises one.
    if (headCase.contextSkips > baseCase.contextSkips || headCase.handOffs > baseCase.handOffs) {
      rows.push({ ...at, case: baseCase.key, change: "skip-added", marker: "context.skip()" });
    }
    for (const marker of addedMarkers(baseCase.branches, headCase.branches)) rows.push({ ...at, case: baseCase.key, change: marker === ".only" ? "only-added" : "skip-added", marker });
  }
  return rows;
}

const JSX_EXTENSION = /\.(?:tsx|jsx)$/;

function lexSide(side: FileSide, path: string): JsSource | UncheckedReason {
  if ("unreadable" in side) return side.unreadable;
  return lexJsSource(side.text, { jsx: JSX_EXTENSION.test(path) }) ?? "unparsable-source";
}

/** The preservation rows of one changed file, and whether its public surface went unchecked. */
export function preservationRowsFor(file: ChangedFile): FilePreservation {
  const newPath = file.status === "renamed" ? file.newPath : undefined;
  const rows: PreservationRow[] = [];
  if (file.status === "deleted") rows.push({ kind: "existing-file-deleted-or-moved", path: file.path, change: "deleted" });
  if (file.status === "renamed") rows.push({ kind: "existing-file-deleted-or-moved", path: file.path, newPath: file.newPath, change: "renamed" });
  const testFile = isTestFile(file.path);
  if (file.status === "deleted" && testFile) rows.push({ kind: "existing-test-weakened-or-deleted", path: file.path, case: null, change: "test-file-deleted" });

  const unchecked = (reason: UncheckedReason): FilePreservation => ({ rows, unchecked: [{ path: file.path, reason }] });
  const paths = pathsOf(file.path, newPath);
  if (paths.every((path) => DOCUMENT_OR_DATA_EXTENSION.test(path))) return { rows, unchecked: [] };
  if (!isParsed(paths)) return unchecked("language-not-parsed");
  const base = lexSide(file.base, file.path);
  if (typeof base === "string") return unchecked(base);
  const head = file.head === null ? EMPTY_SOURCE : lexSide(file.head, newPath ?? file.path);
  if (typeof head === "string") return unchecked(head);

  const baseSurface = exportSurface(base);
  const headSurface = exportSurface(head);
  if (baseSurface === null || headSurface === null) return unchecked("unrecognized-export-form");
  rows.push(...contractRows(file.path, newPath, baseSurface, headSurface));
  if (!testFile || file.head === null) return { rows, unchecked: [] };
  const baseCases = testCaseSurface(base);
  const headCases = testCaseSurface(head);
  if (baseCases === null || headCases === null) return unchecked("unrecognized-test-form");
  rows.push(...testRows(file.path, newPath, baseCases, headCases));
  return { rows, unchecked: [] };
}

// --- the git half ---------------------------------------------------------------------------------

/** Above this a source file is listed as unchecked rather than read. */
const MAX_SOURCE_BYTES = 2 * 1024 * 1024;
const MAX_DIFF_BYTES = 64 * 1024 * 1024;
const COMMIT_OID = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
const REGULAR_MODES = new Set(["100644", "100755"]);

export interface PreservationCheckInput {
  /** The repository's top level; every git call runs there. */
  readonly root: string;
  readonly base: string;
  /** Defaults to `HEAD`. */
  readonly head?: string;
}

export interface PreservationReport {
  readonly base: { readonly rev: string; readonly commit: string };
  readonly head: { readonly rev: string; readonly commit: string };
  /** True only when there is no row and no unchecked file. */
  readonly passed: boolean;
  readonly rows: readonly PreservationRow[];
  readonly unchecked: readonly UncheckedFile[];
  readonly notChecked: typeof PRESERVATION_NOT_CHECKED;
}

/** The commit a revision names, or `null` when it names none, a range, or something that is not a commit. */
async function resolveCommit(git: GitRunner, root: string, rev: string): Promise<string | null> {
  if (rev === "" || rev.startsWith("-") || rev.includes("..")) return null;
  // `--ignore-missing` makes an unknown name an empty answer instead of a failed process.
  const output = (await git(root, ["--no-optional-locks", "rev-list", "--no-walk", "--ignore-missing", rev, "--"], 64 * 1024)).toString("utf8");
  const lines = output.split("\n").filter((line) => line !== "");
  return lines.length === 1 && COMMIT_OID.test(lines[0] as string) ? (lines[0] as string) : null;
}

interface RawChange {
  readonly status: "modified" | "renamed" | "deleted";
  readonly path: string;
  readonly newPath?: string;
  readonly baseMode: string;
  readonly headMode: string;
  readonly baseOid: string;
  readonly headOid: string;
}

/** `git diff --raw -z` records of files that existed at base; additions are dropped. */
function parseRawDiff(output: Buffer): RawChange[] {
  const fields = output.toString("utf8").split("\0");
  const changes: RawChange[] = [];
  let index = 0;
  while (index < fields.length) {
    const meta = fields[index] as string;
    index += 1;
    if (!meta.startsWith(":")) continue;
    const [baseMode, headMode, baseOid, headOid, status] = meta.slice(1).split(" ") as [string, string, string, string, string];
    const letter = status.charAt(0);
    const path = fields[index] as string;
    index += 1;
    if (letter === "R" || letter === "C") {
      const newPath = fields[index] as string;
      index += 1;
      if (letter === "R") changes.push({ status: "renamed", path, newPath, baseMode, headMode, baseOid, headOid });
    } else if (letter === "D") changes.push({ status: "deleted", path, baseMode, headMode, baseOid, headOid });
    else if (letter !== "A") changes.push({ status: "modified", path, baseMode, headMode, baseOid, headOid });
  }
  return changes.sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0));
}

async function readSide(git: GitRunner, root: string, mode: string, oid: string): Promise<FileSide> {
  if (!REGULAR_MODES.has(mode)) return { unreadable: "non-regular-file" };
  const size = Number((await git(root, ["--no-optional-locks", "cat-file", "-s", oid], 64 * 1024)).toString("utf8").trim());
  if (size > MAX_SOURCE_BYTES) return { unreadable: "oversize" };
  const bytes = await git(root, ["--no-optional-locks", "cat-file", "blob", oid], MAX_SOURCE_BYTES + 1);
  return isUtf8(bytes) ? { text: bytes.toString("utf8") } : { unreadable: "not-utf8" };
}

/** A side that is never read: the per-file check lists a file in another language before reading it. */
const NOT_READ: FileSide = { unreadable: "language-not-parsed" };

async function changedFile(git: GitRunner, root: string, change: RawChange): Promise<ChangedFile> {
  const parsed = isParsed(pathsOf(change.path, change.newPath));
  const base = parsed ? await readSide(git, root, change.baseMode, change.baseOid) : NOT_READ;
  if (change.status === "deleted") return { status: "deleted", path: change.path, base, head: null };
  const head = parsed ? await readSide(git, root, change.headMode, change.headOid) : NOT_READ;
  return change.status === "renamed"
    ? { status: "renamed", path: change.path, newPath: change.newPath as string, base, head }
    : { status: "modified", path: change.path, base, head };
}

/**
 * The preservation rows between two revisions. A read verb: every git call is a read
 * (`rev-list`, `diff`, `cat-file`) run with `--no-optional-locks`, so nothing in the repository is
 * written, and the same two revisions give the same rows.
 */
export async function checkPreservation(input: PreservationCheckInput, git: GitRunner = runGit): Promise<Result<PreservationReport>> {
  const headRev = input.head ?? "HEAD";
  const base = await resolveCommit(git, input.root, input.base);
  if (base === null) return fail("PRESERVATION_REVISION_INVALID", `--base ${JSON.stringify(input.base)} does not name a single commit`);
  const head = await resolveCommit(git, input.root, headRev);
  if (head === null) return fail("PRESERVATION_REVISION_INVALID", `--head ${JSON.stringify(headRev)} does not name a single commit`);

  const diff = await git(
    input.root,
    ["--no-optional-locks", "diff", "--raw", "-z", "-M", "--no-abbrev", "--no-relative", "--no-ext-diff", base, head, "--"],
    MAX_DIFF_BYTES
  );
  const rows: PreservationRow[] = [];
  const unchecked: UncheckedFile[] = [];
  for (const change of parseRawDiff(diff)) {
    const result = preservationRowsFor(await changedFile(git, input.root, change));
    rows.push(...result.rows);
    unchecked.push(...result.unchecked);
  }
  return ok({
    base: { rev: input.base, commit: base },
    head: { rev: headRev, commit: head },
    passed: rows.length === 0 && unchecked.length === 0,
    rows,
    unchecked,
    notChecked: PRESERVATION_NOT_CHECKED
  });
}

function rowLine(row: PreservationRow): string {
  const where = "newPath" in row && row.newPath !== undefined ? `${row.path} -> ${row.newPath}` : row.path;
  if (row.kind === "existing-file-deleted-or-moved") return `${row.kind} ${where} ${row.change}`;
  if (row.kind === "existing-public-contract-change") return `${row.kind} ${where} ${row.symbol} ${row.change}`;
  const subject = row.case === null ? "" : ` ${row.case}`;
  const detail = row.change === "assertion-removed" ? ` ${row.baseAssertions} -> ${row.headAssertions}` : "marker" in row ? ` ${row.marker}` : "";
  return `${row.kind} ${where}${subject} ${row.change}${detail}`;
}

/** The text form of a report: a verdict line, one line per row and unchecked file, then the AC-4 statement. */
export function formatPreservationReport(report: PreservationReport): string {
  return [
    `Preservation check ${report.base.commit.slice(0, 12)}..${report.head.commit.slice(0, 12)}: ${report.passed ? "passed" : "failed"} (${report.rows.length} rows, ${report.unchecked.length} unchecked)`,
    ...report.rows.map(rowLine),
    ...report.unchecked.map((file) => `unchecked ${file.path} ${file.reason}`),
    PRESERVATION_NOT_CHECKED
  ].join("\n");
}
