import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// Round-4 verification: the loop-option SSOT every kiwi skill follows defines `--mini` as the
// "빠른 모드 프리셋" (natural language "빠른 모드", "quick"), and orchestrators propagate `--mini` to
// kiwi-review-fix-loop on their own. The clean-code block says an invocation ARGUMENT that asks for
// speed triggers the skip question (and under `--auto` skips without asking), but never says whether
// `--mini` is such an argument — one reading silently drops every clean-code round of
// `kiwi-orchestrator --auto --mini`, the other ignores a user who asked for "빠른 모드".

const REPO_ROOT = fileURLToPath(new URL("../../", import.meta.url));
const RENDERINGS = ["skills/claude", "skills/codex", "skills/etc", ".agents/skills"] as const;
const read = (rel: string): string => readFileSync(path.join(REPO_ROOT, rel), "utf8").replace(/\r\n/g, "\n");

function cleanCodeBlock(text: string): string {
  const start = text.search(/^## (클린 코드 라운드|Clean-code rounds?)/m);
  expect(start, "precondition: clean-code block").toBeGreaterThanOrEqual(0);
  // The block ends at the next `---` rule or the next `## ` heading, whichever comes first.
  const ends = [text.indexOf("\n---\n", start), text.indexOf("\n## ", start + 1)].filter((at) => at >= 0);
  return text.slice(start, ends.length ? Math.min(...ends) : text.length);
}

describe("the clean-code speed signal settles --mini (verify-r4)", () => {
  for (const root of RENDERINGS) {
    const loopOption = `${root}/_shared/kiwi/loop-option.md`;
    const skill = `${root}/kiwi-review-fix-loop/SKILL.md`;
    if (!existsSync(path.join(REPO_ROOT, loopOption)) || !existsSync(path.join(REPO_ROOT, skill))) continue;
    it(`${root}: precondition — --mini is defined as the fast-mode preset`, () => {
      expect(read(loopOption)).toMatch(/`--mini` \| (빠른 모드 프리셋|Quick-mode preset)/);
    });
    // @req FR-FLOW-206 AC-5 — whether the fast-mode argument `--mini` is a speed signal must be stated
    it(`${root}: the clean-code block says whether --mini is a speed signal`, () => {
      expect(cleanCodeBlock(read(skill))).toContain("--mini");
    });
  }
});
