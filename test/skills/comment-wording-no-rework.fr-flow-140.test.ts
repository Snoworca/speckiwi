import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { REPO_ROOT } from "./kiwi-orchestrator-variants.js";

// @req FR-FLOW-140 — a finding about how a comment is worded buys no rework round.
//
// The severity was never the problem; the round was. The improve loop grants this severity a
// senior-coder pass, and a census of Change Notes, Rationale and the completed-work log found no
// defect that pass has ever caught. What it does reliably is spend a round on wording.

/** Every copy an agent can read: the three shipped variants and the generated mirror. */
const COPIES = [
  ["skills/claude", "skills/claude/kiwi-coder/SKILL.md"],
  ["skills/codex", "skills/codex/kiwi-coder/SKILL.md"],
  ["skills/etc", "skills/etc/kiwi-coder/SKILL.md"],
  [".agents mirror", ".agents/skills/kiwi-coder/SKILL.md"]
] as const;

/** States that the rework budget for this finding is nothing, in either word order. */
const NO_REWORK = /재작업\s*라운드\s*0|라운드\s*0\s*회|재작업\s*0\s*라운드/;

function body(relPath: string): string {
  return readFileSync(path.join(REPO_ROOT, relPath), "utf8");
}

/** The severity definitions. Read raw: the budget this requirement changes lives inside a fence. */
function severitySection(text: string): string {
  const start = text.indexOf("### 5.3 ");
  if (start < 0) return "";
  const end = text.indexOf("\n### ", start + 1);
  return end < 0 ? text.slice(start) : text.slice(start, end);
}

function severityLine(text: string, severity: string): string {
  return severitySection(text)
    .split(/\r?\n/)
    .find((line) => line.includes(`**${severity}**`)) ?? "";
}

/**
 * The lines of the Phase 2 pipeline that declare the per-severity round budget. This is the number
 * an agent counts rounds from, and it is written inside a fenced diagram — so unlike every other
 * assertion about these skills, this one must NOT mask fences.
 */
function budgetLines(text: string): string[] {
  return text.split(/\r?\n/).filter((line) => /(?:CRITICAL|HIGH|MEDIUM|LOW)\s*≤\s*\d/.test(line));
}

describe("FR-FLOW-140 AC-1 — both places that decide the outcome say the same thing", () => {
  it.each(COPIES)("%s states the no-rework rule where the severity is defined", (_label, relPath) => {
    const low = severityLine(body(relPath), "LOW");
    expect(low, "the lower severity is not declared at all").not.toBe("");
    expect(low, "the severity definition does not name comment wording").toContain("주석");
    expect(low, "the severity definition does not say the finding buys no rework round").toMatch(NO_REWORK);
  });

  it.each(COPIES)("%s states it again where the round budget is declared", (_label, relPath) => {
    // Stating it only at the severity is not enough: an agent running the loop reads its budget from
    // the pipeline, and a budget that still grants a round contradicts the definition that denies it.
    const budget = budgetLines(body(relPath));
    expect(budget.length, "the per-severity round budget was not found").toBeGreaterThan(0);
    const exempted = budget.filter((line) => /주석/.test(line) && NO_REWORK.test(line));
    expect(exempted, "the round budget grants comment wording a rework round").not.toEqual([]);
  });
});

describe("FR-FLOW-140 AC-2 — the observation stays reportable", () => {
  it.each(COPIES)("%s keeps comment wording as a nameable finding", (_label, relPath) => {
    // Deleting the subject would not remove the round, it would move it: a reviewer who cannot file
    // an observation under its own name files it under another one.
    const low = severityLine(body(relPath), "LOW");
    expect(low, "comment wording is no longer a finding a reviewer can name").toMatch(/주석 표현|주석 서식|주석 표현·서식/);
  });
});

describe("FR-FLOW-140 AC-3 — the axis that judges facts is untouched", () => {
  it.each(COPIES)("%s still blocks on a comment claim measurement contradicts", (_label, relPath) => {
    const text = body(relPath);
    expect(severityLine(text, "HIGH"), "a false comment claim no longer blocks").toContain("주석 주장");
    // And the relief this requirement grants must not have leaked onto the blocking line.
    expect(severityLine(text, "HIGH"), "the blocking severity was given the wording exemption").not.toMatch(NO_REWORK);
  });
});

describe("FR-FLOW-140 AC-4 — the pin moved in the same commit as the skill", () => {
  it("the canonical severity line the suite pins carries the new rule", () => {
    // That pin is equality-based across all four copies, so the skill cannot change without it. This
    // case states the dependency explicitly rather than leaving it to be discovered by a red run.
    const pinned = body("test/skills/kiwi-coder-comment-claim-axis.fr-flow-120.test.ts");
    const canonical = pinned.match(/const CANONICAL_LOW = canonical\(\s*"([^"]*)"/)?.[1] ?? "";
    expect(canonical, "the pinned lower-severity line was not found").not.toBe("");
    expect(canonical, "the pin still carries the pre-change severity line").toMatch(NO_REWORK);
  });
});
