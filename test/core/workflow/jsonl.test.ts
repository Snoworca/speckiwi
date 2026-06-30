import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { appendWorkflowJsonl, parseWorkflowJsonl, type WorkflowJsonlEvent } from "../../../src/core/workflow/jsonl.js";

async function tempRoot(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), "speckiwi-workflow-jsonl-"));
}

async function write(root: string, relativePath: string, text: string): Promise<void> {
  const absolutePath = path.join(root, relativePath);
  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, text, "utf8");
}

function event(runId: string, overrides: Partial<WorkflowJsonlEvent> = {}): WorkflowJsonlEvent {
  return {
    ts: `2026-06-29T00:00:0${runId.length}.000Z`,
    schema_version: "1.0.0",
    skill: "kiwi-srs",
    run_id: runId,
    status: "TASK_DONE",
    summary: runId,
    next_hint: null,
    artifacts: { spec_files: [], plan_file: null, sidecar_file: null, analysis_dir: null },
    dry_run: false,
    ...overrides
  };
}

function line(value: WorkflowJsonlEvent): string {
  return JSON.stringify(value);
}

describe("FR-NODE-021 workflow JSONL utilities", () => {
  it("parses valid events while reporting invalid lines, unsupported schemas, duplicates, and trailing-LF drift", async () => {
    const root = await tempRoot();
    const missingSchema = event("run-c");
    delete missingSchema.schema_version;
    await write(
      root,
      "kiwi/pipeline.jsonl",
      [line(event("run-a")), "{\"bad\"", line(event("run-a")), line(event("run-b", { schema_version: "9.9.9" })), line(missingSchema)].join("\n")
    );

    const parsed = await parseWorkflowJsonl({ root }, "kiwi/pipeline.jsonl");

    expect(parsed.entries.map((entry) => entry.event.run_id)).toEqual(["run-a", "run-a", "run-b", "run-c"]);
    expect(parsed.invalidLines).toEqual([expect.objectContaining({ line: 2, byteOffset: expect.any(Number), excerpt: "{\"bad\"" })]);
    expect(parsed.hasTrailingLf).toBe(false);
    expect(parsed.diagnostics.map((item) => item.code)).toEqual(expect.arrayContaining(["SRS-W052", "SRS-W053", "SRS-W055", "SRS-W056"]));
    expect(parsed.latestEntries.map((entry) => entry.event.run_id)).toEqual(["run-a", "run-a", "run-b", "run-c"]);
  });

  it("keeps correction history visible while excluding corrected events from latest-state selection", async () => {
    const root = await tempRoot();
    const correction = event("run-b", { status: "CORRECTION", corrects_run_id: "run-a" });
    const missing = event("run-c", { status: "CORRECTION", corrects_run_id: "missing" });
    const cycleA = event("run-d", { status: "CORRECTION", corrects_run_id: "run-e" });
    const cycleB = event("run-e", { status: "CORRECTION", corrects_run_id: "run-d" });
    const deepA = event("run-f", { status: "CORRECTION", corrects_run_id: "run-g" });
    const deepB = event("run-g", { status: "CORRECTION", corrects_run_id: "run-h" });
    await write(root, "kiwi/pipeline.jsonl", [event("run-a"), correction, missing, cycleA, cycleB, deepA, deepB, event("run-h")].map(line).join("\n") + "\n");

    const parsed = await parseWorkflowJsonl({ root }, "kiwi/pipeline.jsonl", { maxCorrectionDepth: 1 });

    expect(parsed.tail.map((entry) => entry.event.run_id)).toEqual(["run-a", "run-b", "run-c", "run-d", "run-e", "run-f", "run-g", "run-h"]);
    const original = parsed.tail.find((entry) => entry.event.run_id === "run-a");
    expect(original?.correctedBy).toEqual(["run-b"]);
    expect(parsed.latestEntries.map((entry) => entry.event.run_id)).not.toContain("run-a");
    expect(parsed.diagnostics.filter((item) => item.code === "SRS-W054").length).toBeGreaterThanOrEqual(2);
  });

  it("applies logical-delete tombstones before normal corrections without adding DELETED status", async () => {
    const root = await tempRoot();
    const original = event("run-a", { status: "TASK_DONE" });
    const tombstone = event("run-delete-a", { status: "CORRECTION", corrects_run_id: "run-a", operation: { kind: "logical_delete", reason: "obsolete" } });
    const resurrect = event("run-resurrect-a", { status: "CORRECTION", corrects_run_id: "run-delete-a", operation: { kind: "normal_correction" } });
    const deletedStatus = event("run-deleted-status", { status: "DELETED" });
    await write(root, "kiwi/pipeline.jsonl", [original, tombstone, resurrect, deletedStatus].map(line).join("\n") + "\n");

    const parsed = await parseWorkflowJsonl({ root }, "kiwi/pipeline.jsonl");

    expect(parsed.tail.find((entry) => entry.event.run_id === "run-a")?.deletedBy).toEqual(["run-delete-a"]);
    expect(parsed.tail.find((entry) => entry.event.run_id === "run-delete-a")?.logicalDeleteTarget).toBe("run-a");
    expect(parsed.latestEntries.map((entry) => entry.event.run_id)).not.toContain("run-a");
    expect(parsed.latestEntries.map((entry) => entry.event.run_id)).not.toContain("run-delete-a");
    expect(parsed.latestEntries.map((entry) => entry.event.run_id)).not.toContain("run-resurrect-a");
    expect(parsed.diagnostics).toEqual(expect.arrayContaining([expect.objectContaining({ code: "SRS-W069" }), expect.objectContaining({ code: "SRS-W054" })]));

    const includeDeleted = await parseWorkflowJsonl({ root }, "kiwi/pipeline.jsonl", { includeDeleted: true });
    expect(includeDeleted.latestEntries.map((entry) => entry.event.run_id)).toEqual(expect.arrayContaining(["run-a", "run-delete-a"]));
  });

  it("appends one-line events with dry-run, stale guard, trailing-LF enforcement, and halt policy", async () => {
    const root = await tempRoot();
    await write(root, "kiwi/pipeline.jsonl", line(event("existing")));

    const halted = await appendWorkflowJsonl({ root }, "kiwi/pipeline.jsonl", event("new-halt"), { policy: "halt" });
    expect(halted).toMatchObject({ ok: false, error: { code: "MUTATION_DENIED" }, diagnosticsSummary: { byCode: { "SRS-W056": 1 } } });

    const dryRun = await appendWorkflowJsonl({ root }, "kiwi/pipeline.jsonl", event("dry-run"), { policy: "best-effort", dryRun: true });
    expect(dryRun).toMatchObject({
      ok: true,
      value: { written: false, eventKey: "kiwi-srs|dry-run" },
      mutation: { kind: "append_workflow_jsonl", dryRun: true, written: false }
    });
    expect(await readFile(path.join(root, "kiwi/pipeline.jsonl"), "utf8")).toBe(line(event("existing")));

    const appended = await appendWorkflowJsonl({ root }, "kiwi/pipeline.jsonl", event("new"), { policy: "best-effort" });
    expect(appended).toMatchObject({ ok: true, value: { written: true }, diagnosticsSummary: { byCode: { "SRS-W056": 1 } } });
    expect(await readFile(path.join(root, "kiwi/pipeline.jsonl"), "utf8")).toBe(`${line(event("existing"))}\n${line(event("new"))}\n`);

    const stale = await appendWorkflowJsonl({ root }, "kiwi/pipeline.jsonl", event("stale"), { expectedSha256: "wrong" });
    expect(stale).toMatchObject({ ok: false, error: { code: "STALE_PATCH" }, diagnostics: [expect.objectContaining({ code: "SRS-E032" })] });

    const unsupported = await appendWorkflowJsonl({ root }, "kiwi/pipeline.jsonl", event("unsupported", { schema_version: "2.0.0" }), { policy: "halt" });
    expect(unsupported).toMatchObject({ ok: false, error: { code: "MUTATION_DENIED" }, diagnostics: expect.arrayContaining([expect.objectContaining({ code: "SRS-W055" })]) });
  });
});
