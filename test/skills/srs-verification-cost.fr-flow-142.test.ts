import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { REPO_ROOT } from "./kiwi-orchestrator-variants.js";

// @req FR-FLOW-142 — SRS verification stops on severity and does not scale by document count.
//
// Measured before the change: process A exited only when it reported no improvement at all, the
// divergence guard was 5 by default and 8 under `--max`, and the `--max` fan-out was document count
// times three. Three research documents therefore cost up to eight rounds of nine verification
// subagents — spent converging the SRS onto prose the same skill had generated minutes earlier.

/** The file carrying §9.6 in each copy: claude keeps it inline, the others in the reference. */
const CARRIERS = [
  ["skills/claude", "skills/claude/kiwi-srs/SKILL.md"],
  ["skills/codex", "skills/codex/kiwi-srs/references/extended-workflow.md"],
  ["skills/etc", "skills/etc/kiwi-srs/references/extended-workflow.md"],
  [".agents mirror", ".agents/skills/kiwi-srs/references/extended-workflow.md"]
] as const;

/** Every document of the skill an agent can read, per variant — the summary description included. */
const ALL_DOCS = [
  "skills/claude/kiwi-srs/SKILL.md",
  "skills/codex/kiwi-srs/SKILL.md",
  "skills/codex/kiwi-srs/references/extended-workflow.md",
  "skills/etc/kiwi-srs/SKILL.md",
  "skills/etc/kiwi-srs/references/extended-workflow.md",
  ".agents/skills/kiwi-srs/SKILL.md",
  ".agents/skills/kiwi-srs/references/extended-workflow.md"
];

function body(relPath: string): string {
  return readFileSync(path.join(REPO_ROOT, relPath), "utf8");
}

function processALine(text: string): string {
  return text.split(/\r?\n/).find((line) => line.startsWith("**프로세스 A — 검증.**")) ?? "";
}

describe("FR-FLOW-142 AC-1 — the loop exits on severity, not on the absence of findings", () => {
  it.each(CARRIERS)("%s names a severity floor as the exit", (_label, relPath) => {
    const line = processALine(body(relPath));
    expect(line, "the process A paragraph was not found").not.toBe("");
    expect(line, "the exit condition names no severity floor").toMatch(/CRITICAL/);
    expect(line, "the exit condition names no severity floor").toMatch(/HIGH/);
  });

  it.each(CARRIERS)("%s no longer exits only when nothing at all is reported", (_label, relPath) => {
    // Over prose, "no findings remain" is not reachable by evidence, so the loop always ran to its
    // divergence guard and the guard — not the exit — was the real cost.
    const line = processALine(body(relPath));
    for (const exhaustion of ["개선사항이 없으면 종료", "0건이면 exit"]) {
      expect(line, `the exhaustion exit "${exhaustion}" survives`).not.toContain(exhaustion);
    }
  });
});

describe("FR-FLOW-142 AC-2/AC-4 — the fan-out is not multiplied by document count, anywhere", () => {
  it.each(ALL_DOCS)("%s states no per-document multiplier", (relPath) => {
    // Scanned over every document of the skill rather than the §9.6 carrier alone: the cost is also
    // stated in the summary description, which is what an agent reads first.
    const text = body(relPath);
    for (const multiplier of ["문서 수 × 3", "document count × 3"]) {
      expect(text, `a per-document multiplier "${multiplier}" remains`).not.toContain(multiplier);
    }
  });

  it.each(CARRIERS)("%s says the fan-out does not scale with the number of documents", (_label, relPath) => {
    const section = body(relPath);
    expect(section, "nothing states that document count does not multiply the fan-out").toMatch(
      /문서 수로 곱하지 않는다|문서 수와 무관/
    );
  });
});

describe("FR-FLOW-142 AC-3 — the bar on the requirements themselves is untouched", () => {
  it.each(["skills/claude/kiwi-srs/SKILL.md", "skills/codex/kiwi-srs/SKILL.md"])(
    "%s keeps its requirement-level severity gate",
    (relPath) => {
      // This requirement removes rounds spent comparing prose against prose. An acceptance criterion
      // is a contract and keeps the full policy; a change that relaxed it would be a different one.
      expect(body(relPath), "the requirement-level severity gate was relaxed too").toMatch(/CRITICAL=0\s*\+\s*HIGH=0/);
    }
  );

  it("skills/etc keeps its own gate, which was never phrased that way", () => {
    // Asserted separately on purpose. The `etc` variant states its gates as a decision table with a
    // severity per row rather than as one summary line, a divergence older than this requirement.
    // A single shared assertion would have made this variant fail for having always been different.
    const rows = body("skills/etc/kiwi-srs/SKILL.md")
      .split(/\r?\n/)
      .filter((line) => line.startsWith("|") && line.includes("**CRITICAL**"));
    expect(rows.length, "the etc variant's gate rows lost their blocking severity").toBeGreaterThan(0);
  });
});

describe("FR-FLOW-142 AC-5 — the mirror is regenerated, not hand-edited", () => {
  it("the mirror's §9.6 carrier matches skills/codex", () => {
    expect(body(".agents/skills/kiwi-srs/references/extended-workflow.md")).toBe(
      body("skills/codex/kiwi-srs/references/extended-workflow.md")
    );
  });
});
