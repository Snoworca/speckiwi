import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);

async function readPackageJson() {
  const text = await readFile("package.json", "utf8");
  return JSON.parse(text) as {
    description?: string;
    version?: string;
    type?: string;
    bin?: Record<string, string>;
    engines?: Record<string, string>;
    scripts?: Record<string, string>;
    keywords?: string[];
    dependencies?: Record<string, string>;
  };
}

async function readPackageLock() {
  const text = await readFile("package-lock.json", "utf8");
  return JSON.parse(text) as {
    name?: string;
    version?: string;
    packages?: Record<string, { name?: string; version?: string; dependencies?: Record<string, string> }>;
  };
}

describe("package runtime contract", () => {
  it("uses Node 22+ TypeScript ESM metadata without YAML-era wording", async () => {
    const pkg = await readPackageJson();

    expect(pkg.type).toBe("module");
    expect(pkg.engines?.node).toBe(">=22");
    expect(pkg.description?.toLowerCase()).not.toContain("yaml");
    expect(pkg.keywords ?? []).not.toContain("yaml");
  });

  it("exposes the speckiwi binary and planned verification scripts", async () => {
    const pkg = await readPackageJson();

    expect(pkg.bin?.speckiwi).toBe("./bin/speckiwi");
    expect(pkg.scripts?.build).toBe("tsc -p tsconfig.json");
    expect(pkg.scripts?.typecheck).toContain("--noEmit");
    expect(pkg.scripts?.test).toContain("vitest run");
    expect(pkg.scripts?.["test:coverage"]).toContain("--coverage");
    expect(pkg.scripts?.["test:integration"]).toContain("test/integration");
    expect(pkg.scripts?.["perf:srs"]).toContain("test/perf/parser-performance.test.ts");
    expect(pkg.scripts?.["release:acceptance"]).toContain("test/release");
    expect(pkg.scripts?.["version:check"]).toContain("scripts/version-check.mjs");
  });

  it("keeps package metadata and lockfile release identity synchronized", async () => {
    const pkg = await readPackageJson();
    const lock = await readPackageLock();
    const rootPackage = lock.packages?.[""];

    expect(pkg.version).toBe("2.2.3");
    expect(lock.name).toBe("speckiwi");
    expect(rootPackage?.name).toBe("speckiwi");
    expect(lock.version).toBe(pkg.version);
    expect(rootPackage?.version).toBe(pkg.version);
    expect(rootPackage?.dependencies).toEqual(pkg.dependencies);
    expect(rootPackage?.dependencies).not.toHaveProperty("speckiwi");
    expect(lock.packages).not.toHaveProperty("node_modules/speckiwi");
  });

  it("runs the package version guard script", async () => {
    const { stdout } = await execFileAsync("npm", ["run", "version:check", "--silent"], { cwd: process.cwd(), timeout: 120000, shell: true });
    expect(stdout).toContain("package version check passed: 2.2.3");
  }, 120000);

  it("does not expose stale package export paths", async () => {
    const pkg = await readPackageJson();

    expect(Object.keys((pkg as { exports?: Record<string, unknown> }).exports ?? {})).not.toContain("./cli/json-renderer");
    expect(Object.keys((pkg as { exports?: Record<string, unknown> }).exports ?? {})).not.toContain("./mcp/structured-content");
  });

  it("packs the bundled rules document", async () => {
    const { stdout } = await execFileAsync("npm", ["pack", "--dry-run", "--json"], { cwd: process.cwd(), timeout: 120000, shell: true });
    const [packed] = JSON.parse(stdout) as Array<{ files?: Array<{ path: string }> }>;
    const files = packed?.files?.map((file) => file.path) ?? [];
    expect(files).toContain("docs/rule/SRS-MD-Rules-v1.0.0.md");
    expect(files).toContain("skills/codex/kiwi-pm/SKILL.md");
    expect(files).toContain("skills/claude/kiwi-pm/skill.md");
    expect(files).toContain("skills/etc/kiwi-pm/SKILL.md");
    expect(files).toContain("skills/etc/kiwi-commit-auto-pr/SKILL.md");
    expect(files).toContain("skills/etc/kiwi-hot-fix/SKILL.md");
    expect(files).toContain("skills/etc/kiwi-review-fix-loop/SKILL.md");
  }, 120000);

  it("runs installed CLI init from an external cwd with full bundled rules", async () => {
    const externalCwd = await mkdtemp(path.join(tmpdir(), "speckiwi-package-cwd-"));
    const projectRoot = path.join(externalCwd, "project");
    await mkdir(path.join(projectRoot, ".git"), { recursive: true });
    try {
      const { stdout } = await execFileAsync("npm", ["pack", "--json", "--pack-destination", externalCwd], { cwd: process.cwd(), timeout: 120000, shell: true });
      const [packed] = JSON.parse(stdout) as Array<{ filename: string }>;
      const tarball = path.join(externalCwd, packed.filename);
      await execFileAsync("npm", ["install", "--ignore-scripts", "--no-audit", "--no-fund", "--prefer-offline", tarball], {
        cwd: externalCwd,
        timeout: 120000,
        shell: true
      });
      const installedCli = path.join(externalCwd, "node_modules", "speckiwi", "bin", "speckiwi");
      await execFileAsync(process.execPath, [installedCli, "--root", projectRoot, "init"], { cwd: externalCwd, timeout: 60000 });
      const skillDestination = path.join(projectRoot, "agent-skills");
      await execFileAsync(process.execPath, [installedCli, "--root", projectRoot, "skills", "install", "opencode", "kiwi-pm", "--dest", skillDestination, "--json"], {
        cwd: externalCwd,
        timeout: 60000
      });

      const rules = await readFile(path.join(projectRoot, "docs", "rule", "SRS-MD-Rules-v1.0.0.md"), "utf8");
      expect(rules).toContain("| Document ID | SRS-MD-RULES |");
      expect(await readFile(path.join(skillDestination, "kiwi-pm", "SKILL.md"), "utf8")).toContain("name: kiwi-pm");
      expect(await readFile(path.join(projectRoot, "AGENTS.md"), "utf8")).toContain("# SpecKiwi SRS 워크플로 v1.3");
      expect(await readFile(path.join(projectRoot, "AGENTS.md"), "utf8")).toContain("Agents MUST follow TDD for behavior changes");
      expect(await readFile(path.join(projectRoot, "CLAUDE.md"), "utf8")).toContain("# SpecKiwi SRS 워크플로 v1.3");
      expect(await readFile(path.join(projectRoot, "CLAUDE.md"), "utf8")).toContain("Agents MUST follow TDD for behavior changes");
    } finally {
      await rm(externalCwd, { recursive: true, force: true });
    }
  }, 120000);
});
