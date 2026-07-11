import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// @req FR-FLOW-032
// FR-FLOW-032 — kiwi-planner plan-vs-SRS coverage verification loop.
//
// RED-phase content assertions (T-PH002-05). These assert the FINAL desired state of the kiwi-planner
// skill instruction across all three PACKAGED VARIANTS and therefore FAIL until T-PH002-06 rewrites
// the Phase 3 / 3.5 SRS-satisfaction verification into the coverage loop in:
//   - claude: skills/claude/kiwi-planner/SKILL.md  (Korean canonical; today: single current-session
//             -model verification subagent, "단일 현재 세션 모델 검증 서브에이전트")
//   - codex : skills/codex/kiwi-planner/SKILL.md   (Korean-dominant, uses "서브에이전트")
//   - etc   : skills/etc/kiwi-planner/SKILL.md     (single-evaluator local-LLM profile; uses
//             "evaluator"/"평가자", NOT "서브에이전트")
//
// A SKILL.md is natural-language agent instruction, not executable code, so behavior is verified by
// raw-text presence + windowed proximity assertions (FR-FLOW-023 research-loop / FR-FLOW-031
// workflow-tools precedent), not skill execution. Assertions key on bilingual (English / Korean)
// technical tokens so the Korean canonical and the mirror variants are validated by the same checks.
//
// == Why each `it` is genuinely RED (no false-green) ============================================
// Every `it` carries at least one hard assertion on a NET-NEW token that is VERIFIED ABSENT from all
// three kiwi-planner SKILL.md today, and the harder structural checks are anchored on those same
// absent tokens (windowsAround on an absent anchor returns [] -> `.some(...)` is false):
//   - AC-1 : RECONCILE ("reconcile"/"대조") — the loop's opening count-reconciliation step.
//   - AC-2 : VERIFICATION_COMPLETE ("verification-complete"/"검증 완료") — the persistent marking; and
//            REFUTE ("refute"/"반박") — the --max independent third refuter. The "2 sequential
//            verifications on the current model" and "first/second" structure are checked ONLY inside
//            a window anchored on VERIFICATION_COMPLETE, so they cannot be false-satisfied by the
//            pre-existing Max-mode wording "단일 검증 서브에이전트 + 독립 2차 검증 패스" (a SINGLE subagent
//            with an independent 2nd PASS) which has no "verification-complete" token nearby.
//   - AC-3 : NOT_YET_MARKED — the omission-repair loop that re-verifies only the not-yet-marked items.
//
// Tokens that ALREADY exist today are deliberately NOT used as lone red drivers and appear only inside
// co-occurrence windows anchored on an absent token: 서브에이전트/평가자 (verifier nouns), 순차
// (sequential), 발산 (divergence), "AC 단위", 미커버, "현재 세션 모델", "독립 2차", and — importantly —
// "2 라운드 연속" (the pre-existing Max SRS-satisfaction "2 라운드 연속 MEDIUM=0 → PASS", which is NOT the
// omission loop). TWO_CONSECUTIVE is therefore used ONLY as a window anchor for the --max termination
// check, which additionally requires zero-OMISSION + terminate + --max co-occurrence (all absent
// today), never as a bare net-new assertion.
//
// == Variant-agnostic verifier vocabulary =======================================================
// The AC's "2 subagents in sequence / independent third subagent" is asserted WITHOUT hard-requiring
// the noun "subagent": the etc variant follows a single-evaluator local-LLM profile and expresses
// verification via "evaluator"/"평가자". The structural checks match on counts/ordinals/sequence and
// the net-new "verification-complete"/"refute" anchors, so a faithful green edit in any variant's
// native vocabulary (subagent OR evaluator, Korean OR English) can satisfy them.

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

const VARIANTS = ["claude", "codex", "etc"] as const;
type Variant = (typeof VARIANTS)[number];

// T-PH002-06 rewrites the coverage loop in all three kiwi-planner SKILL.md.
function plannerText(variant: Variant): string {
  return readFileSync(path.join(REPO_ROOT, "skills", variant, "kiwi-planner", "SKILL.md"), "utf8");
}

/** Text windows of +/- `radius` chars around every match of `re` within a single `text`. */
function windowsAround(text: string, re: RegExp, radius = 400): string[] {
  const g = new RegExp(re.source, re.flags.replace("g", "") + "g");
  const out: string[] = [];
  for (let m = g.exec(text); m; m = g.exec(text)) {
    out.push(text.slice(Math.max(0, m.index - radius), m.index + m[0].length + radius));
    if (g.lastIndex === m.index) g.lastIndex++;
  }
  return out;
}

// --- Net-new red-anchor vocabulary (verified ABSENT from all three planner SKILL.md today) ---------
const RECONCILE = /reconcil(?:e|es|ed|ing|iation)|대조/i;
const VERIFICATION_COMPLETE = /verification[\s-]*complete|검증[\s-]*완료/i;
const REFUTE = /refut(?:e|es|ed|ing|ation)|반박/i;
const NOT_YET_MARKED =
  /not[\s-]*yet[\s-]*marked|아직[^\n]{0,10}(?:마킹|표시|검증)[^\n]{0,8}(?:되지\s*않|안\s*(?:된|한))|미(?:마킹|표시|검증)\s*(?:항목|요구|req|것|상태)|남(?:은|아\s*있는)\s*(?:항목|요구|미검증)/i;

// --- Bilingual co-occurrence vocabulary (EN mirrors + KO canonical; appear only inside windows) ----
const COUNT = /\bcounts?\b|number\s+of|개수|갯수|\b수(?:를|가|는)?\b/i;
const SRS_REQ =
  /SRS[^\n]{0,10}(?:requirement|req|요구)|target[^\n]{0,10}(?:requirement|req|REQ)|요구사항[^\n]{0,4}(?:수|개수)|(?:target\s*)?REQ[^\n]{0,4}(?:전수|수|개수)/i;
const PLAN_COVERAGE =
  /plan[^\n]{0,4}coverage|coverage[^\n]{0,6}(?:entr(?:y|ies)|배열|항목|엔트리)|계획[^\n]{0,4}커버리지|커버리지[^\n]{0,4}(?:항목|엔트리|배열)/i;
const ONE_BY_ONE = /one[\s-]*by[\s-]*one|하나씩|하나하나|한\s*(?:개|건)씩/i;
const CROSS_CHECK = /cross[\s-]*check|교차\s*(?:검증|확인|체크)|일대일|한\s*개씩|하나하나/i;
const REQ_ID_TOKEN =
  /requirement\s*id|req(?:uirement)?[\s_]*id|요구사항\s*id|REQ[\s_]*id|각\s*(?:요구사항|requirement|REQ|req)\s*(?:id|를|을|마다|에\s*대해|별|하나)/i;
// Already present in Phase 3 today (co-occurrence only, NOT a red driver).
const CURRENT_MODEL = /FR-FLOW-022|current[\s-]*session[\s-]*model|현재\s*(?:세션\s*)?모델/i;
// "2" adjacent to a sequential word, either order — variant/noun-agnostic. Note it keys on
// sequential/순차 (NOT 연속), so the pre-existing "2 라운드 연속" / "2 연속 MEDIUM=0" cannot satisfy it,
// and it is only evaluated inside the VERIFICATION_COMPLETE window (absent today).
const TWO_SEQUENTIAL =
  /(?:\b2\b|two|twice|두\s*번|2\s*(?:회|번)|두|둘)[^\n]{0,30}(?:sequential(?:ly)?|in\s+sequence|순차(?:적)?|차례(?:로|대로)|순서대로)|(?:sequential(?:ly)?|in\s+sequence|순차(?:적)?|차례(?:로|대로)|순서대로)[^\n]{0,24}(?:\b2\b|two|twice|두\s*번|2\s*(?:회|번)|두|둘)/i;
const FIRST = /\bfirst\b|첫\s*(?:번째)?|1\s*(?:st|차|번째)/i;
const SECOND = /\bsecond\b|두\s*번째|2\s*(?:nd|차|번째)/i;
const RECONFIRM = /re-?confirm|재확인|재검증|독립(?:적)?(?:으로)?|independent(?:ly)?/i;
// The second verification runs ONLY AFTER the first passes (a gating relationship, not two unordered
// confirmations).
const GATE =
  /only\s+after|after[^\n]{0,14}(?:it\s+)?pass(?:es)?|통과(?:한|된|하면)?[^\n]{0,6}(?:후|뒤|후에만|후에야)|후에야|합격[^\n]{0,4}후/i;
// "persistent marking, not re-analyzed / changed later" (AC-2). The KO 영속/지속/유지 appear only here,
// inside the VERIFICATION_COMPLETE window.
const PERSISTENT =
  /persistent(?:ly)?|persists?|(?:영속|지속|유지|고정)[^\n]{0,24}(?:마킹|표시|marking|검증\s*완료)|(?:마킹|표시|marking)[^\n]{0,24}(?:영속|지속|유지|고정)|not\s+re-?analy|다시\s*(?:분석|검증)[^\n]{0,8}않|재(?:분석|검증)[^\n]{0,8}않/i;
const MAX_FLAG = /--max\b/;
const THIRD = /\bthird\b|3\s*(?:rd|차|번째)|세\s*번째/i;
const INDEPENDENT = /independent(?:ly)?|독립(?:적)?/i;
const AC_GRANULARITY =
  /acceptance[\s-]*criteri(?:on|a)[\s-]*granularit|acceptance[\s-]*criteri(?:on|a)[^\n]{0,24}granular|AC[\s-]*(?:단위|수준)|AC[\s-]*granularit/i;
const OMISSION = /omission|omitted|uncovered|누락|미커버|커버되지\s*않|미(?:포함|커버)/i;
// AC-3 defines omission as (a) an uncovered requirement/AC OR (b) a plan task outside the SRS scope.
const OUT_OF_SCOPE =
  /outside[^\n]{0,14}(?:the\s+)?SRS[\s-]*scope|out[\s-]?of[\s-]?scope|(?:SRS\s*)?(?:범위|스코프)[^\n]{0,6}(?:밖|외|벗어)/i;
const IMPROVE_PLAN =
  /improves?[^\n]{0,12}plan|plan[^\n]{0,12}improve|계획(?:을|를)?\s*(?:개선|보완|수정|보강)|plan[^\n]{0,12}(?:개선|보완)/i;
const REVERIFY = /re-?verif(?:y|ies|ied|ication)|재검증|다시\s*검증|재확인/i;
const ITERATE = /iterat(?:e|es|ed|ing|ion)|반복|until\s+every/i;
const EVERY_REQ =
  /every\s+(?:requirement|req)|all\s+(?:requirement|req)|모든\s*(?:요구사항|요구|req)/i;
// The loop is bounded by a divergence guard; "발산"/"divergence" already exist as a gate, so a
// guard/cap word must co-occur (the "divergence guard" phrasing is net-new).
const DIVERGENCE_GUARD =
  /divergence[\s-]*(?:guard|cap|bound|limit)|발산[\s-]*(?:가드|방지|상한|제한)|(?:guard|가드|상한|cap)[^\n]{0,16}(?:divergence|발산)/i;
// Pre-existing in all three files via the unrelated "2 라운드 연속 MEDIUM=0" — so this is used ONLY as a
// window anchor, never as a bare net-new assertion.
const TWO_CONSECUTIVE =
  /two\s+consecutive|2\s+consecutive|연속[^\n]{0,6}(?:2|두)\s*(?:회|라운드|번)|(?:2|두)\s*(?:회|라운드|번)\s*연속/i;
const ZERO_OMISSION =
  /zero[^\n]{0,14}omission|omission[^\n]{0,10}(?:0|zero)|누락[^\n]{0,6}(?:0\s*건|없|zero)|(?:0|zero)[^\n]{0,12}(?:new\s*)?omission|새(?:로운)?\s*누락[^\n]{0,10}(?:0|없)/i;
const TERMINATE = /terminat(?:e|es|ed|ing|ion)|종료|중단|끝(?:난|남)?/i;

describe("FR-FLOW-032 — kiwi-planner plan-vs-SRS coverage verification loop", () => {
  for (const variant of VARIANTS) {
    // ---- AC-1: reconcile SRS req count vs plan coverage, then per-req one-by-one cross-check --------
    it(`FR-FLOW-032 red :: AC-1 [${variant}] — starts by reconciling the SRS req count against plan coverage, then cross-checks each requirement id one-by-one`, () => {
      const text = plannerText(variant);

      // Primary red driver: the loop's opening count-reconciliation step does not exist today.
      expect(
        RECONCILE.test(text),
        `FR-FLOW-032 AC-1: ${variant} kiwi-planner must reconcile the count of target SRS requirements against the plan coverage entries (net-new)`,
      ).toBe(true);

      // The reconciliation must be between the SRS requirement count and the plan coverage entries.
      const reconcilesCount = windowsAround(text, RECONCILE, 300).some(
        (w) => COUNT.test(w) && (SRS_REQ.test(w) || PLAN_COVERAGE.test(w)),
      );
      expect(
        reconcilesCount,
        `FR-FLOW-032 AC-1: ${variant} must reconcile the COUNT of target SRS requirements against the plan coverage entries`,
      ).toBe(true);

      // It then cross-checks each requirement id one-by-one against the plan (not just an aggregate %).
      const perReq = windowsAround(text, ONE_BY_ONE, 300).some(
        (w) => REQ_ID_TOKEN.test(w) && CROSS_CHECK.test(w),
      );
      expect(
        perReq,
        `FR-FLOW-032 AC-1: ${variant} must cross-check each requirement id one-by-one against the plan`,
      ).toBe(true);

      // Ordering (AC-1 says the loop STARTS BY reconciling, THEN cross-checks one-by-one).
      const recIdx = text.search(RECONCILE);
      const obIdx = text.search(ONE_BY_ONE);
      expect(
        recIdx >= 0 && obIdx >= 0 && recIdx < obIdx,
        `FR-FLOW-032 AC-1: ${variant} the loop must START by reconciling counts, THEN cross-check each requirement one-by-one`,
      ).toBe(true);
    });

    // ---- AC-2: 2 sequential current-model verifications, persistent marking; --max AC-gran + refuter
    it(`FR-FLOW-032 red :: AC-2 [${variant}] — verifies coverage with 2 sequential current-model verifications and a persistent verification-complete marking`, () => {
      const text = plannerText(variant);

      // Primary red driver: a requirement is marked verification-complete only after both confirm.
      expect(
        VERIFICATION_COMPLETE.test(text),
        `FR-FLOW-032 AC-2: ${variant} must mark a requirement verification-complete only after both verifications confirm (net-new)`,
      ).toBe(true);

      // Coverage is confirmed by 2 verifications applied IN SEQUENCE on the current session model
      // (per FR-FLOW-022). Anchored on the net-new verification-complete marking so the pre-existing
      // Max "단일 검증 서브에이전트 + 독립 2차 검증 패스" cannot false-satisfy it.
      const twoSequential = windowsAround(text, VERIFICATION_COMPLETE, 600).some(
        (w) => TWO_SEQUENTIAL.test(w) && CURRENT_MODEL.test(w),
      );
      expect(
        twoSequential,
        `FR-FLOW-032 AC-2: ${variant} must verify coverage with 2 verifications applied in sequence on the current session model (per FR-FLOW-022)`,
      ).toBe(true);

      // The first confirms; only AFTER it passes does an independent second re-confirm.
      const firstThenSecond = windowsAround(text, VERIFICATION_COMPLETE, 600).some(
        (w) => FIRST.test(w) && SECOND.test(w) && RECONFIRM.test(w) && GATE.test(w),
      );
      expect(
        firstThenSecond,
        `FR-FLOW-032 AC-2: ${variant} must state the first confirms, and only after it passes does an independent second re-confirm`,
      ).toBe(true);

      // The verification-complete marking is persistent (a marked requirement is not re-analyzed /
      // changed in later iterations).
      const persistentMark = windowsAround(text, VERIFICATION_COMPLETE, 450).some((w) =>
        PERSISTENT.test(w),
      );
      expect(
        persistentMark,
        `FR-FLOW-032 AC-2: ${variant} the verification-complete marking must be persistent so a marked requirement is not re-analyzed in later iterations`,
      ).toBe(true);

      // Under --max: an independent third verification must FAIL to refute full coverage before the
      // requirement is marked (net-new "refute").
      expect(
        REFUTE.test(text),
        `FR-FLOW-032 AC-2: ${variant} under --max an independent third verification must attempt to refute full coverage (net-new)`,
      ).toBe(true);
      const maxRefuter = windowsAround(text, REFUTE, 450).some(
        (w) => THIRD.test(w) && INDEPENDENT.test(w) && MAX_FLAG.test(w),
      );
      expect(
        maxRefuter,
        `FR-FLOW-032 AC-2: ${variant} under --max an INDEPENDENT THIRD verification must fail to refute full coverage before marking`,
      ).toBe(true);

      // Under --max coverage is checked at acceptance-criterion granularity (a --max-gated behavior,
      // tied to the --max refute strengthening).
      const maxAcGranular = windowsAround(text, REFUTE, 500).some(
        (w) => AC_GRANULARITY.test(w) && MAX_FLAG.test(w),
      );
      expect(
        maxAcGranular,
        `FR-FLOW-032 AC-2: ${variant} under --max coverage must be checked at acceptance-criterion granularity`,
      ).toBe(true);
    });

    // ---- AC-3: omission-repair loop re-verifying only not-yet-marked items; --max 2x-zero termination
    it(`FR-FLOW-032 red :: AC-3 [${variant}] — on a detected omission, improves the plan and re-verifies only the not-yet-marked items until every requirement is marked, bounded by a divergence guard`, () => {
      const text = plannerText(variant);

      // Primary red driver: the omission-repair loop that re-verifies ONLY the not-yet-marked items
      // does not exist today.
      expect(
        NOT_YET_MARKED.test(text),
        `FR-FLOW-032 AC-3: ${variant} on a detected omission must re-verify only the not-yet-marked items (net-new)`,
      ).toBe(true);

      // On a detected omission (an uncovered requirement/AC) kiwi-planner improves the plan.
      const improvesOnOmission = windowsAround(text, IMPROVE_PLAN, 400).some((w) => OMISSION.test(w));
      expect(
        improvesOnOmission,
        `FR-FLOW-032 AC-3: ${variant} must improve the plan when an omission is detected`,
      ).toBe(true);

      // The omission definition also includes a plan task that falls outside the SRS scope.
      expect(
        OUT_OF_SCOPE.test(text),
        `FR-FLOW-032 AC-3: ${variant} an omission also includes a plan task outside the SRS scope`,
      ).toBe(true);

      // It re-verifies only the not-yet-marked items, iterating until every requirement is marked
      // verification-complete.
      const reverifiesRemaining = windowsAround(text, NOT_YET_MARKED, 450).some(
        (w) => REVERIFY.test(w) && ITERATE.test(w) && (VERIFICATION_COMPLETE.test(w) || EVERY_REQ.test(w)),
      );
      expect(
        reverifiesRemaining,
        `FR-FLOW-032 AC-3: ${variant} must iterate, re-verifying only the not-yet-marked items until every requirement is marked verification-complete`,
      ).toBe(true);

      // The loop is bounded by a divergence guard.
      expect(
        DIVERGENCE_GUARD.test(text),
        `FR-FLOW-032 AC-3: ${variant} the omission-repair loop must be bounded by a divergence guard`,
      ).toBe(true);

      // Under --max the loop terminates only after two consecutive rounds with zero new omissions.
      // Anchored on TWO_CONSECUTIVE (which also matches the unrelated pre-existing "2 라운드 연속"), so
      // the window must additionally carry zero-omission + terminate + --max — all absent today.
      const maxTermination = windowsAround(text, TWO_CONSECUTIVE, 400).some(
        (w) => ZERO_OMISSION.test(w) && TERMINATE.test(w) && MAX_FLAG.test(w),
      );
      expect(
        maxTermination,
        `FR-FLOW-032 AC-3: ${variant} under --max the loop must terminate only after two consecutive rounds with zero new omissions`,
      ).toBe(true);
    });
  }
});
