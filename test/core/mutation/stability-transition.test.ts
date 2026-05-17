import { describe, expect, it } from "vitest";
import { classifyStabilityTransition } from "../../../src/core/mutation/stability-transition.js";

describe("FR-PARSE-017 AC-2 — classifyStabilityTransition", () => {
  it("returns undefined for adjacent forward (draft → evolving)", () => {
    expect(classifyStabilityTransition("draft", "evolving")).toBeUndefined();
  });

  it("returns 'skip-forward' for non-adjacent forward (draft → stable)", () => {
    expect(classifyStabilityTransition("draft", "stable")).toBe("skip-forward");
  });

  it("returns 'rollback' for backward transition (stable → evolving)", () => {
    expect(classifyStabilityTransition("stable", "evolving")).toBe("rollback");
  });

  it("returns 'redundant' for same value (stable → stable)", () => {
    expect(classifyStabilityTransition("stable", "stable")).toBe("redundant");
  });

  it("returns undefined for fresh requirement (undefined → draft)", () => {
    expect(classifyStabilityTransition(undefined, "draft")).toBeUndefined();
  });

  it("returns 'skip-forward' for evolving → frozen (skip stable)", () => {
    expect(classifyStabilityTransition("evolving", "frozen")).toBe("skip-forward");
  });

  it("returns undefined for adjacent stable → frozen", () => {
    expect(classifyStabilityTransition("stable", "frozen")).toBeUndefined();
  });

  it("returns 'rollback' for deprecated → stable", () => {
    expect(classifyStabilityTransition("deprecated", "stable")).toBe("rollback");
  });
});
