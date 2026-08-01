import { globSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  AUTO_FLAG,
  AUTO_OPTION_COPIES,
  COMMITTEE,
  DEFAULT_IF_AUTO,
  HALT,
  IMMEDIATELY,
  LEAD_MEMBER,
  MAJORITY,
  NO_MACHINE_MEANING,
  PROSE_RECOMMENDATION_LABEL,
  RECOMMENDED_MARKER,
  REPO_ROOT,
  TIE_BREAK,
  autoOptionText,
  readRepoFile,
  tiedTogether,
  windowsAround
} from "../support/auto-option-copies.js";

// @req FR-FLOW-067
// FR-FLOW-067 — a `recommended: true` gate option is adopted with no committee under `--auto`.
//
// The charter's first half of the `--auto` change. Three edits travel with it and each is asserted
// separately: the reworded §3 prohibition (which as written forbade the feature being added), the
// bypass precedence (two bypasses with different scopes and no ranking), and the marker being a
// structured field rather than a prose scan (two of `kiwi-pm`'s three `(권장)` labels annotate a
// HALT option, so a prose scan would auto-adopt a recommended HALT).
//
// Deliberately NOT asserted, because the charter excludes it: any field, criterion or prose
// describing WHY an option carries a recommendation. AC-3's last clause is the negative guard, and
// it is written as a positive schema-shape assertion so it cannot pass vacuously.

/** The four `kiwi-pm` renderings that declare the `NEEDS_USER` option schema. */
const KIWI_PM_COPIES = [
  { id: "claude", relPath: "skills/claude/kiwi-pm/SKILL.md" },
  { id: "codex", relPath: "skills/codex/kiwi-pm/SKILL.md" },
  { id: "etc", relPath: "skills/etc/kiwi-pm/SKILL.md" },
  { id: "agents-mirror", relPath: ".agents/skills/kiwi-pm/SKILL.md" }
] as const;

/** A field describing a recommendation's motive — excluded by the charter, so it must not exist. */
const MOTIVE_FIELD =
  /"?recommend(?:ed|ation)_(?:reason|because|motive|why|kind|rationale)"?|"?why_recommended"?|"?recommendation_(?:type|basis)"?/i;

describe("FR-FLOW-067 — recommended-marked gate option adopted with no committee under --auto", () => {
  for (const copy of AUTO_OPTION_COPIES) {
    it(`AC-1 [${copy.id}]: a recommended: true option is adopted immediately, with no committee`, () => {
      const text = autoOptionText(copy.relPath);

      expect(
        RECOMMENDED_MARKER.test(text),
        `FR-FLOW-067 AC-1: ${copy.id} must declare the structured marker \`recommended: true\``
      ).toBe(true);

      // Adopted immediately, under --auto.
      expect(
        tiedTogether(text, RECOMMENDED_MARKER, [AUTO_FLAG, IMMEDIATELY], 420),
        `FR-FLOW-067 AC-1: ${copy.id} must state that under --auto a recommended: true option is adopted immediately`
      ).toBe(true);

      // No committee is convened AND no committee member is spawned — two claims, both required,
      // because "no committee is convened" alone leaves the spawn cost unaddressed.
      // `[\s*]` rather than `\s`: these documents bold the operative verb, and a pattern that
      // could never match across a `**` is the vacuous-negative trap in its positive form.
      const zeroDeliberation = windowsAround(text, RECOMMENDED_MARKER, 420).some(
        (w) =>
          /no\s+committee\s+is\s+convened|without\s+convening\s+(?:a\s+|any\s+)?committee|위원회를?[\s*]*(?:소집하지|열지)[\s*]*않/i.test(
            w
          ) &&
          /no\s+committee\s+member\s+is\s+spawned|without\s+spawning\s+any\s+committee\s+member|위원(?:을|도)?[\s*]*(?:한[\s*]*명도[\s*]*)?spawn[\s*]*하지[\s*]*않/i.test(
            w
          )
      );
      expect(
        zeroDeliberation,
        `FR-FLOW-067 AC-1: ${copy.id} must state that no committee is convened and no committee member is spawned`
      ).toBe(true);
    });

    it(`AC-2 [${copy.id}]: bypass precedence is recommended > default_if_auto > committee`, () => {
      const text = autoOptionText(copy.relPath);

      expect(
        /`?recommended`?\s*>\s*`?default_if_auto`?\s*>\s*(?:`?committee`?|위원회)/i.test(text),
        `FR-FLOW-067 AC-2: ${copy.id} must state the bypass precedence recommended > default_if_auto > committee`
      ).toBe(true);

      // A gate whose option carries BOTH markers resolves through the recommended branch, and a
      // gate carrying NEITHER reaches the committee. Both consequences are stated, not left to be
      // inferred from the ranking — the ranking alone is what the pre-change text lacked.
      expect(
        tiedTogether(
          text,
          /`?recommended`?\s*>\s*`?default_if_auto`?/i,
          [
            /both|둘\s*다|모두/i,
            DEFAULT_IF_AUTO,
            /neither|어느\s*것도|둘\s*다\s*없|없으면/i,
            COMMITTEE
          ],
          650
        ),
        `FR-FLOW-067 AC-2: ${copy.id} must state that an option carrying both markers resolves through the recommended branch and a gate carrying neither reaches the committee`
      ).toBe(true);
    });

    it(`AC-3 [${copy.id}]: the contract declares no field describing why an option is recommended`, () => {
      const text = autoOptionText(copy.relPath);

      expect(
        windowsAround(text, MOTIVE_FIELD, 0),
        `FR-FLOW-067 AC-3: ${copy.id} must declare no field describing why an option is recommended (charter exclusion)`
      ).toEqual([]);

      // Paired positive: the exclusion is stated rather than merely unimplemented, so a later
      // reader cannot add the field believing nobody had considered it.
      expect(
        /(?:no|never)\s+(?:field|criterion)[^.\n]{0,80}why[^.\n]{0,40}recommend|why\s+an\s+option\s+is\s+recommended[^.\n]{0,80}(?:not|no|never)|왜[\s*]*권장[^.\n]{0,40}(?:판단하지|보지|묻지)[\s*]*않|권장(?:된)?[\s*]*(?:이유|사유)[^.\n]{0,60}(?:판단하지|보지|묻지)[\s*]*않/i.test(
          text
        ),
        `FR-FLOW-067 AC-3: ${copy.id} must state that the contract does not judge why an option is recommended`
      ).toBe(true);
    });

    it(`AC-4 [${copy.id}]: a prose (권장) label carries no machine meaning`, () => {
      const text = autoOptionText(copy.relPath);

      expect(
        PROSE_RECOMMENDATION_LABEL.test(text),
        `FR-FLOW-067 AC-4: ${copy.id} must name the prose (권장) label it is disclaiming`
      ).toBe(true);

      expect(
        tiedTogether(text, PROSE_RECOMMENDATION_LABEL, [NO_MACHINE_MEANING], 300),
        `FR-FLOW-067 AC-4: ${copy.id} must state that a prose (권장) label carries no machine meaning and is never parsed as a recommendation`
      ).toBe(true);
    });

    it(`AC-5 [${copy.id}]: the ladder-violation prohibition admits a zero-vote fast path and no lead-member tie-break`, () => {
      const text = autoOptionText(copy.relPath);

      // The prohibition still exists and still ends in an immediate HALT. Scoped to the paragraph
      // rather than to a fixed-radius window: a window wide enough to hold the whole rule is also
      // wide enough to reach the neighbouring paragraph, and the criterion is about THIS line.
      const prohibition = text
        .split(/\n\s*\n/)
        .filter((block) => /\*\*(?:금지|Prohibited)\*\*/.test(block));
      expect(
        prohibition.length,
        `FR-FLOW-067 AC-5: ${copy.id} must keep a ladder-violation prohibition`
      ).toBeGreaterThan(0);

      // Reworded: it now permits the two declared bypasses and forbids everything else.
      expect(
        prohibition.some(
          (w) =>
            HALT.test(w) &&
            MAJORITY.test(w) &&
            RECOMMENDED_MARKER.test(w) &&
            DEFAULT_IF_AUTO.test(w)
        ),
        `FR-FLOW-067 AC-5: ${copy.id}'s prohibition must permit a declared recommended / default_if_auto bypass while still halting on any other arbitrary adoption`
      ).toBe(true);

      // And the reworded line admits no lead-member tie-break: neither a tie-break nor a lead
      // member appears in the prohibition's own text.
      expect(
        prohibition.filter((w) => LEAD_MEMBER.test(w) || TIE_BREAK.test(w)),
        `FR-FLOW-067 AC-5: ${copy.id}'s reworded prohibition must admit no lead-member tie-break`
      ).toEqual([]);
    });
  }

  // -- The marker's declaration site. `auto-option.md` consumes the field; `kiwi-pm` declares it. --
  for (const copy of KIWI_PM_COPIES) {
    it(`AC-3 [kiwi-pm ${copy.id}]: recommended is a structured boolean beside key, label and consequence`, () => {
      const text = readRepoFile(copy.relPath);

      // The `NEEDS_USER` option schema line, found by the three fields that already live on it.
      const schemaLines = text
        .split("\n")
        .filter((line) => /"key"/.test(line) && /"label"/.test(line) && /"consequence"/.test(line));
      expect(
        schemaLines.length,
        `FR-FLOW-067 AC-3: ${copy.id} must declare a NEEDS_USER option schema carrying key, label and consequence`
      ).toBeGreaterThan(0);

      expect(
        schemaLines.every((line) => /"recommended"\s*:/.test(line)),
        `FR-FLOW-067 AC-3: ${copy.id} must declare "recommended" on every NEEDS_USER option schema line, beside key, label and consequence`
      ).toBe(true);

      // Boolean, and absent by default: the schema shows `false` as the shipped value, so an option
      // that says nothing is not recommended.
      expect(
        schemaLines.every((line) => /"recommended"\s*:\s*(?:false|true\s*\|\s*false|false\s*\|\s*true)/.test(line)),
        `FR-FLOW-067 AC-3: ${copy.id} must declare "recommended" as a boolean whose default is false`
      ).toBe(true);

      expect(
        windowsAround(text, MOTIVE_FIELD, 0),
        `FR-FLOW-067 AC-3: ${copy.id} must declare no field describing why an option is recommended`
      ).toEqual([]);

      // Paired positive, on the schema being written rather than only on `auto-option.md`: the
      // exclusion is stated where the field is declared, so the slot is refused rather than merely
      // unfilled. A schema slot is the mechanism by which the excluded gate leaks back in.
      expect(
        windowsAround(text, /"recommended"\s*:/, 700).some((w) =>
          /왜[\s*]*권장[^.\n]{0,40}(?:기술|기록|판단)[^.\n]{0,20}(?:필드|기준)[^.\n]{0,20}(?:두지|없)/i.test(
            w
          )
        ),
        `FR-FLOW-067 AC-3: ${copy.id}'s schema must state that no field describes why an option is recommended`
      ).toBe(true);
    });

    it(`AC-4 [kiwi-pm ${copy.id}]: no gate option in the existing suite carries recommended: true`, () => {
      const text = readRepoFile(copy.relPath);

      // The fast path starts with no member: the schema declares the field, and no shipped option
      // sets it. `false` in the schema is the declaration; `true` anywhere would be an adoption.
      expect(
        windowsAround(text, RECOMMENDED_MARKER, 0),
        `FR-FLOW-067 AC-4: ${copy.id} must set recommended: true on no gate option, so the fast path starts with no member in the existing suite`
      ).toEqual([]);
    });
  }

  // The three prose `(권장)` labels live in the Korean canonical rendering; two of them annotate a
  // HALT option, which is why the marker is a structured field and not a prose scan.
  it("AC-4 [kiwi-pm claude]: the three (권장) prose labels survive and acquire no marker", () => {
    const text = readRepoFile("skills/claude/kiwi-pm/SKILL.md");

    expect(
      windowsAround(text, PROSE_RECOMMENDATION_LABEL, 0).length,
      "FR-FLOW-067 AC-4: the claude kiwi-pm rendering must retain its three prose (권장) labels unchanged"
    ).toBe(3);

    expect(
      windowsAround(text, PROSE_RECOMMENDATION_LABEL, 160).filter((w) =>
        RECOMMENDED_MARKER.test(w)
      ),
      "FR-FLOW-067 AC-4: the prose (권장) labels must acquire no recommended: true marker"
    ).toEqual([]);

    // Two of them annotate a HALT option — the concrete reason a prose scan is refused.
    expect(
      windowsAround(text, PROSE_RECOMMENDATION_LABEL, 120).filter((w) => /HALT/.test(w)).length,
      "FR-FLOW-067 AC-4: two of the three (권장) labels are expected to annotate a HALT option"
    ).toBe(2);
  });

  it("AC-4: no gate option in the pre-existing bundled suite carries recommended: true", () => {
    // Stated positively rather than left true by omission: the fast path ships with ZERO members,
    // and the day someone marks an option this test says so rather than staying silent.
    //
    // `kiwi-orchestrator` is excluded by name, not overlooked: its routing gates declare the marker
    // deliberately and are the fast path's first intended consumer. Every other bundled skill is in
    // scope, so a marker appearing anywhere else is caught.
    const scanned = globSync("{skills/*,.agents/skills}/kiwi-*/SKILL.md", { cwd: REPO_ROOT }).filter(
      (relPath) => !relPath.includes("kiwi-orchestrator")
    );
    // An empty glob would make the census below pass while checking nothing.
    expect(
      scanned.length,
      "FR-FLOW-067 AC-4: the census must actually reach the bundled skills"
    ).toBeGreaterThan(40);

    const marked = scanned.filter((relPath) => RECOMMENDED_MARKER.test(readRepoFile(relPath)));

    expect(
      marked,
      "FR-FLOW-067 AC-4: no pre-existing bundled skill may carry recommended: true, so the fast path starts with no member"
    ).toEqual([]);
  });
});
