import { mkdtemp, mkdir, realpath, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { detectNewline } from "../../../src/core/fs/newline.js";
import { readUtf8File } from "../../../src/core/fs/read-text.js";
import { resolveInsideRoot } from "../../../src/core/fs/safe-path.js";
import { resolveProjectRoot } from "../../../src/core/project-root.js";

async function tempDir() {
  return mkdtemp(path.join(tmpdir(), "speckiwi-root-"));
}

describe("root, path, and UTF-8 utilities", () => {
  it("resolves explicit roots, git roots, and docs/spec roots", async () => {
    const root = await tempDir();
    await mkdir(path.join(root, ".git"));
    await mkdir(path.join(root, "child"));

    await expect(resolveProjectRoot(path.join(root, "child"))).resolves.toMatchObject({ root });
    await expect(resolveProjectRoot(process.cwd(), root)).resolves.toMatchObject({ root });

    const specRoot = await tempDir();
    await mkdir(path.join(specRoot, "docs", "spec"), { recursive: true });
    await writeFile(path.join(specRoot, "docs", "spec", "00.index.md"), "# index\n", "utf8");
    await expect(resolveProjectRoot(specRoot)).resolves.toMatchObject({ root: specRoot });
  });

  it("reads UTF-8, detects newline style, and denies path escapes", async () => {
    const root = await tempDir();
    const file = path.join(root, "file.md");
    await writeFile(file, "가\r\n나\r\n", "utf8");

    const textFile = await readUtf8File(file);
    expect(textFile.text).toContain("가");
    expect(detectNewline(textFile.text)).toBe("\r\n");
    await expect(resolveInsideRoot(root, "file.md")).resolves.toBe(await realpath(file));
    await expect(resolveInsideRoot(root, "..")).rejects.toThrow(/outside/i);
  });

  it("denies symlink escapes when the platform supports symlinks", async () => {
    const root = await tempDir();
    const outside = await tempDir();
    const link = path.join(root, "outside-link");
    try {
      await symlink(outside, link, "dir");
    } catch {
      return;
    }
    await expect(resolveInsideRoot(root, "outside-link")).rejects.toThrow(/outside/i);
  });
});
