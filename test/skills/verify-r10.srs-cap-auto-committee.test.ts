import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// Round-10 verification. kiwi-srs now ends `NEEDS_USER` when the round cap comes before a passing
// round (core block "종료", §11.2, the emit rule). Under `--auto`, `_shared/kiwi/auto-option.md`
// §0 hands every NEEDS_USER gate to the decision committee, and §4 classifies a gate missing from
// the skill's `critical_gates[]` as `business-decision` — decided automatically. The residual stop
// and the unapproved-PRD stop are kept out of the committee's hands by `--auto 에서도` in the core
// block and a `critical_gates[]` row (§0.G6). The cap stop has neither, so under `--auto` the
// committee may settle it and the run can still finish TASK_DONE with an intent / goal / in-scope
// item failing — the outcome FR-FLOW-205 AC-8 forbids ("SHALL NOT end TASK_DONE").

const REPO_ROOT = fileURLToPath(new URL("../../", import.meta.url));
const read = (rel: string): string => readFileSync(path.join(REPO_ROOT, rel), "utf8").replace(/\r\n/g, "\n");

const ROOTS = ["skills/claude", "skills/codex", "skills/etc", ".agents/skills"] as const;

const kiwiSrsText = (root: string): string =>
  [`${root}/kiwi-srs/SKILL.md`, `${root}/kiwi-srs/references/extended-workflow.md`]
    .filter((rel) => existsSync(path.join(REPO_ROOT, rel)))
    .map(read)
    .join("\n");

/** Sentences that state the round-cap NEEDS_USER ending (split at ". ", "; " and line ends, so a neighbouring residual sentence's `--auto` does not count). */
const capLines = (text: string): string[] =>
  text.split(/\.\s+|;\s+|\n/).filter((l) => /라운드 상한/.test(l) && /NEEDS_USER/.test(l) && /TASK_DONE/.test(l));

/** Rows of the §0.G6 critical_gates table (lines starting with "| `" inside that section). */
const criticalGateRows = (skill: string): string[] => {
  const start = skill.indexOf("§0.G6");
  expect(start, "precondition: §0.G6 exists").toBeGreaterThanOrEqual(0);
  const end = skill.indexOf("\n---", start);
  return skill.slice(start, end < 0 ? skill.length : end).split("\n").filter((l) => l.startsWith("| `"));
};

describe("kiwi-srs keeps the round-cap NEEDS_USER out of the --auto committee (verify-r10)", () => {
  for (const root of ROOTS) {
    const text = kiwiSrsText(root);
    const skill = read(`${root}/kiwi-srs/SKILL.md`);

    // @req FR-FLOW-205 AC-8 — precondition: the cap ending exists and the residual stop is a declared critical gate.
    it(`${root}: precondition — the cap ends NEEDS_USER and prd-residual-user-decision is a critical gate`, () => {
      expect(capLines(text).length).toBeGreaterThan(0);
      expect(criticalGateRows(skill).some((r) => r.startsWith("| `prd-residual-user-decision`"))).toBe(true);
    });

    // @req FR-FLOW-205 AC-8 — "WHEN the round cap is reached before a round passes, THE run SHALL NOT end TASK_DONE": under --auto, a NEEDS_USER that is no critical gate goes to the committee (auto-option §0, §4).
    it(`${root}: the round-cap NEEDS_USER holds under --auto (stated so, or declared as a critical gate)`, () => {
      const statedUnderAuto = capLines(text).some((l) => /--auto/.test(l));
      const declaredCritical = criticalGateRows(skill).some((r) => /라운드 상한/.test(r));
      expect(
        statedUnderAuto || declaredCritical,
        `${root}/kiwi-srs: the cap stop is neither stated for --auto nor in critical_gates[]; auto-option §4 makes it a business-decision the committee settles`
      ).toBe(true);
    });
  }
});
