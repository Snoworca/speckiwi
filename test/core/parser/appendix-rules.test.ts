import { describe, expect, it } from "vitest";
import { isV110OrLater, parseAppendixRulesRow } from "../../../src/core/parser/appendix-rules.js";

const HEADER = `# SpecKiwi Appendix

| Field | Value |
|---|---|
| Document Type | appendix |
| Product | SpecKiwi |
| Product Version | 1.0.0 |
| Version | 1.0.0 |
| Last Updated | 2026-05-15 |
`;

describe("parseAppendixRulesRow — SRS-MD-Rules v1.1.0 §30.5 fixture matrix", () => {
  it("canonical Rules row (relative path)", () => {
    const content = HEADER + "| Rules | [SRS-MD Authoring Rules v1.1.0](../rule/SRS-MD-Rules-v1.1.0.md) |\n";
    const result = parseAppendixRulesRow(content);
    expect(result.version).toBe("1.1.0");
    expect(result.keyVariant).toBe("Rules");
  });

  it("absolute repo-root path is accepted", () => {
    const content = HEADER + "| Rules | [SRS-MD Authoring Rules v1.1.0](./docs/rule/SRS-MD-Rules-v1.1.0.md) |\n";
    expect(parseAppendixRulesRow(content).version).toBe("1.1.0");
  });

  it("whitespace padding around cells is tolerated", () => {
    const content = HEADER + "|  Rules  |  [SRS-MD Authoring Rules v1.1.0](../rule/SRS-MD-Rules-v1.1.0.md)  |\n";
    expect(parseAppendixRulesRow(content).version).toBe("1.1.0");
  });

  it("lowercase `rules` key is normalised to the canonical key", () => {
    const content = HEADER + "| rules | [SRS-MD Authoring Rules v1.1.0](../rule/SRS-MD-Rules-v1.1.0.md) |\n";
    const result = parseAppendixRulesRow(content);
    expect(result.version).toBe("1.1.0");
    expect(result.keyVariant?.toLowerCase()).toBe("rules");
  });

  it("v1.0.0 link is detected as v1.0.0", () => {
    const content = HEADER + "| Rules | [SRS-MD Authoring Rules v1.0.0](../rule/SRS-MD-Rules-v1.0.0.md) |\n";
    expect(parseAppendixRulesRow(content).version).toBe("1.0.0");
  });

  it("missing Rules row returns no version (caller falls back to v1.0.0)", () => {
    expect(parseAppendixRulesRow(HEADER).version).toBeUndefined();
  });

  it("malformed filename (no version segment) returns no version but preserves rawLink", () => {
    const content = HEADER + "| Rules | [Custom name](../rule/SRS-MD-Rules-custom.md) |\n";
    const result = parseAppendixRulesRow(content);
    expect(result.version).toBeUndefined();
    expect(result.rawLink).toContain("SRS-MD-Rules-custom.md");
  });
});

describe("isV110OrLater", () => {
  it("treats >=1.1.0 as active", () => {
    expect(isV110OrLater("1.1.0")).toBe(true);
    expect(isV110OrLater("1.2.0")).toBe(true);
    expect(isV110OrLater("2.0.0")).toBe(true);
  });

  it("treats <1.1.0 as inactive", () => {
    expect(isV110OrLater("1.0.0")).toBe(false);
    expect(isV110OrLater("0.9.9")).toBe(false);
  });

  it("undefined or malformed version returns false (safe fallback)", () => {
    expect(isV110OrLater(undefined)).toBe(false);
    expect(isV110OrLater("not-a-version")).toBe(false);
    expect(isV110OrLater("1.1")).toBe(false);
  });
});
