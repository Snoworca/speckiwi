import { stat } from "node:fs/promises";
import path from "node:path";
import { applyPatchPlan, isStalePatchError } from "../patch/apply-patch.js";
import { createPatchPlan, type PatchOperation } from "../patch/patch-plan.js";
import { parseWorkspace } from "../parser/workspace-parser.js";
import type { MutationResult, ProjectRoot } from "../types.js";
import { rewriteRulesReferences } from "../bootstrap/rules-references.js";
import { mutationFail, mutationOk } from "./guards.js";
import { findMetadataLine, findSectionTableInsertionLine, loadRecordWithWorkspace } from "./internal.js";
import { withSrsMutationLock } from "./srs-lock.js";

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
  const findings = await collectFindings(root);
  if (!apply || findings.length === 0) return mutationOk({ applied: apply, findings, repaired: [] });

  const repaired: string[] = [];
  // One requirement at a time, re-reading the file each round: appending a Change Note shifts the
  // lines below it, so a plan computed against a stale snapshot would patch the wrong rows.
  for (const requirementId of [...new Set(findings.map((finding) => finding.requirementId))]) {
    const result = await repairOne(root, requirementId, input.date ?? today());
    if (!result.ok) {
      // A failed write is the whole command's failure, reported verbatim. Requirements repaired
      // before it stay repaired: each is one atomic patch, and a partial run is visible in `repaired`.
      return {
        ok: false,
        error: result.error ?? { code: "REPAIR_FAILED", message: `repair failed for ${requirementId}` },
        diagnostics: result.diagnostics,
        diagnosticsSummary: result.diagnosticsSummary
      };
    }
    repaired.push(requirementId);
  }
  return mutationOk({ applied: true, findings, repaired });
}

/** Whether a rules document is installed under `docs/rule`. */
async function isInstalled(root: ProjectRoot, document: string): Promise<boolean> {
  return stat(path.join(root.root, "docs", "rule", document))
    .then((entry) => entry.isFile())
    .catch(() => false);
}

/**
 * Every requirement whose `Related Docs` row cites a rules document that is not installed. The
 * decision is presence on disk: unlike the migration, this command runs no refresh, so what is on
 * disk now is exactly what the link resolves against — which is also what `links check` reports.
 */
async function collectFindings(root: ProjectRoot): Promise<RulesReferenceRepairFinding[]> {
  const workspace = await parseWorkspace(root);
  const installed = new Map<string, boolean>();
  const brokenDocument = async (document: string): Promise<boolean> => {
    const cached = installed.get(document);
    if (cached !== undefined) return !cached;
    const present = await isInstalled(root, document);
    installed.set(document, present);
    return !present;
  };

  const findings: RulesReferenceRepairFinding[] = [];
  for (const record of workspace.records) {
    const value = record.metadata[RELATED_DOCS_FIELD];
    if (typeof value !== "string" || value === "" || value === "-") continue;

    // Resolve the presence of every document the row names before rewriting, so the rewrite itself
    // stays synchronous and the predicate is a plain lookup.
    const broken = new Set<string>();
    for (const match of value.matchAll(/(SRS|SDS)-MD-Rules-v\d+\.\d+\.\d+\.md/g)) {
      if (await brokenDocument(match[0])) broken.add(match[0]);
    }
    if (broken.size === 0) continue;

    const rewritten = rewriteRulesReferences(value, (document) => broken.has(document));
    if (rewritten.changes.length === 0) continue;

    const loaded = await loadRecordWithWorkspace(root, record.id);
    const line = loaded ? findMetadataLine(loaded.file, loaded.record, RELATED_DOCS_FIELD) : undefined;
    if (loaded === undefined || line === undefined) continue;
    for (const change of rewritten.changes) {
      findings.push({
        requirementId: record.id,
        filePath: record.filePath,
        line,
        from: change.from,
        to: change.to
      });
    }
  }
  return findings;
}

/** Rewrites one requirement's `Related Docs` row and appends the Change Note recording it. */
async function repairOne(root: ProjectRoot, id: string, date: string): Promise<MutationResult<{ id: string }>> {
  const loaded = await loadRecordWithWorkspace(root, id);
  if (!loaded) return mutationFail("NOT_FOUND", `Requirement not found: ${id}`);

  const metadataLine = findMetadataLine(loaded.file, loaded.record, RELATED_DOCS_FIELD);
  if (metadataLine === undefined) return mutationFail("MUTATION_DENIED", `${RELATED_DOCS_FIELD} metadata row not found: ${id}`);
  const original = loaded.file.lines[metadataLine - 1];
  if (original === undefined) return mutationFail("MUTATION_DENIED", `${RELATED_DOCS_FIELD} metadata row is outside file: ${id}`);

  const broken = new Set<string>();
  for (const match of original.matchAll(/(SRS|SDS)-MD-Rules-v\d+\.\d+\.\d+\.md/g)) {
    if (!(await isInstalled(root, match[0]))) broken.add(match[0]);
  }
  const rewritten = rewriteRulesReferences(original, (document) => broken.has(document));
  if (rewritten.changes.length === 0) return mutationOk({ id });

  const noteLine = findSectionTableInsertionLine(loaded.file, loaded.record, "Change Notes");
  if (noteLine === undefined) return mutationFail("MUTATION_DENIED", `Change Notes section not found: ${id}`);

  const note = `| ${date} | Related Docs reference repaired | rules document renamed; path corrected by repair rules-references |`;
  // The Change Notes table always sits below the metadata table, so the insert is the later line and
  // applying it first leaves the metadata row's own line number untouched.
  const operations: PatchOperation[] = [
    { type: "insertLines", line: noteLine, lines: [note] },
    { type: "replaceLine", line: metadataLine, original, replacement: rewritten.next }
  ];
  if (noteLine <= metadataLine) {
    return mutationFail("MUTATION_DENIED", `Change Notes table precedes the metadata row in ${id}; refusing to patch`);
  }

  try {
    const applied = await applyPatchPlan(createPatchPlan(loaded.file, operations), { dryRun: false });
    return applied.written ? mutationOk({ id }) : mutationFail("MUTATION_DENIED", `no write performed for ${id}`);
  } catch (error) {
    if (isStalePatchError(error)) {
      return mutationFail("STALE_PATCH", `target file changed before write: ${loaded.file.relativePath}`);
    }
    throw error;
  }
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}
