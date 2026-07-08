import { readFile } from "node:fs/promises";
import path from "node:path";
import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { main } from "../../src/cli/index.js";
import { copyFixtureWorkspace } from "../fixtures/fixture-utils.js";

// IR-CLI-066 — `speckiwi set-supersede` command.
//
// Red-phase suite (T-PH004-47): one test case per acceptance criterion (AC-1..AC-4). These cases pin the
// future CLI contract before `src/cli/index.ts` / `src/cli/commands/mutations.ts` teach the CLI a
// `set-supersede` command, so the whole suite fails today — commander rejects the unknown `set-supersede`
// command (non-zero usage exit, `{ ok:false, error:{ code:"CLI_USAGE_ERROR" } }` under --json) — until the
// green task (T-PH004-48) wires the command against the EXISTING core mutation
// (src/core/mutation/add-trace.ts `setSupersede`, FR-NODE-063): the metadata-only mutation that writes
// either the `Supersedes` or the `Superseded By` field of one requirement, optionally inserts the matching
// `supersedes` / `superseded_by` Trace Link row when sync-trace is requested, supports dry-run and json,
// and edits no requirement Status.
//
// IR-CLI-066 (set-supersede = metadata-only setSupersede, FR-NODE-063) is intentionally distinct from
// IR-CLI-059 (supersede = the full-lifecycle command that mints a successor and discards the old id via
// FR-NODE-045). This suite pins the metadata-only contract: it MUST NOT discard the requirement or change
// its Status.
//
// Contract under test (SRS docs/spec/30.cli-interface.srs.md IR-CLI-066):
//
//   The speckiwi set-supersede command delegates to the setSupersede core to update the Supersedes or
//   Superseded By metadata of a requirement, supports a sync-trace flag, dry-run, and json, and edits no
//   requirement Status.
//
//   - AC-1: `set-supersede <id> --supersedes <oldId>` updates the Supersedes metadata field.
//   - AC-2: `set-supersede <id> --superseded-by <newId>` updates the Superseded By metadata field.
//   - AC-3: `set-supersede --sync-trace` also writes the matching Trace Link row.
//   - AC-4: `set-supersede --dry-run` prints a preview and writes no file.
//
// Fixture (mutation-target): the single requirement FR-ARCH-001 lives in the ARCH scope document
// (test/fixtures/workspaces/mutation-target/docs/spec/10.product-architecture.srs.md). Its pinned fixture
// facts:
//   - Field block carries `| Status | planned |` and has NO `| Supersedes |` / `| Superseded By |` row yet.
//   - Trace Links is a header-only table ("| Type | Reference | Relation | Notes |" / "| --- | --- | --- | --- |").
// The setSupersede core returns mutationOk({ id, written, warnings }) and surfaces a patch preview; a
// metadata-only write changes neither the Status field nor (without --sync-trace) the Trace Links table.

const ARCH_DOC = path.join("docs", "spec", "10.product-architecture.srs.md");
const ID = "FR-ARCH-001";
const SUPERSEDES_ID = "FR-ARCH-009";
const SUPERSEDED_BY_ID = "FR-ARCH-010";

function io() {
  return { stdout: new PassThrough() as NodeJS.WriteStream, stderr: new PassThrough() as NodeJS.WriteStream };
}

/** Drains the output written to a finished run's stream. */
function drain(stream: NodeJS.WriteStream): string {
  return (stream as unknown as PassThrough).read()?.toString() ?? "";
}

async function readArch(root: string): Promise<string> {
  return readFile(path.join(root, ARCH_DOC), "utf8");
}

/**
 * Slices an `### FR-...` requirement block out of the scope document, up to the next `### ` heading
 * (or EOF). (Mirrors the supersede / restore suites' heading matcher.)
 */
function requirementBlock(text: string, id: string): string {
  let start = text.indexOf(`### ${id} `);
  if (start < 0) start = text.indexOf(`### ~~${id} `);
  if (start < 0) return "";
  const next = text.indexOf("\n### ", start + 1);
  return text.slice(start, next >= 0 ? next : undefined);
}

/** Recovers a metadata field value (e.g. "Status", "Supersedes") declared inside a requirement's field block. */
function fieldValue(block: string, field: string): string | undefined {
  const match = block.match(new RegExp(`\\|\\s*${field}\\s*\\|\\s*([^|]+?)\\s*\\|`));
  return match?.[1]?.trim();
}

describe("IR-CLI-066 — set-supersede command updates supersede metadata without editing Status", () => {
  // AC-1: `set-supersede <id> --supersedes <oldId>` updates the Supersedes metadata field.
  it("IR-CLI-066 AC-1: --supersedes writes the Supersedes metadata field and edits no Status", async () => {
    const root = await copyFixtureWorkspace("mutation-target");
    const before = await readArch(root);
    // sanity: the requirement starts present, planned, with no Supersedes row yet.
    expect(before).toContain(`### ${ID} `);
    expect(fieldValue(requirementBlock(before, ID), "Status")).toBe("planned");
    expect(fieldValue(requirementBlock(before, ID), "Supersedes")).toBeUndefined();

    const run = io();
    const code = await main(["--root", root, "set-supersede", ID, "--supersedes", SUPERSEDES_ID, "--json"], run);
    expect(code).toBe(0);

    const parsed = JSON.parse(drain(run.stdout)) as { ok?: boolean; error?: { code?: string } };
    // The failure (if any) must NOT be commander rejecting an unknown command.
    expect(parsed.error?.code).not.toBe("CLI_USAGE_ERROR");
    expect(parsed.ok).toBe(true);

    const after = await readArch(root);
    const block = requirementBlock(after, ID);
    // The Supersedes metadata field now carries the old id, written into the field block.
    expect(fieldValue(block, "Supersedes")).toBe(SUPERSEDES_ID);
    // Status is untouched (metadata-only mutation, distinct from IR-CLI-059 supersede).
    expect(fieldValue(block, "Status")).toBe("planned");
  });

  // AC-2: `set-supersede <id> --superseded-by <newId>` updates the Superseded By metadata field.
  it("IR-CLI-066 AC-2: --superseded-by writes the Superseded By metadata field and edits no Status", async () => {
    const root = await copyFixtureWorkspace("mutation-target");

    const run = io();
    const code = await main(["--root", root, "set-supersede", ID, "--superseded-by", SUPERSEDED_BY_ID, "--json"], run);
    expect(code).toBe(0);

    const parsed = JSON.parse(drain(run.stdout)) as { ok?: boolean; error?: { code?: string } };
    expect(parsed.error?.code).not.toBe("CLI_USAGE_ERROR");
    expect(parsed.ok).toBe(true);

    const after = await readArch(root);
    const block = requirementBlock(after, ID);
    // The Superseded By metadata field now carries the new id.
    expect(fieldValue(block, "Superseded By")).toBe(SUPERSEDED_BY_ID);
    // Status is untouched.
    expect(fieldValue(block, "Status")).toBe("planned");
  });

  // AC-3: `set-supersede --sync-trace` also writes the matching Trace Link row.
  it("IR-CLI-066 AC-3: --sync-trace also writes the matching supersedes Trace Link row", async () => {
    const root = await copyFixtureWorkspace("mutation-target");

    const run = io();
    const code = await main(
      ["--root", root, "set-supersede", ID, "--supersedes", SUPERSEDES_ID, "--sync-trace", "--json"],
      run
    );
    expect(code).toBe(0);

    const parsed = JSON.parse(drain(run.stdout)) as { ok?: boolean; error?: { code?: string } };
    expect(parsed.error?.code).not.toBe("CLI_USAGE_ERROR");
    expect(parsed.ok).toBe(true);

    const after = await readArch(root);
    const block = requirementBlock(after, ID);
    // The metadata field is still written...
    expect(fieldValue(block, "Supersedes")).toBe(SUPERSEDES_ID);
    // ...and the matching `supersedes` Trace Link row is inserted into the requirement's Trace Links table.
    expect(block).toContain(`| Requirement | ${SUPERSEDES_ID} | supersedes | - |`);
  });

  // AC-4: `set-supersede --dry-run` prints a preview and writes no file.
  it("IR-CLI-066 AC-4: --dry-run prints a preview and writes no file", async () => {
    const root = await copyFixtureWorkspace("mutation-target");
    const before = await readArch(root);

    const run = io();
    const code = await main(
      ["--root", root, "set-supersede", ID, "--supersedes", SUPERSEDES_ID, "--dry-run", "--json"],
      run
    );
    expect(code).toBe(0);

    // No file write: the scope document is byte-for-byte unchanged after a dry-run.
    const after = await readArch(root);
    expect(after).toBe(before);
    expect(fieldValue(requirementBlock(after, ID), "Supersedes")).toBeUndefined();

    // The dry-run still reports a successful (non-writing) envelope: written is false.
    const parsed = JSON.parse(drain(run.stdout)) as { ok?: boolean; error?: { code?: string }; value?: { written?: boolean } };
    expect(parsed.error?.code).not.toBe("CLI_USAGE_ERROR");
    expect(parsed.ok).toBe(true);
    expect(parsed.value?.written).toBe(false);
  });
});
