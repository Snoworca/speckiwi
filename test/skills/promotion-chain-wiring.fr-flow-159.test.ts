import { writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { REQUIREMENT_STATUSES } from "../../src/core/types.js";
import { REPO_ROOT } from "./kiwi-orchestrator-variants.js";
import { MIRROR_EXCLUDED, RENDERINGS, enclosingSection, flat, markdownFiles, numberedLists, readRepoFile } from "./kiwi-renderings.js";

// @req FR-FLOW-159 — the chain that promotes a requirement calls the tool that checks its
// acceptance criteria, and checks none without naming what passed it.
//
// BASELINE, measured on the shipped tree before this file existed (AC-5). `check_acceptance_criteria`
// occurred 28 times across `skills/` and `.agents/skills/`, and none of the 28 was in any of the
// eight implementation-chain skills — every one was in `kiwi-srs`, `kiwi-srs-from-code` or
// `kiwi-commit-auto-push`. The bare token was therefore NOT zero, and a record saying it was would
// be false. Of the phrases the per-criterion obligation is made of, `지목이 없는 AC 는 체크하지 않는다`
// and its English counterpart were zero; `AC 마다` was NOT — it occurred elsewhere in the tree, so
// the obligation is held by the golden and the section-scoped patterns rather than by that token.
//
// WHAT THIS FILE DOES NOT HOLD (AC-6). It reads the promotion sections and nothing else, so a
// sentence retracting the obligation elsewhere in the same file is caught only when it takes the
// form of a numbered list — the derivation below would surface that as an extra section the golden
// does not carry — and is NOT caught when written as prose. It observes no run: that an agent
// actually calls the tool is not asserted anywhere here, because the artifact is instruction. And
// it cannot tell a real test identifier from a fabricated one; that is FR-NODE-200's, and it needs
// the check tool to demand evidence covering the criterion it is asked to tick.

const SKILL = "kiwi-review-fix-loop";

/** The three calls of the promotion, in the order `update-status.ts` forces. */
const EVIDENCE = "add_verification_evidence";
const CHECK = "check_acceptance_criteria";
const TRANSITION = "update_status";

/**
 * A promotion sequence is a numbered list naming `update_status` and the status it transitions to.
 *
 * DERIVED, not listed. The alternative — naming the seven files — is a root list written by hand,
 * and a sequence added in an eighth place would simply not be read. Because the golden below
 * records every section this finds together with its path, a new sequence fails as a section the
 * golden lacks and a deleted one fails as a section the golden has.
 */
function promotionSections(): Array<{ rendering: string; relPath: string; text: string }> {
  const found: Array<{ rendering: string; relPath: string; text: string }> = [];
  for (const rendering of RENDERINGS) {
    if (rendering === ".agents/skills" && MIRROR_EXCLUDED.includes(SKILL)) continue;
    for (const relPath of markdownFiles(rendering, SKILL)) {
      const lines = readRepoFile(relPath).split("\n");
      for (const list of numberedLists(lines)) {
        if (!list.text.includes(TRANSITION) || !list.text.includes("verified")) continue;
        const section = enclosingSection(lines, list.start);
        if (section === null) continue;
        found.push({ rendering, relPath, text: section.text });
      }
    }
  }
  return found;
}

const SECTIONS = promotionSections();

const GOLDEN_PATH = "test/skills/promotion-chain-wiring.fr-flow-159.golden.md";
const SEPARATOR = "\n=== promotion section ===\n";

/** The golden's serialisation: path, then the section, one entry per compared span. */
function serialise(sections: ReadonlyArray<{ relPath: string; text: string }>): string {
  return sections.map((section) => `${section.relPath}\n---\n${section.text}`).join(SEPARATOR);
}

describe("FR-FLOW-159 AC-1 — the promotion names all three tools, in the order the gate forces", () => {
  it("finds a promotion sequence in every rendering that ships the skill", () => {
    const byRendering = new Map<string, number>();
    for (const section of SECTIONS) byRendering.set(section.rendering, (byRendering.get(section.rendering) ?? 0) + 1);
    const expected = RENDERINGS.filter((rendering) => !(rendering === ".agents/skills" && MIRROR_EXCLUDED.includes(SKILL)));
    for (const rendering of expected) {
      expect(
        byRendering.get(rendering) ?? 0,
        `${rendering}/${SKILL} declares no promotion sequence. A sequence is a numbered list naming \`${TRANSITION}\` and \`verified\`; if this rendering states the promotion in prose instead, restate it as that list, because a rule written in two vocabularies is a rule no scan can hold in both.`
      ).toBeGreaterThan(0);
    }
  });

  it.each(SECTIONS.map((section) => [section.relPath, section] as const))("%s: evidence, then check, then transition", (_relPath, section) => {
    const evidence = section.text.indexOf(EVIDENCE);
    const check = section.text.indexOf(CHECK);
    const transition = section.text.indexOf(TRANSITION);
    expect(evidence, `${section.relPath}: the promotion section does not name \`${EVIDENCE}\``).toBeGreaterThanOrEqual(0);
    expect(
      check,
      `${section.relPath}: the promotion section does not name \`${CHECK}\`. Without that call \`update-status.ts\` refuses the transition, because it requires every acceptance criterion checked — so a promotion sequence without it describes a mutation that always returns MUTATION_DENIED.`
    ).toBeGreaterThanOrEqual(0);
    expect(transition, `${section.relPath}: the promotion section does not name \`${TRANSITION}\``).toBeGreaterThanOrEqual(0);
    expect(
      evidence < check && check < transition,
      `${section.relPath}: the three calls are at offsets evidence=${evidence}, check=${check}, transition=${transition}. The gate reads the record after all three, so the order that matters is evidence, then check, then transition — a check placed after the transition ticks criteria the transition already failed on. The offsets are of the FIRST occurrence of each name inside the section; prose naming a tool ahead of the sequence would make this red without the rule being broken, which errs toward a false failure rather than a false pass.`
    ).toBe(true);
  });
});

describe("FR-FLOW-159 AC-2 — the whole section is held, so an inversion fails like a deletion", () => {
  // A presence check is satisfied by its own inversion: `check every criterion, naming the test`
  // and `check every criterion, naming nothing` both contain `check_acceptance_criteria`. The
  // golden is what separates them, and it covers the section rather than the list because the
  // obligation is stated in the sentence that introduces the list, not inside it.
  it("matches the checked-in golden byte for byte, over the derived set of sections", () => {
    const actual = serialise(SECTIONS);
    const golden = readRepoFile(GOLDEN_PATH);
    // The observed text is written beside the golden on any mismatch, and the golden is NEVER
    // written from here. A pipeline that refreshes a golden on failure records whatever was done
    // last, which is the one thing a golden must not do; the person who caused the diff reads it.
    if (actual !== golden) writeFileSync(path.join(REPO_ROOT, `${GOLDEN_PATH}.actual`), actual, "utf8");
    expect(
      golden.length,
      `${GOLDEN_PATH} is missing or empty, so every comparison here would be vacuous. The observed sections are now in ${GOLDEN_PATH}.actual — read them, then copy the file into place.`
    ).toBeGreaterThan(0);
    expect(
      actual,
      `${GOLDEN_PATH} no longer matches the promotion sections in the tree. Observed text written to ${GOLDEN_PATH}.actual; \`git diff --no-index\` the two before replacing the golden.`
    ).toBe(golden);
  });

  it("states the per-criterion obligation and its prohibition in every compared section", () => {
    for (const section of SECTIONS) {
      // Two independent halves of the same rule. The obligation says what to name; the prohibition
      // says what happens when nothing is named. A section carrying only the first reads as advice.
      expect(
        /AC 마다|per\s+acceptance\s+criterion|for\s+each\s+acceptance\s+criterion/i.test(section.text),
        `${section.relPath}: the promotion section does not oblige a per-criterion identifier. Checking a criterion is a mutation, and one made without naming what passed it turns the machine gate into a checkbox.`
      ).toBe(true);
      expect(
        /지목이 없는 AC 는 체크하지 않는다|do\s+not\s+check\s+a\s+criterion\s+for\s+which\s+no\s+such\s+identifier/i.test(section.text),
        `${section.relPath}: the promotion section obliges an identifier but does not forbid checking without one. An obligation with no stated refusal is satisfied by an agent that names nothing.`
      ).toBe(true);
    }
  });
});

describe("FR-FLOW-159 AC-3 — the allowance admits the check under the same two bounds", () => {
  /**
   * The §0 convention row that enumerates what `--close-reqs` may call.
   *
   * Keyed on the row's STRUCTURE — a table row whose first cell is a `§0.N` id — rather than on a
   * word like `허용`/`allows`, because a lexical key is defeated by a synonym and this one has to
   * separate the allowance from an artefact list that names the same tools and the same flag.
   */
  function allowanceLines(rendering: string): Array<{ relPath: string; line: string }> {
    const out: Array<{ relPath: string; line: string }> = [];
    for (const relPath of markdownFiles(rendering, SKILL)) {
      for (const line of readRepoFile(relPath).split("\n")) {
        if (!/^\|\s*§0\.\d+\s*\|/.test(line)) continue;
        if (line.includes("--close-reqs") && line.includes(TRANSITION) && line.includes(EVIDENCE)) out.push({ relPath, line });
      }
    }
    return out;
  }

  it.each(RENDERINGS.filter((rendering) => !(rendering === ".agents/skills" && MIRROR_EXCLUDED.includes(SKILL))))(
    "%s: the allowance names the check, bounded by --close-reqs and self mode",
    (rendering) => {
      const lines = allowanceLines(rendering);
      expect(
        lines.length,
        `${rendering}/${SKILL}: no line enumerates the \`--close-reqs\` tool allowance. That sentence is what §0.8's default mutation prohibition carves an exception out of; without it the exception has no stated bound.`
      ).toBeGreaterThan(0);
      for (const { relPath, line } of lines) {
        expect(line, `${relPath}: the allowance does not admit \`${CHECK}\`, so the promotion it permits cannot reach \`verified\`.`).toContain(CHECK);
        expect(
          /셀프 모드|self[- ]mode|self mode/i.test(line),
          `${relPath}: the allowance names the tools but not the self-mode bound. PR mode closing requirements is the case §0.6 refuses, and an unbounded allowance reopens it.`
        ).toBe(true);
      }
    }
  );

  it("names the same three tools wherever else the skill enumerates them", () => {
    // The allowance is not the only place this skill lists what it calls: the artefact section
    // names the tools its call log carries. Two enumerations of one set is two places to drift,
    // and the one outside the compared sections is the one a golden cannot see.
    for (const rendering of RENDERINGS.filter((entry) => !(entry === ".agents/skills" && MIRROR_EXCLUDED.includes(SKILL)))) {
      for (const relPath of markdownFiles(rendering, SKILL)) {
        for (const line of readRepoFile(relPath).split("\n")) {
          if (!line.includes("mcp_call_log") || !line.includes(TRANSITION)) continue;
          expect(
            line,
            `${relPath}: this line enumerates the mutation tools the call log carries but omits \`${CHECK}\`. The allowance and the log are two statements of one set; the one that lags is the one a reader trusts by accident.`
          ).toContain(CHECK);
        }
      }
    }
  });

  it("keeps mutation prohibited on the default path in every rendering", () => {
    for (const rendering of RENDERINGS.filter((entry) => !(entry === ".agents/skills" && MIRROR_EXCLUDED.includes(SKILL)))) {
      const bodies = markdownFiles(rendering, SKILL).map((relPath) => readRepoFile(relPath));
      expect(
        bodies.some((body) => /기본 동작은 종전대로 mutation 금지|Normal mode does not mutate SRS|기본 동작은 mutation 금지/i.test(body)),
        `${rendering}/${SKILL}: nothing states that the default path does not mutate SRS. Widening the allowance without that sentence makes the exception the rule.`
      ).toBe(true);
    }
  });
});

describe("FR-FLOW-159 AC-4 — kiwi-coder names one transition status, and it is one the gate admits", () => {
  // Global, and read with `matchAll`: a non-global `exec` returns the FIRST match per file, so a
  // second statement of the rule in the same file — carrying a different value — would never be
  // seen and the count would still read one. That is the drift this criterion exists to catch.
  const RULE = /모든 ac 가 green_evidence 보유[^\n]*?→\s*"([a-z_]+)"/g;

  function transitionValues(): Array<{ rendering: string; relPath: string; value: string }> {
    const out: Array<{ rendering: string; relPath: string; value: string }> = [];
    for (const rendering of RENDERINGS) {
      if (rendering === ".agents/skills" && MIRROR_EXCLUDED.includes("kiwi-coder")) continue;
      for (const relPath of markdownFiles(rendering, "kiwi-coder")) {
        for (const match of readRepoFile(relPath).matchAll(RULE)) out.push({ rendering, relPath, value: match[1] as string });
      }
    }
    return out;
  }

  it("states the rule exactly once per rendering", () => {
    const values = transitionValues();
    const byRendering = new Map<string, number>();
    for (const value of values) byRendering.set(value.rendering, (byRendering.get(value.rendering) ?? 0) + 1);
    for (const rendering of RENDERINGS.filter((entry) => !(entry === ".agents/skills" && MIRROR_EXCLUDED.includes("kiwi-coder")))) {
      expect(
        byRendering.get(rendering) ?? 0,
        `${rendering}/kiwi-coder: the all-criteria-green transition rule appears ${byRendering.get(rendering) ?? 0} times. One is the contract; two are two places to drift, which is how this rule came to say different things in different renderings.`
      ).toBe(1);
    }
  });

  it("names the same status in every rendering, and that status is one the code defines", () => {
    const values = transitionValues();
    expect(values.length, "no rendering states the transition rule at all").toBeGreaterThan(0);
    const distinct = [...new Set(values.map((value) => value.value))];
    expect(
      distinct.length,
      `kiwi-coder's transition rule reads ${JSON.stringify(values.map((value) => `${value.rendering}=${value.value}`))}. The renderings are compared to each other rather than to a literal, so this fails on any disagreement — including one where the rendering you are looking at is the correct one.`
    ).toBe(1);
    const value = distinct[0] as string;
    expect(REQUIREMENT_STATUSES as readonly string[], `kiwi-coder targets \`${value}\`, which is not a status the code defines`).toContain(value);
    expect(
      value,
      `kiwi-coder targets \`${value}\`. It registers verification evidence — §0.12 admits \`add_verification_evidence\` and its sequence calls it — but checks no acceptance criterion, so the all-criteria-checked half of update-status.ts's gate is never satisfied and \`verified\` is refused. The only value it can actually reach is \`implemented\`.`
    ).toBe("implemented");
  });

  // Two clauses, asserted apart. A boundary that names its successor without naming its reason
  // reads as a hand-off, and the next editor raises the value back; a reason with no successor
  // leaves the work unassigned. Deleting either one alone has to be red, which one combined
  // pattern cannot do.
  it.each(RENDERINGS.filter((entry) => !(entry === ".agents/skills" && MIRROR_EXCLUDED.includes("kiwi-coder"))))(
    "%s: names the successor of the transition, and why this rule stops short of it",
    (rendering) => {
      const body = flat(markdownFiles(rendering, "kiwi-coder").map((relPath) => readRepoFile(relPath)).join("\n"));
      expect(
        /`verified` 전이는[^|]*kiwi-review-fix-loop --close-reqs/.test(body),
        `${rendering}/kiwi-coder: nothing says which skill does perform the \`verified\` transition. A rule that stops at \`implemented\` without naming what continues reads as an omission rather than a boundary.`
      ).toBe(true);
      expect(
        /check_acceptance_criteria` 를 부르지 않으므로[^|]*MUTATION_DENIED/.test(body),
        `${rendering}/kiwi-coder: the body names the successor but not the reason this rule targets \`implemented\`. Without the reason the value reads as a preference, and the next editor raises it back to \`verified\` — which the gate then refuses at run time instead of here.`
      ).toBe(true);
    }
  );
});
