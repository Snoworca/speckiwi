---
name: kiwi-step
description: "step-local(docs/spec/steps/<name>/) 요구 초안을 authoring 하는 경량 스킬. claim_step(MCP 전용)으로 대상 step 을 선점한 뒤 step 디렉터리에만 요구를 작성하고(body-scope SRS 파일 수정 금지) validate_step 로 step 국소 검증을 수행한다. 트리거 — kiwi step, step 요구 작성, step-local authoring, claim step, kiwi-step, step SRS 초안, step 스코프 요구, /kiwi-step."
---

# kiwi-step v0.1

`docs/spec/steps/<name>/` 아래에 **step-local 요구 초안**을 안전하게 authoring 하는 경량 스킬. body-scope SRS(정규 `docs/spec/*.srs.md`)를 건드리지 않고, step 을 먼저 선점(claim)한 뒤 step 디렉터리에만 작성하며, 작성 후 step 국소 검증을 돌린다.

`kiwi-srs`(body-scope 정규 요구 authoring)의 경량 대응물. step 은 body 로 승격(promote)되기 전의 격리된 초안 작업 공간이다.

---

## 0. 공통 규약 (SSOT)

| 키 | 규칙 |
|---|---|
| §0.1 | **claim 우선**. 어떤 step-local 요구도 작성하기 전에 반드시 `claim_step` 으로 대상 step 을 먼저 선점한다. |
| §0.2 | **step 디렉터리 한정**. 요구 작성은 오직 `docs/spec/steps/<name>/<NN>.<slug>.srs.md` 에만 한다. body-scope SRS 파일(`docs/spec/*.srs.md`)은 절대 수정하지 않는다. |
| §0.3 | **작성 후 검증**. authoring workflow 의 일부로 `validate_step` 을 실행해 step 국소 정합성을 확인한다. |
| §0.4 | **MCP 전용 claim 가드**. `claim_step` 은 MCP 전용 도구다(CLI fallback 없음). MCP 서버가 없으면 스킬은 즉시 중단(halt)한다 — 우회 경로가 없다. |
| §0.5 | **CLAUDE.md §6 시그니처 금지 / §7 변경 이력 금지**. 산출물·커밋 어디에도 AI 식별 정보를 남기지 않으며 본 스킬 본문에 변경 이력 섹션을 두지 않는다. |
| §0.6 | **ID·heading 규칙 준수**. step 요구도 SRS-MD Authoring Rules(heading/ID 정규식)를 따른다. body 로 승격되기 전 초안이라도 형식은 정규 규칙과 동일하다. |
| §0.7 | `--mini` / `--loops N` 수용(no-op). 본 스킬은 검증-개선 루프가 없어 `_shared/kiwi/loop-option.md` §5 에 따라 문서화된 no-op 으로 수용(오케스트레이터 전파 균일성). |

---

## 1. 입력 / 출력

### 1.1 입력

| 신호 | 의미 |
|---|---|
| step 이름 `<name>` | 작업 대상 step. 부재 시 사용자에게 질의. |
| 작성할 요구 개요 | statement + acceptance criteria 초안. |

### 1.2 출력

- `docs/spec/steps/<name>/<NN>.<slug>.srs.md` 내 요구 블록(초안)
- `validate_step` 검증 결과

---

## 2. Phase 흐름

```
Phase 0 : MCP 가용성 확인 (부재 시 halt — §0.4)
Phase 1 : claim_step 으로 대상 step 선점 (authoring 전, §0.1)
Phase 2 : step 디렉터리에만 요구 작성 (body-scope 금지, §0.2)
Phase 3 : validate_step 로 step 국소 검증 (§0.3)
```

### 2.1 Phase 0 — MCP 가용성

`claim_step` 은 MCP 전용이다. **MCP 서버가 없으면 스킬은 즉시 중단(halt)한다**(CLI fallback 이 없어 degraded 경로가 존재하지 않는다). 사용자에게 MCP 설정을 확인하도록 안내한 뒤 종료한다.

### 2.2 Phase 1 — Claim

대상 step 을 요구 작성 전에 `claim_step` 으로 먼저 선점한다 — 즉 어떤 요구도 쓰기 전에 claim 을 완료해야 한다. claim 이 write-skew 게이트(STEP_DIRECT_CONFLICT / STEP_OVERLAP / STEP_SUPERSEDE_PROTECTED)로 거부되면 사유를 사용자에게 보고하고 중단한다.

### 2.3 Phase 2 — Author (step 디렉터리 한정)

요구 블록을 `docs/spec/steps/<name>/<NN>.<slug>.srs.md` 에만 작성한다. **body-scope SRS 파일(`docs/spec/*.srs.md`)에는 절대 쓰지 않는다** — step 은 승격 전 격리 작업 공간이므로 정규 body 문서를 직접 건드리면 거버넌스 위반이다. `docs/spec/steps/` 바로 아래(하위 `<name>/` 없이)에 놓인 파일은 step 파일이 아니라 body scope 로 처리되므로, 반드시 `<name>/` 하위 경로에 작성한다.

**step authoring 전용 MCP/CLI 도구는 없다.** step 요구는 `docs/spec/steps/<name>/<NN>.<slug>.srs.md` 파일을 SRS-MD ID·heading 규칙에 맞춰 직접(Write/Edit) 작성한다. `add_requirement` 는 body scope 에 기록하므로 사용하지 않는다 — step-only 규칙을 위반한다.

### 2.4 Phase 3 — Validate

`validate_step`(MCP 도구, 또는 CLI `speckiwi step validate <name>`)을 실행해 step 국소 정합성을 검증한다. 오류가 있으면 수정 후 재검증한다.

---

## 3. 파이프라인 위치

```
kiwi-step (step-local 초안 authoring) → kiwi-srs-sync (step → body 승격/병합)
```

본 스킬은 승격을 수행하지 않는다. step 요구의 body scope 승격/병합은 기존 `kiwi-srs-sync` 스킬이 담당한다. 오늘 실제로 동작하는 승격 메커니즘은 `promote_step_requirement` MCP 도구이며, step 요구는 이 도구로 body scope 에 승격된다.

---

## 4. 외부 의존성

| 도구 | 용도 | 부재 시 |
|---|---|---|
| `claim_step` (MCP 전용) | step 선점 §0.1 | halt (CLI fallback 없음) |
| `validate_step` (MCP / CLI `speckiwi step validate <name>`) | step 국소 검증 §0.3 | CLI fallback 시도, 둘 다 부재 시 사용자 안내 |

**step authoring 도구 부재.** step 요구를 작성하는 전용 MCP/CLI 도구는 없다. `docs/spec/steps/<name>/<NN>.<slug>.srs.md` 를 Write/Edit 로 직접 작성하며 SRS-MD ID·heading 규칙을 따른다. `add_requirement` 는 body scope 에 쓰므로 사용하지 않는다 — step-only 규칙 위반이다.
