import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { ErrorCode, McpError, type ReadResourceResult } from "@modelcontextprotocol/sdk/types.js";
import type { JsonObject } from "../core/dto.js";
import type { RegisteredRequirement, RegisteredScope } from "../core/requirements.js";
import { normalizeStorePath, resolveRealStorePath, WorkspacePathError } from "../io/path.js";
import { workspaceRootFromPath } from "../io/workspace.js";
import { parseSpeckiwiResourceUri, unknownResourceUri } from "./resource-uri.js";
import type { SpecKiwiCore } from "./tools.js";

export async function readMcpResource(uri: string, core: SpecKiwiCore): Promise<ReadResourceResult> {
  const parsed = parseSpeckiwiResourceUri(uri);
  const workspace = workspaceRootFromPath(resolve(core.root));

  try {
    if (parsed.kind === "overview") {
      const target = await resolveRealStorePath(workspace, normalizeStorePath("overview.yaml"));
      return textResource(parsed.uri, "application/yaml", await readFile(target.absolutePath, "utf8"));
    }

    if (parsed.kind === "index") {
      const target = await resolveRealStorePath(workspace, normalizeStorePath("index.yaml"));
      return textResource(parsed.uri, "application/yaml", await readFile(target.absolutePath, "utf8"));
    }

    const registry = await core.loadRequirementRegistry();

    if (parsed.kind === "document") {
      const document = registry.documentsById.get(parsed.id);
      if (document === undefined) {
        throw unknownResourceUri(uri);
      }
      const target = await resolveRealStorePath(workspace, normalizeStorePath(document.path));
      return textResource(parsed.uri, "application/yaml", await readFile(target.absolutePath, "utf8"));
    }

    if (parsed.kind === "requirement") {
      const requirement = registry.requirementsById.get(parsed.id);
      if (requirement === undefined) {
        throw unknownResourceUri(uri);
      }
      return textResource(parsed.uri, "application/json", stableJson(requirementContext(requirement, registry)));
    }

    const scope = registry.scopesById.get(parsed.id);
    if (scope === undefined) {
      throw unknownResourceUri(uri);
    }
    return textResource(parsed.uri, "application/json", stableJson(scopeContext(scope, registry)));
  } catch (error) {
    if (error instanceof McpError) {
      throw error;
    }
    if (error instanceof WorkspacePathError) {
      throw new McpError(ErrorCode.InternalError, error.message, { code: error.code });
    }
    const message = error instanceof Error ? error.message : String(error);
    throw new McpError(ErrorCode.InternalError, message);
  }
}

function textResource(uri: string, mimeType: string, text: string): ReadResourceResult {
  return {
    contents: [
      {
        uri,
        mimeType,
        text
      }
    ]
  };
}

function requirementContext(requirement: RegisteredRequirement, registry: Awaited<ReturnType<SpecKiwiCore["loadRequirementRegistry"]>>): JsonObject {
  const output: JsonObject = {
    id: requirement.id,
    documentId: requirement.documentId,
    path: `.speckiwi/${requirement.path}`,
    requirement: requirement.requirement,
    relations: {
      incoming: registry.incomingRelationsById.get(requirement.id) ?? [],
      outgoing: registry.outgoingRelationsById.get(requirement.id) ?? []
    }
  };
  if (requirement.scope !== undefined) {
    output.scope = requirement.scope;
  }
  return output;
}

function scopeContext(scope: RegisteredScope, registry: Awaited<ReturnType<SpecKiwiCore["loadRequirementRegistry"]>>): JsonObject {
  const output: JsonObject = {
    id: scope.id,
    name: scope.name ?? scope.id,
    type: scope.type ?? "",
    children: registry.scopes.filter((candidate) => candidate.parent === scope.id).map((candidate) => candidate.id).sort(),
    documents: registry.documents.filter((document) => document.scope === scope.id).map((document) => document.id).sort(),
    requirements: registry.requirements.filter((requirement) => requirement.scope === scope.id).map((requirement) => requirement.id).sort()
  };
  if (scope.parent !== undefined) {
    output.parent = scope.parent;
  }
  return output;
}

function stableJson(value: JsonObject): string {
  return `${JSON.stringify(value, objectKeySorter, 2)}\n`;
}

function objectKeySorter(_key: string, value: unknown): unknown {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return value;
  }
  const sorted: JsonObject = {};
  for (const key of Object.keys(value).sort()) {
    sorted[key] = (value as Record<string, unknown>)[key] as JsonObject[string];
  }
  return sorted;
}
