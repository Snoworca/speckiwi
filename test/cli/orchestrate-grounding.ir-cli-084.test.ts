import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { main } from "../../src/cli/index.js";

// @req IR-CLI-084 — `orchestrate schedule plan` grounds every declared sidecar path as a near-miss
// check, in the command, before the pure lane planner is called.

function io() {
  return { stdout: new PassThrough(), stderr: new PassThrough() };
}

function drain(stream: PassThrough): string {
  return stream.read()?.toString() ?? "";
}

async function tempRoot(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), "speckiwi-orchestrate-grounding-"));
}

async function write(root: string, relativePath: string, text: string): Promise<void> {
  const absolute = path.join(root, relativePath);
  await mkdir(path.dirname(absolute), { recursive: true });
  await writeFile(absolute, text, "utf8");
}

interface TaskSpec {
  readonly id: string;
  readonly reqId?: string;
  readonly files?: Array<{ path: string; line_range?: string }>;
  readonly test_files?: Array<{ path: string; line_range?: string }>;
}

function sidecar(tasks: TaskSpec[]): string {
  return JSON.stringify({
    schema_version: "1.1.0",
    plan_contract: "1.2.0",
    tasks: tasks.map((task) => ({
      id: task.id,
      type: "code",
      action: `implement ${task.id}`,
      req_ids: [task.reqId ?? "FR-ARCH-001"],
      files: task.files ?? [],
      test_files: task.test_files ?? [],
      covers_ac: ["AC-1"],
      depends_on_task: []
    }))
  });
}

interface Run {
  readonly exit: number;
  readonly payload: Record<string, unknown>;
  readonly root: string;
}

async function plan(
  tasks: TaskSpec[],
  options: { existing?: string[]; files?: Record<string, string>; argv?: string[] } = {}
): Promise<Run> {
  const root = await tempRoot();
  await write(root, "plan.sidecar.json", sidecar(tasks));
  await write(root, "existing.json", JSON.stringify(options.existing ?? []));
  for (const [relativePath, text] of Object.entries(options.files ?? {})) await write(root, relativePath, text);
  const pipes = io();
  const exit = await main(
    [
      "--root", root, "orchestrate", "schedule", "plan",
      "--plan", "plan.sidecar.json",
      "--existing-paths", "existing.json",
      ...(options.argv ?? []),
      "--json"
    ],
    pipes
  );
  const text = drain(pipes.stdout);
  return { exit, payload: text.length > 0 ? (JSON.parse(text) as Record<string, unknown>) : {}, root };
}

function verdicts(payload: Record<string, unknown>, key: "violations" | "grounding"): Record<string, string> {
  const rows = (payload[key] ?? []) as Array<{ path: string; verdict: string }>;
  return Object.fromEntries(rows.map((row) => [row.path, row.verdict]));
}

describe("IR-CLI-084 AC-1 / AC-2 — a near miss is refused, a genuine new file is not", () => {
  it("refuses a path within edit distance 2 of an existing repository path", async () => {
    const result = await plan([{ id: "T1", files: [{ path: "src/core/lane-plann.ts" }] }], {
      existing: ["src/core/lane-plan.ts"]
    });

    expect(result.exit).toBe(2);
    expect(result.payload.gate).toBe("files-not-grounded");
    expect(verdicts(result.payload, "violations")["src/core/lane-plann.ts"]).toBe("near-miss");
  });

  it("accepts a path that does not exist and has no near neighbour, and produces the plan", async () => {
    const result = await plan([{ id: "T1", files: [{ path: "src/core/brand-new-module.ts" }] }], {
      existing: ["src/core/lane-plan.ts"]
    });

    expect(result.exit, JSON.stringify(result.payload)).toBe(0);
    expect(result.payload).toHaveProperty("plan");
    expect(verdicts(result.payload, "grounding")["src/core/brand-new-module.ts"]).toBe("new-file");
  });
});

describe("IR-CLI-084 AC-3 — a declared line range beyond the file's line count is refused", () => {
  it("refuses an out-of-range line range and accepts the same entry in range", async () => {
    const body = "one\ntwo\nthree\n";
    const outOfRange = await plan([{ id: "T1", files: [{ path: "src/small.ts", line_range: "1-99" }] }], {
      existing: ["src/small.ts"],
      files: { "src/small.ts": body }
    });

    expect(outOfRange.exit).toBe(2);
    expect(outOfRange.payload.gate).toBe("files-not-grounded");
    expect(verdicts(outOfRange.payload, "violations")["src/small.ts"]).toBe("line-range-out-of-range");

    const inRange = await plan([{ id: "T1", files: [{ path: "src/small.ts", line_range: "1-3" }] }], {
      existing: ["src/small.ts"],
      files: { "src/small.ts": body }
    });

    expect(inRange.exit, JSON.stringify(inRange.payload)).toBe(0);
    expect(verdicts(inRange.payload, "grounding")["src/small.ts"]).toBe("grounded");
  });
});

describe("IR-CLI-084 AC-4 — declared test files are grounded on the same two rules", () => {
  it("refuses a near-miss test path and an out-of-range test line range", async () => {
    const nearMiss = await plan([{ id: "T1", test_files: [{ path: "test/core/lane-plann.test.ts" }] }], {
      existing: ["test/core/lane-plan.test.ts"]
    });
    expect(nearMiss.exit).toBe(2);
    expect(verdicts(nearMiss.payload, "violations")["test/core/lane-plann.test.ts"]).toBe("near-miss");

    const outOfRange = await plan([{ id: "T1", test_files: [{ path: "test/small.test.ts", line_range: "1-99" }] }], {
      existing: ["test/small.test.ts"],
      files: { "test/small.test.ts": "one\ntwo\n" }
    });
    expect(outOfRange.exit).toBe(2);
    expect(verdicts(outOfRange.payload, "violations")["test/small.test.ts"]).toBe("line-range-out-of-range");
  });
});

describe("IR-CLI-084 AC-5 — the planner is injected, and grounding precedes it", () => {
  it("refuses on grounding rather than on the planner's own error for a sidecar that would fail both", async () => {
    // T1 and T2 form a dependency cycle, which `computeLanePlan` raises as `schedule-cycle`. T1 also
    // declares a near miss. The reported gate proves which ran first.
    const root = await tempRoot();
    await write(
      root,
      "plan.sidecar.json",
      JSON.stringify({
        schema_version: "1.1.0",
        plan_contract: "1.2.0",
        tasks: [
          { id: "T1", type: "code", action: "a", req_ids: ["FR-ARCH-001"], files: [{ path: "src/core/lane-plann.ts" }], test_files: [], covers_ac: ["AC-1"], depends_on_task: ["T2"] },
          { id: "T2", type: "code", action: "b", req_ids: ["FR-ARCH-001"], files: [{ path: "src/core/other.ts" }], test_files: [], covers_ac: ["AC-2"], depends_on_task: ["T1"] }
        ]
      })
    );
    await write(root, "existing.json", JSON.stringify(["src/core/lane-plan.ts"]));

    const pipes = io();
    const exit = await main(
      ["--root", root, "orchestrate", "schedule", "plan", "--plan", "plan.sidecar.json", "--existing-paths", "existing.json", "--json"],
      pipes
    );
    const payload = JSON.parse(drain(pipes.stdout)) as Record<string, unknown>;

    expect(exit).toBe(2);
    expect(payload.gate, "grounding must refuse before the planner runs").toBe("files-not-grounded");
  });

  it("passes the command's own path list to the planner rather than reading the filesystem", async () => {
    // `src/mod` exists in neither run's filesystem. The prefix-directory clause of the write-set
    // overlap fires only when the parent is a member of the injected `existing_paths`, so the two
    // runs differ only in what the command injected.
    // Distinct req ids, so the only edge that can couple the two tasks is `write-set-overlap`.
    const tasks: TaskSpec[] = [
      { id: "T1", reqId: "FR-ARCH-001", files: [{ path: "src/mod" }] },
      { id: "T2", reqId: "FR-ARCH-002", files: [{ path: "src/mod/child.ts" }] }
    ];

    const injected = await plan(tasks, { existing: ["src/mod", "src/mod/child.ts"] });
    const notInjected = await plan(tasks, { existing: ["src/mod/child.ts"] });

    expect(injected.exit, JSON.stringify(injected.payload)).toBe(0);
    expect(notInjected.exit, JSON.stringify(notInjected.payload)).toBe(0);

    type Plan = { laneCount: number; lanes: Array<{ taskIds: string[] }>; serialEpilogue: string[] };
    const injectedPlan = injected.payload.plan as Plan;
    const notInjectedPlan = notInjected.payload.plan as Plan;

    expect(injectedPlan.laneCount, "the injected parent couples the two tasks into one lane").toBe(1);
    expect(injectedPlan.lanes[0]?.taskIds).toEqual(["T1", "T2"]);
    // Uncoupled, each is a singleton component with no dependents, which 05 §5.3 folds into the
    // serial epilogue. Same sidecar, same filesystem — only the injected list differs.
    expect(notInjectedPlan.laneCount).toBe(0);
    expect(notInjectedPlan.serialEpilogue).toEqual(["T1", "T2"]);
  });
});

describe("IR-CLI-084 AC-6 — --strict-grounding tightens the first clause and is journalled", () => {
  it("refuses an entry with no near neighbour under --strict-grounding and accepts it without", async () => {
    const strict = await plan([{ id: "T1", files: [{ path: "src/core/brand-new-module.ts" }] }], {
      existing: ["src/core/lane-plan.ts"],
      argv: ["--strict-grounding"]
    });
    expect(strict.exit).toBe(2);
    expect(strict.payload.gate).toBe("files-not-grounded");
    expect(verdicts(strict.payload, "violations")["src/core/brand-new-module.ts"]).toBe("absent");

    const lenient = await plan([{ id: "T1", files: [{ path: "src/core/brand-new-module.ts" }] }], {
      existing: ["src/core/lane-plan.ts"]
    });
    expect(lenient.exit, JSON.stringify(lenient.payload)).toBe(0);
  });

  it("records the option's use in the run journal", async () => {
    const result = await plan([{ id: "T1", files: [{ path: "src/core/new-thing.ts" }] }], {
      existing: ["src/core/lane-plan.ts"],
      argv: ["--strict-grounding", "--run-id", "run-a"]
    });

    expect(result.exit).toBe(2);
    const journal = await readFile(path.join(result.root, "kiwi", "waves.jsonl"), "utf8");
    const lines = journal.trim().split("\n").map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(lines.some((line) => line.strict_grounding === true)).toBe(true);
  });
});
