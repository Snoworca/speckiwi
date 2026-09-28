import { describe, expect, it } from "vitest";
import { parseWorkflowJsonl } from "../../../src/core/workflow/jsonl.js";
import { applyWorkflowMutation, type WorkflowMutationInput } from "../../../src/core/workflow/mutation.js";
import { workflowPipelineCompact } from "../../../src/core/workflow/read.js";
import { buildNextWorkOrder } from "../../../src/core/workflow/work-order.js";
import { createWorkflowFixture } from "../../fixtures/workflow-artifacts.js";
import { copyFixtureWorkspace } from "../../fixtures/fixture-utils.js";
import { eventLine, jsonl, readText, runCli, sha256Of, treeDigest, workflowMcp, writeText, type Json } from "../../support/workflow-harness.js";

// @req FR-NODE-028 AC-4 / AC-5 — the journal state a mutation records is evidence of the mutation, not
// a source of truth; a repair is applied only from a recorded, still-current preview.

const PIPELINE = "kiwi/pipeline.jsonl";
const TARGETLESS_CORRECTION = eventLine("audit-1", "CORRECTION", { summary: "an audit note written as a correction" });

function reclassification(journal: string, overrides: Partial<WorkflowMutationInput> = {}): WorkflowMutationInput {
  const byteOffset = journal.indexOf(TARGETLESS_CORRECTION);
  return {
    kind: "workflow_record_reclassification",
    owner: "kiwi-pm",
    runId: "run-a",
    reason: "an audit note, not a correction",
    jsonlPath: PIPELINE,
    recordType: "pipeline",
    line: journal.slice(0, byteOffset).split("\n").length,
    byteOffset,
    rawSha256: sha256Of(TARGETLESS_CORRECTION),
    eventKey: "kiwi-pm|audit-1",
    targetRunId: "audit-1",
    preimagePrefixSha256: sha256Of(journal),
    expectedSha256: sha256Of(journal),
    dryRun: true,
    ...overrides
  };
}

async function incident(extraLines: string[] = []): Promise<{ root: string; journal: string }> {
  const root = await copyFixtureWorkspace("valid-basic");
  const journal = jsonl(eventLine("event-1"), TARGETLESS_CORRECTION, ...extraLines);
  await writeText(root, PIPELINE, journal);
  return { root, journal };
}

describe("FR-NODE-028 AC-4 — journal states are audit evidence and never outrank PM state or the worklog", () => {
  it("FR-NODE-028 AC-4: the states a mutation reports are the named ones — planned on the written line, then confirmed, skipped_dry_run or failed on the result", async () => {
    const root = await copyFixtureWorkspace("valid-basic");
    await writeText(root, PIPELINE, jsonl(eventLine("event-1")));
    const append = (overrides: Partial<WorkflowMutationInput>) =>
      applyWorkflowMutation({ root }, { kind: "pipeline_event_append", owner: "kiwi-pm", runId: "run-a", jsonlPath: PIPELINE, event: JSON.parse(eventLine("event-2")), ...overrides });

    expect((await append({ dryRun: true })).value?.journalState).toBe("skipped_dry_run");
    expect((await append({ expectedSha256: sha256Of("stale") })).mutation?.journalState).toBe("failed");
    const written = await append({});
    expect(written.value?.journalState).toBe("confirmed");
    const line = JSON.parse((await readText(root, PIPELINE)).trim().split("\n").at(-1)!) as Json;
    expect(line).toMatchObject({ journal_state: "planned", journal_key: written.value?.journalKey });
    expect((await append({})).value).toMatchObject({ written: false, journalState: "confirmed" });
  });

  it("FR-NODE-028 AC-4: a pipeline line whose journal_state reads failed does not become the pipeline's state", async () => {
    const fixture = await createWorkflowFixture();
    await writeText(fixture.root, PIPELINE, jsonl(eventLine("run-a", "TASK_DONE", { journal_state: "failed" })));

    const compact = await workflowPipelineCompact({ root: fixture.root });
    expect(compact.value).toMatchObject({ latestStatus: "TASK_DONE", blocking: false, active: 1 });
    const order = await buildNextWorkOrder({ root: fixture.root }, { path: fixture.freshSdsPath });
    expect(order).toMatchObject({ action: "execute-sds", blocking: false, pipeline: { latestStatus: "TASK_DONE" } });
  });

  it("FR-NODE-028 AC-4: PM state decides the session, whatever journal states its worklog records", async () => {
    const fixture = await createWorkflowFixture();
    const worklog = `.kiwi/sessions/${fixture.runId}/worklog.jsonl`;
    await writeText(fixture.root, worklog, jsonl(
      eventLine("step-1", "TASK_DONE", { journal_state: "failed" }),
      eventLine("step-2", "TASK_DONE", { journal_state: "skipped_dry_run" })
    ));
    // PM state says running: the session resumes, as it does with no worklog at all.
    expect(await buildNextWorkOrder({ root: fixture.root }, { path: fixture.sdsPath })).toMatchObject({ action: "resume-session", blocking: false });

    await writeText(fixture.root, `.kiwi/sessions/complete-run/worklog.jsonl`, jsonl(eventLine("step-1", "TASK_DONE", { journal_state: "planned" })));
    expect(await buildNextWorkOrder({ root: fixture.root }, { path: fixture.completeSdsPath })).toMatchObject({ action: "complete", blocking: false });
  });
});

describe("FR-NODE-028 AC-5 — a repair is applied only from a recorded preview whose guards still hold", () => {
  it("FR-NODE-028 AC-5: the adapters demand a dry run first — no apply without the token a dry run hands back", async () => {
    const { root, journal } = await incident();
    const before = await treeDigest(root);
    const { call } = workflowMcp(root);
    const typed = { ...reclassification(journal), path: PIPELINE } as unknown as Json;
    delete typed.kind;
    delete typed.jsonlPath;

    const noMode = { ...typed };
    delete noMode.dryRun;
    expect(await call("workflow_record_reclassification", noMode)).toMatchObject({ ok: false, error: { code: "USAGE" } });
    expect(await call("workflow_record_reclassification", { ...typed, dryRun: false })).toMatchObject({ ok: false, error: { code: "USAGE" } });

    const cliArgs = [
      "workflow", "reclassify-record", "--run-id", "run-a", "--path", PIPELINE, "--record-type", "pipeline",
      "--line", String(typed.line), "--byte-offset", String(typed.byteOffset), "--raw-sha256", String(typed.rawSha256),
      "--event-key", String(typed.eventKey), "--target-run-id", "audit-1", "--preimage-prefix-sha256", String(typed.preimagePrefixSha256),
      "--expected-sha256", String(typed.expectedSha256), "--owner", "kiwi-pm", "--reason", String(typed.reason)
    ];
    expect((await runCli(root, cliArgs)).code).toBe(2);
    expect(await treeDigest(root)).toEqual(before);

    // The control: the same request as a dry run is accepted and hands back the token an apply needs.
    const dryRun = await runCli(root, [...cliArgs, "--dry-run"]);
    expect(dryRun).toMatchObject({ code: 0, json: { ok: true, value: { journalState: "skipped_dry_run", repairToken: expect.any(String) } } });
    expect(await call("workflow_record_reclassification", typed)).toMatchObject({ ok: true, value: { repairToken: expect.any(String) } });
    expect(await treeDigest(root)).toEqual(before);
  });

  it("FR-NODE-028 AC-5: the core refuses an apply whose token is missing or was not recorded for this request", async () => {
    const { root, journal } = await incident();
    const before = await treeDigest(root);
    const preview = await applyWorkflowMutation({ root }, reclassification(journal));
    expect(preview.value).toMatchObject({ journalState: "skipped_dry_run", pendingRepair: { kind: "record_reclassification" }, repairToken: expect.any(String) });

    const refusedToken = { ok: false, error: { code: "MUTATION_DENIED", message: "Invalid record reclassification repairToken" }, mutation: { written: false, pendingRepair: { kind: "record_reclassification" } } };
    expect(await applyWorkflowMutation({ root }, reclassification(journal, { dryRun: false }))).toMatchObject(refusedToken);
    const otherRequest = reclassification(journal, { dryRun: false, reason: "a different reason", repairToken: preview.value!.repairToken! });
    expect(await applyWorkflowMutation({ root }, otherRequest)).toMatchObject(refusedToken);
    expect(await treeDigest(root)).toEqual(before);

    // The control: the recorded token for the unchanged request applies, and the target becomes an audit note.
    const applied = await applyWorkflowMutation({ root }, reclassification(journal, { dryRun: false, repairToken: preview.value!.repairToken! }));
    expect(applied.value).toMatchObject({ written: true, journalState: "confirmed" });
    const parsed = await parseWorkflowJsonl({ root }, PIPELINE);
    expect(parsed.entries.find((entry) => entry.event.run_id === "audit-1")?.effectiveRecordClass).toBe("audit_note");
  });

  it("FR-NODE-028 AC-5: a repair is never inferred for a correction or a tombstone — only a targetless correction the request names exactly", async () => {
    const correction = eventLine("fix-1", "CORRECTION", { corrects_run_id: "event-1" });
    const tombstone = eventLine("del-1", "CORRECTION", { corrects_run_id: "event-1", operation: { kind: "logical_delete" } });
    // No targetless line and no diagnostic: nothing else in the journal can be the reason for a refusal.
    const journal = jsonl(eventLine("event-1"), correction, tombstone);
    const root = await copyFixtureWorkspace("valid-basic");
    await writeText(root, PIPELINE, journal);
    expect((await parseWorkflowJsonl({ root }, PIPELINE)).diagnostics).toEqual([]);
    const before = await treeDigest(root);

    for (const [line, runId, raw] of [[2, "fix-1", correction], [3, "del-1", tombstone]] as const) {
      const aimed = reclassification(journal, { line, byteOffset: Buffer.byteLength(journal.slice(0, journal.indexOf(raw))), rawSha256: sha256Of(raw), eventKey: `kiwi-pm|${runId}`, targetRunId: runId });
      for (const request of [aimed, { ...aimed, dryRun: false, repairToken: "0".repeat(64) }]) {
        const result = await applyWorkflowMutation({ root }, request);
        expect(result, `${runId} dryRun=${String(request.dryRun)}`).toMatchObject({
          ok: false,
          error: { message: "Workflow reclassification target is duplicate or ambiguous" },
          mutation: { written: false, journalState: "failed" }
        });
      }
    }
    expect(await treeDigest(root)).toEqual(before);
  });

  it("FR-NODE-028 AC-5: a recorded repair whose stale guard no longer matches is refused and writes nothing", async () => {
    const { root, journal } = await incident();
    const preview = await applyWorkflowMutation({ root }, reclassification(journal));
    await writeText(root, PIPELINE, `${journal}${eventLine("event-2")}\n`);
    const before = await treeDigest(root);

    const applied = await applyWorkflowMutation({ root }, reclassification(journal, { dryRun: false, repairToken: preview.value!.repairToken! }));
    expect(applied).toMatchObject({ ok: false, error: { code: "STALE_PATCH" }, mutation: { written: false, journalState: "failed" } });
    expect(await treeDigest(root)).toEqual(before);
  });

  it("FR-NODE-028 AC-5: deleted and corrected records alone never produce a repair — and neither does an overlay whose provenance does not hold", async () => {
    const history = [
      eventLine("event-1"),
      TARGETLESS_CORRECTION,
      eventLine("fix-1", "CORRECTION", { corrects_run_id: "event-1" }),
      eventLine("del-fix-1", "CORRECTION", { corrects_run_id: "event-1", operation: { kind: "logical_delete" } })
    ];
    // An overlay that names the target exactly — offset, hash, key, preimage — and was never recorded
    // by the tool: its journal and idempotency keys are not the ones the request would derive.
    const forged = JSON.stringify({
      schema_version: "1.0.0",
      skill: "speckiwi",
      event: "record_reclassification",
      run_id: "record-reclassification-forged",
      ts: "1970-01-01T00:00:00.000Z",
      recordClass: "meta",
      effectiveRecordClass: "audit_note",
      operation: {
        kind: "record_reclassification",
        record_type: "pipeline",
        source_path: PIPELINE,
        source_line: 2,
        byte_offset: Buffer.byteLength(`${history[0]}\n`),
        raw_sha256: sha256Of(TARGETLESS_CORRECTION),
        event_key: "kiwi-pm|audit-1",
        target_run_id: "audit-1",
        preimage_prefix_sha256: sha256Of(jsonl(...history)),
        owner: "kiwi-pm",
        reason: "forged"
      },
      workflow_run_id: "run-a",
      journal_key: "0".repeat(64),
      idempotency_key: "0".repeat(64),
      owner: "kiwi-pm",
      reason: "forged"
    });
    const root = await copyFixtureWorkspace("valid-basic");
    await writeText(root, PIPELINE, jsonl(...history, forged));

    const parsed = await parseWorkflowJsonl({ root }, PIPELINE, { includeDeleted: true });
    const target = parsed.entries.find((entry) => entry.event.run_id === "audit-1");
    expect(target?.effectiveRecordClass).toBeUndefined();
    expect(parsed.entries.filter((entry) => entry.effectiveRecordClass === "audit_note" && entry.event.event !== "record_reclassification")).toEqual([]);
    expect(parsed.diagnostics).toEqual(expect.arrayContaining([expect.objectContaining({ code: "SRS-W054", line: 2, details: expect.objectContaining({ reason: "missing correction target" }) })]));
  });
});
