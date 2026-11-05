import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { main } from "../../src/cli/index.js";

type Json = Record<string, unknown>;

// ---------------------------------------------------------------------------------------------
// FR-NODE-254 — orchestrate validate over a keep/drop wave-verify line
// ---------------------------------------------------------------------------------------------

const PROOF = { kind: "digest", ref: "sha256:0123456789abcdef" };

function waveVerifyLine(verification: Json): Json {
  return {
    schema_version: "1.6.0",
    writer: "speckiwi@5.1.0",
    run_id: "run-a",
    engine: "kiwi-orchestrator",
    event: "result",
    ts: "2026-11-01T00:00:00.000Z",
    phase: "wave-verify",
    verb: "post-merge-verify",
    wave: "wave-1",
    order: 1,
    target: "wave-1",
    status: "in_progress",
    round: 1,
    proof: PROOF,
    verification
  };
}

async function validate(line: Json): Promise<{ exit: number; out: string }> {
  const root = await mkdtemp(path.join(tmpdir(), "speckiwi-verify-r3b-"));
  try {
    await mkdir(path.join(root, "kiwi"), { recursive: true });
    await writeFile(path.join(root, "kiwi/waves.jsonl"), `${JSON.stringify(line)}\n`, "utf8");
    const pipes = { stdout: new PassThrough(), stderr: new PassThrough() };
    const exit = await main(["--root", root, "orchestrate", "validate", "--run-id", "run-a", "--json"], pipes);
    return { exit, out: pipes.stdout.read()?.toString() ?? "" };
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

describe("FR-NODE-254 — verify r3.b, a pass line that holds a kept finding", () => {
  // @req FR-NODE-254 AC-2
  // @req FR-NODE-254 AC-3
  it("FR-NODE-254 AC-2, AC-3: orchestrate validate refuses a pass wave-verify line whose findings.kept is 1, as it refuses the axis_b line with one open finding", async () => {
    // Under axis_b a terminal pass line with one open finding and an empty residual is refused
    // (truncated-residual). The keep/drop line records the same fact as findings.kept, and AC-2 lets a
    // round pass only when it holds no kept row, so the pass line holding one must not validate clean.
    const legacy = await validate(
      waveVerifyLine({ verdict: "pass", rounds: 1, cap: 5, axis_b: { open: { critical: 0, high: 1, medium: 0, low: 0 } }, residual: [] })
    );
    expect(legacy.exit, legacy.out).toBe(2);

    const keepDrop = await validate(
      waveVerifyLine({ verdict: "pass", rounds: 1, cap: 5, findings: { kept: 1, dropped: 0 }, red_tests: ["test/a.test.ts > red"], residual: [] })
    );
    expect(keepDrop.exit, keepDrop.out).toBe(2);
  });
});
