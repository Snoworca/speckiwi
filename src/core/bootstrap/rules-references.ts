import { readFile, readdir, realpath } from "node:fs/promises";
import path from "node:path";
import { BUNDLED_RULES_VERSION, BUNDLED_SDS_RULES_VERSION } from "./templates.js";

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
  return match.token.replace(match.version, bundledVersionFor(match.family));
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
