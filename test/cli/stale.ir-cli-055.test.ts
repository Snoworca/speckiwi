import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { main } from "../../src/cli/index.js";
import { copyFixtureWorkspace } from "../fixtures/fixture-utils.js";

// IR-CLI-069 — `speckiwi stale` command for aging requirements.
//
// Red-phase suite (T-PH004-53): one test case per acceptance criterion (AC-1..AC-4). These cases pin
// the future CLI contract before `src/cli/index.ts` / `src/cli/commands/read.ts` / the addition site
// `src/core/query/summary.ts` teach the CLI a `stale` command, so the whole suite fails today —
// commander rejects the unknown `stale` command (non-zero usage exit, no stale payload printed) —
// until the green task (T-PH004-54) wires the command against the existing parsed Change Notes
// (src/core/query/records.ts changeNotesFromTable → RequirementRecord.changeNotes, FR-PARSE-009)
// and the per-record stability field.
//
// Contract under test (SRS docs/spec/30.cli-interface.srs.md IR-CLI-069):
//
//   The speckiwi stale command identifies requirements that have stayed in evolving stability past a
//   threshold measured by their most recent Change Notes date, computing age from SRS date metadata
//   only, supports optional target and json, and never writes a file.
//
//   - AC-1: speckiwi stale lists requirements in evolving stability whose latest Change Notes date is
//           older than the evolving-age threshold.
//   - AC-2: a configurable threshold flag flags requirements whose age exceeds the given number of days.
//   - AC-3: speckiwi stale computes age only from SRS date metadata and never reads outside the repo.
//   - AC-4: speckiwi stale writes no file.
//
// SCOPE RECONCILIATION (authoritative — IR-CLI-069 Implementation Notes 2026-06-08, the latest
// requirement-block decision): the originally drafted AC-2 `--evidence-age <days>` is REMOVED because
// EvidenceRow (types.ts EvidenceRow = id|type|reference|covers|notes) carries no date field, so
// evidence age is non-decidable as written. The decided contract is a SINGLE age axis driven by the
// most-recent Change Notes date, with a DEFAULT threshold of 90 days, overridable by `--evolving-age
// <days>`. The green addition site recorded in the requirement's Trace Links is src/core/query/
// summary.ts (a Change-Notes-date reader), not a validation rule — confirming the date-only,
// evidence-age-free interpretation. AC-2 below therefore pins the `--evolving-age <days>` override.
//
// Determinism under a real (non-injectable) clock: the production date helpers use `new Date()`
// directly (no injectable clock exists), so age is computed against the real system clock. To stay
// deterministic for ANY run date, the fixture pins each requirement's most-recent Change Notes date
// RELATIVE to the run's own "today" (computed here via the same `new Date()` basis):
//
//   - STALE_ID  (FR-ARCH-020, evolving):   latest Change Notes date == today-3650 (≈10 years old) →
//        far past BOTH the default 90-day threshold and any small custom threshold → always stale.
//   - FRESH_ID  (FR-ARCH-021, evolving):   latest Change Notes date == today (age 0) → never stale at
//        the default 90; excluded in AC-1, proving the threshold actually gates (not "all evolving").
//   - MIDAGE_ID (FR-ARCH-022, evolving):   latest Change Notes date == today-30 → NOT stale at the
//        default 90 but stale at `--evolving-age 7`; drives AC-2's override.
//   - STABLE_ID (FR-ARCH-023, stable):     latest Change Notes date == today-3650 (ancient) but
//        stability is `stable`, not `evolving` → excluded → proves the evolving-stability gate (AC-1).

function io() {
  return { stdout: new PassThrough() as NodeJS.WriteStream, stderr: new PassThrough() as NodeJS.WriteStream };
}

/** Drains the output written to a finished run's stream. */
function drain(stream: NodeJS.WriteStream): string {
  return (stream as unknown as PassThrough).read()?.toString() ?? "";
}

const ARCH_DOC = path.join("docs", "spec", "10.product-architecture.srs.md");

const STALE_ID = "FR-ARCH-020"; // evolving, ancient → stale at default threshold
const FRESH_ID = "FR-ARCH-021"; // evolving, today → never stale at default threshold
const MIDAGE_ID = "FR-ARCH-022"; // evolving, today-30 → stale only at a tighter custom threshold
const STABLE_ID = "FR-ARCH-023"; // stable (not evolving), ancient → excluded by the stability gate
const MALFORMED_ID = "FR-ARCH-024"; // evolving, unparseable most-recent Change Notes date (FND-007)

/** ISO YYYY-MM-DD for `today` minus `daysAgo`, on the same `new Date()` basis the command uses. */
function isoDaysAgo(daysAgo: number): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - daysAgo);
  return date.toISOString().slice(0, 10);
}

/** A fully-formed ARCH-scope requirement block whose Change Notes rows are emitted verbatim. */
function requirementBlock(
  id: string,
  options: { stability: string; target: string; changeNotes: Array<{ date: string; change: string; reason: string }> }
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
    `| Stability | ${options.stability} |`,
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

/**
 * Materializes the stale fixture on a copied mutation-target workspace (Active Target v1.0.0): appends
 * the four evolving/stable requirements to the ARCH scope document, each carrying a Change Notes table
 * whose MOST RECENT row pins its age relative to the run's own "today".
 */
async function appendStaleFixture(root: string): Promise<void> {
  const archPath = path.join(root, ARCH_DOC);
  const archText = await readFile(archPath, "utf8");
  const blocks = [
    requirementBlock(STALE_ID, {
      stability: "evolving",
      target: "v1.0.0",
      changeNotes: [
        { date: isoDaysAgo(3700), change: "CreatedStaleZZ", reason: "ReasonCreatedStaleZZ" },
        { date: isoDaysAgo(3650), change: "AmendedStaleZZ", reason: "ReasonAmendedStaleZZ" }
      ]
    }),
    requirementBlock(FRESH_ID, {
      stability: "evolving",
      target: "v1.0.0",
      changeNotes: [
        { date: isoDaysAgo(120), change: "CreatedFreshZZ", reason: "ReasonCreatedFreshZZ" },
        { date: isoDaysAgo(0), change: "AmendedFreshZZ", reason: "ReasonAmendedFreshZZ" }
      ]
    }),
    requirementBlock(MIDAGE_ID, {
      stability: "evolving",
      target: "v1.0.0",
      changeNotes: [
        { date: isoDaysAgo(200), change: "CreatedMidZZ", reason: "ReasonCreatedMidZZ" },
        { date: isoDaysAgo(30), change: "AmendedMidZZ", reason: "ReasonAmendedMidZZ" }
      ]
    }),
    requirementBlock(STABLE_ID, {
      stability: "stable",
      target: "v1.0.0",
      changeNotes: [{ date: isoDaysAgo(3650), change: "CreatedStableZZ", reason: "ReasonCreatedStableZZ" }]
    })
  ];
  await writeFile(archPath, `${archText.trimEnd()}\n\n${blocks.join("\n\n")}\n`, "utf8");
}

/**
 * Appends one evolving requirement whose MOST RECENT Change Notes date is unparseable (FND-007). The
 * parser preserves the raw date string verbatim (changeNotesFromTable: date = row.Date ?? ""), so the
 * stale age helper must defend against Date.parse → NaN rather than silently dropping the record.
 */
async function appendMalformedDateFixture(root: string): Promise<void> {
  const archPath = path.join(root, ARCH_DOC);
  const archText = await readFile(archPath, "utf8");
  const block = requirementBlock(MALFORMED_ID, {
    stability: "evolving",
    target: "v1.0.0",
    changeNotes: [{ date: "not-a-real-date", change: "AmendedBadZZ", reason: "ReasonAmendedBadZZ" }]
  });
  await writeFile(archPath, `${archText.trimEnd()}\n\n${block}\n`, "utf8");
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
      if (
        node.length > 0 &&
        node.every((item) => item && typeof item === "object" && typeof (item as Record<string, unknown>).id === "string")
      ) {
        return node as Array<Record<string, unknown>>;
      }
      for (const item of node) stack.push(item);
      continue;
    }
    for (const value of Object.values(node as Record<string, unknown>)) stack.push(value);
  }
  return undefined;
}

/** The set of requirement ids in a stale --json payload. */
function idsFrom(out: string): string[] {
  const rows = findRequirementArray(JSON.parse(out));
  expect(rows, "stale --json must expose an array of requirement entries").toBeDefined();
  return (rows as Array<Record<string, unknown>>).map((row) => String(row.id));
}

/** Recursively snapshots every file's path → contents under a directory (for no-write assertions). */
async function snapshotTree(root: string): Promise<Map<string, string>> {
  const snapshot = new Map<string, string>();
  async function walk(dir: string): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (entry.isFile()) snapshot.set(path.relative(root, full), await readFile(full, "utf8"));
    }
  }
  await walk(root);
  return snapshot;
}

describe("IR-CLI-069 — stale command for aging requirements", () => {
  // AC-1: stale lists evolving requirements whose latest Change Notes date is older than the threshold.
  it("IR-CLI-069 AC-1: stale lists evolving requirements past the default evolving-age threshold", async () => {
    const root = await copyFixtureWorkspace("mutation-target");
    await appendStaleFixture(root);

    const streams = io();
    const code = await main(["--root", root, "stale", "--json"], streams);
    const out = drain(streams.stdout);

    expect(code).toBe(0);
    const ids = idsFrom(out);

    // STALE (evolving, ~10y old) is past the default 90-day threshold → listed. FRESH (evolving, today)
    // is within the threshold → excluded, proving the threshold actually gates and stale is not just
    // "all evolving". MIDAGE (evolving, 30d) is also within the default 90 → excluded. STABLE (ancient
    // but `stable`, not `evolving`) is excluded by the stability gate.
    expect(ids).toContain(STALE_ID);
    expect(ids).not.toContain(FRESH_ID);
    expect(ids).not.toContain(MIDAGE_ID);
    expect(ids).not.toContain(STABLE_ID);
    expect(out).not.toContain("undefined");
  });

  // AC-2: a configurable threshold flag (--evolving-age <days>) flags requirements older than that many
  // days (the decided replacement for the removed --evidence-age axis; see SCOPE RECONCILIATION above).
  it("IR-CLI-069 AC-2: stale --evolving-age <days> applies the given threshold", async () => {
    const root = await copyFixtureWorkspace("mutation-target");
    await appendStaleFixture(root);

    const streams = io();
    const code = await main(["--root", root, "stale", "--evolving-age", "7", "--json"], streams);
    const out = drain(streams.stdout);

    expect(code).toBe(0);
    const ids = idsFrom(out);

    // With a 7-day threshold, MIDAGE (evolving, 30d old) now exceeds the threshold and is flagged —
    // proving the override actually changed the gate from the default 90. STALE stays flagged. FRESH
    // (today) is still within 7 days → excluded. STABLE stays excluded by the stability gate.
    expect(ids).toContain(STALE_ID);
    expect(ids).toContain(MIDAGE_ID);
    expect(ids).not.toContain(FRESH_ID);
    expect(ids).not.toContain(STABLE_ID);
    expect(out).not.toContain("undefined");
  });

  // AC-3: stale computes age only from SRS date metadata (the most-recent Change Notes date) and never
  // reads outside the repository — so its result is a pure function of the on-disk Change Notes dates.
  it("IR-CLI-069 AC-3: stale computes age only from the most-recent Change Notes date", async () => {
    const root = await copyFixtureWorkspace("mutation-target");
    await appendStaleFixture(root);

    // Baseline: at a tight threshold STALE and MIDAGE are flagged, FRESH is not.
    const beforeStreams = io();
    expect(await main(["--root", root, "stale", "--evolving-age", "7", "--json"], beforeStreams)).toBe(0);
    const beforeIds = idsFrom(drain(beforeStreams.stdout));
    expect(beforeIds).toContain(MIDAGE_ID);

    // Rewrite ONLY MIDAGE's most-recent Change Notes date to today (age 0) by editing the on-disk SRS.
    // If age is computed solely from SRS date metadata, MIDAGE must drop out of the stale set after the
    // edit. The command reads no external/system source of truth for the date — only the repo file.
    const archPath = path.join(root, ARCH_DOC);
    const text = await readFile(archPath, "utf8");
    const rewritten = text.replace(
      `| ${isoDaysAgo(30)} | AmendedMidZZ | ReasonAmendedMidZZ |`,
      `| ${isoDaysAgo(0)} | AmendedMidZZ | ReasonAmendedMidZZ |`
    );
    // Guard: the targeted row must have actually been present and replaced.
    expect(rewritten).not.toBe(text);
    await writeFile(archPath, rewritten, "utf8");

    const afterStreams = io();
    expect(await main(["--root", root, "stale", "--evolving-age", "7", "--json"], afterStreams)).toBe(0);
    const afterIds = idsFrom(drain(afterStreams.stdout));

    // Age is recomputed from the edited SRS date alone: MIDAGE (now today) drops out, STALE (still
    // ancient) remains. Proves the age source is the repo's Change Notes metadata, nothing external.
    expect(afterIds).not.toContain(MIDAGE_ID);
    expect(afterIds).toContain(STALE_ID);
  });

  // FND-007: an evolving requirement whose MOST RECENT Change Notes date is unparseable must NOT be
  // silently dropped from the stale set by a NaN age comparison. Because its age cannot be decided as
  // "fresh", the requirement is surfaced (flagged stale) rather than silently disappearing.
  it("IR-CLI-069 (FND-007): an evolving requirement with an unparseable most-recent date is not silently dropped", async () => {
    const root = await copyFixtureWorkspace("mutation-target");
    await appendStaleFixture(root);
    await appendMalformedDateFixture(root);

    const streams = io();
    const code = await main(["--root", root, "stale", "--json"], streams);
    const out = drain(streams.stdout);

    expect(code).toBe(0);
    const ids = idsFrom(out);

    // The malformed-date evolving requirement is surfaced (not silently dropped). The known-stale
    // requirement is still flagged; the fresh one is still excluded — proving the malformed handling
    // did not break the normal gate.
    expect(ids, "an unparseable most-recent date must not silently drop the requirement").toContain(MALFORMED_ID);
    expect(ids).toContain(STALE_ID);
    expect(ids).not.toContain(FRESH_ID);

    // The malformed entry's age must be explicitly handled, not a leaked NaN. The entry carries its raw
    // (unparseable) date verbatim and an explicit age sentinel signalling "age undecidable" rather than
    // a NaN that JSON would silently coerce to a meaningless number.
    const rows = findRequirementArray(JSON.parse(out)) ?? [];
    const malformed = rows.find((row) => row.id === MALFORMED_ID) as Record<string, unknown> | undefined;
    expect(malformed, "the malformed-date entry must be present").toBeDefined();
    expect((malformed as Record<string, unknown>).latestChangeDate).toBe("not-a-real-date");
    // ageDays is explicitly null (undecidable), never NaN.
    expect((malformed as Record<string, unknown>).ageDays, "undecidable age must be explicit null, not NaN").toBeNull();
    expect(out.toLowerCase()).not.toContain("nan");
  });

  // AC-4: stale writes no file.
  it("IR-CLI-069 AC-4: stale writes no file", async () => {
    const root = await copyFixtureWorkspace("mutation-target");
    await appendStaleFixture(root);

    const before = await snapshotTree(root);

    const first = io();
    expect(await main(["--root", root, "stale", "--json"], first)).toBe(0);
    const firstIds = idsFrom(drain(first.stdout));

    // Determinism sanity: a second identical run reports the same set.
    const second = io();
    expect(await main(["--root", root, "stale", "--json"], second)).toBe(0);
    const secondIds = idsFrom(drain(second.stdout));
    expect([...secondIds].sort()).toEqual([...firstIds].sort());

    // Never writes a file: the workspace tree is byte-identical before and after both runs — no file
    // added, removed, or modified.
    const after = await snapshotTree(root);
    expect([...after.keys()].sort()).toEqual([...before.keys()].sort());
    for (const [rel, content] of after) {
      expect(content, `stale must not modify ${rel}`).toBe(before.get(rel));
    }

    // Sanity: the on-disk spec the command read is unchanged after the runs.
    const specStat = await stat(path.join(root, ARCH_DOC));
    expect(specStat.isFile()).toBe(true);
  });
});
