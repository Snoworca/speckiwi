import { resolve } from "node:path";
import { createDiagnosticBag, fail, ok } from "./result.js";
import { workspaceRootFromPath } from "../io/workspace.js";
import { loadWorkspaceForValidation } from "../validate/semantic.js";
const requirementTypePrefixes = {
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
export async function loadRequirementRegistry(input = {}) {
    const root = workspaceRootFromPath(resolve(input.root ?? process.cwd()));
    const workspace = await loadWorkspaceForValidation(root);
    return buildRequirementRegistry(workspace);
}
export function buildRequirementRegistry(workspace) {
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
    const incomingRelationsById = new Map();
    const outgoingRelationsById = new Map();
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
export async function getRequirement(input) {
    return getRequirementFromRegistry(input, await loadRequirementRegistry(input));
}
export function getRequirementFromRegistry(input, registry) {
    const requirement = registry.requirementsById.get(input.id);
    if (requirement === undefined) {
        return notFoundRequirement(input.id);
    }
    const payload = {
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
    return ok(payload);
}
export async function listRequirements(input = {}) {
    return listRequirementsFromRegistry(input, await loadRequirementRegistry(input));
}
export function listRequirementsFromRegistry(input, registry) {
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
export function previewRequirementId(input, registry) {
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
export function assertExplicitRequirementId(id, registry) {
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
export function requirementSummary(requirement) {
    const summary = {
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
function buildDocuments(workspace, documentsByStorePath) {
    return workspace.manifestEntries
        .map((entry) => {
        const loaded = documentsByStorePath.get(entry.path);
        const value = loaded?.value;
        const document = {
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
function buildScopes(index) {
    return arrayObjects(index?.scopes)
        .map((scope, index) => {
        const id = stringValue(scope.id);
        if (id === undefined) {
            return undefined;
        }
        const registered = {
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
function buildDocumentLinks(index) {
    return arrayObjects(index?.links)
        .map((link) => {
        const from = stringValue(link.from);
        const to = stringValue(link.to);
        const type = stringValue(link.type);
        if (from === undefined || to === undefined || type === undefined) {
            return undefined;
        }
        const documentLink = { from, to, type };
        const description = stringValue(link.description);
        if (description !== undefined) {
            documentLink.description = description;
        }
        return documentLink;
    })
        .filter(isDefined)
        .sort((left, right) => left.from.localeCompare(right.from) || left.to.localeCompare(right.to) || left.type.localeCompare(right.type));
}
function buildRequirements(workspace, documentsByStorePath) {
    const manifestByPath = new Map(workspace.manifestEntries.map((entry) => [entry.path, entry]));
    const requirements = [];
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
            const entry = {
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
function relationsFrom(value, source) {
    return arrayObjects(value)
        .map((relation) => {
        const type = stringValue(relation.type);
        const target = stringValue(relation.target);
        if (type === undefined || target === undefined) {
            return undefined;
        }
        const item = { type, target, source };
        const description = stringValue(relation.description);
        if (description !== undefined) {
            item.description = description;
        }
        return item;
    })
        .filter(isDefined)
        .sort((left, right) => left.type.localeCompare(right.type) || left.target.localeCompare(right.target) || (left.source ?? "").localeCompare(right.source ?? ""));
}
function sortRelations(relations) {
    return [...relations].sort((left, right) => left.type.localeCompare(right.type) || left.target.localeCompare(right.target) || (left.source ?? "").localeCompare(right.source ?? ""));
}
function readProject(index) {
    const project = jsonObjectValue(index?.project);
    const result = {
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
function documentSummary(document) {
    const summary = {
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
function matchesRequirementFilters(requirement, input, registry) {
    return (matchesProjectFilter(registry.project, input.project) &&
        matchesFilter(requirement.scope, input.scope) &&
        matchesFilter(requirement.type, input.type) &&
        matchesFilter(requirement.status, input.status) &&
        matchesTagFilter(requirement.tags, input.tag) &&
        matchesFilter(requirement.documentId, input.documentId));
}
function matchesProjectFilter(project, filter) {
    if (filter === undefined) {
        return true;
    }
    const values = Array.isArray(filter) ? filter : [filter];
    return values.includes(project.id) || (project.name !== undefined && values.includes(project.name));
}
function matchesFilter(value, filter) {
    if (filter === undefined) {
        return true;
    }
    const values = Array.isArray(filter) ? filter : [filter];
    return value !== undefined && values.includes(value);
}
function matchesTagFilter(tags, filter) {
    if (filter === undefined) {
        return true;
    }
    const values = Array.isArray(filter) ? filter : [filter];
    return values.some((tag) => tags.includes(tag));
}
function normalizeListLimit(value) {
    if (typeof value !== "number" || !Number.isFinite(value)) {
        return 50;
    }
    return Math.min(Math.max(Math.trunc(value), 1), 500);
}
function normalizeOffset(value) {
    if (typeof value !== "number" || !Number.isFinite(value)) {
        return 0;
    }
    return Math.max(Math.trunc(value), 0);
}
function notFoundRequirement(id) {
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
function maxExistingSequence(ids, prefix) {
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
function formatRequirementId(prefix, sequence) {
    return `${prefix}${formatSequence(sequence)}`;
}
function formatSequence(sequence) {
    return sequence.toString().padStart(4, "0");
}
function makeProjectSegment(projectId) {
    return segmentWords(projectId, 3, "PRJ", /[-_.\s]+/);
}
function makeScopeSegment(scope) {
    const normalized = scope.normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
    const majorSegments = normalized.split(/[./]+/).filter((segment) => segment.length > 0);
    const lastSegment = majorSegments.at(-1) ?? normalized;
    return segmentWords(lastSegment, 4, "GEN", /[-_\s]+/);
}
function segmentWords(value, sliceLength, fallback, separator) {
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
function tagsFrom(value) {
    return Array.isArray(value) ? value.filter((item) => typeof item === "string").sort() : [];
}
function arrayObjects(value) {
    return Array.isArray(value) ? value.filter(isJsonObject) : [];
}
function jsonObjectValue(value) {
    return isJsonObject(value) ? value : undefined;
}
function jsonObjectFromUnknown(value) {
    return isJsonObject(value) ? value : {};
}
function stringValue(value) {
    return typeof value === "string" ? value : undefined;
}
function isJsonObject(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
function isDefined(value) {
    return value !== undefined;
}
//# sourceMappingURL=requirements.js.map