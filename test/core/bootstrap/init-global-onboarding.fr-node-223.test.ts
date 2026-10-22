import { access, mkdir, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { initProject } from "../../../src/core/bootstrap/init-project.js";
import type { AgentCli, AgentCliOutcome, AgentCliRunner } from "../../../src/core/bootstrap/mcp-registration.js";
import { resolveProjectRoot } from "../../../src/core/project-root.js";

// @req FR-NODE-223 — by default init onboards the agents globally: global skills for each present agent
// home, and the MCP server registered at user scope through each agent's own CLI. Every case pins the
// home and codex home to a temp directory and injects the agent CLI runner.

const CLAUDE_GET = "claude mcp get speckiwi";
const CLAUDE_ADD = "claude mcp add -s user speckiwi -- npx -y speckiwi mcp";
const CODEX_GET = "codex mcp get speckiwi --json";
const CODEX_ADD = "codex mcp add speckiwi -- npx -y speckiwi mcp";

// Each case runs a full init; under a loaded full-suite run that outlasts the 5s default.
vi.setConfig({ testTimeout: 60_000 });

async function emptyRepo(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "speckiwi-init-g1-"));
  await mkdir(path.join(root, ".git"));
  return root;
}

async function writeFixtureSkill(base: string, subdir: "claude" | "codex", name: string): Promise<void> {
  const dir = path.join(base, subdir, name);
  await mkdir(dir, { recursive: true });
  await writeFile(
    path.join(dir, "SKILL.md"),
    ["---", `name: ${name}`, "description: test skill", "---", "", `# ${name}`, "", "Normal operation requires speckiwi mcp."].join("\n"),
    "utf8"
  );
}

async function exists(target: string): Promise<boolean> {
  return access(target).then(() => true).catch(() => false);
}

/** A runner that records each command line and answers with `answer`, by default get=1 / add=0. */
function fakeRunner(answer?: (agent: AgentCli, args: readonly string[]) => AgentCliOutcome) {
  const calls: string[] = [];
  const runner: AgentCliRunner = async (agent, args) => {
    calls.push([agent, ...args].join(" "));
    return answer?.(agent, args) ?? { found: true, exitCode: args[1] === "add" ? 0 : 1, stdout: "", stderr: "" };
  };
  return { runner, calls };
}

/** A repo, a fixture skill source, and a temp home holding the requested agent homes. */
async function scenario(agents: ReadonlyArray<"claude" | "codex"> = ["claude", "codex"]) {
  const root = await emptyRepo();
  const base = await mkdtemp(path.join(tmpdir(), "speckiwi-init-g1-src-"));
  await writeFixtureSkill(base, "claude", "kiwi-keep");
  await writeFixtureSkill(base, "codex", "kiwi-keep");
  const home = await mkdtemp(path.join(tmpdir(), "speckiwi-init-g1-home-"));
  for (const agent of agents) await mkdir(path.join(home, `.${agent}`));
  return { root, base, home };
}

type InitInput = Parameters<typeof initProject>[1];

function defaults(s: { base: string; home: string }, runner: AgentCliRunner, extra: Partial<InitInput> = {}): InitInput {
  return {
    installSkills: true,
    registerMcp: true,
    agentCli: runner,
    globalHomeDir: s.home,
    globalCodexHome: path.join(s.home, ".codex"),
    skillSourceBaseDir: s.base,
    ...extra
  };
}

async function runInit(root: string, input: InitInput) {
  const result = await initProject(await resolveProjectRoot(root), input);
  if (!result.ok || result.value === undefined) throw new Error(result.error?.message ?? "expected an ok result with a value");
  return result.value;
}

describe("FR-NODE-223 AC-1 — default options provision globally and write nothing project-scoped", () => {
  it("FR-NODE-223 AC-1: installs at both global destinations and writes no project skill directory and no .mcp.json", async () => {
    const s = await scenario();
    const { runner } = fakeRunner();
    const value = await runInit(s.root, defaults(s, runner));
    const claudeGlobal = path.join(s.home, ".claude", "skills", "kiwi-keep");
    const codexGlobal = path.join(s.home, ".agents", "skills", "kiwi-keep");
    expect(await exists(path.join(claudeGlobal, "SKILL.md"))).toBe(true);
    expect(await exists(path.join(codexGlobal, "SKILL.md"))).toBe(true);
    expect(value.created).toContain(claudeGlobal);
    expect(value.created).toContain(codexGlobal);
    expect(await exists(path.join(s.root, ".claude", "skills"))).toBe(false);
    expect(await exists(path.join(s.root, ".agents", "skills"))).toBe(false);
    expect(await exists(path.join(s.root, ".mcp.json"))).toBe(false);
    expect(value.onboarding?.scope).toBe("global");
  });

  it("FR-NODE-223 AC-1: an absent agent home is skipped with a warning, and a second run reports unchanged skills as skipped", async () => {
    const s = await scenario(["claude"]);
    const { runner } = fakeRunner();
    const first = await runInit(s.root, defaults(s, runner));
    expect(await exists(path.join(s.home, ".agents", "skills"))).toBe(false);
    expect((first.warnings ?? []).some((w) => /codex/i.test(w) && /global/i.test(w))).toBe(true);
    const second = await runInit(s.root, defaults(s, runner));
    expect(second.skipped).toContain(path.join(s.home, ".claude", "skills", "kiwi-keep"));
  });
});

describe("FR-NODE-223 AC-2/AC-3 — user-scope registration through the agents' own CLIs", () => {
  it("FR-NODE-223 AC-2: claude — get exit 1 leads to `mcp add -s user` with the ordinary launcher, reported as created", async () => {
    const s = await scenario();
    const { runner, calls } = fakeRunner();
    const value = await runInit(s.root, defaults(s, runner));
    expect(calls.filter((call) => call.startsWith("claude "))).toEqual([CLAUDE_GET, CLAUDE_ADD]);
    expect(value.created).toContain("claude mcp (user scope): speckiwi");
    expect(value.onboarding?.mcpConfirmed).toContain("claude");
  });

  it("FR-NODE-223 AC-2: claude — get exit 0 is reported as skipped and runs no add", async () => {
    const s = await scenario();
    const { runner, calls } = fakeRunner(() => ({ found: true, exitCode: 0, stdout: "", stderr: "" }));
    const value = await runInit(s.root, defaults(s, runner));
    expect(calls).toEqual([CLAUDE_GET, CODEX_GET]);
    expect(value.skipped).toContain("claude mcp (user scope): speckiwi");
    expect(value.skipped).toContain("codex mcp (user scope): speckiwi");
    expect(value.onboarding?.mcpConfirmed).toEqual(["claude", "codex"]);
  });

  it("FR-NODE-223 AC-3: codex — `get --json` exit 1 leads to `mcp add`, reported as created; SpecKiwi writes no agent config itself", async () => {
    const s = await scenario();
    const { runner, calls } = fakeRunner();
    const value = await runInit(s.root, defaults(s, runner));
    expect(calls.filter((call) => call.startsWith("codex "))).toEqual([CODEX_GET, CODEX_ADD]);
    expect(value.created).toContain("codex mcp (user scope): speckiwi");
    // The fake runner writes nothing, so any agent config under the home was written by SpecKiwi.
    expect(await exists(path.join(s.home, ".claude.json"))).toBe(false);
    expect(await exists(path.join(s.home, ".claude", ".claude.json"))).toBe(false);
    expect(await exists(path.join(s.home, ".codex", "config.toml"))).toBe(false);
  });
});

describe("FR-NODE-223 AC-4 — an agent CLI that is missing or refuses degrades to a warning", () => {
  it("FR-NODE-223 AC-4: a CLI not found warns with the exact command to run by hand, and init completes", async () => {
    const s = await scenario();
    const { runner } = fakeRunner((agent, args) =>
      agent === "claude" ? { found: false, exitCode: 1, stdout: "", stderr: "" } : { found: true, exitCode: args[1] === "add" ? 0 : 1, stdout: "", stderr: "" }
    );
    const value = await runInit(s.root, defaults(s, runner));
    expect((value.warnings ?? []).some((w) => w.includes(CLAUDE_ADD))).toBe(true);
    expect(value.created).toContain("codex mcp (user scope): speckiwi");
    expect(value.onboarding?.mcpConfirmed).toEqual(["codex"]);
    expect(await exists(path.join(s.root, "AGENTS.md"))).toBe(true);
    expect(await exists(path.join(s.home, ".claude", "skills", "kiwi-keep", "SKILL.md"))).toBe(true);
  });

  it("FR-NODE-223 AC-4: an `add` that exits non-zero warns with the exact command and is not reported as created", async () => {
    const s = await scenario();
    const { runner } = fakeRunner(() => ({ found: true, exitCode: 1, stdout: "", stderr: "boom" }));
    const value = await runInit(s.root, defaults(s, runner));
    const warnings = value.warnings ?? [];
    expect(warnings.some((w) => w.includes(CLAUDE_ADD))).toBe(true);
    expect(warnings.some((w) => w.includes(CODEX_ADD))).toBe(true);
    expect(value.created.some((entry) => entry.includes("user scope"))).toBe(false);
    expect(value.onboarding?.mcpConfirmed).toEqual([]);
    expect(await exists(path.join(s.root, "docs", "spec", "00.index.md"))).toBe(true);
  });
});

describe("FR-NODE-223 AC-4 — a `get` that timed out is not read as \"not registered\"", () => {
  it("FR-NODE-223 AC-4: a timed-out `get` runs no `add` and warns with the exact command", async () => {
    const s = await scenario();
    const { runner, calls } = fakeRunner((agent, args) =>
      args[1] === "get" ? { found: true, exitCode: 1, stdout: "", stderr: "", timedOut: true } : { found: true, exitCode: 0, stdout: "", stderr: "" }
    );
    const value = await runInit(s.root, defaults(s, runner));
    expect(calls).toEqual([CLAUDE_GET, CODEX_GET]);
    expect((value.warnings ?? []).some((w) => w.includes(CLAUDE_ADD) && /timed out/.test(w))).toBe(true);
    expect(value.onboarding?.mcpConfirmed).toEqual([]);
  });
});

describe("FR-NODE-223 AC-5 — project install is the 4.1.0 onboarding", () => {
  it("FR-NODE-223 AC-5: project skills, the orphan prune and .mcp.json, with no agent CLI and no global pass", async () => {
    const s = await scenario();
    const { runner, calls } = fakeRunner();
    const value = await runInit(s.root, defaults(s, runner, { projectInstall: true }));
    expect(calls).toEqual([]);
    expect(value.created).toContain(path.join(s.root, ".claude", "skills", "kiwi-keep"));
    expect(value.created).toContain(path.join(s.root, ".agents", "skills", "kiwi-keep"));
    expect(value.created).toContain(path.join(s.root, ".mcp.json"));
    expect(await exists(path.join(s.home, ".claude", "skills"))).toBe(false);
    expect(await exists(path.join(s.home, ".agents", "skills"))).toBe(false);
    expect(value.onboarding?.scope).toBe("project");
  });

  it("FR-NODE-223 AC-5: with the global option as well, the global pass runs in addition", async () => {
    const s = await scenario();
    const { runner, calls } = fakeRunner();
    const value = await runInit(s.root, defaults(s, runner, { projectInstall: true, installSkillsGlobal: true }));
    expect(calls).toEqual([]);
    expect(value.created).toContain(path.join(s.root, ".claude", "skills", "kiwi-keep"));
    expect(value.created).toContain(path.join(s.home, ".claude", "skills", "kiwi-keep"));
    expect(value.created).toContain(path.join(s.home, ".agents", "skills", "kiwi-keep"));
  });
});

describe("FR-NODE-223 AC-6 — a SpecKiwi checkout is always onboarded at project scope", () => {
  it("FR-NODE-223 AC-6: default options in a SpecKiwi checkout install project-scoped, run no agent CLI, and say so", async () => {
    const s = await scenario();
    await writeFile(path.join(s.root, "package.json"), JSON.stringify({ name: "speckiwi" }), "utf8");
    await mkdir(path.join(s.root, "bin"));
    await writeFile(path.join(s.root, "bin", "speckiwi"), "#!/usr/bin/env node\n", "utf8");
    const { runner, calls } = fakeRunner();
    const value = await runInit(s.root, defaults(s, runner));
    expect(calls).toEqual([]);
    expect(await exists(path.join(s.root, ".claude", "skills", "kiwi-keep"))).toBe(true);
    const mcp = JSON.parse(await readFile(path.join(s.root, ".mcp.json"), "utf8")) as { mcpServers: { speckiwi: { command: string } } };
    expect(mcp.mcpServers.speckiwi.command).toBe("node");
    expect(await exists(path.join(s.home, ".claude", "skills"))).toBe(false);
    expect(value.onboarding?.scope).toBe("project");
    expect(value.onboarding?.note).toMatch(/SpecKiwi checkout/);
  });
});

describe("FR-NODE-223 AC-7 — dry-run names the commands and runs none", () => {
  it("FR-NODE-223 AC-7: invokes no agent CLI, names each command it would run, and writes nothing", async () => {
    const s = await scenario();
    const { runner, calls } = fakeRunner();
    const value = await runInit(s.root, defaults(s, runner, { dryRun: true }));
    expect(calls).toEqual([]);
    expect(value.onboarding?.agentCommands).toEqual([CLAUDE_GET, CLAUDE_ADD, CODEX_GET, CODEX_ADD]);
    expect(await readdir(s.root)).toEqual([".git"]);
    expect(await exists(path.join(s.home, ".claude", "skills"))).toBe(false);
    expect(await exists(path.join(s.home, ".agents", "skills"))).toBe(false);
  });
});

describe("FR-NODE-223 AC-8 — the core reaches an agent CLI only through the injected runner", () => {
  it("FR-NODE-223 AC-8: without a runner, init spawns no agent CLI and warns with the commands to run by hand", async () => {
    const s = await scenario();
    const log = process.env.SPECKIWI_TEST_AGENT_CLI_LOG;
    const before = log ? await readFile(log, "utf8").catch(() => "") : "";
    const input = { ...defaults(s, fakeRunner().runner), agentCli: undefined };
    const value = await runInit(s.root, input);
    const after = log ? await readFile(log, "utf8").catch(() => "") : "";
    expect(after).toBe(before);
    expect((value.warnings ?? []).some((w) => w.includes(CLAUDE_ADD))).toBe(true);
    expect((value.warnings ?? []).some((w) => w.includes(CODEX_ADD))).toBe(true);
  });
});
