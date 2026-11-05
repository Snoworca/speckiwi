import { roadmapItemStatus, type RoadmapItemStatus } from "./compute-roadmap.js";
import { roadmapFieldValue } from "./parse-roadmap.js";
import { ROADMAP_EMPTY } from "./roadmap-grammar.js";
import type { RoadmapDocument, RoadmapItem, RoadmapSources } from "./roadmap-model.js";

// @req FR-NODE-257 AC-1 AC-2 AC-3 AC-5
//
// Which empty actual dates an item's computed status lets the sync fill on the as-of date. The SRS
// cannot say when work really started or ended — a Status change note exists only when the change was
// given a reason, and a Completed Work Log row only when one was added — so the date proposed is the
// day it was observed, and the earlier dates the SRS does record are listed beside it for a person who
// would rather record one of them.

export interface RoadmapDateCandidate {
  readonly date: string;
  readonly source: "change-note" | "completed-work";
  readonly requirementId: string;
  /** The change-note `Change` cell, or the Completed Work Log summary. */
  readonly text: string;
}

export interface RoadmapActualProposal {
  readonly item: string;
  readonly field: "Actual Start" | "Actual End";
  readonly value: string;
  readonly status: RoadmapItemStatus["status"];
  readonly rule: RoadmapItemStatus["rule"];
  readonly basis: RoadmapItemStatus["basis"];
  readonly candidates: RoadmapDateCandidate[];
}

const STARTED_STATUSES: ReadonlySet<string> = new Set(["in-progress", "done", "released"]);
const FINISHED_STATUSES: ReadonlySet<string> = new Set(["done", "released"]);
const STATUS_CHANGE = /^Status\s*->/;

/** The requirements a status rests on: the rule's own, or, for a target rule, the item's requirements of those targets. */
function basisRequirements(decided: RoadmapItemStatus, sources: RoadmapSources): string[] {
  if (decided.basis.requirements.length > 0) return decided.basis.requirements;
  const targets = new Set(decided.basis.targets);
  return decided.scope.requirements.filter((id) => targets.has(sources.requirements.find((record) => record.id === id)?.target ?? ""));
}

// @req FR-NODE-257 AC-2
/** The dates before `before` that the SRS records for the requirements a status rests on, oldest first. */
export function roadmapDateCandidates(decided: RoadmapItemStatus, sources: RoadmapSources, before: string): RoadmapDateCandidate[] {
  const ids = basisRequirements(decided, sources);
  const candidates: RoadmapDateCandidate[] = [];
  for (const id of ids) {
    const record = sources.requirements.find((entry) => entry.id === id);
    for (const note of record?.changeNotes ?? []) {
      if (STATUS_CHANGE.test(note.change) && note.date < before) candidates.push({ date: note.date, source: "change-note", requirementId: id, text: note.change });
    }
    for (const entry of sources.completedWork) {
      if (entry.requirementIds.includes(id) && entry.date < before) candidates.push({ date: entry.date, source: "completed-work", requirementId: id, text: entry.summary });
    }
  }
  return candidates.sort((a, b) => a.date.localeCompare(b.date) || a.requirementId.localeCompare(b.requirementId) || a.source.localeCompare(b.source));
}

function proposalsFor(document: RoadmapDocument, sources: RoadmapSources, asOf: string, item: RoadmapItem): RoadmapActualProposal[] {
  const decided = roadmapItemStatus(document, sources, item);
  const fields: RoadmapActualProposal["field"][] = [];
  if (roadmapFieldValue(item, "Actual Start") === ROADMAP_EMPTY && STARTED_STATUSES.has(decided.status)) fields.push("Actual Start");
  if (roadmapFieldValue(item, "Actual End") === ROADMAP_EMPTY && FINISHED_STATUSES.has(decided.status)) fields.push("Actual End");
  if (fields.length === 0) return [];
  const candidates = roadmapDateCandidates(decided, sources, asOf);
  return fields.map((field) => ({ item: item.id, field, value: asOf, status: decided.status, rule: decided.rule, basis: decided.basis, candidates }));
}

// @req FR-NODE-257 AC-1 AC-3 AC-5
/** The proposals for every item, or for `itemId` alone; an unknown `itemId` gives none. */
export function proposeRoadmapActuals(document: RoadmapDocument, sources: RoadmapSources, asOf: string, itemId?: string): RoadmapActualProposal[] {
  const items = itemId === undefined ? document.items : document.items.filter((item) => item.id === itemId);
  return items.flatMap((item) => proposalsFor(document, sources, asOf, item));
}
