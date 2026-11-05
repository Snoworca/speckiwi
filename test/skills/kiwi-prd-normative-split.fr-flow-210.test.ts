import { describe, expect, it } from "vitest";

import { RENDERINGS, readRepoFile, scanUnits } from "./kiwi-renderings.js";
import { COMPACTION_TOKEN_BUDGET, estimateTokens } from "./skill-token-estimate.js";

// @req FR-FLOW-210 — when the request is a design or research document, kiwi-prd makes one PRD item
// per normative sentence of it, each quoting that sentence verbatim, and never merges two into one.
// The AC numbers are the FR-FLOW-210 block in docs/spec/60.workflow-release.srs.md, which is canonical.
//
// The rule is pinned as one exact bullet of §3 (PRD 문법): §1 and §2 are pinned whole by the
// FR-FLOW-204 suite, so the rule lives in the grammar section beside the quoting rule it extends.

const PRD_COPIES = RENDERINGS.map((root) => `${root}/kiwi-prd/SKILL.md`);
const read = (rel: string): string => readRepoFile(rel).replace(/\r\n/g, "\n");

const RULE =
  "- 요청이 설계·연구 문서이면 그 문서의 규범 문장(시스템이 해야 하는 일이나 범위 안팎을 정하는 문장) 하나마다 항목 하나를 만들어 그 문장을 그대로 인용하고, 규범 문장 둘을 한 항목에 합치지 않는다.";

/** §3 of one rendering: from its heading to §4. */
function grammar(text: string): string {
  const start = text.indexOf("## 3. PRD 문법");
  const end = text.indexOf("## 4. 기계 검사", start);
  return start < 0 ? "" : text.slice(start, end < 0 ? undefined : end);
}

describe("FR-FLOW-210 — kiwi-prd splits a design document one normative sentence per item", () => {
  for (const rel of PRD_COPIES) {
    // @req FR-FLOW-210 AC-1 AC-2 — the rule is in every shipped rendering and the mirror.
    it(`AC-1 AC-2: ${rel} §3 carries the one-sentence-per-item rule`, () => {
      expect(grammar(read(rel)).split("\n")).toContain(RULE);
    });

    // @req FR-FLOW-210 AC-1 — the item still quotes its sentence the FR-FLOW-204 AC-3 way, and the rule sits right after that rule.
    it(`AC-1: ${rel} states the split rule right after the verbatim-quote rule it extends`, () => {
      const lines = grammar(read(rel)).split("\n");
      const quote = lines.findIndex((line) => line.startsWith("- proposal 이 아닌 항목은 `Source` 가 가리키는 `U` 블록에 그대로 있는 구절을 인용 블록 하나로 옮긴다."));
      expect(quote, `${rel}: the quote rule`).toBeGreaterThan(0);
      expect(lines[quote + 1]).toBe(RULE);
    });

    // @req FR-FLOW-210 AC-1 — verify r4: a §3 bullet "단 같은 절의 규범 문장은 한 항목에 묶어 그 절을 인용한다" beside the
    // pinned rule passed. Within §3 the rule is the only block that speaks of normative sentences, so
    // no exception, condition or opposite rule about them can stand in the section beside it.
    it(`AC-1: ${rel} §3 states nothing about normative sentences but the one-sentence-per-item rule`, () => {
      const blocks = scanUnits(grammar(read(rel)), { splitListItems: true, splitFencedLines: true }).filter((unit) => /규범/.test(unit.text));
      expect(blocks.map((unit) => unit.text)).toEqual([RULE]);
    });

    // @req FR-FLOW-210 AC-2 — the rule did not push kiwi-prd past the FR-FLOW-204 AC-8 budget.
    it(`AC-2: ${rel} stays within ${COMPACTION_TOKEN_BUDGET} estimated tokens with the rule`, () => {
      expect(estimateTokens(read(rel))).toBeLessThanOrEqual(COMPACTION_TOKEN_BUDGET);
    });
  }
});
