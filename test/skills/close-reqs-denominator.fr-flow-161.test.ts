import { writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { REPO_ROOT } from "./kiwi-orchestrator-variants.js";
import { MIRROR_EXCLUDED, RENDERINGS, enclosingSection, flat, markdownFiles, readRepoFile } from "./kiwi-renderings.js";

// @req FR-FLOW-161 — the set a close run must account for comes from the tool, and a run that
// closed none of it does not report done.
//
// BASELINE, measured on the shipped tree before this file existed (AC-1, AC-3). `list_requirements`
// occurred exactly once in the whole skill across four renderings — claude's section-zero read
// carve-out — and zero times in codex, etc and the mirror. The zero-candidate row read `skip and
// report` in three of the four and `skip + 보고` in claude. The claude terminal-status rule named only immediate
// fixes and regression; codex and etc stated the field as a bare value enumeration with no rule at
// all, which is why the two halves are asserted separately below.
//
// WHAT THIS FILE DOES NOT HOLD (AC-8). Every assertion reads instruction text. A skill that carries
// the rule and ignores it at run time is not caught here, and nothing here observes a run. It also
// cannot see the case FR-NODE-198 owns: a requirement written with a status outside the enum never
// enters `list_requirements { status: "implemented" }`, so the denominator does not know it and the
// identity holds while the requirement is invisible. AC-5's duty to report the denominator's size
// is what makes that visible to a person instead.

const SKILL = "kiwi-review-fix-loop";
const SHIPPED = RENDERINGS.filter((rendering) => !(rendering === ".agents/skills" && MIRROR_EXCLUDED.includes(SKILL)));

/** The whole skill, flattened, for rules stated across a wrapped line. */
function body(rendering: string): string {
  return flat(markdownFiles(rendering, SKILL).map((relPath) => readRepoFile(relPath)).join("\n"));
}

describe("FR-FLOW-161 AC-1 — the denominator comes from the tool, not from the skill", () => {
  it.each(SHIPPED)("%s: names the read that produces it, and the read that resolves the target", (rendering) => {
    const text = body(rendering);
    expect(
      text,
      `${rendering}/${SKILL}: nothing tells this skill to obtain its accountable set from \`list_requirements\`. While the skill extracts the set itself, extracting less is a way past any gate keyed on it, and a reporting duty laid on the same actor only produces a second self-declaration.`
    ).toContain("list_requirements");
    // Keyed on the HALT RULE, not on the tool name and not on proximity. claude's section-zero
    // read carve-out names `get_active_target`, `summarize_target` and `list_requirements` inside
    // one parenthesis, so both a containment check and a 400-character proximity check are
    // satisfied by that row alone — measured, deleting the whole target-resolution instruction
    // left both green. What that row cannot say is what to do when the target does not resolve.
    expect(
      /해소하지 못하면[^|]{0,80}(멈춘다|보고하고 멈춘다)|cannot be resolved[^|]{0,120}stop/i.test(text),
      `${rendering}/${SKILL}: nothing says what to do when the target cannot be resolved. A denominator built for the wrong target is wrong wholesale and nothing downstream can tell, so the instruction has to refuse rather than guess — and unlike the tool's name, that refusal is not stated anywhere else in this skill.`
    ).toBe(true);
    // The status filter has to be part of the instruction: `list_requirements` with no status
    // returns everything, and an accountable set that includes `planned` work fires the gate on
    // requirements nobody claimed to close.
    expect(
      /list_requirements[^|]{0,200}implemented/.test(text),
      `${rendering}/${SKILL}: \`list_requirements\` is named but not bound to \`status: "implemented"\` within reach of the call. Without that filter the set includes work this run never claimed.`
    ).toBe(true);
  });

  it.each(SHIPPED)("%s: the step that transitions names its domain in the vocabulary defined above", (rendering) => {
    // Defining the denominator at the top and then transitioning over a self-extracted candidate
    // list moves the vocabulary, not the source. Measured before this was fixed: claude defined
    // `scoped` and `eligible` in one section and ran its mutation loop over `high-confidence REQ`
    // with an artifact called `candidates` in the next — two vocabularies, and the operative one
    // was still the skill's own.
    const text = body(rendering);
    expect(
      /각 `eligible` REQ|for each `?eligible`? (REQ|requirement)/i.test(text),
      `${rendering}/${SKILL}: the mutation loop states its domain as something other than \`eligible\`. The vocabulary this requirement defines has to reach the step that actually transitions, or the denominator is decorative.`
    ).toBe(true);
    expect(
      /high-confidence REQ 에 대해|for each high-confidence REQ/i.test(text),
      `${rendering}/${SKILL}: the mutation loop still ranges over a self-extracted candidate list. That is the source this requirement moved out of the skill.`
    ).toBe(false);
  });

  it.each(SHIPPED)("%s: both calls stay reads, so the tool allowance is unchanged", (rendering) => {
    // FR-FLOW-159 fixed the allowance at three mutations. This requirement adds no mutation — both
    // calls are reads — so an allowance that grew here would mean something else was let in.
    const rows = markdownFiles(rendering, SKILL)
      .flatMap((relPath) => readRepoFile(relPath).split("\n"))
      .filter((line) => /^\|\s*§0\.\d+\s*\|/.test(line) && line.includes("--close-reqs") && line.includes("update_status"));
    expect(rows.length, `${rendering}/${SKILL}: the section-zero allowance row vanished`).toBeGreaterThan(0);
    for (const row of rows) {
      // SET EQUALITY over the allowance clause. Filtering a fixed three-name list and counting to
      // three has an upper bound of three by construction, so it catches a tool removed and never
      // one added — measured, appending `add_requirement` to the row and calling it four passed.
      // The clause is cut at the marker that opens it because the same row states the prohibition
      // first, and that half legitimately names the tools this skill must NOT call.
      const clause = (row.split(/\*\*예외 \(옵션 opt-in\)\*\*:|allows exactly three mutations/)[1] ?? "").split(/read 호출|read calls/)[0] ?? "";
      expect(clause.length, `${rendering}/${SKILL}: the allowance clause could not be separated from the prohibition in its own row`).toBeGreaterThan(0);
      const named = [...clause.matchAll(/`([a-z_]+)`/g)].map((match) => match[1] as string).filter((token) => token.includes("_"));
      expect(
        [...new Set(named)].sort(),
        `${rendering}/${SKILL}: the allowance clause names ${JSON.stringify([...new Set(named)].sort())}. This requirement introduces reads only, so the mutation set is exactly the three FR-FLOW-159 fixed; a fourth here was not asked for.`
      ).toEqual(["add_verification_evidence", "check_acceptance_criteria", "update_status"]);
    }
  });
});

describe("FR-FLOW-161 AC-2 — every requirement in the scoped set gets exactly one disposition", () => {
  it.each(SHIPPED)("%s: states the accounting identity and that a run failing it is invalid", (rendering) => {
    const text = body(rendering);
    expect(
      /전이 성공 수 \+ 제외 수 = scoped 크기|transitioned \+ excluded == scoped|transitioned plus excluded equals the scoped set/i.test(text),
      `${rendering}/${SKILL}: the accounting identity is not stated. It is what turns under-extraction into a count that does not add up: a candidate quietly dropped leaves the totals unequal rather than leaving the gate unfired.`
    ).toBe(true);
    expect(
      /항등식이 성립하지 않으면 그 실행은 무효|a run whose dispositions do not account for the whole scoped set is invalid|does not add up.{0,80}invalid/i.test(text),
      `${rendering}/${SKILL}: the identity is stated without saying what a run that fails it is. An identity with no consequence is arithmetic, not a gate.`
    ).toBe(true);
  });
});

describe("FR-FLOW-161 AC-3 — the terminal status takes the promotion result as a condition", () => {
  /**
   * The line stating the terminal status, DERIVED: the line naming both the `status` field and
   * `TASK_DONE`, recorded together with the heading it sits under. Measured, that heading is
   * `### 7.3 Pipeline event emit (의무)` in claude and `## Pipeline Event` in codex, etc and the
   * mirror — two spellings across four renderings, which is why it is derived rather than named.
   *
   * The golden holds the RULE LINE, not the enclosing section. Freezing the section would drag
   * in whatever else lives under that heading — in claude, the `--no-pipeline-emit` paragraphs
   * FR-FLOW-114 owns — and would refuse that requirement's edits under a message about terminal
   * status. FR-FLOW-155 REJECTED exactly that widening for this reason and its Implementation
   * Notes record why; what it paid instead was a closed vocabulary, which turned seven legitimate
   * edits red. What the narrower scope gives up: a sentence contradicting this rule elsewhere in
   * the same section is caught only by the pattern checks above, which survive their own inversion.
   */
  function terminalSections(): Array<{ rendering: string; relPath: string; heading: string; rule: string; kind: "terminal" | "identity" }> {
    const found: Array<{ rendering: string; relPath: string; heading: string; rule: string; kind: "terminal" | "identity" }> = [];
    for (const rendering of SHIPPED) {
      for (const relPath of markdownFiles(rendering, SKILL)) {
        const lines = readRepoFile(relPath).split("\n");
        lines.forEach((line, index) => {
          // Two rule lines, both derived: the one stating the terminal status, and the one stating
          // the accounting identity. The identity is here rather than under a presence check
          // because a presence check is satisfied by a sentence that QUOTES the rule and then
          // retracts it — measured, `... 는 참고 지표일 뿐이며 강제하지 않는다` followed by the
          // original clause and `라는 낡은 규칙은 폐기한다` kept both AC-2 assertions green. That
          // is the cheapest edit that disables a gate, and only a byte comparison refuses it.
          const isTerminal = line.includes("TASK_DONE") && /status/i.test(line);
          const isIdentity = /전이 성공 수 \+ 제외 수|Accounting identity/.test(line);
          if (!isTerminal && !isIdentity) return;
          const section = enclosingSection(lines, index);
          if (section === null) return;
          found.push({ rendering, relPath, heading: (lines[section.start] as string).trim(), rule: line.trim(), kind: isTerminal ? "terminal" : "identity" });
        });
      }
    }
    return found;
  }

  const SECTIONS = terminalSections();
  const GOLDEN_PATH = "test/skills/close-reqs-denominator.fr-flow-161.golden.md";
  const SEPARATOR = "\n=== terminal status section ===\n";

  it("finds the terminal-status section in every shipped rendering", () => {
    for (const rendering of SHIPPED) {
      expect(
        SECTIONS.filter((section) => section.rendering === rendering && section.kind === "terminal").length,
        `${rendering}/${SKILL}: no section states the terminal status. The rule this requirement adds has nowhere to live.`
      ).toBeGreaterThan(0);
    }
  });

  it.each(SECTIONS.filter((section) => section.kind === "terminal").map((section) => [section.relPath, section] as const))("%s: the rule names the promotion result", (_relPath, section) => {
    const text = flat(section.rule);
    expect(
      /eligible[^|]{0,60}(1 이상|>= ?1|at least one)/i.test(text),
      `${section.relPath}: the terminal-status rule does not condition on there having been something to close. Without that condition the gate fires on runs with nothing eligible.`
    ).toBe(true);
    expect(
      /전이 0건|transitioned[^|]{0,20}(is )?zero|zero transitions|closed none/i.test(text),
      `${section.relPath}: the terminal-status rule does not condition on the promotion result. A run that found candidates and closed none of them still reports \`TASK_DONE\`, which is the defect this requirement exists to remove.`
    ).toBe(true);
  });

  it("matches the checked-in golden byte for byte, over the derived set of sections", () => {
    const actual = SECTIONS.map((section) => `${section.relPath}\n${section.heading}\n---\n${section.rule}`).join(SEPARATOR);
    const golden = readRepoFile(GOLDEN_PATH);
    // Never written from here, for the reason `promotion-chain-wiring.fr-flow-159.test.ts` records
    // beside its own golden: a pipeline that refreshes a golden on failure records whatever was
    // done last, which is the one thing a golden must not do.
    if (actual !== golden) writeFileSync(path.join(REPO_ROOT, `${GOLDEN_PATH}.actual`), actual, "utf8");
    expect(
      golden.length,
      `${GOLDEN_PATH} is missing or empty, so every comparison here would be vacuous. The observed sections are now in ${GOLDEN_PATH}.actual — read them, then copy the file into place.`
    ).toBeGreaterThan(0);
    expect(actual, `${GOLDEN_PATH} no longer matches the terminal-status sections in the tree.`).toBe(golden);
  });
});

describe("FR-FLOW-161 AC-4 — the deliberate non-closures stay counted and stay out of eligibility", () => {
  it.each(SHIPPED)("%s: names both exclusions and keeps them inside the scoped set", (rendering) => {
    const text = body(rendering);
    expect(
      /산문 증거[^|]{0,120}eligible|prose[^|]{0,120}excluded from eligibility|excluded from eligibility[^|]{0,120}prose/i.test(text),
      `${rendering}/${SKILL}: the prose-evidence carve-out is not tied to eligibility. Leaving it in eligibility makes the gate fire on an obligation this skill cannot discharge — it reviews only code.`
    ).toBe(true);
    expect(
      /`scoped` 에는 남고|remain in the scoped set|stays in the scoped set/i.test(text),
      `${rendering}/${SKILL}: an excluded requirement is dropped rather than kept with a reason. Dropping it from the scoped set makes the identity blind to exactly the requirements a person still has to act on.`
    ).toBe(true);
    // The stability half, asserted separately. Measured: deleting `draft` and `deprecated` from
    // this skill entirely — zero occurrences of either — left every other assertion green, because
    // neither value appeared in any pattern. Half of what AC-4 names was unchecked.
    expect(
      /`draft`[\s\S]{0,60}`deprecated`[\s\S]{0,200}eligible|eligible[\s\S]{0,200}`draft`[\s\S]{0,60}`deprecated`/i.test(text),
      `${rendering}/${SKILL}: the stability exclusions are not tied to eligibility. \`draft\` and \`deprecated\` are the other half of what this requirement excludes, and a requirement in either state cannot be promoted at all — leaving them in eligibility fires the gate on work nobody could close.`
    ).toBe(true);
  });
});

describe("FR-FLOW-161 AC-5 — the accounting is enumerated, not summarised", () => {
  it.each(SHIPPED)("%s: requires a row per requirement and a reason when the set is empty", (rendering) => {
    const text = body(rendering);
    expect(
      /REQ 단위로 행으로 열거|enumerat\w+[^|]{0,60}one row per requirement|one row per requirement/i.test(text),
      `${rendering}/${SKILL}: the report may summarise the scoped set. Nobody can then check the identity by hand, and an identity nobody can check makes obtaining the denominator externally pointless.`
    ).toBe(true);
    expect(
      /분모 크기|`denominator` 의 크기|denominator's size|size of the denominator/i.test(text),
      `${rendering}/${SKILL}: a run whose scoped set is empty does not report the denominator's size. That number is the only thing that makes FR-NODE-198's case visible — a requirement whose status is outside the enum never enters the denominator at all.`
    ).toBe(true);
  });
});

describe("FR-FLOW-161 AC-6 — the terminal value comes from the shared contract", () => {
  /** The status enum the shared event contract declares, read rather than restated. */
  function contractStatuses(rendering: string): string[] {
    const row = readRepoFile(`${rendering}/_shared/kiwi/pipeline-event.md`)
      .split("\n")
      .find((line) => /^\|\s*`status`\s*\|/.test(line));
    return [...(row ?? "").matchAll(/`([A-Z_]+)`/g)].map((match) => match[1] as string);
  }

  it.each(SHIPPED)("%s: uses only values the contract declares", (rendering) => {
    const declared = contractStatuses(rendering);
    expect(declared.length, `${rendering}: the shared event contract declares no status enum`).toBeGreaterThan(0);
    expect(declared, `${rendering}: the contract no longer declares TASK_DONE`).toContain("TASK_DONE");
    const used = new Set([...body(rendering).matchAll(/`(TASK_DONE|NEEDS_USER|FAILED|DRY_RUN|CORRECTION|[A-Z]{4,}_[A-Z_]+)`/g)].map((match) => match[1] as string));
    const invented = [...used].filter((value) => !declared.includes(value) && /^[A-Z_]+$/.test(value) && value !== "MUTATION_DENIED");
    expect(
      invented,
      `${rendering}/${SKILL}: these terminal-looking values are not in the shared contract's enum. A new value has to be added there first, because \`kiwi-pipeline\` reads that contract to route on it.`
    ).toEqual([]);
  });
});

describe("FR-FLOW-161 AC-7 — the orchestrator's description matches what this skill now does", () => {
  it.each(SHIPPED)("%s: no longer says this skill does not gate on skipped requirements", (rendering) => {
    const text = flat(markdownFiles(rendering, "kiwi-orchestrator").map((relPath) => readRepoFile(relPath)).join("\n"));
    expect(
      /그것으로 게이트하지 않는다|does not gate on it/.test(text),
      `${rendering}/kiwi-orchestrator: still describes \`--close-reqs\` as skipping and reporting without gating. After this change that is false, and a description that lags the thing it describes is the failure shape FR-FLOW-160 exists to remove.`
    ).toBe(false);
  });

  it.each(SHIPPED)("%s: keeps its own compensating gate", (rendering) => {
    // The double defence stays. Only the sentence changes: a rung that stopped compensating because
    // the skill below started gating has no defence left the day that gate is loosened.
    const text = flat(markdownFiles(rendering, "kiwi-orchestrator").map((relPath) => readRepoFile(relPath)).join("\n"));
    // Keyed on the gate's own id, not on the flag. `close-reqs` occurs in eight places in this
    // skill — an invocation argument among them — so a check for it passes with the gate and its
    // three disjuncts deleted. A defence asserted by a string that survives its removal is a
    // declared defence, not a kept one.
    expect(
      text,
      `${rendering}/kiwi-orchestrator: the compensating close gate was removed along with the sentence describing it. Correcting a description is not a reason to drop a defence.`
    ).toContain("plan-coverage-unclosed");
  });
});
