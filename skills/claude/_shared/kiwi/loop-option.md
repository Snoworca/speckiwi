# `--mini` / `--loops` 루프 카운터 옵션 SSOT v1.0

kiwi-* 스킬의 **검증-개선 루프(verify → improve → re-verify) 라운드 상한**을 제어하는 공용 옵션 정의. 본 문서를 참조하는 모든 스킬은 아래 의미를 read-time 에 동일하게 적용한다.

> **주의**: 본 `--mini` 는 **라운드 상한 프리셋**이다. FR-FLOW-022 가 제거한 **모델 스왑(Opus→Sonnet) `--mini`** 와는 무관하다. 모델 선택은 여전히 `--model <name>` 전용이며, FR-FLOW-022 가 삭제한 그 구(舊) 모델-스왑 공유 SSOT 는 부활하지 않는다.

## 1. 옵션 정의

| 옵션 | 의미 | 기본값 |
|---|---|---|
| `--mini` | 빠른 모드 프리셋 — 검증-개선 루프 **라운드 상한 = 3** | off (스킬 고유 기본 상한) |
| `--loops N` / `--loops=N` | 명시적 루프 카운터 — 라운드 상한 = N (정수 N ≥ 1) | off (스킬 고유 기본 상한) |

- **라운드(round)** = 1회의 verify → improve 사이클 (평가자 실행 → finding 수정 → 재검증).
- 라운드 상한은 **상한(upper bound)** 이다. 기존 심각도 게이트(Normal `CRITICAL=0 + HIGH=0` / Max `2연속 MEDIUM-zero`)가 상한 이전에 **조기 종료**할 수 있다. 즉 `--mini` 는 "정확히 3회"가 아니라 **"최대 3라운드"** 다.
- `--loops N` 의 N 은 **양의 정수**여야 한다. `N < 1` 또는 비정수는 **오류로 거절**한다(HALT + 사용법 안내).

## 2. 우선순위 — `--mini` vs `--loops` 동시 지정

| 입력 | 결과 |
|---|---|
| `--mini` 만 | 라운드 상한 3 |
| `--loops N` 만 | 라운드 상한 N |
| `--mini` + `--loops N` (동시) | **`--loops N` 우선(wins)** — 명시적 카운터가 프리셋을 override. **순서 무관(order-independent)**. **비-치명 경고(WARN)** 출력: "`--mini` 의 3라운드 상한이 `--loops N` 으로 override 됨" |

**근거**: 명시적·구체적 플래그가 프리셋 기본값을 override 하는 것은 kiwi 관례(auto-option §11.1 specific `--auto-apply` > broad `--auto`, pipeline explicit `next_hint` > Table T1, feasibility explicit `--research-respawn-limit` > mode default, FR-FLOW-022 `--model` > session default)이자 일반 CLI 관례(gcc `-O2` + `-fno-*`, rsync `-a` + `--no-perms`, ESLint extends override)다. 3-서브에이전트 만장일치 결정 — `docs/analysis/kiwi-loop-option-2026-07-12.speckiwi.v2301/priority-research.md`.

## 3. 상한 도달 시 동작 (cap-reached)

- 심각도 게이트가 clean 되기 전에 라운드 상한에 도달하면: **루프를 중단**하고 **잔여(residual) finding 을 보고**한다 — silent truncation 금지(무엇이 미해결로 남았는지 산출물에 명시).
- **안전 게이트를 우회하지 않는다**: 잔여 `CRITICAL`/`HIGH` finding 은 여전히 표면화되고(보고 + blocked/warn 상태), 라운드 상한은 무한 에스컬레이션을 멈출 뿐 CRITICAL 을 은폐하지 않는다.
- 경고·잔여 보고 채널 = 각 스킬의 표준 산출물(report.md / 콘솔 요약 / worklog.jsonl).

## 4. `--max` 와의 직교성 (orthogonal, compose)

- `--max` 는 **검증 강도**(평가자 수 / 게이트 엄격도 / 위원회·발산 에스컬레이션)를 제어하며, **라운드 상한과 직교**한다.
- 두 옵션은 **조합(compose)** 된다: `--max --loops 5` = 엄격 게이트 + 5라운드 상한.
- 명시적 `--loops N` 은 `--max` 파생 기본 상한(예: kiwi-srs 5→8, kiwi-srs-feasibility 5→15)도 override 한다. 단 `--max` 는 게이트 엄격도를 계속 지배하며, 게이트는 상한 이전에 루프를 종료할 수 있다.

## 5. 무-루프 스킬

검증-개선 루프가 없는 스킬(kiwi-step, kiwi-srs-research)은 `--mini` / `--loops` 를 **문서화된 no-op** 으로 수용한다(오케스트레이터 전파 균일성). 상한을 적용할 루프가 없으므로 동작에 영향 없음.

## 6. 오케스트레이터 전파 (FR-FLOW-035)

오케스트레이터는 `--mini` / `--loops N` 을 spawn·위임하는 모든 kiwi 하위(child sub-skill) 스킬에 **전파(propagate)** 한다. `auto-option.md §7` 자식 전파 표와 동일 패턴이며 additive 다.

| 오케스트레이터 | 하위 스킬 | 전파 |
|---|---|---|
| kiwi-pm | kiwi-coder | `--mini`/`--loops N` → 자식 spawn 인자 |
| kiwi-pipeline | 모든 spawn 하위 스킬 | `--mini`/`--loops N` → 전 하위 |
| kiwi-wave-master | per-wave kiwi-srs + kiwi-pipeline | `--mini`/`--loops N` → per-wave |
| kiwi-hot-fix | kiwi-srs-sync | `--mini`/`--loops N` → 위임 |
| kiwi-coder | kiwi-review-fix-loop | `--mini`/`--loops N` → follow-up |

## 7. 자연어 매핑

- `--mini`: "미니 모드", "빠른 모드", "quick", "3라운드"
- `--loops N`: "루프 N회", "N라운드", "N번 돌려", "loop count N"
