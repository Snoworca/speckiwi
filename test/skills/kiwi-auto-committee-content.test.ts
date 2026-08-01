import { describe, expect, it } from "vitest";

import {
  AUTO_FLAG,
  AUTO_OPTION_COPIES,
  COMMITTEE,
  CRITICAL,
  FIVE,
  HALT,
  IMMEDIATELY,
  MAX_FLAG,
  RESEARCH,
  RUNG,
  SELECT,
  SEVEN,
  SIMPLE_MAJORITY,
  THREE,
  UNANIMOUS,
  autoOptionText,
  tiedTogether,
  windowsAround
} from "../support/auto-option-copies.js";

// @req FR-FLOW-025
// FR-FLOW-025 — `--auto` decision committee sizing and simple-majority decision, as amended for
// `2.6.0-phase1-kiwi-orchestrator`.
//
// AC-1 and AC-2 survive the amendment byte-identical and their assertions are carried forward
// unchanged. AC-3 and AC-4 are REPLACED: the unanimity requirement and the 3->5 / 5->7 escalation
// ladders are removed, and both committee sizes decide by simple majority.
//
// This file is FR-FLOW-025's `VE-2`, and before the amendment its AC-3 / AC-4 cases asserted the
// removed mechanism — the 3->5 escalation, the 5-member plurality, the 5->7 escalation and the
// lead-member tie-break. That is why the rewrite is the amendment's red driver rather than a
// clean-up after it.
//
// An `auto-option.md` is natural-language agent instruction, not executable code, so behaviour is
// verified by raw-text presence and window-proximity assertions rather than by skill execution.
// Assertions key on bilingual tokens so the Korean canonical (`claude`) and the three English
// renderings (`codex`, `etc`, `.agents`) are validated by the same checks.
//
// Rung ABSENCE is asserted as a structural claim over the whole file — "no window pairs an
// escalation verb with two committee sizes" — never as `not.toContain` over one spelling of one
// sentence, which a wrapped line or a synonym would satisfy vacuously. Every absence claim below
// sits beside the positive assertion of what replaced it.

describe("FR-FLOW-025 — --auto decision committee sizing and simple-majority decision", () => {
  for (const copy of AUTO_OPTION_COPIES) {
    it(`AC-1 [${copy.id}]: --auto convenes a 3-member research-performing committee, critical gates still halt`, () => {
      const text = autoOptionText(copy.relPath);

      expect(
        COMMITTEE.test(text),
        `FR-FLOW-025 AC-1: ${copy.id} must describe a --auto decision committee (committee / 위원회)`
      ).toBe(true);

      // A window around a committee mention must tie --auto + 3-member sizing + research + the
      // select-the-most-reasonable-option step, so an unrelated "committee", or research with no
      // selection step, cannot satisfy it.
      expect(
        tiedTogether(text, COMMITTEE, [AUTO_FLAG, THREE, RESEARCH, SELECT]),
        `FR-FLOW-025 AC-1: ${copy.id} must state that --auto convenes a 3-member research-performing committee that selects the most reasonable option`
      ).toBe(true);

      // Guardrail: critical gates STILL halt under --auto (FR-FLOW-025 Implementation Notes).
      expect(
        windowsAround(text, HALT, 150).some((w) => CRITICAL.test(w)),
        `FR-FLOW-025 AC-1: ${copy.id} must keep critical gates halting for the user under --auto`
      ).toBe(true);
    });

    it(`AC-2 [${copy.id}]: --max raises the committee to 5 members`, () => {
      const text = autoOptionText(copy.relPath);

      expect(
        tiedTogether(text, COMMITTEE, [MAX_FLAG, FIVE]),
        `FR-FLOW-025 AC-2: ${copy.id} must state that --max raises the decision committee to 5 members`
      ).toBe(true);
    });

    it(`AC-3 [${copy.id}]: the 3-member committee decides by simple majority and adopts immediately`, () => {
      const text = autoOptionText(copy.relPath);

      // Positive: the 3-member committee's decision rule is a simple majority, adopted immediately.
      expect(
        tiedTogether(text, THREE, [SIMPLE_MAJORITY, IMMEDIATELY], 420),
        `FR-FLOW-025 AC-3: ${copy.id} must state that the 3-member committee decides by simple majority and adopts that option immediately`
      ).toBe(true);

      // The option holding strictly more than half of the votes cast — the definition is stated, so
      // "majority" is not left to the reader to interpret as "most votes among three options".
      expect(
        /(strictly\s+)?more\s+than\s+half|과반(수)?\s*(초과|를\s*넘)|절반\s*(을\s*)?(초과|넘)/i.test(text),
        `FR-FLOW-025 AC-3: ${copy.id} must define simple majority as strictly more than half of the votes cast`
      ).toBe(true);
    });

    it(`AC-3 [${copy.id}]: no 3-to-5 enlargement rung survives`, () => {
      const text = autoOptionText(copy.relPath);

      // Structural absence: no escalation verb anywhere sits within one window of both a 3-member
      // and a 5-member sizing. Before the amendment every copy satisfied this, which is what makes
      // the assertion able to fail rather than vacuous.
      const enlargements = windowsAround(text, RUNG, 260).filter(
        (w) => THREE.test(w) && FIVE.test(w)
      );
      expect(
        enlargements,
        `FR-FLOW-025 AC-3: ${copy.id} must contain no 3-to-5 committee-enlargement rung`
      ).toEqual([]);

      // Paired positive: a non-unanimous result is decided, not escalated.
      expect(
        tiedTogether(text, UNANIMOUS, [SIMPLE_MAJORITY], 420),
        `FR-FLOW-025 AC-3: ${copy.id} must state that a committee decides by simple majority without requiring unanimity`
      ).toBe(true);
    });

    it(`AC-4 [${copy.id}]: under --max the 5-member committee decides by simple majority, with no 5-to-7 rung`, () => {
      const text = autoOptionText(copy.relPath);

      expect(
        tiedTogether(text, FIVE, [SIMPLE_MAJORITY], 420),
        `FR-FLOW-025 AC-4: ${copy.id} must state that the 5-member committee decides by simple majority without requiring unanimity`
      ).toBe(true);

      // No 7-member committee exists anywhere in the contract, at any sizing or in any example.
      expect(
        windowsAround(text, SEVEN, 0),
        `FR-FLOW-025 AC-4: ${copy.id} must contain no 7-member committee`
      ).toEqual([]);

      // ... and no enlargement rung of any size remains, so the ladder cannot survive under a
      // different pair of numbers than the two AC-3 names.
      const enlargements = windowsAround(text, RUNG, 260).filter((w) => COMMITTEE.test(w));
      expect(
        enlargements,
        `FR-FLOW-025 AC-4: ${copy.id} must contain no committee-enlargement rung at any size`
      ).toEqual([]);
    });
  }
});
