import { mkdir, readFile, utimes, writeFile } from "node:fs/promises";
import { hostname } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  acquire,
  readHolder,
  release,
  renew,
  resolveGitCommonDir,
  RUN_LOCK_GATE,
  RunLockHeldError,
  runLockPath,
  type RunLock
} from "../../../src/core/orchestrator/run-lock.js";
import { cleanupFixtures, commitAll, initRepo, rawGit, tempDir } from "./support/git-fixture.js";

const DEAD_PID = 2_147_483_647;
const held: RunLock[] = [];

async function repository(prefix: string): Promise<{ root: string; commonDir: string }> {
  const root = await initRepo(prefix);
  await writeFile(path.join(root, "README.md"), "# run lock fixture\n", "utf8");
  await commitAll(root, "test: seed the repository");
  return { root, commonDir: await resolveGitCommonDir(root) };
}

async function writeSentinel(commonDir: string, input: { pid: number; owner: string; host?: string }): Promise<string> {
  const lockPath = runLockPath(commonDir);
  await mkdir(path.dirname(lockPath), { recursive: true });
  await writeFile(lockPath, `${JSON.stringify({
    version: 1,
    token: "pre-existing-token",
    pid: input.pid,
    host: input.host ?? hostname(),
    owner: input.owner,
    acquired_at: new Date().toISOString()
  })}\n`, "utf8");
  return lockPath;
}

async function acquireTracked(commonDir: string, owner: string): Promise<RunLock> {
  const lock = await acquire({ commonDir, owner });
  held.push(lock);
  return lock;
}

afterAll(async () => {
  for (const lock of held.splice(0)) await release(lock).catch(() => undefined);
  await cleanupFixtures();
});

describe("FR-NODE-131 orchestrator run lock keyed on the git common dir", { timeout: 120_000 }, () => {
  it("AC-1: two linked worktrees share one lock path and the second acquisition is refused", async () => {
    const main = await repository("e32-worktrees");
    const linked = path.join(await tempDir("e32-linked"), "linked");
    await rawGit(main.root, "worktree", "add", "-b", "e32", linked);
    const linkedCommonDir = await resolveGitCommonDir(linked);

    expect(linkedCommonDir).toBe(main.commonDir);
    expect(runLockPath(linkedCommonDir)).toBe(runLockPath(main.commonDir));

    const first = await acquireTracked(main.commonDir, "run-a");
    await expect(acquire({ commonDir: linkedCommonDir, owner: "run-b" }))
      .rejects.toBeInstanceOf(RunLockHeldError);
    await expect(acquire({ commonDir: linkedCommonDir, owner: "run-b" }))
      .rejects.toMatchObject({ gate: RUN_LOCK_GATE, owner: "run-a" });
    expect(RUN_LOCK_GATE).toBe("orchestrator-run-lock-held");

    await release(first);
    held.splice(held.indexOf(first), 1);
  });

  it("AC-2: two repositories with distinct common dirs hold the lock concurrently", async () => {
    const left = await repository("e32-repo-left");
    const right = await repository("e32-repo-right");
    expect(runLockPath(left.commonDir)).not.toBe(runLockPath(right.commonDir));

    const first = await acquireTracked(left.commonDir, "run-left");
    const second = await acquireTracked(right.commonDir, "run-right");
    expect(first.lockPath).not.toBe(second.lockPath);
    await expect(readHolder(left.commonDir)).resolves.toMatchObject({ owner: "run-left" });
    await expect(readHolder(right.commonDir)).resolves.toMatchObject({ owner: "run-right" });

    await release(first);
    await release(second);
    held.length = 0;
  });

  it("AC-3: exports acquire, renew and release, and never overwrites an existing sentinel", async () => {
    const module = await import("../../../src/core/orchestrator/run-lock.js");
    expect(typeof module.acquire).toBe("function");
    expect(typeof module.renew).toBe("function");
    expect(typeof module.release).toBe("function");

    const target = await repository("e32-oexcl");
    const lockPath = await writeSentinel(target.commonDir, { pid: process.pid, owner: "live-owner" });
    const before = await readFile(lockPath, "utf8");

    await expect(acquire({ commonDir: target.commonDir, owner: "contender" }))
      .rejects.toBeInstanceOf(RunLockHeldError);
    expect(await readFile(lockPath, "utf8")).toBe(before);
  });

  it("AC-4: reclaims a sentinel whose pid is dead and refuses one whose pid is live", async () => {
    const dead = await repository("e32-dead-pid");
    const stalePath = await writeSentinel(dead.commonDir, { pid: DEAD_PID, owner: "crashed-run" });
    const old = new Date("2000-01-01T00:00:00.000Z");
    await utimes(stalePath, old, old);
    const reclaimed = await acquireTracked(dead.commonDir, "successor-run");
    await expect(readHolder(dead.commonDir)).resolves.toMatchObject({ owner: "successor-run" });
    await release(reclaimed);
    held.splice(held.indexOf(reclaimed), 1);

    const live = await repository("e32-live-pid");
    const livePath = await writeSentinel(live.commonDir, { pid: process.pid, owner: "live-run" });
    await utimes(livePath, old, old);
    await expect(acquire({ commonDir: live.commonDir, owner: "contender" }))
      .rejects.toBeInstanceOf(RunLockHeldError);

    // A foreign host's liveness cannot be proven locally, so it is never stolen on age alone.
    const foreign = await repository("e32-foreign-host");
    const foreignPath = await writeSentinel(foreign.commonDir, {
      pid: DEAD_PID,
      owner: "foreign-run",
      host: "other-host.invalid"
    });
    await utimes(foreignPath, old, old);
    await expect(acquire({ commonDir: foreign.commonDir, owner: "contender" }))
      .rejects.toBeInstanceOf(RunLockHeldError);
  });

  it("AC-5: release is followed by a successful acquisition, and renew keeps ownership", async () => {
    const target = await repository("e32-release");
    const first = await acquire({ commonDir: target.commonDir, owner: "run-one" });
    await renew(first);
    await expect(readHolder(target.commonDir)).resolves.toMatchObject({ owner: "run-one" });
    await release(first);

    const second = await acquireTracked(target.commonDir, "run-two");
    expect(second.lockPath).toBe(first.lockPath);
    expect(second.token).not.toBe(first.token);
    await expect(renew(first)).rejects.toBeInstanceOf(RunLockHeldError);
    await release(second);
    held.splice(held.indexOf(second), 1);
  });

  it("AC-6: reports the holder of a held lock and no holder after release", async () => {
    const target = await repository("e32-status");
    await expect(readHolder(target.commonDir)).resolves.toBeNull();

    const lock = await acquire({ commonDir: target.commonDir, owner: "status-run" });
    const holder = await readHolder(target.commonDir);
    expect(holder).toMatchObject({ owner: "status-run", pid: process.pid, host: hostname() });
    expect(typeof holder?.acquiredAt).toBe("string");
    expect(Number.isFinite(Date.parse(holder!.acquiredAt))).toBe(true);

    await release(lock);
    await expect(readHolder(target.commonDir)).resolves.toBeNull();
  });
});
