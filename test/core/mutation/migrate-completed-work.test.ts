import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { migrateCompletedWork } from "../../../src/core/mutation/migrate-completed-work.js";
import { parseWorkspace } from "../../../src/core/parser/workspace-parser.js";
import { resolveProjectRoot } from "../../../src/core/project-root.js";
import { copyFixtureWorkspace } from "../../fixtures/fixture-utils.js";

const posix = (p: string) => p.replace(/\\/g, "/");
const indexPath = (root: string) => path.join(root, "docs", "spec", "00.index.md");
const historyPath = (root: string) => path.join(root, "docs", "spec", "91.completed-work-log.md");
const exists = (p: string) => access(p).then(() => true).catch(() => false);

// MIG-NODE-001: an opt-in, dry-run-default migration moves inline Completed Work Log rows from
// 00.index.md section-7 into docs/spec/91.completed-work-log.md without altering any requirement,
// and is never invoked automatically.
describe("MIG-NODE-001 opt-in Completed Work Log migration", () => {
  it("defaults to dry-run, reporting rows without writing (AC-1)", async () => {
    const root = await copyFixtureWorkspace("valid-basic");
    const indexBefore = await readFile(indexPath(root), "utf8");

    const result = await migrateCompletedWork(await resolveProjectRoot(root), {});

    expect(result.ok).toBe(true);
    expect(result.value).toMatchObject({ moved: 2, written: false });
    expect(result.patch?.dryRun).toBe(true);
    expect(result.patch?.preview?.some((line) => line.includes("Fixture parser coverage completed."))).toBe(true);
    expect(await exists(historyPath(root))).toBe(false);
    await expect(readFile(indexPath(root), "utf8")).resolves.toBe(indexBefore);
  });

  it("moves index rows into the history file and removes them from the index when applied (AC-2)", async () => {
    const root = await copyFixtureWorkspace("valid-basic");

    const result = await migrateCompletedWork(await resolveProjectRoot(root), { apply: true });
    expect(result.ok).toBe(true);
    expect(result.value).toMatchObject({ moved: 2, written: true });

    const history = await readFile(historyPath(root), "utf8");
    expect(history).toContain("## 7. Completed Work Log");
    expect(history.toLowerCase()).toContain("not a source of truth");
    expect(history).toContain("Fixture parser coverage completed.");
    expect(history).toContain("Cross-target fixture setup completed.");

    const index = await readFile(indexPath(root), "utf8");
    expect(index).toContain("## 7. Completed Work Log"); // heading retained
    expect(index).not.toContain("Fixture parser coverage completed."); // rows removed
    expect(index).not.toContain("Cross-target fixture setup completed.");

    // merged view still has both rows, now sourced from the history file
    const ws = await parseWorkspace(await resolveProjectRoot(root));
    expect(ws.index.completedWork).toHaveLength(2);
    expect(ws.index.completedWork.every((e) => posix(e.sourceFile ?? "").endsWith("91.completed-work-log.md"))).toBe(true);
  });

  it("does not modify requirement status or acceptance criteria (AC-3)", async () => {
    const root = await copyFixtureWorkspace("valid-basic");
    const before = (await parseWorkspace(await resolveProjectRoot(root))).records.find((r) => r.id === "FR-ARCH-001");

    await migrateCompletedWork(await resolveProjectRoot(root), { apply: true });

    const after = (await parseWorkspace(await resolveProjectRoot(root))).records.find((r) => r.id === "FR-ARCH-001");
    expect(after?.status).toBe(before?.status);
    expect(after?.acceptanceCriteria).toEqual(before?.acceptanceCriteria);
  });

  it("is never invoked automatically by parsing (AC-4)", async () => {
    const root = await copyFixtureWorkspace("valid-basic");
    const indexBefore = await readFile(indexPath(root), "utf8");

    await parseWorkspace(await resolveProjectRoot(root));

    expect(await exists(historyPath(root))).toBe(false);
    await expect(readFile(indexPath(root), "utf8")).resolves.toBe(indexBefore);
  });
});
