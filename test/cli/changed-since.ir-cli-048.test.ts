import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { main } from "../../src/cli/index.js";
import { copyFixtureWorkspace } from "../fixtures/fixture-utils.js";

// IR-CLI-048 — `speckiwi changed-since <date>` command for a cross-requirement timeline.
//
// Red-phase suite (T-PH004-39): one test case per acceptance criterion (AC-1..AC-4). These cases pin
// the future CLI contract before `src/cli/index.ts` / `src/cli/commands/read.ts` teach the CLI a
// `changed-since` command, so the whole suite fails today — commander rejects the unknown
// `changed-since` command (non-zero usage exit, no timeline payload printed) — until the green task
// (T-PH004-40) wires the command against the existing parsed Change Notes
// (src/core/query/records.ts changeNotesFromTable → RequirementRecord.changeNotes, FR-PARSE-009)
// aggregated across every requirement (addition site src/core/query/summary.ts).
//
// Contract under test (SRS docs/spec/30.cli-interface.srs.md IR-CLI-048):
//
//   The speckiwi changed-since command aggregates requirements whose most recent Change Notes date is
//   on or after a given date across all requirements, supports optional target and scope filters and
//   json, and never writes a file.
//
//   - AC-1: `changed-since <date>` returns requirements with a Change Notes date on or after the date.
//   - AC-2: `changed-since <date> --target <t>` and `--scope <s>` restrict the result set.
//   - AC-3: `changed-since` with a malformed date returns exit code two.
//   - AC-4: `changed-since` with a future date returns an empty result set.
//
// Fixture pinning (deterministic — built on the mutation-target fixture, Active Target v1.0.0, whose
// Target Map registers v1.0.0 active + v1.1.0 planned). A second scope ("Platform Services", prefix
// PLAT) is registered at runtime so the --scope filter can be asserted by exclusion. Every fixture
// requirement carries a Change Notes table whose MOST RECENT (latest) row pins where it lands relative
// to the BOUNDARY date 2026-04-01:
//
//   - RECENT_ID  (FR-ARCH-010, target v1.0.0, scope ARCH): latest row 2026-05-01  → on/after boundary.
//   - BOUNDARY_ID(FR-ARCH-011, target v1.1.0, scope ARCH): latest row == 2026-04-01 (inclusive lower
//                 bound) and an EARLIER row 2026-01-15 → included by its most-recent row, not the old one.
//   - OLD_ID     (FR-ARCH-012, target v1.0.0, scope ARCH): latest row 2026-02-10  → strictly before
//                 boundary → excluded. Distinguishes "most recent date" from "any date".
//   - PLAT_ID    (FR-PLAT-001, target v1.0.0, scope PLAT): latest row 2026-05-20  → on/after boundary,
//                 but in a DIFFERENT scope so --scope ARCH excludes it.

const INDEX_DOC = path.join("docs", "spec", "00.index.md");
const ARCH_DOC = path.join("docs", "spec", "10.product-architecture.srs.md");
const PLAT_DOC = path.join("docs", "spec", "20.platform-services.srs.md");

const BOUNDARY = "2026-04-01";
const FUTURE = "2999-01-01";
const MALFORMED = "2026/04/01";
// Shape-valid (YYYY-MM-DD) but calendar-impossible: month 13 / day 45 never exist.
const IMPOSSIBLE_CALENDAR = "2026-13-45";

const RECENT_ID = "FR-ARCH-010";
const BOUNDARY_ID = "FR-ARCH-011";
const OLD_ID = "FR-ARCH-012";
const PLAT_ID = "FR-PLAT-001";

function io() {
  return { stdout: new PassThrough() as NodeJS.WriteStream, stderr: new PassThrough() as NodeJS.WriteStream };
}

/** Drains the output written to a finished run's stream. */
function drain(stream: NodeJS.WriteStream): string {
  return (stream as unknown as PassThrough).read()?.toString() ?? "";
}

/** A fully-formed requirement block whose Change Notes rows are emitted verbatim. */
function requirementBlock(
  id: string,
  options: { scope: string; target: string; changeNotes: Array<{ date: string; change: string; reason: string }> }
): string {
  const rows = options.changeNotes.map((row) => `| ${row.date} | ${row.change} | ${row.reason} |`);
  return [
    `### ${id} — Fixture ${id}`,
    "",
    "| Field | Value |",
    "| --- | --- |",
    "| Type | functional |",
    `| Target | ${options.target} |`,
    "| Status | planned |",
    "| Priority | medium |",
    "| Tags | fixture |",
    "| Risk | low |",
    "| Stability | stable |",
    "| Verification Method | test |",
    "| GitHub Issue | - |",
    "| Related Docs | - |",
    "",
    "#### Requirement",
    "",
    `Fixture requirement ${id}.`,
    "",
    "#### Rationale",
    "",
    "Fixture rationale.",
    "",
    "#### Acceptance Criteria",
    "",
    "- [ ] AC-1: First criterion.",
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
    ...rows
  ].join("\n");
}

/** Header for the second (PLAT) scope SRS document. */
function platScopeHeader(): string {
  return [
    "# Platform Services",
    "",
    "| Field | Value |",
    "|---|---|",
    "| Document Type | scope_srs |",
    "| Scope | PLAT |",
    "| Scope Name | Platform Services |",
    "",
    "## 1. Scope Overview",
    "",
    "Platform services scope.",
    "",
    "## 2. Scope Boundaries",
    "",
    "### In Scope",
    "",
    "- Platform.",
    "",
    "### Out of Scope",
    "",
    "- Nothing.",
    "",
    "## 3. Requirements",
    ""
  ].join("\n");
}

/**
 * Materializes the changed-since fixture on a copied mutation-target workspace:
 *   - appends the three ARCH requirements (recent / boundary / old) to the ARCH scope document,
 *   - registers a second scope (PLAT) in both the SRS Documents and Scope Map index tables,
 *   - writes the PLAT scope document carrying one recent requirement.
 */
async function appendChangedSinceFixture(root: string): Promise<void> {
  const archPath = path.join(root, ARCH_DOC);
  const archText = await readFile(archPath, "utf8");
  const archBlocks = [
    requirementBlock(RECENT_ID, {
      scope: "ARCH",
      target: "v1.0.0",
      changeNotes: [
        { date: "2026-03-01", change: "CreatedRecentZZ", reason: "ReasonCreatedRecentZZ" },
        { date: "2026-05-01", change: "AmendedRecentZZ", reason: "ReasonAmendedRecentZZ" }
      ]
    }),
    requirementBlock(BOUNDARY_ID, {
      scope: "ARCH",
      target: "v1.1.0",
      changeNotes: [
        { date: "2026-01-15", change: "CreatedBoundaryZZ", reason: "ReasonCreatedBoundaryZZ" },
        { date: BOUNDARY, change: "AmendedBoundaryZZ", reason: "ReasonAmendedBoundaryZZ" }
      ]
    }),
    requirementBlock(OLD_ID, {
      scope: "ARCH",
      target: "v1.0.0",
      changeNotes: [
        { date: "2026-01-05", change: "CreatedOldZZ", reason: "ReasonCreatedOldZZ" },
        { date: "2026-02-10", change: "AmendedOldZZ", reason: "ReasonAmendedOldZZ" }
      ]
    })
  ];
  await writeFile(archPath, `${archText.trimEnd()}\n\n${archBlocks.join("\n\n")}\n`, "utf8");

  // Register the PLAT scope in both the SRS Documents (§2) and Scope Map (§4) tables.
  const indexPath = path.join(root, INDEX_DOC);
  let indexText = await readFile(indexPath, "utf8");
  const platRow = "| Platform Services | [20.platform-services.srs.md](./20.platform-services.srs.md) | PLAT | Platform |";
  const archRow = "| Product Architecture | [10.product-architecture.srs.md](./10.product-architecture.srs.md) | ARCH | Architecture |";
  // Both tables carry the identical ARCH row; append the PLAT row after each occurrence.
  indexText = indexText.split(`${archRow}\n`).join(`${archRow}\n${platRow}\n`);
  await writeFile(indexPath, indexText, "utf8");

  // Write the PLAT scope document with one recent requirement.
  const platBlock = requirementBlock(PLAT_ID, {
    scope: "PLAT",
    target: "v1.0.0",
    changeNotes: [{ date: "2026-05-20", change: "CreatedPlatZZ", reason: "ReasonCreatedPlatZZ" }]
  });
  await writeFile(path.join(root, PLAT_DOC), `${platScopeHeader()}\n${platBlock}\n`, "utf8");
}

/** Walks parsed JSON for the first array of objects that each carry a string `id`. */
function findRequirementArray(parsed: unknown): Array<Record<string, unknown>> | undefined {
  const seen = new Set<unknown>();
  const stack: unknown[] = [parsed];
  while (stack.length > 0) {
    const node = stack.pop();
    if (!node || typeof node !== "object" || seen.has(node)) continue;
    seen.add(node);
    if (Array.isArray(node)) {
      if (node.length > 0 && node.every((item) => item && typeof item === "object" && typeof (item as Record<string, unknown>).id === "string")) {
        return node as Array<Record<string, unknown>>;
      }
      for (const item of node) stack.push(item);
      continue;
    }
    for (const value of Object.values(node as Record<string, unknown>)) stack.push(value);
  }
  return undefined;
}

/** The set of requirement ids in a changed-since --json payload. */
function idsFrom(out: string): string[] {
  const rows = findRequirementArray(JSON.parse(out));
  expect(rows, "changed-since --json must expose an array of requirement entries").toBeDefined();
  return (rows as Array<Record<string, unknown>>).map((row) => String(row.id));
}

describe("IR-CLI-048 — changed-since command for cross-requirement timeline", () => {
  // AC-1: `changed-since <date>` returns requirements with a Change Notes date on or after the date.
  it("IR-CLI-048 AC-1: changed-since returns requirements whose most recent change is on or after the date", async () => {
    const root = await copyFixtureWorkspace("mutation-target");
    await appendChangedSinceFixture(root);

    const streams = io();
    const code = await main(["--root", root, "changed-since", BOUNDARY, "--json"], streams);
    const out = drain(streams.stdout);

    expect(code).toBe(0);
    const ids = idsFrom(out);

    // Most-recent-row semantics: RECENT (2026-05-01) and PLAT (2026-05-20) are after the boundary;
    // BOUNDARY (latest row == 2026-04-01) is included by the inclusive lower bound even though it also
    // has an earlier 2026-01-15 row. OLD (latest 2026-02-10) is excluded — proving the aggregation keys
    // on the MOST RECENT date, not on any older row.
    expect(ids).toContain(RECENT_ID);
    expect(ids).toContain(BOUNDARY_ID);
    expect(ids).toContain(PLAT_ID);
    expect(ids).not.toContain(OLD_ID);
    expect(out).not.toContain("undefined");
  });

  // AC-2: `changed-since <date> --target <t>` and `--scope <s>` restrict the result set.
  it("IR-CLI-048 AC-2: changed-since --target and --scope restrict the result set", async () => {
    const root = await copyFixtureWorkspace("mutation-target");
    await appendChangedSinceFixture(root);

    // --target v1.0.0 keeps RECENT (v1.0.0) and PLAT (v1.0.0) but drops BOUNDARY (v1.1.0). OLD is still
    // excluded by date.
    const targetStreams = io();
    const targetCode = await main(["--root", root, "changed-since", BOUNDARY, "--target", "v1.0.0", "--json"], targetStreams);
    const targetIds = idsFrom(drain(targetStreams.stdout));
    expect(targetCode).toBe(0);
    expect(targetIds).toContain(RECENT_ID);
    expect(targetIds).toContain(PLAT_ID);
    expect(targetIds).not.toContain(BOUNDARY_ID);
    expect(targetIds).not.toContain(OLD_ID);

    // --scope ARCH keeps the ARCH requirements (RECENT, BOUNDARY) but drops the PLAT-scope PLAT_ID.
    const scopeStreams = io();
    const scopeCode = await main(["--root", root, "changed-since", BOUNDARY, "--scope", "ARCH", "--json"], scopeStreams);
    const scopeIds = idsFrom(drain(scopeStreams.stdout));
    expect(scopeCode).toBe(0);
    expect(scopeIds).toContain(RECENT_ID);
    expect(scopeIds).toContain(BOUNDARY_ID);
    expect(scopeIds).not.toContain(PLAT_ID);
  });

  // AC-3: `changed-since` with a malformed date returns exit code two.
  it("IR-CLI-048 AC-3: changed-since with a malformed date returns exit code two", async () => {
    const root = await copyFixtureWorkspace("mutation-target");
    await appendChangedSinceFixture(root);

    const streams = io();
    const code = await main(["--root", root, "changed-since", MALFORMED], streams);
    const err = drain(streams.stderr);

    // A malformed date is a usage error: exit code exactly two, with a handled message (not a raw stack).
    expect(code).toBe(2);
    expect(err.toLowerCase()).toMatch(/date|yyyy-mm-dd/);
    expect(err).not.toContain("at Object.<anonymous>");
  });

  // AC-3 (calendar guard): a date that is shape-valid (YYYY-MM-DD) but calendar-impossible (month 13,
  // day 45) must also be a handled usage error (exit 2), not a silently-accepted exit-0 query. The
  // shape regex alone admits 2026-13-45; the calendar gate must reject it.
  it("IR-CLI-048 AC-3: changed-since with a calendar-impossible date returns exit code two", async () => {
    const root = await copyFixtureWorkspace("mutation-target");
    await appendChangedSinceFixture(root);

    const streams = io();
    const code = await main(["--root", root, "changed-since", IMPOSSIBLE_CALENDAR], streams);
    const err = drain(streams.stderr);

    expect(code).toBe(2);
    expect(err.toLowerCase()).toMatch(/date|yyyy-mm-dd/);
    expect(err).not.toContain("at Object.<anonymous>");
  });

  // AC-4: `changed-since` with a future date returns an empty result set.
  it("IR-CLI-048 AC-4: changed-since with a future date returns an empty result set", async () => {
    const root = await copyFixtureWorkspace("mutation-target");
    await appendChangedSinceFixture(root);

    const streams = io();
    const code = await main(["--root", root, "changed-since", FUTURE, "--json"], streams);
    const out = drain(streams.stdout);
    const err = drain(streams.stderr);

    // A future lower bound excludes everything: a clean empty success, not an error.
    expect(code).toBe(0);
    expect(err).toBe("");
    const rows = findRequirementArray(JSON.parse(out));
    // The payload must still expose an (empty) array — assert the count is zero by walking the parsed
    // JSON for any requirement-entry array; none should be found, or the found array must be empty.
    expect(rows ?? []).toHaveLength(0);
    expect(out).not.toContain("undefined");
  });
});
