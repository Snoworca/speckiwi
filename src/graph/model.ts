import type { GraphEdge, GraphNode } from "../core/dto.js";

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
] as const;

const entityPriority: Record<GraphNode["entityType"], number> = {
  document: 0,
  scope: 1,
  requirement: 2
};

export function graphNodeKey(entityType: GraphNode["entityType"], id: string): string {
  return `${entityType}:${id}`;
}

export function graphEdgeKey(source: string, relationType: string, target: string): string {
  return `${source}|${relationType}|${target}`;
}

export function compareGraphNodes(left: GraphNode, right: GraphNode): number {
  return entityPriority[left.entityType] - entityPriority[right.entityType] || left.id.localeCompare(right.id);
}

export function compareGraphEdges(left: GraphEdge, right: GraphEdge): number {
  return (
    left.source.localeCompare(right.source) ||
    left.target.localeCompare(right.target) ||
    left.relationType.localeCompare(right.relationType) ||
    left.key.localeCompare(right.key)
  );
}

export function relationRank(relationType: string): number {
  const index = relationOrder.indexOf(relationType as (typeof relationOrder)[number]);
  return index === -1 ? relationOrder.length : index;
}

export function sortGraphNodes(nodes: GraphNode[]): GraphNode[] {
  return [...dedupeBy(nodes, (node) => node.key).values()].sort(compareGraphNodes);
}

export function sortGraphEdges(edges: GraphEdge[]): GraphEdge[] {
  return [...dedupeBy(edges, (edge) => edge.key).values()].sort(compareGraphEdges);
}

function dedupeBy<T>(items: T[], keyFor: (item: T) => string): Map<string, T> {
  const result = new Map<string, T>();
  for (const item of items) {
    const key = keyFor(item);
    if (!result.has(key)) {
      result.set(key, item);
    }
  }
  return result;
}
