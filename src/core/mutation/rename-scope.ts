import { access, readdir } from "node:fs/promises";
import path from "node:path";
import { isScopeDocumentPath, nextScopeDocumentNumber, scopeDocumentName } from "../bootstrap/templates.js";
import { readUtf8File } from "../fs/read-text.js";
import { applyPatchPlans } from "../patch/apply-patch-plans.js";
import { createPatchPlan, type PatchOperation } from "../patch/patch-plan.js";
import {
  classifyLinkDestination,
  findMarkdownLinksInDocument,
  linkDefinitions,
  referenceKey,
  resolveRepositoryLink,
  type MarkdownLink,
  type TextSpan
} from "../parser/markdown-links.js";
import { relatedDocsPath, sameRepositoryPath, traceLinkPaths, traceReferencePath } from "../parser/file-references.js";
import { renderRowByHeader, splitTableRow } from "../parser/table.js";
import { parseWorkspace } from "../parser/workspace-parser.js";
import type { MutationResult, ProjectRoot, RequirementRecord, TextFile, TraceLink } from "../types.js";
import { mutationFail, mutationOk } from "./guards.js";
import { readScopeIndexTable, scopeColumn, type ScopeIndexSection, type ScopeIndexTable } from "./scope-index-table.js";
import { withSrsMutationLock } from "./srs-lock.js";

// @req FR-NODE-232

export interface RenameScopeInput {
  /** The scope document to move, by file name: `10.product-architecture`, `.srs.md` optional. */
  from: string;
  /** The new name as `NN.slug` (lowercase kebab-case slug), `.srs.md` optional. */
  to: string;
  /** Writes only when true; otherwise the result previews every rewrite and nothing changes. */
  apply?: boolean;
  ignoreLock?: boolean;
}

export interface RenameScopeRewrite {
  /** 1-based line in the file (docs/spec/00.index.md unless a `file` says otherwise). */
  line: number;
  before: string;
  after: string;
}

export interface RenameScopeRowRewrite extends RenameScopeRewrite {
  section: ScopeIndexSection;
}

export interface RenameScopeOutput {
  dryRun: boolean;
  /** docs/spec-relative path before the move. */
  from: string;
  /** docs/spec-relative path after the move. */
  to: string;
  renumbered: boolean;
  /** True once the move and every rewrite are on disk; the SRS lock refreshes its status cache on it. */
  written: boolean;
  rewrittenRows: RenameScopeRowRewrite[];
  /** Index lines outside the two scope tables whose links to the document were rewritten. */
  rewrittenLinks: RenameScopeRewrite[];
  /** Lines of the other files under docs/spec (Related Docs rows and links) that were rewritten. */
  otherFileLinks: RenameScopeFileRewrite[];
}

export interface RenameScopeFileRewrite extends RenameScopeRewrite {
  /** Repository-relative path of the file, after the move for the moved document itself. */
  file: string;
}

/** Stable refusal codes, returned as `error.code`; the message names the failed condition. */
export type RenameScopeRefusal =
  | "SCOPE_RENAME_INVALID_NAME"
  | "SCOPE_RENAME_NO_CHANGE"
  | "SCOPE_RENAME_SOURCE_NOT_FOUND"
  | "SCOPE_RENAME_SOURCE_NOT_REGISTERED"
  | "SCOPE_RENAME_INDEX_TABLE_MISSING"
  | "SCOPE_RENAME_TARGET_EXISTS"
  | "SCOPE_RENAME_PREFIX_CONFLICT"
  | "SCOPE_RENAME_NUMBER_NOT_SHARED"
  | "SCOPE_RENAME_NUMBER_NOT_NEXT"
  | "SCOPE_RENAME_ROW_UNPARSEABLE";

const SPEC_DIR = "docs/spec";
const TARGET_NAME = /^(\d{2,})\.([a-z0-9]+(?:-[a-z0-9]+)*)$/;

function refuse(code: RenameScopeRefusal, message: string): MutationResult<RenameScopeOutput> {
  return mutationFail(code, message);
}

function bareName(value: string): string {
  return value.trim().replace(/\.srs\.md$/, "");
}

function leadingNumber(fileName: string): number | undefined {
  const match = /^(\d+)\./.exec(fileName);
  return match ? Number.parseInt(match[1] ?? "", 10) : undefined;
}

/**
 * @req FR-NODE-232 AC-1/AC-3/AC-4 — renameScope relocates one scope document and rewrites every
 * index reference to it under one SRS mutation lock: the §2 SRS Documents row, the §4 Scope Map row
 * (each through the column-addressed row primitive, because the two sections order their columns
 * differently) and every markdown link elsewhere in the index. A slug change is always allowed; a
 * new leading number only repairs SRS-W070 (rules §5.2 rules 3 and 4). Any refusal writes nothing.
 * The prefix is never changed: that cascades to every requirement id and belongs to collision repair.
 */
export async function renameScope(root: ProjectRoot, input: RenameScopeInput): Promise<MutationResult<RenameScopeOutput>> {
  const dryRun = input.apply !== true;
  return withSrsMutationLock(root, { operation: "rename_scope", dryRun, ignoreLock: input.ignoreLock }, () =>
    renameScopeUnlocked(root, input, dryRun)
  );
}

async function renameScopeUnlocked(root: ProjectRoot, input: RenameScopeInput, dryRun: boolean): Promise<MutationResult<RenameScopeOutput>> {
  const fromName = bareName(input.from);
  const toName = bareName(input.to);
  if (fromName === "" || /[\\/]/.test(fromName)) {
    return refuse("SCOPE_RENAME_INVALID_NAME", `from must be a scope document file name in ${SPEC_DIR}, got "${input.from}"`);
  }
  const target = TARGET_NAME.exec(toName);
  const toNumber = target ? Number.parseInt(target[1] ?? "", 10) : Number.NaN;
  // The number keeps the allocator's padding, so `7.x` and `007.x` are refused rather than sorted apart.
  if (!target || scopeDocumentName(target[2] ?? "", toNumber) !== `${toName}.srs.md`) {
    return refuse("SCOPE_RENAME_INVALID_NAME", `to must be NN.slug with a two-digit number and a lowercase kebab-case slug, got "${input.to}"`);
  }
  const fromFile = `${fromName}.srs.md`;
  const toFile = `${toName}.srs.md`;
  if (fromFile === toFile) return refuse("SCOPE_RENAME_NO_CHANGE", `${fromFile} already has that name`);

  const workspace = await parseWorkspace(root);
  const indexFile: TextFile | undefined = workspace.files[0];
  const fromPath = `${SPEC_DIR}/${fromFile}`;
  const toPath = `${SPEC_DIR}/${toFile}`;
  const scopeDocuments = workspace.files.map((file) => file.relativePath).filter(isScopeDocumentPath);
  if (!indexFile || !scopeDocuments.includes(fromPath)) {
    return refuse("SCOPE_RENAME_SOURCE_NOT_FOUND", `${fromPath} is not a scope document`);
  }
  const fromScopes = workspace.index.scopes.filter((scope) => sameRepositoryPath(resolveIndexDestination(scope.document), fromPath));
  if (fromScopes.length === 0) {
    return refuse("SCOPE_RENAME_SOURCE_NOT_REGISTERED", `${fromPath} has no Scope Map row; register it first`);
  }
  const absoluteTo = path.join(root.root, ...toPath.split("/"));
  if (await pathExists(absoluteTo)) return refuse("SCOPE_RENAME_TARGET_EXISTS", `${toPath} already exists`);

  // @req FR-NODE-232 AC-2 — after the move the target document carries the source's prefix, so the
  // move must not leave two scopes registering one document or one prefix.
  const otherScopes = workspace.index.scopes.filter((scope) => !fromScopes.includes(scope));
  const targetHolder = otherScopes.find((scope) => sameRepositoryPath(resolveIndexDestination(scope.document), toPath));
  if (targetHolder) {
    return refuse("SCOPE_RENAME_PREFIX_CONFLICT", `${toPath} is already registered by the Scope Map row for prefix ${targetHolder.prefix}`);
  }
  const fromPrefixes = new Set(fromScopes.map((scope) => scope.prefix.trim().toUpperCase()));
  const prefixHolder = otherScopes.find((scope) => fromPrefixes.has(scope.prefix.trim().toUpperCase()));
  if (prefixHolder) {
    return refuse("SCOPE_RENAME_PREFIX_CONFLICT", `prefix ${prefixHolder.prefix} is also registered for ${prefixHolder.document}`);
  }

  const fromNumber = leadingNumber(fromFile);
  const renumbered = fromNumber !== toNumber;
  if (renumbered) {
    const refusal = renumberRefusal(fromPath, fromNumber, toNumber, scopeDocuments, workspace.specDocuments ?? scopeDocuments);
    if (refusal) return refusal;
  }

  const documentsTable = readScopeIndexTable(indexFile, "srs-documents");
  const scopeMapTable = readScopeIndexTable(indexFile, "scope-map");
  if (!documentsTable || !scopeMapTable) {
    return refuse("SCOPE_RENAME_INDEX_TABLE_MISSING", "SRS Documents or Scope Map table not found in 00.index.md");
  }

  // One document-level scan, so fenced code and HTML comments hold no links for any step below.
  const documentLinks = findMarkdownLinksInDocument(indexFile.lines);
  const reference = DocumentReference.forDocument(indexFile.lines, resolveIndexDestination, fromPath, fromFile, toFile);
  const rewrittenRows: RenameScopeRowRewrite[] = [];
  for (const table of [documentsTable, scopeMapTable]) {
    const rewritten = rewriteTableRows(indexFile, table, reference);
    if (!Array.isArray(rewritten)) return rewritten;
    rewrittenRows.push(...rewritten);
  }
  // Every other line, table rows of other scopes included: a destination swap adds no pipe, so it
  // cannot move a cell.
  const rowLines = new Set(rewrittenRows.map((row) => row.line));
  const rewrittenLinks: RenameScopeRewrite[] = [];
  indexFile.lines.forEach((before, index) => {
    const line = index + 1;
    if (rowLines.has(line)) return;
    const after = reference.rewriteLinks(before, documentLinks[index] ?? []);
    if (after !== before) rewrittenLinks.push({ line, before, after });
  });

  // @req FR-NODE-232 AC-6 — the other files under docs/spec, the moved document's own self-links
  // included, so links check finds no new broken reference after the move.
  const otherFiles = await readOtherSpecFiles(root, indexFile.relativePath);
  const otherFileRewrites = otherFiles.map((file) => ({ file, rewrites: rewriteOtherFile(file, workspace.records.filter((record) => record.filePath === file.relativePath), fromPath, fromFile, toFile) }));
  const otherFileLinks: RenameScopeFileRewrite[] = otherFileRewrites.flatMap(({ file, rewrites }) =>
    rewrites.map((rewrite) => ({ file: file.relativePath === fromPath ? toPath : file.relativePath, ...rewrite }))
  );

  const output: RenameScopeOutput = { dryRun, from: fromPath, to: toPath, renumbered, written: false, rewrittenRows, rewrittenLinks, otherFileLinks };
  if (dryRun) return mutationOk(output);

  const absoluteFrom = path.join(root.root, ...fromPath.split("/"));
  // The moved document is patched at its new path, so its plan names that path.
  const plans = [
    createPatchPlan(indexFile, replaceLines([...rewrittenRows, ...rewrittenLinks])),
    ...otherFileRewrites
      .filter(({ rewrites }) => rewrites.length > 0)
      .map(({ file, rewrites }) => createPatchPlan(file.path === absoluteFrom ? { ...file, path: absoluteTo } : file, replaceLines(rewrites)))
  ];
  // @req FR-NODE-283 — the move is a step of the same transaction: a failure after it puts every patched
  // file back and then the document's old name, and a move-back that fails is reported naming it.
  await applyPatchPlans(plans, { dryRun: false, moves: [{ from: absoluteFrom, to: absoluteTo }] });
  return mutationOk({ ...output, written: true });
}

function replaceLines(rewrites: readonly RenameScopeRewrite[]): PatchOperation[] {
  return rewrites.map((rewrite) => ({ type: "replaceLine", line: rewrite.line, original: rewrite.before, replacement: rewrite.after }));
}

/** Every markdown file under docs/spec except the index, the document being moved included. */
async function readOtherSpecFiles(root: ProjectRoot, indexPath: string): Promise<TextFile[]> {
  const specDirectory = path.join(root.root, ...SPEC_DIR.split("/"));
  const entries = await readdir(specDirectory, { recursive: true, withFileTypes: true });
  const files = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
    .map((entry) => path.join(entry.parentPath, entry.name))
    .filter((filePath) => path.relative(root.root, filePath).split(path.sep).join("/") !== indexPath)
    .sort();
  return Promise.all(files.map((filePath) => readUtf8File(filePath, root.root)));
}

const RELATED_DOCS_ROW = /^\s*\|\s*Related Docs\s*\|/;

/**
 * Rewrites one file's references to the document: its markdown links (a Related Docs row resolved as
 * links check resolves it, every other link against the file's own directory) and the Trace Link
 * paths of the requirements it holds, read the way links check reads them.
 */
function rewriteOtherFile(
  file: TextFile,
  records: readonly RequirementRecord[],
  fromPath: string,
  fromFile: string,
  toFile: string
): RenameScopeRewrite[] {
  const documentLinks = findMarkdownLinksInDocument(file.lines);
  const directory = path.posix.dirname(file.relativePath);
  const reference = DocumentReference.forDocument(file.lines, (destination) => resolveRepositoryLink(destination, directory), fromPath, fromFile, toFile);
  const tracesByLine = new Map<number, TraceLink[]>();
  for (const record of records) {
    for (const trace of record.traceLinks) {
      if (trace.line === undefined || !traceLinkPaths(trace).some((target) => sameRepositoryPath(target, fromPath))) continue;
      tracesByLine.set(trace.line, [...(tracesByLine.get(trace.line) ?? []), trace]);
    }
  }
  const rewrites: RenameScopeRewrite[] = [];
  file.lines.forEach((before, index) => {
    const resolve = RELATED_DOCS_ROW.test(before) ? relatedDocsPath : undefined;
    let after = reference.rewriteLinks(before, documentLinks[index] ?? [], resolve);
    for (const trace of tracesByLine.get(index + 1) ?? []) {
      after = after.replace(trace.reference, () => renameTraceReference(trace.reference, fromPath, fromFile, toFile));
    }
    if (after !== before) rewrites.push({ line: index + 1, before, after });
  });
  return rewrites;
}

/** The Trace Link reference with each `;`-separated part that names the document renamed, suffixes kept. */
function renameTraceReference(reference: string, fromPath: string, fromFile: string, toFile: string): string {
  return reference
    .split(";")
    .map((part) => {
      const target = traceReferencePath(part);
      if (target === undefined || !sameRepositoryPath(target, fromPath)) return part;
      // The path ends in the file name; an anchor or line suffix after it is left as written.
      const at = part.indexOf(target) + target.length - fromFile.length;
      return `${part.slice(0, at)}${toFile}${part.slice(at + fromFile.length)}`;
    })
    .join(";");
}

/**
 * @req FR-NODE-232 AC-4/AC-5 — rules §5.2 rule 3 forbids renumbering, and rule 4 (SRS-W070) is the
 * one repair that needs it: a document whose number another scope document shares may move to the
 * number a new document would get. Each failed condition is named.
 */
function renumberRefusal(
  fromPath: string,
  fromNumber: number | undefined,
  toNumber: number,
  scopeDocuments: readonly string[],
  specDocuments: readonly string[]
): MutationResult<RenameScopeOutput> | undefined {
  const shared = scopeDocuments.some(
    (document) => document !== fromPath && leadingNumber(document.slice(document.lastIndexOf("/") + 1)) === fromNumber
  );
  const next = nextScopeDocumentNumber(scopeDocuments, specDocuments);
  const failures: { code: RenameScopeRefusal; message: string }[] = [];
  if (fromNumber === undefined || !shared) {
    failures.push({
      code: "SCOPE_RENAME_NUMBER_NOT_SHARED",
      message: `the current number ${fromNumber ?? "(none)"} is not shared with another scope document (SRS-W070)`
    });
  }
  if (toNumber !== next) {
    failures.push({
      code: "SCOPE_RENAME_NUMBER_NOT_NEXT",
      message: `the requested number ${toNumber} is not ${next}, one above the highest number in use`
    });
  }
  const [first] = failures;
  if (!first) return undefined;
  return refuse(first.code, `Renumbering ${fromPath} is refused: ${failures.map((failure) => failure.message).join("; ")}`);
}

function rewriteTableRows(
  indexFile: TextFile,
  table: ScopeIndexTable,
  reference: DocumentReference
): RenameScopeRowRewrite[] | MutationResult<RenameScopeOutput> {
  const documentColumn = scopeColumn(table.headers, "document");
  const rewrites: RenameScopeRowRewrite[] = [];
  for (const [index, row] of table.rows.entries()) {
    const cell = row[documentColumn] ?? "";
    if (!reference.matches(cell)) continue;
    const line = table.rowLines[index] ?? 0;
    const before = indexFile.lines[line - 1] ?? "";
    // A row with more cells than its header (an escaped pipe, a stray column) would lose them on re-render.
    if (splitTableRow(before).length !== table.headers.length) {
      return refuse("SCOPE_RENAME_ROW_UNPARSEABLE", `00.index.md line ${line} does not have one cell per ${table.section} column`);
    }
    const values = Object.fromEntries(
      table.headers.map((column) => [column, column === documentColumn ? reference.rewriteCell(cell) : reference.rewriteLinks(row[column] ?? "")])
    );
    const after = renderRowByHeader(table.headers, values);
    if (!after.ok) return refuse("SCOPE_RENAME_ROW_UNPARSEABLE", `00.index.md line ${line}: ${after.error.message}`);
    rewrites.push({ section: table.section, line, before, after: after.value });
  }
  return rewrites;
}

/**
 * The repository path an index link destination names. A destination is relative to docs/spec, as a
 * reader's renderer resolves it (`./x`, `x`, `../spec/x`), except one spelled from the repository
 * root (`docs/spec/x`), which the Scope Map parser has always accepted.
 */
function resolveIndexDestination(destination: string): string | undefined {
  const classified = classifyLinkDestination(destination);
  if (classified.kind === "local" && classified.path.startsWith(`${SPEC_DIR}/`)) return path.posix.normalize(classified.path);
  return resolveRepositoryLink(destination, SPEC_DIR);
}

type ResolveDestination = (destination: string) => string | undefined;

interface SpanEdit {
  start: number;
  end: number;
  value: string;
}

/** Recognises and rewrites one markdown document's references to one scope document. */
class DocumentReference {
  private readonly fileToken: RegExp;

  private constructor(
    private readonly fromPath: string,
    private readonly toFile: string,
    fromFile: string,
    /** How this document's link destinations resolve to repository paths. */
    private readonly resolve: ResolveDestination,
    /** Keys of the definitions that point at the document, so references through them are known. */
    private readonly definitionKeys: ReadonlySet<string>
  ) {
    // The whole file name only: `110.x.srs.md` or `10.x.srs.md.bak` is another document. Case is
    // ignored because reference keys ignore it: a label and its reference spelled in different case
    // must both change, or they stop matching.
    this.fileToken = new RegExp(`(?<![A-Za-z0-9_.-])${fromFile.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![A-Za-z0-9_-]|\\.[A-Za-z0-9])`, "gi");
  }

  static forDocument(lines: readonly string[], resolve: ResolveDestination, fromPath: string, fromFile: string, toFile: string): DocumentReference {
    const keys = new Set<string>();
    for (const [key, definition] of linkDefinitions(lines)) {
      if (sameRepositoryPath(resolve(definition.destination), fromPath)) keys.add(key);
    }
    return new DocumentReference(fromPath, toFile, fromFile, resolve, keys);
  }

  private targets(destination: string, resolve: ResolveDestination = this.resolve): boolean {
    return sameRepositoryPath(resolve(destination), this.fromPath);
  }

  /** A Document cell is either a markdown link or the bare path itself. */
  matches(cell: string): boolean {
    return this.rewriteLinks(cell) !== cell || this.targets(cell);
  }

  rewriteCell(cell: string): string {
    const rewritten = this.rewriteLinks(cell);
    return rewritten !== cell ? rewritten : this.renameIn(cell);
  }

  /**
   * Rewrites every link to the document that the shared extractor finds: the destination of an inline
   * link or definition, and the file name in the text or title of a link to it, including references through
   * a definition that points at it. A definition label is renamed together with the references that
   * use it, so the key still matches.
   */
  rewriteLinks(
    text: string,
    links: readonly MarkdownLink[] = findMarkdownLinksInDocument([text])[0] ?? [],
    resolve: ResolveDestination = this.resolve
  ): string {
    const edits: SpanEdit[] = [];
    for (const link of links) {
      // An autolink is a URI or an email address; it never names a scope document.
      if (link.kind === "autolink") continue;
      if (link.kind === "reference") {
        if (!this.definitionKeys.has(referenceKey((link.label ?? link.text).value))) continue;
        edits.push(this.renameTokens(link.text));
        if (link.label) edits.push(this.renameTokens(link.label));
      } else if (this.targets(link.destination.value, resolve)) {
        edits.push({ ...link.destination, value: this.renameIn(link.destination.value) });
        edits.push(this.renameTokens(link.kind === "inline" ? link.text : link.label));
        if (link.title) edits.push(this.renameTokens(link.title));
      }
    }
    // Right to left so earlier offsets stay valid; a span inside one already taken (a link nested in a
    // shortcut reference's brackets) is dropped rather than applied twice.
    let result = text;
    let limit = Number.POSITIVE_INFINITY;
    for (const edit of edits.sort((a, b) => b.start - a.start)) {
      if (edit.end > limit) continue;
      result = `${result.slice(0, edit.start)}${edit.value}${result.slice(edit.end)}`;
      limit = edit.start;
    }
    return result;
  }

  private renameTokens(text: TextSpan): SpanEdit {
    return { ...text, value: text.value.replace(this.fileToken, () => this.toFile) };
  }

  /** Swaps the destination's last path segment, keeping its directory part and any query or anchor. */
  private renameIn(destination: string): string {
    const suffixAt = destination.search(/[?#]/);
    const pathPart = suffixAt < 0 ? destination : destination.slice(0, suffixAt);
    const suffix = suffixAt < 0 ? "" : destination.slice(suffixAt);
    const slash = Math.max(pathPart.lastIndexOf("/"), pathPart.lastIndexOf("\\"));
    return `${pathPart.slice(0, slash + 1)}${this.toFile}${suffix}`;
  }
}

async function pathExists(filePath: string): Promise<boolean> {
  return access(filePath).then(
    () => true,
    () => false
  );
}
