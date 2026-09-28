import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { main } from "../../src/cli/index.js";
import { sdsPath, sdsWorkspace } from "../core/orchestrator/sds-fixtures.js";

const runProcess = promisify(execFile);
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const CLI = path.join(REPO_ROOT, "bin", "speckiwi");

// @req IR-CLI-097 — `orchestrate preflight --lane-plan` reads the document `orchestrate schedule
// waves` writes. The two ends once disagreed on shape, so the skill's worktree procedure could never
// get past its own step 2.

function io() {
  return { stdout: new PassThrough(), stderr: new PassThrough() };
}

function drain(stream: PassThrough): string {
  return stream.read()?.toString() ?? "";
}

async function tempRoot(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), "speckiwi-lane-plan-shape-"));
}

async function write(root: string, relativePath: string, text: string): Promise<void> {
  const absolute = path.join(root, relativePath);
  await mkdir(path.dirname(absolute), { recursive: true });
  await writeFile(absolute, text, "utf8");
}

interface Run {
  readonly exit: number;
  readonly text: string;
  readonly payload: Record<string, unknown>;
}

/**
 * Runs the preflight in the lane role, which is the only role that reads a lane plan. The roots are
 * deliberately bogus: the topology verdict is not what this file tests, and a lane-plan parse
 * failure happens strictly before it. What each case asserts is which failure came out.
 */
async function preflight(root: string, planPath: string, laneId = "lane-1"): Promise<Run> {
  const pipes = io();
  const exit = await main(
    [
      "--root", root, "orchestrate", "preflight",
      "--mcp-root", root, "--git-root", root,
      "--role", "lane", "--lane-id", laneId, "--lane-plan", planPath,
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

/** True when the run died inside the lane-plan reader rather than anywhere downstream. */
function refusedAsMalformedPlan(run: Run): boolean {
  return run.text.includes("is not a lane plan");
}

const LANE_PLAN = {
  lane_cap: 4,
  depends: { "wave-2": [] },
  sds_digests: { "wave-1": "sha-1", "wave-2": "sha-2" },
  lane_count: 2,
  stage_count: 1,
  lanes: [
    { laneId: "lane-1", stage: 1, wave: "wave-1", sds: "docs/sds/wave-1.sds.md", writeSet: ["src/a.ts"] },
    { laneId: "lane-2", stage: 1, wave: "wave-2", sds: "docs/sds/wave-2.sds.md", writeSet: ["src/b.ts"] }
  ],
  stages: [{ index: 1, laneIds: ["lane-1", "lane-2"] }],
  conflicts: []
};

const LEGACY_MAP = { "lane-1": { writeSet: ["src/a.ts"] }, "lane-2": { writeSet: ["src/b.ts"] } };

describe("IR-CLI-097 the lane plan the scheduler writes is the lane plan preflight reads", () => {
  it("AC-1 accepts a lane plan document and takes each lane's id and write set from lanes[]", async () => {
    const root = await tempRoot();
    await write(root, "waves/wave-1/lanes.lock.json", JSON.stringify(LANE_PLAN, null, 2));

    const run = await preflight(root, "waves/wave-1/lanes.lock.json");

    expect(refusedAsMalformedPlan(run), run.text).toBe(false);
  });

  it("AC-2 still accepts the legacy lane-id map", async () => {
    const root = await tempRoot();
    await write(root, "legacy.json", JSON.stringify(LEGACY_MAP, null, 2));

    const run = await preflight(root, "legacy.json");

    expect(refusedAsMalformedPlan(run), run.text).toBe(false);
  });

  it("AC-3 refuses a document that is neither shape, naming what it accepts", async () => {
    const root = await tempRoot();
    await write(root, "neither.json", JSON.stringify({ lanes: "not-an-array", other: 1 }));

    const run = await preflight(root, "neither.json");

    expect(refusedAsMalformedPlan(run), run.text).toBe(true);
    // Both accepted shapes must be named. Matching the "is not a lane plan" prefix alone would pass
    // against the reader that has only ever known one shape, which is what this criterion is about.
    expect(run.text, "the refusal must name the lanes-array shape").toMatch(/lanes/);
    expect(run.text, "the refusal must name the lane-id map shape too").toMatch(/map of lane ids|lane id map/i);
    expect(run.text, "the reader must not report the `lanes` key as a malformed lane").not.toContain("lanes.writeSet");
  });

  it("AC-4 refuses a lane whose write set holds a non-string and names that lane's id", async () => {
    const root = await tempRoot();
    const broken = { ...LANE_PLAN, lanes: [{ ...LANE_PLAN.lanes[0], writeSet: ["src/a.ts", 7] }] };
    await write(root, "broken.json", JSON.stringify(broken));

    const run = await preflight(root, "broken.json");

    expect(refusedAsMalformedPlan(run), run.text).toBe(true);
    // The lane's own id, not its index in the array — an index is unusable in a plan of eight lanes.
    expect(run.text).toContain("lane-1");
    expect(run.text).not.toMatch(/\b0\.writeSet\b/);
  });

  it("IR-CLI-097 AC-5 hands the scheduler's own output straight to the gate", async () => {
    const root = await sdsWorkspace([
      { id: "run-wave-1", files: ["src/shared.ts"] },
      { id: "run-wave-2", files: ["src/other.ts"] }
    ]);

    const pipes = io();
    const planExit = await main(
      [
        "--root", root, "orchestrate", "schedule", "waves",
        "--sds", sdsPath("run-wave-1"), sdsPath("run-wave-2"), "--depends", JSON.stringify({ "run-wave-2": [] }),
        "--out", "waves/stage-1/lanes.lock.json", "--json"
      ],
      pipes
    );
    const planPayload = JSON.parse(drain(pipes.stdout)) as { lock?: { lanes?: Array<{ laneId: string }> } };
    expect(planExit, JSON.stringify(planPayload)).toBe(0);
    const laneId = planPayload.lock?.lanes?.[0]?.laneId;
    expect(laneId, "a lane must exist for the gate to look one up").toBeTruthy();

    // What the scheduler wrote, unedited, is what the gate now receives.
    const written = await readFile(path.join(root, "waves/stage-1/lanes.lock.json"), "utf8");
    expect(JSON.parse(written)).toHaveProperty("lanes");

    const run = await preflight(root, "waves/stage-1/lanes.lock.json", laneId as string);

    expect(refusedAsMalformedPlan(run), run.text).toBe(false);
  });

  it("AC-6 accepts a lane plan with no lanes rather than refusing it", async () => {
    const root = await tempRoot();
    const empty = { ...LANE_PLAN, lanes: [], stages: [], lane_count: 0, stage_count: 0, sds_digests: {} };
    await write(root, "empty.json", JSON.stringify(empty));

    const run = await preflight(root, "empty.json");

    expect(refusedAsMalformedPlan(run), run.text).toBe(false);
  });
});

/**
 * AC-1's other half. Everything above proves the reader did not refuse; none of it proves the ids and
 * write sets it produced are the ones the gate then decides on, because a same-root request is
 * refused on topology before any lane is looked up. Two mutations survived the whole suite on that
 * gap — keying the plan by array index, and dropping the write set after validating it — and the
 * second silently reopens the boundary that stops a lane writing to `docs/spec/`. These cases run
 * the real CLI against a real linked worktree so both die.
 */
describe("IR-CLI-097 AC-1 the ids and write sets a lane plan carries are what the gate decides on", () => {
  let scratch = "";
  let host = "";
  let lane = "";
  let planPath = "";

  async function git(cwd: string, ...args: string[]): Promise<void> {
    await runProcess("git", ["-C", cwd, ...args]);
  }

  async function preflightLane(laneId: string): Promise<{ code: number; json: Record<string, unknown> }> {
    try {
      const { stdout } = await runProcess(
        "node",
        [CLI, "orchestrate", "preflight", "--json", "--mcp-root", host, "--git-root", lane, "--role", "lane", "--lane-id", laneId, "--lane-plan", planPath],
        { encoding: "utf8", maxBuffer: 4 * 1024 * 1024 }
      );
      return { code: 0, json: JSON.parse(stdout) as Record<string, unknown> };
    } catch (error) {
      const failure = error as { code?: number; stdout?: string; stderr?: string };
      let json: Record<string, unknown> = {};
      try {
        json = JSON.parse(failure.stdout ?? "{}") as Record<string, unknown>;
      } catch {
        json = { raw: `${failure.stdout ?? ""}${failure.stderr ?? ""}` };
      }
      return { code: typeof failure.code === "number" ? failure.code : 1, json };
    }
  }

  function reasonOf(json: Record<string, unknown>): unknown {
    const violations = (json.violations ?? []) as Array<{ reason?: unknown }>;
    return violations[0]?.reason;
  }

  beforeAll(async () => {
    scratch = await mkdtemp(path.join(tmpdir(), "lane-plan-shape-wt-"));
    host = path.join(scratch, "host");
    lane = path.join(scratch, "lane");
    await runProcess("git", ["init", "-q", host]);
    await git(host, "config", "user.email", "t@t");
    await git(host, "config", "user.name", "t");
    await writeFile(path.join(host, "a.txt"), "x\n", "utf8");
    await git(host, "add", "-A");
    await git(host, "commit", "-qm", "base");
    await git(host, "worktree", "add", "-q", lane, "-b", "kiwi/orch/r1/lane-1");

    // The ARRAY shape, which is what the scheduler writes. The existing role fixture uses the legacy
    // map, so before this the array branch never reached the gate at all.
    planPath = path.join(scratch, "lanes.lock.json");
    await writeFile(
      planPath,
      JSON.stringify({
        lanes: [
          { laneId: "lane-1", stage: 1, wave: "wave-1", sds: "docs/sds/wave-1.sds.md", writeSet: ["src/a.ts"] },
          { laneId: "lane-srs", stage: 1, wave: "srs", sds: "docs/sds/srs.sds.md", writeSet: ["docs/spec/50.x.srs.md"] }
        ],
        stages: [{ index: 1, laneIds: ["lane-1", "lane-srs"] }],
        lane_count: 2,
        stage_count: 1
      }),
      "utf8"
    );
  }, 120_000);

  afterAll(async () => {
    await runProcess("git", ["-C", host, "worktree", "remove", "--force", lane]).catch(() => undefined);
  });

  it("admits the lane the plan names, so the ids survive the read", async () => {
    const admitted = await preflightLane("lane-1");

    expect(admitted.code, JSON.stringify(admitted.json)).toBe(0);
    expect(admitted.json).toMatchObject({ ok: true, topology: "linked-worktree" });
  });

  it("refuses a lane id the plan does not carry, rather than admitting on position", async () => {
    // Keying the plan by array index would make every real id absent and this the verdict for all of
    // them; the case above is what separates "refuses correctly" from "refuses everything".
    const absent = await preflightLane("nope");

    expect(absent.code).not.toBe(0);
    expect(reasonOf(absent.json)).toBe("lane-id-not-in-plan");
  });

  it("refuses a lane whose write set reaches the requirements, so the write set survives the read", async () => {
    const touchesSrs = await preflightLane("lane-srs");

    expect(touchesSrs.code, JSON.stringify(touchesSrs.json)).not.toBe(0);
    expect(reasonOf(touchesSrs.json)).toBe("lane-write-set-touches-srs");
  });

  it("FR-NODE-213 AC-4 admits a wave's worker by the lane id a lock from schedule waves carries, reading its write set", async () => {
    const sdsRoot = await sdsWorkspace([
      { id: "r1-wave-1", files: ["src/a.ts"] },
      { id: "r1-wave-2", files: ["docs/spec/50.x.srs.md"] }
    ]);
    const pipes = io();
    const exit = await main(
      ["--root", sdsRoot, "orchestrate", "schedule", "waves", "--sds", sdsPath("r1-wave-1"), sdsPath("r1-wave-2"), "--depends", "{}", "--out", "lock.json", "--json"],
      pipes
    );
    expect(exit, drain(pipes.stdout)).toBe(0);
    const scheduled = path.join(scratch, "scheduled.lock.json");
    await writeFile(scheduled, await readFile(path.join(sdsRoot, "lock.json"), "utf8"), "utf8");

    const admit = async (laneId: string) => {
      const out = io();
      const code = await main(
        ["orchestrate", "preflight", "--json", "--mcp-root", host, "--git-root", lane, "--role", "lane", "--lane-id", laneId, "--lane-plan", scheduled],
        out
      );
      return { code, json: JSON.parse(drain(out.stdout)) as Record<string, unknown> };
    };

    const admitted = await admit("lane-r1-wave-1");
    expect(admitted.code, JSON.stringify(admitted.json)).toBe(0);
    const refused = await admit("lane-r1-wave-2");
    expect(refused.code).not.toBe(0);
    expect(reasonOf(refused.json)).toBe("lane-write-set-touches-srs");
  });
});
