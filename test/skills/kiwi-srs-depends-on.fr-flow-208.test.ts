import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { RENDERINGS, readRepoFile, scanUnits, sentencesWith } from "./kiwi-renderings.js";
import { COMPACTION_TOKEN_BUDGET, tokensThrough } from "./skill-token-estimate.js";

// @req FR-FLOW-208 — kiwi-srs records each dependency between requirements as a `Requirement` /
// `depends_on` Trace Link, and keeps every FR-PARSE-045 warning on a requirement the run added or
// changed as a kept finding. The AC numbers are the FR-FLOW-208 block in
// docs/spec/60.workflow-release.srs.md, which is canonical.
//
// Both rules sit in a core block of their own right after the FR-FLOW-205 block, and the block is
// pinned whole (the FR-FLOW-205 approach): a per-sentence `includes` lets an inserted exception ride
// along between two pinned sentences.

// verify r4: an exception written INTO a direction sentence ("기존 REQ 가 NEW-ID 에 기대도 신규 REQ 를 id
// 로 …", "— 단 신규 REQ 가 끼면 신규 REQ 를 id 에 둔다") kept the pinned phrase and passed. So every markdown
// block of kiwi-srs that names depends_on — the rule paragraphs, the §0.11 and §0.18 rows, the §9.2
// step, the examples — is recorded whole at the end of this file: deleting, inverting, hedging or
// weakening any sentence inside one changes the block and turns this red. Regenerate the record with
// UPDATE_D1_RULE_BLOCKS=1 and read the diff.
const SELF = fileURLToPath(import.meta.url);
const RECORD_START = "// <recorded-depends-on-units>";
const RECORD_END = "// </recorded-depends-on-units>";
/** Every block of one rendering's kiwi-srs text that names depends_on, as `<file>\t<block>`. */
function dependsOnUnits(root: string): string[] {
  return ["SKILL.md", "references/extended-workflow.md"].flatMap((file) =>
    scanUnits(readRepoFile(`${root}/kiwi-srs/${file}`).replace(/\r\n/g, "\n"), { splitListItems: true, splitFencedLines: true })
      .filter((unit) => unit.text.includes("depends_on"))
      .map((unit) => `${file}\t${unit.text}`)
  );
}
if (process.env.UPDATE_D1_RULE_BLOCKS === "1") {
  const own = readFileSync(SELF, "utf8");
  const record = Object.fromEntries(RENDERINGS.map((root) => [root, dependsOnUnits(root)]));
  const body = `const RECORDED_DEPENDS_ON_UNITS: Record<string, string[]> = ${JSON.stringify(record, null, 2)};`;
  writeFileSync(SELF, `${own.slice(0, own.lastIndexOf(RECORD_START) + RECORD_START.length)}\n${body}\n${own.slice(own.lastIndexOf(RECORD_END))}`, "utf8");
}

const SRS_COPIES = RENDERINGS.map((root) => `${root}/kiwi-srs/SKILL.md`);
/** The file that carries §9.1 (the author's context) in each rendering: claude inline, the others in the reference. */
const AUTHOR_CONTEXT_CARRIERS = RENDERINGS.map((root) =>
  root === "skills/claude" ? `${root}/kiwi-srs/SKILL.md` : `${root}/kiwi-srs/references/extended-workflow.md`
);

const read = (rel: string): string => readRepoFile(rel).replace(/\r\n/g, "\n");

const HEADING = "## 핵심 규칙 — 요구 사이 의존 (FR-FLOW-208)";
const AUTHOR_RULE =
  "요구 사이의 의존은 의존하는 요구에서 의존받는 요구로 `add_trace_link {type: \"Requirement\", relation: \"depends_on\"}` 하나로 적는다. 의존을 Requirement · Rationale · AC · 노트 문장에만 적지 않는다 — 문장에 적은 의존에는 같은 Trace Link 를 함께 단다.";
const VERIFY_RULE =
  "검증 라운드마다 `validate_spec` 이 이번 실행이 추가하거나 바꾼 요구에 낸 FR-PARSE-045 경고(산문에만 적은 의존, Type 이 `Requirement` 가 아닌 `depends_on` 행)는 하나하나 도구 진단이 붙은 kept finding 으로 keep 한다 — 그런 경고가 하나라도 남은 라운드는 통과하지 않는다.";
/** How every direction given to depends_on reads: the dependent requirement first, new or existing alike. */
const DEPENDENT_FIRST = "의존하는 요구 → 의존받는 요구";
const KEEP_ROW_CLAUSE = "그리고 이번 실행이 추가하거나 바꾼 요구에 남은 FR-PARSE-045 경고(이미 있던 것도, 핵심 규칙 블록 FR-FLOW-208)";
const AUTHOR_CONTEXT_LINE = "- 요구 사이 의존 — `depends_on` Trace Link 로 적는다(핵심 규칙 블록 FR-FLOW-208)";

/** The FR-FLOW-208 block of one rendering: from its heading to the first horizontal rule after it. */
function block(text: string): string {
  const start = text.indexOf(HEADING);
  if (start < 0) return "";
  const end = text.indexOf("\n\n---\n", start);
  return text.slice(start, end < 0 ? undefined : end);
}

describe("FR-FLOW-208 — kiwi-srs writes dependencies only as depends_on Trace Links", () => {
  for (const rel of SRS_COPIES) {
    // @req FR-FLOW-208 AC-1
    it(`AC-1: ${rel} tells the author to write each dependency as a Requirement/depends_on link and never only in text`, () => {
      expect(block(read(rel)).split("\n")).toContain(AUTHOR_RULE);
    });

    // @req FR-FLOW-208 AC-2
    it(`AC-2: ${rel} keeps every FR-PARSE-045 warning on a requirement the run touched and refuses to pass while one remains`, () => {
      expect(block(read(rel)).split("\n")).toContain(VERIFY_RULE);
    });

    // @req FR-FLOW-208 AC-1 AC-2 — nothing inserted beside the two rules, and both survive a compaction.
    it(`AC-1 AC-2: ${rel} carries exactly the pinned block, ending within ${COMPACTION_TOKEN_BUDGET} estimated tokens`, () => {
      const text = read(rel);
      const found = block(text);
      expect(found).toBe([HEADING, AUTHOR_RULE, VERIFY_RULE].join("\n\n"));
      expect(tokensThrough(text, found)).toBeLessThanOrEqual(COMPACTION_TOKEN_BUDGET);
    });
  }

  for (const root of RENDERINGS) {
    const docs = (): string[] => [`${root}/kiwi-srs/SKILL.md`, `${root}/kiwi-srs/references/extended-workflow.md`].map(read);
    // @req FR-FLOW-208 AC-1 — verify r3: §0.18 and §9.2 fixed the direction by which requirement is new
    // ("NEW-ID → 기존 REQ"), so an existing requirement that comes to depend on a new one was written
    // reversed. Every line of the skill that gives depends_on a direction gives the dependent first.
    it(`AC-1: ${root} every kiwi-srs line that gives depends_on a direction writes it from the dependent requirement`, () => {
      const offenders = docs()
        .flatMap((text) => text.split("\n"))
        .filter((line) => line.includes("depends_on") && /→|방향/.test(line) && !line.includes(DEPENDENT_FIRST))
        .map((line) => line.trim().slice(0, 140));
      expect(offenders).toEqual([]);
    });

    // @req FR-FLOW-208 AC-1 — the new → existing rule stays for the other relations, in a sentence that does not name depends_on.
    it(`AC-1: ${root} the new → existing direction rule does not cover depends_on`, () => {
      const rules = docs().flatMap((text) => sentencesWith(text, /신규 REQ\} → reference: \{기존 REQ\}|NEW-ID → 기존 REQ/));
      expect(rules.length, `${root}: the direction rule of the other relations`).toBeGreaterThan(0);
      expect(rules.filter((sentence) => sentence.includes("depends_on"))).toEqual([]);
    });
  }

  for (const root of RENDERINGS) {
    // @req FR-FLOW-208 AC-1 — every block naming depends_on is exactly as recorded: no exception or condition slips into a direction sentence.
    it(`AC-1: ${root} every kiwi-srs block that names depends_on is exactly the recorded block`, () => {
      const recorded = RECORDED_DEPENDS_ON_UNITS[root];
      expect(recorded, `the record has no section for ${root}`).toBeDefined();
      const live = dependsOnUnits(root);
      expect(live.filter((unit) => !recorded!.includes(unit)), `${root}: blocks not in the record — read them, then regenerate`).toEqual([]);
      expect(recorded!.filter((unit) => !live.includes(unit)), `${root}: recorded blocks the tree no longer carries`).toEqual([]);
    });
  }

  for (const rel of AUTHOR_CONTEXT_CARRIERS) {
    // @req FR-FLOW-208 AC-2 — verify r3: §11.1 kept only diagnostics the change newly raised, so a warning
    // already on a requirement the run changed had no keep row. The tool-diagnostic row names it.
    it(`AC-2: ${rel} §11.1 keeps an FR-PARSE-045 warning on a requirement the run touched, old or new`, () => {
      const row = read(rel).split("\n").find((line) => line.startsWith("| **keep** | 도구 진단 —")) ?? "";
      expect(row).toContain(KEEP_ROW_CLAUSE);
    });

    // @req FR-FLOW-208 AC-1 — the author subagent's context names the rule.
    it(`AC-1: ${rel} §9.1 hands the author the dependency rule`, () => {
      const text = read(rel);
      const context = text.slice(text.indexOf("### 9.1 "), text.indexOf("### 9.2 "));
      expect(context.split("\n")).toContain(AUTHOR_CONTEXT_LINE);
    });
  }
});

// The recorded depends_on blocks (FR-FLOW-208 AC-1). Generated; read the diff whenever it changes.
// <recorded-depends-on-units>
const RECORDED_DEPENDS_ON_UNITS: Record<string, string[]> = {
  "skills/claude": [
    "SKILL.md\t요구 사이의 의존은 의존하는 요구에서 의존받는 요구로 `add_trace_link {type: \"Requirement\", relation: \"depends_on\"}` 하나로 적는다. 의존을 Requirement · Rationale · AC · 노트 문장에만 적지 않는다 — 문장에 적은 의존에는 같은 Trace Link 를 함께 단다.",
    "SKILL.md\t검증 라운드마다 `validate_spec` 이 이번 실행이 추가하거나 바꾼 요구에 낸 FR-PARSE-045 경고(산문에만 적은 의존, Type 이 `Requirement` 가 아닌 `depends_on` 행)는 하나하나 도구 진단이 붙은 kept finding 으로 keep 한다 — 그런 경고가 하나라도 남은 라운드는 통과하지 않는다.",
    "SKILL.md\t| §0.11 | **Multi-aspect 요구사항 분리**. 1개 사용자 문장이 ≥2 코드 표면(예: addTodo + listTodos)을 다루면 기본은 표면당 1개 REQ로 분리하고 `depends_on` 으로 연결. 합치는 경우 `classification.rationale` 에 사유 기록 |",
    "SKILL.md\t| §0.18 | **Canonical relation encoding**. REQ 간 의존성은 `add_trace_link { type: \"Requirement\", relation: \"depends_on\\|supersedes\\|conflicts_with\\|extends\\|regression-only\" }` 만 SSOT. `tags: [\"depends_on:X\"]` 같은 tag 형식 금지. **방향 SSOT**: `depends_on` 은 신규·기존과 무관하게 의존하는 요구 → 의존받는 요구(`id: {의존하는 REQ} → reference: {의존받는 REQ}`) 방향이다(FR-FLOW-208). 그 밖의 relation 은 항상 `id: {신규 REQ} → reference: {기존 REQ}` 방향. e.g. `supersedes`: `{NEW-ID} supersedes {OLD-ID}` |",
    "SKILL.md\t{ \"id\": \"FR-TODO-001\", \"relation\": \"conflicts_with|supersedes|depends_on\", \"diff_summary\": \"...\" }",
    "SKILL.md\t- 기본: 표면당 1 REQ 분리 + `depends_on` cross-link",
    "SKILL.md\t- 요구 사이 의존 — `depends_on` Trace Link 로 적는다(핵심 규칙 블록 FR-FLOW-208)",
    "SKILL.md\t2. `add_trace_link` — 관련 REQ 의존성. `depends_on` 은 의존하는 요구 → 의존받는 요구로 적는다(기존 REQ 가 NEW-ID 에 기대면 기존 REQ → NEW-ID). `extends` 는 NEW-ID → 기존 REQ (§0.18)",
    "SKILL.md\t**AC cross-REQ claim 금지**: new-feature 가 `depends_on` 으로 다른 REQ를 참조할 때, 그 의존 REQ의 동작을 AC로 단정 금지. 필요 시 의존 REQ AC를 재진술 + `re_stated_from` 인라인 provenance."
  ],
  "skills/codex": [
    "SKILL.md\t요구 사이의 의존은 의존하는 요구에서 의존받는 요구로 `add_trace_link {type: \"Requirement\", relation: \"depends_on\"}` 하나로 적는다. 의존을 Requirement · Rationale · AC · 노트 문장에만 적지 않는다 — 문장에 적은 의존에는 같은 Trace Link 를 함께 단다.",
    "SKILL.md\t검증 라운드마다 `validate_spec` 이 이번 실행이 추가하거나 바꾼 요구에 낸 FR-PARSE-045 경고(산문에만 적은 의존, Type 이 `Requirement` 가 아닌 `depends_on` 행)는 하나하나 도구 진단이 붙은 kept finding 으로 keep 한다 — 그런 경고가 하나라도 남은 라운드는 통과하지 않는다.",
    "SKILL.md\t| §0.11 | **Multi-aspect 요구사항 분리**. 1개 사용자 문장이 ≥2 코드 표면(예: addTodo + listTodos)을 다루면 기본은 표면당 1개 REQ로 분리하고 `depends_on` 으로 연결. 합치는 경우 `classification.rationale` 에 사유 기록 |",
    "SKILL.md\t| §0.18 | **Canonical relation encoding**. REQ 간 의존성은 `add_trace_link { type: \"Requirement\", relation: \"depends_on\\|supersedes\\|conflicts_with\\|extends\\|regression-only\" }` 만 SSOT. `tags: [\"depends_on:X\"]` 같은 tag 형식 금지. **방향 SSOT**: `depends_on` 은 신규·기존과 무관하게 의존하는 요구 → 의존받는 요구(`id: {의존하는 REQ} → reference: {의존받는 REQ}`) 방향이다(FR-FLOW-208). 그 밖의 relation 은 항상 `id: {신규 REQ} → reference: {기존 REQ}` 방향. e.g. `supersedes`: `{NEW-ID} supersedes {OLD-ID}` |",
    "SKILL.md\t{ \"id\": \"FR-TODO-001\", \"relation\": \"conflicts_with|supersedes|depends_on\", \"diff_summary\": \"...\" }",
    "SKILL.md\t- 기본: 표면당 1 REQ 분리 + `depends_on` cross-link",
    "references/extended-workflow.md\t- 요구 사이 의존 — `depends_on` Trace Link 로 적는다(핵심 규칙 블록 FR-FLOW-208)",
    "references/extended-workflow.md\t2. `add_trace_link` — 관련 REQ 의존성. `depends_on` 은 의존하는 요구 → 의존받는 요구로 적는다(기존 REQ 가 NEW-ID 에 기대면 기존 REQ → NEW-ID). `extends` 는 NEW-ID → 기존 REQ (§0.18)",
    "references/extended-workflow.md\t**AC cross-REQ claim 금지**: new-feature 가 `depends_on` 으로 다른 REQ를 참조할 때, 그 의존 REQ의 동작을 AC로 단정 금지. 필요 시 의존 REQ AC를 재진술 + `re_stated_from` 인라인 provenance."
  ],
  "skills/etc": [
    "SKILL.md\t요구 사이의 의존은 의존하는 요구에서 의존받는 요구로 `add_trace_link {type: \"Requirement\", relation: \"depends_on\"}` 하나로 적는다. 의존을 Requirement · Rationale · AC · 노트 문장에만 적지 않는다 — 문장에 적은 의존에는 같은 Trace Link 를 함께 단다.",
    "SKILL.md\t검증 라운드마다 `validate_spec` 이 이번 실행이 추가하거나 바꾼 요구에 낸 FR-PARSE-045 경고(산문에만 적은 의존, Type 이 `Requirement` 가 아닌 `depends_on` 행)는 하나하나 도구 진단이 붙은 kept finding 으로 keep 한다 — 그런 경고가 하나라도 남은 라운드는 통과하지 않는다.",
    "SKILL.md\t| §0.11 | **Multi-aspect 요구사항 분리**. 1개 사용자 문장이 ≥2 코드 표면(예: addTodo + listTodos)을 다루면 기본은 표면당 1개 REQ로 분리하고 `depends_on` 으로 연결. 합치는 경우 `classification.rationale` 에 사유 기록 |",
    "SKILL.md\t| §0.18 | **Canonical relation encoding**. REQ 간 의존성은 `add_trace_link { type: \"Requirement\", relation: \"depends_on\\|supersedes\\|conflicts_with\\|extends\\|regression-only\" }` 만 SSOT. `tags: [\"depends_on:X\"]` 같은 tag 형식 금지. **방향 SSOT**: `depends_on` 은 신규·기존과 무관하게 의존하는 요구 → 의존받는 요구(`id: {의존하는 REQ} → reference: {의존받는 REQ}`) 방향이다(FR-FLOW-208). 그 밖의 relation 은 항상 `id: {신규 REQ} → reference: {기존 REQ}` 방향. e.g. `supersedes`: `{NEW-ID} supersedes {OLD-ID}` |",
    "SKILL.md\t{ \"id\": \"FR-TODO-001\", \"relation\": \"conflicts_with|supersedes|depends_on\", \"diff_summary\": \"...\" }",
    "SKILL.md\t- 기본: 표면당 1 REQ 분리 + `depends_on` cross-link",
    "references/extended-workflow.md\t- 요구 사이 의존 — `depends_on` Trace Link 로 적는다(핵심 규칙 블록 FR-FLOW-208)",
    "references/extended-workflow.md\t2. `add_trace_link` — 관련 REQ 의존성. `depends_on` 은 의존하는 요구 → 의존받는 요구로 적는다(기존 REQ 가 NEW-ID 에 기대면 기존 REQ → NEW-ID). `extends` 는 NEW-ID → 기존 REQ (§0.18)",
    "references/extended-workflow.md\t**AC cross-REQ claim 금지**: new-feature 가 `depends_on` 으로 다른 REQ를 참조할 때, 그 의존 REQ의 동작을 AC로 단정 금지. 필요 시 의존 REQ AC를 재진술 + `re_stated_from` 인라인 provenance."
  ],
  ".agents/skills": [
    "SKILL.md\t요구 사이의 의존은 의존하는 요구에서 의존받는 요구로 `add_trace_link {type: \"Requirement\", relation: \"depends_on\"}` 하나로 적는다. 의존을 Requirement · Rationale · AC · 노트 문장에만 적지 않는다 — 문장에 적은 의존에는 같은 Trace Link 를 함께 단다.",
    "SKILL.md\t검증 라운드마다 `validate_spec` 이 이번 실행이 추가하거나 바꾼 요구에 낸 FR-PARSE-045 경고(산문에만 적은 의존, Type 이 `Requirement` 가 아닌 `depends_on` 행)는 하나하나 도구 진단이 붙은 kept finding 으로 keep 한다 — 그런 경고가 하나라도 남은 라운드는 통과하지 않는다.",
    "SKILL.md\t| §0.11 | **Multi-aspect 요구사항 분리**. 1개 사용자 문장이 ≥2 코드 표면(예: addTodo + listTodos)을 다루면 기본은 표면당 1개 REQ로 분리하고 `depends_on` 으로 연결. 합치는 경우 `classification.rationale` 에 사유 기록 |",
    "SKILL.md\t| §0.18 | **Canonical relation encoding**. REQ 간 의존성은 `add_trace_link { type: \"Requirement\", relation: \"depends_on\\|supersedes\\|conflicts_with\\|extends\\|regression-only\" }` 만 SSOT. `tags: [\"depends_on:X\"]` 같은 tag 형식 금지. **방향 SSOT**: `depends_on` 은 신규·기존과 무관하게 의존하는 요구 → 의존받는 요구(`id: {의존하는 REQ} → reference: {의존받는 REQ}`) 방향이다(FR-FLOW-208). 그 밖의 relation 은 항상 `id: {신규 REQ} → reference: {기존 REQ}` 방향. e.g. `supersedes`: `{NEW-ID} supersedes {OLD-ID}` |",
    "SKILL.md\t{ \"id\": \"FR-TODO-001\", \"relation\": \"conflicts_with|supersedes|depends_on\", \"diff_summary\": \"...\" }",
    "SKILL.md\t- 기본: 표면당 1 REQ 분리 + `depends_on` cross-link",
    "references/extended-workflow.md\t- 요구 사이 의존 — `depends_on` Trace Link 로 적는다(핵심 규칙 블록 FR-FLOW-208)",
    "references/extended-workflow.md\t2. `add_trace_link` — 관련 REQ 의존성. `depends_on` 은 의존하는 요구 → 의존받는 요구로 적는다(기존 REQ 가 NEW-ID 에 기대면 기존 REQ → NEW-ID). `extends` 는 NEW-ID → 기존 REQ (§0.18)",
    "references/extended-workflow.md\t**AC cross-REQ claim 금지**: new-feature 가 `depends_on` 으로 다른 REQ를 참조할 때, 그 의존 REQ의 동작을 AC로 단정 금지. 필요 시 의존 REQ AC를 재진술 + `re_stated_from` 인라인 provenance."
  ]
};
// </recorded-depends-on-units>
