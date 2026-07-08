import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { main } from "../../src/cli/index.js";
import { copyFixtureWorkspace } from "../fixtures/fixture-utils.js";

// IR-CLI-061 — `speckiwi history <id>` command for requirement Change Notes.
//
// Red-phase suite (T-PH004-37): one test case per acceptance criterion (AC-1..AC-4). These cases pin
// the future CLI contract before `src/cli/index.ts` / `src/cli/commands/read.ts` teach the CLI a
// `history` command, so the whole suite fails today — commander rejects the unknown `history`
// command (non-zero usage exit, no Change Notes payload printed) — until the green task (T-PH004-38)
// wires the command against the existing parsed Change Notes (src/core/query/records.ts
// changeNotesFromTable → RequirementRecord.changeNotes, FR-PARSE-009).
//
// Contract under test (SRS docs/spec/30.cli-interface.srs.md IR-CLI-061):
//
//   The speckiwi history command outputs the Change Notes of a single requirement as date, change,
//   and reason rows sorted chronologically, supports an optional since filter and json, and never
//   writes a file.
//
//   - AC-1: `speckiwi history <id>` lists the requirement Change Notes rows in ascending date order.
//   - AC-2: `speckiwi history <id> --since <date>` includes only rows on or after the date inclusive.
//   - AC-3: `speckiwi history` on an unknown requirement id returns a non-zero exit code.
//   - AC-4: `speckiwi history` on a requirement with no Change Notes returns an empty result without
//           error.
//
// Fixture pinning (deterministic — appended to the valid-basic ARCH scope, Active Target v1.0.0):
//   - HIST_ID "FR-ARCH-030" carries three Change Notes rows authored OUT OF chronological order in the
//     Markdown table (2026-03-10, then 2026-01-05, then 2026-02-20). Each row carries a unique
//     change/reason token so a date-sorted listing and a --since filter can be asserted by exact
//     value, and ascending order can be distinguished from source order.
//   - EMPTY_ID "FR-ARCH-031" carries a Change Notes table with a header but ZERO data rows.

function io() {
  return { stdout: new PassThrough() as NodeJS.WriteStream, stderr: new PassThrough() as NodeJS.WriteStream };
}

/** Drains the output written to a finished run's stream. */
function drain(stream: NodeJS.WriteStream): string {
  return (stream as unknown as PassThrough).read()?.toString() ?? "";
}

const HIST_ID = "FR-ARCH-030";
const EMPTY_ID = "FR-ARCH-031";
const UNKNOWN_ID = "FR-ARCH-999";

// The three Change Notes rows for HIST_ID, keyed by their unique tokens. Authored order in the
// Markdown table is deliberately NOT chronological (see middle/early/late below) so the test can tell
// "sorted ascending by date" apart from "echoed in source order".
const EARLY = { date: "2026-01-05", change: "CreatedRowZZ", reason: "ReasonCreatedZZ" };
const MIDDLE = { date: "2026-02-20", change: "AmendedRowZZ", reason: "ReasonAmendedZZ" };
const LATE = { date: "2026-03-10", change: "VerifiedRowZZ", reason: "ReasonVerifiedZZ" };

/** A fully-formed requirement block; `changeNotesRows` are emitted verbatim into the Change Notes table. */
function requirementBlock(id: string, changeNotesRows: Array<{ date: string; change: string; reason: string }>): string {
  const rows = changeNotesRows.map((row) => `| ${row.date} | ${row.change} | ${row.reason} |`);
  return [
    `### ${id} — Fixture ${id}`,
    "",
    "| Field | Value |",
    "| --- | --- |",
    "| Type | functional |",
    "| Target | v1.0.0 |",
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

/** Appends the history fixtures to the valid-basic ARCH scope document. */
async function appendHistoryFixture(root: string): Promise<void> {
  const specPath = path.join(root, "docs", "spec", "10.product-architecture.srs.md");
  const text = await readFile(specPath, "utf8");
  const blocks = [
    // Authored out of chronological order: LATE, then EARLY, then MIDDLE.
    requirementBlock(HIST_ID, [LATE, EARLY, MIDDLE]),
    // No Change Notes data rows (header only).
    requirementBlock(EMPTY_ID, [])
  ];
  await writeFile(specPath, `${text.trimEnd()}\n\n${blocks.join("\n\n")}\n`, "utf8");
}

/** Walks a parsed JSON document for the first array of objects that each carry a string `date`. */
function findChangeNoteArray(parsed: unknown): Array<Record<string, unknown>> | undefined {
  const seen = new Set<unknown>();
  const stack: unknown[] = [parsed];
  while (stack.length > 0) {
    const node = stack.pop();
    if (!node || typeof node !== "object" || seen.has(node)) continue;
    seen.add(node);
    if (Array.isArray(node)) {
      if (node.every((item) => item && typeof item === "object" && typeof (item as Record<string, unknown>).date === "string")) {
        return node as Array<Record<string, unknown>>;
      }
      for (const item of node) stack.push(item);
      continue;
    }
    for (const value of Object.values(node as Record<string, unknown>)) stack.push(value);
  }
  return undefined;
}

describe("IR-CLI-061 — history command for requirement Change Notes", () => {
  // AC-1: `history <id>` lists the requirement Change Notes rows in ascending date order.
  it("IR-CLI-061 AC-1: history lists Change Notes rows in ascending date order", async () => {
    const root = await copyFixtureWorkspace("valid-basic");
    await appendHistoryFixture(root);

    const streams = io();
    const code = await main(["--root", root, "history", HIST_ID, "--json"], streams);
    const out = drain(streams.stdout);

    expect(code).toBe(0);
    const parsed: unknown = JSON.parse(out);
    const rows = findChangeNoteArray(parsed);
    expect(rows, "history --json must expose an array of Change Notes rows").toBeDefined();

    // All three authored rows are present.
    expect(rows).toHaveLength(3);

    // Sorted ascending by date — NOT the source order (LATE, EARLY, MIDDLE). Pin the exact dates,
    // changes, and reasons so the chronological sort is verified by value, not merely by count.
    const dates = (rows as Array<Record<string, unknown>>).map((row) => row.date);
    expect(dates).toEqual([EARLY.date, MIDDLE.date, LATE.date]);
    expect((rows as Array<Record<string, unknown>>).map((row) => row.change)).toEqual([
      EARLY.change,
      MIDDLE.change,
      LATE.change
    ]);
    expect((rows as Array<Record<string, unknown>>).map((row) => row.reason)).toEqual([
      EARLY.reason,
      MIDDLE.reason,
      LATE.reason
    ]);
    expect(out).not.toContain("undefined");
  });

  // AC-2: `history <id> --since <date>` includes only rows on or after the date inclusive.
  it("IR-CLI-061 AC-2: history --since includes only rows on or after the date inclusive", async () => {
    const root = await copyFixtureWorkspace("valid-basic");
    await appendHistoryFixture(root);

    // --since lands exactly on the MIDDLE row's date: MIDDLE is included (inclusive), EARLY excluded,
    // LATE included.
    const streams = io();
    const code = await main(["--root", root, "history", HIST_ID, "--since", MIDDLE.date, "--json"], streams);
    const out = drain(streams.stdout);

    expect(code).toBe(0);
    const rows = findChangeNoteArray(JSON.parse(out));
    expect(rows, "history --since --json must expose the filtered Change Notes rows").toBeDefined();

    const dates = (rows as Array<Record<string, unknown>>).map((row) => row.date);
    // Inclusive lower bound: the boundary date itself (MIDDLE) is kept.
    expect(dates).toContain(MIDDLE.date);
    expect(dates).toContain(LATE.date);
    // The earlier row is excluded.
    expect(dates).not.toContain(EARLY.date);
    expect(rows).toHaveLength(2);
    // Still chronological among the survivors.
    expect(dates).toEqual([MIDDLE.date, LATE.date]);
  });

  // AC-3: `history` on an unknown requirement id returns a non-zero exit code.
  it("IR-CLI-061 AC-3: history on an unknown requirement id exits non-zero", async () => {
    const root = await copyFixtureWorkspace("valid-basic");
    await appendHistoryFixture(root);

    const streams = io();
    const code = await main(["--root", root, "history", UNKNOWN_ID], streams);
    const out = drain(streams.stdout);
    const err = drain(streams.stderr);
    const combined = `${out}${err}`;

    // Unknown id must fail with a non-zero exit code, not a silent empty success.
    expect(code).not.toBe(0);
    expect(code).toBeGreaterThan(0);
    // The offending id is surfaced in a handled not-found style message, not a raw thrown stack.
    expect(combined).toContain(UNKNOWN_ID);
    expect(combined.toLowerCase()).toMatch(/not found|unknown|no such/);
    expect(combined).not.toContain("at Object.<anonymous>");
  });

  // AC-4: `history` on a requirement with no Change Notes returns an empty result without error.
  it("IR-CLI-061 AC-4: history on a requirement with no Change Notes returns an empty result without error", async () => {
    const root = await copyFixtureWorkspace("valid-basic");
    await appendHistoryFixture(root);

    const streams = io();
    const code = await main(["--root", root, "history", EMPTY_ID, "--json"], streams);
    const out = drain(streams.stdout);
    const err = drain(streams.stderr);

    // A requirement that exists but has no Change Notes is a clean, empty success — not an error.
    expect(code).toBe(0);
    expect(err).toBe("");
    const rows = findChangeNoteArray(JSON.parse(out));
    expect(rows, "history --json must expose an array even when empty").toBeDefined();
    expect(rows).toHaveLength(0);
    expect(out).not.toContain("undefined");
  });
});
