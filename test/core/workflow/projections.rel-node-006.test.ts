import { describe, expect, it } from "vitest";
import { resolveWorkflowArtifacts } from "../../../src/core/workflow/artifacts.js";
import { parseWorkflowJsonl } from "../../../src/core/workflow/jsonl.js";
import {
  workflowArtifacts,
  workflowPipelineCompact,
  workflowPipelineNext,
  workflowPipelineStatus,
  workflowPipelineTail,
  workflowSessionStatus,
  workflowWorklogTail
} from "../../../src/core/workflow/read.js";
import { createWorkflowFixture } from "../../fixtures/workflow-artifacts.js";
import { eventLine, jsonl, treeDigest, writeText } from "../../support/workflow-harness.js";

// @req REL-NODE-006 — the compact pipeline projection composes the resolver (FR-NODE-020), the JSONL
// parser (FR-NODE-021) and the logical-delete state (FR-NODE-031), and writes nothing.

const PIPELINE = "kiwi/pipeline.jsonl";

/** A journal that exercises every rule latest-state selection applies: correction, tombstone, invalid line. */
function mixedJournal(): string {
  return jsonl(
    eventLine("run-a"),
    eventLine("run-b"),
    eventLine("fix-b", "CORRECTION", { corrects_run_id: "run-b" }),
    "{not json",
    eventLine("run-c", "TASK_DONE"),
    eventLine("run-d", "TASK_DONE"),
    // The last line is a tombstone, so the raw last line and the latest active event differ.
    eventLine("del-c", "CORRECTION", { corrects_run_id: "run-c", operation: { kind: "logical_delete" } })
  );
}

describe("REL-NODE-006 AC-2 — the outcome codes", () => {
  it("REL-NODE-006 AC-2: a line whose schema version is not supported projects unsupported_schema_version and blocks", async () => {
    const fixture = await createWorkflowFixture();
    await writeText(fixture.root, PIPELINE, jsonl(eventLine("run-a"), eventLine("run-b", "TASK_DONE", { schema_version: "0.9.0" })));

    const compact = await workflowPipelineCompact({ root: fixture.root });

    expect(compact.value.outcomeCodes).toEqual(["unsupported_schema_version"]);
    expect(compact.value.blocking).toBe(true);
    expect(compact.diagnostics).toEqual(expect.arrayContaining([expect.objectContaining({ code: "SRS-W055", line: 2 })]));
  });
});

describe("REL-NODE-006 AC-3 — the projection consumes the shared services and mutates nothing", () => {
  it("REL-NODE-006 AC-3: every read and projection leaves every file of the workspace byte-identical", async () => {
    const fixture = await createWorkflowFixture();
    await writeText(fixture.root, PIPELINE, mixedJournal());
    const root = { root: fixture.root };
    const before = await treeDigest(fixture.root);

    await workflowPipelineCompact(root);
    await workflowPipelineCompact(root, { includeDeleted: true });
    await workflowPipelineStatus(root);
    await workflowPipelineTail(root, { includeDeleted: true });
    await workflowPipelineNext(root);
    await workflowSessionStatus(root, { runId: fixture.runId, includeBody: true });
    await workflowWorklogTail(root, { runId: fixture.runId });
    await workflowArtifacts(root, { includeBody: true });

    expect(await treeDigest(fixture.root)).toEqual(before);
  });

  it("REL-NODE-006 AC-3: the artifact is the resolver's selection, the counts are the parser's, and the deleted count is the logical-delete state", async () => {
    const fixture = await createWorkflowFixture();
    await writeText(fixture.root, PIPELINE, mixedJournal());
    const root = { root: fixture.root };

    const compact = await workflowPipelineCompact(root);
    const resolved = await resolveWorkflowArtifacts(root, { kind: "pipeline", allowAmbiguous: true });
    const parsed = await parseWorkflowJsonl(root, PIPELINE);
    const withDeleted = await parseWorkflowJsonl(root, PIPELINE, { includeDeleted: true });

    expect(compact.value.artifacts).toEqual([{ relativePath: resolved.selected!.relativePath, kind: "pipeline", sha256: resolved.selected!.sha256, mtimeMs: resolved.selected!.mtimeMs }]);
    expect(compact.value.total).toBe(parsed.entries.length);
    expect(compact.value.active).toBe(parsed.latestEntries.length);
    expect(compact.value.deletedFiltered).toBe(withDeleted.latestEntries.filter((entry) => (entry.deletedBy ?? []).length > 0).length);
    expect(compact.value.deletedFiltered).toBe(1);
    expect(compact.value.outcomeCodes).toEqual(expect.arrayContaining(["invalid_artifact", "deleted_record_filtered"]));
  });
});

describe("REL-NODE-006 AC-5 — latest state, body omission and parity with the parser", () => {
  it("REL-NODE-006 AC-5: the latest state skips corrected and deleted events and equals the parser's last active entry", async () => {
    const fixture = await createWorkflowFixture();
    await writeText(fixture.root, PIPELINE, mixedJournal());
    const root = { root: fixture.root };

    const compact = await workflowPipelineCompact(root);
    const parsed = await parseWorkflowJsonl(root, PIPELINE);

    expect(parsed.latestEntries.map((entry) => entry.event.run_id)).toEqual(["run-a", "run-d"]);
    expect(compact.value.latestEvent).toEqual(parsed.latestEntries.at(-1));
    expect(compact.value.latestEvent).not.toEqual(parsed.entries.at(-1));
    expect(compact.value.latestStatus).toBe("TASK_DONE");
    expect(compact.value.invalidLines).toEqual(parsed.invalidLines);
  });

  it("REL-NODE-006 AC-5: the projection decision tracks the parser when the parser's answer changes", async () => {
    const fixture = await createWorkflowFixture();
    const root = { root: fixture.root };
    const journals = [
      jsonl(eventLine("run-a")),
      jsonl(eventLine("run-a"), eventLine("del-a", "CORRECTION", { corrects_run_id: "run-a", operation: { kind: "logical_delete" } })),
      jsonl(eventLine("run-a"), "{not json"),
      jsonl(eventLine("run-a", "TASK_DONE", { schema_version: "3.0.0" }))
    ];
    for (const journal of journals) {
      await writeText(fixture.root, PIPELINE, journal);
      const parsed = await parseWorkflowJsonl(root, PIPELINE);
      const compact = await workflowPipelineCompact(root);
      expect(compact.value.latestEvent, journal).toEqual(parsed.latestEntries.at(-1) ?? null);
      expect(compact.value.active, journal).toBe(parsed.latestEntries.length);
      expect(compact.value.blocking, journal).toBe(parsed.invalidLines.length > 0 || parsed.diagnostics.some((item) => item.code === "SRS-W055"));
    }
  });

  it("REL-NODE-006 AC-5: no artifact body rides on the projection", async () => {
    const fixture = await createWorkflowFixture();
    const compact = await workflowPipelineCompact({ root: fixture.root }, { includeBody: true });
    expect(compact.artifacts.every((artifact) => artifact.body === undefined)).toBe(true);
    expect(JSON.stringify(compact)).not.toContain('"body"');
  });
});
