---
name: kiwi-pipeline
description: "kiwi-* 스킬 파이프라인 메타 오케스트레이터. ./kiwi/pipeline.jsonl 의 직전 이벤트를 읽어 다음 단계를 추천하고, 사용자 게이트 후 자동 진행한다. 결정표 T1 (직전 skill × status → next_hint) 적용 + Codex clarification gate 다지선다 + --auto 모드 자동 진행 (FAILED/NEEDS_USER 는 자동 진행 차단). jsonl 부재 시 시작 후보 (kiwi-srs / kiwi-srs-from-code) 제안. 마지막 N 이벤트 통계 출력 (스킬별 횟수 / 평균 소요 / 마지막 실행 시각). 트리거 — kiwi pipeline, 파이프라인 상태, 다음 단계 추천, kiwi 다음 뭐 해, pipeline status, kiwi next step, 파이프라인 진행, kiwi 자동 진행, pipeline resume, 다음 스킬 추천. 옵션 — --auto (사용자 게이트 우회 자동 진행), --tail=N (마지막 N 이벤트 표시), --stats (통계만 출력), --run (추천 후보 즉시 실행)."
---
> Kiwi MCP rule: normal target-scoped SRS reads, mutations, validation, status/stability updates, acceptance-criteria changes, evidence, trace links, and completed-work logging require working `speckiwi mcp`. CLI is diagnostic/remediation only and is not a normal replacement for MCP mutations.
# kiwi-pipeline v0.1

> Codex clarification gate means: ask the user directly in Default mode; use `request_user_input` only in Plan mode when that tool is available.
> Model tier terms are role guidance, not provider names: `high-reasoning`, `standard`, and `lightweight` map to the current Codex model and effort options available in the session.

`kiwi-*` 스킬 시리즈의 **파이프라인 상태 추적·다음 단계 추천·자동 진행** 메타 스킬. SSOT 는 `./kiwi/pipeline.jsonl` (cwd-relative append-only JSONL).

이 스킬은 *직접 작업을 수행하지 않는다* — 다른 kiwi-* 스킬의 호출 순서를 사용자에게 권고하거나 (`--auto` 시) 직접 spawn 한다.

본 스킬의 책임:
1. `pipeline.jsonl` 읽기 (마지막 N 줄)
2. 직전 이벤트 분석 → 다음 단계 후보 도출 (Table T1)
3. 사용자 게이트 (`Codex clarification gate`) 또는 자동 진행
4. 자기 실행도 1줄 이벤트로 jsonl 에 append

---

## 0. 공통 규약 (SSOT)

| 키 | 규칙 |
|---|---|
| §0.1 | **이벤트 SSOT**: `../_shared/kiwi/pipeline-event.md` v1.0.0 가 schema·파일위치·emit 규칙의 SSOT. 본 문서는 *read·다음 단계 추천* 만 담당. |
| §0.2 | **자기 mutation 금지**: 본 스킬은 speckiwi MCP / 파일 시스템 / git 어느 것도 mutation 하지 않는다. 유일한 부작용 = `pipeline.jsonl` 에 자기 실행 1줄 append. |
| §0.3 | **/snoworca-\* 호출 절대 금지**. kiwi-* 시리즈만 Codex skill invocation prose로 안내하거나 실행한다. |
| §0.4 | **--auto 안전 게이트**: 직전 이벤트 `status ∈ {NEEDS_USER, FAILED}` 시 --auto 라도 자동 진행 차단 + 사용자 결정 강제. |
| §0.5 | **자기 무한 루프 방지**: 본 스킬의 `next_hint` 가 `kiwi-pipeline` 인 경우 자동 진행 불가 (사용자 확인 의무). 직전 직전 이벤트도 `kiwi-pipeline` 이면 ERROR. |
| §0.6 | **project signature-ban instruction** + **project change-history policy**. 본 스킬 본문에 변경 이력 섹션 없음 — git history 가 SSOT. |
| §0.7 | **사용자 확인 의무**: 추천 후보 ≥2 개 / next_hint = null / 자기 호출 충돌 / schema major mismatch — 모두 `Codex clarification gate` 단일 호출 분해. |
| §0.8 | **best-effort emit**: 자기 jsonl emit 실패가 본 작업 (추천 출력) 의 실패로 이어지면 안 됨. emit 실패 시 stderr WARN. |
| §0.9 | **외부 스킬 spawn 모드**: `--auto --run` 시 추천 스킬을 `Skill` 도구로 호출. 추가 옵션은 prompt 끝에 인계. |

---

## 1. 입력 / 출력

### 1.1 필수 입력

(없음) — pipeline.jsonl 의 마지막 이벤트로부터 자동 추론.

### 1.2 선택 입력 + 자연어 매핑

| 자연어 신호 | 인자 | 기본값 |
|---|---|---|
| "자동", "auto", "묻지 말고", "바로" | `--auto` | off |
| "마지막 N 개", "tail N" | `--tail=N` | 10 |
| "통계만", "stats" | `--stats` | off (추천 + 통계 모두 출력) |
| "실행해", "run", "진행해" | `--run` | off (추천만 출력) |
| "이전 단계로", "이전" | `--prev` | off (마지막 이벤트 무시하고 그 직전으로) |

옵션 매트릭스:
- `--stats` 단독 → 통계만, 추천·실행 없음
- `--run` 단독 → 추천 + 사용자 게이트 → 선택 시 spawn
- `--auto --run` → 추천 후보가 명확하면 즉시 spawn (FAILED/NEEDS_USER 시 차단)
- `--auto` 단독 (--run 없음) → 추천만 자동 결정 (다지선다 게이트 skip), 실행은 안 함

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

---

## 3. Phase 0 — 파일 경로 해석

`../_shared/kiwi/pipeline-event.md` §1 의 해석 순서:

1. `git rev-parse --show-toplevel` exit 0 → `{git_root}/kiwi/pipeline.jsonl`
2. 위 실패 + cwd 에 `kiwi/` 디렉토리 존재 → `{cwd}/kiwi/pipeline.jsonl`
3. 둘 다 부재 → `~/.kiwi/pipeline.jsonl`

결정 후 `{dir}/.pipeline-path` 마커 파일 갱신.

jsonl 부재 시:
- 메시지 "파이프라인 미시작. 시작 후보:" 출력
- `Codex clarification gate` 2지선다:
  - (A) `kiwi-srs` — 신규 요구사항 → SRS 작성
  - (B) `kiwi-srs-from-code` — 기존 코드 → SRS 역추출
- `--auto` 시 사용자에게 시작 후보 선택 의무 (자동 결정 불가 — 의도 모호)

---

## 4. Phase 1 — 직전 이벤트 파싱

마지막 N 줄 (`--tail=N`, 기본 10) 을 현재 OS에 맞는 방식으로 읽음:

```powershell
Get-Content -LiteralPath $PIPE_FILE -Tail $N -Encoding UTF8
```

```bash
tail -n "$N" "$PIPE_FILE"
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
| kiwi-pm | TASK_DONE | `kiwi-commit-auto-push` |
| kiwi-coder (단독) | TASK_DONE | `kiwi-commit-auto-push` |
| kiwi-commit-auto-push | TASK_DONE | `kiwi-pipeline` (다음 plan or 종료, 사용자 결정) |
| any | NEEDS_USER | (없음 — 사용자 결정 강제) |
| any | FAILED | (없음 — 재시도/건너뛰기/중단 3지선다) |
| any | DRY_RUN | (직전 동일 skill 의 실제 실행) |
| kiwi-pipeline | TASK_DONE | (직전 직전 이벤트의 next_hint 사용. §0.5 무한 루프 방지) |

### 5.2 후보 추가 신호

직전 이벤트의 `next_hint` 필드가 명시되어 있으면 Table T1 보다 우선:

- 직전 이벤트가 자신의 결과에 따라 `next_hint` 를 직접 결정한 경우 (e.g. feasibility 가 blocker 발견 → `kiwi-srs-research`) 이를 우선 채택.
- Table T1 결과와 다르면 두 후보를 모두 제시.

### 5.3 종료 신호

- 직전 이벤트의 `next_hint == null` → "파이프라인 종료. 다음 작업 대기."
- `--auto` 라도 종료는 자동 결정 (사용자 게이트 없이 종료 보고).

---

## 6. Phase 3 — 사용자 게이트 또는 자동 결정

### 6.1 후보 1개 (명확)

- `--auto --run` → 즉시 Phase 4 spawn
- `--auto` (no --run) → 추천만 출력 ("다음 단계: `kiwi-X`. 진행 시 본 스킬 `--auto --run` 또는 직접 `$kiwi-X` 호출.")
- `--auto` 미지정 → `Codex clarification gate` 2지선다 (진행 / 건너뛰기)

### 6.2 후보 2개 이상

- `Codex clarification gate` 다지선다 — 후보 각각 + "건너뛰기" + "다른 스킬 직접 지정"
- `--auto` 라도 다지선다는 자동 결정 불가 (사용자 의도 모호) — 사용자 게이트 발동 (§0.7)

### 6.3 NEEDS_USER 처리

직전 이벤트 `status == NEEDS_USER`:
- 직전 이벤트 `notes` / `summary` 에서 사용자에게 요구한 결정 추출 → 출력
- `Codex clarification gate` 으로 결정 요청
- 결정 후 해당 스킬을 `--resume` 옵션으로 재호출 제안

### 6.4 FAILED 처리

직전 이벤트 `status == FAILED`:
- `Codex clarification gate` 3지선다: (A) 재시도 / (B) 건너뛰기 (다음 스킬 추천) / (C) 중단

### 6.5 자기 호출 충돌 (§0.5)

직전 이벤트가 `skill: "kiwi-pipeline"` 인 경우:
- 직전 직전 이벤트(마지막 2개 이벤트 중 첫 번째)를 기준으로 다시 추론
- 만약 그것도 `kiwi-pipeline` 이면 → ERROR + "kiwi-pipeline 이 연속 2회 호출됨. 직접 다음 스킬 호출 권장." 메시지 출력 후 종료

---

## 7. Phase 4 — 외부 스킬 실행 (--run 시)

선택된 kiwi-* 스킬을 Codex skill invocation prose로 실행한다. 직접 실행 API가 없으면 사용자에게 다음 명령형 안내를 출력한다:

```
Use $kiwi-<chosen> <inherited-or-empty-args>
```

추가 인자 인계:
- `--auto` (kiwi-pipeline) → 자식 스킬에도 전파 (자식의 `--auto` 의미는 자체 SSOT 따름)
- `--mini` (kiwi-pipeline 본 스킬에는 정의 안 됨; 그러나 사용자가 명시한 경우 자식에 전파)

spawn 결과는 사용자 메시지로 직접 출력. 자식 스킬도 자기 jsonl 이벤트를 append 하므로 본 스킬이 별도 기록할 필요 없음.

`--run` 미지정 시 본 Phase skip.

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
- 산출물: docs/spec/10.auth.srs.md

**다음 추천**: `kiwi-srs-feasibility`
- 근거: Table T1 (srs → feasibility)
- 옵션: `$kiwi-srs-feasibility` 또는 본 스킬 `--auto --run` 으로 자동 호출

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

→ pm 의 NEEDS_USER 응답을 본 메시지에 답변 후 `$kiwi-pm --resume` 으로 재진입.
```

### 9.4 FAILED

```markdown
## kiwi-pipeline FAILED 처리

**직전 단계**: `kiwi-coder` (FAILED)
- run_id: ...
- 요약: 테스트 실패 후 자동 복구 실패

**선택지**:
  (A) 재시도 — `$kiwi-coder --resume`
  (B) 건너뛰기 — 다음 후보 (`kiwi-commit-auto-push`) 진행
  (C) 중단
```

### 9.5 종료

```markdown
## kiwi-pipeline 종료

**직전 단계**: `kiwi-commit-auto-push` (TASK_DONE, next_hint=null)

파이프라인이 종료되었습니다. 새로운 요구사항이 있으면 `$kiwi-srs` 로 시작하십시오.
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
| "$kiwi-pipeline" | 직전 이벤트 분석 + 추천 출력 |
| "$kiwi-pipeline --auto" | 후보 명확 시 추천만 출력 (실행 없음) |
| "$kiwi-pipeline --auto --run" | 후보 명확 시 즉시 spawn |
| "kiwi 다음 뭐 해" | 위와 동일 (자연어 트리거) |
| "$kiwi-pipeline --stats" | 통계만 출력 (추천·실행 없음) |
| "$kiwi-pipeline --tail=20" | 마지막 20 이벤트 분석 |
| "$kiwi-pipeline --prev" | 마지막 이벤트 무시하고 그 직전 기준 |

---

## 12. 외부 의존성

| 도구 | 용도 | 부재 시 |
|---|---|---|
| `git rev-parse` | 파일 경로 해석 §3 | cwd 의 `kiwi/` 또는 `~/.kiwi/` fallback |
| PowerShell `Get-Content -Tail` or POSIX `tail` | jsonl 읽기 §4 | 파일 전체를 읽은 뒤 마지막 N개 줄만 사용 |
| Codex skill invocation | 외부 kiwi-* 실행 §7 | --run 옵션 비활성, 사용자에게 다음 스킬 안내 |
| `Codex clarification gate` procedure | 사용자 게이트 | --auto 시 일부 게이트 자동 결정 |

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
