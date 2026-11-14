import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";
import {
  assertRequirementsReady,
  parseRequirementSnapshot,
  RequirementNotReadyError,
  type NotReadyRequirement,
  type SnapshotPayload
} from "../../../src/core/orchestrator/readiness.js";
import { createMcpServer } from "../../../src/mcp/server.js";
import { cleanupFixtures, gitWorkspaceRepo, rawGit } from "../../mcp/support/workspace-root-fixture.js";
import { cliPayload, content, mcpPayload, record, TARGET } from "./support/readiness-fixture.js";

// @req FR-NODE-308 — MCP reads bound diagnostics to 20 by default, so a readiness snapshot built from
// list_requirements on an SRS with 21 warnings was refused as a summary contradiction on
// diagnosticsSummary.warnings. The truncation is its own cause now, and the skill asks for every entry.

vi.setConfig({ testTimeout: 120_000 });

afterAll(async () => {
  await cleanupFixtures();
});

const EVIDENCE = [{ id: "EV-1", type: "test", covers: "all", reference: "test/example.test.ts" }];
const READY = record({ id: "FR-A-001", verificationEvidence: EVIDENCE });
const WARNINGS = Array.from({ length: 20 }, (_, index) => ({ code: "SRS-W083", severity: "warning" as const, message: `FR-B-001 AC-${index + 1} is long`, requirementId: "FR-B-001" }));
const TRUNCATION = { total: 21, returned: 20, limit: 20 };

function refusal(run: () => unknown): NotReadyRequirement[] {
  try {
    run();
  } catch (error) {
    if (error instanceof RequirementNotReadyError) return [...error.notReady];
    throw error;
  }
  throw new Error("readiness did not refuse");
}

/** A snapshot whose summary counts one warning more than its list holds, as a bounded read gives it. */
function shortened(extra: Record<string, unknown> = {}) {
  const built = content([READY], WARNINGS);
  return { ...built, summary: { ...built.summary, diagnosticsSummary: { ...built.summary.diagnosticsSummary, warnings: 21 } }, ...extra };
}

describe("FR-NODE-308 AC-1 — a snapshot marked truncated is refused for the truncation", () => {
  // @req FR-NODE-308 AC-1
  it("FR-NODE-308 AC-1: an MCP snapshot with a top-level diagnosticsTruncation gives diagnostics-truncated with the counts and the remedy", () => {
    const built = shortened();
    const snapshot = parseRequirementSnapshot({ ...mcpPayload(built), diagnosticsTruncation: TRUNCATION } as never);
    const [entry] = refusal(() => assertRequirementsReady(snapshot, TARGET, ["FR-A-001"]));
    expect(entry?.id).toBe("FR-A-001");
    expect(entry?.invalidBecause).toEqual([
      expect.objectContaining({ cause: "diagnostics-truncated", total: 21, returned: 20, limit: 20, message: expect.stringContaining("includeAllDiagnostics: true") })
    ]);
  });

  // @req FR-NODE-308 AC-1
  it("FR-NODE-308 AC-1: a CLI snapshot with list.diagnosticsTruncation gives the same cause", () => {
    const payload = cliPayload(shortened()) as Extract<SnapshotPayload, { transport: "speckiwi-list-json" }>;
    const snapshot = parseRequirementSnapshot({ ...payload, list: { ...payload.list, diagnosticsTruncation: TRUNCATION } } as never);
    const [entry] = refusal(() => assertRequirementsReady(snapshot, TARGET, ["FR-A-001"]));
    expect(entry?.invalidBecause?.map((cause) => cause.cause)).toEqual(["diagnostics-truncated"]);
  });
});

describe("FR-NODE-308 AC-2 — the diagnostics counts are not compared, the other summary fields are", () => {
  // @req FR-NODE-308 AC-2
  it("FR-NODE-308 AC-2: a truncated snapshot whose total also disagrees lists only total as a contradiction", () => {
    const built = shortened();
    const snapshot = parseRequirementSnapshot({ ...mcpPayload({ ...built, summary: { ...built.summary, total: 9 } }), diagnosticsTruncation: TRUNCATION } as never);
    const [entry] = refusal(() => assertRequirementsReady(snapshot, TARGET, ["FR-A-001"]));
    const causes = entry?.invalidBecause ?? [];
    expect(causes.map((cause) => cause.cause).sort()).toEqual(["diagnostics-truncated", "summary-contradicts-records"]);
    expect(causes.find((cause) => cause.cause === "summary-contradicts-records")?.fields).toEqual(["total"]);
  });
});

describe("FR-NODE-308 AC-2 — the errors count of a truncated snapshot is not compared either", () => {
  // @req FR-NODE-308 AC-2
  it("FR-NODE-308 AC-2: a list bounded to 20 of 21 errors gives no summary-contradicts-records", () => {
    const errors = Array.from({ length: 20 }, (_, index) => ({ code: "SRS-E006", severity: "error" as const, message: `error ${index + 1}` }));
    const built = content([READY], errors);
    const summary = { ...built.summary, diagnosticsSummary: { ...built.summary.diagnosticsSummary, errors: 21 } };
    const snapshot = parseRequirementSnapshot({ ...mcpPayload({ ...built, summary }), diagnosticsTruncation: { total: 21, returned: 20, limit: 20 } } as never);
    const [entry] = refusal(() => assertRequirementsReady(snapshot, TARGET, ["FR-A-001"]));
    expect(entry?.invalidBecause?.map((cause) => cause.cause)).toEqual(["diagnostics-truncated", "error-diagnostic"]);
  });
});

describe("FR-NODE-308 AC-3 — without a descriptor the shortened list is still a contradiction", () => {
  // @req FR-NODE-308 AC-3
  it("FR-NODE-308 AC-3: no diagnosticsTruncation keeps summary-contradicts-records on diagnosticsSummary.warnings", () => {
    const snapshot = parseRequirementSnapshot(mcpPayload(shortened()) as never);
    const [entry] = refusal(() => assertRequirementsReady(snapshot, TARGET, ["FR-A-001"]));
    expect(entry?.invalidBecause).toEqual([{ cause: "summary-contradicts-records", fields: ["diagnosticsSummary.warnings"] }]);
  });
});

describe("FR-NODE-308 AC-4 — a snapshot built through MCP on an SRS with 21 warnings", () => {
  const SCOPE = path.join("docs", "spec", "10.product-architecture.srs.md");
  const LONG = (n: number) => `- [ ] AC-${n}: ${"w".repeat(4001)}`;
  const NOISY = [
    "",
    "### FR-ARCH-002 — Requirement with long criteria",
    "",
    "| Field | Value |",
    "| --- | --- |",
    "| Type | functional |",
    "| Target | v1.0.0 |",
    "| Status | planned |",
    "| Priority | high |",
    "| Tags | fixture |",
    "| Risk | low |",
    "| Stability | stable |",
    "| Verification Method | test |",
    "| GitHub Issue | - |",
    "| Related Docs | - |",
    "",
    "#### Requirement",
    "",
    "SpecKiwi must carry twenty-one long criteria.",
    "",
    "#### Rationale",
    "",
    "Each criterion raises one SRS-W083.",
    "",
    "#### Acceptance Criteria",
    "",
    ...Array.from({ length: 21 }, (_, index) => LONG(index + 1)),
    "",
    "#### Verification Evidence",
    "",
    "| Evidence ID | Type | Reference | Covers | Notes |",
    "| --- | --- | --- | --- | --- |",
    "",
    "#### Trace Links",
    "",
    "| Type | Reference | Relation | Notes |",
    "| --- | --- | --- | --- |",
    "",
    "#### Change Notes",
    "",
    "| Date | Change | Reason |",
    "| --- | --- | --- |",
    "| 2026-11-14 | Created | Fixture |",
    ""
  ].join("\n");

  type Answer = { ok: boolean; value?: Record<string, unknown>; error?: { code: string; message: string }; violations?: Array<{ id: string; invalidBecause?: Array<{ cause: string }> }> };

  async function workspace(): Promise<string> {
    const root = await gitWorkspaceRepo("fr-node-308-", "mutation-target");
    expect(path.resolve(await rawGit(root, "rev-parse", "--show-toplevel"))).toBe(path.resolve(root));
    const file = path.join(root, SCOPE);
    await writeFile(file, `${(await readFile(file, "utf8")).trimEnd()}\n${NOISY}`, "utf8");
    return root;
  }

  async function readiness(root: string, listArgs: Record<string, unknown>): Promise<Answer> {
    const handle = createMcpServer({ root });
    const list = (await handle.callTool("list_requirements", { target: "v1.0.0", projection: "full", ...listArgs })) as Answer;
    const summary = (await handle.callTool("summarize_target", { target: "v1.0.0" })) as Answer;
    expect(list.ok, JSON.stringify(list.error)).toBe(true);
    expect(summary.ok, JSON.stringify(summary.error)).toBe(true);
    const { records, diagnostics, diagnosticsTruncation } = list.value as Record<string, unknown>;
    const snapshot = { transport: "mcp-list-requirements", target: "v1.0.0", records, diagnostics, ...(diagnosticsTruncation ? { diagnosticsTruncation } : {}), summary: summary.value };
    await writeFile(path.join(root, "snapshot.json"), JSON.stringify(snapshot), "utf8");
    return (await handle.callTool("orchestrate_readiness_check", { target: "v1.0.0", snapshot: "snapshot.json", req: ["FR-ARCH-001"] })) as Answer;
  }

  // @req FR-NODE-308 AC-4
  it("FR-NODE-308 AC-4: default diagnostics give diagnostics-truncated, includeAllDiagnostics gives ready", async () => {
    const root = await workspace();
    const bounded = await readiness(root, {});
    expect(bounded.ok).toBe(false);
    expect(JSON.stringify(bounded)).toContain("requirement-not-ready");
    expect(JSON.stringify(bounded)).toContain("diagnostics-truncated");
    expect(JSON.stringify(bounded)).not.toContain("summary-contradicts-records");

    const complete = await readiness(root, { includeAllDiagnostics: true });
    expect(complete.ok, JSON.stringify(complete)).toBe(true);
  });
});

describe("FR-NODE-308 AC-5 — the skill builds the snapshot from every diagnostic", () => {
  const COPIES = ["skills/claude", "skills/codex", "skills/etc", ".agents/skills"].map((dir) => path.join(dir, "kiwi-orchestrator", "SKILL.md"));

  // @req FR-NODE-308 AC-5
  it.each(COPIES)("FR-NODE-308 AC-5: %s §V.derive-readiness asks for includeAllDiagnostics: true and carries diagnosticsTruncation", async (file) => {
    const text = await readFile(file, "utf8");
    const start = text.indexOf("### §V.derive-readiness");
    const section = text.slice(start, text.indexOf("\n### ", start + 1));
    expect(start).toBeGreaterThan(-1);
    expect(section).toContain("`includeAllDiagnostics: true`");
    expect(section).toContain("`diagnosticsTruncation`");
  });
});
