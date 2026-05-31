---
name: kiwi-srs-feasibility
description: "OpenCode/Hermes local-LLM variant for evaluating implementation feasibility of SpecKiwi requirements. Requires speckiwi mcp for normal status/stability outputs. Defaults to --max with one evaluator/worker and three clean evaluations. Triggers: kiwi feasibility, SRS feasibility."
---

# kiwi-srs-feasibility v0.8

> etc local-LLM profile: read ../_shared/kiwi/local-llm-profile.md before executing. It requires working speckiwi mcp, treats --max as the default, disables multi-worker fanout, uses one delegated worker/evaluator at a time, and advances only after three consecutive no-improvement evaluations.

**etc override:** If any legacy section below appears to allow CLI mutation fallback or direct normal SRS Markdown mutation, the shared etc local-LLM profile wins: normal SRS operations require `speckiwi mcp`; CLI is diagnostic/remediation only.

> User clarification gate means: ask the user directly in Default mode; use `direct user prompt` only in Plan mode when that tool is available.
> Model tier terms are role guidance, not provider names: `local-LLM max-profile`, `local evaluator`, and `local evaluator` map to the current host agent model and effort options available in the session.
> `--auto` policy: read `../_shared/kiwi/auto-option.md` when `--auto` is active. The `critical_gates[]` below always halt for user input.

활성 target 의 SRS 전수에 대해 **구현 가능성(feasibility) 일괄 평가** + **stability 라이프사이클 갱신**을 수행하는 스킬. `kiwi-srs` (단일 REQ authoring) 와 `kiwi-coder` (구현) 사이의 **승급 게이트**.

deprecated 예정인 `snoworca-feasibility` 의 후계. 입력 카디널리티가 1(단일 SRS_PATH) → N(target 전수 REQ) 으로 역전됨. speckiwi MCP 를 SSOT 로 사용.

**파이프라인 SSOT**: `../_shared/kiwi/pipeline-v1.md` 참조.
**매핑 정책 스키마**: `../_shared/kiwi/feasibility-policy-schema-v1.md` 참조.

---

## 0. 공통 규약 (SSOT)

| 키 | 규칙 |
|---|---|
| §0.1 | **검증자는 별도 위임 worker**. 인라인 자가검증 금지 |
| §0.2 | **검증자 입력 격리**. 시니어 분석가의 결론 JSON·정당화 전달 금지. 원본 REQ + 코드 + per-REQ 판정 결과 + 필터링된 컨텍스트만 |
| §0.3 | **코드 증거 우선**. 모든 implementability 판정은 코드 path:line 증거 첨부. 증거 없는 판정은 `evidence_strength: weak` 라벨 |
| §0.4 | **할루시네이션 금지**. 존재하지 않는 코드/함수 인용 시 §8.2 axis 2 (Evidence existence) CRITICAL. 블로커 근거가 코드와 무관한 추측이면 §8.2 axis 5 (Blocker substantiation) HIGH |
| §0.5 | **SRS-MD Authoring Rules v1.0.0 준수**. heading / ID 정규식 위반 금지 |
| §0.6 | **speckiwi MCP 우선 + 황금률**. CLI 직접 호출은 진단/복구 안내에만 허용. **황금률**: speckiwi MCP mutation 도구 호출 1회 = Markdown line-patch 1회. **mutation 호출 후 동일 SRS 파일에 manual file edit 사용 절대 금지** |
| §0.7 | **stable/frozen 승급은 항상 사용자 확인**. 정책 파일이 자동 허용으로 설정해도 본 §0.7 우선. User clarification gate 단일 호출 |
| §0.8 | **/snoworca-* 스킬 호출 절대 금지**. 로직만 차용, 실행은 본 스킬 내부 |
| §0.9 | **사실 위조 거절**. 존재하지 않는 코드/함수 판정 근거 거절 + `rejected_findings.log` |
| §0.10 | **Status 변경 권한 없음** (kiwi-pipeline-v1 §3.1). 신규 REQ 추가도 권한 없음. stability 만 변경. status 충돌 발견 시 보고만 |
| §0.11 | **transition guard 우회 금지**. SpecKiwi `stability-transition.js` 가 거부하는 transition 은 강제 진행 옵션 없음. `dryRun: true` 선행 검증 의무 |
| §0.12 | **외부 모듈 수정 시 사용자 확인 의무**. 작업 대상은 cwd 하위 모듈로 한정. cwd 외부 경로 수정 신호 감지 시 즉시 중단 + User clarification gate. 상세는 §0.G2 |
| §0.13 | **per-REQ 독립 mutation**. target 전체 일괄 트랜잭션 금지 — REQ 단위 독립 호출 + 결과 집계. 부분 실패 허용 |
| §0.14 | **정책 파일 미존재 시 §0.G6 기본 매핑**. `.kiwi/feasibility-policy.yaml` → `~/.kiwi/feasibility-policy.yaml` → §0.G6 순으로 fallback |
| §0.15 | **etc local-LLM profile SSOT**. 본 스킬은 `../_shared/kiwi/local-llm-profile.md` 를 따른다. `--max` 는 항상 기본값이고, multi-worker fanout 은 금지되며, 위임 worker/evaluator 는 한 번에 하나만 사용한다. 평가/개선 루프는 3회 연속 개선사항 없음 후 다음 단계로 진행 |

### §0.G — 핵심 게이트 결정표

#### §0.G1 — 황금률 (mutation ↔ manual SRS file edit)

| IF (조건) | THEN (동작) | 위반 severity |
|---|---|---|
| speckiwi mutation 도구 호출 (`update_stability` 등) | Markdown 자동 line-patch 1회 발생; 추가 manual SRS file edit 호출 금지 | — |
| mutation 호출 후 동일 `docs/spec/*.srs.md` 에 manual file edit 사용 | 차단 + 작성자 재spawn | **CRITICAL** (axis 10) |
| §1/§3/§5/§6 prose 영역 갱신 필요 | 본 스킬은 prose 영역 변경 책임 없음; skip | — |

#### §0.G2 — 외부 모듈 영향

| IF (감지 채널) | THEN (동작) |
|---|---|
| 평가 대상 REQ 의 trace 가 cwd 외부 path | 해당 REQ 단위 중단 + User clarification gate. **다른 REQ 는 계속 진행** (§0.13 per-REQ 독립) |
| feasibility 판정이 외부 모듈 변경을 전제 | 해당 REQ 단위 중단 + User clarification gate |
| Phase 1 code-context analyst 가 외부 경로 보고 | 해당 REQ 단위 중단 + User clarification gate |

User clarification gate 3옵션: `(1) 진행 승인` / `(2) 외부 변경 제외하고 cwd 한정 평가` / `(3) 해당 REQ skip (다음 REQ 진행)`. `feasibility_report.json.external_module_impact` 에 감지 내역 기록.

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
| 매핑 결과 `then.stability = stable` | 정책 `require_user_confirm` 값과 무관하게 **항상 User clarification gate** (§0.7) |
| 매핑 결과 `then.stability = frozen` | **본 스킬 권한 외** (kiwi-pipeline-v1 §3.2 의 frozen 권한 ⛔). 정책 파일이 frozen 매핑을 정의해도 거부 + ERROR 보고. frozen 은 별도 release 스킬 책임 |
| 사용자 승인 (stable) | mutation 진행 |
| 사용자 거부 | 해당 REQ stability 유지 (keep) + 결정 기록 |

#### §0.G6 — 기본 feasibility → stability 매핑 (정책 파일 fallback)

`../_shared/kiwi/feasibility-policy-schema-v1.md` §3 의 기본 매핑을 본 스킬 내부 결정표로 동일 적용. 정책 파일 부재 시 본 표 자동 적용.

| IF (feasibility) | IF (추가 조건) | THEN (stability) | 사용자 승인 |
|---|---|---|---|
| high | has_verification: true | `stable` | ✅ §0.G5 필수 |
| high | (default) | `evolving` | ❌ 자동 |
| medium | (default) | `keep` (현재 유지) | ❌ 자동 |
| low | (default) | `draft` | ⚠️ stable→draft 등 강등 시 필수 |
| blocked | status ∈ {in_progress, implemented, verified} | `keep` + 충돌 보고 | ❌ NO-OP |
| blocked | (default) | `deprecated` | ✅ 필수 |
| (매칭 실패) | — | `keep` | ✅ 필수 |

#### §0.G7 — `--auto` critical_gates[]

| gate_id | reason | location |
|---|---|---|
| `external-module-impact` | cwd 외부 path 영향 | §0.G2 |
| `stability-stable-promotion` | stable 승급은 항상 사용자 확인 | §0.G5 |
| `transition-guard-bypass` | SpecKiwi transition guard 강제 우회 금지 | §0.G4 |
| `status-conflict` | blocked 판정과 in_progress/implemented/verified status 충돌 | §0.G3 |
| `mcp-unavailable` | SpecKiwi MCP 부재. CLI diagnostics cannot replace normal status/stability output | Phase 0 |

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
| "--max", "정밀 검증" | `--max` | default on |
| "로컬 LLM", "OpenCode/Hermes", "정밀" | `--max` | default on (`../_shared/kiwi/local-llm-profile.md` v1.0) |
| "코드 경로 X" | `CODE_PATH` | cwd |
| "정책 파일 X" | `POLICY_PATH` | `.kiwi/feasibility-policy.yaml` 자동 탐색 |
| "--enable-research", "연구 보강" | `--enable-research` | off (활성 시 Phase 2.5 가동) |
| "연구 후보 한도 N" | `--research-limit` | 5 (Phase 2.5 **초기 호출 후보 REQ 수 상한**) |
| "REQ당 재호출 한도 N" | `--research-respawn-limit` | 2 (per-REQ 재spawn 횟수 상한, §9.3 가드) |
| "연구 타임아웃 N초" | `--research-timeout` | 240 (관점별 순차 처리 부분 결과 수신 상한) |
| "비용 상한 N", "최대 delegated worker N" | `--cost-cap` | unset (설정 시 Phase 0 사전추정치 초과 시 HALT) |
| "비용 보고 생략" | `--no-cost-report` | off (§11.5.3 비용 섹션 생략) |
| "sync retry 대기 N ms" | `--sync-retry-delay-ms` | 200 (§11.4 단계 a 대기 시간) |
| "보고 채널 X" | `--report-channel` | `doculight` (§11.5.2 1차 채널; `telegram` / `google-chat` fallback 가능) |

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
- User clarification gate 시뮬레이션 (§1.4.1)
- 보고에 `mode: "dry-run"` 명시

#### 1.4.1 User clarification gate 시뮬레이션 결정 알고리즘

| 조건 | simulated_response | dry_run_status |
|---|---|---|
| stable/frozen 승급 게이트 | `approve` (정책 `require_user_confirm: false` 인 경우) / `reject` (정책 strict) | `logged_ready` / `logged_blocked` |
| Status 충돌 게이트 | 정책 `gates.status_conflict_policy` 값 따름 | `logged_noop` / `logged_warn` / `logged_block` |
| 외부 모듈 영향 게이트 | `skip-req` (해당 REQ skip) | `logged_ext_skipped` |

---

## 2. Phase 흐름

```
Phase 0   : Bootstrap (preflight, TARGET 확인, 정책 로드, target snapshot)
Phase 1   : Pre-investigation (local evaluator × 1 순차 단일: code-context / existing-srs / policy-context)
Phase 2.0 : local evaluator 프리스크린 (N≥7 시; quick_pass / quick_block / senior_targets 분류)
Phase 2   : Per-REQ feasibility judgement (local-LLM max-profile 시니어, senior_targets 만)
Phase 2.5 : Research enrichment (조건부, --enable-research 시; kiwi-srs-research delegated worker 모드 호출)
Phase 3   : Target-wide synthesis (local-LLM max-profile 시니어, REQ 간 의존성·우선순위 종합)
Phase 4   : Mapping resolution (정책 → per-REQ stability 제안)
Phase 5   : Evaluation (single delegated evaluator, 3 consecutive clean evaluations)
Phase 6   : Severity gate + loop → §9.3 라우팅 (Phase 2.0/2/2.5/3/4) 또는 Phase 7
Phase 7   : User approval + dryRun verification
Phase 8   : Apply mutations + validate_spec + sync 점검 + 사용자 보고 (doculight + chat)
```

---

## 3. Phase 0 — Bootstrap

### 3.0 speckiwi 가용성 사전 점검

`kiwi-srs` §3.0 과 동일 절차. MCP 부재 시 HALT; CLI는 진단/복구 안내에만 사용 + 설치 가이드 출력. 기록: `preflight.json: { mcp, cli, halted, version, tools_detected }`.

추가 점검: 본 스킬이 사용하는 MCP 도구의 **존재 여부 동적 점검**. CLI 명령은 진단 참고일 뿐이며 PASS 조건이 아니다.

| 필수 도구 | MCP | CLI diagnostics | 미가용 시 |
|---|---|---|---|
| `update_stability` | ✅ 필수 | diagnostic only | HALT + 업그레이드 안내 |
| `get_active_target` | ✅ 필수 | diagnostic only | HALT |
| `list_requirements` | ✅ 필수 | diagnostic only | HALT |
| `get_requirement` | ✅ 필수 | diagnostic only | HALT |
| `validate_spec` / `summarize_target` | ✅ 필수 | diagnostic only | HALT |
| `tag_mutation` (가칭, 기존 REQ tag 갱신) | ⏳ optional | — | §11.3 첫 행 활성 토글에 사용 (없으면 임시 회피 경로 유지) |

가용성 결과를 `preflight.json.tools_detected` 에 도구별 boolean 으로 기록.

### 3.1 TARGET 확인

`kiwi-srs` §3.1 과 동일 우선순위. 사용자 `TARGET` 인자 → `get_active_target` → `speckiwi targets` 단일 자동 → User clarification gate.

### 3.2 정책 로드

1. `{cwd}/.kiwi/feasibility-policy.yaml` 존재 확인 → 로드
2. 미존재 시 `~/.kiwi/feasibility-policy.yaml` 확인 → 로드
3. MCP 미존재 시 §0.G6 기본 매핑 적용
4. 로드된 정책을 `policy-resolved.json` 에 출처 + 내용 기록

스키마 검증: `../_shared/kiwi/feasibility-policy-schema-v1.md` §5 규칙. 실패 시 HALT.

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

## 4. Phase 1 — Pre-investigation (local evaluator × 1, 격리, 순차 단일)

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

single local evaluator 사전조사 중 timeout/실패 발생 시 (Phase 2.5 의 §5.5 결정표와 동일 패턴):

| 성공 수 | 처리 |
|---|---|
| 3/3 정상 | Phase 2 진행 |
| 2/3 (1개 실패) | 누락 영역을 `phase1-degraded.json.missing` 에 기록하고 Phase 2 진행. Phase 2 시니어 프롬프트에 결손 marker 명시 (해당 영역 추론을 보수적으로 수행하도록 지시) |
| 1/3 (2개 실패) | HALT + 사용자 결정 (재시도 / 결손 marker 와 함께 강행 / 종료) |
| 0/3 (전수 실패) | HALT + 환경 점검 안내 (네트워크/MCP 가용성) |

기록: `phase1-degraded.json: { successful_analysts, failed_analysts, error_types }`.

---

## 5. Phase 2 — Per-REQ feasibility judgement (local-LLM max-profile 시니어)

### 5.1 청크 처리 + local evaluator 프리스크린

target snapshot 의 REQ 가 N≥7 이면 청크 단위로 분할 처리 (local evaluator 프리스크린 → senior_targets 만 local-LLM max-profile 시니어). N<7 이면 전체 local-LLM max-profile.

청크 크기 기본 5. 사용자 `--chunk-size` 로 조정. 임계 7 의 근거: 6 이하면 단일 local-LLM max-profile 호출 비용이 프리스크린 오버헤드보다 작다는 경험치 (사용자 정책 옵션화 가능 — `--no-prescreen` 으로 비활성).

#### 5.1.1 local evaluator 프리스크린 sub-phase

각 청크에 대해 1회 local evaluator 호출:

**입력**: 청크의 REQ 본문 (statement + AC + trace + status + stability) + Phase 1 산출물 요약 (code_context.modules, dependency_graph)

**판정 기준**:
- `senior_target`: 다음 중 하나 이상 만족 시
  - trace path 가 코드와 mismatch 의심
  - AC 가 자동 검증 가능 여부 모호
  - 의존 REQ 가 unstable/blocked
  - feasibility 가 명백히 high/blocked 양 극단이 아닌 medium 추정
- `quick_pass`: 명백한 high (trace 일치 + AC 명확 + 의존 healthy) → local-LLM max-profile 시니어 건너뛰고 default 매핑
- `quick_block`: 명백한 blocked (trace 비존재 + 외부 모듈 의존) → local-LLM max-profile 시니어 건너뛰고 deprecated 후보

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

quick_pass/quick_block 분류된 REQ 는 local-LLM max-profile 시니어 호출 없이 §7 매핑 단계로 직행 (local-LLM 안정성 우선). senior_targets 만 §5.2-§5.4 의 local-LLM max-profile 시니어 판정 수행. 평가자(§8)는 모든 분류를 동일 기준으로 검증 — quick_pass 의 예측이 틀리면 axis 1 (Score-label consistency) finding 발생 → Phase 2 재spawn 시 senior_targets 로 승격.

### 5.2 per-REQ 판정 입력

각 REQ 에 대해 local-LLM max-profile 시니어에게 전달:
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


## Extended References

- Read `references/extended-workflow.md` when executing or validating
research enrichment, mapping resolution, evaluation, mutation application, reporting, fallback, and pipeline event emission
.
- Keep `SKILL.md` as the core trigger and workflow map; load the reference file only after the relevant phase is reached.
