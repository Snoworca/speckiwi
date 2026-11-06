import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { cliJson, PRD_PATH, prdWorkspace } from "../cli/prd-surface-fixture.js";
import { RENDERINGS, readRepoFile } from "./kiwi-renderings.js";

// @req FR-FLOW-227 — the fills: basis kiwi-srs prescribes names the criteria it grounds, in the form
// `speckiwi prd coverage` counts. The AC numbers are the FR-FLOW-227 block in
// docs/spec/60.workflow-release.srs.md, which is canonical.
//
// The form is not restated here: it is read out of core rule (c) of every shipped kiwi-srs rendering
// and the mirror, written into a fixture requirement's Rationale exactly as prescribed, and
// `speckiwi prd coverage --target` is run on it.

/** Every file of one kiwi-srs rendering an author or the verifier reads the fills form from. */
const srsDocs = (root: string): string[] =>
  root === "skills/claude" ? [`${root}/kiwi-srs/SKILL.md`] : [`${root}/kiwi-srs/SKILL.md`, `${root}/kiwi-srs/references/extended-workflow.md`];

const read = (rel: string): string => readRepoFile(rel).replace(/\r\n/g, "\n");

/** The fills: template of core rule (c). */
const RULE_C = /그 요구의 Rationale 에 `(fills: [^`]+)` 이 있을 때만 받아들인다/;

/** The criterion-less form FR-FLOW-227 retires. */
const CRITERION_LESS = "fills: PRD-<n> / <hole|contradiction|defect> / <reason>";

interface Coverage {
  uncitedRequirements: Array<{ requirementId: string }>;
  ungroundedCriteria: Array<{ requirementId: string; criterionId: string }>;
}

/**
 * The prescribed form made concrete the way an author fills it in: the item placeholder becomes
 * PRD-2, each criterion placeholder the next criterion of the fixture (AC-1, AC-2, ...), `<a|b|c>` its
 * first choice and `<reason>` a reason. Returns the Rationale and how many criteria it names.
 */
function instantiate(form: string): { rationale: string; criteria: number } {
  let criteria = 0;
  const rationale = form
    .replace(/PRD-<[a-z]>/g, "PRD-2")
    .replace(/AC-<[a-z]>/g, () => `AC-${(criteria += 1)}`)
    .replace(/<([a-z]+)\|[^>]+>/g, "$1")
    .replace(/<reason>/g, "the request leaves the empty case open");
  return { rationale, criteria: Math.max(1, criteria) };
}

const SCOPE = path.join("docs", "spec", "10.product-architecture.srs.md");

/** valid-basic's FR-ARCH-001 with criteria AC-1..AC-<criteria>, none citing a PRD item, and the given Rationale. */
async function workspace(rationale: string, criteria: number): Promise<string> {
  const root = await prdWorkspace({
    items: [
      { title: "목적", rows: { Kind: "intent", Source: "U-1", State: "confirmed" }, quote: "비밀번호 재설정 링크를 추가해" },
      { title: "항목 2", rows: { Kind: "in-scope", Source: "U-1", State: "confirmed" }, quote: "Password reset email must expire after one hour." },
    ],
  });
  const file = path.join(root, SCOPE);
  const lines = Array.from({ length: criteria }, (_, index) => `- [ ] AC-${index + 1}: The requirement can be counted.`);
  const text = (await readFile(file, "utf8"))
    .replace("The parser needs a small valid workspace.", rationale)
    .replace(/- \[ \] AC-1: The requirement can be listed\.\r?\n- \[ \] AC-2: The requirement can be shown\./, lines.join("\n"));
  await writeFile(file, text, "utf8");
  return root;
}

describe("FR-FLOW-227 AC-1 — a criterion grounded only by the prescribed fills: form is not ungrounded", () => {
  for (const root of RENDERINGS) {
    // @req FR-FLOW-227 AC-1
    it(`${root}: a Rationale written in exactly the rule (c) fills: form grounds every criterion it is filled in for`, async () => {
      const form = RULE_C.exec(srsDocs(root).map(read).join("\n"))?.[1];
      expect(form, `${root}: no fills: template in core rule (c)`).toBeDefined();
      const { rationale, criteria } = instantiate(form as string);
      const fixtureRoot = await workspace(rationale, criteria);
      const { code, json } = await cliJson<Coverage>(fixtureRoot, "coverage", PRD_PATH, "--target", "v1.0.0");
      expect(code).toBe(0);
      expect(json.uncitedRequirements.map((entry) => entry.requirementId), `${rationale}: the requirement cites nothing`).not.toContain("FR-ARCH-001");
      expect(
        json.ungroundedCriteria.filter((entry) => entry.requirementId === "FR-ARCH-001").map((entry) => entry.criterionId),
        `${rationale}: coverage reports the filled criteria ungrounded`
      ).toEqual([]);
    });
  }
});

describe("FR-FLOW-227 AC-2 — no rendering keeps the criterion-less fills: grammar", () => {
  for (const root of RENDERINGS) {
    // @req FR-FLOW-227 AC-2
    it(`${root}: rule (c) names a criterion and the criterion-less form is gone`, () => {
      const text = srsDocs(root).map(read).join("\n");
      const form = RULE_C.exec(text)?.[1] ?? "";
      expect(form, `${root}: rule (c) fills: template`).toMatch(/\/ for AC-<[a-z]>/);
      expect(text.includes(CRITERION_LESS), `${root}: the criterion-less form survives`).toBe(false);
    });

    // @req FR-FLOW-227 AC-2 — the verifier's PRD-verdict example writes a fills: basis too.
    it(`${root}: every concrete fills: example names the criterion it grounds`, () => {
      const examples = [...srsDocs(root).map(read).join("\n").matchAll(/fills: PRD-\d+[^`"\n]*/g)].map((match) => match[0]);
      expect(examples.length, `${root}: no concrete fills: example`).toBeGreaterThan(0);
      for (const example of examples) expect(example, `${root}: ${example}`).toMatch(/\/ for AC-\d+/);
    });
  }
});
