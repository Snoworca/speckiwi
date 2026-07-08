import { readFile } from "node:fs/promises";
import path from "node:path";
import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { main } from "../../src/cli/index.js";
import { copyFixtureWorkspace } from "../fixtures/fixture-utils.js";

// IR-CLI-040 — `speckiwi update-statement <id> --text <text>` command.
//
// Red-phase suite (T-PH004-23): one test case per acceptance criterion (AC-1..AC-4). These cases pin
// the future CLI contract before `src/cli/index.ts` / `src/cli/commands/mutations.ts` teach the CLI an
// `update-statement` command, so the whole suite fails today — commander rejects the unknown
// `update-statement` command (non-zero usage exit, no mutation payload printed) — until the green task
// (T-PH004-24) wires the command against the existing core mutation
// (src/core/mutation/update-statement.ts `updateRequirementStatement`, FR-NODE-025): a single
// Requirement-statement body replacement that leaves the Acceptance Criteria and Trace Links sections
// intact, with --dry-run preview and a --json mutation result envelope.
//
// Contract under test (SRS docs/spec/30.cli-interface.srs.md IR-CLI-040):
//
//   SpecKiwi provides a `speckiwi update-statement <id> --text <text>` command that replaces a single
//   requirement statement body by delegating to the core update_requirement_statement mutation,
//   supporting --dry-run and --json and leaving the Acceptance Criteria and other sections unchanged.
//
//   - AC-1: `update-statement <id> --text <text>` replaces the requirement statement body of the
//           targeted requirement.
//   - AC-2: The command leaves the Acceptance Criteria section and Trace Links section unchanged.
//   - AC-3: `update-statement --dry-run` prints a patch preview and writes no file.
//   - AC-4: `update-statement --json` emits the mutation result envelope consistent with other
//           mutation commands.
//
// Fixture (mutation-target): a single requirement FR-ARCH-001 lives in the ARCH scope document. Its
// pinned fixture facts (test/fixtures/workspaces/mutation-target/docs/spec/10.product-architecture.srs.md):
//   - Requirement statement body: "SpecKiwi must mutate this fixture requirement."
//   - Acceptance Criteria: "- [ ] AC-1: The status can be updated." / "- [ ] AC-2: Evidence can be added."
//   - Trace Links: a header-only table ("| Type | Reference | Relation | Notes |" / "| --- | --- | --- | --- |").
// The core mutation updateRequirementStatement returns mutationOk({ id, written }) and accepts dryRun.

const SCOPE_DOC = path.join("docs", "spec", "10.product-architecture.srs.md");
const TARGET_ID = "FR-ARCH-001";
const OLD_STATEMENT = "SpecKiwi must mutate this fixture requirement.";
const NEW_STATEMENT = "SpecKiwi replaced the requirement statement via the update-statement command.";

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

/** Walks a JSON result envelope to recover the mutation value object (carrying id/written). */
function findValue(parsed: unknown): Record<string, unknown> | undefined {
  const stack: unknown[] = [parsed];
  const seen = new Set<unknown>();
  while (stack.length > 0) {
    const node = stack.pop();
    if (!node || typeof node !== "object" || seen.has(node)) continue;
    seen.add(node);
    const record = node as Record<string, unknown>;
    if (record.id === TARGET_ID && "written" in record) return record;
    for (const value of Object.values(record)) stack.push(value);
  }
  return undefined;
}

describe("IR-CLI-040 — update-statement command replaces a requirement statement body", () => {
  // AC-1: `update-statement <id> --text <text>` replaces the requirement statement body.
  it("IR-CLI-040 AC-1: replaces the requirement statement body of the targeted requirement", async () => {
    const root = await copyFixtureWorkspace("mutation-target");
    const before = await readScope(root);
    // sanity: fixture precondition — the old statement is present, the new one is absent.
    expect(before).toContain(OLD_STATEMENT);
    expect(before).not.toContain(NEW_STATEMENT);

    const run = io();
    const code = await main(["--root", root, "update-statement", TARGET_ID, "--text", NEW_STATEMENT], run);
    expect(code).toBe(0);

    const after = await readScope(root);
    // The Requirement statement prose was replaced: new body present, old body gone.
    expect(after).toContain(NEW_STATEMENT);
    expect(after).not.toContain(OLD_STATEMENT);
    // The replacement lands inside the #### Requirement section.
    expect(sectionSlice(after, "Requirement")).toContain(NEW_STATEMENT);
  });

  // AC-2: the command leaves the Acceptance Criteria section and Trace Links section unchanged.
  it("IR-CLI-040 AC-2: leaves the Acceptance Criteria and Trace Links sections unchanged", async () => {
    const root = await copyFixtureWorkspace("mutation-target");
    const before = await readScope(root);
    const acBefore = sectionSlice(before, "Acceptance Criteria");
    const traceBefore = sectionSlice(before, "Trace Links");
    // sanity: the two sections we assert on are non-empty in the fixture.
    expect(acBefore).toContain("- [ ] AC-1: The status can be updated.");
    expect(acBefore).toContain("- [ ] AC-2: Evidence can be added.");
    expect(traceBefore).toContain("| Type | Reference | Relation | Notes |");

    const run = io();
    const code = await main(["--root", root, "update-statement", TARGET_ID, "--text", NEW_STATEMENT], run);
    expect(code).toBe(0);

    const after = await readScope(root);
    // The statement changed (precondition for a meaningful "unchanged elsewhere" assertion) ...
    expect(after).toContain(NEW_STATEMENT);
    // ... while the Acceptance Criteria and Trace Links sections are byte-for-byte preserved.
    expect(sectionSlice(after, "Acceptance Criteria")).toBe(acBefore);
    expect(sectionSlice(after, "Trace Links")).toBe(traceBefore);
  });

  // AC-3: `update-statement --dry-run` prints a patch preview and writes no file.
  it("IR-CLI-040 AC-3: --dry-run prints a patch preview and writes no file", async () => {
    const root = await copyFixtureWorkspace("mutation-target");
    const before = await readScope(root);

    const run = io();
    const code = await main(
      ["--root", root, "update-statement", TARGET_ID, "--text", NEW_STATEMENT, "--dry-run", "--json"],
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

  // AC-4: `update-statement --json` emits the mutation result envelope consistent with other commands.
  it("IR-CLI-040 AC-4: --json emits a mutation result envelope consistent with other mutation commands", async () => {
    const root = await copyFixtureWorkspace("mutation-target");

    const run = io();
    const code = await main(["--root", root, "update-statement", TARGET_ID, "--text", NEW_STATEMENT, "--json"], run);
    expect(code).toBe(0);

    const parsed = JSON.parse(drain(run.stdout)) as { ok?: boolean; value?: unknown; diagnostics?: unknown };
    // Envelope shape mirrors the other mutation commands: { ok, value, diagnostics }.
    expect(parsed.ok).toBe(true);
    expect(Array.isArray(parsed.diagnostics)).toBe(true);
    // The value object delegates the core update_requirement_statement result: { id, written }.
    const value = findValue(parsed);
    expect(value, "update-statement --json must print a mutation value with id/written").toBeDefined();
    expect(value?.id).toBe(TARGET_ID);
    expect(value?.written).toBe(true);
  });
});
