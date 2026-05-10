import { TYPE_PREFIX, type EvidenceRow, type RequirementStatus, type RequirementType, type TraceLink } from "../types.js";

export const DEFAULT_REQUIREMENT_STABILITY = "draft";

export interface RenderRequirementInput {
  id: string;
  type: RequirementType;
  target: string;
  title: string;
  statement: string;
  acceptanceCriteria: string[];
  checkedAcceptanceCriteria?: string[];
  status?: RequirementStatus;
  priority?: string;
  tags?: string[];
  risk?: string;
  stability?: string;
  verificationMethod?: string;
  githubIssue?: string;
  relatedDocs?: string[];
  rationale?: string;
  implementationNotes?: string;
  research?: string;
  changeNotes?: string;
  evidence?: Array<Partial<EvidenceRow>>;
  trace?: Array<Partial<TraceLink>>;
}

function linesOrDash(value?: string): string[] {
  if (!value) return ["- -"];
  return value.split(/\r?\n/).map((line) => (line.startsWith("- ") ? line : `- ${line}`));
}

export function renderRequirementBlock(input: RenderRequirementInput): string[] {
  const checked = new Set(input.checkedAcceptanceCriteria ?? []);
  const metadata = [
    ["Type", input.type],
    ["Target", input.target],
    ["Status", input.status ?? "planned"],
    ["Priority", input.priority ?? "medium"],
    ["Tags", (input.tags ?? []).join(", ") || "-"],
    ["Risk", input.risk ?? "medium"],
    ["Stability", input.stability ?? DEFAULT_REQUIREMENT_STABILITY],
    ["Verification Method", input.verificationMethod ?? "test"],
    ["GitHub Issue", input.githubIssue ?? "-"],
    ["Related Docs", (input.relatedDocs ?? []).join(", ") || "-"]
  ];
  const acLines = input.acceptanceCriteria.map((criterion, index) => {
    const acId = `AC-${index + 1}`;
    return `- [${checked.has(acId) || checked.has(criterion) ? "x" : " "}] ${acId}: ${criterion}`;
  });
  const evidenceRows = (input.evidence ?? []).map(
    (row, index) => `| ${row.id ?? `VE-${index + 1}`} | ${row.type ?? "test"} | ${row.reference ?? ""} | ${row.covers ?? "all"} | ${row.notes ?? "-"} |`
  );
  const traceRows = (input.trace ?? []).map(
    (row) => `| ${row.type ?? "Requirement"} | ${row.reference ?? ""} | ${row.relation ?? "related_to"} | ${row.notes ?? "-"} |`
  );
  return [
    `### ${input.id} — ${input.title}`,
    "",
    "| Field | Value |",
    "| --- | --- |",
    ...metadata.map(([field, value]) => `| ${field} | ${value} |`),
    "",
    "#### Requirement",
    "",
    input.statement,
    "",
    "#### Rationale",
    "",
    ...(input.rationale ? [input.rationale] : ["-"]),
    "",
    "#### Acceptance Criteria",
    "",
    ...acLines,
    "",
    "#### Verification Evidence",
    "",
    "| Evidence ID | Type | Reference | Covers | Notes |",
    "| --- | --- | --- | --- | --- |",
    ...evidenceRows,
    "",
    "#### Trace Links",
    "",
    "| Type | Reference | Relation | Notes |",
    "| --- | --- | --- | --- |",
    ...traceRows,
    "",
    "#### Research / Analysis",
    "",
    ...linesOrDash(input.research),
    "",
    "#### Implementation Notes",
    "",
    ...linesOrDash(input.implementationNotes),
    "",
    "#### Change Notes",
    "",
    "| Date | Change | Reason |",
    "| --- | --- | --- |",
    input.changeNotes ? `| ${input.changeNotes} |` : `| ${new Date().toISOString().slice(0, 10)} | Created | add-requirement |`
  ];
}

export function prefixForType(type: RequirementType): string {
  return TYPE_PREFIX[type];
}
