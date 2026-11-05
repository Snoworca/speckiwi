import { diagnostic } from "../diagnostic.js";
import { REQUIREMENT_STATUSES, type Diagnostic } from "../types.js";
import { daysBetween, roadmapDateRange } from "./roadmap-dates.js";
import { ROADMAP_DATE_FIELDS, ROADMAP_EMPTY, ROADMAP_PATH, type RoadmapDateField } from "./roadmap-grammar.js";
import type { RoadmapDateRange, RoadmapDocument, RoadmapHistoryRow, RoadmapItem, RoadmapRequirement, RoadmapSources } from "./roadmap-model.js";
import { parseRoadmap, roadmapFieldValue, roadmapList, sortRoadmapDiagnostics } from "./parse-roadmap.js";

// @req FR-NODE-255
//
// Each item's status, acceptance-criterion progress and schedule health, computed — never read from
// the roadmap. The status rests on the SRS and the Target Map alone, so the roadmap check that uses it
// reads no clock; only the schedule health needs a date, and it is handed in as `asOf`, so the same
// document, SRS and as-of date always give the same bytes.

/** Every computed status, in the order of the status table. */
export const ROADMAP_STATUSES = ["cancelled", "paused", "idea", "released", "done", "in-progress", "planned"] as const;
export type RoadmapStatus = (typeof ROADMAP_STATUSES)[number];

export type RoadmapStatusRule =
  | "lifecycle-cancelled"
  | "lifecycle-paused"
  | "no-scope"
  | "targets-released"
  | "requirements-verified"
  | "targets-completed"
  | "requirement-started"
  | "target-active"
  | "actual-start-set"
  | "not-started";

export type RoadmapHealth = "unscheduled" | "on-track" | "late" | "done" | "done-late";

/** The statuses an item is finished in; schedule health and the sync judge an item by this set. */
export const ROADMAP_CLOSED_STATUSES: readonly RoadmapStatus[] = ["done", "released", "cancelled"];

export interface RoadmapItemStatus {
  readonly status: RoadmapStatus;
  /** The rule of the status table that decided the status. */
  readonly rule: RoadmapStatusRule;
  /** The requirements or targets that rule rests on. */
  readonly basis: { readonly requirements: string[]; readonly targets: string[] };
  readonly blocked: boolean;
  /** R and T: the requirement set and the target set of the item. */
  readonly scope: { readonly requirements: string[]; readonly targets: string[] };
}

export interface RoadmapItemView {
  readonly id: string;
  readonly title: string;
  readonly line: number;
  readonly kind: string;
  readonly lifecycle: string;
  readonly milestone: string | null;
  readonly dependsOn: string[];
  /** The item's own `Targets` entries. */
  readonly targets: string[];
  /** The item's own `Requirements` entries. */
  readonly requirements: string[];
  /** @req FR-NODE-269 AC-1 — the `PRD` entries, so an update that replaces the list can extend it. */
  readonly prd: string[];
  /** The `Owner` cell, null when it is `-`. */
  readonly owner: string | null;
  /** The `GitHub Issue` entries. */
  readonly githubIssue: string[];
  readonly status: RoadmapStatus;
  readonly statusRule: RoadmapStatusRule;
  readonly statusBasis: RoadmapItemStatus["basis"];
  readonly blocked: boolean;
  readonly scope: RoadmapItemStatus["scope"];
  readonly progress: {
    readonly acceptanceCriteria: { readonly total: number; readonly checked: number };
    readonly percent: number | null;
    readonly requirements: { readonly total: number; readonly byStatus: Record<string, number> };
  };
  readonly schedule: {
    readonly asOf: string;
    readonly planned: { readonly start: RoadmapDateRange | null; readonly end: RoadmapDateRange | null };
    readonly actual: { readonly start: RoadmapDateRange | null; readonly end: RoadmapDateRange | null };
    readonly baseline: Readonly<Record<RoadmapDateField, string>>;
    readonly replanCount: number;
    readonly health: RoadmapHealth;
    readonly slipDays: number | null;
  };
  readonly purpose: string;
  readonly purposeSource: "item" | "target";
  readonly history: readonly RoadmapHistoryRow[];
}

const STARTED = new Set(["in_progress", "implemented", "verified", "blocked"]);

function sorted(values: Iterable<string>): string[] {
  return [...new Set(values)].sort();
}

/** The item's own R and T, before any child is added. */
function ownScope(item: RoadmapItem, live: readonly RoadmapRequirement[]): { requirements: string[]; targets: string[] } {
  const targets = roadmapList(roadmapFieldValue(item, "Targets"));
  const listed = new Set(roadmapList(roadmapFieldValue(item, "Requirements")));
  const requirements = live.filter((record) => targets.includes(record.target) || listed.has(record.id)).map((record) => record.id);
  return { requirements, targets };
}

// @req FR-NODE-255 AC-1
function scopeOf(document: RoadmapDocument, item: RoadmapItem, live: readonly RoadmapRequirement[]): RoadmapItemStatus["scope"] {
  const own = ownScope(item, live);
  const requirements = [...own.requirements];
  const targets = [...own.targets];
  if (roadmapFieldValue(item, "Kind") === "milestone") {
    const children = document.items.filter(
      (child) => child !== item && roadmapFieldValue(child, "Milestone") === item.id && roadmapFieldValue(child, "Lifecycle") !== "cancelled"
    );
    for (const child of children) {
      const childScope = ownScope(child, live);
      requirements.push(...childScope.requirements);
      targets.push(...childScope.targets);
    }
  }
  return { requirements: sorted(requirements), targets: sorted(targets) };
}

// @req FR-NODE-255 AC-1 AC-2 AC-3
export function roadmapItemStatus(document: RoadmapDocument, sources: RoadmapSources, item: RoadmapItem): RoadmapItemStatus {
  const live = sources.requirements.filter((record) => record.status !== "discarded");
  const scope = scopeOf(document, item, live);
  const records = scope.requirements.map((id) => live.find((record) => record.id === id)!);
  const targetStatus = (target: string) => sources.targets.find((entry) => entry.target.trim() === target)?.status;
  const blocked = records.some((record) => record.status === "blocked");
  const decide = (status: RoadmapStatus, rule: RoadmapStatusRule, requirements: string[] = [], targets: string[] = []): RoadmapItemStatus => ({
    status,
    rule,
    basis: { requirements, targets },
    blocked,
    scope
  });
  const lifecycle = roadmapFieldValue(item, "Lifecycle");
  if (lifecycle === "cancelled") return decide("cancelled", "lifecycle-cancelled");
  if (lifecycle === "paused") return decide("paused", "lifecycle-paused");
  const R = scope.requirements;
  const T = scope.targets;
  if (R.length === 0 && T.length === 0) return decide("idea", "no-scope");
  if (T.length > 0 && T.every((target) => targetStatus(target) === "released")) return decide("released", "targets-released", [], T);
  if (R.length > 0 && records.every((record) => record.status === "verified")) return decide("done", "requirements-verified", R);
  if (T.length > 0 && T.every((target) => ["completed", "released"].includes(targetStatus(target) ?? ""))) return decide("done", "targets-completed", [], T);
  const started = records.filter((record) => STARTED.has(record.status)).map((record) => record.id);
  if (started.length > 0) return decide("in-progress", "requirement-started", started);
  const active = T.filter((target) => targetStatus(target) === "active");
  if (active.length > 0) return decide("in-progress", "target-active", [], active);
  if (roadmapFieldValue(item, "Actual Start") !== ROADMAP_EMPTY) return decide("in-progress", "actual-start-set");
  return decide("planned", "not-started");
}

// @req FR-NODE-255 AC-4
function progressOf(sources: RoadmapSources, scope: RoadmapItemStatus["scope"]): RoadmapItemView["progress"] {
  const records = sources.requirements.filter((record) => scope.requirements.includes(record.id));
  // `acceptanceCriteria` holds the live criteria only; an expired one sits in a field of its own.
  const criteria = records.flatMap((record) => record.acceptanceCriteria);
  const checked = criteria.filter((criterion) => criterion.checked).length;
  const byStatus = Object.fromEntries(REQUIREMENT_STATUSES.filter((status) => status !== "discarded").map((status) => [status, 0])) as Record<string, number>;
  for (const record of records) byStatus[record.status] = (byStatus[record.status] ?? 0) + 1;
  return {
    acceptanceCriteria: { total: criteria.length, checked },
    percent: criteria.length === 0 ? null : Math.round((100 * checked) / criteria.length),
    requirements: { total: records.length, byStatus }
  };
}

// @req FR-NODE-255 AC-5
function healthOf(status: RoadmapStatus, plannedEnd: RoadmapDateRange | null, actualEnd: RoadmapDateRange | null, asOf: string): { health: RoadmapHealth; slipDays: number | null } {
  if (!plannedEnd) return { health: "unscheduled", slipDays: null };
  if (!ROADMAP_CLOSED_STATUSES.includes(status)) {
    return { health: asOf <= plannedEnd.to ? "on-track" : "late", slipDays: daysBetween(plannedEnd.to, asOf) };
  }
  if (!actualEnd) return { health: "done", slipDays: null };
  return { health: actualEnd.to <= plannedEnd.to ? "done" : "done-late", slipDays: daysBetween(plannedEnd.to, actualEnd.to) };
}

// @req FR-NODE-255 AC-6
function baselineOf(item: RoadmapItem): Record<RoadmapDateField, string> {
  const baseline = {} as Record<RoadmapDateField, string>;
  for (const field of ROADMAP_DATE_FIELDS) {
    baseline[field] = item.history.find((row) => row.field === field)?.from ?? roadmapFieldValue(item, field);
  }
  return baseline;
}

// @req FR-NODE-255 AC-8
function purposeOf(item: RoadmapItem, sources: RoadmapSources): { purpose: string; purposeSource: "item" | "target" } {
  const purpose = item.sections.Purpose?.text || ROADMAP_EMPTY;
  const targets = roadmapList(roadmapFieldValue(item, "Targets"));
  const goal = targets.length === 1 ? sources.targetGoals[targets[0]!] : undefined;
  return purpose === ROADMAP_EMPTY && goal ? { purpose: goal, purposeSource: "target" } : { purpose, purposeSource: "item" };
}

// @req FR-NODE-255 AC-1 AC-2 AC-3 AC-4 AC-5 AC-6 AC-7 AC-8 FR-NODE-269 AC-1
export function computeRoadmapItems(document: RoadmapDocument, sources: RoadmapSources, asOf: string): RoadmapItemView[] {
  return document.items.map((item) => {
    const decided = roadmapItemStatus(document, sources, item);
    const planned = { start: roadmapDateRange(roadmapFieldValue(item, "Planned Start"), true), end: roadmapDateRange(roadmapFieldValue(item, "Planned End"), true) };
    const actual = { start: roadmapDateRange(roadmapFieldValue(item, "Actual Start"), false), end: roadmapDateRange(roadmapFieldValue(item, "Actual End"), false) };
    const milestone = roadmapFieldValue(item, "Milestone");
    const owner = roadmapFieldValue(item, "Owner");
    return {
      id: item.id,
      title: item.title,
      line: item.line,
      kind: roadmapFieldValue(item, "Kind"),
      lifecycle: roadmapFieldValue(item, "Lifecycle"),
      milestone: milestone === ROADMAP_EMPTY ? null : milestone,
      dependsOn: roadmapList(roadmapFieldValue(item, "Depends On")),
      targets: roadmapList(roadmapFieldValue(item, "Targets")),
      requirements: roadmapList(roadmapFieldValue(item, "Requirements")),
      prd: roadmapList(roadmapFieldValue(item, "PRD")),
      owner: owner === ROADMAP_EMPTY ? null : owner,
      githubIssue: roadmapList(roadmapFieldValue(item, "GitHub Issue")),
      status: decided.status,
      statusRule: decided.rule,
      statusBasis: decided.basis,
      blocked: decided.blocked,
      scope: decided.scope,
      progress: progressOf(sources, decided.scope),
      schedule: {
        asOf,
        planned,
        actual,
        baseline: baselineOf(item),
        replanCount: item.history.filter((row) => row.field === "Planned End").length,
        ...healthOf(decided.status, planned.end, actual.end, asOf)
      },
      ...purposeOf(item, sources),
      history: item.history
    };
  });
}

// @req FR-NODE-255 AC-9 FR-PARSE-046 AC-8
/** The roadmap check: the parser's diagnostics plus the one that needs the computed status. No clock. */
export function checkRoadmap(text: string, sources: RoadmapSources): { document: RoadmapDocument; diagnostics: Diagnostic[] } {
  const parsed = parseRoadmap(text, sources);
  const diagnostics = [...parsed.diagnostics];
  for (const item of parsed.document.items) {
    const actualEnd = roadmapFieldValue(item, "Actual End");
    if (actualEnd === ROADMAP_EMPTY) continue;
    const { status } = roadmapItemStatus(parsed.document, sources, item);
    if (!ROADMAP_CLOSED_STATUSES.includes(status)) {
      diagnostics.push(
        diagnostic("ROADMAP-W015", "warning", `${item.id} has Actual End ${actualEnd} while its computed status is ${status}`, {
          filePath: ROADMAP_PATH,
          line: item.fields["Actual End"]?.line ?? item.line
        })
      );
    }
  }
  return { document: parsed.document, diagnostics: sortRoadmapDiagnostics(diagnostics) };
}
