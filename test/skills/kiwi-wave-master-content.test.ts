import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { readResolvedSkill } from "../support/resolved-skill.js";
import { readRepoFile } from "./kiwi-renderings.js";
import { at } from "../support/at.js";

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
 * fail as AssertionErrors (red driver) instead of throwing ENOENT.
 * @req FR-FLOW-110 — resolved through the shared reader, so rules extracted into `_shared/kiwi/`
 * modules the §0 table references are still in scope for every assertion below. */
function readWaveSkill(variant: string): string {
  return readResolvedSkill(variant, "kiwi-wave-master");
}

/**
 * Body text with the leading YAML frontmatter block stripped. Content assertions run against the body
 * so they verify the workflow prose, not the frontmatter `description` (which mentions skill names and
 * flags up front and would mask genuine red state).
 */
function skillBody(text: string): string {
  return text.replace(/^---[\s\S]*?\n---\s*\n?/, "");
}

/** A `## N.` section of the skill's own body, from its heading to the next level-1/2 heading. */
function h2Section(body: string, heading: RegExp): string {
  const lines = body.split("\n");
  const start = lines.findIndex((line) => heading.test(line));
  if (start === -1) return "";
  const stop = lines.findIndex((line, i) => i > start && /^#{1,2}\s/.test(line));
  return lines.slice(start, stop === -1 ? lines.length : stop).join("\n");
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
const KIWI_PIPELINE = /kiwi-pipeline/;
const AUTO_FLAG = /--auto\b/;
const MAX_FLAG = /--max\b/;

// AC-3: persist wave progress to ./kiwi/waves.jsonl, mark a wave complete only after its run succeeds,
// resume from the first incomplete wave. `waves.jsonl` is absent today (red driver).
const WAVES_JSONL = /waves\.jsonl/i;
const MARK_COMPLETE = /complete|완료로?\s*(?:표시|기록|처리)|완료\s*(?:표시|기록|처리)|mark(?:ed|s)?\s+complete/i;
const ONLY_AFTER_SUCCESS =
  /only\s+after|after\s+[\s\S]{0,24}(?:finish|succe|complet)|성공(?:적으로)?\s*(?:끝|완료|종료|후|시)|완료(?:된|되어야|한\s*뒤)|끝난\s*(?:뒤|후|다음)/i;
const RESUME = /resume|재개|이어서|다시\s*시작|재시작/i;
const FIRST_INCOMPLETE =
  /first\s+incomplete|incomplete\s+wave|첫\s*(?:번째\s*)?(?:미완료|미완|incomplete)|미완료(?:된)?\s*(?:첫|wave)/i;

// AC-5: under --auto run all waves autonomously to the end (per-wave pipeline safety gates still
// apply); under --max propagate --max to the sub-skills every wave runs (FR-FLOW-029 AC-5, revised in 4.0.0).
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
      // FR-FLOW-029 AC-1 (heading decomposition) and AC-2 (per-wave targets) expired 2026-11-05 naming
      // FR-FLOW-212; their replacement is pinned in wave-srs-first.fr-flow-212.test.ts.
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

      it("FR-FLOW-029 AC-4: runs its waves through the shared parallel-waves contract, never a per-wave /kiwi-pipeline, and never re-runs the host-serial /kiwi-srs authoring", () => {
        // Revised in 4.0.0 (FR-FLOW-188 AC-7): the per-wave /kiwi-pipeline delegation and the provider
        // skip-authoring entry it consumed are gone, so the cross-file provider check left with them.
        const waveBody = skillBody(readWaveSkill(variant));
        const stage = h2Section(waveBody, /^##\s+5\.\s/);
        expect(stage, `FR-FLOW-029 AC-4: ${variant} kiwi-wave-master must keep its §5 stage-execution section`).not.toBe("");
        expect(
          /_shared\/kiwi\/parallel-waves\.md/.test(stage),
          `FR-FLOW-029 AC-4: ${variant} §5 must run the waves through _shared/kiwi/parallel-waves.md`,
        ).toBe(true);
        // Every kiwi-pipeline mention left in §5 is the refusal to delegate to it, and that refusal exists.
        const pipelineLines = stage.split("\n").filter((line) => KIWI_PIPELINE.test(line));
        expect(pipelineLines.length, `FR-FLOW-029 AC-4: ${variant} §5 must state that it does not delegate to /kiwi-pipeline`).toBeGreaterThan(0);
        for (const line of pipelineLines) {
          expect(
            /위임하지 않는다|does not delegate/.test(line),
            `FR-FLOW-029 AC-4: ${variant} §5 still hands a wave to /kiwi-pipeline: ${line}`,
          ).toBe(true);
        }
        // Rewritten 2026-11-05 with FR-FLOW-212 AC-3: the SRS is authored once, before decomposition
        // (§3), and the stage's only authoring is the incremental call over worker deltas (§4, PW-1).
        const authoring = h2Section(waveBody, /^##\s+3\.\s/);
        expect(
          /wave-srs-registration\.md §1/.test(authoring),
          `FR-FLOW-029 AC-4: ${variant} §3 must author the SRS once through wave-srs-registration.md §1`,
        ).toBe(true);
        const incremental = h2Section(waveBody, /^##\s+4\.\s/);
        expect(
          /stage 는 SRS 를 처음부터 저작하지 않는다/.test(incremental) && /PW-1/.test(incremental) && /§2 의 호출 하나로/.test(incremental),
          `FR-FLOW-029 AC-4: ${variant} §4 must limit a stage to the one incremental PW-1 call`,
        ).toBe(true);
        // SDS authoring and the workers never re-run that authoring; only the incremental delta authoring,
        // the incremental /kiwi-srs re-entry and the SDS close-out clarification stay sanctioned SRS writes.
        const noRerun = stage.split("\n").find((line) => /SDS 작성과 워커는/.test(line)) ?? "";
        expect(noRerun, `FR-FLOW-029 AC-4: ${variant} §5 must state that SDS authoring and the workers do not re-author`).not.toBe("");
        expect(
          /저작은 §3 에서 한 번 끝났다/.test(noRerun) && /다시 돌리지 않는다/.test(noRerun),
          `FR-FLOW-029 AC-4: ${variant} the no-re-authoring rule must bind SDS authoring and the workers`,
        ).toBe(true);
        expect(
          /§4 의 델타 증분 저작/.test(noRerun) && /증분 `[/$]kiwi-srs` 재진입/.test(noRerun) && /SDS close-out/.test(noRerun),
          `FR-FLOW-029 AC-4: ${variant} the rule must keep the delta authoring, the incremental /kiwi-srs re-entry and the SDS close-out clarification sanctioned`,
        ).toBe(true);
      });

      it("FR-FLOW-029 AC-5: --auto runs all waves autonomously (child safety gates still apply); --max propagates to the sub-skills every wave runs", () => {
        const body = skillBody(readWaveSkill(variant));
        // Under --auto, all waves run autonomously to the end.
        const autoRunsAll = windowsAround(body, AUTO_FLAG, 320).some((win) => ALL_WAVES_END.test(win));
        expect(
          autoRunsAll,
          `FR-FLOW-029 AC-5: ${variant} kiwi-wave-master must, under --auto, run all waves autonomously to the end`,
        ).toBe(true);
        // The safety gates of the children each wave runs still apply under --auto.
        const gatesStillApply = windowsAround(body, AUTO_FLAG, 340).some((win) => SAFETY_GATE.test(win));
        expect(
          gatesStillApply,
          `FR-FLOW-029 AC-5: ${variant} kiwi-wave-master must state that the safety gates of the children each wave runs still apply under --auto`,
        ).toBe(true);
        // Under --max, --max is propagated to the sub-skills every wave runs.
        const maxPropagates = windowsAround(body, MAX_FLAG, 300).some(
          (win) => PROPAGATE.test(win) && SUBSKILL.test(win),
        );
        expect(
          maxPropagates,
          `FR-FLOW-029 AC-5: ${variant} kiwi-wave-master must propagate --max to the sub-skills every wave runs`,
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
      /["']kiwi-wave-master["']/.test(at(arrMatch!, 1)),
      "FR-FLOW-029 AC-1: package-doctor.ts EXPECTED_KIWI_SKILLS must register kiwi-wave-master so the packed-skill-entrypoints doctor check covers the three kiwi-wave-master SKILL.md entrypoints",
    ).toBe(true);
  });
});

// FR-FLOW-030 (epic waves extracted from the epic) is discarded, superseded by FR-FLOW-214, whose
// contract is pinned in epic-through-prd.fr-flow-214.test.ts.

// @req FR-FLOW-042 FR-FLOW-043
// FR-FLOW-042 — kiwi-wave-master run-root preflight gate.
// FR-FLOW-043 AC-5/AC-7 — the halt-emit contract that the gate hands to the event journals.
//
// RED-phase content assertions. Same raw-text + proximity technique as the FR-FLOW-029/030 blocks
// above: a SKILL.md is agent instruction, not executable code, so the AC behavior is verified as an
// authored contract in every packaged variant. Checks key on technical tokens (workspaceRoot,
// `git rev-parse --show-toplevel`, --auto, --wt, waves.jsonl, pipeline.jsonl, FAILED) plus bilingual
// regexes, because the claude/codex bodies are Korean and the etc variant is English/Korean-mixed.

const WORKSPACE_ROOT_TOKEN = /workspaceRoot|mcp_workspace_info/;
const GIT_ROOT_TOKEN = /git rev-parse --show-toplevel/;
const HALT = /중단|halt|멈춘다|정지/i;
const CRITICAL = /critical|치명|필수 중단/i;
const NO_BYPASS = /우회(할 수 없|하지 못|.{0,6}불가)|not bypass|cannot bypass|무관하게 중단/i;
const NO_MUTATION = /mutation\s*0|0\s*건|어떤 SRS[^\n]*(변경|기록)하지 않|no SRS mutation|zero SRS mutation/i;
const NO_SPAWN = /spawn 하지 않|자식[^\n]*(호출|spawn)하지 않|no child|spawns? no/i;
const SINGLE_ROOT_RECOVERY = /git switch|단일 root|single root|브랜치를? 전환/i;
const NEW_SESSION_RECOVERY = /새 (세션|agent 세션)|new (agent )?session|세션을 새로/i;
const NO_NEW_REQ_ID = /신규 Requirement ID|new Requirement ID|신규 REQ ID/i;
const HOST_SPEC_UNEDITABLE = /docs\/spec/;
const CLI_NOT_FALLBACK = /CLI[^\n]*(폴백|fallback)[^\n]*(아니|않|not)|(폴백|fallback)[^\n]*CLI[^\n]*(아니|않|not)|CLI 를? 폴백으로 쓰지/i;

/**
 * The dedicated run-root preflight section: from its heading down to the next same-or-higher-level
 * heading (or EOF). Scoping the gate assertions here keeps §2's phase-flow block and §8's epic entry
 * mode from false-greening checks that must live inside the gate itself. Returns "" when absent.
 */
function preflightSection(body: string): string {
  const lines = body.split("\n");
  const start = lines.findIndex((line) => /^#{2,4}\s.*(?:preflight|사전 점검|사전 검사)/i.test(line));
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

/** The §2 phase-flow fenced block (the one that lists the wave-decomposition phase). */
function phaseFlowBlock(body: string): string {
  const fences = body.split("```");
  for (let i = 1; i < fences.length; i += 2) {
    if (/Wave 분해|wave decompos/i.test(at(fences, i))) return at(fences, i);
  }
  return "";
}

/** The `## 9` pipeline-emit section (heading names emit), down to the next same-or-higher heading. */
function emitSection(body: string): string {
  const lines = body.split("\n");
  const start = lines.findIndex((line) => /^#{2,4}\s.*emit/i.test(line));
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
 * The bullet block that immediately follows the "중단 출력에는 …" lead-in — i.e. the halt OUTPUT
 * contract itself. Anchoring here stops the neighbouring `--wt` paragraph (which restates the same two
 * recovery paths) from keeping AC-3 green when a bullet is deleted.
 */
function haltOutputBullets(section: string): string {
  const lines = section.split("\n");
  const lead = lines.findIndex((line) => /중단 출력에는|halt output/i.test(line));
  if (lead === -1) return "";
  const out: string[] = [];
  for (let i = lead + 1; i < lines.length; i++) {
    if (/^\s*[-*]\s/.test(at(lines, i))) {
      out.push(at(lines, i));
      continue;
    }
    if (out.length === 0 && at(lines, i).trim() === "") continue;
    break;
  }
  return out.join("\n");
}

// FR-FLOW-042 AC-1 path-normalization rules. `git rev-parse --show-toplevel` returns `C:/Work/...`
// while `mcp_workspace_info.workspaceRoot` returns `C:\Work\...` (path.resolve), so a raw string
// compare halts every Windows run. The gate must spell out how both values are normalized first.
const NORM_SEPARATOR = /구분자[^\n]*(?:`\/`|슬래시|통일)|separator[^\n]*(?:forward|`\/`)/i;
const NORM_TRAILING = /후행[^\n]*(?:구분자|슬래시)|trailing\s*(?:slash|separator|구분자)/i;
const NORM_CASE = /대소문자[^\n]*(?:무시|구분하지)|case-?insensitiv/i;
const NORM_REALPATH = /realpath|심볼릭\s*링크|symlink/i;

describe("FR-FLOW-042 / FR-FLOW-043 — run-root preflight gate and halt-emit contract", () => {
  for (const variant of VARIANTS) {
    describe(`${variant} variant`, () => {
      it("AC-1: compares the MCP workspace root with the run git root before any wave work", () => {
        const body = skillBody(readWaveSkill(variant));
        expect(WORKSPACE_ROOT_TOKEN.test(body), `${variant}: gate must read mcp_workspace_info.workspaceRoot`).toBe(true);
        expect(GIT_ROOT_TOKEN.test(body), `${variant}: gate must resolve the run git root`).toBe(true);
        const near = windowsAround(body, WORKSPACE_ROOT_TOKEN, 500);
        expect(
          near.some((w) => GIT_ROOT_TOKEN.test(w)),
          `${variant}: workspaceRoot and git rev-parse --show-toplevel must be compared together`,
        ).toBe(true);
        expect(
          // `Phase 0` is deliberately NOT accepted as a preflight marker: the AC-1/AC-5 phase-flow test
          // below forbids the preflight step from reusing that label, so allowing it here would admit
          // exactly the regression its sibling assertion bans.
          near.some((w) => /preflight|사전 점검|사전 검사/i.test(w)),
          `${variant}: the comparison must be stated as a preflight, before wave decomposition`,
        ).toBe(true);
      });

      it("AC-1: normalizes both paths before comparing them, with a concrete before/after example", () => {
        const sec = preflightSection(skillBody(readWaveSkill(variant)));
        expect(sec !== "", `${variant}: the run-root preflight gate must be a discoverable section`).toBe(true);
        // Without an explicit normalization rule the two producers disagree on Windows
        // (`C:\Work\...` vs `C:/Work/...`) and the gate halts every legitimate run.
        expect(NORM_SEPARATOR.test(sec), `${variant}: the gate must normalize path separators to /`).toBe(true);
        expect(NORM_TRAILING.test(sec), `${variant}: the gate must drop a trailing separator`).toBe(true);
        expect(
          NORM_CASE.test(sec),
          `${variant}: the gate must compare case-insensitively on Windows (drive letter included)`,
        ).toBe(true);
        expect(
          NORM_REALPATH.test(sec),
          `${variant}: the gate must resolve symlinks via realpath before comparing when possible`,
        ).toBe(true);
        // A single line carrying both the backslash and the forward-slash form of a drive path, plus a
        // normalization word: the required before/after example.
        expect(
          sec.split("\n").some((line) => /[A-Za-z]:\\/.test(line) && /[A-Za-z]:\//.test(line) && /정규화|normaliz/i.test(line)),
          `${variant}: the gate must carry a one-line before/after normalization example`,
        ).toBe(true);
      });

      it("AC-1/AC-5: the phase flow lists the preflight as a distinct step ahead of the journal-path phase", () => {
        const body = skillBody(readWaveSkill(variant));
        const flow = phaseFlowBlock(body);
        expect(flow !== "", `${variant}: the skill must keep its phase-flow block`).toBe(true);
        const preflightLine = flow.split("\n").find((line) => /preflight|사전 점검|사전 검사/i.test(line)) ?? "";
        expect(preflightLine !== "", `${variant}: the phase-flow block must list the run-root preflight`).toBe(true);
        // Name collision guard: the existing input/journal-resolution step is already "Phase 0", so the
        // preflight step must not reuse that label.
        expect(
          /Phase\s*0/i.test(preflightLine),
          `${variant}: the preflight step must not reuse the "Phase 0" label of the input/journal step`,
        ).toBe(false);
        expect(
          flow.indexOf(preflightLine) < flow.indexOf("Phase 0"),
          `${variant}: the preflight step must precede Phase 0 in the phase-flow block`,
        ).toBe(true);
        // FR-FLOW-043 AC-5: a halted run must not pin a journal root, so journal-path resolution and the
        // resume read must be listed among the things the gate precedes.
        const sec = preflightSection(body);
        const precedence = sec.split("\n").find((line) => /먼저|before|선행/i.test(line)) ?? "";
        expect(
          /waves\.jsonl/i.test(precedence) && /재개|resume/i.test(precedence),
          `${variant}: the gate must run before waves.jsonl path resolution and the resume read`,
        ).toBe(true);
      });

      it("AC-2: states a critical halt that --auto does not bypass, with no mutation and no child spawn", () => {
        const body = skillBody(readWaveSkill(variant));
        const near = windowsAround(body, WORKSPACE_ROOT_TOKEN, 900);
        expect(near.some((w) => HALT.test(w) && CRITICAL.test(w)), `${variant}: mismatch must be a critical halt`).toBe(true);
        expect(near.some((w) => /--auto/.test(w) && NO_BYPASS.test(w)), `${variant}: --auto must not bypass the halt`).toBe(true);
        expect(near.some((w) => NO_MUTATION.test(w)), `${variant}: halt point must state zero SRS mutations`).toBe(true);
        expect(near.some((w) => NO_SPAWN.test(w)), `${variant}: halt point must state no child skill was spawned`).toBe(true);
      });

      it("AC-3: names both recovery paths and both caveats in the halt output", () => {
        // Anchored on the halt-OUTPUT bullet block, not a wide window: the neighbouring `--wt`
        // paragraph restates both recovery paths, so a window-based check survived deleting a bullet.
        const bullets = haltOutputBullets(preflightSection(skillBody(readWaveSkill(variant))));
        expect(bullets !== "", `${variant}: the gate must specify what the halt output contains`).toBe(true);
        expect(/복구 경로 1|recovery path 1/i.test(bullets), `${variant}: recovery path 1 must be labelled`).toBe(true);
        expect(/복구 경로 2|recovery path 2/i.test(bullets), `${variant}: recovery path 2 must be labelled`).toBe(true);
        expect(SINGLE_ROOT_RECOVERY.test(bullets), `${variant}: must offer the single-root branch switch`).toBe(true);
        expect(NEW_SESSION_RECOVERY.test(bullets), `${variant}: must offer a new session rooted at the worktree`).toBe(true);
        expect(NO_NEW_REQ_ID.test(bullets), `${variant}: must warn against allocating new Requirement IDs`).toBe(true);
        expect(
          HOST_SPEC_UNEDITABLE.test(bullets),
          `${variant}: must warn that a worktree-rooted session cannot edit the host docs/spec`,
        ).toBe(true);
      });

      it("AC-4: covers the epic-issue entry mode with the same gate", () => {
        // Scoped to the gate section: a +/-1400 window reached §2's own "에픽" prose, so the sentence
        // extending the gate to the epic entry mode could be deleted with the test still green.
        const sec = preflightSection(skillBody(readWaveSkill(variant)));
        expect(sec !== "", `${variant}: the run-root preflight gate must be a discoverable section`).toBe(true);
        expect(
          windowsAround(sec, /에픽|epic/i, 80).some((w) => /게이트|gate|preflight/i.test(w)),
          `${variant}: the preflight gate must state that the epic-issue entry mode is covered by the same gate`,
        ).toBe(true);
      });

      it("AC-6: treats a failed workspaceRoot lookup as a mismatch and refuses the CLI as a fallback", () => {
        const body = skillBody(readWaveSkill(variant));
        const near = windowsAround(body, WORKSPACE_ROOT_TOKEN, 1200);
        expect(
          near.some((w) => /(실패|failure|obtain|조회)/i.test(w) && HALT.test(w)),
          `${variant}: failing to obtain workspaceRoot must halt exactly like a mismatch`,
        ).toBe(true);
        expect(near.some((w) => CLI_NOT_FALLBACK.test(w)), `${variant}: the CLI must be refused as a fallback for this check`).toBe(true);
      });

      it("FR-FLOW-042 AC-1: runs the preflight before worker dispatch as well as before decomposition, registration and SRS mutation", () => {
        // Revised in 4.0.0: the last thing the gate precedes is worker dispatch, not a child pipeline
        // spawn (FR-FLOW-188 AC-1, AC-7). Anchored on the gate section's precedence sentence.
        const sec = preflightSection(skillBody(readWaveSkill(variant)));
        const precedence = sec.split("\n").find((line) => /먼저|before|선행/i.test(line)) ?? "";
        expect(precedence, `${variant}: the gate must state what it precedes`).not.toBe("");
        expect(
          /wave 분해/.test(precedence) && /target 등록/.test(precedence) && /SRS mutation/.test(precedence),
          `${variant}: the gate must precede wave decomposition, target registration and SRS mutation`,
        ).toBe(true);
        expect(/워커 dispatch|worker dispatch/i.test(precedence), `${variant}: the gate must precede worker dispatch`).toBe(true);
        expect(/pipeline|파이프라인/i.test(precedence), `${variant}: the gate still names a child pipeline spawn`).toBe(false);
      });

      // FR-FLOW-042 AC-7 retired in 4.0.0 (successor FR-FLOW-188): each wave's worker runs in its own
      // worktree, so the --wt refusal and its accumulation ground leave. Only their absence is asserted.
      it("FR-FLOW-042 AC-7: carries no --wt delegation refusal any more", () => {
        const own = skillBody(readRepoFile(`skills/${variant}/kiwi-wave-master/SKILL.md`));
        expect(own, `${variant}: kiwi-wave-master must exist`).not.toBe("");
        expect(/--wt\b/.test(own), `${variant}: the retired --wt refusal is still in the skill`).toBe(false);
        expect(/wt-delegation-refused/.test(own), `${variant}: the retired wt-delegation-refused gate is still declared`).toBe(false);
      });

      it("FR-FLOW-043 AC-5/AC-7: halted run writes no waves.jsonl but emits one FAILED pipeline event", () => {
        const body = skillBody(readWaveSkill(variant));
        const near = windowsAround(body, /waves\.jsonl/, 900);
        expect(
          near.some((w) => HALT.test(w) && /(기록하지 않|append 하지 않|추가하지 않|writes nothing|no .*append)/i.test(w)),
          `${variant}: a halted run must append nothing to waves.jsonl`,
        ).toBe(true);
        const pipeNear = windowsAround(body, /pipeline\.jsonl/, 900);
        expect(
          pipeNear.some((w) => /FAILED/.test(w) && /next_hint/.test(w)),
          `${variant}: the halted run must still emit one pipeline.jsonl event with status FAILED and next_hint null`,
        ).toBe(true);
        expect(
          pipeNear.some((w) => GIT_ROOT_TOKEN.test(w) || /run 자신의 git root|its own git root|자신의 git root/i.test(w)),
          `${variant}: the halt event must resolve from the run's own git root, never the MCP-reported root`,
        ).toBe(true);
      });

      it("FR-FLOW-043 AC-7: the halt emit inherits pipeline-event.md §1's resolution order evaluated once from the run's own cwd", () => {
        const sec = emitSection(skillBody(readWaveSkill(variant)));
        expect(sec !== "", `${variant}: the skill must keep its pipeline-emit section`).toBe(true);
        // A single "run's own git root" step is not the contract: when git fails the journal path would
        // be undefined and the `.pipeline-path` marker rule skipped. Defer to the SSOT resolution order.
        expect(
          /pipeline-event\.md[^\n]*§\s*1|§\s*1[^\n]*해석 순서/i.test(sec),
          `${variant}: the halt emit must defer to pipeline-event.md §1's resolution order`,
        ).toBe(true);
        expect(/해석 순서|resolution order/i.test(sec), `${variant}: it must name the resolution order`).toBe(true);
        expect(
          /cwd|작업 디렉터리|작업 디렉토리/i.test(sec),
          `${variant}: the resolution order must be evaluated against the run's own cwd`,
        ).toBe(true);
        expect(
          /1\s*회 평가|한 번(?:만)? 평가|once/i.test(sec),
          `${variant}: the resolution order must be evaluated exactly once for the halted run`,
        ).toBe(true);
        expect(
          /폴백|fallback/i.test(sec) && /\.pipeline-path|마커|marker/i.test(sec),
          `${variant}: the halt emit must inherit the fallback chain and the .pipeline-path marker rule`,
        ).toBe(true);
        expect(
          /MCP[^\n]*(?:쓰지 않|사용하지 않|never|not use)/i.test(sec),
          `${variant}: the halt emit must still refuse the MCP-reported root`,
        ).toBe(true);
      });
    });
  }
});
