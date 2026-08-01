import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { DEFERRED_VERBS, PHASE_1_VERBS, VERBS, VERB_RECOVERY_CLASS, isPhase1Verb, isVerb } from "../../../src/core/orchestrator/journal-schema.js";

// @req FR-NODE-163 — the phase-1 verb enum is the set the skill declares.
//
// The shipped body states that the six lane verbs plus `probe-isolation`, `run-serial-epilogue` and
// `replay-deferred-mutations` are **not** in the phase-1 enum, and that a verb outside the enum halts
// a resume. `VERBS` carried all 47, so the halt fired for none of the nine. The constant is now tied
// to the document that defines it rather than maintained beside it.

const VARIANTS = ["claude", "codex", "etc"] as const;
const REPO_ROOT = path.resolve(__dirname, "../../..");

/** Every `§V.<verb>` section the shipped body declares. FR-FLOW-074 AC-2 requires one per verb. */
function sectionVerbs(variant: (typeof VARIANTS)[number]): string[] {
  const body = readFileSync(path.resolve(REPO_ROOT, `skills/${variant}/kiwi-orchestrator/SKILL.md`), "utf8");
  return [...body.matchAll(/^#{2,4}\s*§V\.([a-z0-9-]+)/gm)].map((match) => match[1]!).sort();
}

describe("FR-NODE-163 — the phase-1 set is the document's set", () => {
  it("AC-4: PHASE_1_VERBS equals the verb sections each shipped variant declares", () => {
    const declared = [...PHASE_1_VERBS].sort();
    expect(declared.length, "an empty set would make every case below vacuous").toBeGreaterThan(0);
    for (const variant of VARIANTS) {
      expect(sectionVerbs(variant), `${variant} must declare exactly the phase-1 verbs`).toEqual(declared);
    }
  });

  it("AC-5: the deferred verbs are excluded from phase 1 but keep their recovery class", () => {
    for (const verb of DEFERRED_VERBS) {
      expect(isPhase1Verb(verb), `${verb} must be outside the phase-1 enum`).toBe(false);
      expect(isVerb(verb), `${verb} must remain a known verb`).toBe(true);
      expect(VERB_RECOVERY_CLASS[verb], `${verb} must keep its recovery class`).toBeDefined();
    }
  });

  it("the two sets partition the union, so no verb is lost or counted twice", () => {
    expect([...PHASE_1_VERBS, ...DEFERRED_VERBS].sort()).toEqual([...VERBS].sort());
    expect(new Set([...PHASE_1_VERBS, ...DEFERRED_VERBS]).size).toBe(VERBS.length);
  });

  it("AC-3: a verb outside every enum is outside phase 1 too", () => {
    for (const verb of ["review-partiton", "totally-made-up"]) {
      expect(isVerb(verb)).toBe(false);
      expect(isPhase1Verb(verb)).toBe(false);
    }
  });
});
