import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// Acceptance criteria whose obligation is a record in the requirement itself — a runtime-lag note in the
// Verification Evidence, a mutation-battery record, a decision written into the Implementation Notes.
// Each case reads the requirement block from docs/spec and holds the record to the facts its AC names.
// The SRS is read, never written; each case also removes the record from its in-memory copy and checks
// the predicate then fails, so a predicate that would pass without the record cannot ship.

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const SRS = readFileSync(path.join(REPO_ROOT, "docs/spec/60.workflow-release.srs.md"), "utf8").replace(/\r\n/g, "\n");

function block(id: string): string {
  const start = SRS.indexOf(`### ${id} `);
  expect(start, `${id} is not in 60.workflow-release.srs.md`).toBeGreaterThanOrEqual(0);
  const end = SRS.indexOf("\n### ", start + 5);
  return SRS.slice(start, end < 0 ? undefined : end);
}

/** The Verification Evidence rows whose Covers cell names `ac`. */
function evidenceRows(text: string, ac: string): string[] {
  return text
    .split("\n")
    .filter((line) => /^\| VE-\d+ \|/.test(line))
    .filter((line) => (line.split("|")[4] ?? "").split(/[ ,]+/).includes(ac));
}

function recorded(text: string, ac: string, needles: readonly string[]): boolean {
  return evidenceRows(text, ac).some((row) => needles.every((needle) => row.includes(needle)));
}

/** The block with every evidence row covering `ac` removed — the planted mutation. */
function withoutRecord(text: string, ac: string): string {
  return text
    .split("\n")
    .filter((line) => !(/^\| VE-\d+ \|/.test(line) && (line.split("|")[4] ?? "").split(/[ ,]+/).includes(ac)))
    .join("\n");
}

const LAG = "Runtime-lag note";
const CHARTER = "00.charter.md:303-304";
const ORCH = "~/.claude/skills/kiwi-orchestrator/SKILL.md";
const PM = "~/.claude/skills/kiwi-pm/SKILL.md";

// [title — names the requirement and AC it cites, the facts the record must carry]
const RECORDS: ReadonlyArray<readonly [string, readonly string[]]> = [
  ["FR-FLOW-084 AC-11: the runtime-lag note names the installed orchestrator path and the charter ban", [LAG, ORCH, CHARTER]],
  ["FR-FLOW-090 AC-11: the runtime-lag note names the installed orchestrator path and the charter ban", [LAG, "~/.claude/skills/kiwi-orchestrator/", CHARTER]],
  ["FR-FLOW-091 AC-10: the runtime-lag note names the installed orchestrator path and the charter ban", [LAG, "~/.claude/skills/kiwi-orchestrator/", CHARTER]],
  ["FR-FLOW-094 AC-7: the runtime-lag note names the installed orchestrator path and the charter ban", [LAG, "~/.claude/skills/kiwi-orchestrator/", CHARTER]],
  [
    "FR-FLOW-099 AC-12: the runtime-lag note names the three installed skills and the absent orchestrator",
    [LAG, "~/.claude/skills/kiwi-tdd/SKILL.md", PM, "~/.claude/skills/kiwi-review-fix-loop/SKILL.md", ORCH, CHARTER]
  ],
  [
    "FR-FLOW-100 AC-7: the runtime-lag note names the installed wave-master, the shared modules and the absent orchestrator",
    [LAG, "~/.claude/skills/kiwi-wave-master/SKILL.md", "~/.claude/skills/_shared/kiwi/", ORCH, CHARTER]
  ],
  ["FR-FLOW-101 AC-10: the runtime-lag note says ~/.claude/skills/ carries no kiwi-orchestrator", [LAG, "~/.claude/skills/", "no kiwi-orchestrator/SKILL.md", CHARTER]],
  ["FR-FLOW-102 AC-8: the runtime-lag note names the installed kiwi-pm and the absent orchestrator", [LAG, PM, ORCH, CHARTER]],
  ["FR-FLOW-112 AC-5: the runtime-lag note names the installed loop-option.md", [LAG, "~/.claude/skills/_shared/kiwi/loop-option.md", CHARTER]],
  [
    "FR-FLOW-113 AC-8: the record says the installed kiwi-pm was refreshed by init -g outside this repository and carries no retired flag",
    ["2026-09-28", PM, "speckiwi init -g", "not against this repository", "--handoff", "--from-task"]
  ],
  ["FR-FLOW-115 AC-7: the runtime-lag note names the installed kiwi-pm that lacks the flag", [LAG, PM, "--commit-lane-work", CHARTER]],
  ["FR-FLOW-165 AC-9: the mutation battery is recorded with try/finally and an md5 restore check", ["try/finally", "md5", "zero restore mismatches"]]
];

describe("Acceptance criteria that are satisfied by a record in the requirement", () => {
  it.each(RECORDS)("%s", (title, needles) => {
    const [id, ac] = /^(FR-FLOW-\d+) (AC-\d+):/.exec(title)?.slice(1) ?? [];
    const text = block(id as string);
    expect(recorded(text, ac as string, needles), `${id} ${ac}: no evidence row carries ${needles.join(" · ")}`).toBe(true);
    expect(recorded(withoutRecord(text, ac as string), ac as string, needles), `${id} ${ac}: the predicate passes without the record`).toBe(false);
  });

  it("FR-FLOW-177 AC-6: what the change does not settle is recorded in the requirement", () => {
    const text = block("FR-FLOW-177");
    const notes = text.split("\n").find((line) => line.includes("No version bump, per AC-6")) ?? "";
    expect(notes, "the Implementation Notes must record the decision not to bump the rules version").not.toBe("");
    expect(notes).toContain("a re-init is the whole propagation path");
    expect(recorded(text, "AC-6", ["not to bump the bundled rules version"]), "the evidence row must point at that record").toBe(true);
    const ac6 = text.split("\n").find((line) => /^- \[[ x]\] AC-6:/.test(line)) ?? "";
    expect(ac6, "a consumer that never re-runs init is named as unreached").toContain("never re-runs init");
    expect(ac6, "the prose is not derived from the code automatically").toContain("does not derive the prose from the code automatically");
    const planted = text.replace("No version bump, per AC-6", "Version handled");
    expect(planted.split("\n").some((line) => line.includes("No version bump, per AC-6")), "the planted copy must lose the record").toBe(false);
  });
});
