import { readFile } from "node:fs/promises";
import type { Diagnostic, JsonObject } from "../core/dto.js";
import { atomicWriteText } from "../io/file-store.js";
import type { WorkspaceRoot } from "../io/path.js";
import { normalizeStorePath, resolveRealStorePath } from "../io/path.js";
import type { LoadedWorkspace } from "../validate/semantic.js";
import { fingerprintLoadedWorkspace, fingerprintWorkspace, statWorkspaceInputs } from "./fingerprint.js";
import { sha256File, stableJson } from "./hash.js";
import {
  CACHE_MANIFEST_FORMAT,
  CACHE_MANIFEST_SCHEMA_VERSION,
  buildIndexManifest,
  type IndexManifestFile,
  type IndexManifestSection,
  type IndexManifestV2,
  type IndexSectionName,
  readVersionFingerprint,
  sameManifestFiles,
  sameManifestStats
} from "./index-manifest.js";

export type CacheFileHash = {
  path: string;
  sha256: string;
};

type LegacyCacheManifestSection = {
  inputs: CacheFileHash[];
  outputs: CacheFileHash[];
};

type LegacySearchCacheManifestSection = LegacyCacheManifestSection & {
  searchSettingsHash: string;
};

type LegacyExportCacheManifestSection = LegacyCacheManifestSection & {
  outputRoot: string;
  templateSettingsHash: string;
};

type LegacyCacheManifest = {
  speckiwiVersion: string;
  schemaVersions: string[];
  sections: {
    graph: LegacyCacheManifestSection;
    search: LegacySearchCacheManifestSection;
    diagnostics: LegacyCacheManifestSection;
    export: LegacyExportCacheManifestSection;
  };
};

export type CacheManifest = IndexManifestV2 | LegacyCacheManifest;
export type CacheInputs = IndexManifestV2;

export const cacheOutputStorePaths = {
  graph: "cache/graph.json",
  search: "cache/search-index.json",
  entities: "cache/entities.json",
  relations: "cache/relations.json",
  diagnostics: "cache/diagnostics.json",
  manifest: "cache/manifest.json"
} as const;

export async function readCacheManifest(root: WorkspaceRoot): Promise<CacheManifest | undefined> {
  return (await readCacheManifestFile(root)).manifest;
}

export async function readCacheManifestFile(root: WorkspaceRoot): Promise<{ manifest?: CacheManifest; warning?: Diagnostic }> {
  try {
    const target = await resolveRealStorePath(root, normalizeStorePath(cacheOutputStorePaths.manifest));
    const raw = await readFile(target.absolutePath, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (isIndexManifest(parsed) || isLegacyCacheManifest(parsed)) {
      return { manifest: parsed };
    }
    return {
      warning: cacheManifestWarning("Serialized cache manifest has an invalid shape.")
    };
  } catch (error) {
    return {
      warning: cacheManifestWarning(error instanceof Error ? error.message : String(error))
    };
  }
}

export async function writeCacheManifest(root: WorkspaceRoot, manifest: CacheManifest): Promise<void> {
  const target = await resolveRealStorePath(root, normalizeStorePath(cacheOutputStorePaths.manifest));
  await atomicWriteText(target.absolutePath, `${stableJson(manifest)}\n`);
}

export async function buildCacheInputs(root: WorkspaceRoot, workspace: LoadedWorkspace): Promise<CacheInputs> {
  return buildIndexManifest(root, workspace, await fingerprintLoadedWorkspace(root, workspace));
}

export function manifestFromInputs(inputs: CacheInputs): CacheManifest {
  return JSON.parse(JSON.stringify(inputs)) as CacheInputs;
}

export function isCacheStale(manifest: CacheManifest | undefined, inputs: CacheInputs): boolean {
  if (manifest === undefined || !isIndexManifest(manifest)) {
    return true;
  }

  return (
    manifest.speckiwiVersion !== inputs.speckiwiVersion ||
    manifest.parserVersion !== inputs.parserVersion ||
    manifest.schemaBundleHash !== inputs.schemaBundleHash ||
    !sameManifestFiles(manifest.files, inputs.files) ||
    !sameSection(manifest.sections.facts, inputs.sections.facts) ||
    !sameSection(manifest.sections.entities, inputs.sections.entities) ||
    !sameSection(manifest.sections.relations, inputs.sections.relations) ||
    !sameSearchSection(manifest.sections.search, inputs.sections.search) ||
    !sameGraphSection(manifest.sections.graph, inputs.sections.graph) ||
    !sameSection(manifest.sections.diagnostics, inputs.sections.diagnostics)
  );
}

export async function isIndexSectionFresh(root: WorkspaceRoot, section: IndexSectionName): Promise<boolean> {
  if (!(await isIndexSectionArtifactFresh(root, section))) {
    return false;
  }

  const manifest = await readCacheManifest(root);
  if (!isIndexManifest(manifest)) {
    return false;
  }

  const stats = await statWorkspaceInputs(root);
  if (sameManifestStats(manifest.files, stats)) {
    return true;
  }

  return sameManifestFiles(manifest.files, await fingerprintWorkspace(root));
}

export async function isIndexSectionArtifactFresh(root: WorkspaceRoot, section: IndexSectionName): Promise<boolean> {
  const manifest = await readCacheManifest(root);
  if (!isIndexManifest(manifest)) {
    return false;
  }

  if (!(await outputsMatchManifest(root, manifest.sections[section].outputs))) {
    return false;
  }

  const versions = await readVersionFingerprint(root);
  if (!sameRootVersions(manifest, versions)) {
    return false;
  }
  if (
    section === "search" &&
    (
      manifest.sections.search.tokenizerVersion !== versions.tokenizerVersion ||
      manifest.sections.search.searchSettingsHash !== versions.searchSettingsHash ||
      manifest.sections.search.dictionaryHash !== versions.dictionaryHash
    )
  ) {
    return false;
  }
  if (section === "graph" && manifest.sections.graph.graphRulesVersion !== versions.graphRulesVersion) {
    return false;
  }

  return true;
}

export async function outputsMatchManifest(root: WorkspaceRoot, outputs: CacheFileHash[]): Promise<boolean> {
  for (const output of outputs) {
    try {
      const target = await resolveRealStorePath(root, normalizeStorePath(output.path));
      const actualHash = `sha256:${await sha256File(target.absolutePath)}`;
      if (actualHash !== normalizeSha256(output.sha256)) {
        return false;
      }
    } catch {
      return false;
    }
  }
  return true;
}

export async function cacheOutputMatchesManifest(root: WorkspaceRoot, manifest: IndexManifestV2, storePath: string): Promise<boolean> {
  const normalized = normalizeStorePath(storePath);
  const output = manifestOutputs(manifest).find((entry) => entry.path === normalized);
  return output !== undefined && (await outputsMatchManifest(root, [output]));
}

function manifestOutputs(manifest: IndexManifestV2): CacheFileHash[] {
  return [
    ...manifest.sections.facts.outputs,
    ...manifest.sections.entities.outputs,
    ...manifest.sections.relations.outputs,
    ...manifest.sections.search.outputs,
    ...manifest.sections.graph.outputs,
    ...manifest.sections.diagnostics.outputs
  ];
}

function normalizeSha256(value: string): string {
  return value.startsWith("sha256:") ? value : `sha256:${value}`;
}

function sameSearchSection(left: IndexManifestV2["sections"]["search"], right: IndexManifestV2["sections"]["search"]): boolean {
  return (
    left.tokenizerVersion === right.tokenizerVersion &&
    left.searchSettingsHash === right.searchSettingsHash &&
    left.dictionaryHash === right.dictionaryHash &&
    sameSection(left, right)
  );
}

function sameGraphSection(left: IndexManifestV2["sections"]["graph"], right: IndexManifestV2["sections"]["graph"]): boolean {
  return left.graphRulesVersion === right.graphRulesVersion && sameSection(left, right);
}

function sameSection(left: IndexManifestSection, right: IndexManifestSection): boolean {
  return sameStrings(left.inputs, right.inputs) && sameFiles(left.outputs, right.outputs);
}

function sameFiles(left: CacheFileHash[], right: CacheFileHash[]): boolean {
  return JSON.stringify([...left].sort(compareFileHash)) === JSON.stringify([...right].sort(compareFileHash));
}

function sameStrings(left: string[], right: string[]): boolean {
  return JSON.stringify([...left].sort()) === JSON.stringify([...right].sort());
}

function compareFileHash(left: CacheFileHash, right: CacheFileHash): number {
  return left.path.localeCompare(right.path) || left.sha256.localeCompare(right.sha256);
}

function isIndexManifest(value: unknown): value is IndexManifestV2 {
  const manifest = jsonObjectValue(value);
  const sections = jsonObjectValue(manifest?.sections);
  const facts = jsonObjectValue(sections?.facts);
  const entities = jsonObjectValue(sections?.entities);
  const relations = jsonObjectValue(sections?.relations);
  const search = jsonObjectValue(sections?.search);
  const graph = jsonObjectValue(sections?.graph);
  const diagnostics = jsonObjectValue(sections?.diagnostics);
  return (
    manifest?.format === CACHE_MANIFEST_FORMAT &&
    manifest.cacheSchemaVersion === CACHE_MANIFEST_SCHEMA_VERSION &&
    typeof manifest.speckiwiVersion === "string" &&
    typeof manifest.parserVersion === "string" &&
    typeof manifest.schemaBundleHash === "string" &&
    manifestFiles(manifest.files) !== undefined &&
    isManifestSection(facts) &&
    isManifestSection(entities) &&
    isManifestSection(relations) &&
    isManifestSection(search) &&
    typeof search.tokenizerVersion === "string" &&
    typeof search.searchSettingsHash === "string" &&
    typeof search.dictionaryHash === "string" &&
    isManifestSection(graph) &&
    typeof graph.graphRulesVersion === "string" &&
    isManifestSection(diagnostics)
  );
}

function isLegacyCacheManifest(value: unknown): value is LegacyCacheManifest {
  const manifest = jsonObjectValue(value);
  const sections = jsonObjectValue(manifest?.sections);
  const graph = jsonObjectValue(sections?.graph);
  const search = jsonObjectValue(sections?.search);
  const diagnostics = jsonObjectValue(sections?.diagnostics);
  const exportSection = jsonObjectValue(sections?.export);
  return (
    manifest?.format === undefined &&
    typeof manifest?.speckiwiVersion === "string" &&
    stringArray(manifest.schemaVersions) !== undefined &&
    isLegacySection(graph) &&
    isLegacySection(search) &&
    typeof search.searchSettingsHash === "string" &&
    isLegacySection(diagnostics) &&
    isLegacySection(exportSection) &&
    typeof exportSection.outputRoot === "string" &&
    typeof exportSection.templateSettingsHash === "string"
  );
}

function jsonObjectValue(value: unknown): JsonObject | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as JsonObject) : undefined;
}

function isManifestSection(value: JsonObject | undefined): value is JsonObject & IndexManifestSection {
  return value !== undefined && stringArray(value.inputs) !== undefined && fileHashArray(value.outputs) !== undefined;
}

function isLegacySection(value: JsonObject | undefined): value is JsonObject & LegacyCacheManifestSection {
  return value !== undefined && fileHashArray(value.inputs) !== undefined && fileHashArray(value.outputs) !== undefined;
}

function fileHashArray(value: unknown): CacheFileHash[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  return value.every(isFileHash) ? value : undefined;
}

function manifestFiles(value: unknown): IndexManifestFile[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  return value.every(isManifestFile) ? (value as IndexManifestFile[]) : undefined;
}

function stringArray(value: unknown): string[] | undefined {
  return Array.isArray(value) && value.every((item) => typeof item === "string") ? value : undefined;
}

function isFileHash(value: unknown): value is CacheFileHash {
  const item = jsonObjectValue(value);
  return typeof item?.path === "string" && typeof item.sha256 === "string";
}

function cacheManifestWarning(reason: string): Diagnostic {
  return {
    severity: "warning",
    code: "CACHE_MANIFEST_UNREADABLE",
    message: "Cache manifest could not be read; cache freshness was treated as stale.",
    path: ".speckiwi/cache/manifest.json",
    details: { reason }
  };
}

function isManifestFile(value: unknown): value is IndexManifestFile {
  const item = jsonObjectValue(value);
  return (
    typeof item?.path === "string" &&
    typeof item.size === "number" &&
    typeof item.mtimeMs === "number" &&
    typeof item.ctimeMs === "number" &&
    typeof item.sha256 === "string" &&
    (item.schemaKind === undefined || typeof item.schemaKind === "string") &&
    (item.artifactHash === undefined || typeof item.artifactHash === "string")
  );
}

function sameRootVersions(manifest: IndexManifestV2, versions: Awaited<ReturnType<typeof readVersionFingerprint>>): boolean {
  return (
    manifest.speckiwiVersion === versions.speckiwiVersion &&
    manifest.parserVersion === versions.parserVersion &&
    manifest.schemaBundleHash === versions.schemaBundleHash
  );
}
