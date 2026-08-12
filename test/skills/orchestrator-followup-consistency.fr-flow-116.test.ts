import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// @req FR-FLOW-116  kiwi-tdd declares critical_gates[] — which falsifies a statement kiwi-pipeline
//                   §2.8 has carried since it shipped, so the two are pinned against each other here.
// @req FR-FLOW-113  the --session-suffix / --no-final semantics
// @req FR-FLOW-114  --no-pipeline-emit
// @req FR-FLOW-115  --commit-lane-work
//
// Two follow-ups the reviewing agent routed back:
//
// (b) `kiwi-pipeline` §2.8 states, as a reason for excluding `--cycle` / `--from=` entries from tdd
//     routing, that "kiwi-tdd declares no critical_gates[]". FR-FLOW-116 gives it one. Shipping both
//     sentences in one release is worse than either reading of FR-FLOW-117 AC-2, so §2.8's premise is
//     corrected and the two files are pinned against each other below — the CONCLUSION (the exclusion)
//     is unchanged; only the false premise moves.
//
// (c) `kiwi-pm`'s §6.1 / §6.2 / §10 live inside SKILL.md in the claude rendering and inside
//     `references/extended-workflow.md` in the codex, etc and mirror renderings. The flag semantics
//     are complete in §1.5 of all four SKILL.md copies, but a codex or etc user reads the references
//     file — and it otherwise describes a `kiwi-pm` that behaves differently from the one they have.
//
// NOTE ON OWNERSHIP: `kiwi-pm/SKILL.md` is edited by another agent under FR-FLOW-067 and is
// deliberately NOT asserted here. Every assertion below reads either `kiwi-pipeline/SKILL.md`,
// `kiwi-tdd/SKILL.md`, or `kiwi-pm/references/extended-workflow.md`.

const REPO_ROOT = fileURLToPath(new URL("../../", import.meta.url));

const VARIANT_ROOTS = ["skills/claude", "skills/codex", "skills/etc", ".agents/skills"] as const;

const PIPELINE_COPIES = VARIANT_ROOTS.map((root) => `${root}/kiwi-pipeline/SKILL.md`);
const TDD_COPIES = VARIANT_ROOTS.map((root) => `${root}/kiwi-tdd/SKILL.md`);

/** The renderings that carry kiwi-pm's extended workflow as a separate reference document. The
 * claude rendering carries those sections inline in SKILL.md instead, so it is absent here by
 * construction rather than by omission — the list is asserted, not discovered, so a rendering that
 * gains or loses the file fails loudly. */
const PM_REFERENCE_COPIES = [
  "skills/codex/kiwi-pm/references/extended-workflow.md",
  "skills/etc/kiwi-pm/references/extended-workflow.md",
  ".agents/skills/kiwi-pm/references/extended-workflow.md"
] as const;

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

/** Whether a skill body declares a `critical_gates[]` table with at least one backticked gate id.
 *
 * EXISTENCE only, deliberately. The exact three-member set and its cross-variant equality are
 * FR-FLOW-116's own assertions in `orchestrator-tdd-routing.fr-flow-116.test.ts`; duplicating them
 * here would give two places to update and no extra protection. What this predicate is for is the
 * narrower question §2.8's premise turns on: does kiwi-tdd declare a table at all? A mutation that
 * renames or drops ONE gate is caught by the sibling suite and is correctly invisible here. */
function declaresCriticalGates(text: string): boolean {
  const gates = section(text, /^#{2,4}\s.*critical_gates/i);
  if (gates === "") return false;
  return gates.split("\n").some((l) => /^\s*\|\s*`[a-z0-9-]+`\s*\|/.test(l));
}

// ---------------------------------------------------------------------------------------------
// (b) kiwi-pipeline §2.8 must not contradict kiwi-tdd's own declaration
// ---------------------------------------------------------------------------------------------

describe("FR-FLOW-116 — kiwi-pipeline §2.8 and kiwi-tdd's gate declaration cannot drift", () => {
  it("covers the same four renderings for both skills", () => {
    expect(PIPELINE_COPIES).toHaveLength(4);
    expect(TDD_COPIES).toHaveLength(4);
  });

  // The premise. This is the assertion that makes the pair a pinned invariant rather than a one-off
  // repair: it reads BOTH files, so restoring either sentence alone fails.
  it.each(VARIANT_ROOTS)(
    "%s does not claim kiwi-tdd declares no critical gates while kiwi-tdd declares them",
    (root) => {
      const tdd = read(`${root}/kiwi-tdd/SKILL.md`);
      const pipeline = read(`${root}/kiwi-pipeline/SKILL.md`);
      const twoEight = section(pipeline, /^##\s*2\.8/);
      expect(twoEight, `${root}: kiwi-pipeline must have a section 2.8`).not.toBe("");

      // Guard the guard: if kiwi-tdd ever loses its table the statement stops being false, and this
      // test must fail rather than quietly permit the old sentence again.
      expect(
        declaresCriticalGates(tdd),
        `${root}: kiwi-tdd must declare a critical_gates table — FR-FLOW-116 is what falsifies §2.8's old premise`
      ).toBe(true);

      expect(
        /`critical_gates\[\]`\s*를?\s*선언하지 않아|declares no `?critical_gates/.test(twoEight),
        `${root}: §2.8 must not state that kiwi-tdd declares no critical_gates — it now does (§0.AG)`
      ).toBe(false);
      expect(
        /`--auto` 가 비활성|`--auto` is inactive/.test(twoEight),
        `${root}: §2.8 must not state that --auto is inactive for kiwi-tdd — the declaration activates it`
      ).toBe(false);
    }
  );

  // The corrected premise has to say something true and load-bearing, not just delete the false
  // clause: unattended completion still does not hold, and the reason is now the critical gates
  // themselves rather than a missing table.
  it.each(PIPELINE_COPIES)("%s gives a true first reason for the cycle exclusion", (copy) => {
    const twoEight = section(read(copy), /^##\s*2\.8/);
    const rule = line(twoEight, /근거 둘|two reasons/);
    expect(rule, `${copy} the exclusion must still carry its two reasons`).not.toBe("");
    expect(
      /§0\.AG|critical_gates/.test(rule),
      `${copy} the corrected reason must point at the table kiwi-tdd now declares`
    ).toBe(true);
    expect(
      /무인 완주가 성립하지 않는다|unattended/.test(rule),
      `${copy} the conclusion — unattended completion does not hold — must survive the correction`
    ).toBe(true);
    // Reason (2) is untouched by FR-FLOW-116 and must not have been collaterally rewritten.
    expect(
      /증거 번들이 성립하지 않는다/.test(rule),
      `${copy} the evidence-bundle reason must survive unchanged`
    ).toBe(true);
    // @req FR-FLOW-126 — the conclusion the two reasons support still must not move, but its KEY
    // has. This assertion used to pin the sentence verbatim, on the reasoning that only the false
    // premise moves. Once FR-FLOW-124 made the cycle the default, keying the exclusion on cycle
    // entry made it true of every invocation, so pinning the sentence would have mandated a §2.8
    // that can never fire — and both reasons above are properties of a delegated wave run, not of
    // a flag. What is pinned now is that the exclusion survives, keyed on delegation, and that the
    // document says in its own words that the default cycle alone does not earn it.
    const exclusion = line(twoEight, /적용 대상이 아니다/);
    expect(exclusion, `${copy} the exclusion must still exist`).not.toBe("");
    // Not `/--from=|…/`: the pre-flip sentence carried `--from=` as well, so that disjunction is
    // green on exactly the text this check exists to reject.
    expect(
      /위임 진입/.test(exclusion),
      `${copy} the exclusion must key on delegated entry, not on the chain being active`
    ).toBe(true);
    expect(
      /`--cycle` \/ `--from=` 진입은 본 라우팅의 적용 대상이 아니다/.test(twoEight),
      `${copy} keyed on cycle entry the exclusion swallows every invocation and §2.8 never fires`
    ).toBe(false);
    const alone = line(twoEight, /기본 사이클/);
    expect(alone, `${copy} §2.8 must say what running the default cycle alone does NOT do`).not.toBe("");
    expect(
      /만으로는|그 자체로는/.test(alone) && /않는다|아니다/.test(alone),
      `${copy} a reader who knows the cycle is the default would otherwise re-derive the dead gate`
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------------------------
// (c) the extended-workflow reference must describe the kiwi-pm its reader actually has
// ---------------------------------------------------------------------------------------------

describe("FR-FLOW-113/114/115 — kiwi-pm's extended workflow reference carries the flag pointers", () => {
  it("covers exactly the renderings that carry the reference document", () => {
    expect(PM_REFERENCE_COPIES).toHaveLength(3);
    for (const copy of PM_REFERENCE_COPIES) {
      expect(existsSync(path.join(REPO_ROOT, copy)), `${copy} must exist`).toBe(true);
    }
    // The claude rendering carries these sections inline in SKILL.md; it must NOT grow a reference
    // file, or the two would be two sources for one contract.
    expect(
      existsSync(path.join(REPO_ROOT, "skills/claude/kiwi-pm/references/extended-workflow.md")),
      "the claude rendering keeps these sections inline and must not gain a reference copy"
    ).toBe(false);
  });

  // FR-FLOW-115 AC-5: §6.1's "PM never commits automatically" is false under the flag, and this file
  // is where a codex or etc reader meets that sentence.
  it.each(PM_REFERENCE_COPIES)("%s names --commit-lane-work as the no-auto-commit exception", (copy) => {
    const rule = line(read(copy), /자동 commit/);
    expect(rule, `${copy} must keep the no-automatic-commit rule`).not.toBe("");
    expect(
      /--commit-lane-work/.test(rule),
      `${copy} the no-automatic-commit rule must name --commit-lane-work as its one exception`
    ).toBe(true);
  });

  // FR-FLOW-113 AC-6: T-final is conditional under --no-final.
  it.each(PM_REFERENCE_COPIES)("%s states that --no-final suppresses T-final promotion", (copy) => {
    const tFinal = section(read(copy), /^###\s*6\.2/);
    expect(tFinal, `${copy} must carry the T-final section`).not.toBe("");
    expect(
      /--no-final/.test(tFinal),
      `${copy} the T-final section must state that --no-final suppresses it`
    ).toBe(true);
    expect(
      /`all_done`|분모/.test(tFinal),
      `${copy} the reason must name the all-done denominator that would otherwise be one unit's subset`
    ).toBe(true);
  });

  // FR-FLOW-114 AC-2/AC-4: the pipeline emit is suppressed under the flag.
  it.each(PM_REFERENCE_COPIES)("%s states that --no-pipeline-emit suppresses the append", (copy) => {
    const emit = section(read(copy), /^##\s*10\./);
    expect(emit, `${copy} must carry the pipeline-emit section`).not.toBe("");
    expect(
      /--no-pipeline-emit/.test(emit),
      `${copy} the emit section must state that --no-pipeline-emit suppresses the append`
    ).toBe(true);
    expect(
      /거짓|false|잘못 기술/.test(emit),
      `${copy} the consequence of omitting the flag — a record that misdescribes the run — must be stated`
    ).toBe(true);
  });

  // All three renderings must say the same thing; the mirror renders the codex variant, and etc is a
  // separate translation, so a set comparison on the three added pointers catches a partial edit.
  it("adds the same three pointers to every rendering that carries the file", () => {
    const found = PM_REFERENCE_COPIES.map((copy) => {
      const text = read(copy);
      return {
        copy,
        commit: /--commit-lane-work/.test(text),
        noFinal: /--no-final/.test(text),
        noEmit: /--no-pipeline-emit/.test(text)
      };
    });
    for (const row of found) {
      expect(row, `${row.copy} must carry all three pointers`).toEqual({
        copy: row.copy,
        commit: true,
        noFinal: true,
        noEmit: true
      });
    }
  });
});
