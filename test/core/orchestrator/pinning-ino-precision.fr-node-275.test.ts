import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import type * as FsPromises from "node:fs/promises";
import path from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";

// @req FR-NODE-275 AC-4 (found by 5.3.5 verification round 2): NTFS file ids exceed
// Number.MAX_SAFE_INTEGER (the sequence number sits in the high bits), so a number-typed ino rounds
// two neighbouring files to one value and a same-byte replacement passes the inode check. The
// round found such a pair among 400 ordinary file creations. The ids depend on the volume, so the
// mock makes the loss total and deterministic: the number view of every ino is one value (2^62, as
// a double), while the bigint view keeps each file's exact id.
const LIFT = 2n ** 62n;

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof FsPromises>();
  type AnyStats = Record<string, unknown> & { ino: number | bigint };
  const lift = (exact: AnyStats, asBigint: boolean, shaped: AnyStats): AnyStats => {
    const ino = (exact.ino as bigint) + LIFT;
    return Object.assign(Object.create(Object.getPrototypeOf(shaped) as object) as AnyStats, shaped, { ino: asBigint ? ino : Number(LIFT) });
  };
  const wantsBigint = (options: unknown): boolean => typeof options === "object" && options !== null && (options as { bigint?: boolean }).bigint === true;
  return {
    ...actual,
    lstat: (async (file: Parameters<typeof actual.lstat>[0], options?: unknown) => {
      const exact = (await actual.lstat(file, { bigint: true })) as unknown as AnyStats;
      const shaped = (await actual.lstat(file, options as never)) as unknown as AnyStats;
      return lift(exact, wantsBigint(options), shaped);
    }) as unknown as typeof actual.lstat,
    open: (async (...args: Parameters<typeof actual.open>) => {
      const handle = await actual.open(...args);
      const stat = handle.stat.bind(handle);
      return Object.assign(handle, {
        stat: async (options?: unknown) => lift((await stat({ bigint: true })) as unknown as AnyStats, wantsBigint(options), (await stat(options as never)) as unknown as AnyStats)
      });
    }) as typeof actual.open
  };
});

const { assertPinned, pinHandoff } = await import("../../../src/core/orchestrator/pinning.js");
const { cleanupFixtures, commitAll, initRepo } = await import("./support/git-fixture.js");
const { lstat } = await import("node:fs/promises");

const DOC = "handoff/lane-1.md";

afterAll(cleanupFixtures);

describe("FR-NODE-275 AC-4 identities compared at full 64-bit precision", () => {
  it("@req FR-NODE-275 AC-4: refuses a same-byte replacement whose id rounds to the leaf's number", async () => {
    const root = await initRepo("pin-ino-precision");
    await mkdir(path.join(root, "handoff"), { recursive: true });
    const leaf = path.join(root, DOC);
    await writeFile(leaf, "# Lane 1 handoff\n");
    const head = await commitAll(root, "test: seed handoff document");
    const pinned = await pinHandoff({ root, expectedHead: head, documentPaths: [DOC] });

    const before = (await lstat(leaf, { bigint: true })).ino;
    const replacement = `${leaf}.replacement`;
    await writeFile(replacement, await readFile(leaf));
    await rm(leaf);
    await rename(replacement, leaf);
    const after = (await lstat(leaf, { bigint: true })).ino;
    expect(after, "the replacement is a different file").not.toBe(before);

    await expect(assertPinned(pinned)).rejects.toThrow();
  }, 180_000);
});
