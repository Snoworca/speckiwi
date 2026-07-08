import { applyPatchPlan } from "../patch/apply-patch.js";
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
import { findMetadataLine } from "./internal.js";
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

function replaceMetadataLine(
  file: TextFile,
  record: RequirementRecord,
  label: string,
  value: string
): PatchOperation | undefined {
  const line = findMetadataLine(file, record, label);
  if (!line) return undefined;
  const original = file.lines[line - 1];
  if (original === undefined) return undefined;
  return { type: "replaceLine", line, original, replacement: `| ${label} | ${value} |` };
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
  const operation =
    input.field === "title"
      ? replaceTitleLine(loaded.file, loaded.record, input.value)
      : replaceMetadataLine(loaded.file, loaded.record, METADATA_LABEL[input.field] ?? "", input.value);
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
    const typeOp = replaceMetadataLine(loaded.file, loaded.record, "Type", input.value);
    if (typeOp) pushOp(loaded.file, typeOp);
  }

  collectInboundTraceRewrites(workspace, oldId, newId, pushOp);

  let written = false;
  for (const { file, operations } of operationsByFile.values()) {
    if (operations.length === 0) continue;
    const plan = createPatchPlan(file, operations);
    const applied = await applyPatchPlan(plan, { dryRun: false });
    written = written || applied.written;
  }

  return mutationOk({ id: newId, field: input.field, written, oldId, newId, dryRun: false, plannedMove });
}

/**
 * FR-NODE-060 AC-4 — for a confirmed migration, queue a line-replacement for every inbound Trace
 * Links row whose Type is Requirement and whose Reference is the old id, rewriting it to the new
 * id. Operations are pushed onto the shared per-file map so all edits land in one write per file.
 */
function collectInboundTraceRewrites(
  workspace: ParsedWorkspace,
  oldId: string,
  newId: string,
  pushOp: (file: TextFile, operation: PatchOperation) => void
): void {
  const oldIdReference = new RegExp(`(\\|\\s*Requirement\\s*\\|\\s*)${escapeRegExp(oldId)}(\\s*\\|)`);
  for (const record of workspace.records) {
    for (const link of record.traceLinks) {
      if (link.type !== "Requirement") continue;
      if (link.reference !== oldId) continue;
      if (link.line === undefined) continue;
      const file = workspace.files.find((candidate) => record.filePath.endsWith(candidate.relativePath));
      if (!file) continue;
      const original = file.lines[link.line - 1];
      if (original === undefined) continue;
      const replacement = original.replace(oldIdReference, `$1${newId}$2`);
      if (replacement === original) continue;
      pushOp(file, { type: "replaceLine", line: link.line, original, replacement });
    }
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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
