import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { COMPACTION_TOKEN_BUDGET, tokensThrough } from "./skill-token-estimate.js";

// @req FR-FLOW-206 AC-5 — a skill that runs kiwi-review-fix-loop as a hop asks about the clean-code skip
// once at its own start, records the answer in its own run state, and passes `--skip-clean-code` to every
// review hop when the user confirmed, or `--keep-clean-code` when the user declined (verify-r19) —the wave worker's hop included, because the worker never sees the
// user's request (verify-r18). Each caller sentence is pinned exactly and must occur once.

const REPO_ROOT = fileURLToPath(new URL("../../", import.meta.url));
const read = (rel: string): string => readFileSync(path.join(REPO_ROOT, rel), "utf8").replace(/\r\n/g, "\n");

const KO_SKILLS = ["skills/claude", "skills/codex", "skills/etc"] as const;
const MIRRORED = [...KO_SKILLS, ".agents/skills"] as const;
const EN_SHARED = ["skills/codex", "skills/etc", ".agents/skills"] as const;

const ORCH =
  "- **`clean_code_skip`** — 사용자 요청이나 호출 인자가 빠른 처리를 요구하거나 클린 코드 원칙을 지키지 않아도 된다고 하면(`kiwi-review-fix-loop` 클린 코드 라운드 블록의 신호) Phase 0 에서 이 파일을 만들기 전에 클린 코드 검사를 건너뛸지 한 번만 묻고(`--auto` 면 묻지 않고 건너뛴다), 그 답을 생성 시점에 `true` 또는 `false` 로 적는다. `true` 면 `--skip-clean-code` 를, `false` 면 `--keep-clean-code` 를 이 run 이 부르는 모든 리뷰 hop — R-STEP 리뷰 hop(§4.5.1), 3.k 호스트 hop, 3.m 과 `verify-loop.md` §7 의 위임, run 창 종료 리뷰(§V.final-verify), 그리고 dispatch 카드로 받는 워커의 자기 창 리뷰(`parallel-waves.md` PW-6) — 의 args 에 더한다. 재개는 다시 묻지 않고 이 값을 따른다;";

const WAVE_MASTER =
  "사용자 요청이나 호출 인자가 빠른 처리를 요구하거나 클린 코드 원칙을 지키지 않아도 된다고 하면(`kiwi-review-fix-loop` 클린 코드 라운드 블록의 신호) Phase 0 에서 클린 코드 검사를 건너뛸지 한 번만 묻는다 — `--auto` 면 묻지 않고 건너뛴다. 그 답은 이 run 이 `waves.jsonl` 에 쓰는 첫 줄에 `decision` 객체(`question` 은 `clean-code-skip`, `decision` 은 `skip` 또는 `keep`, `origin` 은 `user` 또는 `auto`)로 기록하고, 재개는 다시 묻지 않고 그 기록을 따른다 — 그 줄보다 앞서 도는 리뷰 hop 은 없다. `skip` 이면 `--skip-clean-code` 를, `keep` 이면 `--keep-clean-code` 를 이 run 이 부르는 모든 리뷰 hop — 워커의 자기 창 리뷰(dispatch 카드, `parallel-waves.md` PW-6), 호스트 hop(PW-12), 개선 위임(§5.5.5), run 창 종료 리뷰(§5.55) — 의 args 에 더한다.";

const PM =
  "- 빠른 처리 신호(`kiwi-review-fix-loop` 클린 코드 라운드 블록)가 있으면 부팅 때 클린 코드 검사를 건너뛸지 한 번만 묻고(`--auto` 면 묻지 않고 건너뛴다) 답을 받은 즉시 `pm-state.json` 의 `clean_code_skip` 에 `true` 또는 `false` 로 기록한다 — `true` 면 위 hand-off 호출과 §6.4.1 의 리뷰 호출에 `--skip-clean-code` 를, `false` 면 `--keep-clean-code` 를 더하고, `--resume` 은 다시 묻지 않고 기록된 값을 따른다. `--no-final` 이나 `--review-hop-owned-by-parent` 로 hand-off 하지 않는 실행은 묻지 않는다 — 리뷰 hop 과 그 질문은 호출자의 것이다.";

const PIPELINE =
  "- 클린 코드 건너뛰기: 빠른 처리 신호(`kiwi-review-fix-loop` 클린 코드 라운드 블록)가 있으면 Phase 0 에서 한 번만 묻고(`--auto` 면 묻지 않고 건너뛴다), 사용자가 확인했으면 사이클의 리뷰 홉(§2.5.4 1번 · §2.5.5 3번)과 자체 리뷰 홉을 도는 `kiwi-tdd`(§2.8.2)에 `--skip-clean-code` 를, 거절했으면 `--keep-clean-code` 를 넘긴다. 이 스킬에는 재개 상태 파일이 없으므로 그 답은 리뷰 홉이 자기 `state.json` 의 `clean_code_skip` 에 기록하고, 이 호출이 끝에 쓰는 `pipeline.jsonl` 이벤트의 `notes` 에도 `clean_code_skip=true` 또는 `clean_code_skip=false` 로 적는다 — 사이클이 리뷰 홉 전에 멈춰도 이 이벤트는 쓰인다(§8.2). 리뷰 홉 전에 멈춘 사이클을 잇는 호출 — `--from=<stage>` 진입, 또는 자식 `--resume` 뒤 T1 추천을 따르는 호출 — 은 리뷰 홉을 부르기 전에 저널에서 가장 최근의 `kiwi-pipeline` 이벤트를 읽고, 그 이벤트가 리뷰 홉 전 중단을 적었고 `notes` 에 `clean_code_skip` 값이 있으면 다시 묻지 않고 기록된 답을 따라 같은 플래그를 넘기며, 자기 이벤트 `notes` 에도 같은 값을 적는다. 그런 값이 없으면 이 호출이 받은 신호로 위 규칙을 따른다.";

// verify-r21: the pipeline keeps no resume state file, so the answer survives a stopped cycle only in its own
// event `notes`; the continuing call reads it back. The core rule sits in the §0 table so it stays inside the
// first 5,000 estimated tokens that survive a compaction.
const PIPELINE_CORE =
  "| §0.13 | **클린 코드 답은 멈춘 사이클을 넘어 이어진다**: 빠른 처리 신호로 받은 클린 코드 답은 자기 이벤트 `notes` 에 `clean_code_skip=true` 또는 `clean_code_skip=false` 로 남고, 리뷰 홉 전에 멈춘 사이클을 잇는 호출(`--from=<stage>` · 자식 `--resume` 뒤 T1 추천)은 그 값을 읽어 다시 묻지 않고 같은 플래그를 리뷰 홉에 넘긴다 (§2.5.3) |";

// verify-r22: a pipeline call without work input spawns one T1 step (kiwi-pm, standalone kiwi-coder, ...) that runs its own
// review hop; the recorded answer goes to that child, and the child forwards a parent's answer to its hop.
const PIPELINE_CORE_SINGLE =
  "| §0.14 | **클린 코드 답은 한 단계만 부르는 자식에도 간다**: 작업 입력 없는 단일 단계 `--run` 이나 T1 추천으로 리뷰 홉에 이르는 자식(`kiwi-pm` · 단독 `kiwi-coder` · `kiwi-tdd` · `kiwi-review-fix-loop`)을 부를 때도 §0.13 의 답을 `--skip-clean-code` 또는 `--keep-clean-code` 로 넘긴다 (§7) |";
const PIPELINE_SPAWN =
  "- 선택 스킬이 리뷰 홉에 이르는 자식(`kiwi-pm` · 단독 `kiwi-coder` · `kiwi-tdd` · `kiwi-review-fix-loop`)이면 — 작업 입력 없는 단일 단계 `--run` 이나 T1 추천으로 spawn 해도 — 클린 코드 답(§2.5.3 이 저널에서 읽은 `clean_code_skip`, 없으면 이 호출이 받은 답)이 건너뛰기면 `--skip-clean-code` 를, 유지면 `--keep-clean-code` 를 붙인다. 답이 없으면 둘 다 붙이지 않는다 — 신호를 받은 자식이 스스로 한 번 묻는다.";
const PM_PARENT =
  "- 부모(호출자)가 `--skip-clean-code` 나 `--keep-clean-code` 를 넘겼으면 묻지 않고 그 답을 부팅 때 `pm-state.json` 의 `clean_code_skip` 에 기록하고, 위 hand-off 호출과 §6.4.1 의 리뷰 호출에 그 인자를 그대로 더한다 — 리뷰 hop 을 넘겨받지 않는 부모(예: `kiwi-pipeline` 의 단일 단계 `--run`)가 받은 답도 이렇게 리뷰 hop 에 닿는다(`kiwi-review-fix-loop` 클린 코드 라운드 블록).";
const CODER_PARENT =
  "부모가 `--skip-clean-code` 나 `--keep-clean-code` 를 넘긴 단독 실행은 묻지 않고 그 답을 `state.json` 의 `clean_code_skip` 에 기록하고, 이 절의 모든 `kiwi-review-fix-loop` 호출에 그 인자를 그대로 더한다.";

const TDD_KO =
  "빠른 처리 신호(`kiwi-review-fix-loop` 클린 코드 라운드 블록)가 있으면 Phase 0 에서 클린 코드 검사를 건너뛸지 한 번만 묻는다(`--auto` 면 묻지 않고 건너뛴다). 부모가 `--skip-clean-code` 나 `--keep-clean-code` 를 넘겼으면 묻지 않고 그 인자를 위 args 에 그대로 더하고, 그렇지 않으면 사용자가 확인했을 때 `--skip-clean-code` 를, 거절했을 때 `--keep-clean-code` 를 더한다. 이 스킬에는 재개 상태 파일이 없으므로 그 답의 기록은 이 홉의 `kiwi-review-fix-loop` 가 자기 `state.json` 의 `clean_code_skip` 에 남긴다. `--review-hop-owned-by-parent` 를 받은 실행은 묻지 않는다 — 리뷰 홉과 그 질문은 부모의 것이다.";
const TDD_EN =
  "On a speed signal (`kiwi-review-fix-loop` 클린 코드 라운드 block), ask once in Phase 0 whether to skip the clean-code check (`--auto` skips it without asking). When the parent passed `--skip-clean-code` or `--keep-clean-code`, do not ask and add that flag to the args above unchanged; otherwise add `--skip-clean-code` when the user confirmed or `--keep-clean-code` when the user declined. This skill keeps no resume state file, so the answer is recorded by this hop's `kiwi-review-fix-loop` in its own `state.json` `clean_code_skip`. A run that received `--review-hop-owned-by-parent` does not ask — the review hop and its question belong to the parent.";

const PW6_KO =
  "호출자가 실행 상태에 클린 코드 건너뛰기를 확인으로 기록했으면 dispatch 카드의 전파 플래그에 `--skip-clean-code` 가, 건너뛰지 않기로 기록했으면 `--keep-clean-code` 가 실리고, 워커는 위 args 에 그것을 더한다 — 워커는 사용자 요청을 보지 못하므로 빠른 처리 신호를 스스로 판정하거나 묻지 않고, `--skip-clean-code` 가 없으면 클린 코드 라운드를 돈다(`kiwi-review-fix-loop` 클린 코드 라운드 블록).";
const PW6_EN =
  "When the caller recorded a confirmed clean-code skip in its run state, the dispatch card's propagated flags carry `--skip-clean-code`, and when it recorded that the check is kept they carry `--keep-clean-code`; the worker adds that flag to the args above — the worker never sees the user's request, so it neither judges a speed signal itself nor asks, and without `--skip-clean-code` it runs the clean-code rounds (`kiwi-review-fix-loop` 클린 코드 라운드 block).";
const PW12_KO =
  "호출자가 클린 코드 건너뛰기를 확인으로 기록한 run 이면 위 args 에 `--skip-clean-code` 를, 건너뛰지 않기로 기록한 run 이면 `--keep-clean-code` 를 더한다 — PW-6 5단계와 같다.";
const PW12_EN =
  "On a run whose caller recorded a confirmed clean-code skip, add `--skip-clean-code` to the args above, and on one whose caller recorded that the check is kept, add `--keep-clean-code` — as in PW-6 step 5.";
const CARD_FLAGS = "`--auto-cost-warning` `--drive` `--skip-clean-code` `--keep-clean-code`)";

// verify-r19: standalone kiwi-coder adds `--auto` to its review hop on its own, so it is a hop-running caller and asks first.
const CODER_CLAUDE =
  "단독 실행이 빠른 처리 신호(`kiwi-review-fix-loop` 클린 코드 라운드 블록)를 받으면 Phase 0 에서 클린 코드 검사를 건너뛸지 한 번만 묻고(`--auto` 면 묻지 않고 건너뛴다) 답을 받은 즉시 `state.json` 의 `clean_code_skip` 에 `true` 또는 `false` 로 기록한다 — 아래 리뷰 호출은 사용자가 주지 않은 `--auto` 를 붙이므로, 묻지 않으면 빠른 처리 요청이 확인 없이 클린 코드 건너뛰기가 된다. `true` 면 이 절의 모든 `kiwi-review-fix-loop` 호출에 `--skip-clean-code` 를, `false` 면 `--keep-clean-code` 를 더하고, `--resume` 은 다시 묻지 않고 기록된 값을 따른다. `pm-child` 실행은 묻지 않는다 — 리뷰 hop 과 그 질문은 부모 `kiwi-pm` 의 것이다.";
const CODER_REF =
  "단독 실행이 빠른 처리 신호(`kiwi-review-fix-loop` 클린 코드 라운드 블록)를 받으면 Phase 0 에서 클린 코드 검사를 건너뛸지 한 번만 묻고(`--auto` 면 묻지 않고 건너뛴다) 답을 받은 즉시 `state.json` 의 `clean_code_skip` 에 `true` 또는 `false` 로 기록한다. `true` 면 이 절의 모든 `kiwi-review-fix-loop` 호출에 `--skip-clean-code` 를, `false` 면 `--keep-clean-code` 를 더하고, `--resume` 은 다시 묻지 않고 기록된 값을 따른다. `pm-child` 실행은 묻지 않는다 — 리뷰 hop 과 그 질문은 부모 `kiwi-pm` 의 것이다.";

function section(text: string, start: string, end: string): string {
  const from = text.indexOf(start);
  const to = text.indexOf(end, from + start.length);
  return from < 0 || to < 0 ? "" : text.slice(from, to);
}

const occurrences = (text: string, needle: string): number => text.split(needle).length - 1;

type Case = readonly [rel: string, needle: string, within?: readonly [start: string, end: string]];

const CASES: Case[] = [
  ...MIRRORED.map((root): Case => [`${root}/kiwi-orchestrator/SKILL.md`, ORCH, ["### 1.1 `00.run-contract.md`", "## 2. 저널 쓰기 규율"]]),
  ...KO_SKILLS.map((root): Case => [`${root}/kiwi-wave-master/SKILL.md`, WAVE_MASTER, ["### 7.6 클린 코드 건너뛰기 — 리뷰 hop 전달 (FR-FLOW-206)", "## 8. 에픽 이슈 진입 모드"]]),
  ["skills/claude/kiwi-pm/SKILL.md", PM, ["### 6.4 kiwi-review-fix-loop hand-off", "#### 6.4.1"]],
  ...EN_SHARED.map((root): Case => [`${root}/kiwi-pm/references/extended-workflow.md`, PM, ["### 6.4 kiwi-review-fix-loop hand-off", "#### 6.4.1"]]),
  ...MIRRORED.map((root): Case => [`${root}/kiwi-pipeline/SKILL.md`, PIPELINE, ["### 2.5.3", "### 2.5.4"]]),
  ...MIRRORED.map((root): Case => [`${root}/kiwi-pipeline/SKILL.md`, PIPELINE_CORE, ["## 0. 공통 규약 (SSOT)", "### §0.AG"]]),
  ...MIRRORED.map((root): Case => [`${root}/kiwi-pipeline/SKILL.md`, PIPELINE_CORE_SINGLE, ["## 0. 공통 규약 (SSOT)", "### §0.AG"]]),
  ...MIRRORED.map((root): Case => [`${root}/kiwi-pipeline/SKILL.md`, PIPELINE_SPAWN, ["## 7. Phase 4", "### 7.1"]]),
  ["skills/claude/kiwi-pm/SKILL.md", PM_PARENT, ["### 6.4 kiwi-review-fix-loop hand-off", "#### 6.4.1"]],
  ...EN_SHARED.map((root): Case => [`${root}/kiwi-pm/references/extended-workflow.md`, PM_PARENT, ["### 6.4 kiwi-review-fix-loop hand-off", "#### 6.4.1"]]),
  ["skills/claude/kiwi-coder/SKILL.md", CODER_PARENT, ["### 8.4", "## 9."]],
  ...EN_SHARED.map((root): Case => [`${root}/kiwi-coder/references/extended-workflow.md`, CODER_PARENT, ["### 8.4", "## 9."]]),
  ["skills/claude/kiwi-tdd/SKILL.md", TDD_KO, ["### 2.6.1", "### 2.7"]],
  ...EN_SHARED.map((root): Case => [`${root}/kiwi-tdd/SKILL.md`, TDD_EN, ["### 2.6.1", "### 2.7"]]),
  ["skills/claude/_shared/kiwi/parallel-waves.md", PW6_KO, ["**PW-6", "**PW-7"]],
  ...EN_SHARED.map((root): Case => [`${root}/_shared/kiwi/parallel-waves.md`, PW6_EN, ["**PW-6", "**PW-7"]]),
  ["skills/claude/_shared/kiwi/parallel-waves.md", PW12_KO, ["**PW-12", "**PW-13"]],
  ...EN_SHARED.map((root): Case => [`${root}/_shared/kiwi/parallel-waves.md`, PW12_EN, ["**PW-12", "**PW-13"]]),
  ...MIRRORED.map((root): Case => [`${root}/_shared/kiwi/parallel-waves.md`, CARD_FLAGS, ["**PW-5", "**PW-6"]]),
  ["skills/claude/kiwi-coder/SKILL.md", CODER_CLAUDE, ["### 8.4", "## 9."]],
  ...EN_SHARED.map((root): Case => [`${root}/kiwi-coder/references/extended-workflow.md`, CODER_REF, ["### 8.4", "## 9."]]),
];

describe("FR-FLOW-206 AC-5 — hop-running skills pass the confirmed clean-code skip to every review hop", () => {
  // @req FR-FLOW-206 AC-5
  it.each(CASES)("%s carries the pinned clean-code skip rule exactly once, in its section", (rel, needle, within) => {
    const text = read(rel);
    expect(occurrences(text, needle), `${rel}: rule count`).toBe(1);
    if (within) expect(section(text, within[0], within[1]), `${rel}: rule outside ${within[0]}`).toContain(needle);
  });
});

describe("FR-FLOW-206 AC-5 — kiwi-pipeline's carried-over clean-code answer survives a compaction", () => {
  // @req FR-FLOW-206 AC-5 — verify-r21: the continuing-call rule ends within the first 5,000 estimated tokens.
  it.each(MIRRORED)("%s/kiwi-pipeline/SKILL.md ends the §0.13 rule within the compaction budget", (root) => {
    for (const rule of [PIPELINE_CORE, PIPELINE_CORE_SINGLE]) {
      const used = tokensThrough(read(`${root}/kiwi-pipeline/SKILL.md`), rule);
      expect(used).toBeGreaterThan(0);
      expect(used).toBeLessThanOrEqual(COMPACTION_TOKEN_BUDGET);
    }
  });
});
