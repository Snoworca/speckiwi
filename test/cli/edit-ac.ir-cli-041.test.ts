import { readFile } from "node:fs/promises";
import path from "node:path";
import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { main } from "../../src/cli/index.js";
import { copyFixtureWorkspace } from "../fixtures/fixture-utils.js";

// IR-CLI-056 — `speckiwi edit-ac <id> <acId> --text <text>` command.
//
// Red-phase suite (T-PH004-25): one test case per acceptance criterion (AC-1..AC-4). These cases pin
// the future CLI contract before `src/cli/index.ts` / `src/cli/commands/mutations.ts` teach the CLI an
// `edit-ac` command, so the whole suite fails today — commander rejects the unknown `edit-ac` command
// (non-zero usage exit, no mutation payload printed) — until the green task (T-PH004-26) wires the
// command against the existing core mutation
// (src/core/mutation/check-ac.ts `editAcceptanceCriteria`, FR-NODE-041): a single Acceptance Criterion
// text replacement that leaves the checkbox state and every other criterion / section intact, with a
// --dry-run preview and a --json mutation result envelope.
//
// Contract under test (SRS docs/spec/30.cli-interface.srs.md IR-CLI-056):
//
//   SpecKiwi provides a `speckiwi edit-ac <id> <acId> --text <text>` command that edits the text of a
//   single acceptance criterion by delegating to the core edit_acceptance_criteria mutation, supporting
//   --dry-run and --json and leaving the checked state and other acceptance criteria unchanged.
//
//   - AC-1: `edit-ac <id> <acId> --text <text>` updates the text of the targeted acceptance criterion.
//   - AC-2: The command leaves the checked or unchecked state of the targeted criterion and all other
//           criteria unchanged.
//   - AC-3: `edit-ac --dry-run` prints a patch preview and writes no file.
//   - AC-4: `edit-ac --json` emits the mutation result envelope consistent with other mutation commands.
//
// Fixture (mutation-target): a single requirement FR-ARCH-001 lives in the ARCH scope document. Its
// pinned fixture facts (test/fixtures/workspaces/mutation-target/docs/spec/10.product-architecture.srs.md):
//   - Acceptance Criteria (both unchecked):
//       "- [ ] AC-1: The status can be updated."
//       "- [ ] AC-2: Evidence can be added."
//   - Trace Links: a header-only table ("| Type | Reference | Relation | Notes |" / "| --- | --- | --- | --- |").
//   - Requirement statement body: "SpecKiwi must mutate this fixture requirement."
// The core mutation editAcceptanceCriteria returns mutationOk({ id, acId, text, written }) and accepts dryRun.

const SCOPE_DOC = path.join("docs", "spec", "10.product-architecture.srs.md");
const TARGET_ID = "FR-ARCH-001";
const TARGET_AC = "AC-1";
const OTHER_AC_LINE = "- [ ] AC-2: Evidence can be added.";
const OLD_AC1_LINE = "- [ ] AC-1: The status can be updated.";
const NEW_AC1_TEXT = "The status can be updated by an authorized operator only.";
const NEW_AC1_LINE = `- [ ] AC-1: ${NEW_AC1_TEXT}`;

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

/** Walks a JSON result envelope to recover the mutation value object (carrying id/acId/written). */
function findValue(parsed: unknown): Record<string, unknown> | undefined {
  const stack: unknown[] = [parsed];
  const seen = new Set<unknown>();
  while (stack.length > 0) {
    const node = stack.pop();
    if (!node || typeof node !== "object" || seen.has(node)) continue;
    seen.add(node);
    const record = node as Record<string, unknown>;
    if (record.id === TARGET_ID && "acId" in record && "written" in record) return record;
    for (const value of Object.values(record)) stack.push(value);
  }
  return undefined;
}

describe("IR-CLI-056 — edit-ac command edits a single acceptance criterion's text", () => {
  // AC-1: `edit-ac <id> <acId> --text <text>` updates the text of the targeted acceptance criterion.
  it("IR-CLI-056 AC-1: updates the text of the targeted acceptance criterion", async () => {
    const root = await copyFixtureWorkspace("mutation-target");
    const before = await readScope(root);
    // sanity: fixture precondition — the old AC-1 line is present, the new text is absent.
    expect(before).toContain(OLD_AC1_LINE);
    expect(before).not.toContain(NEW_AC1_TEXT);

    const run = io();
    const code = await main(["--root", root, "edit-ac", TARGET_ID, TARGET_AC, "--text", NEW_AC1_TEXT], run);
    expect(code).toBe(0);

    const after = await readScope(root);
    // The AC-1 prose was replaced: the new line is present, the old prose is gone.
    expect(after).toContain(NEW_AC1_LINE);
    expect(after).not.toContain(OLD_AC1_LINE);
    // The replacement lands inside the #### Acceptance Criteria section.
    expect(sectionSlice(after, "Acceptance Criteria")).toContain(NEW_AC1_LINE);
  });

  // AC-2: leaves the checked/unchecked state of the targeted criterion and all other criteria unchanged.
  it("IR-CLI-056 AC-2: leaves the checked state and other acceptance criteria unchanged", async () => {
    const root = await copyFixtureWorkspace("mutation-target");
    const before = await readScope(root);
    const traceBefore = sectionSlice(before, "Trace Links");
    const requirementBefore = sectionSlice(before, "Requirement");
    // sanity: both criteria start unchecked in the fixture, and the other AC line is present.
    expect(before).toContain(OLD_AC1_LINE);
    expect(before).toContain(OTHER_AC_LINE);

    const run = io();
    const code = await main(["--root", root, "edit-ac", TARGET_ID, TARGET_AC, "--text", NEW_AC1_TEXT], run);
    expect(code).toBe(0);

    const after = await readScope(root);
    // The edit happened (precondition for a meaningful "unchanged elsewhere" assertion) ...
    expect(after).toContain(NEW_AC1_LINE);
    // ... while the targeted criterion's checkbox marker stays unchecked (text edited, state preserved):
    // the edited line keeps the `- [ ] AC-1:` prefix and is NOT flipped to a checked marker.
    expect(after).toContain(`- [ ] ${TARGET_AC}: ${NEW_AC1_TEXT}`);
    expect(after).not.toContain(`- [x] ${TARGET_AC}:`);
    expect(after).not.toContain(`- [X] ${TARGET_AC}:`);
    // ... the other acceptance criterion (AC-2) is left byte-for-byte unchanged ...
    expect(after).toContain(OTHER_AC_LINE);
    // ... and the Trace Links and Requirement sections are byte-for-byte preserved.
    expect(sectionSlice(after, "Trace Links")).toBe(traceBefore);
    expect(sectionSlice(after, "Requirement")).toBe(requirementBefore);
  });

  // AC-3: `edit-ac --dry-run` prints a patch preview and writes no file.
  it("IR-CLI-056 AC-3: --dry-run prints a patch preview and writes no file", async () => {
    const root = await copyFixtureWorkspace("mutation-target");
    const before = await readScope(root);

    const run = io();
    const code = await main(
      ["--root", root, "edit-ac", TARGET_ID, TARGET_AC, "--text", NEW_AC1_TEXT, "--dry-run", "--json"],
      run
    );
    expect(code).toBe(0);

    // No file write: the scope document is byte-for-byte unchanged after a dry-run.
    expect(await readScope(root)).toBe(before);

    // A patch preview is surfaced: the dry-run envelope carries a patch summary marked dryRun.
    const parsed = JSON.parse(drain(run.stdout)) as { ok?: boolean; patch?: { dryRun?: boolean; preview?: unknown } };
    expect(parsed.ok).toBe(true);
    expect(parsed.patch).toBeDefined();
    expect(parsed.patch?.dryRun).toBe(true);
    expect(Array.isArray(parsed.patch?.preview)).toBe(true);
  });

  // AC-4: `edit-ac --json` emits the mutation result envelope consistent with other mutation commands.
  it("IR-CLI-056 AC-4: --json emits a mutation result envelope consistent with other mutation commands", async () => {
    const root = await copyFixtureWorkspace("mutation-target");

    const run = io();
    const code = await main(["--root", root, "edit-ac", TARGET_ID, TARGET_AC, "--text", NEW_AC1_TEXT, "--json"], run);
    expect(code).toBe(0);

    const parsed = JSON.parse(drain(run.stdout)) as { ok?: boolean; value?: unknown; diagnostics?: unknown };
    // Envelope shape mirrors the other mutation commands: { ok, value, diagnostics }.
    expect(parsed.ok).toBe(true);
    expect(Array.isArray(parsed.diagnostics)).toBe(true);
    // The value object delegates the core edit_acceptance_criteria result: { id, acId, text, written }.
    const value = findValue(parsed);
    expect(value, "edit-ac --json must print a mutation value with id/acId/written").toBeDefined();
    expect(value?.id).toBe(TARGET_ID);
    expect(value?.acId).toBe(TARGET_AC);
    expect(value?.written).toBe(true);
  });
});
