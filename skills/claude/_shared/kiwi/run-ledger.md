# kiwi run-ledger v1.0.0

한 run 이 **컴팩션(compaction)을 넘어 살아남게** 하는 원장(ledger) SSOT. 재개 카드 schema 와 상한, 닫힌 verb enum 과 세 가지 recovery class, write-ahead-intent / write-behind-result 쓰기 규율, 증거 종류(proof kind) 표, 대조(reconciliation) 술어, 네 가지 드리프트 다이제스트, run-contract 서문 규약을 규정한다.

원장이 없으면 **중단된 동작과 시작되지 않은 동작을 구분할 수 없다** — 재개한 세션은 외부에 보이는 동작을 다시 실행하거나, 끝난 적 없는 동작을 건너뛴다.

본 계약 안의 `§n` 은 이 파일의 절을 가리킨다. 다른 문서의 절을 참조할 때는 **문서명을 함께 적는다**(`waves-event.md §4`, `verify-loop.md §5`).

---

## 1. 재개 카드(resume card) — schema 와 상한

`{git_root}/kiwi/orchestrator/{run_id}/resume-card.json`. 체크포인트마다 **전체를 다시 쓰며 append 하지 않는다**. **하드 상한 8 KB 이고 이 상한은 기록자가 강제한다** — 상한이 없는 카드는 두 번째 저널로 퇴화한다.

상한을 구조적으로 도달 가능하게 만드는 것이 **rollup 규칙**이다.

> `done[]` 은 **완료된 wave 당 1개** 항목에 run 수준 마일스톤을 더한다. lane 수준 항목은 **현재** wave 에 대해서만 남기고 그 wave 가 완료되면 wave 항목으로 접는다: `waves(8) + milestones(6) + lanes_in_current_wave(8) = 22` 항목.
> `open[]` 은 **현재 단계**의 lane 당 최대 1개 항목: 8 항목 × 약 180 바이트 ≈ 1.5 KB.
> `frozen.lane_lock` 은 **현재 wave 의 것만** 남긴다 — 완료된 wave 의 lane lock 은 그 `done[]` 증거와 저널에서 도달 가능하므로 맵을 wave 를 가로질러 보관하면 얻는 것 없이 무한히 자란다.
> 설계상 최대치의 합계는 약 **5.5 KB** 로 8 KB 상한 안에 여유를 두고 들어간다. 상한은 **산술이 아니라 측정**으로 강제하며, 산술은 상한에 닿는 일이 정상 성장이 아니라 버그임을 뜻하게 하려고 존재한다.

```json
{
  "schema_version": "1.0.0",
  "run_id": "2026-08-02.speckiwi.v260",
  "run_contract": "docs/research/v260-orchestrator/00.run-contract.md@sha256:9f1c…",
  "position": { "wave": 2, "stage": 2, "phase": "execute" },
  "next_action": { "verb": "execute-unit", "args": { "wave": 2, "stage": 2, "lane": "lane-3" },
                   "preconditions": ["P-DESIGN-FROZEN","P-LANE-PLAN-FROZEN",
                                     "P-HANDOFF-VERIFIED","P-WAVE-ISSUES-CLOSED",
                                     "P-PRIOR-STAGES-INTEGRATED"] },
  "frozen": {
    "engine": "kiwi-orchestrator",
    "work_root": "docs/research/v260-orchestrator/",
    "journal": "kiwi/waves.jsonl",
    "run_root": { "git_toplevel": "…", "mcp_workspace_root": "…" },
    "isolation_profile": "none-serial",
    "proof_strength": "strong",
    "route": { "rung": "R-ORCH", "lock": "…/routing/route.lock.json@sha256:8c0d…",
               "probe_digest": "sha256:2e91…" },
    "base_branch": "feat/2.3.0.1",
    "integration_branch": "kiwi/orch/2026-08-02.speckiwi.v260/integration",
    "integration_base_sha": "9a01f3c…",
    "design_lock": "…/design/00.design.lock.json@sha256:4ab0…",
    "waves_lock": "…/waves/waves.lock.json@sha256:c17e…",
    "constraints": "…/design/constraints.json@sha256:11de…",
    "convergence": "…/design/convergence-registry.json@sha256:77d2…",
    "lane_lock": { "wave-2": "…/waves/wave-2/lanes.lock.json@sha256:5b3a…" },
    "counts": { "design_items": 41, "integration_items": 6, "constraints": 6, "waves": 4 },
    "regression_baseline": { "command": "npm test -- --no-file-parallelism",
                             "head_sha": "9a01f3c…", "failing_tests": [] }
  },
  "done": [
    { "key": "wave-1", "proof": { "kind": "journal", "ref": "waves.jsonl#L18 status=complete verdict=pass" },
      "witness": { "kind": "git-trailer", "ref": "b71c904 Orch-Run=… Orch-Wave=1" } }
  ],
  "open": [
    { "key": "wave-2/s2/lane-3", "state": "executing",
      "base_sha": "e4f5a6b…", "head_sha": "7bd41f0…", "journal_line": 44 }
  ],
  "blocked_on": null,
  "invariant_digest": "sha256:…over the frozen block…",
  "written_at": "2026-08-02T09:12:44.201Z"
}
```

카드를 지탱하는 네 가지 성질:

1. **`next_action.verb` 는 닫힌 enum(§3) 에서 나오고 `preconditions[]` 도 닫힌 enum 이다.** 재개한 에이전트는 무엇을 할지 **정하지 않고 verb 를 읽는다**. precondition 어휘는 정확히 다섯 값이며 각각 평가자가 명시되어 있다.

   | 값 | 참인 조건 |
   |---|---|
   | `P-DESIGN-FROZEN` | `frozen.design_lock` 이 가리키는 lock 의 재계산 다이제스트가 일치 (§6 다이제스트 1) |
   | `P-LANE-PLAN-FROZEN` | `frozen.lane_lock[wave-{n}]` 이 가리키는 lock 의 재계산이 일치 (§6 다이제스트 3) |
   | `P-HANDOFF-VERIFIED` | 그 lane 의 `lane-{k}.lock.json` 이 존재하고 다이제스트 4 가 일치하며, 저널에 그 lane 의 `verify-handoff` result 가 verdict `pass` 로 있음 |
   | `P-WAVE-ISSUES-CLOSED` | 직전 wave 의 이슈 종결 명령이 `ok` 를 반환 |
   | `P-PRIOR-STAGES-INTEGRATED` | 이 wave 의 더 앞선 모든 stage 의 모든 lane 이 **정산됨**: `frozen.integration_branch` 에 대한 증거를 갖거나, 저널에 종결 `lane_disposition` 이 있음 |

2. **`done[]` 의 모든 항목은 proof 를 지니며, 모든 항목의 증거는 저널 없이도 재계산 가능하다**(§4). 항목은 `witness` 를 추가로 지닐 수 있다. **`proof.kind` 가 `journal` 인 `done[]` 항목에는 `witness` 가 필수이고 그 `kind` 는 `journal` 일 수 없다** — 저널이 잘렸을 때 그 항목을 재계산 가능하게 유지하는 것이 witness 이고, 저널 절단이야말로 카드가 살아남으라고 존재하는 사건이다.
3. **`invariant_digest`** 는 `frozen` 블록 위에서 계산해 조용한 설계 드리프트를 시끄럽게 만든다 — 디스크의 lock 파일에서 재계산하며, 불일치는 `run-invariant-drift` 다.
4. **`isolation_profile` · `engine` · `work_root` · `run_root` · `base_branch` · `integration_branch` · `route` 는 `frozen` 안에 있어 `invariant_digest` 가 이들을 덮는다.** 재개 시 rung 은 **lock 에서 읽고 재계산하지 않는다** — 재개한 세션에는 대화도 조사자도 없고 probe 필드 일부는 서브에이전트 산출이라 컴팩션을 가로질러 재현되지 않으므로, 재계산은 합법적으로 다른 rung 을 낼 수 있다.

카드는 **파생물**이다. 카드가 저널과 어긋나고 저널이 상위집합이면 카드를 재생성하고 run 을 계속한다(`card-stale`). 그 밖의 모든 불일치는 중단한다(§5).

---

## 2. 쓰기 규율 — write-ahead intent / write-behind result

verb 마다 세 번 쓴다. **동작 앞에 의도(intent) 1줄, 동작 뒤에 결과(result) 1줄**이다.

```
1. journal append  {event:"intent", verb, run_id, engine, wave, lane?, inputs_digest}
2. …verb 수행…
3. journal append  {event:"result", verb, …, outputs, proof, card_digest}
4. card write      (전체 재작성, 상한 검사, 검증)
```

재개한 세션이 가장 먼저 평가하는 불변식:

> **현재 run 에서 `(verb, wave, lane)` 키마다 마지막 줄은 `result` 여야 한다. 짝 없는 `intent` 는 그 verb 가 중단되었다는 뜻이다.**

저널 append 와 카드 쓰기는 **도구를 거친다** — 에이전트가 JSONL 을 손으로 이어붙이지 않는다.

---

## 3. verb enum 과 세 가지 recovery class

**닫힌 enum** 이다. 각 verb 는 세 recovery class 중 **정확히 하나**를 선언하며, 이것이 "중단됨"을 "시작되지 않음"과 구분 가능하게 만든다.

`recovery_class` 의 멤버는 정확히 `pure-reauthor` · `idempotent-by-key` · `externally-visible` 셋이다.

| verb | class | 중단 시 복구 규칙 |
|---|---|---|
| `create-integration-branch` | externally-visible | `git rev-parse --verify {frozen.integration_branch}` — 있으면 채택, 없으면 `--base-branch` 에서 생성 |
| `commit-run-artifacts` | externally-visible | `Orch-Run` + `Orch-Verb: commit-run-artifacts` trailer 를 단 커밋을 `git log` 에서 확인 |
| `intake-qna` | pure-reauthor | 다시 수행. 이미 받은 답은 입력이지 반복이 아니다 |
| `intake-document` | pure-reauthor | 다시 수행 |
| `intake-issue` | externally-visible | 이슈 조회는 읽기지만 리서치 스킬이 노트를 남겼을 수 있다 — `docs/research/` 와 그 스킬 이벤트를 먼저 확인 |
| `intake-investigate` | pure-reauthor | 다시 수행 |
| `probe-route` | idempotent-by-key | `routing/probe.json` 키. **`pure-reauthor` 가 아니다** — 서브에이전트 산출 필드는 재현되지 않아 재수행이 다른 rung 을 낼 수 있다. 복구는 **저장된 probe 를 읽고 다시 판정하지 않는다** |
| `freeze-route` | idempotent-by-key | 내용 주소화. 다이제스트가 같으면 재수행은 무동작. 재수행은 분류기의 제안이 아니라 **기록된 override 를 재현한다** |
| `dispatch-route` | externally-visible | 자식이 변경한다. 자식의 `pipeline.jsonl` 이벤트를 먼저 확인한다. **살아 있을 수 있는 자식을 다시 dispatch 하지 않는다** |
| `escalate-route` | externally-visible | lock 을 다시 쓰고 작업을 `out_of_scope` 로 봉인할 수 있다. `list_requirements` 와 최신 `freeze-route` result 를 먼저 확인 |
| `downgrade-route` | externally-visible | **새** `route.lock.json` 을 §6 의 append-new-artifact 규칙대로 쓴다. 복구는 마지막으로 저널된 route lock 을 읽는다 — rung 은 읽는 것이지 재계산하지 않는다 |
| `author-design` | pure-reauthor | 다시 수행. 라운드 카운터는 누적된다 |
| `verify-design` | idempotent-by-key | 라운드 재수행 |
| `freeze-design` | idempotent-by-key | 내용 주소화. 다이제스트가 같으면 재수행은 무동작 |
| `decompose-waves` | pure-reauthor | 다시 수행 |
| `author-convergence-registry` | pure-reauthor | 다시 수행 |
| `verify-convergence-registry` | idempotent-by-key | 라운드 재수행 |
| `author-wave-design` | pure-reauthor | 다시 수행 |
| `verify-wave-design` | idempotent-by-key | 라운드 재수행 |
| `register-wave-srs` | externally-visible | `/kiwi-srs` 가 요구사항을 저작했을 수 있다. `list_requirements --target wave-{n}` 와 `srs_authored` 표식(`wave-srs-registration.md §2`)을 먼저 확인 |
| `plan-wave` | externally-visible | `/kiwi-planner` 가 계획 파일을 쓰고 trace link 를 걸었을 수 있다. `workflow_plan_status` 확인 |
| `derive-readiness` | idempotent-by-key | 새 스냅샷 위의 순수 재계산 |
| `commit-wave-inputs` | externally-visible | `Orch-Run` + `Orch-Verb: commit-wave-inputs` + `Orch-Wave` trailer 커밋 확인 |
| `freeze-lane-plan` | idempotent-by-key | 재계산. 바이트 동일하지 않으면 `lane-plan-drift` |
| `review-partition` | pure-reauthor | 다시 수행. 이전 verdict 는 입력이지 반복이 아니다 |
| `author-handoff` | pure-reauthor | 다시 수행 |
| `verify-handoff` | idempotent-by-key | 라운드 재수행 |
| `commit-dispatch-base` | externally-visible | `Orch-Run` + `Orch-Verb: commit-dispatch-base` + `Orch-Wave` + `Orch-Stage` trailer 커밋 확인 |
| `execute-unit` | externally-visible | **본 단계의 유일한 실행 verb.** 통합 브랜치 위 `Orch-Run` · `Orch-Wave` · `Orch-Stage` · `Orch-Lane` · `Orch-Task` trailer 커밋과 `workflow_plan_status` 를 확인한 뒤 재진입한다. **커밋이 이미 있는 unit 을 다시 실행하지 않는다** — 재실행은 중복 구현을 만든다 |
| `post-merge-verify` | idempotent-by-key | 라운드 재수행 |
| `wave-issue-triage` | pure-reauthor | 다시 수행. 이슈 문서는 재생성된다 |
| `resolve-wave-issues` | externally-visible | `/kiwi-review-fix-loop` 또는 사이클 재진입으로 라우팅된다. 그 저널을 먼저 확인 |
| `amend-design` | externally-visible | 새 `00.design.lock.json@sha256` 과 그 저널 줄이 있는지 먼저 확인 |
| `promote-requirements` | externally-visible | `update_status` / `add_verification_evidence`. `get_requirement` 를 먼저 확인 |
| `final-verify` | idempotent-by-key | 라운드 재수행 |
| `emit-and-finish` | idempotent-by-key | `pipeline.jsonl` 은 키 기준 멱등. 재개는 `{run_id}#r{n}` 을 키로 쓴다 |
| `abort-run` | externally-visible | 종결. `halt` 의 동의어가 **아니다** — 사용자가 남겨받는 저장소 상태를 호명해 run 보고서에 쓴다 |

`halt` 는 이 enum 의 **유일한 종결 항목**이며 recovery class 를 선언하지 않는다 — 아무 동작도 하지 않으므로 중단될 수 없다. 위 표의 모든 verb 는 종결 항목이 아니며 각각 세 class 중 하나를 정확히 하나 선언한다.

**enum 밖의 verb 는 재개 시 하드 스톱(hard stop)이다.** 재개한 세션은 모르는 verb 를 해석하지 않는다.

중단된 `pure-reauthor` · `idempotent-by-key` verb 는 게이트 없이 그냥 다시 수행한다. 중단된 **externally-visible** verb 는 재진입 **전에** 자기 행이 지정한 확인을 수행하고, 그 확인으로도 외부 효과가 해소되지 않을 때에만 `interrupted-external-action` 을 올린다. 이 게이트가 실제로 발동하면 `--auto` 라도 중단한다 — 반쯤 끝난 병합이 무엇을 했는지는 위원회가 알 수 없다.

**커밋 식별은 제목 텍스트가 아니라 git trailer 로 한다.** 위에서 `git log` 를 확인하는 verb 는 모두 `Orch-*` trailer 튜플로 거른다 — 커밋 **제목**에 단계 표식을 넣는 것이 금지되어 있고, 이 설계는 회복 장치를 그 제약을 어기고 사지 않는다.

---

## 4. 증거 종류 (proof kinds)

신뢰 순. **저널 없이 재계산 가능한** 증거의 비중을 의도적으로 최대화한다 — 저널은 잘릴 가능성이 가장 큰 아티팩트이기 때문이다.

| kind | 재계산 | 쓰이는 곳 |
|---|---|---|
| `git-ancestor` | `git merge-base --is-ancestor <head> <integration_head>` | 병합됨. 가장 강하다 |
| `git-ref` | `git rev-parse <branch>` | 커밋이 생산됨 |
| `git-trailer` | `git log --format='…%(trailers:key=Orch-Verb,valueonly)…'` | `(run, wave, stage)` 의 커밋이 존재함 |
| `digest` | lock 파일의 sha256 대 카드 | 설계 · waves · lanes · handoff · registry 고정 |
| `mcp-state` | `get_requirement(id).status`, `workflow_plan_status` | REQ 승급, 계획 저작됨 |
| `fs-exists` | 기록된 경로에 파일 존재 | 보고서, 이슈 문서 |
| `journal` | `waves.jsonl` 의 줄 번호 + 술어 | 검증 verdict — 외부 증인이 없는 유일한 주장 |

**`journal` 은 verdict 를 담은 줄의 *유일한* proof 가 될 수 없다.** verdict 를 기록하는 모든 줄 — 루프의 pass, 병합, 단위 완료 — 은 외부에서 재계산 가능한 kind(`git-ancestor` · `git-ref` · `git-trailer` · `digest` · `mcp-state`) 를 최소 하나 더 지녀야 한다. writer 스탬프는 줄이 쓰인 **경로**를 인증할 뿐 그 줄이 담은 **내용**을 인증하지 않으므로, `journal` 단독 verdict 는 증인이 전혀 없는 주장이다.

---

## 5. 대조(reconciliation) 술어

재개 도구의 두 번째 일이며, 조용한 드리프트를 게이트로 바꾸는 장치다. **비교는 하나의 `(wave, stage)` 쌍으로 스코프한다** — 전체 wave 집합을 비교하면 아직 시작하지 않은 stage 의 lane 이 분모에 들어와, 정상 진행 중인 run 이 `divergent` 로 떨어진다.

**술어는 집합 단위가 아니라 lane 단위**다. `(w,s)` 의 lane 마다 독립적으로 분류한 뒤 축약한다. lane 마다 읽는 관측은 넷이며 어느 것도 집합이 아니다.

| 관측 | 값 |
|---|---|
| `J(k)` | 그 lane 에 대한 마지막 저널 줄 |
| `B(k)` | 그 lane 이 생산한 커밋의 존재 (없음 \| sha) |
| `A(k)` | `frozen.integration_branch` 에 대한 정산 여부 |
| `D(k)` | 그 lane 의 result 줄에 기록된 `lane_disposition` (없음 \| 종류) |

축약 규칙:

- 짝 없는 `intent` 가 있으면 그 verb 는 **중단됨**이고, 그 verb 의 recovery class(§3) 가 다음 동작을 정한다.
- 카드가 분류와 어긋나면 `card-stale` — 카드를 재생성하고 계속한다. 카드는 파생물이므로 이것만 자가 치유된다.
- 저널·lock·git 이 서로 어긋나 어느 분류에도 들지 않으면 `ledger-reconciliation-divergent` 로 **중단**한다.
- `lane_disposition` 이 종결 값이면 그 lane 은 **정산된 것**이다 — 병합되지 않았다는 사실만으로 다시 실행하지 않는다. 종결 disposition 을 읽지 않으면, 설계가 반증되어 폐기된 작업을 재개한 세션이 통합한다.
- 다음 동작이 여럿이면 **가장 낮은 순위**의 lane 을 고르고, 동순위는 lane id 오름차순으로 깬다.

---

## 6. 네 가지 드리프트 다이제스트

재개마다, 그리고 모든 `freeze-*` 앞에서 검사한다.

1. `invariant_digest` 대 lock 파일 재계산 → `run-invariant-drift`.
2. 각 intent 줄의 `inputs_digest` 대 그 입력들의 현재 다이제스트. intent 와 result 사이에 입력이 바뀌었으면 그 result 는 더 이상 존재하지 않는 것에서 파생된 것이므로 그 verb 는 **신뢰하지 않고 다시 수행한다**.
3. lane plan lock 대 지금 재계산한 계획 → `lane-plan-drift`. 재계산은 **lock 이 스스로 기록한 입력**을 쓰고 오늘 구할 수 있는 입력을 쓰지 않는다 — 이것이 이 검사를 잡음이 아니라 의미 있게 만든다. 기록된 입력 다이제스트 중 산출물 경로·이전 사후분석 다이제스트만 달라진 경우는 **낡았을 뿐 틀린 것이 아니므로** 경고로 기록하고 wave 도중에 lock 을 재계산하지 않는다.
4. handoff lock 대 handoff 산문 → 재검증. 검증 뒤 손으로 고친 handoff 는 lane 이 무엇을 하라고 들었는지를 조용히 바꾼다.

**정당한 수정(amendment)은 append-new-artifact 규칙으로 드리프트와 구분한다** — 후발 제약, remediation 뒤의 재계획, 접어 넣은 이슈, wave 도중의 설계 수정은 **새 아티팩트 + 새 저널 줄**로 쓰고 **제자리에서 고치지 않으며**, 해소는 언제나 최신 포인터를 읽는다. 그래서 `freeze-lane-plan` 은 **새로 저널된** lock 을 현재 것으로 받아들이고, `lane-plan-drift` 는 디스크의 lock 이 그 lock 이 스스로 호명한 입력 위의 재계산과 어긋날 때에만 발동한다.

---

## 7. run-contract 서문 규약

`00.run-contract.md` 는 Phase 0 에 만들고 **정확히 두 지점**에서만 수정하는 짧은 영어 파일이다. 수정마다 저널에 남기고 `commit-run-artifacts` 로 다시 커밋한다. 그 sha256 은 카드의 `run_contract` 필드가 담으며, 재개마다 디스크의 파일을 카드가 **현재 호명하는** 값과 비교한다 — 불일치는 `run-invariant-drift` 다.

내용은 **닫힌 목록**이다.

- `run_id`, work root, 저널 경로, pin 된 run root, 고정된 격리 프로파일, **`base_branch` 와 `integration_branch`**;
- run 의 **고정 경로 규약** — 설계 lock, 제약, 수렴 레지스트리, waves lock, lane lock 과 handoff. 현재 wave 의 해소된 포인터는 카드의 `frozen.lane_lock` 에 있으므로 wave 마다 수정하지 않는다;
- **불변 wave 순서**;
- **`intake_autonomy` 블록** — `--auto` 가 설계 질문에 답했는지, 몇 건인지, 결정별 감사 기록이 어디 있는지. 재개한 세션과 사용자가 설계가 자기들 없이 결정되었음을 볼 수 있게 한다;
- **금지 동작의 닫힌 목록**: 재분해하지 않는다; Phase 3.b 밖에서 Requirement ID 를 할당하지 않는다; **살아 있을 수 있는 lane 을 다시 dispatch 하지 않는다 — 사용자에게 묻는다**; 완료된 lane 을 고치지 않는다; 테스트를 약화하거나 삭제하지 않는다; lease 밖에 쓰지 않는다; `kiwi/waves.jsonl` 에 손으로 append 하지 않는다; **`git add -A` 나 `git commit -a` 를 절대 실행하지 않는다 — 모든 커밋은 명시 pathspec 을 stage 한다**; **`integration_branch` 를 `base_branch` 에 병합하지 않고 PR 도 열지 않는다**(§10);
- 정확한 재개 명령.

---

## 8. 수렴 레지스트리 — `recipe.kind` 와 lane 적격성

어떤 경로는 어느 lane 의 lease 안에도 들어갈 수 없다. 그 경로들은 **닫힌 네 값 recipe enum** 으로 열거하며, 그래서 레지스트리는 schema 검사가 가능하고 **recipe 가 없는 경로는 수렴점이 될 자격이 없다**.

레지스트리에 걸렸다는 사실 하나로는 아무것도 정해지지 않는다 — 걸린 지점의 `recipe.kind` 가 정한다.

| 걸린 지점의 `recipe.kind` | 효과 |
|---|---|
| `exclusive-lane` | **lane 적격**. 단 wave 전체에서 유일해야 한다 — 그 wave 안에서 최대 하나의 lane 만 그 단위를 소유하고, 그것을 건드리는 모든 task 가 그 하나의 lane 으로 강제된다 |
| `orchestrator-only` | **lane 부적격** → serial epilogue |
| `regenerate` | **lane 부적격** → serial epilogue (생성기가 거기서 돈다) |
| `replay` | **lane 부적격** → serial epilogue |

이 규칙이 없으면 `exclusive-lane` 은 **도달 불가능**하다 — 레지스트리에 걸리기만 하면 전부 serial epilogue 로 보내면, enum 멤버는 존재하되 죽은 값이 된다.

**지점은 정당하게 겹치므로 우선순위가 필요하다.** 전순서는 **`orchestrator-only` > `replay` > `regenerate` > `exclusive-lane`** 이며 가장 제한적인 것이 먼저다. 이 순서는 계획 시점 적격성 판정과 병합 시점 복원에 **동일하게** 적용한다 — 같은 파일을 두 시점이 다르게 읽으면 계획이 허용한 것을 병합이 되돌린다.

경로 매칭: `*` 는 한 세그먼트 안에서만 맞고 `/` 를 넘지 않으며, `**` 는 0개 이상의 온전한 세그먼트에 맞는다. 중괄호·문자클래스 문법은 없다. 경로는 저장소 상대 · POSIX 구분자 · 선행 `./` 없음 · Windows 에서는 대소문자 무시로 정규화한다.

---

## 9. 기본 탑재 수렴 레지스트리 (normative shipped default)

아래는 **스킬과 함께 배포되는 기본값**이다. 모든 SpecKiwi 소비 저장소가 `docs/spec/` 과 `00.index.md` 를 갖기 때문에 `CP-01` 과 `CP-02` 는 보편 기본값이고, `CP-07` 도 `docs/research/{work}/**` 항목만 `--work` 로 치환된다는 점을 빼면 보편 기본값이다.

```json
{
  "schema_version": "1.0.0",
  "points": [
    { "id": "CP-01", "paths": ["docs/spec/00.index.md"], "class": "generated",
      "recipe": { "kind": "regenerate", "command": "mcp:sync_index" } },
    { "id": "CP-02", "paths": ["docs/spec/**"], "class": "single-writer",
      "recipe": { "kind": "orchestrator-only" } },
    { "id": "CP-07", "paths": ["kiwi/pipeline.jsonl", ".kiwi/**",
                               "docs/plans/**", "docs/analysis/**", "docs/research/{work}/**",
                               "docs/spec/91.completed-work-log.md"],
      "class": "append-journal", "recipe": { "kind": "orchestrator-only" } }
  ]
}
```

`kiwi/waves.jsonl` 은 `CP-07` 에서 **제외한다** — 정책상 추적되지 않으므로 어느 트리와도 맞을 수 없고, 포함하면 복원 단계 전체가 중단된다.

이 기본값은 세 곳이 읽는다: `orchestrator-only` 경로를 빼는 순서 규칙(계획 경로가 `orchestrator-only` 인 근거가 `CP-07` 이다), serial epilogue 의 recipe 어휘, 그리고 `CP-02` 와 `CP-07` 이 보편 기본값이므로 **모든 저장소에 epilogue 작업이 존재한다**는 사후 검증 분모.

그 밖의 지점(소비 저장소 고유 경로)은 각 저장소가 자기 것을 저작한다 — 스킬이 배포하는 것은 **모양**이지 남의 경로가 아니다.

---

## 10. base 브랜치에 병합하지 않는다

run 이 정상적으로 끝나면 통합 브랜치는 **그 자리에 남기고** run 보고서에 호명한다. **오케스트레이터는 그것을 base 브랜치에 병합하지 않고 PR 도 열지 않는다** — 이것은 의도된 경계이며, `--auto` 가 commit/push 를 자동으로 이어붙이지 않는 이유이기도 하다. `--base-branch` 는 통합 브랜치에 정의된 분기점을 주려고 있는 것이지 오케스트레이터가 거기에 쓰라고 있는 것이 아니다.

run 보고서는 **오케스트레이터가 사용자를 대신해 이행할 수 없는 의무를 하나 명시한다**: 나중에 `frozen.integration_branch` 를 `base_branch` 에 병합하는 사람은 **그 병합 직후 base 브랜치에서 `validate` 를 실행한 뒤 `sync-index` 를 실행해야 한다**. 순서는 `validate` → `sync-index` 이며 바꾸지 않는다. 이것은 권고가 아니라 **의무**다 — 그 병합이야말로 두 브랜치가 동시에 살아 있던 경우이고, 그 경우의 조용한 인덱스 파손은 병합 자체가 아무 신호도 주지 않는다.
