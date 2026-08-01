# kiwi wave-decomposition v1.0.0

wave 분해(wave splitting) · 설계 기준선(design baseline) 물질화 · 분해 커버리지 게이트의 **공용 계약** SSOT. `kiwi-wave-master` §3 · §3.1 · §3.2 에서 **텍스트를 이동**해 만들었으며, 본 문서를 참조하는 모든 스킬은 아래 규칙을 read-time 에 동일하게 적용한다.

본 계약 안의 `§n` 은 이 파일의 절을 가리킨다. 아래 이동된 본문이 `§0.G` · `§0.5` · `§4` · `§5.5` · `§5.6` 를 가리킬 때 그것은 **호출자의** 절이다 — 이동 전 문장을 그대로 옮겼기 때문이며, 호출자가 그 절들을 자기 본문에 갖는다.

---

## 1. 입력 파라미터 — `artifact_root` 는 하드코딩하지 않는다

| 파라미터 | 의미 |
|---|---|
| `artifact_root` | 아래 모든 아티팩트가 쓰이는 **루트 디렉터리**. **호출자가 인자로 전달하며 본 문서는 하드코딩하지 않는다** |
| `source_document` | 분해할 연구·계획·설계 문서 (경로) |
| `existing_modules_summary` | 기존 모듈과 그 의존 방향의 구조 요약 |
| `declared_constraints` | 사용자 프롬프트 · 대화 로그 · `--constraint` 인자에서 수집한 선언 제약 |

`artifact_root` 를 파라미터로 두는 것이 **하나의 기준선 구현이 두 호출자를 섬기게 하는 장치**다 — 호출자는 아래 둘이며 각자 자기 루트를 전달한다.

| 호출자 | 전달하는 `artifact_root` |
|---|---|
| `kiwi-wave-master` | `docs/analysis/kiwi-wave-master-{run_id}/` |
| `kiwi-orchestrator` | `docs/research/{work}/` |

아래 본문의 `{artifact_root}` 는 모두 이 인자로 치환한다. 본 문서에는 어느 호출자의 루트도 하드코딩되어 있지 않다.

---

## 2. Wave 분해 — kiwi-wave-master §3 에서 이동

입력 연구·계획 문서를 **순서(order)가 있는 여러 wave 로 분해(decompose)** 한다. 각 wave 는 순차(sequential)적으로 실행되는, 서로 정렬된(ordered) 작업 묶음이며 앞 wave 가 뒤 wave 의 토대가 된다.

**두 갈래 wave-split 휴리스틱**:

1. **헤더 우선(headers-first)**: 문서에 **명시적 wave 구조**(헤더·제목·섹션, document structure)가 있으면 그 헤더/섹션 경계를 그대로 wave 경계로 채택한다. 예: `## Phase 1`, `## 1단계`, 최상위 섹션 제목 등이 자연스러운 wave 경계다.
2. **그렇지 않으면(otherwise)**: 명시적 wave 구조가 **없으면**(when absent) **서브에이전트**가 문서의 **전체 흐름(overall flow)** 을 **분석(analyze)** 하여, 서로 응집된 3~8 개의 하위 목표(coherent sub-goals)로 wave 를 나눈다. 각 하위 목표가 하나의 wave 가 된다.

분해 결과는 순서가 확정된 `wave-1, wave-2, …, wave-N` 목록이며, 이 순서가 이후 target 등록·pipeline 실행 순서를 결정한다.

wave-split **서브에이전트**에는 **기존 모듈**과 그 **의존** 방향의 구조 요약을 함께 전달한다 — 기존 구조를 모르는 분해는 한 모듈을 여러 wave 가 동시에 건드리도록 잘라 교차 wave 회귀를 만든다. 각 wave 는 건드릴 것으로 예상되는 기존 모듈을 `existing_modules` 에 기록한다.

---

## 3. 설계 기준선(design baseline) 물질화 — kiwi-wave-master §3.1 에서 이동

분해 결과를 **설계 기준선(design baseline)** 으로 물질화한다. wave id 마다 그 wave 를 고정한 입력 문서의 `source_file` · `heading_path` · `line_start` · `line_end` 매핑을 만들고, 어느 wave 에도 배정하지 않은 최상위 섹션은 `out_of_scope` 에 `{ heading, reason }` 로, 그 wave 가 건드릴 것으로 예상되는 기존 모듈은 `existing_modules` 에 적는다.

`out_of_scope` 의 각 항목은 `{ heading, reason, exclusion_class }` 이며, `exclusion_class` 는 `already-implemented` / `superseded` / `external-ownership` / `user-excluded` / `non-normative` 다섯 값의 **closed** 목록이다 — 목록 밖의 값을 쓰지 않는다. 자유 텍스트 `reason` 한 줄로 분모를 줄이는 경로를 닫는다.

이 매핑을 `{artifact_root}design-baseline.json` 로 영속하고, 그 경로를 각 wave 의 **첫 `in_progress`** 이벤트의 `design_baseline` 필드에 실어 `waves.jsonl` 에 기록한다.

같은 시점에 그 wave 범위의 설계 항목을 `design_items` 로 **전량** 고정한다 — 각 항목은 `id` · `heading_path` · `line_start` · `line_end` · `statement` 를 갖는다.

항목 단위는 **최하위 헤딩 아래 규범 문장 1건 = 1 항목**이며, 예시·근거 문장은 **항목이 아니다** — 단위를 굵게 잡으면 `unmapped=0` 이 공짜가 된다.

어느 한 wave 의 scope 에도 속하지 않는 **통합 항목**은 같은 시점에 `integration_items` 로 전량 고정한다 — 각 항목은 `design_items` 와 같은 `id` · `heading_path` · `line_start` · `line_end` · `statement` 를 갖는다. 최종 패스(§5.6)의 분모가 여기서 나온다.

wave 별 설계 **본문 발췌**를 `{artifact_root}design-baseline/wave-{n}.md` 로 함께 물질화하고, 그 경로를 `design_baseline` 의 `excerpt_path` 에 기록한다 — 증거 번들과 저작 입력이 같은 아티팩트를 가리키게 한다.

사용자 제약은 판정하기 전에 **수집한다** — wave 분해 입력(사용자 프롬프트 · 대화 로그 · `--constraint` 인자)에서 선언된 **제약을 추출**해 호명 단위로 아티팩트에 적는다. 수집 단계가 없으면 배열은 언제나 비고, 그때 `constraint_layer.expected=0` 이라 어떤 판정도 실패시키지 못한다.

추출 단위는 선언된 **제약 문장 1건 = 1 항목**이며, 각 항목은 `id` · `statement` · `source` 를 갖는다 — `source` 는 그 제약이 선언된 위치(프롬프트 / 대화 / `--constraint`)다.

사용자 제약은 **제약이 없어도 빈 배열** 아티팩트를 반드시 만들어 그 경로를 `constraints_path` 에 **항상 기록**한다 — 빈 배열은 반증 가능한 주장이고, 필드 부재는 침묵이다.

**후발 제약** — 뒤 wave 실행 도중 새로 선언된 제약 — 은 앞선 아티팩트를 제자리에서 고치지 않고 새 아티팩트로 쓰고, 그 경로를 실은 `in_progress` 이벤트를 1줄 append 하며, 해소는 언제나 **최신** `constraints_path` 를 읽는다 — append-only 저널에서 제자리 수정은 앞 라운드가 무엇을 근거로 판정했는지를 사후에 바꾼다.

이월(carry-forward)로 신설된 wave 는 입력 문서의 어느 구간에도 대응하지 않으므로, 설계 기준선 대신 **이월 finding 목록**을 그 wave 의 설계 계층 분모로 삼는다 — **이월 finding 1건 = `design_items` 1 항목**으로 변환하며(`id` 는 그 finding id, `statement` 는 그 finding 요약, `heading_path` 는 `carried-forward`, 줄 좌표는 `0`), 그 목록을 markdown 으로 물질화해 `excerpt_path` 에 기록한다. 변환하지 않으면 §5.5.2 의 `design_layer.expected` 규칙과 §4 의 발췌 전달 의무가 이 wave 에서 동시에 성립 불가능해진다.

설계 기준선 아티팩트는 `waves.jsonl` 만으로 해소한다. 해소는 대화 상태에 의존하지 않는다 — 재개 세션에는 분해 대화가 남아 있지 않으므로, 저널의 `design_baseline.path` 하나로 도달하지 못하면 §5.5 의 설계 계층 분모가 통째로 사라진다.

---

## 4. 분해 커버리지 게이트 — kiwi-wave-master §3.2 에서 이동

설계 기준선 매핑을 입력의 **모든** 최상위 섹션 집합과 대조한다. 어느 wave 에도 배정되지 않은 미배정 섹션을 **전량** 보고한다 — 상위 N 건만 보고하면 남은 갭이 이미 덮인 것으로 읽힌다.

**대조 단위**는 최상위 섹션 **한 겹이 아니라** §3.1 이 고정한 `design_items` **전량**이다 — 하위 절에만 있는 미배정 설계는 최상위 대조를 그대로 통과한다.

미배정 섹션이 남아 있고 그에 대한 out-of-scope 사유가 기록되지 않았으면 §4 target 등록에 **진입하지 않는다**.

out-of-scope 는 판단이 아니라 기록이다 — 사유는 설계 기준선의 `out_of_scope` 에 `{ heading, reason }` 로 남기며, 기록되지 않은 배제는 커버리지 갭과 구분되지 않는다(§0.G `wave-decomposition-coverage-gap`, §0.5 예외).

기록만으로는 부족하다 — `out_of_scope` 에 항목이 하나라도 있으면 §0.G `out-of-scope-user-consent` 로 **`--auto` 라도 중단**하고 사용자 확인을 받는다. 배제는 그 항목을 REQ·설계·제약·보존 어느 분모에도 넣지 않으므로, run 전체에서 한 번도 검증되지 않는 유일한 경로다.
