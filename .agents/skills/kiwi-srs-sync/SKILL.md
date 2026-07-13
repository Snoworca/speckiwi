---
name: kiwi-srs-sync
description: "코드를 먼저 구현한 뒤 그 변경분(git diff)을 분석하여 기존 speckiwi SRS 를 사후 동기화하는 reverse-direction 증분 SRS 스킬 v0.1. 핫픽스/탐색적 프로토타입/외부 PR 흡수/레거시 합류 후 SRS 갱신용. git diff 자동 감지(--base/--head/--staged/--since) + 3 standard 사전조사 병렬(intent/mapping/impact) + high-reasoning 시니어 분석가 + 현재 세션 모델을 상속하는 단일 검증 서브에이전트 + 4방향 분류(conflict/update/new-feature/new-scope) + dry-run 선행 의무 + 사용자 승인 후 MCP mutation. **TDD 의무화 제외** (kiwi-coder 와 반대 방향). 트리거 — kiwi srs sync, 코드 먼저 SRS 나중, SRS 사후 동기화, 핫픽스 SRS 반영, 코드-우선 SRS, reverse SRS sync, code-first srs update, post-hoc srs, srs catch-up, srs back-sync, 타겟 비교, 타겟 X 와 비교, SRS 와 코드 비교, SRS 업데이트, 타겟 SRS 업데이트, 구현된 코드 SRS 반영, 코드와 SRS 동기화. 평가·검증은 현재 세션 모델을 상속하는 단일 검증 서브에이전트로 수행하며 `--model <name>` 로 override 한다."
---
> Kiwi MCP rule: normal target-scoped SRS reads, mutations, validation, status/stability updates, acceptance-criteria changes, evidence, trace links, and completed-work logging require working `speckiwi mcp`. CLI is diagnostic/remediation only and is not a normal replacement for MCP mutations.
# kiwi-srs-sync v0.1.2

> Codex clarification gate means: ask the user directly in Default mode; use `request_user_input` only in Plan mode when that tool is available.
> Model tier terms are role guidance, not provider names: `high-reasoning`, `standard`, and `lightweight` map to the current Codex model and effort options available in the session.

코드 변경(git diff) → 기존 SRS 증분 동기화 스킬. spec-first 가 SSOT 원칙이지만, **현실에서 자주 발생하는 사후 동기화 케이스**를 위한 보조 스킬:

- 긴급 핫픽스 후 SRS 갱신
- 탐색적 프로토타입의 SRS 흡수
- 외부 기여 PR 의 사후 분류
- 레거시 코드의 신규 합류

본 스킬은 spec-first 원칙을 **우회하지 않고** 사후 정합화한다 — 변경된 코드를 4방향(conflict/update/new-feature/new-scope) 분류하여 기존 SRS 에 증분 반영하고, AC / 검증 evidence / status 까지 사후 등록한다.

---

## 0. 공통 규약 (SSOT)

| 키 | 규칙 |
|---|---|
| §0.1 | **TDD 의무화 제외**. 본 스킬은 reverse-direction (코드 우선) 이므로 `$kiwi-coder` 의 TDD 강제(§0.1) 미적용. 단, sync 결과 SRS 에 `tdd.applicable=true` REQ 가 추가됐는데 테스트가 없는 코드면 평가자가 MEDIUM 경고만 발행 (차단 X) |
| §0.2 | **dry-run 선행 의무**. 모든 MCP mutation 은 dry-run 산출물(`docs/analysis/srs-sync-{run-id}/proposed-mutations.md`) 생성 후 사용자 승인을 거쳐야 실행. `--auto-apply`/`--yes-all` 명시 시에만 자동 진행 |
| §0.3 | **/snoworca-\* 호출 절대 금지**. 로직만 차용, 실행은 본 스킬 내부 (프로젝트 project change-history and skill-boundary instruction — `.skillfactory` 작업장 규약) |
| §0.4 | **검증자는 별도 서브에이전트**. 인라인 자가검증 금지 |
| §0.5 | **검증자 입력 격리**. 시니어 분석가의 결론·정당화 전달 금지. 원본 diff + 기존 REQ + 분류 결과만 |
| §0.6 | **할루시네이션 금지**. 존재하지 않는 함수·파일·CVE·테스트 항목 추가 금지. 사실 위조 거절 + `rejected_findings.log` |
| §0.7 | **외부 모듈 수정 금지**. cwd 외부 path 가 diff 에 진입 시 즉시 §0.G2 발동 |
| §0.8 | **시그니처 금지** (project signature-ban instruction). 커밋·SRS·산출물 어디에도 AI 식별 정보 금지 |
| §0.9 | **speckiwi MCP 필수**. 정상 target-scoped SRS read/mutation/status/evidence 는 MCP 로만 수행한다. CLI 는 설치/버전/설정 진단과 MCP 복구 안내에만 사용하고 정상 fallback 이 아니다. MCP 부재 시 HALT |
| §0.10 | **MCP mutation 권한 SSOT** (7종 허용). `add_requirement` / `append_section_note` / `update_status` / `update_stability` / `add_trace_link` / `add_verification_evidence` / `add_completed_work`. `set_target_goal` / `set_active_target` / `init_project` 는 미허용 (스킬 책임 외) |
| §0.11 | **4방향 분류 SSOT** (kiwi-srs §3.3 계승). 모든 변경 단위는 `conflict` / `update` / `new-feature` / `new-scope` 중 정확히 1개로 분류. `unclassified` 허용 안 함 (사용자 게이트 발동) |
| §0.12 | **변경 단위 = 의미 단위**. 단일 파일이 여러 REQ 에 매핑될 수 있고, 단일 변경이 여러 분류축에 걸쳐있으면 분할. id 정규식: `change_unit.id` = `^CU-\d{3}$` |
| §0.13 | **사용자 확인 의무**. 4방향 분류 모호, conflict 발생, target 외 REQ 영향, draft 상태 REQ 변경 — 모두 Codex clarification gate 단일 호출 분해 |
| §0.14 | **plan_contract 무관**. 본 스킬은 plan.md 를 생성하지 않으므로 plan_contract 필드 부재. 산출물은 SRS Markdown + speckiwi MCP graph 양면 SSOT (planner 와 동일 원칙) |
| §0.15 | **검증 서브에이전트 모델 정책 SSOT**. 시니어 분석가·평가자 등 평가·검증은 **단일(single) 검증 서브에이전트(verification subagent)**로 수행하며 기본적으로 **현재 세션 모델(current session model)**을 상속한다 (기존 high-reasoning×1+standard×1 이중 모델 평가자 패널을 대체). `--model <name>` (또는 사용자가 지명한 모델) 로 이 검증 서브에이전트의 모델을 override 한다. 3 standard 사전조사·4방향 분류 게이트·dry-run 의무·심각도 게이트는 불변 |
| §0.16 | **`--auto` 옵션 SSOT**. 본 스킬은 `../_shared/kiwi/auto-option.md` v1.0 을 따른다. `--auto-apply` / `--yes-all` 은 사용자가 직접 명시했을 때만 dry-run 승인 단계 자체를 skip 하는 직접 적용 옵션이고, 부모 `--auto` 로 암묵 활성화되지 않는다. `--auto` 는 사용자 게이트를 decision worker 로 판단한다. 동시 명시 시 직접 사용자 입력으로 확인된 `--auto-apply` / `--yes-all` 의 직접 적용 의미가 우선이다. |
| §0.17 | **`--mini` / `--loops N` 옵션 SSOT**. 본 스킬은 `../_shared/kiwi/loop-option.md` v1.0 을 따른다. `--mini` = 검증-개선 루프 라운드 상한 3, `--loops N` = 라운드 상한 N(정수 ≥1). 동시 지정 시 **`--loops` 우선(경고)**. `--max` 와 직교(조합). 상한 도달 시 잔여 finding 보고(안전 게이트 불우회) |

### §0.G — 핵심 게이트 결정표

#### §0.G1 — dry-run ↔ apply 게이트

| IF | THEN |
|---|---|
| 평가자 PASS (CRITICAL=0+HIGH=0) + `--auto-apply` 없음 | dry-run 산출물 생성 + Codex clarification gate 4옵션 (apply-all / apply-selected / dry-run-only / abandon) |
| 평가자 PASS + 사용자가 직접 명시한 `--auto-apply` 또는 `--yes-all` | 즉시 MCP mutation 진행 + 사후 보고 |
| 평가자 FAIL (CRITICAL 또는 HIGH 잔존) | dry-run 만 출력, mutation 0건, 사용자 보고 |

#### §0.G2 — 외부 모듈 영향

| IF | THEN |
|---|---|
| git diff 에 cwd 외부 path 진입 | 즉시 중단 + Codex clarification gate 3옵션 (cwd 한정 / 외부 포함 진행 / 작업장 이동) |
| 변경 코드가 외부 모듈의 public API 호출만 추가 (외부는 수정 안 함) | WARN 만, 진행 |

#### §0.G3 — 4방향 분류 게이트

| 분류 | 정의 | 매핑 액션 |
|---|---|---|
| **conflict** | 변경 코드가 기존 REQ 의 AC 또는 dod 와 정면 충돌 (예: AC 가 "X 거부" 인데 코드가 "X 허용") | Codex clarification gate: (1) REQ AC 갱신 / (2) 코드 rollback / (3) deprecated 처리 |
| **update** | 기존 REQ 의 AC/Status/Stability 가 변경 코드 반영을 위해 갱신 필요 | `append_section_note` (AC 보강) + `update_status` (implemented/verified) + `update_stability` (필요 시 승급) |
| **new-feature** | 기존 target 내에 신규 REQ 추가가 필요 | `add_requirement` (target/scope 동일, 신규 REQ-ID 발급) |
| **new-scope** | 기존 target 의 어느 scope 에도 안 들어가는 신규 영역 | Codex clarification gate 3옵션: (1) 신규 scope 생성 — **본 스킬 범위 밖, `$kiwi-srs` 위임** (사용자 확정 후 본 스킬 종료) / (2) 기존 scope 확장 — `add_requirement` 호출 시 기존 scope 명 사용 (본 스킬 내 처리) / (3) 다른 target 으로 이동 — **본 스킬 범위 밖, 사용자가 `set_active_target` 수동 실행 후 본 스킬 재실행** |

#### §0.G4 — 개선 루프 발산

| IF | THEN |
|---|---|
| 시니어 재호출 3회 누적 | Codex clarification gate 4옵션 (draft-keep / partial-apply / force-apply / abandon) |
| 평가자 재호출 2회 누적 + 동일 finding 잔존 | 동일 |
| conflict 분류가 2라운드 연속 미해결 | 즉시 사용자 에스컬레이션 |

#### §0.G5 — `--auto` critical_gates[]

| gate_id | reason | location |
|---|---|---|
| `apply-all-force-apply` | 대량 SRS mutation 즉시 적용은 비가역 | §0.G1 |
| `conflict-code-rollback` | 코드 rollback 선택은 destructive 가능 | §0.G3 |
| `new-scope-creation` | 신규 scope 생성은 `$kiwi-srs` 책임 | §0.G3 |
| `stability-backward-transition` | stability backward transition 금지 | mutation planning |
| `external-module-impact` | cwd 외부 path 영향 | §0.G2 |
| `validate-spec-error` | validate_spec ERROR 잔존 시 mutation 금지 | final validation |
| `draft-req-mutation` | draft REQ 변경은 명시적 사용자 결정 필요 | §0.13 |
| `deprecated-req-mutation` | deprecated REQ 변경은 의도된 제거를 되돌릴 수 있음 | §0.13 |
| `frozen-req-mutation` | frozen REQ section/status/stability 변경은 release 정책 위험 | Phase 5 |
| `conflict-ac-change` | conflict 로 인한 AC 변경은 제품 의미 변경 | §0.G3 |
| `mcp-unavailable` | SpecKiwi MCP 부재. CLI 진단 가능 여부와 무관하게 정상 SRS mutation 대체 금지 | Phase 0 |

---

## 1. 입력 / 출력

### 1.1 필수 입력

(없음) — 활성 target 은 `get_active_target` 으로 자동 추출. git diff 는 기본 `HEAD vs main` 으로 자동 감지.

### 1.2 선택 입력 + 자연어 매핑

| 자연어 신호 | 인자 | 기본값 |
|---|---|---|
| "target v0.X", "타겟 X", "X 에 대하여", "X 와 비교", "X 와 동기화" | `TARGET` | `get_active_target` |
| "비교하고 업데이트", "구현된 코드 반영", "코드와 SRS 동기화" | (스킬 본 동작 — 추가 인자 없음) | (기본 흐름) |
| "base 가 develop", "X 브랜치 기준" | `--base` | `main` (없으면 `master`) |
| "현재 작업 분기" | `--head` | `HEAD` |
| "staged 만" | `--staged` | off (working tree 포함) |
| "어제부터", "ISO date 이후" | `--since=YYYY-MM-DD` | off |
| "이 파일들만" | `--files=src/x.ts,src/y.ts` (콤마 분리) | git diff 자동 |
| "자동 적용", "확인 없이" | `--auto-apply` 또는 `--yes-all` | off (dry-run 의무) |
| "자동", "묻지 말고", "auto", "사용자 게이트 자동" | `--auto` | off (`../_shared/kiwi/auto-option.md`; `--auto-apply`/`--yes-all` 과 별개) |
| "max 모드", "정밀" | `--max` | off (Normal) |
| "dry-run 만" | `--dry-run-only` | off (사용자 게이트에서 결정) |
| "외부 path 허용" | `--allow-external` | off |
| "--model <name>", "검증 모델 지정" | `--model <name>` | 현재 세션 모델 (단일 검증 서브에이전트) |
| "미니 모드", "빠른 모드", "3라운드" | `--mini` | off (스킬 기본 상한) |
| "루프 N회", "N라운드", "N번 돌려" | `--loops N` | off (스킬 기본 상한) |

### 1.3 모드 매트릭스

| 모드 | 사전조사 (standard) | 시니어 분석가 (high-reasoning) | 검증 서브에이전트 (현재 세션 모델) | 비용 배수 |
|---|---|---|---|---|
| Normal (기본) | × 3 (병렬) | × 1 | 단일 검증 서브에이전트 | 1.0× (기준) |
| `--max` | × 3 | × 1 | 단일 + 독립 2차 검증 패스 (2 연속 MEDIUM=0 종료) | 2.5~3× |

`--model <name>` 지정 시 검증 서브에이전트 모델을 override (기본은 현재 세션 모델).

### 1.4 출력 (산출물)

- **분석 디렉토리**: `docs/analysis/kiwi-srs-sync-{run-id}/`
  - `diff_inventory.json` — git diff 정규화 결과 (변경 파일·라인·hunk 단위)
  - `change_units.json` — 변경 단위 (CU-001…) + 4방향 분류
  - `intent.json` / `srs_mapping.json` / `impact.json` — 3 standard 사전조사 결과
  - `senior_analysis.json` — high-reasoning 분석가 통합 결과 (REQ 매핑 + AC 갱신 제안 + 신규 REQ 초안)
  - `eval_iter{N}.json` — 평가자 결과
  - `proposed-mutations.md` — dry-run 사람-읽기용 보고서 (사용자 검토 SSOT)
  - `proposed-mutations.json` — 기계 형식 mutation 큐
  - `applied-mutations.jsonl` — 실제 적용된 MCP 호출 로그 (mcp_call_log)
  - `rejected_findings.log`
- **MCP mutation** (사용자 승인 후): `add_requirement` / `append_section_note` / `update_status` / `update_stability` / `add_trace_link` / `add_verification_evidence` / `add_completed_work`
- **Markdown SRS 갱신**: speckiwi MCP 내부 line-patch (planner 황금률과 동일)

**Run-id**: `{YYYY-MM-DD}.{project-slug}.{target-slug}.sync-{ISO-time-short}`. 정규식 SSOT: `^[a-z0-9.-]{4,50}$`. ASCII kebab, ≤50자 (kiwi-planner §0.14 의 40자 상한 대비 `sync-...` suffix 만큼 확장).

### 1.5 dry-run 산출물 형식 (proposed-mutations.md)

```
## §1 변경 분석 요약
- 변경 파일: N개 / hunk: M개 / 변경 단위 (CU): K개
- 4방향 분류: conflict=A / update=B / new-feature=C / new-scope=D
- 영향 REQ: [REQ-ID 목록]
- 외부 모듈 영향: 없음 (또는 path 목록)
- validate_spec 결과: PASS / WARN n건 / ERROR n건  (§10.1 step 0 의무 호출 결과)

## §2 제안 mutation (호출 순서대로)
### CU-001 — update (FR-X-001)
- 동작: append_section_note ({id, section: "Acceptance Criteria", note: "..."})
- 근거: src/x.ts:45-67 의 새 분기 추가가 AC-3 의 미정 케이스를 커버
- 위험: 없음

### CU-002 — new-feature
- 동작: add_requirement ({target, scope, title, ...})
- 신규 REQ-ID 예약: FR-X-007 (기존 최대 +1)
- 근거: src/y.ts:80-120 가 새 endpoint 도입
- 검증 evidence: tests/y.test.ts#it_returns_200 통과 (add_verification_evidence type=test)
- 위험: 신규 REQ 라 사용자 검토 권장

## §3 분류 모호/충돌 항목 (있을 시)
...

## §4 사용자 게이트 4옵션
(1) apply-all  (2) apply-selected  (3) dry-run-only  (4) abandon
```

---

## 2. Phase 흐름

```
Phase 0 : Bootstrap (preflight, target 확인, git 환경 확인, REQ 인벤토리 로드)
Phase 1 : Diff 정규화 (git diff → change_units[] 분해, CU-id 발급)
Phase 2 : 3 standard 사전조사 병렬 (intent / srs-existing-mapping / impact)
Phase 3 : high-reasoning 시니어 분석가 (4방향 분류 + REQ 매핑 + AC 갱신 제안 + 신규 REQ 초안)
Phase 4 : 단일 현재 세션 모델 검증 서브에이전트 (격리 입력)
Phase 4.5: 개선 루프 (심각도 카운터)
Phase 5 : dry-run 산출물 생성 (proposed-mutations.md/.json)
Phase 6 : 사용자 게이트 (Codex clarification gate 4옵션) — `--auto-apply` 시 skip
Phase 7 : MCP mutation 일괄 적용 + 보고서
```

---

## 3. Phase 0 — Bootstrap

### 3.0 preflight

판정 순서:
1. MCP `get_active_target` 성공 → PASS
2. MCP 실패 → HALT. CLI `speckiwi --version` 은 설치/버전 진단과 MCP 복구 안내에만 사용하고 PASS 대체 조건으로 삼지 않는다.
3. git 환경 확인: `git rev-parse --git-dir` 성공 → PASS, 실패 시 HALT + 가이드
4. base/head ref 존재 확인: `git rev-parse --verify {ref}` 성공
5. 위 필수 조건 중 하나라도 실패 → HALT

기록: `docs/analysis/kiwi-srs-sync-{run-id}/preflight.json: { mcp, cli, git, base_ref, head_ref, halted }`.

### 3.1 TARGET 확정

1. `TARGET` 인자 → 최우선
2. `get_active_target` → 자동 채택
3. 둘 다 없음 → Codex clarification gate

**TARGET slug 규약**: 사용자 입력값을 그대로 사용 (정규화 없음). 즉 자연어 "타겟 1.0.0" → `TARGET=1.0.0`, "타겟 v1.0.0" → `TARGET=v1.0.0`. **`v` prefix 자동 부여·제거 금지** — speckiwi target 이름이 실제로 `v` 를 포함하는지는 `list_requirements` / `get_active_target` 응답으로만 결정. 사용자가 prefix 없이 입력했으나 활성 target 이 `v1.0.0` 이면 Codex clarification gate 으로 명시 확인 후 진행.

### 3.2 REQ 인벤토리 로드

- `list_requirements { target: TARGET }` → 전체 REQ 본문 + AC + Status + Stability
- `summarize_target { target: TARGET }` → scope 분포 + countsByStatus + countsByStability
- 모든 scope 목록 추출 (new-scope 분류 시 참조)

---

## 4. Phase 1 — Diff 정규화

### 4.1 git diff 수집

```
명령 (기본):
  git diff --no-color --unified=3 {base}...{head}

추가 옵션:
  --staged: git diff --staged --no-color --unified=3
  --since=DATE: git log --since={DATE} --name-only --pretty=format: → 파일 set → git diff
  --files=...: 명시된 파일만 diff
```

`--allow-external` 부재 시 cwd 외부 path 진입 즉시 §0.G2 발동.

### 4.2 hunk → change_unit 분해 규칙

- **1 hunk = 1 CU 기본**. 단, 동일 함수/메서드 내 인접 hunk 는 1 CU 로 병합 (AST/regex 기반).
- 파일 신규 생성 = 파일 전체가 1 CU.
- 파일 삭제 = `removed: true` 플래그가 붙은 CU.
- 이름 변경(rename) = 별도 `renamed: from→to` CU.

CU 스키마:
```json
{
  "id": "CU-001",
  "files": [{"path": "src/x.ts", "line_range": "45-67", "change_type": "modified|added|deleted|renamed"}],
  "diff_excerpt": "...",
  "symbol_hints": ["functionName", "ClassName.method"],
  "loc_added": N,
  "loc_removed": M
}
```

산출물: `diff_inventory.json`.

---

## 5. Phase 2 — 3 standard 사전조사 (병렬, 격리)

세 analyst 서로 격리. Phase 1 종료 후 메인이 통합.

### 5.1 intent analyst

입력: change_units[] + 변경된 파일의 commit message (git log) + diff_excerpt
출력: `intent.json`
```json
{
  "per_cu": [
    {
      "cu_id": "CU-001",
      "inferred_intent": "한 줄 요약",
      "evidence": ["commit msg", "함수명", "주석"],
      "confidence": "high|medium|low",
      "non_coding_signals": []
    }
  ],
  "ambiguities": []
}
```

### 5.2 srs-existing-mapping analyst

입력: change_units[] + 전체 REQ 인벤토리 (FR/NFR/AC + Stability + trace 정보)
출력: `srs_mapping.json`
```json
{
  "per_cu": [
    {
      "cu_id": "CU-001",
      "candidate_reqs": [
        { "req_id": "FR-X-001", "match_confidence": "high|medium|low", "match_basis": ["trace.code path", "AC text 유사도"] }
      ],
      "unmapped": false
    }
  ],
  "no_match_cus": ["CU-007"]
}
```

### 5.3 impact analyst

입력: change_units[] + 코드베이스 import graph
출력: `impact.json`
```json
{
  "per_cu": [
    {
      "cu_id": "CU-001",
      "affected_files": [],
      "affected_modules": [],
      "test_coverage_status": "covered|partial|none",
      "external_module_touch": false
    }
  ]
}
```

---

## 6. Phase 3 — high-reasoning 시니어 분석가 (4방향 분류)

### 6.1 입력

- 통합 사전조사 결과 (intent + mapping + impact)
- change_units[]
- 전체 REQ 인벤토리 (본문 포함)
- target goal

### 6.2 분류 로직

각 CU 에 대해 다음 순서로 시도:

```
1. mapping.candidate_reqs[0].match_confidence == high?
   YES → CU 코드 동작이 해당 REQ AC 와 충돌하는가?
         YES → conflict
         NO  → update (해당 REQ 의 AC/Status 보강)
   NO  → 2.

2. mapping.candidate_reqs 가 모두 low 또는 empty?
   YES → 변경 영역의 scope 결정:
         기존 scope 와 일치 → new-feature (해당 scope 내 신규 REQ 추가)
         기존 scope 와 무관 → new-scope (사용자 게이트)
   NO  → 3.

3. mapping.candidate_reqs 가 medium 매칭:
   → Codex clarification gate (모호성, 사용자 결정)
```

### 6.3 각 분류별 산출 필드

- **conflict**: `{cu_id, conflicting_req_id, conflicting_ac_id, conflict_summary, options: [...]}` → §0.G3 게이트
- **update**: `{cu_id, target_req_id, mutation_plan: [{tool, args}], rationale}`
- **new-feature**: `{cu_id, target, scope, draft_req: {title, description, acceptance_criteria[], stability: "evolving"}, suggested_id}`
- **new-scope**: `{cu_id, suggested_scope_name, draft_reqs[], rationale}`

### 6.4 신규 REQ-ID 예약 규칙

`list_requirements` 결과의 max numeric suffix + 1 (per scope). 예: `FR-AUTH-005` 까지 존재하면 신규는 `FR-AUTH-006`.

### 6.5 산출물

- `senior_analysis.json` — CU 별 분류 + mutation 큐
- `phase3_iter{N}.json` (재호출 시)

---

## 7. Phase 4 — 검증 서브에이전트 (현재 세션 모델)

### 7.1 검증 서브에이전트 구성

- Normal: 단일 검증 서브에이전트 (현재 세션 모델 상속)
- Max: 단일 검증 서브에이전트 + 독립 2차 검증 패스 (2 연속 MEDIUM=0 → PASS)
- `--model <name>` 지정 시 검증 서브에이전트 모델을 override (기본은 현재 세션 모델)

### 7.2 평가자 입력 (§0.5 격리)

- 원본 diff + REQ 인벤토리 + senior_analysis.json (단, **strip 의무**)
- **strip 의무 필드**: `senior_analysis.json.*.rationale`, `senior_analysis.json.*.conflict_summary` (정당화 본문), `senior_analysis.json.*.options[].justification` 등 시니어의 결론·정당화 텍스트. 메타데이터(`cu_id`, `classification`, `target_req_id`, `mutation_plan.tool`, `mutation_plan.args`, `suggested_scope_name`, `draft_req.{title,description,acceptance_criteria}`, `suggested_id`) 만 전달
- **금지**: strip 이후에도 시니어의 정당화·결론 텍스트를 별도 채널로 전달하지 말 것 (kiwi-srs §10.1 패턴 계승)

### 7.3 평가 축 (axis enum)

| axis | 이름 | severity 기준 |
|---|---|---|
| A1 | classification_correctness | conflict/update/new-feature/new-scope 분류 정확성 | 오분류=CRITICAL |
| A2 | conflict_detection | 실제 conflict 누락 여부 | 누락=CRITICAL |
| A3 | req_mapping_accuracy | CU↔REQ 매핑 정확성 | 오매핑=HIGH |
| A4 | ac_text_quality | 제안된 AC 갱신 텍스트가 검증 가능한 명제인가 | 모호=HIGH |
| A5 | new_req_completeness | 신규 REQ 의 description/AC 완결성 | 누락=HIGH |
| A6 | mutation_safety | 제안 mutation 이 SRS-MD-Rules 위반 없는가 (Stability backward 금지 등) | 위반=CRITICAL |
| A7 | external_module_guard | §0.G2 위반 | 위반=CRITICAL |
| A8 | code_test_coverage | new-feature 인데 테스트 0건이면 사후 보강 권고 | 미보강=MEDIUM |
| A9 | scope_creep | new-scope 가 실제로 신규인가 (기존 scope 로 흡수 가능한가) | 부적절=MEDIUM |
| A10 | rationale_grounding | 분류 근거가 diff 인용에 기반하는가 | 근거 부족=MEDIUM |

### 7.4 종료 조건

- Normal: CRITICAL=0 + HIGH=0 → PASS
- Max: 2 라운드 연속 MEDIUM=0 → PASS
- 미충족 시 §7.5 개선 루프

### 7.5 개선 루프

| finding axis | 분기 |
|---|---|
| A1·A2·A6·A7 (CRITICAL) | 시니어 재spawn |
| A3·A4·A5 (HIGH) | 시니어 재spawn |
| A8·A9·A10 (MEDIUM) | 시니어 1회 시도 후 잔존 시 사용자 보고만 |

루프 상한: 시니어 3회, 평가자 2회. 초과 시 §0.G4 발동.

---


## Extended References

- Read `references/extended-workflow.md` when executing or validating
dry-run output generation, user gate, MCP mutation application, examples, boundaries, and pipeline event emission
.
- Keep `SKILL.md` as the core trigger and workflow map; load the reference file only after the relevant phase is reached.
