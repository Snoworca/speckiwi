import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  acquire,
  release,
  resolveGitCommonDir,
  resolveRunLockGitDir,
  runLockPath,
  type RunLock
} from "../../../src/core/orchestrator/run-lock.js";
import { TYPE_STRIPPING_ARGS } from "../../support/node-type-stripping.js";
import { cleanupFixtures, commitAll, initRepo, rawGit, tempDir } from "./support/git-fixture.js";
import { recordHarvestCwd } from "./support/harvest-cwd.js";

recordHarvestCwd("HV-2");

const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..", "..");
const RUN_LOCK_MODULE = path.join(REPO_ROOT, "src", "core", "orchestrator", "run-lock.ts");
const CHILD_SCRIPT = path.join(import.meta.dirname, "support", "run-lock-child.mjs");

const children: ChildProcessWithoutNullStreams[] = [];
const held: RunLock[] = [];

/** Spawns the child and resolves with its first stdout line — `ACQUIRED …` or `REFUSED …`. */
function spawnContender(commonDir: string, owner: string): {
  child: ChildProcessWithoutNullStreams;
  firstLine: Promise<string>;
} {
  const child = spawn(process.execPath, [...TYPE_STRIPPING_ARGS, CHILD_SCRIPT, RUN_LOCK_MODULE, commonDir, owner], {
    cwd: REPO_ROOT,
    windowsHide: true,
    stdio: ["pipe", "pipe", "pipe"]
  });
  children.push(child);
  const firstLine = new Promise<string>((resolve, reject) => {
    let buffered = "";
    let settled = false;
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      buffered += chunk;
      const newline = buffered.indexOf("\n");
      if (newline >= 0 && !settled) {
        settled = true;
        resolve(buffered.slice(0, newline).trim());
      }
    });
    child.on("error", reject);
    child.on("close", () => {
      if (!settled) {
        settled = true;
        reject(new Error(`run-lock child exited without reporting an outcome: ${buffered}`));
      }
    });
  });
  return { child, firstLine };
}

async function repositoryWithCommonDir(prefix: string): Promise<{ root: string; commonDir: string }> {
  const root = await initRepo(prefix);
  await writeFile(path.join(root, "README.md"), "# run lock fixture\n", "utf8");
  await commitAll(root, "test: seed the repository");
  return { root, commonDir: await resolveGitCommonDir(root) };
}

async function acquireTracked(commonDir: string, owner: string): Promise<RunLock> {
  const lock = await acquire({ gitDir: commonDir, owner });
  held.push(lock);
  return lock;
}

afterAll(async () => {
  for (const child of children.splice(0)) child.kill();
  for (const lock of held.splice(0)) await release(lock).catch(() => undefined);
  await cleanupFixtures();
});

describe("FR-NODE-102 run-lock harvest proven across processes and worktrees", { timeout: 120_000 }, () => {
  it("AC-1: refuses an in-process acquisition while a second OS process holds the lock", async () => {
    const repository = await repositoryWithCommonDir("run-lock-xproc");
    const contender = spawnContender(repository.commonDir, "child-orchestrator");
    const line = await contender.firstLine;
    expect(line.startsWith("ACQUIRED ")).toBe(true);
    expect(line.slice("ACQUIRED ".length)).toBe(runLockPath(repository.commonDir));
    expect(contender.child.pid).not.toBe(process.pid);

    await expect(acquire({ gitDir: repository.commonDir, owner: "parent-orchestrator" }))
      .rejects.toMatchObject({ gate: "orchestrator-run-lock-held" });

    contender.child.kill();
  });

  it("AC-1: refuses a second OS process while this process holds the lock", async () => {
    const repository = await repositoryWithCommonDir("run-lock-xproc-b");
    const lock = await acquireTracked(repository.commonDir, "parent-orchestrator");

    const contender = spawnContender(repository.commonDir, "child-orchestrator");
    const line = await contender.firstLine;
    expect(line).toBe("REFUSED orchestrator-run-lock-held");
    const exitCode = await new Promise<number | null>((resolve) => contender.child.on("close", resolve));
    expect(exitCode).toBe(3);

    await release(lock);
    held.splice(held.indexOf(lock), 1);
  });

  // FR-NODE-311 moved the key from the common dir to each worktree's git dir: two worktrees over one
  // .git each admit one run, and two contenders inside one worktree still exclude each other.
  it("AC-2: each of two worktrees over one .git admits exactly one of its two contenders", async () => {
    const repository = await repositoryWithCommonDir("run-lock-worktrees");
    const secondWorktree = path.join(await tempDir("run-lock-linked"), "linked");
    await rawGit(repository.root, "worktree", "add", "-b", "linked", secondWorktree);

    const first = await resolveRunLockGitDir(repository.root);
    const second = await resolveRunLockGitDir(secondWorktree);
    const attempts = await Promise.allSettled([
      acquire({ gitDir: first, owner: "worktree-a-1" }),
      acquire({ gitDir: first, owner: "worktree-a-2" }),
      acquire({ gitDir: second, owner: "worktree-b-1" }),
      acquire({ gitDir: second, owner: "worktree-b-2" })
    ]);

    const winners = attempts.filter((attempt) => attempt.status === "fulfilled").map((attempt) => (attempt as PromiseFulfilledResult<RunLock>).value);
    const losers = attempts.filter((attempt) => attempt.status === "rejected");
    expect(winners).toHaveLength(2);
    expect(new Set(winners.map((lock) => lock.lockPath)).size).toBe(2);
    expect(losers).toHaveLength(2);
    for (const loser of losers) expect((loser as PromiseRejectedResult).reason).toMatchObject({ gate: "orchestrator-run-lock-held" });

    for (const lock of winners) await release(lock);
  });

  it("AC-3: the main checkout's lock path is under the common dir and a linked worktree's under its own git dir", async () => {
    const repository = await repositoryWithCommonDir("run-lock-keying");
    const secondWorktree = path.join(await tempDir("run-lock-keying-linked"), "linked");
    await rawGit(repository.root, "worktree", "add", "-b", "keying", secondWorktree);

    const first = await resolveRunLockGitDir(repository.root);
    const second = await resolveRunLockGitDir(secondWorktree);
    expect(first).toBe(repository.commonDir);
    expect(runLockPath(first)).toBe(path.join(repository.commonDir, "speckiwi", "orchestrator-run.lock"));
    const normalized = (value: string) => value.replaceAll("\\", "/").toLowerCase();
    expect(normalized(second).startsWith(normalized(path.join(repository.commonDir, "worktrees")))).toBe(true);

    // Neither lock path carries a worktree's own top level, so a checkout's files never hold the lease
    // and `git worktree remove` takes a linked worktree's lease with its git dir.
    expect(normalized(runLockPath(second))).not.toContain(normalized(secondWorktree));
    expect(runLockPath(second)).not.toBe(runLockPath(first));
  });
});
