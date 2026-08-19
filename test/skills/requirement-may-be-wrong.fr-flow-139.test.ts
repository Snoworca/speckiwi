import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { REPO_ROOT } from "./kiwi-orchestrator-variants.js";

// @req FR-FLOW-139 — an implementer is told the requirement may be wrong.
//
// This is where the real gate sits once research prose is no longer reviewed: the requirement
// becomes the first thing an implementer can contradict with evidence. In the session that produced
// this requirement, implementers working under exactly this instruction found eight defects in the
// requirements they were handed — a criterion that could not be satisfied as written, a requirement
// contradicting its own criterion, a named seam that turned out to be two.

const COPIES = [
  "skills/claude/kiwi-coder/SKILL.md",
  "skills/codex/kiwi-coder/SKILL.md",
  "skills/etc/kiwi-coder/SKILL.md",
  ".agents/skills/kiwi-coder/SKILL.md"
];

function body(relPath: string): string {
  return readFileSync(path.join(REPO_ROOT, relPath), "utf8");
}

/** The instruction, as the one line that carries both halves. */
function instruction(text: string): string {
  return text
    .split(/\r?\n/)
    .find((line) => /요구가?\s*틀릴 수 있다|요구는 틀릴 수 있다/.test(line) && /보고/.test(line)) ?? "";
}

describe("FR-FLOW-139 AC-1 — the instruction names both halves, in every shipped variant", () => {
  it.each(COPIES)("%s tells the implementer the requirement may itself be wrong", (relPath) => {
    expect(instruction(body(relPath)), "no line says the requirement may be wrong AND must be reported").not.toBe("");
  });

  it.each(COPIES)("%s says a conflict is reported rather than worked around", (relPath) => {
    const line = instruction(body(relPath));
    expect(line, "the instruction does not forbid implementing around the conflict").toMatch(/우회/);
    expect(line, "the instruction does not require reporting").toMatch(/보고/);
  });
});

describe("FR-FLOW-139 AC-2 — the instruction is unhedged", () => {
  it.each(COPIES)("%s does not merely permit reporting", (relPath) => {
    // An agent that MAY report will implement around the conflict, because implementing is the task
    // it was given. Permission is not an instruction.
    const line = instruction(body(relPath));
    // Asserted first, deliberately: a denylist over a missing line passes every entry, so without
    // this the criterion would be satisfied by having no instruction at all.
    expect(line, "there is no instruction to be unhedged").not.toBe("");
    // The list is not, and cannot be, complete: Korean hedges an imperative in indefinitely many
    // ways, the same boundary FR-FLOW-120 recorded for its own denylist. It names the forms a
    // reviewer actually proposed. A rewording nobody anticipated still gets through, and the
    // defence against that is the criterion being read, not this array.
    for (const hedge of [
      "해도 된다",
      "할 수 있다",
      "권장",
      "가능하면",
      "필요시",
      "재량",
      "판단되면",
      "선택적",
      "가급적",
      "웬만하면",
      "되도록"
    ]) {
      expect(line, `the instruction is hedged by "${hedge}"`).not.toContain(hedge);
    }
  });
});

describe("FR-FLOW-139 AC-3 — what counts as a conflict is concrete enough to act on", () => {
  it.each(COPIES)("%s names all three kinds", (relPath) => {
    const line = instruction(body(relPath));
    // Each of the three occurred while this requirement's own target was being implemented.
    expect(line, "a fact the requirement asserts that the code contradicts is not named").toMatch(/반증|사실.*다르|코드가 반박/);
    expect(line, "a criterion that cannot be satisfied as written is not named").toMatch(/적힌 대로|만족시킬 수 없/);
    expect(line, "two parts of one requirement answering differently is not named").toMatch(/두 부분|서로 다른 답|자기 모순/);
  });
});

describe("FR-FLOW-139 AC-4 — a reported conflict is resolved visibly, not absorbed", () => {
  it.each(COPIES)("%s routes resolution to the requirement, not to the code", (relPath) => {
    const line = instruction(body(relPath));
    expect(line, "the instruction does not say the requirement is amended or its standing recorded").toMatch(
      /요구를 고치|요구 수정|그대로 두는 이유/
    );
    expect(line, "the amendment is not required to be visible in Change Notes").toContain("Change Notes");
  });

  it.each(COPIES)("%s rules out satisfying the letter of a criterion instead", (relPath) => {
    // The failure mode this closes is the quiet one: the criterion passes, the author would not
    // recognise what was built, and nothing anywhere records that they disagreed.
    expect(instruction(body(relPath)), "satisfying the wording alone is not ruled out").toMatch(/문면|글자|알아보지 못/);
  });
});
