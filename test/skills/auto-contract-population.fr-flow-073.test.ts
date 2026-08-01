import { describe, expect, it } from "vitest";

import {
  AUTO_OPTION_COPIES,
  COMMITTEE,
  GOVERNING_MINIMUM,
  MINIMUM,
  RUNG,
  SPREAD,
  WINNING_BLOC,
  autoOptionText,
  readRepoFile,
  tiedTogether,
  windowsAround
} from "../support/auto-option-copies.js";

// @req FR-FLOW-073
// FR-FLOW-073 — the committee-decided gate population is bounded by the two carried conditions.
//
// The `leave-all-three` answer was re-decided rather than inherited: it stays, because halting for
// the user removes the named unacceptable outcome — settlement by one member alone — more
// completely than the dropped tie rung did, while promoting the three gates to `critical_gates[]`
// would halt on every invocation including a unanimous 3-0.
//
// The decision named a SAMPLE and not a boundary: any gate with no declared severity is classified
// `business-decision`, so the affected population is open-ended by design. The real boundary is
// `critical_gates[]` membership plus the two carried conditions, which is why neither condition may
// be dropped as an independent optimisation.

/** The three irreversible or externally visible non-critical gates named in the impact study. */
const SAMPLE_GATES = [
  {
    skill: "kiwi-srs-sync",
    gate: "apply-selected",
    // `marker` finds the gate's description; `idMarker` finds it inside a critical_gates row.
    marker: /apply-selected/,
    idMarker: /apply-selected/
  },
  {
    skill: "kiwi-commit-auto-push",
    gate: "Closes versus Refs trailer choice",
    marker: /`?Closes`?\s*(?:vs\.?|versus)\s*`?Refs`?/i,
    idMarker: /closes[-\s]*(?:vs|versus|or)[-\s]*refs|refs[-\s]*trailer[-\s]*choice|issue[-\s]*trailer[-\s]*choice/i
  },
  {
    skill: "kiwi-commit-auto-pr",
    gate: "existing-PR-body preserve versus --update-pr-body",
    marker: /본문\s*보존\s*vs\s*`?--update-pr-body`?|preserve\s*(?:vs\.?|versus)\s*`?--update-pr-body`?/i,
    idMarker: /update-pr-body|pr-body-(?:preserve|overwrite|update)/i
  }
] as const;

const SKILL_VARIANTS = ["claude", "codex", "etc"] as const;

/** The `critical_gates[]` declarations in a skill body: everything inside a `[{gate_id: ...}]`. */
function criticalGateDeclarations(text: string): string[] {
  return [...text.matchAll(/critical_gates(?:\[\])?[^\n]*?(\[\s*\{[\s\S]*?\}\s*\])/g)].map(
    (m) => m[1]
  );
}

/** Every `gate_id` a skill body registers as critical, from declarations and from table rows. */
function criticalGateIds(text: string): string[] {
  return [...text.matchAll(/gate_id:\s*"([^"]+)"/g)].map((m) => m[1]);
}

describe("FR-FLOW-073 — committee-decided gate population bounded by the two carried conditions", () => {
  for (const { skill, gate, marker, idMarker } of SAMPLE_GATES) {
    it(`AC-1 [${skill}]: ${gate} is registered as critical in no rendering`, () => {
      // AC-1 is a claim about every rendering of the skill, so all of them are read. A gate the
      // change promoted would show up as a `critical_gates[]` member or a registered `gate_id`.
      for (const variant of SKILL_VARIANTS) {
        const text = readRepoFile(`skills/${variant}/${skill}/SKILL.md`);

        expect(
          criticalGateDeclarations(text).filter((d) => idMarker.test(d)),
          `FR-FLOW-073 AC-1: ${variant} ${skill} must not add ${gate} to critical_gates[]`
        ).toEqual([]);
        expect(
          criticalGateIds(text).filter((id) => idMarker.test(id)),
          `FR-FLOW-073 AC-1: ${variant} ${skill} must register no critical gate_id for ${gate}`
        ).toEqual([]);
      }
    });

    it(`AC-2 [${skill}]: ${gate} stays a business-decision gate decided under --auto`, () => {
      // The impact study names these gates in the Korean canonical rendering, which is where the
      // "critical_gates 외 게이트" line enumerates the gates `--auto` decides. Asserting the
      // enumeration is what makes AC-1's absence a decision rather than the gate having vanished.
      const text = readRepoFile(`skills/claude/${skill}/SKILL.md`);

      expect(
        marker.test(text),
        `FR-FLOW-073 AC-2: claude ${skill} must still describe the ${gate} gate`
      ).toBe(true);
      expect(
        windowsAround(text, marker, 420).some((w) =>
          /--auto[^\n]{0,160}(?:서브에이전트\s*결정|committee|위원회|decision)|자동\s*결정\s*대상|business-decision/i.test(
            w
          )
        ),
        `FR-FLOW-073 AC-2: claude ${skill} must keep ${gate} as a business-decision gate decided under --auto`
      ).toBe(true);
    });
  }

  for (const copy of AUTO_OPTION_COPIES) {
    it(`AC-3 [${copy.id}]: both carried conditions are in the contract text`, () => {
      const text = autoOptionText(copy.relPath);

      // Condition 1 — the minimum within the winning bloc under a split vote.
      expect(
        GOVERNING_MINIMUM.test(text) &&
          tiedTogether(text, WINNING_BLOC, [MINIMUM, /split|2-1|분할/i], 480),
        `FR-FLOW-073 AC-3: ${copy.id} must carry the minimum-within-the-winning-bloc rule for a split vote`
      ).toBe(true);

      // Condition 2 — the fold of the spread cross-check, with no re-vote on spread alone.
      expect(
        windowsAround(text, SPREAD, 480).filter((w) => RUNG.test(w)),
        `FR-FLOW-073 AC-3: ${copy.id} must carry the fold of the confidence-spread cross-check with no re-vote on spread alone`
      ).toEqual([]);
      expect(
        SPREAD.test(text),
        `FR-FLOW-073 AC-3: ${copy.id} must still describe the confidence spread it folded`
      ).toBe(true);
    });

    it(`AC-4 [${copy.id}]: a gate with no declared severity and no critical_gates[] row is business-decision`, () => {
      const text = autoOptionText(copy.relPath);

      expect(
        windowsAround(text, /business-decision/i, 320).some(
          (w) =>
            /no\s+explicit\s+severity|severity\s*가?\s*명시되지\s*않|no\s+declared\s+severity/i.test(
              w
            ) && /critical_gates/.test(w)
        ),
        `FR-FLOW-073 AC-4: ${copy.id} must keep classifying a gate with no declared severity and no critical_gates[] row as business-decision`
      ).toBe(true);

      // The boundary is that rule plus the two conditions, not an enumerated gate list: the
      // contract names no closed set of committee-decided gates.
      expect(
        windowsAround(text, COMMITTEE, 300).filter((w) =>
          /the\s+(?:only|complete|exhaustive)\s+(?:list|set)\s+of\s+(?:gates|committee-decided)/i.test(
            w
          )
        ),
        `FR-FLOW-073 AC-4: ${copy.id} must not enumerate a closed set of committee-decided gates`
      ).toEqual([]);
    });
  }
});
