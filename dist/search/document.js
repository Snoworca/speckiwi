import { buildRequirementRegistry } from "../core/requirements.js";
export function flattenWorkspace(workspace) {
    const registry = buildRequirementRegistry(workspace);
    const documentsByPath = new Map(workspace.documents.map((document) => [document.storePath, document]));
    const searchDocuments = [
        ...flattenDocuments(registry, documentsByPath),
        ...flattenScopes(registry),
        ...flattenRequirements(registry),
        ...flattenNestedEntities(workspace, registry)
    ];
    return searchDocuments.sort(compareSearchDocuments);
}
export function buildDictionaryExpansion(workspace) {
    const groups = [];
    for (const document of workspace.documents) {
        if (document.schemaKind !== "dictionary" || document.value === undefined) {
            continue;
        }
        const synonyms = jsonObjectValue(document.value.synonyms);
        for (const [key, values] of Object.entries(synonyms ?? {}).sort(([left], [right]) => left.localeCompare(right))) {
            const terms = uniqueStrings([key, ...stringArray(values)]);
            if (terms.length > 0) {
                groups.push(terms);
            }
        }
    }
    return { groups };
}
function flattenDocuments(registry, documentsByPath) {
    return registry.documents.map((document) => {
        const loaded = documentsByPath.get(document.path);
        const value = loaded?.value;
        const tags = document.tags ?? tagsFrom(value?.tags);
        const fields = compactFields({
            id: document.id,
            title: document.title,
            tags,
            scope: document.scope,
            description: stringValue(value?.summary) ?? stringValue(value?.description),
            body: documentBodyText(value)
        });
        return searchDocument({
            entityType: "document",
            id: document.id,
            path: workspacePath(document.path),
            title: document.title,
            scope: document.scope,
            fields,
            filters: {
                entityType: "document",
                path: workspacePath(document.path),
                type: document.type,
                status: document.status,
                scope: document.scope,
                tags
            }
        });
    });
}
function flattenScopes(registry) {
    return registry.scopes.map((scope) => searchDocument({
        entityType: "scope",
        id: scope.id,
        path: workspacePath("index.yaml"),
        title: scope.name,
        scope: scope.id,
        fields: compactFields({
            id: scope.id,
            title: scope.name,
            tags: scope.tags,
            scope: scope.id,
            description: scope.description,
            body: [scope.type, scope.parent].filter(isString)
        }),
        filters: {
            entityType: "scope",
            path: workspacePath("index.yaml"),
            type: scope.type,
            scope: scope.id,
            tags: scope.tags
        }
    }));
}
function flattenRequirements(registry) {
    return registry.requirements.map((requirement) => {
        const raw = requirement.requirement;
        return searchDocument({
            entityType: "requirement",
            id: requirement.id,
            documentId: requirement.documentId,
            scope: requirement.scope,
            title: requirement.title,
            path: workspacePath(requirement.path),
            fields: compactFields({
                id: requirement.id,
                title: requirement.title,
                tags: requirement.tags,
                scope: requirement.scope,
                statement: requirement.statement,
                acceptanceCriteria: acceptanceCriteriaText(raw.acceptanceCriteria),
                rationale: stringValue(raw.rationale),
                description: stringValue(raw.description),
                body: metadataText(raw.metadata)
            }),
            filters: {
                entityType: "requirement",
                path: workspacePath(requirement.path),
                documentId: requirement.documentId,
                scope: requirement.scope,
                type: requirement.type,
                status: requirement.status,
                tags: requirement.tags
            }
        });
    });
}
function flattenNestedEntities(workspace, registry) {
    const documentsByPath = new Map(registry.documents.map((document) => [document.path, document]));
    const searchDocuments = [];
    for (const document of workspace.documents) {
        if (!document.schemaValid || document.value === undefined) {
            continue;
        }
        const registered = documentsByPath.get(document.storePath);
        const documentId = registered?.id ?? stringValue(document.value.id) ?? document.storePath;
        const documentScope = registered?.scope ?? stringValue(document.value.scope);
        const documentStatus = registered?.status ?? stringValue(document.value.status);
        const documentPath = workspacePath(document.storePath);
        if (document.schemaKind === "prd") {
            for (const item of arrayObjects(document.value.items)) {
                const id = stringValue(item.id);
                if (id === undefined) {
                    continue;
                }
                const tags = tagsFrom(item.tags);
                searchDocuments.push(searchDocument({
                    entityType: "prd_item",
                    id,
                    documentId,
                    scope: documentScope,
                    title: stringValue(item.title),
                    path: documentPath,
                    fields: compactFields({
                        id,
                        title: stringValue(item.title),
                        tags,
                        scope: documentScope,
                        description: stringValue(item.body),
                        body: [stringValue(item.type), metadataText(item.metadata)].filter(isString)
                    }),
                    filters: {
                        entityType: "prd_item",
                        path: documentPath,
                        documentId,
                        scope: documentScope,
                        type: stringValue(item.type),
                        status: documentStatus,
                        tags
                    }
                }));
            }
        }
        if (document.schemaKind === "technical") {
            for (const section of arrayObjects(document.value.sections)) {
                const id = stringValue(section.id);
                if (id === undefined) {
                    continue;
                }
                searchDocuments.push(searchDocument({
                    entityType: "technical_section",
                    id,
                    documentId,
                    scope: documentScope,
                    title: stringValue(section.title),
                    path: documentPath,
                    fields: compactFields({
                        id,
                        title: stringValue(section.title),
                        scope: documentScope,
                        description: stringValue(section.body),
                        body: [metadataText(section.metadata), ...stringArray(document.value.implements)].filter(isString)
                    }),
                    filters: {
                        entityType: "technical_section",
                        path: documentPath,
                        documentId,
                        scope: documentScope,
                        type: "technical",
                        status: documentStatus,
                        tags: []
                    }
                }));
            }
        }
        if (document.schemaKind === "adr") {
            searchDocuments.push(searchDocument({
                entityType: "adr",
                id: documentId,
                documentId,
                scope: documentScope,
                title: stringValue(document.value.title),
                path: documentPath,
                fields: compactFields({
                    id: documentId,
                    title: stringValue(document.value.title),
                    scope: documentScope,
                    description: stringValue(document.value.context),
                    body: [stringValue(document.value.decision), ...stringArray(document.value.consequences), metadataText(document.value.metadata)].filter(isString)
                }),
                filters: {
                    entityType: "adr",
                    path: documentPath,
                    documentId,
                    scope: documentScope,
                    type: "adr",
                    status: documentStatus,
                    tags: []
                }
            }));
        }
        if (document.schemaKind === "rule") {
            for (const rule of arrayObjects(document.value.rules)) {
                const id = stringValue(rule.id);
                if (id === undefined) {
                    continue;
                }
                const tags = tagsFrom(rule.tags);
                searchDocuments.push(searchDocument({
                    entityType: "rule",
                    id,
                    documentId,
                    scope: documentScope,
                    title: stringValue(document.value.title),
                    path: documentPath,
                    fields: compactFields({
                        id,
                        title: stringValue(document.value.title),
                        tags,
                        scope: documentScope,
                        statement: stringValue(rule.statement),
                        rationale: stringValue(rule.rationale),
                        body: [stringValue(rule.level), metadataText(rule.metadata)].filter(isString)
                    }),
                    filters: {
                        entityType: "rule",
                        path: documentPath,
                        documentId,
                        scope: documentScope,
                        type: stringValue(rule.level),
                        status: documentStatus,
                        tags
                    }
                }));
            }
        }
    }
    return searchDocuments;
}
function documentBodyText(value) {
    if (value === undefined) {
        return [];
    }
    return [
        ...arrayObjects(value.goals).map((goal) => [stringValue(goal.id), stringValue(goal.statement)].filter(isString).join(" ")),
        ...arrayObjects(value.nonGoals).map((goal) => [stringValue(goal.id), stringValue(goal.statement)].filter(isString).join(" ")),
        ...arrayObjects(value.glossary).map((item) => [stringValue(item.term), stringValue(item.definition)].filter(isString).join(" ")),
        metadataText(value.metadata)
    ].filter(isString);
}
function acceptanceCriteriaText(value) {
    return arrayObjects(value).flatMap((item) => [stringValue(item.id), stringValue(item.method), stringValue(item.description)].filter(isString));
}
function compactFields(fields) {
    const compacted = {};
    for (const [field, value] of Object.entries(fields)) {
        if (value === undefined) {
            continue;
        }
        if (Array.isArray(value)) {
            const values = value.filter((item) => item.trim().length > 0);
            if (values.length > 0) {
                compacted[field] = values;
            }
        }
        else if (value.trim().length > 0) {
            compacted[field] = value;
        }
    }
    return compacted;
}
function searchDocument(input) {
    const filters = {
        entityType: input.entityType,
        path: input.path,
        tags: input.filters.tags ?? []
    };
    for (const key of ["documentId", "scope", "type", "status"]) {
        const value = input.filters[key];
        if (value !== undefined) {
            filters[key] = value;
        }
    }
    const document = {
        entityType: input.entityType,
        id: input.id,
        path: input.path,
        fields: input.fields,
        filters
    };
    if (input.documentId !== undefined) {
        document.documentId = input.documentId;
    }
    if (input.scope !== undefined) {
        document.scope = input.scope;
    }
    if (input.title !== undefined) {
        document.title = input.title;
    }
    return document;
}
function compareSearchDocuments(left, right) {
    return (entityPriority(left.entityType) - entityPriority(right.entityType) ||
        left.id.localeCompare(right.id) ||
        (left.documentId ?? "").localeCompare(right.documentId ?? "") ||
        left.path.localeCompare(right.path));
}
function entityPriority(entityType) {
    return ["requirement", "document", "scope", "prd_item", "technical_section", "adr", "rule"].indexOf(entityType);
}
function workspacePath(storePath) {
    return `.speckiwi/${storePath}`;
}
function metadataText(value) {
    if (value === undefined) {
        return undefined;
    }
    return JSON.stringify(value);
}
function uniqueStrings(values) {
    const seen = new Set();
    const result = [];
    for (const value of values.map((item) => item.trim()).filter((item) => item.length > 0)) {
        if (!seen.has(value)) {
            seen.add(value);
            result.push(value);
        }
    }
    return result;
}
function arrayObjects(value) {
    return Array.isArray(value) ? value.filter(isJsonObject) : [];
}
function jsonObjectValue(value) {
    return isJsonObject(value) ? value : undefined;
}
function stringArray(value) {
    return Array.isArray(value) ? value.filter(isString) : [];
}
function tagsFrom(value) {
    return stringArray(value).sort();
}
function stringValue(value) {
    return typeof value === "string" ? value : undefined;
}
function isJsonObject(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
function isString(value) {
    return typeof value === "string" && value.length > 0;
}
//# sourceMappingURL=document.js.map