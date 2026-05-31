# `--auto` 공용 옵션 (kiwi-* 사용자 게이트 자동 결정)

본 모듈은 13개 kiwi-* 스킬이 공유하는 `--auto` 의미·토폴로지·합치 알고리즘·전파·로깅 SSOT 다. `mini-option.md` v1.0 과 동일한 read-time replace 패턴을 따른다 — 본문 수정 없이 §0 에 본 모듈 참조 한 줄과 §X 의 `critical_gates[]` 인라인만으로 작동.

## 0. 한 줄 정의

`--auto` 플래그가 지정되면, 본 스킬 실행 중 **사용자 결정이 필요한 게이트**(AskUserQuestion / NEEDS_USER / 사용자 확인 의무) 또는 **복구 가능한 에러로 인한 차단**이 발생할 때, **격리된 서브에이전트가 컨텍스트를 분석해 결정을 내리고 그 결정대로 자동 진행**한다. 단, 스킬별 §0.X 에 인라인 선언된 `critical_gates[]` 에 해당하는 게이트는 `--auto` 무관 사용자 강제 HALT.

## 1. 활성 조건

| 채널 | 우선순위 | 활성 조건 |
|---|---|---|
| (1) Skill/Agent 도구 인자 | 1 | `Skill(args: "--auto ...")` / `Agent({ description: "... --auto" })` 정규식 `--auto\b` 매칭 |
| (2) prompt 본문 정확 문자열 | 2 | 사용자 메시지에 `--auto` 정확 토큰 |
| (3) 자연어 신호 | 3 | "자동", "묻지 말고", "확인 없이", "auto" 등 §8 매핑 어휘 — 사용자에게 1회 확인 후 활성 |
| (4) 부모 호출 전파 | 4 | §7 표에 따른 자동 전파 |

활성 시 분석 로그 (`docs/analysis/{skill-run-id}/preflight.json` 등) 의 `mode_flags` 에 `"--auto"` 기록. `--auto --max` / `--auto --mini` 시 함께 기록.

**비활성 조건 (silent skip)**:
- `kiwi-srs-research --mode=subagent` 호출 (mutation 0건 — 게이트 자체 부재)
- 본 모듈을 참조하지 않는 스킬
- 스킬의 `critical_gates[]` 가 미선언 상태 → `--auto` 비활성 (안전 디폴트)

## 2. 서브에이전트 토폴로지

| 모드 조합 | 서브에이전트 수 | 모델 | 합치 |
|---|---|---|---|
| `--auto` | 1 | Opus | 결정 그대로 채택 |
| `--auto --max` | 2 (병렬) | Opus | §3 합치 알고리즘 |
| `--auto --mini` | 1 | Sonnet | 결정 그대로 채택 |
| `--auto --max --mini` | 2 (병렬) | Sonnet | §3 합치 알고리즘 |

### 2.1 서브에이전트 입력 (편향 없음)

각 결정 서브에이전트에 전달할 입력 (CLAUDE.md §5 — 본인 결론·정당화 전달 금지):

- `gate_id` — 게이트 식별자 (스킬별 §0.G* 라벨 또는 NEEDS_USER reason)
- `gate_context` — 결정이 필요한 사유, 관련 데이터 (코드 diff / spec / 에러 메시지 등)
- `options[]` — 선택지 (있는 경우. AskUserQuestion 의 옵션 그대로 또는 enum 값들)
- `severity` — `clarification` / `business-decision` / `rollback-confirmation` 중 하나
- `safety_rules[]` — 본 스킬 §0 의 안전 규약 발췌 (외부 모듈 보호, 비가역 차단 등)
- `available_evidence` — 결정 근거가 될 수 있는 사실 데이터 (테스트 결과, MCP 응답 등)

**전달 금지**: 메인 세션의 잠정 결정, 호출자의 선호, 다른 서브에이전트의 결정 (병렬 분석 시).

### 2.2 서브에이전트 출력 형식

```json
{
  "decision": "<option_id 또는 enum value>",
  "rationale": ["근거 1", "근거 2", "근거 3"],
  "risk_assessment": "low|medium|high",
  "side_effects": ["부수 효과 1", "..."],
  "fallback_if_decision_fails": "<다음 단계 권고>",
  "confidence": 0.0
}
```

### 2.3 결정 서브에이전트 호출 표준 의사코드

본 모듈을 따르는 스킬이 결정 SA 를 spawn 할 때 다음 표준 호출 형식을 따른다 (LLM 환각 방지):

#### `--auto` 단독 (SA×1)

```
Agent(
  description: "결정 SA: <gate_id 요약>",
  subagent_type: "general-purpose",
  model: "<model_resolution>",   # §2.3.1 참조
  prompt: """
    당신은 '--auto' 결정 서브에이전트다. CLAUDE.md §5: 편향 없는 입력만 받았다.

    ## 게이트
    gate_id: <gate_id>
    severity: <clarification | business-decision | rollback-confirmation>

    ## 컨텍스트
    <gate_context 본문 — 결정 사유, 관련 데이터>

    ## 선택지 (있는 경우)
    <options[] — 각 항목 id + 설명 1줄>

    ## 안전 규약 (스킬 §0 발췌)
    <safety_rules[]>

    ## 근거 데이터
    <available_evidence>

    ## 출력 (필수, JSON only — 코드블럭 없이 raw JSON)
    {"decision": "<options[].id 와 정확히 일치하는 값>",
     "rationale": ["근거 1", "근거 2", "근거 3"],
     "risk_assessment": "low|medium|high",
     "side_effects": ["..."],
     "fallback_if_decision_fails": "<다음 단계 권고>",
     "confidence": <0.0-1.0 float>}
  """
)
```

#### `--auto --max` (SA×2 병렬)

위 호출을 **단일 메시지에서 2회 동시 호출** (병렬 보장). 두 호출의 prompt 는 **완전히 동일** (격리 보장). description 만 "SA1" / "SA2" 로 구분.

#### `--auto --max` 합치 SA3 (불일치 시)

```
Agent(
  description: "결정 SA3 중재",
  subagent_type: "general-purpose",
  model: "<model_resolution>",
  prompt: """
    당신은 결정 합치 중재자다. 두 1차 결정자가 동일 게이트에 다른 결론을 냈다.

    ## 게이트 (1차와 동일 입력 전체)
    <gate_id, severity, gate_context, options, safety_rules, available_evidence>

    ## 1차 결과
    SA1: decision=<...>, rationale=<...>, risk=<...>, confidence=<...>
    SA2: decision=<...>, rationale=<...>, risk=<...>, confidence=<...>

    ## 출력 (필수, JSON only)
    {"decision": "<SA1 또는 SA2 의 decision 값 채택, 또는 새 결정>",
     "matches_sa": "SA1" | "SA2" | "neither",
     "rationale": [...],
     "confidence": <0.0-1.0>}
  """
)
```

#### 2.3.1 model 결정 (FN-003)

| 모드 조합 | `model` 파라미터 값 |
|---|---|
| `--auto` 단독 | `"opus"` |
| `--auto --max` | SA1/SA2/SA3 모두 `"opus"` |
| `--auto --mini` | `"sonnet"` |
| `--auto --max --mini` | SA1/SA2/SA3 모두 `"sonnet"` |

mini-option.md §2 read-time replace 가 본 §2.3.1 표를 통해 적용됨 — 본 표가 결정 SA 호출의 SSOT.

### 2.4 decision 적용 (dispatch) 규약

SA 가 반환한 `decision` 값을 메인 세션이 본문 분기에 매핑하는 표준:

#### 2.4.1 매핑 우선순위

1. **`decision` 값이 원본 게이트의 `options[].id` 와 정확 일치** → 해당 옵션의 본문 분기 실행. 예: AskUserQuestion 4옵션 게이트에서 `decision="proceed"` → "proceed" 분기 코드 그대로 실행.
2. **NEEDS_USER reason enum 게이트** → `decision` 값을 NEEDS_USER payload 의 `resolution` 필드로 적재 후 본 스킬의 NEEDS_USER 처리 분기로 진입 (각 스킬이 정의한 resolution → next-step 매핑).
3. **`default_if_auto` 가 정의된 게이트** → `decision == default_if_auto` 이면 해당 default 분기 실행. 다르면 매핑 우선순위 1로 fallback.
4. **위 3종 모두 매핑 실패** → critical 격상, 사용자 HALT (안전 디폴트).

#### 2.4.2 본문 분기 라벨 규약

스킬은 AskUserQuestion / NEEDS_USER 호출 site 마다 다음 형식의 라벨을 의사코드 주석으로 보유 가능 (필수 아님, 모호한 경우만):

```
# AUTO_DISPATCH: gate_id=<...>, options=[proceed|block|defer]
AskUserQuestion(...)
# AUTO_BRANCH[proceed]: <분기 코드>
# AUTO_BRANCH[block]: <분기 코드>
# AUTO_BRANCH[defer]: <분기 코드>
```

본 라벨은 §2.4.1 매핑 우선순위 1 의 lookup 키. 라벨 없으면 LLM 이 본문 컨텍스트로 추론.

## 3. 합치 알고리즘 (`--auto --max` 전용)

```
1. 서브에이전트 SA1, SA2 를 병렬 spawn (Agent 도구 단일 메시지 내 2회 호출, isolation 보장)
2. 두 결과 수집 (타임아웃 §3.1 참조)
3. decision 정규화 (§3.2 참조) 후 합치 판정:
   - normalize(SA1.decision) == normalize(SA2.decision) → 채택, side_effects 합집합 기록
   - 결정 불일치 → 4) 로 진행
4. 3차 중재 서브에이전트 SA3 spawn (§2.3 표준 의사코드):
   - 입력: gate_context + SA1.{decision, rationale, risk, confidence} + SA2.{decision, rationale, risk, confidence}
   - 모델: §2.3.1 표 따름
   - 출력: matches_sa ∈ {"SA1", "SA2", "neither"} + decision
5. SA3 결과 판정:
   - matches_sa == "SA1" 또는 "SA2" → 다수결 (3중 2) 채택
   - matches_sa == "neither" → critical 로 격상, 사용자 HALT
6. 결정 + 합치 과정 전체를 docs/analysis/{run-id}/auto_decisions.json 에 적재 (§10)
```

**금지**: SA3 가 SA1/SA2 둘 다 거부하고 본인 결정만 채택 (다수결 위반) — 즉시 HALT.

### 3.1 SA 실패 fallback (FN-004)

| 실패 시나리오 | 처리 |
|---|---|
| SA timeout (Agent 도구 응답 무) | critical 격상, HALT (안전 디폴트). 로그 적재. |
| SA 응답이 빈 문자열 | critical 격상, HALT |
| SA 응답 JSON 파싱 실패 | 1회 재호출 (동일 prompt). 재실패 시 critical HALT |
| SA 응답에 `decision` 필드 없음 | 1회 재호출. 재실패 시 critical HALT |
| `--auto --max` 에서 SA1 성공 + SA2 실패 | SA2 1회 재호출. 재실패 시 SA1 결정 단독 채택 + LOW 경고 |
| `--auto --max` 에서 SA1/SA2 둘 다 실패 | critical HALT |
| SA3 실패 (--max 합치 단계) | critical HALT |

### 3.2 decision 정규화 (FN-005)

`normalize()` 함수 규약:
1. 양끝 whitespace 제거
2. 소문자 변환
3. options[].id 와 정확 일치 비교 (substring 매칭 금지)

예: `"Proceed "` / `"PROCEED"` / `"proceed"` → 모두 `"proceed"` 로 정규화 후 비교.

**enum/id 외 자유 텍스트 decision 은 §2.2 출력 형식 위반** — `decision` 필드 값은 반드시 `options[].id` 와 정확히 일치하거나 NEEDS_USER reason enum 값과 일치. 자유 텍스트 반환 시 SA 실패로 간주 (§3.1 의 "decision 필드 없음" 분기).

## 4. severity 분기 정책

| severity | `--auto` 동작 | 비고 |
|---|---|---|
| `clarification` | 서브에이전트 자동 결정 | 단순 모호성 해결. confidence ≥ 0.5 채택 |
| `business-decision` | 서브에이전트 자동 결정 | 정책·선호 결정. confidence ≥ 0.7 채택, 미만이면 critical 격상 |
| `rollback-confirmation` | 서브에이전트 자동 승인 (기본 "YES") | 명시적 rollback 거부 신호 시에만 HALT |
| `critical` | **HALT** (`--auto` 무관) | 스킬별 `critical_gates[]` 에 매핑된 게이트 |

**severity 가 명시되지 않은 게이트**: 본 스킬의 `critical_gates[]` 에 포함되면 `critical`, 아니면 `business-decision` 으로 기본 분류.

### 4.1 confidence 신뢰성 검증 (FN-006 대응)

SA 자기보고 `confidence` 가 무비판 채택되면 critical 격상 트리거가 형해화된다. 다음 보정 규약 적용:

#### 4.1.1 confidence 하향 조정

| 조건 | confidence 조정 |
|---|---|
| `rationale[]` 항목 수 < 3 | ×0.7 |
| `rationale[]` 각 항목 평균 길이 < 20 자 | ×0.8 |
| `risk_assessment == "high"` 이고 `confidence > 0.7` | ×0.6 (high-risk 고확신 의심) |
| `side_effects[]` 가 빈 배열인데 mutation 게이트 (MCP write/git push 등) | ×0.7 |

조정된 confidence 가 임계값 미만이면 critical 격상.

#### 4.1.2 `--auto --max` 교차 검증

SA1.confidence 와 SA2.confidence 차이 ≥ 0.3 → 신뢰성 부족, SA3 강제 호출 (decision 일치 여부와 무관).

#### 4.1.3 안전 임계

`--auto --mini` (Sonnet) 일 때 임계값 +0.1 (Opus 대비 보수적):
- clarification: 기본 0.5 → mini 0.6
- business-decision: 기본 0.7 → mini 0.8

## 5. `critical_gates[]` 인터페이스

각 스킬은 본 모듈을 참조하는 §0.X 라인 옆에 자신의 `critical_gates[]` 를 인라인 선언한다:

```markdown
| §0.X | `--auto` SSOT. 본 스킬은 `_shared/kiwi/auto-option.md` v1.0 을 따른다.
        critical_gates = [
          {gate_id: "external-module-impact", reason: "외부 시스템 비가역 변경"},
          {gate_id: "lifecycle-gate-draft", reason: "REQ stability=draft 자동 진행 금지"},
          {gate_id: "sha-mismatch-on-resume", reason: "plan/sidecar 무결성 손상"}
        ] |
```

**critical_gates[] 미선언 = `--auto` 비활성** (안전 디폴트).

### 5.0.1 critical_gates 선언 위치 자유

위 예시는 §0.X 표 셀 안 인라인 형식이지만, 스킬별 구조에 따라 다음 위치도 허용:

| 위치 패턴 | 사용 스킬 예시 |
|---|---|
| §0.X 표 셀 인라인 | (간결한 스킬, ≤3개 critical_gates) |
| §0.G* 별도 결정표 절 | kiwi-coder §0.G6, kiwi-pm §0.G7, kiwi-review-fix-loop §0.G8 등 (다른 G* 게이트와 일관) |
| §0.AG 별도 절 | kiwi-pipeline (§0.G 표가 없는 평면 구조) |
| §1.X 절 신설 | kiwi-planner §1.5, kiwi-srs-from-code §1.4, kiwi-srs-feasibility §1.5, kiwi-srs-research §1.7 (옵션 표 §1.2 와 인접 배치) |
| §0.X 본문 인라인 | kiwi-srs-sync §0.16 (단일 표가 짧을 때) |
| §N.M kiwi 통합 절 | kiwi-commit-auto-pr §14.9, kiwi-commit-auto-push §11.10 (§0 SSOT 표가 없는 스킬) |

SSOT 가 요구하는 것은 `critical_gates[]` **존재** 와 **gate_id / reason / 발생 위치** 3열 표 형식. 위치 라벨은 스킬 컨텍스트에 맞게 자유롭게 선택.

### 5.1 critical_gates 표준 카탈로그 (참고)

다음 게이트는 본 SSOT 가 권장하는 critical 후보. 스킬은 자기 컨텍스트에 맞춰 채택:

- `external-module-impact` — cwd 외부 / 다른 패키지 / 다른 서비스에 영향
- `protected-branch-direct-push` — main/master 등 보호 브랜치 직접 push
- `fork-repo-pr-create` — 외부 fork repo 에 PR 생성
- `stability-stable-promotion` — REQ stability=stable 승급 (정책 무관 항상 확인)
- `stability-frozen-violation` — frozen REQ 본문 변경
- `lifecycle-gate-draft` — REQ stability=draft 인데 구현 진입
- `sha-mismatch-on-resume` — plan/sidecar SHA256 불일치
- `depends-on-violation` — depends_on 미충족 REQ 진입
- `t-final-backward-transition` — 라이프사이클 역방향 전이
- `push-conflict-rebase-merge-choice` — push 충돌 시 rebase/merge 자동 선택 (비가역)
- `mcp-cli-both-unavailable` — speckiwi 도구 전부 부재
- `transition-guard-bypass` — Stability transition guard 강제 우회 시도
- `mock-detection` — 통합 테스트 Mock 검출 (CRITICAL finding)
- `plan-code-divergence-critical` — 계획-코드 CRITICAL 불일치
- `self-recursive-spawn` — 자기 스킬 무한 호출 가드
- `pipeline-event-needs-user-or-failed` — 직전 이벤트 NEEDS_USER/FAILED

## 6. 의사코드 해석 규약 (read-time replace)

본 모듈을 참조하는 스킬의 본문에 다음 표현이 나오면 `--auto` 활성 시 해석을 수정:

- "AskUserQuestion 호출" → "§2 서브에이전트 결정 + decision 적용"
- "NEEDS_USER bubble-up" → "severity 평가 → critical 이면 bubble-up, 아니면 §2 서브에이전트 결정"
- "사용자 확인 의무" → "critical_gates[] 매칭 시 HALT, 아니면 §2 서브에이전트 결정"
- "default_if_auto: <X>" → 해당 default 값을 `severity=clarification` confidence=1.0 결정으로 채택 (서브에이전트 우회 가능 — fast path)

**사본을 만들지 않는다**. 스킬 본문은 그대로 두고 §0 참조 + `critical_gates[]` 인라인만으로 충분.

## 7. 자식 스킬 호출 전파

부모 스킬이 `--auto` 활성 상태에서 자식 kiwi-* 스킬을 spawn 하면 자식 호출 args 에 `--auto` 명시 전파 의무.

| 부모 모드 | 자식 호출 args 추가 |
|---|---|
| `--auto` | `--auto` |
| `--auto --max` | `--auto --max` |
| `--auto --mini` | `--auto --mini` |
| `--auto --max --mini` | `--auto --max --mini` |

### 7.1 합성 옵션 처리

일부 스킬은 `--auto` 가 다른 옵션의 합성 의미를 갖는다. 전파 시 합성 규칙 보존:

| 부모 스킬 | 자식 스킬 | 전파 시 합성 |
|---|---|---|
| `kiwi-hot-fix --auto` | `kiwi-srs-sync` | `--auto --auto-apply --yes-all` (기존 `--auto = --auto-apply + --yes-all` 시맨틱 보존) |
| `kiwi-pm --auto` | `kiwi-coder` | `--auto` (별개 옵션 `--yes-all`/`--auto-integration` 은 사용자 명시 시에만 추가) |

전파 누락 시 자식이 사용자 게이트에 막혀 비-자동 동작 — LOW severity 로 보고.

## 8. 호환 / 자연어 매칭

- `--max` 와 공존 가능 — `--auto --max` = 서브에이전트 2개 병렬
- `--mini` 와 공존 가능 — `--auto --mini` = 서브에이전트 모델 Sonnet
- `--dry-run` 과 공존 가능 — dry-run 게이트는 `--auto` 영향 없음 (사용자 검토 필수)
- `--no-auto` 부정 플래그 없음 — 옵션 미지정이 곧 사용자 결정 활성
- 미지원 스킬에 `--auto` 전달 시 silent ignore (스킬이 본 모듈 참조 안 하거나 `critical_gates[]` 미선언)
- 사용자 자연어 신호: "자동", "묻지 말고", "확인 없이", "auto", "바로 진행", "질문 없이" → `--auto` 매핑

## 9. 인자 매칭 규약

본 모듈을 참조하는 스킬은 다음 순서로 `--auto` 활성 여부를 판정 (§1 채널 우선순위):

1. Skill/Agent 인자 또는 description token
2. prompt 본문 정확 문자열
3. 자연어 신호 (사용자에게 1회 확인 후 활성)
4. 부모 호출 전파 (§7)

## 10. 분석 로그 / 산출물

`--auto` 활성 시 각 게이트 결정을 다음 형식으로 적재:

```
docs/analysis/{skill-run-id}/auto_decisions.json
{
  "run_id": "...",
  "skill": "kiwi-pm",
  "mode_flags": ["--auto", "--max"],
  "decisions": [
    {
      "gate_id": "lifecycle-gate-evolving",
      "severity": "clarification",
      "options": ["proceed", "block"],
      "subagent_results": [
        {"agent": "SA1", "decision": "proceed", "rationale": [...], "confidence": 0.85},
        {"agent": "SA2", "decision": "proceed", "rationale": [...], "confidence": 0.78}
      ],
      "merged_decision": "proceed",
      "merge_method": "unanimous",
      "applied_at": "2026-05-26T14:30:00Z"
    }
  ],
  "critical_halts": [
    {"gate_id": "external-module-impact", "halted_at": "..."}
  ]
}
```

## 11. 마이그레이션 정합 (기존 6개 보유 스킬)

본 SSOT 도입 시점에 이미 `--auto` 를 자체 정의한 스킬과의 호환 정책:

| 스킬 | 기존 시맨틱 | SSOT 도입 시 변환 |
|---|---|---|
| `kiwi-pm` | 3종 severity enum (clarification/business-decision/rollback-confirmation), business-decision = HALT | severity enum 유지, **business-decision = 서브에이전트 자동 결정** (사용자 사양에 따라 변경, **kiwi-pm §5.1 / §0.G7 / description / 관련 본문 6+ 위치 갱신 의무**), 기존 business-decision 중 비가역/외부영향 큰 항목은 `critical_gates[]` 로 인라인 |
| `kiwi-review-fix-loop` | severity → 액션 매핑 표 (CRITICAL/HIGH/MEDIUM → fix, LOW → reject) | finding 분류용 매핑은 별개 정책으로 유지. `--auto` 게이트 결정만 SSOT 적용 |
| `kiwi-hot-fix` | `--auto` = `--auto-apply --yes-all` 합성 (자식 sync 전파) | SSOT §7.1 합성 표에 명시. 본 스킬 게이트 결정은 SSOT |
| `kiwi-srs` | `--auto` = AskUserQuestion 발동 대신 **차단** | 차단 대상 게이트(외부 모듈/scope-boundary)를 `critical_gates[]` 로 인라인. 나머지는 SSOT |
| `kiwi-pipeline` | NEEDS_USER/FAILED/자기호출/다지선다 차단 | 4개 모두 `critical_gates[]` 인라인. `--auto --run` 단독 spawn 시맨틱은 유지 |
| `kiwi-coder` | `--auto` 자체 미정의, `--yes-all`/`--auto-integration`/`--auto-cost-warning` 3종 분리 | 3종 옵션 그대로 유지 (fine-grained 자유도 보존). 신설 `--auto` 는 **§8.4 후속 review-fix-loop 게이트 + 메인 게이트 결정** 에만 적용. `--auto` 활성이 3종 옵션을 자동 활성하지는 않음 (별도 의사) |

**kiwi-pm 마이그레이션 노트**: 기존 본문의 "business-decision = 강제 HALT" 표현은 SSOT 도입 시 **모두 갱신 의무**. line 3 (description), §0.G7, §5.1 severity 분기 표 본문, 자식 spawn 안내 등. critical_gates[] 표에 등록된 항목(`path-heuristic-business-decision`, `auto-skip-lifecycle-gate-combo` 등) 은 critical 로 유지 — business-decision 자동 결정 변경의 예외.

### 11.1 `--auto-apply` / `--yes-all` (kiwi-srs-sync) 와의 의미 분리

`kiwi-srs-sync` 는 기존 `--auto-apply` / `--yes-all` 보유. SSOT `--auto` 와 의미 분리:

| 옵션 | 의미 |
|---|---|
| `--auto-apply` / `--yes-all` | dry-run 단계 자체 skip (MCP mutation 즉시 적용) |
| `--auto` | 모든 사용자 게이트 자동 결정 (서브에이전트). dry-run 게이트도 자동 결정 → 결과적으로 `--auto-apply` 와 유사 효과 가능, 단 `--auto` 는 서브에이전트가 선택지 평가 후 결정 (apply-selected 도 가능) |

동시 명시 시 `--auto-apply` 가 우선 (dry-run 단계 skip → `--auto` 의 다른 게이트 결정은 그대로 적용).
