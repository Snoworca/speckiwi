import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";

import { BILINGUAL_SEARCH_RULE } from "../../src/core/bootstrap/templates.js";
import { EXPECTED_KIWI_SKILLS } from "../../src/doctor/package-doctor.js";
import { COMPACTION_TOKEN_BUDGET, estimateTokens, tokensThrough } from "./skill-token-estimate.js";

// @req FR-FLOW-204 — kiwi-prd writes the user's request verbatim and turns it into an approved,
// structured PRD that is the input to SRS authoring. The AC numbers are the FR-FLOW-204 block in
// docs/spec/60.workflow-release.srs.md, which is canonical.
//
// Prose rules are pinned as EXACT sentences in all four renderings (the FR-FLOW-203 approach: a
// vocabulary check survives an inversion, an exact sentence does not). What a command can decide is
// not pinned but RUN: the hash command and the quote command are read out of each SKILL.md and
// executed against test/fixtures/prd/rbac.prd.md, then against copies changed by one byte.

const REPO_ROOT = fileURLToPath(new URL("../../", import.meta.url));
const RENDERINGS = ["skills/claude", "skills/codex", "skills/etc", ".agents/skills"] as const;
const PRD_COPIES = RENDERINGS.map((root) => `${root}/kiwi-prd/SKILL.md`);
const SRS_COPIES = RENDERINGS.map((root) => `${root}/kiwi-srs/SKILL.md`);
const FIXTURE = "test/fixtures/prd/rbac.prd.md";

const read = (rel: string): string => {
  try {
    return readFileSync(path.join(REPO_ROOT, rel), "utf8").replace(/\r\n/g, "\n");
  } catch {
    return "";
  }
};

const PINNED: ReadonlyArray<readonly [string, string, string]> = [
  ["AC-1", "the request is written first, unchanged",
    "요청을 받으면 조사 서브에이전트·질문·SRS mutation 보다 먼저 `docs/prd/<YYYY-MM-DD>.<slug>.prd.md` 의 `## 1. User Request` 아래 `U-1` 블록에 요청을 **한 글자도 바꾸지 않고** 쓴다."],
  ["AC-1", "a caller's REQ_PATH document is the request",
    "호출자가 `REQ_PATH` 문서를 넘기면 그 내용이 요청이다 — `U-1` 에 그 경로와 sha256 을 적고 내용을 한 글자도 바꾸지 않고 옮긴다."],
  // FR-FLOW-205 AC-1: for an issue, U-1 is the issue's title and body as written, not a research excerpt.
  ["AC-1", "an issue's U-1 is its title and body as written; the research excerpt is reference only",
    "이슈에서 왔으면 `U-1` 은 입력이 가리키는 이슈를 `gh issue view {N} --json title,body,comments` 로 읽은 제목과 본문 원문이다 — 발췌본(`issue-excerpt.md`)이면 그 첫 줄 `Issue: https://github.com/{owner}/{repo}/issues/{N}` 에서 번호를 읽고, 이슈에서 파생된 발췌본은 `U-1` 에 넣지 않고 참고 자료로만 보며 PRD 항목의 근거가 되지 못한다."],
  // FR-FLOW-205 AC-1 + coordinator decision: a missing Issue line is not skipped silently.
  ["AC-1", "an excerpt without its Issue line becomes U-1, and the report says the issue was not read",
    "발췌본에 그 줄이 없을 때만 발췌본 자체를 `U-1` 원천으로 쓰고, 완료 보고에 `이슈 원문을 읽지 못함` 을 적는다."],
  ["AC-1", "kiwi-prd runs before any investigation, so it reads only what exists by then",
    "묻기 전에 본다. 호출자가 넘긴 입력, 사용자가 가리킨 파일, `search_requirements` 결과만 본다 — kiwi-prd 는 조사 서브에이전트보다 먼저 불리므로 볼 조사 산출물이 없다."],
  ["AC-1", "later answers are appended, earlier blocks never rewritten",
    "사용자의 답은 다음 `U-<n>` 블록으로 덧붙이기만 하고, 앞선 `U` 블록은 고쳐 쓰지 않는다."],
  ["AC-2", "items are numbered PRD blocks without gaps",
    "항목은 `## 2. Items` 아래 `### PRD-<n> — <제목>` 블록으로 1부터 빠짐없이 번호를 매긴다."],
  ["AC-2", "Kind and State are closed lists",
    "`Kind` 는 `intent` · `user` · `goal` · `in-scope` · `exclusion` · `proposal` 가운데 하나, `State` 는 `confirmed` · `proposed` · `rejected` 가운데 하나다."],
  ["AC-2", "at least one intent item, or an inferred-intent proposal only under --auto when unapproved",
    "`Kind=intent` 항목은 적어도 하나 있어야 한다 — 단 `--auto` 로 `Status` 행이 `unapproved` 이고 요청에 목적이 없을 때만, `Reason` 이 `inferred intent:` 로 시작하는 proposal 이 그 자리를 대신한다."],
  ["AC-5", "an --auto PRD writes --auto in its Approved row (the quote command tells it from a draft by this)",
    "`--auto` 로 만든 PRD 는 `Approved` 행에 `--auto` 를 적는다."],
  ["AC-2", "only an exclusion carries an Exclusion Class from the wave-decomposition list",
    "`Kind=exclusion` 항목만 `Exclusion Class` 행을 갖고, 값은 `already-implemented` · `superseded` · `external-ownership` · `user-excluded` · `non-normative` 가운데 하나다."],
  ["AC-3", "a non-proposal item quotes its source verbatim",
    "proposal 이 아닌 항목은 `Source` 가 가리키는 `U` 블록에 그대로 있는 구절을 인용 블록 하나로 옮긴다."],
  ["AC-3", "what the agent supplied stays a proposal",
    "에이전트가 채운 것은 모두 `Kind=proposal` 과 `Reason` 행으로 적고, 사용자가 받아들여도 `State` 만 `confirmed` 로 바꾸며 `Kind=proposal` 은 그대로 둔다."],
  // verify-r15: a proposal states what it adds once confirmed, so the PRD verdicts can enforce it (AC-3 last sentence).
  ["AC-3", "a proposal carries an Effect row from {in-scope, exclusion}",
    "proposal 은 확정되면 무엇을 더하는지 밝히는 `Effect` 행을 갖고, 값은 `in-scope` · `exclusion` 가운데 하나다 — 확정된 proposal 은 `Effect` 가 in-scope 이면 in-scope 항목처럼, exclusion 이면 exclusion 항목처럼 판정된다."],
  ["AC-4", "one question per message: the purpose when none is stated, otherwise boundary questions only",
    "메시지 하나에 질문은 **하나만** 하고, 요청에 목적이 없으면 왜 필요한지를 묻고, 그 밖에는 답에 따라 in-scope 나 exclusion 항목이 바뀌는 점만 묻는다."],
  // FR-FLOW-028 AC-2: the issue flow starts kiwi-srs with --qna-force when research alone leaves the
  // requirement ambiguous; kiwi-srs forwards it here, so this is where it must force the questions.
  ["AC-4", "--qna-force asks the remaining ambiguities instead of deciding them (FR-FLOW-028 AC-2)",
    "`--qna-force` 는 호출자의 연구만으로 요구가 모호하다는 신호다 — 맥락이 답한 것처럼 보이는 모호성도 proposal 로 정해 넘기지 않고 사용자에게 하나씩 물어 해소하며, 사용자가 진행하라고 하기 전에는 승인 단계로 가지 않는다."],
  ["AC-4", "detail defaults are proposals corrected in one reply",
    "세부 기본값은 묻지 않고 proposal 목록으로 보여 주어, 사용자가 답장 한 번으로 고치게 한다."],
  ["AC-5", "no SRS mutation before approval",
    "PRD 가 승인되기 전에는 어떤 SRS mutation 도구도 부르지 않는다."],
  ["AC-5", "--auto records unapproved and the committee cannot widen the scope",
    "`--auto` 에서는 질문 없이 원문에서 항목을 뽑고 `Status` 행을 `unapproved` 로 둔 채 돌려주며, 결정 위원회는 proposal 만 정할 수 있고 in-scope 항목을 더하거나 exclusion 항목을 지우지 못한다."],
  // verify-r16: only the user's own answer confirms an Effect=in-scope proposal (AC-5 last sentence).
  ["AC-5", "under --auto a committee proposal with Effect=in-scope stays proposed and is not an in-scope item",
    "`Effect` 가 in-scope 인 proposal 을 `State=confirmed` 로 바꿀 수 있는 것은 사용자 자신의 답뿐이므로, `--auto` 에서 결정 위원회가 정한 그런 proposal 은 `proposed` 로 남고 in-scope 항목으로 세지 않는다."],
  // 16b: approval confirms every shown, unrejected proposal except a contradiction resolution (FR-FLOW-204 AC-5 end).
  ["AC-5", "approval confirms every proposal shown and not rejected, except a contradiction resolution",
    "사용자가 PRD 를 승인하면 사용자에게 보여 주었고 그 답에서 거절되지 않은 proposal 은 모두 `State` 를 `confirmed` 로 바꾼다 — `Reason` 이 `contradiction resolved:` 로 시작하는 proposal 만 `proposed` 로 남긴다."],
  // 16b: a contradiction resolution keeps State=proposed (FR-FLOW-205 AC-6 end).
  ["AC-3", "a contradiction resolution keeps State=proposed and takes effect as a recorded resolution",
    "`Reason` 을 `contradiction resolved:` 로 시작한다. 해소 proposal 은 `State=proposed` 를 유지하고, `State` 가 아니라 기록된 해소로서 효력을 가진다."],
  ["AC-5", "a caller that authors from an unapproved PRD reports it",
    "미승인 PRD 를 받은 호출자는 완료 보고에 그 `Status` 행 값을 그대로 싣는다."],
  ["AC-6", "kiwi-prd writes the LF-normalized hash whenever it writes a U block, --auto included",
    "`U` 블록을 쓰거나 덧붙일 때마다(`--auto` 포함) kiwi-prd 가 줄 끝을 LF 로 맞춘 `## 1. User Request` 절 바이트의 sha256 을 `Request SHA256` 행에 쓴다 — 이 행은 kiwi-prd 만 쓰고 다른 스킬은 읽기만 한다."],
  ["AC-7", "the PRD is an input record with no requirement grammar",
    "PRD 에는 Requirement ID · AC 줄 · `SHALL` 문장을 쓰지 않고, 맨 위에 입력 기록이며 요구 원본은 `docs/spec` 이라고 적는다."],
  // verify-r2 K4: a proposal's quote line is the agent's text, so only verified quotes are exempt.
  // verify-r14: the approval quote is the user's sentence copied verbatim, so it is exempt too.
  ["AC-7", "only the U blocks, the verified quotes of non-proposal items and the approval quote are exempt from the grammar check",
    "(`U` 블록, proposal 이 아닌 항목이 `U` 블록에서 옮긴 인용, `## 3. Approval` 의 승인 인용만 사용자의 말이므로 무엇이 들어 있어도 그대로 두고 검사를 통과시키려고 고쳐 쓰지 않는다 — proposal 의 인용 줄과 승인 절의 인용 밖 줄을 포함한 나머지는 모두 검사한다.)"],
  ["AC-7", "a failing check is fixed in the agent's text, never in the user's words",
    "명령이 실패하면 고친 뒤 다시 돌리고, `U` 블록이나 승인 인용을 고쳐서 맞추지 않는다."],
  ["AC-11", "a caller's user answer is appended verbatim as the next U block",
    "호출자가 요청에 관한 질문의 사용자 답을 넘기면 그 답도 다음 `U-<n>` 으로 원문 그대로 덧붙인다."],
  // FR-FLOW-205 AC-6: kiwi-srs and kiwi-tdd record the contradictions they resolve through kiwi-prd.
  ["AC-3", "a resolved contradiction is recorded as a proposal whose Reason begins 'contradiction resolved:'",
    "`kiwi-srs` · `kiwi-tdd` · `kiwi-step` 이 항목 사이의 모순을 푼 해소를 넘기면 다음 번호의 `Kind=proposal` 항목으로 덧붙이고 `Reason` 을 `contradiction resolved:` 로 시작한다."],
  // FR-FLOW-204 AC-3 (verify-r4): the agent's question in a U block is never the user's words.
  ["AC-3", "an answer block keeps the agent's question on its own line, apart from the user's answer",
    "답을 덧붙일 때 에이전트가 한 질문은 `> 질문:` 줄에, 사용자의 답은 그 아래 `> 답:` 줄에 적는다."],
  ["AC-3", "a quote comes from the user's own words, never the agent's question",
    "인용은 사용자 자신의 말이어야 한다 — `U-1` 이 아니고 `답:` 줄이 있는 `U` 블록에서 `질문:` 줄부터 다음 `답:` 줄 앞까지는 에이전트의 질문이므로 인용이 될 수 없다."],
];

/** The notice the template puts at the top of every PRD; the fixture carries the same line. */
const NOTICE = "> 입력 기록이다. 요구 원본이 아니다 — 무엇을 만들지는 `docs/spec` 의 SRS 가 정한다.";

describe("FR-FLOW-204 — kiwi-prd pinned rules", () => {
  for (const [ac, label, needle] of PINNED) {
    // @req FR-FLOW-204 AC-1 AC-2 AC-3 AC-4 AC-5 AC-6 AC-7 (the AC named in the test title)
    it(`${ac}: every rendering carries — ${label}`, () => {
      const missing = PRD_COPIES.filter((rel) => !read(rel).includes(needle));
      expect(missing, `renderings missing the ${ac} sentence`).toEqual([]);
    });
  }

  // @req FR-FLOW-204 AC-1 AC-4 AC-5 — kiwi-prd is re-attached whole after a compaction and has no
  // fixed block, so a contrary sentence added beside the pinned ones ("`U-1` 에는 요약을 써도 된다",
  // "결정 위원회가 … in-scope 항목을 더할 수 있다") passed every `includes` above (verify-r2 K3 M7/M13).
  // §1 and §2 are therefore pinned whole; only the next-step call prefix differs per rendering.
  const CALL_PREFIX: Record<string, string> = {
    "skills/claude": "/", "skills/codex": "$", ".agents/skills": "$", "skills/etc": "",
  };
  const orderAndQuestions = (prefix: string): string => [
    "## 1. 순서",
    "",
    `1. ${PINNED[0][2]} ${PINNED[1][2]} ${PINNED[2][2]} ${PINNED[3][2]}`,
    // FR-FLOW-207 AC-2: the step that sends a search states the bilingual search rule beside it.
    `2. ${PINNED[4][2]} 맥락이 답하는 것은 묻지 않는다. ${BILINGUAL_SEARCH_RULE}`,
    "3. 첫 메시지는 하나다: 요청을 자기 말로 짧게 되짚고, in-scope · exclusion 초안과 proposal 목록을 보인 뒤, 만들 것을 가장 크게 바꾸는 질문 하나로 끝낸다. \"이대로 진행하라고 하셔도 됩니다\" 한 줄을 붙인다.",
    `4. ${PINNED[5][2]} 답을 덧붙일 때 에이전트가 한 질문은 \`> 질문:\` 줄에, 사용자의 답은 그 아래 \`> 답:\` 줄에 적는다. 답을 반영해 항목을 고친다. 호출자가 요청에 관한 질문의 사용자 답을 넘기면 그 답도 다음 \`U-<n>\` 으로 원문 그대로 덧붙인다. \`kiwi-srs\` · \`kiwi-tdd\` · \`kiwi-step\` 이 항목 사이의 모순을 푼 해소를 넘기면 다음 번호의 \`Kind=proposal\` 항목으로 덧붙이고 \`Reason\` 을 \`contradiction resolved:\` 로 시작한다. 해소 proposal 은 \`State=proposed\` 를 유지하고, \`State\` 가 아니라 기록된 해소로서 효력을 가진다.`,
    "5. 경계를 바꾸는 미해결 질문이 0개이거나 사용자가 진행하라고 하면 묻기를 멈추고, PRD 를 보여 주어 승인을 받는다. 승인 문장은 `## 3. Approval` 에 그대로 옮기고 `Status` 행을 `approved` 로 바꾼다. 사용자가 PRD 를 승인하면 사용자에게 보여 주었고 그 답에서 거절되지 않은 proposal 은 모두 `State` 를 `confirmed` 로 바꾼다 — `Reason` 이 `contradiction resolved:` 로 시작하는 proposal 만 `proposed` 로 남긴다.",
    "6. PRD 가 승인되기 전에는 어떤 SRS mutation 도구도 부르지 않는다.",
    "7. `U` 블록을 쓰거나 덧붙일 때마다(`--auto` 포함) kiwi-prd 가 줄 끝을 LF 로 맞춘 `## 1. User Request` 절 바이트의 sha256 을 `Request SHA256` 행에 쓴다 — 이 행은 kiwi-prd 만 쓰고 다른 스킬은 읽기만 한다.",
    `8. 끝나면 PRD 경로를 돌려준다. 단독 실행이면 다음 단계로 \`${prefix}kiwi-srs REQ_PATH=<PRD 경로>\` 를 안내한다.`,
    "",
    "## 2. 질문 방식",
    "",
    "- 메시지 하나에 질문은 **하나만** 하고, 요청에 목적이 없으면 왜 필요한지를 묻고, 그 밖에는 답에 따라 in-scope 나 exclusion 항목이 바뀌는 점만 묻는다.",
    "- 세부 기본값은 묻지 않고 proposal 목록으로 보여 주어, 사용자가 답장 한 번으로 고치게 한다.",
    "- 열린 질문이 먼저다. 선택지는 사용자가 막혔을 때만 준다.",
    "- 리서치 문서가 없어도 모호성은 스스로 찾는다. 합리적 기본값이 있는 것은 proposal 로 정하고, 기본값이 없는 비표준 모호성만 묻는다. 사용자의 답변이 만든 결정도 재검사해, 새 모호성이 생기면 재질문한다.",
    "- 질문 루프는 라운드 상한이 없는 무제한 qna 루프다 — 경계를 바꾸는 질문이 남아 있는 한 하나씩 계속 묻는다. 요청이 막연하면(예: \"게임을 하나 만들어줘\") 플래그 없이도 질문 루프를 자동 활성한다. `--qna-force` 는 호출자의 연구만으로 요구가 모호하다는 신호다 — 맥락이 답한 것처럼 보이는 모호성도 proposal 로 정해 넘기지 않고 사용자에게 하나씩 물어 해소하며, 사용자가 진행하라고 하기 전에는 승인 단계로 가지 않는다.",
    "- 같은 질문이 두 번 나오면 더 묻지 않고, 남은 모호성을 기록한 채 진행할지 묻는다.",
    "- `--auto` 없이 도는 중에 사용자가 종료 신호(\"이제 그만\", \"여기서 종료\")를 보내면 더 묻지 않고, 남은 모호성을 자동 결정해 각각 `Reason` 을 단 proposal 로 적는다.",
    "- `--auto` 에서는 질문 없이 원문에서 항목을 뽑고 `Status` 행을 `unapproved` 로 둔 채 돌려주며, 결정 위원회는 proposal 만 정할 수 있고 in-scope 항목을 더하거나 exclusion 항목을 지우지 못한다. `Effect` 가 in-scope 인 proposal 을 `State=confirmed` 로 바꿀 수 있는 것은 사용자 자신의 답뿐이므로, `--auto` 에서 결정 위원회가 정한 그런 proposal 은 `proposed` 로 남고 in-scope 항목으로 세지 않는다. `--auto` 로 만든 PRD 는 `Approved` 행에 `--auto` 를 적는다. `--auto` 는 질문 루프와 `--qna-force` 를 억제하고 남은 모호성을 FR-FLOW-025 결정 위원회에 위임한다. 미승인 PRD 를 받은 호출자는 완료 보고에 그 `Status` 행 값을 그대로 싣는다.",
    "",
    "",
  ].join("\n");
  for (const root of RENDERINGS) {
    it(`AC-1 AC-4 AC-5: ${root}/kiwi-prd §1 and §2 are exactly the pinned text — nothing inserted, nothing removed`, () => {
      const text = read(`${root}/kiwi-prd/SKILL.md`);
      const start = text.indexOf("## 1. 순서");
      const end = text.indexOf("## 3. PRD 문법");
      expect(start, "no §1").toBeGreaterThan(0);
      expect(text.slice(start, end)).toBe(orderAndQuestions(CALL_PREFIX[root] ?? ""));
    });
  }

  // @req FR-FLOW-204 AC-1 — kiwi-prd is called before Phase 1, so no rendering may send it to Phase 1 output.
  it("AC-1: no rendering points kiwi-prd at investigation output that does not exist yet", () => {
    const offenders = PRD_COPIES.filter((rel) => /Phase 1 산출물/.test(read(rel)));
    expect(offenders).toEqual([]);
  });

  // @req FR-FLOW-204 AC-7 — the template states the input-record notice at the top, as the fixture does.
  it("AC-7: every rendering's PRD template opens with the input-record notice", () => {
    expect(read(FIXTURE).split("\n")).toContain(NOTICE);
    for (const rel of PRD_COPIES) {
      const text = read(rel);
      const template = text.indexOf("# PRD: <제목>");
      expect(template, `${rel}: no PRD template`).toBeGreaterThan(0);
      const notice = text.indexOf(NOTICE, template);
      expect(notice, `${rel}: the template does not carry the notice`).toBeGreaterThan(template);
      expect(text.indexOf("## 1. User Request", template), `${rel}: the notice must precede the user request`).toBeGreaterThan(notice);
    }
  });

  // @req FR-FLOW-204 AC-2 — the template carries the item heading grammar the quote command reads.
  it("AC-2: every rendering's template shows the item heading, the Kind/Source/State rows and the Items section", () => {
    for (const rel of PRD_COPIES) {
      const text = read(rel);
      for (const line of ["## 2. Items", "### PRD-1 — <제목>", "| Kind | intent |", "| Source | U-1 |", "| State | confirmed |"]) {
        expect(text.split("\n"), `${rel}: template line ${line}`).toContain(line);
      }
    }
  });
});

describe("FR-FLOW-024 behaviour moved into kiwi-prd (the question loop left kiwi-srs)", () => {
  // @req FR-FLOW-204 AC-4 — the stop condition and the oscillation guard of the former loop.
  it("AC-4: every rendering stops asking when no boundary question remains and guards against oscillation", () => {
    for (const rel of PRD_COPIES) {
      const text = read(rel);
      expect(text, rel).toContain("경계를 바꾸는 미해결 질문이 0개이거나 사용자가 진행하라고 하면 묻기를 멈추고, PRD 를 보여 주어 승인을 받는다.");
      expect(text, rel).toContain("같은 질문이 두 번 나오면 더 묻지 않고, 남은 모호성을 기록한 채 진행할지 묻는다.");
    }
  });
});

// ---- Execution: the commands each SKILL.md fixes are run, not read. -------------------------------

interface Command {
  readonly js: string;
}

/** The `node -e "<js>" <path>` line right under the `# <label>` comment line. */
function command(text: string, label: string): Command | undefined {
  const lines = text.split("\n");
  const at = lines.findIndex((line) => line.trim().startsWith(`# ${label}:`));
  if (at < 0) return undefined;
  const match = /^node -e "([^"]+)" \S+$/.exec((lines[at + 1] ?? "").trim());
  return match ? { js: match[1] ?? "" } : undefined;
}

const scratch = mkdtempSync(path.join(os.tmpdir(), "kiwi-prd-fr-flow-204-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));
let serial = 0;

/** Writes `content` to a fresh scratch file and runs the command against it, with no shell in between. */
function run(cmd: Command, content: string): { status: number | null; stdout: string } {
  const file = path.join(scratch, `prd-${(serial += 1)}.prd.md`);
  writeFileSync(file, content, "utf8");
  const result = spawnSync(process.execPath, ["-e", cmd.js, file], { encoding: "utf8" });
  return { status: result.status, stdout: result.stdout };
}

const fixture = read(FIXTURE);
/** The same text with every line ending written as CRLF, as a core.autocrlf=true checkout leaves it. */
const toCrlf = (text: string): string => text.replace(/\n/g, "\r\n");
const storedHash = /^\| Request SHA256 \| ([0-9a-f]{64}) \|$/m.exec(fixture)?.[1] ?? "";

/** Replaces exactly one occurrence; a fixture edit that silently matched nothing would make a mutation vacuous. */
function once(text: string, from: string, to: string): string {
  const at = text.indexOf(from);
  expect(at, `fixture text not found: ${from}`).toBeGreaterThanOrEqual(0);
  return text.slice(0, at) + to + text.slice(at + from.length);
}

/** The text of one `### PRD-<n>` block of the fixture. */
function itemBlock(text: string, n: number): string {
  const start = text.indexOf(`### PRD-${n} — `);
  const end = text.indexOf("\n### ", start + 1);
  return text.slice(start, end < 0 ? undefined : end);
}

/** Replaces `from` inside the PRD-<n> block only. */
function inItem(text: string, n: number, from: string, to: string): string {
  const block = itemBlock(text, n);
  return once(text, block, once(block, from, to));
}

/**
 * The fixture as `--auto` leaves it when the request states no purpose (FR-FLOW-204 AC-2): unapproved,
 * the Approved row marked `--auto`, and PRD-1's intent an inferred proposal instead of a quoted item.
 */
function autoInferred(): string {
  const unapproved = once(once(fixture, "| Status | approved |", "| Status | unapproved |"), "| Approved | 2026-11-03 |", "| Approved | --auto |");
  return inItem(unapproved, 1, "| Kind | intent |\n| Source | U-1 |\n| State | confirmed |",
    "| Kind | proposal |\n| Reason | inferred intent: 권한 저장소를 사용자 DB 에 붙이게 한다 |\n| Effect | in-scope |\n| State | proposed |");
}

describe("FR-FLOW-204 AC-6 — the hash command decides whether the user request changed", () => {
  for (const rel of PRD_COPIES) {
    const cmd = (): Command => {
      const found = command(read(rel), "prd-hash");
      expect(found, `${rel}: no '# prd-hash:' command line`).toBeDefined();
      return found as Command;
    };

    // @req FR-FLOW-204 AC-6
    it(`${rel}: the fixture's stored hash matches and the command prints it`, () => {
      expect(storedHash).toMatch(/^[0-9a-f]{64}$/);
      const result = run(cmd(), fixture);
      expect(result.status).toBe(0);
      expect(result.stdout.trim().split("\n")[0]).toBe(storedHash);
    });

    // @req FR-FLOW-204 AC-6 — one byte of the user request changed is caught.
    it(`${rel}: one byte changed in U-1 fails`, () => {
      expect(run(cmd(), once(fixture, "RBAC 을 붙이고", "RBAD 을 붙이고")).status).toBe(1);
    });

    // @req FR-FLOW-204 AC-6 — an appended answer changes the hash, so the row must be rewritten.
    it(`${rel}: an appended U block fails until the row is rewritten`, () => {
      const appended = once(fixture, "\n## 2. Items", "\n### U-3 — 2026-11-04 answer to Q-2\n\n> 답: 역할 계층은 필요 없습니다.\n\n## 2. Items");
      const before = run(cmd(), appended);
      expect(before.status).toBe(1);
      const rewritten = appended.replace(storedHash, before.stdout.trim().split("\n")[0] ?? "");
      expect(run(cmd(), rewritten).status).toBe(0);
    });

    // @req FR-FLOW-204 AC-6 — line endings are normalized to LF before hashing: a checkout with
    // core.autocrlf=true or an editor that rewrites line endings leaves the request as it was.
    it(`${rel}: the same PRD with CRLF line endings keeps the hash`, () => {
      const result = run(cmd(), toCrlf(fixture));
      expect(result.status).toBe(0);
      expect(result.stdout.trim().split(/\r?\n/)[0]).toBe(storedHash);
    });

    // @req FR-FLOW-204 AC-6 — normalizing line endings does not hide a real change to the request.
    it(`${rel}: CRLF line endings with one byte changed in U-1 still fail`, () => {
      expect(run(cmd(), toCrlf(once(fixture, "RBAC 을 붙이고", "RBAD 을 붙이고"))).status).toBe(1);
    });

    // @req FR-FLOW-204 AC-6 — a U block written without the row (the template's "-") fails, under --auto too.
    it(`${rel}: a PRD whose Request SHA256 row is still the template placeholder fails`, () => {
      expect(run(cmd(), fixture.replace(storedHash, "-")).status).toBe(1);
    });

    // @req FR-FLOW-204 AC-6 — the hash covers the `## 1. User Request` section only.
    it(`${rel}: an edit outside the User Request section keeps the hash`, () => {
      expect(run(cmd(), inItem(fixture, 2, "자바 웹 프레임워크", "자바 웹 프레임워크 기반")).status).toBe(0);
    });
  }

  // @req FR-FLOW-204 AC-6 — the copy kiwi-srs uses to verify the row is the same command.
  it("AC-6: every kiwi-srs rendering verifies with the same hash command kiwi-prd writes with", () => {
    const reference = command(read(PRD_COPIES[0]), "prd-hash")?.js;
    expect(reference).toBeDefined();
    for (const rel of [...PRD_COPIES, ...SRS_COPIES]) {
      expect(command(read(rel), "prd-hash")?.js, `${rel}: hash command differs or is missing`).toBe(reference);
    }
  });
});

describe("FR-FLOW-204 AC-2 AC-3 AC-7 — the quote command checks the item grammar and every quote", () => {
  const cases: ReadonlyArray<readonly [string, string, () => string, RegExp]> = [
    ["AC-3", "one character of a quote changed", () => inItem(fixture, 3, "> 사용자 편의 기능을 RBAC 을 붙이고", "> 사용자 편의 기능을 RBAC 를 붙이고"), /PRD-3 quote/],
    ["AC-3", "a quote taken from a U block its Source does not name", () => inItem(fixture, 2, "| Source | U-1 |", "| Source | U-2 |"), /PRD-2 quote/],
    ["AC-3", "a Source naming no U block", () => inItem(fixture, 3, "| Source | U-1 |", "| Source | U-9 |"), /PRD-3 quote/],
    ["AC-3", "a non-proposal item with no quote", () => inItem(fixture, 2, "> nodejs 의 express 를 자바 버전으로 만드는데\n", ""), /PRD-2 quote/],
    // verify-r4: the agent's question recorded in a U block is not the user's words (AC-3 last sentence).
    ["AC-3", "a quote taken from the agent's question in a U block",
      () => inItem(fixture, 4, "> 인터페이스와 파일 스토어만 만들어서", "> 파일 스토어는 실행 중에 역할·권한을 바꿔 파일에 저장하는 것까지 해야 하나요"), /PRD-4 quote/],
    ["AC-3", "a quote that runs from the agent's question into the user's answer",
      () => inItem(fixture, 4, "> 인터페이스와 파일 스토어만 만들어서", "> 읽기만 하면 되나요?\n>\n> 답: 저장까지"), /PRD-4 quote/],
    ["AC-3", "a proposal with no Reason", () => inItem(fixture, 8, "| Reason | 의존성이 없고 사람이 고치기 쉽다 |\n", ""), /PRD-8 Reason/],
    // verify-r15: a proposal must state what it adds once confirmed (AC-3 last sentence).
    ["AC-3", "a proposal with no Effect", () => inItem(fixture, 8, "| Effect | in-scope |\n", ""), /PRD-8 Effect/],
    ["AC-3", "a proposal whose Effect is outside the list", () => inItem(fixture, 8, "| Effect | in-scope |", "| Effect | default |"), /PRD-8 Effect/],
    ["AC-2", "no item of Kind=intent", () => inItem(fixture, 1, "| Kind | intent |", "| Kind | goal |"), /no intent item/],
    ["AC-2", "a gap in the numbering", () => once(fixture, "### PRD-8 — ", "### PRD-9 — "), /numbering/],
    ["AC-2", "a Kind outside the list", () => inItem(fixture, 5, "| Kind | in-scope |", "| Kind | feature |"), /PRD-5 Kind/],
    ["AC-2", "a State outside the list", () => inItem(fixture, 5, "| State | confirmed |", "| State | approved |"), /PRD-5 State/],
    ["AC-2", "an exclusion without an Exclusion Class", () => inItem(fixture, 7, "| Exclusion Class | external-ownership |\n", ""), /PRD-7 Exclusion Class/],
    ["AC-2", "an Exclusion Class outside the list", () => inItem(fixture, 7, "| Exclusion Class | external-ownership |", "| Exclusion Class | out-of-budget |"), /PRD-7 Exclusion Class/],
    ["AC-2", "an Exclusion Class on an in-scope item", () => inItem(fixture, 5, "| Kind | in-scope |\n", "| Kind | in-scope |\n| Exclusion Class | user-excluded |\n"), /PRD-5 Exclusion Class/],
    ["AC-7", "a SHALL statement in an item", () => inItem(fixture, 4, "U-2 에서 실행 중 저장까지 하기로 했다.", "THE SYSTEM SHALL persist roles."), /requirement grammar/],
    ["AC-7", "a Requirement ID in an item", () => inItem(fixture, 4, "U-2 에서 실행 중 저장까지 하기로 했다.", "FR-RBAC-001 로 등록한다."), /requirement grammar/],
    ["AC-7", "an acceptance criterion line in an item", () => inItem(fixture, 4, "U-2 에서 실행 중 저장까지 하기로 했다.", "- AC-1: 저장한다."), /requirement grammar/],
    // A proposal is the agent's text, so a quote line inside it is not the user's words: before this
    // check the command dropped every `>` line from the grammar scan, and this exact line passed (verify-r2 K4).
    ["AC-7", "a SHALL statement and a Requirement ID in a proposal's quote line",
      () => inItem(fixture, 8, "| State | confirmed |\n", "| State | confirmed |\n\n> THE SYSTEM SHALL create PostgreSQL tables. FR-RBAC-001\n"), /requirement grammar/],
    ["AC-7", "a Requirement ID alone in a proposal's quote line",
      () => inItem(fixture, 8, "| State | confirmed |\n", "| State | confirmed |\n\n> FR-RBAC-001 로 등록한다.\n"), /requirement grammar/],
    ["AC-7", "an acceptance criterion line in a proposal's quote line",
      () => inItem(fixture, 8, "| State | confirmed |\n", "| State | confirmed |\n\n> - AC-1: 저장한다.\n"), /requirement grammar/],
    // verify-r14: the approval quote is exempt, but agent text written under `## 3. Approval` is not.
    ["AC-7", "a Requirement ID in an agent line of the approval section outside the quote",
      () => once(fixture, "> 사용자: 이대로 진행하세요.", "> 사용자: 이대로 진행하세요.\n\nFR-RBAC-001 로 승인되었다."), /requirement grammar/],
    ["AC-7", "a SHALL statement in an agent line of the approval section outside the quote",
      () => once(fixture, "> 사용자: 이대로 진행하세요.", "> 사용자: 이대로 진행하세요.\n\nTHE SYSTEM SHALL persist roles."), /requirement grammar/],
  ];

  for (const rel of PRD_COPIES) {
    const cmd = (): Command => {
      const found = command(read(rel), "prd-quote");
      expect(found, `${rel}: no '# prd-quote:' command line`).toBeDefined();
      return found as Command;
    };

    // @req FR-FLOW-204 AC-2 AC-3 — the clean fixture passes and the item count is reported.
    it(`${rel}: the fixture passes and the command reports its 8 items`, () => {
      const result = run(cmd(), fixture);
      expect(result.stdout).toContain("8 items");
      expect(result.status).toBe(0);
    });

    // @req FR-FLOW-204 AC-2 — under --auto with no stated purpose, an inferred-intent proposal stands in.
    it(`${rel}: an --auto, unapproved PRD whose intent is an 'inferred intent:' proposal passes`, () => {
      const result = run(cmd(), autoInferred());
      expect(result.stdout).toContain("8 items");
      expect(result.status).toBe(0);
    });

    // @req FR-FLOW-204 AC-2 — the stand-in is refused everywhere else.
    for (const [label, mutate] of [
      ["once the PRD is approved", (t: string) => once(t, "| Status | unapproved |", "| Status | approved |")],
      ["in an unapproved draft that is not --auto", (t: string) => once(t, "| Approved | --auto |", "| Approved | - |")],
      ["when the proposal's Reason does not begin 'inferred intent:'", (t: string) => once(t, "| Reason | inferred intent: ", "| Reason | ")],
    ] as const) {
      it(`${rel}: the inferred-intent stand-in fails ${label}`, () => {
        const result = run(cmd(), mutate(autoInferred()));
        expect(result.status).toBe(1);
        expect(result.stdout).toMatch(/no intent item/);
      });
    }

    // @req FR-FLOW-204 AC-3 — the question exclusion covers only answer blocks: a line of the user's own
    // request (U-1) that begins with `질문:` is the user's words and stays quotable (fix-r4 4b).
    it(`${rel}: an item quoting a '질문:' line of the user's request in U-1 passes`, () => {
      const said = once(fixture, "붙일 수 있게 하라.", "붙일 수 있게 하라.\n>\n> 질문: 역할 상속도 지원");
      const result = run(cmd(), inItem(said, 5, "> 사용자가 상속 받아서 DB로 붙일 수 있게", "> 질문: 역할 상속도 지원"));
      expect(result.stdout).toContain("8 items");
      expect(result.status).toBe(0);
    });

    // @req FR-FLOW-204 AC-3 — a later U block with no `답:` line is not a question-and-answer block.
    it(`${rel}: an item quoting a '질문:' line of a later U block without an answer line passes`, () => {
      const appended = once(fixture, "\n## 2. Items", "\n### U-3 — 2026-11-04 request document\n\n> 질문: 역할 상속도 지원\n\n## 2. Items");
      const result = run(cmd(), inItem(inItem(appended, 5, "| Source | U-1 |", "| Source | U-3 |"), 5, "> 사용자가 상속 받아서 DB로 붙일 수 있게", "> 질문: 역할 상속도 지원"));
      expect(result.stdout).toContain("8 items");
      expect(result.status).toBe(0);
    });

    // @req FR-FLOW-204 AC-3 — the user's answer in the same U block stays quotable.
    it(`${rel}: an item quoting the user's answer below the agent's question passes`, () => {
      const result = run(cmd(), inItem(fixture, 4, "> 인터페이스와 파일 스토어만 만들어서", "> 저장까지 해야 합니다."));
      expect(result.stdout).toContain("8 items");
      expect(result.status).toBe(0);
    });

    // @req FR-FLOW-204 AC-3 — the quote command reads a CRLF copy exactly as the LF one.
    it(`${rel}: the fixture with CRLF line endings passes`, () => {
      expect(run(cmd(), toCrlf(fixture)).status).toBe(0);
    });

    // @req FR-FLOW-204 AC-7 — the user's own words may carry anything; only the agent's text is checked.
    it(`${rel}: a Requirement ID or SHALL inside a U block or a quote is the user's and passes`, () => {
      const quoted = once(fixture, "붙일 수 있게 하라.", "붙일 수 있게 하라. FR-FLOW-203 처럼 SHALL 로 써 줘.");
      expect(run(cmd(), quoted).status).toBe(0);
    });

    // @req FR-FLOW-204 AC-7 — the approval sentence is copied verbatim (§1 step 5), so whatever the user
    // said in it — a Requirement ID, SHALL, an AC line — passes and is never rewritten (verify-r14).
    it(`${rel}: an approval quote carrying a Requirement ID, SHALL and an AC line is the user's and passes`, () => {
      const approval = once(fixture, "> 사용자: 이대로 진행하세요.",
        "> 사용자: FR-FLOW-205 와 겹치지 않게, 이대로 진행하세요. THE SYSTEM SHALL persist roles.\n> - AC-1: 저장한다.");
      const result = run(cmd(), approval);
      expect(result.stdout).toContain("8 items");
      expect(result.status).toBe(0);
    });

    // @req FR-FLOW-204 AC-7 — a non-proposal item may quote that passage: the quote check proves it is the user's.
    it(`${rel}: a non-proposal item quoting a user passage that carries SHALL passes`, () => {
      const said = once(fixture, "붙일 수 있게 하라.", "붙일 수 있게 하라. FR-FLOW-203 처럼 SHALL 로 써 줘.");
      const quotedByItem = inItem(said, 5, "> 사용자가 상속 받아서 DB로 붙일 수 있게", "> FR-FLOW-203 처럼 SHALL 로 써 줘.");
      const result = run(cmd(), quotedByItem);
      expect(result.stdout).toContain("8 items");
      expect(result.status).toBe(0);
    });

    for (const [ac, label, mutate, reason] of cases) {
      // @req FR-FLOW-204 AC-2 AC-3 AC-7 (the AC named in the test title)
      it(`${ac}: ${rel} fails on ${label}`, () => {
        const result = run(cmd(), mutate());
        expect(result.status, `${label} passed`).toBe(1);
        expect(result.stdout).toMatch(reason);
      });
    }
  }
});

describe("FR-FLOW-204 AC-8 — kiwi-prd survives a compaction whole and ships in the bundle", () => {
  for (const rel of PRD_COPIES) {
    // @req FR-FLOW-204 AC-8
    it(`${rel} is within ${COMPACTION_TOKEN_BUDGET} estimated tokens`, () => {
      const text = read(rel);
      expect(text, `${rel} is missing`).not.toBe("");
      expect(estimateTokens(text)).toBeLessThanOrEqual(COMPACTION_TOKEN_BUDGET);
    });

    // @req FR-FLOW-204 AC-8
    it(`${rel} is named kiwi-prd`, () => {
      expect(read(rel)).toMatch(/^---\s*\nname:\s*kiwi-prd\s*\n/);
    });
  }

  // @req FR-FLOW-204 AC-8 — the estimate is the one the AC fixes: non-ASCII 1, ASCII 1/3 rounded up.
  it("AC-8: the estimate counts one token per non-ASCII character and one per three ASCII characters", () => {
    expect(estimateTokens("")).toBe(0);
    expect(estimateTokens("abc")).toBe(1);
    expect(estimateTokens("abcd")).toBe(2);
    expect(estimateTokens("가나")).toBe(2);
    expect(estimateTokens("가a")).toBe(2);
    expect(estimateTokens("😀")).toBe(1);
  });

  // @req FR-FLOW-204 AC-8
  it("AC-8: EXPECTED_KIWI_SKILLS lists kiwi-prd", () => {
    expect(EXPECTED_KIWI_SKILLS).toContain("kiwi-prd");
  });

  // @req FR-FLOW-204 AC-8 — codex carries the UI metadata every codex skill has.
  it("AC-8: codex carries agents/openai.yaml naming $kiwi-prd", () => {
    const yaml = read("skills/codex/kiwi-prd/agents/openai.yaml");
    expect(yaml).toContain("display_name:");
    expect(yaml).toContain("$kiwi-prd");
  });
});

describe("FR-FLOW-204 AC-9 — the orchestrators write the PRD first and hand its path to kiwi-srs", () => {
  // The whole rule paragraph is pinned, not a fragment of it: the sentence that keeps wave
  // decomposition open while an intent, goal or in-scope item is named by no wave was deletable with
  // every assertion green while only the first two sentences were pinned.
  const ORCHESTRATOR_RULE =
    "intake 가 받은 요청에 PRD 경로가 없으면 조사보다 먼저 `kiwi-prd` 를 불러 승인된 PRD 를 만든다. wave 를 나눌 때 각 `waves/wave-{n}/excerpt.md` 에 그 wave 가 맡는 PRD 항목 ID 를 적어 `intent` · `goal` · `in-scope` 항목이 모두 어느 한 wave 에 지명되게 하고, 모든 `kiwi-srs` 호출에 그 PRD 경로를 `PRD_PATH` 로 넘긴다. 요청이 이미 `docs/prd/` 의 PRD 를 가리키면 그 PRD 를 쓴다. 지명되지 않은 `intent` · `goal` · `in-scope` 항목이 하나라도 남으면 wave 분해를 끝내지 않는다. `Effect` 가 in-scope 인 확정 proposal 도 in-scope 항목으로 보고 어느 한 wave 에 지명한다. `--auto` 면 `kiwi-prd` 가 `Status` 행을 `unapproved` 로 둔 채 돌려준 PRD 를 쓰고 run 보고에 미승인임을 적는다. PRD 는 `kiwi-prd` 만 고친다 — intake 기록(`01.intake.md`)이 요청을 요약하더라도 판정 기준은 PRD 다.";
  const WAVE_MASTER_RULE =
    "입력 문서에 PRD 경로가 없으면 wave 분해보다 먼저 `kiwi-prd` 를 불러 그 입력 문서를 `U-1` 의 원천으로 승인된 PRD 를 만든다. 요청이 이미 `docs/prd/` 의 PRD 를 가리키면 그 PRD 를 쓴다. wave 를 나눌 때 각 wave 의 `excerpt_path` 발췌에 그 wave 가 맡는 PRD 항목 ID 를 적어 `intent` · `goal` · `in-scope` 항목이 모두 어느 한 wave 에 지명되게 하고, 모든 `kiwi-srs` 호출에 그 PRD 경로를 `PRD_PATH` 로 넘긴다. 지명되지 않은 `intent` · `goal` · `in-scope` 항목이 하나라도 남으면 wave 분해를 끝내지 않는다. `Effect` 가 in-scope 인 확정 proposal 도 in-scope 항목으로 보고 어느 한 wave 에 지명한다. `--auto` 면 `kiwi-prd` 가 `Status` 행을 `unapproved` 로 둔 채 돌려준 PRD 를 쓰고 run 보고에 미승인임을 적는다. PRD 는 `kiwi-prd` 만 고친다.";
  const CASES = [
    ["kiwi-orchestrator", ORCHESTRATOR_RULE, "intake 가 받은 요청에", "REQ_PATH=waves/wave-{n}/excerpt.md"],
    ["kiwi-wave-master", WAVE_MASTER_RULE, "입력 문서에 PRD 경로가 없으면", "REQ_PATH=<그 wave 의 excerpt_path>"],
  ] as const;

  // @req FR-FLOW-204 AC-9 — the shared module that materializes each wave's excerpt gives the PRD item
  // IDs a fixed place, so the naming duty the two orchestrators state has somewhere to be written.
  const EXCERPT_LINE =
    "PRD 가 있는 run 이면 각 wave 발췌의 맨 위에 `PRD items: PRD-<n>, …` 한 줄로 그 wave 가 맡는 PRD 항목 ID 를 적는다 — 모든 `intent` · `goal` · `in-scope` 항목이 어느 한 wave 의 이 줄에 나와야 wave 분해가 끝난다(FR-FLOW-204 AC-9). `Effect` 가 in-scope 인 확정 proposal 도 in-scope 항목으로 이 줄에 나와야 한다.";
  it.each(RENDERINGS.map((root) => `${root}/_shared/kiwi/wave-decomposition.md`))("%s: the wave excerpt format has a PRD item ID line", (rel) => {
    const text = read(rel);
    const excerpt = text.indexOf("`{artifact_root}design-baseline/wave-{n}.md`");
    expect(excerpt, `${rel}: the excerpt materialization sentence`).toBeGreaterThan(0);
    const at = text.indexOf(EXCERPT_LINE);
    expect(at, `${rel}: the PRD item ID line`).toBeGreaterThan(excerpt);
  });

  for (const [skill, rule, opening, reqPath] of CASES) {
    // kiwi-wave-master is on the mirror's exclusion list, so it ships in the three skills/ renderings only.
    const roots = skill === "kiwi-wave-master" ? RENDERINGS.filter((root) => root !== ".agents/skills") : RENDERINGS;
    for (const rel of roots.map((root) => `${root}/${skill}/SKILL.md`)) {
      // @req FR-FLOW-204 AC-9
      it(`${rel}: the PRD rule is exactly the pinned paragraph and ends within the first ${COMPACTION_TOKEN_BUDGET} estimated tokens`, () => {
        const text = read(rel);
        const paragraph = text.split("\n").filter((line) => line.startsWith(opening));
        expect(paragraph, `${rel}: the PRD rule paragraph`).toEqual([rule]);
        const at = tokensThrough(text, rule);
        expect(at).toBeGreaterThan(0);
        expect(at).toBeLessThanOrEqual(COMPACTION_TOKEN_BUDGET);
      });

      // @req FR-FLOW-204 AC-9 — the kiwi-srs call block itself carries the PRD path.
      it(`${rel}: the kiwi-srs call form passes PRD_PATH`, () => {
        const text = read(rel);
        const call = text.indexOf('Skill({ skill: "kiwi-srs",');
        expect(call, `${rel}: no kiwi-srs call form`).toBeGreaterThan(0);
        const args = text.slice(call, text.indexOf('" })', call));
        expect(args).toContain(reqPath);
        expect(args).toContain("PRD_PATH=");
      });
    }
  }
});

describe("kiwi-pm names kiwi-prd as the owner of PRD authoring", () => {
  // @req FR-FLOW-160 AC-3 — the sentence that said no skill declares PRD authoring stopped being
  // true when FR-FLOW-204 shipped kiwi-prd. Both halves are held, as AC-4 does for its pointers: the
  // kiwi-pm sentence names kiwi-prd, and kiwi-prd declares PRD authoring.
  const PM_DOCS = [
    "skills/claude/kiwi-pm/SKILL.md",
    "skills/codex/kiwi-pm/references/extended-workflow.md",
    "skills/etc/kiwi-pm/references/extended-workflow.md",
    ".agents/skills/kiwi-pm/references/extended-workflow.md",
  ];
  it.each(PM_DOCS)("%s: names kiwi-prd as the PRD authoring skill and no longer says none exists", (rel) => {
    const text = read(rel);
    expect(text).not.toContain("PRD 저작을 선언하는 스킬은 없다");
    expect(text).toContain("SRS / feasibility / SDS / PRD 작성 스킬 자체 호출 (각각 kiwi-srs, kiwi-srs-feasibility, kiwi-sds, kiwi-prd 영역)");
  });
  it.each(PRD_COPIES)("%s: declares PRD authoring", (rel) => {
    expect(/^description: ".*PRD 작성.*"$/m.test(read(rel))).toBe(true);
  });
});

describe("FR-FLOW-204 AC-10 AC-11 — R-STEP, the design freeze and user answers go through the PRD", () => {
  // verify-r2 K1/K2/R2: the R-STEP route handed kiwi-tdd only the intake summary, the design freeze
  // never looked at the PRD, and a 1.c answer went to 01.intake.md alone. Each rule is a paragraph of
  // the core block, and the whole core block is pinned so nothing can be inserted beside it.
  const ORCH_CORE_HEADING = "## 핵심 규칙 — 컴팩션 뒤에도 남는 PRD 규칙 (FR-FLOW-204)";
  const ORCH_RULE =
    "intake 가 받은 요청에 PRD 경로가 없으면 조사보다 먼저 `kiwi-prd` 를 불러 승인된 PRD 를 만든다. wave 를 나눌 때 각 `waves/wave-{n}/excerpt.md` 에 그 wave 가 맡는 PRD 항목 ID 를 적어 `intent` · `goal` · `in-scope` 항목이 모두 어느 한 wave 에 지명되게 하고, 모든 `kiwi-srs` 호출에 그 PRD 경로를 `PRD_PATH` 로 넘긴다. 요청이 이미 `docs/prd/` 의 PRD 를 가리키면 그 PRD 를 쓴다. 지명되지 않은 `intent` · `goal` · `in-scope` 항목이 하나라도 남으면 wave 분해를 끝내지 않는다. `Effect` 가 in-scope 인 확정 proposal 도 in-scope 항목으로 보고 어느 한 wave 에 지명한다. `--auto` 면 `kiwi-prd` 가 `Status` 행을 `unapproved` 로 둔 채 돌려준 PRD 를 쓰고 run 보고에 미승인임을 적는다. PRD 는 `kiwi-prd` 만 고친다 — intake 기록(`01.intake.md`)이 요청을 요약하더라도 판정 기준은 PRD 다.";
  const WM_RULE =
    "입력 문서에 PRD 경로가 없으면 wave 분해보다 먼저 `kiwi-prd` 를 불러 그 입력 문서를 `U-1` 의 원천으로 승인된 PRD 를 만든다. 요청이 이미 `docs/prd/` 의 PRD 를 가리키면 그 PRD 를 쓴다. wave 를 나눌 때 각 wave 의 `excerpt_path` 발췌에 그 wave 가 맡는 PRD 항목 ID 를 적어 `intent` · `goal` · `in-scope` 항목이 모두 어느 한 wave 에 지명되게 하고, 모든 `kiwi-srs` 호출에 그 PRD 경로를 `PRD_PATH` 로 넘긴다. 지명되지 않은 `intent` · `goal` · `in-scope` 항목이 하나라도 남으면 wave 분해를 끝내지 않는다. `Effect` 가 in-scope 인 확정 proposal 도 in-scope 항목으로 보고 어느 한 wave 에 지명한다. `--auto` 면 `kiwi-prd` 가 `Status` 행을 `unapproved` 로 둔 채 돌려준 PRD 를 쓰고 run 보고에 미승인임을 적는다. PRD 는 `kiwi-prd` 만 고친다.";
  const RSTEP_RULE =
    "`R-STEP` 으로 라우팅하면 `kiwi-tdd` 호출에도 그 PRD 경로를 `PRD_PATH` 로 넘긴다 — `kiwi-tdd` 는 step 의 acceptance 줄을 그 PRD 로 판정한 뒤에야 테스트로 옮기며, 작업 개요(`01.intake.md`)는 무엇을 만들지 정하지 않는다.";
  const DESIGN_RULE =
    "설계를 동결할 때(1.d 의 run 설계와 loop D, 3.a 의 wave 설계와 loop W) 설계 항목(`[D-nnn]` · `[I-nnn]`)마다 행 끝에 근거 `← PRD-<n>` 또는 `fills: PRD-<n> / <hole|contradiction|defect> / <reason>` 을 적고, 근거가 없거나 exclusion 항목에 걸리는 설계 항목은 loop D·W 가 동결 전에 지운다. `State` 가 `rejected` 인 PRD 항목은 근거가 되지 못하므로, 거절된 항목만 가리키는 설계 항목도 지운다. 거절된 `intent` · `goal` · `in-scope` 항목은 wave 지명과 사후 검증에서도 fail 로 세지 않는다. `Effect` 가 exclusion 인 확정 proposal 은 exclusion 항목으로, `Effect` 가 in-scope 인 확정 proposal 은 in-scope 항목으로 본다 — 설계 동결과 사후 검증에서도 그렇다. 설계 항목과 PRD 판정이 어긋나면(예: 그 설계 항목에서 나온 요구를 `kiwi-srs` 가 PRD 판정으로 drop 하면) PRD 판정이 이기고, 그 설계 항목은 사후 검증(loop P · F)의 설계 항목 분모에서 빠지며 `design-gap` 으로 되돌아가지 않는다 — 빠진 id 와 그 PRD 판정은 run 보고에 적는다. 기록된 `contradiction resolved:` 해소는 `kiwi-srs` · `kiwi-tdd` 와 같은 방식으로 따른다 — 그 해소가 없앤 in-scope 항목은 wave 지명과 사후 검증에서 fail 로 세지 않고, exclusion 을 좁힌 해소가 허용한 설계 항목은 그 exclusion 항목에 걸리지 않는 것으로 보고 지우지 않는다.";
  const ANSWER_ORCH =
    "요청에 관한 질문에 사용자가 답하면(1.c 의 QnA, loop D 가 되돌린 `needs-decision` 질문 포함) 그 답을 쓰기 전에 `kiwi-prd` 를 통해 PRD 의 다음 `U-<n>` 으로 원문 그대로 덧붙인다 — 답이 더한 범위는 그래야 PRD 에 근거를 갖는다.";
  const ANSWER_WM =
    "요청에 관한 질문에 사용자가 답하면 그 답을 쓰기 전에 `kiwi-prd` 를 통해 PRD 의 다음 `U-<n>` 으로 원문 그대로 덧붙인다 — 답이 더한 범위는 그래야 PRD 에 근거를 갖는다.";

  /** A core block of one rendering: from its heading to the first horizontal rule after it. */
  const block = (text: string, heading: string): string => {
    const start = text.indexOf(heading);
    if (start < 0) return "";
    const end = text.indexOf("\n\n---\n", start);
    return text.slice(start, end < 0 ? undefined : end);
  };

  const CORES = [
    ["kiwi-orchestrator", [ORCH_RULE, RSTEP_RULE, DESIGN_RULE, ANSWER_ORCH], RENDERINGS],
    ["kiwi-wave-master", [WM_RULE, ANSWER_WM], RENDERINGS.filter((root) => root !== ".agents/skills")],
  ] as const;
  for (const [skill, paragraphs, roots] of CORES) {
    for (const rel of roots.map((root) => `${root}/${skill}/SKILL.md`)) {
      // @req FR-FLOW-204 AC-9 AC-10 AC-11
      it(`${rel}: the core block is exactly the pinned paragraphs and ends within ${COMPACTION_TOKEN_BUDGET} estimated tokens`, () => {
        const text = read(rel);
        const core = block(text, ORCH_CORE_HEADING);
        expect(core).toBe([ORCH_CORE_HEADING, ...paragraphs].join("\n\n"));
        expect(tokensThrough(text, core)).toBeLessThanOrEqual(COMPACTION_TOKEN_BUDGET);
      });
    }
  }

  // @req FR-FLOW-204 AC-10 — the R-STEP call itself carries the PRD path.
  it.each(RENDERINGS.map((root) => `${root}/kiwi-orchestrator/SKILL.md`))("%s: the kiwi-tdd call form passes PRD_PATH", (rel) => {
    expect(read(rel)).toContain(
      'Skill({ skill: "kiwi-tdd", args: "<task> PRD_PATH=docs/prd/{prd}.prd.md --review-hop-owned-by-parent --no-pipeline-emit [--auto] [--max] [--mini | --loops N] [--model <name>]" })'
    );
  });

  const TDD_HEADING = "## 핵심 규칙 — 컴팩션 뒤에도 남는 PRD 판정 (FR-FLOW-204 AC-10 AC-12)";
  // verify-r3 C/F: a standalone run collects the PRD first (AC-12), and a recorded resolution that removes
  // an in-scope item or narrows an exclusion is honoured by (a) and (b) (FR-FLOW-205 AC-6).
  const TDD_RULE = [
    "이 블록은 아래 본문보다 앞선다. 판정할 PRD 는 `PRD_PATH` 로 받은 PRD 이고, 없으면 입력이 가리키는 `docs/prd/` 의 PRD 다. 둘 다 없으면 Phase 2 보다 먼저 `kiwi-prd` 를 불러 입력(작업 개요·연구 문서·이슈)을 `U-1` 의 원천으로 PRD 를 만들고 그 PRD 로 판정한다 — PRD 없이 acceptance 줄을 쓰는 경로는 없다. `--auto` 는 `kiwi-prd` 에 그대로 넘긴다. `Status` 행이 승인 값이 아닌 PRD 로는 판정하지 않고 `NEEDS_USER` 로 끝난다 — `--auto` 에서도 그렇게 끝나며 결정 위원회가 정하지 않는다(critical gate `prd-unapproved-user-decision`). 예외는 `kiwi-prd` 가 `--auto` 로 만든 PRD(`Status` 행이 `unapproved` 이고 승인 행에 `--auto` 가 적힌 PRD) 하나이며, 그 PRD 로 판정했으면 완료 보고에 `Status` 행 값을 그대로 싣는다.",
    "Phase 2 에서 쓴 acceptance 줄은 Phase 3 에서 테스트로 옮기기 전에 그 PRD 로 판정한다. 줄마다 근거를 intent.md 의 설명 문단에 `AC-<n> ← PRD-<m>` 또는 `AC-<n> fills: PRD-<m> / <hole|contradiction|defect> / <reason>` 으로 적는다. (a) `intent` · `goal` · `in-scope` 항목을 근거로 인용한 줄이 없거나 그 항목과 반대로 말하는 줄이 있으면 fail 이고, 줄을 고쳐 다시 판정해 통과하기 전에는 Phase 3 으로 가지 않는다. `State` 가 `rejected` 인 항목은 이 fail 검사에서 빠진다. `Effect` 가 in-scope 인 확정 proposal 은 in-scope 항목처럼 이 fail 검사를 받는다. (b) 근거가 없거나 exclusion 항목에 걸리는 줄은 지우고 사유를 보고한다 — 필요하다는 주장이 메우는 구멍을 대지 못하면 지우지 않고 `NEEDS_USER` 로 멈춘다 — `--auto` 에서도 멈추며 결정 위원회가 정하지 않는다(critical gate `prd-residual-user-decision`). `State` 가 `rejected` 인 항목은 근거가 되지 못하므로, 거절된 항목만 인용한 줄도 지운다. `Effect` 가 exclusion 인 확정 proposal 은 exclusion 항목으로 작동하므로, 그 proposal 에 걸리는 줄도 지운다. (c) `fills:` 근거가 있는 줄만 메우기로 받아들이고, 항목 사이의 모순은 의도 항목에 맞는 쪽으로 직접 풀어 `kiwi-prd` 를 통해 PRD 에 `Reason` 이 `contradiction resolved:` 로 시작하는 proposal 로 기록한다 — 그 해소가 in-scope 항목을 없애거나 exclusion 을 좁혀도 그렇게 한다. 해소 proposal 은 확정되지 않은 채 `State` 를 바꾸지 않고, `State` 가 아니라 기록된 해소로서 효력을 가진다. 기록된 해소가 없앤 in-scope 항목은 (a) 의 fail 로 세지 않고, exclusion 을 좁힌 해소가 허용한 줄은 그 exclusion 항목에 걸리지 않는 것으로 보고 (b) 로 지우지 않는다. PRD 는 `kiwi-prd` 만 고친다. 요청에 관한 질문(`NEEDS_USER` 로 멈춘 질문 포함)에 사용자가 답하면 그 답을 쓰기 전에 `kiwi-prd` 를 통해 PRD 의 다음 `U-<n>` 으로 원문 그대로 덧붙인다(FR-FLOW-204 AC-11) — 답이 더한 범위는 그래야 PRD 에 근거를 갖는다.",
  ].join("\n\n");
  for (const rel of RENDERINGS.map((root) => `${root}/kiwi-tdd/SKILL.md`)) {
    // @req FR-FLOW-204 AC-10 — kiwi-tdd judges its acceptance lines against the PRD before the tests.
    it(`${rel}: the PRD verdict block is exactly the pinned rule, precedes §0, and ends within ${COMPACTION_TOKEN_BUDGET} estimated tokens`, () => {
      const text = read(rel);
      const core = block(text, TDD_HEADING);
      expect(core).toBe([TDD_HEADING, TDD_RULE].join("\n\n"));
      expect(tokensThrough(text, core)).toBeLessThanOrEqual(COMPACTION_TOKEN_BUDGET);
      expect(text.indexOf(TDD_HEADING)).toBeLessThan(text.indexOf("\n## 0. "));
    });

    // @req FR-FLOW-204 AC-10 — the input table names the argument.
    it(`${rel}: the input table lists PRD_PATH`, () => {
      expect(read(rel).split("\n").some((line) => line.startsWith("| `PRD_PATH` |"))).toBe(true);
    });
  }
});

describe("FR-FLOW-204 AC-12 — kiwi-step writes step requirements only against a PRD", () => {
  // verify-r3 F: kiwi-step authored step SRS drafts and never named kiwi-prd, so a request entered
  // through it had no exclusion to stop scope the user never asked for.
  const STEP_ROWS = [
    ["skills/claude/kiwi-step/SKILL.md", "| §0.9 | **PRD 판정 선행**(FR-FLOW-204 AC-12). 판정할 PRD 는 `PRD_PATH` 로 받은 PRD 이고, 없으면 입력이 가리키는 `docs/prd/` 의 PRD 다. 둘 다 없으면 Phase 2 보다 먼저 `kiwi-prd` 를 불러 입력(작성할 요구 개요)을 `U-1` 의 원천으로 PRD 를 만든다 — PRD 없이 step 요구를 쓰는 경로는 없다. `Status` 행이 승인 값이 아닌 PRD 로는 쓰지 않고 멈춘다. Phase 3 전에 쓴 요구와 AC 를 그 PRD 로 판정한다 — 판정 (a)·(b)·(c) 와 기록된 `contradiction resolved:` 해소의 처리는 `kiwi-tdd` 핵심 규칙과 같다. PRD 는 `kiwi-prd` 만 고친다. 요청에 관한 질문에 사용자가 답하면 그 답을 쓰기 전에 `kiwi-prd` 를 통해 PRD 의 다음 `U-<n>` 으로 원문 그대로 덧붙인다(FR-FLOW-204 AC-11). |", "| `PRD_PATH` | 판정할 PRD 경로. 없으면 §0.9 대로 `kiwi-prd` 가 먼저 PRD 를 만든다. |"],
    ["skills/codex/kiwi-step/SKILL.md", "| §0.9 | **PRD verdict first** (FR-FLOW-204 AC-12). The PRD to judge against is the one given as `PRD_PATH`, else the `docs/prd/` PRD the input points to. With neither, invoke `kiwi-prd` before Phase 2 with the input (the requirement outline) as the source of block `U-1`, and judge against that PRD — no path writes step requirements without a PRD. Do not author from a PRD unless its `Status` row holds the value `kiwi-prd` writes when the user signs off; stop instead. Before Phase 3, judge the written requirements and acceptance criteria against that PRD — verdicts (a), (b), (c) and the handling of a recorded `contradiction resolved:` resolution are the same as in the `kiwi-tdd` core rule. Only `kiwi-prd` edits the PRD. When the user answers a question about the request, append that answer verbatim to the PRD as the next `U-<n>` block through `kiwi-prd` before acting on it (FR-FLOW-204 AC-11). |", "| PRD path | `PRD_PATH` — the PRD to judge against; without it `kiwi-prd` writes the PRD first (§0.9) | none |"],
    ["skills/etc/kiwi-step/SKILL.md", "| §0.9 | **PRD verdict first** (FR-FLOW-204 AC-12). The PRD to judge against is the one given as `PRD_PATH`, else the `docs/prd/` PRD the input points to. With neither, invoke `kiwi-prd` before Phase 2 with the input (the requirement outline) as the source of block `U-1`, and judge against that PRD — no path writes step requirements without a PRD. Do not author from a PRD unless its `Status` row holds the value `kiwi-prd` writes when the user signs off; stop instead. Before Phase 3, judge the written requirements and acceptance criteria against that PRD — verdicts (a), (b), (c) and the handling of a recorded `contradiction resolved:` resolution are the same as in the `kiwi-tdd` core rule. Only `kiwi-prd` edits the PRD. When the user answers a question about the request, append that answer verbatim to the PRD as the next `U-<n>` block through `kiwi-prd` before acting on it (FR-FLOW-204 AC-11). |", "| PRD path | `PRD_PATH` — the PRD to judge against; without it `kiwi-prd` writes the PRD first (§0.9) | none |"],
  ] as const;
  for (const [rel, rule, input] of STEP_ROWS) {
    // @req FR-FLOW-204 AC-12
    it(`${rel}: §0 carries the PRD-first rule before Phase 2, within ${COMPACTION_TOKEN_BUDGET} estimated tokens`, () => {
      const text = read(rel);
      const lines = text.split("\n");
      expect(lines).toContain(rule);
      expect(tokensThrough(text, rule)).toBeLessThanOrEqual(COMPACTION_TOKEN_BUDGET);
      expect(text.indexOf(rule)).toBeLessThan(text.indexOf("\n## 2. "));
    });
    // @req FR-FLOW-204 AC-12
    it(`${rel}: the input table lists PRD_PATH`, () => {
      expect(read(rel).split("\n")).toContain(input);
    });
  }
});
