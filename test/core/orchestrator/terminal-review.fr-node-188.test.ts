import { describe, expect, it } from "vitest";
import { GATE_IDS } from "../../../src/core/orchestrator/auto-gate.js";
import { TERMINAL_REVIEW_VERDICTS } from "../../../src/core/orchestrator/journal-schema.js";
import { parseWavesJournal } from "../../../src/core/orchestrator/waves-journal.js";
import { validateWavesJournal } from "../../../src/core/orchestrator/waves-validate.js";
import { complete, finalVerify, journalRoot, waveVerify, type Json } from "./waves-fixtures.js";

// @req FR-NODE-188
//
// The terminal review-loop obligation FR-FLOW-131..135 write into the two orchestrating skills is
// natural-language instruction: a content assertion can show that the document says the hop ran and
// nothing more. This file is the part with a machine referent — a declared field on the record that
// closes a run, and a validator that refuses a run-close claiming a pass without it.
//
// Case labels below are LOCAL ordinals ("case 1", "case 2", ...), deliberately not `AC-n`. They
// once read as AC ids and collided with FR-NODE-188's own numbering without mapping onto it — test
// AC-11 was the delegated-complete refusal while SRS AC-11 is the emit-example suite — so a reader
// tracing evidence landed on the wrong criterion. The SRS Verification Evidence rows name which
// criteria this file covers; the labels here only order the cases.
//
// Both halves are load-bearing, and this repository has recorded the failure from each side: a
// source scan that stayed green against a restored deployment defect, and a pure kernel whose gate
// set could not fire because nothing called it. So the refusal is exercised through
// `validateWavesJournal`, the function the run-close path actually runs, rather than through a
// predicate read in isolation.

const PASS: Json = { verification: { rounds: 1, verdict: "pass" } };

/** A terminal_review object with the given verdict; the window defaults to the run diff window. */
function review(verdict: string, overrides: Json = {}): Json {
  return { skill: "kiwi-review-fix-loop", base: "aaa", head: "ccc", verdict, ...overrides };
}

async function view(lines: Json[], runId = "run-a") {
  const root = await journalRoot(lines);
  return parseWavesJournal(root, { runId, engine: "kiwi-wave-master" });
}

async function codes(lines: Json[], runId = "run-a"): Promise<string[]> {
  return validateWavesJournal(await view(lines, runId)).map((item) => item.code);
}

/**
 * A journal whose final-verify closes the run. An empty override means the field is ABSENT, not
 * defaulted — the fixture ships a passing terminal_review so unrelated suites stay unrelated, and
 * this file is the one that must be able to take it away.
 */
function closingRun(finalOverrides: Json): Json[] {
  // 1.5.0 is the version the obligation arrives at; below it the rule stands down so a journal
  // completed under an earlier release is not refused for lacking a field that did not exist.
  const closing = finalVerify({
    schema_version: "1.5.0",
    // 1.4.0 and above require the writer stamp; the run-close line must be well-formed in
    // every other respect so the only diagnostic under test is this one.
    writer: "speckiwi-orchestrate/2.10.0",
    ...PASS,
    ...finalOverrides
  }) as Record<string, unknown>;
  if (!("terminal_review" in finalOverrides)) delete closing.terminal_review;
  return [waveVerify(PASS), complete(), closing as Json];
}

describe("FR-NODE-188 — the terminal review obligation has a runtime referent", () => {
  it("case 1: the gate id is a member of the orchestrator gate vocabulary", () => {
    // Without membership a refusal cannot carry the id, and the declared-subset assertion over both
    // skills' critical_gates[] fails — which is what couples the prose obligation to something a
    // test can execute.
    expect(GATE_IDS).toContain("terminal-review-loop-missing");
  });

  it("case 2: the verdict vocabulary is closed to the four the skills can record", () => {
    expect([...TERMINAL_REVIEW_VERDICTS]).toEqual([
      "pass",
      "residual",
      "not-applicable-empty-window",
      "skipped-run-halted"
    ]);
  });

  it("case 2: a well-formed terminal_review on a passing run-close is accepted", async () => {
    expect(await codes(closingRun({ terminal_review: review("pass") }))).toEqual([]);
  });

  it("case 3: a run-close claiming a pass with no terminal_review is refused", async () => {
    // The whole point of the requirement: a run may not report itself complete on the strength of a
    // verification pass while no review loop covered the commits that pass judges.
    expect(await codes(closingRun({}))).toContain("terminal-review-loop-missing");
  });

  it("case 3: a run-close whose review left residual findings is refused", async () => {
    expect(await codes(closingRun({ terminal_review: review("residual") }))).toContain(
      "terminal-review-loop-missing"
    );
  });

  it("case 3: a run-close recording the halted verdict is refused, because a halted run is not complete", async () => {
    expect(await codes(closingRun({ terminal_review: review("skipped-run-halted") }))).toContain(
      "terminal-review-loop-missing"
    );
  });

  it("case 4: an empty window is accepted — a run that wrote no code owes no review", async () => {
    // This branch is what keeps the gate's predicate honest. Without it the gate fires on
    // requirements-only and pre-landing-halt runs, which is the declared-gate-with-no-predicate
    // failure the orchestrator's own gate table names as worse than omitting the gate.
    const accepted = await codes(
      closingRun({
        run_diff_window: { base_sha: "aaa", head_sha: "aaa" },
        terminal_review: review("not-applicable-empty-window", { base: "aaa", head: "aaa" })
      })
    );
    expect(accepted).toEqual([]);
  });

  it("case 4: a non-completing run-close may carry the halted verdict", async () => {
    const lines = [waveVerify(PASS), complete(), finalVerify({
      status: "failed",
      verification: { rounds: 1, verdict: "fail-residual" },
      terminal_review: review("skipped-run-halted")
    })];
    expect(await codes(lines)).not.toContain("terminal-review-loop-missing");
  });

  it("case 2: a verdict outside the vocabulary is refused", async () => {
    expect(await codes(closingRun({ terminal_review: review("looks-fine") }))).toContain(
      "terminal-review-verdict-outside-vocabulary"
    );
  });

  it("case 2: a terminal_review missing its window is refused", async () => {
    const noWindow = { skill: "kiwi-review-fix-loop", verdict: "pass" };
    expect(await codes(closingRun({ terminal_review: noWindow }))).toContain(
      "terminal-review-window-missing"
    );
  });

  it("case 2: a review window that does not cover the run window is refused", async () => {
    // Without this the field is a self-certification: an empty-window verdict, or a window naming
    // unrelated commits, discharges the obligation while the run's own commits went unreviewed.
    expect(await codes(closingRun({ terminal_review: review("pass", { base: "dead", head: "beef" }) }))).toContain(
      "terminal-review-window-mismatch"
    );
    expect(
      await codes(closingRun({ terminal_review: review("not-applicable-empty-window", { base: "aaa", head: "aaa" }) }))
    ).toContain("terminal-review-window-mismatch");
  });

  it("case 5: the refusal is reached through validateWavesJournal, the run-close path's own entry point", async () => {
    // Named explicitly because the alternative — asserting a pure predicate — is the shape this
    // project has already shipped once and had to repair: a kernel with no caller.
    const refusal = validateWavesJournal(await view(closingRun({}))).find(
      (d) => d.code === "terminal-review-loop-missing"
    );
    expect(refusal, "the run-close validator must produce the refusal itself").toBeDefined();
    expect(refusal?.severity).toBe("error");
  });

  it("case 3: a run written before the obligation existed is not refused for lacking the field", async () => {
    // Every other rule in the validator gates on the run's schema version, and the event contract
    // states the principle: a journal already written is not reinterpreted. Without this the change
    // refuses runs that were legitimate when they closed.
    const legacy = [waveVerify(PASS), complete(), finalVerify({ schema_version: "1.2.0", ...PASS })];
    const closing = legacy[2] as Record<string, unknown>;
    delete closing.terminal_review;
    expect(await codes(legacy)).not.toContain("terminal-review-loop-missing");
  });

  it("case 3: a wave-scope complete is not policed by this gate — the obligation is the run's", async () => {
    // The per-wave loop is covered by the wave-verify gate; duplicating it here would make the
    // run-scope gate fire n+1 times for one obligation.
    const lines = [waveVerify(PASS), complete(), finalVerify({ ...PASS, terminal_review: review("pass") })];
    expect(await codes(lines)).toEqual([]);
  });
});

describe("FR-NODE-188 — the record must stay falsifiable", () => {
  it("case 9: a final-verify close whose run_diff_window is absent cannot discharge the obligation", async () => {
    // The window comparison is the only thing that ties the record to the commits the boundary
    // judges, and `run_diff_window` is the only field it compares against — the event contract
    // carries that field on `phase="final-verify"` lines and nowhere else. Omit it and the writer
    // states any window it likes: the mismatch rule never runs, and a run closes on a review of
    // commits nobody chose. That is the exact shape the explicit window exists to refuse one level
    // up, so a rule that skips it silently protects nothing on the one line it was written for.
    const found = await codes(
      closingRun({ terminal_review: review("pass"), run_diff_window: undefined })
    );

    expect(found, "an unfalsifiable record must not read as a discharged obligation").toContain(
      "terminal-review-run-window-missing"
    );
  });

  it("case 10: a close line that carries no terminal_review at all is still the missing-loop refusal", async () => {
    // Guards the fix above from over-reaching: absent `run_diff_window` must not reclassify the
    // plain "no review ran" case, whose diagnostic names the loop rather than the window.
    const found = await codes(closingRun({ run_diff_window: undefined }));

    expect(found).toContain("terminal-review-loop-missing");
    expect(found).not.toContain("terminal-review-run-window-missing");
  });
});

describe("FR-NODE-188 — the delegating rungs are observed too, not only the run-scope one", () => {
  // `closesTheRun` admits two shapes. The `phase="final-verify"` shape is the wave-master / R-ORCH
  // close; the `dispatch-route` + `outcome="delegated-complete"` shape is how R-STEP and R-PLAN end.
  // The event contract's `outcome` row says delegated-complete IS the run-close signal for that line,
  // and the orchestrator's §4.5.1 close-out never instructs a `status` on it — so a gate that also
  // demands `status: "complete"` observes one rung of the three and calls the obligation enforced.
  const dispatch = (overrides: Json = {}): Json[] => [
    {
      ts: "2026-08-13T00:00:00.000Z",
      schema_version: "1.5.0",
      writer: "speckiwi-orchestrate/2.10.0",
      engine: "kiwi-orchestrator",
      run_id: "run-a",
      wave: "all",
      order: 0,
      verb: "dispatch-route",
      event: "result",
      outcome: "delegated-complete",
      ...overrides
    } as Json
  ];

  const dispatchCodes = async (overrides: Json = {}): Promise<string[]> => {
    const root = await journalRoot(dispatch(overrides));
    const parsed = await parseWavesJournal(root, { runId: "run-a", engine: "kiwi-orchestrator" });
    return validateWavesJournal(parsed).map((item) => item.code);
  };

  it("case 11: a delegated-complete close with no terminal_review is refused", async () => {
    expect(await dispatchCodes()).toContain("terminal-review-loop-missing");
  });

  it("case 12: a delegated-complete close carrying a discharging verdict passes", async () => {
    const found = await dispatchCodes({
      terminal_review: { skill: "kiwi-review-fix-loop", base: "aaa", head: "bbb", verdict: "pass" }
    });
    expect(found).not.toContain("terminal-review-loop-missing");
    // No run_diff_window is required here: the event contract puts that field on final-verify lines
    // only, so demanding it would refuse the shape the orchestrator is documented to write.
    expect(found).not.toContain("terminal-review-window-missing");
  });

  it("case 13: a verdict that does not discharge still refuses on that line", async () => {
    expect(
      await dispatchCodes({
        terminal_review: { skill: "kiwi-review-fix-loop", base: "aaa", head: "bbb", verdict: "skipped-run-halted" }
      })
    ).toContain("terminal-review-loop-missing");
  });
});

describe("FR-NODE-188 — an explicit status is not overridden by the outcome token", () => {
  // The four verdicts are declared for every boundary, and two of them describe a run that did NOT
  // complete: `residual` and `skipped-run-halted`. If the outcome token alone decides "this reports
  // completion", those two become unrecordable on the delegating rungs — the same fact is legal on a
  // final-verify line (AC-4) and refused on a dispatch-route line. So the status is read when the
  // line states one, and the outcome token is the fallback for the real-world shape, which states
  // none: the close-out the orchestrator documents enumerates what to record and no status is in it.
  const halted = { skill: "kiwi-review-fix-loop", base: "aaa", head: "bbb", verdict: "skipped-run-halted" };

  const dispatchLine = (overrides: Json = {}): Json =>
    ({
      ts: "2026-08-13T00:00:00.000Z",
      schema_version: "1.5.0",
      writer: "speckiwi-orchestrate/2.10.0",
      engine: "kiwi-orchestrator",
      run_id: "run-a",
      wave: "all",
      order: 0,
      verb: "dispatch-route",
      event: "result",
      outcome: "delegated-complete",
      ...overrides
    }) as Json;

  const codesFor = async (line: Json): Promise<string[]> => {
    const root = await journalRoot([line]);
    const parsed = await parseWavesJournal(root, { runId: "run-a", engine: "kiwi-orchestrator" });
    return validateWavesJournal(parsed).map((item) => item.code);
  };

  it("case 14: a halted delegating close records skipped-run-halted, as the run-scope close may", async () => {
    const onDispatch = await codesFor(dispatchLine({ status: "failed", terminal_review: halted }));
    const onFinalVerify = await codes(
      closingRun({ status: "failed", terminal_review: halted })
    );

    expect(onDispatch, "the same fact must be recordable on both run-close shapes").not.toContain(
      "terminal-review-loop-missing"
    );
    expect(onFinalVerify).not.toContain("terminal-review-loop-missing");
  });

  it("case 15: the real-world shape, which states no status, still refuses", async () => {
    // Removing the override entirely: the delegating close-out is documented without a status, so
    // the fallback is what keeps this rung policed at all.
    expect(await codesFor(dispatchLine())).toContain("terminal-review-loop-missing");
  });

  it("case 16: an explicit completion status is still policed on that branch", async () => {
    expect(await codesFor(dispatchLine({ status: "complete" }))).toContain("terminal-review-loop-missing");
  });
});

describe("FR-NODE-188 — the two window defects are distinguishable to a consumer", () => {
  // `code` is the machine-readable discriminator: the CLI filters on it and refusals carry the codes
  // as violations[]. The reviewer's own record being incomplete (no base/head) and the LINE lacking
  // the referent to check it against (no run_diff_window) have different owners and different
  // remediations, so one code for both is the conflation this file's own lane rule warns against.
  // It also weakens the mutation evidence: with one code, deleting either check leaves the other
  // test green.
  it("case 17: an incomplete reviewer record and an absent run window carry different codes", async () => {
    const noReviewWindow = await codes(
      closingRun({ terminal_review: { skill: "kiwi-review-fix-loop", verdict: "pass" } })
    );
    const noRunWindow = await codes(
      closingRun({ terminal_review: review("pass"), run_diff_window: undefined })
    );

    expect(noReviewWindow).toContain("terminal-review-window-missing");
    expect(noReviewWindow).not.toContain("terminal-review-run-window-missing");

    expect(noRunWindow).toContain("terminal-review-run-window-missing");
    expect(noRunWindow).not.toContain("terminal-review-window-missing");
  });
});

describe("FR-NODE-188 — additivity holds line by line, not by run maximum", () => {
  // The event contract states each minor is purely additive and never changes the reading of an
  // already-written line. `runIsAtLeast` takes the run's MAXIMUM version, so a rule gated that way
  // reinterprets every earlier line the moment one newer line joins the run — which is exactly what
  // a resume under a newer release does. The version gate's own comment claims it prevents this.
  const legacyClose = (): Json =>
    ({
      ts: "2026-08-13T00:00:00.000Z",
      schema_version: "1.4.0",
      writer: "speckiwi-orchestrate/2.9.0",
      engine: "kiwi-wave-master",
      run_id: "run-a",
      wave: "all",
      order: 0,
      target: "all",
      status: "complete",
      phase: "final-verify",
      run_diff_window: { base_sha: "aaa", head_sha: "ccc" },
      verification: { rounds: 1, verdict: "pass" },
      summary: "legacy close"
    }) as Json;

  const newerLine = (): Json =>
    ({
      ts: "2026-08-13T00:00:01.000Z",
      schema_version: "1.5.0",
      writer: "speckiwi-orchestrate/2.10.0",
      engine: "kiwi-wave-master",
      run_id: "run-a",
      wave: "wave-1",
      order: 1,
      verb: "author-design",
      event: "intent"
    }) as Json;

  it("case 18: a 1.4.0 close is not refused because a later 1.5.0 line joined its run", async () => {
    const alone = await codes([legacyClose()]);
    const joined = await codes([legacyClose(), newerLine()]);

    expect(alone, "the legacy run must pass on its own").not.toContain("terminal-review-loop-missing");
    expect(
      joined,
      "a resume under a newer release must not retroactively refuse a line written before the field existed"
    ).not.toContain("terminal-review-loop-missing");
  });

  it("case 19: a 1.5.0 close in the same mixed run is still refused", async () => {
    // The narrowing must not become a way to opt out: the line that ships at the new version is
    // judged at the new version, whatever else the run contains.
    const mixed = await codes([
      newerLine(),
      { ...(legacyClose() as Record<string, unknown>), schema_version: "1.5.0", writer: "speckiwi-orchestrate/2.10.0" } as Json
    ]);

    expect(mixed).toContain("terminal-review-loop-missing");
  });
});

describe("FR-NODE-188 — a superseded close is not the run's close, and a lowered stamp is refused", () => {
  const at = (version: string, overrides: Json = {}): Json =>
    ({
      ts: "2026-08-13T00:00:00.000Z",
      schema_version: version,
      writer: "speckiwi-orchestrate/2.10.0",
      engine: "kiwi-wave-master",
      run_id: "run-a",
      wave: "all",
      order: 0,
      target: "all",
      status: "complete",
      phase: "final-verify",
      run_diff_window: { base_sha: "aaa", head_sha: "ccc" },
      verification: { rounds: 1, verdict: "pass" },
      summary: "close",
      ...overrides
    }) as Json;

  const plain = (version: string): Json =>
    ({
      ts: "2026-08-13T00:00:01.000Z",
      schema_version: version,
      writer: "speckiwi-orchestrate/2.10.0",
      engine: "kiwi-wave-master",
      run_id: "run-a",
      wave: "wave-2",
      order: 2,
      verb: "author-design",
      event: "intent"
    }) as Json;

  it("case 20a: the gap per-line gating leaves is pinned open, deliberately and with its reason", async () => {
    const gapShape = await codes([at("1.4.0", { terminal_review: undefined }), plain("1.5.0")]);
    // A close stamped below the gated version whose newer lines come AFTER it escapes both the
    // per-line gate and the forward-only downgrade guard. This is REAL and it is left open on
    // purpose: the remedy that closes it — judging the run's final close at the run maximum — was
    // written, went red against case 18, and was reverted, because it closes the gap by doing
    // exactly what the shipped additivity guarantee forbids, reinterpreting an already-written line.
    //
    // This test exists so the decision is a decision and not an oversight. If a future change makes
    // the shape below refuse, that is fine — but it must arrive with the run-scoped rule that says
    // "this run has no close at the current version", and this test must be replaced rather than
    // deleted quietly. Reaching the shape requires appending past one's own close and never
    // re-closing; §5.6's wave-append re-entry re-closes, and the append cap bounds the alternative.
    // Pinned as a fact, not as a vacuous truth: the shape is asserted to produce NOTHING, so the
    // day it starts refusing, this goes red and the replacement is forced to be deliberate.
    expect(gapShape).toEqual([]);
  });

  it("case 20: the wave-append order does not let the real close escape per-line gating", async () => {
    // Per-line gating alone leaves a hole the run-maximum form did not have, and it is not exotic:
    // the wave-append re-entry produces exactly this order. An older close, then the appended wave's
    // newer lines, then the re-run's close. The monotonic guard is forward-only so it sees only
    // ascending versions and says nothing. What closes it is that the first close is SUPERSEDED —
    // a run's close is its last one, and the re-run wrote a new one that is judged at its own version.
    const found = await codes([
      at("1.4.0", { terminal_review: undefined }),
      plain("1.5.0"),
      at("1.5.0", { terminal_review: undefined, ts: "2026-08-13T00:00:02.000Z" })
    ]);

    expect(found, "the run's actual close must still be policed").toContain("terminal-review-loop-missing");
  });

  it("case 21: a legacy close that no later close supersedes is still not reinterpreted", async () => {
    // The guard against over-correcting case 20: without the supersession rule the obvious fix is to
    // judge every close at the run maximum, which is the retroactivity case 18 exists to refuse.
    expect(await codes([at("1.4.0", { terminal_review: undefined })])).not.toContain(
      "terminal-review-loop-missing"
    );
  });

  it("case 22: a close stamped below the version its own run already used is refused", async () => {
    // The other half of what makes per-line gating safe, and the one shape that distinguishes the
    // monotonic guard from the boolean it replaced: every existing downgrade fixture is 1.3.0 after
    // 1.4.0, which the old boolean refused identically. Nothing constructed 1.4.0 after 1.5.0.
    expect(await codes([plain("1.5.0"), at("1.4.0", { ts: "2026-08-13T00:00:02.000Z" })])).toContain(
      "journal-version-downgrade"
    );
  });
});

describe("FR-NODE-188 — an interrupted dispatch is not a completed run", () => {
  it("case 23: a dispatch-route INTENT carrying delegated-complete is not a run close", async () => {
    // The run ledger defines an unmatched intent as an interrupted verb. Both predicates check
    // `event === "result"`, and that clause had no test — so removing it left the suite green while
    // turning every interrupted dispatch into a completed run reporting no review.
    const root = await journalRoot([
      {
        ts: "2026-08-13T00:00:00.000Z",
        schema_version: "1.5.0",
        writer: "speckiwi-orchestrate/2.10.0",
        engine: "kiwi-orchestrator",
        run_id: "run-a",
        wave: "all",
        order: 0,
        verb: "dispatch-route",
        event: "intent",
        outcome: "delegated-complete"
      } as Json
    ]);
    const parsed = await parseWavesJournal(root, { runId: "run-a", engine: "kiwi-orchestrator" });

    expect(validateWavesJournal(parsed).map((item) => item.code)).not.toContain("terminal-review-loop-missing");
  });
});
