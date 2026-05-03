import type { ImpactInput } from "../core/inputs.js";
import type { DiagnosticBag, GraphEdge, GraphNode, GraphResult, ImpactItem, ImpactResult } from "../core/dto.js";
import { createDiagnosticBag, fail, ok } from "../core/result.js";
import { mergeDiagnosticBags } from "../validate/diagnostics.js";
import { compareGraphEdges, relationRank, sortGraphEdges, sortGraphNodes } from "./model.js";

type ImpactTransition = {
  edge: GraphEdge;
  nextKey: string;
  transitive: boolean;
};

const impactRules: Record<string, { source: boolean; target: boolean; transitive: boolean }> = {
  depends_on: { source: false, target: true, transitive: true },
  blocks: { source: true, target: false, transitive: true },
  relates_to: { source: true, target: true, transitive: false },
  duplicates: { source: true, target: true, transitive: false },
  conflicts_with: { source: true, target: true, transitive: false },
  refines: { source: false, target: true, transitive: true },
  generalizes: { source: true, target: false, transitive: true },
  replaces: { source: false, target: true, transitive: false },
  replaced_by: { source: true, target: false, transitive: false },
  derived_from: { source: false, target: true, transitive: true },
  implements: { source: false, target: true, transitive: true },
  documents: { source: false, target: true, transitive: false },
  tests: { source: false, target: true, transitive: false },
  requires_review_with: { source: true, target: true, transitive: false }
};

export function impactRequirement(input: ImpactInput, graph: GraphResult): ImpactResult {
  if (!graph.ok) {
    return fail(graph.error, graph.diagnostics);
  }

  const requirementId = input.id;
  const rootKey = `requirement:${requirementId}`;
  const nodeByKey = new Map(graph.nodes.map((node) => [node.key, node]));
  if (nodeByKey.get(rootKey)?.entityType !== "requirement") {
    return requirementNotFound(requirementId, graph.diagnostics);
  }

  const maxDepth = normalizeDepth(input.depth);
  const requirementEdges = graph.edges.filter((edge) => edge.sourceType === "requirement" && edge.targetType === "requirement");
  const impactedByKey = new Map<string, ImpactItem>();
  const traversalEdgeKeys = new Set<string>();
  const queue: { key: string; id: string; depth: number; via: string[] }[] = [{ key: rootKey, id: requirementId, depth: 0, via: [requirementId] }];
  const expanded = new Set<string>();

  for (let index = 0; index < queue.length; index += 1) {
    const current = queue[index];
    if (current === undefined || current.depth >= maxDepth || expanded.has(current.key)) {
      continue;
    }
    expanded.add(current.key);

    for (const transition of impactTransitions(current.key, requirementEdges)) {
      const nextNode = nodeByKey.get(transition.nextKey);
      if (nextNode === undefined || nextNode.entityType !== "requirement") {
        continue;
      }
      const nextDepth = current.depth + 1;
      const via = [...current.via, nextNode.id];
      traversalEdgeKeys.add(transition.edge.key);

      if (transition.nextKey !== rootKey) {
        const existing = impactedByKey.get(transition.nextKey);
        if (
          existing === undefined ||
          nextDepth < existing.depth ||
          (nextDepth === existing.depth && via.join("\0").localeCompare(existing.via.join("\0")) < 0)
        ) {
          const item: ImpactItem = {
            id: nextNode.id,
            depth: nextDepth,
            via,
            relationType: transition.edge.relationType
          };
          if (nextNode.path !== undefined) {
            item.path = nextNode.path;
          }
          impactedByKey.set(transition.nextKey, item);
        }
      }

      if (transition.transitive && !expanded.has(transition.nextKey)) {
        queue.push({ key: transition.nextKey, id: nextNode.id, depth: nextDepth, via });
      }
    }
  }

  const impacted = [...impactedByKey.values()].sort((left, right) => left.depth - right.depth || left.id.localeCompare(right.id));
  const context = buildImpactContext(graph.nodes, graph.edges, rootKey, new Set(impactedByKey.keys()), traversalEdgeKeys, {
    includeDocuments: input.includeDocuments !== false,
    includeScopes: input.includeScopes !== false
  });

  return ok(
    {
      root: requirementId,
      requirementId,
      impacted,
      nodes: context.nodes,
      edges: context.edges
    },
    graph.diagnostics
  );
}

function impactTransitions(currentKey: string, edges: GraphEdge[]): ImpactTransition[] {
  const transitions: ImpactTransition[] = [];
  for (const edge of edges) {
    const rule = impactRules[edge.relationType];
    if (rule === undefined) {
      continue;
    }
    if (edge.source === currentKey && rule.source) {
      transitions.push({ edge, nextKey: edge.target, transitive: rule.transitive });
    }
    if (edge.target === currentKey && rule.target) {
      transitions.push({ edge, nextKey: edge.source, transitive: rule.transitive });
    }
  }

  return transitions.sort(
    (left, right) =>
      relationRank(left.edge.relationType) - relationRank(right.edge.relationType) ||
      left.nextKey.localeCompare(right.nextKey) ||
      compareGraphEdges(left.edge, right.edge)
  );
}

function buildImpactContext(
  nodes: GraphNode[],
  edges: GraphEdge[],
  rootKey: string,
  impactedKeys: Set<string>,
  traversalEdgeKeys: Set<string>,
  options: { includeDocuments: boolean; includeScopes: boolean }
): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const nodeByKey = new Map(nodes.map((node) => [node.key, node]));
  const edgeByKey = new Map(edges.map((edge) => [edge.key, edge]));
  const includedNodeKeys = new Set<string>([rootKey, ...impactedKeys]);
  const includedEdgeKeys = new Set<string>(traversalEdgeKeys);

  if (options.includeDocuments) {
    for (const edge of edges) {
      if (edge.relationType === "contains_requirement" && includedNodeKeys.has(edge.target)) {
        includedNodeKeys.add(edge.source);
        includedEdgeKeys.add(edge.key);
      }
    }
  }

  if (options.includeScopes) {
    for (const key of [...includedNodeKeys]) {
      const node = nodeByKey.get(key);
      if (node?.scope !== undefined) {
        includedNodeKeys.add(`scope:${node.scope}`);
      }
    }

    let changed = true;
    while (changed) {
      changed = false;
      for (const edge of edges) {
        if (edge.relationType === "belongs_to_scope" && includedNodeKeys.has(edge.source)) {
          changed = addToSet(includedNodeKeys, edge.target) || changed;
          includedEdgeKeys.add(edge.key);
        }
        if (edge.relationType === "contains_scope" && includedNodeKeys.has(edge.target)) {
          changed = addToSet(includedNodeKeys, edge.source) || changed;
          includedEdgeKeys.add(edge.key);
        }
      }
    }
  }

  const contextNodes = [...includedNodeKeys]
    .map((key) => nodeByKey.get(key))
    .filter(isDefined)
    .filter((node) => options.includeDocuments || node.entityType !== "document")
    .filter((node) => options.includeScopes || node.entityType !== "scope");
  const contextNodeKeys = new Set(contextNodes.map((node) => node.key));
  const contextEdges = [...includedEdgeKeys]
    .map((key) => edgeByKey.get(key))
    .filter(isDefined)
    .filter((edge) => contextNodeKeys.has(edge.source) && contextNodeKeys.has(edge.target));

  return {
    nodes: sortGraphNodes(contextNodes),
    edges: sortGraphEdges(contextEdges)
  };
}

function addToSet(set: Set<string>, value: string): boolean {
  const sizeBefore = set.size;
  set.add(value);
  return set.size !== sizeBefore;
}

function normalizeDepth(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 5;
  }
  return Math.min(Math.max(Math.trunc(value), 0), 5);
}

function requirementNotFound(id: string, graphDiagnostics: DiagnosticBag = createDiagnosticBag()): ImpactResult {
  const diagnostics = createDiagnosticBag([
    {
      severity: "error",
      code: "REQUIREMENT_NOT_FOUND",
      message: `Requirement not found: ${id}.`,
      details: { id }
    }
  ]);
  return fail({ code: "REQUIREMENT_NOT_FOUND", message: `Requirement not found: ${id}.`, details: { id } }, mergeDiagnosticBags(graphDiagnostics, diagnostics));
}

function isDefined<T>(value: T | undefined): value is T {
  return value !== undefined;
}
