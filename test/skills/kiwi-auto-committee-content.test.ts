import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// @req FR-FLOW-025
// FR-FLOW-025 — `--auto` decision committee sizing and unanimity escalation.
//
// RED-phase content assertions (T-PH001-03). These assert the FINAL desired state of the shared
// `_shared/kiwi/auto-option.md` SSOT and therefore FAIL until T-PH001-04 rewrites the topology and
// merge rules in all three variants (claude KO, codex/etc EN) to a research-performing decision
// committee with the 3->5->7 unanimity-escalation ladder and lead-member (#1) deterministic
// tie-break.
//
// An auto-option.md is natural-language agent instruction, not executable code, so behavior is
// verified by raw-text presence + indexOf/window proximity assertions (FR-FLOW-014 kiwi-step
// precedent), not skill execution. Assertions key on bilingual (English / Korean) technical tokens
// so the Korean canonical (claude) variant and the English mirrors (codex, etc) are validated by
// the same checks.
//
// The primary red drivers are tokens that are ABSENT from all three variants today — the committee
// concept itself (`committee` / `위원회`), unanimity (`unanimous` / `만장일치`), the tie-break notion
// (`tie` / `동점`), and a 7-member escalation near the committee. Pre-existing near-miss tokens
// (claude already says "다수결 (3중 2)" and "격상", and "0.5"/"0.7" contain bare digits) are
// neutralized by scoping every specific assertion to a window around the (absent) committee /
// unanimity / tie anchors, so a stray pre-existing token cannot satisfy an assertion.
//
// Per FR-FLOW-025 Implementation Notes, the imprecise "replacing the prior block-instead-of-ask"
// phrasing is NOT asserted (prior --auto semantics vary per skill); instead AC-1 asserts the new
// committee wording plus the guardrail that critical / business-decision gates STILL halt.

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

// T-PH001-04 rewrites the committee ladder in all three variant auto-option.md files.
const VARIANTS = ["claude", "codex", "etc"] as const;

function autoOptionText(variant: string): string {
  return readFileSync(
    path.join(REPO_ROOT, "skills", variant, "_shared", "kiwi", "auto-option.md"),
    "utf8",
  );
}

/** Text windows of +/- `radius` chars around every match of `re` within a single `text`. */
function windowsAround(text: string, re: RegExp, radius = 300): string[] {
  const g = new RegExp(re.source, re.flags.replace("g", "") + "g");
  const out: string[] = [];
  for (let m = g.exec(text); m; m = g.exec(text)) {
    out.push(text.slice(Math.max(0, m.index - radius), m.index + m[0].length + radius));
    if (g.lastIndex === m.index) g.lastIndex++;
  }
  return out;
}

// --- Bilingual token vocabulary (EN mirrors + KO canonical) ------------------------------------
const COMMITTEE = /committee|위원회/i; // absent today in every variant -> anchor red driver
const RESEARCH = /research|investigat|리서치|조사|연구/i;
const SELECT = /select|choose|adopt|most[\s-]*reasonable|선택|채택|가장\s*합리/i;
const AUTO_FLAG = /--auto\b/;
const MAX_FLAG = /--max\b/;
// Member counts match only when adjacent to a member/counter word, so an unrelated decimal
// ("confidence >= 0.5") or section number ("§5") cannot satisfy a committee-size assertion.
const THREE = /\b3[\s-]*(?:members?|인|명|위원)|three[\s-]*members?|셋|세\s*(?:명|위원)/i;
const FIVE = /\b5[\s-]*(?:members?|인|명|위원)|five[\s-]*members?|다섯/i;
const SEVEN = /\b7[\s-]*(?:members?|인|명|위원)|seven[\s-]*members?|일곱/i;
// `unanimous` already appears once as a JSON `merge_method` enum value in claude/codex, so it is
// NOT globally absent; the escalation checks stay red by requiring it to co-occur with the (absent)
// escalation-to-5 wording inside one window.
const UNANIMOUS = /unanim|만장일치|전원\s*일치/i;
const ESCALATE = /escalat|격상|증원|확대|상향/i;
const PLURALITY = /plurality|most[\s-]*votes|다수결|최다\s*(?:득표|표)/i;
const TIE = /\btie(?:s|[-\s]?break(?:er)?)?\b|동점|동률/i; // absent today -> tie-break red driver
const LEAD =
  /lead(?:ing)?\b|선임|수석|위원장|first\s+(?:committee\s+)?member|member\s+#?\s*1\b|#\s*1\b|1\s*번|1\s*순위|ranking|랭킹/i;
const HALT = /\bhalt\b|중단|정지|멈춤/i;
const CRITICAL = /critical/i;

describe("FR-FLOW-025 — --auto decision committee sizing and unanimity escalation", () => {
  for (const variant of VARIANTS) {
    it(`AC-1 [${variant}]: --auto convenes a 3-member research-performing committee, critical/business gates still halt`, () => {
      const text = autoOptionText(variant);

      // The committee concept must exist at all — this is the primary AC-1 red driver (no variant
      // mentions a decision committee today; they describe 1 worker for --auto).
      expect(
        COMMITTEE.test(text),
        `FR-FLOW-025 AC-1: ${variant} auto-option.md must describe a --auto decision committee (committee / 위원회)`,
      ).toBe(true);

      // Discriminating co-occurrence: a window around a committee mention must tie --auto + a
      // 3-member sizing + research investigation + the select-the-most-reasonable-option decision,
      // so GREEN cannot pass by naming an unrelated "committee", nor by describing research without
      // the selection step, nor without the 3-member sizing.
      const tied = windowsAround(text, COMMITTEE).some(
        (w) => AUTO_FLAG.test(w) && THREE.test(w) && RESEARCH.test(w) && SELECT.test(w),
      );
      expect(
        tied,
        `FR-FLOW-025 AC-1: ${variant} auto-option.md must state that --auto convenes a 3-member research-performing committee that selects the most reasonable option`,
      ).toBe(true);

      // Guardrail: critical gates STILL halt under --auto even with the committee (per FR-FLOW-025
      // Implementation Notes review guardrail). Scoped to a window around a `halt` token requiring
      // `critical`, so the check verifies still-halt semantics rather than mere keyword presence
      // anywhere in the file. (business-decision gates auto-decide UNLESS listed in critical_gates,
      // so only the unconditional critical-halt is asserted here.)
      const criticalHalts = windowsAround(text, HALT, 150).some((w) => CRITICAL.test(w));
      expect(
        criticalHalts,
        `FR-FLOW-025 AC-1: ${variant} auto-option.md must keep critical gates halting for the user under --auto`,
      ).toBe(true);
    });

    it(`AC-2 [${variant}]: --max raises the committee to 5 members`, () => {
      const text = autoOptionText(variant);

      const tied = windowsAround(text, COMMITTEE).some((w) => MAX_FLAG.test(w) && FIVE.test(w));
      expect(
        tied,
        `FR-FLOW-025 AC-2: ${variant} auto-option.md must state that --max raises the decision committee to 5 members`,
      ).toBe(true);
    });

    it(`AC-3 [${variant}]: non-unanimous 3->5 escalation, 5-member plurality, lead-member tie-break`, () => {
      const text = autoOptionText(variant);

      // Non-unanimous 3-member committee escalates to 5 and re-decides. Anchored on `unanimous`
      // (absent today) so it is genuinely red and cannot be satisfied by claude's pre-existing
      // "격상" wording alone.
      const escalates = windowsAround(text, UNANIMOUS, 400).some(
        (w) => ESCALATE.test(w) && THREE.test(w) && FIVE.test(w),
      );
      expect(
        escalates,
        `FR-FLOW-025 AC-3: ${variant} auto-option.md must state a non-unanimous 3-member committee escalates to 5 and re-decides`,
      ).toBe(true);

      // Non-unanimous 5-member (non-max) committee decides by plurality. Scoped to a 5-member
      // committee window so claude's pre-existing "다수결 (3중 2)" (a 3-worker arbitration, no
      // committee, no 5) cannot satisfy it.
      const plurality5 = windowsAround(text, PLURALITY, 300).some(
        (w) => FIVE.test(w) && COMMITTEE.test(w),
      );
      expect(
        plurality5,
        `FR-FLOW-025 AC-3: ${variant} auto-option.md must state a non-unanimous 5-member committee decides by plurality (most votes)`,
      ).toBe(true);

      // Any tie is broken deterministically by the lead committee member (#1) ranking. Anchored on
      // `tie` / 동점 (absent today).
      const tieBreak = windowsAround(text, TIE, 300).some((w) => LEAD.test(w));
      expect(
        tieBreak,
        `FR-FLOW-025 AC-3: ${variant} auto-option.md must break a committee tie deterministically by the lead committee member (#1) ranking`,
      ).toBe(true);
    });

    it(`AC-4 [${variant}]: under --max a non-unanimous 5-member committee escalates to 7 plurality with tie-break`, () => {
      const text = autoOptionText(variant);

      // Under --max, a non-unanimous 5-member committee escalates to 7. Anchored on the committee
      // window requiring --max + a 7-member sizing + escalation from 5 (all absent today). Radius
      // widened to 500 to tolerate the doc's occasionally long Korean sentences for this 4-way
      // co-occurrence.
      const escalates7 = windowsAround(text, COMMITTEE, 500).some(
        (w) => MAX_FLAG.test(w) && SEVEN.test(w) && ESCALATE.test(w) && FIVE.test(w),
      );
      expect(
        escalates7,
        `FR-FLOW-025 AC-4: ${variant} auto-option.md must state that under --max a non-unanimous 5-member committee escalates to 7 members`,
      ).toBe(true);

      // The 7-member committee decides by plurality, without requiring unanimity.
      const plurality7 = windowsAround(text, COMMITTEE, 500).some(
        (w) => SEVEN.test(w) && PLURALITY.test(w),
      );
      expect(
        plurality7,
        `FR-FLOW-025 AC-4: ${variant} auto-option.md must state the 7-member committee decides by plurality (most votes) without requiring unanimity`,
      ).toBe(true);

      // AC-4 restates the deterministic lead-member tie-break for the 7-member committee. Anchored
      // on a 7-member sizing window (absent today) requiring TIE + LEAD, so GREEN cannot pass
      // without stating the lead-member (#1) ranking tie-break applies at the 7-member level.
      const tieBreak7 = windowsAround(text, SEVEN, 500).some((w) => TIE.test(w) && LEAD.test(w));
      expect(
        tieBreak7,
        `FR-FLOW-025 AC-4: ${variant} auto-option.md must break a 7-member committee tie deterministically by the lead committee member (#1) ranking`,
      ).toBe(true);
    });
  }
});
