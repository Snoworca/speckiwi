import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { main } from "../../src/cli/index.js";

type Json = Record<string, unknown>;

// ---------------------------------------------------------------------------------------------
// FR-NODE-254 — CLI round record
// ---------------------------------------------------------------------------------------------

const PROOF = { kind: "digest", ref: "sha256:0123456789abcdef" };

function roundPayload(overrides: Json = {}): Json {
  return {
    loop: "P",
    scope: "wave-1-post",
    roundIndex: 1,
    mode: "normal",
    cap: 5,
    streakBefore: 0,
    frozenDenominator: 1,
    verifiers: ["verifier-1"],
    rows: [{ id: "R-1", verdict: "pass", kept: false, verifier: "verifier-1" }],
    fixAppliedThisRound: false,
    regression: { failingTests: [], baselineFailingTests: [], exitCode: 0 },
    residual: [],
    ...overrides
  };
}

async function recordRound(body: Json): Promise<{ exit: number; journal: string; out: string }> {
  const root = await mkdtemp(path.join(tmpdir(), "speckiwi-verify-r2b-"));
  try {
    await mkdir(path.join(root, "kiwi"), { recursive: true });
    await writeFile(path.join(root, "kiwi/waves.jsonl"), "", "utf8");
    const pipes = { stdout: new PassThrough(), stderr: new PassThrough() };
    const exit = await main(
      ["--root", root, "orchestrate", "round", "record", "--run-id", "run-a", "--payload", JSON.stringify(body), "--proof", JSON.stringify(PROOF), "--json"],
      pipes
    );
    const journal = await readFile(path.join(root, "kiwi/waves.jsonl"), "utf8");
    return { exit, journal, out: pipes.stdout.read()?.toString() ?? "" };
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

describe("FR-NODE-254 — verify r2.b, terminal round residual", () => {
  // @req FR-NODE-254 AC-3
  // @req FR-NODE-141 AC-1
  it("FR-NODE-254 AC-3: a terminal fail-cap round whose kept finding is missing from residual is refused, as truncated-residual refused it under axis_b", async () => {
    // Before FR-NODE-254 the line carried axis_b.open counted from this round's open rows, so a terminal
    // round whose residual list left out an open finding was refused with truncated-residual
    // (run-invariant-drift, no line). The keep/drop line carries findings.kept in place of axis_b, and
    // the residual of a terminal round must still list every unresolved finding.
    const body = roundPayload({
      cap: 1,
      roundIndex: 1,
      rows: [{ id: "R-1", verdict: "mismatch", kept: true, evidence: "test/a.test.ts > red", verifier: "verifier-1" }],
      residual: []
    });
    const result = await recordRound(body);
    expect(result.out).toContain("fail-cap");
    expect({ exit: result.exit, journal: result.journal }).toEqual({ exit: 1, journal: "" });
  });
});
