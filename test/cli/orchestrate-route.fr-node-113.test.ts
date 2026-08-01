import { mkdir, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { main } from "../../src/cli/index.js";
import { computeInvariantDigest, resumeCardPath, type ResumeCard } from "../../src/core/orchestrator/resume-card.js";
import { computeRoute } from "../../src/core/orchestrator/route.js";
import { parseRouteProbe } from "../../src/core/orchestrator/route-probe.js";
import { probeDocument } from "../support/route-probe-document.js";

// @req FR-NODE-113 AC-1, AC-4, AC-5, AC-6 — the freeze and the resume, as SESSION behaviour.
//
// `resumeRung` and `checkRouteDrift` being correct proves nothing about a run: the claim 09 §9.5
// makes is that the verb a resumed session actually invokes reads `frozen.route.rung` and refuses on a
// probe digest that moved. That is what these exercise, through `main` and the real files on disk.

const RUN_ID = "run-a";
const LOCK_OUT = "routing/route.lock.json";
const PROBE_DIGEST = "sha256:6a1f2c8bd6a1f2c8bd6a1f2c8bd6a1f2c8bd6a1f2c8bd6a1f2c8bd6a1f2c8bd6";

function io() {
  return { stdout: new PassThrough() as NodeJS.WriteStream, stderr: new PassThrough() as NodeJS.WriteStream };
}

function drain(stream: NodeJS.WriteStream): Record<string, unknown> {
  const text = (stream as unknown as PassThrough).read()?.toString() ?? "";
  return JSON.parse(text) as Record<string, unknown>;
}

async function write(root: string, relativePath: string, text: string): Promise<void> {
  const absolute = path.join(root, relativePath);
  await mkdir(path.dirname(absolute), { recursive: true });
  await writeFile(absolute, text, "utf8");
}

/** `contract_ok: false` removes `R-PLAN` by D5, so the frozen rung is `R-STEP`. */
function stepProbeDocument(): unknown {
  return probeDocument({
    S2: {
      path: "docs/plans/p.plan.md",
      candidates: ["docs/plans/p.plan.md"],
      contract_ok: false,
      reject_reason: "plan_contract must be 1.2.0",
      open_tasks: 3,
      req_ids: ["FR-NODE-001"],
      lifecycle_req_ids: ["FR-NODE-001"],
      target: "v2.6.0"
    }
  });
}

function gateRecord(): unknown {
  return {
    schema_version: "1.0.0",
    run_id: RUN_ID,
    probe_path: "routing/probe.json",
    probe_digest: PROBE_DIGEST,
    decided_at: "2026-08-01T09:12:44.201Z",
    gates: [
      {
        gate_id: "route-proposal",
        severity: "business-decision",
        selected: "proposed",
        decided_by: null,
        resolution: { rule: "recommended-fastpath", committee_size: 0 }
      }
    ]
  };
}

function baseCard(): ResumeCard {
  const frozen = {
    engine: "kiwi-orchestrator" as const,
    work_root: "docs/research/v260-orchestrator",
    journal: "kiwi/waves.jsonl",
    run_root: { git_toplevel: "/repo", mcp_workspace_root: "/repo" },
    isolation_profile: "none-serial",
    base_branch: "main",
    integration_branch: "kiwi/orch/run-a/integration",
    lane_lock: {}
  };
  return {
    schema_version: "1.0.0",
    run_id: RUN_ID,
    run_contract: "docs/research/v260-orchestrator/00.run-contract.md@sha256:9f1c",
    position: { wave: 0, stage: 0, phase: "1.c-prime" },
    next_action: { verb: "freeze-route", args: {}, preconditions: [] },
    frozen,
    done: [],
    open: [],
    blocked_on: null,
    invariant_digest: computeInvariantDigest(frozen),
    written_at: "2026-08-01T09:00:00.000Z"
  };
}

/** A root carrying a probe, a gate record, an empty journal and a card with no frozen route yet. */
async function seedRoot(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "speckiwi-orchestrate-route-"));
  await write(root, "routing/probe.json", `${JSON.stringify(stepProbeDocument(), null, 2)}\n`);
  await write(root, "routing/route-gate.json", `${JSON.stringify(gateRecord(), null, 2)}\n`);
  await write(root, "kiwi/waves.jsonl", "");
  await write(root, resumeCardPath(RUN_ID), `${JSON.stringify(baseCard(), null, 2)}\n`);
  return root;
}

async function run(root: string, argv: string[]): Promise<{ exit: number; payload: Record<string, unknown> }> {
  const pipes = io();
  const exit = await main(["--root", root, "orchestrate", ...argv, "--json"], pipes);
  return { exit, payload: drain(pipes.stdout) };
}

async function readCardFile(root: string): Promise<ResumeCard> {
  return JSON.parse(await readFile(path.join(root, resumeCardPath(RUN_ID)), "utf8")) as ResumeCard;
}

/** `--facts` for a resume, with the route observations the run would read off disk. */
function facts(routeObserved: { probeDigest: string; lockDigest: string } | null): string {
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
    gitFacts: { branches: [], worktrees: [], heartbeats: [], integrationHead: "9a01f3c", hostStatusPaths: [] },
    driftInputs: {
      lockDigests: { design: undefined, waves: undefined, lanes: "", handoff: {}, issues: "", postmortem: "" },
      recordedLaneInputs: recorded,
      recomputedLaneInputDigests: {
        sidecarDigest: recorded.sidecarDigest,
        registryDigest: recorded.registryDigest,
        existingPathsDigest: recorded.existingPathsDigest,
        designItemMapDigest: recorded.designItemMapDigest,
        priorPostmortemDigests: []
      },
      freshIntentDigests: {},
      handoffProseDigests: {},
      ...(routeObserved ? { routeObserved } : {})
    }
  });
}

async function resume(root: string, routeObserved: { probeDigest: string; lockDigest: string } | null) {
  await write(root, "facts.json", facts(routeObserved));
  return run(root, ["resume", "--run-id", RUN_ID, "--facts", "facts.json"]);
}

describe("FR-NODE-113 AC-4 — orchestrate route freeze records the lock in the card", () => {
  it("writes frozen.route with the rung, the content address and the probe digest", async () => {
    const root = await seedRoot();

    const frozen = await run(root, ["route", "freeze"]);

    expect(frozen.exit).toBe(0);
    expect(frozen.payload.ok).toBe(true);
    const card = await readCardFile(root);
    expect(card.frozen.route).toEqual({
      rung: "R-STEP",
      lock: `${LOCK_OUT}@${frozen.payload.digest as string}`,
      probe_digest: PROBE_DIGEST
    });
    expect(frozen.payload.card).toBe(resumeCardPath(RUN_ID));
  });

  it("recomputes invariant_digest so the card the freeze leaves behind still validates", async () => {
    const root = await seedRoot();
    const before = await readCardFile(root);

    await run(root, ["route", "freeze"]);

    const after = await readCardFile(root);
    expect(after.invariant_digest).not.toBe(before.invariant_digest);
    expect(after.invariant_digest).toBe(computeInvariantDigest(after.frozen));
    // The card the freeze wrote is one `card write` would accept, which is AC-7's round trip taken
    // through the two verbs rather than through the validator alone.
    const rewritten = await run(root, ["card", "write", "--run-id", RUN_ID, "--payload", JSON.stringify(after)]);
    expect(rewritten.exit).toBe(0);
  });

  it("leaves no route in the card and reports none when --dry-run is passed", async () => {
    const root = await seedRoot();

    const frozen = await run(root, ["route", "freeze", "--dry-run"]);

    expect(frozen.exit).toBe(0);
    expect(frozen.payload.applied).toBe(false);
    expect((await readCardFile(root)).frozen.route).toBeUndefined();
  });
});

describe("FR-NODE-113 AC-1 — a redo whose digest matches is a no-op", () => {
  it("reports noop and rewrites neither the lock nor the card", async () => {
    const root = await seedRoot();
    const first = await run(root, ["route", "freeze"]);
    const lockBefore = await stat(path.join(root, LOCK_OUT));
    const cardBefore = await readFile(path.join(root, resumeCardPath(RUN_ID)), "utf8");
    const cardStatBefore = await stat(path.join(root, resumeCardPath(RUN_ID)));

    const second = await run(root, ["route", "freeze"]);

    expect(first.payload.noop).toBe(false);
    expect(second.payload.noop).toBe(true);
    expect(second.payload.digest).toBe(first.payload.digest);
    expect(await readFile(path.join(root, resumeCardPath(RUN_ID)), "utf8")).toBe(cardBefore);
    expect((await stat(path.join(root, LOCK_OUT))).mtimeMs).toBe(lockBefore.mtimeMs);
    expect((await stat(path.join(root, resumeCardPath(RUN_ID)))).mtimeMs).toBe(cardStatBefore.mtimeMs);
  });

  it("still records the route when the lock already exists but the card does not name it", async () => {
    const root = await seedRoot();
    await run(root, ["route", "freeze"]);
    // The card is rolled back to its pre-freeze state; the lock on disk is untouched and matches.
    await write(root, resumeCardPath(RUN_ID), `${JSON.stringify(baseCard(), null, 2)}\n`);

    const redo = await run(root, ["route", "freeze"]);

    expect(redo.payload.noop).toBe(true);
    expect((await readCardFile(root)).frozen.route).toMatchObject({ rung: "R-STEP", probe_digest: PROBE_DIGEST });
  });
});

describe("FR-NODE-113 AC-5 — a resumed session reads the rung from the card", () => {
  it("reports the frozen rung even when the probe on disk would now classify a different one", async () => {
    const root = await seedRoot();
    const frozen = await run(root, ["route", "freeze"]);
    // The probe is replaced with the baseline, on which no disqualifier fires: a recomputation here
    // would return `R-PLAN` and switch this run's ladder mid-flight.
    await write(root, "routing/probe.json", `${JSON.stringify(probeDocument(), null, 2)}\n`);

    const resumed = await resume(root, { probeDigest: PROBE_DIGEST, lockDigest: frozen.payload.digest as string });

    expect(resumed.exit).toBe(0);
    expect(resumed.payload.rung).toBe("R-STEP");
    // The replacement really would classify the other rung, so the assertion above is not vacuous.
    expect(computeRoute(parseRouteProbe(probeDocument()), { auto: false }).rung).toBe("R-PLAN");
  });

  it("reports no rung for a run whose card froze no route", async () => {
    const root = await seedRoot();

    const resumed = await resume(root, null);

    expect(resumed.exit).toBe(0);
    expect(resumed.payload.rung).toBeNull();
  });
});

describe("FR-NODE-113 AC-6 — a probe digest that moved refuses the resume", () => {
  it("exits on run-invariant-drift naming the recorded and observed digests", async () => {
    const root = await seedRoot();
    const frozen = await run(root, ["route", "freeze"]);
    const observed = `${PROBE_DIGEST.slice(0, -1)}0`;

    const resumed = await resume(root, { probeDigest: observed, lockDigest: frozen.payload.digest as string });

    expect(resumed.exit).toBe(2);
    expect(resumed.payload.gate).toBe("run-invariant-drift");
    expect(JSON.stringify(resumed.payload.violations)).toContain(PROBE_DIGEST);
    expect(JSON.stringify(resumed.payload.violations)).toContain(observed);
    // The refusal carries no rung: a gated resume dispatches nothing.
    expect(resumed.payload.rung).toBeUndefined();
  });

  it("refuses the same way when route.lock.json moved under the run", async () => {
    const root = await seedRoot();
    await run(root, ["route", "freeze"]);

    const resumed = await resume(root, { probeDigest: PROBE_DIGEST, lockDigest: "sha256:0000" });

    expect(resumed.exit).toBe(2);
    expect(resumed.payload.gate).toBe("run-invariant-drift");
  });

  it("resumes normally when both digests still match", async () => {
    const root = await seedRoot();
    const frozen = await run(root, ["route", "freeze"]);

    const resumed = await resume(root, { probeDigest: PROBE_DIGEST, lockDigest: frozen.payload.digest as string });

    expect(resumed.exit).toBe(0);
    expect(resumed.payload.ok).toBe(true);
  });
});
