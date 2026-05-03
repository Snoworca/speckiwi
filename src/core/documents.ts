import { resolve } from "node:path";
import type { DocumentListResult, DocumentSummary, JsonObject, ReadDocumentResult } from "./dto.js";
import type { ListDocumentsInput, ReadDocumentInput } from "./inputs.js";
import { normalizeStorePath, resolveRealStorePath, WorkspacePathError } from "../io/path.js";
import { loadYamlDocument } from "../io/yaml-loader.js";
import { workspaceRootFromPath } from "../io/workspace.js";
import { loadRequirementRegistry } from "./requirements.js";
import { createDiagnosticBag, fail, ok } from "./result.js";

export async function listDocuments(input: ListDocumentsInput = {}): Promise<DocumentListResult> {
  let registry: Awaited<ReturnType<typeof loadRequirementRegistry>>;
  try {
    registry = await loadRequirementRegistry(input);
  } catch (error) {
    if (error instanceof WorkspacePathError) {
      return workspacePathFailure(error, ".speckiwi");
    }
    throw error;
  }
  const filtered = registry.documents.filter(
    (document) =>
      matches(document.type, input.type) &&
      matches(document.scope, input.scope) &&
      matchesAny(document.status, input.status)
  );
  const limit = normalizeListLimit(input.limit);
  const offset = normalizeOffset(input.offset);
  const pageItems = filtered.slice(offset, offset + limit).map(documentSummary);

  return ok({
    documents: pageItems,
    page: {
      limit,
      offset,
      returned: pageItems.length,
      total: filtered.length,
      hasMore: offset + pageItems.length < filtered.length,
      nextOffset: offset + pageItems.length < filtered.length ? offset + pageItems.length : null
    }
  });
}

export async function readDocument(input: ReadDocumentInput): Promise<ReadDocumentResult> {
  let registry: Awaited<ReturnType<typeof loadRequirementRegistry>>;
  try {
    registry = await loadRequirementRegistry(input);
  } catch (error) {
    if (error instanceof WorkspacePathError) {
      return workspacePathFailure(error, ".speckiwi");
    }
    throw error;
  }
  const document = registry.documentsById.get(input.id);
  if (document === undefined) {
    const diagnostics = createDiagnosticBag([
      {
        severity: "error",
        code: "DOCUMENT_NOT_FOUND",
        message: `Document not found: ${input.id}.`,
        details: { id: input.id }
      }
    ]);
    return fail({ code: "DOCUMENT_NOT_FOUND", message: `Document not found: ${input.id}.`, details: { id: input.id } }, diagnostics);
  }

  const payload: {
    documentId: string;
    path: string;
    rawYaml?: string;
    parsed?: JsonObject;
  } = {
    documentId: document.id,
    path: document.path
  };

  if (input.includeRawYaml === true || input.includeParsed === true) {
    const root = workspaceRootFromPath(resolve(input.root ?? process.cwd()));
    let loaded: Awaited<ReturnType<typeof loadYamlDocument>>;
    try {
      loaded = await loadYamlDocument(await resolveRealStorePath(root, normalizeStorePath(document.path)));
    } catch (error) {
      if (error instanceof WorkspacePathError) {
        return fail(
          { code: error.code, message: error.message, details: { path: `.speckiwi/${document.path}` } },
          createDiagnosticBag([{ severity: "error", code: error.code, message: error.message, path: `.speckiwi/${document.path}` }])
        );
      }
      throw error;
    }
    if (input.includeRawYaml === true) {
      payload.rawYaml = loaded.raw;
    }
    if (input.includeParsed === true && isJsonObject(loaded.value)) {
      payload.parsed = loaded.value;
    }
  }

  return ok(payload);
}

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function documentSummary(document: DocumentSummary): DocumentSummary {
  const summary: DocumentSummary = {
    id: document.id,
    type: document.type,
    path: document.path
  };
  if (document.title !== undefined) {
    summary.title = document.title;
  }
  if (document.status !== undefined) {
    summary.status = document.status;
  }
  if (document.scope !== undefined) {
    summary.scope = document.scope;
  }
  if (document.tags !== undefined) {
    summary.tags = [...document.tags];
  }
  return summary;
}

function matches(value: string | undefined, filter: string | undefined): boolean {
  return filter === undefined || value === filter;
}

function matchesAny(value: string | undefined, filters: string | string[] | undefined): boolean {
  if (filters === undefined) {
    return true;
  }
  const values = Array.isArray(filters) ? filters : [filters];
  return value !== undefined && values.includes(value);
}

function normalizeListLimit(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 50;
  }
  return Math.min(Math.max(Math.trunc(value), 1), 500);
}

function normalizeOffset(value: number | undefined): number {
  return value === undefined ? 0 : Math.max(value, 0);
}

function workspacePathFailure(error: WorkspacePathError, path: string): ReadDocumentResult & DocumentListResult {
  return fail(
    { code: error.code, message: error.message, details: { path } },
    createDiagnosticBag([{ severity: "error", code: error.code, message: error.message, path }])
  ) as ReadDocumentResult & DocumentListResult;
}
