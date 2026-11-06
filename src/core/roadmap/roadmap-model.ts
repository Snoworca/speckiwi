import type { ChangeNoteRow, CompletedWorkEntry, Diagnostic, RequirementRecord, TargetEntry } from "../types.js";
import type { RoadmapFieldName, RoadmapSectionName } from "./roadmap-grammar.js";

// @req FR-PARSE-046 FR-NODE-255
//
// The parsed roadmap and the SRS facts it is read against. Everything the roadmap functions need from
// the workspace arrives in one `RoadmapSources` value, so the parser and the computation are pure
// functions of their arguments and are tested without a disk or a clock.

/** The requirement facts a roadmap item is read against. */
export type RoadmapRequirement = Pick<RequirementRecord, "id" | "target" | "status" | "acceptanceCriteria"> & {
  readonly changeNotes?: readonly ChangeNoteRow[];
};

export interface RoadmapSources {
  /** The Target Map rows. */
  readonly targets: readonly Pick<TargetEntry, "target" | "status">[];
  /** Target goals by target name. */
  readonly targetGoals: Readonly<Record<string, string>>;
  /** Every body requirement, discarded ones included. */
  readonly requirements: readonly RoadmapRequirement[];
  /** The Completed Work Log rows, inline and history. */
  readonly completedWork: readonly Pick<CompletedWorkEntry, "date" | "requirementIds" | "summary">[];
  /** Repository-relative paths of the PRD files, as `docs/prd/<file>.prd.md`. */
  readonly prdFiles: readonly string[];
}

/** A coarse or exact date normalized to the day range it covers; `from` and `to` are `YYYY-MM-DD`. */
export interface RoadmapDateRange {
  readonly raw: string;
  readonly from: string;
  readonly to: string;
  readonly precision: "day" | "month" | "quarter";
}

export interface RoadmapFieldValue {
  readonly value: string;
  /** 1-based line of the metadata row. */
  readonly line: number;
}

export interface RoadmapHistoryRow {
  readonly date: string;
  readonly field: string;
  readonly from: string;
  readonly to: string;
  readonly reason: string;
  readonly line: number;
}

export interface RoadmapSection {
  /** 1-based line of the `#### <name>` heading. */
  readonly line: number;
  /**
   * 1-based line of the section's last non-blank line, code and comment lines included; the heading's
   * line when the section is empty. The section runs to the next `####` heading outside code.
   */
  readonly lastLine: number;
  /** The section's text with surrounding blank lines removed. */
  readonly text: string;
}

export interface RoadmapItem {
  readonly id: string;
  readonly number: number;
  readonly title: string;
  /** 1-based line of the item heading. */
  readonly line: number;
  /**
   * 1-based line of the item's last non-blank line, code and comment lines included. The item runs to
   * the next item heading outside code. @req FR-NODE-268 AC-4
   */
  readonly lastLine: number;
  readonly fields: Readonly<Partial<Record<RoadmapFieldName, RoadmapFieldValue>>>;
  readonly sections: Readonly<Partial<Record<RoadmapSectionName, RoadmapSection>>>;
  readonly history: readonly RoadmapHistoryRow[];
  /** 1-based line of the last line of the Change History table, when the item has one. */
  readonly historyTableLastLine?: number;
}

export interface RoadmapDocument {
  /** Items in document order. */
  readonly items: readonly RoadmapItem[];
  /**
   * 1-based line where a code fence opens and never closes. It hides every line after it, item headings
   * included, so where the items after it end is unknown. @req FR-NODE-268 AC-4
   */
  readonly unclosedFenceLine?: number;
}

export interface RoadmapParse {
  readonly document: RoadmapDocument;
  readonly diagnostics: Diagnostic[];
}

/** No SRS facts: for a reader that needs only the document's structure, not its reference checks. */
export const NO_ROADMAP_SOURCES: RoadmapSources = { targets: [], targetGoals: {}, requirements: [], completedWork: [], prdFiles: [] };
