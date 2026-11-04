import { readFile, readdir, realpath } from "node:fs/promises";
import path from "node:path";
import { findHeadingMatching, linesOutsideFences } from "../parser/index-parser.js";
import {
  classifyLinkDestination,
  findMarkdownLinksInDocument,
  linkDefinitions,
  referenceKey,
  resolveRepositoryLink,
  type InlineLink,
  type MarkdownLink,
  type ReferenceLink
} from "../parser/markdown-links.js";
import { findMetadataTableRange, isRulesMetadataRow } from "./index-metadata.js";
import {
  BUNDLED_RULES_VERSION,
  BUNDLED_SDS_RULES_VERSION,
  BUNDLED_SRS_RULES_FILENAME,
  renderIndexRulesRow,
  renderRulesReferenceEntry
} from "./templates.js";

// @req FR-NODE-091 @req IR-CLI-077
//
// A rules reference is written two ways, and both are load-bearing. The path form appears in links
// (`docs/rule/SRS-MD-Rules-v1.0.0.md`); the prose form appears in sentences (`the SRS-MD Authoring
// Rules v1.0.0`). Matching only the path form is the exact defect this repository shipped: the first
// sweep left every prose citation behind and needed a follow-up commit.
//
// This module only finds and rewrites references. Deciding *which* references are broken belongs to
// the caller, because the two callers disagree for good reasons: `doctor` asks what is on disk now,
// while `upgrade` asks what will be on disk after init has pruned the documents it no longer ships.

export type RulesReferenceFamily = "SRS" | "SDS";
export type RulesReferenceKind = "path" | "prose";

/** The agent instruction files the tool manages, and so the only files a migration rewrites. */
const MANAGED_AGENT_INSTRUCTION_FILES: readonly string[] = ["AGENTS.md", "agents.md", "CLAUDE.md"];

/** Directories under `docs/` that are never scanned: requirement bodies and the tool's own rules. */
const UNSCANNED_DOC_DIRECTORIES: readonly string[] = ["spec", "rule"];

const REFERENCE_PATTERN = /(SRS|SDS)-MD(?:-Rules-v(\d+\.\d+\.\d+)\.md|(\s+Authoring\s+Rules\s+v)(\d+\.\d+\.\d+))/g;

export interface RulesReferenceMatch {
  /** Workspace-relative POSIX path of the referencing file. */
  filePath: string;
  /** 1-based line the reference sits on. */
  line: number;
  /** `filePath:line` — the form a reader can paste into an editor. */
  location: string;
  /** The matched text exactly as it appears. */
  token: string;
  kind: RulesReferenceKind;
  family: RulesReferenceFamily;
  version: string;
  /** The rules document this reference implies, e.g. `SRS-MD-Rules-v1.0.0.md`. */
  document: string;
}

export interface RulesReferenceScan {
  /** Matches in the managed agent instruction files. */
  agentFiles: RulesReferenceMatch[];
  /** Matches elsewhere under `docs/`, excluding the unscanned directories. */
  otherDocs: RulesReferenceMatch[];
}

/** The bundled rules version for a family. */
export function bundledVersionFor(family: RulesReferenceFamily): string {
  return family === "SRS" ? BUNDLED_RULES_VERSION : BUNDLED_SDS_RULES_VERSION;
}

/** The rules document file name a family/version pair names. */
export function rulesDocumentName(family: RulesReferenceFamily, version: string): string {
  return `${family}-MD-Rules-v${version}.md`;
}

/** Counts lines across non-decreasing offsets, so one pass over the text serves every match. */
function lineCounter(text: string): (offset: number) => number {
  let scanned = 0;
  let line = 1;
  return (offset: number) => {
    for (; scanned < offset && scanned < text.length; scanned += 1) if (text[scanned] === "\n") line += 1;
    return line;
  };
}

interface RawMatch {
  line: number;
  token: string;
  kind: RulesReferenceKind;
  family: RulesReferenceFamily;
  version: string;
}

/**
 * Every distinct rules reference in the text, in reading order. Distinct means per line and token: a
 * markdown link whose text is the file name — `[SRS-MD-Rules-v1.0.0.md](docs/rule/SRS-MD-Rules-v1.0.0.md)`,
 * which is how this repository's own agent files are written — matches twice on one line, and one
 * rewrite fixes both, so reporting it twice would invent a second defect.
 */
function findMatches(text: string): RawMatch[] {
  const lineOf = lineCounter(text);
  const seen = new Set<string>();
  const found: RawMatch[] = [];
  for (const match of text.matchAll(REFERENCE_PATTERN)) {
    const family = match[1] as RulesReferenceFamily;
    const pathVersion = match[2];
    const proseVersion = match[4];
    const version = typeof pathVersion === "string" ? pathVersion : proseVersion;
    if (typeof version !== "string") continue;
    const line = lineOf(match.index);
    const key = `${line} ${match[0]}`;
    if (seen.has(key)) continue;
    seen.add(key);
    found.push({ line, token: match[0], kind: typeof pathVersion === "string" ? "path" : "prose", family, version });
  }
  return found;
}

export interface RulesReferenceRewrite {
  next: string;
  changes: Array<{ line: number; from: string; to: string; family: RulesReferenceFamily; kind: RulesReferenceKind; version: string }>;
}

function bundledToken(match: RawMatch): string {
  return match.token.replace(match.version, () => bundledVersionFor(match.family));
}

/**
 * Rewrites every reference the caller judges broken to the bundled version, substituting the matched
 * tokens in place and leaving every other byte alone — line endings included. Splitting on /\r?\n/ and
 * re-joining with one chosen terminator turns a one-token repair into a whole-file diff on any file
 * with mixed endings; the agent-block comparison documents that same trap.
 */
export function rewriteRulesReferences(text: string, isBroken: (document: string) => boolean): RulesReferenceRewrite {
  const changes: RulesReferenceRewrite["changes"] = [];
  const broken = new Map<string, RawMatch>();
  for (const match of findMatches(text)) {
    if (!isBroken(rulesDocumentName(match.family, match.version))) continue;
    broken.set(match.token, match);
    changes.push({
      line: match.line,
      from: match.token,
      to: bundledToken(match),
      family: match.family,
      kind: match.kind,
      version: match.version
    });
  }
  if (broken.size === 0) return { next: text, changes };
  const next = text.replace(REFERENCE_PATTERN, (token) => {
    const match = broken.get(token);
    return match === undefined ? token : bundledToken(match);
  });
  return { next, changes };
}

/** The index section the init template writes its rules entry into. */
const REFERENCE_DOCUMENTS_HEADING = /^##\s+(?:\d+\.\s+)?Reference Documents$/;

/** An ATX heading of level one or two, which ends the Reference Documents section. */
const SECTION_END_HEADING = /^ {0,3}#{1,2}\s/;

/** Which tool-owned pointers a document can hold: every SRS document has a metadata row; only the index has the entry. */
export type SpecDocumentRole = "index" | "srs";

export type RulesPointerKind = "metadata-row" | "reference-entry";

/** One SRS rules pointer the tool itself writes into an SRS document. */
export interface RulesPointer {
  /** 1-based line. */
  line: number;
  kind: RulesPointerKind;
  text: string;
  /** Every SRS rules version the line names as a file (`SRS-MD-Rules-vX.md`), backslash escapes undone. */
  versions: string[];
  /** Every version the line names as a title (`SRS-MD Authoring Rules vX`), backslash escapes undone. */
  labelVersions: string[];
  /** The inline link's destination, when the pointer is an inline link. */
  link?: string;
}

/** Every line a pointer occupies. A pointer is one line: only an inline link is the tool's form. */
export function rulesPointerLines(pointer: RulesPointer): number[] {
  return [pointer.line];
}

/** The line's first inline link that is not an image (an image shows a picture and links nowhere). */
function firstInlineLink(line: string, lineLinks: readonly MarkdownLink[]): InlineLink | undefined {
  return lineLinks.find((link): link is InlineLink => link.kind === "inline" && line[link.start - 1] !== "!");
}

/** The line with CommonMark backslash escapes undone, so an escaped file name reads as the name it is. */
function unescaped(line: string): string {
  return line.replace(/\\([!-/:-@[-`{-~])/g, "$1");
}

// @req FR-PARSE-044 AC-6 @req FR-NODE-085 AC-5
/**
 * The tool-owned SRS rules pointers in one SRS document — the forms the tool itself writes, and
 * nothing else:
 *   1. the Rules row of the `| Field | Value |` metadata table, unless it is written with a
 *      reference-style link. Init has always replaced that row whole, so a row of prose or an image is
 *      the tool's row with stale content; a reference-style row is the author's own form.
 *   2. in the index only, the rules entry inside its Reference Documents section: a list item that is
 *      one inline link naming the SRS rules by file or by title.
 * A reference-style row or entry is author text (Lead decision, round 11): whether its definition may
 * be removed depends on every other use in the document, which only a full CommonMark reading can
 * settle, so the tool neither rewrites it nor removes its definition, and validate tells the author
 * to fix it by hand. Fenced code is skipped throughout, anchors included.
 */
export function findRulesPointers(text: string, role: SpecDocumentRole): RulesPointer[] {
  return scanRulesLines(text, role).flatMap((found) => {
    if (found.form !== "owned") return [];
    const tokens = findMatches(unescaped(found.text)).filter((match) => match.family === "SRS");
    return [
      {
        line: found.line,
        kind: found.kind,
        text: found.text,
        versions: tokens.filter((match) => match.kind === "path").map((match) => match.version),
        labelVersions: tokens.filter((match) => match.kind === "prose").map((match) => match.version),
        ...(found.inline ? { link: found.inline.destination.value } : {})
      }
    ];
  });
}

/** A Rules row or a Reference Documents entry written as a reference-style link: author text. */
export interface ReferenceStyleRulesLine {
  /** 1-based line. */
  line: number;
  kind: RulesPointerKind;
  text: string;
  /** Where the link's definition sends it, when the document defines its label. */
  destination?: string;
  /** The 1-based line of that definition. */
  definitionLine?: number;
}

// @req FR-PARSE-044 AC-6
/**
 * The Rules rows and Reference Documents entries of one SRS document that are written as reference-style
 * links — the lines {@link findRulesPointers} leaves out as author text — each with the destination its
 * definition gives it. Validate reports one whose destination is a superseded rules file, so a stale
 * reference is never silent even where the definition sits in a section validate does not scan.
 */
export function findReferenceStyleRulesLines(text: string, role: SpecDocumentRole): ReferenceStyleRulesLine[] {
  const lines = text.split(/\r?\n/);
  // Validate runs this over every SRS document, so the full link scan is kept for a document that has a
  // line which could be one: a Rules row, or a list item, whose link text ends with `]`.
  const candidate = (line: string): boolean =>
    (isRulesMetadataRow(line) && /\]\s*\|\s*$/.test(line)) || (role === "index" && /^\s*-\s.*\]\s*$/.test(line));
  if (!lines.some(candidate)) return [];
  const definitions = linkDefinitions(lines);
  return scanRulesLines(text, role).flatMap((found) => {
    if (found.form !== "reference" || found.reference === undefined) return [];
    const defined = definitions.get(referenceKey((found.reference.label ?? found.reference.text).value));
    return [{ line: found.line, kind: found.kind, text: found.text, ...(defined ? { destination: defined.destination, definitionLine: defined.startLine } : {}) }];
  });
}

/**
 * Whether a reference-style rules line already leads to the bundled rules: its text names the bundled
 * file, or its definition resolves, from the line's own document, to the bundled file. Only such a line
 * goes unreported; the tool does not manage reference-style links, so any other one is the author's to check.
 */
export function referenceStyleRulesLinePointsAtBundled(found: ReferenceStyleRulesLine, filePath: string): boolean {
  if (found.text.includes(BUNDLED_SRS_RULES_FILENAME)) return true;
  return found.destination !== undefined && resolveRepositoryLink(found.destination, path.posix.dirname(filePath)) === BUNDLED_SRS_RULES_PATH;
}

/** One candidate rules line: owned (the tool's form) or reference-style (the author's). */
interface RulesLine {
  line: number;
  kind: RulesPointerKind;
  text: string;
  form: "owned" | "reference";
  inline?: InlineLink;
  reference?: ReferenceLink;
}

/**
 * The one reader of which lines are rules lines, shared by the pointer scan and the author-text scan so
 * the two can never disagree about a line: the metadata table's Rules row, and in the index the rules
 * entry of its Reference Documents section. Fenced code is skipped throughout, anchors included.
 */
function scanRulesLines(text: string, role: SpecDocumentRole): RulesLine[] {
  const lines = text.split(/\r?\n/);
  const outside = linesOutsideFences(lines);
  // Anchored to the `| Field | Value |` table: a two-cell `| Rules | ... |` row elsewhere is an
  // author's glossary entry, and replacing it destroys it with validation still clean.
  const metadata = findMetadataTableRange(lines);
  const referenceHeading = role === "index" ? findHeadingMatching(lines, REFERENCE_DOCUMENTS_HEADING) : -1;
  const links = findMarkdownLinksInDocument(lines);
  const found: RulesLine[] = [];
  let inReferenceSection = false;
  lines.forEach((line, index) => {
    if (outside[index] !== true) return;
    if (index === referenceHeading) {
      inReferenceSection = true;
      return;
    }
    if (inReferenceSection && SECTION_END_HEADING.test(line)) inReferenceSection = false;
    const lineLinks = links[index] ?? [];
    const inline = firstInlineLink(line, lineLinks);
    const reference = lineLinks.find((link): link is ReferenceLink => link.kind === "reference" && line[link.start - 1] !== "!");
    const inMetadata = metadata !== undefined && index >= metadata.first && index <= metadata.last;
    const base = { line: index + 1, text: line, ...(inline ? { inline } : {}) };
    if (inMetadata && isRulesMetadataRow(line)) {
      found.push(inline !== undefined || reference === undefined
        ? { ...base, kind: "metadata-row", form: "owned" }
        : { ...base, kind: "metadata-row", form: "reference", reference });
      return;
    }
    if (!inReferenceSection) return;
    if (isRulesEntry(line, inline)) found.push({ ...base, kind: "reference-entry", form: "owned" });
    else if (inline === undefined && reference !== undefined && isRulesReferenceEntry(line, reference)) {
      found.push({ ...base, kind: "reference-entry", form: "reference", reference });
    }
  });
  return found;
}

/** An index list item that is one reference-style link, naming the SRS rules in its text. */
function isRulesReferenceEntry(line: string, reference: ReferenceLink): boolean {
  if (line.slice(0, reference.start).trim() !== "-" || line.slice(reference.end).trim() !== "") return false;
  return findMatches(unescaped(line)).some((match) => match.family === "SRS");
}

/** An index list item that is one inline link, naming the SRS rules by its file or by its title. */
function isRulesEntry(line: string, inline: InlineLink | undefined): boolean {
  if (inline === undefined || line.slice(0, inline.start).trim() !== "-" || line.slice(inline.end).trim() !== "") return false;
  return findMatches(`${unescaped(line)}\n${classifiedPath(inline.destination.value) ?? ""}`).some((match) => match.family === "SRS");
}

/** A local link destination's path, escapes and percent-encoding undone by the shared reader. */
function classifiedPath(destination: string): string | undefined {
  const classified = classifyLinkDestination(destination);
  return classified.kind === "local" ? classified.path : undefined;
}

/** The index's workspace-relative path; the only document that holds the Reference Documents entry. */
const SPEC_INDEX_PATH = "docs/spec/00.index.md";

/** Where init installs the bundled SRS rules, workspace-relative. */
const BUNDLED_SRS_RULES_PATH = `docs/rule/${BUNDLED_SRS_RULES_FILENAME}`;

/** The role of an SRS document, from its workspace-relative POSIX path. */
export function specDocumentRole(filePath: string): SpecDocumentRole {
  return filePath === SPEC_INDEX_PATH ? "index" : "srs";
}

/** The link from an SRS document's own directory to the bundled rules document. */
function rulesLinkFrom(filePath: string): string {
  return path.posix.relative(path.posix.dirname(filePath), BUNDLED_SRS_RULES_PATH);
}

// @req FR-PARSE-044 AC-6
/**
 * Whether a tool-owned pointer must be rewritten — the one verdict doctor's warning, upgrade's rewrite
 * and validate's guidance all come from, so the three agree by definition. A pointer needs a refresh
 * when it has no link, when its link does not resolve from its own document to the bundled rules file,
 * or when any rules file or title anywhere in the line names a version other than the bundled one (the
 * rewrite replaces the whole line, so one stale token is enough). Where the link leads is read by the
 * shared destination reader, so an escaped or percent-encoded file name that names the bundled file is
 * current; the version tokens are read with backslash escapes undone. Resolution is judged against the
 * installed set init leaves (the bundled file only), not against the disk, because upgrade decides
 * before init has refreshed `docs/rule`. A pointer that already says all of that is left alone even if
 * its spacing differs from the template.
 */
export function pointerNeedsRefresh(pointer: RulesPointer, filePath: string): boolean {
  if (pointer.link === undefined) return true;
  if (resolveRepositoryLink(pointer.link, path.posix.dirname(filePath)) !== BUNDLED_SRS_RULES_PATH) return true;
  return [...pointer.versions, ...pointer.labelVersions].some((version) => version !== BUNDLED_RULES_VERSION);
}

/** The line a pointer should read, linking from its own document to the bundled rules. */
function renderPointer(kind: RulesPointerKind, rulesLink: string): string {
  return kind === "metadata-row" ? renderIndexRulesRow(rulesLink) : renderRulesReferenceEntry(rulesLink);
}

export interface RulesPointerRefresh {
  next: string;
  /** Each changed line, 1-based, with its old and new content. */
  changes: Array<{ line: number; from: string; to: string }>;
}

/** Rewrites the pointers of one document that need it, each to its rendered line. Line endings survive. */
function refreshPointers(text: string, filePath: string, include: (pointer: RulesPointer) => boolean): RulesPointerRefresh {
  const parts = text.split(/(\r?\n)/);
  const rulesLink = rulesLinkFrom(filePath);
  const changes: RulesPointerRefresh["changes"] = [];
  for (const pointer of findRulesPointers(text, specDocumentRole(filePath))) {
    if (!include(pointer) || !pointerNeedsRefresh(pointer, filePath)) continue;
    const desired = renderPointer(pointer.kind, rulesLink);
    if (pointer.text === desired) continue;
    parts[(pointer.line - 1) * 2] = desired;
    changes.push({ line: pointer.line, from: pointer.text, to: desired });
  }
  return { next: parts.join(""), changes };
}

// @req FR-PARSE-044 AC-6
/** Points every tool-owned rules pointer of one SRS document that needs it at the bundled rules. */
export function refreshRulesPointers(text: string, filePath: string): RulesPointerRefresh {
  return refreshPointers(text, filePath, () => true);
}

// @req FR-NODE-085 AC-4 @req FR-NODE-085 AC-5
/**
 * The index's metadata Rules row alone. A plain init may change that one row of the index and no
 * other line, so it uses this rather than {@link refreshRulesPointers}.
 */
export function refreshRulesMetadataRow(text: string): RulesPointerRefresh {
  return refreshPointers(text, SPEC_INDEX_PATH, (pointer) => pointer.kind === "metadata-row");
}

/** A tool-owned pointer in one SRS document, with the verdict on it. */
export interface SpecRulesPointer extends RulesPointer {
  /** Workspace-relative POSIX path of the document. */
  filePath: string;
  needsRefresh: boolean;
}

// @req FR-PARSE-044 AC-6
/**
 * Every tool-owned rules pointer in the SRS documents the parser reads — the index, the scope
 * documents, the completed-work sidecar (05.completed-work.md) and the appendix — with its verdict.
 * The completed-work history file (91.completed-work-log.md), a step SDS and any other markdown under
 * `docs/spec` are not in that set, so a Rules row in one (an SDS rules row, say) is not this tool's
 * SRS pointer. Doctor warns on, and upgrade rewrites, exactly the pointers marked here.
 */
export function scanSpecRulesPointers(files: ReadonlyArray<{ relativePath: string; lines: readonly string[] }>): SpecRulesPointer[] {
  return files.flatMap((file) =>
    findRulesPointers(file.lines.join("\n"), specDocumentRole(file.relativePath)).map((pointer) => ({
      ...pointer,
      filePath: file.relativePath,
      needsRefresh: pointerNeedsRefresh(pointer, file.relativePath)
    }))
  );
}

function toMatches(filePath: string, text: string): RulesReferenceMatch[] {
  return findMatches(text).map((match) => ({
    filePath,
    line: match.line,
    location: `${filePath}:${match.line}`,
    token: match.token,
    kind: match.kind,
    family: match.family,
    version: match.version,
    document: rulesDocumentName(match.family, match.version)
  }));
}

async function readOrUndefined(target: string): Promise<string | undefined> {
  try {
    return await readFile(target, "utf8");
  } catch {
    return undefined;
  }
}

/**
 * The managed agent files that exist, deduplicated by their real path. On Windows `AGENTS.md` and
 * `agents.md` are one physical file — this repository tracks both spellings — and reporting the same
 * line twice would read as two defects. On a case-sensitive filesystem they are genuinely two files
 * and both are returned.
 */
async function existingAgentFiles(rootPath: string): Promise<Array<{ relativePath: string; absolutePath: string }>> {
  const seen = new Set<string>();
  const files: Array<{ relativePath: string; absolutePath: string }> = [];
  for (const name of MANAGED_AGENT_INSTRUCTION_FILES) {
    const absolutePath = path.join(rootPath, name);
    const identity = await realpath(absolutePath).catch(() => undefined);
    if (identity === undefined) continue;
    const key = process.platform === "win32" ? identity.toLowerCase() : identity;
    if (seen.has(key)) continue;
    seen.add(key);
    files.push({ relativePath: name, absolutePath });
  }
  return files;
}
/** Every markdown file under `docs/`, excluding the unscanned directories. */
async function docFiles(rootPath: string): Promise<string[]> {
  const docsRoot = path.join(rootPath, "docs");
  const found: string[] = [];
  async function walk(dir: string): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        const relative = path.relative(docsRoot, full).replace(/\\/g, "/");
        if (UNSCANNED_DOC_DIRECTORIES.includes(relative)) continue;
        await walk(full);
      } else if (entry.isFile() && entry.name.endsWith(".md")) {
        found.push(full);
      }
    }
  }
  await walk(docsRoot);
  return found;
}

/**
 * Rules references in the managed agent instruction files only — the set a migration rewrites, and the
 * only set `doctor` reports. Kept separate from the full scan so a diagnosis does not read every
 * markdown file under `docs/` to discard the result.
 */
export async function scanAgentFileRulesReferences(rootPath: string): Promise<RulesReferenceMatch[]> {
  const matches: RulesReferenceMatch[] = [];
  for (const file of await existingAgentFiles(rootPath)) {
    const text = await readOrUndefined(file.absolutePath);
    if (text !== undefined) matches.push(...toMatches(file.relativePath, text));
  }
  return matches;
}

/** Finds every rules reference in the managed agent files and elsewhere under `docs/`. */
export async function scanRulesReferences(rootPath: string): Promise<RulesReferenceScan> {
  const otherDocs: RulesReferenceMatch[] = [];
  for (const absolutePath of await docFiles(rootPath)) {
    const text = await readOrUndefined(absolutePath);
    if (text === undefined) continue;
    otherDocs.push(...toMatches(path.relative(rootPath, absolutePath).replace(/\\/g, "/"), text));
  }
  return { agentFiles: await scanAgentFileRulesReferences(rootPath), otherDocs };
}
