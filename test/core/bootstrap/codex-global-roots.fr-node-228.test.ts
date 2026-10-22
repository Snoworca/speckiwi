import { access, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { initProject } from "../../../src/core/bootstrap/init-project.js";
import { findGlobalDestinationCollision, removeProject } from "../../../src/core/bootstrap/remove-project.js";
import { resolveProjectRoot } from "../../../src/core/project-root.js";
import { installSkill, resolveSkillDestinationRoot } from "../../../src/core/skills/install-skill.js";

// @req FR-NODE-228 — the entry points other than the installer itself: the init global pass, remove
// --global and its project-scope leftover report, and the FR-NODE-192 home-collision guard.

async function exists(target: string): Promise<boolean> {
  return access(target).then(() => true).catch(() => false);
}

async function writeFixtureSkill(base: string, subdir: "claude" | "codex", name: string): Promise<void> {
  const dir = path.join(base, subdir, name);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, "SKILL.md"), ["---", `name: ${name}`, "description: test skill", "---", "", `# ${name}`, ""].join("\n"), "utf8");
}

async function project(): Promise<{ root: string; home: string; base: string; codexHome: string }> {
  const root = await mkdtemp(path.join(tmpdir(), "speckiwi-fr-node-228-proj-"));
  await mkdir(path.join(root, ".git", "hooks"), { recursive: true });
  const base = path.join(root, "skills");
  await writeFixtureSkill(base, "claude", "kiwi-keep");
  await writeFixtureSkill(base, "codex", "kiwi-keep");
  const home = await mkdtemp(path.join(tmpdir(), "speckiwi-fr-node-228-home-"));
  const codexHome = path.join(home, ".codex");
  await mkdir(codexHome, { recursive: true });
  return { root, home, base, codexHome };
}

/** The copy SpecKiwi 4.1.0 wrote into the deprecated root, by the real installer. */
async function oldCodexCopy(p: { root: string; home: string; base: string; codexHome: string }): Promise<string> {
  const destination = path.join(p.codexHome, "skills");
  const placed = await installSkill({ projectRoot: { root: p.root }, sourceBaseDir: p.base, agent: "codex", selector: "kiwi-keep", scope: "custom", dest: destination });
  if (!placed.ok) throw new Error(placed.error.message);
  return path.join(destination, "kiwi-keep");
}

describe("FR-NODE-228 entry points beyond the installer", () => {
  it("FR-NODE-228 AC-1/AC-2: the init global pass installs at ~/.agents/skills and reports the old copy as removed", async () => {
    const p = await project();
    const old = await oldCodexCopy(p);

    const result = await initProject(await resolveProjectRoot(p.root), {
      installSkills: true,
      registerMcp: false,
      skillSourceBaseDir: p.base,
      globalHomeDir: p.home,
      globalCodexHome: p.codexHome
    });

    expect(result.ok).toBe(true);
    expect(await exists(path.join(p.home, ".agents", "skills", "kiwi-keep", "SKILL.md"))).toBe(true);
    expect(await exists(old)).toBe(false);
    expect(result.value?.removed).toContain(old);
  });

  it("FR-NODE-228 AC-6: remove --global removes SpecKiwi copies from both Codex roots", async () => {
    const p = await project();
    const init = await initProject(await resolveProjectRoot(p.root), { installSkills: true, registerMcp: false, skillSourceBaseDir: p.base, globalHomeDir: p.home, globalCodexHome: p.codexHome });
    expect(init.ok).toBe(true);
    const old = await oldCodexCopy(p);
    const current = path.join(p.home, ".agents", "skills", "kiwi-keep");
    expect(await exists(current)).toBe(true);

    const removed = await removeProject(await resolveProjectRoot(p.root), { apply: true, scope: "global", globalHomeDir: p.home, globalCodexHome: p.codexHome });

    expect(removed.ok).toBe(true);
    expect(await exists(current)).toBe(false);
    expect(await exists(old)).toBe(false);
    expect(removed.value?.removed).toEqual(expect.arrayContaining([current, old]));
  });

  it("FR-NODE-228 AC-6: a project-scope run reports SpecKiwi copies left in the deprecated Codex root", async () => {
    const p = await project();
    await oldCodexCopy(p);

    const removed = await removeProject(await resolveProjectRoot(p.root), { apply: false, globalHomeDir: p.home, globalCodexHome: p.codexHome });

    expect(removed.ok).toBe(true);
    expect(removed.value?.notes.some((note) => note.includes(path.join(p.codexHome, "skills")) && note.includes("speckiwi remove --global"))).toBe(true);
  });

  it("FR-NODE-228 AC-7: a project at the home directory has the same Codex project and global destination, so the guard fires", async () => {
    const home = await mkdtemp(path.join(tmpdir(), "speckiwi-fr-node-228-homeroot-"));
    const projectDestination = await resolveSkillDestinationRoot({ projectRoot: { root: home }, agent: "codex", selector: "all", scope: "project" });
    const globalDestination = await resolveSkillDestinationRoot({ projectRoot: { root: home }, agent: "codex", selector: "all", scope: "global", homeDir: home, env: { CODEX_HOME: path.join(home, ".codex") } });

    expect(globalDestination).toBe(projectDestination);
    expect(await findGlobalDestinationCollision(home, { globalHomeDir: home, globalCodexHome: path.join(home, ".codex") })).toBeDefined();
  });
});

describe("FR-NODE-228 AC-6 — <home>/.agents/skills does not depend on the Codex home", () => {
  async function installedThenCodexHomeGone() {
    const p = await project();
    const init = await initProject(await resolveProjectRoot(p.root), { installSkills: true, registerMcp: false, skillSourceBaseDir: p.base, globalHomeDir: p.home, globalCodexHome: p.codexHome });
    expect(init.ok).toBe(true);
    const current = path.join(p.home, ".agents", "skills", "kiwi-keep");
    expect(await exists(current)).toBe(true);
    await rm(p.codexHome, { recursive: true, force: true });
    return { p, current };
  }

  it("FR-NODE-228 AC-6: remove --global still removes the SpecKiwi copies in ~/.agents/skills after Codex is uninstalled", async () => {
    const { p, current } = await installedThenCodexHomeGone();

    const removed = await removeProject(await resolveProjectRoot(p.root), { apply: true, scope: "global", globalHomeDir: p.home, globalCodexHome: p.codexHome });

    expect(removed.ok).toBe(true);
    expect(await exists(current)).toBe(false);
    expect(removed.value?.removed).toContain(current);
  });

  it("FR-NODE-228 AC-6: a project-scope run still reports SpecKiwi copies left in ~/.agents/skills after Codex is uninstalled", async () => {
    const { p } = await installedThenCodexHomeGone();

    const removed = await removeProject(await resolveProjectRoot(p.root), { apply: false, globalHomeDir: p.home, globalCodexHome: p.codexHome });

    expect(removed.value?.notes.some((note) => note.includes(path.join(p.home, ".agents", "skills")))).toBe(true);
  });
});

describe("FR-NODE-228 AC-7 — the guard compares the Codex destinations, not only Claude's", () => {
  it("FR-NODE-228 AC-7: a project whose .agents is the home's .agents collides for codex alone", async (ctx) => {
    const home = await mkdtemp(path.join(tmpdir(), "speckiwi-fr-node-228-cxhome-"));
    await mkdir(path.join(home, ".agents"), { recursive: true });
    const root = await mkdtemp(path.join(tmpdir(), "speckiwi-fr-node-228-cxroot-"));
    // Only the Codex destination is shared: `<root>/.agents` links to `<home>/.agents`, `.claude` does not.
    const linked = await symlink(path.join(home, ".agents"), path.join(root, ".agents"), process.platform === "win32" ? "junction" : "dir").then(() => true, () => false);
    if (!linked) ctx.skip();

    const collision = await findGlobalDestinationCollision(root, { globalHomeDir: home, globalCodexHome: path.join(home, ".codex") });

    expect(collision?.agent).toBe("codex");
  });
});

describe("FR-NODE-228 AC-8 — removal and doctor take both Codex roots from the installer", () => {
  it("FR-NODE-228 AC-8: neither module resolves CODEX_HOME or a Codex directory under the home itself", async () => {
    for (const module of ["src/core/bootstrap/remove-project.ts", "src/core/health/doctor.ts"]) {
      const source = await readFile(path.resolve(import.meta.dirname, "../../..", module), "utf8");
      expect(source, `${module} reads CODEX_HOME from the environment`).not.toMatch(/process\.env\.CODEX_HOME|process\.env\[["']CODEX_HOME/);
      expect(source, `${module} joins a Codex directory onto a home directory`).not.toMatch(/path\.join\(\s*(?:\w+\.)?homeDir\s*,\s*["']\.(?:codex|agents)["']/);
      // The two assertions above also hold for a module that resolves nothing; these say it asks the installer.
      expect(source, `${module} does not ask the installer for the Codex destination`).toContain("resolveSkillDestinationRoot");
      expect(source, `${module} does not ask the installer for the deprecated Codex root`).toContain("resolveDeprecatedCodexSkillsRoot");
    }
  });
});
