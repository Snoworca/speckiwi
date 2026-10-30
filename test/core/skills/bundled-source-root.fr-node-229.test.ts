import { mkdir, mkdtemp, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { initProject } from "../../../src/core/bootstrap/init-project.js";
import { removeProject } from "../../../src/core/bootstrap/remove-project.js";
import { resolveProjectRoot } from "../../../src/core/project-root.js";
import { planSkillInstall } from "../../../src/core/skills/install-skill.js";

// @req FR-NODE-229 — with no source injected, the kiwi skills come from the package whose code is
// running. A `skills/` folder in the project, the working directory or an ancestor is someone else's
// content: a project with its own `skills/claude` made init install that project's skills instead of
// the kiwi skills, and made `--project-install` prune every managed kiwi copy.

vi.setConfig({ testTimeout: 60_000 });

const PACKAGE_SKILLS = fileURLToPath(new URL("../../../skills", import.meta.url));

async function bundledNames(sourceSubdir: "claude" | "codex"): Promise<string[]> {
  const entries = await readdir(path.join(PACKAGE_SKILLS, sourceSubdir), { withFileTypes: true });
  return entries.filter((entry) => entry.isDirectory() && !entry.name.startsWith("_")).map((entry) => entry.name).sort();
}

async function writeForeignSkill(base: string, subdir: "claude" | "codex", name: string): Promise<void> {
  const dir = path.join(base, "skills", subdir, name);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, "SKILL.md"), ["---", `name: ${name}`, "description: a project's own skill", "---", "", `# ${name}`].join("\n"), "utf8");
}

async function emptyRepo(parent?: string): Promise<string> {
  const root = parent ?? (await mkdtemp(path.join(tmpdir(), "speckiwi-src-root-")));
  await mkdir(path.join(root, ".git", "hooks"), { recursive: true });
  return root;
}

async function plannedSource(root: string, agent: "claude" | "codex") {
  const planned = await planSkillInstall({ projectRoot: { root }, agent, selector: "all", scope: "project", dryRun: true });
  if (!planned.ok || planned.value === undefined) throw new Error(planned.error?.message ?? "expected a plan");
  return { sourceRoot: planned.value.sourceRoot, names: planned.value.results.map((result) => result.name).sort() };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("FR-NODE-229 bundled skill source", () => {
  it("AC-1: a project's own skills/claude and skills/codex are not the source", async () => {
    const root = await emptyRepo();
    await writeForeignSkill(root, "claude", "project-skill");
    await writeForeignSkill(root, "codex", "project-skill");

    for (const agent of ["claude", "codex"] as const) {
      const { sourceRoot, names } = await plannedSource(root, agent);
      expect(path.resolve(sourceRoot)).toBe(path.join(PACKAGE_SKILLS, agent));
      expect(names).toEqual(await bundledNames(agent));
      expect(names).not.toContain("project-skill");
    }
  });

  it("AC-2: skills/ in the working directory is not the source", async () => {
    const root = await emptyRepo();
    const cwd = await mkdtemp(path.join(tmpdir(), "speckiwi-src-cwd-"));
    await writeForeignSkill(cwd, "claude", "cwd-skill");
    vi.spyOn(process, "cwd").mockReturnValue(cwd);

    const { sourceRoot, names } = await plannedSource(root, "claude");
    expect(path.resolve(sourceRoot)).toBe(path.join(PACKAGE_SKILLS, "claude"));
    expect(names).not.toContain("cwd-skill");
  });

  it("AC-2: skills/ in an ancestor of the project root is not the source", async () => {
    const ancestor = await mkdtemp(path.join(tmpdir(), "speckiwi-src-anc-"));
    await writeForeignSkill(ancestor, "claude", "ancestor-skill");
    const root = path.join(ancestor, "work", "proj");
    await mkdir(root, { recursive: true });
    await emptyRepo(root);

    const { sourceRoot, names } = await plannedSource(root, "claude");
    expect(path.resolve(sourceRoot)).toBe(path.join(PACKAGE_SKILLS, "claude"));
    expect(names).not.toContain("ancestor-skill");
  });

  /** A project as `init --project-install` leaves it, which then gains its own skills/ folder. */
  async function projectInstalledThenForeignSkills(): Promise<{ root: string; home: string }> {
    const root = await emptyRepo();
    const home = await mkdtemp(path.join(tmpdir(), "speckiwi-src-home-"));
    await runInit(root, home);
    await writeForeignSkill(root, "claude", "project-skill");
    await writeForeignSkill(root, "codex", "project-skill");
    return { root, home };
  }

  async function runInit(root: string, home: string) {
    const result = await initProject(await resolveProjectRoot(root), {
      projectInstall: true,
      installSkills: true,
      globalHomeDir: home,
      globalCodexHome: path.join(home, ".codex")
    });
    if (!result.ok || result.value === undefined) throw new Error(result.error?.message ?? "expected an ok init");
    return result.value;
  }

  async function installedNames(dir: string): Promise<string[]> {
    const entries = await readdir(dir, { withFileTypes: true });
    return entries.filter((entry) => entry.isDirectory() && !entry.name.startsWith("_")).map((entry) => entry.name).sort();
  }

  it("AC-3: init --project-install keeps the managed kiwi copies when the project has its own skills/", async () => {
    const { root, home } = await projectInstalledThenForeignSkills();
    expect(await installedNames(path.join(root, ".claude", "skills"))).toEqual(await bundledNames("claude"));

    const output = await runInit(root, home);

    expect(output.removed.filter((removed) => /kiwi-/.test(removed))).toEqual([]);
    expect(await installedNames(path.join(root, ".claude", "skills"))).toEqual(await bundledNames("claude"));
    expect(await installedNames(path.join(root, ".agents", "skills"))).toEqual(await bundledNames("codex"));
  });

  it("AC-4: remove --apply clears the _shared/kiwi mirror when the project has its own skills/", async () => {
    const { root, home } = await projectInstalledThenForeignSkills();
    const shared = path.join(root, ".claude", "skills", "_shared", "kiwi");
    expect((await readdir(shared)).length).toBeGreaterThan(0);

    const result = await removeProject(await resolveProjectRoot(root), {
      apply: true,
      globalHomeDir: home,
      globalCodexHome: path.join(home, ".codex")
    });
    if (!result.ok || result.value === undefined) throw new Error(result.error?.message ?? "expected an ok removal");

    expect(result.value.kept.filter((kept) => kept.path.includes("_shared"))).toEqual([]);
    const left = await readdir(shared).catch(() => []);
    expect(left).toEqual([]);
  });
});
