import { describe, expect, it } from "vitest";
import { CARD_PRECONDITIONS, PROOF_KINDS, RESUME_CARD_MAX_BYTES } from "../../../src/core/orchestrator/journal-schema.js";
import { computeInvariantDigest, readCard, validateCard, writeCard, type ResumeCard } from "../../../src/core/orchestrator/resume-card.js";
import { parseWavesJournal } from "../../../src/core/orchestrator/waves-journal.js";
import { frozenBlock, minimalCard } from "./resume-fixtures.js";
import { journalRoot, result, type Json } from "./waves-fixtures.js";

// FR-NODE-151 — the resume card is validated on write against its cap, enums, proofs, digest and
// rollup rule, with the journal view supplied as a parameter.

async function journalView(lines: Json[] = []) {
  const root = await journalRoot(lines.length > 0 ? lines : [result("create-integration-branch", {})]);
  return parseWavesJournal(root, { runId: "run-a", engine: "kiwi-orchestrator" });
}

function codes(card: ResumeCard, journal: Awaited<ReturnType<typeof journalView>>): string[] {
  return validateCard(card, journal).violations;
}

describe("FR-NODE-151 resume card validation", () => {
  it("accepts the minimal legal card", async () => {
    const journal = await journalView();
    expect(validateCard(minimalCard(), journal)).toEqual({ ok: true, violations: [] });
  });

  it("AC-1 refuses a card whose serialised size exceeds 8 KB and does not write it", async () => {
    expect(RESUME_CARD_MAX_BYTES).toBe(8192);
    const journal = await journalView();
    const oversized = minimalCard({ run_contract: "x".repeat(9000) });

    expect(codes(oversized, journal)).toContain("resume-card-too-large");

    const written = writeCard(oversized, journal);
    expect(written.ok).toBe(false);
    expect("text" in written).toBe(false);
  });

  it("AC-2 refuses an out-of-enum verb and an out-of-enum precondition", async () => {
    const journal = await journalView();
    expect([...CARD_PRECONDITIONS]).toEqual([
      "P-DESIGN-FROZEN",
      "P-LANE-PLAN-FROZEN",
      "P-HANDOFF-VERIFIED",
      "P-WAVE-ISSUES-CLOSED",
      "P-PRIOR-STAGES-INTEGRATED"
    ]);

    const badVerb = minimalCard({
      next_action: { verb: "do-the-thing" as ResumeCard["next_action"]["verb"], args: {}, preconditions: [] }
    });
    expect(codes(badVerb, journal)).toContain("unknown-verb");

    const badPrecondition = minimalCard({
      next_action: { verb: "execute-unit", args: {}, preconditions: ["P-EVERYTHING-FINE"] as never }
    });
    expect(codes(badPrecondition, journal)).toContain("unknown-precondition");
  });

  it("AC-3 refuses a completed-work entry whose proof kind is outside the seven kinds", async () => {
    const journal = await journalView();
    expect([...PROOF_KINDS]).toEqual([
      "git-ancestor",
      "git-ref",
      "git-trailer",
      "digest",
      "mcp-state",
      "fs-exists",
      "journal"
    ]);

    const card = minimalCard({ done: [{ key: "intake", proof: { kind: "vibes" as never, ref: "trust me" } }] });
    expect(codes(card, journal)).toContain("unknown-proof-kind");
  });

  it("AC-4 requires a non-journal witness on a journal-proof entry", async () => {
    const journal = await journalView();
    const journalProof = { kind: "journal" as const, ref: "waves.jsonl#L18 status=complete verdict=pass" };

    const noWitness = minimalCard({ done: [{ key: "wave-1", proof: journalProof }] });
    expect(codes(noWitness, journal)).toContain("journal-proof-without-witness");

    const journalWitness = minimalCard({
      done: [{ key: "wave-1", proof: journalProof, witness: { kind: "journal", ref: "waves.jsonl#L19" } }]
    });
    expect(codes(journalWitness, journal)).toContain("journal-proof-without-witness");

    const accepted = minimalCard({
      done: [{ key: "wave-1", proof: journalProof, witness: { kind: "git-trailer", ref: "b71c904 Orch-Run=run-a Orch-Wave=1" } }]
    });
    expect(codes(accepted, journal)).toEqual([]);
  });

  it("AC-5 refuses a mismatched invariant digest and covers all six frozen fields", async () => {
    const journal = await journalView();
    const card = minimalCard({ invariant_digest: "sha256:not-the-digest" });
    expect(codes(card, journal)).toContain("invariant-digest-mismatch");

    const baseline = computeInvariantDigest(frozenBlock());
    const changes: Array<[string, Json]> = [
      ["isolation profile", { isolation_profile: "worktree" }],
      ["integration branch", { integration_branch: "kiwi/orch/run-b/integration" }],
      ["base branch", { base_branch: "main" }],
      ["engine", { engine: "kiwi-wave-master" }],
      ["work root", { work_root: "docs/research/other/" }],
      ["run root", { run_root: { git_toplevel: "D:/elsewhere", mcp_workspace_root: "D:/elsewhere" } }]
    ];
    for (const [label, override] of changes) {
      expect(computeInvariantDigest(frozenBlock(override)), label).not.toBe(baseline);
    }
  });

  it("AC-6 refuses a frozen isolation profile that differs from the journal's probe result", async () => {
    const journal = await journalView([
      result("probe-isolation", { isolation: { profile: "worktree", reason: "clean tree", rejected: [] } })
    ]);

    const drifted = minimalCard();
    expect(codes(drifted, journal)).toContain("isolation-profile-changed");

    const aligned = minimalCard({ frozen: frozenBlock({ isolation_profile: "worktree" }) });
    expect(codes(aligned, journal)).toEqual([]);

    // The journal view is a parameter: a validator that is not given the journal cannot check this.
    expect(validateCard.length).toBe(2);
  });

  it("AC-7 validates the design's maximum card inside the cap", async () => {
    const journal = await journalView();
    const done: ResumeCard["done"] = [
      ...Array.from({ length: 8 }, (_unused, index) => ({
        key: `wave-${index + 1}`,
        proof: { kind: "journal" as const, ref: `waves.jsonl#L${index + 10} status=complete verdict=pass` },
        witness: { kind: "git-trailer" as const, ref: `b71c90${index} Orch-Run=run-a Orch-Wave=${index + 1}` }
      })),
      ...Array.from({ length: 6 }, (_unused, index) => ({
        key: `milestone-${index + 1}`,
        proof: { kind: "digest" as const, ref: `lock-${index + 1}.json@sha256:4ab${index}` }
      })),
      ...Array.from({ length: 8 }, (_unused, index) => ({
        key: `wave-9/s1/lane-${index + 1}`,
        proof: { kind: "git-trailer" as const, ref: `51ba7d${index} Orch-Wave=9 Orch-Stage=1 Orch-Lane=lane-${index + 1}` }
      }))
    ];
    const open: ResumeCard["open"] = Array.from({ length: 8 }, (_unused, index) => ({
      key: `wave-9/s1/lane-${index + 1}`,
      state: "executing",
      base_sha: "e4f5a6b1c2d3e4f5a6b7",
      head_sha: "7bd41f0a1b2c3d4e5f60",
      journal_line: 44 + index
    }));

    // Eight completed waves, six run-level milestones, and the current wave's eight lane entries:
    // the design's maximum, with `frozen.lane_lock` holding only the current wave.
    const card = minimalCard({
      position: { wave: 9, stage: 1, phase: "execute" },
      frozen: frozenBlock({ lane_lock: { "wave-9": "waves/wave-9/lanes.lock.json@sha256:5b3a" } }),
      done,
      open
    });

    expect(codes(card, journal)).toEqual([]);
    expect(Buffer.byteLength(JSON.stringify(card), "utf8")).toBeLessThan(RESUME_CARD_MAX_BYTES);
    expect(done).toHaveLength(22);
  });

  it("AC-7 refuses a retained lane lock and un-rolled-up lane entries", async () => {
    const journal = await journalView();

    const retainedLock = minimalCard({
      frozen: frozenBlock({ lane_lock: { "wave-1": "waves/wave-1/lanes.lock.json@sha256:5b3a", "wave-0": "waves/wave-0/lanes.lock.json@sha256:0000" } })
    });
    expect(codes(retainedLock, journal)).toContain("lane-lock-not-rolled-up");

    const staleLaneEntries = minimalCard({
      done: [
        { key: "wave-1", proof: { kind: "git-trailer", ref: "b71c904 Orch-Run=run-a Orch-Wave=1" } },
        { key: "wave-1/s1/lane-1", proof: { kind: "git-trailer", ref: "51ba7de Orch-Wave=1 Orch-Stage=1 Orch-Lane=lane-1" } }
      ]
    });
    // The wave's own entry is present, so its lane-level entries should have been collapsed into it.
    expect(codes(staleLaneEntries, journal)).toContain("lane-entry-not-rolled-up");
  });

  it("readCard returns a violation rather than throwing on malformed JSON", () => {
    const outcome = readCard("{not json");
    expect(outcome.ok).toBe(false);
    expect(outcome.ok ? [] : outcome.violations).toContain("malformed-card");
  });

  it("writeCard round-trips a valid card and names the run-scoped path", async () => {
    const journal = await journalView();
    const card = minimalCard();

    const written = writeCard(card, journal);
    expect(written.ok).toBe(true);
    if (!written.ok) return;
    expect(written.relativePath).toBe("kiwi/orchestrator/run-a/resume-card.json");

    const read = readCard(written.text);
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.card).toEqual(card);
  });
});
