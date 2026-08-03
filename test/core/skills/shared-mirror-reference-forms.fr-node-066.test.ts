import { mkdir, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { installSkill } from "../../../src/core/skills/install-skill.js";
import type { SkillInstallOptions } from "../../../src/core/skills/types.js";

// @req FR-NODE-066 — the shared mirror must materialise the `_shared/kiwi/*` files an installed
// skill references, whatever spelling that skill uses for the reference.
//
// The requirement shipped `implemented` with no evidence rows and no ticked criterion, and measuring
// it explains why: the collector recognises `../_shared/kiwi/…` only, while the reference forms in
// the shipped tree are, counted across `skills/**`:
//
//     ../_shared/kiwi/                175   recognised
//     _shared/kiwi/       (bare)       96   not recognised
//     ~/.claude/skills/_shared/kiwi/   42   not recognised
//     ../../_shared/kiwi/              27   recognised
//     skills/{codex,etc}/_shared/…     13   not recognised
//
// Split by variant the effect is sharper: the claude tree uses the relative form ZERO times, so for
// that agent the reference union is empty, `syncSharedMirror` returns before copying anything, and
// the mirror is never written — the skills arrive pointing at contracts that are not there. The
// codex and etc trees use the relative form heavily and work today.
//
// Every pre-existing test writes `../_shared/kiwi/…` against a `codex` source, so the whole suite
// exercises the one spelling that works. That is the shape FR-NODE-066 AC-5 asks about: a parity
// assertion that cannot fail on a build where the shipped convention never resolves.

async function tempRoot(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), "speckiwi-shared-mirror-"));
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

async function writeSkill(root: string, variant: string, name: string, body: string): Promise<void> {
  const dir = path.join(root, "skills", variant, name);
  await mkdir(dir, { recursive: true });
  await writeFile(
    path.join(dir, "SKILL.md"),
    ["---", `name: ${name}`, `description: ${name} test skill`, "---", "", body, "", "Normal operation requires speckiwi mcp."].join("\n"),
    "utf8"
  );
}

async function writeShared(root: string, variant: string, name: string, body: string): Promise<void> {
  const dir = path.join(root, "skills", variant, "_shared", "kiwi");
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, name), body, "utf8");
}

async function mirrorFiles(destinationRoot: string): Promise<string[]> {
  try {
    return (await readdir(path.join(destinationRoot, "_shared", "kiwi"))).sort();
  } catch {
    return [];
  }
}

describe("FR-NODE-066 — the shared mirror follows the reference, not one spelling of it", () => {
  it("AC-1: materialises a home-absolute reference, the form the claude tree ships", async () => {
    const root = await tempRoot();
    const dest = path.join(root, "dest");
    await writeSkill(root, "claude", "kiwi-pm", "See `~/.claude/skills/_shared/kiwi/auto-option.md` for the --auto contract.");
    await writeShared(root, "claude", "auto-option.md", "auto option v1\n");

    const result = await installSkill(options(root, { dest }));
    expect(result.ok, result.ok ? "" : result.error.message).toBe(true);

    expect(await mirrorFiles(dest)).toContain("auto-option.md");
    await expect(readFile(path.join(dest, "_shared", "kiwi", "auto-option.md"), "utf8")).resolves.toBe("auto option v1\n");
  });

  it("AC-1: materialises a bare `_shared/kiwi/…` reference", async () => {
    const root = await tempRoot();
    const dest = path.join(root, "dest");
    await writeSkill(root, "claude", "kiwi-pm", "The loop cap SSOT is `_shared/kiwi/loop-option.md` v1.0.");
    await writeShared(root, "claude", "loop-option.md", "loop option v1\n");

    const result = await installSkill(options(root, { dest }));
    expect(result.ok, result.ok ? "" : result.error.message).toBe(true);

    expect(await mirrorFiles(dest)).toContain("loop-option.md");
  });

  it("AC-4: still materialises the relative form, which already worked", async () => {
    const root = await tempRoot();
    const dest = path.join(root, "dest");
    await writeSkill(root, "codex", "kiwi-pm", "Read `../_shared/kiwi/auto-option.md` before auto mode.");
    await writeShared(root, "codex", "auto-option.md", "auto\n");

    const result = await installSkill(options(root, { agent: "codex", dest }));
    expect(result.ok, result.ok ? "" : result.error.message).toBe(true);

    expect(await mirrorFiles(dest)).toContain("auto-option.md");
  });

  it("AC-2: unions references across every skill in the destination, whatever spelling each uses", async () => {
    const root = await tempRoot();
    const dest = path.join(root, "dest");
    await writeSkill(root, "claude", "kiwi-pm", "See `~/.claude/skills/_shared/kiwi/auto-option.md`.");
    await writeSkill(root, "claude", "kiwi-srs", "Schema `_shared/kiwi/feasibility-policy-schema-v1.md`.");
    await writeShared(root, "claude", "auto-option.md", "auto\n");
    await writeShared(root, "claude", "feasibility-policy-schema-v1.md", "schema\n");

    const both = await installSkill(options(root, { selector: "all", dest }));
    expect(both.ok, both.ok ? "" : both.error.message).toBe(true);
    expect(await mirrorFiles(dest)).toEqual(["auto-option.md", "feasibility-policy-schema-v1.md"]);

    // Reinstalling one skill must not prune the other's contract: the union is over the destination,
    // not over the invocation.
    const single = await installSkill(options(root, { selector: "kiwi-pm", dest }));
    expect(single.ok, single.ok ? "" : single.error.message).toBe(true);
    expect(await mirrorFiles(dest)).toEqual(["auto-option.md", "feasibility-policy-schema-v1.md"]);
  });

  it("AC-3: prunes a mirror file no installed skill references", async () => {
    const root = await tempRoot();
    const dest = path.join(root, "dest");
    await writeSkill(root, "claude", "kiwi-pm", "See `~/.claude/skills/_shared/kiwi/auto-option.md`.");
    await writeShared(root, "claude", "auto-option.md", "auto\n");
    await mkdir(path.join(dest, "_shared", "kiwi"), { recursive: true });
    await writeFile(path.join(dest, "_shared", "kiwi", "stale.md"), "stale\n", "utf8");

    const result = await installSkill(options(root, { dest }));
    expect(result.ok, result.ok ? "" : result.error.message).toBe(true);
    expect(await mirrorFiles(dest)).not.toContain("stale.md");
  });

  it("AC-3: an empty reference union leaves the mirror alone rather than emptying it", async () => {
    // The safe branch, and the reason the broken detector was survivable: for every claude install
    // the union came out empty, so had prune run on that basis it would have deleted the user's
    // whole `_shared/kiwi` mirror instead of merely failing to write it.
    const root = await tempRoot();
    const dest = path.join(root, "dest");
    await writeSkill(root, "claude", "kiwi-pm", "This skill references no shared contract.");
    await mkdir(path.join(dest, "_shared", "kiwi"), { recursive: true });
    await writeFile(path.join(dest, "_shared", "kiwi", "unrelated.md"), "not ours\n", "utf8");

    const result = await installSkill(options(root, { dest }));
    expect(result.ok, result.ok ? "" : result.error.message).toBe(true);
    expect(await mirrorFiles(dest)).toEqual(["unrelated.md"]);
  });

  it("AC-4: a reference that climbs out of the mirror is not copied", async () => {
    const root = await tempRoot();
    const dest = path.join(root, "dest");
    await writeSkill(root, "claude", "kiwi-pm", "Escape `_shared/kiwi/../../../outside.md` must not resolve.");
    await writeShared(root, "claude", "auto-option.md", "auto\n");
    await writeFile(path.join(root, "skills", "outside.md"), "outside\n", "utf8");

    const result = await installSkill(options(root, { dest }));
    expect(result.ok, result.ok ? "" : result.error.message).toBe(true);
    expect(await mirrorFiles(dest)).not.toContain("outside.md");
  });

  it("AC-5: every shared contract the shipped skills reference arrives, for every agent", async () => {
    // The assertion the previous suite could not make: run the real shipped tree through the real
    // installer and require the destination to hold what the installed bodies point at.
    const repoRoot = path.resolve(__dirname, "../../..");
    for (const variant of ["claude", "codex", "etc"] as const) {
      const dest = path.join(await tempRoot(), variant);
      const result = await installSkill({
        projectRoot: { root: repoRoot },
        sourceBaseDir: path.join(repoRoot, "skills"),
        homeDir: path.join(await tempRoot(), "home"),
        env: {},
        agent: variant === "etc" ? "opencode" : variant,
        selector: "all",
        scope: "project",
        dryRun: false,
        dest
      });
      expect(result.ok, result.ok ? "" : result.error.message).toBe(true);

      const installedSkills = (await readdir(dest, { withFileTypes: true })).filter((e) => e.isDirectory() && !e.name.startsWith("_"));
      const referenced = new Set<string>();
      for (const entry of installedSkills) {
        const body = await readFile(path.join(dest, entry.name, "SKILL.md"), "utf8").catch(() => "");
        for (const match of body.matchAll(/_shared\/kiwi\/([A-Za-z0-9._-]+\.md)/g)) referenced.add(match[1]);
      }
      expect(referenced.size, `${variant}: shipped skills reference no shared contract`).toBeGreaterThan(0);

      const present = new Set(await mirrorFiles(dest));
      const missing = [...referenced].filter((name) => !present.has(name)).sort();
      expect(missing, `${variant}: installed skills point at contracts the mirror never received`).toEqual([]);
    }
  }, 120000);
});
