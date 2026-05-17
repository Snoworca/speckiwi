import { describe, expect, it } from "vitest";
import { extractTargetGoals } from "../../../src/core/parser/index-parser.js";

describe("FR-PARSE-018 — extractTargetGoals (00.index.md scan)", () => {
  it("AC-1/AC-2: extracts a single Target Goal block with normalised text", () => {
    const lines = [
      "## 3. Target Map",
      "",
      "| Target | Status |",
      "|---|---|",
      "| v1.0.0 | active |",
      "",
      "### Target: v1.0.0",
      "",
      "**Goal:** Establish parser baseline.",
      ""
    ];
    expect(extractTargetGoals(lines)).toEqual({ "v1.0.0": "Establish parser baseline." });
  });

  it("AC-4: skips blocks without a Goal label (no diagnostic, key omitted)", () => {
    const lines = [
      "### Target: v1.1.0",
      "",
      "Some descriptive paragraph but no Goal label.",
      "",
      "### Target: v1.2.0",
      "",
      "**Goal:** Has a goal."
    ];
    const goals = extractTargetGoals(lines);
    expect(goals).not.toHaveProperty("v1.1.0");
    expect(goals).toEqual({ "v1.2.0": "Has a goal." });
  });

  it("AC-2: joins multi-paragraph goal text with newlines", () => {
    const lines = [
      "### Target: v2.0.0",
      "",
      "**Goal:** First paragraph.",
      "Second paragraph continuation.",
      "",
      "Third paragraph after blank line."
    ];
    expect(extractTargetGoals(lines)).toEqual({
      "v2.0.0": "First paragraph.\nSecond paragraph continuation.\nThird paragraph after blank line."
    });
  });

  it("AC-2/AC-5: preserves non-ASCII (한글, emoji, tab, escape) codepoints verbatim", () => {
    const goalText = "한글 목표 \t→ ✅ \"escaped\" `backtick`";
    const lines = [
      "### Target: v3.0.0",
      "",
      `**Goal:** ${goalText}`
    ];
    expect(extractTargetGoals(lines)["v3.0.0"]).toBe(goalText);
  });

  it("AC-1: two Target blocks coexist as separate keys", () => {
    const lines = [
      "### Target: v1.0.0",
      "",
      "**Goal:** First.",
      "",
      "### Target: v1.1.0",
      "",
      "**Goal:** Second."
    ];
    expect(extractTargetGoals(lines)).toEqual({
      "v1.0.0": "First.",
      "v1.1.0": "Second."
    });
  });
});
