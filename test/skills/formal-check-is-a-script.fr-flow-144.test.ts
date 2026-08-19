import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { REPO_ROOT } from "./kiwi-orchestrator-variants.js";

// @req FR-FLOW-144 — the formal check runs as a script, and its undefined axis gets a rule first.
//
// Three of its four axes restate rules the repository already decides mechanically. The fourth named
// "test coverage" and stated no criterion anywhere — not in the skill, not in its extended reference.
// So this is not a relocation. Three rules move; one is written for the first time.

const COPIES = [
  ["skills/claude", "skills/claude/kiwi-coder/SKILL.md"],
  ["skills/codex", "skills/codex/kiwi-coder/SKILL.md"],
  ["skills/etc", "skills/etc/kiwi-coder/SKILL.md"],
  [".agents mirror", ".agents/skills/kiwi-coder/SKILL.md"]
] as const;

function body(relPath: string): string {
  return readFileSync(path.join(REPO_ROOT, relPath), "utf8");
}

/** The line declaring the formal check inside the Phase 2 pipeline. Read raw — it lives in a fence. */
function formalCheckLine(text: string): string {
  return text.split(/\r?\n/).find((line) => /├─ \(e\) 정형 검사/.test(line)) ?? "";
}

describe("FR-FLOW-144 AC-5 — the formal check is no longer a subagent pass", () => {
  it.each(COPIES)("%s declares it as a script", (_label, relPath) => {
    const line = formalCheckLine(body(relPath));
    expect(line, "the formal check step was not found").not.toBe("");
    expect(line, "the formal check still names a model to run it").toMatch(/스크립트|script/);
  });

  it.each(COPIES)("%s leaves no sentence still describing it as a subagent pass", (_label, relPath) => {
    // Scoped to what directly FOLLOWS the label, not to the whole line. The mode matrix puts the
    // formal check and the TDD verifier in adjacent cells, so a whole-line search reports the
    // neighbouring column's model as if it were this one's — a false positive, not a finding.
    const offenders: string[] = [];
    for (const line of body(relPath).split(/\r?\n/)) {
      for (const match of line.matchAll(/정형 검사\s*([(（][^)）|]*[)）])?/g)) {
        // Model names only. `서브에이전트` was in this list and matched the replacement text's own
        // denial — "(**스크립트**, 서브에이전트 아님)" — because a token search cannot tell a claim
        // from its negation. Naming the models leaves nothing for a denial to trip.
        const attribution = match[1] ?? "";
        if (/세션 모델|Sonnet|high-reasoning|local evaluator/.test(attribution)) offenders.push(line);
      }
    }
    expect(offenders, "the formal check is still attributed to a model").toEqual([]);
  });
});

describe("FR-FLOW-144 AC-1 — the three restated axes reuse what already decides them", () => {
  it.each(COPIES)("%s points each restated axis at its existing decider", (_label, relPath) => {
    const text = body(relPath);
    // Anchored on the pipeline marker, not on the bare label: the label's first occurrence is in
    // the `@req` exemption list, and a window opened there reads the wrong section entirely.
    const start = text.indexOf("├─ (e) 정형 검사");
    const scope = text.slice(start, start + 1400);
    expect(scope, "the mock axis does not reuse the existing prohibition").toMatch(/§0\.6/);
    expect(scope, "the plan-code mapping axis does not reuse the preceding gate").toMatch(/§0\.7|ZERO TOLERANCE|\(d\)/);
  });
});

describe("FR-FLOW-144 AC-4 — each of the four rules is asserted on its own", () => {
  /**
   * One case per rule, deliberately not one case for the block. The formal check is a rule set in a
   * document rather than a shipped file, so no fixture can be fed to it; what CAN happen is a rule
   * quietly dropped from the set, and a single assertion over the whole block would let three
   * survivors mask the fourth's removal. Each of these fails alone when its own rule is deleted.
   */
  const RULES: ReadonlyArray<readonly [subject: string, pattern: RegExp]> = [
    ["the mock prohibition", /Mock 사용:/],
    ["the type and build rule", /타입\/빌드:/],
    ["the plan-code mapping rule", /계획-코드 매핑:/],
    ["the coverage rule", /테스트 커버리지:/]
  ];

  for (const [subject, pattern] of RULES) {
    it.each(COPIES)(`%s states ${subject}`, (_label, relPath) => {
      const text = body(relPath);
      const start = text.indexOf("├─ (e) 정형 검사");
      expect(start, "the formal check step was not found").toBeGreaterThan(-1);
      expect(text.slice(start, start + 1400), `${subject} was dropped from the rule set`).toMatch(pattern);
    });
  }
});

describe("FR-FLOW-144 AC-2/AC-3 — the coverage axis is given a rule, and the absence is recorded", () => {
  it.each(COPIES)("%s states what the coverage axis decides", (_label, relPath) => {
    const text = body(relPath);
    // Anchored on the pipeline marker, not on the bare label: the label's first occurrence is in
    // the `@req` exemption list, and a window opened there reads the wrong section entirely.
    const start = text.indexOf("├─ (e) 정형 검사");
    const scope = text.slice(start, start + 1400);
    // The chosen rule: every declared test case corresponds to a test that actually ran. A bare
    // percentage would have no threshold — the skill never stated one.
    expect(scope, "the coverage axis still names a subject with no rule").toMatch(/test_case/);
    expect(scope, "the coverage rule does not require the declared cases to have executed").toMatch(/실행된|실행/);
  });

  it.each(COPIES)("%s records that no coverage criterion previously existed", (_label, relPath) => {
    // Without this a later reader takes the new rule for a relocated one and looks for the original.
    const text = body(relPath);
    // Anchored on the pipeline marker, not on the bare label: the label's first occurrence is in
    // the `@req` exemption list, and a window opened there reads the wrong section entirely.
    const start = text.indexOf("├─ (e) 정형 검사");
    expect(text.slice(start, start + 1400), "the absence being repaired is not recorded").toMatch(
      /기준이 없었|정의된 적 없|처음 정의/
    );
  });
});
