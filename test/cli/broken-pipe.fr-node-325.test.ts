import { exec } from "node:child_process";
import { EventEmitter } from "node:events";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { endQuietlyOnBrokenPipe } from "../../src/cli/broken-pipe.js";

// @req FR-NODE-325 AC-1 AC-2 — a reader that closes the pipe early (`| head`) ends the CLI quietly;
// any other standard output error still surfaces.

const CLI = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "bin", "speckiwi");

function errno(code: string): NodeJS.ErrnoException {
  return Object.assign(new Error(`${code}: write`), { code });
}

describe("FR-NODE-325 AC-1 — a closed pipe ends the CLI without a stack trace", () => {
  it("FR-NODE-325 AC-1: the handler swallows EPIPE", () => {
    const stream = new EventEmitter();
    endQuietlyOnBrokenPipe(stream);
    expect(() => stream.emit("error", errno("EPIPE"))).not.toThrow();
  });

  it("FR-NODE-325 AC-1: commands --json into a reader that closes after the first bytes writes nothing to stderr", async () => {
    // A reader in a second process that exits after its first chunk, joined by the shell as `| head` is.
    const reader = `"${process.execPath}" -e "process.stdin.once('data',()=>process.exit(0))"`;
    const stderr = await new Promise<string>((resolve) => {
      exec(`"${process.execPath}" "${CLI}" commands --json | ${reader}`, (_error, _stdout, text) => resolve(text));
    });
    expect(stderr).not.toMatch(/EPIPE/);
    expect(stderr).not.toMatch(/\n\s+at /);
    expect(stderr).toBe("");
  }, 60_000);
});

describe("FR-NODE-325 AC-2 — other standard output errors still surface", () => {
  it("FR-NODE-325 AC-2: the handler rethrows an error that is not EPIPE", () => {
    const stream = new EventEmitter();
    endQuietlyOnBrokenPipe(stream);
    expect(() => stream.emit("error", errno("ENOSPC"))).toThrow(/ENOSPC/);
  });
});
