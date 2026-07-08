import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { main } from "../../src/cli/index.js";
import { copyFixtureWorkspace } from "../fixtures/fixture-utils.js";

// IR-CLI-039 — `speckiwi update-field` command with id-regenerating type/scope and a migration guard.
//
// Red-phase suite (T-PH004-21): one test case per acceptance criterion (AC-1..AC-5). These cases pin
// the future CLI contract before `src/cli/index.ts` / `src/cli/commands/mutations.ts` teach the CLI an
// `update-field` command, so the whole suite fails today — commander rejects the unknown `update-field`
// command (non-zero usage exit, no mutation payload printed) — until the green task (T-PH004-22) wires
// the command against the existing core mutation (src/core/mutation/update-field.ts `updateField`,
// FR-NODE-048): a line-replacement edit for priority/risk/title/target/verification-method, and a
// type/scope migration that regenerates the requirement ID via the deterministic next-ID generator
// (src/core/mutation/add-requirement.ts `generateNextRequirementId`) under a dry-run + sign-off guard
// while rewriting inbound trace references.
//
// Contract under test (SRS docs/spec/30.cli-interface.srs.md IR-CLI-039):
//
//   SpecKiwi provides a `speckiwi update-field <id> --field <field> --value <value>` command that edits
//   priority, risk, title, target, verification-method, type, or scope on a single requirement, and when
//   the edited field is type or scope it regenerates the requirement ID via the deterministic ID
//   generator under a dry-run plus sign-off migration guard and rewrites inbound trace references rather
//   than mutating the ID prefix manually.
//
//   - AC-1: update-field <id> --field priority --value <p> updates only the priority metadata cell.
//   - AC-2: The command accepts priority, risk, title, target, verification-method, type, and scope and
//           rejects any other field name with a usage error.
//   - AC-3: Editing field type or scope regenerates the requirement ID using the deterministic next-ID
//           generator so the new ID matches the prefix-scope-NNN pattern.
//   - AC-4: A type or scope edit defaults to dry-run preview and requires an explicit apply plus
//           confirmation flag before any file is written.
//   - AC-5: A type or scope edit produces a new non-colliding ID and updates inbound trace references to
//           the old ID.
//
// Fixture (mutation-target): a single requirement FR-ARCH-001 (Type=functional, scope prefix ARCH,
// Priority=high) lives in the ARCH scope document; the index registers the ARCH scope (prefix ARCH).
// Deterministic ID generator facts pinned below:
//   - functional → prefix FR, non_functional → NFR, interface → IR (src/core/types.ts TYPE_PREFIX).
//   - A `type` edit functional→interface keeps scope ARCH and, with no existing IR-ARCH-* id, yields the
//     new id IR-ARCH-001 (generateNextRequirementId: max(used)=0 → 001, zero-padded width 3).
//   - A `scope` edit ARCH→PARSE keeps type functional and, with no existing FR-PARSE-* id, yields
//     FR-PARSE-001. The new id is non-colliding (no FR-PARSE-001 exists before the edit).

const SCOPE_DOC = path.join("docs", "spec", "10.product-architecture.srs.md");
const TARGET_ID = "FR-ARCH-001";

function io() {
  return { stdout: new PassThrough() as NodeJS.WriteStream, stderr: new PassThrough() as NodeJS.WriteStream };
}

/** Drains the output written to a finished run's stream. */
function drain(stream: NodeJS.WriteStream): string {
  return (stream as unknown as PassThrough).read()?.toString() ?? "";
}

/** Reads the current value of a single metadata cell (e.g. "Priority") for a requirement block. */
async function metadataCell(root: string, id: string, field: string): Promise<string | undefined> {
  const text = await readFile(path.join(root, SCOPE_DOC), "utf8");
  const blockStart = text.indexOf(`### ${id} `);
  if (blockStart < 0) return undefined;
  const nextHeading = text.indexOf("\n### ", blockStart + 1);
  const block = text.slice(blockStart, nextHeading >= 0 ? nextHeading : undefined);
  const match = block.match(new RegExp(`\\|\\s*${field}\\s*\\|\\s*([^|]*?)\\s*\\|`));
  return match ? match[1] : undefined;
}

/** A second requirement whose Trace Links table holds an inbound Requirement reference to refId. */
function inboundReferer(id: string, refId: string): string {
  return [
    `### ${id} — Inbound referer ${id}`,
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
    `Fixture requirement ${id} references ${refId}.`,
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
    `| Requirement | ${refId} | depends_on | - |`,
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

/** Appends an extra requirement block to the ARCH scope document. */
async function appendBlock(root: string, block: string): Promise<void> {
  const specPath = path.join(root, SCOPE_DOC);
  const text = await readFile(specPath, "utf8");
  await writeFile(specPath, `${text.trimEnd()}\n\n${block}\n`, "utf8");
}

/** Walks a JSON result envelope to recover the mutation value object (carrying id/field/written). */
function findValue(parsed: unknown): Record<string, unknown> | undefined {
  const stack: unknown[] = [parsed];
  const seen = new Set<unknown>();
  while (stack.length > 0) {
    const node = stack.pop();
    if (!node || typeof node !== "object" || seen.has(node)) continue;
    seen.add(node);
    const record = node as Record<string, unknown>;
    if (typeof record.field === "string" && "written" in record) return record;
    for (const value of Object.values(record)) stack.push(value);
  }
  return undefined;
}

describe("IR-CLI-039 — update-field command with id-regenerating type and scope migration guard", () => {
  // AC-1: `update-field <id> --field priority --value <p>` updates only the priority metadata cell.
  it("IR-CLI-039 AC-1: edits only the priority metadata cell for the requirement", async () => {
    const root = await copyFixtureWorkspace("mutation-target");

    expect(await metadataCell(root, TARGET_ID, "Priority")).toBe("high");
    const riskBefore = await metadataCell(root, TARGET_ID, "Risk");
    const targetBefore = await metadataCell(root, TARGET_ID, "Target");
    const typeBefore = await metadataCell(root, TARGET_ID, "Type");

    const run = io();
    const code = await main(["--root", root, "update-field", TARGET_ID, "--field", "priority", "--value", "low", "--json"], run);
    const out = drain(run.stdout);
    expect(code).toBe(0);

    const value = findValue(JSON.parse(out));
    expect(value, "update-field must print a mutation value with field/written").toBeDefined();
    expect(value?.field).toBe("priority");
    expect(value?.written).toBe(true);

    // Only Priority changed; the heading and every other metadata cell are untouched.
    expect(await metadataCell(root, TARGET_ID, "Priority")).toBe("low");
    expect(await metadataCell(root, TARGET_ID, "Risk")).toBe(riskBefore);
    expect(await metadataCell(root, TARGET_ID, "Target")).toBe(targetBefore);
    expect(await metadataCell(root, TARGET_ID, "Type")).toBe(typeBefore);
    const text = await readFile(path.join(root, SCOPE_DOC), "utf8");
    expect(text).toContain(`### ${TARGET_ID} — Mutable requirement`);
  });

  // AC-2: accepts priority/risk/title/target/verification-method/type/scope, rejects any other field.
  it("IR-CLI-039 AC-2: accepts the seven documented fields and rejects an unknown field name", async () => {
    const root = await copyFixtureWorkspace("mutation-target");

    // A line-replacement field (risk) is accepted and applied.
    const risk = io();
    expect(
      await main(["--root", root, "update-field", TARGET_ID, "--field", "risk", "--value", "high", "--json"], risk)
    ).toBe(0);
    expect(await metadataCell(root, TARGET_ID, "Risk")).toBe("high");

    // A type/scope edit is accepted (dry-run preview, no write needed here) — proving the field is in
    // the accepted set without requiring confirmation.
    const typePreview = io();
    expect(
      await main(["--root", root, "update-field", TARGET_ID, "--field", "type", "--value", "interface", "--json"], typePreview)
    ).toBe(0);

    // An unknown field name is rejected with a usage error: non-zero exit and a diagnostic message.
    const unknown = io();
    const code = await main(["--root", root, "update-field", TARGET_ID, "--field", "colour", "--value", "blue", "--json"], unknown);
    expect(code).not.toBe(0);
    expect(`${drain(unknown.stdout)}${drain(unknown.stderr)}`.toLowerCase()).toMatch(/colour|field|usage|invalid|unsupported/);
  });

  // AC-3: a type or scope edit regenerates the ID via the deterministic generator (prefix-scope-NNN).
  it("IR-CLI-039 AC-3: a type/scope edit regenerates a deterministic prefix-scope-NNN id", async () => {
    const root = await copyFixtureWorkspace("mutation-target");

    // type functional → interface keeps scope ARCH and yields IR-ARCH-001 (no prior IR-ARCH-* id).
    const typeRun = io();
    expect(
      await main(["--root", root, "update-field", TARGET_ID, "--field", "type", "--value", "interface", "--json"], typeRun)
    ).toBe(0);
    const typeValue = findValue(JSON.parse(drain(typeRun.stdout)));
    expect(typeValue?.newId).toBe("IR-ARCH-001");
    expect(String(typeValue?.newId)).toMatch(/^IR-ARCH-\d{3}$/);

    // scope ARCH → PARSE keeps type functional and yields FR-PARSE-001 (no prior FR-PARSE-* id).
    const scopeRun = io();
    expect(
      await main(["--root", root, "update-field", TARGET_ID, "--field", "scope", "--value", "PARSE", "--json"], scopeRun)
    ).toBe(0);
    const scopeValue = findValue(JSON.parse(drain(scopeRun.stdout)));
    expect(scopeValue?.newId).toBe("FR-PARSE-001");
    expect(String(scopeValue?.newId)).toMatch(/^FR-PARSE-\d{3}$/);
  });

  // AC-4: a type/scope edit defaults to dry-run and requires an explicit apply + confirmation flag.
  it("IR-CLI-039 AC-4: type/scope edit defaults to dry-run and writes only under apply + confirm", async () => {
    const root = await copyFixtureWorkspace("mutation-target");
    const before = await readFile(path.join(root, SCOPE_DOC), "utf8");

    // Default (no --apply): a preview that writes nothing. The block still carries the old id/type.
    const preview = io();
    const previewCode = await main(["--root", root, "update-field", TARGET_ID, "--field", "type", "--value", "interface", "--json"], preview);
    expect(previewCode).toBe(0);
    const previewValue = findValue(JSON.parse(drain(preview.stdout)));
    expect(previewValue?.dryRun).toBe(true);
    expect(previewValue?.written).toBe(false);
    expect(await readFile(path.join(root, SCOPE_DOC), "utf8"), "dry-run must not write").toBe(before);

    // --apply WITHOUT the confirmation flag must still refuse to write (sign-off guard).
    const applyOnly = io();
    const applyOnlyCode = await main(
      ["--root", root, "update-field", TARGET_ID, "--field", "type", "--value", "interface", "--apply", "--json"],
      applyOnly
    );
    expect(applyOnlyCode, "--apply without --confirm must be denied").not.toBe(0);
    expect(await readFile(path.join(root, SCOPE_DOC), "utf8"), "apply-without-confirm must not write").toBe(before);

    // --apply --confirm performs the migration: the heading id becomes the regenerated IR-ARCH-001 and
    // the old id heading is gone.
    const confirmed = io();
    const confirmedCode = await main(
      ["--root", root, "update-field", TARGET_ID, "--field", "type", "--value", "interface", "--apply", "--confirm", "--json"],
      confirmed
    );
    expect(confirmedCode).toBe(0);
    const text = await readFile(path.join(root, SCOPE_DOC), "utf8");
    expect(text).toContain("### IR-ARCH-001 — Mutable requirement");
    expect(text).not.toContain(`### ${TARGET_ID} — Mutable requirement`);
  });

  // FND-003 (IR-CLI-039 AC-1): --dry-run on a line-replacement field must be honored — written=false
  // and the file is unchanged. The advertised --dry-run flag was previously forwarded only for the
  // type/scope migration fields, so a priority/risk/title/target/verification-method dry-run was
  // silently ignored and the workspace file was written.
  it("FND-003: --dry-run on a line-replacement field writes nothing and reports written=false", async () => {
    const root = await copyFixtureWorkspace("mutation-target");
    const before = await readFile(path.join(root, SCOPE_DOC), "utf8");
    expect(await metadataCell(root, TARGET_ID, "Priority")).toBe("high");

    const run = io();
    const code = await main(
      ["--root", root, "update-field", TARGET_ID, "--field", "priority", "--value", "low", "--dry-run", "--json"],
      run
    );
    expect(code).toBe(0);
    const value = findValue(JSON.parse(drain(run.stdout)));
    expect(value, "update-field --dry-run must print a mutation value").toBeDefined();
    expect(value?.field).toBe("priority");
    expect(value?.written, "--dry-run must report written=false on a line-replacement field").toBe(false);

    // The file is byte-for-byte unchanged: no write happened.
    expect(await readFile(path.join(root, SCOPE_DOC), "utf8"), "--dry-run must not write the file").toBe(before);
    expect(await metadataCell(root, TARGET_ID, "Priority")).toBe("high");
  });

  // AC-5: a type/scope edit produces a new non-colliding id AND updates inbound trace references.
  it("IR-CLI-039 AC-5: migration yields a non-colliding id and rewrites inbound trace references", async () => {
    const root = await copyFixtureWorkspace("mutation-target");
    // A second requirement holds an inbound Trace Link to FR-ARCH-001.
    await appendBlock(root, inboundReferer("FR-ARCH-002", TARGET_ID));

    const before = await readFile(path.join(root, SCOPE_DOC), "utf8");
    expect(before).toContain(`| Requirement | ${TARGET_ID} | depends_on | - |`);
    // The regenerated id IR-ARCH-001 must not already exist (non-colliding precondition).
    expect(before).not.toContain("### IR-ARCH-001 ");

    const run = io();
    const code = await main(
      ["--root", root, "update-field", TARGET_ID, "--field", "type", "--value", "interface", "--apply", "--confirm", "--json"],
      run
    );
    expect(code).toBe(0);
    const value = findValue(JSON.parse(drain(run.stdout)));
    expect(value?.newId).toBe("IR-ARCH-001");
    expect(value?.oldId).toBe(TARGET_ID);

    const after = await readFile(path.join(root, SCOPE_DOC), "utf8");
    // New, non-colliding heading id is present and unique.
    expect(after).toContain("### IR-ARCH-001 — Mutable requirement");
    expect(after.match(/### IR-ARCH-001 /g)?.length).toBe(1);
    // The inbound Trace Link reference was rewritten from the old id to the new id.
    expect(after).toContain("| Requirement | IR-ARCH-001 | depends_on | - |");
    expect(after).not.toContain(`| Requirement | ${TARGET_ID} | depends_on | - |`);
  });
});
