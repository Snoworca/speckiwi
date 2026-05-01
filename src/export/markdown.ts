import { createHash } from "node:crypto";
import { lstat, mkdir, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import type { Diagnostic, DiagnosticBag, DocumentSummary, ExportResult, ExportableDocumentType, JsonObject, SkippedExportFile } from "../core/dto.js";
import type { ExportMarkdownInput } from "../core/inputs.js";
import { createDiagnosticBag, fail } from "../core/result.js";
import { isInsideDirectory, type WorkspaceRoot } from "../io/path.js";
import { workspaceRootFromPath } from "../io/workspace.js";
import { loadWorkspaceForValidation, validateRegistry, type LoadedSpecDocument, type ManifestDocumentEntry } from "../validate/semantic.js";
import { mergeDiagnosticBags } from "../validate/diagnostics.js";
import {
  exportPathForDocument,
  renderDiagnosticsSummary,
  renderDocumentMarkdown,
  renderExportIndex,
  type ContentDocument
} from "./templates.js";

const defaultOutputRoot = ".speckiwi/exports";

type ExportTargetDocument = ContentDocument & {
  source: LoadedSpecDocument;
};

type OutputRoot = {
  absolutePath: string;
  displayPath: string;
};

export async function exportMarkdown(input: ExportMarkdownInput = {}): Promise<ExportResult> {
  const root = workspaceRootFromPath(resolve(input.root ?? process.cwd()));
  const outputRoot = resolveOutputRoot(root, input.outputRoot);
  if ("error" in outputRoot) {
    return fail(outputRoot.error, outputRoot.diagnostics);
  }

  const types = normalizeExportTypes(input.type);
  if ("error" in types) {
    return fail(types.error, types.diagnostics);
  }

  const documentIds = normalizeStringList(input.documentId);
  const workspace = await loadWorkspaceForValidation(root);
  const diagnostics = mergeDiagnosticBags(workspace.diagnostics, validateRegistry(workspace));
  const target = selectTargetDocuments(workspace.documents, workspace.manifestEntries, types.values, documentIds);
  if ("error" in target) {
    return fail(target.error, target.diagnostics);
  }

  const skippedFiles = target.skippedFiles.sort((left, right) => left.sourcePath.localeCompare(right.sourcePath));
  const strict = input.strict === true;
  if (strict && diagnostics.summary.errorCount > 0) {
    return {
      ok: false,
      strict: true,
      outputRoot: outputRoot.value.displayPath,
      writtenFiles: [],
      skippedFiles,
      diagnostics
    };
  }

  const writes = [
    {
      path: "index.md",
      markdown: `${strict ? "" : `${renderDiagnosticsSummary(diagnostics)}\n\n`}${renderExportIndex(target.documents)}`,
      sourceDocumentId: undefined,
      sourcePath: undefined
    },
    ...target.documents.map((document) => ({
      path: exportPathForDocument(document),
      markdown: renderDocumentMarkdown(document),
      sourceDocumentId: document.id,
      sourcePath: document.path
    }))
  ].sort((left, right) => left.path.localeCompare(right.path));

  const writtenFiles = [];
  for (const item of writes) {
    const absolutePath = resolve(outputRoot.value.absolutePath, item.path);
    if (!isInsideDirectory(absolutePath, outputRoot.value.absolutePath)) {
      return fail(pathError("EXPORT_PATH_TRAVERSAL", `Export path escapes output root: ${item.path}`));
    }
    const symlinkError = await assertNoSymlinkTraversal(outputRoot.value.absolutePath, absolutePath);
    if (symlinkError !== undefined) {
      return fail(symlinkError);
    }
    await mkdir(dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, item.markdown, "utf8");
    const exported = {
      path: item.path,
      sha256: `sha256:${sha256(item.markdown)}`
    };
    if (item.sourceDocumentId !== undefined) {
      Object.assign(exported, { sourceDocumentId: item.sourceDocumentId });
    }
    if (item.sourcePath !== undefined) {
      Object.assign(exported, { sourcePath: item.sourcePath });
    }
    writtenFiles.push(exported);
  }

  return {
    ok: true,
    strict,
    outputRoot: outputRoot.value.displayPath,
    writtenFiles,
    skippedFiles,
    diagnostics
  };
}

function selectTargetDocuments(
  documents: LoadedSpecDocument[],
  manifestEntries: ManifestDocumentEntry[],
  types: ExportableDocumentType[] | undefined,
  documentIds: string[] | undefined
):
  | {
      documents: ExportTargetDocument[];
      skippedFiles: SkippedExportFile[];
    }
  | { error: { code: string; message: string; details?: Record<string, string> }; diagnostics: DiagnosticBag } {
  const byPath = new Map(documents.map((document) => [document.storePath, document]));
  const byId = new Map(manifestEntries.map((entry) => [entry.id, entry]));
  const selectedEntries = manifestEntries.filter((entry) => entryMatches(entry, types, documentIds));

  if (documentIds !== undefined) {
    for (const id of documentIds) {
      const entry = byId.get(id);
      if (entry === undefined) {
        return errorResult("DOCUMENT_NOT_FOUND", `Document not found: ${id}.`, { id });
      }
      if (!isExportableDocumentType(entry.type)) {
        return errorResult("EXPORT_TYPE_NOT_SUPPORTED", `Document type is not exportable: ${entry.type}.`, { type: entry.type, id });
      }
    }
  }

  const targetDocuments: ExportTargetDocument[] = [];
  const skippedFiles: SkippedExportFile[] = [];
  for (const entry of selectedEntries) {
    if (!isExportableDocumentType(entry.type)) {
      continue;
    }

    const loaded = byPath.get(entry.path);
    if (loaded === undefined) {
      skippedFiles.push({
        sourceDocumentId: entry.id,
        sourcePath: entry.path,
        reasonCode: "EXPORT_SOURCE_NOT_FOUND",
        message: `Registered source document was not found: ${entry.path}.`
      });
      continue;
    }

    if (!loaded.yamlValid || loaded.value === undefined) {
      skippedFiles.push({
        sourceDocumentId: entry.id,
        sourcePath: entry.path,
        reasonCode: "EXPORT_SOURCE_YAML_INVALID",
        message: `Source document is not valid YAML: ${entry.path}.`
      });
      continue;
    }

    if (!loaded.schemaValid || loaded.schemaKind !== entry.type) {
      skippedFiles.push({
        sourceDocumentId: entry.id,
        sourcePath: entry.path,
        reasonCode: "EXPORT_SOURCE_SCHEMA_INVALID",
        message: `Source document failed schema validation: ${entry.path}.`
      });
      continue;
    }

    targetDocuments.push({
      id: entry.id,
      type: entry.type,
      path: entry.path,
      value: loaded.value,
      source: loaded,
      ...documentMetadata(loaded.value)
    });
  }

  return {
    documents: targetDocuments.sort(compareTargetDocuments),
    skippedFiles
  };
}

function entryMatches(entry: ManifestDocumentEntry, types: ExportableDocumentType[] | undefined, documentIds: string[] | undefined): boolean {
  if (documentIds !== undefined && !documentIds.includes(entry.id)) {
    return false;
  }
  if (types !== undefined && (!isExportableDocumentType(entry.type) || !types.includes(entry.type))) {
    return false;
  }
  return documentIds !== undefined || types !== undefined || isExportableDocumentType(entry.type);
}

function documentMetadata(value: JsonObject): Partial<DocumentSummary> {
  const metadata: Partial<DocumentSummary> = {};
  for (const key of ["title", "status", "scope"] as const) {
    if (typeof value[key] === "string") {
      metadata[key] = value[key];
    }
  }
  if (Array.isArray(value.tags)) {
    const tags = value.tags.filter((tag): tag is string => typeof tag === "string").sort();
    if (tags.length > 0) {
      metadata.tags = tags;
    }
  }
  return metadata;
}

function normalizeExportTypes(value: string | string[] | undefined):
  | { values: ExportableDocumentType[] | undefined }
  | { error: { code: string; message: string; details?: Record<string, string> }; diagnostics: DiagnosticBag } {
  const values = normalizeStringList(value);
  if (values === undefined) {
    return { values: undefined };
  }

  const normalized: ExportableDocumentType[] = [];
  for (const type of values) {
    if (!isExportableDocumentType(type)) {
      return errorResult("EXPORT_TYPE_NOT_SUPPORTED", `Document type is not exportable: ${type}.`, { type });
    }
    if (!normalized.includes(type)) {
      normalized.push(type);
    }
  }
  return { values: normalized };
}

function normalizeStringList(value: string | string[] | undefined): string[] | undefined {
  if (value === undefined) {
    return undefined;
  }
  const values = Array.isArray(value) ? value : [value];
  const normalized = values.flatMap((item) => item.split(",")).map((item) => item.trim()).filter((item) => item.length > 0);
  return normalized.length > 0 ? [...new Set(normalized)] : undefined;
}

function resolveOutputRoot(root: WorkspaceRoot, outputRoot: string | undefined): { value: OutputRoot } | { error: { code: string; message: string }; diagnostics: DiagnosticBag } {
  if (outputRoot !== undefined && outputRoot.includes("\0")) {
    return errorResult("INVALID_ARGUMENT", "outputRoot cannot contain NUL bytes.");
  }

  if (outputRoot === undefined) {
    return { value: { absolutePath: resolve(root.speckiwiPath, "exports"), displayPath: defaultOutputRoot } };
  }

  const trimmed = outputRoot.trim();
  if (trimmed.length === 0) {
    return errorResult("INVALID_ARGUMENT", "outputRoot cannot be empty.");
  }

  const absolutePath = isAbsolute(trimmed) ? resolve(trimmed) : resolve(root.rootPath, trimmed);
  if (!isAbsolute(trimmed) && !isInsideDirectory(absolutePath, root.rootPath)) {
    return errorResult("PATH_TRAVERSAL", `outputRoot escapes workspace root: ${trimmed}`);
  }

  return {
    value: {
      absolutePath,
      displayPath: isAbsolute(trimmed) ? absolutePath : toPosix(trimmed)
    }
  };
}

async function assertNoSymlinkTraversal(outputRoot: string, absolutePath: string): Promise<{ code: string; message: string } | undefined> {
  try {
    const rootStats = await lstat(outputRoot);
    if (rootStats.isSymbolicLink()) {
      return pathError("WORKSPACE_ESCAPE", `Export output root is a symlink: ${outputRoot}`);
    }
  } catch (error) {
    if (!isNotFound(error)) {
      throw error;
    }
  }

  const relativePath = relative(outputRoot, absolutePath);
  const segments = relativePath.split(sep).filter((segment) => segment.length > 0);
  let current = outputRoot;

  for (const segment of segments) {
    current = resolve(current, segment);
    try {
      const stats = await lstat(current);
      if (stats.isSymbolicLink()) {
        return pathError("WORKSPACE_ESCAPE", `Export path traverses a symlink: ${current}`);
      }
    } catch (error) {
      if (isNotFound(error)) {
        return undefined;
      }
      throw error;
    }
  }

  return undefined;
}

function isExportableDocumentType(value: string): value is ExportableDocumentType {
  return value === "overview" || value === "srs" || value === "prd" || value === "technical" || value === "adr";
}

function compareTargetDocuments(left: ExportTargetDocument, right: ExportTargetDocument): number {
  return exportPathForDocument(left).localeCompare(exportPathForDocument(right)) || left.id.localeCompare(right.id);
}

function errorResult(code: string, message: string, details?: Record<string, string>) {
  const diagnostic: Diagnostic = {
    severity: "error",
    code,
    message
  };
  if (details !== undefined) {
    diagnostic.details = details;
  }
  return {
    error: { code, message, ...(details === undefined ? {} : { details }) },
    diagnostics: createDiagnosticBag([diagnostic])
  };
}

function pathError(code: string, message: string): { code: string; message: string } {
  return { code, message };
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function toPosix(value: string): string {
  return value.replace(/\\/g, "/");
}

function isNotFound(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error as { code?: unknown }).code === "ENOENT";
}
