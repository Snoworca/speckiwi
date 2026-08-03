import { access, lstat, mkdir, mkdtemp, readFile, readdir, symlink, writeFile } from "node:fs/promises";
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

async function writeSharedKiwiResource(root: string, source: "codex" | "claude" | "etc", relativePath: string, body = "shared\n"): Promise<void> {
  const target = path.join(root, "skills", source, "_shared", "kiwi", relativePath);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, body, "utf8");
}

async function pathExists(target: string): Promise<boolean> {
  return access(target).then(() => true).catch(() => false);
}

async function listRelativeFiles(root: string): Promise<string[]> {
  const files: string[] = [];
  async function walk(directory: string): Promise<void> {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const absolutePath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        await walk(absolutePath);
      } else if (entry.isFile()) {
        files.push(path.relative(root, absolutePath).split(path.sep).join("/"));
      }
    }
  }
  await walk(root);
  return files.sort((left, right) => left.localeCompare(right));
}

function sharedKiwiReferences(text: string): string[] {
  const references = new Set<string>();
  const pattern = /(?:^|[\s('"`])((?:\.\.\/)+_shared\/kiwi\/[A-Za-z0-9._/-]+)/g;
  for (const match of text.matchAll(pattern)) {
    const value = match[1]?.replace(/[),.;:'"`]+$/g, "");
    if (value) references.add(value);
  }
  return [...references].sort((left, right) => left.localeCompare(right));
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
    // @req IR-CLI-086 AC-3 — the status is computed now, not a constant: this fixture root has no
    // .mcp.json, so the SpecKiwi server is not registered.
    expect(result.value.mcpPreflight.status).toBe("missing");
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

  it("writes reproducible provenance metadata and refreshes legacy metadata", async () => {
    const root = await tempRoot();
    await writeSkill(root, "codex", "kiwi-pm");
    const installed = await installSkill(baseOptions(root, { agent: "codex", dryRun: false }));
    expect(installed.ok).toBe(true);
    if (!installed.ok) throw new Error(installed.error.message);

    const metadataPath = path.join(root, ".agents", "skills", "kiwi-pm", ".speckiwi-skill-install.json");
    const metadata = JSON.parse(await readFile(metadataPath, "utf8")) as Record<string, unknown>;
    expect(metadata).toMatchObject({
      name: "kiwi-pm",
      agent: "codex",
      installMode: "generated-runtime-mirror",
      sourceAgent: "codex",
      sourceRoot: "skills/codex",
      sourcePath: "skills/codex/kiwi-pm",
      installedPath: ".agents/skills/kiwi-pm",
      sourceRevision: "unknown",
      sourceFileCount: 2,
      installedFileCount: 2,
      sharedResourceRoot: ".agents/skills/_shared/kiwi",
      sharedResourceValidation: "not-required",
      sharedResourceReferences: [],
      refreshCommand: "node bin/speckiwi --root . skills install codex kiwi-pm --json",
      noManualEdit: true
    });
    expect(metadata.sourceChecksum).toBe(metadata.installedChecksum);

    await writeFile(metadataPath, JSON.stringify({ ...metadata, sourceRevision: "stale", sourceChecksum: "sha256:stale", installedChecksum: "sha256:stale" }, null, 2), "utf8");
    const plannedStaleRefresh = await planSkillInstall(baseOptions(root, { agent: "codex" }));
    expect(plannedStaleRefresh.ok).toBe(true);
    if (!plannedStaleRefresh.ok) throw new Error(plannedStaleRefresh.error.message);
    expect(plannedStaleRefresh.value.results[0]).toMatchObject({ operation: "update", changed: true });

    await writeFile(metadataPath, JSON.stringify({ name: "kiwi-pm", agent: "codex", installedAt: "legacy" }, null, 2), "utf8");
    const plannedRefresh = await planSkillInstall(baseOptions(root, { agent: "codex" }));
    expect(plannedRefresh.ok).toBe(true);
    if (!plannedRefresh.ok) throw new Error(plannedRefresh.error.message);
    expect(plannedRefresh.value.results[0]).toMatchObject({ operation: "update", changed: true });

    const refreshed = await installSkill(baseOptions(root, { agent: "codex", dryRun: false }));
    expect(refreshed.ok).toBe(true);
    const refreshedMetadata = JSON.parse(await readFile(metadataPath, "utf8")) as Record<string, unknown>;
    expect(refreshedMetadata.noManualEdit).toBe(true);
    expect(refreshedMetadata.sourceChecksum).toBe(refreshedMetadata.installedChecksum);
  });

  it("validates shared Kiwi resource references and records them in mirror metadata", async () => {
    const root = await tempRoot();
    const body = "Read `../_shared/kiwi/auto-option.md` before auto mode.";
    await writeSkill(root, "codex", "kiwi-pm", { body });

    const missing = await planSkillInstall(baseOptions(root, { agent: "codex" }));
    expect(missing.ok).toBe(false);
    if (missing.ok) throw new Error("expected missing shared resource error");
    expect(missing.error.code).toBe("SKILL_INSTALL_INVALID_SOURCE");
    expect(missing.error.message).toContain("_shared/kiwi/auto-option.md");

    await writeSharedKiwiResource(root, "codex", "auto-option.md");
    const installed = await installSkill(baseOptions(root, { agent: "codex", dryRun: false }));
    expect(installed.ok).toBe(true);
    if (!installed.ok) throw new Error(installed.error.message);

    const metadata = JSON.parse(await readFile(path.join(root, ".agents", "skills", "kiwi-pm", ".speckiwi-skill-install.json"), "utf8")) as Record<string, unknown>;
    expect(metadata).toMatchObject({
      installMode: "generated-runtime-mirror",
      sharedResourceRoot: ".agents/skills/_shared/kiwi",
      sharedResourceValidation: "source-references-validated",
      sharedResourceReferences: ["_shared/kiwi/auto-option.md"],
      noManualEdit: true
    });
  });

  it("classifies scoped runtime Kiwi mirrors as generated outputs with valid shared resources", async () => {
    const repoRoot = process.cwd();
    const skillNames = ["kiwi-planner", "kiwi-pm", "kiwi-coder", "kiwi-pipeline", "kiwi-srs"];
    for (const name of skillNames) {
      const sourceDir = path.join(repoRoot, "skills", "codex", name);
      const mirrorDir = path.join(repoRoot, ".agents", "skills", name);
      const metadataPath = path.join(mirrorDir, ".speckiwi-skill-install.json");
      const metadata = JSON.parse(await readFile(metadataPath, "utf8")) as Record<string, unknown>;

      expect(metadata).toMatchObject({
        name,
        agent: "codex",
        installMode: "generated-runtime-mirror",
        sourceAgent: "codex",
        sourceRoot: "skills/codex",
        sourcePath: `skills/codex/${name}`,
        installedPath: `.agents/skills/${name}`,
        sharedResourceRoot: ".agents/skills/_shared/kiwi",
        sharedResourceValidation: "source-references-validated",
        refreshCommand: `node bin/speckiwi --root . skills install codex ${name} --json`,
        noManualEdit: true
      });
      expect(metadata.sharedResourceReferences).toEqual(expect.arrayContaining(["_shared/kiwi/pipeline-event.md"]));

      const sourceFiles = await listRelativeFiles(sourceDir);
      const mirrorFiles = (await listRelativeFiles(mirrorDir)).filter((file) => file !== ".speckiwi-skill-install.json");
      expect(mirrorFiles).toEqual(sourceFiles);
      for (const file of sourceFiles) {
        const [mirrorText, sourceText] = await Promise.all([
          readFile(path.join(mirrorDir, file), "utf8"),
          readFile(path.join(sourceDir, file), "utf8")
        ]);
        // EOL-agnostic: the git index is byte-identical LF; only the Windows working-tree
        // materialization (core.autocrlf) can diverge, so compare logical content.
        expect(mirrorText.replace(/\r\n/g, "\n")).toBe(sourceText.replace(/\r\n/g, "\n"));
      }

      for (const file of mirrorFiles.filter((item) => item.endsWith(".md"))) {
        const text = await readFile(path.join(mirrorDir, file), "utf8");
        for (const reference of sharedKiwiReferences(text)) {
          const resolved = path.resolve(path.dirname(path.join(mirrorDir, file)), reference);
          expect(path.relative(path.join(repoRoot, ".agents", "skills", "_shared", "kiwi"), resolved).startsWith("..")).toBe(false);
          expect(await pathExists(resolved)).toBe(true);
        }
      }
    }
  });

  it("keeps scoped Kiwi skills on official workflow tools before degraded raw-file fallback", async () => {
    const repoRoot = process.cwd();
    const skillNames = ["kiwi-planner", "kiwi-pm", "kiwi-coder", "kiwi-pipeline", "kiwi-srs"];
    const roots = ["skills/codex", ".agents/skills"];
    for (const root of roots) {
      for (const name of skillNames) {
        const skillDir = path.join(repoRoot, root, name);
        const files = (await listRelativeFiles(skillDir)).filter((file) => file.endsWith(".md"));
        const text = (await Promise.all(files.map((file) => readFile(path.join(skillDir, file), "utf8")))).join("\n");

        expect(text).toContain("Official Workflow Tool Policy");
        expect(text).toContain("get_next_work_order");
        expect(text).toContain("workflow_pipeline_emit");
        expect(text).toContain("degraded mode");
        expect(text).toContain("capturing tool diagnostics");
        expect(text).toContain("affected artifact paths");
        expect(text).toContain("active target");
        expect(text).toContain("follow-up requirement or candidate ID");
        expect(text).not.toContain("includeContent");

        const officialIndex = text.indexOf("workflow_pipeline_emit");
        const rawPipelineIndex = text.indexOf("./kiwi/pipeline.jsonl");
        expect(officialIndex).toBeGreaterThanOrEqual(0);
        if (rawPipelineIndex >= 0) expect(officialIndex).toBeLessThan(rawPipelineIndex);
      }
    }
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
    // @req FR-NODE-173 AC-1 — the guard now runs in every scope, not custom alone, and the message
    // names the destination and the way out. Asserted by shape rather than by the old exact string.
    expect(result.value.results[0]?.conflicts.join(" ")).toContain("holds no SpecKiwi install metadata");
    expect(result.value.results[0]?.conflicts.join(" ")).toContain(destinationRoot);
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

  it("materializes referenced shared Kiwi resources into the mirror and prunes stale shared files", async () => {
    const root = await tempRoot();
    await writeSkill(root, "codex", "kiwi-pm", { body: "Read `../_shared/kiwi/auto-option.md` before auto mode." });
    await writeSharedKiwiResource(root, "codex", "auto-option.md", "auto option v1\n");

    const sharedMirror = path.join(root, ".agents", "skills", "_shared", "kiwi");
    await mkdir(sharedMirror, { recursive: true });
    await writeFile(path.join(sharedMirror, "stale.md"), "stale shared\n", "utf8");

    const installed = await installSkill(baseOptions(root, { agent: "codex", dryRun: false }));
    expect(installed.ok).toBe(true);
    if (!installed.ok) throw new Error(installed.error.message);

    const mirrorAutoOption = path.join(sharedMirror, "auto-option.md");
    expect(await pathExists(mirrorAutoOption)).toBe(true);
    await expect(readFile(mirrorAutoOption, "utf8")).resolves.toBe("auto option v1\n");
    expect(await pathExists(path.join(sharedMirror, "stale.md"))).toBe(false);
  });

  it("preserves cross-skill shared resources when a single skill is reinstalled", async () => {
    const root = await tempRoot();
    await writeSkill(root, "codex", "kiwi-pm", { body: "Read `../_shared/kiwi/auto-option.md`." });
    await writeSkill(root, "codex", "kiwi-srs-feasibility", { body: "Schema `../_shared/kiwi/feasibility-policy-schema-v1.md`." });
    await writeSharedKiwiResource(root, "codex", "auto-option.md", "auto\n");
    await writeSharedKiwiResource(root, "codex", "feasibility-policy-schema-v1.md", "schema\n");

    const both = await installSkill(baseOptions(root, { agent: "codex", selector: "all", dryRun: false }));
    expect(both.ok).toBe(true);

    const sharedMirror = path.join(root, ".agents", "skills", "_shared", "kiwi");
    expect(await pathExists(path.join(sharedMirror, "auto-option.md"))).toBe(true);
    expect(await pathExists(path.join(sharedMirror, "feasibility-policy-schema-v1.md"))).toBe(true);

    const single = await installSkill(baseOptions(root, { agent: "codex", selector: "kiwi-pm", dryRun: false }));
    expect(single.ok).toBe(true);
    expect(await pathExists(path.join(sharedMirror, "auto-option.md"))).toBe(true);
    expect(await pathExists(path.join(sharedMirror, "feasibility-policy-schema-v1.md"))).toBe(true);
  });
});
