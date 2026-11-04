import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { BUNDLED_SRS_RULES_FILENAME } from "../../../src/core/bootstrap/templates.js";
import { renameTarget } from "../../../src/core/mutation/rename-target.js";
import { repairRulesReferences } from "../../../src/core/mutation/repair-rules-references.js";
import { retarget } from "../../../src/core/mutation/retarget.js";
import { updateField } from "../../../src/core/mutation/update-field.js";
import { resolveProjectRoot } from "../../../src/core/project-root.js";
import { copyFixtureWorkspace } from "../../fixtures/fixture-utils.js";
import { STALE_RULES_LINK } from "./metadata-value-cases.ir-cli-112.js";

// IR-CLI-112 AC-1/AC-3 — the commands that write several requirements in one call. When one
// requirement is refused part-way, the call fails and every file under docs/spec is byte for byte
// what it was: a caller is never left to guess which requirements were already written.

const SPEC = path.join("docs", "spec", "10.product-architecture.srs.md");

async function snapshotSpec(rootPath: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  const walk = async (dir: string): Promise<void> => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(full);
      else out[path.relative(rootPath, full)] = await readFile(full, "utf8");
    }
  };
  await walk(path.join(rootPath, "docs", "spec"));
  return out;
}

/**
 * The fixture plus FR-ARCH-002, a copy of FR-ARCH-001 placed after it. `second` edits only the copy,
 * so FR-ARCH-001 stays writable and is planned first, and the copy is the one that gets refused.
 */
async function twoRequirementFixture(first: (block: string) => string, second: (block: string) => string): Promise<string> {
  const rootPath = await copyFixtureWorkspace("mutation-target");
  const file = path.join(rootPath, SPEC);
  const text = (await readFile(file, "utf8")).replace(/\r\n/g, "\n");
  const start = text.indexOf("### FR-ARCH-001");
  const block = text.slice(start);
  const copy = block.replace("### FR-ARCH-001 — Mutable requirement", "### FR-ARCH-002 — Second requirement");
  await writeFile(file, `${text.slice(0, start)}${first(block).trimEnd()}\n\n${second(copy)}`, "utf8");
  await mkdir(path.join(rootPath, "docs", "rule"), { recursive: true });
  await writeFile(path.join(rootPath, "docs", "rule", BUNDLED_SRS_RULES_FILENAME), "# Rules\n", "utf8");
  return rootPath;
}

const withoutChangeNotes = (block: string): string => block.slice(0, block.indexOf("#### Change Notes"));

describe("IR-CLI-112 batch commands write all or nothing", () => {
  // @req IR-CLI-112 AC-3
  it("repair rules-references refused on the second requirement writes nothing", async () => {
    const stale = (block: string) => block.replace("| Related Docs | - |", `| Related Docs | ${STALE_RULES_LINK} |`);
    const rootPath = await twoRequirementFixture(stale, (block) => withoutChangeNotes(stale(block)));
    const before = await snapshotSpec(rootPath);
    const result = await repairRulesReferences(await resolveProjectRoot(rootPath), { apply: true });
    expect(result.ok).toBe(false);
    expect(await snapshotSpec(rootPath)).toEqual(before);
  });

  // @req IR-CLI-112 AC-3
  it("retarget refused on the second requirement writes nothing", async () => {
    const rootPath = await twoRequirementFixture((block) => block, withoutChangeNotes);
    const before = await snapshotSpec(rootPath);
    const result = await retarget(await resolveProjectRoot(rootPath), { ids: ["FR-ARCH-001", "FR-ARCH-002"], toTarget: "v1.1.0", dryRun: false });
    expect(result.ok).toBe(false);
    expect(await snapshotSpec(rootPath)).toEqual(before);
  });

  // @req IR-CLI-112 AC-1
  it("rename-target refused on the second requirement writes nothing, the index included", async () => {
    // The copy's metadata table gains a Note column, and its Target row an escaped pipe after the
    // value: the parser still reads v1.0.0, but the row cannot be re-rendered without losing text.
    const noteColumn = (block: string) => {
      const end = block.indexOf("#### Requirement");
      const table = block
        .slice(0, end)
        .replace("| Field | Value |\n| --- | --- |", "| Field | Value | Note |\n| --- | --- | --- |")
        .replace("| Target | v1.0.0 |", String.raw`| Target | v1.0.0 | a \| b |`);
      return table + block.slice(end);
    };
    const rootPath = await twoRequirementFixture((block) => block, noteColumn);
    const before = await snapshotSpec(rootPath);
    const result = await renameTarget(await resolveProjectRoot(rootPath), { from: "v1.0.0", to: "v9.0.0", dryRun: false });
    expect(result.ok).toBe(false);
    expect(await snapshotSpec(rootPath)).toEqual(before);
  });

  // @req IR-CLI-112 AC-3 — a type migration rewrites the heading, the Type row and inbound references
  // together; a Type row the writer refuses must fail the migration, not leave a new id over an old type.
  it("a type migration whose Type row is refused writes nothing", async () => {
    const noteColumn = (block: string) => {
      const end = block.indexOf("#### Requirement");
      const table = block
        .slice(0, end)
        .replace("| Field | Value |\n| --- | --- |", "| Field | Value | Note |\n| --- | --- | --- |")
        .replace("| Type | functional |", String.raw`| Type | functional | a \| b |`);
      return table + block.slice(end);
    };
    const rootPath = await twoRequirementFixture(noteColumn, (block) => block);
    const before = await snapshotSpec(rootPath);
    const result = await updateField(await resolveProjectRoot(rootPath), { id: "FR-ARCH-001", field: "type", value: "non_functional", signOff: true, dryRun: false });
    expect(result.ok).toBe(false);
    expect(await snapshotSpec(rootPath)).toEqual(before);
  });
});
