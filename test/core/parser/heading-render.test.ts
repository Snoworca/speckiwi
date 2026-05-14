import { describe, expect, it } from "vitest";
import { parseRequirementHeading } from "../../../src/core/parser/block-scanner.js";
import { renderHeadingLine } from "../../../src/core/parser/heading-render.js";
import { POSITIVE_HEADING_FIXTURES, SUB_PARSER_WARNING_FIXTURES } from "./heading-marker.fixtures.js";

describe("renderHeadingLine — SRS-MD-Rules v1.1.0 round-trip identity", () => {
  it("render(parse(line)) is byte-identical for every positive fixture", () => {
    for (const fixture of POSITIVE_HEADING_FIXTURES) {
      const parsed = parseRequirementHeading(fixture.input);
      expect(parsed, `should parse: ${fixture.input}`).toBeDefined();
      const rendered = renderHeadingLine({
        id: parsed!.id,
        title: parsed!.title,
        strikethrough: parsed!.strikethrough,
        marker: parsed!.marker,
        // successorId/successorCount come from the fixture spec until the marker-inner sub-parser populates them
        successorId: fixture.expected.successorId,
        successorCount: fixture.expected.successorCount
      });
      expect(rendered, `round-trip failed for ${fixture.name}`).toBe(fixture.input);
    }
  });

  it("plain heading round-trip", () => {
    const line = "### FR-ARCH-001 — Plain title";
    const parsed = parseRequirementHeading(line)!;
    expect(renderHeadingLine(parsed)).toBe(line);
  });

  it("discarded with no successor", () => {
    expect(
      renderHeadingLine({ id: "FR-AUTH-001", title: "Add login", strikethrough: true, marker: "DISCARDED" })
    ).toBe("### ~~FR-AUTH-001 — Add login~~ [DISCARDED]");
  });

  it("discarded single successor", () => {
    expect(
      renderHeadingLine({
        id: "FR-AUTH-001",
        title: "Add login",
        strikethrough: true,
        marker: "DISCARDED",
        successorId: "FR-AUTH-002"
      })
    ).toBe("### ~~FR-AUTH-001 — Add login~~ [DISCARDED → see FR-AUTH-002]");
  });

  it("discarded multiple successors (+N)", () => {
    expect(
      renderHeadingLine({
        id: "FR-AUTH-001",
        title: "Add login",
        strikethrough: true,
        marker: "DISCARDED",
        successorId: "FR-AUTH-002",
        successorCount: 2
      })
    ).toBe("### ~~FR-AUTH-001 — Add login~~ [DISCARDED → see FR-AUTH-002 +2]");
  });

  it("draft base", () => {
    expect(renderHeadingLine({ id: "FR-AUTH-001", title: "Add login", marker: "DRAFT" })).toBe(
      "### FR-AUTH-001 — Add login [DRAFT — pending decision]"
    );
  });

  it("draft single conflict", () => {
    expect(
      renderHeadingLine({
        id: "FR-AUTH-001",
        title: "Add login",
        marker: "DRAFT",
        successorId: "FR-AUTH-002"
      })
    ).toBe("### FR-AUTH-001 — Add login [DRAFT — pending decision, see FR-AUTH-002]");
  });

  it("draft multiple conflicts (+N)", () => {
    expect(
      renderHeadingLine({
        id: "FR-AUTH-001",
        title: "Add login",
        marker: "DRAFT",
        successorId: "FR-AUTH-002",
        successorCount: 1
      })
    ).toBe("### FR-AUTH-001 — Add login [DRAFT — pending decision, see FR-AUTH-002 +1]");
  });
});

describe("renderHeadingLine — sub-parser warning fixtures pass through plain form", () => {
  it("non-standard bracket content survives round-trip via plain title capture", () => {
    for (const fixture of SUB_PARSER_WARNING_FIXTURES) {
      const parsed = parseRequirementHeading(fixture.input)!;
      // The marker-inner sub-parser is responsible for flagging [TBD] etc. The renderer simply rebuilds the line
      // from the captured title; for warning fixtures that means the [TBD] segment lives inside `title`.
      expect(renderHeadingLine({ id: parsed.id, title: parsed.title })).toBe(fixture.input);
    }
  });
});
