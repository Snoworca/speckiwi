import { mkdir, readdir, readFile, stat, utimes, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { withSrsMutationLock } from "../../../src/core/mutation/srs-lock.js";
import { resolveProjectRoot } from "../../../src/core/project-root.js";
import type { MutationResult } from "../../../src/core/types.js";
import { copyFixtureWorkspace } from "../../fixtures/fixture-utils.js";
import { fsFaults, isGuard, isLock, pauseAt, resetFsFaults, type StatsOverride } from "../../support/srs-lock-fs-faults.js";

vi.mock("node:fs/promises", async (original) => {
  const { wrapFsPromises } = await import("../../support/srs-lock-fs-faults.js");
  return wrapFsPromises(await original());
});

/**
 * @req REL-NODE-010 — a quarantined file is the judged one only when more than its inode number says
 * so. Linux ext4 gives a new file the inode number just freed (195 to 200 of 200 tries in probes),
 * so two files that are not the same can share `dev` + `ino`. Here that sharing is forced through
 * `lstat`, so the case is deterministic on every platform rather than on the ones that reuse numbers.
 */

const LOCK = path.join("kiwi", ".srs.lock");
const GUARD = path.join("kiwi", ".srs.lock.guard");
const isGuardQuarantine = (file: string): boolean => /kiwi\/\.srs\.lock\.guard\.quarantine-[^/]*$/.test(file);

afterEach(() => resetFsFaults());

function ok(): MutationResult<{ written: boolean }> {
  return { ok: true, value: { written: false }, diagnostics: [], diagnosticsSummary: { errors: 0, warnings: 0, byCode: {} } };
}

function expiredValidGuard(): string {
  const now = Date.now();
  return `${JSON.stringify({
    schemaVersion: "1.0.0",
    owner: "foreign-host:1",
    operation: "foreign",
    requestId: "foreign-request",
    acquiredAt: new Date(now - 120_000).toISOString(),
    expiresAt: new Date(now - 60_000).toISOString()
  })}\n`;
}

async function plant(rootPath: string, relative: string, content: string, ageMs: number): Promise<void> {
  const file = path.join(rootPath, relative);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, content, "utf8");
  const when = new Date(Date.now() - ageMs);
  await utimes(file, when, when);
}

async function exists(file: string): Promise<boolean> {
  return stat(file).then(() => true, () => false);
}

/**
 * Makes the second guard quarantine of the run — b's capture of a's fresh guard; the first is a's
 * capture of the stale guard itself — report the identity of the stale guard both contenders judged,
 * which is the first guard `lstat` of the run. `fields` names which parts of that identity carry
 * over. Later quarantines (the releases) report their own identity.
 */
function reuseJudgedIdentity(fields: ReadonlyArray<keyof StatsOverride>): { rewrites: () => number } {
  let judged: StatsOverride | undefined;
  let quarantines = 0;
  let rewrites = 0;
  fsFaults.lstatRewrites.push((file, stats) => {
    if (judged === undefined && isGuard(file)) {
      judged = Object.fromEntries(fields.map((field) => [field, stats[field] as bigint | number]));
      return undefined;
    }
    if (judged !== undefined && isGuardQuarantine(file) && ++quarantines === 2) {
      rewrites += 1;
      return judged;
    }
    return undefined;
  });
  return { rewrites: () => rewrites };
}

async function secondCapturesFirstsFreshGuard(content: string, fields: ReadonlyArray<keyof StatsOverride>) {
  const rootPath = await copyFixtureWorkspace("valid-basic");
  const root = await resolveProjectRoot(rootPath);
  await plant(rootPath, GUARD, content, 6_000);
  const reuse = reuseJudgedIdentity(fields);
  const first = pauseAt("rename", isGuard, 1);
  const second = pauseAt("rename", isGuard, 2);
  const aHoldsGuard = pauseAt("open", isLock, 1); // a has written its fresh guard, about to create the lock
  let inside = 0;
  let maxInside = 0;
  const entered: string[] = [];
  const run = (who: string) =>
    withSrsMutationLock(root, { operation: who }, async () => {
      inside += 1;
      entered.push(who);
      maxInside = Math.max(maxInside, inside);
      await new Promise((resolve) => setTimeout(resolve, 20));
      inside -= 1;
      return ok();
    });

  const a = run("a");
  await first.reached;
  const b = run("b");
  await second.reached;
  first.go();
  await aHoldsGuard.reached;
  const freshGuard = await readFile(path.join(rootPath, GUARD), "utf8");
  second.go(); // b quarantines a's fresh guard, which now reports the stale guard's identity
  const bResult = await b;
  const guardAfterB = await readFile(path.join(rootPath, GUARD), "utf8").catch(() => null);
  aHoldsGuard.go();
  const aResult = await a;
  const left = (await readdir(path.join(rootPath, "kiwi"))).filter((name) => name.startsWith(".srs.lock"));
  return { rootPath, freshGuard, guardAfterB, aResult, bResult, entered, maxInside, left, rewrites: reuse.rewrites() };
}

describe("REL-NODE-010 — a successor reusing the judged file's inode number is not taken for it", () => {
  it("REL-NODE-010 AC-1: a fresh guard that reports the torn guard's dev and ino is restored, and the second contender is refused", async () => {
    const outcome = await secondCapturesFirstsFreshGuard("", ["dev", "ino"]);

    expect(outcome.rewrites, "b's quarantine must have reported the reused identity").toBeGreaterThan(0);
    expect(outcome.guardAfterB, "the captured fresh guard is back at its path, bytes unchanged").toBe(outcome.freshGuard);
    expect(outcome.bResult.ok).toBe(false);
    expect(outcome.aResult.ok).toBe(true);
    expect(outcome.entered).toEqual(["a"]);
    expect(outcome.maxInside).toBe(1);
    expect(outcome.left, "a's release still found and removed its restored guard").toEqual([]);
    expect(await exists(path.join(outcome.rootPath, LOCK))).toBe(false);
  });

  it("REL-NODE-010 AC-2: a fresh guard that reports the expired guard's dev, ino and mtime is told apart by its bytes", async () => {
    const outcome = await secondCapturesFirstsFreshGuard(expiredValidGuard(), ["dev", "ino", "mtimeMs", "mtimeNs"]);

    expect(outcome.rewrites, "b's quarantine must have reported the reused identity").toBeGreaterThan(0);
    expect(outcome.guardAfterB, "the captured fresh guard is back at its path, bytes unchanged").toBe(outcome.freshGuard);
    expect(outcome.bResult.ok).toBe(false);
    expect(outcome.aResult.ok).toBe(true);
    expect(outcome.entered).toEqual(["a"]);
    expect(outcome.maxInside).toBe(1);
    expect(outcome.left).toEqual([]);
  });
});
