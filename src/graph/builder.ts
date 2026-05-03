import type { Diagnostic, DiagnosticBag, GraphEdge, GraphNode, GraphResult } from "../core/dto.js";
import { createDiagnosticBag, ok } from "../core/result.js";
import { buildRequirementRegistry, type RegisteredDocument, type RegisteredRequirement, type RegisteredScope, type RequirementRegistry } from "../core/requirements.js";
import { validateRegistry, type LoadedWorkspace } from "../validate/semantic.js";
import { graphEdgeKey, graphNodeKey, sortGraphEdges, sortGraphNodes } from "./model.js";

export type GraphType = "document" | "scope" | "requirement" | "dependency" | "traceability";

export function buildGraph(workspace: LoadedWorkspace, graphType: GraphType = "traceability"): GraphResult {
  return buildGraphFromRegistry(
    buildRequirementRegistry(workspace),
    graphType,
    mergeUniqueDiagnosticBags(workspace.diagnostics, validateRegistry(workspace))
  );
}

export function buildGraphFromRegistry(
  registry: RequirementRegistry,
  graphType: GraphType = "traceability",
  diagnostics: DiagnosticBag = createDiagnosticBag()
): GraphResult {
  const allNodes = [
    ...registry.documents.map(documentNode),
    ...registry.scopes.map(scopeNode),
    ...registry.requirements.map(requirementNode)
  ];
  const nodeByKey = new Map(allNodes.map((node) => [node.key, node]));
  const allEdges = [
    ...documentLinkEdges(registry, nodeByKey),
    ...scopeParentEdges(registry, nodeByKey),
    ...documentScopeEdges(registry, nodeByKey),
    ...documentRequirementEdges(registry, nodeByKey),
    ...requirementRelationEdges(registry, nodeByKey)
  ];

  const graph = ok(
    {
      graphType: "traceability" as const,
      nodes: sortGraphNodes(allNodes),
      edges: sortGraphEdges(allEdges)
    },
    diagnostics
  );
  return filterGraphResult(graph, graphType);
}

export function filterGraphResult(graph: GraphResult, graphType: GraphType = "traceability"): GraphResult {
  if (!graph.ok) {
    return graph;
  }

  const nodes = sortGraphNodes(graph.nodes.filter((node) => includesNode(graphType, node)));
  const includedNodeKeys = new Set(nodes.map((node) => node.key));
  const edges = sortGraphEdges(
    graph.edges.filter(
      (edge) =>
        includedNodeKeys.has(edge.source) &&
        includedNodeKeys.has(edge.target) &&
        includesEdge(graphType, edge)
    )
  );

  return ok({ graphType, nodes, edges }, graph.diagnostics);
}

export function deserializeGraphResult(value: unknown): GraphResult | undefined {
  const graph = jsonObjectValue(value);
  if (graph?.ok !== true || !isGraphType(graph.graphType) || !Array.isArray(graph.nodes) || !Array.isArray(graph.edges)) {
    return undefined;
  }
  const nodes = graph.nodes.every(isGraphNode) ? graph.nodes : undefined;
  const edges = graph.edges.every(isGraphEdge) ? graph.edges : undefined;
  const diagnostics = diagnosticBagValue(graph.diagnostics);
  if (nodes === undefined || edges === undefined || diagnostics === undefined) {
    return undefined;
  }
  return ok({ graphType: graph.graphType, nodes, edges }, diagnostics);
}

function mergeUniqueDiagnosticBags(...bags: DiagnosticBag[]): DiagnosticBag {
  const diagnostics = new Map<string, Diagnostic>();
  for (const diagnostic of bags.flatMap((bag) => [...bag.errors, ...bag.warnings, ...bag.infos])) {
    diagnostics.set(diagnosticKey(diagnostic), diagnostic);
  }
  return createDiagnosticBag([...diagnostics.values()]);
}

function diagnosticKey(diagnostic: Diagnostic): string {
  return JSON.stringify([
    diagnostic.severity,
    diagnostic.code,
    diagnostic.path ?? "",
    diagnostic.line ?? null,
    diagnostic.column ?? null,
    diagnostic.message,
    diagnostic.details ?? {}
  ]);
}

function jsonObjectValue(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

function isGraphType(value: unknown): value is GraphType {
  return value === "document" || value === "scope" || value === "requirement" || value === "dependency" || value === "traceability";
}

function isGraphNode(value: unknown): value is GraphNode {
  const node = jsonObjectValue(value);
  return (
    typeof node?.key === "string" &&
    (node.entityType === "document" || node.entityType === "scope" || node.entityType === "requirement") &&
    typeof node.id === "string" &&
    (node.title === undefined || typeof node.title === "string") &&
    (node.documentId === undefined || typeof node.documentId === "string") &&
    (node.path === undefined || typeof node.path === "string") &&
    (node.scope === undefined || typeof node.scope === "string") &&
    (node.status === undefined || typeof node.status === "string")
  );
}

function isGraphEdge(value: unknown): value is GraphEdge {
  const edge = jsonObjectValue(value);
  return (
    typeof edge?.key === "string" &&
    typeof edge.source === "string" &&
    typeof edge.target === "string" &&
    typeof edge.relationType === "string" &&
    (edge.sourceType === "document" || edge.sourceType === "scope" || edge.sourceType === "requirement") &&
    (edge.targetType === "document" || edge.targetType === "scope" || edge.targetType === "requirement") &&
    typeof edge.sourceId === "string" &&
    typeof edge.targetId === "string"
  );
}

function diagnosticBagValue(value: unknown): DiagnosticBag | undefined {
  const bag = jsonObjectValue(value);
  const summary = jsonObjectValue(bag?.summary);
  if (!Array.isArray(bag?.errors) || !Array.isArray(bag.warnings) || !Array.isArray(bag.infos) || summary === undefined) {
    return undefined;
  }
  if (!bag.errors.every(isDiagnostic) || !bag.warnings.every(isDiagnostic) || !bag.infos.every(isDiagnostic)) {
    return undefined;
  }
  if (
    typeof summary.errorCount !== "number" ||
    typeof summary.warningCount !== "number" ||
    typeof summary.infoCount !== "number"
  ) {
    return undefined;
  }
  return {
    errors: bag.errors,
    warnings: bag.warnings,
    infos: bag.infos,
    summary: {
      errorCount: summary.errorCount,
      warningCount: summary.warningCount,
      infoCount: summary.infoCount
    }
  };
}

function isDiagnostic(value: unknown): value is Diagnostic {
  const diagnostic = jsonObjectValue(value);
  return (
    typeof diagnostic?.code === "string" &&
    typeof diagnostic.message === "string" &&
    (diagnostic.severity === "error" || diagnostic.severity === "warning" || diagnostic.severity === "info") &&
    (diagnostic.path === undefined || typeof diagnostic.path === "string") &&
    (diagnostic.line === undefined || typeof diagnostic.line === "number") &&
    (diagnostic.column === undefined || typeof diagnostic.column === "number") &&
    (diagnostic.details === undefined || jsonObjectValue(diagnostic.details) !== undefined)
  );
}

function documentNode(document: RegisteredDocument): GraphNode {
  const node: GraphNode = {
    key: graphNodeKey("document", document.id),
    entityType: "document",
    id: document.id,
    path: document.path
  };
  if (document.title !== undefined) {
    node.title = document.title;
  }
  if (document.scope !== undefined) {
    node.scope = document.scope;
  }
  if (document.status !== undefined) {
    node.status = document.status;
  }
  return node;
}

function scopeNode(scope: RegisteredScope): GraphNode {
  const node: GraphNode = {
    key: graphNodeKey("scope", scope.id),
    entityType: "scope",
    id: scope.id
  };
  if (scope.name !== undefined) {
    node.title = scope.name;
  }
  return node;
}

function requirementNode(requirement: RegisteredRequirement): GraphNode {
  const node: GraphNode = {
    key: graphNodeKey("requirement", requirement.id),
    entityType: "requirement",
    id: requirement.id,
    title: requirement.title,
    documentId: requirement.documentId,
    path: requirement.path,
    status: requirement.status
  };
  if (requirement.scope !== undefined) {
    node.scope = requirement.scope;
  }
  return node;
}

function documentLinkEdges(registry: RequirementRegistry, nodeByKey: Map<string, GraphNode>): GraphEdge[] {
  return registry.documentLinks.flatMap((link) => {
    const source = graphNodeKey("document", link.from);
    const target = graphNodeKey("document", link.to);
    return buildEdge(nodeByKey, source, target, link.type);
  });
}

function scopeParentEdges(registry: RequirementRegistry, nodeByKey: Map<string, GraphNode>): GraphEdge[] {
  return registry.scopes.flatMap((scope) => {
    if (scope.parent === undefined) {
      return [];
    }
    const source = graphNodeKey("scope", scope.parent);
    const target = graphNodeKey("scope", scope.id);
    return buildEdge(nodeByKey, source, target, "contains_scope");
  });
}

function documentScopeEdges(registry: RequirementRegistry, nodeByKey: Map<string, GraphNode>): GraphEdge[] {
  return registry.documents.flatMap((document) => {
    if (document.scope === undefined) {
      return [];
    }
    const source = graphNodeKey("document", document.id);
    const target = graphNodeKey("scope", document.scope);
    return buildEdge(nodeByKey, source, target, "belongs_to_scope");
  });
}

function documentRequirementEdges(registry: RequirementRegistry, nodeByKey: Map<string, GraphNode>): GraphEdge[] {
  return registry.requirements.flatMap((requirement) => {
    const source = graphNodeKey("document", requirement.documentId);
    const target = graphNodeKey("requirement", requirement.id);
    return buildEdge(nodeByKey, source, target, "contains_requirement");
  });
}

function requirementRelationEdges(registry: RequirementRegistry, nodeByKey: Map<string, GraphNode>): GraphEdge[] {
  return registry.requirements.flatMap((requirement) =>
    requirement.relations.flatMap((relation) => {
      const source = graphNodeKey("requirement", requirement.id);
      const target = graphNodeKey("requirement", relation.target);
      return buildEdge(nodeByKey, source, target, relation.type);
    })
  );
}

function buildEdge(nodeByKey: Map<string, GraphNode>, source: string, target: string, relationType: string): GraphEdge[] {
  const sourceNode = nodeByKey.get(source);
  const targetNode = nodeByKey.get(target);
  if (sourceNode === undefined || targetNode === undefined) {
    return [];
  }

  return [
    {
      key: graphEdgeKey(source, relationType, target),
      source,
      target,
      relationType,
      sourceType: sourceNode.entityType,
      targetType: targetNode.entityType,
      sourceId: sourceNode.id,
      targetId: targetNode.id
    }
  ];
}

function includesNode(graphType: GraphType, node: GraphNode): boolean {
  switch (graphType) {
    case "document":
      return node.entityType === "document";
    case "scope":
      return node.entityType === "scope";
    case "requirement":
    case "dependency":
      return node.entityType === "requirement";
    case "traceability":
      return true;
  }
}

function includesEdge(graphType: GraphType, edge: GraphEdge): boolean {
  switch (graphType) {
    case "document":
      return edge.sourceType === "document" && edge.targetType === "document";
    case "scope":
      return edge.sourceType === "scope" && edge.targetType === "scope" && edge.relationType === "contains_scope";
    case "requirement":
      return edge.sourceType === "requirement" && edge.targetType === "requirement";
    case "dependency":
      return edge.sourceType === "requirement" && edge.targetType === "requirement" && edge.relationType === "depends_on";
    case "traceability":
      return true;
  }
}
