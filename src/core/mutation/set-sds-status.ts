import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { findSdsStatusRow } from "../parser/metadata-table.js";
import { mutationFail, mutationOk } from "./guards.js";
import { isSafeTaskName } from "./scaffold-step.js";
import type { MutationResult, ProjectRoot } from "../types.js";

// @req FR-NODE-081
/**
 * FR-NODE-081 — set SDS status mutation.
 *
 * Patches the design.md metadata-table Status cell while enforcing the SDS-MD Rules
 * v1.0.0 §6 lifecycle: forward-only transitions along draft → agreed → superseded.
 * Backward transitions (including any transition out of the terminal superseded)
 * and out-of-enum values are refused with stable codes and nothing is written.
 */
export interface SetSdsStatusInput {
  task: string;
  status: string;
  dryRun?: boolean;
}

export interface SetSdsStatusValue {
  task: string;
  from: string;
  to: string;
  written: boolean;
}

// @req FR-NODE-081 — §6 lifecycle order (index = forward rank).
export const SDS_STATUS_ORDER = ["draft", "agreed", "superseded"] as const;

export async function setSdsStatus(root: ProjectRoot, input: SetSdsStatusInput): Promise<MutationResult<SetSdsStatusValue>> {
  if (!isSafeTaskName(input.task)) {
    return mutationFail("INVALID_STEP_NAME", `Task '${input.task}' must be a single path segment (no separators or traversal)`);
  }
  const to = input.status.trim();
  if (!SDS_STATUS_ORDER.includes(to as (typeof SDS_STATUS_ORDER)[number])) {
    return mutationFail("INVALID_SDS_STATUS", `SDS status '${input.status}' must be one of ${SDS_STATUS_ORDER.join(", ")}`);
  }

  const designPath = path.join(root.root, "docs", "spec", "steps", input.task, "design.md");
  let text: string;
  try {
    text = await readFile(designPath, "utf8");
  } catch {
    return mutationFail("NOT_FOUND", `Step '${input.task}' has no design.md (docs/spec/steps/${input.task}/design.md)`);
  }

  // The Status row lives in the metadata table before the first section heading;
  // Status cells in body tables must never be touched. A `## ` line or a row shown in a fence or
  // indented code is an example, not the document's structure. @req FR-NODE-260 AC-2
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const lines = text.split(/\r?\n/);
  const row = findSdsStatusRow(lines);
  if (row === undefined) {
    return mutationFail("NOT_FOUND", `design.md for step '${input.task}' has no metadata Status row`);
  }
  const { index: statusLine, value: from } = row;

  if (!SDS_STATUS_ORDER.includes(from as (typeof SDS_STATUS_ORDER)[number])) {
    return mutationFail("INVALID_SDS_STATUS", `design.md carries an unknown Status '${from}' (expected ${SDS_STATUS_ORDER.join(", ")})`);
  }
  const fromRank = SDS_STATUS_ORDER.indexOf(from as (typeof SDS_STATUS_ORDER)[number]);
  const toRank = SDS_STATUS_ORDER.indexOf(to as (typeof SDS_STATUS_ORDER)[number]);
  if (toRank <= fromRank) {
    return mutationFail(
      "INVALID_SDS_TRANSITION",
      `SDS status transition '${from}' -> '${to}' is not forward-only (${SDS_STATUS_ORDER.join(" -> ")})`
    );
  }

  const written = input.dryRun !== true;
  if (written) {
    // AC-6: replace only the value token — the original cell padding survives.
    lines[statusLine] = (lines[statusLine] ?? "").replace(/^(\|\s*Status\s*\|\s*)([^|]*?)(\s*\|\s*)$/, `$1${to}$3`);
    await writeFile(designPath, lines.join(eol), "utf8");
  }

  return mutationOk<SetSdsStatusValue>({ task: input.task, from, to, written });
}
