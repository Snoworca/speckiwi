import { describe, expect, it } from "vitest";
import { renderToolDescriptions } from "../../src/mcp/schemas.js";

// @req FR-NODE-093 AC-6 — the settable keys of each table are named before a call fails on them: an
// OG session wrote `Notes`, the header spelling, and learned the lowercase key only from the refusal.

describe("FR-NODE-093 AC-6 — edit_requirement_table_rows names the keys each table takes", () => {
  it("FR-NODE-093 AC-6: the tool description lists the lowercase values keys of all three tables", () => {
    const description = renderToolDescriptions().edit_requirement_table_rows ?? "";
    expect(description).toContain(
      "The `values` keys are lowercase: verification_evidence takes type, reference, covers, notes; trace_links takes type, reference, relation, notes; change_notes takes date, change, reason."
    );
  });
});
