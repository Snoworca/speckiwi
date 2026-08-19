import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { main } from "../../../src/cli/index.js";
import { GATE_IDS } from "../../../src/core/orchestrator/auto-gate.js";
import { ORCHESTRATOR_VARIANTS, criticalGateTable, declaredGateIds, readVariant } from "../../support/critical-gate-table.js";

// @req FR-NODE-195 — a run that stopped because a budget ran out has to be able to say so. The
// abort line names a gate, an `abort_gate` outside the union is refused at append time, and neither
// budget path had an identifier — so the only ways to record the stop were to be refused or to name
// a false cause.

const RUN_BUDGET_GATE = "run-budget-exhausted";
const SUBAGENT_BUDGET_GATE = "subagent-budget-exhausted";

function io() {
  return { stdout: new PassThrough(), stderr: new PassThrough() };
}

function drain(stream: PassThrough): string {
  return stream.read()?.toString() ?? "";
}

interface Run {
  readonly exit: number;
  readonly payload: Record<string, unknown>;
}

/** Appends one abort line carrying `gate` and reports what the append made of it. */
async function appendAbort(gate: string): Promise<Run> {
  const root = await mkdtemp(path.join(tmpdir(), "speckiwi-budget-gate-"));
  const payload = JSON.stringify({
    schema_version: "1.4.0",
    run_id: "r1",
    engine: "kiwi-orchestrator",
    verb: "abort-run",
    event: "result",
    wave: "all",
    abort_gate: gate
  });
  const pipes = io();
  const exit = await main(
    ["--root", root, "orchestrate", "journal", "append", "--run-id", "r1", "--payload", payload, "--json"],
    pipes
  );
  const text = `${drain(pipes.stdout)}${drain(pipes.stderr)}`;
  return { exit, payload: text.length > 0 ? (JSON.parse(text) as Record<string, unknown>) : {} };
}

function violationCodes(run: Run): string[] {
  const rows = (run.payload.violations ?? []) as Array<{ code?: string }>;
  return rows.map((row) => row.code ?? "");
}

describe("FR-NODE-195 the gate vocabulary names both budget exhaustion paths", () => {
  it("AC-1 carries an identifier for wall-clock run budget exhaustion", () => {
    expect(GATE_IDS as readonly string[]).toContain(RUN_BUDGET_GATE);
  });

  it("AC-2 carries a separate identifier for subagent budget exhaustion", () => {
    expect(GATE_IDS as readonly string[]).toContain(SUBAGENT_BUDGET_GATE);
    expect(RUN_BUDGET_GATE).not.toBe(SUBAGENT_BUDGET_GATE);
  });

  it("AC-3 accepts either identifier on an abort line where an unknown one is refused", async () => {
    const invented = await appendAbort("totally-made-up-gate");
    expect(violationCodes(invented), "the control must fail, or acceptance below proves nothing").toContain(
      "abort-gate-outside-vocabulary"
    );

    for (const gate of [RUN_BUDGET_GATE, SUBAGENT_BUDGET_GATE]) {
      const accepted = await appendAbort(gate);
      expect(violationCodes(accepted), `${gate} must be inside the vocabulary`).not.toContain(
        "abort-gate-outside-vocabulary"
      );
      expect(accepted.exit, `${gate} append: ${JSON.stringify(accepted.payload)}`).toBe(0);
    }
  });

  it("AC-4 keeps both distinct from the wave-addition cap, which counts waves rather than a budget", () => {
    const union = GATE_IDS as readonly string[];
    expect(union).toContain("wave-append-cap-exhausted");
    // Read from the union, not from the two literals above — comparing literals to a literal is a
    // tautology that never touches the code the criterion is about.
    const budgetGates = union.filter((gate) => gate.endsWith("-budget-exhausted"));
    expect(budgetGates).toHaveLength(2);
    expect(budgetGates).not.toContain("wave-append-cap-exhausted");
    expect(new Set(union).size, "no duplicate was introduced").toBe(union.length);
  });

  it("AC-5 every identifier the shipped skills declare is a member of the union", () => {
    const union = new Set(GATE_IDS as readonly string[]);
    for (const variant of ORCHESTRATOR_VARIANTS) {
      const declared = declaredGateIds(criticalGateTable(readVariant(variant)));
      expect(declared.length, `${variant} must declare gates`).toBeGreaterThan(0);
      expect(declared, `${variant} must declare the new gates`).toContain(RUN_BUDGET_GATE);
      for (const gate of declared) {
        expect(union.has(gate), `${variant} declares ${gate}, which is outside the union`).toBe(true);
      }
    }
  });
});
