import type * as FsPromises from "node:fs/promises";
import { access, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { initProject } from "../../../src/core/bootstrap/init-project.js";
import { removeProject } from "../../../src/core/bootstrap/remove-project.js";
import { diagnoseHealth } from "../../../src/core/health/doctor.js";
import { parseWorkspace } from "../../../src/core/parser/workspace-parser.js";
import { resolveProjectRoot } from "../../../src/core/project-root.js";
import { installSkill } from "../../../src/core/skills/install-skill.js";

// @req FR-NODE-228 AC-10 — the deprecated Codex root is a directory SpecKiwi does not own, so failing to
// list it must cost only its cleanup: never the install that already wrote its copies, never the whole
// doctor report. The listing failure is injected (the same fault-injection shape the run-lock tests use),
// because a portable unreadable directory cannot be made without platform tools.

const denied = vi.hoisted(() => new Set<string>());

vi.mock("node:fs/promises", async (original) => {
  const actual = await original<typeof FsPromises>();
  const key = (target: unknown): string => path.resolve(String(target)).toLowerCase();
  return {
    ...actual,
    readdir: (async (target: Parameters<typeof actual.readdir>[0], ...rest: unknown[]) => {
      if (denied.has(key(target))) throw Object.assign(new Error(`EPERM: operation not permitted, scandir '${String(target)}'`), { code: "EPERM" });
      return (actual.readdir as (...args: unknown[]) => Promise<unknown>)(target, ...rest);
    }) as typeof actual.readdir
  };
});

afterEach(() => {
  denied.clear();
});

async function exists(target: string): Promise<boolean> {
  return access(target).then(() => true).catch(() => false);
}

/** A project with one bundled skill for each agent, a temp home, and an old SpecKiwi copy in `<home>/.codex/skills`. */
async function scenario() {
  const root = await mkdtemp(path.join(tmpdir(), "speckiwi-fr-node-228-unreadable-"));
  await mkdir(path.join(root, ".git"), { recursive: true });
  const base = path.join(root, "skills");
  for (const agent of ["claude", "codex"]) {
    const dir = path.join(base, agent, "kiwi-keep");
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, "SKILL.md"), ["---", "name: kiwi-keep", "description: test skill", "---", "", "# kiwi-keep", ""].join("\n"), "utf8");
  }
  const home = await mkdtemp(path.join(tmpdir(), "speckiwi-fr-node-228-unreadable-home-"));
  const codexHome = path.join(home, ".codex");
  const oldRoot = path.join(codexHome, "skills");
  const placed = await installSkill({ projectRoot: { root }, sourceBaseDir: base, agent: "codex", selector: "kiwi-keep", scope: "custom", dest: oldRoot });
  if (!placed.ok) throw new Error(placed.error.message);
  return { root, base, home, codexHome, oldRoot, newRoot: path.join(home, ".agents", "skills") };
}

describe("FR-NODE-228 AC-10 — an unreadable deprecated root costs only its cleanup", () => {
  it("FR-NODE-228 AC-10: the Codex global install still succeeds, removes nothing old, and warns naming the root", async () => {
    const s = await scenario();
    denied.add(path.resolve(s.oldRoot).toLowerCase());

    const installed = await installSkill({ projectRoot: { root: s.root }, sourceBaseDir: s.base, homeDir: s.home, env: {}, agent: "codex", selector: "kiwi-keep", scope: "global" });

    expect(installed.ok, installed.ok ? "" : installed.error.message).toBe(true);
    if (!installed.ok) return;
    expect(await exists(path.join(s.newRoot, "kiwi-keep", "SKILL.md"))).toBe(true);
    expect(await exists(path.join(s.oldRoot, "kiwi-keep", "SKILL.md"))).toBe(true);
    expect(installed.value.deprecatedRootCleanup?.removed).toEqual([]);
    expect(installed.value.deprecatedRootCleanup?.warnings.some((warning) => warning.includes(s.oldRoot))).toBe(true);
  });

  it("FR-NODE-228 AC-10: the init global pass still counts as completed and carries the warning", async () => {
    const s = await scenario();
    denied.add(path.resolve(s.oldRoot).toLowerCase());

    const result = await initProject(await resolveProjectRoot(s.root), { installSkills: true, registerMcp: false, skillSourceBaseDir: s.base, globalHomeDir: s.home, globalCodexHome: s.codexHome });

    expect(result.ok).toBe(true);
    expect(result.value?.onboarding?.globalSkills.find((outcome) => outcome.agent === "codex")).toMatchObject({ completed: true });
    expect((result.value?.warnings ?? []).some((warning) => warning.includes(s.oldRoot))).toBe(true);
  });

  it("FR-NODE-228 AC-10: doctor still returns its whole report, with the drift check warning about the root", async () => {
    const s = await scenario();
    denied.add(path.resolve(s.oldRoot).toLowerCase());
    await mkdir(path.join(s.root, "docs", "spec"), { recursive: true });
    await writeFile(path.join(s.root, "docs", "spec", "00.index.md"), "# Index\n", "utf8");

    const report = await diagnoseHealth(await parseWorkspace(await resolveProjectRoot(s.root)), {
      installedSkillsHomeDir: s.home,
      installedSkillsCodexHome: s.codexHome,
      claudeSkillsSourceRoot: path.join(s.base, "claude"),
      codexSkillsSourceRoot: path.join(s.base, "codex")
    });

    expect(report.checks.find((check) => check.topic === "Node version")).toBeDefined();
    const drift = report.checks.find((check) => check.topic === "installed skill drift");
    expect(drift?.state).toBe("warn");
    expect(drift?.message).toContain(s.oldRoot);
  });

  it("FR-NODE-228 AC-10: remove --global keeps the unreadable root with reason error and still clears ~/.agents/skills", async () => {
    const s = await scenario();
    const init = await initProject(await resolveProjectRoot(s.root), { installSkills: true, registerMcp: false, skillSourceBaseDir: s.base, globalHomeDir: s.home, globalCodexHome: s.codexHome });
    expect(init.ok).toBe(true);
    const placed = await installSkill({ projectRoot: { root: s.root }, sourceBaseDir: s.base, agent: "codex", selector: "kiwi-keep", scope: "custom", dest: s.oldRoot });
    expect(placed.ok).toBe(true);
    denied.add(path.resolve(s.oldRoot).toLowerCase());

    const removed = await removeProject(await resolveProjectRoot(s.root), { apply: true, scope: "global", globalHomeDir: s.home, globalCodexHome: s.codexHome });

    expect(removed.ok).toBe(true);
    expect(await exists(path.join(s.newRoot, "kiwi-keep"))).toBe(false);
    expect(removed.value?.kept).toEqual(expect.arrayContaining([expect.objectContaining({ path: s.oldRoot, reason: "error" })]));
    expect(removed.value?.complete).toBe(false);
  });
});
