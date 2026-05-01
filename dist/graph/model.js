export const relationOrder = [
    "depends_on",
    "blocks",
    "relates_to",
    "duplicates",
    "conflicts_with",
    "refines",
    "generalizes",
    "replaces",
    "replaced_by",
    "derived_from",
    "implements",
    "documents",
    "tests",
    "requires_review_with"
];
const entityPriority = {
    document: 0,
    scope: 1,
    requirement: 2
};
export function graphNodeKey(entityType, id) {
    return `${entityType}:${id}`;
}
export function graphEdgeKey(source, relationType, target) {
    return `${source}|${relationType}|${target}`;
}
export function compareGraphNodes(left, right) {
    return entityPriority[left.entityType] - entityPriority[right.entityType] || left.id.localeCompare(right.id);
}
export function compareGraphEdges(left, right) {
    return (left.source.localeCompare(right.source) ||
        left.target.localeCompare(right.target) ||
        left.relationType.localeCompare(right.relationType) ||
        left.key.localeCompare(right.key));
}
export function relationRank(relationType) {
    const index = relationOrder.indexOf(relationType);
    return index === -1 ? relationOrder.length : index;
}
export function sortGraphNodes(nodes) {
    return [...dedupeBy(nodes, (node) => node.key).values()].sort(compareGraphNodes);
}
export function sortGraphEdges(edges) {
    return [...dedupeBy(edges, (edge) => edge.key).values()].sort(compareGraphEdges);
}
function dedupeBy(items, keyFor) {
    const result = new Map();
    for (const item of items) {
        const key = keyFor(item);
        if (!result.has(key)) {
            result.set(key, item);
        }
    }
    return result;
}
//# sourceMappingURL=model.js.map