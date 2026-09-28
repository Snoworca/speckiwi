// @req FR-NODE-145, FR-NODE-146, FR-NODE-213 — the wave schedule: one lane per wave.
//
// Pure and byte-deterministic over its three declared inputs — each wave's SDS write set, the waves'
// declared dependencies and the lane cap. Determinism is a contract rather than a style preference:
// drift digest 3 recomputes the plan's inputs from what `lanes.lock.json` records, so a planner that
// read the filesystem would drift on any unrelated file change. Grounding, which does need the disk,
// stays in `orchestrate schedule waves`.
import {
  analyzeConflicts,
  compareStrings,
  resolveWaveDependencies,
  type ConflictEdge,
  type WaveDependencies,
  type WaveInput
} from "./conflict.js";

export interface LanePlanInput {
  waves: WaveInput[];
  dependencies: WaveDependencies;
  /** `--lanes N`, per stage. An input rather than configuration: it changes the bytes. */
  laneCap: number;
}

/** A lane is one wave's worker (FR-NODE-213 AC-1). */
export interface Lane {
  /** `lane-{waveId}`: derived from the wave, so a re-scheduled wave keeps its journal key. */
  laneId: string;
  stage: number;
  wave: string;
  writeSet: string[];
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
  conflicts: ConflictEdge[];
}

export const LANE_PLAN_ERROR_CODES = ["schedule-cycle", "lane-plan-incomplete"] as const;

export type LanePlanErrorCode = (typeof LANE_PLAN_ERROR_CODES)[number];

/** A blocking outcome of `orchestrate schedule waves`, raised as an error rather than a warning. */
export class LanePlanError extends Error {
  readonly code: LanePlanErrorCode;

  constructor(code: LanePlanErrorCode, detail: string) {
    super(`${code}: ${detail}`);
    this.name = "LanePlanError";
    this.code = code;
  }
}

export function laneIdOf(waveId: string): string {
  return `lane-${waveId}`;
}

/** A wave given twice cannot land in exactly one lane, so the partition fails before it is built. */
function assertUniqueWaveIds(waves: readonly WaveInput[]): void {
  const seen = new Set<string>();
  for (const entry of waves) {
    if (seen.has(entry.waveId)) throw new LanePlanError("lane-plan-incomplete", `duplicated=[${entry.waveId}]: wave ${entry.waveId} is scheduled twice`);
    seen.add(entry.waveId);
  }
}

/**
 * Topological layers, a wave's layer being one above the highest layer among its dependencies. The
 * walk follows input order, so the layering and the cycle it reports are both deterministic.
 */
function layerWaves(waves: readonly WaveInput[], dependsOn: ReadonlyMap<string, string[]>): Map<string, number> {
  const layer = new Map<string, number>();
  const onStack: string[] = [];

  const visit = (waveId: string): number => {
    const known = layer.get(waveId);
    if (known !== undefined) return known;
    if (onStack.includes(waveId)) {
      throw new LanePlanError("schedule-cycle", [...onStack.slice(onStack.indexOf(waveId)), waveId].join(" -> "));
    }
    onStack.push(waveId);
    let highest = 0;
    for (const dependency of dependsOn.get(waveId) ?? []) highest = Math.max(highest, visit(dependency));
    onStack.pop();
    layer.set(waveId, highest + 1);
    return highest + 1;
  };

  for (const entry of waves) visit(entry.waveId);
  return layer;
}

function overlapKey(left: string, right: string): string {
  return compareStrings(left, right) <= 0 ? `${left}\u0000${right}` : `${right}\u0000${left}`;
}

/**
 * One layer split into consecutive stages: each wave, in input order, joins the first of this layer's
 * stages that has room under the cap and shares no write-set path with any wave already there.
 * @req FR-NODE-145 AC-6
 */
function splitLayer(layerWaveIds: readonly string[], overlapping: ReadonlySet<string>, laneCap: number): string[][] {
  const stages: string[][] = [];
  for (const waveId of layerWaveIds) {
    const home = stages.find((stage) => stage.length < laneCap && stage.every((other) => !overlapping.has(overlapKey(waveId, other))));
    if (home) home.push(waveId);
    else stages.push([waveId]);
  }
  return stages;
}

/**
 * Every input wave appears in exactly one lane. A violation fails the call — it is never a warning
 * attached to a returned plan, because every consumer reads the plan rather than the wave list and a
 * silently dropped wave would never be dispatched. @req FR-NODE-146
 */
export function assertLanePlanPartition(waves: readonly WaveInput[], plan: LanePlan): void {
  const placed = plan.lanes.map((lane) => lane.wave);
  const declared = new Set(waves.map((entry) => entry.waveId));
  const placedSet = new Set(placed);

  const sorted = (values: Iterable<string>): string[] => [...new Set(values)].sort(compareStrings);
  const duplicated = sorted(placed.filter((waveId, index) => placed.indexOf(waveId) !== index));
  const missing = sorted([...declared].filter((waveId) => !placedSet.has(waveId)));
  const unknown = sorted(placed.filter((waveId) => !declared.has(waveId)));

  if (duplicated.length === 0 && missing.length === 0 && unknown.length === 0) return;
  throw new LanePlanError(
    "lane-plan-incomplete",
    `missing=[${missing.join(", ")}] duplicated=[${duplicated.join(", ")}] unknown=[${unknown.join(", ")}]`
  );
}

/**
 * Compute the wave schedule: one lane per wave, every wave's dependencies in earlier stages, the waves
 * of one stage pairwise disjoint in their SDS write sets, at most `laneCap` lanes per stage.
 * @req FR-NODE-145, FR-NODE-213 AC-1
 */
export function computeLanePlan(input: LanePlanInput): LanePlan {
  assertUniqueWaveIds(input.waves);
  const dependsOn = resolveWaveDependencies(input.waves, input.dependencies);
  const layers = layerWaves(input.waves, dependsOn);
  const conflicts = analyzeConflicts(input.waves, input.dependencies);
  const overlapping = new Set(
    conflicts.filter((edge) => edge.reason === "write-set-overlap").map((edge) => overlapKey(edge.a, edge.b))
  );

  const laneCap = Math.max(1, input.laneCap);
  const deepest = Math.max(0, ...layers.values());
  const stageWaves: string[][] = [];
  for (let depth = 1; depth <= deepest; depth += 1) {
    const members = input.waves.map((entry) => entry.waveId).filter((waveId) => layers.get(waveId) === depth);
    stageWaves.push(...splitLayer(members, overlapping, laneCap));
  }

  const byId = new Map(input.waves.map((entry) => [entry.waveId, entry]));
  const lanes: Lane[] = [];
  const stages: Stage[] = stageWaves.map((waveIds, offset) => {
    const index = offset + 1;
    for (const waveId of waveIds) {
      lanes.push({
        laneId: laneIdOf(waveId),
        stage: index,
        wave: waveId,
        writeSet: [...new Set(byId.get(waveId)?.writeSet ?? [])].sort(compareStrings)
      });
    }
    return { index, laneIds: waveIds.map(laneIdOf) };
  });

  const plan: LanePlan = { lanes, stages, laneCount: lanes.length, stageCount: stages.length, conflicts };
  assertLanePlanPartition(input.waves, plan);
  return plan;
}
