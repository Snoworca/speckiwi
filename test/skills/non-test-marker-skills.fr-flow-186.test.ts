import { describe, expect, it } from "vitest";

import { section } from "./kiwi-orchestrator-variants.js";
import { NEGATION, RENDERINGS, flat, readRepoFile, sentenceWith, skillFiles } from "./kiwi-renderings.js";

// @req FR-FLOW-186 AC-1 — a criterion marked non-test (`[NON-TEST]`, FR-PARSE-051) is not a gap, the
// test-writing subagent leaves it alone, and a caller about to write `verified` reports each `nonTest`
// entry whose `evidenced` is false as a check for the user and does not write that requirement
// verified; `--auto` does not decide that away.
//
// A SKILL.md is instruction, not code, so every assertion reads shipped text. Each one is keyed on
// language-neutral tokens (`nonTest`, `evidenced=false`, `verified`, `[NON-TEST]`, `--auto`) plus a
// pair of words per language, because `skills/claude` is mostly Korean and the other renderings are
// partly English. A rule is asserted as ONE sentence (`sentenceWith`), so the subject and the verb of
// a rule cannot come from two different sentences.
//
// WHAT THIS FILE DOES NOT HOLD. It observes no run: that a caller actually withholds `verified` is
// the tool's (`update_status` refuses it, FR-PARSE-051); these rows hold that each skill tells its
// agent the same thing, so the agent reports the check instead of meeting the refusal blind.

const CONTRACT = "_shared/kiwi/test-sufficiency.md";
const PARALLEL = "_shared/kiwi/parallel-waves.md";

const UNEVIDENCED = /evidenced=false/;
const USER_CHECK = /사용자 확인|user confirmation/i;
const VERIFIED = /`verified`|\bverified\b/;

function read(relPath: string): string {
  return readRepoFile(relPath).replace(/\r\n/g, "\n");
}

/** Every markdown file of one skill in one rendering, joined — a rule may sit in SKILL.md or a reference. */
function skillText(rendering: string, skill: string): string {
  return skillFiles(rendering, skill)
    .map((doc) => doc.text)
    .join("\n\n");
}

/** Every section, across a skill's files, whose heading matches — joined. */
function sectionsAcross(rendering: string, skill: string, heading: RegExp): string {
  return skillFiles(rendering, skill)
    .map((doc) => section(doc.text, heading))
    .filter((found) => found !== "")
    .join("\n\n");
}

/** The paragraph that opens with `**PW-<n> ·`. */
function pwParagraph(text: string, n: number): string {
  return text.split(/\n\s*\n/).find((paragraph) => paragraph.startsWith(`**PW-${n} ·`)) ?? "";
}

/** The rule every `verified` writer states: report the unevidenced marked AC, do not write verified. */
function withholdsVerified(text: string): string | undefined {
  return sentenceWith(text, UNEVIDENCED, USER_CHECK, VERIFIED, NEGATION);
}

// FR-FLOW-186 AC-1 (review round 1) — the marker tool refuses a step requirement, so kiwi-tdd says
// where a step's manual check goes instead of presupposing a marker it cannot write.
const TDD_STEP_ROUTE: Record<string, string> = {
  "skills/claude": "표식 도구는 step 요구를 받지 않으므로(`mark-ac-non-test` 는 body 요구만 받는다), 자동 시험으로 재현할 수 없는 AC 가 step 범위에서 gap 으로 남으면 그 AC 를 사용자 확인 항목으로 보고하고 멈춘다 — 사용자가 승격을 정하면 step 요구를 `implemented` 로 승격하고, body 요구에서 표식과 그 AC 를 지명한 비시험 증거를 더한 뒤에 `verified` 로 올린다 — 표식 도구는 `verified` 요구를 거절하므로 `verified` 로 바로 승격하지 않는다.",
  "skills/codex": "The marker tool does not take a step requirement (`mark-ac-non-test` takes a body requirement only), so an AC this repository's automated tests cannot reproduce stays a gap in the step scope: report it as a user confirmation item and halt; when the user decides to promote, promote the step requirement as `implemented`, mark the AC and add a non-test evidence row that names it on the body requirement, and only then raise it to `verified` — the marker tool refuses a `verified` requirement, so do not promote straight to `verified`.",
  "skills/etc": "The marker tool does not take a step requirement (`mark-ac-non-test` takes a body requirement only), so an AC this repository's automated tests cannot reproduce stays a gap in the step scope: report it as a user confirmation item and halt; when the user decides to promote, promote the step requirement as `implemented`, mark the AC and add a non-test evidence row that names it on the body requirement, and only then raise it to `verified` — the marker tool refuses a `verified` requirement, so do not promote straight to `verified`.",
  ".agents/skills": "The marker tool does not take a step requirement (`mark-ac-non-test` takes a body requirement only), so an AC this repository's automated tests cannot reproduce stays a gap in the step scope: report it as a user confirmation item and halt; when the user decides to promote, promote the step requirement as `implemented`, mark the AC and add a non-test evidence row that names it on the body requirement, and only then raise it to `verified` — the marker tool refuses a `verified` requirement, so do not promote straight to `verified`."
};

describe("FR-FLOW-186 AC-1 — kiwi-tdd names the route of a step's manual check", () => {
  it.each(RENDERINGS)("%s kiwi-tdd: the marker cannot be written on a step, so the check halts as a user item", (rendering) => {
    const expected = TDD_STEP_ROUTE[rendering];
    expect(expected, `no expected sentence for ${rendering}`).toBeDefined();
    expect(flat(skillText(rendering, "kiwi-tdd"))).toContain(flat(expected!));
  });
});

describe("FR-FLOW-186 AC-1 — the corpus this suite reads", () => {
  it("reads every shipped rendering and the mirror", () => {
    expect(RENDERINGS.length).toBeGreaterThanOrEqual(4);
    expect(RENDERINGS).toContain(".agents/skills");
  });
});

describe("FR-FLOW-186 AC-1 — the shared test-sufficiency contract handles a non-test criterion", () => {
  it.each(RENDERINGS)("%s: a `[NON-TEST]` criterion is not cited and lands in `nonTest`, not in the gaps", (rendering) => {
    const text = read(`${rendering}/${CONTRACT}`);
    expect(sentenceWith(text, /\[NON-TEST\]/, /인용 대상이 아니|is not cited/i, /nonTest/)).toBeDefined();
  });

  it.each(RENDERINGS)("%s: a `nonTest` entry carries named evidence, and `all` does not name a criterion", (rendering) => {
    const text = read(`${rendering}/${CONTRACT}`);
    expect(sentenceWith(text, /`evidence`/, /`all`/, /지명이 아니|does not name/i)).toBeDefined();
  });

  it.each(RENDERINGS)("%s: the fill subagent does not touch `nonTest`", (rendering) => {
    const procedure = section(read(`${rendering}/${CONTRACT}`), /^##\s.*(?:절차|Procedure)/);
    expect(sentenceWith(procedure, /채우기 서브에이전트|fill subagent/i, /nonTest/, /건드리지 않|does not touch/i)).toBeDefined();
  });

  it.each(RENDERINGS)("%s: a `verified` writer reports `evidenced=false` as a user check and does not write verified", (rendering) => {
    const callers = section(read(`${rendering}/${CONTRACT}`), /^##\s+4\./);
    expect(withholdsVerified(callers), "§4 must state the rule in one sentence").toBeDefined();
  });

  it.each(RENDERINGS)("%s: `--auto` does not lift the person's check", (rendering) => {
    const callers = section(read(`${rendering}/${CONTRACT}`), /^##\s+4\./);
    expect(sentenceWith(callers, /--auto/, /사람|person/i, /풀지 않|does not lift/i)).toBeDefined();
  });

  it.each(RENDERINGS)("%s: an evidenced marked criterion is checked on its named evidence rows, not a test row", (rendering) => {
    const callers = section(read(`${rendering}/${CONTRACT}`), /^##\s+4\./);
    expect(sentenceWith(callers, /evidenced=true/, /체크|check/i)).toBeDefined();
  });

  it.each(RENDERINGS)("%s: the result record carries the `nonTest` list", (rendering) => {
    const record = section(read(`${rendering}/${CONTRACT}`), /^##\s.*(?:결과 기록|Result record)/);
    const fence = /```json\n([\s\S]*?)```/.exec(record)?.[1] ?? "";
    expect(fence).toMatch(/"non_test"/);
  });
});

describe("FR-FLOW-186 AC-1 — kiwi-pm T-final promotes on gaps only and reports unevidenced non-test criteria", () => {
  it.each(RENDERINGS)("%s: implemented is decided by the gaps alone", (rendering) => {
    const tFinal = sectionsAcross(rendering, "kiwi-pm", /^###\s+6\.2 T-final/);
    expect(sentenceWith(tFinal, /nonTest/, /gap 만|gaps alone|only the gaps/i, /implemented/)).toBeDefined();
  });

  it.each(RENDERINGS)("%s: the unevidenced non-test list goes into the report", (rendering) => {
    const tFinal = sectionsAcross(rendering, "kiwi-pm", /^###\s+6\.2 T-final/);
    expect(sentenceWith(tFinal, UNEVIDENCED, /보고서|report/i)).toBeDefined();
  });
});

describe("FR-FLOW-186 AC-1 — kiwi-review-fix-loop withholds verified for an unevidenced non-test criterion", () => {
  it.each(RENDERINGS)("%s: the test-sufficiency step reports it as a user check and withholds verified", (rendering) => {
    const step = sectionsAcross(rendering, "kiwi-review-fix-loop", /^#{2,3}\s+(?:6\.5\.1|Test Sufficiency)/);
    expect(withholdsVerified(step)).toBeDefined();
  });

  it.each(RENDERINGS)("%s: the promotion excludes it as `non-test-unevidenced`", (rendering) => {
    const promotion = sectionsAcross(rendering, "kiwi-review-fix-loop", /^#{2,4}\s+(?:6\.6\.1|`--close-reqs` Gate|Close Requirements)/);
    expect(flat(promotion)).toContain("non-test-unevidenced");
  });

  it.each(RENDERINGS)("%s: an evidenced marked criterion is checked on its named evidence rows", (rendering) => {
    const promotion = sectionsAcross(rendering, "kiwi-review-fix-loop", /^#{2,4}\s+(?:6\.6\.2|`--close-reqs` Gate|Close Requirements)/);
    expect(sentenceWith(promotion, /evidenced=true/, /acIds/)).toBeDefined();
  });

  it.each(RENDERINGS)("%s: the report names the unevidenced non-test criteria", (rendering) => {
    expect(sentenceWith(skillText(rendering, "kiwi-review-fix-loop"), UNEVIDENCED, /보고서|report/i, USER_CHECK)).toBeDefined();
  });
});

describe("FR-FLOW-186 AC-1 — kiwi-orchestrator and the parallel contract except a non-test criterion from the test row", () => {
  it.each(RENDERINGS)("%s: §14 needs a non-test evidence row naming the marked criterion, else a user check", (rendering) => {
    const promotion = sectionsAcross(rendering, "kiwi-orchestrator", /^##\s+14\./);
    expect(sentenceWith(promotion, /\[NON-TEST\]/, /비시험 증거 행|non-test evidence row/i, USER_CHECK)).toBeDefined();
  });

  it.each(RENDERINGS)("%s: §14's test-sufficiency step withholds verified for an unevidenced one", (rendering) => {
    const promotion = sectionsAcross(rendering, "kiwi-orchestrator", /^##\s+14\./);
    expect(withholdsVerified(promotion)).toBeDefined();
  });

  it.each(RENDERINGS)("%s: PW-14 withholds verified for an unevidenced non-test criterion", (rendering) => {
    expect(withholdsVerified(pwParagraph(read(`${rendering}/${PARALLEL}`), 14))).toBeDefined();
  });

  it.each(RENDERINGS)("%s: PW-16 excepts a marked criterion from the one-test-row-per-AC rule", (rendering) => {
    const pw16 = pwParagraph(read(`${rendering}/${PARALLEL}`), 16);
    expect(sentenceWith(pw16, /\[NON-TEST\]/, /비시험 증거 행|non-test evidence row/i, USER_CHECK)).toBeDefined();
  });
});

describe("FR-FLOW-186 AC-1 — kiwi-srs reviews the marker's reason and keeps other systems out of the ACs", () => {
  /** The AC verifiability item of the verification list, its wrapped lines joined. */
  function verifiabilityItem(rendering: string): string {
    const text = skillText(rendering, "kiwi-srs");
    return /^4\. \*\*AC verifiability\*\*[^\n]*(?:\n {3,}[^\n]*)*/m.exec(text)?.[0] ?? "";
  }

  it.each(RENDERINGS)("%s: the marker's reason is reviewed", (rendering) => {
    expect(sentenceWith(verifiabilityItem(rendering), /\[NON-TEST\]/, /사유|reason/i)).toBeDefined();
  });

  it.each(RENDERINGS)("%s: another system's behaviour and a limit or scope statement are not written as ACs", (rendering) => {
    const item = verifiabilityItem(rendering);
    expect(sentenceWith(item, /다른 시스템|another system/i, /한계|limit/i, /AC 로 쓰지 않|not .*AC/i)).toBeDefined();
  });
});

describe("FR-FLOW-186 AC-1 — every other verified writer states the same rule before it writes", () => {
  it.each(RENDERINGS.flatMap((rendering) => ["kiwi-srs-sync", "kiwi-tdd", "kiwi-hot-fix"].map((skill) => [rendering, skill] as const)))(
    "%s %s: an unevidenced non-test criterion is a user check and its requirement is not written verified",
    (rendering, skill) => {
      expect(withholdsVerified(skillText(rendering, skill))).toBeDefined();
    }
  );
});
