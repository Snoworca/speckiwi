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
      ["dispatch-lane", "externally-visible"]
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
    const midExecution = await journalView([waveVerify(V14), intent("dispatch-lane", { stage: 1, lane: "lane-1" })]);
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
      await journalView([waveVerify(V14), result("dispatch-lane", { stage: 1, lane: "lane-1" })]),
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

  it("FR-NODE-150 AC-5 yields drift with lane-plan-drift when the SDS of a wave not yet closed out re-digests differently", async () => {
    const view = await journalView([waveVerify(V14)]);
    const base = emptyDriftInputs();

    const drifted = computeResumeState(view, minimalCard(), emptyGitFacts(), {
      ...base,
      recomputedLaneInputDigests: { sdsDigests: { ...base.recomputedLaneInputDigests.sdsDigests, "run-a-wave-2": "sha256:sds-2-edited" }, closedOutWaves: [] }
    });
    expect(drifted.drift.digests[2]?.outcome).toBe("drift");
    expect(drifted.drift.digests[2]?.gate).toBe("lane-plan-drift");
    expect(drifted.drift.digests[2]?.detail).toContain("run-a-wave-2");
    expect(drifted.blocking).toBe("lane-plan-drift");

    const unchanged = computeResumeState(view, minimalCard(), emptyGitFacts(), base);
    expect(unchanged.drift.digests[2]?.outcome).toBe("match");
    expect(unchanged.drift.digests[2]?.gate).toBeNull();
  });

  it("FR-NODE-150 AC-5 does not recompute a wave whose SDS its close-out commit deleted", async () => {
    const view = await journalView([waveVerify(V14)]);
    const base = emptyDriftInputs();
    const closed = computeResumeState(view, minimalCard(), emptyGitFacts(), {
      ...base,
      recomputedLaneInputDigests: { sdsDigests: { "run-a-wave-2": "sha256:sds-2" }, closedOutWaves: ["run-a-wave-1"] }
    });
    expect(closed.drift.digests[2]?.outcome).toBe("match");
    expect(closed.drift.digests[2]?.gate).toBeNull();
    expect(closed.blocking).toBeNull();
  });

  it("FR-NODE-213 AC-2 treats an SDS that vanished without a close-out as drift rather than skipping it", async () => {
    const view = await journalView([waveVerify(V14)]);
    const base = emptyDriftInputs();
    const vanished = computeResumeState(view, minimalCard(), emptyGitFacts(), {
      ...base,
      recomputedLaneInputDigests: { sdsDigests: { "run-a-wave-2": "sha256:sds-2" }, closedOutWaves: [] }
    });
    expect(vanished.drift.digests[2]?.outcome).toBe("drift");
    expect(vanished.drift.digests[2]?.gate).toBe("lane-plan-drift");
    expect(vanished.drift.digests[2]?.detail).toContain("run-a-wave-1");
  });

  it("FR-NODE-213 AC-2 checks every file of a grouped wave's SDS digests for drift", async () => {
    const view = await journalView([waveVerify(V14)]);
    const base = emptyDriftInputs();
    const group = { "docs/sds/big-1.sds.md": "sha256:p1", "docs/sds/big-2.sds.md": "sha256:p2" };
    const recorded = { ...base.recordedLaneInputs, sdsDigests: { ...base.recordedLaneInputs.sdsDigests, big: group } };
    const withNow = (now: Record<string, unknown>) =>
      computeResumeState(view, minimalCard(), emptyGitFacts(), {
        ...base,
        recordedLaneInputs: recorded,
        recomputedLaneInputDigests: { sdsDigests: { ...base.recomputedLaneInputDigests.sdsDigests, ...now } as never, closedOutWaves: [] }
      });

    const unchanged = withNow({ big: { ...group } });
    expect(unchanged.drift.digests[2]?.outcome, unchanged.drift.digests[2]?.detail).toBe("match");

    const edited = withNow({ big: { ...group, "docs/sds/big-2.sds.md": "sha256:p2-edited" } });
    expect(edited.drift.digests[2]?.gate).toBe("lane-plan-drift");
    expect(edited.drift.digests[2]?.detail).toContain("docs/sds/big-2.sds.md");
    expect(edited.drift.digests[2]?.detail).not.toContain("docs/sds/big-1.sds.md");

    const lost = withNow({ big: { "docs/sds/big-1.sds.md": "sha256:p1" } });
    expect(lost.drift.digests[2]?.gate).toBe("lane-plan-drift");
    expect(lost.drift.digests[2]?.detail).toContain("docs/sds/big-2.sds.md");
    expect(withNow({}).drift.digests[2]?.gate, "a grouped wave with nothing recomputed has drifted").toBe("lane-plan-drift");
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
      result("dispatch-lane", {
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
  // (`quarantined` | `refuted`), not `lane_disposition` merely being
  // present. Classifying on presence alone lets a mistyped kind read as terminal, and a resumed
  // session then treats a lane as settled on the strength of a value nothing recognised — settling
  // work is the direction that loses it. `lane-state.ts`'s `readLaneDisposition` owns the validated
  // read and refuses with `lane-disposition-kind-invalid`.
  it("does not settle a lane whose disposition kind is outside the closed enum", async () => {
    const view = await journalView([
      waveVerify(V14),
      result("dispatch-lane", {
        stage: 1,
        lane: "lane-1",
        lane_disposition: { kind: "abandoned", reason: "not a member of the closed enum" }
      })
    ]);

    const state = computeResumeState(view, minimalCard(), emptyGitFacts(), emptyDriftInputs());
    const lane = state.classification.find((entry) => entry.lane === "lane-1");

    expect(lane?.klass).not.toBe("lane-quarantined");
    // FR-NODE-213 AC-6 — nor is it dispatched again: the journal says the lane left the run, in a word
    // nothing recognises, so the resume halts on the disagreement instead of guessing either way.
    expect(lane?.klass).toBe("divergent");
    expect(lane?.nextVerb).toBeNull();
    expect(state.nextAction.verb).not.toBe("dispatch-lane");
    expect(state.blocking).toBe("ledger-reconciliation-divergent");
  });
});
