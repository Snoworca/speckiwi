import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import {
  deriveCanonicalRequirementReadiness,
  parseRequirementSnapshot,
  type DerivedRequirementReadiness,
  type ReadinessDiagnostic,
  type SpecRequirementRecord,
  type SpecTargetSummary
} from "../../../src/core/orchestrator/readiness.js";
import { recordHarvestCwd } from "./support/harvest-cwd.js";
import { cliPayload, content, dependsOn, mcpPayload, OTHER_TARGET, record, TARGET } from "./support/readiness-fixture.js";

recordHarvestCwd("HV-3");

const execFileAsync = promisify(execFile);
const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..", "..");
const READINESS_SOURCE = path.join(REPO_ROOT, "src", "core", "orchestrator", "readiness.ts");

type DerivedField = "hardDependenciesSatisfied" | "evidenceDrift" | "ownershipVerified";
type FailClosedClass = "dependency-cycle" | "duplicate-requirement-id" | "summary-contradiction";

interface ReadinessCase {
  readonly name: string;
  readonly covers: readonly DerivedField[];
  readonly failsClosedOn?: FailClosedClass;
  readonly records: readonly SpecRequirementRecord[];
  readonly diagnostics?: readonly ReadinessDiagnostic[];
  readonly summaryOverride?: Partial<SpecTargetSummary>;
  readonly requirementIds: readonly string[];
  readonly expect?: (rows: DerivedRequirementReadiness[]) => void;
  readonly throws?: RegExp;
}

function row(rows: DerivedRequirementReadiness[], id: string): DerivedRequirementReadiness {
  const found = rows.find((entry) => entry.id === id);
  if (!found) throw new Error(`no derived readiness row for ${id}`);
  return found;
}

function expectReady(rows: DerivedRequirementReadiness[], id: string): void {
  expect(row(rows, id)).toMatchObject({
    id,
    hardDependenciesSatisfied: true,
    evidenceDrift: false,
    ownershipVerified: true
  });
}

const READY_EVIDENCE = [{ id: "EV-1", type: "test", covers: "all", reference: "test/example.test.ts" }];

/**
 * @req FR-NODE-103 AC-1 — all 15 behavioural readiness cases. The count is load-bearing: the
 * requirement names fifteen, this table is what the suite iterates, and its length is asserted.
 */
const READINESS_CASES: readonly ReadinessCase[] = [
  {
    name: "01 ignores caller-injected readiness attestation fields",
    covers: ["hardDependenciesSatisfied", "evidenceDrift", "ownershipVerified"],
    records: [
      {
        ...record({ id: "FR-A-001", status: "implemented", verificationEvidence: [] }),
        // A caller cannot self-attest: these extra properties are on the raw record and must be
        // ignored entirely (`06:162`).
        hardDependenciesSatisfied: true,
        evidenceDrift: false,
        ownershipVerified: true
      } as unknown as SpecRequirementRecord
    ],
    requirementIds: ["FR-A-001"],
    expect: (rows) => {
      expect(row(rows, "FR-A-001")).toEqual({
        id: "FR-A-001",
        target: TARGET,
        status: "implemented",
        stability: "stable",
        hardDependenciesSatisfied: true,
        evidenceDrift: true,
        ownershipVerified: true
      });
    }
  },
  {
    name: "02 accepts an allowlisted dependency but requires an unallowlisted one to be completed",
    covers: ["hardDependenciesSatisfied"],
    records: [
      record({ id: "FR-A-002", status: "planned", traceLinks: dependsOn("FR-A-003"), verificationEvidence: [] }),
      record({ id: "FR-A-003", status: "planned", verificationEvidence: [] })
    ],
    requirementIds: ["FR-A-002", "FR-A-003"],
    expect: (rows) => {
      expect(row(rows, "FR-A-002").hardDependenciesSatisfied).toBe(true);
      expect(row(rows, "FR-A-003").hardDependenciesSatisfied).toBe(true);
    }
  },
  {
    name: "03 refuses a dependency that is neither implemented nor verified outside the allowlist",
    covers: ["hardDependenciesSatisfied"],
    records: [
      record({ id: "FR-A-004", status: "planned", traceLinks: dependsOn("FR-A-005"), verificationEvidence: [] }),
      record({ id: "FR-A-005", status: "planned", verificationEvidence: [] })
    ],
    requirementIds: ["FR-A-004"],
    expect: (rows) => {
      expect(rows).toHaveLength(1);
      expect(row(rows, "FR-A-004").hardDependenciesSatisfied).toBe(false);
    }
  },
  {
    name: "04 fails closed on a cyclic hard-dependency graph",
    covers: ["hardDependenciesSatisfied"],
    failsClosedOn: "dependency-cycle",
    records: [
      record({ id: "FR-A-006", status: "planned", traceLinks: dependsOn("FR-A-007"), verificationEvidence: [] }),
      record({ id: "FR-A-007", status: "planned", traceLinks: dependsOn("FR-A-006"), verificationEvidence: [] })
    ],
    requirementIds: ["FR-A-006", "FR-A-007"],
    expect: (rows) => {
      expect(rows.map((entry) => entry.hardDependenciesSatisfied)).toEqual([false, false]);
    }
  },
  {
    name: "05 refuses a requirement whose own stability is draft or deprecated",
    covers: ["hardDependenciesSatisfied"],
    records: [
      record({ id: "FR-A-008", status: "planned", stability: "draft", verificationEvidence: [] }),
      record({ id: "FR-A-009", status: "planned", stability: "deprecated", verificationEvidence: [] })
    ],
    requirementIds: ["FR-A-008", "FR-A-009"],
    expect: (rows) => {
      expect(row(rows, "FR-A-008").hardDependenciesSatisfied).toBe(false);
      expect(row(rows, "FR-A-009").hardDependenciesSatisfied).toBe(false);
    }
  },
  {
    name: "06 does not block on the Completed Work Log SRS-W015 warning",
    covers: ["hardDependenciesSatisfied", "evidenceDrift", "ownershipVerified"],
    records: [record({ id: "FR-A-010", verificationEvidence: READY_EVIDENCE })],
    diagnostics: [{
      code: "SRS-W015",
      severity: "warning",
      message: "Completed Work Log requirement is not completed: FR-A-010",
      requirementId: "FR-A-010"
    }],
    requirementIds: ["FR-A-010"],
    expect: (rows) => expectReady(rows, "FR-A-010")
  },
  {
    name: "07 fails closed on a non-W015 warning attributed to the owned requirement",
    covers: ["hardDependenciesSatisfied", "evidenceDrift", "ownershipVerified"],
    records: [record({ id: "FR-A-011", verificationEvidence: READY_EVIDENCE })],
    diagnostics: [{
      code: "SRS-W011",
      severity: "warning",
      message: "Verification Evidence row is malformed",
      requirementId: "FR-A-011"
    }],
    requirementIds: ["FR-A-011"],
    expect: (rows) => {
      expect(row(rows, "FR-A-011")).toMatchObject({
        hardDependenciesSatisfied: false,
        evidenceDrift: true,
        ownershipVerified: false
      });
    }
  },
  {
    name: "08 does not let an unrelated located warning expand the exact allowlist",
    covers: ["hardDependenciesSatisfied", "evidenceDrift", "ownershipVerified"],
    records: [
      record({
        id: "FR-A-012",
        verificationEvidence: READY_EVIDENCE,
        filePath: "docs/spec/50.nodejs-implementation.srs.md",
        headingLine: 100,
        blockEndLine: 150
      }),
      record({
        id: "FR-A-013",
        verificationEvidence: READY_EVIDENCE,
        filePath: "docs/spec/50.nodejs-implementation.srs.md",
        headingLine: 200,
        blockEndLine: 250
      })
    ],
    diagnostics: [{
      code: "SRS-W012",
      severity: "warning",
      message: "Completed Work Log history row is stale",
      filePath: "docs/spec/50.nodejs-implementation.srs.md",
      line: 210
    }],
    requirementIds: ["FR-A-012"],
    expect: (rows) => expectReady(rows, "FR-A-012")
  },
  {
    name: "09 blocks a warning located inside the owned requirement's own source block",
    covers: ["hardDependenciesSatisfied", "evidenceDrift", "ownershipVerified"],
    records: [record({
      id: "FR-A-014",
      verificationEvidence: READY_EVIDENCE,
      filePath: "docs/spec/50.nodejs-implementation.srs.md",
      headingLine: 300,
      blockEndLine: 360
    })],
    diagnostics: [{
      code: "SRS-W012",
      severity: "warning",
      message: "Completed Work Log history row is stale",
      filePath: "./docs/spec/50.nodejs-implementation.srs.md",
      line: 320
    }],
    requirementIds: ["FR-A-014"],
    expect: (rows) => {
      expect(row(rows, "FR-A-014")).toMatchObject({
        hardDependenciesSatisfied: false,
        evidenceDrift: true,
        ownershipVerified: false
      });
    }
  },
  {
    name: "10 fails closed when explicit and located diagnostic ownership contradict",
    covers: [],
    records: [record({
      id: "FR-A-015",
      verificationEvidence: READY_EVIDENCE,
      filePath: "docs/spec/50.nodejs-implementation.srs.md",
      headingLine: 400,
      blockEndLine: 460
    })],
    diagnostics: [{
      code: "SRS-W011",
      severity: "warning",
      message: "ownership contradiction",
      requirementId: "FR-A-999",
      filePath: "docs/spec/50.nodejs-implementation.srs.md",
      line: 420
    }],
    requirementIds: ["FR-A-015"],
    throws: /contradictory Requirement ownership/u
  },
  {
    name: "11 blocks readiness when a warning belongs to a transitive hard dependency",
    covers: ["hardDependenciesSatisfied"],
    records: [
      record({ id: "FR-A-016", verificationEvidence: READY_EVIDENCE, traceLinks: dependsOn("FR-A-017") }),
      record({ id: "FR-A-017", verificationEvidence: READY_EVIDENCE, traceLinks: dependsOn("FR-A-018") }),
      record({ id: "FR-A-018", verificationEvidence: READY_EVIDENCE })
    ],
    diagnostics: [{
      code: "SRS-W011",
      severity: "warning",
      message: "transitive dependency warning",
      requirementId: "FR-A-018"
    }],
    requirementIds: ["FR-A-016"],
    expect: (rows) => {
      expect(row(rows, "FR-A-016").hardDependenciesSatisfied).toBe(false);
      expect(row(rows, "FR-A-016").ownershipVerified).toBe(true);
    }
  },
  {
    name: "12 reports evidence drift for completed records without covering evidence",
    covers: ["evidenceDrift"],
    records: [
      record({ id: "FR-A-019", status: "implemented", verificationEvidence: [] }),
      record({
        id: "FR-A-020",
        status: "verified",
        acceptanceCriteria: [{ id: "AC-1", checked: true }, { id: "AC-2", checked: true }],
        verificationEvidence: [{ id: "EV-1", type: "test", covers: "AC-1", reference: "test/example.test.ts" }]
      }),
      record({
        id: "FR-A-021",
        status: "verified",
        acceptanceCriteria: [{ id: "AC-1", checked: false }],
        verificationEvidence: READY_EVIDENCE
      })
    ],
    requirementIds: ["FR-A-019", "FR-A-020", "FR-A-021"],
    expect: (rows) => {
      expect(rows.map((entry) => entry.evidenceDrift)).toEqual([true, true, true]);
    }
  },
  {
    name: "13 still fails closed when stale evidence is appended after the newest all-AC proof",
    covers: ["evidenceDrift"],
    records: [record({
      id: "FR-A-022",
      status: "verified",
      acceptanceCriteria: [{ id: "AC-1", checked: true }],
      verificationEvidence: [
        { id: "EV-1", type: "test", covers: "all", reference: "test/example.test.ts" },
        { id: "EV-2", type: "test", covers: "AC-9", reference: "test/example.test.ts" }
      ]
    })],
    requirementIds: ["FR-A-022"],
    expect: (rows) => {
      expect(row(rows, "FR-A-022").evidenceDrift).toBe(true);
    }
  },
  {
    name: "14 fails closed on a target summary that contradicts the records",
    covers: ["hardDependenciesSatisfied", "evidenceDrift", "ownershipVerified"],
    failsClosedOn: "summary-contradiction",
    records: [record({ id: "FR-A-023", verificationEvidence: READY_EVIDENCE })],
    summaryOverride: { total: 99 },
    requirementIds: ["FR-A-023"],
    expect: (rows) => {
      expect(row(rows, "FR-A-023")).toMatchObject({
        hardDependenciesSatisfied: false,
        evidenceDrift: true,
        ownershipVerified: false
      });
    }
  },
  {
    name: "15 refuses a duplicate requirement id even when one occurrence looks ready",
    covers: ["ownershipVerified"],
    failsClosedOn: "duplicate-requirement-id",
    records: [
      record({ id: "FR-A-024", verificationEvidence: READY_EVIDENCE }),
      record({ id: "FR-A-024", target: OTHER_TARGET, status: "planned", verificationEvidence: [] })
    ],
    requirementIds: ["FR-A-024"],
    expect: (rows) => {
      expect(rows).toHaveLength(1);
      expect(row(rows, "FR-A-024").ownershipVerified).toBe(false);
    }
  }
];

describe("FR-NODE-103 readiness harvest over a speckiwi list --json snapshot", { timeout: 120_000 }, () => {
  it("AC-1: names exactly 15 behavioural readiness cases", () => {
    expect(READINESS_CASES).toHaveLength(15);
    expect(new Set(READINESS_CASES.map((entry) => entry.name)).size).toBe(15);
  });

  it.each(READINESS_CASES)("AC-1: $name, over a speckiwi list --json snapshot", (testCase) => {
    const built = content(testCase.records, testCase.diagnostics ?? [], testCase.summaryOverride);
    const snapshot = parseRequirementSnapshot(cliPayload(built));

    if (testCase.throws) {
      expect(() => deriveCanonicalRequirementReadiness(snapshot, TARGET, testCase.requirementIds))
        .toThrow(testCase.throws);
      return;
    }
    const rows = deriveCanonicalRequirementReadiness(snapshot, TARGET, testCase.requirementIds);
    testCase.expect!(rows);
  });

  it("AC-4: each derived field is covered by at least one of the 15 cases", () => {
    const covered = new Set(READINESS_CASES.flatMap((entry) => entry.covers));
    expect([...covered].sort()).toEqual(["evidenceDrift", "hardDependenciesSatisfied", "ownershipVerified"]);
  });

  it("AC-5: the three fail-closed classes are each covered by exactly one of the 15 cases", () => {
    const classes = READINESS_CASES.flatMap((entry) => entry.failsClosedOn ? [entry.failsClosedOn] : []);
    expect(classes.sort()).toEqual(["dependency-cycle", "duplicate-requirement-id", "summary-contradiction"]);
  });

  it("AC-4: readiness is derived from the raw records, so the summary cannot make a record ready", () => {
    const drifting = record({ id: "FR-A-030", status: "implemented", verificationEvidence: [] });
    const honest = parseRequirementSnapshot(cliPayload(content([drifting])));
    expect(deriveCanonicalRequirementReadiness(honest, TARGET, ["FR-A-030"])[0]?.evidenceDrift).toBe(true);

    // The only lever a caller has over the summary is to contradict the records, and that is
    // fail-closed rather than a way to claim readiness.
    const flattering = parseRequirementSnapshot(cliPayload(content([drifting], [], { missingEvidence: [] })));
    expect(deriveCanonicalRequirementReadiness(flattering, TARGET, ["FR-A-030"])[0]).toMatchObject({
      evidenceDrift: true,
      ownershipVerified: false
    });
  });

  it("AC-2: performs no I/O — the module's import graph reaches no node builtin and no MCP client", async () => {
    const source = await readFile(READINESS_SOURCE, "utf8");
    expect(source).toContain("deriveCanonicalRequirementReadiness");
    expect(source).not.toMatch(/from\s+"node:/u);
    expect(source).not.toMatch(/\brequire\(/u);
    expect(source).not.toMatch(/\bDate\.now\(\)/u);
    expect(source).not.toMatch(/\bfetch\(/u);

    const localImports = [...source.matchAll(/from\s+"(\.[^"]+)"/gmu)].map((match) => match[1]!);
    expect(localImports).toEqual(["../types.js"]);
  });

  it("AC-3: carries no per-root MCP transport from wave-spec-client.ts", async () => {
    const source = await readFile(READINESS_SOURCE, "utf8");
    expect(source).toContain("scopeRequirementDiagnostics");
    expect(source).not.toContain("createMcpCwdBoundSpecClient");
    expect(source).not.toContain("wave-spec-client");
    expect(source).not.toContain("StdioClientTransport");
    expect(source).not.toContain("modelcontextprotocol");
  });

  it("AC-1: parses a real speckiwi list --json snapshot taken through the CLI, with no MCP call", async () => {
    const fields = [
      "id", "target", "status", "stability", "filePath", "headingLine", "blockEndLine",
      "acceptanceCriteria", "verificationEvidence", "traceLinks"
    ].join(",");
    const listArgs = ["bin/speckiwi", "list", "--target", TARGET, "--fields", fields, "--json"];
    const summaryArgs = ["bin/speckiwi", "summary", "--target", TARGET, "--json"];
    expect(listArgs.join(" ")).not.toContain("mcp");
    expect(summaryArgs.join(" ")).not.toContain("mcp");

    const listRun = await execFileAsync(process.execPath, listArgs, {
      cwd: REPO_ROOT,
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
      windowsHide: true
    });
    const summaryRun = await execFileAsync(process.execPath, summaryArgs, {
      cwd: REPO_ROOT,
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
      windowsHide: true
    });

    const list = JSON.parse(listRun.stdout) as { records: { id: string }[] };
    const summary = JSON.parse(summaryRun.stdout) as Record<string, unknown>;
    expect(list.records.length).toBeGreaterThan(0);

    const snapshot = parseRequirementSnapshot({
      transport: "speckiwi-list-json",
      target: TARGET,
      list: list as unknown as Record<string, unknown>,
      summary
    });
    expect(snapshot.records.length).toBe(list.records.length);
    expect(snapshot.summary.target).toBe(TARGET);

    const requested = list.records.slice(0, 3).map((entry) => entry.id);
    const rows = deriveCanonicalRequirementReadiness(snapshot, TARGET, requested);
    expect(rows.map((entry) => entry.id)).toEqual(requested);
    for (const entry of rows) {
      expect(typeof entry.hardDependenciesSatisfied).toBe("boolean");
      expect(typeof entry.evidenceDrift).toBe("boolean");
      expect(typeof entry.ownershipVerified).toBe("boolean");
    }

    // The 15 synthetic cases are only meaningful if they carry the fields the real CLI emits.
    const realKeys = new Set(Object.keys(list.records[0]!));
    for (const key of ["id", "target", "status", "stability", "acceptanceCriteria", "verificationEvidence", "traceLinks"]) {
      expect(realKeys.has(key)).toBe(true);
    }
  });

  it("AC-1: the same content through the MCP envelope yields the identical snapshot and result", () => {
    const built = content([
      record({ id: "FR-A-040", verificationEvidence: READY_EVIDENCE, traceLinks: dependsOn("FR-A-041") }),
      record({ id: "FR-A-041", verificationEvidence: READY_EVIDENCE })
    ]);
    const fromCli = parseRequirementSnapshot(cliPayload(built));
    const fromMcp = parseRequirementSnapshot(mcpPayload(built));
    expect(fromMcp).toEqual(fromCli);
    expect(deriveCanonicalRequirementReadiness(fromMcp, TARGET, ["FR-A-040"]))
      .toEqual(deriveCanonicalRequirementReadiness(fromCli, TARGET, ["FR-A-040"]));
  });
});
