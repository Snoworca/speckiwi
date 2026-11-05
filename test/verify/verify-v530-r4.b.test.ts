import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { main } from "../../src/cli/index.js";

type Json = Record<string, unknown>;

// ---------------------------------------------------------------------------------------------
// FR-NODE-254 — orchestrate validate over wave-verify lines
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
  const root = await mkdtemp(path.join(tmpdir(), "speckiwi-verify-r4b-"));
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

describe("FR-NODE-254 — verify r4.b", () => {
  // @req FR-NODE-254 AC-2
  // @req FR-NODE-254 AC-3
  it("FR-NODE-254 AC-2, AC-3: a pass line that also carries a zero axis_b is still refused when its findings.kept is 1", async () => {
    const result = await validate(
      waveVerifyLine({
        verdict: "pass",
        rounds: 1,
        cap: 3,
        residual: [],
        axis_b: { open: { critical: 0, high: 0, medium: 0, low: 0 } },
        findings: { kept: 1, dropped: 0 },
        red_tests: ["test/a.test.ts > red"]
      })
    );
    expect(result.exit, result.out).toBe(2);
  });
});
