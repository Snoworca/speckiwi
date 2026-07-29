import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { installSkill } from "../../../src/core/skills/install-skill.js";
import type { SkillInstallOptions } from "../../../src/core/skills/types.js";

// FR-NODE-090 — the shared Kiwi resource prune must not delete a contract that a mirror-excluded
// skill references.
//
// Reproduced five times against this repository: `speckiwi skills install codex <skill>` deleted
// `.agents/skills/_shared/kiwi/waves-event.md` every run. The prune collects references by walking
// the destination tree, and the only skill referencing that contract — kiwi-wave-master — is named
// in the mirror-exclusions manifest, so it is never in the destination. A shared contract referenced
// by an excluded skill is still referenced.

const MIRROR_DIR = [".agents", "skills"] as const;

async function tempRoot(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), "speckiwi-shared-prune-"));
}

function options(root: string, selector: string): SkillInstallOptions {
  return {
    projectRoot: { root },
    sourceBaseDir: path.join(root, "skills"),
    homeDir: path.join(root, "home"),
    env: {},
    agent: "codex",
    selector,
    scope: "project",
    dryRun: false
  };
}

/** Writes a source skill whose body references the given shared contracts. */
async function writeSkill(root: string, name: string, references: readonly string[]): Promise<void> {
  const skillDir = path.join(root, "skills", "codex", name);
  await mkdir(skillDir, { recursive: true });
  const body = references.map((reference) => `Read \`../_shared/kiwi/${reference}\` first.`).join("\n\n");
  await writeFile(
    path.join(skillDir, "SKILL.md"),
    ["---", `name: ${name}`, `description: ${name} test skill`, "---", "", `# ${name}`, "", body, "", "Normal operation requires speckiwi mcp."].join("\n"),
    "utf8"
  );
}

async function writeSharedResource(root: string, name: string): Promise<void> {
  const target = path.join(root, "skills", "codex", "_shared", "kiwi", name);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, `${name} contract\n`, "utf8");
}

/** Seeds the destination mirror with a shared resource, as a previous install would have left it. */
async function seedMirrorResource(root: string, name: string): Promise<string> {
  const target = path.join(root, ...MIRROR_DIR, "_shared", "kiwi", name);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, `${name} contract\n`, "utf8");
  return target;
}

async function writeExclusions(root: string, content: string): Promise<void> {
  const target = path.join(root, ...MIRROR_DIR, ".speckiwi-mirror-exclusions.json");
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, content, "utf8");
}

async function exists(target: string): Promise<boolean> {
  return readFile(target, "utf8").then(() => true).catch(() => false);
}

/**
 * A source tree with two skills: `kiwi-pm`, which is installed, and `kiwi-wave-master`, which the
 * destination excludes from the mirror. Only the excluded skill references `waves-event.md`.
 */
async function scenario(root: string): Promise<{ wavesEvent: string; orphan: string }> {
  await writeSkill(root, "kiwi-pm", ["auto-option.md"]);
  await writeSkill(root, "kiwi-wave-master", ["waves-event.md"]);
  await writeSharedResource(root, "auto-option.md");
  await writeSharedResource(root, "waves-event.md");
  const wavesEvent = await seedMirrorResource(root, "waves-event.md");
  const orphan = await seedMirrorResource(root, "nobody-references-this.md");
  return { wavesEvent, orphan };
}

describe("FR-NODE-090 AC-1 — an excluded skill's shared contract survives", () => {
  it("keeps waves-event.md when installing a different skill", async () => {
    const root = await tempRoot();
    const { wavesEvent } = await scenario(root);
    await writeExclusions(root, JSON.stringify({ excluded: ["kiwi-wave-master"] }));

    const installed = await installSkill(options(root, "kiwi-pm"));
    expect(installed.ok).toBe(true);
    if (!installed.ok) throw new Error(installed.error.message);

    expect(await exists(wavesEvent)).toBe(true);
  });

  it("keeps it across repeated installs, so the deletion cannot return on the second run", async () => {
    const root = await tempRoot();
    const { wavesEvent } = await scenario(root);
    await writeExclusions(root, JSON.stringify({ excluded: ["kiwi-wave-master"] }));

    for (let run = 0; run < 3; run += 1) {
      const installed = await installSkill(options(root, "kiwi-pm"));
      expect(installed.ok).toBe(true);
      expect(await exists(wavesEvent), `run ${run + 1}`).toBe(true);
    }
  });
});

describe("FR-NODE-090 AC-2 — a genuinely unreferenced resource is still pruned", () => {
  it("removes a shared file no skill references, installed or excluded", async () => {
    const root = await tempRoot();
    const { orphan } = await scenario(root);
    await writeExclusions(root, JSON.stringify({ excluded: ["kiwi-wave-master"] }));

    const installed = await installSkill(options(root, "kiwi-pm"));
    expect(installed.ok).toBe(true);

    expect(await exists(orphan)).toBe(false);
  });
});

describe("FR-NODE-090 AC-3 — a destination without a usable manifest prunes as before", () => {
  it("prunes the excluded skill's contract when no manifest names it", async () => {
    const root = await tempRoot();
    const { wavesEvent } = await scenario(root);

    const installed = await installSkill(options(root, "kiwi-pm"));
    expect(installed.ok).toBe(true);

    // Nothing declared the skill excluded, so nothing claims the contract.
    expect(await exists(wavesEvent)).toBe(false);
  });

  it("prunes when the manifest is unparseable, rather than retaining everything", async () => {
    const root = await tempRoot();
    const { wavesEvent } = await scenario(root);
    await writeExclusions(root, "{ not json");

    const installed = await installSkill(options(root, "kiwi-pm"));
    expect(installed.ok).toBe(true);

    expect(await exists(wavesEvent)).toBe(false);
  });
});

describe("FR-NODE-090 AC-4 — a manifest naming an absent skill is harmless", () => {
  it("installs successfully and prunes the unreferenced contract", async () => {
    const root = await tempRoot();
    const { wavesEvent } = await scenario(root);
    await rm(path.join(root, "skills", "codex", "kiwi-wave-master"), { recursive: true, force: true });
    await writeExclusions(root, JSON.stringify({ excluded: ["kiwi-wave-master"] }));

    const installed = await installSkill(options(root, "kiwi-pm"));
    expect(installed.ok).toBe(true);
    if (!installed.ok) throw new Error(installed.error.message);

    expect(await exists(wavesEvent)).toBe(false);
  });
});
