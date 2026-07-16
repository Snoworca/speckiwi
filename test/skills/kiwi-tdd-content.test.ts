import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// FR-FLOW-037 — kiwi-tdd skill orchestrates the tdd cycle.
// A SKILL.md is natural-language agent instruction, not executable code, so the
// orchestration cannot be run in a unit test. These content assertions verify the
// authored skill text encodes the required workflow for every packaged variant.
// Assertions are language-neutral: they key on technical tokens (tool names,
// paths, jargon like red/green) and structural ordering, so the Korean canonical
// variant and the English mirrors are validated by the same checks.

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const VARIANTS = ["claude", "codex", "etc"] as const;

const PROHIBIT = String.raw`never|절대|금지|않는다|말라|하지\s*않`;

function readSkill(variant: string): string {
  return readFileSync(path.join(REPO_ROOT, "skills", variant, "kiwi-tdd", "SKILL.md"), "utf8");
}

function skillBody(text: string): string {
  return text.replace(/^---[\s\S]*?\n---\s*\n?/, "");
}

function prohibitionNear(text: string, token: string, window = 64): boolean {
  const after = new RegExp(`${token}[\\s\\S]{0,${window}}(${PROHIBIT})`, "i");
  const before = new RegExp(`(${PROHIBIT})[\\s\\S]{0,${window}}${token}`, "i");
  return after.test(text) || before.test(text);
}

describe("FR-FLOW-037 kiwi-tdd SKILL.md content", () => {
  for (const variant of VARIANTS) {
    describe(`variant: ${variant}`, () => {
      it("has frontmatter name=kiwi-tdd and a description, and no changelog section", () => {
        const text = readSkill(variant);
        expect(text).toMatch(/^---[\s\S]*?\bname:\s*kiwi-tdd\b[\s\S]*?---/m);
        expect(text).toMatch(/^---[\s\S]*?\bdescription:\s*\S[\s\S]*?---/m);
        expect(text).not.toMatch(/^#+\s*(변경 이력|Changelog|Change Log)\b/im);
      });

      it("AC-1: mandates the work-mode check with halt guidance, claim-before-author, and steps confinement", () => {
        const text = readSkill(variant);
        // Work-mode check + halt guidance when the mode is not tdd.
        expect(text).toMatch(/speckiwi mode|Mode:\s*tdd/);
        expect(text).toMatch(/(halt|중단)/i);
        // MCP-unavailable halt (kiwi-step convention).
        expect(text).toMatch(/MCP[\s\S]{0,80}(unavailable|부재|없)/i);
        // Ordering in the phase-flow section (## 2 …): the claim phase precedes the
        // design.md authoring phase. The intro/rules table may mention both in any
        // order; the workflow section is what encodes the actual sequence.
        const b = skillBody(text);
        const flowStart = b.search(/^## 2/m);
        expect(flowStart).toBeGreaterThanOrEqual(0);
        const flow = b.slice(flowStart);
        const claimIdx = flow.search(/claim_step/);
        const designIdx = flow.search(/design\.md/);
        expect(claimIdx).toBeGreaterThanOrEqual(0);
        expect(designIdx).toBeGreaterThanOrEqual(0);
        expect(claimIdx).toBeLessThan(designIdx);
        // Confinement to the step directory + body-scope write prohibition.
        expect(text).toMatch(/docs\/spec\/steps\//);
        expect(prohibitionNear(text, "body-scope")).toBe(true);
      });

      it("AC-2: carries the mandatory SDS checklist and the red-before-green order with the weakening prohibition", () => {
        const text = readSkill(variant);
        // SDS checklist: trivial-change skip-gate, EARS contracts, SDS-AC↔Test Plan mapping, line cap.
        expect(text).toMatch(/(trivial|자명)[\s\S]{0,80}(skip|생략)|(skip|생략)[\s\S]{0,80}(trivial|자명)/i);
        expect(text).toContain("EARS");
        expect(text).toContain("SDS-AC");
        expect(text).toContain("Test Plan");
        expect(text).toContain("200");
        // red before green in the body.
        const b = skillBody(text);
        const redIdx = b.search(/\bred\b/i);
        const greenIdx = b.search(/\bgreen\b/i);
        expect(redIdx).toBeGreaterThanOrEqual(0);
        expect(greenIdx).toBeGreaterThanOrEqual(0);
        expect(redIdx).toBeLessThan(greenIdx);
        // Never weaken a test to reach green.
        expect(prohibitionNear(text, "(weaken|약화)")).toBe(true);
      });

      it("AC-3: states the promote-with-evidence obligation and the sdd redirect boundary", () => {
        const text = readSkill(variant);
        expect(text).toMatch(/promote_step_requirement/);
        expect(text).toMatch(/(verification evidence|검증 증거)/i);
        // Boundary: existing body requirements and large/architecture changes go to sdd.
        expect(text).toMatch(/sdd/);
        expect(text).toMatch(/(existing body|기존 body|기존 요구)/i);
        expect(text).toMatch(/(large|대형|아키텍처|architecture)/i);
      });
    });
  }

  it("AC-4: kiwi-tdd is registered in the package-doctor expected kiwi skills set", () => {
    const doctor = readFileSync(path.join(REPO_ROOT, "src", "doctor", "package-doctor.ts"), "utf8");
    expect(doctor).toMatch(/"kiwi-tdd"/);
  });
});
