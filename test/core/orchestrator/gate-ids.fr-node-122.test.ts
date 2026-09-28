import { describe, expect, it } from "vitest";
import { GATE_IDS, GATE_IDS_RETIRED_IN_4_0_0 } from "../../../src/core/orchestrator/auto-gate.js";
import { REPLAY_FAILURE_GATE } from "../../../src/core/orchestrator/replay-apply.js";

// FR-NODE-122 AC-2 — every gate id a bundled skill declares is a member of the exported `GateId`
// union. The 4.0.0 parallel-waves run declares three gates the union did not carry: the host's check
// that a worker left the SRS untouched (FR-FLOW-188 AC-6), the test-sufficiency stop (FR-FLOW-186) and
// the replay failure the replay kernel already raises (IR-CLI-092).

describe("FR-NODE-122 AC-2 the parallel-waves gates are GateId members", () => {
  for (const gate of ["worker-touched-srs", "test-sufficiency-gap", "srs-mutation-replay-failed"]) {
    it(`FR-NODE-122 AC-2 admits ${gate}`, () => {
      expect(GATE_IDS as readonly string[]).toContain(gate);
    });
  }

  it("FR-NODE-122 AC-2 closes the replay kernel's own refusal gate over the union", () => {
    expect(GATE_IDS as readonly string[]).toContain(REPLAY_FAILURE_GATE);
  });
});

// FR-NODE-213 AC-3 — the handoff validator, the substrate coupling check and the task-level conflict
// reasons left in 4.0.0, and the eight gates only they raised left the skills with them. A union
// member no refusal can carry and no skill declares is a gate in name only.
describe("FR-NODE-213 AC-3 the gates of the removed handoff, coupling and task-conflict checks are gone", () => {
  const RETIRED = [
    "handoff-not-english",
    "handoff-unresolvable-reference",
    "handoff-untested-ac-over-cap",
    "handoff-verify-failed",
    "stage-coupling-unresolved",
    "tdd-pair-split",
    "unknown-write-set-refused",
    "non-code-write-set-refused"
  ] as const;
  for (const gate of RETIRED) {
    it(`FR-NODE-213 AC-3 drops ${gate} from the union`, () => {
      expect(GATE_IDS as readonly string[]).not.toContain(gate);
    });
  }
});

describe("FR-NODE-213 AC-6 the retired-gate list older journal lines keep is exactly the nine 4.0.0 removed", () => {
  it("FR-NODE-213 AC-6 names plan-coverage-unclosed and the eight handoff, coupling and task-conflict gates, none still live", () => {
    expect([...GATE_IDS_RETIRED_IN_4_0_0].sort()).toEqual(
      [
        "plan-coverage-unclosed",
        "handoff-not-english",
        "handoff-unresolvable-reference",
        "handoff-untested-ac-over-cap",
        "handoff-verify-failed",
        "stage-coupling-unresolved",
        "tdd-pair-split",
        "unknown-write-set-refused",
        "non-code-write-set-refused"
      ].sort()
    );
    expect(GATE_IDS_RETIRED_IN_4_0_0.filter((gate) => (GATE_IDS as readonly string[]).includes(gate))).toEqual([]);
  });
});
