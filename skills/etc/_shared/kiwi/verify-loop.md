# kiwi verify-loop v1.0.0

두 검증자 상호검증 루프(cross-verification loop)의 **공용 엔진** SSOT. `kiwi-wave-master` §5.5 에서 **텍스트를 이동**해 만들었으며, 본 문서를 참조하는 모든 스킬은 아래 규칙을 read-time 에 동일하게 적용한다.

**본 엔진은 분모-불가지(denominator-agnostic)** 하다 — 고정 분모를 **입력으로 받으며**, wave 고유·lane 고유·handoff 고유의 분모를 스스로 하나도 두지 않는다. 호출자마다 자기 분모 표를 공급한다.

본 계약 안의 `§n` 은 이 파일의 절을 가리킨다. 아래 이동된 본문이 `§0.G` · `§5.5` · `§6` 를 가리킬 때 그것은 **호출자의** 절이다 — 이동 전 문장을 그대로 옮겼기 때문이다.

---

## 1. 계약 — 호출자가 공급하는 것

| 입력 | 규칙 |
|---|---|
| **고정 분모 표**(frozen denominator table) | 호출자가 계층별 `expected` 를 **외부에서** 고정해 넘긴다. 엔진은 이 값을 산정하지 않는다 |
| **증거 번들 행** | 호출자가 §2 규칙에 따라 행 목록을 공급하고, 그중 어느 행이 **필수**인지도 호출자가 선언한다 |
| **라운드 상한** | `../_shared/kiwi/loop-option.md` v1.0 |
| **저널 기록기** | 라운드마다 verdict 를 append 하는 주체. 저널 schema 는 호출자의 SSOT 를 따른다 |
| **critical 게이트 id** | 잔여 CRITICAL/HIGH · `fail-cap` · `fail-residual` · 진동에서 중단할 게이트 이름 |

**범위 밖**: hunk 단위 코드 리뷰는 본 계층의 범위 밖이며 `kiwi-review-fix-loop` 가 이미 소유한다 — 여기서 재수행하지 않는다. 본 계층이 값을 하는 조건은 diff 가 아니라 **wave 단위 증거**를 보는 것이다.

---

## 2. 증거 번들 (양 검증자 공통) — kiwi-wave-master §5.5.1 에서 이동

**정확히 2개의 검증 축**(verification axes)을 단일 워커 프로파일에 맞춰 순차 수행하고, 두 검증자에게 **동일한 증거 번들**을 준다. 증거를 둘로 **나눠** 주는 것은 **금지**한다 — 공유하는 증거가 없으면 확인도 반박도 원리적으로 불가능해 상호검증이 성립하지 않는다.

호출자가 **필수**로 선언한 증거 행은 생략할 수 없다 — 번들에 없는 증거는 어느 stance 에서도 보이지 않으므로, 검증이 코드가 스스로 선언한 범위 안에서만 돌게 된다.

증거 창은 호출자가 지정한 **모든** run 과 진입 타임스탬프로 경계 짓는다. 스킬별 **분석 산출물**은 같은 창 안의 그 스킬 이벤트가 실어 보낸 **자신의** `artifacts.analysis_dir` 에서 해석하며, `*` 글롭으로 대신하지 않는다.

---

## 3. 두 검증자 (stance 분리) — kiwi-wave-master §5.5.2 에서 이동

| | 검증자 1 | 검증자 2 |
|---|---|---|
| stance | wave SRS **의도 실현** + **과정 적합**(process conformance) | **결과물 품질** + **교차 wave 회귀** 위험 |
| roll-up | `ALL_MATCH` / `GAPS` | `substantive_clean` |
| 산출 | REQ/AC 행마다 `intent_match` + 증거 포인터 | finding 마다 `severity` + `severity_class` |

각 행의 판정은 `intended-improvement` / `unapproved-damage` 두 값 enum 이며 자유 서술은 판정이 아니다. 결과는 `preservation_layer` 에 싣는다.

`intended-improvement` 는 그 변경을 요구하는 **REQ** 또는 계획 **Task** 가 있을 때에만 쓰며, 그 근거를 행의 `evidence` 에 REQ-ID 또는 Task-ID 로 적는다.

근거를 대지 못한 행은 `unapproved-damage` 다 — 근거 없는 재량을 남겨두면 wave 를 끝내려는 국소 이해가 그대로 verdict 가 된다.

단, **약화는** REQ 또는 Task 근거가 있어도 `intended-improvement` 로 **기록하지 않는다** — 언제나 `unapproved-damage` 다. 계획 Task 안에서 단언을 낮추는 것이 이 루프에서 가장 값싼 우회로이고, 하위 루프의 PASS 가 wave 게이트를 충족하지 않는다는 §5.5.5 의 규칙과도 어긋나기 때문이다.

열거한 **행 수가** 고정 분모의 개수와 다른 라운드는 두 검증자 **모두**에 대해 **무효**이며, cap 은 소비하되 연속 clean 스트릭은 0 으로 되돌린다.

분모는 **라운드 도중** 늘어나지 않는다 — 증분 저작·수정으로 생긴 항목은 **다음 라운드** 진입에서 다시 freeze 하며, 그 재freeze 라운드는 **무효가 아니다**.

산문은 줄일 수 있어도 호명은 줄일 수 없다 — 분모를 외부에서 고정하는 것이 "훑고 PASS"를 막는 유일한 기계적 장치다.

두 검증자의 **분모**는 호출자가 외부에서 고정해 넘긴 값이며, **검증자가 스스로 정하지 않는다**. **모든** 항목을 행으로 열거하고 `checked == expected` 를 대조한다. 표본·발췌·상위 N 은 분모가 아니다. 실현으로 표시한 행에는 **해소 가능한** 증거 포인터(존재하는 `file:line` 또는 존재하는 test id)를 붙인다. 개수 불일치 또는 미해소 포인터가 있으면 그 라운드는 **무효**이며, cap 은 소비하되 연속 clean 스트릭은 0 으로 되돌린다.

분모는 라운드 진입 시 freeze 하고 그 개수를 `frozen_denominator` 에 계층별로 기록한다 — 계층의 이름과 개수는 호출자의 분모 표가 정한다.

---

## 4. 라운드 구조 (상호검증) — kiwi-wave-master §5.5.3 에서 이동

**한 라운드는 아래 세 단계 전부**다 — 단계 1 만 수행하고 종료 조건을 판정하는 것은 라운드가 아니다. `--loops 1` 도 세 단계를 모두 포함한 1 라운드를 뜻한다.

1. **단계 1 — 독립·격리**: 두 검증자를 서로 독립적으로 수행한다. 메인 세션의 결론·정당화도, 상대 검증자의 산출도 전달하지 않는다.
2. **단계 2 — 교차반박**: 각자에게 상대의 finding 목록을 **주장과 증거 포인터만** 담은 형태로 전달한다(rationale · verdict · confidence 제외). 여기서 가능한 동작은 **추가(add)와 확인(confirm)뿐이다 — `add-only`**. 상대의 finding 을 **기각할 수 없다**. 이 단계를 건너뛴 라운드는 **무효**이며 종료 조건 판정에 쓸 수 없다.
3. **단계 3 — 병합**: **기계적 합집합**. 검증자에게도 메인 세션에도 재량이 없다.

기각 권한을 주면 담합 보상이 생긴다 — 두 검증자의 국소 이해가 모두 "wave 를 끝내는 것"을 가리키므로 최단 경로가 **상호 기각**이 된다. add-only 는 기각으로 얻는 것을 없애고, 상대가 놓친 것을 찾는 행위만 남긴다.

두 번째 라운드부터는 검증자를 **새로 spawn** 한다(단일 워커 프로파일에서는 **새로운 검증자** 컨텍스트로 순차 수행). 같은 컨텍스트를 재사용하면 두 번째 clean 라운드가 "첫 검증자가 자기 자신에게 동의한 것"이 되어 연속 clean 이 아무것도 뜻하지 않는다.

finding 을 닫는 경로는 셋뿐이다. (i)/(ii) 의 "제기한 쪽"은 **인스턴스가 아니라 stance** 를 뜻한다 — 라운드마다 새 인스턴스를 쓰므로 인스턴스로 읽으면 (ii) 는 실행 불가능해진다: (i) 수정 후 **제기한 stance 의 검증자**(새 인스턴스)가 재검증하여 clean, (ii) **제기한 stance 의 검증자**가 반대 증거와 함께 철회, (iii) 양 검증자 만장일치 재분류 — 단 (iii)이 포함된 라운드는 연속 clean 스트릭에 **산입하지 않는다**(기각에 라운드 비용을 물려 유인을 역전). (iii)은 한 검증자의 **일방적 기각이 아니다** — 양측 합의와 기록된 사유를 요구하므로 add-only 를 깨지 않는 유일한 오탐 배출구다. 다만 스트릭 제외만으로는 대가가 되지 않는다(Normal 모드에는 스트릭 자체가 없다). 따라서 재분류가 일어난 라운드는 **모드와 무관하게** 반드시 검증 **라운드를 더** 돌고 나서야 PASS 할 수 있으며 — 수정이 적용된 라운드와 같은 취급이다 — 재분류 건은 사유와 함께 `verification.residual` 에 남긴다.

---

## 5. 종료 조건 — kiwi-wave-master §5.5.4 에서 이동

| 모드 | PASS |
|---|---|
| Normal | 병합 결과 `CRITICAL=0` + `HIGH=0` + 검증자 1 `ALL_MATCH`, **그리고 그 라운드에서 수정이 적용되지 않았을 것**, 그리고 wave head 회귀에 **신규 실패 0 건**(`failing_tests ⊆ baseline_failing_tests`, 기준선 부재 시 `exit_code`=0), 그리고 `unapproved-damage` **0 건** |
| `--max` | 위 조건 + `MEDIUM=0` 을 **3라운드 연속** (etc 프로파일) |

etc 호스트는 `../_shared/kiwi/local-llm-profile.md` 가 **3연속 무개선**을 요구하고 `--max` 가 기본값이므로, 본 루프의 `--max` 스트릭은 claude/codex 의 2 가 아니라 **3** 이다.

**수정이 적용되지 않은 라운드**에서만 통과한다는 조항이 저비용 상한을 안전하게 만든다 — 검증자가 읽은 적 없는 상태에 PASS 를 찍는 것을 막고, 수정이 있었다면 반드시 재검증 라운드가 돌게 한다.

기준선 **캡처에 실패**해 `baseline_failing_tests` 가 없으면 이 회귀 조건은 `exit_code`=0 으로 격하된다 — 기준선이 없으면 신규 실패를 분리할 수 없다.

라운드 상한(`../_shared/kiwi/loop-option.md` v1.0): 기본 **5**, `--max` **8**, `--mini` 3. `--mini` 와 `--loops N` 동시 지정 시 **`--loops` 우선**(비치명 **WARN**). 단 etc 는 `--max` 가 기본이므로 `--mini`/`--loops` 미지정 시 실효 상한은 **8** 이고(명시 `--loops N` 은 그대로 우선한다), 위 표의 Normal 행은 etc 에서 **단독 종료 조건으로는 쓰이지 않는다** — `--max` 행이 참조하는 구성요소로만 남는다. 프로파일이 `--max` 를 끄는 수단을 제공하지 않으므로 Normal 행 단독으로 종료하는 경로가 없다.

재개 시점에 **남은 라운드**(`cap - rounds`)가 그 모드의 **스트릭 요구치**보다 작으면 PASS 가 산술적으로 불가능하므로, 라운드를 더 돌지 않고 `fail-cap` 으로 기록하고 사용자 결정을 받는다.

**cap 소진은 PASS 가 아니다.** 상한에 닿으면 verdict 를 `fail-cap` 으로 기록하고, `complete` 를 append 하지 않으며, 잔여 finding 을 **전량** 보고한 뒤 사용자 결정을 받는다. 상한은 무한 에스컬레이션을 멈출 뿐 CRITICAL 을 은폐하지 않는다. **Normal 모드에서만** 상한에 닿기 전 Normal 게이트를 만족한 시점에 종료하며, 이때 남은 MEDIUM/LOW 는 `residual` 에 기록하고 `complete` 로 진행한다. `--max` 에서는 이 조기 종료가 없다 — 그 모드의 유일한 통과 경로는 위 `--max` 행의 연속 스트릭이다.

**Normal 조기 종료**의 MEDIUM/LOW 잔여는 `pass` + `residual` 이며 **사용자 결정을 받지 않는다**. 그 밖의 미해소 finding 을 남긴 채 상한 전에 끝난 경우만 `fail-residual` 이고, 그때는 §0.G `wave-verify-fail-residual` 로 중단해 사용자 결정을 받는다. 두 경우를 한 문장으로 읽으면 조기 종료마다 무인 실행이 멈추거나, 반대로 `fail-residual` 이 조용히 통과한다.

**스트릭 요구치는** Normal **1** 라운드, `--max` **3** 라운드다 — 위 "남은 라운드" 판정이 비교하는 값이 이것이다.

---

## 6. 진동(oscillation) 감지

같은 `finding_id` 가 **2 라운드 이상**에 걸쳐 닫혔다가 다시 열리거나, 같은 hunk 가 되돌려졌다가 다시 적용되면 두 stance 는 진짜로 충돌하는 중이고 라운드를 더 돌아도 얻는 것이 없다. cap 을 태우지 말고 **즉시 종료한다** — `verdict` 를 `fail-residual` 로, `reason_class` 를 `"oscillation"` 으로 기록하고 `verification-oscillation` 을 critical 로 올린다.

진동은 cap 소진과 **다른 사건**이다 — cap 소진은 라운드를 다 쓴 결과이고 진동은 라운드를 더 써도 수렴하지 않는다는 증거이므로, 진동을 `fail-cap` 으로 기록하지 않는다. 진동으로 끝난 루프는 cap 을 소진하지 않았어도 `complete` 를 append 하지 않는다.

---

## 7. 개선 위임 (수정 주체) — kiwi-wave-master §5.5.5 에서 이동

본 스킬은 상위 오케스트레이터이므로 **전용 fixer 를 신설하지** 않는다 — 직접 요구사항을 저작하거나 코드를 구현하지 않는다는 본 문서 서두의 성격을 유지한다. 수정은 finding 종류로 라우팅한다.

| finding 종류 | 처리 |
|---|---|
| 품질 · 회귀 · 구현 결함 | `kiwi-review-fix-loop` 위임. **명시 범위**(`--base`/`--head` 또는 `--commits`)를 함께 전달한다 — 그 wave 의 작업이 이미 커밋됐으면 working-tree diff 가 비어 clean 오보가 난다 |
| 검증자 1 의 갭 중 **대응 계획 자체가 없던** 것 | 그 wave 의 $kiwi-pipeline **재진입** — 코드 리뷰어는 계획 항목을 만들어낼 수 없다 |
| 코드로 닫을 수 없는 SRS 수준 finding (증거 부재 등) | `residual` 로 이관 + 사용자 결정 |
| **이전 wave** 의 완료 target 을 건드려야 하는 것 | `wave-verify-cross-wave-fix-required` critical HALT (§0.G) |
| **설계 기준선에는 있으나** wave SRS 에 없는 것 | 그 wave target 에 `$kiwi-srs` **증분** 저작 재진입 → 이어서 planning 단계부터 pipeline **재진입** |
| feasibility · planning 단계가 draft 로 남은 REQ | 그 REQ 만 `--req-filter` (`<REQ-ID[,…]>`) 로 지정해 `$kiwi-srs-feasibility` 재실행 후 planning 재진입; 승급 실패 시 `reason_class="draft-stability-skip"` 로 residual |

**금지**: fixer 는 **AC 본문**을 수정하지 않는다. 기존 **테스트를 약화하거나 삭제**하지 않는다(`kiwi-coder §0.20` 확장 — 판정 기준은 그 절의 closed list 를 그대로 따른다). `severity_class` 는 그 finding 을 제기한 검증자만 작성하며 fixer 도 메인 세션도 손대지 않는다. 결함을 고치는 대신 기준을 낮추는 것이 이 루프에서 가장 값싼 우회로이므로 셋 다 명시적으로 막는다.

`kiwi-review-fix-loop` **자신의 PASS 는 wave 게이트를 충족하지 않는다** — wave 수준 finding 은 오직 두 검증자의 재검증으로만 닫힌다. 그렇지 않으면 "하위 루프가 TASK_DONE 을 반환했으니 wave 검증도 통과"라는 다른 게이트의 판정으로 이 게이트를 대신하는 우회가 열린다.

파이프라인 재진입은 명시 범위를 함께 전달한다 — **미해소 요구사항 필터**(그 라운드에 미대응으로 남은 REQ 목록)를 `--req-filter` 로, 기존 `plan_run_id` 를 **재사용**하는지 여부를 `--plan-run-id` 로 넘긴다. 범위 없이 재진입하면 이미 통과한 Task 까지 다시 돌아 한 라운드의 비용이 계획 전체로 불어난다.

증분 저작이 완료된 이전 wave 의 target 을 건드려야 하면 `wave-verify-cross-wave-fix-required` 게이트가 그대로 적용된다 — 재진입 경로가 완료 불가역성을 우회하는 통로가 되지 않게 한다.

설계 계층 갭의 자동 처리는 `--auto` 에서도 **허용한다** — 근거가 추론이 아니라 기록된 설계 기준선이기 때문이다. 무엇을 저작할지가 문서로 고정되어 있으므로 위원회 판단이 끼어들 자리가 없다.

하위 스킬이 **skip·보류한 REQ** 는 `verification.residual` 에 `reason_class` 와 함께 올라온다 — 부분 진행은 기록으로 드러나야 하고, 드러나지 않으면 다음 wave 가 그것을 완료로 딛고 선다.

---

## 8. 교차 wave 이월 — kiwi-wave-master §5.5.7 에서 이동

교차 wave 여부는 finding 이 건드리는 **파일 집합**으로 **기계적**으로 판정한다 — 서술적 판단이 아니다. 그 파일 집합이 이전 wave 의 기록된 REQ 의 **코드 trace 앵커** 또는 **이전 wave 의 diff 파일 집합**과 교집합을 가지면 교차 wave 다.

이전 wave 의 **요구사항을 바꿔야** 하는 finding 도 이월을 먼저 시도하고, 남은 wave 와 신규 wave 양쪽이 **모두 불가능할 때에만** HALT 한다 — 완료된 target 을 되돌리는 일이기 때문이다.

이전 wave 가 만든 **코드를 바꿔야** 하는 finding 은 남은 wave 의 scope 로 이월한다. 남은 wave 가 없으면 §0.5 예외에 따라 새 wave 를 추가하고 거기로 이월한다.

이월은 `cross_wave` = true 와 `carried_into` = 이월한 wave id 로 `verification.residual` 에 남긴다. 이월은 이전 wave 의 `complete` 이벤트를 수정하거나 되돌리지 않는다 — 저널은 append-only 이고, 되돌림은 §0.6 재개 규약을 무너뜨린다.

HALT 는 **양쪽 carry-forward 경로**가 **모두 불가능할 때만** 쓴다. HALT 는 교차 wave finding 에 대한 **첫 대응이 아니다** — 첫 대응은 이월이고, 이월할 곳이 없을 때에만 사람에게 올린다.

---
