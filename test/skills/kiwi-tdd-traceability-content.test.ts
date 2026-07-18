// @req FR-FLOW-041
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// FR-FLOW-041 — kiwi-tdd Phase 6 restores code traceability for promoted requirements.
// A SKILL.md is natural-language agent instruction, not executable code, so the
// traceability step cannot be run in a unit test. These content assertions verify the
// authored skill text encodes the required post-promote traceability workflow for every
// packaged variant. Assertions are language-neutral: they key on technical tokens (tool
// names, REQ IDs, jargon) with Korean/English alternations so the Korean canonical
// variant and the English mirrors are validated by the same checks.

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const VARIANTS = ["claude", "codex", "etc"] as const;

const PROHIBIT = String.raw`never|절대|금지|않는다|말라|하지\s*않`;

function readSkill(variant: string): string {
  return readFileSync(path.join(REPO_ROOT, "skills", variant, "kiwi-tdd", "SKILL.md"), "utf8");
}

function prohibitionNear(text: string, token: string, window = 64): boolean {
  const after = new RegExp(`${token}[\\s\\S]{0,${window}}(${PROHIBIT})`, "i");
  const before = new RegExp(`(${PROHIBIT})[\\s\\S]{0,${window}}${token}`, "i");
  return after.test(text) || before.test(text);
}

describe("FR-FLOW-041 kiwi-tdd Phase 6 traceability content", () => {
  for (const variant of VARIANTS) {
    describe(`variant: ${variant}`, () => {
      it("AC-1: documents add_trace_link(type=code, relation=implements) on the promoted requirement citing Phase 4 touched files", () => {
        const text = readSkill(variant);
        // Authoritative SRS Code anchor tool call with the code/implements shape.
        expect(text).toMatch(/add_trace_link/);
        expect(text).toMatch(/implements/);
        expect(text).toMatch(/type\s*=\s*code|type:\s*code|code anchor/i);
        // Phase 4 records touched production files that the traceability step cites.
        expect(text).toMatch(/touched/i);
        expect(text).toMatch(/touched[\s\S]{0,80}(production|프로덕션)|(production|프로덕션)[\s\S]{0,80}touched/i);
        expect(text).toMatch(/Phase 4|§2\.5/);
      });

      it("AC-2: reconciles the vibe task-name tag to @req <REQ-ID>, citing FR-FLOW-020 and kiwi-coder §0.17 for format/exemption only", () => {
        const text = readSkill(variant);
        expect(text).toMatch(/@req/);
        expect(text).toMatch(/FR-FLOW-020/);
        expect(text).toMatch(/kiwi-coder/);
        expect(text).toMatch(/§0\.17/);
        // task-name -> promoted REQ-ID reconcile.
        expect(text).toMatch(/task-name/);
        expect(text).toMatch(/reconcile|재조정/i);
        // Format/exemption citation only — no operational-hook import.
        expect(text).toMatch(/운영 훅|operational[- ]hook/i);
      });

      it("AC-3: states both the code Trace Link and @req tag are non-gating, separate from EVIDENCE_REQUIRED, anchor authoritative / breadcrumb auxiliary", () => {
        const text = readSkill(variant);
        expect(text).toMatch(/비차단|non-gating|gates nothing|막지 않/i);
        expect(text).toMatch(/EVIDENCE_REQUIRED/);
        expect(text).toMatch(/분리|separate/i);
        // Trace Links Code anchor authoritative, @req auxiliary breadcrumb.
        expect(text).toMatch(/권위|authoritative/i);
        expect(text).toMatch(/보조|auxiliary/i);
        expect(text).toMatch(/breadcrumb/i);
      });

      it("AC-4: applies the traceability step only after promote confirms the body Requirement ID (never at Phase 2/4)", () => {
        const text = readSkill(variant);
        expect(text).toMatch(/post-promote/i);
        expect(text).toMatch(/promote[\s\S]{0,40}(확정|confirm)/i);
        expect(text).toMatch(/Phase 2\/4/);
        expect(prohibitionNear(text, "Phase 2/4")).toBe(true);
      });
    });
  }
});
