import { createHash } from "node:crypto";
import { mkdir, readFile, utimes, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { createTestMcpServer } from "../../src/mcp/adapter.js";
import { toolSchemas } from "../../src/mcp/server.js";
import { registerMutationTools } from "../../src/mcp/tools/mutation-tools.js";
import { registerReadTools } from "../../src/mcp/tools/read-tools.js";
import { copyFixtureWorkspace } from "../fixtures/fixture-utils.js";

const TOOL = "workflow_record_reclassification";
const PIPELINE_PATH = "kiwi/pipeline.jsonl";
const WORKLOG_PATH = ".kiwi/sessions/run-a/worklog.jsonl";
const TYPED_FIELDS = [
  "runId",
  "path",
  "recordType",
  "line",
  "byteOffset",
  "rawSha256",
  "eventKey",
  "targetRunId",
  "preimagePrefixSha256",
  "expectedSha256",
  "owner",
  "reason",
  "taskId",
  "reqId",
  "idempotencyKey",
  "repairToken",
  "dryRun"
] as const;
const MANDATORY_FIELDS = [
  "runId",
  "recordType",
  "line",
  "byteOffset",
  "rawSha256",
  "eventKey",
  "targetRunId",
  "preimagePrefixSha256",
  "expectedSha256",
  "owner",
  "reason",
  "dryRun"
] as const;

interface ToolResultSummary {
  ok?: boolean;
  mutation?: { written?: boolean; journalState?: string };
}

function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

async function write(root: string, relativePath: string, text: string): Promise<void> {
  const absolutePath = path.join(root, relativePath);
  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, text, "utf8");
}

async function read(root: string, relativePath: string): Promise<string> {
  return readFile(path.join(root, relativePath), "utf8");
}

function targetlessCorrection(runId = "audit-relation-change"): Record<string, unknown> {
  return {
    schema_version: "1.0.0",
    skill: "kiwi-srs",
    run_id: runId,
    status: "CORRECTION",
    corrects_relation: "verifies",
    owner: "kiwi-srs",
    reason: "audit-only SRS relation change"
  };
}

async function incident(recordType: "pipeline" | "worklog" = "pipeline", relativePath = recordType === "pipeline" ? PIPELINE_PATH : WORKLOG_PATH) {
  const root = await copyFixtureWorkspace("valid-basic");
  const rawLine = JSON.stringify(targetlessCorrection());
  const preimage = `${rawLine}\r\n`;
  await write(root, relativePath, preimage);
  return {
    root,
    rawLine,
    preimage,
    input: {
      runId: "reclassify-audit-relation-change",
      path: relativePath,
      recordType,
      line: 1,
      byteOffset: 0,
      rawSha256: sha256(Buffer.from(rawLine, "utf8")),
      eventKey: "kiwi-srs|audit-relation-change",
      targetRunId: "audit-relation-change",
      preimagePrefixSha256: sha256(Buffer.from(preimage, "utf8")),
      expectedSha256: sha256(Buffer.from(preimage, "utf8")),
      owner: "kiwi-srs",
      reason: "reclassify malformed audit record",
      taskId: "T-WAVE3-REPAIR",
      reqId: "FR-NODE-177"
    }
  };
}

function registeredServer(root: string) {
  const server = createTestMcpServer({ root });
  registerMutationTools(server, { root });
  registerReadTools(server, { root });
  return server;
}

function expectCompleteEnvelope(result: unknown, written: boolean): void {
  expect(result).toMatchObject({
    ok: true,
    value: {
      written,
      journalKey: expect.any(String),
      idempotencyKey: expect.any(String),
      journalState: expect.any(String),
      completedOperations: expect.any(Array),
      pendingOperations: expect.any(Array),
      staleGuards: expect.any(Array),
      operations: expect.any(Array),
      artifact: expect.any(Object),
      diagnosticDelta: expect.any(Object),
      targetRecord: expect.any(Object)
    },
    mutation: {
      kind: "workflow_record_reclassification",
      written,
      operations: expect.any(Array),
      journalKey: expect.any(String),
      idempotencyKey: expect.any(String),
      completedOperations: expect.any(Array),
      pendingOperations: expect.any(Array),
      staleGuards: expect.any(Array),
      artifact: expect.any(Object),
      diagnosticDelta: expect.any(Object),
      targetRecord: expect.any(Object)
    },
    diagnostics: expect.any(Array),
    diagnosticsSummary: expect.any(Object)
  });
  expect(result).toHaveProperty("value.pendingRepair");
  expect(result).toHaveProperty("mutation.pendingRepair");
}

describe("FR-MCP-057 / FR-NODE-177 — MCP workflow record reclassification", () => {
  it("registers a workspace mutation with a closed typed schema and no arbitrary event field", async () => {
    const fixture = await incident();
    const server = registeredServer(fixture.root);
    expect(server.tools[TOOL]).toBeDefined();
    expect(server.toolKinds[TOOL]).toBe("workspace");

    const schema = toolSchemas[TOOL];
    expect(schema).toBeDefined();
    for (const field of TYPED_FIELDS) {
      expect(schema[field], `${TOOL}.${field} should be declared`).toBeDefined();
    }
    expect(schema.event).toBeUndefined();

    const recordType = z.object({ recordType: schema.recordType });
    expect(recordType.safeParse({ recordType: "pipeline" }).success).toBe(true);
    expect(recordType.safeParse({ recordType: "worklog" }).success).toBe(true);
    expect(recordType.safeParse({ recordType: "legacy" }).success).toBe(false);
    expect(recordType.safeParse({ recordType: "unknown" }).success).toBe(false);
    expect(z.object({ line: schema.line }).safeParse({ line: 0 }).success).toBe(false);
    expect(z.object({ byteOffset: schema.byteOffset }).safeParse({ byteOffset: -1 }).success).toBe(false);
    expect(z.object({ reason: schema.reason }).safeParse({ reason: "   " }).success).toBe(false);
    expect(z.object({ dryRun: schema.dryRun }).safeParse({ dryRun: "true" }).success).toBe(false);
  });

  it("rejects every missing mandatory field, blank reason, and values outside the closed recordType enum at schema and handler boundaries", async () => {
    const fixture = await incident();
    const server = registeredServer(fixture.root);
    const schema = z.object(toolSchemas[TOOL]).strict();
    const request = { ...fixture.input, dryRun: true };
    expect(schema.safeParse(request).success).toBe(true);

    for (const field of MANDATORY_FIELDS) {
      const missing = { ...request } as Record<string, unknown>;
      delete missing[field];
      expect(schema.safeParse(missing).success, `schema must reject missing ${field}`).toBe(false);
      const result = await server.callTool(TOOL, missing);
      expect(result, `handler must reject missing ${field}`).toMatchObject({ ok: false });
      expect(await read(fixture.root, PIPELINE_PATH), `missing ${field} must not write`).toBe(fixture.preimage);
    }

    for (const invalid of [
      { ...request, runId: "   " },
      { ...request, path: "   " },
      { ...request, owner: "   " },
      { ...request, reason: "   " },
      { ...request, recordType: "legacy" },
      { ...request, recordType: "unknown" }
    ]) {
      expect(schema.safeParse(invalid).success).toBe(false);
      const result = await server.callTool(TOOL, invalid);
      expect(result).toMatchObject({ ok: false });
      expect(await read(fixture.root, PIPELINE_PATH)).toBe(fixture.preimage);
    }
  });

  it("forwards all seventeen typed fields unchanged to the core mutation adapter", async () => {
    vi.resetModules();
    const applyWorkflowMutation = vi.fn(async (rootInput: unknown, mutationInput: unknown) => {
      void rootInput;
      void mutationInput;
      return {
        ok: true,
        value: {},
        diagnostics: [],
        diagnosticsSummary: { errors: 0, warnings: 0, byCode: {} }
      };
    });
    vi.doMock("../../src/core/workflow/mutation.js", () => ({ applyWorkflowMutation }));
    const { registerMutationTools: registerFreshMutationTools } = await import("../../src/mcp/tools/mutation-tools.js");
    const root = await copyFixtureWorkspace("valid-basic");
    const server = createTestMcpServer({ root });
    registerFreshMutationTools(server, { root });
    const forwarded = {
      runId: "  forward-run  ",
      path: `  ${PIPELINE_PATH}  `,
      recordType: "pipeline",
      line: 7,
      byteOffset: 123,
      rawSha256: "a".repeat(64),
      eventKey: "skill|target",
      targetRunId: "target",
      preimagePrefixSha256: "b".repeat(64),
      expectedSha256: "c".repeat(64),
      owner: "  kiwi-srs  ",
      reason: "  forward every field  ",
      taskId: "T-001",
      reqId: "FR-NODE-177",
      idempotencyKey: "idempotency",
      repairToken: "repair-token",
      dryRun: false
    };

    try {
      const parsed = z.object(toolSchemas[TOOL]).strict().parse(forwarded);
      await server.callTool(TOOL, parsed);
      expect(applyWorkflowMutation).toHaveBeenCalledTimes(1);
      expect(applyWorkflowMutation.mock.calls[0]?.[1]).toEqual({
        kind: "workflow_record_reclassification",
        runId: forwarded.runId,
        jsonlPath: forwarded.path,
        recordType: forwarded.recordType,
        line: forwarded.line,
        byteOffset: forwarded.byteOffset,
        rawSha256: forwarded.rawSha256,
        eventKey: forwarded.eventKey,
        targetRunId: forwarded.targetRunId,
        preimagePrefixSha256: forwarded.preimagePrefixSha256,
        expectedSha256: forwarded.expectedSha256,
        owner: forwarded.owner,
        reason: forwarded.reason,
        taskId: forwarded.taskId,
        reqId: forwarded.reqId,
        idempotencyKey: forwarded.idempotencyKey,
        repairToken: forwarded.repairToken,
        dryRun: forwarded.dryRun
      });
    } finally {
      vi.doUnmock("../../src/core/workflow/mutation.js");
      vi.resetModules();
    }
  });

  it("returns a token-bound typed pendingRepair and complete no-write envelope for dry-run", async () => {
    const fixture = await incident();
    const server = registeredServer(fixture.root);

    const result = await server.callTool(TOOL, { ...fixture.input, dryRun: true });

    expectCompleteEnvelope(result, false);
    expect(result).toMatchObject({
      value: {
        repairToken: expect.any(String),
        pendingRepair: expect.objectContaining({ kind: "record_reclassification" }),
        targetRecord: expect.objectContaining({
          path: PIPELINE_PATH,
          recordType: "pipeline",
          line: 1,
          byteOffset: 0,
          rawSha256: fixture.input.rawSha256,
          eventKey: fixture.input.eventKey,
          targetRunId: fixture.input.targetRunId
        }),
        artifact: expect.objectContaining({ relativePath: PIPELINE_PATH, kind: "pipeline", sha256: fixture.input.expectedSha256 }),
        diagnosticDelta: expect.objectContaining({ removed: expect.any(Array), added: expect.any(Array), preserved: expect.any(Array) })
      },
      mutation: {
        journalState: "skipped_dry_run",
        pendingRepair: expect.objectContaining({ kind: "record_reclassification" }),
        artifact: expect.objectContaining({ relativePath: PIPELINE_PATH, kind: "pipeline" }),
        diagnosticDelta: expect.any(Object)
      }
    });
    expect(await read(fixture.root, PIPELINE_PATH)).toBe(fixture.preimage);
  });

  it("applies only the dry-run token, preserves the CRLF preimage, and emits complete durable provenance", async () => {
    const fixture = await incident();
    const server = registeredServer(fixture.root);
    const missingToken = await server.callTool(TOOL, { ...fixture.input, dryRun: false });
    expect(missingToken).toMatchObject({ ok: false, mutation: { written: false } });
    expect(await read(fixture.root, PIPELINE_PATH)).toBe(fixture.preimage);
    const preview = (await server.callTool(TOOL, { ...fixture.input, dryRun: true })) as {
      value: { repairToken: string };
    };
    const { expectedSha256: _expectedSha256, ...withoutExpectedSha256 } = fixture.input;
    void _expectedSha256;
    const missingExpectedSha256 = await server.callTool(TOOL, {
      ...withoutExpectedSha256,
      dryRun: false,
      repairToken: preview.value.repairToken
    });
    expect(missingExpectedSha256).toMatchObject({ ok: false });
    expect(await read(fixture.root, PIPELINE_PATH)).toBe(fixture.preimage);

    const result = (await server.callTool(TOOL, {
      ...fixture.input,
      dryRun: false,
      repairToken: preview.value.repairToken
    })) as { value: { journalKey: string; idempotencyKey: string } };

    expectCompleteEnvelope(result, true);
    expect(result).toMatchObject({
      value: { journalState: "confirmed", pendingRepair: null },
      mutation: { journalState: "confirmed", pendingRepair: null }
    });
    const durable = await read(fixture.root, PIPELINE_PATH);
    expect(Buffer.from(durable, "utf8").subarray(0, Buffer.byteLength(fixture.preimage))).toEqual(Buffer.from(fixture.preimage, "utf8"));
    const overlay = JSON.parse(durable.slice(fixture.preimage.length).trim()) as Record<string, unknown>;
    expect(overlay).toMatchObject({
      schema_version: "1.0.0",
      skill: "speckiwi",
      event: "record_reclassification",
      run_id: expect.any(String),
      recordClass: "meta",
      effectiveRecordClass: "audit_note",
      workflow_run_id: fixture.input.runId,
      journal_key: result.value.journalKey,
      idempotency_key: result.value.idempotencyKey,
      owner: fixture.input.owner,
      reason: fixture.input.reason,
      operation: expect.objectContaining({ kind: "record_reclassification" })
    });
    expect(overlay.ts).toEqual(expect.any(String));
    expect(overlay).not.toHaveProperty("status");
    expect(overlay).not.toHaveProperty("corrects_run_id");
  });

  it("confirms exact replay before stale rejection and rejects non-replay stale or path-kind requests without writing", async () => {
    const fixture = await incident();
    const server = registeredServer(fixture.root);
    const preview = (await server.callTool(TOOL, { ...fixture.input, dryRun: true })) as { value: { repairToken: string } };
    const applyInput = { ...fixture.input, dryRun: false, repairToken: preview.value.repairToken };
    await server.callTool(TOOL, applyInput);
    const afterApply = await read(fixture.root, PIPELINE_PATH);

    const replay = await server.callTool(TOOL, applyInput);
    expectCompleteEnvelope(replay, false);
    expect(replay).toMatchObject({ ok: true, value: { journalState: "confirmed", pendingRepair: null } });
    expect(await read(fixture.root, PIPELINE_PATH)).toBe(afterApply);

    const staleFixture = await incident();
    const staleServer = registeredServer(staleFixture.root);
    const stalePreview = (await staleServer.callTool(TOOL, { ...staleFixture.input, dryRun: true })) as { value: { repairToken: string } };
    const intervening = `${staleFixture.preimage}${JSON.stringify({ schema_version: "1.0.0", skill: "kiwi-pm", run_id: "intervening", status: "TASK_DONE" })}\n`;
    await write(staleFixture.root, PIPELINE_PATH, intervening);
    const stale = await staleServer.callTool(TOOL, { ...staleFixture.input, repairToken: stalePreview.value.repairToken, dryRun: false });
    expect(stale).toMatchObject({ ok: false, mutation: { written: false, journalState: "failed" } });
    expect(await read(staleFixture.root, PIPELINE_PATH)).toBe(intervening);

    const mismatch = await staleServer.callTool(TOOL, { ...staleFixture.input, recordType: "worklog", dryRun: true });
    expect(mismatch).toMatchObject({ ok: false, mutation: { written: false } });
    expect(await read(staleFixture.root, PIPELINE_PATH)).toBe(intervening);
  });

  it("rejects whitespace-only generic correction targets before duplicate confirmation", async () => {
    const root = await copyFixtureWorkspace("valid-basic");
    const duplicate = { schema_version: "1.0.0", skill: "kiwi-srs", run_id: "duplicate", status: "TASK_DONE" };
    const relativePath = ".kiwi/sessions/whitespace/worklog.jsonl";
    const original = `${JSON.stringify(duplicate)}\n`;
    await write(root, relativePath, original);
    const server = registeredServer(root);

    const result = await server.callTool("workflow_repair_record", {
      runId: "whitespace",
      path: relativePath,
      owner: "kiwi-srs",
      event: { ...duplicate, status: "CORRECTION", corrects_run_id: "   " }
    });

    expect(result).toMatchObject({ ok: false, mutation: { written: false } });
    expect(await read(root, relativePath)).toBe(original);
  });

  it("fails closed for invalid tokens, identity mismatch, ambiguous artifacts, conflicts, and unrelated diagnostics", async () => {
    const invalidTokenFixture = await incident();
    const invalidTokenServer = registeredServer(invalidTokenFixture.root);
    const preview = (await invalidTokenServer.callTool(TOOL, { ...invalidTokenFixture.input, dryRun: true })) as { value: { repairToken: string } };
    const invalidToken = await invalidTokenServer.callTool(TOOL, { ...invalidTokenFixture.input, dryRun: false, repairToken: `${preview.value.repairToken}-tampered` });
    expect(invalidToken).toMatchObject({ ok: false, mutation: { written: false, journalState: "failed" } });
    expect(await read(invalidTokenFixture.root, PIPELINE_PATH)).toBe(invalidTokenFixture.preimage);

    const identityFixture = await incident();
    const identityServer = registeredServer(identityFixture.root);
    const identityMismatch = await identityServer.callTool(TOOL, { ...identityFixture.input, rawSha256: "0".repeat(64), dryRun: true });
    expect(identityMismatch).toMatchObject({ ok: false, mutation: { written: false } });
    expect(await read(identityFixture.root, PIPELINE_PATH)).toBe(identityFixture.preimage);

    const unrelatedFixture = await incident();
    const unrelatedServer = registeredServer(unrelatedFixture.root);
    const unrelatedPreimage = `${unrelatedFixture.preimage}${JSON.stringify({ schema_version: "9.9.9", skill: "kiwi-pm", run_id: "unsupported", status: "TASK_DONE" })}\n`;
    await write(unrelatedFixture.root, PIPELINE_PATH, unrelatedPreimage);
    const unrelated = await unrelatedServer.callTool(TOOL, {
      ...unrelatedFixture.input,
      expectedSha256: sha256(unrelatedPreimage),
      preimagePrefixSha256: sha256(unrelatedPreimage),
      dryRun: true
    });
    expect(unrelated).toMatchObject({ ok: false, mutation: { written: false }, diagnosticsSummary: { byCode: { "SRS-W055": 1 } } });
    expect(await read(unrelatedFixture.root, PIPELINE_PATH)).toBe(unrelatedPreimage);

    const ambiguousRoot = await copyFixtureWorkspace("valid-basic");
    const ambiguousLine = JSON.stringify(targetlessCorrection());
    const ambiguousPreimage = `${ambiguousLine}\n`;
    const paths = [".kiwi/sessions/a/pipeline.jsonl", ".kiwi/sessions/b/pipeline.jsonl"];
    for (const relativePath of paths) await write(ambiguousRoot, relativePath, ambiguousPreimage);
    const fixedTime = new Date("2026-08-07T00:00:00.000Z");
    for (const relativePath of paths) await utimes(path.join(ambiguousRoot, relativePath), fixedTime, fixedTime);
    const ambiguousServer = registeredServer(ambiguousRoot);
    const ambiguous = await ambiguousServer.callTool(TOOL, {
      runId: "ambiguous-mutation",
      recordType: "pipeline",
      line: 1,
      byteOffset: 0,
      rawSha256: sha256(ambiguousLine),
      eventKey: "kiwi-srs|audit-relation-change",
      targetRunId: "audit-relation-change",
      preimagePrefixSha256: sha256(ambiguousPreimage),
      expectedSha256: sha256(ambiguousPreimage),
      owner: "kiwi-srs",
      reason: "ambiguous artifact must fail",
      dryRun: true
    });
    expect(ambiguous).toMatchObject({ ok: false, mutation: { written: false }, diagnosticsSummary: { byCode: { "SRS-E051": 1 } } });
    for (const relativePath of paths) expect(await read(ambiguousRoot, relativePath)).toBe(ambiguousPreimage);
  });

  it("serializes identical and conflicting concurrent first applies to one durable overlay", async () => {
    const identicalFixture = await incident();
    const identicalServer = registeredServer(identicalFixture.root);
    const identicalPreview = (await identicalServer.callTool(TOOL, { ...identicalFixture.input, dryRun: true })) as { value: { repairToken: string } };
    const identicalInput = { ...identicalFixture.input, dryRun: false, repairToken: identicalPreview.value.repairToken };
    const identicalResults = await Promise.all([identicalServer.callTool(TOOL, identicalInput), identicalServer.callTool(TOOL, identicalInput)]) as ToolResultSummary[];
    expect(identicalResults.filter((result) => result.mutation?.written === true)).toHaveLength(1);
    expect(identicalResults.filter((result) => result.ok === true && result.mutation?.written === false && result.mutation?.journalState === "confirmed")).toHaveLength(1);
    expect((await read(identicalFixture.root, PIPELINE_PATH)).split(/\r?\n/).filter((line) => line.includes('"event":"record_reclassification"'))).toHaveLength(1);

    const conflictingFixture = await incident();
    const conflictingServer = registeredServer(conflictingFixture.root);
    const first = { ...conflictingFixture.input, runId: "conflict-first", reason: "first classification" };
    const second = { ...conflictingFixture.input, runId: "conflict-second", reason: "second classification" };
    const [firstPreview, secondPreview] = await Promise.all([
      conflictingServer.callTool(TOOL, { ...first, dryRun: true }),
      conflictingServer.callTool(TOOL, { ...second, dryRun: true })
    ]) as Array<{ value: { repairToken: string } }>;
    const conflictingResults = await Promise.all([
      conflictingServer.callTool(TOOL, { ...first, dryRun: false, repairToken: firstPreview.value.repairToken }),
      conflictingServer.callTool(TOOL, { ...second, dryRun: false, repairToken: secondPreview.value.repairToken })
    ]) as ToolResultSummary[];
    expect(conflictingResults.filter((result) => result.mutation?.written === true)).toHaveLength(1);
    expect(conflictingResults.filter((result) => result.ok === false && result.mutation?.written === false)).toHaveLength(1);
    expect((await read(conflictingFixture.root, PIPELINE_PATH)).split(/\r?\n/).filter((line) => line.includes('"event":"record_reclassification"'))).toHaveLength(1);
  });

  it("makes every SRS-enumerated MCP reader agree on targeted W054 removal and raw-tail retention", async () => {
    const fixture = await incident();
    const server = registeredServer(fixture.root);
    const preview = (await server.callTool(TOOL, { ...fixture.input, dryRun: true })) as { value: { repairToken: string } };
    await server.callTool(TOOL, { ...fixture.input, dryRun: false, repairToken: preview.value.repairToken });

    for (const reader of [
      "workflow_pipeline_status",
      "workflow_pipeline_tail",
      "workflow_pipeline_next",
      "workflow_pipeline_compact",
      "workflow_doctor",
      "workflow_diff",
      "workflow_schema_check",
      "workflow_next_plan_task",
      "workflow_resume_hint",
      "get_next_work_order"
    ]) {
      const result = await server.callTool(reader, reader === "get_next_work_order" ? { pipelinePath: PIPELINE_PATH } : { path: PIPELINE_PATH, includeDeleted: true });
      if (reader === "get_next_work_order") {
        expect(result, `${reader} should preserve its established direct work-order response`).toMatchObject({
          action: expect.any(String),
          nextAction: expect.any(Object),
          diagnostics: expect.any(Array),
          diagnosticsSummary: expect.any(Object)
        });
      } else {
        expect(result, `${reader} should succeed`).toMatchObject({ ok: true, diagnostics: expect.any(Array), diagnosticsSummary: expect.any(Object) });
      }
      expect(JSON.stringify(result), `${reader} should remove only the targeted missing-correction diagnostic`).not.toContain("SRS-W054");
    }

    const tail = await server.callTool("workflow_pipeline_tail", { path: PIPELINE_PATH, includeDeleted: true });
    expect(tail).toMatchObject({
      value: {
        events: [
          expect.objectContaining({ effectiveRecordClass: "audit_note", recordClass: "meta" }),
          expect.objectContaining({ event: expect.objectContaining({ event: "record_reclassification" }) })
        ]
      }
    });

    const worklogFixture = await incident("worklog");
    const worklogServer = registeredServer(worklogFixture.root);
    const worklogPreview = (await worklogServer.callTool(TOOL, { ...worklogFixture.input, dryRun: true })) as { value: { repairToken: string } };
    await worklogServer.callTool(TOOL, { ...worklogFixture.input, dryRun: false, repairToken: worklogPreview.value.repairToken });
    const worklogTail = await worklogServer.callTool("workflow_worklog_tail", { path: WORKLOG_PATH, includeDeleted: true });
    expect(worklogTail).toMatchObject({
      ok: true,
      value: {
        events: [
          expect.objectContaining({ effectiveRecordClass: "audit_note", recordClass: "meta" }),
          expect.objectContaining({ event: expect.objectContaining({ event: "record_reclassification" }) })
        ]
      }
    });
    expect(JSON.stringify(worklogTail)).not.toContain("SRS-W054");

    const sessionStatus = await worklogServer.callTool("workflow_session_status", { runId: "run-a" });
    expect(sessionStatus).toMatchObject({ ok: true, diagnostics: expect.any(Array), diagnosticsSummary: expect.any(Object) });
    expect(JSON.stringify(sessionStatus)).not.toContain("SRS-W054");
  });
});
