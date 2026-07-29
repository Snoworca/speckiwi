---
name: kiwi-tdd
description: "tdd work-mode의 step 단위 TDD First 사이클(SDS design.md → red 테스트 → green 구현 → 회귀 → 후행 SRS 승격)을 오케스트레이션하는 스킬. Mode: tdd 확인(아니면 halt) → claim_step 선점 → SDS-MD Rules 기반 design.md 저작(EARS SDS-AC) → SDS-AC를 실패 테스트로 번역(red) → 테스트 약화 없이 green → 회귀 → synthesize + promote_step_requirement(검증 증거 필수). 트리거 — kiwi tdd, tdd 모드, TDD First, tdd step, SDS 작성, /kiwi-tdd."
---

# kiwi-tdd v0.1

tdd work-mode에서 step 하나를 **SDS 선행 TDD First 사이클**로 완주시키는 오케스트레이션 스킬. `kiwi-step`(step-local 저작 규약)의 확장으로, SDS(design.md) 저작·red/green 규율·후행 SRS 승격까지를 한 흐름으로 묶는다.

근거 요구: FR-FLOW-037 (SDS 표준 FR-FLOW-036, 게이트 IR-CLI-072 / FR-NODE-072 / FR-NODE-074, 합성 FR-NODE-073).

---

## 0. 공통 규약 (SSOT)

| 키 | 규칙 |
|---|---|
| §0.1 | **모드 확인 우선**. 시작 전 `speckiwi mode`로 현재 work-mode를 읽는다. `Mode: tdd`가 아니면 즉시 halt(중단)하고 사용자에게 `speckiwi mode tdd` 전환 또는 sdd 워크플로(kiwi-srs 계열)를 안내한다. |
| §0.2 | **claim 우선**. 어떤 산출물(design.md 포함)도 작성하기 전에 `claim_step`(MCP 우선) 또는 CLI `speckiwi step claim`(fallback)으로 대상 step을 선점한다. MCP·CLI 둘 다 부재 시 즉시 halt. |
| §0.3 | **step 디렉터리 한정**. 모든 스펙 산출물은 `docs/spec/steps/<task>/` 아래에만 쓴다. body-scope SRS 파일(`docs/spec/*.srs.md`)은 절대 수정하지 않는다 — 승격은 오직 promote 도구로만. |
| §0.4 | **SDS 선행**. SDS(design.md) 없이 테스트를 먼저 작성하지 않는다 — 테스트만이 스펙이 되는 순간 reward-hacking에 노출된다. |
| §0.5 | **테스트 불가침**. 테스트를 먼저 커밋하고, green 단계에서 테스트를 약화(weaken)·수정해 통과시키는 행위를 절대 금지한다. 계약 변경이 필요하면 SDS를 supersede 하고 red부터 다시 간다. |
| §0.6 | **증거 없는 승격 금지**. `promote_step_requirement`는 Verification Evidence(검증 증거) 1건 이상을 가진 블록만 승격한다(FR-NODE-074가 tdd 모드에서 하드 거부). |
| §0.7 | **경계 준수(sdd redirect)**. 기존 body 요구(existing body REQ)의 수정과 대형(large)·아키텍처 변경은 본 스킬 범위 밖이다 — sdd 모드(SRS 선행, kiwi-srs/kiwi-planner 계열)로 리다이렉트한다. |
| §0.8 | **CLAUDE.md §6 시그니처 금지 / §7 변경 이력 금지**. |
| §0.9 | `--mini` / `--loops N` 수용 — `_shared/kiwi/loop-option.md` 관례. 본 스킬의 자체 검증-개선 루프는 red→green 반복뿐이므로 라운드 캡은 회귀 수정 반복에만 적용된다. |
| §0.10 | **코드 추적성은 후행(post-promote)·비차단**. 코드 Trace Links(`add_trace_link` Code anchor)·`@req` 태그는 Phase 6 promote가 body REQ ID를 확정한 **뒤에만** 복원한다 — Phase 2/4 부착은 금지한다. Code anchor가 **권위** traceability SSOT, `@req` breadcrumb는 **보조**이며 둘 다 **비차단**이다(누락·stale이 promote를 막지 않고 FR-NODE-074 EVIDENCE_REQUIRED 게이트와 **분리**). FR-FLOW-020 관례를 재사용하고, 태그 형식·면제는 kiwi-coder §0.17만 인용한다(운영 훅 수입 금지). |

---

## 1. 입력 / 출력

### 1.1 입력

| 신호 | 의미 |
|---|---|
| task 이름 `<task>` | 작업 대상 step. 부재 시 사용자에게 질의. |
| 작업 개요 | 무엇을 만들지(연구/의도). intent.md의 원천. |

### 1.2 출력

- `docs/spec/steps/<task>/design.md` — SDS (SDS-MD Authoring Rules v2.5.0 준수)
- red→green 테스트 + 구현 코드
- `docs/spec/steps/<task>/<task>.srs.md` — 합성된 step SRS
- body scope로 승격된 요구 블록(증거 포함)

---

## 2. Phase 흐름

```
Phase 0 : 모드·도구 확인 (Mode: tdd 아니면 halt; MCP 부재 시 step CLI fallback, 둘 다 부재 시 halt — §0.1/§0.2)
Phase 1 : claim_step 으로 step 선점 + Active Task 설정
Phase 2 : SDS 저작 — design.md (체크리스트 의무, §3)
Phase 3 : red — SDS-AC를 실패 테스트로 번역, 실패 확인 후 테스트 먼저 커밋
Phase 4 : green — 테스트 약화 없이 최소 구현으로 통과
Phase 5 : 회귀 — 영향 범위 테스트 전체 + `speckiwi vibe-gate check`
Phase 6 : 후행 SRS — synthesize → 요구 블록·증거 정리 → promote_step_requirement → 추적성 복원(add_trace_link code/implements + @req reconcile, post-promote·비차단, §0.10)
Phase 7 : update_step_state(merged) + 사용자 보고
```

### 2.1 Phase 0 — 모드·MCP 확인

MCP `get_work_mode`(가용 시 우선) 또는 CLI `speckiwi mode`로 현재 모드를 읽는다. `tdd`가 아니면 **halt**: "현재 모드는 X입니다. TDD First 사이클은 MCP `set_work_mode`(mode=tdd) 또는 `speckiwi mode tdd`로 전환 후 진행하거나, sdd 워크플로를 사용하십시오." MCP 서버가 없으면(unavailable) step 도구는 CLI(`speckiwi step claim/scaffold/synthesize/promote`)로 fallback 하고, MCP·CLI 둘 다 부재 시 즉시 halt.

### 2.2 Phase 1 — Claim

`claim_step`(MCP 우선) 또는 `speckiwi step claim <task> --touches-scope <scope> --touches-req <id>`(CLI fallback)로 대상 step을 선점한다. write-skew 게이트 거부(동일 REQ 충돌 등) 시 사유를 보고하고 중단. 선점 후 `speckiwi mode tdd` 상태에서 Active Task가 대상 task를 가리키도록 한다(vibe-gate가 이 task를 검사한다).

### 2.3 Phase 2 — SDS 저작 (체크리스트 의무)

`speckiwi step scaffold <task>`(MCP `scaffold_step`)로 design.md·intent.md 빈 스텁을 생성한 뒤(기존 파일은 절대 덮어쓰지 않음 — 스텁은 골격일 뿐, 내용은 직접 저작), `docs/spec/steps/<task>/design.md`를 SDS-MD Authoring Rules v2.5.0에 맞춰 저작한다. **아래 체크리스트는 의무이며 건너뛸 수 없다**:

1. **skip-gate 판정 먼저**: trade-off 없는 자명한(trivial) 변경인가? 그렇다면 SDS를 생략(skip)하고 intent.md에 EARS 스텁(SDS-AC 1~3문장)만 기록 후 Phase 3으로.
2. 필수 헤딩 7개 존재: Context & Scope / Goals / Non-goals / Architecture Decisions / Interfaces / Acceptance Contracts / Test Plan / Open Questions.
3. Acceptance Contracts는 **EARS** 문형(`SDS-AC-n: WHEN … THE SYSTEM SHALL …`).
4. **모든 SDS-AC가 Test Plan 표에 최소 1행으로 매핑**되는지 확인.
5. 200줄 상한 준수 — 초과 조짐이면 task를 분할.
6. Architecture Decisions에 실질 결정이 있으면 사용자 승인(agreed) 후 진행, 없으면 self-agreed로 진행.
7. `speckiwi step validate <task>`로 SDS advisory(SDS-W050~W053) 0건 확인.

### 2.4 Phase 3 — red

SDS §5의 각 SDS-AC를 실패하는 테스트로 번역한다(SDS-AC당 최소 1 케이스). 테스트를 실행해 **실패(red)를 확인**한 뒤 테스트를 먼저 커밋한다. red 확인 전 구현 착수 금지.

### 2.5 Phase 4 — green

테스트를 수정하지 않은 채 최소 구현으로 통과시킨다. 통과가 어렵다고 테스트를 약화하는 것은 절대 금지(§0.5) — 계약이 틀렸다면 SDS supersede 후 red부터 재시작. green 동안 새로 정의·수정한 **프로덕션 파일 경로를 touched 목록으로 기록**하고(Phase 6 추적성 스텝이 이 경로들을 인용), 코드에는 FR-FLOW-020 vibe식 active step **task-name** trace 태그를 breadcrumb로 남긴다(canonical REQ-ID는 아직 없음 — Phase 6에서 reconcile).

### 2.6 Phase 5 — 회귀

영향 범위의 기존 테스트 전체를 실행해 0 회귀를 확인하고, `speckiwi vibe-gate check`로 step 게이트(합성·design.md)를 통과시킨다.

### 2.7 Phase 6 — 후행 SRS 승격

1. `speckiwi step synthesize <task>`(MCP `synthesize_step_srs`)로 step SRS를 합성한다(멱등 — 기존 산출물이 있으면 no-op). 합성 결과 위에서 design.md의 SDS-AC를 요구 블록의 Acceptance Criteria로 이관하고, Phase 3~5의 테스트를 Verification Evidence 행으로 기록한다.
2. `promote_step_requirement`(MCP) 또는 `speckiwi step promote <id> --from-step <task> --to-scope <scope>`(CLI fallback)로 body scope에 승격한다. **검증 증거 0건이면 tdd 모드에서 EVIDENCE_REQUIRED로 거부된다** — 거부 시 증거를 채우고 재시도한다(우회 금지).
3. **추적성 복원 (post-promote, 비차단, §0.10)** — promote가 body Requirement ID를 확정한 **후에만** 적용한다(Phase 2/4에서는 부착 금지):
   - (a) 승격된 body 요구에 `add_trace_link(type=code, relation=implements, reference=<Phase 4 touched 프로덕션 파일>)`를 호출해 **권위 Trace Links Code anchor**(traceability SSOT)를 남긴다. 여러 파일을 만졌으면 파일마다 1행씩.
   - (b) Phase 4 프로덕션 코드의 vibe식 **task-name** trace 태그를 최종 승격 REQ-ID로 **reconcile(재조정)**해 `@req <REQ-ID>` **보조 breadcrumb**로 남긴다 — **FR-FLOW-020** 관례를 따르되, 태그 형식·면제(단일 라인 형식·테스트 파일 면제·부착 위치)는 **kiwi-coder §0.17**만 인용한다(운영 훅 수입 금지).
   - (c) 둘 다 **비차단**이다 — code Trace Link나 `@req`의 누락·stale은 promote를 막지 않으며 EVIDENCE_REQUIRED 게이트와 분리된다(§0.10). Code anchor가 **권위**, `@req`는 **보조 breadcrumb**임을 기억한다.

### 2.8 Phase 7 — 마무리

`update_step_state`(CLI `speckiwi step update-state <task> --status merged`)로 step을 merged로 전이한다. **merged 전이는 완료게이트(FR-NODE-078)를 통과해야 한다** — step의 TouchesReq 폐포에 비-clean 호환 엣지가 남아 있으면 COMPLETION_GATE_BLOCKED 로 거부되므로, 모순을 해소(재호환 검사)하거나 사용자 확인 후 acknowledged 로 명시 승인한다. 이후 산출물 경로·테스트 결과·승격된 REQ ID를 사용자에게 보고한다.

---

## 3. 경계 (sdd redirect)

다음은 본 스킬로 진행하지 않는다 — 감지 즉시 중단하고 sdd 모드를 안내한다:

- **기존 body 요구(existing body REQ)의 수정**: step↔body 동일 REQ 충돌은 promote 시점에야 MUTATION_DENIED로 표면화되므로, 시작 전에 sdd로 보낸다.
- **대형(large) 기능·아키텍처(architecture) 변경**: SDS가 200줄 상한에 근접하는 순간이 신호다 — SRS 선행(sdd)이 더 빠르고 안전한 구간이다.

---

## 4. 외부 의존성

| 도구 | 용도 | 부재 시 |
|---|---|---|
| `get_work_mode` / `set_work_mode` (MCP, 우선) 또는 `speckiwi mode` (CLI) | 모드 확인·전환 §0.1 | halt |
| `claim_step` (MCP 우선 / CLI `speckiwi step claim`) | step 선점 §0.2 | 둘 다 부재 시 halt |
| `scaffold_step` (MCP / CLI `speckiwi step scaffold`) | SDS·intent 스텁 생성 §2.3 | 템플릿 수동 복사 |
| `speckiwi step validate` / `validate_step` | SDS advisory 검증 §2.3 | CLI fallback, 둘 다 부재 시 체크리스트 수동 수행 |
| `check_vibe_gate` (MCP) / `speckiwi vibe-gate check` (CLI) | 합성·SDS 존재 게이트 §2.6 | 사용자 안내 |
| `synthesize_step_srs` (MCP / CLI `speckiwi step synthesize`) | step SRS 합성 §2.7 | step SRS 직접 정리 |
| `promote_step_requirement` (MCP / CLI `speckiwi step promote`) | 후행 SRS 승격 §2.7 | 둘 다 부재 시 halt + 수동 승격 금지 안내 |
| `add_trace_link` (MCP) | 승격 요구에 code anchor 복원 §2.7 (비차단) | 스킬 계속 — 추적성만 누락, promote 미차단 |
