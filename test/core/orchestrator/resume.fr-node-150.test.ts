import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { DRIFT_OUTCOMES, RECOVERY_CLASSES, RECONCILIATION_OUTCOMES } from "../../../src/core/orchestrator/journal-schema.js";
import { parseWavesJournal } from "../../../src/core/orchestrator/waves-journal.js";
import { computeResumeState } from "../../../src/core/orchestrator/resume.js";
import { emptyDriftInputs, emptyGitFacts, minimalCard } from "./resume-fixtures.js";
import { intent, journalRoot, result, waveVerify, type Json } from "./waves-fixtures.js";

// FR-NODE-150 — computeResumeState derives the next verb, its recovery class, the reconciliation
// outcome and the four drift digests from injected facts alone.

const RESUME_SOURCE = path.join(process.cwd(), "src", "core", "orchestrator", "resume.ts");
const V14 = { schema_version: "1.4.0", engine: "kiwi-orchestrator", writer: "speckiwi-orchestrate/2.4.1" } as const;

async function journalView(lines: Json[]) {
  const root = await journalRoot(lines);
  return parseWavesJournal(root, { runId: "run-a", engine: "kiwi-orchestrator" });
}

describe("FR-NODE-150 computeResumeState", () => {
  it("AC-1 takes exactly four parameters and shells out to nothing", async () => {
    expect(computeResumeState.length).toBe(4);

    const source = await readFile(RESUME_SOURCE, "utf8");
    for (const forbidden of ["child_process", "node:fs", "execSync", "spawnSync", "simple-git", "process.cwd"]) {
      expect(source, `resume.ts must not reach for ${forbidden}`).not.toContain(forbidden);
    }
  });

  it("AC-2 classifies an unmatched intent as interrupted with the verb's recovery class", async () => {
    expect([...RECOVERY_CLASSES]).toEqual(["pure-reauthor", "idempotent-by-key", "externally-visible"]);

    const cases: Array<[string, string]> = [
      ["decompose-waves", "pure-reauthor"],
      ["freeze-lane-plan", "idempotent-by-key"],
      ["execute-unit", "externally-visible"]
    ];
    const produced = new Set<string>();

    for (const [verb, recoveryClass] of cases) {
      const view = await journalView([waveVerify(V14), intent(verb, { stage: 1, lane: "lane-1" })]);
      const state = computeResumeState(view, minimalCard(), emptyGitFacts(), emptyDriftInputs());

      expect(state.nextAction.interrupted, verb).toBe(true);
      expect(state.nextAction.verb, verb).toBe(verb);
      expect(state.nextAction.recoveryClass, verb).toBe(recoveryClass);
      produced.add(recoveryClass);
    }

    // Each of the three recovery-class values is produced by at least one fixture.
    expect([...produced].sort()).toEqual([...RECOVERY_CLASSES].sort());
  });

  it("AC-2 does not report a verb as interrupted once its result line lands", async () => {
    const view = await journalView([
      waveVerify(V14),
      intent("freeze-lane-plan", { stage: 1 }),
      result("freeze-lane-plan", { stage: 1 })
    ]);

    expect(computeResumeState(view, minimalCard(), emptyGitFacts(), emptyDriftInputs()).nextAction.interrupted).toBe(false);
  });

  it("AC-3 produces each of the four reconciliation outcomes over injected git facts", async () => {
    expect([...RECONCILIATION_OUTCOMES]).toEqual([
      "consistent",
      "card-stale",
      "interrupted-external-action",
      "ledger-reconciliation-divergent"
    ]);
    const produced = new Set<string>();

    // consistent — the ordinary mid-execution state: a unit started, no result line yet.
    const midExecution = await journalView([waveVerify(V14), intent("execute-unit", { stage: 1, lane: "lane-1" })]);
    const consistent = computeResumeState(
      midExecution,
      minimalCard({ open: [{ key: "wave-1/s1/lane-1", state: "executing", base_sha: "e4f5a6b", head_sha: "7bd41f0", journal_line: 2 }] }),
      emptyGitFacts(),
      emptyDriftInputs()
    );
    expect(consistent.nextAction.reconciliation).toBe("consistent");
    expect(consistent.blocking).toBeNull();
    produced.add(consistent.nextAction.reconciliation);

    // interrupted-external-action — the same journal with a locked workspace on the lane's ref.
    const live = computeResumeState(
      midExecution,
      minimalCard({ open: [{ key: "wave-1/s1/lane-1", state: "executing", base_sha: "e4f5a6b", head_sha: "7bd41f0", journal_line: 2 }] }),
      emptyGitFacts({ worktrees: [{ path: "/w/lane-1", branch: "kiwi/orch/run-a/w1s1/lane-1", locked: true }] }),
      emptyDriftInputs()
    );
    expect(live.nextAction.reconciliation).toBe("interrupted-external-action");
    expect(live.blocking).toBe("interrupted-external-action");
    produced.add(live.nextAction.reconciliation);

    // ledger-reconciliation-divergent — git is ahead of the journal: the lane has landed on the
    // integration branch and no integrate-lane result records it.
    const behind = computeResumeState(
      await journalView([waveVerify(V14), result("execute-unit", { stage: 1, lane: "lane-1" })]),
      minimalCard(),
      emptyGitFacts({ branches: [{ name: "kiwi/orch/run-a/w1s1/lane-1", sha: "7bd41f0", ancestorOfIntegration: true }] }),
      emptyDriftInputs()
    );
    expect(behind.nextAction.reconciliation).toBe("ledger-reconciliation-divergent");
    expect(behind.blocking).toBe("ledger-reconciliation-divergent");
    produced.add(behind.nextAction.reconciliation);

    // card-stale — the card names a lane the classification does not.
    const stale = computeResumeState(
      midExecution,
      minimalCard({ open: [{ key: "wave-1/s1/lane-9", state: "executing", base_sha: "e4f5a6b", head_sha: "7bd41f0", journal_line: 2 }] }),
      emptyGitFacts(),
      emptyDriftInputs()
    );
    expect(stale.nextAction.reconciliation).toBe("card-stale");
    // A derived card self-heals: a stale card is regenerated rather than blocking the run.
    expect(stale.blocking).toBeNull();
    produced.add(stale.nextAction.reconciliation);

    expect([...produced].sort()).toEqual([...RECONCILIATION_OUTCOMES].sort());
  });

  it("AC-4 returns exactly four drift entries indexed 1 to 4", async () => {
    const view = await journalView([waveVerify(V14)]);
    const state = computeResumeState(view, minimalCard(), emptyGitFacts(), emptyDriftInputs());

    expect(state.drift.digests).toHaveLength(4);
    expect(state.drift.digests.map((entry) => entry.index)).toEqual([1, 2, 3, 4]);
    expect([...DRIFT_OUTCOMES]).toEqual(["match", "stale-not-wrong", "drift"]);
    for (const entry of state.drift.digests) {
      expect(DRIFT_OUTCOMES).toContain(entry.outcome);
      expect([null, "run-invariant-drift", "lane-plan-drift"]).toContain(entry.gate);
      expect(typeof entry.detail).toBe("string");
    }
    expect(state.drift.digests.every((entry) => entry.outcome === "match")).toBe(true);
  });

  it("AC-5 separates digest 3's stale-not-wrong operands from its drift operands", async () => {
    const view = await journalView([waveVerify(V14)]);
    const base = emptyDriftInputs();

    for (const staleOperand of ["existingPathsDigest", "priorPostmortemDigests"] as const) {
      const recomputed = { ...base.recomputedLaneInputDigests };
      if (staleOperand === "priorPostmortemDigests") recomputed.priorPostmortemDigests = ["sha256:pm1", "sha256:pm2"];
      else recomputed.existingPathsDigest = "sha256:paths-moved";

      const state = computeResumeState(view, minimalCard(), emptyGitFacts(), {
        ...base,
        recomputedLaneInputDigests: recomputed
      });
      const digest3 = state.drift.digests[2];

      expect(digest3?.outcome, staleOperand).toBe("stale-not-wrong");
      expect(digest3?.gate, staleOperand).toBeNull();
      expect(state.blocking, staleOperand).toBeNull();
    }

    const drifted = computeResumeState(view, minimalCard(), emptyGitFacts(), {
      ...base,
      recomputedLaneInputDigests: { ...base.recomputedLaneInputDigests, sidecarDigest: "sha256:sidecar-changed" }
    });
    expect(drifted.drift.digests[2]?.outcome).toBe("drift");
    expect(drifted.drift.digests[2]?.gate).toBe("lane-plan-drift");
    expect(drifted.blocking).toBe("lane-plan-drift");
  });

  it("AC-6 returns exactly the four declared fields", async () => {
    const view = await journalView([waveVerify(V14)]);
    const state = computeResumeState(view, minimalCard(), emptyGitFacts(), emptyDriftInputs());

    expect(Object.keys(state).sort()).toEqual(["blocking", "classification", "drift", "nextAction"]);
  });

  it("raises run-invariant-drift when the card's invariant digest no longer recomputes", async () => {
    const view = await journalView([waveVerify(V14)]);
    const state = computeResumeState(
      view,
      minimalCard({ invariant_digest: "sha256:stale" }),
      emptyGitFacts(),
      emptyDriftInputs()
    );

    expect(state.drift.digests[0]?.outcome).toBe("drift");
    expect(state.drift.digests[0]?.gate).toBe("run-invariant-drift");
    expect(state.blocking).toBe("run-invariant-drift");
  });

  it("reports digest 2 drift when an intent's recorded inputs digest no longer matches", async () => {
    const view = await journalView([waveVerify(V14), intent("freeze-lane-plan", { stage: 1 })]);
    const state = computeResumeState(view, minimalCard(), emptyGitFacts(), {
      ...emptyDriftInputs(),
      freshIntentDigests: { "freeze-lane-plan|wave-1|1|": "sha256:moved" }
    });

    expect(state.drift.digests[1]?.outcome).toBe("drift");
    // §4.7 digest 2 re-runs the verb rather than gating the run.
    expect(state.drift.digests[1]?.gate).toBeNull();
  });

  it("reports digest 4 drift when a handoff's prose digest no longer matches its lock", async () => {
    const view = await journalView([waveVerify(V14)]);
    const state = computeResumeState(view, minimalCard(), emptyGitFacts(), {
      ...emptyDriftInputs(),
      lockDigests: { ...emptyDriftInputs().lockDigests, handoff: { "lane-1": "sha256:handoff" } },
      handoffProseDigests: { "lane-1": "sha256:handoff-edited" }
    });

    expect(state.drift.digests[3]?.outcome).toBe("drift");
    expect(state.drift.digests[3]?.gate).toBeNull();
  });

  it("treats a lane carrying a terminal disposition as settled rather than integrable", async () => {
    const view = await journalView([
      waveVerify(V14),
      result("execute-unit", {
        stage: 1,
        lane: "lane-1",
        lane_disposition: { kind: "refuted", reason: "design item false", at: "2026-08-02T00:00:00Z" }
      })
    ]);

    const state = computeResumeState(view, minimalCard(), emptyGitFacts(), emptyDriftInputs());
    const lane = state.classification.find((entry) => entry.lane === "lane-1");

    expect(lane?.klass).toBe("lane-quarantined");
    expect(lane?.nextVerb).toBeNull();
  });

  // @req FR-NODE-107 — `lane-quarantined` is `D(k)` present with a kind from the CLOSED enum
  // (`demoted` | `quarantined` | `coupling-reset` | `refuted`), not `lane_disposition` merely being
  // present. Classifying on presence alone lets a mistyped kind read as terminal, and a resumed
  // session then treats a lane as settled on the strength of a value nothing recognised — settling
  // work is the direction that loses it. `lane-state.ts`'s `readLaneDisposition` owns the validated
  // read and refuses with `lane-disposition-kind-invalid`.
  it("does not settle a lane whose disposition kind is outside the closed enum", async () => {
    const view = await journalView([
      waveVerify(V14),
      result("execute-unit", {
        stage: 1,
        lane: "lane-1",
        lane_disposition: { kind: "abandoned", reason: "not a member of the closed enum" }
      })
    ]);

    const state = computeResumeState(view, minimalCard(), emptyGitFacts(), emptyDriftInputs());
    const lane = state.classification.find((entry) => entry.lane === "lane-1");

    expect(lane?.klass).not.toBe("lane-quarantined");
    expect(lane?.klass).toBe("not-dispatched");
    expect(lane?.nextVerb).toBe("execute-unit");
  });
});
