import { describe, expect, it } from "vitest";

import {
  AUTO_OPTION_COPIES,
  COMMITTEE,
  CRITICAL,
  GOVERNING_MINIMUM,
  MINIMUM,
  RUNG,
  SPREAD,
  UNANIMOUS,
  WINNING_BLOC,
  autoOptionText,
  tiedTogether,
  windowsAround
} from "../support/auto-option-copies.js";

// @req FR-FLOW-068
// FR-FLOW-068 — the committee confidence cross-check folds into the confidence-threshold mechanism.
//
// The pre-change §4.1.2 escalated one rung on a spread of 0.3 or more. With no rung left anywhere,
// that instruction degenerates into an immediate critical HALT on a spread members routinely report
// (0.9 and 0.6), making the mode the user asked to lighten strictly more halting than before.
//
// Per the 2026-08-01 committee (D-A3, 4-1), the fold supplies NO confidence adjustment of its own
// and no re-vote: the spread is recorded in the audit row and drives nothing. This suite therefore
// asserts the ABSENCE of a fifth multiplier as well as the absence of the rung — a de-rating factor
// invented here would be a fifth uncalibrated constant, and it would also let a dissenting member's
// confidence enter the comparison FR-FLOW-069 AC-3 excludes it from.

/** The four §4.1.1 factors that are asserted in the file and derived nowhere. A fifth is a defect. */
const ADJUSTMENT_FACTOR_SOURCE = String.raw`(?:×|\*|\bx\b|multiply by)\s*0\.\d`;
const ADJUSTMENT_FACTOR_ALL = new RegExp(ADJUSTMENT_FACTOR_SOURCE, "gi");
/** A separate, non-global instance: a `g` regex reused across `.test()` calls carries `lastIndex`. */
const ADJUSTMENT_FACTOR = new RegExp(ADJUSTMENT_FACTOR_SOURCE, "i");
const EXPECTED_FACTORS = ["0.7", "0.8", "0.6", "0.7"];

/** The per-member adjustment table: the rows that turn a reported confidence into an adjusted one. */
function adjustmentTable(text: string): string {
  const start = text.search(
    /(?:confidence\s+하향\s+조정|Adjust confidence before applying)/i
  );
  if (start < 0) return "";
  const rest = text.slice(start);
  const end = rest.search(/\n#{2,4}\s|\n\n(?:When|Committee|위원|조정된|The governing)/);
  return end < 0 ? rest : rest.slice(0, end);
}

describe("FR-FLOW-068 — confidence-spread cross-check folded into the confidence-threshold mechanism", () => {
  for (const copy of AUTO_OPTION_COPIES) {
    it(`AC-1 [${copy.id}]: the spread section holds no rung, no added members and no re-vote`, () => {
      const text = autoOptionText(copy.relPath);

      const spreadWindows = windowsAround(text, SPREAD, 480);
      expect(
        spreadWindows.length,
        `FR-FLOW-068 AC-1: ${copy.id} must retain a confidence-spread cross-check section`
      ).toBeGreaterThan(0);

      // Structural absence, paired with the positive below: no spread window instructs an
      // escalation, an added member or a re-vote. Before the change every copy failed this.
      expect(
        spreadWindows.filter((w) => RUNG.test(w)),
        `FR-FLOW-068 AC-1: ${copy.id}'s confidence-spread section must not escalate one rung, add committee members, or re-vote`
      ).toEqual([]);
    });

    it(`AC-2 [${copy.id}]: the spread is recorded and drives nothing; the governing confidence is one value`, () => {
      const text = autoOptionText(copy.relPath);

      // The spread is recorded in the decision audit row.
      expect(
        tiedTogether(text, SPREAD, [/record|기록|적재/i, /audit|auto_decisions|감사|결정\s*로그/i], 480),
        `FR-FLOW-068 AC-2: ${copy.id} must state that the confidence spread is recorded in the decision audit row`
      ).toBe(true);

      // ... and drives nothing: it supplies no adjustment of its own.
      expect(
        windowsAround(text, SPREAD, 480).some((w) =>
          /drives\s+nothing|no\s+(?:confidence\s+)?adjustment\s+of\s+its\s+own|supplies\s+no\s+(?:confidence\s+)?adjustment|아무것도?\s*(?:구동|좌우|변경)하지\s*않|자체\s*(?:보정|조정)(?:은|를)?\s*(?:하지\s*않|없)/i.test(
            w
          )
        ),
        `FR-FLOW-068 AC-2: ${copy.id} must state that the spread supplies no confidence adjustment of its own and drives nothing`
      ).toBe(true);

      // The governing confidence: the minimum within the winning bloc, after the per-member
      // adjustments; the whole committee when the vote is unanimous. The first assertion is
      // sentence-scoped because a proximity window here is satisfied by the rule's own exclusion
      // list even when the rule has been changed to a mean.
      expect(
        GOVERNING_MINIMUM.test(text),
        `FR-FLOW-068 AC-2: ${copy.id} must state that the governing confidence is the minimum taken within the winning bloc`
      ).toBe(true);
      expect(
        tiedTogether(text, WINNING_BLOC, [MINIMUM, UNANIMOUS, COMMITTEE], 480),
        `FR-FLOW-068 AC-2: ${copy.id} must state that the winning bloc is the whole committee when the vote is unanimous`
      ).toBe(true);

      // Escalation to critical fires only when that one value falls below the threshold in force.
      // The three numbers are load-bearing: 0.5 clarification, 0.7 business-decision, +0.1 for a
      // lower-tier model.
      const governing = windowsAround(text, WINNING_BLOC, 620);
      expect(
        governing.some(
          (w) =>
            CRITICAL.test(w) &&
            /0\.5/.test(w) &&
            /clarification/i.test(w) &&
            /0\.7/.test(w) &&
            /business-decision/i.test(w) &&
            /\+\s*0\.1/.test(w)
        ),
        `FR-FLOW-068 AC-2: ${copy.id} must state that only a governing confidence below the threshold in force (0.5 clarification, 0.7 business-decision, each raised by the +0.1 lower-tier model adjustment) escalates to critical`
      ).toBe(true);
    });

    it(`AC-2 [${copy.id}]: the fold mints no fifth adjustment factor`, () => {
      const text = autoOptionText(copy.relPath);

      // The four factors already in the per-member table are asserted there and derived nowhere. A
      // fifth would be a fifth uncalibrated number, so the census is the assertion.
      const table = adjustmentTable(text);
      expect(
        table,
        `FR-FLOW-068 AC-2: ${copy.id} must retain the per-member confidence adjustment table`
      ).not.toBe("");
      const factors = [...table.matchAll(ADJUSTMENT_FACTOR_ALL)].map((m) =>
        m[0].replace(/[^\d.]/g, "")
      );
      expect(
        factors,
        `FR-FLOW-068 AC-2: ${copy.id} must carry exactly the four pre-existing per-member confidence adjustment factors`
      ).toEqual(EXPECTED_FACTORS);

      // And the fold itself supplies no multiplier: no adjustment factor appears anywhere in the
      // confidence-spread section.
      expect(
        windowsAround(text, SPREAD, 480).filter((w) => ADJUSTMENT_FACTOR.test(w)),
        `FR-FLOW-068 AC-2: ${copy.id}'s confidence-spread section must supply no de-rating factor of its own`
      ).toEqual([]);
    });

    it(`AC-3 [${copy.id}]: a wide-spread unanimous committee whose governing confidence clears the threshold adopts`, () => {
      const text = autoOptionText(copy.relPath);

      // The case the pre-change text escalated to a critical HALT at terminal committee size.
      expect(
        windowsAround(text, SPREAD, 620).some(
          (w) =>
            UNANIMOUS.test(w) &&
            /0\.3/.test(w) &&
            /(?:does\s+not|never)\s+halt|adopts?\s+its\s+decision|채택하고[\s*]*(?:중단|HALT)[\s*]*하지[\s*]*않/i.test(
              w
            )
        ),
        `FR-FLOW-068 AC-3: ${copy.id} must state that a unanimous committee reporting a spread of 0.3 or more still adopts when its governing confidence stays at or above the threshold`
      ).toBe(true);
    });
  }
});
