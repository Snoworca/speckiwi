import { describe, expect, it } from "vitest";
import { createMcpServer } from "../../src/mcp/server.js";
import { copyFixtureWorkspace } from "../fixtures/fixture-utils.js";

// verify-v534-r1 — FR-NODE-264 through the real MCP surface `orchestrate_round_record`.
// The etc rendering of verify-loop.md has every round carry `"profile": "etc-local-llm"` (required
// streak 3). A round whose streak can still reach 3 within the cap must not be closed as `fail-cap`.

const PROOF = JSON.stringify({ kind: "digest", ref: "sha256:0123456789abcdef" });

function round(roundIndex: number, streakBefore: number, cap: number, mode = "normal") {
  return {
    loop: "P",
    scope: "wave-1-post",
    mode,
    profile: "etc-local-llm",
    cap,
    roundIndex,
    streakBefore,
    frozenDenominator: 1,
    verifiers: mode === "max" ? ["v1", "v2"] : ["v1"],
    rows: [{ id: "R1", verdict: "pass", kept: false, verifier: "v1" }],
    fixAppliedThisRound: false,
    regression: { failingTests: [], baselineFailingTests: [], exitCode: 0 },
    residual: []
  };
}

async function record(root: string, payload: unknown) {
  const out = (await createMcpServer({ root }).callTool("orchestrate_round_record", { runId: "run-1", payload: JSON.stringify(payload), proof: PROOF })) as {
    ok: boolean;
    outcome?: { verdict: string; streak: number; capRemaining: number; unreachable: boolean };
  };
  expect(out.ok, JSON.stringify(out)).toBe(true);
  return out.outcome!;
}

describe("verify-v534-r1 FR-NODE-264 — a reachable pass is not closed as fail-cap under the etc profile", () => {
  it("cap 3 (etc --mini or --loops 3): the first clean round is not fail-cap, since rounds 2 and 3 can still make the streak 3", async () => {
    const root = await copyFixtureWorkspace("valid-basic");
    const first = await record(root, round(1, 0, 3));
    // Measured: { verdict: "fail-cap", streak: 1, capRemaining: 2, unreachable: true } — the run stops on a clean round.
    expect(first.verdict).not.toBe("fail-cap");
  }, 60_000);

  it("cap 8 (etc default --max): a clean round 6 after earlier fix rounds is not fail-cap, since rounds 7 and 8 can complete the streak", async () => {
    const root = await copyFixtureWorkspace("valid-basic");
    const sixth = await record(root, round(6, 0, 8, "max"));
    // Measured: { verdict: "fail-cap", streak: 1, capRemaining: 2, unreachable: true }.
    expect(sixth.verdict).not.toBe("fail-cap");
    // The same rounds 7 and 8, if recorded, would reach the pass the engine already ruled out.
    const eighth = await record(root, round(8, 2, 8, "max"));
    expect(eighth.verdict).toBe("pass");
  }, 60_000);
});
