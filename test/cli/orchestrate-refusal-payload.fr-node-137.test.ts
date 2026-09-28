import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { main } from "../../src/cli/index.js";
import { GATE_IDS } from "../../src/core/orchestrator/auto-gate.js";
import { emptyDriftInputs, emptyGitFacts, minimalCard } from "../core/orchestrator/resume-fixtures.js";
import { pinResumeRunRoot } from "./support/resume-run-root.js";

// FR-NODE-137 AC-1 — each phase-1 gate verb refuses at exit 2 with the payload `{ok: false, gate,
// violations[]}`, not merely with an exit code and a gate: the whole payload shape, per verb.

async function run(argv: string[]): Promise<{ exit: number; payload: Record<string, unknown> }> {
  const pipes = { stdout: new PassThrough(), stderr: new PassThrough() };
  const exit = await main([...argv, "--json"], pipes);
  const text = pipes.stdout.read()?.toString() ?? "";
  return { exit, payload: text.length > 0 ? (JSON.parse(text) as Record<string, unknown>) : {} };
}

async function write(root: string, relativePath: string, text: string): Promise<void> {
  const absolute = path.join(root, relativePath);
  await mkdir(path.dirname(absolute), { recursive: true });
  await writeFile(absolute, text, "utf8");
}

/** A journal line `validateWavesJournal` rejects: a wave `complete` with no passing verify record. */
function invalidLine(runId: string): string {
  return JSON.stringify({
    schema_version: "1.4.0",
    run_id: runId,
    engine: "kiwi-orchestrator",
    verb: "emit-and-finish",
    event: "result",
    wave: "wave-1",
    status: "complete",
    writer: "speckiwi-orchestrate/test"
  });
}

function expectRefusalPayload(verb: string, result: { exit: number; payload: Record<string, unknown> }): void {
  expect(result.exit, verb).toBe(2);
  expect(Object.keys(result.payload).sort(), `${verb} refusal payload keys`).toEqual(["gate", "ok", "violations"]);
  expect(result.payload.ok, `${verb} refusal carries ok: false`).toBe(false);
  expect(GATE_IDS, `${verb} gate is a GateId`).toContain(result.payload.gate);
  expect(Array.isArray(result.payload.violations), `${verb} violations is an array`).toBe(true);
  expect((result.payload.violations as unknown[]).length, `${verb} names what it refused`).toBeGreaterThan(0);
}

describe("FR-NODE-137 AC-1 — the refusal payload of each phase-1 gate verb", { timeout: 60_000 }, () => {
  it("FR-NODE-137 AC-1: `wave close`, `validate` and `resume` each refuse with {ok: false, gate, violations[]} at exit 2", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "speckiwi-fr-node-137-ac1-"));
    await write(root, "issues.json", JSON.stringify([
      { issueId: "ISS-1", wave: 1, class: "local-defect", source: "verify", resolutionKind: null, resolutionRef: null, userDecisionRef: null, designLockDigest: null, deferralReason: null }
    ]));
    await write(root, "resolution.json", JSON.stringify({ existingPaths: [], lineCounts: {}, testIds: [], commitShas: [] }));
    await write(root, "kiwi/waves.jsonl", `${invalidLine("run-a")}\n`);
    await write(root, "card.json", JSON.stringify(await pinResumeRunRoot(minimalCard(), root)));
    await write(root, "facts.json", JSON.stringify({ gitFacts: emptyGitFacts(), driftInputs: emptyDriftInputs() }));

    expectRefusalPayload("wave close", await run(["--root", root, "orchestrate", "wave", "close", "--wave", "1", "--ledger", "issues.json", "--resolution", "resolution.json"]));
    expectRefusalPayload("validate", await run(["--root", root, "orchestrate", "validate", "--run-id", "run-a"]));
    expectRefusalPayload("resume", await run(["--root", root, "orchestrate", "resume", "--run-id", "run-a", "--card", "card.json", "--facts", "facts.json"]));
  });
});
