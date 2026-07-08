import { describe, expect, it } from "vitest";
import type { DirtyEdge } from "../../../src/core/query/summary.js";
// The green task (T-PH003-54) introduces the vibe-only completion hard-gate in
// src/core/mutation/internal.ts (with its result type surfaced from
// src/core/types.ts and the read path wired through src/core/query/summary.ts).
// Importing the not-yet-existing export makes the whole suite red (missing
// export) until the green task implements it.
import { evaluateVibeCompletionGate } from "../../../src/core/mutation/internal.js";

// FR-NODE-058 — vibe merge contradiction hard-gate distinguishing a synthesized
// step (step directory exists) from a contradiction-verified one.
//
// Red-phase suite (T-PH003-53): one test case per acceptance criterion
// (AC-1..AC-4). These cases describe the future contract of
// evaluateVibeCompletionGate before the export exists, so the whole suite fails
// (missing module/export) until the green task (T-PH003-54) implements it.
//
// Contract under test (from the requirement body, AC, and the A1/A3
// incremental-contradiction-cache design doc P3-9 "vibe 한정 hard-gate"):
//
//   evaluateVibeCompletionGate(input: {
//     vibe: boolean;             // true for a vibe synthesis/merge flow; false
//                                // for the legacy non-vibe STEP namespace flow
//     stepDirectoryExists: boolean;  // the SYNTHESIZED marker — a step directory
//                                    // docs/spec/steps/<task>/ exists (P3-5)
//     dirtyEdges: DirtyEdge[];   // listDirtyEdges over the step's touched
//                                // closure; an edge is a contradiction unless its
//                                // classification is "clean"
//     acknowledged: boolean;     // explicit acknowledgement of remaining dirty
//                                // edges by the operator
//   }): VibeCompletionGateResult
//
//   interface VibeCompletionGateResult {
//     allowed: boolean;          // may the vibe step be marked complete?
//     // why the gate blocked, present only when allowed === false:
//     //   "dirty-edges-unacknowledged" — contradiction edges remain and were not
//     //                                   acknowledged (the vibe hard-gate fired)
//     blockedReason?: "dirty-edges-unacknowledged";
//     // true only when the vibe hard-gate actually governed the decision; false
//     // for non-vibe flows, where it stays advisory-only (AC-4).
//     enforced: boolean;
//   }
//
// Key distinction (P3-9): "synthesized" (step directory exists) is NOT the same
// as "contradiction-verified" (dirty-edge closure empty or acknowledged). The
// hard-gate is vibe-only; non-vibe STEP namespace diagnostics stay advisory.

// A non-clean compatibility edge over the touched closure — a real contradiction
// the hard-gate must observe. Mirrors the FR-NODE-040 DirtyEdge shape.
const DIRTY_EDGE: DirtyEdge = {
  self: "FR-NODE-100",
  peer: "FR-NODE-200",
  classification: "dirty",
  reason: "endpoint pin is stale"
};

describe("FR-NODE-058 vibe merge contradiction hard-gate distinguishing synthesized from contradiction-verified", () => {
  // AC-1: A vibe step is not marked complete while list_dirty_edges over its
  // touched closure is non-empty and unacknowledged. The vibe hard-gate fires.
  it("FR-NODE-058 AC-1: blocks completion of a vibe step with non-empty, unacknowledged dirty edges", () => {
    const result = evaluateVibeCompletionGate({
      vibe: true,
      stepDirectoryExists: true,
      dirtyEdges: [DIRTY_EDGE],
      acknowledged: false
    });

    expect(result.allowed).toBe(false);
    expect(result.blockedReason).toBe("dirty-edges-unacknowledged");
    // The decision was governed by the vibe hard-gate, not advisory passthrough.
    expect(result.enforced).toBe(true);
  });

  // AC-2: Step-directory existence alone does not satisfy the
  // contradiction-verified condition. Being SYNTHESIZED (step directory exists)
  // must not, by itself, let the step complete while dirty edges remain — the
  // synthesized state is orthogonal to the contradiction-verified state.
  it("FR-NODE-058 AC-2: step-directory existence alone does not satisfy contradiction-verified", () => {
    // Synthesized (step directory exists) yet contradiction edges remain
    // unacknowledged: the gate must still block.
    const synthesizedButDirty = evaluateVibeCompletionGate({
      vibe: true,
      stepDirectoryExists: true,
      dirtyEdges: [DIRTY_EDGE],
      acknowledged: false
    });
    expect(synthesizedButDirty.allowed).toBe(false);

    // Control: the SAME synthesized state with an empty (contradiction-verified)
    // closure is allowed — proving it is the empty closure, not the step
    // directory, that grants completion.
    const synthesizedAndVerified = evaluateVibeCompletionGate({
      vibe: true,
      stepDirectoryExists: true,
      dirtyEdges: [],
      acknowledged: false
    });
    expect(synthesizedAndVerified.allowed).toBe(true);
  });

  // AC-3: Explicit acknowledgement of remaining dirty edges allows completion.
  it("FR-NODE-058 AC-3: explicit acknowledgement of remaining dirty edges allows completion", () => {
    const result = evaluateVibeCompletionGate({
      vibe: true,
      stepDirectoryExists: true,
      dirtyEdges: [DIRTY_EDGE],
      acknowledged: true
    });

    expect(result.allowed).toBe(true);
    expect(result.blockedReason).toBeUndefined();
  });

  // AC-4: Non-vibe STEP namespace diagnostics remain advisory and are unaffected
  // by this gate. The very same non-empty, unacknowledged dirty closure that
  // blocks a vibe step must NOT block a non-vibe flow — there the hard-gate is
  // never enforced.
  it("FR-NODE-058 AC-4: non-vibe STEP namespace diagnostics remain advisory and are unaffected by this gate", () => {
    const result = evaluateVibeCompletionGate({
      vibe: false,
      stepDirectoryExists: true,
      dirtyEdges: [DIRTY_EDGE],
      acknowledged: false
    });

    // Advisory-only for non-vibe flows: completion is not blocked despite the
    // identical dirty closure that fired the vibe hard-gate in AC-1.
    expect(result.allowed).toBe(true);
    expect(result.enforced).toBe(false);
  });
});
