import { describe, expect, it } from "vitest";
import { normalizeSectionKey, resolveSectionHeading } from "../../../src/core/rules/section-allowlist.js";

describe("section-allowlist resolveSectionHeading + normalizeSectionKey", () => {
  it("resolves all three allowlist keys to their canonical heading", () => {
    expect(resolveSectionHeading("rationale")).toMatchObject({ ok: true, heading: "Rationale" });
    expect(resolveSectionHeading("research")).toMatchObject({ ok: true, heading: "Research / Analysis" });
    expect(resolveSectionHeading("implementation_notes")).toMatchObject({ ok: true, heading: "Implementation Notes" });
  });

  it("returns denied for both deny-list canonical keys", () => {
    expect(resolveSectionHeading("verification_evidence")).toMatchObject({ ok: false, reason: "denied" });
    expect(resolveSectionHeading("acceptance_criteria")).toMatchObject({ ok: false, reason: "denied" });
  });

  it("returns unknown for arbitrary unrelated keys", () => {
    expect(resolveSectionHeading("bogus")).toMatchObject({ ok: false, reason: "unknown" });
  });

  it("accepts mixed-case input by lowercasing", () => {
    expect(resolveSectionHeading("Rationale")).toMatchObject({ ok: true, heading: "Rationale" });
  });

  it("denies hyphen variants by normalising to underscore", () => {
    expect(resolveSectionHeading("verification-evidence")).toMatchObject({ ok: false, reason: "denied" });
  });

  it("denies the two old plural aliases of the structured tables", () => {
    expect(resolveSectionHeading("acceptance_criterias")).toMatchObject({ ok: false, reason: "denied" });
    expect(resolveSectionHeading("verification_evidences")).toMatchObject({ ok: false, reason: "denied" });
  });

  it("accepts surrounding whitespace by trimming", () => {
    expect(resolveSectionHeading("  rationale  ")).toMatchObject({ ok: true, heading: "Rationale" });
  });

  it("preserves canonical allowlist key implementation_notes (no trailing-s strip)", () => {
    expect(normalizeSectionKey("implementation_notes")).toBe("implementation_notes");
    expect(resolveSectionHeading("implementation_notes")).toMatchObject({ ok: true, heading: "Implementation Notes" });
  });
});
