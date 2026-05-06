import { stat } from "node:fs/promises";
import { resolve } from "node:path";
import type {
  Diagnostic,
  DiagnosticBag,
  DocumentSummary,
  DocumentType,
  JsonObject,
  JsonValue,
  RequirementIdPreviewResult,
  RequirementListResult,
  RequirementRelation,
  RequirementResult,
  RequirementSummary,
  RequirementType
} from "./dto.js";
import type { GenerateRequirementIdInput, GetRequirementInput, ListRequirementsInput, RootInput } from "./inputs.js";
import { createDiagnosticBag, fail, ok } from "./result.js";
import { loadReadModel, type ReadModel } from "./read-model.js";
import { normalizeStorePath, resolveRealStorePath } from "../io/path.js";
import { workspaceRootFromPath } from "../io/workspace.js";
import type { LoadedSpecDocument, LoadedWorkspace } from "../validate/semantic.js";
import { isIndexSectionFresh, readCacheManifest } from "../cache/manifest.js";
import { sha256File, stableJson } from "../cache/hash.js";
import { hasManifestFormat, type IndexManifestV2 } from "../cache/index-manifest.js";
import { readArtifact } from "../indexing/serialization.js";
import {
  deserializeEntityIndex,
  deserializeRequirementPayloadShard,
  requirementPayloadShardStorePath,
  type RuntimeEntityIndex
} from "../indexing/entities.js";
import { deserializeRelationIndex, type RuntimeRelationIndex } from "../indexing/relations.js";
import { loadYamlDocument } from "../io/yaml-loader.js";

const manifestCache = new Map<string, { sha256: string; manifest: Awaited<ReturnType<typeof readCacheManifest>> }>();
const entityIndexCache = new Map<string, { sha256: string; artifact: RuntimeEntityIndex }>();
const requirementShardCache = new Map<
  string,
  { sha256: string; artifact: Exclude<ReturnType<typeof deserializeRequirementPayloadShard>, undefined> }
>();
const sourceConfirmationCache = new Map<string, { ok: true; requirement: RegisteredRequirement; document?: RegisteredDocument }>();
const SOURCE_CONFIRMATION_CACHE_LIMIT = 1024;

export type RegisteredDocument = DocumentSummary & {
  index: number;
  value?: JsonObject;
};

export type RegisteredScope = {
  id: string;
  index: number;
  tags: string[];
  name?: string;
  type?: string;
  parent?: string;
  description?: string;
};

export type RegisteredRequirement = RequirementSummary & {
  requirement: JsonObject;
  relations: RequirementRelation[];
};

export type RegisteredDocumentLink = {
  from: string;
  to: string;
  type: string;
  description?: string;
};

export type RequirementRegistry = {
  project: {
    id: string;
    name?: string;
    language?: string;
  };
  documents: RegisteredDocument[];
  scopes: RegisteredScope[];
  documentLinks: RegisteredDocumentLink[];
  requirements: RegisteredRequirement[];
  documentsById: Map<string, RegisteredDocument>;
  documentsByPath: Map<string, RegisteredDocument>;
  scopesById: Map<string, RegisteredScope>;
  requirementsById: Map<string, RegisteredRequirement>;
  incomingRelationsById: Map<string, RequirementRelation[]>;
  outgoingRelationsById: Map<string, RequirementRelation[]>;
};

const requirementTypePrefixes: Record<RequirementType, string> = {
  functional: "FR",
  non_functional: "NFR",
  interface: "IR",
  data: "DR",
  constraint: "CON",
  security: "SEC",
  performance: "PERF",
  reliability: "REL",
  usability: "UX",
  maintainability: "MAINT",
  operational: "OPS",
  compliance: "COMP",
  migration: "MIG",
  observability: "OBS"
};

export async function loadRequirementRegistry(input: RootInput = {}): Promise<RequirementRegistry> {
  const model = await loadReadModel({
    root: resolve(input.root ?? process.cwd()),
    ...(input.cacheMode === undefined ? {} : { cacheMode: input.cacheMode }),
    sections: ["entities", "relations"]
  });
  return model.getRequirementRegistry();
}

export function buildRequirementRegistry(workspace: LoadedWorkspace): RequirementRegistry {
  const index = workspace.documents.find((document) => document.storePath === "index.yaml" && document.schemaValid)?.value;
  const documentsByStorePath = new Map(workspace.documents.map((document) => [document.storePath, document]));
  const documents = buildDocuments(workspace, documentsByStorePath);
  const scopes = buildScopes(index);
  const documentLinks = buildDocumentLinks(index);
  const requirements = buildRequirements(workspace, documentsByStorePath);
  const documentsById = new Map(documents.map((document) => [document.id, document]));
  const documentsByPath = new Map(documents.map((document) => [document.path, document]));
  const scopesById = new Map(scopes.map((scope) => [scope.id, scope]));
  const requirementsById = new Map(requirements.map((requirement) => [requirement.id, requirement]));
  const incomingRelationsById = new Map<string, RequirementRelation[]>();
  const outgoingRelationsById = new Map<string, RequirementRelation[]>();

  for (const requirement of requirements) {
    outgoingRelationsById.set(requirement.id, sortRelations(requirement.relations));
    if (!incomingRelationsById.has(requirement.id)) {
      incomingRelationsById.set(requirement.id, []);
    }
  }

  for (const requirement of requirements) {
    for (const relation of requirement.relations) {
      const incoming = incomingRelationsById.get(relation.target) ?? [];
      incoming.push({ ...relation, source: requirement.id });
      incomingRelationsById.set(relation.target, incoming);
    }
  }

  for (const [id, relations] of incomingRelationsById) {
    incomingRelationsById.set(id, sortRelations(relations));
  }

  return {
    project: readProject(index),
    documents,
    scopes,
    documentLinks,
    requirements,
    documentsById,
    documentsByPath,
    scopesById,
    requirementsById,
    incomingRelationsById,
    outgoingRelationsById
  };
}

export async function getRequirement(input: GetRequirementInput): Promise<RequirementResult> {
  const root = workspaceRootFromPath(resolve(input.root ?? process.cwd()));
  const cached = await getRequirementFromEntityCache(input, root);
  if (cached.result !== undefined) {
    return cached.result;
  }
  const model = await loadReadModel({
    root: root.rootPath,
    ...(input.cacheMode === undefined ? {} : { cacheMode: input.cacheMode }),
    sections: ["entities", "relations"]
  });
  return getRequirementFromRegistry(input, model.getRequirementRegistry(), createDiagnosticBag(cached.warnings));
}

export function getRequirementFromReadModel(input: GetRequirementInput, model: ReadModel): RequirementResult {
  return getRequirementFromRegistry(input, model.getRequirementRegistry());
}

export function getRequirementFromRegistry(
  input: GetRequirementInput,
  registry: RequirementRegistry,
  diagnostics: DiagnosticBag = createDiagnosticBag()
): RequirementResult {
  const requirement = registry.requirementsById.get(input.id);
  if (requirement === undefined) {
    return notFoundRequirement(input.id);
  }

  const payload: {
    requirement: JsonObject;
    document?: DocumentSummary;
    relations?: {
      incoming: RequirementRelation[];
      outgoing: RequirementRelation[];
    };
  } = {
    requirement: requirement.requirement
  };

  if (input.includeDocument === true) {
    const document = registry.documentsById.get(requirement.documentId);
    if (document !== undefined) {
      payload.document = documentSummary(document);
    }
  }

  if (input.includeRelations === true) {
    payload.relations = {
      incoming: registry.incomingRelationsById.get(input.id) ?? [],
      outgoing: registry.outgoingRelationsById.get(input.id) ?? []
    };
  }

  return ok(payload, diagnostics);
}

export async function listRequirements(input: ListRequirementsInput = {}): Promise<RequirementListResult> {
  const model = await loadReadModel({
    root: resolve(input.root ?? process.cwd()),
    ...(input.cacheMode === undefined ? {} : { cacheMode: input.cacheMode }),
    sections: ["entities", "relations"]
  });
  return listRequirementsFromReadModel(input, model);
}

export function listRequirementsFromReadModel(input: ListRequirementsInput, model: ReadModel): RequirementListResult {
  return listRequirementsFromRegistry(input, model.getRequirementRegistry());
}

export function listRequirementsFromRegistry(input: ListRequirementsInput, registry: RequirementRegistry): RequirementListResult {
  const filtered = registry.requirements.filter((requirement) => matchesRequirementFilters(requirement, input, registry));
  const limit = normalizeListLimit(input.limit);
  const offset = normalizeOffset(input.offset);
  const pageItems = filtered.slice(offset, offset + limit);

  return ok({
    requirements: pageItems.map(requirementSummary),
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

export function previewRequirementId(input: GenerateRequirementIdInput, registry: RequirementRegistry): RequirementIdPreviewResult {
  const prefix = requirementTypePrefixes[input.requirementType];
  const projectSegment = makeProjectSegment(registry.project.id);
  const scopeSegment = makeScopeSegment(input.scope);

  if (input.explicitId !== undefined && input.explicitId.trim().length > 0) {
    const explicitId = input.explicitId.trim();
    const diagnostics = assertExplicitRequirementId(explicitId, registry);
    if (diagnostics.summary.errorCount > 0) {
      return fail({ code: "DUPLICATE_REQUIREMENT_ID", message: `Requirement id already exists: ${explicitId}`, details: { id: explicitId } }, diagnostics);
    }
    return ok({
      id: explicitId,
      generated: false,
      prefix,
      projectSegment,
      scopeSegment,
      sequence: 0,
      formattedSequence: "0000",
      collisionCount: 0
    });
  }

  const idPrefix = `${prefix}-${projectSegment}-${scopeSegment}-`;
  const existingIds = new Set(registry.requirements.map((requirement) => requirement.id));
  const maxSequence = maxExistingSequence(existingIds, idPrefix);
  let sequence = maxSequence + 1;
  let collisionCount = 0;
  let id = formatRequirementId(idPrefix, sequence);

  while (existingIds.has(id)) {
    sequence += 1;
    collisionCount += 1;
    id = formatRequirementId(idPrefix, sequence);
  }

  return ok({
    id,
    generated: true,
    prefix,
    projectSegment,
    scopeSegment,
    sequence,
    formattedSequence: formatSequence(sequence),
    collisionCount
  });
}

export function assertExplicitRequirementId(id: string, registry: RequirementRegistry): DiagnosticBag {
  if (!registry.requirementsById.has(id)) {
    return createDiagnosticBag();
  }

  return createDiagnosticBag([
    {
      severity: "error",
      code: "DUPLICATE_REQUIREMENT_ID",
      message: `Requirement id already exists: ${id}.`,
      details: { id }
    }
  ]);
}

export function requirementSummary(requirement: RegisteredRequirement): RequirementSummary {
  const summary: RequirementSummary = {
    id: requirement.id,
    type: requirement.type,
    title: requirement.title,
    status: requirement.status,
    statement: requirement.statement,
    documentId: requirement.documentId,
    tags: [...requirement.tags],
    path: requirement.path
  };
  if (requirement.priority !== undefined) {
    summary.priority = requirement.priority;
  }
  if (requirement.scope !== undefined) {
    summary.scope = requirement.scope;
  }
  return summary;
}

function buildDocuments(workspace: LoadedWorkspace, documentsByStorePath: Map<string, LoadedSpecDocument>): RegisteredDocument[] {
  return workspace.manifestEntries
    .map((entry): RegisteredDocument | undefined => {
      const loaded = documentsByStorePath.get(entry.path);
      const value = loaded?.value;
      const document: RegisteredDocument = {
        id: entry.id,
        type: entry.type,
        path: entry.path,
        index: entry.index
      };
      const title = stringValue(value?.title);
      const status = stringValue(value?.status);
      const scope = stringValue(value?.scope) ?? stringValue(jsonObjectFromUnknown(entry).scope);
      const tags = tagsFrom(value?.tags).length > 0 ? tagsFrom(value?.tags) : tagsFrom(jsonObjectFromUnknown(entry).tags);
      if (title !== undefined) {
        document.title = title;
      }
      if (status !== undefined) {
        document.status = status;
      }
      if (scope !== undefined) {
        document.scope = scope;
      }
      if (tags.length > 0) {
        document.tags = tags;
      }
      if (value !== undefined) {
        document.value = value;
      }
      return document;
    })
    .filter(isDefined)
    .sort((left, right) => left.id.localeCompare(right.id) || left.path.localeCompare(right.path));
}

function buildScopes(index: JsonObject | undefined): RegisteredScope[] {
  return arrayObjects(index?.scopes)
    .map((scope, index): RegisteredScope | undefined => {
      const id = stringValue(scope.id);
      if (id === undefined) {
        return undefined;
      }
      const registered: RegisteredScope = {
        id,
        index,
        tags: tagsFrom(scope.tags)
      };
      const name = stringValue(scope.name);
      const type = stringValue(scope.type);
      const parent = stringValue(scope.parent);
      const description = stringValue(scope.description);
      if (name !== undefined) {
        registered.name = name;
      }
      if (type !== undefined) {
        registered.type = type;
      }
      if (parent !== undefined) {
        registered.parent = parent;
      }
      if (description !== undefined) {
        registered.description = description;
      }
      return registered;
    })
    .filter(isDefined)
    .sort((left, right) => left.id.localeCompare(right.id));
}

function buildDocumentLinks(index: JsonObject | undefined): RegisteredDocumentLink[] {
  return arrayObjects(index?.links)
    .map((link): RegisteredDocumentLink | undefined => {
      const from = stringValue(link.from);
      const to = stringValue(link.to);
      const type = stringValue(link.type);
      if (from === undefined || to === undefined || type === undefined) {
        return undefined;
      }
      const documentLink: RegisteredDocumentLink = { from, to, type };
      const description = stringValue(link.description);
      if (description !== undefined) {
        documentLink.description = description;
      }
      return documentLink;
    })
    .filter(isDefined)
    .sort((left, right) => left.from.localeCompare(right.from) || left.to.localeCompare(right.to) || left.type.localeCompare(right.type));
}

function buildRequirements(workspace: LoadedWorkspace, documentsByStorePath: Map<string, LoadedSpecDocument>): RegisteredRequirement[] {
  const manifestByPath = new Map(workspace.manifestEntries.map((entry) => [entry.path, entry]));
  const requirements: RegisteredRequirement[] = [];

  for (const document of workspace.documents) {
    if (!document.schemaValid || document.schemaKind !== "srs" || document.value === undefined) {
      continue;
    }

    const manifest = manifestByPath.get(document.storePath);
    const documentId = manifest?.id ?? stringValue(document.value.id) ?? document.storePath;
    const scope = stringValue(document.value.scope);

    for (const requirement of arrayObjects(document.value.requirements)) {
      const id = stringValue(requirement.id);
      if (id === undefined) {
        continue;
      }

      const entry: RegisteredRequirement = {
        id,
        type: stringValue(requirement.type) ?? "",
        title: stringValue(requirement.title) ?? "",
        status: stringValue(requirement.status) ?? "",
        statement: stringValue(requirement.statement) ?? "",
        documentId,
        tags: tagsFrom(requirement.tags),
        path: document.storePath,
        requirement,
        relations: relationsFrom(requirement.relations, id)
      };
      const priority = stringValue(requirement.priority);
      if (priority !== undefined) {
        entry.priority = priority;
      }
      if (scope !== undefined) {
        entry.scope = scope;
      }
      requirements.push(entry);
    }
  }

  void documentsByStorePath;
  return requirements.sort((left, right) => left.id.localeCompare(right.id) || left.documentId.localeCompare(right.documentId));
}

function relationsFrom(value: JsonValue | undefined, source: string): RequirementRelation[] {
  return arrayObjects(value)
    .map((relation): RequirementRelation | undefined => {
      const type = stringValue(relation.type);
      const target = stringValue(relation.target);
      if (type === undefined || target === undefined) {
        return undefined;
      }
      const item: RequirementRelation = { type, target, source };
      const targetType = stringValue(relation.targetType);
      if (targetType === "requirement" || targetType === "document" || targetType === "external") {
        item.targetType = targetType;
      }
      const anchor = stringValue(relation.anchor);
      if (anchor !== undefined) {
        item.anchor = anchor;
      }
      const excerpt = stringValue(relation.excerpt);
      if (excerpt !== undefined) {
        item.excerpt = excerpt;
      }
      const description = stringValue(relation.description);
      if (description !== undefined) {
        item.description = description;
      }
      return item;
    })
    .filter(isDefined)
    .sort((left, right) => left.type.localeCompare(right.type) || left.target.localeCompare(right.target) || (left.source ?? "").localeCompare(right.source ?? ""));
}

function sortRelations(relations: RequirementRelation[]): RequirementRelation[] {
  return [...relations].sort((left, right) => left.type.localeCompare(right.type) || left.target.localeCompare(right.target) || (left.source ?? "").localeCompare(right.source ?? ""));
}

function readProject(index: JsonObject | undefined): RequirementRegistry["project"] {
  const project = jsonObjectValue(index?.project);
  const result: RequirementRegistry["project"] = {
    id: stringValue(project?.id) ?? "project"
  };
  const name = stringValue(project?.name);
  const language = stringValue(project?.language);
  if (name !== undefined) {
    result.name = name;
  }
  if (language !== undefined) {
    result.language = language;
  }
  return result;
}

function documentSummary(document: RegisteredDocument): DocumentSummary {
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

function matchesRequirementFilters(requirement: RegisteredRequirement, input: ListRequirementsInput, registry: RequirementRegistry): boolean {
  return (
    matchesProjectFilter(registry.project, input.project) &&
    matchesFilter(requirement.scope, input.scope) &&
    matchesFilter(requirement.type, input.type) &&
    matchesFilter(requirement.status, input.status) &&
    matchesTagFilter(requirement.tags, input.tag) &&
    matchesFilter(requirement.documentId, input.documentId)
  );
}

function matchesProjectFilter(project: RequirementRegistry["project"], filter: string | string[] | undefined): boolean {
  if (filter === undefined) {
    return true;
  }
  const values = Array.isArray(filter) ? filter : [filter];
  return values.includes(project.id) || (project.name !== undefined && values.includes(project.name));
}

function matchesFilter(value: string | undefined, filter: string | string[] | undefined): boolean {
  if (filter === undefined) {
    return true;
  }
  const values = Array.isArray(filter) ? filter : [filter];
  return value !== undefined && values.includes(value);
}

function matchesTagFilter(tags: string[], filter: string | string[] | undefined): boolean {
  if (filter === undefined) {
    return true;
  }
  const values = Array.isArray(filter) ? filter : [filter];
  return values.some((tag) => tags.includes(tag));
}

function normalizeListLimit(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 50;
  }
  return Math.min(Math.max(Math.trunc(value), 1), 500);
}

function normalizeOffset(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 0;
  }
  return Math.max(Math.trunc(value), 0);
}

function notFoundRequirement(id: string): RequirementResult {
  const diagnostics = createDiagnosticBag([
    {
      severity: "error",
      code: "REQUIREMENT_NOT_FOUND",
      message: `Requirement not found: ${id}.`,
      details: { id }
    }
  ]);
  return fail({ code: "REQUIREMENT_NOT_FOUND", message: `Requirement not found: ${id}.`, details: { id } }, diagnostics);
}

async function getRequirementFromEntityCache(
  input: GetRequirementInput,
  root: ReturnType<typeof workspaceRootFromPath>
): Promise<{ result?: RequirementResult; warnings: Diagnostic[] }> {
  if (input.cacheMode === "bypass") {
    return { warnings: [] };
  }

  const entityArtifact = await readCachedEntityIndex(root);
  if (entityArtifact.artifact === undefined) {
    return {
      warnings: entityArtifact.warning === undefined ? [] : [toCacheWarning(entityArtifact.warning, "ENTITY_CACHE_UNREADABLE")]
    };
  }

  const summary = entityArtifact.artifact.requirementsById.get(input.id);
  if (summary === undefined) {
    return { warnings: [] };
  }
  const shardRef = entityArtifact.artifact.requirementShardsById.get(input.id);
  if (shardRef === undefined) {
    return {
      warnings: [cacheWarning("ENTITY_CACHE_UNREADABLE", "Entity cache could not resolve a requirement shard.", ".speckiwi/cache/entities.json")]
    };
  }
  if (!/^[a-f0-9]{64}$/.test(shardRef.documentHash)) {
    return {
      warnings: [
        cacheWarning(
          "REQUIREMENT_SHARD_UNREADABLE",
          "Requirement payload shard reference was invalid; source YAML data was used.",
          ".speckiwi/cache/entities.json",
          { id: input.id }
        )
      ]
    };
  }
  if (!(await isRequirementCacheFresh(root, summary.path, shardRef.documentHash))) {
    return { warnings: [] };
  }
  if (input.includeRelations === true && !(await isIndexSectionFresh(root, "relations"))) {
    return { warnings: [] };
  }

  const shardArtifact = await readCachedRequirementShard(root, shardRef.documentHash);
  if (shardArtifact.artifact === undefined) {
    return {
      warnings: [
        cacheWarning(
          "REQUIREMENT_SHARD_UNREADABLE",
          "Requirement payload shard could not be read; source YAML data was used.",
          `.speckiwi/${requirementPayloadShardStorePath(shardRef.documentHash)}`,
          shardArtifact.warning?.details
        )
      ]
    };
  }
  const shardRequirement = shardArtifact.artifact.requirements.find((requirement) => requirement.id === input.id);
  if (shardRequirement === undefined) {
    return {
      warnings: [
        cacheWarning(
          "REQUIREMENT_SHARD_UNREADABLE",
          "Requirement payload shard did not contain the requested requirement; source YAML data was used.",
          `.speckiwi/${requirementPayloadShardStorePath(shardRef.documentHash)}`
        )
      ]
    };
  }

  let relationIndex: RuntimeRelationIndex | undefined;
  if (input.includeRelations === true) {
    const relationArtifact = await readArtifact(root, "cache/relations.json", deserializeRelationIndex);
    if (relationArtifact.artifact === undefined) {
      return {
        warnings: [
          relationArtifact.warning === undefined
            ? cacheWarning("RELATION_CACHE_UNREADABLE", "Relation cache could not be read; source YAML data was used.", ".speckiwi/cache/relations.json")
            : toCacheWarning(relationArtifact.warning, "RELATION_CACHE_UNREADABLE")
        ]
      };
    }
    relationIndex = relationArtifact.artifact;
  }

  const sourceConfirmation = await confirmCachedRequirementAgainstSource(
    root,
    input,
    entityArtifact.artifact,
    shardRequirement.requirement,
    relationIndex
  );
  if (!sourceConfirmation.ok) {
    return { warnings: [sourceConfirmation.warning] };
  }

  return {
    result: buildConfirmedRequirementResult(
      input,
      sourceConfirmation,
      createDiagnosticBag()
    ),
    warnings: []
  };
}

async function confirmCachedRequirementAgainstSource(
  root: ReturnType<typeof workspaceRootFromPath>,
  input: GetRequirementInput,
  entities: RuntimeEntityIndex,
  cachedRequirement: JsonObject,
  relations: RuntimeRelationIndex | undefined
): Promise<
  | {
      ok: true;
      requirement: RegisteredRequirement;
      document?: RegisteredDocument;
      relations?: {
        incoming: RequirementRelation[];
        outgoing: RequirementRelation[];
      };
    }
  | { ok: false; warning: Diagnostic }
> {
  if (input.includeRelations !== true) {
    return confirmCachedRequirementAgainstTargetSource(root, input, entities, cachedRequirement);
  }

  const sourceModel = await loadReadModel({
    root: root.rootPath,
    cacheMode: "bypass",
    sections: ["entities", "relations"]
  });
  const registry = sourceModel.getRequirementRegistry();
  const source = registry.requirementsById.get(input.id);
  const summary = entities.requirementsById.get(input.id);
  const sourceDocument = source === undefined ? undefined : registry.documentsById.get(source.documentId);

  if (source === undefined || summary === undefined) {
    return {
      ok: false,
      warning: cacheWarning("ENTITY_CACHE_SOURCE_MISMATCH", "Entity cache requirement was absent from YAML source; source YAML data was used.", ".speckiwi/cache/entities.json", {
        id: input.id
      })
    };
  }

  if (!sameRequirementSourceFields(summary, cachedRequirement, source)) {
    return {
      ok: false,
      warning: cacheWarning(
        "ENTITY_CACHE_SOURCE_MISMATCH",
        "Entity cache requirement fields did not match YAML source; source YAML data was used.",
        ".speckiwi/cache/entities.json",
        { id: input.id }
      )
    };
  }

  if (input.includeDocument === true && !sameDocumentSourceFields(entities.documentsById.get(source.documentId), sourceDocument)) {
    return {
      ok: false,
      warning: cacheWarning(
        "ENTITY_CACHE_SOURCE_MISMATCH",
        "Entity cache document fields did not match YAML source; source YAML data was used.",
        ".speckiwi/cache/entities.json",
        { id: input.id, documentId: source.documentId }
      )
    };
  }

  if (
    input.includeRelations === true &&
    relations !== undefined &&
    (!sameRelations(relations.outgoingById.get(input.id) ?? [], registry.outgoingRelationsById.get(input.id) ?? []) ||
      !sameRelations(relations.incomingById.get(input.id) ?? [], registry.incomingRelationsById.get(input.id) ?? []))
  ) {
    return {
      ok: false,
      warning: cacheWarning(
        "ENTITY_CACHE_SOURCE_MISMATCH",
        "Entity cache relation data did not match YAML source; source YAML data was used.",
        ".speckiwi/cache/relations.json",
        { id: input.id }
      )
    };
  }

  return {
    ok: true,
    requirement: source,
    ...(sourceDocument === undefined ? {} : { document: sourceDocument }),
    ...(input.includeRelations === true
      ? {
          relations: {
            incoming: registry.incomingRelationsById.get(input.id) ?? [],
            outgoing: registry.outgoingRelationsById.get(input.id) ?? []
          }
        }
      : {})
  };
}

async function confirmCachedRequirementAgainstTargetSource(
  root: ReturnType<typeof workspaceRootFromPath>,
  input: GetRequirementInput,
  entities: RuntimeEntityIndex,
  cachedRequirement: JsonObject
): Promise<
  | {
      ok: true;
      requirement: RegisteredRequirement;
      document?: RegisteredDocument;
    }
  | { ok: false; warning: Diagnostic }
> {
  const summary = entities.requirementsById.get(input.id);
  if (summary === undefined) {
    return {
      ok: false,
      warning: cacheWarning("ENTITY_CACHE_SOURCE_MISMATCH", "Entity cache requirement was absent from YAML source; source YAML data was used.", ".speckiwi/cache/entities.json", {
        id: input.id
      })
    };
  }

  try {
    const cacheKey = input.includeDocument === true ? undefined : await sourceConfirmationCacheKey(root, input, summary, cachedRequirement);
    const cached = cacheKey === undefined ? undefined : sourceConfirmationCache.get(cacheKey);
    if (cached !== undefined) {
      return cached;
    }
    const source = await loadRequirementFromTargetDocument(root, input, summary);
    if (source === undefined) {
      return {
        ok: false,
        warning: cacheWarning("ENTITY_CACHE_SOURCE_MISMATCH", "Entity cache requirement was absent from YAML source; source YAML data was used.", ".speckiwi/cache/entities.json", {
          id: input.id
        })
      };
    }

    if (!sameRequirementSourceFields(summary, cachedRequirement, source.requirement)) {
      return {
        ok: false,
        warning: cacheWarning(
          "ENTITY_CACHE_SOURCE_MISMATCH",
          "Entity cache requirement fields did not match YAML source; source YAML data was used.",
          ".speckiwi/cache/entities.json",
          { id: input.id }
        )
      };
    }

    if (input.includeDocument === true && !sameDocumentSourceFields(entities.documentsById.get(source.requirement.documentId), source.document)) {
      return {
        ok: false,
        warning: cacheWarning(
          "ENTITY_CACHE_SOURCE_MISMATCH",
          "Entity cache document fields did not match YAML source; source YAML data was used.",
          ".speckiwi/cache/entities.json",
          { id: input.id, documentId: source.requirement.documentId }
        )
      };
    }

    if (cacheKey !== undefined) {
      sourceConfirmationCache.set(cacheKey, source);
      while (sourceConfirmationCache.size > SOURCE_CONFIRMATION_CACHE_LIMIT) {
        const oldest = sourceConfirmationCache.keys().next().value;
        if (typeof oldest !== "string") {
          break;
        }
        sourceConfirmationCache.delete(oldest);
      }
    }
    return source;
  } catch (error) {
    return {
      ok: false,
      warning: cacheWarning(
        "ENTITY_CACHE_SOURCE_MISMATCH",
        "Entity cache source confirmation failed; source YAML data was used.",
        ".speckiwi/cache/entities.json",
        { id: input.id, reason: error instanceof Error ? error.message : String(error) }
      )
    };
  }
}

async function sourceConfirmationCacheKey(
  root: ReturnType<typeof workspaceRootFromPath>,
  input: GetRequirementInput,
  summary: RuntimeEntityIndex["requirements"][number],
  cachedRequirement: JsonObject
): Promise<string> {
  const target = await resolveRealStorePath(root, normalizeStorePath(summary.path));
  const sourceStats = await stat(target.absolutePath);
  return stableJson({
    root: root.rootPath,
    id: input.id,
    path: summary.path,
    sourceSize: sourceStats.size,
    sourceMtimeMs: sourceStats.mtimeMs,
    sourceCtimeMs: sourceStats.ctimeMs,
    cachedRequirement
  });
}

async function loadRequirementFromTargetDocument(
  root: ReturnType<typeof workspaceRootFromPath>,
  input: GetRequirementInput,
  summary: RuntimeEntityIndex["requirements"][number]
): Promise<{ ok: true; requirement: RegisteredRequirement; document?: RegisteredDocument } | undefined> {
  const storePath = normalizeStorePath(summary.path);
  const loaded = await loadYamlDocument(await resolveRealStorePath(root, storePath));
  const value = jsonObjectValue(loaded.value);
  if (value === undefined) {
    return undefined;
  }
  const rawRequirement = arrayObjects(value.requirements).find((requirement) => stringValue(requirement.id) === input.id);
  if (rawRequirement === undefined) {
    return undefined;
  }

  const document =
    input.includeDocument === true
      ? await loadRegisteredDocumentForTarget(root, storePath, value)
      : {
          id: summary.documentId,
          type: documentTypeValue(value.type) ?? "srs",
          path: storePath,
          index: 0
        };
  const sourceScope = stringValue(value.scope);
  const requirement: RegisteredRequirement = {
    id: input.id,
    type: stringValue(rawRequirement.type) ?? "",
    title: stringValue(rawRequirement.title) ?? "",
    status: stringValue(rawRequirement.status) ?? "",
    statement: stringValue(rawRequirement.statement) ?? "",
    documentId: document.id,
    tags: tagsFrom(rawRequirement.tags),
    path: storePath,
    requirement: rawRequirement,
    relations: relationsFrom(rawRequirement.relations, input.id)
  };
  const priority = stringValue(rawRequirement.priority);
  if (priority !== undefined) {
    requirement.priority = priority;
  }
  if (sourceScope !== undefined) {
    requirement.scope = sourceScope;
  }
  return {
    ok: true,
    requirement,
    ...(input.includeDocument === true ? { document } : {})
  };
}

async function loadRegisteredDocumentForTarget(
  root: ReturnType<typeof workspaceRootFromPath>,
  storePath: string,
  value: JsonObject
): Promise<RegisteredDocument> {
  const manifest = await loadManifestEntryForDocument(root, storePath);
  const title = stringValue(value.title);
  const status = stringValue(value.status);
  const scope = stringValue(value.scope) ?? stringValue(manifest?.entry.scope);
  const tags = tagsFrom(value.tags).length > 0 ? tagsFrom(value.tags) : tagsFrom(manifest?.entry.tags);
  const document: RegisteredDocument = {
    id: stringValue(manifest?.entry.id) ?? stringValue(value.id) ?? storePath,
    type: documentTypeValue(manifest?.entry.type) ?? documentTypeValue(value.type) ?? "srs",
    path: storePath,
    index: manifest?.index ?? 0,
    value
  };
  if (title !== undefined) {
    document.title = title;
  }
  if (status !== undefined) {
    document.status = status;
  }
  if (scope !== undefined) {
    document.scope = scope;
  }
  if (tags.length > 0) {
    document.tags = tags;
  }
  return document;
}

function documentTypeValue(value: JsonValue | undefined): DocumentType | undefined {
  return ["overview", "prd", "srs", "technical", "adr", "rule", "dictionary", "prose"].includes(String(value))
    ? (value as DocumentType)
    : undefined;
}

async function loadManifestEntryForDocument(
  root: ReturnType<typeof workspaceRootFromPath>,
  storePath: string
): Promise<{ entry: JsonObject; index: number } | undefined> {
  const loaded = await loadYamlDocument(await resolveRealStorePath(root, normalizeStorePath("index.yaml")));
  const index = jsonObjectValue(loaded.value);
  return arrayObjects(index?.documents)
    .map((entry, entryIndex) => ({ entry, index: entryIndex }))
    .find(({ entry }) => stringValue(entry.path) === storePath);
}

function sameRequirementSourceFields(
  summary: RuntimeEntityIndex["requirements"][number],
  cachedRequirement: JsonObject,
  source: RegisteredRequirement
): boolean {
  return (
    stableJson(cachedRequirement) === stableJson(source.requirement) &&
    (stringValue(cachedRequirement.statement) ?? summary.statement) === source.statement &&
    (stringValue(cachedRequirement.status) ?? summary.status) === source.status &&
    (stringValue(cachedRequirement.type) ?? summary.type) === source.type &&
    (stringValue(cachedRequirement.title) ?? summary.title) === source.title &&
    summary.scope === source.scope &&
    summary.documentId === source.documentId &&
    summary.path === source.path
  );
}

function sameDocumentSourceFields(
  cached: RuntimeEntityIndex["documents"][number] | undefined,
  source: RegisteredDocument | undefined
): boolean {
  if (cached === undefined || source === undefined) {
    return cached === source;
  }
  return stableJson(documentSummary(cached)) === stableJson(documentSummary(source));
}

function sameRelations(left: readonly RequirementRelation[], right: readonly RequirementRelation[]): boolean {
  const leftKeys = left.map(relationKey).sort();
  const rightKeys = right.map(relationKey).sort();
  return leftKeys.length === rightKeys.length && leftKeys.every((key, index) => key === rightKeys[index]);
}

function relationKey(relation: RequirementRelation): string {
  return `${relation.source ?? ""}\0${relation.type}\0${relation.target}\0${relation.description ?? ""}`;
}

function buildConfirmedRequirementResult(
  input: GetRequirementInput,
  confirmation: {
    requirement: RegisteredRequirement;
    document?: RegisteredDocument;
    relations?: {
      incoming: RequirementRelation[];
      outgoing: RequirementRelation[];
    };
  },
  diagnostics: DiagnosticBag
): RequirementResult {
  const payload: {
    requirement: JsonObject;
    document?: DocumentSummary;
    relations?: {
      incoming: RequirementRelation[];
      outgoing: RequirementRelation[];
    };
  } = {
    requirement: confirmation.requirement.requirement
  };

  if (input.includeDocument === true) {
    if (confirmation.document !== undefined) {
      payload.document = documentSummary(confirmation.document);
    }
  }

  if (input.includeRelations === true) {
    payload.relations = {
      incoming: confirmation.relations?.incoming ?? [],
      outgoing: confirmation.relations?.outgoing ?? []
    };
  }

  return ok(payload, diagnostics);
}

function toCacheWarning(warning: Diagnostic, code: string): Diagnostic {
  return cacheWarning(code, warning.message, warning.path, warning.details);
}

function cacheWarning(code: string, message: string, path?: string, details?: JsonObject): Diagnostic {
  return {
    severity: "warning",
    code,
    message,
    ...(path === undefined ? {} : { path }),
    ...(details === undefined ? {} : { details })
  };
}

async function isRequirementCacheFresh(
  root: ReturnType<typeof workspaceRootFromPath>,
  documentPath: string,
  documentHash: string
): Promise<boolean> {
  const manifest = await readCachedManifest(root);
  if (!hasManifestFormat(manifest)) {
    return false;
  }

  return (
    documentPath.length > 0 &&
    manifestOutputs(manifest).some((output) => output.path === "cache/entities.json") &&
    manifestOutputs(manifest).some((output) => output.path === requirementPayloadShardStorePath(documentHash))
  );
}

function manifestOutputs(manifest: IndexManifestV2): Array<{ path: string }> {
  return [
    ...manifest.sections.facts.outputs,
    ...manifest.sections.entities.outputs,
    ...manifest.sections.relations.outputs,
    ...manifest.sections.search.outputs,
    ...manifest.sections.graph.outputs,
    ...manifest.sections.diagnostics.outputs
  ];
}

async function readCachedManifest(root: ReturnType<typeof workspaceRootFromPath>): Promise<Awaited<ReturnType<typeof readCacheManifest>>> {
  try {
    const fileHash = await cacheArtifactSha256(root, "cache/manifest.json");
    const cached = manifestCache.get(root.rootPath);
    if (cached !== undefined && cached.sha256 === fileHash) {
      return cached.manifest;
    }
    const manifest = await readCacheManifest(root);
    manifestCache.set(root.rootPath, { sha256: fileHash, manifest });
    return manifest;
  } catch {
    manifestCache.delete(root.rootPath);
    return undefined;
  }
}

async function readCachedEntityIndex(
  root: ReturnType<typeof workspaceRootFromPath>
): Promise<Awaited<ReturnType<typeof readArtifact<RuntimeEntityIndex>>>> {
  try {
    const fileHash = await cacheArtifactSha256(root, "cache/entities.json");
    const cached = entityIndexCache.get(root.rootPath);
    if (cached !== undefined && cached.sha256 === fileHash) {
      return { artifact: cached.artifact };
    }
    const artifact = await readArtifact(root, "cache/entities.json", deserializeEntityIndex);
    if (artifact.artifact !== undefined) {
      entityIndexCache.set(root.rootPath, { sha256: fileHash, artifact: artifact.artifact });
    }
    return artifact;
  } catch (error) {
    entityIndexCache.delete(root.rootPath);
    return {
      warning: cacheWarning(
        "ENTITY_CACHE_UNREADABLE",
        "Entity cache could not be read; source YAML data was used.",
        ".speckiwi/cache/entities.json",
        { reason: error instanceof Error ? error.message : String(error) }
      )
    };
  }
}

async function readCachedRequirementShard(
  root: ReturnType<typeof workspaceRootFromPath>,
  documentHash: string
): Promise<Awaited<ReturnType<typeof readArtifact<Exclude<ReturnType<typeof deserializeRequirementPayloadShard>, undefined>>>>> {
  const storePath = requirementPayloadShardStorePath(documentHash);
  const cacheKey = `${root.rootPath}\0${documentHash}`;
  try {
    const fileHash = await cacheArtifactSha256(root, storePath);
    const cached = requirementShardCache.get(cacheKey);
    if (cached !== undefined && cached.sha256 === fileHash) {
      return { artifact: cached.artifact };
    }
    const artifact = await readArtifact(root, storePath, deserializeRequirementPayloadShard);
    if (artifact.artifact !== undefined) {
      requirementShardCache.set(cacheKey, { sha256: fileHash, artifact: artifact.artifact });
    }
    return artifact;
  } catch (error) {
    requirementShardCache.delete(cacheKey);
    return {
      warning: cacheWarning(
        "REQUIREMENT_SHARD_UNREADABLE",
        "Requirement payload shard could not be read; source YAML data was used.",
        `.speckiwi/${storePath}`,
        { reason: error instanceof Error ? error.message : String(error) }
      )
    };
  }
}

async function cacheArtifactSha256(root: ReturnType<typeof workspaceRootFromPath>, storePath: string): Promise<string> {
  const target = await resolveRealStorePath(root, normalizeStorePath(storePath));
  return `sha256:${await sha256File(target.absolutePath)}`;
}

function maxExistingSequence(ids: Set<string>, prefix: string): number {
  let max = 0;
  for (const id of ids) {
    if (!id.startsWith(prefix)) {
      continue;
    }
    const suffix = id.slice(prefix.length);
    if (/^\d{4}$/.test(suffix)) {
      max = Math.max(max, Number.parseInt(suffix, 10));
    }
  }
  return max;
}

function formatRequirementId(prefix: string, sequence: number): string {
  return `${prefix}${formatSequence(sequence)}`;
}

function formatSequence(sequence: number): string {
  return sequence.toString().padStart(4, "0");
}

function makeProjectSegment(projectId: string): string {
  return segmentWords(projectId, 3, "PRJ", /[-_.\s]+/);
}

function makeScopeSegment(scope: string): string {
  const normalized = scope.normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
  const majorSegments = normalized.split(/[./]+/).filter((segment) => segment.length > 0);
  const lastSegment = majorSegments.at(-1) ?? normalized;
  return segmentWords(lastSegment, 4, "GEN", /[-_\s]+/);
}

function segmentWords(value: string, sliceLength: number, fallback: string, separator: RegExp): string {
  const normalized = value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
  const segment = normalized
    .split(separator)
    .map((word) => word.replace(/[^A-Za-z0-9]/g, ""))
    .filter((word) => word.length > 0)
    .map((word) => word.slice(0, sliceLength))
    .join("")
    .toUpperCase();
  return segment.length > 0 ? segment : fallback;
}

function tagsFrom(value: JsonValue | undefined): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string").sort() : [];
}

function arrayObjects(value: JsonValue | undefined): JsonObject[] {
  return Array.isArray(value) ? value.filter(isJsonObject) : [];
}

function jsonObjectValue(value: JsonValue | undefined): JsonObject | undefined {
  return isJsonObject(value) ? value : undefined;
}

function jsonObjectFromUnknown(value: unknown): JsonObject {
  return isJsonObject(value) ? value : {};
}

function stringValue(value: JsonValue | undefined): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isDefined<T>(value: T | undefined): value is T {
  return value !== undefined;
}
