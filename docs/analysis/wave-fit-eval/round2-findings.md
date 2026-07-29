# 라운드 2 평가 통합 findings

라운드 1 결과를 **주지 않은** 신규 평가자 3기가 현재 저장소 소스를 읽고 산출. 라운드 1 문서는 `docs/research/14.kiwi-wave-master-user-requirement-fit-evaluation.md`.

줄번호는 `skills/claude/**` 기준이며, 별도 표기가 없으면 3사본 모두에 동일하게 존재한다.

---

## CRITICAL

### C1 — `waves.jsonl` 재개·완료 판정이 `run_id` 로 스코프되지 않는다
- 근거: `_shared/kiwi/waves-event.md:121` "각 wave 의 마지막(latest) 이벤트 status 를 계산한다"(필터는 `wave="all"` 제외 하나뿐) · `:123` 전체 완료 술어 · 대조 `:113` 검증 게이트는 "**같은 run 안에**", `:130` 버전 면제도 "**run 단위**" · `:36-37` `wave` 값은 `wave-{n}` 으로 run 간 고유하지 않음 · `:15` 파일은 저장소당 1개 append-only · `kiwi-wave-master/SKILL.md:356`
- 문제: 에픽 A 를 wave-1~5 로 완주한 저장소에서 에픽 B 를 시작하면, B 의 `wave-1` 이 A 의 `wave-1 complete` 를 자기 상태로 읽고 최신 `final-verify` 도 A 의 `pass` 를 읽어 **구현 0건으로 "전체 완료"** 를 보고한다. `--auto` + 사용자 부재에서 조용히 성립하며, 스킬을 두 번째로 쓰는 순간부터 항상 발생한다.
- 제안: §4 첫 문장을 "현재 run 의 `run_id` 와 일치하는 이벤트만으로 계산한다" 로 고정하고, 재개 대상 run_id 선택 규칙(가장 최근 미완료 run / 명시 인자)을 §4 에 규정. `kiwi-wave-master §6` 도 동일 문구로.

### C2 — `preservation_layer` 가 어떤 종료 조건에도 결선되어 있지 않다
- 근거: `kiwi-wave-master/SKILL.md:244-246`(분모·verdict enum 규정) · `:270` §5.5.4 PASS 조건에 `preservation_layer` **부재** · `_shared/kiwi/waves-event.md:71` 스키마는 정의하나 `:79-83` 강제 규칙 목록에 `unapproved-damage` 규칙 없음 · 대조 `:79` 설계 계층은 `unmapped ≥1 → ALL_MATCH 금지`, `:81` `regression.exit_code ≠ 0 → pass 금지`
- 문제: 축 C 의 핵심 장치가 **기록 전용**이다. 검증자 2 가 "기존 public API 3개 삭제 = `unapproved-damage`" 를 정직하게 기록해도 PASS 조건은 충족되고 `complete` 가 append 된다. `complete` 는 취소 불가라 파손이 영구 확정된다. §5.6 도 §5.5 를 재사용하므로 같은 구멍을 물려받는다.
- 제안: §5.5.4 PASS 조건에 `unapproved-damage` 0건을 추가하고, `waves-event.md` §2.3 에 `design_layer.unmapped` 와 **동일 형식**으로 명문화. §5.6 에도 적용 명시.

### C3 — 설계 계층의 분모 단위("설계 항목")가 정의되지 않았다
- 근거: `kiwi-wave-master/SKILL.md:240` "모든 설계 항목을 행으로 열거" · `:151` 설계 기준선이 물질화하는 것은 좌표 매핑뿐(**항목 열거 없음**) · `waves-event.md:88-96` §2.4 에 항목 배열 없음, `:70` `design_layer{expected,mapped,unmapped}` · 대조 `:238` REQ/AC 분모는 `list_requirements` 로 외부 고정, `:244` 검증자 2 분모는 diff 에서 기계 도출 · `:248`/`waves-event.md:82` 행 수 무효 규칙이 **존재하지 않는 고정 분모**를 전제
- 문제: `design_layer.expected` 를 매 라운드 새 검증자가 스스로 산정한다. 라운드마다 21개/6개로 갈려도 무효 판정이 걸리지 않고, `unmapped=0` 을 만드는 최단 경로가 "항목을 굵게 잡기"인데 막는 장치가 없다. §5.5.2 가 다른 두 계층에 대해 세운 원칙(`:250`)이 정작 설계 계층에서 지켜지지 않는다.
- 제안: §3.1 물질화 시점에 `design_items: [{ id, heading_path, line_start, line_end, statement }]` 를 고정하고 단위 규칙을 본문에 명시(예: 최하위 헤딩 아래 규범 문장 1건 = 1 항목, 예시·근거 문장 제외). `design_layer.expected` = 그 wave 의 `design_items` 길이로 외부 고정. §5.6 의 `expected` 도 동일 방식.

---

## HIGH

### H1 — `--auto` 단독으로는 kiwi-coder 두 게이트를 통과할 수 없다
- 근거: `kiwi-coder/SKILL.md:113` `integration-test-user-consent` · `:114` `cost-warning-large-task` · `:119` "`--auto` 활성이어도 3종은 명시 입력 시에만" · `kiwi-pm/SKILL.md:133-134` "명시 입력만 pass-through" · `kiwi-wave-master/SKILL.md:390` pass-through 는 사용자가 타이핑해야 존재 · `:65-71` §1.2 자연어 매핑 표에 두 옵션 **행 없음** · 그럼에도 `:368` §7.1 은 "사용자 개입 없이 끝까지" 를 약속
- 문제: 전파 **경로**는 있는데 **값**이 없다. ≥10분 Task·통합 테스트는 실제 코딩 wave 에서 기본값에 가까워 첫 wave 에서 멈춘다. 이 중단은 `§0.G` 표에도 없어 예측 불가.
- 제안: (a) §7.4 를 "wave-master 의 `--auto` 가 두 옵션을 자식 체인에 **부여**한다" 로 하고 위험을 §7.1 에 명시, 또는 (b) §1.2 에 두 행을 추가하고 §7.1 의 약속 문장을 정정. 어느 쪽이든 두 gate_id 를 `§0.G` 에 등재.

### H2 — 개선 루프 재진입이 자식 인터페이스와 멱등 emit 때문에 실질적으로 작동하지 않는다
- 근거: `kiwi-wave-master/SKILL.md:296` 재진입은 "미해소 요구사항 필터 + `plan_run_id` 재사용 여부" 전달 요구 · `kiwi-pipeline/SKILL.md:61-74` §1.2 옵션 표에 **REQ 필터도 plan_run_id 인자도 없음**, `:322-325` 자식 인계 인자는 `--auto`/`--model`/`--close-reqs` 뿐 · `kiwi-planner/SKILL.md:191` run-id = `{날짜}.{project}.{target}` → 같은 날 재실행은 **동일** · `:937`·`kiwi-pm/SKILL.md:1203` "동일 run_id 이벤트 존재 시 skip" · `kiwi-pm/SKILL.md:177` 세션 디렉터리도 재사용 · `kiwi-pipeline/SKILL.md:112` 사이클은 `TASK_DONE` **이벤트를 게이트로** 다음 단계 spawn
- 문제: ① "명시 범위" 가 표현 불가능해 재진입이 계획 전체를 다시 돈다 ② 같은 날 재진입이면 emit 이 멱등 skip 되어 체인이 볼 새 `TASK_DONE` 이 없다 ③ plan/세션이 덮이는데 pm-state 의 Task 가 전부 `done` 이라 **아무 Task 도 실행하지 않고** TASK_DONE 을 낼 수 있다.
- 제안: `kiwi-pipeline §1.2`/§7 에 `--req-filter` 와 `--plan-run-id` 신설, 재진입 시 emit 멱등 키를 `{run_id}#r{n}` 으로 규정. 불가하면 §5.5.5 문구를 기계에 맞게 정정.

### H3 — §4 의 직접 `/kiwi-srs` 중단이 `§0.G` 어느 게이트에도 매핑되지 않았다
- 근거: `kiwi-wave-master/SKILL.md:38` `child-pipeline-needs-user-or-failed` 는 pipeline 한정 · `:21` §0.4 도 동일 한정 · `:169-179` §4 는 wave-master 가 kiwi-srs 를 **직접** 호출(사이클은 `--from=feasibility` 라 kiwi-srs 를 spawn 하지 않음) · `kiwi-srs/SKILL.md:102-110` kiwi-srs 자신은 7종 critical gate 보유 · `:289` §5.5.5 증분 저작 재진입도 같은 구멍 · `:47` 스킬이 스스로 "일부만 선언하면 나머지가 위원회 판단으로 떨어진다" 고 밝힘
- 제안: `§0.G` 에 `child-srs-needs-user-or-failed`(발생 위치 §4 / §5.5.5) 추가, §0.4 문구를 "`/kiwi-srs` 또는 `/kiwi-pipeline`" 으로 확장, "여덟 건" 문구 갱신.

### H4 — §5.6 최종 검증에 수정 라우팅이 없고 §5.5.7 이 자기모순이다
- 근거: `kiwi-wave-master/SKILL.md:342` §5.6 이 재사용한다고 밝힌 것은 4가지뿐(개선 위임 **미포함**) · `:281-290` §5.5.5 전 행이 "**그 wave** 의" 기준인데 run-scope 에는 그 wave 가 없음 · `:288` 최종 시점엔 모든 wave 가 complete 라 요구사항 수준 finding 이 전부 cross-wave HALT 행에 걸림 · **모순**: `:326` "요구사항을 바꿔야 하는 finding 은 HALT" (무조건) vs `:332` "HALT 는 양쪽 carry-forward 가 모두 불가능할 때만, 첫 대응이 아니다" — `§0.G:40` reason 은 후자를 채택 · `:328` 코드 finding 에는 "새 wave 추가" 경로가 있는데 요구사항 finding 에는 없음 · `:340` 최종 분모의 통합 항목은 정의상 어느 wave 요구사항도 아님
- 문제: §5.6 이 존재하는 이유(통합 항목 포착)와 라우팅(모든 수정이 wave 로 귀속)이 맞물리지 않아, **찾고도 고치지 못하고** HALT 만 남는다.
- 제안: `:326` 을 `:332`·`§0.G:40` 에 맞춰 통일하고, §5.6 에 전용 라우팅 절을 신설해 run-scope finding 을 "§0.5 예외로 wave-N+1 추가 → §4~§5.5 정상 실행 → §5.6 재실행" 으로 명시. `waves-event.md:123-126` 재개 술어가 자동으로 재진입을 만든다는 점도 함께 적는다. §5.5.4 의 "wave head 회귀" 는 최종 패스에서 "run head 회귀" 로 읽는다고 명시.

### H5 — wave head 회귀 `exit_code=0` 절대 요구가 kiwi-coder 기준선-델타 규약과 충돌
- 근거: `kiwi-wave-master/SKILL.md:270` PASS 에 `exit_code=0` 무조건 요구 · `waves-event.md:81` 동일 · 반면 `kiwi-coder/SKILL.md:285` 기준선이 회귀 판정의 분모, `:300` "기준선의 `exit_code ≠ 0` 자체는 차단 사유가 아니다", `:482` 기존 실패는 현재 Task 에 귀속하지 않음 · 탈출구 부재 `kiwi-wave-master/SKILL.md:132`/`:43` `--skip-regression` 은 `unsafe-option-refused` 로 거부
- 문제: 사전에 red 인 테스트가 1건이라도 있는 기존 코드베이스에서 **어떤 wave 도 `complete` 에 도달하지 못한다**. 하위 계층이 명시적으로 허용한 상태를 상위 계층이 하드 블록하며 조정 조항이 없다. brownfield 에서 "멈추지 않고 끝까지" 가 가장 먼저 깨지는 지점.
- 제안: wave 계층에도 기준선-델타 도입. `waves-event.md` §2.3 `regression` 에 `baseline_failing_tests[]` 를 추가하고 통과 조건을 "`failing_tests ⊆ baseline_failing_tests`(신규 실패 0건)" 로 변경. 기준선은 §2.1 preflight 에서 1회 캡처해 run 전체에 pin 하고 `kiwi-coder state.regression_baseline` 과 SSOT 를 묶는다. 캡처 실패 시에만 현행 `exit_code=0` 으로 격하.

### H6 — `existing-test-weakened-or-deleted` 가 kiwi-pm `critical_gates[]` 에 없다
- 근거: `kiwi-coder/SKILL.md:116` 은 critical 로 선언 · `kiwi-pm/SKILL.md:85-99` 표에 `existing-public-contract-change`(:89) 는 있으나 해당 게이트 **없음**, `:661-667` always-HALT 목록에도 없음 · `auto-option.md:190` "critical_gates 에 없으면 `business-decision` 기본 분류" · `kiwi-pm/SKILL.md:722-731` business-decision 은 confidence ≥0.7 이면 자동 채택 · 상위도 못 막음 — `kiwi-pipeline §0.AG`·`kiwi-wave-master:38` 은 자식이 `NEEDS_USER` 를 **반환할 때만** 멈추는데 pm 이 자동 결정하면 반환 자체가 없음 · codex/etc 동일(`codex/kiwi-pm:100`, `etc/kiwi-pm:93`)
- 문제: `--auto` 에서 **기존 테스트 삭제·약화만 위원회가 승인해 통과시킬 수 있는 경로**가 열려 있다. 회귀 안전망 자체를 제거하는 변경이라 가장 비가역적이다.
- 제안: §0.G7 표와 always-HALT 목록에 추가(3사본).

### H7 — 교차 wave 이월(carry-forward)에 수신 경로가 없다
- 근거: `kiwi-wave-master/SKILL.md:328` 이월이 주 경로, `:330` 기록은 `residual.cross_wave`/`carried_into`, `:332` "HALT 는 첫 대응이 아니다" · 그러나 `:169-179` §4 의 kiwi-srs 입력과 `:185-193` §5 의 pipeline 인자 어디에도 `carried_into` 를 읽으라는 규정 없음 · `waves-event.md:73/78` 도 기록 필드로만 정의
- 문제: 주 대응 경로가 **소비자 없는 기록**으로 끝난다. 이월된 결함은 다음 wave 의 분모(그 wave target 의 REQ/AC)에도 없어 재검출되지 않고 조용히 종결된다. 부수 문제: 신설 이월 wave 는 입력 문서의 어느 섹션에도 대응하지 않아 §3.1 의 좌표를 만들 수 없고 §5.5.1 필수 행·§5.5.2 설계 분모가 정의 불능이 된다.
- 제안: §4/§5 에 "wave 진입 시 `carried_into == 이 wave` 인 residual 을 전량 수집해 증분 저작 입력과 재진입 범위에 포함" 을 추가. 신설 이월 wave 는 설계 기준선 대신 "이월 finding 목록" 을 설계 계층 분모로 대체 허용.

### H8 — 설계 **본문**이 저작 입력에 도달하지 않는다
- 근거: `kiwi-wave-master/SKILL.md:175` `/kiwi-srs` 에 `design_baseline.path` 를 리서치 문서로 전달 · `:151`·`waves-event.md:88-96` 그 path 가 가리키는 것은 **좌표 매핑 JSON** · `kiwi-srs/SKILL.md:577` 프로세스 A 는 "리서치에는 있으나 SRS 에 누락된 요구사항" 을 도출 — 대조할 산문이 필요 · 비대칭: `:218` 검증 번들에는 **본문 구간**이 들어감
- 문제: 저작은 포인터만 보고 검증은 본문을 본다. 설계 계층 갭이 wave 마다 **구조적으로** 발생하도록 배선되어 있고, `:289` 증분 저작 재진입이 예외가 아니라 상시 경로가 되어 라운드 상한을 잠식한다(`--mini` 에서는 즉시 `fail-cap`).
- 제안: §3.1 에서 wave 별 설계 본문 발췌를 함께 물질화하고(`design-baseline/wave-{n}.md`), §4 는 그 markdown 을 `--research-doc` 로 전달. `design_baseline` 에 `excerpt_path` 를 기록해 증거 번들과 같은 아티팩트를 가리키게 한다. (`kiwi-srs` 는 `--research-doc` 반복 지정 가능이므로 원본 `source_file` 을 함께 넘기는 방식도 가능하다.)

### H9 — `srs_authored` 판정이 "최신 이벤트" 라 wave-verify 중단 후 재개하면 SRS 를 두 번 저작한다
- 근거: `kiwi-wave-master/SKILL.md:179` "그 wave 의 **최신 이벤트**가 `srs_authored`=true 를 싣고 있으면 … 표식 없는 줄은 저작 진행 중으로 읽는다" · `waves-event.md:58` 은 "`srs_authored`=true 인 `phase="srs-authoring"` **기록**" 으로 최신 여부를 요구하지 않음 · `:306` wave-verify 이벤트는 라운드마다 append 되며 `srs_authored` 를 싣지 않음 · `:360` 재개 단위 3단계 규약
- 문제: 검증 루프 중 죽으면 최신 이벤트가 wave-verify 라 "저작 진행 중" 으로 읽혀 `/kiwi-srs` 를 다시 돌린다 — `:179` 자신이 막겠다고 선언한 중복 저작이 정확히 발생하고, `:360` 및 `waves-event.md:58` 과도 모순된다.
- 제안: `:179` 를 "그 wave 의 이벤트 중 `srs_authored`=true 인 줄이 **하나라도** 있으면" 으로 고치고, "표식 없는 줄" 문장을 `srs-authoring` phase 로 한정.

### H10 — 사용자 제약에 수집 단계·분모·게이트가 없고 필수 증거 행과 선택 필드가 모순
- 근거: `kiwi-wave-master/SKILL.md:153` "제약이 **있으면**" 조건부 기록(수집·질의 단계 없음) · `:65-71` §1.2 표에 제약 항목 없음 · `:219`+`:222` 번들의 제약 행은 "**필수**이며 생략 불가" · `waves-event.md:53` `constraints_path` 는 **선택** 필드 · `waves-event.md:64-84`·`SKILL.md:238-246` 어디에도 제약 계층 없음 · `:175` §4 는 `constraints_path` 를 전달하지 않음
- 문제: (a) 필수 행의 소스가 선택 필드라 제약 미선언 run 에서 해소 불가능(문서 내부 모순) (b) 제약을 위반해도 어느 롤업도 실패하지 않음 (c) 수집 시점이 없어 wave-3 중 나온 제약이 편입될 경로 없음 (d) 저작 입력에도 없어 검증에서 잡혀도 반영 근거가 없음
- 제안: Phase 1 에 제약 수집 단계를 명시하고 **제약이 없어도 빈 배열 아티팩트를 반드시 생성**해 `constraints_path` 를 항상 기록(빈 배열은 반증 가능한 주장 — `waves-event.md:76` `residual` 논리와 동형). `verification` 에 `constraint_layer{expected,checked,violations}` 추가 + "violations ≥1 이면 `ALL_MATCH` 금지". §4 에서 제약 아티팩트도 kiwi-srs 에 전달. 후발 제약은 새 `in_progress` 로 append 하고 해소는 "**최신** `constraints_path`".

---

## MEDIUM

| ID | finding | 근거 |
|---|---|---|
| M1 | wave 의 diff base/head 가 저널에 없어 보존 계층·교차 wave 판정·fixer 범위가 재개 후 재구성 불가 | `SKILL.md:218`·`:244`·`:285`·`:324` 가 전부 diff 를 전제하나 `waves-event.md:31-58` 에 base/head SHA 필드 없음. `:224` 의 창 경계는 jsonl 필터 키이지 git ref 가 아님. 대조: `:155` 는 설계 기준선에 "대화 상태 비의존" 을 명시적으로 요구 |
| M2 | "기존 public 심볼"·"기존"·"약화" 의 판정 기준 미정의 | `kiwi-coder/SKILL.md:44`·`:116-117`·`:406-409` 가 지시만 함. 대조: 차단력 0 인 `@req` 태그에는 `:35`·`:37`·`:39` 정규식 3종 제공 |
| M3 | `kiwi-review-fix-loop` 에 보존 규약·탐지 게이트가 전무 | `kiwi-wave-master/SKILL.md:292` 가 금지를 선언하나 `kiwi-review-fix-loop/SKILL.md:21-38`·`:136-145` 에 해당 규약·gate_id 없음(codex/etc 동일). 이 스킬은 **kiwi-coder 를 거치지 않는 유일한 코드 변경 경로**. 또한 `:292` 의 근거가 `kiwi-tdd §0.5` 인데 `:130` 이 tdd 라우팅을 wave 사이클에서 배제했으므로 근거를 `kiwi-coder §0.20` 으로 교정해야 함 |
| M4 | 증거 창이 단일 `pipeline_run_id` 인데 재진입은 새 run 을 만든다 | `SKILL.md:224`·`:358`·`:286`·`:289`, `kiwi-pipeline/SKILL.md:399` "매 호출 새 run_id", `:228` 글롭 금지. 결과: 수정 전 증거로 재검증(영구 finding) 또는 낡은 clean 증거로 PASS |
| M5 | 분모 freeze 시점이 없어 개선할수록 무효 라운드가 늘고 cap 이 소진된다 | `SKILL.md:238`·`:248`·`waves-event.md:82` 무효 규칙 vs `:289` 증분 저작이 분모를 늘림, `:244` diff 분모도 수정으로 변함 |
| M6 | 재개 시 카운터는 누적·스트릭은 리셋이라 cap 근처 재개는 PASS 가 산술적으로 불가능 | `waves-event.md:132`, `SKILL.md:271`·`:275`, `etc:276`(3연속)·`etc:281`(Normal 조기종료 없음) |
| M7 | 크래시 재개 시 `pm.lock` 이 남아 pipeline 재개가 막히는데 `--force` 전파 경로 없음 | `kiwi-pm/SKILL.md:292`·`:294`·`:161`·`:302`, `kiwi-wave-master/SKILL.md:388-395` |
| M8 | `--max` 가 §4 per-wave `/kiwi-srs` 로 전파되지 않는다 | `SKILL.md:378` 은 "사이클이 spawn 하는" 대상만 열거하는데 `:189` 로 사이클은 kiwi-srs 를 spawn 하지 않음. 대조 `:384` `--mini`/`--loops` 는 §4 직접 호출을 포함 |
| M9 | 변형 간 `critical_gates[]` 집합·gate_id 불일치 | `claude/kiwi-planner:210-213` vs `codex/kiwi-planner:165-168` 4개 id 전부 상이 · `codex/kiwi-coder:117-119` 에만 있는 3종, `claude/kiwi-coder:107-112` 에만 있는 5종 · `auto-option.md:252`·`:356` 은 gate_id 를 인터페이스 키로 사용. 결과: 같은 wave 가 codex 에서는 멈추고 claude 에서는 계속됨 |
| M10 | 분해 커버리지 게이트가 최상위 섹션 한 겹만 본다 | `SKILL.md:159`·`:151`·`:161`. 하위 절의 미배정 설계는 통과하며, 이를 잡을 설계 계층은 C3 때문에 기계적이지 않다 |
| M11 | 첫 `in_progress` 의 `phase="pipeline"` 라벨이 실제 단계(저작)와 어긋난다 | `SKILL.md:310`·`:358` vs `:169`(§4 가 §5 보다 앞)·`:360`. `waves-event.md:50` enum 에 `srs-authoring` 이 이미 있음 |
| M12 | run-scope `final-verify` `complete` 가 waves-event §3 게이트와 충돌 | `waves-event.md:113` 문언상 `wave="all"` 에는 wave-verify 기록이 원리적으로 없어 항상 무효. §4(`:121-126`)만 예외를 명시 |
| M13 | `existing_modules` 가 write-only — 아키텍처 수준 장치에 소비자가 없다 | `SKILL.md:147`·`:151`, `waves-event.md:96`. 읽는 절이 없고 §5.5.1 번들에도 없음 |
| M14 | 모듈 삭제·이동이 kiwi-coder 게이트의 탐지 대상이 아니다 | `kiwi-coder/SKILL.md:401-410` 5항목에 비-테스트 파일 삭제·이동 없음. sidecar.files[] 에 있으면 통과. `kiwi-planner` 가 `file_op` Task 를 1급 지원하므로 실제 발생 경로 |
| M15 | `kiwi-review-fix-loop` 회귀 판정에 기준선 개념이 없다 | `kiwi-review-fix-loop/SKILL.md:464-469`·`:115` vs `kiwi-coder/SKILL.md:285`·`:299-300`·`:480-484`. 같은 파이프라인에서 coder 는 관용하고 review-fix-loop 은 차단하는 비대칭 |
| M16 | "개선" vs "훼손" 판정 근거 규칙이 없다 | `SKILL.md:246` 은 enum 만 규정. 분모는 고정했으나 verdict 는 전적으로 재량이며, `:260` 이 자인한 "wave 를 끝내려는 국소 이해" 가 그대로 적용됨 |

---

## LOW

| ID | finding | 근거 |
|---|---|---|
| L1 | `--cycle` 체인의 종료 지점이 Table T1 과 어긋나 마지막 홉이 미정의 | `kiwi-pipeline/SKILL.md:116` vs `:251`(후보 2개) · `:288` 이 모호성 게이트를 배제해 사용자에게 올라가지도 않음. 후자면 wave 마다 자동 push 라는 외부 부작용 발생 |
| L2 | §1.1 "분해할 대상 문서를 묻는다" 가 미선언 게이트라 위원회 결정 대상 | `SKILL.md:61`, `auto-option.md:281` |
| L3 | `§0.G` 설명문의 "앞의 세 건" 이 표와 어긋난다 | `SKILL.md:47` vs §2.1 유래 게이트는 1·2·8행에 분산 |
| L4 | `final-verify` 가 통과하지 못한 경우의 `status` 미정의 | `waves-event.md:115`·`:153`, `SKILL.md:346` |

---

## 착지 시점 필수 후속 (잊으면 SRS 가 거짓이 된다)

1. **`FR-FLOW-054 AC-6` 개정** — 현행 AC-6 은 "§5.5.4 가 `exit_code=0` 을 Normal PASS 조건으로 만든다" 이며 **라운드 1 구현과 일치하므로 현재는 참**이다. `FR-FLOW-057`(H5)의 기준선-델타 수정이 착지하는 순간 거짓이 되므로, **그 수정을 적용하는 시점에** AC-6 을 "신규 실패 0건(`failing_tests ⊆ baseline_failing_tests`)" 형태로 개정하고 Change Note 에 `FR-FLOW-057` 이 이 AC 를 대체함을 기록한다. 개정 전까지 AC-6 은 체크 상태를 유지한다.
2. **`.agents` 미러 재생성** — `kiwi-coder`/`kiwi-pipeline`/`kiwi-srs`/`kiwi-pm`/`kiwi-review-fix-loop`/`kiwi-planner` 중 변경된 것에 대해 `node bin/speckiwi --root . skills install codex <skill>` 을 돌린 뒤, **반드시** `.agents/skills/_shared/kiwi/waves-event.md` 가 삭제되지 않았는지 확인하고 삭제되었으면 `skills/codex/_shared/kiwi/waves-event.md` 에서 CRLF 로 복원한다(도구 결함, 3회 재현).
3. **`FR-FLOW-046 AC-1` 재개정** — R2 가 선택 필드 6종을 추가해 waves-event 가 `1.2.0 → 1.3.0` 으로 다시 올라간다. 1.1.0·1.2.0 모두 커밋·배포된 적이 없어 소비자가 관측한 버전은 없으므로, AC-1 의 리터럴을 `1.3.0` 으로 갱신하고 "단일 bump 가 1.0.0 에서 이 버전까지의 모든 추가를 덮는다" 는 기존 서술을 유지한다. 리터럴 고정·additive-only·status enum 불변이라는 **강도는 낮추지 않는다**.
4. **테스트 스코프 정규식 정정** — `kiwi-wave-continuity-r2-content.test.ts` 의 "자식 인자 인계" 단언이 쓰는 절 스코프 정규식 `^#{2,3}\s*(?:§?6|6)\..*(?:spawn|인계|호출)` 이 의도한 절이 아니라 `### 6.5 자기 호출 충돌` 에 먼저 매치했다. 그 결과 구현자가 테스트를 통과시키려고 **절 제목을 개명**했다(`자기 재귀 진입 충돌 (§0.5)`). 개명 자체는 gate id `self-recursive-spawn` 과 더 정합하므로 유지하되, **테스트가 산출물 내용을 끌고 간 것**이 근본 문제다. 정규식을 의도한 절만 집도록 좁혀라(스코프를 넓히는 방향은 금지 — 단언이 약해진다).
