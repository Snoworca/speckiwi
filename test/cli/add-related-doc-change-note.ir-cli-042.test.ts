import { readFile } from "node:fs/promises";
import path from "node:path";
import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { main } from "../../src/cli/index.js";
import { copyFixtureWorkspace } from "../fixtures/fixture-utils.js";

// IR-CLI-042 — `speckiwi add-related-doc <id> --link <link>` and
//              `speckiwi add-change-note <id> --change <change> --reason <reason>` commands.
//
// Red-phase suite (T-PH004-27): one test case per acceptance criterion (AC-1..AC-4). These cases pin
// the future CLI contract before `src/cli/index.ts` / `src/cli/commands/mutations.ts` teach the CLI the
// two commands, so the whole suite fails today — commander rejects the unknown `add-related-doc` /
// `add-change-note` commands (non-zero usage exit, no mutation payload printed) — until the green task
// (T-PH004-28) wires the commands against the existing core mutations
// (src/core/mutation/add-related-doc.ts `addRelatedDoc` and src/core/mutation/add-change-note.ts
// `addChangeNote`, both FR-NODE-049): a single Related Docs metadata-line append and a single dated
// Change Notes row append, each with a --dry-run preview and a --json mutation result envelope.
//
// Contract under test (SRS docs/spec/30.cli-interface.srs.md IR-CLI-042):
//
//   SpecKiwi provides a `speckiwi add-related-doc <id> --link <link>` command that appends a Related
//   Docs entry to a requirement and a `speckiwi add-change-note <id> --change <change> --reason <reason>`
//   command that appends a Change Notes row to a requirement, both supporting --dry-run and --json.
//
//   - AC-1: `add-related-doc <id> --link <link>` appends the link to the Related Docs of the targeted
//           requirement without altering other sections.
//   - AC-2: `add-change-note <id> --change <change> --reason <reason>` appends a dated Change Notes row
//           to the targeted requirement.
//   - AC-3: Both commands support --dry-run and print a patch preview without writing a file.
//   - AC-4: Both commands support --json and emit the mutation result envelope consistent with other
//           mutation commands.
//
// Fixture (mutation-target): a single requirement FR-ARCH-001 lives in the ARCH scope document. Its
// pinned fixture facts (test/fixtures/workspaces/mutation-target/docs/spec/10.product-architecture.srs.md):
//   - Related Docs metadata row holds the placeholder: "| Related Docs | - |".
//   - Change Notes table holds exactly one existing row: "| 2026-05-08 | Created | Fixture |"
//     under the header "| Date | Change | Reason |".
//   - Acceptance Criteria (both unchecked):
//       "- [ ] AC-1: The status can be updated."
//       "- [ ] AC-2: Evidence can be added."
//   - Trace Links: a header-only table ("| Type | Reference | Relation | Notes |" / separator).
//   - Requirement statement body: "SpecKiwi must mutate this fixture requirement."
// The core mutations return mutationOk({ id, reference, written }) (addRelatedDoc) and
// mutationOk({ id, written }) (addChangeNote), both accepting dryRun and attaching a PatchSummary.

const SCOPE_DOC = path.join("docs", "spec", "10.product-architecture.srs.md");
const TARGET_ID = "FR-ARCH-001";

const RELATED_DOC_PLACEHOLDER_LINE = "| Related Docs | - |";
const NEW_LINK = "docs/spec/30.cli-interface.srs.md#IR-CLI-042";
const NEW_RELATED_DOC_LINE = `| Related Docs | ${NEW_LINK} |`;

const EXISTING_CHANGE_NOTE_ROW = "| 2026-05-08 | Created | Fixture |";
const NEW_CHANGE = "Documented add-related-doc";
const NEW_REASON = "IR-CLI-042";

const AC1_LINE = "- [ ] AC-1: The status can be updated.";
const AC2_LINE = "- [ ] AC-2: Evidence can be added.";

function io() {
  return { stdout: new PassThrough() as NodeJS.WriteStream, stderr: new PassThrough() as NodeJS.WriteStream };
}

/** Drains the output written to a finished run's stream. */
function drain(stream: NodeJS.WriteStream): string {
  return (stream as unknown as PassThrough).read()?.toString() ?? "";
}

async function readScope(root: string): Promise<string> {
  return readFile(path.join(root, SCOPE_DOC), "utf8");
}

/** Slices the text of a named `#### <heading>` section up to the next `####` heading (or EOF). */
function sectionSlice(text: string, heading: string): string {
  const start = text.indexOf(`#### ${heading}`);
  if (start < 0) return "";
  const next = text.indexOf("\n#### ", start + 1);
  return text.slice(start, next >= 0 ? next : undefined);
}

/** Walks a JSON result envelope to recover the mutation value object that carries the given keys. */
function findValue(parsed: unknown, requiredKeys: readonly string[]): Record<string, unknown> | undefined {
  const stack: unknown[] = [parsed];
  const seen = new Set<unknown>();
  while (stack.length > 0) {
    const node = stack.pop();
    if (!node || typeof node !== "object" || seen.has(node)) continue;
    seen.add(node);
    const record = node as Record<string, unknown>;
    if (record.id === TARGET_ID && requiredKeys.every((key) => key in record)) return record;
    for (const value of Object.values(record)) stack.push(value);
  }
  return undefined;
}

describe("IR-CLI-042 — add-related-doc and add-change-note commands", () => {
  // AC-1: `add-related-doc <id> --link <link>` appends the link to the Related Docs of the targeted
  //       requirement without altering other sections.
  it("IR-CLI-042 AC-1: add-related-doc appends the link without altering other sections", async () => {
    const root = await copyFixtureWorkspace("mutation-target");
    const before = await readScope(root);
    const acBefore = sectionSlice(before, "Acceptance Criteria");
    const traceBefore = sectionSlice(before, "Trace Links");
    const requirementBefore = sectionSlice(before, "Requirement");
    const changeNotesBefore = sectionSlice(before, "Change Notes");
    // sanity: the Related Docs placeholder is present and the new link is absent.
    expect(before).toContain(RELATED_DOC_PLACEHOLDER_LINE);
    expect(before).not.toContain(NEW_LINK);

    const run = io();
    const code = await main(["--root", root, "add-related-doc", TARGET_ID, "--link", NEW_LINK], run);
    expect(code).toBe(0);

    const after = await readScope(root);
    // The Related Docs metadata row carries the appended link; the bare placeholder is gone.
    expect(after).toContain(NEW_RELATED_DOC_LINE);
    expect(after).not.toContain(RELATED_DOC_PLACEHOLDER_LINE);
    // Every other section is byte-for-byte preserved — only the Related Docs line changed.
    expect(sectionSlice(after, "Acceptance Criteria")).toBe(acBefore);
    expect(sectionSlice(after, "Trace Links")).toBe(traceBefore);
    expect(sectionSlice(after, "Requirement")).toBe(requirementBefore);
    expect(sectionSlice(after, "Change Notes")).toBe(changeNotesBefore);
  });

  // AC-2: `add-change-note <id> --change <change> --reason <reason>` appends a dated Change Notes row
  //       to the targeted requirement.
  it("IR-CLI-042 AC-2: add-change-note appends a dated Change Notes row preserving existing rows", async () => {
    const root = await copyFixtureWorkspace("mutation-target");
    const before = await readScope(root);
    const acBefore = sectionSlice(before, "Acceptance Criteria");
    const traceBefore = sectionSlice(before, "Trace Links");
    // sanity: exactly the one existing change-note row is present; the new change/reason are absent.
    expect(before).toContain(EXISTING_CHANGE_NOTE_ROW);
    expect(before).not.toContain(NEW_CHANGE);
    expect(before).not.toContain(NEW_REASON);

    const run = io();
    const code = await main(
      ["--root", root, "add-change-note", TARGET_ID, "--change", NEW_CHANGE, "--reason", NEW_REASON],
      run
    );
    expect(code).toBe(0);

    const after = await readScope(root);
    const changeNotesAfter = sectionSlice(after, "Change Notes");
    // The pre-existing row survives, and a new dated row carrying the change + reason is appended.
    expect(changeNotesAfter).toContain(EXISTING_CHANGE_NOTE_ROW);
    expect(changeNotesAfter).toContain(NEW_CHANGE);
    expect(changeNotesAfter).toContain(NEW_REASON);
    // The appended row is dated (a YYYY-MM-DD cell precedes the change/reason cells on one row).
    expect(changeNotesAfter).toMatch(
      new RegExp(`\\|\\s*\\d{4}-\\d{2}-\\d{2}\\s*\\|\\s*${NEW_CHANGE}\\s*\\|\\s*${NEW_REASON}\\s*\\|`)
    );
    // The append lands inside #### Change Notes only — unrelated sections are untouched.
    expect(sectionSlice(after, "Acceptance Criteria")).toBe(acBefore);
    expect(sectionSlice(after, "Trace Links")).toBe(traceBefore);
  });

  // AC-3: Both commands support --dry-run and print a patch preview without writing a file.
  it("IR-CLI-042 AC-3: --dry-run prints a patch preview and writes no file for both commands", async () => {
    // add-related-doc --dry-run
    const docRoot = await copyFixtureWorkspace("mutation-target");
    const docBefore = await readScope(docRoot);
    const docRun = io();
    const docCode = await main(
      ["--root", docRoot, "add-related-doc", TARGET_ID, "--link", NEW_LINK, "--dry-run", "--json"],
      docRun
    );
    expect(docCode).toBe(0);
    // No file write: the scope document is byte-for-byte unchanged after a dry-run.
    expect(await readScope(docRoot)).toBe(docBefore);
    const docParsed = JSON.parse(drain(docRun.stdout)) as {
      ok?: boolean;
      patch?: { dryRun?: boolean; preview?: unknown };
    };
    expect(docParsed.ok).toBe(true);
    expect(docParsed.patch).toBeDefined();
    expect(docParsed.patch?.dryRun).toBe(true);
    expect(Array.isArray(docParsed.patch?.preview)).toBe(true);

    // add-change-note --dry-run
    const noteRoot = await copyFixtureWorkspace("mutation-target");
    const noteBefore = await readScope(noteRoot);
    const noteRun = io();
    const noteCode = await main(
      [
        "--root",
        noteRoot,
        "add-change-note",
        TARGET_ID,
        "--change",
        NEW_CHANGE,
        "--reason",
        NEW_REASON,
        "--dry-run",
        "--json"
      ],
      noteRun
    );
    expect(noteCode).toBe(0);
    // No file write: the scope document is byte-for-byte unchanged after a dry-run.
    expect(await readScope(noteRoot)).toBe(noteBefore);
    const noteParsed = JSON.parse(drain(noteRun.stdout)) as {
      ok?: boolean;
      patch?: { dryRun?: boolean; preview?: unknown };
    };
    expect(noteParsed.ok).toBe(true);
    expect(noteParsed.patch).toBeDefined();
    expect(noteParsed.patch?.dryRun).toBe(true);
    expect(Array.isArray(noteParsed.patch?.preview)).toBe(true);
  });

  // AC-4: Both commands support --json and emit the mutation result envelope consistent with other
  //       mutation commands.
  it("IR-CLI-042 AC-4: --json emits a mutation result envelope for both commands", async () => {
    // add-related-doc --json → { ok, value: { id, reference, written }, diagnostics }
    const docRoot = await copyFixtureWorkspace("mutation-target");
    const docRun = io();
    const docCode = await main(
      ["--root", docRoot, "add-related-doc", TARGET_ID, "--link", NEW_LINK, "--json"],
      docRun
    );
    expect(docCode).toBe(0);
    const docParsed = JSON.parse(drain(docRun.stdout)) as {
      ok?: boolean;
      value?: unknown;
      diagnostics?: unknown;
    };
    expect(docParsed.ok).toBe(true);
    expect(Array.isArray(docParsed.diagnostics)).toBe(true);
    const docValue = findValue(docParsed, ["reference", "written"]);
    expect(docValue, "add-related-doc --json must print a mutation value with id/reference/written").toBeDefined();
    expect(docValue?.id).toBe(TARGET_ID);
    expect(docValue?.reference).toBe(NEW_LINK);
    expect(docValue?.written).toBe(true);

    // add-change-note --json → { ok, value: { id, written }, diagnostics }
    const noteRoot = await copyFixtureWorkspace("mutation-target");
    const noteRun = io();
    const noteCode = await main(
      ["--root", noteRoot, "add-change-note", TARGET_ID, "--change", NEW_CHANGE, "--reason", NEW_REASON, "--json"],
      noteRun
    );
    expect(noteCode).toBe(0);
    const noteParsed = JSON.parse(drain(noteRun.stdout)) as {
      ok?: boolean;
      value?: unknown;
      diagnostics?: unknown;
    };
    expect(noteParsed.ok).toBe(true);
    expect(Array.isArray(noteParsed.diagnostics)).toBe(true);
    const noteValue = findValue(noteParsed, ["written"]);
    expect(noteValue, "add-change-note --json must print a mutation value with id/written").toBeDefined();
    expect(noteValue?.id).toBe(TARGET_ID);
    expect(noteValue?.written).toBe(true);
  });
});

// Anti-vacuity sanity: the fixture facts these tests pin are stable, and the AC lines exist so the
// "other sections unchanged" assertions are meaningful rather than trivially true.
describe("IR-CLI-042 fixture preconditions", () => {
  it("the mutation-target fixture exposes the pinned Related Docs / Change Notes / AC facts", async () => {
    const root = await copyFixtureWorkspace("mutation-target");
    const text = await readScope(root);
    expect(text).toContain(RELATED_DOC_PLACEHOLDER_LINE);
    expect(text).toContain(EXISTING_CHANGE_NOTE_ROW);
    expect(text).toContain(AC1_LINE);
    expect(text).toContain(AC2_LINE);
  });
});
