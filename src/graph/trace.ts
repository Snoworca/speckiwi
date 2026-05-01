import type { TraceRequirementInput } from "../core/inputs.js";
import type { GraphEdge, GraphNode, GraphResult, TraceDirection, TraceResult } from "../core/dto.js";
import { createDiagnosticBag, fail, ok } from "../core/result.js";
import { compareGraphEdges, relationRank, sortGraphEdges, sortGraphNodes } from "./model.js";

export function traceRequirement(input: TraceRequirementInput, graph: GraphResult): TraceResult {
  if (!graph.ok) {
    return fail(graph.error, graph.diagnostics);
  }

  const requirementId = input.id;
  const rootKey = `requirement:${requirementId}`;
  const requirementNodes = graph.nodes.filter((node) => node.entityType === "requirement");
  const nodeByKey = new Map(requirementNodes.map((node) => [node.key, node]));
  const root = nodeByKey.get(rootKey);
  if (root === undefined) {
    return requirementNotFound(requirementId);
  }

  const requirementEdges = graph.edges.filter((edge) => edge.sourceType === "requirement" && edge.targetType === "requirement");
  const direction = input.direction ?? "both";
  const depth = normalizeDepth(input.depth);
  const nodeKeys = new Set([root.key]);
  const edgeKeys = new Set<string>();
  const edgesByKey = new Map(requirementEdges.map((edge) => [edge.key, edge]));

  if (direction === "upstream" || direction === "both") {
    traverse(root.key, "upstream", depth, requirementEdges, nodeByKey, nodeKeys, edgeKeys);
  }
  if (direction === "downstream" || direction === "both") {
    traverse(root.key, "downstream", depth, requirementEdges, nodeByKey, nodeKeys, edgeKeys);
  }

  return ok({
    root: requirementId,
    requirementId,
    direction,
    depth,
    nodes: sortGraphNodes([...nodeKeys].map((key) => nodeByKey.get(key)).filter(isDefined)),
    edges: sortGraphEdges([...edgeKeys].map((key) => edgesByKey.get(key)).filter(isDefined))
  });
}

function traverse(
  rootKey: string,
  direction: Exclude<TraceDirection, "both">,
  maxDepth: number,
  edges: GraphEdge[],
  nodeByKey: Map<string, GraphNode>,
  nodeKeys: Set<string>,
  edgeKeys: Set<string>
): void {
  const queue: { key: string; depth: number }[] = [{ key: rootKey, depth: 0 }];
  const seen = new Set([rootKey]);

  for (let index = 0; index < queue.length; index += 1) {
    const current = queue[index];
    if (current === undefined || current.depth >= maxDepth) {
      continue;
    }

    for (const edge of adjacentEdges(current.key, direction, edges)) {
      const nextKey = direction === "upstream" ? edge.target : edge.source;
      if (!nodeByKey.has(nextKey)) {
        continue;
      }
      edgeKeys.add(edge.key);
      nodeKeys.add(nextKey);
      if (!seen.has(nextKey)) {
        seen.add(nextKey);
        queue.push({ key: nextKey, depth: current.depth + 1 });
      }
    }
  }
}

function adjacentEdges(key: string, direction: Exclude<TraceDirection, "both">, edges: GraphEdge[]): GraphEdge[] {
  const adjacent = direction === "upstream" ? edges.filter((edge) => edge.source === key) : edges.filter((edge) => edge.target === key);
  return adjacent.sort(
    (left, right) =>
      relationRank(left.relationType) - relationRank(right.relationType) ||
      nextKey(left, direction).localeCompare(nextKey(right, direction)) ||
      compareGraphEdges(left, right)
  );
}

function nextKey(edge: GraphEdge, direction: Exclude<TraceDirection, "both">): string {
  return direction === "upstream" ? edge.target : edge.source;
}

function normalizeDepth(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 1;
  }
  return Math.min(Math.max(Math.trunc(value), 0), 5);
}

function requirementNotFound(id: string): TraceResult {
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

function isDefined<T>(value: T | undefined): value is T {
  return value !== undefined;
}
