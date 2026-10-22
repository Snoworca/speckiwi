import { access, mkdir, mkdtemp, readdir, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { installSkill, planSkillInstall, removeManagedKiwiSkills, resolveDeprecatedCodexSkillsRoot, resolveSkillDestinationRoot } from "../../../src/core/skills/install-skill.js";
import { canonicalPath, isSameDirectory } from "../../../src/core/fs/canonical-path.js";
import type { SkillInstallOptions } from "../../../src/core/skills/types.js";

// @req FR-NODE-228 — Codex reads user skills from `<home>/.agents/skills`; `${CODEX_HOME:-<home>/.codex}/skills`
// is a deprecated root it still reads, deduplicating by path only, so one skill in both is listed twice.
// Every home here is a fresh temp directory handed in through the options.

interface Fixture {
  root: string;
  home: string;
  base: string;
  newRoot: string;
  oldRoot: string;
}

async function exists(target: string): Promise<boolean> {
  return access(target).then(() => true).catch(() => false);
}

async function fixture(codexHome?: "custom"): Promise<Fixture & { env: Record<string, string> }> {
  const root = await mkdtemp(path.join(tmpdir(), "speckiwi-fr-node-228-"));
  const home = path.join(root, "home");
  const base = path.join(root, "skills");
  const skill = path.join(base, "codex", "kiwi-demo");
  await mkdir(skill, { recursive: true });
  await writeFile(path.join(skill, "SKILL.md"), ["---", "name: kiwi-demo", "description: demo", "---", "", "Read `_shared/kiwi/contract.md` first.", ""].join("\n"), "utf8");
  await mkdir(path.join(base, "codex", "_shared", "kiwi"), { recursive: true });
  await writeFile(path.join(base, "codex", "_shared", "kiwi", "contract.md"), "contract v1\n", "utf8");
  const codexDir = codexHome === "custom" ? path.join(root, "codex-home") : path.join(home, ".codex");
  await mkdir(codexDir, { recursive: true });
  return {
    root,
    home,
    base,
    newRoot: path.join(home, ".agents", "skills"),
    oldRoot: path.join(codexDir, "skills"),
    env: codexHome === "custom" ? { CODEX_HOME: codexDir } : {}
  };
}

function globalOptions(f: Fixture & { env: Record<string, string> }, overrides: Partial<SkillInstallOptions> = {}): SkillInstallOptions {
  return { projectRoot: { root: f.root }, sourceBaseDir: f.base, homeDir: f.home, env: f.env, agent: "codex", selector: "kiwi-demo", scope: "global", dryRun: false, ...overrides };
}

/** A copy SpecKiwi 4.1.0 left in the deprecated root: the real installer, pointed there. */
async function oldSpeckiwiCopy(f: Fixture & { env: Record<string, string> }): Promise<void> {
  const placed = await installSkill(globalOptions(f, { scope: "custom", dest: f.oldRoot }));
  if (!placed.ok) throw new Error(placed.error.message);
}

describe("FR-NODE-228 the Codex global skills root", () => {
  it.each([[undefined], ["custom" as const]])("FR-NODE-228 AC-1: the destination is <home>/.agents/skills (CODEX_HOME %s)", async (codexHome) => {
    const f = await fixture(codexHome);
    expect(await resolveSkillDestinationRoot(globalOptions(f))).toBe(f.newRoot);
    const installed = await installSkill(globalOptions(f));
    expect(installed.ok).toBe(true);
    expect(await exists(path.join(f.newRoot, "kiwi-demo", "SKILL.md"))).toBe(true);
    expect(await exists(path.join(f.oldRoot, "kiwi-demo"))).toBe(false);
  });

  it.each([[undefined], ["custom" as const]])("FR-NODE-228 AC-2: an old SpecKiwi copy and its shared contract leave the deprecated root (CODEX_HOME %s)", async (codexHome) => {
    const f = await fixture(codexHome);
    await oldSpeckiwiCopy(f);
    expect(await exists(path.join(f.oldRoot, "_shared", "kiwi", "contract.md"))).toBe(true);

    const installed = await installSkill(globalOptions(f));

    expect(installed.ok, installed.ok ? "" : installed.error.message).toBe(true);
    if (!installed.ok) return;
    expect(await exists(path.join(f.newRoot, "kiwi-demo", "SKILL.md"))).toBe(true);
    expect(await exists(path.join(f.oldRoot, "kiwi-demo"))).toBe(false);
    expect(await exists(path.join(f.oldRoot, "_shared", "kiwi", "contract.md"))).toBe(false);
    expect(installed.value.deprecatedRootCleanup?.removed).toEqual(
      expect.arrayContaining([path.join(f.oldRoot, "kiwi-demo"), path.join(f.oldRoot, "_shared", "kiwi", "contract.md")])
    );
  });

  it("FR-NODE-228 AC-2: a skill already current at the new root still has its old copy removed", async () => {
    const f = await fixture();
    expect((await installSkill(globalOptions(f))).ok).toBe(true);
    await oldSpeckiwiCopy(f);

    const again = await installSkill(globalOptions(f));

    expect(again.ok && again.value.results[0]?.operation).toBe("skip");
    expect(await exists(path.join(f.oldRoot, "kiwi-demo"))).toBe(false);
  });

  it("FR-NODE-228 AC-2: a skill the install did not touch stays in the deprecated root", async () => {
    const f = await fixture();
    await oldSpeckiwiCopy(f);
    // Another SpecKiwi-owned copy, so only the scoping to the installed names keeps it.
    const otherSource = path.join(f.base, "codex", "kiwi-other");
    await mkdir(otherSource, { recursive: true });
    await writeFile(path.join(otherSource, "SKILL.md"), ["---", "name: kiwi-other", "description: other", "---", "", "other", ""].join("\n"), "utf8");
    const placed = await installSkill(globalOptions(f, { selector: "kiwi-other", scope: "custom", dest: f.oldRoot }));
    expect(placed.ok).toBe(true);

    expect((await installSkill(globalOptions(f))).ok).toBe(true);

    expect(await exists(path.join(f.oldRoot, "kiwi-other", "SKILL.md"))).toBe(true);
    expect(await exists(path.join(f.oldRoot, "kiwi-demo"))).toBe(false);
  });

  it.each([
    ["no install metadata", async (dir: string) => writeFile(path.join(dir, ".speckiwi-skill-install.json"), "{}", "utf8")],
    ["local edits", async (dir: string) => writeFile(path.join(dir, "SKILL.md"), "edited by hand\n", "utf8")]
  ])("FR-NODE-228 AC-3: a copy that fails the proof (%s) is kept with a warning naming both paths", async (_label, spoil) => {
    const f = await fixture();
    await oldSpeckiwiCopy(f);
    await spoil(path.join(f.oldRoot, "kiwi-demo"));

    const installed = await installSkill(globalOptions(f));

    expect(installed.ok).toBe(true);
    if (!installed.ok) return;
    expect(await exists(path.join(f.oldRoot, "kiwi-demo", "SKILL.md"))).toBe(true);
    expect(await exists(path.join(f.newRoot, "kiwi-demo", "SKILL.md"))).toBe(true);
    const warning = installed.value.deprecatedRootCleanup?.warnings.find((entry) => entry.includes(path.join(f.oldRoot, "kiwi-demo")));
    expect(warning).toBeDefined();
    expect(warning).toContain(path.join(f.newRoot, "kiwi-demo"));
  });

  it("FR-NODE-228 AC-3: a user-authored copy without metadata is kept and warned", async () => {
    const f = await fixture();
    await mkdir(path.join(f.oldRoot, "kiwi-demo"), { recursive: true });
    await writeFile(path.join(f.oldRoot, "kiwi-demo", "SKILL.md"), "mine\n", "utf8");

    const installed = await installSkill(globalOptions(f));

    expect(installed.ok).toBe(true);
    expect(await exists(path.join(f.oldRoot, "kiwi-demo", "SKILL.md"))).toBe(true);
    expect(installed.ok && installed.value.deprecatedRootCleanup?.warnings.some((w) => w.includes(path.join(f.newRoot, "kiwi-demo")))).toBe(true);
  });

  it("FR-NODE-228 AC-4: a dry-run lists the old copy it would remove and writes nothing to either root", async () => {
    const f = await fixture();
    await oldSpeckiwiCopy(f);
    const before = (await readdir(f.oldRoot)).sort();

    const planned = await planSkillInstall(globalOptions(f, { dryRun: true }));

    expect(planned.ok).toBe(true);
    if (!planned.ok) return;
    expect(planned.value.deprecatedRootCleanup?.removed).toContain(path.join(f.oldRoot, "kiwi-demo"));
    expect(await exists(f.newRoot)).toBe(false);
    expect((await readdir(f.oldRoot)).sort()).toEqual(before);
    expect(await exists(path.join(f.oldRoot, "kiwi-demo", "SKILL.md"))).toBe(true);
  });

  it("FR-NODE-228 AC-5: a skill present in both roots is not refused", async () => {
    const f = await fixture();
    expect((await installSkill(globalOptions(f))).ok).toBe(true);
    await mkdir(path.join(f.oldRoot, "kiwi-demo"), { recursive: true });
    await writeFile(path.join(f.oldRoot, "kiwi-demo", "SKILL.md"), "mine\n", "utf8");

    const installed = await installSkill(globalOptions(f));

    expect(installed.ok ? "ok" : installed.error.code).toBe("ok");
  });
});

describe("FR-NODE-228 AC-9 — the deprecated root spelled differently is still the destination", () => {
  async function sameDirectoryFixture(): Promise<{ f: Fixture & { env: Record<string, string> }; skill: string }> {
    const f = await fixture();
    await mkdir(path.join(f.home, ".agents"), { recursive: true });
    return { f, skill: path.join(f.newRoot, "kiwi-demo", "SKILL.md") };
  }

  it.runIf(process.platform === "win32")("FR-NODE-228 AC-9: a case-only spelling of <home>/.agents in CODEX_HOME runs no cleanup", async () => {
    const { f, skill } = await sameDirectoryFixture();
    const options = globalOptions(f, { homeDir: f.home.toUpperCase(), env: { CODEX_HOME: path.join(f.home, ".AGENTS") } });

    const installed = await installSkill(options);

    expect(installed.ok).toBe(true);
    expect(installed.ok && installed.value.deprecatedRootCleanup).toBeUndefined();
    expect(await exists(skill)).toBe(true);
  });

  it("FR-NODE-228 AC-9: a CODEX_HOME that links to <home>/.agents runs no cleanup", async (ctx) => {
    const { f, skill } = await sameDirectoryFixture();
    const link = path.join(f.root, "codex-link");
    const linked = await symlink(path.join(f.home, ".agents"), link, process.platform === "win32" ? "junction" : "dir").then(() => true, () => false);
    if (!linked) ctx.skip();

    const installed = await installSkill(globalOptions(f, { env: { CODEX_HOME: link } }));

    expect(installed.ok).toBe(true);
    expect(installed.ok && installed.value.deprecatedRootCleanup).toBeUndefined();
    expect(await exists(skill)).toBe(true);
  });
});

describe("FR-NODE-228 AC-2 — only the names the install placed are candidates", () => {
  it("FR-NODE-228 AC-2: the removal verdict takes an explicit candidate list and touches nothing outside it", async () => {
    const f = await fixture();
    await oldSpeckiwiCopy(f);
    const otherSource = path.join(f.base, "codex", "kiwi-other");
    await mkdir(otherSource, { recursive: true });
    await writeFile(path.join(otherSource, "SKILL.md"), ["---", "name: kiwi-other", "description: other", "---", "", "other", ""].join("\n"), "utf8");
    expect((await installSkill(globalOptions(f, { selector: "kiwi-other", scope: "custom", dest: f.oldRoot }))).ok).toBe(true);

    const outcome = await removeManagedKiwiSkills({ destinationRoot: f.oldRoot, agent: "codex", keepNames: [], onlyNames: ["kiwi-demo"] });

    expect(outcome.removed).toEqual([path.join(f.oldRoot, "kiwi-demo")]);
    expect(await exists(path.join(f.oldRoot, "kiwi-other", "SKILL.md"))).toBe(true);
  });
});

describe("FR-NODE-228 AC-9 — one directory, compared before it exists", () => {
  it.runIf(process.platform === "win32")("FR-NODE-228 AC-9: two spellings that differ only in case below the existing ancestor are one directory", async () => {
    // realpath settles the case of the parts that exist; the parts the install has yet to create are
    // compared as written, so the case-insensitive comparison is what carries a case-only spelling there.
    const base = await mkdtemp(path.join(tmpdir(), "speckiwi-fr-node-228-case-"));
    expect(await isSameDirectory(path.join(base, "home", ".agents", "skills"), path.join(base, "home", ".AGENTS", "skills"))).toBe(true);
    expect(await isSameDirectory(path.join(base, "home", ".agents", "skills"), path.join(base, "home", ".codex", "skills"))).toBe(false);
  });
});

describe("FR-NODE-228 AC-9 — an existing directory spelled in another case", () => {
  it("FR-NODE-228 AC-9: canonicalPath returns the on-disk spelling, so both spellings compare equal", async (ctx) => {
    const base = await mkdtemp(path.join(tmpdir(), "speckiwi-fr-node-228-ondisk-"));
    const actual = path.join(base, "Agents-Dir");
    await mkdir(actual, { recursive: true });
    const other = path.join(base, "AGENTS-DIR");
    // Only meaningful where the file system folds case; elsewhere the two spellings are two directories.
    if (!(await exists(other))) ctx.skip();

    expect(await canonicalPath(other)).toBe(await canonicalPath(actual));
    expect(await isSameDirectory(other, actual)).toBe(true);
  });
});

describe("FR-NODE-228 AC-11 — a CODEX_HOME named .agents is not taken for the deprecated Codex root", () => {
  it("FR-NODE-228 AC-11: a global install with CODEX_HOME=<project>/.agents leaves the project's own Codex copies and warns", async () => {
    const f = await fixture();
    const project = path.join(f.root, "project");
    await mkdir(project, { recursive: true });
    const projectCopies = path.join(project, ".agents", "skills");
    const projectInstall = await installSkill({ projectRoot: { root: project }, sourceBaseDir: f.base, agent: "codex", selector: "kiwi-demo", scope: "project" });
    expect(projectInstall.ok).toBe(true);
    expect(await exists(path.join(projectCopies, "kiwi-demo", "SKILL.md"))).toBe(true);
    const options = globalOptions(f, { env: { CODEX_HOME: path.join(project, ".agents") } });

    const installed = await installSkill(options);

    expect(installed.ok).toBe(true);
    if (!installed.ok) return;
    expect(await exists(path.join(projectCopies, "kiwi-demo", "SKILL.md"))).toBe(true);
    expect(installed.value.deprecatedRootCleanup?.removed ?? []).toEqual([]);
    expect(installed.value.deprecatedRootCleanup?.warnings.some((warning) => warning.includes(projectCopies))).toBe(true);
    // Removal and doctor reach the deprecated root only through this resolver, so neither visits it.
    expect(await resolveDeprecatedCodexSkillsRoot(options)).toBeUndefined();
  });

  it("FR-NODE-228 AC-11: an ordinary CODEX_HOME is still the deprecated root", async () => {
    const f = await fixture("custom");
    expect(await resolveDeprecatedCodexSkillsRoot(globalOptions(f))).toBe(f.oldRoot);
  });
});
