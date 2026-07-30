import { describe, expect, it } from "vitest";
import { DEFAULT_REQUIREMENT_STABILITY, renderRequirementBlock } from "../../../src/core/mutation/render-requirement.js";
import { parseRequirementHeading } from "../../../src/core/parser/block-scanner.js";
import { loadBundledRulesDocument } from "../../../src/core/bootstrap/templates.js";

// FR-NODE-094 — the draft marker must mean "this is draft", not "this became draft".
//
// `add_requirement` renders a bare heading while `update_stability` writing the same value renders
// `[DRAFT — pending decision]`, so the marker encoded provenance instead of state. §30.2 gives the
// marker the opposite job: a reader should be able to spot a draft requirement by its heading.

function render(stability?: string): string[] {
  return renderRequirementBlock({
    id: "FR-DEMO-001",
    type: "functional",
    target: "v1.0.0",
    title: "Demo requirement",
    statement: "The demo shall exist.",
    acceptanceCriteria: ["It exists."],
    ...(stability === undefined ? {} : { stability })
  });
}

function heading(lines: string[]): string {
  return lines[0] ?? "";
}

function stabilityRow(lines: string[]): string | undefined {
  return lines.find((line) => line.startsWith("| Stability |"));
}

describe("FR-NODE-094 AC-1 — a requirement created draft carries the marker", () => {
  it("renders the canonical draft marker on the heading", () => {
    const lines = render("draft");

    expect(heading(lines)).toBe("### FR-DEMO-001 — Demo requirement [DRAFT — pending decision]");
    expect(stabilityRow(lines)).toBe("| Stability | draft |");
  });
});

describe("FR-NODE-094 AC-2 — any other stability renders a bare heading", () => {
  it("leaves evolving, stable and frozen headings unmarked", () => {
    for (const stability of ["evolving", "stable", "frozen"]) {
      const lines = render(stability);
      expect(heading(lines), stability).toBe("### FR-DEMO-001 — Demo requirement");
      expect(stabilityRow(lines), stability).toBe(`| Stability | ${stability} |`);
    }
  });
});

describe("FR-NODE-094 AC-3 — the default and the marker never disagree", () => {
  it("marks an omitted stability exactly when the default is draft", () => {
    const lines = render(undefined);

    expect(stabilityRow(lines)).toBe(`| Stability | ${DEFAULT_REQUIREMENT_STABILITY} |`);
    // Whatever the default is, the heading must agree with it. Pinning the pair rather than the value
    // keeps this true if the default is ever changed deliberately.
    const marked = heading(lines).includes("[DRAFT — pending decision]");
    expect(marked).toBe(DEFAULT_REQUIREMENT_STABILITY === "draft");
  });
});

describe("FR-NODE-094 AC-4 — the marked heading still round-trips", () => {
  it("parses back to the same id and title", () => {
    const parsed = parseRequirementHeading(heading(render("draft")));

    expect(parsed?.id).toBe("FR-DEMO-001");
    expect(parsed?.title).toBe("Demo requirement");
  });
});

describe("FR-NODE-094 AC-5 — the rules document states the creation default", () => {
  it("says which stability add_requirement applies when the caller omits it", async () => {
    const text = await loadBundledRulesDocument();

    // An author reading only the document had no way to know the tool would pick draft for them.
    const sentence = text.split(/\r?\n/).find((line) => /add_requirement/.test(line) && /omit/i.test(line));
    expect(sentence, "the document must state the omitted-stability default").toBeDefined();
    expect(sentence).toContain(DEFAULT_REQUIREMENT_STABILITY);
  });
});
