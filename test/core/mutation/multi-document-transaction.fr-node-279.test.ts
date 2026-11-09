import { readdir, readFile, writeFile } from "node:fs/promises";
import type * as FsPromises from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { migrateCompletedWork } from "../../../src/core/mutation/migrate-completed-work.js";
import { scaffoldScope } from "../../../src/core/mutation/scaffold-scope.js";
import { resolveProjectRoot } from "../../../src/core/project-root.js";
import { copyFixtureWorkspace } from "../../fixtures/fixture-utils.js";

// FR-NODE-279 AC-1 — scaffold-scope and migrate-completed-work write every document through one
// transaction: when the index write fails after the other document was created or changed, every
// document is left as it was before the call.

const fault = vi.hoisted(() => ({ failIndexRename: false, indexRenames: 0 }));
vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof FsPromises>();
  return {
    ...actual,
    rename: async (from: Parameters<typeof actual.rename>[0], to: Parameters<typeof actual.rename>[1]) => {
      if (fault.failIndexRename && path.basename(String(to)) === "00.index.md") {
        fault.indexRenames += 1;
        throw Object.assign(new Error(`EPERM: operation not permitted, rename '${String(from)}' -> '${String(to)}'`), { code: "EPERM", syscall: "rename" });
      }
      return actual.rename(from, to);
    }
  };
});
afterEach(() => {
  fault.failIndexRename = false;
  fault.indexRenames = 0;
});

async function snapshotSpec(rootPath: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  const dir = path.join(rootPath, "docs", "spec");
  for (const name of await readdir(dir)) {
    if (name.endsWith(".md")) out[name] = await readFile(path.join(dir, name), "utf8");
  }
  return out;
}

const HISTORY = path.join("docs", "spec", "91.completed-work-log.md");

describe("FR-NODE-279 AC-1 — scaffold-scope", () => {
  // @req FR-NODE-279 AC-1
  it("removes the scope document it created when the index write fails, and leaves the index as it was", async () => {
    const rootPath = await copyFixtureWorkspace("valid-basic");
    const before = await snapshotSpec(rootPath);
    fault.failIndexRename = true;
    await expect(scaffoldScope(await resolveProjectRoot(rootPath), { name: "Billing", prefix: "BILL", apply: true })).rejects.toThrow(/EPERM/);
    expect(fault.indexRenames).toBeGreaterThan(0);
    fault.failIndexRename = false;
    expect(await snapshotSpec(rootPath)).toEqual(before);
  });
});

describe("FR-NODE-279 AC-1 — migrate-completed-work", () => {
  // @req FR-NODE-279 AC-1
  it("removes the history file it created when the index write fails", async () => {
    const rootPath = await copyFixtureWorkspace("valid-basic");
    const before = await snapshotSpec(rootPath);
    fault.failIndexRename = true;
    await expect(migrateCompletedWork(await resolveProjectRoot(rootPath), { apply: true })).rejects.toThrow(/EPERM/);
    fault.failIndexRename = false;
    expect(await snapshotSpec(rootPath)).toEqual(before);
  });

  // @req FR-NODE-279 AC-1
  it("restores the history file it changed to its original bytes when the index write fails", async () => {
    const rootPath = await copyFixtureWorkspace("valid-basic");
    const history = "# Completed Work Log History\r\n\r\n## 7. Completed Work Log\r\n\r\n| Date | Target | Scope | Requirement IDs | Summary |\r\n|---|---|---|---|---|\r\n| 2026-01-01 | v0.9.0 | ARCH | - | Older row. |\r\n";
    await writeFile(path.join(rootPath, HISTORY), history, "utf8");
    const before = await snapshotSpec(rootPath);
    fault.failIndexRename = true;
    await expect(migrateCompletedWork(await resolveProjectRoot(rootPath), { apply: true })).rejects.toThrow(/EPERM/);
    fault.failIndexRename = false;
    expect(await snapshotSpec(rootPath)).toEqual(before);
    expect(await readFile(path.join(rootPath, HISTORY), "utf8")).toBe(history);
  });
});
