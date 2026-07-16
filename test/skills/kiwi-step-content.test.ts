import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// FR-FLOW-014 — kiwi-step lightweight step-local authoring skill.
// A SKILL.md is natural-language agent instruction, not executable code, so AC-1/2/3
// behavior cannot be run in a unit test. These content assertions verify that the
// authored skill text encodes the required orchestration for every packaged variant.
// The assertions are language-neutral: they key on technical tokens (tool names,
// paths) and structural ordering rather than English prose keywords, so the Korean
// canonical variant and the English mirrors are all validated by the same checks.
// The underlying runtime ops (claim_step, validate_step) are unit-tested elsewhere.

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const VARIANTS = ["claude", "codex", "etc"] as const;

// Prohibition verbs, English + Korean, used to confirm a real prohibition (not mere
// token adjacency) sits near a target token within a bounded window.
const PROHIBIT = String.raw`never|절대|금지|않는다|말라|하지\s*않`;

function readSkill(variant: string): string {
  return readFileSync(path.join(REPO_ROOT, "skills", variant, "kiwi-step", "SKILL.md"), "utf8");
}

/**
 * Body text with the leading YAML frontmatter block stripped. Ordering assertions
 * run against the body so they verify the workflow Phase order, not the mere
 * word-order of the frontmatter description (which mentions every tool up front).
 */
function skillBody(text: string): string {
  return text.replace(/^---[\s\S]*?\n---\s*\n?/, "");
}

/** True when a prohibition verb sits within `window` chars of `token` in either direction. */
function prohibitionNear(text: string, token: string, window = 48): boolean {
  const after = new RegExp(`${token}[\\s\\S]{0,${window}}(${PROHIBIT})`, "i");
  const before = new RegExp(`(${PROHIBIT})[\\s\\S]{0,${window}}${token}`, "i");
  return after.test(text) || before.test(text);
}

describe("FR-FLOW-014 kiwi-step SKILL.md content", () => {
  for (const variant of VARIANTS) {
    describe(`variant: ${variant}`, () => {
      it("has frontmatter name=kiwi-step and a description, and no changelog section", () => {
        const text = readSkill(variant);
        expect(text).toMatch(/^---[\s\S]*?\bname:\s*kiwi-step\b[\s\S]*?---/m);
        expect(text).toMatch(/^---[\s\S]*?\bdescription:\s*\S[\s\S]*?---/m);
        expect(text).not.toMatch(/^#+\s*(변경 이력|Changelog|Change Log)\b/im);
      });

      it("AC-1: claim_step precedes the validate-terminated workflow and an MCP-unavailable halt is described", () => {
        const text = readSkill(variant);
        expect(text).toMatch(/claim_step/);
        // structural ordering in the BODY (frontmatter stripped): claim comes before the validate step.
        const b = skillBody(text);
        const claimIdx = b.search(/claim_step/);
        const validateIdx = b.search(/validate_step/);
        expect(claimIdx).toBeGreaterThanOrEqual(0);
        expect(validateIdx).toBeGreaterThanOrEqual(0);
        expect(claimIdx).toBeLessThan(validateIdx);
        // MCP-unavailable condition + halt, language-neutral (English or Korean).
        expect(text).toMatch(/MCP[\s\S]{0,80}(unavailable|부재|없)/i);
        expect(text).toMatch(/(halt|중단|stop)/i);
      });

      it("AC-2: confines authoring to docs/spec/steps/ and prohibits body-scope writes with a real verb", () => {
        const text = readSkill(variant);
        expect(text).toMatch(/docs\/spec\/steps\//);
        expect(text).toMatch(/body-scope/i);
        // tighter than mere adjacency: a prohibition verb must sit near a body-scope mention.
        expect(prohibitionNear(text, "body-scope")).toBe(true);
      });

      it("AC-3: validate_step runs after the step authoring reference (validate-after-author ordering)", () => {
        const text = readSkill(variant);
        expect(text).toMatch(/validate_step/);
        // ordering in the BODY (frontmatter stripped): validate runs after the authoring reference.
        const b = skillBody(text);
        const authorIdx = b.search(/docs\/spec\/steps\//);
        const validateIdx = b.search(/validate_step/);
        expect(authorIdx).toBeGreaterThanOrEqual(0);
        expect(validateIdx).toBeGreaterThan(authorIdx);
      });

      it("FND-001: authors the step file directly (Write/Edit) and warns against add_requirement", () => {
        const text = readSkill(variant);
        // direct-authoring instruction present. FR-FLOW-038 narrowed this contract: the
        // scaffold tool (scaffold_step) generates empty stubs only, so the step CONTENT
        // is still authored directly — the Write/Edit instruction must survive.
        expect(text).toMatch(/Write\/Edit/i);
        // add_requirement is mentioned with a nearby negation/prohibition.
        expect(text).toMatch(/add_requirement/);
        const negateAddReq =
          /add_requirement[\s\S]{0,90}(not|never|violat|위반|금지|말라|않는다|하지\s*않|사용하지)/i.test(text) ||
          /(do not|don['’]t|never|금지|말라|하지\s*않|사용하지)[\s\S]{0,90}add_requirement/i.test(text);
        expect(negateAddReq).toBe(true);
      });

      it("does not dangle a reference to the removed kiwi-spec-merge / kiwi-vibe skills", () => {
        const text = readSkill(variant);
        // FR-FLOW-015 (kiwi-spec-merge) and FR-FLOW-018 (kiwi-vibe) are removed from scope;
        // step -> body promotion is handled by the existing kiwi-srs-sync skill instead.
        // kiwi-step must not point agents at either removed skill.
        expect(text).not.toMatch(/kiwi-spec-merge/i);
        expect(text).not.toMatch(/kiwi-vibe/i);
      });
    });
  }
});
