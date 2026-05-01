import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdtemp } from "node:fs/promises";
import { afterEach, describe, expect, it } from "vitest";
import { manifestFromInputs } from "../../src/cache/manifest.js";
import { stableJson } from "../../src/cache/hash.js";
import { cleanCache, rebuildCache, buildCacheInputs, isCacheStale, readCacheManifest } from "../../src/core/cache.js";
import { searchWorkspace } from "../../src/core/search.js";
import { workspaceRootFromPath } from "../../src/io/workspace.js";
import { buildSearchIndex, serializeSearchIndex, type SearchDocument } from "../../src/search/index.js";
import { loadWorkspaceForValidation } from "../../src/validate/semantic.js";

const tempRoots: string[] = [];

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("cache manifest, rebuild, clean, and fallback", () => {
  it("rebuilds graph, search, diagnostics, and manifest caches without timestamps", async () => {
    const root = await createCacheWorkspace();
    const result = await rebuildCache({ root });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.touchedFiles).toEqual([
      ".speckiwi/cache/graph.json",
      ".speckiwi/cache/search-index.json",
      ".speckiwi/cache/diagnostics.json",
      ".speckiwi/cache/manifest.json"
    ]);

    const manifestText = await readFile(join(root, ".speckiwi", "cache", "manifest.json"), "utf8");
    expect(manifestText).not.toMatch(new RegExp("createdAt|timestamp|/tmp|\\\\"));
    const manifest = await readCacheManifest(workspaceRootFromPath(root));
    const workspace = await loadWorkspaceForValidation(workspaceRootFromPath(root));
    expect(isCacheStale(manifest, await buildCacheInputs(workspaceRootFromPath(root), workspace))).toBe(false);
    expect(manifest?.sections).toHaveProperty("graph");
    expect(manifest?.sections).toHaveProperty("search");
    expect(manifest?.sections).toHaveProperty("diagnostics");
    expect(manifest?.sections).toHaveProperty("export");
  });

  it("detects stale input hashes and bypasses cache writes in no-cache mode", async () => {
    const root = await createCacheWorkspace();
    await rebuildCache({ root });
    await writeFile(
      join(root, ".speckiwi", "dictionary.yaml"),
      `schemaVersion: speckiwi/dictionary/v1
id: dictionary
type: dictionary
title: Dictionary
status: active
synonyms:
  cache:
    - 캐시
normalizations: {}
`,
      "utf8"
    );

    const workspaceRoot = workspaceRootFromPath(root);
    const manifest = await readCacheManifest(workspaceRoot);
    const workspace = await loadWorkspaceForValidation(workspaceRoot);
    expect(isCacheStale(manifest, await buildCacheInputs(workspaceRoot, workspace))).toBe(true);

    await rm(join(root, ".speckiwi", "cache"), { recursive: true, force: true });
    const bypass = await rebuildCache({ root, cacheMode: "bypass" });
    expect(bypass.ok).toBe(true);
    await expect(stat(join(root, ".speckiwi", "cache", "manifest.json"))).rejects.toThrow();
  });

  it("cleans only regenerated cache files and preserves other cache content", async () => {
    const root = await createCacheWorkspace();
    await rebuildCache({ root });
    await mkdir(join(root, ".speckiwi", "cache", "backups"), { recursive: true });
    await writeFile(join(root, ".speckiwi", "cache", "custom.txt"), "keep", "utf8");
    await writeFile(join(root, ".speckiwi", "cache", "backups", "keep.json"), "keep", "utf8");

    const clean = await cleanCache({ root });

    expect(clean.ok).toBe(true);
    if (clean.ok) {
      expect(clean.touchedFiles).toEqual([
        ".speckiwi/cache/graph.json",
        ".speckiwi/cache/search-index.json",
        ".speckiwi/cache/diagnostics.json",
        ".speckiwi/cache/manifest.json"
      ]);
    }
    await expect(readFile(join(root, ".speckiwi", "cache", "custom.txt"), "utf8")).resolves.toBe("keep");
    await expect(readFile(join(root, ".speckiwi", "cache", "backups", "keep.json"), "utf8")).resolves.toBe("keep");
    await expect(stat(join(root, ".speckiwi", "cache", "search-index.json"))).rejects.toThrow();
  });

  it("degrades to YAML search when cache files are corrupt or stale", async () => {
    const root = await createCacheWorkspace();
    await rebuildCache({ root });
    await writeFile(join(root, ".speckiwi", "cache", "search-index.json"), "{not-json", "utf8");
    await writeFreshManifest(root);

    const result = await searchWorkspace({ root, query: "cache fallback", mode: "bm25" });

    expect(result.ok).toBe(true);
    expect(result.ok && result.results.some((item) => item.id === "FR-SPEKIW-CACHE-0001")).toBe(true);
    expect(result.diagnostics.warnings.map((warning) => warning.code)).toContain("SEARCH_CACHE_UNREADABLE");
  });

  it("uses a valid fresh search cache before rebuilding from YAML source", async () => {
    const root = await createCacheWorkspace();
    await rebuildCache({ root });
    const cachedDocument: SearchDocument = {
      entityType: "requirement",
      id: "FR-SPEKIW-CACHED-0001",
      title: "Cached only requirement",
      documentId: "srs.cache",
      scope: "core.cache",
      path: ".speckiwi/srs/cache.yaml",
      fields: {
        id: "FR-SPEKIW-CACHED-0001",
        title: "Cached only requirement",
        statement: "This cache-only sentinel appears only inside the serialized search cache.",
        tags: ["cache"]
      },
      filters: {
        entityType: "requirement",
        path: ".speckiwi/srs/cache.yaml",
        documentId: "srs.cache",
        scope: "core.cache",
        type: "functional",
        status: "active",
        tags: ["cache"]
      }
    };
    await writeFile(
      join(root, ".speckiwi", "cache", "search-index.json"),
      stableJson(serializeSearchIndex(buildSearchIndex([cachedDocument]))),
      "utf8"
    );
    await writeFreshManifest(root);

    const result = await searchWorkspace({ root, query: "cache-only sentinel", mode: "bm25" });

    expect(result.ok).toBe(true);
    expect(result.ok && result.results.map((item) => item.id)).toContain("FR-SPEKIW-CACHED-0001");
    expect(result.ok && result.results.map((item) => item.id)).not.toContain("FR-SPEKIW-CACHE-0001");
  });

  it("rebuilds stale search cache but does not touch cache files in bypass mode", async () => {
    const root = await createCacheWorkspace();
    await rebuildCache({ root });
    await writeFile(
      join(root, ".speckiwi", "srs", "cache.yaml"),
      `schemaVersion: speckiwi/srs/v1
id: srs.cache
type: srs
scope: core.cache
title: Cache SRS
status: active
requirements:
  - id: FR-SPEKIW-CACHE-0001
    type: reliability
    title: Cache fallback
    status: active
    statement: The system shall expose a stale refresh token from YAML source data.
    rationale: Cache data is generated and cannot be source truth.
    acceptanceCriteria:
      - id: AC-001
        method: test
        description: Cache fallback returns requirement search results.
    tags: [cache]
    relations: []
`,
      "utf8"
    );

    const staleResult = await searchWorkspace({ root, query: "stale refresh token", mode: "bm25" });
    expect(staleResult.ok).toBe(true);
    expect(staleResult.ok && staleResult.results.some((item) => item.id === "FR-SPEKIW-CACHE-0001")).toBe(true);
    const workspaceRoot = workspaceRootFromPath(root);
    const manifest = await readCacheManifest(workspaceRoot);
    const workspace = await loadWorkspaceForValidation(workspaceRoot);
    expect(isCacheStale(manifest, await buildCacheInputs(workspaceRoot, workspace))).toBe(false);

    await rm(join(root, ".speckiwi", "cache"), { recursive: true, force: true });
    const bypassResult = await searchWorkspace({ root, query: "stale refresh token", mode: "bm25", cacheMode: "bypass" });
    expect(bypassResult.ok).toBe(true);
    await expect(stat(join(root, ".speckiwi", "cache"))).rejects.toThrow();
  });
});

async function writeFreshManifest(root: string): Promise<void> {
  const workspaceRoot = workspaceRootFromPath(root);
  const workspace = await loadWorkspaceForValidation(workspaceRoot);
  await writeFile(join(root, ".speckiwi", "cache", "manifest.json"), `${stableJson(manifestFromInputs(await buildCacheInputs(workspaceRoot, workspace)))}\n`, "utf8");
}

async function createCacheWorkspace(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "speckiwi-cache-"));
  tempRoots.push(root);
  await mkdir(join(root, ".speckiwi", "srs"), { recursive: true });
  await mkdir(join(root, ".speckiwi", "cache"), { recursive: true });

  await writeFile(
    join(root, ".speckiwi", "index.yaml"),
    `schemaVersion: speckiwi/index/v1
project:
  id: spec-kiwi
  name: SpecKiwi
settings:
  search:
    defaultMode: auto
documents:
  - id: overview
    type: overview
    path: overview.yaml
  - id: dictionary
    type: dictionary
    path: dictionary.yaml
  - id: srs.cache
    type: srs
    path: srs/cache.yaml
    scope: core.cache
scopes:
  - id: core.cache
    name: Cache Core
    type: module
links: []
`,
    "utf8"
  );
  await writeFile(
    join(root, ".speckiwi", "overview.yaml"),
    `schemaVersion: speckiwi/overview/v1
id: overview
type: overview
title: Overview
status: active
summary: Cache fixture.
`,
    "utf8"
  );
  await writeFile(
    join(root, ".speckiwi", "dictionary.yaml"),
    `schemaVersion: speckiwi/dictionary/v1
id: dictionary
type: dictionary
title: Dictionary
status: active
synonyms: {}
normalizations: {}
`,
    "utf8"
  );
  await writeFile(
    join(root, ".speckiwi", "srs", "cache.yaml"),
    `schemaVersion: speckiwi/srs/v1
id: srs.cache
type: srs
scope: core.cache
title: Cache SRS
status: active
requirements:
  - id: FR-SPEKIW-CACHE-0001
    type: reliability
    title: Cache fallback
    status: active
    statement: The system shall use YAML source data when cache data is stale.
    rationale: Cache data is generated and cannot be source truth.
    acceptanceCriteria:
      - id: AC-001
        method: test
        description: Cache fallback returns requirement search results.
    tags: [cache]
    relations: []
`,
    "utf8"
  );

  return root;
}
