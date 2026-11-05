# kiwi verify-loop v1.0.0

wave 종료 검증과 최종 검증의 **공용 엔진** SSOT. `kiwi-wave-master` §5.5 · §5.6 과 `kiwi-orchestrator` 의 loop P · loop F 가 이 문서를 고치지 않고 그대로 따른다. 판정은 실행이 입증한 **kept finding** 하나로만 한다 — 등급을 매겨 통과를 가르지 않는다.

**본 엔진은 분모-불가지(denominator-agnostic)** 하다 — 검증 범위를 **입력으로 받으며**, wave 고유·lane 고유의 분모를 스스로 하나도 두지 않는다.

본 계약 안의 `§n` 은 이 파일의 절을 가리킨다. 아래 본문이 `§0.G` · `§5.5` · `§6` 를 가리킬 때 그것은 **호출자의** 절이다.

---

## 1. 계약 — 호출자가 공급하는 것

| 입력 | 규칙 |
|---|---|
| **검증 범위** | wave 의 요구 ID 와 AC(`orchestrate wave show` 의 `acs`), PRD 항목(`prd_items`), 통합 항목(§3), PRD 의 제외 항목, wave 의 diff 창. 최종 검증은 run 의 모든 AC 와 모든 통합 항목이다 |
| **라운드 상한** | `../_shared/kiwi/loop-option.md` v1.0 |
| **저널 기록기** | 라운드마다 verdict 를 append 하는 주체. 저널 schema 는 호출자의 SSOT 를 따른다 |
| **중단 게이트 id** | kept finding 이 남은 종료 · `fail-cap` · `fail-residual` · 진동에서 중단할 게이트 이름 |

**범위 밖**: hunk 단위 코드 리뷰는 본 계층의 범위 밖이며 `kiwi-review-fix-loop` 가 이미 소유한다 — 여기서 재수행하지 않는다. 본 계층이 값을 하는 조건은 diff 가 아니라 **wave 단위 증거**를 보는 것이다.

**코드가 없는 루프** — `kiwi-orchestrator` 의 loop D(설계)와 수렴 레지스트리 검증도 이 엔진을 쓴다. 그 루프에는 §2 의 기계 검사와 §4 의 테스트가 없고, 대신 검증자가 호출자가 라운드 전에 고정한 행(frozen denominator)을 **모두** 열거한다. 열거한 행 수가 고정 분모와 다르면 그 라운드는 **무효**이며 cap 은 소비하되 연속 통과 스트릭은 0 으로 되돌린다. finding 은 해소 가능한 포인터(존재하는 `file:line` 또는 명령 출력)가 입증할 때만 남고, 통과 조건은 §5 에서 회귀 조건을 뺀 것이다.

---

## 2. 기계 검사가 먼저다

병합 뒤 `complete` 줄 앞에서, 검증자를 띄우기 전에 호스트가 아래 검사를 차례로 돈다. 실패는 그 행의 경로로 먼저 고치고, 모두 통과한 뒤에야 §4 의 라운드에 들어간다.

| 검사 | 명령 | 실패하면 |
|---|---|---|
| 분할 | `speckiwi orchestrate wave check --waves <그래프> --run-id {run_id} --json` | 그래프를 고쳐 다시 check 한다(`wave-decomposition.md §6`) |
| PRD 커버리지 | `speckiwi prd coverage <PRD> --target <제품 target> --json` | `wave-decomposition.md §5` 로 멈춘다 |
| AC 인용 | wave 의 AC 에 대해 `speckiwi coverage --tests --ids <wave 의 요구 ID> --json`(MCP `check_test_sufficiency`) | `test-sufficiency.md` 대로 인용 공백을 채운다 |
| 테스트 우선 | 착지한 요구마다 `Commit-Kind: test` 커밋이 `Commit-Kind: implementation` 커밋의 조상인가(`parallel-waves.md` PW-8) | 그 요구를 재진입으로 다시 구현한다(§7) |
| 보존 | `speckiwi orchestrate preservation check --base <wave 의 base_sha> --head <wave head> --json` | 보고된 행마다 그 변경을 요구하는 AC 가 없거나 테스트 약화면 재진입으로 되돌린다(§7) |
| 회귀 | 호출자가 pin 한 회귀 명령 — `failing_tests ⊆ baseline_failing_tests`, 기준선 캡처에 실패했으면 exit 0 | `kiwi-review-fix-loop` 위임(§7) |

기계 검사가 판정한 것을 검증자에게 다시 묻지 않는다. 검증자에게 남는 것은 인용된 테스트가 그 AC 를 정말 검증하는가, wave 를 가로지르는 통합 동작, PRD 제외 항목의 침범, 그리고 `preservation check` 가 보지 않는다고 적은 단언 약화(바뀐 기대값, 느슨해진 술어)다.

---

## 3. 검증자 — 라운드마다 새로

라운드마다 검증자를 **새로** 하나 띄운다 — `--max` 면 서로 다른 관점의 둘이다(단일 워커 프로파일에서는 둘을 **새로운 검증자** 컨텍스트로 하나씩 차례로 돈다). 같은 컨텍스트를 다시 쓰면 다음 라운드의 통과가 "앞 검증자가 자기 자신에게 동의한 것"이 되어 아무것도 뜻하지 않는다.

검증자에게 주는 것은 PRD 경로와 wave 의 PRD 항목(`prd_items`), wave 의 요구 ID 와 AC, wave 의 diff 창, 통합 항목, PRD 의 제외 항목, run 의 제약 파일(`constraints_path`)뿐이다. 호스트의 결론도 앞 검증자의 산출도 주지 않는다 — 결론을 받은 검증자는 그 결론을 확인하는 쪽으로 기운다.

통합 항목은 서로 다른 노드의 요구 사이에 있는 `Requirement` / `depends_on` 링크와, 양 끝 노드가 서로 다른 요구를 가진 그래프 간선이다 — 항목마다 그 간선의 `reason` 을 설명으로 싣는다. 검증자가 스스로 고르지 않는다.

**산문은 읽는 자료이지 판정 대상이 아니다.** 연구 노트·intake·설계 문서가 입력에 들어가도 검증자는 그 서술에 finding 을 걸지 않는다(§9). 다만 그 산문이 **이 창 안에서 변경된** 경우는 §2 의 보존 검사 대상이다.

---

## 4. 라운드 — red 테스트만 finding 으로 남는다

검증자는 결함을 드러낸다고 보는 테스트를 하나씩 임시 파일에 쓰고, 테스트마다 `<REQ-ID> AC-<n>` · 통합 항목 · `PRD-<n>` · 선언된 제약(`constraints_path` 의 항목 `id`) 가운데 하나를 인용한다. 호스트가 그 테스트를 돌려 red 인 것만 finding 으로 남기고(kept), green 인 테스트와 아무것도 인용하지 않은 테스트는 버린다(dropped). `--max` 면 두 검증자의 kept finding 을 합집합으로 합친다 — 한 검증자가 다른 검증자의 finding 을 지우지 못한다.

finding 을 닫는 길은 그 테스트를 green 으로 만드는 수정 하나뿐이다(§7). 다음 라운드의 새 검증자가 같은 결함을 다시 쓰면 그 결함은 닫히지 않은 것이다.

라운드의 기록(§5 의 `round record`)에서 행은 검증자가 쓴 테스트 하나당 하나이며 `{id, verdict, kept, evidence, verifier}` 다: red 면 `kept: true` 와 그 red 출력을 `evidence` 로, green 이거나 아무것도 인용하지 않으면 `kept: false` 다. `verifiers` 에는 그 라운드의 검증자 이름을 — 기본 하나, `--max` 둘 — 싣고, `frozenDenominator` 는 호스트가 검증자의 테스트 파일을 받은 시점에 센 테스트 수다. 라운드 도중 증분 저작이나 수정으로 요구가 늘어도 그 라운드의 범위는 늘지 않는다 — 늘어난 요구는 다음 라운드의 검증자가 받고, 그 라운드는 무효가 아니다. 행에 등급 필드를 싣지 않는다 — 도구가 그런 행을 거절한다.

---

## 5. 종료 조건 — kiwi-wave-master §5.5.4 에서 이동

새 검증자가 red 테스트를 하나도 쓰지 않았고 그 라운드에 수정이 적용되지 않은 라운드에서만 통과한다. 통과 조건은 kept finding 0, 그 라운드에 적용한 수정 0, 회귀의 신규 실패 0 이다 — 회귀는 `failing_tests ⊆ baseline_failing_tests` 이고, 기준선 **캡처에 실패**해 `baseline_failing_tests` 가 없으면 `exit_code`=0 으로 격하된다.

| 모드 | PASS |
|---|---|
| Normal | 위 통과 조건을 만족한 라운드 하나 — **그 라운드에서 수정이 적용되지 않았을 것** |
| `--max` | 위 통과 조건을 만족한 라운드가 **3라운드 연속** (etc 프로파일) |

`--max` 는 이 조건을 **3라운드 연속** 요구한다 — etc 호스트는 `../_shared/kiwi/local-llm-profile.md` 가 **3연속 무개선**을 요구하고 `--max` 가 기본값이기 때문이다. 엔진 `orchestrate round record` 는 `--max` 스트릭 2 에서 `pass` 를 돌려주므로, etc 는 그 `pass` 라운드 뒤에 한 라운드를 더 돌고 그 라운드도 `pass` 일 때만 `complete` 를 쓴다. **스트릭 요구치는** Normal **1** 라운드, `--max` **3** 라운드다.

**수정이 적용되지 않은 라운드**에서만 통과한다는 조항이 저비용 상한을 안전하게 만든다 — 검증자가 읽은 적 없는 상태에 PASS 를 찍는 것을 막고, 수정이 있었다면 반드시 재검증 라운드가 돌게 한다.

라운드 상한(`../_shared/kiwi/loop-option.md` v1.0): 기본 **5**, `--max` **8**, `--mini` 3. `--mini` 와 `--loops N` 동시 지정 시 **`--loops` 우선**(비치명 **WARN**). 단 etc 는 `--max` 가 기본이므로 `--mini`/`--loops` 미지정 시 실효 상한은 **8** 이고(명시 `--loops N` 은 그대로 우선한다), 위 표의 Normal 행은 etc 에서 **단독 종료 조건으로는 쓰이지 않는다** — `--max` 행이 참조하는 구성요소로만 남는다. 프로파일이 `--max` 를 끄는 수단을 제공하지 않으므로 Normal 행 단독으로 종료하는 경로가 없다.

재개 시점에 **남은 라운드**(`cap - rounds`)가 그 모드의 **스트릭 요구치**보다 작으면 PASS 가 산술적으로 불가능하므로, 라운드를 더 돌지 않고 `fail-cap` 으로 기록하고 사용자 결정을 받는다.

**cap 소진은 PASS 가 아니다.** 상한에 닿으면 verdict 를 `fail-cap` 으로 기록하고, `complete` 를 append 하지 않으며, kept finding 을 **전량** 보고한 뒤 사용자 결정을 받는다. 상한은 무한 에스컬레이션을 멈출 뿐 결함을 은폐하지 않는다.

kept finding 을 남긴 채 상한 전에 끝난 경우 — 교차 wave HALT, 사용자 중단, 코드로 닫을 수 없는 요구 수준 잔여 — 는 `fail-residual` 이고, 그때는 호출자의 `fail-residual` 게이트로 중단해 사용자 결정을 받는다. 통과한 라운드가 이월이나 재진입으로 넘긴 항목을 `residual` 에 남기는 것은 `pass` + `residual` 이며 사용자 결정을 받지 않는다.

**이 표의 PASS 조건을 손으로 대조하지 않는다.** 라운드마다 MCP `orchestrate_round_record` 로 그 라운드의 verdict 를 받는다 — CLI 대체는 `speckiwi orchestrate round record --run-id <id> --payload <payload> --proof <payload>` 이고, 그 한 호출이 kept 행 · 그 라운드의 수정 적용 여부 · 회귀 부분집합 · 검증자 수 · 스트릭과 cap 을 함께 판정해 저널 줄을 만든다. 라운드 scope 가 닫힌 어휘 밖이거나 선언한 loop 의 것이 아니면 그 호출이 `invalid-run-scope-option` 으로 거절한다. `--proof` 에 실을 증명의 종류는 `waves-event.md` 의 `proof_kind` 가 정하고, 저널 밖에서 재계산되는 종류를 하나도 싣지 않은 라운드 줄은 같은 호출이 `run-invariant-drift` 로 거절한다.

저널을 되읽는 것으로 이 호출을 대신할 수 없다. 저널 검사는 착지한 줄의 일부 규칙만 보며, 수정이 적용된 라운드인지를 담는 필드가 저널에 없어 위 표의 그 조항은 저널 쪽에서 구조적으로 판정되지 않는다.

---

## 6. 진동(oscillation) 감지

같은 `finding_id` — 같은 결함을 드러낸 red 테스트 — 가 **2 라운드 이상**에 걸쳐 닫혔다가 다시 열리거나(green 이 되었다가 다시 red), 같은 hunk 가 되돌려졌다가 다시 적용되면 수정이 진짜로 충돌하는 중이고 라운드를 더 돌아도 얻는 것이 없다. cap 을 태우지 말고 **즉시 종료한다** — `verdict` 를 `fail-residual` 로, `reason_class` 를 `"oscillation"` 으로 기록하고 `verification-oscillation` 을 critical 로 올린다.

진동은 cap 소진과 **다른 사건**이다 — cap 소진은 라운드를 다 쓴 결과이고 진동은 라운드를 더 써도 수렴하지 않는다는 증거이므로, 진동을 `fail-cap` 으로 기록하지 않는다. 진동으로 끝난 루프는 cap 을 소진하지 않았어도 `complete` 를 append 하지 않는다.

---

## 7. 개선 위임 (수정 주체) — kiwi-wave-master §5.5.5 에서 이동

본 스킬은 상위 오케스트레이터이므로 **전용 fixer 를 신설하지** 않는다 — 직접 요구사항을 저작하거나 코드를 구현하지 않는다는 본 문서 서두의 성격을 유지한다. 수정은 kept finding 의 종류로 라우팅한다.

| finding 종류 | 처리 |
|---|---|
| kept 코드 결함 | `kiwi-review-fix-loop` 위임. **명시 범위**(`--base`/`--head` 또는 `--commits`)를 함께 전달한다 — 그 wave 의 작업이 이미 커밋됐으면 working-tree diff 가 비어 clean 오보가 난다 |
| kept 요구 갭 | wave 의 요구(와 있으면 SDS)가 덮지 않은 것 — `srs_deltas[]` 와 같은 모양의 델타로 `wave-srs-registration.md §2` 의 증분 저작에 넣는다(FR-FLOW-218). 새 요구는 `wave-decomposition.md §6` 대로 배치되고, 현재 wave 의 요구를 고친 것이면 그 wave 의 **재진입** — 갭의 `--req-filter` 범위로 원래 워커가 아닌 새 워커를 띄운다(`parallel-waves.md` PW-13) |
| 기계 검사의 테스트 우선 · 보존 실패 | 그 wave 의 **재진입** — 그 요구의 `--req-filter` 범위로 새 워커를 띄운다 |
| 코드로 닫을 수 없는 요구 수준 finding (증거 부재 등) | `residual` 로 이관 + 사용자 결정 |
| **이전 wave** 의 완료 target 을 건드려야 하는 것 | `wave-verify-cross-wave-fix-required` critical HALT (§0.G) |
| feasibility 단계가 draft 로 남긴 REQ | 그 REQ 만 `--req-filter` (`<REQ-ID[,…]>`) 로 지정해 `$kiwi-srs-feasibility` 재실행 후 스케줄링 단계부터(`--sds` 면 SDS 작성 단계부터) 재진입; 승급 실패 시 `reason_class="draft-stability-skip"` 로 residual |

kept 테스트는 고친 뒤 그 wave 의 회귀 테스트로 커밋한다 — 임시 파일에 남은 테스트는 다음 wave 가 같은 결함을 다시 만들어도 잡지 못한다.

**금지**: fixer 는 **AC 본문**을 수정하지 않는다. 기존 **테스트를 약화하거나 삭제**하지 않는다(`kiwi-coder §0.20` 확장 — 판정 기준은 그 절의 closed list 를 그대로 따른다). 검증자가 쓴 red 테스트를 지우거나 고쳐 green 으로 만들지 않는다. 결함을 고치는 대신 기준을 낮추는 것이 이 루프에서 가장 값싼 우회로이므로 셋 다 명시적으로 막는다.

`kiwi-review-fix-loop` **자신의 PASS 는 wave 게이트를 충족하지 않는다** — wave 수준 finding 은 그 red 테스트가 green 이 되고 다음 라운드의 새 검증자가 red 테스트를 쓰지 않을 때만 닫힌다. 그렇지 않으면 "하위 루프가 TASK_DONE 을 반환했으니 wave 검증도 통과"라는 다른 게이트의 판정으로 이 게이트를 대신하는 우회가 열린다.

wave 재진입은 명시 범위를 함께 전달한다 — **미해소 요구사항 필터**(그 라운드에 kept finding 이 남은 REQ 목록)를 `--req-filter` 로, 재진입 단위 id 를 kiwi-pm `--run-id {run_id}-wave-{n}-r{m}` 로 넘긴다(`parallel-waves.md §3`). `--sds-id` 는 이미 `--sds` 로 opt-in 한 run 에서만 더한다 — 그때 기존 sds-id 를 **재사용**하는지 여부를 `--sds-id` 로 넘기며, 중단된 재진입을 이어갈 때만 그 id 를 재사용한다. opt-in 없는 run 의 재진입은 SDS 인자를 붙이지 않는다. 범위 없이 재진입하면 이미 통과한 요구까지 다시 돌아 한 라운드의 비용이 wave 전체로 불어난다. 재진입의 수정은 원래 워커가 아니라 새 워커나 독립 서브에이전트가 한다.

증분 저작이 완료된 이전 wave 의 target 을 건드려야 하면 `wave-verify-cross-wave-fix-required` 게이트가 그대로 적용된다 — 재진입 경로가 완료 불가역성을 우회하는 통로가 되지 않게 한다.

하위 스킬이 **skip·보류한 REQ** 는 `verification.residual` 에 `reason_class` 와 함께 올라온다 — 부분 진행은 기록으로 드러나야 하고, 드러나지 않으면 다음 wave 가 그것을 완료로 딛고 선다.

---

## 8. 교차 wave 이월 — kiwi-wave-master §5.5.7 에서 이동

교차 wave 여부는 finding 이 건드리는 **파일 집합**으로 **기계적**으로 판정한다 — 서술적 판단이 아니다. 그 파일 집합이 이전 wave 의 기록된 REQ 의 **코드 trace 앵커** 또는 **이전 wave 의 diff 파일 집합**과 교집합을 가지면 교차 wave 다.

이전 wave 의 **요구사항을 바꿔야** 하는 finding 도 이월을 먼저 시도하고, 남은 wave 와 신규 wave 양쪽이 **모두 불가능할 때에만** HALT 한다 — 완료된 target 을 되돌리는 일이기 때문이다.

이전 wave 가 만든 **코드를 바꿔야** 하는 finding 은 남은 wave — 아직 dispatch 하지 않은 노드(`wave-decomposition.md §6`) — 의 scope 로 이월한다. 남은 wave 가 없으면 §0.5 예외에 따라 새 wave 를 추가하고 거기로 이월한다.

이월은 `cross_wave` = true 와 `carried_into` = 이월한 wave id 로 `verification.residual` 에 남긴다. 이월은 이전 wave 의 `complete` 이벤트를 수정하거나 되돌리지 않는다 — 저널은 append-only 이고, 되돌림은 §0.6 재개 규약을 무너뜨린다.

HALT 는 **양쪽 carry-forward 경로**가 **모두 불가능할 때만** 쓴다. HALT 는 교차 wave finding 에 대한 **첫 대응이 아니다** — 첫 대응은 이월이고, 이월할 곳이 없을 때에만 사람에게 올린다.

---

## 9. 연구 산문은 이 루프의 대상이 아니다

**연구 문서에는 이 루프를 돌리지 않는다.** 읽어서 입력으로 삼는 것은 되지만, 검토 지적을 근거로 **고치지 않는다.**

연구 문서는 **미검증 작업 노트**다(`FR-FLOW-137`). 루프가 그것을 다듬으면 문장이 매끄러워질 뿐인데 읽는 사람에게는 **검증된 것처럼** 보이게 되고, 다음 사람이 그것을 사실로 딛고 선다. 무엇이 참인지는 라운드가 아니라 코드를 돌려 봐야 갈리며, 그 확인은 그 문서가 요구가 될 때 어차피 다시 한다.

`docs/research/{work}/` 아래의 **append-only 저널과 lock**(`*.jsonl` · `*.lock` · `*.lock.json` · 재개 카드)은 **되돌려 쓰지 않는다.** 되돌린 한 줄은 오류를 내지 않은 채 다음 재개에서야 터진다.

같은 디렉터리의 **산문 아티팩트**는 다르다. 호출자가 자기 intake 나 설계 문서를 **다시 저작하는 것**은 이 절이 막는 일이 아니며, `kiwi-orchestrator` 의 `pure-reauthor` 복구가 정확히 그 동작이다. 이 절이 금지하는 것은 **검토 지적을 근거로 남의 연구 노트를 다듬는 것**이지, 저작자가 자기 초안을 다시 쓰는 것이 아니다.

---

## 10. 산문 델타 리뷰 — 검증 장부

리뷰 범위에 산문 문서(`.md` 등)가 들어오면 라운드마다 문서 전체를 다시 읽지 않는다. heading 섹션 단위 해시 장부 `kiwi/verification-ledger.jsonl` 로 바뀐 섹션만 골라 검증자에게 넘긴다. 장부는 라운드를 가로질러 남아야 하므로 run 단위 세션 상태(`.kiwi/`)나 도구 소유 경로(`docs/.kiwi/`)에 두지 않는다.

- **라운드 1 은 델타를 쓰지 않는다** — 문서 전량을 검증자에게 넘긴다. 한 번도 읽히지 않은 섹션이 clean 으로 남는 경로를 만들지 않기 위해서다.
- **라운드 2 이상**: `speckiwi workflow verification-ledger plan --doc <path> --round <n> --json` 이 dirty 섹션만 돌려준다. `sections[].payload` (섹션 본문 + 전후 문맥) 가 검증자 입력이고, **clean 섹션은 검증자에게 보내지 않는다**.
- **검증 직후 기록**: 검증자가 한 섹션을 읽고 판정을 끝내면 `speckiwi workflow verification-ledger record --doc <path> --section "<heading path>" --verifier <id> --round <n>` 을 호출한다. 해시는 도구가 문서에서 직접 계산한다 — 에이전트가 적어 낸 해시는 증거가 아니다.
- **무매칭 키는 항상 dirty** — 이름이 바뀌거나 쪼개진 heading 은 장부와 매칭되지 않으며, 그때는 재검증 쪽으로 fail open 한다. 치르는 값이 토큰인 쪽을 고르고 거짓 신뢰인 쪽을 고르지 않는다.
- **고아 정리**: heading 이 사라진 장부 항목은 `plan` 이 패스마다 정리한다. 정리도 append 로 기록되며 기존 줄을 고쳐 쓰지 않는다.

**전체 문서 감사**: 이 루프가 PASS 를 기록하기 전 — §5 종료 조건을 만족했다고 판정하는 마감 시점에 — 이 run 에서 **1회**는 장부를 무시하고 문서 전체를 감사한다.

트리거를 호출자의 옵션에 걸지 않는 이유는 그것이 이관에서 한 번 끊겼기 때문이다. 옛 소비자의 close 옵션을 그대로 옮겨 적었더니 엔진에도 두 호출자에도 없는 이름이 되어, 감사가 어떤 run 에서도 발화하지 못했다. 장부가 clean 이라는 이유로 이 감사를 건너뛰지 않는다.

**알려진 한계**: 개별 섹션은 그 자체로 참이면서 바뀐 주변 맥락에서는 거짓일 수 있고, hash-clean 섹션은 다시 읽지 않는다. 따라서 이 교차 의존 결함은 구조적으로 못 잡는다 — 전체 문서 리뷰만 잡는 부류이며, 토큰 절감과 맞바꾼 것이다. 이 거래는 여기 적혀 있고 침묵으로 넘어가지 않는다.
