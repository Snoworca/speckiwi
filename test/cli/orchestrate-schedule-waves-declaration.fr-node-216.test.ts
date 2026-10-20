import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { main } from "../../src/cli/index.js";
import { ORCHESTRATE_TOOL_BINDINGS } from "../../src/cli/commands/orchestrate.js";
import { canonicalJson } from "../../src/core/orchestrator/canonical-json.js";
import { freezeLock } from "../../src/core/orchestrator/freeze.js";
import { liteSdsText, sdsPath, sdsWorkspace, writeUnder } from "../core/orchestrator/sds-fixtures.js";

// FR-NODE-216 — `speckiwi orchestrate schedule waves --waves <file> --run-id <id>` plans the ready waves
// of a wave declaration file, reading readiness from the run's journal and needing no SDS file.

const RUN = "r1";
const DECLARATION = "waves/waves.json";
const LOCK = "waves/lanes.lock.json";

interface Run {
  readonly exit: number;
  readonly payload: Record<string, unknown>;
}

async function orchestrate(root: string, argv: readonly string[]): Promise<Run> {
  const pipes = { stdout: new PassThrough(), stderr: new PassThrough() };
  const exit = await main(["--root", root, "orchestrate", ...argv, "--json"], pipes);
  const text = pipes.stdout.read()?.toString() ?? "";
  return { exit, payload: text.length > 0 ? (JSON.parse(text) as Record<string, unknown>) : {} };
}

type Entry = Record<string, unknown>;

function entry(n: number, extra: Entry = {}): Entry {
  return { wave: `wave-${n}`, files: [`src/w${n}.ts`], requirements: ["FR-ARCH-001"], ...extra };
}

/** A copy of the valid-basic workspace (FR-ARCH-001 planned and stable) holding a declaration and no SDS. */
async function workspace(waves: readonly Entry[], journal: readonly Entry[] = []): Promise<string> {
  const root = await sdsWorkspace([]);
  await writeUnder(root, DECLARATION, JSON.stringify({ schema_version: "1.0.0", waves }));
  await writeUnder(root, "existing.json", "[]");
  if (journal.length > 0) await writeUnder(root, "kiwi/waves.jsonl", `${journal.map((line) => JSON.stringify(line)).join("\n")}\n`);
  return root;
}

function completeLine(n: number): Entry {
  return {
    schema_version: "2.0.0",
    ts: "2026-10-20T00:00:00.000Z",
    run_id: RUN,
    engine: "kiwi-orchestrator",
    wave: `wave-${n}`,
    order: n,
    target: "4.1.0",
    status: "complete",
    summary: `wave ${n} done`
  };
}

async function schedule(root: string, extra: readonly string[] = []): Promise<Run> {
  return orchestrate(root, ["schedule", "waves", "--waves", DECLARATION, "--run-id", RUN, "--existing-paths", "existing.json", ...extra]);
}

interface LockLane {
  laneId: string;
  stage: number;
  wave: string;
  sds: unknown;
  writeSet: string[];
}

async function lock(root: string, relativePath = LOCK): Promise<{ text: string; body: Record<string, unknown> }> {
  const text = await readFile(path.join(root, relativePath), "utf8");
  return { text, body: JSON.parse(text) as Record<string, unknown> };
}

function expectRefusedAtParse(root: string, run: Run, ...fragments: string[]): void {
  expect(run.exit, JSON.stringify(run.payload)).toBe(1);
  for (const fragment of fragments) expect(String(run.payload.error)).toContain(fragment);
  expect(existsSync(path.join(root, LOCK)), "a refused call writes no lock").toBe(false);
}

describe("FR-NODE-216 AC-1 the declaration file is checked at parse time", () => {
  it("FR-NODE-216 AC-1 refuses a wave named outside wave-<n> with exit 1 and no lock", async () => {
    for (const name of ["1", "api", "w1", "wave-0"]) {
      const root = await workspace([{ ...entry(1), wave: name }]);
      expectRefusedAtParse(root, await schedule(root), name);
    }
  });

  it("FR-NODE-216 AC-1 refuses an unknown key, a duplicate wave, a dependency naming no entry and a cycle", async () => {
    const unknown = await workspace([entry(1, { owner: "x" })]);
    expectRefusedAtParse(unknown, await schedule(unknown), "owner");
    const duplicate = await workspace([entry(1), entry(1)]);
    expectRefusedAtParse(duplicate, await schedule(duplicate), "lane-plan-incomplete", "wave-1");
    const dangling = await workspace([entry(1, { depends_on: ["wave-4"] })]);
    expectRefusedAtParse(dangling, await schedule(dangling), "wave-4");
    const cycle = await workspace([entry(1, { depends_on: ["wave-2"] }), entry(2, { depends_on: ["wave-1"] })]);
    expectRefusedAtParse(cycle, await schedule(cycle), "schedule-cycle");
  });

  it("FR-NODE-216 AC-1 makes an entry without depends_on wait for every entry with a smaller n", async () => {
    const root = await workspace([entry(1), entry(2)]);
    const run = await schedule(root);
    expect(run.exit, JSON.stringify(run.payload)).toBe(0);
    expect(((await lock(root)).body.lanes as LockLane[]).map((lane) => lane.wave)).toEqual([`${RUN}-wave-1`]);
    expect(run.payload.deferred).toEqual(["wave-2"]);
  });
});

describe("FR-NODE-216 AC-2 the planned set is the ready entries of the run's journal", () => {
  it("FR-NODE-216 AC-2 plans wave 2 once wave 1 is complete, defers wave 3 and keeps both out of the lock", async () => {
    const root = await workspace(
      [entry(1, { depends_on: [] }), entry(2, { depends_on: ["wave-1"] }), entry(3, { depends_on: ["wave-2"] })],
      [completeLine(1)]
    );
    const run = await schedule(root);
    expect(run.exit, JSON.stringify(run.payload)).toBe(0);
    const { body } = await lock(root);
    expect((body.lanes as LockLane[]).map((lane) => lane.wave)).toEqual([`${RUN}-wave-2`]);
    expect(run.payload.deferred).toEqual(["wave-3"]);
    expect(run.payload.complete).toEqual(["wave-1"]);
    expect(Object.keys(body.declaration_digests as object)).toEqual([`${RUN}-wave-2`]);
  });

  it("FR-NODE-216 AC-2 reads only the named run's lines under the named engine", async () => {
    const otherRun = { ...completeLine(1), run_id: "other" };
    const otherEngine = { ...completeLine(1), engine: "kiwi-wave-master" };
    const root = await workspace([entry(1, { depends_on: [] }), entry(2, { depends_on: ["wave-1"] })], [otherRun, otherEngine]);
    const run = await schedule(root);
    expect(run.exit, JSON.stringify(run.payload)).toBe(0);
    expect(run.payload.deferred).toEqual(["wave-2"]);
    const masterRun = await schedule(root, ["--engine", "kiwi-wave-master", "--out", "master.json"]);
    expect(masterRun.exit, JSON.stringify(masterRun.payload)).toBe(0);
    expect(((await lock(root, "master.json")).body.lanes as LockLane[]).map((lane) => lane.wave)).toEqual([`${RUN}-wave-2`]);
  });

  it("FR-NODE-216 AC-2 refuses a planned entry with no requirements, naming the wave", async () => {
    const root = await workspace([entry(1, { requirements: [] })]);
    expectRefusedAtParse(root, await schedule(root), "wave-1");
  });

  it("FR-NODE-216 AC-2 does not refuse a deferred entry with no requirements", async () => {
    const root = await workspace([entry(1), entry(2, { requirements: [] })]);
    expect((await schedule(root)).exit).toBe(0);
  });
});

describe("FR-NODE-216 AC-3 waves with disjoint files share a stage without any SDS", () => {
  it("FR-NODE-216 AC-3 places two independent disjoint entries in one stage as two lanes", async () => {
    const root = await workspace([entry(1, { depends_on: [] }), entry(2, { depends_on: [] })]);
    expect(existsSync(path.join(root, "docs/sds"))).toBe(false);
    const run = await schedule(root);
    expect(run.exit, JSON.stringify(run.payload)).toBe(0);
    const { body } = await lock(root);
    expect(body.stages).toEqual([{ index: 1, laneIds: [`lane-${RUN}-wave-1`, `lane-${RUN}-wave-2`] }]);
    expect((body.lanes as LockLane[]).map((lane) => [lane.wave, lane.sds, lane.writeSet])).toEqual([
      [`${RUN}-wave-1`, null, ["src/w1.ts"]],
      [`${RUN}-wave-2`, null, ["src/w2.ts"]]
    ]);
    expect(body.sds_digests).toEqual({});
  });

  it("FR-NODE-216 AC-3 still separates two independent entries whose files overlap", async () => {
    const root = await workspace([entry(1, { depends_on: [] }), entry(2, { depends_on: [], files: ["src/w1.ts"] })]);
    const run = await schedule(root);
    expect(run.exit, JSON.stringify(run.payload)).toBe(0);
    expect((await lock(root)).body.stage_count).toBe(2);
  });
});

describe("FR-NODE-216 AC-3 two spellings of one path are one path", () => {
  it("FR-NODE-216 AC-3 keeps src\\a.ts and src/a.ts apart as an overlap, and refuses a path outside the root at parse time", async () => {
    const root = await workspace([entry(1, { depends_on: [], files: ["src\\a.ts"] }), entry(2, { depends_on: [], files: ["src/a.ts"] })]);
    const run = await schedule(root);
    expect(run.exit, JSON.stringify(run.payload)).toBe(0);
    const { body } = await lock(root);
    expect(body.stage_count).toBe(2);
    expect((body.conflicts as Array<{ reason: string; paths?: string[] }>).find((edge) => edge.reason === "write-set-overlap")?.paths).toEqual(["src/a.ts"]);

    const outside = await workspace([entry(1, { files: ["../../etc/passwd"] })]);
    expectRefusedAtParse(outside, await schedule(outside), "../../etc/passwd");
    const absolute = await workspace([entry(1, { files: ["C:\\Windows\\x.ts"] })]);
    expectRefusedAtParse(absolute, await schedule(absolute), "absolute");
  });
});

describe("FR-NODE-216 AC-1 one SDS file belongs to one entry", () => {
  it("FR-NODE-216 AC-1 refuses an SDS file two entries name, however spelled, with lane-plan-incomplete and no lock", async () => {
    const root = await workspace([
      entry(1, { depends_on: [], sds: [sdsPath("shared")] }),
      entry(2, { depends_on: [], files: ["src/other.ts"], sds: [sdsPath("shared").replaceAll("/", "\\")] })
    ]);
    await writeUnder(root, sdsPath("shared"), liteSdsText({ id: "shared", files: ["src/s.ts"] }));
    const run = await schedule(root);
    expect(run.exit, JSON.stringify(run.payload)).toBe(2);
    expect(run.payload.gate).toBe("lane-plan-incomplete");
    expect(JSON.stringify(run.payload.violations)).toContain("shared");
    expect(existsSync(path.join(root, LOCK))).toBe(false);
  });
});

describe("FR-NODE-216 AC-11 the run id becomes part of every wave and lane id", () => {
  it("FR-NODE-216 AC-11 refuses a --run-id a lane or branch name cannot carry, at parse time", async () => {
    for (const runId of ["a/b c", "../x", ".x", "r 1", ""]) {
      const root = await workspace([entry(1)]);
      const run = await orchestrate(root, ["schedule", "waves", "--waves", DECLARATION, "--run-id", runId, "--existing-paths", "existing.json"]);
      expectRefusedAtParse(root, run, "--run-id");
    }
  });

  it("FR-NODE-216 AC-11 accepts a run id of letters, digits, dot, underscore and dash", async () => {
    const root = await workspace([entry(1)]);
    const run = await orchestrate(root, ["schedule", "waves", "--waves", DECLARATION, "--run-id", "Run_2.a-1", "--existing-paths", "existing.json"]);
    expect(run.exit, JSON.stringify(run.payload)).toBe(0);
  });
});

describe("FR-NODE-216 AC-2 nothing ready writes nothing", () => {
  it("FR-NODE-216 AC-2 reports the deferred and complete entries and writes no lock when no entry is ready", async () => {
    const root = await workspace([entry(1, { depends_on: [] })], [completeLine(1)]);
    const run = await schedule(root);
    expect(run.exit, JSON.stringify(run.payload)).toBe(0);
    expect(run.payload.lock).toBeNull();
    expect(run.payload.complete).toEqual(["wave-1"]);
    expect(run.payload.deferred).toEqual([]);
    expect(existsSync(path.join(root, LOCK)), "nothing ready writes no lock").toBe(false);
  });
});

describe("FR-NODE-216 AC-6 the strict-grounding line and the tracked paths", () => {
  it("FR-NODE-216 AC-6 journals --strict-grounding under the --engine it was given", async () => {
    const root = await workspace([entry(1)]);
    await schedule(root, ["--strict-grounding", "--engine", "kiwi-wave-master"]);
    const journal = (await readFile(path.join(root, "kiwi/waves.jsonl"), "utf8")).trim().split("\n");
    expect(JSON.parse(journal.at(-1) as string)).toMatchObject({ verb: "freeze-lane-plan", engine: "kiwi-wave-master" });
  });

  it("FR-NODE-216 AC-6 reads the whole tree at HEAD, repository-relative, when --root is a subdirectory", async () => {
    const top = await sdsWorkspace([]);
    const root = path.join(top, "ws");
    await writeUnder(root, DECLARATION, JSON.stringify({ schema_version: "1.0.0", waves: [entry(1, { files: ["src/ab.ts"] })] }));
    for (const name of ["docs/spec/00.index.md", "docs/spec/10.product-architecture.srs.md", "docs/spec/90.appendix.md"]) {
      await writeUnder(root, name, await readFile(path.join(top, name), "utf8"));
    }
    await writeUnder(top, "src/abc.ts", "export {};\n");
    const git = (...args: string[]) => execFileSync("git", ["-C", top, ...args], { stdio: "pipe" });
    git("init", "-q");
    git("add", "src/abc.ts");
    git("-c", "user.email=t@example.com", "-c", "user.name=t", "commit", "-q", "-m", "seed");
    const run = await orchestrate(root, ["schedule", "waves", "--waves", DECLARATION, "--run-id", RUN]);
    expect(run.exit, JSON.stringify(run.payload)).toBe(2);
    expect(run.payload.gate).toBe("files-not-grounded");
  });
});

describe("FR-NODE-216 AC-4 an entry with no declared files sits alone", () => {
  it("FR-NODE-216 AC-4 gives it its own stage, an empty write set, an undeclared-write-set conflict and a warning", async () => {
    const root = await workspace([entry(1, { depends_on: [] }), entry(2, { depends_on: [], files: [] }), entry(3, { depends_on: [] })]);
    const run = await schedule(root);
    expect(run.exit, JSON.stringify(run.payload)).toBe(0);
    const { body } = await lock(root);
    const lanes = body.lanes as LockLane[];
    const lonely = lanes.find((lane) => lane.wave === `${RUN}-wave-2`) as LockLane;
    expect(lonely.writeSet).toEqual([]);
    expect(lanes.filter((lane) => lane.stage === lonely.stage)).toHaveLength(1);
    const isolation = (body.conflicts as Array<{ a: string; b: string; reason: string }>).filter((edge) => edge.reason === "undeclared-write-set");
    expect(isolation.map((edge) => [edge.a, edge.b])).toEqual([
      [`${RUN}-wave-1`, `${RUN}-wave-2`],
      [`${RUN}-wave-2`, `${RUN}-wave-3`]
    ]);
    const diagnostics = run.payload.diagnostics as Array<{ code: string; severity: string; wave: string }>;
    expect(diagnostics).toEqual([expect.objectContaining({ code: "undeclared-write-set", severity: "warning", wave: "wave-2" })]);
  });
});

describe("FR-NODE-216 AC-5 an entry that names SDS files", () => {
  it("FR-NODE-216 AC-5 writes files ∪ the SDS write set and records the SDS digest", async () => {
    const root = await workspace([entry(1, { sds: [sdsPath("r1-wave-1")] })]);
    const sds = liteSdsText({ id: "r1-wave-1", files: ["src/s.ts"], testFiles: ["test/s.test.ts"] });
    await writeUnder(root, sdsPath("r1-wave-1"), sds);
    const run = await schedule(root);
    expect(run.exit, JSON.stringify(run.payload)).toBe(0);
    const { body } = await lock(root);
    expect((body.lanes as LockLane[])[0]).toMatchObject({ sds: sdsPath("r1-wave-1"), writeSet: ["src/s.ts", "src/w1.ts", "test/s.test.ts"] });
    expect(body.sds_digests).toEqual({ [`${RUN}-wave-1`]: createHash("sha256").update(sds).digest("hex") });
    const frozen = freezeLock("lanes", body, { runId: RUN, gitBlobOid: "0".repeat(40), writtenAt: "2026-10-20T00:00:00.000Z", declaredInputs: {} });
    expect(frozen.ok, JSON.stringify(frozen)).toBe(true);
  });

  it("FR-NODE-216 AC-5 refuses an SDS file that fails speckiwi sds check", async () => {
    const root = await workspace([entry(1, { sds: [sdsPath("broken")] })]);
    await writeUnder(root, sdsPath("broken"), "# SDS\n\nno metadata table here\n");
    expectRefusedAtParse(root, await schedule(root), "broken");
  });
});

describe("FR-NODE-216 AC-6 files[] paths are grounded", () => {
  it("FR-NODE-216 AC-6 refuses a near-miss of an existing path with files-not-grounded", async () => {
    const root = await workspace([entry(1, { files: ["src/ab.ts"] })]);
    await writeFile(path.join(root, "existing.json"), JSON.stringify(["src/abc.ts"]));
    const run = await schedule(root);
    expect(run.exit).toBe(2);
    expect(run.payload.gate).toBe("files-not-grounded");
    expect(existsSync(path.join(root, LOCK))).toBe(false);
  });

  it("FR-NODE-216 AC-6 reads the paths tracked at HEAD when --existing-paths is absent", async () => {
    const root = await workspace([entry(1, { files: ["src/ab.ts"] })]);
    await writeUnder(root, "src/abc.ts", "export {};\n");
    const git = (...args: string[]) => execFileSync("git", ["-C", root, ...args], { stdio: "pipe" });
    git("init", "-q");
    git("add", "src/abc.ts");
    git("-c", "user.email=t@example.com", "-c", "user.name=t", "commit", "-q", "-m", "seed");
    const run = await orchestrate(root, ["schedule", "waves", "--waves", DECLARATION, "--run-id", RUN]);
    expect(run.exit, JSON.stringify(run.payload)).toBe(2);
    expect(run.payload.gate).toBe("files-not-grounded");
  });

  it("FR-NODE-216 AC-6 journals --strict-grounding", async () => {
    const root = await workspace([entry(1)]);
    const run = await schedule(root, ["--strict-grounding"]);
    expect(run.payload.gate).toBe("files-not-grounded");
    const journal = (await readFile(path.join(root, "kiwi/waves.jsonl"), "utf8")).trim().split("\n");
    expect(JSON.parse(journal.at(-1) as string)).toMatchObject({ verb: "freeze-lane-plan", strict_grounding: true, run_id: RUN });
  });
});

describe("FR-NODE-216 AC-7 the lock records one declaration-entry digest per planned wave", () => {
  it("FR-NODE-216 AC-7 digests {wave, depends_on, files, sds} of each planned entry and leaves requirements out", async () => {
    const root = await workspace([entry(1, { depends_on: [] })]);
    expect((await schedule(root)).exit).toBe(0);
    const expected = createHash("sha256").update(canonicalJson({ wave: "wave-1", depends_on: [], files: ["src/w1.ts"] })).digest("hex");
    const { body } = await lock(root);
    expect(body.declaration_digests).toEqual({ [`${RUN}-wave-1`]: expected });
    expect(body.declaration).toBe(DECLARATION);

    await writeUnder(root, DECLARATION, JSON.stringify({ schema_version: "1.0.0", waves: [entry(1, { depends_on: [], requirements: ["FR-ARCH-001", "FR-ARCH-001"] })] }));
    expect((await schedule(root, ["--out", "again.json"])).exit).toBe(0);
    expect((await lock(root, "again.json")).body.declaration_digests).toEqual(body.declaration_digests);
  });
});

describe("FR-NODE-216 AC-8 --waves excludes --sds and --depends", () => {
  it("FR-NODE-216 AC-8 refuses --waves with --sds and --waves with --depends at parse time", async () => {
    const root = await workspace([entry(1)]);
    expectRefusedAtParse(root, await schedule(root, ["--sds", sdsPath("x")]), "--sds");
    expectRefusedAtParse(root, await schedule(root, ["--depends", "{}"]), "--depends");
  });

  it("FR-NODE-216 AC-8 requires --run-id with --waves and still requires --depends with --sds", async () => {
    const root = await workspace([entry(1)]);
    expectRefusedAtParse(root, await orchestrate(root, ["schedule", "waves", "--waves", DECLARATION, "--existing-paths", "existing.json"]), "--run-id");
    expectRefusedAtParse(root, await orchestrate(root, ["schedule", "waves", "--sds", sdsPath("x")]), "--depends");
    expectRefusedAtParse(root, await orchestrate(root, ["schedule", "waves"]), "--waves");
  });

  it("FR-NODE-216 AC-8 the MCP binding no longer requires sds and carries waves", () => {
    const binding = ORCHESTRATE_TOOL_BINDINGS.find((candidate) => candidate.tool === "orchestrate_schedule_waves");
    const option = (dest: string) => binding?.options.find((candidate) => candidate.dest === dest);
    expect(option("sds")?.required).toBeUndefined();
    expect(option("depends")?.required).toBeUndefined();
    expect(option("waves")).toEqual({ flag: "--waves", dest: "waves", encoding: "string" });
    expect(option("engine")).toEqual({ flag: "--engine", dest: "engine", encoding: "string" });
  });
});

describe("FR-NODE-216 AC-9 the output is byte-deterministic", () => {
  it("FR-NODE-216 AC-9 writes identical bytes for the same declaration, journal, lanes and paths", async () => {
    const root = await workspace([entry(2, { depends_on: [] }), entry(1, { depends_on: [], files: [] })]);
    await schedule(root, ["--out", "first.json"]);
    await schedule(root, ["--out", "second.json"]);
    expect((await lock(root, "second.json")).text).toBe((await lock(root, "first.json")).text);
  });
});

describe("FR-NODE-216 AC-10 a planned entry whose requirement is not ready is refused before any lock", () => {
  async function withRequirement(id: string, stability: string, status: string): Promise<string> {
    const root = await workspace([entry(1, { requirements: ["FR-ARCH-001", id] })]);
    const scope = path.join(root, "docs/spec/10.product-architecture.srs.md");
    const text = await readFile(scope, "utf8");
    const start = text.indexOf("### FR-ARCH-001");
    const end = text.indexOf("| 2026-05-08 | Created | Fixture |") + "| 2026-05-08 | Created | Fixture |".length;
    const block = text
      .slice(start, end)
      .replaceAll("FR-ARCH-001", id)
      .replace("| Stability | stable |", `| Stability | ${stability} |`)
      .replace("| Status | planned |", `| Status | ${status} |`);
    await writeFile(scope, `${text.slice(0, end)}\n\n${block}${text.slice(end)}`);
    return root;
  }

  it("FR-NODE-216 AC-10 refuses a requirement that does not exist", async () => {
    const root = await workspace([entry(1, { requirements: ["FR-ARCH-404"] })]);
    const run = await schedule(root);
    expect(run.exit).toBe(2);
    expect(run.payload.gate).toBe("requirement-not-ready");
    expect(JSON.stringify(run.payload.violations)).toContain("FR-ARCH-404");
    expect(JSON.stringify(run.payload.violations)).toContain("wave-1");
    expect(existsSync(path.join(root, LOCK))).toBe(false);
  });

  for (const [label, stability, status] of [
    ["Stability draft", "draft", "planned"],
    ["Stability deprecated", "deprecated", "planned"],
    ["Status discarded", "stable", "discarded"]
  ] as const) {
    it(`FR-NODE-216 AC-10 refuses a requirement whose ${label}`, async () => {
      const root = await withRequirement("FR-ARCH-002", stability, status);
      const run = await schedule(root);
      expect(run.exit, JSON.stringify(run.payload)).toBe(2);
      expect(run.payload.gate).toBe("requirement-not-ready");
      expect(JSON.stringify(run.payload.violations)).toContain("FR-ARCH-002");
      expect(existsSync(path.join(root, LOCK))).toBe(false);
    });
  }

  it("FR-NODE-216 AC-10 plans a ready control requirement", async () => {
    const root = await withRequirement("FR-ARCH-002", "evolving", "planned");
    const run = await schedule(root);
    expect(run.exit, JSON.stringify(run.payload)).toBe(0);
  });
});

describe("FR-NODE-216 AC-11 the lock's wave id is the unit id", () => {
  it("FR-NODE-216 AC-11 names wave-<n> {run_id}-wave-{n} and its lane lane-{run_id}-wave-{n}", async () => {
    const root = await workspace([entry(7)]);
    expect((await schedule(root)).exit).toBe(0);
    expect((await lock(root)).body.lanes).toEqual([
      { laneId: `lane-${RUN}-wave-7`, stage: 1, wave: `${RUN}-wave-7`, sds: null, writeSet: ["src/w7.ts"] }
    ]);
  });
});
