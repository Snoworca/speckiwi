import { access, readdir } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";
import type { Diagnostic, DiagnosticBag, DocumentType, JsonObject, JsonValue } from "../core/dto.js";
import { createDiagnosticBag } from "../core/result.js";
import { loadYamlDocument } from "../io/yaml-loader.js";
import { createRealPathGuard, normalizeStorePath, resolveStorePath, type RealPathGuard, type WorkspaceRoot } from "../io/path.js";
import { schemaKindFromVersion, validateAgainstSchemaDiagnostics, type SchemaKind } from "../schema/compile.js";
import { normalizeExactKey } from "../search/tokenizer.js";
import { diagnostic, diagnosticsToBag, workspacePath } from "./diagnostics.js";

export type ManifestDocumentEntry = {
  id: string;
  type: DocumentType;
  path: string;
  index: number;
  scope?: string;
};

export type LoadedSpecDocument = {
  storePath: string;
  raw: string;
  value: JsonObject | undefined;
  schemaKind: SchemaKind | undefined;
  schemaValid: boolean;
  yamlValid: boolean;
};

export type LoadedWorkspace = {
  root: WorkspaceRoot;
  documents: LoadedSpecDocument[];
  manifestEntries: ManifestDocumentEntry[];
  diagnostics: DiagnosticBag;
};

const contentKinds = new Set<SchemaKind>(["overview", "dictionary", "srs", "prd", "technical", "adr", "rule", "prose"]);
const requirementIdPattern = /^[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)*-\d+$/;
const externalUriPattern = /^[a-z][a-z0-9+\-.]*:\S/i;

export async function loadWorkspaceForValidation(root: WorkspaceRoot): Promise<LoadedWorkspace> {
  const diagnostics: Diagnostic[] = [];
  const workspaceExists = await pathExists(root.speckiwiPath);

  if (!workspaceExists) {
    diagnostics.push(
      diagnostic({
        code: "MISSING_INDEX",
        message: "Missing .speckiwi/index.yaml.",
        path: workspacePath("index.yaml")
      }),
      diagnostic({
        code: "MISSING_OVERVIEW",
        message: "Missing .speckiwi/overview.yaml.",
        path: workspacePath("overview.yaml")
      })
    );
    return { root, documents: [], manifestEntries: [], diagnostics: createDiagnosticBag(diagnostics) };
  }

  if (!(await pathExists(resolve(root.speckiwiPath, "index.yaml")))) {
    diagnostics.push(
      diagnostic({
        code: "MISSING_INDEX",
        message: "Missing .speckiwi/index.yaml.",
        path: workspacePath("index.yaml")
      })
    );
  }

  if (!(await pathExists(resolve(root.speckiwiPath, "overview.yaml")))) {
    diagnostics.push(
      diagnostic({
        code: "MISSING_OVERVIEW",
        message: "Missing .speckiwi/overview.yaml.",
        path: workspacePath("overview.yaml")
      })
    );
  }

  const realPathGuard = await createRealPathGuard(root);
  const storePaths = await listYamlStorePaths(root);
  const documents = await Promise.all(storePaths.map((storePath) => loadDocument(root, storePath, realPathGuard)));

  for (const document of documents) {
    diagnostics.push(...document.diagnostics);
  }

  const loadedDocuments: LoadedSpecDocument[] = documents.map((document) => ({
    storePath: document.storePath,
    raw: document.raw,
    value: document.value,
    schemaKind: undefined,
    schemaValid: false,
    yamlValid: document.yamlValid
  }));

  const byPath = new Map(loadedDocuments.map((document) => [document.storePath, document]));
  const indexDocument = byPath.get("index.yaml");
  let manifestEntries: ManifestDocumentEntry[] = [];

  if (indexDocument?.yamlValid === true && indexDocument.value !== undefined) {
    const schemaDiagnostics = validateAgainstSchemaDiagnostics("index", indexDocument.value, workspacePath(indexDocument.storePath));
    diagnostics.push(...schemaDiagnostics);
    indexDocument.schemaKind = "index";
    indexDocument.schemaValid = schemaDiagnostics.length === 0;
    if (indexDocument.schemaValid) {
      manifestEntries = readManifestEntries(indexDocument.value);
    }
  }

  const manifestByPath = new Map(manifestEntries.map((entry) => [entry.path, entry]));

  for (const document of loadedDocuments) {
    if (!document.yamlValid || document.value === undefined || document.storePath === "index.yaml" || isIgnoredStorePath(document.storePath)) {
      continue;
    }

    const schemaKind = schemaKindForDocument(document, manifestByPath);
    if (schemaKind === undefined) {
      const schemaVersion = document.value.schemaVersion;
      diagnostics.push(
        diagnostic({
          code: typeof schemaVersion === "undefined" ? "MISSING_SCHEMA_VERSION" : "UNSUPPORTED_SCHEMA_VERSION",
          message: typeof schemaVersion === "undefined" ? "Missing schemaVersion." : `Unsupported schemaVersion: ${String(schemaVersion)}.`,
          path: workspacePath(document.storePath)
        })
      );
      continue;
    }

    const schemaDiagnostics = validateAgainstSchemaDiagnostics(schemaKind, document.value, workspacePath(document.storePath));
    diagnostics.push(...schemaDiagnostics);
    document.schemaKind = schemaKind;
    document.schemaValid = schemaDiagnostics.length === 0;
  }

  return {
    root,
    documents: loadedDocuments,
    manifestEntries,
    diagnostics: createDiagnosticBag(diagnostics)
  };
}

export function validateRegistry(workspace: LoadedWorkspace): DiagnosticBag {
  const diagnostics: Diagnostic[] = [];
  const documentsByPath = new Map(workspace.documents.map((document) => [document.storePath, document]));
  const registeredPaths = new Set<string>();
  const documentIds = new Set<string>();

  validateManifestEntries(workspace, documentsByPath, registeredPaths, documentIds, diagnostics);
  validateSrsPrimaryScopes(workspace, documentsByPath, diagnostics);
  validateUnregisteredContent(workspace, registeredPaths, diagnostics);
  validateLargeDocuments(workspace, diagnostics);
  validateDictionaryEntries(workspace, diagnostics);

  const scopeParents = validateScopes(workspace, diagnostics);
  const requirementRegistry = validateRequirements(workspace, scopeParents, documentIds, diagnostics);
  validateDocumentLinks(workspace, documentIds, diagnostics);
  validatePrdAndTechnicalReferences(workspace, requirementRegistry.ids, diagnostics);

  return diagnosticsToBag(diagnostics);
}

function validateManifestEntries(
  workspace: LoadedWorkspace,
  documentsByPath: Map<string, LoadedSpecDocument>,
  registeredPaths: Set<string>,
  documentIds: Set<string>,
  diagnostics: Diagnostic[]
): void {
  const seenIds = new Map<string, ManifestDocumentEntry>();
  const seenPaths = new Map<string, ManifestDocumentEntry>();

  for (const entry of workspace.manifestEntries) {
    const normalizedPath = normalizeManifestPath(entry, diagnostics);
    if (normalizedPath === undefined) {
      continue;
    }

    registeredPaths.add(normalizedPath);

    if (seenIds.has(entry.id)) {
      diagnostics.push(
        diagnostic({
          code: "DUPLICATE_DOCUMENT_ID",
          message: `Duplicate document id in index: ${entry.id}.`,
          path: workspacePath("index.yaml"),
          details: { id: entry.id, firstPath: seenIds.get(entry.id)?.path ?? "", duplicatePath: entry.path }
        })
      );
    } else {
      seenIds.set(entry.id, entry);
    }

    if (seenPaths.has(normalizedPath)) {
      diagnostics.push(
        diagnostic({
          code: "DUPLICATE_DOCUMENT_PATH",
          message: `Duplicate document path in index: ${normalizedPath}.`,
          path: workspacePath("index.yaml"),
          details: { path: normalizedPath }
        })
      );
    } else {
      seenPaths.set(normalizedPath, entry);
    }

    documentIds.add(entry.id);
    const document = documentsByPath.get(normalizedPath);
    if (document === undefined) {
      diagnostics.push(
        diagnostic({
          code: "DOCUMENT_PATH_NOT_FOUND",
          message: `Registered document path does not exist: ${normalizedPath}.`,
          path: workspacePath("index.yaml"),
          details: { documentId: entry.id, documentPath: normalizedPath }
        })
      );
      continue;
    }

    if (document.value === undefined) {
      continue;
    }

    const yamlId = stringValue(document.value.id);
    const yamlType = stringValue(document.value.type);
    const schemaVersion = stringValue(document.value.schemaVersion);

    if (yamlId !== undefined && yamlId !== entry.id) {
      diagnostics.push(
        diagnostic({
          code: "DOCUMENT_ID_MISMATCH",
          message: `Index document id ${entry.id} does not match YAML id ${yamlId}.`,
          path: workspacePath(normalizedPath),
          details: { expected: entry.id, actual: yamlId }
        })
      );
    }

    if (yamlType !== undefined && yamlType !== entry.type) {
      diagnostics.push(
        diagnostic({
          code: "DOCUMENT_TYPE_MISMATCH",
          message: `Index document type ${entry.type} does not match YAML type ${yamlType}.`,
          path: workspacePath(normalizedPath),
          details: { expected: entry.type, actual: yamlType }
        })
      );
    }

    const expectedSchemaVersion = `speckiwi/${entry.type}/v1`;
    if (schemaVersion !== undefined && schemaVersion !== expectedSchemaVersion) {
      diagnostics.push(
        diagnostic({
          code: "SCHEMA_VERSION_TYPE_MISMATCH",
          message: `YAML schemaVersion must be ${expectedSchemaVersion}.`,
          path: workspacePath(normalizedPath),
          details: { expected: expectedSchemaVersion, actual: schemaVersion }
        })
      );
    }
  }

  for (const document of workspace.documents) {
    if (document.schemaValid && isContentKind(document.schemaKind) && document.value !== undefined) {
      const id = stringValue(document.value.id);
      if (id === undefined) {
        continue;
      }
      if (documentIds.has(id) && !workspace.manifestEntries.some((entry) => entry.id === id && entry.path === document.storePath)) {
        diagnostics.push(
          diagnostic({
            code: "DUPLICATE_DOCUMENT_ID",
            message: `Duplicate document id: ${id}.`,
            path: workspacePath(document.storePath),
            details: { id }
          })
        );
      }
      documentIds.add(id);
    }
  }
}

function validateUnregisteredContent(workspace: LoadedWorkspace, registeredPaths: Set<string>, diagnostics: Diagnostic[]): void {
  if (!workspace.documents.some((document) => document.storePath === "index.yaml" && document.schemaValid)) {
    return;
  }

  for (const document of workspace.documents) {
    if (
      document.storePath === "index.yaml" ||
      document.storePath.startsWith("proposals/") ||
      isIgnoredStorePath(document.storePath) ||
      registeredPaths.has(document.storePath) ||
      !isPotentialContentDocument(document)
    ) {
      continue;
    }

    diagnostics.push(
      diagnostic({
        code: "UNREGISTERED_CONTENT_DOCUMENT",
        message: `Content YAML is not registered in index.documents: ${document.storePath}.`,
        path: workspacePath(document.storePath),
        details: { path: document.storePath }
      })
    );
  }
}

function validateSrsPrimaryScopes(
  workspace: LoadedWorkspace,
  documentsByPath: Map<string, LoadedSpecDocument>,
  diagnostics: Diagnostic[]
): void {
  for (const entry of workspace.manifestEntries) {
    if (entry.type !== "srs" || entry.scope === undefined) {
      continue;
    }

    const document = documentsByPath.get(entry.path);
    const yamlScope = stringValue(document?.value?.scope);
    if (yamlScope !== undefined && yamlScope !== entry.scope) {
      diagnostics.push(
        diagnostic({
          code: "SRS_SCOPE_MISMATCH",
          message: `Index SRS scope ${entry.scope} does not match YAML scope ${yamlScope}.`,
          path: workspacePath(entry.path),
          details: { documentId: entry.id, path: entry.path, indexScope: entry.scope, yamlScope }
        })
      );
    }
  }

  const firstDocumentByScope = new Map<string, { documentId: string; path: string }>();
  const manifestByPath = new Map(workspace.manifestEntries.map((entry) => [entry.path, entry]));

  for (const document of workspace.documents) {
    if (document.schemaKind !== "srs" || document.value === undefined) {
      continue;
    }

    const scope = stringValue(document.value.scope);
    if (scope === undefined) {
      continue;
    }

    const manifestEntry = manifestByPath.get(document.storePath);
    const documentId = manifestEntry?.id ?? stringValue(document.value.id) ?? document.storePath;
    const firstDocument = firstDocumentByScope.get(scope);
    if (firstDocument !== undefined && firstDocument.path !== document.storePath) {
      diagnostics.push(
        diagnostic({
          code: "DUPLICATE_SRS_PRIMARY_SCOPE",
          message: `SRS primary scope is used by multiple documents: ${scope}.`,
          path: workspacePath(document.storePath),
          details: {
            scope,
            firstDocumentId: firstDocument.documentId,
            firstPath: firstDocument.path,
            duplicateDocumentId: documentId,
            duplicatePath: document.storePath
          }
        })
      );
      continue;
    }

    firstDocumentByScope.set(scope, { documentId, path: document.storePath });
  }
}

function validateLargeDocuments(workspace: LoadedWorkspace, diagnostics: Diagnostic[]): void {
  for (const document of workspace.documents) {
    if (document.raw.length > 256 * 1024) {
      diagnostics.push(
        diagnostic({
          code: "LARGE_DOCUMENT",
          message: `YAML document exceeds 256 KiB: ${document.storePath}.`,
          severity: "warning",
          path: workspacePath(document.storePath),
          details: { bytes: document.raw.length }
        })
      );
    }
  }
}

function validateDictionaryEntries(workspace: LoadedWorkspace, diagnostics: Diagnostic[]): void {
  for (const document of workspace.documents) {
    if (!document.schemaValid || document.schemaKind !== "dictionary" || document.value === undefined) {
      continue;
    }

    const synonyms = jsonObjectValue(document.value.synonyms);
    if (synonyms === undefined) {
      continue;
    }

    const graph = new Map<string, string[]>();
    for (const [key, values] of Object.entries(synonyms).sort(([left], [right]) => left.localeCompare(right))) {
      const from = normalizeDictionaryTerm(key);
      if (from === undefined) {
        continue;
      }

      const targets = graph.get(from) ?? [];
      graph.set(from, targets);
      for (const value of stringArray(values)) {
        const to = normalizeDictionaryTerm(value);
        if (to === undefined) {
          continue;
        }
        if (!targets.includes(to)) {
          targets.push(to);
        }
        if (!graph.has(to)) {
          graph.set(to, []);
        }
      }
    }

    for (const cycle of findCycles(graph)) {
      diagnostics.push(
        diagnostic({
          code: "DICTIONARY_SYNONYM_CYCLE",
          message: `Dictionary synonym cycle detected: ${cycle.join(" -> ")}.`,
          path: workspacePath(document.storePath),
          details: { cycle }
        })
      );
    }
  }
}

function validateScopes(workspace: LoadedWorkspace, diagnostics: Diagnostic[]): Map<string, string | undefined> {
  const index = workspace.documents.find((document) => document.storePath === "index.yaml" && document.schemaValid)?.value;
  const scopeParents = new Map<string, string | undefined>();
  if (index === undefined) {
    return scopeParents;
  }

  const scopes = arrayValue(index.scopes);
  for (const scope of scopes) {
    const id = stringValue(scope.id);
    if (id === undefined) {
      continue;
    }

    if (scopeParents.has(id)) {
      diagnostics.push(
        diagnostic({
          code: "DUPLICATE_SCOPE_ID",
          message: `Duplicate scope id: ${id}.`,
          path: workspacePath("index.yaml"),
          details: { id }
        })
      );
    }
    scopeParents.set(id, stringValue(scope.parent));
  }

  for (const [id, parent] of scopeParents) {
    if (parent !== undefined && !scopeParents.has(parent)) {
      diagnostics.push(
        diagnostic({
          code: "SCOPE_PARENT_NOT_FOUND",
          message: `Scope parent not found for ${id}: ${parent}.`,
          path: workspacePath("index.yaml"),
          details: { id, parent }
        })
      );
    }
  }

  for (const cycle of findCycles(scopeParentsToGraph(scopeParents))) {
    diagnostics.push(
      diagnostic({
        code: "SCOPE_PARENT_CYCLE",
        message: `Scope parent cycle detected: ${cycle.join(" -> ")}.`,
        path: workspacePath("index.yaml"),
        details: { cycle }
      })
    );
  }

  return scopeParents;
}

function validateRequirements(
  workspace: LoadedWorkspace,
  scopeParents: Map<string, string | undefined>,
  documentIds: Set<string>,
  diagnostics: Diagnostic[]
): { ids: Set<string>; dependsOn: Map<string, string[]> } {
  const ids = new Set<string>();
  const firstPathById = new Map<string, string>();
  const dependsOn = new Map<string, string[]>();
  const requirementEntries: { id: string; path: string; requirement: JsonObject }[] = [];

  for (const document of workspace.documents) {
    if (!document.schemaValid || document.schemaKind !== "srs" || document.value === undefined) {
      continue;
    }

    const scope = stringValue(document.value.scope);
    if (scope !== undefined && !scopeParents.has(scope)) {
      diagnostics.push(
        diagnostic({
          code: "SCOPE_PARENT_NOT_FOUND",
          message: `SRS scope is not declared in index.scopes: ${scope}.`,
          path: workspacePath(document.storePath),
          details: { scope }
        })
      );
    }

    for (const requirement of arrayValue(document.value.requirements)) {
      const id = stringValue(requirement.id);
      if (id === undefined) {
        continue;
      }

      requirementEntries.push({ id, path: document.storePath, requirement });
      if (ids.has(id)) {
        diagnostics.push(
          diagnostic({
            code: "DUPLICATE_REQUIREMENT_ID",
            message: `Duplicate requirement id: ${id}.`,
            path: workspacePath(document.storePath),
            details: { id, firstPath: firstPathById.get(id) ?? "" }
          })
        );
      } else {
        ids.add(id);
        firstPathById.set(id, document.storePath);
      }

      if (arrayValue(requirement.acceptanceCriteria).length === 0) {
        diagnostics.push(
          diagnostic({
            code: "MISSING_ACCEPTANCE_CRITERIA",
            message: `Requirement is missing acceptanceCriteria: ${id}.`,
            severity: "warning",
            path: workspacePath(document.storePath),
            details: { id }
          })
        );
      }

      if (typeof requirement.rationale !== "string" || requirement.rationale.trim().length === 0) {
        diagnostics.push(
          diagnostic({
            code: "MISSING_RATIONALE",
            message: `Requirement is missing rationale: ${id}.`,
            severity: "warning",
            path: workspacePath(document.storePath),
            details: { id }
          })
        );
      }

      const statement = stringValue(requirement.statement) ?? "";
      if (statement.trim().length < 20 || !/(해야 한다|shall|must)/i.test(statement)) {
        diagnostics.push(
          diagnostic({
            code: "WEAK_REQUIREMENT_STATEMENT",
            message: `Requirement statement is weak or not verifiable: ${id}.`,
            severity: "warning",
            path: workspacePath(document.storePath),
            details: { id }
          })
        );
      }
    }
  }

  for (const entry of requirementEntries) {
    const targets: string[] = [];
    for (const relation of arrayValue(entry.requirement.relations)) {
      const target = stringValue(relation.target);
      const type = stringValue(relation.type);
      const targetType = stringValue(relation.targetType) ?? "requirement";
      if (target === undefined) {
        continue;
      }

      if (targetType === "external") {
        if (!externalUriPattern.test(target)) {
          diagnostics.push(
            diagnostic({
              code: "INVALID_EXTERNAL_RELATION_TARGET",
              message: `External relation target must be a URI with a scheme prefix: ${target}.`,
              path: workspacePath(entry.path),
              details: { id: entry.id, relationType: type ?? "", target }
            })
          );
        }
      } else if (targetType === "document") {
        if (!documentIds.has(target)) {
          diagnostics.push(
            diagnostic({
              code: "UNKNOWN_DOCUMENT_RELATION_TARGET",
              message: `Requirement relation document target not found: ${target}.`,
              path: workspacePath(entry.path),
              details: { id: entry.id, relationType: type ?? "", target }
            })
          );
        }
      } else {
        if (target === entry.id) {
          diagnostics.push(
            diagnostic({
              code: "SELF_RELATION",
              message: `Requirement must not reference itself: ${entry.id}.`,
              path: workspacePath(entry.path),
              details: { id: entry.id, relationType: type ?? "", target }
            })
          );
        } else if (!ids.has(target)) {
          diagnostics.push(
            diagnostic({
              code: "UNKNOWN_REQUIREMENT_RELATION_TARGET",
              message: `Requirement relation target not found: ${target}.`,
              path: workspacePath(entry.path),
              details: { id: entry.id, relationType: type ?? "", target }
            })
          );
        }

        if (type === "depends_on") {
          targets.push(target);
        }
      }
    }
    dependsOn.set(entry.id, [...(dependsOn.get(entry.id) ?? []), ...targets]);
  }

  for (const cycle of findCycles(dependsOn)) {
    diagnostics.push(
      diagnostic({
        code: "DEPENDS_ON_CYCLE",
        message: `Requirement depends_on cycle detected: ${cycle.join(" -> ")}.`,
        path: workspacePath(firstPathById.get(cycle[0] ?? "") ?? "index.yaml"),
        details: { cycle }
      })
    );
  }

  return { ids, dependsOn };
}

function validateDocumentLinks(workspace: LoadedWorkspace, documentIds: Set<string>, diagnostics: Diagnostic[]): void {
  const index = workspace.documents.find((document) => document.storePath === "index.yaml" && document.schemaValid)?.value;
  if (index === undefined) {
    return;
  }

  for (const link of arrayValue(index.links)) {
    for (const endpoint of ["from", "to"] as const) {
      const target = stringValue(link[endpoint]);
      if (target !== undefined && !documentIds.has(target)) {
        diagnostics.push(
          diagnostic({
            code: "UNKNOWN_DOCUMENT_LINK_TARGET",
            message: `Document link ${endpoint} target not found: ${target}.`,
            path: workspacePath("index.yaml"),
            details: { endpoint, target }
          })
        );
      }
    }
  }
}

function validatePrdAndTechnicalReferences(workspace: LoadedWorkspace, requirementIds: Set<string>, diagnostics: Diagnostic[]): void {
  for (const document of workspace.documents) {
    if (!document.schemaValid || document.value === undefined) {
      continue;
    }

    if (document.schemaKind === "prd") {
      validatePrdItemIds(document, diagnostics);
      for (const item of arrayValue(document.value.items)) {
        for (const link of arrayValue(item.links)) {
          const target = stringValue(link.target);
          const targetType = stringValue(link.targetType);
          if (target !== undefined && targetType !== "external" && requirementIdPattern.test(target) && !requirementIds.has(target)) {
            diagnostics.push(
              diagnostic({
                code: "UNKNOWN_REQUIREMENT_RELATION_TARGET",
                message: `PRD item link target not found: ${target}.`,
                path: workspacePath(document.storePath),
                details: { target }
              })
            );
          }
        }
      }
    }

    if (document.schemaKind === "technical") {
      for (const target of arrayValue(document.value.implements).map((value) => stringValue(value)).filter(isString)) {
        if (requirementIdPattern.test(target) && !requirementIds.has(target)) {
          diagnostics.push(
            diagnostic({
              code: "UNKNOWN_REQUIREMENT_RELATION_TARGET",
              message: `Technical implements target not found: ${target}.`,
              path: workspacePath(document.storePath),
              details: { target }
            })
          );
        }
      }
    }
  }
}

function validatePrdItemIds(document: LoadedSpecDocument, diagnostics: Diagnostic[]): void {
  const firstItemIndexById = new Map<string, number>();

  for (const [index, item] of arrayValue(document.value?.items).entries()) {
    const id = stringValue(item.id);
    if (id === undefined) {
      continue;
    }

    const firstItemIndex = firstItemIndexById.get(id);
    if (firstItemIndex !== undefined) {
      diagnostics.push(
        diagnostic({
          code: "DUPLICATE_PRD_ITEM_ID",
          message: `Duplicate PRD item id: ${id}.`,
          path: workspacePath(document.storePath),
          details: { id, firstItemIndex, duplicateItemIndex: index }
        })
      );
    } else {
      firstItemIndexById.set(id, index);
    }
  }
}

async function loadDocument(root: WorkspaceRoot, storePath: string, guard: RealPathGuard): Promise<{
  storePath: string;
  raw: string;
  value: JsonObject | undefined;
  yamlValid: boolean;
  diagnostics: Diagnostic[];
}> {
  const workspacePathValue = resolveStorePath(root, normalizeStorePath(storePath));
  const loaded = await loadYamlDocument(workspacePathValue, guard);
  const diagnostics: Diagnostic[] = [...loaded.diagnostics.errors, ...loaded.diagnostics.warnings, ...loaded.diagnostics.infos].map((item): Diagnostic => ({
    ...item,
    path: workspacePath(item.path ?? storePath)
  }));
  const value = isJsonObject(loaded.value) ? loaded.value : undefined;

  if (loaded.diagnostics.summary.errorCount === 0 && loaded.value !== undefined && value === undefined) {
    diagnostics.push(
      diagnostic({
        code: "SCHEMA_VALIDATION_FAILED",
        message: "SpecKiwi YAML document must be a top-level object.",
        path: workspacePath(storePath)
      })
    );
  }

  return {
    storePath,
    raw: loaded.raw,
    value,
    yamlValid: loaded.diagnostics.summary.errorCount === 0,
    diagnostics
  };
}

async function listYamlStorePaths(root: WorkspaceRoot): Promise<string[]> {
  const paths: string[] = [];

  async function visit(directory: string): Promise<void> {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const absolutePath = resolve(directory, entry.name);
      const storePath = toStorePath(root, absolutePath);
      if (entry.isDirectory()) {
        if (!isIgnoredStorePath(storePath)) {
          await visit(absolutePath);
        }
      } else if (entry.isFile() && entry.name.endsWith(".yaml") && !isIgnoredStorePath(storePath)) {
        paths.push(storePath);
      }
    }
  }

  await visit(root.speckiwiPath);
  return paths.sort();
}

function toStorePath(root: WorkspaceRoot, absolutePath: string): string {
  return relative(root.speckiwiPath, absolutePath).split(sep).join("/");
}

function readManifestEntries(index: JsonObject): ManifestDocumentEntry[] {
  return arrayValue(index.documents).flatMap((entry, index) => {
    const id = stringValue(entry.id);
    const type = stringValue(entry.type);
    const path = stringValue(entry.path);
    if (id === undefined || path === undefined || !isContentDocumentType(type)) {
      return [];
    }
    const manifestEntry: ManifestDocumentEntry = { id, type, path, index };
    const scope = stringValue(entry.scope);
    if (scope !== undefined) {
      manifestEntry.scope = scope;
    }
    return [manifestEntry];
  });
}

function schemaKindForDocument(document: LoadedSpecDocument, manifestByPath: Map<string, ManifestDocumentEntry>): SchemaKind | undefined {
  if (document.storePath.startsWith("proposals/")) {
    return "proposal";
  }

  const manifestEntry = manifestByPath.get(document.storePath);
  if (manifestEntry !== undefined) {
    return manifestEntry.type;
  }

  return schemaKindFromVersion(document.value?.schemaVersion);
}

function normalizeManifestPath(entry: ManifestDocumentEntry, diagnostics: Diagnostic[]): string | undefined {
  try {
    const normalized = normalizeStorePath(entry.path);
    return normalized as string;
  } catch {
    const code = entry.path.includes("..") ? "PATH_TRAVERSAL" : "PATH_OUTSIDE_WORKSPACE";
    diagnostics.push(
      diagnostic({
        code,
        message: `Document path is not a safe .speckiwi relative path: ${entry.path}.`,
        path: workspacePath("index.yaml"),
        details: { documentId: entry.id, documentPath: entry.path }
      })
    );
    return undefined;
  }
}

function isPotentialContentDocument(document: LoadedSpecDocument): boolean {
  if (isContentKind(document.schemaKind)) {
    return true;
  }

  if (document.value !== undefined && isContentKind(schemaKindFromVersion(document.value.schemaVersion))) {
    return true;
  }

  return (
    document.storePath === "overview.yaml" ||
    document.storePath === "dictionary.yaml" ||
    document.storePath.startsWith("prd/") ||
    document.storePath.startsWith("srs/") ||
    document.storePath.startsWith("tech/") ||
    document.storePath.startsWith("adr/") ||
    document.storePath.startsWith("rules/") ||
    document.storePath.startsWith("prose/")
  );
}

function isIgnoredStorePath(storePath: string): boolean {
  return storePath.startsWith("cache/") || storePath.startsWith("exports/") || storePath.startsWith("templates/");
}

function isContentKind(kind: SchemaKind | undefined): kind is DocumentType {
  return kind !== undefined && contentKinds.has(kind);
}

function isContentDocumentType(value: unknown): value is DocumentType {
  return (
    value === "overview" ||
    value === "dictionary" ||
    value === "srs" ||
    value === "prd" ||
    value === "technical" ||
    value === "adr" ||
    value === "rule" ||
    value === "prose"
  );
}

function scopeParentsToGraph(scopeParents: Map<string, string | undefined>): Map<string, string[]> {
  return new Map([...scopeParents.entries()].map(([id, parent]) => [id, parent === undefined ? [] : [parent]]));
}

function findCycles(graph: Map<string, string[]>): string[][] {
  const cycles = new Map<string, string[]>();

  for (const node of [...graph.keys()].sort()) {
    visitCycleNode(node, graph, [], cycles);
  }

  return [...cycles.values()].sort((left, right) => left.join("\0").localeCompare(right.join("\0")));
}

function visitCycleNode(node: string, graph: Map<string, string[]>, stack: string[], cycles: Map<string, string[]>): void {
  const stackIndex = stack.indexOf(node);
  if (stackIndex !== -1) {
    const cycle = canonicalCycle(stack.slice(stackIndex));
    cycles.set(cycle.join("\0"), cycle);
    return;
  }

  if (!graph.has(node)) {
    return;
  }

  const nextStack = [...stack, node];
  for (const next of [...(graph.get(node) ?? [])].sort()) {
    visitCycleNode(next, graph, nextStack, cycles);
  }
}

function canonicalCycle(cycle: string[]): string[] {
  if (cycle.length === 0) {
    return cycle;
  }

  let best = cycle;
  for (let index = 1; index < cycle.length; index += 1) {
    const rotated = [...cycle.slice(index), ...cycle.slice(0, index)];
    if (rotated.join("\0").localeCompare(best.join("\0")) < 0) {
      best = rotated;
    }
  }
  return [...best, best[0] ?? ""];
}

function arrayValue(value: JsonValue | undefined): JsonObject[] {
  return Array.isArray(value) ? value.filter(isJsonObject) : [];
}

function stringValue(value: JsonValue | undefined): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function jsonObjectValue(value: JsonValue | undefined): JsonObject | undefined {
  return isJsonObject(value) ? value : undefined;
}

function stringArray(value: JsonValue | undefined): string[] {
  return Array.isArray(value) ? value.filter(isString) : [];
}

function normalizeDictionaryTerm(value: string): string | undefined {
  const normalized = normalizeExactKey(value).replace(/\s+/g, " ");
  return normalized.length > 0 ? normalized : undefined;
}

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}
