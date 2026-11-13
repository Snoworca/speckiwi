import type { ChildProcess } from "node:child_process";
import { access, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os, { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createAgentCliRunner, runAgentCli } from "../../src/cli/agent-cli-runner.js";

// @req FR-NODE-223 AC-8 — the suite never reaches a real agent CLI or the real home. The sandbox is
// laid down by test/support/agent-cli-sandbox.ts (a vitest setup file); this file proves it is in force
// and that the runner the CLI passes to init resolves the binary by name from PATH.

const ISOLATED_KEYS = ["HOME", "USERPROFILE", "CLAUDE_CONFIG_DIR", "CODEX_HOME"] as const;

function isUnder(child: string, parent: string): boolean {
  const relative = path.relative(path.resolve(parent), path.resolve(child));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

async function loggedCalls(): Promise<Array<{ agent: string; args: string[]; cwd: string }>> {
  const log = process.env.SPECKIWI_TEST_AGENT_CLI_LOG;
  if (!log) return [];
  const text = await readFile(log, "utf8").catch(() => "");
  return text
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => JSON.parse(line) as { agent: string; args: string[]; cwd: string });
}

/** A `claude` of the test's own, run by the current node: `body` is its script, with `PID_FILE` in scope. */
async function fakeClaude(body: string): Promise<{ bin: string; pidFile: string }> {
  const bin = await mkdtemp(path.join(tmpdir(), "speckiwi-slow-agent-"));
  const pidFile = path.join(bin, "agent.pid");
  const script = path.join(bin, "agent.mjs");
  await writeFile(script, `import { writeFileSync } from "node:fs";\nconst PID_FILE = ${JSON.stringify(pidFile)};\n${body}`, "utf8");
  await writeFile(path.join(bin, "claude.cmd"), `@"${process.execPath}" "${script}" %*\r\n`, "utf8");
  await writeFile(path.join(bin, "claude"), `#!/bin/sh\nexec "${process.execPath}" "${script}" "$@"\n`, { encoding: "utf8", mode: 0o755 });
  return { bin, pidFile };
}

/** Runs `call` with `bin` first on PATH and restores PATH whatever happens. */
async function withOnPath<T>(bin: string, call: () => Promise<T>): Promise<T> {
  const previous = process.env.PATH;
  process.env.PATH = `${bin}${path.delimiter}${previous ?? ""}`;
  try {
    return await call();
  } finally {
    process.env.PATH = previous;
  }
}

/** Signal 0 checks for the process without touching it; ESRCH means it is gone. */
function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

describe("FR-NODE-223 AC-8 — agent CLI and home isolation for the whole suite", () => {
  it("FR-NODE-223 AC-8: HOME, USERPROFILE, CLAUDE_CONFIG_DIR and CODEX_HOME point into a temp sandbox, not the real home", () => {
    const sandbox = process.env.SPECKIWI_TEST_SANDBOX;
    expect(sandbox, "the agent CLI sandbox setup file is not wired").toBeDefined();
    expect(isUnder(sandbox!, tmpdir())).toBe(true);
    for (const key of ISOLATED_KEYS) {
      expect(process.env[key], key).toBeDefined();
      expect(isUnder(process.env[key]!, sandbox!), key).toBe(true);
    }
    expect(path.resolve(os.homedir())).not.toBe(path.resolve(os.userInfo().homedir));
  });

  it.each([["claude"], ["codex"]] as const)(
    "FR-NODE-223 AC-8: the CLI runner reaches the fake %s first on PATH — mcp get exits 1, mcp add exits 0, each call is logged",
    async (agent) => {
      const before = (await loggedCalls()).length;
      const get = await runAgentCli(agent, ["mcp", "get", "speckiwi"]);
      expect(get.found).toBe(true);
      expect(get.exitCode).toBe(1);
      const add = await runAgentCli(agent, ["mcp", "add", "speckiwi", "--", "npx", "-y", "speckiwi", "mcp"]);
      expect(add.found).toBe(true);
      expect(add.exitCode).toBe(0);
      const calls = (await loggedCalls()).slice(before).map(({ agent: name, args }) => ({ agent: name, args }));
      expect(calls).toEqual([
        { agent, args: ["mcp", "get", "speckiwi"] },
        { agent, args: ["mcp", "add", "speckiwi", "--", "npx", "-y", "speckiwi", "mcp"] }
      ]);
    },
    30000
  );

  it("FR-NODE-223 AC-8: the CLI runner starts the agent in a fresh empty directory, so neither the project's .mcp.json nor a script planted in it can answer", async () => {
    const before = (await loggedCalls()).length;
    await runAgentCli("claude", ["mcp", "get", "speckiwi"]);
    const [call] = (await loggedCalls()).slice(before);
    expect(call).toBeDefined();
    expect(path.resolve(call!.cwd)).not.toBe(path.resolve(process.cwd()));
    expect(isUnder(call!.cwd, tmpdir())).toBe(true);
    // A directory made for the call and removed after it, so nothing could have been placed there.
    expect(await access(call!.cwd).then(() => "present", () => "gone")).toBe("gone");
  }, 30000);

  // @req FR-NODE-223 AC-4 — a call killed at the deadline is a failed get/add, so it must come back as
  // timed out. The tree is checked by the pid the agent wrote, not by outwaiting a timer: how long
  // `taskkill` takes depends on how many processes the host runs (measured 3.3-3.9 s with 1,782 of
  // them), and a fixed wait shorter than that let a live agent pass as ended or an ended one fail.
  it("FR-NODE-223 AC-4: an agent CLI that outlives the deadline is reported as timed out, not thrown, and its process tree is ended", async () => {
    const { bin, pidFile } = await fakeClaude("writeFileSync(PID_FILE, String(process.pid));\nsetTimeout(() => undefined, 120000);\n");
    const outcome = await withOnPath(bin, () => createAgentCliRunner(1000)("claude", ["mcp", "get", "speckiwi"]));
    expect(outcome.timedOut).toBe(true);
    // The runner returns only after the tree was ended. An agent that had not written its pid when it
    // was ended never ran its script; the short grace only keeps a late writer from passing as ended.
    await new Promise((resolve) => setTimeout(resolve, 1000));
    const pid = await readFile(pidFile, "utf8").then(Number, () => undefined);
    if (pid !== undefined) expect(isAlive(pid), `agent ${pid} outlived the runner`).toBe(false);
  }, 60000);

  // @req FR-NODE-223 AC-4 — once the deadline fires the call is timed out, whatever ends it: here the
  // agent exits 0 on its own while its tree is still being ended, which is what a slow `taskkill`
  // produces on a busy Windows host. The injected ender is held open by the test instead of a clock,
  // so the call can be seen waiting for it after the agent is gone.
  it("FR-NODE-223 AC-4: an agent that exits 0 after the deadline, before its tree is ended, is still reported as timed out", async () => {
    const { bin } = await fakeClaude("setTimeout(() => process.exit(0), 500);\n");
    let openGate: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      openGate = resolve;
    });
    let enderCalled: (child: ChildProcess) => void = () => undefined;
    const called = new Promise<ChildProcess>((resolve) => {
      enderCalled = resolve;
    });
    const heldEnder = (child: ChildProcess): Promise<void> => {
      enderCalled(child);
      return gate;
    };
    await withOnPath(bin, async () => {
      const call = createAgentCliRunner(50, heldEnder)("claude", ["mcp", "get", "speckiwi"]);
      const child = await called;
      if (child.exitCode === null) await new Promise((resolve) => child.once("close", resolve));
      // The agent is gone and its answer is in; the call must still wait for the tree end. The bound
      // only decides how long to look: a slow host can make this pass late, never fail falsely.
      const early = await Promise.race([call.then(() => "returned"), new Promise((resolve) => setTimeout(() => resolve("waiting"), 1000))]);
      expect(early, "the runner returned before the tree end it started had finished").toBe("waiting");
      openGate();
      const outcome = await call;
      expect(outcome.timedOut).toBe(true);
    });
  }, 30000);

  // @req FR-NODE-223 AC-4 — `taskkill` fails when the agent is already gone; that failure is not the answer.
  it("FR-NODE-223 AC-4: a tree end that fails because the agent already exited still leaves the call timed out", async () => {
    const { bin } = await fakeClaude("setTimeout(() => process.exit(0), 500);\n");
    const failingEnder = (child: ChildProcess): Promise<void> =>
      new Promise((_resolve, reject) => {
        const fail = (): void => reject(new Error("no such process"));
        if (child.exitCode !== null) fail();
        else child.once("exit", fail);
      });
    const outcome = await withOnPath(bin, () => createAgentCliRunner(50, failingEnder)("claude", ["mcp", "get", "speckiwi"]));
    expect(outcome.timedOut).toBe(true);
  }, 30000);

  it("FR-NODE-223 AC-8: the CLI runner reports a binary missing from PATH as not found instead of throwing", async () => {
    const empty = await mkdtemp(path.join(tmpdir(), "speckiwi-empty-path-"));
    const previous = process.env.PATH;
    process.env.PATH = empty;
    try {
      const outcome = await runAgentCli("claude", ["mcp", "get", "speckiwi"]);
      expect(outcome.found).toBe(false);
    } finally {
      process.env.PATH = previous;
    }
  }, 30000);
});
