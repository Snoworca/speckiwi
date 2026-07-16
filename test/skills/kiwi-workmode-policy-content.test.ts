import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// @req FR-FLOW-040
// FR-FLOW-040 — tdd_policy default derives from work-mode with explicit-flag precedence.
//
// Content assertions verifying the shared derivation SSOT and its two consumers per packaged variant:
//  - `_shared/kiwi/workmode-policy.md` defines the work-mode → tdd_policy mapping (tdd → strict, else
//    relaxed), states `disabled` is never derived (explicit flag only), and that an explicit
//    `--tdd-policy` wins over the derived default with a non-fatal WARN.
//  - kiwi-planner cites the shared doc, reads the work-mode in Phase 0, and applies the derived
//    default (explicit flag wins with a WARN).
//  - kiwi-pm emits a non-HALT contradiction warning when the input plan's tdd_policy contradicts the
//    current work-mode, while its existing tdd_policy=disabled rejection stays.
//
// A SKILL.md / shared doc is natural-language agent instruction, not executable code. These
// language-neutral token checks key on tool names (get_work_mode, speckiwi mode), tdd_policy values,
// the exact arrow mapping, and WARN, plus a bilingual regex for prose concepts.

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const VARIANTS = ["claude", "codex", "etc"] as const;

function readShared(variant: string): string {
  return readFileSync(
    path.join(REPO_ROOT, "skills", variant, "_shared", "kiwi", "workmode-policy.md"),
    "utf8",
  );
}

function readSkill(variant: string, skill: string): string {
  return readFileSync(path.join(REPO_ROOT, "skills", variant, skill, "SKILL.md"), "utf8");
}

function skillBody(text: string): string {
  return text.replace(/^---[\s\S]*?\n---\s*\n?/, "");
}

/** Text windows of +/- `radius` chars around every match of `re` within a single `text`. */
function windowsAround(text: string, re: RegExp, radius: number): string[] {
  const g = new RegExp(re.source, re.flags.replace("g", "") + "g");
  const out: string[] = [];
  for (let m = g.exec(text); m; m = g.exec(text)) {
    out.push(text.slice(Math.max(0, m.index - radius), m.index + m[0].length + radius));
    if (g.lastIndex === m.index) g.lastIndex++;
  }
  return out;
}

// The exact arrow mapping, authored identically in every variant (the `| tdd | strict |` table row
// alone does not satisfy this — the prose "tdd → strict" line is required).
const MAPPING = /tdd\s*→\s*strict/;
const RELAXED = /relaxed/;
const DISABLED = /disabled/;
const DERIVE = /deriv|파생/i;
const NEVER = /never|않는|않고|only|명시|explicit/i;
const TDD_POLICY_FLAG = /--tdd-policy/;
const WARN = /WARN/;
const WINS = /wins|이긴|이김|이깁|override|우선/i;
const GET_WORK_MODE = /get_work_mode/;
const CLI_MODE = /speckiwi mode/;
const POLICY_DOC = /workmode-policy\.md/;
const CONTRADICTION = /모순|contradic|mismatch|불일치|conflict/i;
const NON_HALT = /non-?HALT|비-?HALT/i;

describe("FR-FLOW-040 — tdd_policy default derives from work-mode with explicit-flag precedence", () => {
  for (const variant of VARIANTS) {
    describe(`variant: ${variant}`, () => {
      it("AC-1: workmode-policy.md defines the mapping, disabled-never-derived, and explicit-over-derived WARN", () => {
        const doc = readShared(variant);
        expect(doc).toMatch(/work-mode/);
        expect(doc).toMatch(/tdd_policy/);
        expect(MAPPING.test(doc), `FR-FLOW-040 AC-1: ${variant} workmode-policy.md must map tdd → strict`).toBe(
          true,
        );
        expect(
          RELAXED.test(doc),
          `FR-FLOW-040 AC-1: ${variant} workmode-policy.md must map non-tdd modes to relaxed`,
        ).toBe(true);
        // disabled is never derived — a prohibition cue + a derive cue near every `disabled`.
        const disabledNeverDerived = windowsAround(doc, DISABLED, 240).some(
          (win) => NEVER.test(win) && DERIVE.test(win),
        );
        expect(
          disabledNeverDerived,
          `FR-FLOW-040 AC-1: ${variant} workmode-policy.md must state disabled is never derived (explicit flag only)`,
        ).toBe(true);
        // explicit --tdd-policy wins over the derived default, with a non-fatal WARN.
        const explicitWins = windowsAround(doc, TDD_POLICY_FLAG, 320).some(
          (win) => WINS.test(win) && WARN.test(win),
        );
        expect(
          explicitWins,
          `FR-FLOW-040 AC-1: ${variant} workmode-policy.md must state explicit --tdd-policy wins over the derived default with a WARN`,
        ).toBe(true);
      });

      it("AC-2: kiwi-planner cites the shared doc, reads the work-mode in Phase 0, and applies the derived default (explicit wins)", () => {
        const body = skillBody(readSkill(variant, "kiwi-planner"));
        expect(
          POLICY_DOC.test(body),
          `FR-FLOW-040 AC-2: ${variant} kiwi-planner must cite workmode-policy.md`,
        ).toBe(true);
        expect(
          GET_WORK_MODE.test(body),
          `FR-FLOW-040 AC-2: ${variant} kiwi-planner must read the work-mode via get_work_mode`,
        ).toBe(true);
        expect(
          CLI_MODE.test(body),
          `FR-FLOW-040 AC-2: ${variant} kiwi-planner must fall back to \`speckiwi mode\``,
        ).toBe(true);
        expect(
          MAPPING.test(body),
          `FR-FLOW-040 AC-2: ${variant} kiwi-planner must apply the tdd → strict derived default`,
        ).toBe(true);
        // explicit flag wins over the derived default, with a WARN.
        const explicitWins = windowsAround(body, TDD_POLICY_FLAG, 320).some(
          (win) => WINS.test(win) && WARN.test(win),
        );
        expect(
          explicitWins,
          `FR-FLOW-040 AC-2: ${variant} kiwi-planner must state explicit --tdd-policy wins over the derived default (WARN)`,
        ).toBe(true);
      });

      it("AC-3: kiwi-pm adds a non-HALT contradiction warning citing the shared doc, and keeps the disabled rejection", () => {
        const body = skillBody(readSkill(variant, "kiwi-pm"));
        expect(
          POLICY_DOC.test(body),
          `FR-FLOW-040 AC-3: ${variant} kiwi-pm must cite workmode-policy.md`,
        ).toBe(true);
        // non-HALT contradiction warning when plan tdd_policy contradicts the current work-mode.
        const contradiction = windowsAround(body, /work-mode/, 340).some(
          (win) => CONTRADICTION.test(win) && WARN.test(win) && NON_HALT.test(win),
        );
        expect(
          contradiction,
          `FR-FLOW-040 AC-3: ${variant} kiwi-pm must emit a non-HALT contradiction warning`,
        ).toBe(true);
        // The existing tdd_policy=disabled rejection (HALT in claude, 거부 in codex/etc) stays unchanged.
        expect(
          /tdd_policy\s*=\s*"disabled"[\s\S]{0,40}(HALT|거부|reject)/i.test(body),
          `FR-FLOW-040 AC-3: ${variant} kiwi-pm must keep the tdd_policy=disabled rejection`,
        ).toBe(true);
      });
    });
  }
});
