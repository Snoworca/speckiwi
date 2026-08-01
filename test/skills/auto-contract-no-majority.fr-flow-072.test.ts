import { describe, expect, it } from "vitest";

import {
  AUTO_OPTION_COPIES,
  COMMITTEE,
  CRITICAL,
  HALT,
  LEAD_MEMBER,
  MAJORITY,
  RUNG,
  TIE_BREAK,
  autoOptionText,
  windowsAround
} from "../support/auto-option-copies.js";

// @req FR-FLOW-072
// FR-FLOW-072 — a committee with no majority, or with a degraded quorum, escalates to critical.
//
// With 3 members and one dropped, two remain and a 1-1 among them has no majority, so the old rule
// fell straight to the lead member and quietly became single-agent decision-making. Closing only
// the quorum row would have left that mechanism live one row below it in the same table, which is
// why the lead-member row is deleted in the same change.
//
// AC-4 and AC-5 constrain `decideAutoGate`, whose `tieRung: boolean` construction parameter ships
// `false`; they are covered by `test/core/orchestrator/auto-gate.fr-node-124.test.ts` and are not
// duplicated here. This suite covers the contract text: AC-1, AC-2 and AC-3.

describe("FR-FLOW-072 — no-majority and degraded-quorum committees escalate to critical and halt", () => {
  for (const copy of AUTO_OPTION_COPIES) {
    it(`AC-1 [${copy.id}]: a committee with no majority escalates to critical and halts`, () => {
      const text = autoOptionText(copy.relPath);

      const noMajority = windowsAround(
        text,
        /no\s+majority|과반(?:이|을)?\s*(?:없|형성되지\s*않|아니)/i,
        420
      );
      expect(
        noMajority.length,
        `FR-FLOW-072 AC-1: ${copy.id} must state what happens when a committee produces no majority`
      ).toBeGreaterThan(0);

      expect(
        noMajority.some((w) => CRITICAL.test(w) && HALT.test(w)),
        `FR-FLOW-072 AC-1: ${copy.id} must escalate a no-majority gate to critical and halt for the user`
      ).toBe(true);

      // The two worked shapes: 1-1-1 among 3 under --auto, and any tie among 5 under --auto --max.
      expect(
        noMajority.some((w) => /1-1-1/.test(w)) || /1-1-1/.test(text),
        `FR-FLOW-072 AC-1: ${copy.id} must name the 1-1-1 among 3 members under --auto as a no-majority case`
      ).toBe(true);

      // No rung adds members and no re-vote is held.
      expect(
        noMajority.filter((w) => RUNG.test(w)),
        `FR-FLOW-072 AC-1: ${copy.id} must add no members and hold no re-vote on a no-majority result`
      ).toEqual([]);
    });

    it(`AC-2 [${copy.id}]: the degraded-quorum row escalates to critical unconditionally`, () => {
      const text = autoOptionText(copy.relPath);

      const quorum = windowsAround(text, /quorum|정족수/i, 320);
      expect(
        quorum.length,
        `FR-FLOW-072 AC-2: ${copy.id} must keep a degraded-quorum rule`
      ).toBeGreaterThan(0);

      expect(
        quorum.every((w) => CRITICAL.test(w)),
        `FR-FLOW-072 AC-2: ${copy.id}'s degraded-quorum rule must escalate to critical`
      ).toBe(true);

      // The drop-the-member-and-proceed branch is removed: no quorum window may make proceeding
      // conditional on a remaining majority.
      expect(
        quorum.filter((w) =>
          /proceed\s+only\s+if|drop\s+it\s+and\s+proceed|proceed\s+while|제외하고\s*(?:과반\s*)?정족수\s*충족되면\s*진행/i.test(
            w
          )
        ),
        `FR-FLOW-072 AC-2: ${copy.id} must remove the branch that drops the failed member and proceeds while a majority quorum remains`
      ).toEqual([]);

      // Paired positive: one re-spawn, then the gate halts.
      expect(
        quorum.some((w) =>
          /(?:re-?spawn|retry)[^.\n]{0,60}(?:once|1회|한\s*번)|(?:once|1회|한\s*번)[^.\n]{0,40}(?:re-?spawn|retry|재spawn)/i.test(
            w
          )
        ),
        `FR-FLOW-072 AC-2: ${copy.id} must keep the single re-spawn before the gate halts`
      ).toBe(true);
    });

    it(`AC-3 [${copy.id}]: no lead-member tie-break survives anywhere in the contract text`, () => {
      const text = autoOptionText(copy.relPath);

      // No tie-break is attributed to a lead or senior member. Asserted as a co-occurrence rather
      // than as absence of the words "lead member": FR-FLOW-069 AC-1 requires the contract to
      // EXCLUDE the lead member's confidence by name, so the phrase legitimately survives in a
      // sentence that denies it a role. What must not survive is a lead member deciding anything.
      expect(
        windowsAround(text, TIE_BREAK, 300).filter((w) => LEAD_MEMBER.test(w)),
        `FR-FLOW-072 AC-3: ${copy.id} must delete the lead-member row and every lead-member tie-break mechanism`
      ).toEqual([]);

      // Nor to member #1 by its designation, which is how the deleted row named it.
      expect(
        windowsAround(text, /(?:member|위원)\s*#\s*1\b/i, 300).filter((w) => TIE_BREAK.test(w)),
        `FR-FLOW-072 AC-3: ${copy.id} must not designate member #1 as a tie-breaker`
      ).toEqual([]);

      // The tie-break concept does not survive as a committee mechanism either — a tie is a
      // no-majority result and halts.
      expect(
        windowsAround(text, TIE_BREAK, 260).filter((w) => COMMITTEE.test(w) && !CRITICAL.test(w)),
        `FR-FLOW-072 AC-3: ${copy.id} must not settle a committee tie by any mechanism other than escalating to critical`
      ).toEqual([]);

      // Paired positive: a tie IS a no-majority result, stated so the deletion leaves no gap.
      expect(
        windowsAround(text, /\btie\b|동점/i, 320).some(
          (w) => MAJORITY.test(w) && CRITICAL.test(w)
        ),
        `FR-FLOW-072 AC-3: ${copy.id} must state that a tie is a no-majority result that escalates to critical`
      ).toBe(true);
    });
  }
});
