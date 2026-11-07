import { access, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { initProject } from "../../../src/core/bootstrap/init-project.js";
import type { AgentCliRunner } from "../../../src/core/bootstrap/mcp-registration.js";
import { upgradeProject } from "../../../src/core/bootstrap/upgrade-project.js";
import { resolveProjectRoot } from "../../../src/core/project-root.js";
import { installSkill, removeManagedKiwiSkills } from "../../../src/core/skills/install-skill.js";

// @req FR-NODE-277 — a managed copy that differs from its install only in line endings is unmodified.
// @req FR-NODE-190 AC-8 — the shared mirror's ownership proof folds line endings the same way.
//
// Every managed directory comes from a real install; the line endings are then rewritten the way a
// git checkout with core.autocrlf does it, so the checksum under test is the one the installer wrote.

vi.setConfig({ testTimeout: 60_000 });

const METADATA = ".speckiwi-skill-install.json";
const NEW_CHECKSUM_FIELD = "installedChecksumIgnoringLineEndings";
const BINARY = Buffer.from("a\nb\u0000c\n", "latin1");

type Ending = "lf" | "crlf";

function toEnding(bytes: Buffer, ending: Ending): Buffer {
  const lf = bytes.toString("latin1").replace(/\r\n/g, "\n");
  return Buffer.from(ending === "lf" ? lf : lf.replace(/\n/g, "\r\n"), "latin1");
}

async function exists(target: string): Promise<boolean> {
  return access(target).then(() => true).catch(() => false);
}

async function filesUnder(dir: string): Promise<string[]> {
  const found: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) found.push(...(await filesUnder(full)));
    else if (entry.isFile() && entry.name !== METADATA) found.push(full);
  }
  return found;
}

/** Rewrites the line endings of every file in a copy (the install metadata excepted), binaries included unless skipped. */
async function rewrite(dir: string, ending: Ending, options: { skipBinary?: boolean } = {}): Promise<void> {
  for (const file of await filesUnder(dir)) {
    const bytes = await readFile(file);
    if (options.skipBinary && bytes.includes(0)) continue;
    await writeFile(file, toEnding(bytes, ending));
  }
}

/** Turns the install metadata into what a release before the line-ending-insensitive checksum wrote. */
async function predateNewChecksum(dir: string): Promise<void> {
  const file = path.join(dir, METADATA);
  const metadata = JSON.parse(await readFile(file, "utf8")) as Record<string, unknown>;
  delete metadata[NEW_CHECKSUM_FIELD];
  await writeFile(file, `${JSON.stringify(metadata, null, 2)}\n`, "utf8");
}

interface SourceSkill {
  skillEnding?: Ending;
  guideEnding?: Ending;
  binary?: boolean;
  shared?: readonly string[];
  /** Extra LF text files under references/, beside SKILL.md and guide.md. */
  extraFiles?: number;
}

async function writeSourceSkill(base: string, agent: "claude" | "codex", name: string, skill: SourceSkill = {}): Promise<void> {
  const dir = path.join(base, agent, name);
  await mkdir(path.join(dir, "references"), { recursive: true });
  const body = ["---", `name: ${name}`, "description: test skill", "---", "", `# ${name}`, "", "Normal operation requires speckiwi mcp."];
  for (const contract of skill.shared ?? []) body.push("", `See [contract](../_shared/kiwi/${contract}).`);
  await writeFile(path.join(dir, "SKILL.md"), toEnding(Buffer.from(`${body.join("\n")}\n`), skill.skillEnding ?? "lf"));
  await writeFile(path.join(dir, "references", "guide.md"), toEnding(Buffer.from("guide\nsecond line\n"), skill.guideEnding ?? "lf"));
  for (let index = 0; index < (skill.extraFiles ?? 0); index += 1) {
    await writeFile(path.join(dir, "references", `extra-${String(index).padStart(2, "0")}.md`), Buffer.from(`extra ${index}\nline\n`));
  }
  if (skill.binary) {
    await mkdir(path.join(dir, "assets"), { recursive: true });
    await writeFile(path.join(dir, "assets", "blob.bin"), BINARY);
  }
}

async function tempRoot(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), "speckiwi-eol-"));
}

async function installClaudeAll(root: string): Promise<string> {
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
  return path.join(root, ".claude", "skills");
}

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

describe("FR-NODE-277 AC-1 — upgrade removes a project copy whose files were all rewritten to CRLF", () => {
  async function scenario() {
    const root = await mkdtemp(path.join(tmpdir(), "speckiwi-eol-upg-"));
    await mkdir(path.join(root, ".git"));
    const base = await mkdtemp(path.join(tmpdir(), "speckiwi-eol-upg-src-"));
    await writeSourceSkill(base, "claude", "kiwi-keep");
    await writeSourceSkill(base, "codex", "kiwi-keep");
    const seeded = await initProject(await resolveProjectRoot(root), { projectInstall: true, installSkills: true, registerMcp: true, skillSourceBaseDir: base });
    if (!seeded.ok) throw new Error(seeded.error?.message);
    const home = await mkdtemp(path.join(tmpdir(), "speckiwi-eol-upg-home-"));
    for (const agent of ["claude", "codex"]) await mkdir(path.join(home, `.${agent}`));
    const claudeCopy = path.join(root, ".claude", "skills", "kiwi-keep");
    const codexCopy = path.join(root, ".agents", "skills", "kiwi-keep");
    await rewrite(claudeCopy, "crlf");
    await rewrite(codexCopy, "crlf");
    return { root, base, home, claudeCopy, codexCopy };
  }

  const runner: AgentCliRunner = async (_agent, args) => ({ found: true, exitCode: args[1] === "add" ? 0 : 1, stdout: "", stderr: "" });

  async function upgrade(s: Awaited<ReturnType<typeof scenario>>, apply: boolean) {
    const result = await upgradeProject(await resolveProjectRoot(s.root), {
      apply,
      agentCli: runner,
      globalHomeDir: s.home,
      globalCodexHome: path.join(s.home, ".codex"),
      skillSourceBaseDir: s.base
    });
    if (!result.ok || result.value === undefined) throw new Error(result.error?.message ?? "expected an ok result with a value");
    return result.value;
  }

  it("@req FR-NODE-277 AC-1: a new install records the line-ending-insensitive checksum beside the byte checksum", async () => {
    const root = await tempRoot();
    await writeSourceSkill(path.join(root, "skills"), "claude", "kiwi-a");
    const dest = await installClaudeAll(root);
    const metadata = JSON.parse(await readFile(path.join(dest, "kiwi-a", METADATA), "utf8")) as Record<string, unknown>;
    expect(metadata[NEW_CHECKSUM_FIELD]).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(metadata.installedChecksum).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it("@req FR-NODE-277 AC-1: upgrade --dry-run lists both CRLF copies as removed and writes nothing", async () => {
    const s = await scenario();
    const value = await upgrade(s, false);
    expect(value.applied).toBe(false);
    expect(value.removed).toContain(s.claudeCopy);
    expect(value.removed).toContain(s.codexCopy);
    expect(value.warnings.filter((w) => w.includes("local edits"))).toEqual([]);
    expect(await exists(path.join(s.claudeCopy, "SKILL.md"))).toBe(true);
  });

  it("@req FR-NODE-277 AC-1: the apply removes both CRLF copies", async () => {
    const s = await scenario();
    const value = await upgrade(s, true);
    expect(value.removed).toContain(s.claudeCopy);
    expect(value.removed).toContain(s.codexCopy);
    expect(await exists(s.claudeCopy)).toBe(false);
    expect(await exists(s.codexCopy)).toBe(false);
  });
});

describe("FR-NODE-277 AC-2 — any other changed byte keeps the copy as locally modified", () => {
  // @req FR-NODE-277 AC-2
  for (const metadataAge of ["current", "predating"] as const) {
    it(`@req FR-NODE-277 AC-2: a CRLF copy with one changed byte is kept with the local-edits warning (${metadataAge} metadata)`, async () => {
      const root = await tempRoot();
      await writeSourceSkill(path.join(root, "skills"), "claude", "kiwi-a");
      const dest = await installClaudeAll(root);
      const copy = path.join(dest, "kiwi-a");
      if (metadataAge === "predating") await predateNewChecksum(copy);
      await rewrite(copy, "crlf");
      const guide = path.join(copy, "references", "guide.md");
      await writeFile(guide, (await readFile(guide, "latin1")).replace("guide", "Guide"), "latin1");

      const outcome = await removeAll(dest, path.join(root, "skills", "claude"));

      expect(await exists(copy)).toBe(true);
      expect(outcome.removed).not.toContain(copy);
      expect(outcome.kept.find((entry) => entry.path === copy)?.reason).toBe("locally-modified");
      expect(outcome.warnings.some((w) => w.includes(copy) && w.includes("local edits"))).toBe(true);
    });
  }
});

describe("FR-NODE-277 AC-3 — metadata from before the new checksum still proves a line-ending-only copy", () => {
  async function installed(skill: SourceSkill) {
    const root = await tempRoot();
    await writeSourceSkill(path.join(root, "skills"), "claude", "kiwi-a", skill);
    const dest = await installClaudeAll(root);
    const copy = path.join(dest, "kiwi-a");
    await predateNewChecksum(copy);
    return { root, dest, copy, sourceRoot: path.join(root, "skills", "claude") };
  }

  it("@req FR-NODE-277 AC-3: an all-LF install whose files were all rewritten to CRLF is removed", async () => {
    const s = await installed({});
    await rewrite(s.copy, "crlf");
    const outcome = await removeAll(s.dest, s.sourceRoot);
    expect(outcome.removed).toContain(s.copy);
    expect(await exists(s.copy)).toBe(false);
  });

  // Without the bundled source (init's prune and the global-leftover probe pass none), the proof is
  // the same: it tries per-file endings of the copy itself, never the source's.
  it("@req FR-NODE-277 AC-3: without the bundled source, an all-LF install rewritten to CRLF is removed", async () => {
    const s = await installed({});
    await rewrite(s.copy, "crlf");
    const outcome = await removeAll(s.dest);
    expect(outcome.removed).toContain(s.copy);
  });

  it("@req FR-NODE-277 AC-3: without the bundled source, an all-CRLF install rewritten to LF is removed", async () => {
    const s = await installed({ skillEnding: "crlf", guideEnding: "crlf" });
    await rewrite(s.copy, "lf");
    const outcome = await removeAll(s.dest);
    expect(outcome.removed).toContain(s.copy);
  });

  it("@req FR-NODE-277 AC-3: a mixed CRLF/LF install whose files were all rewritten to LF is removed", async () => {
    const s = await installed({ skillEnding: "crlf", guideEnding: "lf" });
    await rewrite(s.copy, "lf");
    const outcome = await removeAll(s.dest, s.sourceRoot);
    expect(outcome.removed).toContain(s.copy);
  });

  it("@req FR-NODE-277 AC-3: a mixed CRLF/LF install whose files were all rewritten to CRLF is removed", async () => {
    const s = await installed({ skillEnding: "crlf", guideEnding: "lf" });
    await rewrite(s.copy, "crlf");
    const outcome = await removeAll(s.dest, s.sourceRoot);
    expect(outcome.removed).toContain(s.copy);
  });

  it("@req FR-NODE-277 AC-3: a mixed install whose files each took the other ending is removed without the bundled source", async () => {
    const s = await installed({ skillEnding: "crlf", guideEnding: "lf" });
    await writeFile(path.join(s.copy, "SKILL.md"), toEnding(await readFile(path.join(s.copy, "SKILL.md")), "lf"));
    await writeFile(path.join(s.copy, "references", "guide.md"), toEnding(await readFile(path.join(s.copy, "references", "guide.md")), "crlf"));
    const outcome = await removeAll(s.dest);
    expect(outcome.removed).toContain(s.copy);
  });

  it("@req FR-NODE-277 AC-3: a mixed install rewritten to CRLF is removed after the bundled source took other endings", async () => {
    const s = await installed({ skillEnding: "crlf", guideEnding: "lf" });
    await rewrite(s.copy, "crlf");
    await rewrite(path.join(s.sourceRoot, "kiwi-a"), "lf");
    const outcome = await removeAll(s.dest, s.sourceRoot);
    expect(outcome.removed).toContain(s.copy);
  });

  // 8 text files: SKILL.md, guide.md and 6 extras — still inside the every-combination search (256).
  it("@req FR-NODE-277 AC-3: a mixed install of 8 text files rewritten to CRLF is removed", async () => {
    const s = await installed({ skillEnding: "crlf", guideEnding: "lf", extraFiles: 6 });
    await rewrite(s.copy, "crlf");
    const outcome = await removeAll(s.dest);
    expect(outcome.removed).toContain(s.copy);
  });

  // 9 text files: above the cap only all-LF and all-CRLF are tried, so a mixed install is not proven.
  it("@req FR-NODE-277 AC-3: above 8 text files a mixed install rewritten to CRLF is kept and a uniform one is removed", async () => {
    const mixed = await installed({ skillEnding: "crlf", guideEnding: "lf", extraFiles: 7 });
    await rewrite(mixed.copy, "crlf");
    const mixedOutcome = await removeAll(mixed.dest);
    expect(mixedOutcome.kept.find((entry) => entry.path === mixed.copy)?.reason).toBe("locally-modified");
    const uniform = await installed({ extraFiles: 7 });
    await rewrite(uniform.copy, "crlf");
    const uniformOutcome = await removeAll(uniform.dest);
    expect(uniformOutcome.removed).toContain(uniform.copy);
  });
});

describe("FR-NODE-277 AC-4 — a file holding a NUL byte is compared byte for byte", () => {
  // @req FR-NODE-277 AC-4
  for (const metadataAge of ["current", "predating"] as const) {
    it(`@req FR-NODE-277 AC-4: a copy whose binary file also took CRLF is kept (${metadataAge} metadata)`, async () => {
      const root = await tempRoot();
      await writeSourceSkill(path.join(root, "skills"), "claude", "kiwi-a", { binary: true });
      const dest = await installClaudeAll(root);
      const copy = path.join(dest, "kiwi-a");
      if (metadataAge === "predating") await predateNewChecksum(copy);
      await rewrite(copy, "crlf");

      const outcome = await removeAll(dest, path.join(root, "skills", "claude"));

      expect(await exists(copy)).toBe(true);
      expect(outcome.kept.find((entry) => entry.path === copy)?.reason).toBe("locally-modified");
    });

    it(`@req FR-NODE-277 AC-4: the same copy with its binary file untouched is removed (${metadataAge} metadata)`, async () => {
      const root = await tempRoot();
      await writeSourceSkill(path.join(root, "skills"), "claude", "kiwi-a", { binary: true });
      const dest = await installClaudeAll(root);
      const copy = path.join(dest, "kiwi-a");
      if (metadataAge === "predating") await predateNewChecksum(copy);
      await rewrite(copy, "crlf", { skipBinary: true });

      const outcome = await removeAll(dest, path.join(root, "skills", "claude"));

      expect(outcome.removed).toContain(copy);
    });
  }
});

describe("FR-NODE-277 AC-5 — init's orphan prune reaches the same verdict", () => {
  it("@req FR-NODE-277 AC-5: a line-ending-only orphan is pruned and an edited one is kept", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "speckiwi-eol-init-"));
    await mkdir(path.join(root, ".git"));
    const base = await mkdtemp(path.join(tmpdir(), "speckiwi-eol-init-src-"));
    for (const agent of ["claude", "codex"] as const) {
      for (const name of ["kiwi-keep", "kiwi-old", "kiwi-edited"]) await writeSourceSkill(base, agent, name);
    }
    const projectRoot = await resolveProjectRoot(root);
    const first = await initProject(projectRoot, { projectInstall: true, installSkills: true, skillSourceBaseDir: base });
    if (!first.ok) throw new Error(first.error?.message);
    for (const agent of ["claude", "codex"] as const) {
      for (const name of ["kiwi-old", "kiwi-edited"]) await rm(path.join(base, agent, name), { recursive: true, force: true });
    }
    const dest = path.join(root, ".claude", "skills");
    const old = path.join(dest, "kiwi-old");
    const edited = path.join(dest, "kiwi-edited");
    await rewrite(old, "crlf");
    await rewrite(edited, "crlf");
    await writeFile(path.join(edited, "references", "guide.md"), "edited\r\n", "utf8");

    const second = await initProject(projectRoot, { projectInstall: true, installSkills: true, skillSourceBaseDir: base });
    if (!second.ok) throw new Error(second.error?.message);

    expect(await exists(old)).toBe(false);
    expect(second.value?.removed).toContain(old);
    expect(await exists(edited)).toBe(true);
    expect(second.value?.removed).not.toContain(edited);
    expect((second.value?.warnings ?? []).some((w) => w.includes(edited) && w.includes("local edits"))).toBe(true);
  });
});

describe("FR-NODE-190 AC-8 — the shared mirror proof folds line endings for text and not for binaries", () => {
  async function mirrored(contract: string, bytes: Buffer) {
    const root = await tempRoot();
    const sharedSource = path.join(root, "skills", "claude", "_shared", "kiwi");
    await mkdir(sharedSource, { recursive: true });
    await writeFile(path.join(sharedSource, contract), bytes);
    await writeSourceSkill(path.join(root, "skills"), "claude", "kiwi-going", { shared: [contract] });
    const dest = await installClaudeAll(root);
    const target = path.join(dest, "_shared", "kiwi", contract);
    expect(await exists(target)).toBe(true);
    return { dest, target, sourceRoot: path.join(root, "skills", "claude") };
  }

  it("@req FR-NODE-190 AC-8: a mirrored text file rewritten to CRLF is removed as ours", async () => {
    const s = await mirrored("bundled.md", Buffer.from("# bundled\n\nbody\n"));
    await writeFile(s.target, toEnding(await readFile(s.target), "crlf"));
    const outcome = await removeAll(s.dest, s.sourceRoot);
    expect(outcome.removed).toContain(s.target);
    expect(await exists(s.target)).toBe(false);
  });

  it("@req FR-NODE-190 AC-8: a mirrored text file rewritten to CRLF and edited is kept as locally modified", async () => {
    const s = await mirrored("bundled.md", Buffer.from("# bundled\n\nbody\n"));
    await writeFile(s.target, toEnding(Buffer.from("# bundled\n\nBody\n"), "crlf"));
    const outcome = await removeAll(s.dest, s.sourceRoot);
    expect(await exists(s.target)).toBe(true);
    expect(outcome.kept.find((entry) => entry.path === s.target)?.reason).toBe("locally-modified");
  });

  it("@req FR-NODE-190 AC-8: a mirrored file holding a NUL byte whose newlines became CRLF is kept as locally modified", async () => {
    const s = await mirrored("blob.bin", BINARY);
    await writeFile(s.target, toEnding(BINARY, "crlf"));
    const outcome = await removeAll(s.dest, s.sourceRoot);
    expect(await exists(s.target)).toBe(true);
    expect(outcome.kept.find((entry) => entry.path === s.target)?.reason).toBe("locally-modified");
  });
});
