import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { main } from "../../src/cli/index.js";
import { schemaVersionOf, type WavesEvent } from "../../src/core/orchestrator/journal-schema.js";
import { sdsPath, sdsWorkspace, writeUnder, type SdsSpec } from "../core/orchestrator/sds-fixtures.js";

// FR-NODE-213 AC-1 — the clauses of the revised criterion the scheduler tests did not reach: a
// `--depends` key naming no `--sds` wave is not read, and two entries yielding one wave id are refused
// as lane-plan-incomplete only after the grounding check.
// FR-NODE-213 AC-6 — the tool stamps 2.0.0 on the lines it composes itself, while `journal append`
// writes the caller's schema_version as given and never fills a missing one.

const execFileAsync = promisify(execFile);

async function orchestrate(root: string, argv: readonly string[]): Promise<{ exit: number; payload: Record<string, unknown> }> {
  const pipes = { stdout: new PassThrough(), stderr: new PassThrough() };
  const exit = await main(["--root", root, "orchestrate", ...argv, "--json"], pipes);
  const text = pipes.stdout.read()?.toString() ?? "";
  return { exit, payload: text.length > 0 ? (JSON.parse(text) as Record<string, unknown>) : {} };
}

const SPECS: readonly SdsSpec[] = [
  { id: "wave-a", files: ["src/a.ts"] },
  { id: "wave-b", files: ["src/b.ts"] }
];

async function schedule(root: string, entries: readonly string[], depends: unknown, extra: readonly string[] = []) {
  return orchestrate(root, ["schedule", "waves", "--sds", ...entries, "--depends", JSON.stringify(depends), ...extra]);
}

async function journalLines(root: string): Promise<Array<Record<string, unknown>>> {
  const text = await readFile(path.join(root, "kiwi", "waves.jsonl"), "utf8");
  return text.split("\n").filter((line) => line.trim().length > 0).map((line) => JSON.parse(line) as Record<string, unknown>);
}

describe("FR-NODE-213 AC-1 — the revised scheduler clauses", { timeout: 60_000 }, () => {
  it("FR-NODE-213 AC-1: a --depends key that names no --sds wave is not read, whatever it holds", async () => {
    const root = await sdsWorkspace(SPECS);
    const entries = SPECS.map((spec) => sdsPath(spec.id));
    const baseline = await schedule(root, entries, { "wave-b": [] }, ["--out", "baseline.json"]);
    expect(baseline.exit, JSON.stringify(baseline.payload)).toBe(0);
    // Not read at all: neither checked nor carried into the lock, so the lock is byte-identical to one
    // written without the stray key — its recorded depends included.
    const expected = await readFile(path.join(root, "baseline.json"), "utf8");

    const strays: ReadonlyArray<[string, unknown]> = [
      ["a stray key over live waves", { ghost: ["wave-a", "wave-b"] }],
      ["a stray key over an unknown wave", { ghost: ["nowhere"] }],
      ["a stray key over a cycle", { ghost: ["ghost"] }],
      ["a stray key whose value is not a list", { ghost: "not-a-list" }]
    ];
    for (const [label, stray] of strays) {
      const out = `stray-${strays.findIndex(([name]) => name === label)}.json`;
      const run = await schedule(root, entries, { "wave-b": [], ...(stray as Record<string, unknown>) }, ["--out", out]);
      expect(run.exit, `${label}: ${JSON.stringify(run.payload)}`).toBe(0);
      expect(await readFile(path.join(root, out), "utf8"), label).toBe(expected);
    }
  });

  it("FR-NODE-213 AC-1: a group entry is not checked for being the parts of one sds-id", async () => {
    const root = await sdsWorkspace(SPECS);
    // Two unrelated SDS ids under a third wave id: the tool schedules the union and asks nothing more.
    const run = await schedule(root, [`mixed=${sdsPath("wave-b")},${sdsPath("wave-a")}`], {});
    expect(run.exit, JSON.stringify(run.payload)).toBe(0);
    const lock = JSON.parse(await readFile(path.join(root, "waves/lanes.lock.json"), "utf8")) as { lanes: Array<{ wave: string; writeSet: string[] }> };
    expect(lock.lanes).toMatchObject([{ wave: "mixed", writeSet: ["src/a.ts", "src/b.ts"] }]);
  });

  it("FR-NODE-213 AC-1: two entries yielding one wave id are refused as lane-plan-incomplete, after an ungrounded path is reported", async () => {
    const root = await sdsWorkspace(SPECS);
    // `wave-a` from the plain file name, and `wave-a` again from a group entry over the other file.
    const clash = [sdsPath("wave-a"), `wave-a=${sdsPath("wave-b")}`];

    const refused = await schedule(root, clash, {});
    expect(refused.exit, JSON.stringify(refused.payload)).toBe(2);
    expect(refused.payload.gate).toBe("lane-plan-incomplete");
    expect(existsSync(path.join(root, "waves/lanes.lock.json"))).toBe(false);

    // With a path that does not ground, the grounding refusal comes first.
    await writeUnder(root, "base.json", JSON.stringify(["src/a.ts"]));
    const ungrounded = await schedule(root, clash, {}, ["--strict-grounding", "--existing-paths", "base.json"]);
    expect(ungrounded.exit, JSON.stringify(ungrounded.payload)).toBe(2);
    expect(ungrounded.payload.gate).toBe("files-not-grounded");
    expect(JSON.stringify(ungrounded.payload.violations)).toContain("src/b.ts");
    expect(existsSync(path.join(root, "waves/lanes.lock.json"))).toBe(false);

    // Once every path grounds, the duplicate wave id is what refuses.
    await writeUnder(root, "base.json", JSON.stringify(["src/a.ts", "src/b.ts"]));
    const grounded = await schedule(root, clash, {}, ["--strict-grounding", "--existing-paths", "base.json"]);
    expect(grounded.payload.gate, JSON.stringify(grounded.payload)).toBe("lane-plan-incomplete");
  });
});

describe("FR-NODE-213 AC-6 — who stamps the schema version", { timeout: 60_000 }, () => {
  it("FR-NODE-213 AC-6: the tool stamps 2.0.0 on the lines it composes itself — run abort and round record", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "speckiwi-fr-node-213-ac6-stamp-"));
    await execFileAsync("git", ["init", "--quiet"], { cwd: root });
    await mkdir(path.join(root, "kiwi"), { recursive: true });
    await writeFile(path.join(root, "kiwi", "waves.jsonl"), "", "utf8");

    const round = {
      loop: "D", scope: "design", roundIndex: 1, mode: "normal", cap: 5, streakBefore: 0, frozenDenominator: 1,
      rows: [{ id: "R-1", verdict: "pass", severity: "MEDIUM" }], fixAppliedThisRound: false,
      regression: { failingTests: [], baselineFailingTests: [], exitCode: 0 }, residual: []
    };
    const recorded = await orchestrate(root, ["round", "record", "--run-id", "run-a", "--payload", JSON.stringify(round), "--proof", JSON.stringify({ kind: "digest", ref: "sha256:0123456789abcdef" })]);
    expect(recorded.exit, JSON.stringify(recorded.payload)).toBe(0);

    const locked = await orchestrate(root, ["run", "lock", "--owner", "fr-node-213-ac6"]);
    expect(locked.exit, JSON.stringify(locked.payload)).toBe(0);
    const aborted = await orchestrate(root, ["run", "abort", "--reason", "design-contradiction-at-wave-boundary", "--run-id", "run-a"]);
    expect(aborted.exit, JSON.stringify(aborted.payload)).toBe(0);

    const lines = await journalLines(root);
    expect(lines.map((line) => [line.verb, line.schema_version])).toEqual([
      [lines[0]?.verb, "2.0.0"],
      ["abort-run", "2.0.0"]
    ]);
    expect(lines[0]?.phase, "the first line is the round record").toBe("design");
  });

  it("FR-NODE-213 AC-6: journal append writes the caller's schema_version as given and does not fill a missing one", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "speckiwi-fr-node-213-ac6-append-"));
    await mkdir(path.join(root, "kiwi"), { recursive: true });
    await writeFile(path.join(root, "kiwi", "waves.jsonl"), "", "utf8");
    const base = { run_id: "run-a", engine: "kiwi-orchestrator", event: "intent", wave: "wave-1" };

    // No schema_version: the line is written without one and reads as 1.0.0, so a verb retired at 2.0.0
    // is still admitted on it — a filled-in 2.0.0 would have refused this very append.
    const unversioned = await orchestrate(root, ["journal", "append", "--run-id", "run-a", "--payload", JSON.stringify({ ...base, verb: "execute-unit" })]);
    expect(unversioned.exit, JSON.stringify(unversioned.payload)).toBe(0);
    // An earlier version the caller names is kept, not raised.
    const earlier = await orchestrate(root, ["journal", "append", "--run-id", "run-a", "--payload", JSON.stringify({ ...base, schema_version: "1.5.0", verb: "author-design" })]);
    expect(earlier.exit, JSON.stringify(earlier.payload)).toBe(0);

    const lines = await journalLines(root);
    expect(lines).toHaveLength(2);
    expect(Object.prototype.hasOwnProperty.call(lines[0], "schema_version"), "a missing schema_version is not filled").toBe(false);
    expect(lines[1]?.schema_version).toBe("1.5.0");

    expect(lines.map((line, index) => schemaVersionOf({ ...line, journalLine: index + 1 } as WavesEvent))).toEqual(["1.0.0", "1.5.0"]);
  });
});
