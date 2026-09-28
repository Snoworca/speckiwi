// @req FR-NODE-147 — the lane-plan conflict model over waves, as a closed enum with every member
// reachable.
//
// A lane is one wave's worker (FR-NODE-213 AC-1), so the only facts that keep two waves apart are the
// dependencies the decomposition declared and an overlap between their SDS write sets. The function is
// pure: the write sets arrive injected, and nothing here reads the filesystem, because drift digest 3
// recomputes the plan's inputs from what `lanes.lock.json` records.

/** The closed `conflict_reason` enum: wave-level reasons only. @req FR-NODE-147 */
export const CONFLICT_REASONS = ["wave-dependency", "write-set-overlap"] as const;

export type ConflictReason = (typeof CONFLICT_REASONS)[number];

/**
 * The four convergence recipe kinds, **in most-restrictive-first order**. The order is the precedence
 * FR-FLOW-083 states for the skill's registry; the scheduler takes no registry (FR-NODE-213 AC-1), and
 * the vocabulary lives here because `journal-schema.ts` registers it for the contract parity check.
 */
export const RECIPE_KINDS = ["orchestrator-only", "replay", "regenerate", "exclusive-lane"] as const;

export type RecipeKind = (typeof RECIPE_KINDS)[number];

/** One wave the scheduler places. @req FR-NODE-213 AC-1 */
export interface WaveInput {
  /** The wave's SDS id: the SDS file name without `.sds.md`. */
  waveId: string;
  /** The SDS write set — Files paths ∪ Test Plan test files (FR-NODE-209 AC-4). Injected, never read. */
  writeSet: string[];
}

/**
 * The dependencies the decomposition declared, by wave id. A wave with no key depends on every wave
 * before it in the input order; an empty list declares that it depends on none (FR-FLOW-188 AC-3).
 */
export type WaveDependencies = Record<string, string[]>;

/**
 * `wave-dependency` runs from the dependent wave `a` to the wave `b` it depends on; `write-set-overlap`
 * joins an ordered pair and names the paths both write.
 */
export interface ConflictEdge {
  a: string;
  b: string;
  reason: ConflictReason;
  paths?: string[];
}

// Repo-relative paths are case-insensitive on Windows and not elsewhere, so the comparison — never
// the recorded value — is folded. `process.platform` is a process constant, not an ambient read.
const CASE_INSENSITIVE_PATHS = process.platform === "win32";

function comparablePath(path: string): string {
  return CASE_INSENSITIVE_PATHS ? path.toLowerCase() : path;
}

/**
 * UTF-16 code-unit order, which is what a bare `Array#sort()` uses. Every ordering in the scheduler
 * goes through this rather than `localeCompare`, whose result depends on the host locale and would make
 * the byte-determinism contract untrue on a differently configured machine. @req FR-NODE-145
 */
export function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

/**
 * Each wave's dependencies with the default applied, in input order. @req FR-NODE-147 AC-2
 *
 * A dependency naming no scheduled wave is refused rather than dropped: it is indistinguishable from a
 * typo, and dropping it would schedule the dependent wave beside the work it waits for.
 */
export function resolveWaveDependencies(waves: readonly WaveInput[], dependencies: WaveDependencies): Map<string, string[]> {
  const known = new Set(waves.map((entry) => entry.waveId));
  const resolved = new Map<string, string[]>();
  waves.forEach((entry, index) => {
    const declared = Object.prototype.hasOwnProperty.call(dependencies, entry.waveId) ? dependencies[entry.waveId] : undefined;
    const list = declared ?? waves.slice(0, index).map((earlier) => earlier.waveId);
    for (const dependency of list) {
      if (!known.has(dependency)) {
        throw new Error(`wave ${entry.waveId} depends on ${dependency}, which is not a scheduled wave`);
      }
    }
    resolved.set(entry.waveId, [...new Set(list)].sort(compareStrings));
  });
  return resolved;
}

function sharedPaths(left: readonly string[], right: readonly string[]): string[] {
  const rightFolded = new Set(right.map(comparablePath));
  return [...new Set(left.filter((path) => rightFolded.has(comparablePath(path))))].sort(compareStrings);
}

/**
 * Classify the scheduled waves into the closed conflict enum. Two arguments: the waves with their SDS
 * write sets, and their declared dependencies. @req FR-NODE-147 AC-1
 */
export function analyzeConflicts(waves: readonly WaveInput[], dependencies: WaveDependencies): ConflictEdge[] {
  const edges: ConflictEdge[] = [];

  for (const [waveId, dependsOn] of resolveWaveDependencies(waves, dependencies)) {
    for (const dependency of dependsOn) edges.push({ a: waveId, b: dependency, reason: "wave-dependency" });
  }

  for (let i = 0; i < waves.length; i += 1) {
    for (let j = i + 1; j < waves.length; j += 1) {
      const left = waves[i] as WaveInput;
      const right = waves[j] as WaveInput;
      const paths = sharedPaths(left.writeSet, right.writeSet);
      if (paths.length === 0) continue;
      const [a, b] = compareStrings(left.waveId, right.waveId) <= 0 ? [left.waveId, right.waveId] : [right.waveId, left.waveId];
      edges.push({ a, b, reason: "write-set-overlap", paths });
    }
  }

  return edges.sort(
    (left, right) =>
      CONFLICT_REASONS.indexOf(left.reason) - CONFLICT_REASONS.indexOf(right.reason) ||
      compareStrings(left.a, right.a) ||
      compareStrings(left.b, right.b)
  );
}
