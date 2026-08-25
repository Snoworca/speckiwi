import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// @req FR-FLOW-153 — the prohibition on reviewing research prose reaches the shipped skills.
//
// FR-FLOW-137 already states the rule and is Status=verified. Its AC-3 checks the verification
// intensity policy in this repository's CLAUDE.md, and nothing checks the skills. CLAUDE.md is not
// part of the package, so an installed project has neither the policy nor the rule.
//
// The gap is not theoretical. On 2026-08-22, five days after FR-FLOW-137 was verified, commits
// 39fb90e ("v3.0.0 연구의 2회차 검토 지적을 반영한다") and 5bf4434 revised research prose in
// response to review findings — in this repository, where the policy DOES exist.
//
// Measured before this file was written: `연구 산문` occurs 0 times across `skills/**` and
// `.agents/skills/**`, and the only citations of FR-FLOW-137 there argue about a termination
// condition rather than forbidding anything.

const REPO_ROOT = fileURLToPath(new URL("../../", import.meta.url));
const read = (rel: string): string => readFileSync(path.join(REPO_ROOT, rel), "utf8");

// The shared verification engine — kiwi-orchestrator and kiwi-wave-master both cite it.
const ENGINE = ["skills/claude", "skills/codex", "skills/etc", ".agents/skills"].map(
  (root) => `${root}/_shared/kiwi/verify-loop.md`
);

// The SRS authoring skill's research-driven A/B loop. Its §9.6 body lives in a different file per
// profile: the claude rendering keeps it in SKILL.md, the others split it into references/.
const SRS_LOOP = [
  "skills/claude/kiwi-srs/SKILL.md",
  "skills/codex/kiwi-srs/references/extended-workflow.md",
  "skills/etc/kiwi-srs/references/extended-workflow.md",
  ".agents/skills/kiwi-srs/references/extended-workflow.md"
];

const ALL = [...ENGINE, ...SRS_LOOP];

// A hedged prohibition is the one that gets re-litigated. The sibling contracts carry this guard and
// a verifier showed this file's rule survives "되도록 … 예외를 두어도 된다" without it.
const HEDGE = /수 있다|해도 된다|권장|바람직|원칙적으로|가능하면|되도록|경우에 따라|가급적|필요하면|필요 시|일반적으로|가능한 한|예외를 두/;

// The negation has to be part of the match. `/고치지/` alone is satisfied by "고치지 못할 문서는
// 아니지만" — a permission — and a verifier replaced the whole prohibition with exactly that and the
// suite stayed green. The verb and its refusal are matched together.
const PROHIBITION = /(고치지|수정하지|저작하지|다듬지|리뷰하지|개선하지|편집하지|돌리지)\s*(않는다|말라|마라)|(SHALL|MUST) NOT (revise|edit|rewrite|improve|review)|never (revise|edit|rewrite|improve|review)/i;
const SUBJECT = /리서치 문서|연구 문서|research (document|prose)/i;

// The spellings a permission reaches for while keeping the vocabulary of a prohibition.
const PERMISSION = /고치지 못할|고칠 수 있|수정해도|고쳐도|편집해도|may (revise|edit|rewrite)/i;

function hitIndex(rel: string): number {
  return read(rel).split("\n").findIndex((l) => SUBJECT.test(l) && PROHIBITION.test(l));
}

// The prohibition line itself. Assertions about what the rule SAYS are made here rather than over a
// window: a verifier replaced the whole section with a permission ("고치지 못할 문서는 아니지만…")
// and the window still contained a `않는다` from an ordinary sentence ending, so the check passed.
function hitLine(rel: string): string {
  const at = hitIndex(rel);
  return at === -1 ? "" : (read(rel).split("\n")[at] as string);
}

// The argument for the rule, which follows it. Reading FORWARD from the prohibition and not backward
// matters: kiwi-srs already shipped a sentence citing FR-FLOW-137 about a termination condition, and
// a window that looked backward was satisfied by that pre-existing line rather than by new text.
function passage(rel: string): string {
  const at = hitIndex(rel);
  if (at === -1) return "";
  // The window has to reach the exception paragraph. At six lines it stopped one line short of it, so
  // the only carve-out in the rule sat outside the very guards built to catch carve-outs — a verifier
  // showed the paragraph could be widened to "the author may touch their own document whenever" with
  // every assertion still green.
  return read(rel).split("\n").slice(at, at + 12).join("\n");
}

describe.each(ALL)("FR-FLOW-153 AC-1 — the prohibition is in the shipped text (%s)", (rel) => {
  it("carries a prohibition on revising research prose", () => {
    expect(passage(rel), `${rel} ships no prohibition on revising research prose`).not.toBe("");
  });

  it("forbids rather than merely describes", () => {
    // A sentence that only calls research an unverified note is a description. FR-FLOW-137's own
    // citation in kiwi-srs is exactly that, and it did not stop three commits from revising research.
    // Asserted on the prohibition LINE, not a window: an ordinary sentence ending elsewhere in the
    // window satisfies `않는다` and let a rewritten permission pass.
    expect(hitLine(rel), "the sentence forbids an action").toMatch(
      /않는다|말라|금지|SHALL NOT|MUST NOT|never/i
    );
  });

  it("does not hedge the prohibition", () => {
    const text = passage(rel);
    expect(text, "there is a prohibition to check").not.toBe("");
    expect(text.split("\n").filter((l) => HEDGE.test(l)), `hedged lines in ${rel}`).toEqual([]);
  });

  it("carries no permission beside the prohibition", () => {
    // Forbidding and then granting an exception in the next sentence leaves the vocabulary intact
    // while reversing the rule, which is the cheapest loosening available here.
    const offending = passage(rel).split("\n").filter((l) => PERMISSION.test(l));
    expect(offending, `${rel}: a permission was written beside the prohibition`).toEqual([]);
  });

});

describe.each(ENGINE)("FR-FLOW-153 — the one carve-out is pinned, not pattern-matched (%s)", (rel) => {
  it("keeps the carve-out exactly as worded", () => {
    // Widening the window was necessary but not sufficient: the exception grants itself in a phrasing
    // the permission guard does not recognise ("…이 아니다" rather than "…해도 된다"), so a verifier
    // rewrote it to "the author may touch their own document whenever" with every check green.
    //
    // The first fix guarded on the carve-out's own trigger words, which made "the paragraph was
    // reworded" read as "there is no paragraph to check" — the same trap this repository already
    // wrote down as "an absent section has no hedged lines either". So the assertion is positive and
    // runs only over the engine copies, which are the four that carry a carve-out at all.
    expect(passage(rel), `${rel}: the carve-out must stay in these words`).toContain(
      "이 절이 금지하는 것은 **검토 지적을 근거로 남의 연구 노트를 다듬는 것**이지, 저작자가 자기 초안을 다시 쓰는 것이 아니다."
    );
  });
});

describe.each(ALL)("FR-FLOW-153 AC-2 — the prohibition carries its reason (%s)", (rel) => {
  it("says a research document is an unverified working note", () => {
    expect(passage(rel)).toMatch(/미검증|검증되지|unverified/i);
  });

  it("says what polishing it costs: it comes to read as verified", () => {
    // Without the consequence, the rule reads as tidiness and the next capable model overrules it.
    expect(passage(rel)).toMatch(
      /검증된 것처럼|사실로|믿게|딛고|reads as verified|taken as fact|stood on/i
    );
  });
});

describe.each(ALL)("FR-FLOW-153 AC-3 — the source requirement is named in the passage (%s)", (rel) => {
  it("names FR-FLOW-137 within the prohibition passage, not merely somewhere in the file", () => {
    expect(passage(rel)).toMatch(/FR-FLOW-137/);
  });
});

describe("FR-FLOW-153 AC-4 — the check reads the distributed text", () => {
  it("CLAUDE.md is not one of the files this requirement is satisfied by", () => {
    // The defect being repaired is the distance between the policy file and the package. A check
    // that reads CLAUDE.md would pass today, while an installed project still has nothing.
    expect(ALL.some((rel) => /CLAUDE\.md/i.test(rel))).toBe(false);
  });

  it("every asserted file is inside the shipped skill tree", () => {
    const outside = ALL.filter((rel) => !/^(skills|\.agents\/skills)\//.test(rel));
    expect(outside, "asserted files outside the shipped tree").toEqual([]);
  });

  it("the mirror copies match their codex renderings", () => {
    expect(read(".agents/skills/_shared/kiwi/verify-loop.md")).toBe(
      read("skills/codex/_shared/kiwi/verify-loop.md")
    );
    expect(read(".agents/skills/kiwi-srs/references/extended-workflow.md")).toBe(
      read("skills/codex/kiwi-srs/references/extended-workflow.md")
    );
  });
});
