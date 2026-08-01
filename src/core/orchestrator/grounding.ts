// @req IR-CLI-084 — the sidecar path grounding detector.
//
// A sidecar typo (`task-catalogue.ts` written for `task-catalog.ts`) produces no
// `write-set-overlap` edge, so two tasks that actually collide are scheduled into different lanes,
// the real edit is never made, and the defect surfaces only after promotion is queued.
//
// The gate is a **near-miss** detector, not an existence check. The planner sidecar schema carries
// no to-be-created marker (`kiwi-planner/SKILL.md:744`), so an existence check would refuse every
// greenfield unit — including the orchestrator design's own worked example, whose whole purpose is
// creating two new files. A path that does not exist and has no near neighbour is a legitimate new
// file and passes.
//
// The impure collection of `existingPaths` and `lineCounts` stays in the command (§5.1); grounding
// is never performed inside `computeLanePlan`, whose byte-determinism it would destroy.
import { normalizeDeclaredPath } from "./task-catalog.js";

/** The closed verdict vocabulary. Only `grounded` and `new-file` are accepted. */
export const GROUNDING_VERDICTS = ["grounded", "new-file", "near-miss", "absent", "line-range-out-of-range"] as const;

export type GroundingVerdict = (typeof GROUNDING_VERDICTS)[number];

const ACCEPTED: readonly GroundingVerdict[] = ["grounded", "new-file"];

/** The `files-not-grounded` refusal set — the complement of the two accepted verdicts. */
export function isGroundingRefusal(verdict: GroundingVerdict): boolean {
  return !ACCEPTED.includes(verdict);
}

/** One declared `files[]` or `test_files[]` entry, as the sidecar carries it. */
export interface DeclaredEntry {
  path: string;
  lineRange?: string;
}

export interface GroundingResult {
  /** The declared path in normalised repo-relative POSIX form. */
  path: string;
  verdict: GroundingVerdict;
  /** The existing path within edit distance 2 that made this a probable typo. */
  nearest?: string;
}

const NEAR_MISS_DISTANCE = 2;

/**
 * Levenshtein distance, bounded: any pair whose distance would exceed `limit` reports `limit + 1`
 * rather than the true value, so a long path is not compared character by character against every
 * path in the repository.
 */
function boundedEditDistance(left: string, right: string, limit: number): number {
  if (Math.abs(left.length - right.length) > limit) return limit + 1;
  if (left === right) return 0;

  let previous = Array.from({ length: right.length + 1 }, (_unused, index) => index);
  for (let i = 1; i <= left.length; i += 1) {
    const current = [i, ...new Array<number>(right.length).fill(0)];
    let rowBest = i;
    for (let j = 1; j <= right.length; j += 1) {
      const substitution = (previous[j - 1] ?? 0) + (left[i - 1] === right[j - 1] ? 0 : 1);
      const deletion = (previous[j] ?? 0) + 1;
      const insertion = (current[j - 1] ?? 0) + 1;
      const best = Math.min(substitution, deletion, insertion);
      current[j] = best;
      if (best < rowBest) rowBest = best;
    }
    if (rowBest > limit) return limit + 1;
    previous = current;
  }
  return previous[right.length] ?? limit + 1;
}

/** The lowest-distance existing path within the threshold, ties broken by code-unit order. */
function nearestExisting(path: string, existing: readonly string[]): string | null {
  let best: string | null = null;
  let bestDistance = NEAR_MISS_DISTANCE + 1;
  for (const candidate of existing) {
    const distance = boundedEditDistance(path, candidate, NEAR_MISS_DISTANCE);
    if (distance > NEAR_MISS_DISTANCE) continue;
    if (distance < bestDistance || (distance === bestDistance && best !== null && candidate < best)) {
      best = candidate;
      bestDistance = distance;
    }
  }
  return best;
}

/**
 * The declared line range's highest line, or `null` when the sidecar's free-text range states no
 * numeric bound. An unparseable range contributes no constraint rather than a refusal: the design
 * defines half (b) over "its `line_range` is outside the file's line count", which an unparseable
 * string does not decide either way.
 */
function highestDeclaredLine(lineRange: string | undefined): number | null {
  if (typeof lineRange !== "string") return null;
  const match = /^\s*(\d+)\s*(?:-\s*(\d+)\s*)?$/.exec(lineRange);
  if (!match) return null;
  const start = Number(match[1]);
  const end = match[2] === undefined ? start : Number(match[2]);
  return Math.max(start, end);
}

/**
 * Ground every declared entry against the injected repository facts.
 *
 * An entry is **not grounded** when (a) it does not exist at the dispatch base and some existing
 * path lies within Levenshtein distance 2 of it after POSIX normalisation — a probable typo for a
 * real file — or (b) it exists and its declared line range falls outside that file's line count.
 * `strict` tightens (a) to plain existence, for a repository that never creates files inside a wave.
 * @req IR-CLI-084
 */
export function groundFiles(
  declaredEntries: readonly DeclaredEntry[],
  existingPaths: readonly string[],
  lineCounts: Record<string, number>,
  strict: boolean
): GroundingResult[] {
  const existing = existingPaths.map(normalizeDeclaredPath);
  const existingSet = new Set(existing);

  return declaredEntries.map((entry) => {
    const path = normalizeDeclaredPath(entry.path);

    if (!existingSet.has(path)) {
      const nearest = nearestExisting(path, existing);
      if (nearest !== null) return { path, verdict: "near-miss" as const, nearest };
      return { path, verdict: strict ? ("absent" as const) : ("new-file" as const) };
    }

    const declaredMax = highestDeclaredLine(entry.lineRange);
    const lineCount = lineCounts[path];
    if (declaredMax !== null && typeof lineCount === "number" && declaredMax > lineCount) {
      return { path, verdict: "line-range-out-of-range" as const };
    }
    return { path, verdict: "grounded" as const };
  });
}
