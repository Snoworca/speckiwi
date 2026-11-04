import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import { section, stripFrontmatter, tableRows, verbSection } from "./kiwi-orchestrator-variants.js";
import { NEGATION, RENDERINGS, flat, markdownFiles, readRepoFile, sentencesWith } from "./kiwi-renderings.js";

// @req FR-FLOW-199 FR-FLOW-200 FR-FLOW-201 — the rules a bug run's safety and outcome rest on, pinned
// verbatim.
//
// The suites beside this one assert a rule by the words that must share its sentence. A mutation run
// over them (161 mutations) left 40 alive, and they fell into three kinds: the words kept and the
// polarity flipped ("need not run with", "적지 않고", "있어도 부른다"), a hedge or a reordering slipped
// into the sentence ("필요하면", "adopt first and write the line afterwards"), and rules nothing
// asserted at all. A word-level check cannot see the first two, so each rule here is held as the
// sentence that states it: any edit to that sentence turns this suite red, and the change has to be
// made here too, on purpose. Whitespace is flattened so a rewrap is not an edit.
//
// claude is Korean; codex, etc and the `.agents` mirror are English. kiwi-orchestrator, kiwi-pipeline
// and the shared pipeline-event row are Korean in every rendering.

interface Pin {
  /** The requirement and AC the sentence carries. */
  readonly req: string;
  readonly en?: string;
  readonly ko: string;
}

const isKorean = (rendering: string): boolean => rendering === "skills/claude";

/** Every markdown file of one skill in one rendering, joined and flattened. */
function skillText(rendering: string, skill: string): string {
  return flat(markdownFiles(rendering, skill).map((relPath) => stripFrontmatter(readRepoFile(relPath).replace(/\r\n/g, "\n"))).join("\n"));
}

function pinCases(pins: readonly Pin[]): Array<[string, string, string]> {
  return RENDERINGS.flatMap((rendering) => pins.map((pin): [string, string, string] => [rendering, pin.req, isKorean(rendering) || pin.en === undefined ? pin.ko : pin.en]));
}

const BUG_REPRO: readonly Pin[] = [
  { req: "FR-FLOW-199 AC-8", en: "Stage 1 and stage 2 tests also run with the credential variables unset and the home and configuration variables pointed into a new temporary directory.", ko: "1단계와 2단계 테스트도 자격 증명 변수를 빼고 홈·설정 변수를 새 임시 디렉토리로 돌린 채 돌린다." },
  { req: "FR-FLOW-199 AC-8", en: "When the repository holds any of the credential files above, stage 1 and stage 2 tests also run in such an isolated copy", ko: "저장소에 위 자격 증명 파일이 하나라도 있으면 1단계와 2단계 테스트도 그런 격리된 사본에서 돌린다" },
  { req: "FR-FLOW-199 AC-8", en: "Delete the temporary directory when done.", ko: "끝나면 임시 디렉토리를 지운다." },
  { req: "FR-FLOW-199 AC-8", en: "When the issue carries real data, do not use it as is; build an input that copies only the shape the reproduction needs.", ko: "이슈에 실제 데이터가 붙어 있으면 그대로 쓰지 않고 재현에 필요한 모양만 옮겨 만든 입력을 쓴다." },
  { req: "FR-FLOW-199 AC-4", en: "**There are three stages and no more** (§3). When stage 3 does not reproduce, stop and ask (§4.3).", ko: "**단계는 셋이고 넘지 않는다**(§3). 3단계가 재현하지 못하면 §4.3 으로 멈추고 묻는다." },
  { req: "FR-FLOW-199 AC-3", en: "A candidate without `file:line` evidence does not enter the list — it is a guess.", ko: "근거 `file:line` 이 없는 후보는 목록에 넣지 않는다. 그것은 추측이다." },
  { req: "FR-FLOW-199 AC-5", en: "A test that replaces the suspected code with a mock is not a reproduction.", ko: "목(mock)으로 원인 부분을 갈아 끼운 테스트는 재현이 아니다." },
  { req: "FR-FLOW-199 AC-7", en: "Even after reproducing, check §4.2 before settling the outcome.", ko: "재현했어도 §4.2 를 먼저 확인한 뒤 결과를 확정한다." },
  { req: "FR-FLOW-199 AC-6", en: "A run that did not reproduce leaves no test file behind.", ko: "재현하지 못한 실행은 테스트 파일을 남기지 않는다." },
  { req: "FR-FLOW-199 AC-2/AC-6", en: "An unreadable or insufficient input and a failure to reproduce stop under `--auto` too", ko: "읽을 수 없거나 모자란 입력과 재현 실패는 `--auto` 에서도 멈춘다." },
  { req: "FR-FLOW-199 AC-2/AC-6", en: "Each gate below halts **regardless of** `--auto` for a user decision and is never handed to the decision committee.", ko: "아래 항목은 `--auto` **무관 항상** 멈추고 사용자 결정을 받는다. 결정 위원회로 넘기지 않는다." },
  { req: "FR-FLOW-199 AC-9", en: "`status`: `reproduced`, `reproduced-no-test`, `not-a-bug` and `analysis-only` = `TASK_DONE`; `not-reproduced` and `input-insufficient` = `NEEDS_USER`.", ko: "`status`: `reproduced` · `reproduced-no-test` · `not-a-bug` · `analysis-only` = `TASK_DONE`, `not-reproduced` · `input-insufficient` = `NEEDS_USER`." },
  { req: "FR-FLOW-199 AC-9", en: "`reproduced-no-test` gets `null` too, because kiwi-hot-fix stops on that outcome unless `TDD_EXEMPT_REASON` is given.", ko: "`reproduced-no-test` 도 `null` 이다: `kiwi-hot-fix` 는 `TDD_EXEMPT_REASON` 없이는 그 결과에서 멈추기 때문이다." }
];

const HOT_FIX: readonly Pin[] = [
  { req: "FR-FLOW-201 AC-4", en: "copy it only when the user's copy is byte-for-byte the `repro_base` version, that is, the user has not touched it.", ko: "사용자 트리의 그 파일이 `repro_base` 의 판과 바이트까지 같을 때만(사용자가 건드리지 않았을 때만) 복사한다." },
  { req: "FR-FLOW-201 AC-4", en: "(an edited file only when the user's copy equals the worktree's base commit)", ko: "그 밖의 경우(사용자가 그 파일을 고치거나 옮기거나 지웠거나, 경로가 이미 차 있으면)에는 복사하지 않고 손으로 합치지도 않으며, 멈춰서 사용자에게 묻는다(`repro-path-occupied`, `--auto` 에서도)." },
  { req: "FR-FLOW-201 AC-4", en: "When the user answers that they moved the case in themselves, `--resume` finds the reproduction test in the user's tree and goes on to the red check.", ko: "사용자가 그 케이스를 직접 옮겼다고 답하면 `--resume` 은 사용자 트리에서 그 재현 테스트를 찾아 Phase 2 로 간다." },
  { req: "FR-FLOW-201 AC-4", en: "When HEAD differs from `repro_base` on a `--resume` that comes before the copy (the user committed while the run waited), nothing is copied: stop and ask the user (`repro-base-moved`, also under `--auto`).", ko: "아직 복사하지 않은 채 `--resume` 하는데 HEAD 가 `repro_base` 와 다르면(사용자가 기다리는 동안 커밋했으면) 아무것도 복사하지 않고 멈춰서 사용자에게 묻는다(`repro-base-moved`, `--auto` 에서도)." },
  { req: "FR-FLOW-201 AC-4", en: "When an existing report is used for a git-status input, the red check still needs a HEAD worktree: create and prepare it as below, place that report's reproduction test in it at the same path, and check red there.", ko: "`git-status` 입력에 기존 보고서를 쓰면 Phase 2 의 red 확인에 HEAD worktree 가 여전히 필요하다: §4.1 대로 worktree 를 만들고 준비한 뒤, 그 보고서의 재현 테스트를 worktree 의 같은 경로에 놓고 거기서 red 를 확인한다." },
  { req: "FR-FLOW-201 AC-1", en: "Compare its `input.md` with the detected input; when they differ, invoke the skill anew.", ko: "같은 입력인지는 그 보고서의 `input.md` 를 §3.1 이 감지한 입력과 대조해 정하고, 다르면 새로 부른다." },
  { req: "FR-FLOW-201 AC-2", en: "| input insufficient (`input-insufficient`) | stop with the skill's question to the user; no fix is applied |", ko: "| 입력 부족 (`input-insufficient`) | 멈추고 그 질문을 그대로 사용자에게 낸다. fix 를 적용하지 않는다 |" },
  { req: "FR-FLOW-201 AC-1", en: "do not write a second test for the same symptom.", ko: "시니어 fixer 는 같은 증상을 단언하는 테스트를 새로 쓰지 않는다." },
  { req: "FR-FLOW-201 AC-3", en: "when it is not red any more, stop and report instead of fixing.", ko: "red 가 아니면(그 사이 트리가 바뀜) fix 를 적용하지 않고 멈춰 사용자에게 보고한다." },
  { req: "FR-FLOW-201 AC-3/AC-4", en: "confirm it is red before the fix (in the temporary worktree for a working-tree input).", ko: "재현 테스트를 한 번 돌려 red 인 것을 확인하고(`git-status` 입력이면 `repro_worktree` 에서. 사용자의 트리에서는 그 변경 때문에 이미 green 일 수 있다)" },
  { req: "FR-FLOW-201 AC-3/AC-4", en: "in `repro_worktree` for a git-status input, because the user's tree may already be green with their change", ko: "재현 테스트는 그 worktree 에서 red 여야 한다." }
];

/** kiwi-orchestrator is Korean in every rendering. */
const ORCHESTRATOR: readonly Pin[] = [
  { req: "FR-FLOW-200 AC-1", ko: "입력이 아래 표지 가운데 하나라도 분명히 지니면 버그 입력이다" },
  { req: "FR-FLOW-200 AC-2", ko: "메인의 짐작은 주지 않는다." },
  { req: "FR-FLOW-200 AC-5", ko: "**버그가 아닌 입력**은 `kiwi-bug-repro` 를 부르지 않고 Phase 1 을 지금까지와 그대로 돈다." },
  { req: "FR-FLOW-200 AC-3", ko: "같은 증상을 단언하는 테스트를 새로 쓰지 않는다" },
  { req: "FR-FLOW-200 AC-3", ko: "**건너뛰기 표시**(예: `it.skip`, `@Disabled`, `#[ignore]`, `@pytest.mark.skip`)를 단 채로 커밋한다." },
  { req: "FR-FLOW-200 AC-3", ko: "건너뛴 테스트는 실패로 세지 않으므로, 버그를 맡지 않은 wave 의 워커 회귀, wave 판정, loop P, stage 병합 회귀와 검증 도구가 그 테스트 때문에 실패하지 않고, P.4 기준선과 공용 계약도 그대로 쓴다." },
  { req: "FR-FLOW-200 AC-4", ko: "테스트 도구에 건너뛰기 표시가 없으면 빨간 테스트를 커밋하지 않고 멈춰서 사용자에게 묻는다(`bug-test-unskippable`, `--auto` 에서도)." },
  { req: "FR-FLOW-200 AC-3", ko: "건너뛰기 표시는 재현 케이스 하나에만 달고, 파일이나 묶음 전체에 달지 않는다." },
  { req: "FR-FLOW-200 AC-4", ko: "3.c′ 배정 검사는 그 재현 테스트 파일이 정확히 한 wave 의 `files[]` 에 있는지도 보고, 아니면 멈춰서 묻는다(`bug-repro-test-unresolved`, `--auto` 에서도)." },
  { req: "FR-FLOW-200 AC-3/AC-4", ko: "Phase 4 의 run 최종 검사 전에 그 재현 테스트에 건너뛰기 표시가 남아 있거나 green 이 아니면, run 을 완료로 끝내지 않고 멈춰서 보고한다(`bug-repro-test-unresolved`, `--auto` 에서도)." },
  { req: "FR-FLOW-200 AC-4", ko: "밖의 추적되는 파일에 커밋하지 않은 변경이 있으면 `kiwi-bug-repro` 를 부르지 않고 멈춰서 사용자에게 묻는다(`bug-input-dirty-tree`, `--auto` 에서도)." },
  { req: "FR-FLOW-200 AC-3", ko: "그 버그를 맡는 wave 의 선언 항목 `files[]` 에 그 재현 테스트 파일을 넣어 그 wave 의 쓰기 집합에 들이고," },
  { req: "FR-FLOW-200 AC-3", ko: "워커가 건너뛰기 표시를 걷고 제목 줄에 그 요구의 `<REQ-ID> AC-<n>` 을 단 뒤 red 를 확인하고, 고쳐서 green 으로 끝낸다." },
  { req: "FR-FLOW-200 AC-3", ko: "승급(§14) 전에 그 재현 테스트에 건너뛰기 표시가 남아 있으면 그 요구를 승급하지 않는다." },
  { req: "FR-FLOW-200 AC-4", ko: "자식이 올린 `repro-input-insufficient` 이므로 §0.4 대로 `--auto` 에서도 멈추고 그 질문을 그대로 내며," },
  { req: "FR-FLOW-200 AC-6", ko: "계속하면 그 결정(요구사항 변경으로 계속)을 `01.intake.md` 에 적고," },
  { req: "FR-FLOW-200 AC-6", ko: "계속하기로 하면 그 결정과 재현 스크립트 경로를 `01.intake.md` 에 적고 1.b 로 간다." }
];

/** kiwi-pipeline T1 and the shared pipeline-event row are Korean in every rendering. */
const NO_HINT_FOR_NO_TEST = "자동 테스트 없이 재현됨(`reproduced-no-test`)은 `null` 이다: `kiwi-hot-fix` 는 `TDD_EXEMPT_REASON` 없이 그 결과에서 멈춘다.";

const TDD: readonly Pin[] = [
  { req: "FR-FLOW-200 AC-3", en: "so it is not an artifact of this step; it is adopted after the claim, in §2.4.", ko: "이 step 의 산출물이 아니다. claim 뒤 §2.4 에서 채택한다." },
  { req: "FR-FLOW-200 AC-3", en: "write the acceptance line that fixes that symptom first (Phase 2) and adopt that reproduction test as the line's test.", ko: "그 증상을 고치는 acceptance 줄을 먼저 쓰고(Phase 2) 그 재현 테스트를 이 줄의 테스트로 채택한다." }
];

const PARALLEL_WAVES: Pin = { req: "FR-FLOW-200 AC-3", en: "It passes when `failing_tests ⊆ baseline_failing_tests` (exit 0 when the baseline capture failed).", ko: "통과는 `failing_tests ⊆ baseline_failing_tests`(기준선 캡처에 실패했으면 exit 0)다." };

describe("bug run rules pinned verbatim", () => {
  it.each(pinCases(BUG_REPRO))("%s kiwi-bug-repro (%s): %s", (rendering, _req, pin) => {
    expect(skillText(rendering, "kiwi-bug-repro")).toContain(flat(pin));
  });

  it.each(pinCases(HOT_FIX))("%s kiwi-hot-fix (%s): %s", (rendering, _req, pin) => {
    expect(skillText(rendering, "kiwi-hot-fix")).toContain(flat(pin));
  });

  it.each(pinCases(ORCHESTRATOR))("%s kiwi-orchestrator (%s): %s", (rendering, _req, pin) => {
    expect(skillText(rendering, "kiwi-orchestrator")).toContain(flat(pin));
  });

  it.each(pinCases(TDD))("%s kiwi-tdd (%s): %s", (rendering, _req, pin) => {
    expect(skillText(rendering, "kiwi-tdd")).toContain(flat(pin));
  });

  it.each(RENDERINGS.flatMap((rendering) => [`${rendering}/kiwi-pipeline/SKILL.md`, `${rendering}/_shared/kiwi/pipeline-event.md`]))("%s (FR-FLOW-199 AC-9): reproduced-no-test gets no hint", (relPath) => {
    expect(flat(readRepoFile(relPath))).toContain(NO_HINT_FOR_NO_TEST);
  });

  it.each(RENDERINGS)("%s parallel-waves (FR-FLOW-200 AC-3): the wave pass rule is the shared one, unwidened", (rendering) => {
    const text = flat(readRepoFile(`${rendering}/_shared/kiwi/parallel-waves.md`));
    expect(text).toContain(flat(isKorean(rendering) ? PARALLEL_WAVES.ko : PARALLEL_WAVES.en ?? ""));
    expect(text).not.toMatch(/baseline_failing_tests\s*∪/);
  });

  // A resumed run reads the §V entries, not §5.3, so each intake verb carries the dirty-tree stop itself.
  it.each(RENDERINGS.flatMap((rendering) => ["intake-qna", "intake-document", "intake-issue"].map((verb) => [rendering, verb] as const)))("%s §V.%s (FR-FLOW-200 AC-4/AC-6): the dirty-tree stop", (rendering, verb) => {
    const body = stripFrontmatter(readRepoFile(`${rendering}/kiwi-orchestrator/SKILL.md`).replace(/\r\n/g, "\n"));
    expect(flat(verbSection(body, verb))).toContain("(있으면 `bug-input-dirty-tree` 로 멈춘다)");
    expect(section(body, /^###\s*5\.3\b/)).not.toBe("");
  });
});

// A resumed session reads the §V entry of the step it resumes, not §5.3, so each step that applies a
// wave-route bug rule carries it there too (FR-FLOW-200 AC-6).
const RESUME_PINS: ReadonlyArray<readonly [string, string]> = [
  ["commit-run-artifacts", "R-ORCH 면 그 전에 §5.3 대로 재현 케이스 하나에만 건너뛰기 표시를 달고 기존 요구 인용을 걷는다"],
  ["decompose-waves", "재현 테스트 파일을 그 버그를 맡는 wave 하나의 `files[]` 에만 넣는다"],
  ["derive-readiness", "재현 테스트 파일이 정확히 한 wave 의 `files[]` 에 있는지도 보고, 아니면 `bug-repro-test-unresolved` 로 멈춘다"],
  ["promote-requirements", "재현 테스트에 건너뛰기 표시가 남아 있으면 그 요구를 승급하지 않는다"],
  ["final-verify", "재현 테스트에 건너뛰기 표시가 남아 있거나 green 이 아니면 run 을 완료로 끝내지 않고 `bug-repro-test-unresolved` 로 멈춘다"]
];

const BUG_GATES = /bug-not-reproduced|bug-not-a-bug|bug-input-dirty-tree|bug-test-unskippable|bug-repro-test-unresolved|repro-[a-z-]+/;
const STOP_WORD = /멈추|멈춰|멈춘|\bstops?\b|\bhalts?\b/i;

function orchestratorBody(rendering: string): string {
  return stripFrontmatter(readRepoFile(`${rendering}/kiwi-orchestrator/SKILL.md`).replace(/\r\n/g, "\n"));
}

describe("wave-route bug rules survive a resume, and no sentence anywhere carves a way around them", () => {
  it.each(RENDERINGS.flatMap((rendering) => RESUME_PINS.map(([verb, pin]) => [rendering, verb, pin] as const)))("%s §V.%s carries: %s", (rendering, verb, pin) => {
    expect(flat(verbSection(orchestratorBody(rendering), verb))).toContain(pin);
  });

  it.each(RENDERINGS)("%s kiwi-orchestrator: no sentence hands a bug stop to the decision committee", (rendering) => {
    const handed = sentencesWith(flat(orchestratorBody(rendering)), BUG_GATES, /결정 위원회|committee/i);
    expect(handed).toEqual([]);
  });

  it.each(RENDERINGS)("%s kiwi-orchestrator: every sentence about a still-skipped reproduction test refuses completion and promotion", (rendering) => {
    for (const sentence of sentencesWith(flat(orchestratorBody(rendering)), /건너뛰기 표시가 남|건너뛰어진/, /승급|완료/)) {
      expect(sentence, `${rendering}: ${sentence}`).toMatch(NEGATION);
    }
  });

  it.each(RENDERINGS)("%s kiwi-bug-repro: every sentence about a restore conflict stops", (rendering) => {
    const text = flat(stripFrontmatter(readRepoFile(`${rendering}/kiwi-bug-repro/SKILL.md`)));
    // A gate id in backticks names the conflict without stating a rule about it.
    for (const sentence of sentencesWith(text.replace(/`[^`]*`/g, "``"), /충돌|conflict/i)) {
      expect(sentence, `${rendering}: ${sentence}`).toMatch(STOP_WORD);
    }
  });

  it.each(RENDERINGS)("%s kiwi-bug-repro: no sentence lets stage 1 or 2 keep the real home", (rendering) => {
    const text = flat(stripFrontmatter(readRepoFile(`${rendering}/kiwi-bug-repro/SKILL.md`)));
    for (const sentence of sentencesWith(text, /stage 1|1단계/i, /\breal\b|실제/i, /HOME|홈/)) {
      expect(sentence, `${rendering}: ${sentence}`).toMatch(NEGATION);
    }
  });

  it.each(RENDERINGS)("%s kiwi-coder: the §0.20 family is exactly §0.20.1 to §0.20.5", (rendering) => {
    const coder = stripFrontmatter(readRepoFile(`${rendering}/kiwi-coder/SKILL.md`).replace(/\r\n/g, "\n"));
    const family = tableRows(section(coder, /^##\s*0\./)).map((row) => row.cells[0] ?? "").filter((key) => /^§0\.20\.\d+$/.test(key));
    expect(family).toEqual(["§0.20.1", "§0.20.2", "§0.20.3", "§0.20.4", "§0.20.5"]);
  });
});

const HOT_FIX_R6: readonly Pin[] = [
  { req: "FR-FLOW-201 AC-4", en: "An abandoned run does not delete or restore a reproduction test it copied into the user's tree, because the user may have edited it since the copy; it reports that path, and the files the fixer changed, instead of rolling anything back.", ko: "run 을 포기해도 이 run 이 사용자 트리에 복사한 재현 테스트는 지우지도 되돌리지도 않는다: 복사 뒤에 사용자가 고쳤을 수 있기 때문이다." },
  { req: "FR-FLOW-201 AC-4", en: "An unfinished report is not moved: the next", ko: "끝나지 않은 보고서는 옮기지 않는다" },
  { req: "FR-FLOW-201 AC-4", en: "When the user answers to reproduce again, `--resume` removes that worktree, recreates it from the current HEAD, records the new `repro_base`", ko: "사용자가 다시 재현하라고 답하면 `--resume` 은 그 worktree 를 지우고 지금 HEAD 로 다시 만들어 `repro_base` 를 새로 적은 뒤" },
  { req: "FR-FLOW-201 AC-4", en: "Compare in the user's working tree with `git diff --quiet <repro_base> -- <path>`", ko: "이 비교는 사용자의 작업 트리에서 `git diff --quiet <repro_base> -- <경로>` 로 한다" },
  { req: "FR-FLOW-201 AC-4", en: "When the input is an issue or a symptom description and the working tree holds uncommitted changes, stop and ask the user before reproducing (`repro-dirty-tree`, also under `--auto`)", ko: "작업 트리에 커밋하지 않은 변경이 있는데 입력이 이슈나 자연어 증상이면** 재현하기 전에 멈춰서 사용자에게 묻는다(`repro-dirty-tree`, `--auto` 에서도)" },
  { req: "FR-FLOW-201 AC-2", en: "When it stops with any other question (`repro-restore-conflict`, say), this skill passes that question on and stops with no fix (`bug-repro-question`, also under `--auto`).", ko: "그 밖의 질문(`repro-restore-conflict` 등)으로 멈춰도 그 질문을 그대로 내고 fix 를 적용하지 않고 멈춘다(`bug-repro-question`, `--auto` 에서도)." }
];

const BUG_REPRO_R6: readonly Pin[] = [
  { req: "FR-FLOW-199 AC-8", en: "(`.env`, `.env.*`, `*.pem`, `*.key`, `credentials*`, `application-local.*`, `appsettings.*.json`, `*.tfvars`, `.envrc`, `.npmrc`, `.pypirc`, `.netrc`, `.aws/`, `.ssh/`, `.docker/config.json`, private keys such as `id_rsa*`, and the like)", ko: "(`.env`, `.env.*`, `*.pem`, `*.key`, `credentials*`, `application-local.*`, `appsettings.*.json`, `*.tfvars`, `.envrc`, `.npmrc`, `.pypirc`, `.netrc`, `.aws/`, `.ssh/`, `.docker/config.json`, `id_rsa*` 같은 개인 키 등)" },
  { req: "FR-FLOW-199 AC-8", en: "Dependency caches stay at the real cache, so that dependencies already downloaded still resolve: point each tool's cache setting at its real path", ko: "의존성 캐시는 실제 캐시를 그대로 써서 이미 받은 의존성이 풀리게 한다: 홈을 따라 옮겨질 캐시까지 포함해 도구마다 캐시 설정을 실제 경로로 준다" },
  { req: "FR-FLOW-199 AC-8", en: "is not passed whole; only its cache directories (`caches/`, `wrapper/`, `registry/`, `git/`) are linked into the temporary home.", ko: "통째로 넘기지 않고, 그 안의 캐시 디렉토리(`caches/`, `wrapper/`, `registry/`, `git/`)만 임시 홈의 같은 자리에 링크한다." },
  { req: "FR-FLOW-199 AC-8", en: "otherwise a cut-off write cannot be told from the user's edit, so do not restore or delete it; stop and ask", ko: "그 밖에는 끊긴 쓰기인지 사용자의 수정인지 가릴 수 없으므로 되돌리지도 지우지도 않고 멈춰서 묻는다" },
  { req: "FR-FLOW-199 AC-6/AC-8", en: "On a runtime that cannot be given a temporary home, the test does not run: stop and ask as §4.3 does.", ko: "임시 홈을 줄 수 없는 런타임이면 그 테스트를 돌리지 않고 §4.3 처럼 멈춰서 묻는다." },
  { req: "FR-FLOW-199 AC-8", en: "appending `-Duser.home=<that directory>` to any value already there", ko: "`JAVA_TOOL_OPTIONS` 의 기존 값 뒤에 `-Duser.home=<그 디렉토리>` 를 덧붙인다" }
];

/** kiwi-coder is Korean in every rendering. */
const CODER: readonly Pin[] = [
  { req: "FR-FLOW-200 AC-3", ko: "kiwi-coder 는 §3.3 에서 요구 집합의 AC 를 읽을 때 각 요구의 Implementation Notes 도 읽어 이 지정을 찾고, 그 재현 테스트를 §4.1.3 테스트 작성 입력에 넣는다." },
  { req: "FR-FLOW-200 AC-3", ko: "이 채택은 §0.20 의 제거도 약화도 아니다: 표시를 걷는 것은 §0.20.3 (3) 의 반대이고, 제목 줄 인용은 단언을 바꾸지 않는다." }
];

const ORCHESTRATOR_R6: readonly Pin[] = [
  { req: "FR-FLOW-200 AC-4", ko: "질문에는 그 테스트를 건너뛰게 할 다른 방법(조건부 실행, 별도 테스트 파일 등)을 적고, 사용자가 고른 방법으로 Phase 1 커밋을 다시 한다." },
  { req: "FR-FLOW-200 AC-4", ko: "질문에는 원인(어느 wave 에도 배정되지 않음, 소유 wave 의 실패)을 적고, 사용자가 바로잡은 뒤 재개하면 같은 검사를 다시 한다." },
  { req: "FR-FLOW-200 AC-3", ko: "run 이 이 게이트나 다른 이유로 멈추거나 중단되면 리포트에 그 재현 테스트가 아직 건너뛰어진 채라고 적는다." },
  { req: "FR-FLOW-200 AC-4", ko: "Phase 1 커밋은 재현 테스트 파일과 보고서 디렉토리를 경로로 지명해 담으므로, 추적되지 않는 다른 파일은 그 커밋에 섞이지 않는다." }
];

describe("bug run rules pinned verbatim, round 6", () => {
  it.each(pinCases(HOT_FIX_R6))("%s kiwi-hot-fix (%s): %s", (rendering, _req, pin) => {
    expect(skillText(rendering, "kiwi-hot-fix")).toContain(flat(pin));
  });

  it.each(pinCases(BUG_REPRO_R6))("%s kiwi-bug-repro (%s): %s", (rendering, _req, pin) => {
    expect(skillText(rendering, "kiwi-bug-repro")).toContain(flat(pin));
  });

  it.each(pinCases(CODER))("%s kiwi-coder (%s): %s", (rendering, _req, pin) => {
    expect(skillText(rendering, "kiwi-coder")).toContain(flat(pin));
  });

  it.each(pinCases(ORCHESTRATOR_R6))("%s kiwi-orchestrator (%s): %s", (rendering, _req, pin) => {
    expect(skillText(rendering, "kiwi-orchestrator")).toContain(flat(pin));
  });

  it.each(RENDERINGS)("%s kiwi-orchestrator: bug-repro-test-unresolved is listed with the Phase 4 gates of the overview", (rendering) => {
    const overview = section(orchestratorBody(rendering), /^##\s*3\./);
    const phase4 = overview.slice(overview.search(/^Phase 4\s/m));
    expect(phase4.slice(0, phase4.search(/^Phase 5\s/m))).toContain("bug-repro-test-unresolved");
  });
});

const ORCHESTRATOR_R7: readonly Pin[] = [
  { req: "FR-FLOW-200 AC-3", ko: "커밋 전에 그 재현 테스트 제목 줄의 기존 요구 인용은 걷어 `01.intake.md` 에 옮겨 적는다: 건너뛴 테스트가 그 AC 의 테스트 충분성 근거로 잡히지 않게 하기 위해서다." },
  { req: "FR-FLOW-200 AC-4", ko: "| `bug-input-dirty-tree` | 버그 입력인데 run root 에 run 과 그 `kiwi-bug-repro` 가 쓴 것 밖의 추적되는 파일에 커밋하지 않은 변경이 있음. 그 변경이 증상을 가리거나 Phase 1 커밋에 섞일 수 있고, 커밋할지 치울지는 사용자만 정한다. 재현이 git 이 추적하지 않던 기존 파일을 고쳤을 때도 Phase 1 커밋 전에 이 게이트로 멈춘다 | Phase 1.a · Phase 1 끝 |" },
  { req: "FR-FLOW-200 AC-4", ko: "| `bug-test-unskippable` | R-ORCH 로 가는 버그 입력인데 테스트 도구에 건너뛰기 표시가 없음. 빨간 재현 테스트를 커밋하면 버그를 맡지 않은 wave 의 회귀가 모두 깨지므로, 어떻게 할지는 사용자가 정한다 | Phase 1 끝 |" },
  { req: "FR-FLOW-200 AC-4", ko: "| `bug-repro-test-unresolved` | 재현 테스트 파일이 정확히 한 wave 의 `files[]` 에 있지 않거나(3.c′), Phase 4 전에 아직 건너뛰기 표시가 남았거나 green 이 아님. 버그가 고쳐지지 않은 채 run 이 완료로 끝나지 않게 한다 | Phase 3.c′ · Phase 4 |" },
  { req: "FR-FLOW-200 AC-4", ko: "bug-input-dirty-tree C bug-test-unskippable C" }
];

const INTAKE_DIRTY = "버그 입력이면 1.b 전에, run 과 그 `kiwi-bug-repro` 가 쓴 것 밖의 추적되는 파일에 커밋하지 않은 변경이 없을 때 `kiwi-bug-repro` 를 `--no-pipeline-emit` 과 함께 부르고(있으면 `bug-input-dirty-tree` 로 멈춘다) 결과를 `01.intake.md` 에 기록한다.";

const CODER_ROW = "| §0.20.5 | **호출자가 지정한 버그 재현 테스트의 채택**. 요구의 Implementation Notes 가 기존 버그 재현 테스트를 그 요구의 실패하는 테스트로 지정하면(`kiwi-orchestrator` §5.3 의 R-ORCH), 같은 증상의 테스트를 새로 쓰지 않고 그 테스트를 채택한다. kiwi-coder 는 §3.3 에서 요구 집합의 AC 를 읽을 때 각 요구의 Implementation Notes 도 읽어 이 지정을 찾고, 그 재현 테스트를 §4.1.3 테스트 작성 입력에 넣는다. 그 재현 케이스의 건너뛰기 표시를 걷고 제목 줄에 그 요구의 `<REQ-ID> AC-<n>` 을 단 뒤 red 를 확인한다. 이 채택은 §0.20 의 제거도 약화도 아니다: 표시를 걷는 것은 §0.20.3 (3) 의 반대이고, 제목 줄 인용은 단언을 바꾸지 않는다. §4.1.2 의 분모에서 그 AC 는 이 테스트로 채워진다. |";

const HOT_FIX_R7: readonly Pin[] = [
  { req: "FR-FLOW-201 AC-4", en: "While the run waits for the user's answer (at `bug-not-reproduced`, `bug-input-insufficient`, `repro-worktree-unprepared`, `repro-path-occupied` or `repro-base-moved`), keep the worktree.", ko: "run 이 사용자 답을 기다리며 멈춘 동안(`bug-not-reproduced`, `bug-input-insufficient`, `repro-worktree-unprepared`, `repro-path-occupied`, `repro-base-moved` 의 질문)에는 worktree 를 남겨 둔다." },
  { req: "FR-FLOW-201 AC-4", en: "13. Write a report and emit a pipeline event. When the run completes, ends at `bug-not-a-bug` or is abandoned, remove the temporary worktree if there is one; keep it while the run waits for the user's answer.", ko: "run 이 완료되거나, `bug-not-a-bug` 로 끝나거나, 포기되면 `git worktree remove --force <경로>` 로 지우고 `repro_worktree` 를 비운다." },
  { req: "FR-FLOW-201 AC-4", en: "and record its path as `repro_worktree` and the sha of that HEAD as `repro_base` in `state.json`.", ko: "로 만들고 그 경로를 `state.json.repro_worktree` 에, 그 HEAD 의 sha 를 `state.json.repro_base` 에 적는다." }
];

const BUG_REPRO_R7: readonly Pin[] = [
  { req: "FR-FLOW-199 AC-8", en: "When the user confirms that run has ended and the caller passes that answer in, the hour condition no longer applies to it.", ko: "사용자가 그 실행이 끝났다고 확인하고 호출자가 그 답을 넘기면, 그 실행에는 시간 조건을 적용하지 않는다." },
  { req: "FR-FLOW-199 AC-8", en: "Dependency caches stay at the real cache, so that dependencies already downloaded still resolve: point each tool's cache setting at its real path, also for a cache that would otherwise follow the home directory (`GOMODCACHE`, `npm_config_cache`, `PIP_CACHE_DIR`, NuGet's `NUGET_PACKAGES`, and Maven's `-Dmaven.repo.local` through `MAVEN_OPTS`);", ko: "의존성 캐시는 실제 캐시를 그대로 써서 이미 받은 의존성이 풀리게 한다: 홈을 따라 옮겨질 캐시까지 포함해 도구마다 캐시 설정을 실제 경로로 준다(`GOMODCACHE`, `npm_config_cache`, `PIP_CACHE_DIR`, NuGet 의 `NUGET_PACKAGES`, `MAVEN_OPTS` 로 주는 Maven 의 `-Dmaven.repo.local`)." },
  { req: "FR-FLOW-199 AC-8", en: "the attempt first records the path before writing the file and records the hash after;", ko: "파일을 쓰기 전에 경로를 먼저 적고, 쓴 뒤에 해시를 적는다." },
  { req: "FR-FLOW-199 AC-8", en: "A runtime that does not take its home from those variables gets the temporary home through its own setting: a JVM through `JAVA_TOOL_OPTIONS`, appending `-Duser.home=<that directory>` to any value already there.", ko: "그 변수로 홈을 정하지 않는 런타임에는 그 런타임의 설정으로 임시 홈을 준다: JVM 은 `JAVA_TOOL_OPTIONS` 의 기존 값 뒤에 `-Duser.home=<그 디렉토리>` 를 덧붙인다." },
  { req: "FR-FLOW-199 AC-8", en: "When a run starts, it first looks for earlier `kiwi-bug-repro` report directories whose `state.json` does not record the run as finished", ko: "실행을 시작하면 먼저, `state.json` 에 끝났다는 기록이 없는 이전 `kiwi-bug-repro` 보고서 디렉토리를 찾는다." },
  { req: "FR-FLOW-199 AC-8", en: "Stop and ask the same way when that run's `state.json` changed within the last hour, because the run may still be going in another session.", ko: "그 실행의 `state.json` 이 최근 1시간 안에 바뀌었으면 다른 세션에서 아직 돌고 있을 수 있으므로 같은 방식으로 멈춰서 묻는다." }
];

/** The places kiwi-bug-repro names `--auto` without stating a stop: the option SSOT, the committee, the gate preamble, the option table. */
const AUTO_WITHOUT_STOP = /option SSOT|옵션 SSOT|decision committee|결정 위원회|regardless of|무관|^\|?\s*`--auto` ·|--auto --max/i;
const ALSO_WORD = /에서도|라도|as well|\btoo\b|\balso\b/i;

describe("bug run rules pinned verbatim, round 7", () => {
  it.each(pinCases(ORCHESTRATOR_R7))("%s kiwi-orchestrator (%s): %s", (rendering, _req, pin) => {
    expect(skillText(rendering, "kiwi-orchestrator")).toContain(flat(pin));
  });

  it.each(pinCases(HOT_FIX_R7))("%s kiwi-hot-fix (%s): %s", (rendering, _req, pin) => {
    expect(skillText(rendering, "kiwi-hot-fix")).toContain(flat(pin));
  });

  it.each(pinCases(BUG_REPRO_R7))("%s kiwi-bug-repro (%s): %s", (rendering, _req, pin) => {
    expect(skillText(rendering, "kiwi-bug-repro")).toContain(flat(pin));
  });

  it.each(RENDERINGS)("%s kiwi-coder (FR-FLOW-200 AC-3): the §0.20.5 row, whole", (rendering) => {
    expect(skillText(rendering, "kiwi-coder")).toContain(flat(CODER_ROW));
  });

  it("skills/claude kiwi-hot-fix (FR-FLOW-201 AC-4): the state schema carries repro_base", () => {
    expect(readRepoFile("skills/claude/kiwi-hot-fix/SKILL.md")).toContain('"repro_base": null,');
  });

  it.each(RENDERINGS.flatMap((rendering) => ["intake-qna", "intake-document", "intake-issue"].map((verb) => [rendering, verb] as const)))("%s §V.%s (FR-FLOW-200 AC-4/AC-6): the dirty-tree call sentence, whole, and every --auto sentence keeps its stop", (rendering, verb) => {
    const entry = flat(verbSection(orchestratorBody(rendering), verb));
    expect(entry).toContain(INTAKE_DIRTY);
    for (const sentence of sentencesWith(entry, /--auto(?![\w-])/).filter((candidate) => !/\[--auto\]/.test(candidate))) {
      expect(sentence, `${rendering} §V.${verb}: ${sentence}`).toMatch(ALSO_WORD);
    }
  });

  it.each(RENDERINGS)("%s kiwi-bug-repro: every sentence naming --auto states a stop that holds under it, outside the option SSOT and the committee", (rendering) => {
    const text = flat(stripFrontmatter(readRepoFile(`${rendering}/kiwi-bug-repro/SKILL.md`)));
    for (const sentence of sentencesWith(text, /--auto(?![\w-])/).filter((candidate) => !AUTO_WITHOUT_STOP.test(candidate))) {
      expect(sentence, `${rendering}: ${sentence}`).toMatch(ALSO_WORD);
      expect(sentence, `${rendering}: ${sentence}`).toMatch(STOP_WORD);
    }
  });
});

const HOT_FIX_R8: readonly Pin[] = [
  { req: "FR-FLOW-201 AC-4", en: "those changes would mix with the fix, so neither the green result nor the fix diff could be attributed.", ko: "그 변경이 fix 와 섞여 green 이 누구 덕인지, fix diff 가 무엇인지 가릴 수 없기 때문이다." },
  { req: "FR-FLOW-201 AC-4", en: "the worktree's base commit is recorded, an abandoned run rolls nothing back, and an issue input on a dirty tree stops first", ko: "대신 그 경로와 fixer 가 바꾼 파일을 리포트에 적어 사용자에게 알린다. 포기는 사용자 트리에서 아무것도 되돌리지 않는다." }
];

const ORCHESTRATOR_R8: readonly Pin[] = [
  { req: "FR-FLOW-200 AC-4", ko: "- **그 밖의 질문**: `kiwi-bug-repro` 가 결과 대신 질문(`repro-restore-conflict` 등)으로 멈추면 §0.4 대로 `--auto` 에서도 멈추고 그 질문을 그대로 내며, 사용자가 답하면 이 run 이 그 답을 입력에 더해 `kiwi-bug-repro` 를 다시 부른다." },
  { req: "FR-FLOW-200 AC-4", ko: "다만 재현이 git 이 추적하지 않던 기존 파일을 고쳤으면 그 파일에는 사용자의 커밋하지 않은 내용이 있을 수 있으므로, Phase 1 커밋 전에 멈춰서 묻는다(`bug-input-dirty-tree`, `--auto` 에서도)." },
  { req: "FR-FLOW-200 AC-4", ko: "재현 케이스가 든 기존 테스트 파일을 두 wave 이상이 고쳐야 하면 3.c′ 는 같은 게이트로 멈추고, 질문에 그 케이스를 새 테스트 파일로 떼어 낼지 적는다." },
  { req: "FR-FLOW-200 AC-4", ko: "requirement-not-ready · bug-repro-test-unresolved C" }
];

const RESUME_PINS_R8: ReadonlyArray<readonly [string, string]> = [
  ["author-wave-design", "버그 입력의 R-ORCH 면 그 버그를 맡는 wave 의 `excerpt.md` 에 재현 테스트 경로와 red 출력을 적는다(§5.3)."],
  ["register-wave-srs", "버그 입력의 R-ORCH 면 그 버그를 맡는 wave 의 요구 Implementation Notes 에 재현 테스트 경로와 red 출력을 적어 그 요구의 실패하는 테스트로 지정한다(§5.3, `kiwi-coder` §0.20.5)."]
];

const BUG_REPRO_R8: readonly Pin[] = [
  { req: "FR-FLOW-199 AC-8", en: "When the caller passes the user's answer in (for each such file: keep it as it is now, or undo it, restoring an edited file from `saved/` and deleting a created one), apply it, then record that run as finished.", ko: "호출자가 사용자의 답(그런 파일마다 지금 그대로 남길지, 아니면 되돌릴지: 고친 파일은 `saved/` 의 바이트로 되돌리고 만든 파일은 지운다)을 넘기면 그대로 적용한 뒤 그 실행을 끝났다고 적는다." }
];

const CODER_INPUT = "- 요구의 Implementation Notes 가 지정한 버그 재현 테스트(경로, 테스트 이름, red 출력) — 새로 쓰지 않고 §0.20.5 대로 채택한다";
const CLAUDE_ABANDON = "`(4) abandon` (아무것도 되돌리지 않고 종료. fixer 가 이 run 에서 바꾼 파일과 복사한 재현 테스트의 목록을 리포트에 적어 사용자가 직접 정리하게 한다)";

describe("bug run rules pinned verbatim, round 8", () => {
  it.each(pinCases(HOT_FIX_R8))("%s kiwi-hot-fix (%s): %s", (rendering, _req, pin) => {
    expect(skillText(rendering, "kiwi-hot-fix")).toContain(flat(pin));
  });

  it.each(pinCases(ORCHESTRATOR_R8))("%s kiwi-orchestrator (%s): %s", (rendering, _req, pin) => {
    expect(skillText(rendering, "kiwi-orchestrator")).toContain(flat(pin));
  });

  it.each(pinCases(BUG_REPRO_R8))("%s kiwi-bug-repro (%s): %s", (rendering, _req, pin) => {
    expect(skillText(rendering, "kiwi-bug-repro")).toContain(flat(pin));
  });

  it.each(RENDERINGS.flatMap((rendering) => RESUME_PINS_R8.map(([verb, pin]) => [rendering, verb, pin] as const)))("%s §V.%s carries: %s", (rendering, verb, pin) => {
    expect(flat(verbSection(orchestratorBody(rendering), verb))).toContain(pin);
  });

  it.each(RENDERINGS)("%s kiwi-coder §4.1.3 (FR-FLOW-200 AC-3): the test writer is handed the reproduction test", (rendering) => {
    expect(skillText(rendering, "kiwi-coder")).toContain(flat(CODER_INPUT));
  });

  it("skills/claude kiwi-hot-fix (FR-FLOW-201 AC-4): abandon rolls nothing back", () => {
    expect(skillText("skills/claude", "kiwi-hot-fix")).toContain(flat(CLAUDE_ABANDON));
  });

  it.each(RENDERINGS)("%s kiwi-hot-fix: no sentence copies into the user's tree anyway, or invokes kiwi-bug-repro there", (rendering) => {
    const text = skillText(rendering, "kiwi-hot-fix");
    expect(sentencesWith(text, /cop(y|ies)|복사/i, /anyway|그래도|regardless|상관없이/i)).toEqual([]);
    for (const sentence of sentencesWith(text, /user's (working )?tree|사용자의 (작업 )?트리/i, /invoke|부른|부르/i)) {
      expect(sentence, `${rendering}: ${sentence}`).toMatch(NEGATION);
    }
  });

  it.each(RENDERINGS)("%s kiwi-orchestrator: no sentence lets more than one wave own the reproduction test", (rendering) => {
    expect(sentencesWith(skillText(rendering, "kiwi-orchestrator"), /(두|여러|둘 이상의?|모든) wave 의 `files\[\]`|more than one wave'?s? `files\[\]`/)).toEqual([]);
  });
});

const HOT_FIX_R9: readonly Pin[] = [
  { req: "FR-FLOW-201 AC-4", en: "Go on once the user has committed or set the changes aside, or treat the input as a git-status input when the user says those changes are the fix for this bug.", ko: "사용자가 그 변경을 커밋하거나 치운 뒤 재개하면 그대로 진행하고, 그 변경이 이 버그의 fix 라고 답하면 `git-status` 입력으로 다룬다." },
  { req: "FR-FLOW-201 AC-4", en: "run for this input recorded in its `state.json` whose current hash still matches the recorded one and which that run created or found unchanged from HEAD before its edit, and that run's report directory", ko: "여기서 셀 변경은 추적되는 파일의 커밋하지 않은 변경 가운데, 이 입력에 대한 `/kiwi-bug-repro` 실행이 `state.json` 에 적은 파일 중 지금 해시가 기록된 해시와 같고 그 실행이 새로 만들었거나 고치기 전 HEAD 와 같았던 파일과, 그 실행의 보고서 디렉토리를 뺀 것이다." },
  { req: "FR-FLOW-201 AC-4", en: "and this check runs before the reproduction skill is called, `--analysis-only` included, and before an existing report is used.", ko: "이 확인은 `/kiwi-bug-repro` 를 부르기 전(`--analysis-only` 포함)과 기존 보고서를 쓰기 전에 한다." },
  { req: "FR-FLOW-201 AC-2", en: "this skill adds the answer to the input and invokes", ko: "사용자가 답하면 본 스킬이 `--resume` 에서 그 답을 입력에 더해 `/kiwi-bug-repro` 를 다시 부른다" }
];

const ORCHESTRATOR_R9: readonly Pin[] = [
  { req: "FR-FLOW-200 AC-4/AC-6", ko: "재현이 git 이 추적하지 않던 기존 파일을 고쳤으면 커밋하지 않고 `bug-input-dirty-tree` 로 멈춘다(`--auto` 에서도)." }
];

const INTAKE_ANSWER = "사용자가 `bug-not-reproduced` 나 `repro-input-insufficient` 질문, 또는 `kiwi-bug-repro` 의 그 밖의 질문(`repro-restore-conflict` 등)에 답한 뒤 재개한 run 이면 그 답을 입력에 더해 `kiwi-bug-repro` 를 다시 부른다.";

describe("bug run rules pinned verbatim, round 9", () => {
  it.each(pinCases(HOT_FIX_R9))("%s kiwi-hot-fix (%s): %s", (rendering, _req, pin) => {
    expect(skillText(rendering, "kiwi-hot-fix")).toContain(flat(pin));
  });

  it.each(pinCases(ORCHESTRATOR_R9))("%s kiwi-orchestrator (%s): %s", (rendering, _req, pin) => {
    expect(skillText(rendering, "kiwi-orchestrator")).toContain(flat(pin));
  });

  it.each(RENDERINGS.flatMap((rendering) => ["intake-qna", "intake-document", "intake-issue"].map((verb) => [rendering, verb] as const)))("%s §V.%s (FR-FLOW-200 AC-6): an answer to any kiwi-bug-repro question goes back in", (rendering, verb) => {
    expect(flat(verbSection(orchestratorBody(rendering), verb))).toContain(INTAKE_ANSWER);
  });

  it.each(RENDERINGS)("%s kiwi-hot-fix: no sentence skips the dirty-tree stop or reproduces anyway", (rendering) => {
    const text = skillText(rendering, "kiwi-hot-fix");
    expect(sentencesWith(text, /\banyway\b|그래도 /i)).toEqual([]);
    expect(sentencesWith(text, /dirty|커밋하지 않은|uncommitted/i, /skip|건너뛰|생략/i)).toEqual([]);
  });

  it.each(RENDERINGS)("%s kiwi-bug-repro: no sentence settles a stop without the user's answer", (rendering) => {
    expect(sentencesWith(skillText(rendering, "kiwi-bug-repro"), /no answer|without (an |the )?answer|답(이)? 없|답 없이/i)).toEqual([]);
  });

  it.each(RENDERINGS)("%s kiwi-orchestrator: every sentence about a file git did not track stops or refuses", (rendering) => {
    for (const sentence of sentencesWith(skillText(rendering, "kiwi-orchestrator"), /추적하지 않던|추적되지 않|untracked|did not track/i)) {
      // The subject itself ("추적하지 않던") carries a negation; strip it so only the rule's own polarity counts.
      const rule = sentence.replace(/추적하지 않던|추적되지 않는|추적되지 않|did not track/gi, "");
      expect(rule, `${rendering}: ${sentence}`).toMatch(new RegExp(`${STOP_WORD.source}|${NEGATION.source}`, "i"));
    }
  });
});

/** The kiwi-hot-fix bug gate rows, whole: an edit to a reason or a location turns this red (round 10). */
const HOT_FIX_GATE_ROWS: Readonly<Record<string, readonly string[]>> = {
  "skills/claude": [
    "| `bug-not-reproduced` | `/kiwi-bug-repro` 가 세 단계 끝까지 재현하지 못했거나, `TDD_EXEMPT_REASON` 없이 자동 테스트 없는 재현만 돌려줌. 그 스킬의 질문이나 결과를 그대로 사용자에게 내고 fix 를 적용하지 않는다 | §4.2 |",
    "| `bug-not-a-bug` | `/kiwi-bug-repro` 가 재현한 동작이 SRS 나 문서화된 계약이 정한 그대로라고 보고함. 고칠 버그가 없으므로 fix 를 적용하지 않고 요구 변경은 `/kiwi-srs` 로 안내한다 | §4.2 |",
    "| `bug-input-insufficient` | `/kiwi-bug-repro` 가 이슈를 읽을 수 없거나 기대 동작과 실제 동작이 없다고 보고함. 모자란 내용은 사용자만 안다 | §4.2 |",
    "| `repro-base-moved` | `--resume` 에서 HEAD 가 재현 worktree 의 기준 커밋(`repro_base`)과 다름. 그 사이 사용자가 커밋했으므로 지금 복사하면 그 커밋의 수정을 작업 트리에서 되돌릴 수 있다 | §4.1 |",
    "| `repro-dirty-tree` | 이슈나 자연어 증상 입력인데 작업 트리에 커밋하지 않은 변경이 있음. 그 변경이 fix 와 섞이므로, 커밋할지 치울지 그 변경이 fix 인지는 사용자가 정한다 | §4.1 |",
    "| `bug-repro-question` | `/kiwi-bug-repro` 가 결과 대신 질문(`repro-restore-conflict` 등)으로 멈춤. 답은 사용자만 갖고 있다 | §4.2 |",
    "| `repro-worktree-unprepared` | `git-status` 입력의 HEAD worktree 에 lockfile 대로 의존성을 준비할 수 없음. 설치 방법과 환경은 사용자만 안다 | §4.1 |",
    "| `repro-path-occupied` | 재현 테스트나 보고서를 복사할 경로에 사용자 트리의 파일이 이미 있음. 복사하면 사용자의 커밋하지 않은 수정을 덮어쓴다 | §4.1 |"
  ],
  "skills/codex": [
    "| `bug-not-reproduced` | `$kiwi-bug-repro` used all three stages without reproducing the symptom, or reproduced it without an automated test and no `TDD_EXEMPT_REASON` was given; its question or outcome goes to the user and no fix is applied | after the reproduction |",
    "| `bug-not-a-bug` | `$kiwi-bug-repro` found the reproduced behaviour is what the SRS or a documented contract specifies; no fix is applied and a requirement change goes to `$kiwi-srs` | after the reproduction |",
    "| `bug-input-insufficient` | `$kiwi-bug-repro` could not read the issue or found neither the expected nor the actual behaviour; only the user holds what is missing | after the reproduction |",
    "| `repro-base-moved` | on `--resume`, HEAD differs from the reproduction worktree's base commit (`repro_base`); copying now could undo a commit the user made while the run waited | after the reproduction |",
    "| `repro-dirty-tree` | an issue or symptom input arrived on a working tree with uncommitted changes, which would mix with the fix; only the user decides whether to commit them, set them aside or call them the fix | before the reproduction or before an existing report is used |",
    "| `bug-repro-question` | `$kiwi-bug-repro` stopped with a question (`repro-restore-conflict`, say) instead of an outcome; only the user holds the answer | after the reproduction |",
    "| `repro-worktree-unprepared` | the HEAD worktree of a git-status input cannot get its dependencies from the lockfile; only the user knows how to install them | before the reproduction |",
    "| `repro-path-occupied` | a path the reproduction test or report would be copied to already holds a file in the user's tree; copying would overwrite their uncommitted edits | after the reproduction |"
  ],
  "skills/etc": [
    "| `bug-not-reproduced` | `kiwi-bug-repro` used all three stages without reproducing the symptom, or reproduced it without an automated test and no `TDD_EXEMPT_REASON` was given; its question or outcome goes to the user and no fix is applied | after the reproduction |",
    "| `bug-not-a-bug` | `kiwi-bug-repro` found the reproduced behaviour is what the SRS or a documented contract specifies; no fix is applied and a requirement change goes to `kiwi-srs` | after the reproduction |",
    "| `bug-input-insufficient` | `kiwi-bug-repro` could not read the issue or found neither the expected nor the actual behaviour; only the user holds what is missing | after the reproduction |",
    "| `repro-base-moved` | on `--resume`, HEAD differs from the reproduction worktree's base commit (`repro_base`); copying now could undo a commit the user made while the run waited | after the reproduction |",
    "| `repro-dirty-tree` | an issue or symptom input arrived on a working tree with uncommitted changes, which would mix with the fix; only the user decides whether to commit them, set them aside or call them the fix | before the reproduction or before an existing report is used |",
    "| `bug-repro-question` | `kiwi-bug-repro` stopped with a question (`repro-restore-conflict`, say) instead of an outcome; only the user holds the answer | after the reproduction |",
    "| `repro-worktree-unprepared` | the HEAD worktree of a git-status input cannot get its dependencies from the lockfile; only the user knows how to install them | before the reproduction |",
    "| `repro-path-occupied` | a path the reproduction test or report would be copied to already holds a file in the user's tree; copying would overwrite their uncommitted edits | after the reproduction |"
  ],
  ".agents/skills": [
    "| `bug-not-reproduced` | `$kiwi-bug-repro` used all three stages without reproducing the symptom, or reproduced it without an automated test and no `TDD_EXEMPT_REASON` was given; its question or outcome goes to the user and no fix is applied | after the reproduction |",
    "| `bug-not-a-bug` | `$kiwi-bug-repro` found the reproduced behaviour is what the SRS or a documented contract specifies; no fix is applied and a requirement change goes to `$kiwi-srs` | after the reproduction |",
    "| `bug-input-insufficient` | `$kiwi-bug-repro` could not read the issue or found neither the expected nor the actual behaviour; only the user holds what is missing | after the reproduction |",
    "| `repro-base-moved` | on `--resume`, HEAD differs from the reproduction worktree's base commit (`repro_base`); copying now could undo a commit the user made while the run waited | after the reproduction |",
    "| `repro-dirty-tree` | an issue or symptom input arrived on a working tree with uncommitted changes, which would mix with the fix; only the user decides whether to commit them, set them aside or call them the fix | before the reproduction or before an existing report is used |",
    "| `bug-repro-question` | `$kiwi-bug-repro` stopped with a question (`repro-restore-conflict`, say) instead of an outcome; only the user holds the answer | after the reproduction |",
    "| `repro-worktree-unprepared` | the HEAD worktree of a git-status input cannot get its dependencies from the lockfile; only the user knows how to install them | before the reproduction |",
    "| `repro-path-occupied` | a path the reproduction test or report would be copied to already holds a file in the user's tree; copying would overwrite their uncommitted edits | after the reproduction |"
  ]
};

const REPRO_TERMS = /재현|reproduc|repro-|bug-|버그/i;
const AUTO_HOLDS = /에서도|라도|as well|\btoo\b|\balso\b|regardless|무관|넘기지 못|도 넘기지/i;
// A call example in a code fence and kiwi-bug-repro §0.7 (a business decision goes to the committee) name
// the flag without carving out a stop.
const AUTO_NAMES_ONLY = /```|business[- ]decision|\[--auto\]|\{auto\}|전파|propagate|^\|?\s*`--auto`\s*(·|\|)/i;

/** Sentences of a bug-run skill that name `--auto` about the reproduction without saying the stop holds under it. */
function autoCarveOuts(text: string): string[] {
  return sentencesWith(text, /--auto(?![\w-])/, REPRO_TERMS).filter((sentence) => !AUTO_NAMES_ONLY.test(sentence) && !AUTO_HOLDS.test(sentence));
}

describe("bug run rules pinned verbatim, round 10", () => {
  it.each(Object.keys(HOT_FIX_GATE_ROWS))("%s kiwi-hot-fix: the bug gate rows, whole", (rendering) => {
    const text = readRepoFile(`${rendering}/kiwi-hot-fix/SKILL.md`).replace(/\r\n/g, "\n");
    for (const row of HOT_FIX_GATE_ROWS[rendering] ?? []) expect(text).toContain(row);
  });

  it.each(RENDERINGS.flatMap((rendering) => ["kiwi-hot-fix", "kiwi-orchestrator", "kiwi-coder", "kiwi-bug-repro"].map((skill) => [rendering, skill] as const)))("%s %s: no sentence about the reproduction carves out --auto", (rendering, skill) => {
    expect(autoCarveOuts(skillText(rendering, skill))).toEqual([]);
  });
});

/**
 * Rules that end their line, pinned with the line end: a sentence appended after them ("`--auto` 면 적지
 * 않아도 된다") names no reproduction term a word-level guard could catch, but it lands between the rule and
 * the line end (round 11).
 */
const LINE_END_PINS: ReadonlyArray<{ readonly skill: string; readonly ko: string; readonly en?: string }> = [
  { skill: "kiwi-orchestrator", ko: "버그 입력의 R-ORCH 면 그 버그를 맡는 wave 의 `excerpt.md` 에 재현 테스트 경로와 red 출력을 적는다(§5.3)." },
  { skill: "kiwi-orchestrator", ko: "버그 입력의 R-ORCH 면 그 버그를 맡는 wave 의 요구 Implementation Notes 에 재현 테스트 경로와 red 출력을 적어 그 요구의 실패하는 테스트로 지정한다(§5.3, `kiwi-coder` §0.20.5)." },
  { skill: "kiwi-orchestrator", ko: "재현이 git 이 추적하지 않던 기존 파일을 고쳤으면 커밋하지 않고 `bug-input-dirty-tree` 로 멈춘다(`--auto` 에서도). 사용자가 그 파일을 함께 커밋해도 된다고 답하면 그대로 커밋하고, 아니라고 답하면 그 파일을 커밋하지 않은 채 사용자가 재현 케이스를 정리한 뒤 재개하게 한다. 재개하면 `01.intake.md` 의 재현 기록을 지우고 `kiwi-bug-repro` 를 다시 부른다." },
  { skill: "kiwi-orchestrator", ko: "버그 입력의 R-ORCH 면 재현 테스트 파일을 그 버그를 맡는 wave 하나의 `files[]` 에만 넣는다(§5.3)." },
  { skill: "kiwi-orchestrator", ko: "버그 입력의 R-ORCH 면 재현 테스트 파일이 정확히 한 wave 의 `files[]` 에 있는지도 보고, 아니면 `bug-repro-test-unresolved` 로 멈춘다(`--auto` 에서도)." },
  { skill: "kiwi-orchestrator", ko: "버그 입력의 R-ORCH 면 재현 테스트에 건너뛰기 표시가 남아 있으면 그 요구를 승급하지 않는다(§5.3)." },
  { skill: "kiwi-orchestrator", ko: "버그 입력의 R-ORCH 면 이 라운드 전에 재현 테스트에 건너뛰기 표시가 남아 있거나 green 이 아니면 run 을 완료로 끝내지 않고 `bug-repro-test-unresolved` 로 멈춘다(`--auto` 에서도)." },
  { skill: "kiwi-coder", ko: "- 요구의 Implementation Notes 가 지정한 버그 재현 테스트(경로, 테스트 이름, red 출력) — 새로 쓰지 않고 §0.20.5 대로 채택한다" },
  { skill: "kiwi-hot-fix", ko: "사용자가 그 변경을 커밋하거나 치운 뒤 재개하면 그대로 진행하고, 그 변경이 이 버그의 fix 라고 답하면 `git-status` 입력으로 다룬다.", en: "Also: the worktree's base commit is recorded, an abandoned run rolls nothing back, and an issue input on a dirty tree stops first." }
];

describe("bug run rules pinned to the end of their line, round 11", () => {
  it.each(RENDERINGS.flatMap((rendering) => LINE_END_PINS.map((pin) => [rendering, pin.skill, isKorean(rendering) || pin.en === undefined ? pin.ko : pin.en] as const)))("%s %s: %s", (rendering, skill, pin) => {
    const raw = markdownFiles(rendering, skill).map((relPath) => readRepoFile(relPath).replace(/\r\n/g, "\n")).join("\n");
    expect(raw).toContain(`${pin}\n`);
  });
});

describe("bug run rules pinned verbatim, round 12", () => {
  it.each(RENDERINGS)("%s kiwi-orchestrator §5.3 (FR-FLOW-200 AC-4): how an answer to the untracked-file stop is applied", (rendering) => {
    expect(skillText(rendering, "kiwi-orchestrator")).toContain(flat("다만 재현이 git 이 추적하지 않던 기존 파일을 고쳤으면 그 파일에는 사용자의 커밋하지 않은 내용이 있을 수 있으므로, Phase 1 커밋 전에 멈춰서 묻는다(`bug-input-dirty-tree`, `--auto` 에서도). 사용자가 그 파일을 함께 커밋해도 된다고 답하면 그대로 커밋하고, 아니라고 답하면 그 파일을 커밋하지 않은 채 사용자가 재현 케이스를 정리한 뒤 재개하게 한다. 재개하면 `01.intake.md` 의 재현 기록을 지우고 `kiwi-bug-repro` 를 다시 부른다."));
  });
});

const BUG_REPRO_R13: readonly Pin[] = [
  { req: "FR-FLOW-199 AC-8", en: "for an existing file it also records whether that file was unchanged from HEAD before the edit (`git diff --quiet HEAD -- <path>`);", ko: "이미 있던 파일이면 고치기 전에 그 파일이 HEAD 와 같았는지(`git diff --quiet HEAD -- <경로>`)도 적는다." },
  { req: "FR-FLOW-199 AC-8", en: "Never add a case to an existing file git does not track: it may hold the user's uncommitted work; write a new test file instead, or stop and ask when the conventions allow no new file.", ko: "git 이 추적하지 않는 기존 파일에는 케이스를 더하지 않는다: 그 파일에는 사용자의 커밋하지 않은 작업이 있을 수 있으므로 새 테스트 파일에 쓰고, 규칙상 새 파일을 둘 수 없으면 멈춰서 묻는다." }
];

describe("bug run rules pinned verbatim, round 13", () => {
  it.each(pinCases(BUG_REPRO_R13))("%s kiwi-bug-repro (%s): %s", (rendering, _req, pin) => {
    expect(skillText(rendering, "kiwi-bug-repro")).toContain(flat(pin));
  });
});

/**
 * The sections this feature wrote, each held by a digest of its flattened text (round 14). A word-level
 * guard can always be stepped around by a new sentence that avoids its vocabulary ("the dirty-tree check
 * does not apply", "재개한 run 은 그 멈춤을 다시 하지 않고 커밋한다"); a digest cannot. An intended edit
 * changes the digest here in the same commit, and the reviewer of that commit sees both.
 */
const SECTION_DIGESTS: Readonly<Record<string, Readonly<Record<string, { readonly file: string; readonly digest: string }>>>> = {
  "skills/claude": {
    "kiwi-bug-repro body": {
      "file": "kiwi-bug-repro/SKILL.md",
      "digest": "ea2ab5b4486922e1"
    },
    "kiwi-orchestrator §5.3": {
      "file": "kiwi-orchestrator/SKILL.md",
      "digest": "e0e7d9c756705a68"
    },
    "kiwi-orchestrator §V.commit-run-artifacts": {
      "file": "kiwi-orchestrator/SKILL.md",
      "digest": "d127711d3421b6fc"
    },
    "kiwi-orchestrator §V.intake-qna": {
      "file": "kiwi-orchestrator/SKILL.md",
      "digest": "224b9869262e09a2"
    },
    "kiwi-orchestrator §V.intake-document": {
      "file": "kiwi-orchestrator/SKILL.md",
      "digest": "d0f43b6fad5253de"
    },
    "kiwi-orchestrator §V.intake-issue": {
      "file": "kiwi-orchestrator/SKILL.md",
      "digest": "ecd2cca86d7c62cb"
    },
    "kiwi-orchestrator §V.decompose-waves": {
      "file": "kiwi-orchestrator/SKILL.md",
      "digest": "1145fc08bee4b37b"
    },
    "kiwi-orchestrator §V.author-wave-design": {
      "file": "kiwi-orchestrator/SKILL.md",
      "digest": "28214473196915ff"
    },
    "kiwi-orchestrator §V.register-wave-srs": {
      "file": "kiwi-orchestrator/SKILL.md",
      "digest": "952575b137699783"
    },
    "kiwi-orchestrator §V.derive-readiness": {
      "file": "kiwi-orchestrator/SKILL.md",
      "digest": "502102dcb38f6028"
    },
    "kiwi-orchestrator §V.promote-requirements": {
      "file": "kiwi-orchestrator/SKILL.md",
      "digest": "6c8b65f792405bbe"
    },
    "kiwi-hot-fix §4 (claude) / Root Cause And Reproduction": {
      "file": "kiwi-hot-fix/SKILL.md",
      "digest": "87e83019449c3b0f"
    }
  },
  "skills/codex": {
    "kiwi-bug-repro body": {
      "file": "kiwi-bug-repro/SKILL.md",
      "digest": "2f4db70de986e227"
    },
    "kiwi-orchestrator §5.3": {
      "file": "kiwi-orchestrator/SKILL.md",
      "digest": "e0e7d9c756705a68"
    },
    "kiwi-orchestrator §V.commit-run-artifacts": {
      "file": "kiwi-orchestrator/SKILL.md",
      "digest": "d127711d3421b6fc"
    },
    "kiwi-orchestrator §V.intake-qna": {
      "file": "kiwi-orchestrator/SKILL.md",
      "digest": "224b9869262e09a2"
    },
    "kiwi-orchestrator §V.intake-document": {
      "file": "kiwi-orchestrator/SKILL.md",
      "digest": "d0f43b6fad5253de"
    },
    "kiwi-orchestrator §V.intake-issue": {
      "file": "kiwi-orchestrator/SKILL.md",
      "digest": "b475b412fc060bfc"
    },
    "kiwi-orchestrator §V.decompose-waves": {
      "file": "kiwi-orchestrator/SKILL.md",
      "digest": "1145fc08bee4b37b"
    },
    "kiwi-orchestrator §V.author-wave-design": {
      "file": "kiwi-orchestrator/SKILL.md",
      "digest": "28214473196915ff"
    },
    "kiwi-orchestrator §V.register-wave-srs": {
      "file": "kiwi-orchestrator/SKILL.md",
      "digest": "b91e5acbb0f1ade9"
    },
    "kiwi-orchestrator §V.derive-readiness": {
      "file": "kiwi-orchestrator/SKILL.md",
      "digest": "502102dcb38f6028"
    },
    "kiwi-orchestrator §V.promote-requirements": {
      "file": "kiwi-orchestrator/SKILL.md",
      "digest": "6c8b65f792405bbe"
    },
    "kiwi-hot-fix §4 (claude) / Root Cause And Reproduction": {
      "file": "kiwi-hot-fix/references/extended-workflow.md",
      "digest": "30b1faa8002db589"
    },
    "kiwi-hot-fix Workflow (codex, etc)": {
      "file": "kiwi-hot-fix/SKILL.md",
      "digest": "e0aa81f7277ca13b"
    }
  },
  "skills/etc": {
    "kiwi-bug-repro body": {
      "file": "kiwi-bug-repro/SKILL.md",
      "digest": "3c8a6536a51503fc"
    },
    "kiwi-orchestrator §5.3": {
      "file": "kiwi-orchestrator/SKILL.md",
      "digest": "e0e7d9c756705a68"
    },
    "kiwi-orchestrator §V.commit-run-artifacts": {
      "file": "kiwi-orchestrator/SKILL.md",
      "digest": "d127711d3421b6fc"
    },
    "kiwi-orchestrator §V.intake-qna": {
      "file": "kiwi-orchestrator/SKILL.md",
      "digest": "224b9869262e09a2"
    },
    "kiwi-orchestrator §V.intake-document": {
      "file": "kiwi-orchestrator/SKILL.md",
      "digest": "d0f43b6fad5253de"
    },
    "kiwi-orchestrator §V.intake-issue": {
      "file": "kiwi-orchestrator/SKILL.md",
      "digest": "b475b412fc060bfc"
    },
    "kiwi-orchestrator §V.decompose-waves": {
      "file": "kiwi-orchestrator/SKILL.md",
      "digest": "1145fc08bee4b37b"
    },
    "kiwi-orchestrator §V.author-wave-design": {
      "file": "kiwi-orchestrator/SKILL.md",
      "digest": "28214473196915ff"
    },
    "kiwi-orchestrator §V.register-wave-srs": {
      "file": "kiwi-orchestrator/SKILL.md",
      "digest": "b91e5acbb0f1ade9"
    },
    "kiwi-orchestrator §V.derive-readiness": {
      "file": "kiwi-orchestrator/SKILL.md",
      "digest": "502102dcb38f6028"
    },
    "kiwi-orchestrator §V.promote-requirements": {
      "file": "kiwi-orchestrator/SKILL.md",
      "digest": "6c8b65f792405bbe"
    },
    "kiwi-hot-fix §4 (claude) / Root Cause And Reproduction": {
      "file": "kiwi-hot-fix/references/extended-workflow.md",
      "digest": "3b665880c62aa2d1"
    },
    "kiwi-hot-fix Workflow (codex, etc)": {
      "file": "kiwi-hot-fix/SKILL.md",
      "digest": "5b46351c782467ea"
    }
  },
  ".agents/skills": {
    "kiwi-bug-repro body": {
      "file": "kiwi-bug-repro/SKILL.md",
      "digest": "2f4db70de986e227"
    },
    "kiwi-orchestrator §5.3": {
      "file": "kiwi-orchestrator/SKILL.md",
      "digest": "e0e7d9c756705a68"
    },
    "kiwi-orchestrator §V.commit-run-artifacts": {
      "file": "kiwi-orchestrator/SKILL.md",
      "digest": "d127711d3421b6fc"
    },
    "kiwi-orchestrator §V.intake-qna": {
      "file": "kiwi-orchestrator/SKILL.md",
      "digest": "224b9869262e09a2"
    },
    "kiwi-orchestrator §V.intake-document": {
      "file": "kiwi-orchestrator/SKILL.md",
      "digest": "d0f43b6fad5253de"
    },
    "kiwi-orchestrator §V.intake-issue": {
      "file": "kiwi-orchestrator/SKILL.md",
      "digest": "b475b412fc060bfc"
    },
    "kiwi-orchestrator §V.decompose-waves": {
      "file": "kiwi-orchestrator/SKILL.md",
      "digest": "1145fc08bee4b37b"
    },
    "kiwi-orchestrator §V.author-wave-design": {
      "file": "kiwi-orchestrator/SKILL.md",
      "digest": "28214473196915ff"
    },
    "kiwi-orchestrator §V.register-wave-srs": {
      "file": "kiwi-orchestrator/SKILL.md",
      "digest": "b91e5acbb0f1ade9"
    },
    "kiwi-orchestrator §V.derive-readiness": {
      "file": "kiwi-orchestrator/SKILL.md",
      "digest": "502102dcb38f6028"
    },
    "kiwi-orchestrator §V.promote-requirements": {
      "file": "kiwi-orchestrator/SKILL.md",
      "digest": "6c8b65f792405bbe"
    },
    "kiwi-hot-fix §4 (claude) / Root Cause And Reproduction": {
      "file": "kiwi-hot-fix/references/extended-workflow.md",
      "digest": "30b1faa8002db589"
    },
    "kiwi-hot-fix Workflow (codex, etc)": {
      "file": "kiwi-hot-fix/SKILL.md",
      "digest": "e0aa81f7277ca13b"
    }
  }
};

function sectionOf(rendering: string, key: string, body: string): string {
  if (key === "kiwi-bug-repro body") return stripFrontmatter(body);
  if (key === "kiwi-orchestrator §5.3") return section(body, /^###\s*5\.3\b/);
  if (key.startsWith("kiwi-orchestrator §V.")) return verbSection(body, key.slice("kiwi-orchestrator §V.".length));
  if (key.startsWith("kiwi-hot-fix §4")) return rendering === "skills/claude" ? section(body, /^##\s*4\./) : section(body, /^##\s*Root Cause And Reproduction\b/);
  return section(body, /^##\s*Workflow\b/);
}

describe("bug run sections pinned by digest, round 14", () => {
  it.each(Object.entries(SECTION_DIGESTS).flatMap(([rendering, sections]) => Object.entries(sections).map(([key, pin]) => [rendering, key, pin] as const)))("%s %s", (rendering, key, pin) => {
    const body = readRepoFile(`${rendering}/${pin.file}`).replace(/\r\n/g, "\n");
    const text = flat(sectionOf(rendering, key, body)).trim();
    expect(text, `${rendering} ${key}: the section is empty`).not.toBe("");
    expect(createHash("sha256").update(text).digest("hex").slice(0, 16), `${rendering} ${key} changed; review the edit and update its digest here`).toBe(pin.digest);
  });
});
