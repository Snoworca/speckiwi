import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// @req FR-FLOW-044
// @req FR-FLOW-045
// @req FR-FLOW-046
//
// End-of-wave cross-verification. A SKILL.md is natural-language agent instruction, not executable
// code, so the behavior cannot be exercised in a unit test; these are raw-text contract assertions
// over every shipped variant, the same technique FR-FLOW-029/042/043 are verified by.
//
// kiwi-wave-master is deliberately excluded from the `.agents/skills` mirror
// (.agents/skills/.speckiwi-mirror-exclusions.json), so the SKILL.md lives in exactly three copies.
// The waves-event contract IS mirrored and is asserted in kiwi-event-contract-content.test.ts.
//
// Assertions are section-scoped rather than body-wide: the neighbouring §2.1 preflight gate and §7
// propagation sections restate several of the same tokens (--auto, --max, halt, recovery), and a
// body-wide check would stay green when the sentence under test is deleted from §5.5 itself.

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const VARIANTS = ["claude", "codex", "etc"] as const;

function readWaveSkill(variant: string): string {
  try {
    return readFileSync(path.join(REPO_ROOT, "skills", variant, "kiwi-wave-master", "SKILL.md"), "utf8");
  } catch {
    return "";
  }
}

/** Body with the YAML frontmatter stripped, so the `description` field cannot false-green a check. */
function skillBody(text: string): string {
  return text.replace(/^---[\s\S]*?\n---\s*\n?/, "");
}

/** Text windows of +/- `radius` chars around every match of `re`. */
function windowsAround(text: string, re: RegExp, radius: number): string[] {
  const g = new RegExp(re.source, re.flags.replace("g", "") + "g");
  const out: string[] = [];
  for (let m = g.exec(text); m; m = g.exec(text)) {
    out.push(text.slice(Math.max(0, m.index - radius), m.index + m[0].length + radius));
    if (g.lastIndex === m.index) g.lastIndex++;
  }
  return out;
}

/** A heading and everything under it, down to the next same-or-higher-level heading. "" when absent. */
function sectionUnder(body: string, headingRe: RegExp): string {
  const lines = body.split("\n");
  const start = lines.findIndex((line) => headingRe.test(line));
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

/** The end-of-wave cross-verification section. */
function verifySection(body: string): string {
  return sectionUnder(body, /^#{2,3}\s.*(?:상호검증|cross-verif)/i);
}

/** The critical_gates declaration section. */
function gateSection(body: string): string {
  return sectionUnder(body, /^#{2,3}\s.*critical_gates/i);
}

/** The `## 2` phase-flow fenced block (the one listing the wave-decomposition phase). */
function phaseFlowBlock(body: string): string {
  const fences = body.split("```");
  for (let i = 1; i < fences.length; i += 2) {
    if (/Wave 분해|wave decompos/i.test(fences[i])) return fences[i];
  }
  return "";
}

/** Line index of the first heading matching `re`, or -1. */
function headingLine(body: string, re: RegExp): number {
  return body.split("\n").findIndex((line) => /^#{2,4}\s/.test(line) && re.test(line));
}

// --------------------------------------------------------------------------------------------------
// Shared tokens. Every variant is host-language-adapted (claude/codex Korean, etc English/Korean
// mixed), so prose concepts key on bilingual regexes while technical identifiers key on literals.
// --------------------------------------------------------------------------------------------------
const TASK_DONE = /TASK_DONE/;
const COMPLETE_APPEND = /complete/i;
const WAVES_JSONL = /waves\.jsonl/i;
/** Every variant states the verifier count with the literal "정확히 2" so the etc single-worker
 * profile can render it as "2 verification axes" without weakening the count itself. The negative
 * lookahead matters: "정확히 2기 이상" reads as at-least-two, which breaks the two-party premise the
 * add-only merge rests on — and on the etc host it would license the fanout its profile forbids. */
const EXACTLY_TWO = /정확히\s*2\s*(?:기|개)(?!\s*이상)|exactly\s+two(?!\s+or\s+more)/i;
const AT_LEAST_TWO = /정확히\s*2\s*(?:기|개)?\s*이상|two\s+or\s+more/i;
const SAME_BUNDLE = /동일한?\s*(?:증거\s*)?번들|same\s+(?:evidence\s+)?bundle/i;
const DISJOINT_FORBIDDEN = /(?:나눠|분리해|쪼개)[^\n]*(?:금지|안 된다|불가)|disjoint[^\n]*(?:prohibit|forbidden)/i;
const ALL_MATCH = /ALL_MATCH/;
const GAPS_ROLLUP = /\bGAPS\b/;
const SUBSTANTIVE_CLEAN = /substantive_clean/;
const LIST_REQUIREMENTS = /list_requirements/;
const CHECKED_EQ_EXPECTED = /checked\s*(?:==|===|=|는)?\s*(?:must\s+equal\s+)?expected|checked\s*(?:와|과)\s*expected/i;
const RESOLVABLE_POINTER = /해소\s*가능한|resolvable/i;
const ADD_ONLY = /add-only|추가(?:만|-only)/i;
const NO_DISMISS = /기각(?:할 수 없|하지 못|불가|은 금지)|(?:never|not)\s+dismiss|dismiss[^\n]*(?:금지|forbidden|prohibit)/i;
const MECHANICAL_UNION = /기계적\s*합집합|mechanical\s+union/i;
const FRESH_SPAWN = /새로\s*spawn|새로운?\s*검증자|fresh(?:ly)?\s*spawn/i;
const STRIPPED = /주장(?:과|\s*및)?\s*증거\s*포인터만|stripped|rationale[^\n]*(?:제외|없이|without)/i;
/** The out-of-scope declaration must name the granularity it excludes. A bare "재수행하지 않는다"
 * alternation survived deleting the hunk clause, so the granularity token is required. */
const OUT_OF_SCOPE_REVIEW = /(?:hunk|헝크)[^\n]*(?:범위 밖|out of scope)/i;
const REVIEW_FIX_LOOP = /kiwi-review-fix-loop/;

const NO_FIX_ROUND = /수정(?:이)?\s*(?:적용되지|없)[^\n]*(?:라운드|round)|round[^\n]*no\s+fixes/i;
const MINI_FLAG = /--mini\b/;
const LOOPS_FLAG = /--loops\b/;
const MAX_FLAG = /--max\b/;
const FAIL_CAP = /fail-cap/;
const NO_TRUNCATION = /(?:truncat|잘라내|절단)[^\n]*(?:금지|없이|never|not)|전량/i;
const OWN_FIXER_FORBIDDEN = /(?:전용|자체|고유)\s*fixer[^\n]*(?:금지|신설하지|없)|own\s+fixer[^\n]*(?:not|never|forbidden)/i;

/** "--auto 로도 / even under --auto" plus a halt verb, in one window. */
const AUTO_HALT =
  /--auto[^\n]{0,40}(?:라도|로도|여도|무관|even|regardless)[^\n]{0,80}(?:중단|halt|HALT)|(?:중단|halt)[^\n]{0,80}--auto[^\n]{0,40}(?:라도|로도|무관|even|regardless)/i;

/**
 * Hedges that turn a MUST into a SHOULD. Every co-occurrence regex in this file is satisfied by a
 * hedged sentence — "신설하지 않는 것을 원칙으로 하되, 필요하면 신설할 수 있다" keeps both anchor
 * tokens — so each prohibition additionally asserts that its own sentence carries none of these.
 * Verified by mutation: five such rewrites survived every token-based check.
 */
const HEDGE = /수 있다|해도 된다|권장|바람직|원칙적으로|원칙으로 하되|가능하면|되도록|경우에 따라/;

/** The sentence (blank-line-delimited or table row) containing the first match of `re`. */
function sentenceWith(text: string, re: RegExp): string {
  const lines = text.split("\n");
  const i = lines.findIndex((l) => re.test(l));
  return i === -1 ? "" : lines[i];
}

const GATE_IDS = [
  "run-root-preflight-mismatch",
  "wt-delegation-refused",
  "child-pipeline-needs-user-or-failed",
  "wave-verify-residual-critical",
  "wave-verify-cross-wave-fix-required",
] as const;

describe("FR-FLOW-044 — end-of-wave two-verifier cross-verification", () => {
  for (const variant of VARIANTS) {
    describe(`${variant} variant`, () => {
      it("AC-1: places the step after TASK_DONE and before the waves.jsonl complete append", () => {
        const body = skillBody(readWaveSkill(variant));
        const section = verifySection(body);
        expect(section, `${variant}: a cross-verification section must exist`).not.toBe("");

        // The step must sit between the per-wave pipeline section and the waves.jsonl section.
        const verifyAt = headingLine(body, /(?:상호검증|cross-verif)/i);
        const pipelineAt = headingLine(body, /kiwi-pipeline\s*(?:실행|execution)|Phase 3\b/i);
        const wavesAt = headingLine(body, /waves\.jsonl/i);
        expect(pipelineAt, `${variant}: the per-wave pipeline section must exist`).toBeGreaterThan(-1);
        expect(wavesAt, `${variant}: the waves.jsonl progress section must exist`).toBeGreaterThan(-1);
        expect(
          pipelineAt < verifyAt && verifyAt < wavesAt,
          `${variant}: cross-verification must be authored between the pipeline section and the waves.jsonl section`,
        ).toBe(true);

        // And the section itself must state the ordering rather than merely being positioned there.
        expect(TASK_DONE.test(section), `${variant}: the section must key on the pipeline TASK_DONE return`).toBe(true);
        expect(
          windowsAround(section, WAVES_JSONL, 300).some((w) => COMPLETE_APPEND.test(w)),
          `${variant}: the section must state that it runs before the waves.jsonl complete record`,
        ).toBe(true);

        const flow = phaseFlowBlock(body);
        expect(flow, `${variant}: the phase-flow block must exist`).not.toBe("");
        expect(
          flow.indexOf("Phase 3.5") > flow.indexOf("Phase 3 ") && flow.indexOf("Phase 3.5") < flow.indexOf("Phase 4"),
          `${variant}: the phase-flow block must list Phase 3.5 between Phase 3 and Phase 4`,
        ).toBe(true);

        // The sentence that actually governs when the NEXT wave launches must gate on verification
        // too. Left keyed on TASK_DONE alone, an agent reading the pipeline section in isolation
        // starts wave n+1 while wave n is still being verified, which defeats the halt gate.
        const pipelineSection = sectionUnder(body, /^#{2,4}\s.*kiwi-pipeline\s*(?:실행|execution)/i);
        expect(pipelineSection, `${variant}: the per-wave pipeline section must exist`).not.toBe("");
        expect(
          windowsAround(pipelineSection, /다음 wave|next wave/i, 260).some((w) =>
            /상호검증|§5\.5|cross-verif/i.test(w),
          ),
          `${variant}: starting the next wave must be gated on the previous wave's cross-verification, not on TASK_DONE alone`,
        ).toBe(true);
      });

      it("AC-2: spawns exactly two verifiers over one shared evidence bundle", () => {
        const section = verifySection(skillBody(readWaveSkill(variant)));
        expect(EXACTLY_TWO.test(section), `${variant}: the verifier count must be stated exactly`).toBe(true);
        expect(AT_LEAST_TWO.test(section), `${variant}: the count must be exactly two, never at-least-two`).toBe(false);
        expect(SAME_BUNDLE.test(section), `${variant}: both verifiers must read the same evidence bundle`).toBe(true);
        expect(
          DISJOINT_FORBIDDEN.test(section),
          `${variant}: splitting the evidence between the two verifiers must be explicitly prohibited`,
        ).toBe(true);
        expect(
          HEDGE.test(sentenceWith(section, DISJOINT_FORBIDDEN)),
          `${variant}: the disjoint-evidence prohibition must be absolute, not hedged with an exception`,
        ).toBe(false);
        // A same-line hedge is caught above, but an escape clause added as a NEIGHBOURING paragraph
        // ("비용이 큰 wave 에서는 두 번째 검증자를 생략한다") was not. Nothing in the section may
        // license dropping a verifier or an axis.
        expect(
          /(?:검증자|검증 축)[^\n]{0,40}생략|생략[^\n]{0,20}(?:검증자|검증 축)|단독 수행/.test(section),
          `${variant}: nothing in the section may license running only one verifier`,
        ).toBe(false);
      });

      it("AC-3: differentiates the two verifiers by stance with distinct roll-ups", () => {
        const section = verifySection(skillBody(readWaveSkill(variant)));
        expect(ALL_MATCH.test(section), `${variant}: the intent verifier must roll up as ALL_MATCH`).toBe(true);
        expect(GAPS_ROLLUP.test(section), `${variant}: the intent verifier must roll up as GAPS on failure`).toBe(true);
        expect(
          SUBSTANTIVE_CLEAN.test(section),
          `${variant}: the quality verifier must roll up as substantive_clean`,
        ).toBe(true);
        expect(
          /과정\s*적합|process\s+conformance/i.test(section),
          `${variant}: verifier 1 must cover process conformance, not intent alone`,
        ).toBe(true);
        expect(
          /교차\s*wave\s*회귀|cross-wave\s+regression|이전\s*wave[^\n]*회귀/i.test(section),
          `${variant}: verifier 2 must cover cross-wave regression risk`,
        ).toBe(true);

        // Column-bound, not section-wide. Presence checks alone let the two stance columns be
        // swapped, which silently makes verifier 1 the quality axis while §5.5.2's denominator
        // paragraph, §5.5.4's PASS row and §0.G's gate reason all still say "검증자 1 ALL_MATCH".
        const cells = (row: RegExp): string[] => {
          const line = section.split("\n").find((l) => /^\|/.test(l) && row.test(l)) ?? "";
          return line.split("|").map((c) => c.trim());
        };
        const stance = cells(/의도\s*실현|process\s+conformance|과정\s*적합/);
        const rollup = cells(/ALL_MATCH/);
        expect(stance.length >= 4 && rollup.length >= 4, `${variant}: §5.5.2 must be a two-column stance table`).toBe(
          true,
        );
        expect(
          /의도\s*실현/.test(stance[2]) && /과정\s*적합|process\s+conformance/i.test(stance[2]),
          `${variant}: the FIRST stance column must be intent realization plus process conformance`,
        ).toBe(true);
        expect(
          /품질/.test(stance[3]) && /회귀/.test(stance[3]),
          `${variant}: the SECOND stance column must be artifact quality plus regression risk`,
        ).toBe(true);
        expect(
          ALL_MATCH.test(rollup[2]) && GAPS_ROLLUP.test(rollup[2]),
          `${variant}: the FIRST roll-up column must be ALL_MATCH / GAPS`,
        ).toBe(true);
        expect(
          SUBSTANTIVE_CLEAN.test(rollup[3]),
          `${variant}: the SECOND roll-up column must be substantive_clean`,
        ).toBe(true);
      });

      it("AC-4: enumerates a wave-evidence bundle that reaches the execution record", () => {
        // Scoped to the bundle sub-section: a section-wide `includes` stayed green after the
        // review-fix-loop report row was deleted, because §5.5.5 names the skill three more times.
        const bundle = sectionUnder(verifySection(skillBody(readWaveSkill(variant))), /^#{3,4}\s.*증거 번들/);
        expect(bundle, `${variant}: an evidence-bundle sub-section must exist`).not.toBe("");
        for (const token of ["pipeline.jsonl", "worklog.jsonl", "sidecar", "kiwi-review-fix-loop"]) {
          expect(bundle.includes(token), `${variant}: the evidence bundle must include ${token}`).toBe(true);
        }
        expect(LIST_REQUIREMENTS.test(bundle), `${variant}: the bundle must include the wave target requirement list`).toBe(
          true,
        );
        expect(/diff/i.test(bundle), `${variant}: the bundle must include the wave-window diff`).toBe(true);
        expect(
          bundle.includes("pipeline_run_id"),
          `${variant}: the bundle window must be bounded by pipeline_run_id`,
        ).toBe(true);
        // The session/plan/analysis artifacts are keyed by the PLAN run-id (kiwi-planner SSOT,
        // reused by kiwi-pm), not by the pipeline run-id, so the bundle must say how to resolve it
        // or the process half of the verification points at a path that does not exist.
        expect(
          /plan run-id|plan_run_id/i.test(bundle) && /artifacts\.plan_file|artifacts\.analysis_dir/.test(bundle),
          `${variant}: the bundle must resolve the plan run-id from the pipeline.jsonl artifacts fields`,
        ).toBe(true);
        // docs/analysis is NOT keyed by the plan run-id: each skill writes its own run-id directory,
        // so the review-fix-loop report resolves from that skill's own event, not the planner's.
        expect(
          windowsAround(bundle, /docs\/analysis/, 420).some(
            (w) => /kiwi-review-fix-loop[^\n]*(?:자체|자신의|own)/i.test(w) || /(?:자체|자신의|own)[^\n]*analysis_dir/i.test(w),
          ),
          `${variant}: the review-fix-loop report must resolve from that skill's own analysis dir, not the plan run-id`,
        ).toBe(true);
      });

      it("AC-5: sources the intent denominator externally and requires resolvable evidence", () => {
        const section = verifySection(skillBody(readWaveSkill(variant)));
        expect(
          windowsAround(section, LIST_REQUIREMENTS, 400).some((w) => /분모|denominator/i.test(w)),
          `${variant}: the denominator must be sourced from list_requirements rather than chosen by the verifier`,
        ).toBe(true);
        // Token co-occurrence alone let the rule be inverted to "검증자가 스스로 정한다". The external
        // denominator is what makes a skim-and-PASS mechanically detectable, so require the negation.
        expect(
          /검증자가 스스로 정하지 않는다|not chosen by the verifier/i.test(section),
          `${variant}: the section must state that the verifier does NOT choose its own denominator`,
        ).toBe(true);
        // The window check was satisfied by the bundle table alone, so swapping the SOURCE to "메인
        // 세션이 판단한 부분집합" — the skim-and-PASS bypass AC-5 exists to block — survived. Pin the
        // rule sentence to name list_requirements as the source.
        const denomRule = sentenceWith(section, /검증자가 스스로 정하지 않는다/);
        expect(
          /`list_requirements`/.test(denomRule),
          `${variant}: the denominator rule itself must name list_requirements as the source`,
        ).toBe(true);
        expect(
          /메인 세션|부분집합|subset/.test(denomRule),
          `${variant}: the denominator must be the full target requirement set, not a curated subset`,
        ).toBe(false);
        expect(CHECKED_EQ_EXPECTED.test(section), `${variant}: checked must be reconciled against expected`).toBe(true);
        // Quantifier weakening ("주요 REQ/AC 를 표본으로") turns the fixed denominator into a sample,
        // which is the skim-and-PASS bypass this AC exists to block.
        expect(
          /\*\*모든\*\* REQ\/AC 를 행으로 열거/.test(section),
          `${variant}: the denominator must be every requirement and criterion, not a sample`,
        ).toBe(true);
        // Reject the sampling CONSTRUCTION, not the word: the text legitimately names 표본/발췌 in
        // order to forbid them ("표본·발췌·상위 N 은 분모가 아니다").
        expect(
          /(?:표본|샘플|발췌)(?:으?로|을)\s*(?:행에\s*)?열거/.test(section),
          `${variant}: no sampling qualifier may weaken the enumeration`,
        ).toBe(false);
        // AC-level detail is opt-in on list_requirements, so the instruction must say how to get it
        // or an agent counts requirements and never reads a criterion.
        expect(
          /compact projection|get_requirement/.test(section),
          `${variant}: the text must say how to obtain acceptance-criterion detail, not just the requirement list`,
        ).toBe(true);
        expect(RESOLVABLE_POINTER.test(section), `${variant}: each realized row needs a resolvable evidence pointer`).toBe(
          true,
        );
        expect(
          /무효|invalid/i.test(section),
          `${variant}: a count mismatch or unresolvable pointer must invalidate the round`,
        ).toBe(true);
      });

      it("AC-6: isolates round 1 and re-spawns fresh verifiers for later rounds", () => {
        const section = verifySection(skillBody(readWaveSkill(variant)));
        // A bare /격리/ presence check was satisfied by the surviving "r1 — 독립·격리" heading while
        // the rule underneath was inverted to hand round 1 the orchestrator's own conclusions.
        // Assert the prohibition itself, and that it is not hedged.
        const isolationRule = sentenceWith(section, /메인 세션의 결론/);
        expect(isolationRule, `${variant}: round 1 must state what it is isolated from`).not.toBe("");
        expect(
          /전달하지 않는다/.test(isolationRule),
          `${variant}: round 1 must be denied the main session's conclusions and the other verifier's output`,
        ).toBe(true);
        expect(
          HEDGE.test(isolationRule),
          `${variant}: the round-1 isolation rule must be absolute, not hedged`,
        ).toBe(false);
        expect(
          /격리|isolat/i.test(section),
          `${variant}: round 1 must be isolated from the main session's conclusions`,
        ).toBe(true);
        expect(FRESH_SPAWN.test(section), `${variant}: rounds 2+ must spawn fresh verifiers`).toBe(true);
        expect(STRIPPED.test(section), `${variant}: later rounds receive stripped claims, not rationale or verdicts`).toBe(
          true,
        );
      });

      it("AC-7: makes the cross-refutation round add-only with a mechanical union merge", () => {
        const section = verifySection(skillBody(readWaveSkill(variant)));
        // A round is all three steps. Labelling them r1/r2 read as two ROUNDS, which made the
        // cross-refutation step look like something a clean first round could skip — and the Normal
        // PASS row is satisfiable from a step-1 merge alone.
        expect(
          /\*\*한 라운드는 아래 세 단계 전부\*\*/.test(section),
          `${variant}: the section must state that one round comprises all three steps`,
        ).toBe(true);
        expect(
          /이 단계를 건너뛴 라운드는 \*\*무효\*\*/.test(section),
          `${variant}: a round that skips the cross-refutation step must be invalid`,
        ).toBe(true);
        // Order matters and was unasserted: swapping steps 2 and 3 runs the merge before the
        // cross-refutation, so findings added there never reach it and add-only becomes void.
        const stepOrder = ["단계 1 — 독립", "단계 2 — 교차반박", "단계 3 — 병합"].map((s) => section.indexOf(s));
        expect(
          stepOrder.every((i) => i > -1) && stepOrder[0] < stepOrder[1] && stepOrder[1] < stepOrder[2],
          `${variant}: the three steps must appear in order — isolate, cross-refute, then merge`,
        ).toBe(true);
        expect(ADD_ONLY.test(section), `${variant}: the cross-refutation round must be add-only`).toBe(true);
        expect(NO_DISMISS.test(section), `${variant}: a verifier must never dismiss the other's finding`).toBe(true);
        expect(MECHANICAL_UNION.test(section), `${variant}: the merge must be a mechanical union`).toBe(true);
        // The unanimous-reclassification close path is the only remaining dismissal channel. Pricing
        // it purely by streak exclusion is a no-op in the default mode, which has no streak — so the
        // shipped default is the configuration where mutual dismissal costs nothing.
        expect(
          windowsAround(section, /재분류/, 400).some(
            (w) => /모드와 무관|모드 무관|regardless of mode/i.test(w) && /(?:라운드를 더|추가 (?:검증 )?라운드|한 라운드 더)/.test(w),
          ),
          `${variant}: a reclassification must force a further verification round regardless of mode`,
        ).toBe(true);
      });

      it("AC-8: declares per-hunk code review out of scope", () => {
        const section = verifySection(skillBody(readWaveSkill(variant)));
        expect(OUT_OF_SCOPE_REVIEW.test(section), `${variant}: per-hunk code review must be declared out of scope`).toBe(
          true,
        );
        expect(
          windowsAround(section, OUT_OF_SCOPE_REVIEW, 300).some((w) => REVIEW_FIX_LOOP.test(w)),
          `${variant}: the out-of-scope note must name kiwi-review-fix-loop as the owner`,
        ).toBe(true);
      });
    });
  }
});

describe("FR-FLOW-045 — wave verification convergence and delegated remediation", () => {
  for (const variant of VARIANTS) {
    describe(`${variant} variant`, () => {
      it("AC-1: passes only on a round in which no fixes were applied", () => {
        const section = verifySection(skillBody(readWaveSkill(variant)));
        // Anchored to the PASS table row, not the section: the rationale paragraph below repeats the
        // same words in the order NO_FIX_ROUND matches, so deleting the clause from the normative row
        // left the check green.
        expect(
          /^\|\s*Normal\s*\|[^\n]*수정이 적용되지 않았을 것/m.test(section),
          `${variant}: the Normal PASS row itself must carry the fix-free-round condition`,
        ).toBe(true);
        expect(NO_FIX_ROUND.test(section), `${variant}: the pass condition must require a fix-free round`).toBe(true);
      });

      it("AC-2: states the Normal and --max passing conditions", () => {
        const section = verifySection(skillBody(readWaveSkill(variant)));
        expect(/CRITICAL/.test(section) && /HIGH/.test(section), `${variant}: Normal gate is CRITICAL=0 + HIGH=0`).toBe(
          true,
        );
        expect(ALL_MATCH.test(section), `${variant}: Normal gate also requires the full intent roll-up`).toBe(true);
        // The etc host runs under a single-worker profile whose evaluation loop mandates THREE
        // consecutive clean evaluations and which turns --max on by default, so copying claude's
        // "2 consecutive" into etc leaves that variant with two contradictory stop conditions.
        const streak =
          variant === "etc"
            ? /3\s*(?:라운드\s*)?연속|3연속|three consecutive/i
            : /2\s*(?:라운드\s*)?연속|2연속|two consecutive/i;
        // Anchored to the --max PASS row. A +/-400 window centred on the explanatory prose overlapped
        // the table, so flipping the row's own streak value from 3 to 2 stayed green.
        const maxRow = section.split("\n").find((line) => /^\|\s*`--max`\s*\|/.test(line)) ?? "";
        expect(maxRow, `${variant}: the PASS table must have a --max row`).not.toBe("");
        expect(
          /MEDIUM/.test(maxRow) && streak.test(maxRow),
          `${variant}: the --max PASS row itself must carry MEDIUM=0 and the streak its host profile mandates`,
        ).toBe(true);
        // Exemption widening: turning "Normal 모드에서만 … 조기 종료" into "모든 모드에서" waives the
        // --max streak from a sentence the PASS-row anchor never reads.
        expect(
          /\*\*Normal 모드에서만\*\*/.test(section),
          `${variant}: the early exit must be confined to the default mode`,
        ).toBe(true);
        expect(
          /`--max` 에서는 이 조기 종료가 없다/.test(section),
          `${variant}: --max must explicitly have no early exit, so its streak cannot be waived`,
        ).toBe(true);
        const maxWindows = windowsAround(section, MAX_FLAG, 400);
        expect(
          maxWindows.some((w) => /MEDIUM/.test(w) && streak.test(w)),
          `${variant}: the --max gate must require MEDIUM=0 across the streak its host profile mandates`,
        ).toBe(true);
        if (variant === "etc") {
          expect(
            /local-llm-profile|단일 워커 프로파일/i.test(section),
            "etc: the raised streak must cite the single-worker profile that mandates it",
          ).toBe(true);
        }
      });

      it("AC-3: follows the shared loop-option cap contract", () => {
        const section = verifySection(skillBody(readWaveSkill(variant)));
        expect(MINI_FLAG.test(section), `${variant}: --mini must bind this loop`).toBe(true);
        expect(LOOPS_FLAG.test(section), `${variant}: --loops N must bind this loop`).toBe(true);
        expect(
          windowsAround(section, LOOPS_FLAG, 260).some((w) => /우선|wins|precedence/i.test(w) && /WARN|경고/i.test(w)),
          `${variant}: --loops must win over --mini with a non-fatal warning`,
        ).toBe(true);
        // Anchored to the cap sentence itself: a bare /\b5\b/ was satisfied by the section's own
        // `### 5.5.n` heading numbers, so the default cap could be changed to any value undetected.
        expect(/기본\s*\*\*5\*\*|default\s*\*\*5\*\*/.test(section), `${variant}: the default cap must be 5`).toBe(true);
        expect(/`--max`\s*\*\*8\*\*/.test(section), `${variant}: the --max cap must be 8`).toBe(true);
        expect(/`--mini`\s*3\b/.test(section), `${variant}: --mini must cap the loop at 3`).toBe(true);

        // The propagation table must actually bind this loop, otherwise --mini shortens the per-wave
        // children but silently leaves the new loop at its default cap.
        const body = skillBody(readWaveSkill(variant));
        const propagation = sectionUnder(body, /^#{2,4}\s.*(?:--mini|loops)/i);
        expect(propagation, `${variant}: the mini/loops propagation section must exist`).not.toBe("");
        expect(
          /상호검증|cross-verif|Phase 3\.5/i.test(propagation),
          `${variant}: the propagation section must bind the end-of-wave verification loop`,
        ).toBe(true);
      });

      it("AC-4: never records cap exhaustion as a pass", () => {
        const section = verifySection(skillBody(readWaveSkill(variant)));
        expect(FAIL_CAP.test(section), `${variant}: cap exhaustion must produce a fail-cap verdict`).toBe(true);
        // Token co-occurrence is not enough: inverting the rule to "그대로 진행한다" stayed green
        // because the NEXT sentence supplied `complete` inside the window. Require the negation.
        expect(
          /`complete`\s*를?\s*append\s*하지\s*않|does not append[^\n]*complete|`complete`[^\n]{0,20}기록하지 않/.test(
            section,
          ),
          `${variant}: a cap-exhausted wave must explicitly NOT be appended as complete`,
        ).toBe(true);
        expect(NO_TRUNCATION.test(section), `${variant}: residual findings must be reported in full`).toBe(true);
        // Scope narrowing survived every token check: "fail-cap 은 잔여 CRITICAL/HIGH 가 있는 경우에
        // 한해 … 그 외의 상한 도달은 pass 로 기록한다" turns the rule into its opposite. The headline
        // must stay unconditional.
        expect(
          /\*\*cap 소진은 PASS 가 아니다\.\*\*/.test(section),
          `${variant}: cap exhaustion must be declared never-a-pass, unconditionally`,
        ).toBe(true);
        expect(
          /상한 도달[^\n]{0,40}`pass`|경우에 한해[^\n]{0,40}fail-cap|fail-cap[^\n]{0,40}경우에 한해/.test(section),
          `${variant}: no clause may narrow cap exhaustion so that some exhausted runs pass`,
        ).toBe(false);
      });

      it("AC-5: routes remediation by finding class with an explicit review scope", () => {
        const section = verifySection(skillBody(readWaveSkill(variant)));
        expect(REVIEW_FIX_LOOP.test(section), `${variant}: quality findings delegate to kiwi-review-fix-loop`).toBe(true);
        // Anchored to the routing row. A +/-320 window matched the out-of-scope paragraph's own
        // "범위 밖", so the explicit-scope requirement could be deleted from the row undetected.
        const routingRow =
          section.split("\n").find((l) => /^\|/.test(l) && REVIEW_FIX_LOOP.test(l) && /위임|delegat/i.test(l)) ?? "";
        expect(routingRow, `${variant}: the remediation routing table must have a review-fix-loop row`).not.toBe("");
        expect(
          /--base|--commits/.test(routingRow),
          `${variant}: the delegation row itself must name an explicit review scope so committed work is not reported clean`,
        ).toBe(true);
        expect(
          /재진입|re-enter|re-entry/i.test(section),
          `${variant}: an intent gap with no plan task must escalate to pipeline re-entry`,
        ).toBe(true);
        expect(
          /이전\s*wave|previous wave/i.test(section),
          `${variant}: a fix touching a previous wave must be called out`,
        ).toBe(true);
      });

      it("AC-6: introduces no fixer of its own", () => {
        const section = verifySection(skillBody(readWaveSkill(variant)));
        expect(OWN_FIXER_FORBIDDEN.test(section), `${variant}: wave-master must not add its own fixer subagent`).toBe(
          true,
        );
        expect(
          HEDGE.test(sentenceWith(section, OWN_FIXER_FORBIDDEN)),
          `${variant}: the own-fixer prohibition must be absolute, not a default with an escape hatch`,
        ).toBe(false);
      });

      it("AC-7: forbids weakening the criterion instead of fixing the defect", () => {
        const section = verifySection(skillBody(readWaveSkill(variant)));
        expect(
          /AC\s*본문|acceptance[- ]criteria text|AC 텍스트/i.test(section),
          `${variant}: a fixer must not edit acceptance-criteria text`,
        ).toBe(true);
        expect(
          /테스트[^\n]*(?:약화|삭제)|weaken[^\n]*test|test[^\n]*weaken/i.test(section),
          `${variant}: a fixer must not weaken or delete an existing test`,
        ).toBe(true);
        // A bare `includes("severity_class")` survived deleting the prohibition, because the
        // verifier-output table also names the field. Require the ownership rule itself.
        expect(
          windowsAround(section, /severity_class/, 220).some(
            (w) => /제기한[^\n]*검증자|raised[^\n]*(?:it|finding)/i.test(w) && /(?:만|only)/.test(w),
          ),
          `${variant}: severity_class must be writable only by the verifier that raised the finding`,
        ).toBe(true);
      });

      it("AC-8: does not let the delegated fix loop's own pass close a wave-level finding", () => {
        const section = verifySection(skillBody(readWaveSkill(variant)));
        expect(
          windowsAround(section, REVIEW_FIX_LOOP, 420).some(
            (w) => /(?:자신의|자체)\s*(?:PASS|통과)|its own pass/i.test(w) && /(?:충족하지|않는다|does not|never)/i.test(w),
          ),
          `${variant}: the delegated loop's own pass must not by itself close a wave-level finding`,
        ).toBe(true);
        // The window tolerated replacing the MUST-subject ("두 검증자의 재검증" -> "메인 세션의
        // 재확인"), which hands closure to the party the loop exists to check.
        expect(
          /두 검증자의 재검증으로만 닫힌다/.test(section),
          `${variant}: only re-verification by the two verifiers may close a wave-level finding`,
        ).toBe(true);
      });
    });
  }
});

describe("FR-FLOW-046 — critical gate declaration and wave verification record (skill side)", () => {
  for (const variant of VARIANTS) {
    describe(`${variant} variant`, () => {
      it("AC-6: records pipeline_run_id on the events that can carry it", () => {
        const body = skillBody(readWaveSkill(variant));
        const waves = sectionUnder(body, /^#{2,4}\s.*waves\.jsonl/i);
        expect(waves, `${variant}: the waves.jsonl progress section must exist`).not.toBe("");
        // MUST, not MAY: relaxing "반드시 기록한다" to "가능하면 기록한다 — 없으면 `*` 글롭으로
        // 대체해도 된다" left a token-presence check green while substituting the very glob §5.5.1
        // forbids, which makes the whole evidence window unresolvable.
        expect(
          /`pipeline_run_id` 를 반드시 기록한다/.test(waves),
          `${variant}: recording pipeline_run_id must be mandatory, not best-effort`,
        ).toBe(true);
        expect(/글롭|glob/i.test(waves), `${variant}: a glob must never be offered as a substitute here`).toBe(false);
        // The obligation cannot bind the first in_progress line, which is appended at wave start
        // before the pipeline cycle — and therefore its run_id — exists. What is omitted is the
        // FIELD; the event itself is still written, carrying phase=pipeline.
        expect(
          /첫\s*`?in_progress`?\s*\*\*에서는 그 필드를\*\*\s*생략/.test(waves),
          `${variant}: the exemption must drop the field, not the wave-start event`,
        ).toBe(true);
        expect(
          /생략되는 것은 필드이지 이벤트가 아니다/.test(waves),
          `${variant}: the text must say explicitly that the wave-start event is still appended`,
        ).toBe(true);
      });

      it("AC-3: appends a wave-verify record before the complete event", () => {
        // waves-event §3 invalidates a complete with no preceding passing verification record, so a
        // producer instruction must exist that actually writes one; otherwise every compliant run
        // emits an unpreceded complete and resume loops on it forever.
        const section = verifySection(skillBody(readWaveSkill(variant)));
        expect(
          /phase[^\n]*wave-verify|`wave-verify`/.test(section),
          `${variant}: the step must append an event carrying phase=wave-verify`,
        ).toBe(true);
        expect(
          windowsAround(section, /wave-verify/, 400).some(
            (w) => /append/i.test(w) && /`complete`/.test(w) && /(?:이전|전에|before)/i.test(w),
          ),
          `${variant}: the wave-verify record must be appended before the complete event`,
        ).toBe(true);
        // fail-residual is declared in the contract enum, so the skill must say when it is written.
        expect(
          /fail-residual/.test(section),
          `${variant}: the skill must define when the fail-residual verdict is produced`,
        ).toBe(true);
        // The contract promises the round counter survives a crash. Writing it only once, after the
        // loop finishes, persists nothing when the loop itself dies — so an unstable wave resumes at
        // rounds=0 forever and never reaches the fail-cap halt.
        // The token alone survived an inversion that kept "라운드마다" inside a negated clause
        // ("루프가 끝난 뒤 한 번 — 라운드마다가 아니라 —"). Pin the affirmative phrasing and reject
        // the negation outright.
        expect(
          /\*\*라운드마다\*\*\s*—\s*루프가 끝난 뒤 한 번이 아니라/.test(section),
          `${variant}: the record must be written per round, stated affirmatively`,
        ).toBe(true);
        expect(
          /라운드마다가 아니라|not (?:once )?per round/i.test(section),
          `${variant}: the per-round rule must not be inverted to once-after-the-loop`,
        ).toBe(false);
        // The phase enum declares `pipeline` too; the wave-start event must actually carry it or the
        // member is orphaned and consumers must guess that absence means the pipeline phase.
        expect(
          /`?phase`?\s*=?\s*"?`?pipeline`?"?/.test(section) || /phase="pipeline"/.test(section),
          `${variant}: the wave-start event must carry phase=pipeline so the enum member is produced`,
        ).toBe(true);
      });

      it("AC-7: declares a critical_gates table covering the transcribed and new halts", () => {
        const body = skillBody(readWaveSkill(variant));
        const gates = gateSection(body);
        expect(gates, `${variant}: a critical_gates declaration section must exist`).not.toBe("");
        // The shared auto-option interface requires a 3-column gate_id / reason / location table.
        // Each gate must appear as a ROW, not merely somewhere in the surrounding prose: a plain
        // `gates.includes(id)` survived deleting the table row because the prose below names the
        // same gate again.
        const rows = gates.split("\n").filter((line) => /^\|/.test(line) && line.split("|").length >= 5);
        for (const id of GATE_IDS) {
          expect(
            rows.some((row) => row.includes(id)),
            `${variant}: critical_gates must declare ${id} as a table row`,
          ).toBe(true);
        }
        expect(
          rows.length >= GATE_IDS.length,
          `${variant}: critical_gates must be a three-column table with one row per gate`,
        ).toBe(true);
      });

      it("AC-8: halts the whole orchestration under --auto on a residual critical finding", () => {
        const body = skillBody(readWaveSkill(variant));
        const gates = gateSection(body);
        const section = verifySection(body);
        const scope = `${gates}\n${section}`;
        const gateWindows = windowsAround(scope, /wave-verify-residual-critical/, 500);
        // Anchored to the dedicated sentence: a +/-500 window reached the §0.G intro's own generic
        // "--auto 라도 ... 중단" line, so inverting this gate to "그 wave 하나만 중단" stayed green.
        expect(
          /`wave-verify-residual-critical`[^\n]*--auto[^\n]{0,40}(?:라도|로도|무관)[^\n]{0,80}전체를 중단/.test(scope),
          `${variant}: the gate must halt the WHOLE orchestration under --auto, not just the current wave`,
        ).toBe(true);
        expect(
          gateWindows.some((w) => AUTO_HALT.test(w)),
          `${variant}: a residual CRITICAL/HIGH finding must halt even under --auto`,
        ).toBe(true);
        // Scoped to the gate window on purpose: checked over the whole scope, GAPS and fail-cap were
        // satisfied by the §5.5.2 roll-up table and the §5.5.4 cap paragraph, so both triggers could
        // be deleted from the gate declaration itself while the check stayed green.
        expect(
          gateWindows.some((w) => /GAPS/.test(w)) && gateWindows.some((w) => FAIL_CAP.test(w)),
          `${variant}: the gate declaration itself must name the gapped roll-up and cap exhaustion as triggers`,
        ).toBe(true);
        expect(/HIGH/.test(gateWindows.join("\n")), `${variant}: the gate must trigger on HIGH, not only CRITICAL`).toBe(
          true,
        );
      });

      it("AC-8: records the --auto activation in the requirement's change notes", () => {
        // The skill body cannot carry change history (§0.3 forbids it), so the second half of AC-8
        // lives in the SRS Change Notes table and must be asserted there.
        const srs = readFileSync(path.join(REPO_ROOT, "docs", "spec", "60.workflow-release.srs.md"), "utf8");
        const block = srs.split("### FR-FLOW-046")[1] ?? "";
        const notes = block.split("#### Change Notes")[1] ?? "";
        expect(
          /--auto/.test(notes) && /(?:비활성|inactive)/.test(notes) && /(?:활성|active)/.test(notes),
          "FR-FLOW-046 change notes must record that declaring critical_gates changes --auto from inactive to active",
        ).toBe(true);
      });
    });
  }
});
