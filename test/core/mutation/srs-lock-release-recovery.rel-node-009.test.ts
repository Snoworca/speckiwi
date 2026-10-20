import { mkdir, readFile, rm, stat, utimes, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { addRequirement } from "../../../src/core/mutation/add-requirement.js";
import { withSrsMutationLock } from "../../../src/core/mutation/srs-lock.js";
import { resolveProjectRoot } from "../../../src/core/project-root.js";
import type { MutationResult } from "../../../src/core/types.js";
import { copyFixtureWorkspace } from "../../fixtures/fixture-utils.js";
import { fsFaults, isGuard, isLock, resetFsFaults, type FaultOp } from "../../support/srs-lock-fs-faults.js";

/** The lock file or one of its quarantine names: since review r1 M1 the lock is removed by renaming it aside and deleting that name. */
const isLockRemoval = (file: string): boolean => /kiwi\/\.srs\.lock(\.quarantine-[^/]*)?$/.test(file);

vi.mock("node:fs/promises", async (original) => {
  const { wrapFsPromises } = await import("../../support/srs-lock-fs-faults.js");
  return wrapFsPromises(await original());
});

/**
 * REL-NODE-009 — the SRS mutation lock does not outlive its mutation, never misreports a committed
 * write, and never stalls on a file that names no holder. Faults are injected through the wrapped
 * `node:fs/promises` (test/support/srs-lock-fs-faults.ts); nothing here depends on timing races.
 */

const LOCK = path.join("kiwi", ".srs.lock");
const GUARD = path.join("kiwi", ".srs.lock.guard");
const PHRASE_BUSY = "another process may be deleting the lock file; if this persists, check permissions on kiwi/";

afterEach(() => resetFsFaults());

function ok(written = false): MutationResult<{ written: boolean }> {
  return { ok: true, value: { written }, diagnostics: [], diagnosticsSummary: { errors: 0, warnings: 0, byCode: {} } };
}

function codes(result: MutationResult<unknown>): string[] {
  return result.diagnostics.map((item) => item.code);
}

async function exists(file: string): Promise<boolean> {
  return stat(file).then(() => true, () => false);
}

function lockMetadata(overrides: Record<string, unknown> = {}): string {
  const now = Date.now();
  return `${JSON.stringify({
    schemaVersion: "1.0.0",
    owner: "foreign-host:1",
    operation: "foreign",
    requestId: "foreign-request",
    acquiredAt: new Date(now).toISOString(),
    expiresAt: new Date(now + 30_000).toISOString(),
    ...overrides
  })}\n`;
}

async function writeKiwi(rootPath: string, relative: string, content: string, ageMs = 0): Promise<string> {
  const file = path.join(rootPath, relative);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, content, "utf8");
  if (ageMs > 0) {
    const when = new Date(Date.now() - ageMs);
    await utimes(file, when, when);
  }
  return file;
}

async function workspace() {
  const rootPath = await copyFixtureWorkspace("valid-basic");
  return { rootPath, root: await resolveProjectRoot(rootPath) };
}

function lockError(result: MutationResult<unknown>) {
  return result.error as { code: string; message: string; lock?: { retry?: { recommendedDelayMs?: number } } } | undefined;
}

function detail(result: MutationResult<unknown>): Record<string, unknown> {
  return ((result.error?.diagnostics?.[0] as { details?: Record<string, unknown> } | undefined)?.details ?? {}) as Record<string, unknown>;
}

describe("REL-NODE-009 AC-1 — a guard that is busy for a moment at release does not leave the lock", () => {
  it("REL-NODE-009 AC-1: a foreign guard removed 100 ms after the mutation still lets the lock go", async () => {
    const { rootPath, root } = await workspace();
    const result = await withSrsMutationLock(root, { operation: "ac1" }, async () => {
      const guard = await writeKiwi(rootPath, GUARD, lockMetadata());
      setTimeout(() => void rm(guard, { force: true }), 100);
      return ok();
    });
    expect(result.ok).toBe(true);
    expect(await exists(path.join(rootPath, LOCK))).toBe(false);

    const next = await withSrsMutationLock(root, { operation: "ac1-next" }, async () => ok());
    expect(next.ok).toBe(true);
    expect(codes(next)).not.toContain("SRS-W068");
  });
});

describe("REL-NODE-009 AC-2 — a failed read at release is retried", () => {
  it("REL-NODE-009 AC-2: one EPERM on the release-phase read of kiwi/.srs.lock is retried and the lock is removed", async () => {
    const { rootPath, root } = await workspace();
    const result = await withSrsMutationLock(root, { operation: "ac2" }, async () => {
      fsFaults.faults.push({ op: "readFile", match: isLock, code: "EPERM", times: 1 });
      return ok();
    });
    expect(result.ok).toBe(true);
    expect(fsFaults.calls.some((call) => call.op === "readFile" && call.failed === "EPERM")).toBe(true);
    expect(await exists(path.join(rootPath, LOCK))).toBe(false);
  });
});

describe("REL-NODE-009 AC-3 — the release outcome never changes the mutation's result", () => {
  function input(title: string) {
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

  /** Arms `arm` once the mutation has written docs/spec, so only release-phase operations see it. */
  function afterTheWrite(arm: () => Promise<void> | void): void {
    let armed = false;
    fsFaults.afterRename.push(async (_source, destination) => {
      if (armed || !destination.includes("docs/spec/")) return;
      armed = true;
      await arm();
    });
  }

  async function expectOwnResultWithLeftoverWarning(rootPath: string, run: () => Promise<MutationResult<unknown>>): Promise<void> {
    const result = await run();
    expect(result.ok, JSON.stringify(result.error)).toBe(true);
    expect(result.error?.code).not.toBe("SRS_LOCKED");
    expect((result.value as { requirementId?: string } | undefined)?.requirementId).toMatch(/^FR-ARCH-\d+$/);
    const leftover = result.diagnostics.filter((item) => item.code === "SRS-W076");
    expect(leftover).toHaveLength(1);
    expect(leftover[0]?.message).toContain("kiwi/.srs.lock");
    fsFaults.faults = []; // the injected fault is for the call under test, not for this check
    const lockFile = path.join(rootPath, LOCK);
    if (await exists(lockFile)) {
      const expiresAt = (JSON.parse(await readFile(lockFile, "utf8")) as { expiresAt: string }).expiresAt;
      expect(leftover[0]?.message).toContain(expiresAt);
    }
  }

  const cases: Array<{ label: string; op: FaultOp; match: (file: string) => boolean }> = [
    { label: "the guard open", op: "open", match: isGuard },
    { label: "the lock read", op: "readFile", match: isLock },
    { label: "the lock rm", op: "rm", match: isLockRemoval }
  ];
  for (const entry of cases) {
    for (const code of ["EPERM", "EBUSY"]) {
      it(`REL-NODE-009 AC-3: ${code} on ${entry.label} keeps add_requirement's own ok result, with one SRS-W076`, async () => {
        const { rootPath, root } = await workspace();
        afterTheWrite(() => {
          fsFaults.faults.push({ op: entry.op, match: entry.match, code, times: Infinity });
        });
        await expectOwnResultWithLeftoverWarning(rootPath, () => addRequirement(root, input(`AC3 ${code} ${entry.op}`)));
      }, 30_000);
    }
  }

  it("REL-NODE-009 AC-3: a guard held past the retry window keeps add_requirement's own ok result, with one SRS-W076", async () => {
    const { rootPath, root } = await workspace();
    afterTheWrite(async () => {
      await writeKiwi(rootPath, GUARD, lockMetadata());
    });
    const started = Date.now();
    await expectOwnResultWithLeftoverWarning(rootPath, () => addRequirement(root, input("AC3 held guard")));
    expect(Date.now() - started, "the retry window is at least 1 s").toBeGreaterThanOrEqual(1_000);
  }, 30_000);
});

describe("REL-NODE-009 AC-4 — a torn lock or guard is recovered after the 5 s grace, and only then", () => {
  for (const [label, relative] of [["kiwi/.srs.lock", LOCK], ["kiwi/.srs.lock.guard", GUARD]] as const) {
    for (const content of ["", "{\"schemaVersion\": \"1.0"]) {
      const shape = content === "" ? "0-byte" : "non-JSON";
      it(`REL-NODE-009 AC-4 / REL-NODE-005 AC-6: an aged ${shape} ${label} is recovered with SRS-W068`, async () => {
        const { rootPath, root } = await workspace();
        await writeKiwi(rootPath, relative, content, 6_000);
        const result = await withSrsMutationLock(root, { operation: "ac4-aged" }, async () => ok());
        expect(result.ok, JSON.stringify(result.error)).toBe(true);
        expect(codes(result)).toContain("SRS-W068");
        expect(await exists(path.join(rootPath, LOCK))).toBe(false);
      });

      it(`REL-NODE-009 AC-4: a current ${shape} ${label} is refused with a delay of at most 5000 ms`, async () => {
        const { rootPath, root } = await workspace();
        await writeKiwi(rootPath, relative, content);
        const result = await withSrsMutationLock(root, { operation: "ac4-young" }, async () => ok());
        expect(result.ok).toBe(false);
        expect(lockError(result)?.code).toBe("SRS_LOCKED");
        expect(lockError(result)?.message).toMatch(/empty or unreadable/);
        const delay = lockError(result)?.lock?.retry?.recommendedDelayMs ?? Infinity;
        expect(delay).toBeLessThanOrEqual(5_000);
        expect(await readFile(path.join(rootPath, relative), "utf8")).toBe(content);
      });
    }
  }
});

describe("REL-NODE-009 AC-5 — a parseable lock of an unknown format is never taken over", () => {
  const variants: Array<{ label: string; content: string; version: string }> = [
    { label: "another schemaVersion", content: lockMetadata({ schemaVersion: "2.0.0" }), version: "2.0.0" },
    { label: "missing required fields", content: `${JSON.stringify({ schemaVersion: "1.0.0", owner: "x" })}\n`, version: "1.0.0" }
  ];
  for (const variant of variants) {
    for (const ageMs of [0, 600_000]) {
      it(`REL-NODE-009 AC-5 / REL-NODE-005 AC-6: ${variant.label}, ${ageMs === 0 ? "fresh" : "ten minutes old"}, is refused as unknown-lock-format`, async () => {
        const { rootPath, root } = await workspace();
        await writeKiwi(rootPath, LOCK, variant.content, ageMs);
        const result = await withSrsMutationLock(root, { operation: "ac5" }, async () => ok());
        expect(result.ok).toBe(false);
        expect(lockError(result)?.code).toBe("SRS_LOCKED");
        expect(detail(result).kind).toBe("unknown-lock-format");
        const message = lockError(result)?.message ?? "";
        expect(message).toContain(variant.version);
        expect(message).toMatch(/another SpecKiwi version may hold the lock/);
        expect(message).toMatch(/only when no other SpecKiwi process is running/);
        expect(await readFile(path.join(rootPath, LOCK), "utf8")).toBe(variant.content);
      });
    }
  }
});

describe("REL-NODE-009 AC-8 — a failed metadata write leaves no file behind", () => {
  for (const [label, match] of [["kiwi/.srs.lock", isLock], ["kiwi/.srs.lock.guard", isGuard]] as const) {
    it(`REL-NODE-009 AC-8: writing ${label} metadata fails after open(wx) and the file is removed`, async () => {
      const { rootPath, root } = await workspace();
      fsFaults.faults.push({ op: "handleWrite", match, code: "EIO", times: 1 });
      const mutate = vi.fn(async () => ok());
      const outcome = await withSrsMutationLock(root, { operation: "ac8" }, mutate).then(
        (result) => result,
        (error: unknown) => error
      );
      expect(mutate).not.toHaveBeenCalled();
      expect((outcome as { ok?: boolean }).ok).not.toBe(true);
      expect(await exists(path.join(rootPath, LOCK))).toBe(false);
      expect(await exists(path.join(rootPath, GUARD))).toBe(false);
    });
  }
});

describe("REL-NODE-009 AC-9 — EPERM/EBUSY while acquiring is retried, then answered as a held lock", () => {
  interface Scenario {
    label: string;
    op: FaultOp;
    match: (file: string) => boolean;
    setup: (rootPath: string) => Promise<void>;
  }
  const scenarios: Scenario[] = [
    { label: "open(wx) of the guard", op: "open", match: isGuard, setup: async () => undefined },
    {
      label: "read of an expired lock",
      op: "readFile",
      match: isLock,
      setup: async (rootPath) => void (await writeKiwi(rootPath, LOCK, lockMetadata({ expiresAt: new Date(Date.now() - 1_000).toISOString() })))
    },
    {
      label: "rm of an expired lock",
      op: "rm",
      match: isLockRemoval,
      setup: async (rootPath) => void (await writeKiwi(rootPath, LOCK, lockMetadata({ expiresAt: new Date(Date.now() - 1_000).toISOString() })))
    },
    { label: "rename of an aged torn guard", op: "rename", match: isGuard, setup: async (rootPath) => void (await writeKiwi(rootPath, GUARD, "", 6_000)) }
  ];

  for (const scenario of scenarios) {
    for (const code of ["EPERM", "EBUSY"]) {
      it(`REL-NODE-009 AC-9: ${code} on the ${scenario.label} that clears after two attempts lets the mutation proceed`, async () => {
        const { rootPath, root } = await workspace();
        await scenario.setup(rootPath);
        fsFaults.faults.push({ op: scenario.op, match: scenario.match, code, times: 2 });
        const result = await withSrsMutationLock(root, { operation: "ac9-clears" }, async () => ok());
        expect(result.ok, JSON.stringify(result.error)).toBe(true);
      });

      it(`REL-NODE-009 AC-9: a persistent ${code} on the ${scenario.label} is retried at least 3 times within 300 ms, then refused as lock-busy`, async () => {
        const { rootPath, root } = await workspace();
        await scenario.setup(rootPath);
        fsFaults.faults.push({ op: scenario.op, match: scenario.match, code, times: Infinity });
        const failedAt: number[] = [];
        const push = fsFaults.calls.push.bind(fsFaults.calls);
        fsFaults.calls.push = (...items) => {
          for (const item of items) if (item.failed === code && item.op === scenario.op) failedAt.push(Date.now());
          return push(...items);
        };
        const result = await withSrsMutationLock(root, { operation: "ac9-persists" }, async () => ok());
        expect(result.ok).toBe(false);
        expect(lockError(result)?.code).toBe("SRS_LOCKED");
        expect(detail(result)).toMatchObject({ kind: "lock-busy", errno: code });
        expect(lockError(result)?.message).toContain(PHRASE_BUSY);
        expect(lockError(result)?.lock?.retry?.recommendedDelayMs ?? Infinity).toBeLessThanOrEqual(1_000);
        expect(failedAt.length, "attempts").toBeGreaterThanOrEqual(4);
        expect((failedAt[3] ?? Infinity) - (failedAt[0] ?? 0), "first three retries within 300 ms").toBeLessThanOrEqual(300);
      });
    }
  }
});

describe("REL-NODE-009 AC-10 — a refusal caused by an active guard recommends at most 1000 ms", () => {
  it("REL-NODE-009 AC-10: an active foreign guard is refused with recommendedDelayMs <= 1000", async () => {
    const { rootPath, root } = await workspace();
    await writeKiwi(rootPath, GUARD, lockMetadata());
    const result = await withSrsMutationLock(root, { operation: "ac10" }, async () => ok());
    expect(lockError(result)?.code).toBe("SRS_LOCKED");
    expect(detail(result).kind).toBe("lock-guard-active");
    expect(lockError(result)?.lock?.retry?.recommendedDelayMs ?? Infinity).toBeLessThanOrEqual(1_000);
  });
});
