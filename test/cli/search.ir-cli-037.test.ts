import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { main } from "../../src/cli/index.js";
import { copyFixtureWorkspace } from "../fixtures/fixture-utils.js";

// IR-CLI-037 — `speckiwi search <query>` command over requirement fields.
//
// Red-phase suite (T-PH004-17): one test case per acceptance criterion (AC-1..AC-5). These cases pin
// the future CLI contract before `src/cli/index.ts` / `src/cli/commands/read.ts` teach the CLI a
// `search` command, so the whole suite fails today — commander rejects the unknown `search` command
// (non-zero usage exit, no match payload printed) — until the green task (T-PH004-18) wires the
// command against the existing core search query (src/core/query/records.ts searchRequirementRecords,
// FR-NODE-046) plus a --field selector.
//
// Contract under test (SRS docs/spec/30.cli-interface.srs.md IR-CLI-037):
//
//   SpecKiwi provides a `speckiwi search <query>` command with a --field selector for requirement,
//   ac, rationale, notes, title, or all that returns matching requirements, supports the standard
//   list filters, and supports --json output.
//
//   - AC-1: `search <query> --field title` returns requirements whose title matches the query.
//   - AC-2: `search <query> --field all` searches requirement statement, acceptance criteria,
//           rationale, notes, and title fields.
//   - AC-3: The search command honors the standard --target, --status, --scope, and --type filters
//           in combination with the query.
//   - AC-4: `search --json` emits a machine-readable array of matching requirement records.
//   - AC-5: An unsupported --field value is rejected with a usage error and a non-zero exit code.
//
// Fixture pinning (deterministic — appended to the valid-basic ARCH scope, Active Target v1.0.0).
// Each marker token is a unique nonsense string placed in exactly one field so a field-scoped match
// is unambiguous:
//   - FR-ARCH-020 → title carries TITLEMARKERZZ (and nothing else carries it).
//   - FR-ARCH-021 → rationale carries RATIONALEMARKERZZ; Implementation Notes carry NOTESMARKERZZ;
//                   neither token appears in its title.
//   - FR-ARCH-022 → requirement statement carries SHAREDMARKERZZ; status=implemented, type=interface,
//                   target=v1.0.0, scope ARCH.
//   - IR-OTHER-001 → requirement statement carries SHAREDMARKERZZ too; status=planned, type=interface,
//                    scope OTHER (a second scope doc) so a --scope filter can isolate FR-ARCH-022.

function io() {
  return { stdout: new PassThrough() as NodeJS.WriteStream, stderr: new PassThrough() as NodeJS.WriteStream };
}

/** Drains the output written to a finished run's stream. */
function drain(stream: NodeJS.WriteStream): string {
  return (stream as unknown as PassThrough).read()?.toString() ?? "";
}

const TITLE_ID = "FR-ARCH-020";
const FIELDS_ID = "FR-ARCH-021";
const ARCH_SHARED_ID = "FR-ARCH-022";
const OTHER_SHARED_ID = "IR-OTHER-001";

const TITLE_MARKER = "TITLEMARKERZZ";
const RATIONALE_MARKER = "RATIONALEMARKERZZ";
const NOTES_MARKER = "NOTESMARKERZZ";
const SHARED_MARKER = "SHAREDMARKERZZ";

/** A fully-formed requirement block, parameterized so individual fields carry the marker tokens. */
function requirementBlock(
  id: string,
  options: {
    titleSuffix?: string;
    type?: string;
    status?: string;
    scope?: string;
    requirement?: string;
    rationale?: string;
    notes?: string;
    acText?: string;
  }
): string {
  return [
    `### ${id} — Fixture ${id}${options.titleSuffix ?? ""}`,
    "",
    "| Field | Value |",
    "| --- | --- |",
    `| Type | ${options.type ?? "functional"} |`,
    "| Target | v1.0.0 |",
    `| Status | ${options.status ?? "planned"} |`,
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
    options.requirement ?? `Fixture requirement ${id}.`,
    "",
    "#### Rationale",
    "",
    options.rationale ?? "Fixture rationale.",
    "",
    "#### Acceptance Criteria",
    "",
    `- [ ] AC-1: ${options.acText ?? "First criterion."}`,
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
    `- ${options.notes ?? "-"}`,
    "",
    "#### Change Notes",
    "",
    "| Date | Change | Reason |",
    "| --- | --- | --- |",
    "| 2026-06-08 | Created | Fixture |"
  ].join("\n");
}

/** Appends the ARCH-scope search fixtures to the valid-basic ARCH scope document. */
async function appendArchFixture(root: string): Promise<void> {
  const specPath = path.join(root, "docs", "spec", "10.product-architecture.srs.md");
  const text = await readFile(specPath, "utf8");
  const blocks = [
    // Title-only marker: title carries TITLE_MARKER, body fields do not.
    requirementBlock(TITLE_ID, { titleSuffix: ` ${TITLE_MARKER}` }),
    // Body-field markers: rationale + notes carry their markers; title is plain.
    requirementBlock(FIELDS_ID, {
      rationale: `Fixture rationale ${RATIONALE_MARKER}.`,
      notes: `Fixture note ${NOTES_MARKER}.`
    }),
    // Shared marker in the requirement statement; distinct status/type for filter isolation.
    requirementBlock(ARCH_SHARED_ID, {
      type: "interface",
      status: "implemented",
      requirement: `Fixture requirement carrying ${SHARED_MARKER}.`
    })
  ];
  await writeFile(specPath, `${text.trimEnd()}\n\n${blocks.join("\n\n")}\n`, "utf8");
}

/**
 * Adds a second scope document (OTHER) carrying a requirement with the shared marker, so a --scope
 * filter can isolate the ARCH requirement from the OTHER one even though both match the query.
 */
async function addOtherScope(root: string): Promise<void> {
  const indexPath = path.join(root, "docs", "spec", "00.index.md");
  const indexText = await readFile(indexPath, "utf8");
  // Register the OTHER scope in the index Scope Map so the workspace parser accepts the new doc.
  const withScope = indexText.replace(
    /(\| ARCH \|[^\n]*\n)/,
    `$1| OTHER | Other Scope | 70.other.srs.md | active |\n`
  );
  await writeFile(indexPath, withScope, "utf8");

  const otherDoc = [
    "# Other Scope",
    "",
    "| Field | Value |",
    "|---|---|",
    "| Document Type | scope_srs |",
    "| Scope | OTHER |",
    "| Scope Name | Other Scope |",
    "",
    "## 1. Scope Overview",
    "",
    "Fixture other scope.",
    "",
    "## 2. Scope Boundaries",
    "",
    "### In Scope",
    "",
    "- other requirements",
    "",
    "### Out of Scope",
    "",
    "- none",
    "",
    "## 3. Assumptions and Constraints",
    "",
    "- none",
    "",
    "## 4. Requirements",
    "",
    requirementBlock(OTHER_SHARED_ID, {
      type: "interface",
      status: "planned",
      scope: "OTHER",
      requirement: `Other-scope requirement carrying ${SHARED_MARKER}.`
    })
  ].join("\n");
  await writeFile(path.join(root, "docs", "spec", "70.other.srs.md"), `${otherDoc}\n`, "utf8");
}

describe("IR-CLI-037 — search command over requirement fields", () => {
  // AC-1: `search <query> --field title` returns requirements whose title matches the query.
  it("IR-CLI-037 AC-1: search --field title matches the title field only", async () => {
    const root = await copyFixtureWorkspace("valid-basic");
    await appendArchFixture(root);

    // The title marker matches under --field title.
    const titled = io();
    const titledCode = await main(["--root", root, "search", TITLE_MARKER, "--field", "title"], titled);
    const titledOut = drain(titled.stdout);
    expect(titledCode).toBe(0);
    expect(titledOut).toContain(TITLE_ID);

    // A body-only marker (in rationale, not the title) must NOT match under --field title, proving the
    // selector restricts matching to the title field rather than scanning everything.
    const bodyOnly = io();
    const bodyOnlyCode = await main(["--root", root, "search", RATIONALE_MARKER, "--field", "title"], bodyOnly);
    const bodyOnlyOut = drain(bodyOnly.stdout);
    expect(bodyOnlyCode).toBe(0);
    expect(bodyOnlyOut).not.toContain(FIELDS_ID);
    expect(bodyOnlyOut).not.toContain("undefined");
  });

  // AC-2: `search <query> --field all` searches requirement statement, acceptance criteria,
  //       rationale, notes, and title fields.
  it("IR-CLI-037 AC-2: search --field all matches rationale and notes (not just title)", async () => {
    const root = await copyFixtureWorkspace("valid-basic");
    await appendArchFixture(root);

    // A rationale-only marker matches under --field all.
    const rationale = io();
    expect(await main(["--root", root, "search", RATIONALE_MARKER, "--field", "all"], rationale)).toBe(0);
    expect(drain(rationale.stdout)).toContain(FIELDS_ID);

    // A notes-only marker (Implementation Notes) matches under --field all.
    const notes = io();
    expect(await main(["--root", root, "search", NOTES_MARKER, "--field", "all"], notes)).toBe(0);
    expect(drain(notes.stdout)).toContain(FIELDS_ID);

    // A title marker also matches under --field all (all is a superset of title).
    const title = io();
    expect(await main(["--root", root, "search", TITLE_MARKER, "--field", "all"], title)).toBe(0);
    const titleOut = drain(title.stdout);
    expect(titleOut).toContain(TITLE_ID);
    expect(titleOut).not.toContain("undefined");
  });

  // AC-3: The search command honors the standard --target, --status, --scope, and --type filters in
  //       combination with the query.
  it("IR-CLI-037 AC-3: search honors --status, --scope, --type, and --target filters with the query", async () => {
    const root = await copyFixtureWorkspace("valid-basic");
    await appendArchFixture(root);
    await addOtherScope(root);

    // Baseline: the shared marker matches both the ARCH and OTHER requirements under --field all.
    const baseline = io();
    expect(await main(["--root", root, "search", SHARED_MARKER, "--field", "all"], baseline)).toBe(0);
    const baselineOut = drain(baseline.stdout);
    expect(baselineOut).toContain(ARCH_SHARED_ID);
    expect(baselineOut).toContain(OTHER_SHARED_ID);

    // --scope ARCH isolates the ARCH requirement.
    const scoped = io();
    expect(await main(["--root", root, "search", SHARED_MARKER, "--field", "all", "--scope", "ARCH"], scoped)).toBe(0);
    const scopedOut = drain(scoped.stdout);
    expect(scopedOut).toContain(ARCH_SHARED_ID);
    expect(scopedOut).not.toContain(OTHER_SHARED_ID);

    // --status implemented isolates the ARCH requirement (it is the only implemented match).
    const byStatus = io();
    expect(await main(["--root", root, "search", SHARED_MARKER, "--field", "all", "--status", "implemented"], byStatus)).toBe(0);
    const byStatusOut = drain(byStatus.stdout);
    expect(byStatusOut).toContain(ARCH_SHARED_ID);
    expect(byStatusOut).not.toContain(OTHER_SHARED_ID);

    // --type functional excludes both interface-typed matches, leaving neither shared requirement.
    const byType = io();
    expect(await main(["--root", root, "search", SHARED_MARKER, "--field", "all", "--type", "functional"], byType)).toBe(0);
    const byTypeOut = drain(byType.stdout);
    expect(byTypeOut).not.toContain(ARCH_SHARED_ID);
    expect(byTypeOut).not.toContain(OTHER_SHARED_ID);

    // --target v2.0.0 (no requirement targets it) yields neither match.
    const byTarget = io();
    expect(await main(["--root", root, "search", SHARED_MARKER, "--field", "all", "--target", "v2.0.0"], byTarget)).toBe(0);
    const byTargetOut = drain(byTarget.stdout);
    expect(byTargetOut).not.toContain(ARCH_SHARED_ID);
    expect(byTargetOut).not.toContain(OTHER_SHARED_ID);
  });

  // AC-4: `search --json` emits a machine-readable array of matching requirement records.
  it("IR-CLI-037 AC-4: search --json emits a machine-readable array of matching records", async () => {
    const root = await copyFixtureWorkspace("valid-basic");
    await appendArchFixture(root);

    const streams = io();
    const code = await main(["--root", root, "search", TITLE_MARKER, "--field", "title", "--json"], streams);
    const out = drain(streams.stdout);

    expect(code).toBe(0);
    const parsed: unknown = JSON.parse(out);
    // Recover the array of matching records from the JSON payload (envelope-tolerant).
    const records = findRecordsArray(parsed);
    expect(records, "search --json must expose an array of matching requirement records").toBeDefined();
    const ids = (records as Array<Record<string, unknown>>).map((record) => record.id);
    expect(ids).toContain(TITLE_ID);
    // The query is selective: the plain fixture requirement is not a title match.
    expect(ids).not.toContain("FR-ARCH-001");
    expect(out).not.toContain("undefined");
  });

  // AC-5: An unsupported --field value is rejected with a usage error and a non-zero exit code.
  it("IR-CLI-037 AC-5: an unsupported --field value is a usage error with non-zero exit", async () => {
    const root = await copyFixtureWorkspace("valid-basic");
    await appendArchFixture(root);

    const streams = io();
    const code = await main(["--root", root, "search", TITLE_MARKER, "--field", "bogus"], streams);
    const out = drain(streams.stdout);
    const err = drain(streams.stderr);
    const combined = `${out}${err}`;

    // Non-zero exit code signals the usage error.
    expect(code).not.toBe(0);
    // The error must reference the offending --field selector specifically: either the option name
    // (`field`) or the rejected value (`bogus`). This is deliberately stricter than "any error" so the
    // case stays red while the `search` command is absent (commander then reports only "unknown
    // command 'search'", which mentions neither token) and only goes green once the command exists and
    // validates --field.
    expect(combined.toLowerCase()).toMatch(/field|bogus/);
    // It must not silently print matches for a rejected field selector.
    expect(combined).not.toContain(TITLE_ID);
  });
});

/** Walks a parsed JSON document for the first array of objects that each carry a string `id`. */
function findRecordsArray(parsed: unknown): Array<Record<string, unknown>> | undefined {
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
