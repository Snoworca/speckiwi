import { access, cp, mkdir, mkdtemp, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { installSkill, pruneOrphanKiwiSkills } from "../../../src/core/skills/install-skill.js";

// @req FR-NODE-069 — speckiwi init orphaned kiwi-* skill prune (metadata-gated, drift-safe).
// Removes only kiwi-* dirs that are speckiwi-managed runtime mirrors, absent from the current source
// set, not symlinks, and unmodified (checksum matches). User-authored kiwi-* dirs, non-kiwi dirs,
// in-set skills, and drifted skills are never removed.

async function tempRoot(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), "speckiwi-prune-"));
}

async function writeSourceSkill(root: string, name: string): Promise<void> {
  const dir = path.join(root, "skills", "claude", name);
  await mkdir(path.join(dir, "references"), { recursive: true });
  await writeFile(
    path.join(dir, "SKILL.md"),
    ["---", `name: ${name}`, "description: test skill", "---", "", `# ${name}`, "", "Normal operation requires speckiwi mcp."].join("\n"),
    "utf8"
  );
  await writeFile(path.join(dir, "references", "guide.md"), "guide\n", "utf8");
}

async function installClaudeAll(root: string): Promise<void> {
  const result = await installSkill({
    projectRoot: { root },
    agent: "claude",
    selector: "all",
    scope: "project",
    sourceBaseDir: path.join(root, "skills"),
    homeDir: path.join(root, "home"),
    env: {},
    dryRun: false
  });
  if (!result.ok) throw new Error(result.error.message);
}

function claudeDest(root: string): string {
  return path.join(root, ".claude", "skills");
}

async function exists(target: string): Promise<boolean> {
  return access(target).then(() => true).catch(() => false);
}

describe("pruneOrphanKiwiSkills", () => {
  it("AC-1: removes a speckiwi-managed kiwi-* orphan absent from the source set and lists it in removed", async () => {
    const root = await tempRoot();
    await writeSourceSkill(root, "kiwi-keep");
    await writeSourceSkill(root, "kiwi-old");
    await installClaudeAll(root);
    const dest = claudeDest(root);
    const prune = await pruneOrphanKiwiSkills({ destinationRoot: dest, agent: "claude", sourceSkillNames: ["kiwi-keep"], dryRun: false });
    expect(await exists(path.join(dest, "kiwi-old"))).toBe(false);
    expect(await exists(path.join(dest, "kiwi-keep"))).toBe(true);
    expect(prune.removed).toContain(path.join(dest, "kiwi-old"));
  });

  it("AC-2: never removes a user-authored kiwi-* directory that lacks speckiwi install metadata", async () => {
    const root = await tempRoot();
    const dest = claudeDest(root);
    await mkdir(path.join(dest, "kiwi-mine"), { recursive: true });
    await writeFile(path.join(dest, "kiwi-mine", "SKILL.md"), "mine\n", "utf8");
    const prune = await pruneOrphanKiwiSkills({ destinationRoot: dest, agent: "claude", sourceSkillNames: [], dryRun: false });
    expect(await exists(path.join(dest, "kiwi-mine"))).toBe(true);
    expect(prune.removed).toEqual([]);
  });

  it("AC-3: never removes a non-kiwi directory regardless of metadata", async () => {
    const root = await tempRoot();
    await writeSourceSkill(root, "othertool");
    await installClaudeAll(root);
    const dest = claudeDest(root);
    const prune = await pruneOrphanKiwiSkills({ destinationRoot: dest, agent: "claude", sourceSkillNames: [], dryRun: false });
    expect(await exists(path.join(dest, "othertool"))).toBe(true);
    expect(prune.removed).toEqual([]);
  });

  it("AC-4: does not prune a speckiwi-managed kiwi-* directory that is in the current source set", async () => {
    const root = await tempRoot();
    await writeSourceSkill(root, "kiwi-keep");
    await writeSourceSkill(root, "kiwi-old");
    await installClaudeAll(root);
    const dest = claudeDest(root);
    const prune = await pruneOrphanKiwiSkills({ destinationRoot: dest, agent: "claude", sourceSkillNames: ["kiwi-keep", "kiwi-old"], dryRun: false });
    expect(await exists(path.join(dest, "kiwi-keep"))).toBe(true);
    expect(await exists(path.join(dest, "kiwi-old"))).toBe(true);
    expect(prune.removed).toEqual([]);
  });

  it("AC-5: refuses to delete a managed orphan whose on-disk contents drifted, and warns", async () => {
    const root = await tempRoot();
    await writeSourceSkill(root, "kiwi-old");
    await installClaudeAll(root);
    const dest = claudeDest(root);
    await writeFile(path.join(dest, "kiwi-old", "SKILL.md"), "LOCALLY MODIFIED\n", "utf8");
    const prune = await pruneOrphanKiwiSkills({ destinationRoot: dest, agent: "claude", sourceSkillNames: [], dryRun: false });
    expect(await exists(path.join(dest, "kiwi-old"))).toBe(true);
    expect(prune.removed).toEqual([]);
    expect(prune.warnings.some((w) => w.includes("kiwi-old"))).toBe(true);
  });

  it("AC-6: never follows a symlinked candidate; refuses with a warning", async () => {
    const root = await tempRoot();
    const dest = claudeDest(root);
    await mkdir(dest, { recursive: true });
    const target = path.join(root, "link-target");
    await mkdir(target, { recursive: true });
    let symlinkSupported = true;
    try {
      await symlink(target, path.join(dest, "kiwi-link"), "dir");
    } catch {
      symlinkSupported = false;
    }
    if (!symlinkSupported) return; // platform without symlink permission (e.g. Windows without dev mode)
    const prune = await pruneOrphanKiwiSkills({ destinationRoot: dest, agent: "claude", sourceSkillNames: [], dryRun: false });
    expect(await exists(path.join(dest, "kiwi-link"))).toBe(true);
    expect(prune.removed).toEqual([]);
    expect(prune.warnings.some((w) => w.includes("kiwi-link"))).toBe(true);
  });

  it("AC-7: dry-run reports the orphans it would remove without deleting them", async () => {
    const root = await tempRoot();
    await writeSourceSkill(root, "kiwi-old");
    await installClaudeAll(root);
    const dest = claudeDest(root);
    const prune = await pruneOrphanKiwiSkills({ destinationRoot: dest, agent: "claude", sourceSkillNames: [], dryRun: true });
    expect(prune.removed).toContain(path.join(dest, "kiwi-old"));
    expect(await exists(path.join(dest, "kiwi-old"))).toBe(true);
  });

  it("never removes a managed directory whose metadata name does not match its directory name (copied/renamed)", async () => {
    const root = await tempRoot();
    await writeSourceSkill(root, "kiwi-old");
    await installClaudeAll(root);
    const dest = claudeDest(root);
    // A user copies an installed skill to a new name; the metadata still says name: kiwi-old.
    await cp(path.join(dest, "kiwi-old"), path.join(dest, "kiwi-old-copy"), { recursive: true });
    const prune = await pruneOrphanKiwiSkills({ destinationRoot: dest, agent: "claude", sourceSkillNames: ["kiwi-old"], dryRun: false });
    expect(await exists(path.join(dest, "kiwi-old-copy"))).toBe(true);
    expect(prune.removed).not.toContain(path.join(dest, "kiwi-old-copy"));
  });

  it("returns empty results when the destination root does not exist", async () => {
    const root = await tempRoot();
    const prune = await pruneOrphanKiwiSkills({ destinationRoot: path.join(root, "missing", "skills"), agent: "claude", sourceSkillNames: [], dryRun: false });
    expect(prune.removed).toEqual([]);
    expect(prune.warnings).toEqual([]);
  });
});
