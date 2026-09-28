import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { main } from "../../src/cli/index.js";
import { content, mcpPayload, record, TARGET } from "../core/orchestrator/support/readiness-fixture.js";

// The command halves of kernel requirements. Each kernel is pure and covered by its own suite; what
// is asserted here is the impure half the boundary rule leaves to the CLI. The `handoff validate` and
// `coupling check` halves left with those commands in 4.0.0 (FR-NODE-213 AC-3).
//   @req FR-NODE-131 AC-5 second half, AC-6 (`run abort`, `run status`)
//   @req FR-NODE-132 AC-6 (the Phase 3.c-prime refusal)
//   @req FR-NODE-153 AC-5 (preflight takes both roots)

const execFileAsync = promisify(execFile);

function io() {
  return { stdout: new PassThrough(), stderr: new PassThrough() };
}

function drain(stream: PassThrough): string {
  return stream.read()?.toString() ?? "";
}

async function run(argv: string[]): Promise<{ exit: number; payload: Record<string, unknown> }> {
  const pipes = io();
  const exit = await main([...argv, "--json"], pipes);
  const text = drain(pipes.stdout);
  return { exit, payload: text.length > 0 ? (JSON.parse(text) as Record<string, unknown>) : {} };
}

async function tempRoot(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), "speckiwi-orchestrate-halves-"));
}

async function write(root: string, relativePath: string, text: string): Promise<void> {
  const absolute = path.join(root, relativePath);
  await mkdir(path.dirname(absolute), { recursive: true });
  await writeFile(absolute, text, "utf8");
}

describe("FR-NODE-131 AC-5 / AC-6 (command half) — run abort releases, run status reports", () => {
  it("reports the holder of a held lock and no holder after `run abort`", async () => {
    // A throwaway repository, never this one: the lock lives inside `.git`, and a run left holding
    // it would be invisible to `git status` and would block every later agent in this tree.
    const root = await tempRoot();
    await execFileAsync("git", ["init", "--quiet"], { cwd: root });
    await write(root, "kiwi/waves.jsonl", "");

    const locked = await run(["--root", root, "orchestrate", "run", "lock", "--owner", "fr-node-131-test"]);
    expect(locked.exit, JSON.stringify(locked.payload)).toBe(0);

    const held = await run(["--root", root, "orchestrate", "run", "status"]);
    expect(held.exit).toBe(0);
    expect((held.payload.holder as { owner?: string } | null)?.owner).toBe("fr-node-131-test");

    // `--reason` is a `GateId` member, not a `reason_class` one. This fixture passed
    // `budget-exhausted` — a residual reason class — until IR-CLI-085 closed the option's
    // vocabulary. AC-5 asserts only that the abort releases the lock, which is unchanged.
    const aborted = await run([
      "--root", root, "orchestrate", "run", "abort", "--reason", "design-contradiction-at-wave-boundary", "--run-id", "run-a"
    ]);
    expect(aborted.exit, JSON.stringify(aborted.payload)).toBe(0);

    const released = await run(["--root", root, "orchestrate", "run", "status"]);
    expect(released.exit).toBe(0);
    expect(released.payload.holder, "abort must release the lock").toBeNull();

    // AC-5's second half: release followed by acquire succeeds.
    const reacquired = await run(["--root", root, "orchestrate", "run", "lock", "--owner", "fr-node-131-test-2"]);
    expect(reacquired.exit, JSON.stringify(reacquired.payload)).toBe(0);
    expect((await run(["--root", root, "orchestrate", "run", "status"])).payload.holder).not.toBeNull();

    await run(["--root", root, "orchestrate", "run", "unlock"]);
    expect((await run(["--root", root, "orchestrate", "run", "status"])).payload.holder).toBeNull();
  });
});

describe("FR-NODE-132 AC-6 (command half) — a not-ready result refuses the dispatch", () => {
  it("raises requirement-not-ready and exits 2, and passes on a ready snapshot", async () => {
    const root = await tempRoot();
    // An id the snapshot does not carry has no derivation at all, so it is unresolved rather than
    // dropped — the drop is what would let an unknown id pass as satisfied.
    await write(root, "empty.json", JSON.stringify(mcpPayload(content([]))));
    const refused = await run([
      "--root", root, "orchestrate", "readiness", "check",
      "--target", TARGET, "--snapshot", "empty.json", "--req", "FR-ARCH-001"
    ]);

    expect(refused.exit).toBe(2);
    expect(refused.payload.gate).toBe("requirement-not-ready");
    expect(refused.payload).not.toHaveProperty("readiness");

    await write(root, "ready.json", JSON.stringify(mcpPayload(content([record({ id: "FR-ARCH-001" })]))));
    const passed = await run([
      "--root", root, "orchestrate", "readiness", "check",
      "--target", TARGET, "--snapshot", "ready.json", "--req", "FR-ARCH-001"
    ]);

    expect(passed.exit, JSON.stringify(passed.payload)).toBe(0);
    expect(passed.payload.violations).toEqual([]);
    expect((passed.payload.readiness as Array<{ id: string }>).map((entry) => entry.id)).toEqual(["FR-ARCH-001"]);
  });
});
