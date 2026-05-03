import { readFile, readdir, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { parse } from "yaml";
import type { JsonObject } from "../core/dto.js";
import type { WorkspaceRoot } from "../io/path.js";
import { createRealPathGuard, normalizeStorePath, resolveRealStorePathWithGuard } from "../io/path.js";
import type { LoadedWorkspace } from "../validate/semantic.js";
import { hashJson, sha256 } from "./hash.js";
import { type CacheFileHash, cacheOutputStorePaths } from "./manifest.js";
import { type SourceFileFingerprint, type SourceFileStat } from "./fingerprint.js";

export const CACHE_MANIFEST_FORMAT = "speckiwi/cache-manifest/v2";
export const CACHE_MANIFEST_SCHEMA_VERSION = 2;
export const CACHE_PARSER_VERSION = "yaml@2";
export const CACHE_TOKENIZER_VERSION = "search-tokenizer@1";
export const CACHE_GRAPH_RULES_VERSION = "graph-rules@1";

export type CacheVersionFingerprint = {
  speckiwiVersion: string;
  parserVersion: string;
  schemaBundleHash: string;
  tokenizerVersion: string;
  graphRulesVersion: string;
  dictionaryHash: string;
  searchSettingsHash: string;
};

export type IndexSectionName = "facts" | "entities" | "relations" | "search" | "graph" | "diagnostics";

export type IndexManifestFile = SourceFileFingerprint & {
  schemaKind?: string;
  artifactHash?: string;
};

export type IndexManifestSection = {
  inputs: string[];
  outputs: CacheFileHash[];
};

export type SearchManifestSection = IndexManifestSection & {
  tokenizerVersion: string;
  searchSettingsHash: string;
  dictionaryHash: string;
};

export type GraphManifestSection = IndexManifestSection & {
  graphRulesVersion: string;
};

export type IndexManifestV2 = {
  format: typeof CACHE_MANIFEST_FORMAT;
  cacheSchemaVersion: typeof CACHE_MANIFEST_SCHEMA_VERSION;
  speckiwiVersion: string;
  parserVersion: string;
  schemaBundleHash: string;
  files: IndexManifestFile[];
  sections: {
    facts: IndexManifestSection;
    entities: IndexManifestSection;
    relations: IndexManifestSection;
    search: SearchManifestSection;
    graph: GraphManifestSection;
    diagnostics: IndexManifestSection;
  };
};

export async function buildIndexManifest(
  root: WorkspaceRoot,
  workspace: LoadedWorkspace,
  files: SourceFileFingerprint[]
): Promise<IndexManifestV2> {
  const outputHashes = await readOutputHashes(root);
  return buildIndexManifestWithOutputs(root, workspace, files, outputHashes);
}

export async function buildIndexManifestWithOutputs(
  root: WorkspaceRoot,
  workspace: LoadedWorkspace,
  files: SourceFileFingerprint[],
  outputHashes: CacheFileHash[]
): Promise<IndexManifestV2> {
  const versions = await readVersionFingerprint(root, workspace);
  const inputs = files.map((file) => file.path);
  const byPath = new Map(workspace.documents.map((document) => [document.storePath, document]));
  const manifestFiles: IndexManifestFile[] = files.map((file) => {
    const schemaKind = byPath.get(file.path)?.schemaKind;
    return schemaKind === undefined ? { ...file } : { ...file, schemaKind };
  });
  return {
    format: CACHE_MANIFEST_FORMAT,
    cacheSchemaVersion: CACHE_MANIFEST_SCHEMA_VERSION,
    speckiwiVersion: versions.speckiwiVersion,
    parserVersion: versions.parserVersion,
    schemaBundleHash: versions.schemaBundleHash,
    files: manifestFiles,
    sections: {
      facts: {
        inputs,
        outputs: []
      },
      entities: {
        inputs,
        outputs: outputHashes.filter(
          (entry) => entry.path === cacheOutputStorePaths.entities || entry.path.startsWith("cache/requirements/")
        )
      },
      relations: {
        inputs,
        outputs: outputHashes.filter((entry) => entry.path === cacheOutputStorePaths.relations)
      },
      search: {
        inputs,
        outputs: outputHashes.filter((entry) => entry.path === cacheOutputStorePaths.search),
        tokenizerVersion: versions.tokenizerVersion,
        searchSettingsHash: versions.searchSettingsHash,
        dictionaryHash: versions.dictionaryHash
      },
      graph: {
        inputs,
        outputs: outputHashes.filter((entry) => entry.path === cacheOutputStorePaths.graph),
        graphRulesVersion: versions.graphRulesVersion
      },
      diagnostics: {
        inputs,
        outputs: outputHashes.filter((entry) => entry.path === cacheOutputStorePaths.diagnostics)
      }
    }
  };
}

export async function readVersionFingerprint(
  root: WorkspaceRoot,
  workspace?: LoadedWorkspace
): Promise<CacheVersionFingerprint> {
  const [speckiwiVersion, schemaBundleHash, searchSettingsHash, dictionaryHash] = await Promise.all([
    readPackageVersion(root),
    readSchemaBundleHash(root),
    readSearchSettingsHash(root, workspace),
    readDictionaryHash(root, workspace)
  ]);
  return {
    speckiwiVersion,
    parserVersion: CACHE_PARSER_VERSION,
    schemaBundleHash,
    tokenizerVersion: CACHE_TOKENIZER_VERSION,
    graphRulesVersion: CACHE_GRAPH_RULES_VERSION,
    dictionaryHash,
    searchSettingsHash
  };
}

export function sameManifestFiles(left: IndexManifestFile[], right: SourceFileFingerprint[] | IndexManifestFile[]): boolean {
  if (left.length !== right.length) {
    return false;
  }
  return left.every((file, index) => {
    const other = right[index];
    return (
      other !== undefined &&
      file.path === other.path &&
      file.size === other.size &&
      file.mtimeMs === other.mtimeMs &&
      file.ctimeMs === other.ctimeMs &&
      file.sha256 === other.sha256
    );
  });
}

export function sameManifestStats(left: IndexManifestFile[], right: SourceFileStat[]): boolean {
  if (left.length !== right.length) {
    return false;
  }
  return left.every((file, index) => {
    const other = right[index];
    return (
      other !== undefined &&
      file.path === other.path &&
      file.size === other.size &&
      file.mtimeMs === other.mtimeMs &&
      file.ctimeMs === other.ctimeMs
    );
  });
}

export function hasManifestFormat(value: unknown): value is IndexManifestV2 {
  const object = jsonObjectValue(value);
  return object?.format === CACHE_MANIFEST_FORMAT && object.cacheSchemaVersion === CACHE_MANIFEST_SCHEMA_VERSION;
}

async function readPackageVersion(root: WorkspaceRoot): Promise<string> {
  for (const path of [resolve(root.rootPath, "package.json"), resolve(process.cwd(), "package.json")]) {
    try {
      const parsed = JSON.parse(await readFile(path, "utf8")) as { version?: unknown };
      if (typeof parsed.version === "string" && parsed.version.length > 0) {
        return parsed.version;
      }
    } catch {
      continue;
    }
  }
  return "0.0.0";
}

async function readSchemaBundleHash(root: WorkspaceRoot): Promise<string> {
  const schemaDirectories = [resolve(root.rootPath, "schemas"), resolve(import.meta.dirname, "../../schemas")];
  const files = [
    "adr.schema.json",
    "dictionary.schema.json",
    "index.schema.json",
    "overview.schema.json",
    "prd.schema.json",
    "proposal.schema.json",
    "rule.schema.json",
    "srs.schema.json",
    "technical.schema.json"
  ];
  for (const schemaDirectory of schemaDirectories) {
    try {
      const contents = await Promise.all(
        files.map(async (path) => ({
          path,
          sha256: sha256(await readFile(resolve(schemaDirectory, path), "utf8"))
        }))
      );
      return hashJson(contents);
    } catch {
      continue;
    }
  }
  return hashJson({ missing: "schemas" });
}

async function readSearchSettingsHash(root: WorkspaceRoot, workspace?: LoadedWorkspace): Promise<string> {
  const parsed = workspace !== undefined ? workspaceDocumentValue(workspace, "index.yaml") : await parseWorkspaceYaml(root, "index.yaml");
  return hashJson(jsonObjectValue(jsonObjectValue(parsed?.settings)?.search) ?? {});
}

async function readDictionaryHash(root: WorkspaceRoot, workspace?: LoadedWorkspace): Promise<string> {
  if (workspace !== undefined) {
    const document = workspace.documents.find((entry) => entry.storePath === "dictionary.yaml");
    return document === undefined ? hashJson({}) : `sha256:${sha256(document.raw)}`;
  }
  try {
    return `sha256:${sha256(await readFile(resolve(root.speckiwiPath, "dictionary.yaml"), "utf8"))}`;
  } catch {
    return hashJson({});
  }
}

async function parseWorkspaceYaml(root: WorkspaceRoot, storePath: string): Promise<JsonObject | undefined> {
  try {
    const parsed = parse(await readFile(resolve(root.speckiwiPath, storePath), "utf8")) as unknown;
    return jsonObjectValue(parsed);
  } catch {
    return undefined;
  }
}

function workspaceDocumentValue(workspace: LoadedWorkspace, storePath: string): JsonObject | undefined {
  return workspace.documents.find((document) => document.storePath === storePath)?.value;
}

function jsonObjectValue(value: unknown): JsonObject | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as JsonObject) : undefined;
}

async function readOutputHashes(root: WorkspaceRoot): Promise<CacheFileHash[]> {
  const outputs: CacheFileHash[] = [];
  const guard = await createRealPathGuard(root);
  for (const path of [
    cacheOutputStorePaths.graph,
    cacheOutputStorePaths.search,
    cacheOutputStorePaths.entities,
    cacheOutputStorePaths.relations,
    cacheOutputStorePaths.diagnostics
  ]) {
    try {
      const target = await resolveRealStorePathWithGuard(root, normalizeStorePath(path), guard);
      if ((await stat(target.absolutePath)).isFile()) {
        outputs.push({
          path,
          sha256: `sha256:${sha256(await readFile(target.absolutePath, "utf8"))}`
        });
      }
    } catch {
      continue;
    }
  }
  try {
    const shardDirectory = (await resolveRealStorePathWithGuard(root, normalizeStorePath("cache/requirements"), guard)).absolutePath;
    for (const name of (await readdir(shardDirectory)).filter((entry) => /^[a-f0-9]{64}\.json$/.test(entry)).sort()) {
      const path = `cache/requirements/${name}`;
      const target = await resolveRealStorePathWithGuard(root, normalizeStorePath(path), guard);
      outputs.push({
        path,
        sha256: `sha256:${sha256(await readFile(target.absolutePath, "utf8"))}`
      });
    }
  } catch {
    // noop
  }
  return outputs.sort((left, right) => left.path.localeCompare(right.path));
}
