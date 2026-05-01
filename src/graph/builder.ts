import type { GraphEdge, GraphNode, GraphResult } from "../core/dto.js";
import { ok } from "../core/result.js";
import { buildRequirementRegistry, type RegisteredDocument, type RegisteredRequirement, type RegisteredScope, type RequirementRegistry } from "../core/requirements.js";
import type { LoadedWorkspace } from "../validate/semantic.js";
import { graphEdgeKey, graphNodeKey, sortGraphEdges, sortGraphNodes } from "./model.js";

export type GraphType = "document" | "scope" | "requirement" | "dependency" | "traceability";

export function buildGraph(workspace: LoadedWorkspace, graphType: GraphType = "traceability"): GraphResult {
  return buildGraphFromRegistry(buildRequirementRegistry(workspace), graphType);
}

export function buildGraphFromRegistry(registry: RequirementRegistry, graphType: GraphType = "traceability"): GraphResult {
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

  const nodes = sortGraphNodes(allNodes.filter((node) => includesNode(graphType, node)));
  const includedNodeKeys = new Set(nodes.map((node) => node.key));
  const edges = sortGraphEdges(
    allEdges.filter(
      (edge) =>
        includedNodeKeys.has(edge.source) &&
        includedNodeKeys.has(edge.target) &&
        includesEdge(graphType, edge)
    )
  );

  return ok({
    graphType,
    nodes,
    edges
  });
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
