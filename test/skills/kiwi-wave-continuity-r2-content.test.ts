import { describe, expect, it } from "vitest";
import { moduleRegion, readResolvedSkill } from "../support/resolved-skill.js";

// Round-2 evaluation findings — docs/analysis/wave-fit-eval/round2-findings.md.
// Each test carries the finding id (R2-C1 … R2-L4) instead of a requirement tag; the SRS ids are
// assigned after these contracts are agreed.
//
// A SKILL.md is natural-language agent instruction, not executable code, so the behaviour cannot be
// exercised in a unit test; these are raw-text contract assertions over every shipped variant — the
// same technique the FR-FLOW-029/042…055 suites use.
//
// kiwi-wave-master is deliberately excluded from the `.agents/skills` mirror
// (.agents/skills/.speckiwi-mirror-exclusions.json), so its SKILL.md lives in exactly three copies.
// The shared waves-event contract IS mirrored (4 copies) and is asserted in
// kiwi-event-contract-content.test.ts.
//
// Assertion style, dictated by mutations that survived earlier rounds:
//   - scope to the governing section and cut it at the next same-or-higher heading;
//   - anchor a normative rule to its own line or its own table cell, never to a character window;
//   - assert hedge vocabulary is ABSENT from the sentence that carries a MUST;
//   - assert quantifiers and polarity literally ("1건이라도" vs "여러 건", "전량" vs "주요",
//     "금지" vs "지양");
//   - compare positions for ordering rules;
//   - prefer negative assertions and set comparisons over token-presence checks.

const VARIANTS = ["claude", "codex", "etc"] as const;

/** @req FR-FLOW-110 — resolved through the shared reader: SKILL.md plus the bodies of the
 * `_shared/kiwi/` modules its §0 table references, appended in table order. */
function readSkill(variant: string, skill: string): string {
  return readResolvedSkill(variant, skill);
}

const readWave = (v: string) => readSkill(v, "kiwi-wave-master");
const readPipeline = (v: string) => readSkill(v, "kiwi-pipeline");
const readPlanner = (v: string) => readSkill(v, "kiwi-planner");
const readPm = (v: string) => readSkill(v, "kiwi-pm");
const readCoder = (v: string) => readSkill(v, "kiwi-coder");
const readReviewFix = (v: string) => readSkill(v, "kiwi-review-fix-loop");

/** Body with the YAML frontmatter stripped, so the `description` field cannot false-green a check. */
function skillBody(text: string): string {
  return text.replace(/^---[\s\S]*?\n---\s*\n?/, "");
}

/** A heading and everything under it, down to the next same-or-higher-level heading. "" when absent. */
function sectionUnder(body: string, headingRe: RegExp): string {
  const lines = body.split("\n");
  const start = lines.findIndex((line) => /^#{1,6}\s/.test(line) && headingRe.test(line));
  if (start === -1) return "";
  const level = (lines[start].match(/^#+/) as RegExpMatchArray)[0].length;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    const m = lines[i].match(/^#+/);
    if (m && m[0].length <= level) {
      end = i;
      break;
    }
  }
  return lines.slice(start, end).join("\n");
}


/**
 * @req FR-FLOW-110 — a section whose rules moved into a `_shared/kiwi/` module is scoped to the
 * skill's own section PLUS that module's appended region. Two bounded regions, never the whole body.
 */
function withModule(body: string, headingRe: RegExp, moduleName: string): string {
  return `${sectionUnder(body, headingRe)}\n${moduleRegion(body, moduleName)}`;
}

const BASELINE_SECTION = /^#{2,4}\s.*설계 기준선/;
const COVERAGE_SECTION = /^#{2,4}\s.*분해 커버리지 게이트/;

/** The single line containing the first match of `re`. "" when absent. */
function lineWith(text: string, re: RegExp): string {
  return text.split("\n").find((l) => re.test(l)) ?? "";
}

/** Every markdown table row (a line starting with `|`) in `text` that matches `re`. */
function tableRows(text: string, re: RegExp): string[] {
  return text.split("\n").filter((l) => /^\s*\|/.test(l) && re.test(l));
}

/** Trimmed cells of the first table row matching `re`; [] when absent. */
function rowCells(text: string, re: RegExp): string[] {
  const row = tableRows(text, re)[0];
  return row ? row.split("|").map((c) => c.trim()) : [];
}

/**
 * Hedges that turn a MUST into a SHOULD. Every co-occurrence regex in this file is satisfiable by a
 * hedged sentence — "…하지 않는 것을 원칙으로 하되, 필요하면 할 수 있다" keeps every anchor token —
 * so each prohibition additionally asserts that its own sentence carries none of these.
 */
const HEDGE = /수 있다|해도 된다|권장|바람직|원칙적으로|원칙으로 하되|가능하면|되도록|경우에 따라|가급적|지양/;

/** The `critical_gates[]` declaration section of whichever skill is under test. */
function gateSection(body: string): string {
  return sectionUnder(body, /^#{2,4}\s.*critical_gates/i);
}

/** The end-of-wave cross-verification section (§5.5). */
function verifySection(body: string): string {
  // @req FR-FLOW-110 — the skill's own §5.5 plus the verify-loop.md engine region its §0 table
  // references. Two bounded regions, not the whole body: §2.1 and §7 stay out of scope.
  return `${sectionUnder(body, /^#{2,3}\s.*(?:상호검증|cross-verif)/i)}\n${moduleRegion(body, "verify-loop")}`;
}

/** The declared gate ids of a skill, read from the FIRST cell of each gate-table row. */
function gateIds(body: string): string[] {
  return gateSection(body)
    .split("\n")
    .filter((l) => /^\s*\|/.test(l) && l.split("|").length >= 5)
    .map((l) => (l.split("|")[1] ?? "").trim())
    .map((cell) => (cell.match(/^`([a-z][a-z0-9-]*)`$/) ?? [])[1])
    .filter((id): id is string => Boolean(id));
}

// ---------------------------------------------------------------------------------------------
// Contract identifiers the implementation must use verbatim. Pinning them here is the point: a
// prose-only instruction lets each of the three copies invent its own spelling, and the shared
// auto-option consumer — which keys on gate_id — then cannot match any of them.
// docs/plans/2026-07-29.speckiwi.v244-r2.implementation-contract.md is the authoring companion.
// ---------------------------------------------------------------------------------------------

/** R2-M9: one canonical gate-id set per skill, identical in all three variants. */
const CANONICAL_GATE_IDS: Record<string, readonly string[]> = {
  "kiwi-wave-master": [
    "run-root-preflight-mismatch",
    "wt-delegation-refused",
    "child-pipeline-needs-user-or-failed",
    "child-srs-needs-user-or-failed",
    "wave-verify-residual-critical",
    "wave-verify-cross-wave-fix-required",
    "wave-decomposition-coverage-gap",
    "decomposition-input-missing",
    "final-verify-residual-critical",
    "unsafe-option-refused",
    "integration-test-user-consent",
    "cost-warning-large-task",
    // Round 3 additions — same strength, new membership. See
    // docs/plans/2026-07-29.speckiwi.v244-r3.implementation-contract.md §0.1: R3-H10 gives
    // fail-residual its own halt, R3-H6 gates an out-of-scope exclusion, R3-M10 bounds the
    // wave-append loop, R3-L2 declares the loop-option halt loop-option.md already orders.
    "wave-verify-fail-residual",
    "out-of-scope-user-consent",
    "wave-append-cap-exhausted",
    "invalid-loop-option"
  ],
  "kiwi-coder": [
    "external-module-impact",
    "zero-tolerance-plan-code-mismatch",
    "mock-detection",
    "tdd-bypass-attempt",
    "improvement-loop-divergence-4opt",
    "mcp-mutation-backward-status",
    "mcp-mutation-batch-large",
    "integration-test-user-consent",
    "cost-warning-large-task",
    "followup-review-fix-loop-close-unsafe",
    "existing-test-weakened-or-deleted",
    "existing-public-contract-change",
    "existing-file-deleted-or-moved",
    "mcp-cli-both-unavailable",
    "lifecycle-gate-deprecated-or-frozen"
  ],
  "kiwi-pm": [
    "lifecycle-gate-policy-stop",
    "task-failure-escalation",
    "existing-public-contract-change",
    "existing-test-weakened-or-deleted",
    "sha-mismatch-on-resume",
    "depends-on-violation",
    "t-final-backward-transition",
    "t-final-dryrun-rejected",
    "mcp-cli-both-unavailable",
    "auto-skip-lifecycle-gate-combo",
    "path-heuristic-business-decision",
    "mcp-mutation-batch-large",
    "external-module-impact"
  ],
  "kiwi-pipeline": [
    "pipeline-event-needs-user-or-failed",
    "self-recursive-spawn",
    "multi-candidate-ambiguous",
    "pipeline-start-candidate-ambiguous",
    "pipeline-schema-major-mismatch"
  ],
  "kiwi-srs": [
    "external-module-impact",
    "scope-boundary-impact",
    "combined-boundary-conflict",
    "auto-qna-mutual-exclusion",
    "implementability-blocked",
    "mcp-cli-both-unavailable",
    "fact-fabrication-risk"
  ],
  "kiwi-planner": [
    "external-module-impact",
    "deferred-coverage-frozen-stable",
    "force-proceed-after-divergence",
    "scope-expansion-target-boundary",
    "strict-tdd-block",
    "mcp-cli-both-unavailable"
  ],
  "kiwi-review-fix-loop": [
    "classifier-fix-hypothesis-fail-fallback",
    "close-reqs-with-pr-mode",
    "close-reqs-with-regression-fail",
    "close-reqs-critical-or-high-residual",
    "external-module-impact",
    "improvement-loop-divergence-4opt",
    "mock-detection",
    "pr-mode-gh-unavailable",
    "mcp-cli-both-unavailable",
    "bulk-close-or-finalize",
    "existing-test-weakened-or-deleted",
    "existing-public-contract-change",
    "existing-file-deleted-or-moved"
  ]
};

/** Spellings retired by the canonicalisation. None may survive as a declared gate id anywhere. */
const RETIRED_GATE_IDS = [
  "frozen-stable-ac-uncovered",
  "improvement-loop-force-proceed",
  "scope-boundary-expand-scope",
  "tdd-policy-strict-block",
  "deferred-coverage-frozen-stable-ac",
  "plan-sidecar-sha-mismatch",
  "t-final-dryrun-reject",
  "fact-fabrication-rejection",
  "mcp-unavailable",
  "lifecycle-gate-draft",
  "schema-major-mismatch",
  "pipeline-jsonl-absent-start-ambiguous"
] as const;

// =============================================================================================
// R2-C1 — the resume and completion predicates must be scoped to the current run_id.
// =============================================================================================
describe("R2-C1 — wave resume is scoped to the current run", () => {
  for (const variant of VARIANTS) {
    describe(`${variant} variant`, () => {
      // §6 is where the skill states its own resume rule; the shared contract is asserted in
      // kiwi-event-contract-content.test.ts. Both have to say it or the two disagree.
      it("scopes the first-incomplete scan to the current run_id", () => {
        const progress = sectionUnder(skillBody(readWave(variant)), /^##\s*6\./);
        expect(progress, `${variant}: the progress-tracking section must exist`).not.toBe("");
        const rule = lineWith(progress, /run_id/);
        expect(rule, `${variant}: the resume scan must state which run's events it reads`).not.toBe("");
        // "같은 저장소의 이벤트" would keep the token and restore the defect, so the identity has to
        // be against THIS run, spelled out.
        expect(
          /현재 run 의 `run_id` 와 일치하는 이벤트만/.test(progress),
          `${variant}: the resume scan must read only events whose run_id equals the current run`
        ).toBe(true);
        expect(
          HEDGE.test(lineWith(progress, /현재 run 의 `run_id` 와 일치하는 이벤트만/)),
          `${variant}: the run-scoping rule must be absolute, not hedged`
        ).toBe(false);
      });

      it("defines how the run to resume is selected", () => {
        const progress = sectionUnder(skillBody(readWave(variant)), /^##\s*6\./);
        const rule = lineWith(progress, /재개 대상 run/);
        expect(rule, `${variant}: the skill must say which run a bare resume picks`).not.toBe("");
        expect(
          /가장 최근[^\n]*미완료/.test(rule),
          `${variant}: a bare resume must pick the most recent INCOMPLETE run, not merely the most recent one`
        ).toBe(true);
        expect(
          /`--run-id`/.test(rule),
          `${variant}: an explicitly supplied run id must be able to override the automatic choice`
        ).toBe(true);
      });

      it("offers --run-id as a declared option rather than an undocumented argument", () => {
        const options = sectionUnder(skillBody(readWave(variant)), /^###\s*1\.2/);
        expect(options, `${variant}: the optional-input section must exist`).not.toBe("");
        const cells = rowCells(options, /`--run-id/);
        expect(cells.length, `${variant}: --run-id must be its own row in the natural-language map`).toBeGreaterThan(3);
      });

      // The failure mode is second-use-onward and silent, so a new epic must not inherit the old one.
      it("states that a new run never reads an earlier run's complete events", () => {
        const progress = sectionUnder(skillBody(readWave(variant)), /^##\s*6\./);
        const rule = lineWith(progress, /다른 run/);
        expect(rule, `${variant}: the cross-run isolation must be stated`).not.toBe("");
        expect(
          /(?:완료로 읽지 않는다|자기 상태로 읽지 않는다)/.test(rule),
          `${variant}: another run's complete must never be read as this run's state`
        ).toBe(true);
        expect(HEDGE.test(rule), `${variant}: the cross-run isolation must be absolute, not hedged`).toBe(false);
      });
    });
  }
});

// =============================================================================================
// R2-C2 — preservation_layer must gate the terminal verdict, not merely be recorded.
// =============================================================================================
describe("R2-C2 — an unapproved damage row blocks the passing verdict", () => {
  for (const variant of VARIANTS) {
    describe(`${variant} variant`, () => {
      it("adds the preservation condition to the Normal PASS row itself", () => {
        const exit = sectionUnder(skillBody(readWave(variant)), /^#{2,4}\s.*5\.5\.4/);
        expect(exit, `${variant}: the termination-condition section must exist`).not.toBe("");
        const normalRow = tableRows(exit, /^\|\s*Normal\s*\|/)[0] ?? "";
        expect(normalRow, `${variant}: the Normal PASS row must exist`).not.toBe("");
        expect(
          /unapproved-damage/.test(normalRow),
          `${variant}: the Normal PASS row itself must require zero unapproved-damage rows`
        ).toBe(true);
        // Quantifier: "주요 unapproved-damage 가 없을 것" would keep the token and gut the gate.
        expect(
          /`?unapproved-damage`?[^|]*0\s*건/.test(normalRow),
          `${variant}: the preservation condition must be zero rows, not "few" or "major" rows`
        ).toBe(true);
        expect(HEDGE.test(normalRow), `${variant}: the Normal PASS row must not hedge its conditions`).toBe(false);
      });

      it("applies the same preservation condition to the final run-scope pass", () => {
        const final = sectionUnder(skillBody(readWave(variant)), /^##\s*5\.6/);
        expect(final, `${variant}: the final-verification section must exist`).not.toBe("");
        const rule = lineWith(final, /unapproved-damage/);
        expect(rule, `${variant}: the final pass must restate the preservation condition`).not.toBe("");
        expect(
          /0\s*건/.test(rule),
          `${variant}: the final pass must also require zero unapproved-damage rows`
        ).toBe(true);
        expect(HEDGE.test(rule), `${variant}: the final preservation condition must be absolute, not hedged`).toBe(
          false
        );
      });
    });
  }
});

// =============================================================================================
// R2-C3 / R2-M10 — the design layer needs an externally fixed denominator.
// =============================================================================================
describe("R2-C3 — design items are materialised as the design-layer denominator", () => {
  for (const variant of VARIANTS) {
    describe(`${variant} variant`, () => {
      it("materialises design_items with per-item coordinates at baseline time", () => {
        const baseline = sectionUnder(skillBody(readWave(variant)), BASELINE_SECTION);
        expect(baseline, `${variant}: the design-baseline section must exist`).not.toBe("");
        expect(
          /`design_items`/.test(baseline),
          `${variant}: the baseline must materialise a design_items array, not only a wave-to-range map`
        ).toBe(true);
        const rule = lineWith(baseline, /`design_items`/);
        for (const key of ["id", "heading_path", "line_start", "line_end", "statement"]) {
          expect(
            new RegExp("`" + key + "`").test(rule),
            `${variant}: each design item must record ${key} on the line that declares design_items`
          ).toBe(true);
        }
      });

      it("defines the counting unit so a verifier cannot widen items to reach unmapped=0", () => {
        const baseline = sectionUnder(skillBody(readWave(variant)), BASELINE_SECTION);
        const unit = lineWith(baseline, /1\s*항목/);
        expect(unit, `${variant}: the item-counting unit must be defined`).not.toBe("");
        expect(
          /규범 문장 1건\s*=\s*1\s*항목/.test(unit),
          `${variant}: one normative sentence must equal exactly one design item`
        ).toBe(true);
        expect(
          /예시[^\n]*근거[^\n]*(?:제외|항목이 아니다)/.test(unit),
          `${variant}: example and rationale sentences must be excluded from the denominator`
        ).toBe(true);
        expect(HEDGE.test(unit), `${variant}: the counting unit must be absolute, not hedged`).toBe(false);
      });

      it("fixes design_layer.expected to the recorded item count instead of verifier judgement", () => {
        const stance = withModule(skillBody(readWave(variant)), /^###\s*5\.5\.2/, "verify-loop");
        expect(stance, `${variant}: the verifier-stance section must exist`).not.toBe("");
        const rule = lineWith(stance, /`design_layer\.expected`/);
        expect(rule, `${variant}: the design denominator must be pinned to the recorded items`).not.toBe("");
        expect(
          /`design_items`/.test(rule),
          `${variant}: design_layer.expected must be the length of the recorded design_items`
        ).toBe(true);
        expect(
          /검증자가 (?:스스로 )?(?:정하지|산정하지) 않는다/.test(rule),
          `${variant}: the design denominator must be externally fixed like the REQ/AC one`
        ).toBe(true);
        expect(HEDGE.test(rule), `${variant}: the external-denominator rule must be absolute, not hedged`).toBe(false);
      });

      it("uses design_items — not top-level sections — as the coverage-gate denominator", () => {
        const gate = sectionUnder(skillBody(readWave(variant)), COVERAGE_SECTION);
        expect(gate, `${variant}: the decomposition coverage gate must exist`).not.toBe("");
        const rule = lineWith(gate, /대조 단위/);
        expect(rule, `${variant}: the coverage gate must state its comparison unit`).not.toBe("");
        expect(
          /`design_items`[^\n]*\*\*전량\*\*/.test(rule),
          `${variant}: the coverage gate must compare against every design item, not only the top-level sections`
        ).toBe(true);
        expect(
          /최상위 섹션[^\n]*(?:아니라|한 겹)/.test(rule),
          `${variant}: the gate must say explicitly that a single top-level layer is not the unit`
        ).toBe(true);
      });

      it("fixes the final pass denominator the same way", () => {
        const final = sectionUnder(skillBody(readWave(variant)), /^##\s*5\.6/);
        const rule = lineWith(final, /`design_items`/);
        expect(rule, `${variant}: the final pass must reuse the recorded design items as its denominator`).not.toBe(
          ""
        );
        expect(
          /전체|합집합|모든 wave/.test(rule),
          `${variant}: the final denominator must be the whole recorded item set, not a per-wave slice`
        ).toBe(true);
      });
    });
  }
});

// =============================================================================================
// R2-H1 — --auto alone must not silently grant the two kiwi-coder consent gates.
// Branch chosen: (b). Granting them automatically (branch (a)) would let an unattended run consume
// user cost and execute integration tests with no consent anywhere in the chain; exposing the two
// options and correcting the promise keeps the consent where the user can give it.
// =============================================================================================
describe("R2-H1 — the two child consent gates are reachable and declared", () => {
  for (const variant of VARIANTS) {
    describe(`${variant} variant`, () => {
      it("maps both pass-through options in the natural-language table", () => {
        const options = sectionUnder(skillBody(readWave(variant)), /^###\s*1\.2/);
        for (const option of ["--auto-integration", "--auto-cost-warning"]) {
          const cells = rowCells(options, new RegExp("`\\" + option));
          expect(
            cells.length > 3,
            `${variant}: ${option} must be its own row in the natural-language map, otherwise it has no value to propagate`
          ).toBe(true);
        }
      });

      it("corrects the unattended-completion promise instead of leaving it absolute", () => {
        const auto = sectionUnder(skillBody(readWave(variant)), /^###\s*7\.1/);
        expect(auto, `${variant}: the --auto propagation section must exist`).not.toBe("");
        const rule = lineWith(auto, /`--auto` 단독/);
        expect(rule, `${variant}: the limit of a bare --auto must be stated`).not.toBe("");
        expect(
          /`--auto-integration`[^\n]*`--auto-cost-warning`|`--auto-cost-warning`[^\n]*`--auto-integration`/.test(rule),
          `${variant}: the sentence must name both options that a bare --auto does NOT supply`
        ).toBe(true);
        expect(
          /명시/.test(rule),
          `${variant}: the two gates must be documented as bypassed only on explicit input`
        ).toBe(true);
        // The dangerous inversion: wave-master granting the consent on the user's behalf.
        expect(
          /(?:부여한다|자동 활성|자동으로 부여)/.test(auto),
          `${variant}: --auto must not be documented as granting the child consent options by itself`
        ).toBe(false);
      });

      it("declares both gates in the critical_gates table so the halt is predictable", () => {
        const ids = gateIds(skillBody(readWave(variant)));
        for (const id of ["integration-test-user-consent", "cost-warning-large-task"]) {
          expect(ids, `${variant}: §0.G must declare ${id} as a row of the gate table`).toContain(id);
        }
      });
    });
  }
});

// =============================================================================================
// R2-H2 — the improvement loop's pipeline re-entry needs an expressible scope and a fresh emit key.
// =============================================================================================
describe("R2-H2 — pipeline re-entry accepts a scope and emits a distinguishable event", () => {
  for (const variant of VARIANTS) {
    describe(`${variant} variant`, () => {
      it("declares --req-filter and --plan-run-id as kiwi-pipeline options", () => {
        const options = sectionUnder(skillBody(readPipeline(variant)), /^###\s*1\.2/);
        expect(options, `${variant}: kiwi-pipeline must have an optional-input section`).not.toBe("");
        for (const option of ["--req-filter", "--plan-run-id"]) {
          const cells = rowCells(options, new RegExp("`\\" + option));
          expect(
            cells.length > 3,
            `${variant}: kiwi-pipeline must declare ${option} as its own option row; a re-entry cannot otherwise name its scope`
          ).toBe(true);
        }
      });

      it("forwards both re-entry arguments to the children that consume them", () => {
        const body = skillBody(readPipeline(variant));
        // The hand-off norm lives in §7 (Phase 4), where kiwi-pipeline launches the external skills
        // and decides what it passes them. Pin the section number AND the phase: an earlier scope
        // keyed on a §6 heading word and matched a user-gate subsection instead, which let the
        // assertion drag section titles around. There is deliberately no body-wide fallback — that
        // would let the rule pass from any paragraph in the file.
        const handoff = sectionUnder(body, /^##\s*§?7\.\s.*Phase\s*4/i);
        expect(handoff, `${variant}: kiwi-pipeline must have a §7 Phase 4 external-skill hand-off section`).not.toBe(
          ""
        );
        const rule = lineWith(handoff, /`--req-filter`/);
        expect(rule, `${variant}: kiwi-pipeline must state where --req-filter is forwarded`).not.toBe("");
        expect(
          /`--plan-run-id`/.test(rule),
          `${variant}: both re-entry arguments must be forwarded together; dropping one re-runs the whole plan`
        ).toBe(true);
        expect(
          /kiwi-planner/.test(rule) && /kiwi-pm/.test(rule),
          `${variant}: the forwarding rule must name kiwi-planner and kiwi-pm as the consumers`
        ).toBe(true);
      });

      it("gives a re-entry its own idempotency key so the chain sees a new TASK_DONE", () => {
        const body = skillBody(readPipeline(variant));
        const rule = lineWith(body, /멱등 키/);
        expect(rule, `${variant}: kiwi-pipeline must define the re-entry emit idempotency key`).not.toBe("");
        expect(
          /\{run_id\}#r\{n\}/.test(rule),
          `${variant}: the re-entry emit key must be {run_id}#r{n}; reusing the bare run_id makes the emit skip and stalls the chain`
        ).toBe(true);
        expect(HEDGE.test(rule), `${variant}: the re-entry key rule must be absolute, not hedged`).toBe(false);
      });

      it("makes kiwi-planner honour an externally supplied plan run-id", () => {
        const options = sectionUnder(skillBody(readPlanner(variant)), /^###\s*1\.2/);
        const cells = rowCells(options, /`--plan-run-id/);
        expect(
          cells.length > 3,
          `${variant}: kiwi-planner must accept --plan-run-id, otherwise the option pipeline forwards has no consumer`
        ).toBe(true);
      });
    });
  }
});

// =============================================================================================
// R2-H3 / R2-L3 — the direct /kiwi-srs halt needs a gate, and the §0.G prose must stop miscounting.
// =============================================================================================
describe("R2-H3 — the directly invoked kiwi-srs halt is a declared gate", () => {
  for (const variant of VARIANTS) {
    describe(`${variant} variant`, () => {
      it("declares child-srs-needs-user-or-failed with its origin sections", () => {
        const gates = gateSection(skillBody(readWave(variant)));
        const cells = rowCells(gates, /`child-srs-needs-user-or-failed`/);
        expect(cells.length > 3, `${variant}: the direct kiwi-srs halt must have its own gate row`).toBe(true);
        expect(
          /§4/.test(cells[3]),
          `${variant}: the gate's origin cell must point at §4, where wave-master calls kiwi-srs directly`
        ).toBe(true);
      });

      it("extends the §0.4 safety-gate rule beyond the pipeline child", () => {
        const common = sectionUnder(skillBody(readWave(variant)), /^##\s*0\.\s/);
        expect(common, `${variant}: the common-convention table must exist`).not.toBe("");
        const row = tableRows(common, /§0\.4/)[0] ?? "";
        expect(row, `${variant}: the §0.4 row must exist`).not.toBe("");
        expect(
          /kiwi-srs/.test(row),
          `${variant}: the §0.4 safety gate must cover the directly invoked kiwi-srs, not only kiwi-pipeline`
        ).toBe(true);
        expect(/kiwi-pipeline/.test(row), `${variant}: §0.4 must still cover kiwi-pipeline`).toBe(true);
      });

      // R2-L3: the explanatory sentence hard-codes counts that already drifted twice.
      it("stops hard-coding a gate count in the §0.G prose", () => {
        const gates = gateSection(skillBody(readWave(variant)));
        expect(
          /앞의 세 건/.test(gates),
          `${variant}: "앞의 세 건" no longer matches the table and must be removed, not renumbered`
        ).toBe(false);
        expect(
          /여덟 건|일곱 건|아홉 건|열 건/.test(gates),
          `${variant}: a hard-coded gate count drifts every time a row is added; the prose must not carry one`
        ).toBe(false);
        const rationale = lineWith(gates, /선언되지 않은/);
        expect(rationale, `${variant}: the reason for declaring every gate must survive`).not.toBe("");
        expect(
          /본 표의 \*\*모든\*\* 게이트/.test(rationale),
          `${variant}: the rationale must refer to every gate in the table rather than to a count`
        ).toBe(true);
      });

      it("identifies the preflight-derived gates by id rather than by row position", () => {
        const gates = gateSection(skillBody(readWave(variant)));
        const rule = lineWith(gates, /§2\.1/);
        expect(rule, `${variant}: the §2.1-derived gates must be identified somewhere in the prose`).not.toBe("");
        for (const id of ["run-root-preflight-mismatch", "wt-delegation-refused", "unsafe-option-refused"]) {
          expect(
            new RegExp("`" + id + "`").test(rule),
            `${variant}: the §2.1-derived gates must be named by gate_id — ${id} is missing`
          ).toBe(true);
        }
      });
    });
  }
});

// =============================================================================================
// R2-H4 — the final pass needs its own fix routing, and §5.5.7 must stop contradicting itself.
// =============================================================================================
describe("R2-H4 — final-pass findings have a repair route", () => {
  for (const variant of VARIANTS) {
    describe(`${variant} variant`, () => {
      it("unifies the requirement-level halt with the carry-forward-first rule", () => {
        const cross = sectionUnder(verifySection(skillBody(readWave(variant))), /^#{2,4}\s.*교차 wave/);
        expect(cross, `${variant}: the carry-forward section must exist`).not.toBe("");
        const rule = lineWith(cross, /요구사항을 바꿔야/);
        expect(rule, `${variant}: the requirement-level rule must exist`).not.toBe("");
        // The contradiction: an unconditional halt here versus "HALT is not the first response" below.
        expect(
          /요구사항을 바꿔야[^\n]*HALT 로 남는다/.test(rule),
          `${variant}: the unconditional phrasing contradicts the carry-forward-first rule in the same section`
        ).toBe(false);
        expect(
          /모두 불가능할 때(?:에만|만)/.test(rule),
          `${variant}: the requirement-level halt must fire only when neither carry-forward path exists`
        ).toBe(true);
        expect(HEDGE.test(rule), `${variant}: the halt condition must be absolute, not hedged`).toBe(false);
      });

      it("routes a run-scope finding into an appended wave rather than into a halt", () => {
        const final = sectionUnder(skillBody(readWave(variant)), /^##\s*5\.6/);
        const routing = lineWith(final, /run-scope finding/);
        expect(routing, `${variant}: the final pass must define where its own findings go`).not.toBe("");
        expect(
          /§0\.5[^\n]*예외/.test(routing),
          `${variant}: appending a wave for a run-scope finding must be routed through the §0.5 exception`
        ).toBe(true);
        expect(
          /wave-N\+1|새 wave 를 추가/.test(routing),
          `${variant}: the route must be an appended wave, not only a report`
        ).toBe(true);
        expect(
          /§5\.6[^\n]*재실행|재실행[^\n]*§5\.6/.test(final),
          `${variant}: the final pass must re-run after the appended wave completes`
        ).toBe(true);
      });

      it("reads the wave-head regression clause as a run-head run in the final pass", () => {
        const final = sectionUnder(skillBody(readWave(variant)), /^##\s*5\.6/);
        const rule = lineWith(final, /run head/);
        expect(rule, `${variant}: the final pass must say which head its regression run uses`).not.toBe("");
        expect(
          /wave head/.test(rule),
          `${variant}: the sentence must state the substitution explicitly so §5.5.4 stays readable`
        ).toBe(true);
      });

      it("notes that the resume predicate re-enters the final pass on its own", () => {
        const final = sectionUnder(skillBody(readWave(variant)), /^##\s*5\.6/);
        expect(
          /waves-event/.test(final),
          `${variant}: the final pass must point at the shared resume predicate that re-enters it`
        ).toBe(true);
      });
    });
  }
});

// =============================================================================================
// R2-H5 — the wave layer must judge regression by a baseline delta, like kiwi-coder does.
// =============================================================================================
describe("R2-H5 — wave regression is judged against a pinned baseline", () => {
  for (const variant of VARIANTS) {
    describe(`${variant} variant`, () => {
      it("captures the regression baseline once in preflight and pins it for the run", () => {
        const preflight = sectionUnder(skillBody(readWave(variant)), /^##\s*2\.1/);
        expect(preflight, `${variant}: the preflight section must exist`).not.toBe("");
        const rule = lineWith(preflight, /`baseline_failing_tests`/);
        expect(rule, `${variant}: preflight must capture the failing-test baseline`).not.toBe("");
        expect(
          /1회|한 번/.test(rule) && /run 전체|run 에 pin|pin/.test(rule),
          `${variant}: the baseline must be captured once and pinned for the whole run`
        ).toBe(true);
        expect(
          /`state\.regression_baseline`/.test(preflight),
          `${variant}: the wave baseline must be tied to the kiwi-coder baseline as a single source of truth`
        ).toBe(true);
      });

      it("passes on new failures only, and degrades to exit_code=0 only when capture failed", () => {
        const exit = sectionUnder(skillBody(readWave(variant)), /^#{2,4}\s.*5\.5\.4/);
        const normalRow = tableRows(exit, /^\|\s*Normal\s*\|/)[0] ?? "";
        expect(
          /신규 실패 0\s*건/.test(normalRow),
          `${variant}: the Normal PASS row must require zero NEW failures rather than an absolutely green suite`
        ).toBe(true);
        expect(
          /failing_tests\s*⊆\s*baseline_failing_tests/.test(normalRow),
          `${variant}: the pass condition must be stated as the subset relation`
        ).toBe(true);
        const fallback = lineWith(exit, /캡처(?:에)? 실패/);
        expect(fallback, `${variant}: the capture-failure fallback must be stated`).not.toBe("");
        expect(
          /`exit_code`\s*=?\s*0/.test(fallback),
          `${variant}: only a failed capture may fall back to requiring an absolutely green suite`
        ).toBe(true);
      });

      it("keeps the option refusal intact so the baseline is not an escape hatch", () => {
        const preflight = sectionUnder(skillBody(readWave(variant)), /^##\s*2\.1/);
        const rule = lineWith(preflight, /--skip-regression/);
        expect(rule, `${variant}: the regression-skip refusal must survive the baseline change`).not.toBe("");
        expect(/거부/.test(rule), `${variant}: --skip-regression must still be refused`).toBe(true);
        expect(HEDGE.test(rule), `${variant}: the refusal must stay absolute`).toBe(false);
      });
    });
  }
});

// =============================================================================================
// R2-H6 — kiwi-pm must halt on a bubbled-up test-weakening, not auto-decide it.
// =============================================================================================
describe("R2-H6 — test weakening is an unconditional halt at the pm layer", () => {
  for (const variant of VARIANTS) {
    describe(`${variant} variant`, () => {
      it("declares existing-test-weakened-or-deleted in the pm gate table", () => {
        const gates = gateSection(skillBody(readPm(variant)));
        const cells = rowCells(gates, /`existing-test-weakened-or-deleted`/);
        expect(
          cells.length > 3,
          `${variant}: kiwi-pm must declare existing-test-weakened-or-deleted; without the row it defaults to business-decision and the committee can approve it`
        ).toBe(true);
        expect(
          /kiwi-coder/.test(cells[2]),
          `${variant}: the reason cell must identify it as the bubbled-up kiwi-coder gate`
        ).toBe(true);
      });

      it("lists it among the always-halt exceptions", () => {
        const body = skillBody(readPm(variant));
        const always = sectionUnder(body, /^#{3,4}\s.*(?:severity|가드레일)/i);
        const scope = always === "" ? body : always;
        const rule = lineWith(scope, /기존 테스트/);
        expect(rule, `${variant}: the always-halt list must name the test-preservation case`).not.toBe("");
        expect(
          /(?:약화|삭제)/.test(rule),
          `${variant}: the always-halt entry must cover both weakening and deletion`
        ).toBe(true);
        expect(HEDGE.test(rule), `${variant}: the always-halt entry must be absolute, not hedged`).toBe(false);
      });
    });
  }
});

// =============================================================================================
// R2-H7 — a carried-forward finding needs a consumer at the receiving wave.
// =============================================================================================
describe("R2-H7 — the receiving wave collects what was carried into it", () => {
  for (const variant of VARIANTS) {
    describe(`${variant} variant`, () => {
      it("collects carried_into residuals when a wave is entered", () => {
        const target = withModule(skillBody(readWave(variant)), /^##\s*4\./, "wave-srs-registration");
        expect(target, `${variant}: the target-registration section must exist`).not.toBe("");
        const rule = lineWith(target, /`carried_into`/);
        expect(rule, `${variant}: entering a wave must read the residuals carried into it`).not.toBe("");
        expect(
          /\*\*전량\*\*/.test(rule),
          `${variant}: every carried residual must be collected, not a selection`
        ).toBe(true);
        expect(
          /저작 입력|증분 저작/.test(rule),
          `${variant}: the carried findings must enter the authoring input, otherwise they are never re-detected`
        ).toBe(true);
        expect(HEDGE.test(rule), `${variant}: the collection rule must be absolute, not hedged`).toBe(false);
      });

      it("also folds them into the pipeline re-entry scope", () => {
        const run = sectionUnder(skillBody(readWave(variant)), /^##\s*5\.\s/);
        expect(run, `${variant}: the per-wave pipeline section must exist`).not.toBe("");
        expect(
          /`carried_into`/.test(run),
          `${variant}: the pipeline stage must also consume the carried residuals; authoring alone leaves code findings unrouted`
        ).toBe(true);
      });

      it("gives an appended carry-forward wave a substitute design denominator", () => {
        const baseline = sectionUnder(skillBody(readWave(variant)), BASELINE_SECTION);
        const rule = lineWith(baseline, /이월/);
        expect(rule, `${variant}: an appended carry-forward wave must have a stated denominator`).not.toBe("");
        expect(
          /이월 finding 목록/.test(rule),
          `${variant}: the carried finding list must replace the design baseline for a wave with no source section`
        ).toBe(true);
      });
    });
  }
});

// =============================================================================================
// R2-H8 — the design prose, not only the pointer, must reach the authoring input.
// =============================================================================================
describe("R2-H8 — the design excerpt is materialised and handed to authoring", () => {
  for (const variant of VARIANTS) {
    describe(`${variant} variant`, () => {
      it("materialises a per-wave markdown excerpt beside the coordinate map", () => {
        const baseline = sectionUnder(skillBody(readWave(variant)), BASELINE_SECTION);
        const rule = lineWith(baseline, /design-baseline\/wave-\{n\}\.md/);
        expect(rule, `${variant}: the per-wave design excerpt must be materialised`).not.toBe("");
        expect(
          /`excerpt_path`/.test(baseline),
          `${variant}: the excerpt must be recorded on design_baseline.excerpt_path so the bundle and the authoring input point at one artifact`
        ).toBe(true);
      });

      it("passes the excerpt — not the coordinate JSON — as the research document", () => {
        const target = withModule(skillBody(readWave(variant)), /^##\s*4\./, "wave-srs-registration");
        const rule = lineWith(target, /`excerpt_path`/);
        expect(rule, `${variant}: the authoring call must receive the excerpt`).not.toBe("");
        expect(
          /--research-doc|리서치 문서/.test(rule),
          `${variant}: the excerpt must be passed as the research document argument`
        ).toBe(true);
        // The defect being closed: handing over a pointer file that carries no prose to compare against.
        expect(
          /좌표|매핑 JSON|design-baseline\.json/.test(rule),
          `${variant}: the sentence must distinguish the excerpt from the coordinate map it replaces`
        ).toBe(true);
      });
    });
  }
});

// =============================================================================================
// R2-H9 — the authoring-finished mark must be any-line, not latest-line.
// =============================================================================================
describe("R2-H9 — a wave-verify crash does not re-author the SRS", () => {
  for (const variant of VARIANTS) {
    describe(`${variant} variant`, () => {
      it("keys the skip on any srs_authored=true event of that wave", () => {
        const target = withModule(skillBody(readWave(variant)), /^##\s*4\./, "wave-srs-registration");
        const rule = lineWith(target, /`srs_authored`/);
        expect(rule, `${variant}: the authoring-skip rule must exist`).not.toBe("");
        expect(
          /\*\*하나라도\*\*/.test(rule),
          `${variant}: a single srs_authored=true event anywhere in the wave must suppress re-authoring`
        ).toBe(true);
        // The defect: keying on the LATEST event, which a wave-verify record always displaces.
        expect(
          /최신 이벤트/.test(rule),
          `${variant}: keying the skip on the latest event re-authors after any wave-verify record`
        ).toBe(false);
      });

      it("limits the unmarked-line reading to the srs-authoring phase", () => {
        const target = withModule(skillBody(readWave(variant)), /^##\s*4\./, "wave-srs-registration");
        const rule = lineWith(target, /표식 없는 줄/);
        expect(rule, `${variant}: the unmarked-line rule must exist`).not.toBe("");
        // Merely naming the phase in the same sentence is what the current text already does; the
        // reading has to be RESTRICTED to that phase, otherwise a wave-verify line without the mark
        // still reads as "authoring in progress" and re-authors.
        expect(
          /표식 없는 줄[^\n]*(?:`?srs-authoring`? 줄만|`?srs-authoring`? 이벤트만|한정한다)/.test(rule),
          `${variant}: the unmarked-line reading must be restricted to srs-authoring lines, not merely mention the phase`
        ).toBe(true);
        expect(
          /`?srs-authoring`?/.test(rule),
          `${variant}: only an srs-authoring line without the mark may read as authoring-in-progress`
        ).toBe(true);
      });
    });
  }
});

// =============================================================================================
// R2-H10 — user constraints need collection, a denominator and a gate.
// =============================================================================================
describe("R2-H10 — declared user constraints are a verified layer", () => {
  for (const variant of VARIANTS) {
    describe(`${variant} variant`, () => {
      it("collects constraints in Phase 1 and always writes the artifact", () => {
        const baseline = sectionUnder(skillBody(readWave(variant)), BASELINE_SECTION);
        const rule = lineWith(baseline, /`constraints_path`/);
        expect(rule, `${variant}: the constraint artifact rule must exist`).not.toBe("");
        expect(
          /제약이 없어도[^\n]*빈 배열/.test(rule),
          `${variant}: an empty constraint array must be written even when nothing was declared — absence of the field is silence, not a claim`
        ).toBe(true);
        expect(
          /(?:항상|반드시) 기록/.test(rule),
          `${variant}: constraints_path must always be recorded so the mandatory bundle row is satisfiable`
        ).toBe(true);
        expect(HEDGE.test(rule), `${variant}: the always-record rule must be absolute, not hedged`).toBe(false);
      });

      it("declares a constraint layer with a roll-up consequence", () => {
        const stance = withModule(skillBody(readWave(variant)), /^###\s*5\.5\.2/, "verify-loop");
        const rule = lineWith(stance, /`constraint_layer`/);
        expect(rule, `${variant}: the constraint layer must be declared alongside the other denominators`).not.toBe(
          ""
        );
        for (const key of ["expected", "checked", "violations"]) {
          expect(
            new RegExp("`" + key + "`").test(rule),
            `${variant}: constraint_layer must record ${key}`
          ).toBe(true);
        }
        const gate = lineWith(stance, /violations/);
        expect(
          /\*\*1건이라도\*\*/.test(gate) || /violations[^\n]*≥\s*1/.test(gate),
          `${variant}: a single violation must be enough to block the roll-up`
        ).toBe(true);
        expect(
          /`ALL_MATCH`[^\n]*(?:불가|기록할 수 없다|기록하지 않는다|금지)/.test(gate),
          `${variant}: a constraint violation must forbid the ALL_MATCH roll-up`
        ).toBe(true);
        expect(HEDGE.test(gate), `${variant}: the constraint gate must be absolute, not hedged`).toBe(false);
      });

      it("passes the constraint artifact to authoring as well as to verification", () => {
        const target = withModule(skillBody(readWave(variant)), /^##\s*4\./, "wave-srs-registration");
        expect(
          /`constraints_path`/.test(target),
          `${variant}: the authoring call must receive the constraint artifact; otherwise a verified violation has no basis to be fixed`
        ).toBe(true);
      });

      it("defines how a constraint declared mid-run is admitted", () => {
        const body = skillBody(readWave(variant));
        const rule = lineWith(body, /후발 제약/);
        expect(rule, `${variant}: a constraint surfacing during a later wave must have an admission path`).not.toBe(
          ""
        );
        expect(
          /`in_progress`/.test(rule) && /append/i.test(rule),
          `${variant}: a later constraint must be appended as a new in_progress event, not edited in place`
        ).toBe(true);
        expect(
          /\*\*최신\*\* `constraints_path`|최신 `constraints_path`/.test(rule),
          `${variant}: resolution must read the latest constraints_path`
        ).toBe(true);
      });
    });
  }
});

// =============================================================================================
// R2-M1 — the diff window must be resolvable from the journal.
// =============================================================================================
describe("R2-M1 — the wave diff window is journalled", () => {
  for (const variant of VARIANTS) {
    describe(`${variant} variant`, () => {
      it("records base and head SHAs and resolves the window from the journal", () => {
        const bundle = withModule(skillBody(readWave(variant)), /^###\s*5\.5\.1/, "verify-loop");
        expect(bundle, `${variant}: the evidence-bundle section must exist`).not.toBe("");
        const rule = lineWith(bundle, /`diff_window`/);
        expect(rule, `${variant}: the diff window must be resolved from a recorded field`).not.toBe("");
        expect(
          /`base_sha`/.test(rule) && /`head_sha`/.test(rule),
          `${variant}: the diff window must carry both base_sha and head_sha`
        ).toBe(true);
        expect(
          /대화 상태|waves\.jsonl/.test(rule),
          `${variant}: the window must be resolvable without conversation state, like the design baseline`
        ).toBe(true);
      });
    });
  }
});

// =============================================================================================
// R2-M2 — "existing", "public symbol" and "weakening" need decision rules.
// =============================================================================================
describe("R2-M2 — the preservation vocabulary is defined, not merely invoked", () => {
  for (const variant of VARIANTS) {
    describe(`${variant} variant`, () => {
      it("pins 기존 to the captured baseline commit", () => {
        const body = skillBody(readCoder(variant));
        const rule = lineWith(body, /\*\*기존\*\* 의 판정|"기존" 의 판정|`기존` 의 판정/);
        expect(rule, `${variant}: kiwi-coder must define what counts as pre-existing`).not.toBe("");
        expect(
          /`state\.regression_baseline\.head_sha`|기준선 커밋/.test(rule),
          `${variant}: "existing" must be pinned to the captured baseline commit, not left to judgement`
        ).toBe(true);
      });

      it("defines the public-symbol surface", () => {
        const body = skillBody(readCoder(variant));
        const rule = lineWith(body, /public 심볼[^\n]*판정|판정[^\n]*public 심볼/);
        expect(rule, `${variant}: kiwi-coder must define the public symbol surface`).not.toBe("");
        expect(
          /export|공개 표면|public 선언/.test(rule),
          `${variant}: the definition must name the export surface it is read from`
        ).toBe(true);
      });

      it("enumerates what counts as weakening", () => {
        const body = skillBody(readCoder(variant));
        const rule = lineWith(body, /\*\*약화\*\*[^\n]*(?:정의|다음|넷|네 가지)/);
        expect(rule, `${variant}: kiwi-coder must enumerate the weakening forms`).not.toBe("");
        for (const form of ["단언 삭제", "skip", "기대값"]) {
          expect(
            rule.includes(form),
            `${variant}: the weakening enumeration must cover ${form}`
          ).toBe(true);
        }
        expect(HEDGE.test(rule), `${variant}: the enumeration must be normative, not advisory`).toBe(false);
      });
    });
  }
});

// =============================================================================================
// R2-M3 / R2-M14 / R2-M15 — kiwi-review-fix-loop is the only code path that bypasses kiwi-coder.
// =============================================================================================
describe("R2-M3 — kiwi-review-fix-loop carries the preservation contract", () => {
  for (const variant of VARIANTS) {
    describe(`${variant} variant`, () => {
      it("states the preservation prohibition in its own common-convention table", () => {
        const common = sectionUnder(skillBody(readReviewFix(variant)), /^##\s*0\.\s/);
        expect(common, `${variant}: kiwi-review-fix-loop must have a common-convention table`).not.toBe("");
        const row = tableRows(common, /기존 테스트/)[0] ?? "";
        expect(row, `${variant}: the preservation rule must be its own §0 row`).not.toBe("");
        expect(
          /\*\*금지\*\*/.test(row),
          `${variant}: weakening or deleting an existing test must be forbidden, not discouraged`
        ).toBe(true);
        expect(HEDGE.test(row), `${variant}: the preservation rule must be absolute, not hedged`).toBe(false);
      });

      it("declares the three preservation gates", () => {
        const ids = gateIds(skillBody(readReviewFix(variant)));
        for (const id of [
          "existing-test-weakened-or-deleted",
          "existing-public-contract-change",
          "existing-file-deleted-or-moved"
        ]) {
          expect(ids, `${variant}: kiwi-review-fix-loop must declare ${id}`).toContain(id);
        }
      });

      it("judges its regression by a captured baseline delta", () => {
        const body = skillBody(readReviewFix(variant));
        const regression = sectionUnder(body, /^#{3,4}\s.*회귀 테스트/);
        expect(regression, `${variant}: the regression section must exist`).not.toBe("");
        const rule = lineWith(regression, /기준선|baseline/i);
        expect(rule, `${variant}: a regression baseline must be captured`).not.toBe("");
        expect(
          /코드를 바꾸기 전에|fix 를 적용하기 전에/.test(regression),
          `${variant}: the baseline must be captured before the fix is applied`
        ).toBe(true);
        expect(
          /(?:델타|delta|증분)로 판정/.test(regression),
          `${variant}: regression must be judged as a delta against that baseline`
        ).toBe(true);
        expect(
          /기존 실패[^\n]*(?:보고|분리)하고[^\n]*귀속하지 않는다/.test(regression),
          `${variant}: pre-existing failures must be reported but not attributed to this fix`
        ).toBe(true);
      });

      it("cites kiwi-coder §0.20 rather than the tdd route the wave cycle excludes", () => {
        const routing = sectionUnder(verifySection(skillBody(readWave(variant))), /^#{2,4}\s.*개선 위임/);
        const rule = lineWith(routing, /테스트를 약화하거나 삭제/);
        expect(rule, `${variant}: the fixer prohibition must exist`).not.toBe("");
        expect(
          /kiwi-tdd/.test(rule),
          `${variant}: kiwi-tdd is not on the wave route (§2.1 excludes tdd routing), so it cannot be the authority here`
        ).toBe(false);
        expect(
          /kiwi-coder\s*§0\.20/.test(rule),
          `${variant}: the prohibition must cite kiwi-coder §0.20, the rule that actually governs this chain`
        ).toBe(true);
      });
    });
  }
});

describe("R2-M14 — deleting or moving a non-test file is detected", () => {
  for (const variant of VARIANTS) {
    describe(`${variant} variant`, () => {
      it("declares existing-file-deleted-or-moved in kiwi-coder", () => {
        const gates = gateSection(skillBody(readCoder(variant)));
        const cells = rowCells(gates, /`existing-file-deleted-or-moved`/);
        expect(cells.length > 3, `${variant}: kiwi-coder must declare the file-removal gate`).toBe(true);
        expect(
          /sidecar/.test(cells[2]),
          `${variant}: the reason must state that presence in sidecar.files[] alone does not clear the removal`
        ).toBe(true);
      });

      it("adds the detection to the plan-code consistency gate", () => {
        const body = skillBody(readCoder(variant));
        const rule = lineWith(body, /비-테스트[^\n]*(?:삭제|이동)|기존 파일[^\n]*삭제·이동/);
        expect(rule, `${variant}: the detection item must exist in the consistency gate`).not.toBe("");
        expect(
          /CRITICAL/.test(rule) || /§5\.1/.test(rule),
          `${variant}: the detection must be wired to the zero-tolerance gate, not merely narrated`
        ).toBe(true);
      });
    });
  }
});

// =============================================================================================
// R2-M4 — the evidence window must cover every pipeline run of the wave.
// =============================================================================================
describe("R2-M4 — a re-entered wave keeps its whole evidence window", () => {
  for (const variant of VARIANTS) {
    describe(`${variant} variant`, () => {
      it("widens the window to every recorded pipeline run of that wave", () => {
        const bundle = withModule(skillBody(readWave(variant)), /^###\s*5\.5\.1/, "verify-loop");
        const rule = lineWith(bundle, /`pipeline_run_ids`/);
        expect(rule, `${variant}: the evidence window must be keyed on the full run list`).not.toBe("");
        expect(
          /\*\*전량\*\*|모든/.test(rule),
          `${variant}: every pipeline run of the wave must be inside the window, not only the first`
        ).toBe(true);
        // The failure this closes: re-verifying against pre-fix evidence, or passing on stale clean evidence.
        expect(
          /수정 전 증거|낡은|stale/i.test(bundle),
          `${variant}: the section must state why a single run id makes the window wrong after a re-entry`
        ).toBe(true);
      });
    });
  }
});

// =============================================================================================
// R2-M5 — denominators must freeze so improvement does not manufacture invalid rounds.
// =============================================================================================
describe("R2-M5 — the round denominator is frozen at round entry", () => {
  for (const variant of VARIANTS) {
    describe(`${variant} variant`, () => {
      it("freezes the denominator and records the frozen counts", () => {
        const stance = withModule(skillBody(readWave(variant)), /^###\s*5\.5\.2/, "verify-loop");
        const rule = lineWith(stance, /`frozen_denominator`/);
        expect(rule, `${variant}: the frozen denominator must be recorded`).not.toBe("");
        for (const key of ["round", "req_ac", "design_items", "preservation"]) {
          expect(
            new RegExp("`" + key + "`").test(rule),
            `${variant}: frozen_denominator must record ${key}`
          ).toBe(true);
        }
      });

      it("says a mid-round increase does not invalidate the round", () => {
        const stance = withModule(skillBody(readWave(variant)), /^###\s*5\.5\.2/, "verify-loop");
        const rule = lineWith(stance, /라운드 도중/);
        expect(rule, `${variant}: the mid-round growth rule must exist`).not.toBe("");
        expect(
          /늘지 않는다|늘어나지 않는다/.test(rule),
          `${variant}: the denominator must not grow inside a round`
        ).toBe(true);
        expect(
          /다음 라운드/.test(rule),
          `${variant}: items added by incremental authoring must be re-frozen at the next round`
        ).toBe(true);
        expect(
          /무효가 아니다/.test(rule),
          `${variant}: a re-freeze must not consume the round as invalid — that is what burns the cap`
        ).toBe(true);
      });
    });
  }
});

// =============================================================================================
// R2-M6 — a resume near the cap must not leave PASS arithmetically impossible.
// =============================================================================================
describe("R2-M6 — an unreachable pass is detected instead of burned through", () => {
  for (const variant of VARIANTS) {
    describe(`${variant} variant`, () => {
      it("halts as fail-cap when the remaining rounds cannot satisfy the streak", () => {
        const exit = sectionUnder(skillBody(readWave(variant)), /^#{2,4}\s.*5\.5\.4/);
        const rule = lineWith(exit, /남은 라운드/);
        expect(rule, `${variant}: the resume-near-cap case must be handled`).not.toBe("");
        expect(
          /스트릭 요구치/.test(rule),
          `${variant}: the comparison must be against the streak requirement of that mode`
        ).toBe(true);
        expect(
          /`fail-cap`/.test(rule),
          `${variant}: an arithmetically impossible pass must be recorded as fail-cap and escalated`
        ).toBe(true);
        // The unsafe alternative: silently extending the cap, or persisting a passing streak.
        expect(
          /cap 을 (?:연장|늘린다)|스트릭을 영속/.test(exit),
          `${variant}: neither extending the cap nor persisting the streak may be offered as the remedy`
        ).toBe(false);
      });
    });
  }
});

// =============================================================================================
// R2-M7 — a stale pm.lock must have a documented, explicit resolution path.
// =============================================================================================
describe("R2-M7 — a child lock is resolved by explicit input, never automatically", () => {
  for (const variant of VARIANTS) {
    describe(`${variant} variant`, () => {
      it("lists --force as an explicit-only pass-through", () => {
        const passthrough = sectionUnder(skillBody(readWave(variant)), /^###\s*7\.4/);
        expect(passthrough, `${variant}: the pass-through section must exist`).not.toBe("");
        const cells = rowCells(passthrough, /`--force`/);
        expect(cells.length > 3, `${variant}: --force must be its own pass-through row`).toBe(true);
        expect(
          /명시/.test(cells.join(" ")),
          `${variant}: --force must be forwarded only when the user typed it`
        ).toBe(true);
      });

      it("refuses to synthesise --force on a lock failure", () => {
        const passthrough = sectionUnder(skillBody(readWave(variant)), /^###\s*7\.4/);
        const rule = lineWith(passthrough, /lock/i);
        expect(rule, `${variant}: the lock failure path must be stated`).not.toBe("");
        expect(
          /자동으로 부여하지 않는다|자동 부여하지 않는다/.test(rule),
          `${variant}: wave-master must not grant --force by itself; another pm instance may be running`
        ).toBe(true);
        expect(
          /`child-pipeline-needs-user-or-failed`/.test(rule),
          `${variant}: the lock failure must surface through the declared child halt gate`
        ).toBe(true);
      });
    });
  }
});

// =============================================================================================
// R2-M8 — --max must reach the §4 kiwi-srs call, which the cycle does not spawn.
// =============================================================================================
describe("R2-M8 — --max propagation covers the directly invoked kiwi-srs", () => {
  for (const variant of VARIANTS) {
    describe(`${variant} variant`, () => {
      it("names the §4 direct call as a propagation target", () => {
        const max = sectionUnder(skillBody(readWave(variant)), /^###\s*7\.2/);
        expect(max, `${variant}: the --max propagation section must exist`).not.toBe("");
        const rule = lineWith(max, /§4/);
        expect(rule, `${variant}: the §4 direct kiwi-srs call must appear as a propagation target`).not.toBe("");
        expect(
          /kiwi-srs/.test(rule),
          `${variant}: the sentence must name kiwi-srs — the cycle never spawns it, so the "sub-skills the cycle spawns" list misses it`
        ).toBe(true);
      });
    });
  }
});

// =============================================================================================
// R2-M9 — one canonical gate-id set per skill across all three variants.
// =============================================================================================
describe("R2-M9 — critical_gates sets are identical across variants", () => {
  for (const skill of Object.keys(CANONICAL_GATE_IDS)) {
    describe(skill, () => {
      // Set comparison, not presence: a presence check stays green while one variant carries three
      // extra halts that the other two do not, which is exactly the observed divergence.
      it("declares the same gate-id SET in every variant", () => {
        const sets = VARIANTS.map((v) => [...new Set(gateIds(skillBody(readSkill(v, skill))))].sort());
        expect(sets[0].length, `claude/${skill}: the gate table must not be empty`).toBeGreaterThan(0);
        expect(sets[1], `codex/${skill}: the gate-id set must equal the claude set`).toEqual(sets[0]);
        expect(sets[2], `etc/${skill}: the gate-id set must equal the claude set`).toEqual(sets[0]);
      });

      it("matches the canonical set pinned by the contract", () => {
        const canonical = [...CANONICAL_GATE_IDS[skill]].sort();
        for (const variant of VARIANTS) {
          const ids = [...new Set(gateIds(skillBody(readSkill(variant, skill))))].sort();
          expect(ids, `${variant}/${skill}: gate ids must equal the canonical set`).toEqual(canonical);
        }
      });

      it("declares each gate exactly once", () => {
        for (const variant of VARIANTS) {
          const ids = gateIds(skillBody(readSkill(variant, skill)));
          expect(
            ids.length,
            `${variant}/${skill}: a duplicated gate row makes the interface ambiguous`
          ).toBe(new Set(ids).size);
        }
      });

      it("retires every superseded spelling", () => {
        const canonical = new Set(CANONICAL_GATE_IDS[skill]);
        for (const variant of VARIANTS) {
          const ids = new Set(gateIds(skillBody(readSkill(variant, skill))));
          for (const retired of RETIRED_GATE_IDS) {
            if (canonical.has(retired)) continue;
            expect(
              ids.has(retired),
              `${variant}/${skill}: ${retired} is a retired spelling and must not remain a declared gate id`
            ).toBe(false);
          }
        }
      });
    });
  }
});

// =============================================================================================
// R2-M11 — the first in_progress must be labelled with the phase it is actually in.
// =============================================================================================
describe("R2-M11 — the wave-start event is labelled srs-authoring", () => {
  for (const variant of VARIANTS) {
    describe(`${variant} variant`, () => {
      it("labels the wave-start in_progress as srs-authoring", () => {
        const record = sectionUnder(skillBody(readWave(variant)), /^###\s*5\.5\.6/);
        expect(record, `${variant}: the recording section must exist`).not.toBe("");
        const rule = lineWith(record, /wave 시작 시의 첫 `in_progress`/);
        expect(rule, `${variant}: the wave-start label must be stated`).not.toBe("");
        expect(
          /`?"?srs-authoring"?`?/.test(rule),
          `${variant}: the wave-start event precedes the pipeline (§4 runs before §5), so it must be labelled srs-authoring`
        ).toBe(true);
        expect(
          /phase="pipeline"|`phase` 를 `pipeline`/.test(rule),
          `${variant}: labelling the authoring-stage event as the pipeline phase is the mislabel being fixed`
        ).toBe(false);
      });

      it("still produces the pipeline phase member when the cycle starts", () => {
        const record = sectionUnder(skillBody(readWave(variant)), /^###\s*5\.5\.6/);
        const rule = lineWith(record, /pipeline 사이클 (?:진입|시작)/);
        expect(rule, `${variant}: the pipeline-phase event must be appended when the cycle begins`).not.toBe("");
        expect(
          /`?phase`?\s*=?\s*"?`?pipeline`?"?/.test(rule),
          `${variant}: the pipeline enum member must still be produced by a real event`
        ).toBe(true);
      });
    });
  }
});

// =============================================================================================
// R2-M13 — existing_modules must have a reader.
// =============================================================================================
describe("R2-M13 — the recorded existing modules are consumed", () => {
  for (const variant of VARIANTS) {
    describe(`${variant} variant`, () => {
      it("puts existing_modules into the evidence bundle", () => {
        const bundle = withModule(skillBody(readWave(variant)), /^###\s*5\.5\.1/, "verify-loop");
        const cells = rowCells(bundle, /`existing_modules`/);
        expect(
          cells.length > 2,
          `${variant}: existing_modules must be a bundle row; a field with no reader cannot influence any verdict`
        ).toBe(true);
      });

      it("binds it to verifier 2's cross-wave regression judgement", () => {
        const stance = withModule(skillBody(readWave(variant)), /^###\s*5\.5\.2/, "verify-loop");
        const rule = lineWith(stance, /`existing_modules`/);
        expect(rule, `${variant}: verifier 2 must be told to use the recorded module list`).not.toBe("");
        expect(
          /교차 wave/.test(rule),
          `${variant}: the module list must feed the cross-wave regression judgement`
        ).toBe(true);
      });
    });
  }
});

// =============================================================================================
// R2-M16 — the improvement/damage verdict needs an evidence rule.
// =============================================================================================
describe("R2-M16 — an intended-improvement verdict must cite its authority", () => {
  for (const variant of VARIANTS) {
    describe(`${variant} variant`, () => {
      it("requires a REQ or Task citation for intended-improvement", () => {
        const stance = withModule(skillBody(readWave(variant)), /^###\s*5\.5\.2/, "verify-loop");
        const rule = lineWith(stance, /`intended-improvement` 는/);
        expect(rule, `${variant}: the improvement verdict must have a decision rule`).not.toBe("");
        expect(
          /REQ[^\n]*Task|Task[^\n]*REQ/.test(rule),
          `${variant}: the verdict must be backed by a requirement or a plan task that asked for the change`
        ).toBe(true);
        expect(HEDGE.test(rule), `${variant}: the evidence requirement must be absolute, not hedged`).toBe(false);
      });

      it("defaults an uncited row to unapproved-damage", () => {
        const stance = withModule(skillBody(readWave(variant)), /^###\s*5\.5\.2/, "verify-loop");
        const rule = lineWith(stance, /근거를 대지 못한|근거가 없는/);
        expect(rule, `${variant}: the default for an uncited row must be stated`).not.toBe("");
        expect(
          /`unapproved-damage`/.test(rule),
          `${variant}: an uncited row must default to unapproved-damage, otherwise discretion decides the gate`
        ).toBe(true);
      });

      it("records the citation on the preservation row", () => {
        const stance = withModule(skillBody(readWave(variant)), /^###\s*5\.5\.2/, "verify-loop");
        expect(
          /`evidence`/.test(stance),
          `${variant}: the citation must be a recorded row key, not narrative`
        ).toBe(true);
      });
    });
  }
});

// =============================================================================================
// R2-L1 — the --cycle chain must have a defined terminal hop.
// =============================================================================================
describe("R2-L1 — the cycle terminates at the review loop", () => {
  for (const variant of VARIANTS) {
    describe(`${variant} variant`, () => {
      it("declares the last hop and refuses to auto-chain the push", () => {
        const cycle = sectionUnder(skillBody(readPipeline(variant)), /^##\s*2\.5/);
        expect(cycle, `${variant}: the cycle section must exist`).not.toBe("");
        const rule = lineWith(cycle, /마지막 홉/);
        expect(rule, `${variant}: the terminal hop must be declared`).not.toBe("");
        expect(
          /kiwi-review-fix-loop/.test(rule),
          `${variant}: the cycle must end at kiwi-review-fix-loop`
        ).toBe(true);
        const push = lineWith(cycle, /kiwi-commit-auto-push/);
        expect(push, `${variant}: the cycle must say what it does NOT do with the commit step`).not.toBe("");
        expect(
          /잇지 않는다|자동으로 잇지|이어붙이지 않는다/.test(push),
          `${variant}: an external side effect must not be chained automatically once per wave`
        ).toBe(true);
        expect(HEDGE.test(push), `${variant}: the refusal must be absolute, not hedged`).toBe(false);
      });
    });
  }
});

// =============================================================================================
// R2-L2 — asking for the decomposition input is a gate, not an undeclared prompt.
// =============================================================================================
describe("R2-L2 — a missing decomposition input is a declared halt", () => {
  for (const variant of VARIANTS) {
    describe(`${variant} variant`, () => {
      it("declares decomposition-input-missing", () => {
        const gates = gateSection(skillBody(readWave(variant)));
        const cells = rowCells(gates, /`decomposition-input-missing`/);
        expect(
          cells.length > 3,
          `${variant}: with no gate row this question falls to the auto committee, which then invents the input document`
        ).toBe(true);
        expect(/§1\.1/.test(cells[3]), `${variant}: the gate must point at §1.1 as its origin`).toBe(true);
      });

      it("links §1.1 to the gate", () => {
        const input = sectionUnder(skillBody(readWave(variant)), /^###\s*1\.1/);
        const rule = lineWith(input, /묻는다/);
        expect(rule, `${variant}: the ask-the-user sentence must survive`).not.toBe("");
        expect(
          /`decomposition-input-missing`/.test(rule),
          `${variant}: the sentence must name the gate so --auto cannot auto-decide it`
        ).toBe(true);
      });
    });
  }
});
