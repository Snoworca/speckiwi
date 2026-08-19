import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { REPO_ROOT } from "./kiwi-orchestrator-variants.js";

// @req FR-FLOW-138 — the requirement carries the design, not a pointer to it.
//
// The blueprint has to be the requirement, because that is what an implementer is handed, what a
// reviewer checks against, and what a test can be tied to. A research file is a working note that
// may already be wrong: three counts inherited from one were wrong, and were caught only when
// someone ran the code.

const COPIES = [
  "skills/claude/kiwi-srs/SKILL.md",
  "skills/codex/kiwi-srs/SKILL.md",
  "skills/etc/kiwi-srs/SKILL.md",
  ".agents/skills/kiwi-srs/SKILL.md"
];

function body(relPath: string): string {
  return readFileSync(path.join(REPO_ROOT, relPath), "utf8");
}

/**
 * The rule, found by what it says rather than by its section number: the three variants number
 * their §0 rows differently, so pinning an id would assert the numbering instead of the rule.
 */
function designRule(text: string): string {
  return text.split(/\r?\n/).find((line) => /설계를 담는다|요구가 설계도/.test(line)) ?? "";
}

describe("FR-FLOW-138 AC-1..AC-4 — the four kinds a requirement has to carry", () => {
  it.each(COPIES)("%s states the rule at all", (relPath) => {
    expect(designRule(body(relPath)), "no authoring rule says the requirement carries the design").not.toBe("");
  });

  it.each(COPIES)("%s requires a measured fact to record how it was measured", (relPath) => {
    // Without the method a reader can only trust the number, and the numbers are what went wrong.
    const rule = designRule(body(relPath));
    expect(rule, "a measured fact is not named as something to record").toMatch(/측정된 사실|측정값/);
    expect(rule, "the measurement method is not required alongside it").toMatch(/어떻게 측정|측정 방법|재측정/);
  });

  it.each(COPIES)("%s requires a ground-truth choice to be stated as a decision", (relPath) => {
    expect(designRule(body(relPath)), "a ground-truth decision is not named").toMatch(/ground truth|기준값|판단 기준/);
  });

  it.each(COPIES)("%s requires a trap on the implementation path to be named", (relPath) => {
    expect(designRule(body(relPath)), "a trap is not named").toMatch(/함정/);
  });

  it.each(COPIES)("%s requires a rejected alternative with the condition that reopens it", (relPath) => {
    const rule = designRule(body(relPath));
    expect(rule, "a rejected alternative is not named").toMatch(/기각된 대안|기각한 대안/);
    // Without the reopening condition the next session either re-litigates it or reverses it quietly.
    expect(rule, "the condition that would reopen it is not required").toMatch(/재개봉|다시 열|재논의 조건/);
  });
});

describe("FR-FLOW-138 AC-5 — the rule cannot be satisfied by filler", () => {
  it.each(COPIES)("%s says a requirement with nothing to record already complies", (relPath) => {
    // This is the safety catch. Read as "never leave the section empty", the rule would put filler
    // prose in every requirement — which is the cost this whole target exists to remove.
    const rule = designRule(body(relPath));
    expect(rule, "the rule does not exempt a requirement with no design to carry").toMatch(
      /담을 설계가 없|없으면 그대로 만족|비워도/
    );
  });

  it.each(COPIES)("%s does not make a non-empty section the check", (relPath) => {
    const rule = designRule(body(relPath));
    // Existence asserted first: a denylist over a missing rule passes every entry, so without this
    // the criterion would be satisfied by having no rule at all.
    expect(rule, "there is no rule to check").not.toBe("");
    expect(rule, "the check is stated as section non-emptiness").not.toMatch(/비워두지 마|반드시 채운다|채워야 한다/);
  });
});
