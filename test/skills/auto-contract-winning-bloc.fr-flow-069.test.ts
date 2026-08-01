import { describe, expect, it } from "vitest";

import {
  AUTO_OPTION_COPIES,
  CRITICAL,
  MINIMUM,
  WINNING_BLOC,
  autoOptionText,
  tiedTogether,
  windowsAround
} from "../support/auto-option-copies.js";

// @req FR-FLOW-069
// FR-FLOW-069 — under a split vote the governing confidence is the minimum within the winning bloc.
//
// Under the removed unanimity rule "the confidence" was unambiguous. Under a 2-1 it is undefined,
// and the conservative reading is what keeps §4.1.1's x0.7 penalty for an empty `side_effects[]`
// biting on exactly the irreversible and externally visible gates the `leave-all-three` decision
// leaves committee-decided.
//
// Three readings are excluded by name — the mean of the winning bloc, the minimum or mean across
// all members, and the lead member's confidence. AC-3 is the discriminating case: the dissenting
// member's confidence must not enter the comparison at all, which is why a committee-wide
// adjustment cannot be reintroduced under any other heading.

describe("FR-FLOW-069 — governing confidence under a split vote is the minimum within the winning bloc", () => {
  for (const copy of AUTO_OPTION_COPIES) {
    it(`AC-1 [${copy.id}]: the rule is stated, and taken after the per-member adjustments`, () => {
      const text = autoOptionText(copy.relPath);

      expect(
        WINNING_BLOC.test(text),
        `FR-FLOW-069 AC-1: ${copy.id} must name the winning bloc`
      ).toBe(true);

      expect(
        tiedTogether(text, WINNING_BLOC, [MINIMUM, /split|non-?unanimous|2-1|분할|비만장일치/i], 480),
        `FR-FLOW-069 AC-1: ${copy.id} must state that under a split vote the governing confidence is the minimum within the winning bloc`
      ).toBe(true);

      // Order matters: the adjustments are applied first, then the minimum is taken.
      expect(
        windowsAround(text, WINNING_BLOC, 480).some((w) =>
          /after\s+(?:the\s+)?(?:§\s*4\.1\.1'?s?\s+)?(?:per-member\s+)?adjust|adjust\w*\s+(?:are\s+)?applied[^.\n]{0,60}before[^.\n]{0,40}minimum|(?:조정|보정)[^.\n]{0,30}적용[^.\n]{0,20}(?:뒤|후)[^.\n]{0,70}최소/i.test(
            w
          )
        ),
        `FR-FLOW-069 AC-1: ${copy.id} must state that the per-member adjustments are applied before the minimum is taken`
      ).toBe(true);

      // The three excluded readings are named, so a later reader cannot substitute a mean.
      const excluded = windowsAround(text, WINNING_BLOC, 620);
      expect(
        excluded.some(
          (w) =>
            /mean|average|평균/i.test(w) &&
            /all\s+members|전\s*위원|모든\s*위원/i.test(w) &&
            /lead\s+member|선임\s*위원/i.test(w)
        ),
        `FR-FLOW-069 AC-1: ${copy.id} must exclude by name the mean of the bloc, the minimum or mean across all members, and the lead member's confidence`
      ).toBe(true);
    });

    it(`AC-2 [${copy.id}]: a 2-1 business-decision carrying 0.9 and 0.6 escalates to critical`, () => {
      const text = autoOptionText(copy.relPath);

      expect(
        windowsAround(text, /0\.9\b/, 420).some(
          (w) =>
            /0\.6\b/.test(w) &&
            /0\.7\b/.test(w) &&
            /business-decision/i.test(w) &&
            CRITICAL.test(w)
        ),
        `FR-FLOW-069 AC-2: ${copy.id} must work the case where a 2-1 business-decision whose winning members carry 0.9 and 0.6 escalates to critical against the 0.7 threshold`
      ).toBe(true);
    });

    it(`AC-3 [${copy.id}]: the same gate at 0.9 and 0.75 adopts, and the dissenter does not count`, () => {
      const text = autoOptionText(copy.relPath);

      expect(
        windowsAround(text, /0\.75\b/, 420).some(
          (w) => /0\.9\b/.test(w) && /adopt|채택/i.test(w)
        ),
        `FR-FLOW-069 AC-3: ${copy.id} must work the case where a 2-1 whose winning members carry 0.9 and 0.75 adopts`
      ).toBe(true);

      // The dissenting member's confidence — whatever its value — does not enter the comparison.
      expect(
        windowsAround(text, /dissent|반대(한)?\s*위원|소수\s*의견/i, 420).some((w) =>
          /does\s+not\s+enter|is\s+not\s+(?:considered|compared|included)|whatever\s+its\s+value|비교에?\s*(?:들어가지|포함되지)\s*않/i.test(
            w
          )
        ),
        `FR-FLOW-069 AC-3: ${copy.id} must state that the dissenting member's confidence does not enter the comparison`
      ).toBe(true);
    });

    it(`AC-4 [${copy.id}]: the x0.7 empty side_effects adjustment is preserved and applied per member`, () => {
      const text = autoOptionText(copy.relPath);

      // Preserved verbatim: the row still names an empty `side_effects[]` on a mutation gate and
      // still carries the 0.7 factor.
      expect(
        windowsAround(text, /side_effects/, 220).some(
          (w) =>
            /(?:빈\s*배열|empty)/i.test(w) &&
            /mutation/i.test(w) &&
            /(?:×|\*|\bx\b|multiply by)\s*0\.7/i.test(w)
        ),
        `FR-FLOW-069 AC-4: ${copy.id} must preserve the x0.7 adjustment for a mutation gate with an empty side_effects[]`
      ).toBe(true);

      // Applied to EACH member's confidence, before the minimum within the winning bloc is taken.
      expect(
        windowsAround(text, MINIMUM, 480).some((w) =>
          /each\s+member|per-?member|위원\s*(?:별|각각)|각\s*위원/i.test(w)
        ),
        `FR-FLOW-069 AC-4: ${copy.id} must state that the adjustments are applied to each member's confidence before the minimum is taken`
      ).toBe(true);
    });
  }
});
