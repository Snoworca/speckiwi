// @req FR-NODE-145, FR-NODE-146, FR-NODE-148 — the lane plan.
//
// Pure and byte-deterministic over its nine declared inputs. Determinism is a contract rather than a
// style preference: §4.7's drift digest 3 recomputes this plan from the inputs `lanes.lock.json`
// itself records and compares byte-for-byte, so a planner that read the filesystem would make that
// check fire on any unrelated file creation. Path existence therefore arrives injected, and
// grounding — which does need the disk — stays in `orchestrate schedule plan`.
import {
  ORDERING_REASONS,
  SAME_LANE_REASONS,
  SERIAL_EPILOGUE_REASONS,
  STAGE_BARRIER_REASONS,
  analyzeConflicts,
  type ConflictEdge,
  type ConflictReason,
  type ConvergencePoint,
  type PriorPostmortemRow
} from "./conflict.js";
import { compareStrings, type TaskCatalogEntry } from "./task-catalog.js";
import { selectNextTask } from "../workflow/validate.js";

export interface LanePlanInput {
  catalog: TaskCatalogEntry[];
  registry: ConvergencePoint[];
  existingModules: string[];
  /** Injected, never read from disk (§5.1). A per-wave snapshot; its staleness is accepted. */
  existingPaths: string[];
  priorPostmortems: PriorPostmortemRow[];
  /** `{req_id -> [D-nnn]}`, fixed at Phase 3.b. The only producer of `lanes[].design_items`. */
  designItemMap: Record<string, string[]>;
  /** `--lanes N`, and it means per stage. An input rather than configuration: it changes the bytes. */
  laneCap: number;
  codeRoots: string[];
  testRoots: string[];
}

export interface Lane {
  laneId: string;
  stage: number;
  taskIds: string[];
  writeSet: string[];
  /**
   * Empty at plan time. `read_set` is a handoff field authored two phases later and the sidecar
   * `Task` interface carries no read declaration at all (X-04, R37), so nothing here can fill it.
   */
  readSet: string[];
  reqIds: string[];
  designItems: string[];
}

export interface Stage {
  index: number;
  laneIds: string[];
}

export interface LanePlan {
  lanes: Lane[];
  stages: Stage[];
  laneCount: number;
  stageCount: number;
  serialEpilogue: string[];
  /**
   * Always empty — the routing rules are total. The field is retained so the completeness invariant
   * stays a checkable partition and the phase-2 executor consumes an identical shape.
   */
  unassigned: string[];
  serialized: string[];
  conflicts: ConflictEdge[];
}

/**
 * `non-code-write-set-refused` is deliberately not a member.
 *
 * §5.3 lists it among the blocking outcomes of `orchestrate schedule plan` — "a `non-code-write-set`
 * task that some other same-lane edge has already pulled into a lane, which the epilogue assignment
 * cannot then undo". Measured against the five pinned real sidecars, that condition holds for eleven
 * tasks in one of them alone, because `req-shared` forces same-lane so a REQ's promotion is atomic
 * and `kiwi-planner` emits seven non-code task types beside `code`. The condition is removed at its
 * source instead: an epilogue-bound task is never a node of the component graph, so no assignment
 * has to be undone. @req FR-NODE-146
 */
export const LANE_PLAN_ERROR_CODES = ["schedule-cycle", "lane-plan-incomplete"] as const;

export type LanePlanErrorCode = (typeof LANE_PLAN_ERROR_CODES)[number];

/** A blocking outcome of `orchestrate schedule plan`, raised as an error rather than a warning. */
export class LanePlanError extends Error {
  readonly code: LanePlanErrorCode;

  constructor(code: LanePlanErrorCode, detail: string) {
    super(`${code}: ${detail}`);
    this.name = "LanePlanError";
    this.code = code;
  }
}

function isReason(edge: ConflictEdge, reasons: readonly ConflictReason[]): boolean {
  return reasons.includes(edge.reason);
}

/** Same-lane forcing includes an `exclusive-lane` registry match, which is binary and not epilogue. */
function forcesSameLane(edge: ConflictEdge): boolean {
  if (edge.b === undefined) return false;
  if (isReason(edge, SAME_LANE_REASONS)) return true;
  return edge.reason === "convergence-point" && edge.recipeKind === "exclusive-lane";
}

function routesToEpilogue(edge: ConflictEdge): boolean {
  if (isReason(edge, SERIAL_EPILOGUE_REASONS)) return true;
  return edge.reason === "convergence-point" && edge.b === undefined && edge.recipeKind !== "exclusive-lane";
}

function findDependencyCycle(catalog: readonly TaskCatalogEntry[]): string[] | null {
  const byId = new Map(catalog.map((task) => [task.id, task]));
  const done = new Set<string>();
  const stack = new Set<string>();
  let cycle: string[] | null = null;

  const visit = (id: string, path: string[]): void => {
    if (cycle || done.has(id)) return;
    if (stack.has(id)) {
      cycle = [...path.slice(path.indexOf(id)), id];
      return;
    }
    stack.add(id);
    for (const dependency of byId.get(id)?.depends_on_task ?? []) {
      if (byId.has(dependency)) visit(dependency, [...path, id]);
    }
    stack.delete(id);
    done.add(id);
  };

  for (const task of catalog) visit(task.id, []);
  return cycle;
}

/**
 * Connected components of the same-lane edge union, tasks sorted by id, components by first id.
 *
 * **Only lane-eligible tasks are nodes**, and that is a departure from a literal reading of 05 §5.3
 * worth stating. §5.3 defines the epilogue set *before* it defines `lanes = connected components of
 * the union of same-lane edges`, and then lists as a blocking outcome "a `non-code-write-set` task
 * that some other same-lane edge has already pulled into a lane, which the epilogue assignment
 * cannot then undo" (`non-code-write-set-refused`). Measured against the five pinned real sidecars
 * that outcome fires for eleven tasks in one of them alone — `req-shared` forces same-lane so a
 * requirement's promotion is atomic, and `kiwi-planner` emits seven non-code task types beside
 * `code` — so a partitioner that forms components over every task and refuses afterwards cannot plan
 * a real wave at all, and FR-NODE-146 AC-3 requires a plan over exactly those fixtures.
 *
 * Excluding epilogue-bound tasks from the node set removes the condition at its source instead of
 * deleting the gate: nothing is ever pulled into a lane that has to be undone. **The consequence,
 * stated because it is not obvious:** an edge whose two endpoints are lane-eligible but which passes
 * *through* an epilogue-bound task no longer joins the two lanes on either side. That follows from
 * §5.3's own definition — an epilogue task is not a lane member, so it cannot be the vertex that
 * connects two lanes. @req FR-NODE-145, FR-NODE-146
 */
function connectedComponents(
  catalog: readonly TaskCatalogEntry[],
  edges: readonly ConflictEdge[],
  laneEligible: ReadonlySet<string>
): string[][] {
  const members = catalog.filter((task) => laneEligible.has(task.id));
  const parent = new Map<string, string>(members.map((task) => [task.id, task.id]));
  const find = (id: string): string => {
    let root = id;
    while (parent.get(root) !== root) root = parent.get(root) as string;
    let cursor = id;
    while (parent.get(cursor) !== root) {
      const next = parent.get(cursor) as string;
      parent.set(cursor, root);
      cursor = next;
    }
    return root;
  };
  for (const edge of edges) {
    if (!forcesSameLane(edge)) continue;
    if (!laneEligible.has(edge.a) || !laneEligible.has(edge.b as string)) continue;
    const left = find(edge.a);
    const right = find(edge.b as string);
    if (left !== right) parent.set(left, right);
  }

  const grouped = new Map<string, string[]>();
  for (const task of members) {
    const root = find(task.id);
    grouped.set(root, [...(grouped.get(root) ?? []), task.id]);
  }
  return [...grouped.values()]
    .map((members) => [...members].sort(compareStrings))
    .sort((left, right) => compareStrings(left[0] as string, right[0] as string));
}

function sortedUnion(values: Iterable<string>): string[] {
  return [...new Set(values)].sort(compareStrings);
}

/** Topological layering of lanes under the induced lane-level dependency order. */
function layerLanes(laneMembers: string[][], edges: readonly ConflictEdge[]): string[][][] {
  const laneOfTask = new Map<string, number>();
  laneMembers.forEach((members, index) => {
    for (const id of members) laneOfTask.set(id, index);
  });

  const dependsOn = laneMembers.map(() => new Set<number>());
  for (const edge of edges) {
    if (!isReason(edge, ORDERING_REASONS) || edge.b === undefined) continue;
    const from = laneOfTask.get(edge.a);
    const to = laneOfTask.get(edge.b);
    if (from === undefined || to === undefined || from === to) continue;
    (dependsOn[from] as Set<number>).add(to);
  }

  const placed = new Set<number>();
  const layers: string[][][] = [];
  while (placed.size < laneMembers.length) {
    const ready = laneMembers
      .map((_members, index) => index)
      .filter((index) => !placed.has(index) && [...(dependsOn[index] as Set<number>)].every((dep) => placed.has(dep)));
    if (ready.length === 0) {
      // The task graph is acyclic yet the lane graph is not: grouping made two lanes each depend on
      // the other, and no layering exists. That is a dependency cycle at lane level.
      throw new LanePlanError("schedule-cycle", "the lane dependency graph induced by the partition is cyclic");
    }
    layers.push(ready.map((index) => laneMembers[index] as string[]));
    for (const index of ready) placed.add(index);
  }
  return layers;
}

function splitByBarriers(layer: string[][], barrierTasks: ReadonlySet<string>): string[][][] {
  const barrierLanes = layer.filter((members) => members.some((id) => barrierTasks.has(id)));
  const plainLanes = layer.filter((members) => !members.some((id) => barrierTasks.has(id)));
  // A barrier invalidates every other lane's file coordinates, so it is alone in its stage.
  return [...barrierLanes.map((members) => [members]), ...(plainLanes.length > 0 ? [plainLanes] : [])];
}

function splitByCap(stage: string[][], laneCap: number): string[][][] {
  if (stage.length <= laneCap) return [stage];
  // Longest first, so the widest stage runs first and the split is deterministic.
  const ordered = [...stage].sort(
    (left, right) => right.length - left.length || compareStrings(left[0] as string, right[0] as string)
  );
  const chunks: string[][][] = [];
  for (let index = 0; index < ordered.length; index += laneCap) chunks.push(ordered.slice(index, index + laneCap));
  return chunks;
}

/**
 * The exact sequence the existing serial task selector produces over the same catalogue, so that
 * degrading a run to serial execution is behaviour-preserving rather than merely argued to be.
 * The selector itself is the source; nothing here re-derives its ordering. @req FR-NODE-148
 */
function serialize(catalog: readonly TaskCatalogEntry[]): string[] {
  const working = catalog.map((task) => ({ ...task }));
  const order: string[] = [];
  for (let guard = 0; guard <= working.length; guard += 1) {
    const { nextTask } = selectNextTask(working);
    if (!nextTask) return order;
    order.push(nextTask.id);
    nextTask.status = "done";
  }
  return order;
}

/**
 * Every catalogue task appears exactly once across lanes, the serial epilogue and unassigned.
 *
 * This is the partition-layer analogue of the decomposition coverage gate: a silently dropped task
 * is the execution-model equivalent of an unassigned design item, and nothing downstream would
 * notice it, because every consumer reads the plan rather than the catalogue. A violation fails the
 * call — it is never a warning attached to a returned plan. @req FR-NODE-146
 */
export function assertLanePlanPartition(catalog: readonly TaskCatalogEntry[], plan: LanePlan): void {
  const placed = [...plan.lanes.flatMap((lane) => lane.taskIds), ...plan.serialEpilogue, ...plan.unassigned];
  const declared = catalog.map((task) => task.id);
  const placedSet = new Set(placed);

  const duplicated = sortedUnion(placed.filter((id, index) => placed.indexOf(id) !== index));
  const missing = sortedUnion(declared.filter((id) => !placedSet.has(id)));
  const unknown = sortedUnion(placed.filter((id) => !declared.includes(id)));

  if (duplicated.length === 0 && missing.length === 0 && unknown.length === 0) return;
  throw new LanePlanError(
    "lane-plan-incomplete",
    `missing=[${missing.join(", ")}] duplicated=[${duplicated.join(", ")}] unknown=[${unknown.join(", ")}]`
  );
}

/**
 * Compute the lane plan. Pure and deterministic: two calls with equal inputs produce byte-identical
 * output, and no path is read from the filesystem. @req FR-NODE-145
 */
export function computeLanePlan(input: LanePlanInput): LanePlan {
  const cycle = findDependencyCycle(input.catalog);
  if (cycle) throw new LanePlanError("schedule-cycle", cycle.join(" -> "));

  const conflicts = analyzeConflicts(input.catalog, input.registry, input.existingModules, input.priorPostmortems, {
    codeRoots: input.codeRoots,
    testRoots: input.testRoots,
    existingPaths: input.existingPaths
  });

  const epilogueTasks = new Set(conflicts.filter(routesToEpilogue).map((edge) => edge.a));
  const barrierTasks = new Set(conflicts.filter((edge) => isReason(edge, STAGE_BARRIER_REASONS)).map((edge) => edge.a));
  const hasDependents = new Set(
    conflicts.filter((edge) => isReason(edge, ORDERING_REASONS) && edge.b !== undefined).map((edge) => edge.b as string)
  );

  const laneEligible = new Set(input.catalog.map((task) => task.id).filter((id) => !epilogueTasks.has(id)));
  const laneMembers: string[][] = [];
  const folded: string[] = [];
  for (const component of connectedComponents(input.catalog, conflicts, laneEligible)) {
    // 05 §5.3, the rules list: "A lane with a single task and no dependents is folded into the
    // serial epilogue — per-lane overhead is fixed and per-lane gain is proportional to the work
    // inside." This is a stated design rule, not an optimisation invented here. It has one
    // consequence worth knowing: §5.3 states no exemption for a registry-owned unit, so an
    // `exclusive-lane` unit touched by exactly one task that nothing depends on produces no lane.
    // Whole-wave uniqueness is not violated — zero lanes own it, and the epilogue is serial.
    if (component.length === 1 && !hasDependents.has(component[0] as string)) {
      folded.push(component[0] as string);
      continue;
    }
    laneMembers.push(component);
  }

  const stagesOfLanes: string[][][] = [];
  for (const layer of layerLanes(laneMembers, conflicts)) {
    for (const stage of splitByBarriers(layer, barrierTasks)) {
      for (const capped of splitByCap(stage, Math.max(1, input.laneCap))) stagesOfLanes.push(capped);
    }
  }

  const byId = new Map(input.catalog.map((task) => [task.id, task]));
  const lanes: Lane[] = [];
  const stages: Stage[] = [];
  stagesOfLanes.forEach((stageLanes, stageIndex) => {
    const ordered = [...stageLanes].sort((left, right) => compareStrings(left[0] as string, right[0] as string));
    const laneIds: string[] = [];
    for (const members of ordered) {
      const laneId = `l${lanes.length + 1}`;
      const tasks = members.map((id) => byId.get(id)).filter((task): task is TaskCatalogEntry => task !== undefined);
      const reqIds = sortedUnion(tasks.flatMap((task) => task.req_ids));
      lanes.push({
        laneId,
        stage: stageIndex + 1,
        taskIds: members,
        writeSet: sortedUnion(tasks.flatMap((task) => [...task.files, ...task.testFiles].map((entry) => entry.path))),
        readSet: [],
        reqIds,
        designItems: sortedUnion(reqIds.flatMap((reqId) => input.designItemMap[reqId] ?? []))
      });
      laneIds.push(laneId);
    }
    stages.push({ index: stageIndex + 1, laneIds });
  });

  const epilogue = new Set([...epilogueTasks, ...folded]);
  const plan: LanePlan = {
    lanes,
    stages,
    laneCount: lanes.length,
    stageCount: stages.length,
    // 05 §5.3: "serial_epilogue = { … }, in declaration order". It carries both the routed tasks and
    // the folded ones. §6.1's `write_set[]` row calls the folded ones `demoted` and unions them with
    // `serial_epilogue ∪ unassigned`, but §3.3a's `lanes.lock.json` body has no `demoted` field and
    // FR-NODE-146 asserts a three-bucket partition — so they go here, where the partition closes.
    serialEpilogue: input.catalog.map((task) => task.id).filter((id) => epilogue.has(id)),
    unassigned: [],
    serialized: serialize(input.catalog),
    conflicts
  };

  assertLanePlanPartition(input.catalog, plan);
  return plan;
}
