import { describe, it, expect } from "vitest";
import { parseRequirementHeading } from "../../../src/core/parser/block-scanner.js";
import {
  ALL_HEADING_FIXTURES,
  NEGATIVE_HEADING_FIXTURES,
  POSITIVE_HEADING_FIXTURES,
  SUB_PARSER_WARNING_FIXTURES
} from "./heading-marker.fixtures.js";

describe("parseRequirementHeading — SRS-MD-Rules v1.1.0 §30.1/§30.2 marker", () => {
  describe("positive fixtures (regex match + extracted fields)", () => {
    for (const fixture of [...POSITIVE_HEADING_FIXTURES, ...SUB_PARSER_WARNING_FIXTURES]) {
      it(fixture.name, () => {
        const result = parseRequirementHeading(fixture.input);
        expect(result, "expected match").toBeDefined();
        const { id, title, strikethrough, marker } = result!;
        expect(id).toBe(fixture.expected.id);
        expect(title).toBe(fixture.expected.title);
        expect(strikethrough).toBe(Boolean(fixture.expected.strikethrough));
        if (fixture.expected.marker) {
          expect(marker).toBe(fixture.expected.marker);
        } else {
          expect(marker).toBeUndefined();
        }
      });
    }
  });

  describe("negative fixtures", () => {
    for (const fixture of NEGATIVE_HEADING_FIXTURES) {
      it(fixture.name, () => {
        const result = parseRequirementHeading(fixture.input);
        expect(result, `expected no match for ${fixture.input}`).toBeUndefined();
      });
    }
  });

  describe("regression sanity", () => {
    it("all fixtures account for both expected.match outcomes", () => {
      const positives = ALL_HEADING_FIXTURES.filter((f) => f.expected.match).length;
      const negatives = ALL_HEADING_FIXTURES.filter((f) => !f.expected.match).length;
      expect(positives).toBeGreaterThan(0);
      expect(negatives).toBeGreaterThan(0);
      expect(positives + negatives).toBe(ALL_HEADING_FIXTURES.length);
    });
  });
});
