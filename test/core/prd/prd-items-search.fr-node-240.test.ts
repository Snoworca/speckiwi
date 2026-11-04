import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { buildPrdSearchIndex, listPrdItems, parsePrd, readPrdItem, searchPrdItems } from "../../../src/core/prd/index.js";
import { RANKED_DEFAULT_LIMIT } from "../../../src/core/query/discovery.js";
import { buildRequirementSearchIndex, rankRequirements } from "../../../src/core/query/search-index.js";
import type { RequirementRecord } from "../../../src/core/types.js";
import { buildPrd, type FixtureItem } from "./prd-fixture.js";

const PATH = "docs/prd/2026-11-04.reset.prd.md";

describe("FR-NODE-240 PRD item list and item read", () => {
  // @req FR-NODE-240 AC-3
  it("lists items in document order with the requirement list's page fields", () => {
    const doc = parsePrd(buildPrd(), PATH);
    const all = listPrdItems(doc);
    expect(all.items.map((item) => item.id)).toEqual(["PRD-1", "PRD-2", "PRD-3", "PRD-4"]);
    expect(all.page).toMatchObject({ total: 4, offset: 0, returned: 4, nextOffset: null });
    const page = listPrdItems(doc, { offset: 1, limit: 2 });
    expect(page.items.map((item) => item.id)).toEqual(["PRD-2", "PRD-3"]);
    expect(page.page).toMatchObject({ total: 4, offset: 1, returned: 2, nextOffset: 3 });
  });

  // @req FR-NODE-240 AC-3
  it("pages with the requirement list's own page helper", async () => {
    const source = await readFile("src/core/prd/items.ts", "utf8");
    expect(source).toMatch(/import \{[^}]*pageSlice[^}]*\} from "\.\.\/query\/discovery\.js"/);
    expect(source).not.toMatch(/Math\.trunc/);
  });

  // @req FR-NODE-240 AC-3
  it("reads one item with its kind, quote, source and the PRD pointer <path>@sha256:<hex>", () => {
    const text = buildPrd();
    const result = readPrdItem(parsePrd(text, PATH), "PRD-3");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const fileSha = createHash("sha256").update(text, "utf8").digest("hex");
    expect(result.value).toMatchObject({
      id: "PRD-3",
      kind: "exclusion",
      quote: "소셜 로그인은 이번에 하지 않습니다.",
      source: ["U-2"],
      exclusionClass: "user-excluded",
      prd: `${PATH}@sha256:${fileSha}`
    });
  });

  // @req FR-NODE-240 AC-3
  it("refuses an item ID the PRD does not hold", () => {
    const result = readPrdItem(parsePrd(buildPrd(), PATH), "PRD-9");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("PRD_ITEM_NOT_FOUND");
  });
});

const SEARCH_ITEMS: FixtureItem[] = [
  { title: "재설정 목적", rows: { Kind: "intent", Source: "U-1", State: "confirmed" }, quote: "비밀번호 재설정 링크를 추가해" },
  { title: "Reset link expiry", rows: { Kind: "in-scope", Source: "U-1", State: "confirmed" }, quote: "Password reset email must expire after one hour." },
  { title: "메일 만료", rows: { Kind: "goal", Source: "U-1", State: "confirmed" }, quote: "로그인 화면에" },
  { title: "Rate limit", rows: { Kind: "proposal", State: "proposed", Reason: "재설정 email abuse guard", Effect: "in-scope" } }
];

function asRecord(id: string, title: string, statement: string): RequirementRecord {
  return {
    id, title, requirement: statement, type: "functional", target: "t", status: "planned", scope: "X", filePath: "x", headingLine: 1,
    metadata: {}, acceptanceCriteria: [], verificationEvidence: [], traceLinks: [], changeNotes: [], tags: []
  };
}

describe("FR-NODE-240 PRD search", () => {
  // @req FR-NODE-240 AC-4
  it("ranks PRD items for a mixed Korean-English query in the same order as the requirement index ranks the same texts", () => {
    const doc = parsePrd(buildPrd({ items: SEARCH_ITEMS }), PATH);
    const query = "재설정 email expire";
    const hits = searchPrdItems(buildPrdSearchIndex([doc]), query);
    expect(hits.items.length).toBeGreaterThan(1);
    const twins = doc.items.map((item) => asRecord(item.id, item.title, [item.quote, item.reason, item.body].filter(Boolean).join("\n")));
    const expected = rankRequirements(buildRequirementSearchIndex(twins), query).map((hit) => hit.record.id);
    expect(hits.items.map((hit) => hit.id)).toEqual(expected);
    expect(hits.items[0]).toMatchObject({ path: PATH, id: expected[0] });
  });

  // @req FR-NODE-240 AC-4
  it("matches a Korean word with a particle attached, as requirement search does", () => {
    const doc = parsePrd(buildPrd({ items: SEARCH_ITEMS }), PATH);
    const hits = searchPrdItems(buildPrdSearchIndex([doc]), "재설정을");
    expect(hits.items.map((hit) => hit.id)).toContain("PRD-1");
  });

  // @req FR-NODE-240 AC-3
  it("returns at most 20 hits without a limit, as requirement search does, and more with an explicit limit", () => {
    const many: FixtureItem[] = Array.from({ length: 25 }, (_, index) => ({
      title: `Password reset ${index}`,
      rows: { Kind: index === 0 ? "intent" : "in-scope", Source: "U-1", State: "confirmed" },
      quote: "Password reset email must expire after one hour."
    }));
    const index = buildPrdSearchIndex([parsePrd(buildPrd({ items: many }), PATH)]);
    const capped = searchPrdItems(index, "Password reset");
    expect(RANKED_DEFAULT_LIMIT).toBe(20);
    expect(capped.page).toMatchObject({ total: 25, offset: 0, limit: RANKED_DEFAULT_LIMIT, returned: RANKED_DEFAULT_LIMIT, nextOffset: RANKED_DEFAULT_LIMIT });
    expect(searchPrdItems(index, "Password reset", { limit: 25 }).page).toMatchObject({ returned: 25, nextOffset: null });
  });

  // @req FR-NODE-240 AC-3
  it("pages search hits with the requirement list's page fields and searches across several PRD files", () => {
    const first = parsePrd(buildPrd({ items: SEARCH_ITEMS }), PATH);
    const second = parsePrd(buildPrd({ items: SEARCH_ITEMS }), "docs/prd/other.prd.md");
    const hits = searchPrdItems(buildPrdSearchIndex([first, second]), "Password reset", { limit: 1 });
    expect(hits.page).toMatchObject({ total: 2, offset: 0, returned: 1, nextOffset: 1 });
    const rest = searchPrdItems(buildPrdSearchIndex([first, second]), "Password reset", { offset: 1 });
    expect(new Set([hits.items[0]!.path, rest.items[0]!.path])).toEqual(new Set([PATH, "docs/prd/other.prd.md"]));
  });
});
