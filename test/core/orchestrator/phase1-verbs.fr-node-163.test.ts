import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import * as journalSchema from "../../../src/core/orchestrator/journal-schema.js";
import { VERBS, VERB_RECOVERY_CLASS, isVerb } from "../../../src/core/orchestrator/journal-schema.js";

// @req FR-NODE-163 — the verb enum a resume card is checked against is the set the skill declares.
//
// From 4.0.0 no verb is deferred: the wave worker verbs and the formerly deferred `probe-isolation`
// and `replay-deferred-mutations` are ordinary members, and the handoff verbs, `execute-unit` and
// `run-serial-epilogue` are retired. The constant is tied to the document that defines it rather than
// maintained beside it.

const VARIANTS = ["claude", "codex", "etc"] as const;
const REPO_ROOT = path.resolve(__dirname, "../../..");

const RETIRED = ["execute-unit", "author-handoff", "verify-handoff", "commit-dispatch-base", "run-serial-epilogue"] as const;
const WORKER_VERBS = ["dispatch-lane", "collect-lane", "verify-lane", "remediate-lane", "release-lane", "integrate-lane"] as const;

/** Every `§V.<verb>` section the shipped body declares. FR-FLOW-074 AC-2 requires one per verb. */
function sectionVerbs(variant: (typeof VARIANTS)[number]): string[] {
  const body = readFileSync(path.resolve(REPO_ROOT, `skills/${variant}/kiwi-orchestrator/SKILL.md`), "utf8");
  return [...body.matchAll(/^#{2,4}\s*§V\.([a-z0-9-]+)/gm)].map((match) => match[1]!).sort();
}

describe("FR-NODE-163 — the verb set is the document's set", () => {
  it("FR-NODE-163 AC-4 the verb set equals the verb sections each shipped variant declares", () => {
    const declared = [...VERBS].sort();
    expect(declared.length, "an empty set would make every case below vacuous").toBeGreaterThan(0);
    for (const variant of VARIANTS) {
      expect(sectionVerbs(variant), `${variant} must declare exactly the verb set`).toEqual(declared);
    }
  });

  it("FR-NODE-163 AC-1 retires the handoff verbs, execute-unit and run-serial-epilogue from the vocabulary", () => {
    for (const verb of RETIRED) {
      expect(isVerb(verb), verb).toBe(false);
      expect(VERBS as readonly string[], verb).not.toContain(verb);
    }
  });

  it("FR-NODE-163 AC-2 keeps the worker verbs and the formerly deferred verbs as ordinary members with their recovery class", () => {
    for (const verb of [...WORKER_VERBS, "probe-isolation", "replay-deferred-mutations"] as const) {
      expect(isVerb(verb), verb).toBe(true);
      expect(VERB_RECOVERY_CLASS[verb], `${verb} keeps its recovery class`).toBeDefined();
    }
  });

  it("FR-NODE-163 AC-5 declares no deferred subset any more", () => {
    expect(journalSchema).not.toHaveProperty("DEFERRED_VERBS");
  });

  it("FR-NODE-163 AC-3 a verb outside every enum is not a verb", () => {
    for (const verb of ["review-partiton", "totally-made-up"]) expect(isVerb(verb)).toBe(false);
  });
});
