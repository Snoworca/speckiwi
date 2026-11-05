import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import type { OrchTrailerCommit } from "../../../src/core/orchestrator/lane-state.js";
import { computeResumeState } from "../../../src/core/orchestrator/resume.js";
import { parseWavesJournal, verbKey } from "../../../src/core/orchestrator/waves-journal.js";
import { validateWavesJournal } from "../../../src/core/orchestrator/waves-validate.js";
import { emptyDriftInputs, emptyGitFacts, minimalCard } from "./resume-fixtures.js";
import { complete, finalVerify, intent, journalRoot, result, waveVerify, type Json } from "./waves-fixtures.js";

// A journal that spells one wave `wave-01` on some lines and `wave-1` on others names one wave, as the
// status readers (`waveNumber`), `lane-state.ts` and `unit-gate.ts` already read it. The resume's lane
// classification and the completion gate's search for the latest wave-verify record follow that rule.

const RUN = "run-a";
const BASE = { schema_version: "1.4.0", run_id: RUN, engine: "kiwi-orchestrator", writer: "speckiwi-orchestrate/test" } as const;
const LANDED: readonly OrchTrailerCommit[] = [{ commit: "aaaa111", trailers: { "Orch-Run": RUN, "Orch-Wave": "1", "Orch-Stage": "1", "Orch-Lane": "lane-1" } }];

const roots: string[] = [];
afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

async function resumeWith(lines: Record<string, unknown>[], integrationCommits: readonly OrchTrailerCommit[] = []) {
  const root = mkdtempSync(path.join(tmpdir(), "wave-spelling-"));
  roots.push(root);
  mkdirSync(path.join(root, "kiwi"), { recursive: true });
  writeFileSync(path.join(root, "kiwi/waves.jsonl"), lines.map((line) => JSON.stringify(line)).join("\n") + "\n", "utf8");
  const view = await parseWavesJournal({ root }, { runId: RUN, engine: "kiwi-orchestrator", relativePath: "kiwi/waves.jsonl" });
  return computeResumeState(view, minimalCard(), emptyGitFacts({ integrationCommits }), emptyDriftInputs());
}

const VERIFY = { ...BASE, wave: "wave-1", order: 1, target: "wave-1", phase: "wave-verify", status: "in_progress", summary: "verify", verification: { verdict: "pass" } };

describe("FR-NODE-160 the resume reads a lane of wave 1 whichever way a line spells the wave", () => {
  // @req FR-NODE-160 AC-4
  it("FR-NODE-160 AC-4 a lane named only on wave-01 lines is a lane of the card's wave 1", async () => {
    const state = await resumeWith([
      VERIFY,
      { ...BASE, wave: "wave-01", stage: 1, lane: "lane-1", verb: "dispatch-lane", event: "intent" },
      { ...BASE, wave: "wave-01", stage: 1, lane: "lane-1", verb: "dispatch-lane", event: "result" }
    ]);
    expect(state.classification.map((entry) => [entry.lane, entry.klass])).toEqual([["lane-1", "not-dispatched"]]);
  });

  // @req FR-NODE-160 AC-1
  it("FR-NODE-160 AC-1 an integrate-lane result spelled wave-01 counts for the lane a wave-1 line named", async () => {
    const state = await resumeWith(
      [
        VERIFY,
        { ...BASE, wave: "wave-1", stage: 1, lane: "lane-1", verb: "dispatch-lane", event: "intent" },
        { ...BASE, wave: "wave-1", stage: 1, lane: "lane-1", verb: "dispatch-lane", event: "result" },
        { ...BASE, wave: "wave-01", stage: 1, lane: "lane-1", verb: "integrate-lane", event: "intent" },
        { ...BASE, wave: "wave-01", stage: 1, lane: "lane-1", verb: "integrate-lane", event: "result" }
      ],
      LANDED
    );
    expect(state.classification.map((entry) => [entry.lane, entry.klass])).toEqual([["lane-1", "lane-landed"]]);
  });
});

describe("FR-NODE-142 the completion gate finds a wave-verify record whichever way it spells the wave", () => {
  async function codes(lines: Json[]): Promise<string[]> {
    const root = await journalRoot(lines);
    return validateWavesJournal(await parseWavesJournal(root, { runId: RUN, engine: "kiwi-wave-master" })).map((item) => item.code);
  }

  // @req FR-NODE-142 AC-1
  it("FR-NODE-142 AC-1 a passing wave-verify record spelled wave-01 opens the gate for a wave-1 complete, and the reverse", async () => {
    expect(await codes([waveVerify({ wave: "wave-01" }), complete(), finalVerify()])).toEqual([]);
    expect(await codes([waveVerify(), complete({ wave: "wave-01" }), finalVerify()])).toEqual([]);
  });

  // @req FR-NODE-142 AC-1
  it("FR-NODE-142 AC-1 a record of another wave still opens nothing", async () => {
    expect(await codes([waveVerify({ wave: "wave-2" }), complete(), finalVerify()])).toContain("complete-without-latest-pass");
  });
});

describe("FR-NODE-150 an intent and its result pair up whichever way each spells the wave", () => {
  const V14 = { schema_version: "1.4.0", engine: "kiwi-orchestrator", writer: "speckiwi-orchestrate/2.4.1" } as const;

  async function resumeOf(lines: Json[]) {
    const root = await journalRoot(lines);
    const view = await parseWavesJournal(root, { runId: RUN, engine: "kiwi-orchestrator" });
    return computeResumeState(view, minimalCard(), emptyGitFacts(), emptyDriftInputs());
  }

  // @req FR-NODE-150 AC-2
  it("FR-NODE-150 AC-2 a result spelled wave-01 closes an intent spelled wave-1, so the verb is not interrupted", async () => {
    const state = await resumeOf([waveVerify(V14), intent("dispatch-lane", { stage: 1, lane: "lane-1" }), result("dispatch-lane", { stage: 1, lane: "lane-1", wave: "wave-01" })]);
    expect(state.nextAction.interrupted).toBe(false);
    const open = await resumeOf([waveVerify(V14), intent("dispatch-lane", { stage: 1, lane: "lane-1", wave: "wave-01" })]);
    expect(open.nextAction.interrupted).toBe(true);
  });

  // @req FR-NODE-150 AC-2
  it("FR-NODE-150 AC-2 the program-counter key of a canonically spelled line is byte for byte what it was", () => {
    const line = (wave: string | undefined) => ({ journalLine: 1, verb: "dispatch-lane", ...(wave === undefined ? {} : { wave }), stage: 1, lane: "lane-1" });
    expect(verbKey(line("wave-1"))).toBe("dispatch-lane|wave-1|1|lane-1");
    expect(verbKey(line("wave-12"))).toBe("dispatch-lane|wave-12|1|lane-1");
    expect(verbKey(line("all"))).toBe("dispatch-lane|all|1|lane-1");
    expect(verbKey(line(undefined))).toBe("dispatch-lane||1|lane-1");
    expect(verbKey(line("wave-01"))).toBe(verbKey(line("wave-1")));
  });
});
