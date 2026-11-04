import { describe, expect, it } from "vitest";
import { parseMetadataRows } from "../../../src/core/parser/table.js";

// IR-CLI-112 AC-3 — the parser names the row each metadata value came from, so a mutation edits the
// row the parser reads through the same rule instead of restating "the last row wins" on its own.
describe("parseMetadataRows fieldLines", () => {
  const lines = [
    "### FR-X-001 — Probe",
    "",
    "| Field | Value |",
    "| --- | --- |",
    "| Status | planned |",
    "|   Target   | v1 |",
    "| Status | in_progress |",
    "",
    "Status"
  ];

  // @req IR-CLI-112 AC-3
  it("gives the 1-based line of the row whose value the parser keeps, per Field", () => {
    const parsed = parseMetadataRows(lines, 1);
    expect(parsed.metadata.Status).toBe("in_progress");
    expect(parsed.fieldLines).toEqual({ Status: 7, Target: 6 });
    expect(lines[(parsed.fieldLines.Status ?? 0) - 1]).toBe("| Status | in_progress |");
  });

  // @req IR-CLI-112 AC-3
  it("names no line when there is no metadata table", () => {
    expect(parseMetadataRows(["### FR-X-001 — Probe", "", "Status"], 1).fieldLines).toEqual({});
  });
});
