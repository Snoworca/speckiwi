import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { stringify } from "yaml";
import type {
  DiagnosticBag,
  JsonObject,
  JsonValue,
  ProposalOperation,
  ProposalResult,
  ProposalTarget,
  RequirementType
} from "../core/dto.js";
import type { JsonPatchOperation, ProposeChangeInput } from "../core/inputs.js";
import { createDiagnosticBag, fail, ok } from "../core/result.js";
import { normalizeStorePath, resolveRealStorePath, resolveStorePath, WorkspacePathError, type StorePath, type WorkspaceRoot } from "../io/path.js";
import { loadYamlDocument, type LoadedYamlDocument } from "../io/yaml-loader.js";
import { workspaceRootFromPath } from "../io/workspace.js";
import { validateAgainstSchema } from "../schema/compile.js";
import { loadRequirementRegistry, previewRequirementId, type RequirementRegistry } from "../core/requirements.js";
import { atomicWriteText } from "../io/file-store.js";
import { buildPatchOperations, getJsonPointer, PatchError, parseJsonPointer } from "./patch.js";
import { canonicalJsonHash, fileSha256 } from "./hash.js";

export type ValidWorkspace = WorkspaceRoot;

export type ProposalStatus = "proposed" | "accepted" | "applied" | "rejected" | "superseded";

export type ProposalBaseTarget = {
  entityType: "requirement" | "document" | "manifest";
  jsonPointer: string;
  id?: string;
};

export type ProposalBase = {
  documentPath: string;
  target: ProposalBaseTarget;
  documentHash: string;
  targetHash: string;
  schemaVersion: string;
  generatedAt: string;
  documentId?: string;
};

export type ProposalDocument = {
  schemaVersion: "speckiwi/proposal/v1";
  id: string;
  type: "proposal";
  status: ProposalStatus;
  operation: ProposalOperation;
  target: ProposalTarget;
  base: ProposalBase;
  changes: JsonPatchOperation[];
  reason: string;
  metadata?: JsonObject;
};

type ResolvedProposalBase = {
  target: ProposalTarget;
  base: ProposalBase;
};

const proposalSchemaVersion = "speckiwi/proposal/v1";
const allowedOperations = new Set<ProposalOperation>([
  "create_requirement",
  "update_requirement",
  "change_requirement_status",
  "add_relation",
  "remove_relation",
  "update_document"
]);

export async function createProposal(input: ProposeChangeInput, workspace?: ValidWorkspace): Promise<ProposalResult> {
  const root = workspace ?? workspaceRootFromPath(resolve(input.root ?? process.cwd()));

  try {
    const proposal = await buildProposalDocument(input, root);
    const diagnostics = validateAgainstSchema("proposal", proposal);
    if (diagnostics.summary.errorCount > 0) {
      return fail({ code: "PROPOSAL_SCHEMA_INVALID", message: "Generated proposal does not satisfy the proposal schema." }, diagnostics);
    }

    const storePath = normalizeStorePath(`proposals/${proposalFilename(proposal)}`);
    const lexicalPath = resolveStorePath(root, storePath);
    await mkdir(resolve(root.speckiwiPath, "proposals"), { recursive: true });
    const proposalPath = await resolveRealStorePath(root, storePath);
    await atomicWriteText(proposalPath.absolutePath, `${stringify(proposal, { lineWidth: 0 }).trimEnd()}\n`);

    return ok({
      mode: "propose",
      applied: false,
      proposal: {
        id: proposal.id,
        path: `.speckiwi/${lexicalPath.storePath}`,
        operation: proposal.operation,
        target: proposal.target
      }
    });
  } catch (error) {
    return proposalFailure(error);
  }
}

export async function buildProposalDocument(
  input: ProposeChangeInput,
  workspace: ValidWorkspace,
  options: { generatedAt?: string } = {}
): Promise<ProposalDocument> {
  const reason = input.reason.trim();
  if (reason.length === 0) {
    throw new ProposalError("PROPOSAL_REASON_REQUIRED", "Proposal reason is required.");
  }
  if (!allowedOperations.has(input.operation)) {
    throw new ProposalError("UNSUPPORTED_PROPOSAL_OPERATION", `Unsupported proposal operation: ${String(input.operation)}`);
  }

  const changes = buildPatchOperations(input);
  const generatedAt = options.generatedAt ?? new Date().toISOString();
  const resolved = await resolveProposalBase(input, workspace, changes, generatedAt);
  const id = proposalId(generatedAt, input.operation, proposalTargetSegment(resolved.target));

  return {
    schemaVersion: proposalSchemaVersion,
    id,
    type: "proposal",
    status: "proposed",
    operation: input.operation,
    target: resolved.target,
    base: resolved.base,
    changes,
    reason
  };
}

export async function readProposalAt(root: WorkspaceRoot, storePath: StorePath): Promise<ProposalDocument> {
  const loaded = await loadYamlDocument(resolveStorePath(root, storePath));
  const proposal = proposalDocumentFromValue(loaded.value);
  const diagnostics = validateAgainstSchema("proposal", proposal ?? {});
  if (proposal === undefined || diagnostics.summary.errorCount > 0) {
    throw new ProposalError("PROPOSAL_SCHEMA_INVALID", "Stored proposal does not satisfy the proposal schema.", diagnostics);
  }
  try {
    parseJsonPointer(proposal.base.target.jsonPointer);
    buildPatchOperations({ changes: proposal.changes });
  } catch (error) {
    if (error instanceof PatchError) {
      throw new ProposalError(error.code, error.message, diagnosticBag(error.code, error.message));
    }
    throw error;
  }
  return proposal;
}

export async function loadTargetDocument(root: WorkspaceRoot, storePath: string): Promise<LoadedYamlDocument> {
  return loadYamlDocument(resolveStorePath(root, normalizeStorePath(storePath)));
}

export async function currentTargetHash(root: WorkspaceRoot, proposal: ProposalDocument): Promise<string> {
  if (proposal.operation === "create_requirement" && proposal.target.kind === "requirement") {
    const requirementId = proposal.target.requirementId ?? proposal.base.target.id;
    if (requirementId === undefined) {
      return canonicalJsonHash(null);
    }
    const registry = await loadRequirementRegistry({ root: root.rootPath });
    return registry.requirementsById.has(requirementId)
      ? canonicalJsonHash(registry.requirementsById.get(requirementId)?.requirement)
      : canonicalJsonHash(null);
  }

  const loaded = await loadTargetDocument(root, proposal.base.documentPath);
  if (loaded.value === undefined) {
    throw new ProposalError("PROPOSAL_TARGET_INVALID", `Target document is invalid: ${proposal.base.documentPath}`);
  }

  if (proposal.base.target.entityType === "document" || proposal.base.target.entityType === "manifest") {
    return canonicalJsonHash(loaded.value);
  }

  return canonicalJsonHash(getJsonPointer(loaded.value, proposal.base.target.jsonPointer));
}

export async function currentDocumentHash(root: WorkspaceRoot, proposal: ProposalDocument): Promise<string> {
  return storeFileSha256(root, proposal.base.documentPath);
}

async function storeFileSha256(root: WorkspaceRoot, storePath: string): Promise<string> {
  return fileSha256((await resolveRealStorePath(root, normalizeStorePath(storePath))).absolutePath);
}

async function resolveProposalBase(
  input: ProposeChangeInput,
  root: WorkspaceRoot,
  changes: JsonPatchOperation[],
  generatedAt: string
): Promise<ResolvedProposalBase> {
  if (input.operation === "create_requirement") {
    return resolveCreateRequirementBase(input, root, changes, generatedAt);
  }

  if (
    input.operation === "update_requirement" ||
    input.operation === "change_requirement_status" ||
    input.operation === "add_relation" ||
    input.operation === "remove_relation"
  ) {
    return resolveExistingRequirementBase(input, root, generatedAt);
  }

  return resolveDocumentBase(input, root, changes, generatedAt);
}

async function resolveCreateRequirementBase(
  input: ProposeChangeInput,
  root: WorkspaceRoot,
  changes: JsonPatchOperation[],
  generatedAt: string
): Promise<ResolvedProposalBase> {
  if (input.target.kind !== "requirement") {
    throw new ProposalError("INVALID_PROPOSAL_TARGET", "create_requirement requires target.kind=requirement.");
  }

  const registry = await loadRequirementRegistry({ root: root.rootPath });
  const document = targetSrsDocument(input.target, registry);
  if (document === undefined) {
    throw new ProposalError("PROPOSAL_TARGET_NOT_FOUND", "No SRS document matches the create_requirement target.");
  }

  const addOperation = changes.find((operation) => operation.op === "add" && (operation.path === "/requirements/-" || /^\/requirements\/\d+$/.test(operation.path)));
  if (addOperation === undefined || addOperation.op !== "add" || !isJsonObject(addOperation.value)) {
    throw new ProposalError("INVALID_PATCH", "create_requirement requires an add operation with a requirement object value.");
  }

  const requirementType = requirementTypeFrom(addOperation.value.type);
  if (requirementType === undefined) {
    throw new ProposalError("INVALID_REQUIREMENT_TYPE", "create_requirement value.type must be a supported requirement type.");
  }

  const requestedId = firstString(input.target.requirementId, stringValue(addOperation.value.id));
  const requirementId =
    requestedId ??
    generatedRequirementId(
      {
        requirementType,
        scope: document.scope ?? input.target.scope ?? "general"
      },
      registry
    );

  if (registry.requirementsById.has(requirementId)) {
    throw new ProposalError("DUPLICATE_REQUIREMENT_ID", `Requirement id already exists: ${requirementId}`);
  }

  addOperation.value = { ...addOperation.value, id: requirementId };
  const targetInput: { kind: "requirement"; requirementId: string; documentId: string; scope?: string } = {
    kind: "requirement",
    requirementId,
    documentId: document.id
  };
  if (document.scope !== undefined) {
    targetInput.scope = document.scope;
  }
  const target = requirementTarget(targetInput);
  const documentPath = document.path;

  return {
    target,
    base: {
      documentId: document.id,
      documentPath,
      target: {
        entityType: "requirement",
        id: requirementId,
        jsonPointer: "/requirements"
      },
      documentHash: await storeFileSha256(root, documentPath),
      targetHash: canonicalJsonHash(null),
      schemaVersion: await schemaVersionFor(root, documentPath),
      generatedAt
    }
  };
}

async function resolveExistingRequirementBase(input: ProposeChangeInput, root: WorkspaceRoot, generatedAt: string): Promise<ResolvedProposalBase> {
  if (input.target.kind !== "requirement" || input.target.requirementId === undefined) {
    throw new ProposalError("INVALID_PROPOSAL_TARGET", `${input.operation} requires target.kind=requirement and target.requirementId.`);
  }

  const registry = await loadRequirementRegistry({ root: root.rootPath });
  const requirement = registry.requirementsById.get(input.target.requirementId);
  if (requirement === undefined) {
    throw new ProposalError("REQUIREMENT_NOT_FOUND", `Requirement not found: ${input.target.requirementId}.`);
  }

  const document = registry.documentsById.get(requirement.documentId);
  if (document === undefined) {
    throw new ProposalError("PROPOSAL_TARGET_NOT_FOUND", `Containing document not found for ${input.target.requirementId}.`);
  }

  const pointer = await requirementPointer(root, document.path, input.target.requirementId);
  const targetInput: { kind: "requirement"; requirementId: string; documentId: string; scope?: string } = {
    kind: "requirement",
    requirementId: input.target.requirementId,
    documentId: requirement.documentId
  };
  if (requirement.scope !== undefined) {
    targetInput.scope = requirement.scope;
  }
  const target = requirementTarget(targetInput);

  return {
    target,
    base: {
      documentId: document.id,
      documentPath: document.path,
      target: {
        entityType: "requirement",
        id: input.target.requirementId,
        jsonPointer: pointer
      },
      documentHash: await storeFileSha256(root, document.path),
      targetHash: canonicalJsonHash(requirement.requirement),
      schemaVersion: await schemaVersionFor(root, document.path),
      generatedAt
    }
  };
}

async function resolveDocumentBase(
  input: ProposeChangeInput,
  root: WorkspaceRoot,
  changes: JsonPatchOperation[],
  generatedAt: string
): Promise<ResolvedProposalBase> {
  const firstPointer = changes[0]?.path;
  if (firstPointer === undefined) {
    throw new ProposalError("INVALID_PATCH", "update_document requires at least one patch operation.");
  }
  parseJsonPointer(firstPointer);

  if (input.target.kind === "manifest") {
    const documentPath = "index.yaml";
    const loaded = await loadTargetDocument(root, documentPath);
    if (loaded.value === undefined) {
      throw new ProposalError("PROPOSAL_TARGET_INVALID", "index.yaml is invalid.");
    }
    return {
      target: { kind: "manifest" },
      base: {
        documentPath,
        target: {
          entityType: "manifest",
          jsonPointer: firstPointer
        },
        documentHash: await storeFileSha256(root, documentPath),
        targetHash: canonicalJsonHash(loaded.value),
        schemaVersion: await schemaVersionFor(root, documentPath),
        generatedAt
      }
    };
  }

  if (input.target.kind !== "document") {
    throw new ProposalError("INVALID_PROPOSAL_TARGET", "update_document requires target.kind=document or target.kind=manifest.");
  }

  const registry = await loadRequirementRegistry({ root: root.rootPath });
  const document = registry.documentsById.get(input.target.documentId);
  if (document === undefined) {
    throw new ProposalError("DOCUMENT_NOT_FOUND", `Document not found: ${input.target.documentId}.`);
  }

  const loaded = await loadTargetDocument(root, document.path);
  if (loaded.value === undefined) {
    throw new ProposalError("PROPOSAL_TARGET_INVALID", `Target document is invalid: ${document.path}`);
  }

  return {
    target: { kind: "document", documentId: document.id },
    base: {
      documentId: document.id,
      documentPath: document.path,
      target: {
        entityType: "document",
        id: document.id,
        jsonPointer: firstPointer
      },
      documentHash: await storeFileSha256(root, document.path),
      targetHash: canonicalJsonHash(loaded.value),
      schemaVersion: await schemaVersionFor(root, document.path),
      generatedAt
    }
  };
}

async function schemaVersionFor(root: WorkspaceRoot, storePath: string): Promise<string> {
  const loaded = await loadTargetDocument(root, storePath);
  return isJsonObject(loaded.value) && typeof loaded.value.schemaVersion === "string" ? loaded.value.schemaVersion : "";
}

async function requirementPointer(root: WorkspaceRoot, documentPath: string, requirementId: string): Promise<string> {
  const loaded = await loadTargetDocument(root, documentPath);
  if (!isJsonObject(loaded.value) || !Array.isArray(loaded.value.requirements)) {
    throw new ProposalError("PROPOSAL_TARGET_INVALID", `SRS document has no requirements array: ${documentPath}`);
  }

  const index = loaded.value.requirements.findIndex((item) => isJsonObject(item) && item.id === requirementId);
  if (index === -1) {
    throw new ProposalError("REQUIREMENT_NOT_FOUND", `Requirement not found in target document: ${requirementId}.`);
  }
  return `/requirements/${index}`;
}

function targetSrsDocument(target: ProposalTarget, registry: RequirementRegistry): { id: string; path: string; scope?: string } | undefined {
  if (target.kind !== "requirement") {
    return undefined;
  }

  const byDocumentId =
    target.documentId === undefined
      ? undefined
      : registry.documents.find((document) => document.id === target.documentId && document.type === "srs");
  if (byDocumentId !== undefined) {
    return srsDocumentTarget(byDocumentId);
  }

  if (target.scope === undefined) {
    return undefined;
  }

  const byScope = registry.documents.find((document) => document.type === "srs" && document.scope === target.scope);
  return byScope === undefined ? undefined : srsDocumentTarget(byScope);
}

function srsDocumentTarget(document: { id: string; path: string; scope?: string }): { id: string; path: string; scope?: string } {
  const target = { id: document.id, path: document.path } as { id: string; path: string; scope?: string };
  if (document.scope !== undefined) {
    target.scope = document.scope;
  }
  return target;
}

function generatedRequirementId(input: { requirementType: RequirementType; scope: string }, registry: RequirementRegistry): string {
  const result = previewRequirementId(input, registry);
  if (!result.ok) {
    throw new ProposalError(result.error.code, result.error.message);
  }
  return result.id;
}

function requirementTarget(value: { kind: "requirement"; requirementId?: string; documentId?: string; scope?: string }): ProposalTarget {
  const target: Extract<ProposalTarget, { kind: "requirement" }> = { kind: "requirement" };
  if (value.requirementId !== undefined) {
    target.requirementId = value.requirementId;
  }
  if (value.documentId !== undefined) {
    target.documentId = value.documentId;
  }
  if (value.scope !== undefined) {
    target.scope = value.scope;
  }
  return target;
}

function proposalFailure(error: unknown): ReturnType<typeof fail> {
  if (error instanceof ProposalError) {
    return fail({ code: error.code, message: error.message }, error.diagnostics ?? diagnosticBag(error.code, error.message));
  }

  if (error instanceof WorkspacePathError) {
    return fail({ code: error.code, message: error.message }, diagnosticBag(error.code, error.message));
  }

  if (error instanceof PatchError) {
    return fail({ code: error.code, message: error.message }, diagnosticBag(error.code, error.message));
  }

  const message = error instanceof Error ? error.message : String(error);
  return fail({ code: "PROPOSAL_FAILED", message }, diagnosticBag("PROPOSAL_FAILED", message));
}

function diagnosticBag(code: string, message: string): DiagnosticBag {
  return createDiagnosticBag([{ severity: "error", code, message }]);
}

function proposalDocumentFromValue(value: JsonValue | undefined): ProposalDocument | undefined {
  return isJsonObject(value) ? (value as ProposalDocument) : undefined;
}

function proposalFilename(proposal: ProposalDocument): string {
  const target = proposalTargetSegment(proposal.target);
  return `${timestampSegment(proposal.base.generatedAt)}.${proposal.operation}.${target}.yaml`;
}

function proposalId(generatedAt: string, operation: ProposalOperation, target: string): string {
  return `proposal.${timestampSegment(generatedAt)}.${operation}.${target}`;
}

function proposalTargetSegment(target: ProposalTarget): string {
  if (target.kind === "manifest") {
    return "manifest";
  }
  return sanitizeSegment(target.kind === "document" ? target.documentId : target.requirementId ?? target.documentId ?? target.scope ?? "requirement");
}

function timestampSegment(value: string): string {
  return sanitizeSegment(value);
}

function sanitizeSegment(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "target";
}

function firstString(...values: Array<string | undefined>): string | undefined {
  return values.find((value) => value !== undefined && value.length > 0);
}

function stringValue(value: JsonValue | undefined): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function requirementTypeFrom(value: JsonValue | undefined): RequirementType | undefined {
  return isRequirementType(value) ? value : undefined;
}

function isRequirementType(value: unknown): value is RequirementType {
  return (
    value === "functional" ||
    value === "non_functional" ||
    value === "interface" ||
    value === "data" ||
    value === "constraint" ||
    value === "security" ||
    value === "performance" ||
    value === "reliability" ||
    value === "usability" ||
    value === "maintainability" ||
    value === "operational" ||
    value === "compliance" ||
    value === "migration" ||
    value === "observability"
  );
}

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export class ProposalError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly diagnostics?: DiagnosticBag
  ) {
    super(message);
    this.name = "ProposalError";
  }
}
