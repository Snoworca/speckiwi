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

  it("FR-NODE-223 AC-4: an agent CLI that outlives the deadline is reported as timed out, not thrown, and its process tree is ended", async () => {
    // A slow `claude` of its own, first on PATH: it writes a marker only if it survives the deadline.
    const bin = await mkdtemp(path.join(tmpdir(), "speckiwi-slow-agent-"));
    const marker = path.join(bin, "survived");
    const script = path.join(bin, "slow.mjs");
    await writeFile(script, `import { writeFileSync } from "node:fs";\nsetTimeout(() => writeFileSync(${JSON.stringify(marker)}, "x"), 4000);\n`, "utf8");
    await writeFile(path.join(bin, "claude.cmd"), `@"${process.execPath}" "${script}" %*\r\n`, "utf8");
    await writeFile(path.join(bin, "claude"), `#!/bin/sh\nexec "${process.execPath}" "${script}" "$@"\n`, { encoding: "utf8", mode: 0o755 });
    const previous = process.env.PATH;
    process.env.PATH = `${bin}${path.delimiter}${previous ?? ""}`;
    try {
      const outcome = await createAgentCliRunner(1000)("claude", ["mcp", "get", "speckiwi"]);
      expect(outcome.timedOut).toBe(true);
    } finally {
      process.env.PATH = previous;
    }
    await new Promise((resolve) => setTimeout(resolve, 5000));
    expect(await access(marker).then(() => "survived", () => "ended")).toBe("ended");
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
