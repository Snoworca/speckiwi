import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { main } from "../../src/cli/index.js";
import { MAX_LANE_CAP } from "../../src/cli/commands/orchestrate.js";
import { ORCHESTRATOR_VARIANTS, readVariant } from "../support/critical-gate-table.js";

// @req IR-CLI-098 — `--lanes` reached `computeLanePlan` through an unchecked `Number.parseInt`, so a
// typo had two different wrong outcomes and neither named the cause: `NaN` either surfaced later as
// a partition diagnostic blaming the task set, or never surfaced at all when no lane formed.

function io() {
  return { stdout: new PassThrough(), stderr: new PassThrough() };
}

function drain(stream: PassThrough): string {
  return stream.read()?.toString() ?? "";
}

async function write(root: string, relativePath: string, text: string): Promise<void> {
  const absolute = path.join(root, relativePath);
  await mkdir(path.dirname(absolute), { recursive: true });
  await writeFile(absolute, text, "utf8");
}

interface Task {
  readonly id: string;
  readonly files: string[];
  readonly reqId: string;
}

function sidecar(tasks: Task[]): string {
  return JSON.stringify({
    schema_version: "1.1.0",
    plan_contract: "1.2.0",
    tasks: tasks.map((task) => ({
      id: task.id,
      type: "code",
      action: `implement ${task.id}`,
      req_ids: [task.reqId],
      files: task.files.map((file) => ({ path: file })),
      test_files: [],
      covers_ac: ["AC-1"],
      depends_on_task: []
    }))
  });
}

/**
 * Pairs sharing a file form one lane each — the shape that reaches the cap at all.
 *
 * Each pair gets its own requirement id on purpose. `req-shared` is a same-lane conflict, so one id
 * across the whole sidecar merges every task into a single lane and the cap is never exercised.
 */
function lanePairs(count: number): Task[] {
  return Array.from({ length: count }, (_unused, index) => [
    { id: `T${index}A`, files: [`src/m${index}.ts`], reqId: `FR-ARCH-${100 + index}` },
    { id: `T${index}B`, files: [`src/m${index}.ts`], reqId: `FR-ARCH-${100 + index}` }
  ]).flat();
}

/** Independent single tasks — distinct file, distinct requirement, no dependents. Each folds away. */
function epilogueOnly(count: number): Task[] {
  return Array.from({ length: count }, (_unused, index) => ({
    id: `S${index}`,
    files: [`src/s${index}.ts`],
    reqId: `FR-ARCH-${200 + index}`
  }));
}

interface Run {
  readonly exit: number;
  readonly text: string;
  readonly payload: Record<string, unknown>;
}

async function plan(tasks: Task[], lanes?: string): Promise<Run> {
  const root = await mkdtemp(path.join(tmpdir(), "speckiwi-lane-cap-"));
  await write(root, "plan.sidecar.json", sidecar(tasks));
  await write(root, "existing.json", JSON.stringify(tasks.flatMap((task) => task.files)));
  const pipes = io();
  const exit = await main(
    [
      "--root", root, "orchestrate", "schedule", "plan",
      "--plan", "plan.sidecar.json", "--existing-paths", "existing.json",
      ...(lanes === undefined ? [] : ["--lanes", lanes]),
      "--json"
    ],
    pipes
  );
  const text = `${drain(pipes.stdout)}${drain(pipes.stderr)}`;
  let payload: Record<string, unknown> = {};
  try {
    payload = JSON.parse(text) as Record<string, unknown>;
  } catch {
    payload = {};
  }
  return { exit, text, payload };
}

function stageCount(run: Run): number | undefined {
  return (run.payload.plan as { stageCount?: number } | undefined)?.stageCount;
}

/** A usage refusal, as distinct from an orchestration gate or a partition diagnostic. */
function refusedAsUsage(run: Run): boolean {
  return run.exit !== 0 && /--lanes/.test(run.text);
}

describe("IR-CLI-098 the lane cap is validated where it is read", () => {
  it("AC-1 rejects a non-numeric cap before any plan is computed, naming option and value", async () => {
    const run = await plan(lanePairs(2), "abc");

    expect(refusedAsUsage(run), run.text).toBe(true);
    expect(run.text, "the received value must appear so the operator sees their own typo").toContain("abc");
    expect(run.payload.plan, "no plan may be computed from a rejected cap").toBeUndefined();
    // The old failure blamed the task partition. That message must not be what comes out now.
    expect(run.text).not.toContain("lane-plan-incomplete");
  });

  it("AC-2 rejects zero and a negative cap", async () => {
    const zero = await plan(lanePairs(2), "0");
    const negative = await plan(lanePairs(2), "-3");

    expect(refusedAsUsage(zero), zero.text).toBe(true);
    expect(refusedAsUsage(negative), negative.text).toBe(true);
  });

  it("AC-3 rejects a cap above the declared maximum, and that maximum is the skill's", () => {
    // The criterion says "matching the maximum the skill body declares", so the bound is held against
    // the body rather than against a literal. Widening `MAX_LANE_CAP` alone refuses nothing, so a
    // hardcoded 9999 case would stay green while the two sides drifted apart.
    for (const variant of ORCHESTRATOR_VARIANTS) {
      const row = readVariant(variant)
        .split("\n")
        .find((line) => line.trimStart().startsWith("| `--lanes"));
      expect(row, `${variant} must declare --lanes`).toBeTruthy();
      expect(row, `${variant} must state the cap the code enforces`).toContain(String(MAX_LANE_CAP));
    }
  });

  it("AC-3 rejects a cap one above the maximum, and the maximum itself", async () => {
    const above = await plan(lanePairs(2), String(MAX_LANE_CAP + 1));
    expect(refusedAsUsage(above), above.text).toBe(true);
    expect(above.payload.plan).toBeUndefined();

    const far = await plan(lanePairs(2), "9999");
    expect(refusedAsUsage(far), far.text).toBe(true);
  });

  it("AC-4 rejects a fractional cap rather than truncating it", async () => {
    const run = await plan(lanePairs(2), "2.5");

    expect(refusedAsUsage(run), run.text).toBe(true);
  });

  it("AC-5 rejects the same cap when the plan forms no lanes at all", async () => {
    // Every task folds to the serial epilogue, so `splitByCap` is never reached. This is exactly the
    // case where the unchecked parse used to pass silently, and the case the first measurement missed.
    const control = await plan(epilogueOnly(4));
    expect(control.exit, "the fixture must be an epilogue-only plan").toBe(0);
    expect((control.payload.plan as { laneCount?: number }).laneCount, "no lane may form").toBe(0);

    const run = await plan(epilogueOnly(4), "abc");

    expect(refusedAsUsage(run), run.text).toBe(true);
    expect(run.payload.plan, "the typo must not slip through on this shape either").toBeUndefined();
  });

  it("AC-6 accepts 1 and 8, and omitting the option keeps the cap at 4", async () => {
    const one = await plan(lanePairs(2), "1");
    expect(one.exit, one.text).toBe(0);

    // Five lanes against a cap of 8 fit in one stage; against the default 4 they do not. The stage
    // count is what makes the accepted value observable rather than merely non-refused.
    const eight = await plan(lanePairs(5), "8");
    expect(eight.exit, eight.text).toBe(0);
    expect(stageCount(eight)).toBe(1);

    const defaulted = await plan(lanePairs(5));
    expect(defaulted.exit, defaulted.text).toBe(0);
    expect(stageCount(defaulted), "the default cap of 4 must still split five lanes").toBe(2);
  });
});
