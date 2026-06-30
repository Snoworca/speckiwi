import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { resolveProjectRoot } from "../../../src/core/project-root.js";
import { parseWorkspace } from "../../../src/core/parser/workspace-parser.js";
import { validateWorkspace } from "../../../src/core/validator/validate-workspace.js";
import { copyFixtureWorkspace } from "../../fixtures/fixture-utils.js";

async function diagnosticCodesForFixture(name: string): Promise<string[]> {
  const workspace = await parseWorkspace(await resolveProjectRoot(await copyFixtureWorkspace(name)));
  return validateWorkspace(workspace).diagnostics.map((diagnostic) => diagnostic.code);
}

interface ExpectedDuplicateOccurrence {
  filePath: string;
  headingLine: number;
  title: string;
  target: string;
  status: string;
  stability?: string;
  marker?: "DISCARDED" | "DRAFT";
}

interface DuplicateOccurrenceDetails {
  filePath?: unknown;
  headingLine?: unknown;
  title?: unknown;
  target?: unknown;
  status?: unknown;
  stability?: unknown;
  marker?: unknown;
  markerState?: unknown;
  blockHash?: unknown;
  blockIdentity?: unknown;
}

interface DuplicateGroupDetails {
  duplicateId?: unknown;
  occurrences?: DuplicateOccurrenceDetails[];
  nextAction?: unknown;
}

function duplicateDiagnosticDetails(diagnostic: unknown): DuplicateGroupDetails | undefined {
  return (diagnostic as { details?: DuplicateGroupDetails }).details;
}

function normalizeOccurrences(occurrences: DuplicateOccurrenceDetails[] = []): DuplicateOccurrenceDetails[] {
  return [...occurrences].sort((left, right) => {
    const leftKey = `${String(left.filePath)}:${Number(left.headingLine)}`;
    const rightKey = `${String(right.filePath)}:${Number(right.headingLine)}`;
    return leftKey.localeCompare(rightKey);
  });
}

function occurrenceMarker(occurrence: DuplicateOccurrenceDetails): unknown {
  return occurrence.marker ?? occurrence.markerState;
}

function occurrenceBlockIdentity(occurrence: DuplicateOccurrenceDetails): unknown {
  return occurrence.blockHash ?? occurrence.blockIdentity;
}

async function expectRelParse003GroupedDuplicateDetails(fixtureName: string, duplicateId: string, markerByTitle: Record<string, "DISCARDED" | "DRAFT"> = {}): Promise<void> {
  const workspace = await parseWorkspace(await resolveProjectRoot(await copyFixtureWorkspace(fixtureName)));
  const result = validateWorkspace(workspace);
  const duplicateDiagnostics = result.diagnostics.filter((diagnostic) => diagnostic.code === "SRS-E002" && diagnostic.message.includes(duplicateId));
  const expectedOccurrences: ExpectedDuplicateOccurrence[] = workspace.records
    .filter((record) => record.id === duplicateId)
    .map((record) => ({
      filePath: record.filePath,
      headingLine: record.headingLine,
      title: record.title,
      target: record.target,
      status: record.status,
      ...(record.stability ? { stability: record.stability } : {}),
      ...(markerByTitle[record.title] ? { marker: markerByTitle[record.title] } : {})
    }))
    .sort((left, right) => `${left.filePath}:${left.headingLine}`.localeCompare(`${right.filePath}:${right.headingLine}`));

  expect(duplicateDiagnostics.length, `REL-PARSE-003 AC-4 expected SRS-E002 for ${duplicateId} in ${fixtureName}`).toBeGreaterThan(0);

  const details = duplicateDiagnosticDetails(duplicateDiagnostics[0]);
  expect(details, `REL-PARSE-003 AC-1/AC-4 requires grouped SRS-E002 details for ${duplicateId}`).toEqual(
    expect.objectContaining({
      duplicateId,
      occurrences: expect.any(Array)
    })
  );

  const occurrences = normalizeOccurrences(details?.occurrences);
  expect(occurrences).toHaveLength(expectedOccurrences.length);

  for (const expectedOccurrence of expectedOccurrences) {
    const occurrence = occurrences.find((candidate) => candidate.filePath === expectedOccurrence.filePath && candidate.headingLine === expectedOccurrence.headingLine);
    expect(occurrence, `REL-PARSE-003 AC-1 missing occurrence ${expectedOccurrence.filePath}:${expectedOccurrence.headingLine}`).toEqual(
      expect.objectContaining({
        filePath: expectedOccurrence.filePath,
        headingLine: expectedOccurrence.headingLine,
        title: expectedOccurrence.title,
        target: expectedOccurrence.target,
        status: expectedOccurrence.status
      })
    );
    if (expectedOccurrence.stability) {
      expect(occurrence?.stability).toBe(expectedOccurrence.stability);
    }
    if (expectedOccurrence.marker) {
      expect(occurrenceMarker(occurrence!)).toBe(expectedOccurrence.marker);
    }
    expect(occurrenceBlockIdentity(occurrence!), `REL-PARSE-003 AC-1 requires stable block identity for ${expectedOccurrence.filePath}:${expectedOccurrence.headingLine}`).toEqual(expect.any(String));
  }

  expect(duplicateDiagnostics).toHaveLength(1);
  expect(details?.nextAction).toEqual(expect.objectContaining({ requiresSelectedOccurrence: true }));
}

async function writeExternalCompletedWork(root: string, reportPath = "docs/reports/external.md"): Promise<void> {
  await writeFile(
    path.join(root, "docs", "spec", "05.completed-work.md"),
    [
      "# Completed Work",
      "",
      "## 1. Completed Work Log",
      "",
      "| Date | Target | Scope | Requirement IDs | Summary | Report Paths |",
      "|---|---|---|---|---|---|",
      `| 2026-06-29 | v1.0.0 | ARCH | FR-ARCH-001 | External work parsed. | ${reportPath} |`
    ].join("\n"),
    "utf8"
  );
}

describe("validation registry", () => {
  it("passes the valid fixture", async () => {
    const workspace = await parseWorkspace(await resolveProjectRoot(await copyFixtureWorkspace("valid-basic")));
    const result = validateWorkspace(workspace);
    expect(result.errors).toHaveLength(0);
  });

  it("detects duplicate IDs, missing metadata, and verified guard failures", async () => {
    const duplicate = validateWorkspace(await parseWorkspace(await resolveProjectRoot(await copyFixtureWorkspace("duplicate-id"))));
    expect(duplicate.diagnostics.map((d) => d.code)).toContain("SRS-E002");

    const missing = validateWorkspace(await parseWorkspace(await resolveProjectRoot(await copyFixtureWorkspace("missing-metadata"))));
    expect(missing.diagnostics.map((d) => d.code)).toContain("SRS-E003");

    const guard = validateWorkspace(await parseWorkspace(await resolveProjectRoot(await copyFixtureWorkspace("verified-guard-failure"))));
    expect(guard.diagnostics.map((d) => d.code)).toContain("SRS-E010");

    const invalid = validateWorkspace(await parseWorkspace(await resolveProjectRoot(await copyFixtureWorkspace("invalid-structure"))));
    expect(invalid.diagnostics.map((d) => d.code)).toContain("SRS-E001");
  });

  it("REL-PARSE-003 AC-4 reports grouped details for the existing same-file duplicate-id fixture", async () => {
    await expectRelParse003GroupedDuplicateDetails("duplicate-id", "FR-ARCH-001");
  });

  it("REL-PARSE-003 AC-4 reports grouped details for cross-file duplicate Requirement IDs", async () => {
    await expectRelParse003GroupedDuplicateDetails("duplicate-id-cross-file", "REL-PARSE-901");
  });

  it("REL-PARSE-003 AC-4 reports grouped details for discarded and draft marked duplicate Requirement IDs", async () => {
    await expectRelParse003GroupedDuplicateDetails("duplicate-id-discarded-draft", "REL-PARSE-902", {
      "Discarded duplicate": "DISCARDED",
      "Draft duplicate": "DRAFT"
    });
  });

  it("REL-PARSE-003 AC-4 reports grouped details for more than two duplicate occurrences", async () => {
    await expectRelParse003GroupedDuplicateDetails("duplicate-id-three-occurrences", "REL-PARSE-903");
  });

  it("REL-PARSE-003 AC-4 reports grouped details for non-adjacent same-file duplicate Requirement IDs", async () => {
    await expectRelParse003GroupedDuplicateDetails("duplicate-id-nonadjacent", "REL-PARSE-904");
  });

  it("REL-PARSE-003 AC-4 reports separate grouped details for multiple duplicate Requirement ID groups", async () => {
    await expectRelParse003GroupedDuplicateDetails("duplicate-id-multiple-groups", "REL-PARSE-905");
    await expectRelParse003GroupedDuplicateDetails("duplicate-id-multiple-groups", "FR-PARSE-906");
  });

  it("validates explicit Active Target metadata against the Target Map", async () => {
    const unknownRoot = await copyFixtureWorkspace("valid-basic");
    const unknownIndexPath = path.join(unknownRoot, "docs", "spec", "00.index.md");
    await writeFile(unknownIndexPath, (await readFile(unknownIndexPath, "utf8")).replace("| Active Target | v1.0.0 |", "| Active Target | v9.9.9 |"), "utf8");
    const unknown = validateWorkspace(await parseWorkspace(await resolveProjectRoot(unknownRoot)));
    expect(unknown.diagnostics.map((d) => d.code)).toContain("SRS-E017");

    const inactiveRoot = await copyFixtureWorkspace("valid-basic");
    const inactiveIndexPath = path.join(inactiveRoot, "docs", "spec", "00.index.md");
    await writeFile(inactiveIndexPath, (await readFile(inactiveIndexPath, "utf8")).replace("| v1.0.0 | release | active |", "| v1.0.0 | release | planned |"), "utf8");
    const inactive = validateWorkspace(await parseWorkspace(await resolveProjectRoot(inactiveRoot)));
    expect(inactive.diagnostics.map((d) => d.code)).toContain("SRS-W010");

    const emptyRoot = await copyFixtureWorkspace("valid-basic");
    const emptyIndexPath = path.join(emptyRoot, "docs", "spec", "00.index.md");
    await writeFile(emptyIndexPath, (await readFile(emptyIndexPath, "utf8")).replace("| Active Target | v1.0.0 |", "| Active Target |  |"), "utf8");
    const empty = validateWorkspace(await parseWorkspace(await resolveProjectRoot(emptyRoot)));
    expect(empty.diagnostics.map((d) => d.code)).not.toContain("SRS-E017");
    expect(empty.diagnostics.map((d) => d.code)).not.toContain("SRS-W010");
  });

  it("FR-NODE-003 keeps focused index and section failure fixtures parseable", async () => {
    const expectations = [
      { name: "index-missing-target-map", codes: ["SRS-E013"] },
      { name: "index-missing-scope-map", codes: ["SRS-E014"] },
      { name: "index-empty-scope-document", codes: ["SRS-E016"] },
      { name: "missing-acceptance-criteria", codes: ["SRS-E008"] }
    ];

    for (const fixture of expectations) {
      const workspace = await parseWorkspace(await resolveProjectRoot(await copyFixtureWorkspace(fixture.name)));
      const result = validateWorkspace(workspace);
      expect(workspace.records.length, `${fixture.name} should keep neighboring requirements parseable`).toBeGreaterThanOrEqual(1);
      expect(result.diagnostics.map((diagnostic) => diagnostic.code), fixture.name).toEqual(expect.arrayContaining(fixture.codes));
    }
  });

  it("reports Completed Work Log inconsistencies as warnings", async () => {
    const root = await copyFixtureWorkspace("valid-basic");
    const indexPath = path.join(root, "docs", "spec", "00.index.md");
    const original = await readFile(indexPath, "utf8");
    await writeFile(
      indexPath,
      original.replace("| 2026-05-09 |  | ARCH |  | Cross-target fixture setup completed. |", "| 2026/05/09 | v9.9.9 | UNKNOWN | MISSING-ID | Bad completed row. |"),
      "utf8"
    );

    const result = validateWorkspace(await parseWorkspace(await resolveProjectRoot(root)));
    expect(result.diagnostics.map((d) => d.code)).toEqual(expect.arrayContaining(["SRS-W011", "SRS-W012", "SRS-W013", "SRS-W014", "SRS-W015"]));
    expect(result.errors).toHaveLength(0);
  });

  it("reports malformed Completed Work Log report paths as warnings", async () => {
    for (const reportPath of [
      "/absolute.md",
      "./local.md",
      "../escape.md",
      "docs/../escape.md",
      "https://example.com/report.md",
      String.raw`docs\report.md`,
      "docs/reports/bad|path.md",
      "docs/reports/ok.md, , docs/reports/next.md",
      "docs/reports/fragment.md#section"
    ]) {
      const root = await copyFixtureWorkspace("valid-basic");
      const indexPath = path.join(root, "docs", "spec", "00.index.md");
      const original = await readFile(indexPath, "utf8");
      await writeFile(
        indexPath,
        original
          .replace("| Date | Target | Scope | Requirement IDs | Summary |", "| Date | Target | Scope | Requirement IDs | Summary | Report Paths |")
          .replace("|---|---|---|---|---|", "|---|---|---|---|---|---|")
          .replace(
            "| 2026-05-10 | v1.0.0 | ARCH | FR-ARCH-001 | Fixture parser coverage completed. |",
            `| 2026-05-10 | v1.0.0 | ARCH | FR-ARCH-001 | Fixture parser coverage completed. | ${reportPath} |`
          ),
        "utf8"
      );

      const result = validateWorkspace(await parseWorkspace(await resolveProjectRoot(root)));
      expect(result.diagnostics).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: "SRS-W024",
            filePath: "docs/spec/00.index.md",
            details: expect.objectContaining({
              kind: "malformed-completed-work-report-path",
              nextAction: expect.objectContaining({ recommendedTool: "fix-completed-work-report-path" })
            })
          })
        ])
      );
      expect(result.errors).toHaveLength(0);
    }
  });

  it("preserves parser hardening diagnostics in validation output", async () => {
    const fixtures = [
      { name: "parser-hardening-duplicate-section", codes: ["SRS-E018"] },
      { name: "parser-hardening-nested-ac", codes: ["SRS-E019"] },
      { name: "parser-hardening-forbidden-heading-content", codes: ["SRS-E020"] },
      { name: "parser-hardening-malformed-tables", codes: ["SRS-E021", "SRS-W016", "SRS-W017"] }
    ];

    for (const fixture of fixtures) {
      const result = validateWorkspace(await parseWorkspace(await resolveProjectRoot(await copyFixtureWorkspace(fixture.name))));
      expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(expect.arrayContaining(fixture.codes));
    }
  });

  it("FR-NODE-003 covers a multi-document problem matrix fixture", async () => {
    const workspace = await parseWorkspace(await resolveProjectRoot(await copyFixtureWorkspace("problem-matrix")));
    const result = validateWorkspace(workspace);
    const codes = result.diagnostics.map((diagnostic) => diagnostic.code);

    expect(workspace.files.filter((file) => file.relativePath.endsWith(".srs.md")).map((file) => file.relativePath)).toEqual(
      expect.arrayContaining([
        "docs/spec/10.product-architecture.srs.md",
        "docs/spec/20.parser-validation.srs.md",
        "docs/spec/30.cli-interface.srs.md",
        "docs/spec/40.mcp-stdio-interface.srs.md",
        "docs/spec/50.nodejs-implementation.srs.md",
        "docs/spec/60.workflow-release.srs.md",
        "docs/spec/70.unregistered-extra.srs.md",
        "docs/spec/71.stress-targets.srs.md",
        "docs/spec/72.stress-metadata.srs.md",
        "docs/spec/73.stress-lifecycle.srs.md",
        "docs/spec/74.stress-trace-evidence.srs.md",
        "docs/spec/75.stress-table-shape.srs.md",
        "docs/spec/76.stress-headings.srs.md",
        "docs/spec/77.stress-duplicates.srs.md",
        "docs/spec/78.stress-unregistered-scopes.srs.md"
      ])
    );
    expect(workspace.files.filter((file) => file.relativePath.endsWith(".srs.md"))).toHaveLength(15);
    expect(workspace.records.length).toBeGreaterThanOrEqual(35);
    expect(new Set(codes).size).toBeGreaterThanOrEqual(30);
    expect(codes).toEqual(
      expect.arrayContaining([
        "SRS-E001",
        "SRS-E002",
        "SRS-E003",
        "SRS-E004",
        "SRS-E005",
        "SRS-E006",
        "SRS-E007",
        "SRS-E008",
        "SRS-W008",
        "SRS-W009",
        "SRS-E010",
        "SRS-E011",
        "SRS-E012",
        "SRS-E015",
        "SRS-W002",
        "SRS-W011",
        "SRS-W012",
        "SRS-W013",
        "SRS-W014",
        "SRS-W015",
        "SRS-E018",
        "SRS-E019",
        "SRS-E020",
        "SRS-E021",
        "SRS-W016",
        "SRS-W017",
        "SRS-W018",
        "SRS-W019",
        "SRS-W020",
        "SRS-W022",
        "SRS-W023",
        "SRS-W024",
        "SRS-E033",
        "SRS-W041"
      ])
    );

    const duplicate = result.diagnostics.find((diagnostic) => diagnostic.code === "SRS-E002" && diagnostic.requirementId === "REL-PARSE-701");
    expect(duplicate).toMatchObject({
      details: expect.objectContaining({
        duplicateId: "REL-PARSE-701",
        occurrences: expect.arrayContaining([
          expect.objectContaining({ filePath: "docs/spec/20.parser-validation.srs.md", title: "Duplicate parser requirement first occurrence" }),
          expect.objectContaining({ filePath: "docs/spec/60.workflow-release.srs.md", title: "Duplicate parser requirement second occurrence" })
        ]),
        nextAction: expect.objectContaining({ requiresSelectedOccurrence: true })
      })
    });
    const sameFileDuplicate = result.diagnostics.find((diagnostic) => diagnostic.code === "SRS-E002" && diagnostic.requirementId === "REL-NODE-820");
    expect(sameFileDuplicate).toMatchObject({
      details: expect.objectContaining({
        duplicateId: "REL-NODE-820",
        occurrences: [
          expect.objectContaining({ filePath: "docs/spec/77.stress-duplicates.srs.md", title: "Duplicate node requirement first occurrence" }),
          expect.objectContaining({ filePath: "docs/spec/77.stress-duplicates.srs.md", title: "Duplicate node requirement second occurrence" })
        ],
        nextAction: expect.objectContaining({ requiresSelectedOccurrence: true })
      })
    });
    expect(result.diagnostics.find((diagnostic) => diagnostic.code === "SRS-W041")).toMatchObject({
      filePath: "docs/spec/05.completed-work.md",
      details: expect.objectContaining({
        kind: "duplicate-completed-work-source",
        sources: ["docs/spec/00.index.md", "docs/spec/05.completed-work.md"]
      })
    });
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "SRS-W018", filePath: "docs/spec/00.index.md" }),
        expect.objectContaining({ code: "SRS-W008", filePath: "docs/spec/71.stress-targets.srs.md" }),
        expect.objectContaining({ code: "SRS-E015", filePath: "docs/spec/78.stress-unregistered-scopes.srs.md" })
      ])
    );
  });

  it("covers additional high-risk SRS fixture workspaces", async () => {
    const metadata = validateWorkspace(await parseWorkspace(await resolveProjectRoot(await copyFixtureWorkspace("metadata-duplicate-empty-fields"))));
    expect(metadata.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "SRS-E003", filePath: "docs/spec/10.product-architecture.srs.md" }),
        expect.objectContaining({ code: "SRS-W002", filePath: "docs/spec/10.product-architecture.srs.md" })
      ])
    );

    const marker = validateWorkspace(await parseWorkspace(await resolveProjectRoot(await copyFixtureWorkspace("marker-state-drift"))));
    expect(marker.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(expect.arrayContaining(["SRS-W023"]));

    const externalCompleted = validateWorkspace(await parseWorkspace(await resolveProjectRoot(await copyFixtureWorkspace("completed-work-external-only-malformed"))));
    expect(externalCompleted.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "SRS-W024",
          filePath: "docs/spec/05.completed-work.md",
          details: expect.objectContaining({ kind: "malformed-completed-work-report-path" })
        })
      ])
    );
  });

  it("reports index consistency and rollup drift diagnostics", async () => {
    const fixtures = [
      { name: "index-drift-duplicate-target", codes: ["SRS-E022"] },
      { name: "index-drift-duplicate-scope", codes: ["SRS-E023"] },
      { name: "index-drift-multiple-active-targets", codes: ["SRS-E024"] },
      { name: "index-drift-missing-scope-document", codes: ["SRS-E025"] },
      { name: "index-drift-unregistered-srs", codes: ["SRS-W018"] },
      { name: "index-drift-status-summary", codes: ["SRS-W019"] },
      { name: "index-drift-type-summary", codes: ["SRS-W020"] }
    ];

    for (const fixture of fixtures) {
      const result = validateWorkspace(await parseWorkspace(await resolveProjectRoot(await copyFixtureWorkspace(fixture.name))));
      expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(expect.arrayContaining(fixture.codes));
    }
  });

  it("REL-PARSE-002 AC-2/AC-5 includes row anchors and repair details for recoverable index diagnostics", async () => {
    const duplicateTarget = validateWorkspace(await parseWorkspace(await resolveProjectRoot(await copyFixtureWorkspace("index-drift-duplicate-target"))));
    expect(duplicateTarget.diagnostics.find((diagnostic) => diagnostic.code === "SRS-E022")).toMatchObject({
      filePath: "docs/spec/00.index.md",
      line: 13,
      details: expect.objectContaining({
        kind: "duplicate-target-row",
        target: "v1.2.0",
        occurrences: expect.arrayContaining([expect.objectContaining({ line: 12 }), expect.objectContaining({ line: 13 })]),
        nextAction: expect.objectContaining({ recommendedTool: expect.any(String) })
      })
    });

    const statusSummary = validateWorkspace(await parseWorkspace(await resolveProjectRoot(await copyFixtureWorkspace("index-drift-status-summary"))));
    expect(statusSummary.diagnostics.find((diagnostic) => diagnostic.code === "SRS-W019")).toMatchObject({
      filePath: "docs/spec/00.index.md",
      line: 24,
      details: expect.objectContaining({
        kind: "rollup-drift",
        summary: "Status Summary",
        key: "planned",
        expectedCount: 2,
        actualCount: 1,
        nextAction: expect.objectContaining({ recommendedTool: expect.any(String) })
      })
    });

    const duplicateScope = validateWorkspace(await parseWorkspace(await resolveProjectRoot(await copyFixtureWorkspace("index-drift-duplicate-scope"))));
    expect(duplicateScope.diagnostics.find((diagnostic) => diagnostic.code === "SRS-E023")).toMatchObject({
      filePath: "docs/spec/00.index.md",
      line: 19,
      details: expect.objectContaining({
        kind: "duplicate-scope-row",
        prefix: "ARCH",
        occurrences: expect.arrayContaining([expect.objectContaining({ line: 18 }), expect.objectContaining({ line: 19 })])
      })
    });

    const typeSummary = validateWorkspace(await parseWorkspace(await resolveProjectRoot(await copyFixtureWorkspace("index-drift-type-summary"))));
    expect(typeSummary.diagnostics.find((diagnostic) => diagnostic.code === "SRS-W020")).toMatchObject({
      filePath: "docs/spec/00.index.md",
      line: 30,
      details: expect.objectContaining({
        kind: "rollup-drift",
        summary: "Requirement Type Summary",
        key: "functional",
        expectedCount: 2,
        actualCount: 1
      })
    });

    const missingScope = validateWorkspace(await parseWorkspace(await resolveProjectRoot(await copyFixtureWorkspace("index-drift-missing-scope-document"))));
    expect(missingScope.diagnostics.find((diagnostic) => diagnostic.code === "SRS-E025")).toMatchObject({
      filePath: "docs/spec/00.index.md",
      line: 18,
      details: expect.objectContaining({
        kind: "missing-scope-document",
        document: "docs/spec/99.missing.srs.md",
        nextAction: expect.objectContaining({ recommendedTool: expect.any(String) })
      })
    });
  });

  it("FR-PARSE-021 reports duplicate completed-work sources and validates external report paths lexically", async () => {
    const root = await copyFixtureWorkspace("valid-basic");
    await writeExternalCompletedWork(root, "docs/reports/does-not-need-to-exist.md");
    const result = validateWorkspace(await parseWorkspace(await resolveProjectRoot(root)));

    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "SRS-W041",
          filePath: "docs/spec/05.completed-work.md",
          line: 7,
          details: expect.objectContaining({
            kind: "duplicate-completed-work-source",
            sources: expect.arrayContaining(["docs/spec/00.index.md", "docs/spec/05.completed-work.md"])
          })
        })
      ])
    );
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).not.toContain("SRS-W024");

    const malformedRoot = await copyFixtureWorkspace("valid-basic");
    await writeExternalCompletedWork(malformedRoot, "../bad.md");
    const malformed = validateWorkspace(await parseWorkspace(await resolveProjectRoot(malformedRoot)));
    expect(malformed.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "SRS-W024",
          filePath: "docs/spec/05.completed-work.md",
          line: 7
        })
      ])
    );
  });

  it("reports exact stability lifecycle diagnostics from focused fixtures", async () => {
    const fixtures = [
      { name: "stability-legacy-volatile", codes: ["SRS-W022"] },
      { name: "stability-invalid-unknown", codes: ["SRS-E011"] },
      { name: "stability-active-draft", codes: ["SRS-W023"] },
      { name: "stability-released-draft", codes: ["SRS-W023"] },
      { name: "stability-verified-draft", codes: ["SRS-E033"] },
      { name: "stability-frozen-missing", codes: ["SRS-W009"] },
      { name: "stability-frozen-explicit", codes: [] },
      { name: "stability-frozen-discarded", codes: [] }
    ];

    for (const fixture of fixtures) {
      await expect(diagnosticCodesForFixture(fixture.name)).resolves.toEqual(fixture.codes);
    }
  });
});
