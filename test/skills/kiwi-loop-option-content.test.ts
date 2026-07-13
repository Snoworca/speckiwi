import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// @req FR-FLOW-034
// @req FR-FLOW-035
// FR-FLOW-034 — Loop round-cap flags (--mini preset, --loops counter) across kiwi skills.
// FR-FLOW-035 — Orchestrator propagation of loop round-cap flags to delegated kiwi sub-skills.
//
// RED-phase content assertions. These assert the FINAL desired state and therefore FAIL until the
// `_shared/kiwi/loop-option.md` SSOT is authored, the `--mini` / `--loops N` option rows are added to
// each kiwi skill, and the orchestrators are wired to propagate the flags to their sub-skills.
//
// A SKILL.md is natural-language agent instruction, not executable code, so behavior is verified by
// raw-text presence + windowed proximity assertions (FR-FLOW-014 / FR-FLOW-022 precedent), not by
// executing the skill. Tokens are language-neutral (`--mini`, `--loops`, `loop-option`) plus bilingual
// (English / Korean) regexes so the Korean canonical (claude) and the mirrors (codex / etc) validate
// under the same checks.

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const VARIANTS = ["claude", "codex", "etc"] as const;

// Skills that run a verify/improve (or eval) loop → the round cap applies operationally.
const LOOP_SKILLS = [
  "kiwi-srs",
  "kiwi-srs-feasibility",
  "kiwi-srs-from-code",
  "kiwi-srs-sync",
  "kiwi-planner",
  "kiwi-coder",
  "kiwi-hot-fix",
  "kiwi-review-fix-loop",
  "kiwi-commit-auto-push",
  "kiwi-commit-auto-pr",
] as const;

// Skills with no round-capped loop → accept the flags as a documented no-op for orchestration uniformity.
const NO_LOOP_SKILLS = ["kiwi-step", "kiwi-srs-research"] as const;

// Orchestrators that spawn/delegate to other kiwi skills → must propagate the flags to children.
const ORCHESTRATORS = ["kiwi-pm", "kiwi-pipeline", "kiwi-wave-master", "kiwi-hot-fix", "kiwi-coder"] as const;

const MINI = /--mini\b/;
const LOOPS = /--loops\b/;
const LOOP_SSOT = /loop-option/;
const PRECEDENCE = /우선|precede|wins|override|overrides|takes precedence/i;
const WARN = /경고|warn/i;
const RESIDUAL = /잔여|residual|보고|report/i;
const ROUND_CAP = /라운드|round|루프.{0,6}상한|상한|\bcap\b/i;
const ORTHOGONAL = /직교|orthogonal|독립|compose|조합/i;
const PROPAGATE = /전파|propagat|forward|하위\s*스킬|sub-skill|자식|child/i;

function relPosix(f: string): string {
  return path.relative(REPO_ROOT, f).split(path.sep).join("/");
}

function skillFile(variant: string, skill: string): string {
  return path.join(REPO_ROOT, "skills", variant, skill, "SKILL.md");
}

function readSkill(variant: string, skill: string): string {
  const f = skillFile(variant, skill);
  return existsSync(f) ? readFileSync(f, "utf8") : "";
}

function loopOptionPath(variant: string): string {
  return path.join(REPO_ROOT, "skills", variant, "_shared", "kiwi", "loop-option.md");
}

/** Text windows of +/- `radius` chars around every match of `re` within a single `text`. */
function windowsAround(text: string, re: RegExp, radius = 200): string[] {
  const g = new RegExp(re.source, re.flags.replace("g", "") + "g");
  const out: string[] = [];
  for (let m = g.exec(text); m; m = g.exec(text)) {
    out.push(text.slice(Math.max(0, m.index - radius), m.index + m[0].length + radius));
    if (g.lastIndex === m.index) g.lastIndex++;
  }
  return out;
}

describe("FR-FLOW-034 — loop-option.md SSOT defines --mini / --loops semantics", () => {
  it("AC-5: _shared/kiwi/loop-option.md exists in claude, codex, and etc variants", () => {
    const missing = VARIANTS.filter((v) => !existsSync(loopOptionPath(v))).map((v) =>
      relPosix(loopOptionPath(v)),
    );
    expect(missing, `FR-FLOW-034 AC-5: loop-option.md SSOT missing in: ${missing.join(", ")}`).toEqual([]);
  });

  it("AC-2/AC-3/AC-4/AC-6: loop-option.md documents cap=3, --loops N, precedence+warn, residual reporting, and --max orthogonality", () => {
    for (const v of VARIANTS) {
      const p = loopOptionPath(v);
      if (!existsSync(p)) continue; // existence asserted separately; skip content when absent
      const text = readFileSync(p, "utf8");
      const rel = relPosix(p);
      expect(MINI.test(text), `${rel}: must document --mini`).toBe(true);
      expect(LOOPS.test(text), `${rel}: must document --loops`).toBe(true);
      expect(
        windowsAround(text, MINI, 160).some((w) => /\b3\b/.test(w)),
        `${rel}: --mini must map to a 3-round cap (a '3' near a --mini mention)`,
      ).toBe(true);
      expect(ROUND_CAP.test(text), `${rel}: must describe the round cap`).toBe(true);
      // Precedence: an explicit --loops wins over --mini, with a warning.
      const precedenceTied = windowsAround(text, LOOPS, 240).some(
        (w) => PRECEDENCE.test(w) && WARN.test(w),
      );
      expect(
        precedenceTied,
        `${rel}: must state --loops wins over --mini with a warning (precedence+warn near --loops)`,
      ).toBe(true);
      expect(RESIDUAL.test(text), `${rel}: must describe residual-finding reporting when the cap is reached`).toBe(
        true,
      );
      expect(ORTHOGONAL.test(text), `${rel}: must state --mini/--loops are orthogonal to --max`).toBe(true);
    }
  });
});

describe("FR-FLOW-034 — round-cap loop skills accept --mini / --loops and reference the SSOT", () => {
  for (const skill of LOOP_SKILLS) {
    for (const variant of VARIANTS) {
      it(`AC-1 [${variant}/${skill}]: documents --mini and --loops and references loop-option.md`, () => {
        const text = readSkill(variant, skill);
        const rel = relPosix(skillFile(variant, skill));
        expect(text.length, `${rel}: file must exist`).toBeGreaterThan(0);
        expect(MINI.test(text), `${rel}: must document --mini`).toBe(true);
        expect(LOOPS.test(text), `${rel}: must document --loops`).toBe(true);
        expect(LOOP_SSOT.test(text), `${rel}: must reference the _shared/kiwi/loop-option.md SSOT`).toBe(true);
      });
    }
  }
});

describe("FR-FLOW-034 — no-loop skills accept --mini / --loops as a documented no-op", () => {
  for (const skill of NO_LOOP_SKILLS) {
    for (const variant of VARIANTS) {
      it(`AC-1 [${variant}/${skill}]: documents --mini and --loops`, () => {
        const text = readSkill(variant, skill);
        const rel = relPosix(skillFile(variant, skill));
        expect(text.length, `${rel}: file must exist`).toBeGreaterThan(0);
        expect(MINI.test(text), `${rel}: must document --mini (no-op accepted for orchestration uniformity)`).toBe(
          true,
        );
        expect(LOOPS.test(text), `${rel}: must document --loops (no-op accepted for orchestration uniformity)`).toBe(
          true,
        );
      });
    }
  }
});

describe("FR-FLOW-035 — orchestrators propagate --mini / --loops to sub-skills", () => {
  for (const skill of ORCHESTRATORS) {
    for (const variant of VARIANTS) {
      it(`[${variant}/${skill}]: forwards --mini/--loops to delegated sub-skills`, () => {
        const text = readSkill(variant, skill);
        const rel = relPosix(skillFile(variant, skill));
        expect(text.length, `${rel}: file must exist`).toBeGreaterThan(0);
        expect(MINI.test(text), `${rel}: must mention --mini`).toBe(true);
        expect(LOOPS.test(text), `${rel}: must mention --loops`).toBe(true);
        // A propagation token must appear near a --mini or --loops mention.
        const propagates =
          windowsAround(text, MINI, 260).some((w) => PROPAGATE.test(w)) ||
          windowsAround(text, LOOPS, 260).some((w) => PROPAGATE.test(w));
        expect(
          propagates,
          `${rel}: must document propagating --mini/--loops to its kiwi sub-skills (propagation token near the flags)`,
        ).toBe(true);
      });
    }
  }

  it("AC-6: kiwi-pm's child-spawn no longer carries a dead MINI= reference to the removed model-swap flag", () => {
    // The stale `MINI={true if args.mini else false}` leftover must be repurposed. If a `MINI=` token
    // survives, it must sit alongside the new --mini/--loops forwarding (not reference the removed flag).
    for (const variant of VARIANTS) {
      const text = readSkill(variant, "kiwi-pm");
      const rel = relPosix(skillFile(variant, "kiwi-pm"));
      const deadRef = /MINI=\{[^}]*args\.mini[^}]*\}/.test(text);
      expect(deadRef, `${rel}: stale MINI={... args.mini ...} dead reference must be removed/repurposed`).toBe(
        false,
      );
    }
  });
});
