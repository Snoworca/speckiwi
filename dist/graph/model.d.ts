import type { GraphEdge, GraphNode } from "../core/dto.js";
export declare const relationOrder: readonly ["depends_on", "blocks", "relates_to", "duplicates", "conflicts_with", "refines", "generalizes", "replaces", "replaced_by", "derived_from", "implements", "documents", "tests", "requires_review_with"];
export declare function graphNodeKey(entityType: GraphNode["entityType"], id: string): string;
export declare function graphEdgeKey(source: string, relationType: string, target: string): string;
export declare function compareGraphNodes(left: GraphNode, right: GraphNode): number;
export declare function compareGraphEdges(left: GraphEdge, right: GraphEdge): number;
export declare function relationRank(relationType: string): number;
export declare function sortGraphNodes(nodes: GraphNode[]): GraphNode[];
export declare function sortGraphEdges(edges: GraphEdge[]): GraphEdge[];
//# sourceMappingURL=model.d.ts.map