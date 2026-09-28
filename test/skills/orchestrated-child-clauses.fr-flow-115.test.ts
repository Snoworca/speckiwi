import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { REPO_ROOT, section } from "./kiwi-orchestrator-variants.js";

// @req FR-FLOW-115  AC-2 — one commit per kiwi-coder run of the SDS, staging an explicit pathspec drawn
//                   from the write set, never the whole tree
// @req FR-FLOW-126  AC-5 — the two recorded reasons for the delegated-entry exclusion survive on the
//                   restated line
//
// Both clauses were asserted only by tokens another line of the same section also carries; here each
// is held to the one bullet the rule is stated on.

const ROOTS = ["skills/claude", "skills/codex", "skills/etc", ".agents/skills"];

const read = (rel: string): string => readFileSync(path.join(REPO_ROOT, rel), "utf8").replace(/\r\n/g, "\n");

describe.each(ROOTS)("FR-FLOW-115 AC-2 — %s/kiwi-pm", (root) => {
  it("FR-FLOW-115 AC-2: the one-commit bullet stages an explicit pathspec drawn from the write set and forbids staging the whole tree", () => {
    const flag = section(read(`${root}/kiwi-pm/SKILL.md`), /^####\s.*`--commit-lane-work`/m);
    expect(flag, `${root}: the --commit-lane-work subsection`).not.toBe("");
    const rule = flag.split("\n").find((line) => line.startsWith("- ") && line.includes("commit 1개")) ?? "";
    expect(rule, `${root}: the commit-granularity bullet`).toMatch(/SDS 의 kiwi-coder 실행 하나당 commit 1개를 만든다 — 실행이 `done` 으로 끝났을 때만\./);
    expect(rule, `${root}: the staged set on the same bullet`).toMatch(/stage 대상은 쓰기 집합에서 뽑은 \*\*명시 pathspec\*\* 이며/);
    expect(rule, `${root}: the whole-tree ban on the same bullet`).toMatch(/\*\*작업 트리 전체를 stage 하지 않는다\*\*\(`git add -A` 금지\)/);
  });
});

describe.each(ROOTS)("FR-FLOW-126 AC-5 — %s/kiwi-pipeline", (root) => {
  it("FR-FLOW-126 AC-5: both recorded reasons sit on the delegated-entry line, in order", () => {
    const routing = section(read(`${root}/kiwi-pipeline/SKILL.md`), /^###\s*2\.8\.2\b/m);
    const rule = routing.split("\n").find((line) => line.startsWith("- **위임 진입은 본 라우팅의 적용 대상이 아니다**")) ?? "";
    expect(rule, `${root}: the restated exclusion line`).not.toBe("");
    const first = rule.search(/\(1\) `kiwi-tdd` 는 `critical_gates\[\]` 를 선언하지만\(`kiwi-tdd` §0\.AG\) 그 표의 3개 게이트는 `--auto` 무관 항상 HALT 이므로, wave 사이클이 요구하는 무인 완주가 성립하지 않는다\./);
    const second = rule.search(/\(2\) `kiwi-tdd` 의 산출물은 design\.md · step SRS · 승격된 요구 블록뿐이어서 wave 종료 검증이 요구하는 SDS · worklog · 리뷰 산출물이 없고, 따라서 증거 번들이 성립하지 않는다\./);
    expect(first, `${root}: reason (1) — the always-HALT gates defeat unattended completion`).toBeGreaterThan(0);
    expect(second, `${root}: reason (2) — no SDS, worklog or review artifacts for the evidence bundle`).toBeGreaterThan(first);
  });
});
