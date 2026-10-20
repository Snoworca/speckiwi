import { execFile, spawn, type ChildProcess } from "node:child_process";
import { cp, mkdir, readFile, stat, utimes, writeFile } from "node:fs/promises";
import { hostname } from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createMcpServer } from "../../src/mcp/server.js";
import { runLockReport } from "../../src/cli/commands/orchestrate.js";
import { probeRunLockFence, resolveGitCommonDir, runLockFenceName, runLockPath } from "../../src/core/orchestrator/run-lock.js";
import { cleanupFixtures, commitAll, initRepo } from "../core/orchestrator/support/git-fixture.js";

/**
 * @req IR-CLI-105 — run lock refusals and `run status` name the lease and the fence state, offer the
 * release command only when no live session holds the fence, and the dry run agrees with the real
 * acquisition.
 */

const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..");
const CLI = path.join(REPO_ROOT, "bin", "speckiwi");
const SPEC_FIXTURE = path.join(REPO_ROOT, "test", "fixtures", "workspaces", "valid-basic", "docs", "spec");
const WIN32 = process.platform === "win32";
const FREE = WIN32 ? "free" : "not-applicable";
const DEAD_PID = 2_147_483_647;
const UNLOCK = "speckiwi orchestrate run unlock --json";

const COMPILED_MIRRORS: ReadonlyArray<readonly [string, string]> = [
  ["src/core/lock/exclusive-lock.ts", "dist/core/lock/exclusive-lock.js"],
  ["src/core/orchestrator/run-lock.ts", "dist/core/orchestrator/run-lock.js"],
  ["src/cli/commands/orchestrate.ts", "dist/cli/commands/orchestrate.js"]
];

const cleanups: Array<() => Promise<void>> = [];

beforeAll(async () => {
  for (const [source, compiled] of COMPILED_MIRRORS) {
    const sourceStat = await stat(path.join(REPO_ROOT, source));
    const compiledStat = await stat(path.join(REPO_ROOT, compiled)).catch(() => null);
    expect(compiledStat, `${compiled} is missing; run \`npm run build\``).not.toBeNull();
    expect((compiledStat as Awaited<ReturnType<typeof stat>>).mtimeMs, `${compiled} is older than ${source}; run \`npm run build\``)
      .toBeGreaterThanOrEqual(sourceStat.mtimeMs);
  }
});

afterAll(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup().catch(() => undefined);
  await cleanupFixtures();
});

async function repository(prefix: string): Promise<{ root: string; commonDir: string; lockPath: string }> {
  const root = await initRepo(prefix);
  await cp(SPEC_FIXTURE, path.join(root, "docs", "spec"), { recursive: true });
  await writeFile(path.join(root, "README.md"), "# fixture\n", "utf8");
  await commitAll(root, "test: seed");
  const commonDir = await resolveGitCommonDir(root);
  return { root, commonDir, lockPath: runLockPath(commonDir) };
}

interface Run {
  readonly exit: number;
  readonly payload: Record<string, unknown>;
}

function cli(root: string, args: readonly string[]): Promise<Run> {
  return new Promise((resolve) => {
    execFile("node", [CLI, "--root", root, "orchestrate", ...args, "--json"], { encoding: "utf8", windowsHide: true }, (error, stdout) => {
      let payload: Record<string, unknown> = {};
      try {
        payload = JSON.parse(stdout) as Record<string, unknown>;
      } catch {
        // The assertions name what was missing.
      }
      resolve({ exit: error ? ((error as { code?: number }).code ?? 1) : 0, payload });
    });
  });
}

function violationOf(payload: Record<string, unknown>): Record<string, unknown> {
  return ((payload.violations as unknown[]) ?? [])[0] as Record<string, unknown>;
}

async function sentinel(lockPath: string): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(lockPath, "utf8")) as Record<string, unknown>;
}

async function writeSentinel(lockPath: string, record: Record<string, unknown>): Promise<void> {
  await mkdir(path.dirname(lockPath), { recursive: true });
  await writeFile(lockPath, `${JSON.stringify({ version: 1, token: "hand-written", host: hostname(), owner: "kiwi-orchestrator", acquired_at: new Date().toISOString(), ...record })}\n`, "utf8");
}

function expectReleaseOffer(violation: Record<string, unknown>): void {
  const offer = violation.releaseIfAbandoned as Record<string, unknown> | undefined;
  expect(offer, JSON.stringify(violation)).toBeDefined();
  const text = JSON.stringify(offer);
  expect(text).toContain(UNLOCK);
  expect(text).toContain("orchestrate_run_lock");
  expect(text).toContain('action: \\"unlock\\"');
  expect(text, "the condition").toMatch(/only (if|when) the holding run has been abandoned/);
  expect(text, "the warning").toMatch(/two runs share the repository/);
  expect(text, "abort cannot be filled for a foreign lease").not.toMatch(/run abort|--run-id/);
}

/** A process that listens on the run lock's fence name and holds no sentinel: the ghost before 4.1.0. */
async function ghostFence(commonDir: string): Promise<ChildProcess> {
  const name = await runLockFenceName(commonDir);
  const child = spawn(process.execPath, ["-e", `require("net").createServer().listen(${JSON.stringify(name)}, () => process.stdout.write("ready\\n"))`], {
    stdio: ["ignore", "pipe", "inherit"],
    windowsHide: true
  });
  cleanups.push(async () => { child.kill(); });
  await new Promise<void>((resolve, reject) => {
    child.stdout?.once("data", () => resolve());
    child.once("exit", (code) => reject(new Error(`the fence helper exited (${code})`)));
  });
  return child;
}

async function mcpHolder(root: string): Promise<Client> {
  const transport = new StdioClientTransport({ command: process.execPath, args: [CLI, "mcp"], cwd: root, stderr: "pipe" });
  const client = new Client({ name: "ir-cli-105", version: "1.0.0" }, { capabilities: {} });
  await client.connect(transport);
  cleanups.push(async () => client.close());
  const result = await client.callTool({ name: "orchestrate_run_lock", arguments: { action: "lock" } });
  const payload = JSON.parse(((result.content as Array<{ text?: string }>)[0]?.text) ?? "{}") as Record<string, unknown>;
  expect(payload.exitCode, JSON.stringify(payload)).toBe(0);
  return client;
}

describe("IR-CLI-105 refusals name the lease, the fence and the right release step", { timeout: 120_000 }, () => {
  it("IR-CLI-105 AC-1 a lease left by an exited process is refused with its holder, expiry and fence", async () => {
    const { root, lockPath } = await repository("ir-cli-105-ac1-");
    expect((await cli(root, ["run", "lock"])).exit).toBe(0);
    const lease = await sentinel(lockPath);

    const refused = await cli(root, ["run", "lock"]);
    expect(refused.exit).toBe(2);
    expect(refused.payload.gate).toBe("orchestrator-run-lock-held");
    expect(violationOf(refused.payload)).toMatchObject({
      owner: lease.owner,
      pid: lease.pid,
      host: lease.host,
      acquiredAt: lease.acquired_at,
      leaseExpiresAt: lease.lease_expires_at,
      fence: FREE,
      lockPath
    });
  });

  it("IR-CLI-105 AC-2 in that state the refusal offers run unlock, conditionally and with its warning, and never abort", async () => {
    const { root } = await repository("ir-cli-105-ac2-");
    expect((await cli(root, ["run", "lock"])).exit).toBe(0);
    const violation = violationOf((await cli(root, ["run", "lock"])).payload);
    // The offer says no live process holds the fence, which only a win32 fence can establish.
    if (WIN32) expectReleaseOffer(violation);
    else expect(violation.releaseIfAbandoned).toBeUndefined();
  });

  it("IR-CLI-105 AC-2 with no fence to ask (POSIX) the refusal makes no release offer and says why", () => {
    const state = {
      lockPath: "/repo/.git/speckiwi/orchestrator-run.lock",
      present: true,
      holder: { owner: "kiwi-orchestrator", pid: 4242, host: "h", acquiredAt: "2026-10-21T00:00:00.000Z" },
      leaseExpiresAt: "2026-10-21T12:00:00.000Z",
      holderUnreadable: false,
      reclaimable: false,
      fence: "not-applicable" as const,
      heldByThisProcess: false
    };
    const report = runLockReport(state);
    expect(report.releaseIfAbandoned).toBeUndefined();
    expect(String(report.guidance)).toMatch(/no fence/);
    expect(String(report.guidance)).toContain("speckiwi orchestrate run unlock --json");
    expect(String(report.guidance)).toMatch(/two runs share the repository/);
    expect(runLockReport({ ...state, fence: "free" }).releaseIfAbandoned).toBeDefined();
  });

  it.runIf(WIN32)("IR-CLI-105 AC-3 a live MCP holder: fence held, the holder's fields, no release offer, the session releases it", async () => {
    const { root, lockPath } = await repository("ir-cli-105-ac3-");
    await mcpHolder(root);
    const lease = await sentinel(lockPath);
    const refused = await cli(root, ["run", "lock"]);
    expect(refused.exit).toBe(2);
    const violation = violationOf(refused.payload);
    expect(violation).toMatchObject({ fence: "held", pid: lease.pid, host: lease.host, acquiredAt: lease.acquired_at });
    expect(violation.releaseIfAbandoned).toBeUndefined();
    const guidance = String(violation.guidance);
    expect(guidance).toContain("orchestrate_run_lock");
    expect(guidance).toContain("orchestrate_run_abort");
    expect(guidance).toMatch(/closed/);
  });

  it.runIf(WIN32)("IR-CLI-105 AC-4 a held fence with no sentinel: lock and status report fence held, null holder, and say an open session holds it", async () => {
    const { root, commonDir } = await repository("ir-cli-105-ac4-");
    await ghostFence(commonDir);
    expect(await probeRunLockFence(commonDir)).toBe("held");

    const refused = await cli(root, ["run", "lock"]);
    expect(refused.exit).toBe(2);
    const violation = violationOf(refused.payload);
    expect(violation).toMatchObject({ fence: "held", pid: null, host: null, acquiredAt: null, owner: null });
    expect(violation.releaseIfAbandoned).toBeUndefined();
    const status = await cli(root, ["run", "status"]);
    expect(status.payload).toMatchObject({ fence: "held", holder: null });
    for (const said of [String(violation.guidance), String(status.payload.guidance)]) {
      expect(said).toMatch(/more than a few seconds/);
      expect(said).toMatch(/open session holds the lock/);
      expect(said).toMatch(/release it from that session or close it/);
    }
  });

  it("IR-CLI-105 AC-5 a free fence and a torn sentinel inside its grace: holderUnreadable, null holder, and the release offer", async () => {
    const { root, lockPath } = await repository("ir-cli-105-ac5-");
    await mkdir(path.dirname(lockPath), { recursive: true });
    await writeFile(lockPath, "", "utf8");
    const refused = await cli(root, ["run", "lock"]);
    expect(refused.exit).toBe(2);
    const violation = violationOf(refused.payload);
    expect(violation).toMatchObject({ holderUnreadable: true, pid: null, host: null, acquiredAt: null, lockPath, fence: FREE });
    if (WIN32) expectReleaseOffer(violation);
    else expect(violation.releaseIfAbandoned).toBeUndefined();
  });

  it("IR-CLI-105 AC-6 the MCP orchestrate_run_lock refusal carries the same fields and values", async () => {
    const { root } = await repository("ir-cli-105-ac6-");
    expect((await cli(root, ["run", "lock"])).exit).toBe(0);
    const viaCli = violationOf((await cli(root, ["run", "lock"])).payload);
    const viaMcp = (await createMcpServer({ root }).callTool("orchestrate_run_lock", { action: "lock" })) as Record<string, unknown>;
    expect(viaMcp.exitCode).toBe(2);
    expect(viaCli).toMatchObject({ fence: FREE, pid: expect.any(Number), leaseExpiresAt: expect.any(String) });
    expect(violationOf(viaMcp)).toEqual(viaCli);
  });

  it("IR-CLI-105 AC-7 run status carries leaseExpiresAt and fence beside a four-key holder", async () => {
    const { root, lockPath } = await repository("ir-cli-105-ac7-");
    const empty = await cli(root, ["run", "status"]);
    expect(empty.payload).toMatchObject({ holder: null, leaseExpiresAt: null, fence: FREE });

    expect((await cli(root, ["run", "lock"])).exit).toBe(0);
    const lease = await sentinel(lockPath);
    const leased = await cli(root, ["run", "status"]);
    expect(Object.keys(leased.payload.holder as object).sort()).toEqual(["acquiredAt", "host", "owner", "pid"]);
    expect(leased.payload).toMatchObject({ leaseExpiresAt: lease.lease_expires_at, fence: FREE });

    await writeSentinel(lockPath, { pid: process.pid });
    expect((await cli(root, ["run", "status"])).payload.leaseExpiresAt).toBeNull();
  });
});

describe("IR-CLI-105 AC-8 the dry run gives the real acquisition's answer", { timeout: 120_000 }, () => {
  const cases: Array<[string, (lockPath: string) => Promise<void>, "free" | "refuse"]> = [
    ["an expired lease", (lockPath) => writeSentinel(lockPath, { pid: process.pid, lease_expires_at: new Date(Date.now() - 60_000).toISOString() }), "free"],
    ["a legacy sentinel naming a dead pid on this host", (lockPath) => writeSentinel(lockPath, { pid: DEAD_PID }), "free"],
    ["an unexpired lease with a dead pid", (lockPath) => writeSentinel(lockPath, { pid: DEAD_PID, lease_expires_at: new Date(Date.now() + 3_600_000).toISOString() }), "refuse"],
    ["a torn sentinel inside its grace", async (lockPath) => {
      await mkdir(path.dirname(lockPath), { recursive: true });
      await writeFile(lockPath, "", "utf8");
      const now = new Date();
      await utimes(lockPath, now, now);
    }, "refuse"]
  ];

  for (const [label, seed, expected] of cases) {
    it(`IR-CLI-105 AC-8 ${label}: dry run and real call both ${expected === "free" ? "acquire" : "refuse"}`, async () => {
      const { root, lockPath } = await repository("ir-cli-105-ac8-");
      await seed(lockPath);
      const dry = await cli(root, ["run", "lock", "--dry-run"]);
      const real = await cli(root, ["run", "lock"]);
      const exit = expected === "free" ? 0 : 2;
      expect(dry.exit, `dry run: ${JSON.stringify(dry.payload)}`).toBe(exit);
      expect(real.exit, `real call: ${JSON.stringify(real.payload)}`).toBe(exit);
      if (expected === "refuse") expect(violationOf(dry.payload)).toEqual(violationOf(real.payload));
      if (expected === "free") await cli(root, ["run", "unlock"]);
    });
  }
});
