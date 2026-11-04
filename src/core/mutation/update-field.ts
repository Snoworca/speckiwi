import { applyPatchPlan } from "../patch/apply-patch.js";
import { applyPatchPlans } from "../patch/apply-patch-plans.js";
import { createPatchPlan, type PatchOperation } from "../patch/patch-plan.js";
import { parseWorkspace } from "../parser/workspace-parser.js";
import { renderHeadingLine } from "../parser/heading-render.js";
import { isRequirementType } from "../schema.js";
import type {
  MutationResult,
  ParsedWorkspace,
  ProjectRoot,
  RequirementRecord,
  RequirementType,
  TextFile
} from "../types.js";
import { generateNextRequirementId } from "./add-requirement.js";
import { mutationFail, mutationOk } from "./guards.js";
import { planMetadataWrite } from "./internal.js";
import { requirementReferenceRewrites } from "./requirement-references.js";
import { assertSafeMarkdownTableCell } from "./table-cell.js";

/**
 * FR-NODE-060 — single-metadata-field edits handled by simple line replacement. `type`
 * and `scope` are migrations (id-prefix regeneration) and are handled separately, not as
 * line-replacement fields.
 */
const LINE_REPLACE_FIELDS = ["priority", "risk", "title", "target", "verification-method"] as const;
const MIGRATION_FIELDS = ["type", "scope"] as const;

export type UpdateFieldName = (typeof LINE_REPLACE_FIELDS)[number] | (typeof MIGRATION_FIELDS)[number];

export interface UpdateFieldInput {
  id: string;
  field: UpdateFieldName;
  value: string;
  /** Migration (type/scope) only: confirm the id-prefix migration write. */
  signOff?: boolean;
  /**
   * Preview without writing. For migration (type/scope) fields this defaults to true (dry-run) when
   * omitted; for line-replacement fields it defaults to false (write) and previews only when true.
   */
  dryRun?: boolean;
}

export interface PlannedMove {
  oldId: string;
  newId: string;
  filePath: string;
}

export interface UpdateFieldOutput {
  id: string;
  field: UpdateFieldName;
  written: boolean;
  /** Present for type/scope migrations. */
  oldId?: string;
  newId?: string;
  dryRun?: boolean;
  plannedMove?: PlannedMove;
}

/** Metadata-row label for a line-replacement field. `title` is not a metadata row. */
const METADATA_LABEL: Record<string, string> = {
  priority: "Priority",
  risk: "Risk",
  target: "Target",
  "verification-method": "Verification Method"
};

function loadRecordWithFile(
  workspace: ParsedWorkspace,
  id: string
): { record: RequirementRecord; file: TextFile } | undefined {
  const record = workspace.records.find((candidate) => candidate.id === id);
  if (!record) return undefined;
  const file = workspace.files.find((candidate) => record.filePath.endsWith(candidate.relativePath));
  if (!file) return undefined;
  return { record, file };
}

function replaceTitleLine(file: TextFile, record: RequirementRecord, value: string): PatchOperation | undefined {
  const line = record.headingLine;
  const original = file.lines[line - 1];
  if (original === undefined) return undefined;
  return { type: "replaceLine", line, original, replacement: renderHeadingLine({ id: record.id, title: value }) };
}

async function updateLineReplaceField(
  input: UpdateFieldInput,
  loaded: { record: RequirementRecord; file: TextFile }
): Promise<MutationResult<UpdateFieldOutput>> {
  let operation: PatchOperation | undefined;
  if (input.field === "title") {
    operation = replaceTitleLine(loaded.file, loaded.record, input.value);
  } else {
    // The shared writer's refusal carries its reason (a missing row, or one it cannot rewrite whole).
    const write = planMetadataWrite(loaded.file, loaded.record, METADATA_LABEL[input.field] ?? "", input.value);
    if (!write.ok) return mutationFail("MUTATION_DENIED", `${write.message} (field ${input.field})`) as MutationResult<UpdateFieldOutput>;
    operation = write.operation;
  }
  if (!operation) {
    return mutationFail("MUTATION_DENIED", `Field row not found for ${input.field}`) as MutationResult<UpdateFieldOutput>;
  }
  const plan = createPatchPlan(loaded.file, [operation]);
  // FND-003: honor --dry-run on line-replacement fields too. The advertised --dry-run flag was
  // previously ignored here (always applied with dryRun:false), so a priority/risk/title/target/
  // verification-method dry-run silently wrote the file. A dry-run now previews without writing.
  const dryRun = input.dryRun === true;
  const applied = await applyPatchPlan(plan, { dryRun });
  return mutationOk({ id: input.id, field: input.field, written: applied.written });
}

// @req FR-NODE-060
/**
 * FR-NODE-060 AC-2/AC-3/AC-4 — a `type` or `scope` edit regenerates the requirement id
 * (new prefix via generateNextRequirementId), defaults to dry-run, and requires an explicit
 * sign-off to write. A confirmed migration rewrites the heading id, the affected metadata
 * line (Type for a type edit), and inbound Trace Links references from the old id to the new.
 */
async function migrateTypeOrScope(
  input: UpdateFieldInput,
  workspace: ParsedWorkspace,
  loaded: { record: RequirementRecord; file: TextFile }
): Promise<MutationResult<UpdateFieldOutput>> {
  const newType: RequirementType = input.field === "type" ? (input.value as RequirementType) : loaded.record.type;
  if (!isRequirementType(newType)) {
    return mutationFail("USAGE", `Invalid requirement type: ${input.value}`) as MutationResult<UpdateFieldOutput>;
  }
  const newScope = input.field === "scope" ? input.value : loaded.record.scope;
  const newId = generateNextRequirementId(workspace, newType, newScope);
  const oldId = loaded.record.id;
  const plannedMove: PlannedMove = { oldId, newId, filePath: loaded.file.relativePath };

  const dryRun = input.dryRun ?? true;
  if (dryRun) {
    return mutationOk({ id: oldId, field: input.field, written: false, oldId, newId, dryRun: true, plannedMove });
  }

  // A non-dry-run migration requires an explicit sign-off.
  if (input.signOff !== true) {
    return mutationFail(
      "MUTATION_DENIED",
      `Migrating ${oldId} to ${newId} requires signOff=true`
    ) as MutationResult<UpdateFieldOutput>;
  }

  // Collect every edit (heading + Type metadata + inbound trace rewrites) into a per-file
  // operation map keyed off the same fresh workspace snapshot, then write each file once so
  // a same-file inbound-trace rewrite does not re-read a stale snapshot of the migrated block.
  const operationsByFile = new Map<string, { file: TextFile; operations: PatchOperation[] }>();
  const pushOp = (file: TextFile, operation: PatchOperation): void => {
    const entry = operationsByFile.get(file.relativePath) ?? { file, operations: [] };
    entry.operations.push(operation);
    operationsByFile.set(file.relativePath, entry);
  };

  const headingOriginal = loaded.file.lines[loaded.record.headingLine - 1];
  if (headingOriginal === undefined) {
    return mutationFail("MUTATION_DENIED", "Requirement heading row not found") as MutationResult<UpdateFieldOutput>;
  }
  pushOp(loaded.file, {
    type: "replaceLine",
    line: loaded.record.headingLine,
    original: headingOriginal,
    replacement: renderHeadingLine({ id: newId, title: loaded.record.title })
  });
  if (input.field === "type") {
    // A migration that cannot also write the Type row is refused, never reported as done with a stale type.
    const typeWrite = planMetadataWrite(loaded.file, loaded.record, "Type", input.value);
    if (!typeWrite.ok) return mutationFail("MUTATION_DENIED", `${typeWrite.message} (field type)`) as MutationResult<UpdateFieldOutput>;
    pushOp(loaded.file, typeWrite.operation);
  }

  for (const rewrite of requirementReferenceRewrites(workspace, workspace.records, oldId, newId)) {
    pushOp(rewrite.file, { type: "replaceLine", line: rewrite.line, original: rewrite.original, replacement: rewrite.replacement });
  }

  // The new id lands in several documents at once (the block, and every inbound reference), so they
  // are written as one transaction: a failed write restores every document already written.
  const plans = [...operationsByFile.values()].filter(({ operations }) => operations.length > 0).map(({ file, operations }) => createPatchPlan(file, operations));
  const { written } = await applyPatchPlans(plans, { dryRun: false });

  return mutationOk({ id: newId, field: input.field, written, oldId, newId, dryRun: false, plannedMove });
}

// @req FR-NODE-060
/**
 * FR-NODE-060 — update-field core mutation. Edits a single requirement metadata field
 * (priority / risk / title / target / verification-method) by line replacement, or migrates a
 * `type` / `scope` edit by regenerating the requirement id prefix under a dry-run plus sign-off
 * gate while rewriting inbound trace references. An unknown id returns NOT_FOUND with no write.
 */
export async function updateField(
  root: ProjectRoot,
  input: UpdateFieldInput
): Promise<MutationResult<UpdateFieldOutput>> {
  const workspace = await parseWorkspace(root);
  const loaded = loadRecordWithFile(workspace, input.id);
  if (!loaded) {
    return mutationFail("NOT_FOUND", `Requirement not found: ${input.id}`) as MutationResult<UpdateFieldOutput>;
  }
  // FND-001: the supplied value is written verbatim into a metadata cell or the heading
  // title, so a pipe / newline / CR would corrupt the row or inject extra lines (violating
  // FR-NODE-060 AC-1's single-line rewrite). Reject before building any patch, with no write.
  const unsafeValue = assertSafeMarkdownTableCell<UpdateFieldOutput>(`${input.field} value`, input.value);
  if (unsafeValue) return unsafeValue;
  if ((MIGRATION_FIELDS as readonly string[]).includes(input.field)) {
    return migrateTypeOrScope(input, workspace, loaded);
  }
  if ((LINE_REPLACE_FIELDS as readonly string[]).includes(input.field)) {
    return updateLineReplaceField(input, loaded);
  }
  return mutationFail("USAGE", `Unsupported field: ${input.field}`) as MutationResult<UpdateFieldOutput>;
}
