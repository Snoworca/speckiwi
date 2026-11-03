// Round-13 verification. The clean-code block (the part that survives a compaction) asks once at the
// start whether to skip the clean-code check, but lets the answer be written to `state.json`
// `clean_code_skip` any time "before the first clean-code round would start" — i.e. as late as the
// entry to Phase 6.5. The answer is given at Phase 0 and the functional fix loop (Phases 1–6) runs in
// between, so a compaction in that window drops the confirmed skip before it is on disk, and the run
// reaches the clean-code rounds with `clean_code_skip = null`. The block has to pin the write to the
// moment the answer is given (Phase 0), not to a deadline at the start of the rounds.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOTS = ["skills/claude", "skills/codex", "skills/etc", ".agents/skills"] as const;

function cleanCodeBlock(root: string): string {
  const text = readFileSync(join(root, "kiwi-review-fix-loop", "SKILL.md"), "utf8").replace(/\r\n/g, "\n");
  const start = text.search(/^## 클린 코드 라운드/m);
  expect(start, `${root}: precondition — clean-code block`).toBeGreaterThanOrEqual(0);
  const ends = [text.indexOf("\n---\n", start), text.indexOf("\n## ", start + 1)].filter((at) => at >= 0);
  return text.slice(start, Math.min(...ends));
}

describe("verify-r13 — the clean-code skip answer is on disk before the fix loop can lose it", () => {
  for (const root of ROOTS) {
    // @req FR-FLOW-206 AC-5 — the answer given once at the start must be written when it is given, so a
    // compaction during Phases 1–6 cannot drop it before the clean-code rounds read it.
    it(`${root}/kiwi-review-fix-loop: the block writes clean_code_skip when the answer is given (Phase 0)`, () => {
      const block = cleanCodeBlock(root);
      expect(block, "precondition: the block records clean_code_skip").toContain("clean_code_skip");
      const pinned =
        /(Phase 0|답을 받(으면|는 즉시|은 즉시)|묻고 답을 받은 즉시|곧바로|즉시)[^\n]{0,120}clean_code_skip|clean_code_skip[^\n]{0,120}(Phase 0|곧바로|즉시)/.test(
          block,
        );
      expect(pinned, `${root}: the block only requires the write "before the first clean-code round"`).toBe(true);
    });
  }
});
