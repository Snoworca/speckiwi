import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { REPO_ROOT, section } from "./kiwi-orchestrator-variants.js";

// @req FR-FLOW-131  the terminal-hop rule separates the one return-value-driven non-execution path
//                   from the two window-decided branches
//
// Every assertion reads one paragraph of §4.5's preamble — the text above its first `####` — and one
// sentence inside it, so a clause moved to a rung subsection or to §11.2 no longer counts.

const COPIES = ["skills/claude", "skills/codex", "skills/etc", ".agents/skills"].map((root) => `${root}/kiwi-orchestrator/SKILL.md`);

const read = (rel: string): string => readFileSync(path.join(REPO_ROOT, rel), "utf8").replace(/\r\n/g, "\n");

/** §4.5 above its first `####` subsection. */
function preamble(copy: string): string {
  return section(read(copy), /^###\s*4\.5\s/m).split(/^#{4,6}\s/m)[0] as string;
}

/** The preamble paragraph that opens with `anchor`. */
function paragraph(copy: string, anchor: RegExp): string {
  return preamble(copy).split("\n").find((line) => anchor.test(line)) ?? "";
}

/** The sentences of a paragraph — each ends at a full stop followed by whitespace (`다.`, `(§11.2).`). */
function sentences(text: string): string[] {
  return text.split(/(?<=\.)\s+/);
}

describe.each(COPIES)("FR-FLOW-131 — the window-decided branches of the terminal hop (%s)", (copy) => {
  it("FR-FLOW-131 AC-2: §0.4 is the only return-value-driven non-execution path, and both window branches are decided by the window", () => {
    const rule = paragraph(copy, /반환값에 조건 걸지 않는다/);
    expect(rule, `${copy}: the return-value paragraph`).not.toBe("");
    for (const token of ["`TASK_DONE`", "`NEEDS_USER`", "`FAILED`", "§0.4"]) {
      expect(rule.includes(token), `${copy}: the paragraph must name ${token}`).toBe(true);
    }
    // "the only non-execution path" is false once the window branches exist; the qualifier is what
    // makes the sentence true, so it is pinned inside the sentence that names §0.4.
    const only = sentences(rule).find((s) => /§0\.4 halt/.test(s)) ?? "";
    expect(only, `${copy}: §0.4 must be qualified as the only RETURN-VALUE-driven path`).toMatch(
      /§0\.4 halt 가 \*\*반환값으로 정해지는 유일한\*\* 비실행 경로다/
    );
    expect(/`no-host-code-commits` 는 이 경로가 아니다/.test(rule), `${copy}: the old denial contradicts the rule`).toBe(false);

    const window = sentences(rule).find((s) => s.includes("`no-host-code-commits`")) ?? "";
    expect(window, `${copy}: no-host-code-commits must be placed beside the empty window`).toContain("`not-applicable-empty-window`");
    expect(window, `${copy}: both are decided by the window, not by a return value`).toMatch(/반환값이 아니라 \*\*창으로 정해진다\*\*/);
  });

  it("FR-FLOW-131 AC-3: the branch paragraph records no-host-code-commits in place of the hop, beside the empty-window and halted branches", () => {
    const branches = paragraph(copy, /^경계가 심판하는 커밋 창이 비어 있으면/);
    expect(branches, `${copy}: the branch paragraph`).not.toBe("");
    const empty = sentences(branches).find((s) => s.includes("not-applicable-empty-window")) ?? "";
    expect(empty, `${copy}: an empty window must not fire the gate`).toMatch(/게이트는 \*\*발동하지 않는다\*\*/);
    const halted = sentences(branches).find((s) => s.includes("skipped-run-halted")) ?? "";
    expect(halted, `${copy}: the halt branch is the one after commits landed`).toMatch(/^커밋이 착지한 \*\*뒤\*\* run 이 게이트에서 멈췄으면/);
    expect(halted, `${copy}: a halted run is not reported complete`).toMatch(/\*\*완료로 보고하지 않는다\*\*/);

    const noCode = sentences(branches).find((s) => s.includes("`no-host-code-commits`")) ?? "";
    expect(noCode, `${copy}: the no-code host window must be one of the stated branches`).not.toBe("");
    expect(noCode, `${copy}: the branch is the R-ORCH host window, not any boundary`).toMatch(/^R-ORCH 의 wave 마감에서 병합 뒤 호스트 창에 커밋은 있지만/);
    expect(noCode, `${copy}: the branch is keyed on the window's file classes`).toMatch(/`kiwi-review-fix-loop` §11 의 부류로 코드 파일이 하나도 없으면/);
    expect(noCode, `${copy}: the verdict is recorded in place of the hop`).toMatch(/hop 대신 `no-host-code-commits` 를 그 stage 마감의 저널 줄 `notes` 와 run 리포트에 기록하고/);
    expect(noCode, `${copy}: it is not a terminal_review verdict`).toMatch(/`terminal_review\.verdict` 의 값이 아니다/);
    expect(noCode, `${copy}: like the empty window, it does not fire the gate`).toMatch(/게이트는 마찬가지로 \*\*발동하지 않는다\*\*/);
  });
});
