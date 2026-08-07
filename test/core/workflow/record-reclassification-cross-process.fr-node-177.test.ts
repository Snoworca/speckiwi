import { createHash } from "node:crypto";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { access, mkdir, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

import * as jsonlModule from "../../../src/core/workflow/jsonl.js";
import {
  acquireArtifactLock,
  releaseArtifactLock,
  resolveArtifactLockIdentity,
} from "../../../src/core/workflow/artifact-lock.js";
import {
  applyWorkflowMutation,
  type WorkflowMutationInput,
} from "../../../src/core/workflow/mutation.js";

const PIPELINE_PATH = "kiwi/pipeline.jsonl";
const CHILD_MARKER = "SPECKIWI_RECLASSIFICATION_CHILD";
const THIS_TEST = path.resolve(
  "test/core/workflow/record-reclassification-cross-process.fr-node-177.test.ts",
);
const VITEST_BIN = path.resolve("node_modules/vitest/vitest.mjs");

type JsonObject = Record<string, unknown>;

interface Incident {
  before: string;
  identity: {
    byteOffset: number;
    eventKey: string;
    line: number;
    preimagePrefixSha256: string;
    rawSha256: string;
    recordType: "pipeline";
    targetRunId: string;
  };
  root: string;
}

interface Worker {
  child: ChildProcessWithoutNullStreams;
  completion: Promise<{ code: number | null; stderr: string; stdout: string }>;
}

const sha256 = (value: string): string =>
  createHash("sha256").update(value, "utf8").digest("hex");

const delay = (milliseconds: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

async function waitForFile(filePath: string, timeoutMilliseconds = 20_000): Promise<void> {
  const deadline = Date.now() + timeoutMilliseconds;
  while (Date.now() < deadline) {
    try {
      await access(filePath);
      return;
    } catch {
      await delay(20);
    }
  }
  throw new Error(`Timed out waiting for barrier file: ${filePath}`);
}

async function incident(): Promise<Incident> {
  const root = await mkdtemp(path.join(tmpdir(), "speckiwi-reclassification-process-"));
  const raw = JSON.stringify({
    completion_claimed: false,
    event: "trace_semantic_correction",
    run_id: "cross-process-target",
    schema_version: "1.0.0",
    skill: "kiwi-planner",
    status: "CORRECTION",
    summary: "audit relation change",
    target: "v1.0.0",
    ts: "2026-08-07T00:00:00.000Z",
  });
  const ordinary = JSON.stringify({
    completion_claimed: false,
    event: "task_started",
    run_id: "ordinary-target",
    schema_version: "1.0.0",
    skill: "kiwi-planner",
    status: "RUNNING",
    target: "v1.0.0",
    ts: "2026-08-06T23:59:59.000Z",
  });
  const before = `${ordinary}\n${raw}\n`;
  await mkdir(path.join(root, "kiwi"), { recursive: true });
  await writeFile(path.join(root, PIPELINE_PATH), before, "utf8");
  return {
    before,
    identity: {
      byteOffset: Buffer.byteLength(`${ordinary}\n`, "utf8"),
      eventKey: "kiwi-planner|cross-process-target",
      line: 2,
      preimagePrefixSha256: sha256(before),
      rawSha256: sha256(raw),
      recordType: "pipeline",
      targetRunId: "cross-process-target",
    },
    root,
  };
}

async function cleanWriterIncident(): Promise<Incident> {
  const fixture = await incident();
  const before = `${fixture.before.split(/\r?\n/, 1)[0]}\n`;
  await writeFile(path.join(fixture.root, PIPELINE_PATH), before, "utf8");
  return { ...fixture, before };
}

function inputFor(fixture: Incident, reason: string): WorkflowMutationInput {
  return {
    kind: "workflow_record_reclassification",
    owner: "kiwi-pm",
    reason,
    runId: "cross-process-run",
    taskId: "T-CROSS-PROCESS",
    reqId: "FR-NODE-177",
    jsonlPath: PIPELINE_PATH,
    expectedSha256: sha256(fixture.before),
    dryRun: true,
    ...fixture.identity,
  };
}

async function tokenizedInput(
  fixture: Incident,
  reason: string,
): Promise<WorkflowMutationInput> {
  const preview = await applyWorkflowMutation(
    { root: fixture.root },
    inputFor(fixture, reason),
  );
  expect(preview).toMatchObject({
    ok: true,
    value: { repairToken: expect.any(String), written: false },
  });
  return {
    ...inputFor(fixture, reason),
    dryRun: false,
    repairToken: (preview.value as JsonObject).repairToken as string,
  };
}

function startWorker(
  root: string,
  barrierDirectory: string,
  workerId: string,
  input: WorkflowMutationInput,
  options: { action?: "apply" | "hold-lock"; pauseOnOverlay?: boolean } = {},
): Worker {
  const child = spawn(
    process.execPath,
    [
      VITEST_BIN,
      "run",
      THIS_TEST,
      "--no-file-parallelism",
      "--testTimeout=30000",
      "-t",
      "cross-process child worker",
    ],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        [CHILD_MARKER]: "1",
        SPECKIWI_CHILD_BARRIER: barrierDirectory,
        SPECKIWI_CHILD_ID: workerId,
        SPECKIWI_CHILD_INPUT: JSON.stringify(input),
        SPECKIWI_CHILD_ROOT: root,
        SPECKIWI_CHILD_ACTION: options.action ?? "apply",
        ...(options.pauseOnOverlay
          ? { SPECKIWI_CHILD_PAUSE_ON_OVERLAY: "1" }
          : {}),
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8").on("data", (chunk: string) => {
    stdout += chunk;
  });
  child.stderr.setEncoding("utf8").on("data", (chunk: string) => {
    stderr += chunk;
  });
  return {
    child,
    completion: new Promise((resolve) => {
      child.once("close", (code) => resolve({ code, stderr, stdout }));
    }),
  };
}

function genericInput(
  fixture: Incident,
  kind: "pipeline_event_append" | "workflow_repair_record" | "workflow_logical_delete",
): WorkflowMutationInput {
  if (kind === "workflow_logical_delete") {
    return {
      kind,
      owner: "kiwi-pm",
      reason: "remove the ordinary fixture",
      runId: `generic-${kind}`,
      taskId: "T-CROSS-PROCESS",
      reqId: "FR-NODE-177",
      jsonlPath: PIPELINE_PATH,
      recordId: "ordinary-target",
      recordType: "pipeline_event",
      expectedSha256: sha256(fixture.before),
      dryRun: false,
    };
  }
  return {
    kind,
    owner: "kiwi-pm",
    reason: "generic writer serialization probe",
    runId: `generic-${kind}`,
    taskId: "T-CROSS-PROCESS",
    reqId: "FR-NODE-177",
    jsonlPath: PIPELINE_PATH,
    expectedSha256: sha256(fixture.before),
    dryRun: false,
    event: {
      event: kind === "workflow_repair_record" ? "repair_record" : "generic_pipeline_event",
      run_id: `generic-${kind}`,
      schema_version: "1.0.0",
      skill: "kiwi-pm",
      status: "RUNNING",
      ts: "2026-08-07T00:00:01.000Z",
    },
  };
}

async function assertNoLockResidue(root: string): Promise<void> {
  const identity = await resolveArtifactLockIdentity(path.join(root, PIPELINE_PATH));
  const directory = path.dirname(identity.lockPath);
  const lockName = path.basename(identity.lockPath);
  const entries = await readdir(directory);
  expect(entries.filter((entry) =>
    entry === lockName ||
    entry === `${lockName}.acquire` ||
    entry.startsWith(`${lockName}.stale-`),
  )).toEqual([]);
}

async function runContenders(
  fixture: Incident,
  inputs: [WorkflowMutationInput, WorkflowMutationInput],
): Promise<JsonObject[]> {
  const barrierDirectory = path.join(fixture.root, ".cross-process-barrier");
  await mkdir(barrierDirectory, { recursive: true });
  const workers = inputs.map((input, index) =>
    startWorker(fixture.root, barrierDirectory, String(index), input),
  ) as [Worker, Worker];
  try {
    await Promise.all([
      waitForFile(path.join(barrierDirectory, "process-0.ready")),
      waitForFile(path.join(barrierDirectory, "process-1.ready")),
    ]);
    await writeFile(path.join(barrierDirectory, "start.release"), "release\n", "utf8");
    const completions = await Promise.all(workers.map((worker) => worker.completion));
    for (const completion of completions) {
      expect(completion.code, `${completion.stdout}\n${completion.stderr}`).toBe(0);
    }
    return Promise.all(
      ["0", "1"].map(async (workerId) =>
        JSON.parse(
          await readFile(path.join(barrierDirectory, `result-${workerId}.json`), "utf8"),
        ) as JsonObject,
      ),
    );
  } finally {
    for (const worker of workers) {
      if (worker.child.exitCode === null) worker.child.kill();
    }
  }
}

async function durableOverlays(root: string): Promise<JsonObject[]> {
  return (await readFile(path.join(root, PIPELINE_PATH), "utf8"))
    .trimEnd()
    .split(/\r?\n/)
    .map((line) => JSON.parse(line) as JsonObject)
    .filter((entry) => entry.event === "record_reclassification");
}

if (process.env[CHILD_MARKER] === "1") {
  it("cross-process child worker", async () => {
    const root = process.env.SPECKIWI_CHILD_ROOT!;
    const barrierDirectory = process.env.SPECKIWI_CHILD_BARRIER!;
    const workerId = process.env.SPECKIWI_CHILD_ID!;
    const input = JSON.parse(process.env.SPECKIWI_CHILD_INPUT!) as WorkflowMutationInput;
    if (process.env.SPECKIWI_CHILD_ACTION === "hold-lock") {
      const acquired = await acquireArtifactLock({
        artifactPath: path.join(root, PIPELINE_PATH),
        owner: `cross-process-holder-${workerId}`,
      });
      expect(acquired).toMatchObject({ ok: true });
      if (!acquired.ok) return;
      try {
        await writeFile(path.join(barrierDirectory, `lock-${workerId}.ready`), "ready\n", "utf8");
        await waitForFile(path.join(barrierDirectory, `lock-${workerId}.release`));
      } finally {
        await releaseArtifactLock(acquired.capability);
      }
      return;
    }
    const realParse = jsonlModule.parseWorkflowJsonl;
    const pauseOnOverlay = process.env.SPECKIWI_CHILD_PAUSE_ON_OVERLAY === "1";
    let overlayBarrierSignaled = false;
    const parseSpy = vi.spyOn(jsonlModule, "parseWorkflowJsonl").mockImplementation(async (...args) => {
      const parsed = await realParse(...args);
      const containsOverlay = parsed.entries.some((entry) => entry.event.event === "record_reclassification");
      if (!overlayBarrierSignaled && pauseOnOverlay && containsOverlay) {
        overlayBarrierSignaled = true;
        await writeFile(path.join(barrierDirectory, `overlay-${workerId}.ready`), "ready\n", "utf8");
        await waitForFile(path.join(barrierDirectory, `overlay-${workerId}.release`));
      }
      return parsed;
    });
    try {
      await writeFile(path.join(barrierDirectory, `process-${workerId}.ready`), "ready\n", "utf8");
      await waitForFile(path.join(barrierDirectory, "start.release"));
      const result = await applyWorkflowMutation({ root }, input);
      await writeFile(
        path.join(barrierDirectory, `result-${workerId}.json`),
        JSON.stringify(result),
        "utf8",
      );
    } finally {
      parseSpy.mockRestore();
    }
  });
} else {
  // @req FR-NODE-177 AC-7/11
  describe("FR-NODE-177 cross-process record reclassification lock", { timeout: 30_000 }, () => {
    it.each([1, 2, 3])(
      "serializes identical first applies into one writer and one replay (iteration %s)",
      async (iteration) => {
        const fixture = await incident();
        const input = await tokenizedInput(fixture, `same overlay iteration ${iteration}`);
        const results = await runContenders(fixture, [input, input]);

        expect(results.every((result) => result.ok === true)).toBe(true);
        expect(results.map((result) => (result.value as JsonObject).written).sort()).toEqual([
          false,
          true,
        ]);
        expect(await durableOverlays(fixture.root)).toHaveLength(1);
        await assertNoLockResidue(fixture.root);
      },
    );

    it.each([1, 2, 3])(
      "permits at most one of two non-identical overlays (iteration %s)",
      async (iteration) => {
        const fixture = await incident();
        const left = await tokenizedInput(fixture, `left overlay iteration ${iteration}`);
        const right = await tokenizedInput(fixture, `right overlay iteration ${iteration}`);
        const results = await runContenders(fixture, [left, right]);

        expect(
          results.filter(
            (result) => result.ok === true && (result.value as JsonObject).written === true,
          ),
        ).toHaveLength(1);
        const loser = results.find(
          (result) => result.ok === false || (result.value as JsonObject | undefined)?.written === false,
        );
        expect(loser).toMatchObject({
          error: { code: expect.stringMatching(/MUTATION_DENIED|STALE_PATCH/) },
          mutation: { written: false },
          ok: false,
        });
        expect(await durableOverlays(fixture.root)).toHaveLength(1);
        await assertNoLockResidue(fixture.root);
      },
    );

    it.each([
      "pipeline_event_append",
      "workflow_repair_record",
      "workflow_logical_delete",
      "workflow_record_reclassification",
    ] as const)("keeps the journal unchanged while a direct artifact-lock holder fences the %s writer", async (kind) => {
      const fixture = kind === "workflow_record_reclassification"
        ? await incident()
        : await cleanWriterIncident();
      const input = kind === "workflow_record_reclassification"
        ? await tokenizedInput(fixture, "direct holder serialization")
        : genericInput(fixture, kind);
      const barrierDirectory = path.join(fixture.root, ".cross-process-barrier");
      await mkdir(barrierDirectory, { recursive: true });
      const holder = startWorker(
        fixture.root,
        barrierDirectory,
        `direct-${kind}`,
        input,
        { action: "hold-lock" },
      );
      await waitForFile(path.join(barrierDirectory, `lock-direct-${kind}.ready`));

      const attempt = applyWorkflowMutation({ root: fixture.root }, input);
      try {
        await delay(250);
        expect(await readFile(path.join(fixture.root, PIPELINE_PATH), "utf8")).toBe(fixture.before);
      } finally {
        await writeFile(path.join(barrierDirectory, `lock-direct-${kind}.release`), "release\n", "utf8");
        const completion = await holder.completion;
        expect(completion.code, `${completion.stdout}\n${completion.stderr}`).toBe(0);
      }

      const first = await attempt;
      if (!first.ok) {
        expect(first).toMatchObject({ mutation: { written: false } });
        await expect(applyWorkflowMutation({ root: fixture.root }, input)).resolves.toMatchObject({
          ok: true,
          value: { written: true },
        });
      } else {
        expect(first.value).toMatchObject({ written: true });
      }
      const preexistingLineCount = fixture.before.trimEnd().split(/\r?\n/).length;
      expect((await readFile(path.join(fixture.root, PIPELINE_PATH), "utf8")).trimEnd().split(/\r?\n/)).toHaveLength(preexistingLineCount + 1);
      if (kind === "workflow_record_reclassification") {
        const overlays = await durableOverlays(fixture.root);
        expect(overlays).toHaveLength(1);
        expect(overlays[0]).toMatchObject({
          event: "record_reclassification",
          operation: {
            kind: "record_reclassification",
            source_line: fixture.identity.line,
            source_path: PIPELINE_PATH,
          },
          owner: input.owner,
          reason: input.reason,
        });
      }
      await assertNoLockResidue(fixture.root);
    });

    it("recovers a direct artifact-lock owner that crashes before append and writes one overlay", async () => {
      const fixture = await incident();
      const input = await tokenizedInput(fixture, "direct holder crash before append");
      const barrierDirectory = path.join(fixture.root, ".cross-process-barrier");
      await mkdir(barrierDirectory, { recursive: true });
      const holder = startWorker(
        fixture.root,
        barrierDirectory,
        "crash-before",
        input,
        { action: "hold-lock" },
      );
      try {
        await waitForFile(path.join(barrierDirectory, "lock-crash-before.ready"));
        expect(await durableOverlays(fixture.root)).toHaveLength(0);
      } finally {
        if (holder.child.exitCode === null) holder.child.kill();
        await holder.completion;
      }

      await expect(applyWorkflowMutation({ root: fixture.root }, input)).resolves.toMatchObject({
        ok: true,
        value: { written: true },
      });
      expect(await durableOverlays(fixture.root)).toHaveLength(1);
      await assertNoLockResidue(fixture.root);
    });

    it("replays exactly once after a holder crashes after append but before confirmation", async () => {
      const fixture = await incident();
      const input = await tokenizedInput(fixture, "crash after append");
      const barrierDirectory = path.join(fixture.root, ".cross-process-barrier");
      await mkdir(barrierDirectory, { recursive: true });
      const worker = startWorker(
        fixture.root,
        barrierDirectory,
        "crash-after",
        input,
        { pauseOnOverlay: true },
      );
      try {
        await waitForFile(path.join(barrierDirectory, "process-crash-after.ready"));
        await writeFile(path.join(barrierDirectory, "start.release"), "release\n", "utf8");
        await waitForFile(path.join(barrierDirectory, "overlay-crash-after.ready"));
        expect(await durableOverlays(fixture.root)).toHaveLength(1);
      } finally {
        if (worker.child.exitCode === null) worker.child.kill();
        await worker.completion;
      }

      const retry = await applyWorkflowMutation({ root: fixture.root }, input);
      expect(retry).toMatchObject({
        ok: true,
        value: { journalState: "confirmed", pendingRepair: null, written: false },
      });
      expect(await durableOverlays(fixture.root)).toHaveLength(1);
      await assertNoLockResidue(fixture.root);
    });

    it("leaves no lock residue after an ordinary pre-append failure", async () => {
      const fixture = await incident();
      const input = await tokenizedInput(fixture, "ordinary stale failure");
      const result = await applyWorkflowMutation(
        { root: fixture.root },
        { ...input, expectedSha256: "0".repeat(64) },
      );
      expect(result).toMatchObject({ mutation: { written: false }, ok: false });
      expect(await durableOverlays(fixture.root)).toHaveLength(0);
      await assertNoLockResidue(fixture.root);
    });
  });
}
