// FR-NODE-155 — non-vacuous acceptance and the untested-AC cap (05 §6.2 layer 5, §6.5 closures 1,
// 2 and 5).
//
// 08:30-33 names this as the one critical defect the serial scope cut does not remove: nothing
// bounded the number of null test ids, and the party choosing null was the handoff author. The
// rounding convention is ceiling, and AC-2 is the fixture that tells ceiling from floor.

import { describe, expect, it } from "vitest";
import { validateHandoff, type HandoffLane, type HandoffRoot, type HandoffValidation } from "../../../src/core/orchestrator/handoff.js";
import { defaultCatalog, defaultHandoff, defaultLane, defaultRoot, handoffWith, MODULE_PATH, TEST_PATH } from "./handoff-fixtures.js";

/** Three requirements, eight criteria each, so a fixture can spread null rows across REQs. */
function wideRoot(): HandoffRoot {
  const acIds = ["AC-1", "AC-2", "AC-3", "AC-4", "AC-5", "AC-6", "AC-7", "AC-8"];
  return { ...defaultRoot(), requirementAcIds: { "FR-FLOW-071": acIds, "FR-FLOW-072": acIds, "FR-FLOW-073": acIds } };
}

const WIDE_REQ_IDS = 'req_ids: ["FR-FLOW-071", "FR-FLOW-072", "FR-FLOW-073"]';

function tested(acId: string, reqId: string, caseName: string): string {
  return `  - { ac_id: "${acId}", req_id: "${reqId}", test_id: "${TEST_PATH}::${caseName}" }`;
}

function untested(acId: string, reqId: string): string {
  return [
    `  - { ac_id: "${acId}", req_id: "${reqId}", test_id: null,`,
    '      untested_reason: "Depends on the wave-2 partition postmortem, which wave 3 lane 5 writes.",',
    '      untested_owner: "wave-3/lane-5" }'
  ].join("\n");
}

function acceptance(rows: string[]): string {
  return ["acceptance:", ...rows].join("\n");
}

function validate(text: string, options: { root?: HandoffRoot; lane?: HandoffLane } = {}): HandoffValidation {
  return validateHandoff(text, options.lane ?? defaultLane(), defaultCatalog(), options.root ?? wideRoot());
}

function codes(result: HandoffValidation): string[] {
  return result.violations.map((violation) => violation.code);
}

describe("FR-NODE-155 AC-1 — the acceptance list is non-empty", () => {
  it("refuses a handoff whose acceptance list is empty", () => {
    const result = validate(handoffWith({ acceptance: "acceptance: []" }));
    expect(codes(result)).toContain("handoff-untested-ac-over-cap");
    expect(result.ok).toBe(false);
  });
});

describe("FR-NODE-155 AC-2 — the rounding convention is ceiling, not floor", () => {
  const threeRows = (nullCount: 1 | 2): string =>
    acceptance(
      nullCount === 1
        ? [tested("AC-1", "FR-FLOW-071", "case one"), tested("AC-2", "FR-FLOW-071", "case two"), untested("AC-3", "FR-FLOW-072")]
        : [tested("AC-1", "FR-FLOW-071", "case one"), untested("AC-2", "FR-FLOW-072"), untested("AC-3", "FR-FLOW-073")]
    );

  it("accepts three rows carrying one null test id, because ceil(3 / 4) is one", () => {
    const result = validate(handoffWith({ acceptance: threeRows(1), req_ids: WIDE_REQ_IDS }));
    expect(result.violations).toEqual([]);
    expect(result.counts.acceptanceRowCount).toBe(3);
    expect(result.counts.untestedRowCount).toBe(1);
    expect(result.counts.untestedCap).toBe(1);
  });

  it("refuses the same handoff at two null rows, so the convention is not floor-plus-slack", () => {
    expect(codes(validate(handoffWith({ acceptance: threeRows(2), req_ids: WIDE_REQ_IDS })))).toContain("handoff-untested-ac-over-cap");
  });
});

describe("FR-NODE-155 AC-3 — the allowance is an absolute row count and is reported", () => {
  const fourRows = (nullCount: 2 | 3): string =>
    acceptance(
      nullCount === 2
        ? [tested("AC-1", "FR-FLOW-071", "case one"), tested("AC-2", "FR-FLOW-071", "case two"), untested("AC-3", "FR-FLOW-072"), untested("AC-4", "FR-FLOW-073")]
        : [tested("AC-1", "FR-FLOW-071", "case one"), untested("AC-2", "FR-FLOW-071"), untested("AC-3", "FR-FLOW-072"), untested("AC-4", "FR-FLOW-073")]
    );

  it("accepts exactly N null rows when the allowance is N", () => {
    const root: HandoffRoot = { ...wideRoot(), allowUntestedAc: 2 };
    const result = validate(handoffWith({ acceptance: fourRows(2), req_ids: WIDE_REQ_IDS }), { root });

    expect(result.violations).toEqual([]);
    expect(result.counts.untestedAllowance).toBe(2);
    expect(result.counts.untestedCap).toBe(2);
  });

  it("refuses N plus one null rows at the same allowance", () => {
    const root: HandoffRoot = { ...wideRoot(), allowUntestedAc: 2 };
    expect(codes(validate(handoffWith({ acceptance: fourRows(3), req_ids: WIDE_REQ_IDS }), { root }))).toContain("handoff-untested-ac-over-cap");
  });

  it("reports a zero allowance when none was raised, so the journal records the value in force", () => {
    expect(validate(defaultHandoff()).counts.untestedAllowance).toBe(0);
  });
});

describe("FR-NODE-155 AC-4 — the per-requirement bound is lane-only", () => {
  const eightRows = acceptance([
    tested("AC-1", "FR-FLOW-071", "case one"),
    tested("AC-2", "FR-FLOW-071", "case two"),
    tested("AC-3", "FR-FLOW-071", "case three"),
    tested("AC-4", "FR-FLOW-071", "case four"),
    tested("AC-5", "FR-FLOW-071", "case five"),
    tested("AC-6", "FR-FLOW-071", "case six"),
    untested("AC-7", "FR-FLOW-071"),
    untested("AC-8", "FR-FLOW-071")
  ]);

  it("refuses a lane handoff with two null rows for one requirement even under the count cap", () => {
    const result = validate(handoffWith({ acceptance: eightRows }));
    expect(result.counts.untestedCap).toBe(2);
    expect(result.counts.untestedRowCount).toBe(2);
    expect(codes(result)).toContain("handoff-untested-ac-over-cap");
  });

  it("accepts an epilogue handoff of the same shape under the count cap alone", () => {
    const text = handoffWith({ acceptance: eightRows, handoff_kind: 'handoff_kind: "epilogue"', stage: "stage: null", lane: 'lane: "epilogue"' });
    const lane: HandoffLane = { laneId: "epilogue", taskIds: ["T-PH003-04", "T-PH003-05"], writeSet: null };

    expect(validate(text, { lane }).violations).toEqual([]);
  });
});

describe("FR-NODE-155 AC-5 — a null row is attributed", () => {
  const rowsWith = (nullRow: string): string => acceptance([tested("AC-1", "FR-FLOW-071", "case one"), tested("AC-2", "FR-FLOW-071", "case two"), nullRow]);

  it("refuses a null row missing its untested reason", () => {
    const row = ['  - { ac_id: "AC-3", req_id: "FR-FLOW-072", test_id: null,', '      untested_owner: "wave-3/lane-5" }'].join("\n");
    expect(codes(validate(handoffWith({ acceptance: rowsWith(row), req_ids: WIDE_REQ_IDS })))).toContain("handoff-untested-ac-over-cap");
  });

  it("refuses a null row whose untested reason is shorter than twenty characters", () => {
    const row = ['  - { ac_id: "AC-3", req_id: "FR-FLOW-072", test_id: null,', '      untested_reason: "later wave",', '      untested_owner: "wave-3/lane-5" }'].join("\n");
    expect("later wave".length).toBeLessThan(20);
    expect(codes(validate(handoffWith({ acceptance: rowsWith(row), req_ids: WIDE_REQ_IDS })))).toContain("handoff-untested-ac-over-cap");
  });

  it("accepts a null row whose untested reason is exactly twenty characters", () => {
    const reason = "wave three lane five";
    expect(reason).toHaveLength(20);
    const row = ['  - { ac_id: "AC-3", req_id: "FR-FLOW-072", test_id: null,', `      untested_reason: "${reason}",`, '      untested_owner: "wave-3/lane-5" }'].join("\n");
    expect(validate(handoffWith({ acceptance: rowsWith(row), req_ids: WIDE_REQ_IDS })).violations).toEqual([]);
  });

  it("refuses a null row missing its untested owner", () => {
    const row = ['  - { ac_id: "AC-3", req_id: "FR-FLOW-072", test_id: null,', '      untested_reason: "Depends on an artifact a later wave introduces first." }'].join("\n");
    expect(codes(validate(handoffWith({ acceptance: rowsWith(row), req_ids: WIDE_REQ_IDS })))).toContain("handoff-untested-ac-over-cap");
  });
});

describe("FR-NODE-155 AC-6 — every non-null test id resolves to a real test file", () => {
  it("refuses a test id naming a file that is neither at the dispatch base nor in the write set", () => {
    const rows = acceptance([`  - { ac_id: "AC-1", req_id: "FR-FLOW-071", test_id: "test/core/absent/nothing.test.ts::a case" }`]);
    const command = `npx vitest run --reporter=json ${TEST_PATH} test/core/absent/nothing.test.ts`;
    const text = handoffWith({ acceptance: rows, verification_cmd: ["verification_cmd:", `  posix: "${command}"`, `  windows: "${command}"`].join("\n") });

    expect(codes(validate(text))).toContain("handoff-unresolvable-reference");
  });

  it("accepts the same criterion once its test id names a write-set member", () => {
    const rows = acceptance([tested("AC-1", "FR-FLOW-071", "a case")]);
    expect(defaultLane().writeSet).toContain(TEST_PATH);
    expect(validate(handoffWith({ acceptance: rows })).violations).toEqual([]);
  });
});

describe("FR-NODE-155 AC-7 — no two acceptance rows share a test id", () => {
  it("refuses two rows carrying one test id", () => {
    const rows = acceptance([tested("AC-1", "FR-FLOW-071", "one shared case"), tested("AC-2", "FR-FLOW-071", "one shared case")]);
    expect(codes(validate(handoffWith({ acceptance: rows })))).toContain("handoff-unresolvable-reference");
  });

  it("accepts two rows carrying distinct test ids in the same file", () => {
    const rows = acceptance([tested("AC-1", "FR-FLOW-071", "first case"), tested("AC-2", "FR-FLOW-071", "second case")]);
    expect(validate(handoffWith({ acceptance: rows })).violations).toEqual([]);
  });
});

describe("FR-NODE-155 — the worked example sits exactly at its cap", () => {
  it("accepts four rows carrying one null, and reports the cap it was measured against", () => {
    const result = validateHandoff(defaultHandoff(), defaultLane(), defaultCatalog(), defaultRoot());
    expect(result.counts.acceptanceRowCount).toBe(4);
    expect(result.counts.untestedRowCount).toBe(1);
    expect(result.counts.untestedCap).toBe(1);
    expect(result.violations).toEqual([]);
    expect(MODULE_PATH).toContain("lane-plan");
  });
});
