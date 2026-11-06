import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { COMPACTION_TOKEN_BUDGET, tokensThrough } from "./skill-token-estimate.js";

// @req FR-FLOW-205 — kiwi-srs judges every PRD item against the SRS in both directions: an
// unaccepted request fails, an ungrounded expansion is dropped or left to the user, and filling a
// hole, contradiction, or defect is accepted with its basis. The loop ends on pass/fail, not on
// severity labels. The AC numbers are the FR-FLOW-205 block in docs/spec/60.workflow-release.srs.md,
// which is canonical.
//
// Each rule is pinned as an EXACT sentence in all four kiwi-srs renderings, and each must END inside
// the first 5,000 estimated tokens (AC-7): Claude Code re-attaches only that much of a skill after a
// compaction, so a rule past it is a rule the compacted session no longer has. On top of that the
// whole core block is pinned as one exact text built from those sentences: an `includes` check per
// sentence let an inserted exception ("단, 검증자가 … 그대로 받아들인다") or an inserted contradiction
// ride along between two pinned sentences with every assertion green. The hash command the rules use
// is executed in kiwi-prd.fr-flow-204.test.ts, where it is also checked to be the same command in
// every kiwi-srs rendering.

const REPO_ROOT = fileURLToPath(new URL("../../", import.meta.url));
const RENDERINGS = ["skills/claude", "skills/codex", "skills/etc", ".agents/skills"] as const;
const SRS_COPIES = RENDERINGS.map((root) => `${root}/kiwi-srs/SKILL.md`);
/** Every kiwi-srs document an agent reads: the SKILL.md and, where the body is split, its reference. */
const SRS_DOCS = [
  ...SRS_COPIES,
  "skills/codex/kiwi-srs/references/extended-workflow.md",
  "skills/etc/kiwi-srs/references/extended-workflow.md",
  ".agents/skills/kiwi-srs/references/extended-workflow.md",
];
/** The file that carries §10–§14 in each variant: claude inline, the others in the reference. */
const LOOP_CARRIERS = [
  "skills/claude/kiwi-srs/SKILL.md",
  "skills/codex/kiwi-srs/references/extended-workflow.md",
  "skills/etc/kiwi-srs/references/extended-workflow.md",
  ".agents/skills/kiwi-srs/references/extended-workflow.md",
];
const ETC_CARRIER = "skills/etc/kiwi-srs/references/extended-workflow.md";

const read = (rel: string): string => readFileSync(path.join(REPO_ROOT, rel), "utf8").replace(/\r\n/g, "\n");

type Rule = readonly [ac: string, label: string, sentence: string];

const R = {
  head: ["AC-7", "the block outranks the body",
    "이 블록은 아래 본문보다 앞선다. 본문의 어느 절도 이 블록의 판정을 건너뛰게 하지 않는다."],
  in1: ["AC-1", "a non-PRD input goes to kiwi-prd first as the source of U-1",
    "`PRD_PATH` 가 없고 입력이 PRD 가 아니면 — 인라인 요청(`REQ_TEXT`)·이슈·`REQ_PATH` 문서 — 조사보다 먼저 `kiwi-prd` 를 불러 그 입력을 `U-1` 의 원천으로 PRD 를 만들고, 그 PRD 로 판정한다."],
  in1b: ["AC-1", "an issue's U-1 is its title and body as written; the research excerpt is reference only",
    "이슈 입력이면 `U-1` 은 입력이 가리키는 이슈에서 읽은 제목과 본문 원문이다 — 이슈에서 파생된 발췌본(`issue-excerpt.md`)은 `U-1` 의 원천이 아니라 참고 자료이고 근거가 되지 못한다. `kiwi-prd` 가 이슈 원문을 읽지 못했다고 돌려주면 완료 보고에 그대로 싣는다."],
  in2: ["AC-1", "no input at all also starts at kiwi-prd",
    "입력이 없으면 `kiwi-prd` 가 사용자에게 요청부터 받는다."],
  in3: ["AC-1", "PRD_PATH is the judging basis and REQ_PATH keeps its own input",
    "`PRD_PATH` 가 있으면 그 PRD 로 판정하고 `REQ_PATH` 는 받은 입력 그대로 둔다. `REQ_PATH` 가 `docs/prd/` 의 PRD 이면 그것이 판정할 PRD 다."],
  in4: ["AC-1", "no path authors without a PRD to judge against",
    "판정할 PRD 없이 저작하는 경로는 없다."],
  in5: ["AC-1", "kiwi-srs runs no question loop of its own",
    "kiwi-srs 는 질문 루프를 따로 돌리지 않는다 — 요구를 묻고 기록하는 일은 `kiwi-prd` 의 몫이다."],
  in6: ["AC-1", "--auto and --qna-force are forwarded to kiwi-prd",
    "`--auto` 와 `--qna-force` 는 `kiwi-prd` 에 그대로 넘긴다."],
  // verify-r2 K5: the old sentence reported an unapproved PRD but authored from any of them, so a
  // draft left mid-question by a compaction authored with its boundary questions still open.
  in7: ["AC-1", "only an approved PRD or an --auto PRD authors; any other draft ends NEEDS_USER, also under --auto, and an --auto PRD is reported",
    "`Status` 행이 승인 값(`kiwi-prd` 가 승인 때 쓰는 값)이 아닌 PRD 로는 저작하지 않고 `NEEDS_USER` 로 끝난다 — `--auto` 에서도 그렇게 끝나며 결정 위원회가 정하지 않는다(critical gate `prd-unapproved-user-decision`). 예외는 `kiwi-prd` 가 `--auto` 로 만든 PRD(`Status` 행이 `unapproved` 이고 승인 행에 `--auto` 가 적힌 PRD) 하나이며, 그 PRD 로 저작했으면 완료 보고에 `Status` 행 값을 그대로 싣는다."],
  rec1: ["AC-2", "the PRD travels as a path",
    "PRD 는 요약하지 않고 경로로 모든 저작·검증·개선 서브에이전트에 넘긴다."],
  rec2: ["AC-2", "the LF-normalized hash is recomputed every round and on resume; a mismatch stops under --auto too",
    "라운드를 시작할 때마다, 그리고 재개할 때 아래 `prd-hash` 명령으로 줄 끝을 LF 로 맞춘 PRD 해시를 다시 계산하고, `Request SHA256` 행과 다르면(종료 코드 1) critical gate `prd-record-tampered` 로 멈춘다 — `--auto` 에서도 멈춘다."],
  rec3: ["AC-6", "kiwi-srs never writes the record it verifies",
    "kiwi-srs 는 PRD 를 고치지 않고 `Request SHA256` 행도 쓰지 않는다."],
  log1: ["AC-3", "one verdict per PRD item and per requirement and criterion the run adds or changes",
    "검증 라운드마다 `eval_iter{N}.json` 의 `prd_items[]` 에 PRD 항목마다 판정 하나를 항목 순서대로 적고, `srs_items[]` 에는 이번 실행이 추가하거나 바꾼 요구와 AC 마다 판정 하나를 적는다."],
  log2: ["AC-3", "requirements the run leaves untouched are not judged against the PRD",
    "이번 실행이 건드리지 않은 기존 요구는 PRD 와 대조하지 않는다 — (b)·(c) 판정도 이번 실행이 추가하거나 바꾼 요구와 AC 에만 한다."],
  log3: ["AC-3", "a short verdict list does not pass",
    "`prd_items[]` 의 길이가 PRD 항목 수와 다른 라운드는 통과하지 않는다."],
  log4: ["AC-3", "the item count and where a requirement cites an item",
    "PRD 항목 수는 `### PRD-` 로 시작하는 줄의 수다. 요구가 PRD 항목을 인용하는 곳은 그 요구의 Rationale 이다(예: `AC-3 ← PRD-4`)."],
  a1: ["AC-4", "(a) an unaccepted or contradicted item fails",
    "(a) `intent` · `goal` · `in-scope` 항목을 근거로 인용한 요구나 AC 가 없거나, 요구나 AC 가 그 항목과 반대로 말하면 그 항목의 판정은 fail 이고 루프는 통과하지 않는다."],
  // FR-FLOW-205 AC-4 last sentence (fix-r4 4b): a rejected item leaves the fail check.
  a1b: ["AC-4", "(a) a rejected item leaves the fail check",
    "`State` 가 `rejected` 인 항목은 이 fail 검사에서도 빠진다."],
  // verify-r15: a confirmed proposal adding scope is checked as an in-scope item (AC-4 last sentence).
  a1c: ["AC-4", "(a) a confirmed proposal whose Effect is in-scope is checked as an in-scope item",
    "`Effect` 가 in-scope 인 확정 proposal 은 in-scope 항목처럼 이 fail 검사를 받는다."],
  a2: ["AC-4", "(a) in a wave run covers the items the excerpt names",
    "`REQ_PATH` 가 PRD 항목 ID 를 지명한 wave excerpt 이면 (a) 는 그 excerpt 가 지명한 항목만 검사하고, 지명되지 않은 항목은 `prd_items[]` 에 `other-wave` 로 적는다."],
  b1: ["AC-5", "(b) an ungrounded or excluded addition is dropped with its reason",
    "(b) 아무 PRD 항목도 인용하지 않고 `fills:` 근거도 없는 요구나 AC, 또는 exclusion 항목에 걸리는 요구나 AC 는 drop 하고 사유를 보고한다."],
  b2: ["AC-5", "(b) a necessity claim without the hole is residual",
    "검증자가 그것이 필요하다고 주장하면서 메우는 구멍을 대지 못하면 drop 하지 않고 residual 로 남긴다."],
  // verify-r4: a proposal the user rejected grounds nothing (AC-5 last sentence).
  b3: ["AC-5", "(b) a rejected item is no basis, so citing only rejected items drops",
    "`State` 가 `rejected` 인 항목은 근거가 되지 못한다 — 거절된 항목만 인용한 요구나 AC 도 drop 한다."],
  // verify-r15: a confirmed proposal limiting scope acts as an exclusion item (AC-5 last sentence).
  b4: ["AC-5", "(b) a confirmed proposal whose Effect is exclusion acts as an exclusion item",
    "`Effect` 가 exclusion 인 확정 proposal 은 exclusion 항목으로 작동한다 — 그 proposal 에 걸리는 요구나 AC 도 drop 한다."],
  // FR-FLOW-227: the fills: basis names the criteria it grounds, in the form `speckiwi prd coverage` counts.
  c1: ["AC-6", "(c) filling a hole is accepted only with a fills: basis",
    "(c) 요청의 구멍·모순·결함을 메우는 추가는 그 요구의 Rationale 에 `fills: PRD-<n> / <hole|contradiction|defect> / for AC-<m>, <reason>` 이 있을 때만 받아들인다."],
  c1b: ["AC-6", "(c) the fills: basis names every criterion it grounds, or coverage counts it for none (FR-FLOW-227)",
    "`for` 뒤에는 그 근거로 메우는 AC 를 모두 적는다 — 여럿이면 `for AC-1, AC-3`, 범위면 `for AC-1–AC-3` 이다. AC 를 적지 않은 `fills:` 는 `speckiwi prd coverage` 가 어느 AC 의 근거로도 세지 않는다."],
  c2: ["AC-6", "a fill stays the smallest one inside the item's boundary",
    "메우기는 그 항목의 경계 안에서 가장 작게 한다."],
  // verify-r2 R1 / AC-6 as revised: the loop resolves a contradiction itself, scope removal included.
  c3: ["AC-6", "the loop resolves a contradiction between items itself and records it through kiwi-prd",
    "항목 사이의 모순은 루프가 직접 푼다 — 의도(`intent`) 항목에 맞는 쪽을 고르고, 그 해소가 in-scope 항목을 없애거나 exclusion 을 좁혀도 그렇게 하며, 해소는 `kiwi-prd` 를 통해 PRD 에 `Reason` 이 `contradiction resolved:` 로 시작하는 proposal 로 기록하고 완료 보고에 나열한다."],
  // 16b: a contradiction resolution keeps State=proposed (AC-6 last sentence).
  c3d: ["AC-6", "a contradiction resolution keeps State=proposed and takes effect as a recorded resolution",
    "해소 proposal 은 확정되지 않은 채 `State` 를 바꾸지 않고, `State` 가 아니라 기록된 해소로서 효력을 가진다."],
  c3b: ["AC-6", "an in-scope item a resolution removed is resolved, not an (a) fail",
    "그 해소로 빠진 in-scope 항목은 `prd_items[]` 에 그 proposal 을 가리켜 `resolved` 로 적고 (a) 의 fail 로 세지 않는다."],
  // verify-r3 D: the (b) drop rule must not undo a resolution that narrowed an exclusion.
  c3c: ["AC-6", "a requirement a resolution allowed by narrowing an exclusion is not dropped under (b)",
    "exclusion 을 좁힌 해소가 허용한 요구나 AC 는 그 exclusion 항목에 걸리지 않는 것으로 보고 (b) 로 drop 하지 않는다."],
  c4: ["AC-6", "generated research is not a basis",
    "kiwi-srs 가 만든 리서치 문서는 근거가 되지 못한다 — 요구를 더할 근거는 PRD 항목 인용과 `fills:` 뿐이다."],
  wave: ["AC-4", "(b) and (c) in a wave run still use the whole PRD",
    "(b)·(c) 는 wave run 에서도 PRD 전체를 기준으로 판정한다 — exclusion 항목은 모든 wave 에 걸린다."],
  end1: ["AC-8", "a round passes on the PRD verdicts — a violated exclusion or confirmed exclusion proposal fails it — and zero kept findings, never on severity",
    "라운드는 PRD 판정((a) fail 0 · `prd_items[]` 길이 일치 · exclusion 항목과 `Effect` 가 exclusion 인 확정 proposal 의 `violated` 0 · 반영된 (b) 0 · 모든 (c) 에 `fills:`)이 통과하고 kept finding 이 0 일 때만 통과한다 — 심각도 라벨(CRITICAL·HIGH·MEDIUM·LOW)은 종료 판정에 쓰지 않는다."],
  end2: ["AC-8", "a finding is kept only with evidence, otherwise dropped",
    "검증자 finding 은 증거 — 도구 진단, 실패한 검사, 서로 모순되는 두 문장의 인용 — 가 붙을 때만 keep 하고, 증거가 없으면 drop 하고 사유를 보고한다."],
  end3: ["AC-8", "a dropped requirement or criterion is removed from the SRS",
    "(b) 로 drop 된 요구·AC 는 개선 단계가 SRS 에서 제거한다(§11.3)."],
  end4: ["AC-7", "a residual ends the run NEEDS_USER, --auto too, never settled by the committee",
    "residual 이 하나라도 남으면 kiwi-srs 는 `NEEDS_USER` 로 끝난다 — `--auto` 에서도 그렇게 끝나며 결정 위원회가 정하지 않는다(critical gate `prd-residual-user-decision`)."],
  // verify-r9: a run that reaches the round cap with no passing round must not end TASK_DONE (AC-8 last sentence).
  end6: ["AC-8", "reaching the round cap before the loop's pass condition is met ends NEEDS_USER and names what is still open",
    "루프의 통과 조건(통과 라운드 1회, etc 단일 워커 프로필은 3회 연속 통과)을 채우기 전에 라운드 상한에 닿으면 kiwi-srs 는 `TASK_DONE` 으로 끝내지 않고 `NEEDS_USER` 로 끝나며, 아직 fail 인 PRD 항목과 아직 열린 kept finding 을 모두 이름으로 적는다 — `--auto` 에서도 그렇게 끝나며 결정 위원회가 정하지 않는다(critical gate `prd-cap-unpassed-user-decision`)."],
  end5: ["AC-1", "scope grows only through the user's words",
    "사용자가 답하면 `kiwi-prd` 가 그 답을 `U-<n>` 으로 덧붙이고 해시를 다시 쓴다 — 범위는 사용자의 말로만 늘어난다."],
} as const satisfies Record<string, Rule>;

const s = (key: keyof typeof R): string => R[key][2];

/** The prd-hash fence, read from kiwi-prd (FR-FLOW-204 AC-6 asserts both skills carry the same command). */
function hashFence(): string {
  const lines = read("skills/claude/kiwi-prd/SKILL.md").split("\n");
  const at = lines.findIndex((line) => line.startsWith("# prd-hash:"));
  expect(at, "kiwi-prd carries no prd-hash command").toBeGreaterThan(0);
  return ["```bash", lines[at], lines[at + 1], "```"].join("\n");
}

const CORE_HEADING = "## 핵심 규칙 — 컴팩션 뒤에도 남는 PRD 판정 (FR-FLOW-205)";

/** The whole core block, exactly: nothing may be inserted between, before, or after the pinned rules. */
function expectedCoreBlock(): string {
  return [
    CORE_HEADING,
    "",
    s("head"),
    "",
    `**입력.** ${s("in1")} ${s("in1b")} ${s("in2")} ${s("in3")} ${s("in4")} ${s("in5")} ${s("in6")} ${s("in7")}`,
    "",
    `**기록 보존.** ${s("rec1")} ${s("rec2")} ${s("rec3")}`,
    "",
    hashFence(),
    "",
    `**판정 기록.** ${s("log1")} ${s("log2")} ${s("log3")} ${s("log4")}`,
    "",
    "**판정 셋.**",
    `- ${s("a1")} ${s("a1b")} ${s("a1c")} ${s("a2")}`,
    `- ${s("b1")} ${s("b2")} ${s("b3")} ${s("b4")}`,
    `- ${s("c1")} ${s("c1b")} ${s("c2")} ${s("c3")} ${s("c3d")} ${s("c3b")} ${s("c3c")} ${s("c4")}`,
    `- ${s("wave")}`,
    "",
    `**종료.** ${s("end1")} ${s("end2")} ${s("end3")} ${s("end4")} ${s("end6")} ${s("end5")}`,
  ].join("\n");
}

/** The core block of one rendering: from its heading to the first horizontal rule after it. */
function coreBlock(text: string): string {
  const start = text.indexOf(CORE_HEADING);
  if (start < 0) return "";
  const end = text.indexOf("\n\n---\n", start);
  return text.slice(start, end < 0 ? undefined : end);
}

describe("FR-FLOW-205 — kiwi-srs PRD verdict rules, inside the compaction window", () => {
  for (const [ac, label, needle] of Object.values(R)) {
    // @req FR-FLOW-205 AC-1 AC-2 AC-3 AC-4 AC-5 AC-6 AC-7 AC-8 (the AC named in the test title)
    it(`${ac}: every rendering carries — ${label}`, () => {
      const missing = SRS_COPIES.filter((rel) => !read(rel).includes(needle));
      expect(missing, `renderings missing the ${ac} sentence`).toEqual([]);
    });

    // @req FR-FLOW-205 AC-7 — every AC-1..AC-6 and AC-8 rule ends within the first 5,000 estimated tokens.
    it(`AC-7: the ${ac} rule '${label}' ends within ${COMPACTION_TOKEN_BUDGET} estimated tokens in every rendering`, () => {
      for (const rel of SRS_COPIES) {
        const at = tokensThrough(read(rel), needle);
        expect(at, `${rel}: rule missing`).toBeGreaterThan(0);
        expect(at, `${rel}: rule ends at ${at} estimated tokens`).toBeLessThanOrEqual(COMPACTION_TOKEN_BUDGET);
      }
    });
  }

  // @req FR-FLOW-205 AC-1 AC-2 AC-3 AC-4 AC-5 AC-6 AC-7 AC-8 — the block is exactly the pinned rules.
  it.each(SRS_COPIES)("%s: the core block is exactly the pinned rules — nothing inserted, nothing removed", (rel) => {
    expect(coreBlock(read(rel))).toBe(expectedCoreBlock());
  });

  // @req FR-FLOW-205 AC-2 — the hash command sits next to the rule, inside the window too.
  it("AC-2: every rendering's prd-hash command ends within the compaction window", () => {
    for (const rel of SRS_COPIES) {
      const text = read(rel);
      const line = text.split("\n").find((l) => l.trim().startsWith("# prd-hash:"));
      expect(line, `${rel}: no prd-hash command`).toBeDefined();
      const commandLine = text.split("\n")[text.split("\n").indexOf(line ?? "") + 1] ?? "";
      expect(commandLine).toMatch(/^node -e "/);
      expect(tokensThrough(text, commandLine)).toBeLessThanOrEqual(COMPACTION_TOKEN_BUDGET);
    }
  });

  // @req FR-FLOW-205 AC-2 — --auto cannot pass a tampered record: it is a declared critical gate.
  it("AC-2: every rendering declares prd-record-tampered in its --auto critical_gates table", () => {
    for (const rel of SRS_COPIES) {
      const row = read(rel).split("\n").find((l) => l.trim().startsWith("| `prd-record-tampered` |"));
      expect(row, `${rel}: critical gate row missing`).toBeDefined();
      expect((row ?? "").split("|")[2] ?? "", `${rel}: gate reason must name --auto`).toMatch(/--auto/);
    }
  });
});

describe("FR-FLOW-205 AC-1 — every non-PRD input goes to kiwi-prd first, and the body says so too", () => {
  // The core block outranks the body, but a body that states the opposite rule is still read first by
  // whoever lands on it, and the description is not "the body" at all. Measured before this change:
  // the block said "kiwi-prd when neither REQ_PATH nor PRD_PATH", while §1.1, §1.2 and the description
  // said "kiwi-prd only when there is no requirement input" — so an inline `REQ_TEXT` request, the
  // RBAC incident's own input, authored with no PRD.
  const RETIRED = [
    "`REQ_PATH` 도 `PRD_PATH` 도 없으면",
    "판정할 PRD 가 없으면",
    "요구 입력이 없으면",
    "둘 다 없으면 `kiwi-prd`",
    "REQ_PATH·PRD_PATH 둘 다 없을 때",
    "no PRD judged",
    // verify-r2 K5: reporting an unapproved PRD without refusing a draft.
    "미승인 PRD(`Status` 행이 `unapproved`)로 저작했으면",
  ];

  // @req FR-FLOW-205 AC-1
  it.each(SRS_DOCS)("%s: carries none of the retired 'kiwi-prd only without input' rules or the skip branch", (rel) => {
    const text = read(rel);
    expect(RETIRED.filter((phrase) => text.includes(phrase)), rel).toEqual([]);
  });

  // @req FR-FLOW-205 AC-1 — §1.1, §1.2 and the phase list state the core block's rule.
  it.each(SRS_COPIES)("%s: §1.1, §1.2 and the phase list state the same input rule", (rel) => {
    const text = read(rel);
    expect(text).toContain("- 입력이 PRD 가 아니고 `PRD_PATH` 도 없으면 Phase 0.5 에서 `kiwi-prd` 가 그 입력을 `U-1` 로 삼아 PRD 를 먼저 만든다(핵심 규칙 블록). 입력이 없으면 `kiwi-prd` 가 요청부터 받는다.");
    expect(text).toContain("- `--auto` 부재 (기본) → `PRD_PATH` 가 없고 입력이 PRD 가 아니면 `kiwi-prd` 가 사용자에게 물으며 PRD 를 만든다 (핵심 규칙 블록).");
    expect(text).toContain("Phase 1 조사보다 먼저 핵심 규칙 블록의 **입력** 규칙을 적용한다. `PRD_PATH` 가 없고 입력이 PRD 가 아니면 그 입력(인라인 요청·`REQ_PATH` 문서, 이슈면 이슈 번호)을 넘겨 `kiwi-prd` 를 부르고(`--auto` · `--qna-force` 는 그대로 넘긴다), 돌려받은 PRD 경로를 이 run 의 `PRD_PATH` 로 쓴다.");
    // The issue entry's excerpt is reference material; U-1 is the issue itself.
    expect(text).toContain("이 발췌본은 참고 자료이고 `U-1` 의 원천이 아니다 — `kiwi-prd` 가 `gh issue view {N} --json title,body,comments` 로 이슈 원문을 읽어 `U-1` 에 쓴다(핵심 규칙 블록). 이슈 번호는 발췌본 첫 줄 `Issue: https://github.com/{owner}/{repo}/issues/{N}` 에서 읽는다.");
  });

  // @req FR-FLOW-205 AC-1 — the two issue-entry skills say the same as kiwi-srs and kiwi-prd: the scope
  // comes from the PRD kiwi-prd builds out of the issue as written, and the excerpt carries the Issue
  // line kiwi-prd reads the number from. FR-FLOW-174's required literals stay (its own suite holds them).
  const ISSUE_ENTRY = ["skills/claude", "skills/codex", "skills/etc", ".agents/skills"];
  it.each(ISSUE_ENTRY)("%s: kiwi-pipeline says the PRD, not the excerpt, sets the scope", (root) => {
    const text = read(`${root}/kiwi-pipeline/SKILL.md`);
    expect(text).toContain("즉 발췌본이 무엇을 만들지를 정하고 보고서가 그것을 검증한다. 다만 무엇을 만들지의 범위는 `kiwi-srs` 가 `kiwi-prd` 로 이슈 원문에서 만든 PRD 가 최종으로 정하고, 발췌본은 그 PRD 의 초안이자 참고 자료다 — `U-1` 은 이슈 원문이다.");
  });
  it.each(ISSUE_ENTRY)("%s: kiwi-srs-research writes the Issue line at the top of the excerpt", (root) => {
    const text = read(`${root}/kiwi-srs-research/SKILL.md`);
    expect(text).toContain("발췌본의 첫 줄에는 `Issue: https://github.com/{owner}/{repo}/issues/{N}` 를 적는다 — `kiwi-prd` 가 이 줄로 이슈 원문을 읽어 `U-1` 을 쓰고, 발췌본은 그 PRD 의 초안이자 참고 자료로 남는다.");
  });

  // @req FR-FLOW-205 AC-1 — the description an agent reads before anything else states it as well.
  it("every rendering's description states that a non-PRD input goes to kiwi-prd first", () => {
    const description = (rel: string): string => /^description: "(.*)"$/m.exec(read(rel))?.[1] ?? "";
    for (const rel of ["skills/claude/kiwi-srs/SKILL.md", "skills/codex/kiwi-srs/SKILL.md", ".agents/skills/kiwi-srs/SKILL.md"]) {
      expect(description(rel), rel).toContain("PRD 가 아닌 입력(인라인 요청·이슈·요구 파일)이면");
    }
    expect(description("skills/etc/kiwi-srs/SKILL.md")).toContain("A non-PRD input (inline request, issue, or requirement file) goes to kiwi-prd first");
  });

  // @req FR-FLOW-205 AC-1 — the issue hand-off (FR-FLOW-028 AC-2) reaches kiwi-prd through kiwi-srs:
  // kiwi-pipeline passes the excerpt as REQ_PATH with --qna-force and no PRD_PATH, which is exactly
  // the input the core block's first rule sends to kiwi-prd with --qna-force forwarded.
  it.each(["skills/claude", "skills/codex", "skills/etc"])("%s: kiwi-pipeline hands the issue excerpt to kiwi-srs without a PRD", (root) => {
    const text = read(`${root}/kiwi-pipeline/SKILL.md`);
    expect(text).toContain("REQ_PATH=docs/analysis/kiwi-srs-research-{run-id}/issue-excerpt.md");
    expect(text).toMatch(/kiwi-srs` 를 `--qna-force` 로 시작/);
    expect(text).not.toContain("PRD_PATH");
  });

  // @req FR-FLOW-205 AC-1
  it("no rendering defines a QnA loop phase", () => {
    for (const rel of SRS_COPIES) {
      const text = read(rel);
      expect(text, rel).not.toMatch(/^## 5\. Phase 1\.5 — QnA loop/m);
      expect(text, rel).not.toMatch(/^Phase 1\.5 : QnA loop/m);
      expect(text, rel).not.toMatch(/무(?:한|제한)\s*(?:qna|질문)\s*루프|unbounded\s+qna/i);
      expect(text, rel).not.toContain("qna_log.json");
    }
  });

  // @req FR-FLOW-205 AC-1 — the phase list runs kiwi-prd before the Phase 1 investigators, so the
  // request is on disk before anything investigates it (FR-FLOW-204 AC-1 inside kiwi-srs).
  it("every rendering's phase list runs kiwi-prd at Phase 0.5, before Phase 1", () => {
    for (const rel of SRS_COPIES) {
      const lines = read(rel).split("\n");
      const prd = lines.indexOf("Phase 0.5 : PRD 확보 (PRD_PATH 가 없고 입력이 PRD 가 아니면 kiwi-prd, Phase 1 조사 전)");
      expect(prd, rel).toBeGreaterThan(0);
      const phase1 = lines.findIndex((l, i) => i > prd && l.startsWith("Phase 1   :"));
      expect(phase1, `${rel}: Phase 1 must follow Phase 0.5`).toBe(prd + 1);
    }
  });
});

describe("FR-FLOW-205 AC-8 — the loop ends on pass/fail, not on severity labels", () => {
  // @req FR-FLOW-205 AC-8 — the Normal pass line and the --max line in §11.2.
  it.each(LOOP_CARRIERS.filter((rel) => rel !== ETC_CARRIER))("%s: §11.2 passes on the PRD verdicts and zero kept findings, in both modes", (rel) => {
    const text = read(rel);
    expect(text).toContain("- PRD 판정 통과(핵심 규칙 블록) AND kept finding = 0 → 통과 (즉시 Phase 7)");
    expect(text).toContain("- 통과 조건은 Normal 과 같다 — `--max` 는 독립 2차 검증 패스로 검증 강도만 올리고 연속 통과를 요구하지 않는다.");
  });

  // @req FR-FLOW-205 AC-8 — etc keeps its local-LLM streak of three, counted in kept findings.
  it("the etc reference advances after three consecutive rounds with no kept finding and the PRD verdicts passing", () => {
    const text = read(ETC_CARRIER);
    expect(text).toContain("- 단일 evaluator 가 kept finding 없음을 **3회 연속** 반환하고 PRD 판정(핵심 규칙 블록)도 통과해야 Phase 7 로 진행한다.");
    expect(text).toContain("- kept finding 은 개선사항으로 간주하고 Phase 4 개선 라우팅 후 clean counter 를 0으로 재설정한다.");
  });

  // @req FR-FLOW-205 AC-8 — the emit rule maps a run that hit the round cap without a passing round to NEEDS_USER (verify-r9).
  it.each(LOOP_CARRIERS)("%s: §12.1.5 emits NEEDS_USER, not TASK_DONE, for a run that hits the round cap before the loop's pass condition is met", (rel) => {
    expect(read(rel)).toContain("- `status`: 정상 종료 = `TASK_DONE`; 사용자 결정 보류로 종료 = `NEEDS_USER`(PRD 판정 residual 이 남은 경우 포함); 루프의 통과 조건(통과 라운드 1회, etc 단일 워커 프로필은 3회 연속 통과)을 채우기 전에 라운드 상한에 닿아 종료 = `NEEDS_USER`(§11.2, `TASK_DONE` 아님, `--auto` 에서도 critical gate `prd-cap-unpassed-user-decision`); 실패 = `FAILED`; dry-run = `DRY_RUN`");
  });

  // @req FR-FLOW-205 AC-8 — the convergence criteria state the same pass condition.
  it.each(LOOP_CARRIERS)("%s: §14 ends a run only on the PRD verdicts and zero kept findings", (rel) => {
    expect(read(rel)).toContain("- 종료: PRD 판정 통과 ∧ kept finding = 0 (Normal·Max 공통)");
  });

  // @req FR-FLOW-205 AC-8 — a dropped requirement or criterion is removed by the improvement step (R3).
  it.each(LOOP_CARRIERS)("%s: §11.3 routes a (b) drop to its removal from the SRS and fixes only kept findings", (rel) => {
    const text = read(rel);
    expect(text).toContain("kept finding 만 고친다 — drop 한 finding 은 고치지 않는다.");
    expect(text).toContain("- **PRD 판정 (b) drop**: 개선 단계가 drop 된 요구·AC 를 SRS 에서 제거한다 — 이번 실행이 추가한 요구는 `update_status(discarded)` 로, 이번 실행이 더한 AC 는 그 AC 를 뺀 목록의 `replace_acceptance_criteria` 로 지우고, 이번 실행이 바꾼 기존 AC 는 바꾸기 전 문장으로 되돌린다.");
  });

  // @req FR-FLOW-205 AC-8 FR-FLOW-204 AC-5 — the report lists kept and dropped findings and carries the PRD state as it is.
  it.each(LOOP_CARRIERS)("%s: §12.2 reports kept/dropped findings and the PRD Status row verbatim", (rel) => {
    const text = read(rel);
    expect(text).toContain("- finding: kept {n} / drop {n}(사유 목록)");
    expect(text).toContain("- PRD: {path} (`Status` 행 값 그대로) — (a) fail {n} / drop {n}(사유 목록) / residual {n}(목록) / 모순 해소 {n}(`contradiction resolved:` proposal 목록)");
  });

  // @req FR-FLOW-205 AC-8 — no severity exit survives anywhere an agent reads, the description included.
  const SEVERITY_EXITS: ReadonlyArray<readonly [string, RegExp]> = [
    ["CRITICAL=0", /CRITICAL\s*=\s*0/],
    ["HIGH=0", /HIGH\s*=\s*0/],
    ["MEDIUM-zero", /MEDIUM[- ]zero/i],
    ["a consecutive-pass streak", /2\s*연속|2 consec/],
    ["a severity-gated Process A exit", /CRITICAL·HIGH 개선사항/],
    ["a severity finding enum", /"severity":\s*"CRITICAL\|HIGH\|MEDIUM\|LOW"/],
    ["a severity merge", /MAX severity/],
    ["severity in the finding hash", /\{severity\}/],
    ["a severity gate phase", /Severity gate|severity loop|심각도 게이트|심각도 조건/],
    ["severity-ordered routing", /CRITICAL\/HIGH 우선/],
    ["a severity-ranked summary", /top 3 CRITICAL/],
  ];
  it.each(SRS_DOCS)("%s: states no severity-based exit", (rel) => {
    const text = read(rel);
    expect(SEVERITY_EXITS.filter(([, pattern]) => pattern.test(text)).map(([label]) => label), rel).toEqual([]);
  });
});

describe("FR-FLOW-205 AC-6 — a contradiction between items is resolved by the loop, never sent to the user as residual", () => {
  /** Every Markdown file an agent can load from the four skill trees. */
  const allSkillDocs = (): string[] => {
    const out: string[] = [];
    const walk = (rel: string): void => {
      for (const entry of readdirSync(path.join(REPO_ROOT, rel), { withFileTypes: true })) {
        const child = `${rel}/${entry.name}`;
        if (entry.isDirectory()) walk(child);
        else if (entry.name.endsWith(".md")) out.push(child);
      }
    };
    for (const root of RENDERINGS) walk(root);
    return out;
  };

  // @req FR-FLOW-205 AC-6 — the retired rule is gone from every copy, the core blocks included.
  it("no skill document still sends an in-scope removal or an exclusion change to residual", () => {
    const offenders = allSkillDocs().filter((rel) => /exclusion 을 뒤집는 해소|뒤집는 해소는 residual/.test(read(rel)));
    expect(offenders).toEqual([]);
  });

  // @req FR-FLOW-205 AC-6 — the verdict a resolved-away item is recorded with exists in the schema.
  it.each(LOOP_CARRIERS)("%s: the prd_items verdict list carries resolved", (rel) => {
    expect(read(rel)).toContain('"verdict": "accepted|fail|respected|violated|other-wave|not-applicable|resolved"');
  });
});

describe("FR-FLOW-205 AC-8 AC-6 — the body sections that restate the verdicts are pinned whole (verify-r2 K3)", () => {
  // A sentence inserted into §11.2 ("단, kept finding 이 남아도 PRD 판정이 통과하면 통과로 본다."),
  // or §9.6/§5.1 rewritten to accept research-only requirements, passed every assertion while each
  // check was an `includes` of one sentence. These sections are now pinned as whole text.
  const NORMAL_MAX_112 = [
    "### 11.2 종료 조건",
    "",
    "#### Normal",
    "- PRD 판정 통과(핵심 규칙 블록) AND kept finding = 0 → 통과 (즉시 Phase 7)",
    "- 미충족 → Phase 4 재spawn (개선 agent로 라우팅)",
    "- 최대 **5회**",
    "- 루프의 통과 조건(통과 라운드 1회, etc 단일 워커 프로필은 3회 연속 통과)을 채우기 전에 라운드 상한(`--mini`·`--loops N` 이 정한 상한 포함)에 닿으면 통과가 아니다 — `TASK_DONE` 으로 끝내지 않고 `NEEDS_USER` 로 끝나며, 아직 fail 인 PRD 항목과 아직 열린 kept finding 을 모두 이름으로 완료 보고에 적는다 — `--auto` 에서도 그렇게 끝나며 결정 위원회가 정하지 않는다(critical gate `prd-cap-unpassed-user-decision`, 핵심 규칙 블록). Max 도 같다.",
    "- 진동: 같은 `finding_hash` 의 kept finding 이 3회 연속 → 사용자 에스컬레이션",
    "- drop 한 finding 은 사유와 함께 보고만, 블록 안 함",
    "",
    "#### Max",
    "- 통과 조건은 Normal 과 같다 — `--max` 는 독립 2차 검증 패스로 검증 강도만 올리고 연속 통과를 요구하지 않는다.",
    "- 최대 **15회**",
    "- 진동: 같은 `finding_hash` 의 kept finding 이 2회 연속 → 사용자 에스컬레이션",
    "",
    "",
  ].join("\n");
  const ETC_112 = [
    "### 11.2 종료 조건",
    "",
    "모든 모드는 `../../_shared/kiwi/local-llm-profile.md` 를 따른다.",
    "",
    "- 단일 evaluator 가 kept finding 없음을 **3회 연속** 반환하고 PRD 판정(핵심 규칙 블록)도 통과해야 Phase 7 로 진행한다.",
    "- kept finding 은 개선사항으로 간주하고 Phase 4 개선 라우팅 후 clean counter 를 0으로 재설정한다.",
    "- drop 한 finding 은 사유와 함께 보고만 하고 clean 판단에서 제외한다.",
    "- 동일 blocker 가 3회 반복되고 안전한 수정 경로가 없으면 사용자에게 에스컬레이션한다.",
    "- 루프의 통과 조건(통과 라운드 1회, etc 단일 워커 프로필은 3회 연속 통과)을 채우기 전에 라운드 상한(`--mini`·`--loops N` 이 정한 상한 포함)에 닿으면 통과가 아니다 — `TASK_DONE` 으로 끝내지 않고 `NEEDS_USER` 로 끝나며, 아직 fail 인 PRD 항목과 아직 열린 kept finding 을 모두 이름으로 완료 보고에 적는다 — `--auto` 에서도 그렇게 끝나며 결정 위원회가 정하지 않는다(critical gate `prd-cap-unpassed-user-decision`, 핵심 규칙 블록).",
    "",
    "",
  ].join("\n");
  const between = (text: string, from: string, to: string): string => {
    const start = text.indexOf(from);
    const end = text.indexOf(to, start + 1);
    return start < 0 || end < 0 ? "" : text.slice(start, end);
  };

  // @req FR-FLOW-205 AC-8
  it.each(LOOP_CARRIERS)("%s: §11.2 is exactly the pinned pass/fail exit", (rel) => {
    expect(between(read(rel), "### 11.2 종료 조건", "### 11.3")).toBe(rel === ETC_CARRIER ? ETC_112 : NORMAL_MAX_112);
  });

  // @req FR-FLOW-205 AC-6 — §9.6: a requirement only research names has no basis.
  it.each(LOOP_CARRIERS)("%s: §9.6's research-only paragraph is exactly the pinned drop rule", (rel) => {
    const ref = rel === "skills/claude/kiwi-srs/SKILL.md" ? "§5.1" : "SKILL.md §5.1";
    expect(between(read(rel), "**리서치에만 있는 요구는 근거가 없다.**", "**리서치 문서는 고치지 않는다.**")).toBe(
      `**리서치에만 있는 요구는 근거가 없다.** 프로세스 A 가 "리서치에는 있으나 SRS 에 없다"고 보고한 요구도 PRD 항목 인용이나 \`fills:\` 가 없으면 핵심 규칙 블록의 (b) 로 drop 한다. kiwi-srs 가 만든 리서치 문서(${ref})는 근거가 되지 못하고, 사용자가 넘긴 문서는 \`kiwi-prd\` 가 그 경로와 sha256 을 \`U\` 블록에 적은 뒤에만 PRD 항목의 출처가 된다.\n\n`
    );
  });

  // @req FR-FLOW-205 AC-6 — §5.1: the gathering research is a reference for the method, not a basis.
  it.each(SRS_COPIES)("%s: §5.1 is exactly the pinned text", (rel) => {
    const fanout = rel === "skills/etc/kiwi-srs/SKILL.md"
      ? "**서브에이전트 3개**를 **순차로**(sequential, 한 번에 하나씩) 투입한다. 이 세 서브에이전트는 대상 도메인의 **아키텍처**·**알고리즘**·**구현 방안**(implementation plan)을 각각 조사하고,"
      : "**서브에이전트 3개**를 병렬 투입한다. 이 세 서브에이전트는 대상 도메인의 **아키텍처**·**알고리즘**·**구현 방안**(implementation plan)을 조사하고,";
    expect(between(read(rel), "### 5.1 ", "\n## 6.")).toBe([
      "### 5.1 요구사항 수집 리서치 서브에이전트 (FR-FLOW-024 AC-4)",
      "",
      `PRD 를 받은 뒤에도 리서치 문서가 없고 요청이 막연해 요구사항을 확정하기 어려우면, kiwi-srs 는 **요구사항 수집**(requirement-gathering) 리서치 ${fanout} 각자의 조사 결과를 \`docs/research/\` 아래에 리서치 문서로 **저장**한다. 저장된 리서치 문서를 확보한 뒤 kiwi-srs 는 그대로 **FR-FLOW-023** 검증/개선(A/B) 루프(§9.6)로 진행하여, 수집된 리서치 문서를 프로세스 A 입력으로 삼는다.`,
      "",
      "---",
      "",
      "이 리서치 문서는 kiwi-srs 가 만든 것이므로 요구를 더할 근거가 되지 못한다(핵심 규칙 블록 (c)). 방법을 고르는 참고로만 쓰고, 리서치에만 있는 요구는 PRD 항목 인용이나 `fills:` 가 없으면 (b) 로 drop 한다.",
      "",
      "---",
      "",
    ].join("\n"));
  });
});
