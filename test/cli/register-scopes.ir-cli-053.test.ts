import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { main } from "../../src/cli/index.js";

// IR-CLI-067 — speckiwi register-scopes command.
//
// The speckiwi register-scopes command delegates to the registerScopes core (FR-NODE-064) to
// batch-register unregistered scope documents into the Scope Map, defaults to dry-run, writes only
// with --apply, and supports --json.
//
// Red-phase suite (T-PH004-49): one test case per acceptance criterion (AC-1..AC-4). These cases pin
// the future CLI contract before src/cli/index.ts / src/cli/commands/mutations.ts teach the CLI the
// register-scopes command, so the whole suite fails today — commander rejects the unknown
// register-scopes command (non-zero usage exit, no mutation payload printed) — until the green task
// (T-PH004-50) wires the command against the existing core mutation
// (src/core/mutation/register-scopes.ts registerScopes, FR-NODE-064): a dry-run plan of Scope Map
// additions, an --apply that inserts the rows, a --json mutation result envelope, and a per-item
// skip reason for every prefix-conflicting document.
//
// Contract under test (SRS docs/spec/30.cli-interface.srs.md IR-CLI-067):
//   - AC-1: speckiwi register-scopes with no apply prints the planned Scope Map additions and writes
//           no file.
//   - AC-2: speckiwi register-scopes --apply inserts the Scope Map rows.
//   - AC-3: speckiwi register-scopes --json emits the mutation result envelope.
//   - AC-4: speckiwi register-scopes reports a skip reason for each prefix-conflicting document.
//
// Fixture: the Scope Map registers only the ARCH document. Two additional discoverable scope
// documents are absent from the Scope Map (the SRS-W018 unregistered set):
//   - 20.extra.srs.md holds FR-EXTRA-001  -> inferred prefix EXTRA (the first claimant)
//   - 30.dup.srs.md   holds FR-EXTRA-002  -> inferred prefix EXTRA collides with the first claimant
// so registerScopes plans to add exactly one EXTRA Scope Map row and skips the colliding document
// with the `prefix-conflict` reason.

const SPEC_DIR_PARTS = ["docs", "spec"] as const;

const INDEX_MARKDOWN = [
  "# SpecKiwi Register-Scopes CLI Fixture Index",
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
  "Register-scopes CLI fixture index.",
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
  "| planned | 3 |",
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
  "| functional | FR | 3 |",
  "",
  "## 7. Completed Work Log",
  "",
  "| Date | Target | Scope | Requirement IDs | Summary |",
  "|---|---|---|---|---|"
].join("\n");

function scopeDocument(options: {
  title: string;
  scope: string;
  scopeName: string;
  requirementId: string;
  requirementTitle: string;
}): string {
  return [
    `# ${options.title}`,
    "",
    "| Field | Value |",
    "|---|---|",
    "| Document Type | scope_srs |",
    `| Scope | ${options.scope} |`,
    `| Scope Name | ${options.scopeName} |`,
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
    `### ${options.requirementId} — ${options.requirementTitle}`,
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
    `Statement for ${options.requirementId}.`,
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
}

const ARCH_MARKDOWN = scopeDocument({
  title: "Product Architecture",
  scope: "ARCH",
  scopeName: "Product Architecture",
  requirementId: "FR-ARCH-001",
  requirementTitle: "Registered architecture requirement"
});

// Unregistered scope document #1: prefix EXTRA, the first claimant — registerScopes adds its row.
const EXTRA_MARKDOWN = scopeDocument({
  title: "Extra Scope",
  scope: "EXTRA",
  scopeName: "Extra Scope",
  requirementId: "FR-EXTRA-001",
  requirementTitle: "Unregistered extra requirement"
});

// Unregistered scope document #2: prefix EXTRA collides with the first claimant -> prefix-conflict.
const DUP_MARKDOWN = scopeDocument({
  title: "Duplicate Prefix Scope",
  scope: "EXTRA",
  scopeName: "Duplicate Prefix Scope",
  requirementId: "FR-EXTRA-002",
  requirementTitle: "Prefix-conflicting requirement"
});

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

async function indexContents(): Promise<string> {
  return readFile(path.join(workspaceRoot, ...SPEC_DIR_PARTS, "00.index.md"), "utf8");
}

beforeEach(async () => {
  workspaceRoot = await mkdtemp(path.join(tmpdir(), "speckiwi-ir-cli-053-"));
  const specDir = path.join(workspaceRoot, ...SPEC_DIR_PARTS);
  await mkdir(specDir, { recursive: true });
  await writeFile(path.join(specDir, "00.index.md"), INDEX_MARKDOWN, "utf8");
  await writeFile(path.join(specDir, "10.product-architecture.srs.md"), ARCH_MARKDOWN, "utf8");
  await writeFile(path.join(specDir, "20.extra.srs.md"), EXTRA_MARKDOWN, "utf8");
  await writeFile(path.join(specDir, "30.dup.srs.md"), DUP_MARKDOWN, "utf8");
});

afterEach(async () => {
  await rm(workspaceRoot, { recursive: true, force: true });
});

describe("IR-CLI-067 speckiwi register-scopes command", () => {
  it("IR-CLI-067 AC-1: register-scopes with no apply prints the planned Scope Map additions and writes no file", async () => {
    // TC-REQ-IR-CLI-053-AC1-01
    const before = await indexContents();
    const streams = io();

    // Default invocation (no --apply) is a dry-run: it lists the planned additions and exits 0.
    const exitCode = await main(["--root", workspaceRoot, "register-scopes"], streams);
    expect(exitCode).toBe(0);

    // The dry-run plan names the unregistered EXTRA document it would add to the Scope Map.
    const output = read(streams.stdout);
    expect(output).toContain("20.extra.srs.md");
    expect(output).toContain("EXTRA");

    // No write: the on-disk index is byte-identical and the Scope Map still holds only ARCH.
    expect(await indexContents()).toBe(before);
    expect(await indexContents()).not.toContain("20.extra.srs.md");
  });

  it("IR-CLI-067 AC-2: register-scopes --apply inserts the Scope Map rows", async () => {
    // TC-REQ-IR-CLI-053-AC2-01
    const streams = io();

    const exitCode = await main(["--root", workspaceRoot, "register-scopes", "--apply"], streams);
    expect(exitCode).toBe(0);

    const after = await indexContents();

    // The EXTRA scope document is now a Scope Map row carrying its inferred prefix.
    expect(after).toContain("20.extra.srs.md");
    expect(after).toMatch(/\|\s*EXTRA\s*\|\s*\.\/20\.extra\.srs\.md\s*\|\s*EXTRA\s*\|/);

    // The pre-existing ARCH registration is preserved.
    expect(after).toContain("./10.product-architecture.srs.md");

    // The prefix-conflicting document is NOT inserted (only one EXTRA row is added).
    expect(after).not.toContain("30.dup.srs.md");
    const extraRows = after.split("\n").filter((line) => /\|\s*EXTRA\s*\|/.test(line));
    expect(extraRows.length).toBe(1);
  });

  it("IR-CLI-067 AC-3: register-scopes --json emits the mutation result envelope", async () => {
    // TC-REQ-IR-CLI-053-AC3-01
    const streams = io();

    const exitCode = await main(["--root", workspaceRoot, "register-scopes", "--json"], streams);
    expect(exitCode).toBe(0);

    // --json emits the standard mutation Result envelope ({ ok, value, diagnostics }) carrying the
    // registerScopes output ({ dryRun, items }) consistent with other mutation commands.
    const parsed = JSON.parse(read(streams.stdout)) as {
      ok: boolean;
      value: { dryRun: boolean; items: Array<{ document: string; prefix?: string; skipReason?: string }> };
      diagnostics: unknown[];
    };

    expect(parsed.ok).toBe(true);
    expect(Array.isArray(parsed.diagnostics)).toBe(true);
    // No --apply -> dryRun is true and nothing is written.
    expect(parsed.value.dryRun).toBe(true);
    // The plan contains the EXTRA addition and the colliding skip entry.
    expect(parsed.value.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ document: "docs/spec/20.extra.srs.md", prefix: "EXTRA" }),
        expect.objectContaining({ document: "docs/spec/30.dup.srs.md", skipReason: "prefix-conflict" })
      ])
    );
  });

  it("IR-CLI-067: register-scopes --dry-run forwards dryRun and writes no file", async () => {
    // FND-003: the --dry-run flag must be a declared option that the handler forwards so the explicit
    // dry-run preview never writes. The CLI declares --apply/--dry-run/--json, so an explicit --dry-run
    // is a non-writing plan whose envelope reports dryRun=true.
    const before = await indexContents();
    const streams = io();

    const exitCode = await main(["--root", workspaceRoot, "register-scopes", "--dry-run", "--json"], streams);
    expect(exitCode).toBe(0);

    const parsed = JSON.parse(read(streams.stdout)) as { ok: boolean; value: { dryRun: boolean } };
    expect(parsed.ok).toBe(true);
    expect(parsed.value.dryRun).toBe(true);

    // No write: the on-disk index is byte-identical and the EXTRA row was never inserted.
    expect(await indexContents()).toBe(before);
    expect(await indexContents()).not.toContain("20.extra.srs.md");
  });

  it("IR-CLI-067: register-scopes --apply --dry-run lets dry-run supersede apply (no write)", async () => {
    // FND-003: when both flags are present, dry-run must win — the handler forwards dryRun so apply
    // cannot silently override an explicit dry-run preview into a write.
    const before = await indexContents();
    const streams = io();

    const exitCode = await main(["--root", workspaceRoot, "register-scopes", "--apply", "--dry-run", "--json"], streams);
    expect(exitCode).toBe(0);

    const parsed = JSON.parse(read(streams.stdout)) as { ok: boolean; value: { dryRun: boolean } };
    expect(parsed.value.dryRun).toBe(true);

    // No write: --dry-run supersedes --apply.
    expect(await indexContents()).toBe(before);
    expect(await indexContents()).not.toContain("20.extra.srs.md");
  });

  it("IR-CLI-067 AC-4: register-scopes reports a skip reason for each prefix-conflicting document", async () => {
    // TC-REQ-IR-CLI-053-AC4-01
    const streams = io();

    const exitCode = await main(["--root", workspaceRoot, "register-scopes", "--json"], streams);
    expect(exitCode).toBe(0);

    const parsed = JSON.parse(read(streams.stdout)) as {
      ok: boolean;
      value: { items: Array<{ document: string; prefix?: string; skipReason?: string }> };
    };

    // The colliding EXTRA document is reported as skipped with the prefix-conflict reason rather
    // than added as a second EXTRA Scope Map row.
    const skipped = parsed.value.items.filter((item) => item.skipReason === "prefix-conflict");
    expect(skipped.length).toBe(1);
    expect(skipped[0]?.document).toBe("docs/spec/30.dup.srs.md");
  });
});
