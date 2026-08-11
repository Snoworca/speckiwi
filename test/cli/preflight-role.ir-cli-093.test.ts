import { execFile } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const run = promisify(execFile);
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const CLI = path.join(REPO_ROOT, "bin", "speckiwi");

// @req IR-CLI-093
//
// The topology kernel decided nothing because nothing called it — a census of src/ returned zero
// callers outside its own module. A pure module with unit tests proves a function computes; it cannot
// prove a gate exists. Every case here goes through the CLI against REAL git worktrees, so a kernel
// that stops being wired makes these fail even while its unit tests stay green.

interface Cli {
  code: number;
  json: Record<string, unknown>;
}

async function preflight(args: string[]): Promise<Cli> {
  try {
    const { stdout } = await run("node", [CLI, "orchestrate", "preflight", "--json", ...args], {
      encoding: "utf8",
      maxBuffer: 4 * 1024 * 1024
    });
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

async function git(cwd: string, ...args: string[]): Promise<string> {
  const { stdout } = await run("git", ["-C", cwd, ...args], { encoding: "utf8" });
  return stdout.trim();
}

let scratch = "";
let host = "";
let lane = "";
let foreign = "";
let planPath = "";

beforeAll(async () => {
  scratch = await mkdtemp(path.join(tmpdir(), "preflight-role-"));
  host = path.join(scratch, "host");
  lane = path.join(scratch, "lane");
  foreign = path.join(scratch, "foreign");

  for (const [dir, file] of [
    [host, "a.txt"],
    [foreign, "a.txt"]
  ] as const) {
    await run("git", ["init", "-q", dir]);
    await git(dir, "config", "user.email", "t@t");
    await git(dir, "config", "user.name", "t");
    await writeFile(path.join(dir, file), "x\n", "utf8");
    await git(dir, "add", "-A");
    await git(dir, "commit", "-qm", "base");
  }
  // A real linked worktree of `host`, registered in host's common dir.
  await git(host, "worktree", "add", "-q", lane, "-b", "kiwi/orch/r1/lane-1");

  planPath = path.join(scratch, "lanes.lock.json");
  await writeFile(
    planPath,
    JSON.stringify({ "lane-1": { writeSet: ["src/a.ts"] }, "lane-srs": { writeSet: ["docs/spec/50.x.srs.md"] } }),
    "utf8"
  );
}, 120_000);

afterAll(async () => {
  await run("git", ["-C", host, "worktree", "remove", "--force", lane]).catch(() => undefined);
});

describe("IR-CLI-093 — the declared role reaches the topology gate", () => {
  it("AC-1: no --role keeps the existing host comparison", async () => {
    const ok = await preflight(["--mcp-root", host, "--git-root", host]);
    expect(ok.code).toBe(0);
    expect(ok.json).toMatchObject({ ok: true });
    expect(ok.json).toHaveProperty("comparison");

    const bad = await preflight(["--mcp-root", host, "--git-root", foreign]);
    expect(bad.code).toBe(2);
    expect(bad.json).toMatchObject({ gate: "run-root-preflight-mismatch" });
  });

  it("AC-2: --role lane requires both --lane-id and --lane-plan", async () => {
    const noId = await preflight(["--mcp-root", host, "--git-root", lane, "--role", "lane", "--lane-plan", planPath]);
    expect(noId.code).not.toBe(0);
    const noPlan = await preflight(["--mcp-root", host, "--git-root", lane, "--role", "lane", "--lane-id", "lane-1"]);
    expect(noPlan.code).not.toBe(0);
  });

  it("AC-3: a planned lane in a registered worktree passes — the case the equality gate refuses", async () => {
    // Same arguments under the default role are a hard refusal; that contrast is the point.
    const asHost = await preflight(["--mcp-root", host, "--git-root", lane]);
    expect(asHost.code).toBe(2);

    const asLane = await preflight([
      "--mcp-root", host, "--git-root", lane, "--role", "lane", "--lane-id", "lane-1", "--lane-plan", planPath
    ]);
    expect(asLane.code).toBe(0);
    expect(asLane.json).toMatchObject({ ok: true, topology: "linked-worktree" });
  });

  it("AC-4: a lane pointed at the host root is refused", async () => {
    const result = await preflight([
      "--mcp-root", host, "--git-root", host, "--role", "lane", "--lane-id", "lane-1", "--lane-plan", planPath
    ]);
    expect(result.code).toBe(2);
    expect(JSON.stringify(result.json)).toContain("lane-root-is-host-root");
  });

  it("AC-5: a lane pointed at an unrelated repository is refused", async () => {
    const result = await preflight([
      "--mcp-root", host, "--git-root", foreign, "--role", "lane", "--lane-id", "lane-1", "--lane-plan", planPath
    ]);
    expect(result.code).toBe(2);
    expect(JSON.stringify(result.json)).toContain("lane-root-foreign-repo");
  });

  it("AC-6: a registered worktree whose lane is not in the plan is still refused", async () => {
    const result = await preflight([
      "--mcp-root", host, "--git-root", lane, "--role", "lane", "--lane-id", "lane-99", "--lane-plan", planPath
    ]);
    expect(result.code).toBe(2);
    expect(JSON.stringify(result.json)).toContain("lane-id-not-in-plan");
  });

  it("AC-6: a lane whose write set touches docs/spec/ is refused", async () => {
    const result = await preflight([
      "--mcp-root", host, "--git-root", lane, "--role", "lane", "--lane-id", "lane-srs", "--lane-plan", planPath
    ]);
    expect(result.code).toBe(2);
    expect(JSON.stringify(result.json)).toContain("lane-write-set-touches-srs");
  });

  it("AC-7: a host root that is itself a linked worktree is refused, where equality passes", async () => {
    const result = await preflight(["--mcp-root", lane, "--git-root", lane, "--role", "host"]);
    expect(result.code).toBe(2);
    expect(JSON.stringify(result.json)).toContain("host-root-is-a-linked-worktree");
  });

  it("AC-9: a refusal reports both the topology and the reason", async () => {
    const result = await preflight([
      "--mcp-root", host, "--git-root", foreign, "--role", "lane", "--lane-id", "lane-1", "--lane-plan", planPath
    ]);
    const text = JSON.stringify(result.json);
    expect(text).toContain("foreign-repo");
    expect(text).toContain("lane-root-foreign-repo");
  });
});
