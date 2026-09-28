import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { main } from "../../src/cli/index.js";

// @req FR-NODE-213 AC-6 — `orchestrate journal append` refuses a 2.0.0 line that names vocabulary
// 4.0.0 retired, and keeps accepting the same term on a line stamped below 2.0.0.

const JOURNAL = "kiwi/waves.jsonl";
const CODE = "vocabulary-retired-in-4-0-0";

async function run(argv: string[]): Promise<{ exit: number; payload: Record<string, unknown> }> {
  const pipes = { stdout: new PassThrough(), stderr: new PassThrough() };
  const exit = await main([...argv, "--json"], pipes);
  const text = pipes.stdout.read()?.toString() ?? "";
  return { exit, payload: text.length > 0 ? (JSON.parse(text) as Record<string, unknown>) : {} };
}

async function rootWithJournal(text: string): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "speckiwi-retired-vocabulary-"));
  await mkdir(path.join(root, "kiwi"), { recursive: true });
  await writeFile(path.join(root, JOURNAL), text, "utf8");
  return root;
}

function payload(schemaVersion: string, extra: Record<string, unknown>): string {
  return JSON.stringify({ schema_version: schemaVersion, run_id: "run-a", engine: "kiwi-orchestrator", event: "intent", verb: "dispatch-lane", wave: "wave-1", ...extra });
}

async function append(root: string, line: string): Promise<{ exit: number; payload: Record<string, unknown> }> {
  return run(["--root", root, "orchestrate", "journal", "append", "--run-id", "run-a", "--payload", line]);
}

const RETIRED: Array<[string, Record<string, unknown>]> = [
  ["verb execute-unit", { verb: "execute-unit" }],
  ["verb plan-wave", { verb: "plan-wave" }],
  ["lane_disposition.kind demoted", { event: "result", lane: "lane-1", lane_disposition: { kind: "demoted" } }],
  ["lane_disposition.kind coupling-reset", { event: "result", lane: "lane-1", lane_disposition: { kind: "coupling-reset" } }],
  ["phase handoff", { phase: "handoff" }],
  ["phase pipeline", { phase: "pipeline" }]
];

describe("FR-NODE-213 AC-6 — journal append and the retired 4.0.0 vocabulary", () => {
  for (const [label, extra] of RETIRED) {
    it(`FR-NODE-213 AC-6: refuses ${label} on a 2.0.0 line and leaves the journal byte-identical`, async () => {
      const root = await rootWithJournal("");
      const refused = await append(root, payload("2.0.0", extra));

      expect(refused.exit, JSON.stringify(refused.payload)).toBe(2);
      expect(refused.payload.applied).toBe(false);
      expect((refused.payload.violations as Array<{ code: string }>).map((entry) => entry.code)).toContain(CODE);
      expect(await readFile(path.join(root, JOURNAL), "utf8")).toBe("");
    });

    it(`FR-NODE-213 AC-6: accepts ${label} on a 1.5.0 line, which is not re-validated`, async () => {
      const root = await rootWithJournal("");
      const accepted = await append(root, payload("1.5.0", extra));

      expect(accepted.exit, JSON.stringify(accepted.payload)).toBe(0);
      expect(accepted.payload.written).toBe(true);
    });
  }

  it("FR-NODE-213 AC-6 (FR-NODE-167 AC-4): refuses a retired abort gate on a 2.0.0 line under its own code", async () => {
    const root = await rootWithJournal("");
    const refused = await append(root, payload("2.0.0", { verb: "abort-run", event: "result", wave: "all", abort_gate: "handoff-verify-failed" }));

    expect(refused.exit).toBe(2);
    expect((refused.payload.violations as Array<{ code: string }>).map((entry) => entry.code)).toEqual(["abort-gate-outside-vocabulary"]);
  });

  it("FR-NODE-213 AC-6: a retired term already in history does not block the next valid append", async () => {
    const history = `${payload("2.0.0", { verb: "execute-unit", writer: "bash" })}\n`;
    const root = await rootWithJournal(history);
    const accepted = await append(root, payload("2.0.0", { verb: "dispatch-lane" }));

    expect(accepted.exit, JSON.stringify(accepted.payload)).toBe(0);
    expect(accepted.payload.written).toBe(true);
    expect((accepted.payload.diagnostics as Array<{ code: string; severity: string }>).map((entry) => [entry.code, entry.severity])).toEqual([[CODE, "warning"]]);
  });
});
