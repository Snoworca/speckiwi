import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeTasks, type SidecarPhase, type SidecarTask, type TaskCatalogEntry } from "../../../src/core/orchestrator/task-catalog.js";
import type { LanePlanInput } from "../../../src/core/orchestrator/lane-plan.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

/**
 * The pinned real planner sidecars. FR-NODE-146 AC-3 and FR-NODE-148 AC-2 both require the
 * characterization fixtures to be built from real sidecars rather than from synthetic ones only,
 * because a small hand-written fixture cannot express a degenerate grouping. The list is pinned
 * rather than globbed so that a sidecar going missing fails the test instead of shrinking it.
 */
export const PINNED_SIDECAR_PATHS = [
  "docs/plans/2026-06-17.speckiwi.v3-0-0.sidecar.json",
  "docs/plans/2026-06-29.specwkiki.v230-plan.sidecar.json",
  "docs/plans/2026-07-08.speckiwi.v2301-kiwi-step.sidecar.json",
  "docs/plans/2026-07-10.speckiwi.v2301-flow.sidecar.json",
  "docs/plans/2026-07-28.speckiwi.v242.sidecar.json"
] as const;

export interface PinnedSidecar {
  relativePath: string;
  catalog: TaskCatalogEntry[];
}

export function loadPinnedSidecars(): PinnedSidecar[] {
  return PINNED_SIDECAR_PATHS.map((relativePath) => {
    const parsed = JSON.parse(readFileSync(path.join(repoRoot, relativePath), "utf8")) as {
      tasks?: SidecarTask[];
      phases?: SidecarPhase[];
    };
    return {
      relativePath,
      catalog: normalizeTasks(parsed.tasks ?? [], null, [], relativePath, parsed.phases ?? [])
    };
  });
}

/** Every input except `catalog` at its neutral value, so a fixture states only what it is about. */
export function laneInput(catalog: TaskCatalogEntry[], overrides: Partial<LanePlanInput> = {}): LanePlanInput {
  return {
    catalog,
    registry: [],
    existingModules: [],
    existingPaths: [],
    priorPostmortems: [],
    designItemMap: {},
    laneCap: 4,
    codeRoots: ["src/**"],
    testRoots: ["test/**"],
    ...overrides
  };
}

export function buildCatalog(tasks: SidecarTask[], phases?: SidecarPhase[]): TaskCatalogEntry[] {
  return normalizeTasks(tasks, null, [], undefined, phases);
}

/** A lane-eligible `code` task inside the default roots, so only the rule under test fires. */
export function codeTask(id: string, extra: Partial<SidecarTask> = {}): SidecarTask {
  return { id, type: "code", action: "", files: [{ path: `src/${id}.ts` }], ...extra };
}
