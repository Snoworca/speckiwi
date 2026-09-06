import { mkdir, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { resolveProjectRoot } from "../../../src/core/project-root.js";
import { addRequirement } from "../../../src/core/mutation/add-requirement.js";
import { updateStatus } from "../../../src/core/mutation/update-status.js";
import { withSrsMutationLock } from "../../../src/core/mutation/srs-lock.js";
import { refreshSrsStatusCache, readSrsStatusCache } from "../../../src/core/status-cache.js";
import { parseWorkspace } from "../../../src/core/parser/workspace-parser.js";
import { copyFixtureWorkspace } from "../../fixtures/fixture-utils.js";

function addRequirementInput(title: string) {
  return {
    type: "functional" as const,
    scope: "ARCH",
    target: "v1.0.0",
    title,
    statement: `${title} statement.`,
    acceptanceCriteria: [`${title} criterion.`],
    stability: "stable" as const
  };
}

async function writeLock(root: string, overrides: Record<string, unknown> = {}): Promise<void> {
  await mkdir(path.join(root, "kiwi"), { recursive: true });
  const now = Date.now();
  await writeFile(
    path.join(root, "kiwi", ".srs.lock"),
    `${JSON.stringify(
      {
        schemaVersion: "1.0.0",
        owner: "test-owner",
        operation: "test-operation",
        requestId: "test-request",
        acquiredAt: new Date(now).toISOString(),
        expiresAt: new Date(now + 60_000).toISOString(),
        ...overrides
      },
      null,
      2
    )}\n`,
    "utf8"
  );
}

function okMutationResult(written = false) {
  return {
    ok: true as const,
    value: { written },
    diagnostics: [],
    diagnosticsSummary: { errors: 0, warnings: 0, byCode: {} }
  };
}

/**
 * @req REL-NODE-008 — the per-test budget is raised off the 5000ms default, which is itself a fixed
 * wall-clock number deciding this file's colour.
 *
 * Every case here copies a fixture workspace, then acquires a lock that costs twenty filesystem
 * round trips and a whole-workspace parse. Measured under forty concurrent loaders: four of the
 * seven cases were reported as `Test timed out in 5000ms`, including the two FR-NODE-027 cases that
 * assert nothing about concurrency at all. Raising the ceiling removes no assertion — every check in
 * the file still runs and still has to pass; what it removes is the machine's load deciding whether
 * they get to run. A case that genuinely hangs is still caught, by its own labelled `waitFor` below
 * and by this ceiling behind it.
 */
vi.setConfig({ testTimeout: 30_000 });

async function delay(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    delay(ms).then(() => {
      throw new Error(`${label} timed out after ${ms}ms`);
    })
  ]);
}

describe("SRS mutation lock and status cache", () => {
  it("REL-NODE-005 denies active locks, recovers stale locks, and preserves ignoreLock safety diagnostics", async () => {
    const rootPath = await copyFixtureWorkspace("mutation-target");
    const root = await resolveProjectRoot(rootPath);
    const specPath = path.join(rootPath, "docs", "spec", "10.product-architecture.srs.md");
    const before = await readFile(specPath, "utf8");

    await writeLock(rootPath);
    const denied = await updateStatus(root, { id: "FR-ARCH-001", status: "blocked" });
    expect(denied).toMatchObject({
      ok: false,
      error: {
        code: "SRS_LOCKED",
        lock: {
          owner: "test-owner",
          operation: "test-operation",
          requestId: "test-request",
          retry: expect.objectContaining({ recommendedDelayMs: expect.any(Number) })
        }
      },
      diagnostics: [expect.objectContaining({ code: "SRS-E065" })]
    });
    await expect(readFile(specPath, "utf8")).resolves.toBe(before);

    const dryRunDenied = await updateStatus(root, { id: "FR-ARCH-001", status: "blocked", dryRun: true });
    expect(dryRunDenied).toMatchObject({ ok: false, error: { code: "SRS_LOCKED" } });
    await expect(readFile(specPath, "utf8")).resolves.toBe(before);

    const ignored = await updateStatus(root, { id: "FR-ARCH-001", status: "blocked", ignoreLock: true });
    expect(ignored).toMatchObject({
      ok: true,
      diagnostics: expect.arrayContaining([expect.objectContaining({ code: "SRS-W067" })])
    });
    await expect(readFile(specPath, "utf8")).resolves.toContain("| Status | blocked |");

    await writeLock(rootPath, {
      acquiredAt: new Date(Date.now() - 120_000).toISOString(),
      expiresAt: new Date(Date.now() - 60_000).toISOString()
    });
    const recovered = await updateStatus(root, { id: "FR-ARCH-001", status: "planned" });
    expect(recovered).toMatchObject({
      ok: true,
      diagnostics: expect.arrayContaining([expect.objectContaining({ code: "SRS-W068" })])
    });
    await expect(rm(path.join(rootPath, "kiwi", ".srs.lock"))).rejects.toMatchObject({ code: "ENOENT" });

    const cache = await readSrsStatusCache(root);
    expect(cache.ok).toBe(true);
    if (cache.ok) expect(cache.value.lock.active).toBe(false);
  });

  it("REL-NODE-005 rejects symlink locks before writing", async (ctx) => {
    const rootPath = await copyFixtureWorkspace("mutation-target");
    const root = await resolveProjectRoot(rootPath);
    await mkdir(path.join(rootPath, "kiwi"), { recursive: true });
    await writeFile(path.join(rootPath, "kiwi", "outside-lock.json"), "{}", "utf8");
    try {
      await symlink("outside-lock.json", path.join(rootPath, "kiwi", ".srs.lock"));
    } catch {
      // Windows without symlink privilege cannot create the symlink fixture; the source's
      // symlink-lock rejection (SRS-E065) is verified on POSIX/CI. Skip where unsupported.
      ctx.skip();
      return;
    }

    const result = await updateStatus(root, { id: "FR-ARCH-001", status: "blocked" });
    expect(result).toMatchObject({
      ok: false,
      error: { code: "SRS_LOCKED" },
      diagnostics: [expect.objectContaining({ code: "SRS-E065", details: expect.objectContaining({ kind: "symlink-lock" }) })]
    });
  });

  it("REL-NODE-005 permits only one concurrent lock winner", async () => {
    const rootPath = await copyFixtureWorkspace("mutation-target");
    const root = await resolveProjectRoot(rootPath);
    let entered = 0;
    let finishWinner!: () => void;
    let signalFirstEntry!: () => void;
    const firstEntry = new Promise<void>((resolve) => {
      signalFirstEntry = resolve;
    });

    const attempts = Array.from({ length: 5 }, () =>
      withSrsMutationLock(root, { operation: "race-winner" }, async () => {
        entered += 1;
        if (entered === 1) signalFirstEntry();
        await new Promise<void>((resolve) => {
          finishWinner = resolve;
        });
        return okMutationResult(true);
      })
    );

    // 10s rather than 1s, matching the case below. @req REL-NODE-008 — this wait was already the
    // right shape, but its ceiling was a wall-clock number small enough to decide the colour: with
    // five attempts contending under load, `lock winner entry timed out after 1000ms` was the most
    // frequent failure in the file. The ceiling is a hang detector, not a performance assertion.
    await waitFor(firstEntry, 10_000, "lock winner entry");
    expect(entered).toBe(1);
    finishWinner();
    const results = await Promise.all(attempts);
    expect(results.filter((result) => result.ok).length).toBe(1);
    expect(results.filter((result) => !result.ok && result.error.code === "SRS_LOCKED").length).toBe(4);
  });

  it("REL-NODE-005 keeps read-only parsing available while an SRS lock is active", async () => {
    const rootPath = await copyFixtureWorkspace("mutation-target");
    const root = await resolveProjectRoot(rootPath);
    await writeLock(rootPath);

    const cache = await readSrsStatusCache(root);
    expect(cache.ok).toBe(false);
    await expect(parseWorkspace(root)).resolves.toMatchObject({
      records: expect.arrayContaining([expect.objectContaining({ id: "FR-ARCH-001" })])
    });
  });

  /**
   * @req REL-NODE-008 — this case waits for each holder to say it is inside the critical section.
   *
   * It used to sleep 30ms in each of those two places. Under forty concurrent loaders the first
   * holder needed 32-47ms to get there in eleven of twelve runs and the flag below was false in all
   * twelve, because most of the acquisition budget is spent outside the lock: the guard is returned
   * at about 40ms and `mutate()` is not entered until about 82ms, the difference being the status
   * cache refresh `withSrsMutationLock` awaits first. Waiting on the entry signal also closes the
   * other way the sleep could lose - being inside `mutate()` means the guard is already returned, so
   * the second acquirer cannot be refused for a guard conflict at that moment.
   *
   * `ttlMs: 5` stays. The subject here is the ownership check on the release path; the stale reclaim
   * is what produces that situation, so raising the lease would remove the situation rather than
   * stabilise it.
   */
  it("REL-NODE-005 does not let an expired holder release a newer recovered lock", async () => {
    const rootPath = await copyFixtureWorkspace("mutation-target");
    const root = await resolveProjectRoot(rootPath);
    let finishFirst!: () => void;
    let finishSecond!: () => void;
    let secondEntered = false;
    let signalFirstEntry!: () => void;
    let signalSecondEntry!: () => void;
    const firstEntry = new Promise<void>((resolve) => {
      signalFirstEntry = resolve;
    });
    const secondEntry = new Promise<void>((resolve) => {
      signalSecondEntry = resolve;
    });

    const first = withSrsMutationLock(root, { operation: "slow-first", ttlMs: 5 }, async () => {
      const held = new Promise<void>((resolve) => {
        finishFirst = resolve;
      });
      signalFirstEntry();
      await held;
      return okMutationResult(true);
    });

    await waitFor(firstEntry, 10_000, "expired holder critical-section entry");

    const second = withSrsMutationLock(root, { operation: "second-after-stale", ttlMs: 60_000 }, async () => {
      const held = new Promise<void>((resolve) => {
        finishSecond = resolve;
      });
      secondEntered = true;
      signalSecondEntry();
      await held;
      return okMutationResult(true);
    });

    await waitFor(secondEntry, 10_000, "stale-reclaiming holder critical-section entry");
    expect(secondEntered).toBe(true);

    finishFirst();
    const firstResult = await first;
    expect(firstResult).toMatchObject({ ok: true });

    const activeLock = JSON.parse(await readFile(path.join(rootPath, "kiwi", ".srs.lock"), "utf8")) as { operation?: string };
    expect(activeLock.operation).toBe("second-after-stale");

    finishSecond();
    const secondResult = await second;
    expect(secondResult).toMatchObject({
      ok: true,
      diagnostics: expect.arrayContaining([expect.objectContaining({ code: "SRS-W068" })])
    });
    await expect(readFile(path.join(rootPath, "kiwi", ".srs.lock"), "utf8")).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("FR-NODE-027 writes and uses derived ID counters while falling back safely", async () => {
    const rootPath = await copyFixtureWorkspace("mutation-target");
    const root = await resolveProjectRoot(rootPath);

    const initial = await addRequirement(root, addRequirementInput("Cache bootstrap"));
    expect(initial).toMatchObject({ ok: true, value: { requirementId: "FR-ARCH-002" } });

    const cache = await readSrsStatusCache(root);
    expect(cache).toMatchObject({
      ok: true,
      value: {
        schemaVersion: "1.0.0",
        source: "speckiwi",
        idCounters: { functional: { ARCH: 2 } },
        lock: { active: false }
      }
    });

    if (!cache.ok) return;
    await writeFile(
      path.join(rootPath, "kiwi", ".status.json"),
      `${JSON.stringify({ ...cache.value, idCounters: { ...cache.value.idCounters, functional: { ARCH: 42 } } }, null, 2)}\n`,
      "utf8"
    );
    const cached = await addRequirement(root, { ...addRequirementInput("Cache allocated"), dryRun: true });
    expect(cached).toMatchObject({
      ok: true,
      value: { requirementId: "FR-ARCH-043", written: false },
      diagnostics: []
    });

    await writeFile(path.join(rootPath, "kiwi", ".status.json"), "{ malformed", "utf8");
    const malformedFallback = await addRequirement(root, { ...addRequirementInput("Malformed fallback"), dryRun: true });
    expect(malformedFallback).toMatchObject({
      ok: true,
      value: { requirementId: "FR-ARCH-003" },
      diagnostics: expect.arrayContaining([expect.objectContaining({ code: "SRS-W065" })])
    });

    await writeFile(
      path.join(rootPath, "kiwi", ".status.json"),
      `${JSON.stringify({ ...cache.value, idCounters: { unknown: { ARCH: 42 } } }, null, 2)}\n`,
      "utf8"
    );
    const unsafePrefixFallback = await addRequirement(root, { ...addRequirementInput("Unsafe prefix fallback"), dryRun: true });
    expect(unsafePrefixFallback).toMatchObject({
      ok: true,
      value: { requirementId: "FR-ARCH-003" },
      diagnostics: expect.arrayContaining([expect.objectContaining({ code: "SRS-W065" })])
    });

    const regenerated = await refreshSrsStatusCache(root);
    expect(regenerated.ok).toBe(true);
    if (!regenerated.ok) return;
    await writeFile(
      path.join(rootPath, "kiwi", ".status.json"),
      `${JSON.stringify({ ...regenerated.value, idCounters: { ...regenerated.value.idCounters, functional: { ARCH: 0 } } }, null, 2)}\n`,
      "utf8"
    );
    const collisionFallback = await addRequirement(root, { ...addRequirementInput("Collision fallback"), dryRun: true });
    expect(collisionFallback).toMatchObject({
      ok: true,
      value: { requirementId: "FR-ARCH-003" },
      diagnostics: expect.arrayContaining([expect.objectContaining({ code: "SRS-W065" })])
    });

    const stale = await refreshSrsStatusCache(root);
    expect(stale.ok).toBe(true);
    await writeFile(path.join(rootPath, "docs", "spec", "10.product-architecture.srs.md"), `${await readFile(path.join(rootPath, "docs", "spec", "10.product-architecture.srs.md"), "utf8")}\n<!-- cache stale marker -->\n`, "utf8");
    const staleFallback = await addRequirement(root, { ...addRequirementInput("Stale fingerprint fallback"), dryRun: true });
    expect(staleFallback).toMatchObject({
      ok: true,
      value: { requirementId: "FR-ARCH-003" },
      diagnostics: expect.arrayContaining([expect.objectContaining({ code: "SRS-W065" })])
    });

    const kiwiFiles = await readdir(path.join(rootPath, "kiwi"));
    expect(kiwiFiles.filter((file) => file.endsWith(".tmp"))).toEqual([]);
  });

  it("FR-NODE-027 returns success with cache warning when cache regeneration fails after an SRS write", async () => {
    const rootPath = await copyFixtureWorkspace("mutation-target");
    const root = await resolveProjectRoot(rootPath);
    await mkdir(path.join(rootPath, "kiwi", ".status.json"), { recursive: true });

    const result = await addRequirement(root, addRequirementInput("Cache warning"));

    expect(result).toMatchObject({
      ok: true,
      value: { requirementId: "FR-ARCH-002", written: true },
      diagnostics: expect.arrayContaining([expect.objectContaining({ code: "SRS-W066" })])
    });
    await expect(readFile(path.join(rootPath, "docs", "spec", "10.product-architecture.srs.md"), "utf8")).resolves.toContain("### FR-ARCH-002 — Cache warning");
  });
});
