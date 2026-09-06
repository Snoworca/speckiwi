import { execFile, spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { mkdir, readFile, stat, utimes, writeFile } from "node:fs/promises";
import { hostname } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  acquire,
  readHolder,
  release,
  resolveGitCommonDir,
  RUN_LOCK_GATE,
  runLockPath,
  type RunLock
} from "../../../src/core/orchestrator/run-lock.js";
import {
  acquireExclusiveLock,
  releaseExclusiveLock,
  renewExclusiveLock
} from "../../../src/core/lock/exclusive-lock.js";
import { ORCHESTRATE_TOOL_BINDINGS, orchestrateArgv } from "../../../src/cli/commands/orchestrate.js";
import { acquireArtifactLock, releaseArtifactLock } from "../../../src/core/workflow/artifact-lock.js";
import { cleanupFixtures, commitAll, initRepo, tempDir } from "./support/git-fixture.js";

/**
 * @req FR-NODE-207 — a run lease is held until it expires rather than until its writer exits.
 *
 * Reclamation was decided by probing whether the recorded pid still answered, and the CLI process
 * that writes the sentinel exits the moment it has written it. Measured 2026-09-06 against a scratch
 * repository: two `orchestrate run lock` invocations 0.536 s apart both exited 0, and the sentinel
 * ended up naming the second. Nothing about that is CLI-specific — the MCP bridge runs the same CLI
 * `main` inside the server process, so what protected that surface was the process outliving the
 * call rather than any decision the lock made, and the same measurement showed an MCP call stealing
 * a lease a CLI process had just taken.
 *
 * The cases below that need two processes really use two: an acquisition and a contention inside one
 * process is refused today by the in-process capability map and the Windows named-pipe fence, so a
 * suite written that way would have passed before this change and proved nothing.
 */

const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..", "..");
const CLI = path.join(REPO_ROOT, "bin", "speckiwi");
const MCP_BRIDGE = path.join(import.meta.dirname, "support", "run-lock-mcp-bridge.mjs");
const SRS_PATH = path.join(REPO_ROOT, "docs", "spec", "50.nodejs-implementation.srs.md");
const LEGACY_CRITERION_SUITE = path.join(import.meta.dirname, "run-lock.fr-node-131.test.ts");

/** Large enough that no live process carries it, so a liveness probe on it answers "gone". */
const DEAD_PID = 2_147_483_647;

const held: RunLock[] = [];

/**
 * The compiled artefacts the two-process cases run, paired with the sources they mirror.
 *
 * `bin/speckiwi` and the MCP bridge both load `dist/`, so a build older than its source would let
 * these cases answer for code nobody edited — the shape of green this repository has been closing.
 * Comparing modification times fails loudly instead, and says which file to rebuild.
 */
const COMPILED_MIRRORS: ReadonlyArray<readonly [string, string]> = [
  ["src/core/lock/exclusive-lock.ts", "dist/core/lock/exclusive-lock.js"],
  ["src/core/orchestrator/run-lock.ts", "dist/core/orchestrator/run-lock.js"],
  ["src/cli/commands/orchestrate.ts", "dist/cli/commands/orchestrate.js"],
  ["src/mcp/tools/read-tools.ts", "dist/mcp/tools/read-tools.js"]
];

beforeAll(async () => {
  for (const [source, compiled] of COMPILED_MIRRORS) {
    const sourceStat = await stat(path.join(REPO_ROOT, source));
    const compiledStat = await stat(path.join(REPO_ROOT, compiled)).catch(() => null);
    expect(compiledStat, `${compiled} is missing; run \`npm run build\` before this suite`).not.toBeNull();
    expect(
      (compiledStat as Awaited<ReturnType<typeof stat>>).mtimeMs,
      `${compiled} is older than ${source}; run \`npm run build\` — the two-process cases below run the build, not the source`
    ).toBeGreaterThanOrEqual(sourceStat.mtimeMs);
  }
});

afterAll(async () => {
  for (const lock of held.splice(0)) await release(lock).catch(() => undefined);
  await cleanupFixtures();
});

// ── fixtures ─────────────────────────────────────────────────────────────────────────────────────

async function repository(prefix: string): Promise<{ root: string; commonDir: string }> {
  const root = await initRepo(prefix);
  await writeFile(path.join(root, "README.md"), "# run lease fixture\n", "utf8");
  await commitAll(root, "test: seed the repository");
  return { root, commonDir: await resolveGitCommonDir(root) };
}

interface Run {
  readonly exit: number;
  readonly payload: Record<string, unknown>;
  readonly stdout: string;
}

/** One real CLI process, the way an agent holding no MCP server invokes it. */
function cli(root: string, args: readonly string[]): Promise<Run> {
  return new Promise((resolve) => {
    execFile(
      "node",
      [CLI, "--root", root, "orchestrate", ...args, "--json"],
      { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, windowsHide: true },
      (error, stdout) => {
        const failure = error as { code?: number } | null;
        let payload: Record<string, unknown> = {};
        try {
          payload = JSON.parse(stdout) as Record<string, unknown>;
        } catch {
          // Left empty on purpose: the assertions name what was missing better than a parse throw.
        }
        resolve({ exit: failure ? (failure.code ?? 1) : 0, payload, stdout: stdout ?? "" });
      }
    );
  });
}

/** One MCP `orchestrate_run_lock` call, in a process that is not the one that took the lease. */
function mcpRunLock(root: string, owner: string): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [MCP_BRIDGE, REPO_ROOT, root, owner], {
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
    child.on("close", (code) => {
      if (out.trim().length === 0) {
        reject(new Error(`the MCP bridge process produced no envelope (exit ${code}): ${err}`));
        return;
      }
      resolve(JSON.parse(out) as Record<string, unknown>);
    });
  });
}

/**
 * Writes a sentinel by hand, with or without the expiry its writer would stamp on it.
 *
 * Both shapes are needed and the difference is the point: a record carrying no expiry is what every
 * pre-existing suite writes, and what the workflow artifact lock still publishes.
 */
async function writeSentinel(
  lockPath: string,
  input: { pid: number; owner: string; host?: string; leaseExpiresAt?: string }
): Promise<string> {
  await mkdir(path.dirname(lockPath), { recursive: true });
  await writeFile(lockPath, `${JSON.stringify({
    version: 1,
    token: "pre-existing-token",
    pid: input.pid,
    host: input.host ?? hostname(),
    owner: input.owner,
    acquired_at: new Date().toISOString(),
    ...(input.leaseExpiresAt === undefined ? {} : { lease_expires_at: input.leaseExpiresAt })
  })}\n`, "utf8");
  return lockPath;
}

function inThePast(): string {
  return new Date(Date.now() - 60_000).toISOString();
}

function inTheFuture(): string {
  return new Date(Date.now() + 3_600_000).toISOString();
}

/**
 * Reads one timestamp field off a sentinel, naming the record when the field is not a timestamp.
 *
 * Going through here rather than indexing straight into the parsed object is what makes an absent
 * field a failure that says which field and which record, instead of a `NaN` that quietly satisfies
 * no comparison at all — the same shape this requirement rejects in the lock itself.
 */
function timestampOf(record: Record<string, unknown>, field: string): number {
  const value = record[field];
  expect(typeof value, `the sentinel carries no ${field}: ${JSON.stringify(record)}`).toBe("string");
  const parsed = Date.parse(value as string);
  expect(Number.isFinite(parsed), `${field} is not a timestamp: ${JSON.stringify(record)}`).toBe(true);
  return parsed;
}

// ── the requirement documents, read rather than restated ─────────────────────────────────────────

function requirementBlock(id: string): string {
  const body = readFileSync(SRS_PATH, "utf8");
  const start = body.indexOf(`### ${id} `);
  expect(start, `${id} is not in the scope document, so nothing below has a source`).toBeGreaterThan(-1);
  const rest = body.slice(start + 1);
  // A block ends at the next requirement OR at the next section: the last requirement of a scope
  // document is followed only by `## 5.`, and a block that ran on past it would let a later
  // section's prose satisfy assertions about this requirement's own notes.
  const end = [rest.indexOf("\n### "), rest.indexOf("\n## ")].filter((at) => at > -1);
  return end.length === 0 ? rest : rest.slice(0, Math.min(...end));
}

function criterion(block: string, label: string): string {
  const line = block.split("\n").find((row) => row.startsWith(`- [ ] ${label}:`) || row.startsWith(`- [x] ${label}:`));
  expect(line, `${label} is not a criterion of that requirement`).toBeDefined();
  return line as string;
}

describe("FR-NODE-207 a run lease is held until it expires", { timeout: 180_000 }, () => {
  it("AC-1: a second CLI process is refused while the first process's lease is unexpired", async () => {
    const target = await repository("lease-expiry-two-cli");

    const first = await cli(target.root, ["run", "lock", "--owner", "run-a"]);
    // The precondition and the anti-vacuity control in one: a free repository is taken, so the
    // refusal below cannot be a CLI that refuses everything.
    expect(first.exit, `taking a free repository must succeed: ${first.stdout}`).toBe(0);
    expect(first.payload.holder, "the acquisition named no holder").toBeDefined();

    // The first process has exited by now — `execFile` resolves on close — so its pid answers no
    // liveness probe. That is precisely the state that used to make the lease free for the taking.
    const second = await cli(target.root, ["run", "lock", "--owner", "run-b"]);

    expect(second.exit, `a held lease must refuse the second run: ${second.stdout}`).not.toBe(0);
    expect(second.payload.ok).toBe(false);
    expect(second.payload.gate).toBe(RUN_LOCK_GATE);
    expect(RUN_LOCK_GATE).toBe("orchestrator-run-lock-held");
    // The sentinel still names the first run: a refusal that had quietly rewritten it would be the
    // defect wearing a refusal's envelope.
    await expect(readHolder(target.commonDir)).resolves.toMatchObject({ owner: "run-a" });
  });

  it("AC-2: the MCP surface answers the same, and asks through the same CLI leaf", async () => {
    const target = await repository("lease-expiry-mcp");

    const taken = await cli(target.root, ["run", "lock", "--owner", "cli-run"]);
    expect(taken.exit, `taking the lease is a precondition: ${taken.stdout}`).toBe(0);

    // A separate process, because the bridge runs the CLI inside the server process: only a caller
    // that is NOT the holder's process can show whether the lock decides anything by itself.
    const bridged = await mcpRunLock(target.root, "mcp-run");

    expect(bridged.ok, `the MCP surface stole a lease the CLI holds: ${JSON.stringify(bridged)}`).toBe(false);
    expect(bridged.gate).toBe(RUN_LOCK_GATE);
    expect(bridged.exitCode).toBe(2);
    await expect(readHolder(target.commonDir)).resolves.toMatchObject({ owner: "cli-run" });

    // Why the two surfaces answered differently before: not two code paths, one process lifetime.
    // The binding re-encodes the call into the argv of the very leaf the CLI case above ran.
    const binding = ORCHESTRATE_TOOL_BINDINGS.find((row) => row.tool === "orchestrate_run_lock");
    expect(binding, "orchestrate_run_lock is not a registered binding").toBeDefined();
    expect(orchestrateArgv(binding!, { action: "lock", owner: "mcp-run" }, target.root))
      .toEqual(["--root", target.root, "orchestrate", "run", "lock", "--owner", "mcp-run", "--json"]);
  });

  it("AC-3: a dry run and a real acquisition give one answer for one sentinel", async () => {
    const free = await repository("lease-expiry-parity-free");
    // Both halves agree on a free repository too, so the parity below is not the parity of two
    // refusals that refuse everything.
    const freeDry = await cli(free.root, ["run", "lock", "--owner", "probe", "--dry-run"]);
    expect(freeDry.exit, freeDry.stdout).toBe(0);
    const freeReal = await cli(free.root, ["run", "lock", "--owner", "probe"]);
    expect(freeReal.exit, freeReal.stdout).toBe(0);

    const target = await repository("lease-expiry-parity-held");
    const taken = await cli(target.root, ["run", "lock", "--owner", "holder-run"]);
    expect(taken.exit, taken.stdout).toBe(0);

    const dry = await cli(target.root, ["run", "lock", "--owner", "contender", "--dry-run"]);
    const real = await cli(target.root, ["run", "lock", "--owner", "contender"]);

    // Measured before this change: the dry run refused with exit 2 while the real acquisition took
    // the lock and exited 0, so which surface a caller asked with changed what it was told.
    expect(dry.exit, dry.stdout).toBe(2);
    expect(real.exit, `the real acquisition disagreed with its own dry run: ${real.stdout}`).toBe(2);
    expect(real.payload.ok).toBe(dry.payload.ok);
    expect(real.payload.gate).toBe(dry.payload.gate);
    expect(real.payload.gate).toBe(RUN_LOCK_GATE);

    const named = (run: Run): unknown =>
      (run.payload.violations as ReadonlyArray<Record<string, unknown>> | undefined)?.[0]?.owner;
    expect(named(real), "both halves must name the same holder").toBe(named(dry));
    expect(named(real)).toBe("holder-run");
  });

  it("AC-4: an expired lease is reclaimed and an unexpired one is not, decided by the recorded expiry", async () => {
    // Expired, and its pid is THIS process — alive beyond doubt. Reclaiming it can only be the
    // recorded expiry talking, because liveness says "held".
    const expired = await repository("lease-expiry-expired");
    await writeSentinel(runLockPath(expired.commonDir), {
      pid: process.pid,
      owner: "expired-run",
      leaseExpiresAt: inThePast()
    });
    const reclaimed = await acquire({ commonDir: expired.commonDir, owner: "successor-run" });
    held.push(reclaimed);
    await expect(readHolder(expired.commonDir)).resolves.toMatchObject({ owner: "successor-run" });
    await release(reclaimed);
    held.splice(held.indexOf(reclaimed), 1);

    // Unexpired, and its pid is gone. Refusing it can only be the recorded expiry talking, because
    // liveness says "free" — which is exactly the verdict this requirement stops honouring.
    const unexpired = await repository("lease-expiry-unexpired");
    await writeSentinel(runLockPath(unexpired.commonDir), {
      pid: DEAD_PID,
      owner: "exited-run",
      leaseExpiresAt: inTheFuture()
    });
    await expect(acquire({ commonDir: unexpired.commonDir, owner: "contender" }))
      .rejects.toMatchObject({ gate: RUN_LOCK_GATE, owner: "exited-run" });

    // A lease whose writer named a foreign host is still governed by the expiry it named: the
    // expiry is an absolute instant the writer published, not a liveness claim only its host can
    // settle, and refusing it forever would make the lock permanent rather than expiring.
    const foreign = await repository("lease-expiry-foreign");
    await writeSentinel(runLockPath(foreign.commonDir), {
      pid: DEAD_PID,
      owner: "foreign-run",
      host: "other-host.invalid",
      leaseExpiresAt: inThePast()
    });
    const acrossHosts = await acquire({ commonDir: foreign.commonDir, owner: "successor-run" });
    held.push(acrossHosts);
    await expect(readHolder(foreign.commonDir)).resolves.toMatchObject({ owner: "successor-run" });
    await release(acrossHosts);
    held.splice(held.indexOf(acrossHosts), 1);

    // The acquisition guard a crashed acquirer leaves behind is still cleared on liveness. Its life
    // is one call, not one run, so a lease copied onto it would turn a crash midway through an
    // acquisition into a lock nobody can take for the length of that lease. Caught in flight while
    // an acquisition held it, the guard this build publishes carries no expiry and names the live
    // acquirer's pid; the second half below is what inheriting one would have cost.
    const crashedGuard = await repository("lease-expiry-guard");
    await writeSentinel(`${runLockPath(crashedGuard.commonDir)}.acquire`, {
      pid: DEAD_PID,
      owner: "crashed-acquirer:acquire"
    });
    const pastGuard = await acquire({ commonDir: crashedGuard.commonDir, owner: "successor-run" });
    held.push(pastGuard);
    await release(pastGuard);
    held.splice(held.indexOf(pastGuard), 1);

    const leasedGuard = await repository("lease-expiry-guard-leased");
    await writeSentinel(`${runLockPath(leasedGuard.commonDir)}.acquire`, {
      pid: DEAD_PID,
      owner: "crashed-acquirer:acquire",
      leaseExpiresAt: inTheFuture()
    });
    await expect(
      acquire({ commonDir: leasedGuard.commonDir, owner: "successor-run" }),
      "a guard carrying a lease would wedge acquisition for its whole length, which is why none is copied onto it"
    ).rejects.toMatchObject({ gate: RUN_LOCK_GATE });

    // And a real acquisition writes an expiry rather than leaving the reader to infer one.
    const stamped = await repository("lease-expiry-stamped");
    const own = await acquire({ commonDir: stamped.commonDir, owner: "stamping-run" });
    held.push(own);
    const published = JSON.parse(await readFile(runLockPath(stamped.commonDir), "utf8")) as Record<string, unknown>;
    expect(typeof published.lease_expires_at, `the writer stamped no expiry: ${JSON.stringify(published)}`).toBe("string");
    expect(Date.parse(published.lease_expires_at as string))
      .toBeGreaterThan(Date.parse(published.acquired_at as string));
    await release(own);
    held.splice(held.indexOf(own), 1);
  });

  it("AC-5: the workflow artifact lock, which shares this layer, is unchanged", async () => {
    const workspace = await tempDir("lease-expiry-artifact");
    const artifact = path.join(workspace, "waves.jsonl");
    await writeFile(artifact, "", "utf8");
    const lockPath = `${artifact}.speckiwi.lock`;

    // It publishes no expiry, so its sentinels take the path they always took.
    const taken = await acquireArtifactLock({ artifactPath: artifact, owner: "writer-a" });
    expect(taken.ok, "the artifact lock could not be taken at all").toBe(true);
    const published = JSON.parse(await readFile(lockPath, "utf8")) as Record<string, unknown>;
    expect(Object.keys(published), `the artifact lock started stamping an expiry: ${JSON.stringify(published)}`)
      .not.toContain("lease_expires_at");
    if (taken.ok) await releaseArtifactLock(taken.capability);

    // A crashed writer's sentinel is still reclaimed on liveness. Were it governed by an expiry it
    // never wrote, a crash would wedge every artifact write for the length of that lease.
    await writeSentinel(lockPath, { pid: DEAD_PID, owner: "crashed-writer" });
    const afterCrash = await acquireArtifactLock({ artifactPath: artifact, owner: "writer-b" });
    expect(afterCrash.ok, "a crashed artifact writer's sentinel is no longer reclaimable").toBe(true);
    if (afterCrash.ok) await releaseArtifactLock(afterCrash.capability);

    // And a live writer's sentinel is still refused.
    await writeSentinel(lockPath, { pid: process.pid, owner: "live-writer" });
    const contended = await acquireArtifactLock({ artifactPath: artifact, owner: "writer-c" });
    expect(contended.ok, "a live artifact writer's sentinel stopped being honoured").toBe(false);
  });

  it("AC-6: FR-NODE-131 AC-4 is corrected, and its suite's green is shown to be no evidence", async () => {
    // The measurement first, because a green suite is what has to be distrusted here: against a
    // sentinel that carries an expiry, a dead pid does not make it reclaimable.
    const target = await repository("lease-expiry-131-measure");
    await writeSentinel(runLockPath(target.commonDir), {
      pid: DEAD_PID,
      owner: "exited-run",
      leaseExpiresAt: inTheFuture()
    });
    await expect(acquire({ commonDir: target.commonDir, owner: "contender" }))
      .rejects.toMatchObject({ gate: RUN_LOCK_GATE });

    // Why its own suite stays green regardless: it writes the legacy shape, which the rule it
    // asserts still governs. The green is a fact about the fixture, not about the criterion.
    const lines = readFileSync(LEGACY_CRITERION_SUITE, "utf8").split(/\r?\n/);
    const writerAt = lines.findIndex((line) => line.startsWith("async function writeSentinel("));
    expect(writerAt, "the FR-NODE-131 suite no longer writes its own sentinel; this reasoning moved").toBeGreaterThan(-1);
    const closingAt = lines.findIndex((line, at) => at > writerAt && line === "}");
    expect(closingAt, "the sentinel writer has no closing line, so the slice below would run past it").toBeGreaterThan(writerAt);
    expect(
      lines.slice(writerAt, closingAt + 1).join("\n"),
      "the FR-NODE-131 fixture now stamps an expiry, so this reasoning is stale"
    ).not.toContain("lease_expires_at");

    // So the criterion itself has to say what it now governs, rather than stand unqualified.
    const corrected = criterion(requirementBlock("FR-NODE-131"), "AC-4");
    expect(corrected, `FR-NODE-131 AC-4 still claims a dead pid decides reclamation: ${corrected}`)
      .toMatch(/lease|expir/i);
  });

  it("AC-7: what this does not settle is recorded with what was measured", async () => {
    const block = requirementBlock("FR-NODE-207");
    const notes = block.slice(block.indexOf("#### Implementation Notes"));
    expect(notes.length, "FR-NODE-207 has no Implementation Notes section").toBeGreaterThan(0);
    expect(notes.replace(/\s+/g, " "), "the notes are still the empty placeholder").not.toMatch(/Implementation Notes \| -/);

    for (const unsettled of [/run durations?/i, /divergen|section 7|§7/i, /MCP server/i, /POSIX/i]) {
      expect(notes, `the Implementation Notes settle nothing about ${unsettled}`).toMatch(unsettled);
    }
    // And the lease length is not left as a bare number: the notes have to say what chose it.
    expect(notes, "the lease length is recorded without the reasoning that picked it").toMatch(/lease/i);
  });

  /**
   * Three properties of the lease format that no criterion above names, each written because a
   * mutation of it survived every criterion above. They are recorded here as what they are — guards
   * found by mutation rather than asked for by an acceptance criterion — so a later reader is not
   * left inferring which criterion they belong to.
   */
  describe("guards on the lease format that no criterion names, each found by a surviving mutant", () => {
    it("an expiry that cannot be read is not an expiry, so an unreadable sentinel is not permanent", async () => {
      const target = await repository("lease-expiry-unreadable");
      const lockPath = runLockPath(target.commonDir);
      await mkdir(path.dirname(lockPath), { recursive: true });
      // Its pid is THIS process, so pid liveness would refuse it and cannot be what decides below.
      await writeFile(lockPath, `${JSON.stringify({
        version: 1,
        token: "pre-existing-token",
        pid: process.pid,
        host: hostname(),
        owner: "garbled-run",
        acquired_at: new Date().toISOString(),
        lease_expires_at: "not-a-timestamp"
      })}\n`, "utf8");
      // Aged past the torn-sentinel grace, which is the rule an invalid record falls to.
      const stale = new Date(Date.now() - 60_000);
      await utimes(lockPath, stale, stale);

      // Honouring the unreadable value instead would make this lock permanent rather than lenient:
      // `Date.parse` answers NaN, every comparison against NaN is false, and nothing would ever
      // reclaim it. Measured on the mutant that drops the validity clause: refused with a dead pid
      // and a sentinel a minute old.
      const reclaimed = await acquire({ commonDir: target.commonDir, owner: "successor-run" });
      held.push(reclaimed);
      await expect(readHolder(target.commonDir)).resolves.toMatchObject({ owner: "successor-run" });
      await release(reclaimed);
      held.splice(held.indexOf(reclaimed), 1);

      // The anti-vacuity control: the same fixture with a READABLE expiry still in the future is
      // refused, so the reclaim above is the unreadable value being rejected rather than an
      // acquisition that takes anything sitting on an aged file.
      const readable = await repository("lease-expiry-unreadable-control");
      await writeSentinel(runLockPath(readable.commonDir), {
        pid: process.pid,
        owner: "readable-run",
        leaseExpiresAt: inTheFuture()
      });
      const controlPath = runLockPath(readable.commonDir);
      await utimes(controlPath, stale, stale);
      await expect(acquire({ commonDir: readable.commonDir, owner: "successor-run" }))
        .rejects.toMatchObject({ gate: RUN_LOCK_GATE, owner: "readable-run" });
    });

    it("a lease that is not a positive length is refused at the door rather than stamped on disk", async () => {
      const workspace = await tempDir("lease-expiry-lease-input");
      const lockPath = path.join(workspace, "input.lock");

      // Zero and a negative length publish a sentinel that is already expired the instant it is
      // written, which reads back as a lock nobody holds — a lock that never locks, produced by an
      // argument rather than by a crash. NaN and Infinity do not even reach a timestamp: the
      // acquisition builds `new Date(acquiredAt + leaseMs).toISOString()` after the kernel fence is
      // open, and that throws a RangeError from inside a call the caller cannot act on. Both are
      // refused at the door instead, where the argument is.
      for (const leaseMs of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
        await expect(
          acquireExclusiveLock({ fenceNamespace: "fr-node-207-lease-input", lockPath, owner: "probe", leaseMs }),
          `a lease of ${String(leaseMs)} was accepted`
        ).rejects.toThrow(/positive number of milliseconds/);
        await expect(stat(lockPath), `a lease of ${String(leaseMs)} left a sentinel behind`).rejects.toMatchObject({
          code: "ENOENT"
        });
      }

      // And the positive control, so the refusals above are not a call that refuses everything.
      const accepted = await acquireExclusiveLock({
        fenceNamespace: "fr-node-207-lease-input",
        lockPath,
        owner: "probe",
        leaseMs: 60_000
      });
      expect(accepted.ok, "a positive lease was refused as well").toBe(true);
      if (accepted.ok) await releaseExclusiveLock(accepted.capability);
    });

    it("renewing moves the expiry by the length its holder asked for, and invents none where there was none", async () => {
      const workspace = await tempDir("lease-expiry-renew");
      const leasedPath = path.join(workspace, "leased.lock");
      const leased = await acquireExclusiveLock({
        fenceNamespace: "fr-node-207-renew",
        lockPath: leasedPath,
        owner: "renewing-run",
        leaseMs: 60_000
      });
      expect(leased.ok, "the leased lock could not be taken").toBe(true);
      if (!leased.ok) return;

      const before = JSON.parse(await readFile(leasedPath, "utf8")) as Record<string, unknown>;
      const acquiredBefore = timestampOf(before, "acquired_at");
      const expiresBefore = timestampOf(before, "lease_expires_at");
      // Wait for the clock to leave the acquisition's millisecond rather than for an interval: a
      // renewal inside the same millisecond moves nothing, and the assertion below would then be
      // reading the machine's speed instead of the code.
      while (Date.now() <= acquiredBefore) await new Promise((resume) => setTimeout(resume, 1));
      expect(await renewExclusiveLock(leased.capability), "the renewal was refused").toBe(true);

      const after = JSON.parse(await readFile(leasedPath, "utf8")) as Record<string, unknown>;
      const acquiredAfter = timestampOf(after, "acquired_at");
      const expiresAfter = timestampOf(after, "lease_expires_at");
      expect(acquiredAfter).toBeGreaterThan(acquiredBefore);
      expect(
        expiresAfter,
        "the renewal moved the acquisition but left the expiry where it was, so the lease still ends at its original instant"
      ).toBeGreaterThan(expiresBefore);
      expect(
        expiresAfter - acquiredAfter,
        "the renewed lease is not the length its holder asked for"
      ).toBe(expiresBefore - acquiredBefore);
      await releaseExclusiveLock(leased.capability);

      // A lock that carries no lease is renewed without gaining one: renewal must not be the place a
      // reader's policy is written onto a record whose writer never agreed to an expiry.
      const plainPath = path.join(workspace, "plain.lock");
      const plain = await acquireExclusiveLock({
        fenceNamespace: "fr-node-207-renew",
        lockPath: plainPath,
        owner: "renewing-run"
      });
      expect(plain.ok, "the unleased lock could not be taken").toBe(true);
      if (!plain.ok) return;
      expect(await renewExclusiveLock(plain.capability), "the unleased renewal was refused").toBe(true);
      const renewed = JSON.parse(await readFile(plainPath, "utf8")) as Record<string, unknown>;
      expect(Object.keys(renewed), `renewal stamped a lease onto a record that had none: ${JSON.stringify(renewed)}`)
        .not.toContain("lease_expires_at");
      await releaseExclusiveLock(plain.capability);
    });
  });
});
