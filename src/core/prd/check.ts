import { TYPE_PREFIX, type Diagnostic } from "../types.js";
import { PRD_EFFECTS, PRD_EXCLUSION_CLASSES, PRD_KINDS, PRD_SECTIONS, PRD_STATES, type PrdDocument, type PrdItem } from "./model.js";
import { prdBodyLines, sectionRange } from "./parse.js";

// @req FR-NODE-240 AC-1 — `prd check` reports each grammar fault with its own code. The codes are
// PRD-scoped and kept here rather than in the SRS diagnostic registry: that registry is the SRS
// rules document's table (SRS-[EW]nnn), and a PRD is not an SRS document. The checks are the ones
// kiwi-prd's `prd-quote` and `prd-hash` commands gate approval on, applied to the grammar of SKILL.md
// §3: metadata is read from the item's `| Field | Value |` table, not from any line that looks like a row.
export const PRD_DIAGNOSTIC_CODES = {
  numberingGap: "PRD-E001",
  numberingDuplicate: "PRD-E002",
  kind: "PRD-E003",
  exclusionClass: "PRD-E004",
  source: "PRD-E005",
  quote: "PRD-E006",
  requestSha: "PRD-E007",
  requirementGrammar: "PRD-E008",
  state: "PRD-E009",
  proposal: "PRD-E010",
  noIntent: "PRD-E011",
  itemOutsideItems: "PRD-E012"
} as const;

export type PrdDiagnosticCode = (typeof PRD_DIAGNOSTIC_CODES)[keyof typeof PRD_DIAGNOSTIC_CODES];

const REQUIREMENT_ID_RE = new RegExp(`\\b(${Object.values(TYPE_PREFIX).join("|")})-[A-Z0-9][A-Z0-9-]{1,24}-[0-9]{3,4}\\b`);
const SHALL_RE = /\bSHALL\b/;
const AC_LINE_RE = /^\s*[-*]?\s*(\[.\]\s*)?AC-[0-9]+\b/;

function prdDiagnostic(doc: PrdDocument, code: PrdDiagnosticCode, message: string, line: number): Diagnostic {
  return { code, severity: "error", message, filePath: doc.path, line };
}

function isOneOf(list: readonly string[], value: string | undefined): boolean {
  return value !== undefined && list.includes(value);
}

function checkNumbering(doc: PrdDocument): Diagnostic[] {
  const seen = new Set<number>();
  return doc.items.flatMap((item, position) => {
    const expected = position + 1;
    if (Number.isNaN(item.number)) {
      return [prdDiagnostic(doc, PRD_DIAGNOSTIC_CODES.numberingGap, `${item.id} heading should read "### PRD-${expected} — <title>"`, item.line)];
    }
    if (seen.has(item.number)) {
      return [prdDiagnostic(doc, PRD_DIAGNOSTIC_CODES.numberingDuplicate, `${item.id} is numbered twice`, item.line)];
    }
    seen.add(item.number);
    if (item.number !== expected) {
      return [prdDiagnostic(doc, PRD_DIAGNOSTIC_CODES.numberingGap, `${item.id} should be PRD-${expected}: items are numbered from 1 without gaps`, item.line)];
    }
    return [];
  });
}

function checkFields(doc: PrdDocument, item: PrdItem): Diagnostic[] {
  const found: Diagnostic[] = [];
  const at = (field: string) => item.fieldLines[field] ?? item.line;
  if (!isOneOf(PRD_KINDS, item.kind)) {
    found.push(prdDiagnostic(doc, PRD_DIAGNOSTIC_CODES.kind, `${item.id} Kind "${item.kind}" is not one of ${PRD_KINDS.join(", ")}`, at("Kind")));
  }
  if (!isOneOf(PRD_STATES, item.state)) {
    found.push(prdDiagnostic(doc, PRD_DIAGNOSTIC_CODES.state, `${item.id} State "${item.state}" is not one of ${PRD_STATES.join(", ")}`, at("State")));
  }
  const isExclusion = item.kind === "exclusion";
  if (isExclusion !== isOneOf(PRD_EXCLUSION_CLASSES, item.exclusionClass)) {
    const message = isExclusion
      ? `${item.id} Exclusion Class "${item.exclusionClass ?? ""}" is not one of ${PRD_EXCLUSION_CLASSES.join(", ")}`
      : `${item.id} carries an Exclusion Class but is not an exclusion`;
    found.push(prdDiagnostic(doc, PRD_DIAGNOSTIC_CODES.exclusionClass, message, at("Exclusion Class")));
  }
  if (item.kind === "proposal") {
    if (item.reason === undefined) found.push(prdDiagnostic(doc, PRD_DIAGNOSTIC_CODES.proposal, `${item.id} proposal has no Reason`, at("Reason")));
    if (!isOneOf(PRD_EFFECTS, item.effect)) {
      found.push(prdDiagnostic(doc, PRD_DIAGNOSTIC_CODES.proposal, `${item.id} proposal Effect "${item.effect ?? ""}" is not one of ${PRD_EFFECTS.join(", ")}`, at("Effect")));
    }
  }
  return found;
}

function checkQuote(doc: PrdDocument, item: PrdItem): Diagnostic[] {
  if (item.kind === "proposal") return [];
  const blocks = new Map(doc.userBlocks.map((block) => [block.id, block.quotable]));
  const unknown = item.source.filter((id) => !blocks.has(id));
  if (item.source.length === 0 || unknown.length > 0) {
    const named = item.source.length === 0 ? "no U-<n> block" : unknown.join(", ");
    return [prdDiagnostic(doc, PRD_DIAGNOSTIC_CODES.source, `${item.id} Source names ${named} that the User Request holds`, item.fieldLines.Source ?? item.line)];
  }
  if (item.quote === "" || !item.source.some((id) => blocks.get(id)!.includes(item.quote))) {
    return [prdDiagnostic(doc, PRD_DIAGNOSTIC_CODES.quote, `${item.id} quote is not in the user's words of ${item.source.join(", ")}`, item.quoteLines[0] ?? item.line)];
  }
  return [];
}

function checkIntent(doc: PrdDocument): Diagnostic[] {
  const auto = doc.status === "unapproved" && doc.approved === "--auto";
  const hasIntent = doc.items.some(
    (item) => item.kind === "intent" || (auto && item.kind === "proposal" && (item.reason ?? "").startsWith("inferred intent:"))
  );
  return hasIntent ? [] : [prdDiagnostic(doc, PRD_DIAGNOSTIC_CODES.noIntent, "The PRD has no intent item", 1)];
}

function checkRequestSha(doc: PrdDocument): Diagnostic[] {
  if (doc.requestSha256 !== undefined && doc.requestSha256Cell.includes(doc.requestSha256)) return [];
  const message =
    doc.requestSha256 === undefined
      ? `The PRD has no "${PRD_SECTIONS.userRequest}" section followed by another section to hash`
      : `Request SHA256 does not match the User Request section (sha256 ${doc.requestSha256})`;
  return [prdDiagnostic(doc, PRD_DIAGNOSTIC_CODES.requestSha, message, doc.requestSha256Line)];
}

/**
 * Lines whose text is the user's own words and so is never checked: the User Request section, the
 * quote of an item that is not a proposal, and the quote lines of the Approval section.
 */
function userWordLines(doc: PrdDocument): Set<number> {
  const exempt = new Set<number>();
  const request = sectionRange(doc.lines, PRD_SECTIONS.userRequest);
  if (request) for (let index = request[0]; index < request[1]; index += 1) exempt.add(index + 1);
  for (const item of doc.items) if (item.kind !== "proposal") item.quoteLines.forEach((line) => exempt.add(line));
  const approval = sectionRange(doc.lines, PRD_SECTIONS.approval);
  if (approval) {
    for (let index = approval[0]; index < approval[1]; index += 1) if (doc.lines[index]!.startsWith(">")) exempt.add(index + 1);
  }
  return exempt;
}

function checkRequirementGrammar(doc: PrdDocument): Diagnostic[] {
  const exempt = userWordLines(doc);
  return doc.lines.flatMap((raw, index) => {
    if (exempt.has(index + 1)) return [];
    const line = raw.replace(/^(>\s?)+/, "");
    if (!REQUIREMENT_ID_RE.test(line) && !SHALL_RE.test(line) && !AC_LINE_RE.test(line)) return [];
    return [prdDiagnostic(doc, PRD_DIAGNOSTIC_CODES.requirementGrammar, "A Requirement ID, SHALL statement or AC line belongs in docs/spec, not in the PRD", index + 1)];
  });
}

function checkItemsOutsideItems(doc: PrdDocument): Diagnostic[] {
  const body = prdBodyLines(doc.lines);
  const items = sectionRange(doc.lines, PRD_SECTIONS.items, body);
  return doc.lines.flatMap((line, index) => {
    const inside = items !== undefined && index > items[0] && index < items[1];
    return body[index] && line.startsWith("### PRD-") && !inside
      ? [prdDiagnostic(doc, PRD_DIAGNOSTIC_CODES.itemOutsideItems, `A PRD item heading sits outside "${PRD_SECTIONS.items}"`, index + 1)]
      : [];
  });
}

/** Every grammar fault of a parsed PRD, in document order of the checks; empty when the PRD passes. */
export function checkPrd(doc: PrdDocument): Diagnostic[] {
  return [
    ...checkRequestSha(doc),
    ...checkIntent(doc),
    ...checkNumbering(doc),
    ...doc.items.flatMap((item) => [...checkFields(doc, item), ...checkQuote(doc, item)]),
    ...checkRequirementGrammar(doc),
    ...checkItemsOutsideItems(doc)
  ];
}
