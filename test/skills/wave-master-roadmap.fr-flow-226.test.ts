import { describe, expect, it } from "vitest";

import { NEGATION, readRepoFile, scanUnits, sentencesWith } from "./kiwi-renderings.js";
import { fileSections } from "./rule-blocks.js";

// @req FR-FLOW-226 — a kiwi-wave-master run given ROADMAP_ITEM=RM-<n> makes one update_roadmap_item call
// when it commits its work graph (actual start if empty; the run's scope only into an item that lists
// neither targets nor requirements), one item-limited sync_roadmap_actuals when it ends, and otherwise only
// reads the item; without the input it calls no roadmap tool. The AC numbers are the FR-FLOW-226 block in
// docs/spec/60.workflow-release.srs.md.
//
// The rules are held as whole lines (an exception appended to one changes the line), the call sites are
// read structurally (a roadmap tool named outside the two sections is a call the AC does not allow), and
// the placement is checked against the core blocks the Implementation Notes keep them out of.

// kiwi-wave-master has no .agents mirror (.speckiwi-mirror-exclusions.json).
const RENDERINGS = ["skills/claude", "skills/codex", "skills/etc"] as const;
const file = (root: string): string => `${root}/kiwi-wave-master/SKILL.md`;
const lines = (root: string): string[] => readRepoFile(file(root)).replace(/\r\n/g, "\n").split("\n");

const ROADMAP_TOOL = /\b(?:list_roadmap_items|get_roadmap_item|check_roadmap|add_roadmap_item|update_roadmap_item|sync_roadmap_actuals)\b|speckiwi roadmap\b/;

const INPUT_ROW =
  "| \"로드맵 항목 RM-n\", \"RM-n 을 실행\" | `ROADMAP_ITEM=RM-<n>` (이 run 이 실행하는 로드맵 항목, §3.1) | (없음 — 로드맵 도구를 부르지 않는다) |";

const SECTION_HEADING = "### 3.1 로드맵 항목 (FR-FLOW-226)";
const ABSENT = "`ROADMAP_ITEM` 이 없으면 run 은 로드맵 도구를 하나도 부르지 않는다.";
const READ_ONLY =
  "`ROADMAP_ITEM=RM-<n>` 이 있으면 Phase 0 에서 `get_roadmap_item` 으로 그 항목을 읽고, 그 `Planned End` 는 계획 보고(§1.3 의 wave 분해 결과)에만 쓴다. " +
  "`add_roadmap_item` 은 부르지 않고, `update_roadmap_item` 은 아래 그래프 커밋 때의 한 번만 부르며, 다른 항목에는 `update_roadmap_item` 도 `sync_roadmap_actuals` 도 부르지 않는다. " +
  "자식 스킬 호출에는 `ROADMAP_ITEM` 을 넘기지 않는다.";
const AT_COMMIT =
  "**그래프 커밋 때 한 번.** §3 에서 그래프를 커밋하고 run 의 첫 graph 줄을 쓰는 그때 `get_roadmap_item` 으로 그 항목을 다시 읽어, 아래에서 해당하는 것을 모두 담은 `update_roadmap_item` 을 한 번 부른다. " +
  "사유(`reason`)는 `kiwi-wave-master run {run_id}` 다. 해당하는 것이 없으면 부르지 않고, 재분해로 그래프를 다시 커밋할 때도 부르지 않는다.";
const ACTUAL_START = "- 실제 시작이 비어 있으면(`schedule.actual.start` 가 null, 문서 값 `-`) `actualStart` 를 run 을 시작한 날짜로 쓴다.";
const LINK_SCOPE =
  "- 항목 자신의 `targets` 와 `requirements` 가 둘 다 비어 있을 때만(문서 값 `-`) run 의 범위를 연결한다 — 커밋한 그래프의 `scope` 가 target 이면 제품 target 을 `targets` 로, 요구 목록이면 run 의 요구 ID 를 `requirements` 로 넣는다. " +
  "둘 중 하나라도 적힌 항목의 `Targets` · `Requirements` 는 바꾸지 않는다.";
const SECTION_LINES = [SECTION_HEADING, "", ABSENT, "", READ_ONLY, "", AT_COMMIT, "", ACTUAL_START, LINK_SCOPE, ""];

const RUN_END =
  "**로드맵 항목 (FR-FLOW-226)**: `ROADMAP_ITEM=RM-<n>` 을 받은 run 은 emit 직전에 `sync_roadmap_actuals` 를 `apply` true, `item` 을 그 항목으로 한 번 부른다 — 남은 실제 날짜는 도구가 계산한 상태로만 채운다. " +
  "다른 항목에는 부르지 않는다.";

describe("FR-FLOW-226 AC-1 — ROADMAP_ITEM is an input, and the graph commit makes one update_roadmap_item call", () => {
  for (const root of RENDERINGS) {
    // @req FR-FLOW-226 AC-1
    it(`${file(root)}: §1.2 lists ROADMAP_ITEM=RM-<n> as an optional input`, () => {
      const all = lines(root);
      const start = all.indexOf("### 1.2 선택 입력 + 자연어 매핑");
      const end = all.indexOf("### 1.3 출력");
      expect(start).toBeGreaterThan(0);
      expect(all.slice(start, end).filter((line) => line.includes("ROADMAP_ITEM"))).toEqual([INPUT_ROW]);
    });

    // @req FR-FLOW-226 AC-1 AC-3 AC-4 — the section is exactly these lines, right after §3 and before §4.
    it(`${file(root)}: §3.1 is exactly the read-only rule and the one commit-time call, between §3 and §4`, () => {
      const all = lines(root);
      const start = all.indexOf(SECTION_HEADING);
      expect(start).toBeGreaterThan(0);
      expect(all.slice(start, start + SECTION_LINES.length)).toEqual(SECTION_LINES);
      expect(all[start + SECTION_LINES.length]).toMatch(/^## 4\. /);
      const above = all.slice(0, start).reverse().find((line) => /^#{1,6} /.test(line));
      expect(above).toMatch(/^## 3\. Phase 1 /);
    });
  }
});

describe("FR-FLOW-226 AC-2 — the run end makes one sync_roadmap_actuals call limited to the item", () => {
  for (const root of RENDERINGS) {
    // @req FR-FLOW-226 AC-2
    it(`${file(root)}: §9 carries the item-limited sync as a whole line`, () => {
      const sections = fileSections(file(root));
      const emit = sections.find((section) => /^## 9\. Pipeline emit/.test(section.heading));
      expect(emit).toBeDefined();
      expect(emit!.body.split("\n").filter((line) => line.includes("sync_roadmap_actuals"))).toEqual([RUN_END]);
    });
  }
});

describe("FR-FLOW-226 AC-3 · AC-4 — no other roadmap call, and none outside the two sections or in the core blocks", () => {
  for (const root of RENDERINGS) {
    // @req FR-FLOW-226 AC-3 AC-4 — a roadmap tool named anywhere else is a call the AC does not allow.
    it(`${file(root)} names roadmap tools only in §3.1 and §9`, () => {
      const sites = fileSections(file(root)).flatMap((section) =>
        scanUnits(section.body).filter((unit) => ROADMAP_TOOL.test(unit.text)).map(() => section.heading)
      );
      expect(sites.length).toBeGreaterThan(0);
      expect([...new Set(sites)].sort()).toEqual([SECTION_HEADING, "## 9. Pipeline emit (의무)"].sort());
    });

    // @req FR-FLOW-226 AC-3 — add_roadmap_item is only ever refused.
    it(`${file(root)}: every sentence naming add_roadmap_item is a refusal`, () => {
      const naming = sentencesWith(readRepoFile(file(root)), /add_roadmap_item/);
      expect(naming.length).toBeGreaterThan(0);
      for (const sentence of naming) expect(sentence).toMatch(NEGATION);
    });

    // @req FR-FLOW-226 AC-1 — the Implementation Notes keep the calls out of the core blocks the wave rules own.
    it(`${file(root)}: no core-rule section names ROADMAP_ITEM or a roadmap tool`, () => {
      const core = fileSections(file(root)).filter((section) => /^## 핵심 규칙/.test(section.heading));
      expect(core.length).toBeGreaterThan(0);
      for (const section of core) {
        expect(section.body, section.heading).not.toMatch(ROADMAP_TOOL);
        expect(section.body, section.heading).not.toContain("ROADMAP_ITEM");
      }
    });
  }
});
