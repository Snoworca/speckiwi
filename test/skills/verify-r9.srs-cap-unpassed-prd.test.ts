import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// Round-9 verification. kiwi-srs §11.2 bounds the verify/improve loop (Normal "최대 **5회**", Max
// "최대 **15회**", plus `--mini` / `--loops N`) but says what happens at the bound only for the
// research A/B loop (§9.6 "상한 도달 시 … 사용자 결정용으로 보고"). For the PRD-verdict loop it
// says nothing: the oscillation guard watches kept `finding_hash` only, and the emit rule maps the
// run to "정상 종료 = TASK_DONE" unless a residual remains. So a run whose intent / goal / in-scope
// item is still `fail` after the last round — the user's request not accepted — has no rule that
// keeps it from ending TASK_DONE with `next_hint` kiwi-srs-feasibility, and `--auto` chains go on.
// kiwi-review-fix-loop, whose shape FR-FLOW-205 reuses (FR-FLOW-203), states "라운드 상한 소진 |
// 잔여 보고 (PASS 아님)". `_shared/kiwi/loop-option.md` §3 surfaces only CRITICAL/HIGH residue at
// the cap, a severity kiwi-srs no longer has.

const REPO_ROOT = fileURLToPath(new URL("../../", import.meta.url));
const read = (rel: string): string => readFileSync(path.join(REPO_ROOT, rel), "utf8").replace(/\r\n/g, "\n");

/** Each rendering whose §11.2 carries a numeric round cap, and the file that holds §11.2. */
const RENDERINGS = [
  { root: "skills/claude", body: "skills/claude/kiwi-srs/SKILL.md" },
  { root: "skills/codex", body: "skills/codex/kiwi-srs/references/extended-workflow.md" },
  { root: ".agents/skills", body: ".agents/skills/kiwi-srs/references/extended-workflow.md" }
] as const;

const section112 = (text: string): string => {
  const start = text.indexOf("### 11.2 종료 조건");
  expect(start, "precondition: §11.2 exists").toBeGreaterThanOrEqual(0);
  const end = text.indexOf("\n### ", start + 1);
  return text.slice(start, end < 0 ? text.length : end);
};

/** Every line of the rendering's kiwi-srs (SKILL.md + references) that ties the round cap to a non-pass ending. */
const capOutcomeLines = (root: string): string[] => {
  const files = [`${root}/kiwi-srs/SKILL.md`, `${root}/kiwi-srs/references/extended-workflow.md`].filter((rel) => existsSync(path.join(REPO_ROOT, rel)));
  const lines = files.flatMap((rel) => read(rel).split("\n"));
  return lines.filter(
    (line) =>
      /(라운드 상한|최대 \*\*\d+회\*\*|상한 (소진|도달)|cap)/.test(line) &&
      /(PRD 판정|\(a\)|fail|kept)/.test(line) &&
      /(통과가 아니|PASS 아님|NEEDS_USER|FAILED)/.test(line) &&
      !/리서치|research|A\/B/.test(line)
  );
};

describe("kiwi-srs says how a run ends when the round cap comes before a PRD pass (verify-r9)", () => {
  for (const { root, body } of RENDERINGS) {
    const text = read(body);

    // @req FR-FLOW-205 AC-4 — precondition: the loop is bounded, an unaccepted item fails, and only a residual maps to NEEDS_USER.
    it(`${root}: precondition — §11.2 caps the loop and the emit rule names TASK_DONE as the normal end`, () => {
      expect(section112(text)).toMatch(/최대 \*\*5회\*\*/);
      expect(text).toMatch(/정상 종료 = `TASK_DONE`; 사용자 결정 보류로 종료 = `NEEDS_USER`\(PRD 판정 residual 이 남은 경우 포함\)/);
      expect(read(`${root}/kiwi-srs/SKILL.md`)).toMatch(/그 항목의 판정은 fail 이고 루프는 통과하지 않는다/);
    });

    // @req FR-FLOW-205 AC-4 AC-8 — "the verdict SHALL be fail and the loop SHALL NOT pass": reaching the cap with an item still fail must not end TASK_DONE.
    it(`${root}: reaching the round cap with a PRD fail or kept finding left is stated as not a pass`, () => {
      expect(
        capOutcomeLines(root),
        `${root}/kiwi-srs names no ending for a loop that hits its round cap before the PRD verdicts pass; the only matching emit rule is "정상 종료 = TASK_DONE"`
      ).not.toEqual([]);
    });
  }
});
