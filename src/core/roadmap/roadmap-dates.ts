import type { RoadmapDateRange } from "./roadmap-model.js";

// @req FR-PARSE-046 AC-3 FR-NODE-255 AC-5
//
// Roadmap dates as day ranges. A planned date may be coarse (a month or a quarter); comparing two
// coarse dates is done on the ranges they cover, and one date is "earlier" than another only when its
// whole range ends before the other's begins, so a coarse plan is never reported for what it might mean.

const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;
const MONTH = /^(\d{4})-(\d{2})$/;
const QUARTER = /^(\d{4})-Q([1-4])$/;
const MS_PER_DAY = 86_400_000;

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

function lastDayOfMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** Whether `raw` is a real calendar day written as `YYYY-MM-DD`. */
export function isRoadmapDay(raw: string): boolean {
  const match = DAY.exec(raw);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  return month >= 1 && month <= 12 && day >= 1 && day <= lastDayOfMonth(year, month);
}

export type RoadmapDateParse = { readonly kind: "empty" } | { readonly kind: "invalid" } | { readonly kind: "range"; readonly range: RoadmapDateRange };

/**
 * Reads one date cell. `coarse` admits `YYYY-MM` and `YYYY-Qn` (the planned dates); without it only a
 * day is a date (the actual dates). `-` is the empty value.
 */
export function parseRoadmapDate(raw: string, coarse: boolean): RoadmapDateParse {
  if (raw === "-") return { kind: "empty" };
  if (isRoadmapDay(raw)) return { kind: "range", range: { raw, from: raw, to: raw, precision: "day" } };
  if (!coarse) return { kind: "invalid" };
  const month = MONTH.exec(raw);
  if (month) {
    const year = Number(month[1]);
    const value = Number(month[2]);
    if (value < 1 || value > 12) return { kind: "invalid" };
    return { kind: "range", range: { raw, from: `${raw}-01`, to: `${raw}-${pad(lastDayOfMonth(year, value))}`, precision: "month" } };
  }
  const quarter = QUARTER.exec(raw);
  if (quarter) {
    const year = Number(quarter[1]);
    const first = (Number(quarter[2]) - 1) * 3 + 1;
    const last = first + 2;
    return {
      kind: "range",
      range: { raw, from: `${year}-${pad(first)}-01`, to: `${year}-${pad(last)}-${pad(lastDayOfMonth(year, last))}`, precision: "quarter" }
    };
  }
  return { kind: "invalid" };
}

/**
 * Whether `raw` may be written into a date cell: `-` or a date of the cell's kind. The CLI options and
 * the MCP input schemas of the roadmap writers both ask this, so neither surface admits what the other
 * refuses. @req FR-PARSE-046 AC-3 IR-MCP-009 AC-1
 */
export function isRoadmapDateCell(raw: string, coarse: boolean): boolean {
  return parseRoadmapDate(raw, coarse).kind !== "invalid";
}

/** The range of a date cell, or null when it is empty or malformed. */
export function roadmapDateRange(raw: string, coarse: boolean): RoadmapDateRange | null {
  const parsed = parseRoadmapDate(raw, coarse);
  return parsed.kind === "range" ? parsed.range : null;
}

/** True when the whole of `a` lies before the whole of `b`. */
export function endsBefore(a: RoadmapDateRange, b: RoadmapDateRange): boolean {
  return a.to < b.from;
}

/** Signed whole days from day `from` to day `to` (both `YYYY-MM-DD`). */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / MS_PER_DAY);
}
