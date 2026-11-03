import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// FR-FLOW-205 AC-8: the etc single-worker profile needs three consecutive passing rounds, and a run
// whose round cap arrives before the loop passes must not end TASK_DONE. The etc cap stop fires only
// when "통과한 라운드가 없으면" (no round passed), so a run that passed one round, then failed again
// and hit the cap with open kept findings or failing PRD items, falls outside the stop and ends as a
// normal TASK_DONE. The cap sentences of the etc rendering must name the three-consecutive condition.

const REPO_ROOT = fileURLToPath(new URL("../../", import.meta.url));
const read = (rel: string): string => readFileSync(path.join(REPO_ROOT, rel), "utf8").replace(/\r\n/g, "\n");

const FILES = ["skills/etc/kiwi-srs/SKILL.md", "skills/etc/kiwi-srs/references/extended-workflow.md"] as const;

const capSentences = (text: string): string[] =>
  text.split("\n").filter((l) => /라운드 상한/.test(l) && /NEEDS_USER/.test(l) && /TASK_DONE/.test(l));

describe("FR-FLOW-205 AC-8 — etc cap stop covers a cap reached before three consecutive passes", () => {
  // @req FR-FLOW-205 AC-8 — precondition: the etc profile really requires three consecutive passes.
  it("etc kiwi-srs requires three consecutive passing rounds before Phase 7", () => {
    expect(read(FILES[1])).toMatch(/kept finding 없음을 \*\*3회 연속\*\* 반환하고 PRD 판정/);
  });

  for (const rel of FILES) {
    // @req FR-FLOW-205 AC-8
    it(`${rel}: every cap NEEDS_USER line is conditioned on the three-consecutive pass, not on "no round passed"`, () => {
      const caps = capSentences(read(rel));
      expect(caps.length, "precondition: cap lines exist").toBeGreaterThan(0);
      for (const l of caps) {
        expect(/연속/.test(l), `cap line ignores the etc three-consecutive pass condition: ${l.slice(0, 160)}`).toBe(true);
      }
    });
  }
});
