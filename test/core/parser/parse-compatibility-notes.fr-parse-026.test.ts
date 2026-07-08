import { describe, expect, it } from "vitest";
// FR-PARSE-026: parseCompatibilityNotes strict tokenizer for the checked_compatible
// Trace Links "Notes" cell. Contract per SRS-MD-Rules-v3.0.0 §23.5:
//   - items separated by "; " (semicolon-space)
//   - each item is "key: value"
//   - keys: lowercase + hyphen only; recognized keys: fpv, self, peer, checked-at
//   - value charset restricted (alphanumeric, hyphen, colon, dot); ellipsis / arbitrary
//     characters are rejected. table-cell.ts only rejects pipe/CR/LF, which is insufficient,
//     so this dedicated tokenizer enforces the charset.
//
// Expected (red phase) signature under test — the implementation (T-PH002-18) conforms:
//   parseCompatibilityNotes(notes: string): {
//     ok: boolean;
//     fields?: { fpv?: string; self?: string; peer?: string; "checked-at"?: string };
//     error?: string;
//   }
import { parseCompatibilityNotes } from "../../../src/core/parser/table.js";

describe("parseCompatibilityNotes (FR-PARSE-026)", () => {
  it("FR-PARSE-026 AC-1: splits items on semicolon-space and parses each into a key/value pair", () => {
    const result = parseCompatibilityNotes("fpv: fpv1; self: abc123; peer: def456");
    expect(result.ok).toBe(true);
    expect(result.fields).toMatchObject({
      fpv: "fpv1",
      self: "abc123",
      peer: "def456"
    });
  });

  it("FR-PARSE-026 AC-2: rejects keys or values outside the allowed charset", () => {
    // Uppercase key violates the lowercase-and-hyphen key rule.
    const badKey = parseCompatibilityNotes("FPV: fpv1");
    expect(badKey.ok).toBe(false);

    // A value containing a space (outside the restricted value charset) is rejected.
    const badValue = parseCompatibilityNotes("self: abc 123");
    expect(badValue.ok).toBe(false);
  });

  it("FR-PARSE-026 AC-3: rejects a value containing an ellipsis or other out-of-charset character", () => {
    const ellipsis = parseCompatibilityNotes("self: abc…");
    expect(ellipsis.ok).toBe(false);

    const tripleDotEllipsisToken = parseCompatibilityNotes("self: ab/c");
    expect(tripleDotEllipsisToken.ok).toBe(false);
  });

  it("FR-PARSE-026 AC-4: recognizes fpv, self, peer, and checked-at tokens as structured fields", () => {
    const result = parseCompatibilityNotes(
      "fpv: fpv1; self: 1a2b3c; peer: 4d5e6f; checked-at: 2026-06-17"
    );
    expect(result.ok).toBe(true);
    expect(result.fields?.fpv).toBe("fpv1");
    expect(result.fields?.self).toBe("1a2b3c");
    expect(result.fields?.peer).toBe("4d5e6f");
    expect(result.fields?.["checked-at"]).toBe("2026-06-17");
  });

  // FND-006: a repeated recognized key is ambiguous (which value wins?) and must be rejected rather
  // than silently letting the later item overwrite the earlier one.
  it("FND-006: rejects a duplicate recognized key", () => {
    const result = parseCompatibilityNotes("self: a; self: b");
    expect(result.ok).toBe(false);
  });

  // FND-006: the Notes cell is optional, so an empty input is not malformed — it yields ok:true with
  // no parsed fields.
  it("FND-006: treats an empty input as a valid empty result", () => {
    const result = parseCompatibilityNotes("");
    expect(result.ok).toBe(true);
    expect(result.fields).toEqual({});
  });
});
