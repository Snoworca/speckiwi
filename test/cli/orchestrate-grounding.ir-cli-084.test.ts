import { readFile } from "node:fs/promises";
import path from "node:path";
import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { main } from "../../src/cli/index.js";
import { sdsPath, sdsWorkspace, writeUnder, type SdsSpec } from "../core/orchestrator/sds-fixtures.js";

// @req IR-CLI-084 — `orchestrate schedule waves` grounds every SDS Files path and test file as a
// near-miss check, in the command, before the pure lane planner is called.

interface Run {
  readonly exit: number;
  readonly payload: Record<string, unknown>;
  readonly root: string;
}

async function schedule(
  specs: readonly SdsSpec[],
  options: { existing?: string[]; depends?: Record<string, string[]>; argv?: string[] } = {}
): Promise<Run> {
  const root = await sdsWorkspace(specs);
  await writeUnder(root, "existing.json", JSON.stringify(options.existing ?? []));
  const pipes = { stdout: new PassThrough(), stderr: new PassThrough() };
  const exit = await main(
    [
      "--root", root, "orchestrate", "schedule", "waves",
      "--sds", ...specs.map((spec) => sdsPath(spec.id)),
      "--depends", JSON.stringify(options.depends ?? {}),
      "--existing-paths", "existing.json",
      ...(options.argv ?? []),
      "--json"
    ],
    pipes
  );
  const text = pipes.stdout.read()?.toString() ?? "";
  return { exit, payload: text.length > 0 ? (JSON.parse(text) as Record<string, unknown>) : {}, root };
}

function refusedPaths(payload: Record<string, unknown>): Record<string, unknown> {
  const rows = (payload.violations ?? []) as Array<{ path: string; verdict: string; nearest?: string; waves?: string[] }>;
  return Object.fromEntries(rows.map((row) => [row.path, row]));
}

const EXISTING = ["src/core/lane-plan.ts", "src/core/conflict.ts", "test/core/lane-plan.test.ts"];

describe("IR-CLI-084 AC-1 / AC-2 — a near miss is refused, a genuine new file is not", () => {
  it("IR-CLI-084 AC-1 refuses an SDS Files path within edit distance 2 of an existing path, naming the neighbour and the wave", async () => {
    const run = await schedule([{ id: "w-1", files: ["src/core/lane-plann.ts"] }], { existing: EXISTING });
    expect(run.exit).toBe(2);
    expect(run.payload.gate).toBe("files-not-grounded");
    expect(refusedPaths(run.payload)["src/core/lane-plann.ts"]).toEqual({
      path: "src/core/lane-plann.ts",
      verdict: "near-miss",
      nearest: "src/core/lane-plan.ts",
      waves: ["w-1"]
    });
  });

  it("IR-CLI-084 AC-2 accepts an SDS Files path with no near neighbour and produces the lanes lock", async () => {
    const run = await schedule([{ id: "w-1", files: ["src/core/brand-new-module.ts", "src/core/conflict.ts"] }], { existing: EXISTING });
    expect(run.exit, JSON.stringify(run.payload)).toBe(0);
    expect((run.payload.lock as { lane_count: number }).lane_count).toBe(1);
  });
});

describe("IR-CLI-084 AC-4 — the test files an SDS declares are grounded on the same rule", () => {
  it("IR-CLI-084 AC-4 refuses a near-miss Test Plan test file", async () => {
    const run = await schedule([{ id: "w-1", files: ["src/core/lane-plan.ts"], testFiles: ["test/core/lane-plan.tests.ts"] }], { existing: EXISTING });
    expect(run.exit).toBe(2);
    expect(run.payload.gate).toBe("files-not-grounded");
    expect(refusedPaths(run.payload)["test/core/lane-plan.tests.ts"]).toMatchObject({ verdict: "near-miss", nearest: "test/core/lane-plan.test.ts" });
  });
});

describe("IR-CLI-084 AC-5 — the existing paths are the command's, and grounding precedes the planner", () => {
  it("IR-CLI-084 AC-5 refuses on grounding rather than on the planner's own cycle error for waves that would fail both", async () => {
    const run = await schedule(
      [
        { id: "w-1", files: ["src/core/lane-plann.ts"] },
        { id: "w-2", files: ["src/core/other.ts"] }
      ],
      { existing: EXISTING, depends: { "w-1": ["w-2"], "w-2": ["w-1"] } }
    );
    expect(run.exit).toBe(2);
    expect(run.payload.gate).toBe("files-not-grounded");
  });

  it("IR-CLI-084 AC-5 judges against the path list the command was given, not the filesystem", async () => {
    const withList = await schedule([{ id: "w-1", files: ["src/core/lane-plann.ts"] }], { existing: EXISTING });
    const withoutList = await schedule([{ id: "w-1", files: ["src/core/lane-plann.ts"] }], { existing: [] });
    expect(withList.payload.gate).toBe("files-not-grounded");
    expect(withoutList.exit, JSON.stringify(withoutList.payload)).toBe(0);
  });
});

describe("IR-CLI-084 AC-6 — --strict-grounding tightens the check to existence and is journalled", () => {
  it("IR-CLI-084 AC-6 refuses a path with no near neighbour under --strict-grounding and accepts it without", async () => {
    const strict = await schedule([{ id: "w-1", files: ["src/core/brand-new-module.ts"] }], { existing: EXISTING, argv: ["--strict-grounding"] });
    expect(strict.exit).toBe(2);
    expect(strict.payload.gate).toBe("files-not-grounded");
    expect(refusedPaths(strict.payload)["src/core/brand-new-module.ts"]).toMatchObject({ verdict: "absent" });

    const lenient = await schedule([{ id: "w-1", files: ["src/core/brand-new-module.ts"] }], { existing: EXISTING });
    expect(lenient.exit, JSON.stringify(lenient.payload)).toBe(0);
  });

  it("IR-CLI-084 AC-6 records the option's use in the run journal", async () => {
    const run = await schedule([{ id: "w-1", files: ["src/core/new-thing.ts"] }], { existing: EXISTING, argv: ["--strict-grounding", "--run-id", "run-a"] });
    expect(run.exit).toBe(2);
    const journal = await readFile(path.join(run.root, "kiwi", "waves.jsonl"), "utf8");
    const lines = journal.trim().split("\n").map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(lines.some((line) => line.strict_grounding === true && line.verb === "freeze-lane-plan")).toBe(true);
  });
});
