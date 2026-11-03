// Round-19 verification. In the Claude rendering, standalone kiwi-coder (no `--auto` from the user) always
// hands off to kiwi-review-fix-loop with a hard-coded `--auto`. The review hop runs in the user's session,
// so `/kiwi-coder --req-filter FR-X 최대한 빨리` gives it the speed signal plus `--auto`, and the clean-code
// block says `--auto` skips the clean-code rounds WITHOUT asking. kiwi-coder itself never asks (it has no
// clean-code rule), so the user is never asked — user request B ("최초에 한 번 물어보고").
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (p: string): string => readFileSync(p, "utf8").replace(/\r\n/g, "\n");
const FORCED =
  'Skill(skill="kiwi-review-fix-loop", args="--req-filter <요구 집합> [--close-reqs 는 CLOSE_SAFE 일 때만] --auto")';

describe("verify-r19 — standalone kiwi-coder does not turn a speed request into an unasked clean-code skip", () => {
  const coder = read("skills/claude/kiwi-coder/SKILL.md");
  const loop = read("skills/claude/kiwi-review-fix-loop/SKILL.md");

  it("precondition — the standalone hand-off hard-codes --auto, and --auto skips clean code without asking", () => {
    expect(coder).toContain(FORCED);
    expect(coder).toContain("3지선다 없이 끝에서 **항상** `kiwi-review-fix-loop` 로 넘긴다");
    expect(loop).toContain("`--auto` 이면 같은 신호가 있을 때 묻지 않고 건너뛴다");
  });

  // @req FR-FLOW-206 AC-5 — a skill that runs the review loop as a hop asks once at its start.
  it("kiwi-coder asks the clean-code question once, or does not force --auto onto the review hop", () => {
    const handlesCleanCode = /클린 코드|skip-clean-code|clean_code|빠른 처리/.test(coder);
    expect(
      handlesCleanCode || !coder.includes(FORCED),
      "claude kiwi-coder forces --auto on the review hop and never asks, so a speed request skips clean code unasked"
    ).toBe(true);
  });
});
