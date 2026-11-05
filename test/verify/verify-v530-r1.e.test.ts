import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { afterEach, describe, expect, it } from "vitest";
import { main } from "../../src/cli/index.js";

// Independent verification, round 1 bundle e: FR-NODE-254 in a kiwi-wave-master run.

const PROOF = { kind: "digest", ref: "sha256:0123456789abcdef" };
const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

async function run(root: string, argv: string[]): Promise<{ exit: number; out: Record<string, unknown> }> {
  const pipes = { stdout: new PassThrough(), stderr: new PassThrough() };
  const exit = await main(["--root", root, "orchestrate", ...argv, "--json"], pipes);
  const text = pipes.stdout.read()?.toString() ?? "";
  return { exit, out: text.length > 0 ? (JSON.parse(text) as Record<string, unknown>) : {} };
}

describe("verify v5.3.0 r1.e — FR-NODE-254 round record in a kiwi-wave-master run", () => {
  // @req FR-NODE-254 AC-3
  // @req FR-NODE-254 AC-1
  // Corpus input: skills/claude/kiwi-wave-master/SKILL.md §5.5.6 has the per-round wave-verify line written by
  // `orchestrate round record` before `complete`; the skill's own lines carry no `engine`, which
  // skills/claude/_shared/kiwi/waves-event.md §2.2 reads as kiwi-wave-master.
  it("FR-NODE-254 AC-3: after round record writes a passing wave-verify round of a kiwi-wave-master run, that run's complete line is accepted", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "verify-v530-r1e-"));
    roots.push(root);
    await mkdir(path.join(root, "kiwi"), { recursive: true });
    await writeFile(path.join(root, "kiwi/waves.jsonl"), "", "utf8");
    const base = { schema_version: "2.0.0", run_id: "run-a", wave: "wave-1", order: 1, target: "5.3.0", summary: "wave 1" };

    const started = await run(root, ["journal", "append", "--run-id", "run-a", "--payload", JSON.stringify({ ...base, status: "in_progress", phase: "worker" })]);
    expect(started.exit, JSON.stringify(started.out)).toBe(0);

    const round = {
      loop: "P", scope: "wave-1-post", roundIndex: 1, mode: "normal", cap: 5, streakBefore: 0, frozenDenominator: 1,
      verifiers: ["verifier-1"], rows: [{ id: "R-1", verdict: "pass", kept: false, verifier: "verifier-1" }],
      fixAppliedThisRound: false, regression: { failingTests: [], baselineFailingTests: [], exitCode: 0 }, residual: []
    };
    const recorded = await run(root, ["round", "record", "--run-id", "run-a", "--payload", JSON.stringify(round), "--proof", JSON.stringify(PROOF)]);
    expect(recorded.exit, JSON.stringify(recorded.out)).toBe(0);

    const complete = await run(root, [
      "journal", "append", "--run-id", "run-a",
      "--payload", JSON.stringify({ ...base, status: "complete", verification: { verdict: "pass", findings: { kept: 0, dropped: 0 }, red_tests: [] } })
    ]);
    expect(complete.exit, JSON.stringify(complete.out)).toBe(0);
  });
});
