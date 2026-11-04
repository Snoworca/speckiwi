import type { ParsedWorkspace, RequirementRecord, TextFile } from "../types.js";

// @req FR-NODE-060 AC-4 @req FR-PARSE-044 AC-4 — the one collector of the references a requirement
// block makes to another requirement id: Trace Link rows of type Requirement and the successor of an
// expired acceptance criterion. Every mutation that changes a requirement id rewrites through this, so
// a new kind of reference is added here once and no id change can leave it dangling.

export interface RequirementReferenceRewrite {
  readonly file: TextFile;
  readonly line: number;
  readonly original: string;
  readonly replacement: string;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** A Trace Link row of type Requirement, or the successor an expired acceptance criterion names. */
export type RequirementReferenceKind = "trace-link" | "expired-successor";

const ALL_KINDS: readonly RequirementReferenceKind[] = ["trace-link", "expired-successor"];

/**
 * The line rewrites that move every reference `records` make to `oldId` onto `newId`. An id change
 * moves every kind (the default); a supersede moves only expired successors, because the new
 * requirement's own `supersedes` row must keep naming the old one.
 */
export function requirementReferenceRewrites(
  workspace: Pick<ParsedWorkspace, "files">,
  records: readonly RequirementRecord[],
  oldId: string,
  newId: string,
  kinds: readonly RequirementReferenceKind[] = ALL_KINDS
): RequirementReferenceRewrite[] {
  const traceCell = new RegExp(`(\\|\\s*Requirement\\s*\\|\\s*)${escapeRegExp(oldId)}(\\s*\\|)`);
  const successor = new RegExp(`( → )${escapeRegExp(oldId)}(\\]\\s*)$`);
  const rewrites: RequirementReferenceRewrite[] = [];
  for (const record of records) {
    const file = workspace.files.find((candidate) => record.filePath.endsWith(candidate.relativePath));
    if (!file) continue;
    const sites = [
      ...(kinds.includes("trace-link") ? record.traceLinks : []).filter((link) => link.type === "Requirement" && link.reference === oldId).map((link) => ({ line: link.line, pattern: traceCell })),
      ...(kinds.includes("expired-successor") ? record.expiredAcceptanceCriteria ?? [] : []).filter((criterion) => criterion.successor === oldId).map((criterion) => ({ line: criterion.line, pattern: successor }))
    ];
    for (const site of sites) {
      if (site.line === undefined) continue;
      const original = file.lines[site.line - 1];
      if (original === undefined) continue;
      const replacement = original.replace(site.pattern, `$1${newId}$2`);
      if (replacement !== original) rewrites.push({ file, line: site.line, original, replacement });
    }
  }
  return rewrites;
}
