import { sha256 } from "../cache/hash.js";
const ENTITY_INDEX_FORMAT = "speckiwi/entities/v1";
const REQUIREMENT_PAYLOAD_SHARD_FORMAT = "speckiwi/requirements-shard/v1";
const REQUIREMENT_SHARD_DIRECTORY = "cache/requirements";
const MAX_DOCUMENTS_PER_REQUIREMENT_SHARD = 25;
export function buildEntityIndex(registry) {
    const documents = registry.documents.map((document) => ({
        id: document.id,
        type: document.type,
        path: document.path,
        index: document.index,
        ...(document.title === undefined ? {} : { title: document.title }),
        ...(document.status === undefined ? {} : { status: document.status }),
        ...(document.scope === undefined ? {} : { scope: document.scope }),
        ...(document.tags === undefined ? {} : { tags: [...document.tags] })
    }));
    const scopes = registry.scopes.map((scope) => ({
        ...scope,
        tags: [...scope.tags]
    }));
    const requirements = registry.requirements.map((requirement, ordinal) => ({
        id: requirement.id,
        type: requirement.type,
        title: requirement.title,
        status: requirement.status,
        statement: requirement.statement,
        documentId: requirement.documentId,
        tags: [...requirement.tags],
        path: requirement.path,
        ordinal,
        ...(requirement.priority === undefined ? {} : { priority: requirement.priority }),
        ...(requirement.scope === undefined ? {} : { scope: requirement.scope })
    }));
    return {
        format: ENTITY_INDEX_FORMAT,
        project: { ...registry.project },
        documents,
        scopes,
        requirements,
        requirementLookup: requirements.map((requirement) => [requirement.id, requirement.ordinal]),
        documentLookup: documents.map((document, ordinal) => [document.id, ordinal]),
        requirementPayloadShards: []
    };
}
export function bindRequirementPayloadShards(index, shardRefs) {
    const shardByRequirementId = new Map();
    for (const shard of shardRefs) {
        for (const requirementId of shard.requirementIds) {
            shardByRequirementId.set(requirementId, shard);
        }
    }
    return {
        ...index,
        requirements: index.requirements.map((requirement) => {
            const shard = shardByRequirementId.get(requirement.id);
            if (shard === undefined) {
                return requirement;
            }
            return {
                ...requirement,
                documentHash: shard.documentHash
            };
        }),
        requirementPayloadShards: shardRefs.map((shard) => ({
            ...shard,
            requirementIds: [...shard.requirementIds]
        }))
    };
}
export function buildRequirementPayloadShardRefs(shards) {
    return shards
        .map((shard) => ({
        documentId: shard.documentId,
        documentPath: shard.documentPath,
        documentHash: shard.documentHash,
        requirementIds: shard.requirements.map((requirement) => requirement.id).sort()
    }))
        .sort((left, right) => left.documentPath.localeCompare(right.documentPath) ||
        left.documentHash.localeCompare(right.documentHash));
}
export function buildRequirementPayloadShards(registry, documentHashes) {
    const requirementsByPath = new Map();
    for (const requirement of registry.requirements) {
        const group = requirementsByPath.get(requirement.path) ?? [];
        group.push(requirement);
        requirementsByPath.set(requirement.path, group);
    }
    const documents = registry.documents
        .filter((document) => requirementsByPath.has(document.path))
        .sort((left, right) => left.path.localeCompare(right.path));
    const shards = [];
    for (let offset = 0; offset < documents.length; offset += MAX_DOCUMENTS_PER_REQUIREMENT_SHARD) {
        const chunk = documents.slice(offset, offset + MAX_DOCUMENTS_PER_REQUIREMENT_SHARD);
        const requirements = chunk.flatMap((document) => (requirementsByPath.get(document.path) ?? []).map((requirement, ordinal) => ({
            id: requirement.id,
            ordinal,
            requirement: requirement.requirement
        })));
        const single = chunk.length === 1;
        const documentHash = single
            ? documentHashForSingleShard(chunk[0], requirements, documentHashes)
            : sha256(JSON.stringify(chunk.map((document) => ({
                id: document.id,
                path: document.path,
                hash: documentHashes.get(document.path),
                requirementIds: (requirementsByPath.get(document.path) ?? []).map((requirement) => requirement.id)
            }))));
        shards.push({
            format: REQUIREMENT_PAYLOAD_SHARD_FORMAT,
            documentId: single ? (chunk[0]?.id ?? "unknown") : `requirement-shard-${Math.floor(offset / MAX_DOCUMENTS_PER_REQUIREMENT_SHARD) + 1}`,
            documentPath: single
                ? (chunk[0]?.path ?? "unknown")
                : `${chunk[0]?.path ?? "unknown"}..${chunk[chunk.length - 1]?.path ?? "unknown"}`,
            documentHash,
            requirements
        });
    }
    return shards.sort((left, right) => left.documentPath.localeCompare(right.documentPath));
}
function documentHashForSingleShard(document, requirements, documentHashes) {
    if (document === undefined) {
        return sha256(JSON.stringify({ documentId: "unknown", requirementIds: requirements.map((requirement) => requirement.id) }));
    }
    return (documentHashes.get(document.path) ??
        sha256(JSON.stringify({
            documentId: document.id,
            documentPath: document.path,
            requirementIds: requirements.map((requirement) => requirement.id)
        })));
}
export function deserializeEntityIndex(value) {
    const index = entityIndexValue(value);
    if (index === undefined) {
        return undefined;
    }
    return {
        ...index,
        documentsById: new Map(index.documents.map((document) => [document.id, document])),
        requirementsById: new Map(index.requirements.map((requirement) => [requirement.id, requirement])),
        scopesById: new Map(index.scopes.map((scope) => [scope.id, scope])),
        requirementShardsById: new Map(index.requirementPayloadShards.flatMap((shard) => shard.requirementIds.map((id) => [id, shard])))
    };
}
export function deserializeRequirementPayloadShard(value) {
    const shard = objectValue(value);
    if (shard?.format !== REQUIREMENT_PAYLOAD_SHARD_FORMAT ||
        typeof shard.documentId !== "string" ||
        typeof shard.documentPath !== "string" ||
        typeof shard.documentHash !== "string" ||
        !Array.isArray(shard.requirements)) {
        return undefined;
    }
    const requirements = shard.requirements
        .map((requirement) => {
        const item = objectValue(requirement);
        if (typeof item?.id !== "string" ||
            typeof item.ordinal !== "number" ||
            !Number.isFinite(item.ordinal) ||
            !isJsonObject(item.requirement)) {
            return undefined;
        }
        return {
            id: item.id,
            ordinal: Math.trunc(item.ordinal),
            requirement: item.requirement
        };
    })
        .filter(isDefined);
    if (requirements.length !== shard.requirements.length) {
        return undefined;
    }
    return {
        format: REQUIREMENT_PAYLOAD_SHARD_FORMAT,
        documentId: shard.documentId,
        documentPath: shard.documentPath,
        documentHash: shard.documentHash,
        requirements
    };
}
export function requirementPayloadShardStorePath(documentHash) {
    return `${REQUIREMENT_SHARD_DIRECTORY}/${documentHash}.json`;
}
function entityIndexValue(value) {
    const index = objectValue(value);
    if (index?.format !== ENTITY_INDEX_FORMAT ||
        !isProjectSummary(index.project) ||
        !Array.isArray(index.documents) ||
        !Array.isArray(index.scopes) ||
        !Array.isArray(index.requirements) ||
        !tupleArray(index.requirementLookup) ||
        !tupleArray(index.documentLookup) ||
        !Array.isArray(index.requirementPayloadShards)) {
        return undefined;
    }
    const documents = index.documents.map(documentSummaryValue).filter(isDefined);
    const scopes = index.scopes.map(scopeValue).filter(isDefined);
    const requirements = index.requirements.map(requirementSummaryValue).filter(isDefined);
    const shards = index.requirementPayloadShards.map(shardRefValue).filter(isDefined);
    if (documents.length !== index.documents.length ||
        scopes.length !== index.scopes.length ||
        requirements.length !== index.requirements.length ||
        shards.length !== index.requirementPayloadShards.length) {
        return undefined;
    }
    return {
        format: ENTITY_INDEX_FORMAT,
        project: { ...index.project },
        documents,
        scopes,
        requirements,
        requirementLookup: index.requirementLookup,
        documentLookup: index.documentLookup,
        requirementPayloadShards: shards
    };
}
function documentSummaryValue(value) {
    const item = objectValue(value);
    if (typeof item?.id !== "string" ||
        typeof item.type !== "string" ||
        typeof item.path !== "string" ||
        typeof item.index !== "number" ||
        !Number.isFinite(item.index)) {
        return undefined;
    }
    if (item.tags !== undefined && stringArray(item.tags) === undefined) {
        return undefined;
    }
    const tags = stringArray(item.tags);
    return {
        id: item.id,
        type: item.type,
        path: item.path,
        index: Math.trunc(item.index),
        ...(typeof item.title === "string" ? { title: item.title } : {}),
        ...(typeof item.status === "string" ? { status: item.status } : {}),
        ...(typeof item.scope === "string" ? { scope: item.scope } : {}),
        ...(tags === undefined ? {} : { tags })
    };
}
function requirementSummaryValue(value) {
    const item = objectValue(value);
    if (typeof item?.id !== "string" ||
        typeof item.type !== "string" ||
        typeof item.title !== "string" ||
        typeof item.status !== "string" ||
        typeof item.statement !== "string" ||
        typeof item.documentId !== "string" ||
        typeof item.path !== "string" ||
        typeof item.ordinal !== "number" ||
        !Number.isFinite(item.ordinal) ||
        stringArray(item.tags) === undefined) {
        return undefined;
    }
    const tags = stringArray(item.tags);
    return {
        id: item.id,
        type: item.type,
        title: item.title,
        status: item.status,
        statement: item.statement,
        documentId: item.documentId,
        tags: tags ?? [],
        path: item.path,
        ordinal: Math.trunc(item.ordinal),
        ...(typeof item.priority === "string" ? { priority: item.priority } : {}),
        ...(typeof item.scope === "string" ? { scope: item.scope } : {}),
        ...(typeof item.documentHash === "string" ? { documentHash: item.documentHash } : {})
    };
}
function scopeValue(value) {
    const item = objectValue(value);
    if (typeof item?.id !== "string" ||
        typeof item.index !== "number" ||
        !Number.isFinite(item.index) ||
        stringArray(item.tags) === undefined) {
        return undefined;
    }
    const tags = stringArray(item.tags);
    return {
        id: item.id,
        index: Math.trunc(item.index),
        tags: tags ?? [],
        ...(typeof item.name === "string" ? { name: item.name } : {}),
        ...(typeof item.type === "string" ? { type: item.type } : {}),
        ...(typeof item.parent === "string" ? { parent: item.parent } : {}),
        ...(typeof item.description === "string" ? { description: item.description } : {})
    };
}
function shardRefValue(value) {
    const item = objectValue(value);
    const requirementIds = stringArray(item?.requirementIds);
    if (typeof item?.documentId !== "string" ||
        typeof item.documentPath !== "string" ||
        typeof item.documentHash !== "string" ||
        requirementIds === undefined) {
        return undefined;
    }
    return {
        documentId: item.documentId,
        documentPath: item.documentPath,
        documentHash: item.documentHash,
        requirementIds
    };
}
function isProjectSummary(value) {
    const item = objectValue(value);
    return (typeof item?.id === "string" &&
        (item.name === undefined || typeof item.name === "string") &&
        (item.language === undefined || typeof item.language === "string"));
}
function tupleArray(value) {
    return (Array.isArray(value) &&
        value.every((item) => Array.isArray(item) &&
            item.length === 2 &&
            typeof item[0] === "string" &&
            typeof item[1] === "number" &&
            Number.isFinite(item[1])));
}
function stringArray(value) {
    return Array.isArray(value) && value.every((item) => typeof item === "string") ? [...value] : undefined;
}
function objectValue(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value) ? value : undefined;
}
function isJsonObject(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
function isDefined(value) {
    return value !== undefined;
}
//# sourceMappingURL=entities.js.map