import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { resolveProjectRoot } from "../../../src/core/project-root.js";
import { validateWorkspace } from "../../../src/core/validator/validate-workspace.js";
import { parseWorkspace } from "../../../src/core/parser/workspace-parser.js";
import {
  applyRequirementIdCollisionRepair,
  diagnoseRequirementIdCollisions,
  planRequirementIdCollisionRepair,
  type RequirementIdCollisionGroup
} from "../../../src/core/mutation/repair-requirement-id.js";
import { copyFixtureWorkspace } from "../../fixtures/fixture-utils.js";

function groupById(groups: RequirementIdCollisionGroup[], id: string): RequirementIdCollisionGroup {
  const group = groups.find((item) => item.duplicateId === id);
  if (!group) throw new Error(`duplicate group not found: ${id}`);
  return group;
}

async function duplicateGroup(rootPath: string, id: string): Promise<RequirementIdCollisionGroup> {
  const diagnosed = await diagnoseRequirementIdCollisions(await resolveProjectRoot(rootPath));
  expect(diagnosed.ok).toBe(true);
  return groupById(diagnosed.value.groups, id);
}

async function duplicateCodes(rootPath: string): Promise<string[]> {
  const workspace = await parseWorkspace(await resolveProjectRoot(rootPath));
  return validateWorkspace(workspace).diagnostics.map((item) => item.code);
}

describe("FR-NODE-032 Requirement ID collision repair core", () => {
  it("diagnoses grouped duplicates with candidate IDs and plans without writing", async () => {
    const rootPath = await copyFixtureWorkspace("duplicate-id-three-occurrences");
    const group = await duplicateGroup(rootPath, "REL-PARSE-903");
    const before = await readFile(path.join(rootPath, "docs/spec/20.parser-validation.srs.md"), "utf8");

    expect(group).toMatchObject({
      duplicateId: "REL-PARSE-903",
      candidateReplacementIds: ["REL-PARSE-904"],
      repairReady: true,
      conflictMarkers: false
    });
    expect(group.occurrences).toHaveLength(3);

    const planned = await planRequirementIdCollisionRepair(await resolveProjectRoot(rootPath), {
      duplicateId: group.duplicateId,
      keep: group.occurrences[0]!,
      rename: group.occurrences[1]!,
      allocationStrategy: "next_available"
    });

    expect(planned).toMatchObject({
      ok: true,
      value: {
        replacementId: "REL-PARSE-904",
        written: false,
        touchedFiles: ["docs/spec/20.parser-validation.srs.md"],
        pendingDuplicateGroups: []
      }
    });
    expect(planned.value?.operations).toEqual(
      expect.arrayContaining([expect.objectContaining({ filePath: "docs/spec/20.parser-validation.srs.md", replacement: expect.stringContaining("REL-PARSE-904") })])
    );
    expect(await readFile(path.join(rootPath, "docs/spec/20.parser-validation.srs.md"), "utf8")).toBe(before);
  });

  it("applies a selected same-file collision and leaves validation without SRS-E002", async () => {
    const rootPath = await copyFixtureWorkspace("duplicate-id");
    const group = await duplicateGroup(rootPath, "FR-ARCH-001");
    const root = await resolveProjectRoot(rootPath);

    const applied = await applyRequirementIdCollisionRepair(root, {
      duplicateId: group.duplicateId,
      keep: group.occurrences[0]!,
      rename: group.occurrences[1]!,
      allocationStrategy: "next_available"
    });

    expect(applied).toMatchObject({
      ok: true,
      value: {
        replacementId: "FR-ARCH-002",
        written: true,
        completedOperations: 1,
        pendingOperations: 0,
        pendingDuplicateGroups: []
      },
      mutation: { kind: "repair_requirement_id_collision", written: true }
    });
    const text = await readFile(path.join(rootPath, "docs/spec/10.product-architecture.srs.md"), "utf8");
    expect(text).toContain("### FR-ARCH-001 — First");
    expect(text).toContain("### FR-ARCH-002 — Duplicate");
    expect(await duplicateCodes(rootPath)).not.toContain("SRS-E002");
  });

  it("reports remaining occurrences as pending when a multi-occurrence group is repaired one occurrence at a time", async () => {
    const rootPath = await copyFixtureWorkspace("duplicate-id-three-occurrences");
    const group = await duplicateGroup(rootPath, "REL-PARSE-903");

    const applied = await applyRequirementIdCollisionRepair(await resolveProjectRoot(rootPath), {
      duplicateId: group.duplicateId,
      keep: group.occurrences[0]!,
      rename: group.occurrences[1]!,
      replacementId: "REL-PARSE-904"
    });

    expect(applied).toMatchObject({
      ok: true,
      value: {
        written: true,
        pendingDuplicateGroups: ["REL-PARSE-903"],
        pendingRepair: { pendingDuplicateGroups: ["REL-PARSE-903"] }
      }
    });
  });

  it("fails closed for stale identities, conflict markers, generated-ID collisions, and ambiguous references", async () => {
    const rootPath = await copyFixtureWorkspace("duplicate-id");
    const group = await duplicateGroup(rootPath, "FR-ARCH-001");
    const root = await resolveProjectRoot(rootPath);

    await expect(
      planRequirementIdCollisionRepair(root, {
        duplicateId: group.duplicateId,
        keep: group.occurrences[0]!,
        rename: { ...group.occurrences[1]!, blockHash: "stale" },
        replacementId: "FR-ARCH-002"
      })
    ).resolves.toMatchObject({ ok: false, error: { code: "STALE_PATCH" } });

    await expect(
      planRequirementIdCollisionRepair(root, {
        duplicateId: group.duplicateId,
        keep: group.occurrences[0]!,
        rename: group.occurrences[1]!,
        replacementId: "FR-ARCH-001"
      })
    ).resolves.toMatchObject({ ok: false, error: { code: "GENERATED_ID_COLLISION" } });

    const specPath = path.join(rootPath, "docs/spec/10.product-architecture.srs.md");
    await writeFile(specPath, `${await readFile(specPath, "utf8")}\n<<<<<<< HEAD\n`, "utf8");
    await expect(
      planRequirementIdCollisionRepair(root, {
        duplicateId: group.duplicateId,
        keep: group.occurrences[0]!,
        rename: group.occurrences[1]!,
        replacementId: "FR-ARCH-002"
      })
    ).resolves.toMatchObject({ ok: false, error: { code: "MUTATION_DENIED" } });

    const ambiguousRoot = await copyFixtureWorkspace("duplicate-id");
    const ambiguousGroup = await duplicateGroup(ambiguousRoot, "FR-ARCH-001");
    const ambiguousIndex = path.join(ambiguousRoot, "docs/spec/00.index.md");
    await writeFile(ambiguousIndex, `${await readFile(ambiguousIndex, "utf8")}\n\nFR-ARCH-001 is mentioned outside the selected block.\n`, "utf8");
    await expect(
      applyRequirementIdCollisionRepair(await resolveProjectRoot(ambiguousRoot), {
        duplicateId: ambiguousGroup.duplicateId,
        keep: ambiguousGroup.occurrences[0]!,
        rename: ambiguousGroup.occurrences[1]!,
        replacementId: "FR-ARCH-002"
      })
    ).resolves.toMatchObject({ ok: false, error: { code: "AMBIGUOUS_REFERENCE" }, diagnosticsSummary: { byCode: { "SRS-E076": 1 } } });
  });

  it("updates only explicit mapped references and honors lock plus ignoreLock semantics", async () => {
    const rootPath = await copyFixtureWorkspace("duplicate-id");
    const indexPath = path.join(rootPath, "docs/spec/00.index.md");
    await writeFile(
      indexPath,
      `${await readFile(indexPath, "utf8")}\n\n## 7. Completed Work Log\n\n| Date | Target | Scope | Requirement IDs | Summary | Report Paths |\n|---|---|---|---|---|---|\n| 2026-06-30 | v1.0.0 | ARCH | FR-ARCH-001 | Duplicate repair fixture. | docs/reports/repair.md |\n`,
      "utf8"
    );
    const group = await duplicateGroup(rootPath, "FR-ARCH-001");
    const rowLine = (await readFile(indexPath, "utf8")).split("\n").findIndex((line) => line.includes("Duplicate repair fixture")) + 1;
    const root = await resolveProjectRoot(rootPath);

    const planned = await planRequirementIdCollisionRepair(root, {
      duplicateId: group.duplicateId,
      keep: group.occurrences[0]!,
      rename: group.occurrences[1]!,
      replacementId: "FR-ARCH-002"
    });
    expect(planned.value?.ambiguousReferences).toEqual([expect.objectContaining({ filePath: "docs/spec/00.index.md", line: rowLine })]);

    await mkdir(path.join(rootPath, "kiwi"), { recursive: true });
    await writeFile(
      path.join(rootPath, "kiwi/.srs.lock"),
      JSON.stringify({
        schemaVersion: "1.0.0",
        owner: "test",
        operation: "other_mutation",
        requestId: "lock-test",
        acquiredAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 60_000).toISOString()
      }),
      "utf8"
    );

    await expect(
      applyRequirementIdCollisionRepair(root, {
        duplicateId: group.duplicateId,
        keep: group.occurrences[0]!,
        rename: group.occurrences[1]!,
        replacementId: "FR-ARCH-002",
        referenceEdits: [{ filePath: "docs/spec/00.index.md", line: rowLine, from: "FR-ARCH-001", to: "FR-ARCH-002" }]
      })
    ).resolves.toMatchObject({ ok: false, error: { code: "SRS_LOCKED" } });

    const ignored = await applyRequirementIdCollisionRepair(root, {
      duplicateId: group.duplicateId,
      keep: group.occurrences[0]!,
      rename: group.occurrences[1]!,
      replacementId: "FR-ARCH-002",
      referenceEdits: [{ filePath: "docs/spec/00.index.md", line: rowLine, from: "FR-ARCH-001", to: "FR-ARCH-002" }],
      ignoreLock: true
    });
    expect(ignored).toMatchObject({ ok: true, diagnosticsSummary: { byCode: { "SRS-W067": 1 } }, value: { touchedFiles: ["docs/spec/00.index.md", "docs/spec/10.product-architecture.srs.md"] } });
    expect(await readFile(indexPath, "utf8")).toContain("| 2026-06-30 | v1.0.0 | ARCH | FR-ARCH-002 | Duplicate repair fixture. | docs/reports/repair.md |");
  });

  it("rejects explicit reference edits whose source text no longer matches", async () => {
    const rootPath = await copyFixtureWorkspace("duplicate-id");
    const indexPath = path.join(rootPath, "docs/spec/00.index.md");
    await writeFile(
      indexPath,
      `${await readFile(indexPath, "utf8")}\n\n## 7. Completed Work Log\n\n| Date | Target | Scope | Requirement IDs | Summary | Report Paths |\n|---|---|---|---|---|---|\n| 2026-06-30 | v1.0.0 | ARCH | FR-ARCH-001 | Duplicate repair fixture. | docs/reports/repair.md |\n`,
      "utf8"
    );
    const group = await duplicateGroup(rootPath, "FR-ARCH-001");
    const rowLine = (await readFile(indexPath, "utf8")).split("\n").findIndex((line) => line.includes("Duplicate repair fixture")) + 1;

    await expect(
      planRequirementIdCollisionRepair(await resolveProjectRoot(rootPath), {
        duplicateId: group.duplicateId,
        keep: group.occurrences[0]!,
        rename: group.occurrences[1]!,
        replacementId: "FR-ARCH-002",
        referenceEdits: [{ filePath: "docs/spec/00.index.md", line: rowLine, from: "FR-ARCH-999", to: "FR-ARCH-002" }]
      })
    ).resolves.toMatchObject({ ok: false, error: { code: "STALE_PATCH" } });
  });
});
