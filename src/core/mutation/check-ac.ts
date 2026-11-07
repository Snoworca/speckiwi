import { applyPatchPlan } from "../patch/apply-patch.js";
import { createPatchPlan, type PatchOperation } from "../patch/patch-plan.js";
import { summarizePatch } from "../patch/hunk-summary.js";
import type { MutationResult, ProjectRoot, RequirementRecord } from "../types.js";
import { mutationEnvelopeFromPlan, withMutationEnvelope } from "./envelope.js";
import { mutationFail, mutationOk } from "./guards.js";
import { assertEditable } from "./edit-requirement.js";
import { loadRecord } from "./internal.js";
import { acceptanceCriterionLine, refuseExpiredMarker } from "./render-requirement.js";
import { withSrsMutationLock } from "./srs-lock.js";

/** @req FR-NODE-243 AC-4 — the refusal for a named expired criterion, or undefined when none is named. */
function expiredAmong(record: RequirementRecord, acIds: readonly string[]): MutationResult | undefined {
  const named = (record.expiredAcceptanceCriteria ?? []).filter((criterion) => acIds.includes(criterion.id));
  if (named.length === 0) return undefined;
  return mutationFail("MUTATION_DENIED", `${named.map((criterion) => criterion.id).join(", ")} ${named.length === 1 ? "is" : "are"} expired; an expired criterion cannot be checked or edited`);
}

export interface SetAcCheckedInput {
  id: string;
  acIds: string[];
  checked: boolean;
  dryRun?: boolean;
  ignoreLock?: boolean;
  skipLock?: boolean;
}

export async function setAcceptanceCriteriaChecked(root: ProjectRoot, input: SetAcCheckedInput): Promise<MutationResult> {
  return withSrsMutationLock(root, { operation: "check_acceptance_criteria", dryRun: input.dryRun, ignoreLock: input.ignoreLock, skipLock: input.skipLock }, () => setAcceptanceCriteriaCheckedUnlocked(root, input));
}

async function setAcceptanceCriteriaCheckedUnlocked(root: ProjectRoot, input: SetAcCheckedInput): Promise<MutationResult> {
  const loaded = await loadRecord(root, input.id);
  if (!loaded) return mutationFail("NOT_FOUND", `Requirement not found: ${input.id}`);
  // @req FR-NODE-243 AC-4 — an expired criterion's box is frozen history; `all` reaches live ones only.
  const expired = expiredAmong(loaded.record, input.acIds);
  if (expired) return expired;
  const all = input.acIds.includes("all");
  const selected = loaded.record.acceptanceCriteria.filter((criterion) => all || input.acIds.includes(criterion.id));
  if (selected.length === 0) return mutationFail("MUTATION_DENIED", "No matching Acceptance Criteria");
  const operations: PatchOperation[] = selected.map((criterion) => {
    const original = loaded.file.lines[criterion.line - 1] ?? "";
    return {
      type: "replaceLine",
      line: criterion.line,
      original,
      replacement: original.replace(/-\s+\[( |x|X)]/, `- [${input.checked ? "x" : " "}]`)
    };
  });
  const dryRun = input.dryRun ?? false;
  const plan = createPatchPlan(loaded.file, operations);
  const applied = await applyPatchPlan(plan, { dryRun });
  return withMutationEnvelope(
    mutationOk({ id: input.id, acIds: selected.map((criterion) => criterion.id), checked: input.checked, written: applied.written }),
    mutationEnvelopeFromPlan("check_acceptance_criteria", plan, dryRun, applied.written)
  );
}

// FR-NODE-041 — edit_acceptance_criteria mutation.
//
// Replaces the prose text of a single targeted acceptance criterion, preserving its
// checked/unchecked state and its `AC-N:` id prefix, and leaving sibling criteria and every
// other section (Requirement statement, Trace Links, …) byte-for-byte intact. `text` is
// written verbatim onto the AC line, so it is rejected (USAGE, no write) when empty, over the
// maximum length, or carrying a newline / control character that would corrupt the row (FND-005).

// eslint-disable-next-line no-control-regex
const AC_UNSAFE_TEXT_RE = /[\x00-\x1F\x7F]/;
/**
 * @req FR-NODE-041 AC-4 — the one length limit for a criterion written by edit or append, sized to
 * accept the longest criterion a real SRS carried (8,642 characters in OG SEC-SEC-045).
 */
const MAX_AC_TEXT_LENGTH = 16384;

/**
 * @req FR-NODE-041 AC-4 · FR-MCP-072 AC-3 — the text rules a criterion written verbatim onto its
 * line must pass; edit and append share them.
 */
function refuseUnsafeCriterionText(text: string): MutationResult | undefined {
  if (typeof text !== "string" || text.length === 0) return mutationFail("USAGE", "text is required");
  if (text.length > MAX_AC_TEXT_LENGTH) return mutationFail("USAGE", `text exceeds ${MAX_AC_TEXT_LENGTH} UTF-16 code units`);
  if (AC_UNSAFE_TEXT_RE.test(text)) return mutationFail("USAGE", "text contains forbidden newline or control characters");
  return refuseExpiredMarker("text", [text]);
}

export interface EditAcceptanceCriteriaInput {
  id: string;
  acId: string;
  text: string;
  dryRun?: boolean;
  ignoreLock?: boolean;
  skipLock?: boolean;
}

export async function editAcceptanceCriteria(root: ProjectRoot, input: EditAcceptanceCriteriaInput): Promise<MutationResult> {
  return withSrsMutationLock(root, { operation: "edit_acceptance_criteria", dryRun: input.dryRun, ignoreLock: input.ignoreLock, skipLock: input.skipLock }, () => editAcceptanceCriteriaUnlocked(root, input));
}

async function editAcceptanceCriteriaUnlocked(root: ProjectRoot, input: EditAcceptanceCriteriaInput): Promise<MutationResult> {
  const unsafe = refuseUnsafeCriterionText(input.text);
  if (unsafe) return unsafe;

  const loaded = await loadRecord(root, input.id);
  if (!loaded) return mutationFail("NOT_FOUND", `Requirement not found: ${input.id}`);
  // @req FR-NODE-041 AC-5 — a verified criterion changes only through demote, edit and re-promotion.
  const verified = assertEditable(loaded.record);
  if (verified) return verified;
  const expired = expiredAmong(loaded.record, [input.acId]);
  if (expired) return expired;
  const criterion = loaded.record.acceptanceCriteria.find((entry) => entry.id === input.acId);
  if (!criterion) return mutationFail("MUTATION_DENIED", `Acceptance Criterion not found: ${input.acId}`);

  const original = loaded.file.lines[criterion.line - 1];
  if (original === undefined) return mutationFail("MUTATION_DENIED", "Acceptance Criterion line is outside file");
  const marker = `${criterion.id}:`;
  const markerIndex = original.indexOf(marker);
  if (markerIndex < 0) return mutationFail("MUTATION_DENIED", `Acceptance Criterion prefix not found for ${input.acId}`);
  const prefix = original.slice(0, markerIndex + marker.length);
  const replacement = `${prefix} ${input.text}`;

  const dryRun = input.dryRun ?? false;
  const plan = createPatchPlan(loaded.file, [{ type: "replaceLine", line: criterion.line, original, replacement }]);
  const applied = await applyPatchPlan(plan, { dryRun });
  return {
    ...withMutationEnvelope(
      mutationOk({ id: input.id, acId: input.acId, written: applied.written }),
      mutationEnvelopeFromPlan("edit_acceptance_criteria", plan, dryRun, applied.written)
    ),
    patch: summarizePatch(plan, dryRun)
  };
}

export interface AppendAcceptanceCriterionInput {
  id: string;
  text: string;
  dryRun?: boolean;
  ignoreLock?: boolean;
  skipLock?: boolean;
}

export async function appendAcceptanceCriterion(root: ProjectRoot, input: AppendAcceptanceCriterionInput): Promise<MutationResult> {
  return withSrsMutationLock(root, { operation: "append_acceptance_criterion", dryRun: input.dryRun, ignoreLock: input.ignoreLock, skipLock: input.skipLock }, () => appendAcceptanceCriterionUnlocked(root, input));
}

/**
 * The last 1-based line of the list item that starts at `itemLine`: its indented continuation lines
 * (nested bullets, wrapped text) belong to it, so a new criterion goes after them, not between the
 * criterion and its own detail (FR-MCP-072 AC-2). Blank lines count only when indented text follows.
 */
function endOfListItem(lines: readonly string[], itemLine: number): number {
  let end = itemLine;
  for (let index = itemLine; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    if (line.trim() === "") continue;
    if (!/^\s/.test(line)) break;
    end = index + 1;
  }
  return end;
}

/**
 * @req FR-MCP-072 AC-2 — appends one unchecked criterion after the last criterion line, numbered one
 * above the highest number the block has ever used, expired criteria included (SRS-MD §21.2-3), so no
 * number an old test or `Covers` cell cites comes back meaning something else.
 */
async function appendAcceptanceCriterionUnlocked(root: ProjectRoot, input: AppendAcceptanceCriterionInput): Promise<MutationResult> {
  const unsafe = refuseUnsafeCriterionText(input.text);
  if (unsafe) return unsafe;

  const loaded = await loadRecord(root, input.id);
  if (!loaded) return mutationFail("NOT_FOUND", `Requirement not found: ${input.id}`);
  const verified = assertEditable(loaded.record);
  if (verified) return verified;
  const criteria = [...loaded.record.acceptanceCriteria, ...(loaded.record.expiredAcceptanceCriteria ?? [])];
  if (criteria.length === 0) {
    return mutationFail("MUTATION_DENIED", `${input.id} has no acceptance criterion line to append after; write the list with replace_acceptance_criteria`);
  }
  const acId = `AC-${Math.max(...criteria.map((criterion) => Number(criterion.id.slice("AC-".length)))) + 1}`;
  const lastLine = endOfListItem(loaded.file.lines, Math.max(...criteria.map((criterion) => criterion.line)));

  const dryRun = input.dryRun ?? false;
  const plan = createPatchPlan(loaded.file, [
    { type: "insertLines", line: lastLine + 1, lines: [acceptanceCriterionLine(acId, input.text, false)], expectedBefore: loaded.file.lines[lastLine - 1] ?? "" }
  ]);
  const applied = await applyPatchPlan(plan, { dryRun });
  return {
    ...withMutationEnvelope(
      mutationOk({ id: input.id, acId, written: applied.written }),
      mutationEnvelopeFromPlan("append_acceptance_criterion", plan, dryRun, applied.written)
    ),
    patch: summarizePatch(plan, dryRun)
  };
}
