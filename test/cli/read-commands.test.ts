import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { main } from "../../src/cli/index.js";
import { copyFixtureWorkspace } from "../fixtures/fixture-utils.js";

function io() {
  return { stdout: new PassThrough() as NodeJS.WriteStream, stderr: new PassThrough() as NodeJS.WriteStream };
}

interface DuplicateValidationJson {
  errors: Array<{
    code: string;
    details?: {
      duplicateId?: string;
      occurrences?: unknown[];
      nextAction?: { requiresSelectedOccurrence?: boolean };
    };
  }>;
  summary: { byCode: Record<string, number> };
  diagnosticsSummary: { byCode: Record<string, number> };
}

async function appendDeprecatedRequirement(root: string): Promise<void> {
  const specPath = path.join(root, "docs", "spec", "10.product-architecture.srs.md");
  const text = await readFile(specPath, "utf8");
  const blockStart = text.indexOf("### FR-ARCH-001");
  if (blockStart < 0) throw new Error("fixture requirement block not found");
  const deprecatedBlock = text
    .slice(blockStart)
    .replaceAll("FR-ARCH-001", "FR-ARCH-002")
    .replace("Fixture requirement", "Deprecated fixture requirement")
    .replace("| Status | planned |", "| Status | blocked |")
    .replace("| Stability | stable |", "| Stability | deprecated |");
  await writeFile(specPath, `${text.trimEnd()}\n\n${deprecatedBlock}\n`, "utf8");
}

async function addSearchMetadata(root: string): Promise<void> {
  const specPath = path.join(root, "docs", "spec", "10.product-architecture.srs.md");
  const text = await readFile(specPath, "utf8");
  await writeFile(
    specPath,
    text
      .replace("| Related Docs | [Index](./00.index.md) |", "| Related Docs | [Index](./00.index.md), [Research](../research/search.md) |")
      .replace(
        "| Evidence ID | Type | Reference | Covers | Notes |\n| --- | --- | --- | --- | --- |",
        "| Evidence ID | Type | Reference | Covers | Notes |\n| --- | --- | --- | --- | --- |\n| VE-1 | test | test/core/query/query-summary-links.test.ts; npm test | all | Search fixture. |"
      ),
    "utf8"
  );
}

async function writeExternalCompletedWork(root: string, rows = 1): Promise<void> {
  const tableRows = Array.from({ length: rows }, (_, index) => {
    const day = String(index + 1).padStart(2, "0");
    return `| 2026-06-${day} | v1.0.0 | ARCH | FR-ARCH-001 | External CLI completed row ${day}. | docs/reports/external-${day}.md |`;
  });
  await writeFile(
    path.join(root, "docs", "spec", "05.completed-work.md"),
    [
      "# Completed Work",
      "",
      "## 1. Completed Work Log",
      "",
      "| Date | Target | Scope | Requirement IDs | Summary | Report Paths |",
      "|---|---|---|---|---|---|",
      ...tableRows
    ].join("\n"),
    "utf8"
  );
}

describe("read-only CLI commands", () => {
  it("validates, lists, shows, summarizes, and checks links", async () => {
    const root = await copyFixtureWorkspace("valid-basic");
    for (const args of [
      ["--root", root, "validate", "--json"],
      ["--root", root, "list", "--json"],
      ["--root", root, "show", "FR-ARCH-001", "--json", "--markdown"],
      ["--root", root, "active-target", "--json"],
      ["--root", root, "summary", "--json"],
      ["--root", root, "links", "check", "--json"]
    ]) {
      const streams = io();
      const code = await main(args, streams);
      expect(code).toBe(0);
      expect(() => JSON.parse(streams.stdout.read()?.toString() ?? "")).not.toThrow();
    }
  });

  it("keeps deprecated requirements explicitly searchable while excluding them from default new-work candidates", async () => {
    const root = await copyFixtureWorkspace("valid-basic");
    await appendDeprecatedRequirement(root);

    const list = io();
    expect(await main(["--root", root, "list", "--status", "blocked", "--json"], list)).toBe(0);
    const listOutput = JSON.parse(list.stdout.read()?.toString() ?? "") as { records: Array<{ id: string }> };
    expect(listOutput.records.map((record) => record.id)).toEqual(["FR-ARCH-002"]);

    const show = io();
    expect(await main(["--root", root, "show", "FR-ARCH-002", "--json"], show)).toBe(0);
    const showOutput = JSON.parse(show.stdout.read()?.toString() ?? "") as { id: string; stability: string };
    expect(showOutput).toMatchObject({ id: "FR-ARCH-002", stability: "deprecated" });

    const summary = io();
    expect(await main(["--root", root, "summary", "--json"], summary)).toBe(0);
    const summaryOutput = JSON.parse(summary.stdout.read()?.toString() ?? "") as { deprecatedRequirements: string[]; newWorkCandidates: string[] };
    expect(summaryOutput.deprecatedRequirements).toContain("FR-ARCH-002");
    expect(summaryOutput.newWorkCandidates).not.toContain("FR-ARCH-002");
  });

  it("FR-PARSE-019 consumes normalized search fields in CLI list filters", async () => {
    const root = await copyFixtureWorkspace("valid-basic");
    await addSearchMetadata(root);
    const list = io();

    expect(
      await main(
        [
          "--root",
          root,
          "list",
          "--stability",
          "stable",
          "--priority",
          "high",
          "--related-doc",
          "docs/research/search.md",
          "--evidence-reference",
          "test/core/query/query-summary-links.test.ts",
          "--trace-reference",
          "FR-ARCH-001",
          "--new-work-candidate",
          "--json"
        ],
        list
      )
    ).toBe(0);
    const output = JSON.parse(list.stdout.read()?.toString() ?? "") as { records: Array<{ id: string; relatedDocs?: string[]; evidenceReferences?: string[]; traceReferences?: string[] }> };
    expect(output.records).toEqual([
      expect.objectContaining({
        id: "FR-ARCH-001",
        relatedDocs: expect.arrayContaining(["docs/research/search.md"]),
        evidenceReferences: expect.arrayContaining(["test/core/query/query-summary-links.test.ts"]),
        traceReferences: expect.arrayContaining(["FR-ARCH-001"])
      })
    ]);
  });

  it("IR-CLI-029 supports compact projections, selected fields, search snippets, and pagination", async () => {
    const root = await copyFixtureWorkspace("valid-basic");
    await appendDeprecatedRequirement(root);
    await addSearchMetadata(root);

    const ids = io();
    expect(await main(["--root", root, "list", "--format", "ids", "--limit", "1", "--json"], ids)).toBe(0);
    expect(JSON.parse(ids.stdout.read()?.toString() ?? "")).toMatchObject({
      ids: ["FR-ARCH-001"],
      page: { total: 2, returned: 1, offset: 0, limit: 1, nextOffset: 1, truncated: true },
      diagnosticsSummary: expect.any(Object)
    });

    const compact = io();
    expect(await main(["--root", root, "list", "--format", "compact", "--json"], compact)).toBe(0);
    const compactOutput = JSON.parse(compact.stdout.read()?.toString() ?? "");
    expect(compactOutput.records[0]).toMatchObject({
      id: "FR-ARCH-001",
      title: "Fixture requirement",
      filePath: "docs/spec/10.product-architecture.srs.md",
      headingLine: expect.any(Number)
    });
    expect(compactOutput.records[0].markdown).toBeUndefined();

    const fields = io();
    expect(await main(["--root", root, "list", "--fields", "id,title,stability", "--json"], fields)).toBe(0);
    expect(JSON.parse(fields.stdout.read()?.toString() ?? "").records[0]).toEqual({
      id: "FR-ARCH-001",
      title: "Fixture requirement",
      stability: "stable"
    });

    const full = io();
    expect(await main(["--root", root, "list", "--format", "full", "--include-markdown", "--json"], full)).toBe(0);
    expect(JSON.parse(full.stdout.read()?.toString() ?? "").records[0].markdown).toContain("SpecKiwi must parse this fixture requirement.");

    const search = io();
    expect(await main(["--root", root, "search", "small valid workspace", "--stability", "stable", "--limit", "1", "--json"], search)).toBe(0);
    expect(JSON.parse(search.stdout.read()?.toString() ?? "")).toMatchObject({
      records: [
        {
          id: "FR-ARCH-001",
          title: "Fixture requirement",
          snippets: [expect.objectContaining({ field: "rationale", text: expect.stringContaining("small valid workspace") })]
        }
      ],
      page: { total: 1, returned: 1, truncated: false }
    });

    const filteredSearch = io();
    expect(await main(["--root", root, "search", "deprecated", "--status", "blocked", "--json"], filteredSearch)).toBe(0);
    expect(JSON.parse(filteredSearch.stdout.read()?.toString() ?? "").records.map((record: { id: string }) => record.id)).toEqual(["FR-ARCH-002"]);
  });

  it("IR-CLI-030 returns structured JSON errors for read command failures", async () => {
    const root = await copyFixtureWorkspace("valid-basic");

    const missing = io();
    expect(await main(["--root", root, "show", "FR-ARCH-999", "--json"], missing)).toBe(5);
    expect(JSON.parse(missing.stdout.read()?.toString() ?? "")).toMatchObject({
      ok: false,
      error: { code: "NOT_FOUND", message: expect.stringContaining("FR-ARCH-999") },
      diagnostics: [],
      diagnosticsSummary: { errors: 0, warnings: 0, byCode: {} },
      recovery: { command: "search" }
    });

    const invalidFilter = io();
    expect(await main(["--root", root, "list", "--format", "invalid", "--json"], invalidFilter)).toBe(2);
    expect(JSON.parse(invalidFilter.stdout.read()?.toString() ?? "")).toMatchObject({
      ok: false,
      error: { code: "CLI_USAGE_ERROR", message: expect.stringContaining("format must be ids, compact, or full") },
      diagnostics: [],
      diagnosticsSummary: { errors: 0, warnings: 0, byCode: {} },
      recovery: { command: "list" }
    });

    const unknownTarget = io();
    expect(await main(["--root", root, "summary", "--target", "v9.9.9", "--json"], unknownTarget)).toBe(5);
    expect(JSON.parse(unknownTarget.stdout.read()?.toString() ?? "")).toMatchObject({
      ok: false,
      error: { code: "TARGET_NOT_FOUND", message: expect.stringContaining("v9.9.9") },
      diagnostics: [],
      diagnosticsSummary: { errors: 0, warnings: 0, byCode: {} },
      recovery: { command: "targets" }
    });

    const emptyRoot = await mkdtemp(path.join(tmpdir(), "speckiwi-empty-root-"));
    const workspaceFailure = io();
    expect(await main(["--root", emptyRoot, "search", "anything", "--json"], workspaceFailure)).toBe(4);
    expect(JSON.parse(workspaceFailure.stdout.read()?.toString() ?? "")).toMatchObject({
      ok: false,
      error: { code: "WORKSPACE_PARSE_ERROR" },
      diagnostics: [],
      diagnosticsSummary: { errors: 0, warnings: 0, byCode: {} },
      recovery: { command: "init" }
    });
  });

  it("adds diagnostics summaries to read JSON payloads and expands target summaries", async () => {
    const root = await copyFixtureWorkspace("valid-basic");

    const validate = io();
    expect(await main(["--root", root, "validate", "--json"], validate)).toBe(0);
    const validateOutput = JSON.parse(validate.stdout.read()?.toString() ?? "");
    expect(validateOutput.summary).toEqual({ errors: 0, warnings: 1, byCode: { "SRS-W015": 1 } });

    const targets = io();
    expect(await main(["--root", root, "targets", "--json"], targets)).toBe(0);
    const targetsOutput = JSON.parse(targets.stdout.read()?.toString() ?? "");
    expect(targetsOutput.diagnosticsSummary).toEqual({ errors: 0, warnings: 1, byCode: { "SRS-W015": 1 } });
    expect(targetsOutput.targets[0]).toMatchObject({
      target: "v1.0.0",
      summary: {
        countsByStatus: { planned: 1 },
        countsByType: { functional: 1 },
        countsByStability: { stable: 1 },
        blocked: [],
        implementedNotVerified: [],
        missingEvidence: [],
        draftRequirements: [],
        deprecatedRequirements: [],
        newWorkCandidates: ["FR-ARCH-001"],
        stabilityBlockers: [],
        stabilityWarnings: []
      }
    });

    const activeTarget = io();
    expect(await main(["--root", root, "active-target", "--json"], activeTarget)).toBe(0);
    const activeTargetOutput = JSON.parse(activeTarget.stdout.read()?.toString() ?? "");
    expect(activeTargetOutput.summary).toMatchObject({
      countsByStability: { stable: 1 },
      newWorkCandidates: ["FR-ARCH-001"],
      stabilityBlockers: [],
      stabilityWarnings: []
    });

    const summary = io();
    expect(await main(["--root", root, "summary", "--json"], summary)).toBe(0);
    const summaryOutput = JSON.parse(summary.stdout.read()?.toString() ?? "");
    expect(summaryOutput).toMatchObject({
      target: "v1.0.0",
      countsByStatus: { planned: 1 },
      countsByType: { functional: 1 },
      countsByStability: { stable: 1 },
      blocked: [],
      draftRequirements: [],
      deprecatedRequirements: [],
      newWorkCandidates: ["FR-ARCH-001"],
      stabilityBlockers: [],
      stabilityWarnings: [],
      diagnosticsSummary: { errors: 0, warnings: 1, byCode: { "SRS-W015": 1 } }
    });
  });

  it("REL-PARSE-003 AC-5 preserves grouped duplicate diagnostics in CLI validate JSON", async () => {
    const root = await copyFixtureWorkspace("duplicate-id-three-occurrences");
    const validate = io();

    expect(await main(["--root", root, "validate", "--json"], validate)).toBe(1);
    const output = JSON.parse(validate.stdout.read()?.toString() ?? "") as DuplicateValidationJson;
    const duplicate = output.errors.find((diagnostic) => diagnostic.code === "SRS-E002");

    expect(output.summary.byCode["SRS-E002"]).toBe(1);
    expect(output.diagnosticsSummary.byCode["SRS-E002"]).toBe(1);
    expect(duplicate?.details).toMatchObject({
      duplicateId: "REL-PARSE-903",
      occurrences: expect.arrayContaining([expect.objectContaining({ filePath: expect.any(String), headingLine: expect.any(Number), blockHash: expect.any(String) })]),
      nextAction: expect.objectContaining({ requiresSelectedOccurrence: true })
    });
    expect(duplicate?.details?.occurrences).toHaveLength(3);
  });

  it("keeps the full problem-matrix diagnostics visible in CLI validate JSON", async () => {
    const root = await copyFixtureWorkspace("problem-matrix");
    const validate = io();

    expect(await main(["--root", root, "validate", "--json"], validate)).toBe(1);
    const output = JSON.parse(validate.stdout.read()?.toString() ?? "") as {
      errors: Array<{ code: string; filePath?: string; details?: unknown }>;
      warnings: Array<{ code: string; filePath?: string; details?: unknown }>;
      summary: { errors: number; warnings: number; byCode: Record<string, number> };
      diagnosticsSummary: { byCode: Record<string, number> };
    };

    expect(output.summary.errors).toBeGreaterThan(0);
    expect(output.summary.warnings).toBeGreaterThan(0);
    expect(output.summary.byCode).toMatchObject({
      "SRS-E002": expect.any(Number),
      "SRS-E015": expect.any(Number),
      "SRS-W024": expect.any(Number),
      "SRS-W041": expect.any(Number)
    });
    expect(output.diagnosticsSummary.byCode).toMatchObject(output.summary.byCode);
    expect(output.errors).toEqual(expect.arrayContaining([expect.objectContaining({ code: "SRS-E002" }), expect.objectContaining({ code: "SRS-E015" })]));
    expect(output.warnings).toEqual(expect.arrayContaining([expect.objectContaining({ code: "SRS-W024" }), expect.objectContaining({ code: "SRS-W041" })]));
  });

  it("REL-PARSE-002 AC-4 deduplicates parser diagnostics in CLI validate JSON", async () => {
    const root = await copyFixtureWorkspace("parser-hardening-malformed-tables");
    const validate = io();

    expect(await main(["--root", root, "validate", "--json"], validate)).toBe(1);
    const output = JSON.parse(validate.stdout.read()?.toString() ?? "") as {
      diagnostics: Array<{ code: string }>;
      summary: { byCode: Record<string, number> };
      diagnosticsSummary: { byCode: Record<string, number> };
    };

    expect(output.diagnostics.filter((diagnostic) => diagnostic.code === "SRS-E021")).toHaveLength(1);
    expect(output.summary.byCode["SRS-E021"]).toBe(1);
    expect(output.diagnosticsSummary.byCode["SRS-E021"]).toBe(1);
  });

  it("REL-PARSE-002 AC-3 reports compact diagnostics for human validate output", async () => {
    const root = await copyFixtureWorkspace("duplicate-id-three-occurrences");
    const validate = io();

    expect(await main(["--root", root, "validate"], validate)).toBe(1);
    const output = validate.stdout.read()?.toString() ?? "";

    expect(output).toContain("Diagnostics: 1 error, 0 warnings");
    expect(output).toContain("error SRS-E002 docs/spec/20.parser-validation.srs.md:5");
    expect(output).toContain("Duplicate requirement ID: REL-PARSE-903");
    expect(output).not.toContain("\"occurrences\"");
  });

  it("reads completed work and reports empty active target honestly", async () => {
    const root = await copyFixtureWorkspace("valid-basic");

    const completed = io();
    expect(await main(["--root", root, "completed-work", "--target", "v1.0.0", "--scope", "ARCH", "--since", "2026-05-09", "--limit", "2", "--json"], completed)).toBe(0);
    const completedOutput = JSON.parse(completed.stdout.read()?.toString() ?? "");
    expect(completedOutput.completedWork.map((entry: { summary: string }) => entry.summary)).toEqual([
      "Fixture parser coverage completed.",
      "Cross-target fixture setup completed."
    ]);
    expect(completedOutput.completedWork).toEqual(expect.arrayContaining([expect.objectContaining({ reportPaths: [] })]));

    await writeFile(
      path.join(root, "docs", "spec", "00.index.md"),
      (await readFile(path.join(root, "docs", "spec", "00.index.md"), "utf8"))
        .replace("| Date | Target | Scope | Requirement IDs | Summary |", "| Date | Target | Scope | Requirement IDs | Summary | Report Paths |")
        .replace("|---|---|---|---|---|", "|---|---|---|---|---|---|")
        .replace(
          "| 2026-05-10 | v1.0.0 | ARCH | FR-ARCH-001 | Fixture parser coverage completed. |",
          "| 2026-05-10 | v1.0.0 | ARCH | FR-ARCH-001 | Fixture parser coverage completed. | docs/reports/read.md |"
        ),
      "utf8"
    );
    const completedWithReport = io();
    expect(await main(["--root", root, "completed-work", "--target", "v1.0.0", "--json"], completedWithReport)).toBe(0);
    expect(JSON.parse(completedWithReport.stdout.read()?.toString() ?? "").completedWork).toEqual(
      expect.arrayContaining([expect.objectContaining({ summary: "Fixture parser coverage completed.", reportPaths: ["docs/reports/read.md"] })])
    );

    const completedFileOrder = io();
    expect(await main(["--root", root, "completed-work", "--target", "v1.0.0", "--scope", "ARCH", "--since", "2026-05-09", "--limit", "2", "--order", "file", "--json"], completedFileOrder)).toBe(0);
    const fileOrderOutput = JSON.parse(completedFileOrder.stdout.read()?.toString() ?? "");
    expect(fileOrderOutput.completedWork.map((entry: { summary: string }) => entry.summary)).toEqual([
      "Cross-target fixture setup completed.",
      "Fixture parser coverage completed."
    ]);

    const invalidLimit = io();
    expect(await main(["--root", root, "completed-work", "--limit", "0"], invalidLimit)).toBe(2);
    expect(invalidLimit.stderr.read()?.toString()).toContain("limit must be a positive integer");

    const invalidOrder = io();
    expect(await main(["--root", root, "completed-work", "--order", "random"], invalidOrder)).toBe(2);
    expect(invalidOrder.stderr.read()?.toString()).toContain("order must be latest or file");

    const mutationRoot = await copyFixtureWorkspace("mutation-target");
    const indexPath = path.join(mutationRoot, "docs", "spec", "00.index.md");
    await writeFile(indexPath, (await readFile(indexPath, "utf8")).replace("| Active Target | v1.0.0 |", "| Active Target |  |"), "utf8");
    const activeTarget = io();
    expect(await main(["--root", mutationRoot, "active-target", "--json"], activeTarget)).toBe(0);
    const activeOutput = JSON.parse(activeTarget.stdout.read()?.toString() ?? "");
    expect(activeOutput.activeTarget).toBe("");
    expect(activeOutput.summary.target).toBe("");
    expect(activeOutput.summary.completedWork).toEqual([]);
  });

  it("IR-CLI-037 reads external completed work with source metadata and migration preview", async () => {
    const root = await copyFixtureWorkspace("valid-basic");
    await writeExternalCompletedWork(root);

    const completed = io();
    expect(await main(["--root", root, "completed-work", "--target", "v1.0.0", "--limit", "1", "--json"], completed)).toBe(0);
    const output = JSON.parse(completed.stdout.read()?.toString() ?? "");

    expect(output.completedWork).toEqual([
      expect.objectContaining({
        summary: "External CLI completed row 01.",
        filePath: "docs/spec/05.completed-work.md",
        line: expect.any(Number)
      })
    ]);
    expect(output.completedWorkPage).toEqual({ total: 3, returned: 1, limit: 1, hasMore: true, nextOffset: 1 });
    expect(output.completedWorkSource).toMatchObject({
      mode: "external",
      authoritativeFilePath: "docs/spec/05.completed-work.md",
      duplicateSources: true,
      migrationRecommended: true
    });
    expect(output.diagnostics).toEqual(expect.arrayContaining([expect.objectContaining({ code: "SRS-W041" })]));

    const migration = io();
    expect(await main(["--root", root, "completed-work-migration-plan", "--json"], migration)).toBe(0);
    expect(JSON.parse(migration.stdout.read()?.toString() ?? "")).toMatchObject({
      completedWorkMigration: {
        kind: "completed_work_migration_plan",
        dryRun: true,
        sourceFilePath: "docs/spec/00.index.md",
        targetFilePath: "docs/spec/05.completed-work.md",
        indexNavigationLink: "[Completed Work Log](05.completed-work.md)",
        rowCount: 2,
        written: false
      }
    });
  });
});
