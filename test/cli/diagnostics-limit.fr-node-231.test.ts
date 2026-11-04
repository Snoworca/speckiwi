import { PassThrough } from "node:stream";
import { beforeAll, describe, expect, it } from "vitest";
import { main } from "../../src/cli/index.js";
import { parseWorkspace } from "../../src/core/parser/workspace-parser.js";
import { resolveProjectRoot } from "../../src/core/project-root.js";
import { buildReadEnvelope } from "../../src/core/query/summary.js";
import { validateWorkspace } from "../../src/core/validator/validate-workspace.js";
import type { Diagnostic } from "../../src/core/types.js";
import { copyFixtureWorkspace } from "../fixtures/fixture-utils.js";

// @req FR-NODE-231 AC-4 — `--diagnostics-limit <n>` on the CLI readers whose JSON goes through
// outputRead. The oracle is the core envelope itself: the CLI must hand n to buildReadEnvelope and
// nothing else, so its diagnostics fields equal the core's for the same workspace and limit.

interface Envelope {
  diagnostics: Diagnostic[];
  errors: Diagnostic[];
  warnings: Diagnostic[];
  diagnosticsSummary: { errors: number; warnings: number };
  diagnosticsTruncation?: { total: number; returned: number; limit: number };
}

let root: string;
let allDiagnostics: Diagnostic[];
let requirementId: string;

async function run(argv: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  const streams = { stdout: new PassThrough(), stderr: new PassThrough() };
  const code = await main(["--root", root, ...argv], streams);
  return { code, stdout: streams.stdout.read()?.toString() ?? "", stderr: streams.stderr.read()?.toString() ?? "" };
}

function diagnosticFields(value: Envelope): Partial<Envelope> {
  const { diagnostics, errors, warnings, diagnosticsSummary, diagnosticsTruncation } = value;
  return { diagnostics, errors, warnings, diagnosticsSummary, ...(diagnosticsTruncation ? { diagnosticsTruncation } : {}) };
}

beforeAll(async () => {
  root = await copyFixtureWorkspace("problem-matrix");
  const workspace = await parseWorkspace(await resolveProjectRoot(process.cwd(), root));
  allDiagnostics = [...workspace.diagnostics, ...validateWorkspace(workspace).diagnostics];
  requirementId = workspace.records[0]?.id ?? "";
  expect(allDiagnostics.length, "the fixture must hold more diagnostics than the limits used here").toBeGreaterThan(10);
});

function coreEnvelope(limit?: number): Partial<Envelope> {
  return diagnosticFields(
    buildReadEnvelope({ diagnostics: allDiagnostics } as never, {}, allDiagnostics, limit === undefined ? {} : { diagnosticsLimit: limit }) as unknown as Envelope
  );
}

const READERS: Array<{ name: string; argv: () => string[] }> = [
  { name: "list", argv: () => ["list"] },
  { name: "show", argv: () => ["show", requirementId] },
  { name: "search", argv: () => ["search", "requirement"] },
  { name: "summary", argv: () => ["summary"] },
  { name: "extract", argv: () => ["extract"] },
  { name: "targets", argv: () => ["targets"] },
  { name: "active-target", argv: () => ["active-target"] },
  { name: "completed-work", argv: () => ["completed-work"] },
  { name: "completed-work-migration-plan", argv: () => ["completed-work-migration-plan"] },
  { name: "scopes", argv: () => ["scopes"] },
  { name: "changed-since", argv: () => ["changed-since", "2000-01-01"] },
  { name: "stale", argv: () => ["stale"] },
  { name: "links check", argv: () => ["links", "check"] }
];

describe("FR-NODE-231 AC-4 — --diagnostics-limit on the outputRead readers", () => {
  // @req FR-NODE-231 AC-4
  it.each(READERS)("$name passes a positive n to buildReadEnvelope as the entry limit", async ({ argv }) => {
    const result = await run([...argv(), "--json", "--diagnostics-limit", "3"]);
    expect(result.code, result.stdout.slice(0, 300) + result.stderr).not.toBe(2);
    const value = JSON.parse(result.stdout) as Envelope;
    expect(diagnosticFields(value)).toEqual(coreEnvelope(3));
    expect(value.diagnostics).toHaveLength(3);
    expect(value.diagnosticsTruncation).toMatchObject({ returned: 3, limit: 3 });
    expect(value.diagnosticsTruncation?.total).toBeGreaterThan(3);
  });

  // @req FR-NODE-231 AC-4
  it("leaves the output unbounded without the flag", async () => {
    const value = JSON.parse((await run(["list", "--json"])).stdout) as Envelope;
    expect(diagnosticFields(value)).toEqual(coreEnvelope());
    expect(value.diagnosticsTruncation).toBeUndefined();
  });

  // @req FR-NODE-231 AC-4
  it.each(["0", "-1", "1.5", "abc", ""])("refuses n = %j with a USAGE error and prints no read value", async (n) => {
    const json = await run(["list", "--json", "--diagnostics-limit", n]);
    expect(json.code).toBe(2);
    const parsed = JSON.parse(json.stdout) as { ok?: boolean; error?: { code: string }; records?: unknown; diagnostics?: unknown[] };
    expect(parsed.ok).toBe(false);
    expect(parsed.error?.code).toMatch(/USAGE/);
    expect(parsed.records).toBeUndefined();

    const human = await run(["show", requirementId, "--diagnostics-limit", n]);
    expect(human.code).toBe(2);
    expect(human.stdout).toBe("");
  });
});
