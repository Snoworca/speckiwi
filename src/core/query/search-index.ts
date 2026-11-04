import type { RequirementRecord } from "../types.js";
import { buildSearchVocabulary, scanTerms, splitQueryWords, textTerms, type QueryWord, type SearchVocabulary } from "./search-tokenize.js";

// @req FR-NODE-239 — ranked requirement search: records holding the whole query first (the
// phrase group), then records covering enough query words (the terms group), each group ordered
// by BM25F. Research 42 §10 and 43 §8.2 measured these weights, k1/b and the coverage rule.

export interface RequirementSnippet {
  field: string;
  text: string;
}

export type SearchMatchKind = "phrase" | "terms";

export interface RankedRequirement {
  record: RequirementRecord;
  match: SearchMatchKind;
  /** The query words this record matched, in query order. */
  matchedTerms: string[];
  score: number;
}

interface Posting {
  doc: number;
  /** BM25F pseudo term frequency: field-weighted, length-normalised count. */
  weight: number;
}

/** Built once from the records and reusable for any number of queries. */
export interface RequirementSearchIndex {
  readonly records: readonly RequirementRecord[];
  readonly postings: ReadonlyMap<string, readonly Posting[]>;
  /** Lower-cased text of the phrase-searched fields per record, fields joined by NUL. */
  readonly phraseTexts: readonly string[];
  /**
   * The words of the indexed fields. A plural folds onto the singular this corpus writes, so the
   * terms of the index and of every query against it depend on it: always query through it.
   */
  readonly vocabulary: SearchVocabulary;
}

const FIELD_WEIGHTS = { id: 3, title: 3, tags: 2, requirement: 1.5, acceptanceCriteria: 1 } as const;
type IndexedField = keyof typeof FIELD_WEIGHTS;
const INDEXED_FIELDS = Object.keys(FIELD_WEIGHTS) as IndexedField[];
const K1 = 1.2;
const B = 0.75;
const FIELD_SEPARATOR = "\u0000";

function acceptanceCriteriaText(record: RequirementRecord): string {
  return record.acceptanceCriteria.map((criterion) => `${criterion.id}: ${criterion.text}`).join("\n");
}

/** The fields the phrase match scans (IR-CLI-029 AC-3), in snippet order. */
export function phraseSearchEntries(record: RequirementRecord): Array<{ field: string; text: string }> {
  return [
    { field: "id", text: record.id },
    { field: "title", text: record.title },
    { field: "requirement", text: record.requirement ?? "" },
    { field: "rationale", text: record.rationale ?? "" },
    { field: "research", text: record.research ?? "" },
    { field: "acceptanceCriteria", text: acceptanceCriteriaText(record) },
    { field: "verificationEvidence", text: record.verificationEvidence.map((row) => `${row.id} ${row.type} ${row.reference} ${row.covers} ${row.notes}`).join("\n") },
    { field: "traceLinks", text: record.traceLinks.map((row) => `${row.type} ${row.reference} ${row.relation} ${row.notes}`).join("\n") },
    { field: "relatedDocs", text: (record.relatedDocs ?? []).join("\n") },
    { field: "changeNotes", text: record.changeNotes.map((row) => `${row.date} ${row.change} ${row.reason}`).join("\n") }
  ];
}

function indexedFieldText(record: RequirementRecord, field: IndexedField): string {
  if (field === "id") return record.id;
  if (field === "title") return record.title;
  if (field === "tags") return record.tags.join(" ");
  if (field === "requirement") return record.requirement ?? "";
  return acceptanceCriteriaText(record);
}

function isLowSurrogate(code: number): boolean {
  return code >= 0xdc00 && code <= 0xdfff;
}

/**
 * About 60 characters before `index` and 100 after. The window edges are moved off the middle of
 * a surrogate pair (an emoji), so the snippet never carries half a character.
 */
function snippetFor(text: string, index: number): string {
  let start = Math.max(0, index - 60);
  let end = Math.min(text.length, index + 100);
  if (start > 0 && isLowSurrogate(text.charCodeAt(start))) start -= 1;
  if (end < text.length && isLowSurrogate(text.charCodeAt(end))) end += 1;
  const prefix = start > 0 ? "..." : "";
  const suffix = end < text.length ? "..." : "";
  return `${prefix}${text.slice(start, end).replace(/\s+/g, " ").trim()}${suffix}`;
}

/**
 * Where in `text` the lower-case offset `lowerIndex` falls. Lower-casing can lengthen a character
 * ("İ" → "i̇", two code units), so an offset in the lower-case text is mapped back character by
 * character; the common case, equal lengths, maps to itself.
 */
function originalOffset(text: string, lower: string, lowerIndex: number): number {
  if (lower.length === text.length) return lowerIndex;
  let lowered = 0;
  for (let index = 0; index < text.length; ) {
    if (lowered >= lowerIndex) return index;
    const point = text.codePointAt(index)!;
    const width = point > 0xffff ? 2 : 1;
    lowered += text.slice(index, index + width).toLowerCase().length;
    index += width;
  }
  return text.length;
}

/** Snippets around the first case-insensitive occurrence of the whole query, at most three. */
export function phraseSnippets(record: RequirementRecord, query: string): RequirementSnippet[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];
  const snippets: RequirementSnippet[] = [];
  for (const entry of phraseSearchEntries(record)) {
    const lower = entry.text.toLowerCase();
    const index = lower.indexOf(needle);
    if (index >= 0) snippets.push({ field: entry.field, text: snippetFor(entry.text, originalOffset(entry.text, lower, index)) });
  }
  return snippets.slice(0, 3);
}

export function buildRequirementSearchIndex(records: readonly RequirementRecord[]): RequirementSearchIndex {
  const lengthTotals = new Map<IndexedField, number>(INDEXED_FIELDS.map((field) => [field, 0]));
  const vocabulary = buildSearchVocabulary(records.flatMap((record) => INDEXED_FIELDS.map((field) => indexedFieldText(record, field))));
  const tokenized = records.map((record) =>
    INDEXED_FIELDS.map((field) => {
      const terms = textTerms(indexedFieldText(record, field), vocabulary);
      lengthTotals.set(field, lengthTotals.get(field)! + terms.length);
      return terms;
    })
  );
  const averageLength = INDEXED_FIELDS.map((field) => lengthTotals.get(field)! / (records.length || 1) || 1);
  const postings = new Map<string, Posting[]>();
  tokenized.forEach((fields, doc) => {
    fields.forEach((terms, position) => {
      // Each occurrence adds the field weight over the field's length norm: BM25F's pseudo frequency.
      const increment = FIELD_WEIGHTS[INDEXED_FIELDS[position]!] / (1 - B + (B * terms.length) / averageLength[position]!);
      for (const term of terms) {
        const list = postings.get(term);
        const last = list?.[list.length - 1];
        if (last?.doc === doc) last.weight += increment;
        else if (list) list.push({ doc, weight: increment });
        else postings.set(term, [{ doc, weight: increment }]);
      }
    });
  });
  const phraseTexts = records.map((record) => phraseSearchEntries(record).map((entry) => entry.text.toLowerCase()).join(FIELD_SEPARATOR));
  return { records, postings, phraseTexts, vocabulary };
}

function inverseDocumentFrequency(index: RequirementSearchIndex, documentFrequency: number): number {
  const total = index.records.length;
  return Math.log(1 + (total - documentFrequency + 0.5) / (documentFrequency + 0.5));
}

function coverageMet(words: readonly QueryWord[], matched: ReadonlySet<number>): boolean {
  let hangulTotal = 0;
  let hangulMatched = 0;
  let otherTotal = 0;
  let otherMatched = 0;
  words.forEach((word, position) => {
    const hit = matched.has(position);
    if (word.script === "hangul") {
      hangulTotal += 1;
      if (hit) hangulMatched += 1;
    } else {
      otherTotal += 1;
      if (hit) otherMatched += 1;
    }
  });
  return (hangulTotal > 0 && hangulMatched >= Math.ceil(hangulTotal / 2)) || (otherTotal > 0 && otherMatched >= Math.ceil(otherTotal / 2));
}

function isDiscarded(record: RequirementRecord): boolean {
  return record.status === "discarded";
}

/**
 * The one score a hit carries, rounded to three decimals: the order is computed on exactly the value
 * the caller sees, so two hits shown with equal scores always fall back to ascending ID.
 */
function reportedScore(raw: number): number {
  return Math.round(raw * 1000) / 1000;
}

function compareRanked(a: RankedRequirement, b: RankedRequirement): number {
  if (a.match !== b.match) return a.match === "phrase" ? -1 : 1;
  const discarded = Number(isDiscarded(a.record)) - Number(isDiscarded(b.record));
  if (discarded !== 0) return discarded;
  if (a.score !== b.score) return b.score - a.score;
  return a.record.id.localeCompare(b.record.id);
}

/** Ranks every record of the index against `query`; filtering and paging are the caller's. */
export function rankRequirements(index: RequirementSearchIndex, query: string): RankedRequirement[] {
  const words = splitQueryWords(query, index.vocabulary);
  const scores = new Map<number, number>();
  const matchedWords = new Map<number, Set<number>>();
  words.forEach((word, position) => {
    // A word matches a record that holds any one of its terms: research 43 measured coverage this
    // way, and requiring half of a Hangul word's bigrams lost ko→ko R@10 0.944 → 0.889 because a
    // particle ("거부한다") leaves the bare noun ("거부") one bigram out of three.
    const docsByTerm = new Map<string, Set<number>>();
    for (const term of word.terms) {
      const postings = index.postings.get(term);
      if (!postings) continue;
      const idf = inverseDocumentFrequency(index, postings.length);
      const docs = new Set<number>();
      for (const { doc, weight } of postings) {
        scores.set(doc, (scores.get(doc) ?? 0) + (idf * weight) / (K1 + weight));
        docs.add(doc);
      }
      docsByTerm.set(term, docs);
    }
    // Every part of the word must hold one of its terms, so a part is a candidate filter.
    const partDocs = word.parts.map((terms) => new Set(terms.flatMap((term) => [...(docsByTerm.get(term) ?? [])])));
    for (const doc of partDocs[0]!) {
      if (!partDocs.every((docs) => docs.has(doc))) continue;
      const matched = matchedWords.get(doc);
      if (matched) matched.add(position);
      else matchedWords.set(doc, new Set([position]));
    }
  });

  const needle = query.trim().toLowerCase();
  const allWordTexts = [...new Set(words.map((word) => word.text))];
  const ranked: RankedRequirement[] = [];
  index.records.forEach((record, doc) => {
    const raw = scores.get(doc) ?? 0;
    const score = reportedScore(raw);
    if (needle && index.phraseTexts[doc]!.includes(needle)) {
      ranked.push({ record, match: "phrase", matchedTerms: allWordTexts, score });
      return;
    }
    const matched = matchedWords.get(doc);
    if (raw > 0 && matched && coverageMet(words, matched)) {
      const matchedTerms = [...new Set(words.filter((_, position) => matched.has(position)).map((word) => word.text))];
      ranked.push({ record, match: "terms", matchedTerms, score });
    }
  });
  return ranked.sort(compareRanked);
}

/**
 * Snippets for a ranked hit. A phrase hit keeps the phrase snippets; a terms hit gets one snippet
 * around the first occurrence of its rarest matched term, so the snippet shows why it matched.
 */
export function rankedSnippets(index: RequirementSearchIndex, hit: RankedRequirement, query: string): RequirementSnippet[] {
  if (hit.match === "phrase") return phraseSnippets(hit.record, query);
  const matched = new Set(hit.matchedTerms);
  const candidates = [...new Set(splitQueryWords(query, index.vocabulary).filter((word) => matched.has(word.text)).flatMap((word) => word.terms))];
  const firstOccurrence = new Map<string, { field: IndexedField; text: string; start: number }>();
  for (const field of INDEXED_FIELDS) {
    const text = indexedFieldText(hit.record, field);
    scanTerms(text, (term, start) => {
      if (!firstOccurrence.has(term) && candidates.includes(term)) firstOccurrence.set(term, { field, text, start });
    }, index.vocabulary);
  }
  let anchor: { field: IndexedField; text: string; start: number } | undefined;
  let anchorFrequency = Number.POSITIVE_INFINITY;
  for (const term of candidates) {
    const occurrence = firstOccurrence.get(term);
    const frequency = index.postings.get(term)?.length ?? Number.POSITIVE_INFINITY;
    if (occurrence && frequency < anchorFrequency) {
      anchor = occurrence;
      anchorFrequency = frequency;
    }
  }
  return anchor ? [{ field: anchor.field, text: snippetFor(anchor.text, anchor.start) }] : [];
}
