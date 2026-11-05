// @req FR-PARSE-045 — what makes a Trace Link row a dependency the tools can read: Type `Requirement`
// and Relation `depends_on`, letter case and a space or hyphen for the underscore not mattering. The
// one rule both the readiness reader and the validator's dependency warnings apply.

interface TraceRow {
  readonly type: string;
  readonly relation: string;
}

/** Whether the row's Relation is `depends_on`. */
export function isDependsOnRelation(trace: TraceRow): boolean {
  return trace.relation.trim().toLowerCase().replace(/[\s-]+/gu, "_") === "depends_on";
}

/** Whether the row is a `Requirement` / `depends_on` row, the one form a dependency is read in. */
export function isRequirementDependency(trace: TraceRow): boolean {
  return isDependsOnRelation(trace) && trace.type.trim().toLowerCase() === "requirement";
}

/**
 * The requirement IDs a block depends on: the trimmed References of its `Requirement` / `depends_on`
 * rows, distinct, in row order, blanks dropped; with `within`, only the IDs inside that set. The one
 * dependency reader readiness, the work-graph check, the wave proposal and the validator call.
 * @req FR-NODE-246 AC-6, FR-NODE-247 AC-2
 */
export function requirementDependencyIds(record: { readonly traceLinks: readonly (TraceRow & { readonly reference: string })[] }, within?: ReadonlySet<string>): string[] {
  const ids = record.traceLinks.filter(isRequirementDependency).map((trace) => trace.reference.trim());
  return [...new Set(ids)].filter((id) => id !== "" && (within === undefined || within.has(id)));
}
