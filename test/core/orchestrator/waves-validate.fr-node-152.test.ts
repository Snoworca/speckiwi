import { describe, expect, it } from "vitest";
import { EXTERNAL_PROOF_KINDS } from "../../../src/core/orchestrator/journal-schema.js";
import { parseWavesJournal } from "../../../src/core/orchestrator/waves-journal.js";
import { validateWavesJournal } from "../../../src/core/orchestrator/waves-validate.js";
import { complete, finalVerify, journalRoot, result, waveVerify, type Json } from "./waves-fixtures.js";

// FR-NODE-152 — no verdict-bearing line passes with `journal` as its only proof kind.

async function codes(lines: Json[], engine: "kiwi-wave-master" | "kiwi-orchestrator" = "kiwi-wave-master"): Promise<string[]> {
  const root = await journalRoot(lines);
  return validateWavesJournal(await parseWavesJournal(root, { runId: "run-a", engine })).map((item) => item.code);
}

const JOURNAL_PROOF = { kind: "journal", ref: "waves.jsonl#L18 status=complete verdict=pass" };
const V14 = { schema_version: "1.4.0", engine: "kiwi-orchestrator", writer: "speckiwi-orchestrate/2.4.1" } as const;

describe("FR-NODE-152 journal-only proofs on verdict-bearing lines", () => {
  it("AC-1 refuses a wave complete whose only proof is of kind journal", async () => {
    expect(await codes([waveVerify(), complete({ proof: JOURNAL_PROOF }), finalVerify()])).toContain("journal-only-verdict");
  });

  it("AC-2 accepts the same line for each of the five externally recomputable kinds", async () => {
    expect([...EXTERNAL_PROOF_KINDS]).toEqual(["git-ancestor", "git-ref", "git-trailer", "digest", "mcp-state"]);

    for (const kind of EXTERNAL_PROOF_KINDS) {
      const lines = [waveVerify(), complete({ proof: [JOURNAL_PROOF, { kind, ref: `ref-for-${kind}` }] }), finalVerify()];
      expect(await codes(lines), `additional proof ${kind}`).toEqual([]);
    }
  });

  it("AC-2 refuses a line whose additional proof is a second journal proof", async () => {
    const lines = [
      waveVerify(),
      complete({ proof: [JOURNAL_PROOF, { kind: "journal", ref: "waves.jsonl#L19" }] }),
      finalVerify()
    ];
    expect(await codes(lines)).toContain("journal-only-verdict");
  });

  it("AC-3 accepts a line that records no verdict with a journal proof alone", async () => {
    const lines = [
      waveVerify(V14),
      result("plan-wave", { proof: JOURNAL_PROOF, stage: 1 }),
      complete({ ...V14, proof: { kind: "git-trailer", ref: "b71c904 Orch-Run=run-a Orch-Wave=1" } }),
      finalVerify(V14)
    ];

    expect(await codes(lines, "kiwi-orchestrator")).toEqual([]);
  });

  it("AC-4 covers a verification-verdict line and a wave-completion line separately", async () => {
    // A verdict-bearing wave-verify round record.
    expect(await codes([waveVerify({ proof: JOURNAL_PROOF }), complete(), finalVerify()])).toEqual(["journal-only-verdict"]);

    // A wave-completion line, with the round record left clean.
    expect(await codes([waveVerify(), complete({ proof: JOURNAL_PROOF }), finalVerify()])).toEqual(["journal-only-verdict"]);

    // And the run-scope final verification, which is verdict-bearing too.
    expect(await codes([waveVerify(), complete(), finalVerify({ proof: JOURNAL_PROOF })])).toEqual(["journal-only-verdict"]);
  });

  it("refuses a lane integration line whose only proof is journal", async () => {
    const lines = [
      waveVerify(V14),
      result("integrate-lane", {
        stage: 1,
        lane: "lane-1",
        isolation: { profile: "none-serial", merge_sha: "aaa" },
        proof: JOURNAL_PROOF
      })
    ];

    expect(await codes(lines, "kiwi-orchestrator")).toContain("journal-only-verdict");
  });
});
