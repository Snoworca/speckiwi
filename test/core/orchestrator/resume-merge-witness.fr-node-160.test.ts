import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { hasMergeWitness, type OrchTrailerCommit } from "../../../src/core/orchestrator/lane-state.js";
import { computeResumeState } from "../../../src/core/orchestrator/resume.js";
import { parseWavesJournal } from "../../../src/core/orchestrator/waves-journal.js";
import { emptyDriftInputs, emptyGitFacts, minimalCard } from "./resume-fixtures.js";

// @req FR-NODE-160 — a resumed session recognises a unit that already landed.
//
// `resume.ts` decided landing from `branch.ancestorOfIntegration`, a lane-branch ancestry proof.
// Phase 1 creates no lane branch — the unit commits onto the integration branch, which the module's
// own comment says — so that value was structurally always false and a landed unit fell through to
// `not-dispatched` with `nextVerb: execute-unit`, `reconciliation: consistent` and `blocking: null`.
// The predicate that gets it right, `hasMergeWitness`, already existed and was tested; `GitFacts`
// simply had no field a commit trailer could arrive in, so the landed and unlanded cases were
// indistinguishable by construction.

const RUN = "run-a";
const BASE = { schema_version: "1.4.0", run_id: RUN, engine: "kiwi-orchestrator", writer: "speckiwi-orchestrate/test" } as const;

const LINES: Record<string, unknown>[] = [
  { ...BASE, wave: "wave-1", order: 1, target: "wave-1", phase: "wave-verify", status: "in_progress", summary: "verify", verification: { verdict: "pass" } },
  { ...BASE, wave: "wave-1", stage: 1, lane: "lane-1", verb: "execute-unit", event: "intent" },
  { ...BASE, wave: "wave-1", stage: 1, lane: "lane-1", verb: "execute-unit", event: "result" }
];

/** What a landed phase-1 unit leaves: a trailered commit on the integration branch, no lane branch. */
const LANDED: readonly OrchTrailerCommit[] = [
  { commit: "aaaa111", trailers: { "Orch-Run": RUN, "Orch-Wave": "1", "Orch-Stage": "1", "Orch-Lane": "lane-1", "Orch-Task": "T-PH001-01" } }
];

const roots: string[] = [];
afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

async function resumeWith(integrationCommits: readonly OrchTrailerCommit[]): ReturnType<typeof computeResumeState> extends infer T ? Promise<T> : never {
  const root = mkdtempSync(path.join(tmpdir(), "fr-node-160-"));
  roots.push(root);
  mkdirSync(path.join(root, "kiwi"), { recursive: true });
  writeFileSync(path.join(root, "kiwi/waves.jsonl"), LINES.map((line) => JSON.stringify(line)).join("\n") + "\n", "utf8");
  const view = await parseWavesJournal({ root }, { runId: RUN, engine: "kiwi-orchestrator", relativePath: "kiwi/waves.jsonl" });
  return computeResumeState(view, minimalCard(), emptyGitFacts({ integrationCommits }), emptyDriftInputs());
}

function laneClass(state: Awaited<ReturnType<typeof resumeWith>>, lane: string): string | undefined {
  return state.classification.find((entry) => entry.lane === lane)?.klass;
}

describe("FR-NODE-160 — a landed unit is not re-executed", () => {
  it("AC-3: the shared predicate already answers correctly over the same commits", () => {
    expect(hasMergeWitness(LANDED, RUN, { wave: 1, stage: 1, lane: "lane-1" })).toBe(true);
  });

  it("AC-4: with no trailered commit the lane is still not-dispatched and execute-unit is still next", async () => {
    const state = await resumeWith([]);
    expect(laneClass(state, "lane-1"), "the class must survive for the unlanded case").toBe("not-dispatched");
    expect(state.nextAction?.verb).toBe("execute-unit");
  });

  it("AC-1: with the trailered commit the lane is not not-dispatched and execute-unit is not next", async () => {
    const state = await resumeWith(LANDED);
    expect(laneClass(state, "lane-1"), "a landed unit must not read as never dispatched").not.toBe("not-dispatched");
    expect(state.nextAction?.verb, "a landed unit must not be re-executed").not.toBe("execute-unit");
  });

  it("AC-5: a landed run is not reported reconciled-and-unblocked while directing a re-execution", async () => {
    const state = await resumeWith(LANDED);
    const directsReExecution = state.nextAction?.verb === "execute-unit";
    const claimsFine = state.blocking === null;
    expect(directsReExecution && claimsFine, "the tool must not affirm the state is unblocked while re-running landed work").toBe(false);
  });
});
