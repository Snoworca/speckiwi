import path from "node:path";
import { readUtf8File } from "../fs/read-text.js";
import { applyPatchPlan } from "../patch/apply-patch.js";
import { createPatchPlan, type PatchOperation } from "../patch/patch-plan.js";
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
import { findMetadataLine, findSectionTableInsertionLine, loadRecord } from "./internal.js";

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

// @req FR-NODE-059
/**
 * FR-NODE-059 — reads the registered destination targets from the index Target Map
 * (docs/spec/00.index.md). A retarget destination that is not present here yields the
 * per-item `target-not-registered` skip reason.
 */
async function readRegisteredTargets(root: ProjectRoot): Promise<Set<string>> {
  const file = await readUtf8File(path.join(root.root, "docs", "spec", "00.index.md"), root.root);
  const headingLine = file.lines.findIndex((line) => /^##\s+\d+\.\s+Target Map$/.test(line.trim()));
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
export async function retarget(
  root: ProjectRoot,
  input: RetargetInput
): Promise<MutationResult<RetargetOutput>> {
  const toTarget = input.toTarget.trim();
  if (!toTarget) return mutationFail("USAGE", "toTarget is required");

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

  for (const id of input.ids) {
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

    const targetLine = findMetadataLine(loaded.file, loaded.record, "Target");
    if (!targetLine) {
      return mutationFail("MUTATION_DENIED", `Target metadata row not found for ${id}`);
    }
    const original = loaded.file.lines[targetLine - 1];
    if (original === undefined) {
      return mutationFail("MUTATION_DENIED", `Target metadata row is outside file for ${id}`);
    }

    pushOp(loaded.file, { type: "replaceLine", line: targetLine, original, replacement: `| Target | ${toTarget} |` });
    if (reason.length > 0) {
      const insertLine = findSectionTableInsertionLine(loaded.file, loaded.record, "Change Notes");
      if (!insertLine) {
        return mutationFail("MUTATION_DENIED", `Change Notes section not found for ${id}`);
      }
      pushOp(loaded.file, {
        type: "insertLines",
        line: insertLine,
        lines: [`| ${todayIso()} | Target -> ${toTarget} | ${reason} |`]
      });
    }

    items.push({ id, fromTarget, toTarget });
  }

  // Every item validated; apply each file's accumulated plan exactly once.
  for (const { file, operations } of plansByFile.values()) {
    if (operations.length === 0) continue;
    await applyPatchPlan(createPatchPlan(file, operations), { dryRun });
  }

  return mutationOk({ dryRun, items });
}
