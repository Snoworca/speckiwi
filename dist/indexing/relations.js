const RELATION_INDEX_FORMAT = "speckiwi/relations/v1";
export function buildRelationIndex(registry) {
    return {
        format: RELATION_INDEX_FORMAT,
        incoming: [...registry.incomingRelationsById.entries()]
            .map(([id, relations]) => [id, relations.map(cloneRelation)])
            .sort(compareRelationEntry),
        outgoing: [...registry.outgoingRelationsById.entries()]
            .map(([id, relations]) => [id, relations.map(cloneRelation)])
            .sort(compareRelationEntry)
    };
}
export function deserializeRelationIndex(value) {
    const index = objectValue(value);
    if (index?.format !== RELATION_INDEX_FORMAT || !relationEntryArray(index.incoming) || !relationEntryArray(index.outgoing)) {
        return undefined;
    }
    const incoming = index.incoming.map(([id, relations]) => [id, relations.map(cloneRelation)]);
    const outgoing = index.outgoing.map(([id, relations]) => [id, relations.map(cloneRelation)]);
    return {
        format: RELATION_INDEX_FORMAT,
        incoming,
        outgoing,
        incomingById: new Map(incoming),
        outgoingById: new Map(outgoing)
    };
}
function relationEntryArray(value) {
    return (Array.isArray(value) &&
        value.every((item) => Array.isArray(item) &&
            item.length === 2 &&
            typeof item[0] === "string" &&
            Array.isArray(item[1]) &&
            item[1].every(isRelation)));
}
function isRelation(value) {
    const item = objectValue(value);
    return (typeof item?.type === "string" &&
        typeof item.target === "string" &&
        (item.source === undefined || typeof item.source === "string") &&
        (item.description === undefined || typeof item.description === "string"));
}
function cloneRelation(relation) {
    return {
        type: relation.type,
        target: relation.target,
        ...(relation.source === undefined ? {} : { source: relation.source }),
        ...(relation.description === undefined ? {} : { description: relation.description })
    };
}
function compareRelationEntry(left, right) {
    return left[0].localeCompare(right[0]);
}
function objectValue(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value) ? value : undefined;
}
//# sourceMappingURL=relations.js.map