// Round-23 verification. The clean-code round lets the fixer apply naming and dead-code findings, and
// the block says clean-code findings never change the run's terminal state. But the preservation scan
// runs over every "fixer pass" diff and halts the run at a critical gate (`existing-public-contract-change`,
// `existing-test-weakened-or-deleted`) when an existing public symbol is renamed or removed, or an existing
// test case is removed. No rendering says what a clean-code fix that trips the scan does, so renaming an
// exported function for a naming finding in a committed review window (kiwi-tdd / orchestrator / wave hop)
// halts the whole run, also under `--auto`, instead of being reverted and marked `unresolved`.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOTS = ["skills/claude", "skills/codex", "skills/etc", ".agents/skills"] as const;

const read = (path: string): string => readFileSync(path, "utf8").replace(/\r\n/g, "\n");

function skillTexts(root: string): string[] {
  const dir = join(root, "kiwi-review-fix-loop");
  const files = [join(dir, "SKILL.md")];
  const refs = join(dir, "references");
  if (existsSync(refs)) for (const f of readdirSync(refs)) if (f.endsWith(".md")) files.push(join(refs, f));
  return files.map(read);
}

function cleanCodeBlock(text: string): string {
  const start = text.search(/^## 클린 코드 라운드/m);
  expect(start, "precondition — clean-code block").toBeGreaterThanOrEqual(0);
  const ends = [text.indexOf("\n---\n", start), text.indexOf("\n## ", start + 1)].filter((at) => at >= 0);
  return text.slice(start, Math.min(...ends));
}

describe("verify-r23 — a clean-code fix that trips the preservation scan has a defined, non-halting outcome", () => {
  for (const root of ROOTS) {
    // @req FR-FLOW-206 AC-1 — clean-code findings SHALL NOT block the pass condition; a naming or dead-code
    // fix the preservation scan rejects must be reverted and marked, not halt the run at a critical gate.
    it(`${root}/kiwi-review-fix-loop: says how a clean-code fix rejected by the preservation scan is handled`, () => {
      const texts = skillTexts(root);
      const main = texts[0];
      const block = cleanCodeBlock(main);
      expect(block, "precondition: naming and dead code are clean-code findings").toMatch(/명명/);
      expect(block, "precondition: naming and dead code are clean-code findings").toMatch(/죽은 코드/);
      expect(block, "precondition: the fixer applies clean-code findings").toMatch(/fixer 는 `clean-code` 지적을/);
      expect(block, "precondition: clean-code findings do not change the terminal state").toMatch(/종료 상태를 바꾸지 않는다/);
      expect(main, "precondition: the scan covers every fixer-pass diff").toMatch(/fixer pass 가 적용한 \*\*diff\*\* 를 스캔한다/);
      expect(main, "precondition: the scan halts through its critical gate").toMatch(/기존 public 심볼의 삭제·시그니처 변경[^\n]*중단한다/);

      const lines = texts.join("\n").split("\n");
      const handled = lines.some(
        (l) =>
          /클린 코드|clean-code|clean_code/.test(l) &&
          /보존 스캔|§0\.17|existing-public-contract-change|existing-test-weakened-or-deleted|preservation scan/.test(l) &&
          /되돌|unresolved|revert/.test(l),
      );
      expect(
        handled,
        "no line ties a clean-code fix to the preservation scan with a revert/unresolved outcome — a naming fix that renames an existing export halts the run",
      ).toBe(true);
    });
  }
});
