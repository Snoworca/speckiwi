import { describe, expect, it } from "vitest";

import {
  COMMITTEE,
  LOCAL_LLM_PROFILE,
  LOCAL_LLM_PROFILE_ABSENT_FROM,
  MAX_FLAG,
  RUNG,
  readRepoFile,
  repoFileExists,
  sentences,
  windowsAround
} from "../support/auto-option-copies.js";

// @req FR-FLOW-071
// FR-FLOW-071 — the `etc` local-LLM profile's committee carve-out survives the `--auto` rewrite.
//
// `local-llm-profile.md` makes the `etc` rendering behave as if `--max` were enabled by default,
// but carves the `--auto` committee out of that default. If the carve-out is lost in the rewrite,
// every `etc` host silently jumps to a 5-member committee on every gate — sequential, because the
// same file disables multi-worker fanout.
//
// Per the 2026-08-01 committee (D-A6, 5-0) the carve-out's substance survives and only its pointer
// to the deleted ladder goes: `escalating per auto-option.md §2/§3` becomes `deciding by simple
// majority per auto-option.md`, with no other byte changed. Two members independently found the
// pointer is already dangling today — the `etc` rendering of `auto-option.md`, the only rendering
// in which this file exists, has no numbered sections at all.

const PROFILE = () => readRepoFile(LOCAL_LLM_PROFILE);

describe("FR-FLOW-071 — etc local-LLM profile committee carve-out preserved through the --auto rewrite", () => {
  it("AC-1: the --max default and single-worker policy govern the verification loop only", () => {
    const text = PROFILE();

    expect(
      /govern\s+the\s+verification\/evaluation\s+loop\s+only/i.test(text),
      "FR-FLOW-071 AC-1: the profile must state that the etc --max default and the single-worker policy govern the verification/evaluation loop only"
    ).toBe(true);

    // Sized by auto-option.md at 3 for --auto and 5 for --auto --max.
    expect(
      windowsAround(text, /auto-option\.md/, 320).some(
        (w) => /3[\s-]*members?/i.test(w) && /5[\s-]*members?/i.test(w) && /--auto\b/.test(w)
      ),
      "FR-FLOW-071 AC-1: the profile must state that the --auto committee is sized by auto-option.md at 3 members for --auto and 5 for --auto --max"
    ).toBe(true);

    expect(
      /the\s+etc\s+`?--max`?\s+default\s+does\s+not\s+force\s+the\s+committee\s+to\s+5/i.test(text),
      "FR-FLOW-071 AC-1: the profile must state that the etc --max default does not force the committee to 5"
    ).toBe(true);
  });

  it("AC-2: the committee is a scoped exception to the single-worker policy", () => {
    const text = PROFILE();

    expect(
      /scoped\s+exception/i.test(text),
      "FR-FLOW-071 AC-2: the profile must call the --auto decision committee a scoped exception to the single-worker policy"
    ).toBe(true);

    expect(
      windowsAround(text, /sequential/i, 320).some(
        (w) => COMMITTEE.test(w) && /size|voting|merge/i.test(w) && /preserv/i.test(w)
      ),
      "FR-FLOW-071 AC-2: the profile must state that members run sequentially while committee size, voting and merge logic from auto-option.md are preserved"
    ).toBe(true);
  });

  it("AC-3: local-llm-profile.md exists in exactly one rendering", () => {
    expect(
      repoFileExists(LOCAL_LLM_PROFILE),
      "FR-FLOW-071 AC-3: the etc rendering must keep local-llm-profile.md"
    ).toBe(true);

    for (const relPath of LOCAL_LLM_PROFILE_ABSENT_FROM) {
      expect(
        repoFileExists(relPath),
        `FR-FLOW-071 AC-3: ${relPath} must not be created by this change`
      ).toBe(false);
    }
  });

  it("AC-4: no sentence implies a committee size other than 3 and 5, or a size-escalation rung", () => {
    const text = PROFILE();

    const committeeSentences = sentences(text).filter((s) => COMMITTEE.test(s));
    expect(
      committeeSentences.length,
      "FR-FLOW-071 AC-4: the profile must still discuss the --auto committee"
    ).toBeGreaterThan(0);

    // Every member count asserted about the committee is 3 or 5.
    const sizes = committeeSentences
      .flatMap((s) => [...s.matchAll(/\b(\d+)[\s-]*members?\b/gi)])
      .map((m) => Number(m[1]));
    expect(
      [...new Set(sizes)].sort((a, b) => a - b),
      "FR-FLOW-071 AC-4: the profile must state only 3-member and 5-member committee sizes"
    ).toEqual([3, 5]);

    // ... and none of them describes an escalation rung. `--max` raising the committee from 3 to 5
    // is sizing, not a rung, and is deliberately outside RUNG.
    expect(
      committeeSentences.filter((s) => RUNG.test(s)),
      "FR-FLOW-071 AC-4: no sentence about the committee may describe a committee-size escalation rung"
    ).toEqual([]);

    // Paired positive for the one byte D-A6 changed: the pointer now names the decision rule.
    expect(
      windowsAround(text, /5-member\s+committee/i, 200).some(
        (w) => /simple\s+majority/i.test(w) && /auto-option\.md/.test(w)
      ),
      "FR-FLOW-071 AC-4: the carve-out must point at auto-option.md's simple-majority rule rather than at the deleted ladder"
    ).toBe(true);

    // The carve-out itself is unchanged: --max still raises the committee and is not a no-op.
    expect(
      windowsAround(text, MAX_FLAG, 240).some((w) =>
        /raises\s+the\s+committee\s+and\s+is\s+not\s+a\s+no-op/i.test(w)
      ),
      "FR-FLOW-071 AC-4: the profile must keep stating that --max raises the committee and is not a no-op"
    ).toBe(true);
  });
});
