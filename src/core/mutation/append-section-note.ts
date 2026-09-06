import { applyPatchPlan } from "../patch/apply-patch.js";
import { createPatchPlan, type PatchOperation } from "../patch/patch-plan.js";
import { resolveSectionHeading, type AllowedSection } from "../rules/section-allowlist.js";
import type { MutationResult, ProjectRoot } from "../types.js";
import { assertOpensNoBlockBoundary } from "./block-prose.js";
import { mutationEnvelopeFromPlan, mutationNoopEnvelope, withMutationEnvelope } from "./envelope.js";
import { mutationFail, mutationOk } from "./guards.js";
import {
  findSectionBodyRange,
  findSectionInsertionLine,
  loadRecordWithWorkspace
} from "./internal.js";
import { withSrsMutationLock } from "./srs-lock.js";
import { todayStamp } from "../date-stamp.js";

/**
 * FR-MCP-018 — append_section_note mutation.
 * Re-declares MAX/CONTROL constants intentionally (kept in sync with update-status §AC-7).
 */
// eslint-disable-next-line no-control-regex
const CONTROL_CHAR_RE = /[\x00-\x08\x0B\x0C\x0E-\x1F]/;
/**
 * The bound on ONE appended note, copied from the `update_status.reason` policy it was written to
 * match. It is not a bound on how large a section may be, and applying it before the mode was known
 * made it one: a section whose body already exceeded 500 units could not be re-sent, so the only
 * expressible rewrite was a lossy one. @req FR-NODE-202 AC-2 / AC-6
 */
const MAX_TEXT_LENGTH = 500;

export type AppendSectionMode = "append" | "replace";

const APPEND_SECTION_MODES: readonly AppendSectionMode[] = ["append", "replace"];

function isAppendSectionMode(value: unknown): value is AppendSectionMode {
  return typeof value === "string" && (APPEND_SECTION_MODES as readonly string[]).includes(value);
}

export interface AppendSectionNoteInput {
  id: string;
  section: string;
  text: string;
  mode?: AppendSectionMode;
  dryRun?: boolean;
  ignoreLock?: boolean;
  skipLock?: boolean;
}

export interface AppendSectionNoteOutput {
  id: string;
  section: AllowedSection;
  mode: AppendSectionMode;
  written: boolean;
}

export async function appendSectionNote(
  root: ProjectRoot,
  input: AppendSectionNoteInput
): Promise<MutationResult<AppendSectionNoteOutput>> {
  return withSrsMutationLock(root, { operation: "append_section_note", dryRun: input.dryRun, ignoreLock: input.ignoreLock, skipLock: input.skipLock }, () => appendSectionNoteUnlocked(root, input));
}

async function appendSectionNoteUnlocked(
  root: ProjectRoot,
  input: AppendSectionNoteInput
): Promise<MutationResult<AppendSectionNoteOutput>> {
  if (typeof input.text !== "string" || input.text.length === 0) {
    return mutationFail("USAGE", "text is required");
  }
  // The CLI has no enum for `--mode` and casts whatever it was given, so an unrecognised value used
  // to fall through to `replace` — the destructive branch — without a word. The default of a typo is
  // not allowed to be the branch that overwrites. @req FR-NODE-202 AC-7
  if (input.mode !== undefined && !isAppendSectionMode(input.mode)) {
    return mutationFail("USAGE", `unknown mode: ${String(input.mode)} (expected ${APPEND_SECTION_MODES.join(" or ")})`);
  }
  const mode: AppendSectionMode = input.mode ?? "append";
  if (mode === "append" && input.text.length > MAX_TEXT_LENGTH) {
    return mutationFail("USAGE", `text exceeds ${MAX_TEXT_LENGTH} UTF-16 code units`);
  }
  if (CONTROL_CHAR_RE.test(input.text)) {
    return mutationFail("USAGE", "text contains forbidden control characters (only TAB/LF/CR allowed)");
  }

  const sectionResult = resolveSectionHeading(input.section);
  if (!sectionResult.ok) {
    if (sectionResult.reason === "denied") {
      return mutationFail(
        "MUTATION_DENIED",
        `section '${input.section}' is denied (structured tables cannot be appended via free text)`
      );
    }
    return mutationFail("USAGE", `unknown section: ${input.section}`);
  }
  const heading = sectionResult.heading as "Rationale" | "Research / Analysis" | "Implementation Notes";

  // FR-NODE-174 AC-9 — the text lands in the block verbatim in both modes; `append` only prefixes the
  // FIRST line with the bullet, so every later line reaches column zero exactly as `replace` does.
  const opensSection = assertOpensNoBlockBoundary<AppendSectionNoteOutput>("text", input.text);
  if (opensSection) return opensSection;

  const loaded = await loadRecordWithWorkspace(root, input.id);
  if (!loaded) return mutationFail("NOT_FOUND", `Requirement not found: ${input.id}`);

  const operations: PatchOperation[] = [];

  if (mode === "append") {
    const insertion = findSectionInsertionLine(loaded.file, loaded.record, heading);
    if (!insertion) return mutationFail("MUTATION_DENIED", `cannot locate insertion point for section '${heading}'`);
    const noteLine = `- [${todayStamp()}] ${input.text}`;
    if (insertion.mode === "append") {
      operations.push({ type: "insertLines", line: insertion.line, lines: [noteLine] });
    } else {
      operations.push({
        type: "insertLines",
        line: insertion.insertAtLine,
        lines: [`#### ${heading}`, "", noteLine, ""]
      });
    }
  } else {
    const range = findSectionBodyRange(loaded.file, loaded.record, heading);
    if (!range) {
      const insertion = findSectionInsertionLine(loaded.file, loaded.record, heading);
      if (!insertion || insertion.mode === "append") {
        return mutationFail("MUTATION_DENIED", `replace mode requires existing section heading for '${heading}'`);
      }
      operations.push({
        type: "insertLines",
        line: insertion.insertAtLine,
        lines: [`#### ${heading}`, "", input.text, ""]
      });
    } else {
      // One range operation, not one `replaceLine` per line. `renderPatchedLines` splices a range,
      // so surplus lines are removed; the per-line form could only blank them, which left a
      // five-line section rewritten to one line holding one line and four empty ones. Splitting the
      // text here also means the envelope reports the shrink — the range it covers against the line
      // count it writes — instead of hiding it inside one replacement string. @req FR-NODE-202 AC-3
      operations.push({
        type: "replaceRange",
        startLine: range.startLine,
        endLine: range.endLine,
        lines: input.text.split(/\r?\n/)
      });
    }
  }

  if (operations.length === 0) {
    return withMutationEnvelope(
      mutationOk({ id: input.id, section: normalizeAllowedSection(heading), mode, written: false }),
      mutationNoopEnvelope("append_section_note", loaded.file.relativePath, input.dryRun ?? false)
    );
  }

  const plan = createPatchPlan(loaded.file, operations);
  const dryRun = input.dryRun ?? false;
  const applied = await applyPatchPlan(plan, { dryRun });
  return withMutationEnvelope(
    mutationOk({ id: input.id, section: normalizeAllowedSection(heading), mode, written: applied.written }),
    mutationEnvelopeFromPlan("append_section_note", plan, dryRun, applied.written)
  );
}

function normalizeAllowedSection(heading: string): AllowedSection {
  if (heading === "Rationale") return "rationale";
  if (heading === "Research / Analysis") return "research";
  return "implementation_notes";
}
