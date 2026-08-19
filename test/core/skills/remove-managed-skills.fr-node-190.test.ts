import { access, cp, mkdir, mkdtemp, readFile, readdir, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { installSkill, removeManagedKiwiSkills } from "../../../src/core/skills/install-skill.js";

/** Every `.ts` under a directory. Used to ask which modules read a field they have no business reading. */
async function sourceFiles(dir: string): Promise<string[]> {
  const found: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) found.push(...(await sourceFiles(full)));
    else if (entry.isFile() && full.endsWith(".ts")) found.push(full);
  }
  return found;
}

// @req FR-NODE-190 — removal reuses the prune's ownership verdict; the only difference is the keep set.
//
// Nothing here hand-writes install metadata. Every managed directory is produced by a real
// `installSkill` run, so the checksum under test is the one the installer actually recorded — a
// fixture-written checksum would pass whatever the verdict happened to compute.

async function tempRoot(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), "speckiwi-remove-skills-"));
}

async function writeSourceSkill(root: string, name: string, shared: readonly string[] = []): Promise<void> {
  const dir = path.join(root, "skills", "claude", name);
  await mkdir(path.join(dir, "references"), { recursive: true });
  const body = ["---", `name: ${name}`, "description: test skill", "---", "", `# ${name}`, "", "Normal operation requires speckiwi mcp."];
  for (const contract of shared) body.push("", `See [contract](../_shared/kiwi/${contract}).`);
  await writeFile(path.join(dir, "SKILL.md"), body.join("\n"), "utf8");
  await writeFile(path.join(dir, "references", "guide.md"), "guide\n", "utf8");
}

async function writeSharedContract(root: string, name: string): Promise<void> {
  const dir = path.join(root, "skills", "claude", "_shared", "kiwi");
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, name), `# ${name}\n`, "utf8");
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

/**
 * Removal keeps nothing — that empty set is the single thing that differs from the prune.
 *
 * The source root is threaded through because the shared-mirror reconciliation proves ownership
 * against it: a mirrored file is one the bundled source still holds at the same relative path with
 * the same bytes. Omitting it here would make every shared file unprovable and quietly turn the two
 * cases below into passes for the wrong reason.
 */
async function removeAll(dest: string, sourceRoot?: string) {
  return removeManagedKiwiSkills({
    destinationRoot: dest,
    agent: "claude",
    keepNames: [],
    dryRun: false,
    reconcileSharedMirror: true,
    ...(sourceRoot ? { sourceRoot } : {})
  });
}

/** The bundled source the fixtures install from, for the agent these cases use. */
function claudeSource(root: string): string {
  return path.join(root, "skills", "claude");
}

function keptPaths(outcome: Awaited<ReturnType<typeof removeAll>>): string[] {
  return outcome.kept.map((entry) => entry.path);
}

describe("FR-NODE-190 AC-1 — an unmodified managed skill is removed and reported", () => {
  it("deletes the directory and names it in removed", async () => {
    const root = await tempRoot();
    await writeSourceSkill(root, "kiwi-keep");
    await installClaudeAll(root);
    const dest = claudeDest(root);

    const outcome = await removeAll(dest);

    expect(await exists(path.join(dest, "kiwi-keep"))).toBe(false);
    expect(outcome.removed).toContain(path.join(dest, "kiwi-keep"));
    expect(keptPaths(outcome)).toEqual([]);
  });
});

describe("FR-NODE-190 AC-2 — a user-authored kiwi-* directory is never removed", () => {
  it("keeps a directory that carries no install metadata and reports why", async () => {
    const root = await tempRoot();
    const dest = claudeDest(root);
    await mkdir(path.join(dest, "kiwi-mine"), { recursive: true });
    await writeFile(path.join(dest, "kiwi-mine", "SKILL.md"), "mine\n", "utf8");

    const outcome = await removeAll(dest);

    expect(await exists(path.join(dest, "kiwi-mine"))).toBe(true);
    expect(outcome.removed).toEqual([]);
    const kept = outcome.kept.find((entry) => entry.path === path.join(dest, "kiwi-mine"));
    expect(kept, "a kept directory that is not reported is indistinguishable from one that was missed").toBeDefined();
    expect(kept!.reason).toBe("user-authored");
  });
});

describe("FR-NODE-190 AC-3 — a locally edited skill is kept, with the edit given as the reason", () => {
  it("keeps the directory and reports the reason as the local modification", async () => {
    const root = await tempRoot();
    await writeSourceSkill(root, "kiwi-edited");
    await installClaudeAll(root);
    const dest = claudeDest(root);
    // The edit the operator made after install. This is the one thing in the destination that exists
    // nowhere else — the bundle can reproduce everything except this.
    await writeFile(path.join(dest, "kiwi-edited", "references", "guide.md"), "my own notes\n", "utf8");

    const outcome = await removeAll(dest);

    expect(await exists(path.join(dest, "kiwi-edited"))).toBe(true);
    const kept = outcome.kept.find((entry) => entry.path === path.join(dest, "kiwi-edited"));
    expect(kept).toBeDefined();
    expect(kept!.reason).toBe("locally-modified");
  });
});

describe("FR-NODE-190 AC-4 — a symlinked entry is neither followed nor deleted", () => {
  it("keeps the link and reports it", async () => {
    const root = await tempRoot();
    await writeSourceSkill(root, "kiwi-real");
    await installClaudeAll(root);
    const dest = claudeDest(root);
    const target = path.join(root, "elsewhere");
    await mkdir(target, { recursive: true });
    await writeFile(path.join(target, "SKILL.md"), "elsewhere\n", "utf8");
    try {
      await symlink(target, path.join(dest, "kiwi-linked"), "junction");
    } catch {
      return; // Symlink creation is privileged on some Windows configurations; the case cannot run.
    }

    const outcome = await removeAll(dest);

    expect(await exists(path.join(dest, "kiwi-linked"))).toBe(true);
    expect(await exists(path.join(target, "SKILL.md")), "the link was followed and its target touched").toBe(true);
    expect(outcome.kept.find((entry) => entry.path === path.join(dest, "kiwi-linked"))?.reason).toBe("symlink");
  });
});

describe("FR-NODE-190 AC-5 — metadata that identifies a different directory does not authorise deletion", () => {
  it("keeps a verbatim copy of a managed directory placed under another name", async () => {
    const root = await tempRoot();
    await writeSourceSkill(root, "kiwi-source");
    await installClaudeAll(root);
    const dest = claudeDest(root);
    // The directory name is not part of the checksum, so a copy passes the checksum gate. What it
    // cannot pass is the metadata's own claim about which name it belongs to.
    await cp(path.join(dest, "kiwi-source"), path.join(dest, "kiwi-copy"), { recursive: true });

    const outcome = await removeAll(dest);

    expect(await exists(path.join(dest, "kiwi-copy"))).toBe(true);
    expect(outcome.removed).toEqual([path.join(dest, "kiwi-source")]);
  });
});

describe("FR-NODE-190 AC-6 — the verdict is reached per directory", () => {
  it("removes every clean directory even when one beside them is drifted", async () => {
    const root = await tempRoot();
    for (const name of ["kiwi-a", "kiwi-b", "kiwi-c", "kiwi-drifted"]) await writeSourceSkill(root, name);
    await installClaudeAll(root);
    const dest = claudeDest(root);
    await writeFile(path.join(dest, "kiwi-drifted", "references", "guide.md"), "edited\n", "utf8");

    const outcome = await removeAll(dest);

    // A batch verdict would leave all four; that is the failure this case exists to catch, because a
    // user who then reaches for an escape hatch loses the one directory that mattered.
    for (const name of ["kiwi-a", "kiwi-b", "kiwi-c"]) {
      expect(await exists(path.join(dest, name)), `${name} was held back by an unrelated directory`).toBe(false);
    }
    expect(await exists(path.join(dest, "kiwi-drifted"))).toBe(true);
    expect(outcome.removed).toHaveLength(3);
    expect(keptPaths(outcome)).toEqual([path.join(dest, "kiwi-drifted")]);
  });
});

describe("FR-NODE-190 AC-7 — the shared mirror is reconciled after the removals", () => {
  it("keeps a contract a surviving skill still cites and drops one nothing cites", async () => {
    const root = await tempRoot();
    await writeSharedContract(root, "kept-contract.md");
    await writeSharedContract(root, "orphan-contract.md");
    // kiwi-survivor drifts and so survives removal; its citation must protect its contract.
    await writeSourceSkill(root, "kiwi-survivor", ["kept-contract.md"]);
    await writeSourceSkill(root, "kiwi-going", ["orphan-contract.md"]);
    await installClaudeAll(root);
    const dest = claudeDest(root);
    await writeFile(path.join(dest, "kiwi-survivor", "references", "guide.md"), "edited\n", "utf8");

    const outcome = await removeAll(dest, claudeSource(root));

    expect(await exists(path.join(dest, "kiwi-going"))).toBe(false);
    expect(await exists(path.join(dest, "_shared", "kiwi", "kept-contract.md")), "a surviving skill's contract was deleted").toBe(true);
    // Reconciling before the removals would see kiwi-going's citation and keep this file forever.
    expect(await exists(path.join(dest, "_shared", "kiwi", "orphan-contract.md"))).toBe(false);
    expect(outcome.removed).toContain(path.join(dest, "_shared", "kiwi", "orphan-contract.md"));
  });
});

describe("FR-NODE-190 AC-7 — the shared mirror is reconciled by ownership, not by position", () => {
  it("keeps an operator's own file in _shared/kiwi that no bundled source matches", async () => {
    // `_shared/kiwi` is a directory inside the agent's skill root, and the global one is shared by
    // every project on the machine. Deleting whatever is unreferenced there took a file called
    // `private/keys.md` in adversarial testing — unreferenced is not the same fact as unowned.
    const root = await tempRoot();
    await writeSharedContract(root, "bundled.md");
    await writeSourceSkill(root, "kiwi-going", ["bundled.md"]);
    await installClaudeAll(root);
    const dest = claudeDest(root);
    const mine = path.join(dest, "_shared", "kiwi", "my-team-contract.md");
    await mkdir(path.dirname(mine), { recursive: true });
    await writeFile(mine, "our own contract\n", "utf8");

    const outcome = await removeAll(dest, claudeSource(root));

    expect(await exists(mine), "an operator's own shared file was deleted").toBe(true);
    expect(outcome.kept.find((entry) => entry.path === mine)?.reason).toBe("user-authored");
    // The bundled one still goes, or the guard has simply stopped the reconciliation working.
    expect(await exists(path.join(dest, "_shared", "kiwi", "bundled.md"))).toBe(false);
  });

  it("keeps a mirrored shared file the operator edited", async () => {
    const root = await tempRoot();
    await writeSharedContract(root, "bundled.md");
    await writeSourceSkill(root, "kiwi-going", ["bundled.md"]);
    await installClaudeAll(root);
    const dest = claudeDest(root);
    const mirrored = path.join(dest, "_shared", "kiwi", "bundled.md");
    await writeFile(mirrored, "# bundled.md\n\nplus my own note\n", "utf8");

    const outcome = await removeAll(dest, claudeSource(root));

    expect(await exists(mirrored), "an edited shared file was deleted").toBe(true);
    expect(outcome.kept.find((entry) => entry.path === mirrored)?.reason).toBe("locally-modified");
  });
});

describe("FR-NODE-190 AC-8 — the ownership verdict has one implementation", () => {
  it("is reached by init's prune through the same exported function", async () => {
    // Two implementations would drift the way CLAUDE.md §10.2 describes: one side gains a gate the
    // other does not, and here the divergence deletes a user's files.
    const initSource = await readFile(new URL("../../../src/core/bootstrap/init-project.ts", import.meta.url), "utf8");
    expect(initSource, "init reaches the verdict by some other path").toContain("removeManagedKiwiSkills");

    // The checksum is the verdict's last and most consequential gate. Counting how often the installer
    // mentions it would pin a number that every edit invalidates and that proves nothing; what matters
    // is that the field is not readable from anywhere else. A second module reading it is a second
    // verdict, whatever the call graph looks like.
    const srcRoot = new URL("../../../src/", import.meta.url);
    const installer = path.join(fileURLToPath(srcRoot), "core", "skills", "install-skill.ts");
    const offenders: string[] = [];
    for (const file of await sourceFiles(fileURLToPath(srcRoot))) {
      if (file === installer) continue;
      if ((await readFile(file, "utf8")).includes("installedChecksum")) offenders.push(file);
    }
    expect(offenders, "the ownership verdict's checksum gate is read outside the installer").toEqual([]);
  });
});
