import { describe, expect, it } from "vitest";
import { parseWorkflowJsonl } from "../../../src/core/workflow/jsonl.js";
import { applyWorkflowMutation, type WorkflowMutationInput } from "../../../src/core/workflow/mutation.js";
import { copyFixtureWorkspace } from "../../fixtures/fixture-utils.js";
import { eventLine, jsonl, readText, sha256Of, treeDigest, writeText } from "../../support/workflow-harness.js";

// @req FR-NODE-031 — logical delete marks a record deleted by appending a tombstone, never by removing
// the line, and refuses every request it cannot prove safe.

const WORKLOG = ".kiwi/sessions/run-a/worklog.jsonl";
const PIPELINE = "kiwi/pipeline.jsonl";

function remove(overrides: Partial<WorkflowMutationInput>): WorkflowMutationInput {
  return { kind: "workflow_logical_delete", owner: "kiwi-pm", runId: "run-a", reason: "obsolete", jsonlPath: PIPELINE, recordType: "pipeline_event", ...overrides };
}

async function root(files: Record<string, string>): Promise<string> {
  const workspace = await copyFixtureWorkspace("valid-basic");
  for (const [relativePath, text] of Object.entries(files)) await writeText(workspace, relativePath, text);
  return workspace;
}

describe("FR-NODE-031 AC-1 — worklog events and repair records are deleted without removing their line", () => {
  for (const [recordType, recordId] of [["worklog_event", "event-1"], ["repair_record", "repair-1"]] as const) {
    it(`FR-NODE-031 AC-1: a ${recordType} becomes deleted while its original line stays byte-identical`, async () => {
      const original = jsonl(eventLine("event-1"), eventLine("repair-1", "TASK_DONE", { repair: { kind: "rerun_with_fresh_artifact" } }));
      const workspace = await root({ [WORKLOG]: original });

      const result = await applyWorkflowMutation({ root: workspace }, remove({ jsonlPath: WORKLOG, recordType, recordId }));

      expect(result).toMatchObject({ ok: true, value: { written: true, targetRecord: { recordType, recordId, desiredState: "deleted" } } });
      const after = await readText(workspace, WORKLOG);
      expect(after.startsWith(original)).toBe(true);
      const parsed = await parseWorkflowJsonl({ root: workspace }, WORKLOG, { includeDeleted: true });
      const target = parsed.entries.find((entry) => entry.event.run_id === recordId);
      expect(target?.deletedBy).toHaveLength(1);
      const active = await parseWorkflowJsonl({ root: workspace }, WORKLOG);
      expect(active.latestEntries.map((entry) => entry.event.run_id)).not.toContain(recordId);
    });
  }
});

describe("FR-NODE-031 AC-4 — logical delete refuses what it cannot prove safe, and writes nothing when it does", () => {
  async function refused(files: Record<string, string>, input: WorkflowMutationInput) {
    const workspace = await root(files);
    const before = await treeDigest(workspace);
    const result = await applyWorkflowMutation({ root: workspace }, input);
    expect(result.ok, JSON.stringify(result.error)).toBe(false);
    expect(result.mutation).toMatchObject({ written: false, journalState: "failed" });
    expect(await treeDigest(workspace)).toEqual(before);
    return result;
  }

  it("FR-NODE-031 AC-4: a stale artifact hash is refused as STALE_PATCH", async () => {
    const result = await refused({ [PIPELINE]: jsonl(eventLine("event-1")) }, remove({ recordId: "event-1", expectedSha256: sha256Of("an older journal") }));
    expect(result).toMatchObject({ error: { code: "STALE_PATCH" }, diagnostics: [expect.objectContaining({ code: "SRS-E032" })] });
  });

  it("FR-NODE-031 AC-4: a record ID the journal does not hold is refused, with a fresh hash so the stale guard does not answer first", async () => {
    const journal = jsonl(eventLine("event-1"));
    const result = await refused({ [PIPELINE]: journal }, remove({ recordId: "no-such-record", expectedSha256: sha256Of(journal) }));
    expect(result).toMatchObject({ error: { code: "MUTATION_DENIED", message: "Workflow record was not found" }, diagnostics: [expect.objectContaining({ code: "SRS-E073" })] });
  });

  it("FR-NODE-031 AC-4: an empty record ID is refused as a usage error", async () => {
    const result = await refused({ [PIPELINE]: jsonl(eventLine("event-1")) }, remove({ recordId: "" }));
    expect(result.diagnostics).toEqual([expect.objectContaining({ code: "SRS-E071" })]);
  });

  it("FR-NODE-031 AC-4: an owner other than PM is refused", async () => {
    const result = await refused({ [PIPELINE]: jsonl(eventLine("event-1")) }, remove({ recordId: "event-1", owner: "kiwi-coder" }));
    expect(result.diagnostics).toEqual([expect.objectContaining({ code: "SRS-E070" })]);
  });

  it("FR-NODE-031 AC-4: malformed JSONL is refused with a repair_malformed_jsonl pending repair", async () => {
    const result = await refused({ [PIPELINE]: jsonl(eventLine("event-1"), "{not json") }, remove({ recordId: "event-1" }));
    expect(result.mutation).toMatchObject({ pendingRepair: { kind: "repair_malformed_jsonl" } });
  });

  it("FR-NODE-031 AC-4: a record class outside the deletable set is refused", async () => {
    const result = await refused({ [PIPELINE]: jsonl(eventLine("event-1")) }, remove({ recordId: "event-1", recordType: "pm_task" }));
    expect(result).toMatchObject({ error: { message: "Workflow record class is not deletable" }, diagnostics: [expect.objectContaining({ code: "SRS-E073" })] });
  });

  it("FR-NODE-031 AC-4: a tombstone cannot itself be deleted", async () => {
    const journal = jsonl(eventLine("event-1"), eventLine("del-1", "CORRECTION", { corrects_run_id: "event-1", operation: { kind: "logical_delete" } }));
    const result = await refused({ [PIPELINE]: journal }, remove({ recordId: "del-1" }));
    expect(result).toMatchObject({ error: { message: "Workflow correction or tombstone records are not deletable" } });
  });

  it("FR-NODE-031 AC-4: a correction that targets a tombstone cannot be deleted, and it never resurrects the deleted record", async () => {
    const journal = jsonl(
      eventLine("event-1"),
      eventLine("del-1", "CORRECTION", { corrects_run_id: "event-1", operation: { kind: "logical_delete" } }),
      eventLine("fix-del-1", "CORRECTION", { corrects_run_id: "del-1" })
    );
    const result = await refused({ [PIPELINE]: journal }, remove({ recordId: "fix-del-1" }));
    expect(result).toMatchObject({ error: { message: "Workflow correction or tombstone records are not deletable" } });

    const workspace = await root({ [PIPELINE]: journal });
    const parsed = await parseWorkflowJsonl({ root: workspace }, PIPELINE);
    expect(parsed.latestEntries.map((entry) => entry.event.run_id)).not.toContain("event-1");
    expect(parsed.diagnostics).toEqual(expect.arrayContaining([expect.objectContaining({ code: "SRS-W054", details: expect.objectContaining({ reason: "correction target is a logical-delete tombstone" }) })]));
  });

  it("FR-NODE-031 AC-4: a plain CORRECTION event cannot be deleted", async () => {
    const journal = jsonl(eventLine("event-1"), eventLine("fix-1", "CORRECTION", { corrects_run_id: "event-1" }));
    const result = await refused({ [PIPELINE]: journal }, remove({ recordId: "fix-1" }));
    expect(result).toMatchObject({ error: { message: "Workflow correction or tombstone records are not deletable" } });
  });
});
