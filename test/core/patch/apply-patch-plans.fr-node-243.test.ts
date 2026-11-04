import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { readUtf8File } from "../../../src/core/fs/read-text.js";
import { applyPatchPlans } from "../../../src/core/patch/apply-patch-plans.js";
import { createPatchPlan } from "../../../src/core/patch/patch-plan.js";

// @req FR-NODE-243 AC-7 — several documents change together or not at all.

/**
 * `failTarget`: the rename onto this path fails (the forward write). `restoreTarget`: a direct
 * writeFile onto this path (the restore) fails with EPERM `restoreBusyTimes` times.
 */
const fault = vi.hoisted(() => ({ failTarget: "", restoreTarget: "", restoreBusyTimes: 0 }));
vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    rename: async (from: Parameters<typeof actual.rename>[0], to: Parameters<typeof actual.rename>[1]) => {
      if (fault.failTarget !== "" && String(to) === fault.failTarget) throw Object.assign(new Error("injected write failure"), { code: "EIO" });
      return actual.rename(from, to);
    },
    writeFile: async (...args: Parameters<typeof actual.writeFile>) => {
      if (fault.restoreTarget !== "" && String(args[0]) === fault.restoreTarget && fault.restoreBusyTimes > 0) {
        fault.restoreBusyTimes -= 1;
        throw Object.assign(new Error("injected busy restore"), { code: "EPERM" });
      }
      return actual.writeFile(...args);
    }
  };
});

const dirs: string[] = [];
afterEach(async () => {
  fault.failTarget = "";
  fault.restoreTarget = "";
  fault.restoreBusyTimes = 0;
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

async function twoFiles(): Promise<{ a: string; b: string }> {
  const dir = await mkdtemp(path.join(tmpdir(), "speckiwi-plans-"));
  dirs.push(dir);
  const a = path.join(dir, "a.md");
  const b = path.join(dir, "b.md");
  await writeFile(a, "one\ntwo\n", "utf8");
  await writeFile(b, "three\nfour\n", "utf8");
  return { a, b };
}

async function plansFor(a: string, b: string) {
  const fileA = await readUtf8File(a);
  const fileB = await readUtf8File(b);
  return [
    createPatchPlan(fileA, [{ type: "replaceLine", line: 1, original: "one", replacement: "ONE" }]),
    createPatchPlan(fileB, [{ type: "replaceLine", line: 1, original: "three", replacement: "THREE" }])
  ];
}

describe("applyPatchPlans — all or nothing", () => {
  // @req FR-NODE-243 AC-7
  it("restores every earlier document byte-for-byte, CRLF and BOM included, when the n-th write fails", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "speckiwi-plans-"));
    dirs.push(dir);
    const originals: Record<string, Buffer> = {
      "crlf.md": Buffer.from("one\r\ntwo\r\n", "utf8"),
      "bom.md": Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from("one\r\ntwo\r\n", "utf8")]),
      "last.md": Buffer.from("one\ntwo\n", "utf8")
    };
    const paths = Object.keys(originals).map((name) => path.join(dir, name));
    for (const [name, bytes] of Object.entries(originals)) await writeFile(path.join(dir, name), bytes);
    const plans = await Promise.all(
      paths.map(async (filePath) => createPatchPlan(await readUtf8File(filePath), [{ type: "replaceLine", line: 2, original: "two", replacement: "TWO" }]))
    );
    fault.failTarget = paths[2]!;
    await expect(applyPatchPlans(plans, { dryRun: false })).rejects.toThrow(/injected write failure/);
    for (const [name, bytes] of Object.entries(originals)) expect((await readFile(path.join(dir, name))).equals(bytes), name).toBe(true);
  });

  // @req FR-NODE-243 AC-7 — a Windows scanner briefly holding the document must not defeat the restore.
  it("retries a restore that meets EPERM and still restores the document", async () => {
    const { a, b } = await twoFiles();
    const plans = await plansFor(a, b);
    fault.failTarget = b;
    fault.restoreTarget = a;
    fault.restoreBusyTimes = 2;
    await expect(applyPatchPlans(plans, { dryRun: false })).rejects.toThrow(/injected write failure/);
    expect(await readFile(a, "utf8")).toBe("one\ntwo\n");
  });

  // @req FR-NODE-243 AC-7 — a restore that keeps failing is reported, never a silent half-restore.
  it("names the documents it could not restore, with the original failure as the cause", async () => {
    const { a, b } = await twoFiles();
    const plans = await plansFor(a, b);
    fault.failTarget = b;
    fault.restoreTarget = a;
    fault.restoreBusyTimes = 99;
    const error = await applyPatchPlans(plans, { dryRun: false }).then(
      () => undefined,
      (caught: unknown) => caught as Error & { unrestored?: string[]; cause?: Error }
    );
    expect(error?.unrestored).toEqual([a]);
    expect(error?.message).toContain(a);
    expect(error?.cause?.message).toBe("injected write failure");
  });

  // @req FR-NODE-243 AC-7 — callers trust a dryRun as the preview of the write.
  it("fails a dryRun the way the write would fail when a plan cannot be rendered", async () => {
    const { a, b } = await twoFiles();
    const broken = createPatchPlan(await readUtf8File(a), [{ type: "replaceLine", line: 1, original: "not the line", replacement: "X" }]);
    const fine = createPatchPlan(await readUtf8File(b), [{ type: "replaceLine", line: 1, original: "three", replacement: "THREE" }]);
    await expect(applyPatchPlans([fine, broken], { dryRun: true })).rejects.toThrow(/Stale patch/);
    await expect(applyPatchPlans([fine, broken], { dryRun: false })).rejects.toThrow(/Stale patch/);
    expect([await readFile(a, "utf8"), await readFile(b, "utf8")]).toEqual(["one\ntwo\n", "three\nfour\n"]);
  });

  // @req FR-NODE-243 AC-7
  it("does nothing for an empty plan list", async () => {
    expect(await applyPatchPlans([], { dryRun: false })).toEqual({ written: false });
  });

  // @req FR-NODE-243 AC-7
  it("refuses two plans for the same document before writing anything", async () => {
    const { a, b } = await twoFiles();
    const [planA, planB] = await plansFor(a, b);
    const second = createPatchPlan(await readUtf8File(a), [{ type: "replaceLine", line: 2, original: "two", replacement: "TWO" }]);
    await expect(applyPatchPlans([planB!, planA!, second], { dryRun: false })).rejects.toThrow(/same document/);
    expect([await readFile(a, "utf8"), await readFile(b, "utf8")]).toEqual(["one\ntwo\n", "three\nfour\n"]);
  });

  // @req FR-NODE-243 AC-7
  it("writes every plan", async () => {
    const { a, b } = await twoFiles();
    expect(await applyPatchPlans(await plansFor(a, b), { dryRun: false })).toEqual({ written: true });
    expect([await readFile(a, "utf8"), await readFile(b, "utf8")]).toEqual(["ONE\ntwo\n", "THREE\nfour\n"]);
  });

  // @req FR-NODE-243 AC-7
  it("puts the documents already written back when a later write fails, and rethrows", async () => {
    const { a, b } = await twoFiles();
    const plans = await plansFor(a, b);
    fault.failTarget = b;
    await expect(applyPatchPlans(plans, { dryRun: false })).rejects.toThrow(/injected write failure/);
    expect([await readFile(a, "utf8"), await readFile(b, "utf8")]).toEqual(["one\ntwo\n", "three\nfour\n"]);
  });

  // @req FR-NODE-243 AC-7
  it("refuses before the first write when any document changed after it was read", async () => {
    const { a, b } = await twoFiles();
    const plans = await plansFor(a, b);
    await writeFile(b, "changed underneath\n", "utf8");
    await expect(applyPatchPlans(plans, { dryRun: false })).rejects.toThrow();
    expect(await readFile(a, "utf8")).toBe("one\ntwo\n");
  });

  // @req FR-NODE-243 AC-7
  it("writes nothing on dryRun", async () => {
    const { a, b } = await twoFiles();
    expect(await applyPatchPlans(await plansFor(a, b), { dryRun: true })).toEqual({ written: false });
    expect([await readFile(a, "utf8"), await readFile(b, "utf8")]).toEqual(["one\ntwo\n", "three\nfour\n"]);
  });
});
