import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import type * as FsPromises from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PlansRestoreError, runFileTransaction } from "../../../src/core/patch/file-transaction.js";

// FR-NODE-279 — the file-level transaction under applyPatchPlans: it records each touched file's
// original bytes or its absence before the first write, and on a failure puts every file back.

/** `failRenameTo`: the rename onto this path fails. `failRestoreOf`: a direct writeFile onto this path fails. */
const fault = vi.hoisted(() => ({ failRenameTo: "", failRestoreOf: "" }));
vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof FsPromises>();
  return {
    ...actual,
    rename: async (from: Parameters<typeof actual.rename>[0], to: Parameters<typeof actual.rename>[1]) => {
      if (fault.failRenameTo !== "" && String(to) === fault.failRenameTo) throw Object.assign(new Error("injected write failure"), { code: "EIO", syscall: "rename" });
      return actual.rename(from, to);
    },
    writeFile: async (...args: Parameters<typeof actual.writeFile>) => {
      if (fault.failRestoreOf !== "" && String(args[0]) === fault.failRestoreOf) throw Object.assign(new Error("injected restore failure"), { code: "EIO" });
      return actual.writeFile(...args);
    }
  };
});

const dirs: string[] = [];
afterEach(async () => {
  fault.failRenameTo = "";
  fault.failRestoreOf = "";
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

async function workspace(): Promise<{ changed: string; removed: string; created: string; last: string }> {
  const dir = await mkdtemp(path.join(tmpdir(), "speckiwi-file-tx-"));
  dirs.push(dir);
  const changed = path.join(dir, "changed.md");
  const removed = path.join(dir, "removed.md");
  const last = path.join(dir, "last.md");
  await writeFile(changed, Buffer.from("one\r\ntwo\r\n", "utf8"));
  await writeFile(removed, "keep me\n", "utf8");
  await writeFile(last, "last\n", "utf8");
  return { changed, removed, created: path.join(dir, "created.md"), last };
}

describe("FR-NODE-279 file-level transaction", () => {
  // @req FR-NODE-279 AC-1
  it("removes a file it created, restores a file it changed or removed, and rethrows the failure", async () => {
    const files = await workspace();
    fault.failRenameTo = files.last;
    const outcome = runFileTransaction(async (transaction) => {
      await transaction.write(files.created, "new document\n");
      await transaction.write(files.changed, "rewritten\n");
      await transaction.remove(files.removed);
      await transaction.write(files.last, "never lands\n");
    });
    await expect(outcome).rejects.toThrow(/injected write failure/);
    expect(existsSync(files.created)).toBe(false);
    expect((await readFile(files.changed)).equals(Buffer.from("one\r\ntwo\r\n", "utf8"))).toBe(true);
    expect(await readFile(files.removed, "utf8")).toBe("keep me\n");
    expect(await readFile(files.last, "utf8")).toBe("last\n");
  });

  // @req FR-NODE-279 AC-2
  it("writes, creates and removes files and returns the work's value when nothing fails", async () => {
    const files = await workspace();
    const value = await runFileTransaction(async (transaction) => {
      await transaction.write(files.created, "new document\n");
      await transaction.write(files.changed, "rewritten\n");
      await transaction.remove(files.removed);
      return "done";
    });
    expect(value).toBe("done");
    expect(await readFile(files.created, "utf8")).toBe("new document\n");
    expect(await readFile(files.changed, "utf8")).toBe("rewritten\n");
    expect(existsSync(files.removed)).toBe(false);
  });

  // @req FR-NODE-279 AC-1
  it("throws PlansRestoreError naming the files it could not restore, with the failure as the cause", async () => {
    const files = await workspace();
    fault.failRenameTo = files.last;
    fault.failRestoreOf = files.changed;
    const error = await runFileTransaction(async (transaction) => {
      await transaction.write(files.created, "new document\n");
      await transaction.write(files.changed, "rewritten\n");
      await transaction.write(files.last, "never lands\n");
    }).then(
      () => undefined,
      (caught: unknown) => caught
    );
    expect(error).toBeInstanceOf(PlansRestoreError);
    expect((error as PlansRestoreError).unrestored).toEqual([files.changed]);
    expect(((error as PlansRestoreError).cause as Error).message).toBe("injected write failure");
    expect(existsSync(files.created)).toBe(false);
  });

  // @req FR-NODE-279 AC-1 — a write that failed never replaced its file, so it has nothing to restore:
  // a read-only target must surface its own failure, not a restore failure on the same file.
  it("does not try to restore the file whose own write failed", async () => {
    const files = await workspace();
    fault.failRenameTo = files.last;
    fault.failRestoreOf = files.last;
    const outcome = runFileTransaction(async (transaction) => {
      await transaction.write(files.changed, "rewritten\n");
      await transaction.write(files.last, "never lands\n");
    });
    await expect(outcome).rejects.toThrow(/injected write failure/);
    expect((await readFile(files.changed)).equals(Buffer.from("one\r\ntwo\r\n", "utf8"))).toBe(true);
  });
});
