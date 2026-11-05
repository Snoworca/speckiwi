import { findSupersedingRows } from "./trace-search.js";
import type { RequirementRecord } from "./types.js";

// @req FR-PARSE-049 AC-8, FR-NODE-272 AC-5 — the one decision that a Requirement Trace Link row points at
// a discarded requirement, shared by links check, validate and the writers that refuse such a row, so
// that no row a writer accepts is one a check reports.

/** The relations that record a supersede: a row carrying one is how a discarded requirement is meant to be pointed at. */
const SUPERSEDE_RELATIONS: ReadonlySet<string> = new Set(["supersedes", "superseded_by"]);

/** Rules section 23.5 item 3: validation does not enforce the status of either endpoint of this relation. */
const COMPATIBILITY_RELATION = "checked_compatible";

interface TraceRow {
  readonly type: string;
  readonly reference: string;
  readonly relation: string;
}

/** The requirement whose Trace Links table holds the row. */
interface TraceRowHolder {
  readonly status: string;
}

export interface DiscardedTraceTarget {
  readonly discardedId: string;
  /** The holders of the rows that supersede the target, in the order of its discarded marker's `see` slot. */
  readonly successorIds: readonly string[];
  /** `<id> is discarded; superseded by <ids>`, or `…; no successor is recorded`. */
  readonly summary: string;
}

export interface DiscardedTraceTargetJudge {
  /** The writers' decision: a row to a discarded requirement is refused unless it records the supersede. */
  refuses(row: TraceRow): DiscardedTraceTarget | undefined;
  /**
   * The checks' decision: the writers', except that a `checked_compatible` row and a row held by a
   * discarded requirement are left alone (FR-PARSE-049 AC-5): a discarded holder is a historical record.
   */
  reports(row: TraceRow, holder: TraceRowHolder): DiscardedTraceTarget | undefined;
}

/**
 * Judges rows against one workspace's records. A target counts as discarded only when every record
 * holding its ID is discarded, since during a merge one ID can be held by a live and a discarded block.
 */
export function judgeDiscardedTraceTargets(records: readonly RequirementRecord[]): DiscardedTraceTargetJudge {
  const liveness = new Map<string, boolean>();
  for (const record of records) {
    liveness.set(record.id, (liveness.get(record.id) ?? false) || record.status !== "discarded");
  }
  const refuses = (row: TraceRow): DiscardedTraceTarget | undefined => {
    if (row.type !== "Requirement" || SUPERSEDE_RELATIONS.has(row.relation)) return undefined;
    if (liveness.get(row.reference) !== false) return undefined;
    const successorIds = findSupersedingRows(records, row.reference).map((match) => match.sourceId);
    const successors = successorIds.length > 0 ? `superseded by ${successorIds.join(", ")}` : "no successor is recorded";
    return { discardedId: row.reference, successorIds, summary: `${row.reference} is discarded; ${successors}` };
  };
  return {
    refuses,
    reports: (row, holder) => (row.relation === COMPATIBILITY_RELATION || holder.status === "discarded" ? undefined : refuses(row))
  };
}
