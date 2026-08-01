---
name: kiwi-orchestrator
description: "얇은 의도·연구문서·GitHub 이슈를 받아 intake → 라우팅 → 설계 동결 → wave 분해 → 병렬화 분석 공개 → 영문 handoff → 자체 통합 브랜치 위 직렬 실행 → 사후 검증 → 요구 승급까지 하나의 재개 가능한 run 으로 완주시키는 설계-우선 오케스트레이터 v0.1. 규모와 범위를 스스로 판정해 R-STEP($kiwi-tdd) · R-PLAN($kiwi-pm) · R-ORCH(공용 wave 엔진) 중 하나로 라우팅한다. 진행은 ./kiwi/waves.jsonl 과 재개 카드에 영속되어 컴팩션 뒤에도 재개된다. 트리거 — kiwi orchestrator, 오케스트레이터 실행, 설계부터 구현까지 완주, 대형 작업 오케스트레이션, orchestrate run, 이 문서로 개발 진행. 옵션 — --auto (사용자 게이트 자동 결정, 안전 게이트 유지), --max, --mini / --loops N, --work, --base-branch, --lanes N."
---
> Kiwi MCP rule: normal target-scoped SRS reads, mutations, validation, status/stability updates, acceptance-criteria changes, evidence, trace links, and completed-work logging require working `speckiwi mcp`. CLI is diagnostic/remediation only and is not a normal replacement for MCP mutations.
# kiwi-orchestrator v0.1

> Codex clarification gate means: ask the user directly in Default mode; use `request_user_input` only in Plan mode when that tool is available.
> Model tier terms are role guidance, not provider names: `high-reasoning`, `standard`, and `lightweight` map to the current Codex model and effort options available in the session.

하나의 작업 의도를 받아 **설계를 먼저 저작하고 동결한 뒤** wave 로 분해하고, wave 마다 병렬화 분석을 공개해 검토받고, lane 마다 영문 handoff 를 써서, run 전용 통합 브랜치 위에서 **직렬로** 실행하고, 실행 뒤 동결된 분모에 대해 검증하고, 요구를 승급시키는 오케스트레이터. 모든 진행은 `./kiwi/waves.jsonl` 과 재개 카드에 영속되어 세션이 컴팩션되어도 이어진다.

이 스킬은 *직접 코드를 구현하지 않는다* — 의도를 판정하고, 설계를 동결하고, 작업을 분할하고, 각 단위를 `$kiwi-pm` 에 위임하고, 결과를 검증한다. 자체 fixer 를 두지 않는다.

`2.6.0-phase1-kiwi-orchestrator` 는 **직렬 실행**만 한다. wave 안 task 단위 병렬 실행은 `2.6.0-phase2-parallel-lanes` 가 추가한다.

---

## 0. 공통 규약 (SSOT)

| 키 | 규칙 |
|---|---|
| §0.1 | **이벤트 SSOT**: `../_shared/kiwi/waves-event.md` v1.4.0 가 `./kiwi/waves.jsonl` 의 schema·파일위치·`complete` 규칙 SSOT. 본 문서는 오케스트레이션 로직만 담당한다. |
| §0.2 | **/snoworca-\* 호출 절대 금지**. kiwi-* 시리즈만 `Skill` 도구로 호출한다. |
| §0.3 | **CLAUDE.md §6 시그니처 금지** + **§7 변경 이력 금지**. 본 스킬 본문에 변경 이력 섹션 없음 — git history 가 SSOT. |
| §0.4 | **--auto 안전 게이트**: 어떤 자식(`$kiwi-srs` · `$kiwi-planner` · `$kiwi-pm` · `$kiwi-review-fix-loop` · `$kiwi-tdd`)이 `NEEDS_USER` 또는 `FAILED` 를 반환하면 `--auto` 라도 부모가 중단하고 사용자 결정을 받는다. 자식이 **자기 게이트 표**의 `gate_id` 를 bubble 하면 §0.G 에 같은 이름의 행이 없어도 무조건 중단한다. |
| §0.5 | **`--auto` 옵션 SSOT**. 본 스킬은 `../_shared/kiwi/auto-option.md` 를 따른다. 중단 게이트 선언은 §0.G, `business-decision` 게이트 선언은 §0.S 를 본다. |
| §0.6 | **`--mini` / `--loops N` 옵션 SSOT**. 본 스킬은 `../_shared/kiwi/loop-option.md` 를 따른다. 상한은 라우팅된 자식과 본 스킬의 D/W/H/P/F 루프 cap 양쪽에 전파된다. |
| §0.7 | **상호검증 엔진 SSOT**. 본 스킬은 `../_shared/kiwi/verify-loop.md` v1.0.0 을 따른다 — 증거 번들, 두 stance, 외부 동결 분모, 라운드 구조, 종료 조건, **진동 감지**, 개선 위임. 본 스킬 고유의 분모 표는 §12.1. |
| §0.8 | **wave 분해 SSOT**. 본 스킬은 `../_shared/kiwi/wave-decomposition.md` v1.0.0 을 따른다. `artifact_root` 인자로 `docs/research/{work}/` 를 전달한다 — `kiwi-wave-master` 가 `docs/analysis/kiwi-wave-master-{run_id}/` 를 전달하는 자리다. |
| §0.9 | **wave target 등록 계약 SSOT**. 본 스킬은 `../_shared/kiwi/wave-srs-registration.md` v1.0.0 을 따른다 — `--research-doc` / `--constraints-doc` 저작 입력과 `srs_authored` 멱등 표식. |
| §0.10 | **원장 SSOT**. 본 스킬은 `../_shared/kiwi/run-ledger.md` v1.0.0 을 따른다 — 재개 카드 schema 와 상한, 닫힌 verb enum 과 세 recovery class, write-ahead / write-behind 쓰기 규율, proof kind 표, 대조 술어, 드리프트 다이제스트, 수렴 레시피의 `recipe.kind` enum 과 lane 적격 규칙, 통합 브랜치를 base 브랜치로 병합하지 않는다는 규칙과 그에 따르는 `validate` → `sync-index` 의무. |
| §0.11 | **work-mode SSOT**. 본 스킬은 `../_shared/kiwi/workmode-policy.md` 를 따른다. 본 스킬 자신의 wave 흐름(`R-ORCH`)은 **body scope** 이므로 `tdd` 모드의 step 스코프 라우팅이 이를 다시 라우팅하지 않는다. run 단위 `kiwi-tdd` 라우팅은 §4 가 지배한다. |
| §0.12 | **pipeline 이벤트 SSOT**: `../_shared/kiwi/pipeline-event.md`. 종료 시 MCP `workflow_pipeline_emit` 으로 이벤트 1건을 emit 한다(§17). |
| §0.13 | **경계 규칙**: 판단이 필요한 것은 에이전트가 표시하고, 도구는 표시된 것의 형식만 검사한다. 본 문서가 "도구가 확인한다"고 적은 곳은 전부 형식 검사이며 내용의 옳고 그름은 검사하지 않는다. |

## 0.I 격리(isolation) — `wt-delegation-refused` 의 wave 수준 근거를 상속하지 않는 이유

`kiwi-wave-master:144` 는 **per-wave worktree 가 wave 누적을 깨뜨린다**는 이유로 `--wt` 를 거부한다. 본 스킬은 그 근거를 상속하지 않는다. `2.6.0-phase1-kiwi-orchestrator` 에는 누적을 깨뜨릴 per-wave worktree 도 lane workspace 도 없기 때문이다. 세 근거를 함께 적는다.

- **per-wave worktree 도 lane workspace 도 만들지 않는다.**
- **모든 wave 의 모든 단위를 host root 에서 run 의 통합 브랜치 위에 실행한다**(§10).
- **`isolation_profile` 은 상수 `none-serial`** 이며 `frozen` 안에 있어 `invariant_digest` 가 덮는다. Preflight P.6 의 isolation probe 는 `2.6.0-phase2-parallel-lanes` 로 **이연**되고, 다른 프로파일 값은 phase 1 에 존재하지 않는다.

거부 자체는 상속한다. 오케스트레이터는 위임하는 `kiwi-pipeline` 에 **`--wt` 를 절대 전달하지 않고**, 그런 위임을 Preflight P.2 에서 `wt-delegation-refused` 로 거부한다. 본 스킬 자신의 근거는 다르다: **cycle 스코프 worktree 를 lane 스코프 worktree 안에 중첩시키는 위상**을 이 설계가 지원하지 않기 때문이다. `kiwi-wave-master` 의 per-wave 누적 근거를 본 스킬 자신의 근거로 다시 적지 않는다.

**task 단위 격리**의 나머지 절반 — lane workspace, 클레임 감사, per-lane merge — 는 `2.6.0-phase2-parallel-lanes` 에서 **재진입**한다. phase 1 이 그것을 가졌다고 주장하지 않는다.

## 0.G `critical_gates[]` (auto-option.md §5 인터페이스)

아래 게이트는 `--auto` 라도 자동 진행을 중단하고 사용자 결정을 받는다 — 결정 서브에이전트로 우회할 수 없다. 표를 **부분만** 선언하면 선언되지 않은 나머지 중단이 `business-decision` 으로 떨어져 위원회 승인 대상이 되므로, 본 표는 phase 1 에서 도달 가능한 중단을 모두 담는다. 반대로 **술어가 존재하지 않는 게이트를 선언하는 것은 생략보다 나쁘다** — 뒤에 아무것도 없는 식별자가 cross-variant 파리티 단언에 들어간다. 그래서 `2.6.0-phase2-parallel-lanes` 행은 여기에 없다.

| gate_id | reason | location |
|---|---|---|
| `run-root-preflight-mismatch` | MCP `workspaceRoot` 가 git toplevel 과 다르거나 조회 실패 | Preflight P.1 |
| `invalid-run-scope-option` | 명시된 `--run-id` 가 `^[A-Za-z0-9._-]{1,48}$` 또는 `git check-ref-format --allow-onelevel` 을 통과하지 못하거나, 명시된 `--work` 가 `^[a-z0-9][a-z0-9.-]{2,39}$` 를 통과하지 못함 | Preflight P.2 |
| `unsafe-option-refused` | `--skip-regression` 또는 `--reviewer-off` 요청 | Preflight P.2 |
| `wt-delegation-refused` | 위임되는 `kiwi-pipeline --wt` — cycle 스코프 worktree 를 lane 스코프 안에 중첩하는 위상 | Preflight P.2 |
| `invalid-loop-option` | `--loops N` 이 정수 1 이상이 아님 | Preflight P.2 |
| `orchestrator-run-lock-held` | 다른 orchestrator run 이 git common dir 키의 lease 를 보유 | Preflight P.5 |
| `resume-card-missing-or-invalid` | run 의 이벤트는 있는데 재개 카드가 읽히지 않거나 상한을 넘음 | Phase 0 |
| `ledger-reconciliation-divergent` | 현재 `(wave, stage)` 에 대해 저널·git ref·커밋 trailer 가 불일치 | Phase 0 |
| `run-invariant-drift` | 재계산한 `invariant_digest` 가 카드가 **현재 지시하는** lock 들과 불일치 | Phase 0 |
| `interrupted-external-action` | externally-visible 동사의 `intent` 에 `result` 가 없고, 그 동사가 선언한 점검으로도 외부 효과가 해소되지 않음 | Phase 0 / 3.g |
| `integration-branch-unavailable` | run 의 통합 브랜치를 `--base-branch` 에서 생성하거나 채택할 수 없음 | Phase 0.b |
| `route-probe-unreadable` | MCP 불가로 `list_requirements` 와 `get_active_target` 을 모두 읽을 수 없어 D8 이 저렴한 두 rung 을 제거 | Phase 1.c′ |
| `route-escalation-after-landed-state` | 승격이 통합 브랜치의 커밋 뒤에 오거나, 요구의 `status` 또는 `stability` 를 움직인 SRS mutation 뒤에 옴 | any, on escalation |
| `route-deescalation-refused` | Phase 3.b 이후 rung 을 내리려는 모든 시도 | after 3.b |
| `design-intake-insufficient` | loop D 가 `needs-decision` 또는 `contradicts-existing` 행을 남긴 채 cap 소진 | Phase 1.d |
| `unmarked-normative-prose` | 최하위 heading 아래 문단이 표시 행 밖에서 규범 토큰을 운반 | Phase 1.e / 3.a |
| `design-not-frozen` | `P-DESIGN-FROZEN` 성립 전에 구현 동사 시도 | any |
| `convergence-without-recipe` | 선언된 수렴점에 닫힌 enum 의 recipe 가 없음 | Phase 2.c |
| `wave-decomposition-coverage-gap` | 입력의 최상위 섹션이 어느 wave 에도 배정되지 않고 out-of-scope 사유도 없음 | Phase 2.d |
| `out-of-scope-user-consent` | 설계 항목을 `out_of_scope` 로 배제 — `--auto` 라도 사용자 확인 | Phase 2.d / 승격 봉인 |
| `decomposition-input-missing` | 설계도 없고 흡수할 입력도 없음 — 하한에서의 유일한 명시적 거부 | Phase 2.e |
| `wave-design-insufficient` | loop W cap 소진 — cap 소진은 통과가 아니다 | Phase 3.a |
| `child-srs-needs-user-or-failed` | 직접 호출한 `$kiwi-srs` 가 `NEEDS_USER` 또는 `FAILED` 반환 | Phase 3.b |
| `unallocated-req-id` | sidecar task 가 3.b 배정 집합 밖의 `req_id` 를 갖거나 `req_ids` 가 빔 | Phase 3.c′ |
| `requirement-not-ready` | 파생 readiness 가 미충족 hard dependency·증거 드리프트·미검증 소유권을 보고 | Phase 3.c′ |
| `schedule-cycle` | 의존 사이클이 lane 계획까지 살아남음 | Phase 3.e |
| `tdd-pair-split` | `covers_ac` red/green 쌍이 서로 다른 lane 에 배치됨 | Phase 3.e |
| `unknown-write-set-refused` | `files[]` 가 비었거나 `[INFERRED:` 인데 플래그가 없음 | Phase 3.e |
| `files-not-grounded` | sidecar `files[]` 경로가 기존 경로의 오타이거나 `line_range` 가 범위 밖 | Phase 3.e |
| `non-code-write-set-refused` | `code_roots ∪ test_roots` 밖이거나 비-코드 `type` 인 task 를 다른 same-lane edge 가 lane 으로 끌어들임 | Phase 3.e |
| `lane-plan-drift` | 재계산한 lane 계획이 `lanes.lock.json` 과 불일치 | Phase 3.e / resume |
| `partition-review-unrecorded` | 3.e′ 에서 동결된 `lane_plan.digest` 와 같은 digest 를 기록하고 verdict 가 `pass` 인 `review-partition` result line 이 이 wave 에 없음 | Phase 3.e′ |
| `handoff-not-english` | handoff 본문·`escalation`·`acceptance[].untested_reason` 에 비-라틴 문자(코드펜스·인라인코드·인용 제외) | Phase 3.f / 3.k |
| `handoff-unresolvable-reference` | handoff 의 경로·task id·REQ id·AC id·명령이 해소되지 않음 | Phase 3.f / 3.k |
| `handoff-untested-ac-over-cap` | `acceptance[]` 가 비었거나 `test_id: null` 상한 초과, 또는 null 행에 `untested_reason` / `untested_owner` 누락 | Phase 3.f / 3.k |
| `handoff-verify-failed` | loop H cap 소진 또는 실행가능성 프로브 불일치 — phase 1 은 강등 없이 즉시 발화 | Phase 3.f |
| `stage-coupling-unresolved` | 한 stage 에서 재분할 1회 뒤 두 번째 cross-lane 결합 적중 | Phase 3.f″ |
| `dispatch-base-dirty` | 3.f′ 커밋 직후, 이 stage handoff front matter 경로 합집합에서 `orchestrator-only` glob 을 뺀 집합이 dirty | Phase 3.f′ |
| `serial-unit-failed` | 단위의 `verification_cmd` 가 동일 handoff 로 1회 재시도 뒤에도 비-0 종료, 또는 커밋이 없고 `intentionally_empty` 사유도 없음, 또는 그 `$kiwi-pm` 이 `NEEDS_USER` 또는 `FAILED` 반환 | Phase 3.g / 3.k activity (0) |
| `lane-design-refuted` | 실행 단위가 동결된 설계 항목을 기술대로 구현할 수 없다고 보고 | Phase 3.g / 3.k activity (0) |
| `child-pipeline-needs-user-or-failed` | 위임한 `$kiwi-pm` 또는 `$kiwi-review-fix-loop` 가 `NEEDS_USER` 또는 `FAILED` 반환 | Phase 3.g / 3.k |
| `integration-test-user-consent` | 자식 `kiwi-coder` 통합 테스트 동의 게이트 — `--auto-integration` 이 명시되지 않으면 `--auto` 라도 정지 | Phase 3.g / 3.k |
| `cost-warning-large-task` | 자식 `kiwi-coder` 비용 경고 — `--auto-cost-warning` 이 명시되지 않으면 `--auto` 라도 정지 | Phase 3.g / 3.k |
| `cross-lane-duplication-unresolved` | 중복 감사의 `duplicate` 행이 실행된 epilogue task id 도 `issue:{id}` 도 갖지 않음 | Phase 3.k |
| `post-merge-index-drift` | `sync_index` 가 실행된 뒤에도 `validate --fail-on-warning` 이 드리프트를 보고 | Phase 3.k / `R-PLAN` close-out / `R-STEP` close-out |
| `wave-verify-residual-critical` | loop P 종료 시 잔여 CRITICAL/HIGH, 검증자 1 의 `GAPS`, 또는 `fail-cap` | Phase 3.l |
| `wave-verify-fail-residual` | loop P 가 상한 전에 미해소 finding 을 남기고 끝남 — 그 wave 는 `complete` 를 append 할 수 없다 | Phase 3.l |
| `wave-verify-cross-wave-fix-required` | 이전 wave 의 요구를 바꿔야 하고 carry-forward 경로가 양쪽 다 불가능 | Phase 3.l |
| `verification-oscillation` | 같은 `finding_id` 가 2 라운드 이상에 걸쳐 닫혔다 다시 열리거나 같은 hunk 가 되돌려졌다 다시 적용됨 | any loop |
| `wave-issues-open` | `P-WAVE-ISSUES-CLOSED` 미충족 상태로 다음 wave 를 시도 | Phase 3.m |
| `design-contradiction-at-wave-boundary` | 설계 항목이 구현으로 반증됨, 또는 wave 당 mid-wave 수정 3회째 | Phase 3.m |
| `plan-coverage-unclosed` | `R-PLAN` close-out 에서 요구 집합이 닫히지 않음 — §4.5.2 의 세 disjunct | `R-PLAN` close-out |
| `final-verify-residual-critical` | loop F 종료 시 잔여 CRITICAL/HIGH, `GAPS`, `fail-cap` 또는 `fail-residual` | Phase 4 |
| `wave-append-cap-exhausted` | run 당 wave 추가 상한 **3** 소진 | Phase 3.m / Phase 4 |

> **`--auto` 활성 조건**: `auto-option.md` 상 이 표의 미선언은 `--auto` **비활성**을 뜻한다. 본 표의 선언으로 이 스킬의 `--auto` 는 활성이며, 위 게이트들이 그 활성 상태의 HALT 지점이다.

`external-module-impact` · `mcp-cli-both-unavailable` · `self-recursive-spawn` 은 `auto-option.md` 의 공용 목록에서 **있는 그대로 채택**하며 본 표에 다시 전사하지 않는다 — 전사는 공용 목록이 늘어날 때마다 누락된다.

## 0.S 게이트 심각도 — §0.G 표 밖에 선언되는 라우팅 게이트

아래 네 라우팅 게이트는 심각도를 **명시적으로 선언**하되 §0.G 표에는 넣지 않는다. §0.G 표 소속은 `--auto` 와 무관하게 중단한다는 뜻이고, `route-proposal` 은 **모든 run 에서** 발화하므로 이를 승격시키면 무인 실행 100% 가 첫 결정에서 멈춘다. 위원회는 그런 중단을 뒤집지 못한다. 그럼에도 심각도를 선언하는 이유는 따로 있다: **미선언 게이트의 기본값에 맡기지 않고 confidence 하한 0.7 을 고정**하고 confidence 하향 조정을 작동시키기 위해서다.

| gate_id | severity | 발화 조건 |
|---|---|---|
| `route-proposal` | business-decision | 모든 run, Phase 1.c′ |
| `route-step-requires-mode-switch` | business-decision | rung 이 `R-STEP` 이고 `S1.mode` 가 tdd 가 아님 |
| `tdd-route-unattended` | business-decision | `route-step-requires-mode-switch` 해소 뒤에도 rung 이 여전히 `R-STEP` 이고 `--auto` 활성이며 그 게이트가 `switch-and-step` 으로 해소되지 않음 |
| `route-downgrade-available` | business-decision | Phase 2 끝, §7.3 의 세 조건이 모두 성립 |

세 critical 라우팅 게이트 — `route-probe-unreadable` · `route-escalation-after-landed-state` · `route-deescalation-refused` — 는 §0.G 표에 사유와 위치를 갖고 들어가 있다.

---

## 1. 재개 절차 — 본 스킬에서 가장 먼저 수행하는 것

컴팩션된 세션이 행동하기 전에 필요한 것은 이 고정 절차뿐이다. 순서가 고정이며, 아래 단계 밖의 어떤 것도 먼저 읽지 않는다.

```
1. docs/research/{work}/00.run-contract.md
2. speckiwi orchestrate preflight --mcp-root <path>
                                  --git-root <git rev-parse --show-toplevel> --json
3. speckiwi orchestrate resume --json
4. blocking 이면: next_action.verb 만 수행한다.
   아니면:       SKILL.md §V.<next_action.verb> — 그 섹션만 읽는다.
5. 그 섹션이 지명한 아티팩트 2~3 개를 읽는다.
6. 행동한다.
```

1 단계에서 `{work}` 가 없으면 2 단계로 가서 **재개 카드의 `work_root` 를 읽는다** — 경로를 추측하지 않는다.

2 단계가 3 단계보다 먼저인 이유: **run-root 검사가 저널 경로 해소보다 먼저** 일어나야 한다. 불일치한 root 에서 저널을 해소하면 run 이 잘못된 저장소에 고정된다.

2 단계의 두 값은 세션이 스스로 읽어서 넘긴다 — `--mcp-root` 는 MCP `mcp_workspace_info` 의 `workspaceRoot`, `--git-root` 는 `git rev-parse --show-toplevel` 의 출력이다. `--mcp-root` 와 `--git-root` 는 **둘 다 필수이며 어느 쪽도 기본값을 갖지 않는다**: P.1 은 한쪽을 다른 쪽과 대조하는 검사이므로, 한쪽을 도구가 스스로 채우게 두면 대조의 두 변이 한 출처에서 나오고 P.1 이 잡으려는 불일치는 영원히 발화하지 못한다.

4 단계에서 결과가 blocking 이면 세션은 `next_action.verb` 만 수행하고 **그 밖의 어떤 것도 하지 않는다**. blocking 이 아니면 `§V.<next_action.verb>` 를 읽되 **그 섹션만** 읽고, 그 섹션이 지명한 아티팩트만 읽는다.

**재개 세션은 대화에서 run 상태를 복원하지 않는다.** 재개 도구의 시그니처가 대화 상태를 받지 못하게 되어 있고, 절차상으로도 금지한다. 600 줄을 다시 읽는 대신 동사 섹션 하나를 읽는 것이 이 계약이 컴팩션을 견디는 이유다.

3 단계는 **rung 을 읽지, 다시 계산하지 않는다**. `orchestrate resume` 은 재개 카드의 `frozen.route.rung` 을 돌려주고 `frozen.route.probe_digest` 를 디스크의 `routing/probe.json` 과 대조하며, 불일치는 `run-invariant-drift` 다. `computeRoute` 는 run 당 **정확히 한 번** 실행된다.

### 1.1 `00.run-contract.md`

Phase 0 에 만들고 **정확히 두 지점**에서만 수정한다 — Phase 1 끝(`intake_autonomy`)과 Phase 2.d 커버리지 게이트 뒤(불변 wave 순서). 수정마다 저널에 기록하고 `commit-run-artifacts` 로 다시 커밋하며 재개 카드의 `run_contract` 해시를 다시 쓴다. 매 재개 시 디스크 파일을 카드가 현재 지시하는 값과 대조하고 불일치는 `run-invariant-drift` 다. 담기는 것은 닫힌 목록이다.

- `run_id`, `work_root`, 저널 경로, 고정된 run root, 동결된 `isolation_profile` 값 `none-serial`, **`base_branch` 와 `integration_branch`**;
- run 의 **고정 경로 규약** — `design/00.design.lock.json`, `design/constraints.json`, `design/convergence-registry.json`, `waves/waves.lock.json`, `waves/wave-{n}/lanes.lock.json`, `waves/wave-{n}/lanes/lane-{k}.md`;
- **불변 wave 순서** — 2.d 수정에서 기록. `R-STEP` 과 `R-PLAN` 에는 없다(wave 를 나누지 않는다);
- **`intake_autonomy` 블록** — Phase 1 끝 수정에서 기록(§5.2);
- **금지 행동의 닫힌 목록**: 재분해 금지; Phase 3.b 밖에서 Requirement ID 할당 금지; 완료된 단위 편집 금지; 테스트 약화·삭제 금지; lease 밖 쓰기 금지; `kiwi/waves.jsonl` 직접 append 금지; **`git add -A` 와 `git commit -a` 절대 금지 — 모든 커밋은 명시 pathspec 으로 stage 한다**; **`integration_branch` 를 `base_branch` 로 병합 금지, PR 생성 금지**;
- 정확한 재개 명령.

---

## 2. 저널 쓰기 규율

동사마다 **네 단계**를 이 순서로 수행한다.

```
1. orchestrate journal append  {event:"intent",  verb, run_id, engine, wave, lane?, inputs_digest}
2. …동사를 수행한다…
3. orchestrate journal append  {event:"result", verb, …, outputs, proof, card_digest}
4. orchestrate card write      (전체 재작성, 상한 검사, 스키마 검증)
```

`intent` 는 동사 **앞**에, `result` 는 동사 **뒤**에 붙는다. 두 저널 쓰기는 모두 `orchestrate journal append` 도구를 통과하며 에이전트가 `kiwi/waves.jsonl` 에 **직접 append 하지 않는다**.

재개 세션이 가장 먼저 평가하는 불변식:

- 현재 run 에 대해 각 `(verb, wave, lane)` 키의 **마지막 줄은 `result`** 여야 한다. `result` 가 짝지어지지 않은 `intent` 는 그 동사가 **중단**되었다는 뜻이다.

### 2.1 세 recovery class 와 중단 복구

`recovery_class` 는 닫힌 enum 이고 원소는 정확히 `pure-reauthor` · `idempotent-by-key` · `externally-visible` 셋이다.

- 중단된 `pure-reauthor` 와 `idempotent-by-key` 는 **게이트 없이 그냥 다시 한다**.
- 중단된 `externally-visible` 은 **자기 §V 섹션이 지명한 점검을 재진입 전에 먼저 실행하고**, 그 점검으로도 외부 효과가 **해소되지 않을 때에만** `interrupted-external-action` 을 올린다. 이 게이트는 `--auto` 라도 중단한다 — 반쯤 끝난 외부 행위가 무엇을 했는지 위원회는 알 수 없다. 점검이 상태를 확정하면 남은 부분만 게이트 없이 재진입한다.

**커밋 식별은 git trailer 로 하고 subject 텍스트로 하지 않는다.** `git log` 를 점검하는 동사는 모두 `Orch-*` trailer 튜플로 거른다. 커밋 제목에 단계 표식을 넣는 것은 상시 금지 사항이고, 이 설계가 복구 기제를 그 위반으로 사서는 안 된다. trailer 는 구조화된 값이고 subject 는 rebase 나 amend 가 바꿔 쓸 수 있는 자유 텍스트다.

```
git log --format='%H%x00%(trailers:key=Orch-Verb,valueonly)%x00%(trailers:key=Orch-Run,valueonly)%x00%(trailers:key=Orch-Wave,valueonly)%x00%(trailers:key=Orch-Stage,valueonly)'
```

---

## 3. Phase 흐름

```
Preflight
  P.0  run-id + {work} 해소 (§16)
  P.1  run-root preflight            게이트: run-root-preflight-mismatch            C
  P.2  옵션 거부                     게이트: unsafe-option-refused                  C
                                            wt-delegation-refused (자식 --wt)       C
                                            invalid-loop-option                     C
                                            invalid-run-scope-option                C
  P.3  work-mode READ                (읽기 전용 — probe 필드 S1. rung 을 제거하지 않고,
                                      오케스트레이터는 set_work_mode 를 스스로 호출하지 않는다)
  P.4  회귀 baseline pin             (baseline 부재는 기록하되 치명적이지 않다)      W
  P.5  orchestrator run lock         게이트: orchestrator-run-lock-held             C
  P.6  isolation probe               2.6.0-phase2-parallel-lanes 로 이연.
                                     frozen.isolation_profile 은 상수 "none-serial".

Phase 0  재개 / run 생성
  0.a  orchestrate resume            게이트: resume-card-missing-or-invalid         C
                                            ledger-reconciliation-divergent         C
                                            run-invariant-drift                     C
                                            interrupted-external-action             C
  0.b  통합 브랜치 kiwi/orch/{run_id}/integration 을 --base-branch 에서 생성 또는 채택,
       frozen 블록에 기록          게이트: integration-branch-unavailable           C

Phase 1  intake → route → design                                  [loop D]
  1.a  소스 분류: 얇은 의도 | 연구·설계 문서 | GitHub 이슈
  1.b  조사자 3 기 병렬 (intent / code-context / architecture-fit)
  1.c  갭 열거 → 조사자가 닫지 못한 갭은 전부 사용자 QnA
  1.c′ 라우팅 분류 (§4)
       동사 probe-route  → routing/probe.json      (게이트 전에 기록)
       산문             → routing/00.routing.md    (게이트 전에 기록, 영문)
       동사 freeze-route → routing/route.lock.json (게이트 후에 기록)
                                     게이트: route-proposal        business-decision
                                            route-probe-unreadable                  C
                                     조건부: route-step-requires-mode-switch  business-decision
                                            tdd-route-unattended             business-decision
       ├─ R-STEP → dispatch-route → Skill(kiwi-tdd) → validate/sync-index → emit-and-finish
       ├─ R-PLAN → dispatch-route → Skill(kiwi-pm) → Skill(kiwi-review-fix-loop --close-reqs)
       │            → plan-coverage close-out + validate/sync-index → emit-and-finish
       └─ R-ORCH → 1.d 로 진행 — 아래 전부는 이 rung 에서만 실행된다
  1.d  설계 저작 루프 → design/00.design.md
  1.e  freeze-design                 게이트: design-intake-insufficient             C
                                            unmarked-normative-prose                C
                                            design-not-frozen (하류)                C

Phase 2  분해                                                (R-ORCH 전용)
  2.a  wave 분할 (headers-first, 아니면 splitter 서브에이전트, 3–8 하위 목표)
  2.b  설계 기준선 + constraints 아티팩트 (비어 있어도 항상 기록)
  2.c  수렴 레지스트리 저작 + 검증  게이트: convergence-without-recipe              C
  2.d  커버리지 게이트               게이트: wave-decomposition-coverage-gap        C
                                            out-of-scope-user-consent               C
  2.e  거부 하한 평가                게이트: route-downgrade-available  business-decision
                                            decomposition-input-missing             C

Phase 3  wave 마다, 등록 순서대로 — wave 는 직렬이고 누적된다
  3.a  wave 설계 문서 → waves/wave-{n}/design.md                    [loop W]
                                     게이트: wave-design-insufficient               C
                                            unmarked-normative-prose                C
  3.b  $kiwi-srs 로 SRS 등록 (host root, 직렬; 모든 REQ id 를 여기서 할당)
                                     게이트: child-srs-needs-user-or-failed         C
  3.c  $kiwi-planner 로 계획 (host root, 직렬)
  3.c′ readiness 파생 + 배정 검사    게이트: unallocated-req-id                     C
                                            requirement-not-ready                   C
  3.d  wave 입력 커밋 (명시 pathspec)
  3.e  freeze-lane-plan — 병렬화 분석. 동시 실행이 없어도 전부 산출한다.
                                     게이트: schedule-cycle · tdd-pair-split ·
                                            unknown-write-set-refused · files-not-grounded ·
                                            non-code-write-set-refused · lane-plan-drift   C
  3.e′ 분할 아티팩트 공개 + 검토: lanes.lock.json + waves/wave-{n}/partition.md.
       검토자는 게이트에 선 사용자이고, 게이트가 critical 이므로 --auto 라도 멈춘다.
       verdict 어휘는 닫혀 있다: pass | revise | abort.
                                     게이트: partition-review-unrecorded            C

  ┌── wave 의 각 STAGE s, 동결된 계획의 위상 순서대로 ─────────────────────────────┐
  │ 3.f  stage s 의 모든 lane handoff 저작   [loop H]                             │
  │                                게이트: handoff-not-english ·                  │
  │                                       handoff-unresolvable-reference ·        │
  │                                       handoff-untested-ac-over-cap ·          │
  │                                       handoff-verify-failed                C  │
  │ 3.f″ 이 stage handoff 들에 대한 cross-lane 결합 검사 (§11.2)                  │
  │                                게이트: stage-coupling-unresolved           C  │
  │ 3.f′ stage s 의 handoff 아티팩트 커밋 (명시 pathspec)                         │
  │                                게이트: dispatch-base-dirty                 C  │
  │ 3.g  stage s 를 직렬 실행 (§10): stage 의 각 lane 을 lane-id 순으로,          │
  │      handoff 하나당 $kiwi-pm 한 번, HOST root, 통합 브랜치 위.                │
  │                                게이트: serial-unit-failed ·                   │
  │                                       child-pipeline-needs-user-or-failed ·   │
  │                                       lane-design-refuted ·                   │
  │                                       interrupted-external-action          C  │
  └───────────────────────────────────────────────────────────────────────────────┘

  3.k  wave 마감 (wave 당 1회, 마지막 stage 뒤):
       (0) waves/wave-{n}/epilogue.md 저작 → handoff validate --lane epilogue →
           freeze handoff → serial_epilogue ∪ unassigned task 집합을 host 단위 하나로 실행.
           wave 안에서 order-last 다. 그 집합이 비면 (0) 은 통째로 생략하고 저널에
           생략을 결과로 기록한다;
       (1) 레지스트리의 수렴 레시피 실행;
       (2) 이 wave 의 커밋 범위에 대한 중복 감사 (§11.1) — (0) 뒤에 실행된다;
       (3) validate 다음 sync-index (§11.3);
       (4) run 자신의 아티팩트 커밋
                                     게이트: handoff-not-english ·
                                            handoff-unresolvable-reference ·
                                            handoff-untested-ac-over-cap ·
                                            serial-unit-failed · lane-design-refuted ·
                                            cross-lane-duplication-unresolved ·
                                            post-merge-index-drift                  C
  3.l  실행 후 wave 검증  [loop P]   게이트: wave-verify-residual-critical ·
                                            wave-verify-fail-residual ·
                                            wave-verify-cross-wave-fix-required     C
  3.m  wave 경계 이슈 분류 + 해소    게이트: wave-issues-open ·
                                            design-contradiction-at-wave-boundary   C
  3.n  요구 승급 (host root 전용, 3.l 이 pass 한 뒤) — §14
  3.o  waves.jsonl 에 complete append (3.l verdict = pass 인 뒤에만)

Phase 4  run 최종 검증  [loop F]     게이트: final-verify-residual-critical ·
                                            wave-append-cap-exhausted               C
Phase 5  MCP workflow_pipeline_emit 으로 pipeline 이벤트 1건 emit
Phase 6  run 처분 (§15): 통합 브랜치는 그대로 두고 run 리포트에 지명한다.
```

3.a–3.o 는 wave 마다 반복된다. **target 을 미리 등록하지 않는다.**

**`2.6.0-phase2-parallel-lanes` 로 이연된 단계와 그 자리**: 3.g 의 비차단 dispatch, 3.g′ join, 3.h 수집과 클레임 감사, 3.i loop L, 3.j 재감사와 per-lane merge, 3.j′ harvest 후 reap. 여섯 단계 모두 같은 자리로 재진입한다. 조용히 사라진 것이 아니라 이연된 것이다.

---

## 4. 라우팅 — 규모와 범위 판정

### 4.1 위치: Phase 1.c′

라우팅 분류는 **1.c′** 에 있다. 1.b 의 조사자 3 기 뒤, 1.c 의 갭 QnA 뒤, **1.d 의 설계 저작 앞**, 그리고 어떤 SRS mutation·target 등록·계획 저작보다도 앞이다.

1.c′ 이 쓰는 아티팩트는 셋이다. `routing/probe.json` 은 동사 `probe-route` 가 게이트 **전에** 쓴다. 영문 산문 `routing/00.routing.md` 도 게이트 **전에** 쓴다 — 사용자가 프롬프트가 아니라 문서를 읽게 하기 위해서다. `routing/route.lock.json` 은 동사 `freeze-route` 가 게이트 **후에** 쓴다. 게이트에서의 해소 기록은 `routing/route-gate.json` 에 게이트 시점에 쓰고 `freeze-route` 의 세 번째 인자로 넘긴다.

**1.c′ 에서 아직 일어나지 않은 것**: `add_requirement` · `update_status` · `update_stability` 호출 없음, target 등록 없음, 계획 저작 없음, 라우팅 아티팩트 커밋 없음. run 의 **첫 SRS mutation 은 Phase 3.b** 다.

**1.c′ 까지 이미 일어난 것**: run root 고정(P.1), 회귀 baseline 포착·고정(P.4), git common dir 위의 run lock 보유(P.5), 통합 브랜치 `kiwi/orch/{run_id}/integration` 생성 또는 채택(0.b)과 그 위의 `commit-run-artifacts` 커밋 2건, 그리고 work-mode 를 **읽었고 쓰지 않았음**(P.3).

### 4.2 route probe — 13 개 필드

각 필드는 `producer` · `call` · `value` · `read_at` 를 기록한다. **`probe.json` 에 없는 값을 읽는 술어는 허용되지 않는다.**

| id | 필드 | producer — 정확한 호출 |
|---|---|---|
| S1 | `mode`, `active_task`, `source` | MCP `get_work_mode`, 아니면 CLI `speckiwi mode`, 아니면 `wait`(fail-open) |
| S2 | `plan` | `selectPlanCandidate` 가 `docs/plans/*.plan.md` 전체를 `generated_at` 내림차순 + 경로 사전순 tie-break 로 정렬해 선택 |
| S3 | `anchored_reqs[]` | 각 `S5.relevant_files[].path` 에 대해 MCP `list_requirements({ traceReference: p, projection: "compact" })` 의 합집합 |
| S3c | `anchor_coverage` | MCP `list_requirements({ target, fields: [...COMPACT_FIELDS, "traceLinks"] })` 에서 `type == "Code"` 행을 가진 요구의 비율 |
| S4 | `scopes[]`, `scope_req_ids[]`, `unresolved[]` | S3 의 `record.scope` 와 architecture-fit 조사자 보고의 합집합을 CLI `speckiwi scopes --json` 의 등록 어휘로 정규화 |
| S5 | `files`, `modules`, `external_paths[]` | code-context 조사자 → `code_context.json` |
| S6 | `ambiguities`, `key_entities[]` | intent 조사자 → `intent.json`, 1.c 의 QnA **뒤** |
| S7 | `doc` | 1.a 소스 분류 — `ordered_sections` 는 명시 순서 표식을 가진 최상위 섹션만 센다 |
| S8 | `epic` | 입력이 GitHub 이슈일 때 `gh issue view` |
| S9 | `target` | MCP `get_active_target` |
| S10 | `blocked_stability[]` | S3c 와 같은 `list_requirements({target})` 호출에서 `stability` 가 `deprecated` 또는 `frozen` 인 요구 |
| S11 | `unreadable[]` | 읽지 못한 필드 id — D8 의 fail-closed 입력 |
| S12 | `declared_existing_req_edit` | `existing_srs_context.json` 의 `candidate_matches[]` 에 `potential-update` 또는 `potential-conflict` 가 1개 이상 |

**크기 필드는 어떤 임계도 구동하지 않는다.** `S5.files` 는 게이트 증거표와 사용자용 산문에만 기록된다. `existing_srs_context.json` 의 `similarity_score` 는 기록되고 임계를 구동하지 않는다. `S9.summary` 는 들어오는 작업이 아니라 **target 에 이미 있는** 요구를 센다. wave splitter 는 1.c′ 에서 호출되지 않는다.

### 4.3 disqualifier-first — 실격이 먼저다

**모든 술어는 rung 을 제거하고, 어떤 술어도 rung 을 선택하지 않는다.** `id` 와 제거된 rung 과 관측값을 전부 기록한다.

| id | 술어 | 제거 |
|---|---|---|
| **D1** `anchored-body-requirement` | `S3` 이 비지 않음(단 `S3c` 가 0.2 이상일 때) 또는 `S12 == true` | `R-STEP` |
| **D2** `unguarded-out-of-cwd-write` | `S5.external_paths[]` 가 비지 않음 | `R-STEP` |
| **D3** `multi-scope-write-set` | `S4` 의 크기가 2 이상 (단위: scope 개수) | `R-STEP` |
| **D4** `declared-multi-stage-input` | `S7.ordered_sections` 가 2 이상 (단위: 섹션 개수), 또는 `S8.task_list_groups` 가 1 이상, 또는 `S8.linked_sub_issues` 가 2 이상 | `R-STEP` |
| **D5** `no-contract-valid-plan` | 선택된 후보의 `S2.contract_ok == false` | `R-PLAN` |
| **D6** `plan-does-not-cover-this-work` | `S2.open_tasks == 0`, 또는 `S2.target` 이 `S9.activeTarget` 과 다름, 또는 커버리지 검사 실패 | `R-PLAN` |
| **D7** `plan-lifecycle-blocked` | `S9.activeTarget` 이 비었거나 `S10` 이 비지 않음 | `R-PLAN` |
| **D8** `probe-field-unreadable` | `S11.unreadable[]` 의 각 id 를 그것이 보호하는 rung 으로 보내는 전역 사상 | fail-closed |

**D8 의 사상은 전역(total)이다**: `S3` · `S3c` · `S4` · `S5` · `S7` · `S8` · `S12` 는 `R-STEP` 을 제거하고, `S2` · `S9` · `S10` 은 `R-PLAN` 을 제거하며, `S1` 과 `S6` 은 **아무것도 제거하지 않는다**. `R-ORCH` 는 결코 제거되지 않는다. 보호 rung 이 없는 필드 id 는 빈 목록으로 사상되며 정의되지 않은 값으로 사상되지 않는다.

**선택 순서는 고정이다.**

```
order: R-PLAN → R-STEP → R-ORCH        첫 생존 rung 이 이긴다
```

`R-PLAN` 이 앞인 이유는 그 생존 전제조건이 가장 강하기 때문이다 — 계약 유효한 계획, 활성 target 위, 열린 Task 존재, 차단 stability 없음, 그리고 이 작업의 파일들이 이미 anchored 된 요구와 교차. `R-STEP` 이 `R-ORCH` 앞인 이유는 D3 와 D4 가 정확히 "오케스트레이션 형태"를 만드는 폭과 순서 조건에서 `R-STEP` 을 제거하기 때문이다. **`R-ORCH` 는 어떤 술어로도 제거되지 않으므로 사다리는 항상 정확히 하나의 rung 에서 끝난다.**

**분류기 안에는 tie-break 규칙이 없다. 동점이 생길 수 없기 때문이다.** 동점이 생길 수 있는 유일한 자리는 게이트의 위원회 ballot 이다(§4.6).

**잘못된 라우팅은 추적 가능해야 한다.** 두 경로 중 하나로 추적된다: `route.lock.json` 의 `removed[]` 에 기록된 **술어 하나와 관측값 하나**, 또는 게이트가 대안을 골랐을 때 같은 lock 의 `proposed_rung` 과 `overridden_by` 와 ballot 해소 기록.

`route.lock.json` 은 `rung` · `proposed_rung` · `overridden_by` · `alternative` · `decisive` 와 `{rung, by, observed}` 행을 갖는 `removed[]` 배열, 그리고 probe 경로와 probe digest 를 기록한다.

### 4.4 work-mode 충돌

**영속 work-mode 는 `R-STEP` rung 을 제거하지 않는다.** 라우팅 판정은 **오케스트레이터 자신의 판단이지 설정에서 읽은 모드가 아니고**, **기본 모드는 `wait`** 이며 `wait` 은 **fail-open** 값이기도 하다 — 모드가 rung 을 제거하면 `set_work_mode` 를 한 번도 실행하지 않은 저장소에서 사용자가 지목한 경로가 **구조적으로 도달 불가**가 된다.

| 경우 | 동작 | 기록 |
|---|---|---|
| rung `R-STEP`, `S1.mode == "tdd"` | `$kiwi-tdd` 를 dispatch | `route.lock.json` |
| D1–D4 가 step rung 을 제거해 rung 이 `R-STEP` 이 아님, mode tdd | 그대로 라우팅 | 비치명 WARN 1건 — 모드와 rung 을 지명 |
| `R-STEP` 은 생존했으나 고정 순서로 `R-PLAN` 이 이김, mode tdd | `R-PLAN` 로 라우팅 | 비치명 WARN 1건 — 모드·rung·무효화된 라우팅 절을 지명 |
| rung `R-STEP`, `S1.mode` 가 tdd 가 아님 | `route-step-requires-mode-switch` 발화 | 게이트의 결정·선택지·해소 규칙 |

`route-step-requires-mode-switch` 는 `business-decision` 이고 `critical_gates[]` 밖이며 세 선택지를 갖는다.

| 선택지 | 행동 | 결과 문장 | recommended |
|---|---|---|---|
| **`switch-and-step`** | `set_work_mode(mode="tdd")` 뒤 `$kiwi-tdd` dispatch | 영속 프로젝트 전역 work-mode 를 `docs/spec/steps/state.md` 에 기록한다 | 없음 |
| **`stay-and-orchestrate`** | 가장 가까운 생존 rung 으로 라우팅, 모드 그대로 | 작업은 step 형태지만 run 은 sdd 사슬로 진행한다. `tdd_policy` 는 여전히 모드에서 파생된다 | **있음** |
| **`abort`** | 중단하고 probe 와 run 리포트를 기록 | 요구·target·계획·work-mode 를 하나도 변경하지 않는다 | 없음 |

`S1.source` 가 `default-wait` 이면 이 게이트의 `recommended` 표식을 **통째로 보류**한다 — 읽히지 않은 설정이 어느 방향으로도 **무숙고 경로**를 사지 못하게 한다. 선택지가 셋이므로 1-1-1 분할은 다수가 없고, 다수가 없으면 게이트는 critical 로 격상되어 중단한다.

`--auto` 아래에서 `R-STEP` 이 살아남으면 `tdd-route-unattended` 를 올린다. 이 게이트는 `route-step-requires-mode-switch` **뒤에** 평가되고 그 게이트가 `switch-and-step` 으로 해소되지 않았을 때에만 발화한다. 선택지는 `proceed-step` 과 `orchestrate-instead` 둘이며 `recommended: true` 는 `orchestrate-instead` 에 붙는다. rung 을 실격시키는 대신 게이트로 올린다.

**오케스트레이터는 `set_work_mode` 를 자기 권한으로 호출하지 않는다.** 모드를 쓰는 유일한 경로는 사람 또는 위원회가 게이트에서 `switch-and-step` 을 고르는 것이다.

**모든 rung 에서 `tdd_policy` 는 계속 흐른다.** 모드 tdd 는 작업이 `R-ORCH` 로 라우팅되어도 모든 자식 Task 에서 `tdd_policy = strict` 를 파생시킨다. 모드가 무력화되는 것이 아니라 그 라우팅 절만 무효화된다.

### 4.5 rung 별 경로표

#### 4.5.1 `R-STEP` → `kiwi-tdd`

**호출 전에 존재해야 하는 것**: 동결된 `routing/probe.json` 과 `rung = "R-STEP"` 인 `routing/route.lock.json`; intake 요약에서 결정론적으로 파생한 **40자 이하 kebab** `<task>` 이름; 1.c 에서 이미 쓴 작업 개요 문단 `docs/research/{work}/01.intake.md`; `S1.mode == "tdd"`; 그리고 **설계 문서 없음** — 1.d 는 실행되지 않았고 실행되어서도 안 된다. `kiwi-tdd` 가 자기 SDS 를 저작하기 때문이다.

```
Skill({ skill: "kiwi-tdd", args: "<task> [--auto] [--mini | --loops N] [--model <name>]" })
```

**플래그**: `--mini` 와 `--loops N` 은 전파한다. `--model` 은 사용자가 지정했을 때 전파한다. `--auto` 는 일관성을 위해 전달하되 자식이 **조용히 무시**하므로 효과가 없다는 사실을 **오류로 읽지 않는다**. `--max` 와 네 pass-through — `--auto-integration` · `--auto-cost-warning` · `--force` · `--regression-baseline` — 는 **전파하지 않는다**. 그것들은 이 경로에 존재하지 않는 게이트를 겨냥한다.

**반환 후 세 결과**:

- *승급됨*: `dispatch-route` result line 에 `outcome: "delegated-complete"` 를 기록하고, **P.5 run lock 을 해제**하고, 통합 브랜치를 그대로 두고 run 리포트에 지명하고, `validate` → `sync-index` → `validate --fail-on-warning` 을 실행한다. 살아남은 드리프트는 `post-merge-index-drift`(critical)다. 그 뒤 `next_hint: null` 과 rung 및 step 을 지명하는 summary 로 `pipeline.jsonl` 이벤트 1건을 emit 하고 중단한다.
- *자식 자신의 게이트에서 정지*: 그대로 보고하고 멈춘다. **다시 라우팅하지 않는다.** 그것들은 misroute 가 아니라 run 안의 결함이다.
- *경계 redirect 발화*: E1 로 승격한다(§4.7).

#### 4.5.2 `R-PLAN` → `kiwi-pm` → `kiwi-review-fix-loop --close-reqs`

**호출 전에 존재해야 하는 것**: `rung = "R-PLAN"` 인 동결 lock; probe 의 plan 필드에서 **오케스트레이터가 명시적으로 해소한** `PLAN_PATH` — `kiwi-pm` 의 **최신 `generated_at` 폴백에 맡기지 않는다**; 비어 있지 않고 **계획의 target 과 같은 활성 target**; 그리고 **설계 문서 없음, `$kiwi-srs` 실행 없음**.

```
Skill({ skill: "kiwi-pm",
        args: "PLAN_PATH=<path> [SIDECAR_PATH=<path>] [--resume] [--auto] [--max] [--model <n>]
               [--mini|--loops N] [--force] [--auto-integration] [--auto-cost-warning]
               [--regression-baseline <ref>]" })
```

`--resume` 은 `.kiwi/sessions/{plan run_id}/pm-state.json` 이 존재할 때 정확히 그때 전달한다. task 목록의 status 가 아니라 **그 파일**이 `kiwi-pm` 으로 하여금 `status="done"` Task 를 건너뛰게 만들며, 그것이 없으면 **새 세션이 되어 완료된 Task 를 다시 실행한다**.

`TASK_DONE` 이면 두 번째 hop:

```
Skill({ skill: "kiwi-review-fix-loop", args: "--close-reqs [--auto] [--max] [--mini|--loops N]" })
```

**두 번째 hop 은 오케스트레이터 자신이 선언한 정책**이고 **상속된 의무가 아니다**. 근거는 `--close-reqs` 없이는 어떤 요구도 `verified` 에 도달하지 못하고 run 에 마무리가 없다는 것이다.

**플래그**: `--auto` 는 **명시적으로** 전파한다. `--max` 와 `--model` 과 `--mini` / `--loops N` 도 전파한다. `--auto-cost-warning` · `--auto-integration` · `--force` 는 사용자가 지정했을 때에만 흐르고, `--regression-baseline` 은 항상 오케스트레이터 자신의 P.4 pin 을 운반한다.

**반환 후 plan-coverage close-out.** 이 rung 에는 동결된 설계 항목 집합이 없으므로 설계 계층 판정을 주장하지 않고, 분모가 있는 것 — 계획의 요구 집합 — 을 검증한다. `plan-coverage-unclosed`(critical)는 세 disjunct 중 하나에서 발화한다.

1. probe 의 열린 Task `req_ids` 집합의 어떤 원소가 `verified` 도 아니고 `coverage_residual[]` 행에도 지명되지 않았을 때;
2. 어떤 원소가 `verified` 인데 그 acceptance criterion 하나가 증거로 덮이지 않았고 어떤 residual 행도 그것을 **사유와 owner 를 함께** 지명하지 않을 때;
3. 모든 행의 사유와 owner 와 무관하게, residual 행 수가 `max(--allow-plan-residual, ceil(|req_ids| / 4))` 를 넘을 때.

residual 행은 `{req_id, reason, owner}` 이고 `kiwi/waves.jsonl` 의 `R-PLAN` `dispatch-route` result line 에 기록되며 `reason` 은 20자 이상이다.

`kiwi-review-fix-loop --close-reqs` 는 `stability=draft` 이거나 `implemented` 가 아닌 요구를 **건너뛰고 보고**할 뿐 그것으로 게이트하지 않는다. 따라서 그 `TASK_DONE` 은 요구 집합이 닫혔다는 증거가 아니다. close-out 뒤에 `validate` → `sync-index` → `validate --fail-on-warning` 을 실행하고 `post-merge-index-drift`(critical)를 거친 다음 마감 이벤트 1건을 emit 한다.

#### 4.5.3 `R-ORCH` → 공용 wave 엔진을 직접 구동

**진입 전에 probe 말고 존재해야 하는 것은 없다.** 이 rung 은 자기 전제조건을 스스로 생산한다 — 1.d 의 설계, 2.a 의 분해, 3.b 의 wave 별 SRS.

**`R-ORCH` 는 스킬 호출이 아니다.** 오케스트레이터는 자기 흐름을 계속하면서 `_shared/kiwi/wave-decomposition.md` 와 `_shared/kiwi/verify-loop.md` 와 `_shared/kiwi/run-ledger.md` 를 호출하고, artifact root 로 `docs/research/{work}/` 를 넘긴다 — `kiwi-wave-master` 가 `docs/analysis/kiwi-wave-master-{run_id}/` 를 넘기는 자리다.

**`kiwi-orchestrator` 는 `kiwi-wave-master` 를 결코 호출하지 않는다.** 근거 네 가지:

1. 추출 뒤에는 형제 스킬을 호출하는 것이 **중복 경로**다 — 이미 참조하는 모듈에 닿으려고 스킬을 하나 더 거치는 것이기 때문이다;
2. 형제의 **입력 계약이 맞지 않는다** — 자기가 쓰지 않은 입력 문서를 요구하고, 오케스트레이터가 저작해 동결한 기준선에서 설계 항목을 다시 파생시킨다;
3. 형제의 **run 스코프 pin 이 충돌한다** — 저널 root 와 회귀 baseline 이 오케스트레이터 자신의 P.4 pin 과 부딪힌다;
4. 중첩 run 은 하나의 논리적 run 에 대해 **두 번째 `run_id` 와 두 번째 engine 값**으로 한 저널에 줄을 쓴다 — v1.4.0 이 추가한 판별자를 무력화한다.

**사용자가 `kiwi-wave-master` 를 명시적으로 지목한 요청은 가로채지 않는다.** 분류하지도 않고 run 을 시작하지도 않는다 — 요청이 형제 스킬을 지목했다고 보고하고 멈춘다.

**wave 마다의 위임은 이름으로 개별 호출한다** — `$kiwi-pipeline --cycle` 로 진입하지 않는다. `05` 의 흐름이 계획과 구현 사이에 `derive-readiness`(3.c′)와 `commit-wave-inputs`(3.d)를 끼우는데 파이프라인의 고정 사슬에는 그 이음매가 없기 때문이다.

```
Skill({ skill: "kiwi-srs",
        args: "REQ_PATH=waves/wave-{n}/excerpt.md
               --research-doc waves/wave-{n}/design.md --research-doc waves/wave-{n}/excerpt.md
               --constraints-doc design/constraints.json TARGET=wave-{n} [--auto] [--max] [--mini|--loops N]" })
Skill({ skill: "kiwi-planner",  args: "TARGET=wave-{n} [REQ_FILTER=…] [--plan-run-id …] …" })
$kiwi-pm --handoff …                          (lane 마다, stage 마다 — §10)
Skill({ skill: "kiwi-review-fix-loop", args: "--base {wave_window_base} --head {wave_window_head}
        --no-pipeline-emit …" })
```

`$kiwi-review-fix-loop` 의 교정 hop 은 통합 브랜치 위 이 wave 의 **커밋 범위**에 대해 실행하며 **`--commit-lane-work` 도 `--close-reqs` 도 전달하지 않는다**. 이 rung 에는 `$kiwi-srs-feasibility` hop 이 **없다**.

**wave 의미 게이트는 상속되지 않고 오케스트레이터 자신의 `critical_gates[]` 에 선언되어 있다**(§0.G): `wave-verify-residual-critical` · `wave-verify-fail-residual` · `wave-verify-cross-wave-fix-required` · `final-verify-residual-critical` · `wave-decomposition-coverage-gap` · `out-of-scope-user-consent` · `wave-append-cap-exhausted` · `decomposition-input-missing` · `child-srs-needs-user-or-failed` · `child-pipeline-needs-user-or-failed` · `unsafe-option-refused` · `wt-delegation-refused` · `invalid-loop-option` — **13개 전부**.

이유를 함께 적는다. **뒤 세션이 중복이라고 지우지 않게** 하기 위해서다. **`_shared` 모듈은 자식이 아니다.** 자식 게이트 상속 규칙의 전제는 *실행 중인 자식 스킬이 `gate_id` 를 bubble 하는 것*인데, `R-ORCH` 에는 자식이 없고 `_shared` 모듈은 게이트 선언을 담지 않으며 **아무것도 bubble 하지 않는다**. **게이트 선언은 구조상 스킬 단위다.** 그리고 심각도가 선언되지 않은 게이트는 `business-decision` 으로 떨어져 `--auto` 아래에서 위원회가 승인한다.

위임 rung 에 적용되는 **상속 안전 규칙 둘**(§0.4): 자식이 `NEEDS_USER` 또는 `FAILED` 를 반환하면 `--auto` 라도 부모가 중단한다. 자식이 **자기** 게이트 표의 게이트를 bubble 하면 부모 표에 **같은 이름의 행이 없어도 무조건 중단**한다.

### 4.6 게이트와 ballot

`route-proposal` 의 ballot 은 선택된 rung 과 `decision.alternative` 이며, `alternative` 가 `null` 이면 선택된 rung 과 `abort` 다. 선택지 둘에 위원 셋이면 **동점은 산술적으로 불가능**하다. 남는 중단 사유는 **degraded quorum** — 한 명이 실패해 둘이 남고 1-1 이 되는 경우 — 이며 **critical 로 격상되어 중단**한다.

`route-proposal` 이 `recommended: true` 를 갖는 것은 **다섯 절이 모두 성립할 때뿐**이다.

1. `probe.unreadable == []` — D8 이 발화하지 않았다;
2. `decision.decisive` 가 `null` 이 아니고, 자기 단위에서 margin 이 1 이상이거나, 함께 발화한 다른 술어가 보강하는 boolean 이다;
3. 1.c 의 QnA 뒤 `S6.ambiguities == 0`;
4. rung 이 `R-STEP` 일 때 모드 출처가 `default-wait` 이 아니다;
5. rung 이 `R-STEP` 이고 D1 이 측정으로 그것을 통과시켰을 때 `anchor_coverage` 가 0.2 이상이다.

성립하지 않으면 표식을 보류하고 `withheld_because[]` 가 실패한 절을 지명한다.

**위원회 입력은 사실만 운반하고** 본 세션의 **잠정 제안을 절대 운반하지 않는다**. 위원은 `gate_id` 와 `severity` 와 `options[]` 와 **probe 표**와 **제거 표**를 받는다. 산문 파일 `routing/00.routing.md` 는 **사용자가 읽는 것**이고 위원회는 증거를 읽는다. fast-path 로 결정된 건은 `{"rule": "recommended-fastpath", "committee_size": 0, "marked_by": …}` 감사 행을 run 의 결정 감사 로그에 기록한다.

**어느 override 분기에서도** — 사용자든 위원회든 — lock 은 대안을 `rung` 으로, 분류기의 선택을 `proposed_rung` 으로, `overridden_by` 를 `"user"` 또는 `"committee"` 로, 그리고 ballot 해소 행을 기록한다. **override 뒤에 `computeRoute` 를 다시 실행하지 않는다.** **ballot 은 분류기 자신의 출력 위에서 닫혀 있으므로**, 두 선택지가 모두 **계산된 생존자**이며 override 는 어느 것이 실행될지를 바꿀 뿐 **분류기가 만들지 않은 rung 을 결코 도입하지 못한다**.

### 4.7 승격은 한 방향이다

**승격은 `R-STEP → R-ORCH` 와 `R-PLAN → R-ORCH` 두 방향뿐이다. 하향은 거부된다.** 게이트는 **전이가 아니라 이미 착지한 것**의 함수다. 저널이 하향을 허용하지 않기 때문이다 — `complete` 는 append 전용이고 역방향 간선이 없으며 재개는 완료된 wave 를 영원히 건너뛴다.

**E1 · `R-STEP → R-ORCH`** 의 두 trigger:

| trigger | 관측 시점 | 그 순간의 비용 |
|---|---|---|
| (a) SDS 가 200줄 상한에 접근 | 자식 Phase 2, **첫 red 테스트 전** | 거의 0 — 아무것도 커밋되지 않았다 |
| (b) 기존 body 요구 편집이 감지되거나 `promote_step_requirement` 가 `MUTATION_DENIED` 반환 | 자식 **Phase 6**, green 이후 | **구현이 이미 작성되어 있다** |

promote 의 `EVIDENCE_REQUIRED` 와 merge 의 `COMPLETION_GATE_BLOCKED` 는 **trigger 가 아니다**. 그것들은 run 안의 결함이고, **품질 실패로 승격하면** 막힌 run 이 rung 이 떨어질 때까지 기어오른다.

**E2 · `R-PLAN → R-ORCH`** 의 세 trigger: 한 Task 에 `NEEDS_USER` 3회가 누적되고 그 해소가 **존재하지 않는 요구가 필요하다**인 경우; **선행 작업 부재를 지명하는 `FAILED` 반환**; 그리고 자식의 lifecycle 게이트가 **빈 활성 target 에서 멈추는 경우** — 이것은 D7 이 intake 에서 잡았어야 하므로 **분류기 결함**이다. `deprecated`/`frozen` 분기는 계획 술어가 허용하는 유일한 sidecar 형태에서 **도달 불가**이므로 **의도적으로 trigger 가 아니다**.

**모든 승격은 `routing/misroute-{n}.json` 을 기록한다** — probe id, trigger, **발화했어야 할 술어**, 그리고 그 술어가 **필요로 했을 값**. E1 의 두 번째 trigger 와 E2 의 빈 target trigger 에서는 anchor 가 맞았어야 할 파일과 관측된 anchor coverage 도 함께 지명한다.

**carry manifest.** step 의 `design.md` 와 `intent.md` 는 1.d 의 연구 입력이 되고 그 뒤 wave 마다 `--research-doc` 인자가 된다. green 이후 trigger 에서는 병합된 테스트와 구현이 **통합 브랜치에 남고** `R-ORCH` 설계 기준선에 `out_of_scope` 와 `exclusion_class = "already-implemented"` 로 봉인된다. **green 구현은 결코 Task 로 다시 계획되지 않는다** — 모든 코드 Task 는 **의무적 red 확인**을 거치는데 옮겨온 green 코드는 그것을 통과하지 못한다. **`already-implemented` 봉인은 `--auto` 라도 `out-of-scope-user-consent` 를 발화시킨다.** 분모에서 작업을 덜어내는 승격은 **조용할 수 없다**.

**`R-STEP` 승격의 lease 위생**: 오케스트레이터는 `update_step_state(<task>, "abandoned")` 를 호출하고 `update_step_state(<task>, "merged")` 는 호출하지 않는다. step 의 요구는 대신 `$kiwi-srs` 가 **body scope 에 저작**하기 때문이다.

`route-escalation-after-landed-state` 는 §0.G 에 선언되어 있고, 승격이 통합 브랜치의 커밋 또는 요구의 `status` 나 `stability` 를 움직인 SRS mutation 뒤에 올 때 발화한다. **첫 red 테스트 전에 감지된 승격은 자유이며 게이트가 없다.**

`route-deescalation-refused` 도 §0.G 에 선언되어 있고 Phase 3.b 이후 rung 을 내리려는 모든 시도에서 발화한다. **유일하게 합법인 하향은 Phase 2 끝의 `route-downgrade-available` 이고 그 뒤로는 없다.** 최종 출구는 `abort-run` 이며, **통합 브랜치와** `docs/research/{work}/` 에 이미 쓰인 모든 것을 그대로 두고 **run lock 을 해제**한 뒤 그 상태를 **run 리포트에 지명**한다.

**재개 시 rung 은 `frozen.route.rung` 에서 읽고 결코 다시 계산하지 않는다.** `frozen.route.probe_digest` 가 `probe.json` 과 불일치하면 `run-invariant-drift`(critical)다. **재개 세션에는 대화도 조사자도 없으므로** `computeRoute` 는 run 당 **정확히 한 번** 실행된다.

---

## 5. Phase 1 — intake

### 5.1 세 단계

1. **소스 분류** — **닫힌 분류**다. **얇은 의도**, **연구 또는 설계 문서**, **GitHub 이슈** 셋뿐이고 각각 자기 동사를 갖는다: `intake-qna` · `intake-document` · `intake-issue`.
2. **조사** — **조사자 3 기를 병렬로** 실행한다. stance 는 **intent** · **code-context** · **architecture-fit** 셋이며 동사는 `intake-investigate` 다.
3. **갭 열거** — **조사자가 닫지 못한 갭은 전부 사용자에게 QnA** 로 낸다.

intake 기록은 `01.intake.md` 에 쓴다. **loop D** 의 열린 질문 **분모**는 이 문서의 미해소 항목에서 계산된다(§6.2).

### 5.2 `--auto` 아래에서 위원회가 답한 intake 질문

`--auto` 때문에 intake 설계 질문을 사용자가 아니라 위원회가 답하면, 그 사실을 **세 곳에** 기록한다. **셋 중 둘만 기록하는 것은 이 규칙을 만족시키지 못한다.**

1. **Phase 0 고지** — run 헤더에 `--auto` 가 유효하며 설계 질문을 사용자가 아니라 위원회가 답한다고 적는다. 그리고 별도로 **Phase 1.c 줄**에 갭 열거가 산출한 **실제 질문 개수**를 적는다. 개수는 갭 열거 전에 존재하지 않으므로 **Phase 0 헤더에 개수를 넣지 않는다**;
2. `00.run-contract.md` 의 **`intake_autonomy` 블록** — **Phase 1 끝** 수정에서 기록하며 세 가지를 담는다: `--auto` 가 설계 질문에 답했는지, **몇 개인지**, per-decision **감사 기록이 어디** 있는지;
3. 위원회가 결정한 intake 행마다 `kiwi/waves.jsonl` 한 줄 — v1.4.0 `decision` 필드 위에 `question` · `options` · `decision` · `rule` · `committee_size` · `confidence` 와 `origin: "intake"` **일곱 키를 전부** 운반한다.

이 라우팅은 **기록된 이탈**이지 **사용자가 수락한 저하가 아니다**. 어떤 사용자도 수락하지 않았고 설계가 선택했다. 세 기록은 이 이탈의 격상이 어떻게 판정되든 그대로 유지된다. `design-intake-insufficient` 는 loop D 의 **cap 소진**에 `needs-decision` 또는 `contradicts-existing` 행이 열려 있을 때 그대로 발화한다 — 기록은 기존 게이트를 대체하지 않고 보완한다.

---

## 6. 설계 문서와 loop D

### 6.1 `design/00.design.md` — 표시된 구조

run 의 설계 문서는 **영문**으로, **body scope** 작업으로 저작한다. `tdd` 모드의 step 스코프 라우팅은 오케스트레이터 자신의 wave 흐름을 다시 라우팅하지 않는다.

마킹 규칙:

- 설계 항목은 **최하위 heading 아래의 최상위 목록 행**이며 `[D-nnn]` 로 시작한다. 통합 항목은 `[I-nnn]` 을 쓰고 같은 규칙을 따른다. id 는 **고유하고 연속이며** 한 run 안에서 **재사용되지 않는다**;
- 표시된 항목은 **정확히 한 개의 규범 토큰 출현**을 담는다. `MUST NOT` 은 한 번으로 세고 두 번으로 세지 않는다. **출현이 없는 항목은 거부되고 둘인 항목은 쪼갠다**;
- **인용문과 코드펜스 내용은 항목 스캔과 미표시 산문 스캔 양쪽에서 제외**된다;
- 최하위 heading 아래 문단이 `[D-nnn]` 또는 `[I-nnn]` 행 **밖에서** 규범 토큰을 운반하면 `unmarked-normative-prose` 를 올린다. 경고가 아니라 **critical 게이트**이며 **정확한 줄 번호를 지명**한다. 구제책은 **그 줄을 표시하거나 다시 쓰는 것 둘뿐**이다.

경고가 아니라 게이트인 이유: 누락은 조용하고 개수는 하중을 진다. **적게 센 `design_items[]`** 는 loop D·W·P·F 의 모든 **동결 분모를 줄이는데** `invariant_digest` 는 드리프트를 보고하지 않으므로 설계 안의 다른 어떤 것도 이를 잡지 못한다.

**`P-DESIGN-FROZEN` 이 성립하기 전에는 어떤 구현 동사도 실행되지 않는다.** 위반은 `design-not-frozen` 이다. 순서는 **동결 다음 구현**이며 그 반대가 아니다.

### 6.2 loop D 의 동결 분모

**정확히 세 집합**이며 **라운드 1 전에 외부에서 계산**되고 라운드 진입 시 동결되며 **검증자가 계산하지 않는다**.

1. **열린 질문 집합** — `01.intake.md` 의 모든 미해소 항목, 즉 QnA 잔여분에 `$kiwi-srs-research` 가 보존한 모든 **이견 항목**을 더한 것;
2. **구현가능성 집합** — `[D-nnn]` **설계 항목마다 한 행**, verdict 는 닫힌 3값 `implementable` · `needs-decision` · `contradicts-existing`. **`contradicts-existing` 은** 기존 코드베이스를 가리키는 **`file:line` 포인터를 요구한다** — 없으면 finding 이 아니라 **의견**이다;
3. **제약 집합** — **비어 있어도 항상 기록되는** `design/constraints.json`.

**PASS 는 다섯 연언이 모두 성립할 때다**:

1. 모든 열린 질문이 **답 포인터로 해소**되었거나 지명된 사유로 유예되었을 것;
2. `needs-decision` 0;
3. `contradicts-existing` 0;
4. 제약 위반 0;
5. 그 라운드에서 **어떤 수정도 적용되지 않았을 것**.

**`needs-decision` 행을 낸** `verify-design` 라운드는 그 행을 질문으로 삼아 `intake-qna` 동사로 되돌아가고 루프가 **재진입**한다. 이것이 "설계가 아직 약한 곳은 사용자에게 묻는다"가 실제로 일어나는 자리이며, 열망이 아니라 동사다. cap 이 `needs-decision` 또는 `contradicts-existing` 행을 남긴 채 소진되면 `design-intake-insufficient` 다.

---

## 7. Phase 2 — 분해, 수렴 레시피, 거부 하한

### 7.1 wave 분할

`wave-decomposition.md` 를 그대로 따른다. artifact root 는 `docs/research/{work}/` 다. 2.b 는 설계 기준선과 `design/constraints.json` 을 기록하고 후자는 비어 있어도 기록한다.

### 7.2 수렴 레시피와 lane 적격

모든 수렴점은 **닫힌 4값 enum** 에서 `recipe.kind` 를 선언한다: `exclusive-lane` · `orchestrator-only` · `regenerate` · `replay`. 그 enum 의 recipe 를 갖지 않은 수렴점은 Phase 2.c 에서 `convergence-without-recipe` 로 거부한다.

lane 적격은 매칭된 수렴점의 `recipe.kind` 에서 결정하며 **가장 제약적인 것이 이기는 우선순위**를 따른다.

```
orchestrator-only > replay > regenerate > exclusive-lane
```

이 순서는 경로를 레지스트리에 매칭하는 **모든 자리에서 동일하게 적용**한다.

| recipe.kind | lane 적격 | 결과 |
|---|---|---|
| **`exclusive-lane`** | 적격 | wave 전체 **유일성 제약** 아래 — 그 단위를 건드리는 모든 task 가 **한 lane 으로 강제**된다 |
| **`orchestrator-only`** | 부적격 | task 를 `serial_epilogue` 로 보낸다 |
| **`regenerate`** | 부적격 | task 를 `serial_epilogue` 로 보낸다 |
| **`replay`** | 부적격 | task 를 `serial_epilogue` 로 보낸다 |

phase 1 에서 부적격 분류는 단위의 실행 *위치* 를 바꾸고 *실행자* 를 바꾸지 않는다. `serial_epilogue` 집합은 wave 안에서 **order-last** 로 **3.k activity (0)** 에서 실행된다. 실행자는 모든 단위가 쓰는 같은 host 실행자다.

**phase 2 절은 여기 없고 이연으로 지명한다**: `orchestrator-only` 경로를 **병합 시점에 경로별로 복원**하거나 제거하는 것, 그리고 host root 에서의 **지연 mutation replay** 는 `2.6.0-phase2-parallel-lanes` 다.

### 7.3 거부 하한과 유일하게 합법인 하향

거부 하한은 **Phase 2 끝**에서 평가한다. phase 1 의 기본 실행이 이미 직렬이므로 **`--serial` 로의 저하를 제안하지 않고 오케스트레이터가 동시성을 끈다고 말하지도 않는다**. 하한에서의 **유일한 명시적 거부는 `decomposition-input-missing`** 이다.

`route-downgrade-available` 은 `business-decision` 이고 §0.G 표 밖이며, Phase 2 끝에서 거부 하한 평가와 나란히 **세 조건이 모두 성립할 때** 발화한다.

1. 분해가 정확히 **wave 하나**를 돌려주었다;
2. 1.c′ 에서 **어떤 disqualifier 도 `R-STEP` 을 제거하지 않았다**;
3. 이 run 의 어떤 SRS mutation 도 요구의 **`status` 나 `stability` 를 움직이지 않았다**.

세 번째 조건은 **통합 브랜치 커밋의 부재가 아니다**. 이유를 함께 적는다: 모든 run 이 통합 브랜치에 `commit-run-artifacts` 커밋을 착지시키므로 커밋 기반 조건은 **항상 거짓**이 된다.

wave 의 **`design_items` 개수는 게이트 증거에 실려 나가고 어떤 술어도 구동하지 않는다.** 설계 항목 규모에 대한 네 번째 조건은 없다.

**선택지는 정확히 둘이다**: `continue-orchestrated` — **구조화 필드 `recommended: true` 를 운반** — 와 `downgrade-to-step`. 표식이 비싼 쪽에 붙어 있으므로 `--auto` 는 위원회 없이 그것을 채택하고 **무인 실행을 조용히 하향시키지 않는다**.

**합법 구간**: 이 게이트는 **2.e 에 존재하고 그 뒤 어디에도 없다**. Phase 3.b 이후에는 `route-deescalation-refused` 가 대신 적용된다.

**`downgrade-to-step` 이 하는 일**: 영속 work-mode 가 tdd 가 아니면 `route-step-requires-mode-switch` 를 **다시 올려** 모드 전제조건을 우회하지 않고 `switch-and-step` 만 진행시킨다; 동사 `downgrade-route` 와 **append-new-artifact** 규칙 아래 rung `R-STEP` 을 담은 **새** `routing/route.lock.json` 을 쓰며 새 digest 가 `invariant_digest` 에 다시 들어간다; 그리고 `design/00.design.md` 와 분해 결과를 **매몰 아티팩트**로 디스크에 남겨 run 리포트에 지명하되 `kiwi-tdd` 에 넘기지 않는다.

---

## 8. Phase 3.a — wave 설계 문서와 loop W

wave 마다 `waves/wave-{n}/design.md` 에 **영문**으로 wave 설계 문서를 저작한다. 3.a 에서 쓰고 loop W 가 검증한다.

- **검증자 1 stance**: 그 wave 의 `design_items` **커버리지**.
- **검증자 2 stance**: **동결된 설계 lock 에 대한 내부 정합성**.
- **동결 분모**: **그 wave 의 `design_items` 조각**.

**loop W 는 3.b 의 `$kiwi-srs` 등록 전에 통과해야 한다.** **3.a 가 3.b 앞이고**, 3.b 는 이 문서를 자기 **연구 문서로 소비한다**. cap 소진은 `wave-design-insufficient` 를 올리며 **통과로 세지 않는다**.

wave 설계 문서는 run 설계 문서와 **같은 표시 항목 규칙** 아래 있다. `[D-nnn]` 또는 `[I-nnn]` 행 밖의 규범 문장은 **3.a** 에서 `unmarked-normative-prose` 를 올린다.

---

## 9. Phase 3.f — handoff 문서

### 9.1 스키마

lane 마다 handoff 하나를 `waves/wave-{n}/lanes/lane-{k}.md` 에 **영문**으로 쓴다. handoff 본문과 `escalation` 필드와 모든 `acceptance[].untested_reason` 에 비-라틴 문자가 있으면 — **코드펜스**·인라인 코드·인용 내용은 제외하고 — `handoff-not-english` 다.

YAML front matter 와 **정확히 열 개의 필수 본문 heading** 을 이 순서로 갖는다.

`## Setup` · `## Objective` · `## Context` · `## Interfaces` · `## Tasks` · `## Acceptance` · `## Constraints` · `## Out of scope` · `## Manifest` · `## Escalation`

그것이 **열 개**다 — 문장의 수와 목록의 수가 같다. **아홉이나 열하나를 지명하는 본문은 잘못이다.**

**`base_sha` front matter 필드를 담은 handoff 는 거부된다.** 이유: 커밋의 sha 는 **그 커밋 자신의 트리에 대한 해시**이므로 **그 커밋 안의 어떤 파일에 쓴 값도 그것과 같을 수 없다**. `## Setup` 은 **base 커밋이 이미 checkout 되어 있다고만 적고 sha 를 지명하지 않는다**. 그것과 비교하는 `dod` 절은 handoff 필드가 아니라 **원장이 공급한 값**을 가리킨다.

**stage 의 dispatch base sha 는 원장이 운반한다** — 그 stage 의 **3.f′ 커밋의 sha** 이며 wave 당이 아니라 **stage 당**이다. 저널의 `isolation.base_sha` 와 재개 카드의 `open[].base_sha` 양쪽에 기록한다. phase 1 의 단위는 **통합 브랜치가 이미 checkout 된 host 에서 실행**되므로 spawn prompt 운반 절은 여기 없고 `2.6.0-phase2-parallel-lanes` 로 지명된다.

### 9.2 `validateHandoff` — 다섯 기계적 계층

handoff 는 `validateHandoff` 의 **다섯** 기계적 계층으로 검증하며, 어느 계층이 적용되는지는 **`handoff_kind` 가 결정한다**.

1. **완전성** — task 마다 **열세 필드**가 있어야 한다. `expected = 13 × |task_ids|`.
2. **부분집합이 아니라 상등** — `task_ids` 와 `write_set` 이 그 `handoff_kind` 의 배정과 **같아야** 한다.
3. **영문 전용** — 지명된 분모 위에서.
4. **해소가능성** — 참조 해소 지점은 **3.f 의 HEAD 에 3.f′ 가 stage 하려는 경로 집합을 더한 것**이며, **아직 존재하지 않는 sha 에 대해 해소하지 않는다**.
5. **비-공허 acceptance** — `acceptance[]` 가 비지 않고, `test_id: null` 행 수가 상한 안이며, 모든 null 행이 `untested_reason` 과 `untested_owner` 를 갖는다.

### 9.3 loop H

- **검증자 1 — 완전성과 충실성.** 동결 분모: **task 당 열세 필드** 와 그 lane 에 배정된 **설계 항목**. 검증자가 보고한 checked 수가 expected 와 다르면 **그 라운드는 무효**다.
- **검증자 2 — 차가운 에이전트 실행가능성.** 동결 분모: lane 의 `write_set` ∪ `test_id: null` 을 운반하는 `acceptance[]` 행. **`write_set` 만 적는 본문은 잘못이다** — 2항목 write set 에 null 행 하나면 검증자 2 는 분모 2 에 대해 3 행을 내고 매 라운드가 무효가 되어, 정당하게 미검증인 acceptance 하나를 가진 모든 wave 가 통째로 직렬화된다.
- **실행가능성 프로브는 마지막 라운드에서만** 실행한다 — 서브에이전트 비용이 들기 때문이다. 서브에이전트에게 **handoff 문서만** 주고 실행할 파일 변경 계획을 내게 하며 **어떤 편집도 적용하지 않는다**. 그 파일 집합을 `write_set` 과 비교하고, 불일치는 **코더 결함이 아니라 handoff 결함**이다.

**PASS 는 네 연언이다**:

1. `validateHandoff` 가 ok 를 반환할 것;
2. 두 분모가 모두 완결일 것;
3. 병합된 CRITICAL 과 HIGH 가 0 일 것;
4. 그 라운드에서 **어떤 수정도 적용되지 않았을 것**.

**phase 1 에서 실행가능성 프로브가 여전히 불일치인 채 cap 이 소진되면 `handoff-verify-failed` 가 바로 발화하며 강등을 시도하지 않는다.** 모든 단위가 이미 직렬로 실행되므로 **강등할 곳이 없다**.

---

## 10. Phase 3.g — host root 직렬 실행

이 대상의 구현은 **host root 에서 run 의 통합 브랜치 위에 직렬로** 실행한다 — 동결된 분할의 단위 하나씩, **stage 순서**로, stage 안에서는 **lane-id 순서**로, 각각을 기다린 뒤 다음을 시작하며, handoff 하나당 `$kiwi-pm` 한 번이다. 따라서 이 run 은 **벽시계 단축을 제공하지 않는다**. 그럼에도 per-task **병렬화 분석**은 wave 마다 전부 산출되고 **동결**되고 **공개**되고 **검토**된다.

```
$kiwi-pm --handoff docs/research/{work}/waves/wave-{n}/lanes/lane-{k}.md
         --session-suffix w{n}s{s}l{k} --no-final --no-pipeline-emit --commit-lane-work
         [--resume] [--auto] [--max] [--model <name>] [--mini|--loops N]
         [--regression-baseline <the P.4 pin>]
```

### 10.1 동시 dispatch 와의 여섯 차이, 각각 사유와 함께

1. **worktree 도 unit 브랜치도 없다** — 격리할 대상이 없다. 정확히 한 단위만 실행 중이다.
2. **`--defer-srs-mutation` 을 전달하지 않는다** — 병렬 task 가 없으므로 `kiwi-coder` 의 네 의무 MCP mutation 이 원래 있어야 할 자리, 즉 **host root** 에서 run 자신의 target 을 상대로 실행된다.
3. **클레임 감사가 없다** — 통합 브랜치의 **커밋 범위**가 곧 기록이고, 그것은 보고된 것이 아니라 **파생된 것**이다.
4. **`--commit-lane-work` 는 여전히 필수**다 — 없으면 `kiwi-pm` 이 **아무것도 커밋하지 않아** wave 의 산출물이 커밋되지 않은 워킹 트리로 남고 다음 단위가 그것에 걸려 넘어진다.
5. **커밋은 다섯 `Orch-*` trailer 를 유지한다** — `Orch-Run` · `Orch-Wave` · `Orch-Stage` · `Orch-Lane` · `Orch-Task` — 그리고 **subject 표식을 담지 않는다**.
6. **비-코드와 SRS 쓰기 스케줄링 edge 는 여전히 발화하고 더 약한 것을 뜻한다** — 그것들은 단위의 **위치**를 바꾸며, 그런 task 는 `serial_epilogue` 에 착지해 3.k 에서 order-last 로 실행된다. **실행자**는 바뀌지 않는다.

### 10.2 `serial-unit-failed` 의 세 disjunct

- 단위의 `verification_cmd` 가 **같은 handoff 로 1회 재시도한 뒤에도** 비-0 으로 끝났다;
- 단위가 **커밋을 하나도 만들지 않았고** 그 `$kiwi-pm` 실행 자신의 `docs/analysis/` 번들에 `intentionally_empty` 사유를 선언하지도 않았다;
- 그 `$kiwi-pm` 이 `NEEDS_USER` 또는 `FAILED` 를 반환했다.

### 10.3 `intentionally_empty` 처분

**단위별이 아니라 task 별**이며 운반체는 그 단위의 `docs/analysis/kiwi-pm-…` 번들이다. 항목은 task id 와 **20자 이상의 `reason`** 을 담는다.

**허용 조건은 두 연언이다**: 그 task 의 `verification_cmd` 가 0 으로 끝나고, 그 task 의 `write_set` 의 어떤 경로도 단위의 base 와 head 사이에서 **달라지지 않았을 것**. 두 번째 연언은 **단위의 주장이 아니라 오케스트레이터가 트리에서 다시 계산한다**.

**처분은 `checked` 이지 `expected` 에서의 제거가 아니다.** task 는 `expected` 에 남고 위 두 연언 위에서 `checked` 에 들어간다. 승급(§14)에서는 **landed** 로 세되 `type="test"` 증거만 갖고 **`type="commit"` 참조는 없다**.

### 10.4 분할 검토와 재개 계약

분할은 **3.e′ 에서 동결되고 공개되고 wave 마다 검토된다**. `partition-review-unrecorded`(critical)는 **3.e′** 에서 동결된 lane 계획 **digest** 와 같은 digest 를 기록하고 verdict 가 `pass` 인 `review-partition` result line 이 없는 wave 를 거부한다.

실행자의 재개 계약: 동사는 `execute-unit` 이고 recovery class 는 externally-visible 이다. `--resume` 은 `.kiwi/sessions/{plan_run_id}/lanes/w{n}s{s}l{k}/pm-state.json` 이 존재할 때 전달한다.

---

## 11. Phase 3.k — wave 마감

### 11.1 중복 감사

charter 의 무-중복 요구는 **선적된 탐지 기제 하나, 선적된 결합 기제 하나, 그리고 기록된 부재 하나**로 이행한다.

중복 감사는 **Phase 3.k activity (2) 에서**, wave 의 serial-epilogue 집합이 **activity (0) 에서 실행된 뒤**에 실행된다. phase 1 의 입력은 **통합 브랜치 위 이 wave 의 커밋 범위를 모든 단위의 `write_set` 합집합으로 제한한 것**이다 — **lane diff 의 합집합이 아니다**. lane diff 가 없기 때문이다.

산출물은 `waves/wave-{n}/duplication-audit.md` 이고 finding 마다 한 행이 `symbol_or_block` · `lanes[]` · `paths[]` · `verdict` 를 담는다. verdict 는 **닫힌 3값** `duplicate` · `parallel-evolution` · `acceptable` 이다.

`duplicate` 행의 해소는 **정확히 두 형태**만 허용한다.

1. activity (0) 에서 **이미 실행된** epilogue task 의 id 로서 그 커밋이 해당 블록을 통합한 것;
2. `issue:{id}` — 이 wave 의 `issues.md` 에 열린 `local-defect` 행을 지명하는 것.

**메모는 해소가 아니다.** 둘 중 어느 것도 아닌 `duplicate` 행에서 `cross-lane-duplication-unresolved` 가 발화한다.

verdict 는 **기록된 서브에이전트 판단이고, 도구는 산출된 후보마다 닫힌 enum 의 verdict 가 기록되었는지만 검사한다**.

**무-중복의 예방 절반은 주장하지 않고 부재로 기록한다.** 파일 수준에서는 `write-set-overlap` 이 이미 선언된 표면 전부를 덮고, 심볼 수준에서는 어떤 planner 출력도 **심볼을 운반하지 않는다**. 이 부재는 **X-04** 로 격상되어 있다. `shared-substrate` 충돌 사유도 그에 딸린 게이트도 선언하지 않는다.

### 11.2 3.f″ cross-lane 결합 검사

**술어**: 한 stage 안에서 어떤 경로가 **한 lane 의 `write_set` 에 있고 다른 lane 의 `read_set` 에 있다**.

**행동**: **append-new-artifact** 규칙 아래 `lanes.lock.json` 을 다시 동결해 두 lane 을 하나로 합치고, 영향받은 handoff 를 **다시 저작**하고, **loop H** 를 다시 실행한다. **3.e′ 의 분할 검토 verdict 는 다시 구하지 않는다.**

**한계**: **stage 당 1회**. 같은 stage 에서 두 번째 적중은 `stage-coupling-unresolved` 다 — 재분할이 두 번 필요한 stage 는 결합된 것이 아니라 잘못 분할된 것이다.

### 11.3 wave 마감의 `validate` → `sync-index`

`speckiwi validate` 다음 `sync-index` 를 **wave 당 정확히 한 번, Phase 3.k activity (3)** 에서 실행한다 — 그 wave 마지막 stage 의 마지막 단위가 실행된 뒤, wave 의 `serial_epilogue` task 집합이 **3.k activity (0) 에서 실행된 뒤**, 그리고 **3.l 의 loop P 앞**이다.

두 명령의 순서는 **`validate` 가 먼저, `sync-index` 가 나중**이다.

`sync_index` 가 실행된 뒤에도 `validate --fail-on-warning` 이 드리프트를 보고하면 `post-merge-index-drift` 로 run 을 중단한다.

**이 run 은 phase 1 에서 병합을 수행하지 않는다.** charter C4 의 "모든 병합 뒤" 의무는 따라서 SRS 에 영향을 주는 작업이 착지한 지점, 즉 **wave 마감 지점**에 붙는다. 이 절이 폐기되었다고 읽히지 않도록 함께 적는다. **per-merge 부착은 `2.6.0-phase2-parallel-lanes` 에서 돌아온다** — per-lane merge 나 `integrate-lane` 단계에 의무를 붙이지 않는 것은 **이연이지 삭제가 아니다**.

---

## 12. Phase 3.l — loop P

### 12.1 증거 번들과 다섯 동결 분모

증거 번들은 `kiwi-wave-master` 의 기존 행에 더해 `lanes.lock.json` 과 wave 의 모든 handoff, `Orch-Lane` 과 `Orch-Task` trailer 로 키잉된 `frozen.integration_branch` 위 이 wave 의 **커밋 범위**, 그리고 각 단위의 `docs/analysis/kiwi-pm-…` 번들을 담는다. `00.charter.md` 와 `01.intake.md` 도 번들에 들어간다.

**다섯 동결 분모**: REQ/AC · wave 의 **설계 항목** · **제약** · **보존 계층** · **단위 계층**. 여기에 검증자 1 의 설계 계층을 확장하는 **의도 계층**이 더해진다. **네 분모만 지명하거나 의도 계층을 빠뜨린 본문은 잘못이다.**

**의도 계층**: `expected` 는 **loop D 의 열린 질문 집합**, `checked` 는 실행 결과가 **여전히 그 해소를 지키는** 행들이다.

**단위 계층은 하위 분모 하나**이며 둘로 쪼개지 않는다.

- `expected` = `lanes.lock.json` 이 **lane 에**, `serial_epilogue` 에, `unassigned` 에 배정한 모든 task 의 합집합;
- `checked` = 통합 head 에서 도달 가능한 커밋에 `Orch-Task` trailer 를 운반하고 **그리고** `verification_cmd` 가 통과한 모든 task, 여기에 허용 가능한 `intentionally_empty` 선언을 운반하는 모든 task 를 더한 것. 그런 task 는 `expected` 에 남고 `checked` 에 들어가며 **`expected` 에서 제거되지 않는다**.

**phase 1 은 증인이 하나이고 phase 2 는 둘이다.** **클레임 감사 연언은 phase 1 대응물이 없다.** 이 축소를 조용히 없애지 않고 기록한다.

계획되었으나 **착지하지 않은 task 하나가 `ALL_MATCH` 를 금지한다**.

`unapproved-damage = 0` 과 `failing_tests ⊆ baseline_failing_tests` 는 통과 전제조건으로 유지된다. 실행 단위 자신의 **worklog `TASK_DONE` 은 `checked` 의 연언으로 인정하지 않는다** — 같은 주체가 쓴 것이므로 독립성을 더하지 않는다.

### 12.2 진동

공용 검증 엔진(`verify-loop.md`)은 같은 `finding_id` 가 2 라운드 이상에 걸쳐 닫혔다 다시 열리거나 같은 hunk 가 되돌려졌다 다시 적용되면 남은 라운드 cap 을 소진하지 않고 **즉시 종료**한다. `verdict = fail-residual` 과 `reason_class` 값 `oscillation` 을 함께 기록하고 `verification-oscillation` 을 올린다. 이 규칙은 엔진에 있으므로 phase 1 의 D·W·H·P·F 모든 루프에 도달한다.

---

## 13. Phase 3.m — wave 경계 이슈 프로토콜

### 13.1 입력 합집합

3.m 의 분류 입력은 loop P 의 `verification.residual[]` 만이 아니라 run 이 산출한 **모든 pre-merge 검증 루프의 잔여분** — **loop D · W · H** — 을 함께 담는다. 공용 엔진에 **pass-with-residual** 로 닫는 경로가 있고 모든 루프가 그것을 쓰므로 **통과한 루프도 잔여를 운반할 수 있다** — 합집합은 깨끗한 run 에서도 **공허하지 않다**.

**loop L 의 잔여는** loop L 자체와 함께 `2.6.0-phase2-parallel-lanes` 에서 합집합에 합류한다. phase 1 에는 loop L 이 없으므로 **phase 1 출처로 열거하지 않는다**.

합집합에 들어온 잔여는 아래 **닫힌 6값 분류**를 받고 `P-WAVE-ISSUES-CLOSED` 의 적용을 받는다. 분류되지 않은 잔여는 3.m 에서 `wave-issues-open` 을 발화시킨 채로 남는다.

### 13.2 닫힌 분류 목록

`wave-issue-triage` 는 **3.m 에서, loop P 뒤·`promote-requirements` 앞**에 실행되며 `waves/wave-{n}/issues.md` 와 생성된 `issues.lock.json` 을 쓴다. **모든 이슈는 정확히 하나의 분류를 받고 목록은 닫혀 있다.**

| class | 뜻 | 경로 |
|---|---|---|
| **`local-defect`** | 코드가 틀렸고 설계는 맞다 | wave 창에 대한 `$kiwi-review-fix-loop`, **다음 wave 전에 해소** |
| **`missing-task`** | 설계는 맞고 계획이 불완전하다 | `--req-filter` 와 `--plan-run-id` 를 함께 준 pipeline 재진입, **다음 wave 전에 해소** |
| **`design-gap`** | 설계가 덜 규정되었다 | 설계 항목을 **새 아티팩트**로 덧붙이고 증분 `$kiwi-srs`, 계획부터 재진입. 새 `00.design.lock.json` 을 쓰고 `invariant_digest` 가 정당하게 바뀐다 |
| **`new-wave-required`** | 자기 wave 가 필요하다 | wave 를 추가한다. **run 당 3개 상한**, 초과는 `wave-append-cap-exhausted` |
| **`design-contradiction`** | 설계 항목이 **거짓**이다 | `design-contradiction-at-wave-boundary`. 중단하고, 모순되는 두 `[D-nnn]` id 를 **증거와 함께 지명**하고, `abort-run` 으로 run 을 끝낸다 |
| **`out-of-run`** | 어느 wave 에도 속하지 않는다 | 닫힌 어휘의 `exclusion_class` 와 함께 기록 |

### 13.3 `P-WAVE-ISSUES-CLOSED`

다음 wave 의 Phase 3.a 는 이 전제조건에 막히며 **`orchestrate wave close --wave N` 이 평가**한다. **네 연언이다.**

1. 모든 이슈가 **종단 분류**를 갖는다;
2. 모든 `local-defect` 와 `missing-task` 가 **해소 증거** — 해소 가능한 `file:line`, **테스트 id**, 또는 **커밋 sha** — 를 갖는다;
3. 모든 `design-gap` 이 새 설계 lock digest 를 지명한다;
4. 모든 `out-of-run` 과 `new-wave-required` 가 **기록된 사용자 결정**을 갖는다.

**유예는 자유로운 탈출구가 아니다. `out-of-run` 은 `--auto` 라도 사용자 동의를 요구한다.** `--auto` 나 위원회가 이를 대신 이행할 수 없다.

**기록된 한계**: 도구는 분류의 **형식**을 검사하고 그 **옳음**을 검사하지 않는다. 보상 장치는 **다음 wave 의 loop P** 가 이전 wave 의 `out-of-run` 항목을 다시 검사하는 것이다.

### 13.4 mid-wave — 실행 단위가 설계 항목을 반증했을 때

동결된 `[D-nnn]` 설계 항목을 기술대로 구현할 수 없다고 판단한 단위는 **`design_item_id` 와 증거를 보고하고 멈춘다**. `lane-design-refuted`(critical)를 **Phase 3.g** 에서, 보고 주체가 epilogue 일 때는 **Phase 3.k activity (0)** 에서 올린다.

phase 1 의 운반체는 **실행 단위의 보고**이며 **lane manifest 의 `status: design-refuted` 가 아니다**. 그 단위의 커밋은 `frozen.integration_branch` 에 **되돌려지지 않은 채 그대로 남는다** — lane 브랜치가 병합되지 않은 채 보존되는 것이 아니다. `execute-unit` result line 에 기록되는 phase 1 의 **`lane_disposition` 종류는 `refuted`** 다.

**승인된 mid-wave 설계 수정**은 `amend-design` 동사로 쓴다.

1. 수정본을 **새** `design/00.design.{seq}.md` 로 저작하고 **새** `00.design.lock.json` 으로 동결한다. **어느 쪽도 제자리에서 편집하지 않는다.**
2. **옛 lock digest**, **새 lock digest**, 반증된 `[D-nnn]`, 그리고 보고 단위의 **증거**를 지명하는 **저널 줄을 append** 한다.
3. 카드의 `frozen.design_lock` 포인터가 새 lock 으로 옮겨가고 `invariant_digest` 를 다시 계산한다. 그래서 `run-invariant-drift` 는 digest 가 **카드가 현재 지시하는** lock 과 불일치할 때에만 발화한다 — **포인터를 그대로 두면** 정당한 수정이 드리프트로 읽힌다.
4. 옛 설계 항목 위에 동결되었던 loop **W · P · F** 의 분모를 새 lock 에서 **다시 동결**하고 영향받은 라운드를 **다시 시작**한다.
5. 영향받은 각 단위는 **새로 저작한 handoff** 위에서 **`execute-unit` 한 번**으로 다시 계획되고 실행된다. **재-dispatch 상한 1 은 phase 2** 내용이며 여기에 적용되지 않는다.

**mid-wave 수정은 wave 당 2회로 제한된다.** **세 번째는 `design-contradiction-at-wave-boundary` 로 분류된다.**

---

## 14. Phase 3.n — 요구 승급

승급은 **wave 당 한 번, host root 에서, Phase 3.n 에**, 그리고 **loop P 의 3.l verdict 가 `pass` 인 뒤에만** 일어난다.

**집합**: 그 wave 의 Phase 3.b 배정 집합을, sidecar task 가 하나도 빠짐없이 landed 한 요구로 제한한 것. phase 1 에서 **landed** 는 `frozen.integration_branch` 위에서 그 task 의 `Orch-Task` trailer 를 운반하는 커밋과 통과한 `verification_cmd`, 또는 허용 가능한 `intentionally_empty` 선언이다. **`git-ancestor` 증명이나 통과한 클레임 감사로 landed 를 정의하지 않는다.**

**두 단계 전이**:

| From | To | 조건 |
|---|---|---|
| `planned` / `in_progress` | `implemented` | 3.n 에서 **모든 task 가 landed** |
| `implemented` | `verified` | **추가로** 이 wave 의 **loop P verdict 가 `pass`** 이고 그 요구를 **지명하는 잔여가 없으며**, 그 요구의 모든 task 가 통과한 `verification_cmd` 를 운반 |

**loop L 의 acceptance 행 단위 `realised-with-test` 마무리는 phase 1 에서 사용할 수 없고 이연으로 지명한다.** **조용히 빠뜨리지도, phase 1 연언이라고 주장하지도 않는다.**

`test_id: null` acceptance 행을 하나라도 가진 요구는 `implemented` 에 도달할 수 있고 그 wave 에서 `verified` 에 도달할 수 없다. 그 행의 `untested_owner` 가 그것을 닫을 wave 를 지명한다.

**증거 두 행**:

- `type="test"` — 참조는 `verification_cmd`, detail 은 그 단위의 `docs/analysis/kiwi-pm-…` 번들;
- `type="commit"` — 참조는 `frozen.integration_branch` 위 `Orch-Task` trailer 커밋 sha.

**lane `audit.json` 이나 `integrate-lane` 병합 sha 를 phase 1 참조로 지명하지 않는다.** `intentionally_empty` 선언으로 landed 한 task 는 **`type="test"` 증거만 운반하고 commit 참조가 없다**.

task 가 하나라도 **landed 하지 않은 요구는 현재 status 에 그대로 두고** 그 wave 의 `issues.md` 에 `missing-task` 로 기록한다. 허용 가능한 `intentionally_empty` 선언을 운반하는 task 는 **landed 이므로 `missing-task` 가 아니다**.

---

## 15. 통합 브랜치·커밋·중단

run 은 이름 있는 통합 브랜치 `kiwi/orch/{run_id}/integration` 을 갖는다. Phase 0.b 에서 `--base-branch`(기본값은 현재 브랜치) 위에 생성하거나 채택하고 재개 카드의 `frozen` 블록에 기록한다. 생성도 채택도 불가하면 `integration-branch-unavailable` 이다.

**오케스트레이터는 그 브랜치를 base 브랜치로 결코 병합하지 않고 pull request 를 결코 열지 않는다.** 이 문장은 본문과 `00.run-contract.md` 의 금지 행동 닫힌 목록 양쪽에 있다. run 리포트에는 **오케스트레이터가 이행할 수 없는 의무** 하나를 적는다: 나중에 통합 브랜치를 **base 브랜치**로 병합하는 사람이 그 직후 base 브랜치에서 `validate` 다음 `sync-index` 를 실행해야 한다.

run 이 `docs/research/{work}/` 아래에 저작하는 모든 아티팩트는 `commit-run-artifacts` 동사 아래 선언된 일정으로 커밋한다. phase 1 의 커밋 지점은 Phase 0(run contract 생성), Phase 1 끝(intake·라우팅·설계와 그 lock), Phase 2 끝(waves lock·제약·레지스트리), 3.d(wave 입력), 3.f′(stage handoff 와 lane lock), 3.k activity (4)(검증 라운드·중복 감사·이슈 문서와 lock·postmortem), Phase 6(run 리포트)이다. 이 일정의 모든 지점은 **명시 pathspec** 을 stage 한다. 이유는 `git clean -fd` 가 동결된 설계와 재개 카드의 `invariant_digest` 가 지시하는 lock 들을 파괴하지 못하게 하는 것이다.

**`abort-run` 은 `halt` 와 구별되는 동사다.** 병합을 되돌리는 일이 없으므로 `frozen.integration_branch` 를 **있는 그대로** 둔다. `docs/research/{work}/00.run-report.md` 를 쓰고 Preflight P.5 의 run lock 을 해제한다. phase 1 run 리포트의 내용은 다음과 같다.

- **통합 브랜치와 그 sha**;
- **어느 wave 가 `complete`** 인지;
- run 이 **통합 브랜치에 남긴 커밋**;
- **run 을 끝낸 게이트**;
- 원인이 고칠 수 있는 것이면 **정확한 재개 명령**.

**workspace 행** — 병합되지 않은 채 reap 된 lane, reap 하지 못해 아직 실행 중일 수 있는 workspace — 은 phase 1 리포트에 없으며 `2.6.0-phase2-parallel-lanes` 내용으로 지명한다. **조용히 빠뜨리지 않는다.**

작업이 착지한 뒤 발생하는 phase 1 의 **종단 중단**은 `wave-verify-fail-residual` · `post-merge-index-drift` · `design-contradiction-at-wave-boundary` 셋이다. `srs-mutation-replay-failed` 는 `2.6.0-phase2-parallel-lanes` 로 표시한다.

---

## 16. 옵션

`kiwi-wave-master` 에서 그대로 상속: `--auto` · `--max` · `--mini` / `--loops N` · `--model <name>` · `--resume` · `--run-id` · `--constraint`(반복 가능). pass-through 중 `--auto-integration` · `--auto-cost-warning` · `--force` 는 **사용자가 지정했을 때에만** 흐른다. `--regression-baseline` 은 예외로, 사용자가 주었든 아니든 오케스트레이터 자신의 run 전역 P.4 pin 을 운반한다.

| 옵션 | 뜻 |
|---|---|
| `--work <name>` | `docs/research/{work}/` 디렉터리. 해소 순서: (1) `--work` 값, (2) intake 소스의 slug, (3) `get_active_target` 이 하나를 돌려줄 때에 한해 이미 활성인 target 이름, (4) `orchestrator-{YYYY-MM-DD}`. Preflight 에서 `^[a-z0-9][a-z0-9.-]{2,39}$` 로 검증한다 |
| `--design-doc <path>` / `--issue <n>` | intake 소스(Phase 1.a) |
| `--base-branch <name>` | run 의 통합 브랜치가 갈라져 나오는 곳. 기본값은 현재 브랜치. 오케스트레이터는 여기에 쓰지 않는다 |
| `--lanes N` | **stage 당** lane 상한, 기본 4, 최대 8. phase 1 에서는 공개된 분할의 stage 당 단위 수를 제한하는 값이다 |
| `--run-budget <mins>` | run 전체 벽시계. 초과 시 다음 stage 경계에서 `abort-run` 으로 멈춘다 |
| `--subagent-budget N` | run 전체 서브에이전트 spawn 상한. 소진 시 현재 루프를 `verdict = fail-cap` 과 `reason_class = "budget-exhausted"` 로 닫고 다음 stage 경계에서 `abort-run` 으로 멈춘다 |
| `--allow-inferred-write-set` | `[INFERRED:` `files[]` 를 lane 적격으로 허용하고 저널에 기록한다 |
| `--allow-untested-ac N` | `test_id: null` 상한을 올린다. 저널에 기록하고 run 헤더에 출력한다 |
| `--allow-plan-residual N` | `R-PLAN` `coverage_residual[]` 행 상한을 올린다. **절대 행 수**이며 비율이 아니다. `R-PLAN` 전용 |
| `--strict-grounding` | 선언된 모든 `files[]` 경로가 dispatch base 에 존재할 것을 요구한다 |

**`2.6.0-phase2-parallel-lanes` 로 이연된 옵션**: `--isolation` · `--install-concurrency` · `--install-stagger` · `--lane-deadline` · `--poll-interval` · `--serial`. `--serial` 은 phase 1 에서 구현하지 않는다 — 유일하게 존재하는 모드를 요청하는 옵션이기 때문이다.

`run_id` 는 기본값 `{YYYY-MM-DD}.{git-toplevel-basename}.{work}` 로 **Preflight P.0 에서** 생성되고 `--run-id` 가 이를 덮어쓴다. `--run-id` 는 `frozen.integration_branch` 에 박히므로 Preflight 에서 검증한다.

---

## 17. Pipeline emit (의무)

종료 시 MCP `workflow_pipeline_emit` 으로 이벤트 **1건**을 emit 한다 — `pipeline-event.md` §5.1 이 다른 스킬에 지시하는 손수 만든 bash append 블록을 쓰지 않는다. run 수준 이벤트는 bare `{run_id}` 를 쓰고 재개 시 `{run_id}#r{n}` 을 쓴다. `next_hint` 는 `null` 이다 — run 은 자기 통합 브랜치 위에서 검증된 채로 끝나고, base 브랜치로의 commit·push 와 PR 생성은 의도적으로 자동 연쇄되지 않는다.

---

## §V — 동사 색인

닫힌 enum 이다. **동사마다 스킬 섹션 하나**이므로 재개된 에이전트는 문서 전체가 아니라 섹션 하나를 읽는다. 각 섹션은 recovery class 를 선언한다. 여섯 lane 동사(`dispatch-lane` · `collect-lane` · `verify-lane` · `remediate-lane` · `release-lane` · `integrate-lane`)와 `probe-isolation` · `run-serial-epilogue` · `replay-deferred-mutations` 는 phase 1 enum 에 **없다** — `execute-unit` 이 그 여섯을 대체하고 나머지 셋은 `2.6.0-phase2-parallel-lanes` 다. **enum 밖의 동사는 재개 시 즉시 정지다.**

### §V.create-integration-branch

recovery class **externally-visible**. Phase 0.b. `--base-branch` 위에 `kiwi/orch/{run_id}/integration` 을 만들거나 채택하고 `frozen` 에 기록한다.
복구: `git rev-parse --verify {frozen.integration_branch}` — 있으면 채택, 없으면 `--base-branch` 에서 생성.
게이트: `integration-branch-unavailable`.

### §V.commit-run-artifacts

recovery class **externally-visible**. §15 의 일정대로 `docs/research/{work}/` 아래 아티팩트를 명시 pathspec 으로 커밋한다.
복구: `git log` 에서 `Orch-Run: {run_id}` 와 `Orch-Verb: commit-run-artifacts` 와 `Orch-Artifacts` 의 아티팩트 집합 digest 를 운반하는 커밋을 점검한다.

### §V.intake-qna

recovery class **pure-reauthor**. Phase 1.c, 그리고 loop D 가 `needs-decision` 행을 되돌려 보낼 때마다. 갭을 사용자 질문으로 낸다.
복구: 그냥 다시 한다. 이미 `01.intake.md` 에 있는 답은 반복이 아니라 입력이다.

### §V.intake-document

recovery class **pure-reauthor**. Phase 1.a 의 문서 소스 분기. `--design-doc` 를 읽어 `01.intake.md` 를 만든다.
복구: 그냥 다시 한다.

### §V.intake-issue

recovery class **externally-visible**. Phase 1.a 의 GitHub 이슈 분기. `gh issue view` 는 읽기 전용이지만 `$kiwi-srs-research` 가 노트를 영속시켰을 수 있다.
복구: `docs/research/` 와 그 스킬 자신의 이벤트를 먼저 점검한다.

### §V.intake-investigate

recovery class **pure-reauthor**. Phase 1.b. intent 와 code-context 와 architecture-fit 조사자 3 기를 병렬로 실행한다.
복구: 그냥 다시 한다.

### §V.probe-route

recovery class **idempotent-by-key**. Phase 1.c′, `routing/probe.json` 을 키로 한다. `pure-reauthor` 가 아니다 — S5 와 S6 은 서브에이전트 파생이라 컴팩션을 넘어 재현되지 않으므로 다시 하면 다른 rung 이 나올 수 있다.
복구: **영속된 probe 를 읽고 다시 판단하지 않는다.** 짝 없는 `intent` 는 probe 파일이 부분적일 수 있다는 뜻이므로 스키마로 검증하고 `unreadable[]` 로 표시된 필드만 다시 읽는다.
게이트: `route-probe-unreadable`.

### §V.freeze-route

recovery class **idempotent-by-key**. 게이트 뒤 `routing/route.lock.json` 을 쓴다. 내용 주소화되어 digest 가 같으면 다시 해도 no-op 다.
복구: 다시 실행하면 분류기의 제안이 아니라 **override 를 재현한다** — 게이트 결과가 `routing/route-gate.json` 에 영속되어 세 번째 인자로 다시 읽히기 때문이다.

### §V.dispatch-route

recovery class **externally-visible**. 자식이 변경을 만든다.
복구: 자식 자신의 `pipeline.jsonl` 이벤트를 점검하고 그 다음 MCP `list_steps`(`R-STEP`) 또는 `workflow_plan_status`(`R-PLAN`)를 점검한 뒤 재진입한다. **실행 중일 수 있는 자식을 다시 dispatch 하지 않는다.**

### §V.escalate-route

recovery class **externally-visible**. §4.7 의 E1 과 E2. lock 을 다시 쓰고, 작업을 `out_of_scope` 로 봉인할 수 있고, `$kiwi-srs` 에 재진입할 수 있다. `routing/misroute-{n}.json` 을 쓴다.
복구: `list_requirements --target …` 과 가장 최근 `freeze-route` result 를 먼저 점검한다.
게이트: `route-escalation-after-landed-state`.

### §V.downgrade-route

recovery class **externally-visible**. 2.e 의 `downgrade-to-step` 해소 전용. append-new-artifact 규칙으로 새 `route.lock.json` 을 쓰고 `frozen.route` 를 새 lock 으로 옮긴 뒤 `invariant_digest` 를 다시 계산하고 `dispatch-route` 로 넘긴다.
복구: 가장 최근 저널의 route lock 을 읽는다 — rung 은 읽고 다시 계산하지 않는다 — 그리고 자식의 `pipeline.jsonl` 을 점검한 뒤 재진입한다.

### §V.author-design

recovery class **pure-reauthor**. Phase 1.d. `design/00.design.md` 를 §6.1 의 표시 규칙대로 영문으로 저작한다.
복구: 그냥 다시 한다. 라운드 카운터는 누적된다.

### §V.verify-design

recovery class **idempotent-by-key**. loop D 의 라운드. §6.2 의 세 동결 분모 위에서 검증한다. `needs-decision` 행은 `intake-qna` 로 되돌아간다.
복구: 라운드를 다시 한다.
게이트: `design-intake-insufficient`.

### §V.freeze-design

recovery class **idempotent-by-key**. Phase 1.e. `design/00.design.lock.json` 을 쓰고 `design_items[]` 와 `integration_items[]` 와 `out_of_scope[]` 를 산출한다. 내용 주소화되어 digest 가 같으면 no-op 다.
게이트: `unmarked-normative-prose`, 그리고 하류의 `design-not-frozen`.

### §V.decompose-waves

recovery class **pure-reauthor**. Phase 2.a. `wave-decomposition.md` 의 두 갈래 split 휴리스틱을 artifact root `docs/research/{work}/` 로 실행한다.
복구: 그냥 다시 한다.
게이트: `wave-decomposition-coverage-gap` · `out-of-scope-user-consent`.

### §V.author-convergence-registry

recovery class **pure-reauthor**. Phase 2.c. `design/convergence-registry.json` 을 저작하고 모든 수렴점에 §7.2 의 닫힌 enum 에서 `recipe.kind` 를 붙인다.
복구: 그냥 다시 한다.

### §V.verify-convergence-registry

recovery class **idempotent-by-key**. Phase 2.c. 모든 선언된 수렴점이 닫힌 enum 의 recipe 를 갖는지 검사한다.
복구: 라운드를 다시 한다.
게이트: `convergence-without-recipe`.

### §V.author-wave-design

recovery class **pure-reauthor**. Phase 3.a. `waves/wave-{n}/design.md` 를 영문으로, run 설계와 같은 표시 규칙으로 저작한다.
복구: 그냥 다시 한다.

### §V.verify-wave-design

recovery class **idempotent-by-key**. loop W 의 라운드. 동결 분모는 그 wave 의 `design_items` 조각이다.
복구: 라운드를 다시 한다.
게이트: `wave-design-insufficient` · `unmarked-normative-prose`.

### §V.register-wave-srs

recovery class **externally-visible**. Phase 3.b. `$kiwi-srs` 가 요구를 저작했을 수 있다.
복구: `list_requirements --target wave-{n}` 과 `srs_authored` 표식을 점검한 뒤 재진입한다.
게이트: `child-srs-needs-user-or-failed`.

### §V.plan-wave

recovery class **externally-visible**. Phase 3.c. `$kiwi-planner` 가 `docs/plans/{plan_run_id}.*` 를 쓰고 `add_trace_link` 를 호출했을 수 있다.
복구: `workflow_plan_status` 를 점검한다.

### §V.derive-readiness

recovery class **idempotent-by-key**. Phase 3.c′. 새 스냅샷 위의 순수 재계산이며 3.b 배정 집합에 대한 배정 검사를 함께 수행한다.
복구: 다시 계산한다.
게이트: `unallocated-req-id` · `requirement-not-ready`.

### §V.commit-wave-inputs

recovery class **externally-visible**. Phase 3.d. wave 설계·excerpt·계획·sidecar·제약·레지스트리를 명시 pathspec 으로 커밋한다.
복구: `git log` 에서 `Orch-Run` 과 `Orch-Verb: commit-wave-inputs` 와 `Orch-Wave: {n}` trailer 를 점검한다.

### §V.freeze-lane-plan

recovery class **idempotent-by-key**. Phase 3.e. `lanes.lock.json` 을 쓴다. 다시 계산한 결과가 바이트 동일해야 하며 아니면 `lane-plan-drift` 다.
게이트: `schedule-cycle` · `tdd-pair-split` · `unknown-write-set-refused` · `files-not-grounded` · `non-code-write-set-refused` · `lane-plan-drift`.

### §V.review-partition

recovery class **pure-reauthor**. Phase 3.e′. `waves/wave-{n}/partition.md` 를 공개하고 사용자에게 verdict 를 받아 `partition_review` result object 로 기록한다. verdict 어휘는 닫혀 있다: `pass` · `revise` · `abort`.
복구: 그냥 다시 한다. 이전 verdict 는 반복이 아니라 입력이며, 사용자는 현재 lane 계획 digest 에 대해 다시 질문받는다.
게이트: `partition-review-unrecorded`.

### §V.author-handoff

recovery class **pure-reauthor**. Phase 3.f, 그리고 3.k activity (0) 의 epilogue handoff. §9.1 의 스키마와 열 heading 으로 영문 저작한다.
복구: 그냥 다시 한다.

### §V.verify-handoff

recovery class **idempotent-by-key**. loop H 의 라운드와 `validateHandoff` 다섯 계층. 마지막 라운드에서만 실행가능성 프로브를 돌린다.
복구: 라운드를 다시 한다.
게이트: `handoff-not-english` · `handoff-unresolvable-reference` · `handoff-untested-ac-over-cap` · `handoff-verify-failed`.

### §V.commit-dispatch-base

recovery class **externally-visible**. Phase 3.f′. stage 의 handoff 와 lane lock 을 명시 pathspec 으로 커밋하고 그 직후 dirty 검사를 수행한다. 이 커밋의 sha 가 그 stage 의 dispatch base sha 다.
복구: `git log` 에서 `Orch-Run` 과 `Orch-Verb: commit-dispatch-base` 와 `Orch-Wave` 와 `Orch-Stage` trailer 를 점검한다.
게이트: `dispatch-base-dirty`.

### §V.execute-unit

recovery class **externally-visible**. **phase 1 의 실행 동사**이며 phase 1 enum 에서 여섯 lane 동사를 대체한다. lane handoff 하나에 대한 `$kiwi-pm` 실행 한 번을 host root 에서 통합 브랜치 위에 수행한다(§10).
복구: 통합 브랜치의 `Orch-Run` 과 `Orch-Wave` 와 `Orch-Stage` 와 `Orch-Lane` 과 `Orch-Task` trailer 를, 그리고 `workflow_plan_status` 를 점검한 뒤 **trailer 도 체크된 박스도 없는 Task 에 대해서만** 재진입한다. **커밋이 이미 있는 단위를 다시 실행하지 않는다** — 다시 실행하는 것이 중복 감사가 찾아야 할 중복 구현을 만드는 일이다. trailer 와 `workflow_plan_status` 가 불일치하면 `interrupted-external-action` 이다.
게이트: `serial-unit-failed` · `lane-design-refuted` · `child-pipeline-needs-user-or-failed` · `interrupted-external-action`.

### §V.post-merge-verify

recovery class **idempotent-by-key**. Phase 3.l 의 loop P 라운드. §12.1 의 다섯 동결 분모와 의도 계층 위에서 검증한다.
복구: 라운드를 다시 한다.
게이트: `wave-verify-residual-critical` · `wave-verify-fail-residual` · `wave-verify-cross-wave-fix-required` · `verification-oscillation`.

### §V.wave-issue-triage

recovery class **pure-reauthor**. Phase 3.m, loop P 뒤·`promote-requirements` 앞. §13.1 의 입력 합집합을 §13.2 의 닫힌 6값으로 분류해 `issues.md` 와 `issues.lock.json` 을 쓴다.
복구: 그냥 다시 한다. 이슈 문서는 다시 생성된다.
게이트: `wave-issues-open` · `design-contradiction-at-wave-boundary`.

### §V.resolve-wave-issues

recovery class **externally-visible**. Phase 3.m. `local-defect` 는 `$kiwi-review-fix-loop` 로, `missing-task` 는 pipeline 재진입으로 라우팅한다.
복구: 그 스킬들의 저널을 먼저 점검한다.
게이트: `wave-append-cap-exhausted` · `out-of-scope-user-consent`.

### §V.amend-design

recovery class **externally-visible**. §13.4 의 승인된 mid-wave 수정. 새 `design/00.design.{seq}.md` 와 새 `00.design.lock.json` 을 쓰고 제자리 편집을 하지 않는다.
복구: 새 `00.design.lock.json@sha256` 과 그 저널 줄이 이미 있는지 점검한 뒤 다시 저작한다.

### §V.promote-requirements

recovery class **externally-visible**. Phase 3.n. §14 의 집합과 전이와 증거를 host root 에서 적용한다.
복구: `get_requirement` 를 먼저 점검한다.

### §V.final-verify

recovery class **idempotent-by-key**. Phase 4 의 loop F 라운드. 분모는 모든 `design_items` 와 `integration_items` 의 합집합이다.
복구: 라운드를 다시 한다.
게이트: `final-verify-residual-critical` · `wave-append-cap-exhausted`.

### §V.emit-and-finish

recovery class **idempotent-by-key**. Phase 5. MCP `workflow_pipeline_emit` 으로 이벤트 1건을 emit 한다. 키로 멱등하며 재개 시 `{run_id}#r{n}` 을 쓴다.
복구: 같은 키로 다시 emit 한다.

### §V.abort-run

recovery class **externally-visible**. §15. `halt` 의 동의어가 **아니다** — 사용자가 어떤 저장소 상태에 남는지를 지명하고 run 리포트에 쓴다. `frozen.integration_branch` 를 그대로 두고 P.5 의 run lock 을 해제한다. `00.run-report.md` 를 쓴다.
복구: `00.run-report.md` 가 이미 있는지 점검한다.

### §V.halt

종단. recovery class 를 선언하지 않는다. 중단 사유가 된 게이트를 그대로 보고하고 멈춘다. 저장소 상태를 지명해야 하는 중단은 `halt` 가 아니라 `abort-run` 이다.
