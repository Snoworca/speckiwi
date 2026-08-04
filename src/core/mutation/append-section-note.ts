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

/**
 * FR-MCP-018 — append_section_note mutation.
 * Re-declares MAX/CONTROL constants intentionally (kept in sync with update-status §AC-7).
 */
// eslint-disable-next-line no-control-regex
const CONTROL_CHAR_RE = /[\x00-\x08\x0B\x0C\x0E-\x1F]/;
const MAX_TEXT_LENGTH = 500;

export type AppendSectionMode = "append" | "replace";

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

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
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
  if (input.text.length > MAX_TEXT_LENGTH) {
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
  const mode: AppendSectionMode = input.mode ?? "append";

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
    const noteLine = `- [${todayIso()}] ${input.text}`;
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
      for (let line = range.startLine; line <= range.endLine; line += 1) {
        const original = loaded.file.lines[line - 1];
        if (original === undefined) continue;
        if (line === range.startLine) {
          operations.push({ type: "replaceLine", line, original, replacement: input.text });
        } else {
          operations.push({ type: "replaceLine", line, original, replacement: "" });
        }
      }
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
