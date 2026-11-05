import { sameRepositoryPath } from "../parser/file-references.js";
import type { RequirementRecord } from "../types.js";
import { RELATED_DOCS_BASE } from "../parser/markdown-links.js";
import { documentDirectory, findPrdCitations, findPrdReferences, namesCriterion, parseRationaleBasis, type PrdCitation } from "./citations.js";
import type { PrdDocument, PrdItem } from "./model.js";

// @req FR-NODE-242 — which PRD items the SRS cites, decided by string comparison only. Citations are
// read by citations.ts; a bare `PRD-<n>` is read as an item of the PRD coverage runs against, and a
// path-qualified citation of another PRD file is not a citation of this one. A citation is a basis
// only when it names an item of this PRD that is not rejected (kiwi-srs: a rejected item is no basis),
// with or without `fills:`.

/** Kinds whose items the SRS must cite; a confirmed proposal with Effect in-scope counts as in-scope. */
const COVERED_KINDS = new Set(["intent", "goal", "in-scope"]);

export const PRD_COVERAGE_NOT_JUDGED =
  "Coverage reports only what string comparison decides: which items no requirement or criterion cites, which requirements cite no item, and which criteria carry neither a PRD citation nor a fills: basis of their own. Whether an addition stays within the item it cites, and whether the SRS contradicts an item, is left to the verifier.";

export interface PrdCoverageReport {
  prd: string;
  target: string;
  /** Intent, goal and in-scope items no requirement or criterion of the target cites, in item order. */
  uncitedItems: Array<{ id: string; kind: string; title: string }>;
  /** Requirements of the target with no basis anywhere: no citation of a usable item, no fills: basis. */
  uncitedRequirements: Array<{ requirementId: string; title: string }>;
  /** Live criteria of the target with no basis of their own: no usable citation in their text or attached to them in the Rationale. */
  ungroundedCriteria: Array<{ requirementId: string; criterionId: string; text: string }>;
  /** @req FR-NODE-242 AC-3 */
  notJudged: string;
}

export interface PrdReferenceProblem {
  requirementId: string;
  field: "rationale" | "traceLinks";
  reference: string;
  problem: "missing-file" | "missing-item";
}

/** Every citation a requirement makes anywhere: its text resolves links from its own document, Related Docs from docs/spec. */
function requirementCitations(record: RequirementRecord): PrdCitation[] {
  const own = documentDirectory(record.filePath);
  return [
    ...[
      record.requirement ?? "",
      record.rationale ?? "",
      ...record.acceptanceCriteria.map((criterion) => criterion.text),
      ...record.traceLinks.map((link) => `${link.reference} ${link.notes}`)
    ].flatMap((text) => findPrdCitations(text, own)),
    ...(record.relatedDocs ?? []).flatMap((text) => findPrdCitations(text, RELATED_DOCS_BASE))
  ];
}

function inTarget(records: readonly RequirementRecord[], target: string): RequirementRecord[] {
  return records.filter((record) => record.target === target && record.status !== "discarded");
}

function mustBeCited(item: PrdItem): boolean {
  if (item.state === "rejected") return false;
  if (item.kind === "proposal") return item.state === "confirmed" && item.effect === "in-scope";
  return COVERED_KINDS.has(item.kind);
}

/** Criteria of `record` with a basis of their own: a usable citation in their text or attached to them in the Rationale. */
function groundedCriteria(record: RequirementRecord, isBasis: (citation: PrdCitation) => boolean): Set<string> {
  const own = documentDirectory(record.filePath);
  const grounded = new Set(record.acceptanceCriteria.filter((criterion) => findPrdCitations(criterion.text, own).some(isBasis)).map((criterion) => criterion.id));
  const based = parseRationaleBasis(record.rationale ?? "", own).filter((clause) => clause.citations.some(isBasis));
  for (const criterion of record.acceptanceCriteria) {
    if (based.some((clause) => namesCriterion(clause, criterion.id))) grounded.add(criterion.id);
  }
  return grounded;
}

/** Whether a citation names an item of `doc` that is not rejected: the one reading of a citation coverage makes. */
function basisOf(doc: PrdDocument): (citation: PrdCitation) => boolean {
  const usable = new Set(doc.items.filter((item) => item.state !== "rejected").map((item) => item.id));
  // A qualified citation names this PRD when the file system would open this file for it: case only
  // matters where the file system cares, as in `links check`.
  return (citation: PrdCitation) => (citation.path === undefined || sameRepositoryPath(citation.path, doc.path)) && usable.has(citation.itemId);
}

/**
 * The items of `doc` the Rationales of `records` cite, in the PRD's item order, each citation read as
 * coverage reads it. @req IR-CLI-114 AC-2
 */
export function rationalePrdItems(doc: PrdDocument, records: ReadonlyArray<Pick<RequirementRecord, "rationale" | "filePath">>): string[] {
  const isBasis = basisOf(doc);
  const cited = new Set(records.flatMap((record) => findPrdCitations(record.rationale ?? "", documentDirectory(record.filePath)).filter(isBasis).map((citation) => citation.itemId)));
  return doc.items.filter((item) => cited.has(item.id)).map((item) => item.id);
}

/** @req FR-NODE-242 AC-2, AC-3 */
export function prdCoverage(doc: PrdDocument, records: readonly RequirementRecord[], options: { target: string }): PrdCoverageReport {
  const isBasis = basisOf(doc);
  const scoped = inTarget(records, options.target);
  const citations = new Map(scoped.map((record) => [record, requirementCitations(record).filter(isBasis)]));
  const cited = new Set([...citations.values()].flatMap((found) => found.map((citation) => citation.itemId)));
  return {
    prd: doc.pointer,
    target: options.target,
    uncitedItems: doc.items.filter((item) => mustBeCited(item) && !cited.has(item.id)).map((item) => ({ id: item.id, kind: item.kind, title: item.title })),
    uncitedRequirements: scoped.filter((record) => citations.get(record)!.length === 0).map((record) => ({ requirementId: record.id, title: record.title })),
    ungroundedCriteria: scoped.flatMap((record) => {
      const grounded = groundedCriteria(record, isBasis);
      return record.acceptanceCriteria
        .filter((criterion) => !grounded.has(criterion.id))
        .map((criterion) => ({ requirementId: record.id, criterionId: criterion.id, text: criterion.text }));
    }),
    notJudged: PRD_COVERAGE_NOT_JUDGED
  };
}

/**
 * @req FR-NODE-242 AC-1 — `docs/prd/<file>.prd.md#PRD-<n>` references in a Trace `Doc` row or a
 * Rationale whose file or item does not exist. `readPrd` returns the parsed PRD at a workspace-relative
 * path, or undefined when there is no such file; the caller owns the file system.
 */
export function checkPrdReferences(records: readonly RequirementRecord[], readPrd: (path: string) => PrdDocument | undefined): PrdReferenceProblem[] {
  const problems: PrdReferenceProblem[] = [];
  const inspect = (record: RequirementRecord, field: PrdReferenceProblem["field"], text: string) => {
    const requirementId = record.id;
    for (const reference of findPrdReferences(text, documentDirectory(record.filePath))) {
      const doc = readPrd(reference.path);
      if (!doc) problems.push({ requirementId, field, reference: reference.reference, problem: "missing-file" });
      else if (!doc.items.some((item) => item.id === reference.itemId)) problems.push({ requirementId, field, reference: reference.reference, problem: "missing-item" });
    }
  };
  for (const record of records) {
    inspect(record, "rationale", record.rationale ?? "");
    for (const link of record.traceLinks) if (link.type === "Doc") inspect(record, "traceLinks", link.reference);
  }
  return problems;
}
