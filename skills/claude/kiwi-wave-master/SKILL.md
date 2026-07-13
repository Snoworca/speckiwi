---
name: kiwi-wave-master
description: "여러 wave 로 나뉘는 대형 작업(에픽·멀티-스텝 로드맵·장기 연구 결과)을 순서 있는 wave 로 분해하고, wave 마다 전용 target 을 /kiwi-srs 로 등록한 뒤 wave 별 /kiwi-pipeline 을 순차 실행하는 멀티-웨이브 오케스트레이터 v0.1. ./kiwi/waves.jsonl 로 진행을 추적하여 재개 가능(첫 미완료 wave 부터). 트리거 — kiwi wave master, 웨이브 오케스트레이션, 멀티 웨이브, 대형 작업 분해, wave 별 파이프라인, 에픽 실행, 여러 단계로 나눠서 진행. 옵션 — --auto (모든 wave 를 끝까지 자율 완주, 안전 게이트 유지), --max (모든 wave 의 하위 스킬로 전파)."
---
> Kiwi MCP rule: normal target-scoped SRS reads, mutations, validation, status/stability updates, acceptance-criteria changes, evidence, trace links, and completed-work logging require working `speckiwi mcp`. CLI is diagnostic/remediation only and is not a normal replacement for MCP mutations.
# kiwi-wave-master v0.1

하나의 크고 긴 작업(에픽·로드맵·대형 연구 산출물)을 **여러 개의 wave 로 나누어 순차적으로 완주**시키는 멀티-웨이브 오케스트레이터. 각 wave 는 독립된 SRS target + 자체 `/kiwi-pipeline` 사이클로 처리되며, 전체 진행은 `./kiwi/waves.jsonl` 에 영속되어 세션이 초기화돼도 재개할 수 있다.

이 스킬은 *직접 요구사항을 저작하거나 코드를 구현하지 않는다* — wave 경계를 정하고, 각 wave 의 target 을 `/kiwi-srs` 로 등록하고, wave 별 `/kiwi-pipeline` 을 순서대로 spawn 하는 상위 오케스트레이터다.

---

## 0. 공통 규약 (SSOT)

| 키 | 규칙 |
|---|---|
| §0.1 | **이벤트 SSOT**: `~/.claude/skills/_shared/kiwi/waves-event.md` v1.0.0 가 `./kiwi/waves.jsonl` 의 schema·파일위치·mark-complete 규칙 SSOT. 본 문서는 wave 분해·오케스트레이션 로직만 담당. |
| §0.2 | **/snoworca-\* 호출 절대 금지**. kiwi-* 시리즈만 `Skill` 도구로 호출한다. |
| §0.3 | **CLAUDE.md §6 시그니처 금지** + **§7 변경 이력 금지**. 본 스킬 본문에 변경 이력 섹션 없음 — git history 가 SSOT. |
| §0.4 | **--auto 안전 게이트**: 어떤 wave 의 `/kiwi-pipeline` 이 `NEEDS_USER` / `FAILED` 를 반환하거나 critical 게이트에 도달하면, `--auto` 라도 자동 진행을 중단하고 사용자 결정을 받는다. |
| §0.5 | **wave 경계 불변 원칙**: 일단 `waves.jsonl` 에 확정된 wave 순서·범위는 실행 도중 임의로 재분할하지 않는다. 재분해가 필요하면 처음부터 다시 분해한다. |
| §0.6 | **멱등 재개**: 이미 완료로 표시된 wave 는 재실행하지 않고 건너뛴다. 진행은 항상 첫 미완료 wave 부터 이어간다. |
| §0.7 | **`--mini` / `--loops N` 옵션 SSOT**. 본 스킬은 `_shared/kiwi/loop-option.md` v1.0 을 따른다. `--mini` = 검증-개선 루프 라운드 상한 3, `--loops N` = 라운드 상한 N(정수 ≥1). 동시 지정 시 **`--loops` 우선(경고)**. `--max` 와 직교(조합). 상한 도달 시 잔여 finding 보고(안전 게이트 불우회) |
| §7 참고 | `--mini`/`--loops N` 를 per-wave kiwi-srs + kiwi-pipeline 에 전파 (loop-option.md §6) |

---

## 1. 입력 / 출력

### 1.1 필수 입력

- 대형 작업을 기술하는 **연구 문서 / 계획 문서 / 로드맵**(경로 또는 프롬프트 참조), 또는
- **에픽 이슈**(GitHub epic issue 번호 — §8 진입 모드).

둘 다 없으면 사용자에게 분해할 대상 문서를 묻는다.

### 1.2 선택 입력 + 자연어 매핑

| 자연어 신호 | 인자 | 기본값 |
|---|---|---|
| "자동", "auto", "끝까지 알아서", "묻지 말고" | `--auto` (모든 wave 자율 완주, SSOT: auto-option.md v1.0) | off |
| "max 모드", "고강도", "최대로" | `--max` (모든 wave 의 하위 스킬로 전파) | off || "N 번째 wave 부터", "이어서" | `--resume` (첫 미완료 wave 부터 재개) | 자동 감지 |
| "에픽 이슈", "이슈 #123 를 wave 로" | 에픽 이슈 번호 (§8 진입 모드) | (없음) |
| "미니 모드", "빠른 모드", "3라운드" | `--mini` (per-wave kiwi-srs/kiwi-pipeline 로 전파 §7.3) | off (스킬 기본 상한) |
| "루프 N회", "N라운드", "N번 돌려" | `--loops N` (per-wave kiwi-srs/kiwi-pipeline 로 전파 §7.3) | off (스킬 기본 상한) |

### 1.3 출력

- **대화 메시지**: wave 분해 결과(순서·범위), 현재 진행 상황, 다음 wave.
- **`./kiwi/waves.jsonl`**(의무): wave 별 상태 append-only 로그 (waves-event.md schema).
- 각 wave 의 `/kiwi-srs`·`/kiwi-pipeline` 산출물은 각 스킬이 자체 기록.

---

## 2. Phase 흐름

```
Phase 0 : 입력 문서 해석 + waves.jsonl 경로 해석 (재개 감지)
Phase 1 : Wave 분해 (§3) — 순서 있는 wave 목록 확정
Phase 2 : Wave 별 target 등록 (§4) — /kiwi-srs 로 wave-{n} target 저작
Phase 3 : Wave 별 kiwi-pipeline 실행 (§5) — 등록 순서대로 순차 진행
Phase 4 : waves.jsonl 갱신 (§6) — 성공한 wave 만 완료 표시
Phase 5 : 자기 이벤트 emit (§9)
```

재개 시 Phase 0 에서 `waves.jsonl` 을 읽어 첫 미완료 wave 로 곧바로 점프한다.

---

## 3. Phase 1 — Wave 분해 (AC-1)

입력 연구·계획 문서를 **순서(order)가 있는 여러 wave 로 분해(decompose)** 한다. 각 wave 는 순차(sequential)적으로 실행되는, 서로 정렬된(ordered) 작업 묶음이며 앞 wave 가 뒤 wave 의 토대가 된다.

**두 갈래 wave-split 휴리스틱**:

1. **헤더 우선(headers-first)**: 문서에 **명시적 wave 구조**(헤더·제목·섹션, document structure)가 있으면 그 헤더/섹션 경계를 그대로 wave 경계로 채택한다. 예: `## Phase 1`, `## 1단계`, 최상위 섹션 제목 등이 자연스러운 wave 경계다.
2. **그렇지 않으면(otherwise)**: 명시적 wave 구조가 **없으면**(when absent) **서브에이전트**가 문서의 **전체 흐름(overall flow)** 을 **분석(analyze)** 하여, 서로 응집된 3~8 개의 하위 목표(coherent sub-goals)로 wave 를 나눈다. 각 하위 목표가 하나의 wave 가 된다.

분해 결과는 순서가 확정된 `wave-1, wave-2, …, wave-N` 목록이며, 이 순서가 이후 target 등록·pipeline 실행 순서를 결정한다.

---

## 4. Phase 2 — Wave 별 target 등록 (AC-2)

각 wave 마다 `/kiwi-srs` 를 호출하여 전용 `wave-{n}` **target(타깃)** 을 등록하되, 그 wave 의 **작업 범위(work scope)** 를 명시적으로 지정한다. 즉 wave-1 → target `wave-1`, wave-2 → target `wave-2` … 로 각 wave 가 독립된 SRS target 을 갖는다.

이때 지정한 **범위(scope)** 는 **해당 wave 로 한정(bounded)** 되어야 한다 — 뒤따르는 feasibility·planning·review 단계가 그 wave 의 범위를 **넘어서지(beyond)** 않고 국한(제한)되도록 한다. 한 wave 의 사이클은 오직 그 wave 의 scope 안에서만 요구사항을 다루고, 다른 wave 의 작업은 넘어 보지 않는다.

`/kiwi-srs` 는 이 문서 절(§3 에서 확정된 wave 경계)의 내용을 입력으로 받아 해당 wave-{n} target 의 SRS 를 저작한다.

---

## 5. Phase 3 — Wave 별 kiwi-pipeline 실행 (AC-4)

각 wave 에 대해 **등록 순서대로(in order)** `/kiwi-pipeline` 을 호출한다 — wave 별(per-wave) 파이프라인 실행. 앞 wave 의 pipeline 이 완주(`TASK_DONE`)한 뒤에야 다음 wave 의 pipeline 을 시작한다.

이때 wave 별 `/kiwi-pipeline` 은 SRS **재저작을 생략하고(skip-authoring)** 진입한다 — §4 의 앞단계 `/kiwi-srs` 가 이미 그 wave 의 SRS 를 저작해 두었으므로, pipeline 을 `--cycle --from=feasibility` 로 호출하여 **feasibility/planning** 단계부터 구현까지 실행한다(재저작 없이). 즉 wave-master 는 각 wave 의 `/kiwi-srs` 를 앞에서 이미 끝냈기 때문에, wave 별 pipeline 은 저작을 다시 하지 않고 타당성/계획 단계로 곧장 들어간다.

이 진입점(skip-authoring / resume-from-stage, `--from=`)은 `kiwi-pipeline`(FR-FLOW-026 / T-PH003-04)이 제공하며, 본 스킬(FR-FLOW-029)이 wave 별 사이클에서 이를 소비한다(R-005 크로스-스킬 통합). provider(kiwi-pipeline) 와 consumer(kiwi-wave-master) 양쪽 모두 이 skip-authoring 진입을 명시한다.

target 을 wave-{n} 으로 지정하여 호출하면 pipeline 은 그 wave 의 활성 target 범위 안에서만 동작한다.

---

## 6. Phase 4 — 진행 추적 waves.jsonl (AC-3)

전체 진행 상태는 `./kiwi/waves.jsonl` 에 append-only 로 기록한다(schema: `~/.claude/skills/_shared/kiwi/waves-event.md`). 각 wave 는 자신의 `/kiwi-pipeline` 실행이 **성공적으로 완료된**(only after it finishes successfully) 뒤에만 `./kiwi/waves.jsonl` 에 **완료로 표시(mark complete)** 한다 — 실행 중이거나 실패한 wave 는 완료로 기록하지 않는다.

세션이 초기화되어 **다시 시작**(resume)해도, `./kiwi/waves.jsonl` 을 읽어 **첫 번째 미완료(first incomplete) wave** 부터 **재개**한다. 이미 완료로 표시된 앞 wave 들은 건너뛰고, 첫 미완료 wave 지점에서 이어서 진행한다. 이 덕분에 장시간 멀티-웨이브 작업이 중단되어도 안전하게 이어갈 수 있다.

---

## 7. --auto / --max 전파 (AC-5)

### 7.1 --auto — 전 wave 자율 완주

`--auto` 활성 시 **모든 wave**(every wave)를 사용자 개입 없이 **끝까지(to the end)** 자율적으로(autonomously) 실행한다. wave 사이의 게이트를 자동 결정하여 wave-1 부터 wave-N 까지 완주한다.

단, `--auto` 라도 각 wave 의 `/kiwi-pipeline` **안전 게이트(safety gate)** 는 **여전히 적용**된다 — 하위 pipeline 이 `NEEDS_USER` / `FAILED` 를 반환하거나 critical 게이트에 도달하면 `--auto` 여도 자동 진행을 멈추고 사용자 결정을 받는다(§0.4). 즉 `--auto` 는 정상 흐름만 자율화하고, per-wave 안전 게이트는 그대로 유효하다.

### 7.2 --max — 하위 스킬 전파

`--max` 활성 시 **모든 wave** 의 `/kiwi-pipeline` 과 그 **하위 스킬(sub-skill)** — 각 wave 사이클이 spawn 하는 `kiwi-srs` · `kiwi-srs-feasibility` · `kiwi-planner` · `kiwi-pm` · `kiwi-review-fix-loop` — 에 `--max` 를 그대로 **전파(propagate)** 한다. 하위 스킬의 `--max` 의미는 각자의 SSOT 를 따른다.

`--auto` 와 `--max` 는 함께 쓸 수 있으며(`--auto --max`), 이 경우 모든 wave 를 고강도로 자율 완주하되 per-wave 안전 게이트는 유지한다.

### 7.3 `--mini` / `--loops N` — 하위 스킬 전파

`--mini` 또는 `--loops N` 활성 시 (`_shared/kiwi/loop-option.md` v1.0 SSOT), **모든 wave** 가 spawn 하는 per-wave `kiwi-srs` 와 `kiwi-pipeline` 에 해당 플래그를 그대로 **전파(propagate)** 한다. 하위 스킬의 라운드 상한 시맨틱은 각자의 `loop-option.md` 참조를 따른다.

---

## 8. 에픽 이슈 진입 모드 (FR-FLOW-030)

에픽 이슈(epic issue) 번호가 진입 인자로 제공되면, wave 의 출처만 달라질 뿐 wave 를 추출한 뒤의 흐름은 §3~§7 문서 분해 진입과 동일하다.

### 8.1 에픽에서 순서 있는 wave 추출 (AC-1)

에픽 이슈가 진입점이면, 연구·계획 문서(research·plan document)를 **분석(analyze)** 하여 wave 를 나누는 §3 방식이 **아니라(instead of)**, **에픽 이슈(epic issue)** 자체에서 **순서(order)가 있는** wave 집합을 **추출(extract/도출)** 한다.

에픽에서 wave 를 도출하는 세 갈래 출처는 함께 고려한다 — 에픽 **본문 구조(structure)**, 에픽의 **태스크 리스트(task list, 작업 목록·체크리스트)**, 그리고 에픽에 **연결된 하위 이슈(linked sub-issue)**. 이 구조·태스크 리스트·연결된 하위 이슈의 나열 순서가 곧 wave 순서가 된다.

즉 wave 는 별도의 연구·계획 문서를 **분석**해서 만드는 것이 **아니라**, 에픽 이슈의 구조에서 직접 추출된다.

### 8.2 추출 후 FR-FLOW-029 와 동일 진행 (AC-2)

wave 를 추출한 뒤부터는 **FR-FLOW-029 와 동일(identical)** 하게 진행한다 — §4 의 scoped `wave-{n}` **target(타깃)** 등록, §6 의 `./kiwi/waves.jsonl` 진행 추적, §5 의 wave 별(per-wave) `/kiwi-pipeline` 을 등록 **순서대로(in order)** 실행하는 기계(machinery)를 그대로 재사용한다.

- 각 wave 는 §4 처럼 `/kiwi-srs` 로 전용 `wave-{n}` target 을 그 wave 의 **범위(scope)** 로 한정해 등록한다.
- 진행은 §6 처럼 `./kiwi/waves.jsonl` 에 기록하고, 성공한 wave 만 완료로 표시하며, 첫 미완료 wave 부터 재개한다.
- 실행은 §5 처럼 `/kiwi-pipeline` 을 **등록 순서대로** wave 별로 호출한다.

### 8.3 스킵되는 것은 사전 wave-split 연구뿐 + 구조 가드 (AC-3)

에픽 진입에서 **생략(skip)** 되는 것은 오직 §3 의 **사전(up-front)** **wave 분할 연구(wave-split research)** 분석 한 단계뿐이다 — 에픽이 이미 wave 경계를 구조로 제공하므로, 앞단에서 문서 흐름을 다시 연구(research)할 필요가 없다.

그러나 각 wave 의 `/kiwi-pipeline` 은 **자체 연구(own research)** 를 그대로 수행한다 — wave 마다 자기 자신의 per-wave 리서치를 pipeline 안에서 돌린다. 생략되는 것은 상위의 사전 wave-split 연구 한 단계뿐이고, wave 별 pipeline 의 자체 연구는 유지된다.

**구조 가드** — 사전 연구 생략은 에픽이 **추출 가능한 구조(extractable structure)** 를 가질 때만 확정된다:

- **(a) 구조화된 에픽 (research-skip)**: 에픽에 **태스크 리스트 그룹(task-list group)** 이나 **2개 이상(>=2)** 의 **연결된 하위 이슈(linked sub-issue)** 처럼 **추출 가능한 구조가 있으면**, 사전 wave-split 연구를 **생략(skip)** 하고 그 구조에서 직접 wave 를 **분할(decompose/분해)** 한다.
- **(b) 비구조화 에픽 (fallback)**: 에픽이 자유 형식(free-form) 산문(prose)이거나 연결된 하위 이슈가 2개 미만(<2)이라 나눌 수 없어 **추출 가능한 구조가 없으면(no extractable structure)**, 사전 연구 생략을 적용하지 않고 **FR-FLOW-029 의 wave-split 서브에이전트** 흐름으로 **폴백(fallback)** 한다(새 컴포넌트 없음). 이 경우 §3 의 그 서브에이전트가 에픽 본문 흐름을 **분석**해 wave 를 나눈다.

---

## 9. Pipeline emit (의무)

`~/.claude/skills/_shared/kiwi/pipeline-event.md` v1.0.0 를 따라 본 스킬 1회 실행 종료 직전 `./kiwi/pipeline.jsonl` 에 1줄 append(멱등: run_id 기준). wave 별 진행은 별도로 `./kiwi/waves.jsonl`(§6, waves-event.md) 에 기록한다. emit 실패는 best-effort — 본 작업 실패로 이어지지 않는다.
