import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { MIRROR_MODES, mirrorSkills } from "../../../src/core/skills/mirror-skills.js";

// @req FR-NODE-105 — `speckiwi skills mirror --check | --write`, the sanctioned writer for
// `.agents/skills/**`.
//
// 05 §9.5: CP-05 marks the mirror orchestrator-only while §14 registration 5 requires
// `waves-event.md` v1.4.0 in all four copies and E28 asserts set-equality across them — so four-copy
// parity was a shipping requirement with no sanctioned writer. This verb is neither `init` nor
// `skills install`, so `00.charter.md:303-304` is untouched.

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const roots: string[] = [];

afterAll(async () => {
  for (const root of roots) await rm(root, { recursive: true, force: true });
});

async function tempRoot(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "speckiwi-skills-mirror-"));
  roots.push(root);
  return root;
}

async function write(absolutePath: string, text: string): Promise<void> {
  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, text, "utf8");
}

function skillBody(name: string): string {
  return ["---", `name: ${name}`, `description: ${name}`, "---", "", `# ${name}`, "", "Read `../_shared/kiwi/waves-event.md` first.", ""].join("\n");
}

/**
 * A fixture repository: three source skills (one of them mirror-excluded), a shared contract, and a
 * non-skill file at the source root that must never be mirrored.
 */
async function fixture(): Promise<string> {
  const root = await tempRoot();
  await write(path.join(root, "skills", "codex", "kiwi-alpha", "SKILL.md"), skillBody("kiwi-alpha"));
  await write(path.join(root, "skills", "codex", "kiwi-alpha", "references", "extra.md"), "# alpha reference\n");
  await write(path.join(root, "skills", "codex", "kiwi-beta", "SKILL.md"), skillBody("kiwi-beta"));
  await write(path.join(root, "skills", "codex", "kiwi-excluded", "SKILL.md"), skillBody("kiwi-excluded"));
  await write(path.join(root, "skills", "codex", "_shared", "kiwi", "waves-event.md"), "# kiwi waves event v1.4.0\n");
  await write(path.join(root, "skills", "codex", "MIGRATION_PLAN.md"), "# not a skill\n");
  await write(
    path.join(root, ".agents", "skills", ".speckiwi-mirror-exclusions.json"),
    `${JSON.stringify({ excluded: ["kiwi-excluded"], reason: "hermeticity leak sentinel; must stay untracked in this mirror" }, null, 2)}\n`
  );
  return root;
}

/** Every file under a directory, as `{posixPath: contents}`. Absent directory yields `{}`. */
async function snapshot(directory: string): Promise<Record<string, string>> {
  const files: Record<string, string> = {};
  async function walk(current: string): Promise<void> {
    const entries = await readdir(current, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      const absolutePath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        await walk(absolutePath);
        continue;
      }
      files[path.relative(directory, absolutePath).split(path.sep).join("/")] = await readFile(absolutePath, "utf8");
    }
  }
  await walk(directory);
  return files;
}

describe("FR-NODE-105 — the two modes, and the usage that is neither", () => {
  it("declares exactly the two modes", () => {
    expect([...MIRROR_MODES]).toEqual(["check", "write"]);
    expect(MIRROR_MODES).toHaveLength(2);
  });
});

describe("FR-NODE-105 AC-1 — --write regenerates the mirror from skills/codex", () => {
  it("reproduces every non-excluded skill's content", async () => {
    const root = await fixture();
    const result = await mirrorSkills({ projectRoot: root, mode: "write" });

    expect(result.ok).toBe(true);
    const source = await snapshot(path.join(root, "skills", "codex"));
    const mirror = await snapshot(path.join(root, ".agents", "skills"));

    for (const name of ["kiwi-alpha", "kiwi-beta"]) {
      const files = Object.keys(source).filter((file) => file.startsWith(`${name}/`));
      expect(files.length, `${name} has source files`).toBeGreaterThan(0);
      for (const file of files) expect(mirror[file], file).toBe(source[file]);
    }
    expect(mirror["_shared/kiwi/waves-event.md"]).toBe(source["_shared/kiwi/waves-event.md"]);
  });

  it("mirrors no non-skill file from the source root", async () => {
    const root = await fixture();
    await mirrorSkills({ projectRoot: root, mode: "write" });
    const mirror = await snapshot(path.join(root, ".agents", "skills"));
    expect(Object.keys(mirror)).not.toContain("MIGRATION_PLAN.md");
  });

  it("removes a mirror file the source no longer carries", async () => {
    const root = await fixture();
    await write(path.join(root, ".agents", "skills", "kiwi-alpha", "references", "stale.md"), "# gone from source\n");
    const result = await mirrorSkills({ projectRoot: root, mode: "write" });
    expect(result.removed).toContain("kiwi-alpha/references/stale.md");
    const mirror = await snapshot(path.join(root, ".agents", "skills"));
    expect(Object.keys(mirror)).not.toContain("kiwi-alpha/references/stale.md");
  });

  it("is idempotent: a second --write over an in-sync mirror changes nothing", async () => {
    const root = await fixture();
    await mirrorSkills({ projectRoot: root, mode: "write" });
    const before = await snapshot(path.join(root, ".agents", "skills"));
    const second = await mirrorSkills({ projectRoot: root, mode: "write" });
    expect(second.ok).toBe(true);
    expect(second.divergences).toEqual([]);
    expect(await snapshot(path.join(root, ".agents", "skills"))).toEqual(before);
  });
});

describe("FR-NODE-105 AC-2 — --check reports, and writes nothing", () => {
  it("reports divergence on a divergent mirror and leaves the tree byte-unchanged", async () => {
    const root = await fixture();
    await write(path.join(root, ".agents", "skills", "kiwi-alpha", "SKILL.md"), "# hand-edited, out of band\n");
    const before = await snapshot(path.join(root, ".agents", "skills"));

    const result = await mirrorSkills({ projectRoot: root, mode: "check" });

    expect(result.ok).toBe(false);
    expect(result.divergences.map((entry) => entry.path)).toContain("kiwi-alpha/SKILL.md");
    expect(result.written).toEqual([]);
    expect(result.removed).toEqual([]);
    expect(await snapshot(path.join(root, ".agents", "skills")), "the check wrote nothing").toEqual(before);
  });

  it("reports a file missing from the mirror, and still writes nothing", async () => {
    const root = await fixture();
    const before = await snapshot(path.join(root, ".agents", "skills"));
    const result = await mirrorSkills({ projectRoot: root, mode: "check" });

    expect(result.ok).toBe(false);
    expect(result.divergences.some((entry) => entry.path === "kiwi-alpha/SKILL.md" && entry.kind === "missing-in-mirror")).toBe(true);
    expect(await snapshot(path.join(root, ".agents", "skills"))).toEqual(before);
  });

  it("reports an extra file the source does not carry, and still writes nothing", async () => {
    const root = await fixture();
    await mirrorSkills({ projectRoot: root, mode: "write" });
    await write(path.join(root, ".agents", "skills", "kiwi-beta", "invented.md"), "# nothing produced this\n");
    const before = await snapshot(path.join(root, ".agents", "skills"));

    const result = await mirrorSkills({ projectRoot: root, mode: "check" });
    expect(result.ok).toBe(false);
    expect(result.divergences.some((entry) => entry.path === "kiwi-beta/invented.md" && entry.kind === "extra-in-mirror")).toBe(true);
    expect(await snapshot(path.join(root, ".agents", "skills"))).toEqual(before);
  });

  it("reports success on an in-sync mirror", async () => {
    const root = await fixture();
    await mirrorSkills({ projectRoot: root, mode: "write" });
    const result = await mirrorSkills({ projectRoot: root, mode: "check" });
    expect(result.ok).toBe(true);
    expect(result.divergences).toEqual([]);
  });

  it("ignores a line-ending difference, so a Windows checkout is not permanently divergent", async () => {
    // Measured on this repository: `git ls-files --eol` reports `i/lf w/crlf` for the `.agents` copy
    // and `i/lf w/lf` for the codex one. A byte-strict check is red on a clean checkout, and a gate
    // that is red on a clean checkout gets switched off.
    const root = await fixture();
    await mirrorSkills({ projectRoot: root, mode: "write" });
    const mirrored = path.join(root, ".agents", "skills", "kiwi-alpha", "SKILL.md");
    await writeFile(mirrored, (await readFile(mirrored, "utf8")).replace(/\n/g, "\r\n"), "utf8");

    const result = await mirrorSkills({ projectRoot: root, mode: "check" });
    expect(result.ok).toBe(true);
    expect(result.divergences).toEqual([]);
  });
});

describe("FR-NODE-105 AC-3 — both modes honour .speckiwi-mirror-exclusions.json", () => {
  it("neither regenerates an excluded skill nor reports it as divergent", async () => {
    const root = await fixture();
    const write_ = await mirrorSkills({ projectRoot: root, mode: "write" });

    expect(write_.excluded).toEqual(["kiwi-excluded"]);
    const mirror = await snapshot(path.join(root, ".agents", "skills"));
    expect(Object.keys(mirror).some((file) => file.startsWith("kiwi-excluded/"))).toBe(false);

    const check = await mirrorSkills({ projectRoot: root, mode: "check" });
    expect(check.ok).toBe(true);
    expect(check.divergences.some((entry) => entry.path.startsWith("kiwi-excluded/"))).toBe(false);
  });

  it("leaves an excluded skill already present in the mirror alone rather than pruning it", async () => {
    const root = await fixture();
    await write(path.join(root, ".agents", "skills", "kiwi-excluded", "SKILL.md"), "# locally kept\n");
    await mirrorSkills({ projectRoot: root, mode: "write" });
    expect(await readFile(path.join(root, ".agents", "skills", "kiwi-excluded", "SKILL.md"), "utf8")).toBe("# locally kept\n");
  });

  it("modifies neither the exclusions file's entries nor its reason, in either mode", async () => {
    const root = await fixture();
    const manifestPath = path.join(root, ".agents", "skills", ".speckiwi-mirror-exclusions.json");
    const before = await readFile(manifestPath, "utf8");

    await mirrorSkills({ projectRoot: root, mode: "check" });
    expect(await readFile(manifestPath, "utf8")).toBe(before);
    await mirrorSkills({ projectRoot: root, mode: "write" });
    expect(await readFile(manifestPath, "utf8")).toBe(before);

    const parsed = JSON.parse(before) as { excluded: string[]; reason: string };
    expect(parsed.excluded).toEqual(["kiwi-excluded"]);
    expect(parsed.reason.length).toBeGreaterThan(0);
  });

  it("treats an absent or unparseable manifest as excluding nothing", async () => {
    const root = await fixture();
    await rm(path.join(root, ".agents", "skills", ".speckiwi-mirror-exclusions.json"));
    const absent = await mirrorSkills({ projectRoot: root, mode: "write" });
    expect(absent.excluded).toEqual([]);
    expect(Object.keys(await snapshot(path.join(root, ".agents", "skills"))).some((file) => file.startsWith("kiwi-excluded/"))).toBe(true);

    const broken = await tempRoot();
    await write(path.join(broken, "skills", "codex", "kiwi-alpha", "SKILL.md"), skillBody("kiwi-alpha"));
    await write(path.join(broken, ".agents", "skills", ".speckiwi-mirror-exclusions.json"), "{ not json");
    expect((await mirrorSkills({ projectRoot: broken, mode: "write" })).excluded).toEqual([]);
  });
});

describe("FR-NODE-105 AC-4 — neither mode reaches init or skills install", () => {
  const MIRROR_SOURCE = readFileSync(path.join(REPO_ROOT, "src", "core", "skills", "mirror-skills.ts"), "utf8");
  const INSTALL_REFERENCE = /install-skill|installSkill|init-project|initProject|initialiseProject/;

  it("imports neither code path", () => {
    // Positive control first: the probe regex must actually match something, or the assertion below
    // could never have failed.
    expect(INSTALL_REFERENCE.test(readFileSync(path.join(REPO_ROOT, "src", "core", "skills", "install-skill.ts"), "utf8"))).toBe(true);
    expect(MIRROR_SOURCE).not.toMatch(INSTALL_REFERENCE);
  });

  it("produces none of the artifacts init or skills install would leave behind", async () => {
    const root = await fixture();
    await mirrorSkills({ projectRoot: root, mode: "write" });

    const produced = await snapshot(root);
    // `init` writes `.mcp.json`, `docs/spec/**` and `CLAUDE.md`; `skills install` writes a per-skill
    // `.speckiwi-skill-install.json`. The mirror writes only mirror content.
    expect(Object.keys(produced)).not.toContain(".mcp.json");
    expect(Object.keys(produced).some((file) => file.startsWith("docs/spec/"))).toBe(false);
    expect(Object.keys(produced).some((file) => file.endsWith(".speckiwi-skill-install.json"))).toBe(false);
    expect(Object.keys(produced).some((file) => file.startsWith(".claude/"))).toBe(false);
  });

  it("leaves a pre-existing install metadata file untouched rather than treating it as mirror content", async () => {
    const root = await fixture();
    const metadataPath = path.join(root, ".agents", "skills", "kiwi-alpha", ".speckiwi-skill-install.json");
    await write(metadataPath, '{"name":"kiwi-alpha"}\n');

    const check = await mirrorSkills({ projectRoot: root, mode: "check" });
    expect(check.divergences.some((entry) => entry.path.endsWith(".speckiwi-skill-install.json"))).toBe(false);
    await mirrorSkills({ projectRoot: root, mode: "write" });
    expect(await readFile(metadataPath, "utf8")).toBe('{"name":"kiwi-alpha"}\n');
  });
});

describe("FR-NODE-105 AC-5 — the four-copy parity case E28 depends on", () => {
  it("reports divergence when _shared/kiwi/waves-event.md diverges from the codex variant", async () => {
    const root = await fixture();
    await mirrorSkills({ projectRoot: root, mode: "write" });
    await write(path.join(root, ".agents", "skills", "_shared", "kiwi", "waves-event.md"), "# kiwi waves event v1.3.0\n");

    const result = await mirrorSkills({ projectRoot: root, mode: "check" });
    expect(result.ok, "a stale mirror of the shared contract must not report success").toBe(false);
    expect(result.divergences.map((entry) => entry.path)).toContain("_shared/kiwi/waves-event.md");
  });

  it("restores it under --write", async () => {
    const root = await fixture();
    await write(path.join(root, ".agents", "skills", "_shared", "kiwi", "waves-event.md"), "# kiwi waves event v1.3.0\n");
    await mirrorSkills({ projectRoot: root, mode: "write" });
    expect(await readFile(path.join(root, ".agents", "skills", "_shared", "kiwi", "waves-event.md"), "utf8")).toBe("# kiwi waves event v1.4.0\n");
  });
});
