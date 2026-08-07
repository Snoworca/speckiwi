import { createHash } from "node:crypto";
import { watch } from "node:fs";
import { mkdir, readFile, readdir, rm, stat, utimes, writeFile } from "node:fs/promises";
import path from "node:path";
import { PassThrough } from "node:stream";

import { describe, expect, it, vi } from "vitest";

import { main } from "../../src/cli/index.js";
import { createTestMcpServer } from "../../src/mcp/adapter.js";
import { registerMutationTools } from "../../src/mcp/tools/mutation-tools.js";
import { registerReadTools } from "../../src/mcp/tools/read-tools.js";
import * as jsonlModule from "../../src/core/workflow/jsonl.js";
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

const sha256 = (value: string | Buffer): string =>
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

async function observeArtifactEvents<T>(root: string, action: () => Promise<T>): Promise<{
  events: string[];
  result: T;
}> {
  const events: string[] = [];
  const watcher = watch(root, { recursive: true }, (_eventType, filename) => {
    if (filename !== null) events.push(filename.toString().replaceAll("\\", "/"));
  });
  try {
    const result = await action();
    await new Promise<void>((resolve) => setTimeout(resolve, 25));
    return { events, result };
  } finally {
    watcher.close();
  }
}

async function workspaceTreeSnapshot(root: string): Promise<Array<{
  kind: "directory" | "file";
  path: string;
  sha256?: string;
}>> {
  const relativePaths = (await readdir(root, { recursive: true }))
    .map((entry) => entry.replaceAll("\\", "/"))
    .sort();
  return Promise.all(relativePaths.map(async (relativePath) => {
    const absolutePath = path.join(root, relativePath);
    const metadata = await stat(absolutePath);
    return metadata.isFile()
      ? { kind: "file" as const, path: relativePath, sha256: sha256(await readFile(absolutePath)) }
      : { kind: "directory" as const, path: relativePath };
  }));
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

function mcpSemantic(result: unknown, expectedRoot: string): JsonObject {
  const body = structuredClone(result) as JsonObject;
  expect(body.mcpWorkspace).toStrictEqual({
    indexPath: "docs/spec/00.index.md",
    packageVersion: expect.any(String),
    rootSource: "server-cwd-discovery",
    workspaceRoot: expectedRoot,
  });
  delete body.mcpWorkspace;
  return body;
}

function canonicalFailure(bodyValue: unknown, mcp: boolean, expectedRoot?: string): JsonObject {
  const body = structuredClone(bodyValue) as JsonObject;
  if (mcp) {
    expect(expectedRoot).toEqual(expect.any(String));
    expect(body.mcpWorkspace).toStrictEqual({
      indexPath: "docs/spec/00.index.md",
      packageVersion: expect.any(String),
      rootSource: "server-cwd-discovery",
      workspaceRoot: expectedRoot,
    });
  }
  delete body.mcpWorkspace;
  const error = body.error as JsonObject;
  const nestedDiagnostics = error.diagnostics;
  const nestedStaleGuard = error.staleGuard;
  const topLevelStaleGuard = body.staleGuard;
  const effectiveStaleGuard = nestedStaleGuard ?? topLevelStaleGuard;
  if (mcp && effectiveStaleGuard !== undefined) {
    expect(body.recovery).toStrictEqual({
      message: String((effectiveStaleGuard as JsonObject).retry ?? "Retry the mutation."),
      tool: "retry_mutation",
    });
  } else if (mcp) {
    expect(body.recovery).toBeUndefined();
  }
  delete body.recovery;
  if (nestedDiagnostics !== undefined) {
    expect(nestedDiagnostics).toStrictEqual(body.diagnostics);
  }
  delete error.diagnostics;
  delete error.staleGuard;
  delete body.staleGuard;
  body.error = error;
  body.canonicalFailureContext = {
    diagnostics: body.diagnostics,
    staleGuard: effectiveStaleGuard ?? null,
  };
  return body;
}

function expectSuccessParity(cli: JsonObject, mcp: unknown, expectedRoot: string): void {
  expect(cli).toStrictEqual(mcpSemantic(mcp, expectedRoot));
}

function expectFailureParity(cli: JsonObject, mcp: unknown, expectedRoot: string): void {
  expect(canonicalFailure(cli, false)).toStrictEqual(canonicalFailure(mcp, true, expectedRoot));
}

function semanticOutcome(body: JsonObject, mcp: boolean, expectedRoot?: string): JsonObject {
  return body.ok === true
    ? (mcp ? mcpSemantic(body, expectedRoot!) : structuredClone(body))
    : canonicalFailure(body, mcp, expectedRoot);
}

function sortOutcomes(values: JsonObject[], mcp: boolean, expectedRoot?: string): JsonObject[] {
  return values
    .map((value) => semanticOutcome(value, mcp, expectedRoot))
    .sort((left, right) => {
      const leftWritten = (left.value as JsonObject | undefined)?.written === true ? 1 : 0;
      const rightWritten = (right.value as JsonObject | undefined)?.written === true ? 1 : 0;
      if (leftWritten !== rightWritten) return leftWritten - rightWritten;
      return JSON.stringify(left).localeCompare(JSON.stringify(right));
    });
}

function concurrentOutcomeClass(body: JsonObject): "loser" | "writer" {
  if (body.ok === true && (body.value as JsonObject).written === true) return "writer";
  expect(body).toMatchObject({
    mutation: { written: false },
    ok: false,
  });
  const error = body.error as JsonObject;
  const diagnostics = body.diagnostics as JsonObject[];
  if (error.code === "STALE_PATCH") {
    expect(diagnostics.map((item) => item.code)).toStrictEqual(["SRS-E032"]);
    expect(body.diagnosticsSummary).toStrictEqual({
      byCode: { "SRS-E032": 1 },
      errors: 1,
      warnings: 0,
    });
    expect(error.message).toMatch(/stale/i);
    return "loser";
  }
  if (error.diagnostics !== undefined) {
    expect(error.diagnostics).toStrictEqual(diagnostics);
  }
  const errorContract = { ...error };
  delete errorContract.diagnostics;
  expect(errorContract).toStrictEqual({
    code: "MUTATION_DENIED",
    message: "Conflicting non-identical record reclassification overlay",
  });
  expect(diagnostics).toStrictEqual([
    {
      code: "SRS-E071",
      details: {
        line: expect.any(Number),
        path: expect.any(String),
      },
      message: "Conflicting non-identical record reclassification overlay",
      severity: "error",
    },
  ]);
  expect(JSON.stringify(diagnostics)).not.toMatch(/identity|repairToken|token/i);
  return "loser";
}

function expectWinnerMatchesDurable(winner: JsonObject, durable: string): void {
  const operation = ((winner.operations as JsonObject[])[0]!.lines as string[])[0]!;
  const returnedOverlay = JSON.parse(operation) as JsonObject;
  const durableOverlay = durable
    .trimEnd()
    .split(/\r?\n/)
    .map((line) => JSON.parse(line) as JsonObject)
    .find((entry) => entry.event === "record_reclassification")!;
  expect(durableOverlay).toStrictEqual(returnedOverlay);
  expect(durableOverlay.journal_key).toBe(winner.journalKey);
  expect(durableOverlay.reason).toEqual(expect.any(String));
  expect((durableOverlay.reason as string).length).toBeGreaterThan(0);
  const target = winner.targetRecord as JsonObject;
  expect(durableOverlay.operation).toMatchObject({
    byte_offset: target.byteOffset,
    event_key: target.eventKey,
    preimage_prefix_sha256: target.preimagePrefixSha256,
    raw_sha256: target.rawSha256,
    record_type: target.recordType,
    source_line: target.line,
    source_path: target.path,
    target_run_id: target.targetRunId,
  });
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

async function replaceOverlayTimestamp(root: string, relativePath: string, timestamp: string): Promise<void> {
  const absolutePath = path.join(root, relativePath);
  const text = await readFile(absolutePath, "utf8");
  const markerIndex = text.indexOf('"event":"record_reclassification"');
  expect(markerIndex).toBeGreaterThanOrEqual(0);
  const lineStart = text.lastIndexOf("\n", markerIndex) + 1;
  const lineEnd = text.indexOf("\n", markerIndex);
  expect(lineEnd).toBeGreaterThan(markerIndex);
  const overlay = JSON.parse(text.slice(lineStart, lineEnd)) as JsonObject;
  overlay.ts = timestamp;
  await writeFile(
    absolutePath,
    `${text.slice(0, lineStart)}${JSON.stringify(overlay)}${text.slice(lineEnd)}`,
    "utf8",
  );
}

function expectPostAppendFailure(
  body: JsonObject,
  kind: "record_reclassification_confirmation" | "record_reclassification_lock_cleanup",
  relativePath: string,
): void {
  const expectedCompleted = kind === "record_reclassification_confirmation"
    ? ["write:workflow_record_reclassification"]
    : ["write:workflow_record_reclassification", "confirm:workflow_record_reclassification"];
  const expectedPending = kind === "record_reclassification_confirmation"
    ? ["confirm:workflow_record_reclassification"]
    : ["cleanup:workflow_record_reclassification"];
  expect(body).toMatchObject({
    diagnostics: [expect.objectContaining({ code: expect.any(String), severity: expect.any(String) })],
    diagnosticsSummary: expect.any(Object),
    error: {
      code: "MUTATION_DENIED",
    },
    mutation: {
      completedOperations: expectedCompleted,
      journalState: "failed",
      pendingOperations: expectedPending,
      pendingRepair: {
        artifact: {
          postAppendSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
          relativePath,
        },
        kind,
        overlayEventKey: expect.any(String),
        targetRecord: expect.any(Object),
        retry: {
          action: "retry_same_record_reclassification",
          mode: kind === "record_reclassification_confirmation" ? "confirm_only" : "cleanup_then_replay",
        },
      },
      written: false,
    },
    ok: false,
  });
  if (kind === "record_reclassification_lock_cleanup") {
    expect(body).toMatchObject({
      mutation: {
        pendingRepair: {
          cleanupDiagnostic: expect.objectContaining({ code: expect.any(String), severity: expect.any(String) }),
          lock: {
            ownerIdentitySha256: expect.stringMatching(/^[a-f0-9]{64}$/),
            relativePath: expect.any(String),
          },
        },
      },
    });
  }
  const nestedDiagnostics = (body.error as JsonObject).diagnostics;
  if (nestedDiagnostics !== undefined) expect(nestedDiagnostics).toStrictEqual(body.diagnostics);
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
      expectSuccessParity(cliPreview.body, mcpPreview, mcpWorkspace.root);
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
            targetRunId: cliWorkspace.pipeline.targetRunId,
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
            targetRunId: cliWorkspace.pipeline.targetRunId,
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
      expectSuccessParity(cliApply.body, mcpApply, mcpWorkspace.root);

      const cliReplay = await invokeJson(cliWorkspace.root, cliApplyArgs);
      const mcpReplay = await mcpServer.callTool("workflow_record_reclassification", mcpApplyInput);
      expect(cliReplay.code).toBe(0);
      expectCompleteEnvelope(cliReplay.body, false);
      expectSuccessParity(cliReplay.body, mcpReplay, mcpWorkspace.root);
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

  // @req IR-CLI-089 AC-2/6; FR-MCP-057 AC-2/6; FR-NODE-177 AC-4/11
  it("keeps CLI and MCP dry-runs artifact-free, including transient lock events", async () => {
    const cliWorkspace = await createWorkspace();
    const cliTreeBefore = await workspaceTreeSnapshot(cliWorkspace.root);
    const cliObservation = await observeArtifactEvents(cliWorkspace.root, () =>
      invokeJson(cliWorkspace.root, [...reclassifyArgs(cliWorkspace.pipeline), "--dry-run"]),
    );
    expect(cliObservation.result.code).toBe(0);
    expect(cliObservation.events).toStrictEqual([]);
    expect(await workspaceTreeSnapshot(cliWorkspace.root)).toStrictEqual(cliTreeBefore);

    const mcpWorkspace = await createWorkspace();
    const mcpTreeBefore = await workspaceTreeSnapshot(mcpWorkspace.root);
    const server = mutationServer(mcpWorkspace.root);
    const mcpObservation = await observeArtifactEvents(mcpWorkspace.root, () =>
      server.callTool(
        "workflow_record_reclassification",
        mcpInput(mcpWorkspace.pipeline, { dryRun: true }),
      ),
    );
    expect(mcpObservation.result).toMatchObject({ ok: true, mutation: { written: false } });
    expect(mcpObservation.events).toStrictEqual([]);
    expect(await workspaceTreeSnapshot(mcpWorkspace.root)).toStrictEqual(mcpTreeBefore);
    expectSuccessParity(cliObservation.result.body, mcpObservation.result, mcpWorkspace.root);
  });

  // @req IR-CLI-089 AC-4/6; FR-MCP-057 AC-4/6; FR-NODE-177 AC-5/11
  it("validates missing and tampered tokens before an otherwise exact CLI or MCP replay", async () => {
    const cliWorkspace = await createWorkspace();
    const cliPreview = await invokeJson(cliWorkspace.root, [
      ...reclassifyArgs(cliWorkspace.pipeline),
      "--dry-run",
    ]);
    const cliToken = valueOf(cliPreview.body).repairToken as string;
    expect((await invokeJson(cliWorkspace.root, [
      ...reclassifyArgs(cliWorkspace.pipeline),
      "--repair-token",
      cliToken,
    ])).code).toBe(0);
    const cliDurable = await readFile(path.join(cliWorkspace.root, cliWorkspace.pipeline.path), "utf8");
    const cliTreeAfterApply = await workspaceTreeSnapshot(cliWorkspace.root);
    const cliMissing = await invokeJson(cliWorkspace.root, reclassifyArgs(cliWorkspace.pipeline));
    const cliTampered = await invokeJson(cliWorkspace.root, [
      ...reclassifyArgs(cliWorkspace.pipeline),
      "--repair-token",
      `${cliToken}-tampered`,
    ]);
    expect(cliMissing.code).not.toBe(0);
    expect(cliTampered.code).not.toBe(0);
    expect(cliTampered.body).toMatchObject({ ok: false, mutation: { written: false } });
    expect(await readFile(path.join(cliWorkspace.root, cliWorkspace.pipeline.path), "utf8")).toBe(cliDurable);
    expect(await workspaceTreeSnapshot(cliWorkspace.root)).toStrictEqual(cliTreeAfterApply);

    const mcpWorkspace = await createWorkspace();
    const server = mutationServer(mcpWorkspace.root);
    const mcpPreview = await server.callTool(
      "workflow_record_reclassification",
      mcpInput(mcpWorkspace.pipeline, { dryRun: true }),
    ) as { value: { repairToken: string } };
    const mcpApplyInput = mcpInput(mcpWorkspace.pipeline, {
      dryRun: false,
      repairToken: mcpPreview.value.repairToken,
    });
    expect(await server.callTool("workflow_record_reclassification", mcpApplyInput)).toMatchObject({ ok: true });
    const mcpDurable = await readFile(path.join(mcpWorkspace.root, mcpWorkspace.pipeline.path), "utf8");
    const mcpTreeAfterApply = await workspaceTreeSnapshot(mcpWorkspace.root);
    const { repairToken: _repairToken, ...mcpMissingInput } = mcpApplyInput;
    void _repairToken;
    const mcpMissing = await server.callTool("workflow_record_reclassification", mcpMissingInput);
    const mcpTampered = await server.callTool("workflow_record_reclassification", {
      ...mcpApplyInput,
      repairToken: `${mcpPreview.value.repairToken}-tampered`,
    });
    expect(mcpMissing).toMatchObject({ ok: false });
    expect(mcpTampered).toMatchObject({ ok: false, mutation: { written: false } });
    expect(await readFile(path.join(mcpWorkspace.root, mcpWorkspace.pipeline.path), "utf8")).toBe(mcpDurable);
    expect(await workspaceTreeSnapshot(mcpWorkspace.root)).toStrictEqual(mcpTreeAfterApply);
    expectFailureParity(cliTampered.body, mcpTampered, mcpWorkspace.root);
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
    await rm(path.join(ambiguousWorkspace.root, ambiguousWorkspace.pipeline.path));
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
      const compareFailure = (cli: CliResult, mcp: unknown, expectedRoot: string): void => {
        expect(cli.code).not.toBe(0);
        expectFailureParity(cli.body, mcp, expectedRoot);
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
        malformedMcp.root,
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
        kindMcp.root,
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
        staleMcp.root,
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
        await rm(path.join(workspace.root, workspace.pipeline.path));
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
        ambiguousMcp.root,
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
        unrelatedMcp.root,
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
        conflictMcp.root,
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
        genericMcp.root,
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
      expect(sortOutcomes(identicalCliResults.map((result) => result.body), false)).toStrictEqual(
        sortOutcomes(identicalMcpResults as JsonObject[], true, identicalMcp.root),
      );
      expect(
        identicalCliResults.map((result) => (result.body.value as JsonObject).written).sort(),
      ).toEqual([false, true]);
      const identicalCliWinner = identicalCliResults.find(
        (result) => (result.body.value as JsonObject).written === true,
      )!.body.value as JsonObject;
      const identicalMcpWinner = (identicalMcpResults as JsonObject[]).find(
        (result) => (result.value as JsonObject).written === true,
      )!.value as JsonObject;
      expect(identicalCliWinner.targetRecord).toStrictEqual(identicalMcpWinner.targetRecord);
      expect(identicalCliWinner.journalKey).toBe(identicalMcpWinner.journalKey);
      const identicalLines = (
        await readFile(path.join(identicalCli.root, identicalCli.worklog.path), "utf8")
      )
        .trimEnd()
        .split("\n")
        .map((line) => JSON.parse(line) as JsonObject);
      expect(identicalLines.filter((entry) => entry.event === "record_reclassification")).toHaveLength(1);
      const identicalMcpLines = (
        await readFile(path.join(identicalMcp.root, identicalMcp.worklog.path), "utf8")
      )
        .trimEnd()
        .split("\n")
        .map((line) => JSON.parse(line) as JsonObject);
      expect(identicalMcpLines.filter((entry) => entry.event === "record_reclassification")).toHaveLength(1);

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
      expect(
        conflictingCliResults.map((result) => concurrentOutcomeClass(result.body)).sort(),
      ).toEqual(["loser", "writer"]);
      const conflictingMcpSemantics = (conflictingMcpResults as JsonObject[]).map((result) =>
        semanticOutcome(result, true, conflictingMcp.root),
      );
      expect(conflictingMcpSemantics.map(concurrentOutcomeClass).sort()).toEqual(["loser", "writer"]);
      const conflictingCliWinner = conflictingCliResults.find(
        (result) => (result.body.value as JsonObject | undefined)?.written === true,
      )!.body.value as JsonObject;
      const conflictingMcpWinner = conflictingMcpSemantics.find(
        (result) => (result.value as JsonObject | undefined)?.written === true,
      )!.value as JsonObject;
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
      const conflictingMcpText = await readFile(
        path.join(conflictingMcp.root, conflictingMcp.pipeline.path),
        "utf8",
      );
      expect(
        conflictingMcpText
          .trimEnd()
          .split(/\r?\n/)
          .map((line) => JSON.parse(line) as JsonObject)
          .filter((entry) => entry.event === "record_reclassification"),
      ).toHaveLength(1);
      expectWinnerMatchesDurable(conflictingCliWinner, conflictingText);
      expectWinnerMatchesDurable(conflictingMcpWinner, conflictingMcpText);
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

  // @req IR-CLI-089 AC-4/6; FR-MCP-057 AC-4/6; FR-NODE-177 AC-6/11
  it("preserves the exact confirmation-pending envelope and diagnostics through CLI and MCP", async () => {
    const cliWorkspace = await createWorkspace();
    const cliPreview = await invokeJson(cliWorkspace.root, [
      ...reclassifyArgs(cliWorkspace.pipeline),
      "--dry-run",
    ]);
    const cliToken = valueOf(cliPreview.body).repairToken as string;

    const mcpWorkspace = await createWorkspace();
    const server = mutationServer(mcpWorkspace.root);
    const mcpPreview = await server.callTool(
      "workflow_record_reclassification",
      mcpInput(mcpWorkspace.pipeline, { dryRun: true }),
    ) as { value: { repairToken: string } };

    const realParse = jsonlModule.parseWorkflowJsonl;
    const parseSpy = vi.spyOn(jsonlModule, "parseWorkflowJsonl").mockImplementation(async (...args) => {
      const parsed = await realParse(...args);
      if (!parsed.entries.some((entry) => entry.event.event === "record_reclassification")) return parsed;
      return {
        ...parsed,
        diagnostics: [
          ...parsed.diagnostics,
          {
            code: "SRS-W052",
            filePath: parsed.relativePath,
            message: "Injected authoritative record reclassification read-back failure",
            severity: "warning" as const,
          },
        ],
      };
    });
    try {
      const cli = await invokeJson(cliWorkspace.root, [
        ...reclassifyArgs(cliWorkspace.pipeline),
        "--repair-token",
        cliToken,
      ]);
      const mcp = await server.callTool(
        "workflow_record_reclassification",
        mcpInput(mcpWorkspace.pipeline, {
          dryRun: false,
          repairToken: mcpPreview.value.repairToken,
        }),
      );

      expect(cli.code).not.toBe(0);
      expectPostAppendFailure(cli.body, "record_reclassification_confirmation", cliWorkspace.pipeline.path);
      expectPostAppendFailure(mcp as JsonObject, "record_reclassification_confirmation", mcpWorkspace.pipeline.path);
      expectFailureParity(cli.body, mcp, mcpWorkspace.root);
      expect(await readFile(path.join(cliWorkspace.root, cliWorkspace.pipeline.path), "utf8"))
        .toContain('"event":"record_reclassification"');
      expect(await readFile(path.join(mcpWorkspace.root, mcpWorkspace.pipeline.path), "utf8"))
        .toContain('"event":"record_reclassification"');
    } finally {
      parseSpy.mockRestore();
    }
  });

  // @req FR-MCP-057 AC-4/6; FR-NODE-177 AC-6/11
  it("serializes the exact cleanup-pending core envelope through MCP without field loss", async () => {
    const workspace = await createWorkspace();
    const treeBefore = await workspaceTreeSnapshot(workspace.root);
    const cleanupDiagnostic = {
      code: "SRS-E071",
      details: { operation: "owner-verified-release", retryable: true },
      filePath: workspace.pipeline.path,
      message: "Owner-verified record reclassification lock cleanup failed",
      severity: "error" as const,
    };
    const pendingRepair = {
      artifact: {
        postAppendSha256: "d".repeat(64),
        relativePath: workspace.pipeline.path,
      },
      cleanupDiagnostic,
      kind: "record_reclassification_lock_cleanup",
      lock: {
        ownerIdentitySha256: "e".repeat(64),
        relativePath: `${workspace.pipeline.path}.record-reclassification.lock`,
      },
      overlayEventKey: "speckiwi|record-reclassification-deadbeefdeadbeef",
      retry: {
        action: "retry_same_record_reclassification",
        mode: "cleanup_then_replay",
      },
      targetRecord: { ...workspace.pipeline },
    };
    const completedOperations = [
      "write:workflow_record_reclassification",
      "confirm:workflow_record_reclassification",
    ];
    const pendingOperations = ["cleanup:workflow_record_reclassification"];
    const mutation = {
      artifact: {
        kind: "pipeline",
        relativePath: workspace.pipeline.path,
        sha256: "d".repeat(64),
      },
      completedOperations,
      diagnosticDelta: { added: [cleanupDiagnostic], preserved: [], removed: [] },
      dryRun: false,
      filePath: workspace.pipeline.path,
      idempotencyKey: "cleanup-idempotency",
      journalKey: "cleanup-journal",
      journalState: "failed",
      kind: "workflow_record_reclassification",
      operations: [{ lineCount: 1, lines: ["{\"event\":\"record_reclassification\"}"], type: "appendLines" }],
      pendingOperations,
      pendingRepair,
      preview: ["append 1 line"],
      staleGuards: [],
      targetRecord: { ...workspace.pipeline },
      written: false,
    };
    const syntheticCoreResult = {
      diagnostics: [cleanupDiagnostic],
      diagnosticsSummary: { byCode: { "SRS-E071": 1 }, errors: 1, warnings: 0 },
      error: {
        code: "MUTATION_DENIED",
        diagnostics: [cleanupDiagnostic],
        message: cleanupDiagnostic.message,
      },
      mutation,
      ok: false as const,
    };

    vi.resetModules();
    const applyWorkflowMutation = vi.fn(async () => syntheticCoreResult);
    vi.doMock("../../src/core/workflow/mutation.js", () => ({ applyWorkflowMutation }));
    try {
      const { registerMutationTools: registerFreshMutationTools } = await import(
        "../../src/mcp/tools/mutation-tools.js"
      );
      const server = createTestMcpServer({ root: workspace.root });
      registerFreshMutationTools(server, { root: workspace.root });
      const result = await server.callTool(
        "workflow_record_reclassification",
        mcpInput(workspace.pipeline, { dryRun: false, repairToken: "opaque-cleanup-token" }),
      ) as JsonObject;

      expect(applyWorkflowMutation).toHaveBeenCalledTimes(1);
      expectPostAppendFailure(result, "record_reclassification_lock_cleanup", workspace.pipeline.path);
      expect(result.mutation).toStrictEqual(mutation);
      expect(result.diagnostics).toStrictEqual([cleanupDiagnostic]);
      expect(result.error).toMatchObject({ code: "MUTATION_DENIED", message: cleanupDiagnostic.message });
      expect(await workspaceTreeSnapshot(workspace.root)).toStrictEqual(treeBefore);
    } finally {
      vi.doUnmock("../../src/core/workflow/mutation.js");
      vi.resetModules();
    }

    // CLI cleanup-fault integration remains Stage B: it needs the artifact-lock module's narrow
    // release-failure seam. A global node:fs mock would couple this contract to paths and unrelated I/O.
  });

  // @req IR-CLI-089 AC-4/6; FR-MCP-057 AC-4/6; FR-NODE-177 AC-1/11
  it("makes CLI and MCP readers reject a different otherwise-valid ISO overlay timestamp", async () => {
    const workspace = await createWorkspace();
    const applied = await previewAndApply(workspace.root, workspace.pipeline);
    expect(applied.code).toBe(0);
    await replaceOverlayTimestamp(
      workspace.root,
      workspace.pipeline.path,
      "2026-08-07T00:00:00.000Z",
    );

    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-07T06:07:08.901Z"));
    try {
      const cliTail = await invokeJson(workspace.root, ["workflow", "pipeline-tail"]);
      const server = mutationServer(workspace.root);
      const mcpTail = await server.callTool("workflow_pipeline_tail", {});

      expect(cliTail.code).toBe(0);
      expectSuccessParity(cliTail.body, mcpTail, workspace.root);
      expect(cliTail.body).toMatchObject({
        diagnostics: [
          expect.objectContaining({
            code: "SRS-W054",
            details: expect.objectContaining({ reason: "missing correction target" }),
            filePath: workspace.pipeline.path,
            line: workspace.pipeline.line,
          }),
        ],
      });
    } finally {
      vi.useRealTimers();
    }
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
      const workspace = await createWorkspace();
      const server = mutationServer(workspace.root);
      await previewAndApply(workspace.root, workspace.pipeline);
      await previewAndApply(workspace.root, workspace.worklog);

      const cases: Array<{
        cli: string[];
        input: JsonObject;
        tool: string;
      }> = [
        {
          cli: ["workflow", "next-task", "--path", workspace.planPath],
          input: { path: workspace.planPath },
          tool: "workflow_next_plan_task",
        },
        {
          cli: ["workflow", "doctor", "--path", workspace.planPath],
          input: { path: workspace.planPath },
          tool: "workflow_doctor",
        },
        {
          cli: ["workflow", "diff", "--path", workspace.planPath],
          input: { path: workspace.planPath },
          tool: "workflow_diff",
        },
        {
          cli: ["workflow", "schema-check", "--path", workspace.planPath],
          input: { path: workspace.planPath },
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
          cli: ["workflow", "resume-hint", "--path", workspace.planPath],
          input: { path: workspace.planPath },
          tool: "workflow_resume_hint",
        },
        {
          cli: ["workflow", "work-order", "next", "--path", workspace.planPath],
          input: { path: workspace.planPath },
          tool: "get_next_work_order",
        },
      ];

      for (const parityCase of cases) {
        const cli = await invokeJson(workspace.root, parityCase.cli);
        const mcp = await server.callTool(parityCase.tool, parityCase.input);
        expect(cli.code, parityCase.cli.join(" ")).toBe(0);
        if (parityCase.tool === "get_next_work_order") {
          const semantic = mcpSemantic(mcp, workspace.root);
          expect(semantic.ok).toBeUndefined();
          expect(semantic).toMatchObject({
            action: expect.any(String),
            diagnostics: expect.any(Array),
            diagnosticsSummary: expect.any(Object),
            nextAction: expect.any(Object),
          });
          expect(JSON.stringify(semantic)).not.toContain("SRS-W054");
          expect(cli.body).toStrictEqual(semantic);
        } else {
          expectSuccessParity(cli.body, mcp, workspace.root);
        }
      }
    } finally {
      vi.useRealTimers();
    }
  });
});
