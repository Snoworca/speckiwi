import { execFile } from "node:child_process";
import { mkdir, mkdtemp, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { GitUnavailableError, gitToplevelOf } from "../../src/core/root-facts.js";

// @req FR-NODE-178, FR-NODE-179, FR-NODE-180 — the one place that answers "which repository contains
// this path". Every run-root gate is only as honest as this answer, so the ways it can be steered or
// misread are pinned here rather than at the four call sites.

const execFileAsync = promisify(execFile);
const touched: string[] = [];

afterEach(() => {
  for (const key of touched.splice(0)) delete process.env[key];
});

async function repository(): Promise<string> {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), "speckiwi-root-facts-")));
  await execFileAsync("git", ["init", "--quiet"], { cwd: root });
  return root;
}

describe("gitToplevelOf", () => {
  it("reports the top level of the repository containing the path", async () => {
    const root = await repository();
    const module = path.join(root, "server");
    await mkdir(module, { recursive: true });

    expect(await gitToplevelOf(module)).toBeDefined();
    expect(path.resolve((await gitToplevelOf(module)) as string)).toBe(path.resolve(root));
  });

  it("returns undefined for a path in no repository", async () => {
    const bare = await realpath(await mkdtemp(path.join(tmpdir(), "speckiwi-root-facts-none-")));
    expect(await gitToplevelOf(bare)).toBeUndefined();
  });

  it("is not steerable by an ambient GIT_WORK_TREE, whatever case it was set in", async () => {
    // Windows matches environment names case-insensitively for the child process, so scrubbing the
    // upper-case spellings alone leaves `git_work_tree` in place and lets an ambient variable answer
    // a question that was asked about a path. On a case-sensitive host git ignores the lower-case
    // spelling by itself, so this case is a real guard there only for the upper-case half.
    const root = await repository();
    const module = path.join(root, "server");
    await mkdir(module, { recursive: true });

    for (const key of ["git_work_tree", "GIT_WORK_TREE", "git_dir", "GIT_DIR"]) {
      touched.push(key);
      process.env[key] = module;
    }

    const reported = await gitToplevelOf(module);

    expect(reported, "an ambient work tree must not become the answer").toBeDefined();
    expect(path.resolve(reported as string)).toBe(path.resolve(root));
  });

  it("throws rather than reporting `no repository` when git cannot look", async () => {
    // A `.git` file pointing at a gitdir that is not there. git says "not a git repository: <path>",
    // which is a different sentence from the one that means "nothing here is a repository" — reading
    // them as the same answer tells the caller their layout is fine when git could not look at all.
    const dangling = await realpath(await mkdtemp(path.join(tmpdir(), "speckiwi-root-facts-dangling-")));
    await writeFile(path.join(dangling, ".git"), "gitdir: C:/no/such/gitdir\n", "utf8");

    await expect(gitToplevelOf(dangling)).rejects.toBeInstanceOf(GitUnavailableError);
  });

  it("throws for a directory that is not there", async () => {
    const missing = path.join(await realpath(tmpdir()), "speckiwi-root-facts-absent-directory");

    await expect(gitToplevelOf(missing)).rejects.toBeInstanceOf(GitUnavailableError);
  });

  it("carries git's own words in the failure, so the caller can report what happened", async () => {
    const missing = path.join(await realpath(tmpdir()), "speckiwi-root-facts-absent-directory-2");

    await expect(gitToplevelOf(missing)).rejects.toThrow(/cannot change to|no such file|not a directory/i);
  });

  it("asks git for an untranslated answer, so the classification does not depend on the host locale", async () => {
    // The verdict is decided by matching git's own sentence. Under a translated catalogue that match
    // silently stops working and every no-repository path starts throwing instead.
    const source = await import("node:fs/promises").then((fs) =>
      fs.readFile(new URL("../../src/core/root-facts.ts", import.meta.url), "utf8")
    );
    expect(source, "the locale git speaks must be pinned where the message is matched").toMatch(/LC_ALL/);
  });
});
