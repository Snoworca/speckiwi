import { describe, expect, it } from "vitest";
import { parseWavesJournal } from "../../../src/core/orchestrator/waves-journal.js";
import { validateWavesJournal } from "../../../src/core/orchestrator/waves-validate.js";
import { journalRoot, waveVerify, type Json } from "./waves-fixtures.js";

// @req FR-NODE-254 AC-2, AC-3 — every fact the journal validator checked on an `axis_b`/`axis_a` line
// is checked on the keep/drop line too, under the same code, verdict by verdict.
//
// The pair list below IS the table: one row per (verdict, fact). The legacy line counts open findings
// in `axis_b.open`; its keep/drop translation counts the same findings as `findings.kept`. A pair must
// yield the same error codes. Rows the two models deliberately answer differently are listed apart,
// each with its reason, so a divergence is a decision and never an accident.

/** `axis_b.open` with `n` open findings, the severity bucket being irrelevant to the validator. */
function legacy(verdict: string, open: number, residual: number): Json {
  return { verdict, axis_b: { open: { critical: 0, high: open, medium: 0, low: 0 } }, residual: items(residual) };
}

/** The same round in the keep/drop shape: no `axis_a`, no `axis_b`. */
function keepDrop(verdict: string, kept: number, residual: number, dropped = 0): Json {
  return {
    verdict,
    axis_a: undefined,
    axis_b: undefined,
    findings: { kept, dropped },
    red_tests: Array.from({ length: kept }, (_, index) => `test/r-${index}.test.ts > red`),
    residual: items(residual)
  };
}

function items(n: number): Json[] {
  return Array.from({ length: n }, (_, index) => ({ id: `F-${index}`, reason_class: "design-gap" }));
}

async function errorCodes(verification: Json): Promise<string[]> {
  const root = await journalRoot([waveVerify({ verification })]);
  const view = await parseWavesJournal(root, { runId: "run-a", engine: "kiwi-wave-master" });
  return validateWavesJournal(view)
    .filter((entry) => entry.severity === "error")
    .map((entry) => entry.code)
    .sort();
}

interface Pair {
  readonly row: string;
  readonly legacy: Json;
  readonly keepDrop: Json;
  readonly codes: string[];
}

const PAIRS: Pair[] = [
  { row: "pass · one open finding, residual empty", legacy: legacy("pass", 1, 0), keepDrop: keepDrop("pass", 1, 0), codes: ["truncated-residual"] },
  { row: "pass · two open findings, residual one", legacy: legacy("pass", 2, 1), keepDrop: keepDrop("pass", 2, 1), codes: ["truncated-residual"] },
  { row: "pass · no open finding, residual empty", legacy: legacy("pass", 0, 0), keepDrop: keepDrop("pass", 0, 0), codes: [] },
  { row: "fail-cap · two open, residual one", legacy: legacy("fail-cap", 2, 1), keepDrop: keepDrop("fail-cap", 2, 1), codes: ["truncated-residual"] },
  { row: "fail-cap · one open, residual empty", legacy: legacy("fail-cap", 1, 0), keepDrop: keepDrop("fail-cap", 1, 0), codes: ["truncated-residual"] },
  { row: "fail-cap · one open, residual one", legacy: legacy("fail-cap", 1, 1), keepDrop: keepDrop("fail-cap", 1, 1), codes: [] },
  { row: "fail-cap · residual longer than open", legacy: legacy("fail-cap", 1, 2), keepDrop: keepDrop("fail-cap", 1, 2), codes: ["truncated-residual"] },
  { row: "fail-residual · one open, residual empty", legacy: legacy("fail-residual", 1, 0), keepDrop: keepDrop("fail-residual", 1, 0), codes: ["truncated-residual"] },
  { row: "fail-residual · one open, residual one", legacy: legacy("fail-residual", 1, 1), keepDrop: keepDrop("fail-residual", 1, 1), codes: [] },
  { row: "in-progress · one open, residual empty", legacy: legacy("in-progress", 1, 0), keepDrop: keepDrop("in-progress", 1, 0), codes: [] }
];

/**
 * Rows where the keep/drop line answers differently ON PURPOSE.
 * - A pass line's residual is the carried, deferred list (FR-FLOW-203): it is not an enumeration of
 *   this round's open rows, because a dropped finding is not open. The legacy line had no other way to
 *   say "deferred" than to count it as open.
 * - A pass line holding a kept finding is refused even when the residual lists it: AC-2 lets no round
 *   holding a kept row pass, a fact the legacy line could not state because it did not know which open
 *   row blocked.
 * - `unmapped-design-item` and `constraint-violation` forbid the `axis_a.roll_up` claim ALL_MATCH, not
 *   a pass; the keep/drop line makes no roll-up claim, so there is nothing left for them to forbid.
 * - The `req_ac` layer of `denominator-mismatch` compared `axis_a.checked` with the frozen count; the
 *   keep/drop line carries no row count (`findings` does not count clean rows), so the layer has no
 *   input. `round record` still voids a mismatched round from its rows (FR-NODE-144 AC-2).
 */
const DIVERGENCES: Array<{ row: string; legacy: Json; legacyCodes: string[]; keepDrop: Json; keepDropCodes: string[] }> = [
  {
    row: "pass · residual carried with no open (kept) finding",
    legacy: legacy("pass", 0, 1),
    legacyCodes: ["truncated-residual"],
    keepDrop: keepDrop("pass", 0, 1, 1),
    keepDropCodes: []
  },
  {
    row: "pass · one kept finding listed in residual",
    legacy: legacy("pass", 1, 1),
    legacyCodes: [],
    keepDrop: keepDrop("pass", 1, 1),
    keepDropCodes: ["truncated-residual"]
  },
  {
    row: "any verdict · an unmapped design item",
    legacy: { ...legacy("pass", 0, 0), axis_a: { roll_up: "ALL_MATCH", expected: 8, checked: 8 }, design_layer: { expected: 6, mapped: 5, unmapped: [{ id: "D-7" }] } },
    legacyCodes: ["unmapped-design-item"],
    keepDrop: { ...keepDrop("pass", 0, 0), design_layer: { expected: 6, mapped: 5, unmapped: [{ id: "D-7" }] } },
    keepDropCodes: []
  },
  {
    row: "any verdict · a constraint violation",
    legacy: { ...legacy("pass", 0, 0), axis_a: { roll_up: "ALL_MATCH", expected: 8, checked: 8 }, constraint_layer: { expected: 3, checked: 3, violations: [{ id: "C-1" }] } },
    legacyCodes: ["constraint-violation"],
    keepDrop: { ...keepDrop("pass", 0, 0), constraint_layer: { expected: 3, checked: 3, violations: [{ id: "C-1" }] } },
    keepDropCodes: []
  },
  {
    row: "any verdict · req_ac row count differs from the frozen denominator",
    legacy: { ...legacy("pass", 0, 0), axis_a: { roll_up: "ALL_MATCH", expected: 8, checked: 7 } },
    legacyCodes: ["denominator-mismatch"],
    keepDrop: keepDrop("pass", 0, 0),
    keepDropCodes: []
  }
];

/**
 * A line carrying both shapes is checked under both: the `axis_b` rule and the `findings` rule each
 * run, and either one refuses. Reading `axis_b` alone let a zero `axis_b` hide a kept finding.
 */
function both(verdict: string, open: number, kept: number, residual: number): Json {
  return { ...keepDrop(verdict, kept, residual), axis_b: { open: { critical: 0, high: open, medium: 0, low: 0 } } };
}

const COEXISTING: Array<{ row: string; verification: Json; codes: string[] }> = [
  { row: "pass · zero axis_b, one kept finding", verification: both("pass", 0, 1, 0), codes: ["truncated-residual"] },
  { row: "pass · one open in axis_b, no kept finding, residual empty", verification: both("pass", 1, 0, 0), codes: ["truncated-residual"] },
  { row: "pass · both clean", verification: both("pass", 0, 0, 0), codes: [] },
  { row: "fail-cap · axis_b and findings both match the residual", verification: both("fail-cap", 1, 1, 1), codes: [] },
  { row: "fail-cap · axis_b matches the residual, findings.kept does not", verification: both("fail-cap", 1, 2, 1), codes: ["truncated-residual"] },
  { row: "fail-cap · findings.kept matches the residual, axis_b does not", verification: both("fail-cap", 2, 1, 1), codes: ["truncated-residual"] }
];

describe("FR-NODE-254 — the axis_b checks hold on the keep/drop line, verdict by verdict", () => {
  // @req FR-NODE-254 AC-2
  // @req FR-NODE-254 AC-3
  it.each(COEXISTING)("$row: a line carrying both shapes is refused when either check fails", async (row) => {
    expect(await errorCodes(row.verification)).toEqual(row.codes);
  });

  // @req FR-NODE-254 AC-2
  // @req FR-NODE-254 AC-3
  it.each(PAIRS)("$row: the legacy line and its keep/drop translation give the same codes", async (pair) => {
    expect(await errorCodes(pair.legacy), "legacy").toEqual(pair.codes);
    expect(await errorCodes(pair.keepDrop), "keep/drop").toEqual(pair.codes);
  });

  // @req FR-NODE-254 AC-2
  // @req FR-NODE-254 AC-3
  it.each(DIVERGENCES)("$row: the two models differ as declared", async (row) => {
    expect(await errorCodes(row.legacy), "legacy").toEqual(row.legacyCodes);
    expect(await errorCodes(row.keepDrop), "keep/drop").toEqual(row.keepDropCodes);
  });

  // @req FR-NODE-254 AC-3
  it("covers every verdict of the closed vocabulary in the pair table", async () => {
    const { VERIFICATION_VERDICTS } = await import("../../../src/core/orchestrator/journal-schema.js");
    const covered = new Set(PAIRS.map((pair) => pair.keepDrop.verdict));
    for (const verdict of VERIFICATION_VERDICTS) expect(covered, verdict).toContain(verdict);
  });
});
