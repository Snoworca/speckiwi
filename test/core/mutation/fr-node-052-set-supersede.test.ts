import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
// @req FR-NODE-052 — setSupersede core: pairs Supersedes/Superseded By metadata with an optional
// matching supersedes/superseded_by Trace Link row, in the same call. The addition site is
// src/core/mutation/add-trace.ts (per the FR-NODE-052 Trace Links table). Importing the not-yet-
// implemented export is itself part of the red signal.
import { setSupersede } from "../../../src/core/mutation/add-trace.js";
import { resolveProjectRoot } from "../../../src/core/project-root.js";
import { copyFixtureWorkspace } from "../../fixtures/fixture-utils.js";

const ARCH_REL = "docs/spec/10.product-architecture.srs.md";
const archPath = (root: string) => path.join(root, "docs", "spec", "10.product-architecture.srs.md");
const posixOf = (p: string) => p.replace(/\\/g, "/");

// The mutation-target fixture ships a single requirement FR-ARCH-001 with a standard
// "| Field | Value |" metadata table that has neither a Supersedes nor a Superseded By row, and an
// empty Trace Links table. setSupersede must add the metadata row (and optionally the trace row)
// without disturbing any other metadata line.
const TARGET_ID = "FR-ARCH-001";

/** Extract the lines of FR-ARCH-001's "| Field | Value |" metadata table from the spec file. */
function metadataRows(text: string): string[] {
  const lines = text.split(/\r?\n/);
  // Anchor on FR-ARCH-001's heading so the requirement's metadata table is read rather than the
  // scope-level "| Field | Value |" table that appears first in the document.
  const headingIndex = lines.findIndex((line) => line.startsWith("### FR-ARCH-001"));
  const searchFrom = headingIndex === -1 ? 0 : headingIndex;
  const offset = lines.slice(searchFrom).findIndex((line) => line.startsWith("| Field | Value |"));
  const start = offset === -1 ? -1 : searchFrom + offset;
  if (start === -1) return [];
  const rows: string[] = [];
  // Skip the header line and the "| --- | --- |" separator; collect metadata rows until the table ends.
  for (let i = start + 2; i < lines.length; i += 1) {
    const line = lines[i] ?? "";
    if (!line.startsWith("|")) break;
    rows.push(line);
  }
  return rows;
}

describe("FR-NODE-052 setSupersede core pairs supersede metadata with trace", () => {
  it("FR-NODE-052 AC-1: a supersedes value writes only the Supersedes metadata field and changes no other metadata line", async () => {
    const root = await copyFixtureWorkspace("mutation-target");
    const before = metadataRows(await readFile(archPath(root), "utf8"));

    const result = await setSupersede(await resolveProjectRoot(root), {
      id: TARGET_ID,
      supersedes: "FR-ARCH-099"
    });

    expect(result.ok).toBe(true);
    expect(result.value).toMatchObject({ id: TARGET_ID, written: true });

    const after = metadataRows(await readFile(archPath(root), "utf8"));
    // Exactly one Supersedes row is present with the given value.
    const supersedesRows = after.filter((line) => /^\|\s*Supersedes\s*\|/.test(line));
    expect(supersedesRows).toEqual(["| Supersedes | FR-ARCH-099 |"]);
    // No Superseded By row was written for a supersedes-only call.
    expect(after.some((line) => /^\|\s*Superseded By\s*\|/.test(line))).toBe(false);
    // Every pre-existing metadata line is preserved unchanged (only the new row was added).
    for (const row of before) {
      expect(after).toContain(row);
    }
    expect(after.length).toBe(before.length + 1);
  });

  it("FR-NODE-052 AC-2: a superseded-by value writes only the Superseded By metadata field", async () => {
    const root = await copyFixtureWorkspace("mutation-target");
    const before = metadataRows(await readFile(archPath(root), "utf8"));

    const result = await setSupersede(await resolveProjectRoot(root), {
      id: TARGET_ID,
      supersededBy: "FR-ARCH-099"
    });

    expect(result.ok).toBe(true);
    expect(result.value).toMatchObject({ id: TARGET_ID, written: true });

    const after = metadataRows(await readFile(archPath(root), "utf8"));
    const supersededByRows = after.filter((line) => /^\|\s*Superseded By\s*\|/.test(line));
    expect(supersededByRows).toEqual(["| Superseded By | FR-ARCH-099 |"]);
    // A superseded-by-only call writes no Supersedes row.
    expect(after.some((line) => /^\|\s*Supersedes\s*\|/.test(line))).toBe(false);
    for (const row of before) {
      expect(after).toContain(row);
    }
    expect(after.length).toBe(before.length + 1);
  });

  it("FR-NODE-052 AC-3: with trace sync enabled, the matching supersedes (or superseded_by) Trace Link row is also inserted", async () => {
    const root = await copyFixtureWorkspace("mutation-target");

    const supersedesResult = await setSupersede(await resolveProjectRoot(root), {
      id: TARGET_ID,
      supersedes: "FR-ARCH-099",
      syncTrace: true
    });
    expect(supersedesResult.ok).toBe(true);

    let text = await readFile(archPath(root), "utf8");
    // Metadata row plus the matching `supersedes` Trace Link row (Type=Requirement, Relation=supersedes).
    expect(text).toContain("| Supersedes | FR-ARCH-099 |");
    expect(text).toMatch(/\|\s*Requirement\s*\|\s*FR-ARCH-099\s*\|\s*supersedes\s*\|/);

    // A superseded-by sync inserts the `superseded_by` relation instead.
    const supersededByResult = await setSupersede(await resolveProjectRoot(root), {
      id: TARGET_ID,
      supersededBy: "FR-ARCH-100",
      syncTrace: true
    });
    expect(supersededByResult.ok).toBe(true);

    text = await readFile(archPath(root), "utf8");
    expect(text).toContain("| Superseded By | FR-ARCH-100 |");
    expect(text).toMatch(/\|\s*Requirement\s*\|\s*FR-ARCH-100\s*\|\s*superseded_by\s*\|/);
  });

  it("FR-NODE-052 AC-4: an unknown requirement id returns ok false and writes no file", async () => {
    const root = await copyFixtureWorkspace("mutation-target");
    const before = await readFile(archPath(root), "utf8");

    const result = await setSupersede(await resolveProjectRoot(root), {
      id: "FR-ARCH-404",
      supersedes: "FR-ARCH-099"
    });

    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("NOT_FOUND");
    // No file was modified.
    await expect(readFile(archPath(root), "utf8")).resolves.toBe(before);
  });

  it("FR-NODE-052 AC-5: a dry-run call returns a patch preview and leaves the file unchanged on disk", async () => {
    const root = await copyFixtureWorkspace("mutation-target");
    const before = await readFile(archPath(root), "utf8");

    const result = await setSupersede(await resolveProjectRoot(root), {
      id: TARGET_ID,
      supersedes: "FR-ARCH-099",
      dryRun: true
    });

    expect(result.ok).toBe(true);
    expect(result.value).toMatchObject({ id: TARGET_ID, written: false });
    // A patch preview is surfaced for the dry run, targeting the spec file.
    expect(result.patch).toBeDefined();
    expect(result.patch?.dryRun).toBe(true);
    expect(Array.isArray(result.patch?.preview)).toBe(true);
    expect(result.patch!.preview.length).toBeGreaterThan(0);
    expect(posixOf(result.patch!.filePath).endsWith(ARCH_REL)).toBe(true);
    // The on-disk file is byte-for-byte unchanged.
    await expect(readFile(archPath(root), "utf8")).resolves.toBe(before);
  });
});
