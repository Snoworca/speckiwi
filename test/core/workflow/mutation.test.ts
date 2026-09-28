import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  EMPTY_WORKFLOW_REQ_TOKEN,
  applyWorkflowMutation,
  canonicalWorkflowJson,
  workflowJournalIdentity,
  type WorkflowMutationInput
} from "../../../src/core/workflow/mutation.js";

async function tempRoot(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), "speckiwi-workflow-mutation-"));
}

async function write(root: string, relativePath: string, text: string): Promise<void> {
  const absolutePath = path.join(root, relativePath);
  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, text, "utf8");
}

async function read(root: string, relativePath: string): Promise<string> {
  return readFile(path.join(root, relativePath), "utf8");
}

async function sha256(root: string, relativePath: string): Promise<string> {
  return createHash("sha256").update(await read(root, relativePath)).digest("hex");
}

function mutationBase(overrides: Partial<WorkflowMutationInput> = {}): WorkflowMutationInput {
  return {
    kind: "pipeline_event_append",
    owner: "kiwi-pm",
    runId: "run-a",
    taskId: "T-PH001-01",
    jsonlPath: "kiwi/pipeline.jsonl",
    reason: "task done",
    ...overrides
  };
}

const PIPELINE_EVENT = { schema_version: "1.0.0", skill: "kiwi-pm", run_id: "event-b", status: "TASK_DONE" };

describe("FR-NODE-028 canonical workflow journal identity", () => {
  it("uses deterministic canonical JSON and run-aware journal keys", () => {
    expect(canonicalWorkflowJson({ b: 2, a: 1, omitted: undefined, nested: { z: true, y: null } })).toBe('{"a":1,"b":2,"nested":{"y":null,"z":true}}');

    const left = workflowJournalIdentity({
      tool: "pipeline_event_append",
      runId: "run-a",
      taskId: "T-PH001-01",
      args: { b: 2, a: 1, omitted: undefined }
    });
    // reqId is present-but-undefined on purpose: an untyped caller can send that shape, and the key must not
    // tell it apart from an absent reqId. exactOptionalPropertyTypes rejects the shape, hence the cast.
    const right = workflowJournalIdentity({
      tool: "pipeline_event_append",
      runId: "run-a",
      taskId: "T-PH001-01",
      reqId: undefined,
      args: { a: 1, b: 2 }
    } as unknown as Parameters<typeof workflowJournalIdentity>[0]);
    const otherRun = workflowJournalIdentity({
      tool: "pipeline_event_append",
      runId: "run-b",
      taskId: "T-PH001-01",
      args: { a: 1, b: 2 }
    });
    const scopedReq = workflowJournalIdentity({
      tool: "pipeline_event_append",
      runId: "run-a",
      taskId: "T-PH001-01",
      reqId: "FR-NODE-030",
      args: { a: 1, b: 2 }
    });

    expect(left.canonicalArgs).toBe('{"a":1,"b":2}');
    expect(left.reqIdToken).toBe(EMPTY_WORKFLOW_REQ_TOKEN);
    expect(left.journalKey).toMatch(/^[a-f0-9]{64}$/);
    expect(left.journalKey).toBe(right.journalKey);
    expect(left.journalKey).not.toBe(otherRun.journalKey);
    expect(left.journalKey).not.toBe(scopedReq.journalKey);
  });
});

describe("FR-NODE-030 guarded workflow progress mutations", () => {
  // The plan checkbox mutations these guards were first written on left with plan mode (FR-NODE-211
  // AC-1); the same guards are held here on the journal append that remains (FR-NODE-030 AC-3, AC-5).
  it("FR-NODE-030 AC-3: guards a journal append with dry-run, idempotency, stale-hash and owner checks", async () => {
    const root = await tempRoot();
    await write(root, "kiwi/pipeline.jsonl", `${JSON.stringify({ ...PIPELINE_EVENT, run_id: "event-a" })}\n`);
    const before = await sha256(root, "kiwi/pipeline.jsonl");

    const dryRun = await applyWorkflowMutation({ root }, mutationBase({ event: PIPELINE_EVENT, dryRun: true, expectedSha256: before }));
    expect(dryRun).toMatchObject({
      ok: true,
      value: { written: false, journalState: "skipped_dry_run", idempotencyKey: expect.any(String), pendingOperations: ["write:pipeline_event_append"] },
      mutation: { kind: "pipeline_event_append", dryRun: true, written: false, journalKey: expect.any(String), journalState: "skipped_dry_run" }
    });
    expect(await sha256(root, "kiwi/pipeline.jsonl")).toBe(before);

    const stale = await applyWorkflowMutation({ root }, mutationBase({ event: PIPELINE_EVENT, expectedSha256: "wrong" }));
    expect(stale).toMatchObject({
      ok: false,
      error: { code: "STALE_PATCH" },
      diagnostics: [expect.objectContaining({ code: "SRS-E032" })],
      mutation: { journalState: "failed", pendingRepair: expect.objectContaining({ kind: "rerun_with_fresh_artifact" }) }
    });
    expect(await sha256(root, "kiwi/pipeline.jsonl")).toBe(before);

    const applied = await applyWorkflowMutation({ root }, mutationBase({ event: PIPELINE_EVENT, expectedSha256: before }));
    expect(applied).toMatchObject({
      ok: true,
      value: { written: true, journalState: "confirmed", pendingOperations: [], pendingRepair: null },
      mutation: { journalKey: applied.value?.journalKey, idempotencyKey: applied.value?.journalKey, journalState: "confirmed" }
    });

    const forbidden = await applyWorkflowMutation({ root }, mutationBase({ kind: "workflow_logical_delete", recordType: "pipeline_event", recordId: "event-a", owner: "kiwi-coder" }));
    expect(forbidden).toMatchObject({
      ok: false,
      error: { code: "MUTATION_DENIED" },
      diagnostics: [expect.objectContaining({ code: "SRS-E070" })],
      mutation: { journalState: "failed", written: false }
    });
    expect(forbidden).not.toHaveProperty("value");
  });

  it("appends workflow JSONL events with shared journal metadata", async () => {
    const root = await tempRoot();
    await write(root, "kiwi/pipeline.jsonl", "");
    await write(root, ".kiwi/sessions/run-a/worklog.jsonl", "");

    const pipeline = await applyWorkflowMutation(
      { root },
      mutationBase({
        kind: "pipeline_event_append",
        jsonlPath: "kiwi/pipeline.jsonl",
        event: { schema_version: "1.0.0", skill: "kiwi-pm", run_id: "run-a", status: "TASK_DONE" }
      })
    );
    expect(pipeline).toMatchObject({
      ok: true,
      value: { written: true, journalState: "confirmed" },
      mutation: { kind: "pipeline_event_append", completedOperations: expect.arrayContaining(["write:pipeline_event_append"]) }
    });
    expect(await read(root, "kiwi/pipeline.jsonl")).toContain('"journal_key"');

    const duplicatePipeline = await applyWorkflowMutation(
      { root },
      mutationBase({
        kind: "pipeline_event_append",
        jsonlPath: "kiwi/pipeline.jsonl",
        event: { schema_version: "1.0.0", skill: "kiwi-pm", run_id: "run-a", status: "TASK_DONE" }
      })
    );
    expect(duplicatePipeline).toMatchObject({
      ok: true,
      value: { written: false, journalState: "confirmed", completedOperations: ["confirm:pipeline_event_append"] },
      mutation: { written: false, operations: [] }
    });

    const worklog = await applyWorkflowMutation(
      { root },
      mutationBase({
        kind: "worklog_event_append",
        jsonlPath: ".kiwi/sessions/run-a/worklog.jsonl",
        event: { schema_version: "1.0.0", skill: "kiwi-coder", run_id: "coder-a", status: "TASK_DONE", task_id: "T-PH001-01" }
      })
    );
    expect(worklog).toMatchObject({
      ok: true,
      value: { written: true, journalState: "confirmed" },
      mutation: { kind: "worklog_event_append", completedOperations: expect.arrayContaining(["write:worklog_event_append"]) }
    });
    expect(await read(root, ".kiwi/sessions/run-a/worklog.jsonl")).toContain('"journal_key"');
  });

  it("logically deletes JSONL workflow records through tombstones without physical removal", async () => {
    const root = await tempRoot();
    const original = { schema_version: "1.0.0", skill: "kiwi-pm", run_id: "event-a", status: "TASK_DONE", task_id: "T-PH001-01" };
    await write(root, "kiwi/pipeline.jsonl", `${JSON.stringify(original)}\n`);
    const before = await read(root, "kiwi/pipeline.jsonl");
    const beforeHash = await sha256(root, "kiwi/pipeline.jsonl");

    const dryRun = await applyWorkflowMutation(
      { root },
      mutationBase({
        kind: "workflow_logical_delete",
        jsonlPath: "kiwi/pipeline.jsonl",
        recordType: "pipeline_event",
        recordId: "event-a",
        expectedSha256: beforeHash,
        dryRun: true
      })
    );
    expect(dryRun).toMatchObject({
      ok: true,
      value: { written: false, journalState: "skipped_dry_run", pendingOperations: ["write:workflow_logical_delete"] },
      mutation: { kind: "workflow_logical_delete", written: false, pendingRepair: null }
    });
    expect(await read(root, "kiwi/pipeline.jsonl")).toBe(before);

    const deleted = await applyWorkflowMutation(
      { root },
      mutationBase({
        kind: "workflow_logical_delete",
        jsonlPath: "kiwi/pipeline.jsonl",
        recordType: "pipeline_event",
        recordId: "event-a",
        expectedSha256: beforeHash
      })
    );
    expect(deleted).toMatchObject({
      ok: true,
      value: {
        written: true,
        journalState: "confirmed",
        targetRecord: expect.objectContaining({ recordType: "pipeline_event", recordId: "event-a", desiredState: "deleted" })
      },
      mutation: { completedOperations: expect.arrayContaining(["write:workflow_logical_delete", "confirm:workflow_logical_delete"]) }
    });
    const after = await read(root, "kiwi/pipeline.jsonl");
    expect(after).toContain('"run_id":"event-a"');
    expect(after).toContain('"status":"CORRECTION"');
    expect(after).toContain('"kind":"logical_delete"');
    expect(after).toContain('"source_sha256"');
    expect(after).toContain('"ts"');

    const repeated = await applyWorkflowMutation(
      { root },
      mutationBase({
        kind: "workflow_logical_delete",
        jsonlPath: "kiwi/pipeline.jsonl",
        recordType: "pipeline_event",
        recordId: "event-a"
      })
    );
    expect(repeated).toMatchObject({
      ok: true,
      value: { written: false, journalState: "confirmed", completedOperations: ["confirm:workflow_logical_delete"] },
      mutation: { operations: [], written: false }
    });

    const forbiddenCorrection = await applyWorkflowMutation(
      { root },
      mutationBase({
        kind: "workflow_logical_delete",
        jsonlPath: "kiwi/pipeline.jsonl",
        recordType: "pipeline_event",
        recordId: String(deleted.value?.targetRecord.tombstoneRunId)
      })
    );
    expect(forbiddenCorrection).toMatchObject({
      ok: false,
      error: { code: "MUTATION_DENIED" },
      diagnostics: [expect.objectContaining({ code: "SRS-E073" })]
    });

    const stale = await applyWorkflowMutation(
      { root },
      mutationBase({
        kind: "workflow_logical_delete",
        jsonlPath: "kiwi/pipeline.jsonl",
        recordType: "pipeline_event",
        recordId: "missing",
        expectedSha256: "wrong"
      })
    );
    expect(stale).toMatchObject({
      ok: false,
      error: { code: "STALE_PATCH" },
      diagnostics: [expect.objectContaining({ code: "SRS-E032" })]
    });

    const forbiddenOwner = await applyWorkflowMutation(
      { root },
      mutationBase({
        kind: "workflow_logical_delete",
        jsonlPath: "kiwi/pipeline.jsonl",
        recordType: "pipeline_event",
        recordId: "event-a",
        owner: "kiwi-coder"
      })
    );
    expect(forbiddenOwner).toMatchObject({ ok: false, diagnostics: [expect.objectContaining({ code: "SRS-E070" })] });

    await write(root, "kiwi/deleted-status.jsonl", `${JSON.stringify({ schema_version: "1.0.0", skill: "kiwi-pm", run_id: "bad-delete", status: "DELETED" })}\n`);
    const invalidStatus = await applyWorkflowMutation(
      { root },
      mutationBase({
        kind: "workflow_logical_delete",
        jsonlPath: "kiwi/deleted-status.jsonl",
        recordType: "pipeline_event",
        recordId: "bad-delete"
      })
    );
    expect(invalidStatus).toMatchObject({ ok: false, diagnostics: expect.arrayContaining([expect.objectContaining({ code: "SRS-E073" })]) });
  });
});
