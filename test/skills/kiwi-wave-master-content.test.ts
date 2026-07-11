import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// @req FR-FLOW-029
// FR-FLOW-029 — kiwi-wave-master multi-wave orchestrator with per-wave targets and resumable progress.
//
// RED-phase content assertions (T-PH005-01). These assert the FINAL desired state of the NET-NEW
// kiwi-wave-master SKILL.md and therefore FAIL until T-PH005-02 authors the skill in all three
// variants (plus registers it in the package-doctor entrypoint check). kiwi-wave-master does not
// exist yet, so `readWaveSkill` returns "" for a missing file and every content assertion fails as a
// clean AssertionError (matching the planned expected_failure_signature) rather than an ENOENT throw.
//
// A SKILL.md is natural-language agent instruction, not executable code, so the AC behavior cannot be
// run in a unit test. These raw-text presence + proximity assertions verify the authored orchestration
// text for every packaged variant (FR-FLOW-014 kiwi-step / FR-FLOW-026 kiwi-pipeline precedent).
// Assertions are language-neutral: the claude/codex canonical text is largely Korean and the etc
// variant is English/Korean-mixed, so each check keys on technical tokens (skill names, flags, file
// paths like waves.jsonl) plus a bilingual (English / Korean) regex for prose concepts.

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const VARIANTS = ["claude", "codex", "etc"] as const;

/** kiwi-wave-master is net-new; return "" when the SKILL.md does not exist so content assertions
 * fail as AssertionErrors (red driver) instead of throwing ENOENT. */
function readWaveSkill(variant: string): string {
  try {
    return readFileSync(path.join(REPO_ROOT, "skills", variant, "kiwi-wave-master", "SKILL.md"), "utf8");
  } catch {
    return "";
  }
}

/** The provider kiwi-pipeline SKILL.md already exists (FR-FLOW-026 / T-PH003-04); read it directly
 * for the AC-4 cross-file assertion that both sides of the 029->026 dependency are authored. */
function readPipelineSkill(variant: string): string {
  return readFileSync(path.join(REPO_ROOT, "skills", variant, "kiwi-pipeline", "SKILL.md"), "utf8");
}

/**
 * Body text with the leading YAML frontmatter block stripped. Content assertions run against the body
 * so they verify the workflow prose, not the frontmatter `description` (which mentions skill names and
 * flags up front and would mask genuine red state).
 */
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

// ---------------------------------------------------------------------------------------------------
// Shared tokens.
// ---------------------------------------------------------------------------------------------------
const WAVE = /wave/i;
// The dedicated per-wave target naming `wave-{n}` (or a concrete `wave-1`, `wave-2`). Entirely absent
// today (skill does not exist), so any assertion keyed on it is a red driver.
const WAVE_TARGET = /wave-\{?n\}?|wave-\d+/i;
const KIWI_SRS = /kiwi-srs(?!-)/; // bare kiwi-srs authoring skill, never kiwi-srs-research/-feasibility
const KIWI_PIPELINE = /kiwi-pipeline/;
const AUTO_FLAG = /--auto\b/;
const MAX_FLAG = /--max\b/;

// AC-1 heuristic: explicit wave structure (headers) in the document when present, OTHERWISE a subagent
// analyzes the document's overall flow to split waves.
const DECOMPOSE = /decompos|분해|나누|나눈|쪼갠|쪼개|split|분할/i;
const ORDERED = /order(ed|ing|s)?|순서|순차|정렬/i;
const HEADER_EXPLICIT =
  /header|헤더|제목|explicit\s+wave|명시(?:적|된|되어)?\s*(?:wave|웨이브|구조|섹션)|document\s+structure|문서\s*(?:구조|섹션)|섹션\s*구조/i;
const ELSE_BRANCH =
  /otherwise|그렇지\s*않|아니면|else\b|없(?:으면|을\s*때|는\s*경우)|부재\s*시|when\s+absent|absent|when\s+not\s+present/i;
const SUBAGENT = /sub-?agent|서브\s*에이전트|서브에이전트|하위\s*에이전트/i;
const ANALYZE_FLOW = /flow|흐름|overall\s+flow|전체\s*흐름|analyz|분석/i;

// AC-2: register a dedicated wave-{n} target via /kiwi-srs with an explicit work scope, bounded so
// downstream feasibility/planning/review stay within that wave and never look beyond it.
const TARGET_TOKEN = /target|타깃|타겟|대상/i;
const SCOPE = /scope|스코프|범위|작업\s*범위|work\s*scope/i;
const BOUNDED =
  /bound|한정|국한|제한|해당\s*wave|그\s*wave|do\s+not\s+look\s+beyond|look\s+beyond|beyond|넘어서지|벗어나지|넘어\s*보지|이상\s*보지/i;

// AC-3: persist wave progress to ./kiwi/waves.jsonl, mark a wave complete only after its run succeeds,
// resume from the first incomplete wave. `waves.jsonl` is absent today (red driver).
const WAVES_JSONL = /waves\.jsonl/i;
const MARK_COMPLETE = /complete|완료로?\s*(?:표시|기록|처리)|완료\s*(?:표시|기록|처리)|mark(?:ed|s)?\s+complete/i;
const ONLY_AFTER_SUCCESS =
  /only\s+after|after\s+[\s\S]{0,24}(?:finish|succe|complet)|성공(?:적으로)?\s*(?:끝|완료|종료|후|시)|완료(?:된|되어야|한\s*뒤)|끝난\s*(?:뒤|후|다음)/i;
const RESUME = /resume|재개|이어서|다시\s*시작|재시작/i;
const FIRST_INCOMPLETE =
  /first\s+incomplete|incomplete\s+wave|첫\s*(?:번째\s*)?(?:미완료|미완|incomplete)|미완료(?:된)?\s*(?:첫|wave)/i;

// AC-4: invoke /kiwi-pipeline per wave in registration order; the per-wave pipeline SKIPS re-authoring
// and enters at feasibility/planning because the up-front /kiwi-srs already authored the wave SRS.
const PER_WAVE_ORDER =
  /per[- ]wave|wave\s*별|각\s*wave|in\s+order|순서(?:대로|에\s*따라)?|순차|registration\s+order|등록\s*순서/i;
const SKIP_REAUTHOR =
  /skip-authoring|skip[\s\S]{0,16}(?:re-?author|authoring|재저작|재작성)|재저작(?:을)?\s*(?:건너|생략|하지\s*않)|재작성\s*(?:을)?\s*(?:건너|생략|없이|하지\s*않)|건너뛰고|생략하고|without\s+re-?author/i;
const FEASIBILITY_PLANNING = /feasibility|planning|planner|타당성|구현\s*가능성|계획|--from=/i;
// The provider entry kiwi-wave-master consumes (authored in kiwi-pipeline by T-PH003-04 / FR-FLOW-026).
const RESUME_FROM_STAGE = /skip-authoring|resume-from-stage/i;
const FROM_STAGE_FLAG = /--from=/;

// AC-5: under --auto run all waves autonomously to the end (per-wave pipeline safety gates still
// apply); under --max propagate --max to every wave's kiwi-pipeline and its sub-skills.
const ALL_WAVES_END =
  /all\s+waves|every\s+wave|모든\s*wave|전체\s*wave|끝까지|to\s+the\s+end|완주|autonomous(?:ly)?|자율(?:적으로)?|자동으로\s*(?:끝|완료|진행|끝까지)/i;
const SAFETY_GATE =
  /safety\s*gate|안전\s*게이트|safety\s*게이트|gate[\s\S]{0,24}(?:apply|still|적용|유효|여전)|(?:여전히|still)[\s\S]{0,24}(?:gate|게이트)/i;
const PROPAGATE = /propagat|전파|전달|인계|forward(ed|s|ing)?\b/i;
const SUBSKILL =
  /sub-?skill|하위\s*스킬|서브\s*스킬|자식\s*스킬/i;

describe("FR-FLOW-029 — kiwi-wave-master multi-wave orchestrator", () => {
  for (const variant of VARIANTS) {
    describe(`variant: ${variant}`, () => {
      it("AC-1: exists and decomposes docs into ordered waves (headers-first, else a subagent analyzes the flow)", () => {
        const text = readWaveSkill(variant);
        // Skill existence / registration: the net-new SKILL.md must declare name=kiwi-wave-master.
        expect(
          text,
          `FR-FLOW-029 AC-1: ${variant} kiwi-wave-master/SKILL.md must exist with frontmatter name=kiwi-wave-master`,
        ).toMatch(/^---[\s\S]*?\bname:\s*kiwi-wave-master\b[\s\S]*?---/m);

        const body = skillBody(text);
        // Decomposition of the research/plan documents into ORDERED waves.
        const decomposesOrdered = windowsAround(body, WAVE, 220).some(
          (win) => DECOMPOSE.test(win) && ORDERED.test(win),
        );
        expect(
          decomposesOrdered,
          `FR-FLOW-029 AC-1: ${variant} kiwi-wave-master must decompose the research/plan documents into ordered waves`,
        ).toBe(true);

        // Two-branch wave-split heuristic: explicit wave structure (headers) when present, OTHERWISE a
        // subagent analyzes the document's overall flow to split the waves.
        const headerFirst = HEADER_EXPLICIT.test(body);
        const elseSubagentFlow = windowsAround(body, SUBAGENT, 320).some(
          (win) => ELSE_BRANCH.test(win) && ANALYZE_FLOW.test(win),
        );
        expect(
          headerFirst && elseSubagentFlow,
          `FR-FLOW-029 AC-1: ${variant} kiwi-wave-master must use explicit wave structure (headers) when present, otherwise have a subagent analyze the document flow to split the waves`,
        ).toBe(true);
      });

      it("AC-2: registers a dedicated wave-{n} target via /kiwi-srs with an explicit scope bounded to the wave", () => {
        const body = skillBody(readWaveSkill(variant));
        // A dedicated per-wave target (wave-{n}) is registered through the bare kiwi-srs authoring skill
        // with an explicitly specified work scope.
        const registersScopedTarget = windowsAround(body, WAVE_TARGET, 340).some(
          (win) => KIWI_SRS.test(win) && TARGET_TOKEN.test(win) && SCOPE.test(win),
        );
        expect(
          registersScopedTarget,
          `FR-FLOW-029 AC-2: ${variant} kiwi-wave-master must register a dedicated wave-{n} target via /kiwi-srs with an explicitly specified work scope`,
        ).toBe(true);
        // The scope bounds downstream feasibility/planning/review to that wave (does not look beyond).
        const boundedToWave = windowsAround(body, SCOPE, 320).some((win) => BOUNDED.test(win));
        expect(
          boundedToWave,
          `FR-FLOW-029 AC-2: ${variant} kiwi-wave-master must bound the wave scope so downstream stages do not look beyond that wave`,
        ).toBe(true);
      });

      it("AC-3: persists to ./kiwi/waves.jsonl, marks complete only after success, resumes from first incomplete", () => {
        const body = skillBody(readWaveSkill(variant));
        // Progress is persisted to a waves.jsonl file (red driver: token absent today).
        expect(
          WAVES_JSONL.test(body),
          `FR-FLOW-029 AC-3: ${variant} kiwi-wave-master must persist wave progress to a JSONL file (e.g. ./kiwi/waves.jsonl)`,
        ).toBe(true);
        // A wave is marked complete ONLY after its execution finishes successfully.
        const completeOnlyAfterSuccess = windowsAround(body, WAVES_JSONL, 420).some(
          (win) => MARK_COMPLETE.test(win) && ONLY_AFTER_SUCCESS.test(win),
        );
        expect(
          completeOnlyAfterSuccess,
          `FR-FLOW-029 AC-3: ${variant} kiwi-wave-master must mark a wave complete only after its execution finishes successfully`,
        ).toBe(true);
        // A cleared/restarted session resumes from the first incomplete wave.
        const resumesFromFirstIncomplete = windowsAround(body, RESUME, 320).some((win) =>
          FIRST_INCOMPLETE.test(win),
        );
        expect(
          resumesFromFirstIncomplete,
          `FR-FLOW-029 AC-3: ${variant} kiwi-wave-master must resume from the first incomplete wave on a cleared/restarted session`,
        ).toBe(true);
      });

      it("AC-4: runs /kiwi-pipeline per wave in order skipping re-authoring, and the provider pipeline entry exists (cross-file)", () => {
        // Consumer side: kiwi-wave-master invokes /kiwi-pipeline per wave in order and the per-wave run
        // SKIPS re-authoring, entering at feasibility/planning (up-front /kiwi-srs already authored it).
        const waveBody = skillBody(readWaveSkill(variant));
        const perWavePipeline = windowsAround(waveBody, KIWI_PIPELINE, 340).some((win) =>
          PER_WAVE_ORDER.test(win),
        );
        expect(
          perWavePipeline,
          `FR-FLOW-029 AC-4: ${variant} kiwi-wave-master must invoke /kiwi-pipeline per wave in order`,
        ).toBe(true);
        const skipsReauthoring = windowsAround(waveBody, KIWI_PIPELINE, 420).some(
          (win) => SKIP_REAUTHOR.test(win) && FEASIBILITY_PLANNING.test(win),
        );
        expect(
          skipsReauthoring,
          `FR-FLOW-029 AC-4: ${variant} kiwi-wave-master per-wave /kiwi-pipeline must skip re-authoring and run from feasibility/planning through implementation`,
        ).toBe(true);

        // Provider side (cross-file): the kiwi-pipeline SKILL.md the consumer relies on must itself
        // carry the skip-authoring / resume-from-stage entry (FR-FLOW-026 / T-PH003-04, R-005), so the
        // 029->026 capability is proven on both sides.
        const pipeBody = skillBody(readPipelineSkill(variant));
        const providerHasEntry =
          RESUME_FROM_STAGE.test(pipeBody) && FROM_STAGE_FLAG.test(pipeBody) && FEASIBILITY_PLANNING.test(pipeBody);
        expect(
          providerHasEntry,
          `FR-FLOW-029 AC-4: ${variant} provider kiwi-pipeline SKILL.md must contain the skip-authoring / resume-from-stage (--from=) entry the wave-master consumes`,
        ).toBe(true);
      });

      it("AC-5: --auto runs all waves autonomously (gates still apply); --max propagates to every wave's pipeline and sub-skills", () => {
        const body = skillBody(readWaveSkill(variant));
        // Under --auto, all waves run autonomously to the end.
        const autoRunsAll = windowsAround(body, AUTO_FLAG, 320).some((win) => ALL_WAVES_END.test(win));
        expect(
          autoRunsAll,
          `FR-FLOW-029 AC-5: ${variant} kiwi-wave-master must, under --auto, run all waves autonomously to the end`,
        ).toBe(true);
        // Per-wave kiwi-pipeline safety gates still apply under --auto.
        const gatesStillApply = windowsAround(body, AUTO_FLAG, 340).some((win) => SAFETY_GATE.test(win));
        expect(
          gatesStillApply,
          `FR-FLOW-029 AC-5: ${variant} kiwi-wave-master must state that per-wave kiwi-pipeline safety gates still apply under --auto`,
        ).toBe(true);
        // Under --max, --max is propagated to every wave's kiwi-pipeline and its sub-skills.
        const maxPropagates = windowsAround(body, MAX_FLAG, 300).some(
          (win) => PROPAGATE.test(win) && SUBSKILL.test(win),
        );
        expect(
          maxPropagates,
          `FR-FLOW-029 AC-5: ${variant} kiwi-wave-master must propagate --max to every wave's kiwi-pipeline and its sub-skills`,
        ).toBe(true);
      });
    });
  }

  it("AC-1 doctor-registration: package-doctor.ts registers kiwi-wave-master in EXPECTED_KIWI_SKILLS", () => {
    // Raw-text assertion over the doctor source (FR-FLOW-014 kiwi-step precedent): the packed-skill-
    // entrypoints check derives its entrypoints from EXPECTED_KIWI_SKILLS, so kiwi-wave-master must be
    // registered there for the three skills/{codex,claude,etc}/kiwi-wave-master/SKILL.md entrypoints to
    // be covered. The array does NOT list kiwi-wave-master today (red driver).
    const doctorSrc = readFileSync(path.join(REPO_ROOT, "src", "doctor", "package-doctor.ts"), "utf8");
    const arrMatch = doctorSrc.match(/EXPECTED_KIWI_SKILLS\s*=\s*\[([\s\S]*?)\]/);
    expect(arrMatch, "package-doctor.ts must declare an EXPECTED_KIWI_SKILLS array").not.toBeNull();
    expect(
      /["']kiwi-wave-master["']/.test(arrMatch![1]),
      "FR-FLOW-029 AC-1: package-doctor.ts EXPECTED_KIWI_SKILLS must register kiwi-wave-master so the packed-skill-entrypoints doctor check covers the three kiwi-wave-master SKILL.md entrypoints",
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------------------------------
// @req FR-FLOW-030
// FR-FLOW-030 — kiwi-wave-master epic-issue entry mode (T-PH005-03, RED phase).
//
// These assert the FINAL desired state of the epic-issue entry-mode section and therefore FAIL against
// the current stub section (which only says "up-front wave-split 연구를 생략" and defers detail to a
// later task — it carries neither the "each wave still researches" semantics nor the OQ-030 structure-
// detection guard). They go green once T-PH005-04 fleshes out the section in all three variants. Like
// the FR-FLOW-029 block above these are raw-text, language-neutral (English / Korean) assertions, but
// scoped to the dedicated epic entry-mode section so the §1 input mention of an epic issue and the §2
// phase-flow block (which name waves.jsonl and kiwi-pipeline) cannot mask genuine red state.
//
// OQ-030 (RESOLVED 2026-07-10, 5-member research committee, high-confidence): the epic-research-skip
// (AC-3) is CONFIRMED only when the epic has extractable structure (task-list groups / >=2 linked
// sub-issues); when no extractable structure exists (free-form prose, <2 sub-issues, no partitionable
// task list) kiwi-wave-master FALLS BACK to FR-FLOW-029's wave-split subagent (no new component). AC-3
// therefore asserts BOTH branches: the structured research-skip branch AND the unstructured wave-split-
// subagent fallback branch.
// ---------------------------------------------------------------------------------------------------

/**
 * The dedicated epic-issue entry-mode section: from the heading that names an epic + an entry/mode
 * concept down to the next same-or-higher-level heading (or EOF). Scoping here keeps the §1 input
 * mention of an epic issue and the §2 phase-flow block — which already name waves.jsonl and
 * kiwi-pipeline — from false-greening the epic-mode assertions. Returns "" when no such section exists.
 */
function epicEntrySection(body: string): string {
  const lines = body.split("\n");
  const headingStart = /^#{2,}\s+(?=.*(?:epic|에픽))(?=.*(?:entry|mode|진입|모드))/i;
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    if (headingStart.test(lines[i])) {
      start = i;
      break;
    }
  }
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

// AC-1: extract ordered waves FROM the epic (its structure / task list / linked sub-issues) rather than
// analyzing a research/plan document.
const EPIC_ISSUE = /epic[- ]?issue|에픽\s*이슈|epic\b|에픽/i;
const EXTRACT = /extract|추출|derive|도출|가져오|끌어내/i;
const STRUCTURE = /structure|구조|본문/i;
const TASK_LIST = /task[- ]?list|태스크\s*리스트|작업\s*(?:목록|리스트)|체크리스트|checklist/i;
const SUB_ISSUE = /sub-?issue|하위\s*이슈|자식\s*이슈|linked\s*(?:sub-?)?issue|연결된?\s*(?:하위\s*)?이슈/i;
const INSTEAD_OF = /instead\s+of|rather\s+than|대신(?:에|하여)?|아니라|하지\s*않고|이\s*아닌/i;
const ANALYZE = /analyz|분석|해석/i;
const RESEARCH_PLAN_DOC =
  /research\s*(?:·|\/)?\s*plan|research\s+(?:or\s+)?plan|plan\s+document|research\s+document|연구\s*[·/]?\s*계획|계획\s*문서|연구\s*문서|로드맵\s*문서/i;

// AC-2: after extraction, proceed IDENTICALLY to the FR-FLOW-029 flow — scoped per-wave target
// registration, waves.jsonl progress, per-wave /kiwi-pipeline in order. (WAVE_TARGET / SCOPE /
// TARGET_TOKEN / WAVES_JSONL / KIWI_PIPELINE / PER_WAVE_ORDER are reused from the FR-FLOW-029 block.)
const IDENTICAL =
  /identical|동일(?:하게|한|히)?|same\s+(?:flow|as|way)|그대로|똑같이|equally|FR-FLOW-029/i;

// AC-3: only the up-front wave-split research analysis is skipped; each wave's /kiwi-pipeline still
// performs its own per-wave research. OQ-030 guard: structured epic -> research-skip + structure split;
// unstructured epic -> FR-FLOW-029 wave-split subagent fallback. (SUBAGENT / DECOMPOSE reused above.)
const SKIP = /skip|생략|건너뛰|건너\s*뛰/i;
const UPFRONT = /up-?front|사전|앞\s*단계|앞단|초기|선행|미리/i;
const WAVE_SPLIT =
  /wave-?split|웨이브\s*분할|wave\s*분할|분할\s*(?:연구|분석)|split[\s\S]{0,12}research|research[\s\S]{0,12}split/i;
const RESEARCH = /research|연구|조사|리서치/i;
// The distinguishing "each wave performs its OWN research" claim — an "own/self" qualifier bound
// directly to a research verb, deliberately WITHOUT bare `연구`/`research` or the per-wave / 각 wave
// vocabulary, so neither AC-2's machinery nor the up-front-skip sentence's `연구` token can satisfy it.
const OWN_RESEARCH = /(?:자체|각자|고유|나름|own|its\s+own)\S{0,4}\s*(?:연구|조사|리서치|research)/i;
const HAS_STRUCTURE_COND =
  /추출\s*가능한?\s*구조|구조(?:가|를)?\s*있|has\s+(?:extractable\s+)?structure|extractable\s+structure|when\s+structured|task-?list\s+group|태스크\s*리스트\s*그룹|(?:>=?\s*2|2\s*개?\s*이상|둘\s*이상)\s*(?:linked\s*)?(?:sub-?issue|하위\s*이슈|연결)/i;
const NO_STRUCTURE =
  /구조가?\s*없|no\s+(?:extractable\s+)?structure|not\s+.{0,20}structure|\bunstructured\b|free-?form|자유\s*형식|비정형|\bprose\b|프로즈|(?:<\s*2|2\s*개?\s*미만|둘\s*미만)\s*(?:linked\s*)?(?:sub-?issue|하위\s*이슈)|나눌\s*수\s*없|분할\s*불가|(?:\bno\b|\bnot\b|cannot|can'?t|unable|non)[\s\S]{0,12}partition/i;
const FALLBACK =
  /fall\s*back|fallback|폴백|되돌아가|기존\s*(?:방식|흐름|029|FR-FLOW-029|wave-?split)|FR-FLOW-029\s*(?:의)?\s*(?:wave-?split|서브\s*에이전트|서브에이전트|흐름)/i;

describe("FR-FLOW-030 — kiwi-wave-master epic-issue entry mode", () => {
  for (const variant of VARIANTS) {
    describe(`variant: ${variant}`, () => {
      it("AC-1: extracts ordered waves from the epic (structure/task-list/linked sub-issues) rather than analyzing a research/plan doc", () => {
        const sec = epicEntrySection(skillBody(readWaveSkill(variant)));
        expect(
          sec !== "",
          `FR-FLOW-030 AC-1: ${variant} kiwi-wave-master must have a discoverable epic-issue entry-mode section`,
        ).toBe(true);
        // Epic-issue driven and extracts an ORDERED set of waves — as a co-located claim, not two
        // tokens scattered across unrelated sentences.
        const extractsOrdered = windowsAround(sec, EPIC_ISSUE, 320).some(
          (win) => EXTRACT.test(win) && ORDERED.test(win),
        );
        expect(
          extractsOrdered,
          `FR-FLOW-030 AC-1: ${variant} epic entry mode must extract an ordered set of waves from the epic issue`,
        ).toBe(true);
        // The three epic-derived wave sources are named together: structure, task list, linked sub-issues.
        const namesThreeSources = windowsAround(sec, SUB_ISSUE, 260).some(
          (win) => STRUCTURE.test(win) && TASK_LIST.test(win),
        );
        expect(
          namesThreeSources,
          `FR-FLOW-030 AC-1: ${variant} epic entry mode must derive waves from the epic's structure, task list, or linked sub-issues`,
        ).toBe(true);
        // RED driver: the waves come FROM the epic RATHER THAN by analyzing a research/plan document —
        // the contrast must be a single co-located clause (anchored on the analyze token, absent today).
        const notResearchPlanDoc = windowsAround(sec, ANALYZE, 260).some(
          (win) => INSTEAD_OF.test(win) && RESEARCH_PLAN_DOC.test(win),
        );
        expect(
          notResearchPlanDoc,
          `FR-FLOW-030 AC-1: ${variant} epic entry mode must state it extracts waves from the epic rather than analyzing a research/plan document`,
        ).toBe(true);
      });

      it("AC-2: after extraction proceeds identically to FR-FLOW-029 (scoped wave-{n} target, waves.jsonl, per-wave /kiwi-pipeline in order)", () => {
        const sec = epicEntrySection(skillBody(readWaveSkill(variant)));
        // Frames the post-extraction flow as identical to the FR-FLOW-029 flow, co-located with the
        // reused machinery so the "identical" claim actually references that machinery (not dead weight).
        const identicalToFlow = windowsAround(sec, IDENTICAL, 320).some(
          (win) =>
            WAVE_TARGET.test(win) || WAVES_JSONL.test(win) || KIWI_PIPELINE.test(win) || /FR-FLOW-029/.test(win),
        );
        expect(
          identicalToFlow,
          `FR-FLOW-030 AC-2: ${variant} epic entry mode must state that after extraction it proceeds identically to the FR-FLOW-029 flow (referencing the reused scoped-target / waves.jsonl / per-wave pipeline machinery)`,
        ).toBe(true);
        // RED driver: names the reused scoped per-wave target registration within the epic section.
        expect(
          WAVE_TARGET.test(sec) && (SCOPE.test(sec) || TARGET_TOKEN.test(sec)),
          `FR-FLOW-030 AC-2: ${variant} epic entry mode must register a scoped per-wave wave-{n} target (reusing the FR-FLOW-029 machinery)`,
        ).toBe(true);
        // RED driver: names waves.jsonl progress tracking within the epic section.
        expect(
          WAVES_JSONL.test(sec),
          `FR-FLOW-030 AC-2: ${variant} epic entry mode must track wave progress in waves.jsonl`,
        ).toBe(true);
        // RED driver: names per-wave /kiwi-pipeline execution in order within the epic section.
        expect(
          KIWI_PIPELINE.test(sec) && PER_WAVE_ORDER.test(sec),
          `FR-FLOW-030 AC-2: ${variant} epic entry mode must run a per-wave /kiwi-pipeline in order`,
        ).toBe(true);
      });

      it("AC-3: only the up-front wave-split research is skipped and each wave still researches; OQ-030 structure guard (structured->skip / unstructured->wave-split subagent fallback)", () => {
        const sec = epicEntrySection(skillBody(readWaveSkill(variant)));
        // The skipped work is scoped to the UP-FRONT wave-split research analysis.
        expect(
          SKIP.test(sec) && UPFRONT.test(sec) && WAVE_SPLIT.test(sec) && RESEARCH.test(sec),
          `FR-FLOW-030 AC-3: ${variant} epic entry mode must skip only the up-front wave-split research analysis`,
        ).toBe(true);
        // RED driver: each wave's own /kiwi-pipeline STILL performs its OWN per-wave research. An
        // "own/self + research" collocation must appear near a /kiwi-pipeline mention, so neither AC-2's
        // "per-wave pipeline in order" machinery vocabulary nor the up-front-skip sentence's bare `연구`
        // token can satisfy it.
        const eachWaveStillResearches = windowsAround(sec, KIWI_PIPELINE, 260).some((win) =>
          OWN_RESEARCH.test(win),
        );
        expect(
          eachWaveStillResearches,
          `FR-FLOW-030 AC-3: ${variant} epic entry mode must state each wave's /kiwi-pipeline still performs its own per-wave research`,
        ).toBe(true);
        // RED driver (OQ-030 branch a): a structured epic (task-list groups / >=2 linked sub-issues)
        // confirms the research-skip and splits the waves from that structure.
        expect(
          HAS_STRUCTURE_COND.test(sec) && SKIP.test(sec) && DECOMPOSE.test(sec),
          `FR-FLOW-030 AC-3 (OQ-030 guard): ${variant} epic entry mode must skip the up-front research and split waves from the epic structure only when the epic has extractable structure (task-list groups / >=2 linked sub-issues)`,
        ).toBe(true);
        // RED driver (OQ-030 branch b): an unstructured epic falls back to the FR-FLOW-029 wave-split
        // subagent (no new component).
        expect(
          NO_STRUCTURE.test(sec) &&
            FALLBACK.test(sec) &&
            (SUBAGENT.test(sec) || /wave-?split|웨이브\s*분할|FR-FLOW-029/i.test(sec)),
          `FR-FLOW-030 AC-3 (OQ-030 guard): ${variant} epic entry mode must fall back to FR-FLOW-029's wave-split subagent when the epic has no extractable structure`,
        ).toBe(true);
      });
    });
  }
});
