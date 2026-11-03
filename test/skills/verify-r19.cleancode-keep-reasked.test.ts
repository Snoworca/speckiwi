// Round-19 verification. A skill that runs kiwi-review-fix-loop as a hop asks the clean-code question once
// at its own start and forwards only a confirmed SKIP (`--skip-clean-code`). When the user answers "no, keep
// the clean-code check", nothing is forwarded, and the review hop — running in the same session, so it still
// sees "최대한 빨리" in the user's request — finds the speed signal again and asks the same question again
// (kiwi-pm's hand-off, kiwi-pipeline's review hop, and every host hop and the terminal review of an
// orchestrator run). User request B: "최초에 한 번 물어보고".
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOTS = ["skills/claude", "skills/codex", "skills/etc", ".agents/skills"] as const;
const read = (p: string): string => readFileSync(p, "utf8").replace(/\r\n/g, "\n");

function speedParagraph(root: string): string {
  const text = read(join(root, "kiwi-review-fix-loop/SKILL.md"));
  const start = text.indexOf("**빠른 처리.**");
  const end = text.indexOf("\n", start);
  return start < 0 ? "" : text.slice(start, end);
}

function pmText(root: string): string {
  const files = [join(root, "kiwi-pm/SKILL.md"), join(root, "kiwi-pm/references/extended-workflow.md")];
  return files.filter(existsSync).map(read).join("\n");
}

describe("verify-r19 — a caller's recorded 'keep' answer is not asked again by the review hop", () => {
  for (const root of ROOTS) {
    const para = speedParagraph(root);
    const pm = pmText(root);

    it(`${root}: precondition — the hop asks on the user's request, and callers forward only the skip`, () => {
      expect(para).toContain("호출 인자나 사용자 요청이 클린 코드 원칙을 지키지 않아도 된다고 하거나 빠른 처리를 요구하면");
      expect(para).toContain("`--skip-clean-code` 는 이 스킬을 부른 스킬이 이미 확인한 건너뛰기다");
      expect(pm).toContain("`clean_code_skip` 에 `true` 또는 `false` 로 기록한다 — `true` 면 위 hand-off 호출과");
    });

    // @req FR-FLOW-206 AC-5 — after the caller asked once and the user declined, the hop must not ask again.
    it(`${root}: a caller's declined answer reaches the review hop so it does not ask a second time`, () => {
      const forwardsKeep = /--(keep|no-skip)-clean-code|--clean-code[= ]/.test(para + pm);
      const hopSkipsQuestionWhenCalled = /(부른|호출한) 스킬이[^.]*(거절|유지|false|묻지 않)/.test(
        para.replace("`--skip-clean-code` 는 이 스킬을 부른 스킬이 이미 확인한 건너뛰기다", "")
      );
      expect(
        forwardsKeep || hopSkipsQuestionWhenCalled,
        `${root}: only a confirmed skip is forwarded; a declined answer leaves the hop to see the speed signal and ask again`
      ).toBe(true);
    });
  }
});
