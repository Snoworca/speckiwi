import type { ParsedWorkspace, RequirementType, TextFile } from "../types.js";
import { prefixForType } from "./render-requirement.js";

/** SRS-MD Rules §11.2. */
const REQUIREMENT_ID_RE = /^(FR|NFR|IR|DR|SEC|PERF|REL|OBS|OPS|MIG|CON)-([A-Z0-9][A-Z0-9-]{1,24})-([0-9]{3,4})$/;

export type RequirementIdCheck = "format" | "type-prefix" | "scope" | "in-use";

export interface RequirementIdRequest {
  id: string;
  /** The requirement's type; without one (a block whose Type cell is not a known type) only the prefix check is skipped. */
  type?: RequirementType;
  scope: string;
  /** Files whose mentions do not count: the step document a promotion copies the block from. */
  ignoreFile?: (relativePath: string) => boolean;
}

export type RequirementIdAvailability =
  | { ok: true }
  | { ok: false; check: RequirementIdCheck; message: string; filePath?: string; line?: number };

/**
 * Every SRS document of the checkout as text: the index, the scope documents, the completed-work
 * file, the appendix, the completed-work history file and the step documents. A Requirement ID
 * anywhere in them — a heading, a discarded or superseded block, a Trace cell, an expiry marker, a
 * Completed Work Log row — has been used, so a caller may not choose it.
 */
function documentsOf(workspace: ParsedWorkspace): TextFile[] {
  return [...workspace.files, ...(workspace.completedWorkLogFile ? [workspace.completedWorkLogFile] : []), ...(workspace.stepFiles ?? [])];
}

/**
 * The first mention of the same number in the same series: FR-ARCH-0001 is the number FR-ARCH-001 holds,
 * since the generator and the status cache count both as 1, so the number is compared, not the spelling.
 */
function firstMention(workspace: ParsedWorkspace, series: string, number: number, ignoreFile: (relativePath: string) => boolean): { filePath: string; line: number } | undefined {
  const token = new RegExp(`(?<![A-Za-z0-9-])${series}-([0-9]{3,4})(?![0-9])`, "g");
  for (const file of documentsOf(workspace)) {
    if (ignoreFile(file.relativePath)) continue;
    const index = file.lines.findIndex((line) => [...line.matchAll(token)].some((match) => Number.parseInt(match[1] ?? "", 10) === number));
    if (index >= 0) return { filePath: file.relativePath, line: index + 1 };
  }
  return undefined;
}

/**
 * @req FR-NODE-312 AC-1 AC-2 AC-7 — the one rule for an id a caller names: `add_requirement`'s
 * `requirementId`, a promoted step requirement's id and the collision repair's replacement id. It is
 * well formed, its prefix is the type's, its scope segment is the scope's, and no SRS document of this
 * checkout mentions it. A number below the series maximum is fine; only a number some document has
 * used is not. Other branches and worktrees are not read — that limit is the caller's to report.
 */
export function checkRequirementIdAvailable(workspace: ParsedWorkspace, request: RequirementIdRequest): RequirementIdAvailability {
  const { id, type, scope } = request;
  const match = REQUIREMENT_ID_RE.exec(id);
  if (!match) return unavailable(id, "format", "it does not match the Requirement ID pattern of SRS-MD Rules §11.2, such as FR-AUTH-001");
  if (type !== undefined && match[1] !== prefixForType(type)) return unavailable(id, "type-prefix", `a ${type} requirement takes the prefix ${prefixForType(type)}, not ${match[1]}`);
  if (match[2] !== scope) return unavailable(id, "scope", `its scope segment ${match[2]} is not the scope ${scope}`);
  const mention = firstMention(workspace, `${match[1]}-${match[2]}`, Number.parseInt(match[3] ?? "", 10), request.ignoreFile ?? (() => false));
  if (mention) return { ...unavailable(id, "in-use", `it already appears at ${mention.filePath}:${mention.line}`), ...mention };
  return { ok: true };
}

/** The last number SRS-MD Rules §11.2 allows in a Requirement ID (`[0-9]{3,4}`). */
const LAST_REQUIREMENT_NUMBER = 9999;

/**
 * @req FR-NODE-316 AC-1 AC-2 AC-4 — the one allocator of a fresh Requirement ID in a series such as
 * `FR-ARCH`: above the series maximum, the lowest number the in-use rule above finds free, so a number
 * an SRS document already mentions is skipped and allocation and the caller-chosen check cannot
 * disagree. Null when no number up to 9999 is free: the pattern allows no further number.
 */
export function nextFreeRequirementId(workspace: ParsedWorkspace, series: string, scope: string): string | null {
  const own = new RegExp(`^${series.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}-([0-9]{3,4})$`);
  const used = workspace.records.map((record) => own.exec(record.id)?.[1]).flatMap((value) => (value === undefined ? [] : [Number.parseInt(value, 10)]));
  for (let number = Math.max(0, ...used) + 1; number <= LAST_REQUIREMENT_NUMBER; number += 1) {
    const id = `${series}-${String(number).padStart(3, "0")}`;
    if (checkRequirementIdAvailable(workspace, { id, scope }).ok) return id;
  }
  return null;
}

/** @req FR-NODE-316 AC-4 — why nextFreeRequirementId found nothing, said once for every caller. */
export function noFreeRequirementIdMessage(series: string): string {
  return `No Requirement ID can be allocated in the series ${series}: no number above the series maximum up to 9999 is free, or ${series} does not form a valid Requirement ID (SRS-MD Rules §11.2)`;
}

function unavailable(id: string, check: RequirementIdCheck, detail: string): { ok: false; check: RequirementIdCheck; message: string } {
  return { ok: false, check, message: `Requirement ID ${id} is not available (check: ${check}): ${detail}` };
}
