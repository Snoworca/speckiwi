import { execFileSync } from "node:child_process";
import { openSync, readSync, closeSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { isReviewCodeFile } from "../../../src/core/review/code-file-class.js";

// FR-NODE-274 AC-2 — the code-file class filter over every file this repository tracks: a file is held
// to the class its extension or its first line gives it, so a kind of source the filter does not know
// shows up here rather than as a round whose scope quietly misses it.

/** The source extensions this suite expects to be code, written here rather than read from the filter. */
const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs", ".sh", ".ps1", ".py"]);

function trackedFiles(): string[] {
  return execFileSync("git", ["ls-files", "-z"], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }).split("\0").filter((file) => file !== "");
}

/** The first line of a tracked file as it is in the working tree (at most 256 bytes are read). */
function firstLine(file: string): string {
  const fd = openSync(file, "r");
  const buffer = Buffer.alloc(256);
  const read = readSync(fd, buffer, 0, buffer.length, 0);
  closeSync(fd);
  return buffer.subarray(0, read).toString("utf8").split(/\r?\n/)[0] ?? "";
}

function notCode(file: string): boolean {
  const name = path.posix.basename(file);
  return file.startsWith("docs/spec/") || name.startsWith("README") || name === "SKILL.md" || name.endsWith(".jsonl") || name.endsWith(".lock");
}

describe("FR-NODE-274 AC-2 — the class of every tracked file", () => {
  // @req FR-NODE-274 AC-2
  it("holds every tracked source file and #! script to code, and spec, README, SKILL.md, journals and locks to not code", async () => {
    const files = trackedFiles();
    const wrong: string[] = [];
    let code = 0;
    let prose = 0;
    for (const file of files) {
      const line = firstLine(file);
      const isCode = await isReviewCodeFile(file, async () => line);
      if (SOURCE_EXTENSIONS.has(path.posix.extname(file).toLowerCase()) || line.startsWith("#!")) {
        code += 1;
        if (!isCode) wrong.push(`${file}: expected code`);
      }
      if (notCode(file)) {
        prose += 1;
        if (isCode) wrong.push(`${file}: expected not code`);
      }
    }
    expect(wrong).toEqual([]);
    // The denominators are spent, not merely declared: an empty listing would pass the loop above.
    expect(code).toBeGreaterThan(1000);
    expect(prose).toBeGreaterThan(50);
    expect(files).toContain("bin/speckiwi");
  });

  // @req FR-NODE-274 AC-2
  it("reads the content only of a file its name does not classify, and refuses a journal or lock whatever its first line", async () => {
    const reads: string[] = [];
    const reader = (file: string, line: string) => async () => {
      reads.push(file);
      return line;
    };
    expect(await isReviewCodeFile("bin/tool", reader("bin/tool", "#!/usr/bin/env node"))).toBe(true);
    expect(await isReviewCodeFile("bin/data", reader("bin/data", "plain text"))).toBe(false);
    expect(await isReviewCodeFile("bin/gone", reader("bin/gone", undefined as unknown as string))).toBe(false);
    expect(await isReviewCodeFile("src/a.ts", reader("src/a.ts", "#!"))).toBe(true);
    expect(await isReviewCodeFile("notes.md", reader("notes.md", "#!/bin/sh"))).toBe(false);
    expect(await isReviewCodeFile("kiwi/waves.jsonl", reader("kiwi/waves.jsonl", "#!/bin/sh"))).toBe(false);
    expect(await isReviewCodeFile("route.lock", reader("route.lock", "#!/bin/sh"))).toBe(false);
    expect(reads).toEqual(["bin/tool", "bin/data", "bin/gone"]);
  });
});
