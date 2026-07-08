import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { resolveProjectRoot } from "../../../src/core/project-root.js";
import { updateField } from "../../../src/core/mutation/update-field.js";
import { retarget } from "../../../src/core/mutation/retarget.js";
import { setSupersede } from "../../../src/core/mutation/add-trace.js";
import { copyFixtureWorkspace } from "../../fixtures/fixture-utils.js";

// Adversarial hardening suite for the v3.0.0 mutation cluster.
// - FND-001: update-field MUST guard verbatim values against pipe/newline injection.
// - FND-002: retarget MUST be atomic — a denied later item must not leave an earlier write.
// - FND-004: setSupersede MUST surface a compatibility-cache stale advisory warning.
// - FND-006: setSupersede MUST be idempotent — re-setting an existing field replaces, not duplicates.

const SPEC_FILE = path.join("docs", "spec", "10.product-architecture.srs.md");

async function specPath(rootPath: string): Promise<string> {
  return path.join(rootPath, SPEC_FILE);
}

async function readSpec(rootPath: string): Promise<string> {
  return readFile(await specPath(rootPath), "utf8");
}

/**
 * Appends a second requirement FR-ARCH-002 to the fixture. When `withChangeNotes` is
 * false the block omits its Change Notes section so a retarget with a reason hits the
 * `Change Notes section not found` MUTATION_DENIED branch — used by the FND-002 atomicity test.
 */
async function addSecondRequirement(rootPath: string, withChangeNotes: boolean): Promise<void> {
  const file = await specPath(rootPath);
  const text = await readFile(file, "utf8");
  const lines = [
    "",
    "### FR-ARCH-002 — Second requirement",
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
    "A second requirement.",
    "",
    "#### Rationale",
    "",
    "-",
    "",
    "#### Acceptance Criteria",
    "",
    "- [ ] AC-1: It exists.",
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
    "- -"
  ];
  if (withChangeNotes) {
    lines.push(
      "",
      "#### Change Notes",
      "",
      "| Date | Change | Reason |",
      "| --- | --- | --- |",
      "| 2026-05-08 | Created | Fixture |"
    );
  }
  await writeFile(file, `${text.trimEnd()}\n${lines.join("\n")}\n`, "utf8");
}

describe("FND-001 update-field rejects pipe/newline injection in values", () => {
  // A line-replacement field value containing a pipe would split the metadata row into
  // extra columns, corrupting the table — the guard must deny it with no write.
  it("FND-001: a pipe in a metadata field value yields MUTATION_DENIED and writes nothing", async () => {
    const rootPath = await copyFixtureWorkspace("mutation-target");
    const root = await resolveProjectRoot(rootPath);
    const before = await readSpec(rootPath);

    const result = await updateField(root, {
      id: "FR-ARCH-001",
      field: "priority",
      value: "low | Status | verified"
    });

    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("MUTATION_DENIED");
    expect(await readSpec(rootPath)).toBe(before);
  });

  // A newline in the title would inject extra lines/rows into the heading region.
  it("FND-001: a newline in the title value yields MUTATION_DENIED and writes nothing", async () => {
    const rootPath = await copyFixtureWorkspace("mutation-target");
    const root = await resolveProjectRoot(rootPath);
    const before = await readSpec(rootPath);

    const result = await updateField(root, {
      id: "FR-ARCH-001",
      field: "title",
      value: "Hijacked\n| Priority | verified |"
    });

    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("MUTATION_DENIED");
    expect(await readSpec(rootPath)).toBe(before);
  });

  // Regression: a clean value still writes through unchanged.
  it("FND-001: a clean value still updates the field", async () => {
    const rootPath = await copyFixtureWorkspace("mutation-target");
    const root = await resolveProjectRoot(rootPath);

    const result = await updateField(root, {
      id: "FR-ARCH-001",
      field: "priority",
      value: "low"
    });

    expect(result.ok).toBe(true);
    expect(await readSpec(rootPath)).toContain("| Priority | low |");
  });
});

describe("FND-002 retarget is atomic across per-item operations", () => {
  // With two ids where the second triggers a MUTATION_DENIED (its Change Notes section is
  // missing, required because the reason path is taken), the FIRST item's Target rewrite
  // must NOT be persisted: the whole call fails with no partial write.
  it("FND-002: a denied later item leaves no partial write from an earlier item", async () => {
    const rootPath = await copyFixtureWorkspace("mutation-target");
    // FR-ARCH-002 has no Change Notes section, so a retarget WITH a reason denies it.
    await addSecondRequirement(rootPath, false);
    const root = await resolveProjectRoot(rootPath);
    const before = await readSpec(rootPath);

    const result = await retarget(root, {
      ids: ["FR-ARCH-001", "FR-ARCH-002"],
      toTarget: "v1.1.0",
      reason: "Re-scope to v1.1.0",
      dryRun: false
    });

    expect(result.ok).toBe(false);
    // FR-ARCH-001 must not have been written to disk despite resolving first.
    const after = await readSpec(rootPath);
    expect(after).toBe(before);
    expect(after).toContain("| Target | v1.0.0 |");
    expect(after).not.toContain("| Target | v1.1.0 |");
  });

  // Regression: a normal multi-id retarget still applies every item's rewrite.
  it("FND-002: a fully valid multi-id retarget still writes every item", async () => {
    const rootPath = await copyFixtureWorkspace("mutation-target");
    await addSecondRequirement(rootPath, true);
    const root = await resolveProjectRoot(rootPath);

    const result = await retarget(root, {
      ids: ["FR-ARCH-001", "FR-ARCH-002"],
      toTarget: "v1.1.0",
      dryRun: false
    });

    expect(result.ok).toBe(true);
    const after = await readSpec(rootPath);
    expect(after).not.toContain("| Target | v1.0.0 |");
    expect((after.match(/\| Target \| v1\.1\.0 \|/g) ?? []).length).toBe(2);
  });
});

describe("FND-004 setSupersede emits a compatibility-cache stale advisory", () => {
  // FR-NODE-063 Implementation Notes MUST: set-supersede either invalidates the affected
  // endpoint compatibility cache or emits an advisory stale warning. We adopt the warning.
  it("FND-004: a successful setSupersede surfaces a compatibility-cache stale advisory warning", async () => {
    const root = await copyFixtureWorkspace("mutation-target");
    const result = await setSupersede(await resolveProjectRoot(root), {
      id: "FR-ARCH-001",
      supersedes: "FR-ARCH-099"
    });

    expect(result.ok).toBe(true);
    expect(Array.isArray(result.value?.warnings)).toBe(true);
    expect(result.value?.warnings?.some((w) => /compatibility/i.test(w) && /stale/i.test(w))).toBe(true);
  });
});

describe("FND-006 setSupersede replaces an existing field instead of duplicating it", () => {
  // Calling setSupersede twice for the same field (or on a block that already carries the
  // field) must leave exactly one Supersedes row — AC-1 forbids touching any other line.
  it("FND-006: re-setting Supersedes replaces the row rather than appending a duplicate", async () => {
    const root = await copyFixtureWorkspace("mutation-target");
    const projectRoot = await resolveProjectRoot(root);

    const first = await setSupersede(projectRoot, { id: "FR-ARCH-001", supersedes: "FR-ARCH-099" });
    expect(first.ok).toBe(true);

    const second = await setSupersede(await resolveProjectRoot(root), {
      id: "FR-ARCH-001",
      supersedes: "FR-ARCH-100"
    });
    expect(second.ok).toBe(true);

    const text = await readFile(path.join(root, SPEC_FILE), "utf8");
    const supersedesRows = text.split(/\r?\n/).filter((line) => /^\|\s*Supersedes\s*\|/.test(line));
    // Exactly one Supersedes row, carrying the latest value.
    expect(supersedesRows).toEqual(["| Supersedes | FR-ARCH-100 |"]);
  });
});
