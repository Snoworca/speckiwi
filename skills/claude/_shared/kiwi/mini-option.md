# `--mini` 공용 옵션 (kiwi-* Sonnet override)

> **2026-05-19 신설** — kiwi 시리즈 7개 스킬:
> - 명세 (신규 도입): `kiwi-srs`, `kiwi-srs-feasibility`, `kiwi-srs-from-code`, `kiwi-srs-research`
> - 계획 (신규 도입): `kiwi-planner`
> - 코딩 (마이그레이션): `kiwi-coder` — 기존 `--squirrel` 을 `--mini` 정규명으로 교체, `--squirrel` 은 deprecated alias 로 유지 (§11)
> - 사후 동기화 (마이그레이션): `kiwi-srs-sync` — 동일
>
> snoworca 시리즈의 `_shared/snoworca/squirrel-option.md` v1.0 패턴을 kiwi 시리즈로 이식. snoworca 와의 차이는 §6 참조. kiwi 내부에서 `--squirrel` 은 `--mini` 의 deprecated alias (§11).

## 0. 한 줄 정의

`--mini` 플래그가 지정되면, 본 스킬이 **spawn 하는 모든 서브에이전트의 모델을 `sonnet` 으로 강제 override** 한다. 메인 세션 모델 (사용자가 `/model` 로 설정한 Opus 등) 은 통제 범위 외.

## 1. 적용 대상 매트릭스

| 호출 위치 | 기본 모델 | `--mini` 시 |
|----------|-----------|-------------|
| 시니어 작성자 (Opus 시니어) | Opus | **Sonnet** |
| 시니어 분석가 (feasibility) | Opus | **Sonnet** |
| 평가자 — Opus 축 (Normal: ×1, Max: ×2) | Opus | **Sonnet** |
| 평가자 — Sonnet 축 (×1) | Sonnet | Sonnet (변경 없음) |
| Pre-investigation 3 서브에이전트 | Sonnet | Sonnet (변경 없음) |
| QnA Agent Dropout 라운드 (kiwi-srs --qna) | Opus | **Sonnet** |
| Classification / Feasibility 단일 Phase (kiwi-srs §6/§8) | Sonnet | Sonnet (변경 없음) |
| Research Triage (kiwi-srs-research Phase R0) | Sonnet | Sonnet (변경 없음) |
| Research Researchers (kiwi-srs-research Phase R1, ×3) | Opus | **Sonnet** |
| Research Synthesizer (kiwi-srs-research Phase R2, ×1) | Opus | **Sonnet** |
| 4축 검증자 — Opus 축 (kiwi-srs-from-code Phase 4) | Opus | **Sonnet** |
| 4축 검증자 — Sonnet 축 | Sonnet | Sonnet (변경 없음) |
| 시니어 코더 (kiwi-coder Phase 2.c) | Opus (Normal ×1, Max ×3) | **Sonnet × 1** |
| TDD 검증 (kiwi-coder Phase 1.2, Sonnet × 4) | Sonnet | Sonnet (변경 없음 — 모든 모드 공통, §0.1 강제) |
| 정형 검사 (kiwi-coder Phase 2.e) | Sonnet | Sonnet (변경 없음) |
| 까칠 리뷰어 (kiwi-coder Phase 2.f) | Opus (Normal ×1, Max ×2) | **Sonnet × 1** |
| 시니어 분석가 (kiwi-srs-sync Phase 3) | Opus | **Sonnet** |
| 평가자 (kiwi-srs-sync Phase 4) — Opus 축 | Opus | **Sonnet** (Sonnet×2 토폴로지) |

**적용 제외**:
- 메인 실행자 (현재 세션) — 사용자 `/model` 설정 따름
- 사용자가 의사코드에서 `model="opus"` 를 명시적으로 강제한 호출 (그런 경우는 의도적 high-stakes 영역으로 간주)
- 외부 라이브러리·MCP 도구·validator.mjs 등 LLM 비-서브에이전트 호출

## 2. 정책 — 의사코드 해석 규약

본 모듈을 참조하는 스킬의 의사코드 / 자연어 본문 어디에든 "Opus 시니어", "Opus×1 평가자", "Opus 평가자", "Opus×3 Researchers", "Opus Synthesizer" 같은 표현이 나오면, `--mini` 활성 시 LLM 은 그 모든 인용을 `Sonnet` 으로 read-time replace 한다. 즉:

- 자연어: "Opus 시니어 작성자" → 마치 "Sonnet 시니어 작성자" 라고 쓰여 있는 것처럼 해석
- 표 행: "Opus | 1 | 서브에이전트" → "Sonnet | 1 | 서브에이전트" 로 해석
- `Agent(model="opus", ...)` 또는 `Task(subagent_type=..., model="opus", ...)` → `model="sonnet"`
- claude CLI 자식 spawn 시 `--model claude-sonnet-4-6` 추가 (필요 시)

본 read-time replace 는 **사본을 만들지 않는다** — 5개 스킬은 본문을 그대로 두고 본 모듈 참조 한 줄만 추가하면 충분.

## 3. 토폴로지·게이트·라운드 상한 정책 (변경 없음)

`--mini` 는 **모델만** 바꾼다. 다음은 본 스킬의 기존 정책 그대로 유지된다:

- **서브에이전트 개수와 격리 구조** (예: kiwi-srs-research §0.5 의 "5-서브에이전트 고정 토폴로지" — Sonnet×1 Triage + Opus(→Sonnet)×3 Researchers + Opus(→Sonnet)×1 Synthesizer. 모델만 바뀌고 토폴로지·격리·입력 분배 규칙은 그대로)
- **심각도 게이트** (CRITICAL/HIGH/MEDIUM/LOW 분류와 통과 조건은 불변)
- **Normal 종료 조건**: CRITICAL = 0 AND HIGH = 0 (5회 상한)
- **Max 종료 조건**: 2 라운드 연속 MEDIUM = 0 (15회 상한)
- **QnA 라운드 상한** (kiwi-srs `--qna`: Agent Dropout 3/7 라운드)
- **Phase 1 Pre-investigation 격리** (Sonnet×3 병렬, cross-share 금지)
- **Researcher A/B/C isolation** (kiwi-srs-research §0.10)
- **Synthesizer 무결성 게이트** (kiwi-srs-research §0.G4, §0.4 hallucination 금지)
- **validator.mjs 무결성 검증** (kiwi-planner Phase 4)

`--max` 와 `--mini` 는 **공존 가능** — `--max --mini` 은 "Sonnet 으로 Max 모드" (라운드 강도는 Max, 모델은 Sonnet).

## 4. 비용 효과

각 스킬의 평가자가 Opus×1 + Sonnet×1 병렬 패턴(또는 Researchers ×3 Opus) 을 사용하므로, `--mini` 시 Opus 호출이 모두 Sonnet 으로 대체:

| 스킬 | 추정 절감 |
|---|---|
| `kiwi-srs` | ~40-50% (시니어 + Opus 평가자 + QNA 라운드) |
| `kiwi-srs-feasibility` | ~40-50% (시니어 분석가 + Opus 평가자) |
| `kiwi-srs-from-code` | ~30-40% (4축 검증자 중 Opus 축) |
| `kiwi-planner` | ~40% (시니어 + Opus 평가자) |
| `kiwi-srs-research` | ~60% (Researchers ×3 + Synthesizer 모두 Opus → Sonnet) |
| `kiwi-coder` | ~30% (시니어 코더 + 까칠 리뷰어 → Sonnet, TDD 검증 Sonnet×4 는 원래 Sonnet 이라 불변. kiwi-coder skill.md §1 의 `--squirrel` 0.7× 와 동치) |
| `kiwi-srs-sync` | ~50% (시니어 분석가 + 평가자 Opus 축 → Sonnet. kiwi-srs-sync skill.md §1 의 `--squirrel` 0.5× 와 동치) |

Sonnet 가격이 Opus 의 ~1/5 이라는 가정 하 추정. 실제 절감은 평가 라운드 수에 의존.

## 5. 언제 mini 를 쓰나

| 상황 | 권장 |
|------|------|
| 명세 / 계획이 잘 갖춰진 일반 영역 (CRUD, 보일러플레이트, 표준 패턴) | `--mini` |
| 요구사항 갯수 적음 (kiwi-srs: REQ 1~2개 추가, kiwi-planner: REQ 5개 이하) | `--mini` |
| 도메인 특수 (보안 / 규제 / 실시간 / 분산 / 고동시성 / 충돌 가능성 큰 영역) | 기본 (Opus 평가자 유지) |
| 비용 한도 엄격, 사전 평가 후 본 작성 | `--mini` |
| 새 기술 스택 / 불확실성 높음 / 정책 충돌 잠재 | 기본 |
| 야간 무인 일괄 작업 (feasibility 전수 평가 등 Opus 토큰 비용 부담 큼) | `--mini` |
| Max 모드로 평가 강도만 최대화 | `--max --mini` (라운드 ↑, 모델 ↓) |
| `kiwi-srs-from-code` 대규모 코드베이스 역추출 (수십~수백 REQ) | `--mini` 권장 |
| `kiwi-srs-research` deep research, 외부 URL 다수 fetch | 기본 (Synthesizer 의 hallucination 게이트 품질 중요) |

## 6. snoworca `--squirrel` 과의 차이

| 항목 | snoworca `--squirrel` | kiwi `--mini` |
|---|---|---|
| 대상 스킬 | 명세/계획/코딩/문서 8종 | kiwi 명세/계획 5종 (코딩 스킬 미존재) |
| 코더 적용 | snoworca-coder 까지 | (해당 없음) |
| SSOT 모듈 | `_shared/snoworca/squirrel-option.md` | `_shared/kiwi/mini-option.md` (본 모듈) |
| `--max` 공존 | 가능 | 가능 |
| 트리거 명명 | `--squirrel` (다람쥐, sonnet 별명) | `--mini` (모델 다운사이즈 시멘틱 직역) |

snoworca-* 스킬과 kiwi-* 스킬 사이의 호출은 금지 (CLAUDE.md §7) 이므로 두 플래그는 서로 전파되지 않는다.

## 7. 하위 호출 전파 (kiwi 내부)

kiwi-* 스킬이 다른 kiwi-* 스킬을 서브에이전트로 호출하는 경우 (`kiwi-srs-feasibility` 가 `kiwi-srs-research` 를 subagent 모드로 호출 등), 부모 호출에 `--mini` 가 활성이면 자식 호출에도 `--mini` 를 명시 전파해야 한다.

| 호출 관계 | 전파 의무 |
|---|---|
| `kiwi-srs-feasibility --mini` → `kiwi-srs-research --mode=subagent` | 자식 호출에 `--mini` 추가 |
| `kiwi-pipeline` (가상) → 각 단계 스킬 | 파이프라인 인자로 전파 |

미전파 시 자식이 Opus 로 실행되어 비용 효과 부분 손실. 위반은 LOW severity 로 보고.

## 8. 호환

- `--max` / `--qna` 와 공존 가능
- `--dry-run` 과 공존 가능 (각 스킬의 dry-run 정책 그대로, 모델만 Sonnet)
- `--mini --no-mini` 식의 부정 플래그 없음 — 옵션 미지정이 곧 Opus 기본
- 미지원 스킬에 `--mini` 전달 시 silent ignore (스킬이 본 모듈 참조 안 하면)
- 사용자 자연어 신호: "비용 절감", "sonnet 으로", "mini 모드", "저렴하게" → `--mini` 매핑

## 9. 인자 매칭 규약

본 모듈을 참조하는 스킬은 다음 순서로 `--mini` 활성 여부를 판정한다:

1. **Skill/Agent 도구 인자 또는 description token** — `Skill(args: "--mini ...")` / `Agent({ description: "... --mini" })` 의 args/description 파라미터에서 정규식 `--mini\b` 매칭. 가장 강한 신호.
2. **자연어 신호** — 사용자 발화에 "mini 모드", "비용 절감", "sonnet 으로" 등 §8 매핑 어휘 존재 시 사용자에게 1회 확인 후 활성.
3. **부모 호출 전파** — §7 표에 따른 자동 전파.

활성 시 분석 로그(`docs/analysis/{skill-run-id}/preflight.json` 등) 의 `mode_flags` 에 `"--mini"` 를 기록.

## 10. `--squirrel` deprecated alias (kiwi-coder / kiwi-srs-sync 마이그레이션)

`kiwi-coder` v0.1 및 `kiwi-srs-sync` v0.1 은 본 모듈 도입 이전에 snoworca 명명 규약을 따라 `--squirrel` 플래그를 채택했다. 본 모듈 v1.0 도입 시점부터 다음 정책을 적용한다:

| 항목 | 정책 |
|---|---|
| **정규명** | `--mini` (kiwi 시리즈 통일) |
| **Deprecated alias** | `--squirrel` — `--mini` 와 동일 의미로 처리 (read-time alias) |
| **Alias 유지 기간** | kiwi-coder v0.2 / kiwi-srs-sync v0.2 까지. v0.3 부터 제거 예고 |
| **사용자 보고** | 사용자가 `--squirrel` 사용 시 1회 안내 출력: "ℹ️  `--squirrel` 은 kiwi 시리즈에서 `--mini` 로 통일되었습니다. 향후 `--mini` 사용 권장." (실행은 정상 진행) |
| **공존** | 동일 호출에 `--mini --squirrel` 동시 지정 시 silent merge (활성 1회) |
| **자연어 신호** | "다람쥐", "sonnet 으로", "squirrel" 도 `--mini` 매핑 (§8) |

**marshalling 규약**: kiwi-coder / kiwi-srs-sync 의 skill.md 본문 §1 자연어 신호 표에서 "다람쥐", "sonnet 으로" → `--squirrel` 매핑은 유지하되, `--squirrel` 줄 옆에 "(deprecated alias of --mini)" 주석을 추가한다.

## 11. 변경 이력

- 2026-05-19: v1.0 신설. snoworca `_shared/snoworca/squirrel-option.md` v1.0 패턴을 kiwi 시리즈 7개 스킬에 이식. snoworca-* 호출 금지 규약 (CLAUDE.md §7) 에 따라 두 플래그 독립 운용. kiwi-coder / kiwi-srs-sync 의 기존 `--squirrel` 은 §10 정책에 따라 deprecated alias 로 유지.
