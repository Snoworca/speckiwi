// Round-20 verification. Standalone kiwi-coder (claude rendering) asks the clean-code question once, and when the
// user declines the skip it calls the review hop with BOTH its own forced `--auto` and `--keep-clean-code`. The
// review hop runs in the user's session, so it still sees "최대한 빨리" in the request. Its speed paragraph then
// carries two unconditional rules for that call: "`--auto` 이면 같은 신호가 있을 때 묻지 않고 건너뛴다" and
// "`--keep-clean-code` … 클린 코드 라운드를 돈다" — nothing says which one wins, so the user's "keep" answer can be
// overridden by an `--auto` the user never gave.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (p: string): string => readFileSync(p, "utf8").replace(/\r\n/g, "\n");

function speedParagraph(rel: string): string {
  const text = read(rel);
  const start = text.indexOf("**빠른 처리.**");
  return start < 0 ? "" : text.slice(start, text.indexOf("\n", start));
}

describe("verify-r20 — kiwi-coder's forced --auto must not override the user's recorded keep answer", () => {
  const coder = read("skills/claude/kiwi-coder/SKILL.md");
  const para = speedParagraph("skills/claude/kiwi-review-fix-loop/SKILL.md");

  it("precondition — kiwi-coder sends --auto together with --keep-clean-code, and the hop has both rules", () => {
    expect(coder).toContain('Skill(skill="kiwi-review-fix-loop", args="--req-filter <요구 집합> [--close-reqs 는 CLOSE_SAFE 일 때만] --auto")');
    expect(coder).toContain("`false` 면 `--keep-clean-code` 를 더하고");
    expect(para).toContain("`--auto` 이면 같은 신호가 있을 때 묻지 않고 건너뛴다.");
    expect(para).toContain("`--keep-clean-code` 는 이 스킬을 부른 스킬이 이미 받은 유지 답이다 — 이 인자를 받으면 다시 묻지 않고 클린 코드 라운드를 돌며");
  });

  // @req FR-FLOW-206 AC-5 — either flag is "the user's answer already given"; a caller-added --auto must not flip a keep into a skip.
  it("the speed paragraph says which rule wins when --keep-clean-code arrives with --auto", () => {
    const keepSentence = para.slice(para.indexOf("`--keep-clean-code` 는 이 스킬을 부른"), para.indexOf("`--skip-clean-code` 와 `--keep-clean-code` 를 함께"));
    const autoSentence = para.slice(para.indexOf("`--auto` 이면"), para.indexOf("건너뛰었으면"));
    const keepNamesAuto = keepSentence.includes("--auto");
    const autoDefersToFlags = /--keep-clean-code|--skip-clean-code|호출한 스킬|부른 스킬/.test(autoSentence);
    expect(
      keepNamesAuto || autoDefersToFlags,
      "kiwi-coder's `--auto --keep-clean-code` hits both '--auto 면 건너뛴다' and '--keep-clean-code 면 돈다' with no precedence"
    ).toBe(true);
  });
});
