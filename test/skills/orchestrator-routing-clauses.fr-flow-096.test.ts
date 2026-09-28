import { describe, expect, it } from "vitest";

import { section, tableRows, variantBodies } from "./kiwi-orchestrator-variants.js";

// @req FR-FLOW-096  each probe field names its producer and its call
// @req FR-FLOW-097  each disqualifier row carries its predicate, its removal and a unit per threshold
// @req FR-FLOW-098  the mode-switch gate's option rows
// @req FR-FLOW-099  the R-STEP rung's post-return outcomes
// @req FR-FLOW-101  the misroute record and the carry manifests, per trigger
// @req FR-FLOW-103  the five clauses that let route-proposal carry the marker
//
// The routing suite checks these rules by presence in a section; each assertion here is held to the
// one row, bullet or sentence the rule lives on, so a clause dropped from its row — or a condition
// dropped from its sentence — goes red even when the same words survive elsewhere in the section.

const VARIANTS = variantBodies().map((variant) => ({ ...variant, body: variant.body.replace(/\r\n/g, "\n") }));

/** A table row whose first cell matches `first`, as trimmed cells. */
function row(text: string, first: RegExp): string[] {
  return tableRows(text).find((r) => first.test((r.cells[0] ?? "").trim()))?.cells.map((c) => c.trim()) ?? [];
}

/** The Korean sentences of a paragraph — each ends at `다.` */
function sentences(text: string): string[] {
  return text.split(/(?<=다\.)\s+/);
}

/** The line of `text` that opens with `start`. */
function lineStarting(text: string, start: RegExp): string {
  return text.split("\n").find((line) => start.test(line.trim())) ?? "";
}

describe("FR-FLOW-096 AC-2 — every probe field names a producer and a call", () => {
  // The call each row must name, as it is spelled in backticks; the producer is the named party
  // that runs it. A row that names only an artifact or a step passes neither half.
  const EXPECTED: Array<[id: string, producer: RegExp, call: string]> = [
    ["S1", /MCP/, "`get_work_mode`"],
    ["S3", /MCP/, "`list_requirements("],
    ["S3c", /MCP/, "`list_requirements("],
    ["S4", /CLI/, "`speckiwi scopes --json`"],
    ["S5", /code-context 조사자/, "`intake-investigate`"],
    ["S6", /intent 조사자/, "`intake-investigate`"],
    ["S7", /1\.a 소스 분류/, "`intake-qna` · `intake-document` · `intake-issue`"],
    ["S8", /GitHub 이슈/, "`gh issue view`"],
    ["S9", /MCP/, "`get_active_target`"],
    ["S10", /S3c 와 같은/, "`list_requirements("],
    ["S11", /route probe 파서/, "`orchestrate_route_probe`"],
    // Design 09 names no investigator for this file, only "the existing-SRS-context analysis produced
    // during 1.b/1.c"; the row may not claim more than that.
    ["S12", /1\.b\/1\.c 의 기존 SRS 문맥 분석/, "`existing_srs_context.json`"]
  ];

  for (const variant of VARIANTS) {
    it(`FR-FLOW-096 AC-2 ${variant.id}: each of the twelve rows carries its producer and its call in the producer cell`, () => {
      const probe = section(variant.body, /^###\s*4\.2\b/m);
      expect(probe, `${variant.id}: §4.2`).not.toBe("");
      for (const [id, producer, call] of EXPECTED) {
        const cells = row(probe, new RegExp(`^${id}$`));
        expect(cells.length, `${variant.id}: probe row ${id}`).toBe(3);
        const cell = cells[2] as string;
        expect(producer.test(cell), `${variant.id}: row ${id} must name its producer (${producer})`).toBe(true);
        expect(cell.includes(call), `${variant.id}: row ${id} must name its call ${call}`).toBe(true);
      }
      expect(probe).toMatch(/각 필드는 `producer` · `call` · `value` · `read_at` 를 기록한다/);
    });
  }
});

describe("FR-FLOW-097 AC-1 — each disqualifier row: predicate over probe fields, removed rung, unit per threshold", () => {
  // [id, probe fields its predicate reads, removal cell, thresholds the predicate states]
  // [id, probe fields its predicate reads, removal cell, thresholds stated, each threshold with its value]
  const EXPECTED: Array<[string, string[], RegExp, number, RegExp[]]> = [
    // D1 compares twice — S3 non-empty and S3c at least 0.2; `S12 == true` is a boolean, not a threshold.
    ["D1", ["S3", "S3c", "S12"], /^`R-STEP`$/, 2, [/`S3` 이 비지 않음 \(단위: 요구 개수, 1 이상\)/, /`S3c` 가 0\.2 이상일 때 \(단위: 비율, 0–1\)/]],
    ["D2", ["S5"], /^`R-STEP`$/, 1, [/비지 않음 \(단위: 경로 개수, 1 이상\)/]],
    ["D3", ["S4"], /^`R-STEP`$/, 1, [/크기가 2 이상 \(단위: scope 개수\)/]],
    ["D4", ["S7", "S8"], /^`R-STEP`$/, 3, [/`S7\.ordered_sections` 가 2 이상 \(단위: 섹션 개수\)/, /`S8\.task_list_groups` 가 1 이상 \(단위: [^)]+\)/, /`S8\.linked_sub_issues` 가 2 이상 \(단위: [^)]+\)/]],
    // D8 fires only on an id that protects a rung — S1, S6, S9 and S10 protect none (route.ts GATED_BY).
    ["D8", ["S11"], /^fail-closed$/, 1, [/보호하는 rung 이 있는 것이 1개 이상 \(단위: 필드 id 개수\)/]]
  ];

  for (const variant of VARIANTS) {
    it(`FR-FLOW-097 AC-1 ${variant.id}: every row states its fields, its removal, and a unit for each threshold`, () => {
      const table = section(variant.body, /^###\s*4\.3\b/m);
      for (const [id, fields, removal, thresholds, values] of EXPECTED) {
        const cells = row(table, new RegExp(`^\\*\\*${id}\\*\\*`));
        expect(cells.length, `${variant.id}: disqualifier row ${id}`).toBe(3);
        const predicate = cells[1] as string;
        for (const field of fields) {
          // `S12 == true` and `S5.external_paths[]` both read a field; `S3c` is not `S3`.
          expect(new RegExp(`\`${field}(\\.[a-z_\\[\\]]+)?(\\s[^\`]*)?\``).test(predicate), `${variant.id}: ${id} must read probe field ${field}`).toBe(true);
        }
        expect(removal.test(cells[2] as string), `${variant.id}: ${id} removal cell is ${cells[2]}`).toBe(true);
        for (const value of values) expect(value.test(predicate), `${variant.id}: ${id} threshold ${value}`).toBe(true);
        const units = predicate.match(/\(단위: [^)]+\)/g) ?? [];
        expect(units.length, `${variant.id}: ${id} states ${thresholds} threshold(s), each with its unit — got ${JSON.stringify(units)}`).toBe(thresholds);
      }
      // D8's removal is the total map, stated once below the table; the row itself only fails closed.
      expect(table).toMatch(/\*\*모든 술어는 rung 을 제거하고, 어떤 술어도 rung 을 선택하지 않는다\.\*\*/);
      expect(table).toMatch(/\*\*D8 의 사상은 전역\(total\)이다\*\*: `S3` · `S3c` · `S4` · `S5` · `S7` · `S8` · `S12` 는 `R-STEP` 을 제거하고/);
    });
  }
});

describe("FR-FLOW-098 AC-3 — the three options of route-step-requires-mode-switch, row by row", () => {
  for (const variant of VARIANTS) {
    it(`FR-FLOW-098 AC-3 ${variant.id}: each option carries a consequence, only stay-and-orchestrate is recommended, and the two stated effects sit on their rows`, () => {
      const body = section(variant.body, /^###\s*4\.4\b/m);
      const switchRow = row(body, /^\*\*`switch-and-step`\*\*$/);
      const stayRow = row(body, /^\*\*`stay-and-orchestrate`\*\*$/);
      const abortRow = row(body, /^\*\*`abort`\*\*$/);
      for (const [name, cells] of [["switch-and-step", switchRow], ["stay-and-orchestrate", stayRow], ["abort", abortRow]] as const) {
        expect(cells.length, `${variant.id}: ${name} row has action, consequence and marker cells`).toBe(4);
        expect((cells[2] as string).length, `${variant.id}: ${name} carries a consequence line`).toBeGreaterThan(10);
      }
      expect(stayRow[3], `${variant.id}: stay-and-orchestrate carries the marker`).toBe("**있음**");
      expect(switchRow[3], `${variant.id}: switch-and-step carries no marker`).toBe("없음");
      expect(abortRow[3], `${variant.id}: abort carries no marker`).toBe("없음");
      expect(switchRow[2]).toMatch(/영속 프로젝트 전역 work-mode 를 `docs\/spec\/steps\/state\.md` 에 기록한다/);
      expect(abortRow[2]).toMatch(/요구·target·SDS·work-mode 를 하나도 변경하지 않는다/);
    });
  }
});

describe("FR-FLOW-099 AC-3 — the R-STEP rung's post-return outcomes, each on its own bullet", () => {
  for (const variant of VARIANTS) {
    it(`FR-FLOW-099 AC-3 ${variant.id}: the promoted bullet runs the close-out in order, a kiwi-tdd gate halt is reported verbatim, a redirect escalates`, () => {
      const rung = section(variant.body, /^####\s*4\.5\.1\b/m);
      const promoted = lineStarting(rung, /^- \*승급됨\*/);
      expect(promoted, `${variant.id}: the promoted outcome`).not.toBe("");
      const steps = [
        /`outcome: "delegated-complete"`/,
        /\*\*P\.5 run lock 을 해제\*\*/,
        /통합 브랜치를 그대로 두고 run 리포트에 지명/,
        /`validate` → `sync-index` → `validate --fail-on-warning` 을 실행한다/,
        /살아남은 드리프트는 `post-merge-index-drift`\(critical\)다/,
        /run 리포트에 테스트 충분성 확인 결과를 적는다/,
        /`next_hint: null` 과 rung 및 step 을 지명하는 summary 로 `pipeline\.jsonl` 이벤트 1건을 emit/,
        /중단한다\.$/
      ];
      const offsets = steps.map((re) => promoted.search(re));
      for (const [index, offset] of offsets.entries()) expect(offset, `${variant.id}: promoted bullet lacks ${steps[index]}`).toBeGreaterThanOrEqual(0);
      expect([...offsets].sort((a, b) => a - b), `${variant.id}: close-out order`).toEqual(offsets);

      const halted = lineStarting(rung, /^- \*자식 자신의 게이트에서 정지\*/);
      expect(halted, `${variant.id}: the child-gate outcome`).toMatch(/그대로 보고하고 멈춘다\. \*\*다시 라우팅하지 않는다\.\*\*/);
      expect(lineStarting(rung, /^- \*경계 redirect 발화\*/), `${variant.id}: the redirect outcome`).toMatch(/E1 로 승격한다/);
    });
  }
});

describe("FR-FLOW-101 — the misroute record and the carry manifests are stated per trigger", () => {
  for (const variant of VARIANTS) {
    it(`FR-FLOW-101 AC-3 ${variant.id}: the misroute paragraph names the four fields and E1's second-trigger additions under their condition`, () => {
      const body = section(variant.body, /^###\s*4\.7\b/m);
      const record = lineStarting(body, /^\*\*모든 승격은 `routing\/misroute-\{n\}\.json` 을 기록한다\*\*/);
      expect(record, `${variant.id}: the misroute paragraph`).not.toBe("");
      expect(record).toMatch(/probe id, trigger, \*\*발화했어야 할 술어\*\*, 그리고 그 술어가 \*\*필요로 했을 값\*\*/);
      expect(record).toMatch(/E1 의 두 번째 trigger 에서는 anchor 가 맞았어야 할 파일과 관측된 anchor coverage 도 함께 지명한다/);
    });

    it(`FR-FLOW-101 AC-4 ${variant.id}: the carry manifest sentence for each trigger, and the reason green code never enters a wave SDS`, () => {
      const body = section(variant.body, /^###\s*4\.7\b/m);
      const carry = lineStarting(body, /^\*\*carry manifest\.\*\*/);
      expect(carry, `${variant.id}: the carry-manifest paragraph`).not.toBe("");
      const parts = sentences(carry);
      const research = parts.find((s) => s.includes("`design.md`")) ?? "";
      expect(research).toMatch(/step 의 `design\.md` 와 `intent\.md` 는 1\.d 의 연구 입력이 되고 그 뒤 wave 마다 `--research-doc` 인자가 된다/);
      const sealed = parts.find((s) => s.includes("already-implemented") && s.includes("out_of_scope")) ?? "";
      expect(sealed, `${variant.id}: the seal is scoped to the post-green trigger`).toMatch(/^green 이후 trigger 에서는 병합된 테스트와 구현이 \*\*통합 브랜치에 남고\*\*/);
      expect(sealed).toMatch(/`out_of_scope` 와 `exclusion_class = "already-implemented"` 로 봉인된다/);
      const never = parts.find((s) => s.includes("결코 wave SDS 에 들어가지 않는다")) ?? "";
      expect(never).toMatch(/모든 SDS 는 테스트 먼저 구현되고 \*\*의무적 red 확인\*\*을 거치는데 옮겨온 green 코드는 그것을 통과하지 못한다/);
    });
  }
});

describe("FR-FLOW-103 AC-6 — the five clauses of the route-proposal marker", () => {
  const CLAUSES: RegExp[] = [
    /^1\. `probe\.unreadable == \[\]`/,
    /^2\. rung 이 `R-ORCH` 일 때 `decision\.decisive` 가 `null` 이 아니고, 자기 단위에서 margin 이 1 이상이거나, 함께 발화한 다른 술어가 보강하는 boolean 이다/,
    /^3\. 1\.c 의 QnA 뒤 `S6\.ambiguities == 0`/,
    /^4\. rung 이 `R-STEP` 일 때 모드 출처가 `default-wait` 이 아니다/,
    /^5\. rung 이 `R-STEP` 이고 D1 이 측정으로 그것을 통과시켰을 때 `anchor_coverage` 가 0\.2 이상이다/
  ];

  for (const variant of VARIANTS) {
    it(`FR-FLOW-103 AC-6 ${variant.id}: clause n states clause n's condition, and a failed clause is named in withheld_because[]`, () => {
      const body = section(variant.body, /^###\s*4\.6\b/m);
      const clauses = body.split("\n").map((line) => line.trim()).filter((line) => /^\d\.\s/.test(line));
      expect(clauses.length, `${variant.id}: five clauses`).toBe(5);
      for (const [index, pattern] of CLAUSES.entries()) {
        expect(clauses[index], `${variant.id}: clause ${index + 1}`).toMatch(pattern);
      }
      expect(body).toMatch(/`recommended: true` 를 갖는 것은 \*\*다섯 절이 모두 성립할 때뿐\*\*이다/);
      expect(body).toMatch(/성립하지 않으면 표식을 보류하고 `withheld_because\[\]` 가 실패한 절을 지명한다/);
    });
  }
});
