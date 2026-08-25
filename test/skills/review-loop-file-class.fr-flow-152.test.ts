import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// @req FR-FLOW-152 — the review loop selects targets by file class, not by the path that produced them.
//
// The defect this pins is not the working-tree branch of the scope algorithm. kiwi-orchestrator commits
// its run artifacts under `docs/research/{work}/` on its own schedule (§15) and then hands that commit
// range to this loop as `--base`/`--head` (§4.5.1, §4.5.2), so research and design prose arrive through
// the HIGHEST-priority explicit-argument path. A rule written only for `git status` misses the real route.
//
// Measured before this file was written, across `skills/**` and `.agents/skills/**`:
//   `파일 부류` 0 · `excluded_prose` 0 · `코드만` 0 · `테스트 파일은 코드` 0 · `설정 파일은 코드` 0
// so no assertion below can be satisfied by text that already shipped.

const REPO_ROOT = fileURLToPath(new URL("../../", import.meta.url));

const COPIES = ["skills/claude", "skills/codex", "skills/etc", ".agents/skills"].map(
  (root) => `${root}/kiwi-review-fix-loop/SKILL.md`
);

const read = (rel: string): string => readFileSync(path.join(REPO_ROOT, rel), "utf8");
const frontMatter = (t: string): string => (/^---\n([\s\S]*?)\n---/.exec(t) ?? ["", ""])[1] ?? "";
const body = (t: string): string => t.replace(/^---[\s\S]*?\n---\s*\n?/, "");

function section(text: string, headingRe: RegExp): string {
  const rows = text.split("\n");
  const start = rows.findIndex((l) => /^#{1,6}\s/.test(l) && headingRe.test(l));
  if (start === -1) return "";
  const level = (rows[start]!.match(/^#+/) as RegExpMatchArray)[0].length;
  let end = rows.length;
  for (let index = start + 1; index < rows.length; index++) {
    const match = rows[index]!.match(/^#+/);
    if (match && match[0].length <= level) {
      end = index;
      break;
    }
  }
  return rows.slice(start, end).join("\n");
}

// A hedge turns a boundary into a preference. The rule this file pins is not a preference.
const HEDGE = /수 있다|해도 된다|권장|바람직|원칙적으로|가능하면|되도록|경우에 따라|가급적|필요하면|필요 시|일반적으로|가능한 한/;

// Vocabulary-presence assertions do not survive an inversion: `/면제|exempt/` is satisfied by
// "면제하지 않는다" AND by "면제한다". An independent verifier flipped five of this section's rules
// to their opposite meaning and the suite stayed green. So the rules are pinned as exact sentences —
// every one of them is a safety boundary, and rewording one should be something a reviewer sees.
const PINNED: ReadonlyArray<readonly [string, string]> = [
  ["a test file is code", "**테스트 파일은 코드다.**"],
  ["a named configuration file is code", "**설정 파일은 코드다.**"],
  ["a comment is code", "**주석은 코드다.**"],
  ["the window flags do not lift the filter", "부류 필터를 **면제하지 않는다.**"],
  ["an empty scope is not a pass", "**빈 범위는 통과가 아니다**"],
  ["the refusal comes first", "**가장 먼저, 아래 목록을 거부한다.**"],
  ["exclusion is enumerated in full", "**빠짐없이** 싣고 보고서에도 그대로 낸다"],
  // The identity has four buckets because three did not exhaust the candidates. Journals and locks
  // are refused before classification and are neither code nor prose; binaries and assets are
  // neither either. A bucket short, the identity breaks on the main path and its signal becomes noise.
  ["the identity covers four buckets", "`excluded_prose[]` 와 `refused_artifacts[]` 와 `unclassified_files[]` 의 수를 더한 값이 후보 수와 같아야 한다"],
  // Refusing by the SHAPE of a name lets a frozen artifact through whenever it is not spelled `.lock`.
  // The principle cannot BE the criterion: this skill holds no argument that reaches the run's
  // frozen declaration, and a criterion it cannot read resolves to "nothing is frozen" — fail-open,
  // straight back into the defect the list exists to close. So the list is the rule and the
  // principle is what grows it.
  ["the refusal list is closed and the principle only grows it", "이 목록의 구성 원리는 **run 이 동결로 선언한 것**이며, 새 동결 산출물이 생기면 그 원리에 따라 **목록에 추가한다.**"],
  ["the reason the principle is not the criterion", "읽을 수 없는 기준은"],
  // The halt collides with the orchestrator's terminal hop when the candidates are all prose, and the
  // exemption branch there keys on an EMPTY window rather than on an empty class scope. Resolving it
  // means widening a predicate FR-FLOW-131 owns, which is a requirement-level decision this section
  // does not get to make — so the limitation is written down instead of being left for the next
  // reader to rediscover from a stuck run.
  ["the known limitation is stated rather than left to be rediscovered", "**알려진 한계**: 후보가 처음부터 전부 산문이면"],
  ["the limitation names who owns the fix", "`FR-FLOW-131` 이 소유한 그 술어를 넓히거나"],
  ["--files is the only naming that counts", "**`--files` 만** 사람이 파일을 지목한 것으로 인정하고, 그 목록에 든 산문은 제외 사실과 사유를 **보고**한 뒤 코드만 진행한다"]
];

// Pinning what must be present does not stop an inversion being ADDED alongside it. These are the
// spellings a loosening edit reaches for.
const INVERSIONS: ReadonlyArray<readonly [string, RegExp]> = [
  // Narrowed to the table rows: "산문은 코드가 아니다" is a legitimate explanation of why prose is
  // excluded, and the broad pattern rejected it. A class being flipped shows up in its own row.
  ["a class is declared not-code", /^\| (소스 코드 파일|테스트 파일|설정 파일|코드 파일 안의 주석).*코드가 아니다/],
  // Narrow deliberately: the section warns that treating the window as a naming would let the main
  // path "필터를 면제받는다", and that warning must not be mistaken for the inversion it warns about.
  // The pinned sentence carries the deletion case, so this only has to catch an inversion ADDED.
  ["the window is said to exempt", /필터를 \*\*면제한다|필터를 면제한다/],
  ["an empty scope is called a pass", /빈 범위도 통과|0건이면 PASS 를 보고한다|통과로 보고한다/],
  // The pinned sentences live in table rows; a contradicting sentence in the body leaves the table
  // untouched and every pin green while the document argues with itself.
  ["a named class is contradicted in the body", /(테스트 파일|설정 파일|주석)은 코드가 아니/],
  // The affirmative list missed "대상에 포함한다" and "리뷰 범위에 들어온다", both readmissions.
  ["prose is readmitted by another spelling", /산문(도| 문서도).{0,30}(리뷰 범위에 들어|대상에 포함|범위에 포함)/],
  ["enumeration is made optional", /전수로 싣지 않|열거할 필요는 없|표본만 싣/],
  // The verb alone caught "산문 문서도 리뷰하지 않는다" — a restatement of the rule. The readmission
  // has to be affirmative to count.
  ["prose is readmitted", /산문(도| 문서도).{0,30}(리뷰한다|검토한다|수정한다|고친다|대상이다)/]
];

// The class table's verdict column is the operative part of AC-1 — a row can keep its explanatory
// sentence while its mark is flipped, and nothing else in the section would contradict it.
const CLASS_ROWS: ReadonlyArray<readonly [string, RegExp, string]> = [
  ["source", /^\| 소스 코드 파일 \|/, "○"],
  ["test", /^\| 테스트 파일 \|/, "○"],
  ["config", /^\| 설정 파일/, "○"],
  ["comment", /^\| 코드 파일 안의 주석 \|/, "○"],
  ["SKILL.md", /^\| `SKILL\.md`/, "✗"],
  ["README", /^\| `README\.md` \|/, "✗"],
  ["SRS", /^\| `docs\/spec/, "✗"]
];

// The boundary section is addressed by its own heading so the assertions cannot be satisfied by
// a sentence that happens to appear somewhere else in a 700-line document.
const boundary = (copy: string): string => section(body(read(copy)), /파일 부류|file class/i);

describe.each(COPIES)("FR-FLOW-152 AC-1 — the classes are a closed list, not an adjective (%s)", (copy) => {
  it("declares a boundary section at all", () => {
    expect(boundary(copy), `${copy} has no file-class boundary section`).not.toBe("");
  });

  it("names the three cases that are otherwise read the wrong way", () => {
    const text = boundary(copy);
    // Each of these is a case a reader gets wrong when handed only the word "code".
    expect(text, "a test file is code").toMatch(/테스트 파일.{0,12}코드|test file.{0,12}(is|are) code/i);
    expect(text, "a named configuration file is code").toMatch(/설정 파일.{0,12}코드|configuration file.{0,12}(is|are) code/i);
    expect(text, "a comment inside a code file is code").toMatch(/주석.{0,20}코드|comment.{0,20}(is|are) code/i);
  });

  it("states the list is closed rather than illustrative", () => {
    expect(boundary(copy)).toMatch(/닫힌 목록|이 표가 전부|목록에 없는|closed list|not on the list/i);
  });

  it("does not hedge the boundary", () => {
    const text = boundary(copy);
    // An absent section has no hedged lines either. Without this guard the assertion passes on
    // nothing at all, which is the same failure as an empty baseline certifying a clean state.
    expect(text, "there is a boundary to check for hedging").not.toBe("");
    const hedged = text.split("\n").filter((l) => HEDGE.test(l) && /대상|부류|class|target/i.test(l));
    expect(hedged, `hedged boundary lines in ${copy}`).toEqual([]);
  });

  it("names prose as excluded and names the three prose kinds by name", () => {
    const text = boundary(copy);
    expect(text, "SKILL.md is not a target").toMatch(/SKILL\.md/);
    expect(text, "README is not a target").toMatch(/README/);
    expect(text, "the SRS documents are not a target").toMatch(/docs\/spec/);
  });
});

describe.each(COPIES)("FR-FLOW-152 AC-2 — the commit window is not a person naming a file (%s)", (copy) => {
  it("says the window flags do not exempt a file from the filter", () => {
    const text = boundary(copy);
    expect(text, "the window flags are named").toMatch(/--base/);
    expect(text, "--commits is named").toMatch(/--commits/);
    expect(text, "--since is named").toMatch(/--since/);
    expect(text, "the window does not lift the filter").toMatch(/면제|우회|해제|exempt|lift|bypass/i);
  });

  it("states WHY the window is the dangerous path, naming the orchestrator", () => {
    const text = boundary(copy);
    expect(text, "the orchestrator is named as the caller that passes the window").toMatch(
      /kiwi-orchestrator|오케스트레이터/
    );
    expect(text, "the artifacts the orchestrator committed are named").toMatch(/docs\/research/);
  });

  it("admits --files as a person naming files, and still excludes prose named there", () => {
    const text = boundary(copy);
    expect(text, "--files is distinguished from the window flags").toMatch(/--files/);
    expect(text, "prose named in --files is reported rather than reviewed").toMatch(
      /보고|report/i
    );
  });
});

describe.each(COPIES)("FR-FLOW-152 AC-3 — exclusion is enumerated, not summarised (%s)", (copy) => {
  it("names the field that carries the excluded list", () => {
    expect(boundary(copy)).toMatch(/excluded_prose|prose_excluded/);
  });

  it("requires the full list rather than a count or a sample", () => {
    expect(boundary(copy)).toMatch(/전수|전량|모두 열거|빠짐없이|in full|every excluded/i);
  });

  it("states the count identity that makes a forgotten filter visible", () => {
    // Without the identity, a run that applied the rule and a run that forgot it look the same.
    expect(boundary(copy)).toMatch(/항등식|합이|더한 값|== *\|?후보|identity|adds up/i);
  });
});

describe.each(COPIES)("FR-FLOW-152 AC-4 — an empty code scope is not a pass (%s)", (copy) => {
  it("stops instead of reporting a pass when no code target survives the filter", () => {
    const text = boundary(copy);
    expect(text, "the empty-scope case is named").toMatch(/0건|비면|비었|없으면|empty|no code target/i);
    expect(text, "the loop stops rather than passing").toMatch(/중단|HALT|stop/i);
    expect(text, "the reason is stated: nothing reviewed is not a passing gate").toMatch(
      /PASS|통과/
    );
  });
});

describe("FR-FLOW-152 AC-5 — the boundary is carried where the skill is CHOSEN", () => {
  // An agent reads `description` when it picks a skill and reads the body only after it has picked.
  // A boundary that lives only in the body cannot stop the wrong skill from being selected.
  it.each(COPIES)("%s front matter states the code-only boundary", (copy) => {
    const fm = frontMatter(read(copy));
    expect(fm, "front matter exists").not.toBe("");
    expect(fm, "the description limits the skill to code").toMatch(
      /코드[^"]{0,30}(만|한정|전용)|code[^"]{0,30}only|only[^"]{0,20}code/i
    );
    expect(fm, "the description says prose is not reviewed").toMatch(/산문|문서는|prose/i);
  });
});

describe.each(COPIES)("FR-FLOW-152 AC-6 — doc_only cannot be claimed as a TDD exemption (%s)", (copy) => {
  it("removes doc_only from the exemption reason enum", () => {
    // Left in place, a fixer that edited prose claims exemption and goes straight to the fix phase —
    // the cheapest way around this requirement, and one that leaves no failing test behind.
    expect(read(copy)).not.toMatch(/doc_only/);
  });
});

describe.each(COPIES)("FR-FLOW-152 AC-7 — journals and locks are refused BEFORE the class filter (%s)", (copy) => {
  it("names the journal and lock paths that a configuration-file rule would otherwise admit", () => {
    const text = boundary(copy);
    expect(text, "the run journal is named").toMatch(/\.jsonl/);
    expect(text, "a lock is named").toMatch(/lock/i);
  });

  it("states the evaluation order rather than leaving two true rules to disagree", () => {
    const text = boundary(copy);
    expect(text, "the refusal is evaluated first").toMatch(
      /먼저|우선|앞서|before|precede|takes precedence/i
    );
  });

  it("explains why order matters: those files are structurally JSON", () => {
    expect(boundary(copy)).toMatch(/JSON/i);
  });
});

describe.each(COPIES)("FR-FLOW-152 — the rules survive an inversion, not only a deletion (%s)", (copy) => {
  it.each(PINNED)("pins the exact sentence for: %s", (_label, sentence) => {
    expect(boundary(copy), `${copy}: the rule must be stated in these words`).toContain(sentence);
  });

  it.each(INVERSIONS)("carries no inverted spelling: %s", (_label, pattern) => {
    const offending = boundary(copy).split("\n").filter((l) => pattern.test(l));
    expect(offending, `${copy}: an inverted rule was added beside the pinned one`).toEqual([]);
  });

  it.each(CLASS_ROWS)("keeps the verdict column for %s", (_label, rowRe, verdict) => {
    const row = boundary(copy).split("\n").find((l) => rowRe.test(l));
    expect(row, `${copy}: the class row must exist`).toBeDefined();
    const cells = (row as string).split("|").map((c) => c.trim());
    expect(cells[2], `${copy}: the verdict column decides the rule, not the prose beside it`).toBe(verdict);
  });

  it("carries no hedge anywhere in the section", () => {
    // The earlier filter only looked at lines containing 대상/부류, so a hedge phrased around those
    // words passed. A verifier added "산문 문서도 필요하면 리뷰하고 고칠 수 있다" and the suite stayed green.
    const text = boundary(copy);
    expect(text, "there is a boundary to check").not.toBe("");
    expect(text.split("\n").filter((l) => HEDGE.test(l)), `hedged lines in ${copy}`).toEqual([]);
  });
});

describe("FR-FLOW-152 AC-8 — the rule reaches all four shipped copies", () => {
  it("the mirror is byte-identical to the codex rendering", () => {
    expect(read(".agents/skills/kiwi-review-fix-loop/SKILL.md")).toBe(
      read("skills/codex/kiwi-review-fix-loop/SKILL.md")
    );
  });

  it("every copy carries a boundary section", () => {
    const missing = COPIES.filter((copy) => boundary(copy) === "");
    expect(missing, "copies without the boundary section").toEqual([]);
  });
});
