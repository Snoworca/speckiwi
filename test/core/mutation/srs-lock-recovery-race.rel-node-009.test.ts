import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readdir, readFile, rm, stat, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { withSrsMutationLock } from "../../../src/core/mutation/srs-lock.js";
import { resolveProjectRoot } from "../../../src/core/project-root.js";
import type { MutationResult } from "../../../src/core/types.js";
import { copyFixtureWorkspace } from "../../fixtures/fixture-utils.js";
import { fsFaults, isGuard, isLock, pauseAt, resetFsFaults } from "../../support/srs-lock-fs-faults.js";

vi.mock("node:fs/promises", async (original) => {
  const { wrapFsPromises } = await import("../../support/srs-lock-fs-faults.js");
  return wrapFsPromises(await original());
});

/**
 * REL-NODE-009 AC-6 — exactly one contender proceeds when two recover the same stale file. Each
 * interleaving is forced through the wrapped `node:fs/promises` (a pause between reading the stale
 * file and renaming it), so every order is deterministic and run once.
 */

const LOCK = path.join("kiwi", ".srs.lock");
const GUARD = path.join("kiwi", ".srs.lock.guard");

afterEach(() => resetFsFaults());

function ok(): MutationResult<{ written: boolean }> {
  return { ok: true, value: { written: false }, diagnostics: [], diagnosticsSummary: { errors: 0, warnings: 0, byCode: {} } };
}

async function exists(file: string): Promise<boolean> {
  return stat(file).then(() => true, () => false);
}

function metadata(overrides: Record<string, unknown> = {}): string {
  const now = Date.now();
  return `${JSON.stringify({
    schemaVersion: "1.0.0",
    owner: "foreign-host:1",
    operation: "foreign",
    requestId: "foreign-request",
    acquiredAt: new Date(now - 120_000).toISOString(),
    expiresAt: new Date(now - 60_000).toISOString(),
    ...overrides
  })}\n`;
}

async function plant(rootPath: string, relative: string, content: string, ageMs: number): Promise<void> {
  const file = path.join(rootPath, relative);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, content, "utf8");
  const when = new Date(Date.now() - ageMs);
  await utimes(file, when, when);
}

/** Contenders, a counter of how many are inside the mutation at once, and who entered. */
function contenders(root: Awaited<ReturnType<typeof resolveProjectRoot>>, holdMs = 20) {
  let inside = 0;
  let maxInside = 0;
  let entered = 0;
  const enteredBy: string[] = [];
  const mutate = (who: string) => async () => {
    inside += 1;
    entered += 1;
    enteredBy.push(who);
    maxInside = Math.max(maxInside, inside);
    await new Promise((resolve) => setTimeout(resolve, holdMs));
    inside -= 1;
    return ok();
  };
  return {
    run: (operation: string) => withSrsMutationLock(root, { operation }, mutate(operation)),
    stats: () => ({ entered, maxInside }),
    enteredBy
  };
}

/** Lock-family files left in kiwi/ (lock, guard, quarantine names). */
async function lockFamilyLeft(rootPath: string): Promise<string[]> {
  return (await readdir(path.join(rootPath, "kiwi")).catch(() => [] as string[])).filter((name) => name.startsWith(".srs.lock"));
}

async function waitFor(condition: () => boolean, label: string): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${label}`);
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

const proceeded = (results: Array<MutationResult<unknown>>): number => results.filter((result) => result.ok).length;

describe("REL-NODE-009 AC-6 — exactly one winner, proven by injected interleavings", () => {
  for (const [label, content] of [
    ["an aged torn guard", ""],
    ["an expired valid guard", metadata()]
  ] as const) {
    it(`REL-NODE-009 AC-6 (a${label.includes("expired") ? ", c" : ""}): both contenders rename ${label}; exactly one proceeds`, async () => {
      const rootPath = await copyFixtureWorkspace("valid-basic");
      const root = await resolveProjectRoot(rootPath);
      await plant(rootPath, GUARD, content, 6_000);
      const first = pauseAt("rename", isGuard, 1);
      const second = pauseAt("rename", isGuard, 2);
      // The winner's fresh-guard open (the third guard open: two EEXIST opens, then the recreation).
      const recreate = pauseAt("open", isGuard, 3);
      const { run, stats } = contenders(root);

      const a = run("a");
      await first.reached;
      const b = run("b");
      await second.reached;
      first.go();
      await recreate.reached; // a has quarantined the stale file and not yet created its guard
      second.go(); // b renames a file that is already gone
      const bResult = await b;
      recreate.go();
      const results = [await a, bResult];

      expect(proceeded(results)).toBe(1);
      expect(bResult.ok).toBe(false);
      expect(stats()).toEqual({ entered: 1, maxInside: 1 });
      expect(await exists(path.join(rootPath, GUARD))).toBe(false);
      expect(await exists(path.join(rootPath, LOCK))).toBe(false);
    });

    it(`REL-NODE-009 AC-6 (b${label.includes("expired") ? ", c" : ""}): the second renames ${label} after the first created its fresh guard; the fresh guard is restored and its owner still removes it`, async () => {
      const rootPath = await copyFixtureWorkspace("valid-basic");
      const root = await resolveProjectRoot(rootPath);
      await plant(rootPath, GUARD, content, 6_000);
      const first = pauseAt("rename", isGuard, 1);
      const second = pauseAt("rename", isGuard, 2);
      // a holds its fresh guard and is about to create the lock.
      const aHoldsGuard = pauseAt("open", isLock, 1);
      const { run, stats } = contenders(root);

      const a = run("a");
      await first.reached;
      const b = run("b");
      await second.reached;
      first.go();
      await aHoldsGuard.reached;
      const freshGuard = await readFile(path.join(rootPath, GUARD), "utf8");
      second.go(); // b captures a's fresh guard
      const bResult = await b;
      expect(await readFile(path.join(rootPath, GUARD), "utf8"), "the captured fresh guard is restored").toBe(freshGuard);
      aHoldsGuard.go();
      const results = [await a, bResult];

      expect(proceeded(results)).toBe(1);
      expect(bResult.ok).toBe(false);
      expect(stats()).toEqual({ entered: 1, maxInside: 1 });
      expect(await exists(path.join(rootPath, GUARD)), "a's release found and removed its restored guard").toBe(false);
      expect(await exists(path.join(rootPath, LOCK))).toBe(false);
    });
  }

  it("REL-NODE-009 AC-6 (d): an aged torn lock is recovered by one contender while the other is refused", async () => {
    // Recovery of the lock runs under the guard, so the second contender is held at the guard and
    // never reaches the lock's rename: the guard is what makes the lock's recovery single-winner.
    const rootPath = await copyFixtureWorkspace("valid-basic");
    const root = await resolveProjectRoot(rootPath);
    await plant(rootPath, LOCK, "", 6_000);
    const lockRename = pauseAt("rename", isLock, 1);
    const { run, stats } = contenders(root);

    const a = run("a");
    await lockRename.reached;
    const bResult = await run("b");
    lockRename.go();
    const results = [await a, bResult];

    expect(proceeded(results)).toBe(1);
    expect(bResult.ok).toBe(false);
    expect(stats()).toEqual({ entered: 1, maxInside: 1 });
    // One recovery of the torn lock (the other rename of the lock path is the winner's own release).
    expect(results.filter((result) => result.diagnostics.some((item) => item.code === "SRS-W068"))).toHaveLength(1);
    expect(await exists(path.join(rootPath, LOCK))).toBe(false);
  });

  for (const [code, times] of [["EPERM", 2], ["EPERM", Infinity]] as const) {
    it(`REL-NODE-009 AC-9: ${times === Infinity ? "a persistent" : "a clearing"} ${code} on the link that restores a captured guard is ${times === Infinity ? "answered as lock-busy" : "retried and the guard restored"}`, async () => {
      const rootPath = await copyFixtureWorkspace("valid-basic");
      const root = await resolveProjectRoot(rootPath);
      await plant(rootPath, GUARD, "", 6_000);
      const first = pauseAt("rename", isGuard, 1);
      const second = pauseAt("rename", isGuard, 2);
      const aHoldsGuard = pauseAt("open", isLock, 1);
      fsFaults.faults.push({ op: "link", match: isGuard, code, times });
      const { run } = contenders(root);

      const a = run("a");
      await first.reached;
      const b = run("b");
      await second.reached;
      first.go();
      await aHoldsGuard.reached;
      second.go();
      const bResult = await b;
      aHoldsGuard.go();
      const aResult = await a;

      expect(aResult.ok).toBe(true);
      expect(bResult.ok).toBe(false);
      const linkFailures = fsFaults.calls.filter((call) => call.op === "link" && call.failed === code).length;
      if (times === Infinity) {
        expect(linkFailures).toBeGreaterThanOrEqual(4);
        expect(((bResult.error?.diagnostics?.[0] as { details?: Record<string, unknown> } | undefined)?.details ?? {}).kind).toBe("lock-busy");
      } else {
        expect(linkFailures).toBe(2);
      }
    });
  }
});

/**
 * Review r1 (impl-review-locks-r1.md) orders, brought in from its reproductions. Each pairs an aged
 * torn guard with an expired lock, because two guard holders only reach the mutation together when a
 * stale lock is there to be removed twice.
 */
describe("REL-NODE-009 AC-6 — orders from review r1 (H1, M1, M2)", () => {
  function staleLock(): string {
    return metadata();
  }

  it("REL-NODE-009 AC-6 (H1): a successor's fresh guard caught between open(wx) and its first write is restored, not taken as the torn file", async () => {
    const rootPath = await copyFixtureWorkspace("valid-basic");
    const root = await resolveProjectRoot(rootPath);
    await plant(rootPath, GUARD, "", 6_000);
    await plant(rootPath, LOCK, staleLock(), 6_000);
    const { run, stats, enteredBy } = contenders(root, 400);
    const aRename = pauseAt("rename", isGuard, 1);
    const bRename = pauseAt("rename", isGuard, 2);
    const aWrite = pauseAt("handleWrite", isGuard, 1); // a has open(wx)'d its fresh guard, nothing written yet
    const bLockStep = pauseAt(["rm", "rename"], isLock, 1); // b about to remove the stale lock, if it ever gets there

    const a = run("a");
    await aRename.reached;
    const b = run("b");
    await bRename.reached;
    aRename.go();
    await aWrite.reached;
    bRename.go(); // b renames a's empty fresh guard
    const bFirst = await Promise.race([b.then(() => "b-finished" as const), bLockStep.reached.then(() => "b-at-lock" as const)]);
    if (bFirst === "b-at-lock") {
      aWrite.go();
      await waitFor(() => enteredBy.includes("a"), "a to enter");
    }
    // The lock-step pause was set for b; once b has finished it would only stop a.
    bLockStep.go();
    aWrite.go();
    const results = await Promise.all([a, b]);

    expect(stats().maxInside).toBe(1);
    expect(proceeded(results)).toBe(1);
    expect(bFirst, "b must not believe it holds the guard").toBe("b-finished");
    expect(await lockFamilyLeft(rootPath)).toEqual([]);
  }, 15_000);

  it("REL-NODE-009 AC-6 (M1): a stale lock is removed by quarantine and identity, so a lock created meanwhile survives", async () => {
    const rootPath = await copyFixtureWorkspace("valid-basic");
    const root = await resolveProjectRoot(rootPath);
    await plant(rootPath, GUARD, "", 6_000);
    await plant(rootPath, LOCK, staleLock(), 6_000);
    const { run, stats, enteredBy } = contenders(root, 400);
    const aRename = pauseAt("rename", isGuard, 1);
    const bRename = pauseAt("rename", isGuard, 2);
    const aLockStep = pauseAt(["rm", "rename"], isLock, 1); // a holds its guard, about to remove the stale lock
    const bLink = pauseAt("link", isGuard, 1); // b restoring a's captured guard; the guard path is empty

    const a = run("a");
    await aRename.reached;
    const b = run("b");
    await bRename.reached;
    aRename.go();
    await aLockStep.reached;
    bRename.go();
    await bLink.reached;
    const c = run("c");
    await waitFor(() => enteredBy.includes("c"), "c to enter");
    bLink.go();
    aLockStep.go(); // a's removal of the stale lock must not take c's live lock
    const results = await Promise.all([a, b, c]);

    expect(stats().maxInside).toBe(1);
    expect(enteredBy).toEqual(["c"]);
    expect(results.map((result) => result.ok)).toEqual([false, false, true]);
    expect(await lockFamilyLeft(rootPath)).toEqual([]);
  }, 15_000);

  it("REL-NODE-009 AC-6 (M1, slow restore): the owner of a captured guard waits for its restore, so a guard put back after the owner's release is still removed", async () => {
    // Found under load in the full suite: b's link that puts a's captured guard back can complete after
    // a has already looked for its guard to release it, found the path empty and returned. The guard
    // then sat at the path with no owner until its TTL, and c's release could not take the guard, so
    // c's lock stayed too. Here b's restore is held 300 ms past a's release, deterministically.
    const rootPath = await copyFixtureWorkspace("valid-basic");
    const root = await resolveProjectRoot(rootPath);
    await plant(rootPath, GUARD, "", 6_000);
    await plant(rootPath, LOCK, staleLock(), 6_000);
    const { run, stats, enteredBy } = contenders(root, 400);
    const aRename = pauseAt("rename", isGuard, 1);
    const bRename = pauseAt("rename", isGuard, 2);
    const aLockStep = pauseAt(["rm", "rename"], isLock, 1);
    const bLink = pauseAt("link", isGuard, 1);

    const a = run("a");
    await aRename.reached;
    const b = run("b");
    await bRename.reached;
    aRename.go();
    await aLockStep.reached;
    bRename.go();
    await bLink.reached;
    const c = run("c");
    await waitFor(() => enteredBy.includes("c"), "c to enter");
    aLockStep.go(); // a is refused (c holds the lock) and releases its guard while b still holds it captured
    setTimeout(() => bLink.go(), 300);
    const results = await Promise.all([a, b, c]);

    expect(stats().maxInside).toBe(1);
    expect(results.map((result) => result.ok)).toEqual([false, false, true]);
    expect(results[2]?.diagnostics.map((item) => item.code), "c released its own lock").not.toContain("SRS-W076");
    expect(await lockFamilyLeft(rootPath)).toEqual([]);
  }, 15_000);

  it("REL-NODE-009 AC-6 (M2): a restore that meets EEXIST backs off and retries, so the captured guard is back once the path frees", async () => {
    const rootPath = await copyFixtureWorkspace("valid-basic");
    const root = await resolveProjectRoot(rootPath);
    await plant(rootPath, GUARD, "", 6_000);
    const { run, stats } = contenders(root, 50);
    const aRename = pauseAt("rename", isGuard, 1);
    const bRename = pauseAt("rename", isGuard, 2);
    const aLockOpen = pauseAt("open", isLock, 1); // a holds its written guard and is about to create the lock
    const bLink = pauseAt("link", isGuard, 1);
    const cGuardRelease = pauseAt("rename", (file) => /kiwi\/\.srs\.lock\.guard\.quarantine-/.test(file) === false && isGuard(file), 3); // c's guard removal
    const cGuardRm = pauseAt("rm", isGuard, 1);

    const a = run("a");
    await aRename.reached;
    const b = run("b");
    await bRename.reached;
    aRename.go();
    await aLockOpen.reached;
    const aGuard = await readFile(path.join(rootPath, GUARD), "utf8");
    bRename.go(); // b captures a's guard and goes to restore it
    await bLink.reached;
    const c = run("c"); // c takes the empty guard path and holds it while b's link runs
    await Promise.race([cGuardRelease.reached, cGuardRm.reached]);
    bLink.go(); // EEXIST against c's guard
    await new Promise((resolve) => setTimeout(resolve, 100));
    cGuardRelease.go();
    cGuardRm.go();
    const bResult = await b;
    expect(bResult.ok).toBe(false);
    expect(await readFile(path.join(rootPath, GUARD), "utf8"), "a's captured guard is back at the guard path").toBe(aGuard);
    aLockOpen.go();
    const results = [await a, bResult, await c];

    expect(stats().maxInside).toBe(1);
    expect(proceeded(results)).toBeGreaterThanOrEqual(1);
    expect(fsFaults.calls.filter((call) => call.op === "link" && isGuard(call.path)).length, "b retried the link").toBeGreaterThanOrEqual(2);
    expect(await lockFamilyLeft(rootPath)).toEqual([]);
  }, 15_000);
});

/**
 * Stress-tagged: two real processes, 1000 iterations each, through a bundle of the source lock. It
 * is there to catch orders the hook does not name and is not offered as proof. Run with
 * SPECKIWI_STRESS=1.
 */
describe.skipIf(!process.env.SPECKIWI_STRESS)("REL-NODE-009 AC-6 — two-process smoke [stress]", () => {
  it("REL-NODE-009 AC-6: two processes x 1000 mutations never enter the mutation together", async () => {
    const { bundleSrsLock, WORKER_SOURCE } = await import("../../support/srs-lock-load.js");
    const dir = await mkdtemp(path.join(tmpdir(), "speckiwi-srs-lock-smoke-"));
    try {
      const bundle = await bundleSrsLock(dir);
      const worker = path.join(dir, "worker.mjs");
      await writeFile(worker, WORKER_SOURCE, "utf8");
      const marker = path.join(dir, "inside");
      const outputs = await Promise.all(
        [0, 1].map(
          () =>
            new Promise<string>((resolve) => {
              const child = spawn(process.execPath, [worker, bundle, dir, "1000", "60000", marker], { stdio: ["ignore", "pipe", "inherit"] });
              let out = "";
              child.stdout.on("data", (chunk) => (out += chunk));
              child.on("exit", () => resolve(out.trim()));
            })
        )
      );
      for (const line of outputs) {
        const stats = JSON.parse(line) as { ok: number; overlaps: number; threw: number };
        expect(stats.ok).toBe(1000);
        expect(stats.overlaps).toBe(0);
        expect(stats.threw).toBe(0);
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 600_000);
});
