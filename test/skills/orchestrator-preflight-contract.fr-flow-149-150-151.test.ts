import { describe, expect, it } from "vitest";
import { GATE_IDS } from "../../src/core/orchestrator/auto-gate.js";
import { ORCHESTRATOR_VARIANTS, criticalGateTable, readVariant } from "../support/critical-gate-table.js";

// @req FR-FLOW-149 — the two budget stops must be nameable by the agent that hits them.
// @req FR-FLOW-150 — the lane plan lock must have one path, per wave, passed explicitly.
// @req FR-FLOW-151 — the sub-issue count must declare a producer the gh surface actually has.

const VARIANTS = ORCHESTRATOR_VARIANTS;
const body = readVariant;

const RUN_BUDGET_GATE = "run-budget-exhausted";
const SUBAGENT_BUDGET_GATE = "subagent-budget-exhausted";
const LOCK_NAME = "lanes.lock.json";

/** The row of the options table that declares `option`, if any. */
function optionRow(text: string, option: string): string {
  const row = text.split("\n").find((line) => line.trimStart().startsWith(`| \`${option}`));
  return row ?? "";
}

/**
 * Every distinct STATED LOCATION of the lane plan lock — a mention carrying a directory component.
 * A bare `lanes.lock.json` names the artifact without saying where it lives, and prefixing that noun
 * with a path adds no location information; FR-FLOW-084 AC-3 pins one such bare reference.
 */
function lockPaths(text: string): string[] {
  const found = text.match(/[A-Za-z0-9_.{}-]+\/[A-Za-z0-9_./{}-]*lanes\.lock\.json/g) ?? [];
  return [...new Set(found)];
}

describe("FR-FLOW-149 the skill declares the budget stops it can end a run on", () => {
  for (const variant of VARIANTS) {
    it(`AC-1/AC-2/AC-5 declares both budget gates in the critical gate table — ${variant}`, () => {
      const table = criticalGateTable(body(variant));
      expect(table, "the critical gate table must exist to declare anything").not.toBe("");
      for (const gate of [RUN_BUDGET_GATE, SUBAGENT_BUDGET_GATE]) {
        const row = table.split("\n").find((line) => line.includes(gate)) ?? "";
        expect(row, `${gate} must have a row`).not.toBe("");
        // AC-1 asks for the firing point, not merely the name. A row whose location cell is empty
        // tells the agent a gate exists and never where it fires, which is what the table is for.
        const cells = row.split("|").map((cell) => cell.trim()).filter((cell) => cell.length > 0);
        expect(cells.length, `${gate} row must carry a reason and a location: ${row}`).toBeGreaterThanOrEqual(3);
        expect(cells[cells.length - 1], `${gate} must name where it fires`).toMatch(/stage|Phase|경계/);
      }
    });

    it(`AC-3/AC-4 each budget option names the gate it raises — ${variant}`, () => {
      const text = body(variant);
      expect(optionRow(text, "--run-budget"), "the run budget option row").toContain(RUN_BUDGET_GATE);
      const subagentRow = optionRow(text, "--subagent-budget");
      expect(subagentRow, "the subagent budget option row").toContain(SUBAGENT_BUDGET_GATE);
      // The verdict and reason class the row already specified must survive the edit.
      expect(subagentRow).toContain("fail-cap");
      expect(subagentRow).toContain("budget-exhausted");
    });
  }

  it("AC-6 both declared identifiers are members of the code-side union", () => {
    expect(GATE_IDS as readonly string[]).toContain(RUN_BUDGET_GATE);
    expect(GATE_IDS as readonly string[]).toContain(SUBAGENT_BUDGET_GATE);
  });
});

describe("FR-FLOW-150 the lane plan lock is spelled one way", () => {
  for (const variant of VARIANTS) {
    it(`AC-1/AC-2/AC-4/AC-5 every mention uses the same wave-scoped path — ${variant}`, () => {
      const paths = lockPaths(body(variant));
      expect(paths.length, `distinct spellings: ${paths.join(" | ")}`).toBe(1);
      // Wave-scoped, because the lock is re-frozen per wave and is that wave's verification
      // denominator; a run-scoped or wave-less path lets a later wave overwrite an earlier one.
      expect(paths[0]).toContain("wave-{n}");
    });

    it(`AC-3 every command that reads or writes the lock passes the path — ${variant}`, () => {
      const text = body(variant);
      const invocations = text
        .split("\n")
        .filter((line) => /orchestrate\s+(schedule|freeze|preflight)/.test(line) && /lane/i.test(line));
      expect(invocations.length, "there must be invocations to check").toBeGreaterThan(0);
      for (const line of invocations) {
        // A placeholder counts as passing it: the point is that no invocation leaves the path to the
        // tool's default, which spells the lock without a wave and would be shared across waves.
        expect(line, `an invocation must not rely on the tool default: ${line.trim()}`).toMatch(
          /(--out|--lock|--lane-plan)\s+\S/
        );
      }

      // The read side was already covered; the WRITE side was where the default still reached. A body
      // that never says how the lock is produced leaves `waves/lanes.lock.json` as the only way it can
      // exist, and that path has no wave in it. Requiring the producing call closes AC-5 at its source.
      const writeIndex = text.split("\n").findIndex((line) => /orchestrate\s+schedule\s+plan/.test(line));
      expect(writeIndex, "the body must say how the lock is written, not only where it is read").toBeGreaterThan(-1);
      // The citation checker admits only declared placeholder forms inside an invocation, so the
      // call cites `--out <path>` and the sentence beside it states which path. Both halves are
      // required: the flag alone would still let the caller inherit the wave-less default.
      const writeStanza = text.split("\n").slice(writeIndex, writeIndex + 2).join("\n");
      expect(writeStanza, "the producing call must pass --out").toMatch(/--out\s+\S/);
      expect(writeStanza, "and must state the wave-scoped path it writes to").toContain(
        `waves/wave-{n}/${LOCK_NAME}`
      );

      // And wherever the body states a location for the lock, it is the canonical one.
      for (const stated of lockPaths(text)) {
        expect(stated, "a stated lock location must be wave-scoped").toBe(`waves/wave-{n}/${LOCK_NAME}`);
      }
    });

    it(`AC-2 the worktree procedure states the path rather than a run-scoped one — ${variant}`, () => {
      const line = body(variant).split("\n").find((row) => row.includes("`--lane-plan` 은")) ?? "";
      expect(line, "the worktree procedure must still state the flag's value").not.toBe("");
      expect(line).toContain(`waves/wave-{n}/${LOCK_NAME}`);
      expect(line, "the run-scoped spelling must be gone").not.toContain("kiwi/orchestrator/");
    });

    it(`AC-6 a mention that only names the artifact stays a bare file name — ${variant}`, () => {
      const text = body(variant);
      // Loop P's unit denominator names the lock as a noun. FR-FLOW-084 AC-3 is verified and pins
      // that reference, so prefixing it with a path is a contradiction, not a tidy-up.
      const denominator = text.split("\n").find((line) => line.includes("`expected` = ")) ?? "";
      expect(denominator, "the unit denominator line must exist").not.toBe("");
      expect(denominator).toContain(`\`${LOCK_NAME}\``);
      expect(denominator, "the noun must not carry a path").not.toContain(`/${LOCK_NAME}`);
    });
  }
});

describe("FR-FLOW-151 the sub-issue count declares an obtainable producer", () => {
  for (const variant of VARIANTS) {
    it(`AC-1/AC-3/AC-4 the epic probe says the count comes from the issue body — ${variant}`, () => {
      const text = body(variant);
      const epicRow = text.split("\n").find((line) => /\|\s*S8\s*\|/.test(line)) ?? "";
      expect(epicRow, "the epic probe row must exist").not.toBe("");
      // Naming the body parse is the whole point: `gh issue view --json` has no sub-issue field and
      // the sub-issue endpoint returns zero for the tracking issues this rule exists to catch.
      expect(epicRow).toMatch(/본문|body/);
      // AC-2: the rule still reads the count, and the row it reads it from now says where it comes
      // from. Counting mentions alone would pass against the body that never explained the producer.
      const rule = text.split("\n").find((line) => line.includes("declared-multi-stage-input")) ?? "";
      expect(rule, "the routing rule that consumes the count must exist").not.toBe("");
      expect(rule).toContain("linked_sub_issues");
      expect(epicRow, "the producing row must say the count is parsed, not fetched").toContain("linked_sub_issues");
      expect(
        text,
        "the body must record that a native zero is not an absence of sub-issues"
      ).toMatch(/네이티브[^\n]*0|sub_issues[^\n]*0/);
    });

    it(`AC-5 the task-list-group half of the rule is untouched — ${variant}`, () => {
      expect(body(variant)).toContain("task_list_groups");
    });
  }
});
