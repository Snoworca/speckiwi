import { describe, expect, it } from "vitest";

import { flat, readRepoFile, RENDERINGS } from "./kiwi-renderings.js";
import { criticalGateRows, section, stripFrontmatter, windowsAround } from "./kiwi-orchestrator-variants.js";

// @req FR-FLOW-171 — the review step reads against a denominator the loop fixed, and each hunk of
// that denominator is claimed with a string taken from inside it rather than with a count.
//
// The scope step already disposes every candidate into one of four buckets and requires the four
// counts to sum (FR-FLOW-152 AC-3). What crosses into the review step is the diff body of the
// included bucket, and the reviewer's output schema has no field saying what was read — so a
// reviewer handed twelve files that opens three and returns `findings: []` produces the same PASS.
// A count does not repair that: `hunks_total` is a value the loop hands over, so writing it back
// costs nothing. A string from inside the hunk cannot be produced without opening it, and the loop
// holds the diff, so a wrong one is caught.
//
// Measured across all four renderings of kiwi-review-fix-loop/SKILL.md before this file was written:
//   hunks_total 0 · coverage_rows 0 · review_coverage 0 · anchor 0 · 앵커 0 · `git diff -U0` 0 ·
//   `grep -c '^@@'` 0 · review-coverage-mismatch 0 · `@@ 헤더` 0 · 재사용 0
// so no assertion below can be satisfied by text that already shipped. Two words are NOT at zero and
// are therefore never asserted bare: `분모` (10 in skills/claude) and `무효` (2), both belonging to
// the `--close-reqs` REQ-promotion denominator in §6.6, which is a different subject. Every check
// that needs either word reads it inside the coverage section.

const COPIES = RENDERINGS.map((rendering) => `${rendering}/kiwi-review-fix-loop/SKILL.md`);

const bodyOf = (relPath: string): string => stripFrontmatter(readRepoFile(relPath));

/**
 * The coverage section, addressed by the phrase in its heading rather than by a number.
 *
 * Plan item 12 moves sections inside this file, so a reader keyed to `## 12` would go silently empty
 * the moment it lands — and an empty section satisfies every "does not say X" check for the wrong
 * reason. The emptiness guard below is what makes that failure loud instead.
 */
const coverage = (copy: string): string => section(bodyOf(copy), /^#{1,6}\s.*리뷰 커버리지 분모/);

/**
 * A hedge turns a boundary into a preference. Nothing in this section is a preference.
 *
 * The permissive `~할 수 있다` forms are listed by verb rather than bare: `수 있다` on its own also
 * spells ability ("the loop can reproduce either value"), which this section states as a REASON and
 * must keep. Measured before they were added: lowering `리뷰어는 hunk 마다 앵커 하나를 돌려준다`
 * to `돌려줄 수 있다` left all 172 assertions green.
 *
 * This filter is an ENUMERATION and Korean hedging is not a closed set, so a hedge spelled outside
 * the list passes: measured, adding `앵커를 일부만 실어도 무방하다` to the section left the whole
 * suite green even though the section then contradicts itself. What the list holds today is the
 * thirteen general forms above plus five verb-specific ones, three of them the `~할 수 있다`
 * shape — eighteen spellings in all. The rules themselves are held by PINNED, which a hedge does not delete, so this filter narrows the gap
 * rather than closing it.
 */
const HEDGE = /수 있다면|해도 된다|권장|바람직|원칙적으로|가능하면|되도록|경우에 따라|가급적|필요하면|필요 시|일반적으로|가능한 한|돌려줄 수 있다|생략할 수 있다|건너뛸 수 있다|비워도 된다|적지 않아도/;

/**
 * Exact sentences rather than vocabulary presence.
 *
 * `/앵커|anchor/` is satisfied by "앵커를 요구한다" AND by "앵커를 요구하지 않는다"; the neighbouring
 * suite for FR-FLOW-152 recorded five rules flipped to their opposite meaning with every check still
 * green. Each entry here is a rule whose rewording a reviewer should have to see.
 */
const PINNED: ReadonlyArray<readonly [string, string]> = [
  // AC-1 — the counter is the loop. A count the reviewer makes is both the number under test and
  // the number making the test.
  ["the loop counts the hunks, not the reviewer", "**`hunks_total` 은 루프가 센다 — 리뷰어가 세지 않는다.**"],
  ["the denominator is carried over from the scope step rather than recollected", "`self_scope.files[]`"],
  // AC-2 — a denominator that admits a sample is not a denominator, and what the reviewer owes per
  // hunk is the anchor itself. Both sentences below were unpinned while every other check was
  // green: swapping the obligation for a self-reported `hunks_read` — the very thing plan 08 §2.1
  // rejects, since the loop hands that number over — left all 172 assertions passing, and so did
  // rewriting the row to carry a count. The rule the section then states contradicts itself: the
  // reviewer returns counts and the loop compares anchors that nothing produces.
  ["the reviewer owes one anchor per hunk", "**리뷰어는 hunk 마다 앵커 하나를 돌려준다.**"],
  ["the row carries the anchors themselves, not a number", "각 행은 그 파일의 앵커 목록과 finding 이 붙었는지를 밝힌다"],
  ["every included file gets a row", "finding 0건인 파일도 행으로 남는다."],
  ["a sample is not a denominator", "표본·발췌·상위 N 은 분모가 아니다."],
  // AC-3 — the two values the loop already handed over cannot serve as evidence of having read.
  ["the hunk header and the path are not anchors", "**`@@` 헤더 줄과 파일 경로는 앵커가 될 수 없다**"],
  // AC-4 — comparison 1 has to ENFORCE the definition AC-3 states, not merely sit next to it.
  // Measured while comparison 1 read "the string occurs inside the hunk body": a candidate pool
  // built without looking at the diff at all — the letters `e t a o i n s r h`, ranked by English
  // frequency — fills every row of this working tree (11 files) and of every one of the last forty
  // commits, because each letter occurs in almost every hunk and the letters are distinct, so they
  // clear the one-to-one matching and the within-row ban together. `"e"` is produced without
  // opening anything, which is what the rule is for. Enforcing the
  // definition inside comparison 1 turns 32 of those 40 commits invalid, cooperative output and the
  // honest cross-row collision both still passing.
  ["comparison 1 enforces the definition rather than substring containment", "**줄의 임의의 부분문자열은 앵커가 아니다.**"],
  ["what counts as being inside the hunk is spelled out as the definition", "그 hunk 의 추가·삭제된 줄 하나와 **통째로 같거나**(앞뒤 공백만 다른 것은 같은 것으로 본다), 그 줄에 **토큰 경계로 실재하는 심볼 이름**이어야 한다"],
  // The word the definition turns on was left undefined, and the residual figure depends on it.
  // Read as "any token is a symbol name", every word of Korean prose becomes an anchor: measured
  // over the same forty commits, admitting prose words raises the blind-fillable commit count from
  // 7 to 9 with a modest prose pool and to 18 with a fuller one. The section now says which reading
  // governs, and it is the reading VE-4's figures are measured on.
  ["a symbol name is a code token and a word of prose is not", "**심볼 이름은 코드 토큰을 말하며, 산문의 낱말은 심볼 이름이 아니다.**"],
  ["stating a definition and enforcing it are named as different things", "정의를 적어 두는 것과 검사가 그 정의를 강제하는 것은 다르고, 강제하지 않으면 정의는 아무것도 막지 못한다"],
  // AC-4 — without the third comparison the first two pass on one common line repeated everywhere.
  ["an anchor is not used twice inside one row", "**한 행 안에서 같은 앵커 문자열을 두 번 쓰지 않는다.**"],
  // The plan specified this ban ACROSS rows. Measured against this repository's own working tree —
  // 6 files, 27 hunks — the cross-row form rejects a COOPERATIVE output. Not an artifact of the
  // mirrored skill files either: of the last sixty commits, thirty touched two or more CODE files
  // and twenty-nine of those add or delete an identical line in two of them, mostly a shared
  // import; in one it is the only line of a hunk, so no choice of anchor avoids it. The allowance
  // is pinned, not merely absent, so re-tightening it is an edit a reviewer sees.
  ["a cross-row collision is deliberately allowed", "**서로 다른 행이 같은 문자열을 앵커로 갖는 것은 막지 않는다**"],
  ["the allowance says what still holds the collision down", "검사 1 이 파일마다 따로 확인하니"],
  // AC-5 — an invalid round consumes the cap and records nothing.
  ["a mismatch invalidates the round", "**하나라도 어긋나면 그 라운드는 무효다.**"],
  ["the failing anchor strings are logged", "어긋난 앵커 문자열을 그대로 남긴다"],
  // AC-7 — the one failure mode of this design that looks like nothing happening.
  ["two consecutive invalid rounds halt through the gate", "**무효 라운드가 2회 연속이면 `review-coverage-mismatch` 로 중단하고 `--auto` 가 이 중단을 덮지 못한다**"],
  ["the repair splits the denominator rather than coarsening it", "**분모 단위를 파일보다 굵게 올리거나 앵커를 파일당 하나로 줄이지 않는다.**"],
  // AC-8 — three steps reading three ranges hand the reviewer an invalid round it did not earn.
  ["one range serves all three steps", "**분모를 만든 범위, `hunks_total` 을 센 범위, 앵커를 대조하는 범위는 셋 다 같아야 한다**"],
  // AC-9 — without this the next reader hangs reviewer judgement on a derivation check.
  ["the comparison does not measure review quality", "**이해했다는 것을 보장하지 않으며, 리뷰 품질을 재지 않는다.**"],
  // The earlier wording claimed the comparison establishes that the output was derived from the
  // whole input. Measured, that claim is too wide: a pool chosen from the file extension alone
  // fills 81% (one pool) and 85% (another) of the code files touched by the last forty commits.
  // What survives measurement is the narrower pair below, so that is what is pinned.
  ["what it does establish is the enumerated denominator and real anchors", "**분모의 모든 파일이 행으로 열거되고, 적힌 앵커 하나하나가 그 hunk 에 실재한다**"],
  ["it does not establish that the diff was opened", "**리뷰어가 diff 를 열었다는 것까지는 보장하지 않는다.**"],
  // AC-9 — and what the tightened definition still does NOT close, measured rather than assumed.
  // The first round diagnosed the residual as few-hunk whole-file additions; the measurement says
  // otherwise. Of the eight commits that stay blind-fillable after the tightening, six have every
  // file at exactly one hunk, not seven — a0635ea is 14 files and 51 hunks and includes a
  // hand-edited 11-hunk source file that fills. Per file, 81-85% of code files fill, 6-, 7-, 11-
  // and 13-hunk ones among them, so the condition is a common token per hunk rather than few
  // hunks. Admitting a blank line as an anchor changes none of the eight, and no hunk in those
  // 1396 is anchorable only by a blank line, so banning it would buy nothing.
  ["the hole is stated as a common token per hunk, not as few hunks", "조건은 **hunk 가 적다는 것이 아니라 hunk 마다 흔한 토큰이 하나씩 있다**는 것이다."],
  ["the size of the hole is stated as measured", "**코드 파일의 80% 남짓**"],
  // The distinction the plan says an implementer gets wrong: reading §11's identity as this rule.
  ["the identity and this rule have different subjects", "**각 hunk 를 리뷰어가 실제로 처리했는지**"]
];

/** The spellings a loosening edit reaches for. Deletion is covered by PINNED; this catches addition. */
const INVERSIONS: ReadonlyArray<readonly [string, RegExp]> = [
  ["the reviewer is put back in charge of the count", /리뷰어가 (`?hunks_total`? ?를? ?)?(직접 )?(센다|세어|계산한다)/],
  ["the reviewer is put back in charge of the denominator", /리뷰어가 (스스로 )?분모를 (정한다|만든다|고른다)/],
  ["a count is accepted in place of an anchor", /앵커 대신 개수|개수만 (적어도|채워도|맞으면)/],
  // The exact spelling plan 08 §2.1 rejects. Zero occurrences across all four renderings when this
  // was added, so it asserts rather than restates.
  ["the reviewer reports how many hunks it read", /hunks_read/],
  // Written to miss the section's own two negative uses of the word — it bans the substring and
  // then explains what admitting one would cost — and to catch only a sentence that re-admits it.
  ["an arbitrary substring is admitted as an anchor again", /부분문자열.{0,15}(앵커가 될 수 있다|앵커로 인정한다|앵커로 쓴다|도 앵커다|앵커다)|앵커는 참고용/],
  ["the header becomes an anchor", /`?@@`? 헤더(도| 줄도)?.{0,20}앵커(가 될 수 있다|로 쓴다|로 인정)/],
  ["reuse inside a row is permitted", /한 행 안에서.{0,30}(두 번 써도|반복해도|재사용해도|같아도 된다)/],
  ["a sample is admitted", /표본(만|으로)?.{0,20}(충분|허용|가능)|상위 N (만|으로)?.{0,15}(충분|허용)/],
  ["an invalid round is still a pass", /무효(인|한|여도| 라운드도).{0,20}PASS|무효.{0,15}통과로 (기록|본다)/],
  ["a zero-finding file may be dropped from the rows", /finding 0건.{0,20}(행을 생략|빼도|제외한다)/]
];

/**
 * The document with the coverage section cut out.
 *
 * AC-1 names the reviewer INPUT and AC-2 the reviewer OUTPUT SCHEMA, and neither lives in the
 * section that describes them — they live in the run's own steps. A suite that reads only the
 * section satisfies both ACs from prose: measured, the `coverage_rows` block could be deleted from
 * the shipped output schema whole and all 172 assertions stayed green, which is the completion
 * condition plan 08 §5 states in so many words ("removing the coverage row or the anchor field
 * from the reviewer output schema turns the tests red"). So do these checks read outside it.
 */
const outside = (copy: string): string => {
  const body = bodyOf(copy);
  const inside = coverage(copy);
  return inside === "" ? body : body.replace(inside, "\n");
};

/** The full rendering, whose workflow is written out step by step. */
const FULL_COPY = "skills/claude/kiwi-review-fix-loop/SKILL.md";

/** Where the section reaches into the run, in the rendering that writes the run out in full. */
const WIRING_FULL: ReadonlyArray<readonly [string, string]> = [
  ["the reviewer's input list carries the fixed denominator", "`review_denominator[]` — 루프가 고정한 리뷰 분모"],
  ["that input item carries the per-file count the loop made", "항목마다 루프가 센 `hunks_total` 을 함께 싣는다"],
  ["the output schema declares the rows", '"coverage_rows": ['],
  ["a schema row declares the count its anchors must match", '"hunks_total": 3'],
  ["a schema row declares its anchors", '"anchors": ['],
  ["the schema says one anchor per hunk for every file of the denominator", "`review_denominator[]` 의 모든 파일이 한 행씩 갖고, 행마다 hunk 당 앵커 하나를 싣는다"],
  ["the re-review fixes the denominator again over the new diff", "Phase 4 diff 를 대상으로 루프가 다시 고정하고 `hunks_total` 을 다시 센 분모"],
  ["the re-review output carries the rows as well", "+ `coverage_rows`)"],
  ["the report states the comparison result round by round", "라운드별 `review_denominator[]` 크기 · 파일별 `hunks_total` 과 앵커 개수"]
];

/** The abridged renderings state it as a workflow step and defer the schema to the reference file. */
const WIRING_ABRIDGED: ReadonlyArray<readonly [string, string]> = [
  [
    "the workflow fixes the denominator before the reviewer is spawned",
    "Fix the review denominator before spawning the reviewer: carry the included bucket into `review_denominator[]` and count each file's `hunks_total` yourself"
  ]
];

/** The abridged renderings carry the reviewer's schema and the exit criteria in a reference file. */
const REFERENCES = RENDERINGS
  .map((rendering) => `${rendering}/kiwi-review-fix-loop/references/extended-workflow.md`)
  .filter((relPath) => readRepoFile(relPath) !== "");

describe("FR-FLOW-171 — the corpora these checks iterate are not empty", () => {
  // `it.each([])` runs zero assertions and reports success, so emptying any of these arrays deletes
  // most of the suite in silence. Measured: `const PINNED = []` left 143 of 231 passing and no
  // failure, `INVERSIONS` 191, `WIRING_FULL` 222 — all green. REFERENCES already had this guard by
  // name; these four are the same hole one layer up, and the floors are set at the current sizes so
  // that deleting one entry is a failure rather than a smaller silent pass.
  it("PINNED still carries every pinned rule", () => {
    expect(PINNED.length).toBeGreaterThanOrEqual(25);
  });

  it("INVERSIONS still carries every loosening spelling", () => {
    expect(INVERSIONS.length).toBeGreaterThanOrEqual(10);
  });

  it("WIRING_FULL still carries every wiring site of the full rendering", () => {
    expect(WIRING_FULL.length).toBeGreaterThanOrEqual(9);
  });

  it("WIRING_ABRIDGED still carries the abridged renderings' workflow step", () => {
    expect(WIRING_ABRIDGED.length).toBeGreaterThanOrEqual(1);
  });
});

describe.each(COPIES)("FR-FLOW-171 — the coverage section exists at all (%s)", (copy) => {
  it("declares a coverage-denominator section", () => {
    // Every "the section does not say X" check below is vacuously true on an empty string, which is
    // the same failure as an empty baseline certifying a clean state. This is the guard for that.
    expect(coverage(copy), `${copy} has no coverage-denominator section`).not.toBe("");
  });
});

describe.each(COPIES)("FR-FLOW-171 — the rules are pinned as sentences (%s)", (copy) => {
  it.each(PINNED)("%s", (_label, sentence) => {
    expect(flat(coverage(copy))).toContain(flat(sentence));
  });

  it.each(INVERSIONS)("does not carry the opposite rule: %s", (_label, pattern) => {
    expect(flat(coverage(copy))).not.toMatch(pattern);
  });

  it("does not hedge the rules", () => {
    const text = coverage(copy);
    expect(text, "there is a section to check for hedging").not.toBe("");
    const hedged = text.split("\n").filter((line) => HEDGE.test(line) && /앵커|분모|무효|hunk/.test(line));
    expect(hedged, `hedged coverage rules in ${copy}`).toEqual([]);
  });
});

describe.each(COPIES)("FR-FLOW-171 AC-1 — the loop fixes the denominator and counts the hunks (%s)", (copy) => {
  it("names the two values passed in to the reviewer", () => {
    const text = flat(coverage(copy));
    expect(text, "the denominator field is named").toMatch(/review_denominator/);
    expect(text, "the per-file hunk count is named").toMatch(/hunks_total/);
  });

  it("writes out the counting command, with zero context", () => {
    const text = flat(coverage(copy));
    // -U0 is not a style choice: measured on this repo's own HEAD~1, the default context merges two
    // adjacent hunks of docs/plan/3.0/index.md and reports 3 where -U0 reports 4. A denominator
    // that undercounts is one the reviewer clears without reading everything.
    expect(text, "the command is written out").toMatch(/git diff -U0/);
    expect(text, "the hunk headers are what is counted").toMatch(/grep -c '\^@@'/);
    expect(text, "the reason for zero context is stated").toMatch(/컨텍스트 줄이 인접 hunk 를 병합/);
  });
});

describe.each(COPIES)("FR-FLOW-171 AC-2 — one row per included file (%s)", (copy) => {
  it("names the output field the rows land in", () => {
    expect(flat(coverage(copy))).toMatch(/coverage_rows/);
  });

  it("requires a row for every file in the denominator, not for the ones with findings", () => {
    const text = flat(coverage(copy));
    expect(text, "the enumeration is total").toMatch(/\*\*모든\*\* 파일이 한 행씩/);
  });
});

describe.each(COPIES)("FR-FLOW-171 AC-3 — what may serve as an anchor (%s)", (copy) => {
  it("defines the anchor as an added or deleted line, or a symbol from one", () => {
    const text = flat(coverage(copy));
    expect(text, "the added/deleted line is the source").toMatch(/추가되거나 삭제된 줄/);
    expect(text, "the quotation is verbatim").toMatch(/그대로 옮긴 인용/);
    expect(text, "a symbol name from that line is admitted").toMatch(/심볼 이름/);
    // Without this the `+++`/`---` file headers qualify as "lines starting with + or -".
    expect(text, "the file headers are excluded from the line rule").toMatch(/\+\+\+/);
  });

  it("states WHY the header and the path are excluded rather than only excluding them", () => {
    // The rule is arbitrary without the reason, and an arbitrary rule is the one an agent argues
    // itself out of: both values were handed to the reviewer, so reproducing either proves nothing.
    expect(flat(coverage(copy))).toMatch(/루프가 이미 넘긴 값에서 그대로 만들어 낼 수 있으므로/);
  });
});

describe.each(COPIES)("FR-FLOW-171 AC-4 — three comparisons, not one (%s)", (copy) => {
  it("states that the anchor must be inside the body of its own hunk", () => {
    const text = flat(coverage(copy));
    expect(text, "the anchor is located in the hunk body").toMatch(/\*\*해당 hunk 본문 안\*\*에 실제로 있다/);
  });

  it("makes comparison 1 carry the anchor definition instead of accepting any substring", () => {
    // Substring containment is what makes the definition decorative: nine common letters, chosen
    // without reading a line of the diff, occupy nine distinct hunks and clear comparisons 1, 2
    // and 3 together. The definition has to be the membership test, not a paragraph beside it.
    const text = flat(coverage(copy));
    expect(text, "the whole added or deleted line qualifies").toMatch(/추가·삭제된 줄 하나와 \*\*통째로 같거나\*\*/);
    expect(text, "a symbol qualifies only at a token boundary").toMatch(/\*\*토큰 경계로 실재하는 심볼 이름\*\*이어야 한다/);
    expect(text, "an arbitrary substring is refused").toMatch(/\*\*줄의 임의의 부분문자열은 앵커가 아니다\.\*\*/);
    expect(text, "the reason the ban is needed is stated, not just the ban").toMatch(
      /흔한 한 글자 N 개가 서로 다른 hunk 에 하나씩 대응해 한 행을 통째로 채운다/
    );
  });

  it("states the per-file count equality AND the one-to-one mapping onto distinct hunks", () => {
    const text = flat(coverage(copy));
    expect(text, "the count equality is stated").toMatch(/앵커 개수가 `hunks_total` 과 같고/);
    // Equality alone admits N anchors all taken from one hunk.
    expect(text, "the anchors map onto distinct hunks").toMatch(/서로 다른 hunk 에 하나씩 대응한다/);
  });

  it("states why within-row reuse has to be banned separately from the matching", () => {
    // The one-to-one matching does NOT imply it: nine copies of a line that really does occur in
    // all nine hunks of a file match nine distinct hunks and clear comparison 2 outright.
    expect(flat(coverage(copy))).toMatch(/흔한 한 줄을 골라 그 행을 통째로 채우는 출력이 통과한다/);
  });

  it("bounds the ban to the row and says what the cross-row case would cost", () => {
    expect(flat(coverage(copy)), "the reason the ban stops at the row").toMatch(
      /정직한 리뷰어의 앵커도 행 사이에서 겹치므로/
    );
  });
});

describe.each(COPIES)("FR-FLOW-171 AC-5 — an invalid round consumes the cap and records nothing (%s)", (copy) => {
  it("says the cap is spent but no pass is recorded", () => {
    const text = flat(coverage(copy));
    expect(text, "the cap is consumed").toMatch(/cap 은 소비하되/);
    expect(text, "no pass is recorded").toMatch(/PASS 로 기록하지 않으며/);
  });
});

describe.each(COPIES)("FR-FLOW-171 AC-6 — the termination condition is a conjunction (%s)", (copy) => {
  it("names the coverage comparison at every place that grants a pass", () => {
    // Anchored on the pass grants themselves rather than on the section heading: a conjunction
    // written only in the coverage section leaves the table that actually decides untouched.
    // Measured: `Normal PASS` 1 + `Max PASS` 1 in skills/claude, and the English exit line 1 in each
    // of the other three, so no rendering contributes an empty window set.
    const windows = windowsAround(flat(bodyOf(copy)), /Normal PASS|Max PASS|Iterate until CRITICAL\/HIGH findings are clear/, 400);
    expect(windows.length, `${copy} states no termination condition`).toBeGreaterThan(0);
    for (const window of windows) {
      expect(window, `a pass is granted without the coverage comparison in ${copy}`).toMatch(/커버리지 대조/);
    }
  });

  it("states the conjunction as a rule, not only as a cross-reference", () => {
    expect(flat(bodyOf(copy))).toContain(flat("**커버리지 대조를 통과한 라운드만 PASS 가 된다** — finding 개수만으로는 PASS 가 나오지 않는다."));
  });
});

describe.each(COPIES)("FR-FLOW-171 AC-7 — the invalid round reaches a declared gate (%s)", (copy) => {
  it("declares review-coverage-mismatch in the critical_gates[] table", () => {
    const rows = criticalGateRows(bodyOf(copy));
    expect(rows.length, `${copy} declares no critical gates at all`).toBeGreaterThan(0);
    expect(rows.map((row) => row.gateId)).toContain("review-coverage-mismatch");
  });

  it("gives the gate a reason naming what fires it, rather than a bare id", () => {
    const row = criticalGateRows(bodyOf(copy)).find((entry) => entry.gateId === "review-coverage-mismatch");
    expect(row, `${copy} has no review-coverage-mismatch row`).toBeDefined();
    expect(flat(row?.reason ?? ""), "the reason names the consecutive invalid rounds").toMatch(/2회 연속|연속.{0,6}무효/);
  });
});

describe.each(COPIES)("FR-FLOW-171 AC-8 — one diff range for all three steps (%s)", (copy) => {
  it("ties the range to the scope source rather than leaving it to each step", () => {
    const text = flat(coverage(copy));
    expect(text, "the range comes from the scope decision").toMatch(/self_scope\.source/);
    expect(text, "the cost of disagreement is stated").toMatch(/아무 잘못 없이 무효 라운드를 받는다/);
  });
});

describe.each(COPIES)("FR-FLOW-171 AC-10 — the review step points back at the rule (%s)", (copy) => {
  it("names the section somewhere other than its own heading", () => {
    // The idiom this file follows is the one already in the document: `보존 스캔` is named at the
    // site that runs it and again where it is defined, twice in every rendering. A rule defined in
    // a section nothing references is a rule the run never reaches.
    const occurrences = (flat(bodyOf(copy)).match(/리뷰 커버리지 분모/g) ?? []).length;
    expect(occurrences, `${copy} defines the section but never calls it`).toBeGreaterThan(1);
  });
});

describe.each(COPIES)("FR-FLOW-171 AC-1 · AC-2 — the rule is wired into the run, not only stated (%s)", (copy) => {
  const wiring = copy === FULL_COPY ? WIRING_FULL : WIRING_ABRIDGED;

  it("has a coverage section to cut out, so these checks read a shortened document", () => {
    // Without this, `outside` degenerates to the whole body and every check below passes off the
    // section it is meant to be reading past.
    expect(outside(copy).length, `${copy}`).toBeLessThan(bodyOf(copy).length);
  });

  it.each(wiring)("%s", (_label, sentence) => {
    expect(flat(outside(copy))).toContain(flat(sentence));
  });
});

describe("FR-FLOW-171 AC-2 · AC-6 — the reference file the abridged renderings defer to", () => {
  it("is found in each rendering that carries one", () => {
    // A corpus filtered down to nothing runs zero assertions and reports success, which is the
    // same silence an empty section produces. Name the three rather than trust the filter.
    expect(REFERENCES).toEqual([
      "skills/codex/kiwi-review-fix-loop/references/extended-workflow.md",
      "skills/etc/kiwi-review-fix-loop/references/extended-workflow.md",
      ".agents/skills/kiwi-review-fix-loop/references/extended-workflow.md"
    ]);
  });

  it.each(REFERENCES)("%s carries the coverage row in the finding schema", (relPath) => {
    // This file IS the reviewer output schema for three of the four renderings. The SKILL.md
    // section can say a row exists while the schema the reviewer is handed has no field for it.
    expect(flat(readRepoFile(relPath))).toContain(
      flat("The reviewer also returns `coverage_rows[]`, one row per file of `review_denominator[]`, each carrying one anchor per hunk.")
    );
  });

  it.each(REFERENCES)("%s makes the comparison an exit criterion", (relPath) => {
    const text = flat(readRepoFile(relPath));
    expect(text, "the exit criteria list the comparison").toContain(
      flat("- the review coverage comparison passed (SKILL.md 리뷰 커버리지 분모 section);")
    );
    expect(text, "an invalid round spends the cap, records nothing, and twice in a row halts").toContain(
      flat("a round whose anchors do not check out is invalid, spends the cap and records no pass, and two consecutive invalid rounds halt at `review-coverage-mismatch`")
    );
  });
});
