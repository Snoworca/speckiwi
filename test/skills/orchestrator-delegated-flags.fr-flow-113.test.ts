import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// @req FR-FLOW-113  kiwi-pm --handoff / --session-suffix / --no-final
// @req FR-FLOW-114  --no-pipeline-emit on kiwi-pm and kiwi-review-fix-loop
// @req FR-FLOW-115  --commit-lane-work on kiwi-pm
//
// The flags an orchestrated unit is invoked with are authored text, so they are asserted as raw-text
// contracts across every shipped rendering: the three skill variants plus the `.agents` mirror, which
// renders the codex variant. A stale copy silently restores a `kiwi-pm` that executes every task of
// the plan, commits nothing, and writes a pipeline record describing a run that did not happen.
//
// Runtime lag: these read the BUNDLED copies. The running agent reads `~/.claude/skills/…`, which
// `00.charter.md:303-304` forbids reinstalling from this repository; the lag is recorded as
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
// FR-FLOW-113 — --handoff, --session-suffix, --no-final
// ---------------------------------------------------------------------------------------------

describe("FR-FLOW-113 — kiwi-pm handoff, session-suffix and no-final", () => {
  it("covers exactly the four shipped kiwi-pm copies", () => {
    expect(PM_COPIES).toHaveLength(4);
    for (const copy of PM_COPIES) {
      expect(() => read(copy), `${copy} must exist`).not.toThrow();
    }
  });

  it.each(PM_COPIES)("%s declares all three flags in its CLI argument summary", (copy) => {
    const summary = section(read(copy), /^###\s.*CLI 인자 요약/);
    expect(summary, `${copy} must have a CLI argument summary`).not.toBe("");
    for (const flag of ["--handoff", "--session-suffix", "--no-final"]) {
      expect(summary.includes(flag), `${copy} the CLI summary must list ${flag}`).toBe(true);
    }
  });

  // AC-1: the execution set. This is the whole defect RW-12 closed — `kiwi-pm` executes every task
  // of the sidecar in declaration order and its only selector is a START POINT, so two units over
  // one plan would each run every task and each trip `lane-lease-breach`.
  it.each(PM_COPIES)("%s defines --handoff as the execution set, not the input source", (copy) => {
    const body = handoffSection(copy);
    expect(body, `${copy} must define the orchestration handoff flags in their own section`).not.toBe("");

    const rule = line(body, /`task_ids\[\]`/);
    expect(rule, `${copy} --handoff must key on the front matter's task_ids[]`).not.toBe("");
    expect(
      /정확히|exactly/.test(rule),
      `${copy} pm must execute EXACTLY task_ids[]; "at least" or "starting from" reopens RW-12`
    ).toBe(true);
    expect(HEDGE.test(rule), `${copy} the execution-set rule must be absolute, not hedged`).toBe(false);

    expect(
      /선언 순서|declaration order/.test(body),
      `${copy} the execution order must be the sidecar's declaration order`
    ).toBe(true);
    expect(
      /`sidecar_path`/.test(body),
      `${copy} each Task's body must still come from the sidecar, which the handoff does not carry`
    ).toBe(true);
    // The negative half of AC-7: the superseded phrasing must not be what is written.
    expect(
      /입력 SSOT|input SSOT|입력 진실 출처/.test(body),
      `${copy} --handoff must not be defined as pm's input source of truth; that phrasing reopens RW-12`
    ).toBe(false);
  });

  // AC-2: what the other three front-matter fields are for. `write_set` is the commit pathspec;
  // `req_ids[]` and `acceptance[]` drive nothing.
  it.each(PM_COPIES)("%s types write_set, req_ids and acceptance", (copy) => {
    const body = handoffSection(copy);
    const writeSet = line(body, /`write_set`/);
    expect(writeSet, `${copy} must state what write_set is`).not.toBe("");
    expect(
      /pathspec/.test(writeSet),
      `${copy} write_set must be the commit pathspec, which is what --commit-lane-work stages`
    ).toBe(true);

    const readOnly = line(body, /`req_ids\[\]`|`acceptance\[\]`/);
    expect(readOnly, `${copy} must state what req_ids[] and acceptance[] are`).not.toBe("");
    expect(
      /읽기 전용|read-only/.test(readOnly),
      `${copy} req_ids[] and acceptance[] must be read-only context`
    ).toBe(true);
    expect(
      /spawn 프롬프트|spawn prompt/.test(readOnly),
      `${copy} the read-only context must be named as passed into the coder spawn prompt`
    ).toBe(true);
    expect(
      /실행 결정|execution decision|판단하지 않는다/.test(body),
      `${copy} the body must state that the read-only context drives no execution decision`
    ).toBe(true);
  });

  // AC-3: out-of-set predecessors. By construction they are either already merged into base_sha or
  // in the same connected component, so firing the gate on them stalls every unit but the first.
  it.each(PM_COPIES)("%s treats an out-of-set depends_on predecessor as satisfied", (copy) => {
    const body = handoffSection(copy);
    const rule = line(body, /`depends_on_task`/);
    expect(rule, `${copy} must state how an out-of-set predecessor is evaluated`).not.toBe("");
    expect(
      /충족(?:된 것으로|으로)|satisfied/.test(rule),
      `${copy} a predecessor outside task_ids[] must be treated as satisfied`
    ).toBe(true);
    expect(HEDGE.test(rule), `${copy} the satisfied rule must be absolute, not hedged`).toBe(false);
    // The gate must survive INSIDE the set, or the relaxation removes the check entirely.
    expect(
      /`depends-on-violation`/.test(body),
      `${copy} the depends-on-violation gate must be named so its surviving scope is unambiguous`
    ).toBe(true);
    const inside = line(body, /집합 (?:안|내부)|inside the (?:execution )?set/);
    expect(inside, `${copy} must state that a violation inside the execution set is still a gate`).not.toBe("");
    expect(
      /게이트|gate/.test(inside),
      `${copy} a dependency violation inside the execution set must remain a gate`
    ).toBe(true);
  });

  // AC-4: `--from-task` is a start point and `task_ids[]` is a generally non-contiguous connected
  // component of the conflict graph, so the two cannot both be honoured.
  it.each(PM_COPIES)("%s refuses --from-task together with --handoff and records why", (copy) => {
    const body = handoffSection(copy);
    const rule = line(body, /`--from-task`/);
    expect(rule, `${copy} must state the --from-task interaction`).not.toBe("");
    expect(
      /거절|refus|금지|HALT/i.test(rule),
      `${copy} --from-task together with --handoff must be refused`
    ).toBe(true);
    expect(
      /비-?연속|non-contiguous|불연속/.test(body),
      `${copy} the reason must be recorded: a start-point selector cannot express a non-contiguous set`
    ).toBe(true);
  });

  // AC-5: the session relocation, all five artifacts, and the spawn prompt's run-id line.
  it.each(PM_COPIES)("%s relocates the whole session directory under --session-suffix", (copy) => {
    const body = flagBlock(copy, "--session-suffix");
    expect(body, `${copy} must define --session-suffix in its own block`).not.toBe("");
    expect(
      body.includes(".kiwi/sessions/{plan_run_id}/lanes/{lane}/"),
      `${copy} the relocated path must be stated literally, not described`
    ).toBe(true);
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
  it.each(PM_COPIES)("%s annotates the spawn prompt's RUN_ID line with the relocation", (copy) => {
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
  // from one unit's task subset promotes on partial evidence.
  it.each(PM_COPIES)("%s defines --no-final and records why T-final is skipped", (copy) => {
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
  // `references/extended-workflow.md`, which is outside this change's file set. The load-bearing
  // statement is in the handoff section above and is asserted in every copy.
  it("states in the claude T-final section that --no-final suppresses it", () => {
    const tFinal = section(read(PM_COPIES[0]), /^###\s*6\.2/);
    expect(tFinal, "the claude copy must carry the T-final section").not.toBe("");
    expect(
      /--no-final/.test(tFinal),
      "the T-final section must state that --no-final suppresses it"
    ).toBe(true);
  });

  // AC-7: the negative. Two units over one plan must not each execute every task.
  it.each(PM_COPIES)("%s states that two units over one plan cannot each execute every task", (copy) => {
    const body = handoffSection(copy);
    expect(
      /두 unit|두 개의 unit|각각 (?:모든|전체)/.test(body),
      `${copy} the body must state the failure the execution-set semantics prevent`
    ).toBe(true);
    expect(
      /`lane-lease-breach`/.test(body),
      `${copy} the breach the shared-plan execution would trip must be named`
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
  // AC-1: on kiwi-pm, no argument, staging the handoff's own write_set.
  it.each(PM_COPIES)("%s documents --commit-lane-work as taking no argument", (copy) => {
    const text = read(copy);
    expect(text.includes("--commit-lane-work"), `${copy} must document --commit-lane-work`).toBe(true);
    expect(
      /--commit-lane-work[ =]+[<{]/.test(text),
      `${copy} --commit-lane-work must take no argument`
    ).toBe(false);
    const body = handoffSection(copy);
    const rule = line(body, /`--commit-lane-work`[^\n]*`write_set`|`write_set`[^\n]*`--commit-lane-work`/);
    expect(rule, `${copy} the staged set must be the handoff's own write_set`).not.toBe("");
    expect(
      /`--handoff`/.test(rule) || /`--handoff`/.test(body),
      `${copy} the write_set must be sourced from the handoff the same invocation already passed`
    ).toBe(true);
  });

  // AC-2: per Task, explicit pathspec, never the whole tree. `git add -A` inside a unit stages the
  // orchestrator's own residue and every other unit's uncommitted work.
  it.each(PM_COPIES)("%s commits per Task with an explicit pathspec", (copy) => {
    const body = handoffSection(copy);
    const rule = line(body, /Task 당|per-task|per Task|Task 마다/);
    expect(rule, `${copy} must state the commit granularity`).not.toBe("");
    expect(
      /commit/i.test(rule),
      `${copy} the granularity statement must be about the commit, not about something else`
    ).toBe(true);
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

  // AC-3: trailers carry the run coordinates; the subject carries none. `00.charter.md:302` forbids
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
