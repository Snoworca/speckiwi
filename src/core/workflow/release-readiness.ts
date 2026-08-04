import { existsSync, realpathSync } from "node:fs";
import path from "node:path";
import type {
  AcceptedResidueEntry,
  AcCoverageGap,
  CommandEvidencePolicyViolation,
  DiagnosticsSummary,
  EvidenceReferenceIssue,
  EvidenceRow,
  ParsedWorkspace,
  ReleaseReadinessSummary,
  RequirementRecord,
  ValidationResult
} from "../types.js";
import { resolveTargetSelection } from "../query/summary.js";
import { validateWorkspace } from "../validator/validate-workspace.js";

export type { DiagnosticsSummary, ReleaseReadinessSummary } from "../types.js";

export interface TraceabilityCoverage {
  total: number;
  covered: number;
  coveragePercent: number;
  missing: string[];
}

export function formatDiagnosticsSummary(result: ValidationResult): DiagnosticsSummary {
  const byCode: Record<string, number> = {};
  for (const diagnostic of result.diagnostics) {
    byCode[diagnostic.code] = (byCode[diagnostic.code] ?? 0) + 1;
  }
  return { errors: result.errors.length, warnings: result.warnings.length, byCode };
}

function coveredAcIds(row: EvidenceRow): Set<string> {
  return new Set(
    row.covers
      .split(/[,\s;]+/)
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean)
  );
}

function coversAcceptanceCriterion(row: EvidenceRow, acId: string): boolean {
  const covered = coveredAcIds(row);
  return covered.has("all") || covered.has(acId.toLowerCase());
}

export function collectAcCoverageGaps(records: RequirementRecord[]): AcCoverageGap[] {
  const gaps: AcCoverageGap[] = [];
  for (const record of records) {
    if (record.status !== "verified") continue;
    const missingAcIds = record.acceptanceCriteria
      .filter((criterion) => !criterion.checked || !record.verificationEvidence.some((row) => coversAcceptanceCriterion(row, criterion.id)))
      .map((criterion) => criterion.id);
    if (missingAcIds.length > 0) {
      gaps.push({ requirementId: record.id, missingAcIds });
    }
  }
  return gaps;
}

function fullMarkdownLinkTarget(value: string): string {
  const match = /^\[[^\]]+]\(([^)]+)\)$/.exec(value.trim());
  return match?.[1] ?? value.trim();
}

function splitEvidenceReferences(row: EvidenceRow): string[] {
  const reference = row.reference.trim();
  if (reference === "") return [];
  return reference
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean);
}

function evidenceType(row: EvidenceRow): string {
  return row.type.trim().toLowerCase();
}

function isCommandReference(row: EvidenceRow, reference: string): boolean {
  const type = evidenceType(row);
  const normalized = reference.trim().replace(/^\$\s*/, "");
  return type === "command" || type === "cmd" || type === "shell" || reference.trim().startsWith("$") || /^(npm|npx|node|pnpm|yarn|vitest|tsc|python|python3|bash|sh|pwsh|powershell|make|git|go|cargo|pytest|uv)\b/.test(normalized);
}

function isUrlReference(row: EvidenceRow, reference: string): boolean {
  const type = evidenceType(row);
  return type === "url" || type === "link" || /^https?:\/\//i.test(fullMarkdownLinkTarget(reference));
}

function isValidHttpUrl(reference: string): boolean {
  try {
    const url = new URL(fullMarkdownLinkTarget(reference));
    return (url.protocol === "http:" || url.protocol === "https:") && url.hostname.length > 0;
  } catch {
    return false;
  }
}

function isPathLikeReference(row: EvidenceRow, reference: string): boolean {
  const type = evidenceType(row);
  const value = fullMarkdownLinkTarget(reference);
  return (
    type === "file" ||
    type === "path" ||
    type === "test" ||
    type === "inspection" ||
    type === "artifact" ||
    value.startsWith("./") ||
    value.startsWith("../") ||
    path.isAbsolute(value) ||
    value.includes("/") ||
    value.includes("\\") ||
    /\.[A-Za-z0-9]{1,8}$/.test(value)
  );
}

function localEvidencePath(root: string, reference: string): string {
  let candidate = fullMarkdownLinkTarget(reference).replace(/#.*$/, "");
  if (!path.isAbsolute(candidate)) {
    candidate = candidate.replace(/:\d+(?::\d+)?$/, "");
  }
  return path.resolve(root, candidate);
}

function isUnderRoot(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function realPathIfExists(candidate: string): string | undefined {
  try {
    return realpathSync(candidate);
  } catch {
    return undefined;
  }
}

function evidenceReferenceIssue(record: RequirementRecord, row: EvidenceRow, reference: string, issue: string): EvidenceReferenceIssue {
  const result: EvidenceReferenceIssue = { requirementId: record.id, reference, issue };
  if (row.id.trim()) result.evidenceId = row.id;
  return result;
}

/**
 * @req FR-NODE-174 — one requirement's evidence references, judged by the rule release readiness
 * applies. Extracted so the `verified` transition consults this rule instead of carrying a second
 * copy of it: a reference the two gates classified differently would let a row reach `verified` and
 * then be reported unresolvable, at which point granular edits are refused and it cannot be repaired.
 *
 * Takes a record rather than a workspace because the transition asks about a requirement that is not
 * `verified` yet — the status filter belongs to the caller, not to the rule.
 */
export function collectEvidenceReferenceIssuesForRecord(projectRoot: string, record: RequirementRecord): EvidenceReferenceIssue[] {
  const issues: EvidenceReferenceIssue[] = [];
  const root = realPathIfExists(path.resolve(projectRoot)) ?? path.resolve(projectRoot);
  for (const row of record.verificationEvidence) {
    if (row.reference.trim() === "") {
      issues.push(evidenceReferenceIssue(record, row, row.reference, "empty"));
      continue;
    }
    for (const reference of splitEvidenceReferences(row)) {
      if (isCommandReference(row, reference)) continue;
      if (isUrlReference(row, reference)) {
        if (!isValidHttpUrl(reference)) {
          issues.push(evidenceReferenceIssue(record, row, reference, "invalid-url"));
        }
        continue;
      }
      if (!isPathLikeReference(row, reference)) continue;
      const resolved = localEvidencePath(root, reference);
      if (!isUnderRoot(root, resolved)) {
        issues.push(evidenceReferenceIssue(record, row, reference, "outside-project-root"));
      } else if (!existsSync(resolved)) {
        issues.push(evidenceReferenceIssue(record, row, reference, "missing"));
      } else {
        const realPath = realPathIfExists(resolved);
        if (realPath && !isUnderRoot(root, realPath)) {
          issues.push(evidenceReferenceIssue(record, row, reference, "outside-project-root"));
        }
      }
    }
  }
  return issues;
}

export function collectMissingEvidenceReferences(workspace: ParsedWorkspace): EvidenceReferenceIssue[] {
  return workspace.records
    .filter((record) => record.status === "verified")
    .flatMap((record) => collectEvidenceReferenceIssuesForRecord(workspace.root.root, record));
}

/**
 * @req FR-NODE-174 AC-3 — one clause per cause, not one cause for four. The kinds this module emits
 * live here with it: a caller that kept its own copy of the vocabulary would drift from the resolver
 * that produces it, and a refusal naming the wrong cause sends the author to fix the wrong thing —
 * an empty cell has no reference to resolve at all.
 */
const EVIDENCE_ISSUE_CAUSE: Record<string, string> = {
  // `missing` is pushed only when isUnderRoot() is true and existsSync() is false, so the path IS
  // under the root. Describing it as "not under the project root" is the other kind's cause, and a
  // refusal naming the wrong cause sends the author to fix the wrong thing.
  missing: "resolves under the project root but names no existing file",
  "outside-project-root": "resolves outside the project root",
  empty: "is an empty cell carrying no reference",
  "invalid-url": "is a malformed URL"
};

export function describeEvidenceRefusal(issues: readonly EvidenceReferenceIssue[]): string {
  const clauses = issues.map((issue) => {
    const label = issue.reference.trim() === "" ? "(empty cell)" : issue.reference;
    const kind = issue.issue ?? "unclassified";
    return `${label} [${kind}] ${EVIDENCE_ISSUE_CAUSE[kind] ?? `fails the ${kind} check`}`;
  });
  return `Cannot mark verified: ${clauses.join("; ")}`;
}

function commandPolicyViolation(record: RequirementRecord, row: EvidenceRow, reference: string, policy: string): CommandEvidencePolicyViolation {
  const result: CommandEvidencePolicyViolation = { requirementId: record.id, reference, policy };
  if (row.id.trim()) result.evidenceId = row.id;
  return result;
}

function satisfiesCommandEvidencePolicy(reference: string): boolean {
  const normalized = reference.trim().replace(/^\$\s*/, "");
  if (/[;&|`<>]|\$\(/.test(normalized)) return false;
  return (
    /^npm\s+test(?:\s|$)/.test(normalized) ||
    /^npm\s+run\s+(build|typecheck|lint|test|test:integration|release:acceptance|release:check|perf:srs)(?:\s|$)/.test(normalized) ||
    /^npx\s+vitest\s+run(?:\s|$)/.test(normalized)
  );
}

export function collectCommandEvidencePolicyViolations(records: RequirementRecord[]): CommandEvidencePolicyViolation[] {
  const violations: CommandEvidencePolicyViolation[] = [];
  for (const record of records) {
    if (record.status !== "verified") continue;
    for (const row of record.verificationEvidence) {
      for (const reference of splitEvidenceReferences(row)) {
        if (isCommandReference(row, reference) && !satisfiesCommandEvidencePolicy(reference)) {
          violations.push(commandPolicyViolation(record, row, reference, "command evidence must use npm test, npm run release gates, or npx vitest run without shell operators"));
        }
      }
    }
  }
  return violations;
}

export function collectBrokenTraceLinks(records: RequirementRecord[], allRecords: RequirementRecord[] = records): string[] {
  const requirementIds = new Set(allRecords.map((record) => record.id));
  const broken: string[] = [];
  for (const record of records) {
    for (const trace of record.traceLinks) {
      if (trace.type.trim().toLowerCase() === "requirement" && trace.reference.trim() && !requirementIds.has(trace.reference.trim())) {
        broken.push(`${record.id} -> ${trace.reference.trim()}`);
      }
    }
  }
  return broken;
}

function isNonDiscarded(record: RequirementRecord): boolean {
  return record.status !== "discarded";
}

export function collectDraftRequirements(records: RequirementRecord[]): string[] {
  return records.filter((record) => isNonDiscarded(record) && record.stability === "draft").map((record) => record.id);
}

export function collectDeprecatedRequirements(records: RequirementRecord[]): string[] {
  return records.filter((record) => isNonDiscarded(record) && record.stability === "deprecated").map((record) => record.id);
}

export function collectStabilityBlockers(records: RequirementRecord[]): string[] {
  return collectDraftRequirements(records);
}

export function collectStabilityWarnings(records: RequirementRecord[]): string[] {
  return records.filter((record) => isNonDiscarded(record) && (record.stability === "deprecated" || record.stability === "volatile")).map((record) => record.id);
}

interface ResidueRow {
  target: string;
  requirementId: string;
  criterion: string;
  reason: string;
}

const RESIDUE_COLUMNS = ["Target", "Requirement", "Criterion", "Reason"] as const;

/**
 * Splits one Markdown table row into its cells, honouring `\|` as an escaped pipe.
 *
 * @req FR-NODE-175 AC-10 — a naive `split("|")` reports a reason the register does not render: the
 * cell `a \| b` renders as `a | b` and was reported as `a \`. A register whose report differs from
 * its own text is worse than one that refuses the row.
 */
function splitResidueCells(line: string): string[] {
  let body = line.trim();
  if (body.startsWith("|")) body = body.slice(1);
  if (body.endsWith("|") && !body.endsWith("\\|")) body = body.slice(0, -1);
  const cells: string[] = [];
  let current = "";
  for (let index = 0; index < body.length; index += 1) {
    if (body[index] === "\\" && body[index + 1] === "|") {
      current += "|";
      index += 1;
      continue;
    }
    if (body[index] === "|") {
      cells.push(current.trim());
      current = "";
      continue;
    }
    current += body[index];
  }
  cells.push(current.trim());
  return cells;
}

/** Up to three leading spaces, because CommonMark permits them and every renderer draws the heading. */
const RESIDUE_HEADING = /^ {0,3}##\s+(?:\d+\.\s+)?Release Residue\s*$/;
const FENCE_DELIMITER = /^ {0,3}(`{3,}|~{3,})/;


function isSeparatorRow(cells: readonly string[]): boolean {
  return cells.every((cell) => /^:?-+:?$/.test(cell));
}

/**
 * @req FR-NODE-175 AC-10 — read the register the way a reader reads it, and report every difference.
 *
 * The governing rule, restated because two rounds have now found the code departing from it: a row a
 * human wrote is either honoured or REPORTED. It is never both unread and unmentioned. The reader
 * used to end the register at the first line it did not expect, and to return silently when the
 * heading was spelt even slightly differently — so five heading variants, a row missing one optional
 * pipe, an HTML comment and a duplicated section each took `ready` from false to true with an empty
 * problem list.
 */
/** A line as a renderer sees it: `inert` content draws nothing at all, so the reader must not read it. */
interface ClassifiedLine {
  text: string;
  inert: boolean;
  heading: boolean;
}

/**
 * Classifies every line of the index by the container it sits in, because a renderer decides what a
 * table is by four rules and the reader was applying one.
 *
 * - **Indentation.** Four spaces makes an indented code block. Measured: a `## 12. Release Residue`
 *   heading followed by an indented example table excused a real requirement, `ready` false to true.
 * - **Fences.** CommonMark matching, so a nested example (an outer fence longer than the inner one —
 *   the only way Markdown can display a fence) is one block rather than two.
 * - **HTML blocks.** `<!-- … -->` renders nothing. The reader read a whole register out of one.
 * - **Headings.** ATX with up to three leading spaces, and setext. Both are headings to every
 *   renderer; the reader recognised neither, so a register under one was silently unread.
 *
 * `unclosedFence` is returned rather than swallowed: a fence opened earlier in the index and never
 * closed runs to end of document, which made the entire register invisible with no diagnostic — the
 * likeliest real shape of this defect in a long index.
 */
function classifyIndexLines(lines: readonly string[]): { classified: ClassifiedLine[]; unclosedFence: boolean } {
  const classified: ClassifiedLine[] = [];
  let openFence: { marker: string; length: number } | undefined;
  let inHtmlBlock = false;
  for (let index = 0; index < lines.length; index += 1) {
    const text = lines[index] ?? "";
    if (openFence !== undefined) {
      const match = FENCE_DELIMITER.exec(text);
      const closes = match?.[1] !== undefined && match[1][0] === openFence.marker && match[1].length >= openFence.length && text.trim() === match[1];
      if (closes) openFence = undefined;
      classified.push({ text, inert: true, heading: false });
      continue;
    }
    if (inHtmlBlock) {
      if (text.includes("-->")) inHtmlBlock = false;
      classified.push({ text, inert: true, heading: false });
      continue;
    }
    if (text.trimStart().startsWith("<!--")) {
      inHtmlBlock = !text.includes("-->");
      classified.push({ text, inert: true, heading: false });
      continue;
    }
    const fence = FENCE_DELIMITER.exec(text);
    if (fence?.[1] !== undefined) {
      openFence = { marker: fence[1][0] as string, length: fence[1].length };
      classified.push({ text, inert: true, heading: false });
      continue;
    }
    if (/^ {4,}\S/.test(text)) {
      classified.push({ text, inert: true, heading: false });
      continue;
    }
    const atx = /^ {0,3}#{1,6}\s/.test(text);
    const setext =
      text.trim() !== "" &&
      !/^ {0,3}\|/.test(text) &&
      /^ {0,3}(?:=+|-+)\s*$/.test(lines[index + 1] ?? "") &&
      !/^ {4,}/.test(lines[index + 1] ?? "");
    classified.push({ text, inert: false, heading: atx || setext });
  }
  return { classified, unclosedFence: openFence !== undefined };
}

/** Strips the decoration a heading may carry so two spellings of the same section compare equal. */
function normalizeHeadingTitle(text: string): string {
  return text
    .replace(/[\u200b-\u200d\ufeff]/g, "")
    .replace(/^ {0,3}#{1,6}\s+/, "")
    .replace(/\s*#+\s*$/, "")
    .replace(/^\d+(?:\.\d+)*\.?\s+/, "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

/**
 * @req FR-NODE-175 — the index's Release Residue table, read as rows.
 *
 * Kept deliberately dumb about *meaning*: every judgement about whether a row excuses anything is
 * made against the parsed requirements rather than against the row's own claims. A register that
 * validated itself would be a rubber stamp.
 *
 * It is NOT dumb about shape, and two independent adversarial rounds are why. The governing rule: a
 * row a human wrote is either honoured or REPORTED, never both unread and unmentioned — and what
 * counts as a row is what a renderer draws, which is what `classifyIndexLines` above establishes.
 */
function readResidueRows(workspace: ParsedWorkspace): { rows: ResidueRow[]; problems: string[] } {
  const indexBody = workspace.files.find((file) => file.relativePath.endsWith("00.index.md"))?.lines ?? [];
  const problems: string[] = [];
  const { classified, unclosedFence } = classifyIndexLines(indexBody);
  if (unclosedFence) {
    problems.push("the index leaves a code fence open, so everything after it renders as code and was not read");
  }

  const headings: number[] = [];
  for (let index = 0; index < classified.length; index += 1) {
    const line = classified[index] as ClassifiedLine;
    if (line.inert || !line.heading) continue;
    // Two questions, deliberately separate. "Is this the register?" is answered STRICTLY, because the
    // register is a named structure and a case variant is a typo rather than a synonym. "Did somebody
    // mean the register?" is answered loosely, because that decides whether they are told.
    const isRegister = RESIDUE_HEADING.test(line.text) || (!/^ {0,3}#/.test(line.text) && line.text.trim() === "Release Residue");
    if (isRegister) {
      headings.push(index);
      continue;
    }
    if (normalizeHeadingTitle(line.text).startsWith("release residue")) {
      problems.push(`a heading resembles the Release Residue register but is not it, so nothing under it was read: ${line.text.trim()}`);
    }
  }
  if (headings.length > 1) {
    problems.push(
      `the index declares ${headings.length} Release Residue sections; only the first is the register, so the rest were not read`
    );
  }
  const heading = headings[0];
  if (heading === undefined) return { rows: [], problems };

  const rows: ResidueRow[] = [];
  // A header alone is not a table, and a header with the separator row somewhere further down is not
  // a table either — GFM requires them adjacent. One blank line between them and no renderer draws a
  // table, while the reader stitched them together across it.
  let phase: "header" | "separator" | "rows" = "header";
  let tableEnded = false;
  const setextUnderlineAt = heading + 1;
  for (let index = heading + 1; index < classified.length; index += 1) {
    const line = classified[index] as ClassifiedLine;
    if (index === setextUnderlineAt && /^ {0,3}(?:=+|-+)\s*$/.test(line.text)) continue;
    if (line.inert) {
      if (phase === "rows") tableEnded = true;
      continue;
    }
    if (line.heading) break;
    const isRowShaped = line.text.includes("|") && line.text.trim() !== "";
    if (!isRowShaped) {
      // A blank line or a paragraph ends a GFM table, and it also breaks the header/separator pair.
      if (phase === "rows") tableEnded = true;
      else if (phase === "separator") {
        problems.push("the Release Residue header is not immediately followed by a separator row, so no reader renders it as a table");
        phase = "header";
      }
      continue;
    }
    if (tableEnded) {
      problems.push(`a residue row follows the end of the table, so no reader renders it as part of the register: ${line.text.trim()}`);
      continue;
    }
    const cells = splitResidueCells(line.text);
    if (phase === "header") {
      if (RESIDUE_COLUMNS.every((column, column_index) => cells[column_index] === column)) phase = "separator";
      // A residue-shaped row ABOVE the header renders as nothing and was dropped in silence, while
      // the author was separately told the criterion it names is unexcused.
      else if (cells.length === RESIDUE_COLUMNS.length) {
        problems.push(`a residue row is written above the register's header, where no reader renders it as a row: ${line.text.trim()}`);
      }
      continue;
    }
    if (phase === "separator") {
      if (isSeparatorRow(cells)) phase = "rows";
      else problems.push(`the Release Residue header is not followed by a separator row, so no reader renders it as a table: ${line.text.trim()}`);
      continue;
    }
    // A separator-shaped row in the DATA region is a data row to every renderer. Skipping it here made
    // whether a malformed row got reported depend on whether its content happened to look like dashes:
    // `| - |` vanished where the identical `| x |` was reported.
    if (cells.length !== RESIDUE_COLUMNS.length) {
      problems.push(`residue row does not have ${RESIDUE_COLUMNS.length} cells and was not read: ${line.text.trim()}`);
      continue;
    }
    if (isSeparatorRow(cells)) {
      problems.push(`residue row carries no content and was not read: ${line.text.trim()}`);
      continue;
    }
    rows.push({ target: cells[0]!, requirementId: cells[1]!, criterion: cells[2]!, reason: cells[3]! });
  }
  const inTable = phase === "rows";
  // The section exists, so somebody meant to excuse something. If no table under the declared column
  // names was reached — a header spelt differently, a subheading before it, a fence around it, an
  // indented example — every row in the section was ignored. Saying so is the whole point.
  if (!inTable) {
    problems.push(`the Release Residue section declares no table with the columns ${RESIDUE_COLUMNS.join(", ")}, so nothing in it was read`);
  }
  return { rows, problems };
}

/**
 * Every target the workspace knows: the ones requirements carry, plus the ones the index's Target Map
 * registers. Built from records alone, a register staging rows for the NEXT target — which is what a
 * register is for — reported every one of them as naming an unknown target and blocked this release.
 */
function declaredTargetNames(workspace: ParsedWorkspace): Set<string> {
  const names = new Set(workspace.records.map((record) => record.target).filter((value): value is string => Boolean(value)));
  const indexLines = workspace.files.find((file) => file.relativePath.endsWith("00.index.md"))?.lines ?? [];
  const headingIndex = indexLines.findIndex((line) => /^##\s+\d+\.\s+Target Map\s*$/.test(line.trim()));
  if (headingIndex < 0) return names;
  for (const line of indexLines.slice(headingIndex + 1)) {
    if (/^#{1,6}\s/.test(line)) break;
    if (!line.trim().startsWith("|")) continue;
    const cells = splitResidueCells(line);
    const first = cells[0];
    if (first === undefined || first === "" || first === "Target" || isSeparatorRow([first])) continue;
    names.add(first);
  }
  return names;
}

/**
 * Refuses a cell that says nothing. It cannot judge whether a sentence is TRUE, and it cannot judge
 * whether a true sentence is a good enough excuse — those limits are real and are stated here rather
 * than implied. What it can do is refuse a cell a reader learns nothing from: only the single `-` was
 * refused before, and `--`, `—`, `N/A`, `TBD`, `.` and `?` each fully excused a criterion.
 *
 * The threshold is a threshold, and there is no principled length at which a token becomes a reason.
 * It is set from measurement rather than taste: every degenerate cell found is 3 characters or fewer,
 * the shortest reason any test or the live register writes is 8, and 8 is the only round number
 * between them. A longer bar would start refusing reasons somebody meant.
 */
const MIN_REASON_LENGTH = 8;

function reasonSaysNothing(reason: string): boolean {
  const trimmed = reason.trim();
  if (trimmed.length < MIN_REASON_LENGTH) return true;
  return (trimmed.match(/\p{L}/gu) ?? []).length < 2;
}

/**
 * @req FR-NODE-175 — split the target's `implemented` requirements into the ones a residue row
 * genuinely excuses and the ones that still block, and report every row that excuses nothing.
 *
 * A row is honoured only when it names this target, a requirement that is actually `implemented`
 * here, an acceptance criterion that requirement actually declares and has NOT ticked, and a reason.
 * Anything else is a problem rather than an exemption: an excuse that has outlived its gap, or that
 * resolves to nothing, must fail loudly instead of silently widening the gate.
 */
function partitionResidue(
  workspace: ParsedWorkspace,
  target: string,
  implementedIds: readonly string[],
  records: readonly RequirementRecord[]
): { accepted: AcceptedResidueEntry[]; stillBlocking: string[]; problems: string[] } {
  const read = readResidueRows(workspace);
  const accepted: AcceptedResidueEntry[] = [];
  const problems: string[] = [...read.problems];
  const excusedCriteria = new Map<string, Set<string>>();

  // The target filter used to run before every diagnostic, so a typo in the Target cell — `v1.O.O`
  // for `v1.0.0`, or an empty cell — put the row beyond the reach of every check that follows and the
  // author saw the requirement blocking with no word about the row they had written. A row naming a
  // target that genuinely exists is another target's business and is skipped in silence; a row naming
  // no target this workspace declares is a mistake, and mistakes get reported.
  const declaredTargets = declaredTargetNames(workspace);
  const rows: ResidueRow[] = [];
  for (const row of read.rows) {
    if (row.target === target) {
      rows.push(row);
      continue;
    }
    if (declaredTargets.has(row.target)) continue;
    problems.push(
      `${row.requirementId}: names target ${row.target === "" ? "(empty)" : row.target}, which no requirement in this workspace declares`
    );
  }

  for (const row of rows) {
    // `find` returns whichever block came first, so one row silently discharged criteria on a block
    // it never named. Duplicate ids are an ordinary merge outcome — this repository ships a repair
    // workflow for them — so the register refuses to guess rather than guessing quietly.
    const matches = records.filter((candidate) => candidate.id === row.requirementId);
    if (matches.length > 1) {
      problems.push(`${row.requirementId}: ${matches.length} requirement blocks share this id in ${target}, so the row names no one block`);
      continue;
    }
    const record = matches[0];
    if (!record || record.status !== "implemented") {
      problems.push(`${row.requirementId}: no implemented requirement of that id in ${target}`);
      continue;
    }
    const criterion = record.acceptanceCriteria.find((entry) => entry.id === row.criterion);
    if (!criterion) {
      problems.push(`${row.requirementId}: names ${row.criterion}, which the requirement does not declare`);
      continue;
    }
    if (criterion.checked) {
      problems.push(`${row.requirementId}: names ${row.criterion}, which is ticked — the excuse is stale`);
      continue;
    }
    if (reasonSaysNothing(row.reason)) {
      problems.push(`${row.requirementId}: names ${row.criterion} with no reason`);
      continue;
    }
    accepted.push({ requirementId: row.requirementId, criterion: row.criterion, reason: row.reason });
    const named = excusedCriteria.get(row.requirementId) ?? new Set<string>();
    named.add(row.criterion);
    excusedCriteria.set(row.requirementId, named);
  }

  // FR-NODE-175 AC-8 — a row excuses the criterion it names and nothing else. Adding the requirement
  // to an excused set made one row waive every OTHER undischarged criterion too, so waiving five cost
  // exactly what waiving one cost — the rubber stamp the Rationale exists to prevent, and a direct
  // contradiction of the register's own header, which says each row names *the* criterion carried.
  const stillBlocking: string[] = [];
  for (const id of implementedIds) {
    const record = records.find((candidate) => candidate.id === id);
    const unticked = (record?.acceptanceCriteria ?? []).filter((entry) => !entry.checked).map((entry) => entry.id);
    const named = excusedCriteria.get(id);
    if (!named) {
      stillBlocking.push(id);
      continue;
    }
    const unexcused = unticked.filter((criterionId) => !named.has(criterionId));
    if (unexcused.length === 0) continue;
    problems.push(`${id}: residue names ${[...named].join(", ")}, but ${unexcused.join(", ")} ${unexcused.length === 1 ? "is" : "are"} also unticked and unexcused`);
    stillBlocking.push(id);
  }

  return { accepted, stillBlocking, problems };
}

export function summarizeReleaseReadiness(workspace: ParsedWorkspace, options: { target?: string } | string = {}): ReleaseReadinessSummary {
  const validation = validateWorkspace(workspace);
  const diagnosticsSummary = formatDiagnosticsSummary(validation);
  const targetSelection = resolveTargetSelection(workspace, typeof options === "string" ? { target: options } : options);
  const { target, targetSource } = targetSelection;
  const records = workspace.records.filter((record) => record.target === target);
  const blocked = records.filter((record) => record.status === "blocked").map((record) => record.id);
  const plannedOrInProgress = records.filter((record) => record.status === "planned" || record.status === "in_progress").map((record) => record.id);
  const implementedAll = records.filter((record) => record.status === "implemented").map((record) => record.id);
  // FR-NODE-175 — an `implemented` requirement the index explicitly accepts, naming a criterion that
  // is genuinely still unticked, stops blocking; every other row is a problem that blocks instead.
  const residue = partitionResidue(workspace, target, implementedAll, records);
  const implementedNotVerified = residue.stillBlocking;
  const acceptedResidue = residue.accepted;
  const residueProblems = residue.problems;
  const draftRequirements = collectDraftRequirements(records);
  const deprecatedRequirements = collectDeprecatedRequirements(records);
  const stabilityBlockers = collectStabilityBlockers(records);
  const stabilityWarnings = collectStabilityWarnings(records);
  const criticalHighUnverified = records
    .filter((record) => (record.priority === "critical" || record.priority === "high") && record.status !== "verified" && record.status !== "discarded")
    .map((record) => record.id);
  const missingEvidence = records.filter((record) => (record.status === "implemented" || record.status === "verified") && record.verificationEvidence.length === 0).map((record) => record.id);
  const acCoverageGaps = collectAcCoverageGaps(records);
  const missingEvidenceReferences = collectMissingEvidenceReferences({ ...workspace, records });
  const brokenTraceLinks = collectBrokenTraceLinks(records, workspace.records);
  const commandEvidencePolicyViolations = collectCommandEvidencePolicyViolations(records);
  const warnings = validation.warnings.map((diagnostic) => diagnostic.message);
  if (!target) {
    warnings.unshift("Release target is empty; provide an explicit target or set Active Target.");
  }
  return {
    target,
    targetSource,
    ready:
      target.length > 0 &&
      diagnosticsSummary.errors === 0 &&
      blocked.length === 0 &&
      plannedOrInProgress.length === 0 &&
      implementedNotVerified.length === 0 &&
      residueProblems.length === 0 &&
      stabilityBlockers.length === 0 &&
      missingEvidence.length === 0 &&
      acCoverageGaps.length === 0 &&
      missingEvidenceReferences.length === 0 &&
      brokenTraceLinks.length === 0 &&
      commandEvidencePolicyViolations.length === 0,
    diagnosticsSummary,
    validationErrors: diagnosticsSummary.errors,
    blocked,
    plannedOrInProgress,
    implementedNotVerified,
    acceptedResidue,
    residueProblems,
    draftRequirements,
    deprecatedRequirements,
    stabilityBlockers,
    stabilityWarnings,
    criticalHighUnverified,
    missingEvidence,
    acCoverageGaps,
    missingEvidenceReferences,
    brokenTraceLinks,
    commandEvidencePolicyViolations,
    warnings,
    baselineCommand: target ? `git tag srs-${target}-baseline` : ""
  };
}

export function renderCiValidationExample(): string {
  return ["# CI Spec Validation Example", "", "Use Node.js LTS and run:", "", "```sh", "npm ci", "npx speckiwi validate --json", "```"].join("\n");
}

export function collectTraceabilityCoverage(requirementIds: string[], evidenceIndex: Record<string, string[]>): TraceabilityCoverage {
  const missing = requirementIds.filter((id) => (evidenceIndex[id] ?? []).length === 0);
  const covered = requirementIds.length - missing.length;
  return {
    total: requirementIds.length,
    covered,
    coveragePercent: requirementIds.length === 0 ? 100 : Math.round((covered / requirementIds.length) * 100),
    missing
  };
}
