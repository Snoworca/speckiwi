import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// Round-5 verification: the clean-code block names `--skip-regression` as the run without a
// regression test command (FR-FLOW-206 AC-4). The claude rendering defines that option (natural-language
// table, and Phase 0 turns it on when no test command is detected). The codex, etc and `.agents`
// renderings never define it — their Inputs table has no such option and their preflight instead
// degrades a missing suite command to "report every failure". So in those renderings the block keys
// the "no clean-code rounds" rule on an option that never occurs: a dead reference.

const REPO_ROOT = fileURLToPath(new URL("../../", import.meta.url));
const RENDERINGS = ["skills/claude", "skills/codex", "skills/etc", ".agents/skills"] as const;
const read = (rel: string): string => readFileSync(path.join(REPO_ROOT, rel), "utf8").replace(/\r\n/g, "\n");

function splitBlock(text: string): { block: string; rest: string } {
  const start = text.search(/^## 클린 코드 라운드/m);
  expect(start, "precondition: clean-code block").toBeGreaterThanOrEqual(0);
  const ends = [text.indexOf("\n---\n", start), text.indexOf("\n## ", start + 1)].filter((at) => at >= 0);
  const end = ends.length ? Math.min(...ends) : text.length;
  return { block: text.slice(start, end), rest: text.slice(0, start) + text.slice(end) };
}

describe("the clean-code block's --skip-regression resolves to an option of the rendering (verify-r5)", () => {
  for (const root of RENDERINGS) {
    const skill = `${root}/kiwi-review-fix-loop/SKILL.md`;
    if (!existsSync(path.join(REPO_ROOT, skill))) continue;
    const { block, rest } = splitBlock(read(skill));
    it(`${root}: precondition — the block names --skip-regression`, () => {
      expect(block).toContain("--skip-regression");
    });
    // @req FR-FLOW-206 AC-4 — the no-regression-command case must be one the rendering can actually reach
    it(`${root}: --skip-regression is defined outside the clean-code block`, () => {
      expect(rest).toContain("--skip-regression");
    });
  }
});
