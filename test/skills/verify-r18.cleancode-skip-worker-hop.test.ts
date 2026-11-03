// Round-18 verification. kiwi-review-fix-loop skips the clean-code rounds when "호출 인자나 사용자 요청"
// asks for speed (`ASAP`, `아삽`, `최대한 빨리`) — and `--mini` / `--loops` are explicitly NOT such a
// signal. In an R-ORCH run (kiwi-orchestrator or kiwi-wave-master) every wave's code is reviewed by the
// wave WORKER, a dispatched subagent in its own worktree, which calls kiwi-review-fix-loop on its window
// (`_shared/kiwi/parallel-waves.md` PW-6 step 5). The worker never sees the user's message, and the
// pass-through it gets is only `[--auto] [--max] [--mini|--loops N]`; nothing in PW-6 carries the speed
// signal or the clean-code skip decision. So `/kiwi-orchestrator --auto 최대한 빨리 RBAC 붙여줘` still
// runs up to three clean-code rounds (each with a full regression run) in every wave worker — the
// clean-code check the user asked to drop.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOTS = ["skills/claude", "skills/codex", "skills/etc", ".agents/skills"] as const;
const read = (p: string): string => readFileSync(p, "utf8").replace(/\r\n/g, "\n");

function workerSection(root: string): string {
  const text = read(join(root, "_shared/kiwi/parallel-waves.md"));
  const start = text.indexOf("**PW-6");
  const end = text.indexOf("**PW-7", start);
  return start < 0 || end < 0 ? "" : text.slice(start, end);
}

describe("verify-r18 — the clean-code skip reaches the wave worker's review hop", () => {
  for (const root of ROOTS) {
    const worker = workerSection(root);
    const loop = read(join(root, "kiwi-review-fix-loop/SKILL.md"));

    it(`${root}: precondition — the worker reviews its own window with kiwi-review-fix-loop and the loop keys the skip on its arguments or the user's request`, () => {
      expect(worker).toContain('skill: "kiwi-review-fix-loop"');
      expect(worker).toContain("[--auto] [--max] [--mini|--loops N]");
      expect(loop).toContain("호출 인자나 사용자 요청이 클린 코드 원칙을 지키지 않아도 된다고 하거나 빠른 처리를 요구하면");
      expect(loop).toContain("`--mini`, `--loops` 같은 라운드 상한 옵션은 빠른 처리 신호가 아니다");
    });

    // @req FR-FLOW-206 AC-5 — a speed request to the orchestrator must also skip the worker's clean-code rounds.
    it(`${root}: the worker's review hop receives the speed signal or the clean-code skip decision`, () => {
      expect(
        /클린 코드|clean-code|clean_code|빠른 처리|ASAP|아삽/.test(worker),
        `${root}: PW-6 forwards nothing that lets the worker's kiwi-review-fix-loop skip the clean-code rounds`,
      ).toBe(true);
    });
  }
});
