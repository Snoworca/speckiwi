import { writeFile } from "node:fs/promises";
import path from "node:path";
import { PassThrough } from "node:stream";
import { afterAll, describe, expect, it, vi } from "vitest";
import { main } from "../../src/cli/index.js";
import { createMcpServer } from "../../src/mcp/server.js";
import type { ReadinessDiagnostic, SpecRequirementRecord, SpecTargetSummary } from "../../src/core/orchestrator/readiness.js";
import { content, mcpPayload, record, TARGET } from "../core/orchestrator/support/readiness-fixture.js";
import { cleanupFixtures, gitWorkspaceRepo, rawGit } from "../mcp/support/workspace-root-fixture.js";

// @req FR-NODE-298 — a requirement-not-ready refusal names why the snapshot was judged invalid.
//
// SSO-run-close-4908 (2026-11-11): a verified requirement came back with all four flags not ready and
// the session concluded `verified` was the cause. The four values are what an invalid snapshot
// produces, and the refusal named nothing.

vi.setConfig({ testTimeout: 60_000 });

afterAll(async () => {
  await cleanupFixtures();
});

interface Cause {
  cause: string;
  fields?: string[];
  code?: string;
  count?: number;
  message?: string;
}

interface Entry {
  id: string;
  hardDependenciesSatisfied: boolean;
  lifecycleReady: boolean;
  evidenceDrift: boolean;
  ownershipVerified: boolean;
  invalidBecause?: Cause[];
}

/** A git-initialised directory checked to be its own top level; readiness reads only the snapshot under it. */
async function root(): Promise<string> {
  const directory = await gitWorkspaceRepo("fr-node-298-");
  expect(path.resolve(await rawGit(directory, "rev-parse", "--show-toplevel"))).toBe(path.resolve(directory));
  return directory;
}

async function check(
  records: readonly SpecRequirementRecord[],
  diagnostics: readonly ReadinessDiagnostic[] = [],
  summary?: Partial<SpecTargetSummary>,
  ids: readonly string[] = ["FR-A-001"]
): Promise<{ exit: number; payload: { ok?: boolean; gate?: string; violations?: Entry[]; readiness?: unknown } }> {
  const directory = await root();
  await writeFile(path.join(directory, "snapshot.json"), JSON.stringify(mcpPayload(content(records, diagnostics, summary))));
  const streams = { stdout: new PassThrough(), stderr: new PassThrough() };
  const exit = await main(
    ["--root", directory, "orchestrate", "readiness", "check", "--target", TARGET, "--snapshot", "snapshot.json", ...ids.flatMap((id) => ["--req", id]), "--json"],
    streams
  );
  return { exit, payload: JSON.parse(streams.stdout.read()?.toString() ?? "{}") };
}

function entry(payload: { violations?: Entry[] }, id = "FR-A-001"): Entry {
  const found = payload.violations?.find((item) => item.id === id);
  if (!found) throw new Error(`no refused entry for ${id}: ${JSON.stringify(payload)}`);
  return found;
}

const VERIFIED = record({ id: "FR-A-001", status: "verified", filePath: "docs/spec/a.srs.md", headingLine: 10, blockEndLine: 40 });
const OTHER = record({ id: "FR-A-002", status: "implemented", filePath: "docs/spec/a.srs.md", headingLine: 50, blockEndLine: 80 });

describe("FR-NODE-298 AC-1 — a summary that disagrees with the records is named field by field", () => {
  it("names `total` and `countsByStatus` when the records were filtered and the summary was not", async () => {
    const { exit, payload } = await check([VERIFIED], [], { total: 7, countsByStatus: { verified: 3, implemented: 4 } });
    expect(exit).toBe(2);
    expect(payload.gate).toBe("requirement-not-ready");
    const refused = entry(payload);
    expect([refused.hardDependenciesSatisfied, refused.lifecycleReady, refused.evidenceDrift, refused.ownershipVerified]).toEqual([false, false, true, false]);
    const causes = refused.invalidBecause ?? [];
    expect(causes.map((item) => item.cause)).toEqual(["summary-contradicts-records"]);
    expect(causes[0]?.fields).toEqual(["total", "countsByStatus"]);
  });

  it("names the target when the summary is another target's", async () => {
    const { payload } = await check([VERIFIED], [], { target: "another-target" });
    expect(entry(payload).invalidBecause?.[0]?.fields).toEqual(["target"]);
  });

  it("names the warning count when the summary counts warnings the snapshot does not carry", async () => {
    const { payload } = await check([VERIFIED], [], { diagnosticsSummary: { errors: 0, warnings: 140 } });
    expect(entry(payload).invalidBecause?.[0]?.fields).toEqual(["diagnosticsSummary.warnings"]);
  });
});

describe("FR-NODE-298 AC-2 — error diagnostics and unowned warnings are named by code, with a count and the first message", () => {
  it("groups two errors of one code and one unowned warning", async () => {
    const diagnostics: ReadinessDiagnostic[] = [
      { code: "SRS-E002", severity: "error", message: "Duplicate requirement ID: FR-X-001" },
      { code: "SRS-E002", severity: "error", message: "Duplicate requirement ID: FR-X-002" },
      { code: "SRS-W055", severity: "warning", message: "an index warning no block owns" }
    ];
    const { payload } = await check([VERIFIED], diagnostics);
    expect(entry(payload).invalidBecause).toEqual([
      { cause: "error-diagnostic", code: "SRS-E002", count: 2, message: "Duplicate requirement ID: FR-X-001" },
      { cause: "unowned-warning", code: "SRS-W055", count: 1, message: "an index warning no block owns" }
    ]);
  });
});

describe("FR-NODE-298 AC-3 — a warning on one requirement is named on that requirement only", () => {
  it("puts the owned warning on its owner and nothing on the other requirement", async () => {
    const diagnostics: ReadinessDiagnostic[] = [
      { code: "SRS-W023", severity: "warning", message: "Draft-ish warning", filePath: "docs/spec/a.srs.md", line: 12 },
      { code: "SRS-W023", severity: "warning", message: "Second warning on the same block", requirementId: "FR-A-001" }
    ];
    const { payload } = await check([VERIFIED, OTHER], diagnostics, undefined, ["FR-A-001", "FR-A-002"]);
    expect(entry(payload).invalidBecause).toEqual([
      { cause: "requirement-warning", code: "SRS-W023", count: 2, message: "Draft-ish warning" }
    ]);
    expect(payload.violations?.some((item) => item.id === "FR-A-002")).toBe(false);
  });
});

describe("FR-NODE-298 AC-4 — causes and flags come from one judgement", () => {
  it("carries no cause on an entry refused from a valid snapshot", async () => {
    const draft = record({ id: "FR-A-001", status: "implemented", stability: "draft" });
    const { payload } = await check([draft]);
    expect(payload.gate).toBe("requirement-not-ready");
    expect(entry(payload)).not.toHaveProperty("invalidBecause");
  });

  it("keeps a ready result's shape", async () => {
    const { exit, payload } = await check([VERIFIED]);
    expect(exit).toBe(0);
    expect(JSON.stringify(payload.readiness)).not.toContain("invalidBecause");
  });
});

describe("FR-NODE-298 AC-5 — MCP gives the same causes", () => {
  it("orchestrate_readiness_check names the contradicting fields", async () => {
    const directory = await root();
    await writeFile(path.join(directory, "snapshot.json"), JSON.stringify(mcpPayload(content([VERIFIED], [], { total: 7 }))));
    const answer = (await createMcpServer({ root: directory }).callTool("orchestrate_readiness_check", {
      target: TARGET,
      snapshot: "snapshot.json",
      req: ["FR-A-001"]
    })) as Record<string, unknown>;
    expect(JSON.stringify(answer)).toContain("\"cause\":\"summary-contradicts-records\"");
    expect(JSON.stringify(answer)).toContain("\"fields\":[\"total\"]");
  });
});
