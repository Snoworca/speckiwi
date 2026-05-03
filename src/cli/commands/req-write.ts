import type { Command } from "commander";
import type { JsonObject, RequirementType } from "../../core/dto.js";
import type { JsonPatchOperation, ProposeChangeInput } from "../../core/inputs.js";
import { applyChange } from "../../core/apply-change.js";
import { createProposal } from "../../core/propose-change.js";
import { loadRequirementRegistry, previewRequirementId } from "../../core/requirements.js";
import { normalizeStorePath, resolveStorePath } from "../../io/path.js";
import { loadYamlDocument } from "../../io/yaml-loader.js";
import { workspaceRootFromPath } from "../../io/workspace.js";
import { addCommonOptions, CliUsageError, executeCliCommand, optionalString } from "../options.js";

export function registerRequirementWriteCommands(program: Command): void {
  const req = program.name() === "req" ? program : program.commands.find((command) => command.name() === "req") ?? program.command("req");

  const create = addCommonOptions(req.command("create").description("create a requirement proposal or apply it"))
    .requiredOption("--scope <scope>", "target SRS scope")
    .option("--document-id <id>", "target SRS document id")
    .requiredOption("--type <type>", "requirement type")
    .requiredOption("--title <title>", "requirement title")
    .requiredOption("--statement <statement>", "requirement statement")
    .option("--id <id>", "explicit requirement id")
    .option("--status <status>", "requirement status", "draft")
    .option("--priority <priority>", "requirement priority")
    .option("--rationale <text>", "requirement rationale")
    .option("--description <text>", "requirement description")
    .option("--acceptance <description>", "acceptance criterion description", collect, [] as string[])
    .option("--tag <tag>", "requirement tag", collect, [] as string[])
    .option("--reason <text>", "proposal reason")
    .option("--apply", "apply after validation instead of writing a proposal");

  create.action(() =>
    executeCliCommand(create, async (context) => {
      const change = await buildCreateChange({
        root: context.root,
        cacheMode: context.cacheMode,
        raw: create.opts()
      });
      return create.opts().apply === true ? applyChange({ root: context.root, cacheMode: context.cacheMode, confirm: true, change }) : createProposal(change);
    })
  );

  const update = addCommonOptions(req.command("update").description("update a requirement proposal or apply it").argument("<id>"))
    .option("--title <title>", "replacement title")
    .option("--statement <statement>", "replacement statement")
    .option("--status <status>", "replacement status")
    .option("--priority <priority>", "replacement priority")
    .option("--rationale <text>", "replacement rationale")
    .option("--description <text>", "replacement description")
    .option("--tag <tag>", "replacement tag", collect, [] as string[])
    .option("--reason <text>", "proposal reason")
    .option("--apply", "apply after validation instead of writing a proposal");

  update.action((id: string) =>
    executeCliCommand(update, async (context) => {
      const change = await buildUpdateChange({
        root: context.root,
        cacheMode: context.cacheMode,
        id,
        raw: update.opts()
      });
      return update.opts().apply === true ? applyChange({ root: context.root, cacheMode: context.cacheMode, confirm: true, change }) : createProposal(change);
    })
  );
}

async function buildCreateChange(input: { root: string; cacheMode: "auto" | "bypass"; raw: Record<string, unknown> }): Promise<ProposeChangeInput> {
  const type = requirementType(input.raw.type);
  const scope = requiredString(input.raw.scope, "scope");
  const documentId = optionalString(input.raw.documentId);
  const registry = await loadRequirementRegistry(input);
  const previewInput: Parameters<typeof previewRequirementId>[0] = { requirementType: type, scope };
  const explicitId = optionalString(input.raw.id);
  if (explicitId !== undefined) {
    previewInput.explicitId = explicitId;
  }
  const preview = previewRequirementId(previewInput, registry);

  if (!preview.ok) {
    throw new CliUsageError(preview.error.code, preview.error.message);
  }

  const requirement: JsonObject = {
    id: preview.id,
    type,
    title: requiredString(input.raw.title, "title"),
    status: optionalString(input.raw.status) ?? "draft",
    statement: requiredString(input.raw.statement, "statement"),
    relations: []
  };
  addOptional(requirement, "priority", optionalString(input.raw.priority));
  addOptional(requirement, "rationale", optionalString(input.raw.rationale));
  addOptional(requirement, "description", optionalString(input.raw.description));

  const tags = stringList(input.raw.tag);
  if (tags.length > 0) {
    requirement.tags = tags;
  }

  const acceptance = stringList(input.raw.acceptance);
  if (acceptance.length > 0) {
    requirement.acceptanceCriteria = acceptance.map((description, index) => ({
      id: `AC-${String(index + 1).padStart(3, "0")}`,
      method: "test",
      description
    }));
  }

  const target: ProposeChangeInput["target"] = { kind: "requirement", scope, requirementId: preview.id };
  if (documentId !== undefined) {
    target.documentId = documentId;
  }

  return {
    root: input.root,
    cacheMode: input.cacheMode,
    operation: "create_requirement",
    target,
    changes: [{ op: "add", path: "/requirements/-", value: requirement }],
    reason: optionalString(input.raw.reason) ?? `Create requirement ${preview.id}.`
  };
}

async function buildUpdateChange(input: { root: string; cacheMode: "auto" | "bypass"; id: string; raw: Record<string, unknown> }): Promise<ProposeChangeInput> {
  const context = await requirementPatchContext(input.root, input.cacheMode, input.id);
  if (context === undefined) {
    throw new CliUsageError("REQUIREMENT_NOT_FOUND", `Requirement not found: ${input.id}.`);
  }

  const changes: JsonPatchOperation[] = [];
  addSet(changes, context.requirement, context.pointer, "title", optionalString(input.raw.title));
  addSet(changes, context.requirement, context.pointer, "statement", optionalString(input.raw.statement));
  addSet(changes, context.requirement, context.pointer, "status", optionalString(input.raw.status));
  addSet(changes, context.requirement, context.pointer, "priority", optionalString(input.raw.priority));
  addSet(changes, context.requirement, context.pointer, "rationale", optionalString(input.raw.rationale));
  addSet(changes, context.requirement, context.pointer, "description", optionalString(input.raw.description));

  const tags = stringList(input.raw.tag);
  if (tags.length > 0) {
    changes.push({ op: Object.hasOwn(context.requirement, "tags") ? "replace" : "add", path: `${context.pointer}/tags`, value: tags });
  }

  if (changes.length === 0) {
    throw new CliUsageError("INVALID_ARGUMENT", "req update requires at least one changed field.");
  }

  return {
    root: input.root,
    cacheMode: input.cacheMode,
    operation: "update_requirement",
    target: {
      kind: "requirement",
      requirementId: input.id
    },
    changes,
    reason: optionalString(input.raw.reason) ?? `Update requirement ${input.id}.`
  };
}

async function requirementPatchContext(root: string, cacheMode: "auto" | "bypass", id: string): Promise<{ pointer: string; requirement: JsonObject } | undefined> {
  const registry = await loadRequirementRegistry({ root, cacheMode });
  const requirement = registry.requirementsById.get(id);
  if (requirement === undefined) {
    return undefined;
  }

  const workspace = workspaceRootFromPath(root);
  const loaded = await loadYamlDocument(resolveStorePath(workspace, normalizeStorePath(requirement.path)));
  const requirements = isJsonObject(loaded.value) && Array.isArray(loaded.value.requirements) ? loaded.value.requirements : [];
  const index = requirements.findIndex((item) => isJsonObject(item) && item.id === id);
  const item = requirements[index];
  return index === -1 || !isJsonObject(item) ? undefined : { pointer: `/requirements/${index}`, requirement: item };
}

function addSet(changes: JsonPatchOperation[], requirement: JsonObject, pointer: string, key: string, value: string | undefined): void {
  if (value !== undefined) {
    changes.push({ op: Object.hasOwn(requirement, key) ? "replace" : "add", path: `${pointer}/${key}`, value });
  }
}

function addOptional(target: JsonObject, key: string, value: string | undefined): void {
  if (value !== undefined) {
    target[key] = value;
  }
}

function requiredString(value: unknown, name: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new CliUsageError("INVALID_ARGUMENT", `${name} is required.`);
  }
  return value;
}

function requirementType(value: unknown): RequirementType {
  if (
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
  ) {
    return value;
  }
  throw new CliUsageError("INVALID_ARGUMENT", "type must be a supported requirement type.");
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.length > 0) : [];
}

function collect(value: string, previous: string[]): string[] {
  return [...previous, value];
}

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
