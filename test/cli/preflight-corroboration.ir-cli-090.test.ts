import { execFile } from "node:child_process";
import { mkdir, mkdtemp, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { main } from "../../src/cli/index.js";
import { GATE_IDS } from "../../src/core/orchestrator/auto-gate.js";

// @req IR-CLI-090 — a preflight refusal names which of its three conditions refused.
// @req FR-NODE-178 AC-4 — the corroboration reads the repository the argument names, never the one
// the process happens to be running in.

const execFileAsync = promisify(execFile);

function io() {
  return { stdout: new PassThrough(), stderr: new PassThrough() };
}

function drain(stream: PassThrough): string {
  return stream.read()?.toString() ?? "";
}

interface Run {
  exit: number;
  text: string;
  payload: Record<string, unknown>;
}

async function preflight(mcpRoot: string, gitRoot: string, json = true): Promise<Run> {
  const pipes = io();
  const argv = ["orchestrate", "preflight", "--mcp-root", mcpRoot, "--git-root", gitRoot, ...(json ? ["--json"] : [])];
  const exit = await main(argv, pipes);
  const text = drain(pipes.stdout);
  return { exit, text, payload: json && text.length > 0 ? (JSON.parse(text) as Record<string, unknown>) : {} };
}

/** A throwaway git repository. Never this one — the fixtures name module paths inside it. */
async function repository(prefix: string): Promise<string> {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), `speckiwi-preflight-${prefix}-`)));
  await execFileAsync("git", ["init", "--quiet"], { cwd: root });
  return root;
}

/** A directory that is in no repository at all. */
async function bareDirectory(): Promise<string> {
  return realpath(await mkdtemp(path.join(tmpdir(), "speckiwi-preflight-bare-")));
}

function reasonOf(payload: Record<string, unknown>): unknown {
  const violations = payload.violations;
  expect(Array.isArray(violations), "a refusal carries its violations").toBe(true);
  const first = (violations as unknown[])[0] as Record<string, unknown> | undefined;
  return first?.reason;
}

describe("IR-CLI-090 — the preflight refusal names its condition", () => {
  it("AC-1 distinguishes a git root that is not its repository's top level from a two-root mismatch", async () => {
    const repo = await repository("module");
    const module = path.join(repo, "server");
    await mkdir(module, { recursive: true });

    // The forgery: one value passed twice. It satisfies the two-root comparison and must still refuse.
    const forged = await preflight(module, module);
    const other = await repository("other");
    const mismatch = await preflight(other, repo);

    expect(forged.exit, JSON.stringify(forged.payload)).toBe(2);
    expect(reasonOf(forged.payload)).toBe("git-root-not-toplevel");
    expect(mismatch.exit).toBe(2);
    expect(reasonOf(mismatch.payload)).toBe("roots-differ");
    expect(reasonOf(forged.payload), "the two conditions must not share one discriminator").not.toBe(
      reasonOf(mismatch.payload)
    );
  });

  it("AC-2 gives a path in no repository its own discriminator", async () => {
    const bare = await bareDirectory();
    const run = await preflight(bare, bare);

    expect(run.exit).toBe(2);
    expect(reasonOf(run.payload)).toBe("git-root-not-a-repository");
  });

  it("AC-3 keeps one gate identifier across all three refusals", async () => {
    const repo = await repository("gate");
    const module = path.join(repo, "module");
    await mkdir(module, { recursive: true });
    const bare = await bareDirectory();
    const other = await repository("gate-other");

    const runs = [await preflight(module, module), await preflight(bare, bare), await preflight(other, repo)];

    for (const run of runs) {
      expect(run.payload.gate, JSON.stringify(run.payload)).toBe("run-root-preflight-mismatch");
    }
    expect(
      GATE_IDS.filter((id) => id.startsWith("run-root")),
      "no fourth gate identifier may be introduced for these conditions"
    ).toEqual(["run-root-preflight-mismatch"]);
  });

  it("AC-4 keeps exit 2 for every refusal", async () => {
    const repo = await repository("exit");
    const module = path.join(repo, "sub");
    await mkdir(module, { recursive: true });
    const bare = await bareDirectory();
    const other = await repository("exit-other");

    expect((await preflight(module, module)).exit).toBe(2);
    expect((await preflight(bare, bare)).exit).toBe(2);
    expect((await preflight(other, repo)).exit).toBe(2);
  });

  it("AC-5 names the same distinction without --json", async () => {
    const repo = await repository("human");
    const module = path.join(repo, "mod");
    await mkdir(module, { recursive: true });

    const run = await preflight(module, module, false);

    expect(run.exit).toBe(2);
    expect(run.text, "the human surface must not report less than the JSON one").toContain("git-root-not-toplevel");
    expect(run.text).toContain("run-root-preflight-mismatch");
  });

  it("FR-NODE-178 AC-3 still passes a genuine top level passed as both roots", async () => {
    const repo = await repository("pass");

    const run = await preflight(repo, repo);

    expect(run.exit, JSON.stringify(run.payload)).toBe(0);
    expect(run.payload.ok).toBe(true);
  });

  it("FR-NODE-178 AC-6 reports an operational error when git cannot be consulted, not a bad argument", async () => {
    // A directory that does not exist: git exits 128 with "cannot change to", which is not the same
    // answer as "this path names no repository". Reporting the latter tells the operator their layout
    // is wrong when what actually happened is that the tool could not look.
    const missing = path.join(await bareDirectory(), "no-such-directory");

    const run = await preflight(missing, missing);

    expect(run.exit, "an unreadable git is an operational failure, not a gate refusal").toBe(1);
    expect(run.payload.gate, "a gate refusal would claim the arguments were judged").toBeUndefined();
    expect(String(run.payload.error), `git's own message must survive: ${run.text}`).toMatch(/cannot change to|no such|not a directory/i);
  });

  it("FR-NODE-178 AC-4 reads the repository the argument names, not the one the process runs in", async () => {
    // Both halves of the criterion, because either alone is satisfiable by an implementation that
    // consults the working directory. First: run from inside THIS repository, which is a git top
    // level — a bare path must not inherit it. Second: run the same case from outside any repository
    // and get the identical answer, which is what shows the working directory was never consulted.
    const bare = await bareDirectory();

    const fromRepository = await preflight(bare, bare);

    const previous = process.cwd();
    let fromNowhere: Run;
    try {
      process.chdir(await bareDirectory());
      fromNowhere = await preflight(bare, bare);
    } finally {
      process.chdir(previous);
    }

    expect(fromRepository.exit).toBe(2);
    expect(reasonOf(fromRepository.payload), "the cwd's repository must not stand in for the argument's").toBe(
      "git-root-not-a-repository"
    );
    expect(fromNowhere.exit, "and the answer must not depend on where the process was standing").toBe(2);
    expect(reasonOf(fromNowhere.payload)).toBe(reasonOf(fromRepository.payload));
  });
});
