import { access, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { initProject } from "../../src/core/bootstrap/init-project.js";
import { resolveProjectRoot } from "../../src/core/project-root.js";
import { installSkill, removeManagedKiwiSkills } from "../../src/core/skills/install-skill.js";

// verify-v536-r1 bundle A — FR-NODE-277 AC-3 / AC-5: install metadata older than the
// line-ending-insensitive checksum, a skill whose installed files mix CRLF and LF, every file then
// rewritten to CRLF. Each red case has a green control (legacy=false / sourceChanged=false).

vi.setConfig({ testTimeout: 120_000 });

const METADATA = ".speckiwi-skill-install.json";

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
async function rewrite(dir: string, ending: Ending): Promise<void> {
  for (const file of await filesUnder(dir)) await writeFile(file, toEnding(await readFile(file), ending));
}
async function predate(dir: string): Promise<void> {
  const file = path.join(dir, METADATA);
  const metadata = JSON.parse(await readFile(file, "utf8")) as Record<string, unknown>;
  delete metadata.installedChecksumIgnoringLineEndings;
  await writeFile(file, `${JSON.stringify(metadata, null, 2)}\n`, "utf8");
}
/** A two-file skill whose install mixes endings: SKILL.md CRLF, references/guide.md LF. */
async function writeMixedSkill(base: string, agent: "claude" | "codex", name: string): Promise<void> {
  const dir = path.join(base, agent, name);
  await mkdir(path.join(dir, "references"), { recursive: true });
  const body = ["---", `name: ${name}`, "description: test skill", "---", "", `# ${name}`, "", "Normal operation requires speckiwi mcp.", ""].join("\n");
  await writeFile(path.join(dir, "SKILL.md"), toEnding(Buffer.from(body), "crlf"));
  await writeFile(path.join(dir, "references", "guide.md"), Buffer.from("guide\nsecond line\n"));
}

describe("A-2 legacy metadata, mixed-ending install, every file rewritten to CRLF", () => {
  for (const legacy of [false, true]) it(`init orphan prune (FR-NODE-277 AC-3 + AC-5) prunes the line-ending-only orphan (legacy metadata: ${legacy})`, async () => {
    const root = await mkdtemp(path.join(tmpdir(), "v536-mixed-prune-"));
    await mkdir(path.join(root, ".git"));
    const base = await mkdtemp(path.join(tmpdir(), "v536-mixed-prune-src-"));
    for (const agent of ["claude", "codex"] as const) {
      await writeMixedSkill(base, agent, "kiwi-keep");
      await writeMixedSkill(base, agent, "kiwi-old");
    }
    const projectRoot = await resolveProjectRoot(root);
    const first = await initProject(projectRoot, { projectInstall: true, installSkills: true, skillSourceBaseDir: base });
    if (!first.ok) throw new Error(first.error?.message);
    for (const agent of ["claude", "codex"] as const) await rm(path.join(base, agent, "kiwi-old"), { recursive: true, force: true });
    const old = path.join(root, ".claude", "skills", "kiwi-old");
    if (legacy) await predate(old);
    await rewrite(old, "crlf");

    const second = await initProject(projectRoot, { projectInstall: true, installSkills: true, skillSourceBaseDir: base });
    if (!second.ok) throw new Error(second.error?.message);
    const warnings = (second.value?.warnings ?? []).filter((w) => w.includes(old));
    expect(warnings, "orphan prune verdict").toEqual([]);
    expect(await exists(old)).toBe(false);
  });

  for (const sourceChanged of [false, true]) it(`removal with the bundled source still proves the copy (source endings changed since install: ${sourceChanged})`, async () => {
    const root = await mkdtemp(path.join(tmpdir(), "v536-mixed-srcchg-"));
    const base = path.join(root, "skills");
    await writeMixedSkill(base, "claude", "kiwi-a");
    const result = await installSkill({
      projectRoot: { root },
      agent: "claude",
      selector: "all",
      scope: "project",
      sourceBaseDir: base,
      homeDir: path.join(root, "home"),
      env: {},
      dryRun: false
    });
    if (!result.ok) throw new Error(result.error.message);
    const dest = path.join(root, ".claude", "skills");
    const copy = path.join(dest, "kiwi-a");
    await predate(copy);
    await rewrite(copy, "crlf");
    // The bundled source is re-checked-out with its .gitattributes eol=lf: SKILL.md becomes LF.
    if (sourceChanged) await rewrite(path.join(base, "claude", "kiwi-a"), "lf");
    const outcome = await removeManagedKiwiSkills({ destinationRoot: dest, agent: "claude", keepNames: [], dryRun: true, sourceRoot: path.join(base, "claude") });
    expect(outcome.kept.filter((k) => k.path === copy)).toEqual([]);
    expect(outcome.removed).toContain(copy);
  });
});
