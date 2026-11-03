// Round-12 verification. The clean-code block asks once at the start whether to skip the clean-code
// check when the request asks for speed (`ASAP`, `아삽`, `최대한 빨리`) and skips every clean-code round
// when the user confirms (or, under `--auto`, without asking). That answer lives only in the
// conversation: the resumable state (`.kiwi/sessions/{run-id}/state.json`, claude schema
// `mode_flags` · `fix_iter` · `clean_code_round` …) has no record of it, and the `--resume`
// algorithm re-enters at `state.json.phase` without re-deriving it. A run the user told to skip
// clean-code that is resumed (or loses the answer to a compaction) reaches Phase 6.5 and runs the
// clean-code rounds the user declined.
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOTS = ["skills/claude", "skills/codex", "skills/etc", ".agents/skills"] as const;

function renderingText(root: string): string {
  const dir = join(root, "kiwi-review-fix-loop");
  const refs = join(dir, "references");
  const parts = [readFileSync(join(dir, "SKILL.md"), "utf8")];
  if (existsSync(refs)) {
    for (const name of readdirSync(refs).filter((n) => n.endsWith(".md")).sort()) {
      parts.push(readFileSync(join(refs, name), "utf8"));
    }
  }
  return parts.join("\n");
}

describe("verify-r12 — the confirmed clean-code skip survives a resume", () => {
  for (const root of ROOTS) {
    // @req FR-FLOW-206 AC-5 — the user's confirmed skip must reach the resumed run, so the state that
    // --resume reads has to record it (a line naming the run state together with the clean-code skip).
    it(`${root}/kiwi-review-fix-loop: the resumable state records the clean-code skip decision`, () => {
      // `--skip-regression` is the no-test-command option, not the speed-request skip.
      const lines = renderingText(root).replace(/--skip-regression/g, "").split("\n");
      const recorded = lines.filter(
        (l) => /state/i.test(l) && /(클린 코드|clean.?code)/i.test(l) && /(건너뛴|건너뛰|건너뜀|skip)/i.test(l),
      );
      expect(recorded, `${root}: no state field or resume rule carries the clean-code skip decision`).not.toEqual([]);
    });
  }
});
