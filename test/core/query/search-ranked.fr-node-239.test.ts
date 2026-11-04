import path from "node:path";
import { describe, expect, it } from "vitest";
import { matchesRequirementFilter } from "../../../src/core/query/filter.js";
import { searchRequirementIndex, searchRequirementRecords } from "../../../src/core/query/discovery.js";
import { buildRequirementSearchIndex, rankRequirements } from "../../../src/core/query/search-index.js";
import { BoundedMemo, buildSearchVocabulary, splitQueryWords, textTerms } from "../../../src/core/query/search-tokenize.js";
import { resolveProjectRoot } from "../../../src/core/project-root.js";
import { parseWorkspace } from "../../../src/core/parser/workspace-parser.js";
import type { RequirementFilter, RequirementRecord } from "../../../src/core/types.js";

// @req FR-NODE-239 — ranked requirement search core.

interface RankedRecord {
  id: string;
  title: string;
  snippets: Array<{ field: string; text: string }>;
  match: "phrase" | "terms";
  matchedTerms: string[];
  score: number;
}

interface SearchResult {
  records: RankedRecord[];
  page: { total: number; offset: number; limit: number | null; returned: number; nextOffset: number | null; truncated: boolean };
}

function rec(id: string, parts: Partial<RequirementRecord> & { ac?: string[] } = {}): RequirementRecord {
  const { ac, ...rest } = parts;
  return {
    id,
    title: "",
    type: "functional",
    target: "t",
    status: "planned",
    scope: "X",
    filePath: "docs/spec/10.x.srs.md",
    headingLine: 1,
    metadata: {},
    acceptanceCriteria: (ac ?? []).map((text, index) => ({ id: `AC-${index + 1}`, text, checked: false, line: index + 1 })),
    verificationEvidence: [],
    traceLinks: [],
    changeNotes: [],
    tags: [],
    ...rest
  };
}

function search(records: readonly RequirementRecord[], query: string, extra: Record<string, unknown> = {}): SearchResult {
  return searchRequirementRecords(records, { query, ...extra }) as unknown as SearchResult;
}

function ids(result: SearchResult): string[] {
  return result.records.map((record) => record.id);
}

// Filler records give the corpus realistic document frequencies so IDF is not degenerate.
function filler(count: number): RequirementRecord[] {
  return Array.from({ length: count }, (_, index) =>
    rec(`FR-FILL-${String(index + 1).padStart(3, "0")}`, {
      title: `Filler requirement ${index + 1}`,
      requirement: "The parser SHALL keep the workspace readable for every command."
    })
  );
}

// The search algorithm as it shipped before FR-NODE-239, frozen as the AC-7 oracle.
function legacySearch(records: readonly RequirementRecord[], options: { query: string; filter?: RequirementFilter; limit?: number; offset?: number }): Record<string, unknown> {
  const textEntries = (record: RequirementRecord) => [
    { field: "id", text: record.id },
    { field: "title", text: record.title },
    { field: "requirement", text: record.requirement ?? "" },
    { field: "rationale", text: record.rationale ?? "" },
    { field: "research", text: record.research ?? "" },
    { field: "acceptanceCriteria", text: record.acceptanceCriteria.map((criterion) => `${criterion.id}: ${criterion.text}`).join("\n") },
    { field: "verificationEvidence", text: record.verificationEvidence.map((row) => `${row.id} ${row.type} ${row.reference} ${row.covers} ${row.notes}`).join("\n") },
    { field: "traceLinks", text: record.traceLinks.map((row) => `${row.type} ${row.reference} ${row.relation} ${row.notes}`).join("\n") },
    { field: "relatedDocs", text: (record.relatedDocs ?? []).join("\n") },
    { field: "changeNotes", text: record.changeNotes.map((row) => `${row.date} ${row.change} ${row.reason}`).join("\n") }
  ];
  const snippetFor = (text: string, index: number) => {
    const start = Math.max(0, index - 60);
    const end = Math.min(text.length, index + 100);
    return `${start > 0 ? "..." : ""}${text.slice(start, end).replace(/\s+/g, " ").trim()}${end < text.length ? "..." : ""}`;
  };
  const snippetsFor = (record: RequirementRecord, query: string) => {
    const needle = query.trim().toLowerCase();
    if (!needle) return [];
    const snippets: Array<{ field: string; text: string }> = [];
    for (const entry of textEntries(record)) {
      const index = entry.text.toLowerCase().indexOf(needle);
      if (index >= 0) snippets.push({ field: entry.field, text: snippetFor(entry.text, index) });
    }
    return snippets.slice(0, 3);
  };
  const matches = records
    .filter((record) => matchesRequirementFilter(record, options.filter ?? {}))
    .map((record) => ({ record, snippets: snippetsFor(record, options.query) }))
    .filter((match) => match.snippets.length > 0)
    .sort((a, b) => a.record.id.localeCompare(b.record.id));
  const offset = Math.max(0, Math.trunc(options.offset ?? 0));
  const limit = options.limit === undefined ? null : Math.max(0, Math.trunc(options.limit));
  const end = limit === null ? matches.length : offset + limit;
  const sliced = matches.slice(offset, end);
  const nextOffset = end < matches.length ? end : null;
  return {
    records: sliced.map(({ record, snippets }) => ({
      id: record.id,
      title: record.title,
      snippets,
      filePath: record.filePath,
      headingLine: record.headingLine,
      target: record.target,
      status: record.status,
      stability: record.stability,
      scope: record.scope
    })),
    projection: "search",
    page: { total: matches.length, offset, limit, returned: sliced.length, nextOffset, truncated: nextOffset !== null }
  };
}

let repoRecordsPromise: Promise<RequirementRecord[]> | undefined;
function repoRecords(): Promise<RequirementRecord[]> {
  repoRecordsPromise ??= resolveProjectRoot(path.resolve(__dirname, "../../..")).then(parseWorkspace).then((workspace) => workspace.records);
  return repoRecordsPromise;
}

describe("FR-NODE-239 ranked requirement search", () => {
  // @req FR-NODE-239 AC-1
  it("AC-1: a record containing the whole query ranks ahead of every word-only match, whatever their scores", () => {
    const records = [
      ...filler(10),
      // The phrase sits only in the rationale, which the BM25F index does not score.
      rec("FR-ZZZ-900", { title: "Unrelated title", rationale: "It enforces the Lock Timeout for writers." }),
      rec("FR-AAA-100", { title: "Lock and timeout", requirement: "The lock SHALL expire after the timeout of the lock.", tags: ["lock", "timeout"] })
    ];
    const result = search(records, "lock timeout");
    expect(ids(result)).toEqual(["FR-ZZZ-900", "FR-AAA-100"]);
    expect(result.records[0]!.match).toBe("phrase");
    expect(result.records[1]!.match).toBe("terms");
    expect(result.records[1]!.score).toBeGreaterThan(result.records[0]!.score);
  });

  // @req FR-NODE-239 AC-2
  it("AC-2: a word-only match needs at least half of the query's non-Hangul words", () => {
    const records = [
      ...filler(10),
      rec("FR-TWO-001", { requirement: "Alpha and beta are both configured." }),
      rec("FR-ONE-001", { requirement: "Only alpha is configured." })
    ];
    expect(ids(search(records, "alpha beta gamma delta"))).toEqual(["FR-TWO-001"]);
  });

  // @req FR-NODE-239 AC-2
  it("AC-2: on this repository's SRS the reported (score, id) sequence is score-descending, ties by ascending ID", async () => {
    const records = await repoRecords();
    const index = buildRequirementSearchIndex(records);
    const queries = ["lock", "mutation", "review loop", "search index", "status", "requirement ID", "MCP tool", "저장소 루트", "검증 증거", "verified evidence 검증", "skill install", "target"];
    const out: string[] = [];
    let compared = 0;
    for (const query of queries) {
      const result = searchRequirementIndex(index, { query, limit: 1000 }) as unknown as { records: Array<RankedRecord & { status: string }> };
      result.records.forEach((current, position) => {
        const previous = result.records[position - 1];
        // Order holds within one group (match kind) and one tier (discarded or not).
        if (!previous || previous.match !== current.match || (previous.status === "discarded") !== (current.status === "discarded")) return;
        compared += 1;
        if (previous.score < current.score || (previous.score === current.score && previous.id.localeCompare(current.id) > 0)) out.push(`${query}: ${previous.id} ${previous.score} before ${current.id} ${current.score}`);
      });
    }
    expect(compared).toBeGreaterThan(500);
    expect(out).toEqual([]);
  }, 60000);

  // @req FR-NODE-239 AC-2
  it("AC-2: a repeated query word counts once, for coverage and for the score", () => {
    expect(splitQueryWords("lock Lock lock").map((word) => word.text)).toEqual(["lock"]);
    // Spellings that fold to the same terms are one word too.
    expect(splitQueryWords("lock locks Locked").map((word) => word.text)).toEqual(["lock"]);
    const records = [...filler(10), rec("FR-ONLY-001", { title: "alpha only" }), rec("FR-LOCK-001", { title: "lock" })];
    // Four distinct words need two matches; "alpha" three times is still one.
    expect(ids(search(records, "alpha alpha alpha beta gamma delta"))).toEqual([]);
    expect(search(records, "lock lock").records[0]!.score).toBe(search(records, "lock").records[0]!.score);
  });

  // @req FR-NODE-239 AC-2
  it("AC-2: word-only matches are ordered by descending score, equal scores by ascending ID", () => {
    const records = [
      ...filler(10),
      rec("FR-LOW-001", { acceptanceCriteria: [{ id: "AC-1", text: "A cache exists next to the parser among many other unrelated words in a long sentence here.", checked: false, line: 1 }] }),
      rec("FR-HIGH-001", { title: "Parser cache invalidation" }),
      rec("FR-TIE-002", { title: "Cache invalidation parser rules" }),
      rec("FR-TIE-001", { title: "Cache invalidation parser rules" })
    ];
    const result = search(records, "cache parser invalidation");
    expect(result.records.every((record) => record.match === "terms")).toBe(true);
    const scores = result.records.map((record) => record.score);
    expect([...scores].sort((a, b) => b - a)).toEqual(scores);
    expect(ids(result).indexOf("FR-TIE-001")).toBe(ids(result).indexOf("FR-TIE-002") - 1);
    expect(ids(result).at(-1)).toBe("FR-LOW-001");
  });

  // @req FR-NODE-239 AC-2
  it("AC-2: Hangul and non-Hangul words are counted separately, so a bilingual query reaches a one-language record", () => {
    const records = [
      ...filler(10),
      rec("FR-KO-001", { title: "리뷰 루프 상한" }),
      rec("FR-KO-002", { title: "리뷰 설정" }),
      rec("FR-EN-001", { title: "alpha beta gamma" }),
      rec("FR-EN-002", { title: "alpha beta" })
    ];
    // 3 Hangul words (need 2) and 6 other words (need 3). FR-KO-001 has 3 of the 9 words in total.
    const found = ids(search(records, "리뷰 루프 상한 alpha beta gamma delta epsilon zeta"));
    expect(found).toContain("FR-KO-001");
    expect(found).toContain("FR-EN-001");
    expect(found).not.toContain("FR-KO-002");
    expect(found).not.toContain("FR-EN-002");
  });

  // @req FR-NODE-239 AC-2
  it("AC-2: a query word is a Latin run (with inner - . /) or a Hangul run; stopword-only words do not count", () => {
    expect(splitQueryWords("completed-work와 the review, docs/spec 저장소").map((word) => [word.text, word.script])).toEqual([
      ["completed-work", "other"],
      ["와", "hangul"],
      ["review", "other"],
      ["docs/spec", "other"],
      ["저장소", "hangul"]
    ]);
  });

  // @req FR-NODE-239 AC-3
  it("AC-3: Hangul runs index their leading syllable and in-word bigrams, a one-syllable run stays whole, and Latin splits from Hangul", () => {
    expect(textTerms("저장소 루트")).toEqual(["저", "저장", "장소", "루", "루트"]);
    expect(textTerms("루")).toEqual(["루"]);
    expect(textTerms("completed-work와")).toEqual(["complet", "work", "와"]);
  });

  // @req FR-NODE-239 AC-3
  it("AC-3: Latin text is lowercased, camelCase and snake_case split, stopwords dropped and lightly stemmed", () => {
    expect(textTerms("searchIndex")).toEqual(["searchindex", "search", "index"]);
    // The whole-run term is built from the stemmed pieces, so it agrees with them.
    expect(textTerms("work_mode")).toEqual(["work_mode", "work", "mode"]);
    expect(textTerms("The policies were rejected while running")).toEqual(["polici", "were", "reject", "while", "run"]);
    // One stem per word family, including short plurals such as IDs.
    expect(new Set(textTerms("complete completed completes completing"))).toEqual(new Set(["complet"]));
    expect(textTerms("IDs ACs id")).toEqual(["id", "ac", "id"]);
  });

  // @req FR-NODE-239 AC-3
  it("AC-3: a Hangul query word counts as matched when the record holds any one of its bigrams", () => {
    // "거부한다" → 거부 · 부한 · 한다; the record holds only 거부 (1 of 3). Research 43's coverage
    // rule counts this as a match; requiring half of the bigrams lost ko→ko R@10 0.944 → 0.889.
    const records = [...filler(10), rec("FR-REJ-001", { title: "옵션 거부" })];
    expect(search(records, "거부한다").records).toEqual([expect.objectContaining({ id: "FR-REJ-001", match: "terms", matchedTerms: ["거부한다"] })]);
  });

  // @req FR-NODE-239 AC-3
  it("AC-3: a one-syllable query word meets the record's run that starts with it; a longer query word does not use its leading syllable", () => {
    const records = [...filler(10), rec("FR-KEY-001", { requirement: "표는 키를 값으로 정렬한다." }), rec("FR-SAVE-001", { title: "저장 규칙" })];
    expect(ids(search(records, "키 값"))).toEqual(["FR-KEY-001"]);
    // "저는" shares only its leading syllable with "저장"; counting it lost KX R@10 0.893 → 0.619.
    expect(ids(search(records, "저는"))).toEqual([]);
  });

  // @req FR-NODE-239 AC-2
  it("AC-2: a query word with parts (FR-NODE-999) matches only a record that holds every part", () => {
    const records = [...filler(10), rec("FR-NODE-100", { title: "Node requirement" }), rec("FR-NODE-999", { title: "Target" }), rec("FR-OTHER-001", { title: "Mentions node 999 here" })];
    const result = search(records, "FR-NODE-999 sorting");
    expect(ids(result)).toEqual(["FR-NODE-999", "FR-OTHER-001"]);
    expect(result.records[1]).toMatchObject({ match: "terms", matchedTerms: ["FR-NODE-999"] });
  });

  // @req FR-NODE-239 AC-2
  it("AC-2: an identifier from this repository's SRS matches only records holding each of its pieces (50 grep-derived identifiers)", async () => {
    const records = await repoRecords();
    const identifier = /\b(?:[a-z][a-z0-9]*(?:[_.-][a-z0-9]+)+|[a-z]+(?:[A-Z][a-z0-9]+)+)\b/g;
    const found = new Set<string>();
    for (const record of records) {
      const text = [record.title, ...record.acceptanceCriteria.map((criterion) => criterion.text)].join("\n");
      for (const match of text.matchAll(identifier)) found.add(match[0]);
    }
    const all = [...found].sort();
    const step = Math.max(1, Math.floor(all.length / 50));
    const sample = all.filter((_, position) => position % step === 0).slice(0, 50);
    expect(sample).toHaveLength(50);
    // Pieces: split at - . _ and camelCase, each piece stemmed by the same tokenizer as the index.
    const { vocabulary } = buildRequirementSearchIndex(records);
    const pieces = (word: string) => word.split(/[-._]|(?<=[a-z0-9])(?=[A-Z])/).flatMap((piece) => textTerms(piece, vocabulary));
    const coreTerms = (record: RequirementRecord) =>
      new Set(textTerms([record.id, record.title, record.tags.join(" "), record.requirement ?? "", ...record.acceptanceCriteria.map((criterion) => `${criterion.id}: ${criterion.text}`)].join("\n"), vocabulary));
    const index = buildRequirementSearchIndex(records);
    const byId = new Map(records.map((record) => [record.id, record]));
    let checked = 0;
    for (const word of sample) {
      const required = pieces(word);
      const result = searchRequirementIndex(index, { query: word, limit: 1000 }) as unknown as SearchResult;
      for (const hit of result.records.filter((record) => record.match === "terms")) {
        const terms = coreTerms(byId.get(hit.id)!);
        expect(required.filter((piece) => !terms.has(piece)), `${word} → ${hit.id}`).toEqual([]);
        checked += 1;
      }
    }
    expect(checked).toBeGreaterThan(0);
  }, 60000);

  // @req FR-NODE-239 AC-3
  it("AC-3: an identifier holding a digit or an acronym plural yields the same terms as its singular", () => {
    expect(new Set(textTerms("parseV2Records"))).toEqual(new Set(textTerms("parseV2Record")));
    // A plural that step 1a keeps whole ("apis") is also indexed without its "s", whatever its case.
    for (const singular of textTerms("listAPI")) expect(textTerms("listAPIs")).toContain(singular);
    for (const singular of textTerms("listapi")) expect(textTerms("listapis")).toContain(singular);
    // Without a corpus, plain Porter step 1a: one term per word.
    expect(textTerms("analysis status This")).toEqual(["analysi", "statu"]);
  });

  // @req FR-NODE-239 AC-3
  it("AC-3: an acronym and its plural find each other in either case", () => {
    const records = [...filler(10), rec("FR-API-001", { requirement: "One API serves agents." }), rec("FR-API-002", { requirement: "Several APIs serve agents." })];
    for (const query of ["API", "api", "APIs", "apis"]) expect(ids(search(records, query)).sort(), query).toEqual(["FR-API-001", "FR-API-002"]);
  });

  // @req FR-NODE-239 AC-3
  it("AC-3: letter case never changes which records match (200 grep-derived capitalised words of this SRS)", async () => {
    const records = await repoRecords();
    const word = /[A-Za-z0-9_](?:[A-Za-z0-9_\-./]*[A-Za-z0-9_])?/g;
    const found = new Set<string>();
    for (const record of records) {
      const text = [record.id, record.title, record.tags.join(" "), record.requirement ?? "", ...record.acceptanceCriteria.map((criterion) => criterion.text)].join("\n");
      for (const match of text.matchAll(word)) if (/[A-Z]/.test(match[0])) found.add(match[0]);
    }
    const all = [...found].sort();
    const step = Math.max(1, Math.floor(all.length / 200));
    const sample = all.filter((_, position) => position % step === 0).slice(0, 200);
    expect(sample).toHaveLength(200);
    const index = buildRequirementSearchIndex(records);
    const matchedIds = (query: string) => rankRequirements(index, query).map((hit) => hit.record.id).sort();
    for (const capitalised of sample) {
      const lower = capitalised.toLowerCase();
      expect(matchedIds(capitalised), capitalised).toEqual(matchedIds(lower));
      // The index holds every term the lower-case spelling would give, however the record capitalised it.
      const indexed = textTerms(capitalised, index.vocabulary);
      expect(textTerms(lower, index.vocabulary).filter((term) => !indexed.includes(term)), capitalised).toEqual([]);
    }
  }, 60000);

  // @req FR-NODE-239 AC-3
  it("AC-3: no word ending in -se shares a stem with a word that lacks its s (every Latin word of this SRS)", async () => {
    const records = await repoRecords();
    const surfaces = new Set(["erase", "era", "worse", "wor", "tense", "ten", "parse", "par"]);
    for (const record of records) {
      const text = [record.id, record.title, record.tags.join(" "), record.requirement ?? "", ...record.acceptanceCriteria.map((criterion) => criterion.text)].join("\n");
      for (const match of text.toLowerCase().matchAll(/[a-z]+/g)) surfaces.add(match[0]);
    }
    const vocabulary = buildSearchVocabulary(surfaces);
    const byStem = new Map<string, string[]>();
    for (const surface of surfaces) {
      const stem = textTerms(surface, vocabulary)[0];
      if (stem !== undefined) byStem.set(stem, [...(byStem.get(stem) ?? []), surface]);
    }
    expect(byStem.size).toBeGreaterThan(1000);
    // A word ending in -se keeps its s in the stem, so every word sharing that stem carries the s too.
    const merged: string[] = [];
    for (const [stem, group] of byStem) {
      for (const seWord of group.filter((surface) => surface.endsWith("se"))) {
        const kept = seWord.slice(0, -1);
        for (const other of group) if (!other.startsWith(kept)) merged.push(`${stem}: ${seWord} + ${other}`);
      }
    }
    expect(merged).toEqual([]);
  }, 60000);

  // @req FR-NODE-239 AC-3
  it("AC-3: every singular-plural pair of this SRS (w + s, w + es) shares one term", async () => {
    const records = await repoRecords();
    const { vocabulary } = buildRequirementSearchIndex(records);
    const words = new Set<string>();
    for (const record of records) {
      const text = [record.id, record.title, record.tags.join(" "), record.requirement ?? "", ...record.acceptanceCriteria.map((criterion) => criterion.text)].join("\n");
      for (const match of text.toLowerCase().matchAll(/[a-z]+/g)) words.add(match[0]);
    }
    const term = (word: string) => textTerms(word, vocabulary)[0];
    const split: string[] = [];
    let pairs = 0;
    for (const word of words) {
      if (word.length < 2 || textTerms(word).length === 0) continue;
      if (words.has(`${word}s`)) {
        pairs += 1;
        if (term(word) !== term(`${word}s`)) split.push(`${word}/${word}s`);
      }
      // "notes" is note + s, not not + es: an -es plural counts only when w + e is not a word here.
      if (words.has(`${word}es`) && !words.has(`${word}e`)) {
        pairs += 1;
        if (term(word) !== term(`${word}es`)) split.push(`${word}/${word}es`);
      }
    }
    expect(pairs).toBeGreaterThan(300);
    expect(split).toEqual([]);
  }, 60000);

  // @req FR-NODE-239 AC-3
  it("AC-3: every way a term is made folds singular and plural alike (path × pair matrix)", () => {
    // Every path that makes a term: a whole word, a camelCase piece, a snake_case piece, the letter
    // tail of a digit-holding piece, and a piece of a hyphenated ID.
    const paths: Array<[string, (word: string) => string]> = [
      ["word", (word) => word],
      ["camelCase", (word) => `read${word[0]!.toUpperCase()}${word.slice(1)}`],
      ["snake_case", (word) => `read_${word}`],
      ["digit tail", (word) => `v2${word}`],
      ["hyphen ID", (word) => `ZZ-${word.toUpperCase()}-001`]
    ];
    const pairs = [["alias", "aliases"], ["lens", "lenses"], ["bias", "biases"], ["cpu", "cpus"], ["status", "statuses"], ["policy", "policies"], ["erase", "erases"], ["menu", "menus"]];
    const missed: string[] = [];
    for (const [pathName, write] of paths) {
      for (const [singular, plural] of pairs) {
        for (const [held, asked] of [[singular, plural], [plural, singular]] as const) {
          const corpus = [...filler(10), rec("FR-QX-001", { requirement: `The tool keeps ${write(held!)} here.` })];
          // The trailing word matches nothing, so only terms (never the phrase group) can match.
          const found = search(corpus, `${write(asked!)} qqqz`).records.some((record) => record.id === "FR-QX-001" && record.match === "terms");
          if (!found) missed.push(`${pathName}: ${write(held!)} ← ${write(asked!)}`);
        }
      }
    }
    expect(missed).toEqual([]);
  });

  // @req FR-NODE-239 AC-3
  it("AC-3: a camelCase piece in the singular meets a plain plural query", () => {
    const corpus = [...filler(10), rec("FR-QY-001", { requirement: "The reviewer calls readLens once." })];
    expect(search(corpus, "lenses qqqz").records.map((record) => `${record.id}:${record.match}`)).toEqual(["FR-QY-001:terms"]);
  });

  // @req FR-NODE-239 AC-3
  it("a bounded memo keeps at most its limit of entries and still answers every key", () => {
    const memo = new BoundedMemo<string, string>(3);
    for (const key of ["a", "b", "c", "d", "e"]) expect(memo.get(key, (k) => k.toUpperCase())).toBe(key.toUpperCase());
    expect(memo.size).toBeLessThanOrEqual(3);
    let computed = 0;
    memo.get("e", () => { computed += 1; return "x"; });
    expect(computed).toBe(0);
  });

  // @req FR-NODE-239 AC-3
  it("AC-3: a query word missing from the corpus meets the corpus's singular or plural of it", () => {
    // Neutral IDs: an ID is indexed too, and "FR-LENS-001" would put "lens" in the corpus.
    const records = [
      ...filler(10),
      rec("FR-QA-001", { title: "Review lenses" }),
      rec("FR-QB-001", { title: "Ranking bias" }),
      rec("FR-QC-001", { title: "SDS-era note" }),
      rec("FR-QD-001", { title: "Erases the cache" })
    ];
    // A second word that matches nothing keeps every query off the phrase group: only terms decide.
    const byTerms = (corpus: RequirementRecord[], query: string) => search(corpus, `${query} qqqz`).records.map((record) => `${record.id}:${record.match}`);
    expect(byTerms(records, "lens")).toEqual(["FR-QA-001:terms"]);
    expect(byTerms(records, "biases")).toEqual(["FR-QB-001:terms"]);
    expect(byTerms(records, "erase")).toEqual(["FR-QD-001:terms"]);
    expect(byTerms(records, "eras")).toEqual(["FR-QC-001:terms"]);
    // Both spellings in the corpus: the index folds them together, so either query reaches both.
    const both = [...filler(10), rec("FR-QE-001", { title: "Option alias" }), rec("FR-QE-002", { title: "Command aliases" })];
    expect(byTerms(both, "aliases").sort()).toEqual(["FR-QE-001:terms", "FR-QE-002:terms"]);
    expect(byTerms(both, "alias").sort()).toEqual(["FR-QE-001:terms", "FR-QE-002:terms"]);
  });

  // @req FR-NODE-239 AC-3
  it("AC-3: one stem per word family (Porter step 1)", () => {
    for (const family of [["string", "strings"], ["gate", "gated", "gates", "gating"], ["complete", "completed", "completes", "completing"], ["id", "ids"], ["require", "required", "requires", "requiring"], ["policy", "policies"], ["status", "statuses"], ["file", "filed", "files", "filing"], ["v2record", "v2records"], ["alias", "aliases"], ["bias", "biases"], ["lens", "lenses"], ["cpu", "cpus"], ["menu", "menus"], ["erase", "erases", "erased"]]) {
      const vocabulary = buildSearchVocabulary(family);
      expect(new Set(family.map((word) => [...new Set(textTerms(word, vocabulary))].sort().join(" "))), family.join("/")).toHaveProperty("size", 1);
    }
  });

  // @req FR-NODE-239 AC-3
  it("AC-3: a query differing only by particles or spacing still finds the record", () => {
    const records = [...filler(10), rec("FR-ARCH-002", { title: "저장소 루트 자동 탐지" }), rec("PERF-PARSE-001", { title: "일반 저장소 파싱 성능" })];
    expect(ids(search(records, "저장소의 루트를 자동으로 탐지"))[0]).toBe("FR-ARCH-002");
    expect(ids(search(records, "저장소루트 자동탐지"))[0]).toBe("FR-ARCH-002");
    expect(ids(search(records, "파싱성능"))[0]).toBe("PERF-PARSE-001");
  });

  // @req FR-NODE-239 AC-4
  it("AC-4: the two bilingual regression queries reach their requirement in the top ten on this repository's SRS", async () => {
    const records = await repoRecords();
    const first = ids(search(records, "리뷰 루프를 끄는 옵션은 무시하지 않고 거부한다 an option that turns off the review loop is rejected, not ignored", { limit: 10 }));
    const second = ids(search(records, "no database setup is needed to use it in a new repository 새 저장소에서 쓰는 데 데이터베이스 설정이 필요 없다", { limit: 10 }));
    expect(first).toContain("FR-FLOW-135");
    expect(second).toContain("CON-ARCH-002");
  });

  // @req FR-NODE-239 AC-5
  it("AC-5: a DISCARDED record ranks after every non-discarded record of its group", () => {
    const records = [
      ...filler(10),
      rec("FR-DIS-001", { title: "Mutation lock mutation lock", status: "discarded" }),
      rec("FR-LIVE-002", { requirement: "The SRS mutation lock is taken by writers." }),
      rec("FR-DIS-002", { title: "Lock for mutation", tags: ["mutation", "lock"], status: "discarded" }),
      rec("FR-LIVE-003", { acceptanceCriteria: [{ id: "AC-1", text: "Writers take the lock before any mutation of the files in the workspace.", checked: false, line: 1 }] })
    ];
    const result = search(records, "mutation lock");
    expect(ids(result)).toEqual(["FR-LIVE-002", "FR-DIS-001", "FR-LIVE-003", "FR-DIS-002"]);
    expect(result.records.map((record) => record.match)).toEqual(["phrase", "phrase", "terms", "terms"]);
  });

  // @req FR-NODE-239 AC-6
  it("AC-6: each result reports match kind, matched query words and score, and every snippet carries a matched term", () => {
    const records = [
      ...filler(10),
      rec("FR-SNIP-001", { title: "Parser thing", ac: ["The zyxwv flag is rejected by the parser."] }),
      rec("FR-SNIP-002", { title: "Parser zyxwv" })
    ];
    const result = search(records, "parser zyxwv rejected");
    const terms = result.records.find((record) => record.id === "FR-SNIP-001")!;
    expect(terms).toMatchObject({ id: "FR-SNIP-001", match: "terms", matchedTerms: ["parser", "zyxwv", "rejected"] });
    expect(typeof terms.score).toBe("number");
    // The anchor is the rarest matched term, not the first one in field order.
    expect(terms.snippets).toEqual([{ field: "acceptanceCriteria", text: expect.stringContaining("zyxwv") }]);
    const phrase = search(records, "parser zyxwv").records.find((record) => record.id === "FR-SNIP-002")!;
    expect(phrase).toMatchObject({ match: "phrase", matchedTerms: ["parser", "zyxwv"] });
    for (const record of result.records) {
      const { vocabulary } = buildRequirementSearchIndex(records);
      const queryTerms = new Set(splitQueryWords("parser zyxwv rejected", vocabulary).filter((word) => record.matchedTerms.includes(word.text)).flatMap((word) => word.terms));
      for (const snippet of record.snippets) expect(textTerms(snippet.text, vocabulary).some((term) => queryTerms.has(term))).toBe(true);
    }
  });

  // @req FR-NODE-239 AC-6
  it("AC-6: every snippet is well-formed and carries a matched term or the phrase (term path × long identifier / wide characters / emoji)", () => {
    // 120 pieces: an anchor that drifts by one character per separator leaves the 160-character window.
    const longWords = Array.from({ length: 120 }, (_, i) => `seg${i}`);
    const trailing = " trailing words".repeat(30);
    const wide = `${"İ".repeat(200)} `;
    // 80 emoji are 160 UTF-16 units on each side; the shifted copy moves every window edge by one
    // unit, so one of the two puts each edge inside a surrogate pair.
    const emoji = "😀".repeat(80);
    // [path, the record's long identifier, the same path written short, how a query asks by its words]
    const paths: Array<[string, string, string, string]> = [
      ["word", `${longWords.join(" ")} rollback`, "rollback", "rollbacks"],
      ["camelCase", `${longWords.map((word, i) => (i === 0 ? word : `${word[0]!.toUpperCase()}${word.slice(1)}`)).join("")}Rollback`, "readRollback", "rollbacks"],
      ["snake_case", `${longWords.join("_")}_rollback`, "read_rollback", "rollbacks"],
      ["digit tail", `${longWords.join(" ")} v2rollback`, "v2rollback", "v2rollbacks"],
      ["hyphen ID", `${longWords.join(" ")} ZZ-ROLLBACK-001`, "ZZ-ROLLBACK-001", "rollbacks"]
    ];
    const failures: string[] = [];
    for (const [pathName, written, short, asked] of paths) {
      for (const [contextName, text] of [
        ["long identifier", `The loader reads ${written} reads at start.${trailing}`],
        ["wide characters", `${wide}${written} reads at start.${trailing}`],
        // Short forms between emoji, so both window edges fall inside the emoji runs.
        ["emoji", `${emoji} ${short} reads at start. ${emoji}`],
        ["emoji shifted", `x${emoji} ${short} reads at start. x${emoji}`]
      ] as const) {
        const records = [...filler(10), rec("FR-QS-001", { requirement: text })];
        const { vocabulary } = buildRequirementSearchIndex(records);
        // A terms query, and a short phrase that sits right after the long or wide text.
        for (const query of [`${asked} qqqz`, "reads at start"]) {
          const words = splitQueryWords(query, vocabulary);
          for (const hit of search(records, query).records.filter((record) => record.id === "FR-QS-001")) {
            const queryTerms = new Set(words.filter((word) => hit.matchedTerms.includes(word.text)).flatMap((word) => word.terms));
            for (const snippet of hit.snippets) {
              if (!snippet.text.isWellFormed()) failures.push(`${pathName} / ${contextName} / ${hit.match} "${query}": lone surrogate`);
              const carries = hit.match === "phrase" ? snippet.text.toLowerCase().includes(query.toLowerCase()) : textTerms(snippet.text, vocabulary).some((term) => queryTerms.has(term));
              if (!carries) failures.push(`${pathName} / ${contextName} / ${hit.match} "${query}": ${snippet.text}`);
            }
            if (hit.snippets.length === 0) failures.push(`${pathName} / ${contextName} / ${hit.match} "${query}": no snippet`);
          }
        }
      }
    }
    expect(failures).toEqual([]);
  });

  // @req FR-NODE-239 AC-6
  it("AC-6: every snippet on the repository SRS carries a matched term", async () => {
    const records = await repoRecords();
    for (const query of ["리뷰 루프 라운드 상한 review loop round limit", "duplicate requirement ID repair", "저장소의 루트를 자동으로 탐지"]) {
      const result = search(records, query);
      expect(result.records.length).toBeGreaterThan(0);
      const { vocabulary } = buildRequirementSearchIndex(records);
      const words = splitQueryWords(query, vocabulary);
      for (const record of result.records) {
        const queryTerms = new Set(words.filter((word) => record.matchedTerms.includes(word.text)).flatMap((word) => word.terms));
        expect(record.snippets.length, record.id).toBeGreaterThan(0);
        for (const snippet of record.snippets) {
          const carries = record.match === "phrase" ? snippet.text.toLowerCase().includes(query.trim().toLowerCase()) : textTerms(snippet.text, vocabulary).some((term) => queryTerms.has(term));
          expect(carries, `${record.id} ${snippet.text}`).toBe(true);
        }
      }
    }
  });

  // @req FR-NODE-239 AC-7
  it("AC-7: exact matching returns exactly the pre-ranking result on the repository SRS", async () => {
    const records = await repoRecords();
    const cases: Array<{ query: string; filter?: RequirementFilter; limit?: number; offset?: number }> = [
      { query: "mutation lock" },
      { query: "MCP" },
      { query: "저장소 루트 자동 탐지" },
      { query: "verified", filter: { status: "verified" }, limit: 5, offset: 3 },
      { query: "  Acceptance  " },
      { query: "no such phrase anywhere zzqq" },
      { query: "" }
    ];
    for (const { query, filter, limit, offset } of cases) {
      const actual = searchRequirementRecords(records, { query, filter, limit, offset, match: "exact" });
      expect(JSON.stringify(actual), query).toBe(JSON.stringify(legacySearch(records, { query, filter, limit, offset })));
    }
  });

  // @req FR-NODE-239 AC-7
  it("AC-7: exact matching has no default limit while ranked search defaults to 20", () => {
    const records = Array.from({ length: 25 }, (_, index) => rec(`FR-MANY-${String(index + 1).padStart(3, "0")}`, { title: "Shared phrase here" }));
    const exact = search(records, "shared phrase", { match: "exact" });
    expect(exact.records).toHaveLength(25);
    expect(exact.page).toMatchObject({ total: 25, limit: null, nextOffset: null, truncated: false });
    const ranked = search(records, "shared phrase");
    expect(ranked.records).toHaveLength(20);
    expect(ranked.page).toMatchObject({ total: 25, limit: 20, returned: 20, nextOffset: 20, truncated: true });
    expect(search(records, "shared phrase", { limit: 30 }).records).toHaveLength(25);
  });

  // @req FR-NODE-239 AC-2
  it("filters apply after scoring, with document frequencies taken from the whole corpus", () => {
    const records = [
      ...filler(10),
      rec("FR-F-001", { title: "Gamma ray burst", status: "verified" }),
      rec("FR-F-002", { title: "Gamma ray", status: "planned" }),
      rec("FR-F-003", { title: "Gamma", status: "planned" })
    ];
    const all = search(records, "gamma burst");
    const verified = search(records, "gamma burst", { filter: { status: "verified" } });
    expect(ids(verified)).toEqual(["FR-F-001"]);
    expect(verified.records[0]!.score).toBe(all.records.find((record) => record.id === "FR-F-001")!.score);
  });

  // @req FR-NODE-239 AC-1
  it("a prebuilt index answers exactly like a search over the records", () => {
    const records = [...filler(5), rec("FR-IX-001", { title: "Index reuse 색인 재사용" })];
    const index = buildRequirementSearchIndex(records);
    for (const query of ["index reuse", "색인을 재사용", "fill parser"]) {
      expect(searchRequirementIndex(index, { query })).toEqual(searchRequirementRecords(records, { query }));
      expect(searchRequirementIndex(index, { query, match: "exact" })).toEqual(searchRequirementRecords(records, { query, match: "exact" }));
    }
  });
});
