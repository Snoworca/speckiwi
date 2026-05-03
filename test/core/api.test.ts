import { cp, mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createSpecKiwiCore } from "../../src/core/api.js";
import { cleanCache, rebuildCache } from "../../src/core/cache.js";
import { doctor } from "../../src/core/doctor.js";
import { exportMarkdown } from "../../src/core/export-markdown.js";
import { initWorkspace } from "../../src/core/init.js";

const root = resolve(import.meta.dirname, "../..");
const fixtureRoot = resolve(root, "test/fixtures/workspaces/valid-basic");
const tempRoots: string[] = [];

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("SpecKiwiCore public facade", () => {
  it("exposes the expanded public method surface and preserves direct module behavior", async () => {
    const workspace = await copyFixture("speckiwi-core-api-");
    const core = createSpecKiwiCore({ root: workspace });

    expect(
      Object.entries(core)
        .filter(([, value]) => typeof value === "function")
        .map(([key]) => key)
    ).toEqual([
      "init",
      "doctor",
      "cacheRebuild",
      "cacheClean",
      "exportMarkdown",
      "overview",
      "listDocuments",
      "readDocument",
      "search",
      "getRequirement",
      "listRequirements",
      "previewRequirementId",
      "traceRequirement",
      "graph",
      "impact",
      "validate",
      "proposeChange",
      "applyChange",
      "loadRequirementRegistry"
    ]);

    const facadeDoctor = await core.doctor();
    const directDoctor = await doctor({ root: workspace });
    expect(facadeDoctor.ok).toBe(true);
    expect(directDoctor.ok).toBe(true);
    if (facadeDoctor.ok && directDoctor.ok) {
      expect(facadeDoctor.checks.map((check) => check.id)).toEqual(directDoctor.checks.map((check) => check.id));
    }

    const facadeExport = await core.exportMarkdown({ outputRoot: "facade-out", documentId: "overview" });
    const directExport = await exportMarkdown({ root: workspace, outputRoot: "direct-out", documentId: "overview" });
    expect(facadeExport.ok).toBe(true);
    expect(directExport.ok).toBe(true);
    if (facadeExport.ok && directExport.ok) {
      expect(facadeExport.writtenFiles.map((file) => file.path)).toEqual(directExport.writtenFiles.map((file) => file.path));
    }
    await expect(readFile(resolve(workspace, "facade-out/index.md"), "utf8")).resolves.toContain("SpecKiwi");
  });

  it("binds root and cache mode for init and cache methods", async () => {
    const initRoot = await tempRoot("speckiwi-core-init-");
    const directInitRoot = await tempRoot("speckiwi-core-direct-init-");
    const initCore = createSpecKiwiCore({ root: initRoot });

    const facadeInit = await initCore.init({ projectName: "Facade Project" });
    const directInit = await initWorkspace({ root: directInitRoot, projectName: "Direct Project" });
    expect(facadeInit.ok).toBe(true);
    expect(directInit.ok).toBe(true);
    if (facadeInit.ok && directInit.ok) {
      expect(facadeInit.created).toEqual(directInit.created);
      expect(facadeInit.skipped).toEqual([]);
    }
    await expect(readFile(join(initRoot, ".speckiwi", "index.yaml"), "utf8")).resolves.toContain("Facade Project");

    const facadeWorkspace = await copyFixture("speckiwi-core-cache-");
    const directWorkspace = await copyFixture("speckiwi-core-direct-cache-");
    const cacheCore = createSpecKiwiCore({ root: facadeWorkspace });

    const facadeRebuild = await cacheCore.cacheRebuild();
    const directRebuild = await rebuildCache({ root: directWorkspace });
    expect(facadeRebuild.ok).toBe(true);
    expect(directRebuild.ok).toBe(true);
    if (facadeRebuild.ok && directRebuild.ok) {
      expect(facadeRebuild.operation).toBe("rebuild");
      expect(facadeRebuild.touchedFiles).toEqual(directRebuild.touchedFiles);
    }

    const facadeClean = await cacheCore.cacheClean();
    const directClean = await cleanCache({ root: directWorkspace });
    expect(facadeClean.ok).toBe(true);
    expect(directClean.ok).toBe(true);
    if (facadeClean.ok && directClean.ok) {
      expect(facadeClean.operation).toBe("clean");
      expect(facadeClean.touchedFiles).toEqual(directClean.touchedFiles);
    }
    await expect(stat(join(facadeWorkspace, ".speckiwi", "cache", "manifest.json"))).rejects.toThrow();
  });
});

async function copyFixture(prefix: string): Promise<string> {
  const workspace = await tempRoot(prefix);
  await cp(fixtureRoot, workspace, { recursive: true });
  return workspace;
}

async function tempRoot(prefix: string): Promise<string> {
  const workspace = await mkdtemp(join(tmpdir(), prefix));
  tempRoots.push(workspace);
  return workspace;
}
