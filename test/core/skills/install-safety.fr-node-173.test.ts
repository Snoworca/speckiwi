import { mkdir, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { installSkill, planSkillInstall } from "../../../src/core/skills/install-skill.js";
import type { SkillInstallOptions } from "../../../src/core/skills/types.js";

// @req FR-NODE-173 — the install service must not destroy what it does not own, and every field it
// reports as a measurement must be one.
//
// The destructive defect these cases pin: the guard refusing an update to a destination that holds
// no SpecKiwi install metadata was gated on `scope === "custom"`, so the two scopes that write into
// a user's real agent directories skipped it. An audit reproduced the loss — a hand-authored skill
// directory holding SKILL.md and notes.md was replaced with the bundled body, notes.md deleted, and
// the call returned ok with operation "update". The staged backup is dropped on success, so nothing
// survives to restore from.

async function tempRoot(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), "speckiwi-install-safety-"));
}

function options(root: string, overrides: Partial<SkillInstallOptions> = {}): SkillInstallOptions {
  return {
    projectRoot: { root },
    sourceBaseDir: path.join(root, "skills"),
    homeDir: path.join(root, "home"),
    env: {},
    agent: "claude",
    selector: "kiwi-pm",
    scope: "project",
    dryRun: false,
    ...overrides
  };
}

async function writeSourceSkill(root: string, name: string, body = "# body", extra: Record<string, string> = {}): Promise<void> {
  const dir = path.join(root, "skills", "claude", name);
  await mkdir(dir, { recursive: true });
  await writeFile(
    path.join(dir, "SKILL.md"),
    ["---", `name: ${name}`, `description: ${name} test skill`, "---", "", body, "", "Normal operation requires speckiwi mcp."].join("\n"),
    "utf8"
  );
  for (const [relative, content] of Object.entries(extra)) {
    const target = path.join(dir, relative);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, content, "utf8");
  }
}

/** A destination directory a human wrote: a valid skill body, no SpecKiwi install metadata. */
async function writeHandAuthored(destinationRoot: string, name: string): Promise<void> {
  const dir = path.join(destinationRoot, name);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, "SKILL.md"), ["---", `name: ${name}`, "description: hand written", "---", "", "# mine"].join("\n"), "utf8");
  await writeFile(path.join(dir, "notes.md"), "my notes\n", "utf8");
}

describe("FR-NODE-173 — the install service refuses to destroy unmanaged content", () => {
  it.each(["project", "global", "custom"] as const)("AC-1: refuses an unmanaged destination in %s scope", async (scope) => {
    const root = await tempRoot();
    const dest = path.join(root, "dest");
    await writeSourceSkill(root, "kiwi-pm");
    const destinationRoot = scope === "custom" ? dest : scope === "global" ? path.join(root, "home", ".claude", "skills") : path.join(root, ".claude", "skills");
    await writeHandAuthored(destinationRoot, "kiwi-pm");

    const result = await installSkill(options(root, { scope, ...(scope === "custom" ? { dest } : {}) }));

    expect(result.ok, `${scope}: an unmanaged destination was overwritten`).toBe(false);
    if (result.ok) return;
    expect(result.error.message.toLowerCase()).toContain("conflict");
    // The file the previous behaviour deleted, unrecoverably.
    await expect(readFile(path.join(destinationRoot, "kiwi-pm", "notes.md"), "utf8")).resolves.toBe("my notes\n");
  });

  it("AC-1: the refusal names the destination and states the recovery step", async () => {
    const root = await tempRoot();
    await writeSourceSkill(root, "kiwi-pm");
    const destinationRoot = path.join(root, ".claude", "skills");
    await writeHandAuthored(destinationRoot, "kiwi-pm");

    const planned = await planSkillInstall(options(root, { dryRun: true }));
    expect(planned.ok).toBe(true);
    if (!planned.ok) return;
    const conflict = planned.value.results[0]?.conflicts.join(" ") ?? "";
    expect(conflict, "the refusal does not name the destination").toContain(path.join(destinationRoot, "kiwi-pm"));
    expect(conflict, "the refusal does not state how to proceed").toMatch(/remove/i);
  });

  it("AC-2: installedChecksum is measured from the destination, not copied from the source", async () => {
    const root = await tempRoot();
    const dest = path.join(root, "dest");
    await writeSourceSkill(root, "kiwi-pm", "# body", { "references/guide.md": "guide\n" });

    const result = await installSkill(options(root, { scope: "custom", dest }));
    expect(result.ok, result.ok ? "" : result.error.message).toBe(true);

    const metadata = JSON.parse(await readFile(path.join(dest, "kiwi-pm", ".speckiwi-skill-install.json"), "utf8")) as {
      sourceChecksum: string;
      installedChecksum: string;
      installedFileCount: number;
    };
    // A faithful install agrees, but the two values must come from different measurements: truncate
    // the destination and the recorded installedChecksum must no longer describe it.
    expect(metadata.installedChecksum).toBe(metadata.sourceChecksum);
    expect(metadata.installedFileCount).toBeGreaterThan(0);

    await writeFile(path.join(dest, "kiwi-pm", "references", "guide.md"), "tampered\n", "utf8");
    const second = await planSkillInstall(options(root, { scope: "custom", dest, dryRun: true }));
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.value.results[0]?.operation, "a tampered destination still reports as current").not.toBe("skip");
  });

  it("AC-3: the plan counts a deletion it is about to perform", async () => {
    const root = await tempRoot();
    const dest = path.join(root, "dest");
    await writeSourceSkill(root, "kiwi-pm", "# body", { "extra/a.md": "a\n" });

    // Same file count, different files: the destination's `extra/b.md` will be deleted.
    const installedDir = path.join(dest, "kiwi-pm");
    await mkdir(path.join(installedDir, "extra"), { recursive: true });
    await writeFile(path.join(installedDir, "SKILL.md"), ["---", "name: kiwi-pm", "description: x", "---", "", "# old"].join("\n"), "utf8");
    await writeFile(path.join(installedDir, "extra", "b.md"), "b\n", "utf8");
    await writeFile(
      path.join(installedDir, ".speckiwi-skill-install.json"),
      JSON.stringify({ name: "kiwi-pm", agent: "claude" }),
      "utf8"
    );

    const planned = await planSkillInstall(options(root, { scope: "custom", dest, dryRun: true }));
    expect(planned.ok, planned.ok ? "" : planned.error.message).toBe(true);
    if (!planned.ok) return;
    const plan = planned.value.results[0];
    expect(plan?.operation).toBe("update");
    expect(plan?.filesRemoved, "the plan promises no deletion while a file is about to be deleted").toBeGreaterThan(0);
  });

  it("AC-4: metadata records a shared reference whatever spelling the skill uses", async () => {
    const root = await tempRoot();
    const dest = path.join(root, "dest");
    await writeSourceSkill(root, "kiwi-pm", "See `~/.claude/skills/_shared/kiwi/auto-option.md` for the contract.");
    const sharedDir = path.join(root, "skills", "claude", "_shared", "kiwi");
    await mkdir(sharedDir, { recursive: true });
    await writeFile(path.join(sharedDir, "auto-option.md"), "auto\n", "utf8");

    const result = await installSkill(options(root, { scope: "custom", dest }));
    expect(result.ok, result.ok ? "" : result.error.message).toBe(true);

    const metadata = JSON.parse(await readFile(path.join(dest, "kiwi-pm", ".speckiwi-skill-install.json"), "utf8")) as {
      sharedResourceReferences: string[];
      sharedResourceValidation: string;
    };
    expect(metadata.sharedResourceReferences).toContain("_shared/kiwi/auto-option.md");
    expect(metadata.sharedResourceValidation).not.toBe("not-required");
  });

  it("AC-4: citing a contract that does not exist refuses the install and names it", async () => {
    // The rule the broadened pattern makes enforceable: a `_shared/kiwi/<name>.md` written in a skill
    // body is a dependency, so the contract must exist. Scanning covers the skill's own package only,
    // which is why a retired name mentioned in a repository-level migration note cannot fail a run.
    const root = await tempRoot();
    const dest = path.join(root, "dest");
    await writeSourceSkill(root, "kiwi-pm", "Retired: `_shared/kiwi/mini-option.md` was replaced by loop-option.");

    const result = await installSkill(options(root, { scope: "custom", dest }));
    expect(result.ok, "an install cited a contract that is not there and proceeded").toBe(false);
    if (result.ok) return;
    expect(result.error.message).toContain("mini-option.md");
  });

  it("AC-5: a destination left without an entrypoint says how to recover, and leftovers are reaped", async () => {
    const root = await tempRoot();
    const dest = path.join(root, "dest");
    await writeSourceSkill(root, "kiwi-pm");

    const installedDir = path.join(dest, "kiwi-pm");
    await mkdir(installedDir, { recursive: true });
    await writeFile(path.join(installedDir, ".speckiwi-skill-install.json"), JSON.stringify({ name: "kiwi-pm", agent: "claude" }), "utf8");
    await mkdir(path.join(dest, ".speckiwi-kiwi-pm-stage-123"), { recursive: true });
    await mkdir(path.join(dest, ".speckiwi-kiwi-pm-backup-123"), { recursive: true });

    const planned = await planSkillInstall(options(root, { scope: "custom", dest, dryRun: true }));
    expect(planned.ok).toBe(true);
    if (!planned.ok) return;
    const conflict = planned.value.results[0]?.conflicts.join(" ") ?? "";
    expect(conflict, "a crashed install never says how to recover").toMatch(/remove/i);
    expect(conflict).toContain(installedDir);
  });
});
