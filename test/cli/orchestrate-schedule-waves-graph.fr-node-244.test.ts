import { readFile } from "node:fs/promises";
import path from "node:path";
import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { main } from "../../src/cli/index.js";
import { sdsWorkspace, writeUnder } from "../core/orchestrator/sds-fixtures.js";

// FR-NODE-244 AC-7 AC-8 — `schedule waves --waves` plans from a 2.0.0 work graph exactly as from the
// 1.0.0 declaration naming the same waves, and records the same per-wave digests.

const RUN = "r1";
const DECLARATION = "waves/waves.json";
const LOCK = "waves/lanes.lock.json";

async function orchestrate(root: string, argv: readonly string[]): Promise<{ exit: number; payload: Record<string, unknown> }> {
  const pipes = { stdout: new PassThrough(), stderr: new PassThrough() };
  const exit = await main(["--root", root, "orchestrate", ...argv, "--json"], pipes);
  const text = pipes.stdout.read()?.toString() ?? "";
  return { exit, payload: text.length > 0 ? (JSON.parse(text) as Record<string, unknown>) : {} };
}

const V1 = {
  schema_version: "1.0.0",
  waves: [
    { wave: "wave-1", depends_on: [], files: ["src/w1.ts"], requirements: ["FR-ARCH-001"] },
    { wave: "wave-2", depends_on: ["wave-1"], files: ["src/w2.ts"], requirements: ["FR-ARCH-001"] },
    { wave: "wave-3", depends_on: [], files: ["src/w3.ts"], requirements: ["FR-ARCH-001"] }
  ]
};

function node(n: number): Record<string, unknown> {
  return { wave: `wave-${n}`, title: `node ${n}`, purpose: "p", acs: ["FR-ARCH-001 AC-1"], done_when: [], files: [`src/w${n}.ts`] };
}

const V2 = {
  schema_version: "2.0.0",
  run_id: RUN,
  title: "graph",
  scope: { requirements: ["FR-ARCH-001"] },
  nodes: [node(1), node(2), node(3)],
  edges: [{ from: "wave-1", to: "wave-2" }]
};

async function scheduled(declaration: unknown): Promise<{ payload: Record<string, unknown>; lock: string }> {
  const root = await sdsWorkspace([]);
  await writeUnder(root, DECLARATION, JSON.stringify(declaration));
  await writeUnder(root, "existing.json", "[]");
  const run = await orchestrate(root, ["schedule", "waves", "--waves", DECLARATION, "--run-id", RUN, "--existing-paths", "existing.json"]);
  expect(run.exit, JSON.stringify(run.payload)).toBe(0);
  return { payload: run.payload, lock: await readFile(path.join(root, LOCK), "utf8") };
}

describe("FR-NODE-244 — schedule waves --waves reads a 2.0.0 work graph", () => {
  // @req FR-NODE-244 AC-7 AC-8
  it("FR-NODE-244 AC-7 AC-8: plans the same ready waves and writes the same declaration digests as the 1.0.0 file", async () => {
    const one = await scheduled(V1);
    const two = await scheduled(V2);
    expect(two.payload.deferred).toEqual(["wave-2"]);
    expect(two.payload.deferred).toEqual(one.payload.deferred);
    const recorded = (text: string) => {
      const body = JSON.parse(text) as { declaration_digests?: Record<string, string>; lanes?: unknown };
      return { digests: body.declaration_digests, lanes: body.lanes };
    };
    expect(Object.keys(recorded(two.lock).digests ?? {})).toEqual([`${RUN}-wave-1`, `${RUN}-wave-3`]);
    expect(recorded(two.lock)).toEqual(recorded(one.lock));
  });
});
