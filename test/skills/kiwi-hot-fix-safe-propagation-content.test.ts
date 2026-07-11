import { readFileSync } from "node:fs";
import { readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// @req FR-FLOW-033
// FR-FLOW-033 — kiwi-* `--auto` safe propagation preserves child safety gates uniformly across
// runtime variants (committee decision D4).
//
// RED-phase content assertions. These assert the FINAL desired state: the `kiwi-hot-fix --auto`
// delegation to `kiwi-srs-sync` propagates ONLY `--auto` and must NOT auto-synthesize the
// gate-bypassing `--auto-apply` / `--yes-all` flags (those propagate only when the user explicitly
// supplied them). Today the claude variant DEFINES `--auto` as the synthesis `--auto-apply
// --yes-all` and propagates it, bypassing kiwi-srs-sync's dry-run precedence + user-approval gate;
// codex/etc already forbid that synthesis. So AC-1 / AC-2 are RED for claude and GREEN for
// codex/etc until the claude SKILL.md + _shared/kiwi/auto-option.md are aligned to the safe side.
//
// A SKILL.md / auto-option.md is natural-language agent instruction, not executable code, so
// behavior is verified by raw-text presence + window-proximity assertions (FR-FLOW-014 / FR-FLOW-025
// precedent), keyed on bilingual (English mirror / Korean canonical) technical tokens so the Korean
// claude variant and the English codex/etc mirrors are validated by the same checks.

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const VARIANTS = ["claude", "codex", "etc"] as const;

/** Concatenated text of every markdown file under a skill directory for a variant. */
function skillText(variant: string, skill: string): string {
  const dir = path.join(REPO_ROOT, "skills", variant, skill);
  const parts: string[] = [];
  function walk(directory: string): void {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const abs = path.join(directory, entry.name);
      if (entry.isDirectory()) walk(abs);
      else if (entry.isFile() && entry.name.endsWith(".md")) parts.push(readFileSync(abs, "utf8"));
    }
  }
  walk(dir);
  return parts.join("\n\n");
}

function autoOptionText(variant: string): string {
  return readFileSync(
    path.join(REPO_ROOT, "skills", variant, "_shared", "kiwi", "auto-option.md"),
    "utf8",
  );
}

/** Text windows of +/- `radius` chars around every match of `re` within a single `text`. */
function windowsAround(text: string, re: RegExp, radius = 250): string[] {
  const g = new RegExp(re.source, re.flags.replace("g", "") + "g");
  const out: string[] = [];
  for (let m = g.exec(text); m; m = g.exec(text)) {
    out.push(text.slice(Math.max(0, m.index - radius), m.index + m[0].length + radius));
    if (g.lastIndex === m.index) g.lastIndex++;
  }
  return out;
}

// --- Bilingual token vocabulary (EN mirrors + KO canonical) ------------------------------------
const AUTO = /--auto\b/;
const APPLY = /--auto-apply/;
// "propagate only --auto" / "only `--auto`" / "`--auto` only" / "`--auto` 만 전파" / "`--auto` 단독".
const ONLY_AUTO =
  /propagate\s+only|only\s+`?--auto|`?--auto`?\s+only|`--auto`\s*만|`--auto`\s*단독/i;
// Restriction: do not / never auto-add the direct-apply flags.
const NO_ADD = /do not add|never add|not\s+add\b|추가하지\s*않|덧붙이지\s*않|추가\s*안\s*(?:함|한다)/i;
// Guard: apply flags propagate ONLY when the user explicitly supplied them.
const EXPLICIT =
  /unless the user explicitly|user explicitly supplied|explicitly supplied|사용자가\s*직접|사용자가\s*명시/i;
// Harmful synthesis: `--auto` auto-expanding into the adjacent `--auto-apply --yes-all` combo, or an
// explicit `= --auto-apply` equation. A "/" or "or"/"and" separator between the two apply flags is
// the SAFE form and deliberately does NOT match.
const SYNTH = /--auto-apply`?\s*(?:\+\s*)?`?--yes-all|=\s*`?\s*--auto-apply/;
// AC-3 tokens: kiwi-srs-sync keeps dry-run precedence; only explicit --auto-apply/--yes-all skip it.
const DRY_RUN = /dry-run/i;
const PRECEDE = /선행|의무|before any|precede|mandatory|must\b/i;

describe("FR-FLOW-033 — kiwi-* --auto safe propagation across runtime variants", () => {
  for (const variant of VARIANTS) {
    it(`AC-1 [${variant}]: kiwi-hot-fix --auto sync delegation propagates only --auto, never auto-synthesizes --auto-apply/--yes-all`, () => {
      const text = skillText(variant, "kiwi-hot-fix");

      // Primary red driver: some window around a `--auto-apply` mention must state the safe
      // contract — propagate only `--auto`, do not add the apply flags, unless the user explicitly
      // supplied them. Absent in claude today (claude synthesizes instead).
      const safeContract = windowsAround(text, APPLY).some(
        (w) => AUTO.test(w) && ONLY_AUTO.test(w) && NO_ADD.test(w) && EXPLICIT.test(w),
      );
      expect(
        safeContract,
        `FR-FLOW-033 AC-1: ${variant} kiwi-hot-fix must state that --auto sync delegation propagates only --auto and does not auto-add --auto-apply/--yes-all unless the user explicitly supplied them`,
      ).toBe(true);

      // The skill body must NOT define/propagate the synthesis (`--auto-apply --yes-all` adjacency
      // or a `= --auto-apply` equation). Present in claude today at §0.14/§0.G4/§0.G6/§1.2/§6.2.1.
      const synthesized = SYNTH.test(text);
      expect(
        synthesized,
        `FR-FLOW-033 AC-1: ${variant} kiwi-hot-fix must not auto-synthesize --auto-apply --yes-all from --auto`,
      ).toBe(false);
    });

    it(`AC-2 [${variant}]: auto-option.md special-propagation table forbids hot-fix→srs-sync synthesis`, () => {
      const text = autoOptionText(variant);

      // The kiwi-hot-fix -> kiwi-srs-sync propagation row must carry the safe contract.
      const safeRow = windowsAround(text, /kiwi-hot-fix/, 300).some(
        (w) => APPLY.test(w) && ONLY_AUTO.test(w) && NO_ADD.test(w) && EXPLICIT.test(w),
      );
      expect(
        safeRow,
        `FR-FLOW-033 AC-2: ${variant} auto-option.md must state the kiwi-hot-fix --auto -> kiwi-srs-sync propagation adds only --auto and never --auto-apply/--yes-all unless the user explicitly supplied them`,
      ).toBe(true);

      // No window around a kiwi-hot-fix mention may still assert the synthesis (§7.1 row / §11
      // migration row today in claude).
      const synthesizedRow = windowsAround(text, /kiwi-hot-fix/, 250).some((w) => SYNTH.test(w));
      expect(
        synthesizedRow,
        `FR-FLOW-033 AC-2: ${variant} auto-option.md must not describe kiwi-hot-fix --auto as synthesizing --auto-apply --yes-all`,
      ).toBe(false);
    });

    it(`AC-3 [${variant}]: kiwi-srs-sync retains dry-run precedence so --auto alone cannot skip user approval`, () => {
      const text = skillText(variant, "kiwi-srs-sync");

      // The safety invariant that makes aligning to `--auto`-only propagation safe: kiwi-srs-sync
      // keeps its mandatory dry-run precedence, and only an explicit --auto-apply/--yes-all skips
      // it — so a parent's `--auto` alone cannot bypass the user-approval gate.
      const dryRunGated = windowsAround(text, DRY_RUN, 200).some(
        (w) => APPLY.test(w) && PRECEDE.test(w),
      );
      expect(
        dryRunGated,
        `FR-FLOW-033 AC-3: ${variant} kiwi-srs-sync must keep dry-run precedence mandatory, skipped only by an explicit --auto-apply/--yes-all`,
      ).toBe(true);
    });
  }
});
