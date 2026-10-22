import { access, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { deprecatedCodexCandidates, installSkill, planSkillInstall } from "../../../src/core/skills/install-skill.js";
import type { SkillInstallOptions } from "../../../src/core/skills/types.js";

// @req FR-NODE-228 AC-2/AC-3/AC-4 — Codex still lists every skill in the deprecated
// `${CODEX_HOME:-<home>/.codex}/skills`, so a skill SpecKiwi retired (kiwi-planner, 4.0.0) and left there
// keeps reading as current guidance unless the install takes it out. Every home is a fresh temp directory.

interface Fixture {
  root: string;
  home: string;
  base: string;
  oldBase: string;
  newRoot: string;
  oldRoot: string;
}

async function exists(target: string): Promise<boolean> {
  return access(target).then(() => true).catch(() => false);
}

async function writeSkill(base: string, name: string): Promise<void> {
  const dir = path.join(base, "codex", name);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, "SKILL.md"), ["---", `name: ${name}`, `description: ${name}`, "---", "", `${name} body`, ""].join("\n"), "utf8");
}

async function fixture(): Promise<Fixture> {
  const root = await mkdtemp(path.join(tmpdir(), "speckiwi-fr-node-228-retired-"));
  const home = path.join(root, "home");
  const base = path.join(root, "skills");
  // The bundle an earlier release shipped: it still held kiwi-planner, which the current bundle does not.
  const oldBase = path.join(root, "old-release", "skills");
  await writeSkill(base, "kiwi-demo");
  await writeSkill(oldBase, "kiwi-planner");
  await writeSkill(oldBase, "kiwi-mine");
  await mkdir(path.join(home, ".codex"), { recursive: true });
  return { root, home, base, oldBase, newRoot: path.join(home, ".agents", "skills"), oldRoot: path.join(home, ".codex", "skills") };
}

function globalOptions(f: Fixture, overrides: Partial<SkillInstallOptions> = {}): SkillInstallOptions {
  return { projectRoot: { root: f.root }, sourceBaseDir: f.base, homeDir: f.home, env: {}, agent: "codex", selector: "kiwi-demo", scope: "global", dryRun: false, ...overrides };
}

/** A copy an earlier SpecKiwi release left in the deprecated root: the real installer, pointed there. */
async function oldReleaseCopy(f: Fixture, name: string): Promise<void> {
  const placed = await installSkill(globalOptions(f, { sourceBaseDir: f.oldBase, selector: name, scope: "custom", dest: f.oldRoot }));
  if (!placed.ok) throw new Error(placed.error.message);
}

describe("FR-NODE-228 retired skills leave the deprecated Codex root", () => {
  it("FR-NODE-228 AC-2: a SpecKiwi copy of a retired skill is removed and reported; an unknown kiwi-* name is kept", async () => {
    const f = await fixture();
    await oldReleaseCopy(f, "kiwi-planner");
    await oldReleaseCopy(f, "kiwi-mine");

    const installed = await installSkill(globalOptions(f));

    expect(installed.ok, installed.ok ? "" : installed.error.message).toBe(true);
    if (!installed.ok) return;
    expect(await exists(path.join(f.oldRoot, "kiwi-planner"))).toBe(false);
    expect(installed.value.deprecatedRootCleanup?.removed).toContain(path.join(f.oldRoot, "kiwi-planner"));
    // Not on the retired list and not placed by this install, so it is not a candidate at all.
    expect(await exists(path.join(f.oldRoot, "kiwi-mine", "SKILL.md"))).toBe(true);
    expect(installed.value.deprecatedRootCleanup?.warnings.some((entry) => entry.includes("kiwi-mine"))).toBe(false);
  });

  it("FR-NODE-228 AC-3: a retired copy that fails the proof is kept, and the warning says SpecKiwi no longer ships it", async () => {
    const f = await fixture();
    await oldReleaseCopy(f, "kiwi-planner");
    await writeFile(path.join(f.oldRoot, "kiwi-planner", "SKILL.md"), "edited by hand\n", "utf8");

    const installed = await installSkill(globalOptions(f));

    expect(installed.ok).toBe(true);
    if (!installed.ok) return;
    expect(await exists(path.join(f.oldRoot, "kiwi-planner", "SKILL.md"))).toBe(true);
    const warning = installed.value.deprecatedRootCleanup?.warnings.find((entry) => entry.includes(path.join(f.oldRoot, "kiwi-planner")));
    expect(warning).toBeDefined();
    expect(warning).toContain("no longer ships");
    expect(warning).not.toContain(path.join(f.newRoot, "kiwi-planner"));
  });

  it("FR-NODE-228 AC-4: a dry-run lists the retired copy it would remove and leaves it in place", async () => {
    const f = await fixture();
    await oldReleaseCopy(f, "kiwi-planner");

    const planned = await planSkillInstall(globalOptions(f, { dryRun: true }));

    expect(planned.ok).toBe(true);
    if (!planned.ok) return;
    expect(planned.value.deprecatedRootCleanup?.removed).toContain(path.join(f.oldRoot, "kiwi-planner"));
    expect(await exists(path.join(f.oldRoot, "kiwi-planner", "SKILL.md"))).toBe(true);
    expect(await exists(path.join(f.newRoot, "kiwi-demo"))).toBe(false);
  });
});

describe("FR-NODE-228 AC-2 — a retired name is not a bundled skill", () => {
  it("FR-NODE-228 AC-2: no name on the retired list is in the bundled codex skills", async () => {
    // A retired name bundled again would make a single-skill install of another skill remove its old copy
    // without placing the replacement.
    const retired = deprecatedCodexCandidates([]);
    expect(retired).toContain("kiwi-planner");
    for (const name of retired) {
      expect(await exists(path.join(process.cwd(), "skills", "codex", name)), name).toBe(false);
    }
  });
});
