import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { main } from "../../src/cli/index.js";
import { pathMissingFromMessage } from "../../src/core/fs/error-path.js";

// @req FR-NODE-290 — reproduced 2026-11-20: `speckiwi upgrade --apply` with AGENTS.md made a directory
// printed only "EISDIR: illegal operation on a directory, read", naming no file, in both output modes.

const EISDIR = "EISDIR: illegal operation on a directory, read";

/** An initialised SpecKiwi project in a fresh git repository. */
async function project(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "fs-290-"));
  execFileSync("git", ["init", "-q"], { cwd: dir });
  expect(path.resolve(execFileSync("git", ["rev-parse", "--show-toplevel"], { cwd: dir, encoding: "utf8" }).trim())).toBe(path.resolve(dir));
  const code = await main(["--root", dir, "init", "--target", "v0.1.0", "--scope", "App:APP", "--no-skills", "--no-mcp", "--json"], { stdout: new PassThrough(), stderr: new PassThrough() });
  expect(code).toBe(0);
  return dir;
}

async function upgrade(dir: string, json: boolean): Promise<{ code: number; stdout: string; stderr: string }> {
  const streams = { stdout: new PassThrough(), stderr: new PassThrough() };
  const code = await main(["--root", dir, "upgrade", "--apply", "--no-skills", "--no-mcp", ...(json ? ["--json"] : [])], streams);
  return { code, stdout: streams.stdout.read()?.toString() ?? "", stderr: streams.stderr.read()?.toString() ?? "" };
}

type Envelope = { ok: boolean; error: { code: string; message: string; path?: string } };

describe("FR-NODE-290 AC-1 AC-2 — a read failure that names no file names it", () => {
  async function agentsFileIsADirectory(): Promise<string> {
    const dir = await project();
    await rm(path.join(dir, "AGENTS.md"), { force: true });
    await mkdir(path.join(dir, "AGENTS.md"));
    return dir;
  }

  // @req FR-NODE-290 AC-1 AC-2
  it("--json adds error.path and keeps the message, the code and the exit code", async () => {
    const result = await upgrade(await agentsFileIsADirectory(), true);
    const answer = JSON.parse(result.stdout) as Envelope;
    expect(result.code).toBe(2);
    expect(answer.error.code).toBe("CLI_READ_ERROR");
    expect(answer.error.message).toBe(EISDIR);
    expect(path.basename(answer.error.path ?? "")).toBe("AGENTS.md");
  });

  // @req FR-NODE-290 AC-1 AC-2
  it("human output prints the message and the path in parentheses", async () => {
    const dir = await agentsFileIsADirectory();
    const result = await upgrade(dir, false);
    expect(result.code).toBe(2);
    expect(result.stderr).toMatch(/^EISDIR: illegal operation on a directory, read \(.*AGENTS\.md\)\n$/);
  });
});

describe("FR-NODE-290 AC-3 — a message that already names its path, or an error with none, is unchanged", () => {
  async function claudeIsAFile(): Promise<string> {
    const dir = await project();
    await rm(path.join(dir, ".claude"), { recursive: true, force: true });
    await writeFile(path.join(dir, ".claude"), "not a directory\n", "utf8");
    return dir;
  }

  // @req FR-NODE-290 AC-3
  it("an EEXIST naming .claude in its message prints exactly the message, with no error.path", async () => {
    const dir = await claudeIsAFile();
    const json = await upgrade(dir, true);
    const answer = JSON.parse(json.stdout) as Envelope;
    expect(json.code).toBe(5);
    expect(answer.error.code).toBe("FILESYSTEM_WRITE_ERROR");
    expect(answer.error.message).toMatch(/^EEXIST: file already exists, mkdir '.*\.claude'$/);
    expect(Object.keys(answer.error).sort()).toEqual(["code", "message"]);
    const human = await upgrade(dir, false);
    expect(human.stderr).toBe(`${answer.error.message}\n`);
  });

  // @req FR-NODE-290 AC-3
  it("an error that carries no path prints as before", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "fs-290-"));
    const streams = { stdout: new PassThrough(), stderr: new PassThrough() };
    await main(["--root", dir, "validate", "--json"], streams);
    const answer = JSON.parse(streams.stdout.read()?.toString() ?? "{}") as Envelope;
    expect(answer.ok).toBe(false);
    expect(Object.keys(answer.error).sort()).toEqual(["code", "message"]);
  });
});

describe("FR-NODE-290 AC-4 — one function decides whether the message names the path", () => {
  // @req FR-NODE-290 AC-4
  it("returns the path only when the error carries one its message lacks", () => {
    expect(pathMissingFromMessage({ message: EISDIR, path: "C:\\p\\AGENTS.md" })).toBe("C:\\p\\AGENTS.md");
    expect(pathMissingFromMessage({ message: "EEXIST: file already exists, mkdir 'C:\\p\\.claude'", path: "C:\\p\\.claude" })).toBeUndefined();
    expect(pathMissingFromMessage({ message: EISDIR })).toBeUndefined();
    expect(pathMissingFromMessage({ message: EISDIR, path: 7 })).toBeUndefined();
    expect(pathMissingFromMessage({ path: "/p/AGENTS.md" })).toBe("/p/AGENTS.md");
  });
});
