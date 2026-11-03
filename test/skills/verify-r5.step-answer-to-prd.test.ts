import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// Round-5 verification: kiwi-tdd and kiwi-step call kiwi-prd and end NEEDS_USER when a verifier
// claims an ungrounded line is necessary without naming the hole it fills. Their PRD rules never say
// that the user's answer to that question is appended to the PRD as the next `U-<n>` through kiwi-prd
// — kiwi-srs, kiwi-orchestrator and kiwi-wave-master all say it. Without it the answer that adds the
// scope stays outside the PRD, so on resume rule (b) drops the same line again or the run loops on
// NEEDS_USER; the answer is also lost at the next compaction, the incident the PRD exists to stop.

const REPO_ROOT = fileURLToPath(new URL("../../", import.meta.url));
const RENDERINGS = ["skills/claude", "skills/codex", "skills/etc", ".agents/skills"] as const;
const read = (rel: string): string => readFileSync(path.join(REPO_ROOT, rel), "utf8").replace(/\r\n/g, "\n");
const has = (rel: string): boolean => existsSync(path.join(REPO_ROOT, rel));

/** The kiwi-tdd PRD core block: from its `## 핵심 규칙` heading to the next `---` rule. */
function tddCoreBlock(text: string): string {
  const start = text.search(/^## 핵심 규칙 — 컴팩션 뒤에도 남는 PRD 판정/m);
  expect(start, "precondition: kiwi-tdd PRD core block").toBeGreaterThanOrEqual(0);
  const end = text.indexOf("\n---\n", start);
  return text.slice(start, end < 0 ? text.length : end);
}

/** The kiwi-step §0.9 row (PRD judgment). */
function stepPrdRow(text: string): string {
  const row = text.split("\n").find((line) => line.startsWith("| §0.9 |")) ?? "";
  expect(row, "precondition: kiwi-step §0.9 row").toMatch(/kiwi-prd/);
  return row;
}

const APPENDS_ANSWER = /U-<n>/;

describe("a step skill appends the user's answer to the PRD before acting on it (verify-r5)", () => {
  for (const root of RENDERINGS) {
    const tdd = `${root}/kiwi-tdd/SKILL.md`;
    if (has(tdd)) {
      it(`${root}/kiwi-tdd: precondition — the core block can end NEEDS_USER on a necessity claim`, () => {
        expect(tddCoreBlock(read(tdd))).toMatch(/NEEDS_USER/);
      });
      // @req FR-FLOW-204 AC-11 — any caller of kiwi-prd appends the user's answer as the next U-<n> through kiwi-prd
      it(`${root}/kiwi-tdd: the core block appends the user's answer as the next U-<n> through kiwi-prd`, () => {
        expect(tddCoreBlock(read(tdd))).toMatch(APPENDS_ANSWER);
      });
    }
    const step = `${root}/kiwi-step/SKILL.md`;
    if (has(step)) {
      // @req FR-FLOW-204 AC-11 — kiwi-step is a caller of kiwi-prd (AC-12) and must ground an answer the same way
      it(`${root}/kiwi-step: §0.9 appends the user's answer as the next U-<n> through kiwi-prd`, () => {
        expect(stepPrdRow(read(step))).toMatch(APPENDS_ANSWER);
      });
    }
  }
});
