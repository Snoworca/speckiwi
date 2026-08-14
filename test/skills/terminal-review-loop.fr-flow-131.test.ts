import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// @req FR-FLOW-131  one terminal review-loop obligation binding all three rungs
// @req FR-FLOW-132  the R-STEP rung invokes the loop before its close-out
// @req FR-FLOW-133  the R-PLAN hop carries a window and drops its return-value condition
// @req FR-FLOW-134  kiwi-wave-master owns a run-scope terminal hop
// @req FR-FLOW-135  refused by name rather than opted out of; stale neighbours move
//
// Measured before these were written: a naive `/kiwi-review-fix-loop/` is GREEN today over the
// orchestrator body, over §4.5.2, over §4.5.3, over the wave-master body and over wave-master §5.5 —
// the last of which matches the sentence saying hunk review is *out of scope here*. So none of the
// assertions below may be a search for the skill's name. Each keys on the contract the text must
// state, and every anchor phrase minted by this change (`종료 hop`, `not-applicable-empty-window`,
// `skipped-run-halted`) occurs zero times in either skill beforehand.
//
// The routing suite's "three post-return outcomes" test is six presence checks with no count
// assertion, and the outcome count, the phase-flow diagram row and the `TASK_DONE` conditional each
// have zero test readers. Those are the sites a partial landing leaves behind, so they are asserted
// here rather than left to the suite that named them.

const REPO_ROOT = fileURLToPath(new URL("../../", import.meta.url));

const ORCHESTRATOR_COPIES = ["skills/claude", "skills/codex", "skills/etc", ".agents/skills"].map(
  (root) => `${root}/kiwi-orchestrator/SKILL.md`
);
/** Three, not four: the mirror excludes kiwi-wave-master by design. */
const WAVE_COPIES = ["claude", "codex", "etc"].map((v) => `skills/${v}/kiwi-wave-master/SKILL.md`);

const read = (rel: string): string => readFileSync(path.join(REPO_ROOT, rel), "utf8");
const body = (t: string): string => t.replace(/^---[\s\S]*?\n---\s*\n?/, "");

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

const line = (t: string, re: RegExp): string => t.split("\n").find((l) => re.test(l)) ?? "";
const lines = (t: string, re: RegExp): string[] => t.split("\n").filter((l) => re.test(l));
const offsetOf = (t: string, re: RegExp): number => t.search(re);

/**
 * §4.5's text ABOVE its first `####` subsection. `section(body, /^###\s*4\.5\s/)` swallows 4.5.1–3,
 * so an obligation asserted over the whole section is satisfied by the hop §4.5.2 has carried all
 * along — the same shape as the `후보 ≥2` and `wave 위임` false-greens this suite has already had
 * to repair twice.
 */
const rungPreamble = (t: string): string => section(body(t), /^###\s*4\.5\s/).split(/^#{4,6}\s/m)[0];

const stepRung = (t: string): string => section(body(t), /^####\s*4\.5\.1\b/m);
const planRung = (t: string): string => section(body(t), /^####\s*4\.5\.2\b/m);

const HEDGE = /수 있다|해도 된다|권장|바람직|원칙적으로|가능하면|되도록|경우에 따라|가급적|필요하면|필요 시/;

describe.each(ORCHESTRATOR_COPIES)("FR-FLOW-131 — one obligation binding all three rungs (%s)", (copy) => {
  const rule = (): string => line(rungPreamble(read(copy)), /종료 hop/);

  it("AC-1: §4.5's preamble carries the rule, binding every rung, unhedged", () => {
    expect(rule(), `${copy}: the terminal-hop rule must sit above the rung subsections`).not.toBe("");
    for (const rung of ["R-STEP", "R-PLAN", "R-ORCH"]) {
      expect(rule().includes(rung), `${copy}: the obligation must bind ${rung}`).toBe(true);
    }
    expect(/kiwi-review-fix-loop/.test(rule())).toBe(true);
    expect(/정확히 한 번/.test(rule()), `${copy}: "runs" without a count permits zero`).toBe(true);
    expect(/예외는 없다/.test(rule()), `${copy}: an unstated exception is a per-rung exception`).toBe(true);
    expect(HEDGE.test(rule()), `${copy}: the obligation must be absolute`).toBe(false);
  });

  it("AC-2: the rule names what governs instead of the child's return value", () => {
    const pre = rungPreamble(read(copy));
    const governs = line(pre, /반환값에 조건 걸지 않는다|반환값에 조건 걸리지 않는다/);
    expect(governs, `${copy}: the rule must say it is not keyed on the return value`).not.toBe("");
    // Literal unconditionality is unshippable against §0.4, which halts the parent on a child's
    // NEEDS_USER/FAILED even under --auto. The honest contract names §0.4 as the one exception.
    for (const token of ["TASK_DONE", "NEEDS_USER", "FAILED", "§0.4"]) {
      expect(pre.includes(token), `${copy}: the rule must name ${token}`).toBe(true);
    }
    expect(/유일한/.test(pre), `${copy}: §0.4 must be named as the ONLY non-execution path`).toBe(true);
  });

  it("AC-3: both halt branches are stated with their recorded verdicts", () => {
    const pre = rungPreamble(read(copy));
    const empty = line(pre, /not-applicable-empty-window/);
    expect(empty, `${copy}: the empty-window branch keeps the gate's predicate honest`).not.toBe("");
    expect(/발동하지 않는다/.test(empty), `${copy}: an empty window must not fire the gate`).toBe(true);
    const halted = line(pre, /skipped-run-halted/);
    expect(halted, `${copy}: the post-landing halt branch must be stated`).not.toBe("");
    expect(
      /완료로 보고(하지 않는다|되지 않는다)/.test(halted),
      `${copy}: a halted run must not be reported complete`
    ).toBe(true);
  });

  it("AC-4: the obligation is stated exactly once per rendering", () => {
    expect(lines(body(read(copy)), /종료 hop 의무/).length, `${copy}: exactly one declaration`).toBe(1);
  });
});

describe.each(ORCHESTRATOR_COPIES)("FR-FLOW-132 — the R-STEP rung owns a hop (%s)", (copy) => {
  it("AC-1: the rung invokes the loop rather than pointing at the rule", () => {
    // A pointer ("§4.5 의 규칙을 따른다") and an exemption ("kiwi-tdd 가 내부에서 리뷰하므로 hop 이
    // 없다") both contain the skill's name; only an invocation form distinguishes them.
    expect(
      /Skill\(\{\s*skill:\s*"kiwi-review-fix-loop"/.test(stepRung(read(copy))),
      `${copy}: R-STEP must invoke the loop, not defer to a rule`
    ).toBe(true);
  });

  it("AC-2: the hop is windowed and does not close requirements", () => {
    const rung = stepRung(read(copy));
    const call = rung.slice(rung.indexOf('Skill({ skill: "kiwi-review-fix-loop"'));
    const args = call.slice(0, call.indexOf("})") + 2);
    for (const flag of ["--base", "--head", "--no-pipeline-emit"]) {
      expect(args.includes(flag), `${copy}: the hop must carry ${flag}`).toBe(true);
    }
    // NOT --regression-baseline. `기존` is judged at the baseline commit and the child's never-weaken
    // gate protects only what is `기존`; handing it the run-start pin would put the red-phase tests
    // outside that protection, which is the opposite of the intent.
    expect(
      args.includes("--regression-baseline"),
      `${copy}: the run-start pin would take the red-phase tests outside the child's protection`
    ).toBe(false);
    // kiwi-tdd already promoted the step requirement, and the loop skips anything not `implemented`,
    // so --close-reqs would skip its entire denominator and still report TASK_DONE.
    expect(args.includes("--close-reqs"), `${copy}: --close-reqs would skip the whole denominator`).toBe(false);
  });

  it("AC-3: the hop precedes the close-out, by offset rather than by presence", () => {
    const rung = stepRung(read(copy));
    const hop = offsetOf(rung, /Skill\(\{\s*skill:\s*"kiwi-review-fix-loop"/);
    const emit = offsetOf(rung, /next_hint: null/);
    const lock = offsetOf(rung, /run lock 을 해제/);
    expect(emit, `${copy}: the terminating emit must survive`).toBeGreaterThan(-1);
    expect(lock, `${copy}: the lock release must survive`).toBeGreaterThan(-1);
    expect(hop, `${copy}: a hop after the terminating emit is never reached`).toBeLessThan(emit);
    expect(hop, `${copy}: a review that edits code must run while the lock still holds`).toBeLessThan(lock);
  });

  it("AC-4: the stated outcome count matches the outcomes listed", () => {
    const rung = stepRung(read(copy));
    const claim = line(rung, /반환 후 .* 결과/);
    expect(claim, `${copy}: the rung must state its outcome count`).not.toBe("");
    const listed = lines(rung, /^- \*/).length;
    const words: Record<string, number> = { 세: 3, 네: 4, 다섯: 5 };
    const stated = Object.entries(words).find(([w]) => claim.includes(`${w} 결과`))?.[1] ?? -1;
    expect(stated, `${copy}: the stated count must be readable`).toBeGreaterThan(0);
    expect(stated, `${copy}: says ${stated}, lists ${listed}`).toBe(listed);
  });

  it("AC-5: the flag paragraph propagates only what the child can consume", () => {
    const rung = stepRung(read(copy));
    expect(
      /이 경로에 존재하지 않는 게이트를 겨냥한다/.test(rung),
      `${copy}: the old reason named absent gates and was false once the hop existed`
    ).toBe(false);
    const flags = line(rung, /`--regression-baseline` 을 주지 않으면|전파하지 않는다/);
    expect(flags, `${copy}: the flag paragraph must survive`).not.toBe("");
    // kiwi-review-fix-loop has no --auto-cost-warning, --auto-integration or --force; those gates
    // belong to kiwi-coder and are reached only through kiwi-pm. Claiming to propagate them to this
    // child states something the child cannot act on.
    expect(
      /`--auto-cost-warning` · `--auto-integration` · `--force` 는 전파하지 않는다/.test(rung),
      `${copy}: three of the four pass-throughs are not this child's options`
    ).toBe(true);
  });

  it("AC-6: the hop does not touch the tests the red phase authored", () => {
    expect(
      /red 단계.*테스트.*(수정하지 않는다|건드리지 않는다)/.test(stepRung(read(copy))),
      `${copy}: kiwi-tdd forbids weakening a red-phase test; the loop's fixer carries no such rule`
    ).toBe(true);
  });
});

describe.each(ORCHESTRATOR_COPIES)("FR-FLOW-133 — the R-PLAN hop is windowed (%s)", (copy) => {
  it("AC-1: the hop's arguments carry an explicit window", () => {
    const rung = planRung(read(copy));
    const call = rung.slice(rung.indexOf('Skill({ skill: "kiwi-review-fix-loop"'));
    const args = call.slice(0, call.indexOf("})") + 2);
    expect(args.includes("--close-reqs"), `${copy}: R-PLAN's closure policy is unchanged`).toBe(true);
    for (const flag of ["--base", "--head"]) {
      expect(args.includes(flag), `${copy}: without ${flag} the hop reviews a fallback window`).toBe(true);
    }
  });

  it("AC-2: the rung says why the window is explicit", () => {
    // Selected by the review loop's OWN fallback: `/5|다섯/` picks the first line carrying any digit
    // 5, and a bare `/폴백/` picks the precondition line's unrelated `generated_at` fallback.
    const why = line(planRung(read(copy)), /리뷰 루프가[^|]*폴백/);
    expect(why, `${copy}: the reason the window is explicit must be stated`).not.toBe("");
    expect(
      /5|다섯/.test(why),
      `${copy}: a gate satisfied by a false-clean five-commit run converts a real gap into a recorded pass`
    ).toBe(true);
  });

  it("AC-3: no line introducing the hop keys it on a return value", () => {
    for (const l of lines(planRung(read(copy)), /두 번째 hop/)) {
      expect(
        /`TASK_DONE` 이면|완주하면|성공하면/.test(l),
        `${copy}: still conditional: ${l}`
      ).toBe(false);
    }
  });

  it("AC-5: the policy sentence survives with its ground", () => {
    const rung = planRung(read(copy));
    expect(/두 번째 hop 은 오케스트레이터 자신이 선언한 정책/.test(rung)).toBe(true);
    expect(/상속된 의무가 아니다/.test(rung)).toBe(true);
  });
});

describe.each(WAVE_COPIES)("FR-FLOW-134 — kiwi-wave-master owns a run-scope hop (%s)", (copy) => {
  const owned = (): string => {
    const b = body(read(copy));
    const start = b.indexOf('Skill({ skill: "kiwi-review-fix-loop"');
    return start === -1 ? "" : b.slice(Math.max(0, start - 1200), start + 800);
  };

  it("AC-1: the skill invokes the loop itself, before the whole-run final verification", () => {
    const b = body(read(copy));
    const hop = offsetOf(b, /Skill\(\{\s*skill:\s*"kiwi-review-fix-loop"/);
    expect(hop, `${copy}: owning the obligation means invoking it`).toBeGreaterThan(-1);
    const finalPass = offsetOf(b, /^##\s*5\.6\s/m);
    expect(finalPass, `${copy}: the whole-run final verification must exist`).toBeGreaterThan(-1);
    expect(hop, `${copy}: the hop's report must land inside the final pass's evidence`).toBeLessThan(finalPass);
  });

  it("AC-2: the window is the run's, not the last wave's, and requirements are not closed", () => {
    const region = owned();
    expect(/run_diff_window/.test(region), `${copy}: the run-scope denominator is the point`).toBe(true);
    // Read the invocation's arguments, not the surrounding prose: the paragraph that explains why
    // the flag is withheld necessarily names it.
    const b = body(read(copy));
    const call = b.slice(b.indexOf('Skill({ skill: "kiwi-review-fix-loop"'));
    const args = call.slice(0, call.indexOf("})") + 2);
    expect(args.includes("--close-reqs"), `${copy}: a run-scope close would be a bulk finalize`).toBe(false);
  });

  it("AC-3: the inheritance reading is rejected by name", () => {
    expect(
      /(kiwi-pipeline|파이프라인)[^\n]*(마지막 홉|종료 hop)[^\n]*(대신하지 않는다|충분하지 않다)/.test(body(read(copy))),
      `${copy}: "the pipeline already ran a review" must be refused, not left as a live reading`
    ).toBe(true);
  });

  it("AC-3b: the non-redundancy argument rests on scope, not on a false disjointness", () => {
    // The run window is base_sha..head_sha of the whole run, so it CONTAINS every wave window.
    // Justifying the extra hop by "the two denominators do not overlap" is simply false, and a
    // reader who checks it finds the hop unjustified and deletes it. What no wave-scope review can
    // judge is the interaction between waves — that is the honest argument, and it survives audit.
    const region = section(body(read(copy)), /^##\s*5\.55\s/);
    expect(region, `${copy}: §5.55 must exist`).not.toBe("");
    expect(
      /겹치지 않/.test(region),
      `${copy}: the run window is a superset of every wave window; disjointness is false`
    ).toBe(false);
    expect(
      /상위집합/.test(region),
      `${copy}: the containment must be stated, not glossed`
    ).toBe(true);
    expect(
      /(가로지르는|교차|integration_items)/.test(region),
      `${copy}: non-redundancy must come from what only a whole-run denominator can judge`
    ).toBe(true);
  });

  it("AC-4: the per-wave loop becomes a precondition of complete, not an afterthought", () => {
    const rule = line(body(read(copy)), /complete 로 기록하지 않는다|`complete` 로 기록하지 않는다/);
    expect(rule, `${copy}: the complete record must state its preconditions`).not.toBe("");
    expect(
      /kiwi-review-fix-loop/.test(rule),
      `${copy}: the review loop's presence must be one of them`
    ).toBe(true);
  });

  it("AC-5: the missing-event detector survives — it is the only observer of the guarantee", () => {
    expect(
      /검증자 2 의 finding 으로 올린다/.test(body(read(copy))),
      `${copy}: guaranteed upstream, this row looks redundant and gets deleted`
    ).toBe(true);
  });

  it("AC-1b: the wave-append re-entry re-runs the run-scope hop, not only the final pass", () => {
    // The appended wave's commits are the only ones a run-scope review could newly reach, and
    // skipping the hop also advances run_diff_window.head_sha past the window the close record
    // already claims — so the correct behaviour and the incorrect one would both end in a mismatch.
    const reentry = line(body(read(copy)), /wave-N\+1 을 추가해 처리한다/);
    expect(reentry, `${copy}: the re-entry rule must exist`).not.toBe("");
    expect(
      /§5\.55 와 §5\.6/.test(reentry),
      `${copy}: the re-entry must name the run-scope hop alongside the final pass`
    ).toBe(true);
  });

  it("AC-6b: the --auto safety gate enumerates the child this skill now spawns directly", () => {
    // §0.4 is the SSOT for what halts an unattended run. Left at two children while the skill
    // spawns three, the new child's NEEDS_USER falls to a committee-decidable class.
    const gate = line(body(read(copy)), /--auto 안전 게이트/);
    expect(gate, `${copy}: §0.4 must exist`).not.toBe("");
    expect(
      /kiwi-review-fix-loop/.test(gate),
      `${copy}: the directly-spawned review child must be named in the safety gate`
    ).toBe(true);
  });

  it("AC-6: a directly-invoked review loop has a halt gate of its own", () => {
    const gates = section(body(read(copy)), /^##\s*0\.G\b/);
    expect(gates, `${copy}: the gate table must exist`).not.toBe("");
    const row = lines(gates, /kiwi-review-fix-loop/);
    expect(
      row.length,
      `${copy}: without a row the halt falls to a committee-decidable class and --auto approves skipping it`
    ).toBeGreaterThan(0);
  });
});

describe("FR-FLOW-135 — refused by name, and the stale neighbours move", () => {
  it.each([...ORCHESTRATOR_COPIES, ...WAVE_COPIES])("AC-1/AC-2: %s refuses the opt-out spellings by name", (copy) => {
    const b = body(read(copy));
    const refusal = line(b, /--no-review-loop/);
    expect(refusal, `${copy}: the spelling a reader will reach for must be addressed`).not.toBe("");
    expect(/--skip-review-loop/.test(refusal), `${copy}: both spellings`).toBe(true);
    expect(
      /거부/.test(refusal),
      `${copy}: an ignored opt-out is worse than a refused one — it silently skips the loop`
    ).toBe(true);
  });

  it.each(ORCHESTRATOR_COPIES)("AC-3: %s's phase-flow diagram shows the step rung's hop", (copy) => {
    const row = line(body(read(copy)), /R-STEP\s*→/);
    expect(row, `${copy}: the diagram row must exist`).not.toBe("");
    expect(
      /review-fix-loop/.test(row),
      `${copy}: fenced, so neither the ledger nor the prose gate reads it — it stays stale silently`
    ).toBe(true);
  });

  it.each(["claude", "codex", "etc", ".agents"].map((v) =>
    v === ".agents" ? ".agents/skills/_shared/kiwi/loop-option.md" : `skills/${v}/_shared/kiwi/loop-option.md`
  ))("AC-4: %s's step-rung child set includes the review loop", (copy) => {
    const row = line(read(copy), /kiwi-orchestrator \|/);
    expect(row, `${copy}: the orchestrator's routed-child row must exist`).not.toBe("");
    expect(/kiwi-review-fix-loop/.test(row), `${copy}: the propagation set is now wider`).toBe(true);
  });
});

// The R-ORCH rung discharges the §4.5 obligation inside `§V.final-verify`, and that section is also
// the only place that tells a writer to emit `terminal_review` at all. Measured before this block was
// written: `§V.final-verify` had zero test readers, so a partial revert removing the hop, the window
// arguments or the emit instruction went green — and the validator's window rule has no producer the
// moment the emit instruction goes. Each assertion below is verified red against HEAD's copy.
describe.each(ORCHESTRATOR_COPIES)("FR-FLOW-131 — the R-ORCH rung discharges the obligation (%s)", (copy) => {
  const finalVerify = (): string => section(body(read(copy)), /^###\s*§V\.final-verify/);

  it("AC-7: the run-scope hop lives in the section, and runs before the pass is recorded", () => {
    const s = finalVerify();
    expect(s, `${copy}: §V.final-verify must exist`).not.toBe("");
    expect(
      /Skill\(\{\s*skill:\s*"kiwi-review-fix-loop"/.test(s),
      `${copy}: the R-ORCH rung must invoke the loop, not merely inherit the obligation`
    ).toBe(true);
    expect(
      /pass 를 기록하기 \*\*전에\*\*|기록하기 전에/.test(s),
      `${copy}: a hop that may run after the pass is recorded cannot gate the pass`
    ).toBe(true);
  });

  it("AC-8: the window is the run's and requirements are not closed run-wide", () => {
    const s = finalVerify();
    const call = s.slice(s.indexOf('Skill({ skill: "kiwi-review-fix-loop"'));
    const args = call.slice(0, call.indexOf("})") + 2);
    expect(args, `${copy}: the invocation must be readable`).not.toBe("");
    expect(/run_diff_window\.base_sha/.test(args) && /run_diff_window\.head_sha/.test(args)).toBe(true);
    expect(args.includes("--close-reqs"), `${copy}: a run-scope close would be a bulk finalize`).toBe(false);
  });

  it("AC-9: the section instructs the terminal_review write the validator's window rule reads", () => {
    const s = finalVerify();
    expect(/terminal_review/.test(s), `${copy}: without this instruction the gate has no producer`).toBe(true);
    for (const verdict of ["pass", "residual", "not-applicable-empty-window", "skipped-run-halted"]) {
      expect(s.includes(verdict), `${copy}: verdict ${verdict} must be reachable from the instruction`).toBe(true);
    }
    // Base equality, NOT base-and-head: the validator checks the base deliberately, because the
    // review's own fix is committed before the close line is written and so the run head is ahead of
    // `terminal_review.head` on every correct run. The instruction previously demanded both, which
    // made the documented record unsatisfiable as written — a writer following it exactly produced a
    // line the tool refuses. The assertion pins the half the tool actually enforces.
    expect(
      /`base` 는 그 줄의 `run_diff_window\.base_sha` 와 같아야 한다/.test(s),
      `${copy}: the writer must be told the base equality the validator refuses on`
    ).toBe(true);
    expect(
      /run head 와 같을 필요가 없다/.test(s),
      `${copy}: demanding head equality too would make a correct run unrecordable`
    ).toBe(true);
  });

  it("AC-10: the review's own fix is committed before the close line is written", () => {
    const s = finalVerify();
    expect(
      /커밋한 다음 run 종료 줄을 쓴다|커밋한 다음/.test(s),
      `${copy}: an uncommitted fix leaves terminal_review.head pointing past its own result`
    ).toBe(true);
  });
});

describe.each(ORCHESTRATOR_COPIES)("FR-FLOW-133 — the R-PLAN close is observable at all (%s)", (copy) => {
  // The run-close validator recognises a delegating rung's close by `outcome: "delegated-complete"`
  // on a dispatch-route result. R-STEP's close-out records it; R-PLAN's did not, so the rule this
  // change added swept past R-PLAN entirely — a gate that reads as covering three rungs while
  // reaching two. The tell was that `delegated-complete` occurred exactly once in the whole document.
  it("AC-6: the R-PLAN close-out records the outcome the run-close rule keys on", () => {
    const rung = planRung(read(copy));
    expect(rung, `${copy}: §4.5.2 must exist`).not.toBe("");
    expect(
      /delegated-complete/.test(rung),
      `${copy}: without the outcome token the R-PLAN close is invisible to the run-close validator`
    ).toBe(true);
  });

  it("AC-7: both delegating rungs record it, so the count is two rather than one", () => {
    expect(lines(body(read(copy)), /delegated-complete/).length).toBeGreaterThanOrEqual(2);
  });
});

describe("FR-FLOW-133 / FR-FLOW-135 — the two contracts the change left unasserted", () => {
  it.each(ORCHESTRATOR_COPIES)("FR-FLOW-133 AC-4: %s states what governs the R-PLAN hop", (copy) => {
    // Measured: the FR-FLOW-133 block had no AC-4 reader at all, and the nearest assertion reads
    // §4.5's preamble rather than §4.5.2 — so the rung's own replacement text was unprotected.
    const rung = planRung(read(copy));
    const governs = line(rung, /반환값에 조건 걸리지 않는다/);
    expect(governs, `${copy}: §4.5.2 must state that the hop is not keyed on the return value`).not.toBe("");
    for (const token of ["TASK_DONE", "NEEDS_USER", "FAILED", "§0.4"]) {
      expect(governs.includes(token), `${copy}: the replacement must name ${token}`).toBe(true);
    }
  });

  const ROUTING_COPIES = ["skills/claude", "skills/codex", "skills/etc", ".agents/skills"].map(
    (root) => `${root}/_shared/kiwi/pipeline-event.md`
  );

  it.each(ROUTING_COPIES)("FR-FLOW-135 AC-6: %s routes the step skill at the review loop", (copy) => {
    // The shared routing table is the SSOT for what follows a skill's TASK_DONE. It already pointed
    // kiwi-tdd at the review loop before this change, which is why nothing went red — and why it had
    // no reader. Left unasserted, a later edit of this table silently contradicts the rung.
    const row = line(read(copy), /^\|\s*kiwi-tdd\s*\|/);
    expect(row, `${copy}: the step skill must have a routing row`).not.toBe("");
    expect(
      /kiwi-review-fix-loop/.test(row),
      `${copy}: the table must agree with the rung that the review loop follows the step skill`
    ).toBe(true);
  });
});

describe.each(ORCHESTRATOR_COPIES)("FR-FLOW-133 — the delegating closes name their status value (%s)", (copy) => {
  // `status` is a REQUIRED field of every event, so a contract-conforming producer always writes
  // one — and neither close-out said which. The run-close rule reads the stated status in
  // preference to the outcome token, so an unspecified status leaves `in_progress` on a completing
  // close as a legal spelling that silences the refusal. Naming the value is what closes it.
  it("AC-7: both close-outs record status complete alongside the outcome token", () => {
    const b = body(read(copy));
    const rows = lines(b, /delegated-complete/);
    expect(rows.length, `${copy}: both delegating rungs must record the token`).toBeGreaterThanOrEqual(2);
    for (const row of rows) {
      expect(
        /status.{0,4}:?.{0,4}"?complete/.test(row),
        `${copy}: an unspecified status lets in_progress pass as a close: ${row.slice(0, 80)}`
      ).toBe(true);
    }
  });
});
