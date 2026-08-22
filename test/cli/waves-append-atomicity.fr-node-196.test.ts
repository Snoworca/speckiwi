import { execFile, execFileSync } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { appendFileSync, chmodSync, existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { hostname, tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// @req FR-NODE-196 — the wave journal append used to read the file whole, build a copy with one line
// added and rename it over the original. Every line another writer appended after that read was
// overwritten, and because the survivor is well-formed JSONL nothing could see it: the tool returned
// a success envelope over a line it destroyed. Holding a lock did not close it (a lock binds only
// writers that take it) and neither did comparing the bytes before the rename (the comparison and the
// rename are separate syscalls). It now appends one line and rewrites nothing, so these cases are
// written against a shape that has no window rather than a narrow one.

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const CLI = path.join(REPO_ROOT, "bin", "speckiwi");

/** The stamp the append writes onto its own line; a preload without it is refused as an error. */
const WRITER = `speckiwi-orchestrate/${JSON.parse(await readFile(path.join(REPO_ROOT, "package.json"), "utf8")).version}`;

const OWN = "MARKER-CLI-OWN";
const CONCURRENT = "MARKER-CONCURRENT";

function line(seq: number, marker: string): string {
  return JSON.stringify({
    ts: "2026-08-20T00:00:00.000Z",
    schema_version: "1.4.0",
    run_id: "r1",
    engine: "kiwi-orchestrator",
    verb: "execute-unit",
    event: "result",
    wave: "wave-1",
    seq,
    marker,
    writer: WRITER
  });
}

interface Project {
  readonly root: string;
  readonly journal: string;
  readonly candidateDir: string;
}

/**
 * A scratch project holding a journal long enough that the read-to-rename span is measurable. The
 * preload lines carry the writer stamp on purpose: without it the append refuses on an error
 * diagnostic before it ever reaches the rename, and nothing can be lost. That omission is half of
 * why this defect was first recorded as a reproduction failure.
 */
async function project(preload: number): Promise<Project> {
  const root = await mkdtemp(path.join(tmpdir(), "waves-atomicity-"));
  await mkdir(path.join(root, "docs", "spec"), { recursive: true });
  await writeFile(path.join(root, "docs", "spec", "00.index.md"), "# Index\n", "utf8");
  await mkdir(path.join(root, "kiwi"), { recursive: true });
  const journal = path.join(root, "kiwi", "waves.jsonl");
  const rows = Array.from({ length: preload }, (_unused, index) => line(index, `filler-${index}`));
  await writeFile(journal, `${rows.join("\n")}\n`, "utf8");
  return { root, journal, candidateDir: path.join(root, "kiwi") };
}

interface Run {
  readonly exit: number;
  readonly stdout: string;
}

function runAppend(root: string, payload: Record<string, unknown>, extra: readonly string[] = []): Promise<Run> {
  return new Promise((resolve) => {
    execFile(
      "node",
      [
        CLI, "--root", root, "orchestrate", "journal", "append",
        "--run-id", "r1", "--payload", JSON.stringify(payload), "--json", ...extra
      ],
      { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
      (error, stdout) => {
        const failure = error as { code?: number } | null;
        resolve({ exit: failure ? (failure.code ?? 1) : 0, stdout: stdout ?? "" });
      }
    );
  });
}

function appendCommand(root: string, marker: string, seq: number, extra: readonly string[] = []): Promise<Run> {
  return runAppend(root, {
    ts: "2026-08-20T00:00:01.000Z",
    schema_version: "1.4.0",
    run_id: "r1",
    engine: "kiwi-orchestrator",
    verb: "execute-unit",
    event: "result",
    wave: "wave-1",
    seq,
    marker
  }, extra);
}

/** An append the validator must reject: the newest line's `abort_gate` is outside the vocabulary. */
function refusingAppendCommand(root: string): Promise<Run> {
  return runAppend(root, {
    ts: "2026-08-20T00:00:02.000Z",
    schema_version: "1.4.0",
    run_id: "r1",
    engine: "kiwi-orchestrator",
    verb: "abort-run",
    event: "result",
    wave: "all",
    abort_gate: "totally-made-up-gate"
  });
}

async function lines(journal: string): Promise<string[]> {
  return (await readFile(journal, "utf8")).trimEnd().split("\n");
}


/**
 * Denies read on one file while leaving write and delete alone.
 *
 * `chmod` cannot express this on Windows - Node maps it to the read-only attribute, which blocks
 * writes and never blocks reads - so the platform ACL tool is used there. The caller verifies the
 * denial took effect rather than trusting this to have worked.
 */
function denyRead(target: string): void {
  if (process.platform === "win32") {
    execFileSync("icacls", [target, "/deny", `${userName()}:(RD)`], { stdio: "pipe" });
    return;
  }
  chmodSync(target, 0o222);
}

function restoreRead(target: string): void {
  if (process.platform === "win32") {
    execFileSync("icacls", [target, "/remove:d", userName()], { stdio: "pipe" });
    return;
  }
  chmodSync(target, 0o644);
}

function userName(): string {
  return process.env["USERNAME"] ?? process.env["USER"] ?? "";
}

/** True once any candidate file exists beside the journal — the window between read and rename. */
function candidateVisible(dir: string): boolean {
  // The name is not pinned: a per-attempt suffix is one of the fixes, so the probe must find any
  // candidate rather than the one spelling the defective version happened to use.
  return readdirSync(dir).some((entry) => entry.startsWith("waves.jsonl.candidate"));
}

describe("FR-NODE-196 the wave journal append does not swallow a concurrent line", () => {
  it("AC-2 keeps a line appended inside the read-to-rename window", async () => {
    const { root, journal, candidateDir } = await project(8000);
    const before = (await lines(journal)).length;

    let injected = false;
    const running = appendCommand(root, OWN, 10_000_000);
    const spin = setInterval(() => {
      if (!injected && candidateVisible(candidateDir)) {
        // Synchronous on purpose. An awaited-later `appendFile` sets the flag while the write is
        // still queued, so it can land AFTER the rename — and then the line survives because it was
        // never in the window, not because the code protected it. That made this case pass with the
        // guard deleted. `appendFileSync` completes before the probe returns, so `injected` means
        // the bytes are on disk inside the window.
        appendFileSync(journal, `${line(10_000_001, CONCURRENT)}\n`, "utf8");
        injected = true;
      }
    }, 0);
    const run = await running;
    clearInterval(spin);

    expect(injected, "the probe must land inside the window, or this case proves nothing").toBe(true);

    const after = await lines(journal);

    // Both lines, and the append must land rather than refuse. An earlier version of this case
    // accepted a refusal as an equally honest outcome, which was true of the rewrite-and-rename shape
    // - it could only keep or refuse - but is a hedge here: an append has no reason to fail because
    // someone else wrote. Accepting the refusal branch would let a regression to that shape pass by
    // taking it.
    expect(run.exit, run.stdout).toBe(0);
    expect(run.stdout).toMatch(/"written":true/);
    expect(after.some((row) => row.includes(CONCURRENT)), `the concurrent line is gone: ${run.stdout}`).toBe(true);
    expect(after.some((row) => row.includes(OWN))).toBe(true);
    expect(after.length).toBe(before + 2);
  }, 120_000);

  it("AC-1 and AC-6 leave no line reported written but absent, under eight concurrent appends", async () => {
    const { root, journal } = await project(500);
    const attempts = 8;
    const before = (await lines(journal)).length;

    const runs = await Promise.all(
      Array.from({ length: attempts }, (_unused, index) =>
        appendCommand(root, `${OWN}-${index}`, 20_000_000 + index)
      )
    );

    const after = await lines(journal);
    const claimed = runs
      .map((run, index) => ({ index, written: run.exit === 0 && /"written":true/.test(run.stdout), stdout: run.stdout }))
      .filter((row) => row.written);
    const missing = claimed.filter((row) => !after.some((line_) => line_.includes(`${OWN}-${row.index}`)));

    expect(
      missing.map((row) => ({ index: row.index, stdout: row.stdout.slice(0, 200) })),
      "every append that reported success must be on disk"
    ).toEqual([]);

    // Not merely "no false success" - ALL of them must land. Eight is `MAX_LANE_CAP`, the documented
    // ceiling, so contention here is the ordinary operating point rather than an edge. Accepting
    // refusals was how a single non-blocking try passed this case while turning half of eight
    // concurrent appends into hard failures; and a version where every attempt failed would have
    // satisfied the assertion above with an empty `claimed`, which is no assertion at all.
    expect(
      runs.map((run, index) => ({ index, exit: run.exit, stdout: run.stdout.slice(0, 160) }))
        .filter((row) => !claimed.some((entry) => entry.index === row.index)),
      "every append at the documented lane ceiling must land, not be refused for contention"
    ).toEqual([]);
    expect(after.length, "each append adds exactly one line").toBe(before + attempts);
  }, 180_000);

  it("AC-1 and AC-6 refuse a held journal by name, rather than racing it", async () => {
    const { root, journal } = await project(50);
    const before = await lines(journal);

    // A sentinel naming this very process, which is alive, so the lock may not be reclaimed as
    // stale. This is the deterministic half of AC-1: the eight-writer case above exercises the
    // invariant but detects a missing lock only some of the time, because whether two appends
    // actually overlap is a race. Here the lock is unavailable by construction.
    await writeFile(`${journal}.speckiwi.lock`, `${JSON.stringify({
      version: 1,
      token: "11111111-2222-3333-4444-555555555555",
      pid: process.pid,
      host: hostname(),
      owner: "another-writer",
      acquired_at: "2026-08-22T00:00:00.000Z"
    })}\n`, "utf8");

    const run = await appendCommand(root, OWN, 70_000_000);

    expect(run.stdout).not.toMatch(/"written":true/);
    // AC-6: the refusal must say WHICH artifact is held. Replacing this message with a bare
    // "refused" leaves every other case in this file green, so without this assertion the criterion
    // rests on nothing.
    expect(run.stdout, "the refusal must name the artifact whose lock was unavailable").toContain(
      "kiwi/waves.jsonl"
    );
    expect(run.stdout, "and it must be the lock diagnostic, not a rename failure").toMatch(/lock is held/);
    expect(run.stdout).not.toMatch(/ENOENT|EPERM/);
    expect(await lines(journal), "a refused append must not touch the journal").toEqual(before);
  }, 120_000);

  it("AC-3 leaves a candidate belonging to another attempt alone", async () => {
    const { root, journal } = await project(50);
    // The name the defective version used for every attempt. A decoy here stands in for a concurrent
    // run's work in progress: under a fixed name this append would write its own content over the
    // decoy and then rename it onto the journal, so the decoy would be gone and the other run's
    // rename would fail on a path it never chose.
    const decoy = `${journal}.candidate`;
    const sentinel = "MARKER-OTHER-ATTEMPT-WORK-IN-PROGRESS";
    await writeFile(decoy, `${sentinel}\n`, "utf8");

    const run = await appendCommand(root, OWN, 40_000_000);

    expect(run.exit, run.stdout).toBe(0);
    expect(run.stdout).toMatch(/"written":true/);
    expect(existsSync(decoy), "the other attempt's candidate was consumed by this append").toBe(true);
    expect(await readFile(decoy, "utf8")).toContain(sentinel);
    // And this append must not have left its own candidate behind. The decoy is excluded by name:
    // it carries the legacy spelling exactly, so counting it here would assert the opposite of the
    // line above.
    const leftovers = readdirSync(path.dirname(journal))
      .filter((entry) => entry.startsWith("waves.jsonl.candidate") && entry !== path.basename(decoy));
    expect(leftovers, "this append left its own candidate behind").toEqual([]);
  }, 120_000);

  it("AC-4 releases the lock on the refusal, dry-run and success paths", async () => {
    const { root, journal } = await project(50);
    const lock = `${journal}.speckiwi.lock`;

    // The discriminator is the lock file on disk, NOT "a following append still succeeds". The
    // exclusive lock treats a lock whose owning pid is dead as stale and steals it, and every CLI
    // invocation is its own process that then exits — so a second CLI append succeeds whether or not
    // the first released anything. That check passed with the release deleted outright, which is to
    // say it proved nothing. Where the leak actually bites is the long-lived MCP server, whose pid
    // stays alive and whose stranded lock therefore nobody can steal; the residue it leaves behind is
    // this file.
    const refused = await refusingAppendCommand(root);
    expect(refused.stdout).not.toMatch(/"written":true/);
    expect(refused.stdout, "the refusal must be the validation one").toContain("abort-gate-outside-vocabulary");
    expect(existsSync(lock), "a refused append left its lock behind").toBe(false);

    const dry = await appendCommand(root, `${OWN}-dry`, 50_000_001, ["--dry-run"]);
    expect(dry.stdout).not.toMatch(/"written":true/);
    expect(existsSync(lock), "a dry run left its lock behind").toBe(false);

    const ok = await appendCommand(root, `${OWN}-after`, 50_000_002);
    expect(ok.exit, ok.stdout).toBe(0);
    expect(ok.stdout).toMatch(/"written":true/);
    expect(existsSync(lock), "a successful append left its lock behind").toBe(false);
  }, 120_000);

  it("AC-7 loses nothing under a writer hammering the journal throughout", async () => {
    // The volume case. A single well-timed injection shows the window exists; sustained writing shows
    // there is no amount of concurrent traffic the append will absorb and discard. It also covers the
    // shape the previous implementation had no answer for: rewriting the file could only keep OR
    // refuse, so under this load it exhausted its retries and refused every time. An append does not
    // have to choose.
    const { root, journal } = await project(20_000);

    let beats = 0;
    const hammer = setInterval(() => {
      appendFileSync(journal, `${line(80_000_000 + beats, `${CONCURRENT}-${beats}`)}\n`, "utf8");
      beats += 1;
    }, 0);
    const run = await appendCommand(root, OWN, 90_000_000);
    clearInterval(hammer);

    expect(beats, "the hammer must actually have written, or this case proves nothing").toBeGreaterThan(0);

    const after = await lines(journal);
    expect(run.exit, run.stdout).toBe(0);
    expect(run.stdout, "sustained concurrent writing must not defeat the append").toMatch(/"written":true/);
    expect(after.some((row) => row.includes(OWN)), "reported written but the line is absent").toBe(true);

    // Every line the hammer wrote before the command returned must still be there. Counting lines
    // instead would pass on a file holding the right number of the wrong lines.
    const missing = Array.from({ length: beats }, (_unused, index) => `${CONCURRENT}-${index}`)
      .filter((marker) => !after.some((row) => row.includes(`"${marker}"`)));
    expect(missing.slice(0, 10), `${missing.length} of ${beats} concurrent lines were discarded`).toEqual([]);
  }, 180_000);

  it("AC-8 treats an unreadable journal as an error, not as an empty one", async () => {
    // The read used to be wrapped in a catch returning "" for every failure. That is right only for a
    // journal that does not exist yet. For any other errno the append proceeded as though the file
    // were empty and wrote a one-line journal over the real one - and the byte comparison guarding
    // the write compared "" against "", so it certified the truncation and reported success.
    //
    // The scenario has to be a journal that can be WRITTEN but not READ. A directory in its place
    // fails both ways, which is why an earlier version of this case could not tell the two
    // implementations apart: the write failed too, so the envelope named EISDIR either way and the
    // mutation survived. Denying read alone needs a platform ACL call, so the precondition is
    // verified rather than assumed, and an environment where it does not hold fails loudly instead of
    // asserting nothing.
    const { root, journal } = await project(500);
    const before = await readFile(journal, "utf8");
    denyRead(journal);

    try {
      const stillReadable = await readFile(journal, "utf8").then(() => true, () => false);
      expect(stillReadable, "read was not actually denied, so this case would prove nothing").toBe(false);

      const run = await appendCommand(root, OWN, 60_000_000);

      expect(run.stdout).not.toMatch(/"written":true/);
      // Asserting only "not written:true" would pass on an empty stdout, which is what a crash before
      // any output looks like, so the refusal envelope itself is required.
      expect(run.stdout, "the failure must still produce a refusal envelope").toMatch(/"ok":false/);
      expect(existsSync(`${journal}.speckiwi.lock`), "a failed append left its lock behind").toBe(false);
    } finally {
      restoreRead(journal);
    }

    // The point of the criterion: the journal must still hold everything it held before.
    expect(await readFile(journal, "utf8"), "the unreadable journal was replaced").toBe(before);
  }, 120_000);

  it("AC-10 reports a release that did not take", async () => {
    // `releaseArtifactLock` answers `cleanup_failed` when the sentinel survives, parks the capability
    // and leaves the lock in place. Discarding that answer is how a journal becomes unwritable for the
    // life of an MCP server, whose pid stays alive so nothing may reclaim the lock as stale.
    //
    // Reproduced by overwriting the sentinel mid-append with one naming a different token, which is
    // what the release inspects before removing it. Denying DELETE on the sentinel was tried first and
    // does not work: the deny takes effect and the file is still removed, because Windows also permits
    // deletion through FILE_DELETE_CHILD on the parent directory.
    //
    // The probe polls rather than guessing a delay, and the case asserts the lock really did survive -
    // if it did not, the precondition failed and the diagnostic assertion would be testing nothing.
    const { root, journal } = await project(4_000);
    const lock = `${journal}.speckiwi.lock`;
    const foreign = `${JSON.stringify({
      version: 1,
      token: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
      pid: process.pid,
      host: hostname(),
      owner: "someone-else",
      acquired_at: "2026-08-22T00:00:00.000Z"
    })}\n`;

    // Rewritten on every tick rather than once. Writing it a single time raced the acquire: the lock
    // path exists briefly before the real record lands, so a single early write was replaced by the
    // CLI's own sentinel, the token then matched and the lock was released normally - which showed up
    // as this case failing its own precondition.
    let replaced = false;
    const running = appendCommand(root, OWN, 100_000_000);
    const spin = setInterval(() => {
      if (!existsSync(lock)) return;
      try {
        if (readFileSync(lock, "utf8") === foreign) return;
        writeFileSync(lock, foreign, "utf8");
        replaced = true;
      } catch { /* gone under us; the next tick will see it */ }
    }, 0);
    const run = await running;
    clearInterval(spin);

    expect(replaced, "the sentinel never appeared, so this case did not test the release").toBe(true);
    expect(existsSync(lock), "the release succeeded anyway, so nothing here is under test").toBe(true);
    expect(run.stdout, "a release that did not take must be reported").toMatch(/lock cleanup failed/);
    expect(run.stdout, "and it must name the artifact").toContain("kiwi/waves.jsonl");
    // The write itself still landed; a lock that could not be dropped is a warning, not a failure.
    expect(run.stdout).toMatch(/"written":true/);
  }, 120_000);

  it("AC-4 releases the lock when the write itself throws", async () => {
    // The third path AC-4 names, and the only one a `finally` is strictly required for: the other two
    // could be served by releasing on each return. A read-only journal lets the read succeed and the
    // write fail, which is the shape an operator hits on a permission error.
    const { root, journal } = await project(50);
    const before = await readFile(journal, "utf8");
    await chmod(journal, 0o444);

    const run = await appendCommand(root, OWN, 60_000_001);

    try {
      expect(run.stdout, "a failed write must not be reported as a written line").not.toMatch(/"written":true/);
      expect(await readFile(journal, "utf8"), "a failed write must leave the journal alone").toBe(before);
      expect(existsSync(`${journal}.speckiwi.lock`), "a throwing append left its lock behind").toBe(false);
    } finally {
      await chmod(journal, 0o644);
    }
  }, 120_000);

  it("AC-5 leaves a single-writer append unchanged", async () => {
    const { root, journal } = await project(50);
    const before = (await lines(journal)).length;

    const run = await appendCommand(root, OWN, 30_000_000);

    expect(run.exit, run.stdout).toBe(0);
    expect(run.stdout).toMatch(/"written":true/);
    // "same diagnostics" is part of the criterion, so it is asserted rather than assumed: an
    // uncontended append must emit none.
    expect(JSON.parse(run.stdout).diagnostics, "an uncontended append emits no diagnostics").toEqual([]);
    const after = await lines(journal);
    expect(after.length).toBe(before + 1);
    expect(after[after.length - 1]).toContain(OWN);
    expect(after[after.length - 1], "the append stamps its own writer").toContain(WRITER);
  }, 120_000);
});
