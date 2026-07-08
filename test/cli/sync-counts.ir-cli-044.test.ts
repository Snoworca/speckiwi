import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { main } from "../../src/cli/index.js";

// IR-CLI-044 — speckiwi sync-counts command.
//
// The speckiwi sync-counts command delegates to the syncCounts core (FR-NODE-050), defaults to a
// non-writing check, writes the index summary cells only with --apply, supports --json output, and
// returns a non-zero exit code under --check when count drift exists so it can gate CI.
//
// Implementation Note (2026-06-08): default invocation (no flag) prints the drift report and exits
// 0; --check exits non-zero when drift exists (CI gate); --apply writes the cells. --check differs
// from the default only by forcing the non-zero gate exit.
//
// The workspace fixture below intentionally declares stale Status/Type summary counts that differ
// from the actual GLOBAL (cross-target) record counts, so drift detection, the rewrite, and the
// CI gate exit all have concrete pinned targets:
//   declared: status planned=5 / verified=9 ; type functional=7 / interface=3
//   actual:   status planned=1 / verified=1 ; type functional=1 / interface=1

const SPEC_DIR_PARTS = ["docs", "spec"] as const;

const INDEX_MARKDOWN = [
  "# SpecKiwi Sync-Counts CLI Fixture Index",
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
  "Sync-counts CLI fixture index.",
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
  "| v2.0.0 | version | planned | Second fixture target |",
  "",
  "## 4. Scope Map",
  "",
  "| Scope | Document | Prefix | Description |",
  "|---|---|---|---|",
  "| Product Architecture | [10.product-architecture.srs.md](./10.product-architecture.srs.md) | ARCH | Architecture |",
  "",
  "## 5. Status Summary",
  "",
  "| Status | Count |",
  "|---|---:|",
  "| planned | 5 |",
  "| in_progress | 0 |",
  "| blocked | 0 |",
  "| implemented | 0 |",
  "| verified | 9 |",
  "| discarded | 0 |",
  "",
  "## 6. Requirement Type Summary",
  "",
  "| Type | Prefix | Count |",
  "|---|---|---:|",
  "| functional | FR | 7 |",
  "| interface | IR | 3 |",
  "",
  "## 7. Completed Work Log",
  "",
  "| Date | Target | Scope | Requirement IDs | Summary |",
  "|---|---|---|---|---|"
].join("\n");

function requirementBlock(options: {
  id: string;
  title: string;
  type: string;
  target: string;
  status: string;
  stability: string;
}): string {
  return [
    `### ${options.id} — ${options.title}`,
    "",
    "| Field | Value |",
    "| --- | --- |",
    `| Type | ${options.type} |`,
    `| Target | ${options.target} |`,
    `| Status | ${options.status} |`,
    "| Priority | high |",
    "| Tags | fixture |",
    "| Risk | low |",
    `| Stability | ${options.stability} |`,
    "| Verification Method | test |",
    "| GitHub Issue | - |",
    "| Related Docs | - |",
    "",
    "#### Requirement",
    "",
    `Statement for ${options.id}.`,
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

// Two records spread across two targets, so a GLOBAL (no-filter) recount differs from any single
// target count. Actual GLOBAL counts: planned=1, verified=1, functional=1, interface=1.
const SRS_MARKDOWN = [
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
  requirementBlock({
    id: "FR-ARCH-001",
    title: "Planned functional requirement",
    type: "functional",
    target: "v1.0.0",
    status: "planned",
    stability: "evolving"
  }),
  "",
  requirementBlock({
    id: "IR-ARCH-002",
    title: "Verified interface requirement",
    type: "interface",
    target: "v2.0.0",
    status: "verified",
    stability: "stable"
  })
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

async function indexContents(): Promise<string> {
  return readFile(path.join(workspaceRoot, ...SPEC_DIR_PARTS, "00.index.md"), "utf8");
}

beforeEach(async () => {
  workspaceRoot = await mkdtemp(path.join(tmpdir(), "speckiwi-ir-cli-044-"));
  const specDir = path.join(workspaceRoot, ...SPEC_DIR_PARTS);
  await mkdir(specDir, { recursive: true });
  await writeFile(path.join(specDir, "00.index.md"), INDEX_MARKDOWN, "utf8");
  await writeFile(path.join(specDir, "10.product-architecture.srs.md"), SRS_MARKDOWN, "utf8");
});

afterEach(async () => {
  await rm(workspaceRoot, { recursive: true, force: true });
});

describe("IR-CLI-044 speckiwi sync-counts command", () => {
  it("IR-CLI-044 AC-1: sync-counts with no apply prints a per-cell drift report and writes no file", async () => {
    // TC-REQ-IR-CLI-044-AC1-01
    const before = await indexContents();
    const streams = io();

    // Default invocation (no flag) reports drift and exits 0 (per Implementation Note).
    const exitCode = await main(["--root", workspaceRoot, "sync-counts"], streams);
    expect(exitCode).toBe(0);

    // The per-cell drift report names each drifting cell and its declared-vs-actual counts.
    const output = read(streams.stdout);
    expect(output).toContain("planned");
    expect(output).toContain("verified");
    expect(output).toContain("functional");
    expect(output).toContain("interface");

    // No write: the on-disk index is byte-identical and still carries the stale declared cells.
    expect(await indexContents()).toBe(before);
    expect(await indexContents()).toContain("| planned | 5 |");
    expect(await indexContents()).toContain("| functional | FR | 7 |");
  });

  it("IR-CLI-044 AC-2: sync-counts --apply updates the index Status Summary and Requirement Type Summary cells", async () => {
    // TC-REQ-IR-CLI-044-AC2-01
    const beforeLines = (await indexContents()).split("\n");
    const streams = io();

    const exitCode = await main(["--root", workspaceRoot, "sync-counts", "--apply"], streams);
    expect(exitCode).toBe(0);

    const after = await indexContents();

    // Summary cells are rewritten to the GLOBAL actual record counts.
    expect(after).toContain("| planned | 1 |");
    expect(after).toContain("| verified | 1 |");
    expect(after).toContain("| functional | FR | 1 |");
    expect(after).toContain("| interface | IR | 1 |");

    // The stale declared cells are gone.
    expect(after).not.toContain("| planned | 5 |");
    expect(after).not.toContain("| verified | 9 |");
    expect(after).not.toContain("| functional | FR | 7 |");
    expect(after).not.toContain("| interface | IR | 3 |");

    // Only the four drifting count cells changed; every other line is byte-identical.
    const afterLines = after.split("\n");
    expect(afterLines.length).toBe(beforeLines.length);
    const changed: number[] = [];
    for (let i = 0; i < beforeLines.length; i += 1) {
      if (beforeLines[i] !== afterLines[i]) changed.push(i);
    }
    expect(changed.length).toBe(4);
  });

  it("IR-CLI-044 AC-3: sync-counts --json emits the standard mutation result envelope", async () => {
    // TC-REQ-IR-CLI-044-AC3-01
    const streams = io();

    const exitCode = await main(["--root", workspaceRoot, "sync-counts", "--json"], streams);
    expect(exitCode).toBe(0);

    // --json emits the standard Result envelope ({ ok, value, diagnostics }) carrying the
    // syncCounts result ({ written, cells }) consistent with other mutation commands.
    const parsed = JSON.parse(read(streams.stdout)) as {
      ok: boolean;
      value: { written: boolean; cells: Array<{ section: string; key: string; expected: number; actual: number }> };
      diagnostics: unknown[];
    };

    expect(parsed.ok).toBe(true);
    expect(Array.isArray(parsed.diagnostics)).toBe(true);
    // Default (no apply) is a check: it reports drift but does not write.
    expect(parsed.value.written).toBe(false);
    expect(parsed.value.cells).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ section: "status", key: "planned", expected: 5, actual: 1 }),
        expect.objectContaining({ section: "status", key: "verified", expected: 9, actual: 1 }),
        expect.objectContaining({ section: "type", key: "functional", expected: 7, actual: 1 }),
        expect.objectContaining({ section: "type", key: "interface", expected: 3, actual: 1 })
      ])
    );
  });

  it("IR-CLI-044 AC-4: sync-counts --check returns a non-zero exit code when a summary count drifts", async () => {
    // TC-REQ-IR-CLI-044-AC4-01
    const before = await indexContents();
    const driftStreams = io();

    // Drift exists (declared != actual), so --check must gate CI with a non-zero exit.
    const driftExit = await main(["--root", workspaceRoot, "sync-counts", "--check"], driftStreams);
    expect(driftExit).not.toBe(0);

    // --check does not write: the index is unchanged.
    expect(await indexContents()).toBe(before);

    // After --apply settles the counts, --check finds no drift and exits 0.
    expect(await main(["--root", workspaceRoot, "sync-counts", "--apply"], io())).toBe(0);
    const settledStreams = io();
    const settledExit = await main(["--root", workspaceRoot, "sync-counts", "--check"], settledStreams);
    expect(settledExit).toBe(0);
  });
});
