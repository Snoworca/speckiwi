import { describe, expect, it } from "vitest";
import { GATE_IDS } from "../../src/core/orchestrator/auto-gate.js";
import { ORCHESTRATOR_VARIANTS, criticalGateTable, readVariant } from "../support/critical-gate-table.js";

// @req FR-FLOW-149 — the two budget stops must be nameable by the agent that hits them.
// @req FR-FLOW-150 — the lane plan lock must have one path, passed explicitly.
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
    // The one stated location is read from the run's fixed-path convention list rather than written
    // here, so the assertions below compare the body with itself. FR-FLOW-150 AC-5 (a per-wave path)
    // is retired in 4.0.0: one lock plans one lane per wave across the waves of a stage (FR-NODE-213
    // AC-1), so the path no longer carries a wave component.
    const canonical = (text: string): string => {
      const convention = text.split("\n").find((line) => line.includes("고정 경로 규약")) ?? "";
      return lockPaths(convention)[0] ?? "";
    };

    it(`FR-FLOW-150 AC-1/AC-4 every stated location of the lock is the same path — ${variant}`, () => {
      const text = body(variant);
      const paths = lockPaths(text);
      expect(paths.length, `distinct spellings: ${paths.join(" | ")}`).toBe(1);
      expect(canonical(text), "the fixed-path convention list must state the lock's location").not.toBe("");
      expect(paths[0]).toBe(canonical(text));
    });

    it(`FR-FLOW-150 AC-3 every command that reads or writes the lock passes the path — ${variant}`, () => {
      const text = body(variant);
      const lines = text.split("\n");
      const invocations = lines.filter((line) => /orchestrate\s+(schedule|freeze|preflight)/.test(line) && /lane/i.test(line));
      expect(invocations.length, "there must be invocations to check").toBeGreaterThan(0);
      for (const line of invocations) {
        // A placeholder counts as passing it: the point is that no invocation leaves the path to the
        // tool's default, which spells the lock without a stage and would be shared across stages.
        expect(line, `an invocation must not rely on the tool default: ${line.trim()}`).toMatch(
          /(--out|--lock|--lane-plan)\s+\S/
        );
      }

      // The WRITE side is where the default still reaches. The producing call is `orchestrate schedule
      // waves` (FR-NODE-213 AC-1; the `schedule plan --plan <sidecar>` call it replaced is removed by
      // FR-NODE-213 AC-3). The citation checker admits only placeholder forms inside an invocation, so
      // the fenced call cites `--out <path>` and the paragraph right after the fence states which path.
      // Both halves are required: the flag alone would still let the caller inherit the default.
      const writeIndex = lines.findIndex((line) => /^speckiwi\s+orchestrate\s+schedule\s+waves\b/.test(line.trim()));
      expect(writeIndex, "the body must say how the lock is written, not only where it is read").toBeGreaterThan(-1);
      expect(lines[writeIndex], "the producing call must pass --out").toMatch(/--out\s+\S/);
      const fenceClose = lines.findIndex((line, index) => index > writeIndex && line.trim().startsWith("```"));
      expect(fenceClose, "the producing call sits in a code fence").toBeGreaterThan(writeIndex);
      const explanation = lines.slice(fenceClose + 1).find((line) => line.trim().length > 0) ?? "";
      expect(explanation, "the paragraph after the call must say what --out is").toMatch(/`--out` 은/);
      expect(explanation, "and must state the path it writes to").toContain(canonical(text));

      // And wherever the body states a location for the lock, it is the canonical one.
      for (const stated of lockPaths(text)) {
        expect(stated, "a stated lock location must be the convention's path").toBe(canonical(text));
      }
    });

    it(`FR-FLOW-150 AC-2 the worktree procedure states the path rather than a run-scoped one — ${variant}`, () => {
      const text = body(variant);
      const line = text.split("\n").find((row) => row.includes("`--lane-plan` 은")) ?? "";
      expect(line, "the worktree procedure must still state the flag's value").not.toBe("");
      expect(line).toContain(canonical(text));
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
