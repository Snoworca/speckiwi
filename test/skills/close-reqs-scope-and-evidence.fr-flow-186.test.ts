import { describe, expect, it } from "vitest";

import { normaliseEol, readVariant, section, tableRows } from "./kiwi-orchestrator-variants.js";

// @req FR-FLOW-186, FR-FLOW-183
//
// Under `--close-reqs` the review loop promotes a set it must also have checked: the scope an SDS or a
// requirement filter names, and only citations whose tests ran and passed. The final verification found
// the scope taken from a diff heuristic and the cited tests never run. These assertions read the phase
// section and the set-definition table that carry the rule.

const BUNDLES = ["claude", "codex", "etc"] as const;

const review = (bundle: string): string => normaliseEol(readVariant(`skills/${bundle}/kiwi-review-fix-loop/SKILL.md`));
/** claude keeps the --close-reqs sets in conditional-sections.md; codex and etc in extended-workflow.md. */
const conditional = (bundle: string): string =>
  normaliseEol(readVariant(`skills/${bundle}/kiwi-review-fix-loop/references/${bundle === "claude" ? "conditional-sections" : "extended-workflow"}.md`));
/** The sufficiency phase: `### 6.5.1` in claude, `## Test Sufficiency` in codex and etc. */
const SUFFICIENCY_PHASE = /^###\s*6\.5\.1\s|^##\s*Test Sufficiency\b/;
const sufficiency = (bundle: string): string => normaliseEol(readVariant(`skills/${bundle}/_shared/kiwi/test-sufficiency.md`));

describe("FR-FLOW-186 AC-2 — under --close-reqs the cited tests run before promotion", () => {
  for (const bundle of BUNDLES) {
    it(`FR-FLOW-186 AC-2 ${bundle}: §6.5.1 runs the cited test files and keeps only passing citations`, () => {
      const phase = section(review(bundle), SUFFICIENCY_PHASE);
      const rule = phase.split("\n").find((l) => l.includes("--close-reqs") && /test-sufficiency\.md` §4/.test(l)) ?? "";
      expect(rule, `${bundle}: §6.5.1 does not apply test-sufficiency §4 under --close-reqs`).not.toBe("");
      expect(/실행|run/.test(rule), `${bundle}: the cited tests are not run`).toBe(true);
      expect(rule, `${bundle}: a gap left by a failed citation raises no gate`).toContain("test-sufficiency-gap");
    });
  }
});

describe("FR-FLOW-183 AC-3 — the promoting hop's scope is the SDS the caller named", () => {
  for (const bundle of BUNDLES) {
    it(`FR-FLOW-183 AC-3 ${bundle}: scoped is the denominator intersected with the --sds / --req-filter IDs when the caller names them`, () => {
      const row = tableRows(conditional(bundle)).find((r) => (r.cells[0] ?? "").includes("`scoped`"));
      expect(row, `${bundle}: no scoped row`).toBeDefined();
      const cell = row?.cells[1] ?? "";
      expect(cell, `${bundle}: scoped ignores --sds`).toContain("`--sds`");
      expect(cell, `${bundle}: scoped ignores --req-filter`).toContain("`--req-filter`");
    });
  }
});

describe("FR-FLOW-186 AC-1 — the review loop's scope is the SDS it received, not every SDS", () => {
  for (const bundle of BUNDLES) {
    it(`FR-FLOW-186 AC-1 ${bundle}: the kiwi-review-fix-loop row names the received --sds`, () => {
      const row = tableRows(section(sufficiency(bundle), /^##\s*2\.\s/)).find((r) => (r.cells[0] ?? "").includes("`kiwi-review-fix-loop`"));
      expect(row, `${bundle}`).toBeDefined();
      expect((row?.cells[2] ?? "").includes("docs/sds/*.sds.md"), `${bundle}: the row globs every SDS`).toBe(false);
    });
  }
});
