import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { at } from "../support/at.js";

// @req FR-FLOW-113  kiwi-pm --session-suffix / --no-final (--handoff retired in 4.0.0)
// @req FR-FLOW-114  --no-pipeline-emit on kiwi-pm and kiwi-review-fix-loop
// @req FR-FLOW-115  --commit-lane-work on kiwi-pm
//
// The flags an orchestrated unit is invoked with are authored text, so they are asserted as raw-text
// contracts across every shipped rendering: the three skill variants plus the `.agents` mirror, which
// renders the codex variant. A stale copy silently restores a `kiwi-pm` that commits nothing, or
// writes a pipeline record describing a run that did not happen.
//
// Runtime lag: these read the BUNDLED copies. The running agent reads `~/.claude/skills/…`, which
// `the charter's standing constraints` forbids reinstalling from this repository; the lag is recorded as
// verification evidence on each requirement rather than accommodated here.

const REPO_ROOT = fileURLToPath(new URL("../../", import.meta.url));

/** Every shipped rendering of a skill's SKILL.md. `.agents/skills/` mirrors kiwi-pm,
 * kiwi-review-fix-loop and kiwi-pipeline; only kiwi-step and kiwi-wave-master are excluded
 * (`.agents/skills/.speckiwi-mirror-exclusions.json`). */
function copies(skill: string): string[] {
  return [
    `skills/claude/${skill}/SKILL.md`,
    `skills/codex/${skill}/SKILL.md`,
    `skills/etc/${skill}/SKILL.md`,
    `.agents/skills/${skill}/SKILL.md`
  ];
}

const PM_COPIES = copies("kiwi-pm");
const RFL_COPIES = copies("kiwi-review-fix-loop");
const PIPELINE_SKILL_COPIES = copies("kiwi-pipeline");

function read(relPath: string): string {
  return readFileSync(path.join(REPO_ROOT, relPath), "utf8");
}

/** A heading and everything under it, down to the next same-or-higher-level heading. "" when absent. */
function section(text: string, headingRe: RegExp): string {
  const lines = text.split("\n");
  const start = lines.findIndex((l) => /^#{1,6}\s/.test(l) && headingRe.test(l));
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

/** The single line containing the first match of `re`. "" when absent. */
function line(text: string, re: RegExp): string {
  return text.split("\n").find((l) => re.test(l)) ?? "";
}

/** Hedges that turn a MUST into a SHOULD. */
const HEDGE = /수 있다|해도 된다|권장|바람직|원칙적으로|원칙으로 하되|가능하면|되도록|경우에 따라|가급적|지양/;

/** The section that defines the orchestration handoff flags. Named once so a rename fails loudly
 * rather than making every assertion below vacuous. */
function handoffSection(copy: string): string {
  return section(read(copy), /^###\s.*오케스트레이션 위임 플래그/);
}

/** One flag's own sub-block inside the handoff section. Used wherever an unscoped `line()` would
 * otherwise match the section heading, which lists every flag name and so satisfies a bare
 * name search while the definition below it could be missing entirely. */
function flagBlock(copy: string, flag: string): string {
  // The heading may spell an argument placeholder (`--session-suffix <lane>`), so the match runs to
  // the closing backtick rather than requiring the bare flag name.
  return section(handoffSection(copy), new RegExp(`^####\\s.*\`${flag}[^\`]*\``));
}

// ---------------------------------------------------------------------------------------------
// FR-FLOW-113 — --session-suffix, --no-final (--handoff and --from-task retired in 4.0.0)
// ---------------------------------------------------------------------------------------------

describe("FR-FLOW-113 — kiwi-pm session-suffix and no-final", () => {
  it("covers exactly the four shipped kiwi-pm copies", () => {
    expect(PM_COPIES).toHaveLength(4);
    for (const copy of PM_COPIES) {
      expect(() => read(copy), `${copy} must exist`).not.toThrow();
    }
  });

  it.each(PM_COPIES)("FR-FLOW-113 AC-5 AC-6: %s declares both surviving flags in its CLI argument summary", (copy) => {
    const summary = section(read(copy), /^###\s.*CLI 인자 요약/);
    expect(summary, `${copy} must have a CLI argument summary`).not.toBe("");
    for (const flag of ["--session-suffix", "--no-final"]) {
      expect(summary.includes(flag), `${copy} the CLI summary must list ${flag}`).toBe(true);
    }
  });

  // AC-1 to AC-4 and AC-7 retired with the plan: kiwi-pm runs one agreed SDS as one kiwi-coder run,
  // so no execution set, no start point and no task dependency is left to define. A copy that still
  // documents them tells an orchestrator to pass flags nothing reads.
  it.each(PM_COPIES)("FR-FLOW-113 AC-1 AC-4 AC-7: %s documents no --handoff, --from-task or task set", (copy) => {
    const text = read(copy);
    for (const retired of ["--handoff", "--from-task", "task_ids[]", "depends_on_task"]) {
      expect(text.includes(retired), `${copy} still documents the retired ${retired}`).toBe(false);
    }
  });

  // AC-5: the session relocation, all five artifacts, and the spawn prompt's run-id line. The session
  // key is the SDS id now that the plan run id is gone.
  it.each(PM_COPIES)("FR-FLOW-113 AC-5: %s relocates the whole session directory under --session-suffix", (copy) => {
    const body = flagBlock(copy, "--session-suffix");
    expect(body, `${copy} must define --session-suffix in its own block`).not.toBe("");
    expect(
      body.includes(".kiwi/sessions/{sds_id}/lanes/{lane}/"),
      `${copy} the relocated path must be stated literally, keyed on the SDS id`
    ).toBe(true);
    expect(body.includes("{plan_run_id}"), `${copy} the relocated path still names the retired plan run id`).toBe(false);
    for (const artifact of ["pm-state.json", "pm.lock", "worklog.jsonl", "state.json", "reports/"]) {
      expect(
        body.includes(artifact),
        `${copy} the relocation must name ${artifact}; a partial move leaves a shared file and the race`
      ).toBe(true);
    }
    const spawn = line(body, /RUN_ID/);
    expect(spawn, `${copy} the coder spawn prompt's run-id line must follow the relocation`).not.toBe("");
    expect(
      /`kiwi-coder`/.test(spawn),
      `${copy} the run-id line must be identified as the one kiwi-coder derives its state paths from`
    ).toBe(true);
  });

  // The relocation must also be visible where the spawn prompt itself is authored, or an
  // implementer reading §3.2 alone reproduces the flat layout.
  it.each(PM_COPIES)("FR-FLOW-113 AC-5: %s annotates the spawn prompt's RUN_ID line with the relocation", (copy) => {
    // Asserted on the line itself rather than on a §3.2 slice: the spawn prompt is a fenced block
    // whose contents open with `## INPUTS`, so any heading-based section reader stops before the
    // line this is about.
    const runId = line(read(copy), /^- RUN_ID=/);
    expect(runId, `${copy} the spawn prompt must carry a RUN_ID line`).not.toBe("");
    expect(
      /--session-suffix/.test(runId),
      `${copy} the RUN_ID line must state that --session-suffix moves the path it names`
    ).toBe(true);
    expect(
      /lanes\/\{lane\}/.test(runId),
      `${copy} the RUN_ID line must name the relocated path, not only the flag`
    ).toBe(true);
  });

  // AC-6: --no-final, with the reason. A requirement spans units, so an all-done denominator drawn
  // from one unit's share promotes on partial evidence.
  it.each(PM_COPIES)("FR-FLOW-113 AC-6: %s defines --no-final and records why T-final is skipped", (copy) => {
    const body = flagBlock(copy, "--no-final");
    expect(body, `${copy} must define --no-final in its own block`).not.toBe("");
    expect(
      /T-final/.test(body),
      `${copy} --no-final must name the T-final promotion it skips`
    ).toBe(true);
    expect(
      /`all_done`|all-done|분모/.test(body),
      `${copy} the reason must name the all-done denominator that would otherwise be wrong`
    ).toBe(true);
  });

  // §6.2 is the T-final section, and it must say it is conditional or it reads as unconditional.
  // Only the claude rendering carries §6.2 inside SKILL.md; codex, etc and the mirror carry it in
  // `references/extended-workflow.md`, asserted by orchestrator-followup-consistency.fr-flow-116.
  it("FR-FLOW-113 AC-6: states in the claude T-final section that --no-final suppresses it", () => {
    const tFinal = section(read(at(PM_COPIES, 0)), /^###\s*6\.2/);
    expect(tFinal, "the claude copy must carry the T-final section").not.toBe("");
    expect(
      /--no-final/.test(tFinal),
      "the T-final section must state that --no-final suppresses it"
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------------------------
// FR-FLOW-114 — --no-pipeline-emit
// ---------------------------------------------------------------------------------------------

describe("FR-FLOW-114 — --no-pipeline-emit on kiwi-pm and kiwi-review-fix-loop", () => {
  // AC-1: both skills, every rendering, no argument.
  it.each([...PM_COPIES, ...RFL_COPIES])("%s documents --no-pipeline-emit as taking no argument", (copy) => {
    const text = read(copy);
    expect(text.includes("--no-pipeline-emit"), `${copy} must document --no-pipeline-emit`).toBe(true);
    // A typed form would make the flag a second source of truth for a value the invocation already
    // carries; the flag is a switch.
    expect(
      /--no-pipeline-emit[ =]+[<{]/.test(text),
      `${copy} --no-pipeline-emit must take no argument`
    ).toBe(false);
    const rule = line(text, /--no-pipeline-emit[^\n]*(?:인자|argument|없)/);
    expect(rule, `${copy} the no-argument property must be stated, not only implied`).not.toBe("");
  });

  // AC-2: what the flag does, and what its absence leaves unchanged.
  it.each([...PM_COPIES, ...RFL_COPIES])("%s suppresses the pipeline append under the flag only", (copy) => {
    const text = read(copy);
    const rule = line(text, /--no-pipeline-emit[^\n]*(?:append|emit|추가|기록)/);
    expect(rule, `${copy} must state what the flag suppresses`).not.toBe("");
    expect(
      /kiwi\/pipeline\.jsonl/.test(text),
      `${copy} the suppressed append must name the journal it would otherwise write`
    ).toBe(true);
    const unchanged = line(
      text,
      /(?:플래그가 )?없으면[^\n]*emit|기본 동작[^\n]*emit|없을 때[^\n]*emit|without the flag[^\n]*emit/i
    );
    expect(unchanged, `${copy} must state that without the flag the existing emit is unchanged`).not.toBe("");
  });

  // AC-3: `kiwi-pipeline` deliberately does NOT gain the flag. §14 is the "easy to forget, break
  // silently" list, so a registration naming a skill outside the unit is the worst place for a
  // disagreement to sit — the exclusion is asserted, not merely omitted.
  it.each(PIPELINE_SKILL_COPIES)("%s does not gain --no-pipeline-emit", (copy) => {
    expect(
      read(copy).includes("--no-pipeline-emit"),
      `${copy} kiwi-pipeline must not gain the flag; no orchestrated unit invokes it`
    ).toBe(false);
  });

  it.each([...PM_COPIES, ...RFL_COPIES])("%s records why kiwi-pipeline does not gain the flag", (copy) => {
    const rule = line(read(copy), /`kiwi-pipeline`[^\n]*--no-pipeline-emit|--no-pipeline-emit[^\n]*`kiwi-pipeline`/);
    expect(rule, `${copy} must record the kiwi-pipeline exclusion`).not.toBe("");
    expect(
      /호출하지 않|does not invoke|invokes/.test(rule),
      `${copy} the recorded reason must be that no orchestrated unit invokes kiwi-pipeline`
    ).toBe(true);
  });

  // AC-4: the executor passes it on every unit run, and the consequence of omitting it is recorded.
  it.each([...PM_COPIES, ...RFL_COPIES])("%s states the consequence of omitting the flag", (copy) => {
    const text = read(copy);
    const rule = line(text, /거짓 (?:파이프라인 )?기록|false pipeline record|잘못 기술/);
    expect(rule, `${copy} must state that omitting the flag writes a false pipeline record`).not.toBe("");
    const passes = line(text, /매 unit|every unit|unit 실행마다/);
    expect(passes, `${copy} must state that the orchestrator passes the flag on every unit run`).not.toBe("");
    expect(
      /--no-pipeline-emit/.test(passes),
      `${copy} the every-unit obligation must name the flag it carries`
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------------------------
// FR-FLOW-115 — --commit-lane-work
// ---------------------------------------------------------------------------------------------

describe("FR-FLOW-115 — kiwi-pm commit-lane-work", () => {
  // AC-1: on kiwi-pm, no argument, staging the write set of the agreed SDS the same call runs — its
  // Files paths and Test Plan test files (FR-NODE-209 AC-4). The handoff that used to supply it is gone.
  it.each(PM_COPIES)("FR-FLOW-115 AC-1: %s documents --commit-lane-work as taking no argument", (copy) => {
    const text = read(copy);
    expect(text.includes("--commit-lane-work"), `${copy} must document --commit-lane-work`).toBe(true);
    expect(
      /--commit-lane-work[ =]+[<{]/.test(text),
      `${copy} --commit-lane-work must take no argument`
    ).toBe(false);
    const body = handoffSection(copy);
    const rule = line(body, /`--commit-lane-work`[^\n]*쓰기 집합|쓰기 집합[^\n]*`--commit-lane-work`/);
    expect(rule, `${copy} the staged set must be the SDS write set`).not.toBe("");
    expect(/SDS/.test(rule), `${copy} the write set must be the agreed SDS's own`).toBe(true);
    expect(
      /Files/.test(rule) && /Test Plan/.test(rule),
      `${copy} the write set must be named by its two parts, the Files paths and the Test Plan test files`
    ).toBe(true);
    expect(/`write_set`|`--handoff`/.test(body), `${copy} the staged set is still sourced from the retired handoff`).toBe(
      false
    );
  });

  // AC-2: one commit per SDS run, explicit pathspec, never the whole tree. `git add -A` inside a unit
  // stages the orchestrator's own residue and every other unit's uncommitted work.
  it.each(PM_COPIES)("FR-FLOW-115 AC-2: %s commits once per SDS run with an explicit pathspec", (copy) => {
    const body = handoffSection(copy);
    const rule = line(body, /commit 1개/);
    expect(rule, `${copy} must state the commit granularity`).not.toBe("");
    expect(
      /SDS/.test(rule) && /kiwi-coder 실행/.test(rule),
      `${copy} the granularity must be the one kiwi-coder run of the SDS, not a plan Task`
    ).toBe(true);
    expect(/Task/.test(rule), `${copy} the granularity still names the retired plan Task`).toBe(false);
    expect(
      /작업 트리 전체|whole working tree|`git add -A`|전체를 stage/.test(body),
      `${copy} staging the whole working tree must be named and forbidden, not left unmentioned`
    ).toBe(true);
    const forbid = line(body, /작업 트리 전체|whole working tree|`git add -A`|전체를 stage/);
    expect(
      /않는다|never|금지/.test(forbid),
      `${copy} staging the whole working tree must be forbidden`
    ).toBe(true);
  });

  // AC-3: trailers carry the run coordinates; the subject carries none. `the charter's standing constraints` forbids
  // phase and step markers in a commit title, and the recovery mechanism must not buy itself by
  // violating a standing constraint.
  it.each(PM_COPIES)("%s puts the run coordinates in trailers and not in the subject", (copy) => {
    const body = handoffSection(copy);
    expect(
      /trailer/i.test(body),
      `${copy} the run coordinates must be carried in git trailers`
    ).toBe(true);
    const rule = line(body, /제목|subject|title/);
    expect(rule, `${copy} must state what the commit subject may not carry`).not.toBe("");
    expect(
      /않는다|없|never|no/.test(rule),
      `${copy} no run coordinate may appear in the commit subject`
    ).toBe(true);
    expect(HEDGE.test(rule), `${copy} the subject prohibition must be absolute, not hedged`).toBe(false);
  });

  // AC-4: the pathspec file is deliberately not used. Any path under the orchestrator's own state
  // directory is git-ignored and therefore absent from an isolated workspace — pm would ENOENT,
  // commit nothing, and the unit would read as empty.
  it.each(PM_COPIES)("%s records why a pathspec file is not used", (copy) => {
    const body = handoffSection(copy);
    const rule = line(body, /pathspec 파일|pathspec file/);
    expect(rule, `${copy} must record that a pathspec file is deliberately not used`).not.toBe("");
    expect(
      /git-ignore|gitignore|무시/.test(body),
      `${copy} the reason must be that the orchestrator's state directory is git-ignored`
    ).toBe(true);
    expect(
      /kiwi\/orchestrator\//.test(body),
      `${copy} the git-ignored directory must be named so the reason is checkable`
    ).toBe(true);
  });

  // AC-5: the consequence of omitting it.
  it.each(PM_COPIES)("%s states the consequence of omitting --commit-lane-work", (copy) => {
    const body = handoffSection(copy);
    const rule = line(body, /--commit-lane-work[^\n]*(?:없으면|생략)|(?:없으면|생략)[^\n]*--commit-lane-work/);
    expect(rule, `${copy} must state what happens when the flag is omitted`).not.toBe("");
    expect(
      /아무것도 commit|commit 하지 않는다|commits nothing/.test(rule),
      `${copy} without the flag kiwi-pm commits nothing`
    ).toBe(true);
    expect(
      /미커밋|uncommitted|다음 unit/.test(body),
      `${copy} the leftover uncommitted working tree the next unit trips over must be named`
    ).toBe(true);
  });

  // AC-6: the kiwi-review-fix-loop half is phase-2 work and must not be authored here.
  it.each(RFL_COPIES)("%s does not gain --commit-lane-work in this target", (copy) => {
    expect(
      read(copy).includes("--commit-lane-work"),
      `${copy} the loop-L half of the flag moves to the next target and must not be documented yet`
    ).toBe(false);
  });

  // The corollary of AC-6 on the kiwi-pm side: pm's "no automatic commit" rule must now name its
  // one exception, or §6.1 and this flag contradict each other.
  it.each(PM_COPIES)("%s reconciles the no-automatic-commit rule with the flag", (copy) => {
    const rule = line(read(copy), /자동 commit/);
    expect(rule, `${copy} must keep the no-automatic-commit rule`).not.toBe("");
    expect(
      /--commit-lane-work/.test(rule),
      `${copy} the no-automatic-commit rule must name --commit-lane-work as its one exception`
    ).toBe(true);
  });
});
