import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { COMPACTION_TOKEN_BUDGET, tokensThrough } from "./skill-token-estimate.js";

// @req FR-FLOW-206 — kiwi-review-fix-loop fixes clean-code findings in a side loop of at most three
// rounds beside the FR-FLOW-203 keep/drop verdict, marks invalid findings `dismissed` and leftovers
// `unresolved`, keeps a fix only when the regression tests pass, and skips the check after asking once
// when the request asks for speed. The AC numbers are the FR-FLOW-206 block in
// docs/spec/60.workflow-release.srs.md, which is canonical.
//
// Each rule is an EXACT sentence carried by all four renderings, and the whole core block is pinned as
// one exact text built from those sentences, so an inserted exception or contradiction between two
// pinned sentences is red too (FR-FLOW-205 showed that a per-sentence `includes` lets it through).

const REPO_ROOT = fileURLToPath(new URL("../../", import.meta.url));
const RENDERINGS = ["skills/claude", "skills/codex", "skills/etc", ".agents/skills"] as const;
const COPIES = RENDERINGS.map((root) => `${root}/kiwi-review-fix-loop/SKILL.md`);
const CLAUDE = "skills/claude/kiwi-review-fix-loop/SKILL.md";
const REFERENCES = ["skills/codex", "skills/etc", ".agents/skills"].map(
  (root) => `${root}/kiwi-review-fix-loop/references/extended-workflow.md`
);

const read = (rel: string): string => readFileSync(path.join(REPO_ROOT, rel), "utf8").replace(/\r\n/g, "\n");

type Rule = readonly [ac: string, label: string, sentence: string];

const R = {
  head: ["AC-6", "the block outranks the body",
    "이 블록은 아래 본문보다 앞선다. 본문의 어느 절도 이 블록의 규칙을 건너뛰게 하지 않는다."],
  cls1: ["AC-1", "clean-code findings are a separate class naming principle and location",
    "리뷰어는 중복·과도 추상화·명명·함수나 클래스 크기·책임 혼재·죽은 코드 지적을 keep/drop 판정과 따로 `clean-code` 분류로 보고하고, 지적마다 어긴 원칙과 코드 위치(파일·줄)를 적는다."],
  cls2: ["AC-1", "clean-code findings never count as kept nor block the pass condition",
    "`clean-code` 지적은 kept finding 수에 들어가지 않고 keep/drop 종료 게이트(kept finding 0)를 막지 않으며, `dismissed` 나 `unresolved` 가 남아도 실행의 종료 상태를 바꾸지 않는다."],
  rnd1: ["AC-2", "at most three clean-code rounds per run, and what one round is",
    "fixer 는 `clean-code` 지적을 한 실행에서 클린 코드 라운드 **최대 3회** 안에서 고친다 — 라운드 하나는 리뷰어의 `clean-code` 지적, 분류기의 `dismissed` 표시, fixer 의 수정, 보존 스캔, 회귀 테스트 확인을 이 순서로 한 번씩 거친다."],
  rnd2: ["AC-2", "the rounds follow the functional loop and end early on a round with no finding",
    "클린 코드 라운드는 기능 결함 루프가 끝난 뒤에 돌고, 라운드를 시작하는 리뷰가 `clean-code` 지적을 하나도 내지 않으면 그 라운드에서 바로 끝난다."],
  // verify-r17: a re-raised dismissed finding is not a finding of the round, so it cannot hold off the early end.
  rnd3: ["AC-2", "the reviewer gets the dismissed list and a re-raised dismissed finding does not count",
    "리뷰어에게는 앞선 라운드에서 `dismissed` 된 지적 목록을 함께 넘기고, 이미 `dismissed` 된 지적과 같은 원칙·같은 위치를 다시 낸 지적은 그 라운드의 지적으로 세지 않는다 — 그런 지적만 나온 라운드도 그 라운드에서 바로 끝난다."],
  // verify-r17b: the round number and the dismissed findings survive a resume (AC-2 last sentence).
  rnd4: ["AC-2", "the round number and the dismissed findings are kept in the resume state and a resumed run continues them",
    "클린 코드 라운드 번호와 `dismissed` 지적은 실행 상태 `state.json` 의 `clean_code_round` 와 `clean_code_dismissed` 에 기록하고, 재개된 실행은 기록된 번호에서 이어 세며 기록된 `dismissed` 지적을 계속 세지 않는다."],
  dis1: ["AC-3", "an invalid finding is dismissed with a reason and not fixed",
    "분류기는 어긴 원칙이나 위치를 적지 않은 지적, 프로젝트의 기존 관례와 충돌하는 지적, 타당하지 않다고 판단한 지적을 `dismissed` 로 표시하고 사유를 적으며, fixer 는 그 지적을 고치지 않는다."],
  // verify-r17: a dismissed finding is never fixed, so it must stay dismissed rather than turn unresolved.
  dis2: ["AC-3", "what remains after the third round is unresolved and reported; a dismissed finding stays dismissed",
    "세 번째 클린 코드 라운드가 끝나도 고쳐지지 않은 지적은 `unresolved` 로 표시해 보고하고 더 고치지 않는다 — `dismissed` 지적은 보고서에서 계속 `dismissed` 이고 `unresolved` 가 되지 않는다."],
  tst1: ["AC-4", "a clean-code fix is kept only when the regression test command passes",
    "모든 클린 코드 수정은 그 실행의 회귀 테스트 명령을 통과해야 유지한다 — 통과는 회귀 기준선 대비 신규 실패 0 이다."],
  tst2: ["AC-4", "a fix that fails is reverted and its finding unresolved with the failing output",
    "수정이 회귀 테스트 명령을 통과하지 못하면 그 수정을 되돌리고, 그 지적을 실패 출력과 함께 `unresolved` 로 표시한다."],
  // verify-r23: a clean-code fix the preservation scan or another fixer-diff gate rejects is reverted, not a halt.
  tst4: ["AC-4", "a clean-code fix that trips the preservation scan or another fixer-diff gate is reverted and unresolved, and the run does not halt",
    "보존 스캔(보존 스캔 절, §0.17)과 그 밖에 fixer diff 를 검사하는 게이트도 모든 클린 코드 수정을 검사한다 — 클린 코드 수정이 기존 public 심볼을 지우거나 시그니처를 바꾸거나, 기존 테스트 케이스를 지우거나 약화하거나, 비-테스트 기존 파일을 지우거나 옮기거나(`existing-public-contract-change` · `existing-test-weakened-or-deleted` · `existing-file-deleted-or-moved`), Mock 탐지(`mock-detection`)나 cwd 외부 path 검사(`external-module-impact`)에 걸리면 그 수정을 되돌리고, 그 지적을 걸린 게이트와 스캔 사유와 함께 `unresolved` 로 표시하며, 그 게이트를 올리지 않고 실행을 멈추지 않는다."],
  tst5: ["AC-4", "a reverted clean-code fix does not count toward the divergence gate",
    "되돌린 클린 코드 수정은 kept finding 이 아니므로 개선 루프 발산 게이트(`improvement-loop-divergence-4opt`)의 횟수에 세지 않는다."],
  tst3: ["AC-4", "a run without a regression command makes no clean-code fix",
    "회귀 테스트를 돌리지 않는 실행(`--skip-regression`)이나 회귀 기준선을 잡지 못한 실행(`regression_baseline = null`)은 클린 코드 수정을 유지할 수 없으므로 클린 코드 라운드를 돌지 않고 그 사실을 보고한다."],
  asp1: ["AC-5", "a speed or waiver signal asks once at the start; confirmation skips every round",
    "호출 인자나 사용자 요청이 클린 코드 원칙을 지키지 않아도 된다고 하거나 빠른 처리를 요구하면(예: `ASAP`, `아삽`, `최대한 빨리`), 시작할 때 클린 코드 검사를 건너뛸지 한 번만 묻고 사용자가 확인하면 클린 코드 라운드를 모두 건너뛴다."],
  asp2: ["AC-5", "under --auto the same signal skips without asking",
    "`--auto` 이면 같은 신호가 있을 때 묻지 않고 건너뛴다."],
  asp3: ["AC-5", "the report states the skip and its reason",
    "건너뛰었으면 보고서에 클린 코드 검사를 건너뛴 사실과 그 이유(신호가 된 인자나 요청 문구)를 적는다."],
  // verify-r4: a round-cap option is not a speed signal (AC-5 last sentence).
  asp4: ["AC-5", "--mini, --loops and other round-cap options are not a speed signal",
    "`--mini`, `--loops` 같은 라운드 상한 옵션은 빠른 처리 신호가 아니다."],
  // verify-r12: the answer survives a resume or a compaction (AC-5 last sentence).
  // verify-r13: it is written the moment it is given, not as late as the first round.
  asp5: ["AC-5", "the answer is recorded in the resume state as soon as it is given and a resumed run follows it",
    "사용자의 답이나 `--auto` 의 건너뛰기는 답을 받은 즉시, 다음 phase 가 돌기 전에 실행 상태 `state.json` 의 `clean_code_skip` 에 기록하고, 재개된 실행은 다시 묻지 않고 기록된 답을 따른다 — 건너뛰기로 기록됐으면 클린 코드 라운드를 돌지 않는다."],
  // verify-r18: a calling skill's confirmed skip arrives as an argument and is not asked again (AC-5 last sentence).
  asp6: ["AC-5", "--skip-clean-code is a skip the caller already confirmed; the loop does not ask again",
    "`--skip-clean-code` 는 이 스킬을 부른 스킬이 이미 확인한 건너뛰기다 — 이 인자를 받으면 다시 묻지 않고 클린 코드 라운드를 모두 건너뛰며, Phase 0 에서 `clean_code_skip` 에 `true` 로 기록하고 보고서의 이유에 그 인자를 적는다."],
  // verify-r19: a caller's declined answer arrives as an argument too, so the hop does not ask a second time.
  // verify-r20: kiwi-coder adds its own `--auto` beside `--keep-clean-code`, so the caller's flag must win over the `--auto` skip.
  asp8: ["AC-5", "--keep-clean-code is the caller's recorded keep; the loop does not ask again, either flag outranks --auto, and both flags together are refused",
    "`--keep-clean-code` 는 이 스킬을 부른 스킬이 이미 받은 유지 답이다 — 이 인자를 받으면 다시 묻지 않고 클린 코드 라운드를 돌며, Phase 0 에서 `clean_code_skip` 에 `false` 로 기록한다. `--skip-clean-code` 나 `--keep-clean-code` 가 `--auto` 와 함께 오면 그 인자가 `--auto` 의 건너뛰기보다 우선한다. `--skip-clean-code` 와 `--keep-clean-code` 를 함께 받으면 어느 답인지 알 수 없으므로 시작하지 않고 거부한다."],
  // verify-r18: a skill that runs this loop as a hop asks once at its own start and passes the skip to every hop.
  // verify-r19: it passes the declined answer as well, and a skill that adds `--auto` on its own is such a caller.
  asp7: ["AC-5", "a hop-running skill asks once at its own start, records the answer, and passes --skip-clean-code or --keep-clean-code to every review hop",
    "이 스킬을 리뷰 hop 으로 부르는 스킬은 같은 신호를 받으면 자기 시작 시점에 한 번만 묻고(`--auto` 면 묻지 않고 건너뛴다) 그 답을 자기 실행 상태에 기록하며, 자기가 부르는 모든 리뷰 hop 에 사용자가 확인했으면 `--skip-clean-code` 를, 거절했으면 `--keep-clean-code` 를 넘긴다 — 사용자 요청을 보지 못하는 wave 워커의 리뷰 hop 에는 dispatch 카드로 넘긴다. 사용자가 `--auto` 로 돌리지 않은 리뷰 hop 에 `--auto` 를 붙이는 스킬(예: 단독 실행 끝의 kiwi-coder)도 그런 호출자로서 먼저 묻는다."],
  // verify-r22: a caller that received the answer from its own parent forwards it instead of dropping it.
  asp9: ["AC-5", "a hop-running skill that received --skip-clean-code or --keep-clean-code from its parent forwards it to every review hop and hop-reaching child",
    "리뷰 hop 을 부르는 스킬이 부모에게서 `--skip-clean-code` 나 `--keep-clean-code` 를 받으면 묻지 않고 그 답을 자기 실행 상태에 기록하며, 자기가 부르는 모든 리뷰 hop 과 리뷰 hop 에 이르는 자식에 그 인자를 그대로 넘긴다 — 스킬 본문의 호출 예시에 적힌 `[--skip-clean-code | --keep-clean-code]` 자리가 그 답이다."],
} as const satisfies Record<string, Rule>;

const s = (key: keyof typeof R): string => R[key][2];

const CORE_HEADING = "## 클린 코드 라운드 — 컴팩션 뒤에도 남는 규칙 (FR-FLOW-206)";

/** The whole core block, exactly: nothing may be inserted between, before, or after the pinned rules. */
function expectedCoreBlock(): string {
  return [
    CORE_HEADING,
    "",
    s("head"),
    "",
    `**분류.** ${s("cls1")} ${s("cls2")}`,
    "",
    `**라운드.** ${s("rnd1")} ${s("rnd2")} ${s("rnd3")} ${s("rnd4")}`,
    "",
    `**표시.** ${s("dis1")} ${s("dis2")}`,
    "",
    `**테스트.** ${s("tst1")} ${s("tst2")} ${s("tst4")} ${s("tst5")} ${s("tst3")}`,
    "",
    `**빠른 처리.** ${s("asp1")} ${s("asp2")} ${s("asp3")} ${s("asp4")} ${s("asp5")} ${s("asp6")} ${s("asp8")} ${s("asp7")} ${s("asp9")}`,
  ].join("\n");
}

/** The core block of one rendering: from its heading to the next horizontal rule or level-2 heading. */
function coreBlock(text: string): string {
  const start = text.indexOf(CORE_HEADING);
  if (start < 0) return "";
  const ends = ["\n\n---\n", "\n\n## "]
    .map((marker) => text.indexOf(marker, start + CORE_HEADING.length))
    .filter((at) => at >= 0);
  return text.slice(start, ends.length > 0 ? Math.min(...ends) : undefined);
}

describe("FR-FLOW-206 — clean-code rounds core block, in every rendering", () => {
  for (const [ac, label, needle] of Object.values(R)) {
    // @req FR-FLOW-206 AC-1 AC-2 AC-3 AC-4 AC-5 AC-6 (the AC named in the test title)
    it(`${ac}: every rendering carries — ${label}`, () => {
      const missing = COPIES.filter((rel) => !read(rel).includes(needle));
      expect(missing, `renderings missing the ${ac} sentence`).toEqual([]);
    });
  }

  // @req FR-FLOW-206 AC-6 — the three renderings and the mirror carry exactly the same block.
  it.each(COPIES)("AC-6: %s carries exactly the pinned core block — nothing inserted, nothing removed", (rel) => {
    expect(coreBlock(read(rel))).toBe(expectedCoreBlock());
  });

  // @req FR-FLOW-206 AC-6 — the AC-2, AC-3 and AC-5 rules end within the first 5,000 estimated tokens.
  it.each(COPIES)(`AC-6: %s ends the core block within ${COMPACTION_TOKEN_BUDGET} estimated tokens`, (rel) => {
    const text = read(rel);
    for (const key of ["rnd1", "rnd2", "rnd3", "rnd4", "dis1", "dis2", "asp1", "asp2", "asp3", "asp5", "asp6", "asp7", "asp8", "asp9"] as const) {
      const at = tokensThrough(text, s(key));
      expect(at, `${rel}: ${key} missing`).toBeGreaterThan(0);
      expect(at, `${rel}: ${key} ends at ${at} estimated tokens`).toBeLessThanOrEqual(COMPACTION_TOKEN_BUDGET);
    }
    const block = coreBlock(text);
    expect(block.length, `${rel}: no core block`).toBeGreaterThan(0);
    expect(tokensThrough(text, block)).toBeLessThanOrEqual(COMPACTION_TOKEN_BUDGET);
  });

  // @req FR-FLOW-206 AC-2 — the cap is 3 everywhere it is stated; no rendering states another count.
  it.each(COPIES)("AC-2: %s states the clean-code round cap only as 3", (rel) => {
    const caps = [...read(rel).matchAll(/클린 코드 라운드 \*\*최대 (\d+)회\*\*/g)].map((m) => m[1]);
    expect(caps.length, `${rel}: no clean-code round cap`).toBeGreaterThan(0);
    expect(caps.filter((n) => n !== "3"), `${rel}: another cap is stated`).toEqual([]);
  });

  // @req FR-FLOW-206 AC-3 — the block must not tell the fixer to fix a dismissed finding or loop past three.
  it.each(COPIES)("AC-3: %s carries no rule fixing dismissed findings or running a fourth round", (rel) => {
    const text = read(rel);
    expect(text).not.toMatch(/`dismissed`[^.\n]*고친다/);
    expect(text).not.toMatch(/(네|4) ?번째 클린 코드 라운드/);
  });
});

describe("FR-FLOW-206 AC-5 — the input table defines --skip-clean-code (verify-r18)", () => {
  const ROW_KO =
    "| 호출 스킬이 확인한 클린 코드 건너뛰기 (오케스트레이터 전달) | `--skip-clean-code` (인자 없음 — 다시 묻지 않고 클린 코드 라운드를 건너뛴다, 클린 코드 라운드 블록) | off (빠른 처리 신호면 Phase 0 에서 한 번 묻는다) |";
  const ROW_EN =
    "| clean-code skip already confirmed by the calling skill | `--skip-clean-code` (takes no argument — skips the clean-code rounds without asking; 클린 코드 라운드 block) | off (a speed signal asks once in Phase 0) |";

  // @req FR-FLOW-206 AC-5
  it.each(COPIES)("%s: the input table carries exactly one --skip-clean-code row", (rel) => {
    const rows = read(rel).split("\n").filter((line) => line.startsWith("|") && line.includes("`--skip-clean-code`"));
    expect(rows).toEqual([rel === CLAUDE ? ROW_KO : ROW_EN]);
  });

  // verify-r19: the caller's declined answer has its own row, right below the skip row.
  const KEEP_KO =
    "| 호출 스킬이 받은 클린 코드 유지 답 (오케스트레이터 전달) | `--keep-clean-code` (인자 없음 — 다시 묻지 않고 클린 코드 라운드를 돈다, 클린 코드 라운드 블록) | off (빠른 처리 신호면 Phase 0 에서 한 번 묻는다) |";
  const KEEP_EN =
    "| clean-code check kept by the user when the calling skill asked | `--keep-clean-code` (takes no argument — runs the clean-code rounds without asking; 클린 코드 라운드 block) | off (a speed signal asks once in Phase 0) |";

  // @req FR-FLOW-206 AC-5
  it.each(COPIES)("%s: the input table carries exactly one --keep-clean-code row, right after the skip row", (rel) => {
    const lines = read(rel).split("\n");
    const rows = lines.filter((line) => line.startsWith("|") && line.includes("`--keep-clean-code`"));
    expect(rows).toEqual([rel === CLAUDE ? KEEP_KO : KEEP_EN]);
    expect(lines.indexOf(rows[0] ?? "")).toBe(lines.indexOf(rel === CLAUDE ? ROW_KO : ROW_EN) + 1);
  });
});

describe("FR-FLOW-206 — the body agrees with the core block", () => {
  const DROP_SCOPE =
    "이 drop 은 기능 결함 finding 의 keep/drop 판정에 대한 것이다 — 중복·과도 추상화·명명 같은 클린 코드 지적은 이 판정에 넣지 않고 `clean-code` 분류로 따로 모아 클린 코드 라운드(클린 코드 라운드 블록)가 다룬다.";

  // @req FR-FLOW-206 AC-1 — the FR-FLOW-203 style/naming drop rule is scoped to the functional verdict.
  it.each(COPIES)("AC-1: %s scopes the style/naming drop to the functional keep/drop verdict", (rel) => {
    const text = read(rel);
    const drop = text.indexOf("실행으로 입증하지 못한 것과 스타일·명명·순서·주석류는 **drop** 하며");
    expect(drop, `${rel}: FR-FLOW-203 drop rule missing`).toBeGreaterThan(0);
    const scope = text.indexOf(DROP_SCOPE);
    expect(scope, `${rel}: drop-scope sentence missing`).toBeGreaterThan(drop);
    // It is the very next bullet, so nobody reads the drop rule without its scope.
    expect(text.slice(drop, scope).split("\n").length).toBe(2);
  });

  // @req FR-FLOW-206 AC-1 — the reviewer output schema carries the clean-code class with principle and location.
  it("AC-1: the claude reviewer output schema carries a clean_code list with principle and location", () => {
    expect(read(CLAUDE)).toContain(
      `"clean_code": [ { "id": "CC-001", "principle": "어긴 원칙", "location": { "file": "src/x.ts", "line_range": "45-67" }, "description": "본문" } ],`
    );
  });
  // @req FR-FLOW-206 AC-1 — the codex, etc and mirror references carry the same clean-code list.
  it.each(REFERENCES)("AC-1: %s carries the clean_code list beside the finding schema", (rel) => {
    expect(read(rel)).toContain(
      `The reviewer also returns \`clean_code[]\`, one entry per clean-code finding with \`principle\` and \`location\`; these entries are not findings of the keep/drop verdict (SKILL.md 클린 코드 라운드 block).`
    );
  });

  // @req FR-FLOW-206 AC-4 — the TDD exemption now names the clean-code path and its regression guard.
  it("AC-4: claude §0.3 exempts clean-code fixes from a new red test but keeps them only on a regression pass", () => {
    const text = read(CLAUDE);
    expect(text).toContain(
      "\"style_only\" / \"naming\" finding 과 클린 코드 라운드의 `clean-code` 지적은 회귀 테스트 선행 작성을 면제한다 — 동작을 바꾸지 않는 수정이며, 대신 그 수정은 회귀 테스트 명령을 통과해야 유지된다 (클린 코드 라운드 블록)."
    );
    expect(text).not.toContain("\"style_only\" / \"naming\" finding 은 TDD 면제 (회귀 가능성 없음)");
    expect(text).toContain("reason_enum: style_only|naming|formatting_only|comment_only|clean_code");
  });
  // @req FR-FLOW-206 AC-4 — the codex, etc and mirror references state the same regression guard.
  it.each(REFERENCES)("AC-4: %s keeps a TDD-exempt clean-code fix only on a regression pass", (rel) => {
    expect(read(rel)).toContain(
      "Clean-code round fixes are TDD-exempt as well, and each is kept only when the run's regression test command passes (SKILL.md 클린 코드 라운드 block)."
    );
  });

  // @req FR-FLOW-206 AC-2 — the phase flow places the clean-code rounds after the functional loop.
  it("AC-2: the claude phase overview runs the clean-code rounds between the functional loop and regression", () => {
    const lines = read(CLAUDE).split("\n");
    const loop = lines.findIndex((l) => l.startsWith("Phase 6 : "));
    const cc = lines.indexOf("Phase 6.5 : 클린 코드 라운드 (최대 3회, 클린 코드 라운드 블록 — 빠른 처리 신호면 건너뜀)");
    const regression = lines.findIndex((l) => l.startsWith("Phase 7 : "));
    expect(loop).toBeGreaterThan(0);
    expect(cc).toBe(loop + 1);
    expect(regression).toBe(cc + 1);
  });
  // @req FR-FLOW-206 AC-2 — codex, etc and the mirror run the rounds at the same point of the workflow.
  it.each(COPIES.filter((rel) => rel !== CLAUDE))("AC-2: %s workflow runs the clean-code rounds before regression", (rel) => {
    const text = read(rel);
    const cc = text.indexOf("    Then run the clean-code rounds (at most 3; 클린 코드 라운드 block).");
    expect(cc, `${rel}: workflow step missing`).toBeGreaterThan(0);
    expect(text.indexOf("11. Run regression and affected tests.")).toBeGreaterThan(cc);
  });

  // @req FR-FLOW-206 AC-3 AC-5 — the claude report lists the clean-code outcome, the skip included.
  it("AC-3 AC-5: the claude report body lists the clean-code outcome", () => {
    expect(read(CLAUDE)).toContain(
      "16. 클린 코드 라운드 결과 — 돈 라운드 수 · 고친 지적 · `dismissed`(사유) · `unresolved`(되돌린 수정의 실패 출력 포함 — `dismissed` 지적은 넣지 않는다) · 건너뛰었으면 그 사실과 이유"
    );
  });

  // @req FR-FLOW-206 AC-2 — the round counter survives a resume, so a resumed run cannot pass three rounds.
  it("AC-2: the claude state schema carries the clean-code round counter", () => {
    expect(read(CLAUDE)).toContain(`"clean_code_round": 0,`);
  });

  // @req FR-FLOW-206 AC-2 — the dismissed findings live in the same state.json, and --resume continues both.
  it("AC-2: the claude state schema carries the dismissed findings and the resume algorithm continues them", () => {
    const text = read(CLAUDE);
    expect(text).toContain(`"clean_code_round": 0,
  "clean_code_dismissed": [],
  "clean_code_skip": null,`);
    expect(text).toContain(
      "6. `state.json.clean_code_round` 와 `state.json.clean_code_dismissed` 는 리셋하지 않는다 — 클린 코드 라운드는 기록된 번호에서 이어 세어 3회를 넘지 않고, 기록된 `dismissed` 지적(원칙·위치·사유)은 다음 라운드 리뷰어에게 다시 넘겨 그 라운드의 지적으로 세지 않는다 (클린 코드 라운드 블록)"
    );
  });

  // @req FR-FLOW-206 AC-5 — the skip answer lives in the existing state.json, and --resume follows it.
  it("AC-5: the claude state schema carries the skip answer and the resume algorithm follows it", () => {
    const text = read(CLAUDE);
    expect(text).toContain(`"clean_code_skip": null,`);
    expect(text).toContain(
      "5. `state.json.clean_code_skip` 이 기록돼 있으면 클린 코드 검사를 건너뛸지 다시 묻지 않고 기록된 답을 따른다 — `true` 면 클린 코드 라운드를 돌지 않는다 (Phase 0 에서 답을 받은 즉시 기록한다 — 사용자가 확인했거나 `--auto` 가 건너뛰면 `true`, 신호가 없거나 사용자가 거절하면 `false`, 클린 코드 라운드 블록)"
    );
  });
  // @req FR-FLOW-206 AC-5 — the claude phase map puts the skip question and its write in Phase 0.
  it("AC-5: the claude phase map asks and records clean_code_skip in Phase 0", () => {
    expect(read(CLAUDE)).toContain(
      "Phase 0 : Bootstrap (preflight, 모드 결정, 범위 결정, .kiwi init/resume, 빠른 처리 신호면 클린 코드 건너뛰기를 한 번 묻고 답을 받은 즉시 `clean_code_skip` 기록)"
    );
  });
  // @req FR-FLOW-206 AC-5 — the codex and etc workflow put the skip question and its write in step 2.
  it.each(["skills/codex", "skills/etc", ".agents/skills"].map((root) => `${root}/kiwi-review-fix-loop/SKILL.md`))(
    "AC-5: %s asks and records clean_code_skip in the mode-decision step",
    (rel) => {
      expect(read(rel)).toContain(
        "2. Decide mode and review scope. On a speed signal, ask once whether to skip the clean-code check and write the answer to `state.json` `clean_code_skip` as soon as it is given (클린 코드 라운드 block)."
      );
    }
  );
  // @req FR-FLOW-206 AC-5 — codex, etc and the mirror record the same answer in the same state file.
  it.each(REFERENCES)("AC-5: %s records the clean-code skip answer in state.json and follows it on resume", (rel) => {
    expect(read(rel)).toContain(
      "Record the clean-code skip answer in `state.json` as `clean_code_skip` (`true` when the user confirmed the skip or `--auto` skipped it, `false` when there was no signal or the user declined) in Phase 0, as soon as the answer is given and before any further phase runs; a resumed run follows the recorded value instead of asking again (SKILL.md 클린 코드 라운드 block)."
    );
  });
  // @req FR-FLOW-206 AC-2 — codex, etc and the mirror keep the round number and dismissed findings in the same state file.
  it.each(REFERENCES)("AC-2: %s keeps the clean-code round and dismissed findings in state.json across a resume", (rel) => {
    expect(read(rel)).toContain(
      "Record the clean-code round number in `state.json` as `clean_code_round` when each round starts, and each `dismissed` finding (principle, location, reason) in `clean_code_dismissed` as soon as the classifier marks it; a resumed run continues the count from the recorded round, never past 3, and still passes the recorded `dismissed` findings to the reviewer without counting them (SKILL.md 클린 코드 라운드 block)."
    );
  });
});

describe("FR-FLOW-206 AC-1 — the body's keep/drop exit gate stays clean-code free (verify-r2 K3 M4)", () => {
  // Extending the exit-gate sentence with "클린 코드 지적도 kept finding 으로 세어 이 게이트를 막는다."
  // — the exact opposite of AC-1 — passed every assertion, because the gate line was only matched
  // by `includes`. The line is pinned whole, and no line anywhere may count clean-code findings as kept.
  const GATE = "종료 게이트는 **kept(surviving) finding 이 0** 일 때만 통과한다 — 이것이 기존 `CRITICAL=0 + HIGH=0` 게이트를 대체한다.";
  const DOCS = [...COPIES, ...REFERENCES];

  // @req FR-FLOW-206 AC-1
  it.each(COPIES)("%s: the exit gate line is exactly the pinned sentence", (rel) => {
    const lines = read(rel).split("\n").filter((line) => line.includes("종료 게이트는 **kept(surviving) finding 이 0**"));
    expect(lines).toEqual([rel === CLAUDE ? GATE : `- ${GATE}`]);
  });

  // @req FR-FLOW-206 AC-1
  it.each(DOCS)("%s: no line counts clean-code findings as kept or lets them block the gate", (rel) => {
    const offenders = read(rel).split("\n").filter((line) =>
      /(클린 코드|clean-code)[^\n]*(kept finding 으로 세|kept 로 세|kept 에 넣|게이트를 막는다|count(?:s|ed)? as kept|block(?:s)? the (?:exit )?gate)/i.test(line));
    expect(offenders).toEqual([]);
  });
});
