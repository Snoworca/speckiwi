import { readdir, stat } from "node:fs/promises";
import { resolve } from "node:path";
import type { Diagnostic, PerfCounters } from "./dto.js";
import { createDiagnosticBag } from "./result.js";
import { buildRequirementRegistry, type RequirementRegistry } from "./requirements.js";
import { workspaceRootFromPath } from "../io/workspace.js";
import type { GraphType } from "../graph/builder.js";
import { buildGraphFromRegistry, deserializeGraphResult, filterGraphResult } from "../graph/builder.js";
import type { WorkspaceRoot } from "../io/path.js";
import { createRealPathGuard, normalizeStorePath, resolveRealStorePathWithGuard } from "../io/path.js";
import type { LoadedWorkspace } from "../validate/semantic.js";
import { loadWorkspaceForValidation, validateRegistry } from "../validate/semantic.js";
import type { CacheMode } from "./inputs.js";
import type { IndexSectionName } from "../cache/index-manifest.js";
import { hashJson, sha256File, stableJson } from "../cache/hash.js";
import { cacheOutputStorePaths, isIndexSectionArtifactFresh, isIndexSectionFresh } from "../cache/manifest.js";
import { readArtifact } from "../indexing/serialization.js";
import { mergeDiagnosticBags } from "../validate/diagnostics.js";
import { fingerprintWorkspace, statWorkspaceInputs } from "../cache/fingerprint.js";
import {
  buildDictionaryExpansion,
  buildSearchIndex,
  deserializeSearchIndex,
  flattenWorkspace,
  type DictionaryExpansion,
  type SearchIndex
} from "../search/index.js";

export type ReadModelLoadStats = PerfCounters & {
  mode: "cache" | "source";
};

type CachedSearchIndex = SearchIndex & {
  dictionary?: DictionaryExpansion;
};

export type ReadModel = {
  readonly root: WorkspaceRoot;
  readonly sections: readonly IndexSectionName[];
  readonly stats: ReadModelLoadStats;
  readonly diagnostics: readonly Diagnostic[];
  getWorkspace(): LoadedWorkspace;
  getRequirementRegistry(): RequirementRegistry;
  getSearchIndex(): CachedSearchIndex;
  buildGraph(graphType?: GraphType): ReturnType<typeof buildGraphFromRegistry>;
};

export type ReadModelCacheKey = {
  root: string;
  cacheMode: CacheMode;
  sourceIntegrityHash: string;
  manifestHash: string;
  artifactIntegrityHash: string;
  sections: string[];
};

type ReadModelMemoStats = {
  hits: number;
  misses: number;
  size: number;
};

const READ_MODEL_MEMO_LIMIT = 8;

function createEmptyMemoStats(): ReadModelMemoStats {
  return { hits: 0, misses: 0, size: 0 };
}

const readModelMemoState: { stats: ReadModelMemoStats } = {
  stats: createEmptyMemoStats()
};

const readModelMemo = createReadModelMemo();

export async function loadReadModel(input: {
  root: string;
  cacheMode?: CacheMode;
  sections: IndexSectionName[];
}): Promise<ReadModel> {
  const root = workspaceRootFromPath(resolve(input.root));
  const sections = Object.freeze([...new Set(input.sections)]);
  const cacheMode = input.cacheMode ?? "auto";

  if (cacheMode === "bypass") {
    return loadSourceReadModel(root, sections, []);
  }

  await regenerateStaleReadableCacheSections(root, cacheMode, sections);

  const key = await buildReadModelCacheKey(root, cacheMode, sections);
  return readModelMemo.get(key, async () => buildReadModel(root, sections));
}

export function clearReadModelMemo(root?: string): void {
  readModelMemo.clear(root === undefined ? undefined : resolve(root));
}

export function getReadModelMemoStats(): ReadModelMemoStats {
  return { ...readModelMemoState.stats };
}

export function resetReadModelMemoStats(): void {
  readModelMemoState.stats = createEmptyMemoStats();
}

export function createReadModelMemo(): {
  get(key: ReadModelCacheKey, load: () => Promise<ReadModel>): Promise<ReadModel>;
  clear(root?: string): void;
} {
  const entries = new Map<string, { root: string; model: Promise<ReadModel> }>();

  return {
    async get(key, load) {
      const serialized = stableJson({
        ...key,
        sections: [...key.sections].sort()
      });
      const cached = entries.get(serialized);
      if (cached !== undefined) {
        entries.delete(serialized);
        entries.set(serialized, cached);
        readModelMemoState.stats.hits += 1;
        readModelMemoState.stats.size = entries.size;
        return cached.model;
      }

      readModelMemoState.stats.misses += 1;
      const model = load().catch((error) => {
        entries.delete(serialized);
        readModelMemoState.stats.size = entries.size;
        throw error;
      });
      entries.set(serialized, { root: key.root, model });
      while (entries.size > READ_MODEL_MEMO_LIMIT) {
        const oldest = entries.keys().next().value;
        if (typeof oldest !== "string") {
          break;
        }
        entries.delete(oldest);
      }
      readModelMemoState.stats.size = entries.size;
      return model;
    },
    clear(root) {
      if (root === undefined) {
        entries.clear();
      } else {
        for (const [key, entry] of entries) {
          if (entry.root === root) {
            entries.delete(key);
          }
        }
      }
      readModelMemoState.stats.size = entries.size;
    }
  };
}

async function buildReadModel(root: WorkspaceRoot, sections: readonly IndexSectionName[]): Promise<ReadModel> {
  if (sections.every((section) => section === "search") && (await isIndexSectionFresh(root, "search"))) {
    const cached = await readArtifact(root, cacheOutputStorePaths.search, deserializeSearchIndex);
    if (cached.artifact !== undefined) {
      return createReadModel(root, sections, {
        stats: {
          mode: "cache",
          cacheHit: true,
          parsedFileCount: 0,
          artifactHitCount: 1
        },
        diagnostics: [],
        searchIndex: cached.artifact
      });
    }

    if (cached.warning !== undefined) {
      return loadSourceReadModel(root, sections, [
        {
          ...cached.warning,
          code: "SEARCH_CACHE_UNREADABLE",
          message: "Search cache could not be read; search used YAML source data."
        }
      ]);
    }
  }

  if (sections.every((section) => section === "graph") && (await isIndexSectionFresh(root, "graph"))) {
    const cached = await readArtifact(root, cacheOutputStorePaths.graph, deserializeGraphResult);
    if (cached.artifact !== undefined) {
      return createReadModel(root, sections, {
        stats: {
          mode: "cache",
          cacheHit: true,
          parsedFileCount: 0,
          artifactHitCount: 1
        },
        diagnostics: [...cached.artifact.diagnostics.errors, ...cached.artifact.diagnostics.warnings, ...cached.artifact.diagnostics.infos],
        graphResult: cached.artifact
      });
    }

    if (cached.warning !== undefined) {
      return loadSourceReadModel(root, sections, [
        {
          ...cached.warning,
          code: "GRAPH_CACHE_UNREADABLE",
          message: "Graph cache could not be read; graph used YAML source data."
        }
      ]);
    }
  }

  return loadSourceReadModel(root, sections, []);
}

async function regenerateStaleReadableCacheSections(
  root: WorkspaceRoot,
  cacheMode: CacheMode,
  sections: readonly IndexSectionName[]
): Promise<void> {
  const uniqueSections = [...new Set(sections)];
  const staleReadableSections = await Promise.all(
    uniqueSections.map(async (section) => {
      const sectionFresh = await isIndexSectionFresh(root, section).catch(() => false);
      if (sectionFresh) {
        return false;
      }
      return isIndexSectionArtifactFresh(root, section).catch(() => false);
    })
  );

  if (!staleReadableSections.some(Boolean)) {
    return;
  }

  const { rebuildCache } = await import("./cache.js");
  const result = await rebuildCache({ root: root.rootPath, cacheMode });
  if (!result.ok) {
    return;
  }
}

async function loadSourceReadModel(
  root: WorkspaceRoot,
  sections: readonly IndexSectionName[],
  diagnostics: Diagnostic[]
): Promise<ReadModel> {
  const workspace = await loadWorkspaceForValidation(root);
  const needsRegistry = sections.some((section) => section === "entities" || section === "relations" || section === "graph");
  const registry = needsRegistry ? buildRequirementRegistry(workspace) : undefined;
  const searchIndex = sections.includes("search") ? buildSearchIndex(flattenWorkspace(workspace), buildDictionaryExpansion(workspace)) : undefined;
  const fallbackReason = diagnostics[0]?.code;
  const stats: ReadModelLoadStats = {
    mode: "source",
    cacheHit: false,
    parsedFileCount: workspace.documents.length,
    artifactHitCount: 0,
    ...(fallbackReason === undefined ? {} : { fallbackReason })
  };

  return createReadModel(root, sections, {
    stats,
    diagnostics,
    workspace,
    ...(registry === undefined ? {} : { registry }),
    ...(searchIndex === undefined ? {} : { searchIndex })
  });
}

function createReadModel(
  root: WorkspaceRoot,
  sections: readonly IndexSectionName[],
  state: {
    stats: ReadModelLoadStats;
    diagnostics: Diagnostic[];
    workspace?: LoadedWorkspace;
    registry?: RequirementRegistry;
    searchIndex?: CachedSearchIndex;
    graphResult?: ReturnType<typeof buildGraphFromRegistry>;
  }
): ReadModel {
  return {
    root,
    sections,
    stats: state.stats,
    diagnostics: Object.freeze([...state.diagnostics]),
    getWorkspace: () => {
      if (state.workspace === undefined) {
        throw new Error("Read model workspace is not available for the requested sections.");
      }
      return state.workspace;
    },
    getRequirementRegistry: () => {
      if (state.registry === undefined) {
        throw new Error("Read model registry is not available for the requested sections.");
      }
      return state.registry;
    },
    getSearchIndex: () => {
      if (state.searchIndex === undefined) {
        throw new Error("Read model search index is not available for the requested sections.");
      }
      return state.searchIndex;
    },
    buildGraph: (graphType) => {
      if (state.graphResult !== undefined) {
        const defaultGraphType = state.graphResult.ok ? state.graphResult.graphType : "traceability";
        return filterGraphResult(state.graphResult, graphType ?? defaultGraphType);
      }
      if (state.registry === undefined) {
        throw new Error("Read model graph is not available for the requested sections.");
      }
      const diagnostics =
        state.workspace === undefined
          ? createDiagnosticBag(state.diagnostics)
          : mergeDiagnosticBags(state.workspace.diagnostics, validateRegistry(state.workspace), createDiagnosticBag(state.diagnostics));
      return buildGraphFromRegistry(state.registry, graphType, diagnostics);
    }
  };
}

async function buildReadModelCacheKey(
  root: WorkspaceRoot,
  cacheMode: CacheMode,
  sections: readonly IndexSectionName[]
): Promise<ReadModelCacheKey> {
  const [manifestHash, artifactIntegritySummaries] = await Promise.all([
    hashManifestOrMissing(root),
    artifactIntegrityInputs(root, sections)
  ]);
  const needsMemoSourceIntegrity = sections.includes("graph") || sections.includes("search");
  const sourceIntegrityHash =
    cacheMode !== "bypass" && artifactIntegritySummaries.every((summary) => summary.sha256 !== undefined)
      ? needsMemoSourceIntegrity
        ? hashJson(await statWorkspaceInputs(root))
        : "fresh-cache"
      : hashJson(await fingerprintWorkspace(root));

  return {
    root: root.rootPath,
    cacheMode,
    sourceIntegrityHash,
    manifestHash,
    artifactIntegrityHash: hashJson(artifactIntegritySummaries),
    sections: [...sections]
  };
}

type ArtifactHashSummary = { path: string; sha256?: string; missing?: true; inaccessible?: true };

async function artifactIntegrityInputs(root: WorkspaceRoot, sections: readonly IndexSectionName[]): Promise<ArtifactHashSummary[]> {
  const paths = new Set<string>();
  if (sections.includes("search")) {
    paths.add(cacheOutputStorePaths.search);
  }
  if (sections.includes("entities")) {
    paths.add(cacheOutputStorePaths.entities);
  }
  if (sections.includes("relations")) {
    paths.add(cacheOutputStorePaths.relations);
  }
  if (sections.includes("graph")) {
    paths.add(cacheOutputStorePaths.graph);
  }

  const guard = await createRealPathGuard(root).catch(() => undefined);
  const hashes = await Promise.all([...paths].sort().map((storePath) => artifactHashSummary(root, storePath, guard)));

  if (sections.includes("entities")) {
    hashes.push(...(await requirementShardHashes(root, guard)));
  }

  return hashes.sort((left, right) => left.path.localeCompare(right.path));
}

async function requirementShardHashes(
  root: WorkspaceRoot,
  guard: Awaited<ReturnType<typeof createRealPathGuard>> | undefined
): Promise<ArtifactHashSummary[]> {
  if (guard === undefined) {
    return [{ path: "cache/requirements", inaccessible: true }];
  }
  try {
    const directory = (await resolveRealStorePathWithGuard(root, normalizeStorePath("cache/requirements"), guard)).absolutePath;
    const names = (await readdir(directory)).filter((entry) => /^[a-f0-9]{64}\.json$/.test(entry)).sort();
    return Promise.all(names.map((name) => artifactHashSummary(root, `cache/requirements/${name}`, guard)));
  } catch {
    return [{ path: "cache/requirements", missing: true }];
  }
}

async function artifactHashSummary(
  root: WorkspaceRoot,
  storePath: string,
  guard: Awaited<ReturnType<typeof createRealPathGuard>> | undefined
): Promise<ArtifactHashSummary> {
  if (guard === undefined) {
    return { path: storePath, inaccessible: true };
  }
  try {
    const target = await resolveRealStorePathWithGuard(root, normalizeStorePath(storePath), guard);
    const stats = await stat(target.absolutePath);
    return {
      path: storePath,
      sha256: `stat:${stats.size}:${stats.mtimeMs}:${stats.ctimeMs}`
    };
  } catch {
    return { path: storePath, missing: true };
  }
}

async function hashManifestOrMissing(root: WorkspaceRoot): Promise<string> {
  try {
    const target = await resolveRealStorePathWithGuard(
      root,
      normalizeStorePath(cacheOutputStorePaths.manifest),
      await createRealPathGuard(root)
    );
    return `sha256:${await sha256File(target.absolutePath)}`;
  } catch {
    return hashJson({ path: cacheOutputStorePaths.manifest, missing: true });
  }
}
