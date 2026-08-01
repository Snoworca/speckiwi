import type {
  ReadinessDiagnostic,
  RequirementSnapshot,
  SnapshotPayload,
  SpecRequirementRecord,
  SpecTargetSummary
} from "../../../../src/core/orchestrator/readiness.js";

export const TARGET = "2.6.0-phase1-kiwi-orchestrator";
export const OTHER_TARGET = "2.6.0-phase2-parallel-lanes";

export interface RecordInput {
  readonly id: string;
  readonly target?: string;
  readonly status?: SpecRequirementRecord["status"];
  readonly stability?: SpecRequirementRecord["stability"];
  readonly acceptanceCriteria?: SpecRequirementRecord["acceptanceCriteria"];
  readonly verificationEvidence?: SpecRequirementRecord["verificationEvidence"];
  readonly traceLinks?: SpecRequirementRecord["traceLinks"];
  readonly filePath?: string;
  readonly headingLine?: number;
  readonly blockEndLine?: number;
}

export function record(input: RecordInput): SpecRequirementRecord {
  return {
    id: input.id,
    target: input.target ?? TARGET,
    status: input.status ?? "verified",
    stability: input.stability ?? "stable",
    acceptanceCriteria: input.acceptanceCriteria ?? [{ id: "AC-1", checked: true }],
    verificationEvidence: input.verificationEvidence ?? [
      { id: "EV-1", type: "test", covers: "all", reference: "test/core/orchestrator/readiness.test.ts" }
    ],
    traceLinks: input.traceLinks ?? [],
    ...(input.filePath === undefined ? {} : { filePath: input.filePath }),
    ...(input.headingLine === undefined ? {} : { headingLine: input.headingLine }),
    ...(input.blockEndLine === undefined ? {} : { blockEndLine: input.blockEndLine })
  };
}

export function dependsOn(...ids: readonly string[]): SpecRequirementRecord["traceLinks"] {
  return ids.map((reference) => ({ type: "Requirement", reference, relation: "depends_on" }));
}

function counts(values: readonly string[]): Record<string, number> {
  const result: Record<string, number> = {};
  for (const value of values) result[value] = (result[value] ?? 0) + 1;
  return result;
}

/**
 * The summary a consistent SpecKiwi workspace would report for these records. Cases that need a
 * contradiction perturb the value this returns, which is what makes the contradiction check live
 * rather than a mirror of the implementation.
 */
export function summaryFor(
  target: string,
  records: readonly SpecRequirementRecord[],
  diagnostics: readonly ReadinessDiagnostic[] = []
): SpecTargetSummary {
  const scoped = records.filter((entry) => entry.target === target);
  return {
    target,
    total: scoped.length,
    countsByStatus: counts(scoped.map((entry) => entry.status)),
    countsByStability: counts(scoped.map((entry) => entry.stability)),
    blocked: scoped.filter((entry) => entry.status === "blocked").map((entry) => entry.id),
    implementedNotVerified: scoped.filter((entry) => entry.status === "implemented").map((entry) => entry.id),
    missingEvidence: scoped
      .filter((entry) => (entry.status === "implemented" || entry.status === "verified") && entry.verificationEvidence.length === 0)
      .map((entry) => entry.id),
    draftRequirements: scoped.filter((entry) => entry.stability === "draft").map((entry) => entry.id),
    deprecatedRequirements: scoped.filter((entry) => entry.stability === "deprecated").map((entry) => entry.id),
    stabilityBlockers: scoped
      .filter((entry) => entry.status !== "discarded" && (entry.stability === "draft" || entry.stability === "deprecated"))
      .map((entry) => entry.id),
    diagnosticsSummary: {
      errors: diagnostics.filter((entry) => entry.severity === "error").length,
      warnings: diagnostics.filter((entry) => entry.severity === "warning").length
    }
  };
}

export interface SnapshotContent {
  readonly target: string;
  readonly records: readonly SpecRequirementRecord[];
  readonly diagnostics: readonly ReadinessDiagnostic[];
  readonly summary: SpecTargetSummary;
}

export function content(
  records: readonly SpecRequirementRecord[],
  diagnostics: readonly ReadinessDiagnostic[] = [],
  summaryOverride?: Partial<SpecTargetSummary>
): SnapshotContent {
  const summary = summaryFor(TARGET, records, diagnostics);
  return {
    target: TARGET,
    records,
    diagnostics,
    summary: summaryOverride ? { ...summary, ...summaryOverride } : summary
  };
}

/** The `speckiwi list --json` envelope plus the `speckiwi summary --target <t> --json` envelope. */
export function cliPayload(input: SnapshotContent): SnapshotPayload {
  return {
    transport: "speckiwi-list-json",
    target: input.target,
    list: {
      records: input.records as unknown as Record<string, unknown>[],
      projection: "fields",
      page: {
        total: input.records.length,
        offset: 0,
        limit: input.records.length,
        returned: input.records.length,
        nextOffset: null,
        truncated: false
      },
      diagnostics: input.diagnostics as unknown as Record<string, unknown>[]
    },
    summary: input.summary as unknown as Record<string, unknown>
  };
}

/** The MCP `list_requirements` / `summarize_target` / `validate_spec` payloads, unwrapped. */
export function mcpPayload(input: SnapshotContent): SnapshotPayload {
  return {
    transport: "mcp-list-requirements",
    target: input.target,
    records: input.records as unknown as Record<string, unknown>[],
    diagnostics: input.diagnostics as unknown as Record<string, unknown>[],
    summary: input.summary as unknown as Record<string, unknown>
  };
}

export function snapshotOf(input: SnapshotContent): RequirementSnapshot {
  return {
    target: input.target,
    records: input.records,
    diagnostics: input.diagnostics,
    summary: input.summary
  };
}
