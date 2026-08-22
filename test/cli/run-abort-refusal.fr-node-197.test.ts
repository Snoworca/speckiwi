import { execFile, execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { hostname, tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// @req FR-NODE-197 — `run abort` is the verb an orchestrator calls when it must stop. Its refusal
// path reported every cause as `run-invariant-drift`, which asserts the run's invariants drifted -
// contention is not that - and it returned before releasing the run lock, so the verb whose job is to
// stop the run left it wedged and said nothing about it.

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const CLI = path.join(REPO_ROOT, "bin", "speckiwi");
const WRITER = `speckiwi-orchestrate/${JSON.parse(await readFile(path.join(REPO_ROOT, "package.json"), "utf8")).version}`;

function journalLine(seq: number): string {
  return JSON.stringify({
    ts: "2026-08-22T00:00:00.000Z",
    schema_version: "1.4.0",
    run_id: "r1",
    engine: "kiwi-orchestrator",
    verb: "execute-unit",
    event: "result",
    wave: "wave-1",
    seq,
    writer: WRITER
  });
}

interface Project {
  readonly root: string;
  readonly journal: string;
  readonly runLock: string;
}

/**
 * A scratch git repository, because `run abort` resolves the run lock through the git common dir.
 * The journal is preloaded with stamped lines: an unstamped one is an error-severity diagnostic, so
 * the append would refuse for the wrong reason and every case here would describe something else.
 */
async function project(preload: number): Promise<Project> {
  const root = await mkdtemp(path.join(tmpdir(), "run-abort-"));
  await mkdir(path.join(root, "docs", "spec"), { recursive: true });
  await writeFile(path.join(root, "docs", "spec", "00.index.md"), "# Index\n", "utf8");
  // A real repository, not a hand-built `.git`: the run lock is resolved through
  // `git rev-parse --git-common-dir`, which rejects a directory git does not recognise.
  execFileSync("git", ["init", "--quiet"], { cwd: root, stdio: "pipe" });
  await mkdir(path.join(root, "kiwi"), { recursive: true });
  const journal = path.join(root, "kiwi", "waves.jsonl");
  await writeFile(
    journal,
    `${Array.from({ length: preload }, (_unused, index) => journalLine(index)).join("\n")}\n`,
    "utf8"
  );
  return { root, journal, runLock: path.join(root, ".git", "speckiwi", "orchestrator-run.lock") };
}

interface Run {
  readonly exit: number;
  readonly stdout: string;
}

function cli(root: string, args: readonly string[]): Promise<Run> {
  return new Promise((resolve) => {
    execFile(
      "node",
      [CLI, "--root", root, "orchestrate", ...args, "--json"],
      { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
      (error, stdout) => {
        const failure = error as { code?: number } | null;
        resolve({ exit: failure ? (failure.code ?? 1) : 0, stdout: stdout ?? "" });
      }
    );
  });
}

function abort(root: string, extra: readonly string[] = []): Promise<Run> {
  return cli(root, ["run", "abort", "--reason", "serial-unit-failed", "--run-id", "r1", ...extra]);
}

/** The sentinel shape the artifact lock publishes; naming a live pid keeps it from being reclaimed. */
function heldSentinel(): string {
  return `${JSON.stringify({
    version: 1,
    token: "11111111-2222-3333-4444-555555555555",
    pid: process.pid,
    host: hostname(),
    owner: "another-writer",
    acquired_at: "2026-08-22T00:00:00.000Z"
  })}\n`;
}

async function heldRunLock(root: string): Promise<string> {
  const found = await cli(root, ["run", "lock", "--owner", "someone"]);
  expect(found.exit, `taking the run lock is a precondition: ${found.stdout}`).toBe(0);
  return JSON.parse(found.stdout).lockPath as string;
}

describe("FR-NODE-197 run abort names its cause and never keeps the run lock quietly", () => {
  it("AC-1 and AC-3 name contention rather than invariant drift, and say the run lock is still held", async () => {
    const { root, journal } = await project(200);
    const lockPath = await heldRunLock(root);
    // Held by a live pid, so the append's bounded wait expires rather than reclaiming it as stale.
    writeFileSync(`${journal}.speckiwi.lock`, heldSentinel(), "utf8");

    const run = await abort(root);

    expect(run.exit, run.stdout).toBe(2);
    const envelope = JSON.parse(run.stdout);
    // `run-invariant-drift` claims the run's invariants moved. A busy journal is not that, and an
    // operator told so goes looking for a corrupted file instead of a concurrent writer.
    expect(envelope.gate, `contention must not be reported as invariant drift: ${run.stdout}`).not.toBe(
      "run-invariant-drift"
    );
    expect(String(envelope.gate)).toMatch(/lock|contention|held/);
    // AC-3: the run lock really is still held, and the refusal has to say so rather than leave the
    // operator to find out by trying the next command.
    expect(existsSync(lockPath), "the run lock is the thing under discussion; it must still exist").toBe(true);
    expect(JSON.stringify(envelope), "the refusal must state the run lock is still held").toMatch(/runLockHeld/);
    expect(JSON.stringify(envelope), "and name it").toContain("orchestrator-run.lock");
  }, 120_000);

  it("AC-2 and AC-3 keep invariant drift for a validation refusal, and still say the run lock is held", async () => {
    const { root, journal } = await project(50);
    const lockPath = await heldRunLock(root);
    // A line carrying no writer stamp is an error at any position, which is what this case needs: an
    // abort_gate outside the vocabulary is an error only on the NEWEST line, and the abort's own line
    // lands after it, so that poison would have been demoted to a warning and the append would have
    // succeeded - which is exactly how the first version of this case failed.
    writeFileSync(
      journal,
      `${readFileSync(journal, "utf8")}${JSON.stringify({
        ts: "2026-08-22T00:00:01.000Z",
        schema_version: "1.4.0",
        run_id: "r1",
        engine: "kiwi-orchestrator",
        verb: "execute-unit",
        event: "result",
        wave: "wave-1",
        seq: 999
      })}\n`,
      "utf8"
    );

    const run = await abort(root);

    expect(run.exit, run.stdout).toBe(2);
    const envelope = JSON.parse(run.stdout);
    expect(envelope.gate).toBe("run-invariant-drift");
    expect(JSON.stringify(envelope), "the append's own diagnostics must survive").toContain("unstamped-writer");
    expect(existsSync(lockPath)).toBe(true);
    expect(JSON.stringify(envelope), "every refusal says the run lock is still held").toMatch(/runLockHeld/);
  }, 120_000);

  it("AC-4 releases the run lock when the abort records its line", async () => {
    const { root } = await project(50);
    const lockPath = await heldRunLock(root);

    const run = await abort(root);

    expect(run.exit, run.stdout).toBe(0);
    expect(JSON.parse(run.stdout).journalWritten).toBe(true);
    expect(existsSync(lockPath), "a successful abort releases the run lock").toBe(false);
  }, 120_000);

  it("AC-7 unlock releases a lock another process took", async () => {
    // Every existing test for this drives `main()` inside the test process, so the acquiring and the
    // releasing share one module instance and the in-memory capability is present. That is not how the
    // CLI is used: the lock is taken by one invocation and dropped by a later one. Across processes
    // the capability map is empty and the release returned without doing anything, while the envelope
    // reported the holder it had supposedly removed.
    const { root } = await project(50);
    const lockPath = await heldRunLock(root);

    const run = await cli(root, ["run", "unlock"]);

    expect(run.exit, run.stdout).toBe(0);
    expect(JSON.parse(run.stdout).heldBy, "the envelope names whom it removed").toBe("someone");
    expect(existsSync(lockPath), "unlock reported a holder it did not actually remove").toBe(false);
  }, 120_000);

  it("AC-5 leaves the run lock alone on a dry run, and does not refuse", async () => {
    const { root } = await project(50);
    const lockPath = await heldRunLock(root);

    const run = await abort(root, ["--dry-run"]);

    expect(run.exit, run.stdout).toBe(0);
    expect(existsSync(lockPath), "a dry run must not release the run lock").toBe(true);
  }, 120_000);
});
