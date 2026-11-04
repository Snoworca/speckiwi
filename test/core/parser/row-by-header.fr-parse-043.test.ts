import { describe, expect, it } from "vitest";
import { renderRowByHeader, splitTableRow } from "../../../src/core/parser/table.js";

describe("FR-PARSE-043 header-addressed table row primitive", () => {
  // @req FR-PARSE-043 AC-1
  it("places each value under its named column whatever the header order", () => {
    const values = { Scope: "Reporting", Prefix: "RPT", Document: "[r.md](./r.md)", Description: "Reports" };

    const documentsOrder = renderRowByHeader(["Scope", "Document", "Prefix", "Description"], values);
    const scopeMapOrder = renderRowByHeader(["Scope", "Prefix", "Document", "Description"], values);

    expect(documentsOrder).toMatchObject({ ok: true, value: "| Reporting | [r.md](./r.md) | RPT | Reports |" });
    expect(scopeMapOrder).toMatchObject({ ok: true, value: "| Reporting | RPT | [r.md](./r.md) | Reports |" });
  });

  // @req FR-PARSE-043 AC-1
  it("leaves a header column with no supplied value empty so the row keeps the header's cell count", () => {
    const result = renderRowByHeader(["A", "B", "C"], { C: "z", A: "x" });
    expect(result).toMatchObject({ ok: true, value: "| x |  | z |" });
    if (result.ok) expect(splitTableRow(result.value)).toEqual(["x", "", "z"]);
  });

  // @req FR-PARSE-043 AC-2
  it("rejects a value whose column name the header does not list, naming the column", () => {
    const result = renderRowByHeader(["Scope", "Prefix", "Primary Document", "Notes"], { Scope: "S", Document: "d.md" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("UNKNOWN_COLUMN");
      expect(result.error.message).toContain("Document");
    }
  });

  // @req FR-PARSE-043 AC-2
  it("rejects a value that would split into extra cells or rows", () => {
    for (const unsafe of ["a | b", "a\nb", "a\r\nb"]) {
      const result = renderRowByHeader(["A"], { A: unsafe });
      expect(result.ok, JSON.stringify(unsafe)).toBe(false);
      if (!result.ok) expect(result.error.code).toBe("UNSAFE_CELL");
    }
  });
});
