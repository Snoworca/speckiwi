---
name: kiwi-pipeline
description: "kiwi-* 스킬 파이프라인 메타 오케스트레이터. ./kiwi/pipeline.jsonl 의 직전 이벤트를 읽어 다음 단계를 추천하고, 사용자 게이트 후 자동 진행한다. 결정표 T1 (직전 skill × status → next_hint) 적용 + AskUserQuestion 다지선다 + --auto 모드 자동 진행 (FAILED/NEEDS_USER 는 자동 진행 차단). jsonl 부재 시 시작 후보 (kiwi-srs / kiwi-srs-from-code) 제안. 마지막 N 이벤트 통계 출력 (스킬별 횟수 / 평균 소요 / 마지막 실행 시각). 트리거 — kiwi pipeline, 파이프라인 상태, 다음 단계 추천, kiwi 다음 뭐 해, pipeline status, kiwi next step, 파이프라인 진행, kiwi 자동 진행, pipeline resume, 다음 스킬 추천. 옵션 — --auto (사용자 게이트 우회 자동 진행), --tail=N (마지막 N 이벤트 표시), --stats (통계만 출력), --run (추천 후보 즉시 실행)."
---
> Kiwi MCP rule: normal target-scoped SRS reads, mutations, validation, status/stability updates, acceptance-criteria changes, evidence, trace links, and completed-work logging require working `speckiwi mcp`. CLI is diagnostic/remediation only and is not a normal replacement for MCP mutations.
# kiwi-pipeline v0.1

`kiwi-*` 스킬 시리즈의 **파이프라인 상태 추적·다음 단계 추천·자동 진행** 메타 스킬. SSOT 는 `./kiwi/pipeline.jsonl` (cwd-relative append-only JSONL).

이 스킬은 *직접 작업을 수행하지 않는다* — 다른 kiwi-* 스킬의 호출 순서를 사용자에게 권고하거나 (`--auto` 시) 직접 spawn 한다.

본 스킬의 책임:
1. `pipeline.jsonl` 읽기 (마지막 N 줄)
2. 직전 이벤트 분석 → 다음 단계 후보 도출 (Table T1)
3. 사용자 게이트 (`AskUserQuestion`) 또는 자동 진행
4. 자기 실행도 1줄 이벤트로 jsonl 에 append

---

## 0. 공통 규약 (SSOT)

| 키 | 규칙 |
|---|---|
| §0.1 | **이벤트 SSOT**: `~/.claude/skills/_shared/kiwi/pipeline-event.md` v1.0.0 가 schema·파일위치·emit 규칙의 SSOT. 본 문서는 *read·다음 단계 추천* 만 담당. |
| §0.2 | **자기 mutation 금지**: 본 스킬은 speckiwi MCP / 파일 시스템 / git 어느 것도 mutation 하지 않는다. 유일한 부작용 = `pipeline.jsonl` 에 자기 실행 1줄 append. |
| §0.3 | **/snoworca-\* 호출 절대 금지**. kiwi-* 시리즈 호출만 (Skill 도구 사용). |
| §0.4 | **--auto 안전 게이트**: 직전 이벤트 `status ∈ {NEEDS_USER, FAILED}` 시 --auto 라도 자동 진행 차단 + 사용자 결정 강제. |
| §0.5 | **자기 무한 루프 방지**: 본 스킬의 `next_hint` 가 `kiwi-pipeline` 인 경우 자동 진행 불가 (사용자 확인 의무). 직전 직전 이벤트도 `kiwi-pipeline` 이면 ERROR. |
| §0.6 | **CLAUDE.md §6 시그니처 금지** + **§7 변경 이력 금지**. 본 스킬 본문에 변경 이력 섹션 없음 — git history 가 SSOT. |
| §0.7 | **사용자 확인 의무**: 추천 후보 ≥2 개 / next_hint = null / 자기 호출 충돌 / schema major mismatch — 모두 `AskUserQuestion` 단일 호출 분해. `--cycle` 진입은 "추천 후보 ≥2 개" 항목에서 제외한다 (§6.2). |
| §0.8 | **best-effort emit**: 자기 jsonl emit 실패가 본 작업 (추천 출력) 의 실패로 이어지면 안 됨. emit 실패 시 stderr WARN. |
| §0.9 | **외부 스킬 spawn 모드**: `--auto --run` 시 추천 스킬을 `Skill` 도구로 호출. 추가 옵션은 prompt 끝에 인계. |
| §0.10 | **`--auto` 옵션 SSOT**. 본 스킬은 `_shared/kiwi/auto-option.md` v1.0 을 따른다. `--auto` / `--auto --run` 의 본 스킬 고유 spawn 시맨틱(§0.4 / §0.5 / §0.9 / §6.1~§6.5) 은 보존되며, SSOT 는 게이트 결정 채널만 정규화한다. 본 스킬의 `critical_gates[]` 는 §0.AG (아래) 참조 |
| §0.11 | **`--mini` / `--loops N` 옵션 SSOT**. 본 스킬은 `_shared/kiwi/loop-option.md` v1.0 을 따른다. `--mini` = 검증-개선 루프 라운드 상한 3, `--loops N` = 라운드 상한 N(정수 ≥1). 동시 지정 시 **`--loops` 우선(경고)**. `--max` 와 직교(조합). 상한 도달 시 잔여 finding 보고(안전 게이트 불우회) |
| §7 참고 | `--mini`/`--loops N` 를 spawn 하는 모든 kiwi 하위 스킬에 전파 (loop-option.md §6) |

### §0.AG — `--auto` critical_gates[] 선언

본 스킬의 `--auto` 활성 시 사용자 강제 HALT 게이트 (SSOT `auto-option.md` §5 인터페이스 준수). 아래 게이트는 `--auto` 무관 항상 사용자 결정 필요 — 자동 결정 서브에이전트로 우회 금지:

| gate_id | reason | 발생 위치 |
|---|---|---|
| `pipeline-event-needs-user-or-failed` | 직전 이벤트 `status ∈ {NEEDS_USER, FAILED}` 시 자동 진행 차단 (§0.4) | §0.4 / §6.3 / §6.4 |
| `self-recursive-spawn` | `next_hint == kiwi-pipeline` 또는 직전 이벤트가 `kiwi-pipeline` 인 경우 자기 무한 루프 방지 (§0.5 / §6.5) | §0.5 / §6.5 |
| `multi-candidate-ambiguous` | 다음 단계 후보 ≥2 개 — 사용자 의도 모호로 자동 결정 금지 (§0.7 / §6.2). **`--cycle` 진입에는 비적용** — 사이클 모드의 다음 단계는 §2.5 체인으로 고정되어 선택 자체가 없으므로 "사용자 의도 모호" 전제가 성립하지 않는다 | §6.2 |
| `pipeline-start-candidate-ambiguous` | jsonl 부재 시 시작 후보 (kiwi-srs / kiwi-srs-from-code) 자동 결정 불가 — 사용자 의도 모호 (§3) | §3 (Phase 0) |
| `pipeline-schema-major-mismatch` | `schema_version` major mismatch 발견 (§4 schema 검증) | §4 (Phase 1) |

**비-critical (auto 자동 결정 적용 대상)**: 후보 1개 + 명확 / `next_hint == null` 종료 보고 / 통계 출력 — 이들은 사용자 게이트 없이 자동 진행 (단 종료 보고는 critical 아님 — §5.3).

---

## 1. 입력 / 출력

### 1.1 필수 입력

(없음) — pipeline.jsonl 의 마지막 이벤트로부터 자동 추론.

### 1.2 선택 입력 + 자연어 매핑

| 자연어 신호 | 인자 | 기본값 |
|---|---|---|
| "자동", "auto", "묻지 말고", "바로" | `--auto` (SSOT: auto-option.md v1.0) | off |
| "마지막 N 개", "tail N" | `--tail=N` | 10 |
| "통계만", "stats" | `--stats` | off (추천 + 통계 모두 출력) |
| "실행해", "run", "진행해" | `--run` | off (추천만 출력) |
| "이전 단계로", "이전" | `--prev` | off (마지막 이벤트 무시하고 그 직전으로) |
| "풀 사이클", "처음부터 끝까지", "연구부터 구현까지", "cycle" | `--cycle` (전체 연구→구현 사이클 오케스트레이션 §2.5) | off (단일 다음-단계 추천) |
| "중간부터", "feasibility 부터", "계획부터" | `--from=<stage>` (skip-authoring 진입 §2.5.2) | off (kiwi-srs 부터) |
| "연구 문서로", "리서치 문서 첨부" | 연구 문서 경로 (research document → `/kiwi-srs` passthrough §7.2) | (없음) |
| "max 모드", "고강도" | `--max` (모든 하위 스킬로 전파 §7.1) | off |
| "워크트리에서", "격리해서", "worktree isolation" | `--wt` (전용 git worktree 격리 사이클 §2.6) | off |
| "미니 모드", "빠른 모드", "3라운드" | `--mini` (모든 하위 스킬로 전파 §7.3) | off (스킬 기본 상한) |
| "루프 N회", "N라운드", "N번 돌려" | `--loops N` (모든 하위 스킬로 전파 §7.3) | off (스킬 기본 상한) |
| "이 REQ 만", "미해소 요구만 다시" | `--req-filter <REQ-ID[,…]>` (재진입 범위 한정 §7) | off (계획 전체) |
| "같은 계획으로", "plan run 재사용" | `--plan-run-id <id>` (기존 계획 run 재사용 §7) | off (새 run) |
| "target X 로", "이 target 만" | `--target <target>` (그 사이클의 SRS target 명시 §7) | `get_active_target` |

옵션 매트릭스:
- `--stats` 단독 → 통계만, 추천·실행 없음
- `--run` 단독 → 추천 + 사용자 게이트 → 선택 시 spawn
- `--auto --run` → 추천 후보가 명확하면 즉시 spawn (FAILED/NEEDS_USER 시 차단)
- `--auto` 단독 (--run 없음, `--cycle` 미지정) → 추천만 자동 결정 (다지선다 게이트 skip), 실행은 안 함
- `--cycle` 진입 (`--run` 미지정) → `--run` **암묵 활성** (§2.5) — 사이클 진입은 추천 출력에 그치지 않고 §2.5 체인의 각 단계를 직접 spawn 한다. 위 `--auto` 단독 줄은 `--cycle` 진입에 적용되지 않는다

### 1.3 출력

- **대화 메시지** (파일 아님):
  - 직전 이벤트 요약
  - 추천 다음 단계 (단일 / 다지선다 / 종료)
  - 통계 (스킬별 실행 횟수 / 평균 duration / 마지막 실행 시각)
  - 다음 행동 (사용자 결정 또는 자동 spawn)
- **Pipeline event append** (의무): 본 호출도 1줄 이벤트로 `pipeline.jsonl` 에 기록
- **마커 파일**: `{pipeline_dir}/.pipeline-path` (절대 경로 1줄, 같은 cwd 의 모든 스킬이 동일 경로 사용)

---

## 2. Phase 흐름

```
Phase 0  : 파일 경로 해석 + jsonl read (마지막 N 줄)
Phase 1  : 직전 이벤트 파싱 + schema 검증
Phase 2  : 다음 단계 후보 도출 (Table T1)
Phase 3  : 사용자 게이트 또는 자동 결정
Phase 4  : (--run 시) 선택된 스킬 spawn
Phase 5  : 통계 출력 + 자기 이벤트 emit
```

`--cycle` 활성 시 위 Phase 0~5 는 단일 다음-단계가 아니라 §2.5 의 전체 사이클을 순차 오케스트레이션하는 루프로 확장된다.

---

## 2.5 End-to-end 사이클 오케스트레이션 (research → plan → implement)

`--cycle` (자연어 "처음부터 끝까지", "풀 사이클", "연구부터 구현까지") 로 호출하면 본 스킬은 단일 다음-단계 추천을 넘어 전체 연구→계획→구현 사이클을 하나의 체인으로 오케스트레이션한다. 각 단계는 직전 단계의 `TASK_DONE` 이벤트를 게이트로 다음 단계를 spawn 한다. 사이클 계약의 공유 참조는 `_shared/kiwi/pipeline-v1.md` 이다.

**체인 순서**:

`kiwi-srs → (조건부) kiwi-srs-feasibility → kiwi-planner → kiwi-pm → kiwi-review-fix-loop`

즉 본 스킬은 하나의 다음 단계에서 멈추지 않고 위 다섯 단계를 연결된 사이클로 진행한다.

`--cycle` 은 `--run` 을 **함의한다** — 사이클 모드의 각 단계는 추천 출력이 아니라 실제 spawn 이므로, `--run` 을 함께 적지 않아도 진입 즉시 체인이 실행된다 (§1.2 옵션 매트릭스 · §6.1). 이 함의는 **실행 여부에만** 적용되고 게이트를 낮추지 않는다 — §0.4 안전 게이트, §0.5 자기 무한 루프 방지, §6.6 의 critical gate 즉시 중단은 사이클 진입에서도 그대로 발동한다.

사이클의 **마지막 홉**은 `kiwi-review-fix-loop` 이며 사이클은 거기서 종료한다.

`kiwi-commit-auto-push` 는 사이클이 자동으로 **잇지 않는다** — 커밋·push 는 외부 부작용이고, wave 마다 자동으로 일어나면 되돌릴 수 없다. Table T1(§5.1)의 그 행은 단일 다음-단계 추천에만 적용된다.

### 2.5.1 조건부 feasibility (AC-2)

`kiwi-srs` 가 방금 작성·갱신한 요구사항이 **draft** stability 이거나 implementability(구현 가능성)가 **unverified**(미검증) 인 경우에만 `kiwi-srs-feasibility` 를 실행한다. 신규 요구사항이 모두 evolving 이상 + 구현 가능성 확인 상태면 feasibility 단계를 **skip**(생략)하고 곧바로 `kiwi-planner` 로 진행한다. 즉 feasibility 는 conditional(조건부) 단계이며, draft/미검증 요구가 없으면 건너뛴다.

### 2.5.2 skip-authoring / resume-from-stage 진입

SRS 가 이미 저작되어 있으면 `--from=feasibility` 또는 `--from=planner` 로 `kiwi-srs` 저작을 건너뛰고 사이클을 중간 단계에서 시작한다. 이 진입점은 `kiwi-wave-master`(FR-FLOW-029)의 wave 별 사이클 호출이 소비한다 (R-005 크로스-스킬 통합).

### 2.5.3 사이클 게이트·전파 요약

- `--auto` 위원회 자동 결정 + 완주 규약: §6.6.
- `--max` 하위 스킬 전파: §7.1.
- 연구 문서 `/kiwi-srs` passthrough: §7.2.

---

## 2.6 Worktree 격리 + 완료 게이트 (merge-or-PR, FR-FLOW-027)

`--wt` 인자 또는 워크트리 격리(worktree isolation) 요청("워크트리에서 돌려", "격리해서 진행")으로 호출하면, 본 스킬은 사이클 전체를 현재 작업 트리와 분리된 공간에서 실행하기 위해 전용 worktree 를 준비한다. `--wt` 미지정 + 격리 요청이 없으면 현재 작업 트리에서 그대로 진행한다.

### 2.6.1 Worktree 격리 진입 (AC-1)

`--wt` 또는 worktree 격리 요청 시, 본 스킬은 현재 작업 트리를 오염시키지 않도록 **전용(dedicated) git worktree** 를 새로 **생성(create)** 한다 — `git worktree add <path> -b <cycle-branch>` 로 사이클 전용 브랜치를 별도 worktree 에 배치한다. 이후 §2.5 의 전체 연구→계획→구현 사이클은 그 생성된 **worktree 안에서(inside the worktree)** 실행되며, 원래 작업 트리(base 작업 공간)는 건드리지 않는다.

### 2.6.2 완료 게이트 — 비-auto 대화형 (AC-2)

비-auto(non-auto) 대화형(interactive) 모드에서 사이클이 성공적으로 **완료(completion)** 되면, 본 스킬은 격리에 사용한 worktree 브랜치를 어떻게 통합할지 사용자에게 **묻는다(ask)**: worktree 브랜치를 base 로 **머지(merge)** 할지, 아니면 **PR** 을 열지 여부를 `AskUserQuestion` 2지선다로 질문한다. 사용자가 선택하기 전에는 어느 통합도 자동으로 수행하지 않는다.

### 2.6.3 완료 게이트 — --auto 자동 PR (AC-3)

`--auto` 활성 시에는 위 merge-or-PR 질문을 사용자에게 묻지 않고, 완료(completion) 후 항상 `kiwi-commit-auto-pr` 를 호출하여 **PR 을 연다**. 이때 **base 브랜치(base branch)** 를 **직접 병합하지 않는다**(base 브랜치로의 direct-merge 금지) — `--auto` 라도 base 브랜치에 직접 merge 하지 않고 반드시 PR 경로로만 통합한다. `kiwi-commit-auto-pr` 는 편집 없이 그대로(as-is) 호출한다(OQ-027-autopr).

---

## 2.7 GitHub 이슈 진입 모드 — research-first 흐름 (FR-FLOW-028)

GitHub 이슈 번호(github issue number, "이슈 #123", "이슈 번호")가 진입 인자 또는 프롬프트 참조로 제공되면, 본 스킬은 Phase 0(§3)에서 이를 이슈 진입 큐로 감지하고 요구사항 저작 이전에 연구를 먼저 수행하는 **research-first** 흐름으로 분기한다. 이슈 번호가 없으면 §2.5 의 일반 사이클(또는 단일 다음-단계 추천)로 진행한다.

### 2.7.1 이슈 해결 + 구현 접근 연구 (AC-1)

이슈 번호(issue number)가 감지되면, 본 스킬은 곧바로 저작 단계로 가지 않고 먼저 `kiwi-srs-research` 를 실행하여 (1) 이슈의 해결(resolution) 방향과 (2) 추가로 구현 접근(implementation-approach)을 연구한다. 즉 이슈가 트리거하는 첫 파이프라인 단계는 반드시 `kiwi-srs-research` 이며, 이 연구가 끝난 뒤에야 `kiwi-srs` 로 SRS 저작을 시작한다 (research-first order). 이슈 진입 큐와 `kiwi-srs` 시작 사이에는 오직 `kiwi-srs-research` 만 위치하고, 연구 없이 `kiwi-srs` 를 곧바로 시작하지 않는다.

### 2.7.2 불충분한 연구 시 --qna-force 에스컬레이션 (AC-2)

`kiwi-srs-research` 연구만으로 요구사항이 여전히 모호(ambiguous)하거나 불충분(insufficient)하면, 본 스킬은 `kiwi-srs` 를 `--qna-force` 로 시작하여 남은 미해결(unresolved) 모호성을 사용자와 해소한다. 단 `--auto` 활성 시에는 `--qna-force` 를 **억제(suppress)**하여 --qna-force 없이 진행하고, 남은 모호성은 FR-FLOW-025 결정 위원회(decision committee)가 자동 결정한다.

### 2.7.3 이슈 흐름의 사이클 계속 (AC-3)

이슈 번호(issue number) 기반의 연구와 SRS 저작이 끝나면, 이 이슈 진입 흐름은 §2.5 의 표준 사이클로 **계속(continue)**되어 `kiwi-planner` → `kiwi-pm` → `kiwi-review-fix-loop` 로 이어진다. 즉 이슈에서 시작한 작업도 연구·저작 이후 planner/pm/review 단계를 그대로 진행한다.

---

## 2.8 work-mode 라우팅 게이트 (tdd step-scoped 라우팅, FR-FLOW-039)

사이클 시작 시(Phase 0), 본 스킬은 §2.5 의 5단계 sdd 체인(`kiwi-srs → … → kiwi-review-fix-loop`)으로 진입하기 전에 먼저 현재 **work-mode** 를 읽어 라우팅을 결정한다. 이 게이트는 §2.5 체인 본문과 독립된 별도 절이며, 체인 자체는 변경하지 않는다.

### 2.8.1 work-mode 조회 (MCP-first, fail-open)

1. MCP `get_work_mode`(가용 시 우선)로 현재 work-mode 를 읽는다.
2. MCP 부재 시 CLI `speckiwi mode`(fallback)로 읽는다.
3. 둘 다 부재 시 `wait` 로 간주한다(**fail-open**) — work-mode 를 못 읽는다고 사이클을 막지 않는다.

### 2.8.2 라우팅 결정 (tdd + step-scoped → kiwi-tdd)

- work-mode 가 **`tdd`** 이고 요청 작업이 **step-scoped**(단일 기능 / step 규모)이면, §2.5 의 5단계 sdd 체인 **대신** `kiwi-tdd` 스킬로 **라우팅**한다 (SDS 선행 TDD First 사이클). 이때 사이클 오케스트레이션은 kiwi-tdd 가 담당한다.
- 그 외 — work-mode 가 tdd 가 아니거나, 작업이 **body-scope** REQ 수정 또는 대규모 아키텍처 변경이면 — §2.5 의 5단계 sdd 체인을 그대로 **유지**한다.
- 이 경계 원칙은 agent snippet 규칙 6(tdd step 은 step-scoped 작업만; body-scope·대형 아키텍처 변경은 sdd 체인)과 동일하다.
- **`--cycle` / `--from=` 진입은 본 라우팅의 적용 대상이 아니다** — wave 사이클 진입(§2.5.2, `kiwi-wave-master` FR-FLOW-029)은 **body-scope** 작업이므로, work-mode 가 `tdd` 여도 `kiwi-tdd` 로 라우팅하지 않고 §2.5 의 5단계 sdd 체인을 그대로 **유지**한다. 근거 둘: (1) `kiwi-tdd` 는 `critical_gates[]` 를 선언하지 않아 공용 `--auto` 계약(`auto-option.md` §1 안전 디폴트)상 `--auto` 가 비활성이므로 무인 완주가 성립하지 않는다. (2) `kiwi-tdd` 의 산출물은 design.md · step SRS · 승격된 요구 블록뿐이어서 wave 종료 검증이 요구하는 plan · worklog · 리뷰 산출물이 없고, 따라서 증거 번들이 성립하지 않는다.
- 이 배제는 **본 라우팅 한정**이다 — §0.4 안전 게이트, §0.5 자기 무한 루프 방지, §6.6 의 critical gate 즉시 중단은 `--cycle` / `--from=` 진입에서도 그대로 적용된다.

---

## 3. Phase 0 — 파일 경로 해석

`~/.claude/skills/_shared/kiwi/pipeline-event.md` §1 의 해석 순서:

1. `git rev-parse --show-toplevel` exit 0 → `{git_root}/kiwi/pipeline.jsonl`
2. 위 실패 + cwd 에 `kiwi/` 디렉토리 존재 → `{cwd}/kiwi/pipeline.jsonl`
3. 둘 다 부재 → `~/.kiwi/pipeline.jsonl`

결정 후 `{dir}/.pipeline-path` 마커 파일 갱신.

jsonl 부재 시:
- 메시지 "파이프라인 미시작. 시작 후보:" 출력
- `AskUserQuestion` 2지선다:
  - (A) `kiwi-srs` — 신규 요구사항 → SRS 작성
  - (B) `kiwi-srs-from-code` — 기존 코드 → SRS 역추출
- `--auto` 시 사용자에게 시작 후보 선택 의무 (자동 결정 불가 — 의도 모호)

---

## 4. Phase 1 — 직전 이벤트 파싱

마지막 N 줄 (`--tail=N`, 기본 10) 을 tail 로 읽음:

```bash
tail -n $N "$PIPE_FILE"
```

각 줄을 JSON parse. parse 실패 줄은 WARN + skip. schema 검증:

| 검사 | severity |
|---|---|
| 필수 9개 필드 누락 | WARN (해당 줄 skip) |
| `schema_version` major mismatch (현재 `1.x.x`) | ERROR (사용자 안내 후 종료) |
| `skill` enum 외 값 | WARN (해당 줄 skip) |
| `status` enum 외 값 | WARN (해당 줄 skip) |

`--prev` 옵션 시 마지막 줄 무시하고 그 직전 줄 사용.

직전 이벤트 = parse 통과한 마지막 줄.

---

## 5. Phase 2 — 다음 단계 후보 도출

### 5.1 Table T1 (Decision)

`pipeline-event.md` §4 의 표를 그대로 적용.

| 직전 skill | 직전 status | 후보 |
|---|---|---|
| kiwi-srs / kiwi-srs-from-code | TASK_DONE | `kiwi-srs-feasibility` |
| kiwi-srs-sync | TASK_DONE | `kiwi-pipeline` (재평가 — 사용자 결정) |
| kiwi-srs-feasibility | TASK_DONE | `kiwi-planner` 우선; 블로커 모호 시 `kiwi-srs-research` 도 후보 |
| kiwi-srs-research | TASK_DONE | `kiwi-srs-feasibility` (재평가) |
| kiwi-planner | TASK_DONE | `kiwi-pm` |
| kiwi-pm | TASK_DONE | `kiwi-review-fix-loop --close-reqs` |
| kiwi-coder (단독) | TASK_DONE | `kiwi-review-fix-loop --close-reqs` |
| kiwi-review-fix-loop | TASK_DONE | `kiwi-commit-auto-push` 또는 PR mode 에서는 종료 |
| kiwi-hot-fix | TASK_DONE | `kiwi-commit-auto-push` 또는 sync 후속 검토가 필요하면 `kiwi-pipeline` |
| kiwi-commit-auto-push | TASK_DONE | `kiwi-pipeline` (다음 plan or 종료, 사용자 결정) |
| kiwi-commit-auto-pr | TASK_DONE | `kiwi-pipeline` (다음 plan or 종료, 사용자 결정) |
| any | NEEDS_USER | (없음 — 사용자 결정 강제) |
| any | FAILED | (없음 — 재시도/건너뛰기/중단 3지선다) |
| any | DRY_RUN | (직전 동일 skill 의 실제 실행) |
| kiwi-pipeline | TASK_DONE | (직전 직전 이벤트의 next_hint 사용. §0.5 무한 루프 방지) |

### 5.2 후보 추가 신호

직전 이벤트의 `next_hint` 필드가 명시되어 있으면 Table T1 보다 우선:

- 직전 이벤트가 자신의 결과에 따라 `next_hint` 를 직접 결정한 경우 (e.g. feasibility 가 blocker 발견 → `kiwi-srs-research`) 이를 우선 채택.
- `next_hint == "kiwi-review-fix-loop"` 이고 직전 skill 이 `kiwi-pm` 또는 standalone `kiwi-coder` 이면 호출 인자는 `--close-reqs` 를 기본 부착한다. `--auto` 활성 시 `--close-reqs --auto` 로 부착한다.
- Table T1 결과와 다르면 두 후보를 모두 제시.

### 5.3 종료 신호

- 직전 이벤트의 `next_hint == null` → "파이프라인 종료. 다음 작업 대기."
- `--auto` 라도 종료는 자동 결정 (사용자 게이트 없이 종료 보고).

---

## 6. Phase 3 — 사용자 게이트 또는 자동 결정

### 6.1 후보 1개 (명확)

- `--auto --run` → 즉시 Phase 4 spawn
- `--auto` (no --run) → 추천만 출력 ("다음 단계: `kiwi-X`. 진행 시 본 스킬 `--auto --run` 또는 직접 `/kiwi-X` 호출.")
- `--auto` 미지정 → `AskUserQuestion` 2지선다 (진행 / 건너뛰기)
- `--cycle` 진입 → `--run` 암묵 활성 (§2.5) — 위 `--auto` (no --run) 줄은 `--cycle` 진입에 적용되지 않고, 추천 출력 대신 §2.5 체인의 다음 단계를 그대로 spawn 한다

### 6.2 후보 2개 이상

- `AskUserQuestion` 다지선다 — 후보 각각 + "건너뛰기" + "다른 스킬 직접 지정"
- `--auto` 라도 다지선다는 자동 결정 불가 (사용자 의도 모호) — 사용자 게이트 발동 (§0.7)
- **`--cycle` 진입 제외** — 사이클 모드의 다음 단계는 §2.5 체인으로 고정되어 후보가 갈리지 않으므로 `multi-candidate-ambiguous` 게이트는 발동하지 않는다. 그 밖의 critical gate — §0.4 `NEEDS_USER` / `FAILED` 차단, §0.5 자기 재귀 방지 — 는 사이클 진입에서도 그대로 발동한다 (§0.AG)

### 6.3 NEEDS_USER 처리

직전 이벤트 `status == NEEDS_USER`:
- 직전 이벤트 `notes` / `summary` 에서 사용자에게 요구한 결정 추출 → 출력
- `AskUserQuestion` 으로 결정 요청
- 결정 후 해당 스킬을 `--resume` 옵션으로 재호출 제안

### 6.4 FAILED 처리

직전 이벤트 `status == FAILED`:
- `AskUserQuestion` 3지선다: (A) 재시도 / (B) 건너뛰기 (다음 스킬 추천) / (C) 중단

### 6.5 자기 재귀 진입 충돌 (§0.5)

직전 이벤트가 `skill: "kiwi-pipeline"` 인 경우:
- 직전 직전 이벤트 (`tail -n 2 | head -n 1`) 를 기준으로 다시 추론
- 만약 그것도 `kiwi-pipeline` 이면 → ERROR + "kiwi-pipeline 이 연속 2회 호출됨. 직접 다음 스킬 호출 권장." 메시지 출력 후 종료

### 6.6 사이클 모드 게이트 (--auto 위원회 자동 결정, AC-3)

`--cycle` + `--auto` 활성 시 단계 사이의 모든 게이트(inter-stage gate)는 `_shared/kiwi/auto-option.md` 의 결정 위원회(decision committee)가 자동 결정하며, 사이클은 사용자 개입 없이 **끝까지**(to the end) 완주한다. 단, 어떤 하위 스킬이 `NEEDS_USER` 또는 `FAILED` 를 반환하거나 §0.AG 의 critical gate 에 도달하면 위원회 자동 결정을 우회하지 않고 즉시 **중단**(halt)하여 사용자 결정을 받는다 — `--auto` 라도 이 게이트는 항상 중단한다.

---

## 7. Phase 4 — 외부 스킬 spawn (--run 시)

`Skill` 도구로 선택된 kiwi-* 스킬 호출:

```
Skill({ skill: "kiwi-<chosen>", args: "<inherited or empty>" })
```

추가 인자 인계:
- `--auto` (kiwi-pipeline) → 자식 스킬에도 전파 (자식의 `--auto` 의미는 자체 SSOT 따름)
- `--model <name>` (kiwi-pipeline 본 스킬에는 정의 안 됨; 그러나 사용자가 명시한 경우 자식에 전파)
- 선택 스킬이 `kiwi-review-fix-loop` 이고 직전 skill 이 `kiwi-pm` 또는 standalone `kiwi-coder` 이면 `--close-reqs` 를 부착한다. `--auto` 활성 시 `--close-reqs --auto` 로 호출한다.
- `--req-filter` 와 `--plan-run-id` 는 함께 `kiwi-planner` · `kiwi-pm` 에 전달한다 — `kiwi-planner` 가 `--req-filter` 를 자기 `REQ_FILTER` 입력으로 소비해 계획 범위를 좁히고 `--plan-run-id` 를 run-id 도출 대신 사용하며, `kiwi-pm` 은 그 값으로 `PLAN_PATH`(`docs/plans/{plan-run-id}.plan.md`)와 세션(`.kiwi/sessions/{run_id}/`)을 고정해 최신 `generated_at` 자동 추정을 쓰지 않는다. 하나만 흘리면 범위 없는 재진입이 되어 계획 전체를 다시 돈다 (§7.5)
- `--target` 은 그 사이클이 spawn 하는 SRS 계열 하위 스킬(`kiwi-srs` · `kiwi-srs-feasibility` · `kiwi-planner`)에 각자의 `TARGET` 입력으로 전달한다 — 세 스킬 모두 `TARGET` 미지정 시 `get_active_target` 으로 되돌아가므로, 명시 전달이 없으면 그 사이클이 어느 target 을 대상으로 도는지가 활성 target 의 부수효과에 좌우된다 (§1.2)

spawn 결과는 사용자 메시지로 직접 출력. 자식 스킬도 자기 jsonl 이벤트를 append 하므로 본 스킬이 별도 기록할 필요 없음.

### 7.1 --max 전파 (AC-4)

`--max` 로 본 스킬을 호출하면 사이클이 spawn 하는 **모든 하위 스킬(every spawned sub-skill)** — `kiwi-srs` · `kiwi-srs-feasibility` · `kiwi-planner` · `kiwi-pm` · `kiwi-review-fix-loop` — 에 `--max` 를 그대로 **전파**(propagate)한다. 하위 스킬의 `--max` 의미는 각자의 SSOT 를 따른다.

### 7.2 연구 문서 passthrough (AC-5)

사용자가 **연구 문서**(research document)를 인자 또는 프롬프트 참조로 제공하면, 사이클 시작 시 본 스킬은 그 문서를 `/kiwi-srs` 로 **전달**(passthrough)하여 SRS 저작의 입력으로 공급한다. `kiwi-srs` 는 이를 FR-FLOW-023 research verify/improve 루프의 입력으로 사용한다.

`--run` 미지정 시 본 Phase skip.

### 7.3 `--mini` / `--loops N` 전파

`--mini` 또는 `--loops N` 으로 본 스킬을 호출하면 (`_shared/kiwi/loop-option.md` v1.0 SSOT), 사이클이 spawn 하는 **모든 하위 스킬(every spawned sub-skill)** — `kiwi-srs` · `kiwi-srs-feasibility` · `kiwi-planner` · `kiwi-pm` · `kiwi-review-fix-loop` — 에 해당 플래그를 그대로 **전파**(propagate)한다. 하위 스킬의 라운드 상한 시맨틱은 각자의 `loop-option.md` 참조를 따른다.

### 7.4 pass-through 옵션 전파 (kiwi-wave-master → kiwi-pm → kiwi-coder)

부모 `kiwi-wave-master` 가 넘긴 아래 옵션은 본 스킬이 해석하지 않고 하위 스킬로 그대로 **전달**(pass-through)한다. 본 스킬은 전파 경로의 중간 홉이며, 여기서 누락되면 옵션이 `kiwi-coder` 게이트에 도달하지 못해 무인 실행이 그 게이트에서 멈춘다.

| 옵션 | 도달 대상 | 본 스킬의 전달 경로 |
|---|---|---|
| `--auto-cost-warning` | `kiwi-coder` 비용 확인 게이트 | kiwi-pipeline → `kiwi-pm` → `kiwi-coder` |
| `--auto-integration` | `kiwi-coder` 통합 테스트 동의 게이트 | kiwi-pipeline → `kiwi-pm` → `kiwi-coder` |
| `--force` | `kiwi-pm` 의 stale `pm.lock` 해제 | kiwi-pipeline → `kiwi-pm` (**명시** 입력만) |
| `--regression-baseline` | `kiwi-coder` / `kiwi-review-fix-loop` 의 회귀 델타 기준선 | kiwi-pipeline → `kiwi-pm` → `kiwi-coder` |

각 옵션의 시맨틱은 그 도달 대상 스킬(`kiwi-pm` · `kiwi-coder`)의 SSOT 를 따른다 — 본 스킬은 값을 판단하거나 변형하지 않고 그대로 인계한다.

### 7.5 재진입 emit 키 규약

부모 `kiwi-wave-master` 의 개선 위임(§5.5.5)이 같은 wave 로 본 스킬을 다시 호출하는 **재진입** 실행은 자기 emit 키를 새로 만든다.

이 접미사 규약의 SSOT 는 `~/.claude/skills/_shared/kiwi/pipeline-event.md` **§5.4** 다 — 본 절은 그 규약을 사이클 관점에서 인용할 뿐이며, 자식 스킬은 본 절이 아니라 그 공유 계약을 읽는다.

재진입 실행의 emit **멱등 키**는 `{run_id}#r{n}` 이다(`n` = 그 run 의 재진입 회차, 1-based) — bare `run_id` 를 재사용하면 같은 날 재진입이 멱등 skip 되어 체인이 볼 새 `TASK_DONE` 이 생기지 않는다.

같은 접미사 규약을 `--plan-run-id` 로 계획 run 을 재사용하는 자식(`kiwi-planner` · `kiwi-pm`)의 emit 에도 적용한다 — 그 자식들의 규칙은 "동일 `run_id` 이벤트가 이미 존재하면 skip" 이므로, run 을 재사용한 재진입은 회차 접미사 없이 이벤트를 남기지 못한다.

---

## 8. Phase 5 — 통계 + 자기 이벤트 emit

### 8.1 통계 출력

```markdown
## kiwi-pipeline 상태

- pipeline file: `/c/path/kiwi/pipeline.jsonl`
- 총 이벤트: 23
- 마지막 N (10) 줄 분석:

| skill | 횟수 | 평균 duration (sec) | 마지막 ts |
|---|---:|---:|---|
| kiwi-srs | 3 | 145.2 | 2026-05-19T10:00:00Z |
| kiwi-srs-feasibility | 2 | 88.1 | 2026-05-19T10:15:00Z |
| kiwi-planner | 1 | 213.5 | 2026-05-19T10:30:00Z |
| kiwi-pm | 1 | 1245.8 | 2026-05-19T11:00:00Z |
| kiwi-commit-auto-push | 4 | 12.3 | 2026-05-19T11:30:00Z |
```

`--stats` 단독 호출 시 위 표만 출력하고 Phase 1~4 skip.

### 8.2 자기 이벤트 emit

본 호출 종료 직전 `pipeline.jsonl` 에 1줄 append:

```json
{
  "ts": "<now>",
  "schema_version": "1.0.0",
  "skill": "kiwi-pipeline",
  "run_id": "pipeline-<ISO-time-short>",
  "target": null,
  "status": "TASK_DONE",
  "summary": "추천: kiwi-X | 종료 보고 | FAILED 게이트",
  "next_hint": "kiwi-X" | null,
  "artifacts": { "spec_files": [], "plan_file": null, "sidecar_file": null, "analysis_dir": null },
  "dry_run": false,
  "duration_sec": 0.8,
  "notes": "추천 단일/다지선다, --auto, --run 여부 등"
}
```

run_id = `pipeline-{YYYYMMDDHHMMSS}` (`pipeline-` prefix + UTC 압축 시각). 멱등성은 본 스킬에 일반적이지 않으므로 (매 호출 새 run_id) 항상 append.

---

## 9. 보고 양식 (사용자 메시지)

### 9.1 단일 추천 (명확한 다음 단계)

```markdown
## kiwi-pipeline 추천

**직전 단계**: `kiwi-srs` (TASK_DONE)
- run_id: 2026-05-19.skillfactory.add-auth
- 요약: 신규 FR-AUTH-003 등록
- 산출물: docs/spec/01.auth.srs.md

**다음 추천**: `kiwi-srs-feasibility`
- 근거: Table T1 (srs → feasibility)
- 옵션: `/kiwi-srs-feasibility` 또는 본 스킬 `--auto --run` 으로 자동 호출

(--stats 옵션 시 통계 표 첨부)
```

### 9.2 다지선다

```markdown
## kiwi-pipeline 추천

**직전 단계**: `kiwi-srs-feasibility` (TASK_DONE)
- notes: 블로커 2건 모호

**다음 후보 (사용자 결정 필요)**:
  (A) kiwi-planner — stability ≥ evolving REQ 가 있어 plan 진행 가능
  (B) kiwi-srs-research — 블로커 모호성 해소 필요
  (C) 건너뛰기
```

### 9.3 NEEDS_USER

```markdown
## kiwi-pipeline 사용자 결정 요청

**직전 단계**: `kiwi-pm` (NEEDS_USER)
- run_id: 2026-05-19.skillfactory.task-13
- 요약: T-PH001-04 에서 business-decision severity 발견
- notes: "API rate limit 정책 미정 — 사용자 결정 필요"

→ pm 의 NEEDS_USER 응답을 본 메시지에 답변 후 `/kiwi-pm --resume` 으로 재진입.
```

### 9.4 FAILED

```markdown
## kiwi-pipeline FAILED 처리

**직전 단계**: `kiwi-coder` (FAILED)
- run_id: ...
- 요약: 테스트 실패 후 자동 복구 실패

**선택지**:
  (A) 재시도 — `/kiwi-coder --resume`
  (B) 건너뛰기 — 다음 후보 (`kiwi-commit-auto-push`) 진행
  (C) 중단
```

### 9.5 종료

```markdown
## kiwi-pipeline 종료

**직전 단계**: `kiwi-commit-auto-push` (TASK_DONE, next_hint=null)

파이프라인이 종료되었습니다. 새로운 요구사항이 있으면 `/kiwi-srs` 로 시작하십시오.
```

---

## 10. 결정 표 우선순위

```
직전 이벤트 status:
  NEEDS_USER → §9.3 (사용자 결정 강제)
  FAILED     → §9.4 (3지선다)
  DRY_RUN    → 직전 동일 skill 의 실제 실행 추천
  CORRECTION → 정정 대상 이벤트로 재추론
  TASK_DONE  →
    직전 이벤트.next_hint == null → §9.5 (종료)
    직전 skill == kiwi-pipeline    → §0.5 무한 루프 가드 → 직전 직전 이벤트로 재추론
    그 외 → Table T1 + next_hint 신호 결합 →
      후보 1개 → §9.1
      후보 ≥2 → §9.2
```

---

## 11. 자연어 호출 예시

| 사용자 입력 | 본 스킬 동작 |
|---|---|
| "/kiwi-pipeline" | 직전 이벤트 분석 + 추천 출력 |
| "/kiwi-pipeline --auto" | 후보 명확 시 추천만 출력 (실행 없음) |
| "/kiwi-pipeline --auto --run" | 후보 명확 시 즉시 spawn |
| "kiwi 다음 뭐 해" | 위와 동일 (자연어 트리거) |
| "/kiwi-pipeline --stats" | 통계만 출력 (추천·실행 없음) |
| "/kiwi-pipeline --tail=20" | 마지막 20 이벤트 분석 |
| "/kiwi-pipeline --prev" | 마지막 이벤트 무시하고 그 직전 기준 |

---

## 12. 외부 의존성

| 도구 | 용도 | 부재 시 |
|---|---|---|
| `git rev-parse` | 파일 경로 해석 §3 | cwd 의 `kiwi/` 또는 `~/.kiwi/` fallback |
| `tail` / `head` | jsonl 읽기 §4 | (POSIX 표준, 항상 가용) |
| `Skill` 도구 | 외부 kiwi-* spawn §7 | --run 옵션 비활성 |
| `AskUserQuestion` 도구 | 사용자 게이트 | --auto 시 일부 게이트 자동 결정 |

speckiwi MCP / doculight / 기타 외부 MCP 의존성 없음.

---

## 13. 안전성 / 멱등성

- 본 스킬의 *읽기* 는 multiple-call safe (jsonl read-only).
- 본 스킬의 *spawn* 은 매 호출 새 run_id 생성하므로 자식 스킬의 멱등성은 자식 책임.
- 자기 이벤트 emit 은 best-effort — emit 실패가 본 작업 실패로 이어지지 않음.

---

## 14. 향후 마일스톤

- v0.2: 통계 강화 (스킬별 성공률 / FAILED 빈도 / 재시도 분포)
- v0.3: jsonl 회전 정책 옵션 (--rotate=N)
- v1.0: 멀티-cwd 동시 실행 안전 추적
