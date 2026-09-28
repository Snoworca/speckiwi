import { readFile } from "node:fs/promises";
import path from "node:path";
import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { main } from "../../src/cli/index.js";
import { sdsPath, sdsWorkspace, writeUnder } from "../core/orchestrator/sds-fixtures.js";

// FR-NODE-213 AC-1 — the `--journal <path>` option of the command form: the freeze-lane-plan line the
// strict-grounding run journals lands in the journal the caller names, and the default journal is
// neither written nor read.

const CUSTOM = "runs/custom/waves.jsonl";
const DEFAULT = "kiwi/waves.jsonl";

// A journal that refuses every append: a `complete` line with no passing `wave-verify` before it.
const POISON = `${JSON.stringify({
  ts: "2026-08-02T00:00:00Z",
  schema_version: "1.4.0",
  run_id: "run-j",
  wave: "wave-1",
  order: 1,
  target: "wave-1",
  status: "complete",
  summary: "done",
  engine: "kiwi-orchestrator",
  writer: "speckiwi-orchestrate/test"
})}\n`;

async function run(argv: string[]): Promise<{ exit: number; payload: Record<string, unknown> }> {
  const pipes = { stdout: new PassThrough(), stderr: new PassThrough() };
  const exit = await main([...argv, "--json"], pipes);
  const text = pipes.stdout.read()?.toString() ?? "";
  return { exit, payload: text.length > 0 ? (JSON.parse(text) as Record<string, unknown>) : {} };
}

async function scheduleRoot(customText: string, defaultText: string): Promise<string> {
  const root = await sdsWorkspace([{ id: "run-j-wave-1", files: ["src/a.ts"] }]);
  await writeUnder(root, CUSTOM, customText);
  await writeUnder(root, DEFAULT, defaultText);
  await writeUnder(root, "existing.json", JSON.stringify(["src/a.ts"]));
  return root;
}

function scheduleArgv(root: string): string[] {
  return [
    "--root", root, "orchestrate", "schedule", "waves",
    "--sds", sdsPath("run-j-wave-1"),
    "--depends", "{}",
    "--existing-paths", "existing.json",
    "--strict-grounding",
    "--run-id", "run-j",
    "--journal", CUSTOM
  ];
}

describe("FR-NODE-213 AC-1 — schedule waves --journal <path>", { timeout: 60_000 }, () => {
  it("FR-NODE-213 AC-1: --journal <path> puts the freeze-lane-plan line in the named journal, not in kiwi/waves.jsonl", async () => {
    const root = await scheduleRoot("", "");
    const result = await run(scheduleArgv(root));
    expect(result.exit, JSON.stringify(result.payload)).toBe(0);
    expect(result.payload.journalWritten).toBe(true);

    const custom = (await readFile(path.join(root, CUSTOM), "utf8")).trim().split("\n");
    expect(custom).toHaveLength(1);
    expect(JSON.parse(custom[0] as string)).toMatchObject({ run_id: "run-j", verb: "freeze-lane-plan", strict_grounding: true });
    expect(await readFile(path.join(root, DEFAULT), "utf8")).toBe("");
  });

  it("FR-NODE-213 AC-1: --journal <path> is the journal the append validates — a refusing named journal refuses though kiwi/waves.jsonl is clean", async () => {
    const root = await scheduleRoot(POISON, "");
    const result = await run(scheduleArgv(root));
    expect(result.exit, JSON.stringify(result.payload)).toBe(2);
    expect(result.payload.gate).toBe("run-invariant-drift");
    expect(await readFile(path.join(root, CUSTOM), "utf8")).toBe(POISON);
    expect(await readFile(path.join(root, DEFAULT), "utf8")).toBe("");
  });

  it("FR-NODE-213 AC-1: --journal <path> leaves kiwi/waves.jsonl unread — a refusing default journal does not refuse a clean named one", async () => {
    const root = await scheduleRoot("", POISON);
    const result = await run(scheduleArgv(root));
    expect(result.exit, JSON.stringify(result.payload)).toBe(0);
    expect(result.payload.journalWritten).toBe(true);
    expect(await readFile(path.join(root, DEFAULT), "utf8")).toBe(POISON);
  });
});
