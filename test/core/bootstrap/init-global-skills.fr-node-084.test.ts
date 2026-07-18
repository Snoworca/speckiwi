import { access, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { initProject } from "../../../src/core/bootstrap/init-project.js";
import { resolveProjectRoot } from "../../../src/core/project-root.js";

// @req FR-NODE-084 — speckiwi init global skill provisioning under --global with per-agent presence gate.

async function emptyRepo(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "speckiwi-init-global-"));
  await mkdir(path.join(root, ".git"));
  return root;
}

async function tempHome(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), "speckiwi-home-"));
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

// Pin BOTH the home dir and the codex home to the hermetic temp home so an ambient CODEX_HOME env var can
// never redirect the global pass at the developer's real ~/.codex.
function globalInput(home: string, base: string, extra: Partial<Parameters<typeof initProject>[1]> = {}): Parameters<typeof initProject>[1] {
  return { installSkills: true, installSkillsGlobal: true, globalHomeDir: home, globalCodexHome: path.join(home, ".codex"), skillSourceBaseDir: base, ...extra };
}

describe("speckiwi init global skill provisioning (FR-NODE-084)", () => {
  it("AC-1: both agent homes present -> installs global skills for claude and codex", async () => {
    const root = await emptyRepo();
    const base = path.join(root, "skills");
    await fixtureSource(base);
    const home = await tempHome();
    await mkdir(path.join(home, ".claude"));
    await mkdir(path.join(home, ".codex"));
    const value = await runInit(root, globalInput(home, base));
    const claudeGlobal = path.join(home, ".claude", "skills", "kiwi-keep");
    const codexGlobal = path.join(home, ".codex", "skills", "kiwi-keep");
    expect(await exists(path.join(claudeGlobal, "SKILL.md"))).toBe(true);
    expect(await exists(path.join(codexGlobal, "SKILL.md"))).toBe(true);
    expect(value.created).toContain(claudeGlobal);
    expect(value.created).toContain(codexGlobal);
  });

  it("AC-2: codex home absent -> codex global skipped with warning, claude global still installed", async () => {
    const root = await emptyRepo();
    const base = path.join(root, "skills");
    await fixtureSource(base);
    const home = await tempHome();
    await mkdir(path.join(home, ".claude")); // only claude present
    const value = await runInit(root, globalInput(home, base));
    expect(await exists(path.join(home, ".claude", "skills", "kiwi-keep", "SKILL.md"))).toBe(true);
    expect(await exists(path.join(home, ".codex", "skills"))).toBe(false);
    expect((value.warnings ?? []).some((w) => /codex/i.test(w) && /global/i.test(w))).toBe(true);
  });

  it("AC-3: claude home absent -> claude global skipped with warning, codex global still installed", async () => {
    const root = await emptyRepo();
    const base = path.join(root, "skills");
    await fixtureSource(base);
    const home = await tempHome();
    await mkdir(path.join(home, ".codex")); // only codex present
    const value = await runInit(root, globalInput(home, base));
    expect(await exists(path.join(home, ".codex", "skills", "kiwi-keep", "SKILL.md"))).toBe(true);
    expect(await exists(path.join(home, ".claude", "skills"))).toBe(false);
    expect((value.warnings ?? []).some((w) => /claude/i.test(w) && /global/i.test(w))).toBe(true);
  });

  it("AC-4: neither home present -> no global dirs created, warnings for both, project still provisioned", async () => {
    const root = await emptyRepo();
    const base = path.join(root, "skills");
    await fixtureSource(base);
    const home = await tempHome(); // empty home, no agent dirs
    const value = await runInit(root, globalInput(home, base));
    expect(await exists(path.join(home, ".claude", "skills"))).toBe(false);
    expect(await exists(path.join(home, ".codex", "skills"))).toBe(false);
    expect((value.warnings ?? []).filter((w) => /global/i.test(w)).length).toBeGreaterThanOrEqual(2);
    // project scope still done
    expect(await exists(path.join(root, ".claude", "skills", "kiwi-keep"))).toBe(true);
  });

  it("AC-5: global pass is additive - project scope provisioning still runs and is reported", async () => {
    const root = await emptyRepo();
    const base = path.join(root, "skills");
    await fixtureSource(base);
    const home = await tempHome();
    await mkdir(path.join(home, ".claude"));
    await mkdir(path.join(home, ".codex"));
    const value = await runInit(root, globalInput(home, base));
    const projectClaude = path.join(root, ".claude", "skills", "kiwi-keep");
    const projectCodex = path.join(root, ".agents", "skills", "kiwi-keep");
    expect(value.created).toContain(projectClaude);
    expect(value.created).toContain(projectCodex);
    expect(await exists(path.join(projectClaude, "SKILL.md"))).toBe(true);
  });

  it("AC-6: reuses update/skip classification; never prunes at global scope (managed orphan survives)", async () => {
    const root = await emptyRepo();
    const base = path.join(root, "skills");
    await fixtureSource(base);
    await writeFixtureSkill(base, "claude", "kiwi-extra"); // a second managed skill
    const home = await tempHome();
    await mkdir(path.join(home, ".claude"));
    await mkdir(path.join(home, ".codex"));
    const claudeGlobal = path.join(home, ".claude", "skills", "kiwi-keep");
    const extraGlobal = path.join(home, ".claude", "skills", "kiwi-extra");
    // Pre-seed a user-authored (metadata-less) kiwi-* dir — must survive.
    const userAuthored = path.join(home, ".claude", "skills", "kiwi-mine");
    await mkdir(userAuthored, { recursive: true });
    await writeFile(path.join(userAuthored, "SKILL.md"), "---\nname: kiwi-mine\ndescription: mine\n---\n# mine\n", "utf8");

    // First run installs BOTH managed skills globally (with valid speckiwi metadata + checksum).
    await runInit(root, globalInput(home, base));
    expect(await exists(path.join(extraGlobal, "SKILL.md"))).toBe(true);

    // Drop kiwi-extra from the source: it becomes a *managed* orphan (valid metadata, absent from source).
    // A project-scope prune WOULD delete it; the global pass must not.
    await rm(path.join(base, "claude", "kiwi-extra"), { recursive: true, force: true });
    const second = await runInit(root, globalInput(home, base));
    expect(await exists(path.join(extraGlobal, "SKILL.md"))).toBe(true); // managed orphan survives
    expect(await exists(path.join(userAuthored, "SKILL.md"))).toBe(true); // user-authored survives
    expect(second.removed.some((p) => p.startsWith(home))).toBe(false); // nothing global removed
    expect(second.skipped).toContain(claudeGlobal); // unchanged managed skill -> skip

    // change the source -> update
    await writeFile(path.join(base, "claude", "kiwi-keep", "references", "guide.md"), "changed content\n", "utf8");
    const third = await runInit(root, globalInput(home, base));
    expect(third.updated).toContain(claudeGlobal);
  });

  it("AC-7: dry-run + global -> plan references global dests and writes nothing", async () => {
    const root = await emptyRepo();
    const base = path.join(root, "skills");
    await fixtureSource(base);
    const home = await tempHome();
    await mkdir(path.join(home, ".claude"));
    await mkdir(path.join(home, ".codex"));
    const value = await runInit(root, globalInput(home, base, { dryRun: true }));
    expect(await exists(path.join(home, ".claude", "skills"))).toBe(false);
    expect(await exists(path.join(home, ".codex", "skills"))).toBe(false);
    expect(value.created.some((p) => p.startsWith(path.join(home, ".claude", "skills")))).toBe(true);
    expect(value.created.some((p) => p.startsWith(path.join(home, ".codex", "skills")))).toBe(true);
  });

  it("does not provision globally when installSkillsGlobal is not set (MCP init_project parity)", async () => {
    const root = await emptyRepo();
    const base = path.join(root, "skills");
    await fixtureSource(base);
    const home = await tempHome();
    await mkdir(path.join(home, ".claude"));
    await mkdir(path.join(home, ".codex"));
    await runInit(root, { installSkills: true, globalHomeDir: home, globalCodexHome: path.join(home, ".codex"), skillSourceBaseDir: base });
    expect(await exists(path.join(home, ".claude", "skills"))).toBe(false);
    expect(await exists(path.join(home, ".codex", "skills"))).toBe(false);
  });
});
