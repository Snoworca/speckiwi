import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { main } from "../../src/cli/index.js";
import {
  ORCHESTRATE_MCP_TOOLS,
  ORCHESTRATE_PHASE1_VERB_ROWS,
  ORCHESTRATE_TOOL_BINDINGS
} from "../../src/cli/commands/orchestrate.js";
import { CURRENT_WAVES_SCHEMA_VERSION } from "../../src/core/orchestrator/journal-schema.js";
import { liteSdsText, sdsPath, sdsWorkspace, writeUnder, type SdsSpec } from "../core/orchestrator/sds-fixtures.js";

// FR-NODE-213 — `speckiwi orchestrate schedule waves` plans one lane per wave from the wave SDS files,
// and the sidecar-era commands it replaces are gone.

const REPO_ROOT = path.resolve(__dirname, "../..");

function io() {
  return { stdout: new PassThrough(), stderr: new PassThrough() };
}

interface Run {
  readonly exit: number;
  readonly payload: Record<string, unknown>;
  readonly stderr: string;
}

async function orchestrate(root: string, argv: readonly string[]): Promise<Run> {
  const pipes = io();
  const exit = await main(["--root", root, "orchestrate", ...argv, "--json"], pipes);
  const text = pipes.stdout.read()?.toString() ?? "";
  return { exit, payload: text.length > 0 ? (JSON.parse(text) as Record<string, unknown>) : {}, stderr: pipes.stderr.read()?.toString() ?? "" };
}

async function scheduleWaves(root: string, ids: readonly string[], depends: Record<string, string[]>, extra: readonly string[] = []): Promise<Run> {
  return orchestrate(root, ["schedule", "waves", "--sds", ...ids.map(sdsPath), "--depends", JSON.stringify(depends), ...extra]);
}

interface LockLane {
  laneId: string;
  stage: number;
  wave: string;
  sds: string;
  writeSet: string[];
}

async function readLock(root: string, relativePath = "waves/lanes.lock.json"): Promise<{ text: string; body: Record<string, unknown> }> {
  const text = await readFile(path.join(root, relativePath), "utf8");
  return { text, body: JSON.parse(text) as Record<string, unknown> };
}

const SPECS: readonly SdsSpec[] = [
  { id: "run-wave-1", files: ["src/a.ts"], testFiles: ["test/a.test.ts"] },
  { id: "run-wave-2", files: ["src/b.ts"], testFiles: ["test/b.test.ts"] },
  { id: "run-wave-3", files: ["src/a.ts", "src/c.ts"] },
  { id: "run-wave-4", files: ["src/d.ts"] }
];

describe("FR-NODE-213 AC-1 orchestrate schedule waves writes a lanes lock with one lane per wave", () => {
  it("FR-NODE-213 AC-1 places every wave in its own lane, dependencies in earlier stages, overlapping waves apart", async () => {
    const root = await sdsWorkspace(SPECS);
    const run = await scheduleWaves(root, SPECS.map((spec) => spec.id), { "run-wave-2": [], "run-wave-3": [], "run-wave-4": ["run-wave-2"] });

    expect(run.exit, JSON.stringify(run.payload)).toBe(0);
    const { body } = await readLock(root);
    const lanes = body.lanes as LockLane[];
    expect(lanes.map((lane) => lane.wave).sort()).toEqual(SPECS.map((spec) => spec.id).sort());
    expect(lanes.find((lane) => lane.wave === "run-wave-1")).toEqual({
      laneId: "lane-run-wave-1",
      stage: 1,
      wave: "run-wave-1",
      sds: "docs/sds/run-wave-1.sds.md",
      writeSet: ["src/a.ts", "test/a.test.ts"]
    });
    const stageOf = (wave: string) => lanes.find((lane) => lane.wave === wave)?.stage as number;
    expect(stageOf("run-wave-3"), "run-wave-3 overlaps run-wave-1 on src/a.ts").not.toBe(stageOf("run-wave-1"));
    expect(stageOf("run-wave-4")).toBeGreaterThan(stageOf("run-wave-2"));
    expect(body.stages).toEqual([
      { index: 1, laneIds: ["lane-run-wave-1", "lane-run-wave-2"] },
      { index: 2, laneIds: ["lane-run-wave-3"] },
      { index: 3, laneIds: ["lane-run-wave-4"] }
    ]);
    expect(body.lane_count).toBe(4);
    expect(body.stage_count).toBe(3);
    expect(run.payload.lock).toEqual(body);
  });

  it("FR-NODE-213 AC-1 makes a wave missing from --depends depend on every earlier --sds wave", async () => {
    const root = await sdsWorkspace(SPECS.slice(0, 2));
    const run = await scheduleWaves(root, ["run-wave-1", "run-wave-2"], {});
    expect(run.exit).toBe(0);
    expect((await readLock(root)).body.stages).toEqual([
      { index: 1, laneIds: ["lane-run-wave-1"] },
      { index: 2, laneIds: ["lane-run-wave-2"] }
    ]);
  });

  it("FR-NODE-213 AC-1 holds at most N lanes per stage under --lanes N", async () => {
    const specs = [1, 2, 3].map((n) => ({ id: `cap-wave-${n}`, files: [`src/${n}.ts`] }));
    const root = await sdsWorkspace(specs);
    const run = await scheduleWaves(root, specs.map((spec) => spec.id), { "cap-wave-2": [], "cap-wave-3": [] }, ["--lanes", "2"]);
    expect(run.exit).toBe(0);
    expect(((await readLock(root)).body.stages as Array<{ laneIds: string[] }>).map((stage) => stage.laneIds.length)).toEqual([2, 1]);
    expect((await readLock(root)).body.lane_cap).toBe(2);
  });

  it("FR-NODE-213 AC-1 writes byte-identical output for the same inputs, whatever key order --depends was written in", async () => {
    const root = await sdsWorkspace(SPECS);
    const ids = SPECS.map((spec) => spec.id);
    await scheduleWaves(root, ids, { "run-wave-2": [], "run-wave-3": [], "run-wave-4": ["run-wave-2"] }, ["--out", "first.json"]);
    await scheduleWaves(root, ids, { "run-wave-4": ["run-wave-2"], "run-wave-3": [], "run-wave-2": [] }, ["--out", "second.json"]);
    const first = await readLock(root, "first.json");
    const second = await readLock(root, "second.json");
    expect(second.text).toBe(first.text);
  });

  it("FR-NODE-213 AC-1 refuses a dependency cycle with schedule-cycle and writes no lock", async () => {
    const root = await sdsWorkspace(SPECS.slice(0, 2));
    const run = await scheduleWaves(root, ["run-wave-1", "run-wave-2"], { "run-wave-1": ["run-wave-2"], "run-wave-2": ["run-wave-1"] });
    expect(run.exit).toBe(2);
    expect(run.payload.gate).toBe("schedule-cycle");
    expect(existsSync(path.join(root, "waves/lanes.lock.json"))).toBe(false);
  });

  it("FR-NODE-213 AC-1 refuses a --depends naming a wave outside --sds as an operational error", async () => {
    const root = await sdsWorkspace(SPECS.slice(0, 1));
    const run = await scheduleWaves(root, ["run-wave-1"], { "run-wave-1": ["run-wave-9"] });
    expect(run.exit).toBe(1);
    expect(String(run.payload.error)).toContain("run-wave-9");
  });

  it("FR-NODE-213 AC-1 refuses an SDS that is not a lite-profile file rather than scheduling a guessed write set", async () => {
    const root = await sdsWorkspace([]);
    await writeUnder(root, sdsPath("not-lite"), "# SDS\n\nno metadata table here\n");
    const run = await scheduleWaves(root, ["not-lite"], {});
    expect(run.exit).toBe(1);
    expect(String(run.payload.error)).toContain("not-lite");
  });

  it("FR-NODE-213 AC-1 requires --sds and --depends", async () => {
    const root = await sdsWorkspace(SPECS.slice(0, 1));
    expect((await orchestrate(root, ["schedule", "waves", "--depends", "{}"])).exit).not.toBe(0);
    expect((await orchestrate(root, ["schedule", "waves", "--sds", sdsPath("run-wave-1")])).exit).not.toBe(0);
  });
});

describe("FR-NODE-213 AC-1 refuses an --sds file whose sds check reports an error", () => {
  const LOCK = "waves/lanes.lock.json";

  async function refusedWithoutLock(root: string, run: Run, code: string): Promise<void> {
    expect(run.exit, JSON.stringify(run.payload)).toBe(1);
    expect(String(run.payload.error)).toContain(code);
    expect(existsSync(path.join(root, LOCK)), "a refused call writes no lock").toBe(false);
  }

  it("FR-NODE-213 AC-1 refuses a lite SDS with a structural error: a contract with no Test Plan row", async () => {
    const root = await sdsWorkspace([]);
    const text = liteSdsText({ id: "broken", files: ["src/a.ts"], testFiles: ["test/a.test.ts"] }).replace(/^\| SDS-AC-1 \|.*\n/m, "");
    await writeUnder(root, sdsPath("broken"), text);
    await refusedWithoutLock(root, await scheduleWaves(root, ["broken"], {}), "SDS-E064");
  });

  it("FR-NODE-213 AC-1 refuses a lite SDS whose @req names no existing requirement", async () => {
    const root = await sdsWorkspace([{ id: "unresolved", files: ["src/a.ts"], reqIds: ["FR-ARCH-099"] }]);
    await refusedWithoutLock(root, await scheduleWaves(root, ["unresolved"], {}), "SDS-E062");
  });

  it("FR-NODE-213 AC-1 refuses a lite SDS whose contract interprets an AC the requirement does not have", async () => {
    const root = await sdsWorkspace([]);
    const text = liteSdsText({ id: "bad-ac", files: ["src/a.ts"], testFiles: ["test/a.test.ts"] }).replace("(FR-ARCH-001 AC-1)", "(FR-ARCH-001 AC-9)");
    await writeUnder(root, sdsPath("bad-ac"), text);
    await refusedWithoutLock(root, await scheduleWaves(root, ["bad-ac"], {}), "SDS-E063");
  });

  it("FR-NODE-213 AC-1 refuses when the workspace has no SRS for the SDS to be checked against", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "speckiwi-schedule-no-srs-"));
    await writeUnder(root, sdsPath("orphan"), liteSdsText({ id: "orphan", files: ["src/a.ts"] }));
    const run = await scheduleWaves(root, ["orphan"], {});
    expect(run.exit, JSON.stringify(run.payload)).toBe(1);
    expect(existsSync(path.join(root, LOCK))).toBe(false);
  });

  it("FR-NODE-213 AC-1 refuses the whole call when one of several --sds files fails its check", async () => {
    const root = await sdsWorkspace([SPECS[0] as SdsSpec, { id: "unresolved", files: ["src/z.ts"], reqIds: ["FR-ARCH-099"] }]);
    await refusedWithoutLock(root, await scheduleWaves(root, ["run-wave-1", "unresolved"], { unresolved: [] }), "unresolved");
  });
});

describe("FR-NODE-213 AC-1 an --sds entry <waveId>=<file>,<file> schedules the files as one wave", () => {
  const PARTS: readonly SdsSpec[] = [
    { id: "big-1", files: ["src/p.ts"], testFiles: ["test/p.test.ts"] },
    { id: "big-2", files: ["src/q.ts"] },
    { id: "small", files: ["src/r.ts"] }
  ];
  const GROUP = `big=${sdsPath("big-1")},${sdsPath("big-2")}`;

  async function scheduleEntries(root: string, entries: readonly string[], depends: Record<string, string[]>, extra: readonly string[] = []): Promise<Run> {
    return orchestrate(root, ["schedule", "waves", "--sds", ...entries, "--depends", JSON.stringify(depends), ...extra]);
  }

  async function digestOf(root: string, relativePath: string): Promise<string> {
    return createHash("sha256").update(await readFile(path.join(root, relativePath))).digest("hex");
  }

  it("FR-NODE-213 AC-1 gives the group one lane whose write set is the union of its files", async () => {
    const root = await sdsWorkspace(PARTS);
    const run = await scheduleEntries(root, [GROUP, sdsPath("small")], { small: [] });
    expect(run.exit, JSON.stringify(run.payload)).toBe(0);
    const { body } = await readLock(root);
    const lanes = body.lanes as Array<Omit<LockLane, "sds"> & { sds: unknown }>;
    expect(lanes.map((lane) => lane.wave).sort()).toEqual(["big", "small"]);
    expect(lanes.find((lane) => lane.wave === "big")).toEqual({
      laneId: "lane-big",
      stage: 1,
      wave: "big",
      sds: [sdsPath("big-1"), sdsPath("big-2")],
      writeSet: ["src/p.ts", "src/q.ts", "test/p.test.ts"]
    });
    expect(lanes.find((lane) => lane.wave === "small")?.sds).toBe(sdsPath("small"));
  });

  it("FR-NODE-213 AC-2 records one digest per file of a grouped wave, and a plain digest for a one-file wave", async () => {
    const root = await sdsWorkspace(PARTS);
    await scheduleEntries(root, [GROUP, sdsPath("small")], { small: [] });
    const { body } = await readLock(root);
    expect(body.sds_digests).toEqual({
      big: { [sdsPath("big-1")]: await digestOf(root, sdsPath("big-1")), [sdsPath("big-2")]: await digestOf(root, sdsPath("big-2")) },
      small: await digestOf(root, sdsPath("small"))
    });
    const { freezeLock } = await import("../../src/core/orchestrator/freeze.js");
    const frozen = freezeLock("lanes", body, { runId: "run", gitBlobOid: "0".repeat(40), writtenAt: "2026-09-27T00:00:00.000Z", declaredInputs: {} });
    expect(frozen.ok, JSON.stringify(frozen)).toBe(true);
  });

  it("FR-NODE-213 AC-1 keys --depends by the group's wave id", async () => {
    const root = await sdsWorkspace(PARTS);
    const run = await scheduleEntries(root, [sdsPath("small"), GROUP], { big: ["small"] });
    expect(run.exit, JSON.stringify(run.payload)).toBe(0);
    expect((await readLock(root)).body.stages).toEqual([
      { index: 1, laneIds: ["lane-small"] },
      { index: 2, laneIds: ["lane-big"] }
    ]);
  });

  it("FR-NODE-213 AC-1 applies the sds check to every file of a group", async () => {
    const root = await sdsWorkspace([...PARTS, { id: "big-3", files: ["src/s.ts"], reqIds: ["FR-ARCH-099"] }]);
    const run = await scheduleEntries(root, [`${GROUP},${sdsPath("big-3")}`], {});
    expect(run.exit, JSON.stringify(run.payload)).toBe(1);
    expect(String(run.payload.error)).toContain("SDS-E062");
    expect(existsSync(path.join(root, "waves/lanes.lock.json"))).toBe(false);
  });

  it("FR-NODE-213 AC-1 refuses a group entry with no wave id, no files, or a wave id no lane or branch name can carry", async () => {
    const root = await sdsWorkspace(PARTS);
    for (const entry of [`=${sdsPath("big-1")}`, "big=", `big=${sdsPath("big-1")},`, `x/y z=${sdsPath("big-1")}`, `-big=${sdsPath("big-1")}`]) {
      const run = await scheduleEntries(root, [entry], {});
      expect(run.exit, `${entry}: ${JSON.stringify(run.payload)}`).toBe(1);
      expect(existsSync(path.join(root, "waves/lanes.lock.json")), entry).toBe(false);
    }
  });

  it("FR-NODE-213 AC-1 tells an MCP caller the group form, which it has no --help to learn from", () => {
    const binding = ORCHESTRATE_TOOL_BINDINGS.find((entry) => entry.tool === "orchestrate_schedule_waves");
    expect(binding?.description).toContain("<waveId>=<file>,<file>");
  });

  it("FR-NODE-213 AC-1 refuses one SDS file named twice — in one group or in two waves — as lane-plan-incomplete", async () => {
    const root = await sdsWorkspace(PARTS);
    const cases: ReadonlyArray<readonly string[]> = [
      [`big=${sdsPath("big-1")},${sdsPath("big-1")}`],
      [`big=${sdsPath("big-1")},./${sdsPath("big-1")}`],
      [sdsPath("big-1"), GROUP],
      [GROUP, `other=${sdsPath("big-2")},${sdsPath("small")}`]
    ];
    for (const entries of cases) {
      const run = await scheduleEntries(root, entries, {});
      expect(run.exit, `${entries.join(" ")}: ${JSON.stringify(run.payload)}`).toBe(2);
      expect(run.payload.gate, entries.join(" ")).toBe("lane-plan-incomplete");
      expect(existsSync(path.join(root, "waves/lanes.lock.json")), entries.join(" ")).toBe(false);
    }
  });

  it.runIf(process.platform === "win32")("FR-NODE-213 AC-1 treats two spellings of one file on a case-insensitive file system as the same file", async () => {
    const root = await sdsWorkspace(PARTS);
    const run = await scheduleEntries(root, [`big=${sdsPath("big-1")},${sdsPath("big-1").toUpperCase().replace(".SDS.MD", ".sds.md")}`], {});
    expect(run.payload.gate, JSON.stringify(run.payload)).toBe("lane-plan-incomplete");
  });
});

describe("FR-NODE-213 AC-2 the lanes lock records one SDS digest per wave", () => {
  it("FR-NODE-213 AC-2 records sha256 of each SDS file under its wave id, and no sidecar digest", async () => {
    const root = await sdsWorkspace(SPECS.slice(0, 2));
    await scheduleWaves(root, ["run-wave-1", "run-wave-2"], { "run-wave-2": [] });
    const { body } = await readLock(root);
    const expected: Record<string, string> = {};
    for (const id of ["run-wave-1", "run-wave-2"]) {
      expected[id] = createHash("sha256").update(await readFile(path.join(root, sdsPath(id)))).digest("hex");
    }
    expect(body.sds_digests).toEqual(expected);
    expect(body.depends).toEqual({ "run-wave-2": [] });
    expect(Object.keys(body)).not.toContain("sidecar_digest");
  });

  it("FR-NODE-213 AC-2 writes a lock that the lanes freeze kind accepts as its body", async () => {
    const root = await sdsWorkspace(SPECS.slice(0, 1));
    await scheduleWaves(root, ["run-wave-1"], {});
    const { body } = await readLock(root);
    const { freezeLock } = await import("../../src/core/orchestrator/freeze.js");
    const frozen = freezeLock("lanes", body, { runId: "run", gitBlobOid: "0".repeat(40), writtenAt: "2026-09-27T00:00:00.000Z", declaredInputs: {} });
    expect(frozen.ok, JSON.stringify(frozen)).toBe(true);
  });

  it("FR-NODE-213 AC-2 changes the recorded digest when the SDS changes", async () => {
    const root = await sdsWorkspace(SPECS.slice(0, 1));
    await scheduleWaves(root, ["run-wave-1"], {}, ["--out", "before.json"]);
    await writeUnder(root, sdsPath("run-wave-1"), (await readFile(path.join(root, sdsPath("run-wave-1")), "utf8")).replace("responsibility 1", "responsibility one"));
    await scheduleWaves(root, ["run-wave-1"], {}, ["--out", "after.json"]);
    const before = (await readLock(root, "before.json")).body.sds_digests as Record<string, string>;
    const after = (await readLock(root, "after.json")).body.sds_digests as Record<string, string>;
    expect(after["run-wave-1"]).not.toBe(before["run-wave-1"]);
  });
});

describe("FR-NODE-213 AC-3 the sidecar-era scheduling surface is removed", () => {
  it("FR-NODE-213 AC-3 no longer registers schedule plan, handoff validate or coupling check", async () => {
    const root = await sdsWorkspace([]);
    for (const argv of [["schedule", "plan", "--plan", "x.json"], ["handoff", "validate"], ["coupling", "check", "--handoffs", "x.json"]]) {
      const run = await orchestrate(root, argv);
      expect(run.exit, argv.join(" ")).not.toBe(0);
      expect(run.payload.ok, argv.join(" ")).not.toBe(true);
    }
    expect(ORCHESTRATE_PHASE1_VERB_ROWS as readonly string[]).toContain("schedule waves");
    for (const row of ["schedule plan", "handoff validate", "coupling check"]) {
      expect(ORCHESTRATE_PHASE1_VERB_ROWS as readonly string[], row).not.toContain(row);
    }
  });

  it("FR-NODE-213 AC-3 binds orchestrate_schedule_waves and no longer binds the plan, handoff or coupling tools", () => {
    const tools = ORCHESTRATE_TOOL_BINDINGS.map((binding) => binding.tool);
    expect(tools).toContain("orchestrate_schedule_waves");
    expect(ORCHESTRATE_MCP_TOOLS.orchestrate_schedule_waves).toBe("schedule waves");
    for (const removed of ["orchestrate_schedule_plan", "orchestrate_handoff_validate", "orchestrate_coupling_check"]) {
      expect(tools, removed).not.toContain(removed);
    }
  });

  it("FR-NODE-213 AC-3 removes the sidecar task catalogue, the handoff validator and the substrate coupling check modules", () => {
    for (const module of ["task-catalog.ts", "handoff.ts", "substrate.ts"]) {
      expect(existsSync(path.join(REPO_ROOT, "src/core/orchestrator", module)), module).toBe(false);
    }
  });
});

describe("FR-NODE-213 AC-6 the tool stamps its journal lines with the raised schema version", () => {
  it("FR-NODE-213 AC-6 lands a strict-grounding journal line after a raised-version line rather than refusing it as a downgrade", async () => {
    const root = await sdsWorkspace(SPECS.slice(0, 1));
    const earlier = {
      ts: "2026-09-27T09:00:00.000Z",
      schema_version: CURRENT_WAVES_SCHEMA_VERSION,
      run_id: "run-a",
      engine: "kiwi-orchestrator",
      writer: "speckiwi-orchestrate/4.0.0",
      verb: "sds-wave",
      event: "result",
      wave: "wave-1",
      sds_id: "run-wave-1"
    };
    await writeUnder(root, "kiwi/waves.jsonl", `${JSON.stringify(earlier)}\n`);
    await writeUnder(root, "existing.json", "[]");
    // The SDS paths are new files, which strict grounding refuses; the journal line lands first.
    const run = await scheduleWaves(root, ["run-wave-1"], {}, ["--strict-grounding", "--run-id", "run-a", "--existing-paths", "existing.json"]);
    expect(run.payload.gate).toBe("files-not-grounded");
    const journal = (await readFile(path.join(root, "kiwi/waves.jsonl"), "utf8")).trim().split("\n");
    expect(run.payload.gate, JSON.stringify(run.payload)).not.toBe("run-invariant-drift");
    expect(journal).toHaveLength(2);
    expect(JSON.parse(journal[1] as string)).toMatchObject({ verb: "freeze-lane-plan", schema_version: CURRENT_WAVES_SCHEMA_VERSION });
  });
});
