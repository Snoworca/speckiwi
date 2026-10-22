import { access, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { main } from "../../src/cli/index.js";
import { installSkill } from "../../src/core/skills/install-skill.js";

// @req IR-CLI-070 — speckiwi init CLI onboarding flags (--no-skills / --no-mcp / --dry-run) and unified report.

function io() {
  return { stdout: new PassThrough(), stderr: new PassThrough() };
}

async function emptyRepo(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "speckiwi-init-cli-"));
  await mkdir(path.join(root, ".git"));
  return root;
}

async function exists(target: string): Promise<boolean> {
  return access(target).then(() => true).catch(() => false);
}

function readJson(stream: PassThrough): { ok: boolean; value: { created: string[]; updated: string[]; skipped: string[]; removed: string[]; warnings?: string[] } } {
  return JSON.parse(stream.read()?.toString() ?? "");
}

const claudeSkillsDir = path.join(".claude", "skills");

describe("speckiwi init CLI onboarding (IR-CLI-070)", () => {
  it("IR-CLI-070 AC-1: init with no flags scaffolds, upserts agent files, installs hooks, and onboards at user and global scope", async () => {
    const root = await emptyRepo();
    // A home of its own with a Claude home in it, so the global pass has a destination; the agent CLIs
    // reached are the sandbox fakes on PATH (test/support/agent-cli-sandbox.ts).
    const home = await mkdtemp(path.join(tmpdir(), "speckiwi-init-cli-home-"));
    await mkdir(path.join(home, ".claude"));
    const previous = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE };
    process.env.HOME = home;
    process.env.USERPROFILE = home;
    const streams = io();
    let code: number;
    try {
      code = await main(["--root", root, "init", "--json"], streams);
    } finally {
      process.env.HOME = previous.HOME;
      process.env.USERPROFILE = previous.USERPROFILE;
    }
    expect(code).toBe(0);
    const parsed = readJson(streams.stdout);
    expect(parsed.ok).toBe(true);
    expect(await exists(path.join(root, "docs", "spec", "00.index.md"))).toBe(true);
    expect(await exists(path.join(root, "AGENTS.md"))).toBe(true);
    expect(await exists(path.join(root, ".claude", "settings.json"))).toBe(true);
    // MCP registration at user scope through the agent CLI (the sandbox fake), not .mcp.json.
    expect(parsed.value.created).toContain("claude mcp (user scope): speckiwi");
    expect(await exists(path.join(root, ".mcp.json"))).toBe(false);
    // Skills at the global destination, not the project.
    expect(parsed.value.created.some((entry) => entry.startsWith(path.join(home, ".claude", "skills")))).toBe(true);
    expect(await exists(path.join(root, claudeSkillsDir))).toBe(false);
  }, 120000);

  it("IR-CLI-070 AC-1: with --project-install, MCP goes to .mcp.json and skills are project-scoped, including the orphan prune", async () => {
    const root = await emptyRepo();
    // A managed skill from an earlier install that the bundled set no longer carries: the prune's candidate.
    const orphanSource = await mkdtemp(path.join(tmpdir(), "speckiwi-init-cli-orphan-"));
    await mkdir(path.join(orphanSource, "claude", "kiwi-gone"), { recursive: true });
    await writeFile(path.join(orphanSource, "claude", "kiwi-gone", "SKILL.md"), "---\nname: kiwi-gone\ndescription: gone\n---\n# gone\n", "utf8");
    const seeded = await installSkill({ projectRoot: { root }, agent: "claude", selector: "all", scope: "project", sourceBaseDir: orphanSource });
    expect(seeded.ok).toBe(true);
    const streams = io();
    const code = await main(["--root", root, "init", "--project-install", "--json"], streams);
    expect(code).toBe(0);
    const parsed = readJson(streams.stdout);
    expect(parsed.value.created).toContain(path.join(root, ".mcp.json"));
    expect(parsed.value.created.some((entry) => entry.startsWith(path.join(root, claudeSkillsDir)))).toBe(true);
    expect(parsed.value.removed).toContain(path.join(root, claudeSkillsDir, "kiwi-gone"));
    expect(await exists(path.join(root, claudeSkillsDir, "kiwi-gone"))).toBe(false);
  }, 120000);

  it("AC-2: --no-skills and --no-mcp opt out of those steps while still scaffolding the SRS", async () => {
    const root = await emptyRepo();
    const streams = io();
    const code = await main(["--root", root, "init", "--no-skills", "--no-mcp", "--json"], streams);
    expect(code).toBe(0);
    expect(await exists(path.join(root, ".mcp.json"))).toBe(false);
    expect(await exists(path.join(root, ".claude", "skills"))).toBe(false);
    // The SRS scaffold and agent files still run.
    expect(await exists(path.join(root, "docs", "spec", "00.index.md"))).toBe(true);
    expect(await exists(path.join(root, "AGENTS.md"))).toBe(true);
  });

  it("AC-3: --dry-run writes nothing to the filesystem", async () => {
    const root = await emptyRepo();
    const streams = io();
    const code = await main(["--root", root, "init", "--no-skills", "--no-mcp", "--dry-run", "--json"], streams);
    expect(code).toBe(0);
    expect(await exists(path.join(root, "docs", "spec", "00.index.md"))).toBe(false);
    expect(await exists(path.join(root, "AGENTS.md"))).toBe(false);
    const parsed = readJson(streams.stdout);
    expect(parsed.value.created.length).toBeGreaterThan(0);
  });

  it("AC-4: --json output includes created/updated/skipped/removed/warnings arrays", async () => {
    const root = await emptyRepo();
    const streams = io();
    await main(["--root", root, "init", "--no-skills", "--no-mcp", "--json"], streams);
    const parsed = readJson(streams.stdout);
    expect(Array.isArray(parsed.value.created)).toBe(true);
    expect(Array.isArray(parsed.value.updated)).toBe(true);
    expect(Array.isArray(parsed.value.skipped)).toBe(true);
    expect(Array.isArray(parsed.value.removed)).toBe(true);
  });

  it("AC-6: exits 0 on success and 2 on a usage error such as an unknown flag", async () => {
    const root = await emptyRepo();
    const okStreams = io();
    expect(await main(["--root", root, "init", "--no-skills", "--no-mcp", "--json"], okStreams)).toBe(0);
    const badStreams = io();
    expect(await main(["--root", root, "init", "--totally-unknown-flag"], badStreams)).toBe(2);
  });

  it("AC-6: exits 5 when init fails (a held SRS mutation lock denies the operation)", async () => {
    const root = await emptyRepo();
    await mkdir(path.join(root, "kiwi"), { recursive: true });
    await writeFile(
      path.join(root, "kiwi", ".srs.lock"),
      `${JSON.stringify(
        {
          schemaVersion: "1.0.0",
          owner: "other-session",
          operation: "update_status",
          requestId: "held-lock",
          acquiredAt: new Date(0).toISOString(),
          expiresAt: new Date(4102444800000).toISOString()
        },
        null,
        2
      )}\n`,
      "utf8"
    );
    const streams = io();
    expect(await main(["--root", root, "init", "--no-skills", "--no-mcp", "--json"], streams)).toBe(5);
  });
});
