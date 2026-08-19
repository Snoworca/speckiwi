import { access, mkdir, mkdtemp, readFile, readdir, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { initProject } from "../../../src/core/bootstrap/init-project.js";
import { removeProject } from "../../../src/core/bootstrap/remove-project.js";
import { resolveProjectRoot } from "../../../src/core/project-root.js";

// @req FR-NODE-192 — the guard against a root that is really an agent's global home, and the report
// contract that keeps a partial removal from reading as a finished one.
//
// The guard is not hypothetical. On the machine this was written on, the home directory holds
// `docs/spec/00.index.md` and no `.git`, so a removal run from anywhere beneath it outside another
// repository resolves the root to the home directory — and `<root>/.claude/skills` is then the global
// skill directory, holding the user's own skills beside the managed ones.

async function exists(target: string): Promise<boolean> {
  return access(target).then(() => true).catch(() => false);
}

async function writeFixtureSkill(base: string, subdir: "claude" | "codex", name: string): Promise<void> {
  const dir = path.join(base, subdir, name);
  await mkdir(dir, { recursive: true });
  await writeFile(
    path.join(dir, "SKILL.md"),
    ["---", `name: ${name}`, "description: test skill", "---", "", `# ${name}`, "", "Normal operation requires speckiwi mcp."].join("\n"),
    "utf8"
  );
}

/**
 * A directory that is BOTH the resolved project root and the agent home — the shape the real home
 * directory has. `.claude/skills` under it is simultaneously the project and the global destination.
 */
async function homeShapedRoot(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "speckiwi-remove-homeroot-"));
  await mkdir(path.join(root, "docs", "spec"), { recursive: true });
  await writeFile(path.join(root, "docs", "spec", "00.index.md"), "# Index\n", "utf8");
  await mkdir(path.join(root, ".claude", "skills"), { recursive: true });
  await mkdir(path.join(root, ".codex"), { recursive: true });
  return root;
}

/** An ordinary project, initialised, with the global seams pinned away from the real home. */
async function initialisedProject(): Promise<{ root: string; home: string }> {
  const root = await mkdtemp(path.join(tmpdir(), "speckiwi-remove-guard-"));
  await mkdir(path.join(root, ".git", "hooks"), { recursive: true });
  const base = path.join(root, "skills");
  await writeFixtureSkill(base, "claude", "kiwi-keep");
  await writeFixtureSkill(base, "codex", "kiwi-keep");
  const home = await mkdtemp(path.join(tmpdir(), "speckiwi-guard-home-"));
  const result = await initProject(await resolveProjectRoot(root), {
    installSkills: true,
    registerMcp: true,
    skillSourceBaseDir: base,
    globalHomeDir: home,
    globalCodexHome: path.join(home, ".codex")
  });
  if (!result.ok) throw new Error(result.error.message);
  return { root, home };
}

type RemoveInput = Parameters<typeof removeProject>[1];

async function attempt(root: string, input: RemoveInput) {
  return removeProject(await resolveProjectRoot(root), input);
}

async function runRemove(root: string, input: RemoveInput) {
  const result = await attempt(root, input);
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}

describe("FR-NODE-192 AC-1 — a root that is an agent's global home is refused at project scope", () => {
  it("refuses, removes nothing, and names both the root and the colliding destination", async () => {
    const root = await homeShapedRoot();
    const globalSeam = { globalHomeDir: root, globalCodexHome: path.join(root, ".codex") };
    // A managed-looking directory that must survive the refusal.
    await mkdir(path.join(root, ".claude", "skills", "kiwi-mine"), { recursive: true });
    await writeFile(path.join(root, ".claude", "skills", "kiwi-mine", "SKILL.md"), "mine\n", "utf8");

    const result = await attempt(root, { apply: true, ...globalSeam });

    expect(result.ok, "a project-scope run against an agent home was allowed to proceed").toBe(false);
    expect(result.error?.message, "the refusal does not name the resolved root").toContain(root);
    expect(result.error?.message, "the refusal does not name the colliding destination").toContain(
      path.join(root, ".claude", "skills")
    );
    expect(await exists(path.join(root, ".claude", "skills", "kiwi-mine"))).toBe(true);
  });
});

describe("FR-NODE-192 AC-1 — the guard survives two spellings of the same directory", () => {
  it("refuses when the home is reached through a link and the root is not", async () => {
    // The case the plain collision test cannot reach: it hands the same string to both sides, so it
    // holds for any comparison at all, including one that only compares strings. Here the two sides
    // spell one directory differently — which is the ordinary state, because `resolveProjectRoot`
    // realpath's the root while the home comes straight from HOME/USERPROFILE. Measured before the
    // fix: not refused, and the managed global skill was deleted by a project-scope call.
    const parent = await mkdtemp(path.join(tmpdir(), "speckiwi-link-"));
    const realHome = path.join(parent, "realhome");
    await mkdir(path.join(realHome, "docs", "spec"), { recursive: true });
    await writeFile(path.join(realHome, "docs", "spec", "00.index.md"), "# Index\n", "utf8");
    await mkdir(path.join(realHome, ".claude", "skills"), { recursive: true });
    await mkdir(path.join(realHome, ".codex"), { recursive: true });
    const linkHome = path.join(parent, "linkhome");
    try {
      await symlink(realHome, linkHome, "junction");
    } catch {
      return; // Link creation is privileged on some Windows configurations; the case cannot run.
    }

    const result = await attempt(realHome, {
      apply: true,
      globalHomeDir: linkHome,
      globalCodexHome: path.join(linkHome, ".codex")
    });

    expect(result.ok, "the guard compared spellings rather than locations").toBe(false);
  });
});

describe("FR-NODE-192 AC-2 — the same collision is allowed once global scope is asked for", () => {
  it("proceeds, because the guard blocks the scope that did not ask, not the destination", async () => {
    const root = await homeShapedRoot();

    const result = await attempt(root, {
      apply: true,
      scope: "global",
      globalHomeDir: root,
      globalCodexHome: path.join(root, ".codex")
    });

    expect(result.ok, result.error?.message).toBe(true);
    expect(result.value?.scope).toBe("global");
  });
});

describe("FR-NODE-192 AC-3 — an ordinary root proceeds and is reported", () => {
  it("returns the resolved absolute root", async () => {
    const { root, home } = await initialisedProject();

    const value = await runRemove(root, { apply: true, globalHomeDir: home, globalCodexHome: path.join(home, ".codex") });

    // realpath, so a temp dir behind a symlink still compares equal to what the resolver returned.
    expect(value.root).toBe((await resolveProjectRoot(root)).root);
    expect(path.isAbsolute(value.root)).toBe(true);
  });
});

describe("FR-NODE-192 AC-4 — a run that kept something does not report a clean completion", () => {
  it("flags incompleteness in a field a caller can branch on, with a reason per kept path", async () => {
    const { root, home } = await initialisedProject();
    // A user-authored skill: the verdict can never prove speckiwi wrote it, so it stays.
    await mkdir(path.join(root, ".claude", "skills", "kiwi-mine"), { recursive: true });
    await writeFile(path.join(root, ".claude", "skills", "kiwi-mine", "SKILL.md"), "mine\n", "utf8");

    const value = await runRemove(root, { apply: true, globalHomeDir: home, globalCodexHome: path.join(home, ".codex") });

    expect(value.kept.length).toBeGreaterThan(0);
    expect(value.complete, "a partial removal reported itself as complete").toBe(false);
    for (const entry of value.kept) expect(entry.reason, `${entry.path} was kept with no reason`).toBeTruthy();
  });

  it("reports completion when nothing was kept", async () => {
    // Without this the previous case passes against an implementation that hardcodes `false`.
    const { root, home } = await initialisedProject();

    const value = await runRemove(root, { apply: true, globalHomeDir: home, globalCodexHome: path.join(home, ".codex") });

    expect(value.kept).toEqual([]);
    expect(value.complete).toBe(true);
  });
});

describe("FR-NODE-192 AC-5 — policy exclusions are reported apart from verdict-kept paths", () => {
  it("names each excluded location with the policy that excluded it", async () => {
    const { root, home } = await initialisedProject();

    const value = await runRemove(root, { apply: true, globalHomeDir: home, globalCodexHome: path.join(home, ".codex") });

    const excluded = value.excluded.map((entry) => entry.path.replace(/\\/g, "/"));
    for (const location of ["docs/spec", "docs/rule", "docs/.kiwi/trace"]) {
      expect(excluded.some((entry) => entry.endsWith(location)), `${location} is not reported as excluded`).toBe(true);
    }
    // The two lists answer different questions — "we could not prove we wrote this" versus "we refuse
    // to touch this" — and collapsing them would lose the distinction that makes the report readable.
    expect(value.excluded.every((entry) => !value.kept.some((k) => k.path === entry.path))).toBe(true);
  });
});

describe("FR-NODE-192 AC-6 — a second run is a clean no-op", () => {
  it("succeeds, removes nothing, keeps nothing, and writes nothing", async () => {
    const { root, home } = await initialisedProject();
    const seam = { globalHomeDir: home, globalCodexHome: path.join(home, ".codex") };
    await runRemove(root, { apply: true, ...seam });
    const before = await snapshot(root);

    const second = await runRemove(root, { apply: true, ...seam });

    expect(second.removed).toEqual([]);
    expect(second.kept).toEqual([]);
    expect(second.complete).toBe(true);
    expect(await snapshot(root), "the second run wrote to the workspace").toEqual(before);
  });
});

describe("FR-NODE-192 AC-8 — a global run leaves no trace in the project", () => {
  it("writes nothing under the project root, not even the lock's status file", async () => {
    // `-g` selects the global destination instead of the project, so anything appearing under the
    // project contradicts what was asked for. Measured before the fix: the mutation lock created
    // `<root>/kiwi/.status.json` on a run that was supposed to touch only the agents' homes.
    const { root, home } = await initialisedProject();
    const before = await snapshot(root, { includeLockState: true });

    await runRemove(root, { apply: true, scope: "global", globalHomeDir: home, globalCodexHome: path.join(home, ".codex") });

    expect(await snapshot(root, { includeLockState: true }), "a global-scope run wrote into the project").toEqual(before);
  });
});

describe("FR-NODE-192 AC-7/AC-9/AC-10 — shared resolution, and the npm boundary is stated", () => {
  it("reads no environment variable and joins no path onto a home directory", async () => {
    // The distinction that matters is resolving versus forwarding. Handing the installer a CODEX_HOME
    // that `resolveGlobalSkillContext` already produced is forwarding — init does exactly that, and
    // the value still comes from one place. Reading `process.env` here, or joining an agent directory
    // onto a home directory, would be a second answer to the question IR-CLI-086 already settled:
    // three entry points once disagreed about where a global install lands, and a removal that
    // disagrees deletes nothing while reporting success.
    const source = await readFile(fileURLToPath(new URL("../../../src/core/bootstrap/remove-project.ts", import.meta.url)), "utf8");
    expect(source, "remove-project reads the environment itself instead of taking the resolved context").not.toMatch(/process\.env/);
    expect(source, "remove-project resolves a home directory through node:os").not.toMatch(/homedir/);
    expect(source, "remove-project computes an agent home path itself").not.toMatch(/path\.join\(\s*(?:\w+\.)?homeDir/);
    // Scoped to path construction rather than to the literal's punctuation: the previous form keyed on
    // a double-quoted last argument and was satisfied by `path.join(x, 'skills')`.
    expect(source, "remove-project builds a skills directory path itself").not.toMatch(/path\.join\([^)]*skills/i);
    // And it must actually go through the shared resolver, or the three assertions above are satisfied
    // by a module that resolves nothing because it removes nothing.
    expect(source, "remove-project does not use the installer's destination resolver").toContain("resolveSkillDestinationRoot");
  });

  it("states that the npm-installed program is not what this command removes", async () => {
    const { root, home } = await initialisedProject();

    const value = await runRemove(root, { apply: true, globalHomeDir: home, globalCodexHome: path.join(home, ".codex") });

    const notes = value.notes.join("\n");
    expect(notes, "the report does not mention npm at all").toMatch(/npm/i);
    // Naming the boundary without naming the command leaves the reader to guess it.
    expect(notes).toContain("npm uninstall -g speckiwi");
  });
});

describe("FR-NODE-192 — a plan writes nothing", () => {
  it("reports the same intended removals without touching the workspace", async () => {
    const { root, home } = await initialisedProject();
    const seam = { globalHomeDir: home, globalCodexHome: path.join(home, ".codex") };
    const before = await snapshot(root);

    const plan = await runRemove(root, { ...seam }); // apply omitted

    expect(plan.applied).toBe(false);
    expect(plan.removed.length, "a plan that names nothing is not a plan").toBeGreaterThan(0);
    expect(await snapshot(root), "the plan wrote to the workspace").toEqual(before);
  });
});

/**
 * Every file under the project, by relative path, for byte-comparison across a run.
 *
 * `kiwi/` is excluded: the SRS mutation lock writes a status file carrying a fresh `generatedAt` on
 * every guarded mutation, so including it would report a difference for any second run whatsoever and
 * say nothing about whether removal itself wrote. Measured — it was the only difference.
 */
async function snapshot(root: string, options: { includeLockState?: boolean } = {}): Promise<Map<string, string>> {
  const files = new Map<string, string>();
  async function walk(dir: string): Promise<void> {
    for (const entry of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
      const full = path.join(dir, entry.name);
      const relative = path.relative(root, full).split(path.sep).join("/");
      // `kiwi/` is normally excluded because a project-scope mutation legitimately rewrites the
      // lock's status file on every run. AC-8 is the claim that a GLOBAL run does not, so that case
      // includes it — and by content, not by presence: init already created the directory, so
      // comparing existence compares equal whether or not the global run took the lock.
      if (relative === "kiwi" && !options.includeLockState) continue;
      if (entry.isDirectory()) await walk(full);
      else if (entry.isFile()) files.set(relative, await readFile(full, "utf8"));
    }
  }
  await walk(root);
  return files;
}
