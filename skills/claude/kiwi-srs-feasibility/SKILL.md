---
name: kiwi-srs-feasibility
description: "speckiwi MCP 활성 target 의 SRS 전수에 대해 구현 가능성(feasibility)을 정량 평가하고 그 결과로 stability(draft/evolving/stable/frozen/deprecated)를 일괄 갱신하는 스킬. get_active_target → list_requirements → per-REQ implementability/score → 종합 판정 → dryRun 선행 → 사용자 승인 → update_stability 적용. 3 Sonnet 사전조사 병렬 + Opus 시니어 분석가 + 현재 세션 모델을 상속하는 단일 검증 서브에이전트(Max는 + 독립 2차 검증 패스) + 심각도 게이트(Normal: CRITICAL=0+HIGH=0 / Max: 2연속 MEDIUM-zero). 트리거 — feasibility 검증, 활성 target feasibility, kiwi srs feasibility, target 전수 평가, stability 승급, 구현 가능성 일괄 평가, release readiness, freeze 게이트, 스프린트 진입 평가, kiwi feasibility, kiwi-srs-feasibility, batch feasibility, target-wide feasibility, srs feasibility gate, implementability assessment. --max 로 검증 강화(단일 검증 서브에이전트 + 독립 2차 검증 패스, 2연속 MEDIUM-zero 종료). --dry-run 으로 mutation 없이 제안만 출력. --scope/--priority 로 부분집합 평가. 평가·검증은 현재 세션 모델을 상속하는 단일 검증 서브에이전트로 수행하며 `--model <name>` 로 override 한다(게이트 불변, 자식 research 호출에 자동 전파)."
---
> Kiwi MCP rule: normal target-scoped SRS reads, mutations, validation, status/stability updates, acceptance-criteria changes, evidence, trace links, and completed-work logging require working `speckiwi mcp`. CLI is diagnostic/remediation only and is not a normal replacement for MCP mutations.
# kiwi-srs-feasibility v0.8

활성 target 의 SRS 전수에 대해 **구현 가능성(feasibility) 일괄 평가** + **stability 라이프사이클 갱신**을 수행하는 스킬. `kiwi-srs` (단일 REQ authoring) 와 `kiwi-coder` (구현) 사이의 **승급 게이트**.

deprecated 예정인 `snoworca-feasibility` 의 후계. 입력 카디널리티가 1(단일 SRS_PATH) → N(target 전수 REQ) 으로 역전됨. speckiwi MCP 를 SSOT 로 사용.

**파이프라인 SSOT**: `_shared/kiwi/pipeline-event.md` (이벤트 schema + next_hint 결정표) 참조.
**매핑 정책 스키마**: 본 문서 §0.G6 (기본 매핑 결정표) / §3.2 (정책 로드 우선순위) 참조.

---

## 0. 공통 규약 (SSOT)

| 키 | 규칙 |
|---|---|
| §0.1 | **검증자는 별도 서브에이전트**. 인라인 자가검증 금지 |
| §0.2 | **검증자 입력 격리**. 시니어 분석가의 결론 JSON·정당화 전달 금지. 원본 REQ + 코드 + per-REQ 판정 결과 + 필터링된 컨텍스트만 |
| §0.3 | **코드 증거 우선**. 모든 implementability 판정은 코드 path:line 증거 첨부. 증거 없는 판정은 `evidence_strength: weak` 라벨 |
| §0.4 | **할루시네이션 금지**. 존재하지 않는 코드/함수 인용 시 §8.2 axis 2 (Evidence existence) CRITICAL. 블로커 근거가 코드와 무관한 추측이면 §8.2 axis 5 (Blocker substantiation) HIGH |
| §0.5 | **SRS-MD Authoring Rules v1.0.0 준수**. heading / ID 정규식 위반 금지 |
| §0.6 | **speckiwi MCP 우선 + 황금률**. CLI 직접 호출은 MCP 부재 시에만. **황금률**: speckiwi MCP mutation 도구 호출 1회 = Markdown line-patch 1회. **mutation 호출 후 동일 SRS 파일에 `Edit` 도구 사용 절대 금지** |
| §0.7 | **stable/frozen 승급은 항상 사용자 확인**. 정책 파일이 자동 허용으로 설정해도 본 §0.7 우선. AskUserQuestion 단일 호출 |
| §0.8 | **/snoworca-* 스킬 호출 절대 금지**. 로직만 차용, 실행은 본 스킬 내부 |
| §0.9 | **사실 위조 거절**. 존재하지 않는 코드/함수 판정 근거 거절 + `rejected_findings.log` |
| §0.10 | **Status 변경 권한 없음**. 신규 REQ 추가도 권한 없음. stability 만 변경. status 충돌 발견 시 보고만 |
| §0.11 | **transition guard 우회 금지**. SpecKiwi `stability-transition.js` 가 거부하는 transition 은 강제 진행 옵션 없음. `dryRun: true` 선행 검증 의무 |
| §0.12 | **외부 모듈 수정 시 사용자 확인 의무**. 작업 대상은 cwd 하위 모듈로 한정. cwd 외부 경로 수정 신호 감지 시 즉시 중단 + AskUserQuestion. 상세는 §0.G2 |
| §0.13 | **per-REQ 독립 mutation**. target 전체 일괄 트랜잭션 금지 — REQ 단위 독립 호출 + 결과 집계. 부분 실패 허용 |
| §0.14 | **정책 파일 미존재 시 §0.G6 기본 매핑**. `.kiwi/feasibility-policy.yaml` → `~/.kiwi/feasibility-policy.yaml` → §0.G6 순으로 fallback |
| §0.15 | **검증 서브에이전트 모델 정책 SSOT**. 시니어 분석가·평가자 등 평가·검증은 **단일(single) 검증 서브에이전트**로 수행하며 기본적으로 **현재 세션 모델(current session model)**을 상속한다 (기존 Opus×1+Sonnet×1 이중 모델 평가자 패널을 대체). `--model <name>` (또는 사용자가 지명한 모델) 로 이 검증 서브에이전트의 모델을 override 한다. 검증 서브에이전트 구성 외 심각도 게이트·라운드 상한·per-REQ 독립 mutation 정책·**본 스킬 특유 게이트 §0.G1~§0.G6 (황금률 / 외부 모듈 / Status 충돌 / Transition guard / stable 승급 / 기본 매핑 fallback) 도 모두 불변**. 자식 호출 `kiwi-srs-research --mode=subagent` 시 `--model` 자동 전파 — §5.5.2 Agent 호출 site 에서 채널 1(`description` token) + 채널 2(prompt 본문) 이중 명시 (kiwi-srs-research §0.G6) |
| §0.16 | **`--auto` 옵션 SSOT**. 본 스킬은 `_shared/kiwi/auto-option.md` v1.0 을 따른다. 본 스킬의 `critical_gates[]` 는 §1.5 (아래) 참조. **자식 호출 `kiwi-srs-research` 시 `--auto` 자동 전파 의무** — §5.5.2 Agent 호출 site 에서 채널 1(`description` token) + 채널 2(prompt 본문) 이중 명시 (auto-option.md §7, kiwi-srs-research standalone 모드 한정 적용; subagent 모드는 silent skip). `--auto --model <name>` 합성 전파 시 둘 다 명시 |
| §0.17 | **`--mini` / `--loops N` 옵션 SSOT**. 본 스킬은 `_shared/kiwi/loop-option.md` v1.0 을 따른다. `--mini` = 검증-개선 루프 라운드 상한 3, `--loops N` = 라운드 상한 N(정수 ≥1). 동시 지정 시 **`--loops` 우선(경고)**. `--max` 와 직교(조합). 상한 도달 시 잔여 finding 보고(안전 게이트 불우회) |

### §0.G — 핵심 게이트 결정표

#### §0.G1 — 황금률 (mutation ↔ Edit)

| IF (조건) | THEN (동작) | 위반 severity |
|---|---|---|
| speckiwi mutation 도구 호출 (`update_stability` 등) | Markdown 자동 line-patch 1회 발생; 추가 Edit 호출 금지 | — |
| mutation 호출 후 동일 `docs/spec/*.srs.md` 에 `Edit` 도구 사용 | 차단 + 작성자 재spawn | **CRITICAL** (axis 10) |
| §1/§3/§5/§6 prose 영역 갱신 필요 | 본 스킬은 prose 영역 변경 책임 없음; skip | — |

#### §0.G2 — 외부 모듈 영향

| IF (감지 채널) | THEN (동작) |
|---|---|
| 평가 대상 REQ 의 trace 가 cwd 외부 path | 해당 REQ 단위 중단 + AskUserQuestion. **다른 REQ 는 계속 진행** (§0.13 per-REQ 독립) |
| feasibility 판정이 외부 모듈 변경을 전제 | 해당 REQ 단위 중단 + AskUserQuestion |
| Phase 1 code-context analyst 가 외부 경로 보고 | 해당 REQ 단위 중단 + AskUserQuestion |

AskUserQuestion 3옵션: `(1) 진행 승인` / `(2) 외부 변경 제외하고 cwd 한정 평가` / `(3) 해당 REQ skip (다음 REQ 진행)`. `feasibility_report.json.external_module_impact` 에 감지 내역 기록.

#### §0.G3 — Status 충돌 게이트

| IF | THEN |
|---|---|
| feasibility=blocked + REQ.status ∈ {in_progress, implemented, verified} | stability mutation skip + `status_conflict.log` 기록 + 사용자 보고 |
| feasibility=blocked + REQ.status ∈ {proposed, planned, blocked} | 정책에 따라 stability → deprecated 또는 keep |
| 정책 파일 `gates.status_conflict_policy: warn` | 진행하되 경고 출력 |
| 정책 파일 `gates.status_conflict_policy: block` | 전체 평가 중단 + 사용자 결정 대기 |

#### §0.G4 — Transition guard 협업

| IF | THEN |
|---|---|
| 매핑 결과가 transition guard 충돌 가능 (예: draft → stable 직행) | `dryRun: true` 선행 호출 → guard verdict 확인 |
| guard 거부 + `reason` 제공으로 통과 가능 | 정책 파일 `reason_template` 적용 후 재시도 |
| guard 거부 + reason 무관 | 사용자에게 대체 stability 선택 요청 또는 skip |
| guard 통과 + 사용자 승인 (필요 시) | `dryRun: false` 적용 |

#### §0.G5 — stable 승급 게이트 (frozen 은 권한 외)

| IF | THEN |
|---|---|
| 매핑 결과 `then.stability = stable` | 정책 `require_user_confirm` 값과 무관하게 **항상 AskUserQuestion** (§0.7) |
| 매핑 결과 `then.stability = frozen` | **본 스킬 권한 외** (frozen 승급 권한 ⛔). 정책 파일이 frozen 매핑을 정의해도 거부 + ERROR 보고. frozen 은 별도 release 스킬 책임 |
| 사용자 승인 (stable) | mutation 진행 |
| 사용자 거부 | 해당 REQ stability 유지 (keep) + 결정 기록 |

#### §0.G6 — 기본 feasibility → stability 매핑 (정책 파일 fallback)

아래 기본 매핑 결정표를 본 스킬 내부 정책으로 적용. 정책 파일 부재 시 본 표 자동 적용.

| IF (feasibility) | IF (추가 조건) | THEN (stability) | 사용자 승인 |
|---|---|---|---|
| high | has_verification: true | `stable` | ✅ §0.G5 필수 |
| high | (default) | `evolving` | ❌ 자동 |
| medium | (default) | `keep` (현재 유지) | ❌ 자동 |
| low | (default) | `draft` | ⚠️ stable→draft 등 강등 시 필수 |
| blocked | status ∈ {in_progress, implemented, verified} | `keep` + 충돌 보고 | ❌ NO-OP |
| blocked | (default) | `deprecated` | ✅ 필수 |
| (매칭 실패) | — | `keep` | ✅ 필수 |

---

## 1. 입력 / 출력

### 1.1 필수 입력

없음. 활성 target 을 speckiwi MCP `get_active_target` 으로 자동 조회.

### 1.2 선택 입력 + 자연어 매핑

| 자연어 신호 | 인자 | 기본값 |
|---|---|---|
| "target v0.X 평가" | `TARGET` | `get_active_target` 결과 |
| "scope X 만" | `--scope` | omit (전체 scope) |
| "priority high 만" | `--priority` | omit (전체 priority) |
| "stable REQ 도 재평가" | `--include-stable` | off (stable/frozen 은 skip) |
| "--dry-run", "제안만" | `--dry-run` | off (실제 mutation) |
| "--max", "정밀 검증" | `--max` | off |
| "--model <name>", "검증 모델 지정" | `--model <name>` | 현재 세션 모델 (단일 검증 서브에이전트) |
| "코드 경로 X" | `CODE_PATH` | cwd |
| "정책 파일 X" | `POLICY_PATH` | `.kiwi/feasibility-policy.yaml` 자동 탐색 |
| "--enable-research", "연구 보강" | `--enable-research` | off (활성 시 Phase 2.5 가동) |
| "연구 후보 한도 N" | `--research-limit` | 5 (Phase 2.5 **초기 호출 후보 REQ 수 상한**) |
| "REQ당 재호출 한도 N" | `--research-respawn-limit` | 2 (per-REQ 재spawn 횟수 상한, §9.3 가드) |
| "연구 타임아웃 N초" | `--research-timeout` | 240 (3 Opus researcher 부분 결과 수신 상한) |
| "비용 상한 N", "최대 sub-agent N" | `--cost-cap` | unset (설정 시 Phase 0 사전추정치 초과 시 HALT) |
| "비용 보고 생략" | `--no-cost-report` | off (§11.5.3 비용 섹션 생략) |
| "sync retry 대기 N ms" | `--sync-retry-delay-ms` | 200 (§11.4 단계 a 대기 시간) |
| "보고 채널 X" | `--report-channel` | `doculight` (§11.5.2 1차 채널; `telegram` / `google-chat` fallback 가능) |
| "자동", "묻지 말고", "확인 없이", "auto" | `--auto` (SSOT: auto-option.md v1.0) | off (사용자 결정 활성이 기본) |
| "미니 모드", "빠른 모드", "3라운드" | `--mini` | off (스킬 기본 상한) |
| "루프 N회", "N라운드", "N번 돌려" | `--loops N` | off (스킬 기본 상한) |

### 1.3 출력

- **speckiwi mutation**: `update_stability` per-REQ (§9.2)
- **tag 갱신**: `feasibility:{label}`, `feasibility-score:{NN}`, `feasibility-run:{run-id}` (§9.3, `add_requirement` 신규 만 — 기존 REQ tag mutation API 미존재 시 보고만)
- **분석 로그**: `docs/analysis/kiwi-srs-feasibility-{run-id}/`
  - `preflight.json` / `target-snapshot.json` / `cost-estimate.json` (Phase 0 사전 비용 추정, §5.5.6)
  - `per-req-judgement.json` / `summary.md`
  - `policy-resolved.json` (적용된 정책 + 출처)
  - `stability-mutations.json` (dryRun 결과 + apply 결과)
  - `eval_iter{N}.json` / `improvement_iter{N}.json`
  - `status_conflict.log` / `external_module_impact.log` / `rejected_findings.log` / `sync-mismatch.log` (§11.4 단계적 sync 점검)
  - `report.md` — 사용자용 종합 보고서 (보고 SSOT, §11.5.1)
  - `report-channels.json` — doculight viewer + chat message 채널 송출 결과 (§11.5.2)

**Run-id**: `{YYYY-MM-DD}.{project-slug}.{target-slug}.{seq}`
- `target-slug` = 활성 target 의 ASCII kebab. e.g. `v0.1` → `v01`
- `seq` = 동일 target 의 당일 평가 순번 (`.v01`, `.v02`...)

### 1.4 Dry-run 모드 (테스트·CI 전용)

`--dry-run` 또는 `KIWI_DRY_RUN=1`:

- speckiwi mutation 호출은 `dryRun: true` 로 전부 전송 → guard verdict 만 수집, 실제 변경 없음
- `outputs/proposed-stability/{target-slug}.json` 에 제안 결과 별도 저장
- AskUserQuestion 시뮬레이션 (§1.4.1)
- 보고에 `mode: "dry-run"` 명시

#### 1.4.1 AskUserQuestion 시뮬레이션 결정 알고리즘

| 조건 | simulated_response | dry_run_status |
|---|---|---|
| stable/frozen 승급 게이트 | `approve` (정책 `require_user_confirm: false` 인 경우) / `reject` (정책 strict) | `logged_ready` / `logged_blocked` |
| Status 충돌 게이트 | 정책 `gates.status_conflict_policy` 값 따름 | `logged_noop` / `logged_warn` / `logged_block` |
| 외부 모듈 영향 게이트 | `skip-req` (해당 REQ skip) | `logged_ext_skipped` |

### 1.5 `--auto` critical_gates[] 선언

본 스킬의 `--auto` 활성 시 사용자 강제 HALT 게이트:

| gate_id | reason | 발생 위치 |
|---|---|---|
| `stability-stable-promotion` | **stable 승급은 정책 무관 항상 사용자 확인** — 거버넌스 핵심. `then.stability = stable` 매핑은 release readiness 결정으로 비가역 | §0.G5 / §0.7 |
| `stability-frozen-violation` | frozen 매핑은 본 스킬 권한 외 — 정책이 정의해도 거부 + ERROR | §0.G5 |
| `status-conflict-block` | `gates.status_conflict_policy: block` 활성 시 평가 중단 — 사용자 결정 의무 | §0.G3 |
| `transition-guard-bypass` | SpecKiwi `stability-transition.js` guard 거부 → 강제 진행 옵션 없음, 사용자 대체 stability 선택 의무 | §0.11 / §0.G4 |
| `external-module-impact` | REQ trace 가 cwd 외부 path — 외부 시스템 비가역 변경 | §0.G2 |

---

## 2. Phase 흐름

```
Phase 0   : Bootstrap (preflight, TARGET 확인, 정책 로드, target snapshot)
Phase 1   : Pre-investigation (Sonnet × 3 병렬: code-context / existing-srs / policy-context)
Phase 2.0 : Sonnet 프리스크린 (N≥7 시; quick_pass / quick_block / senior_targets 분류)
Phase 2   : Per-REQ feasibility judgement (Opus 시니어, senior_targets 만)
Phase 2.5 : Research enrichment (조건부, --enable-research 시; kiwi-srs-research subagent 모드 호출)
Phase 3   : Target-wide synthesis (Opus 시니어, REQ 간 의존성·우선순위 종합)
Phase 4   : Mapping resolution (정책 → per-REQ stability 제안)
Phase 5   : Verification (단일 현재 세션 모델 검증 서브에이전트; Max: + 독립 2차 검증 패스)
Phase 6   : Severity gate + loop → §9.3 라우팅 (Phase 2.0/2/2.5/3/4) 또는 Phase 7
Phase 7   : User approval + dryRun verification
Phase 8   : Apply mutations + validate_spec + sync 점검 + 사용자 보고 (doculight + chat)
```

---

## 3. Phase 0 — Bootstrap

### 3.0 speckiwi 가용성 사전 점검

`kiwi-srs` §3.0 과 동일 절차. MCP/CLI 둘 다 부재 시 HALT + 설치 가이드 출력. 기록: `preflight.json: { mcp, cli, halted, version, tools_detected }`.

추가 점검: 본 스킬이 사용하는 MCP 도구/CLI 명령의 **존재 여부 동적 점검**. 버전 번호 hardcode 대신 도구 자체의 가용성으로 판정 — speckiwi 버전 명명 정책이 바뀌어도 본 스킬은 견고.

| 필수 도구 | MCP | CLI fallback | 미가용 시 |
|---|---|---|---|
| `update_stability` | ✅ 필수 | `speckiwi update-stability` | HALT + 업그레이드 안내 |
| `get_active_target` | ✅ 필수 | `speckiwi active-target` | HALT |
| `list_requirements` | ✅ 필수 | `speckiwi list` | HALT |
| `get_requirement` | ✅ 필수 | `speckiwi show` | HALT |
| `validate_spec` / `summarize_target` | ✅ 필수 | `speckiwi validate` / `speckiwi summary` | HALT |
| `tag_mutation` (가칭, 기존 REQ tag 갱신) | ⏳ optional | — | §11.3 첫 행 활성 토글에 사용 (없으면 임시 회피 경로 유지) |

가용성 결과를 `preflight.json.tools_detected` 에 도구별 boolean 으로 기록.

### 3.1 TARGET 확인

`kiwi-srs` §3.1 과 동일 우선순위. 사용자 `TARGET` 인자 → `get_active_target` → `speckiwi targets` 단일 자동 → AskUserQuestion.

### 3.2 정책 로드

1. `{cwd}/.kiwi/feasibility-policy.yaml` 존재 확인 → 로드
2. 미존재 시 `~/.kiwi/feasibility-policy.yaml` 확인 → 로드
3. 둘 다 미존재 시 §0.G6 기본 매핑 적용
4. 로드된 정책을 `policy-resolved.json` 에 출처 + 내용 기록

스키마 검증: 로드된 정책 파일의 필수 키(`rules[]`, `gates`) 존재 + 타입 정합성 확인. 실패 시 HALT.

### 3.3 Target Snapshot

```
list_requirements { target: TARGET }
```

결과를 `target-snapshot.json` 에 저장. 필드:
- 전체 REQ 수 / scope 분포 / status 분포 / stability 분포
- 평가 대상 필터링 (§4 인계 게이트 규칙 적용):
  - `--include-stable` 미지정 시 stable/frozen 제외
  - status ∈ {discarded, draft} 제외
  - `--scope` / `--priority` 옵션 적용
- 필터 후 N개 REQ → Phase 1 입력

N=0 분기:

| 조건 | 안내 | 권고 |
|---|---|---|
| `target_total = 0` (target 자체 비어있음) | "활성 target 에 REQ 가 0건. kiwi-srs 로 REQ 작성 선행 필요" | kiwi-srs / kiwi-srs-from-code 호출 |
| `target_total > 0 AND filtered = 0` (필터 후 0) | "총 {target_total}건 중 평가 대상 0건 (제외: stable/frozen {x}, discarded/draft {y}, scope/priority 필터 {z})" | `--include-stable` 또는 `--scope`/`--priority` 옵션 조정 |

양쪽 모두 종료. `target-snapshot.json.empty_reason` 에 분류 라벨(`target_empty` / `filter_excluded`) 기록.

---

## 4. Phase 1 — Pre-investigation (Sonnet × 3, 격리, 병렬)

### 4.1 Code context analyst

입력: `CODE_PATH` + target snapshot 의 REQ 목록 (id + trace + statement 요약)
출력: `code_context.json`
```json
{
  "modules": [
    { "path": "src/api.ts", "exports": [...], "complexity_estimate": "low|medium|high" }
  ],
  "trace_validation": [
    { "req_id": "FR-TODO-001", "trace_paths": [...], "all_paths_exist": true, "external_paths_detected": [] }
  ],
  "code_metrics": {
    "total_files": 42,
    "test_coverage_files": 18
  }
}
```

`external_paths_detected` 가 비어있지 않으면 §0.G2 게이트 발동.

### 4.2 Existing SRS analyst

입력: target snapshot
출력: `existing_srs_context.json`
```json
{
  "req_summaries": [
    { "id": "FR-TODO-001", "scope": "TODO", "status": "proposed", "stability": "draft", "ac_count": 3, "trace_count": 2, "dependencies": ["FR-TODO-002"] }
  ],
  "dependency_graph": { "nodes": [...], "edges": [...] },
  "scope_distribution": {...}
}
```

### 4.3 Policy context analyst

입력: `policy-resolved.json` + target snapshot
출력: `policy_context.json`
```json
{
  "policy_source": "project|user|default",
  "mappings_count": 7,
  "predicted_transitions": [
    { "req_id": "FR-TODO-001", "current_stability": "draft", "predicted_stability_range": ["evolving", "stable"], "requires_user_confirm": true }
  ],
  "transition_guard_warnings": []
}
```

### 4.4 격리

3 분석가 서로 격리. Phase 1 종료 후 메인이 결과 통합.

### 4.5 부분 실패 처리

3 Sonnet 사전조사 중 timeout/실패 발생 시 (Phase 2.5 의 §5.5 결정표와 동일 패턴):

| 성공 수 | 처리 |
|---|---|
| 3/3 정상 | Phase 2 진행 |
| 2/3 (1개 실패) | 누락 영역을 `phase1-degraded.json.missing` 에 기록하고 Phase 2 진행. Phase 2 시니어 프롬프트에 결손 marker 명시 (해당 영역 추론을 보수적으로 수행하도록 지시) |
| 1/3 (2개 실패) | HALT + 사용자 결정 (재시도 / 결손 marker 와 함께 강행 / 종료) |
| 0/3 (전수 실패) | HALT + 환경 점검 안내 (네트워크/MCP 가용성) |

기록: `phase1-degraded.json: { successful_analysts, failed_analysts, error_types }`.

---

## 5. Phase 2 — Per-REQ feasibility judgement (Opus 시니어)

### 5.1 청크 처리 + Sonnet 프리스크린

target snapshot 의 REQ 가 N≥7 이면 청크 단위로 분할 처리 (Sonnet 프리스크린 → senior_targets 만 Opus 시니어). N<7 이면 전체 Opus.

청크 크기 기본 5. 사용자 `--chunk-size` 로 조정. 임계 7 의 근거: 6 이하면 단일 Opus 호출 비용이 프리스크린 오버헤드보다 작다는 경험치 (사용자 정책 옵션화 가능 — `--no-prescreen` 으로 비활성).

#### 5.1.1 Sonnet 프리스크린 sub-phase

각 청크에 대해 1회 Sonnet 호출:

**입력**: 청크의 REQ 본문 (statement + AC + trace + status + stability) + Phase 1 산출물 요약 (code_context.modules, dependency_graph)

**판정 기준**:
- `senior_target`: 다음 중 하나 이상 만족 시
  - trace path 가 코드와 mismatch 의심
  - AC 가 자동 검증 가능 여부 모호
  - 의존 REQ 가 unstable/blocked
  - feasibility 가 명백히 high/blocked 양 극단이 아닌 medium 추정
- `quick_pass`: 명백한 high (trace 일치 + AC 명확 + 의존 healthy) → Opus 시니어 건너뛰고 default 매핑
- `quick_block`: 명백한 blocked (trace 비존재 + 외부 모듈 의존) → Opus 시니어 건너뛰고 deprecated 후보

**출력**: `prescreen-{chunk-id}.json`
```json
{
  "senior_targets": ["FR-TODO-001", "FR-TODO-005"],
  "quick_pass": [
    { "req_id": "FR-TODO-002", "predicted_feasibility": "high", "predicted_score_range": [80, 95] }
  ],
  "quick_block": [
    { "req_id": "FR-TODO-003", "blocker_summary": "trace path src/legacy.ts 비존재" }
  ]
}
```

quick_pass/quick_block 분류된 REQ 는 Opus 시니어 호출 없이 §7 매핑 단계로 직행 (비용 절감). senior_targets 만 §5.2-§5.4 의 Opus 시니어 판정 수행. 평가자(§8)는 모든 분류를 동일 기준으로 검증 — quick_pass 의 예측이 틀리면 axis 1 (Score-label consistency) finding 발생 → Phase 2 재spawn 시 senior_targets 로 승격.

### 5.2 per-REQ 판정 입력

각 REQ 에 대해 Opus 시니어에게 전달:
- REQ 본문 (statement + AC + trace + tags + status + stability)
- 관련 코드 (Phase 1 code_context)
- 의존 REQ 의 요약 (Phase 1 existing_srs_context)
- 평가 축 (§5.3)

### 5.3 평가 축

| 축 | 사용자 원어 | 평가 내용 | 점수 가중치 |
|---|---|---|---|
| **implementability** | 타당성 | 코드 구현 난이도 (low/medium/high/very-high/infeasible) | 30 |
| **evidence_strength** | 타당성 | trace path 실존 + 코드가 statement 와 일치하는지 | 20 |
| **dependency_health** | 타당성 | 의존 REQ 가 stable/evolving 상태인지, 순환 의존 여부 | 15 |
| **ac_verifiability** | 타당성 | AC 가 자동 검증 가능한가, 측정 가능 기준인가 | 15 |
| **scope_fit** | 효용성 | REQ 가 scope 경계와 일치, cross-scope 누수 없음 | 10 |
| **product_fit** | 효용성 | core/nice-to-have/out-of-scope | 10 |

총점 0~100 → 라벨 매핑: 80+ = `high`, 60-79 = `medium`, 40-59 = `low`, <40 = `blocked`.

"사용자 원어 매핑" 컬럼은 사용자 보고서 작성 시 자연어 변환 기준 — "타당성 평가" 는 implementability + evidence_strength + dependency_health + ac_verifiability 의 가중합 (80점) 으로, "효용성 평가" 는 scope_fit + product_fit (20점) 으로 환산.

### 5.4 출력

`per-req-judgement.json`:
```json
{
  "judgements": [
    {
      "req_id": "FR-TODO-001",
      "feasibility": "high|medium|low|blocked",
      "score": 85,
      "axes": {
        "implementability": { "score": 28, "rationale": "...", "evidence": ["src/api.ts:45-67"] },
        "evidence_strength": { "score": 18, "rationale": "..." },
        "dependency_health": { "score": 12, "rationale": "..." },
        "ac_verifiability": { "score": 13, "rationale": "..." },
        "scope_fit": { "score": 9, "rationale": "..." },
        "product_fit": { "score": 5, "rationale": "..." }
      },
      "blockers": [],
      "conditions": [],
      "has_verification": true,
      "current_stability": "draft",
      "current_status": "proposed",
      "external_module_impact": null
    }
  ]
}
```

---

## 5.5 Phase 2.5 — Research enrichment (조건부)

`--enable-research` 명시 시에만 활성. `kiwi-srs-research` 스킬을 **subagent 모드** 로 호출하여 모호한 블로커/조건을 가진 REQ 에 대한 연구 결과를 per-REQ judgement 에 병합.

### 5.5.1 트리거 조건

per-REQ judgement 결과 중 다음을 만족하는 REQ 가 연구 후보:

- `feasibility ∈ {medium, low}` AND `blockers.length > 0` AND 블로커 내용에 외부 의존/도메인 불확실성 신호
- 또는 `evidence_strength: weak` 항목이 2개 이상
- 또는 사용자가 `--research-targets="FR-X,FR-Y"` 로 명시

후보가 `--research-limit` (기본 5) 를 초과하면 정규화된 점수 낮은 순(불확실성 높은 순)으로 상위 N 선택. 초과 항목은 skip + 보고.

### 5.5.2 Subagent 호출 패턴

각 후보 REQ 당 1회 호출 (중복 방지). kiwi-srs-research 내부 토폴로지 = **Sonnet 1(Triage) + Opus 3(Code/External/Risk) + Opus 1(Synthesizer) = 5 sub-subagent**. 본 스킬은 호출자 turn 에서 직접 결과를 수신 (별도 호출자 측 subagent 없음).

**Mode flag 전달은 채널 1 (Agent 인자) + 채널 2 (prompt 본문 정확 문자열) 이중 명시** — kiwi-srs-research §0.G6 의 채널 우선순위에 따라 채널 1 이 1차 truth. 채널 2 는 backward-compat 안전망.

```
Agent({
  subagent_type: "general-purpose",
  description: "kiwi-srs-research subagent for FR-TODO-005 --mode=subagent",
  prompt: `
    kiwi-srs-research 스킬의 subagent 모드 절차(§3.1 Mode 결정, §7.2 반환 형식)를 적용하시오. 스킬 path 는 runtime 환경에서 자동 해석.

    --mode=subagent

    (이 토큰은 kiwi-srs-research §0.G6 채널 2 의 정확 문자열 매칭 대상입니다.
     mutation 호출 0건, JSON 객체만 반환.)

    대상 REQ_ID: FR-TODO-005
    연구 질문: "external API 의존성이 코어 모듈에 미치는 영향 평가"

    REQ 컨텍스트 (kiwi-srs-research §0.G5 허용 필드만):
      - statement / acceptance_criteria / trace / tags / status / stability
      - 블로커 후보 (객관적 사실, rationale 제거)
      - 코드 컨텍스트 (path:line 사실)

    금지 (kiwi-srs-research §0.G5 위반 회피):
      - 본 스킬의 feasibility 점수/라벨
      - 본 스킬의 권장 stability
      - axes[*].rationale, justification
      - predicted_transitions
      - 메인 세션의 선호·결론

    반환: research-summary.json 의 JSON 객체 (input_bias_warnings 필드 포함).
    Markdown 보고서·MCP mutation 일체 금지.
  `,
  run_in_background: true
})
```

`run_in_background: true` 로 다수 후보 병렬 호출. 메인은 4분 시간 상한 후 일괄 수신.

수신 후 `research-summary.input_bias_warnings` 필드 검사:
- 비어있지 않으면 본 스킬의 호출 prompt 가 §0.G5 금지 필드를 누설한 증거 → `research-invocations.json.input_bias_violations` 에 기록 + 다음 iter 호출 prompt 재점검

### 5.5.3 호출자 측 격리 (§0.2)

subagent 에 전달하는 prompt 는 다음을 strip:
- `per-req-judgement.json.judgements[*].axes[*].rationale`
- `policy_context.json.predicted_transitions[*]` (예측 결과)
- 메인 세션의 선호·결론

전달 허용:
- REQ 본문 (statement, AC, trace, tags, status, stability)
- 블로커 후보 (객관적 사실)
- 코드 컨텍스트 (path:line 사실)
- 연구 질문 (구조화된 질의)

### 5.5.4 결과 병합

subagent 가 반환한 `research-summary.json` 을 per-REQ judgement 에 병합:

```
per_req.research_enrichment = {
  "summary": research-summary.verdict_summary,
  "consensus_findings": [...],
  "dissent_findings": [...],
  "raw_archived_at": "docs/analysis/kiwi-srs-research-{run-id}/"
}
```

병합 후 **재판정 단계**: research 가 새로운 블로커를 발견했거나 기존 블로커를 해소한 경우, Phase 2 의 per-REQ 평가 축을 재계산. 점수/라벨 변경 가능.

재판정 결과는 `per-req-judgement.json` 에 `revised_after_research: true` 표시. 원본 판정도 `original_judgement` 필드로 보존 (감사 추적).

### 5.5.5 §0.13 권한 경계 유지

본 Phase 는 research 결과를 **REQ 본문에 영속화하지 않음** (MCP mutation 0건). 메모리상으로는 per-REQ judgement 에 enrichment 로 통합하고 §11.5.1 report.md 에 요약 기재하지만, speckiwi `append_section_note` (research 영속화) 는 본 스킬 권한 외 — `kiwi-srs-research` standalone 모드에서만 가능. 사용자에게 필요 시 별도 호출 안내:

```
보고 메시지:
  "research 결과를 REQ FR-TODO-005 의 research 필드에 영속화하려면 별도로 다음을 호출:
   /kiwi-srs-research --req-id FR-TODO-005 --mode=standalone"
```

### 5.5.6 비용 가드

- `--enable-research` 미지정 시 Phase 2.5 전체 skip (기본 off)
- `--research-limit` (기본 5) — **초기 호출 후보 REQ 수** 상한, 초과 후보 skip
- `--research-respawn-limit` (기본 2) — **per-REQ 재spawn 횟수** 상한. **§9.3 의 `req_respawn_count[req_id]` 카운터 상한과 동일** (단일 카운터, 다른 이름 별칭 아님)
- 동일 run 내 동일 REQ_ID 의 초기 호출 중복 방지 (캐시). 재spawn 은 `req_respawn_count` 별도 증분
- 각 subagent 호출 = 5 sub-subagent (Sonnet 1 + Opus 4 — Triage 1 Sonnet, Code/External/Risk 3 Opus, Synthesizer 1 Opus)
- 최악 시나리오 Phase 2.5 단독 비용: `(--research-limit) × (1 + --research-respawn-limit) × 5` sub-subagent. 기본 `5 × (1 + 2) × 5 = 75`. 비용 우려 시 limit/respawn-limit 하향 조정.
- **본 스킬 1 run 의 sub-subagent 총량 (Phase 1~8 합산, --enable-research 활성 시)**:
  - Phase 1 = 3 (Sonnet × 3 사전조사)
  - Phase 2.0 prescreen = ceil(N / chunk-size) (Sonnet, N≥7 시)
  - Phase 2 per-REQ = senior_targets 수 (Opus)
  - Phase 2.5 = 최대 75
  - Phase 5 evaluator = 1-2 × iter (Normal 단일 검증 서브에이전트 1 / Max +독립 2차 패스 2; Normal 최대 5 iter / Max 최대 15)
  - **총량 가드**: 위 합산이 사용자가 직관적으로 예측 가능하도록 `cost-estimate.json` 산출물(Phase 0 종료 시) 에 사전 추정치 기록 + 사용자에게 보고. `--cost-cap N` 옵션으로 상한 강제 가능 (초과 시 HALT + 옵션 조정 안내).

### 5.5.7 산출물

- `research-invocations.json`: 호출 후보 / skip / 실패 / 성공 로그
- `docs/analysis/kiwi-srs-feasibility-{run-id}/research-enrichment/`: 각 subagent 의 research-summary.json 사본

---

## 6. Phase 3 — Target-wide synthesis (Opus 시니어)

per-REQ 판정을 종합하여 target 전체 판정 도출.

출력: `synthesis.json`
```json
{
  "target": "v0.1",
  "total_reqs_evaluated": 25,
  "feasibility_distribution": { "high": 12, "medium": 8, "low": 3, "blocked": 2 },
  "target_verdict": "release-ready|conditionally-ready|not-ready",
  "critical_blockers": [
    { "req_id": "FR-TODO-007", "blocker": "..." }
  ],
  "dependency_chains": [
    { "chain": ["FR-TODO-001", "FR-TODO-002"], "weakest_link_score": 45 }
  ],
  "stability_drift_candidates": [
    { "req_id": "FR-TODO-005", "current": "stable", "feasibility_drift_to": "low", "reason": "..." }
  ]
}
```

---

## 7. Phase 4 — Mapping resolution

per-REQ judgement + 정책 → per-REQ stability 제안.

알고리즘:
1. 각 REQ 에 대해 정책 mappings 순회 → 첫 매칭 적용 (정책 순서 = 우선순위)
2. 매칭 결과 `then.stability` 가 `keep` 이면 현재 stability 유지
3. 매칭 결과가 §0.G5 (stable/frozen 승급) 에 해당하면 사용자 승인 플래그
4. transition guard 사전 검증 (§0.G4) — `dryRun: true` 호출
5. guard 거부 시 `reason_template` 적용 후 재시도 또는 fallback

출력: `mutation-plan.json`
```json
{
  "plan": [
    {
      "req_id": "FR-TODO-001",
      "current_stability": "draft",
      "proposed_stability": "evolving",
      "matched_rule_index": 1,
      "requires_user_confirm": false,
      "reason": "Feasibility=high (score 85). Blockers: none. Run: 2026-05-15.skf.v01",
      "dryrun_guard_verdict": "ok",
      "user_decision": null
    }
  ],
  "summary": {
    "total_mutations": 18,
    "auto_apply": 12,
    "user_confirm_required": 4,
    "no_op": 2,
    "guard_blocked": 0
  }
}
```

---

## 8. Phase 5 — Evaluation

### 8.1 평가자 입력 (§0.2 격리)

**허용**:
- 원본 target snapshot (REQ 본문 전체)
- Phase 1 산출물 (code_context, existing_srs_context, policy_context)
- Phase 2.0 산출물 (`prescreen-{chunk-id}.json` 전체 — quick_pass 의 예측 검증을 위해 필수)
- `per-req-judgement.json` 의 axes/blockers/conditions/has_verification 필드
- `synthesis.json` 의 verdict + distribution
- `mutation-plan.json` 의 plan + summary (rationale 필드 제외)
- 정책 파일 내용
- 직전 `eval_iter{N-1}.json` (있을 때)

**금지 (strip)**:
- `per-req-judgement.json.judgements[*].axes[*].rationale` (시니어 정당화)
- `synthesis.json.target_verdict_rationale` (있다면)
- 시니어 분석가의 내부 모놀로그

### 8.2 검증 축 (10개)

1. **Score-label consistency** — score 80+ 가 high 라벨? 매핑 일관성
2. **Evidence existence** — trace path:line 실존 확인 (Read 도구로 샘플 검증)
3. **AC verifiability ground** — AC 검증 가능 판정이 실제 AC 내용과 일치?
4. **Dependency cycle** — 의존 그래프 순환 누락?
5. **Blocker substantiation** — 블로커 사유가 코드 증거로 뒷받침?
6. **Mapping conformance** — Phase 4 매핑이 정책 mapping 순서대로 적용?
7. **Guard verdict honored** — dryRun guard 거부 시 무시하지 않음?
8. **Status conflict honor** — §0.G3 정책 따랐는가?
9. **Internal coherence** — per-REQ 판정 자체 일관성 (score↔label↔axes 합산)
10. **Golden rule violation (§0.G1)** — mutation 후 동일 SRS 파일 `Edit` 사용 흔적

### 8.3 출력 스키마

`kiwi-srs` §10.3 과 동일 구조. `finding_hash = sha1(f"{req_id or '_'}|{axis}|{evidence_path or '_'}")` lowercase hex 40자.

**severity 는 hash 입력에서 제외** — 평가자가 동일 finding 의 severity 를 HIGH↔MEDIUM 으로 흔들어도 동일 hash 가 되어 §9.2 진동 감지가 회피되지 않음.

### 8.4 토폴로지

평가·검증은 **단일 검증 서브에이전트**가 수행하며 기본적으로 **현재 세션 모델(current session model)**을 상속한다. `--model <name>` (또는 사용자가 지명한 모델) 로 이 검증 서브에이전트의 모델을 override 한다.

| 모드 | 검증 서브에이전트 | 모델 |
|---|---|---|
| Normal | 단일 검증 서브에이전트 × 1 | 현재 세션 모델 (`--model` override) |
| --max | 단일 검증 서브에이전트 + 독립 2차 검증 패스 | 현재 세션 모델 (`--model` override) |

---

## 9. Phase 6 — Severity gate + loop

### 9.1 심각도

| Level | 정의 |
|---|---|
| **CRITICAL** | trace path 비존재; score-label 불일치; 매핑 정책 위반; status 충돌 무시; transition guard 거부 우회; §0.G1 황금률 위반 |
| **HIGH** | 블로커 코드 증거 부재; 의존 순환 누락; AC 검증 가능 판정이 실제와 다름; 자체 점수 합산 오류 |
| **MEDIUM** | 판정 근거 약함; 정책 순회 모호; reason 템플릿 치환 누락 |
| **LOW** | tag 포맷; 보고서 wording |

### 9.2 종료 조건

**진동 카운터는 per-run 누적** (per-REQ 가 아님 — 동일 finding 이 다른 REQ 에서 반복되면 별도 hash 이므로 자연 분리).

#### Normal
- CRITICAL = 0 AND HIGH = 0 → 통과 (Phase 7)
- 미충족 → §9.3 재spawn 라우팅
- 최대 5회. 진동 (동일 finding_hash 3회) → 사용자 에스컬레이션

#### Max
- 2회 연속 `{CRITICAL, HIGH, MEDIUM}.length === 0` → 통과
- 최대 15회. 진동 (동일 finding_hash 2회) → 사용자 에스컬레이션
  - Max 가 Normal 보다 진동 임계가 낮은 의도: Max 는 MEDIUM-zero 까지 요구하므로 동일 finding 의 2회 반복은 평가자가 합의된 결함이라는 강한 신호. 더 일찍 사용자 에스컬레이션해야 사용자 시간 보호.

### 9.3 재spawn 라우팅

평가자 finding 의 axis · severity 에 따라 어느 Phase 를 재실행할지 결정:

| Finding axis (§8.2) | 재spawn 대상 | 비고 |
|---|---|---|
| 1 Score-label / 9 Internal coherence | Phase 2 (per-REQ judgement) | 시니어 분석 재수행 |
| 2 Evidence existence / 5 Blocker substantiation | Phase 2 | code evidence 재수집 후 재판정 |
| 3 AC verifiability ground | Phase 2 | AC 검증 가능성 재평가 |
| 4 Dependency cycle | Phase 3 (target-wide synthesis) | 의존 그래프 재구성 |
| 6 Mapping conformance / 7 Guard verdict / 8 Status conflict | Phase 4 (Mapping resolution) | 정책 매핑 재수행 |
| 10 §0.G1 황금률 위반 | 작성자 전체 재spawn | mutation 후 Edit 발견 시 작성자 교체 |
| **research-derived axis** (5 Blocker substantiation / 2 Evidence existence / 9 Internal coherence 중 finding 의 evidence 가 research-summary 를 인용) AND `--enable-research` 활성 | **Phase 2.5 재spawn** (kiwi-srs-research subagent 재호출) | 직전 research-summary 의 dissent/low-confidence 가 finding 근거인 경우 |

Phase 2.5 재spawn 발동 조건 (모두 AND 결합 만족 시):
1. `--enable-research` 활성
2. 해당 REQ 의 `revised_after_research: true` (Phase 2.5 가 이전 iter 에 적어도 1회 실행됨)
3. finding 의 `evidence` 필드가 `research-summary.json.consensus_findings[*]` 또는 `dissent_findings[*]` 를 직접 인용 (string match 또는 explicit ref)
4. 해당 REQ 의 `research-invocations.json.req_respawn_count[req_id]` < `--research-respawn-limit` (둘은 **동일 카운터**, §5.5.6 정의. 기본 2)

**조건 1 은 표 행과 중복 명시되어 있다** (가드 강조). 표 행만 평가해도 동일 결과.

재spawn 시 kiwi-srs-research 호출 prompt 구성 (§5.5.2 패턴 확장):
- 기존 `연구 질문` 필드는 유지
- **신규**: `sub_questions` 배열 필드 추가 — 직전 `research-summary.json.dissent_findings[*].claim` + `resolution_suggested` 를 풀어서 sub_questions 로 변환
- 본 배열은 kiwi-srs-research §4.3 의 Phase R0 Triage 가 수신하여 `triage.json.sub_questions` 의 시드로 사용 (Triage 가 추가 분해 가능)
- 재spawn 호출 description 에 `--respawn-iter={N}` 토큰 부착 (감사 추적)

---

## 10. Phase 7 — User approval + dryRun verification

### 10.1 사용자 승인 게이트

`mutation-plan.json.summary.user_confirm_required > 0` 또는 §0.G5 적용 항목 존재 시:

1. `report.md` 생성 (요약 + per-REQ proposed change 표)
2. **AskUserQuestion 단일 호출** (§0.7 보장):
   - 단일 질문에 stable 승급 / deprecated 강등 / status 충돌 3 카테고리를 분리된 옵션 그룹으로 제시
   - 각 그룹은 기본 "전체 승인" 옵션 + "개별 결정" 옵션 (선택 시 후속 호출)
   - 옵션 그룹 ≤ 4 (AskUserQuestion 도구 제약 준수)
3. 사용자가 "개별 결정" 선택 시에만 카테고리당 1회 추가 호출 (최악 3+1=4 회. 평소 1 회)
4. 사용자 결정을 `mutation-plan.json.plan[*].user_decision` 에 기록

### 10.2 최종 dryRun

승인 완료 후 `mutation-plan.json.plan` 전체에 대해 `dryRun: true` 재호출 → guard verdict 최종 확인.

| IF (1차 ↔ 2차 dryRun verdict) | THEN |
|---|---|
| 모두 동일 (ok ↔ ok) | Phase 8 진행 |
| 일부 항목 차이 (ok → blocked) | 차이 항목 자동 차단 + 사용자 재승인 게이트 (AskUserQuestion). 다른 항목은 진행 |
| 일부 항목 차이 (blocked → ok) | 의외 통과 — 사용자에게 보고 후 진행 여부 확인 |
| MCP 에러 (네트워크/timeout) | 해당 항목 system_failed 분류 + 보고 |

근거: 1차 dryRun 과 2차 사이에 외부 사용자/스킬이 동일 SRS 를 수정할 가능성 존재 (race). "동일 결과 기대" 는 가정일 뿐 보증 아님.

---

## 11. Phase 8 — Apply mutations + finalize

### 11.1 분류별 MCP 시퀀스

#### stability 변경

per-REQ 독립 호출 (§0.13):

```js
update_stability({
  id: "FR-TODO-001",
  stability: "evolving",
  reason: "Feasibility=high (score 85). Blockers: none. Evidence: src/api.ts:45-67. Run: 2026-05-15.skf.v01",
  dryRun: false
})
```

#### NO-OP (status 충돌 또는 keep)

mutation 호출 안 함. `mutation-plan.json` 에 `applied: false, reason: "..."` 기록.

#### guard 거부 잔존

Phase 7 에서 guard 거부 항목이 처리되지 않은 경우 (예: 사용자가 대체 stability 선택 거부) → mutation 안 함, 보고만.

### 11.2 결과 집계

`stability-mutations.json`:
```json
{
  "mode": "live|dry-run",
  "applied": [
    { "req_id": "FR-TODO-001", "from": "draft", "to": "evolving", "reason": "...", "ok": true }
  ],
  "skipped": [
    { "req_id": "FR-TODO-002", "reason": "status_conflict", "current_status": "in_progress" }
  ],
  "guard_blocked": [
    { "req_id": "FR-TODO-003", "attempted_to": "stable", "guard_reason": "..." }
  ],
  "user_rejected": [],
  "system_failed": [
    { "req_id": "FR-TODO-004", "error_type": "mcp_timeout|network_error|mcp_exception", "error_message": "..." }
  ],
  "summary": {
    "applied_count": 12,
    "skipped_count": 2,
    "guard_blocked_count": 0,
    "user_rejected_count": 0,
    "system_failed_count": 0
  }
}
```

### 11.3 tag 갱신 (선택적)

| IF (speckiwi 의 기존 REQ tag mutation API 가용성) | THEN |
|---|---|
| 가용 (현재 미제공, 미래 버전에서 추가 가능성 있음) | per-REQ 호출로 `feasibility:{label}` / `feasibility-score:{NN}` / `feasibility-run:{run-id}` 부착 |
| 미가용 (현재 기본 상태) | **임시 회피**: `mutation-plan.json` 에 제안 tag 만 기록 + 사용자 보고. 다음 `kiwi-srs` 호출 시 신규 REQ 에만 부착하도록 패턴 안내 |

**회피 성격**: 본 회피는 **임시** — speckiwi 가 향후 기존 REQ tag mutation API 를 추가하면 즉시 본 §11.3 의 첫 행 경로로 전환한다. 영구 우회 의도 아님. 현재 회피의 한계:
- feasibility 정보가 REQ 메타에 영속화되지 않아 다음 run 에서 drift 감지(stable→draft 등) 시점에 이전 feasibility 결과를 재참조 불가
- 사용자는 `docs/analysis/kiwi-srs-feasibility-{run-id}/` 의 보고서를 SoT 로 참고해야 함

**전환 트리거**: speckiwi changelog 에 tag mutation API 가 등장하면 Phase 0 §3.0 의 가용성 점검에 `tag_mutation` 항목 추가 + 본 §11.3 표의 첫 행 자동 활성.

### 11.4 validate_spec + summarize_target + sync 점검

- `validate_spec` — 전체 SRS 구조 검증
- `summarize_target { target: TARGET }` — 최종 상태 요약
- **MCP↔Markdown sync 점검 (전수)** — applied mutation 의 **모든** REQ 에 대해:
  1. `get_requirement { id }` 의 `stability` 필드 조회
  2. 동일 REQ 의 Markdown 파일에서 stability 필드 read
  3. 두 값 일치 → PASS
  4. 두 값 불일치 시 **단계적 대응**:
     | 단계 | 동작 |
     |---|---|
     | a. 자동 retry 1회 | `--sync-retry-delay-ms` (기본 200) 만큼 대기 후 `get_requirement` 재조회 (지연 sync 가능성). Markdown 재 read 도 함께. 200ms 근거: speckiwi 의 typical Markdown line-patch 지연 추정치, 환경(파일시스템·MCP IPC)에 따라 조정 권장 |
     | b. retry 후 일치 | `sync-mismatch.log` 에 transient 라벨로 1줄 기록 후 PASS (사용자 보고 생략) |
     | c. retry 후 여전히 불일치 | `sync-mismatch.log` 에 persistent 라벨 + 양쪽 값 + REQ id 기록 + 사용자 보고 (CRITICAL) |
     | d. 자동 복구 없음 | §0.G1 황금률 (mutation 후 Edit 금지) 때문에 자동 정정 불가. 사용자가 speckiwi MCP 동작을 확인하도록 안내 |

  - **`sync-mismatch.log` 포맷**: JSONL (1 REQ 1 line). 스키마:
    ```json
    { "run_id": "2026-05-18.skf.v01.v01", "req_id": "FR-TODO-001", "label": "transient|persistent", "mcp_value": "evolving", "md_value": "draft", "retry_count": 1, "retry_delay_ms": 200, "detected_at": "2026-05-18T13:01:23Z" }
    ```
    외부 도구 소비를 위해 필드명 고정. 추가 필드는 prefix `ext_` 권장.

  - 표본 추출 미사용 근거: applied 가 보통 ≤50건이므로 전수 read 비용 부담 작음. 결정적 보증이 안전.
  - 본 가드는 §0.G1 황금률이 speckiwi MCP 의 자동 Markdown sync 동작에 의존하므로, 그 가정 자체를 검증.

### 11.5 사용자 보고

본 Phase 는 **2 채널 보고** 의무: (a) 대화 메시지 요약 + (b) doculight viewer 노출. 둘 다 동일 `report.md` 를 source of truth 로 함.

#### 11.5.1 report.md 생성 (보고 SSOT)

`docs/analysis/kiwi-srs-feasibility-{run-id}/report.md` 작성. 본 파일이 §11.5.2 / §11.5.3 양 채널의 공통 SoT.

권장 섹션:
1. 메타 (run-id, target, 평가일, 모드)
2. Feasibility 분포 + Target 종합 판정
3. Stability 변경 결과 표 (per-REQ)
4. Status 충돌 REQ 목록
5. guard 거부 / 사용자 거부 항목
6. 다음 단계 권고
7. Phase 2.5 research 결과 요약 (활성 시)

#### 11.5.2 doculight viewer 노출

```js
mcp__doculight__open_markdown({
  path: "docs/analysis/kiwi-srs-feasibility-{run-id}/report.md",
  title: "kiwi-srs-feasibility {target} {run-id}"
})
```

호출 실패 또는 doculight MCP 부재 시 **순차 fallback**:

| 순위 | 채널 | 조건 | 동작 |
|---|---|---|---|
| 1 | doculight viewer | `open_markdown` 성공 | viewer 노출 + `status: opened` |
| 2 | doculight update | `search_documents` 가 동일 target 기존 보고서 탐색 성공 | `update_markdown` 덮어쓰기 안내만 (자동 덮어쓰기 금지) + `status: updated` |
| 3 | telegram | `--report-channel telegram` 명시 또는 doculight 1·2 모두 실패 + telegram MCP 가용 | `send_telegram_markdown` 으로 report.md 요약(≤4096자) 송출 + `status: sent` |
| 4 | google-chat | `--report-channel google-chat` 명시 또는 doculight·telegram 모두 실패 + google-chat MCP 가용 | `send_google_chat_markdown` 송출 + `status: sent` |
| 5 | path-only | 위 채널 전부 실패 또는 부재 | §11.5.3 메시지에 `report.md` 절대경로만 포함 + `status: unavailable` |

`--report-channel` 옵션은 *우선 시도 채널* 만 지정 — 해당 채널이 실패하면 다음 순위로 자동 fallback.

`report-channels.json` 에 채널별 결과 기록:
```json
{
  "primary_channel_requested": "doculight|telegram|google-chat",
  "doculight": { "status": "opened|updated|unavailable", "viewer_id": "...", "path": "..." },
  "telegram": { "status": "sent|skipped|unavailable", "char_count": 0 },
  "google_chat": { "status": "sent|skipped|unavailable", "char_count": 0 },
  "chat_message": { "status": "emitted|skipped", "char_count": 0 }
}
```

- `chat_message.status="emitted"`: 어시스턴트 응답에 §11.5.3 메시지 텍스트가 포함됨 (사용자 *수신·읽음* 여부는 본 스킬 책임 외)
- `chat_message.status="skipped"`: 사용자가 `--no-chat-report` 옵션 명시 또는 dry-run 모드에서 메시지 생략

#### 11.5.3 대화 메시지 요약

```markdown
## kiwi-srs-feasibility 완료 보고

- run-id: {YYYY-MM-DD}.{slug}.{target-slug}.{seq}
- target: {TARGET}
- 평가 REQ 수: {N}
- Feasibility 분포: high {n}, medium {n}, low {n}, blocked {n}
- Target 종합 판정: {release-ready | conditionally-ready | not-ready}

### Stability 변경 결과
- 적용: {applied_count}
  - draft → evolving: {n}
  - draft → stable: {n} (사용자 승인 완료)
  - * → deprecated: {n} (사용자 승인 완료)
- skip (status 충돌): {skipped_count}
- guard 거부: {guard_blocked_count}
- 사용자 거부: {user_rejected_count}

### Status 충돌 REQ
| REQ ID | status | feasibility | 권고 |
|---|---|---|---|
| FR-TODO-005 | in_progress | blocked | kiwi-coder 중단 검토 |

### 다음 단계
- evolving REQ 는 kiwi-coder 로 구현 단계 진입 가능
- deprecated REQ 는 SRS 재작성 또는 scope 제거 검토
- guard 거부 REQ 는 정책 검토 또는 수동 update_stability

### 비용 (--enable-research 활성 시)
- Phase 2.5 호출 후보: {N} REQ (limit {--research-limit})
- Phase 2.5 재spawn: 총 {N} 회 (per-REQ 상한 {--research-respawn-limit})
- 본 run sub-subagent 총량 (사전추정/실측): {est}/{actual}
- cost-cap: {--cost-cap or "unset"}

### 보고 채널
- 1차 채널 ({primary_channel_requested}): {opened|updated|sent|unavailable}
- fallback 사용: {none|telegram|google-chat|path-only}
- 분석 로그: docs/analysis/kiwi-srs-feasibility-{run-id}/
- 보고서 (SSOT): docs/analysis/kiwi-srs-feasibility-{run-id}/report.md
```

비용 섹션은 `--enable-research` 비활성 또는 `--no-cost-report` 옵션 시 생략. 사전추정(`cost-estimate.json`)과 실측을 함께 표기하여 가드 정확도 모니터링.

---

## 12. MCP / CLI fallback

| 작업 | MCP | CLI fallback |
|---|---|---|
| Active target | `get_active_target` | `speckiwi active-target --json` |
| Target 활성화 | `set_active_target` | `speckiwi set-active-target <t>` |
| REQ 조회 | `get_requirement` | `speckiwi show <id> --json` |
| REQ 목록 | `list_requirements` | `speckiwi list --target <t> --json` |
| **Stability 변경** | **`update_stability`** | **`speckiwi update-stability <id> <stability> --reason ... [--dry-run]`** |
| 검증 | `validate_spec` | `speckiwi validate --json` |
| 요약 | `summarize_target` | `speckiwi summary --target <t> --json` |

---

## 13. 수렴 기준 (Phase 8 객관 메트릭)

- `validate_spec` PASS
- Normal: 루프 ≤ 5 iter; Max: ≤ 15 iter
- Normal 종료: CRITICAL = 0 ∧ HIGH = 0
- Max 종료: 2 consec iter 에서 CRITICAL/HIGH/MEDIUM 합산 = 0
- mutation-plan 의 `applied + skipped + guard_blocked + user_rejected + system_failed` = 평가 대상 REQ 수
- 모든 mutation 의 guard verdict = ok

---

## 14. 주의사항

- **Status 변경 권한 없음** (§0.10) — feasibility=blocked 라도 Status 는 그대로 두고 stability 만 변경 (또는 keep + 보고)
- 신규 REQ 추가 권한 없음 — REQ 작성은 `kiwi-srs` 담당
- `stable` / `frozen` 승급은 정책 무관 항상 사용자 승인 (§0.7, §0.G5)
- transition guard 우회 금지 (§0.11)
- per-REQ 독립 mutation, 부분 실패 허용 (§0.13)
- 검증자 출력은 `eval_iter{N}.json` 파일로 저장, 메인에는 summary count + top 3 CRITICAL/HIGH 만 로드
- `/snoworca-feasibility` 호출 절대 금지 (§0.8)
- 외부 모듈 영향 발견 시 해당 REQ 단위 중단 (§0.G2) — 전체 중단 아님

---

## 15. 파이프라인 위치

```
kiwi-srs (authoring) → kiwi-srs-feasibility (target 전수 평가) → kiwi-coder (구현)
                              ↑ 본 스킬
```

상세는 `_shared/kiwi/pipeline-event.md` §4 (next_hint 결정표) 참조.

---

## 16. Pipeline event emit (의무)

`~/.claude/skills/_shared/kiwi/pipeline-event.md` v1.0.0 의 §2 schema 와 §5 emit 패턴을 따라 본 스킬 1회 실행 종료 직전 `./kiwi/pipeline.jsonl` 에 정확히 1줄 append. 멱등성: 동일 `run_id` 의 이벤트가 이미 존재하면 skip.

- `skill`: `"kiwi-srs-feasibility"`
- `status`: 정상 종료 = `TASK_DONE`; dry-run = `DRY_RUN`; 사용자 보류 = `NEEDS_USER`; 실패 = `FAILED`
- `next_hint`: 평가 결과 stability ≥ evolving 다수 → `"kiwi-planner"`; 블로커 모호 다수 → `"kiwi-srs-research"`; 혼재 → `null` (사용자 결정)
- `req_ids`: 본 호출에서 stability 가 변경된 REQ-ID 배열
- `artifacts.analysis_dir`: `docs/analysis/kiwi-srs-feasibility-{run-id}/`
- `notes`: stability 전이 통계 ("draft→evolving:5 evolving→stable:2 → deprecated:1") 권장

emit 실패는 best-effort.
