import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolveInsideRoot, toPosixPath } from "../fs/safe-path.js";
import { mutationFail } from "../mutation/guards.js";
import type { MutationResult, ProjectRoot } from "../types.js";
import { appendWorkflowJsonl, parseWorkflowJsonl, type AppendWorkflowJsonlOutput } from "./jsonl.js";

// @req FR-FLOW-136 — the heading-keyed, content-hash verification ledger.
//
// The ledger exists so a review round reads what changed instead of the whole document. Two design
// decisions carry that:
//
//   1. The unit is the heading-section. A diff hunk's line numbers shift under any edit above it, so
//      a hunk key is unstable; a heading has an identity a document keeps across reflows.
//   2. The clean/dirty decision is a WHITELIST gate, exactly as `listDirtyEdges` (query/summary.ts)
//      classifies compatibility edges: clean only when every condition holds, everything else dirty.
//      There is no blacklist path, because a condition nobody thought to blacklist would otherwise
//      read as clean — and the two failure directions are not symmetric here. Re-verifying an
//      unchanged section costs tokens; skipping a changed one is a false verification.
export const VERIFICATION_LEDGER_PATH = "kiwi/verification-ledger.jsonl";

/**
 * Frozen-protocol tag for the section hash, the same device `computeSemanticSha` uses: the hash
 * input is bound to the tag so the normalizer can change under a new tag rather than silently
 * reclassifying every previously recorded section as clean.
 */
const VLV1 = "vlv=1";

/** The tag a ledger entry must carry to be eligible for clean. */
export const VERIFICATION_LEDGER_FPV = "vlv1";

const LEDGER_SCHEMA_VERSION = "1.0.0";
const LEDGER_SKILL = "kiwi-review-fix-loop";
/** NUL, escaped rather than literal: a raw NUL byte in a source file defeats plain grep. */
const KEY_SEPARATOR = "\u0000";
const HEADING_PATH_SEPARATOR = " > ";
const DEFAULT_CONTEXT_LINES = 3;

/** Text ahead of the first heading. Dropping it would leave a document's opening permanently unread. */
export const PREAMBLE_KEY = "(preamble)";

/**
 * Whitespace-collapse and nothing else.
 *
 * `computeSemanticSha`'s normalizer additionally drops metadata keys and AC checked-state, which is
 * right for a structured record and wrong for prose: in prose every surviving character is content,
 * so a normalizer that stripped markdown or punctuation would make two genuinely different sentences
 * hash alike and the difference would never be re-verified.
 */
function normalizeProse(text: string): string {
  return text.replace(/\r\n/g, "\n").replace(/\s+/g, " ").trim();
}

/** sha1 over the fpv tag joined with the normalized section body. */
export function computeSectionSha(body: string): string {
  return createHash("sha1").update(`${VLV1}${normalizeProse(body)}`, "utf8").digest("hex");
}

export interface DocumentSection {
  /** The heading path, ancestors first: `Guide > Install`. The section's identity. */
  readonly key: string;
  /** The heading's own text, without its `#` run. */
  readonly heading: string;
  /** 1 through 6; 0 for the preamble. */
  readonly level: number;
  /** 1-based line of the heading, or 1 for the preamble. */
  readonly startLine: number;
  /** 1-based last line of the section's own body, inclusive. */
  readonly endLine: number;
  /** The section's own text: the heading line excluded, descendant sections excluded. */
  readonly body: string;
  readonly sha: string;
}

interface HeadingRow {
  readonly index: number;
  readonly level: number;
  readonly text: string;
}

/** Heading rows, with fenced blocks masked so a `# comment` inside a shell example is not a heading. */
function headingRows(rows: readonly string[]): HeadingRow[] {
  const headings: HeadingRow[] = [];
  let fenced = false;
  rows.forEach((row, index) => {
    if (/^\s*(```|~~~)/.test(row)) {
      fenced = !fenced;
      return;
    }
    if (fenced) return;
    const match = /^(#{1,6})\s+(.*)$/.exec(row);
    if (match) headings.push({ index, level: match[1]!.length, text: match[2]!.trim() });
  });
  return headings;
}

/**
 * Splits a Markdown document into heading-keyed sections.
 *
 * A section owns only its own text — a child's edit must not dirty its parent, or a document with
 * one top heading would re-verify entirely on every change and the ledger would buy nothing.
 */
export function splitDocumentSections(markdown: string): DocumentSection[] {
  const rows = markdown.replace(/\r\n/g, "\n").split("\n");
  const headings = headingRows(rows);
  const sections: DocumentSection[] = [];

  const build = (key: string, heading: string, level: number, startLine: number, from: number, to: number): void => {
    const bodyRows = to >= from ? rows.slice(from, to + 1) : [];
    const body = bodyRows.join("\n");
    sections.push({
      key,
      heading,
      level,
      startLine,
      endLine: to >= from ? to + 1 : startLine,
      body,
      sha: computeSectionSha(body)
    });
  };

  const firstHeading = headings[0]?.index ?? rows.length;
  if (rows.slice(0, firstHeading).some((row) => row.trim().length > 0)) {
    build(PREAMBLE_KEY, PREAMBLE_KEY, 0, 1, 0, firstHeading - 1);
  }

  const chain: string[] = [];
  headings.forEach((heading, position) => {
    chain.length = Math.max(0, heading.level - 1);
    chain[heading.level - 1] = heading.text;
    const key = chain.filter((part) => typeof part === "string" && part.length > 0).join(HEADING_PATH_SEPARATOR);
    const next = headings[position + 1]?.index ?? rows.length;
    build(key, heading.text, heading.level, heading.index + 1, heading.index + 1, next - 1);
  });

  return sections;
}

export interface LedgerEntry {
  readonly doc: string;
  readonly key: string;
  readonly sha: string;
  readonly verifier: string;
  readonly round: number;
  readonly fpv: string;
  /** 1-based line in the ledger file the entry was read from. */
  readonly line: number;
}

export interface LedgerState {
  /** Live entries keyed `doc\0key`. A pruned key is absent; the line that recorded it still is not. */
  readonly live: Map<string, LedgerEntry>;
}

/**
 * The one spelling a document is keyed by.
 *
 * A caller types whatever separator its platform gave it, and `docs\guide.md` keyed verbatim is a
 * different document from `docs/guide.md` — under which every section reads dirty forever. That is
 * the fail-open direction, so nothing would report it; the ledger would just never save anything.
 */
function docKey(doc: string): string {
  return toPosixPath(doc);
}

function stateKey(doc: string, key: string): string {
  return `${docKey(doc)}${KEY_SEPARATOR}${key}`;
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/**
 * Folds the append-only journal into the live state.
 *
 * A later `section_verified` supersedes an earlier one for the same key, and a `section_pruned`
 * removes it. Nothing is rewritten: prune is an appended record, so the file only ever grows and an
 * earlier pass's bytes stay readable.
 */
export async function readVerificationLedger(
  root: ProjectRoot,
  relativePath: string = VERIFICATION_LEDGER_PATH
): Promise<{ entries: LedgerEntry[]; state: LedgerState }> {
  const parsed = await parseWorkflowJsonl(root, relativePath, {
    // Many lines per key is the contract here, so a repeated `${skill}|${run_id}` is not a defect.
    eventKeying: "none"
  });
  const entries: LedgerEntry[] = [];
  const live = new Map<string, LedgerEntry>();
  for (const parsedEntry of parsed.entries) {
    const event = parsedEntry.event;
    const doc = docKey(asString(event.doc));
    if (doc === "") continue;
    if (event.event === "section_verified") {
      const entry: LedgerEntry = {
        doc,
        key: asString(event.key),
        sha: asString(event.sha),
        verifier: asString(event.verifier),
        round: typeof event.round === "number" ? event.round : Number.NaN,
        fpv: asString(event.fpv),
        line: parsedEntry.line
      };
      if (entry.key === "") continue;
      entries.push(entry);
      live.set(stateKey(entry.doc, entry.key), entry);
      continue;
    }
    if (event.event === "section_pruned" && Array.isArray(event.keys)) {
      for (const key of event.keys) {
        if (typeof key === "string") live.delete(stateKey(doc, key));
      }
    }
  }
  return { entries, state: { live } };
}

export type SectionClassification = "clean" | "dirty";

export interface SectionVerdict {
  readonly key: string;
  readonly classification: SectionClassification;
  readonly reason?: string;
  readonly startLine: number;
  readonly endLine: number;
  readonly sha: string;
}

/**
 * The whitelist gate, in `listDirtyEdges`'s shape: clean only when every condition holds.
 *
 * The duplicate-key condition is first because it is the one that cannot be repaired by re-reading —
 * when two sections share a heading path, no entry can be attributed to either, so both are dirty.
 */
export function classifySections(
  doc: string,
  sections: readonly DocumentSection[],
  state: LedgerState
): SectionVerdict[] {
  const occurrences = new Map<string, number>();
  for (const section of sections) occurrences.set(section.key, (occurrences.get(section.key) ?? 0) + 1);

  return sections.map((section) => {
    const entry = state.live.get(stateKey(doc, section.key));
    const reason = ((): string | undefined => {
      if ((occurrences.get(section.key) ?? 0) !== 1) return "heading key occurs more than once in the document";
      if (entry === undefined) return "no live ledger entry for this heading key";
      if (entry.fpv !== VERIFICATION_LEDGER_FPV) return `ledger entry fpv is not ${VERIFICATION_LEDGER_FPV}`;
      if (entry.sha !== section.sha) return "section body hash differs from the ledger";
      if (entry.verifier.trim().length === 0) return "ledger entry carries no verifier identity";
      if (!Number.isInteger(entry.round) || entry.round < 1) return "ledger entry carries no round";
      return undefined;
    })();

    return reason === undefined
      ? { key: section.key, classification: "clean" as const, startLine: section.startLine, endLine: section.endLine, sha: section.sha }
      : { key: section.key, classification: "dirty" as const, reason, startLine: section.startLine, endLine: section.endLine, sha: section.sha };
  });
}

export interface SectionPlan extends SectionVerdict {
  /** The section plus surrounding context. Present for dirty sections only — a clean one is not sent. */
  readonly payload?: string;
}

export interface VerificationRoundPlan {
  readonly doc: string;
  readonly round: number;
  readonly ledgerPath: string;
  readonly sections: SectionPlan[];
  /** Dirty keys, document order, deduplicated. */
  readonly sent: string[];
  /** Clean keys, document order, deduplicated. */
  readonly skipped: string[];
  /** Ledger keys whose heading no longer exists, pruned by this pass. */
  readonly pruned: string[];
  readonly stats: { total: number; dirty: number; clean: number };
}

export interface PlanVerificationRoundOptions {
  readonly doc: string;
  readonly round: number;
  readonly contextLines?: number;
  /** Off only for a caller that wants to inspect the classification without writing. */
  readonly prune?: boolean;
  readonly runId?: string;
}

function payloadFor(rows: readonly string[], section: SectionVerdict, contextLines: number): string {
  const from = Math.max(0, section.startLine - 1 - contextLines);
  const to = Math.min(rows.length, section.endLine + contextLines);
  return rows.slice(from, to).join("\n");
}

async function readDocument(root: ProjectRoot, doc: string): Promise<string> {
  const absolute = await resolveInsideRoot(root.root, doc);
  return readFile(absolute, "utf8");
}

/**
 * Classifies one document against the ledger and returns what this round must send.
 *
 * Orphan pruning happens here rather than in a separate verb because an orphan is only observable
 * against a freshly parsed document, which is exactly what this pass already holds.
 */
export async function planVerificationRound(
  root: ProjectRoot,
  options: PlanVerificationRoundOptions
): Promise<VerificationRoundPlan> {
  const text = await readDocument(root, options.doc);
  const rows = text.replace(/\r\n/g, "\n").split("\n");
  const sections = splitDocumentSections(text);
  const { state } = await readVerificationLedger(root);

  const doc = docKey(options.doc);
  const present = new Set(sections.map((section) => section.key));
  const orphans: string[] = [];
  for (const [key, entry] of state.live) {
    if (!key.startsWith(`${doc}${KEY_SEPARATOR}`)) continue;
    if (!present.has(entry.key)) orphans.push(entry.key);
  }
  if (orphans.length > 0 && options.prune !== false) {
    await appendWorkflowJsonl(
      root,
      VERIFICATION_LEDGER_PATH,
      {
        schema_version: LEDGER_SCHEMA_VERSION,
        skill: LEDGER_SKILL,
        event: "section_pruned",
        fpv: VERIFICATION_LEDGER_FPV,
        doc,
        keys: orphans,
        round: options.round,
        ...(options.runId ? { run_id: options.runId } : {}),
        ts: new Date().toISOString()
      },
      { eventKeying: "none", policy: "best-effort" }
    );
    for (const key of orphans) state.live.delete(stateKey(doc, key));
  }

  const contextLines = options.contextLines ?? DEFAULT_CONTEXT_LINES;
  const verdicts = classifySections(doc, sections, state);
  const plans: SectionPlan[] = verdicts.map((verdict) =>
    verdict.classification === "dirty" ? { ...verdict, payload: payloadFor(rows, verdict, contextLines) } : verdict
  );

  const collect = (classification: SectionClassification): string[] => [
    ...new Set(plans.filter((plan) => plan.classification === classification).map((plan) => plan.key))
  ];
  const sent = collect("dirty");
  const skipped = collect("clean");

  return {
    doc,
    round: options.round,
    ledgerPath: VERIFICATION_LEDGER_PATH,
    sections: plans,
    sent,
    skipped,
    pruned: options.prune === false ? [] : orphans,
    stats: { total: plans.length, dirty: sent.length, clean: skipped.length }
  };
}

export interface RecordSectionVerifiedOptions {
  readonly doc: string;
  readonly key: string;
  readonly verifier: string;
  readonly round: number;
  readonly runId?: string;
  readonly dryRun?: boolean;
}

/**
 * Appends one verified-section record, hashing the section as it stands on disk.
 *
 * The caller supplies the key and the identity, never the hash: a caller-supplied hash is a caller
 * assertion that the section it read is the section that is there, which is the assertion the ledger
 * exists to make on its own.
 */
export async function recordSectionVerified(
  root: ProjectRoot,
  options: RecordSectionVerifiedOptions
): Promise<MutationResult<AppendWorkflowJsonlOutput>> {
  const verifier = options.verifier.trim();
  if (verifier.length === 0) {
    return mutationFail("USAGE", "verifier identity must not be blank");
  }
  if (!Number.isInteger(options.round) || options.round < 1) {
    return mutationFail("USAGE", "round must be an integer of 1 or more");
  }
  const sections = splitDocumentSections(await readDocument(root, options.doc));
  const matches = sections.filter((section) => section.key === options.key);
  if (matches.length === 0) {
    return mutationFail("USAGE", `document ${options.doc} carries no section keyed ${options.key}`);
  }
  if (matches.length > 1) {
    return mutationFail("USAGE", `document ${options.doc} carries ${matches.length} sections keyed ${options.key}`);
  }

  return appendWorkflowJsonl(
    root,
    VERIFICATION_LEDGER_PATH,
    {
      schema_version: LEDGER_SCHEMA_VERSION,
      skill: LEDGER_SKILL,
      event: "section_verified",
      fpv: VERIFICATION_LEDGER_FPV,
      doc: docKey(options.doc),
      key: options.key,
      sha: matches[0]!.sha,
      verifier,
      round: options.round,
      ...(options.runId ? { run_id: options.runId } : {}),
      ts: new Date().toISOString()
    },
    { eventKeying: "none", policy: "best-effort", dryRun: options.dryRun ?? false }
  );
}
