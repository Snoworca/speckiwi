import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { main } from "../../src/cli/index.js";
import { computeInvariantDigest, resumeCardPath, type ResumeCard } from "../../src/core/orchestrator/resume-card.js";
import { pinResumeRunRoot } from "./support/resume-run-root.js";

// @req FR-NODE-160 AC-2 — the witness is supplied by the CALLER.
//
// The kernel accepting a field proves nothing about a run: this session's own record is full of pure
// predicates that were correct and reachable by nothing. This file drives `main()`, so what it
// asserts is that a `--facts` bundle carrying `integrationCommits` reaches the classification and
// changes it — the difference between a declared field and a wired one.

const RUN_ID = "run-a";

function io() {
  return { stdout: new PassThrough(), stderr: new PassThrough() };
}

function drain(stream: PassThrough): Record<string, unknown> {
  return JSON.parse(stream.read()?.toString() ?? "{}") as Record<string, unknown>;
}

async function write(root: string, relativePath: string, text: string): Promise<void> {
  const absolute = path.join(root, relativePath);
  await mkdir(path.dirname(absolute), { recursive: true });
  await writeFile(absolute, text, "utf8");
}

const BASE = { schema_version: "1.4.0", run_id: RUN_ID, engine: "kiwi-orchestrator", writer: "speckiwi-orchestrate/test" } as const;

const JOURNAL = [
  { ...BASE, wave: "wave-1", order: 1, target: "wave-1", phase: "wave-verify", status: "in_progress", summary: "verify", verification: { verdict: "pass" } },
  { ...BASE, wave: "wave-1", stage: 1, lane: "lane-1", verb: "execute-unit", event: "intent" },
  { ...BASE, wave: "wave-1", stage: 1, lane: "lane-1", verb: "execute-unit", event: "result" }
];

function frozenBlock(): ResumeCard["frozen"] {
  return {
    engine: "kiwi-orchestrator",
    work_root: "docs/research/demo/",
    journal: "kiwi/waves.jsonl",
    run_root: { git_toplevel: "C:/repo", mcp_workspace_root: "C:/repo" },
    isolation_profile: "none-serial",
    proof_strength: "strong",
    base_branch: "main",
    integration_branch: `kiwi/orch/${RUN_ID}/integration`,
    design_lock: "design/00.design.lock.json@sha256:4ab0",
    waves_lock: "waves/waves.lock.json@sha256:c17e",
    lane_lock: { "wave-1": "waves/wave-1/lanes.lock.json@sha256:5b3a" }
  } as ResumeCard["frozen"];
}

function card(): ResumeCard {
  const frozen = frozenBlock();
  return {
    schema_version: "1.0.0",
    run_id: RUN_ID,
    run_contract: "docs/research/demo/00.run-contract.md@sha256:9f1c",
    position: { wave: 1, stage: 1, phase: "execute" },
    next_action: {
      verb: "execute-unit",
      args: { wave: 1, stage: 1, lane: "lane-1" },
      preconditions: ["P-DESIGN-FROZEN", "P-LANE-PLAN-FROZEN", "P-HANDOFF-VERIFIED", "P-WAVE-ISSUES-CLOSED", "P-PRIOR-STAGES-INTEGRATED"]
    },
    frozen,
    done: [{ key: "intake", proof: { kind: "digest", ref: "design/00.design.lock.json@sha256:4ab0" } }],
    open: [],
    blocked_on: null,
    invariant_digest: computeInvariantDigest(frozen),
    written_at: "2026-08-02T09:12:44.201Z"
  } as ResumeCard;
}

/** The commit a landed phase-1 unit leaves: trailered, on the integration branch, no lane branch. */
const LANDED = [
  { sha: "aaaa111", trailers: { "Orch-Run": RUN_ID, "Orch-Wave": "1", "Orch-Stage": "1", "Orch-Lane": "lane-1", "Orch-Task": "T-PH001-01" } }
];

function factsBundle(integrationCommits: unknown[]): string {
  const recorded = {
    sidecarDigest: "sha256:sidecar",
    registryDigest: "sha256:registry",
    existingPathsDigest: "sha256:paths",
    designItemMapDigest: "sha256:map",
    priorPostmortemDigests: [],
    laneCap: 8,
    codeRoots: ["src/**"],
    testRoots: ["test/**"]
  };
  return JSON.stringify({
    gitFacts: { branches: [], worktrees: [], heartbeats: [], integrationHead: "aaaa111", hostStatusPaths: [], integrationCommits },
    driftInputs: {
      lockDigests: {
        design: "design/00.design.lock.json@sha256:4ab0",
        waves: "waves/waves.lock.json@sha256:c17e",
        lanes: "waves/wave-1/lanes.lock.json@sha256:5b3a",
        handoff: {},
        issues: "",
        postmortem: ""
      },
      recordedLaneInputs: recorded,
      recomputedLaneInputDigests: {
        sidecarDigest: recorded.sidecarDigest,
        registryDigest: recorded.registryDigest,
        existingPathsDigest: recorded.existingPathsDigest,
        designItemMapDigest: recorded.designItemMapDigest,
        priorPostmortemDigests: []
      },
      freshIntentDigests: {},
      handoffProseDigests: {}
    }
  });
}

async function resume(integrationCommits: unknown[]): Promise<{ exit: number; payload: Record<string, unknown> }> {
  const root = await mkdtemp(path.join(tmpdir(), "orchestrate-resume-witness-"));
  await write(root, "kiwi/waves.jsonl", JOURNAL.map((line) => JSON.stringify(line)).join("\n") + "\n");
  await write(root, resumeCardPath(RUN_ID), `${JSON.stringify(await pinResumeRunRoot(card(), root), null, 2)}\n`);
  await write(root, "facts.json", factsBundle(integrationCommits));
  const pipes = io();
  const exit = await main(["--root", root, "orchestrate", "resume", "--run-id", RUN_ID, "--facts", "facts.json", "--json"], pipes);
  return { exit, payload: drain(pipes.stdout) };
}

function nextVerb(result: Record<string, unknown>): unknown {
  return (result.payload as { resume?: { nextAction?: { verb?: unknown } } }).resume?.nextAction?.verb;
}

describe("FR-NODE-160 AC-2 — the merge witness travels through the CLI's --facts bundle", () => {
  it("without the commits, the resumed session is told to execute the unit and reports itself consistent", async () => {
    const result = await resume([]);
    expect(result.exit, "this baseline must succeed, or the contrast below is between two refusals").toBe(0);
    expect(nextVerb(result)).toBe("execute-unit");
    expect((result.payload as { resume?: { nextAction?: { reconciliation?: unknown } } }).resume?.nextAction?.reconciliation).toBe("consistent");
  });

  it("with the commits in the bundle, the run halts on a named gate instead of re-executing", async () => {
    const result = await resume(LANDED);
    // The witness reaches the classifier through `--facts`, `merged` becomes true, and with no
    // `integrate-lane` result the lane reads `journal-behind-git`. The run stops for reconciliation
    // rather than being told to redo work that has already committed — the refusal IS the fix.
    expect(result.exit, "a landed unit with no integration record must halt the resume").toBe(2);
    expect(result.payload.gate).toBe("ledger-reconciliation-divergent");
    expect(nextVerb(result), "a refused resume dispatches nothing").toBeUndefined();
  });
});
