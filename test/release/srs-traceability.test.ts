import { describe, expect, it } from "vitest";
import { collectTraceabilityCoverage } from "../../src/core/workflow/release-readiness.js";

describe("SRS traceability coverage", () => {
  it("accepts a coverage index containing all requirement IDs", () => {
    const coverage = collectTraceabilityCoverage(["FR-ARCH-001"], { "FR-ARCH-001": ["test/release/srs-traceability.test.ts"] });
    expect(coverage.coveragePercent).toBe(100);
  });
});
