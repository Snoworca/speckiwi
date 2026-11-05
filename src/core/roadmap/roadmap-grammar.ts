// @req FR-PARSE-046 FR-PARSE-047
//
// The vocabulary of the roadmap document `docs/roadmap.md`: its item heading, its metadata rows, its
// sections and its Change History columns, stated once. The parser, the writers and the rules-document
// test all read these constants, so the grammar the tool writes, the grammar it checks and the grammar
// it documents cannot drift apart.

/** The one roadmap document of a workspace, kept outside docs/spec so no requirement reader sees it. */
export const ROADMAP_PATH = "docs/roadmap.md";

/** `### RM-<n> — <title>`; group 1 is the ID, group 2 its number, group 3 the title. */
export const ROADMAP_ITEM_HEADING = /^### (RM-([1-9]\d*)) — (\S.*)$/;

/** Every metadata row an item carries, in the order the writers render them. */
export const ROADMAP_FIELDS = [
  "Kind",
  "Milestone",
  "Targets",
  "Requirements",
  "PRD",
  "Depends On",
  "Owner",
  "GitHub Issue",
  "Planned Start",
  "Planned End",
  "Actual Start",
  "Actual End",
  "Lifecycle"
] as const;

export type RoadmapFieldName = (typeof ROADMAP_FIELDS)[number];

export const ROADMAP_KINDS = ["milestone", "feature"] as const;
export type RoadmapKind = (typeof ROADMAP_KINDS)[number];

/** The only states written by hand; every other status is computed from the SRS. */
export const ROADMAP_LIFECYCLES = ["open", "paused", "cancelled"] as const;
export type RoadmapLifecycle = (typeof ROADMAP_LIFECYCLES)[number];

export const ROADMAP_SECTIONS = ["Purpose", "Description", "Features", "Change History"] as const;
export type RoadmapSectionName = (typeof ROADMAP_SECTIONS)[number];

export const ROADMAP_HISTORY_COLUMNS = ["Date", "Field", "From", "To", "Reason"] as const;

/** The value written for an unset metadata row and an empty history cell. */
export const ROADMAP_EMPTY = "-";

export const ROADMAP_PLANNED_DATE_FIELDS = ["Planned Start", "Planned End"] as const satisfies readonly RoadmapFieldName[];
export const ROADMAP_ACTUAL_DATE_FIELDS = ["Actual Start", "Actual End"] as const satisfies readonly RoadmapFieldName[];
export const ROADMAP_DATE_FIELDS = [...ROADMAP_PLANNED_DATE_FIELDS, ...ROADMAP_ACTUAL_DATE_FIELDS] as const;
export type RoadmapDateField = (typeof ROADMAP_DATE_FIELDS)[number];

/** Fields whose change needs a reason, because each one moves the plan (FR-NODE-256 AC-4). */
export const ROADMAP_REASON_REQUIRED_FIELDS = [
  "Planned Start",
  "Planned End",
  "Actual Start",
  "Actual End",
  "Lifecycle",
  "Milestone",
  "Targets"
] as const satisfies readonly RoadmapFieldName[];

/** The fields the roadmap check compares with the `To` of their last history row (FR-PARSE-046 AC-6). */
export const ROADMAP_HISTORY_CHECKED_FIELDS = [...ROADMAP_DATE_FIELDS, "Lifecycle"] as const satisfies readonly RoadmapFieldName[];

/** The `Field` cell of the row the add operation writes for a new item. */
export const ROADMAP_CREATED_FIELD = "Created";

/**
 * Every code the roadmap check can emit. The rules document's roadmap appendix lists the same set
 * (FR-PARSE-047 AC-2), and its test derives the list from here.
 */
export const ROADMAP_DIAGNOSTIC_CODES = [
  "ROADMAP-E001",
  "ROADMAP-E002",
  "ROADMAP-E003",
  "ROADMAP-E004",
  "ROADMAP-E005",
  "ROADMAP-E006",
  "ROADMAP-E007",
  "ROADMAP-E008",
  "ROADMAP-W009",
  "ROADMAP-W010",
  "ROADMAP-W011",
  "ROADMAP-W012",
  "ROADMAP-W013",
  "ROADMAP-W015",
  "ROADMAP-E016",
  "ROADMAP-W016",
  "ROADMAP-E017"
] as const;

export type RoadmapDiagnosticCode = (typeof ROADMAP_DIAGNOSTIC_CODES)[number];
