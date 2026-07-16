import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// @req FR-FLOW-039
// FR-FLOW-039 — kiwi-pipeline work-mode routing gate for tdd step work.
//
// Content assertions (raw-text presence + proximity) verifying that every packaged kiwi-pipeline
// variant authors a work-mode routing gate at cycle start (Phase 0): it reads the work-mode
// (MCP `get_work_mode` preferred, CLI `speckiwi mode` fallback, fail-open `wait` when both are
// absent) and, when the mode is tdd and the work is step-scoped, routes to `kiwi-tdd` instead of the
// five-stage sdd chain, while body-scope / large-architecture work keeps the §2.5 chain. AC-3 guards
// that the §2.5 five-stage arrow chain body is unchanged (the routing gate is a separate section).
//
// A SKILL.md is natural-language agent instruction, not executable code, so the AC behavior cannot
// be run in a unit test. These language-neutral token checks key on tool names (get_work_mode,
// speckiwi mode, kiwi-tdd), universal jargon (work-mode, step-scoped, body-scope, fail-open, wait,
// sdd) plus a bilingual regex for prose concepts, matching the existing kiwi-pipeline-content style.

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const VARIANTS = ["claude", "codex", "etc"] as const;

function readSkill(variant: string): string {
  return readFileSync(path.join(REPO_ROOT, "skills", variant, "kiwi-pipeline", "SKILL.md"), "utf8");
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

// AC-3 guard: the §2.5 five-stage arrow chain must remain intact. Same regex as
// kiwi-pipeline-content.test.ts CHAINED_FIVE_STAGES (FR-FLOW-026 AC-1). Authoring the routing gate as
// a separate section must not disturb this chain body.
const ARROW = String.raw`(?:-->|->|→|⟶|=>)`;
const CHAINED_FIVE_STAGES = new RegExp(
  String.raw`kiwi-srs(?!-)[\s\S]{0,80}${ARROW}[\s\S]{0,140}kiwi-srs-feasibility[\s\S]{0,140}${ARROW}[\s\S]{0,140}kiwi-planner[\s\S]{0,100}${ARROW}[\s\S]{0,100}kiwi-pm\b[\s\S]{0,100}${ARROW}[\s\S]{0,100}kiwi-review-fix-loop`,
);

// Routing-gate tokens.
const GET_WORK_MODE = /get_work_mode/;
const CLI_MODE = /speckiwi mode/;
const FAIL_OPEN = /fail-open/i;
const WAIT = /\bwait\b/;
const KIWI_TDD = /kiwi-tdd/;
const STEP_SCOPED = /step-scoped/i;
const BODY_SCOPE = /body-scope/i;
const ROUTE = /route|라우팅|라우트|대신|instead|redirect|분기/i;
const KEEP_SDD = /\bsdd\b/i;
const KEEP = /유지|keep|retain|그대로|stays?\b|remains?\b/i;

describe("FR-FLOW-039 — kiwi-pipeline work-mode routing gate", () => {
  for (const variant of VARIANTS) {
    describe(`variant: ${variant}`, () => {
      it("AC-1: authors a Phase-0 work-mode gate — get_work_mode (MCP-first), speckiwi mode (CLI fallback), fail-open wait", () => {
        const body = skillBody(readSkill(variant));
        expect(
          GET_WORK_MODE.test(body),
          `FR-FLOW-039 AC-1: ${variant} kiwi-pipeline must read the work-mode via MCP get_work_mode`,
        ).toBe(true);
        expect(
          CLI_MODE.test(body),
          `FR-FLOW-039 AC-1: ${variant} kiwi-pipeline must fall back to CLI \`speckiwi mode\``,
        ).toBe(true);
        // MCP-first read + fail-open wait tied together in one window around get_work_mode.
        const failOpenWait = windowsAround(body, GET_WORK_MODE, 400).some(
          (win) => FAIL_OPEN.test(win) && WAIT.test(win),
        );
        expect(
          failOpenWait,
          `FR-FLOW-039 AC-1: ${variant} kiwi-pipeline work-mode gate must fail-open to wait when both MCP and CLI are absent`,
        ).toBe(true);
      });

      it("AC-2: routes tdd + step-scoped work to kiwi-tdd while body-scope / large work keeps the sdd chain", () => {
        const body = skillBody(readSkill(variant));
        const routesTdd = windowsAround(body, KIWI_TDD, 400).some(
          (win) => STEP_SCOPED.test(win) && ROUTE.test(win),
        );
        expect(
          routesTdd,
          `FR-FLOW-039 AC-2: ${variant} kiwi-pipeline must route tdd + step-scoped work to kiwi-tdd`,
        ).toBe(true);
        const keepsSdd = windowsAround(body, BODY_SCOPE, 400).some(
          (win) => KEEP_SDD.test(win) && KEEP.test(win),
        );
        expect(
          keepsSdd,
          `FR-FLOW-039 AC-2: ${variant} kiwi-pipeline must keep the sdd chain for body-scope / large-architecture work`,
        ).toBe(true);
      });

      it("AC-3: the §2.5 five-stage arrow chain body is unchanged", () => {
        const body = skillBody(readSkill(variant));
        expect(
          CHAINED_FIVE_STAGES.test(body),
          `FR-FLOW-039 AC-3: ${variant} kiwi-pipeline §2.5 five-stage chain must remain intact`,
        ).toBe(true);
      });
    });
  }
});
