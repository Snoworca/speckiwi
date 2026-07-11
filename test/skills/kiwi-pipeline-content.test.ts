import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// @req FR-FLOW-026
// FR-FLOW-026 — kiwi-pipeline end-to-end research-to-implementation cycle orchestration.
//
// RED-phase content assertions (T-PH003-03). These assert the FINAL desired state of the
// kiwi-pipeline SKILL.md and therefore FAIL until T-PH003-04 rewrites §1/§2/§6/§7 in all
// three variants to chain the full research -> plan -> implement cycle (conditional
// feasibility, --auto committee gating, --max propagation, research-doc passthrough).
//
// A SKILL.md is natural-language agent instruction, not executable code, so the AC behavior
// cannot be run in a unit test. These raw-text presence + ordering assertions verify the
// authored orchestration text for every packaged variant (FR-FLOW-014 kiwi-step precedent).
// Assertions are language-neutral: the claude/codex canonical text is largely Korean and the
// etc variant is English/Korean-mixed, so each check keys on technical tokens (skill names,
// flags, stability enum values) plus a bilingual (English / Korean) regex for prose concepts.

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const VARIANTS = ["claude", "codex", "etc"] as const;

function readSkill(variant: string): string {
  return readFileSync(path.join(REPO_ROOT, "skills", variant, "kiwi-pipeline", "SKILL.md"), "utf8");
}

/**
 * Body text with the leading YAML frontmatter block stripped. All assertions run against the
 * body so they verify the workflow prose, not the frontmatter `description` (which already
 * mentions kiwi-* skill names, --auto, and --run up front and would mask genuine red state).
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

// AC-1: the five stages are chained as an explicit arrow-connected sequence
// (kiwi-srs -> (conditional) feasibility -> planner -> pm -> review-fix-loop). Table T1 lists the
// same skill names in order but separated by `|` table cells and newlines, never as an arrow
// chain, so an arrow-connected sequence is absent today and CANNOT be satisfied merely by
// inserting a "cycle" keyword near the table — the green edit must actually author the chain. This
// structurally encodes AC-1's "chaining stages rather than stopping after a single next step".
const ARROW = String.raw`(?:-->|->|→|⟶|=>)`;
const CHAINED_FIVE_STAGES = new RegExp(
  String.raw`kiwi-srs(?!-)[\s\S]{0,80}${ARROW}[\s\S]{0,140}kiwi-srs-feasibility[\s\S]{0,140}${ARROW}[\s\S]{0,140}kiwi-planner[\s\S]{0,100}${ARROW}[\s\S]{0,100}kiwi-pm\b[\s\S]{0,100}${ARROW}[\s\S]{0,100}kiwi-review-fix-loop`,
);

// AC-2: conditional feasibility — run kiwi-srs-feasibility ONLY on draft stability / unverified
// implementability, otherwise skip. DRAFT keys on the language-neutral stability enum value.
const FEASIBILITY = /kiwi-srs-feasibility/;
const DRAFT = /\bdraft\b/i;
const IMPLEMENTABILITY = /implementability|구현\s*가능성|unverified|미검증/i;
const SKIP_CONDITION =
  /\bskip\b|생략|건너|otherwise|그렇지\s*않|아니면|conditional|조건부|only\s+when|only\s+if|일\s*때만|필요할\s*때|필요\s*시|when\s+needed/i;

// AC-3: under --auto every inter-stage gate is auto-decided by the decision committee and the
// cycle runs to the end, while NEEDS_USER/FAILED and critical gates still halt. COMMITTEE and
// RUN_TO_END wording are both absent from the current single-step advisor.
const AUTO_FLAG = /--auto\b/;
const COMMITTEE = /committee|위원회/i;
const RUN_TO_END =
  /to the end|끝까지|완주|entire cycle|whole cycle|전체\s*사이클|runs?\s+to\s+completion|end\s+of\s+the\s+cycle/i;
const HALT = /halt|중단|stop|멈춘/i;

// AC-4: --max propagates to every spawned sub-skill. The etc variant already mentions --max as a
// profile default, so mere token presence is not discriminating — the check ties --max to a
// propagation verb AND a sub-skill target, which the profile-default mention does not satisfy.
const MAX_FLAG = /--max\b/;
const PROPAGATE = /propagat|전파|전달|인계|forward(ed|s|ing)?\b/i;
const SUBSKILL =
  /sub-?skill|하위\s*스킬|자식\s*스킬|서브\s*스킬|every\s+(spawned\s+)?(sub-?skill|skill)|모든\s+.{0,14}스킬|spawned\s+skill/i;

// AC-5: a user-supplied research document is passed through to /kiwi-srs. Keys on "research
// document" (not the bare "research" inside the kiwi-srs-research skill name) tied to a
// passthrough verb and the kiwi-srs skill.
const RESEARCH_DOC =
  /research\s+document|research\s+doc\b|연구\s*문서|리서치\s*문서|research\s+report/i;
const SRS_SKILL = /kiwi-srs(?!-)/;
const PASSTHROUGH =
  /pass(ed|es|ing|-?through| through| to)?|passthrough|전달|넘겨|인계|건네|hand(ed|s)?\s*(off|through)|feed|공급|주입/i;

describe("FR-FLOW-026 — kiwi-pipeline end-to-end cycle orchestration", () => {
  for (const variant of VARIANTS) {
    describe(`variant: ${variant}`, () => {
      it("AC-1: chains kiwi-srs -> (conditional) feasibility -> planner -> pm -> review-fix-loop as a cycle", () => {
        const body = skillBody(readSkill(variant));
        // Require the five stages connected by arrows in order — Table T1's `|`-separated rows do
        // not form an arrow chain, so this cannot be satisfied by a shallow "cycle" keyword edit.
        expect(
          CHAINED_FIVE_STAGES.test(body),
          `FR-FLOW-026 AC-1: ${variant} kiwi-pipeline must chain kiwi-srs -> (conditional) kiwi-srs-feasibility -> kiwi-planner -> kiwi-pm -> kiwi-review-fix-loop as an end-to-end cycle, not just recommend a single next step`,
        ).toBe(true);
      });

      it("AC-2: runs feasibility only on draft stability / unverified implementability, else skips", () => {
        const body = skillBody(readSkill(variant));
        const conditional = windowsAround(body, FEASIBILITY, 280).some(
          (win) => (DRAFT.test(win) || IMPLEMENTABILITY.test(win)) && SKIP_CONDITION.test(win),
        );
        expect(
          conditional,
          `FR-FLOW-026 AC-2: ${variant} kiwi-pipeline must run kiwi-srs-feasibility ONLY when the just-authored requirements carry draft stability or unverified implementability, otherwise skipping the feasibility stage`,
        ).toBe(true);
      });

      it("AC-3: under --auto the committee auto-decides every gate and the cycle runs to the end, but NEEDS_USER/FAILED still halt", () => {
        const body = skillBody(readSkill(variant));
        // committee tied to the --auto gating (red driver: committee wording is absent today).
        const autoCommittee = windowsAround(body, COMMITTEE, 260).some(
          (win) => AUTO_FLAG.test(win) || /gate|게이트/i.test(win),
        );
        expect(
          autoCommittee,
          `FR-FLOW-026 AC-3: ${variant} kiwi-pipeline must, under --auto, auto-decide every inter-stage gate via the decision committee`,
        ).toBe(true);
        // Tie "runs to the end" to the --auto / committee context so a generic whole-pipeline
        // purpose sentence elsewhere cannot satisfy the run-to-completion clause.
        const runsToEnd = windowsAround(body, RUN_TO_END, 280).some(
          (win) => AUTO_FLAG.test(win) || COMMITTEE.test(win),
        );
        expect(
          runsToEnd,
          `FR-FLOW-026 AC-3: ${variant} kiwi-pipeline must state that under --auto the cycle runs to the end`,
        ).toBe(true);
        // Continuity: a sub-skill NEEDS_USER/FAILED must still halt (present today, must stay).
        const stillHalts = windowsAround(body, /NEEDS_USER|FAILED/, 200).some((win) =>
          HALT.test(win),
        );
        expect(
          stillHalts,
          `FR-FLOW-026 AC-3: ${variant} kiwi-pipeline must still halt on a sub-skill NEEDS_USER/FAILED even under --auto`,
        ).toBe(true);
      });

      it("AC-4: propagates --max to every spawned sub-skill", () => {
        const body = skillBody(readSkill(variant));
        const propagated = windowsAround(body, MAX_FLAG, 220).some(
          (win) => PROPAGATE.test(win) && SUBSKILL.test(win),
        );
        expect(
          propagated,
          `FR-FLOW-026 AC-4: ${variant} kiwi-pipeline must propagate --max to every spawned sub-skill (not merely mention --max as a profile default)`,
        ).toBe(true);
      });

      it("AC-5: passes a user-supplied research document through to /kiwi-srs", () => {
        const body = skillBody(readSkill(variant));
        const passed = windowsAround(body, RESEARCH_DOC, 260).some(
          (win) => SRS_SKILL.test(win) && PASSTHROUGH.test(win),
        );
        expect(
          passed,
          `FR-FLOW-026 AC-5: ${variant} kiwi-pipeline must pass a user-supplied research document through to /kiwi-srs`,
        ).toBe(true);
      });
    });
  }
});

// @req FR-FLOW-027
// FR-FLOW-027 — kiwi-pipeline worktree isolation with merge-or-PR completion gate.
//
// RED-phase content assertions (T-PH004-01). These assert the FINAL desired state of the
// kiwi-pipeline SKILL.md and therefore FAIL until T-PH004-02 adds the worktree isolation phases,
// the non-auto merge-or-PR completion gate, and the --auto auto-PR resolution (open a PR via
// kiwi-commit-auto-pr, never direct-merge the base branch) in all three variants.
//
// kiwi-pipeline has 0 worktree refs today; `kiwi-commit-auto-pr` appears only as a single T1
// decision-table row with no --wt / worktree / base-branch-safety wording nearby, so these
// windowed assertions cannot be satisfied by that pre-existing row. Same raw-text presence +
// proximity style as the FR-FLOW-026 block above (language-neutral tokens + bilingual regex).

// AC-1: a `--wt` argument OR a worktree-isolation request creates a dedicated git worktree and
// runs the cycle inside it. `worktree` is entirely absent today, so this is the red driver.
const WT_FLAG = /--wt\b/;
const WORKTREE = /worktree|워크\s*트리|work-?tree/i;
const WT_REQUEST =
  /worktree isolation|worktree\s*격리|워크트리\s*격리|worktree\s*request|worktree\s*요청|격리[를을]?\s*(요청|원하|지시|요구)/i;
const DEDICATED_CREATE = /dedicated|전용|separate|별도|creates?\b|create\s+a|생성|만든|만들/i;
// The "inside" cue is tied to the worktree referent so a bare Korean postposition (e.g. an
// unrelated "안에서" / "그 안") elsewhere in the window cannot satisfy it.
const RUN_INSIDE =
  /inside\s+(?:it|the\s+worktree|that\s+worktree)|within\s+the\s+worktree|(?:worktree|워크\s*트리)\s*(?:그\s*)?(?:안|내부?)(?:\s*에서)?/i;

// AC-2: on successful completion in interactive (non-auto) mode, kiwi-pipeline asks whether to
// merge the worktree branch or open a PR. No merge-or-PR gate exists today (`merge` absent). The
// non-auto qualifier is MANDATORY (not OR'd away) so this stays distinct from the AC-3 --auto path.
const INTERACTIVE_NONAUTO =
  /non-?auto|interactive|대화형|비-?auto|수동|사용자\s*게이트|--auto\s*(?:가\s*)?(?:미지정|없|아닌|아니|부재)/i;
// Both AC-2 and AC-3 require the resolution to happen "on (successful) completion" — a shared cue.
const COMPLETION = /completion|complet(?:e|ing)|완료|성공(?:적|\s*시)?|succe(?:ss|ssful|ed)|finish(?:ed|es)?/i;
const MERGE = /\bmerge\b|머지|병합/i;
const PR_TOKEN = /\bPR\b|pull request|풀\s*리퀘스트|풀리퀘/i;
const ASK = /\bask\b|묻|물어|질문|여부|선택하|고르|whether/i;

// AC-3: under --auto, open a PR (kiwi-commit-auto-pr) on completion and DO NOT direct-merge the
// base branch. base-branch/direct-merge wording is absent today, so the pre-existing table row
// (which carries neither --auto nor base-branch-safety text nearby) cannot satisfy this.
const AUTO_PR_SKILL = /kiwi-commit-auto-pr/;
// A bare affirmative "base branch" mention must NOT satisfy the prohibition, so the base-branch
// reference (BASE_BRANCH) and a negated-merge clause (NO_MERGE) are required together — a mention
// like "PR targeting the base branch" carries no negation and cannot pass.
const BASE_BRANCH = /base\s*branch|기반\s*브랜치|베이스\s*브랜치|base\s*브랜치/i;
const NO_MERGE =
  /(?:not|never|without|does\s+not|do\s+not|no\s+direct)\s*[\w-]*\s*(?:direct-?merge|merg\w+)|(?:direct-?merge|merg\w+)[\s\S]{0,20}?(?:not\s+allowed|forbidden|prohibited|disallowed)|직접(?:\s*(?:병합|머지))?[\s\S]{0,8}(?:하지\s*않|안\s*(?:함|하|됨|는다)|않(?:는다|음|고|기)|금지|없|말아)|(?:병합|머지)[\s\S]{0,8}(?:하지\s*않|않(?:는다|음)|금지|안\s*함)/i;

describe("FR-FLOW-027 — kiwi-pipeline worktree isolation with merge-or-PR completion gate", () => {
  for (const variant of VARIANTS) {
    describe(`variant: ${variant}`, () => {
      it("AC-1: --wt or a worktree-isolation request creates a dedicated git worktree and runs the cycle inside it", () => {
        const body = skillBody(readSkill(variant));
        // worktree wording tied to --wt / a worktree-isolation request AND a create-dedicated verb.
        const createsDedicated = windowsAround(body, WORKTREE, 300).some(
          (win) => (WT_FLAG.test(win) || WT_REQUEST.test(win)) && DEDICATED_CREATE.test(win),
        );
        expect(
          createsDedicated,
          `FR-FLOW-027 AC-1: ${variant} kiwi-pipeline must, under --wt or a worktree-isolation request, create a dedicated git worktree`,
        ).toBe(true);
        // The pipeline cycle must run inside the created worktree, not the current workspace.
        const runsInside = windowsAround(body, WORKTREE, 300).some((win) => RUN_INSIDE.test(win));
        expect(
          runsInside,
          `FR-FLOW-027 AC-1: ${variant} kiwi-pipeline must run the pipeline cycle inside the created worktree`,
        ).toBe(true);
      });

      it("AC-2: on successful completion in non-auto mode, asks whether to merge the worktree branch or open a PR", () => {
        const body = skillBody(readSkill(variant));
        // merge-or-PR gate: within one window around `merge`, require worktree + PR + an ask verb
        // + a mandatory non-auto qualifier + an on-completion cue. The whole gate is absent today.
        const asksMergeOrPr = windowsAround(body, MERGE, 340).some(
          (win) =>
            WORKTREE.test(win) &&
            PR_TOKEN.test(win) &&
            ASK.test(win) &&
            INTERACTIVE_NONAUTO.test(win) &&
            COMPLETION.test(win),
        );
        expect(
          asksMergeOrPr,
          `FR-FLOW-027 AC-2: ${variant} kiwi-pipeline must, on successful completion in interactive (non-auto) mode, ask whether to merge the worktree branch or open a PR`,
        ).toBe(true);
      });

      it("AC-3: under --auto opens a PR (kiwi-commit-auto-pr) on completion and does not direct-merge the base branch", () => {
        const body = skillBody(readSkill(variant));
        // Anchor on kiwi-commit-auto-pr (present as a T1 row today). Require --auto AND a base-branch
        // reference AND a negated-merge clause in the same window; that negated base-branch-safety
        // wording is absent today, so the pre-existing row cannot satisfy this (red until T-PH004-02).
        const autoOpensPr = windowsAround(body, AUTO_PR_SKILL, 340).some(
          (win) =>
            AUTO_FLAG.test(win) &&
            COMPLETION.test(win) &&
            BASE_BRANCH.test(win) &&
            NO_MERGE.test(win),
        );
        expect(
          autoOpensPr,
          `FR-FLOW-027 AC-3: ${variant} kiwi-pipeline must, under --auto, open a PR via kiwi-commit-auto-pr on completion and must not direct-merge the base branch`,
        ).toBe(true);
      });
    });
  }
});

// @req FR-FLOW-028
// FR-FLOW-028 — kiwi-pipeline GitHub issue entry mode with research-first flow.
//
// RED-phase content assertions (T-PH004-03). These assert the FINAL desired state of the
// kiwi-pipeline SKILL.md and therefore FAIL until T-PH004-04 adds a GitHub-issue entry mode to
// Phase 0 of all three variants: a supplied issue number runs kiwi-srs-research (for the
// resolution plus additional implementation-approach research) BEFORE kiwi-srs, escalates to
// `-qna` only when research is insufficient, suppresses `-qna` under --auto in favour of the
// FR-FLOW-025 committee, then continues through planner/pm/review-fix-loop.
//
// kiwi-pipeline has 0 `issue`/`이슈` and 0 `-qna` refs today and mentions kiwi-srs-research ONLY as
// a T1 decision-table feasibility follow-up (never tied to a GitHub-issue entry), so these
// windowed assertions cannot be satisfied by that pre-existing table row. Same raw-text presence +
// proximity style as the FR-FLOW-026/027 blocks above (language-neutral tokens + bilingual regex);
// reuses the module-level AUTO_FLAG, COMMITTEE, and SRS_SKILL constants declared earlier.

// AC-1: a supplied GitHub issue number is the entry cue. `issue`/`이슈` is entirely absent today,
// so an assertion anchored on the issue-entry cue has zero windows and fails (red driver).
const ISSUE_ENTRY =
  /github\s*issue|issue\s*(?:number|#|no\b)|이슈\s*(?:번호|넘버|#)|깃허브\s*이슈/i;
const SRS_RESEARCH = /kiwi-srs-research/;
// The AC-1 research has two angles: the issue RESOLUTION and the IMPLEMENTATION APPROACH (bilingual).
const RESOLUTION = /resolution|resolv(?:e|ing)|해결|해소/i;
const IMPL_APPROACH = /implementation[- ]?approach|구현\s*(?:접근|방법|방식|방안)/i;

// AC-2: escalate to -qna on insufficient research; under --auto suppress -qna and use the committee.
// `-qna` is entirely absent from kiwi-pipeline today (red driver).
const QNA = /-qna\b/;
const AMBIGUITY =
  /ambigu|모호|불충분|insufficient|불명확|미해결|unresolved|not\s+enough|충분하지\s*않/i;
const SUPPRESS =
  /suppress|억제|비활성|생략|없이|사용하지\s*않|미사용|\boff\b|skip|건너/i;

// AC-3: the issue-driven flow must continue through the standard planner/pm/review stages. These
// three skill names DO appear elsewhere (FR-FLOW-026 cycle), so the check is anchored on the
// issue-entry cue (absent today) to stay red AND to require the continuation to be authored in the
// issue-entry flow itself, not merely inherited from the pre-existing §6/§7 cycle text.
const PLANNER = /kiwi-planner/;
const PM = /kiwi-pm\b/;
const REVIEW = /kiwi-review-fix-loop/;
const CONTINUE =
  /continue|이어|계속|proceed|이후|그\s*(?:후|다음)|표준\s*사이클|standard\s+cycle|사이클로|then\b/i;

describe("FR-FLOW-028 — kiwi-pipeline GitHub issue entry mode with research-first flow", () => {
  for (const variant of VARIANTS) {
    describe(`variant: ${variant}`, () => {
      it("AC-1: a GitHub issue number runs kiwi-srs-research (resolution + implementation-approach) before kiwi-srs", () => {
        const body = skillBody(readSkill(variant));
        // Issue-entry cue tied to kiwi-srs-research AND BOTH research angles: the issue resolution
        // and the implementation approach (AC-1 requires the resolution research PLUS additional
        // implementation-approach research).
        const researchesFirst = windowsAround(body, ISSUE_ENTRY, 400).some(
          (win) => SRS_RESEARCH.test(win) && RESOLUTION.test(win) && IMPL_APPROACH.test(win),
        );
        expect(
          researchesFirst,
          `FR-FLOW-028 AC-1: ${variant} kiwi-pipeline must, on a supplied GitHub issue number, run /kiwi-srs-research to research the issue resolution plus the implementation approach`,
        ).toBe(true);
        // The issue-triggered research must run BEFORE /kiwi-srs is started. Assert genuine ORDER by
        // position (not merely the co-occurrence of an ordering word): within an issue-entry window
        // the research call must follow the issue cue, kiwi-srs-research must be the FIRST pipeline
        // step the issue triggers (NO bare /kiwi-srs start between the issue cue and the research
        // call), and a bare /kiwi-srs start must follow the research call. SRS_SKILL = /kiwi-srs(?!-)/
        // matches only a bare kiwi-srs start, never the kiwi-srs-research / kiwi-srs-feasibility
        // tokens, so within-clause reversed prose ("issue → run kiwi-srs, research after") is
        // rejected while the AC-2 -qna kiwi-srs mention (which legitimately follows research) does
        // not break it. (A bare kiwi-srs sitting BEFORE the issue cue is treated as unrelated
        // general-pipeline prose and intentionally not inspected, to avoid false-rejecting a faithful
        // implementation whose surrounding Phase-0 text mentions kiwi-srs.)
        const researchBeforeSrs = windowsAround(body, ISSUE_ENTRY, 400).some((win) => {
          const iIdx = win.search(ISSUE_ENTRY);
          const rIdx = win.search(SRS_RESEARCH);
          if (iIdx < 0 || rIdx < 0 || rIdx < iIdx) return false;
          const between = win.slice(iIdx, rIdx);
          const after = win.slice(rIdx + "kiwi-srs-research".length);
          return !SRS_SKILL.test(between) && SRS_SKILL.test(after);
        });
        expect(
          researchBeforeSrs,
          `FR-FLOW-028 AC-1: ${variant} kiwi-pipeline must run /kiwi-srs-research before starting /kiwi-srs (research-first order)`,
        ).toBe(true);
      });

      it("AC-2: escalates to -qna on insufficient research, but under --auto suppresses -qna and uses the committee", () => {
        const body = skillBody(readSkill(variant));
        // -qna escalation tied to an insufficient/ambiguous-research cue and the kiwi-srs start.
        const qnaOnAmbiguity = windowsAround(body, QNA, 320).some(
          (win) => AMBIGUITY.test(win) && SRS_SKILL.test(win),
        );
        expect(
          qnaOnAmbiguity,
          `FR-FLOW-028 AC-2: ${variant} kiwi-pipeline must start /kiwi-srs with -qna when research alone leaves the requirement ambiguous`,
        ).toBe(true);
        // Under --auto, -qna is suppressed and ambiguities are resolved via the FR-FLOW-025 committee.
        const autoSuppresses = windowsAround(body, QNA, 360).some(
          (win) => AUTO_FLAG.test(win) && SUPPRESS.test(win) && COMMITTEE.test(win),
        );
        expect(
          autoSuppresses,
          `FR-FLOW-028 AC-2: ${variant} kiwi-pipeline must, under --auto, suppress -qna and resolve ambiguities via the FR-FLOW-025 decision committee`,
        ).toBe(true);
      });

      it("AC-3: after the issue-driven research and authoring, the cycle continues through planner/pm/review-fix-loop", () => {
        const body = skillBody(readSkill(variant));
        // Anchored on the issue-entry cue so the continuation must be authored in the issue flow,
        // not merely inherited from the pre-existing FR-FLOW-026 cycle text elsewhere.
        const continuesCycle = windowsAround(body, ISSUE_ENTRY, 450).some(
          (win) => PLANNER.test(win) && PM.test(win) && REVIEW.test(win) && CONTINUE.test(win),
        );
        expect(
          continuesCycle,
          `FR-FLOW-028 AC-3: ${variant} kiwi-pipeline must, after the issue-driven research and authoring, continue through /kiwi-planner, /kiwi-pm, and /kiwi-review-fix-loop`,
        ).toBe(true);
      });
    });
  }
});
