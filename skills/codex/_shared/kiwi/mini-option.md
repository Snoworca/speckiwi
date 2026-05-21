# `--mini` 공용 옵션 (kiwi-* standard override)

> **2026-05-19 신설** — kiwi 시리즈 7개 스킬:
> - 명세 (신규 도입): `kiwi-srs`, `kiwi-srs-feasibility`, `kiwi-srs-from-code`, `kiwi-srs-research`
> - 계획 (신규 도입): `kiwi-planner`
> - 코딩 (마이그레이션): `kiwi-coder` — 기존 `--squirrel` 을 `--mini` 정규명으로 교체, `--squirrel` 은 deprecated alias 로 유지 (§11)
> - 사후 동기화 (마이그레이션): `kiwi-srs-sync` — 동일
>
> kiwi 내부에서 `--squirrel` 은 `--mini` 의 deprecated alias (§10).

## 0. 한 줄 정의

`--mini` 플래그가 지정되면, 본 스킬이 **spawn 하는 모든 서브에이전트의 모델을 `standard` 으로 강제 override** 한다. 메인 세션 모델 (사용자가 `/model` 로 설정한 high-reasoning 등) 은 통제 범위 외.

## 1. 적용 대상 매트릭스

| 호출 위치 | 기본 모델 | `--mini` 시 |
|----------|-----------|-------------|
| 시니어 작성자 (high-reasoning 시니어) | high-reasoning | **standard** |
| 시니어 분석가 (feasibility) | high-reasoning | **standard** |
| 평가자 — high-reasoning 축 (Normal: ×1, Max: ×2) | high-reasoning | **standard** |
| 평가자 — standard 축 (×1) | standard | standard (변경 없음) |
| Pre-investigation 3 서브에이전트 | standard | standard (변경 없음) |
| QnA reviewer dropout 라운드 (kiwi-srs --qna) | high-reasoning | **standard** |
| Classification / Feasibility 단일 Phase (kiwi-srs §6/§8) | standard | standard (변경 없음) |
| Research Triage (kiwi-srs-research Phase R0) | standard | standard (변경 없음) |
| Research Researchers (kiwi-srs-research Phase R1, ×3) | high-reasoning | **standard** |
| Research Synthesizer (kiwi-srs-research Phase R2, ×1) | high-reasoning | **standard** |
| 4축 검증자 — high-reasoning 축 (kiwi-srs-from-code Phase 4) | high-reasoning | **standard** |
| 4축 검증자 — standard 축 | standard | standard (변경 없음) |
| 시니어 코더 (kiwi-coder Phase 2.c) | high-reasoning (Normal ×1, Max ×3) | **standard × 1** |
| TDD 검증 (kiwi-coder Phase 1.2, standard × 4) | standard | standard (변경 없음 — 모든 모드 공통, §0.1 강제) |
| 정형 검사 (kiwi-coder Phase 2.e) | standard | standard (변경 없음) |
| 까칠 리뷰어 (kiwi-coder Phase 2.f) | high-reasoning (Normal ×1, Max ×2) | **standard × 1** |
| 시니어 분석가 (kiwi-srs-sync Phase 3) | high-reasoning | **standard** |
| 평가자 (kiwi-srs-sync Phase 4) — high-reasoning 축 | high-reasoning | **standard** (standard×2 토폴로지) |

**적용 제외**:
- 메인 실행자 (현재 세션) — 사용자 `/model` 설정 따름
- 사용자가 의사코드에서 `reasoning_effort="high"` 를 명시적으로 강제한 호출 (그런 경우는 의도적 high-stakes 영역으로 간주)
- 외부 라이브러리·MCP 도구·validator.mjs 등 LLM 비-서브에이전트 호출

## 2. 정책 — 의사코드 해석 규약

본 모듈을 참조하는 스킬의 의사코드 / 자연어 본문 어디에든 "high-reasoning 시니어", "high-reasoning×1 평가자", "high-reasoning 평가자", "high-reasoning×3 Researchers", "high-reasoning Synthesizer" 같은 표현이 나오면, `--mini` 활성 시 LLM 은 그 모든 인용을 `standard` 으로 read-time replace 한다. 즉:

- 자연어: "high-reasoning 시니어 작성자" → 마치 "standard 시니어 작성자" 라고 쓰여 있는 것처럼 해석
- 표 행: "high-reasoning | 1 | 서브에이전트" → "standard | 1 | 서브에이전트" 로 해석
- delegated sub-agent request 의 high reasoning effort → medium reasoning effort
- Codex sub-agent 호출 시 사용 가능한 경우 낮은 추론 effort를 선택

본 read-time replace 는 **사본을 만들지 않는다** — 5개 스킬은 본문을 그대로 두고 본 모듈 참조 한 줄만 추가하면 충분.

## 3. 토폴로지·게이트·라운드 상한 정책 (변경 없음)

`--mini` 는 **모델만** 바꾼다. 다음은 본 스킬의 기존 정책 그대로 유지된다:

- **서브에이전트 개수와 격리 구조** (예: kiwi-srs-research §0.5 의 "5-서브에이전트 고정 토폴로지" — standard×1 Triage + high-reasoning(→standard)×3 Researchers + high-reasoning(→standard)×1 Synthesizer. 모델만 바뀌고 토폴로지·격리·입력 분배 규칙은 그대로)
- **심각도 게이트** (CRITICAL/HIGH/MEDIUM/LOW 분류와 통과 조건은 불변)
- **Normal 종료 조건**: CRITICAL = 0 AND HIGH = 0 (5회 상한)
- **Max 종료 조건**: 2 라운드 연속 MEDIUM = 0 (15회 상한)
- **QnA 라운드 상한** (kiwi-srs `--qna`: reviewer dropout 3/7 라운드)
- **Phase 1 Pre-investigation 격리** (standard×3 병렬, cross-share 금지)
- **Researcher A/B/C isolation** (kiwi-srs-research §0.10)
- **Synthesizer 무결성 게이트** (kiwi-srs-research §0.G4, §0.4 hallucination 금지)
- **validator.mjs 무결성 검증** (kiwi-planner Phase 4)

`--max` 와 `--mini` 는 **공존 가능** — `--max --mini` 은 "standard 으로 Max 모드" (라운드 강도는 Max, 모델은 standard).

## 4. 비용 효과

각 스킬의 평가자가 high-reasoning×1 + standard×1 병렬 패턴(또는 Researchers ×3 high-reasoning) 을 사용하므로, `--mini` 시 high-reasoning 호출이 모두 standard 으로 대체:

| 스킬 | 추정 절감 |
|---|---|
| `kiwi-srs` | ~40-50% (시니어 + high-reasoning 평가자 + QNA 라운드) |
| `kiwi-srs-feasibility` | ~40-50% (시니어 분석가 + high-reasoning 평가자) |
| `kiwi-srs-from-code` | ~30-40% (4축 검증자 중 high-reasoning 축) |
| `kiwi-planner` | ~40% (시니어 + high-reasoning 평가자) |
| `kiwi-srs-research` | ~60% (Researchers ×3 + Synthesizer 모두 high-reasoning → standard) |
| `kiwi-coder` | ~30% (시니어 코더 + 까칠 리뷰어 → standard, TDD 검증 standard×4 는 원래 standard 이라 불변. kiwi-coder skill.md §1 의 `--squirrel` 0.7× 와 동치) |
| `kiwi-srs-sync` | ~50% (시니어 분석가 + 평가자 high-reasoning 축 → standard. kiwi-srs-sync skill.md §1 의 `--squirrel` 0.5× 와 동치) |

standard 가격이 high-reasoning 의 ~1/5 이라는 가정 하 추정. 실제 절감은 평가 라운드 수에 의존.

## 5. 언제 mini 를 쓰나

| 상황 | 권장 |
|------|------|
| 명세 / 계획이 잘 갖춰진 일반 영역 (CRUD, 보일러플레이트, 표준 패턴) | `--mini` |
| 요구사항 갯수 적음 (kiwi-srs: REQ 1~2개 추가, kiwi-planner: REQ 5개 이하) | `--mini` |
| 도메인 특수 (보안 / 규제 / 실시간 / 분산 / 고동시성 / 충돌 가능성 큰 영역) | 기본 (high-reasoning 평가자 유지) |
| 비용 한도 엄격, 사전 평가 후 본 작성 | `--mini` |
| 새 기술 스택 / 불확실성 높음 / 정책 충돌 잠재 | 기본 |
| 야간 무인 일괄 작업 (feasibility 전수 평가 등 high-reasoning 토큰 비용 부담 큼) | `--mini` |
| Max 모드로 평가 강도만 최대화 | `--max --mini` (라운드 ↑, 모델 ↓) |
| `kiwi-srs-from-code` 대규모 코드베이스 역추출 (수십~수백 REQ) | `--mini` 권장 |
| `kiwi-srs-research` deep research, 외부 URL 다수 fetch | 기본 (Synthesizer 의 hallucination 게이트 품질 중요) |

## 6. legacy `--squirrel` 과의 관계

| 항목 | legacy `--squirrel` | kiwi `--mini` |
|---|---|---|
| 대상 스킬 | 이전 명명 규약 | kiwi 명세/계획/코딩/동기화 스킬 |
| 코더 적용 | 별도 구현별 상이 | `kiwi-coder` 는 deprecated alias 로 수용 |
| SSOT 모듈 | 없음 | 본 모듈 |
| `--max` 공존 | 가능 | 가능 |
| 트리거 명명 | `--squirrel` (다람쥐, standard 별명) | `--mini` (모델 다운사이즈 시멘틱 직역) |

kiwi-* 스킬에서는 `--mini` 를 정규명으로 사용한다. `--squirrel` 은 호환 alias 로만 처리하고 새 문서에서는 확장하지 않는다.

## 7. 하위 호출 전파 (kiwi 내부)

kiwi-* 스킬이 다른 kiwi-* 스킬을 서브에이전트로 호출하는 경우 (`kiwi-srs-feasibility` 가 `kiwi-srs-research` 를 subagent 모드로 호출 등), 부모 호출에 `--mini` 가 활성이면 자식 호출에도 `--mini` 를 명시 전파해야 한다.

| 호출 관계 | 전파 의무 |
|---|---|
| `kiwi-srs-feasibility --mini` → `kiwi-srs-research --mode=subagent` | 자식 호출에 `--mini` 추가 |
| `kiwi-pipeline` (가상) → 각 단계 스킬 | 파이프라인 인자로 전파 |

미전파 시 자식이 high-reasoning 로 실행되어 비용 효과 부분 손실. 위반은 LOW severity 로 보고.

## 8. 호환

- `--max` / `--qna` 와 공존 가능
- `--dry-run` 과 공존 가능 (각 스킬의 dry-run 정책 그대로, 모델만 standard)
- `--mini --no-mini` 식의 부정 플래그 없음 — 옵션 미지정이 곧 high-reasoning 기본
- 미지원 스킬에 `--mini` 전달 시 silent ignore (스킬이 본 모듈 참조 안 하면)
- 사용자 자연어 신호: "비용 절감", "standard 으로", "mini 모드", "저렴하게" → `--mini` 매핑

## 9. 인자 매칭 규약

본 모듈을 참조하는 스킬은 다음 순서로 `--mini` 활성 여부를 판정한다:

1. **skill invocation prompt or delegated sub-agent message token** — `$kiwi-* --mini` 형태의 스킬 호출 문구 또는 서브에이전트 message 안의 `--mini` 토큰을 정규식 `--mini\b` 로 매칭. 가장 강한 신호.
2. **자연어 신호** — 사용자 발화에 "mini 모드", "비용 절감", "standard 으로" 등 §8 매핑 어휘 존재 시 사용자에게 1회 확인 후 활성.
3. **부모 호출 전파** — §7 표에 따른 자동 전파.

활성 시 분석 로그(`docs/analysis/{skill-run-id}/preflight.json` 등) 의 `mode_flags` 에 `"--mini"` 를 기록.

## 10. `--squirrel` deprecated alias (kiwi-coder / kiwi-srs-sync 마이그레이션)

`kiwi-coder` v0.1 및 `kiwi-srs-sync` v0.1 은 본 모듈 도입 이전에 `--squirrel` 플래그를 채택했다. 본 모듈 v1.0 도입 시점부터 다음 정책을 적용한다:

| 항목 | 정책 |
|---|---|
| **정규명** | `--mini` (kiwi 시리즈 통일) |
| **Deprecated alias** | `--squirrel` — `--mini` 와 동일 의미로 처리 (read-time alias) |
| **Alias 유지 기간** | kiwi-coder v0.2 / kiwi-srs-sync v0.2 까지. v0.3 부터 제거 예고 |
| **사용자 보고** | 사용자가 `--squirrel` 사용 시 1회 안내 출력: "ℹ️  `--squirrel` 은 kiwi 시리즈에서 `--mini` 로 통일되었습니다. 향후 `--mini` 사용 권장." (실행은 정상 진행) |
| **공존** | 동일 호출에 `--mini --squirrel` 동시 지정 시 silent merge (활성 1회) |
| **자연어 신호** | "다람쥐", "standard 으로", "squirrel" 도 `--mini` 매핑 (§8) |

**marshalling 규약**: kiwi-coder / kiwi-srs-sync 의 skill.md 본문 §1 자연어 신호 표에서 "다람쥐", "standard 으로" → `--squirrel` 매핑은 유지하되, `--squirrel` 줄 옆에 "(deprecated alias of --mini)" 주석을 추가한다.

## 11. 변경 이력

- 2026-05-19: v1.0 신설. kiwi 시리즈 `--mini` SSOT 도입. kiwi-coder / kiwi-srs-sync 의 기존 `--squirrel` 은 §10 정책에 따라 deprecated alias 로 유지.
