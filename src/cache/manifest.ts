import { readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";
import type { JsonObject } from "../core/dto.js";
import type { WorkspaceRoot } from "../io/path.js";
import type { LoadedWorkspace } from "../validate/semantic.js";
import { hashJson, sha256, sha256File } from "./hash.js";

export type CacheFileHash = {
  path: string;
  sha256: string;
};

export type CacheManifestSection = {
  inputs: CacheFileHash[];
  outputs: CacheFileHash[];
};

export type SearchCacheManifestSection = CacheManifestSection & {
  searchSettingsHash: string;
};

export type ExportCacheManifestSection = CacheManifestSection & {
  outputRoot: string;
  templateSettingsHash: string;
};

export type CacheManifest = {
  speckiwiVersion: string;
  schemaVersions: string[];
  sections: {
    graph: CacheManifestSection;
    search: SearchCacheManifestSection;
    diagnostics: CacheManifestSection;
    export: ExportCacheManifestSection;
  };
};

export type CacheInputs = CacheManifest;

export const cacheOutputStorePaths = {
  graph: "cache/graph.json",
  search: "cache/search-index.json",
  diagnostics: "cache/diagnostics.json",
  manifest: "cache/manifest.json"
} as const;

export async function readCacheManifest(root: WorkspaceRoot): Promise<CacheManifest | undefined> {
  try {
    const raw = await readFile(resolve(root.speckiwiPath, cacheOutputStorePaths.manifest), "utf8");
    const parsed = JSON.parse(raw) as unknown;
    return isCacheManifest(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

export async function buildCacheInputs(root: WorkspaceRoot, workspace: LoadedWorkspace): Promise<CacheInputs> {
  const inputHashes = workspace.documents
    .map((document) => ({ path: document.storePath, sha256: sha256(document.raw) }))
    .sort(compareFileHash);
  const outputHashes = await readOutputHashes(root);
  const index = workspace.documents.find((document) => document.storePath === "index.yaml" && document.value !== undefined)?.value;
  const searchSettings = jsonObjectValue(jsonObjectValue(index?.settings)?.search) ?? {};

  return {
    speckiwiVersion: await readPackageVersion(root),
    schemaVersions: schemaVersions(workspace),
    sections: {
      graph: {
        inputs: inputHashes,
        outputs: outputHashes.filter((item) => item.path === cacheOutputStorePaths.graph)
      },
      search: {
        inputs: inputHashes,
        outputs: outputHashes.filter((item) => item.path === cacheOutputStorePaths.search),
        searchSettingsHash: hashJson(searchSettings)
      },
      diagnostics: {
        inputs: inputHashes,
        outputs: outputHashes.filter((item) => item.path === cacheOutputStorePaths.diagnostics)
      },
      export: {
        inputs: [],
        outputs: [],
        outputRoot: "exports",
        templateSettingsHash: hashJson({})
      }
    }
  };
}

export function manifestFromInputs(inputs: CacheInputs): CacheManifest {
  return {
    speckiwiVersion: inputs.speckiwiVersion,
    schemaVersions: [...inputs.schemaVersions],
    sections: {
      graph: cloneSection(inputs.sections.graph),
      search: {
        ...cloneSection(inputs.sections.search),
        searchSettingsHash: inputs.sections.search.searchSettingsHash
      },
      diagnostics: cloneSection(inputs.sections.diagnostics),
      export: {
        ...cloneSection(inputs.sections.export),
        outputRoot: inputs.sections.export.outputRoot,
        templateSettingsHash: inputs.sections.export.templateSettingsHash
      }
    }
  };
}

export function isCacheStale(manifest: CacheManifest | undefined, inputs: CacheInputs): boolean {
  if (manifest === undefined) {
    return true;
  }

  return (
    manifest.speckiwiVersion !== inputs.speckiwiVersion ||
    !sameStrings(manifest.schemaVersions, inputs.schemaVersions) ||
    !sameSection(manifest.sections.graph, inputs.sections.graph) ||
    !sameSearchSection(manifest.sections.search, inputs.sections.search) ||
    !sameSection(manifest.sections.diagnostics, inputs.sections.diagnostics) ||
    !sameExportSection(manifest.sections.export, inputs.sections.export)
  );
}

function cloneSection(section: CacheManifestSection): CacheManifestSection {
  return {
    inputs: section.inputs.map((item) => ({ ...item })),
    outputs: section.outputs.map((item) => ({ ...item }))
  };
}

async function readOutputHashes(root: WorkspaceRoot): Promise<CacheFileHash[]> {
  const outputs: CacheFileHash[] = [];
  for (const path of [cacheOutputStorePaths.graph, cacheOutputStorePaths.search, cacheOutputStorePaths.diagnostics]) {
    const absolutePath = resolve(root.speckiwiPath, path);
    try {
      if ((await stat(absolutePath)).isFile()) {
        outputs.push({ path, sha256: await sha256File(absolutePath) });
      }
    } catch {
      continue;
    }
  }
  return outputs.sort(compareFileHash);
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

function schemaVersions(workspace: LoadedWorkspace): string[] {
  return [
    ...new Set(
      workspace.documents
        .map((document) => document.value?.schemaVersion)
        .filter((value): value is string => typeof value === "string")
    )
  ].sort();
}

function sameSearchSection(left: SearchCacheManifestSection, right: SearchCacheManifestSection): boolean {
  return left.searchSettingsHash === right.searchSettingsHash && sameSection(left, right);
}

function sameExportSection(left: ExportCacheManifestSection, right: ExportCacheManifestSection): boolean {
  return (
    left.outputRoot === right.outputRoot &&
    left.templateSettingsHash === right.templateSettingsHash &&
    sameSection(left, right)
  );
}

function sameSection(left: CacheManifestSection, right: CacheManifestSection): boolean {
  return sameFiles(left.inputs, right.inputs) && sameFiles(left.outputs, right.outputs);
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

function isCacheManifest(value: unknown): value is CacheManifest {
  const manifest = jsonObjectValue(value);
  const sections = jsonObjectValue(manifest?.sections);
  const graph = jsonObjectValue(sections?.graph);
  const search = jsonObjectValue(sections?.search);
  const diagnostics = jsonObjectValue(sections?.diagnostics);
  const exportSection = jsonObjectValue(sections?.export);
  return (
    typeof manifest?.speckiwiVersion === "string" &&
    stringArray(manifest.schemaVersions) !== undefined &&
    isManifestSection(graph) &&
    isManifestSection(search) &&
    typeof search.searchSettingsHash === "string" &&
    isManifestSection(diagnostics) &&
    isManifestSection(exportSection) &&
    typeof exportSection.outputRoot === "string" &&
    typeof exportSection.templateSettingsHash === "string"
  );
}

function jsonObjectValue(value: unknown): JsonObject | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as JsonObject) : undefined;
}

function isManifestSection(value: JsonObject | undefined): value is JsonObject & CacheManifestSection {
  return value !== undefined && fileHashArray(value.inputs) !== undefined && fileHashArray(value.outputs) !== undefined;
}

function fileHashArray(value: unknown): CacheFileHash[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  return value.every(isFileHash) ? value : undefined;
}

function stringArray(value: unknown): string[] | undefined {
  return Array.isArray(value) && value.every((item) => typeof item === "string") ? value : undefined;
}

function isFileHash(value: unknown): value is CacheFileHash {
  const item = jsonObjectValue(value);
  return typeof item?.path === "string" && typeof item.sha256 === "string";
}
