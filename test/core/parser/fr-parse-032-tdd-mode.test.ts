import { describe, expect, it } from "vitest";
import { parseStepState } from "../../../src/core/parser/index-parser.js";

// FR-PARSE-032 — parseStepState accepts the tdd work-mode.
//
// Red-phase suite: one test case per acceptance criterion (AC-1..AC-3). These
// cases pin the tdd extension of the step-state metadata block before the
// parser enum accepts it, so AC-1/AC-2 fail (tdd currently falls open to wait
// with modeInvalid) until STEP_MODE_ENUM and the Active Task surfacing are
// extended.
//
// Contract under test (docs/spec/20.parser-validation.srs.md FR-PARSE-032):
//   - AC-1: `Mode: tdd` parses to mode="tdd" without modeInvalid.
//   - AC-2: `Mode: tdd` + `Active Task: <name>` surfaces activeTask=<name>
//           with the same semantics as vibe.
//   - AC-3: out-of-enum values still fall open to wait with modeInvalid=true,
//           and an absent metadata block still yields wait (fail-open).

const TABLE = [
  "| Step | Status | DependsOn | TouchesScope | TouchesReq | Created | Updated |",
  "| --- | --- | --- | --- | --- | --- | --- |",
  "| step-a | active | - | ARCH | - | 2026-06-01 | 2026-06-02 |"
];

describe("FR-PARSE-032 parseStepState accepts the tdd work-mode", () => {
  it("FR-PARSE-032 AC-1: `Mode: tdd` parses to mode tdd without modeInvalid", () => {
    const parsed = parseStepState(["# Step State", "", "Mode: tdd", "", ...TABLE]);
    expect(parsed.mode).toBe("tdd");
    expect(parsed.modeInvalid).toBeUndefined();
  });

  it("FR-PARSE-032 AC-2: `Mode: tdd` surfaces the Active Task like vibe", () => {
    const parsed = parseStepState([
      "# Step State",
      "",
      "Mode: tdd",
      "Active Task: T-TDD-01",
      "",
      ...TABLE
    ]);
    expect(parsed.mode).toBe("tdd");
    expect(parsed.activeTask).toBe("T-TDD-01");
  });

  it("FR-PARSE-032 AC-3: out-of-enum values still fall open to wait with modeInvalid", () => {
    const parsed = parseStepState(["# Step State", "", "Mode: tddx", "", ...TABLE]);
    expect(parsed.mode).toBe("wait");
    expect(parsed.modeInvalid).toBe(true);

    // Fail-open: no metadata block at all still yields wait.
    const empty = parseStepState(TABLE);
    expect(empty.mode).toBe("wait");
  });
});
