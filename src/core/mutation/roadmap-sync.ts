import { parseWorkspace } from "../parser/workspace-parser.js";
import type { PatchOperation } from "../patch/patch-plan.js";
import { proposeRoadmapActuals, type RoadmapActualProposal } from "../roadmap/actual-dates.js";
import { readRoadmapFile, resolveRoadmapDate, roadmapSourcesOf } from "../roadmap/load-roadmap.js";
import { parseRoadmap } from "../roadmap/parse-roadmap.js";
import { ROADMAP_EMPTY, ROADMAP_PATH } from "../roadmap/roadmap-grammar.js";
import type { MutationResult, ProjectRoot } from "../types.js";
import { mutationNoopEnvelope, withMutationEnvelope } from "./envelope.js";
import { mutationFail, mutationOk } from "./guards.js";
import { commitRoadmapWrite, planRoadmapItemChanges } from "./roadmap-items.js";
import { withSrsMutationLock } from "./srs-lock.js";

// @req FR-NODE-257
//
// The roadmap sync: it fills the empty Actual Start and Actual End cells that the computed status
// supports, on the as-of date. It proposes by default and writes only when asked to apply, through the
// same lock, patch plan and history rows as update, and it never touches a date already recorded.

export interface SyncRoadmapActualsInput {
  /** The date proposed and written; defaults to today's local date. */
  asOf?: string;
  /** Write the proposals. Without it the sync only proposes. */
  apply?: boolean;
  /** Limit the sync to one item. */
  item?: string;
  /** The Change History date of written rows; defaults to today's local date. */
  date?: string;
  ignoreLock?: boolean;
  skipLock?: boolean;
}

export interface SyncRoadmapActualsOutput {
  asOf: string;
  /** True unless `apply` was given. */
  dryRun: boolean;
  written: boolean;
  proposals: RoadmapActualProposal[];
}

const KIND = "sync_roadmap_actuals";

// @req FR-NODE-257 AC-1 AC-2 AC-3 AC-4 AC-5
export async function syncRoadmapActuals(root: ProjectRoot, input: SyncRoadmapActualsInput = {}): Promise<MutationResult<SyncRoadmapActualsOutput>> {
  const dryRun = input.apply !== true;
  return withSrsMutationLock(root, { operation: KIND, dryRun, ignoreLock: input.ignoreLock, skipLock: input.skipLock }, () => syncUnlocked(root, input, dryRun));
}

async function syncUnlocked(root: ProjectRoot, input: SyncRoadmapActualsInput, dryRun: boolean): Promise<MutationResult<SyncRoadmapActualsOutput>> {
  const asOf = resolveRoadmapDate(input.asOf, "as-of");
  if (!asOf.ok) return mutationFail(asOf.error.code, asOf.error.message);
  const date = resolveRoadmapDate(input.date, "date");
  if (!date.ok) return mutationFail(date.error.code, date.error.message);
  const itemId = input.item?.trim();
  const file = await readRoadmapFile(root);
  const noop = (proposals: RoadmapActualProposal[]) =>
    withMutationEnvelope(mutationOk<SyncRoadmapActualsOutput>({ asOf: asOf.value, dryRun, written: false, proposals }), mutationNoopEnvelope(KIND, ROADMAP_PATH, dryRun));
  if (!file) return itemId ? mutationFail("NOT_FOUND", `Roadmap item not found: ${itemId}; ${ROADMAP_PATH} does not exist`) : noop([]);

  const sources = await roadmapSourcesOf(await parseWorkspace(root));
  const document = parseRoadmap(file.text, sources).document;
  if (itemId && !document.items.some((item) => item.id === itemId)) return mutationFail("NOT_FOUND", `Roadmap item not found: ${itemId}`);
  const proposals = proposeRoadmapActuals(document, sources, asOf.value, itemId);
  if (proposals.length === 0) return noop([]);

  const operations: PatchOperation[] = [];
  for (const item of document.items) {
    const own = proposals.filter((proposal) => proposal.item === item.id);
    if (own.length === 0) continue;
    const changes = own.map((proposal) => ({ field: proposal.field, from: ROADMAP_EMPTY, to: proposal.value }));
    const reason = `roadmap sync: ${own[0]!.status} by ${own[0]!.rule}`;
    const planned = planRoadmapItemChanges(file, item, changes, date.value, reason);
    if (!planned.ok) return mutationFail(planned.code, planned.message);
    operations.push(...planned.operations);
  }
  return commitRoadmapWrite<SyncRoadmapActualsOutput>(KIND, file, operations, sources, { asOf: asOf.value, dryRun, written: false, proposals }, { dryRun, create: false });
}
