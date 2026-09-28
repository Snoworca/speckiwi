# kiwi test-sufficiency v1.0.0

모든 워크플로가 끝에서 거치는 **테스트 충분성 확인**의 절차 SSOT (FR-FLOW-186). 판정 규칙은 도구 한 곳에 있다 — CLI `speckiwi coverage --tests`(FR-NODE-210)와 MCP `check_test_sufficiency`(FR-MCP-066)는 같은 결과를 낸다. 이 문서는 **언제·어떤 범위로 부르고 결과를 어떻게 다루는지**만 정한다. 이 확인을 부르는 스킬은 이 문서를 경로로 인용하고 절차를 다시 적지 않는다.

---

## 1. 인용 규약 — 테스트가 AC 를 지명하는 방법

- **요구 AC**: 테스트의 **같은 줄**(테스트 제목)에 `<REQ-ID>` 와 `AC-<n>` 을 함께 적는다. 예: `it("FR-AUTH-003 AC-2 — 만료 토큰을 거부한다", …)`.
- **SDS 계약**: SDS Test Plan 행이 지명한 테스트 파일 안에서, 테스트 줄에 `SDS-AC-<n>` 을 적는다.
- 한 테스트가 둘 다 검증하면 한 줄에 둘 다 적는다.
- 코드의 `@req` 주석은 이 확인의 입력이 아니다 — FR-FLOW-020 AC-3 의 면제는 그대로다.

---

## 2. 호출 지점과 범위 — 범위는 호출자가 고정한다

확인은 범위를 스스로 고르지 않는다. 호출자가 아래 표대로 범위를 정해 넘기고, 범위 밖 요구의 인용 공백은 보지 않는다(FR-NODE-210 AC-5).

| 호출자 | 언제 | 범위 |
|---|---|---|
| `kiwi-review-fix-loop` | 마지막 검증 단계 — 요구 범위가 알려졌을 때(`--close-reqs`, `--req-filter`, `--sds`) | `--close-reqs` 면 `eligible`, 아니면 `--req-filter` 의 ID, 둘 다 없으면 `--sds` 로 받은 lite SDS 한 파일이 `@req` 로 지명한 ID. SDS 가 있으면 `--sds` 를 함께 넘긴다 |
| `kiwi-tdd` | `promote_step_requirement` 직전 | step 요구 ID + `--sds docs/spec/steps/<task>/design.md` |
| `kiwi-srs-sync` | `verified` 를 쓰기 직전 | 이번 실행이 `verified` 로 쓰려는 요구 |
| `kiwi-hot-fix` | `kiwi-srs-sync` 에 위임하기 직전 | root-cause 가 `match_confidence=high` 로 매핑한 요구 |
| `kiwi-orchestrator` | wave 의 요구 승급 단계 직전(`parallel-waves.md` PW-14) | 그 wave 의 배정 요구 + 그 wave 의 SDS 파일마다 `--sds` |
| `kiwi-orchestrator` | 모든 rung 의 종료 코드 리뷰 홉 뒤 | 그 rung 의 요구 범위 — step rung 은 `--sds docs/spec/steps/<task>/design.md` 를 더한다. wave SDS 는 넘기지 않는다: 요구가 모두 승급된 wave 의 SDS 는 그때 close-out 이 이미 삭제했다(FR-FLOW-183 AC-3) |
| `kiwi-pipeline` | 사이클의 종료 코드 리뷰 홉 뒤, SDS 삭제 전 | 그 사이클의 요구 범위 + 그 SDS — 여러 파일로 나뉘었으면 파일마다 `--sds <그 파일>` 로 한 번씩 |
| `kiwi-pipeline` | SDS 가 여러 파일로 나뉘었을 때 승급하는 `--close-reqs` 홉 앞 | 파일마다 그 파일의 `Requirements` ID + `--sds <그 파일>` |
| `kiwi-wave-master` | 설계 적합 검증 리뷰 뒤, wave 의 승급 직전(`parallel-waves.md` PW-14) | 그 wave 의 배정 요구 + 그 wave 의 SDS 파일마다 `--sds` |
| `kiwi-wave-master` | run 의 종료 코드 리뷰 홉 뒤 | 그 run 의 요구 범위만 — 요구가 모두 승급된 wave 의 SDS 는 그때 close-out 이 이미 삭제했다(FR-FLOW-183 AC-3) |

범위에 요구 ID 가 하나도 없으면 확인은 돌지 않고 결과는 `no-scope` 다. `no-scope` 는 통과가 아니다 — 보고서에 그대로 적는다.

---

## 3. 절차

1. 범위를 넘겨 도구를 부른다. 호출자의 MCP 규칙을 따른다 — MCP 가 있으면 `check_test_sufficiency` 이고, CLI 는 그 스킬이 MCP 부재 시 CLI 를 허용할 때만 쓴다:
   ```
   speckiwi coverage --tests --ids <id,...> --sds <path> --json
   speckiwi coverage --tests --target <t> --sds <path> --json
   ```
   `--sds` 는 SDS 가 있을 때만 넘긴다. gap 목록은 **도구 출력**이다 — 에이전트가 테스트를 읽고 gap 을 판정하지 않는다.
   **워크트리에서 도는 호출자는 그 워크트리를 읽게 한다** — `parallel-waves.md` 의 워커처럼 linked worktree 에서 이 확인을 부르면 MCP `check_test_sufficiency` 에 `workspaceRoot` = 그 워크트리 절대 경로를 주고, CLI 면 그 워크트리를 cwd 로 부른다. 호스트 root 에 묶인 MCP 는 워커가 방금 쓴 테스트를 보지 못해 없는 공백을 보고하고, 3번의 채우기가 워크트리에 테스트를 더해도 4번의 재실행이 여전히 호스트를 읽어 없는 공백이 닫히지 않는다. 3번의 채우기도 같은 워크트리에서 쓴다.
   linked worktree 를 호출 단위 `workspaceRoot` 로 지명해 부를 때 MCP 는 `docs/spec` 아래를 가리키는 `sds` 인자(step `design.md`)를 거부한다(FR-MCP-064 AC-7) — step 확인을 그렇게 해야 하면 이 한 번은 MCP 규칙의 예외로, 그 워크트리를 cwd 로 CLI `speckiwi coverage --tests` 를 돈다. `docs/sds/` 의 lite SDS 는 거부되지 않는다.
2. gap 이 없으면 결과는 `pass` 다. 여기서 끝난다.
3. gap 이 있으면 **테스트 작성 서브에이전트 하나**를 띄운다. 입력은 gap 목록(요구 ID·AC 번호·AC 본문, SDS-AC 와 그 Test Plan 행이 지명한 파일)과 관련 코드 경로다. 서브에이전트는 빠진 `<REQ-ID> AC-<n>` / `SDS-AC-<n>` 을 테스트 줄에 인용한 테스트를 **더한다**. 기존 테스트를 지우거나 약화하거나 고치지 않는다. 프로덕션 코드를 고치지 않는다. 더한 테스트를 실행한다 — 현재 코드에서 실패하는 새 테스트는 고치지도 지우지도 않고 결함으로 보고하며, 그 테스트가 인용한 AC 는 5번에서 gap 으로 센다. 호출자는 채우기 diff 가 새 테스트만 더했는지 diff 로 확인한다 — 기존 테스트 줄의 삭제·수정, 프로덕션 파일 변경, mock 이 하나라도 있으면 그 diff 를 인용 근거로 쓰지 않고 결과를 `gap` 으로 적는다. 자기 스킬에 보존 스캔이나 mock 검사가 있으면 그것도 이 diff 에 적용한다.
4. 같은 범위로 도구(`check_test_sufficiency` / `speckiwi coverage --tests`)를 다시 부른다.
5. gap 이 남으면(3번에서 실패한 새 테스트가 인용한 AC 포함) 게이트 `test-sufficiency-gap` 을 올린다 — critical 이고 `--auto` 도 풀지 못한다. gap 이 남은 요구는 `verified` 로 쓰지 않는다.

채우기(3)는 한 번뿐이다. 3 → 4 를 반복하지 않는다.

호출자가 아무것도 쓰지 않는 실행(`--dry-run` 등)이면 3·4번을 하지 않고 1번 결과를 그대로 보고한다 — 막을 `verified` 쓰기가 없으므로 게이트도 올리지 않는다.

도구를 부를 수 없거나(MCP·CLI 모두 실패, `--tests` 를 모르는 구버전) 결과 대신 오류(`ok: false`, 0 이 아닌 종료 — 범위의 요구나 SDS 를 받지 못한 경우 포함)를 돌려주면 확인하지 못한 것이다 — 결과를 `gap` 으로 적고 같은 게이트를 올린다.

---

## 4. `verified` 를 쓰는 호출자 — 인용이 곧 테스트 식별자다

`verified` 를 쓰는 호출자는 이 확인을 증거 등록보다 **먼저** 돌린다. 그리고 도구가 AC 마다 돌려준 인용(테스트 파일 경로와 줄)을 그 AC 를 통과시킨 테스트 식별자로 쓴다 — `add_verification_evidence` 는 AC 마다 한 행이고 `covers` 는 그 AC, notes 에는 그 인용(파일과 줄)을 싣는다. `reference` 는 그 AC 를 통과시킨 실행이다: run 전체를 한 명령으로 pin 한 호출자(`parallel-waves.md` 의 `verification_cmd` — `kiwi-orchestrator` · `kiwi-wave-master`)는 그 `verification_cmd` 이고(FR-FLOW-087 AC-7, 수확한 증거 번들 경로는 detail 로서 notes 에 더한다), 그런 명령이 없는 호출자는 인용한 테스트 파일이다. 에이전트가 AC 마다 테스트를 지목하지 않는다. 인용이 없는 AC 는 체크하지 않는다. 3번에서 실패한 새 테스트의 인용은 쓰지 않는다. 한 AC 에 인용이 여럿이면 실행되는 테스트의 제목 줄을 고른다.

**인용은 통과한 테스트여야 한다** — 도구는 인용을 읽을 뿐 테스트를 실행하지 않는다. 그래서 `verified` 를 쓰는 호출자는 증거로 쓸 인용의 테스트 파일을 증거 등록 전에 실행하고, 그 실행에서 통과한 테스트의 인용만 증거로 쓴다. 실패했거나 skip 되었거나 실행되지 않은 테스트의 인용은 그 AC 를 gap 으로 남기고, gap 이 남으면 §3 의 5번처럼 `test-sufficiency-gap` 을 올린다.

---

## 5. 결과 기록

호출자는 결과를 산출물에 `test_sufficiency` 로 남긴다.

```json
{ "verdict": "pass|gap|no-scope", "scope": { "ids": [], "target": null, "sds": null }, "gaps_first": [], "fill": { "attempted": false, "tests_added": [], "failing_new_tests": [] }, "gaps_final": [] }
```

오케스트레이션 스킬(`kiwi-pipeline` · `kiwi-wave-master` · `kiwi-orchestrator`)의 최종 보고는 이 `verdict` 를 적는다.

---

## 6. 게이트 선언

공유 문서는 게이트를 대신 선언하지 못한다. 이 확인을 부르는 스킬은 자기 `critical_gates[]` 에 `test-sufficiency-gap` 행을 선언한다.

---

## 7. 이 확인이 보장하지 않는 것

인용은 이름이다. 이 확인은 "범위 안의 모든 AC·SDS-AC 에 그것을 지명한 테스트 줄이 있다" 까지만 보장한다. 테스트가 옳은지는 red 선행(TDD)과 회귀 통과가 맡고, 테스트가 실제로 실행·통과했는지는 §4 의 실행(`verified` 를 쓰는 호출자가 증거로 쓸 인용의 테스트 파일)과 §3 의 3번 실행(채우기로 더한 테스트)이 맡는다. `verified` 를 쓰지 않는 호출자의 `pass` 는 인용이 있다는 뜻까지다.
