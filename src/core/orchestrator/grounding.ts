// @req IR-CLI-084 — the SDS path grounding detector.
//
// An SDS typo (`lane-plans.ts` written for `lane-plan.ts`) produces no `write-set-overlap` edge, so two
// waves that actually collide are scheduled into one stage, the real edit is never made, and the
// defect surfaces only after promotion is queued.
//
// The gate is a **near-miss** detector, not an existence check. An SDS Files entry carries no
// to-be-created marker, so an existence check would refuse every greenfield wave. A path that does not
// exist and has no near neighbour is a legitimate new file and passes.
//
// The impure collection of `existingPaths` stays in the command; grounding is never performed inside
// `computeLanePlan`, whose byte-determinism it would destroy.

/**
 * Repo-relative POSIX form with no leading `./` and no trailing `/`, applied to both sides of the
 * comparison. Case folding is deliberately **not** done here — it belongs to a comparison, not to the
 * recorded value.
 */
export function normalizeDeclaredPath(value: string): string {
  const posix = value.replace(/\\/g, "/").trim();
  const withoutPrefix = posix.startsWith("./") ? posix.slice(2) : posix;
  return withoutPrefix.replace(/\/+$/, "");
}

/** The closed verdict vocabulary. Only `grounded` and `new-file` are accepted. */
export const GROUNDING_VERDICTS = ["grounded", "new-file", "near-miss", "absent"] as const;

export type GroundingVerdict = (typeof GROUNDING_VERDICTS)[number];

const ACCEPTED: readonly GroundingVerdict[] = ["grounded", "new-file"];

/** The `files-not-grounded` refusal set — the complement of the two accepted verdicts. */
export function isGroundingRefusal(verdict: GroundingVerdict): boolean {
  return !ACCEPTED.includes(verdict);
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
 * Ground every declared path against the injected repository paths.
 *
 * A path is **not grounded** when it does not exist at the dispatch base and some existing path lies
 * within Levenshtein distance 2 of it after POSIX normalisation — a probable typo for a real file.
 * `strict` tightens that to plain existence, for a repository that never creates files inside a wave.
 * @req IR-CLI-084
 */
export function groundFiles(declaredPaths: readonly string[], existingPaths: readonly string[], strict: boolean): GroundingResult[] {
  const existing = existingPaths.map(normalizeDeclaredPath);
  const existingSet = new Set(existing);

  return declaredPaths.map((declared) => {
    const path = normalizeDeclaredPath(declared);
    if (existingSet.has(path)) return { path, verdict: "grounded" as const };
    const nearest = nearestExisting(path, existing);
    if (nearest !== null) return { path, verdict: "near-miss" as const, nearest };
    return { path, verdict: strict ? ("absent" as const) : ("new-file" as const) };
  });
}
