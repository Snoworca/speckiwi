import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { summarizeDiagnostics } from "../diagnostic.js";
import { canonicalPath } from "../fs/canonical-path.js";
import { locate } from "../sds/check-sds.js";
import { fail, ok, type Result } from "../result.js";
import type { Diagnostic, DiagnosticsSummary, ParsedWorkspace, RequirementRecord } from "../types.js";
import { checkPrd } from "./check.js";
import { checkPrdReferences, prdCoverage, type PrdCoverageReport, type PrdReferenceProblem } from "./coverage.js";
import { createPrdCursor, prdCursorItems, srsCursorItems, type PrdCursorDirection, type PrdCursorPosition } from "./cursor.js";
import { listPrdItems, readPrdItem, type PrdItemView, type PrdPage, type PrdPageOptions } from "./items.js";
import type { PrdDocument } from "./model.js";
import { parsePrd } from "./parse.js";
import { hasPrdFileSuffix, PRD_DIRECTORY, PRD_FILE_SUFFIX } from "./paths.js";
import { buildPrdSearchIndex, searchPrdItems, type PrdSearchHit } from "./search.js";

// @req FR-NODE-240 FR-NODE-241 FR-NODE-242 — the PRD files of one workspace, as the CLI and the MCP
// tools both read them. A file is read as bytes and handed to the parser as bytes, so the pointer and
// the Request SHA256 are the hashes kiwi-prd's `prd-hash` computes over the same file.

export { PRD_DIRECTORY, PRD_FILE_SUFFIX } from "./paths.js";

/** Page options as a surface hands them over: an option the caller left out may arrive as undefined. */
export interface PrdFilePageOptions {
  offset?: number | undefined;
  limit?: number | undefined;
}

function pageOptions(options: PrdFilePageOptions): PrdPageOptions {
  return {
    ...(options.offset !== undefined ? { offset: options.offset } : {}),
    ...(options.limit !== undefined ? { limit: options.limit } : {})
  };
}

export interface PrdCheckReport {
  path: string;
  prd: string;
  passed: boolean;
  diagnostics: Diagnostic[];
  diagnosticsSummary: DiagnosticsSummary;
}

function isNodeError(error: unknown, ...codes: string[]): boolean {
  return codes.includes((error as NodeJS.ErrnoException).code ?? "");
}

async function readBytes(file: string): Promise<Uint8Array | undefined> {
  try {
    return await readFile(file);
  } catch (error) {
    if (isNodeError(error, "ENOENT", "ENOTDIR", "EISDIR")) return undefined;
    throw error;
  }
}

/**
 * The bytes of `docs/prd/<file>.prd.md`, or undefined when no such file exists. A path outside
 * docs/prd — lexically, or through a link — or without the `.prd.md` suffix is refused: these tools
 * read PRD files, not any file the workspace holds.
 */
async function readPrdBytes(rootPath: string, prdPath: string): Promise<Result<{ path: string; bytes: Uint8Array | undefined }>> {
  const directory = path.resolve(rootPath, ...PRD_DIRECTORY.split("/"));
  const lexical = path.resolve(rootPath, prdPath);
  const refused = fail("USAGE", `A PRD path names a ${PRD_FILE_SUFFIX} file under ${PRD_DIRECTORY}: ${prdPath}`);
  if (!hasPrdFileSuffix(lexical)) return refused;
  // The workspace containment check check-sds uses, with docs/prd as the base.
  const located = await locate(directory, lexical);
  if (located === "outside") return refused;
  if (located === "missing") return ok({ path: path.relative(rootPath, lexical).split(path.sep).join("/"), bytes: undefined });
  // The spelling on disk, not the caller's: a case-insensitive file system opens `Docs/PRD/X.prd.md`
  // for `docs/prd/x.prd.md`, and the path and pointer of one file must not depend on how it was typed.
  const onDisk = path.relative(await canonicalPath(rootPath), await canonicalPath(located.file)).split(path.sep).join("/");
  return ok({ path: onDisk, bytes: await readBytes(located.file) });
}

/** One PRD file, parsed. USAGE for a path that is not a PRD file under docs/prd, NOT_FOUND when it does not exist. */
export async function loadPrdFile(rootPath: string, prdPath: string): Promise<Result<PrdDocument>> {
  const read = await readPrdBytes(rootPath, prdPath);
  if (!read.ok) return read;
  if (read.value.bytes === undefined) return fail("NOT_FOUND", `PRD file not found: ${read.value.path}`);
  return ok(parsePrd(read.value.bytes, read.value.path));
}

/** Every `docs/prd/*.prd.md`, parsed, in file-name order; none when the directory does not exist. */
export async function loadPrdFiles(rootPath: string): Promise<PrdDocument[]> {
  let names: string[];
  try {
    names = await readdir(path.join(rootPath, ...PRD_DIRECTORY.split("/")));
  } catch (error) {
    if (isNodeError(error, "ENOENT", "ENOTDIR")) return [];
    throw error;
  }
  const docs: PrdDocument[] = [];
  for (const name of names.filter(hasPrdFileSuffix).sort()) {
    const loaded = await loadPrdFile(rootPath, `${PRD_DIRECTORY}/${name}`);
    if (loaded.ok) docs.push(loaded.value);
  }
  return docs;
}

/**
 * @req FR-NODE-242 AC-1 — the PRD references of `records` whose file or item does not exist. Each PRD
 * file a reference names is read once, as bytes; a name that is not a PRD file under docs/prd counts
 * as a missing file.
 */
export async function checkPrdReferenceFiles(rootPath: string, records: readonly RequirementRecord[]): Promise<PrdReferenceProblem[]> {
  const named = new Set<string>();
  checkPrdReferences(records, (prdPath) => {
    named.add(prdPath);
    return undefined;
  });
  const docs = new Map<string, PrdDocument>();
  for (const prdPath of named) {
    const loaded = await loadPrdFile(rootPath, prdPath);
    if (loaded.ok) docs.set(prdPath, loaded.value);
  }
  return checkPrdReferences(records, (prdPath) => docs.get(prdPath));
}

/** @req FR-NODE-240 AC-1 — one PRD file's check: each diagnostic once, and whether none is an error. */
export async function checkPrdFile(rootPath: string, prdPath: string): Promise<Result<PrdCheckReport>> {
  const loaded = await loadPrdFile(rootPath, prdPath);
  if (!loaded.ok) return loaded;
  const diagnostics = checkPrd(loaded.value);
  const diagnosticsSummary = summarizeDiagnostics(diagnostics);
  return ok({ path: loaded.value.path, prd: loaded.value.pointer, passed: diagnosticsSummary.errors === 0, diagnostics, diagnosticsSummary });
}

/** @req FR-NODE-240 AC-3 */
export async function listPrdFileItems(rootPath: string, prdPath: string, options: PrdFilePageOptions = {}): Promise<Result<{ items: PrdItemView[]; page: PrdPage }>> {
  const loaded = await loadPrdFile(rootPath, prdPath);
  return loaded.ok ? ok(listPrdItems(loaded.value, pageOptions(options))) : loaded;
}

/** @req FR-NODE-240 AC-3 */
export async function readPrdFileItem(rootPath: string, prdPath: string, itemId: string): Promise<Result<PrdItemView>> {
  const loaded = await loadPrdFile(rootPath, prdPath);
  return loaded.ok ? readPrdItem(loaded.value, itemId) : loaded;
}

/** @req FR-NODE-240 AC-4 — every PRD under docs/prd, or only `options.path` when it is given. */
export async function searchPrdFiles(
  rootPath: string,
  query: string,
  options: PrdFilePageOptions & { path?: string | undefined } = {}
): Promise<Result<{ items: PrdSearchHit[]; page: PrdPage }>> {
  const only = options.path;
  let docs: PrdDocument[];
  if (only === undefined) docs = await loadPrdFiles(rootPath);
  else {
    const loaded = await loadPrdFile(rootPath, only);
    if (!loaded.ok) return loaded;
    docs = [loaded.value];
  }
  return ok(searchPrdItems(buildPrdSearchIndex(docs), query, pageOptions(options)));
}

function knownTarget(workspace: ParsedWorkspace, target: string): Result<string> {
  return workspace.index.targets.some((entry) => entry.target === target)
    ? ok(target)
    : fail("TARGET_NOT_FOUND", `Target ${target} is not in the Target Map of docs/spec/00.index.md`);
}

/** @req FR-NODE-242 AC-2, AC-3 */
export async function prdFileCoverage(workspace: ParsedWorkspace, prdPath: string, target: string): Promise<Result<PrdCoverageReport>> {
  const known = knownTarget(workspace, target);
  if (!known.ok) return known;
  const loaded = await loadPrdFile(workspace.root.root, prdPath);
  return loaded.ok ? ok(prdCoverage(loaded.value, workspace.records, { target })) : loaded;
}

export const PRD_CURSOR_ACTIONS = ["count", "current", "next", "seek", "reset"] as const;
export type PrdCursorAction = (typeof PRD_CURSOR_ACTIONS)[number];
export const PRD_CURSOR_DIRECTIONS: readonly PrdCursorDirection[] = ["prd-to-srs", "srs-to-prd"];

export interface PrdCursorRequest {
  action: string;
  path: string;
  runId: string;
  /** Defaults to `prd-to-srs`, the PRD items; `srs-to-prd` walks the target's requirements and criteria. */
  direction?: string;
  /** Required for `srs-to-prd`. */
  target?: string;
  verdict?: string;
  note?: string;
  refs?: string[];
  /** 1-based; required for `seek`. */
  index?: number;
}

function isAction(value: string): value is PrdCursorAction {
  return (PRD_CURSOR_ACTIONS as readonly string[]).includes(value);
}

function isDirection(value: string): value is PrdCursorDirection {
  return (PRD_CURSOR_DIRECTIONS as readonly string[]).includes(value);
}

/**
 * @req FR-NODE-241 — one cursor call. `next` and `reset` append to `kiwi/prd/<runId>.jsonl`; the
 * other actions only read it. Malformed requests are refused before the ledger is touched.
 */
export async function runPrdCursor(workspace: ParsedWorkspace, request: PrdCursorRequest): Promise<Result<PrdCursorPosition | { total: number; prd: string }>> {
  const direction = request.direction ?? "prd-to-srs";
  if (!isAction(request.action)) return fail("USAGE", `Cursor action "${request.action}" is not one of ${PRD_CURSOR_ACTIONS.join(", ")}`);
  if (!isDirection(direction)) return fail("USAGE", `Direction "${direction}" is not one of ${PRD_CURSOR_DIRECTIONS.join(", ")}`);
  if (request.action === "seek" && request.index === undefined) return fail("USAGE", "seek needs the 1-based index of the item to show");
  if (direction === "srs-to-prd" && request.target === undefined) return fail("USAGE", "The srs-to-prd direction walks one target's requirements; name the target");
  if (request.target !== undefined) {
    const known = knownTarget(workspace, request.target);
    if (!known.ok) return known;
  }
  const loaded = await loadPrdFile(workspace.root.root, request.path);
  if (!loaded.ok) return loaded;
  const doc = loaded.value;
  const cursor = createPrdCursor({
    root: workspace.root.root,
    runId: request.runId,
    direction,
    prd: doc.pointer,
    items: direction === "prd-to-srs" ? prdCursorItems(doc) : srsCursorItems(workspace.records, request.target!)
  });
  switch (request.action) {
    case "count": {
      // count reads no ledger, so it is the one action that would not reject a bad run ID by itself.
      const opened = await cursor.current();
      return opened.ok ? ok(cursor.count()) : opened;
    }
    case "current":
      return cursor.current();
    case "next":
      return cursor.next({
        ...(request.verdict !== undefined ? { verdict: request.verdict } : {}),
        ...(request.note !== undefined ? { note: request.note } : {}),
        ...(request.refs !== undefined ? { refs: request.refs } : {})
      });
    case "seek":
      return cursor.seek(request.index!);
    case "reset":
      return cursor.reset();
  }
}
