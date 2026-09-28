import { readdir, readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { splitDiagnostics, summarizeDiagnostics } from "../diagnostic.js";
import { fail, ok, type Result } from "../result.js";
import type { Diagnostic, DiagnosticsSummary, ParsedWorkspace, RequirementRecord } from "../types.js";
import {
  liteSdsCoverageDiagnostics,
  liteSdsDiagnostic,
  liteSdsReferenceDiagnostics,
  parseLiteSds,
  summarizeLiteSds,
  type LiteSdsDocument,
  type LiteSdsParse,
  type LiteSdsSummary
} from "./lite-sds.js";

// @req FR-NODE-209 AC-3 @req IR-CLI-102 @req FR-MCP-065
//
// The disk side of the lite SDS checks. `speckiwi validate` reads every docs/sds/*.sds.md; `sds check`
// and `check_sds` read one file. Both answer from the same parse and the same two record-backed checks.

/** Where every body-scope SDS lives (decision D3); lite files end in {@link LITE_SDS_SUFFIX}. */
export const LITE_SDS_DIRECTORY = "docs/sds";
export const LITE_SDS_SUFFIX = ".sds.md";

interface SdsFileText {
  readonly relativePath: string;
  readonly text: string;
}

/**
 * The requirements an id can name: every body requirement, then each step requirement not yet promoted.
 * A step requirement that carries a body id (an UPDATE step) does not replace the body one, because a
 * body-scope SDS and the test-sufficiency check both read the requirement as it stands in the body.
 */
export function knownRequirements(workspace: ParsedWorkspace): RequirementRecord[] {
  const known = new Set(workspace.records.map((record) => record.id));
  const staged = (workspace.stepRecords ?? []).filter((record) => {
    if (known.has(record.id)) return false;
    known.add(record.id);
    return true;
  });
  return [...workspace.records, ...staged];
}

/**
 * The docs/sds/*.sds.md files, sorted by name. A workspace without the directory has none, and a file
 * whose real location is outside the workspace — through a linked directory — is not read.
 */
async function readSdsDirectory(rootPath: string): Promise<SdsFileText[]> {
  const directory = path.join(rootPath, ...LITE_SDS_DIRECTORY.split("/"));
  const entries = await readdir(directory, { withFileTypes: true }).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT" || error.code === "ENOTDIR") return [];
    throw error;
  });
  const names = entries.filter((entry) => entry.isFile() && entry.name.endsWith(LITE_SDS_SUFFIX)).map((entry) => entry.name).sort();
  const files: SdsFileText[] = [];
  for (const name of names) {
    const relativePath = `${LITE_SDS_DIRECTORY}/${name}`;
    const text = await readWorkspaceText(rootPath, relativePath);
    if (text !== null) files.push({ relativePath, text });
  }
  return files;
}

function recordDiagnostics(parsed: LiteSdsParse, workspace: ParsedWorkspace): Diagnostic[] {
  return parsed.isLite ? [...parsed.diagnostics, ...liteSdsReferenceDiagnostics(parsed.document, knownRequirements(workspace))] : parsed.diagnostics;
}

// @req FR-NODE-209 AC-2 AC-3 — the lite diagnostics `speckiwi validate` adds, in every work-mode.
export async function liteSdsValidationDiagnostics(workspace: ParsedWorkspace): Promise<Diagnostic[]> {
  const diagnostics: Diagnostic[] = [];
  const documents: LiteSdsDocument[] = [];
  for (const file of await readSdsDirectory(workspace.root.root)) {
    const parsed = parseLiteSds(file.text, file.relativePath);
    if (!parsed.isLite) {
      diagnostics.push(liteSdsDiagnostic("SDS-W069", `${file.relativePath} is not a lite-profile SDS (metadata 'Profile' is not 'lite'), so it was not checked`, file.relativePath));
      continue;
    }
    diagnostics.push(...recordDiagnostics(parsed, workspace));
    documents.push(parsed.document);
  }
  diagnostics.push(...liteSdsCoverageDiagnostics(documents, workspace.records));
  return diagnostics;
}

export interface SdsCheckReport {
  readonly path: string;
  readonly profile: string | null;
  /** False when any error-level diagnostic exists. */
  readonly passed: boolean;
  readonly diagnostics: Diagnostic[];
  readonly errors: Diagnostic[];
  readonly warnings: Diagnostic[];
  readonly diagnosticsSummary: DiagnosticsSummary;
  readonly summary: LiteSdsSummary;
}

/** `relative` (from `path.relative`) names something strictly inside its base — not the base, not above it. */
function isInside(relative: string): boolean {
  return relative !== "" && relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

/**
 * Where a workspace path really is: `missing` when nothing is there, `outside` when the file resolves —
 * through a symlink or a junction as well as through `..` — outside the workspace's real location.
 */
async function locate(rootPath: string, candidate: string): Promise<{ file: string } | "missing" | "outside"> {
  const lexical = path.resolve(rootPath, candidate);
  if (!isInside(path.relative(rootPath, lexical))) return "outside";
  let real: string;
  try {
    real = await realpath(lexical);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT" || (error as NodeJS.ErrnoException).code === "ENOTDIR") return "missing";
    throw error;
  }
  return isInside(path.relative(await realpath(rootPath), real)) ? { file: real } : "outside";
}

async function readLocated(located: { file: string }): Promise<string | null> {
  try {
    return await readFile(located.file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EISDIR") return null;
    throw error;
  }
}

/** The text of a workspace-relative POSIX path, or null when no file is there or it resolves outside. */
export async function readWorkspaceText(rootPath: string, relativePath: string): Promise<string | null> {
  const located = await locate(rootPath, relativePath);
  return typeof located === "string" ? null : readLocated(located);
}

/**
 * Reads and parses one SDS file named by the caller. A relative path is read from the workspace root;
 * a path that resolves outside the workspace — lexically or through a link — is a usage error and a
 * missing file is NOT_FOUND.
 */
export async function loadSdsFile(rootPath: string, sdsPath: string): Promise<Result<LiteSdsParse>> {
  const located = await locate(rootPath, sdsPath);
  if (located === "outside") return fail("USAGE", `SDS path is not under the workspace: ${sdsPath}`);
  const relativePath = path.relative(rootPath, path.resolve(rootPath, sdsPath)).split(path.sep).join("/");
  const text = located === "missing" ? null : await readLocated(located);
  if (text === null) return fail("NOT_FOUND", `SDS file not found: ${relativePath}`);
  return ok(parseLiteSds(text, relativePath));
}

// @req IR-CLI-102 AC-1 @req FR-MCP-065 AC-1 — one SDS file's diagnostics and parsed summary. The
// in-target check counts the other lite SDS files of the same target in docs/sds, so a split SDS is
// not told it misses what its sibling covers.
export async function checkSdsFile(workspace: ParsedWorkspace, sdsPath: string): Promise<Result<SdsCheckReport>> {
  const rootPath = workspace.root.root;
  const loaded = await loadSdsFile(rootPath, sdsPath);
  if (!loaded.ok) return loaded;
  const parsed = loaded.value;
  const relativePath = parsed.document.path;
  const diagnostics = recordDiagnostics(parsed, workspace);
  if (parsed.isLite && parsed.document.target !== null) {
    const siblings: LiteSdsDocument[] = [];
    for (const file of await readSdsDirectory(rootPath)) {
      if (file.relativePath === relativePath) continue;
      const sibling = parseLiteSds(file.text, file.relativePath);
      if (sibling.isLite && sibling.document.target === parsed.document.target) siblings.push(sibling.document);
    }
    // Siblings only widen the @req union; a warning that lands on a sibling is that sibling's to report.
    diagnostics.push(...liteSdsCoverageDiagnostics([parsed.document, ...siblings], workspace.records).filter((item) => item.filePath === relativePath));
  }
  const split = splitDiagnostics(diagnostics);
  return ok({
    path: relativePath,
    profile: parsed.document.metadata.Profile ?? null,
    passed: split.errors.length === 0,
    ...split,
    diagnosticsSummary: summarizeDiagnostics(split.diagnostics),
    summary: summarizeLiteSds(parsed.document)
  });
}
