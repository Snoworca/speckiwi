# 라운드 3 평가 통합 findings

라운드 1·2 결과를 **주지 않은** 신규 평가자 3기 산출. 앞 라운드: `docs/research/14.*.md`(R1), `docs/analysis/wave-fit-eval/round2-findings.md`(R2).

**심각도 추이: CRITICAL 3 → 3 → 0.** 세 평가자 모두 "골격은 기계적으로 서 있고 결함이 계층 **경계**로 밀려났다"로 진단이 수렴했다. 변형 3사본의 규범 불일치는 이번 라운드에서 **0건**이다(`waves-event.md` 는 3사본 바이트 동일).

줄번호는 `skills/claude/**` 기준. `WM`=kiwi-wave-master/SKILL.md, `WE`=_shared/kiwi/waves-event.md, `CO`=kiwi-coder/SKILL.md, `RFL`=kiwi-review-fix-loop/SKILL.md, `PM`=kiwi-pm/SKILL.md, `PL`=kiwi-planner/SKILL.md, `PIPE`=kiwi-pipeline/SKILL.md.

---

## HIGH

### H1 — 실행 계층에 증거 기반 해소 경로가 없어, 계획된 아키텍처 개선이 `--auto` 로 우회 불가한 HALT 를 유발한다
- 근거: `CO:119-121`(보존 3게이트가 `critical_gates[]`, "결정 서브에이전트로 우회 금지" `CO:103-105`) · `CO:121` "`sidecar.files[]` 에 등재되어 있다는 사실만으로는 해소되지 않는다" · `CO:120` "**경로와 무관**하게 critical" · `PM:86-87` 버블업 후 pm 에서도 critical · `WM:40` 로 오케스트레이션 전체 중단 · **대조** `WM:283-287` wave 검증의 `preservation_layer` 는 REQ/Task 근거가 있으면 `intended-improvement`
- 문제: 동일 행위에 대해 **검증 계층에는 증거 기반 허용 경로가 있는데 실행 계층에는 없다.** 계획서·SRS·Task 로 승인된 리팩터도 coder 가 무조건 HALT 하므로, "설계만 있으면 기존 아키텍처를 개선하며 완주" 는 **파일을 추가만 하는 설계에서만** 성립한다.
- 제안: `CO §0.G6` 세 보존 게이트에 `WM §5.5.2` 와 **같은 해소 규칙**을 명문화 — 그 변경을 요구하는 REQ-ID/Task-ID 가 sidecar 에 있고 `action` 이 이동·삭제·시그니처 변경을 명시하면 critical 이 아니라 `intended-improvement` 로 기록하고 진행. 두 계층의 판정 규칙은 한 문장을 공유해야 한다.

### H2 — `CO` 안에서 보존 게이트 처리가 두 갈래로 갈리고, `PM` 이 전제하는 "버블업" 경로가 정의되어 있지 않다
- 근거: `CO:412-418` §5.1.(d) "검출 시 CRITICAL + (c) 재호출로 **재구현 강제**" vs `CO:119-121` 같은 세 id 가 `critical_gates[]`(= `--auto` 무관 HALT, `auto-option.md:188`) · `PM:89-90` reason 이 "자식 kiwi-coder 가 **버블업**" 인데 `CO` 전문에 "버블업" 0건, `CO:855` 상태 매핑에 gate_id 전달 채널 없음 · codex/etc 동일
- 문제: 같은 사건에 배타적 처리 두 개가 동시에 규정된다. §5.1.(d) 읽기면 게이트가 영원히 발화하지 않고, §0.G6 읽기면 재구현 경로가 죽는다. 전자면 파손은 `improvement-loop-divergence-4opt`(루프 발산)로만 올라와 `PM:89-90` 의 보호가 이름만 남는다.
- 제안: `CO §5.1.(d)` 에 "1차 검출은 (c) 재호출로 자기 치유하되 **동일 항목 2회째 검출 시** 치유를 중단하고 §0.G6 gate_id 로 부모에 HALT 를 버블업" 을 명시하고, `CO:855` 상태 매핑의 `NEEDS_USER` payload 에 `gate_id` 필드를 추가. 3사본 동기화.

### H3 — `diff_window` · `pipeline_run_ids` 는 소비 규정만 있고 **생산 규정이 없다**
- 근거: `WM:251`(필수 행, "대화 상태가 아니라 `waves.jsonl` 에서 해소한다") · `WM:253,257`(창 경계) · `WM:281`(검증자 2 분모) — 전부 소비측. `grep diff_window|pipeline_run_ids|base_sha|head_sha` 결과가 이 세 줄뿐 · `WM:423` §6 은 `pipeline_run_id`(단수) 기록만 의무화 · `WE:55-56` 은 선택 필드로만 정의하고 생산 시점 규정은 §5 의 **예시**(170-176)뿐 — 예시는 규범이 아니다
- 문제: 재개 세션에는 분해 대화가 없다(`WM:177` 이 스스로 세운 원칙). 두 값의 캡처 시점·주체가 없어 `preservation_layer` 분모가 성립하지 않고, `unapproved-damage` 0건이 PASS 조건(`WM:317`)이므로 **검증 자체가 재개 후 실행 불가능**해진다.
- 제안: §3.1 또는 §5.5.6 에 "wave 진입 시 `base_sha`, wave-verify 라운드 진입 시 `head_sha` 를 캡처해 그 이벤트의 `diff_window` 에 싣는다", "pipeline spawn 마다 그 run_id 를 `pipeline_run_ids` 에 append" 를 **의무 문장**으로 추가. `WE §2.2` 에서 두 필드를 wave-verify/complete 이벤트 사실상 필수로 승격.

### H4 — 재진입 emit 키 `{run_id}#r{n}` 이 `PIPE` 에만 있고 자식 본문은 "동일 run_id skip" 을 유지 — 재진입이 `TASK_DONE` 을 남기지 못한다
- 근거: `PIPE:365,367`(자식에도 적용한다고 선언) vs `PL:939`·`PM:1206` "동일 `run_id` 이벤트가 이미 존재하면 skip"(접미사 미언급) · `pipeline-event.md:135-138` SSOT 도 접미사를 모름 · `PM:33` run_id 정규식 `[a-z0-9.-]{4,40}` 은 `#` 불허, `PM:49,1075` 위반 시 거부/HALT
- 문제: (1) 자식이 재진입 emit 을 skip → 체인이 볼 새 `TASK_DONE` 이 없다 (2) 규약을 따르면 `#` 가 자식의 id 정규식 게이트에 걸린다 (3) 자식 emit skip 시 `pipeline.jsonl` 에 `kiwi-pipeline` 이벤트가 연속 2건이 되어 `PIPE:312` 자기재귀 ERROR 가 다음 wave 진입에서 발동한다.
- 제안: 접미사 규약을 `_shared/kiwi/pipeline-event.md` 로 올려 3 스킬이 같은 문장을 읽게 하고, sidecar run_id 정규식과 이벤트 emit 키를 명시 분리하거나 `#` 대신 정규식 허용 문자(`.r1`)를 쓴다.

### H5 — pipeline 단계 **내부**에 재개 입도가 없어, 재개가 feasibility 부터 전부 재실행한다
- 근거: `WM:425` 재개 단위 3단계 · `WM:217` pipeline 은 항상 `--cycle --from=feasibility --run` · `WM:347` 범위 인자를 요구하는 곳은 §5.5.5 재진입뿐이고 §6 재개 경로엔 없음 · `PL:192` run-id 는 날짜 파생, `PL:112` freeze 시 read-only · `kiwi-srs-feasibility:33` feasibility 는 per-REQ `update_stability` mutation 수행
- 문제: pipeline 도중 중단 후 재개하면 feasibility 부터 통째로 다시 돈다 — stability mutation 재적용, 계획 재작성(같은 날이면 frozen plan 충돌, 다른 날이면 새 plan run-id 로 전 Task 재실행), 구현 완료 Task 중복 실행.
- 제안: §6 재개 규약에 "pipeline 단계 재개는 §5.5.5 와 동일하게 `--plan-run-id` + `--req-filter` 를 반드시 동반하고 kiwi-pm 은 `--resume` 으로 진입한다" 를 명문화하고 그 값을 `waves.jsonl` 에 기록(`plan_run_id` 필드 신설).

### H6 — `out_of_scope` 가 설계 항목을 전 계층 분모에서 영구 제외하며 재검사되지 않는다
- 근거: `WM:185-187`(사유가 **기록되지 않았을 때만** 게이트 발동, "out-of-scope 는 판단이 아니라 **기록**") · `WM:161`(어느 wave 의 `design_items` 에도 미포함) · `WM:395` 최종 분모에도 미포함, §5.6 전문에 재검사 조항 없음 · `WE:106` 기록 필드로만 규정
- 문제: 분해 서브에이전트가 `reason` 을 아무렇게나 한 줄 쓰면 그 섹션은 커버리지 게이트를 통과하고 어느 분모에도 들어가지 않아 **run 전체에서 한 번도 검증되지 않는다.** 사용자 승인 게이트도 없다. 분모를 자기 재량으로 축소하는 가장 값싼 경로이며, §5.5.2 가 다른 분모를 외부 고정한 것과 정면 비대칭이다.
- 제안: (i) `out_of_scope` 를 `--auto` 에서도 중단하는 사용자 확인 게이트로 올리거나, 최소한 (ii) §5.6 분모에 `out_of_scope` **전량**을 별도 계층으로 싣고 검증자 2기가 "이 run 에서 구현되지 않음이 의도됨" 을 확인하게 하며, (iii) `reason` 을 자유 텍스트가 아니라 closed enum 으로 고정한다.

### H7 — 사용자 제약을 아티팩트에 **수집**하는 절차가 없다 — 판정 계층만 있고 진입 경로가 비어 있다
- 근거: `WM:171` 이 제약 아티팩트에 관한 §3.1 의 전부이며 "빈 배열이라도 반드시 만든다" 만 규정, **무엇을 어디서 읽어 채우는지** 없음 · `WM:173` 후발 제약도 기록 방식만 · 소비측은 완비(`WM:249,255,279`, `WE:83-84`) · `--auto` 시 하위 kiwi-srs 의 QnA 루프는 skip(`kiwi-srs:141`)이라 다른 통로도 닫힘
- 문제: 판정 측만 있고 입력 측이 비어 실행 시 현실적 귀결은 **항상 빈 배열**이며, 그때 `constraint_layer.expected=0` 이라 어떤 판정도 실패시키지 못한다 — 계층이 형식상 존재하되 상시 무해하다.
- 제안: §3.1 에 "wave 분해 입력(사용자 프롬프트·대화 로그·`--constraint` 인자)에서 선언된 제약을 **호명 단위로** 추출해 아티팩트에 적는다" 는 수집 단계를 명시하고, 항목 스키마 `{ id, statement, source }` 와 추출 단위를 `design_items` 단위 규정(`WM:167`)과 같은 수준으로 고정한다.

### H8 — `constraint_layer` 만 분모 외부 고정·freeze 대상에서 빠져 있다
- 근거: REQ/AC `WM:271`("검증자가 스스로 정하지 않는다"), 설계 `WM:277`("검증자가 스스로 산정하지 않는다"), 보존 `WM:281`("기계적으로 도출") — 대조 제약은 `WM:279` 가 전부이며 `expected` 고정 문장 없음 · `frozen_denominator` 키는 `round`·`req_ac`·`design_items`·`preservation` **넷뿐**(`WM:293`, `WE:78`)이라 "행 수 불일치 = 무효"(`WM:291`, `WE:93`)가 제약 계층에 걸리지 않음
- 제안: `frozen_denominator` 에 `constraints` 키 추가 + `constraint_layer.expected` = 최신 `constraints_path` 아티팩트 항목 수로 외부 고정한다는 문장을 `WM §5.5.2` 와 `WE §2.3` 양쪽에.

### H9 — 최종 검증(§5.6)의 보존 계층 분모에 입력이 없다
- 근거: `WM:401`("최종 패스도 `unapproved-damage` **0건**을 통과 조건으로 요구") · `WM:397`("§5.5 를 그대로 재사용") · `WM:281`(분모는 **그 wave 의** diff) · `WM:399` 최종 이벤트는 `wave="all"` · `WE:55`·`WE:175`("run-scope … **diff 창은 wave 단위이므로 싣지 않는다**")
- 문제: 최종 패스에는 `diff_window` 가 원리적으로 없는데 그 패스가 요구하는 통과 조건의 분모는 wave diff 에서만 도출되도록 규정돼 있다. `WM:403` 은 회귀만 "run head 로 읽는다" 로 재해석했고 diff 창엔 대응 조항이 없다. 마지막 wave 창을 고르면 run 전체 파손 판정이 사실상 마지막 wave 재검이 된다.
- 제안: §5.6 에 "§5.5.2 의 보존 분모는 최종 패스에서 **run 창**(`run_base_sha` ~ run head)으로 읽는다" 를 회귀 재해석 옆에 추가하고, `WE` 에 run-scope 용 `run_diff_window` 를 신설해 `final-verify` 이벤트에 싣는다(`WE:175` 주석 동반 갱신).

### H10 — `fail-residual` 종료가 `critical_gates[]` 에 없어 `--auto` 에서 위원회로 떨어진다 (§0.G 스스로 금지한 패턴)
- 근거: `WM:34`("일부만 선언하면 **선언되지 않은** 나머지 중단이 위원회 판단 대상으로 떨어진다") · `WM:41` `wave-verify-residual-critical` 트리거는 CRITICAL/HIGH·`GAPS`·`fail-cap` 셋뿐 · `WM:372` `fail-residual` 정의 · `WM:338` "사용자 결정" · 표 전체에 대응 gate_id 없음
- 문제: `fail-residual` 로 끝난 wave 의 "사용자 결정" 이 `business-decision` 기본 분류(`auto-option.md:190`)로 내려간다. 그런데 그 wave 는 `verdict != pass` 라 `WE:126` 상 `complete` 를 append 할 수 없다 — 위원회에는 저널 규칙을 만족하는 선택지가 없고 결정과 무관하게 run 은 그 wave 로 되돌아온다. **정지 조건이 정의되지 않은 구간**이 생긴다.
- 제안: §0.G 에 `wave-verify-fail-residual` 행 추가, `WM:41` 설명에 "`fail-residual` 은 별도 행" 병기, §5.6 의 `fail-residual` 도 `final-verify-residual-critical` 에 포함. 아울러 `WM:328`(Normal 조기종료 → `pass`+`residual`)과 `WM:338`(사용자 결정)의 MEDIUM 잔여 처리 모순을 분기로 명시 해소.

---

## MEDIUM

| ID | finding | 근거 |
|---|---|---|
| M1 | `waves-event` SSOT 버전 핀이 **v1.2.0** 으로 stale — 스킬이 요구하는 필드가 전부 v1.3.0 신설 | `WM:18`·`WM:355`(3사본) vs `WE:1` `v1.3.0`; `design_items`·`excerpt_path`·`constraint_layer`·`frozen_denominator`·`baseline_failing_tests`·`diff_window`·`pipeline_run_ids` 전부 v1.3.0. `WM:357` 의 `verification` 키 열거도 v1.1.0 세트 |
| M2 | `constraints_path` 를 `/kiwi-srs` 로 전달할 채널이 없다 | `WM:203` 은 전달을 명령하나 `kiwi-srs:120-138` 입력 표에 제약 인자 없음. 같은 §4 가 바로 앞(`WM:201`)에서 "인라인 전달로는 루프가 작동하지 않는다" 고 못박음 |
| M3 | 최종 패스의 **wave-귀속** finding 을 닫는 경로가 없다 | `WM:397` 재사용 목록에 §5.5.5·§5.5.7 미포함 · `WM:405` 는 run-scope finding 만 정의 · 나머지는 `WM:411`/`WM:44` 로 HALT. §5.5.7(`WM:383`)이 이미 답을 갖고 있어 새 장치도 불필요 |
| M4 | 최종 패스 "통합 항목" 분모의 고정 주체·단위가 없고 `design_layer.expected` 규칙이 `wave="all"` 을 커버하지 않는다 | `WM:395` · `WE:82`("**그 wave 의** `design_items` 길이") vs `WE:130` `wave="all"`; `WE:176` 은 예시일 뿐 |
| M5 | 신설 wave(이월·run-scope)의 설계 기준선 인터페이스가 세 문서에서 상호 모순 | `WM:175`(이월 finding 목록을 분모로) vs `WE:82`(예외 없음)·`WE:97-109`(담을 필드 없음) · `WM:255`(설계 기준선 행 **필수**) · `WM:201`(`excerpt_path` 전달 의무) vs `WM:405`("정상 실행") |
| M6 | wave → pipeline target 결선이 `kiwi-srs` 의 부수효과에만 의존 | `WM:221` vs `PIPE:59-77` 에 target 인자 없음; 실제 결선은 `kiwi-srs:253` `set_active_target` 부수효과뿐. `WM:207`·`WM:425` 로 §4 를 건너뛰는 재개에서는 그 호출 지점이 사라진다 |
| M7 | `--force` 전파 사슬이 중간 홉에서 끊긴다 | `WM:473`(경로 선언) vs `PIPE:354-357` pass-through 표에 `--force` 없음(3사본), `PM:150` 은 수용 |
| M8 | "그 REQ 만 대상으로 feasibility 재실행" 이 기계적으로 실행 불가 | `WM:341` vs `kiwi-srs-feasibility:108-130` 에 REQ 단위 인자 없음. feasibility 는 per-REQ `update_stability` 를 수행하므로 전수 재평가는 부작용 |
| M9 | §2 Phase 흐름(일괄 등록)과 §4/§6(인터리브 + carry-forward 입력)이 모순 | `WM:94-99` vs `WM:199`("wave 진입 시 `carried_into` 수집")·`WM:425` |
| M10 | wave 추가 루프에 상한이 없다 — 무인 실행 종료 미보장 | `WM:383`·`WM:405`; §5.5.4 라운드 상한은 한 검증 루프 안에서만 적용, §5.6 재실행 시 카운터 누적 여부 미규정(`WE:155` 는 재개만 언급) |
| M11 | 재개된 wave-master 자신의 `pipeline.jsonl` emit 이 멱등 skip 된다 | `WM:512`(멱등: run_id 기준) · `WE:155`(재개는 같은 run_id 재사용) · `pipeline-event.md:135-138`. 중단 시 `FAILED` 를 남긴 뒤 재개·완주하면 최종 `TASK_DONE` 이 영구 미기록 → `PIPE:43` 게이트 발동 |
| M12 | wave 계층 보존 판정의 술어 기준이 fixer 금지 조항에만 달려 있고, **약화가 wave 분모에 아예 없다** | `WM:281`(기준 참조 없음) · `WM:343`(§0.20 참조는 §5.5.5 fixer 금지에만) · 분모는 "삭제·수정된 기존 테스트 파일" 이고 `WM:285` 상 REQ/Task 근거가 있으면 `intended-improvement` → 계획 Task 안에서의 단언 약화가 wave 게이트를 통과. `WM:345`("하위 루프 PASS 는 wave 게이트를 충족하지 않는다")와 어긋남 |
| M13 | "회귀 기준선은 하나의 SSOT 를 공유한다" 는 주장이 전달 경로로 뒷받침되지 않는다 | `WM:142` 주장 vs `CO:291`·`CO:304-305`(자기 시점 캡처, 부모 값 수신 필드 없음) · `RFL:412-415`(자기 preflight 시점 캡처). wave-3 가 방금 만든 실패를 위임 RFL 은 "기존 실패" 로 분류하고 TASK_DONE 을 반환하는 반면 wave 게이트는 신규로 판정 |
| M14 | `existing_modules` 가 검증 입력으로만 흐르고 저작·계획 입력으로는 전달되지 않는다 | `WM:157` 기록, 소비처는 `WM:252`·`WM:289` 검증자 2 뿐 · `WM:201-203` §4 전달 목록에 없음 · `PL` 에 기존 구조 보존 개념 없음(`PL:63-71`·`PL:215` 는 cwd **외부** 한정) |
| M15 | codex·etc 의 `RFL` 은 보존 스캔의 실행 지점과 CRITICAL 승격이 빠져 있다 | claude `RFL:462`(Phase 4 에 결선) vs `codex/RFL:32`·`:48-50` 은 §0.17 선언과 게이트 행만 있고 Workflow `:69-83`·references Exit criteria `:75-82` 에 스캔 단계 없음. etc 동일 |
| M16 | `--auto` 완주에 필요한 두 옵션이 `WM §1.2` 자연어 매핑에 없어, 사용자가 지정할 통로가 여전히 문서에 없다(경로만 존재) | `WM:473` pass-through 표 · `WM:65-71` §1.2 표 |
| M17 | Normal 조기종료(`pass`+`residual`)와 §5.5.5 "사용자 결정" 이 MEDIUM 잔여에 대해 동시에 읽힌다 | `WM:328` vs `WM:338` vs `WM:372`. H10 과 같은 뿌리이나 분기 문장이 따로 필요 |

---

## LOW

| ID | finding | 근거 |
|---|---|---|
| L1 | Normal 모드의 "스트릭 요구치" 가 정의되지 않아 도달-불가 PASS 탐지 술어를 평가할 수 없다 | `WM:326`·`WE:151` vs `WM:311`("Normal 모드에는 스트릭 자체가 없다"). 제안: Normal=1, `--max`=2 를 §5.5.4 표에 숫자로 고정 |
| L2 | `--loops N` 의 잘못된 값에 대한 HALT 가 게이트 표에 없다 | `loop-option.md:16` vs `WM:36-49`. 제안: `invalid-loop-option` 등재 또는 게이트 표 적용 범위를 "실행 중 게이트" 로 한정 |

---

## 종합 판정

세 축의 총평이 같은 구조를 가리킨다.

- **골격은 섰다** — 설계 기준선 물질화, 분해 커버리지 게이트, 4계층 분모, 외부 고정·라운드 freeze·add-only 교차반박, 보존 계층의 종료 조건 결선, 최종 패스. 라운드 1·2 에서 CRITICAL 이었던 것들은 실제로 닫혔고, 변형 간 규범 불일치는 0건이 되었다.
- **남은 결함은 전부 계층 경계에 있다** — 소비자는 있는데 생산자가 없거나(H3), 판정 규칙이 두 계층에서 비대칭이거나(H1·M12·M13), 선언된 전달 경로에 수신 인터페이스가 없거나(M2·M7·M8), 한 계층이 다른 계층의 존재하지 않는 동작을 전제한다(H2·M6).
- **가장 실질적인 위험 두 가지**: (1) `diff_window`/`pipeline_run_ids` 생산자 부재로 **재개 후 보존 검증이 실행 불가능**(H3), (2) 실행 계층에 증거 기반 해소가 없어 **리팩터를 포함한 설계는 무인 완주가 성립하지 않음**(H1).

---

## 추가 finding (R2 증거 등록 중 발견 — 위 3축 평가에 없던 것)

### H11 — `kiwi-coder` 가 critical 로 선언한 게이트 **9종**이 `kiwi-pm` 에 미상응
- 근거: coder canonical 15종 중 `zero-tolerance-plan-code-mismatch` · `mock-detection` · `tdd-bypass-attempt` · `improvement-loop-divergence-4opt` · `mcp-mutation-backward-status` · `followup-review-fix-loop-close-unsafe` · `integration-test-user-consent` · `cost-warning-large-task` · **`existing-file-deleted-or-moved`** 가 pm 의 13종 집합에도 §5.1 always-HALT 목록에도 없다. `kiwi-pm/SKILL.md:459` 자식 반환 `questions[].severity` enum 에 `critical` 값이 **없고**, `auto-option.md:189` 가 "critical_gates 에 없으면 `business-decision` 기본 분류", pm §5.1 이 confidence ≥0.7 에 자동 채택.
- 문제: R2 는 `existing-test-weakened-or-deleted` 한 건만 닫았다. 나머지 9종은 `--auto` 에서 위원회 승인으로 통과할 수 있다. 특히 `existing-file-deleted-or-moved` 는 R2 가 새로 만든 보존 게이트인데 형제 2종과 달리 pm 에 등재되지 않았다.
- 제안: 자식이 critical 로 선언한 게이트가 부모에서 자동 분류로 떨어지지 않도록 **일반 규칙**을 세워라 — pm 이 자식 `NEEDS_USER` payload 의 `gate_id` 를 읽어 그것이 자식의 `critical_gates[]` 에 있으면 무조건 HALT. 게이트별 수동 전사는 이번처럼 반드시 누락된다. `kiwi-pm/SKILL.md:459` severity enum 에 `critical` 을 추가하는 것이 선결이다.

### H12 — 아무 Task 도 실행하지 않은 재진입이 `TASK_DONE` 을 보고하는 것을 막는 규정이 없다
- 근거: `kiwi-pm/SKILL.md:1211` "모든 Task 완료 + T-final mutation 성공 = `TASK_DONE`". 재진입 시 pm-state 의 Task 가 전부 `done` 이면 아무것도 실행하지 않고 `TASK_DONE` 을 낸다. 전 스킬 트리에 이를 막는 문장 0건.
- 문제: 개선 루프의 재진입이 **성공한 것처럼 보이고 아무것도 고치지 않는다.** 다음 라운드 검증자는 같은 finding 을 다시 올리고, 이것이 cap 소진까지 반복된다.
- 제안: `kiwi-pm` 에 "이번 실행에서 상태가 바뀐 Task 가 0건이면 `TASK_DONE` 이 아니라 그 사실을 실은 `NEEDS_USER`(또는 no-op 표식)를 반환한다" 를 명시.

### M18 — `FR-FLOW-059 AC-1` 이 구현과 반대 방향을 요구한다 (명세 개정 필요)
- 근거: AC-1 은 두 게이트가 wave-master 자신의 무인 옵션으로 **사용자가 값을 대지 않고** 해소되기를 요구(findings R2-H1 의 분기 (a)). 구현·테스트는 분기 **(b)** 를 채택 — `kiwi-wave-master/SKILL.md:445` "`--auto` **단독**으로는 통과하지 못한다 … 해당 옵션이 **명시**될 때만 우회", `kiwi-wave-continuity-r2-content.test.ts:441-444` 가 "자동 부여" 문구 **부재**를 단언.
- **결정: (b) 를 유지하고 AC-1 을 개정한다.** 자동 부여는 사용자가 한 번도 동의하지 않은 통합 테스트 실행과 ≥10분 비용을 wave 수만큼 승인하는 것이라 게이트의 존재 이유를 무효화한다. "멈추지 않고 끝까지" 는 옵션을 **도달 가능하고 문서화**하는 것으로 달성하고, 그 대가(사용자가 한 번 명시해야 함)를 §7.1 이 정직하게 밝히는 쪽이 옳다.
- 제안: `FR-FLOW-059 AC-1` 을 "두 게이트는 wave-master 의 pass-through 옵션으로 **도달 가능**해야 하고, `--auto` 단독으로는 통과하지 못한다는 사실이 §7.1 에 명시되어야 하며, 두 gate_id 가 게이트 표에 등재되어야 한다" 로 개정.

### M19 — `auto-option.md §5.1` 카탈로그·예시에 어느 사본에도 없는 `lifecycle-gate-draft` 가 잔존
- 근거: `_shared/kiwi/auto-option.md` §5.1 표준 카탈로그와 `:232` 예시. 계약이 모든 canonical 집합에서 의도적으로 제외한 id 다.
- 문제: "(참고)" 표기라 판정을 막지는 않으나, **인터페이스 키의 SSOT** 에 실재하지 않는 id 가 남아 있으면 신규 스킬이 그것을 채택한다.
- 제안: 카탈로그에서 제거하거나 "철회됨 — per-REQ skip 으로 대체(FR-FLOW-053)" 주석을 단다.

### M20 — R1 테스트 `AC-6: requires a green full regression run` 이 실질을 잃었다
- 근거: `kiwi-wave-continuity-content.test.ts:1038` 의 Normal 행 정규식 `/`exit_code`\s*=?\s*0|회귀 스위트 통과/` 이 이제 **fallback 절 안의** `exit_code`=0 토큰에 매치해 통과한다. 기준선 델타라는 **주 조건**은 이 단언이 더 이상 고정하지 않는다.
- 문제: 커버리지 공백은 아니다(R2-H5 단언이 별도로 고정). 그러나 단언이 이름과 다른 것을 검사하는 상태이며, 이 종류는 다음 개정에서 조용히 무력화된다.
- 제안: 그 단언을 "Normal 행의 **주 조건**이 `failing_tests ⊆ baseline_failing_tests` 이고, `exit_code=0` 은 **기준선 캡처 실패 시의 격하 조건으로만** 등장한다" 로 고쳐 두 조건의 **역할**을 고정하라.
