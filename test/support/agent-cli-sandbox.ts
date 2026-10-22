import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import os, { tmpdir } from "node:os";
import path from "node:path";

// @req FR-NODE-223 AC-8 — init and upgrade now reach the agents' own CLIs and the agents' global
// homes by default, so a test that forgets a seam would register servers in the developer's real
// ~/.claude.json and ~/.codex/config.toml. This setup file removes that possibility for the whole
// suite instead of trusting every test to remember: per worker it points the home variables at a fresh
// temp directory and puts fake `claude` and `codex` binaries first on PATH. The fakes log each call and
// answer `mcp get` with exit 1 (not registered) and `mcp add` with exit 0.
//
// Tests that need a particular agent answer inject a runner into the core functions instead.

const SANDBOX_ENV = "SPECKIWI_TEST_SANDBOX";
const LOG_ENV = "SPECKIWI_TEST_AGENT_CLI_LOG";

const FAKE_AGENT_CLI = `import { appendFileSync } from "node:fs";
const [agent, ...args] = process.argv.slice(2);
appendFileSync(process.env.${LOG_ENV}, JSON.stringify({ agent, args, cwd: process.cwd() }) + "\\n");
process.exit(args[0] === "mcp" && args[1] === "add" ? 0 : 1);
`;

function installSandbox(): void {
  const sandbox = mkdtempSync(path.join(tmpdir(), "speckiwi-agent-sandbox-"));
  const home = path.join(sandbox, "home");
  const bin = path.join(sandbox, "bin");
  mkdirSync(home);
  mkdirSync(bin);
  const script = path.join(sandbox, "fake-agent-cli.mjs");
  writeFileSync(script, FAKE_AGENT_CLI, "utf8");
  for (const agent of ["claude", "codex"]) {
    writeFileSync(path.join(bin, `${agent}.cmd`), `@"${process.execPath}" "${script}" ${agent} %*\r\n`, "utf8");
    const posixShim = path.join(bin, agent);
    writeFileSync(posixShim, `#!/bin/sh\nexec "${process.execPath}" "${script}" ${agent} "$@"\n`, "utf8");
    chmodSync(posixShim, 0o755);
  }

  // Captured before HOME moves: git and npm read their user config from the home directory, and a
  // test that commits or packs still needs the developer's identity and registry settings. Copied into
  // the sandbox home rather than pointed at, so a `git config --global` in a test cannot reach the real one.
  const realHome = os.homedir();
  for (const name of [".gitconfig", ".npmrc"]) {
    const real = path.join(realHome, name);
    if (existsSync(real)) copyFileSync(real, path.join(home, name));
  }

  process.env[SANDBOX_ENV] = sandbox;
  process.env[LOG_ENV] = path.join(sandbox, "agent-cli.log");
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  process.env.CLAUDE_CONFIG_DIR = path.join(home, ".claude");
  process.env.CODEX_HOME = path.join(home, ".codex");
  process.env.PATH = `${bin}${path.delimiter}${process.env.PATH ?? ""}`;
}

// Once per worker: a later test file in the same worker finds the variables already set.
if (process.env[SANDBOX_ENV] === undefined) installSandbox();
