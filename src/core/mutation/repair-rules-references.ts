import { stat } from "node:fs/promises";
import path from "node:path";
import { isStalePatchError } from "../patch/apply-patch.js";
import { applyPatchPlans } from "../patch/apply-patch-plans.js";
import { createPatchPlan, type PatchOperation } from "../patch/patch-plan.js";
import { parseWorkspace } from "../parser/workspace-parser.js";
import type { MutationResult, ProjectRoot, RequirementRecord, TextFile } from "../types.js";
import { rewriteRulesReferences } from "../bootstrap/rules-references.js";
import { mutationFail, mutationOk } from "./guards.js";
import { findMetadataLine, metadataRowText, planMetadataRowEdit, planSectionRowsInsert } from "./internal.js";
import { withSrsMutationLock } from "./srs-lock.js";
import { todayStamp } from "../date-stamp.js";

// @req FR-NODE-092
//
// A `Related Docs` row citing a rules document the tool renamed is a broken link that no existing
// path could repair. `edit_requirement_fields` refuses any granular edit on a verified requirement, and
// `speckiwi upgrade` excludes docs/spec by contract — so five verified requirements in this repository
// kept a dead link to SRS-MD-Rules-v1.0.0.md, reported by `links check`, with no way to fix it short of
// demoting them.
//
// Correcting a path that no longer resolves changes no meaning, so this is a repair rather than an
// edit, and it sits beside the requirement-id collision repair. Status is deliberately not gated:
// `add_related_doc` already rewrites this same row at any status, so the verified gate was never what
// protected it. What the verified case does demand is an audit trail, hence the Change Note.

const RELATED_DOCS_FIELD = "Related Docs";

export interface RepairRulesReferencesInput {
  /** Perform the repair. Absent or false reports the findings and writes nothing. */
  apply?: boolean;
  ignoreLock?: boolean;
  /** Change Note date; defaults to today. */
  date?: string;
}

export interface RulesReferenceRepairFinding {
  requirementId: string;
  /** Workspace-relative path of the file holding the requirement. */
  filePath: string;
  /** 1-based line of the `Related Docs` row. */
  line: number;
  /** The rules document the row names, and the bundled one it will name instead. */
  from: string;
  to: string;
}

export interface RepairRulesReferencesOutput {
  applied: boolean;
  findings: RulesReferenceRepairFinding[];
  /** Requirement ids actually written; empty for a diagnosis. */
  repaired: string[];
}

export async function repairRulesReferences(
  root: ProjectRoot,
  input: RepairRulesReferencesInput
): Promise<MutationResult<RepairRulesReferencesOutput>> {
  const apply = input.apply === true;
  return withSrsMutationLock(
    root,
    { operation: "repair_rules_references", ignoreLock: input.ignoreLock, dryRun: !apply },
    () => repairUnlocked(root, input, apply)
  );
}

async function repairUnlocked(
  root: ProjectRoot,
  input: RepairRulesReferencesInput,
  apply: boolean
): Promise<MutationResult<RepairRulesReferencesOutput>> {
  const repairs = await planRepairs(root);
  const findings = repairs.flatMap((repair) => repair.findings);
  if (!apply || findings.length === 0) return mutationOk({ applied: apply, findings, repaired: [] });

  // All or nothing: every requirement's patch is planned against one snapshot before anything is
  // written, and the shared transaction writes every file or restores them all.
  const date = input.date ?? todayStamp();
  const plansByFile = new Map<string, { file: TextFile; operations: PatchOperation[] }>();
  for (const repair of repairs) {
    const planned = planOne(repair, date);
    if (!planned.ok) return mutationFail("MUTATION_DENIED", `${planned.message}; nothing was written`);
    const entry = plansByFile.get(repair.file.relativePath) ?? { file: repair.file, operations: [] };
    entry.operations.push(...planned.operations);
    plansByFile.set(repair.file.relativePath, entry);
  }
  const plans = [...plansByFile.values()].map(({ file, operations }) => createPatchPlan(file, operations));
  try {
    await applyPatchPlans(plans, { dryRun: false });
  } catch (error) {
    if (isStalePatchError(error)) return mutationFail("STALE_PATCH", "a requirement file changed before the repair was written");
    throw error;
  }
  return mutationOk({ applied: true, findings, repaired: repairs.map((repair) => repair.record.id) });
}

/** Whether a rules document is installed under `docs/rule`. */
async function isInstalled(root: ProjectRoot, document: string): Promise<boolean> {
  return stat(path.join(root.root, "docs", "rule", document))
    .then((entry) => entry.isFile())
    .catch(() => false);
}

interface PlannedRepair {
  record: RequirementRecord;
  file: TextFile;
  broken: ReadonlySet<string>;
  findings: RulesReferenceRepairFinding[];
}

/**
 * Every requirement whose `Related Docs` row cites a rules document that is not installed. The
 * decision is presence on disk: unlike the migration, this command runs no refresh, so what is on
 * disk now is exactly what the link resolves against — which is also what `links check` reports.
 *
 * The row is read as text, not as the parsed cell value: the parser cuts a value at an escaped `\|`,
 * so a document named after one would be invisible to the diagnosis while the repair rewrote it.
 * Diagnosis and repair both use this one plan, so they cannot disagree.
 */
async function planRepairs(root: ProjectRoot): Promise<PlannedRepair[]> {
  const workspace = await parseWorkspace(root);
  const installed = new Map<string, boolean>();
  const brokenDocument = async (document: string): Promise<boolean> => {
    const cached = installed.get(document);
    if (cached !== undefined) return !cached;
    const present = await isInstalled(root, document);
    installed.set(document, present);
    return !present;
  };

  const repairs: PlannedRepair[] = [];
  for (const record of workspace.records) {
    const file = workspace.files.find((candidate) => candidate.relativePath === record.filePath);
    const row = file ? metadataRowText(file, record, RELATED_DOCS_FIELD) : undefined;
    const line = file ? findMetadataLine(file, record, RELATED_DOCS_FIELD) : undefined;
    if (!file || row === undefined || line === undefined) continue;

    // Resolve the presence of every document the row names before rewriting, so the rewrite itself
    // stays synchronous and the predicate is a plain lookup.
    const broken = new Set<string>();
    for (const match of row.matchAll(/(SRS|SDS)-MD-Rules-v\d+\.\d+\.\d+\.md/g)) {
      if (await brokenDocument(match[0])) broken.add(match[0]);
    }
    if (broken.size === 0) continue;

    const rewritten = rewriteRulesReferences(row, (document) => broken.has(document));
    if (rewritten.changes.length === 0) continue;
    const findings = rewritten.changes.map((change) => ({ requirementId: record.id, filePath: record.filePath, line, from: change.from, to: change.to }));
    repairs.push({ record, file, broken, findings });
  }
  return repairs;
}

/** One requirement's `Related Docs` row rewrite and the Change Note recording it. */
function planOne(repair: PlannedRepair, date: string): { ok: true; operations: PatchOperation[] } | { ok: false; message: string } {
  const { record, file, broken } = repair;
  const write = planMetadataRowEdit(file, record, RELATED_DOCS_FIELD, (row) => rewriteRulesReferences(row, (document) => broken.has(document)).next);
  if (!write.ok) return { ok: false, message: `${write.message}: ${record.id}` };
  if ("unchanged" in write) return { ok: true, operations: [] };
  const metadataLine = findMetadataLine(file, record, RELATED_DOCS_FIELD) ?? 0;
  // @req FR-NODE-259 AC-1
  const note = planSectionRowsInsert(file, record, "Change Notes", [
    { Date: date, Change: "Related Docs reference repaired", Reason: "rules document renamed; path corrected by repair rules-references" }
  ]);
  if (!note.ok) return { ok: false, message: `${note.message}: ${record.id}` };
  if (note.operation.type !== "insertLines" || note.operation.line <= metadataLine) {
    return { ok: false, message: `Change Notes table precedes the metadata row in ${record.id}; refusing to patch` };
  }
  return { ok: true, operations: [note.operation, write.operation] };
}
