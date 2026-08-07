import { createHash } from "node:crypto";
import { mkdir, readFile, utimes, writeFile } from "node:fs/promises";
import path from "node:path";
import { PassThrough } from "node:stream";

import { describe, expect, it, vi } from "vitest";

import { main } from "../../src/cli/index.js";
import { createTestMcpServer } from "../../src/mcp/adapter.js";
import { registerMutationTools } from "../../src/mcp/tools/mutation-tools.js";
import { registerReadTools } from "../../src/mcp/tools/read-tools.js";
import { copyFixtureWorkspace } from "../fixtures/fixture-utils.js";

type JsonObject = Record<string, unknown>;

interface CliResult {
  body: JsonObject;
  code: number;
  stderr: string;
  stdout: string;
}

interface RecordTarget {
  byteOffset: number;
  eventKey: string;
  expectedSha256: string;
  line: number;
  path: string;
  preimagePrefixSha256: string;
  rawSha256: string;
  recordType: "pipeline" | "worklog";
  targetRunId: string;
}

interface Workspace {
  planPath: string;
  pipeline: RecordTarget;
  root: string;
  worklog: RecordTarget;
}

const sha256 = (value: string): string =>
  createHash("sha256").update(value, "utf8").digest("hex");

async function invoke(root: string, args: string[]): Promise<Omit<CliResult, "body">> {
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const code = await main(["--root", root, ...args], { stderr, stdout });

  return {
    code,
    stderr: stderr.read()?.toString("utf8") ?? "",
    stdout: stdout.read()?.toString("utf8") ?? "",
  };
}

async function invokeJson(root: string, args: string[]): Promise<CliResult> {
  const result = await invoke(root, [...args, "--json"]);
  const body = JSON.parse(result.stdout) as JsonObject;
  return { ...result, body };
}

function correctionRecord(runId: string): JsonObject {
  return {
    completion_claimed: false,
    event: "trace_semantic_correction",
    run_id: runId,
    schema_version: "1.0.0",
    skill: "kiwi-planner",
    status: "CORRECTION",
    summary: "legacy semantic correction without a correction target",
    target: "v1.0.0",
    ts: "2026-08-07T00:00:00.000Z",
  };
}

async function createWorkspace(): Promise<Workspace> {
  const root = await copyFixtureWorkspace("valid-basic");
  const planPath = "docs/plan/repair-run.md";
  const sessionDirectory = path.join(root, ".kiwi", "sessions", "repair-run");
  const planDirectory = path.join(root, "docs", "plan");
  const pipelineDirectory = path.join(root, "kiwi");
  await Promise.all([
    mkdir(sessionDirectory, { recursive: true }),
    mkdir(planDirectory, { recursive: true }),
    mkdir(pipelineDirectory, { recursive: true }),
  ]);

  await writeFile(
    path.join(root, planPath),
    [
      "---",
      "run_id: repair-run",
      "target: v1.0.0",
      'plan_contract: "1.2.0"',
      "generated_at: 2026-08-07T00:00:00.000Z",
      "sidecar_path: ./repair-run.sidecar.json",
      "---",
      "# Repair run",
      "",
    ].join("\n"),
    "utf8",
  );
  await writeFile(
    path.join(planDirectory, "repair-run.sidecar.json"),
    JSON.stringify(
      {
        generated_at: "2026-08-07T00:00:00.000Z",
        plan_contract: "1.2.0",
        run_id: "repair-run",
        schema_version: "1.1.0",
        target: "v1.0.0",
        tasks: [
          {
            depends_on_task: [],
            id: "T-001",
            phase_id: "PH-001",
            req_ids: ["FR-ARCH-001"],
            title: "Pending task",
          },
        ],
      },
      null,
      2,
    ),
    "utf8",
  );
  await writeFile(
    path.join(sessionDirectory, "pm-state.json"),
    JSON.stringify(
      {
        run_id: "repair-run",
        stats: { done: 0, pending: 1 },
        target_slug: "v1.0.0",
        tasks: [{ status: "pending", task_id: "T-001" }],
      },
      null,
      2,
    ),
    "utf8",
  );

  const worklogRaw = JSON.stringify(correctionRecord("legacy-worklog-record"));
  const worklogContents = `${worklogRaw}\n`;
  const worklogPath = ".kiwi/sessions/repair-run/worklog.jsonl";
  await writeFile(path.join(root, worklogPath), worklogContents, "utf8");

  const pipelineFirst = JSON.stringify({
    event: "run_started",
    run_id: "repair-run",
    schema_version: "1.0.0",
    status: "STARTED",
    summary: "한글 UTF-8 byte prefix",
    target: "v1.0.0",
    ts: "2026-08-07T00:00:00.000Z",
  });
  const pipelineRaw = JSON.stringify(correctionRecord("legacy-pipeline-record"));
  const pipelineContents = `${pipelineFirst}\r\n${pipelineRaw}\r\n`;
  const pipelinePath = "kiwi/pipeline.jsonl";
  await writeFile(path.join(root, pipelinePath), pipelineContents, "utf8");

  return {
    planPath,
    root,
    pipeline: {
      byteOffset: Buffer.byteLength(`${pipelineFirst}\r\n`, "utf8"),
      eventKey: "kiwi-planner|legacy-pipeline-record",
      expectedSha256: sha256(pipelineContents),
      line: 2,
      path: pipelinePath,
      preimagePrefixSha256: sha256(pipelineContents),
      rawSha256: sha256(pipelineRaw),
      recordType: "pipeline",
      targetRunId: "legacy-pipeline-record",
    },
    worklog: {
      byteOffset: 0,
      eventKey: "kiwi-planner|legacy-worklog-record",
      expectedSha256: sha256(worklogContents),
      line: 1,
      path: worklogPath,
      preimagePrefixSha256: sha256(worklogContents),
      rawSha256: sha256(worklogRaw),
      recordType: "worklog",
      targetRunId: "legacy-worklog-record",
    },
  };
}

function reclassifyArgs(
  target: RecordTarget,
  overrides: Partial<{
    idempotencyKey: string;
    owner: string;
    reason: string;
    reqId: string;
    runId: string;
    taskId: string;
  }> = {},
): string[] {
  const values = {
    owner: "kiwi-pm",
    reason: "reclassify a legacy semantic correction record",
    reqId: "FR-NODE-177",
    runId: "repair-run",
    taskId: "T-001",
    ...overrides,
  };
  const args = [
    "workflow",
    "reclassify-record",
    "--run-id",
    values.runId,
    "--path",
    target.path,
    "--record-type",
    target.recordType,
    "--line",
    String(target.line),
    "--byte-offset",
    String(target.byteOffset),
    "--raw-sha256",
    target.rawSha256,
    "--event-key",
    target.eventKey,
    "--target-run-id",
    target.targetRunId,
    "--preimage-prefix-sha256",
    target.preimagePrefixSha256,
    "--expected-sha256",
    target.expectedSha256,
    "--owner",
    values.owner,
    "--reason",
    values.reason,
    "--task-id",
    values.taskId,
    "--req-id",
    values.reqId,
  ];
  if (values.idempotencyKey !== undefined) {
    args.push("--idempotency-key", values.idempotencyKey);
  }
  return args;
}

function withoutOption(args: string[], option: string): string[] {
  const result = [...args];
  const index = result.indexOf(option);
  expect(index, `${option} must exist in the test invocation`).toBeGreaterThanOrEqual(0);
  result.splice(index, 2);
  return result;
}

function valueOf(body: JsonObject): JsonObject {
  expect(body.ok).toBe(true);
  expect(body.value).toBeTypeOf("object");
  return body.value as JsonObject;
}

function expectCompleteEnvelope(body: JsonObject, written: boolean): void {
  expect(body).toMatchObject({
    diagnostics: expect.any(Array),
    diagnosticsSummary: expect.any(Object),
    mutation: {
      artifact: expect.any(Object),
      completedOperations: expect.any(Array),
      idempotencyKey: expect.any(String),
      journalKey: expect.any(String),
      journalState: expect.any(String),
      kind: "workflow_record_reclassification",
      operations: expect.any(Array),
      pendingOperations: expect.any(Array),
      staleGuards: expect.any(Array),
      targetRecord: expect.any(Object),
      written,
    },
    ok: true,
    value: {
      artifact: expect.any(Object),
      completedOperations: expect.any(Array),
      idempotencyKey: expect.any(String),
      journalKey: expect.any(String),
      journalState: expect.any(String),
      pendingOperations: expect.any(Array),
      staleGuards: expect.any(Array),
      targetRecord: expect.any(Object),
      written,
    },
  });
  expect(body).toHaveProperty("value.pendingRepair");
  expect(body).toHaveProperty("mutation.pendingRepair");
  expect(body).toHaveProperty("value.diagnosticDelta");
  expect(body).toHaveProperty("mutation.diagnosticDelta");
}

function mcpInput(
  target: RecordTarget,
  overrides: Partial<{
    dryRun: boolean;
    idempotencyKey: string;
    owner: string;
    reason: string;
    repairToken: string;
    reqId: string;
    runId: string;
    taskId: string;
  }> = {},
): JsonObject {
  return {
    byteOffset: target.byteOffset,
    dryRun: true,
    eventKey: target.eventKey,
    expectedSha256: target.expectedSha256,
    line: target.line,
    owner: "kiwi-pm",
    path: target.path,
    preimagePrefixSha256: target.preimagePrefixSha256,
    rawSha256: target.rawSha256,
    reason: "reclassify a legacy semantic correction record",
    recordType: target.recordType,
    reqId: "FR-NODE-177",
    runId: "repair-run",
    targetRunId: target.targetRunId,
    taskId: "T-001",
    ...overrides,
    ...(overrides.idempotencyKey !== undefined
      ? { idempotencyKey: overrides.idempotencyKey }
      : {}),
  };
}

function mutationServer(root: string) {
  const server = createTestMcpServer({ root });
  registerMutationTools(server, { root });
  registerReadTools(server, { root });
  return server;
}

async function previewAndApply(root: string, target: RecordTarget): Promise<CliResult> {
  const preview = await invokeJson(root, [...reclassifyArgs(target), "--dry-run"]);
  expect(preview.code).toBe(0);
  const previewValue = valueOf(preview.body);
  expect(previewValue).toMatchObject({
    journalState: "skipped_dry_run",
    pendingRepair: { kind: "record_reclassification" },
    written: false,
  });
  expect(previewValue.repairToken).toEqual(expect.any(String));

  return invokeJson(root, [
    ...reclassifyArgs(target),
    "--repair-token",
    previewValue.repairToken as string,
  ]);
}

async function mcpPreviewAndApply(
  server: ReturnType<typeof mutationServer>,
  target: RecordTarget,
): Promise<unknown> {
  const preview = (await server.callTool(
    "workflow_record_reclassification",
    mcpInput(target),
  )) as { value: { repairToken: string } };
  return server.callTool(
    "workflow_record_reclassification",
    mcpInput(target, { dryRun: false, repairToken: preview.value.repairToken }),
  );
}

describe("IR-CLI-089 workflow record reclassification", () => {
  it("exposes the typed option surface without accepting an arbitrary event payload", async () => {
    const workspace = await createWorkspace();
    const help = await invoke(workspace.root, ["workflow", "reclassify-record", "--help"]);

    expect(help.code).toBe(0);
    for (const option of [
      "--run-id",
      "--path",
      "--record-type",
      "--line",
      "--byte-offset",
      "--raw-sha256",
      "--event-key",
      "--target-run-id",
      "--preimage-prefix-sha256",
      "--expected-sha256",
      "--owner",
      "--reason",
      "--task-id",
      "--req-id",
      "--idempotency-key",
      "--dry-run",
      "--repair-token",
    ]) {
      expect(help.stdout).toContain(option);
    }
    expect(help.stdout).not.toMatch(/(?:^|\s)--event(?=\s|[=<]|$)/m);

    const arbitraryEvent = await invokeJson(workspace.root, [
      ...reclassifyArgs(workspace.worklog),
      "--event",
      "{}",
      "--dry-run",
    ]);
    expect(arbitraryEvent.code).not.toBe(0);
    expect(arbitraryEvent.body).toMatchObject({
      error: { code: "CLI_USAGE_ERROR" },
      ok: false,
    });
  });

  it.each([
    "--run-id",
    "--record-type",
    "--line",
    "--byte-offset",
    "--raw-sha256",
    "--event-key",
    "--target-run-id",
    "--preimage-prefix-sha256",
    "--expected-sha256",
    "--owner",
    "--reason",
  ])("rejects a dry-run missing required typed option %s without writing", async (option) => {
    const workspace = await createWorkspace();
    const before = await readFile(path.join(workspace.root, workspace.pipeline.path), "utf8");
    const result = await invokeJson(workspace.root, [
      ...withoutOption(reclassifyArgs(workspace.pipeline), option),
      "--dry-run",
    ]);

    expect(result.code).not.toBe(0);
    expect(result.body).toMatchObject({ ok: false });
    expect(await readFile(path.join(workspace.root, workspace.pipeline.path), "utf8")).toBe(before);
  });

  it("rejects blank reason and values outside the closed recordType enum", async () => {
    const workspace = await createWorkspace();
    const before = await readFile(path.join(workspace.root, workspace.pipeline.path), "utf8");
    const blankReasonArgs = reclassifyArgs(workspace.pipeline);
    blankReasonArgs[blankReasonArgs.indexOf("--reason") + 1] = "   ";
    const blankReason = await invokeJson(workspace.root, [...blankReasonArgs, "--dry-run"]);
    expect(blankReason.code).not.toBe(0);
    expect(blankReason.body).toMatchObject({ ok: false });

    const invalidTypeArgs = reclassifyArgs(workspace.pipeline);
    invalidTypeArgs[invalidTypeArgs.indexOf("--record-type") + 1] = "legacy";
    const invalidType = await invokeJson(workspace.root, [...invalidTypeArgs, "--dry-run"]);
    expect(invalidType.code).not.toBe(0);
    expect(invalidType.body).toMatchObject({ ok: false });
    expect(await readFile(path.join(workspace.root, workspace.pipeline.path), "utf8")).toBe(before);
  });

  it("rejects an incompatible caller idempotency key with SRS-E072 and no write", async () => {
    const workspace = await createWorkspace();
    const before = await readFile(path.join(workspace.root, workspace.pipeline.path), "utf8");
    const result = await invokeJson(workspace.root, [
      ...reclassifyArgs(workspace.pipeline, {
        idempotencyKey: "Caller-Key-Preserves-Case",
      }),
      "--dry-run",
    ]);

    expect(result.code).not.toBe(0);
    expect(result.body).toMatchObject({
      mutation: { written: false },
      ok: false,
    });
    expect(JSON.stringify(result.body)).toContain("SRS-E072");
    expect(await readFile(path.join(workspace.root, workspace.pipeline.path), "utf8")).toBe(before);
  });

  it("forwards every typed field unchanged and is field-for-field identical to MCP on the same fixture", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-07T01:02:03.456Z"));
    try {
      const cliWorkspace = await createWorkspace();
      const mcpWorkspace = await createWorkspace();
      const adapterFields = {
        owner: "kiwi-srs",
        reason: "보존할 typed reason  ",
        reqId: "FR-MCP-057",
        runId: "repair-run",
        taskId: "T-PARITY-057",
      };
      const cliPreview = await invokeJson(cliWorkspace.root, [
        ...reclassifyArgs(cliWorkspace.pipeline, adapterFields),
        "--dry-run",
      ]);
      const mcpServer = mutationServer(mcpWorkspace.root);
      const mcpPreview = await mcpServer.callTool(
        "workflow_record_reclassification",
        mcpInput(mcpWorkspace.pipeline, adapterFields),
      );

      expect(cliPreview.code).toBe(0);
      expectCompleteEnvelope(cliPreview.body, false);
      expect(cliPreview.body).toStrictEqual(mcpPreview);
      expect(cliPreview.body).toMatchObject({
        mutation: {
          idempotencyKey: expect.any(String),
          targetRecord: {
            byteOffset: cliWorkspace.pipeline.byteOffset,
            eventKey: cliWorkspace.pipeline.eventKey,
            line: cliWorkspace.pipeline.line,
            path: cliWorkspace.pipeline.path,
            preimagePrefixSha256: cliWorkspace.pipeline.preimagePrefixSha256,
            rawSha256: cliWorkspace.pipeline.rawSha256,
            recordType: cliWorkspace.pipeline.recordType,
            reqId: adapterFields.reqId,
            runId: adapterFields.runId,
            targetRunId: cliWorkspace.pipeline.targetRunId,
            taskId: adapterFields.taskId,
          },
        },
        value: {
          idempotencyKey: expect.any(String),
          targetRecord: {
            byteOffset: cliWorkspace.pipeline.byteOffset,
            eventKey: cliWorkspace.pipeline.eventKey,
            line: cliWorkspace.pipeline.line,
            path: cliWorkspace.pipeline.path,
            preimagePrefixSha256: cliWorkspace.pipeline.preimagePrefixSha256,
            rawSha256: cliWorkspace.pipeline.rawSha256,
            recordType: cliWorkspace.pipeline.recordType,
            reqId: adapterFields.reqId,
            runId: adapterFields.runId,
            targetRunId: cliWorkspace.pipeline.targetRunId,
            taskId: adapterFields.taskId,
          },
        },
      });
      expect((cliPreview.body.value as JsonObject).idempotencyKey).toBe(
        (cliPreview.body.value as JsonObject).journalKey,
      );
      expect((cliPreview.body.mutation as JsonObject).idempotencyKey).toBe(
        (cliPreview.body.mutation as JsonObject).journalKey,
      );
      const serialized = JSON.stringify(cliPreview.body);
      for (const value of [
        adapterFields.owner,
        adapterFields.reason,
        adapterFields.reqId,
        adapterFields.runId,
        adapterFields.taskId,
        cliWorkspace.pipeline.path,
        cliWorkspace.pipeline.recordType,
        cliWorkspace.pipeline.eventKey,
        cliWorkspace.pipeline.targetRunId,
        cliWorkspace.pipeline.rawSha256,
        cliWorkspace.pipeline.preimagePrefixSha256,
        cliWorkspace.pipeline.expectedSha256,
      ]) {
        expect(serialized).toContain(value);
      }

      const repairToken = (cliPreview.body.value as JsonObject).repairToken as string;
      expect(repairToken).toBe((mcpPreview as { value: { repairToken: string } }).value.repairToken);
      const cliApplyArgs = [
        ...reclassifyArgs(cliWorkspace.pipeline, adapterFields),
        "--repair-token",
        repairToken,
      ];
      const mcpApplyInput = mcpInput(mcpWorkspace.pipeline, {
        ...adapterFields,
        dryRun: false,
        repairToken,
      });
      const cliApply = await invokeJson(cliWorkspace.root, cliApplyArgs);
      const mcpApply = await mcpServer.callTool("workflow_record_reclassification", mcpApplyInput);
      expect(cliApply.code).toBe(0);
      expectCompleteEnvelope(cliApply.body, true);
      expect(cliApply.body).toStrictEqual(mcpApply);

      const cliReplay = await invokeJson(cliWorkspace.root, cliApplyArgs);
      const mcpReplay = await mcpServer.callTool("workflow_record_reclassification", mcpApplyInput);
      expect(cliReplay.code).toBe(0);
      expectCompleteEnvelope(cliReplay.body, false);
      expect(cliReplay.body).toStrictEqual(mcpReplay);
    } finally {
      vi.useRealTimers();
    }
  });

  it("previews one typed append, requires the token, applies once, and replays before stale checks", async () => {
    const workspace = await createWorkspace();
    const before = await readFile(path.join(workspace.root, workspace.worklog.path), "utf8");
    const preview = await invokeJson(workspace.root, [
      ...reclassifyArgs(workspace.worklog),
      "--dry-run",
    ]);

    expect(preview.code).toBe(0);
    expectCompleteEnvelope(preview.body, false);
    const previewValue = valueOf(preview.body);
    expect(previewValue).toMatchObject({
      journalState: "skipped_dry_run",
      pendingRepair: { kind: "record_reclassification" },
      written: false,
    });
    expect(previewValue.repairToken).toEqual(expect.any(String));
    expect(preview.body.mutation).toMatchObject({
      dryRun: true,
      kind: "workflow_record_reclassification",
      written: false,
    });
    expect((preview.body.mutation as JsonObject).operations).toHaveLength(1);
    expect(await readFile(path.join(workspace.root, workspace.worklog.path), "utf8")).toBe(before);

    const missingToken = await invokeJson(
      workspace.root,
      reclassifyArgs(workspace.worklog),
    );
    expect(missingToken.code).not.toBe(0);
    expect(missingToken.body).toMatchObject({
      error: { code: "CLI_USAGE_ERROR" },
      ok: false,
    });

    const missingExpectedSha = await invokeJson(workspace.root, [
      ...withoutOption(reclassifyArgs(workspace.worklog), "--expected-sha256"),
      "--repair-token",
      previewValue.repairToken as string,
    ]);
    expect(missingExpectedSha.code).not.toBe(0);
    expect(missingExpectedSha.body).toMatchObject({ ok: false });
    expect(await readFile(path.join(workspace.root, workspace.worklog.path), "utf8")).toBe(before);

    const applyArgs = [
      ...reclassifyArgs(workspace.worklog),
      "--repair-token",
      previewValue.repairToken as string,
    ];
    const applied = await invokeJson(workspace.root, applyArgs);
    expect(applied.code).toBe(0);
    expectCompleteEnvelope(applied.body, true);
    expect(valueOf(applied.body)).toMatchObject({
      journalState: "confirmed",
      written: true,
    });
    expect(applied.body.mutation).toMatchObject({
      dryRun: false,
      kind: "workflow_record_reclassification",
      written: true,
    });

    const replay = await invokeJson(workspace.root, applyArgs);
    expect(replay.code).toBe(0);
    expectCompleteEnvelope(replay.body, false);
    expect(valueOf(replay.body)).toMatchObject({
      journalState: "confirmed",
      written: false,
    });

    const lines = (await readFile(path.join(workspace.root, workspace.worklog.path), "utf8"))
      .trimEnd()
      .split("\n")
      .map((line) => JSON.parse(line) as JsonObject);
    expect(lines.filter((entry) => entry.event === "record_reclassification")).toHaveLength(1);
  });

  it("returns structured nonzero exits for stale, identity, and path-kind failures", async () => {
    const staleWorkspace = await createWorkspace();
    const preview = await invokeJson(staleWorkspace.root, [
      ...reclassifyArgs(staleWorkspace.worklog),
      "--dry-run",
    ]);
    const token = valueOf(preview.body).repairToken as string;
    await writeFile(
      path.join(staleWorkspace.root, staleWorkspace.worklog.path),
      `${await readFile(path.join(staleWorkspace.root, staleWorkspace.worklog.path), "utf8")}${JSON.stringify({ event: "heartbeat", run_id: "repair-run", schema_version: "1.0.0", status: "RUNNING", ts: "2026-08-07T00:00:01.000Z" })}\n`,
      "utf8",
    );
    const stale = await invokeJson(staleWorkspace.root, [
      ...reclassifyArgs(staleWorkspace.worklog),
      "--repair-token",
      token,
    ]);
    expect(stale.code).not.toBe(0);
    expect(stale.body).toMatchObject({ ok: false });
    expect((stale.body.error as JsonObject).code).toMatch(/STALE|PREIMAGE|SHA/);
    expect(stale.body.mutation).toMatchObject({ written: false });

    const kindWorkspace = await createWorkspace();
    const wrongKind = await invokeJson(kindWorkspace.root, [
      ...reclassifyArgs({ ...kindWorkspace.worklog, recordType: "pipeline" }),
      "--dry-run",
    ]);
    expect(wrongKind.code).not.toBe(0);
    expect(wrongKind.body).toMatchObject({ ok: false });

    const identityWorkspace = await createWorkspace();
    const wrongIdentity = await invokeJson(identityWorkspace.root, [
      ...reclassifyArgs({ ...identityWorkspace.worklog, rawSha256: "0".repeat(64) }),
      "--dry-run",
    ]);
    expect(wrongIdentity.code).not.toBe(0);
    expect(wrongIdentity.body).toMatchObject({ ok: false });

    const tokenWorkspace = await createWorkspace();
    const invalidTokenBefore = await readFile(
      path.join(tokenWorkspace.root, tokenWorkspace.worklog.path),
      "utf8",
    );
    const invalidToken = await invokeJson(tokenWorkspace.root, [
      ...reclassifyArgs(tokenWorkspace.worklog),
      "--repair-token",
      "not-the-token-returned-by-dry-run",
    ]);
    expect(invalidToken.code).not.toBe(0);
    expect(invalidToken.body).toMatchObject({
      mutation: { written: false },
      ok: false,
    });
    expect(await readFile(path.join(tokenWorkspace.root, tokenWorkspace.worklog.path), "utf8")).toBe(
      invalidTokenBefore,
    );
  });

  it("fails closed on ambiguous resolution and unrelated diagnostics without changing bytes", async () => {
    const ambiguousWorkspace = await createWorkspace();
    const ambiguousContents = await readFile(
      path.join(ambiguousWorkspace.root, ambiguousWorkspace.pipeline.path),
      "utf8",
    );
    const candidatePaths = [
      ".kiwi/sessions/repair-run/a/pipeline.jsonl",
      ".kiwi/sessions/repair-run/b/pipeline.jsonl",
    ];
    const fixedMtime = new Date("2026-08-07T00:00:00.000Z");
    for (const candidatePath of candidatePaths) {
      const absolutePath = path.join(ambiguousWorkspace.root, candidatePath);
      await mkdir(path.dirname(absolutePath), { recursive: true });
      await writeFile(absolutePath, ambiguousContents, "utf8");
      await utimes(absolutePath, fixedMtime, fixedMtime);
    }
    const noPathArgs = reclassifyArgs(ambiguousWorkspace.pipeline);
    const pathOption = noPathArgs.indexOf("--path");
    noPathArgs.splice(pathOption, 2);
    const ambiguous = await invokeJson(ambiguousWorkspace.root, [...noPathArgs, "--dry-run"]);
    expect(ambiguous.code).not.toBe(0);
    expect(ambiguous.body).toMatchObject({
      mutation: { written: false },
      ok: false,
    });
    expect(JSON.stringify(ambiguous.body)).toContain("SRS-E051");
    for (const candidatePath of candidatePaths) {
      expect(await readFile(path.join(ambiguousWorkspace.root, candidatePath), "utf8")).toBe(
        ambiguousContents,
      );
    }

    const diagnosticWorkspace = await createWorkspace();
    const originalPipeline = await readFile(
      path.join(diagnosticWorkspace.root, diagnosticWorkspace.pipeline.path),
      "utf8",
    );
    const withUnrelatedDiagnostic = originalPipeline.replace(
      '"schema_version":"1.0.0"',
      '"schema_version":"9.9.9"',
    );
    await writeFile(
      path.join(diagnosticWorkspace.root, diagnosticWorkspace.pipeline.path),
      withUnrelatedDiagnostic,
      "utf8",
    );
    const updatedTarget = {
      ...diagnosticWorkspace.pipeline,
      expectedSha256: sha256(withUnrelatedDiagnostic),
      preimagePrefixSha256: sha256(withUnrelatedDiagnostic),
    };
    const unrelated = await invokeJson(diagnosticWorkspace.root, [
      ...reclassifyArgs(updatedTarget),
      "--dry-run",
    ]);
    expect(unrelated.code).not.toBe(0);
    expect(unrelated.body).toMatchObject({
      mutation: { written: false },
      ok: false,
    });
    expect(JSON.stringify(unrelated.body)).toContain("SRS-W055");
    expect(await readFile(path.join(diagnosticWorkspace.root, diagnosticWorkspace.pipeline.path), "utf8")).toBe(
      withUnrelatedDiagnostic,
    );
  });

  it("matches MCP field-for-field for stale, malformed, path-kind, ambiguous, conflict, unrelated, and generic failures", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-07T02:03:04.567Z"));
    try {
      const compareFailure = (cli: CliResult, mcp: unknown): void => {
        expect(cli.code).not.toBe(0);
        expect(cli.body).toStrictEqual(mcp);
        expect(cli.body).toMatchObject({ mutation: { written: false }, ok: false });
      };

      const malformedCli = await createWorkspace();
      const malformedMcp = await createWorkspace();
      const malformedRaw = '{"schema_version":"1.0.0","broken":';
      const malformedContents = `${malformedRaw}\r\n`;
      for (const workspace of [malformedCli, malformedMcp]) {
        await writeFile(
          path.join(workspace.root, workspace.pipeline.path),
          malformedContents,
          "utf8",
        );
      }
      const malformedTarget = (workspace: Workspace): RecordTarget => ({
        ...workspace.pipeline,
        byteOffset: 0,
        eventKey: "malformed|record",
        expectedSha256: sha256(malformedContents),
        line: 1,
        preimagePrefixSha256: sha256(malformedContents),
        rawSha256: sha256(malformedRaw),
        targetRunId: "malformed-record",
      });
      compareFailure(
        await invokeJson(malformedCli.root, [
          ...reclassifyArgs(malformedTarget(malformedCli)),
          "--dry-run",
        ]),
        await mutationServer(malformedMcp.root).callTool(
          "workflow_record_reclassification",
          mcpInput(malformedTarget(malformedMcp)),
        ),
      );

      const kindCli = await createWorkspace();
      const kindMcp = await createWorkspace();
      compareFailure(
        await invokeJson(kindCli.root, [
          ...reclassifyArgs({ ...kindCli.pipeline, recordType: "worklog" }),
          "--dry-run",
        ]),
        await mutationServer(kindMcp.root).callTool(
          "workflow_record_reclassification",
          mcpInput({ ...kindMcp.pipeline, recordType: "worklog" }),
        ),
      );

      const staleCli = await createWorkspace();
      const staleMcp = await createWorkspace();
      const staleCliPreview = await invokeJson(staleCli.root, [
        ...reclassifyArgs(staleCli.pipeline),
        "--dry-run",
      ]);
      const staleMcpServer = mutationServer(staleMcp.root);
      const staleMcpPreview = (await staleMcpServer.callTool(
        "workflow_record_reclassification",
        mcpInput(staleMcp.pipeline),
      )) as { value: { repairToken: string } };
      const intervening = `${JSON.stringify({ event: "heartbeat", run_id: "repair-run", schema_version: "1.0.0", status: "RUNNING", ts: "2026-08-07T02:03:05.000Z" })}\n`;
      for (const workspace of [staleCli, staleMcp]) {
        await writeFile(
          path.join(workspace.root, workspace.pipeline.path),
          `${await readFile(path.join(workspace.root, workspace.pipeline.path), "utf8")}${intervening}`,
          "utf8",
        );
      }
      compareFailure(
        await invokeJson(staleCli.root, [
          ...reclassifyArgs(staleCli.pipeline),
          "--repair-token",
          (staleCliPreview.body.value as JsonObject).repairToken as string,
        ]),
        await staleMcpServer.callTool(
          "workflow_record_reclassification",
          mcpInput(staleMcp.pipeline, {
            dryRun: false,
            repairToken: staleMcpPreview.value.repairToken,
          }),
        ),
      );

      const ambiguousCli = await createWorkspace();
      const ambiguousMcp = await createWorkspace();
      for (const workspace of [ambiguousCli, ambiguousMcp]) {
        const contents = await readFile(path.join(workspace.root, workspace.pipeline.path), "utf8");
        for (const candidate of ["a", "b"] ) {
          const absolutePath = path.join(
            workspace.root,
            `.kiwi/sessions/repair-run/${candidate}/pipeline.jsonl`,
          );
          await mkdir(path.dirname(absolutePath), { recursive: true });
          await writeFile(absolutePath, contents, "utf8");
          await utimes(
            absolutePath,
            new Date("2026-08-07T00:00:00.000Z"),
            new Date("2026-08-07T00:00:00.000Z"),
          );
        }
      }
      const ambiguousCliArgs = reclassifyArgs(ambiguousCli.pipeline);
      ambiguousCliArgs.splice(ambiguousCliArgs.indexOf("--path"), 2);
      const ambiguousMcpInput = mcpInput(ambiguousMcp.pipeline);
      delete ambiguousMcpInput.path;
      compareFailure(
        await invokeJson(ambiguousCli.root, [...ambiguousCliArgs, "--dry-run"]),
        await mutationServer(ambiguousMcp.root).callTool(
          "workflow_record_reclassification",
          ambiguousMcpInput,
        ),
      );

      const unrelatedCli = await createWorkspace();
      const unrelatedMcp = await createWorkspace();
      const unrelatedTargets: RecordTarget[] = [];
      for (const workspace of [unrelatedCli, unrelatedMcp]) {
        const absolutePath = path.join(workspace.root, workspace.pipeline.path);
        const contents = (await readFile(absolutePath, "utf8")).replace(
          '"schema_version":"1.0.0"',
          '"schema_version":"9.9.9"',
        );
        await writeFile(absolutePath, contents, "utf8");
        unrelatedTargets.push({
          ...workspace.pipeline,
          expectedSha256: sha256(contents),
          preimagePrefixSha256: sha256(contents),
        });
      }
      compareFailure(
        await invokeJson(unrelatedCli.root, [
          ...reclassifyArgs(unrelatedTargets[0] as RecordTarget),
          "--dry-run",
        ]),
        await mutationServer(unrelatedMcp.root).callTool(
          "workflow_record_reclassification",
          mcpInput(unrelatedTargets[1] as RecordTarget),
        ),
      );

      const conflictCli = await createWorkspace();
      const conflictMcp = await createWorkspace();
      const conflictMcpServer = mutationServer(conflictMcp.root);
      const left = { reason: "first overlay" };
      const right = { reason: "conflicting overlay" };
      const cliLeftPreview = await invokeJson(conflictCli.root, [
        ...reclassifyArgs(conflictCli.pipeline, left),
        "--dry-run",
      ]);
      const mcpLeftPreview = (await conflictMcpServer.callTool(
        "workflow_record_reclassification",
        mcpInput(conflictMcp.pipeline, left),
      )) as { value: { repairToken: string } };
      const cliRightPreview = await invokeJson(conflictCli.root, [
        ...reclassifyArgs(conflictCli.pipeline, right),
        "--dry-run",
      ]);
      const mcpRightPreview = (await conflictMcpServer.callTool(
        "workflow_record_reclassification",
        mcpInput(conflictMcp.pipeline, right),
      )) as { value: { repairToken: string } };
      await invokeJson(conflictCli.root, [
        ...reclassifyArgs(conflictCli.pipeline, left),
        "--repair-token",
        (cliLeftPreview.body.value as JsonObject).repairToken as string,
      ]);
      await conflictMcpServer.callTool(
        "workflow_record_reclassification",
        mcpInput(conflictMcp.pipeline, {
          ...left,
          dryRun: false,
          repairToken: mcpLeftPreview.value.repairToken,
        }),
      );
      compareFailure(
        await invokeJson(conflictCli.root, [
          ...reclassifyArgs(conflictCli.pipeline, right),
          "--repair-token",
          (cliRightPreview.body.value as JsonObject).repairToken as string,
        ]),
        await conflictMcpServer.callTool(
          "workflow_record_reclassification",
          mcpInput(conflictMcp.pipeline, {
            ...right,
            dryRun: false,
            repairToken: mcpRightPreview.value.repairToken,
          }),
        ),
      );

      const genericCli = await createWorkspace();
      const genericMcp = await createWorkspace();
      const genericPath = ".kiwi/sessions/generic-run/worklog.jsonl";
      const genericEvent = {
        ...correctionRecord("generic-run"),
        corrects_run_id: "   ",
      };
      for (const workspace of [genericCli, genericMcp]) {
        const absolutePath = path.join(workspace.root, genericPath);
        await mkdir(path.dirname(absolutePath), { recursive: true });
        await writeFile(absolutePath, "", "utf8");
      }
      compareFailure(
        await invokeJson(genericCli.root, [
          "workflow",
          "repair-record",
          "--run-id",
          "generic-run",
          "--path",
          genericPath,
          "--owner",
          "kiwi-srs",
          "--event",
          JSON.stringify(genericEvent),
        ]),
        await mutationServer(genericMcp.root).callTool("workflow_repair_record", {
          event: genericEvent,
          owner: "kiwi-srs",
          path: genericPath,
          runId: "generic-run",
        }),
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("serializes identical and conflicting concurrent applies without duplicate overlays", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-07T03:04:05.678Z"));
    try {
      const identicalCli = await createWorkspace();
      const identicalMcp = await createWorkspace();
      const identicalCliPreview = await invokeJson(identicalCli.root, [
        ...reclassifyArgs(identicalCli.worklog),
        "--dry-run",
      ]);
      const identicalMcpServer = mutationServer(identicalMcp.root);
      const identicalMcpPreview = (await identicalMcpServer.callTool(
        "workflow_record_reclassification",
        mcpInput(identicalMcp.worklog),
      )) as { value: { repairToken: string } };
      const identicalCliArgs = [
        ...reclassifyArgs(identicalCli.worklog),
        "--repair-token",
        valueOf(identicalCliPreview.body).repairToken as string,
      ];
      const identicalMcpInput = mcpInput(identicalMcp.worklog, {
        dryRun: false,
        repairToken: identicalMcpPreview.value.repairToken,
      });
      const identicalCliResults = await Promise.all([
        invokeJson(identicalCli.root, identicalCliArgs),
        invokeJson(identicalCli.root, identicalCliArgs),
      ]);
      const identicalMcpResults = await Promise.all([
        identicalMcpServer.callTool("workflow_record_reclassification", identicalMcpInput),
        identicalMcpServer.callTool("workflow_record_reclassification", identicalMcpInput),
      ]);
      expect(identicalCliResults.map((result) => result.code)).toEqual([0, 0]);
      expect(identicalCliResults.map((result) => result.body)).toStrictEqual(identicalMcpResults);
      expect(
        identicalCliResults.map((result) => (result.body.value as JsonObject).written).sort(),
      ).toEqual([false, true]);
      const identicalLines = (
        await readFile(path.join(identicalCli.root, identicalCli.worklog.path), "utf8")
      )
        .trimEnd()
        .split("\n")
        .map((line) => JSON.parse(line) as JsonObject);
      expect(identicalLines.filter((entry) => entry.event === "record_reclassification")).toHaveLength(1);

      const conflictingCli = await createWorkspace();
      const conflictingMcp = await createWorkspace();
      const conflictingMcpServer = mutationServer(conflictingMcp.root);
      const leftFields = { reason: "left classification" };
      const rightFields = { reason: "right classification" };
      const [leftCliPreview, rightCliPreview] = await Promise.all([
        invokeJson(conflictingCli.root, [
          ...reclassifyArgs(conflictingCli.pipeline, leftFields),
          "--dry-run",
        ]),
        invokeJson(conflictingCli.root, [
          ...reclassifyArgs(conflictingCli.pipeline, rightFields),
          "--dry-run",
        ]),
      ]);
      const [leftMcpPreview, rightMcpPreview] = (await Promise.all([
        conflictingMcpServer.callTool(
          "workflow_record_reclassification",
          mcpInput(conflictingMcp.pipeline, leftFields),
        ),
        conflictingMcpServer.callTool(
          "workflow_record_reclassification",
          mcpInput(conflictingMcp.pipeline, rightFields),
        ),
      ])) as Array<{ value: { repairToken: string } }>;
      const conflictingCliResults = await Promise.all([
        invokeJson(conflictingCli.root, [
          ...reclassifyArgs(conflictingCli.pipeline, leftFields),
          "--repair-token",
          valueOf(leftCliPreview.body).repairToken as string,
        ]),
        invokeJson(conflictingCli.root, [
          ...reclassifyArgs(conflictingCli.pipeline, rightFields),
          "--repair-token",
          valueOf(rightCliPreview.body).repairToken as string,
        ]),
      ]);
      const conflictingMcpResults = await Promise.all([
        conflictingMcpServer.callTool(
          "workflow_record_reclassification",
          mcpInput(conflictingMcp.pipeline, {
            ...leftFields,
            dryRun: false,
            repairToken: leftMcpPreview!.value.repairToken,
          }),
        ),
        conflictingMcpServer.callTool(
          "workflow_record_reclassification",
          mcpInput(conflictingMcp.pipeline, {
            ...rightFields,
            dryRun: false,
            repairToken: rightMcpPreview!.value.repairToken,
          }),
        ),
      ]);
      expect(conflictingCliResults.map((result) => result.body)).toStrictEqual(conflictingMcpResults);
      expect(
        conflictingCliResults.filter(
          (result) => result.code === 0 && (result.body.value as JsonObject | undefined)?.written === true,
        ),
      ).toHaveLength(1);
      expect(
        conflictingCliResults.filter(
          (result) => result.code !== 0 || (result.body.value as JsonObject | undefined)?.written === false,
        ),
      ).toHaveLength(1);
      const conflictingText = await readFile(
        path.join(conflictingCli.root, conflictingCli.pipeline.path),
        "utf8",
      );
      expect(
        conflictingText
          .trimEnd()
          .split(/\r?\n/)
          .map((line) => JSON.parse(line) as JsonObject)
          .filter((entry) => entry.event === "record_reclassification"),
      ).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("rejects whitespace-only generic correction targets before confirmation or mutation", async () => {
    const workspace = await createWorkspace();
    const genericPath = ".kiwi/sessions/generic-run/worklog.jsonl";
    await mkdir(path.dirname(path.join(workspace.root, genericPath)), { recursive: true });
    await writeFile(path.join(workspace.root, genericPath), "", "utf8");
    const before = await readFile(path.join(workspace.root, genericPath), "utf8");
    const result = await invokeJson(workspace.root, [
      "workflow",
      "repair-record",
      "--run-id",
      "generic-run",
      "--event",
      JSON.stringify({ ...correctionRecord("generic-run"), corrects_run_id: "   " }),
    ]);

    expect(result.code).not.toBe(0);
    expect(result.body).toMatchObject({ ok: false });
    expect(await readFile(path.join(workspace.root, genericPath), "utf8")).toBe(before);
  });

  it("converges named and derived readers while tail views retain original and overlay records", async () => {
    const workspace = await createWorkspace();
    const pipelinePreimage = await readFile(
      path.join(workspace.root, workspace.pipeline.path),
      "utf8",
    );
    const worklogApply = await previewAndApply(workspace.root, workspace.worklog);
    const pipelineApply = await previewAndApply(workspace.root, workspace.pipeline);
    expect(worklogApply.code).toBe(0);
    expect(pipelineApply.code).toBe(0);
    const durablePipeline = await readFile(path.join(workspace.root, workspace.pipeline.path), "utf8");
    expect(
      Buffer.from(durablePipeline, "utf8").subarray(0, Buffer.byteLength(pipelinePreimage, "utf8")),
    ).toEqual(Buffer.from(pipelinePreimage, "utf8"));
    expect(pipelinePreimage).toContain("\r\n");

    const readers: string[][] = [
      ["workflow", "next-task", "--path", workspace.planPath],
      ["workflow", "doctor", "--path", workspace.planPath],
      ["workflow", "diff", "--path", workspace.planPath],
      ["workflow", "schema-check", "--path", workspace.planPath],
      ["workflow", "pipeline-status"],
      ["workflow", "pipeline", "status"],
      ["workflow", "pipeline-tail"],
      ["workflow", "pipeline", "tail"],
      ["workflow", "pipeline-next"],
      ["workflow", "pipeline-compact"],
      ["workflow", "pipeline", "compact"],
      ["workflow", "worklog-tail", "--run-id", "repair-run"],
      ["workflow", "session-status", "--run-id", "repair-run"],
      ["workflow", "resume-hint", "--path", workspace.planPath],
      ["workflow", "work-order", "next", "--path", workspace.planPath],
    ];

    for (const args of readers) {
      const result = await invokeJson(workspace.root, args);
      expect(result.code, args.join(" ")).toBe(0);
      expect(result.stdout, args.join(" ")).not.toContain("SRS-W054");
    }

    for (const args of [
      ["workflow", "pipeline-tail"],
      ["workflow", "pipeline", "tail"],
    ]) {
      const tail = await invokeJson(workspace.root, args);
      expect(tail.stdout).toContain("legacy-pipeline-record");
      expect(tail.stdout).toContain("record_reclassification");
    }
    const worklogTail = await invokeJson(workspace.root, [
      "workflow",
      "worklog-tail",
      "--run-id",
      "repair-run",
    ]);
    expect(worklogTail.stdout).toContain("legacy-worklog-record");
    expect(worklogTail.stdout).toContain("record_reclassification");
  });

  it("returns field-for-field MCP parity for every named reader and CLI alias", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-07T04:05:06.789Z"));
    try {
      const cliWorkspace = await createWorkspace();
      const mcpWorkspace = await createWorkspace();
      const server = mutationServer(mcpWorkspace.root);
      await previewAndApply(cliWorkspace.root, cliWorkspace.pipeline);
      await previewAndApply(cliWorkspace.root, cliWorkspace.worklog);
      await mcpPreviewAndApply(server, mcpWorkspace.pipeline);
      await mcpPreviewAndApply(server, mcpWorkspace.worklog);

      const cases: Array<{
        cli: string[];
        input: JsonObject;
        tool: string;
      }> = [
        {
          cli: ["workflow", "next-task", "--path", cliWorkspace.planPath],
          input: { path: mcpWorkspace.planPath },
          tool: "workflow_next_plan_task",
        },
        {
          cli: ["workflow", "doctor", "--path", cliWorkspace.planPath],
          input: { path: mcpWorkspace.planPath },
          tool: "workflow_doctor",
        },
        {
          cli: ["workflow", "diff", "--path", cliWorkspace.planPath],
          input: { path: mcpWorkspace.planPath },
          tool: "workflow_diff",
        },
        {
          cli: ["workflow", "schema-check", "--path", cliWorkspace.planPath],
          input: { path: mcpWorkspace.planPath },
          tool: "workflow_schema_check",
        },
        { cli: ["workflow", "pipeline-status"], input: {}, tool: "workflow_pipeline_status" },
        { cli: ["workflow", "pipeline", "status"], input: {}, tool: "workflow_pipeline_status" },
        { cli: ["workflow", "pipeline-tail"], input: {}, tool: "workflow_pipeline_tail" },
        { cli: ["workflow", "pipeline", "tail"], input: {}, tool: "workflow_pipeline_tail" },
        { cli: ["workflow", "pipeline-next"], input: {}, tool: "workflow_pipeline_next" },
        { cli: ["workflow", "pipeline-compact"], input: {}, tool: "workflow_pipeline_compact" },
        { cli: ["workflow", "pipeline", "compact"], input: {}, tool: "workflow_pipeline_compact" },
        {
          cli: ["workflow", "worklog-tail", "--run-id", "repair-run"],
          input: { runId: "repair-run" },
          tool: "workflow_worklog_tail",
        },
        {
          cli: ["workflow", "session-status", "--run-id", "repair-run"],
          input: { runId: "repair-run" },
          tool: "workflow_session_status",
        },
        {
          cli: ["workflow", "resume-hint", "--path", cliWorkspace.planPath],
          input: { path: mcpWorkspace.planPath },
          tool: "workflow_resume_hint",
        },
        {
          cli: ["workflow", "work-order", "next", "--path", cliWorkspace.planPath],
          input: { path: mcpWorkspace.planPath },
          tool: "get_next_work_order",
        },
      ];

      for (const parityCase of cases) {
        const cli = await invokeJson(cliWorkspace.root, parityCase.cli);
        const mcp = await server.callTool(parityCase.tool, parityCase.input);
        expect(cli.code, parityCase.cli.join(" ")).toBe(0);
        expect(cli.body, parityCase.cli.join(" ")).toStrictEqual(mcp);
      }
    } finally {
      vi.useRealTimers();
    }
  });
});
