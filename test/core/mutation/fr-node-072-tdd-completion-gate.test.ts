import { describe, expect, it } from "vitest";
import type { DirtyEdge } from "../../../src/core/query/summary.js";
import { evaluateVibeCompletionGate } from "../../../src/core/mutation/internal.js";

// FR-NODE-072 — completion hard-gate enforces tdd flows.
//
// Red-phase suite: one test case per acceptance criterion (AC-1..AC-4). AC-1
// and AC-2 fail while evaluateVibeCompletionGate treats every non-vibe flow as
// advisory (internal.ts `if (!input.vibe)`) — a tdd flow currently returns
// {allowed:true, enforced:false} — until the gate accepts the tdd flag and
// enforces it with vibe parity.
//
// Contract under test (docs/spec/50.nodejs-implementation.srs.md FR-NODE-072):
//   - AC-1: tdd + unacknowledged non-clean edge → blocked, enforced.
//   - AC-2: tdd + acknowledged or clean edges → allowed, enforced.
//   - AC-3: neither vibe nor tdd → advisory {allowed:true, enforced:false}.
//   - AC-4: vibe behavior unchanged (FR-NODE-058 regression).

const DIRTY_EDGE: DirtyEdge = {
  self: "FR-NODE-100",
  peer: "FR-NODE-200",
  classification: "dirty",
  reason: "endpoint pin is stale"
};

const CLEAN_EDGE: DirtyEdge = {
  self: "FR-NODE-100",
  peer: "FR-NODE-300",
  classification: "clean",
  reason: "-"
};

describe("FR-NODE-072 completion hard-gate enforces tdd flows", () => {
  it("FR-NODE-072 AC-1: blocks a tdd flow with unacknowledged dirty edges (enforced)", () => {
    const result = evaluateVibeCompletionGate({
      vibe: false,
      tdd: true,
      stepDirectoryExists: true,
      dirtyEdges: [DIRTY_EDGE],
      acknowledged: false
    });

    expect(result.allowed).toBe(false);
    expect(result.blockedReason).toBe("dirty-edges-unacknowledged");
    expect(result.enforced).toBe(true);
  });

  it("FR-NODE-072 AC-2: allows an acknowledged or clean tdd flow with enforced:true", () => {
    const acknowledged = evaluateVibeCompletionGate({
      vibe: false,
      tdd: true,
      stepDirectoryExists: true,
      dirtyEdges: [DIRTY_EDGE],
      acknowledged: true
    });
    expect(acknowledged.allowed).toBe(true);
    expect(acknowledged.enforced).toBe(true);

    const clean = evaluateVibeCompletionGate({
      vibe: false,
      tdd: true,
      stepDirectoryExists: true,
      dirtyEdges: [CLEAN_EDGE],
      acknowledged: false
    });
    expect(clean.allowed).toBe(true);
    expect(clean.enforced).toBe(true);
  });

  it("FR-NODE-072 AC-3: a non-vibe non-tdd flow stays advisory", () => {
    const result = evaluateVibeCompletionGate({
      vibe: false,
      tdd: false,
      stepDirectoryExists: true,
      dirtyEdges: [DIRTY_EDGE],
      acknowledged: false
    });

    expect(result.allowed).toBe(true);
    expect(result.enforced).toBe(false);
  });

  it("FR-NODE-072 AC-4: vibe behavior is unchanged (FR-NODE-058 regression)", () => {
    const blocked = evaluateVibeCompletionGate({
      vibe: true,
      stepDirectoryExists: true,
      dirtyEdges: [DIRTY_EDGE],
      acknowledged: false
    });
    expect(blocked.allowed).toBe(false);
    expect(blocked.enforced).toBe(true);

    const allowed = evaluateVibeCompletionGate({
      vibe: true,
      stepDirectoryExists: true,
      dirtyEdges: [DIRTY_EDGE],
      acknowledged: true
    });
    expect(allowed.allowed).toBe(true);
    expect(allowed.enforced).toBe(true);
  });
});
