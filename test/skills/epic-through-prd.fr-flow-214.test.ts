import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { REPO_ROOT } from "./kiwi-orchestrator-variants.js";

// FR-FLOW-214 — an epic issue enters through PRD, SRS and decomposition: the epic is U-1, its sub-issues
// are hints for PRD items, and no wave is extracted from its structure, task list or sub-issues.

const read = (rel: string): string => readFileSync(path.join(REPO_ROOT, rel), "utf8");
const WAVE_MASTER = ["skills/claude", "skills/codex", "skills/etc"].map((root) => `${root}/kiwi-wave-master/SKILL.md`);

/** The `## 8.` section of a wave-master rendering. */
function epicSection(text: string): string {
  const start = text.indexOf("\n## 8. ");
  return start < 0 ? "" : text.slice(start, text.indexOf("\n## ", start + 1));
}

describe("FR-FLOW-214 AC-1 — the epic becomes a PRD, then the shared order runs", () => {
  // @req FR-FLOW-214 AC-1
  it.each(WAVE_MASTER)("%s: kiwi-prd takes the epic as U-1 and the sub-issues as PRD item hints", (rel) => {
    const epic = epicSection(read(rel));
    expect(epic, `${rel}: no §8`).not.toBe("");
    expect(epic).toContain("gh issue view {N} --json title,body,comments");
    // Held whole: the `[^\n]*` form survived "`kiwi-prd` 를 부르지 않고 … 제목과 본문을 `U-1`".
    expect(epic).toContain("`kiwi-prd` 를 불러 에픽의 제목과 본문을 `U-1` 로 기록한다.");
    // Held whole: a looser match survived an inserted exception ("…힌트로 넘기거나, 하위 이슈가 많으면 …").
    expect(epic).toContain("에픽의 하위 이슈는 PRD 항목의 힌트로만 넘긴다 — 하위 이슈를 세는 방법은");
    expect(epic).toContain("`wave-decomposition.md §2`");
  });

  // @req FR-FLOW-214 AC-1 — what the epic entry no longer does.
  it.each(WAVE_MASTER)("%s: no wave is extracted from the epic's structure, task list or sub-issues", (rel) => {
    const text = read(rel);
    for (const re of [/추출 가능한 구조|extractable structure/, /research-skip/, /태스크 리스트 그룹|task-list group/, /wave 를 \*\*?추출|wave 집합을 \*\*추출/, /나열 순서가 곧 wave 순서/]) {
      expect(text, `${rel}: ${re}`).not.toMatch(re);
    }
    expect(epicSection(text)).toContain("wave 를 뽑지 않는다");
  });
});
