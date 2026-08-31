import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { mkdir, readFile, utimes, writeFile } from "node:fs/promises";
import path from "node:path";
import { PassThrough } from "node:stream";
import { afterAll, describe, expect, it } from "vitest";

import { main } from "../../../src/cli/index.js";
import {
  acquire,
  readHolder,
  release,
  resolveGitCommonDir,
  runLockPath,
  type RunLock
} from "../../../src/core/orchestrator/run-lock.js";
import { cleanupFixtures, commitAll, initRepo } from "./support/git-fixture.js";

/**
 * @req FR-NODE-204 — the run lock had no way to answer "is this lease mine".
 *
 * `kiwi-orchestrator` §3.1 instructs a run to release only the lease it took, because `unlock` drops
 * a live lease belonging to another run without refusing. A run that resumes after its own lease was
 * reclaimed cannot obey that instruction from `owner` alone: the CLI default is one constant string
 * for every run and the skill never passes `--owner`. What was missing was not a field in the read —
 * `status` already reports pid, host and acquiredAt — but the other half of the comparison: the
 * acquisition returned only a lock path, so a run had nothing of its own to compare against.
 */

const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..", "..");
const RUN_LOCK_MODULE = path.join(REPO_ROOT, "src", "core", "orchestrator", "run-lock.ts");
const CHILD_SCRIPT = path.join(import.meta.dirname, "support", "run-lock-acquire-and-exit.mjs");
const SRS_PATH = path.join(REPO_ROOT, "docs", "spec", "50.nodejs-implementation.srs.md");
const ORCHESTRATE_CLI = path.join(REPO_ROOT, "src", "cli", "commands", "orchestrate.ts");

/** The four renderings of the skill whose §3.1 carries the guard this requirement serves. */
const RENDERINGS = [
  "skills/claude/kiwi-orchestrator/SKILL.md",
  "skills/codex/kiwi-orchestrator/SKILL.md",
  "skills/etc/kiwi-orchestrator/SKILL.md",
  ".agents/skills/kiwi-orchestrator/SKILL.md"
] as const;

const held: RunLock[] = [];

afterAll(async () => {
  for (const lock of held.splice(0)) await release(lock).catch(() => undefined);
  await cleanupFixtures();
});

// ── the denominator, read from the requirement rather than written here ──────────────────────────

/**
 * How many fields the comparison must weigh, taken from AC-1's own `a·b·c·d` run.
 *
 * Written into this file the floor would be a number the suite could lower in the same edit that
 * narrows what it measures. Read from the requirement, narrowing the comparison costs a requirement
 * diff. @req FR-NODE-204 AC-1
 */
function acceptanceFloor(): readonly string[] {
  const block = readFileSync(SRS_PATH, "utf8");
  const start = block.indexOf("### FR-NODE-204 ");
  expect(start, "FR-NODE-204 is not in the scope document, so the floor below has no source").toBeGreaterThan(-1);
  const criterion = block.slice(start).split("\n").find((line) => line.startsWith("- [ ] AC-1:") || line.startsWith("- [x] AC-1:")) ?? "";
  const names = /([A-Za-z]+(?:·[A-Za-z]+)+)/.exec(criterion)?.[1]?.split("·") ?? [];
  expect(names.length, `AC-1 names no field run, so nothing bounds the comparison: ${criterion}`).toBeGreaterThan(1);
  return names;
}

const FLOOR = acceptanceFloor();

// ── the procedure §3.1 asks a run to follow ──────────────────────────────────────────────────────

/**
 * Is the lease `current` reports the one `recorded` named when it was taken?
 *
 * The field set comes from what the ACQUISITION returned, not from a list written here, so an
 * acquisition that names less is a comparison that weighs less and AC-2 goes red rather than the
 * suite quietly comparing fields the shipped response does not carry.
 */
function isOwnLease(recorded: Record<string, unknown> | null | undefined, current: Record<string, unknown> | null): boolean {
  if (recorded === null || recorded === undefined || current === null) return false;
  const fields = Object.keys(recorded);
  if (fields.length < FLOOR.length) return false;
  return fields.every((field) => current[field] === recorded[field]);
}

// ── fixtures ─────────────────────────────────────────────────────────────────────────────────────

async function repository(prefix: string): Promise<{ root: string; commonDir: string }> {
  const root = await initRepo(prefix);
  await writeFile(path.join(root, "README.md"), "# run lock lease identity\n", "utf8");
  await commitAll(root, "test: seed the repository");
  return { root, commonDir: await resolveGitCommonDir(root) };
}

/**
 * The sentinel the acquisition published, read back as bytes.
 *
 * The acquisition and the read share one projection, so a field frozen to a constant in that
 * projection stays equal on both sides and every same-shape assertion passes while the comparison
 * weighs one value fewer. The bytes on disk are the one side that projection did not write.
 * Measured: `acquiredAt` and `host` could each be replaced by a constant with the suite green.
 * @req FR-NODE-204 AC-1
 */
async function publishedSentinel(commonDir: string): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(runLockPath(commonDir), "utf8")) as Record<string, unknown>;
}

interface Envelope {
  readonly exit: number;
  readonly payload: Record<string, unknown>;
}

/** One CLI leaf, run in this process, so the source under test answers rather than a built copy. */
async function cli(root: string, args: readonly string[]): Promise<Envelope> {
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const exit = await main(["--root", root, "orchestrate", ...args, "--json"], { stdout, stderr } as never);
  const text = stdout.read()?.toString() ?? "";
  return { exit, payload: text.trim().length > 0 ? (JSON.parse(text) as Record<string, unknown>) : {} };
}

/** Spawns the child, waits for it to report AND to exit, and returns what its acquisition named. */
function acquireInDeadProcess(commonDir: string, owner: string): Promise<{ pid: number; holder: Record<string, unknown> | null }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [CHILD_SCRIPT, RUN_LOCK_MODULE, commonDir, owner], {
      cwd: REPO_ROOT,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"]
    });
    let out = "";
    let err = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => { out += chunk; });
    child.stderr.on("data", (chunk: string) => { err += chunk; });
    child.on("error", reject);
    // `close`, not `exit`: the parent must not acquire until the child's pid is gone, because the
    // reclamation this test is about is decided by that pid failing a liveness probe.
    child.on("close", (code) => {
      if (code !== 0 || out.trim().length === 0) {
        reject(new Error(`the acquiring child failed (code ${String(code)}): ${out}${err}`));
        return;
      }
      resolve(JSON.parse(out.trim()) as { pid: number; holder: Record<string, unknown> | null });
    });
  });
}

/** A sentinel whose bytes are not a record any reader can name a holder from. */
async function tornSentinel(commonDir: string): Promise<string> {
  const lockPath = runLockPath(commonDir);
  await mkdir(path.dirname(lockPath), { recursive: true });
  await writeFile(lockPath, "{ not a record\n", "utf8");
  // Dated into the future so `Date.now() - mtimeMs` clamps to 0 and the torn-sentinel grace is
  // ALWAYS unexpired. Wall-clock timing would otherwise decide whether the real `lock` refuses or
  // reclaims, and a criterion that names a refusal must not depend on how busy the machine is.
  const ahead = new Date(Date.now() + 60_000);
  await utimes(lockPath, ahead, ahead);
  return lockPath;
}

describe("FR-NODE-204 a run lock acquisition names the lease it took", { timeout: 120_000 }, () => {
  it("AC-1: the acquisition names the holder it published, and status reports the same one", async () => {
    const target = await repository("lease-identity-names");
    const lock = await acquire({ commonDir: target.commonDir, owner: "naming-run" });
    held.push(lock);

    const named = lock.holder as unknown as Record<string, unknown> | undefined;
    expect(named, "the acquisition returned no holder, so a run has nothing of its own to compare").toBeDefined();
    for (const field of FLOOR) {
      expect(Object.keys(named as Record<string, unknown>), `the acquisition does not name ${field}`).toContain(field);
    }

    const reported = await readHolder(target.commonDir);
    expect(reported, "the lock is held, so the read must name a holder").not.toBeNull();
    expect(named).toEqual({ ...(reported as unknown as Record<string, unknown>) });

    // Against the bytes, not only against the other side of the shared projection: agreeing with
    // itself is what a constant does too.
    const record = await publishedSentinel(target.commonDir);
    const holder = named as Record<string, unknown>;
    expect(holder.owner, "the named owner is not the one the sentinel carries").toBe(record.owner);
    expect(holder.pid, "the named pid is not the one the sentinel carries").toBe(record.pid);
    expect(holder.host, "the named host is not the one the sentinel carries").toBe(record.host);
    expect(holder.acquiredAt, "the named acquiredAt is not the sentinel's acquired_at").toBe(record.acquired_at);

    // The same must hold through the CLI, which is the surface the skill and the MCP bridge both use.
    const cliTarget = await repository("lease-identity-cli");
    const taken = await cli(cliTarget.root, ["run", "lock"]);
    expect(taken.exit, JSON.stringify(taken.payload)).toBe(0);
    const status = await cli(cliTarget.root, ["run", "status"]);
    expect(taken.payload.holder, "`run lock` returned no holder").toBeDefined();
    expect(taken.payload.holder).toEqual(status.payload.holder);
  });

  it("AC-1: a lease reclaimed from a stale sentinel is named the same way a fresh one is", async () => {
    const target = await repository("lease-identity-reclaim");
    const first = await acquireInDeadProcess(target.commonDir, "crashed-run");
    expect(first.holder, "the child's acquisition named no holder").not.toBeNull();

    // The child is gone, so this acquisition takes the reclaim-then-republish path rather than the
    // publish-onto-nothing path. Both must name what they published.
    const second = await acquire({ commonDir: target.commonDir, owner: "successor-run" });
    held.push(second);
    const named = second.holder as unknown as Record<string, unknown> | undefined;
    expect(named, "the reclaiming acquisition returned no holder").toBeDefined();
    expect(named).toEqual({ ...((await readHolder(target.commonDir)) as unknown as Record<string, unknown>) });
    expect((named as Record<string, unknown>).pid).toBe(process.pid);
    expect((first.holder as Record<string, unknown>).pid).toBe(first.pid);
  });

  it("AC-2: two runs over one lease decide oppositely, and the procedure is not always-false", async () => {
    const target = await repository("lease-identity-discriminate");
    const runA = await acquireInDeadProcess(target.commonDir, "run-a");

    // While A's lease still stands, the same procedure must call it A's. Without this the check
    // below is satisfied by a procedure that answers "not mine" to everything.
    const beforeReclaim = (await readHolder(target.commonDir)) as unknown as Record<string, unknown> | null;
    expect(isOwnLease(runA.holder, beforeReclaim), "A's own lease is not recognised as A's").toBe(true);

    const runB = await acquire({ commonDir: target.commonDir, owner: "run-b" });
    held.push(runB);
    const now = (await readHolder(target.commonDir)) as unknown as Record<string, unknown> | null;

    // One lease, one moment, two verdicts.
    expect(isOwnLease(runA.holder, now), "A must not recognise the successor's lease as its own").toBe(false);
    expect(isOwnLease(runB.holder as unknown as Record<string, unknown>, now), "B must recognise the lease it took").toBe(true);
  });

  it("AC-2: two leases one process takes in succession are told apart, which is the MCP path's shape", async () => {
    // The MCP bridge runs the CLI inside the server process, so both leases of a repository carry
    // that server's pid and host and the CLI's one default owner. Measured over 99 consecutive
    // pairs: 0 landed in the same millisecond, minimum gap 3 ms, so `acquiredAt` is the only field
    // separating them — and the suite was blind to it until this branch existed.
    const target = await repository("lease-identity-succession");
    let first: RunLock | null = null;
    let second: RunLock | null = null;
    // Bounded retry rather than a single pair: zero collisions measured is not zero possible, and a
    // suite that flakes on a clock tick teaches nothing.
    for (let attempt = 0; attempt < 8 && second === null; attempt += 1) {
      const earlier = await acquire({ commonDir: target.commonDir, owner: "kiwi-orchestrator" });
      await release(earlier);
      const later = await acquire({ commonDir: target.commonDir, owner: "kiwi-orchestrator" });
      if (earlier.holder.acquiredAt === later.holder.acquiredAt) {
        await release(later);
        continue;
      }
      first = earlier;
      second = later;
    }
    expect(second, "eight consecutive pairs all carried one timestamp, so nothing separates two leases of one process").not.toBeNull();
    held.push(second as RunLock);

    const earlierHolder = (first as RunLock).holder as unknown as Record<string, unknown>;
    const laterHolder = (second as RunLock).holder as unknown as Record<string, unknown>;
    const separating = FLOOR.filter((field) => earlierHolder[field] !== laterHolder[field]);
    expect(separating, "on this path the timestamp is the only separator, so a constant there is a blind comparison").toEqual(["acquiredAt"]);

    const now = (await readHolder(target.commonDir)) as unknown as Record<string, unknown> | null;
    expect(isOwnLease(laterHolder, now), "the later lease must be recognised as the later run's").toBe(true);
    expect(isOwnLease(earlierHolder, now), "the released lease must not be recognised in the one that replaced it").toBe(false);
  });

  it("AC-3: owner alone cannot separate the two runs, and neither the CLI nor the skill supplies one", async () => {
    const target = await repository("lease-identity-owner");
    const first = await acquireInDeadProcess(target.commonDir, "kiwi-orchestrator");
    const second = await acquire({ commonDir: target.commonDir, owner: "kiwi-orchestrator" });
    held.push(second);

    expect(first.holder, "neither acquisition named a holder, so there is no owner to collide").toBeTruthy();
    expect(second.holder as unknown, "neither acquisition named a holder, so there is no owner to collide").toBeTruthy();
    const firstOwner = (first.holder as Record<string, unknown>).owner;
    const secondOwner = (second.holder as unknown as Record<string, unknown>).owner;
    expect(firstOwner, "the premise of this requirement is that the two owners collide").toBe(secondOwner);
    expect(isOwnLease({ owner: firstOwner }, second.holder as unknown as Record<string, unknown>))
      .toBe(false);

    // Where that collision comes from: one default in the CLI, and a skill that never overrides it.
    const declaration = /\.option\("--owner <owner>",[^)]*?,\s*"([^"]+)"\)/.exec(readFileSync(ORCHESTRATE_CLI, "utf8"));
    expect(declaration, "`run lock` no longer declares a default owner; the premise moved").not.toBeNull();
    expect((declaration as RegExpExecArray)[1]).toBe(secondOwner);

    // Counted over the whole rendering, not over the lines that mention the run lock: a denominator
    // filtered by the predicate being asserted is the shape this repository has recorded twice.
    for (const relPath of RENDERINGS) {
      const body = readFileSync(path.join(REPO_ROOT, relPath), "utf8");
      expect((body.match(/--owner/g) ?? []).length, `${relPath} passes --owner, so the collision premise is stale`).toBe(0);
    }
  });

  it("AC-4: run lock --dry-run over a torn sentinel names no holder", async () => {
    const target = await repository("lease-identity-torn-lock");
    await tornSentinel(target.commonDir);
    const envelope = await cli(target.root, ["run", "lock", "--dry-run"]);
    expect(envelope.payload).not.toHaveProperty("holder");
    expect(envelope.payload.violations).toEqual([]);
  });

  it("AC-4: run unlock --dry-run over a torn sentinel names no holder", async () => {
    const target = await repository("lease-identity-torn-unlock");
    await tornSentinel(target.commonDir);
    const envelope = await cli(target.root, ["run", "unlock", "--dry-run"]);
    expect(envelope.payload).toHaveProperty("heldBy");
    expect(envelope.payload.heldBy).toBeNull();
  });

  it("AC-4: run status over a torn sentinel names no holder, and the procedure calls it not-mine", async () => {
    const target = await repository("lease-identity-torn-status");
    await tornSentinel(target.commonDir);
    const envelope = await cli(target.root, ["run", "status"]);
    expect(envelope.payload).toHaveProperty("holder");
    expect(envelope.payload.holder).toBeNull();

    const recorded = { owner: "kiwi-orchestrator", pid: process.pid, host: "anywhere", acquiredAt: "2026-08-31T00:00:00.000Z" };
    expect(isOwnLease(recorded, envelope.payload.holder as null), "an unnameable holder must never read as mine").toBe(false);
  });

  it("AC-4: readHolder documents null as absent, torn or unreadable", async () => {
    const source = readFileSync(RUN_LOCK_MODULE, "utf8");
    // `(?:(?!\*\/)[\s\S])*` rather than `[\s\S]*?`, which matched from the FILE's first block
    // comment and reported that one's text: a lazy quantifier still starts at the earliest opening
    // it can, so the assertion was reading a comment about something else entirely.
    const doc = /\/\*\*((?:(?!\*\/)[\s\S])*)\*\/\s*export async function readHolder\b/.exec(source)?.[1] ?? "";
    expect(doc, "`readHolder` carries no doc comment, so null has no documented meaning").not.toBe("");
    // FR-NODE-203 widened what null absorbs; the comment still said absent-or-torn.
    expect(doc.toLowerCase()).toMatch(/unreadable|could not be read|cannot be read/);
  });

  it("AC-5: lock --dry-run and the real lock disagree over one torn sentinel, and the gap stays measured", async () => {
    const target = await repository("lease-identity-dry-run-gap");
    await tornSentinel(target.commonDir);

    const preview = await cli(target.root, ["run", "lock", "--dry-run"]);
    expect(preview.exit, "the preview reports the lock as takeable").toBe(0);
    expect(preview.payload.ok).toBe(true);

    const real = await cli(target.root, ["run", "lock"]);
    expect(real.exit, "the real acquisition refuses the same sentinel inside the torn grace").toBe(2);
    expect(real.payload.gate).toBe("orchestrator-run-lock-held");
  });
});
