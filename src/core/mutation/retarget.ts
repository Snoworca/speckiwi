import path from "node:path";
import { readUtf8File } from "../fs/read-text.js";
import { applyPatchPlans } from "../patch/apply-patch-plans.js";
import { createPatchPlan, type PatchOperation } from "../patch/patch-plan.js";
import { findHeadingMatching, TARGET_MAP_HEADING } from "../parser/index-parser.js";
import { parseMarkdownTable } from "../parser/table.js";
import type {
  MutationResult,
  ProjectRoot,
  RetargetInput,
  RetargetItemPlan,
  RetargetOutput,
  RetargetSkipReason,
  TextFile
} from "../types.js";

export type { RetargetInput, RetargetItemPlan, RetargetOutput } from "../types.js";
import { mutationFail, mutationOk } from "./guards.js";
import { assertOpensNoBlockBoundary } from "./block-prose.js";
import { tableCellText } from "./table-cell.js";
import { loadRecord, planMetadataWrite, planSectionRowsInsert } from "./internal.js";
import { todayStamp } from "../date-stamp.js";
import { withSrsMutationLock } from "./srs-lock.js";

// @req FR-NODE-059
/**
 * FR-NODE-059 — reads the registered destination targets from the index Target Map
 * (docs/spec/00.index.md). A retarget destination that is not present here yields the
 * per-item `target-not-registered` skip reason.
 */
async function readRegisteredTargets(root: ProjectRoot): Promise<Set<string>> {
  const file = await readUtf8File(path.join(root.root, "docs", "spec", "00.index.md"), root.root);
  // The index parser's own lookup, so a fenced example of the Target Map is not read as the table.
  const headingLine = findHeadingMatching(file.lines, TARGET_MAP_HEADING);
  const table = headingLine >= 0 ? parseMarkdownTable(file.lines, headingLine + 1) : undefined;
  const registered = new Set<string>();
  for (const row of table?.rows ?? []) {
    const value = (row.Target ?? "").trim();
    if (value) registered.add(value);
  }
  return registered;
}

// @req FR-NODE-059
/**
 * FR-NODE-059 — per-item retarget core mutation. Reassigns the Target metadata of the
 * caller-supplied requirement ids to a single destination through a per-item loop that
 * defaults to dry-run. The input type structurally excludes status and active-target, so
 * the mutation can neither finalize requirements nor change the Active Target. Each id
 * resolves to either a planned Target rewrite or a skipReason (excluded / not-found /
 * target-not-registered / frozen-needs-change-note). Writes happen only when dry-run is
 * disabled, and the patch pipeline preserves each file's existing newline style.
 */
export async function retarget(root: ProjectRoot, input: RetargetInput): Promise<MutationResult<RetargetOutput>> {
  return withSrsMutationLock(root, { operation: "retarget", dryRun: input.dryRun ?? true, ignoreLock: input.ignoreLock, skipLock: input.skipLock }, () =>
    retargetUnlocked(root, input)
  );
}

async function retargetUnlocked(root: ProjectRoot, input: RetargetInput): Promise<MutationResult<RetargetOutput>> {
  const toTarget = input.toTarget.trim();
  if (!toTarget) return mutationFail("USAGE", "toTarget is required");
  // FR-NODE-174 AC-9 — the reason lands in a Change Notes row inside the block, so a newline in it
  // reaches column zero and a heading there opens a requirement no gate inspects. Checked once here
  // rather than per item, so a malformed reason cannot be rescued by the loop skipping an id.
  const unsafeReason = assertOpensNoBlockBoundary<RetargetOutput>("reason", input.reason ?? "");
  if (unsafeReason) return unsafeReason;

  const dryRun = input.dryRun ?? true;
  const excluded = new Set(input.exclude ?? []);
  const registered = await readRegisteredTargets(root);

  // FND-002: collect every item's patch operations into a per-file plan and verify the whole
  // batch BEFORE writing anything. A MUTATION_DENIED on a later item must not leave an earlier
  // item's Target rewrite on disk, so no applyPatchPlan call happens inside this validation
  // loop. All items in the same file accumulate against one fresh on-disk snapshot (line
  // numbers stay consistent because nothing is written until the loop completes).
  const items: RetargetItemPlan[] = [];
  const plansByFile = new Map<string, { file: TextFile; operations: PatchOperation[] }>();
  const pushOp = (file: TextFile, operation: PatchOperation): void => {
    const entry = plansByFile.get(file.relativePath) ?? { file, operations: [] };
    entry.operations.push(operation);
    plansByFile.set(file.relativePath, entry);
  };

  // A repeated id would plan the same Target line twice and the second operation's precondition goes
  // stale, so each id is planned once.
  for (const id of new Set(input.ids)) {
    if (excluded.has(id)) {
      items.push({ id, skipReason: "excluded" satisfies RetargetSkipReason });
      continue;
    }

    const loaded = await loadRecord(root, id);
    if (!loaded) {
      items.push({ id, skipReason: "not-found" satisfies RetargetSkipReason });
      continue;
    }

    const fromTarget = loaded.record.target;
    // Moving a requirement to the target it already has changes nothing, so it writes nothing either:
    // no Target rewrite and no `Target X -> X` Change Notes row.
    if (fromTarget === toTarget) {
      items.push({ id, fromTarget, skipReason: "already-in-target" satisfies RetargetSkipReason });
      continue;
    }
    if (!registered.has(toTarget)) {
      items.push({ id, fromTarget, skipReason: "target-not-registered" satisfies RetargetSkipReason });
      continue;
    }

    const isFrozen = loaded.record.stability === "frozen";
    const reason = input.reason?.trim() ?? "";
    if (isFrozen && reason.length === 0) {
      items.push({ id, fromTarget, skipReason: "frozen-needs-change-note" satisfies RetargetSkipReason });
      continue;
    }

    const write = planMetadataWrite(loaded.file, loaded.record, "Target", toTarget);
    if (!write.ok) return mutationFail("MUTATION_DENIED", `${write.message} for ${id}`);
    pushOp(loaded.file, write.operation);
    // @req IR-CLI-112 AC-3 — every retarget leaves a row naming both targets, reason or not: the
    // Target cell alone no longer says where the requirement came from.
    // @req FR-NODE-259 AC-1 @req FR-NODE-278 AC-3
    const note = planSectionRowsInsert(loaded.file, loaded.record, "Change Notes", [
      { Date: todayStamp(), Change: `Target ${fromTarget} -> ${toTarget}`, Reason: reason.length > 0 ? tableCellText(reason) : "-" }
    ]);
    if (!note.ok) return mutationFail("MUTATION_DENIED", `${note.message} (${id})`);
    pushOp(loaded.file, note.operation);

    items.push({ id, fromTarget, toTarget });
  }

  // Every item validated; the shared transaction writes each file's plan once, all files or none.
  const plans = [...plansByFile.values()].filter(({ operations }) => operations.length > 0).map(({ file, operations }) => createPatchPlan(file, operations));
  const { written } = await applyPatchPlans(plans, { dryRun });

  // `written` is what lets the lock wrapper refresh the status cache after a real write.
  return mutationOk({ dryRun, written, items });
}
