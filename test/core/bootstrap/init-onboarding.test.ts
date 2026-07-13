import { access, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { initProject } from "../../../src/core/bootstrap/init-project.js";
import { installSkill } from "../../../src/core/skills/install-skill.js";
import { resolveProjectRoot } from "../../../src/core/project-root.js";

// @req FR-NODE-068 — speckiwi init project skill provisioning (Claude + Codex, reuse installer).
// @req FR-NODE-070 — speckiwi init unified dry-run preview and created/updated/skipped/removed/warnings envelope.

async function emptyRepo(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "speckiwi-init-onb-"));
  await mkdir(path.join(root, ".git"));
  return root;
}

async function writeFixtureSkill(base: string, subdir: "claude" | "codex", name: string): Promise<void> {
  const dir = path.join(base, subdir, name);
  await mkdir(path.join(dir, "references"), { recursive: true });
  await writeFile(
    path.join(dir, "SKILL.md"),
    ["---", `name: ${name}`, "description: test skill", "---", "", `# ${name}`, "", "Normal operation requires speckiwi mcp."].join("\n"),
    "utf8"
  );
  await writeFile(path.join(dir, "references", "guide.md"), "guide\n", "utf8");
}

async function fixtureSource(base: string): Promise<void> {
  await writeFixtureSkill(base, "claude", "kiwi-keep");
  await writeFixtureSkill(base, "codex", "kiwi-keep");
}

async function exists(target: string): Promise<boolean> {
  return access(target).then(() => true).catch(() => false);
}

async function runInit(root: string, input: Parameters<typeof initProject>[1]) {
  const result = await initProject(await resolveProjectRoot(root), input);
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}

describe("speckiwi init skill provisioning (FR-NODE-068)", () => {
  it("AC-1: installs bundled kiwi skills into .claude/skills and .agents/skills", async () => {
    const root = await emptyRepo();
    const base = path.join(root, "skills");
    await fixtureSource(base);
    const value = await runInit(root, { installSkills: true, skillSourceBaseDir: base });
    const claudeDest = path.join(root, ".claude", "skills", "kiwi-keep");
    const codexDest = path.join(root, ".agents", "skills", "kiwi-keep");
    expect(await exists(path.join(claudeDest, "SKILL.md"))).toBe(true);
    expect(await exists(path.join(codexDest, "SKILL.md"))).toBe(true);
    expect(value.created).toContain(claudeDest);
    expect(value.created).toContain(codexDest);
  });

  it("AC-2: re-running init reports unchanged skills as skipped (idempotent)", async () => {
    const root = await emptyRepo();
    const base = path.join(root, "skills");
    await fixtureSource(base);
    await runInit(root, { installSkills: true, skillSourceBaseDir: base });
    const second = await runInit(root, { installSkills: true, skillSourceBaseDir: base });
    const claudeDest = path.join(root, ".claude", "skills", "kiwi-keep");
    expect(second.skipped).toContain(claudeDest);
    expect(second.created).not.toContain(claudeDest);
    expect(second.updated).not.toContain(claudeDest);
  });

  it("AC-3: a conflicting skill destination is reported as a warning without aborting init", async () => {
    const root = await emptyRepo();
    const base = path.join(root, "skills");
    await fixtureSource(base);
    // Pre-occupy the claude destination slot with a foreign directory that has no valid skill
    // entrypoint -> the installer classifies it as a conflict and makes no changes.
    const claudeDest = path.join(root, ".claude", "skills", "kiwi-keep");
    await mkdir(claudeDest, { recursive: true });
    await writeFile(path.join(claudeDest, "notes.txt"), "foreign directory\n", "utf8");
    const value = await runInit(root, { installSkills: true, skillSourceBaseDir: base });
    // init still succeeds and still scaffolds the agent files.
    expect(await exists(path.join(root, "AGENTS.md"))).toBe(true);
    expect((value.warnings ?? []).some((w) => /conflict/i.test(w))).toBe(true);
  });

  it("AC-4: a missing bundled skill source root warns and does not abort init", async () => {
    const root = await emptyRepo();
    const emptyBase = path.join(root, "no-skills-here");
    await mkdir(emptyBase, { recursive: true });
    const value = await runInit(root, { installSkills: true, skillSourceBaseDir: emptyBase });
    expect(await exists(path.join(root, "AGENTS.md"))).toBe(true);
    expect((value.warnings ?? []).some((w) => /skills\((claude|codex)\)/.test(w))).toBe(true);
  });

  it("AC-5: skills are provisioned at project scope, never the global home skills dir", async () => {
    const root = await emptyRepo();
    const base = path.join(root, "skills");
    await fixtureSource(base);
    await runInit(root, { installSkills: true, skillSourceBaseDir: base });
    expect(await exists(path.join(root, ".claude", "skills", "kiwi-keep"))).toBe(true);
    expect(await exists(path.join(root, ".agents", "skills", "kiwi-keep"))).toBe(true);
  });

  it("does not provision skills when installSkills is not requested (MCP init_project parity)", async () => {
    const root = await emptyRepo();
    const base = path.join(root, "skills");
    await fixtureSource(base);
    await runInit(root, { skillSourceBaseDir: base });
    expect(await exists(path.join(root, ".claude", "skills", "kiwi-keep"))).toBe(false);
    expect(await exists(path.join(root, ".mcp.json"))).toBe(false);
  });
});

describe("speckiwi init dry-run + reporting envelope (FR-NODE-070)", () => {
  it("AC-1: dry-run writes nothing across scaffold, agent files, hooks, MCP, and skills", async () => {
    const root = await emptyRepo();
    const base = path.join(root, "skills");
    await fixtureSource(base);
    const value = await runInit(root, { installSkills: true, registerMcp: true, dryRun: true, skillSourceBaseDir: base });
    expect(await exists(path.join(root, "docs", "spec", "00.index.md"))).toBe(false);
    expect(await exists(path.join(root, "AGENTS.md"))).toBe(false);
    expect(await exists(path.join(root, ".mcp.json"))).toBe(false);
    expect(await exists(path.join(root, ".claude", "skills", "kiwi-keep"))).toBe(false);
    // Hooks and docs/.kiwi scaffold are also not written in dry-run.
    expect(await exists(path.join(root, ".claude", "settings.json"))).toBe(false);
    expect(await exists(path.join(root, ".git", "hooks", "pre-commit"))).toBe(false);
    expect(await exists(path.join(root, "docs", ".kiwi"))).toBe(false);
    // The plan is still populated.
    expect(value.created.length).toBeGreaterThan(0);
  });

  it("AC-2: the envelope includes a removed array populated by the orphan prune", async () => {
    const root = await emptyRepo();
    // Pre-install a managed orphan kiwi-gone at the claude destination from a throwaway source.
    const orphanBase = path.join(root, "orphan-src");
    await writeFixtureSkill(orphanBase, "claude", "kiwi-gone");
    const installed = await installSkill({ projectRoot: { root }, agent: "claude", selector: "all", scope: "project", sourceBaseDir: orphanBase, dryRun: false });
    if (!installed.ok) throw new Error(installed.error.message);
    // Now init with a source that does NOT contain kiwi-gone -> it becomes an orphan and is pruned.
    const base = path.join(root, "skills");
    await fixtureSource(base);
    const value = await runInit(root, { installSkills: true, skillSourceBaseDir: base });
    expect(value.removed).toContain(path.join(root, ".claude", "skills", "kiwi-gone"));
    expect(await exists(path.join(root, ".claude", "skills", "kiwi-gone"))).toBe(false);
  });

  it("AC-4: a second init run yields empty removed and reports MCP + skills as skipped", async () => {
    const root = await emptyRepo();
    const base = path.join(root, "skills");
    await fixtureSource(base);
    await runInit(root, { installSkills: true, registerMcp: true, skillSourceBaseDir: base });
    const second = await runInit(root, { installSkills: true, registerMcp: true, skillSourceBaseDir: base });
    expect(second.removed).toEqual([]);
    expect(second.skipped).toContain(path.join(root, ".mcp.json"));
    expect(second.skipped).toContain(path.join(root, ".claude", "skills", "kiwi-keep"));
    expect(second.created).not.toContain(path.join(root, ".mcp.json"));
  });

  it("AC-5: dry-run output exposes the same envelope fields as a real run", async () => {
    const root = await emptyRepo();
    const base = path.join(root, "skills");
    await fixtureSource(base);
    const value = await runInit(root, { installSkills: true, registerMcp: true, dryRun: true, skillSourceBaseDir: base });
    expect(Array.isArray(value.created)).toBe(true);
    expect(Array.isArray(value.updated)).toBe(true);
    expect(Array.isArray(value.skipped)).toBe(true);
    expect(Array.isArray(value.removed)).toBe(true);
    expect(Array.isArray(value.warnings)).toBe(true);
  });

  it("AC-3: init leaves no stray SRS lock after the new steps run under the lock", async () => {
    const root = await emptyRepo();
    const base = path.join(root, "skills");
    await fixtureSource(base);
    await runInit(root, { installSkills: true, registerMcp: true, skillSourceBaseDir: base });
    expect(await exists(path.join(root, "docs", "spec", ".srs.lock"))).toBe(false);
  });

  it("registers the MCP server when requested and reports it in created", async () => {
    const root = await emptyRepo();
    const base = path.join(root, "skills");
    await fixtureSource(base);
    const value = await runInit(root, { registerMcp: true, skillSourceBaseDir: base });
    expect(await exists(path.join(root, ".mcp.json"))).toBe(true);
    expect(value.created).toContain(path.join(root, ".mcp.json"));
    expect((value.warnings ?? []).some((w) => /codex/i.test(w))).toBe(true);
  });
});
