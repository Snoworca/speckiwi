import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { moduleRegion, readResolvedSkill } from "../support/resolved-skill.js";
import { at } from "../support/at.js";

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

/** @req FR-FLOW-110 — resolved through the shared reader (SKILL.md + the `_shared/kiwi/` modules its
 * §0 table references, appended in table order), so an extracted rule stays in scope. */
function readWaveSkill(variant: string): string {
  return readResolvedSkill(variant, "kiwi-wave-master");
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

/**
 * The end-of-wave cross-verification section: the skill's own §5.5 plus the `verify-loop.md` engine
 * region it references from §0 (FR-FLOW-106). Two bounded regions, not the whole body — the §2.1
 * preflight and §7 propagation sections that restate the same tokens stay out of scope, which is the
 * property this helper exists for.
 */
function verifySection(body: string): string {
  return `${sectionUnder(body, /^#{2,3}\s.*(?:상호검증|종료 검증|cross-verif)/i)}\n${moduleRegion(body, "verify-loop")}`;
}

/** The critical_gates declaration section. */
function gateSection(body: string): string {
  return sectionUnder(body, /^#{2,3}\s.*critical_gates/i);
}

/** The `## 2` phase-flow fenced block (the one listing the wave-decomposition phase). */
function phaseFlowBlock(body: string): string {
  const fences = body.split("```");
  for (let i = 1; i < fences.length; i += 2) {
    if (/Wave 분해|wave decompos/i.test(at(fences, i))) return at(fences, i);
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
const LIST_REQUIREMENTS = /list_requirements/;
/** The out-of-scope declaration must name the granularity it excludes. A bare "재수행하지 않는다"
 * alternation survived deleting the hunk clause, so the granularity token is required. */
const OUT_OF_SCOPE_REVIEW = /(?:hunk|헝크)[^\n]*(?:범위 밖|out of scope)/i;
const REVIEW_FIX_LOOP = /kiwi-review-fix-loop/;

const NO_FIX_ROUND = /수정(?:이)?\s*(?:적용되지|없)[^\n]*(?:라운드|round)|round[^\n]*no\s+fixes/i;
const MINI_FLAG = /--mini\b/;
const LOOPS_FLAG = /--loops\b/;
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
  return i === -1 ? "" : at(lines, i);
}

const GATE_IDS = [
  "run-root-preflight-mismatch",
  "child-pipeline-needs-user-or-failed",
  "wave-verify-kept-finding",
  "wave-verify-cross-wave-fix-required",
] as const;

describe("FR-FLOW-044 — end-of-wave two-verifier cross-verification", () => {
  for (const variant of VARIANTS) {
    describe(`${variant} variant`, () => {
      // Revised in 4.0.0: the step keys on the wave's merge under the shared parallel-waves contract
      // (FR-FLOW-188), no longer on a per-wave kiwi-pipeline TASK_DONE.
      it("FR-FLOW-044 AC-1: places the step after the parallel-waves merge and before the waves.jsonl complete append", () => {
        const body = skillBody(readWaveSkill(variant));
        const section = verifySection(body);
        expect(section, `${variant}: a cross-verification section must exist`).not.toBe("");

        // The step must sit between the stage-execution section and the waves.jsonl section.
        const verifyAt = headingLine(body, /(?:상호검증|종료 검증|cross-verif)/i);
        const stageAt = headingLine(body, /Phase 3\b[^\n]*stage\s*(?:실행|execution)/i);
        const wavesAt = headingLine(body, /waves\.jsonl/i);
        expect(stageAt, `${variant}: the Phase 3 stage-execution section must exist`).toBeGreaterThan(-1);
        expect(wavesAt, `${variant}: the waves.jsonl progress section must exist`).toBeGreaterThan(-1);
        expect(
          stageAt < verifyAt && verifyAt < wavesAt,
          `${variant}: cross-verification must be authored between the stage-execution section and the waves.jsonl section`,
        ).toBe(true);

        // And the section itself must state the ordering rather than merely being positioned there:
        // one sentence names the merge under parallel-waves.md and the waves.jsonl complete record it
        // precedes. A bare TASK_DONE token anchors nothing any more — verify-loop.md still says it in
        // an unrelated paragraph, so it stayed green after the per-wave pipeline was removed.
        const orderRule = sentenceWith(section, /`waves\.jsonl`\s*`complete`\s*기록 이전에|before the waves\.jsonl complete/i);
        expect(orderRule, `${variant}: the section must state that it runs before the waves.jsonl complete record`).not.toBe(
          "",
        );
        expect(
          /병합|merged/i.test(orderRule) && /`parallel-waves\.md`/.test(orderRule),
          `${variant}: the ordering sentence must key on the wave's merge under parallel-waves.md`,
        ).toBe(true);
        expect(
          /TASK_DONE|kiwi-pipeline/.test(orderRule),
          `${variant}: the ordering must not key on a per-wave pipeline`,
        ).toBe(false);

        const flow = phaseFlowBlock(body);
        expect(flow, `${variant}: the phase-flow block must exist`).not.toBe("");
        expect(
          flow.indexOf("Phase 3.5") > flow.indexOf("Phase 3 ") && flow.indexOf("Phase 3.5") < flow.indexOf("Phase 4"),
          `${variant}: the phase-flow block must list Phase 3.5 between Phase 3 and Phase 4`,
        ).toBe(true);

        // The sentence that actually governs when a DEPENDENT wave may start must gate on
        // verification too. Left keyed on the merge alone, an agent reading the stage section in
        // isolation starts a dependent wave while its base is still being verified, which defeats
        // the halt gate.
        const stageSection = sectionUnder(body, /^#{2,4}\s.*Phase 3\b[^\n]*stage\s*(?:실행|execution)/i);
        expect(stageSection, `${variant}: the Phase 3 stage-execution section must exist`).not.toBe("");
        const startRule = sentenceWith(stageSection, /의존한 wave|depends? on/i);
        expect(startRule, `${variant}: the stage section must say when a dependent wave may start`).not.toBe("");
        expect(
          /상호검증|§5\.5|cross-verif/i.test(startRule) && /`complete`/.test(startRule),
          `${variant}: a dependent wave must start only after its base passed cross-verification and was recorded complete`,
        ).toBe(true);
        expect(
          /병합만으로는 부족|merge alone is not enough/i.test(startRule),
          `${variant}: the start rule must say the merge alone is not enough`,
        ).toBe(true);
      });
      // FR-FLOW-044 AC-3 (two stances, ALL_MATCH / substantive_clean) expired 2026-11-05 → FR-FLOW-220 AC-2 · AC-3.
      // FR-FLOW-044 AC-4 as rewritten for 5.3.0 (FR-FLOW-220 AC-2): the verifier is given only the
      // facts, and the evidence bundle is what the host reads for its machine checks and `complete`.
      it("FR-FLOW-044 AC-4: the verifier gets only the facts, and the host's evidence bundle reaches the execution record", () => {
        // Scoped to the bundle sub-section: a section-wide `includes` stayed green after the
        // review-fix-loop report row was deleted, because §5.5.5 names the skill three more times.
        const bundle = sectionUnder(verifySection(skillBody(readWaveSkill(variant))), /^#{3,4}\s.*검증자 입력/);
        expect(bundle, `${variant}: an evidence-bundle sub-section must exist`).not.toBe("");
        const inputs = sentenceWith(bundle, /검증자에게 주는 것은/);
        for (const fact of ["`verify-loop.md §3` 의 목록뿐", "`prd_items`", "`acs`", "PRD 경로와 그 PRD 의 제외 항목", "diff 창", "통합 항목", "run 의 제약 파일(`constraints_path`)"]) {
          expect(inputs, `${variant}: the verifier input names ${fact}`).toContain(fact);
        }
        expect(bundle, `${variant}: the bundle is the host's, never the verifier's`).toContain("검증자에게 넘기지 않는다");
        // Each artifact is a ROW of the bundle table, not a token somewhere in the prose around it.
        const rows = bundle.split("\n").filter((l) => /^\|/.test(l) && !/^\|\s*-/.test(l));
        const row = (re: RegExp): string => rows.find((r) => re.test(r)) ?? "";
        expect(row(/worklog\.jsonl/), `${variant}: the bundle must carry the session worklog row`).not.toBe("");
        expect(
          /sds-id|sds_id/.test(row(/worklog\.jsonl/)),
          `${variant}: the session worklog must be keyed by the wave's sds-id`,
        ).toBe(true);
        const sdsRow = row(/`docs\/sds\/\{sds_id\}\.sds\.md`/);
        expect(sdsRow, `${variant}: the bundle must carry the wave SDS row keyed by sds_id`).not.toBe("");
        expect(
          /close-out[^\n|]*(?:지우기 전에|before)/i.test(sdsRow),
          `${variant}: the wave SDS must be read before the SDS close-out deletes it`,
        ).toBe(true);
        expect(
          /`sds_id`/.test(row(/`kiwi\/waves\.jsonl`/)),
          `${variant}: the waves journal row must carry the sds_id the SDS and worklog are keyed by`,
        ).toBe(true);
        expect(
          row(/review_fix_loop_analysis_dir\}\/report\.md/),
          `${variant}: the bundle must carry the worker's review-fix-loop report row`,
        ).not.toBe("");
        expect(
          /리뷰|review/i.test(row(/review_fix_loop_analysis_dir\}\/report\.md/)) &&
            /워커|worker/i.test(row(/review_fix_loop_analysis_dir\}\/report\.md/)),
          `${variant}: the report row must be the review the wave's worker ran over its own window`,
        ).toBe(true);
        expect(LIST_REQUIREMENTS.test(row(LIST_REQUIREMENTS)), `${variant}: the bundle must include the wave target requirement list`).toBe(
          true,
        );
        // The plan, the sidecar and the per-wave pipeline window are gone.
        expect(/sidecar|plan\.md|plan_file/i.test(bundle), `${variant}: the bundle must not read the retired plan or sidecar`).toBe(
          false,
        );
        expect(bundle.includes("pipeline_run_id"), `${variant}: no pipeline_run_id bounds the window any more`).toBe(false);
        expect(
          rows.some((r) => /pipeline\.jsonl/.test(r)),
          `${variant}: pipeline.jsonl must not be a bundle row — a worker writes no pipeline events`,
        ).toBe(false);
        // The window is bounded by the wave's sds_id and its in_progress timestamp.
        const windowRule = sentenceWith(bundle, /증거 창은|evidence window is/i);
        expect(
          /`sds_id`/.test(windowRule) && /`in_progress`/.test(windowRule),
          `${variant}: the evidence window must be bounded by the wave's sds_id and its in_progress timestamp`,
        ).toBe(true);
        // docs/analysis is NOT keyed by one shared id: each skill writes its own run-id directory,
        // so the review-fix-loop report resolves from that review's own analysis dir.
        expect(
          windowsAround(bundle, /docs\/analysis/, 420).some(
            (w) => /kiwi-review-fix-loop[^\n]*(?:자체|자신의|own)/i.test(w) || /(?:자체|자신의|own)[^\n]*analysis_dir/i.test(w),
          ),
          `${variant}: the review-fix-loop report must resolve from that skill's own analysis dir`,
        ).toBe(true);
        // ... and never by an unbounded glob.
        const globRule = sentenceWith(bundle, /글롭으로 대신하면|glob/i);
        expect(
          /창을 고정한 의미가 사라진다|defeats the pinned window/i.test(globRule),
          `${variant}: the text must refuse resolving the report by an unbounded glob`,
        ).toBe(true);
      });

      // FR-FLOW-044 AC-7 (add-only cross-refutation, mechanical union) expired 2026-11-05 → FR-FLOW-220 AC-3 (red tests kept, union under --max).
      it("FR-FLOW-044 AC-8: declares per-hunk code review out of scope", () => {
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
      it("FR-FLOW-045 AC-1: passes only on a round in which no fixes were applied", () => {
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
      // FR-FLOW-045 AC-2 (CRITICAL=0 + HIGH=0, --max MEDIUM streak) expired 2026-11-05 → FR-FLOW-220 AC-5 and FR-FLOW-221 AC-1, pinned in their own files.
      it("FR-FLOW-045 AC-3: follows the shared loop-option cap contract", () => {
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
          /상호검증|종료 검증|cross-verif|Phase 3\.5/i.test(propagation),
          `${variant}: the propagation section must bind the end-of-wave verification loop`,
        ).toBe(true);
      });

      it("FR-FLOW-045 AC-4: never records cap exhaustion as a pass", () => {
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

      // FR-FLOW-045 AC-5 as rewritten for 5.3.0 (FR-FLOW-220 AC-4): a kept code defect goes to the
      // review loop with an explicit scope, a kept requirement gap to the FR-FLOW-218 delta path.
      it("FR-FLOW-045 AC-5: routes remediation by finding class with an explicit review scope", () => {
        const section = verifySection(skillBody(readWaveSkill(variant)));
        expect(REVIEW_FIX_LOOP.test(section), `${variant}: quality findings delegate to kiwi-review-fix-loop`).toBe(true);
        // Anchored to the routing row. A +/-320 window matched the out-of-scope paragraph's own
        // "범위 밖", so the explicit-scope requirement could be deleted from the row undetected.
        const routingRow = section.split("\n").find((l) => l.startsWith("| kept 코드 결함 |")) ?? "";
        const gapRow = section.split("\n").find((l) => l.startsWith("| kept 요구 갭 |")) ?? "";
        expect(gapRow, `${variant}: a kept requirement gap goes to the incremental authoring of the delta path`).toContain(
          "`wave-srs-registration.md §2` 의 증분 저작",
        );
        expect(routingRow, `${variant}: the remediation routing table must have a review-fix-loop row`).not.toBe("");
        expect(
          /--base|--commits/.test(routingRow),
          `${variant}: the delegation row itself must name an explicit review scope so committed work is not reported clean`,
        ).toBe(true);
        expect(
          /재진입|re-enter|re-entry/i.test(section),
          `${variant}: an intent gap the wave's requirements do not cover must re-enter the wave`,
        ).toBe(true);
        expect(
          /이전\s*wave|previous wave/i.test(section),
          `${variant}: a fix touching a previous wave must be called out`,
        ).toBe(true);
      });

      it("FR-FLOW-045 AC-6: introduces no fixer of its own", () => {
        const section = verifySection(skillBody(readWaveSkill(variant)));
        expect(OWN_FIXER_FORBIDDEN.test(section), `${variant}: wave-master must not add its own fixer subagent`).toBe(
          true,
        );
        expect(
          HEDGE.test(sentenceWith(section, OWN_FIXER_FORBIDDEN)),
          `${variant}: the own-fixer prohibition must be absolute, not a default with an escape hatch`,
        ).toBe(false);
      });

      it("FR-FLOW-045 AC-7: forbids weakening the criterion instead of fixing the defect", () => {
        const section = verifySection(skillBody(readWaveSkill(variant)));
        expect(
          /AC\s*본문|acceptance[- ]criteria text|AC 텍스트/i.test(section),
          `${variant}: a fixer must not edit acceptance-criteria text`,
        ).toBe(true);
        expect(
          /테스트[^\n]*(?:약화|삭제)|weaken[^\n]*test|test[^\n]*weaken/i.test(section),
          `${variant}: a fixer must not weaken or delete an existing test`,
        ).toBe(true);
        // FR-FLOW-045 AC-7 as rewritten for 5.3.0: with no severity class left, the third shortcut is
        // turning the verifier's red test green by editing the test instead of the code.
        expect(
          /검증자가 쓴 red 테스트를 지우거나 고쳐 green 으로 만들지 않는다/.test(section),
          `${variant}: a fixer must not delete or edit the verifier's red test to make it green`,
        ).toBe(true);
      });

      it("FR-FLOW-045 AC-8: does not let the delegated fix loop's own pass close a wave-level finding", () => {
        const section = verifySection(skillBody(readWaveSkill(variant)));
        expect(
          windowsAround(section, REVIEW_FIX_LOOP, 420).some(
            (w) => /(?:자신의|자체)\s*(?:PASS|통과)|its own pass/i.test(w) && /(?:충족하지|않는다|does not|never)/i.test(w),
          ),
          `${variant}: the delegated loop's own pass must not by itself close a wave-level finding`,
        ).toBe(true);
        // The window tolerated replacing the MUST-subject ("두 검증자의 재검증" -> "메인 세션의
        // 재확인"), which hands closure to the party the loop exists to check. FR-FLOW-045 AC-8 as
        // rewritten for 5.3.0: the red test turns green and the next round's new verifier writes none.
        expect(
          /그 red 테스트가 green 이 되고 다음 라운드의 새 검증자가 red 테스트를 쓰지 않을 때만 닫힌다/.test(section),
          `${variant}: only a green test and a clean next round with a new verifier may close a wave-level finding`,
        ).toBe(true);
      });
    });
  }
});

describe("FR-FLOW-046 — critical gate declaration and wave verification record (skill side)", () => {
  for (const variant of VARIANTS) {
    describe(`${variant} variant`, () => {
      // Revised in 4.0.0: a wave runs no pipeline cycle of its own (FR-FLOW-188 AC-7), so the key the
      // skill records is the wave's sds_id (FR-NODE-213 AC-6), not a pipeline_run_id.
      it("FR-FLOW-046 AC-6: records the wave's sds_id on the complete and wave-verify events", () => {
        const body = skillBody(readWaveSkill(variant));
        const waves = sectionUnder(body, /^#{2,4}\s.*waves\.jsonl/i);
        expect(waves, `${variant}: the waves.jsonl progress section must exist`).not.toBe("");
        // MUST, not MAY, and on both named events: relaxing "반드시 기록한다" to "가능하면 기록한다 —
        // 없으면 `*` 글롭으로 대체해도 된다" would leave a token-presence check green while
        // substituting the very glob §5.5.1 forbids.
        expect(
          // FR-FLOW-046 AC-6 (4.1.0): the wave's unit id is recorded as sds_id whether or not the wave has an SDS.
          /`complete` 이벤트와 `phase=wave-verify` 이벤트에는 SDS 유무와 관계없이 그 wave 의 단위 id 를 `sds_id` 로 반드시 기록한다/.test(waves),
          `${variant}: recording sds_id on the complete and wave-verify events must be mandatory, not best-effort`,
        ).toBe(true);
        expect(/글롭|glob/i.test(waves), `${variant}: a glob must never be offered as a substitute here`).toBe(false);
        // No pipeline_run_id opens a pipeline.jsonl window any more. Scoped to the skill's own
        // SKILL.md: the resolved text appends waves-event.md, which keeps the field to read old lines.
        const ownSkill = readFileSync(path.join(REPO_ROOT, "skills", variant, "kiwi-wave-master", "SKILL.md"), "utf8");
        expect(/pipeline_run_id/.test(ownSkill), `${variant}: the skill must not record or read a pipeline_run_id`).toBe(
          false,
        );
        // The wave SDS resolves from sds_id; the review report resolves from the worker's own review;
        // an absent report is a finding, never replaced by a glob.
        const bundle = sectionUnder(verifySection(body), /^#{3,4}\s.*검증자 입력/);
        expect(/`docs\/sds\/\{sds_id\}\.sds\.md`/.test(bundle), `${variant}: the wave SDS must resolve from sds_id`).toBe(
          true,
        );
        const absentRule = sentenceWith(bundle, /보고서가 아예 없으면|report is absent/i);
        expect(
          /워커 리뷰 보고서|worker'?s? review report/i.test(absentRule) &&
            /글롭으로 대체하지 말고|not replaced? by a glob/i.test(absentRule) &&
            /finding/.test(absentRule),
          `${variant}: an absent worker review report must be raised as a finding rather than replaced by a glob`,
        ).toBe(true);
        // The wave-start `srs-authoring` line and its sds_id exemption left with the per-wave authoring
        // (FR-FLOW-212 AC-3); their absence is pinned in wave-srs-first.fr-flow-212.test.ts.
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
      });

      // Old: this file's FR-FLOW-046 AC-3 case required a phase="pipeline" line at pipeline-cycle entry
      // (FR-FLOW-056 AC-4 as first written). Superseded by FR-FLOW-188 AC-7 — a wave runs no pipeline
      // cycle — and FR-FLOW-056 AC-4 as revised in 4.0.0: the first in_progress records SRS authoring,
      // and the SDS and worker stages that follow carry the waves-event 2.0.0 phases sds and worker.
      it("FR-FLOW-056 AC-4: labels the wave-start, SDS and worker in_progress events with the stage entered", () => {
        const section = verifySection(skillBody(readWaveSkill(variant)));
        const record = sectionUnder(section, /^#{3,4}\s.*기록|^#{3,4}\s.*record/i);
        expect(record, `${variant}: the §5.5.6 record sub-section must exist`).not.toBe("");
        // The wave-start `phase="srs-authoring"` label left with the per-wave authoring (FR-FLOW-212 AC-3).
        const stageRule = sentenceWith(record, /`phase="sds"`/);
        expect(
          /SDS 작성|SDS authoring/i.test(stageRule) && /`phase="worker"`/.test(stageRule) && /dispatch/i.test(stageRule),
          `${variant}: SDS authoring and worker dispatch must each append an in_progress carrying phase sds / worker`,
        ).toBe(true);
        expect(
          /phase="pipeline"|`phase`\s*=\s*`?pipeline/.test(record),
          `${variant}: no event is labelled with the retired per-wave pipeline phase`,
        ).toBe(false);
      });

      // Revised in 4.0.0: the children each wave runs are no longer a per-wave kiwi-pipeline
      // (FR-FLOW-188 AC-7), and wt-delegation-refused left with that delegation (FR-FLOW-188 AC-1).
      it("FR-FLOW-046 AC-7: declares a critical_gates table covering the transcribed and new halts", () => {
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
        // The child halt row transcribes the children a wave now runs, not a per-wave kiwi-pipeline.
        const childRow = rows.find((row) => row.includes("`child-pipeline-needs-user-or-failed`")) ?? "";
        expect(
          /kiwi-sds/.test(childRow) && /NEEDS_USER/.test(childRow) && /FAILED/.test(childRow),
          `${variant}: the child halt row must name the wave's own children and their NEEDS_USER / FAILED returns`,
        ).toBe(true);
        expect(/kiwi-pipeline/.test(childRow), `${variant}: the child halt row must not name a per-wave kiwi-pipeline`).toBe(
          false,
        );
        expect(
          rows.some((row) => row.includes("wt-delegation-refused")),
          `${variant}: the worktree-delegation refusal left with the per-wave pipeline delegation`,
        ).toBe(false);
      });

      it("FR-FLOW-046 AC-8: halts the whole orchestration under --auto on a kept finding", () => {
        const body = skillBody(readWaveSkill(variant));
        const gates = gateSection(body);
        const section = verifySection(body);
        const scope = `${gates}\n${section}`;
        const gateWindows = windowsAround(scope, /wave-verify-kept-finding/, 500);
        // Anchored to the dedicated sentence: a +/-500 window reached the §0.G intro's own generic
        // "--auto 라도 ... 중단" line, so inverting this gate to "그 wave 하나만 중단" stayed green.
        expect(
          /`wave-verify-kept-finding`[^\n]*--auto[^\n]{0,40}(?:라도|로도|무관)[^\n]{0,80}전체를 중단/.test(scope),
          `${variant}: the gate must halt the WHOLE orchestration under --auto, not just the current wave`,
        ).toBe(true);
        expect(
          gateWindows.some((w) => AUTO_HALT.test(w)),
          `${variant}: a kept finding left at the end of the loop must halt even under --auto`,
        ).toBe(true);
        // Scoped to the gate window on purpose: checked over the whole scope, GAPS and fail-cap were
        // satisfied by the §5.5.2 roll-up table and the §5.5.4 cap paragraph, so both triggers could
        // be deleted from the gate declaration itself while the check stayed green.
        // FR-FLOW-221 AC-4: the stop is named for kept findings, and its declaration itself names
        // the kept finding and cap exhaustion as its triggers.
        expect(
          gateWindows.some((w) => /kept finding/.test(w)) && gateWindows.some((w) => FAIL_CAP.test(w)),
          `${variant}: the gate declaration itself must name the kept finding and cap exhaustion as triggers`,
        ).toBe(true);
      });

      it("FR-FLOW-046 AC-8: records the --auto activation in the requirement's change notes", () => {
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
