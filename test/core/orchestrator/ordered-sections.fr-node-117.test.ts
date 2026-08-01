import { describe, expect, it } from "vitest";
import { countOrderedSections } from "../../../src/core/orchestrator/route-probe.js";

// FR-NODE-117 — S7's counting rule (09 §3.2 S7, §3.5 narrowing 1). `kiwi-wave-master` lists ordering
// markers *and* plain top-level titles as wave boundaries; the full reading fires on essentially every
// structured markdown document, so D4 uses the ordered-marker half only. D4's threshold reads this
// count, so the counting rule is the whole content of that disqualifier's left-hand side.

describe("FR-NODE-117 AC-1 — one accepted fixture per marker form", () => {
  it.each([
    ["## Phase 1", "Phase n"],
    ["## 1단계", "n단계"],
    ["## Step 1", "Step n"],
    ["## 1. Title", "n. Title"]
  ])("counts %s as one ordered section (%s)", (heading) => {
    expect(countOrderedSections(`# Document\n\n${heading}\n\nbody\n`)).toBe(1);
  });

  it("counts the closing-parenthesis form of the numbered title", () => {
    expect(countOrderedSections("## 1) Title\n")).toBe(1);
  });

  it("counts a 단계 marker carrying a title", () => {
    expect(countOrderedSections("## 1단계 준비\n")).toBe(1);
  });
});

describe("FR-NODE-117 AC-2 — Phase and Step matching is case-insensitive", () => {
  it.each(["## phase 1", "## PHASE 1", "## step 2", "## STEP 2"])("counts %s", (heading) => {
    expect(countOrderedSections(`${heading}\n`)).toBe(1);
  });

  it("does not count a word that merely starts with the marker", () => {
    expect(countOrderedSections("## Phased rollout 1\n## Stepwise 2\n")).toBe(0);
  });
});

describe("FR-NODE-117 AC-3 — one rejected fixture per non-counting numeric shape", () => {
  it.each([
    ["## 2 Design", "bare leading integer with no separator"],
    ["## 3.5 Two narrowings", "dotted sub-number"],
    ["## v2.4.0 release", "version string"],
    ["## 2026-08-01 routing notes", "leading date"]
  ])("rejects %s (%s)", (heading) => {
    expect(countOrderedSections(`${heading}\n`)).toBe(0);
  });
});

describe("FR-NODE-117 AC-4 — a plain top-level title does not count", () => {
  it("counts nothing in a document whose headings carry no leading numeric token", () => {
    expect(countOrderedSections("## Scope\n\ntext\n\n## Rationale\n\ntext\n\n## Decision\n\ntext\n\n## Consequences\n")).toBe(0);
  });
});

describe("FR-NODE-117 AC-5 — only ##-level heading text is scanned", () => {
  it("ignores a deeper heading carrying an accepted marker form", () => {
    expect(countOrderedSections("### Phase 1\n#### Step 2\n##### 3단계\n")).toBe(0);
  });

  it("ignores a top-level # heading carrying an accepted marker form", () => {
    expect(countOrderedSections("# Phase 1\n")).toBe(0);
  });
});

describe("FR-NODE-117 AC-6 — D4's >= 2 threshold is pinned on both sides", () => {
  it("counts 1 for a document carrying exactly one accepted marker", () => {
    expect(countOrderedSections("# Title\n\n## Phase 1\n\nbody\n\n## Appendix\n")).toBe(1);
  });

  it("counts 2 for a document carrying two", () => {
    expect(countOrderedSections("# Title\n\n## Phase 1\n\nbody\n\n## Phase 2\n\nbody\n")).toBe(2);
  });

  it("counts 0 for an empty document", () => {
    expect(countOrderedSections("")).toBe(0);
  });
});
