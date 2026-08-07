import { createHash } from "node:crypto";
import { watch } from "node:fs";
import { appendFile, mkdir, mkdtemp, readdir, readFile, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import * as artifactLockModule from "../../../src/core/workflow/artifact-lock.js";
import * as jsonlModule from "../../../src/core/workflow/jsonl.js";
import {
  applyWorkflowMutation,
  workflowJournalIdentity,
  type WorkflowMutationInput
} from "../../../src/core/workflow/mutation.js";
import {
  workflowDiff,
  workflowDoctor,
  workflowNextPlanTask,
  workflowPipelineCompact,
  workflowPipelineNext,
  workflowPipelineStatus,
  workflowPipelineTail,
  workflowResumeHint,
  workflowSchemaCheck,
  workflowSessionStatus,
  workflowWorklogTail
} from "../../../src/core/workflow/read.js";
import { validateWorkflowArtifacts } from "../../../src/core/workflow/validate.js";
import { buildNextWorkOrder } from "../../../src/core/workflow/work-order.js";
import { resolveWorkflowArtifacts } from "../../../src/core/workflow/artifacts.js";
import { createWorkflowFixture } from "../../fixtures/workflow-artifacts.js";

type RecordType = "pipeline" | "worklog";

interface TargetIdentity {
  path: string;
  recordType: RecordType;
  line: number;
  byteOffset: number;
  rawSha256: string;
  eventKey: string;
  targetRunId: string;
  preimagePrefixSha256: string;
}

interface ReclassificationInput extends TargetIdentity {
  kind: "workflow_record_reclassification";
  owner: string;
  reason: string;
  runId: string;
  expectedSha256: string;
  dryRun: boolean;
  taskId?: string;
  reqId?: string;
  idempotencyKey?: string;
  repairToken?: string;
  jsonlPath: string;
}

interface DiagnosticShape {
  code: string;
  message: string;
  filePath?: string;
  line?: number;
  details?: Record<string, unknown>;
}

interface ReclassificationResult {
  ok: boolean;
  value?: Record<string, unknown>;
  mutation?: Record<string, unknown>;
  diagnostics: DiagnosticShape[];
  error?: { code: string; message: string };
}

const PIPELINE_PATH = "kiwi/pipeline.jsonl";
const RUN_ID = "2026-08-07.wave3.record-reclassification";

async function tempRoot(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), "speckiwi-record-reclassification-"));
}

async function write(root: string, relativePath: string, value: string): Promise<void> {
  const absolutePath = path.join(root, relativePath);
  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, value, "utf8");
}

async function read(root: string, relativePath: string): Promise<string> {
  return readFile(path.join(root, relativePath), "utf8");
}

function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function productionOverlayJournalIdentity(reason: string, identity: TargetIdentity) {
  return workflowJournalIdentity({
    tool: "workflow_record_reclassification",
    runId: RUN_ID,
    args: { ...identity, effectiveRecordClass: "audit_note", owner: "codex", reason }
  });
}

function durableOverlay(identity: TargetIdentity, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const reason = String(overrides.reason ?? "Retain as audit metadata");
  const journalIdentity = productionOverlayJournalIdentity(reason, identity);
  const journalKey = journalIdentity.journalKey;
  return {
    schema_version: "1.0.0",
    skill: "speckiwi",
    event: "record_reclassification",
    run_id: `record-reclassification-${journalKey.slice(0, 16)}`,
    ts: "1970-01-01T00:00:00.000Z",
    recordClass: "meta",
    effectiveRecordClass: "audit_note",
    operation: {
      kind: "record_reclassification",
      record_type: identity.recordType,
      source_path: identity.path,
      source_line: identity.line,
      byte_offset: identity.byteOffset,
      raw_sha256: identity.rawSha256,
      event_key: identity.eventKey,
      target_run_id: identity.targetRunId,
      preimage_prefix_sha256: identity.preimagePrefixSha256,
      owner: "codex",
      reason
    },
    workflow_run_id: RUN_ID,
    journal_key: journalKey,
    idempotency_key: journalIdentity.idempotencyKey,
    owner: "codex",
    reason,
    ...overrides
  };
}

function incidentEvent(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    ts: "2026-08-07T00:00:00.000Z",
    schema_version: "1.0.0",
    skill: "kiwi-wave-master",
    run_id: "wave3-r4-audit",
    target: "wave-3",
    status: "CORRECTION",
    summary: "R4 audit conclusion retained as historical evidence",
    next_hint: "kiwi-pm",
    artifacts: { spec_files: [], plan_file: null, sidecar_file: null, analysis_dir: "docs/memory" },
    dry_run: false,
    req_ids: ["REL-BGSTAB-007"],
    notes: "This is an audit annotation, not a correction edge.",
    ...overrides
  };
}

function identityFor(text: string, raw: string, relativePath = PIPELINE_PATH, recordType: RecordType = "pipeline"): TargetIdentity {
  const byteOffset = Buffer.byteLength(text.slice(0, text.indexOf(raw)), "utf8");
  const event = JSON.parse(raw) as { skill: string; run_id: string };
  return {
    path: relativePath,
    recordType,
    line: text.slice(0, text.indexOf(raw)).split("\n").length,
    byteOffset,
    rawSha256: sha256(Buffer.from(raw, "utf8")),
    eventKey: `${event.skill}|${event.run_id}`,
    targetRunId: event.run_id,
    preimagePrefixSha256: sha256(text)
  };
}

function reclassificationInput(identity: TargetIdentity, overrides: Partial<ReclassificationInput> = {}): ReclassificationInput {
  return {
    kind: "workflow_record_reclassification",
    owner: "codex",
    reason: "Reclassify the exact targetless correction as an audit annotation",
    runId: RUN_ID,
    expectedSha256: identity.preimagePrefixSha256,
    dryRun: true,
    jsonlPath: identity.path,
    ...identity,
    ...overrides
  };
}

async function applyReclassification(root: string, input: ReclassificationInput): Promise<ReclassificationResult> {
  return applyWorkflowMutation({ root }, input as unknown as WorkflowMutationInput) as unknown as ReclassificationResult;
}

async function incidentFixture(lineTerminator = "\n", prefixLines: Record<string, unknown>[] = []): Promise<{
  root: string;
  raw: string;
  before: string;
  identity: TargetIdentity;
}> {
  const root = await tempRoot();
  const raw = JSON.stringify(incidentEvent());
  const lines = [...prefixLines.map((entry) => JSON.stringify(entry)), raw];
  const before = `${lines.join(lineTerminator)}${lineTerminator}`;
  await write(root, PIPELINE_PATH, before);
  return { root, raw, before, identity: identityFor(before, raw) };
}

async function workspaceTree(root: string): Promise<string[]> {
  return (await readdir(root, { recursive: true })).map((entry) => entry.replace(/\\/g, "/")).sort();
}

async function artifactLockResidue(root: string, lockPath: string): Promise<string[]> {
  const relativeLockPath = path.relative(root, lockPath).replace(/\\/g, "/");
  return (await workspaceTree(root)).filter(
    (entry) =>
      entry === relativeLockPath ||
      entry === `${relativeLockPath}.acquire` ||
      entry.startsWith(`${relativeLockPath}.stale-`)
  );
}

function objectValue(value: unknown): Record<string, unknown> {
  expect(value).toBeTypeOf("object");
  expect(value).not.toBeNull();
  return value as Record<string, unknown>;
}

function stringArray(value: unknown): string[] {
  expect(Array.isArray(value)).toBe(true);
  return value as string[];
}

function resultValue(result: ReclassificationResult): Record<string, unknown> {
  expect(result.ok).toBe(true);
  return objectValue(result.value);
}

function predictedOverlayBytes(result: ReclassificationResult): string {
  const mutation = objectValue(result.mutation);
  const preview = stringArray(mutation.preview);
  expect(preview).toHaveLength(1);
  expect(preview[0]).not.toContain("\n");
  return `${preview[0]}\n`;
}

// @req FR-NODE-177
describe("FR-NODE-177 append-only workflow record reclassification", () => {
  it("AC-1/3/8/9 recognizes the exact targetless-CORRECTION incident through a parser pre-pass", async () => {
    const { root, raw, before, identity } = await incidentFixture();
    const overlay = durableOverlay(identity);
    expect(overlay.journal_key).toMatch(/^[a-f0-9]{64}$/);
    expect(overlay.idempotency_key).toBe(overlay.journal_key);
    await write(root, PIPELINE_PATH, `${before}${JSON.stringify(overlay)}\n`);

    const parsed = await jsonlModule.parseWorkflowJsonl({ root }, PIPELINE_PATH);

    expect(parsed.diagnostics).not.toContainEqual(
      expect.objectContaining({ code: "SRS-W054", filePath: PIPELINE_PATH, line: identity.line })
    );
    expect(parsed.entries).toHaveLength(2);
    expect(parsed.tail.map((entry) => entry.raw)).toEqual([raw, JSON.stringify(overlay)]);
    expect(parsed.entries[0]).toMatchObject({
      raw,
      recordClass: "meta",
      effectiveRecordClass: "audit_note",
      reclassifiedBy: expect.any(String)
    });
    expect(parsed.latestEntries).toEqual([]);
    expect(parsed.entries.every((entry) => entry.correctedBy === undefined)).toBe(true);
  });

  it.each(["\n", "\r\n", ""])("AC-3 binds exact bytes for %s-terminated target lines", async (terminator) => {
    const root = await tempRoot();
    const raw = JSON.stringify(incidentEvent({ summary: "한글 UTF-8 identity" }));
    const before = `${raw}${terminator}`;
    await write(root, PIPELINE_PATH, before);
    const identity = identityFor(before, raw);

    const preview = await applyReclassification(root, reclassificationInput(identity));
    const value = resultValue(preview);

    expect(value.written).toBe(false);
    expect(value.targetRecord).toMatchObject(identity);
    expect(value.pendingRepair).toMatchObject({ kind: "record_reclassification", target: identity });
    expect(await read(root, PIPELINE_PATH)).toBe(before);
  });

  it.each([
    ["line", (identity: TargetIdentity) => ({ ...identity, line: identity.line + 1 })],
    ["byteOffset", (identity: TargetIdentity) => ({ ...identity, byteOffset: identity.byteOffset + 1 })],
    ["rawSha256", (identity: TargetIdentity) => ({ ...identity, rawSha256: "0".repeat(64) })],
    ["eventKey", (identity: TargetIdentity) => ({ ...identity, eventKey: `${identity.eventKey}-other` })],
    ["targetRunId", (identity: TargetIdentity) => ({ ...identity, targetRunId: `${identity.targetRunId}-other` })],
    ["preimagePrefixSha256", (identity: TargetIdentity) => ({ ...identity, preimagePrefixSha256: "f".repeat(64) })]
  ] as const)("AC-3 rejects a mismatched %s identity field without writing", async (_field, mutate) => {
    const { root, before, identity } = await incidentFixture();

    const result = await applyReclassification(root, reclassificationInput(mutate(identity)));

    expect(result).toMatchObject({ ok: false, mutation: { written: false } });
    expect(result.diagnostics).not.toContainEqual(expect.objectContaining({ code: "SRS-E071" }));
    expect(JSON.stringify(result)).toContain(_field);
    expect(await read(root, PIPELINE_PATH)).toBe(before);
  });

  it.each([
    ["sourcePath", "source_path", "kiwi/other-pipeline.jsonl"],
    ["recordType", "record_type", "worklog"],
    ["line", "source_line", 99],
    ["byteOffset", "byte_offset", 99],
    ["rawSha256", "raw_sha256", "0".repeat(64)],
    ["eventKey", "event_key", "kiwi-wave-master|other"],
    ["targetRunId", "target_run_id", "other"],
    ["preimagePrefixSha256", "preimage_prefix_sha256", "f".repeat(64)]
  ])("AC-3 parser refuses an overlay whose %s does not exactly match", async (_field, operationField, mismatchedValue) => {
    const { root, before, identity } = await incidentFixture();
    const overlay = durableOverlay(identity) as { operation: Record<string, unknown> };
    overlay.operation[operationField] = mismatchedValue;
    await write(root, PIPELINE_PATH, `${before}${JSON.stringify(overlay)}\n`);

    const parsed = await jsonlModule.parseWorkflowJsonl({ root }, PIPELINE_PATH);

    expect(parsed.diagnostics).toContainEqual(
      expect.objectContaining({ code: "SRS-W054", filePath: PIPELINE_PATH, line: identity.line })
    );
    expect(parsed.latestEntries).toEqual([]);
    expect(parsed.entries[0]).not.toHaveProperty("effectiveRecordClass", "audit_note");
  });

  it.each([
    ["a non-derived run_id", "run_id", "record-reclassification-wrong"],
    ["a missing ts", "ts", undefined],
    ["a non-ISO ts", "ts", "not-an-iso-timestamp"],
    ["a blank workflow_run_id", "workflow_run_id", "   "],
    ["a non-string task_id", "task_id", 7],
    ["a blank task_id", "task_id", "   "],
    ["a non-string req_id", "req_id", { invalid: true }],
    ["a blank req_id", "req_id", "   "]
  ] as const)("AC-1/9 parser rejects an overlay with %s", async (_case, field, value) => {
    const { root, before, identity } = await incidentFixture();
    const overlay = durableOverlay(identity);
    if (value === undefined) delete overlay[field];
    else overlay[field] = value;
    await write(root, PIPELINE_PATH, `${before}${JSON.stringify(overlay)}\n`);

    const parsed = await jsonlModule.parseWorkflowJsonl({ root }, PIPELINE_PATH);

    expect(parsed.diagnostics).toContainEqual(
      expect.objectContaining({ code: "SRS-W054", filePath: PIPELINE_PATH, line: identity.line })
    );
    expect(parsed.latestEntries).toEqual([]);
    expect(parsed.entries[0]).not.toHaveProperty("effectiveRecordClass", "audit_note");
  });

  it("AC-5/7/9 parser rejects duplicate otherwise-valid overlays for one target", async () => {
    const { root, before, identity } = await incidentFixture();
    const overlay = JSON.stringify(durableOverlay(identity));
    await write(root, PIPELINE_PATH, `${before}${overlay}\n${overlay}\n`);

    const parsed = await jsonlModule.parseWorkflowJsonl({ root }, PIPELINE_PATH);

    expect(parsed.diagnostics).toContainEqual(
      expect.objectContaining({ code: "SRS-W054", filePath: PIPELINE_PATH, line: identity.line })
    );
    expect(parsed.latestEntries).toEqual([]);
    expect(parsed.entries[0]).not.toHaveProperty("effectiveRecordClass", "audit_note");
  });

  it("AC-1/9 parser rejects a different otherwise-valid ISO timestamp", async () => {
    const { root, before, identity } = await incidentFixture();
    const overlay = durableOverlay(identity, { ts: "2026-08-07T00:01:00.000Z" });
    await write(root, PIPELINE_PATH, `${before}${JSON.stringify(overlay)}\n`);

    const parsed = await jsonlModule.parseWorkflowJsonl({ root }, PIPELINE_PATH);

    expect(parsed.diagnostics).toContainEqual(
      expect.objectContaining({ code: "SRS-W054", filePath: PIPELINE_PATH, line: identity.line })
    );
    expect(parsed.entries[0]).not.toHaveProperty("effectiveRecordClass", "audit_note");
  });

  it("AC-2 uses the official resolver and rejects a path-kind mismatch without writing", async () => {
    const root = await tempRoot();
    const relativePath = ".kiwi/sessions/run-a/worklog.jsonl";
    const raw = JSON.stringify(incidentEvent({ run_id: "worklog-a" }));
    const before = `${raw}\n`;
    await write(root, relativePath, before);
    const identity = identityFor(before, raw, relativePath, "pipeline");

    const result = await applyReclassification(root, reclassificationInput(identity));

    expect(result).toMatchObject({
      ok: false,
      mutation: { written: false },
      diagnostics: [
        expect.objectContaining({
          code: "SRS-E071",
          details: expect.objectContaining({ path: relativePath, requestedKind: "pipeline", actualKind: "worklog" })
        })
      ]
    });
    expect(await read(root, relativePath)).toBe(before);
  });

  it.each([
    ["unknown", "kiwi/not-a-workflow-artifact.jsonl", "SRS-E071"],
    ["legacy", "docs/plan/pipeline.jsonl", "SRS-E071"],
    ["outside-root", "../outside-pipeline.jsonl", "SRS-E050"]
  ])("AC-2 rejects an %s artifact selector before mutation", async (_boundary, relativePath, diagnosticCode) => {
    const root = await tempRoot();
    const raw = JSON.stringify(incidentEvent({ run_id: `${_boundary}-target` }));
    const before = `${raw}\n`;
    if (!relativePath.startsWith("..")) await write(root, relativePath, before);
    const identity = identityFor(before, raw, relativePath, "pipeline");

    const result = await applyReclassification(root, reclassificationInput(identity));

    expect(result).toMatchObject({
      ok: false,
      mutation: { written: false },
      diagnostics: [
        expect.objectContaining({
          code: diagnosticCode,
          details: expect.objectContaining(
            _boundary === "outside-root" ? { path: relativePath } : { path: relativePath, reason: _boundary }
          )
        })
      ]
    });
    if (!relativePath.startsWith("..")) expect(await read(root, relativePath)).toBe(before);
  });

  it("AC-2 rejects ambiguous official resolver candidates", async () => {
    const root = await tempRoot();
    const raw = JSON.stringify(incidentEvent());
    const before = `${raw}\n`;
    const leftPath = ".kiwi/sessions/left/pipeline.jsonl";
    const rightPath = ".kiwi/sessions/right/pipeline.jsonl";
    await write(root, leftPath, before);
    await write(root, rightPath, before);
    const sameTime = new Date("2026-08-07T00:00:00.000Z");
    await utimes(path.join(root, leftPath), sameTime, sameTime);
    await utimes(path.join(root, rightPath), sameTime, sameTime);
    const resolution = await resolveWorkflowArtifacts({ root }, { kind: "pipeline", allowAmbiguous: false });
    expect(resolution.selected).toBeNull();
    expect(resolution.candidates.slice(0, 2).map((candidate) => ({ path: candidate.relativePath, score: candidate.score, mtimeMs: candidate.mtimeMs }))).toEqual([
      { path: leftPath, score: resolution.candidates[0]?.score, mtimeMs: sameTime.getTime() },
      { path: rightPath, score: resolution.candidates[0]?.score, mtimeMs: sameTime.getTime() }
    ]);
    expect(resolution.diagnostics).toContainEqual(expect.objectContaining({ code: "SRS-E051" }));
    const input = reclassificationInput(identityFor(before, raw, leftPath));
    delete (input as Partial<ReclassificationInput>).path;
    delete (input as Partial<ReclassificationInput>).jsonlPath;

    const result = await applyReclassification(root, input);

    expect(result).toMatchObject({ ok: false, mutation: { written: false } });
    expect(result.diagnostics).not.toContainEqual(expect.objectContaining({ code: "SRS-E071" }));
    expect(JSON.stringify(result)).toMatch(/ambiguous|SRS-E051/i);
    expect(await read(root, leftPath)).toBe(before);
    expect(await read(root, rightPath)).toBe(before);
  });

  it("AC-2 normalizes a safe root-relative selector and reports the normalized identity", async () => {
    const { root, before, identity } = await incidentFixture();
    const input = reclassificationInput({ ...identity, path: "kiwi/./pipeline.jsonl" });

    const preview = await applyReclassification(root, input);
    const value = resultValue(preview);

    expect(value.targetRecord.path).toBe(PIPELINE_PATH);
    expect(await read(root, PIPELINE_PATH)).toBe(before);
  });

  it("AC-4 dry-run returns one typed pendingRepair and token while writing no byte", async () => {
    const { root, before, identity } = await incidentFixture();

    const preview = await applyReclassification(root, reclassificationInput(identity));
    const value = resultValue(preview);

    expect(value).toMatchObject({
      written: false,
      journalState: "skipped_dry_run",
      repairToken: expect.any(String),
      pendingRepair: { kind: "record_reclassification", target: identity }
    });
    expect(value.pendingOperations.some((operation: string) => /write/i.test(operation))).toBe(true);
    expect(value.operations ?? preview.mutation?.operations).toHaveLength(1);
    const overlayBytes = predictedOverlayBytes(preview);
    const predicted = JSON.parse(overlayBytes) as Record<string, unknown>;
    const pendingRepair = objectValue(value.pendingRepair);
    expect(predicted).toMatchObject({
      schema_version: "1.0.0",
      skill: "speckiwi",
      event: "record_reclassification",
      run_id: expect.any(String),
      ts: expect.stringMatching(/Z$/),
      workflow_run_id: RUN_ID,
      journal_key: expect.stringMatching(/^[a-f0-9]{64}$/),
      idempotency_key: expect.stringMatching(/^[a-f0-9]{64}$/),
      operation: expect.objectContaining({ owner: "codex", reason: reclassificationInput(identity).reason })
    });
    expect(predicted.idempotency_key).toBe(predicted.journal_key);
    expect(pendingRepair).toMatchObject({
      target: identity,
      overlayEventKey: `${String(predicted.skill)}|${String(predicted.run_id)}`,
      overlayRunId: predicted.run_id,
      overlayTimestamp: predicted.ts,
      overlaySha256: sha256(overlayBytes)
    });
    expect(await read(root, PIPELINE_PATH)).toBe(before);
  });

  it("AC-4 dry-run creates no transient lock, guard, quarantine, or sentinel artifact", async () => {
    const { root, identity } = await incidentFixture();
    const beforeTree = await workspaceTree(root);
    const observedEvents: string[] = [];
    const acquireSpy = vi.spyOn(artifactLockModule, "acquireArtifactLock");
    // The module seam is decisive; tree and watcher evidence additionally catch unknown artifacts.
    const watcher = watch(root, { recursive: true }, (_eventType, filename) => {
      if (filename) observedEvents.push(String(filename).replace(/\\/g, "/"));
    });

    try {
      const preview = await applyReclassification(root, reclassificationInput(identity));
      expect(preview).toMatchObject({ ok: true, value: { written: false } });
      expect(acquireSpy).not.toHaveBeenCalled();
    } finally {
      watcher.close();
      acquireSpy.mockRestore();
    }

    expect(await workspaceTree(root)).toEqual(beforeTree);
    expect(observedEvents.filter((entry) => /lock|guard|quarantine|sentinel/i.test(entry))).toEqual([]);
  });

  it("AC-4 rejects a tampered token and a token reused with changed bound input", async () => {
    const { root, before, identity } = await incidentFixture();
    const previewValue = resultValue(await applyReclassification(root, reclassificationInput(identity)));

    const tampered = await applyReclassification(
      root,
      reclassificationInput(identity, { dryRun: false, repairToken: `${previewValue.repairToken}tampered` })
    );
    expect(tampered).toMatchObject({ ok: false, mutation: { written: false } });
    expect(await read(root, PIPELINE_PATH)).toBe(before);

    const changedInput = await applyReclassification(
      root,
      reclassificationInput(identity, {
        dryRun: false,
        repairToken: previewValue.repairToken,
        reason: "A different reason is not the token-bound pending repair"
      })
    );
    expect(changedInput).toMatchObject({ ok: false, mutation: { written: false } });
    expect(await read(root, PIPELINE_PATH)).toBe(before);

    for (const changed of [
      { line: identity.line + 1 },
      { idempotencyKey: "a".repeat(64) },
      { owner: "different-owner" }
    ]) {
      const changedBoundField = await applyReclassification(
        root,
        reclassificationInput(identity, { ...changed, dryRun: false, repairToken: String(previewValue.repairToken) })
      );
      expect(changedBoundField).toMatchObject({ ok: false, mutation: { written: false } });
      expect(await read(root, PIPELINE_PATH)).toBe(before);
    }
  });

  it("AC-1/4 accepts a supplied idempotencyKey exactly equal to the derived FR-NODE-028 canonical journal key", async () => {
    const baseline = await incidentFixture();
    const reason = "Reclassify the exact targetless correction as an audit annotation";
    const baselinePreview = await applyReclassification(
      baseline.root,
      reclassificationInput(baseline.identity, { reason })
    );
    const baselineValue = resultValue(baselinePreview);
    const canonicalKey = String(baselineValue.journalKey);
    expect(await read(baseline.root, PIPELINE_PATH)).toBe(baseline.before);

    const suppliedFixture = await incidentFixture();
    expect(suppliedFixture.identity).toEqual(baseline.identity);
    const previewInput = reclassificationInput(suppliedFixture.identity, { reason, idempotencyKey: canonicalKey });

    const preview = await applyReclassification(suppliedFixture.root, previewInput);
    const previewValue = resultValue(preview);
    const predictedBytes = predictedOverlayBytes(preview);
    const predicted = JSON.parse(predictedBytes) as Record<string, unknown>;

    expect(canonicalKey).toMatch(/^[a-f0-9]{64}$/);
    expect(previewValue.idempotencyKey).toBe(canonicalKey);
    expect(previewValue.journalKey).toBe(canonicalKey);
    expect(predicted.journal_key).toBe(canonicalKey);
    expect(predicted.idempotency_key).toBe(canonicalKey);
    expect(await read(suppliedFixture.root, PIPELINE_PATH)).toBe(suppliedFixture.before);

    const applied = await applyReclassification(
      suppliedFixture.root,
      reclassificationInput(suppliedFixture.identity, {
        reason,
        idempotencyKey: canonicalKey,
        dryRun: false,
        repairToken: String(previewValue.repairToken)
      })
    );
    const appliedValue = resultValue(applied);
    expect(appliedValue).toMatchObject({ written: true, journalKey: canonicalKey, idempotencyKey: canonicalKey });
    expect((await read(suppliedFixture.root, PIPELINE_PATH)).slice(suppliedFixture.before.length)).toBe(predictedBytes);
  });

  it("AC-1/4/6 applies only the token-bound pendingRepair and appends the durable overlay with its exact provenance", async () => {
    const { root, before, identity } = await incidentFixture();
    const preview = await applyReclassification(root, reclassificationInput(identity));
    const previewValue = resultValue(preview);
    const expectedOverlayBytes = predictedOverlayBytes(preview);
    const predictedOverlay = JSON.parse(expectedOverlayBytes) as Record<string, unknown>;

    const applied = await applyReclassification(
      root,
      reclassificationInput(identity, { dryRun: false, repairToken: previewValue.repairToken })
    );
    const value = resultValue(applied);
    const after = await read(root, PIPELINE_PATH);
    const appended = JSON.parse(after.slice(before.length).trim()) as Record<string, unknown>;

    expect(value).toMatchObject({
      written: true,
      journalState: "confirmed",
      pendingRepair: null
    });
    expect(value.completedOperations.some((operation: string) => /write/i.test(operation))).toBe(true);
    expect(value.completedOperations.some((operation: string) => /confirm/i.test(operation))).toBe(true);
    expect(after.startsWith(before)).toBe(true);
    expect(after.endsWith("\n")).toBe(true);
    expect(after.slice(before.length)).toBe(expectedOverlayBytes);
    expect(appended).toEqual(predictedOverlay);
    expect(appended).toMatchObject({
      schema_version: "1.0.0",
      skill: "speckiwi",
      event: "record_reclassification",
      run_id: expect.any(String),
      ts: expect.stringMatching(/Z$/),
      recordClass: "meta",
      effectiveRecordClass: "audit_note",
      workflow_run_id: RUN_ID,
      owner: "codex",
      operation: expect.objectContaining({
        kind: "record_reclassification",
        record_type: "pipeline",
        source_path: identity.path,
        source_line: identity.line,
        byte_offset: identity.byteOffset,
        raw_sha256: identity.rawSha256,
        event_key: identity.eventKey,
        target_run_id: identity.targetRunId,
        preimage_prefix_sha256: identity.preimagePrefixSha256,
        owner: "codex",
        reason: reclassificationInput(identity).reason
      })
    });
    expect(appended.journal_key).toMatch(/^[a-f0-9]{64}$/);
    expect(appended.idempotency_key).toBe(appended.journal_key);
    expect(appended).not.toHaveProperty("status");
    expect(appended).not.toHaveProperty("corrects_run_id");
  });

  it("AC-5 confirms exact replay before rejecting the now-stale preimage", async () => {
    const { root, identity } = await incidentFixture();
    const previewValue = resultValue(await applyReclassification(root, reclassificationInput(identity)));
    const applyInput = reclassificationInput(identity, { dryRun: false, repairToken: previewValue.repairToken });
    const first = await applyReclassification(root, applyInput);
    expect(resultValue(first).written).toBe(true);

    const replay = await applyReclassification(root, applyInput);

    expect(replay).toMatchObject({
      ok: true,
      value: {
        written: false,
        journalState: "confirmed",
        pendingRepair: null
      },
      mutation: { written: false, operations: [] }
    });
    expect(replay.value?.completedOperations.some((operation: string) => /confirm/i.test(operation))).toBe(true);
  });

  it("AC-5 validates a missing or tampered repairToken before durable exact replay", async () => {
    const { root, identity } = await incidentFixture();
    const previewValue = resultValue(await applyReclassification(root, reclassificationInput(identity)));
    const validInput = reclassificationInput(identity, { dryRun: false, repairToken: previewValue.repairToken });
    expect(resultValue(await applyReclassification(root, validInput)).written).toBe(true);
    const durableBytes = await read(root, PIPELINE_PATH);
    const missingToken = { ...validInput };
    delete missingToken.repairToken;

    for (const input of [missingToken, { ...validInput, repairToken: `${previewValue.repairToken}-tampered` }]) {
      const rejected = await applyReclassification(root, input);
      expect(rejected).toMatchObject({ ok: false, mutation: { written: false } });
      expect(JSON.stringify(rejected)).toMatch(/repairToken/i);
      expect(await read(root, PIPELINE_PATH)).toBe(durableBytes);
    }

    const replay = await applyReclassification(root, validInput);
    expect(replay).toMatchObject({ ok: true, value: { written: false, journalState: "confirmed" } });
    expect(await read(root, PIPELINE_PATH)).toBe(durableBytes);
  });

  it("AC-5 reports an appended heartbeat after preview as a stale patch without changing durable bytes", async () => {
    const { root, identity } = await incidentFixture();
    const previewValue = resultValue(await applyReclassification(root, reclassificationInput(identity)));
    const heartbeat = JSON.stringify({
      schema_version: "1.0.0",
      skill: "kiwi-pm",
      run_id: "heartbeat-after-record-reclassification-preview",
      status: "TASK_DONE"
    });
    await appendFile(path.join(root, PIPELINE_PATH), `${heartbeat}\n`, "utf8");
    const afterHeartbeat = await read(root, PIPELINE_PATH);

    const result = await applyReclassification(
      root,
      reclassificationInput(identity, { dryRun: false, repairToken: previewValue.repairToken })
    );

    expect(result).toMatchObject({
      ok: false,
      error: { code: "STALE_PATCH" },
      mutation: { written: false, journalState: "failed" }
    });
    expect(result.diagnostics.map((item) => item.code)).toEqual(["SRS-E032"]);
    expect(await read(root, PIPELINE_PATH)).toBe(afterHeartbeat);
  });

  it("AC-5 rejects a historical boundary preimage paired with the current expectedSha during preview", async () => {
    const { root, identity } = await incidentFixture();
    const heartbeat = `${JSON.stringify({
      schema_version: "1.0.0",
      skill: "kiwi-pm",
      run_id: "heartbeat-before-current-cas-reclassification",
      status: "TASK_DONE"
    })}\n`;
    await appendFile(path.join(root, PIPELINE_PATH), heartbeat, "utf8");
    const currentBytes = await read(root, PIPELINE_PATH);
    const currentSha256 = sha256(currentBytes);

    const preview = await applyReclassification(
      root,
      reclassificationInput(identity, { expectedSha256: currentSha256 })
    );

    expect(preview).toMatchObject({ ok: false, mutation: { written: false, operations: [] } });
    expect(preview.diagnostics.map((item) => item.code)).toEqual(["SRS-E072"]);
    expect(preview.value).toBeUndefined();
    expect(await read(root, PIPELINE_PATH)).toBe(currentBytes);
  });

  it("AC-5 rejects duplicate target identity before producing a repair token", async () => {
    const root = await tempRoot();
    const raw = JSON.stringify(incidentEvent());
    const before = `${raw}\n${raw}\n`;
    await write(root, PIPELINE_PATH, before);
    const identity = identityFor(before, raw);

    const result = await applyReclassification(root, reclassificationInput(identity));

    expect(result).toMatchObject({ ok: false, mutation: { written: false } });
    expect(JSON.stringify(result)).toMatch(/duplicate|ambiguous/i);
    expect(await read(root, PIPELINE_PATH)).toBe(before);
  });

  it("AC-5 rejects a non-identical pre-existing overlay for the same target", async () => {
    const { root, before, identity } = await incidentFixture();
    const conflicting = durableOverlay(identity, { reason: "Existing conflicting classification", effectiveRecordClass: "audit_note" });
    const conflictedJournal = `${before}${JSON.stringify(conflicting)}\n`;
    await write(root, PIPELINE_PATH, conflictedJournal);

    const result = await applyReclassification(root, reclassificationInput(identity));

    expect(result).toMatchObject({ ok: false, mutation: { written: false } });
    expect(JSON.stringify(result)).toMatch(/conflict|non-identical/i);
    expect(await read(root, PIPELINE_PATH)).toBe(conflictedJournal);
  });

  it("AC-6 reports append-complete authoritative-readback failure without claiming written or confirmed", async () => {
    const { root, identity } = await incidentFixture();
    const previewValue = resultValue(await applyReclassification(root, reclassificationInput(identity)));
    const realParse = jsonlModule.parseWorkflowJsonl;
    const parseSpy = vi.spyOn(jsonlModule, "parseWorkflowJsonl").mockImplementation(async (...args) => {
      const parsed = await realParse(...args);
      if (parsed.entries.some((entry) => entry.event.event === "record_reclassification")) {
        return {
          ...parsed,
          diagnostics: [
            ...parsed.diagnostics,
            {
              code: "SRS-W052",
              severity: "warning",
              message: "Injected authoritative read-back failure",
              filePath: PIPELINE_PATH
            }
          ]
        };
      }
      return parsed;
    });

    try {
      const result = await applyReclassification(
        root,
        reclassificationInput(identity, { dryRun: false, repairToken: previewValue.repairToken })
      );
      const durableBytes = await read(root, PIPELINE_PATH);
      const previewPendingRepair = objectValue(previewValue.pendingRepair);

      expect(result).toMatchObject({
        ok: false,
        mutation: {
          written: false,
          journalState: "failed"
        }
      });
      expect(result.mutation?.pendingRepair).toEqual({
        kind: "record_reclassification_confirmation",
        artifact: { relativePath: PIPELINE_PATH, postAppendSha256: sha256(durableBytes) },
        targetRecord: identity,
        overlayEventKey: previewPendingRepair.overlayEventKey,
        retry: { action: "retry_same_record_reclassification", mode: "confirm_only" }
      });
      expect(result.mutation?.completedOperations.some((operation: string) => /write/i.test(operation))).toBe(true);
      expect(result.mutation?.pendingOperations.some((operation: string) => /confirm/i.test(operation))).toBe(true);
      expect(durableBytes).toContain('"event":"record_reclassification"');
    } finally {
      parseSpy.mockRestore();
    }
  });

  it("AC-6 retains a failed owner cleanup capability and consumes it before exact replay", async () => {
    const { root, identity } = await incidentFixture();
    const expectedLockIdentity = await artifactLockModule.resolveArtifactLockIdentity(path.join(root, PIPELINE_PATH));
    const expectedRelativeLockPath = path.relative(root, expectedLockIdentity.lockPath).replace(/\\/g, "/");
    const previewValue = resultValue(await applyReclassification(root, reclassificationInput(identity)));
    const input = reclassificationInput(identity, { dryRun: false, repairToken: previewValue.repairToken });
    const realRelease = artifactLockModule.releaseArtifactLock;
    let retainedCapability: Parameters<typeof artifactLockModule.releaseArtifactLock>[0] | undefined;
    const cleanupDiagnostic = {
      code: "EACCES",
      message: "Injected owner-verified artifact lock cleanup failure"
    };
    const releaseSpy = vi.spyOn(artifactLockModule, "releaseArtifactLock").mockImplementationOnce(async (capability) => {
      retainedCapability = capability;
      return { ok: false, reason: "cleanup_failed", cleanupDiagnostic };
    });
    const retrySpy = vi.spyOn(artifactLockModule, "retryRetainedArtifactLockCleanup").mockImplementation(async (canonicalPath) => {
      expect(retainedCapability).toBeDefined();
      expect(canonicalPath).toBe(retainedCapability!.canonicalPath);
      const result = await realRelease(retainedCapability!);
      if (result.ok && result.released) retainedCapability = undefined;
      return result;
    });

    try {
      const failedCleanup = await applyReclassification(root, input);
      const durableBytes = await read(root, PIPELINE_PATH);
      expect(releaseSpy).toHaveBeenCalledTimes(1);
      expect(retainedCapability).toMatchObject({
        ...expectedLockIdentity,
        ownerIdentitySha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        token: expect.any(String)
      });
      expect(failedCleanup).toMatchObject({
        ok: false,
        mutation: {
          written: false,
          journalState: "failed",
          completedOperations: expect.arrayContaining([
            expect.stringMatching(/write/i),
            expect.stringMatching(/confirm/i)
          ]),
          pendingOperations: [expect.stringMatching(/cleanup/i)]
        }
      });
      expect(failedCleanup.mutation?.pendingRepair).toEqual({
        kind: "record_reclassification_lock_cleanup",
        artifact: { relativePath: PIPELINE_PATH, postAppendSha256: sha256(durableBytes) },
        lock: {
          relativePath: expectedRelativeLockPath,
          ownerIdentitySha256: retainedCapability!.ownerIdentitySha256
        },
        cleanupDiagnostic,
        retry: { action: "retry_same_record_reclassification", mode: "cleanup_then_replay" }
      });

      const replay = await applyReclassification(root, input);

      expect(retrySpy).toHaveBeenCalledTimes(1);
      expect(retainedCapability).toBeUndefined();
      expect(replay).toMatchObject({
        ok: true,
        value: { written: false, journalState: "confirmed", pendingRepair: null },
        mutation: { written: false, operations: [] }
      });
      const parsed = await jsonlModule.parseWorkflowJsonl({ root }, PIPELINE_PATH);
      expect(parsed.entries.filter((entry) => entry.event.event === "record_reclassification")).toHaveLength(1);
      expect(await artifactLockResidue(root, expectedLockIdentity.lockPath)).toEqual([]);
    } finally {
      releaseSpy.mockRestore();
      retrySpy.mockRestore();
      if (retainedCapability) await realRelease(retainedCapability);
    }
  });

  it.each([
    ["missing repairToken", (valid: ReclassificationInput) => {
      const changed = { ...valid };
      delete changed.repairToken;
      return changed;
    }],
    ["tampered repairToken", (valid: ReclassificationInput) => ({ ...valid, repairToken: `${valid.repairToken}-tampered` })],
    ["different reclassification request", (valid: ReclassificationInput) => ({ ...valid, reason: `${valid.reason} changed` })]
  ] as const)("AC-6 does not consume retained cleanup authority for a %s", async (_case, wrongInput) => {
    const { root, identity } = await incidentFixture();
    const previewValue = resultValue(await applyReclassification(root, reclassificationInput(identity)));
    const validInput = reclassificationInput(identity, { dryRun: false, repairToken: String(previewValue.repairToken) });
    const realRelease = artifactLockModule.releaseArtifactLock;
    let retainedCapability: Parameters<typeof artifactLockModule.releaseArtifactLock>[0] | undefined;
    const releaseSpy = vi.spyOn(artifactLockModule, "releaseArtifactLock").mockImplementationOnce(async (capability) => {
      retainedCapability = capability;
      return {
        ok: false,
        reason: "cleanup_failed",
        cleanupDiagnostic: { code: "EACCES", message: "Injected retained cleanup authority" }
      };
    });
    const retrySpy = vi.spyOn(artifactLockModule, "retryRetainedArtifactLockCleanup").mockImplementation(async () => {
      expect(retainedCapability).toBeDefined();
      const cleanup = await realRelease(retainedCapability!);
      if (cleanup.ok && cleanup.released) retainedCapability = undefined;
      return cleanup;
    });

    try {
      await applyReclassification(root, validInput);
      expect(retainedCapability).toBeDefined();

      const rejected = await applyReclassification(root, wrongInput(validInput));

      expect(rejected).toMatchObject({ ok: false, mutation: { written: false } });
      expect(retrySpy, "an unrelated or invalid retry must not touch the retained registry").not.toHaveBeenCalled();
      expect(retainedCapability, "the valid owner capability must remain available").toBeDefined();

      const replay = await applyReclassification(root, validInput);
      expect(retrySpy).toHaveBeenCalledTimes(1);
      expect(retainedCapability).toBeUndefined();
      expect(replay).toMatchObject({ ok: true, value: { written: false, journalState: "confirmed" } });
    } finally {
      releaseSpy.mockRestore();
      retrySpy.mockRestore();
      if (retainedCapability) await realRelease(retainedCapability);
    }
  });

  it.each(["EACCES", "EIO"] as const)("AC-7 preserves a traceable %s artifact-lock acquisition failure", async (code) => {
    const { root, identity } = await incidentFixture();
    const previewValue = resultValue(await applyReclassification(root, reclassificationInput(identity)));
    const error = Object.assign(new Error(`Injected ${code} artifact-lock acquisition failure`), { code });
    const acquireSpy = vi.spyOn(artifactLockModule, "acquireArtifactLock").mockRejectedValueOnce(error);

    try {
      const result = await applyReclassification(
        root,
        reclassificationInput(identity, { dryRun: false, repairToken: String(previewValue.repairToken) })
      );
      expect(result).toMatchObject({ ok: false, mutation: { written: false } });
      expect(result.diagnostics).toEqual([{
        code: "SRS-E075",
        severity: "error",
        message: "Workflow artifact lock acquisition failed",
        filePath: PIPELINE_PATH,
        details: {
          operation: "acquire",
          code,
          message: error.message
        }
      }]);
      expect(JSON.stringify(result)).not.toMatch(/lock is held|holderOwnerIdentitySha256/i);
    } finally {
      acquireSpy.mockRestore();
    }
  });

  it("AC-7 serializes identical concurrent applies into one writer and one confirmed replay", async () => {
    const { root, identity } = await incidentFixture();
    const previewValue = resultValue(await applyReclassification(root, reclassificationInput(identity)));
    const input = reclassificationInput(identity, { dryRun: false, repairToken: previewValue.repairToken });

    const results = await Promise.all([applyReclassification(root, input), applyReclassification(root, input)]);

    expect(results.every((result) => result.ok)).toBe(true);
    expect(results.map((result) => result.value?.written).sort()).toEqual([false, true]);
    const parsed = await jsonlModule.parseWorkflowJsonl({ root }, PIPELINE_PATH);
    expect(parsed.entries.filter((entry) => entry.event.event === "record_reclassification")).toHaveLength(1);
  });

  it("AC-7 permits at most one of two conflicting concurrent overlays", async () => {
    const { root, identity } = await incidentFixture();
    const leftPreview = resultValue(await applyReclassification(root, reclassificationInput(identity, { reason: "left" })));
    const rightPreview = resultValue(await applyReclassification(root, reclassificationInput(identity, { reason: "right" })));

    const results = await Promise.all([
      applyReclassification(root, reclassificationInput(identity, { reason: "left", dryRun: false, repairToken: leftPreview.repairToken })),
      applyReclassification(root, reclassificationInput(identity, { reason: "right", dryRun: false, repairToken: rightPreview.repairToken }))
    ]);

    expect(results.filter((result) => result.value?.written === true)).toHaveLength(1);
    expect(results.filter((result) => result.ok === false || result.value?.written === false)).toHaveLength(1);
    const parsed = await jsonlModule.parseWorkflowJsonl({ root }, PIPELINE_PATH);
    expect(parsed.entries.filter((entry) => entry.event.event === "record_reclassification")).toHaveLength(1);
  });

  it("AC-8 refuses an unrelated diagnostic and leaves both diagnostics and bytes isolated", async () => {
    const { root, raw, before, identity } = await incidentFixture("\n", [
      { schema_version: "9.9.9", skill: "kiwi-pm", run_id: "unrelated", status: "TASK_DONE" }
    ]);
    const result = await applyReclassification(root, reclassificationInput(identity));

    expect(result).toMatchObject({
      ok: false,
      mutation: { written: false },
      diagnostics: expect.arrayContaining([
        expect.objectContaining({ code: "SRS-W055" }),
        expect.objectContaining({ code: "SRS-W054", filePath: PIPELINE_PATH, line: identity.line })
      ])
    });
    expect(await read(root, PIPELINE_PATH)).toBe(before);
    expect(before).toContain(raw);
  });

  it("AC-8 parser removes only target W054 while preserving an unrelated diagnostic byte-for-byte in shape", async () => {
    const root = await tempRoot();
    const unrelated = JSON.stringify({ schema_version: "9.9.9", skill: "kiwi-pm", run_id: "unrelated", status: "TASK_DONE" });
    const raw = JSON.stringify(incidentEvent());
    const preimage = `${unrelated}\n${raw}\n`;
    const identity = identityFor(preimage, raw);
    await write(root, PIPELINE_PATH, `${preimage}${JSON.stringify(durableOverlay(identity))}\n`);

    const parsed = await jsonlModule.parseWorkflowJsonl({ root }, PIPELINE_PATH);

    expect(parsed.diagnostics).toEqual([
      expect.objectContaining({
        code: "SRS-W055",
        severity: "warning",
        filePath: PIPELINE_PATH,
        line: 1,
        details: { schema_version: "9.9.9", eventKey: "kiwi-pm|unrelated" }
      })
    ]);
    expect(parsed.diagnostics).not.toContainEqual(
      expect.objectContaining({ code: "SRS-W054", filePath: PIPELINE_PATH, line: identity.line })
    );
    expect(parsed.entries[0]?.raw).toBe(unrelated);
    expect(parsed.entries[1]?.raw).toBe(raw);
  });

  it.each([
    [
      "missing referenced event",
      [JSON.stringify(incidentEvent({ run_id: "missing-ref", corrects_run_id: "does-not-exist" }))],
      /target not found|missing referenced/i
    ],
    [
      "correction cycle",
      [
        JSON.stringify(incidentEvent({ run_id: "cycle-a", corrects_run_id: "cycle-b" })),
        JSON.stringify(incidentEvent({ run_id: "cycle-b", corrects_run_id: "cycle-a" }))
      ],
      /cycle/i
    ],
    [
      "correction depth",
      [
        JSON.stringify(incidentEvent({ run_id: "depth-base", status: "TASK_DONE" })),
        ...Array.from({ length: 7 }, (_, index) =>
          JSON.stringify(
            incidentEvent({
              run_id: `depth-${index + 1}`,
              corrects_run_id: index === 0 ? "depth-base" : `depth-${index}`
            })
          )
        )
      ],
      /depth/i
    ],
    ["invalid JSON", ["{not valid json"], /SRS-W052|invalid/i]
  ])("AC-8 refuses recovery when the journal also contains %s", async (_case, prefixLines, expectedReason) => {
    const root = await tempRoot();
    const raw = JSON.stringify(incidentEvent());
    const before = `${[...prefixLines, raw].join("\n")}\n`;
    await write(root, PIPELINE_PATH, before);
    const identity = identityFor(before, raw);

    const result = await applyReclassification(root, reclassificationInput(identity));

    expect(result).toMatchObject({ ok: false, mutation: { written: false } });
    expect(JSON.stringify(result)).toMatch(expectedReason);
    expect(await read(root, PIPELINE_PATH)).toBe(before);
  });

  it("AC-9/11 converges every public and derived core reader on the effective projection", async () => {
    const fixture = await createWorkflowFixture();
    const pipelineRaw = JSON.stringify(incidentEvent({ run_id: "pipeline-audit" }));
    const pipelineBefore = `${pipelineRaw}\n`;
    const pipelineIdentity = identityFor(pipelineBefore, pipelineRaw);
    await write(fixture.root, PIPELINE_PATH, `${pipelineBefore}${JSON.stringify(durableOverlay(pipelineIdentity))}\n`);

    const worklogPath = `.kiwi/sessions/${fixture.runId}/worklog.jsonl`;
    const worklogRaw = JSON.stringify(incidentEvent({ skill: "kiwi-pm", run_id: "worklog-audit", task_id: "T-001" }));
    const worklogBefore = `${worklogRaw}\n`;
    const worklogIdentity = identityFor(worklogBefore, worklogRaw, worklogPath, "worklog");
    await write(fixture.root, worklogPath, `${worklogBefore}${JSON.stringify(durableOverlay(worklogIdentity))}\n`);

    const validationOptions = { path: fixture.planPath, runId: fixture.runId };
    const readerResults: Array<[string, { diagnostics: Array<{ code: string; filePath?: string; line?: number }> }]> = [
      ["validateWorkflowArtifacts", await validateWorkflowArtifacts({ root: fixture.root }, validationOptions)],
      ["workflowNextPlanTask", await workflowNextPlanTask({ root: fixture.root }, validationOptions)],
      ["workflowDoctor", await workflowDoctor({ root: fixture.root }, validationOptions)],
      ["workflowDiff", await workflowDiff({ root: fixture.root }, validationOptions)],
      ["workflowSchemaCheck", await workflowSchemaCheck({ root: fixture.root }, validationOptions)],
      ["workflowPipelineStatus", await workflowPipelineStatus({ root: fixture.root })],
      ["workflowPipelineTail", await workflowPipelineTail({ root: fixture.root })],
      ["workflowPipelineNext", await workflowPipelineNext({ root: fixture.root })],
      ["workflowPipelineCompact", await workflowPipelineCompact({ root: fixture.root })],
      ["workflowWorklogTail", await workflowWorklogTail({ root: fixture.root }, { path: worklogPath, runId: fixture.runId })],
      ["workflowSessionStatus", await workflowSessionStatus({ root: fixture.root }, { runId: fixture.runId })],
      ["workflowResumeHint", await workflowResumeHint({ root: fixture.root }, validationOptions)],
      ["buildNextWorkOrder", await buildNextWorkOrder({ root: fixture.root }, { path: fixture.planPath, runId: fixture.runId, pipelinePath: PIPELINE_PATH })]
    ];

    for (const [name, result] of readerResults) {
      const targeted = result.diagnostics.filter(
        (item) =>
          item.code === "SRS-W054" &&
          ((item.filePath === PIPELINE_PATH && item.line === pipelineIdentity.line) ||
            (item.filePath === worklogPath && item.line === worklogIdentity.line))
      );
      expect(targeted, `${name} must remove only the reclassified target W054`).toEqual([]);
    }

    const pipelineStatus = await workflowPipelineStatus({ root: fixture.root });
    const pipelineTail = await workflowPipelineTail({ root: fixture.root });
    const pipelineNext = await workflowPipelineNext({ root: fixture.root });
    const pipelineCompact = await workflowPipelineCompact({ root: fixture.root });
    const worklogTail = await workflowWorklogTail({ root: fixture.root }, { path: worklogPath, runId: fixture.runId });
    expect(pipelineStatus.value.latestEvent).toBeNull();
    expect(pipelineNext.value.latestEvent).toBeNull();
    expect(pipelineCompact.value).toMatchObject({ latestEvent: null, active: 0 });
    expect(pipelineTail.value.events).toHaveLength(2);
    expect(worklogTail.value.events).toHaveLength(2);

    for (const [relativePath, identity] of [[PIPELINE_PATH, pipelineIdentity], [worklogPath, worklogIdentity]] as const) {
      const parsed = await jsonlModule.parseWorkflowJsonl({ root: fixture.root }, relativePath);
      expect(parsed.latestEntries).toEqual([]);
      expect(parsed.entries).toHaveLength(2);
      expect(parsed.entries[0]).toMatchObject({ effectiveRecordClass: "audit_note", recordClass: "meta" });
      expect(parsed.entries.every((entry) => entry.correctedBy === undefined)).toBe(true);
      expect(parsed.diagnostics).not.toContainEqual(
        expect.objectContaining({ code: "SRS-W054", filePath: relativePath, line: identity.line })
      );
    }
  });

  const invalidCorrectionTargets: Array<[string, unknown]> = [
    ["absent", undefined],
    ["null", null],
    ["number", 7],
    ["object", { run: "a" }],
    ["array", ["run-a"]],
    ["empty", ""],
    ["whitespace-only", " \t "]
  ];
  const genericKinds = ["pipeline_event_append", "worklog_event_append", "workflow_repair_record"] as const;

  it.each(genericKinds.flatMap((kind) => invalidCorrectionTargets.map(([label, target]) => [kind, label, target] as const)))(
    "AC-10 rejects %s CORRECTION with %s corrects_run_id before any mutation",
    async (kind, _label, target) => {
      const root = await tempRoot();
      const relativePath = kind === "worklog_event_append" ? ".kiwi/sessions/run-a/worklog.jsonl" : PIPELINE_PATH;
      await write(root, relativePath, "");
      const event: Record<string, unknown> = incidentEvent({ run_id: `${kind}-invalid` });
      if (target !== undefined) event.corrects_run_id = target;

      const result = await applyWorkflowMutation(
        { root },
        {
          kind,
          owner: "codex",
          runId: RUN_ID,
          jsonlPath: relativePath,
          event
        } as WorkflowMutationInput
      );

      expect(result).toMatchObject({ ok: false, mutation: { written: false } });
      expect(result.diagnostics.some((item) => /corrects_run_id|correction target/i.test(`${item.message} ${JSON.stringify(item.details ?? {})}`))).toBe(true);
      expect(await read(root, relativePath)).toBe("");
    }
  );

  it("AC-11 preserves logical-delete refusal for a CORRECTION source record", async () => {
    const { root, before, identity } = await incidentFixture();

    const result = await applyWorkflowMutation(
      { root },
      {
        kind: "workflow_logical_delete",
        owner: "kiwi-pm",
        runId: RUN_ID,
        jsonlPath: PIPELINE_PATH,
        recordType: "pipeline_event",
        recordId: identity.targetRunId
      }
    );

    expect(result).toMatchObject({ ok: false, mutation: { written: false } });
    expect(result.diagnostics.some((item) => /correction|tombstone/i.test(item.message))).toBe(true);
    expect(await read(root, PIPELINE_PATH)).toBe(before);
  });
});
