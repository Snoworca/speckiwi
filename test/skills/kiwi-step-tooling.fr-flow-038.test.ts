import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// FR-FLOW-038 — kiwi-step and kiwi-tdd skills reflect the step tooling
// (scaffold stubs + CLI fallback). A SKILL.md is natural-language agent
// instruction, so these content assertions verify the authored text encodes the
// updated contract for every packaged variant, keyed on language-neutral tokens.
//
// Contract under test (docs/spec/60.workflow-release.srs.md FR-FLOW-038):
//   - AC-1: kiwi-step documents the scaffold tool as stub-only while content
//           stays directly authored (Write/Edit retained).
//   - AC-2: kiwi-step names the step CLI fallback for claim (MCP-preferred).
//   - AC-3: kiwi-tdd references the scaffold and synthesize tools in its cycle.
//   - AC-4: the existing kiwi-step / kiwi-tdd content suites stay green
//           (asserted by those suites themselves).

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const VARIANTS = ["claude", "codex", "etc"] as const;

function readSkill(skill: string, variant: string): string {
  return readFileSync(path.join(REPO_ROOT, "skills", variant, skill, "SKILL.md"), "utf8");
}

const SCAFFOLD_TOKEN = /scaffold_step|step scaffold/;
const SYNTHESIZE_TOKEN = /synthesize_step_srs|step synthesize/;
const CLAIM_CLI_TOKEN = /step claim/;
const STUB_TOKEN = /stub|스텁|skeleton|골격/i;

describe("FR-FLOW-038 — kiwi-step / kiwi-tdd step tooling contract", () => {
  for (const variant of VARIANTS) {
    describe(`variant: ${variant}`, () => {
      it("AC-1: kiwi-step documents scaffold-as-stub while direct authoring is retained", () => {
        const text = readSkill("kiwi-step", variant);
        expect(text, "kiwi-step must reference the scaffold tool").toMatch(SCAFFOLD_TOKEN);
        expect(text, "the scaffold must be framed as stub/skeleton generation").toMatch(STUB_TOKEN);
        // Direct authoring stays the contract for the step content itself.
        expect(text).toMatch(/Write\/Edit/i);
      });

      it("AC-2: kiwi-step names the step CLI fallback for claim (MCP-preferred)", () => {
        const text = readSkill("kiwi-step", variant);
        expect(text).toMatch(/claim_step/);
        expect(text, "the CLI claim fallback must be named").toMatch(CLAIM_CLI_TOKEN);
      });

      it("AC-3: kiwi-tdd references the scaffold and synthesize tools in its cycle", () => {
        const text = readSkill("kiwi-tdd", variant);
        expect(text, "kiwi-tdd must reference the scaffold tool").toMatch(SCAFFOLD_TOKEN);
        expect(text, "kiwi-tdd must reference the synthesize tool").toMatch(SYNTHESIZE_TOKEN);
      });
    });
  }
});
