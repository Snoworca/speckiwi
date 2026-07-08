import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { main } from "../../src/cli/index.js";

// IR-CLI-068 — speckiwi scaffold-scope command.
//
// The speckiwi scaffold-scope command delegates to the scaffoldScope core (FR-NODE-065) to create
// and register a brand-new scope: it writes a new numbered scope srs.md file from the scope template
// and adds one row to the §2 SRS Documents section and one row to the §4 Scope Map section of
// 00.index.md, accepts an optional prefix (via the `<name:PREFIX>` argument), defaults to dry-run,
// and supports --json.
//
// Red-phase suite (T-PH004-51): one test case per acceptance criterion (AC-1..AC-4). These cases pin
// the future CLI contract BEFORE src/cli/index.ts / src/cli/commands/mutations.ts teach the CLI the
// scaffold-scope command, so the whole suite fails today — commander rejects the unknown
// scaffold-scope command (non-zero usage exit, no scope file created, no mutation envelope printed) —
// until the green task (T-PH004-52) wires the command against the existing core mutation
// (src/core/mutation/scaffold-scope.ts scaffoldScope, FR-NODE-065): a default dry-run preview that
// writes nothing, an --apply that creates the file and registers both index rows, and a --json
// mutation result envelope.
//
// Contract under test (SRS docs/spec/30.cli-interface.srs.md IR-CLI-068):
//   - AC-1: speckiwi scaffold-scope <name> creates the scope file and registers it in the index in
//           one command.
//   - AC-2: speckiwi scaffold-scope <name:PREFIX> uses the given prefix instead of inferring one.
//   - AC-3: speckiwi scaffold-scope --dry-run prints a preview and writes no file.
//   - AC-4: speckiwi scaffold-scope --json emits the mutation result envelope.
//
// Fixture: the Scope Map registers only the ARCH document, so a fresh scope (Payments / PAY) does not
// collide and the core can scaffold it as the next decade document (20.payments.srs.md).

const SPEC_DIR_PARTS = ["docs", "spec"] as const;

const INDEX_MARKDOWN = [
  "# SpecKiwi Scaffold-Scope CLI Fixture Index",
  "",
  "| Field | Value |",
  "|---|---|",
  "| Document Type | srs_index |",
  "| Product | SpecKiwi |",
  "| Active Target | v1.0.0 |",
  "| Status | baseline |",
  "",
  "## 1. Purpose",
  "",
  "Scaffold-scope CLI fixture index.",
  "",
  "## 2. SRS Documents",
  "",
  "| Scope | Document | Prefix | Description |",
  "|---|---|---|---|",
  "| Product Architecture | [10.product-architecture.srs.md](./10.product-architecture.srs.md) | ARCH | Architecture |",
  "",
  "## 3. Target Map",
  "",
  "| Target | Type | Status | Description |",
  "|---|---|---|---|",
  "| v1.0.0 | release | active | Fixture release |",
  "",
  "## 4. Scope Map",
  "",
  "| Scope | Document | Prefix | Description |",
  "|---|---|---|---|",
  "| Product Architecture | ./10.product-architecture.srs.md | ARCH | Architecture |",
  "",
  "## 5. Status Summary",
  "",
  "| Status | Count |",
  "|---|---:|",
  "| planned | 1 |",
  "| in_progress | 0 |",
  "| blocked | 0 |",
  "| implemented | 0 |",
  "| verified | 0 |",
  "| discarded | 0 |",
  "",
  "## 6. Requirement Type Summary",
  "",
  "| Type | Prefix | Count |",
  "|---|---|---:|",
  "| functional | FR | 1 |",
  "",
  "## 7. Completed Work Log",
  "",
  "| Date | Target | Scope | Requirement IDs | Summary |",
  "|---|---|---|---|---|"
].join("\n");

const ARCH_MARKDOWN = [
  "# Product Architecture",
  "",
  "| Field | Value |",
  "|---|---|",
  "| Document Type | scope_srs |",
  "| Scope | ARCH |",
  "| Scope Name | Product Architecture |",
  "",
  "## 1. Scope Overview",
  "",
  "Fixture scope.",
  "",
  "## 2. Scope Boundaries",
  "",
  "### In Scope",
  "",
  "- Markdown requirements",
  "",
  "### Out of Scope",
  "",
  "- External database",
  "",
  "## 3. Assumptions and Constraints",
  "",
  "- None",
  "",
  "## 4. Requirements",
  "",
  "### FR-ARCH-001 — Registered architecture requirement",
  "",
  "| Field | Value |",
  "| --- | --- |",
  "| Type | functional |",
  "| Target | v1.0.0 |",
  "| Status | planned |",
  "| Priority | high |",
  "| Tags | fixture |",
  "| Risk | low |",
  "| Stability | evolving |",
  "| Verification Method | test |",
  "| GitHub Issue | - |",
  "| Related Docs | - |",
  "",
  "#### Requirement",
  "",
  "Statement for FR-ARCH-001.",
  "",
  "#### Rationale",
  "",
  "-",
  "",
  "#### Acceptance Criteria",
  "",
  "- [ ] AC-1: Something holds.",
  "",
  "#### Verification Evidence",
  "",
  "| Evidence ID | Type | Reference | Covers | Notes |",
  "| --- | --- | --- | --- | --- |",
  "| VE-1 | test | test/x.test.ts | AC-1 | - |",
  "",
  "#### Trace Links",
  "",
  "| Type | Reference | Relation | Notes |",
  "| --- | --- | --- | --- |",
  "",
  "#### Research / Analysis",
  "",
  "- -",
  "",
  "#### Implementation Notes",
  "",
  "- -",
  "",
  "#### Change Notes",
  "",
  "| Date | Change | Reason |",
  "| --- | --- | --- |",
  "| 2026-06-08 | Created | Fixture |"
].join("\n");

let workspaceRoot: string;

function io() {
  return {
    stdout: new PassThrough() as NodeJS.WriteStream,
    stderr: new PassThrough() as NodeJS.WriteStream
  };
}

function read(stream: NodeJS.WriteStream): string {
  return (stream as unknown as PassThrough).read()?.toString() ?? "";
}

async function specDir(): Promise<string> {
  return path.join(workspaceRoot, ...SPEC_DIR_PARTS);
}

async function indexContents(): Promise<string> {
  return readFile(path.join(await specDir(), "00.index.md"), "utf8");
}

async function specFileNames(): Promise<string[]> {
  return (await readdir(await specDir())).sort();
}

beforeEach(async () => {
  workspaceRoot = await mkdtemp(path.join(tmpdir(), "speckiwi-ir-cli-054-"));
  const dir = path.join(workspaceRoot, ...SPEC_DIR_PARTS);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, "00.index.md"), INDEX_MARKDOWN, "utf8");
  await writeFile(path.join(dir, "10.product-architecture.srs.md"), ARCH_MARKDOWN, "utf8");
});

afterEach(async () => {
  await rm(workspaceRoot, { recursive: true, force: true });
});

describe("IR-CLI-068 speckiwi scaffold-scope command", () => {
  it("IR-CLI-068 AC-1: scaffold-scope <name> creates the scope file and registers it in the index in one command", async () => {
    // TC-REQ-IR-CLI-054-AC1-01
    const before = await specFileNames();
    expect(before).toEqual(["00.index.md", "10.product-architecture.srs.md"]);
    const streams = io();

    // --apply turns the default dry-run into a real scaffold: one command creates the file and
    // registers it. The next decade above ARCH's 10. document is 20., so the new file is
    // 20.payments.srs.md (scaffoldScope.nextScopeDocument, FR-NODE-065).
    const exitCode = await main(
      ["--root", workspaceRoot, "scaffold-scope", "Payments:PAY", "--apply"],
      streams
    );
    expect(exitCode).toBe(0);

    // The brand-new scope srs.md file now exists on disk.
    const after = await specFileNames();
    expect(after).toContain("20.payments.srs.md");
    const created = await readFile(path.join(await specDir(), "20.payments.srs.md"), "utf8");
    expect(created).toContain("| Scope | PAY |");
    expect(created).toContain("| Scope Name | Payments |");

    // The index registers the new document in BOTH the §2 SRS Documents and §4 Scope Map sections.
    const index = await indexContents();
    expect(index).toContain("[20.payments.srs.md](./20.payments.srs.md)");
    expect(index).toMatch(/\|\s*Payments\s*\|\s*\[?20\.payments\.srs\.md[^\n]*\|\s*PAY\s*\|/);
    const payRows = index.split("\n").filter((line) => /\|\s*Payments\s*\|/.test(line));
    expect(payRows.length).toBe(2);
  });

  it("IR-CLI-068 AC-2: scaffold-scope <name:PREFIX> uses the given prefix instead of inferring one", async () => {
    // TC-REQ-IR-CLI-054-AC2-01
    const streams = io();

    // The `<name:PREFIX>` argument pins the prefix to BILL rather than inferring BILLING from the
    // name. --apply so the registered rows are observable on disk.
    const exitCode = await main(
      ["--root", workspaceRoot, "scaffold-scope", "Billing:BILL", "--apply"],
      streams
    );
    expect(exitCode).toBe(0);

    const created = await readFile(path.join(await specDir(), "20.billing.srs.md"), "utf8");
    // The new scope document carries the explicit BILL prefix, not the inferred BILLING.
    expect(created).toContain("| Scope | BILL |");
    expect(created).not.toContain("| Scope | BILLING |");

    // Both registered index rows carry the explicit BILL prefix in the Prefix column.
    const index = await indexContents();
    const billRows = index.split("\n").filter((line) => /\|\s*Billing\s*\|/.test(line));
    expect(billRows.length).toBe(2);
    for (const row of billRows) {
      expect(row).toMatch(/\|\s*BILL\s*\|/);
      expect(row).not.toMatch(/\|\s*BILLING\s*\|/);
    }
  });

  it("IR-CLI-068 AC-3: scaffold-scope --dry-run prints a preview and writes no file", async () => {
    // TC-REQ-IR-CLI-054-AC3-01
    const beforeIndex = await indexContents();
    const beforeFiles = await specFileNames();
    const streams = io();

    // --dry-run (also the default with no --apply) previews the scaffold without touching disk.
    const exitCode = await main(
      ["--root", workspaceRoot, "scaffold-scope", "Payments:PAY", "--dry-run"],
      streams
    );
    expect(exitCode).toBe(0);

    // A human-readable preview of the would-be scope is printed.
    const output = read(streams.stdout);
    expect(output).toContain("20.payments.srs.md");
    expect(output).toContain("PAY");

    // No file is created and the index is byte-identical: nothing was written.
    expect(await specFileNames()).toEqual(beforeFiles);
    expect(await indexContents()).toBe(beforeIndex);
    expect(await indexContents()).not.toContain("20.payments.srs.md");
  });

  it("IR-CLI-068 AC-4: scaffold-scope --json emits the mutation result envelope", async () => {
    // TC-REQ-IR-CLI-054-AC4-01
    const streams = io();

    // --json emits the standard mutation Result envelope ({ ok, value, diagnostics }) carrying the
    // scaffoldScope output ({ dryRun, document, filePreview, srsDocumentsRow, scopeMapRow }),
    // consistent with the other mutation commands.
    const exitCode = await main(
      ["--root", workspaceRoot, "scaffold-scope", "Payments:PAY", "--json"],
      streams
    );
    expect(exitCode).toBe(0);

    const parsed = JSON.parse(read(streams.stdout)) as {
      ok: boolean;
      value: {
        dryRun: boolean;
        document: string;
        filePreview: string;
        srsDocumentsRow: string;
        scopeMapRow: string;
      };
      diagnostics: unknown[];
    };

    expect(parsed.ok).toBe(true);
    expect(Array.isArray(parsed.diagnostics)).toBe(true);
    // No --apply -> dryRun is true and nothing is written.
    expect(parsed.value.dryRun).toBe(true);
    expect(parsed.value.document).toBe("20.payments.srs.md");
    expect(parsed.value.filePreview).toContain("| Scope | PAY |");
    expect(parsed.value.srsDocumentsRow).toContain("PAY");
    expect(parsed.value.scopeMapRow).toContain("PAY");

    // The envelope's dryRun claim is truthful: the document was not created.
    expect(await specFileNames()).not.toContain("20.payments.srs.md");
  });
});
