import { readFile } from "node:fs/promises";
import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { main } from "../../src/cli/index.js";
import {
  DIAGNOSTIC_DEFINITIONS,
  ENUM_REMEDIATION_LEVELS,
  getDiagnosticDefinition,
  renderEnumRemediation
} from "../../src/core/diagnostic-registry.js";
import {
  LEGACY_STABILITY_LEVELS,
  PRIORITY_LEVELS,
  REQUIREMENT_STATUSES,
  RISK_LEVELS,
  STABILITY_LEVELS
} from "../../src/core/types.js";

// @req FR-PARSE-038 — a remediation that names the values a field may take is rendered from the
// constant that defines them.
//
// The expectations below are stated INDEPENDENTLY of the registry's own mapping: this table names
// the field and the defining constant itself. Reading them back out of the implementation would
// make every case self-consistent, and the defect this requirement exists for — SRS-E005 pointing
// at the wrong constant, so the tool told an agent to set Status to a Stability value — would pass.
const EXPECTED = {
  "SRS-E005": { label: "Status", levels: REQUIREMENT_STATUSES },
  "SRS-E006": { label: "Priority", levels: PRIORITY_LEVELS },
  "SRS-E007": { label: "Risk", levels: RISK_LEVELS },
  "SRS-E011": { label: "Stability", levels: STABILITY_LEVELS }
} as const satisfies Record<string, { label: string; levels: readonly string[] }>;

type ExpectedCode = keyof typeof EXPECTED;
const EXPECTED_CODES = Object.keys(EXPECTED) as ExpectedCode[];

/** A remediation "enumerates values" when it carries a parenthesised comma-separated list. */
function enumeratedValues(remediation: string | undefined): string[] | null {
  if (!remediation) return null;
  const match = /\(([^)]*,[^)]*)\)/.exec(remediation);
  if (!match) return null;
  return match[1]!.split(",").map((part) => part.trim()).filter(Boolean);
}

function io() {
  return { stdout: new PassThrough() as NodeJS.WriteStream, stderr: new PassThrough() as NodeJS.WriteStream };
}

function drain(stream: NodeJS.WriteStream): string {
  return (stream as unknown as PassThrough).read()?.toString() ?? "";
}

describe("FR-PARSE-038 — enum remediations derive their values", () => {
  // AC-1: produced from the defining constant, never a hand-written list. Full-string equality
  // pins the field name too, so swapping a label produces a coherent-looking but wrong sentence
  // that this case rejects.
  it.each(EXPECTED_CODES)("AC-1: %s renders its field and its defining constant", (code) => {
    const { label, levels } = EXPECTED[code];
    expect(getDiagnosticDefinition(code).remediation).toBe(renderEnumRemediation(label, levels));
    // Pin the chain, not just today's text: a copied array with the same values renders identically
    // now and stops tracking the constant the moment someone edits one of them.
    expect(ENUM_REMEDIATION_LEVELS[code], `${code} must point at the defining constant itself`).toBe(levels);
  });

  // AC-1: the derivation covers exactly the codes this contract names — no more, no fewer.
  it("AC-1: the registry's derived set matches the codes under contract", () => {
    expect(Object.keys(ENUM_REMEDIATION_LEVELS).sort()).toEqual([...EXPECTED_CODES].sort());
  });

  // AC-1: "no such remediation SHALL carry a hand-written value list". Comparing rendered strings
  // cannot see this — a list typed out correctly by hand reads identically today and drifts on the
  // next change to the constant. So read the source and require a call, not a literal.
  it("AC-1: no covered definition writes its remediation as a literal", async () => {
    const source = await readFile(new URL("../../src/core/diagnostic-registry.ts", import.meta.url), "utf8");
    for (const code of EXPECTED_CODES) {
      const block = new RegExp(`code: "${code}"[\\s\\S]*?remediation:\\s*([\\s\\S]*?)\\n\\s*\\},`).exec(source);
      expect(block, `${code} block with a remediation not found`).not.toBeNull();
      expect(block![1]!.trim(), `${code} must call the renderer, not carry a literal`).toMatch(
        /^(render)?enumRemediation\(/i
      );
    }
  });

  // AC-2: the text follows the level set. Rendering the same label against a widened and a
  // narrowed set must both differ from what shipped, which is what a hand-written list cannot do.
  it.each(EXPECTED_CODES)("AC-2: %s text changes when the level set changes", (code) => {
    const { label, levels } = EXPECTED[code];
    const shipped = getDiagnosticDefinition(code).remediation;

    const widened = renderEnumRemediation(label, [...levels, "example-added-level"]);
    expect(widened).not.toBe(shipped);
    expect(widened).toContain("example-added-level");

    const narrowed = renderEnumRemediation(label, levels.slice(0, -1));
    expect(narrowed).not.toBe(shipped);

    // And the shipped text is exactly what the unchanged set renders to.
    expect(renderEnumRemediation(label, levels)).toBe(shipped);
  });

  // AC-3: compatibility-only values are absent from a "supported values" remediation.
  it("AC-3: legacy-only stability values are absent", () => {
    const stability = getDiagnosticDefinition("SRS-E011").remediation ?? "";
    for (const legacy of LEGACY_STABILITY_LEVELS) {
      expect(stability, `SRS-E011 must not offer the compatibility-only value ${legacy}`).not.toContain(legacy);
    }
  });

  // AC-4: no enumerating remediation escapes the derivation by being overlooked. This is stated as
  // a set, not a count: it named SRS-E005 the moment the derivation shipped, which the census that
  // produced the original inventory had missed.
  it("AC-4: every enumerating remediation is covered by the derivation", () => {
    const covered = new Set<string>(Object.keys(ENUM_REMEDIATION_LEVELS));
    const uncovered = DIAGNOSTIC_DEFINITIONS
      .filter((definition) => enumeratedValues(definition.remediation) !== null)
      .map((definition) => definition.code)
      .filter((code) => !covered.has(code));
    expect(uncovered, "these remediations enumerate values but are not derived").toEqual([]);
  });

  // AC-5: the derived text reaches the consumer verbatim on both explain outputs.
  it.each(EXPECTED_CODES)("AC-5: explain %s surfaces the derived text in human output", async (code) => {
    const expected = getDiagnosticDefinition(code).remediation as string;
    const streams = io();
    const exitCode = await main(["explain", code], streams);
    const text = drain(streams.stdout);

    expect(exitCode).toBe(0);
    expect(text).toContain(expected);
    expect(text).not.toContain("undefined");
  });

  it.each(EXPECTED_CODES)("AC-5: explain %s --json surfaces the derived text", async (code) => {
    const expected = getDiagnosticDefinition(code).remediation as string;
    const streams = io();
    const exitCode = await main(["explain", code, "--json"], streams);
    const parsed = JSON.parse(drain(streams.stdout)) as { remediation?: string };

    expect(exitCode).toBe(0);
    // Top-level key, matching what the explain surface actually emits. Accepting a nested shape too
    // would silently absorb a regression that moved it.
    expect(parsed.remediation).toBe(expected);
  });
});
