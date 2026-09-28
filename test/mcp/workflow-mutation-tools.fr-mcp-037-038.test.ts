import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as artifactLockModule from "../../src/core/workflow/artifact-lock.js";
import { parseWorkflowJsonl } from "../../src/core/workflow/jsonl.js";
import { copyFixtureWorkspace } from "../fixtures/fixture-utils.js";
import { eventLine, jsonl, readText, sha256Of, treeDigest, workflowMcp, writeText, type Json } from "../support/workflow-harness.js";

// @req FR-MCP-037 AC-4 — the MCP workflow mutations fail closed with a structured result.
// @req FR-MCP-038 AC-1 — MCP logical delete reaches every record class core deletes.
// The invalid-JSONL clause of FR-MCP-037 AC-4 is not asserted here: FR-NODE-193 made an unreadable
// line a warning an append steps over, and that requirement is the later, verified one.

const PIPELINE = "kiwi/pipeline.jsonl";
const WORKLOG = ".kiwi/sessions/run-a/worklog.jsonl";

async function workspace(): Promise<string> {
  const root = await copyFixtureWorkspace("valid-basic");
  await writeText(root, PIPELINE, jsonl(eventLine("event-1")));
  await writeText(root, WORKLOG, jsonl(eventLine("step-1"), eventLine("repair-1", "TASK_DONE", { repair: { kind: "rerun_with_fresh_artifact" } })));
  return root;
}

function event(runId: string): Json {
  return JSON.parse(eventLine(runId)) as Json;
}

describe("FR-MCP-037 AC-4 — MCP workflow mutations fail closed with structured results", () => {
  const writers: Array<[string, Json]> = [
    ["workflow_pipeline_emit", { runId: "run-a", event: event("event-2") }],
    ["workflow_worklog_emit", { runId: "run-a", event: event("step-2") }],
    ["workflow_repair_record", { runId: "run-a", event: event("repair-2") }],
    ["workflow_logical_delete", { runId: "run-a", recordType: "pipeline_event", recordId: "event-1", reason: "obsolete" }]
  ];

  for (const [tool, args] of writers) {
    it(`FR-MCP-037 AC-4: ${tool} refuses a stale artifact hash and hands back a rerun repair`, async () => {
      const root = await workspace();
      const before = await treeDigest(root);
      const result = await workflowMcp(root).call(tool, { ...args, expectedSha256: sha256Of("a journal that is no longer there") });
      expect(result).toMatchObject({
        ok: false,
        error: { code: "STALE_PATCH" },
        diagnostics: [expect.objectContaining({ code: "SRS-E032" })],
        mutation: { written: false, journalState: "failed", pendingRepair: { kind: "rerun_with_fresh_artifact" }, staleGuards: [expect.objectContaining({ retry: expect.any(String) })] }
      });
      expect(await treeDigest(root)).toEqual(before);
    });

    it(`FR-MCP-037 AC-4: ${tool} refuses a forbidden owner`, async () => {
      const root = await workspace();
      const before = await treeDigest(root);
      const owner = tool === "workflow_logical_delete" ? "kiwi-coder" : "";
      const result = await workflowMcp(root).call(tool, { ...args, owner });
      expect(result).toMatchObject({ ok: false, error: { code: "MUTATION_DENIED" }, diagnosticsSummary: { byCode: { "SRS-E070": 1 } }, mutation: { written: false, journalState: "failed" } });
      expect(await treeDigest(root)).toEqual(before);
    });

    it(`FR-MCP-037 AC-4: ${tool} refuses while another writer holds the artifact, reporting the failure as a mutation envelope`, async () => {
      const root = await workspace();
      const file = tool === "workflow_pipeline_emit" || tool === "workflow_logical_delete" ? PIPELINE : WORKLOG;
      const held = await artifactLockModule.acquireArtifactLock({ artifactPath: path.join(root, file), owner: "another-writer" });
      expect(held.ok).toBe(true);
      try {
        const before = await readText(root, file);
        const result = await workflowMcp(root).call(tool, args);
        expect(result).toMatchObject({
          ok: false,
          error: { code: "MUTATION_DENIED" },
          diagnostics: [expect.objectContaining({ code: "SRS-E075" })],
          mutation: { written: false, journalState: "failed", completedOperations: [], journalKey: expect.stringMatching(/^[a-f0-9]{64}$/) }
        });
        expect(await readText(root, file)).toBe(before);
      } finally {
        if (held.ok) await artifactLockModule.releaseArtifactLock(held.capability);
      }
    });
  }

  it("FR-MCP-037 AC-4: workflow_record_reclassification refuses a recorded repair whose artifact moved on", async () => {
    const root = await copyFixtureWorkspace("valid-basic");
    const correction = eventLine("audit-1", "CORRECTION", { summary: "an audit note written as a correction" });
    const journal = jsonl(eventLine("event-1"), correction);
    await writeText(root, PIPELINE, journal);
    const { call } = workflowMcp(root);
    const request = {
      runId: "run-a", path: PIPELINE, recordType: "pipeline", line: 2, byteOffset: Buffer.byteLength(`${eventLine("event-1")}\n`),
      rawSha256: sha256Of(correction), eventKey: "kiwi-pm|audit-1", targetRunId: "audit-1",
      preimagePrefixSha256: sha256Of(journal), expectedSha256: sha256Of(journal), owner: "kiwi-pm", reason: "an audit note"
    };
    const preview = await call("workflow_record_reclassification", { ...request, dryRun: true });
    expect(preview).toMatchObject({ ok: true, value: { repairToken: expect.any(String) } });

    await writeText(root, PIPELINE, `${journal}${eventLine("event-2")}\n`);
    const before = await treeDigest(root);
    const applied = await call("workflow_record_reclassification", { ...request, dryRun: false, repairToken: (preview.value as Json).repairToken });
    expect(applied).toMatchObject({ ok: false, error: { code: "STALE_PATCH" }, mutation: { written: false, journalState: "failed" } });
    expect(await treeDigest(root)).toEqual(before);
  });
});

describe("FR-MCP-037 AC-4 — a partial failure is reported as a repair state, and it holds until repaired", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("FR-MCP-037 AC-4: a write whose lock was not released reports the write, the pending cleanup and the repair, and the replay converges", async () => {
    const root = await workspace();
    const { call } = workflowMcp(root);
    const realRelease = artifactLockModule.releaseArtifactLock;
    vi.spyOn(artifactLockModule, "releaseArtifactLock").mockImplementationOnce(async (capability) => {
      await realRelease(capability);
      return { ok: true, released: false, reason: "not_owner" };
    });

    const partial = await call("workflow_pipeline_emit", { runId: "run-a", event: event("event-2") });
    expect(partial).toMatchObject({
      ok: false,
      error: { code: "MUTATION_DENIED" },
      diagnostics: [expect.objectContaining({ code: "SRS-E075" })],
      mutation: {
        journalState: "failed",
        completedOperations: ["write:pipeline_event_append", "confirm:pipeline_event_append"],
        pendingOperations: ["cleanup:pipeline_event_append"],
        pendingRepair: { kind: "workflow_artifact_lock_cleanup", retry: { action: "retry_same_workflow_mutation", mode: "cleanup_then_replay" } }
      }
    });

    // The repair the result names — replay the same mutation — converges on one line, not two.
    const replay = await call("workflow_pipeline_emit", { runId: "run-a", event: event("event-2") });
    expect(replay).toMatchObject({ ok: true, value: { written: false, journalState: "confirmed" } });
    expect((await readText(root, PIPELINE)).split("\n").filter((line) => line.includes('"run_id":"event-2"'))).toHaveLength(1);
  });

  it("FR-MCP-037 AC-4: while a failed lock cleanup is retained, a later mutation of that artifact is refused and writes nothing", async () => {
    const root = await workspace();
    const { call } = workflowMcp(root);
    const realRelease = artifactLockModule.releaseArtifactLock;
    vi.spyOn(artifactLockModule, "releaseArtifactLock").mockImplementationOnce(async (capability) => {
      await realRelease(capability);
      return { ok: false, reason: "cleanup_failed", cleanupDiagnostic: { code: "EACCES", message: "injected cleanup failure" } };
    });
    vi.spyOn(artifactLockModule, "retryRetainedArtifactLockCleanup").mockResolvedValue({ ok: false, reason: "cleanup_failed", cleanupDiagnostic: { code: "EACCES", message: "still failing" } });

    const partial = await call("workflow_pipeline_emit", { runId: "run-a", event: event("event-2") });
    expect(partial).toMatchObject({ ok: false, mutation: { journalState: "failed", pendingRepair: { kind: "workflow_artifact_lock_cleanup", cleanupDiagnostic: { code: "EACCES" } } } });

    const before = await readText(root, PIPELINE);
    const refused = await call("workflow_pipeline_emit", { runId: "run-a", event: event("event-3") });
    expect(refused).toMatchObject({ ok: false, mutation: { written: false, pendingRepair: { kind: "workflow_artifact_lock_cleanup" } } });
    expect(await readText(root, PIPELINE)).toBe(before);
  });
});

describe("FR-MCP-038 AC-1 — MCP logical delete reaches worklog events and repair records", () => {
  for (const [recordType, recordId] of [["worklog_event", "step-1"], ["repair_record", "repair-1"]] as const) {
    it(`FR-MCP-038 AC-1: workflow_logical_delete deletes a ${recordType} and keeps its line`, async () => {
      const root = await workspace();
      const original = await readText(root, WORKLOG);
      const result = await workflowMcp(root).call("workflow_logical_delete", { runId: "run-a", path: WORKLOG, recordType, recordId, reason: "obsolete" });

      expect(result).toMatchObject({ ok: true, value: { written: true, targetRecord: { recordType, recordId, desiredState: "deleted" } }, mutation: { kind: "workflow_logical_delete", filePath: WORKLOG } });
      expect((await readText(root, WORKLOG)).startsWith(original)).toBe(true);
      const parsed = await parseWorkflowJsonl({ root }, WORKLOG);
      expect(parsed.latestEntries.map((entry) => entry.event.run_id)).not.toContain(recordId);
      const tail = await workflowMcp(root).call("workflow_worklog_tail", { path: WORKLOG, includeDeleted: true });
      expect(((tail.value as Json).events as Array<{ event: Json; deletedBy?: string[] }>).find((entry) => entry.event.run_id === recordId)?.deletedBy).toHaveLength(1);
    });
  }
});
