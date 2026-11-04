import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { resolveProjectRoot } from "../../../src/core/project-root.js";
import { parseWorkspace } from "../../../src/core/parser/workspace-parser.js";
import { buildReadEnvelope } from "../../../src/core/query/summary.js";
import type { Diagnostic, ParsedWorkspace } from "../../../src/core/types.js";
import { validateWorkspace } from "../../../src/core/validator/validate-workspace.js";

// FR-NODE-231 — buildReadEnvelope bounds the diagnostics entries only when a caller opts in.
// The problem-matrix fixture carries 93 distinct diagnostics (37 errors, 56 warnings), enough
// to exceed a small limit while keeping both severities on each side of the cut.

const FIXTURE = path.resolve("test", "fixtures", "workspaces", "problem-matrix");
const GOLDEN = path.resolve("test", "core", "query", "__golden__", "read-envelope-problem-matrix.fr-node-231.json");
const VALUE = { id: "FR-X-001", title: "probe value" };

let workspace: ParsedWorkspace;
let all: Diagnostic[];

beforeAll(async () => {
  workspace = await parseWorkspace(await resolveProjectRoot(FIXTURE));
  // Parse plus validation diagnostics, the same pair the MCP and CLI readers hand the envelope.
  all = [...workspace.diagnostics, ...validateWorkspace(workspace).diagnostics];
});

describe("FR-NODE-231 opt-in diagnostics limit on the read envelope", () => {
  // @req FR-NODE-231 AC-3
  it("AC-3: with no limit the serialized envelope is byte-identical to the pre-limit golden", async () => {
    // The golden file was written by the implementation that existed before the limit was added.
    await expect(JSON.stringify(buildReadEnvelope(workspace, VALUE, all), null, 2)).toMatchFileSnapshot(GOLDEN);
  });

  // @req FR-NODE-231 AC-3
  it("AC-3: a limit at or above the entry count changes nothing", () => {
    const unbounded = JSON.stringify(buildReadEnvelope(workspace, VALUE, all));
    const total = buildReadEnvelope(workspace, VALUE, all).diagnostics.length;
    expect(JSON.stringify(buildReadEnvelope(workspace, VALUE, all, { diagnosticsLimit: total }))).toBe(unbounded);
  });

  // @req FR-NODE-231 AC-1
  it("AC-1: over the limit, at most limit entries plus a truncation descriptor", () => {
    const total = buildReadEnvelope(workspace, VALUE, all).diagnostics.length;
    expect(total).toBeGreaterThan(40);
    const envelope = buildReadEnvelope(workspace, VALUE, all, { diagnosticsLimit: 40 });
    expect(envelope.diagnostics).toHaveLength(40);
    expect(envelope.diagnosticsTruncation).toEqual({ total, returned: 40, limit: 40 });
    // The split copies describe the same truncated entries, not the full set.
    expect([...envelope.errors, ...envelope.warnings].length).toBe(40);
    for (const item of [...envelope.errors, ...envelope.warnings]) expect(envelope.diagnostics).toContain(item);
    expect(envelope.errors.every((item) => item.severity === "error")).toBe(true);
    expect(envelope.warnings.every((item) => item.severity === "warning")).toBe(true);
    // The value body is untouched.
    expect(envelope.id).toBe("FR-X-001");
  });

  // @req FR-NODE-231 AC-1
  it("AC-1: errors are kept before warnings when the limit cuts", () => {
    const full = buildReadEnvelope(workspace, VALUE, all);
    const errorCount = full.errors.length;
    const envelope = buildReadEnvelope(workspace, VALUE, all, { diagnosticsLimit: errorCount });
    expect(envelope.errors).toEqual(full.errors);
    expect(envelope.warnings).toEqual([]);
    // A cut inside the errors bounds the errors copy too.
    const tight = buildReadEnvelope(workspace, VALUE, all, { diagnosticsLimit: 10 });
    expect(tight.errors).toEqual(tight.diagnostics);
    expect(tight.errors).toHaveLength(10);
  });

  // @req FR-NODE-231 AC-2
  it("AC-2: the summary still counts every diagnostic after truncation", () => {
    const full = buildReadEnvelope(workspace, VALUE, all);
    const envelope = buildReadEnvelope(workspace, VALUE, all, { diagnosticsLimit: 1 });
    expect(envelope.diagnostics).toHaveLength(1);
    expect(envelope.diagnosticsSummary).toEqual(full.diagnosticsSummary);
    expect(envelope.diagnosticsSummary.errors + envelope.diagnosticsSummary.warnings).toBe(full.diagnostics.length);
  });

  // @req FR-NODE-231 AC-1
  it("rejects a limit that is not a positive integer at the call", () => {
    for (const bad of [0, -1, 1.5, Number.NaN]) {
      expect(() => buildReadEnvelope(workspace, VALUE, all, { diagnosticsLimit: bad })).toThrow(RangeError);
    }
  });
});
