import { access, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { main } from "../../src/cli/index.js";
import { findSpecByCliName } from "../../src/mcp/schemas.js";

// @req IR-CLI-106 — `--project-install` on init and upgrade selects the 4.1.0 project-scope onboarding;
// without it both commands onboard globally. These run the real CLI, so the agent CLIs they reach are
// the sandbox fakes on PATH (test/support/agent-cli-sandbox.ts), whose calls land in a log.

function io() {
  return { stdout: new PassThrough(), stderr: new PassThrough() };
}

function drain(stream: PassThrough): string {
  return stream.read()?.toString() ?? "";
}

async function exists(target: string): Promise<boolean> {
  return access(target).then(() => true).catch(() => false);
}

async function emptyRepo(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "speckiwi-pi-cli-"));
  await mkdir(path.join(root, ".git"));
  return root;
}

async function agentCalls(): Promise<string[]> {
  const log = process.env.SPECKIWI_TEST_AGENT_CLI_LOG;
  const text = log ? await readFile(log, "utf8").catch(() => "") : "";
  return text
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => {
      const call = JSON.parse(line) as { agent: string; args: string[] };
      return [call.agent, ...call.args].join(" ");
    });
}

/** Runs the CLI and returns the exit code, the parsed JSON envelope, and the agent calls it made. */
async function run(args: string[]) {
  const before = (await agentCalls()).length;
  const streams = io();
  const code = await main(args, streams);
  const stdout = drain(streams.stdout);
  const stderr = drain(streams.stderr);
  const calls = (await agentCalls()).slice(before);
  let envelope: { ok?: boolean; value?: Record<string, unknown> } = {};
  try {
    envelope = JSON.parse(stdout) as typeof envelope;
  } catch {
    // help text and usage errors are not JSON
  }
  return { code, stdout, stderr, calls, envelope };
}

type InitValue = { created: string[]; skipped: string[]; removed: string[]; warnings?: string[]; onboarding?: { scope: string; agentCommands: string[] } };

function initValue(envelope: { value?: Record<string, unknown> }): InitValue {
  return envelope.value as unknown as InitValue;
}

function upgradeValue(envelope: { value?: Record<string, unknown> }): { init: InitValue; removed: string[]; warnings: string[] } {
  return envelope.value as unknown as { init: InitValue; removed: string[]; warnings: string[] };
}

/** Repoint HOME/USERPROFILE/CODEX_HOME at `home` for the duration of fn, then restore the sandbox values. */
async function withHome<T>(home: string, fn: () => Promise<T>): Promise<T> {
  const keys = ["HOME", "USERPROFILE", "CODEX_HOME"] as const;
  const previous = keys.map((key) => process.env[key]);
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  process.env.CODEX_HOME = path.join(home, ".codex");
  try {
    return await fn();
  } finally {
    keys.forEach((key, index) => {
      const value = previous[index];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    });
  }
}

async function homeWithAgents(): Promise<string> {
  const home = await mkdtemp(path.join(tmpdir(), "speckiwi-pi-home-"));
  await mkdir(path.join(home, ".claude"));
  await mkdir(path.join(home, ".codex"));
  return home;
}

describe("IR-CLI-106 AC-1 — the flag is declared on both commands", () => {
  it.each([["init"], ["upgrade"]])("IR-CLI-106 AC-1: `%s --help` lists --project-install naming the project skill copies and .mcp.json", async (name) => {
    const { stdout, stderr } = await run([name, "--help"]);
    const help = `${stdout}${stderr}`;
    const line = help.split("\n").find((entry) => entry.includes("--project-install")) ?? "";
    // The description may wrap onto the next line; read the option's whole block.
    const block = help.slice(help.indexOf("--project-install"), help.indexOf("--project-install") + 240);
    expect(line, "the option is not listed").not.toBe("");
    expect(block).toMatch(/skill/i);
    expect(block).toContain(".mcp.json");
  });

  it("IR-CLI-106 AC-1: --project-install parses without a usage error on both commands", async () => {
    const root = await emptyRepo();
    expect((await run(["--root", root, "init", "--project-install", "--dry-run", "--json"])).code).toBe(0);
    expect((await run(["--root", root, "init", "--project-install", "--json"])).code).toBe(0);
    expect((await run(["--root", root, "upgrade", "--project-install", "--dry-run", "--json"])).code).toBe(0);
  }, 120000);
});

describe("IR-CLI-106 AC-2 — global by default, project scope with the flag", () => {
  it("IR-CLI-106 AC-2: `init` with no flags registers at user scope through the agent CLIs and writes no project copies", async () => {
    const root = await emptyRepo();
    const { code, calls, envelope } = await run(["--root", root, "init", "--json"]);
    expect(code).toBe(0);
    expect(calls).toEqual([
      "claude mcp get speckiwi",
      "claude mcp add -s user speckiwi -- npx -y speckiwi mcp",
      "codex mcp get speckiwi --json",
      "codex mcp add speckiwi -- npx -y speckiwi mcp"
    ]);
    expect(initValue(envelope).onboarding?.scope).toBe("global");
    expect(await exists(path.join(root, ".mcp.json"))).toBe(false);
    expect(await exists(path.join(root, ".claude", "skills"))).toBe(false);
    expect(await exists(path.join(root, ".agents", "skills"))).toBe(false);
  }, 120000);

  it("IR-CLI-106 AC-2: `init --project-install` writes .mcp.json and project skills and runs no agent CLI", async () => {
    const root = await emptyRepo();
    const { code, calls } = await run(["--root", root, "init", "--project-install", "--json"]);
    expect(code).toBe(0);
    expect(calls).toEqual([]);
    expect(await exists(path.join(root, ".mcp.json"))).toBe(true);
    expect(await exists(path.join(root, ".claude", "skills"))).toBe(true);
    expect(await exists(path.join(root, ".agents", "skills"))).toBe(true);
  }, 120000);

  it("IR-CLI-106 AC-2: `upgrade` migrates the .mcp.json key once the registration is confirmed; `upgrade --project-install` keeps it", async () => {
    const kept = await emptyRepo();
    expect((await run(["--root", kept, "init", "--project-install", "--no-skills", "--json"])).code).toBe(0);
    const projectRun = await run(["--root", kept, "upgrade", "--project-install", "--no-skills", "--json"]);
    expect(projectRun.code).toBe(0);
    expect(projectRun.calls).toEqual([]);
    expect(JSON.parse(await readFile(path.join(kept, ".mcp.json"), "utf8"))).toHaveProperty("mcpServers.speckiwi");

    const migrated = await emptyRepo();
    expect((await run(["--root", migrated, "init", "--project-install", "--no-skills", "--json"])).code).toBe(0);
    const defaultRun = await run(["--root", migrated, "upgrade", "--no-skills", "--json"]);
    expect(defaultRun.code).toBe(0);
    expect(defaultRun.calls).toContain("claude mcp add -s user speckiwi -- npx -y speckiwi mcp");
    expect(upgradeValue(defaultRun.envelope).removed).toContain(`${path.join(migrated, ".mcp.json")}#mcpServers.speckiwi`);
    expect(JSON.parse(await readFile(path.join(migrated, ".mcp.json"), "utf8"))).not.toHaveProperty("mcpServers.speckiwi");
  }, 120000);
});

describe("IR-CLI-106 AC-3 — -g adds the global pass to a project install, and is the default otherwise", () => {
  it.each([["init"], ["upgrade"]])("IR-CLI-106 AC-3: `%s --project-install -g` plans both the project and the global skills", async (name) => {
    const root = await emptyRepo();
    const home = await homeWithAgents();
    const { code, envelope } = await withHome(home, () => run(["--root", root, name, "--project-install", "-g", "--no-mcp", "--dry-run", "--json"]));
    expect(code).toBe(0);
    const value = name === "init" ? initValue(envelope) : upgradeValue(envelope).init;
    expect(value.created.some((entry) => entry.startsWith(path.join(root, ".claude", "skills")))).toBe(true);
    expect(value.created.some((entry) => entry.startsWith(path.join(home, ".claude", "skills")))).toBe(true);
  }, 120000);

  it.each([["init"], ["upgrade"]])("IR-CLI-106 AC-3: `%s -g` without --project-install is the default global onboarding", async (name) => {
    const root = await emptyRepo();
    const home = await homeWithAgents();
    const { code, envelope } = await withHome(home, () => run(["--root", root, name, "-g", "--no-mcp", "--dry-run", "--json"]));
    expect(code).toBe(0);
    const value = name === "init" ? initValue(envelope) : upgradeValue(envelope).init;
    expect(value.onboarding?.scope).toBe("global");
    expect(value.created.some((entry) => entry.startsWith(path.join(home, ".claude", "skills")))).toBe(true);
    expect(value.created.some((entry) => entry.startsWith(path.join(root, ".claude", "skills")))).toBe(false);
  }, 120000);
});

describe("IR-CLI-106 AC-4 — --no-skills and --no-mcp still skip their step in both modes", () => {
  it.each([["init"], ["upgrade"]])("IR-CLI-106 AC-4: `%s --no-mcp --no-skills` runs neither step in the default mode", async (name) => {
    const root = await emptyRepo();
    const home = await homeWithAgents();
    const { code, calls, envelope } = await withHome(home, () => run(["--root", root, name, "--no-mcp", "--no-skills", "--json"]));
    expect(code).toBe(0);
    expect(calls).toEqual([]);
    const value = name === "init" ? initValue(envelope) : upgradeValue(envelope).init;
    expect(value.created.some((entry) => entry.startsWith(home))).toBe(false);
    expect(await exists(path.join(home, ".claude", "skills"))).toBe(false);
  }, 120000);

  it.each([["init"], ["upgrade"]])("IR-CLI-106 AC-4: `%s --project-install --no-mcp --no-skills` writes neither .mcp.json nor project skills", async (name) => {
    const root = await emptyRepo();
    const { code, calls } = await run(["--root", root, name, "--project-install", "--no-mcp", "--no-skills", "--json"]);
    expect(code).toBe(0);
    expect(calls).toEqual([]);
    expect(await exists(path.join(root, ".mcp.json"))).toBe(false);
    expect(await exists(path.join(root, ".claude", "skills"))).toBe(false);
  }, 120000);
});

describe("IR-CLI-106 AC-5 — the registry declares the flag", () => {
  it.each([["init"], ["upgrade"]])("IR-CLI-106 AC-5: the `%s` registry entry and the commands catalogue carry --project-install", async (name) => {
    expect(findSpecByCliName(name)!.options.map((option) => option.flag)).toContain("--project-install");
    const { code, stdout } = await run(["--root", await emptyRepo(), "commands", "--json"]);
    expect(code).toBe(0);
    const entry = (JSON.parse(stdout) as { commands: Array<{ name: string; options: Array<{ flag: string }> }> }).commands.find((candidate) => candidate.name === name);
    expect(entry?.options.map((option) => option.flag)).toContain("--project-install");
  }, 60000);
});

describe("IR-CLI-106 AC-6 — exit codes are unchanged", () => {
  it("IR-CLI-106 AC-6: an agent CLI missing from PATH is a warning, not a failure: exit 0", async () => {
    const root = await emptyRepo();
    const empty = await mkdtemp(path.join(tmpdir(), "speckiwi-pi-nopath-"));
    const previous = process.env.PATH;
    process.env.PATH = empty;
    let result: Awaited<ReturnType<typeof run>>;
    try {
      result = await run(["--root", root, "init", "--no-skills", "--json"]);
    } finally {
      process.env.PATH = previous;
    }
    expect(result.code).toBe(0);
    expect((initValue(result.envelope).warnings ?? []).some((w) => w.includes("claude mcp add -s user speckiwi -- npx -y speckiwi mcp"))).toBe(true);
  }, 120000);

  it("IR-CLI-106 AC-6: an unknown flag is a usage error (2) and a held lock is a failure (5) with --project-install", async () => {
    const root = await emptyRepo();
    expect((await run(["--root", root, "init", "--project-install", "--totally-unknown-flag"])).code).toBe(2);
    await mkdir(path.join(root, "kiwi"), { recursive: true });
    await writeFile(
      path.join(root, "kiwi", ".srs.lock"),
      `${JSON.stringify({
        schemaVersion: "1.0.0",
        owner: "other-session",
        operation: "update_status",
        requestId: "held-lock",
        acquiredAt: new Date(0).toISOString(),
        expiresAt: new Date(4102444800000).toISOString()
      })}\n`,
      "utf8"
    );
    expect((await run(["--root", root, "init", "--project-install", "--no-skills", "--no-mcp", "--json"])).code).toBe(5);
  }, 60000);
});
