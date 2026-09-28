---
name: kiwi-sds
description: "구현 직전의 요구 범위에 대해 초경량 SDS(설계 명세, SDS 규칙의 lite 프로필) 하나를 `docs/sds/<sds-id>.sds.md` 에 쓰고 결정적 검사 `speckiwi sds check`(MCP `check_sds`)로 확인한 뒤 스스로 agreed 로 올리는 스킬. SDS 는 코딩 에이전트용(영어, 서사 없음)이며 사용자 승인 게이트가 없다. 기본 모드에는 LLM 검증 루프가 없고 `--max` 가 독립 검증자 1회를 더한다. `--close <sds-id>` 는 구현이 끝난 SDS 의 해석 결정을 SRS AC 명확화로 옮기고, 승급 뒤 파일을 지운다. 트리거 — kiwi sds, SDS 작성, 설계 명세 작성, lite SDS, sds close, SDS 마감, /kiwi-sds. 옵션 — --req-filter, --sds-id, --convergence-registry, --existing-modules, --close, --auto, --max, --mini / --loops N, --model, --no-pipeline-emit."
---
> Kiwi MCP rule: normal target-scoped SRS reads, mutations, validation, status/stability updates, acceptance-criteria changes, evidence, trace links, and completed-work logging require working `speckiwi mcp`. CLI is diagnostic/remediation only and is not a normal replacement for MCP mutations.
# kiwi-sds v0.1

sdd 사슬 `kiwi-srs → (kiwi-srs-feasibility) → kiwi-sds → kiwi-pm → kiwi-review-fix-loop` 의 설계 단계. 구현할 요구 범위에 대해 lite SDS 하나를 쓰고, 결정적 검사로 확인하고, 스스로 합의한다. 구현이 끝나면 `--close` 로 SDS 를 닫는다 — 남길 것은 SRS 로 옮기고 파일은 지운다.

근거 요구: FR-FLOW-182(작성), FR-FLOW-183(마감), FR-FLOW-184(사슬).

**SDS 문법 SSOT**: `docs/rule/SDS-MD-Rules-v2.6.0.md` §9 (Lite Profile). 이 스킬은 문법을 다시 적지 않는다 — 위치·메타데이터·절·줄 문법·100 줄 상한·진단 코드는 모두 그 절이 정한다. 작성은 §9.7 템플릿에서 시작한다.

## Official Workflow Tool Policy

Workflow 상태 조회·다음 작업 선택·이벤트 기록의 정상 경로는 MCP `workflow_pipeline_tail`, `workflow_pipeline_status`, `get_next_work_order`, `workflow_pipeline_emit` 또는 동일 기능의 `speckiwi workflow ...` CLI 이다. Raw file append/read 는 degraded mode 에서만 허용하며, 반드시 capturing tool diagnostics, affected artifact paths, active target, follow-up requirement or candidate ID 를 사용자 보고와 pipeline notes 에 남긴다.

---

## 0. 공통 규약 (SSOT)

| 키 | 규칙 |
|---|---|
| §0.1 | **SDS 는 코딩 에이전트용이다.** 영어로 쓰고 서사를 쓰지 않는다 — 모든 줄은 검사기가 읽는 선언이거나 계약이다. 사람이 읽는 문서는 SRS 다. |
| §0.2 | **검사는 결정적이다.** 작성한 SDS 는 MCP `check_sds` 로 검사한다(MCP 가 없을 때만 CLI `speckiwi sds check <path> --json`). 오류(error)가 하나라도 남으면 Status 를 `agreed` 로 올리지 않는다. |
| §0.3 | **기본 모드에는 LLM 검증 루프가 없다.** `--max` 는 독립 검증 서브에이전트 1회(one pass)만 더한다 — 루프가 아니다(§2.5). |
| §0.4 | **사용자 승인 게이트가 없다.** 검사를 통과하면 kiwi-sds 가 Status 를 `agreed` 로 스스로 올린다. 구현 전에 SDS 검토나 승인을 사용자에게 요청하지 않는다. 사용자 판단이 필요한 실질적 설계 문제는 SDS 검토가 아니라 **질문**(`AskUserQuestion`)으로 올리고, `--auto` 이면 `_shared/kiwi/auto-option.md` 의 결정 위원회가 정한다. |
| §0.5 | **SDS 는 일회성이다.** 한 run 동안만 산다. 닫힌(`closed`) SDS 와 지운 SDS 를 현재 설계로 읽지 않는다 — 현재 설계는 코드다. SDS↔코드 영구 드리프트 게이트를 만들지 않는다; SDS↔코드 대조는 그 run 안에서만 돈다. |
| §0.6 | **SRS 쓰기는 `--close` 에서만** guarded MCP mutation(`replace_acceptance_criteria`, `add_requirement`)으로 한다. 작성 모드는 SRS 를 쓰지 않는다. 본 스킬은 요구 status 를 바꾸지 않고 `verified` 를 쓰지 않는다. |
| §0.7 | **CLAUDE.md §6 시그니처 금지 / §7 변경 이력 금지.** |
| §0.8 | **`--auto` 옵션 SSOT**. 본 스킬은 `_shared/kiwi/auto-option.md` v1.0 을 따른다. `critical_gates[]` 는 §0.AG. |
| §0.9 | **`--mini` / `--loops N` 옵션 SSOT**. `_shared/kiwi/loop-option.md` v1.0 을 따른다. 본 스킬의 라운드는 §2.4 의 "검사 → 오류 수정 → 재검사" 한 바퀴다. 기본 상한 5, `--mini` 3, `--loops N` 은 N(동시 지정 시 `--loops` 우선, 경고). `--max` 의 검증자 1회와는 직교한다. |

### §0.AG — `--auto` critical_gates[] 선언

아래 게이트는 `--auto` **무관 항상** 멈추고 사용자 결정을 받는다. 결정 위원회로 넘기지 않는다.

| gate_id | reason | 발생 위치 |
|---|---|---|
| `sds-check-errors-unresolved` | 라운드 상한 안에 `check_sds` 오류가 남음 — 오류를 안은 SDS 는 `agreed` 가 될 수 없고, kiwi-pm 은 `agreed` 가 아닌 SDS 를 받지 않는다 | §2.4 |
| `sds-close-after-promotion` | `--close` 가 SRS 로 옮겨야 할 해석 결정의 요구가 이미 `verified` — 승급 뒤의 옮기기는 닫힌 요구를 조용히 고치는 일이므로 하지 않는다 | §3.1 3번 |
| `validate-spec-error` | `validate_spec` 가 error 급 진단을 하나라도 돌려줌 — 옮긴 명확화가 SRS 를 깨뜨렸다 | §3.1 6번 — SRS 를 고친 뒤 |
| `stability-frozen-violation` | `--close` 가 명확화할 AC 의 요구가 Stability `frozen` — frozen 요구의 본문은 이 경로로 바꾸지 않는다 | §3.1 3번 — SRS 를 쓰기 전 |

**`validate-spec-error` 를 관측하는 자리**: 위 표에서 이 행의 세 번째 칸이 가리키는 홉에서 MCP `validate_spec` 을 실행한다 — MCP 가 없으면 CLI `speckiwi validate --json` 이다. error 급 진단이 하나라도 남아 있으면 그 홉을 진행하지 않고 `validate-spec-error` 로 중단하며, `--auto` 도 이 중단을 덮지 못한다. 실행하지 않은 채 통과로 기록하지 않는다.

**`--auto` 가 해결하는 것**: 실질적 설계 질문(§0.4) — severity `business-decision` 이므로 결정 위원회가 자동 결정한다(confidence < 0.7 이면 critical 로 격상). 범위에서 빠지는 draft 요구(§2.1)는 게이트가 아니라 보고 항목이다.

---

## 1. 입력 / 출력

### 1.1 입력

| 입력 | 의미 | 기본값 |
|---|---|---|
| `TARGET` (positional) | 범위의 target | MCP `get_active_target` |
| `--req-filter <REQ-ID,...>` | 범위를 이 요구로 좁힌다 | target 의 열린 요구 전부 |
| `--sds-id <id>` | SDS 식별자 — 파일은 `docs/sds/<sds-id>.sds.md`. 소문자·숫자·`.`·`-` 만 쓰고 4~128자다 — `kiwi-pm` §0.14 세션 id 규칙과 같다 | `<target>-<slug>` (slug 는 작업 요지를 kebab-case 로) |
| `--convergence-registry <path>` | wave SDS 용. 이 레지스트리에서 recipe 가 `regenerate` 또는 `orchestrator-only` 인 경로를 Files·Test Plan 에 적지 않는다(§2.3) | 없음 — 아무 경로도 빼지 않는다 |
| `--existing-modules <path>` | wave 설계 기준선 JSON — `TARGET` 과 같은 wave(`wave-{n}`) 항목의 `existing_modules` 를 읽는다. 기준선은 wave 마다 키를 두므로 다른 wave 의 모듈은 읽지 않는다(§2.2, FR-FLOW-063 AC-7) | 없음 |
| `--close <sds-id>` | 마감 모드(§3) | off |
| `--auto` · `--max` · `--mini` / `--loops N` · `--model <name>` | §0.8 · §0.3 · §0.9 · 검증 서브에이전트 모델 | off / 현재 세션 모델 |
| `--no-pipeline-emit` | 위임 실행 표식 — 파이프라인 이벤트를 append 하지 않는다(§2.6) | off |

R-ORCH 와 kiwi-wave-master 는 wave 마다 `--sds-id {run_id}-wave-{n}`, 그 wave 의 `--req-filter`, run 의 `--convergence-registry`, 그 wave 설계 기준선의 `--existing-modules` 를 넘긴다.

### 1.2 출력

- `docs/sds/<sds-id>.sds.md` — lite SDS 하나. 상한을 넘으면 `docs/sds/<sds-id>-<k>.sds.md` (k = 1, 2, …) 여러 개(§2.3).
- 파이프라인 이벤트 1줄(§2.6).

---

## 2. 작성 흐름

```
Phase 0 : 범위 확정 + 같은 sds-id 파일 확인
Phase 1 : 요구 AC 와 관련 코드 읽기
Phase 2 : 초안 작성 (§9.7 템플릿)
Phase 3 : 결정적 검사 — 오류가 0 이 될 때까지 (라운드 상한 §0.9)
Phase 4 : (--max 에서만) 독립 검증자 1회
Phase 5 : Status agreed + 보고 + 이벤트
```

### 2.1 Phase 0 — 범위

1. target 을 해소한다(`TARGET` 또는 `get_active_target`).
2. `list_requirements` 로 그 target 의 요구를 읽는다. 범위는 status 가 `verified`·`discarded` 가 아닌 요구다.
3. 입력에 요구 필터가 있으면 범위를 그 ID 로 좁힌다(`--req-filter`).
4. Stability 가 `draft` 또는 `deprecated` 인 요구는 범위에서 **빼고** 목록을 보고한다(FR-FLOW-053 AC-1) — 설계는 구현을 위한 것이고, 구현 전 stability 게이트는 kiwi-srs-feasibility 의 몫이다.
5. 범위에 요구가 하나도 없으면 SDS 를 쓰지 않고 그렇게 보고한다.
6. `docs/sds/<sds-id>.sds.md` 나 그 조각 `docs/sds/<sds-id>-<k>.sds.md` 가 이미 있으면 그 SDS 의 Status 로 가른다(조각은 조각마다):

| 기존 SDS 의 `Status` | 처리 |
|---|---|
| `agreed` | **다시 쓰지 않는다** — Phase 3 검사만 돌리고 통과하면 그대로 재사용한다(재개가 SDS 를 다시 쓰지 않게 한다, FR-FLOW-064 AC-4) |
| `draft` | 이어서 쓴다 |
| `closed` | 쓰지 않는다 — 닫힌 SDS 는 현재 설계가 아니다(§0.5). 새 `--sds-id` 로 다시 부르라고 보고한다 |

조각의 Status 가 섞여 있으면(예: `closed` 와 `agreed`) 아무것도 쓰지 않고 그 상태를 보고한다.

### 2.2 Phase 1 — 읽기

범위의 요구마다 `get_requirement` 로 AC 본문을 읽는다. 관련 코드를 읽어, SDS 에 적을 파일 경로와 심볼이 저장소의 실제 모듈과 맞게 한다 — 이미 있는 모듈을 새로 만들지 않는다. `--existing-modules` 가 있으면 그 JSON 에서 `TARGET` 의 wave 항목이 가진 `existing_modules` 를 읽고, Interfaces 는 거기 적힌 모듈을 새로 만들거나 이름을 바꾸지 않는다 — 그 목록은 wave 검증이 결과를 대조하는 기준이다.

### 2.3 Phase 2 — 작성

`docs/rule/SDS-MD-Rules-v2.6.0.md` §9.7 템플릿을 `docs/sds/<sds-id>.sds.md` 로 복사해 채운다. 메타데이터는 `Document Type` = `sds`, `Profile` = `lite`, `Target`, `Status` = `draft`, `Date`, `Requirements` = §2.1 범위의 요구 ID(나눈 파일은 그 파일이 맡은 ID)이고, 절은 `## Interfaces`(`### Depends` 체인과 경로·시그니처·한 줄 책임을 적는 `### Files`), `## Acceptance Contracts`, `## Test Plan` 이다. 줄 문법은 §9.4 를 따른다. 작성 규칙:

1. **범위의 모든 요구 ID** 를 적어도 한 Files 줄이나 심볼 줄에 `@req` 로 적는다. 같은 ID 를 `Requirements` 행에 적으므로 빠진 ID 는 `SDS-E070` 오류로 나온다(§9.2).
2. SRS AC 를 해석한 결정마다 계약 한 줄 `SDS-AC-n (<REQ-ID> AC-m): WHEN … THE SYSTEM SHALL …` 을 적는다. AC 가 이미 정한 것을 되풀이하는 계약은 쓰지 않는다.
3. **모든 SDS-AC** 에 테스트 파일을 지명한 Test Plan 행을 둔다. 그 테스트는 테스트 줄에 `SDS-AC-<n>` 을 인용한다(`_shared/kiwi/test-sufficiency.md` §1).
4. **100 줄 상한**(§9.5)을 넘기지 않는다. 작업이 한 파일에 맞지 않으면 SDS 를 키우지 않고 작업 단위마다 파일을 **나눈다** — `docs/sds/<sds-id>-<k>.sds.md`. 나눈 파일도 각자 이 규칙 전부를 지키고, 범위의 요구 ID 는 나눈 파일들 어딘가에 모두 `@req` 로 나온다.
5. run 뒤에도 코드가 지켜야 할 **구조 규칙**(모듈 경계, 의존 방향, 금지된 결합 등)만 `## Durable Rules` 절에 한 줄씩 `- <rule> — <why it must outlive this run>` 로 적는다. §9.3 이 허용하는 읽히지 않는 절이며 `sds check` 는 읽지 않는다. 이 절에 적은 규칙만 §3.1 이 SRS 로 올린다 — 다른 구조 설명은 SDS 와 함께 버려진다.
6. **`--convergence-registry` 가 있으면**(wave SDS) 그 레지스트리에서 recipe 가 `regenerate` 또는 `orchestrator-only` 인 경로 — 인덱스, 등록 배열, README, 스킬 미러, 생성물 같은 공유 핫 파일 — 를 Files 에도 Test Plan 에도 적지 않는다. 레지스트리의 위치·모양·경로 매칭·우선순위는 `_shared/kiwi/run-ledger.md` 의 수렴 레지스트리 절이 정한다. 그 경로들이 워커 쓰기 집합(Files ∪ Test Plan 파일)에서 빠져야 wave 사이의 서로소 판정이 맞고, 그 경로는 호스트가 병합 뒤에 처리한다.

설계에 사용자 판단이 필요한 실질적 선택이 있으면 여기서 질문으로 올린다(§0.4). SDS 를 보여 주고 승인을 받는 절차는 없다.

### 2.4 Phase 3 — 결정적 검사

1. 작성한 파일마다 `check_sds` 를 부른다(MCP 부재 시 `speckiwi sds check docs/sds/<sds-id>.sds.md --json`).
2. 오류가 있으면 고치고 다시 검사한다. 한 번의 검사 → 수정 → 재검사가 한 라운드이며 상한은 §0.9 다.
3. 범위의 요구 ID 가 `@req` 에서 빠졌으면 `Requirements` 행 때문에 `SDS-E070` 오류로 나온다 — 다른 오류처럼 고친다. `SDS-E070` 은 파일마다 보므로, 나눈 경우에는 조각들의 `Requirements` 행을 합친 집합이 §2.1 범위와 같은지 검사 요약들로 확인하고 빠진 ID 는 맡을 조각에 넣는다.
4. 상한 안에 오류가 0 이 되지 않으면 `sds-check-errors-unresolved` 로 멈춘다 — Status 는 `draft` 로 남는다.

경고는 보고에 적는다.

### 2.5 Phase 4 — 독립 검증자 1회 (`--max` 에서만)

`--max` 가 없으면 이 Phase 를 건너뛴다. `--max` 이면 독립 검증 서브에이전트 **정확히 하나**를 한 번 띄운다(현재 세션 모델, `--model <name>` 으로 override). 입력은 SDS 파일, 범위 요구의 AC 본문, 저장소 경로뿐이고 작성자의 정당화는 주지 않는다. 검증자는 AC 를 잘못 해석한 SDS-AC, 빠진 계약, 코드와 맞지 않는 경로·심볼을 심각도와 함께 돌려준다. 작성자는 CRITICAL·HIGH 를 한 번 반영하고 Phase 3 검사를 다시 돌린다. 두 번째 검증 패스는 없다 — 남은 지적은 보고에 적는다.

### 2.6 Phase 5 — 합의·보고·이벤트

1. 검사 오류가 0 이면 메타데이터 Status 를 `agreed` 로 바꾼다. 이것이 합의다(§0.4).
2. 쓴 파일, 범위, 범위에서 뺀 요구, 남은 경고, `--max` 검증자의 남은 지적을 보고한다.
3. **Pipeline emit (의무)**: `_shared/kiwi/pipeline-event.md` v1.0.0 을 따라 종료 이벤트를 정확히 1줄 append 한다 — `skill` = `kiwi-sds`, `next_hint` = `kiwi-pm`, `artifacts.sds_files` = 쓴 파일 전부. 정상 경로는 MCP `workflow_pipeline_emit` 이고, 같은 문서 §5.1 의 손으로 짠 append 는 그 도구를 쓸 수 없을 때의 **degraded 폴백**이다(이벤트 자리는 같은 문서 §1 의 위치 규칙이 정한다). `--no-pipeline-emit` 을 받은 위임 실행은 append 하지 않는다.
4. 이벤트의 `run_id` 는 sds-id 다. 같은 sds-id 로 다시 부른 **재진입** 실행의 emit 키는 `{run_id}#r{n}` 이고(`_shared/kiwi/pipeline-event.md` §5.4), 재진입 emit 은 같은 `run_id` 의 이전 이벤트가 있어도 skip 하지 않는다.

---

## 3. 마감 — `--close <sds-id>`

구현이 끝난 SDS 를 닫는다. **멱등**이고 두 번 부른다: 한 번은 그 SDS 의 요구가 승급되기 **전**(옮기기, §3.1), 한 번은 승급 **뒤**(삭제, §3.2). 부를 때마다 SDS 상태가 허락하는 다음 단계를 한다.

MCP `check_sds` 로 `docs/sds/<sds-id>.sds.md` 의 요약(계약과 그 `(<REQ-ID> AC-m)`, `@req` 집합)을 읽고 시작한다. `<sds-id>.sds.md` 가 없고 조각 `<sds-id>-<k>.sds.md` 가 있으면 조각마다 이 절을 k 순서로 한다. 파일도 조각도 없을 때만 이미 닫힌 것이다 — 아무것도 하지 않고 그렇게 보고한다. Status 가 `closed` 면 §3.2 로 간다.

### 3.1 옮기기 — 승급 전

1. 계약마다 그것이 `(<REQ-ID> AC-m)` 을 **해석**하는지 판단한다 — AC 가 열어 둔 값·경계·오류 형태·순서를 정했으면 해석이다. AC 를 되풀이할 뿐이면 옮기지 않는다.
2. 해석하는 계약의 요구를 `get_requirement` 로 읽는다.
3. SRS 를 쓰기 전에 그 요구들을 모두 확인한다 — status 가 `verified` 인 것이 있으면 `sds-close-after-promotion`, Stability 가 `frozen` 인 것이 있으면 `stability-frozen-violation` 으로 멈추고, 이 SDS 의 어떤 요구에도 SRS 를 쓰지 않는다. 사용자가 둘 중 하나를 고른다: 그 요구를 저장소 절차대로 `implemented` 로 내리고 `--close` 를 다시 부른 뒤 다시 `verified` 로 올리거나(frozen 이면 stability 를 먼저 푼다), 옮기지 못한 결정을 보고에 남기고 Status 를 `closed` 로 두어 §3.2 로 간다.
4. 해석하는 계약마다 AC-m 을 **명확화**한다: 기존 AC-m 문장을 한 글자도 지우지 않고 그 뒤에 결정을 덧붙인다. 조건을 지우거나, SHALL 을 약하게 하거나, 요구하는 범위를 좁히는 문장은 약화이므로 쓰지 않는다. 한 요구의 명확화를 모아 `replace_acceptance_criteria({ id, items, dryRun })` 한 번으로 쓴다 — `items` 는 그 요구의 **모든** AC 를 지금 순서·지금 `checked` 값 그대로 담고 AC-m 의 `text` 만 바꾼다(순서가 바뀌면 AC 번호와 증거 행이 어긋난다). 먼저 `dryRun: true` 로 AC-m 만 바뀌는지 확인하고 적용한다. 그 결정이 이미 AC-m 에 들어 있으면 다시 덧붙이지 않는다.
5. `## Durable Rules` 의 규칙마다 `add_requirement({ type, scope, target, title, requirement, acceptanceCriteria, rationale, dryRun })` 로 **제약(constraint) 요구**를 올린다 — `type` 은 `constraint`, `target` 은 SDS 의 Target, `scope` 는 그 규칙이 묶는 요구의 scope, `rationale` 에 이 SDS 의 id 를 적는다. scope 가 갈리면 질문한다(`--auto` 면 위원회). `## Durable Rules` 에 없는 구조 규칙은 옮기지 않는다.
6. SRS 를 하나라도 고쳤으면 `validate_spec` 을 실행한다 — error 급 진단이 있으면 `validate-spec-error` 로 멈춘다(§0.AG).
7. SDS 메타데이터 Status 를 `closed` 로 바꾼다. 이 뒤로 이 SDS 는 현재 설계가 아니다(§0.5). 파일은 §3.2 까지 남는다 — 승급 직전의 테스트 충분성 확인이 Test Plan 을 읽기 때문이다.

### 3.2 삭제 — 승급 뒤

1. `@req` 집합의 요구마다 `get_requirement` 로 status 를 읽는다.
2. 모두 `verified` 또는 `discarded` 면 SDS 파일을 작업 트리에서 **지운다**(git 이 추적하는 파일이면 `git rm <path>`). 그 삭제는 호출자의 close-out 커밋이 싣고(커밋하지 않는 호출자는 그 사실을 보고한다), 파일 내용은 git 기록에 남는다.
3. 아니면 파일을 남기고, 승급되지 않은 요구를 보고한다.

### 3.3 이벤트

`--close` 실행도 §2.6 3번처럼 1줄 append 한다(`--no-pipeline-emit` 이면 생략). `run_id` 는 `<sds-id>-close` 이고, 두 번째 호출은 같은 run 의 재진입이므로 §2.6 4번의 `{run_id}#r{n}` 키로 emit 한다. `next_hint` 는 스스로 정한다: 파일을 하나라도 남겼으면 `kiwi-review-fix-loop`, 모두 지웠으면 `kiwi-commit-auto-push` — 리뷰 홉의 이벤트가 추천하던 다음 단계를 이 마지막 이벤트가 가리지 않게 한다. `kiwi-pipeline` 사이클은 이 추천을 스스로 잇지 않는다(그 스킬 §2.5).

### 3.4 호출 순서

| 호출자 | 옮기기(§3.1) | 삭제(§3.2) |
|---|---|---|
| `kiwi-pipeline` | `kiwi-pm` 뒤, `kiwi-review-fix-loop --close-reqs` 홉 **앞** — 그 홉이 승급하기 때문이다 | 그 홉과 테스트 충분성 확인 뒤 |
| `kiwi-orchestrator` · `kiwi-wave-master` (`_shared/kiwi/parallel-waves.md`) | 테스트 충분성 확인 뒤, 승급 단계 앞 | 승급 뒤 |
| `kiwi-pm` 단독 실행(`--no-final`·`--review-hop-owned-by-parent` 없이) | §6.4 인계에서 `kiwi-review-fix-loop` 홉 **앞** — CLOSE_SAFE 일 때만 | 그 홉 뒤 — 옮기기가 끝났을 때(MOVED)만 |
| `kiwi-coder` 단독 실행(`kiwi-pm` 자식이 아닐 때) | §8.4 후속 리뷰 앞 — `state.failed` 도 회귀 실패 잔존도 없을 때만 | 그 리뷰 뒤 — 옮기기가 끝났을 때(MOVED)만 |

---

## 4. 외부 의존성

| 도구 | 용도 | 부재 시 |
|---|---|---|
| `get_active_target` · `list_requirements` · `get_requirement` (MCP) | 범위와 AC 본문 §2.1 · §2.2 · §3.1 | halt — MCP 규칙 |
| `check_sds` (MCP) / `speckiwi sds check <path> --json` (CLI) | 결정적 검사 §2.4, 마감 요약 §3 | 둘 다 부재 시 halt — 검사 없이 `agreed` 로 올리지 않는다 |
| `replace_acceptance_criteria` · `add_requirement` (MCP) | 마감의 SRS 쓰기 §3.1 | halt — CLI 는 정상 mutation 경로가 아니다 |
| `validate_spec` (MCP) / `speckiwi validate --json` (CLI) | 마감 뒤 검증 §3.1 6번 | 둘 다 부재 시 halt |
| `workflow_pipeline_emit` (MCP) | 이벤트 §2.6 | `_shared/kiwi/pipeline-event.md` §5.1 degraded 폴백 |
