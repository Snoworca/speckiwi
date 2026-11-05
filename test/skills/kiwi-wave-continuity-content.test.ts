import { describe, expect, it } from "vitest";
import { moduleRegion, readResolvedSkill } from "../support/resolved-skill.js";
import { readRepoFile } from "./kiwi-renderings.js";
import { at } from "../support/at.js";

// @req FR-FLOW-047
// @req FR-FLOW-048
// @req FR-FLOW-049
// @req FR-FLOW-050
// @req FR-FLOW-051
// @req FR-FLOW-052
// @req FR-FLOW-053
// @req FR-FLOW-054
// @req FR-FLOW-055
//
// Wave-cycle continuity: design baseline, verification denominators, unattended continuity,
// per-requirement partial progress, existing-structure preservation, and cross-wave carry-forward.
//
// A SKILL.md is natural-language agent instruction, not executable code, so the behavior cannot be
// exercised in a unit test; these are raw-text contract assertions over every shipped variant — the
// same technique FR-FLOW-029/042/043/044/045/046 are verified by.
//
// kiwi-wave-master is deliberately excluded from the `.agents/skills` mirror
// (.agents/skills/.speckiwi-mirror-exclusions.json), so its SKILL.md lives in exactly three copies.
// kiwi-srs / kiwi-pipeline / kiwi-pm / kiwi-coder are asserted over the same three authoring copies;
// the shared waves-event contract IS mirrored and is asserted in kiwi-event-contract-content.test.ts.
//
// Assertion style, dictated by mutations that survived earlier rounds:
//   - scope to the governing section (a body-wide token check false-greens off a neighbouring
//     paragraph), and cut the section at the next same-or-higher heading so a trailing h3 does not
//     swallow the following h2;
//   - anchor normative rules to their own line or table cell, not to a character window;
//   - assert hedge vocabulary is ABSENT from the sentence that carries a MUST;
//   - assert quantifiers and polarity literally ("모든", "2기" vs "2기 이상", "금지" vs "지양");
//   - compare positions for ordering rules rather than trusting list markers.

const VARIANTS = ["claude", "codex", "etc"] as const;

/** @req FR-FLOW-110 — resolved through the shared reader: SKILL.md plus the bodies of the
 * `_shared/kiwi/` modules its §0 table references, appended in table order. */
function readSkill(variant: string, skill: string): string {
  return readResolvedSkill(variant, skill);
}

const readWave = (v: string) => readSkill(v, "kiwi-wave-master");
const readSrs = (v: string) => readSkill(v, "kiwi-srs");
const readPm = (v: string) => readSkill(v, "kiwi-pm");
const readCoder = (v: string) => readSkill(v, "kiwi-coder");

/** Body with the YAML frontmatter stripped, so the `description` field cannot false-green a check. */
function skillBody(text: string): string {
  return text.replace(/^---[\s\S]*?\n---\s*\n?/, "");
}

/** A heading and everything under it, down to the next same-or-higher-level heading. "" when absent. */
function sectionUnder(body: string, headingRe: RegExp): string {
  const lines = body.split("\n");
  const start = lines.findIndex((line) => /^#{1,6}\s/.test(line) && headingRe.test(line));
  if (start === -1) return "";
  const level = (at(lines, start).match(/^#+/) as RegExpMatchArray)[0].length;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    const m = at(lines, i).match(/^#+/);
    if (m && m[0].length <= level) {
      end = i;
      break;
    }
  }
  return lines.slice(start, end).join("\n");
}


/** The `verify-loop.md` stance section (moved from kiwi-wave-master §5.5.2). */
/** The `## 2` phase-flow fenced block (the one listing the wave-decomposition phase). */
function phaseFlowBlock(body: string): string {
  const fences = body.split("```");
  for (let i = 1; i < fences.length; i += 2) {
    if (/Wave 분해|wave decompos/i.test(at(fences, i))) return at(fences, i);
  }
  return "";
}

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
const HEDGE = /수 있다|해도 된다|권장|바람직|원칙적으로|원칙으로 하되|가능하면|되도록|경우에 따라|가급적/;

/** The `critical_gates[]` declaration section of whichever skill is under test. */
function gateSection(body: string): string {
  return sectionUnder(body, /^#{2,4}\s.*critical_gates/i);
}

/** The end-of-wave cross-verification section (§5.5). */
function verifySection(body: string): string {
  // @req FR-FLOW-110 — the skill's own §5.5 plus the verify-loop.md engine region its §0 table
  // references. Two bounded regions, not the whole body: §2.1 and §7 stay out of scope.
  return `${sectionUnder(body, /^#{2,3}\s.*(?:상호검증|종료 검증|cross-verif)/i)}\n${moduleRegion(body, "verify-loop")}`;
}

// ---------------------------------------------------------------------------------------------
// Contract identifiers the implementation must use verbatim. Pinning them here is the point: a
// prose-only instruction lets each of the three copies invent its own field name, and the
// waves-event consumer then cannot read any of them.
// ---------------------------------------------------------------------------------------------
const NEW_WAVE_GATE_IDS = [
  "wave-decomposition-coverage-gap",
  "final-verify-kept-finding",
  "unsafe-option-refused",
] as const;

// FR-FLOW-046 AC-7 (revised in 4.0.0): the table transcribes the NEEDS_USER / FAILED halts of the
// children each wave runs — the worker's kiwi-pm arrives as `serial-unit-failed` — and the worktree-
// delegation refusal leaves with the per-wave kiwi-pipeline (FR-FLOW-188 AC-1).
const EXISTING_WAVE_GATE_IDS = [
  "run-root-preflight-mismatch",
  "child-pipeline-needs-user-or-failed",
  "serial-unit-failed",
  "wave-verify-kept-finding",
  "wave-verify-cross-wave-fix-required",
] as const;

const RETIRED_WAVE_GATE_IDS = ["wt-delegation-refused"] as const;

describe("FR-FLOW-047 — design baseline and decomposition coverage gate", () => {
  for (const variant of VARIANTS) {
    describe(`${variant} variant`, () => {
      // FR-FLOW-047 AC-1 (a design document or SDS as a first-class entry input) expired with FR-FLOW-219 AC-3: the
      // entry input becomes a PRD first (`kiwi-prd`), pinned in prd-items-computed.fr-flow-219.test.ts.
      // FR-FLOW-047 AC-2 (the per-wave design baseline) expired with FR-FLOW-212 AC-2; its absence is pinned in
      // wave-srs-first.fr-flow-212.test.ts.
      // FR-FLOW-047 AC-3 (heading coverage before target registration) is replaced by FR-FLOW-219 AC-2: coverage is
      // `speckiwi prd coverage` across every target, and the same gate id still stops the run (below).
      it("AC-3: declares the coverage gap as a critical gate row", () => {
        const gates = gateSection(skillBody(readWave(variant)));
        expect(gates, `${variant}: a critical_gates declaration section must exist`).not.toBe("");
        expect(
          tableRows(gates, /wave-decomposition-coverage-gap/).length,
          `${variant}: critical_gates must declare wave-decomposition-coverage-gap as a table row`,
        ).toBeGreaterThan(0);
      });

      // FR-FLOW-047 AC-4 moved to FR-FLOW-212 AC-5 (wave-srs-first.fr-flow-212.test.ts): the impact analysis reads
      // `existing_modules`, and the decomposition records each node's modules in `existing-modules.json`.
      // FR-FLOW-047 AC-5 moved to FR-FLOW-217 AC-4 (redecompose-rules.fr-flow-217.test.ts): §0.5 keeps the
      // append exception, now R3 · R4 under the run cap.
      // FR-FLOW-047 AC-6 expired with the baseline artifact (FR-FLOW-212 AC-2). The constraint artifact's
      // resolution from `waves.jsonl` moved to FR-FLOW-219 AC-1 (prd-items-computed.fr-flow-219.test.ts).
    });
  }
});

describe("FR-FLOW-048 — verification denominator covers design baseline and constraints", () => {
  for (const variant of VARIANTS) {
    describe(`${variant} variant`, () => {
      // FR-FLOW-048 AC-1 to AC-3 moved to FR-FLOW-219 AC-1 (prd-items-computed.fr-flow-219.test.ts): the design
      // layer is the node's PRD items — the mandatory bundle rows, the full enumeration with `unmapped`, the
      // one-unmapped-item ALL_MATCH ban independent of the REQ/AC layer, and the external `expected`.
      // FR-FLOW-048 AC-4 (design_layer counts) expired 2026-11-05 → FR-FLOW-212: no design_items is left,
      // and its absence is pinned under FR-FLOW-212 AC-2 (wave-srs-first.fr-flow-212.test.ts).
      // FR-FLOW-048 AC-5 (verifier 2's preservation denominator) expired → FR-FLOW-220: preservation is the
      // `orchestrate preservation check` row of verify-loop §2, and the classes it reports are pinned on
      // wave-master §5.5.2 under FR-FLOW-220 AC-1 (machine-checks-first.fr-flow-220.test.ts).
      // FR-FLOW-048 AC-6 (row-count invalidation for both verifiers) expired → FR-FLOW-220: a wave round's
      // rows are the verifier's tests, so there is no fixed row count to miss.
      it("AC-5 (expired): wave-master no longer gives a second verifier its own denominator", () => {
        expect(skillBody(readWave(variant))).not.toContain("검증자 2 의 **분모**");
      });
    });
  }
});

describe("FR-FLOW-049 — all-wave final verification against the whole design baseline", () => {
  for (const variant of VARIANTS) {
    describe(`${variant} variant`, () => {
      it("AC-1: runs a final pass after the last wave and before reporting completion", () => {
        const body = skillBody(readWave(variant));
        const finalSection = sectionUnder(body, /^##\s.*최종 검증/);
        expect(finalSection, `${variant}: a final-verification section must exist`).not.toBe("");
        const flow = phaseFlowBlock(body);
        expect(flow, `${variant}: the phase-flow block must exist`).not.toBe("");
        expect(
          flow.indexOf("Phase 4.5") > flow.indexOf("Phase 4 ") && flow.indexOf("Phase 4.5") < flow.indexOf("Phase 5"),
          `${variant}: the phase-flow block must list Phase 4.5 between Phase 4 and Phase 5`,
        ).toBe(true);
        const rule = lineWith(finalSection, /마지막 wave/);
        expect(rule, `${variant}: the final pass must state its trigger`).not.toBe("");
        expect(
          /`complete`/.test(rule) && /(?:뒤|후)/.test(rule),
          `${variant}: the final pass must run after the last wave's complete event`,
        ).toBe(true);
      });

      it("AC-2: sets the denominator to the whole baseline plus cross-wave integration items", () => {
        const finalSection = sectionUnder(skillBody(readWave(variant)), /^##\s.*최종 검증/);
        const rule = lineWith(finalSection, /분모/);
        expect(rule, `${variant}: the final pass must state its denominator`).not.toBe("");
        // Rewritten 2026-11-05 with FR-FLOW-212 AC-2: the design baseline is gone, so the final pass
        // reads every node's ACs and PRD items plus the integration items, none of them self-counted.
        expect(
          /\*\*모든 노드\*\* 의 `acs` 와 `prd_items` 합집합/.test(rule),
          `${variant}: the final denominator must be every node's ACs and PRD items, not the last wave's slice`,
        ).toBe(true);
        expect(
          /\*\*검증자가 스스로 산정하지 않는다\*\*/.test(rule),
          `${variant}: the final denominator must be fixed outside the verifier`,
        ).toBe(true);
        expect(
          /wave 경계를 가로지르는 \*\*통합 항목\*\* — 서로 다른 노드의 요구 사이 `Requirement` \/ `depends_on` 링크와 그래프 간선/.test(finalSection),
          `${variant}: integration items belonging to no single wave scope must be in the denominator`,
        ).toBe(true);
      });

      it("AC-3: reuses the per-wave loop's machine checks, fresh verifier, red-test findings and fix-free round", () => {
        const finalSection = sectionUnder(skillBody(readWave(variant)), /^##\s.*최종 검증/);
        // Rewritten 2026-11-05 with FR-FLOW-220 AC-7: the two stance-separated verifiers and the
        // add-only step are gone; the final pass reuses the machine checks and the one-verifier model.
        expect(/기계 검사가 먼저/.test(finalSection), `${variant}: the final pass must run the machine checks first`).toBe(
          true,
        );
        expect(
          /라운드마다 검증자를 새로 띄우며\(`--max` 면 둘/.test(finalSection),
          `${variant}: the final pass must reuse the fresh verifier per round`,
        ).toBe(true);
        expect(
          /red 테스트만 kept finding 으로 남/.test(finalSection),
          `${variant}: the final pass must keep only red tests as findings`,
        ).toBe(true);
        expect(
          /수정이 적용되지 않았을 것/.test(finalSection),
          `${variant}: the final pass must reuse the fix-free clean round condition`,
        ).toBe(true);
      });

      it("AC-4: appends a run-scoped event carrying its own verification object", () => {
        const finalSection = sectionUnder(skillBody(readWave(variant)), /^##\s.*최종 검증/);
        expect(
          /`phase="final-verify"`|`phase`\s*=\s*`?"?final-verify/.test(finalSection),
          `${variant}: the final pass must append an event carrying phase=final-verify`,
        ).toBe(true);
        // Run-scoped, not wave-scoped: without the sentinel the per-wave latest-status computation
        // reads the final pass as a wave and the resume predicate breaks.
        expect(
          /`wave="all"`/.test(finalSection) && /`order=0`/.test(finalSection),
          `${variant}: the run-scoped final event must carry wave="all" and order=0`,
        ).toBe(true);
        expect(
          /`verification`/.test(finalSection),
          `${variant}: the final event must carry its own verification object`,
        ).toBe(true);
      });

      it("AC-5: refuses to report completion until the final verdict passes", () => {
        const finalSection = sectionUnder(skillBody(readWave(variant)), /^##\s.*최종 검증/);
        const rule = lineWith(finalSection, /완료로 보고하지 않는다/);
        expect(
          rule,
          `${variant}: the orchestration must not be reported complete before the final verdict passes`,
        ).not.toBe("");
        expect(HEDGE.test(rule), `${variant}: the completion gate must be absolute, not hedged`).toBe(false);
        expect(
          /재개[^\n]*최종 검증(?:으로|부터)/.test(finalSection),
          `${variant}: a run whose final pass has not passed must resume INTO the final pass`,
        ).toBe(true);
      });

      it("AC-6: reports final residual findings in full", () => {
        const finalSection = sectionUnder(skillBody(readWave(variant)), /^##\s.*최종 검증/);
        expect(
          /잔여 finding 을 \*\*전량\*\* 보고한다/.test(finalSection),
          `${variant}: final residual findings must be reported in full`,
        ).toBe(true);
        expect(
          /(?:표본|상위 N)(?:으?로|만)\s*(?:보고|축약|자른다)/.test(finalSection),
          `${variant}: no clause may reduce the final residual report to a sample or a top-N list`,
        ).toBe(false);
      });

      it("AC-1/AC-5: declares the final-pass halt as a critical gate row", () => {
        const gates = gateSection(skillBody(readWave(variant)));
        const row = rowCells(gates, /final-verify-kept-finding/);
        expect(row.length, `${variant}: critical_gates must declare final-verify-kept-finding`).toBeGreaterThan(2);
        expect(
          /--auto/.test(row.join(" ")) || /--auto/.test(gates),
          `${variant}: the final-pass gate must halt even under --auto`,
        ).toBe(true);
      });
    });
  }
});

describe("FR-FLOW-050 — design-to-SRS fidelity wiring and SRS-layer gap remediation", () => {
  for (const variant of VARIANTS) {
    describe(`${variant} variant`, () => {
      // FR-FLOW-050 AC-1 and AC-2 (the design baseline as the research document, on the journalled path) expired with
      // FR-FLOW-212 AC-2. The one authoring call still carries `--research-doc` and `--constraints-doc`, pinned
      // under FR-FLOW-212 AC-1 in wave-srs-first.fr-flow-212.test.ts.
      // FR-FLOW-050 AC-3 · AC-4 (the design-present / SRS-absent routing row, kept apart from the
      // unclosable-in-code row) expired 2026-11-05 → FR-FLOW-218: a kept requirement gap goes to the
      // incremental authoring as a delta, pinned on verify-loop §7 under FR-FLOW-220 AC-4
      // (machine-checks-first.fr-flow-220.test.ts) and FR-FLOW-045 AC-5 (kiwi-wave-verify-content.test.ts).
      it("FR-FLOW-050 AC-5: keeps the cross-wave halt in force for the remediation path", () => {
        const routing = sectionUnder(verifySection(skillBody(readWave(variant))), /^#{2,4}\s.*개선 위임/);
        expect(
          /증분 저작이[^\n]*(?:이전|완료된) wave[^\n]*`wave-verify-cross-wave-fix-required`/.test(routing),
          `${variant}: incremental authoring touching a completed wave target must still hit the cross-wave halt`,
        ).toBe(true);
      });

      // FR-FLOW-050 AC-6 (automatic remediation of a design-layer gap) expired 2026-11-05 → FR-FLOW-212:
      // there is no design layer left to remediate.
    });
  }
});

describe("FR-FLOW-051 — wave target registration and wave-internal resume granularity", () => {
  for (const variant of VARIANTS) {
    describe(`${variant} variant`, () => {
      it("FR-FLOW-051 AC-1: kiwi-srs registers an unregistered target instead of failing", () => {
        const target = sectionUnder(skillBody(readSrs(variant)), /^#{3}\s.*TARGET 확인/);
        expect(target, `${variant}: kiwi-srs must have a target-resolution section`).not.toBe("");
        const rule = lineWith(target, /미등록/);
        expect(rule, `${variant}: kiwi-srs must define what happens for an unregistered target`).not.toBe("");
        expect(
          /`set_active_target`/.test(rule) && /(?:생성|create)/.test(rule),
          `${variant}: an unregistered target must be registered through a creation-enabled activation call`,
        ).toBe(true);
        // The halt must be scoped to a failed REGISTRATION, not to the target being absent — the
        // latter is the status quo this AC removes.
        expect(
          /등록 자체가 실패한 경우에만/.test(target),
          `${variant}: kiwi-srs must halt only when the registration call itself fails`,
        ).toBe(true);
      });

      it("FR-FLOW-051 AC-2: the CLI fallback row shows the creation option", () => {
        const fallback = sectionUnder(skillBody(readSrs(variant)), /^##\s.*(?:MCP \/ CLI fallback|CLI fallback)/i);
        expect(fallback, `${variant}: kiwi-srs must have a CLI fallback table`).not.toBe("");
        // Column-bound: `--create` mentioned in the prose below the table does not make the
        // fallback path able to register anything.
        const cells = rowCells(fallback, /Target 활성화/);
        expect(cells.length, `${variant}: the fallback table must have a target-activation row`).toBeGreaterThan(3);
        expect(
          /--create/.test(at(cells, 3)),
          `${variant}: the CLI-fallback CELL for target activation must show the creation option`,
        ).toBe(true);
      });

      // FR-FLOW-051 AC-3 moved to FR-FLOW-212 AC-3 (wave-srs-first.fr-flow-212.test.ts): registering the unregistered
      // product target is the initial call's normal path. AC-5 (`srs_authored`) and AC-6 (three resume stages)
      // expired with FR-FLOW-212 AC-3, which pins the marker's absence and the two-stage resume.
    });
  }
});

describe("FR-FLOW-052 — unattended continuity across cycle entry and cost gates", () => {
  for (const variant of VARIANTS) {
    describe(`${variant} variant`, () => {
      it("FR-FLOW-052 AC-1: the worker entry states the worker kiwi-pm invocation and its flags", () => {
        // Revised in 4.0.0: wave-master enters no kiwi-pipeline cycle (FR-FLOW-188 AC-7); the worker
        // entry is the shared contract's kiwi-pm call (FR-FLOW-188 AC-2).
        const stage = sectionUnder(skillBody(readWave(variant)), /^##\s+5\.\s/);
        expect(stage, `${variant}: the §5 stage-execution section must exist`).not.toBe("");
        expect(
          /parallel-waves\.md/.test(stage),
          `${variant}: §5 must hand the waves to the shared parallel-waves contract`,
        ).toBe(true);
        // Anchored on the contract's PW-6 worker step: the fenced command opening with /kiwi-pm.
        const contract = readRepoFile(`skills/${variant}/_shared/kiwi/parallel-waves.md`).split("\n");
        const pw6 = contract.findIndex((line) => line.startsWith("**PW-6 "));
        const pw7 = contract.findIndex((line, i) => i > pw6 && line.startsWith("**PW-7 "));
        expect(pw6, `${variant}: parallel-waves.md must carry the PW-6 worker step`).toBeGreaterThan(-1);
        const worker = contract.slice(pw6, pw7 === -1 ? contract.length : pw7);
        const open = worker.findIndex((line) => /^\s*\/kiwi-pm\s/.test(line));
        expect(open, `${variant}: PW-6 must state the worker /kiwi-pm invocation`).toBeGreaterThan(-1);
        const close = worker.findIndex((line, i) => i > open && /^\s*```/.test(line));
        const call = worker.slice(open, close === -1 ? worker.length : close).join(" ");
        for (const flag of ["--no-final", "--no-pipeline-emit", "--commit-lane-work", "--defer-srs-mutation"]) {
          expect(call.includes(flag), `${variant}: the worker /kiwi-pm invocation must carry ${flag}`).toBe(true);
        }
      });

      // FR-FLOW-052 AC-2 retired in 4.0.0 (successor FR-FLOW-188): wave-master enters no kiwi-pipeline
      // cycle, and the pipeline's multi-candidate gate row is FR-FLOW-127's — asserted in
      // test/skills/pipeline-cycle-default.fr-flow-124.test.ts, not here.

      it("AC-3: reads the work mode in preflight and declares wave cycles body-scope", () => {
        const preflight = sectionUnder(skillBody(readWave(variant)), /^##\s.*Preflight/);
        expect(preflight, `${variant}: the preflight section must exist`).not.toBe("");
        expect(
          /get_work_mode/.test(preflight),
          `${variant}: preflight must read the persisted work mode`,
        ).toBe(true);
        const rule = lineWith(preflight, /body-scope|본문 스코프/);
        expect(rule, `${variant}: wave cycles must be declared body-scope work`).not.toBe("");
        expect(
          /kiwi-tdd/.test(preflight),
          `${variant}: the routing exclusion must name the test-first skill it excludes`,
        ).toBe(true);
        expect(
          /step-scoped[^\n]*적용되지 않는다|step 스코프[^\n]*적용되지 않는다/.test(preflight),
          `${variant}: step-scoped routing must be declared inapplicable to a wave cycle`,
        ).toBe(true);
      });

      it("AC-4: lists the cost and integration pass-through options with their propagation path", () => {
        const propagation = sectionUnder(skillBody(readWave(variant)), /^#{3}\s.*(?:pass-through|전달 옵션)/i);
        expect(propagation, `${variant}: a pass-through option sub-section must exist under §7`).not.toBe("");
        for (const opt of ["--auto-cost-warning", "--auto-integration"]) {
          expect(
            tableRows(propagation, new RegExp(opt.replace(/-/g, "\\-"))).length > 0 || propagation.includes(opt),
            `${variant}: ${opt} must be reachable as an explicitly listed pass-through option`,
          ).toBe(true);
        }
        // The chain is what makes the option actually arrive; naming only the endpoints leaves the
        // intermediate skills free to drop it. FR-FLOW-052 AC-4 (unrevised) read with FR-FLOW-188
        // AC-2/AC-7: the per-wave kiwi-pipeline hop is gone, so each option's own row must route
        // through the worker's kiwi-pm to kiwi-coder, and the section must name the worker card and
        // the worker kiwi-pm call of parallel-waves.md that carry it.
        for (const opt of ["--auto-cost-warning", "--auto-integration"]) {
          const row = tableRows(propagation, new RegExp("^\\s*\\|\\s*`" + opt + "`")).join(" ");
          expect(
            /워커의 kiwi-pm → kiwi-coder/.test(row),
            `${variant}: the ${opt} row must route through the worker's kiwi-pm to kiwi-coder`,
          ).toBe(true);
          expect(/kiwi-pipeline/.test(row), `${variant}: the ${opt} row still routes through kiwi-pipeline`).toBe(false);
        }
        expect(
          /parallel-waves\.md` PW-5/.test(propagation) && /PW-6/.test(propagation),
          `${variant}: the pass-through section must name the worker card (PW-5) and the worker kiwi-pm call (PW-6) that carry the options`,
        ).toBe(true);
      });

      it("AC-5: guards the integration-test consent gate with the child-context check", () => {
        const integration = sectionUnder(skillBody(readCoder(variant)), /^#{3}\s.*조건/);
        expect(integration, `${variant}: kiwi-coder must have an integration-test condition section`).not.toBe("");
        expect(
          /spawn_context/.test(integration) && /pm-child/.test(integration),
          `${variant}: the integration-test consent gate must carry the same pm-child guard as the follow-on review gate`,
        ).toBe(true);
      });

      it("FR-FLOW-052 AC-6: refuses the regression-skip and reviewer-off options by name through a declared critical gate", () => {
        const body = skillBody(readWave(variant));
        const preflight = sectionUnder(body, /^##\s.*Preflight/);
        const rule = lineWith(preflight, /--skip-regression/);
        expect(rule, `${variant}: the regression-skip refusal must be stated`).not.toBe("");
        expect(
          /--reviewer-off/.test(rule),
          `${variant}: the reviewer-off option must be refused on the same line`,
        ).toBe(true);
        expect(
          /거부한다/.test(rule),
          `${variant}: these options must be REFUSED, not merely discouraged`,
        ).toBe(true);
        expect(HEDGE.test(rule), `${variant}: the refusal must be absolute, not hedged`).toBe(false);
        const gates = gateSection(body);
        expect(
          tableRows(gates, /unsafe-option-refused/).length,
          `${variant}: critical_gates must declare unsafe-option-refused as a table row`,
        ).toBeGreaterThan(0);
        // The unattended flag's propagation must be sourced from the shared contract, not restated.
        const autoProp = sectionUnder(body, /^#{3}\s.*--auto/);
        expect(
          /auto-option\.md/.test(autoProp),
          `${variant}: automatic propagation of --auto to per-wave children must follow the shared option contract`,
        ).toBe(true);
      });
    });
  }
});

describe("FR-FLOW-053 — per-requirement partial progress instead of whole-run blocking", () => {
  for (const variant of VARIANTS) {
    describe(`${variant} variant`, () => {
      // FR-FLOW-053 AC-1 as revised for 4.0.0: one SDS is one kiwi-coder run, so kiwi-pm cannot run
      // part of it. The per-requirement cut happens where the SDS scope is chosen — the kiwi-sds
      // requirement filter — and kiwi-pm's --auto branch sends the draft requirement there instead of
      // halting the whole run.
      it("FR-FLOW-053 AC-1: leaves a draft requirement out of the SDS scope under --auto", () => {
        const body = skillBody(readPm(variant));
        const auto = sectionUnder(body, /^#{3}\s.*`--auto` 동작/);
        expect(auto, `${variant}: kiwi-pm must have an --auto lifecycle-gate section`).not.toBe("");
        const draft = lineWith(auto, /`draft`/);
        expect(draft, `${variant}: the draft branch must exist`).not.toBe("");
        expect(
          /요구 필터/.test(draft) && /kiwi-sds/.test(draft) && /SDS 범위/.test(draft),
          `${variant}: a draft requirement must be left out of the SDS scope through the kiwi-sds requirement filter`,
        ).toBe(true);
        expect(/Task/.test(draft), `${variant}: the draft branch still skips plan Tasks`).toBe(false);
        // Polarity: leaving HALT on that line reinstates whole-run blocking.
        expect(
          /HALT/.test(draft),
          `${variant}: the draft branch must no longer halt the whole run`,
        ).toBe(false);
        expect(
          /skip[^\n]*목록[^\n]*보고|skip 목록을 보고/.test(auto),
          `${variant}: the skipped list must be reported`,
        ).toBe(true);
        // deprecated / frozen are policy stops and must NOT be relaxed along with draft.
        const policy = lineWith(auto, /`deprecated`/);
        expect(
          /HALT/.test(policy),
          `${variant}: deprecated and frozen must still halt immediately`,
        ).toBe(true);
      });

      it("AC-1: drops lifecycle-gate-draft from the unconditional critical gate table", () => {
        const gates = gateSection(skillBody(readPm(variant)));
        expect(gates, `${variant}: kiwi-pm must declare critical_gates`).not.toBe("");
        expect(
          tableRows(gates, /`?lifecycle-gate-draft`?/).length,
          `${variant}: lifecycle-gate-draft must no longer be declared an unconditional HALT gate — it contradicts the per-requirement skip`,
        ).toBe(0);
      });

      it("FR-FLOW-053 AC-2: routes requirements left at draft by the feasibility stage through the remediation table", () => {
        const routing = sectionUnder(verifySection(skillBody(readWave(variant))), /^#{2,4}\s.*개선 위임/);
        // Revised in 4.0.0: only the feasibility stage leaves a requirement at draft — the planning
        // stage is gone (FR-FLOW-184 AC-2). Anchored on the row whose finding cell names that stage.
        const row = rowCells(routing, /feasibility 단계가 draft 로 남긴/);
        expect(row.length, `${variant}: the routing table must have a left-at-draft-by-feasibility row`).toBeGreaterThan(2);
        const handling = row.slice(2).join(" ");
        expect(
          /kiwi-srs-feasibility/.test(handling) && /--req-filter/.test(handling),
          `${variant}: the row's destination must re-run feasibility on exactly those requirements`,
        ).toBe(true);
        expect(
          /스케줄링 단계부터\(`--sds` 면 SDS 작성 단계부터\) 재진입/.test(handling) && /draft-stability-skip/.test(handling),
          `${variant}: the row must re-enter from SDS authoring and record a failed promotion as residual`,
        ).toBe(true);
        expect(/planning|planner|계획/.test(row.join(" ")), `${variant}: the row still names a planning stage`).toBe(false);
      });

      it("FR-FLOW-053 AC-3: declares the task-failure escalation halt as a critical gate", () => {
        const gates = gateSection(skillBody(readPm(variant)));
        const cells = rowCells(gates, /task-failure-escalation/);
        expect(cells.length, `${variant}: kiwi-pm critical_gates must declare task-failure-escalation`).toBeGreaterThan(2);
      });

      // FR-FLOW-053 AC-4 retired in 4.0.0 (successor FR-FLOW-188): kiwi-pm runs one SDS as one
      // kiwi-coder run and no plan Task depends on another, so no predecessor rule may linger.
      it("FR-FLOW-053 AC-4: carries no plan-task predecessor rule any more", () => {
        // kiwi-pm's own text only: the resolved body appends shared modules (auto-option.md), whose
        // gate catalogue is not this skill's rule. Read the file itself — a CRLF module leaves its
        // headings unprefixed, so cutting the resolved body at the first prefixed heading is unsafe.
        const body = skillBody(readRepoFile(`skills/${variant}/kiwi-pm/SKILL.md`));
        expect(body, `${variant}: kiwi-pm must exist`).not.toBe("");
        expect(
          /선행 Task|depends_on/.test(body),
          `${variant}: kiwi-pm still resolves plan-task predecessors that no longer exist`,
        ).toBe(false);
      });

      it("FR-FLOW-053 AC-5: defers a scope-boundary conflict under --auto instead of blocking authoring", () => {
        const gate = sectionUnder(skillBody(readSrs(variant)), /^#{3}\s.*Scope-boundary impact gate/i);
        expect(gate, `${variant}: kiwi-srs must have a scope-boundary gate section`).not.toBe("");
        const rule = lineWith(gate, /`--auto`/);
        expect(rule, `${variant}: the gate must state its unattended behaviour`).not.toBe("");
        expect(
          /(?:보류|연기)하고 기록한다/.test(rule),
          `${variant}: under --auto a boundary-conflicting requirement must be deferred and recorded`,
        ).toBe(true);
        expect(
          /나머지 요구사항[^\n]*(?:계속|이어서)/.test(rule),
          `${variant}: the remaining requirements must keep being authored`,
        ).toBe(true);
        expect(
          /전체 중단은[^\n]*사용자[^\n]*거부/.test(gate),
          `${variant}: the whole-run block must be reserved for an explicit user refusal`,
        ).toBe(true);
      });

      it("AC-6: surfaces every skipped or deferred requirement as wave residual", () => {
        const section = verifySection(skillBody(readWave(variant)));
        const rule = lineWith(section, /skip(?:되거나|·)|보류된 REQ/);
        expect(
          /`reason_class`/.test(section),
          `${variant}: skipped and deferred requirements must be recorded with a reason_class`,
        ).toBe(true);
        expect(
          /`verification\.residual`/.test(section),
          `${variant}: they must surface in verification.residual rather than being silently omitted`,
        ).toBe(true);
        expect(
          /조용히 누락|silently omit/i.test(rule) === false,
          `${variant}: the rule line must not read as licence to omit`,
        ).toBe(true);
      });
    });
  }
});

describe("FR-FLOW-054 — existing-structure preservation guards across the implementation chain", () => {
  for (const variant of VARIANTS) {
    describe(`${variant} variant`, () => {
      it("FR-FLOW-054 AC-1: declares existing tests inviolable with all three prohibitions", () => {
        const body = skillBody(readCoder(variant));
        const rule = lineWith(body, /기존 테스트 불가침/);
        expect(rule, `${variant}: kiwi-coder must declare an existing-tests-inviolable rule`).not.toBe("");
        for (const [token, what] of [
          ["기존 테스트 파일 삭제", "deletion of existing test files"],
          ["기존 테스트 케이스 제거", "removal of existing test cases"],
          ["기존 단언 약화", "weakening of existing assertions"],
        ] as const) {
          expect(rule.includes(token), `${variant}: the rule must forbid ${what}`).toBe(true);
        }
        expect(
          /금지/.test(rule),
          `${variant}: the three must be prohibited, not discouraged`,
        ).toBe(true);
        expect(HEDGE.test(rule), `${variant}: the inviolability rule must be absolute, not hedged`).toBe(false);
      });

      it("FR-FLOW-054 AC-2: detects the three in the diff at the preservation check as a kept finding", () => {
        const impl = sectionUnder(skillBody(readCoder(variant)), /^#{3}\s.*단계 흐름/);
        expect(impl, `${variant}: the implementation-loop flow must exist`).not.toBe("");
        // Scoped to the SDS-code match gate branch of the flow block (FR-FLOW-185 AC-3, which replaced
        // the plan-versus-code gate), so a mention in the review-axis table below cannot satisfy it.
        // FR-FLOW-054 AC-2 (4.1.0): the preservation check runs in every run, with or without an SDS (FR-FLOW-194 AC-5).
        const gate = impl.split(/\(d\) 보존 검사 — SDS 유무와 무관하게 모든 실행에서 돈다/)[1]?.split(/\(d′\)/)[0] ?? "";
        expect(gate, `${variant}: the preservation check branch must exist`).not.toBe("");
        expect(
          /기존 테스트/.test(gate) && /(?:삭제|제거)/.test(gate) && /약화/.test(gate),
          `${variant}: the gate must detect test-file deletion, test-case removal and assertion weakening in the diff`,
        ).toBe(true);
        // FR-FLOW-054 AC-2 as rewritten for 5.3.0 (FR-FLOW-221 AC-3): a kept finding, the diff its evidence.
        // Read from the consequence line under the test detection itself: the branch has three detections,
        // and a branch-wide match stays green when only the test detection's consequence is weakened.
        const lines = gate.split("\n");
        const consequence = lines[lines.findIndex((l) => /기존 테스트 파일 삭제/.test(l)) + 1] ?? "";
        expect(
          /검출은 kept finding\(diff 가 증거\)/.test(consequence) && /재구현/.test(consequence),
          `${variant}: a detection must be a kept finding, with the diff as its evidence, that forces re-implementation`,
        ).toBe(true);
      });

      it("FR-FLOW-054 AC-3: declares that detection as a critical gate that --auto cannot resolve", () => {
        const gates = gateSection(skillBody(readCoder(variant)));
        const cells = rowCells(gates, /existing-test-weakened-or-deleted/);
        expect(
          cells.length,
          `${variant}: kiwi-coder critical_gates must declare existing-test-weakened-or-deleted`,
        ).toBeGreaterThan(2);
        expect(
          /결정 서브에이전트로 우회 금지|우회 금지/.test(gates),
          `${variant}: the gate must not be resolvable by an automated decision`,
        ).toBe(true);
      });

      it("FR-FLOW-054 AC-4: captures a baseline suite result and judges regression by the delta", () => {
        const body = skillBody(readCoder(variant));
        const regression = sectionUnder(body, /^#{3}\s.*회귀 테스트/);
        expect(regression, `${variant}: the regression section must exist`).not.toBe("");
        const rule = lineWith(regression, /기준선|baseline/i);
        expect(rule, `${variant}: a baseline capture rule must exist`).not.toBe("");
        expect(
          /코드를 바꾸기 전에/.test(rule),
          `${variant}: the baseline must be captured BEFORE the task starts changing code`,
        ).toBe(true);
        expect(
          /(?:델타|delta|증분)로 판정/.test(regression),
          `${variant}: regression must be judged by the delta against the captured baseline`,
        ).toBe(true);
        expect(
          /기존 실패[^\n]*(?:보고|분리)하고[^\n]*(?:현재 Task 의 것으로 )?귀속하지 않는다/.test(regression),
          `${variant}: pre-existing failures must be reported rather than attributed to the current task`,
        ).toBe(true);
      });

      it("FR-FLOW-054 AC-5: raises a distinct path-independent gate for existing public contract changes", () => {
        const gates = gateSection(skillBody(readCoder(variant)));
        const cells = rowCells(gates, /existing-public-contract-change/);
        expect(
          cells.length,
          `${variant}: kiwi-coder critical_gates must declare existing-public-contract-change`,
        ).toBeGreaterThan(2);
        const reason = cells.join(" ");
        expect(
          /(?:삭제|시그니처 변경)/.test(reason) && /public/.test(reason),
          `${variant}: the gate must trigger on deletion of, or signature change to, an existing public symbol`,
        ).toBe(true);
        expect(
          /diff/.test(reason),
          `${variant}: the detection must come from the diff`,
        ).toBe(true);
        // The point of the AC: not the migration/schema/auth path-token heuristic.
        expect(
          /경로와 무관|path 와 무관/.test(reason),
          `${variant}: the gate must be critical regardless of the file path, not a path-token heuristic`,
        ).toBe(true);
      });

      it("AC-6: requires a green full regression run at the wave head for a passing verdict", () => {
        const section = verifySection(skillBody(readWave(variant)));
        const bundle = sectionUnder(section, /^#{3,4}\s.*검증자 입력과 호스트가 읽는 것/);
        const row = rowCells(bundle, /회귀 스위트/);
        expect(row.length, `${variant}: the evidence bundle must include a full regression suite run`).toBeGreaterThan(2);
        const cell = row.join(" ");
        for (const field of ["command", "exit_code", "failing_tests"]) {
          expect(cell.includes(field), `${variant}: the regression row must record ${field}`).toBe(true);
        }
        expect(
          /wave (?:head|헤드|tip)/i.test(cell),
          `${variant}: the regression run must be executed at that wave's head`,
        ).toBe(true);
        // The pass condition. 5.3.0 dropped the Normal PASS row with the severities (FR-FLOW-221 AC-1), so
        // it is anchored on verify-loop §5's pass sentence. R3-M20 still holds: the delta is the primary
        // condition, and exit_code=0 appears once, only as the capture-failure fallback.
        const passLine = lineWith(section, /통과 조건은 kept finding 0/);
        expect(passLine, `${variant}: verify-loop §5 must state the pass condition`).not.toBe("");
        expect(
          /failing_tests\s*⊆\s*baseline_failing_tests/.test(passLine),
          `${variant}: the pass condition's regression clause must be the baseline delta, not a bare green suite`,
        ).toBe(true);
        expect(
          (passLine.match(/exit_code/g) ?? []).length,
          `${variant}: exit_code must appear once in the pass condition — a second occurrence is an unconditional green-suite requirement smuggled back in`,
        ).toBe(1);
        expect(
          /\*\*캡처에 실패\*\*해 `baseline_failing_tests` 가 없으면 `exit_code`=0 으로 격하된다/.test(passLine),
          `${variant}: the single exit_code=0 occurrence must be the capture-failure fallback, not the primary condition`,
        ).toBe(true);
      });
    });
  }
});

describe("FR-FLOW-055 — cross-wave carry-forward, decision rule and re-entry scope", () => {
  for (const variant of VARIANTS) {
    describe(`${variant} variant`, () => {
      it("FR-FLOW-055 AC-1: decides cross-wave status by a mechanical rule over the file set", () => {
        const cross = sectionUnder(verifySection(skillBody(readWave(variant))), /^#{2,4}\s.*교차 wave/);
        expect(cross, `${variant}: a cross-wave sub-section must exist`).not.toBe("");
        const rule = lineWith(cross, /파일 집합/);
        expect(rule, `${variant}: the cross-wave decision rule must key on the file set`).not.toBe("");
        expect(
          /기계적/.test(rule),
          `${variant}: cross-wave status must be decided mechanically, not by narrative judgement`,
        ).toBe(true);
        expect(
          /서술적 판단|narrative/i.test(cross) === false || /서술적 판단[^\n]*아니다/.test(cross),
          `${variant}: narrative judgement must be excluded, not offered as an alternative`,
        ).toBe(true);
        // Both anchors of the intersection; dropping either silently narrows the rule.
        expect(
          /코드 trace 앵커/.test(cross),
          `${variant}: the rule must intersect with the earlier wave's recorded requirement code trace anchors`,
        ).toBe(true);
        expect(
          /(?:이전|앞선) wave 의 diff 파일 집합/.test(cross),
          `${variant}: the rule must also intersect with the earlier wave's diff file set`,
        ).toBe(true);
      });

      it("FR-FLOW-055 AC-2: keeps a requirement-level change a halt", () => {
        const cross = sectionUnder(verifySection(skillBody(readWave(variant))), /^#{2,4}\s.*교차 wave/);
        const rule = lineWith(cross, /요구사항을 바꿔야/);
        expect(rule, `${variant}: a requirement-level cross-wave change must have its own rule`).not.toBe("");
        expect(
          /HALT|중단/.test(rule),
          `${variant}: changing an earlier wave's requirements must remain a halt`,
        ).toBe(true);
        expect(HEDGE.test(rule), `${variant}: the requirement-level halt must be absolute, not hedged`).toBe(false);
      });

      it("AC-3: carries a code-level finding forward and records it with a cross-wave marker", () => {
        const cross = sectionUnder(verifySection(skillBody(readWave(variant))), /^#{2,4}\s.*교차 wave/);
        const rule = lineWith(cross, /코드를 바꿔야/);
        expect(rule, `${variant}: a code-level cross-wave finding must have its own rule`).not.toBe("");
        expect(
          /남은 wave/.test(rule),
          `${variant}: the finding must be carried into the scope of a remaining wave`,
        ).toBe(true);
        expect(
          /남은 wave 가 없으면[^\n]*새 wave 를 추가/.test(cross),
          `${variant}: a newly appended wave must be the fallback when no wave remains`,
        ).toBe(true);
        expect(
          /`cross_wave`/.test(cross) && /`carried_into`/.test(cross),
          `${variant}: the carried finding must be recorded as residual with the cross_wave and carried_into markers`,
        ).toBe(true);
      });

      it("FR-FLOW-055 AC-4: never modifies or reverses the earlier wave's complete event", () => {
        const cross = sectionUnder(verifySection(skillBody(readWave(variant))), /^#{2,4}\s.*교차 wave/);
        const rule = lineWith(cross, /`complete` 이벤트를/);
        expect(rule, `${variant}: the append-only guarantee must be restated for carry-forward`).not.toBe("");
        expect(
          /수정하거나 되돌리지 않는다/.test(rule),
          `${variant}: carrying a finding forward must not modify or reverse the earlier complete event`,
        ).toBe(true);
        expect(HEDGE.test(rule), `${variant}: the append-only guarantee must be absolute, not hedged`).toBe(false);
      });

      it("FR-FLOW-055 AC-5: reserves the halt for the case where no carry-forward path exists", () => {
        const cross = sectionUnder(verifySection(skillBody(readWave(variant))), /^#{2,4}\s.*교차 wave/);
        const rule = lineWith(cross, /양쪽 carry-forward 경로/);
        expect(rule, `${variant}: the halt must be scoped against the carry-forward paths`).not.toBe("");
        expect(
          /모두 불가능할 때(?:에만|만)/.test(rule),
          `${variant}: the halt must be reserved for the case where NEITHER carry-forward path is available`,
        ).toBe(true);
        expect(
          /첫 대응이 아니다/.test(cross),
          `${variant}: the halt must be declared as not the first response to any cross-wave finding`,
        ).toBe(true);
      });

      it("FR-FLOW-055 AC-6: gives a verification-driven wave re-entry an explicit scope", () => {
        const routing = sectionUnder(verifySection(skillBody(readWave(variant))), /^#{2,4}\s.*개선 위임/);
        // The review delegation row already carries --base/--commits; the re-entry row must reach
        // the same specificity or a re-entry silently re-runs the whole wave.
        const row = rowCells(routing, /재진입/);
        expect(row.length, `${variant}: a wave re-entry row must exist`).toBeGreaterThan(2);
        // Revised in 4.0.0: re-entry no longer goes through a per-wave kiwi-pipeline and its identity
        // flag is `--sds-id` (FR-FLOW-184 AC-5). Anchored on the re-entry scope rule itself.
        const rule = lineWith(routing, /재진입은 명시 범위/);
        expect(rule, `${variant}: the re-entry scope rule must exist`).not.toBe("");
        expect(
          /미해소 요구사항 필터|미대응 REQ 필터/.test(rule) && /`--req-filter`/.test(rule),
          `${variant}: a re-entry must carry the unaddressed requirement filter`,
        ).toBe(true);
        expect(
          /sds-id 를 \*\*재사용\*\*하는지 여부를 `--sds-id`/.test(rule),
          `${variant}: a re-entry must state whether the existing sds-id is reused`,
        ).toBe(true);
        expect(/plan_run_id|--plan-run-id/.test(routing), `${variant}: the retired plan run identifier is still used`).toBe(false);
      });
    });
  }
});

describe("FR-FLOW-047..055 — the wave critical_gates table keeps every declared halt", () => {
  for (const variant of VARIANTS) {
    it(`${variant}: declares the pre-existing and the new gates as rows`, () => {
      const gates = gateSection(skillBody(readWave(variant)));
      expect(gates, `${variant}: a critical_gates declaration section must exist`).not.toBe("");
      const rows = gates.split("\n").filter((line) => /^\s*\|/.test(line) && line.split("|").length >= 5);
      for (const id of [...EXISTING_WAVE_GATE_IDS, ...NEW_WAVE_GATE_IDS]) {
        expect(
          rows.some((row) => row.includes(id)),
          `${variant}: critical_gates must declare ${id} as a table row`,
        ).toBe(true);
      }
      expect(
        rows.length >= EXISTING_WAVE_GATE_IDS.length + NEW_WAVE_GATE_IDS.length,
        `${variant}: critical_gates must carry one row per declared gate`,
      ).toBe(true);
      for (const id of RETIRED_WAVE_GATE_IDS) {
        expect(rows.some((row) => row.includes(id)), `${variant}: the retired gate ${id} is still declared`).toBe(false);
      }
    });
  }
});
