import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// Round-6 verification: FR-FLOW-206 AC-4 keys "no clean-code rounds" on the run that has no regression
// test command, and the clean-code block names that run `--skip-regression`. Every rendering also keeps
// a second, contradicting rule for the same condition: "캡처 실패 격하 … (스위트 명령 미검출 등) →
// regression_baseline = null, 실패 전량 보고로 격하". Under that reading the run is not `--skip-regression`,
// so clean-code rounds run, but the block's keep test ("회귀 기준선 대비 신규 실패 0") has no baseline to
// compare against, and the block never says what a null baseline means. In codex, etc and `.agents` the
// contradiction is new: the `--skip-regression` row ("turned on automatically … when no test command is
// detected") was added in this change; in claude both lines pre-exist.

const REPO_ROOT = fileURLToPath(new URL("../../", import.meta.url));
const RENDERINGS = ["skills/claude", "skills/codex", "skills/etc", ".agents/skills"] as const;
const read = (rel: string): string => readFileSync(path.join(REPO_ROOT, rel), "utf8").replace(/\r\n/g, "\n");

function cleanCodeBlock(text: string): string {
  const start = text.search(/^## 클린 코드 라운드/m);
  expect(start, "precondition: clean-code block").toBeGreaterThanOrEqual(0);
  const ends = [text.indexOf("\n---\n", start), text.indexOf("\n## ", start + 1)].filter((at) => at >= 0);
  return text.slice(start, ends.length ? Math.min(...ends) : text.length);
}

describe("the clean-code rule has one reading when no test command exists (verify-r6)", () => {
  for (const root of RENDERINGS) {
    const text = read(`${root}/kiwi-review-fix-loop/SKILL.md`);
    const lines = text.split("\n");
    const autoOn = lines.find((l) => l.includes("--skip-regression") && /자동 활성|turned on automatically/.test(l)) ?? "";
    const degrade = lines.find((l) => l.includes("캡처 실패 격하")) ?? "";
    it(`${root}: precondition — no test command turns on --skip-regression`, () => {
      expect(autoOn).not.toBe("");
    });
    // @req FR-FLOW-206 AC-4 — "no regression test command" must route to the no-clean-code-rounds case only
    it(`${root}: the capture-failure degrade does not also claim the missing suite command`, () => {
      expect(degrade).not.toContain("스위트 명령 미검출");
    });
    // @req FR-FLOW-206 AC-4 — a fix is kept only when it passes the regression command; a null baseline must be decided
    it(`${root}: the clean-code block says what a null regression baseline means for a fix`, () => {
      expect(cleanCodeBlock(text)).toMatch(/기준선(이|을)? ?(없|null)|regression_baseline/);
    });
  }
});
