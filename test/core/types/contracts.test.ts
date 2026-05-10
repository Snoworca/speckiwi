import { describe, expect, it } from "vitest";
import {
  LEGACY_STABILITY_LEVELS,
  REQUIREMENT_STATUSES,
  REQUIREMENT_TYPES,
  RISK_LEVELS,
  STABILITY_LEVELS,
  PRIORITY_LEVELS,
  type RequirementRecord
} from "../../../src/core/types.js";
import { isCanonicalStability, isKnownStability, isLegacyStability } from "../../../src/core/schema.js";
import { fail, ok } from "../../../src/core/result.js";

describe("shared core contracts", () => {
  it("keeps enum values aligned with SRS-MD rules", () => {
    expect(REQUIREMENT_STATUSES).toEqual([
      "planned",
      "in_progress",
      "blocked",
      "implemented",
      "verified",
      "discarded"
    ]);
    expect(REQUIREMENT_TYPES).toContain("functional");
    expect(REQUIREMENT_TYPES).toContain("constraint");
    expect(PRIORITY_LEVELS).toEqual(["critical", "high", "medium", "low", "optional"]);
    expect(RISK_LEVELS).toEqual(["low", "medium", "high", "critical"]);
    expect(STABILITY_LEVELS).toEqual(["draft", "evolving", "stable", "frozen", "deprecated"]);
    expect(LEGACY_STABILITY_LEVELS).toEqual(["volatile"]);
    expect(STABILITY_LEVELS).not.toContain("volatile");
    expect(isCanonicalStability("draft")).toBe(true);
    expect(isCanonicalStability("volatile")).toBe(false);
    expect(isLegacyStability("volatile")).toBe(true);
    expect(isKnownStability("volatile")).toBe(true);
    expect(isKnownStability("unknown")).toBe(false);
  });

  it("serializes requirement records and results as JSON", () => {
    const record: RequirementRecord = {
      id: "FR-ARCH-999",
      title: "테스트 요구사항",
      type: "functional",
      target: "v1.0.0",
      status: "planned",
      scope: "ARCH",
      filePath: "docs/spec/10.product-architecture.srs.md",
      headingLine: 10,
      metadata: { Type: "functional", Target: "v1.0.0", Status: "planned" },
      acceptanceCriteria: [{ id: "AC-1", text: "동작한다", checked: false, line: 20 }],
      verificationEvidence: [],
      traceLinks: [],
      tags: ["test"]
    };

    expect(JSON.parse(JSON.stringify(record)).id).toBe("FR-ARCH-999");
    expect(ok(record).ok).toBe(true);
    expect(fail("SRS-E001", "failed").ok).toBe(false);
  });
});
