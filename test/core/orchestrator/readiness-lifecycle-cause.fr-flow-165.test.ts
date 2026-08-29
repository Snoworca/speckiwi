import { describe, expect, it } from "vitest";

import {
  assertRequirementsReady,
  deriveCanonicalRequirementReadiness,
  RequirementNotReadyError,
  type DerivedRequirementReadiness
} from "../../../src/core/orchestrator/readiness.js";
import { content, dependsOn, record, snapshotOf, TARGET } from "./support/readiness-fixture.js";

// @req FR-FLOW-165 AC-6, AC-7 — which of the three causes stopped the dispatch, said by a field.
//
// `requirement-not-ready` reports "unsatisfied hard dependency, evidence drift, unverified
// ownership". A wave's own requirement lands at `draft`, has no dependency at all, and is refused
// under the first of those names — so the agent at the gate goes looking for a dependency that does
// not exist. That is M5 of the audit. The repair is a field, not a message: a message survives
// neither a translation nor a rewording, and nothing in the tree reads one.
//
// WHAT THIS FILE DOES NOT HOLD:
//  - It does not change what the gate refuses. AC-7 asserts that directly, over a matrix, because
//    a repair that quietly widened the dispatch would be the worse defect and would look identical
//    from the field alone.
//  - It says nothing about whether a promotion hop runs. That is the skill-text half, held in
//    `test/skills/stability-promotion-hop.fr-flow-165.test.ts`.

const READY_EVIDENCE = [{ id: "EV-1", type: "test", covers: "all", reference: "test/example.test.ts" }];

/** The rejection predicate as it stood before this change, so AC-7 compares against it rather than a memory. */
function refusedBefore(entry: DerivedRequirementReadiness): boolean {
  return !entry.hardDependenciesSatisfied || entry.evidenceDrift || !entry.ownershipVerified;
}

/**
 * A record that is lifecycle-ready and dependency-free, so flipping one axis at a time is possible.
 */
function healthy(id: string): ReturnType<typeof record> {
  return record({ id, status: "verified", stability: "evolving", verificationEvidence: READY_EVIDENCE });
}

describe("FR-FLOW-165 AC-6 — lifecycle readiness is a field of its own", () => {
  it("reports a draft requirement with satisfied dependencies as lifecycle-not-ready", () => {
    const snapshot = snapshotOf(content([
      record({ id: "FR-C-001", status: "planned", stability: "draft", verificationEvidence: [], traceLinks: dependsOn("FR-C-002") }),
      healthy("FR-C-002")
    ]));
    const rows = deriveCanonicalRequirementReadiness(snapshot, TARGET, ["FR-C-001"]);
    expect(rows[0]).toMatchObject({ id: "FR-C-001", lifecycleReady: false });
  });

  it("reports an evolving requirement with an unsatisfiable dependency as lifecycle-ready", () => {
    const snapshot = snapshotOf(content([
      record({ id: "FR-C-003", status: "planned", stability: "evolving", verificationEvidence: [], traceLinks: dependsOn("FR-C-004") }),
      record({ id: "FR-C-004", status: "planned", stability: "evolving", verificationEvidence: [] })
    ]));
    const rows = deriveCanonicalRequirementReadiness(snapshot, TARGET, ["FR-C-003"]);
    expect(rows[0]).toMatchObject({ id: "FR-C-003", lifecycleReady: true, hardDependenciesSatisfied: false });
  });

  it("carries the field on the error an agent at the gate reads", () => {
    const snapshot = snapshotOf(content([record({ id: "FR-C-005", status: "planned", stability: "draft", verificationEvidence: [] })]));
    let raised: RequirementNotReadyError | null = null;
    try {
      assertRequirementsReady(snapshot, TARGET, ["FR-C-005"]);
    } catch (error) {
      raised = error as RequirementNotReadyError;
    }
    expect(raised, "a draft requirement must still refuse the dispatch").toBeInstanceOf(RequirementNotReadyError);
    expect((raised as RequirementNotReadyError).notReady[0]).toMatchObject({ id: "FR-C-005", lifecycleReady: false });
  });
});

describe("FR-FLOW-165 AC-7 — the existing boolean keeps its meaning and the refusal set is unchanged", () => {
  /**
   * One record per cell of {draft, deprecated, evolving} x {dependency satisfied, not, absent},
   * plus an evidence-drifting one, so both axes move independently across the matrix.
   */
  const MATRIX = content([
    record({ id: "FR-C-010", status: "planned", stability: "draft", verificationEvidence: [] }),
    record({ id: "FR-C-011", status: "planned", stability: "deprecated", verificationEvidence: [] }),
    record({ id: "FR-C-012", status: "planned", stability: "evolving", verificationEvidence: [] }),
    record({ id: "FR-C-013", status: "planned", stability: "draft", verificationEvidence: [], traceLinks: dependsOn("FR-C-016") }),
    record({ id: "FR-C-014", status: "planned", stability: "evolving", verificationEvidence: [], traceLinks: dependsOn("FR-C-016") }),
    record({ id: "FR-C-015", status: "implemented", stability: "evolving", verificationEvidence: [] }),
    record({ id: "FR-C-016", status: "planned", stability: "evolving", verificationEvidence: [] }),
    healthy("FR-C-017")
  ]);
  /**
   * `FR-C-016` is deliberately OUTSIDE the allowlist. Inside it, a `planned` dependency is admitted
   * — that is FR-NODE-103 case 02 — and the dependency-only cause this matrix needs would not
   * arise at all.
   */
  const IDS = ["FR-C-010", "FR-C-011", "FR-C-012", "FR-C-013", "FR-C-014", "FR-C-015", "FR-C-017"];

  it("still folds lifecycle into hardDependenciesSatisfied, so FR-NODE-103 case 05 holds", () => {
    const rows = deriveCanonicalRequirementReadiness(snapshotOf(MATRIX), TARGET, IDS);
    for (const row of rows) {
      if (!row.lifecycleReady) {
        expect(row.hardDependenciesSatisfied, `${row.id}: pulling the conjunct out would flip this`).toBe(false);
      }
    }
    expect(rows.filter((row) => !row.lifecycleReady).map((row) => row.id)).toEqual(["FR-C-010", "FR-C-011", "FR-C-013"]);
  });

  it("separates the two causes in both directions across the matrix", () => {
    const rows = deriveCanonicalRequirementReadiness(snapshotOf(MATRIX), TARGET, IDS);
    expect(rows.some((row) => !row.lifecycleReady && !row.hardDependenciesSatisfied), "a lifecycle-only cause").toBe(true);
    expect(rows.some((row) => row.lifecycleReady && !row.hardDependenciesSatisfied), "a dependency-only cause").toBe(true);
    expect(rows.some((row) => row.lifecycleReady && row.hardDependenciesSatisfied), "neither cause").toBe(true);
  });

  it("refuses exactly the requirements the pre-change predicate refused", () => {
    const rows = deriveCanonicalRequirementReadiness(snapshotOf(MATRIX), TARGET, IDS);
    const expected = rows.filter(refusedBefore).map((row) => row.id);
    expect(expected.length, "the matrix must contain refusals for this comparison to say anything").toBeGreaterThan(0);
    expect(expected.length, "and it must contain a requirement that passes, or the comparison is vacuous").toBeLessThan(IDS.length);

    let raised: RequirementNotReadyError | null = null;
    try {
      assertRequirementsReady(snapshotOf(MATRIX), TARGET, IDS);
    } catch (error) {
      raised = error as RequirementNotReadyError;
    }
    expect(raised).toBeInstanceOf(RequirementNotReadyError);
    expect((raised as RequirementNotReadyError).notReady.map((row) => row.id)).toEqual(expected);
  });

  it("passes a snapshot whose every requirement is ready, so the gate is not simply always closed", () => {
    const snapshot = snapshotOf(content([healthy("FR-C-020"), healthy("FR-C-021")]));
    expect(() => assertRequirementsReady(snapshot, TARGET, ["FR-C-020", "FR-C-021"])).not.toThrow();
    const rows = deriveCanonicalRequirementReadiness(snapshot, TARGET, ["FR-C-020", "FR-C-021"]);
    expect(rows.every((row) => row.lifecycleReady)).toBe(true);
  });
});
