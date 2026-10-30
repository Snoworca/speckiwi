import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { initProject } from "../../../src/core/bootstrap/init-project.js";
import { resolveProjectRoot } from "../../../src/core/project-root.js";

// @req FR-NODE-230 — one conflicting destination refuses the whole agent's install. init has to say
// which skill and which path, and its dry-run has to report the outcome the real run will have.

vi.setConfig({ testTimeout: 60_000 });

async function writeSkill(dir: string, name: string): Promise<void> {
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, "SKILL.md"), ["---", `name: ${name}`, "description: test skill", "---", "", `# ${name}`].join("\n"), "utf8");
}

/** Every kind of destination the installer refuses, each placed at `~/.claude/skills/kiwi-a`. */
const CONFLICTS: Record<string, { reason: string; place: (destination: string) => Promise<void> }> = {
  "no install metadata": { reason: "no SpecKiwi install metadata", place: (destination) => writeSkill(destination, "kiwi-a") },
  "a file, not a directory": {
    reason: "not a normal directory",
    place: async (destination) => {
      await mkdir(path.dirname(destination), { recursive: true });
      await writeFile(destination, "not a skill", "utf8");
    }
  },
  "no entrypoint": { reason: "does not contain a valid skill entrypoint", place: (destination) => mkdir(destination, { recursive: true }) },
  "another skill's identity": { reason: "skill identity does not match", place: (destination) => writeSkill(destination, "someone-else") },
  "another agent's install metadata": {
    reason: "install metadata identity does not match",
    place: async (destination) => {
      await writeSkill(destination, "kiwi-a");
      await writeFile(path.join(destination, ".speckiwi-skill-install.json"), JSON.stringify({ name: "kiwi-a", agent: "codex" }), "utf8");
    }
  }
};

/** Two bundled skills, and a home whose Claude skills dir already holds a kiwi-a the installer refuses. */
async function scenario(conflict = "no install metadata") {
  const root = await mkdtemp(path.join(tmpdir(), "speckiwi-conflict-"));
  await mkdir(path.join(root, ".git", "hooks"), { recursive: true });
  const base = await mkdtemp(path.join(tmpdir(), "speckiwi-conflict-src-"));
  for (const agent of ["claude", "codex"]) {
    for (const name of ["kiwi-a", "kiwi-b"]) await writeSkill(path.join(base, agent, name), name);
  }
  const home = await mkdtemp(path.join(tmpdir(), "speckiwi-conflict-home-"));
  await mkdir(path.join(home, ".codex"), { recursive: true });
  const handMade = path.join(home, ".claude", "skills", "kiwi-a");
  await CONFLICTS[conflict]!.place(handMade);
  return { root, base, home, handMade };
}

async function runInit(s: { root: string; base: string; home: string }, dryRun: boolean) {
  const result = await initProject(await resolveProjectRoot(s.root), {
    installSkills: true,
    dryRun,
    skillSourceBaseDir: s.base,
    globalHomeDir: s.home,
    globalCodexHome: path.join(s.home, ".codex")
  });
  if (!result.ok || result.value === undefined) throw new Error(result.error?.message ?? "expected an ok init");
  return result.value;
}

const claudeWarnings = (warnings: string[]) => warnings.filter((warning) => warning.startsWith("skills(claude)"));
const claudeOutcome = (output: Awaited<ReturnType<typeof runInit>>) =>
  output.onboarding?.globalSkills.find((outcome) => outcome.agent === "claude");

describe("FR-NODE-230 init skill conflicts", () => {
  it.each(Object.keys(CONFLICTS))("AC-1: a real run names the conflicting skill, its destination and the reason — %s", async (conflict) => {
    const s = await scenario(conflict);
    const output = await runInit(s, false);

    const named = claudeWarnings(output.warnings).filter((warning) => warning.includes("kiwi-a") && warning.includes(s.handMade));
    expect(named).toHaveLength(1);
    expect(named[0]).toContain(CONFLICTS[conflict]!.reason);
    expect(claudeOutcome(output)).toMatchObject({ completed: false, names: [] });
  });

  it("AC-1: every conflicting skill gets its own warning, not only the first", async () => {
    const s = await scenario();
    const second = path.join(s.home, ".claude", "skills", "kiwi-b");
    await writeSkill(second, "kiwi-b");
    const output = await runInit(s, false);

    for (const [name, destination] of [["kiwi-a", s.handMade], ["kiwi-b", second]] as const) {
      expect(claudeWarnings(output.warnings).filter((warning) => warning.includes(name) && warning.includes(destination))).toHaveLength(1);
    }
  });

  it("AC-2: the dry-run reports the claude outcome exactly as the real run does", async () => {
    const s = await scenario();
    const planned = await runInit(s, true);
    const real = await runInit(s, false);

    expect(claudeWarnings(planned.warnings)).toEqual(claudeWarnings(real.warnings));
    expect(claudeOutcome(planned)).toEqual(claudeOutcome(real));
    const claudeSkills = path.join(s.home, ".claude", "skills");
    expect([...planned.created, ...planned.updated].filter((entry) => entry.startsWith(claudeSkills))).toEqual([]);
    // The codex pass has no conflict, so the dry-run still plans it.
    expect(planned.onboarding?.globalSkills.find((outcome) => outcome.agent === "codex")).toMatchObject({ completed: true, names: ["kiwi-a", "kiwi-b"] });
  });
});
