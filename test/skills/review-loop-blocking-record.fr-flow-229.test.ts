import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { COMPACTION_TOKEN_BUDGET, estimateTokens, tokensThrough } from "./skill-token-estimate.js";

// FR-FLOW-229 — kiwi-review-fix-loop splits kept findings into blocking and record, narrows later
// rounds to the change since the previous round, and stops NEEDS_USER instead of looping.
//
// The rules live in the body; a short section placed directly after the clean-code core block
// restates them inside the first 5,000 estimated tokens, the part Claude Code re-attaches after a
// compaction (FR-FLOW-206 AC-6 estimate). Every section line is held twice, as in the FR-FLOW-223
// core-rules block: the section carries the sentence, and the body outside the section carries the
// same sentence — a section line whose body sentence is gone or reworded fails here.

const REPO_ROOT = fileURLToPath(new URL("../../", import.meta.url));
const read = (rel: string): string => readFileSync(path.join(REPO_ROOT, rel), "utf8");

const ROOTS = ["skills/claude", "skills/codex", "skills/etc", ".agents/skills"] as const;
const COPIES = ROOTS.map((root) => `${root}/kiwi-review-fix-loop/SKILL.md`);
const REFERENCES = ["skills/codex", "skills/etc", ".agents/skills"].map((root) => `${root}/kiwi-review-fix-loop/references/extended-workflow.md`);
const CLAUDE = "skills/claude/kiwi-review-fix-loop/SKILL.md";

const CLEAN_CODE_HEADING = "## 클린 코드 라운드 — 컴팩션 뒤에도 남는 규칙 (FR-FLOW-206)";
const HEADING = "## 차단·기록과 회차 판정 — 컴팩션 뒤에도 남는 규칙 (FR-FLOW-229)";
const INTRO = "이 블록은 본문 규칙의 요약이며 규칙을 더하지 않는다 — 줄마다 본문에 같은 문장이 있다.";

/** [AC, bullet label, the sentence the bullet and the body both carry]. */
const ITEMS: ReadonlyArray<readonly [string, string, string]> = [
  ["AC-2", "보장 범위", "실행을 시작할 때 리뷰 대상 코드의 보장 범위를 실행 상태 `state.json` 의 `guarantee_scope` 에 기록한다."],
  ["AC-5", "판정 주체", "kept finding 을 차단(`block`)과 기록(`record`)으로 가르는 것은 리뷰어가 아니라 리드(분류기)다."],
  ["AC-5", "차단", "AC 를 어기거나, 실제 호출 경로에서 재현되거나, 데이터를 잃거나, 비밀을 노출하거나, 인증·권한을 우회하는 kept finding 은 차단이다 — 보안 finding 은 입력이 드물어도 차단이고, 선언된 계약을 깨는 값의 조용한 손실과 평범한 올바른 입력의 거부는 입력을 어떻게 만들었든 차단이다."],
  ["AC-2", "기록", "실패하는 테스트로 입증됐지만 실제 호출 경로가 없거나 보장 범위 밖인 kept finding 은 drop 하지 않고 기록(`declared_limit`)으로 분류해 고치지 않으며, 증거와 함께 선언된 한계 목록 `declared_limits[]` 에 올리고, 사용자는 그것을 차단으로 올릴 수 있다 — 차단 조건에 드는 finding 은 실제 호출 경로가 없거나 입력을 만들어 냈어도 기록으로 분류하지 않는다."],
  ["AC-1", "2회차 범위", "2회차부터 리뷰 범위의 기본값은 `check_review_round` 가 정하는 회차 범위(FR-NODE-274 AC-2)이며, 전체 범위로 넓히는 것은 사유를 `scope_widen_reason` 에 기록하는 명시적 결정이다."],
  ["AC-3", "계열 재발", "같은 계열(`family`)의 kept finding 이 앞선 두 회차 이상에서 나온 뒤 다시 나오면, 리드는 표준 도구 쓰기(`standard-tool`)·한 규칙으로 통합(`single-rule`)·한계 선언(`declare-limit`) 중 정확히 하나를 골라 `family_action` 으로 기록하고, fixer 는 그 구성원 하나만 덧대지 않고 그 선택을 적용한다."],
  ["AC-8", "회차 검사", "회차가 끝날 때마다 읽기 전용 검사 `check_review_round`(CLI `speckiwi review-round check`)를 부르고, 범위·앞 회차 수정의 과반·통과·상한이나 예산 멈춤에 대해 그 검사가 돌려준 판정(`PASS` · `NEEDS_USER` · `CONTINUE`)을 따른다."],
  ["AC-7", "통과", "차단 kept finding 이 0 이고 리뷰 커버리지 대조(FR-FLOW-171)가 통과하고 residual 이 남지 않았을 때(FR-FLOW-203 AC-11) 실행이 통과하며, 기록 finding 은 통과를 막지 않는다."],
  ["AC-7", "남은 차단", "앞 회차에서 해소되지 않은 차단 kept finding 도 그 회차 `findings[]` 에 다시 싣고 `id` · `family` · `introduced_by_round` 는 처음 기록한 값을 그대로 두므로, 최근 회차만 읽는 `check_review_round` 가 남은 차단을 모두 센다."],
  ["AC-4", "상한·예산 멈춤", "차단 kept finding 이 남은 채 최근 회차 번호가 `limits.round_cap` 에 닿거나, `limits.token_budget` 이 null 이 아니고 회차별 `tokens_used` 합이 그것을 넘으면 차단·기록 목록과 함께 `NEEDS_USER` 로 멈추고 통과로 기록하지 않는다 — `limits.token_budget` 이 null 이면 예산 멈춤은 없다."],
  ["AC-6", "과반 멈춤", "한 회차의 차단 kept finding 중 앞 회차 수정이 만든 것(`introduced_by_round` 가 그 회차보다 앞선 것)이 그 회차 차단의 절반을 넘으면 차단·기록 목록과 함께 `NEEDS_USER` 로 멈춘다."],
  ["AC-4", "--auto", "이 두 멈춤은 `--auto` 의 결정 서브에이전트가 풀지 못한다(critical gate `round-cap-or-budget-needs-user` · `fix-induced-defects-majority`)."],
];

const expectedSection = (): string =>
  [HEADING, "", INTRO, "", ...ITEMS.map(([, label, sentence]) => `- **${label}** — ${sentence}`)].join("\n");

/** The new section of one rendering: its heading up to the next horizontal rule or level-2 heading. */
function sectionOf(text: string): string {
  const start = text.indexOf(HEADING);
  if (start < 0) return "";
  const ends = ["\n\n---\n", "\n\n## "].map((m) => text.indexOf(m, start + HEADING.length)).filter((at) => at >= 0);
  return text.slice(start, ends.length > 0 ? Math.min(...ends) : undefined);
}

/** The clean-code core block, measured exactly as FR-FLOW-206 measures it. */
function cleanCodeBlock(text: string): string {
  const start = text.indexOf(CLEAN_CODE_HEADING);
  if (start < 0) return "";
  const ends = ["\n\n---\n", "\n\n## "].map((m) => text.indexOf(m, start + CLEAN_CODE_HEADING.length)).filter((at) => at >= 0);
  return text.slice(start, ends.length > 0 ? Math.min(...ends) : undefined);
}

/** The rendering with the new section cut out, so a body sentence cannot be satisfied by the section itself. */
const bodyOutside = (text: string): string => {
  const section = sectionOf(text);
  return section === "" ? text : text.replace(section, "");
};

describe("FR-FLOW-229 AC-9 — one new section directly after the clean-code core block", () => {
  // @req FR-FLOW-229 AC-9 — the section is the pinned text, identical in every rendering and the mirror.
  it.each(COPIES)("%s carries exactly the pinned section", (rel) => {
    expect(sectionOf(read(rel))).toBe(expectedSection());
  });

  // @req FR-FLOW-229 AC-9 — the three renderings and the mirror agree.
  it("the three renderings and the mirror carry the same section", () => {
    const sections = COPIES.map((rel) => sectionOf(read(rel)));
    expect(sections[0]).not.toBe("");
    expect(new Set(sections).size).toBe(1);
  });

  // @req FR-FLOW-229 AC-9 — placed directly after the clean-code block, never inside it or before it.
  it.each(COPIES)("%s places the section directly after the clean-code core block", (rel) => {
    const text = read(rel);
    const block = cleanCodeBlock(text);
    expect(block).not.toBe("");
    const blockEnd = text.indexOf(block) + block.length;
    const between = text.slice(blockEnd, text.indexOf(HEADING));
    expect(text.indexOf(HEADING), `${rel}: section missing`).toBeGreaterThan(blockEnd - 1);
    expect(between.replace(/\s+/g, ""), `${rel}: something sits between the clean-code block and the section`).toMatch(/^(---)?$/);
    expect(block, `${rel}: the section is inside the clean-code block`).not.toContain("FR-FLOW-229");
  });

  // @req FR-FLOW-229 AC-9 — within the first 5,000 estimated tokens and at most 1,700 of its own.
  it.each(COPIES)(`%s ends the section within ${COMPACTION_TOKEN_BUDGET} estimated tokens, at most 1,700 of its own`, (rel) => {
    const text = read(rel);
    const section = sectionOf(text);
    expect(section).not.toBe("");
    expect(estimateTokens(section), `${rel}: section is ${estimateTokens(section)} estimated tokens`).toBeLessThanOrEqual(1700);
    expect(tokensThrough(text, section), `${rel}: section ends at ${tokensThrough(text, section)}`).toBeLessThanOrEqual(COMPACTION_TOKEN_BUDGET);
  });
});

describe("FR-FLOW-229 — every section line is held twice: the body outside the section says the same", () => {
  for (const [ac, label, sentence] of ITEMS) {
    // @req FR-FLOW-229 AC-1 AC-2 AC-3 AC-4 AC-5 AC-6 AC-7 AC-8 (the AC named in the test title)
    it(`${ac}: every rendering's body carries the "${label}" sentence outside the section`, () => {
      // The sentence must start a bullet, follow a bold label, or follow a finished sentence: a hedge
      // prefixed to it ("가능하면 같은 계열…") leaves the substring intact and must still fail.
      const starts = ["\n- ", ".** ", "다. "].map((lead) => `${lead}${sentence}`);
      const missing = COPIES.filter((rel) => !starts.some((s) => bodyOutside(read(rel)).includes(s)));
      expect(missing, `renderings whose body lacks the ${label} sentence`).toEqual([]);
    });
  }
});

describe("FR-FLOW-229 — the body wiring the section summarizes", () => {
  // @req FR-FLOW-229 AC-2 AC-5 — the classification table has the record class, and the lead's tier decision reaches the classifier output.
  it("AC-2: claude §0.G5 has a declared_limit row that is not fixed and that the user can raise to blocking", () => {
    const row = read(CLAUDE).split("\n").find((l) => l.startsWith("| **declared_limit** |")) ?? "";
    expect(row).toContain("기록 kept finding");
    expect(row).toContain("고치지 않고");
    expect(row).toContain("사용자가 차단으로 올리면 `immediate_fix` 로 간다");
  });
  it("AC-2: claude classified_findings.json has a declared_limit key and the check sums four keys", () => {
    const text = read(CLAUDE);
    expect(text).toContain('"declared_limit": [');
    expect(text).toContain("합계 = `review_inventory.findings.length` 검증 — 네 키(`immediate_fix` · `declared_limit` · `discussion_needed` · `rejected`)를 더한다");
  });
  // @req FR-FLOW-229 AC-5 AC-3 — the lead records tier, family and introduced_by_round for every kept finding.
  it("AC-5: claude classifier output records tier, family and introduced_by_round for each kept finding", () => {
    expect(read(CLAUDE)).toContain('"tier": "block|record", "family": "계열 이름", "introduced_by_round": null');
  });
  // @req FR-FLOW-229 AC-3 — the fixer receives the family and the lead's chosen action.
  it("AC-3: claude fixer input carries family and family_action", () => {
    expect(read(CLAUDE)).toContain("- finding 의 `family` 와, 계열 재발이면 리드가 고른 `family_action` (`standard-tool` | `single-rule` | `declare-limit`)");
  });
  // @req FR-FLOW-229 AC-2 AC-4 AC-8 — the run state carries what the round check reads.
  it.each([CLAUDE, ...REFERENCES])("AC-8: %s declares guarantee_scope, declared_limits, limits and rounds in state.json", (rel) => {
    const text = read(rel);
    for (const key of ["guarantee_scope", "declared_limits", "round_cap", "token_budget"]) {
      expect(text, `${rel}: ${key} missing`).toContain(key);
    }
    // The rounds[] entry is pinned as one field list (FR-NODE-274 AC-1), so dropping a field is red.
    const entry = rel === CLAUDE
      ? '`{ round, tree_sha, scope: "since-prev"|"full", scope_widen_reason, files[], tokens_used, residual_count, coverage_passed, findings: [{ id, tier: "block"|"record", family, introduced_by_round }] }`'
      : "Each `rounds[]` entry holds `round`, `tree_sha`, `scope` (`since-prev` or `full`), `scope_widen_reason` (string or null), `files[]`, `tokens_used`, `residual_count`, `coverage_passed` and `findings[]` of `{ id, tier: block|record, family, introduced_by_round }`";
    expect(text, `${rel}: the rounds[] field list`).toContain(entry);
  });
  // @req FR-FLOW-229 AC-7 — a blocking finding an earlier round left unresolved is carried into the latest round's findings[],
  // because the round check reads only the latest round; leaving it out lets the check return PASS while a blocking finding remains.
  it.each(REFERENCES)("AC-7: %s carries unresolved blocking findings into the round's findings[]", (rel) => {
    expect(read(rel).replace(/\s+/g, " ")).toContain("A blocking kept finding an earlier round left unresolved is carried again into that round's `findings[]`, keeping its `id`, `family` and `introduced_by_round` as first recorded, so `check_review_round`, which reads only the latest round, counts every blocking finding that remains.");
  });

  // @req FR-FLOW-229 AC-4 — the stop is "the round cap reached or the token budget exceeded"; a token budget merely reached does not stop.
  it.each([...COPIES, ...REFERENCES])("AC-4: %s never stops on a token budget merely reached", (rel) => {
    const offenders = read(rel).split("\n").filter((line) => /토큰 예산[^|.]{0,12}(닿|소진|도달)|상한이나 토큰 예산|token budget (is )?reached|cap or the token budget/.test(line));
    expect(offenders).toEqual([]);
  });

  // @req FR-FLOW-229 AC-1 — the round snapshot is taken without a commit, as FR-NODE-274 records it.
  it.each([CLAUDE, ...REFERENCES])("AC-1: %s writes out the review-start snapshot that becomes tree_sha", (rel) => {
    const text = read(rel);
    expect(text).toContain("GIT_INDEX_FILE=<tmp> git read-tree HEAD");
    expect(text).toContain("GIT_INDEX_FILE=<tmp> git add -A");
    expect(text).toContain("GIT_INDEX_FILE=<tmp> git write-tree");
  });
  // @req FR-FLOW-229 AC-4 AC-6 — both stops are critical gates --auto cannot lift, in every rendering.
  it.each(COPIES)("AC-4 AC-6: %s declares round-cap-or-budget-needs-user and fix-induced-defects-majority as critical gates", (rel) => {
    const lines = read(rel).split("\n");
    for (const gate of ["round-cap-or-budget-needs-user", "fix-induced-defects-majority"]) {
      const row = lines.find((l) => l.trim().startsWith(`| \`${gate}\` |`));
      expect(row, `${rel}: ${gate} row missing`).toBeDefined();
      expect((row ?? "").split("|")[2] ?? "", `${rel}: ${gate} reason must say NEEDS_USER`).toContain("NEEDS_USER");
    }
  });
  // @req FR-FLOW-229 AC-2 — the report lists the declared limits with their evidence.
  it("AC-2: claude report carries declared_limits and the blocking count", () => {
    const text = read(CLAUDE);
    expect(text).toContain("classified: { immediate_fix: A, declared_limit: D, discussion_needed: B, rejected: C }");
    expect(text).toContain("기록 finding 은 선언된 한계(`declared_limits[]`)로 **증거와 함께** 목록으로 보고한다");
  });
  // @req FR-FLOW-229 AC-4 AC-6 AC-8 — the abridged references carry the same exit rules in English.
  it.each(REFERENCES)("AC-4 AC-6 AC-7 AC-8: %s exit criteria call the round check and stop NEEDS_USER", (rel) => {
    const text = read(rel).replace(/\s+/g, " ");
    expect(text).toContain("a record (`declared_limit`) finding never blocks the pass");
    expect(text).toContain("at every round end, call `check_review_round` (CLI `speckiwi review-round check`) and follow its verdict");
    expect(text).toContain("the round cap reached or the token budget exceeded while a blocking kept finding remains ends the run `NEEDS_USER` with the blocking and record lists, not a pass");
    expect(text).toContain("blocking kept findings introduced by an earlier round's fix that outnumber half of a round's blocking findings end the run `NEEDS_USER`");
    expect(text).toContain("`declared_limit`");
  });
});

describe("FR-FLOW-229 — shared contracts name the review-fix-loop exception", () => {
  // @req FR-FLOW-229 AC-4 — loop-option §3 cap-reached behaviour names the NEEDS_USER exception.
  it.each(["skills/claude", "skills/codex", "skills/etc", ".agents/skills"])("AC-4: %s loop-option.md §3 names the review-fix-loop NEEDS_USER stop", (root) => {
    const text = read(`${root}/_shared/kiwi/loop-option.md`).replace(/\s+/g, " ");
    expect(text).toMatch(/kiwi-review-fix-loop[^.。]*NEEDS_USER/);
  });
  // @req FR-FLOW-229 AC-2 — auto-option's review-fix-loop row maps record findings to an automatic report.
  it.each(["skills/claude", "skills/codex", "skills/etc", ".agents/skills"])("AC-2: %s auto-option.md maps record findings to an automatic report", (root) => {
    const text = read(`${root}/_shared/kiwi/auto-option.md`).replace(/\s+/g, " ");
    expect(text).toMatch(/기록 kept → 선언된 한계로 자동 보고|record kept -> auto-report as a declared limit/);
  });
});
