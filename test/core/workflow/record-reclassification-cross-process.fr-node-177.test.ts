import { createHash } from "node:crypto";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { access, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

import * as jsonlModule from "../../../src/core/workflow/jsonl.js";
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
  const before = `${raw}\n`;
  await mkdir(path.join(root, "kiwi"), { recursive: true });
  await writeFile(path.join(root, PIPELINE_PATH), before, "utf8");
  return {
    before,
    identity: {
      byteOffset: 0,
      eventKey: "kiwi-planner|cross-process-target",
      line: 1,
      preimagePrefixSha256: sha256(before),
      rawSha256: sha256(raw),
      recordType: "pipeline",
      targetRunId: "cross-process-target",
    },
    root,
  };
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
): Worker {
  const child = spawn(
    process.execPath,
    [
      VITEST_BIN,
      "run",
      THIS_TEST,
      "--no-file-parallelism",
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
      waitForFile(path.join(barrierDirectory, "guard-0.ready")),
      waitForFile(path.join(barrierDirectory, "guard-1.ready")),
    ]);
    await writeFile(path.join(barrierDirectory, "append.release"), "release\n", "utf8");
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
    const realParse = jsonlModule.parseWorkflowJsonl;
    let parseCount = 0;
    const parseSpy = vi.spyOn(jsonlModule, "parseWorkflowJsonl").mockImplementation(async (...args) => {
      const parsed = await realParse(...args);
      parseCount += 1;
      if (parseCount === 1) {
        await writeFile(path.join(barrierDirectory, `guard-${workerId}.ready`), "ready\n", "utf8");
        await waitForFile(path.join(barrierDirectory, "append.release"));
      }
      return parsed;
    });
    try {
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
  describe("FR-NODE-177 cross-process record reclassification lock", () => {
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
      },
    );
  });
}
