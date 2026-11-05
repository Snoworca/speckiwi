import { ROADMAP_FIELDS, type RoadmapFieldName } from "../../../src/core/roadmap/roadmap-grammar.js";
import type { RoadmapRequirement, RoadmapSources } from "../../../src/core/roadmap/roadmap-model.js";

// Shared builders for the roadmap tests: a roadmap document written the way the tool writes one, and
// the SRS facts it is read against.

export interface ItemSpec {
  n: number;
  title?: string;
  fields?: Partial<Record<RoadmapFieldName, string>>;
  /** Raw lines inserted after the metadata table, before the sections. */
  sections?: string[];
  /** Change History rows as `[date, field, from, to, reason]`. */
  history?: string[][];
  /** Replace the whole heading line. */
  heading?: string;
}

export function itemLines(spec: ItemSpec): string[] {
  const fields: Record<string, string> = { Kind: "feature", Lifecycle: "open", ...spec.fields };
  const rows = ROADMAP_FIELDS.map((field) => `| ${field} | ${fields[field] ?? "-"} |`);
  const history = spec.history ?? [["2026-11-01", "Created", "-", "-", "fixture"]];
  return [
    spec.heading ?? `### RM-${spec.n} — ${spec.title ?? `Item ${spec.n}`}`,
    "",
    "| Field | Value |",
    "|---|---|",
    ...rows,
    "",
    "#### Purpose",
    "",
    `Purpose of item ${spec.n}.`,
    "",
    ...(spec.sections ?? []),
    "#### Change History",
    "",
    "| Date | Field | From | To | Reason |",
    "|---|---|---|---|---|",
    ...history.map((row) => `| ${row.join(" | ")} |`),
    ""
  ];
}

export const ROADMAP_HEAD = [
  "# Roadmap",
  "",
  "> A plan record.",
  "",
  "| Field | Value |",
  "|---|---|",
  "| Document Type | roadmap |",
  "| Schema | 1 |",
  "",
  "## 1. Items",
  ""
];

export function roadmapText(...items: ItemSpec[]): string {
  return [...ROADMAP_HEAD, ...items.flatMap(itemLines)].join("\n");
}

export function requirement(id: string, target: string, status: RoadmapRequirement["status"], checks: boolean[] = []): RoadmapRequirement {
  return {
    id,
    target,
    status,
    acceptanceCriteria: checks.map((checked, index) => ({ id: `AC-${index + 1}`, text: `criterion ${index + 1}`, checked, line: index + 1 })),
    changeNotes: []
  };
}

export function sources(overrides: Partial<RoadmapSources> = {}): RoadmapSources {
  return {
    targets: [
      { target: "1.0.0", status: "active" },
      { target: "1.1.0", status: "planned" }
    ],
    targetGoals: { "1.0.0": "Ship the first release." },
    requirements: [requirement("FR-A-001", "1.0.0", "planned"), requirement("FR-A-002", "1.1.0", "discarded")],
    completedWork: [],
    prdFiles: ["docs/prd/2026-11-01.alpha.prd.md"],
    ...overrides
  };
}

/** The line (1-based) of the first line of `text` that equals or starts with `prefix`. */
export function lineOf(text: string, prefix: string, after = 0): number {
  const lines = text.split("\n");
  const index = lines.findIndex((line, at) => at >= after && line.startsWith(prefix));
  if (index < 0) throw new Error(`line not found: ${prefix}`);
  return index + 1;
}
