import { mkdir, readFile, rm, stat, symlink, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdtemp } from "node:fs/promises";
import { afterEach, describe, expect, it } from "vitest";
import { manifestFromInputs } from "../../src/cache/manifest.js";
import { stableJson } from "../../src/cache/hash.js";
import { createSpecKiwiCore } from "../../src/core/api.js";
import { cleanCache, rebuildCache, buildCacheInputs, isCacheStale, isIndexSectionFresh, readCacheManifest } from "../../src/core/cache.js";
import { getReadModelMemoStats, loadReadModel, resetReadModelMemoStats } from "../../src/core/read-model.js";
import { getRequirement, listRequirements } from "../../src/core/requirements.js";
import { searchWorkspace } from "../../src/core/search.js";
import { buildGraph } from "../../src/graph/builder.js";
import { deserializeEntityIndex, deserializeRequirementPayloadShard, requirementPayloadShardStorePath } from "../../src/indexing/entities.js";
import { deserializeRelationIndex } from "../../src/indexing/relations.js";
import { statWorkspaceInputs } from "../../src/cache/fingerprint.js";
import { readArtifact, writeArtifact } from "../../src/indexing/serialization.js";
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
      ".speckiwi/cache/entities.json",
      ".speckiwi/cache/relations.json",
      ".speckiwi/cache/diagnostics.json",
      ".speckiwi/cache/manifest.json",
      expect.stringMatching(/^\.speckiwi\/cache\/requirements\/[a-f0-9]{64}\.json$/)
    ]);

    const manifestText = await readFile(join(root, ".speckiwi", "cache", "manifest.json"), "utf8");
    expect(manifestText).not.toMatch(new RegExp("createdAt|timestamp|/tmp|\\\\"));
    const manifest = await readCacheManifest(workspaceRootFromPath(root));
    const workspace = await loadWorkspaceForValidation(workspaceRootFromPath(root));
    expect(isCacheStale(manifest, await buildCacheInputs(workspaceRootFromPath(root), workspace))).toBe(false);
    expect(manifest).toMatchObject({ format: "speckiwi/cache-manifest/v2", cacheSchemaVersion: 2 });
    expect(manifest?.sections).toHaveProperty("facts");
    expect(manifest?.sections).toHaveProperty("entities");
    expect(manifest?.sections).toHaveProperty("relations");
    expect(manifest?.sections).toHaveProperty("search");
    expect(manifest?.sections).toHaveProperty("graph");
    expect(manifest?.sections).toHaveProperty("diagnostics");
  });

  it("collects stable yaml input stats and ignores cache, export, and symlink escapes", async () => {
    const root = await createCacheWorkspace();
    await mkdir(join(root, ".speckiwi", "nested", "deep"), { recursive: true });
    await mkdir(join(root, ".speckiwi", "exports"), { recursive: true });
    await writeFile(join(root, ".speckiwi", "nested", "deep", "notes.yaml"), "schemaVersion: speckiwi/overview/v1\n", "utf8");
    await writeFile(join(root, ".speckiwi", "cache", "ignored.yaml"), "schemaVersion: speckiwi/overview/v1\n", "utf8");
    await writeFile(join(root, ".speckiwi", "exports", "ignored.yaml"), "schemaVersion: speckiwi/overview/v1\n", "utf8");
    const externalRoot = await mkdtemp(join(tmpdir(), "speckiwi-cache-external-"));
    tempRoots.push(externalRoot);
    await writeFile(join(externalRoot, "escape.yaml"), "schemaVersion: speckiwi/overview/v1\n", "utf8");
    await symlink(join(externalRoot, "escape.yaml"), join(root, ".speckiwi", "nested", "escape.yaml"), "file");

    const stats = await statWorkspaceInputs(workspaceRootFromPath(root));

    expect(stats.map((entry) => entry.path)).toEqual([
      "dictionary.yaml",
      "index.yaml",
      "nested/deep/notes.yaml",
      "overview.yaml",
      "srs/cache.yaml"
    ]);
  });

  it("checks section freshness and versioned artifact IO through fixed cache paths", async () => {
    const root = await createCacheWorkspace();
    await rebuildCache({ root });
    const workspaceRoot = workspaceRootFromPath(root);

    expect(await isIndexSectionFresh(workspaceRoot, "search")).toBe(true);
    expect(await isIndexSectionFresh(workspaceRoot, "entities")).toBe(true);
    expect(await isIndexSectionFresh(workspaceRoot, "relations")).toBe(true);

    await writeFile(
      join(root, ".speckiwi", "index.yaml"),
      (await readFile(join(root, ".speckiwi", "index.yaml"), "utf8")).replace("defaultMode: auto", "defaultMode: exact"),
      "utf8"
    );
    expect(await isIndexSectionFresh(workspaceRoot, "search")).toBe(false);

    await writeArtifact(workspaceRoot, "cache/search-index.json", { sentinel: 1 });
    const artifact = await readArtifact(workspaceRoot, "cache/search-index.json", (value) =>
      typeof value === "object" && value !== null && (value as { sentinel?: unknown }).sentinel === 1 ? { sentinel: 1 } : undefined
    );
    expect(artifact).toEqual({ artifact: { sentinel: 1 } });

    await expect(readArtifact(workspaceRoot, "cache/not-allowed.json", () => ({ ok: true }))).rejects.toThrow(
      "Cache artifact path is not allowed"
    );
  });

  it("marks search cache stale when manifest output hashes mismatch", async () => {
    const root = await createCacheWorkspace();
    await rebuildCache({ root });
    const workspaceRoot = workspaceRootFromPath(root);
    const cachedDocument: SearchDocument = {
      entityType: "requirement",
      id: "FR-SPEKIW-HASH-0001",
      title: "Hash mismatch sentinel",
      documentId: "srs.cache",
      scope: "core.cache",
      path: ".speckiwi/srs/cache.yaml",
      fields: {
        id: "FR-SPEKIW-HASH-0001",
        title: "Hash mismatch sentinel",
        statement: "This cache-only hash mismatch sentinel must never be returned.",
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
      `${stableJson(serializeSearchIndex(buildSearchIndex([cachedDocument])))}\n`,
      "utf8"
    );

    expect(await isIndexSectionFresh(workspaceRoot, "search")).toBe(false);
    const result = await searchWorkspace({ root, query: "cache-only hash mismatch sentinel", mode: "bm25" });

    expect(result.ok).toBe(true);
    expect(result.ok && result.results.map((item) => item.id)).not.toContain("FR-SPEKIW-HASH-0001");
  });

  it("does not hash cache outputs through workspace-external symlinks", async () => {
    if (process.platform === "win32") {
      return;
    }

    const root = await createCacheWorkspace();
    await rebuildCache({ root });
    const externalRoot = await mkdtemp(join(tmpdir(), "speckiwi-cache-output-external-"));
    tempRoots.push(externalRoot);
    await writeFile(join(externalRoot, "search-index.json"), "{\"external\":true}\n", "utf8");
    await rm(join(root, ".speckiwi", "cache", "search-index.json"), { force: true });
    await symlink(join(externalRoot, "search-index.json"), join(root, ".speckiwi", "cache", "search-index.json"), "file");

    const workspaceRoot = workspaceRootFromPath(root);
    const workspace = await loadWorkspaceForValidation(workspaceRoot);
    const inputs = await buildCacheInputs(workspaceRoot, workspace);

    expect(inputs.sections.search.outputs).toEqual([]);
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
        ".speckiwi/cache/entities.json",
        ".speckiwi/cache/relations.json",
        ".speckiwi/cache/diagnostics.json",
        ".speckiwi/cache/manifest.json",
        expect.stringMatching(/^\.speckiwi\/cache\/requirements\/[a-f0-9]{64}\.json$/)
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

  it("filters cache-only search results even when the search cache and manifest look fresh", async () => {
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
    expect(result.ok && result.results.map((item) => item.id)).not.toContain("FR-SPEKIW-CACHED-0001");
    expect(result.diagnostics.warnings.map((warning) => warning.code)).toContain("SEARCH_CACHE_SOURCE_MISMATCH");
  });

  it("rehydrates source fields for fresh cached search results with tampered public fields", async () => {
    const root = await createCacheWorkspace();
    await rebuildCache({ root });
    const cachedDocument: SearchDocument = {
      entityType: "requirement",
      id: "FR-SPEKIW-CACHE-0001",
      title: "Tampered cached title",
      documentId: "srs.cache",
      scope: "tampered.scope",
      path: ".speckiwi/srs/cache.yaml",
      fields: {
        id: "FR-SPEKIW-CACHE-0001",
        title: "Tampered cached title",
        statement: "The system shall use YAML source data when cache data is stale.",
        tags: ["cache"]
      },
      filters: {
        entityType: "requirement",
        path: ".speckiwi/srs/cache.yaml",
        documentId: "srs.cache",
        scope: "tampered.scope",
        type: "reliability",
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

    const result = await searchWorkspace({ root, query: "FR-SPEKIW-CACHE-0001", mode: "exact" });

    expect(result.ok).toBe(true);
    expect(result).toMatchObject({
      ok: true,
      results: [
        {
          id: "FR-SPEKIW-CACHE-0001",
          title: "Cache fallback",
          scope: "core.cache",
          path: ".speckiwi/srs/cache.yaml"
        }
      ]
    });
  });

  it("recomputes cached search matched fields and page metadata from YAML source", async () => {
    const root = await createCacheWorkspace();
    await rebuildCache({ root });
    const cachedSourceDocument: SearchDocument = {
      entityType: "requirement",
      id: "FR-SPEKIW-CACHE-0001",
      title: "Cache fallback",
      documentId: "srs.cache",
      scope: "core.cache",
      path: ".speckiwi/srs/cache.yaml",
      fields: {
        id: "FR-SPEKIW-CACHE-0001",
        title: "Cache fallback",
        statement: "The system shall use YAML source data when cache data is stale.",
        rationale: "stale cache-only rationale should not survive source search.",
        body: "stale cache-only body should not survive source search.",
        tags: ["cache"]
      },
      filters: {
        entityType: "requirement",
        path: ".speckiwi/srs/cache.yaml",
        documentId: "srs.cache",
        scope: "core.cache",
        type: "reliability",
        status: "active",
        tags: ["cache"]
      }
    };
    const fakeSecondPageDocument: SearchDocument = {
      entityType: "requirement",
      id: "FR-SPEKIW-ZZZZ-0001",
      title: "Fake cached second-page result",
      documentId: "srs.cache",
      scope: "core.cache",
      path: ".speckiwi/srs/cache.yaml",
      fields: {
        id: "FR-SPEKIW-ZZZZ-0001",
        statement: "stale appears only in the serialized search cache for this fake result."
      },
      filters: {
        entityType: "requirement",
        path: ".speckiwi/srs/cache.yaml",
        documentId: "srs.cache",
        scope: "core.cache",
        type: "reliability",
        status: "active",
        tags: ["cache"]
      }
    };
    await writeFile(
      join(root, ".speckiwi", "cache", "search-index.json"),
      stableJson(serializeSearchIndex(buildSearchIndex([cachedSourceDocument, fakeSecondPageDocument]))),
      "utf8"
    );
    await writeFreshManifest(root);

    const result = await searchWorkspace({ root, query: "stale", mode: "bm25", limit: 1 });

    expect(result).toMatchObject({
      ok: true,
      results: [{ id: "FR-SPEKIW-CACHE-0001", matchedFields: ["statement"] }],
      page: { returned: 1, total: 1, hasMore: false, nextOffset: null }
    });
    expect(result.diagnostics.warnings.map((warning) => warning.code)).toContain("SEARCH_CACHE_SOURCE_MISMATCH");
  });

  it("keeps cached exact search source audit aligned with dictionary expansion", async () => {
    const root = await createCacheWorkspace();
    await writeFile(
      join(root, ".speckiwi", "dictionary.yaml"),
      `schemaVersion: speckiwi/dictionary/v1
id: dictionary
type: dictionary
title: Dictionary
status: active
synonyms:
  shortcut-cache-title:
    - Cache fallback
normalizations: {}
`,
      "utf8"
    );
    await rebuildCache({ root });

    const input = {
      root,
      query: "shortcut-cache-title",
      mode: "exact" as const,
      filters: { entityType: "requirement" as const }
    };
    const bypass = await searchWorkspace({ ...input, cacheMode: "bypass" });
    const cached = await searchWorkspace(input);

    expect(cached.ok).toBe(true);
    expect(cached.ok && cached.results.map((item) => item.id)).toEqual(["FR-SPEKIW-CACHE-0001"]);
    expect(cached.ok && cached.results).toEqual(bypass.ok && bypass.results);
    expect(cached.diagnostics.warnings.map((warning) => warning.code)).not.toContain("SEARCH_CACHE_SOURCE_MISMATCH");
  });

  it("does not reuse cached exact search after same-size preserved-mtime source edits", async () => {
    const root = await createCacheWorkspace();
    const sourcePath = join(root, ".speckiwi", "srs", "cache.yaml");
    await writeFile(
      sourcePath,
      (await readFile(sourcePath, "utf8")).replace(
        "    relations: []\n",
        `    relations: []
  - id: FR-SPEKIW-CACHE-0002
    type: reliability
    title: Other fallback
    status: active
    statement: The system shall keep exact search source freshness for new same-title requirements.
    rationale: Exact cached search must not hide source additions.
    acceptanceCriteria:
      - id: AC-001
        method: test
        description: Exact search returns both matching titles.
    tags: [cache]
    relations: []
`
      ),
      "utf8"
    );
    await rebuildCache({ root });
    const input = {
      root,
      query: "Cache fallback",
      mode: "exact" as const,
      filters: { entityType: "requirement" as const }
    };
    await searchWorkspace(input);

    const before = await stat(sourcePath);
    const raw = await readFile(sourcePath, "utf8");
    await writeFile(sourcePath, replaceSameLength(raw, "title: Other fallback", "title: Cache fallback"), "utf8");
    await utimes(sourcePath, before.atime, before.mtime);

    const cached = await searchWorkspace(input);
    const bypass = await searchWorkspace({ ...input, cacheMode: "bypass" });

    expect(cached.ok).toBe(true);
    expect(cached.ok && cached.results.map((item) => item.id)).toEqual(["FR-SPEKIW-CACHE-0001", "FR-SPEKIW-CACHE-0002"]);
    expect(normalizePayload(cached)).toEqual(normalizePayload(bypass));
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
    await expect(readFile(join(root, ".speckiwi", "cache", "search-index.json"), "utf8")).resolves.toContain('"refresh"');
    const workspaceRoot = workspaceRootFromPath(root);
    const manifest = await readCacheManifest(workspaceRoot);
    const workspace = await loadWorkspaceForValidation(workspaceRoot);
    expect(isCacheStale(manifest, await buildCacheInputs(workspaceRoot, workspace))).toBe(false);

    await rm(join(root, ".speckiwi", "cache"), { recursive: true, force: true });
    const bypassResult = await searchWorkspace({ root, query: "stale refresh token", mode: "bm25", cacheMode: "bypass" });
    expect(bypassResult.ok).toBe(true);
    await expect(stat(join(root, ".speckiwi", "cache"))).rejects.toThrow();
  });

  it("keeps cold and warm DTOs aligned for get, search, graph, and MCP search across fresh and stale paths", async () => {
    const root = await createParityWorkspace();
    const core = createSpecKiwiCore({ root });

    await expectColdWarmEqual("get requirement includeDocument+includeRelations", () =>
      getRequirement({ root, cacheMode: "bypass", id: "FR-SPEKIW-PARITY-0001", includeDocument: true, includeRelations: true }), async () => {
      await rebuildCache({ root });
      return getRequirement({ root, id: "FR-SPEKIW-PARITY-0001", includeDocument: true, includeRelations: true });
    });

    await expectColdWarmEqual("search filters", () =>
      searchWorkspace({
        root,
        cacheMode: "bypass",
        query: "deterministic cache",
        mode: "bm25",
        filters: {
          entityType: "requirement",
          documentId: "srs.parity",
          scope: "core.parity",
          type: "functional",
          status: "active",
          tag: "cache",
          path: ".speckiwi/srs/parity.yaml"
        }
      }), async () => {
      await rebuildCache({ root });
      return searchWorkspace({
        root,
        query: "deterministic cache",
        mode: "bm25",
        filters: {
          entityType: "requirement",
          documentId: "srs.parity",
          scope: "core.parity",
          type: "functional",
          status: "active",
          tag: "cache",
          path: ".speckiwi/srs/parity.yaml"
        }
      });
    });

    await expectColdWarmEqual("graph parity", async () => buildGraph(await loadWorkspaceForValidation(workspaceRootFromPath(root))), async () => {
      await rebuildCache({ root });
      return buildGraph(await loadWorkspaceForValidation(workspaceRootFromPath(root)));
    });

    await expectColdWarmEqual("mcp search parity", () =>
      core.search({
        cacheMode: "bypass",
        query: "deterministic cache",
        mode: "bm25",
        filters: { entityType: "requirement", scope: "core.parity", tag: "cache" }
      }), async () => {
      await rebuildCache({ root });
      return core.search({
        query: "deterministic cache",
        mode: "bm25",
        filters: { entityType: "requirement", scope: "core.parity", tag: "cache" }
      });
    });

    await rebuildCache({ root });
    await writeFile(
      join(root, ".speckiwi", "srs", "parity.yaml"),
      `schemaVersion: speckiwi/srs/v1
id: srs.parity
type: srs
scope: core.parity
title: Parity SRS
status: active
requirements:
  - id: FR-SPEKIW-PARITY-0001
    type: functional
    title: Deterministic cache parity
    status: active
    statement: The system shall keep deterministic cache parity after stale refresh.
    rationale: Read-model changes must preserve DTO shape.
    acceptanceCriteria:
      - id: AC-001
        method: test
        description: Search finds the updated requirement.
    tags: [cache, parity, refreshed]
    relations:
      - type: depends_on
        target: FR-SPEKIW-PARITY-0002
  - id: FR-SPEKIW-PARITY-0002
    type: reliability
    title: Warm path companion
    status: proposed
    statement: The system shall surface warm-path companion data for filter parity.
    rationale: Filter combinations need multiple statuses.
    acceptanceCriteria:
      - id: AC-001
        method: test
        description: List filters can isolate companion requirements.
    tags: [parity, companion]
    relations: []
`,
      "utf8"
    );

    await expectColdWarmEqual("stale cache search parity", () =>
      searchWorkspace({
        root,
        cacheMode: "bypass",
        query: "stale refresh",
        mode: "bm25",
        filters: { entityType: "requirement", scope: "core.parity", path: ".speckiwi/srs/parity.yaml" }
      }), () =>
      searchWorkspace({
        root,
        query: "stale refresh",
        mode: "bm25",
        filters: { entityType: "requirement", scope: "core.parity", path: ".speckiwi/srs/parity.yaml" }
      }));
  });

  it("keeps filter combinations stable across source and warm cache reads", async () => {
    const root = await createParityWorkspace();
    await rebuildCache({ root });

    await expectColdWarmEqual("list requirement filters", () =>
      listRequirements({
        root,
        cacheMode: "bypass",
        project: "SpecKiwi",
        scope: "core.parity",
        type: "functional",
        status: "active",
        tag: "cache",
        documentId: "srs.parity"
      }), () =>
      listRequirements({
        root,
        project: "SpecKiwi",
        scope: "core.parity",
        type: "functional",
        status: "active",
        tag: "cache",
        documentId: "srs.parity"
      }));

    await expectColdWarmEqual("search path+entity filters", () =>
      searchWorkspace({
        root,
        cacheMode: "bypass",
        query: "parity",
        mode: "bm25",
        filters: { entityType: "document", path: ".speckiwi/srs/parity.yaml", scope: "core.parity", status: "active" }
      }), () =>
      searchWorkspace({
        root,
        query: "parity",
        mode: "bm25",
        filters: { entityType: "document", path: ".speckiwi/srs/parity.yaml", scope: "core.parity", status: "active" }
      }));
  });

  it("keeps search data stable when warm cache degrades on corrupt artifacts", async () => {
    const root = await createParityWorkspace();
    await rebuildCache({ root });
    await writeFile(join(root, ".speckiwi", "cache", "search-index.json"), "{not-json", "utf8");
    await writeFreshManifest(root);

    const cold = await searchWorkspace({ root, cacheMode: "bypass", query: "deterministic cache", mode: "bm25", filters: { entityType: "requirement", tag: "cache" } });
    const warm = await searchWorkspace({ root, query: "deterministic cache", mode: "bm25", filters: { entityType: "requirement", tag: "cache" } });

    expect(normalizePayload(cold)).toEqual(normalizePayload(warm));
    expect(diagnosticCodes(warm)).toContain("SEARCH_CACHE_UNREADABLE");
  });

  it("loads an immutable source read model with stable stats and parity-ready outputs", async () => {
    const root = await createParityWorkspace();
    const sourceModel = await loadReadModel({ root, cacheMode: "bypass", sections: ["search", "graph"] });
    const warmModel = await loadReadModel({ root, sections: ["search", "graph"] });

    expect(sourceModel.sections).toEqual(["search", "graph"]);
    expect(sourceModel.stats).toMatchObject({
      mode: "source",
      cacheHit: false,
      artifactHitCount: 0
    });
    expect(sourceModel.stats.parsedFileCount).toBeGreaterThan(0);
    expect(warmModel.stats).toMatchObject(sourceModel.stats);
    expect(normalizePayload(sourceModel.buildGraph("traceability"))).toEqual(
      normalizePayload(buildGraph(await loadWorkspaceForValidation(workspaceRootFromPath(root))))
    );
  });

  it("regenerates stale entity, relation, and diagnostics sections before registry results", async () => {
    const root = await createCacheWorkspace();
    await rebuildCache({ root });
    const core = createSpecKiwiCore({ root });
    await writeFile(
      join(root, ".speckiwi", "srs", "cache.yaml"),
      (await readFile(join(root, ".speckiwi", "srs", "cache.yaml"), "utf8")).replace(
        "    relations: []\n",
        `    relations:
      - type: depends_on
        target: FR-SPEKIW-CACHE-0002
  - id: FR-SPEKIW-CACHE-0002
    type: reliability
    title: Regenerated entity
    status: active
    statement: The system shall regenerate stale entity and relation cache sections.
    rationale: Public registry results must not expose stale cache artifacts.
    acceptanceCriteria:
      - id: AC-001
        method: test
        description: Registry reads include regenerated cache content.
    tags: [cache]
    relations: []
`
      ),
      "utf8"
    );
    await writeFile(join(root, ".speckiwi", "broken.yaml"), "schemaVersion: [", "utf8");

    const registry = await core.loadRequirementRegistry();
    const workspaceRoot = workspaceRootFromPath(root);
    const entityArtifact = await readArtifact(workspaceRoot, "cache/entities.json", deserializeEntityIndex);
    const relationArtifact = await readArtifact(workspaceRoot, "cache/relations.json", deserializeRelationIndex);
    const diagnosticsCache = await readFile(join(root, ".speckiwi", "cache", "diagnostics.json"), "utf8");

    expect(registry.requirementsById.get("FR-SPEKIW-CACHE-0002")?.title).toBe("Regenerated entity");
    expect(registry.outgoingRelationsById.get("FR-SPEKIW-CACHE-0001")).toEqual([
      { type: "depends_on", target: "FR-SPEKIW-CACHE-0002", source: "FR-SPEKIW-CACHE-0001" }
    ]);
    expect(entityArtifact.artifact?.requirementsById.get("FR-SPEKIW-CACHE-0002")?.title).toBe("Regenerated entity");
    expect(relationArtifact.artifact?.outgoingById.get("FR-SPEKIW-CACHE-0001")).toEqual([
      { type: "depends_on", target: "FR-SPEKIW-CACHE-0002", source: "FR-SPEKIW-CACHE-0001" }
    ]);
    expect(diagnosticsCache).toContain("YAML_");
    expect(diagnosticsCache).toContain("broken.yaml");
  });

  it("falls back to YAML when a fresh entity shard contains source-inconsistent requirement data", async () => {
    const root = await createCacheWorkspace();
    await rebuildCache({ root });
    const workspaceRoot = workspaceRootFromPath(root);
    const entitiesArtifact = await readArtifact(workspaceRoot, "cache/entities.json", deserializeEntityIndex);
    const relationsArtifact = await readArtifact(workspaceRoot, "cache/relations.json", deserializeRelationIndex);

    expect(entitiesArtifact.artifact?.requirementsById.has("FR-SPEKIW-CACHE-0001")).toBe(true);
    expect(relationsArtifact.artifact?.outgoingById.get("FR-SPEKIW-CACHE-0001")).toEqual([]);
    const shardRef = entitiesArtifact.artifact?.requirementShardsById.get("FR-SPEKIW-CACHE-0001");
    expect(shardRef).toBeDefined();
    if (shardRef === undefined) {
      return;
    }

    const shardPath = requirementPayloadShardStorePath(shardRef.documentHash);
    const cachedShard = await readArtifact(workspaceRoot, shardPath, deserializeRequirementPayloadShard);
    expect(cachedShard.artifact?.documentPath).toBe("srs/cache.yaml");
    if (cachedShard.artifact === undefined) {
      return;
    }
    await writeArtifact(workspaceRoot, shardPath, {
      ...cachedShard.artifact,
      requirements: cachedShard.artifact.requirements.map((requirement) =>
        requirement.id === "FR-SPEKIW-CACHE-0001"
          ? {
              ...requirement,
              requirement: {
                ...requirement.requirement,
                statement: "Cache-only exact lookup sentinel."
              }
            }
          : requirement
      )
    });
    await writeFreshManifest(root);

    const result = await getRequirement({ root, id: "FR-SPEKIW-CACHE-0001", includeDocument: true, includeRelations: true });

    expect(result).toMatchObject({
      ok: true,
      requirement: { id: "FR-SPEKIW-CACHE-0001", statement: "The system shall use YAML source data when cache data is stale." },
      document: { id: "srs.cache" },
      relations: { incoming: [], outgoing: [] }
    });
    expect(result.diagnostics.warnings.map((warning) => warning.code)).toContain("ENTITY_CACHE_SOURCE_MISMATCH");
  });

  it("keeps core exact getRequirement facade on the entity cache fast path", async () => {
    const root = await createCacheWorkspace();
    await rebuildCache({ root });
    const core = createSpecKiwiCore({ root });

    resetReadModelMemoStats();
    const result = await core.getRequirement({ id: "FR-SPEKIW-CACHE-0001" });

    expect(result).toMatchObject({ ok: true, requirement: { id: "FR-SPEKIW-CACHE-0001" } });
    expect(getReadModelMemoStats()).toMatchObject({ misses: 0, hits: 0 });
  });

  it("falls back to YAML when a fresh entity shard tampers non-summary requirement payload", async () => {
    const root = await createCacheWorkspace();
    await rebuildCache({ root });
    const workspaceRoot = workspaceRootFromPath(root);
    const entitiesArtifact = await readArtifact(workspaceRoot, "cache/entities.json", deserializeEntityIndex);
    const shardRef = entitiesArtifact.artifact?.requirementShardsById.get("FR-SPEKIW-CACHE-0001");
    expect(shardRef).toBeDefined();
    if (shardRef === undefined) {
      return;
    }

    const shardPath = requirementPayloadShardStorePath(shardRef.documentHash);
    const cachedShard = await readArtifact(workspaceRoot, shardPath, deserializeRequirementPayloadShard);
    expect(cachedShard.artifact).toBeDefined();
    if (cachedShard.artifact === undefined) {
      return;
    }
    await writeArtifact(workspaceRoot, shardPath, {
      ...cachedShard.artifact,
      requirements: cachedShard.artifact.requirements.map((requirement) =>
        requirement.id === "FR-SPEKIW-CACHE-0001"
          ? {
              ...requirement,
              requirement: {
                ...requirement.requirement,
                metadata: { cacheOnly: true }
              }
            }
          : requirement
      )
    });
    await writeFreshManifest(root);

    const result = await getRequirement({ root, id: "FR-SPEKIW-CACHE-0001" });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.requirement).not.toHaveProperty("metadata");
    expect(result.diagnostics.warnings.map((warning) => warning.code)).toContain("ENTITY_CACHE_SOURCE_MISMATCH");
  });

  it("falls back to YAML when a fresh entity cache tampers included document metadata", async () => {
    const root = await createCacheWorkspace();
    await rebuildCache({ root });
    const workspaceRoot = workspaceRootFromPath(root);
    const entitiesArtifact = await readArtifact(workspaceRoot, "cache/entities.json", deserializeEntityIndex);
    expect(entitiesArtifact.artifact).toBeDefined();
    if (entitiesArtifact.artifact === undefined) {
      return;
    }

    await writeArtifact(workspaceRoot, "cache/entities.json", {
      ...entitiesArtifact.artifact,
      documents: entitiesArtifact.artifact.documents.map((document) =>
        document.id === "srs.cache"
          ? {
              ...document,
              title: "Tampered cached document title"
            }
          : document
      )
    });
    await writeFreshManifest(root);

    const result = await getRequirement({ root, id: "FR-SPEKIW-CACHE-0001", includeDocument: true });

    expect(result).toMatchObject({
      ok: true,
      document: { id: "srs.cache", title: "Cache SRS" }
    });
    expect(result.diagnostics.warnings.map((warning) => warning.code)).toContain("ENTITY_CACHE_SOURCE_MISMATCH");
  });

  it("falls back to YAML when an entity shard reference uses an invalid cache path", async () => {
    const root = await createCacheWorkspace();
    await rebuildCache({ root });
    const workspaceRoot = workspaceRootFromPath(root);
    const entitiesArtifact = await readArtifact(workspaceRoot, "cache/entities.json", deserializeEntityIndex);
    expect(entitiesArtifact.artifact).toBeDefined();
    if (entitiesArtifact.artifact === undefined) {
      return;
    }

    await writeArtifact(workspaceRoot, "cache/entities.json", {
      ...entitiesArtifact.artifact,
      requirements: entitiesArtifact.artifact.requirements.map((requirement) =>
        requirement.id === "FR-SPEKIW-CACHE-0001"
          ? {
              ...requirement,
              documentHash: "../outside"
            }
          : requirement
      ),
      requirementPayloadShards: entitiesArtifact.artifact.requirementPayloadShards.map((shard) =>
        shard.requirementIds.includes("FR-SPEKIW-CACHE-0001")
          ? {
              ...shard,
              documentHash: "../outside"
            }
          : shard
      )
    });

    const result = await getRequirement({ root, id: "FR-SPEKIW-CACHE-0001" });

    expect(result).toMatchObject({
      ok: true,
      requirement: { id: "FR-SPEKIW-CACHE-0001", statement: "The system shall use YAML source data when cache data is stale." }
    });
    expect(result.diagnostics.warnings.map((warning) => warning.code)).toContain("REQUIREMENT_SHARD_UNREADABLE");
  });

  it("falls back to YAML exact lookup when a requirement shard is corrupt", async () => {
    const root = await createCacheWorkspace();
    await rebuildCache({ root });
    const workspaceRoot = workspaceRootFromPath(root);
    const entitiesArtifact = await readArtifact(workspaceRoot, "cache/entities.json", deserializeEntityIndex);
    const shardRef = entitiesArtifact.artifact?.requirementShardsById.get("FR-SPEKIW-CACHE-0001");
    expect(shardRef).toBeDefined();
    if (shardRef === undefined) {
      return;
    }

    await writeFile(join(root, ".speckiwi", requirementPayloadShardStorePath(shardRef.documentHash)), "{not-json", "utf8");
    await writeFreshManifest(root);

    const cold = await getRequirement({ root, cacheMode: "bypass", id: "FR-SPEKIW-CACHE-0001", includeDocument: true, includeRelations: true });
    const warm = await getRequirement({ root, id: "FR-SPEKIW-CACHE-0001", includeDocument: true, includeRelations: true });

    expect(normalizePayload(warm)).toEqual(normalizePayload(cold));
    expect(warm.diagnostics.warnings.map((warning) => warning.code)).toContain("REQUIREMENT_SHARD_UNREADABLE");
  });

  it("falls back to YAML exact lookup when cache output hashes mismatch", async () => {
    const root = await createCacheWorkspace();
    await rebuildCache({ root });
    const workspaceRoot = workspaceRootFromPath(root);
    const entitiesArtifact = await readArtifact(workspaceRoot, "cache/entities.json", deserializeEntityIndex);
    const shardRef = entitiesArtifact.artifact?.requirementShardsById.get("FR-SPEKIW-CACHE-0001");
    expect(shardRef).toBeDefined();
    if (shardRef === undefined) {
      return;
    }

    const shardPath = requirementPayloadShardStorePath(shardRef.documentHash);
    const cachedShard = await readArtifact(workspaceRoot, shardPath, deserializeRequirementPayloadShard);
    expect(cachedShard.artifact).toBeDefined();
    if (cachedShard.artifact === undefined) {
      return;
    }
    await writeArtifact(workspaceRoot, shardPath, {
      ...cachedShard.artifact,
      requirements: cachedShard.artifact.requirements.map((requirement) =>
        requirement.id === "FR-SPEKIW-CACHE-0001"
          ? {
              ...requirement,
              requirement: {
                ...requirement.requirement,
                statement: "Cache-only stale shard statement."
              }
            }
          : requirement
      )
    });

    const result = await getRequirement({ root, id: "FR-SPEKIW-CACHE-0001", includeDocument: true, includeRelations: true });

    expect(result).toMatchObject({
      ok: true,
      requirement: { id: "FR-SPEKIW-CACHE-0001", statement: "The system shall use YAML source data when cache data is stale." },
      document: { id: "srs.cache" },
      relations: { incoming: [], outgoing: [] }
    });
  });

  it("falls back to YAML relation data when relation output hashes mismatch", async () => {
    const root = await createCacheWorkspace();
    await rebuildCache({ root });
    const workspaceRoot = workspaceRootFromPath(root);
    await writeArtifact(workspaceRoot, "cache/relations.json", {
      format: "speckiwi/relations/v1",
      incoming: [],
      outgoing: [
        [
          "FR-SPEKIW-CACHE-0001",
          [
            {
              type: "depends_on",
              target: "FR-SPEKIW-BOGUS-0001"
            }
          ]
        ]
      ]
    });

    const result = await getRequirement({ root, id: "FR-SPEKIW-CACHE-0001", includeRelations: true });

    expect(result).toMatchObject({
      ok: true,
      relations: { incoming: [], outgoing: [] }
    });
  });

  it("falls back to YAML exact lookup when source hashes mismatch despite preserved stats", async () => {
    const root = await createCacheWorkspace();
    await rebuildCache({ root });
    await getRequirement({ root, id: "FR-SPEKIW-CACHE-0001" });
    const sourcePath = join(root, ".speckiwi", "srs", "cache.yaml");
    const before = await stat(sourcePath);
    const raw = await readFile(sourcePath, "utf8");
    await writeFile(sourcePath, replaceSameLength(raw, "YAML source data", "YAML origin data"), "utf8");
    await utimes(sourcePath, before.atime, before.mtime);

    const result = await getRequirement({ root, id: "FR-SPEKIW-CACHE-0001" });

    expect(result).toMatchObject({
      ok: true,
      requirement: { id: "FR-SPEKIW-CACHE-0001", statement: "The system shall use YAML origin data when cache data is stale." }
    });
  });

  it("does not reuse exact requirement shard memo after hash-verified artifact changes", async () => {
    const root = await createCacheWorkspace();
    await rebuildCache({ root });
    const workspaceRoot = workspaceRootFromPath(root);
    await getRequirement({ root, id: "FR-SPEKIW-CACHE-0001" });
    const entitiesArtifact = await readArtifact(workspaceRoot, "cache/entities.json", deserializeEntityIndex);
    const shardRef = entitiesArtifact.artifact?.requirementShardsById.get("FR-SPEKIW-CACHE-0001");
    expect(shardRef).toBeDefined();
    if (shardRef === undefined) {
      return;
    }

    const shardPath = requirementPayloadShardStorePath(shardRef.documentHash);
    const shardAbsolutePath = join(root, ".speckiwi", shardPath);
    const cachedShard = await readArtifact(workspaceRoot, shardPath, deserializeRequirementPayloadShard);
    expect(cachedShard.artifact).toBeDefined();
    if (cachedShard.artifact === undefined) {
      return;
    }
    const before = await stat(shardAbsolutePath);
    await writeArtifact(workspaceRoot, shardPath, {
      ...cachedShard.artifact,
      requirements: cachedShard.artifact.requirements.map((requirement) =>
        requirement.id === "FR-SPEKIW-CACHE-0001"
          ? {
              ...requirement,
              requirement: {
                ...requirement.requirement,
                statement: replaceSameLength(
                  String(requirement.requirement.statement),
                  "YAML source data",
                  "YAML origin data"
                )
              }
            }
          : requirement
      )
    });
    await utimes(shardAbsolutePath, before.atime, before.mtime);
    await writeFreshManifest(root);

    const result = await getRequirement({ root, id: "FR-SPEKIW-CACHE-0001" });

    expect(result).toMatchObject({
      ok: true,
      requirement: { id: "FR-SPEKIW-CACHE-0001", statement: "The system shall use YAML source data when cache data is stale." }
    });
    expect(result.diagnostics.warnings.map((warning) => warning.code)).toContain("ENTITY_CACHE_SOURCE_MISMATCH");
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

async function createParityWorkspace(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "speckiwi-parity-"));
  tempRoots.push(root);
  await mkdir(join(root, ".speckiwi", "srs"), { recursive: true });
  await mkdir(join(root, ".speckiwi", "cache"), { recursive: true });

  await writeFile(
    join(root, ".speckiwi", "index.yaml"),
    `schemaVersion: speckiwi/index/v1
project:
  id: speckiwi
  name: SpecKiwi
settings:
  search:
    defaultMode: auto
documents:
  - id: overview
    type: overview
    path: overview.yaml
    tags: [parity]
  - id: dictionary
    type: dictionary
    path: dictionary.yaml
  - id: srs.parity
    type: srs
    path: srs/parity.yaml
    scope: core.parity
    tags: [parity, cache]
scopes:
  - id: core.parity
    name: Cache Parity
    type: module
links:
  - from: overview
    to: srs.parity
    type: documents
`,
    "utf8"
  );
  await writeFile(
    join(root, ".speckiwi", "overview.yaml"),
    `schemaVersion: speckiwi/overview/v1
id: overview
type: overview
title: Parity Overview
status: active
summary: Cache parity fixture.
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
synonyms:
  parity:
    - deterministic
normalizations: {}
`,
    "utf8"
  );
  await writeFile(
    join(root, ".speckiwi", "srs", "parity.yaml"),
    `schemaVersion: speckiwi/srs/v1
id: srs.parity
type: srs
scope: core.parity
title: Parity SRS
status: active
requirements:
  - id: FR-SPEKIW-PARITY-0001
    type: functional
    title: Deterministic cache parity
    status: active
    statement: The system shall keep deterministic cache parity across source and warm cache paths.
    rationale: Read-model changes must preserve DTO shape.
    acceptanceCriteria:
      - id: AC-001
        method: test
        description: Search finds deterministic cache parity.
    tags: [cache, parity]
    relations:
      - type: depends_on
        target: FR-SPEKIW-PARITY-0002
  - id: FR-SPEKIW-PARITY-0002
    type: reliability
    title: Warm path companion
    status: proposed
    statement: The system shall surface warm-path companion data for filter parity.
    rationale: Filter combinations need multiple statuses.
    acceptanceCriteria:
      - id: AC-001
        method: test
        description: List filters can isolate companion requirements.
    tags: [parity, companion]
    relations: []
`,
    "utf8"
  );

  return root;
}

async function expectColdWarmEqual<T>(label: string, cold: () => Promise<T>, warm: () => Promise<T>): Promise<void> {
  const coldResult = await cold();
  const warmResult = await warm();
  expect(normalizePayload(warmResult), `${label} payload`).toEqual(normalizePayload(coldResult));
  expect(diagnosticCodes(warmResult), `${label} diagnostics`).toEqual(diagnosticCodes(coldResult));
}

function normalizePayload<T>(value: T): unknown {
  if (value === null || typeof value !== "object") {
    return value;
  }
  const clone = JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
  delete clone.diagnostics;
  return clone;
}

function diagnosticCodes(value: unknown): string[] {
  if (value === null || typeof value !== "object") {
    return [];
  }
  const diagnostics = (value as { diagnostics?: { errors?: { code?: string }[]; warnings?: { code?: string }[]; infos?: { code?: string }[] } }).diagnostics;
  const codes = [
    ...(diagnostics?.errors ?? []).map((entry) => entry.code).filter((entry): entry is string => typeof entry === "string"),
    ...(diagnostics?.warnings ?? []).map((entry) => entry.code).filter((entry): entry is string => typeof entry === "string"),
    ...(diagnostics?.infos ?? []).map((entry) => entry.code).filter((entry): entry is string => typeof entry === "string")
  ];
  return codes.sort();
}

function replaceSameLength(value: string, search: string, replacement: string): string {
  expect(replacement).toHaveLength(search.length);
  expect(value).toContain(search);
  return value.replace(search, replacement);
}
