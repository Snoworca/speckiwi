import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// @req FR-FLOW-023
// FR-FLOW-023 — kiwi-srs research-document-driven SRS verify/improve (A/B) loop.
//
// RED-phase content assertions (T-PH002-01). These assert the FINAL desired state of the kiwi-srs
// skill instruction across all three variants and therefore FAIL until T-PH002-02 authors the A/B
// verify/improve loop in:
//   - claude: skills/claude/kiwi-srs/SKILL.md                        (Korean canonical)
//   - codex : skills/codex/kiwi-srs/references/extended-workflow.md  (English mirror)
//   - etc   : skills/etc/kiwi-srs/references/extended-workflow.md    (English mirror)
//
// A SKILL.md is natural-language agent instruction, not executable code, so behavior is verified by
// raw-text presence + windowed proximity assertions (FR-FLOW-014 kiwi-step / FR-FLOW-025
// auto-committee precedent), not skill execution. Assertions key on bilingual (English / Korean)
// technical tokens so the Korean canonical (claude) and the English mirrors (codex, etc) are
// validated by the same checks.
//
// Every discriminating assertion is anchored on a window around a NET-NEW token that is ABSENT from
// kiwi-srs today — the "Process A" / "Process B" loop labels, "research document" intake, the
// "improvements document", the "divergence" guard, and "document count × 3" fan-out. The single
// "verification subagent" wording added by FR-FLOW-022 / T-PH001-02 is deliberately NOT used as a red
// anchor because it already exists; the A/B-loop concepts above do not. Because windowsAround on an
// absent anchor returns [], each `.some(...)` is false today -> genuine red, with no false-green risk.
//
// The "Process A" / "Process B" labels are matched case-SENSITIVELY so an incidental "process a
// request" prose phrase cannot satisfy the anchor. Divergence-guard cap numbers (5 normal / 8 --max)
// follow plan OQ-023; the --max Process-A fan-out (3 verification subagents on the single-document
// baseline; document count × 3 for multiple documents) follows AC-4 / AC-5.

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

const VARIANTS = ["claude", "codex", "etc"] as const;
type Variant = (typeof VARIANTS)[number];

// T-PH002-02 authors the A/B loop in the claude SKILL.md and the codex/etc extended-workflow.md.
function srsText(variant: Variant): string {
  const rel =
    variant === "claude"
      ? ["skills", "claude", "kiwi-srs", "SKILL.md"]
      : ["skills", variant, "kiwi-srs", "references", "extended-workflow.md"];
  return readFileSync(path.join(REPO_ROOT, ...rel), "utf8");
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

// --- Net-new A/B-loop anchor labels (case-sensitive so "process a request" cannot false-match) ---
const PROCESS_A = /Process\s*A\b|프로세스\s*A/;
const PROCESS_B = /Process\s*B\b|프로세스\s*B/;

// --- Bilingual token vocabulary (EN mirrors + KO canonical) -------------------------------------
const RESEARCH_DOC = /research\s+doc(?:ument)?s?|리서치\s*문서|연구\s*문서/i; // net-new intake
const ARGUMENT = /argument|인자|인수|파라미터|parameter/i;
const PROMPT_REF =
  /prompt[^\n]{0,20}reference|reference[^\n]{0,20}(?:to\s+)?(?:a\s+|the\s+|user\s+)?prompt|user\s+prompt|프롬프트[^\n]{0,12}(?:참조|언급|가리)|(?:참조|언급)[^\n]{0,12}프롬프트|resolv[^\n]{0,30}prompt/i;
const MISSING_REQ = /missing\s+requirement|누락(?:된)?\s*요구/i;
const INCORRECT_REQ =
  /incorrect(?:ly)?\s+(?:authored\s+)?requirement|잘못\s*(?:작성|기술)|부정확|오작성/i;
const IMPLEMENTABILITY = /implementab|feasibilit|구현\s*가능성|실현\s*가능성/i;
// Feature-break is split into an existing-feature token AND a breakage verb that must co-occur, so a
// bare mention of "existing features" cannot satisfy the "flag breaks" assertion.
const EXISTING_FEATURE = /existing[\s-]*(?:product\s+)?features?|기존\s*(?:제품\s*)?기능/i;
// Includes the codebase's house idiom for feature breakage ("regression" / "회귀"), so a natural
// house-style green wording ("flags any regression to existing product features") is satisfiable.
const BREAK_WORD =
  /\bbreaks?\b|\bbreaking\b|\bbroke(?:n)?\b|\bregressions?\b|손상|파손|깨(?:짐|뜨|지)|망가|해치|무너|회귀|훼손/i;
const IMPROVEMENTS_DOC = /improvements?\s+doc(?:ument)?|개선\s*(?:사항\s*)?문서|개선점\s*문서/i; // net-new
// The improvements document is written to a run-scoped temp directory (AC-2).
// Requires an actual temp destination — the bare "run-scoped" fallback is removed so a persistent
// run-scoped dir (e.g. docs/analysis/kiwi-srs-{run-id}/) cannot false-satisfy the temp requirement.
const RUN_SCOPED_TEMP =
  /run[\s-]*scoped[^\n]{0,20}temp|temp(?:orary)?[\s-]*(?:dir(?:ectory)?|folder|path)|임시[^\n]{0,6}(?:디렉|폴더|경로)/i;
// Tight semantic gate: the termination must be conditioned on "no improvements", so an incidental
// generic 종료/end token near a recurring "Process A" cannot false-satisfy the assertion.
const TERMINATES_CLEAN =
  /no\s+(?:more\s+)?improvements?[^\n]{0,60}(?:terminate|stop|halt|end|complete|exit)|(?:terminate|stop|halt|exit)[^\n]{0,50}no\s+(?:more\s+)?improvements?|(?:zero|0)\s+improvements?[^\n]{0,50}(?:terminate|stop|halt|end|complete|exit)|개선(?:사항|점)?[^\n]{0,8}(?:이\s*)?없[^\n]{0,40}(?:종료|중단|끝|완료)|개선(?:사항|점)?[^\n]{0,6}0\s*건[^\n]{0,30}(?:종료|중단|끝|완료)|(?:종료|중단|완료)[^\n]{0,30}개선(?:사항|점)?[^\n]{0,8}(?:이\s*)?없/i;
const APPLY = /appl(?:y|ies|ied)|반영|적용/i;
// Korean gap widened so an inline recipient ("제어권을 Process A로 반환") does not false-red the claude
// variant; the surrounding assertion also independently requires PROCESS_A in the same window.
const RETURN_CONTROL =
  /return[^\n]{0,16}control|control\s+returns|제어(?:권)?(?:을|를)?[^\n]{0,24}(?:반환|되돌|복귀|돌려)|(?:반환|되돌려|복귀)[^\n]{0,16}제어/i;
const DIVERGENCE =
  /divergence|발산|maximum[\s-]*iteration|max(?:imum)?[\s-]*iteration|최대\s*반복|수렴\s*가드/i; // net-new
const MAX_FLAG = /--max\b/;
// Cap numbers bound to their mode (5 -> normal, 8 -> --max) so an inverted cap cannot pass.
const CAP_5_NORMAL = /\b5\b[^\n]{0,24}(?:normal|기본|round|회|iteration|반복)|(?:normal|기본)[^\n]{0,16}\b5\b/i;
const CAP_8_MAX = /\b8\b[^\n]{0,16}(?:--max|max\b)|--max[^\n]{0,16}\b8\b/i;
// The AC-5 non-max branch is about spawning verification SUBAGENTS per document; the subagent word
// is the discriminator (a generic "spawn/생성" verb alone must not satisfy it).
const SUBAGENT = /sub-?agents?|서브\s*에이전트|서브에이전트/i;
// "3" adjacent to a subagent word (either order), so a stray decimal or section number cannot
// satisfy a subagent-count assertion.
const THREE_NEAR_SUBAGENT =
  /\b3\b[^\n]{0,24}(?:sub-?agents?|서브\s*에이전트|서브에이전트)|(?:sub-?agents?|서브\s*에이전트|서브에이전트)[^\n]{0,12}(?:\b3\b|3\s*개|세\s*개)/i;
const DOC_COUNT = /document\s+count|문서\s*(?:수|개수|갯수)|doc\s+count/i; // net-new
const TIMES_THREE = /[×xX*]\s*3|3\s*[×xX*]|곱하기\s*3|3\s*배/;
const PER_DOCUMENT = /per[\s-]*document|per[\s-]*doc\b|문서\s*(?:별|마다|당)|각\s*문서/i;
const SEQUENTIAL = /sequential|순차/i;

describe("FR-FLOW-023 — kiwi-srs research-document-driven SRS verify/improve (A/B) loop", () => {
  for (const variant of VARIANTS) {
    it(`FR-FLOW-023 red :: AC-1 [${variant}] — accepts research document(s) as an explicit argument or prompt reference`, () => {
      const text = srsText(variant);

      // Primary red driver: kiwi-srs has zero research-document intake today.
      expect(
        RESEARCH_DOC.test(text),
        `FR-FLOW-023 AC-1: ${variant} kiwi-srs must accept research document(s) as loop input (net-new intake)`,
      ).toBe(true);

      // The intake must be an explicit argument OR resolved from a user prompt reference.
      const intake = windowsAround(text, RESEARCH_DOC, 400).some(
        (w) => ARGUMENT.test(w) || PROMPT_REF.test(w),
      );
      expect(
        intake,
        `FR-FLOW-023 AC-1: ${variant} kiwi-srs must accept research document(s) as an explicit argument or resolve them from a user prompt reference`,
      ).toBe(true);
    });

    it(`FR-FLOW-023 red :: AC-2 [${variant}] — Process A compares research docs vs SRS, writes improvements doc, terminates when clean`, () => {
      const text = srsText(variant);

      // Primary red driver: the A/B loop's Process A does not exist in kiwi-srs today.
      expect(
        PROCESS_A.test(text),
        `FR-FLOW-023 AC-2: ${variant} kiwi-srs must define Process A of the A/B verify/improve loop`,
      ).toBe(true);

      // Process A reports (i) missing requirements, (ii) incorrectly authored requirements, and
      // (iii) implementability in the current architecture (reusing the feasibility evaluation).
      const reports = windowsAround(text, PROCESS_A, 700).some(
        (w) => MISSING_REQ.test(w) && INCORRECT_REQ.test(w) && IMPLEMENTABILITY.test(w),
      );
      expect(
        reports,
        `FR-FLOW-023 AC-2: ${variant} Process A must report missing requirements, incorrectly authored requirements, and implementability`,
      ).toBe(true);

      // Process A additionally flags any BREAK to existing product features (an existing-feature
      // token and a breakage verb must co-occur — a bare feature mention is not enough).
      const flagsBreak = windowsAround(text, PROCESS_A, 500).some(
        (w) => EXISTING_FEATURE.test(w) && BREAK_WORD.test(w),
      );
      expect(
        flagsBreak,
        `FR-FLOW-023 AC-2: ${variant} Process A must flag any break to existing product features`,
      ).toBe(true);

      // Process A writes an improvements document to a run-scoped temp directory. Anchored on the
      // net-new improvements-document token; the run-scoped-temp destination is explicitly required.
      const writesToTemp = windowsAround(text, IMPROVEMENTS_DOC, 300).some((w) =>
        RUN_SCOPED_TEMP.test(w),
      );
      expect(
        writesToTemp,
        `FR-FLOW-023 AC-2: ${variant} Process A must write the improvements document to a run-scoped temp directory`,
      ).toBe(true);

      // Process A terminates specifically when no improvements are found (the termination is
      // conditioned on "no improvements", not a generic end token).
      expect(
        TERMINATES_CLEAN.test(text),
        `FR-FLOW-023 AC-2: ${variant} Process A must terminate when no improvements are found`,
      ).toBe(true);
    });

    it(`FR-FLOW-023 red :: AC-3 [${variant}] — Process B applies improvements and returns control, bounded by a 5/8 divergence guard`, () => {
      const text = srsText(variant);

      // Primary red driver: the A/B loop's Process B does not exist in kiwi-srs today.
      expect(
        PROCESS_B.test(text),
        `FR-FLOW-023 AC-3: ${variant} kiwi-srs must define Process B of the A/B verify/improve loop`,
      ).toBe(true);

      // Process B reads the improvements document and applies improvements to the SRS.
      const applies = windowsAround(text, PROCESS_B, 500).some(
        (w) => IMPROVEMENTS_DOC.test(w) && APPLY.test(w),
      );
      expect(
        applies,
        `FR-FLOW-023 AC-3: ${variant} Process B must read the improvements document and apply improvements to the SRS`,
      ).toBe(true);

      // Process B returns control to Process A.
      const returns = windowsAround(text, PROCESS_B, 500).some(
        (w) => RETURN_CONTROL.test(w) && PROCESS_A.test(w),
      );
      expect(
        returns,
        `FR-FLOW-023 AC-3: ${variant} Process B must return control to Process A`,
      ).toBe(true);

      // The loop is bounded by a maximum-iteration divergence guard, capped at 5 (normal) / 8
      // (--max) per plan OQ-023. Anchored on the net-new "divergence" token so the existing
      // "최대 5회" evaluation-loop wording cannot false-satisfy the cap.
      expect(
        DIVERGENCE.test(text),
        `FR-FLOW-023 AC-3: ${variant} the A/B loop must be bounded by a maximum-iteration divergence guard`,
      ).toBe(true);
      const cap = windowsAround(text, DIVERGENCE, 300).some(
        (w) => CAP_5_NORMAL.test(w) && CAP_8_MAX.test(w),
      );
      expect(
        cap,
        `FR-FLOW-023 AC-3: ${variant} the divergence guard must cap iterations at 5 (normal) / 8 (--max), bound to their modes`,
      ).toBe(true);
    });

    it(`FR-FLOW-023 red :: AC-4 [${variant}] — under --max Process A uses 3 verification subagents`, () => {
      const text = srsText(variant);

      // Under --max, Process A uses 3 verification subagents on the single-document baseline.
      const maxThree = windowsAround(text, PROCESS_A, 500).some(
        (w) => MAX_FLAG.test(w) && THREE_NEAR_SUBAGENT.test(w),
      );
      expect(
        maxThree,
        `FR-FLOW-023 AC-4: ${variant} must state that under --max Process A uses 3 verification subagents (single-document baseline)`,
      ).toBe(true);
    });

    it(`FR-FLOW-023 red :: AC-5 [${variant}] — multiple docs: non-max sequential per document, --max spawns (document count × 3)`, () => {
      const text = srsText(variant);

      // --max spawns (document count × 3) verification subagents for multiple documents. Anchored
      // on the net-new "document count" token.
      expect(
        DOC_COUNT.test(text),
        `FR-FLOW-023 AC-5: ${variant} must scale the --max fan-out by the research document count`,
      ).toBe(true);
      const maxFanout = windowsAround(text, DOC_COUNT, 300).some(
        (w) => TIMES_THREE.test(w) && MAX_FLAG.test(w),
      );
      expect(
        maxFanout,
        `FR-FLOW-023 AC-5: ${variant} must state --max spawns (document count × 3) verification subagents`,
      ).toBe(true);

      // Non-max mode spawns verification subagents sequentially, per document. Bound to a
      // subagent/spawn word (as AC-4 binds "3" to a subagent) so a stray "sequential ... document"
      // elsewhere cannot satisfy it. Anchored on the net-new research-document token -> genuinely red.
      const seqPerDoc = windowsAround(text, RESEARCH_DOC, 600).some(
        (w) => SEQUENTIAL.test(w) && PER_DOCUMENT.test(w) && SUBAGENT.test(w),
      );
      expect(
        seqPerDoc,
        `FR-FLOW-023 AC-5: ${variant} non-max mode must spawn verification subagents sequentially per document`,
      ).toBe(true);
    });
  }
});

// ============================================================================
// @req FR-FLOW-024
// FR-FLOW-024 — kiwi-srs no-research-document ambiguity resolution, unbounded
// qna loop, auto-decision on end, and requirement-gathering research.
//
// RED-phase content assertions (T-PH003-01). T-PH003-02 authors these in the
// MAIN SKILL.md of ALL THREE variants (skills/{claude,codex,etc}/kiwi-srs/SKILL.md,
// Phase 1.5 ~309-333) — NOT the codex/etc references/extended-workflow.md that
// srsText() reads for the FR-FLOW-023 A/B loop. Hence a dedicated srsSkillText()
// that reads the main SKILL.md for all three variants; reusing srsText() would
// read the wrong file for codex/etc and could never turn green.
//
// Every discriminating check is anchored on a NET-NEW token verified ABSENT from
// all three main SKILL.md today (auto-decision/자동결정 0, requirement-gathering/
// 요구사항수집 0, genuinely-non-standard 0, single-dash -qna 0, end-signal 0,
// unbounded-qna 0, FR-FLOW-025 0). Because windowsAround on an absent anchor
// returns [], each `.some(...)` is false today -> genuine red, no false-green.
// The claude main SKILL.md already carries the FR-FLOW-023 intake wording (an
// incidental "docs/research/foo.md" example at ~L539), so AC-4 is bound to the
// requirement-gathering + 3-subagent anchor so it stays red on that variant too.
// Bilingual (English mirror / Korean canonical) tokens validate all variants.

// T-PH003-02 authors FR-FLOW-024 in the MAIN SKILL.md of all three variants.
function srsSkillText(variant: Variant): string {
  return readFileSync(
    path.join(REPO_ROOT, "skills", variant, "kiwi-srs", "SKILL.md"),
    "utf8",
  );
}

// --- AC-1: no-research-document ambiguity, ask-only-non-standard, re-check ------
const AMBIGUITY = /ambiguit|모호/i;
// The no-research-document branch (distinct from the FR-FLOW-023 research intake).
const NO_RESEARCH_DOC =
  /no\s+research\s+doc(?:ument)?|without\s+(?:a\s+)?research\s+doc(?:ument)?|research\s+doc(?:ument)?[^\n]{0,24}(?:absent|not\s+provided)|리서치\s*문서[^\n]{0,10}(?:없|부재|미\s*제공)|연구\s*문서[^\n]{0,10}(?:없|부재|미\s*제공)/i;
// Ask ONLY about genuinely non-standard ambiguities that have no reasonable default.
const GENUINELY_NONSTANDARD =
  /genuinely\s+non[\s-]*standard|non[\s-]*standard\s+ambiguit|no\s+reasonable\s+default|reasonable\s+default|합리적(?:인)?\s*기본값|기본값(?:이)?\s*없|비표준(?:적)?[^\n]{0,6}모호/i;
// A user-supplied decision is itself re-examined for ambiguity and re-questioned.
const RECHECK_DECISION =
  /re[\s-]*(?:check|examine|examined|evaluat|question|questioned)[^\n]{0,48}(?:decision|answer|choice)|(?:decision|answer|choice)[^\n]{0,48}re[\s-]*(?:check|examine|evaluat|question)|(?:결정|답변|선택)[^\n]{0,24}(?:재검사|재질문|다시\s*질문|재평가)|(?:재검사|재질문|재평가|다시\s*질문)[^\n]{0,24}(?:결정|답변|선택)/i;

// --- AC-2: vague auto-trigger, unbounded qna, -qna force, --auto->committee -----
// The unbounded qna loop replaces the prior bounded 3/7-round QnA.
const UNBOUNDED_QNA =
  /unbounded\s+qna|무(?:한|제한)\s*(?:qna|질문)|qna[^\n]{0,20}(?:unbounded|무한|무제한)|(?:unbounded|무한|무제한)[^\n]{0,20}qna/i;
// A sufficiently vague request auto-activates the loop (game few-shot example).
const VAGUE = /vague|막연|불충분|모호|under[\s-]*specified/i;
const AUTO_ACTIVATE =
  /auto[\s-]*(?:activat|trigger|enter|engage)|자동\s*(?:활성|진입|트리거|발동)/i;
const GAME = /\bgame\b|게임/i;
// `-qna` single-dash force flag — net-new; excludes the old `--qna` alias,
// `auto-qna`, and `srs-qna` via a "no dash/word-char before" lookbehind.
const QNA_FORCE = /(?<![-\w])-qna\b/;
// Under --auto the interactive loop is suppressed and handed to the FR-FLOW-025 committee.
const FR_FLOW_025 = /FR-FLOW-025/;
const AUTO_FLAG = /--auto\b/;
const SUPPRESS = /suppress|억제|비활성|생략|무시|hand[\s-]*off|위임|이관|넘기/i;

// --- AC-3: non-auto loop ends on user end-signal -> auto-decide remaining -------
const END_SIGNAL =
  /end[\s-]*signal|signals?\s+(?:the\s+)?end|user\s+(?:signals?|indicates?|declares?)[^\n]{0,24}end|(?:종료|끝)(?:를|을)?\s*(?:신호|시그널|선언|지시|알림)|(?:종료|끝)[^\n]{0,10}(?:신호|선언)/i;
const AUTO_DECISION =
  /auto[\s-]*decision|auto[\s-]*decid|자동\s*(?:으로\s*)?결정|자동\s*의사\s*결정/i;
const REMAINING_AMBIG =
  /remaining[^\n]{0,24}ambiguit|unresolved[^\n]{0,24}ambiguit|(?:잔존|남은|나머지|미해결)[^\n]{0,10}모호/i;

// --- AC-4: 3 requirement-gathering research subagents -> docs/research/ -> loop --
const REQ_GATHERING =
  /requirement[\s-]*gather(?:ing)?|gather(?:ing)?\s+(?:the\s+)?requirement|요구(?:사항)?\s*수집|요구사항(?:을|를)?\s*(?:수집|모으)/i;
const DOCS_RESEARCH = /docs\/research/;
const SAVE_VERB = /save|saved|writ(?:e|es|ten)|저장|기록|생성|남기/i;
const ARCH_ALGO =
  /architect|아키텍처|algorithm|알고리즘|implementation\s+plan|구현\s*(?:계획|방안)/i;
const PROCEED_LOOP =
  /FR-FLOW-023|verify\/improve\s+loop|검증\/개선\s*루프|A\/B\s*(?:검증|루프)/i;

describe("FR-FLOW-024 — kiwi-srs no-research-document ambiguity, unbounded qna, auto-decision, requirement-gathering research", () => {
  for (const variant of VARIANTS) {
    it(`FR-FLOW-024 red :: AC-1 [${variant}] — no-research-document ambiguity: ask only genuinely non-standard, re-check decisions`, () => {
      const text = srsSkillText(variant);

      // Primary red driver: the no-research-document ambiguity branch is net-new.
      expect(
        NO_RESEARCH_DOC.test(text),
        `FR-FLOW-024 AC-1: ${variant} kiwi-srs must detect ambiguity when no research document is provided`,
      ).toBe(true);

      // It must ask ONLY about genuinely non-standard ambiguities with no reasonable default.
      const onlyNonStandard = windowsAround(text, NO_RESEARCH_DOC, 500).some(
        (w) => AMBIGUITY.test(w) && GENUINELY_NONSTANDARD.test(w),
      );
      expect(
        onlyNonStandard,
        `FR-FLOW-024 AC-1: ${variant} must question only genuinely non-standard ambiguities that have no reasonable default`,
      ).toBe(true);

      // A user-supplied decision is itself re-examined for ambiguity and re-questioned.
      expect(
        RECHECK_DECISION.test(text),
        `FR-FLOW-024 AC-1: ${variant} a user-supplied decision must be re-checked for ambiguity and re-questioned`,
      ).toBe(true);
    });

    it(`FR-FLOW-024 red :: AC-2 [${variant}] — vague-request auto-trigger, unbounded qna, -qna force, --auto suppresses to FR-FLOW-025 committee`, () => {
      const text = srsSkillText(variant);

      // The unbounded qna loop replaces the prior bounded 3/7-round QnA.
      expect(
        UNBOUNDED_QNA.test(text),
        `FR-FLOW-024 AC-2: ${variant} must define an unbounded qna loop (replacing the bounded QnA)`,
      ).toBe(true);

      // A sufficiently vague request (game few-shot example) auto-activates the loop.
      const vagueAuto = windowsAround(text, AUTO_ACTIVATE, 400).some(
        (w) => VAGUE.test(w) && GAME.test(w),
      );
      expect(
        vagueAuto,
        `FR-FLOW-024 AC-2: ${variant} a sufficiently vague request (e.g. a game) must auto-activate the qna loop`,
      ).toBe(true);

      // `-qna` (single dash) forces the loop — net-new, distinct from the old `--qna` alias.
      expect(
        QNA_FORCE.test(text),
        `FR-FLOW-024 AC-2: ${variant} \`-qna\` must force the qna loop`,
      ).toBe(true);

      // Under --auto the interactive loop is suppressed and handed to the FR-FLOW-025 committee.
      expect(
        FR_FLOW_025.test(text),
        `FR-FLOW-024 AC-2: ${variant} --auto must hand remaining ambiguities to the FR-FLOW-025 committee`,
      ).toBe(true);
      const autoSuppress = windowsAround(text, FR_FLOW_025, 400).some(
        (w) => AUTO_FLAG.test(w) && SUPPRESS.test(w),
      );
      expect(
        autoSuppress,
        `FR-FLOW-024 AC-2: ${variant} under --auto the interactive qna loop and \`-qna\` must be suppressed in favor of the FR-FLOW-025 committee`,
      ).toBe(true);
    });

    it(`FR-FLOW-024 red :: AC-3 [${variant}] — non-auto loop ends on user end-signal, then auto-decides remaining ambiguities`, () => {
      const text = srsSkillText(variant);

      // Primary red driver: auto-decision mode is net-new.
      expect(
        AUTO_DECISION.test(text),
        `FR-FLOW-024 AC-3: ${variant} must enter auto-decision mode for the remaining ambiguities`,
      ).toBe(true);

      // The trigger is an explicit user end-signal that ends the non-auto qna loop.
      const endThenDecide = windowsAround(text, AUTO_DECISION, 500).some((w) =>
        END_SIGNAL.test(w),
      );
      expect(
        endThenDecide,
        `FR-FLOW-024 AC-3: ${variant} auto-decision must be triggered by an explicit user end-signal ending the non-auto qna loop`,
      ).toBe(true);

      // Auto-decision applies specifically to the REMAINING unresolved ambiguities.
      const remaining = windowsAround(text, AUTO_DECISION, 500).some((w) =>
        REMAINING_AMBIG.test(w),
      );
      expect(
        remaining,
        `FR-FLOW-024 AC-3: ${variant} auto-decision must resolve the remaining unresolved ambiguities`,
      ).toBe(true);
    });

    it(`FR-FLOW-024 red :: AC-4 [${variant}] — 3 requirement-gathering research subagents -> docs/research/ -> FR-FLOW-023 loop`, () => {
      const text = srsSkillText(variant);

      // Primary red driver: requirement-gathering research is net-new (0 today).
      expect(
        REQ_GATHERING.test(text),
        `FR-FLOW-024 AC-4: ${variant} must spawn subagents that gather requirements and research an implementation approach`,
      ).toBe(true);

      // Exactly 3 subagents perform the requirement-gathering / research.
      const threeSubagents = windowsAround(text, REQ_GATHERING, 600).some((w) =>
        THREE_NEAR_SUBAGENT.test(w),
      );
      expect(
        threeSubagents,
        `FR-FLOW-024 AC-4: ${variant} must spawn 3 requirement-gathering research subagents`,
      ).toBe(true);

      // They research architecture/algorithms/impl-plan and SAVE the result under docs/research/.
      const savesResearch = windowsAround(text, REQ_GATHERING, 700).some(
        (w) => DOCS_RESEARCH.test(w) && SAVE_VERB.test(w) && ARCH_ALGO.test(w),
      );
      expect(
        savesResearch,
        `FR-FLOW-024 AC-4: ${variant} the research (architecture/algorithms/implementation plan) must be saved under docs/research/`,
      ).toBe(true);

      // Then it proceeds to the FR-FLOW-023 research-document verify/improve loop.
      const proceeds = windowsAround(text, REQ_GATHERING, 700).some((w) =>
        PROCEED_LOOP.test(w),
      );
      expect(
        proceeds,
        `FR-FLOW-024 AC-4: ${variant} must then proceed to the FR-FLOW-023 verify/improve loop`,
      ).toBe(true);
    });
  }
});
