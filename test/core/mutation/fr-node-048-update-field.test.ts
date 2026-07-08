import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { resolveProjectRoot } from "../../../src/core/project-root.js";
// update-field is the FR-NODE-060 core mutation introduced by the green task (T-PH003-62).
// It does not exist yet, so this import fails at collection time — the red signal for the
// whole suite. UpdateFieldInput / UpdateFieldOutput are the public contract types exercised
// by the dry-run / sign-off / ID-prefix-migration criteria.
import {
  updateField,
  type UpdateFieldInput,
  type UpdateFieldOutput
} from "../../../src/core/mutation/update-field.js";
import { copyFixtureWorkspace } from "../../fixtures/fixture-utils.js";

// FR-NODE-060 — update-field core mutation for metadata fields with ID-prefix migration
// for type and scope. Red-phase suite (T-PH003-61): one test case per acceptance
// criterion (AC-1..AC-5), asserted against the future update-field contract. Each case
// fails before the mutation and its input/output types exist in
// src/core/mutation/update-field.ts.

const SPEC_FILE = path.join("docs", "spec", "10.product-architecture.srs.md");

async function specPath(rootPath: string): Promise<string> {
  return path.join(rootPath, SPEC_FILE);
}

async function readSpec(rootPath: string): Promise<string> {
  return readFile(await specPath(rootPath), "utf8");
}

/**
 * Inserts a second requirement FR-ARCH-002 into the fixture whose Trace Links table holds
 * an inbound Requirement reference to FR-ARCH-001. Used by AC-4 to prove a confirmed
 * type/scope migration rewrites inbound Trace References from the old id to the new id.
 */
async function addInboundTraceRequirement(rootPath: string): Promise<void> {
  const file = await specPath(rootPath);
  const text = await readFile(file, "utf8");
  const block = [
    "",
    "### FR-ARCH-002 — Dependent requirement",
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
    "A requirement that traces to FR-ARCH-001.",
    "",
    "#### Rationale",
    "",
    "-",
    "",
    "#### Acceptance Criteria",
    "",
    "- [ ] AC-1: It depends on the mutable requirement.",
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
    "| Requirement | FR-ARCH-001 | depends_on | - |",
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
    "| 2026-05-08 | Created | Fixture |"
  ].join("\n");
  await writeFile(file, `${text.trimEnd()}\n${block}\n`, "utf8");
}

describe("FR-NODE-060 update-field core mutation", () => {
  // AC-1: Calling update-field with field=priority (one of priority/risk/title/target/
  // verification-method) rewrites only that one metadata line and leaves every other line
  // of the requirement unchanged.
  it("FR-NODE-060 AC-1: rewrites only the single targeted metadata line", async () => {
    const rootPath = await copyFixtureWorkspace("mutation-target");
    const root = await resolveProjectRoot(rootPath);
    const before = await readSpec(rootPath);

    const result = await updateField(root, {
      id: "FR-ARCH-001",
      field: "priority",
      value: "low"
    } satisfies UpdateFieldInput);
    expect(result.ok).toBe(true);

    const after = await readSpec(rootPath);
    // Exactly one line changed: the Priority metadata row.
    expect(after).toContain("| Priority | low |");
    expect(after).not.toContain("| Priority | high |");

    const beforeLines = before.split("\n");
    const afterLines = after.split("\n");
    expect(afterLines.length).toBe(beforeLines.length);
    const changed = afterLines.filter((line, index) => line !== beforeLines[index]);
    expect(changed).toEqual(["| Priority | low |"]);
  });

  // AC-2: Calling update-field with field=type regenerates the requirement id using
  // generateNextRequirementId so the new id prefix matches the new type (and scope). For
  // FR-ARCH-001 (functional/ARCH) migrating to non_functional, the regenerated id is the
  // first free NFR-ARCH slot: NFR-ARCH-001.
  it("FR-NODE-060 AC-2: a type edit regenerates the id prefix via generateNextRequirementId", async () => {
    const rootPath = await copyFixtureWorkspace("mutation-target");
    const root = await resolveProjectRoot(rootPath);

    const result = await updateField(root, {
      id: "FR-ARCH-001",
      field: "type",
      value: "non_functional",
      signOff: true,
      dryRun: false
    } satisfies UpdateFieldInput);
    expect(result.ok).toBe(true);
    if (result.ok !== true || result.value === undefined) throw new Error("expected ok result");

    const value: UpdateFieldOutput = result.value;
    expect(value.oldId).toBe("FR-ARCH-001");
    // FR -> NFR prefix migration, ARCH scope, first free slot.
    expect(value.newId).toBe("NFR-ARCH-001");

    const after = await readSpec(rootPath);
    expect(after).toContain("### NFR-ARCH-001 — Mutable requirement");
    expect(after).toContain("| Type | non_functional |");
    expect(after).not.toContain("### FR-ARCH-001 — Mutable requirement");
  });

  // AC-3: A type (or scope) edit defaults to dry-run and returns the old id, the generated
  // new id, and the planned block move before any file is written.
  it("FR-NODE-060 AC-3: a type edit defaults to dry-run, reports old/new id and planned move, writes nothing", async () => {
    const rootPath = await copyFixtureWorkspace("mutation-target");
    const root = await resolveProjectRoot(rootPath);
    const before = await readSpec(rootPath);

    // No dryRun and no signOff supplied — a type edit must default to dry-run.
    const result = await updateField(root, {
      id: "FR-ARCH-001",
      field: "type",
      value: "non_functional"
    } satisfies UpdateFieldInput);
    expect(result.ok).toBe(true);
    if (result.ok !== true || result.value === undefined) throw new Error("expected ok result");

    const value: UpdateFieldOutput = result.value;
    expect(value.dryRun).toBe(true);
    expect(value.oldId).toBe("FR-ARCH-001");
    expect(value.newId).toBe("NFR-ARCH-001");
    // The planned block move is reported before any write.
    expect(value.plannedMove).toBeDefined();

    // No file was written during the default dry-run.
    const after = await readSpec(rootPath);
    expect(after).toBe(before);
  });

  // AC-4: A type/scope edit without an explicit sign-off flag returns ok=false and writes
  // no file changes; a confirmed edit rewrites inbound Trace Links references from the old
  // id to the new id.
  it("FR-NODE-060 AC-4: no sign-off blocks the write; a confirmed edit rewrites inbound trace references", async () => {
    // Part A: dry-run disabled but no sign-off — the migration is refused and nothing is written.
    const refuseRoot = await copyFixtureWorkspace("mutation-target");
    const rootA = await resolveProjectRoot(refuseRoot);
    const beforeRefuse = await readSpec(refuseRoot);
    const refused = await updateField(rootA, {
      id: "FR-ARCH-001",
      field: "type",
      value: "non_functional",
      dryRun: false
    } satisfies UpdateFieldInput);
    expect(refused.ok).toBe(false);
    expect(await readSpec(refuseRoot)).toBe(beforeRefuse);
    expect(await readSpec(refuseRoot)).toContain("### FR-ARCH-001 — Mutable requirement");

    // Part B: a confirmed edit rewrites the inbound Trace Links reference FR-ARCH-001 -> NFR-ARCH-001.
    const okRoot = await copyFixtureWorkspace("mutation-target");
    await addInboundTraceRequirement(okRoot);
    const rootB = await resolveProjectRoot(okRoot);
    const confirmed = await updateField(rootB, {
      id: "FR-ARCH-001",
      field: "type",
      value: "non_functional",
      signOff: true,
      dryRun: false
    } satisfies UpdateFieldInput);
    expect(confirmed.ok).toBe(true);

    const written = await readSpec(okRoot);
    // The inbound trace reference was migrated to the new id.
    expect(written).toContain("| Requirement | NFR-ARCH-001 | depends_on | - |");
    expect(written).not.toContain("| Requirement | FR-ARCH-001 | depends_on | - |");
  });

  // AC-5: Calling update-field on an unknown requirement id returns ok=false with
  // error.code=NOT_FOUND and writes no file changes.
  it("FR-NODE-060 AC-5: unknown requirement id returns NOT_FOUND and writes nothing", async () => {
    const rootPath = await copyFixtureWorkspace("mutation-target");
    const root = await resolveProjectRoot(rootPath);
    const before = await readSpec(rootPath);

    const result = await updateField(root, {
      id: "FR-ARCH-999",
      field: "priority",
      value: "low"
    } satisfies UpdateFieldInput);
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("NOT_FOUND");

    // No file changes on an unknown id.
    expect(await readSpec(rootPath)).toBe(before);
  });
});
