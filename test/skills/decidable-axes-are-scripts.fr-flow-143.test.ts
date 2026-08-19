import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { REPO_ROOT } from "./kiwi-orchestrator-variants.js";

// @req FR-FLOW-143 — an axis whose rule is decidable is run by a script, not judged by an agent.
//
// req-mapping was not merely mechanizable: the shipped plan validator already decides all three of
// its rules by name. An agent was re-deciding at implementation time what a script had decided at
// plan time. red-verification is exit status plus signature equality — a comparison a script makes
// exactly and a judge makes approximately, so moving it tightens the check rather than loosening it.

const VARIANTS = ["claude", "codex", "etc"] as const;

/** Every copy an agent reads: the three shipped variants and the generated mirror. */
const COPIES = [
  ["skills/claude", "skills/claude/kiwi-coder/SKILL.md"],
  ["skills/codex", "skills/codex/kiwi-coder/SKILL.md"],
  ["skills/etc", "skills/etc/kiwi-coder/SKILL.md"],
  [".agents mirror", ".agents/skills/kiwi-coder/SKILL.md"]
] as const;

function body(relPath: string): string {
  return readFileSync(path.join(REPO_ROOT, relPath), "utf8");
}

/** Rows of the Phase 1 TDD verification table — the axes still evaluated by an agent. */
function tddAxisRows(text: string): string[] {
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((line) => /^### 4\.2 /.test(line));
  if (start < 0) return [];
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => /^#{1,3} /.test(line));
  return (end < 0 ? rest : rest.slice(0, end)).filter((line) => /^\|\s*\*\*S\d/.test(line));
}

function section(text: string, heading: string): string {
  const start = text.indexOf(heading);
  if (start < 0) return "";
  const end = text.indexOf("\n### ", start + 1);
  return end < 0 ? text.slice(start) : text.slice(start, end);
}

describe("FR-FLOW-143 AC-1 — req-mapping reuses the validator that already decides it", () => {
  it.each(VARIANTS)("%s's plan validator carries both req-mapping rules as named checks", (variant) => {
    // The premise the requirement rests on. If these checks ever leave the validator, reusing it
    // stops being reuse and this requirement's AC-1 is no longer satisfiable as written.
    const validator = variant === "claude" ? "skills/claude/kiwi-planner/validator.mjs" : `skills/${variant}/kiwi-planner/scripts/validator.mjs`;
    const source = body(validator);
    expect(source, "the validator no longer checks test_case requirement membership").toMatch(/req_id.{0,40}task\.req_ids/s);
    expect(source, "the validator no longer checks criterion-reference containment").toMatch(/ac_refs/);
    expect(source, "the validator no longer checks the test-case identifier pattern").toMatch(/TC-REQ-/);
  });

  it.each(COPIES)("%s routes req-mapping to the validator rather than to an agent", (_label, relPath) => {
    const text = body(relPath);
    expect(section(text, "### 4.2 "), "req-mapping still names a model to judge it").toMatch(/validator/i);
  });
});

describe("FR-FLOW-143 AC-4 — the agent-evaluated axes shrink, and the stated count follows", () => {
  it.each(COPIES)("%s no longer lists req-mapping or red-verification as agent axes", (_label, relPath) => {
    const subjects = tddAxisRows(body(relPath)).join("\n");
    expect(subjects, "req-mapping is still an agent-evaluated axis").not.toMatch(/req-mapping/);
    expect(subjects, "red-verification is still an agent-evaluated axis").not.toMatch(/red-verification/);
  });

  it.each(COPIES)("%s keeps the two judgement axes", (_label, relPath) => {
    const subjects = tddAxisRows(body(relPath)).join("\n");
    expect(subjects, "intent-alignment was dropped — it is a judgement axis and stays").toMatch(/intent-alignment/);
    expect(subjects, "technical-quality was dropped — it is a judgement axis and stays").toMatch(/tech|technical/);
  });

  it.each(COPIES)("%s states an axis count equal to the rows it declares", (_label, relPath) => {
    // The count and the table must move together. A prior requirement in this repository shipped a
    // stale count beside a changed table and every assertion stayed green.
    const text = body(relPath);
    const rows = tddAxisRows(text).length;
    expect(rows, "the Phase 1 verification table was not found").toBeGreaterThan(0);
    const stated = [...section(text, "### 4.2 ").matchAll(/(\d+)\s*축|축\s*(\d+)\s*개/g)].map((m) => Number(m[1] ?? m[2]));
    expect(stated.length, "the section states no axis count").toBeGreaterThan(0);
    for (const count of stated) {
      expect(count, `a stated count of ${count} contradicts the ${rows}-row table`).toBe(rows);
    }
  });

  it.each(COPIES)("%s does not still promise four parallel verifiers", (_label, relPath) => {
    // The heading and the mode matrix both carried "×4". Left alone they contradict the table.
    const text = body(relPath);
    const offenders = text
      .split(/\r?\n/)
      .filter((line) => /TDD\s*검증|병렬 TDD|Sonnet|standard/.test(line))
      .filter((line) => /×\s*4|x\s*4|4\s*개/.test(line));
    expect(offenders, "a line still promises four TDD verification subagents").toEqual([]);
  });
});

describe("FR-FLOW-143 AC-5 — the guarantee the axes carried is not weakened", () => {
  it.each(COPIES)("%s still requires the red evidence before the phase passes", (_label, relPath) => {
    const text = body(relPath);
    expect(text, "the red evidence record is gone").toMatch(/red_evidence/);
    // The recorded fields are the contract with the planner schema; moving the evaluator must not
    // silently record less than before.
    for (const field of ["command", "exit_code", "captured_failure", "timestamp"]) {
      expect(text, `the red evidence no longer records ${field}`).toContain(field);
    }
  });

  it.each(COPIES)("%s still blocks the phase on a missing red", (_label, relPath) => {
    // Scoped to the CRITICAL line of §4.2, not to the file. Searching the whole document only
    // proves the phrase exists somewhere; the phrase also appears in prose, so the blocking
    // attribution could be downgraded while this stayed green.
    const text = body(relPath);
    const start = text.indexOf("### 4.2 ");
    const end = text.indexOf("\n### ", start + 1);
    const critical = (end < 0 ? text.slice(start) : text.slice(start, end))
      .split(/\r?\n/)
      .find((line) => line.includes("**CRITICAL**")) ?? "";
    expect(critical, "§4.2 declares no CRITICAL line").not.toBe("");
    expect(critical, "red 미발생 is no longer a blocking condition").toMatch(/red 미발생/);
  });

  it.each(COPIES)("%s keeps the script verdicts blocking, not advisory", (_label, relPath) => {
    // The new decision table carries its own consequence sentence, and nothing asserted it. The
    // verdicts could have been softened to a warning with every other case still green — the axes
    // would have moved off agents and stopped gating anything, which is not the change asked for.
    const text = body(relPath);
    const start = text.indexOf("**req-mapping · red-verification 은");
    expect(start, "the script decision table was not found").toBeGreaterThan(-1);
    const table = text.slice(start, start + 1400);
    expect(table, "the req-mapping verdict no longer blocks").toMatch(/CRITICAL/);
    expect(table, "the script verdicts were downgraded to advisory").not.toMatch(/WARN|경고만|기록만|정보만/);
  });
});

describe("FR-FLOW-143 AC-6 — the required input has a stated source", () => {
  it.each(COPIES)("%s says where the validator's inventory input comes from", (_label, relPath) => {
    // The validator refuses without an inventory file, and the skill that produces one is a
    // different skill's phase. Naming the invocation without naming its input leaves the guarantee
    // resting on an upstream step having happened — the exact thing AC-6 forbids, reproduced one
    // argument further in.
    const text = body(relPath);
    const start = text.indexOf("### 4.2 ");
    const end = text.indexOf("\n### ", start + 1);
    const section = end < 0 ? text.slice(start) : text.slice(start, end);
    expect(section, "the required inventory input is never mentioned").toMatch(/inventory/i);
    expect(section, "the inventory's source is not stated").toMatch(/list_requirements|get_requirement/);
  });
});

describe("FR-FLOW-143 AC-6 — the reuse does not assume the validator already ran", () => {
  it.each(COPIES)("%s invokes the validator for its own task rather than trusting an upstream run", (_label, relPath) => {
    // kiwi-coder can be entered on a plan authored elsewhere. A guarantee conditional on an earlier
    // step having happened is not a guarantee.
    const scoped = section(body(relPath), "### 4.2 ");
    expect(scoped, "nothing says the validator is run here").toMatch(/validator/i);
    expect(scoped, "the skill assumes the validator already ran").not.toMatch(/이미 실행되었|이미 통과했다고 가정/);
  });
});
