// Round-21 verification. kiwi-pipeline asks the clean-code question once at Phase 0 when the request asks for
// speed, then runs kiwi-srs → (feasibility) → kiwi-pm before its review hop. It has no resume state file, so the
// answer is written only by the review hop (its own `state.json`) and in the pipeline event written at the END
// of the call. A cycle that stops before the review hop — kiwi-srs ends NEEDS_USER on a PRD residual or an
// unapproved PRD, kiwi-pm ends NEEDS_USER — is continued by a new pipeline call (§2.5.2 `--from=feasibility`,
// or §6.3 child `--resume` then the T1 recommendation). That call carries no speed words, so it neither asks nor
// forwards `--skip-clean-code`, and nothing tells it to read the answer back from the earlier event's `notes`:
// the review hop runs up to three clean-code rounds the user already chose to skip (request B "최초에 한 번
// 물어보고 클린 코드 검사를 진행하지 않도록").
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOTS = ["skills/claude", "skills/codex", "skills/etc", ".agents/skills"] as const;

function cleanCodeBullet(root: string): string {
  const text = readFileSync(join(root, "kiwi-pipeline", "SKILL.md"), "utf8").replace(/\r\n/g, "\n");
  return text.split("\n").find((line) => line.startsWith("- 클린 코드 건너뛰기:")) ?? "";
}

describe("verify-r21 — kiwi-pipeline keeps the clean-code answer across a continued cycle", () => {
  for (const root of ROOTS) {
    // @req FR-FLOW-206 AC-5 — precondition: the answer is recorded only by the review hop and the end-of-call event.
    it(`${root}: precondition — the bullet records the answer only in the hop state and the end event notes`, () => {
      const bullet = cleanCodeBullet(root);
      expect(bullet).toContain("재개 상태 파일이 없으므로");
      expect(bullet).toContain("끝에 쓰는 `pipeline.jsonl` 이벤트의 `notes`");
    });

    // @req FR-FLOW-206 AC-5 — a continued cycle (a new pipeline call after a NEEDS_USER stop) must follow the recorded answer.
    it(`${root}: a later pipeline call that continues the cycle follows the recorded answer instead of dropping it`, () => {
      const bullet = cleanCodeBullet(root);
      expect(
        /다시 묻지 않|기록된 (답|값)을 따른다|--from/.test(bullet),
        "no rule makes a continued cycle (--from / child --resume then T1) read the recorded clean-code answer back",
      ).toBe(true);
    });
  }
});
