import { mkdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { readUtf8File } from "../../../src/core/fs/read-text.js";

// FR-NODE-091 — a document that cannot be read can be named. Node's read error for a directory carries
// no path, so the file is attached as the error's `path` property. The message and the code stay what
// Node wrote: callers classify by them (the CLI boundary reads the message), and changing either moved
// a directory-as-index failure to a different exit code.

describe("FR-NODE-091 — readUtf8File attaches the file it could not read without rewording the error", () => {
  // @req FR-NODE-091
  it("sets `path` on an error that has none and leaves message and code as Node wrote them", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "speckiwi-read-text-"));
    const target = path.join(dir, "90.appendix.md");
    await mkdir(target);

    const error = (await readUtf8File(target, dir).then(
      () => undefined,
      (caught: unknown) => caught
    )) as (Error & { code?: string; path?: string }) | undefined;

    expect(error).toBeInstanceOf(Error);
    expect(error!.code).toBe("EISDIR");
    expect(error!.message).toBe("EISDIR: illegal operation on a directory, read");
    expect(error!.path).toBe(target);
  });

  // @req FR-NODE-091
  it("leaves an error that already names its file untouched", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "speckiwi-read-text-"));
    const target = path.join(dir, "missing.md");

    const error = (await readUtf8File(target, dir).then(
      () => undefined,
      (caught: unknown) => caught
    )) as (Error & { code?: string; path?: string }) | undefined;

    expect(error?.code).toBe("ENOENT");
    expect(error?.message).toBe(`ENOENT: no such file or directory, open '${target}'`);
    expect(error?.path).toBe(target);
  });
});
