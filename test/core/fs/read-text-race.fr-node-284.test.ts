import type * as FsPromises from "node:fs/promises";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";

// @req FR-NODE-284 — readUtf8File reports the read's own error for a missing file on every run.
//
// Measured on 5.3.8: readFile and stat ran together under Promise.all, and whichever rejected first
// won — stat in 29-35% of runs on Windows — so FR-NODE-091's test failed about one run in three.
// Delaying readFile makes the losing order certain instead of likely.

const delay = vi.hoisted(() => ({ readFileMs: 0 }));

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof FsPromises>();
  return {
    ...actual,
    readFile: (async (...args: Parameters<typeof actual.readFile>) => {
      if (delay.readFileMs > 0) await new Promise((resolve) => setTimeout(resolve, delay.readFileMs));
      return actual.readFile(...args);
    }) as typeof actual.readFile
  };
});

const { readUtf8File } = await import("../../../src/core/fs/read-text.js");

const root = await mkdtemp(path.join(tmpdir(), "speckiwi-read-race-"));

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("FR-NODE-284 AC-1 — a missing file rejects with the open error, whichever call settles first", () => {
  it.each([0, 20])("rejects with syscall open when readFile is delayed %d ms", async (ms) => {
    delay.readFileMs = ms;
    const missing = path.join(root, "missing.md");
    const error = (await readUtf8File(missing).then(
      () => null,
      (reason: unknown) => reason
    )) as NodeJS.ErrnoException | null;
    delay.readFileMs = 0;
    expect(error).not.toBeNull();
    expect(error?.code).toBe("ENOENT");
    expect(error?.syscall).toBe("open");
    expect(error?.message).toContain("open");
    expect(error?.message).toContain("missing.md");
  });
});
