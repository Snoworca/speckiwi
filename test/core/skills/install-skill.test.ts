import { lstat, mkdir, mkdtemp, readFile, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { installSkill, planSkillInstall } from "../../../src/core/skills/install-skill.js";
import type { SkillInstallOptions } from "../../../src/core/skills/types.js";

async function tempRoot(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), "speckiwi-skills-"));
}

async function writeSkill(root: string, source: "codex" | "claude" | "etc", name: string, options: { entry?: "SKILL.md" | "skill.md"; body?: string } = {}): Promise<void> {
  const skillDir = path.join(root, "skills", source, name);
  await mkdir(path.join(skillDir, "references"), { recursive: true });
  const entry = options.entry ?? "SKILL.md";
  await writeFile(
    path.join(skillDir, entry),
    [
      "---",
      `name: ${name}`,
      `description: ${name} test skill`,
      "---",
      "",
      options.body ?? `# ${name}`,
      "",
      "Normal operation requires speckiwi mcp."
    ].join("\n"),
    "utf8"
  );
  await writeFile(path.join(skillDir, "references", "guide.md"), "guide\n", "utf8");
}

async function writeInstalledSkill(root: string, name: string, body = "# old"): Promise<void> {
  const skillDir = path.join(root, name);
  await mkdir(skillDir, { recursive: true });
  await writeFile(path.join(skillDir, "SKILL.md"), ["---", `name: ${name}`, "description: installed", "---", "", body].join("\n"), "utf8");
}

function baseOptions(root: string, overrides: Partial<SkillInstallOptions> = {}): SkillInstallOptions {
  return {
    projectRoot: { root },
    sourceBaseDir: path.join(root, "skills"),
    homeDir: path.join(root, "home"),
    env: {},
    agent: "opencode",
    selector: "kiwi-pm",
    scope: "project",
    dryRun: true,
    ...overrides
  };
}

describe("skill install core", () => {
  it("plans OpenCode project installs from skills/etc and reports MCP preflight", async () => {
    const root = await tempRoot();
    await writeSkill(root, "etc", "kiwi-pm");
    const result = await planSkillInstall(baseOptions(root));
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value.agent).toBe("opencode");
    expect(result.value.sourceRoot).toBe(path.join(root, "skills", "etc"));
    expect(result.value.destinationRoot).toBe(path.join(root, ".opencode", "skills"));
    expect(result.value.requiresMcp).toBe(true);
    expect(result.value.mcpPreflight.status).toBe("not_checked");
    expect(result.value.results).toMatchObject([{ name: "kiwi-pm", operation: "install", changed: true }]);
  });

  it("resolves Codex installs from skills/codex into the project agent skills directory", async () => {
    const root = await tempRoot();
    await writeSkill(root, "codex", "kiwi-pm");
    const result = await planSkillInstall(baseOptions(root, { agent: "codex" }));
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value.sourceRoot).toBe(path.join(root, "skills", "codex"));
    expect(result.value.destinationRoot).toBe(path.join(root, ".agents", "skills"));
    expect(result.value.results[0]).toMatchObject({ name: "kiwi-pm", operation: "install" });
  });

  it("rejects unsupported runtime agent values with a structured error", async () => {
    const root = await tempRoot();
    await writeSkill(root, "etc", "kiwi-pm");
    const result = await planSkillInstall(baseOptions(root, { agent: "unknown" as never }));
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected invalid agent error");
    expect(result.error.code).toBe("SKILL_INSTALL_UNSUPPORTED_AGENT");
  });

  it("rejects deprecated skills/llm source bases before planning", async () => {
    const root = await tempRoot();
    const llmBase = path.join(root, "skills", "llm");
    const skillDir = path.join(llmBase, "etc", "kiwi-pm");
    await mkdir(skillDir, { recursive: true });
    await writeFile(path.join(skillDir, "SKILL.md"), ["---", "name: kiwi-pm", "description: deprecated source", "---", "", "# kiwi-pm"].join("\n"), "utf8");
    const result = await planSkillInstall(baseOptions(root, { sourceBaseDir: llmBase }));
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected deprecated source error");
    expect(result.error.code).toBe("SKILL_INSTALL_DEPRECATED_SOURCE");
  });

  it("classifies CLI-installed same-identity destinations as update and identical destinations as skip", async () => {
    const root = await tempRoot();
    const destinationRoot = path.join(root, "custom-dest");
    await writeSkill(root, "etc", "kiwi-pm", { body: "# old" });
    const firstInstall = await installSkill(baseOptions(root, { scope: "custom", dest: destinationRoot, dryRun: false }));
    expect(firstInstall.ok).toBe(true);
    await writeSkill(root, "etc", "kiwi-pm", { body: "# new" });
    const update = await planSkillInstall(baseOptions(root, { scope: "custom", dest: destinationRoot }));
    expect(update.ok).toBe(true);
    if (!update.ok) throw new Error(update.error.message);
    expect(update.value.results[0]).toMatchObject({ operation: "update", changed: true });

    await writeSkill(root, "etc", "kiwi-srs", { body: "# kiwi-srs" });
    const srsInstall = await installSkill(baseOptions(root, { selector: "kiwi-srs", scope: "custom", dest: destinationRoot, dryRun: false }));
    expect(srsInstall.ok).toBe(true);
    const skip = await planSkillInstall(baseOptions(root, { selector: "kiwi-srs", scope: "custom", dest: destinationRoot }));
    expect(skip.ok).toBe(true);
    if (!skip.ok) throw new Error(skip.error.message);
    expect(skip.value.results[0]).toMatchObject({ operation: "skip", changed: false });
  });

  it("treats custom dest as a destination root and supports all expansion", async () => {
    const root = await tempRoot();
    await writeSkill(root, "etc", "kiwi-pm");
    await writeSkill(root, "etc", "kiwi-srs");
    await writeSkill(root, "etc", "_shared");
    const destinationRoot = path.join(root, "custom-dest");

    const result = await planSkillInstall(baseOptions(root, { selector: "all", scope: "custom", dest: destinationRoot }));
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value.results.map((row) => row.name)).toEqual(["kiwi-pm", "kiwi-srs"]);
    expect(result.value.results.map((row) => row.destination)).toEqual([path.join(destinationRoot, "kiwi-pm"), path.join(destinationRoot, "kiwi-srs")]);
  });

  it("resolves Hermes global installs under a category and rejects invalid category usage", async () => {
    const root = await tempRoot();
    await writeSkill(root, "etc", "kiwi-pm");
    const hermes = await planSkillInstall(baseOptions(root, { agent: "hermes", scope: "global", category: "kiwi" }));
    expect(hermes.ok).toBe(true);
    if (!hermes.ok) throw new Error(hermes.error.message);
    expect(hermes.value.destinationRoot).toBe(path.join(root, "home", ".hermes", "skills", "kiwi"));
    expect(hermes.value.results[0]?.identity.category).toBe("kiwi");

    const nonHermes = await planSkillInstall(baseOptions(root, { agent: "opencode", scope: "global", category: "kiwi" }));
    expect(nonHermes.ok).toBe(false);
    if (nonHermes.ok) throw new Error("expected category error");
    expect(nonHermes.error.code).toBe("SKILL_INSTALL_INVALID_OPTIONS");
  });

  it("normalizes legacy Claude skill.md sources to installed SKILL.md", async () => {
    const root = await tempRoot();
    await writeSkill(root, "claude", "kiwi-pm", { entry: "skill.md" });
    const destinationRoot = path.join(root, "claude-dest");
    const result = await installSkill(baseOptions(root, { agent: "claude", scope: "custom", dest: destinationRoot, dryRun: false }));
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value.results[0]).toMatchObject({ operation: "install", entrypointNormalized: true });
    await expect(readFile(path.join(destinationRoot, "kiwi-pm", "SKILL.md"), "utf8")).resolves.toContain("name: kiwi-pm");
  });

  it("rejects unsafe names, non-skill destination conflicts, and source symlinks without partial install", async () => {
    const root = await tempRoot();
    await writeSkill(root, "etc", "kiwi-pm");
    const unsafe = await planSkillInstall(baseOptions(root, { selector: "../kiwi-pm" }));
    expect(unsafe.ok).toBe(false);
    if (unsafe.ok) throw new Error("expected unsafe name error");
    expect(unsafe.error.code).toBe("SKILL_INSTALL_INVALID_SKILL");

    const destinationRoot = path.join(root, "custom-dest");
    await mkdir(path.join(destinationRoot, "kiwi-pm"), { recursive: true });
    await writeFile(path.join(destinationRoot, "kiwi-pm", "README.md"), "not a skill", "utf8");
    const conflict = await installSkill(baseOptions(root, { scope: "custom", dest: destinationRoot, dryRun: false }));
    expect(conflict.ok).toBe(false);
    if (conflict.ok) throw new Error("expected conflict");
    expect(conflict.error.code).toBe("SKILL_INSTALL_CONFLICT");
    await expect(readFile(path.join(destinationRoot, "kiwi-pm", "README.md"), "utf8")).resolves.toBe("not a skill");

    const linkRoot = await tempRoot();
    await writeSkill(linkRoot, "etc", "kiwi-pm");
    await mkdir(path.join(linkRoot, "outside"), { recursive: true });
    await symlink(
      path.join(linkRoot, "outside"),
      path.join(linkRoot, "skills", "etc", "kiwi-pm", "references", "outside"),
      process.platform === "win32" ? "junction" : "dir"
    );
    const symlinked = await planSkillInstall(baseOptions(linkRoot));
    expect(symlinked.ok).toBe(false);
    if (symlinked.ok) throw new Error("expected symlink error");
    expect(symlinked.error.code).toBe("SKILL_INSTALL_INVALID_SOURCE");
  });

  it("rejects custom same-name destinations without matching install metadata", async () => {
    const root = await tempRoot();
    await writeSkill(root, "etc", "kiwi-pm");
    const destinationRoot = path.join(root, "custom-dest");
    await writeInstalledSkill(destinationRoot, "kiwi-pm", "# manually installed");
    const result = await planSkillInstall(baseOptions(root, { scope: "custom", dest: destinationRoot }));
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value.results[0]).toMatchObject({ operation: "conflict", changed: false });
    expect(result.value.results[0]?.conflicts).toContain("custom destination lacks SpecKiwi install metadata for same-identity update");
  });

  it("does not install any selected skill when all expansion contains a conflict", async () => {
    const root = await tempRoot();
    await writeSkill(root, "etc", "kiwi-pm");
    await writeSkill(root, "etc", "kiwi-srs");
    const destinationRoot = path.join(root, "custom-dest");
    await mkdir(path.join(destinationRoot, "kiwi-pm"), { recursive: true });
    await writeFile(path.join(destinationRoot, "kiwi-pm", "README.md"), "not a skill", "utf8");

    const result = await installSkill(baseOptions(root, { selector: "all", scope: "custom", dest: destinationRoot, dryRun: false }));
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected conflict");
    expect(result.error.code).toBe("SKILL_INSTALL_CONFLICT");
    await expect(readFile(path.join(destinationRoot, "kiwi-srs", "SKILL.md"), "utf8")).rejects.toThrow();
  });

  it("rejects unsafe destination roots and missing referenced resources", async () => {
    const root = await tempRoot();
    await writeSkill(root, "etc", "kiwi-pm");
    const fileDestination = path.join(root, "destination-file");
    await writeFile(fileDestination, "not a directory", "utf8");
    const invalidRoot = await planSkillInstall(baseOptions(root, { scope: "custom", dest: fileDestination }));
    expect(invalidRoot.ok).toBe(false);
    if (invalidRoot.ok) throw new Error("expected invalid destination");
    expect(invalidRoot.error.code).toBe("SKILL_INSTALL_INVALID_DESTINATION");

    const brokenRoot = await tempRoot();
    await writeSkill(brokenRoot, "etc", "kiwi-pm", { body: "Read [missing](references/missing.md)." });
    const missingResource = await planSkillInstall(baseOptions(brokenRoot));
    expect(missingResource.ok).toBe(false);
    if (missingResource.ok) throw new Error("expected missing resource");
    expect(missingResource.error.code).toBe("SKILL_INSTALL_INVALID_SOURCE");
  });

  it("updates by staging then replacing stale files inside the skill directory", async () => {
    const root = await tempRoot();
    const destinationRoot = path.join(root, "custom-dest");
    await writeSkill(root, "etc", "kiwi-pm", { body: "# old" });
    const firstInstall = await installSkill(baseOptions(root, { scope: "custom", dest: destinationRoot, dryRun: false }));
    expect(firstInstall.ok).toBe(true);
    await writeSkill(root, "etc", "kiwi-pm", { body: "# replacement" });
    await writeFile(path.join(destinationRoot, "kiwi-pm", "stale.txt"), "stale", "utf8");

    const result = await installSkill(baseOptions(root, { scope: "custom", dest: destinationRoot, dryRun: false }));
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value.results[0]).toMatchObject({ operation: "update", changed: true });
    await expect(readFile(path.join(destinationRoot, "kiwi-pm", "SKILL.md"), "utf8")).resolves.toContain("# replacement");
    await expect(lstat(path.join(destinationRoot, "kiwi-pm", "stale.txt"))).rejects.toThrow();
  });
});
