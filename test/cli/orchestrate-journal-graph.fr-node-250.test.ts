import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { main } from "../../src/cli/index.js";

// @req FR-NODE-250 — `orchestrate journal append` writes the work-graph lines and refuses a malformed
// one without writing a byte.

const JOURNAL = "kiwi/waves.jsonl";
const GRAPH = { path: "kiwi/orchestrator/run-a/waves/waves.json", digest: "a".repeat(64) };

async function run(argv: string[]): Promise<{ exit: number; payload: Record<string, unknown> }> {
  const pipes = { stdout: new PassThrough(), stderr: new PassThrough() };
  const exit = await main([...argv, "--json"], pipes);
  const text = pipes.stdout.read()?.toString() ?? "";
  return { exit, payload: text.length > 0 ? (JSON.parse(text) as Record<string, unknown>) : {} };
}

async function rootWithJournal(text: string): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "speckiwi-journal-graph-"));
  await mkdir(path.join(root, "kiwi"), { recursive: true });
  await writeFile(path.join(root, JOURNAL), text, "utf8");
  return root;
}

function state(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { schema_version: "2.0.0", run_id: "run-a", engine: "kiwi-orchestrator", wave: "wave-1", order: 1, target: "wave-1", status: "in_progress", summary: "line", ...extra };
}

/** The wave's passing wave-verify record, which a complete line needs before it (FR-NODE-143). */
const VERIFY = state({ phase: "wave-verify", verification: { verdict: "pass" } });

function action(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { schema_version: "2.0.0", run_id: "run-a", engine: "kiwi-orchestrator", verb: "node-complete-action", wave: "wave-1", action_id: "report", completion_ref: "L2", attempt: 1, ...extra };
}

async function append(root: string, line: Record<string, unknown>): Promise<{ exit: number; payload: Record<string, unknown> }> {
  return run(["--root", root, "orchestrate", "journal", "append", "--run-id", "run-a", "--payload", JSON.stringify(line)]);
}

const violationCodes = (payload: Record<string, unknown>): string[] => ((payload.violations ?? []) as Array<{ code: string }>).map((entry) => entry.code);

async function firstLineWritten(): Promise<{ root: string; bytes: string }> {
  const root = await rootWithJournal("");
  const first = await append(root, state({ graph: GRAPH }));
  expect(first.exit, JSON.stringify(first.payload)).toBe(0);
  return { root, bytes: await readFile(path.join(root, JOURNAL), "utf8") };
}

describe("FR-NODE-250 — journal append and the work-graph lines", () => {
  // @req FR-NODE-250 AC-1
  it("FR-NODE-250 AC-1: writes a first line with a graph reference and a complete line with done_when_confirmed", async () => {
    const { root } = await firstLineWritten();
    expect((await append(root, VERIFY)).exit).toBe(0);
    const complete = await append(root, state({ status: "complete", verification: { verdict: "pass" }, done_when_confirmed: ["DW-1"] }));
    expect(complete.exit, JSON.stringify(complete.payload)).toBe(0);
    expect((await readFile(path.join(root, JOURNAL), "utf8")).trim().split("\n")).toHaveLength(3);
  });

  // @req FR-NODE-250 AC-1
  it("FR-NODE-250 AC-1: refuses a malformed graph, a misplaced graph and a malformed done_when_confirmed without writing", async () => {
    const empty = await rootWithJournal("");
    const malformed = await append(empty, state({ graph: { path: GRAPH.path, digest: "not-a-digest" } }));
    expect(malformed.exit).toBe(2);
    expect(violationCodes(malformed.payload)).toEqual(["journal-graph-malformed"]);
    expect(await readFile(path.join(empty, JOURNAL), "utf8")).toBe("");

    const { root } = await firstLineWritten();
    expect((await append(root, VERIFY)).exit).toBe(0);
    const bytes = await readFile(path.join(root, JOURNAL), "utf8");
    const misplaced = await append(root, state({ graph: GRAPH }));
    expect(misplaced.exit).toBe(2);
    expect(violationCodes(misplaced.payload)).toEqual(["journal-graph-misplaced"]);
    const dw = await append(root, state({ status: "complete", verification: { verdict: "pass" }, done_when_confirmed: ["DW-x"] }));
    expect(dw.exit).toBe(2);
    expect(violationCodes(dw.payload)).toEqual(["done-when-confirmed-malformed"]);
    expect(await readFile(path.join(root, JOURNAL), "utf8")).toBe(bytes);
  });

  // @req FR-NODE-250 AC-2
  it("FR-NODE-250 AC-2: writes a redecompose line with a graph and refuses one without", async () => {
    const { root, bytes } = await firstLineWritten();
    const missing = await append(root, state({ phase: "redecompose" }));
    expect(missing.exit).toBe(2);
    expect(violationCodes(missing.payload)).toEqual(["journal-graph-malformed"]);
    expect(await readFile(path.join(root, JOURNAL), "utf8")).toBe(bytes);

    const written = await append(root, state({ phase: "redecompose", graph: { path: "kiwi/orchestrator/run-a/waves/waves.v2.json", digest: "b".repeat(64) } }));
    expect(written.exit, JSON.stringify(written.payload)).toBe(0);
  });

  // @req FR-NODE-250 AC-3
  it("FR-NODE-250 AC-3: writes a node-complete-action intent and result, and refuses one missing a required field", async () => {
    const { root, bytes } = await firstLineWritten();
    for (const field of ["wave", "action_id", "completion_ref", "attempt"]) {
      const line = action();
      delete line[field];
      const refused = await append(root, line);
      expect(refused.exit, field).toBe(2);
      expect(violationCodes(refused.payload), field).toEqual(["node-complete-action-malformed"]);
    }
    const badResult = await append(root, action({ result: "delivered" }));
    expect(badResult.exit).toBe(2);
    expect(await readFile(path.join(root, JOURNAL), "utf8")).toBe(bytes);

    const intent = await append(root, action());
    expect(intent.exit, JSON.stringify(intent.payload)).toBe(0);
    const result = await append(root, action({ result: "failed", error: "timeout" }));
    expect(result.exit, JSON.stringify(result.payload)).toBe(0);
  });
});
