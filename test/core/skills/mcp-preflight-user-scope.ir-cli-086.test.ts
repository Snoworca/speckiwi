import { mkdir, mkdtemp, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { planSkillInstall } from "../../../src/core/skills/install-skill.js";
import type { SkillAgent, SkillInstallOptions } from "../../../src/core/skills/types.js";

// @req IR-CLI-086 AC-6 — since 4.1.1 `speckiwi init` registers the server at user scope, so a preflight that
// reads only the project `.mcp.json` reports `missing` for every project onboarded the default way.
// Every home and config directory below is a fresh temp directory handed in through the options.

async function fixture(agent: SkillAgent): Promise<{ root: string; home: string }> {
  const root = await mkdtemp(path.join(tmpdir(), "speckiwi-preflight-"));
  const home = path.join(root, "home");
  await mkdir(home, { recursive: true });
  const dir = path.join(root, "skills", agent, "kiwi-pm");
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, "SKILL.md"), ["---", "name: kiwi-pm", "description: kiwi-pm test skill", "---", "", "# body", ""].join("\n"), "utf8");
  return { root, home };
}

function options(root: string, home: string, agent: SkillAgent, env: Record<string, string | undefined> = {}): SkillInstallOptions {
  return { projectRoot: { root }, sourceBaseDir: path.join(root, "skills"), homeDir: home, env, agent, selector: "kiwi-pm", scope: "project", dryRun: true };
}

async function preflight(opts: SkillInstallOptions) {
  const planned = await planSkillInstall(opts);
  if (!planned.ok) throw new Error(planned.error.message);
  return planned.value.mcpPreflight;
}

describe("IR-CLI-086 AC-6 — the MCP preflight reads the user-scope registration", () => {
  it("IR-CLI-086 AC-6: claude — a top-level mcpServers.speckiwi in <home>/.claude.json is satisfied", async () => {
    const { root, home } = await fixture("claude");
    await writeFile(path.join(home, ".claude.json"), JSON.stringify({ mcpServers: { speckiwi: { command: "npx", args: ["-y", "speckiwi", "mcp"] } } }), "utf8");
    expect((await preflight(options(root, home, "claude"))).status).toBe("satisfied");
  });

  it("IR-CLI-086 AC-6: claude — a .claude.json saved with a UTF-8 byte order mark is still read", async () => {
    const { root, home } = await fixture("claude");
    const json = JSON.stringify({ mcpServers: { speckiwi: {} } });
    await writeFile(path.join(home, ".claude.json"), String.fromCharCode(0xfeff) + json, "utf8");
    expect((await preflight(options(root, home, "claude"))).status).toBe("satisfied");
  });

  it("IR-CLI-086 AC-6: claude — CLAUDE_CONFIG_DIR moves the file the preflight reads", async () => {
    const { root, home } = await fixture("claude");
    const configDir = path.join(root, "claude-config");
    await mkdir(configDir, { recursive: true });
    await writeFile(path.join(configDir, ".claude.json"), JSON.stringify({ mcpServers: { speckiwi: {} } }), "utf8");
    expect((await preflight(options(root, home, "claude", { CLAUDE_CONFIG_DIR: configDir }))).status).toBe("satisfied");
    // The same registration in the home the config dir replaced is not read.
    await writeFile(path.join(home, ".claude.json"), JSON.stringify({ mcpServers: { speckiwi: {} } }), "utf8");
    expect((await preflight(options(root, home, "claude", { CLAUDE_CONFIG_DIR: path.join(root, "empty-config") }))).status).toBe("missing");
  });

  it("IR-CLI-086 AC-6: claude — a speckiwi entry only under projects[<path>] (local scope) is not the user registration", async () => {
    const { root, home } = await fixture("claude");
    await writeFile(path.join(home, ".claude.json"), JSON.stringify({ mcpServers: {}, projects: { [root]: { mcpServers: { speckiwi: {} } } } }), "utf8");
    expect((await preflight(options(root, home, "claude"))).status).toBe("missing");
  });

  it("IR-CLI-086 AC-6: codex — an [mcp_servers.speckiwi] table, bare or quoted, in config.toml is satisfied", async () => {
    for (const header of ["[mcp_servers.speckiwi]", '[mcp_servers."speckiwi"]']) {
      const { root, home } = await fixture("codex");
      await mkdir(path.join(home, ".codex"), { recursive: true });
      await writeFile(path.join(home, ".codex", "config.toml"), `model = "x"\n\n${header}\ncommand = "npx"\nargs = ["-y", "speckiwi", "mcp"]\n`, "utf8");
      expect((await preflight(options(root, home, "codex"))).status, header).toBe("satisfied");
    }
  });

  it("IR-CLI-086 AC-6: codex — CODEX_HOME moves the config the preflight reads, and another server is not speckiwi", async () => {
    const { root, home } = await fixture("codex");
    const codexHome = path.join(root, "codex-home");
    await mkdir(codexHome, { recursive: true });
    await writeFile(path.join(codexHome, "config.toml"), "[mcp_servers.speckiwi]\ncommand = \"npx\"\n", "utf8");
    expect((await preflight(options(root, home, "codex", { CODEX_HOME: codexHome }))).status).toBe("satisfied");

    await writeFile(path.join(codexHome, "config.toml"), "[mcp_servers.speckiwi-other]\ncommand = \"npx\"\n# [mcp_servers.speckiwi]\n", "utf8");
    expect((await preflight(options(root, home, "codex", { CODEX_HOME: codexHome }))).status).toBe("missing");
  });

  it("IR-CLI-086 AC-6: missing when neither registers speckiwi, the remediation names speckiwi init, and nothing is written", async () => {
    const { root, home } = await fixture("claude");
    await writeFile(path.join(home, ".claude.json"), JSON.stringify({ mcpServers: { other: {} } }), "utf8");
    const before = (await readdir(home)).sort();
    const result = await preflight(options(root, home, "claude"));
    expect(result.status).toBe("missing");
    expect(result.remediation).toContain("speckiwi init");
    expect((await readdir(home)).sort()).toEqual(before);
  });

  it("IR-CLI-086 AC-6: the project .mcp.json alone still satisfies it", async () => {
    const { root, home } = await fixture("codex");
    await writeFile(path.join(root, ".mcp.json"), JSON.stringify({ mcpServers: { speckiwi: {} } }), "utf8");
    expect((await preflight(options(root, home, "codex"))).status).toBe("satisfied");
  });
});
