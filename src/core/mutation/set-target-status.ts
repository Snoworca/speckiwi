import path from "node:path";
import { readUtf8File } from "../fs/read-text.js";
import { applyPatchPlan } from "../patch/apply-patch.js";
import { createPatchPlan, type PatchOperation } from "../patch/patch-plan.js";
import { parseMarkdownTable } from "../parser/table.js";
import { isTargetStatus, TARGET_STATUSES_SENTENCE, TARGET_STATUS_ACTIVE } from "../target-types.js";
import type { MutationResult, ProjectRoot, TargetEntry, TextFile } from "../types.js";
import { mutationEnvelopeFromPlan, mutationNoopEnvelope, withMutationEnvelope } from "./envelope.js";
import { mutationFail, mutationOk } from "./guards.js";
import { withSrsMutationLock } from "./srs-lock.js";
import { findHeadingMatching, TARGET_MAP_HEADING } from "../parser/index-parser.js";
import { planTableRowUpdate, readIndexMetadataValue } from "./internal.js";

export interface SetTargetStatusInput {
  target: string;
  status: string;
  dryRun?: boolean;
  ignoreLock?: boolean;
  skipLock?: boolean;
}

/**
 * @req FR-NODE-100 — record a Target Map row's status explicitly.
 *
 * `FR-NODE-099` derives what a departing active target becomes, but it cannot repair a row that is
 * already wrong, and it deliberately never produces `released`: the rules reserve that for a release
 * baseline, which is a decision a human makes and a tool cannot infer. Without this mutation the
 * Target Map could only ever lose information.
 *
 * Deliberately CLI-only, on the precedent `upgrade` set: marking a target released is author-owned.
 */
export async function setTargetStatus(root: ProjectRoot, input: SetTargetStatusInput): Promise<MutationResult> {
  return withSrsMutationLock(root, { operation: "set_target_status", dryRun: input.dryRun, ignoreLock: input.ignoreLock, skipLock: input.skipLock }, () => setTargetStatusUnlocked(root, input));
}

async function setTargetStatusUnlocked(root: ProjectRoot, input: SetTargetStatusInput): Promise<MutationResult> {
  const target = input.target.trim();
  if (!target) return mutationFail("USAGE", "target is required");

  const status = input.status.trim();
  if (!isTargetStatus(status)) return mutationFail("USAGE", `target status must be ${TARGET_STATUSES_SENTENCE}`);

  const file = await readUtf8File(path.join(root.root, "docs", "spec", "00.index.md"), root.root);
  const heading = findHeadingMatching(file.lines, TARGET_MAP_HEADING);
  const table = heading >= 0 ? parseMarkdownTable(file.lines, heading + 1) : undefined;
  if (!table) return mutationFail("MUTATION_DENIED", "Target Map table is missing");

  const rows: TargetEntry[] = table.rows.map((row) => ({
    target: row.Target ?? "",
    type: row.Type ?? "",
    status: row.Status ?? "",
    description: row.Description ?? ""
  }));

  const index = rows.findIndex((row) => row.target === target);
  if (index < 0) return mutationFail("NOT_FOUND", `Target is not registered: ${target}`);
  const row = rows[index] as TargetEntry;

  // Rule 7 of the Target Map rules: at most one row may be active. Moving the active target is
  // set_active_target's job, which also updates the Active Target metadata row; this mutation would
  // leave the two disagreeing.
  if (status === TARGET_STATUS_ACTIVE && rows.some((candidate) => candidate.status === TARGET_STATUS_ACTIVE && candidate.target !== target)) {
    return mutationFail("MUTATION_DENIED", "Target Map allows one active row; use set-active-target to move it");
  }

  // Rule 5: the row named by Active Target must be `active`. Without this guard the command's most
  // natural use — "the release is done, mark it released", issued while that target is still active —
  // succeeds, reports no diagnostic, and leaves the repository failing its own
  // `validate --fail-on-warning` with SRS-W010. This mutation deliberately does not touch the Active
  // Target metadata row, so it cannot repair what it would break.
  // The value the index parser reads, so `|Active Target|v1.0.0|` or an indented row is not missed.
  const activeTarget = readIndexMetadataValue(file, "Active Target")?.trim() || undefined;
  if (status !== TARGET_STATUS_ACTIVE && activeTarget === target) {
    return mutationFail("MUTATION_DENIED", `${target} is the Active Target; move the Active Target with set-active-target first, then record this status`);
  }

  if (row.status === status) {
    return withMutationEnvelope(
      mutationOk({ target, status, written: false }),
      mutationNoopEnvelope("set_target_status", file.relativePath, input.dryRun ?? false)
    );
  }

  // The shared row writer, by header name, at the row the parser read.
  const write = planTableRowUpdate(file, table, index, { Status: status });
  if (!write.ok) return mutationFail("MUTATION_DENIED", write.message);
  const operations: PatchOperation[] = [write.operation];

  const plan = createPatchPlan(file, operations);
  const dryRun = input.dryRun ?? false;
  const applied = await applyPatchPlan(plan, { dryRun });
  return withMutationEnvelope(
    mutationOk({ target, status, previousStatus: row.status, written: applied.written }),
    mutationEnvelopeFromPlan("set_target_status", plan, dryRun, applied.written)
  );
}
