import { describe, expect, it } from "vitest";

import {
  AUTO_OPTION_COPIES,
  autoOptionText,
  jsonBlockAfter,
  windowsAround
} from "../support/auto-option-copies.js";

// @req FR-FLOW-070
// FR-FLOW-070 — the `--auto` decision audit log records zero-vote adoptions, and the
// `merge_method.rule` vocabulary is restated in full.
//
// A fast-pathed decision has zero votes, no confidence and no committee size, so without an
// explicit shape it is not recorded at all — the decisions that received no deliberation would be
// precisely the ones leaving no evidence.
//
// The vocabulary is restated rather than extended: `default-if-auto` needs its own literal because
// `adopt-default-if-auto` is already a member of the closed `AutoGateAction`, `plurality` becomes
// `majority` because that is what the simple-majority rule and the shipped kernel both write, and
// `tie-break-lead` is deleted with the row that produced it.
//
// The schema is asserted by PARSING the fenced example rather than by substring matching, so a
// criterion naming a field and a value ("committee_size": 0) is checked against structure. An
// escalated gate is not an adoption: it is recorded under `critical_halts[]`, so `escalated` is
// correctly absent from a vocabulary that enumerates adoption rules.

const RULE_VOCABULARY = ["majority", "recommended-fastpath", "default-if-auto"] as const;

/** Every `merge_method.rule` value in the copy's audit-log section, in document order. */
function ruleValues(text: string): string[] {
  return [...text.matchAll(/"rule"\s*:\s*"([^"]+)"/g)].map((m) => m[1]);
}

interface AuditDecision {
  merge_method?: { rule?: string; committee_size?: number; marked_by?: string };
  committee_votes?: unknown[];
  vote_outcome?: string;
}

function auditDecisions(text: string): AuditDecision[] {
  const parsed = jsonBlockAfter(text, /##\s*(?:10\.\s*분석 로그|Logging)/) as {
    decisions?: AuditDecision[];
  };
  return parsed.decisions ?? [];
}

describe("FR-FLOW-070 — --auto decision audit log records zero-vote adoptions", () => {
  for (const copy of AUTO_OPTION_COPIES) {
    it(`AC-1 [${copy.id}]: the merge_method.rule vocabulary is exactly the three literals`, () => {
      const text = autoOptionText(copy.relPath);

      // The enumeration itself, stated in prose beside the schema.
      for (const literal of RULE_VOCABULARY) {
        expect(
          new RegExp("`" + literal + "`").test(text),
          `FR-FLOW-070 AC-1: ${copy.id} must enumerate \`${literal}\` in the merge_method.rule vocabulary`
        ).toBe(true);
      }

      // Every value the schema actually writes is drawn from that vocabulary — a set assertion, so
      // an extra literal fails as loudly as a missing one.
      const used = [...new Set(ruleValues(text))].sort();
      expect(
        used,
        `FR-FLOW-070 AC-1: ${copy.id}'s audit schema must write only the three vocabulary literals`
      ).toEqual([...RULE_VOCABULARY].sort());

      // `plurality` and `tie-break-lead` are gone as rule values. Asserted against the extracted
      // values rather than the raw file, so the claim is about the vocabulary and not about a
      // sentence that happens to spell the word.
      expect(
        used.filter((v) => v === "plurality" || v === "tie-break-lead"),
        `FR-FLOW-070 AC-1: ${copy.id} must not use plurality or tie-break-lead as a merge_method.rule value`
      ).toEqual([]);
      expect(
        windowsAround(text, /tie-break-lead/, 0),
        `FR-FLOW-070 AC-1: ${copy.id} must delete tie-break-lead from the vocabulary entirely`
      ).toEqual([]);
    });

    it(`AC-2 [${copy.id}]: a recommended adoption writes recommended-fastpath with committee_size 0`, () => {
      const decisions = auditDecisions(autoOptionText(copy.relPath));

      const fastpath = decisions.filter((d) => d.merge_method?.rule === "recommended-fastpath");
      expect(
        fastpath.length,
        `FR-FLOW-070 AC-2: ${copy.id}'s audit schema must show a recommended-fastpath adoption`
      ).toBeGreaterThan(0);

      for (const d of fastpath) {
        expect(d.merge_method?.committee_size).toBe(0);
        expect(
          typeof d.merge_method?.marked_by,
          `FR-FLOW-070 AC-2: ${copy.id} must record marked_by as the gate declaration site`
        ).toBe("string");
        // Empty rather than absent: an empty array is a claim, an absent field is silence.
        expect(
          d.committee_votes,
          `FR-FLOW-070 AC-2: ${copy.id}'s fast-pathed adoption must carry no committee vote entries`
        ).toEqual([]);
      }
    });

    it(`AC-3 [${copy.id}]: a default_if_auto adoption writes default-if-auto with committee_size 0`, () => {
      const decisions = auditDecisions(autoOptionText(copy.relPath));

      const fallback = decisions.filter((d) => d.merge_method?.rule === "default-if-auto");
      expect(
        fallback.length,
        `FR-FLOW-070 AC-3: ${copy.id}'s audit schema must show a default-if-auto adoption`
      ).toBeGreaterThan(0);

      for (const d of fallback) {
        expect(d.merge_method?.committee_size).toBe(0);
        expect(typeof d.merge_method?.marked_by).toBe("string");
        expect(
          d.committee_votes,
          `FR-FLOW-070 AC-3: ${copy.id}'s default-if-auto adoption must carry no committee vote entries`
        ).toEqual([]);
      }

      // The two bypasses ranked above the committee are distinguishable in the log.
      const zeroVote = decisions.filter((d) => d.merge_method?.committee_size === 0);
      expect(
        [...new Set(zeroVote.map((d) => d.merge_method?.rule))].sort(),
        `FR-FLOW-070 AC-3: ${copy.id}'s two zero-vote bypasses must be distinguishable by rule`
      ).toEqual(["default-if-auto", "recommended-fastpath"]);
    });

    it(`AC-4 [${copy.id}]: a committee adoption writes majority with one vote entry per member`, () => {
      const decisions = auditDecisions(autoOptionText(copy.relPath));

      const committee = decisions.filter((d) => d.merge_method?.rule === "majority");
      const sizes = committee.map((d) => d.merge_method?.committee_size).sort();
      expect(
        sizes,
        `FR-FLOW-070 AC-4: ${copy.id}'s audit schema must show a 3-member (--auto) and a 5-member (--auto --max) committee adoption`
      ).toEqual([3, 5]);

      for (const d of committee) {
        expect(
          d.committee_votes?.length,
          `FR-FLOW-070 AC-4: ${copy.id} must record one committee_votes[] entry per participating member`
        ).toBe(d.merge_method?.committee_size);
      }
    });

    it(`AC-5 [${copy.id}]: unanimous is an outcome and never a rule`, () => {
      const text = autoOptionText(copy.relPath);
      const decisions = auditDecisions(text);

      expect(
        ruleValues(text).filter((v) => v === "unanimous"),
        `FR-FLOW-070 AC-5: ${copy.id} must never write unanimous as a merge_method.rule value`
      ).toEqual([]);

      // Paired positive: it survives in the schema, as a vote outcome.
      expect(
        decisions.some((d) => d.vote_outcome === "unanimous"),
        `FR-FLOW-070 AC-5: ${copy.id}'s audit schema must record unanimous as a description of a vote outcome`
      ).toBe(true);
    });
  }
});
