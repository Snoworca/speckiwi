import { existsSync } from "node:fs";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import type * as FsPromises from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { readUtf8File } from "../../../src/core/fs/read-text.js";
import { applyPatchPlans } from "../../../src/core/patch/apply-patch-plans.js";
import { createPatchPlan } from "../../../src/core/patch/patch-plan.js";

// FR-NODE-279 AC-2 — applyPatchPlans is the one multi-document write transaction, resting on the
// file-level transaction, so it can create a document alongside the documents it patches; the
// MultiFileCommit engine that nothing called is gone.

const fault = vi.hoisted(() => ({ failRenameTo: "" }));
vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof FsPromises>();
  return {
    ...actual,
    rename: async (from: Parameters<typeof actual.rename>[0], to: Parameters<typeof actual.rename>[1]) => {
      if (fault.failRenameTo !== "" && String(to) === fault.failRenameTo) throw Object.assign(new Error("injected write failure"), { code: "EIO", syscall: "rename" });
      return actual.rename(from, to);
    }
  };
});

const dirs: string[] = [];
afterEach(async () => {
  fault.failRenameTo = "";
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

async function indexAndNewDocument(): Promise<{ index: string; created: string }> {
  const dir = await mkdtemp(path.join(tmpdir(), "speckiwi-one-tx-"));
  dirs.push(dir);
  const index = path.join(dir, "00.index.md");
  await writeFile(index, "one\ntwo\n", "utf8");
  return { index, created: path.join(dir, "02.new.srs.md") };
}

async function sourceFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await sourceFiles(full)));
    else if (entry.name.endsWith(".ts")) out.push(full);
  }
  return out;
}

describe("FR-NODE-279 AC-2 — one multi-document write transaction", () => {
  // @req FR-NODE-279 AC-2
  it("creates a new document together with the patched documents", async () => {
    const { index, created } = await indexAndNewDocument();
    const plan = createPatchPlan(await readUtf8File(index), [{ type: "replaceLine", line: 1, original: "one", replacement: "ONE" }]);
    const result = await applyPatchPlans([plan], { dryRun: false, newDocuments: [{ path: created, text: "# New\n" }] });
    expect(result.written).toBe(true);
    expect(await readFile(created, "utf8")).toBe("# New\n");
    expect(await readFile(index, "utf8")).toBe("ONE\ntwo\n");
  });

  // @req FR-NODE-279 AC-2
  it("removes the document it created when a later write fails", async () => {
    const { index, created } = await indexAndNewDocument();
    const plan = createPatchPlan(await readUtf8File(index), [{ type: "replaceLine", line: 1, original: "one", replacement: "ONE" }]);
    fault.failRenameTo = index;
    await expect(applyPatchPlans([plan], { dryRun: false, newDocuments: [{ path: created, text: "# New\n" }] })).rejects.toThrow(/injected write failure/);
    expect(existsSync(created)).toBe(false);
    expect(await readFile(index, "utf8")).toBe("one\ntwo\n");
  });

  // @req FR-NODE-279 AC-2 — a document that appeared since the plan was made is refused before any write.
  it("refuses to create a document that already exists, writing nothing", async () => {
    const { index, created } = await indexAndNewDocument();
    await writeFile(created, "someone else's\n", "utf8");
    const plan = createPatchPlan(await readUtf8File(index), [{ type: "replaceLine", line: 1, original: "one", replacement: "ONE" }]);
    await expect(applyPatchPlans([plan], { dryRun: false, newDocuments: [{ path: created, text: "# New\n" }] })).rejects.toThrow(/Stale patch/);
    expect(await readFile(created, "utf8")).toBe("someone else's\n");
    expect(await readFile(index, "utf8")).toBe("one\ntwo\n");
  });

  // @req FR-NODE-279 AC-2
  it("writes nothing on a dryRun with a new document", async () => {
    const { index, created } = await indexAndNewDocument();
    const plan = createPatchPlan(await readUtf8File(index), [{ type: "replaceLine", line: 1, original: "one", replacement: "ONE" }]);
    expect(await applyPatchPlans([plan], { dryRun: true, newDocuments: [{ path: created, text: "# New\n" }] })).toEqual({ written: false });
    expect(existsSync(created)).toBe(false);
  });

  // @req FR-NODE-279 AC-2
  it("leaves no MultiFileCommit engine in the source tree", async () => {
    expect(existsSync(path.resolve("src", "core", "patch", "merge-journal.ts"))).toBe(false);
    const holders: string[] = [];
    for (const file of await sourceFiles(path.resolve("src"))) {
      if ((await readFile(file, "utf8")).includes("MultiFileCommit")) holders.push(file);
    }
    expect(holders).toEqual([]);
  });
});
