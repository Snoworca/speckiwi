import { execFileSync } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { git, gitTrackedPaths } from "../../src/core/root-facts.js";

// @req FR-NODE-227 — inside a git hook, git exports GIT_DIR (and may export GIT_WORK_TREE / GIT_INDEX_FILE),
// which outrank `git -C <root>` discovery. The tracked-file check must still ask the project's repository.

async function repoTracking(file: string): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "speckiwi-tracked-env-"));
  execFileSync("git", ["init", "-q", root], { windowsHide: true });
  await writeFile(path.join(root, file), "tracked\n", "utf8");
  execFileSync("git", ["-C", root, "add", file], { windowsHide: true });
  return root;
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("FR-NODE-227 the tracked-file check ignores an inherited repository environment", () => {
  it("FR-NODE-227 AC-1: under GIT_DIR naming another repository, the project's tracked file is still tracked", async () => {
    const project = await repoTracking("CLAUDE.md");
    const other = await repoTracking("OTHER.md");
    vi.stubEnv("GIT_DIR", path.join(other, ".git"));

    expect(await gitTrackedPaths(project, [path.join(project, "CLAUDE.md"), path.join(project, "OTHER.md")])).toEqual(["CLAUDE.md"]);
  });

  it("FR-NODE-227 AC-2: under GIT_WORK_TREE and GIT_INDEX_FILE naming another repository, the answer is the project's", async () => {
    const project = await repoTracking("CLAUDE.md");
    const other = await repoTracking("OTHER.md");
    vi.stubEnv("GIT_WORK_TREE", other);
    vi.stubEnv("GIT_INDEX_FILE", path.join(other, ".git", "index"));

    expect(await gitTrackedPaths(project, [path.join(project, "CLAUDE.md"), path.join(project, "OTHER.md")])).toEqual(["CLAUDE.md"]);
  });

  it("FR-NODE-227 AC-3: the shared runner itself still inherits the environment", async () => {
    const project = await repoTracking("CLAUDE.md");
    const other = await repoTracking("OTHER.md");
    vi.stubEnv("GIT_DIR", path.join(other, ".git"));

    const answer = await git(project, ["ls-files"]);
    expect(answer.stdout.trim()).toBe("OTHER.md");
  });
});
