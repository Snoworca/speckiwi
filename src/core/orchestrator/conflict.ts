// @req FR-NODE-147 — the lane-plan conflict model, as a closed enum with every member reachable.
//
// Reachability rather than mere presence is the bar. An earlier partitioner sent any convergence
// registry match to the serial epilogue, which left the `exclusive-lane` recipe dead while a
// presence-only test still passed. So the recipe-kind rule and its precedence order live here, and
// the test asserts every `conflict_reason` and every `recipe.kind` is produced by some input the
// declared types admit.
//
// The function is pure: `existingPaths` arrives injected inside `constraints`, and nothing here
// reads the filesystem. That is load-bearing rather than stylistic — the resume-time lane-plan drift
// digest recomputes the plan from the inputs the lock records and compares byte-for-byte, so an
// impure classifier makes that check fire on any unrelated file creation.
import { compareStrings, normalizeDeclaredPath, type TaskCatalogEntry, type TaskFileEntry } from "./task-catalog.js";

/**
 * The closed `conflict_reason` enum (§5.2 plus §5.3's `learned-coupling`).
 *
 * `shared-substrate` is deliberately absent, and so is its revision-2 path-level replacement: both
 * are unsatisfiable (X-04). What survives at Phase 3.f″ is `planStageCoupling`, which is not a
 * conflict reason at all. @req FR-NODE-136
 */
export const CONFLICT_REASONS = [
  "task-dependency",
  "phase-dependency",
  "write-set-overlap",
  "tdd-pair",
  "req-shared",
  "convergence-point",
  "module-barrier",
  "unknown-write-set",
  "srs-write",
  "non-code-write-set",
  "learned-coupling"
] as const;

export type ConflictReason = (typeof CONFLICT_REASONS)[number];

/** Same-lane forcing reasons: their tasks join one connected component (§5.3). */
export const SAME_LANE_REASONS = ["write-set-overlap", "tdd-pair", "req-shared", "learned-coupling"] as const;

/** Stage barriers: the lane holding such a task is alone in its stage. */
export const STAGE_BARRIER_REASONS = ["unknown-write-set", "module-barrier"] as const;

/** Serial-epilogue routing: charter C1 as a plan property rather than a runtime error. */
export const SERIAL_EPILOGUE_REASONS = ["srs-write", "non-code-write-set"] as const;

/** Ordering only: these order lanes across stages and force nothing into one lane. */
export const ORDERING_REASONS = ["task-dependency", "phase-dependency"] as const;

/**
 * The four convergence recipe kinds, **in most-restrictive-first order**. Points legitimately
 * overlap — `docs/spec/00.index.md` matches both a `regenerate` point and a `docs/spec/**`
 * `orchestrator-only` one — and without a stated tie-break, plan-time eligibility and merge-time
 * restore could disagree about the same file. This array is that total order.
 */
export const RECIPE_KINDS = ["orchestrator-only", "replay", "regenerate", "exclusive-lane"] as const;

export type RecipeKind = (typeof RECIPE_KINDS)[number];

export interface ConvergencePoint {
  id: string;
  paths: string[];
  class?: string;
  recipe: { kind: RecipeKind; command?: string };
}

/** The `couplings[]` projection out of `partition-postmortem.lock.json` — never Markdown (§3.3a). */
export interface PriorPostmortemRow {
  fromTask: string;
  toTask: string;
  path: string;
  detectedAt: string;
  resolution: string;
}

/**
 * `analyzeConflicts`' fifth argument.
 *
 * §5.2 names two members; the third is here because the prefix-directory clause of
 * `write-set-overlap` is defined over path existence (§5.3's `existing_paths` row) and the arity is
 * fixed at five. Every member is injected by the command, and none is read from disk.
 * @req FR-NODE-147, FR-NODE-145
 */
export interface ConflictConstraints {
  codeRoots: string[];
  testRoots: string[];
  existingPaths: string[];
}

/** `{a, b, reason}`, or `{a, reason}` for a unary barrier or routing edge. */
export interface ConflictEdge {
  a: string;
  b?: string;
  reason: ConflictReason;
  /** `convergence-point` only: the registry point whose recipe kind won the precedence order. */
  pointId?: string;
  recipeKind?: RecipeKind;
}

/**
 * The closed structural-change marker vocabulary. `module-barrier` is stated over what a task's
 * free-text `action` "declares", which no pure function can decide, so the predicate is a lexical
 * test over this vocabulary. Its false negatives are declared rather than denied: `kiwi-planner`
 * §0.22 makes stating the fact in `action` an authoring obligation, so an author who omits it
 * produces no edge, and two named backstops catch it at runtime.
 */
export const MODULE_CHANGE_MARKERS = [
  "move",
  "moved",
  "rename",
  "renamed",
  "relocate",
  "delete",
  "deleted",
  "remove",
  "removed",
  "signature",
  "extract",
  "split"
] as const;

/**
 * The SpecKiwi mutation verbs that imply an SRS write, minus the four calls `kiwi-coder` §0.12
 * already makes inline (`add_trace_link`, `add_verification_evidence`, `update_status`,
 * `add_completed_work`), which are absent from this list rather than subtracted from it.
 * `TaskType` has no `srs` member, so the `type` disjunct of §5.2's row is dead and only this is live.
 */
export const SRS_MUTATION_VERBS = [
  "add_requirement",
  "edit_requirement_fields",
  "replace_acceptance_criteria",
  "edit_requirement_table_rows",
  "supersede_requirement",
  "update_stability",
  "register_scopes",
  "scaffold_scope",
  "append_section_note",
  "promote_step_requirement",
  "synthesize_step_srs"
] as const;

/** The task types that may be lane-eligible under charter C1's first clause. */
const LANE_ELIGIBLE_TYPES: readonly string[] = ["code", "perf_test"];

// Repo-relative paths are case-insensitive on Windows and not elsewhere, so the comparison — never
// the recorded value — is folded. `process.platform` is a process constant, not an ambient read.
const CASE_INSENSITIVE_PATHS = process.platform === "win32";

function comparablePath(path: string): string {
  return CASE_INSENSITIVE_PATHS ? path.toLowerCase() : path;
}

function segmentToRegex(segment: string): string {
  return segment.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, "[^/]*");
}

function globToRegExpSource(pattern: string): string {
  const segments = pattern.split("/");
  let source = "";
  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index] ?? "";
    const first = index === 0;
    const last = index === segments.length - 1;
    if (segment === "**") {
      if (first && last) return "^.*$";
      // Zero or more whole segments. Leading `**` swallows the separator that follows it; anywhere
      // else it swallows the one that precedes it, so both forms can match zero segments.
      source += first ? "(?:.*/)?" : last ? "(?:/.*)?" : "(?:/.*)?/";
      continue;
    }
    const needsSeparator = !first && segments[index - 1] !== "**";
    source += (needsSeparator ? "/" : "") + segmentToRegex(segment);
  }
  return `^${source}$`;
}

/**
 * The registry glob matcher, stated once and used by every caller that matches a path against the
 * convergence registry. `*` matches within one path segment and never crosses `/`; `**` matches zero
 * or more whole segments; there is no brace or character-class syntax. @req FR-NODE-147
 */
export function matchesGlob(path: string, pattern: string): boolean {
  const source = globToRegExpSource(comparablePath(normalizeDeclaredPath(pattern)));
  return new RegExp(source).test(comparablePath(normalizeDeclaredPath(path)));
}

/** The most restrictive of the matched kinds, under `RECIPE_KINDS`' order. @req FR-NODE-147 */
export function resolveRecipeKind(kinds: readonly RecipeKind[]): RecipeKind {
  let winner: RecipeKind = "exclusive-lane";
  let winningRank: number = RECIPE_KINDS.length;
  for (const kind of kinds) {
    const rank = RECIPE_KINDS.indexOf(kind);
    if (rank >= 0 && rank < winningRank) {
      winner = kind;
      winningRank = rank;
    }
  }
  return winner;
}

function writeSetOf(task: TaskCatalogEntry): string[] {
  const entries: TaskFileEntry[] = [...task.files, ...task.testFiles];
  return [...new Set(entries.map((entry) => entry.path))];
}

function isPrefixDirectory(directory: string, path: string): boolean {
  return path.length > directory.length && path.startsWith(`${directory}/`);
}

function overlaps(left: readonly string[], right: readonly string[], existing: ReadonlySet<string>): boolean {
  const rightFolded = new Set(right.map(comparablePath));
  for (const path of left) {
    const folded = comparablePath(path);
    if (rightFolded.has(folded)) return true;
    // The prefix-directory clause. A declared path absent from `existing_paths` is a to-be-created
    // file, and a directory that does not exist yet cannot be a shared parent, so the clause is
    // suppressed for it. @req FR-NODE-145
    for (const other of rightFolded) {
      if (isPrefixDirectory(folded, other) && existing.has(folded)) return true;
      if (isPrefixDirectory(other, folded) && existing.has(other)) return true;
    }
  }
  return false;
}

function intersects(left: readonly string[], right: readonly string[]): boolean {
  const set = new Set(right);
  return left.some((item) => set.has(item));
}

function transitiveDependencies(catalog: readonly TaskCatalogEntry[]): Map<string, Set<string>> {
  const byId = new Map(catalog.map((task) => [task.id, task]));
  const resolved = new Map<string, Set<string>>();
  const onStack = new Set<string>();

  const visit = (id: string): Set<string> => {
    const cached = resolved.get(id);
    if (cached) return cached;
    // A cycle terminates the walk rather than throwing: `computeLanePlan` runs its own cycle
    // detection and reports `schedule-cycle`, and this function must stay total.
    if (onStack.has(id)) return new Set<string>();
    onStack.add(id);
    const deps = new Set<string>();
    for (const dependency of byId.get(id)?.depends_on_task ?? []) {
      if (!byId.has(dependency)) continue;
      deps.add(dependency);
      for (const nested of visit(dependency)) deps.add(nested);
    }
    onStack.delete(id);
    resolved.set(id, deps);
    return deps;
  };

  for (const task of catalog) visit(task.id);
  return resolved;
}

function firesModuleBarrier(action: string, existingModules: readonly string[]): boolean {
  const folded = action.toLowerCase();
  if (!MODULE_CHANGE_MARKERS.some((marker) => folded.includes(marker))) return false;
  return existingModules.some((moduleName) => {
    const path = normalizeDeclaredPath(moduleName).toLowerCase();
    if (path.length === 0) return false;
    const basename = path.slice(path.lastIndexOf("/") + 1);
    return folded.includes(path) || folded.includes(basename);
  });
}

function firesSrsWrite(action: string): boolean {
  const folded = action.toLowerCase();
  return SRS_MUTATION_VERBS.some((verb) => folded.includes(verb));
}

function insideRoots(paths: readonly string[], roots: readonly string[]): boolean {
  return paths.every((path) => roots.some((root) => matchesGlob(path, root)));
}

/** The registry points whose globs a task's write set touches, lowest id first. */
function matchedPoints(writeSet: readonly string[], registry: readonly ConvergencePoint[]): ConvergencePoint[] {
  return registry
    .filter((point) => point.paths.some((pattern) => writeSet.some((path) => matchesGlob(path, pattern))))
    .sort((left, right) => compareStrings(left.id, right.id));
}

function sortedPair(left: string, right: string): [string, string] {
  return compareStrings(left, right) <= 0 ? [left, right] : [right, left];
}

function edgeKey(edge: ConflictEdge): string {
  return [edge.reason, edge.a, edge.b ?? "", edge.pointId ?? ""].join(" ");
}

/**
 * Classify one wave's catalogue into the closed conflict enum.
 *
 * Five arguments, matching §10.1: `learned-coupling` is derivable only from `priorPostmortems` and
 * `non-code-write-set`'s second clause only from `constraints`. @req FR-NODE-147
 */
export function analyzeConflicts(
  catalog: readonly TaskCatalogEntry[],
  registry: readonly ConvergencePoint[],
  existingModules: readonly string[],
  priorPostmortems: readonly PriorPostmortemRow[],
  constraints: ConflictConstraints
): ConflictEdge[] {
  const edges: ConflictEdge[] = [];
  const byId = new Map(catalog.map((task) => [task.id, task]));
  const writeSets = new Map(catalog.map((task) => [task.id, writeSetOf(task)]));
  const existing = new Set(constraints.existingPaths.map((path) => comparablePath(normalizeDeclaredPath(path))));
  const roots = [...constraints.codeRoots, ...constraints.testRoots];

  // task-dependency — the transitive closure, so `b ∈ transitiveDeps(a)` is what the edge means.
  for (const [id, dependencies] of transitiveDependencies(catalog)) {
    for (const dependency of dependencies) edges.push({ a: id, b: dependency, reason: "task-dependency" });
  }

  // phase-dependency — the phase graph lifted to task edges. The phase's `depends_on` is carried on
  // the catalogue entry because `analyzeConflicts` takes no phase argument.
  const tasksByPhase = new Map<string, string[]>();
  for (const task of catalog) {
    if (typeof task.phase_id !== "string") continue;
    tasksByPhase.set(task.phase_id, [...(tasksByPhase.get(task.phase_id) ?? []), task.id]);
  }
  for (const task of catalog) {
    for (const phase of task.phaseDependsOn) {
      for (const other of tasksByPhase.get(phase) ?? []) {
        if (other !== task.id) edges.push({ a: task.id, b: other, reason: "phase-dependency" });
      }
    }
  }

  for (let i = 0; i < catalog.length; i += 1) {
    for (let j = i + 1; j < catalog.length; j += 1) {
      const left = catalog[i] as TaskCatalogEntry;
      const right = catalog[j] as TaskCatalogEntry;
      const [a, b] = sortedPair(left.id, right.id);

      if (overlaps(writeSets.get(left.id) ?? [], writeSets.get(right.id) ?? [], existing)) {
        edges.push({ a, b, reason: "write-set-overlap" });
      }
      const tddPaired =
        intersects(left.coversAc, right.coversAc) &&
        ((left.tdd?.phase === "red" && right.tdd?.phase === "green") ||
          (left.tdd?.phase === "green" && right.tdd?.phase === "red"));
      if (tddPaired) edges.push({ a, b, reason: "tdd-pair" });
      if (intersects(left.req_ids, right.req_ids)) edges.push({ a, b, reason: "req-shared" });
    }
  }

  // convergence-point — the registry hit decides nothing; the matched point's recipe kind does.
  const exclusiveUnits = new Map<string, string[]>();
  for (const task of catalog) {
    const points = matchedPoints(writeSets.get(task.id) ?? [], registry);
    if (points.length === 0) continue;
    const kind = resolveRecipeKind(points.map((point) => point.recipe.kind));
    const point = points.find((candidate) => candidate.recipe.kind === kind) as ConvergencePoint;
    if (kind === "exclusive-lane") {
      exclusiveUnits.set(point.id, [...(exclusiveUnits.get(point.id) ?? []), task.id]);
      continue;
    }
    edges.push({ a: task.id, reason: "convergence-point", pointId: point.id, recipeKind: kind });
  }
  // An `exclusive-lane` unit is lane-eligible under whole-wave uniqueness: every task touching it is
  // forced into the one lane that owns it, which is a same-lane edge rather than epilogue routing.
  for (const [pointId, taskIds] of [...exclusiveUnits].sort(([left], [right]) => compareStrings(left, right))) {
    const sorted = [...taskIds].sort(compareStrings);
    for (let i = 0; i < sorted.length; i += 1) {
      for (let j = i + 1; j < sorted.length; j += 1) {
        edges.push({
          a: sorted[i] as string,
          b: sorted[j] as string,
          reason: "convergence-point",
          pointId,
          recipeKind: "exclusive-lane"
        });
      }
    }
  }

  for (const task of catalog) {
    if (firesModuleBarrier(task.action, existingModules)) edges.push({ a: task.id, reason: "module-barrier" });
    const writeSet = writeSets.get(task.id) ?? [];
    const inferred = [...task.files, ...task.testFiles].some((entry) => entry.inferred);
    if (task.files.length === 0 || inferred) edges.push({ a: task.id, reason: "unknown-write-set" });
    if (firesSrsWrite(task.action)) edges.push({ a: task.id, reason: "srs-write" });
    if (!LANE_ELIGIBLE_TYPES.includes(task.type) || !insideRoots(writeSet, roots)) {
      edges.push({ a: task.id, reason: "non-code-write-set" });
    }
  }

  // learned-coupling — the whole of "partition quality improves": a coupling the merge gate caught
  // in wave 2 forces same-lane in wave 3, without waiting for a second merge failure.
  for (const row of priorPostmortems) {
    if (row.resolution !== "merge-into-one-lane") continue;
    if (byId.has(row.fromTask) && byId.has(row.toTask) && row.fromTask !== row.toTask) {
      const [a, b] = sortedPair(row.fromTask, row.toTask);
      edges.push({ a, b, reason: "learned-coupling" });
      continue;
    }
    // Either task id is gone from this wave's sidecar: couple the tasks whose declared files carry
    // the row's path instead.
    const path = comparablePath(normalizeDeclaredPath(row.path));
    const carriers = catalog
      .filter((task) => task.files.some((entry) => comparablePath(entry.path) === path))
      .map((task) => task.id)
      .sort(compareStrings);
    for (let i = 0; i < carriers.length; i += 1) {
      for (let j = i + 1; j < carriers.length; j += 1) {
        edges.push({ a: carriers[i] as string, b: carriers[j] as string, reason: "learned-coupling" });
      }
    }
  }

  const seen = new Set<string>();
  return edges
    .filter((edge) => {
      const key = edgeKey(edge);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort(
      (left, right) =>
        CONFLICT_REASONS.indexOf(left.reason) - CONFLICT_REASONS.indexOf(right.reason) ||
        compareStrings(left.a, right.a) ||
        compareStrings(left.b ?? "", right.b ?? "") ||
        compareStrings(left.pointId ?? "", right.pointId ?? "")
    );
}
