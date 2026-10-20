import { execFile } from "node:child_process";
import { cp, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { hostname } from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { main } from "../../../src/cli/index.js";
import {
  acquire,
  injectCleanupFaultForTest,
  probeRunLockFence,
  release,
  releaseHeldRunLock,
  resolveGitCommonDir,
  runLockPath,
  type RunLock
} from "../../../src/core/orchestrator/run-lock.js";
import { GATE_IDS } from "../../../src/core/orchestrator/auto-gate.js";
import { cleanupFixtures, commitAll, initRepo } from "./support/git-fixture.js";

/**
 * @req FR-NODE-221 — a run lock is released only by its holder while that holder's Windows fence is
 * live, and a release never leaves a lock nobody can name.
 *
 * The process-level cases use real `speckiwi mcp` stdio servers, because the ghost this closes is made
 * by exactly that shape: the bridge runs the CLI `main` inside the server, so the lock taken over MCP
 * keeps its named pipe open for the server's whole life, and a release from any other process used to
 * remove the file and leave the pipe. The scratch repositories carry an SRS index so a server that
 * finds no SRS (FR-MCP-067) cannot answer for them. Those cases are win32-only: on POSIX the fence is a
 * stub, there is no live-session state to refuse on, and a release there behaves as before.
 */

const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..", "..");
const CLI = path.join(REPO_ROOT, "bin", "speckiwi");
const SPEC_FIXTURE = path.join(REPO_ROOT, "test", "fixtures", "workspaces", "valid-basic", "docs", "spec");
const LIVE_GATE = "run-lock-held-by-live-session";
const WIN32 = process.platform === "win32";
const DEAD_PID = 2_147_483_647;

const COMPILED_MIRRORS: ReadonlyArray<readonly [string, string]> = [
  ["src/core/lock/exclusive-lock.ts", "dist/core/lock/exclusive-lock.js"],
  ["src/core/orchestrator/run-lock.ts", "dist/core/orchestrator/run-lock.js"],
  ["src/cli/commands/orchestrate.ts", "dist/cli/commands/orchestrate.js"]
];

const sessions: McpSession[] = [];
const held: RunLock[] = [];

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
  for (const session of sessions.splice(0)) await session.close().catch(() => undefined);
  for (const lock of held.splice(0)) await release(lock).catch(() => undefined);
  await cleanupFixtures();
});

// ── fixtures ─────────────────────────────────────────────────────────────────────────────────────

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

async function inProcess(root: string, args: readonly string[]): Promise<Run> {
  const pipes = { stdout: new PassThrough(), stderr: new PassThrough() };
  const exit = await main(["--root", root, "orchestrate", ...args, "--json"], pipes);
  const text = pipes.stdout.read()?.toString() ?? "";
  return { exit, payload: text.length > 0 ? (JSON.parse(text) as Record<string, unknown>) : {} };
}

interface McpSession {
  call(tool: string, input: Record<string, unknown>): Promise<Record<string, unknown>>;
  close(): Promise<void>;
}

/** A real `speckiwi mcp` stdio server whose root is `root`: the process a session's lock lives in. */
async function mcpSession(root: string): Promise<McpSession> {
  const transport = new StdioClientTransport({ command: process.execPath, args: [CLI, "mcp"], cwd: root, stderr: "pipe" });
  const client = new Client({ name: "fr-node-221", version: "1.0.0" }, { capabilities: {} });
  await client.connect(transport);
  const session: McpSession = {
    async call(tool, input) {
      const result = await client.callTool({ name: tool, arguments: input });
      const first = (result.content as Array<{ type: string; text?: string }>)[0];
      return JSON.parse(first?.text ?? "{}") as Record<string, unknown>;
    },
    close: async () => client.close()
  };
  sessions.push(session);
  return session;
}

async function bytesOrNull(file: string): Promise<string | null> {
  return readFile(file, "utf8").catch(() => null);
}

/** Waits until the fence a closed session held is gone, so the next step is not a race with its exit. */
async function untilFenceFree(commonDir: string): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if ((await probeRunLockFence(commonDir)) !== "held") return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("the fence of a closed session is still held after 10 s");
}

function violationOf(payload: Record<string, unknown>): Record<string, unknown> {
  return ((payload.violations as unknown[]) ?? [])[0] as Record<string, unknown>;
}

function expectLiveSessionRefusal(run: Run | Record<string, unknown>, label: string): Record<string, unknown> {
  const payload = "payload" in run ? (run as Run).payload : (run as Record<string, unknown>);
  const exit = "payload" in run ? (run as Run).exit : (run as { exitCode?: number }).exitCode;
  expect(exit, `${label}: ${JSON.stringify(payload)}`).toBe(2);
  expect(payload.gate, label).toBe(LIVE_GATE);
  const violation = violationOf(payload);
  const text = JSON.stringify(violation);
  expect(text, `${label}: names a live holder`).toMatch(/live process/);
  expect(text, `${label}: names the session that took it`).toMatch(/MCP server of the session that took it/);
  expect(text, `${label}: may be the caller's own`).toMatch(/caller's own session/);
  expect(text, `${label}: release through the MCP unlock`).toContain("orchestrate_run_lock");
  expect(text, `${label}: release through the MCP unlock`).toContain('action: \\"unlock\\"');
  expect(text, `${label}: or through the MCP abort`).toContain("orchestrate_run_abort");
  expect(text, `${label}: or by closing the session`).toMatch(/clos/);
  return violation;
}

// ── AC-1 .. AC-4, AC-7, AC-9: real processes, win32 ─────────────────────────────────────────────────

describe.runIf(WIN32)("FR-NODE-221 a live MCP session's run lock (win32; POSIX has no fence to hold)", { timeout: 120_000 }, () => {
  it("FR-NODE-221 AC-1 refuses a CLI unlock while MCP server A holds the lock, and leaves the sentinel byte-identical", async () => {
    const { root, lockPath } = await repository("fr-node-221-ac1-");
    const a = await mcpSession(root);
    expect((await a.call("orchestrate_run_lock", { action: "lock" })).exitCode).toBe(0);
    const before = await bytesOrNull(lockPath);
    expect(before).not.toBeNull();

    const refused = await cli(root, ["run", "unlock"]);
    expectLiveSessionRefusal(refused, "CLI unlock");
    expect(await bytesOrNull(lockPath)).toBe(before);
  });

  it("FR-NODE-221 AC-2 refuses MCP server B's unlock while MCP server A holds the lock", async () => {
    const { root, lockPath } = await repository("fr-node-221-ac2-");
    const a = await mcpSession(root);
    const b = await mcpSession(root);
    expect((await a.call("orchestrate_run_lock", { action: "lock" })).exitCode).toBe(0);
    const before = await bytesOrNull(lockPath);

    expectLiveSessionRefusal(await b.call("orchestrate_run_lock", { action: "unlock" }), "MCP B unlock");
    expect(await bytesOrNull(lockPath)).toBe(before);
  });

  it("FR-NODE-221 AC-3 / FR-NODE-197 AC-2 AC-4 refuses a CLI abort before writing the journal, and A's own MCP abort then succeeds", async () => {
    const { root, lockPath } = await repository("fr-node-221-ac3-");
    const journal = path.join(root, "kiwi", "waves.jsonl");
    const a = await mcpSession(root);
    expect((await a.call("orchestrate_run_lock", { action: "lock" })).exitCode).toBe(0);
    const sentinel = await bytesOrNull(lockPath);

    const refused = await cli(root, ["run", "abort", "--reason", "run-invariant-drift", "--run-id", "r1"]);
    const violation = expectLiveSessionRefusal(refused, "CLI abort");
    expect(violation.runLockHeld).toBe(true);
    expect(violation.lockPath).toBe(lockPath);
    expect(await bytesOrNull(lockPath)).toBe(sentinel);
    expect(existsSync(journal), "the refusal writes no journal line").toBe(false);

    const own = await a.call("orchestrate_run_abort", { reason: "run-invariant-drift", runId: "r1" });
    expect(own.exitCode, JSON.stringify(own)).toBe(0);
    expect(existsSync(lockPath)).toBe(false);
  });

  it("FR-NODE-221 AC-4 the holder always succeeds, and after it any process can take the lock", async () => {
    const { root, commonDir, lockPath } = await repository("fr-node-221-ac4-");
    const a = await mcpSession(root);
    expect((await a.call("orchestrate_run_lock", { action: "lock" })).exitCode).toBe(0);
    const own = await a.call("orchestrate_run_lock", { action: "unlock" });
    expect(own.exitCode, JSON.stringify(own)).toBe(0);
    expect(existsSync(lockPath)).toBe(false);
    expect((await cli(root, ["run", "lock"])).exit).toBe(0);
    expect((await cli(root, ["run", "unlock"])).exit).toBe(0);

    // A holder that exits without unlocking leaves a lease the CLI may remove.
    expect((await a.call("orchestrate_run_lock", { action: "lock" })).exitCode).toBe(0);
    await a.close();
    await untilFenceFree(commonDir);
    const unlocked = await cli(root, ["run", "unlock"]);
    expect(unlocked.exit, JSON.stringify(unlocked.payload)).toBe(0);
    expect(existsSync(lockPath)).toBe(false);
  });

  it("FR-NODE-221 AC-1 a session tells its own fence from another session's; a CLI process says only held", async () => {
    const { root } = await repository("fr-node-221-fence-owner-");
    const a = await mcpSession(root);
    const b = await mcpSession(root);
    expect((await a.call("orchestrate_run_lock", { action: "lock" })).exitCode).toBe(0);

    expect((await a.call("orchestrate_run_lock", { action: "status" })).fence).toBe("held-by-this-session");
    expect((await b.call("orchestrate_run_lock", { action: "status" })).fence).toBe("held-by-another-session");
    expect((await cli(root, ["run", "status"])).payload.fence).toBe("held");

    expect(violationOf(await b.call("orchestrate_run_lock", { action: "unlock" })).fence).toBe("held-by-another-session");
    expect(violationOf((await cli(root, ["run", "unlock"])).payload).fence).toBe("held");
    const again = await a.call("orchestrate_run_lock", { action: "lock" });
    expect(again.exitCode).toBe(2);
    expect(violationOf(again).fence).toBe("held-by-this-session");
    expect(String(violationOf(again).guidance)).toMatch(/this session holds the lock/);
  });

  it("FR-NODE-221 AC-7 a contender is still refused while A is alive with an expired lease", async () => {
    const { root, lockPath } = await repository("fr-node-221-ac7-");
    const a = await mcpSession(root);
    expect((await a.call("orchestrate_run_lock", { action: "lock" })).exitCode).toBe(0);
    const record = JSON.parse((await bytesOrNull(lockPath)) as string) as Record<string, unknown>;
    await writeFile(lockPath, `${JSON.stringify({ ...record, lease_expires_at: new Date(Date.now() - 60_000).toISOString() })}\n`, "utf8");

    const contender = await cli(root, ["run", "lock"]);
    expect(contender.exit).toBe(2);
    expect(contender.payload.gate).toBe("orchestrator-run-lock-held");
  });

  it("FR-NODE-221 AC-9 / FR-NODE-197 AC-5 the dry runs report the refusal the real calls give, and release nothing", async () => {
    const { root, lockPath } = await repository("fr-node-221-ac9-");
    const a = await mcpSession(root);
    expect((await a.call("orchestrate_run_lock", { action: "lock" })).exitCode).toBe(0);
    const sentinel = await bytesOrNull(lockPath);

    const dryUnlock = await cli(root, ["run", "unlock", "--dry-run"]);
    const realUnlock = await cli(root, ["run", "unlock"]);
    expectLiveSessionRefusal(dryUnlock, "dry unlock");
    expect(violationOf(dryUnlock.payload)).toEqual(violationOf(realUnlock.payload));

    const dryAbort = await cli(root, ["run", "abort", "--reason", "run-invariant-drift", "--run-id", "r1", "--dry-run"]);
    const realAbort = await cli(root, ["run", "abort", "--reason", "run-invariant-drift", "--run-id", "r1"]);
    expectLiveSessionRefusal(dryAbort, "dry abort");
    expect(violationOf(dryAbort.payload)).toEqual(violationOf(realAbort.payload));
    expect(await bytesOrNull(lockPath)).toBe(sentinel);
  });
});

// ── AC-5, AC-6, AC-8: the release path itself, in process ───────────────────────────────────────────

describe("FR-NODE-221 the release path", { timeout: 120_000 }, () => {
  it("FR-NODE-221 AC-5 a failed fence release by the holder keeps the sentinel and reports the failure; a retry releases", async () => {
    const { root, commonDir, lockPath } = await repository("fr-node-221-ac5-");
    const lock = await acquire({ commonDir, owner: "fr-node-221" });
    held.push(lock);
    let faulty = true;
    await injectCleanupFaultForTest(lock, async () => {
      if (faulty) throw Object.assign(new Error("injected cleanup fault"), { code: "EINJECTED" });
    });

    const failed = await inProcess(root, ["run", "unlock"]);
    expect(failed.exit, JSON.stringify(failed.payload)).toBe(1);
    expect(failed.payload.ok).toBe(false);
    expect(String(failed.payload.error)).toContain("injected cleanup fault");
    expect(existsSync(lockPath), "no ghost: the sentinel stays while the fence could not be released").toBe(true);

    faulty = false;
    const retried = await inProcess(root, ["run", "unlock"]);
    expect(retried.exit, JSON.stringify(retried.payload)).toBe(0);
    expect(existsSync(lockPath)).toBe(false);
    held.splice(held.indexOf(lock), 1);
  });

  it("FR-NODE-197 AC-3 an abort retried after its release failed records the abort once", async () => {
    const { root, commonDir, lockPath } = await repository("fr-node-221-abort-retry-");
    const journal = path.join(root, "kiwi", "waves.jsonl");
    const lock = await acquire({ commonDir, owner: "fr-node-221" });
    held.push(lock);
    let faulty = true;
    await injectCleanupFaultForTest(lock, async () => {
      if (faulty) throw Object.assign(new Error("injected cleanup fault"), { code: "EINJECTED" });
    });
    const abort = ["run", "abort", "--reason", "run-invariant-drift", "--run-id", "r1"];

    const first = await inProcess(root, abort);
    expect(first.exit, JSON.stringify(first.payload)).toBe(1);
    expect(String(first.payload.error)).toContain("abort line");
    expect(existsSync(lockPath)).toBe(true);

    faulty = false;
    const retried = await inProcess(root, abort);
    expect(retried.exit, JSON.stringify(retried.payload)).toBe(0);
    const abortLines = ((await bytesOrNull(journal)) ?? "").split("\n").filter((line) => line.includes('"abort-run"'));
    expect(abortLines).toHaveLength(1);
    expect(existsSync(lockPath)).toBe(false);
    held.splice(held.indexOf(lock), 1);
  });

  it("FR-NODE-221 AC-6 removes only the sentinel it read: a successor published after the probe stays", async () => {
    const { commonDir, lockPath } = await repository("fr-node-221-ac6-");
    await mkdir(path.dirname(lockPath), { recursive: true });
    const stale = { version: 1, token: "stale-token", pid: DEAD_PID, host: hostname(), owner: "kiwi-orchestrator", acquired_at: new Date().toISOString() };
    await writeFile(lockPath, `${JSON.stringify(stale)}\n`, "utf8");
    const successor = `${JSON.stringify({ ...stale, token: "successor-token", pid: process.pid })}\n`;

    const outcome = await releaseHeldRunLock(commonDir, {
      afterProbe: async () => {
        await writeFile(lockPath, successor, "utf8");
      }
    });
    expect(outcome.ok).toBe(false);
    expect(outcome.ok === false && outcome.reason).toBe("changed-hands");
    expect(await bytesOrNull(lockPath)).toBe(successor);
  });

  it("FR-NODE-221 AC-8 a probe takes nothing: 200 acquisitions interleaved with probes are never refused", async () => {
    const { commonDir } = await repository("fr-node-221-ac8-");
    let refused = 0;
    for (let index = 0; index < 200; index += 1) {
      const [lock] = await Promise.all([
        acquire({ commonDir, owner: "fr-node-221" }).catch(() => null),
        probeRunLockFence(commonDir),
        probeRunLockFence(commonDir)
      ]);
      if (lock === null) refused += 1;
      else await release(lock);
    }
    expect(refused).toBe(0);
  });
});

describe("FR-NODE-221 AC-10 the gate is a GATE_IDS member", () => {
  it("FR-NODE-221 AC-10 declares run-lock-held-by-live-session", () => {
    expect(GATE_IDS as readonly string[]).toContain(LIVE_GATE);
  });
});
