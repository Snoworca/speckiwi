import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { main } from "../../src/cli/index.js";
import { defaultCatalog, defaultHandoff, defaultLane, defaultRoot } from "../core/orchestrator/handoff-fixtures.js";
import { content, mcpPayload, record, TARGET } from "../core/orchestrator/support/readiness-fixture.js";

// The command halves of four kernel requirements. Each kernel is pure and covered by its own suite;
// what is asserted here is the impure half the boundary rule leaves to the CLI.
//   @req FR-NODE-155 AC-3 (journalled allowance)
//   @req FR-NODE-131 AC-5 second half, AC-6 (`run abort`, `run status`)
//   @req FR-NODE-132 AC-6 (the Phase 3.c-prime refusal)
//   @req FR-NODE-136 AC-7 (`coupling check` and the second-pass gate)
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

async function journalLines(root: string): Promise<Array<Record<string, unknown>>> {
  const text = await readFile(path.join(root, "kiwi", "waves.jsonl"), "utf8").catch(() => "");
  return text
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

describe("FR-NODE-155 AC-3 (command half) — the untested-AC allowance is journalled", () => {
  it("records the allowance value used on a `handoff validate` that names a run", async () => {
    const root = await tempRoot();
    await write(root, "kiwi/waves.jsonl", "");
    await write(root, "lane.json", JSON.stringify(defaultLane()));
    await write(root, "catalog.json", JSON.stringify(defaultCatalog()));
    await write(root, "base.json", JSON.stringify({ ...defaultRoot(), allowUntestedAc: 2 }));
    await write(root, "handoff.md", defaultHandoff());

    const result = await run([
      "--root", root, "orchestrate", "handoff", "validate",
      "--lane", "lane.json", "--path", "handoff.md", "--catalog", "catalog.json", "--base", "base.json",
      "--run-id", "run-a"
    ]);

    expect(result.exit, JSON.stringify(result.payload)).toBe(0);
    const recorded = (await journalLines(root)).filter((line) => line.verb === "verify-handoff");
    expect(recorded, "the allowance must reach the journal").toHaveLength(1);
    expect(recorded[0]?.untested_allowance).toBe(2);
  });

  it("writes no journal line when no run is named, so a read stays a read", async () => {
    const root = await tempRoot();
    await write(root, "kiwi/waves.jsonl", "");
    await write(root, "lane.json", JSON.stringify(defaultLane()));
    await write(root, "catalog.json", JSON.stringify(defaultCatalog()));
    await write(root, "base.json", JSON.stringify(defaultRoot()));
    await write(root, "handoff.md", defaultHandoff());

    const result = await run([
      "--root", root, "orchestrate", "handoff", "validate",
      "--lane", "lane.json", "--path", "handoff.md", "--catalog", "catalog.json", "--base", "base.json"
    ]);

    expect(result.exit, JSON.stringify(result.payload)).toBe(0);
    expect(await journalLines(root)).toEqual([]);
  });
});

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

describe("FR-NODE-136 AC-7 (command half) — coupling check and the one-pass bound", () => {
  const handoffs = [
    { kind: "lane", lane: "l1", wave: 2, stage: 1, frontMatter: { write_set: ["src/shared.ts"], read_set: [] }, headings: [], body: "" },
    { kind: "lane", lane: "l2", wave: 2, stage: 1, frontMatter: { write_set: ["src/other.ts"], read_set: ["src/shared.ts"] }, headings: [], body: "" }
  ];

  it("reports the same coupling set the pure function returns, without refusing on the first pass", async () => {
    const root = await tempRoot();
    await write(root, "handoffs.json", JSON.stringify(handoffs));

    const first = await run(["--root", root, "orchestrate", "coupling", "check", "--wave", "2", "--stage", "1", "--handoffs", "handoffs.json"]);

    expect(first.exit, JSON.stringify(first.payload)).toBe(0);
    expect(first.payload.couplings).toEqual([{ path: "src/shared.ts", fromLane: "l1", toLane: "l2" }]);
    expect(first.payload.repartitionRequired, "the first hit asks for a re-partition, it does not refuse").toBe(true);
  });

  it("raises stage-coupling-unresolved on a second hit after a re-partition pass", async () => {
    const root = await tempRoot();
    await write(root, "handoffs.json", JSON.stringify(handoffs));

    const second = await run([
      "--root", root, "orchestrate", "coupling", "check",
      "--wave", "2", "--stage", "1", "--handoffs", "handoffs.json", "--repartition-pass", "1"
    ]);

    expect(second.exit).toBe(2);
    expect(second.payload.gate).toBe("stage-coupling-unresolved");
    expect(second.payload.violations).toEqual([{ path: "src/shared.ts", fromLane: "l1", toLane: "l2" }]);
  });

  it("passes a stage with no coupling on either pass", async () => {
    const root = await tempRoot();
    await write(
      root,
      "handoffs.json",
      JSON.stringify([
        { kind: "lane", lane: "l1", wave: 2, stage: 1, frontMatter: { write_set: ["src/a.ts"], read_set: [] }, headings: [], body: "" },
        { kind: "lane", lane: "l2", wave: 2, stage: 1, frontMatter: { write_set: ["src/b.ts"], read_set: [] }, headings: [], body: "" }
      ])
    );

    for (const pass of ["0", "1"]) {
      const result = await run([
        "--root", root, "orchestrate", "coupling", "check",
        "--wave", "2", "--stage", "1", "--handoffs", "handoffs.json", "--repartition-pass", pass
      ]);
      expect(result.exit, `pass ${pass}: ${JSON.stringify(result.payload)}`).toBe(0);
      expect(result.payload.couplings).toEqual([]);
    }
  });
});
