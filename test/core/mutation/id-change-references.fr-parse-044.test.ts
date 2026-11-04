import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { applyRequirementIdCollisionRepair, diagnoseRequirementIdCollisions } from "../../../src/core/mutation/repair-requirement-id.js";
import { updateField } from "../../../src/core/mutation/update-field.js";
import { parseWorkspace } from "../../../src/core/parser/workspace-parser.js";
import { resolveProjectRoot } from "../../../src/core/project-root.js";
import { validateWorkspace } from "../../../src/core/validator/validate-workspace.js";
import { copyFixtureWorkspace } from "../../fixtures/fixture-utils.js";
import { acFixture, SCOPE_FILE } from "../ac-expiry-fixture.js";

// @req FR-PARSE-044 AC-4 — an expired marker's successor is a requirement reference like a Trace Link
// row. Every mutation that changes a requirement id must carry both kinds of inbound reference to the
// new id, or validation reports a dangling SRS-E012 that only a forbidden hand edit could clear.

const MARKER = "- [x] AC-2: ~~old~~ [EXPIRED 2026-11-03 → FR-ARCH-002]";

/** FR-ARCH-001 names FR-ARCH-002 twice: a Trace Link row and an expired marker. */
async function referencingFixture(): Promise<string> {
  const rootPath = await acFixture({ acLines: ["- [x] AC-1: live", MARKER] });
  const file = path.join(rootPath, SCOPE_FILE);
  const text = await readFile(file, "utf8");
  await writeFile(
    file,
    text.replace(
      "| Type | Reference | Relation | Notes |\n| --- | --- | --- | --- |",
      "| Type | Reference | Relation | Notes |\n| --- | --- | --- | --- |\n| Requirement | FR-ARCH-002 | related_to | probe |"
    ),
    "utf8"
  );
  return rootPath;
}

async function danglingReferences(rootPath: string): Promise<string[]> {
  const workspace = await parseWorkspace(await resolveProjectRoot(rootPath));
  return validateWorkspace(workspace).errors.filter((item) => item.code === "SRS-E012").map((item) => item.message);
}

/** The id-changing mutations whose inbound rewrites are automatic. */
const AUTOMATIC: Readonly<Record<string, { field: "scope" | "type"; value: string }>> = {
  "update_field scope migration": { field: "scope", value: "NODE" },
  "update_field type migration": { field: "type", value: "interface" }
};

describe("FR-PARSE-044 AC-4 — an id change carries Trace Links and expired-marker successors", () => {
  for (const [name, change] of Object.entries(AUTOMATIC)) {
    // @req FR-PARSE-044 AC-4
    it(`${name} rewrites both inbound references to the new id`, async () => {
      const rootPath = await referencingFixture();
      expect(await danglingReferences(rootPath)).toEqual([]);
      const moved = await updateField(await resolveProjectRoot(rootPath), { id: "FR-ARCH-002", ...change, dryRun: false, signOff: true });
      expect(moved.ok, JSON.stringify(moved.error)).toBe(true);
      const newId = moved.value!.newId!;
      const record = (await parseWorkspace(await resolveProjectRoot(rootPath))).records.find((item) => item.id === "FR-ARCH-001")!;
      expect(record.traceLinks.map((link) => link.reference)).toEqual([newId]);
      expect(record.expiredAcceptanceCriteria?.map((criterion) => criterion.successor)).toEqual([newId]);
      expect(await danglingReferences(rootPath)).toEqual([]);
    });
  }

  // @req FR-PARSE-044 AC-4 — collision repair cannot know which occurrence an outside reference meant,
  // so it must stop on an expired marker naming the duplicate id, and apply the explicit mapping.
  it("requirement-id collision repair refuses an unmapped expired-marker reference and applies a mapped one", async () => {
    const rootPath = await copyFixtureWorkspace("duplicate-id");
    const file = path.join(rootPath, "docs", "spec", "10.product-architecture.srs.md");
    const text = await readFile(file, "utf8");
    await writeFile(
      file,
      `${text.trimEnd()}\n\n### FR-ARCH-007 — Holder\n\n| Field | Value |\n| --- | --- |\n| Type | functional |\n| Target | v1.0.0 |\n| Status | planned |\n\n#### Requirement\nHolder.\n#### Acceptance Criteria\n- [ ] AC-1: live\n- [ ] AC-2: ~~old~~ [EXPIRED 2026-11-03 → FR-ARCH-001]\n#### Verification Evidence\n| Evidence ID | Type | Reference | Covers | Notes |\n| --- | --- | --- | --- | --- |\n#### Trace Links\n| Type | Reference | Relation | Notes |\n| --- | --- | --- | --- |\n`,
      "utf8"
    );
    const root = await resolveProjectRoot(rootPath);
    const group = (await diagnoseRequirementIdCollisions(root)).value.groups[0]!;
    const before = await readFile(file, "utf8");
    const refused = await applyRequirementIdCollisionRepair(root, { duplicateId: group.duplicateId, keep: group.occurrences[0]!, rename: group.occurrences[1]!, replacementId: "FR-ARCH-002" });
    expect(refused).toMatchObject({ ok: false, error: { code: "AMBIGUOUS_REFERENCE" } });
    expect(await readFile(file, "utf8")).toBe(before);

    const markerLine = before.split("\n").findIndex((line) => line.includes("[EXPIRED 2026-11-03 → FR-ARCH-001]")) + 1;
    const applied = await applyRequirementIdCollisionRepair(root, {
      duplicateId: group.duplicateId,
      keep: group.occurrences[0]!,
      rename: group.occurrences[1]!,
      replacementId: "FR-ARCH-002",
      referenceEdits: [{ filePath: "docs/spec/10.product-architecture.srs.md", line: markerLine, from: "→ FR-ARCH-001]", to: "→ FR-ARCH-002]" }]
    });
    expect(applied.ok, JSON.stringify(applied.error)).toBe(true);
    const holder = (await parseWorkspace(root)).records.find((item) => item.id === "FR-ARCH-007")!;
    expect(holder.expiredAcceptanceCriteria?.[0]?.successor).toBe("FR-ARCH-002");
    expect(await danglingReferences(rootPath)).toEqual([]);
  });

  // @req FR-PARSE-044 AC-4 — inside the renamed block the repair rewrites the block's own references
  // without asking; a Trace Link row and an expired-marker successor must move together.
  it("requirement-id collision repair moves the renamed block's Trace Link and expired successor together", async () => {
    const rootPath = await copyFixtureWorkspace("duplicate-id");
    const file = path.join(rootPath, "docs", "spec", "10.product-architecture.srs.md");
    const text = await readFile(file, "utf8");
    const duplicateAt = text.indexOf("### FR-ARCH-001 — Duplicate");
    const head = text.slice(0, duplicateAt);
    const tail = text
      .slice(duplicateAt)
      .replace("- [ ] AC-1: duplicate", "- [ ] AC-1: duplicate\n- [ ] AC-2: ~~old~~ [EXPIRED 2026-11-03 → FR-ARCH-001]")
      .replace("| Type | Reference | Relation | Notes |\n| --- | --- | --- | --- |", "| Type | Reference | Relation | Notes |\n| --- | --- | --- | --- |\n| Requirement | FR-ARCH-001 | related_to | probe |");
    await writeFile(file, head + tail, "utf8");
    const root = await resolveProjectRoot(rootPath);
    const group = (await diagnoseRequirementIdCollisions(root)).value.groups[0]!;
    const applied = await applyRequirementIdCollisionRepair(root, { duplicateId: group.duplicateId, keep: group.occurrences[0]!, rename: group.occurrences[1]!, replacementId: "FR-ARCH-002" });
    expect(applied.ok, JSON.stringify(applied.error)).toBe(true);
    const renamed = (await parseWorkspace(root)).records.find((item) => item.id === "FR-ARCH-002")!;
    expect(renamed.traceLinks.map((link) => link.reference)).toEqual(["FR-ARCH-002"]);
    expect(renamed.expiredAcceptanceCriteria?.map((criterion) => criterion.successor)).toEqual(["FR-ARCH-002"]);
  });

  // @req FR-PARSE-044 AC-4 — the denominator: every source file that writes a new id into a
  // requirement heading. A new id-changing mutation fails here until it joins the cases above.
  it("covers every mutation that writes a new id into a requirement heading", async () => {
    const changesId = /renderHeadingLine\(\{ id: newId|\.replace\(input\.duplicateId, replacementId\)/;
    const found: string[] = [];
    const walk = async (dir: string): Promise<void> => {
      for (const entry of await readdir(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) await walk(full);
        else if (entry.name.endsWith(".ts") && changesId.test(await readFile(full, "utf8"))) found.push(full.replaceAll("\\", "/"));
      }
    };
    await walk("src");
    expect(found.sort()).toEqual(["src/core/mutation/repair-requirement-id.ts", "src/core/mutation/update-field.ts"]);
  });
});
