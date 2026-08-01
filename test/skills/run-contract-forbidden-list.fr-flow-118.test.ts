import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// @req FR-FLOW-118 — the run contract's closed list of forbidden actions has a fixed membership.
//
// `FR-FLOW-093` names the list and pins two of its eight entries: AC-3 the merge / pull-request pair,
// AC-5 the bulk-staging pair. Nothing fixed the other four, and no test asserted the list at all — so
// five of eight could have been deleted from a shipped skill with every gate staying green. A list
// that calls itself closed while its membership is unasserted is closed in name only.

const VARIANTS = ["claude", "codex", "etc"] as const;
const REPO_ROOT = path.resolve(__dirname, "../..");

/**
 * The eight prohibitions, each identified by the shortest fragment that is unique to it within the
 * list line. Declared as a set rather than a count, so a ninth prohibition arriving undeclared fails
 * the exhaustiveness case below rather than passing a `length === 8` check.
 */
const FORBIDDEN = {
  "re-decomposition": "재분해 금지",
  "requirement-id allocation outside 3.b": "Requirement ID 할당 금지",
  "editing a completed unit": "완료된 단위 편집 금지",
  "weakening or deleting tests": "테스트 약화·삭제 금지",
  "writing outside the lease": "lease 밖 쓰기 금지",
  "hand-appending to the run journal": "직접 append 금지",
  "bulk staging": "`git add -A` 와 `git commit -a` 절대 금지",
  "merging into base or opening a pull request": "`base_branch` 로 병합 금지, PR 생성 금지"
} as const;

const HEADING = "금지 행동의 닫힌 목록";

function listLine(variant: (typeof VARIANTS)[number]): string {
  const body = readFileSync(path.resolve(REPO_ROOT, `skills/${variant}/kiwi-orchestrator/SKILL.md`), "utf8");
  return body.split(/\r?\n/).find((line) => line.includes(HEADING)) ?? "";
}

describe("FR-FLOW-118 — the closed list cannot shrink silently", () => {
  it("AC-1: the list exists in all three variants and is the same line in each", () => {
    const lines = VARIANTS.map(listLine);
    for (const [index, line] of lines.entries()) {
      expect(line, `${VARIANTS[index]} must state the closed list`).not.toBe("");
    }
    expect(new Set(lines).size, "the three variants must state the list identically").toBe(1);
  });

  for (const variant of VARIANTS) {
    it.each(Object.entries(FORBIDDEN))(`AC-1: ${variant} forbids %s`, (label, fragment) => {
      expect(listLine(variant).includes(fragment), `${variant}: the list must forbid ${label}`).toBe(true);
    });
  }

  // AC-3: exhaustiveness in the other direction. The list's own separator is `;`, so its entry count
  // is readable from the document; comparing that against the declared set catches a ninth
  // prohibition arriving without a declaration here, which a membership check alone would miss.
  it("AC-3: the list carries no entry this file does not declare", () => {
    const entries = listLine("claude")
      .split(HEADING)[1]!
      .split(";")
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0);
    expect(entries.length, "a zero-entry parse would make every case above vacuous").toBeGreaterThan(0);
    const fragments = Object.values(FORBIDDEN);
    const undeclared = entries.filter((entry) => !fragments.some((fragment) => entry.includes(fragment)));
    expect(undeclared, "these list entries are not declared in FORBIDDEN").toEqual([]);
    expect(entries.length, "the declared set and the document must agree on the entry count").toBe(fragments.length);
  });

  // AC-2. Asserting that `String.replace` removes a substring would assert JavaScript, not this
  // document — so the check runs the *assertions above* against a mutated line and requires each one
  // to throw. `checkList` is the same predicate the per-entry cases use, which is what makes a red
  // here mean the same thing a red there does.
  it("AC-2: deleting any one entry makes this file's own check fail", () => {
    const line = listLine("claude");
    const checkList = (candidate: string): void => {
      for (const [label, fragment] of Object.entries(FORBIDDEN)) {
        if (!candidate.includes(fragment)) throw new Error(`the list no longer forbids ${label}`);
      }
    };
    expect(() => checkList(line), "the unmutated line must pass").not.toThrow();
    for (const [label, fragment] of Object.entries(FORBIDDEN)) {
      const mutated = line.replace(fragment, "");
      expect(mutated, `the probe for ${label} replaced nothing, so it proves nothing`).not.toBe(line);
      expect(() => checkList(mutated), `deleting ${label} must fail the check`).toThrow(label);
    }
  });
});
