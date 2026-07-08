import { describe, expect, it } from "vitest";
import { parseMarkdownTable } from "../../../src/core/parser/table.js";
import { parseStepState } from "../../../src/core/parser/index-parser.js";

// FND-002 regression: parseMarkdownTable's leading-skip default must be blank-only so that
// pointing at a heading whose own section has no table does NOT scan forward and wrongly
// absorb a later section's table. The permissive (skip any non-table leading line) behavior
// is opt-in via { skipNonTableLeading: true } and is used only by parseStepState.
describe("parseMarkdownTable leading-skip behavior (FND-002)", () => {
  // A document where the FIRST heading section has NO table, and a LATER section does.
  const lines = [
    "## 1. Empty Section",
    "",
    "No table here, just prose.",
    "",
    "## 2. Section With Table",
    "",
    "| Field | Value |",
    "|---|---|",
    "| a | 1 |",
    ""
  ];

  it("default skip is blank-only: an empty section after a heading does not absorb a later table", () => {
    // Caller points just after the first heading (index 1). Under blank-only skip the scan stops
    // at the prose line (a non-table, non-blank line) and returns no table.
    const table = parseMarkdownTable(lines, 1);
    expect(table).toBeUndefined();
  });

  it("default skip still finds a table when only blank lines precede it", () => {
    // Pointing after the second heading (index 5): blank line then the table header.
    const table = parseMarkdownTable(lines, 5);
    expect(table?.headers).toEqual(["Field", "Value"]);
    expect(table?.rows).toEqual([{ Field: "a", Value: "1" }]);
  });

  it("permissive skip (skipNonTableLeading) walks past non-table leading lines to the table", () => {
    const table = parseMarkdownTable(lines, 1, { skipNonTableLeading: true });
    expect(table?.headers).toEqual(["Field", "Value"]);
    expect(table?.rows).toEqual([{ Field: "a", Value: "1" }]);
  });

  it("parseStepState still parses a heading-prefixed state.md table (permissive opt-in)", () => {
    const stateLines = [
      "# Step State",
      "",
      "| Step | Status | DependsOn | TouchesScope | TouchesReq | Created | Updated |",
      "| --- | --- | --- | --- | --- | --- | --- |",
      "| alpha | active | - | PARSE | FR-PARSE-023 | 2026-06-01 | 2026-06-02 |"
    ];
    const entries = parseStepState(stateLines);
    expect(entries).toHaveLength(1);
    expect(entries[0]?.step).toBe("alpha");
    expect(entries[0]?.status).toBe("active");
  });
});
