import { execFile } from "node:child_process";
import { access, mkdir, mkdtemp, readFile, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { describe, expect, it, vi } from "vitest";
import { initProject, resolveGlobalSkillContext } from "../../../src/core/bootstrap/init-project.js";
import type { AgentCli, AgentCliOutcome, AgentCliRunner } from "../../../src/core/bootstrap/mcp-registration.js";
import { upgradeProject } from "../../../src/core/bootstrap/upgrade-project.js";
import { resolveProjectRoot } from "../../../src/core/project-root.js";

// @req FR-NODE-224 — upgrade onboards globally and then moves the project off the copies the global
// install replaces: project kiwi skills per agent once that agent's global pass completed, and the
// `.mcp.json` speckiwi key once the Claude user-scope registration is confirmed, each against proof
// that SpecKiwi wrote it. Every case pins the home seam and injects the agent CLI runner.

const execFileAsync = promisify(execFile);

// Each case runs a full init (and upgrade); under a loaded full-suite run that outlasts the 5s default.
vi.setConfig({ testTimeout: 60_000 });

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

function fakeRunner(answer?: (agent: AgentCli, args: readonly string[]) => AgentCliOutcome) {
  const calls: string[] = [];
  const runner: AgentCliRunner = async (agent, args) => {
    calls.push([agent, ...args].join(" "));
    return answer?.(agent, args) ?? { found: true, exitCode: args[1] === "add" ? 0 : 1, stdout: "", stderr: "" };
  };
  return { runner, calls };
}

/**
 * A project as 4.1.0 left it: project skill copies for both agents and the `.mcp.json` key, written by
 * a project-scope init. `git: true` makes the project a real repository with those paths staged.
 */
async function scenario(options: { agents?: ReadonlyArray<"claude" | "codex">; git?: boolean } = {}) {
  const root = await mkdtemp(path.join(tmpdir(), "speckiwi-upg-mig-"));
  if (options.git) await execFileAsync("git", ["init", "-q", root]);
  else await mkdir(path.join(root, ".git"));
  const base = await mkdtemp(path.join(tmpdir(), "speckiwi-upg-mig-src-"));
  await writeFixtureSkill(base, "claude", "kiwi-keep");
  await writeFixtureSkill(base, "codex", "kiwi-keep");
  const projectRoot = await resolveProjectRoot(root);
  const seeded = await initProject(projectRoot, { projectInstall: true, installSkills: true, registerMcp: true, skillSourceBaseDir: base });
  if (!seeded.ok) throw new Error(seeded.error?.message);
  if (options.git) await execFileAsync("git", ["-C", root, "add", ".mcp.json", ".claude/skills", ".agents/skills"]);
  const home = await mkdtemp(path.join(tmpdir(), "speckiwi-upg-mig-home-"));
  for (const agent of options.agents ?? ["claude", "codex"]) await mkdir(path.join(home, `.${agent}`));
  return {
    root,
    base,
    home,
    claudeCopy: path.join(root, ".claude", "skills", "kiwi-keep"),
    codexCopy: path.join(root, ".agents", "skills", "kiwi-keep"),
    mcpJson: path.join(root, ".mcp.json")
  };
}

type UpgradeInput = Parameters<typeof upgradeProject>[1];

function seam(s: { base: string; home: string }, runner: AgentCliRunner, extra: Partial<UpgradeInput> = {}): UpgradeInput {
  return { apply: true, agentCli: runner, globalHomeDir: s.home, globalCodexHome: path.join(s.home, ".codex"), skillSourceBaseDir: s.base, ...extra };
}

async function runUpgrade(root: string, input: UpgradeInput) {
  const result = await upgradeProject(await resolveProjectRoot(root), input);
  if (!result.ok || result.value === undefined) throw new Error(result.error?.message ?? "expected an ok result with a value");
  return result.value;
}

async function mcpServers(file: string): Promise<Record<string, unknown>> {
  return (JSON.parse(await readFile(file, "utf8")) as { mcpServers: Record<string, unknown> }).mcpServers;
}

describe("FR-NODE-224 AC-1 — an agent whose global pass completed loses its project copies", () => {
  it("FR-NODE-224 AC-1: removes both agents' proven project copies and lists each under removed", async () => {
    const s = await scenario();
    const value = await runUpgrade(s.root, seam(s, fakeRunner().runner));
    expect(await exists(path.join(s.home, ".claude", "skills", "kiwi-keep", "SKILL.md"))).toBe(true);
    expect(await exists(s.claudeCopy)).toBe(false);
    expect(await exists(s.codexCopy)).toBe(false);
    expect(value.removed).toContain(s.claudeCopy);
    expect(value.removed).toContain(s.codexCopy);
  });

  it("FR-NODE-224 AC-1: a project copy the global pass installed no counterpart for is kept", async () => {
    const s = await scenario();
    // The release this upgrade ships no longer carries the Codex skill: the global pass completes with
    // nothing installed for Codex, so removing the project copy would leave Codex with no copy at all.
    const { rm } = await import("node:fs/promises");
    await rm(path.join(s.base, "codex", "kiwi-keep"), { recursive: true, force: true });
    const value = await runUpgrade(s.root, seam(s, fakeRunner().runner));
    expect(await exists(path.join(s.codexCopy, "SKILL.md"))).toBe(true);
    expect(value.removed).not.toContain(s.codexCopy);
    expect(value.removed).toContain(s.claudeCopy);
  });

  it("FR-NODE-224 AC-1: refuses the migration when the project skill directory is the global one (FR-NODE-192 guard)", async () => {
    const s = await scenario();
    // The project root doubles as the home: its .claude/skills IS the global Claude destination.
    const value = await runUpgrade(s.root, seam(s, fakeRunner().runner, { globalHomeDir: s.root, globalCodexHome: path.join(s.root, ".codex") }));
    expect(await exists(path.join(s.claudeCopy, "SKILL.md"))).toBe(true);
    expect(value.removed.filter((entry) => entry.includes("skills"))).toEqual([]);
    expect(value.warnings.some((w) => /global skill directory/i.test(w))).toBe(true);
  });

  it("FR-NODE-228 AC-7: a project whose .agents is the home's .agents keeps its Codex copies, which are the global ones", async (ctx) => {
    // Only the Codex destination is shared — `<root>/.agents` links to `<home>/.agents` and `.claude` does
    // not — so this passes only if the guard compares the Codex destinations themselves.
    const home = await mkdtemp(path.join(tmpdir(), "speckiwi-upg-mig-cxhome-"));
    for (const dir of [".agents", ".claude", ".codex"]) await mkdir(path.join(home, dir), { recursive: true });
    const root = await mkdtemp(path.join(tmpdir(), "speckiwi-upg-mig-cxroot-"));
    await mkdir(path.join(root, ".git"));
    const linked = await symlink(path.join(home, ".agents"), path.join(root, ".agents"), process.platform === "win32" ? "junction" : "dir").then(() => true, () => false);
    if (!linked) ctx.skip();
    const base = await mkdtemp(path.join(tmpdir(), "speckiwi-upg-mig-cxsrc-"));
    await writeFixtureSkill(base, "claude", "kiwi-keep");
    await writeFixtureSkill(base, "codex", "kiwi-keep");
    const seeded = await initProject(await resolveProjectRoot(root), { projectInstall: true, installSkills: true, registerMcp: true, skillSourceBaseDir: base });
    expect(seeded.ok).toBe(true);
    const codexCopy = path.join(root, ".agents", "skills", "kiwi-keep");

    const value = await runUpgrade(root, seam({ base, home }, fakeRunner().runner));

    expect(await exists(path.join(codexCopy, "SKILL.md"))).toBe(true);
    expect(value.removed).not.toContain(codexCopy);
    expect(value.warnings.some((w) => /codex/.test(w) && /global skill directory/i.test(w))).toBe(true);
  });
});

describe("FR-NODE-224 AC-2 — an agent whose global pass did not complete keeps every project copy", () => {
  it("FR-NODE-224 AC-2: an absent agent home keeps that agent's copies with a warning naming why", async () => {
    const s = await scenario({ agents: ["claude"] });
    const value = await runUpgrade(s.root, seam(s, fakeRunner().runner));
    expect(await exists(s.claudeCopy)).toBe(false);
    expect(await exists(path.join(s.codexCopy, "SKILL.md"))).toBe(true);
    expect(value.warnings.some((w) => /codex/.test(w) && /home directory not found/.test(w))).toBe(true);
  });

  it("FR-NODE-224 AC-2: a conflicting global install keeps that agent's copies with a warning naming why", async () => {
    const s = await scenario();
    const foreign = path.join(s.home, ".claude", "skills", "kiwi-keep");
    await mkdir(foreign, { recursive: true });
    await writeFile(path.join(foreign, "notes.txt"), "not a speckiwi install\n", "utf8");
    const value = await runUpgrade(s.root, seam(s, fakeRunner().runner));
    expect(await exists(path.join(s.claudeCopy, "SKILL.md"))).toBe(true);
    expect(await exists(s.codexCopy)).toBe(false);
    expect(value.warnings.some((w) => /claude/.test(w) && /conflict/.test(w))).toBe(true);
  });
});

describe("FR-NODE-224 AC-3 — a copy that fails the proof is kept and the run succeeds", () => {
  it("FR-NODE-224 AC-3: an edited copy and a copy without install metadata are kept with warnings", async () => {
    const s = await scenario();
    await writeFile(path.join(s.claudeCopy, "SKILL.md"), "edited by hand\n", "utf8");
    const { rm } = await import("node:fs/promises");
    await rm(path.join(s.codexCopy, ".speckiwi-skill-install.json"));
    const value = await runUpgrade(s.root, seam(s, fakeRunner().runner));
    expect(await exists(path.join(s.claudeCopy, "SKILL.md"))).toBe(true);
    expect(await exists(path.join(s.codexCopy, "SKILL.md"))).toBe(true);
    expect(value.removed).not.toContain(s.claudeCopy);
    expect(value.removed).not.toContain(s.codexCopy);
    expect(value.warnings.some((w) => w.includes(s.claudeCopy))).toBe(true);
    expect(value.warnings.some((w) => w.includes(s.codexCopy))).toBe(true);
  });
});

describe("FR-NODE-224 AC-4 — the .mcp.json key goes only after a confirmed registration, and only if it is ours", () => {
  it("FR-NODE-224 AC-4: a confirmed registration removes our key and leaves every other key and the file", async () => {
    const s = await scenario();
    const before = JSON.parse(await readFile(s.mcpJson, "utf8")) as Record<string, unknown>;
    await writeFile(s.mcpJson, JSON.stringify({ ...before, extra: 1, mcpServers: { ...(before.mcpServers as object), other: { command: "x" } } }), "utf8");
    const value = await runUpgrade(s.root, seam(s, fakeRunner(() => ({ found: true, exitCode: 0, stdout: "", stderr: "" })).runner));
    const after = JSON.parse(await readFile(s.mcpJson, "utf8")) as { extra: number; mcpServers: Record<string, unknown> };
    expect(after.mcpServers).toEqual({ other: { command: "x" } });
    expect(after.extra).toBe(1);
    expect(value.removed).toContain(`${s.mcpJson}#mcpServers.speckiwi`);
  });

  it("FR-NODE-224 AC-4: a key whose value differs from the launcher SpecKiwi writes is kept with a warning", async () => {
    const s = await scenario();
    const custom = { command: "npx", args: ["-y", "speckiwi", "mcp"], env: { DEBUG: "1" } };
    await writeFile(s.mcpJson, JSON.stringify({ mcpServers: { speckiwi: custom } }), "utf8");
    const value = await runUpgrade(s.root, seam(s, fakeRunner().runner));
    expect((await mcpServers(s.mcpJson)).speckiwi).toEqual(custom);
    expect(value.warnings.some((w) => w.includes(".mcp.json") && /kept/i.test(w))).toBe(true);
  });

  it("FR-NODE-224 AC-4: a .mcp.json that cannot be written keeps the key with a warning, and the removals already made stay reported", async () => {
    const s = await scenario();
    // A directory where the atomic write puts its temp file makes the write fail on every platform; a
    // read-only `.mcp.json` would not on POSIX, where the rename needs only the directory writable.
    await mkdir(`${s.mcpJson}.speckiwi-tmp`);
    const value = await runUpgrade(s.root, seam(s, fakeRunner().runner));
    expect(value.removed).toContain(s.claudeCopy);
    expect(value.removed.some((entry) => entry.includes(".mcp.json"))).toBe(false);
    expect(value.warnings.some((w) => w.includes(s.mcpJson))).toBe(true);
    expect(await mcpServers(s.mcpJson)).toHaveProperty("speckiwi");
  });

  it("FR-NODE-224 AC-4: an unreadable .mcp.json is left alone with a warning", async () => {
    const s = await scenario();
    await writeFile(s.mcpJson, "{ not json", "utf8");
    const value = await runUpgrade(s.root, seam(s, fakeRunner().runner));
    expect(await readFile(s.mcpJson, "utf8")).toBe("{ not json");
    expect(value.warnings.some((w) => w.includes(s.mcpJson))).toBe(true);
  });

  it("FR-NODE-224 AC-4: without a confirmed Claude registration the key is kept", async () => {
    const s = await scenario();
    const notFound = fakeRunner((agent, args) =>
      agent === "claude" ? { found: false, exitCode: 1, stdout: "", stderr: "" } : { found: true, exitCode: args[1] === "add" ? 0 : 1, stdout: "", stderr: "" }
    );
    const value = await runUpgrade(s.root, seam(s, notFound.runner));
    expect(await mcpServers(s.mcpJson)).toHaveProperty("speckiwi");
    expect(value.removed.some((entry) => entry.includes(".mcp.json"))).toBe(false);
  });
});

describe("FR-NODE-224 AC-5 — removing tracked paths warns about committing and collaborators", () => {
  it("FR-NODE-224 AC-5: a removed path tracked by git produces the commit-and-collaborators warning", async () => {
    const s = await scenario({ git: true });
    const value = await runUpgrade(s.root, seam(s, fakeRunner().runner));
    expect(value.removed).toContain(s.claudeCopy);
    const warning = value.warnings.find((w) => /tracked by git/i.test(w));
    expect(warning).toBeDefined();
    expect(warning).toMatch(/commit/i);
    expect(warning).toContain("speckiwi init");
  });

  it("FR-NODE-224 AC-5: an untracked removal gives no such warning", async () => {
    const s = await scenario();
    const value = await runUpgrade(s.root, seam(s, fakeRunner().runner));
    expect(value.removed.length).toBeGreaterThan(0);
    expect(value.warnings.some((w) => /tracked by git/i.test(w))).toBe(false);
  });
});

describe("FR-NODE-224 AC-6 — project install and a SpecKiwi checkout keep the 4.1.0 refresh", () => {
  it("FR-NODE-224 AC-6: project install refreshes the copies, runs no agent CLI and removes nothing", async () => {
    const s = await scenario();
    const { runner, calls } = fakeRunner();
    const value = await runUpgrade(s.root, seam(s, runner, { projectInstall: true }));
    expect(calls).toEqual([]);
    expect(value.removed).toEqual([]);
    expect(value.init.skipped).toContain(s.claudeCopy);
    expect(await mcpServers(s.mcpJson)).toHaveProperty("speckiwi");
  });

  it("FR-NODE-224 AC-6: a SpecKiwi checkout refreshes the copies and removes nothing", async () => {
    const s = await scenario();
    await writeFile(path.join(s.root, "package.json"), JSON.stringify({ name: "speckiwi" }), "utf8");
    await mkdir(path.join(s.root, "bin"));
    await writeFile(path.join(s.root, "bin", "speckiwi"), "#!/usr/bin/env node\n", "utf8");
    const { runner, calls } = fakeRunner();
    const value = await runUpgrade(s.root, seam(s, runner));
    expect(calls).toEqual([]);
    expect(value.removed).toEqual([]);
    expect(await exists(path.join(s.claudeCopy, "SKILL.md"))).toBe(true);
  });
});

describe("FR-NODE-224 AC-7 — dry-run lists what the migration would remove", () => {
  it("FR-NODE-224 AC-7: lists the copies and the key, runs no agent CLI and writes nothing", async () => {
    const s = await scenario();
    const mcpBefore = await readFile(s.mcpJson, "utf8");
    const { runner, calls } = fakeRunner();
    const value = await runUpgrade(s.root, seam(s, runner, { apply: false }));
    expect(calls).toEqual([]);
    expect(value.applied).toBe(false);
    expect(value.removed).toContain(s.claudeCopy);
    expect(value.removed).toContain(s.codexCopy);
    expect(value.removed).toContain(`${s.mcpJson}#mcpServers.speckiwi`);
    expect(await exists(path.join(s.claudeCopy, "SKILL.md"))).toBe(true);
    expect(await readFile(s.mcpJson, "utf8")).toBe(mcpBefore);
    expect(await exists(path.join(s.home, ".claude", "skills"))).toBe(false);
  });
});

describe("FR-NODE-224 AC-8 — a Claude config dir away from the home keeps the Claude copies", () => {
  it("FR-NODE-224 AC-8: CLAUDE_CONFIG_DIR elsewhere keeps every Claude copy and names both directories", async () => {
    const s = await scenario();
    const configDir = path.join(s.home, "elsewhere");
    const value = await runUpgrade(s.root, seam(s, fakeRunner().runner, { globalClaudeConfigDir: configDir }));
    expect(await exists(path.join(s.claudeCopy, "SKILL.md"))).toBe(true);
    expect(value.removed).not.toContain(s.claudeCopy);
    expect(await exists(s.codexCopy)).toBe(false);
    const warning = value.warnings.find((w) => /claude/.test(w) && /CLAUDE_CONFIG_DIR/.test(w)) ?? "";
    expect(warning).toContain(configDir);
    expect(warning).toContain(path.join(s.home, ".claude"));
  });

  it("FR-NODE-224 AC-8: CLAUDE_CONFIG_DIR at the home's .claude directory changes nothing", async () => {
    const s = await scenario();
    const value = await runUpgrade(s.root, seam(s, fakeRunner().runner, { globalClaudeConfigDir: path.join(s.home, ".claude") }));
    expect(await exists(s.claudeCopy)).toBe(false);
    expect(value.removed).toContain(s.claudeCopy);
  });

  it.runIf(process.platform === "win32")("FR-NODE-224 AC-8: on Windows a case-only difference is the same directory", async () => {
    const s = await scenario();
    const value = await runUpgrade(s.root, seam(s, fakeRunner().runner, { globalClaudeConfigDir: path.join(s.home, ".claude").toUpperCase() }));
    expect(value.removed).toContain(s.claudeCopy);
  });

  it("FR-NODE-224 AC-8: without a home seam the process CLAUDE_CONFIG_DIR is read; a caller naming the home names it too", () => {
    vi.stubEnv("CLAUDE_CONFIG_DIR", "/somewhere/claude-config");
    try {
      expect(resolveGlobalSkillContext({}).claudeConfigDir).toBe("/somewhere/claude-config");
      expect(resolveGlobalSkillContext({ globalHomeDir: "/home/x" }).claudeConfigDir).toBeUndefined();
      expect(resolveGlobalSkillContext({ globalHomeDir: "/home/x", globalClaudeConfigDir: "/c" }).claudeConfigDir).toBe("/c");
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
