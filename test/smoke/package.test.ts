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
    type?: string;
    bin?: Record<string, string>;
    engines?: Record<string, string>;
    scripts?: Record<string, string>;
    keywords?: string[];
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
  });

  it("does not expose stale package export paths", async () => {
    const pkg = await readPackageJson();

    expect(Object.keys((pkg as { exports?: Record<string, unknown> }).exports ?? {})).not.toContain("./cli/json-renderer");
    expect(Object.keys((pkg as { exports?: Record<string, unknown> }).exports ?? {})).not.toContain("./mcp/structured-content");
  });

  it("packs the bundled rules document", async () => {
    const { stdout } = await execFileAsync("npm", ["pack", "--dry-run", "--json"], { cwd: process.cwd(), timeout: 120000 });
    const [packed] = JSON.parse(stdout) as Array<{ files?: Array<{ path: string }> }>;
    expect(packed?.files?.map((file) => file.path)).toContain("docs/rule/SRS-MD-Rules-v1.0.0.md");
  }, 120000);

  it("runs installed CLI init from an external cwd with full bundled rules", async () => {
    const externalCwd = await mkdtemp(path.join(tmpdir(), "speckiwi-package-cwd-"));
    const projectRoot = path.join(externalCwd, "project");
    await mkdir(path.join(projectRoot, ".git"), { recursive: true });
    try {
      const { stdout } = await execFileAsync("npm", ["pack", "--json", "--pack-destination", externalCwd], { cwd: process.cwd(), timeout: 120000 });
      const [packed] = JSON.parse(stdout) as Array<{ filename: string }>;
      const tarball = path.join(externalCwd, packed.filename);
      await execFileAsync("npm", ["install", "--ignore-scripts", "--no-audit", "--no-fund", "--prefer-offline", tarball], {
        cwd: externalCwd,
        timeout: 120000
      });
      const installedCli = path.join(externalCwd, "node_modules", "speckiwi", "bin", "speckiwi");
      await execFileAsync(process.execPath, [installedCli, "--root", projectRoot, "init"], { cwd: externalCwd, timeout: 60000 });

      const rules = await readFile(path.join(projectRoot, "docs", "rule", "SRS-MD-Rules-v1.0.0.md"), "utf8");
      expect(rules).toContain("| Document ID | SRS-MD-RULES |");
      expect(await readFile(path.join(projectRoot, "AGENTS.md"), "utf8")).toContain("# SpecKiwi SRS 워크플로 v1.3");
      expect(await readFile(path.join(projectRoot, "AGENTS.md"), "utf8")).toContain("Agents MUST follow TDD for behavior changes");
      expect(await readFile(path.join(projectRoot, "CLAUDE.md"), "utf8")).toContain("# SpecKiwi SRS 워크플로 v1.3");
      expect(await readFile(path.join(projectRoot, "CLAUDE.md"), "utf8")).toContain("Agents MUST follow TDD for behavior changes");
    } finally {
      await rm(externalCwd, { recursive: true, force: true });
    }
  }, 120000);
});
