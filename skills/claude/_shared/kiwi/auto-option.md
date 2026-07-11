# `--auto` 공용 옵션 (kiwi-* 사용자 게이트 자동 결정)

본 모듈은 13개 kiwi-* 스킬이 공유하는 `--auto` 의미·토폴로지·합치 알고리즘·전파·로깅 SSOT 다. 본문 수정 없이 §0 에 본 모듈 참조 한 줄과 §X 의 `critical_gates[]` 인라인만으로 작동하는 read-time replace 패턴을 따른다.

## 0. 한 줄 정의

`--auto` 플래그가 지정되면, 본 스킬 실행 중 **사용자 결정이 필요한 게이트**(AskUserQuestion / NEEDS_USER / 사용자 확인 의무) 또는 **복구 가능한 에러로 인한 차단**이 발생할 때, **격리된 서브에이전트가 컨텍스트를 분석해 결정을 내리고 그 결정대로 자동 진행**한다. 단, 스킬별 §0.X 에 인라인 선언된 `critical_gates[]` 에 해당하는 게이트는 `--auto` 무관 사용자 강제 HALT.

## 1. 활성 조건

| 채널 | 우선순위 | 활성 조건 |
|---|---|---|
| (1) Skill/Agent 도구 인자 | 1 | `Skill(args: "--auto ...")` / `Agent({ description: "... --auto" })` 정규식 `--auto\b` 매칭 |
| (2) prompt 본문 정확 문자열 | 2 | 사용자 메시지에 `--auto` 정확 토큰 |
| (3) 자연어 신호 | 3 | "자동", "묻지 말고", "확인 없이", "auto" 등 §8 매핑 어휘 — 사용자에게 1회 확인 후 활성 |
| (4) 부모 호출 전파 | 4 | §7 표에 따른 자동 전파 |

활성 시 분석 로그 (`docs/analysis/{skill-run-id}/preflight.json` 등) 의 `mode_flags` 에 `"--auto"` 기록. `--auto --max` / `--auto --model` 시 함께 기록.

**비활성 조건 (silent skip)**:
- `kiwi-srs-research --mode=subagent` 호출 (mutation 0건 — 게이트 자체 부재)
- 본 모듈을 참조하지 않는 스킬
- 스킬의 `critical_gates[]` 가 미선언 상태 → `--auto` 비활성 (안전 디폴트)

## 2. 결정 위원회 토폴로지

`--auto` 가 활성화되면 단일 거수기 작업자 대신 **리서치 수행 결정 위원회 3인**을 소집한다. 3인 위원 각각은 격리된 서브에이전트로서 게이트 컨텍스트를 독립적으로 조사(research)하고 가장 합리적인 옵션을 선택·채택하도록 1표를 던진다. 위원은 `--model <name>` 로 위원회 모델을 덮어쓰지 않는 한 **현재 세션 모델**을 상속한다.

| 모드 조합 | 위원회 규모 | 합치 규칙 |
|---|---|---|
| `--auto` | 3인 위원회 | 만장일치일 때 결정. 만장일치가 아니면 §3 사다리로 5인 격상 |
| `--auto --max` | 5인 위원회 | `--max` 는 결정 위원회를 5인으로 격상. 5인이 만장일치가 아니면 다수결로 멈추지 않고 7인으로 격상해 다수결로 결정 (§3) |
| `--auto --model <name>` | 3인 위원회 | 전 위원 모델을 지정 모델로 고정 |
| `--auto --max --model <name>` | 5인 위원회 | 위 5인 규칙 + 전 위원 지정 모델 |

위원회 사다리·합치·동점 tie-break SSOT 는 §3.

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

### 2.3 위원 spawn 표준 의사코드

본 모듈을 따르는 스킬이 위원회를 소집할 때 다음 표준 호출 형식을 따른다 (LLM 환각 방지). K = 위원회 규모(`--auto`=3, `--auto --max`=5, 격상 시 5→7). K 명의 위원은 **단일 메시지에서 K회 동시 호출**(병렬·격리 보장)하며 모든 위원의 prompt 는 완전히 동일하다. description 만 "위원 #1 … 위원 #K" 로 구분하고 **위원 #1 을 선임 위원(§3 동점 tie-breaker)** 으로 고정한다.

#### 위원 1인 호출 (모든 위원 동일 형식)

```
Agent(
  description: "결정 위원 #i/K: <gate_id 요약>",
  subagent_type: "general-purpose",
  model: "<model_resolution>",   # §2.3.1 참조
  prompt: """
    당신은 '--auto' 결정 위원회의 위원 #i 다. CLAUDE.md §5: 편향 없는 입력만 받았다. 게이트 컨텍스트를 독립적으로 조사(research)하고 가장 합리적인 옵션을 선택해 1표를 던진다.

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

#### 위원회 격상 (3→5, 5→7)

위원회가 만장일치가 아니면 §3 사다리에 따라 격상한다. 격상은 기존 위원의 표를 유지한 채 새 위원 2인을 추가로 spawn 해 재투표하는 방식이며, 별도의 중재자 SA 를 두지 않는다 (중재 대신 위원 증원 + 다수결). description 만 "위원 #4" / "위원 #5" (5→7 격상 시 "위원 #6" / "위원 #7") 로 이어 붙이고, 추가 위원의 prompt 는 기존 위원과 완전히 동일하다.

#### 2.3.1 위원 model 결정 (FN-003)

| 모드 조합 | `model` 파라미터 값 |
|---|---|
| `--auto` / `--auto --max` | 전 위원 **현재 세션 모델** 상속 (모델명 미지정) |
| `--auto --model <name>` / `--auto --max --model <name>` | 전 위원 지정 모델 `<name>` |

본 §2.3.1 표가 위원 호출의 model 파라미터 SSOT. 위원회는 이중 모델 평가자 패널을 쓰지 않고 단일 현재 세션 모델(또는 `--model` 지정 모델)로 통일한다.

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

## 3. 위원회 합치 사다리 (만장일치 → 격상 → 다수결 → 동점 tie-break)

`--auto` 결정 위원회는 다음 사다리로 최종 결정을 만든다. 위원은 §2.3 표준 의사코드로 병렬·격리 spawn 하며, 격상은 기존 위원의 표를 유지한 채 위원 2인을 추가해 재투표한다.

1. **`--auto` (3인 위원회)**: 3인 위원이 각자 조사(research) 후 투표한다.
   - 만장일치(unanimous) → 그 결정 채택, `side_effects` 합집합 기록.
   - 만장일치가 아니면 → 2) 로 격상.
2. **5인으로 격상**: 위원 2인을 추가해 5인 위원회로 재결정한다.
   - 만장일치 → 채택.
   - 만장일치가 아니면 → 다수결(plurality, 최다 득표)로 결정. 5인 위원회는 만장일치를 요구하지 않는다.
   - `--max` 이면 5인이 만장일치가 아닐 때 다수결로 멈추지 않고 3) 으로 격상.
3. **7인으로 격상 (`--max` 전용)**: 위원 2인을 추가해 7인 위원회로 만들고 다수결(plurality, 최다 득표)로 결정한다. 7인 위원회도 만장일치를 요구하지 않는다.
4. **동점 tie-break (전 규모 공통)**: 어떤 규모의 위원회든 표가 동점(tie)이면 **선임 위원(#1, 1순위)의 랭킹**으로 결정론적으로 깬다. 선임 위원(#1)이 고정 tie-breaker 다. 7인 위원회의 동점도 선임 위원(#1)의 랭킹으로 동일하게 깬다.
5. **critical / business-decision 가드**: critical 게이트와 `critical_gates[]` 에 등록된 business-decision 은 `--auto` 여부와 무관하게 여전히 사용자에게 중단(halt)된다 — 위원회는 critical 중단을 절대 덮어쓰지 않는다.
6. 결정 + 합치 과정 전체를 `docs/analysis/{run-id}/auto_decisions.json` 에 적재(§10). `merge_method` 는 승리 규칙(`unanimous` / `plurality` / `tie-break-lead`)과 최종 위원회 규모를 기록.

**금지**: 위원회가 만장일치도 최다 득표도 아닌 임의 결정을 채택(사다리 위반) — 즉시 HALT.

### 3.1 위원 실패 fallback (FN-004)

| 실패 시나리오 | 처리 |
|---|---|
| 위원 timeout / 빈 응답 | 해당 위원 1회 재spawn. 재실패 시 그 위원을 제외하고 과반 정족수 충족되면 진행, 미충족 시 critical HALT |
| 위원 응답 JSON 파싱 실패 / `decision` 필드 없음 | 해당 위원 1회 재spawn (동일 prompt). 재실패 시 위와 동일 처리 |
| 위원 과반 이상 실패 | critical HALT (안전 디폴트) |
| 선임 위원(#1) 실패로 동점 tie-break 불가 | 선임 위원 1회 재spawn. 재실패 시 critical HALT (임의 tie-break 금지) |

### 3.2 decision 정규화 (FN-005)

`normalize()` 함수 규약:
1. 양끝 whitespace 제거
2. 소문자 변환
3. options[].id 와 정확 일치 비교 (substring 매칭 금지)

예: `"Proceed "` / `"PROCEED"` / `"proceed"` → 모두 `"proceed"` 로 정규화 후 비교.

**enum/id 외 자유 텍스트 decision 은 §2.2 출력 형식 위반** — `decision` 필드 값은 반드시 `options[].id` 와 정확히 일치하거나 NEEDS_USER reason enum 값과 일치. 자유 텍스트 반환 시 위원 실패로 간주 (§3.1 의 "decision 필드 없음" 분기).

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

#### 4.1.2 위원 confidence 교차 검증

위원회 내 최고·최저 confidence 차이 ≥ 0.3 → 신뢰성 부족. 대응은 현재 위원회가 §3 사다리의 **종단 규모**(비-max 5인 / --max 7인)에 도달했는지에 따라 갈린다:

- **비종단 규모** (`--auto` 3인, 또는 `--max` 5인): 만장일치여도 §3 사다리로 다음 규모(3→5, 5→7)로 1회 격상하여 재투표 (decision 일치 여부와 무관). 비-max 3인의 "다음 규모" 는 5인이며, 7인은 --max 전용이므로 비-max 는 5인이 종단이다.
- **종단 규모** (비-max 5인 / --max 7인): 더 격상할 위원회가 없으므로 재투표하지 않고, confidence 신뢰성 저하를 critical 로 격상해 HALT — 사용자 결정을 받는다 (§4.1.1 "임계값 미만이면 critical 격상" 과 동일 안전 정책). 종단 규모에서 임의 진행 금지.

#### 4.1.3 안전 임계 (`--model` tier 판정)

`--auto --model <name>` 로 위원 모델을 덮어쓸 때, 지정 모델이 현재 세션 모델보다 **낮은 tier** 면 임계값 +0.1 (기본 모델 대비 보수적):
- clarification: 기본 0.5 → 0.6
- business-decision: 기본 0.7 → 0.8

**모델 tier SSOT** (성능 순위, 높음→낮음): `opus` > `sonnet` > `haiku`. 세션·지정 모델의 tier 를 이 순위표로 결정적으로 비교한다 — 지정 모델 tier < 세션 모델 tier 일 때만 +0.1. 같거나 높으면 조정 없음 (예: 세션 sonnet + `--model opus` → 조정 없음).

**tier 판정 불가 시 안전 디폴트**: `<name>` 이 순위표에 없거나 세션 모델을 알 수 없어 tier 비교가 불가능하면, 안전측으로 항상 +0.1 을 적용한다 (미확인 모델을 저성능으로 간주).

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
| `--auto --model <name>` | `--auto --model <name>` |
| `--auto --max --model <name>` | `--auto --max --model <name>` |

### 7.1 자식 전파 시 옵션 처리

자식 스킬로 전파할 때, 부모 `--auto` 는 자식의 안전 게이트(dry-run 선행·사용자 승인)를 우회하는 옵션(`--auto-apply` / `--yes-all` 등)을 자동으로 생성하지 않는다. 아래 전파 규칙을 따른다:

| 부모 스킬 | 자식 스킬 | 자식 호출 전파 |
|---|---|---|
| `kiwi-hot-fix --auto` | `kiwi-srs-sync` | `--auto` 만 전파. `--auto-apply` / `--yes-all` 는 자동으로 추가하지 않으며, 사용자가 직접 그 플래그를 지정한 경우에만 전파 |
| `kiwi-pm --auto` | `kiwi-coder` | `--auto` (별개 옵션 `--yes-all`/`--auto-integration` 은 사용자 명시 시에만 추가) |

전파 누락 시 자식이 사용자 게이트에 막혀 비-자동 동작 — LOW severity 로 보고.

## 8. 호환 / 자연어 매칭

- `--max` 와 공존 가능 — `--auto --max` = 5인 위원회 (만장일치 아니면 7인 격상, §2/§3)
- `--model <name>` 와 공존 가능 — `--auto --model <name>` = 결정 서브에이전트 모델 지정
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
      "committee_votes": [
        {"member": "#1", "decision": "proceed", "rationale": [...], "confidence": 0.85},
        {"member": "#2", "decision": "proceed", "rationale": [...], "confidence": 0.78},
        {"member": "#3", "decision": "proceed", "rationale": [...], "confidence": 0.81},
        {"member": "#4", "decision": "proceed", "rationale": [...], "confidence": 0.74},
        {"member": "#5", "decision": "proceed", "rationale": [...], "confidence": 0.80}
      ],
      "merged_decision": "proceed",
      "merge_method": {"rule": "unanimous", "committee_size": 5},
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
| `kiwi-hot-fix` | `--auto` 는 사용자 게이트 자동 결정. sync 위임 시 `--auto` 만 전파하고 `--auto-apply` / `--yes-all` 는 사용자가 직접 지정한 경우에만 전파 | SSOT §7.1 전파 표에 명시. 본 스킬 게이트 결정은 SSOT |
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

부모 스킬의 `--auto` 전파는 이 두 플래그를 자동 생성하지 않는다 — `--auto-apply` / `--yes-all` 는 사용자가 직접 지정한 경우에만 자식에 전달된다 (§7.1). 따라서 `kiwi-srs-sync` 는 부모 `--auto` 단독으로는 dry-run 선행 + 사용자 승인 게이트를 유지한다.
