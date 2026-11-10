import { mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import type * as FsPromises from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renameScope } from "../../../src/core/mutation/rename-scope.js";
import { PlansRestoreError, runFileTransaction } from "../../../src/core/patch/file-transaction.js";
import { resolveProjectRoot } from "../../../src/core/project-root.js";
import { copyFixtureWorkspace } from "../../fixtures/fixture-utils.js";

// @req FR-NODE-283 — rename-scope moves its scope document inside the file-level transaction.
//
// On 5.3.8 the document was renamed before the transaction and renamed back by hand: when the index
// write failed and the move-back failed too, the caller got the bare move-back error and no report
// naming the document. Making the move a create plus a remove inside the transaction would be worse:
// the restore removes the "created" new name first, so a failed restore of the old name loses the
// document. The transaction therefore moves.

/** Each listed target basename makes `rename` fail with EPERM (retryBusy gives up on it). */
const fault = vi.hoisted(() => ({ failRenameTo: new Set<string>() }));
vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof FsPromises>();
  return {
    ...actual,
    rename: async (from: Parameters<typeof actual.rename>[0], to: Parameters<typeof actual.rename>[1]) => {
      const name = path.basename(String(to));
      if (fault.failRenameTo.has(name)) throw Object.assign(new Error(`EPERM: rename to ${name}`), { code: "EPERM", syscall: "rename" });
      return actual.rename(from, to);
    }
  };
});

afterEach(() => {
  fault.failRenameTo.clear();
});

const OLD = "10.product-architecture.srs.md";
const NEW = "10.product-arch.srs.md";

async function snapshot(specDir: string): Promise<Record<string, string>> {
  const files = (await readdir(specDir)).filter((name) => name.endsWith(".md")).sort();
  return Object.fromEntries(await Promise.all(files.map(async (name) => [name, await readFile(path.join(specDir, name), "utf8")] as const)));
}

async function renameWithFaults(...failing: string[]): Promise<{ error: Error | undefined; before: Record<string, string>; after: Record<string, string> }> {
  const rootPath = await copyFixtureWorkspace("valid-basic");
  const specDir = path.join(rootPath, "docs", "spec");
  const before = await snapshot(specDir);
  for (const name of failing) fault.failRenameTo.add(name);
  const error = await renameScope(await resolveProjectRoot(rootPath), { from: "10.product-architecture", to: "10.product-arch", apply: true }).then(
    () => undefined,
    (caught: unknown) => caught as Error
  );
  fault.failRenameTo.clear();
  return { error, before, after: await snapshot(specDir) };
}

describe("FR-NODE-283 AC-1 — a failed move-back is reported naming the document, and the document is kept", () => {
  it("reports PlansRestoreError naming the old path and where the document was left", async () => {
    const { error, before, after } = await renameWithFaults("00.index.md", OLD);
    expect(error).toBeInstanceOf(PlansRestoreError);
    expect((error as PlansRestoreError).unrestored).toEqual([expect.stringMatching(/10\.product-architecture\.srs\.md$/)]);
    expect(error?.message).toContain(NEW);
    expect(Object.keys(after)).toContain(NEW);
    expect(Object.keys(after)).not.toContain(OLD);
    expect(after[NEW]).toBe(before[OLD]);
    expect(after["00.index.md"]).toBe(before["00.index.md"]);
  });
});

describe("FR-NODE-283 AC-2 — a failure after the move whose move-back succeeds leaves every file as it was", () => {
  it("restores the document's old name and rethrows the index failure", async () => {
    const { error, before, after } = await renameWithFaults("00.index.md");
    expect(error?.message).toContain("EPERM: rename to 00.index.md");
    expect(error).not.toBeInstanceOf(PlansRestoreError);
    expect(after).toEqual(before);
  });
});

describe("FR-NODE-283 AC-3 — the transaction moves, and undoes a move after the writes that followed it", () => {
  async function scratch(): Promise<string> {
    return mkdtemp(path.join(tmpdir(), "speckiwi-fr-node-283-"));
  }

  it("puts the moved file's bytes back, then moves it back, when a later step fails", async () => {
    const dir = await scratch();
    const from = path.join(dir, "a.md");
    const to = path.join(dir, "b.md");
    const other = path.join(dir, "c.md");
    await writeFile(from, "original a\n", "utf8");
    await writeFile(other, "original c\n", "utf8");
    const failure = new Error("later step failed");
    const caught = await runFileTransaction(async (transaction) => {
      await transaction.move(from, to);
      await transaction.write(to, "patched at new name\n");
      await transaction.write(other, "patched c\n");
      throw failure;
    }).catch((error: unknown) => error);
    expect(caught).toBe(failure);
    expect((await readdir(dir)).sort()).toEqual(["a.md", "c.md"]);
    expect(await readFile(from, "utf8")).toBe("original a\n");
    expect(await readFile(other, "utf8")).toBe("original c\n");
  });

  it("keeps the file at its new name, restored to its moved bytes, when the move-back fails", async () => {
    const dir = await scratch();
    const from = path.join(dir, "a.md");
    const to = path.join(dir, "b.md");
    await writeFile(from, "original a\n", "utf8");
    const caught = await runFileTransaction(async (transaction) => {
      await transaction.move(from, to);
      await transaction.write(to, "patched\n");
      fault.failRenameTo.add("a.md");
      throw new Error("later step failed");
    }).catch((error: unknown) => error);
    expect(caught).toBeInstanceOf(PlansRestoreError);
    expect((caught as PlansRestoreError).unrestored).toEqual([from]);
    expect((caught as Error).message).toContain(to);
    expect((await readdir(dir)).sort()).toEqual(["b.md"]);
    expect(await readFile(to, "utf8")).toBe("original a\n");
  });
});
