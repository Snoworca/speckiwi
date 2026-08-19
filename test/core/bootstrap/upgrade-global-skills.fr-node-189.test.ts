import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { upgradeProject } from "../../../src/core/bootstrap/upgrade-project.js";
import { resolveProjectRoot } from "../../../src/core/project-root.js";

// @req FR-NODE-189 — `speckiwi upgrade` refreshes the installed agents' global skills by asking the
// init it already delegates to, rather than growing a global pass of its own.
//
// Every case pins BOTH the home dir and the codex home to a temp home. An ambient CODEX_HOME or a
// missed seam would otherwise point the global pass at the developer's real ~/.claude and ~/.codex,
// and this suite's whole subject is a command that writes to global skill roots.

async function tempHome(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), "speckiwi-upgrade-home-"));
}

/** A project as an older speckiwi left it: an index, a scope document, and a git dir. */
async function legacyProject(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "speckiwi-upgrade-global-"));
  await mkdir(path.join(root, ".git"));
  await mkdir(path.join(root, "docs", "spec"), { recursive: true });
  await mkdir(path.join(root, "docs", "rule"), { recursive: true });
  await writeFile(
    path.join(root, "docs", "spec", "00.index.md"),
    [
      "# Demo SRS Index",
      "",
      "| Field | Value |",
      "|---|---|",
      "| Document Type | srs_index |",
      "| Product | Demo |",
      "| Active Target | v1.0.0 |",
      "",
      "## 1. Purpose",
      "",
      "Authored prose that no migration may touch.",
      ""
    ].join("\n"),
    "utf8"
  );
  // A retired rules document plus an agent file citing it: the dangling reference the migration
  // repairs. Without this the repair has nothing to find, and asserting that the global pass left
  // it intact would hold over an empty list.
  await writeFile(path.join(root, "docs", "rule", "SRS-MD-Rules-v1.0.0.md"), "# Old rules\n", "utf8");
  await writeFile(path.join(root, "CLAUDE.md"), "# Notes\n\nRead [rules](docs/rule/SRS-MD-Rules-v1.0.0.md).\n", "utf8");
  return root;
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

async function fixtureSource(base: string): Promise<void> {
  await writeFixtureSkill(base, "claude", "kiwi-keep");
  await writeFixtureSkill(base, "codex", "kiwi-keep");
}

async function exists(target: string): Promise<boolean> {
  return access(target).then(() => true).catch(() => false);
}

type UpgradeInput = Parameters<typeof upgradeProject>[1];

/** The hermetic global seam, spelled once so no case can forget half of it. */
function globalSeam(home: string, base: string): Partial<UpgradeInput> {
  return {
    installSkillsGlobal: true,
    globalHomeDir: home,
    globalCodexHome: path.join(home, ".codex"),
    skillSourceBaseDir: base
  };
}

async function runUpgrade(root: string, input: UpgradeInput) {
  const result = await upgradeProject(await resolveProjectRoot(root), input);
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}

/** A project plus a temp home with the requested agent homes present, and a fixture skill source. */
async function scenario(agents: ReadonlyArray<"claude" | "codex">) {
  const root = await legacyProject();
  const base = path.join(root, "skills");
  await fixtureSource(base);
  const home = await tempHome();
  for (const agent of agents) await mkdir(path.join(home, `.${agent}`));
  return {
    root,
    base,
    home,
    claudeGlobal: path.join(home, ".claude", "skills", "kiwi-keep"),
    codexGlobal: path.join(home, ".codex", "skills", "kiwi-keep")
  };
}

describe("FR-NODE-189 AC-1 — the global refresh happens and the project migration still completes", () => {
  it("installs the bundled skills under both global roots", async () => {
    const s = await scenario(["claude", "codex"]);
    const value = await runUpgrade(s.root, { apply: true, ...globalSeam(s.home, s.base) });
    expect(await exists(path.join(s.claudeGlobal, "SKILL.md"))).toBe(true);
    expect(await exists(path.join(s.codexGlobal, "SKILL.md"))).toBe(true);
    expect(value.init.created).toContain(s.claudeGlobal);
    expect(value.init.created).toContain(s.codexGlobal);
  });

  it("still performs the project-scope repairs the migration exists for", async () => {
    const s = await scenario(["claude", "codex"]);
    const value = await runUpgrade(s.root, { apply: true, ...globalSeam(s.home, s.base) });
    // The index had no `| Rules |` row; inserting one is the repair init cannot do.
    expect(value.rulesRowInsertion, "the global pass displaced the migration's own repair").toBeDefined();
    const index = await readFile(path.join(s.root, "docs", "spec", "00.index.md"), "utf8");
    expect(index).toMatch(/\|\s*Rules\s*\|/);
    expect(index, "authored prose was touched").toContain("Authored prose that no migration may touch.");
    // The migration's other repair. Asserting it needs a fixture that actually dangles, or the
    // assertion passes over an empty list and says nothing about the global pass.
    expect(value.references.length, "the dangling rules reference was not repaired").toBeGreaterThan(0);
    expect(await readFile(path.join(s.root, "CLAUDE.md"), "utf8")).not.toContain("SRS-MD-Rules-v1.0.0.md");
  });
});

describe("FR-NODE-189 AC-2 — without the option the global footprint is empty", () => {
  it("creates no global skills directory", async () => {
    const s = await scenario(["claude", "codex"]);
    await runUpgrade(s.root, { apply: true, skillSourceBaseDir: s.base, globalHomeDir: s.home, globalCodexHome: path.join(s.home, ".codex") });
    expect(await exists(path.join(s.home, ".claude", "skills"))).toBe(false);
    expect(await exists(path.join(s.home, ".codex", "skills"))).toBe(false);
  });

  it("reports no path under the home in any result array", async () => {
    // Asserting only on the filesystem would miss a report that claims global work it did not do —
    // and a caller reading `created` is exactly who would then believe the global skills are current.
    const s = await scenario(["claude", "codex"]);
    const value = await runUpgrade(s.root, { apply: true, skillSourceBaseDir: s.base, globalHomeDir: s.home, globalCodexHome: path.join(s.home, ".codex") });
    const everyPath = [...value.init.created, ...value.init.updated, ...value.init.skipped, ...value.init.removed];
    expect(everyPath.filter((entry) => entry.startsWith(s.home))).toEqual([]);
  });
});

describe("FR-NODE-189 AC-3 — the global pass never prunes", () => {
  it("leaves a managed skill that has left the source set in place", async () => {
    const s = await scenario(["claude", "codex"]);
    await writeFixtureSkill(s.base, "claude", "kiwi-retired");
    const retired = path.join(s.home, ".claude", "skills", "kiwi-retired");

    // First run installs both, with real speckiwi metadata and a matching checksum.
    await runUpgrade(s.root, { apply: true, ...globalSeam(s.home, s.base) });
    expect(await exists(path.join(retired, "SKILL.md"))).toBe(true);

    // The release retires it. A project-scope prune would delete it; the global pass must not — the
    // shared home may serve another project still pinned to the version that ships it.
    await rm(path.join(s.base, "claude", "kiwi-retired"), { recursive: true, force: true });
    const second = await runUpgrade(s.root, { apply: true, ...globalSeam(s.home, s.base) });

    expect(await exists(path.join(retired, "SKILL.md"))).toBe(true);
    expect(second.init.removed.filter((entry) => entry.startsWith(s.home))).toEqual([]);
  });
});

describe("FR-NODE-189 AC-4 — an absent agent home is skipped, not fatal", () => {
  it("provisions the present agent and warns about the absent one", async () => {
    const s = await scenario(["claude"]); // codex home absent
    const value = await runUpgrade(s.root, { apply: true, ...globalSeam(s.home, s.base) });
    expect(await exists(path.join(s.claudeGlobal, "SKILL.md"))).toBe(true);
    expect(await exists(path.join(s.home, ".codex", "skills"))).toBe(false);
    expect((value.init.warnings ?? []).some((w) => /codex/i.test(w) && /global/i.test(w))).toBe(true);
    // `applied` only echoes the input, so it says nothing here. What shows the migration still ran
    // past the skipped agent is its own repair landing on disk.
    expect(value.rulesRowInsertion, "the absent agent aborted the project migration").toBeDefined();
  });
});

describe("FR-NODE-189 AC-5 — dry-run plans the global destinations and writes nothing", () => {
  it("names the global roots in the plan without creating them", async () => {
    const s = await scenario(["claude", "codex"]);
    const value = await runUpgrade(s.root, { ...globalSeam(s.home, s.base) }); // apply omitted -> plan
    expect(await exists(path.join(s.home, ".claude", "skills"))).toBe(false);
    expect(await exists(path.join(s.home, ".codex", "skills"))).toBe(false);
    expect(value.init.created.some((entry) => entry.startsWith(path.join(s.home, ".claude", "skills")))).toBe(true);
    expect(value.init.created.some((entry) => entry.startsWith(path.join(s.home, ".codex", "skills")))).toBe(true);
  });

  it("reports the same project-scope findings as the plan without the option", async () => {
    // The flag adds a destination; it must not change what the migration says about the project. A
    // plan whose project findings shift when an unrelated flag is passed cannot be read as the plan
    // for the run that follows.
    const withGlobal = await scenario(["claude", "codex"]);
    const withoutGlobal = await scenario(["claude", "codex"]);
    const a = await runUpgrade(withGlobal.root, { ...globalSeam(withGlobal.home, withGlobal.base) });
    const b = await runUpgrade(withoutGlobal.root, { skillSourceBaseDir: withoutGlobal.base });

    const projectScope = (value: Awaited<ReturnType<typeof runUpgrade>>, root: string, home: string): string[] =>
      value.init.created
        .filter((entry) => !entry.startsWith(home))
        .map((entry) => path.relative(root, entry).split(path.sep).join("/"))
        .sort();

    expect(projectScope(a, withGlobal.root, withGlobal.home)).toEqual(projectScope(b, withoutGlobal.root, withoutGlobal.home));
    expect(a.rulesRowInsertion?.row).toEqual(b.rulesRowInsertion?.row);
    expect(a.boundaries).toEqual(b.boundaries);
  });
});

describe("FR-NODE-189 AC-6 — upgrade declares no global resolution of its own", () => {
  it("names no home directory, agent home, or CODEX_HOME in its source", async () => {
    // The one defect this requirement is most likely to reproduce. IR-CLI-086 records the last time
    // three entry points each decided where a global install lands: `skills install` read the home
    // directory while `init --global` and `doctor` read CODEX_HOME, and they disagreed. A second
    // resolution here would disagree the same way, and the failure is silent — upgrade would refresh
    // a directory nobody installs into and report success.
    const source = await readFile(new URL("../../../src/core/bootstrap/upgrade-project.ts", import.meta.url), "utf8");
    for (const forbidden of ["CODEX_HOME", "USERPROFILE", '".claude"', '".codex"', "process.env.HOME", "homedir"]) {
      expect(source, `upgrade-project.ts resolves global destinations itself via ${forbidden}`).not.toContain(forbidden);
    }
  });
});
