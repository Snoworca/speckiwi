import { pageSlice, RANKED_DEFAULT_LIMIT } from "../query/discovery.js";
import { buildRequirementSearchIndex, rankRequirements, type RequirementSearchIndex, type SearchMatchKind } from "../query/search-index.js";
import type { RequirementRecord } from "../types.js";
import { prdItemView, type PrdItemView, type PrdPage, type PrdPageOptions } from "./items.js";
import type { PrdDocument, PrdItem } from "./model.js";

// @req FR-NODE-240 AC-4 — PRD search runs on the requirement search index itself (same tokenizer,
// same BM25F weights, same phrase-then-terms order), so a mixed Korean-English query ranks PRD items
// the way it ranks requirements. Each item is presented to the index as a search-only record: ID,
// title, and its words (quote, reason, body) as the statement. These records live only inside this
// index and never reach the requirement queries.

export interface PrdSearchIndex {
  readonly index: RequirementSearchIndex;
  readonly origins: ReadonlyMap<RequirementRecord, { doc: PrdDocument; item: PrdItem }>;
}

export interface PrdSearchHit extends PrdItemView {
  path: string;
  match: SearchMatchKind;
  matchedTerms: string[];
  score: number;
}

function searchRecord(doc: PrdDocument, item: PrdItem): RequirementRecord {
  return {
    id: item.id,
    title: item.title,
    requirement: [item.quote, item.reason, item.body].filter((text) => text !== undefined && text !== "").join("\n"),
    type: "functional",
    target: "",
    status: "planned",
    scope: "",
    filePath: doc.path,
    headingLine: item.line,
    metadata: {},
    acceptanceCriteria: [],
    verificationEvidence: [],
    traceLinks: [],
    changeNotes: [],
    tags: []
  };
}

/** Built once over the PRD files and reusable for any number of queries. */
export function buildPrdSearchIndex(docs: readonly PrdDocument[]): PrdSearchIndex {
  const origins = new Map<RequirementRecord, { doc: PrdDocument; item: PrdItem }>();
  for (const doc of docs) for (const item of doc.items) origins.set(searchRecord(doc, item), { doc, item });
  return { index: buildRequirementSearchIndex([...origins.keys()]), origins };
}

export function searchPrdItems(index: PrdSearchIndex, query: string, options: PrdPageOptions = {}): { items: PrdSearchHit[]; page: PrdPage } {
  const hits = rankRequirements(index.index, query).map((hit) => {
    const { doc, item } = index.origins.get(hit.record)!;
    return { ...prdItemView(doc, item), path: doc.path, match: hit.match, matchedTerms: hit.matchedTerms, score: hit.score };
  });
  return pageSlice(hits, { ...options, limit: options.limit ?? RANKED_DEFAULT_LIMIT });
}
