import { describe, expect, it } from "vitest";
import { normalizeSectionKey, resolveSectionHeading } from "../../../src/core/rules/section-allowlist.js";

describe("section-allowlist resolveSectionHeading + normalizeSectionKey", () => {
  it("resolves all three allowlist keys to their canonical heading", () => {
    expect(resolveSectionHeading("rationale")).toEqual({ ok: true, heading: "Rationale" });
    expect(resolveSectionHeading("research")).toEqual({ ok: true, heading: "Research / Analysis" });
    expect(resolveSectionHeading("implementation_notes")).toEqual({ ok: true, heading: "Implementation Notes" });
  });

  it("returns denied for both deny-list canonical keys", () => {
    expect(resolveSectionHeading("verification_evidence")).toEqual({ ok: false, reason: "denied" });
    expect(resolveSectionHeading("acceptance_criteria")).toEqual({ ok: false, reason: "denied" });
  });

  it("returns unknown for arbitrary unrelated keys", () => {
    expect(resolveSectionHeading("bogus")).toEqual({ ok: false, reason: "unknown" });
  });

  it("accepts mixed-case input by lowercasing", () => {
    expect(resolveSectionHeading("Rationale")).toEqual({ ok: true, heading: "Rationale" });
  });

  it("denies hyphen variants by normalising to underscore", () => {
    expect(resolveSectionHeading("verification-evidence")).toEqual({ ok: false, reason: "denied" });
  });

  it("denies plural alias variants enumerated in SECTION_DENYLIST", () => {
    expect(resolveSectionHeading("acceptance_criterias")).toEqual({ ok: false, reason: "denied" });
    expect(resolveSectionHeading("verification_evidences")).toEqual({ ok: false, reason: "denied" });
  });

  it("accepts surrounding whitespace by trimming", () => {
    expect(resolveSectionHeading("  rationale  ")).toEqual({ ok: true, heading: "Rationale" });
  });

  it("preserves canonical allowlist key implementation_notes (no trailing-s strip)", () => {
    expect(normalizeSectionKey("implementation_notes")).toBe("implementation_notes");
    expect(resolveSectionHeading("implementation_notes")).toEqual({ ok: true, heading: "Implementation Notes" });
  });
});
