---
name: kiwi-orchestrator
description: "얇은 의도·연구문서·GitHub 이슈를 받아 intake → 라우팅 → 설계 동결 → wave 분해 → wave 마다 SRS·SDS 저작 → stage 계획 공개 → wave 당 워커 하나를 워크트리에서 병렬 실행 → 병합·재생 → 사후 검증 → 테스트 충분성 확인 → 요구 승급까지 하나의 재개 가능한 run 으로 완주시키는 설계-우선 오케스트레이터 v0.1. 규모와 범위를 스스로 판정해 R-STEP(/kiwi-tdd) · R-ORCH(공용 wave 엔진) 중 하나로 라우팅한다. wave 는 기본이 병렬이고 --serial 이면 모든 단계를 하나씩 돈다. 진행은 ./kiwi/waves.jsonl 과 재개 카드에 영속되어 컴팩션 뒤에도 재개된다. 트리거 — kiwi orchestrator, 오케스트레이터 실행, 설계부터 구현까지 완주, 대형 작업 오케스트레이션, orchestrate run, 이 문서로 개발 진행. 옵션 — --auto (사용자 게이트 자동 결정, 안전 게이트 유지), --max, --mini / --loops N, --serial, --work, --base-branch, --lanes N."
---
> Kiwi MCP rule: normal target-scoped SRS reads, mutations, validation, status/stability updates, acceptance-criteria changes, evidence, trace links, and completed-work logging require working `speckiwi mcp`. CLI is diagnostic/remediation only and is not a normal replacement for MCP mutations.
# kiwi-orchestrator v0.1

하나의 작업 의도를 받아 **설계를 먼저 저작하고 동결한 뒤** wave 로 분해하고, wave 마다 SRS 와 SDS 를 저작하고, stage 계획을 공개한 뒤 **wave 하나를 워커 하나에 맡겨** 워크트리에서 실행하고, 호스트가 판정·병합·재생한 결과를 동결된 분모에 대해 검증하고, 요구를 승급시키는 오케스트레이터. 한 stage 의 wave 워커는 **기본이 병렬**이고 `--serial` 이면 하나씩이다. 모든 진행은 `./kiwi/waves.jsonl` 과 재개 카드에 영속되어 세션이 컴팩션되어도 이어진다.

이 스킬은 *직접 코드를 구현하지 않는다* — 의도를 판정하고, 설계를 동결하고, 작업을 wave 로 나누고, 각 wave 를 워커의 `/kiwi-pm` 에 위임하고, 결과를 검증한다. 자체 fixer 를 두지 않는다.

wave 의 실행 절차 — SRS 저작, SDS 작성, stage 계산, 워커 dispatch, join, 판정, 병합, 재생, 설계 적합 검증, 테스트 충분성, 승급 — 는 `_shared/kiwi/parallel-waves.md` 가 소유하고 본 문서는 그것을 지목한다. lane 하나는 wave 하나의 워커다.

---

## Workflow 도구 정책

자식 실행 기록 조회의 정상 경로는 공식 workflow 읽기 도구다 — 복구가 점검하는 자식의 `pipeline.jsonl` 이벤트는 MCP `workflow_pipeline_tail` 로 읽고, 자식의 최신 상태는 `workflow_pipeline_status` 로 조회한다. 파일을 직접 읽는 것은 그 도구를 쓸 수 없을 때의 degraded 폴백이며, 그 실행은 도구 진단·산출물 경로·active target·후속 요구 또는 후보 ID 를 사용자 보고에 함께 남긴다.

---

## 0. 공통 규약 (SSOT)

| 키 | 규칙 |
|---|---|
| §0.1 | **이벤트 SSOT**: `~/.claude/skills/_shared/kiwi/waves-event.md` v2.0.0 가 `./kiwi/waves.jsonl` 의 schema·파일위치·`complete` 규칙 SSOT. 본 문서는 오케스트레이션 로직만 담당한다. |
| §0.2 | **/snoworca-\* 호출 절대 금지**. kiwi-* 시리즈만 `Skill` 도구로 호출한다. |
| §0.3 | **CLAUDE.md §6 시그니처 금지** + **§7 변경 이력 금지**. 본 스킬 본문에 변경 이력 섹션 없음 — git history 가 SSOT. |
| §0.4 | **--auto 안전 게이트**: 어떤 자식(`/kiwi-srs` · `/kiwi-srs-feasibility` · `/kiwi-sds` · `/kiwi-pm` · `/kiwi-review-fix-loop` · `/kiwi-tdd`)이 `NEEDS_USER` 또는 `FAILED` 를 반환하면 `--auto` 라도 부모가 중단하고 사용자 결정을 받는다. 자식이 **자기 게이트 표**의 `gate_id` 를 bubble 하면 §0.G 에 같은 이름의 행이 없어도 무조건 중단한다. |
| §0.5 | **`--auto` 옵션 SSOT**. 본 스킬은 `~/.claude/skills/_shared/kiwi/auto-option.md` 를 따른다. 중단 게이트 선언은 §0.G, `business-decision` 게이트 선언은 §0.S 를 본다. |
| §0.6 | **`--mini` / `--loops N` 옵션 SSOT**. 본 스킬은 `~/.claude/skills/_shared/kiwi/loop-option.md` 를 따른다. 상한은 라우팅된 자식과 본 스킬의 D/W/P/F 루프 cap 양쪽에 전파된다. |
| §0.7 | **상호검증 엔진 SSOT**. 본 스킬은 `~/.claude/skills/_shared/kiwi/verify-loop.md` v1.0.0 을 따른다 — 증거 번들, 두 stance, 외부 동결 분모, 라운드 구조, 종료 조건, **진동 감지**, 개선 위임. 본 스킬 고유의 분모 표는 §12.1. |
| §0.8 | **wave 분해 SSOT**. 본 스킬은 `~/.claude/skills/_shared/kiwi/wave-decomposition.md` v1.0.0 을 따른다. `artifact_root` 인자로 `docs/research/{work}/` 를 전달한다 — `kiwi-wave-master` 가 `docs/analysis/kiwi-wave-master-{run_id}/` 를 전달하는 자리다. |
| §0.9 | **wave target 등록 계약 SSOT**. 본 스킬은 `~/.claude/skills/_shared/kiwi/wave-srs-registration.md` v1.0.0 을 따른다 — `--research-doc` / `--constraints-doc` 저작 입력과 `srs_authored` 멱등 표식. |
| §0.10 | **원장 SSOT**. 본 스킬은 `~/.claude/skills/_shared/kiwi/run-ledger.md` v1.0.0 을 따른다 — 재개 카드 schema 와 상한, 닫힌 verb enum 과 세 recovery class, write-ahead / write-behind 쓰기 규율, proof kind 표, 대조 술어, 드리프트 다이제스트, 수렴 레시피의 `recipe.kind` enum 과 lane 적격 규칙, 통합 브랜치를 base 브랜치로 병합하지 않는다는 규칙과 그에 따르는 `validate` → `sync-index` 의무. |
| §0.11 | **work-mode 판독**. work-mode 는 MCP `get_work_mode` 로 읽고, MCP 가 없으면 CLI `speckiwi mode`, 둘 다 없으면 `wait`(fail-open)다. 본 스킬 자신의 wave 흐름(`R-ORCH`)은 **body scope** 이므로 `tdd` 모드의 step 스코프 라우팅이 이를 다시 라우팅하지 않는다. run 단위 `kiwi-tdd` 라우팅은 §4 가 지배한다. |
| §0.12 | **pipeline 이벤트 SSOT**: `~/.claude/skills/_shared/kiwi/pipeline-event.md`. 종료 시 MCP `workflow_pipeline_emit` 으로 이벤트 1건을 emit 한다(§17). |
| §0.13 | **경계 규칙**: 판단이 필요한 것은 에이전트가 표시하고, 도구는 표시된 것의 형식만 검사한다. 본 문서가 "도구가 확인한다"고 적은 곳은 전부 형식 검사이며 내용의 옳고 그름은 검사하지 않는다. |
| §0.14 | **워크트리 레인 SSOT**. 본 스킬은 `~/.claude/skills/_shared/kiwi/worktree-lane.md` v1.0.0 을 따른다 — run root 와 lane workspace 의 분리, 명시 checkout 의무, 레인이 하지 않는 세 가지, role 게이트, 호스트 판정, 재생 승인. 각 wave 의 워커는 그 계약 아래 자기 워크트리에서 돈다. 호스트는 이동하지 않고, SRS mutation 은 run root 에 남는다. 절차를 본 문서에 다시 적지 않는다. |
| §0.15 | **병렬 wave 실행 SSOT**. 본 스킬은 `~/.claude/skills/_shared/kiwi/parallel-waves.md` v1.0.0 을 따른다 — 역할과 쓰기 소유, 동시성과 `--serial`, wave 의존과 stage, 계약이 올리는 게이트, stage 한 번의 순서(PW-1 ~ PW-17), 재개. `R-ORCH` 의 3.b ~ 3.n 은 그 순서의 단계이며, 본 문서는 그 사이에 끼우는 자기 훅(3.a · 3.c′ · 3.m)과 자기 분모(§12)만 적는다. |
| §0.16 | **테스트 충분성 SSOT**. 본 스킬은 `~/.claude/skills/_shared/kiwi/test-sufficiency.md` 를 따른다 — 승급 단계 직전(§14)과 모든 rung 의 종료 코드 리뷰 hop 뒤(§4.5.1 · §V.final-verify)에 부르고, 절차를 다시 적지 않는다. |

## 0.I 격리(isolation) — 워커는 wave 마다 자기 워크트리에서 돈다

**각 wave 의 워커는 `~/.claude/skills/_shared/kiwi/worktree-lane.md` 아래 자기 워크트리에서 돌고, `~/.claude/skills/_shared/kiwi/parallel-waves.md` 가 그 워커를 dispatch 한다.** 호스트는 run root 에 머물고 SRS 를 쓰는 유일한 쪽이다. 격리 워커를 띄울 수 없는 런타임은 직렬로 돌고 그 이유를 기록한다 — Preflight P.6 의 `probe-isolation` 이 `isolation.profile` 을 `worktree-parallel` 또는 `worktree-serial` 로 정하고 `isolation.reason` 을 적으며, 그 값은 `frozen` 안에 있어 `invariant_digest` 가 덮는다.

**`--wt` 는 절대 전달하지 않는다.** 오케스트레이터는 `kiwi-pipeline` 에 wave 를 위임하지 않으므로(§4.5.3) 전달할 자리 자체가 없다. 사용자가 `kiwi-pipeline --wt` 위임을 **요청해 오면** Preflight P.2 에서 `wt-delegation-refused` 로 거부한다 — 이 게이트의 술어는 우리가 만드는 위임이 아니라 들어오는 요청이다. 근거는 본 스킬 자신의 것이다: **cycle 스코프 worktree 를 lane 스코프 worktree 안에 중첩시키는 위상**을 이 설계가 지원하지 않는다.

## 0.G `critical_gates[]` (auto-option.md §5 인터페이스)

아래 게이트는 `--auto` 라도 자동 진행을 중단하고 사용자 결정을 받는다 — 결정 서브에이전트로 우회할 수 없다. 표를 **부분만** 선언하면 선언되지 않은 나머지 중단이 `business-decision` 으로 떨어져 위원회 승인 대상이 되므로, 본 표는 도달 가능한 중단을 모두 담는다. 반대로 **술어가 존재하지 않는 게이트를 선언하는 것은 생략보다 나쁘다** — 뒤에 아무것도 없는 식별자가 cross-variant 파리티 단언에 들어간다. `parallel-waves.md §4` 의 게이트 표는 전부 여기에 있다.

| gate_id | reason | location |
|---|---|---|
| `run-root-preflight-mismatch` | MCP `workspaceRoot` 가 git toplevel 과 다르거나 조회 실패 | Preflight P.1 |
| `invalid-run-scope-option` | 명시된 `--run-id` 가 `^[A-Za-z0-9._-]{1,48}$` 또는 `git check-ref-format --allow-onelevel` 을 통과하지 못하거나, 명시된 `--work` 가 `^[a-z0-9][a-z0-9.-]{2,39}$` 를 통과하지 못함 | Preflight P.2 |
| `terminal-review-loop-missing` | §4.5 가 정한 조건이 충족되지 않은 채 통과 판정이 기록됨 | §4.5 / 각 경계 close-out |
| `unsafe-option-refused` | `--skip-regression` 또는 `--reviewer-off` 요청, 그리고 `--no-review-loop` · `--skip-review-loop` — 종료 hop 은 끌 수 없고, 적용 여부는 커밋 창이 정한다. 조용히 무시하지 않고 이름을 들어 **거부**한다 | Preflight P.2 |
| `wt-delegation-refused` | 요청되어 들어온 `kiwi-pipeline --wt` 위임 — cycle 스코프 worktree 를 lane 스코프 안에 중첩하는 위상 | Preflight P.2 |
| `invalid-loop-option` | `--loops N` 이 정수 1 이상이 아님 | Preflight P.2 |
| `orchestrator-run-lock-held` | 다른 orchestrator run 이 git common dir 키의 lease 를 보유 | Preflight P.5 |
| `journal-artifact-lock-held` | run 저널 아티팩트 락을 다른 writer 가 보유 | append 시점 |
| `resume-card-missing-or-invalid` | run 의 이벤트는 있는데 재개 카드가 읽히지 않거나 상한을 넘음 | Phase 0 |
| `ledger-reconciliation-divergent` | 현재 `(wave, stage)` 에 대해 저널·git ref·커밋 trailer 가 불일치 | Phase 0 |
| `run-invariant-drift` | 재계산한 `invariant_digest` 가 카드가 **현재 지시하는** lock 들과 불일치 | Phase 0 |
| `interrupted-external-action` | externally-visible 동사의 `intent` 에 `result` 가 없고, 그 동사가 선언한 점검으로도 외부 효과가 해소되지 않음 | Phase 0 / 3.f ~ 3.j |
| `integration-branch-unavailable` | run 의 통합 브랜치를 `--base-branch` 에서 생성하거나 채택할 수 없음 | Phase 0.b |
| `route-probe-unreadable` | MCP 불가로 `list_requirements` 와 `get_active_target` 을 모두 읽을 수 없어 D8 이 step rung 을 제거 | Phase 1.c′ |
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
| `child-srs-needs-user-or-failed` | 직접 호출한 `/kiwi-srs` 또는 `/kiwi-srs-feasibility` 가 `NEEDS_USER` 또는 `FAILED` 반환 | Phase 3.b / 3.b′ |
| `unallocated-req-id` | wave SDS 의 `@req` 집합이 3.b 배정 집합 밖의 요구를 담거나 비어 있음, 또는 배정 집합의 요구가 wave SDS 들의 `@req` 에서 빠짐(`kiwi-sds` 가 `draft` 등으로 범위에서 뺀 요구 — `parallel-waves.md` PW-2) | Phase 3.c′ |
| `requirement-not-ready` | 파생 readiness 가 네 원인 중 하나를 보고 (요구 자신의 status·stability 가 디스패치 집합 밖 = `lifecycleReady` 거짓, 미충족 hard dependency = `hardDependenciesSatisfied` 거짓, 증거 드리프트 = `evidenceDrift`, 미검증 소유권 = `ownershipVerified` 거짓) | Phase 3.c′ |
| `schedule-cycle` | `depends_on` 사이클 때문에 `orchestrate schedule waves` 가 stage 를 계산하지 못함 | Phase 3.e |
| `files-not-grounded` | wave SDS 의 Files · Test Plan 경로가 기존 경로의 오타로 판정됨 | Phase 3.e |
| `lane-plan-drift` | 재계산한 stage 계획이 `lanes.lock.json` 과 불일치 — close-out 이 아직 손대지 않은(Status 가 `closed` 가 아니고 지워지지 않은) wave SDS 의 digest 가 달라짐 | Phase 3.e / resume |
| `worker-touched-srs` | dispatch 전후 run root 의 `git status --porcelain docs/spec docs/sds` 가 다름 — 워커가 SRS 나 SDS 를 건드림 | Phase 3.g |
| `serial-unit-failed` | wave 의 `verification_cmd` 가 같은 SDS 로 1회 재시도한 뒤에도 비-0 으로 끝남, 또는 wave 의 워커가 커밋을 만들지 않고 자기 `/kiwi-pm` 실행의 `docs/analysis/` 번들에 `intentionally_empty` 사유도 선언하지 않음, 또는 워커의 `/kiwi-pm` 이 `NEEDS_USER` 또는 `FAILED` 반환 | Phase 3.g / 3.h |
| `lane-design-refuted` | 워커가 동결된 설계 항목을 기술대로 구현할 수 없다고 매니페스트로 보고 | Phase 3.g |
| `child-pipeline-needs-user-or-failed` | 위임한 `/kiwi-sds` 또는 호스트가 부른 `/kiwi-review-fix-loop` 가 `NEEDS_USER` 또는 `FAILED` 반환, 또는 워커 매니페스트의 `review_outcome` 이 중단이거나 잔여 CRITICAL·HIGH | Phase 3.c / 3.g / 3.k / 3.l |
| `integration-test-user-consent` | 워커의 `kiwi-coder` 통합 테스트 동의 게이트 — `--auto-integration` 이 명시되지 않으면 `--auto` 라도 정지 | Phase 3.f |
| `cost-warning-large-task` | 워커의 `kiwi-coder` 비용 경고 — `--auto-cost-warning` 이 명시되지 않으면 `--auto` 라도 정지 | Phase 3.f |
| `srs-mutation-replay-failed` | `orchestrate replay apply` 가 워커의 유예 mutation 재생을 거절하거나 실패를 기록 | Phase 3.i |
| `cross-lane-duplication-unresolved` | 중복 감사의 `duplicate` 행이 `issue:{id}` 해소를 갖지 않음 | Phase 3.k |
| `post-merge-index-drift` | `sync_index` 가 실행된 뒤에도 `validate --fail-on-warning` 이 드리프트를 보고 | Phase 3.k / `R-STEP` close-out |
| `wave-verify-residual-critical` | loop P 종료 시 잔여 CRITICAL/HIGH, 검증자 1 의 `GAPS`, 또는 `fail-cap` | Phase 3.l |
| `wave-verify-fail-residual` | loop P 가 상한 전에 미해소 finding 을 남기고 끝남 — 그 wave 는 `complete` 를 append 할 수 없다 | Phase 3.l |
| `wave-verify-cross-wave-fix-required` | 이전 wave 의 요구를 바꿔야 하고 carry-forward 경로가 양쪽 다 불가능 | Phase 3.l |
| `verification-oscillation` | 같은 `finding_id` 가 2 라운드 이상에 걸쳐 닫혔다 다시 열리거나 같은 hunk 가 되돌려졌다 다시 적용됨 | any loop |
| `wave-issues-open` | `P-WAVE-ISSUES-CLOSED` 미충족 상태로 그 wave 에 의존하는 wave 의 워커를 dispatch 하려 함 | Phase 3.m |
| `design-contradiction-at-wave-boundary` | 설계 항목이 구현으로 반증됨, 또는 wave 당 mid-wave 수정 3회째 | Phase 3.m |
| `test-sufficiency-gap` | 테스트 충분성 확인이 한 번 채운 뒤에도 인용 공백을 남김 — `test-sufficiency.md` | Phase 3.n / Phase 4 / `R-STEP` close-out |
| `final-verify-residual-critical` | loop F 종료 시 잔여 CRITICAL/HIGH, `GAPS`, `fail-cap` 또는 `fail-residual` | Phase 4 |
| `wave-append-cap-exhausted` | run 당 wave 추가 상한 **3** 소진 | Phase 3.m / Phase 4 |
| `run-budget-exhausted` | `--run-budget` 벽시계 초과 | 다음 stage 경계 |
| `subagent-budget-exhausted` | `--subagent-budget` spawn 상한 소진 | 다음 stage 경계 |
| `validate-spec-error` | `validate_spec` 가 error 급 진단을 하나라도 돌려줌 — 오류를 안은 요구 위에 증거와 승급을 쌓으면 그 통과가 무엇을 근거로 기록되었는지 되읽을 수 없다 | Phase 3.k activity (3) — `speckiwi validate` |

**이 게이트를 관측하는 자리**: 위 표에서 이 행의 세 번째 칸이 가리키는 홉에서 MCP `validate_spec` 을 실행한다 — MCP 가 없으면 CLI `speckiwi validate --json` 이다. error 급 진단이 하나라도 남아 있으면 그 홉을 진행하지 않고 `validate-spec-error` 로 중단하며, `--auto` 도 이 중단을 덮지 못한다. 실행하지 않은 채 통과로 기록하지 않는다.

> **`--auto` 활성 조건**: `auto-option.md` 상 이 표의 미선언은 `--auto` **비활성**을 뜻한다. 본 표의 선언으로 이 스킬의 `--auto` 는 활성이며, 위 게이트들이 그 활성 상태의 HALT 지점이다.

`external-module-impact` · `mcp-cli-both-unavailable` · `self-recursive-spawn` 은 `auto-option.md` 의 공용 목록에서 **있는 그대로 채택**하며 본 표에 다시 전사하지 않는다 — 전사는 공용 목록이 늘어날 때마다 누락된다.

## 0.S 게이트 심각도 — §0.G 표 밖에 선언되는 게이트

아래 다섯 게이트는 심각도를 **명시적으로 선언**하되 §0.G 표에는 넣지 않는다 — 라우팅 게이트 넷과 분할 검토 게이트 하나다. §0.G 표 소속은 `--auto` 와 무관하게 중단한다는 뜻이고, `route-proposal` 은 **모든 run 에서** 발화하므로 이를 승격시키면 무인 실행 100% 가 첫 결정에서 멈춘다. 위원회는 그런 중단을 뒤집지 못한다. 그럼에도 심각도를 선언하는 이유는 따로 있다: **미선언 게이트의 기본값에 맡기지 않고 confidence 하한 0.7 을 고정**하고 confidence 하향 조정을 작동시키기 위해서다. `partition-review-unrecorded` 가 critical 이 아닌 이유는 잘못된 분할이 병합 뒤 판정과 직렬 재실행으로 복구되기 때문이다(`parallel-waves.md §4`) — critical 로 두면 `--auto` 무인 실행이 stage 마다 멈춘다.

| gate_id | severity | 발화 조건 |
|---|---|---|
| `route-proposal` | business-decision | 모든 run, Phase 1.c′ |
| `route-step-requires-mode-switch` | business-decision | rung 이 `R-STEP` 이고 `S1.mode` 가 tdd 가 아님 |
| `tdd-route-unattended` | business-decision | `route-step-requires-mode-switch` 해소 뒤에도 rung 이 여전히 `R-STEP` 이고 `--auto` 활성이며 그 게이트가 `switch-and-step` 으로 해소되지 않음 |
| `route-downgrade-available` | business-decision | Phase 2 끝, §7.3 의 세 조건이 모두 성립 |
| `partition-review-unrecorded` | business-decision | Phase 3.e′ — 3.e 에서 동결된 lane 계획 digest 와 같은 digest 를 기록하고 verdict 가 `pass` 인 `review-partition` result line 이 그 stage 의 wave 에 없음 |

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

- `run_id`, `work_root`, 저널 경로, 고정된 run root, 동결된 `isolation_profile` 값(`worktree-parallel` 또는 `worktree-serial`)과 그 `isolation.reason`, **`base_branch` 와 `integration_branch`**;
- **P.5 pin** — Preflight P.5 의 `lock` 이 돌려준 holder 넷(`owner` · `pid` · `host` · `acquiredAt`). Phase 0 의 생성 시점에 적으며, 종료 해제 앞의 대조가 이 값을 입력으로 쓴다(§3.1);
- run 의 **고정 경로 규약** — `design/00.design.lock.json`, `design/constraints.json`, `design/convergence-registry.json`, `waves/waves.lock.json`, `docs/research/{work}/waves/stage-{s}/lanes.lock.json`(stage lock 은 도구 인자로 넘기고 도구는 경로를 run root 기준으로 풀므로 전체 경로로 적는다), 그리고 wave SDS 경로 `docs/sds/{run_id}-wave-{n}.sds.md`;
- **불변 wave 순서** — 2.d 수정에서 기록. `R-STEP` 에는 없다(wave 를 나누지 않는다);
- **`intake_autonomy` 블록** — Phase 1 끝 수정에서 기록(§5.2);
- **금지 행동의 닫힌 목록**: 재분해 금지; Phase 3.b 밖에서 Requirement ID 할당 금지; 완료된 wave 편집 금지; 살아 있을 수 있는 워커 재-dispatch 금지; 워커의 SRS·`docs/spec/`·`docs/sds/` 쓰기 금지; 테스트 약화·삭제 금지; lease 밖 쓰기 금지; `kiwi/waves.jsonl` 직접 append 금지; **`git add -A` 와 `git commit -a` 절대 금지 — 모든 커밋은 명시 pathspec 으로 stage 한다**; **`integration_branch` 를 `base_branch` 로 병합 금지, PR 생성 금지**;
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
  P.6  isolation probe (probe-isolation) — 격리 워커를 띄울 수 있으면 worktree-parallel,
       없거나 --serial 이면 worktree-serial. 이유를 isolation.reason 에 적는다 (§0.I)

Phase 0  재개 / run 생성
  0.a  orchestrate resume            게이트: resume-card-missing-or-invalid         C
                                            ledger-reconciliation-divergent         C
                                            run-invariant-drift                     C
                                            interrupted-external-action             C
  0.b  통합 브랜치 kiwi/orch/{run_id}/integration 을 --base-branch 에서 생성 또는 채택,
       frozen 블록에 기록          게이트: integration-branch-unavailable           C

Phase 1  intake → route → design                                  [loop D]
  1.a  소스 분류: 얇은 의도 | 연구·설계 문서 | GitHub 이슈
  1.b  조사자 3 기 병렬 (intent / code-context / architecture-fit) — --serial 이면 하나씩
  1.c  갭 열거 → 조사자가 닫지 못한 갭은 전부 사용자 QnA
  1.c′ 라우팅 분류 (§4)
       동사 probe-route  → routing/probe.json      (게이트 전에 기록)
       산문             → routing/00.routing.md    (게이트 전에 기록, 영문)
       동사 freeze-route → routing/route.lock.json (게이트 후에 기록)
                                     게이트: route-proposal        business-decision
                                            route-probe-unreadable                  C
                                     조건부: route-step-requires-mode-switch  business-decision
                                            tdd-route-unattended             business-decision
       ├─ R-STEP → dispatch-route → Skill(kiwi-tdd) → Skill(kiwi-review-fix-loop) → 테스트 충분성 확인
       │            → validate/sync-index → emit-and-finish
       └─ R-ORCH → 1.d 로 진행 — 아래 전부는 이 rung 에서만 실행된다
  1.d  설계 저작 루프 → design/00.design.md
  1.e  freeze-design                 게이트: design-intake-insufficient             C
                                            unmarked-normative-prose                C
                                            design-not-frozen (하류)                C

Phase 2  분해                                                (R-ORCH 전용)
  2.a  wave 분할 (headers-first, 아니면 splitter 서브에이전트, 3–8 하위 목표) + wave 마다 depends_on[]
  2.b  설계 기준선 + constraints 아티팩트 (비어 있어도 항상 기록)
  2.c  수렴 레지스트리 저작 + 검증  게이트: convergence-without-recipe              C
  2.d  커버리지 게이트               게이트: wave-decomposition-coverage-gap        C
                                            out-of-scope-user-consent               C
  2.e  거부 하한 평가                게이트: route-downgrade-available  business-decision
                                            decomposition-input-missing             C

Phase 3  stage 마다 — 준비된 wave(의존한 wave 가 모두 complete)들을 parallel-waves.md 의 순서로
  3.a  wave 설계 문서 → waves/wave-{n}/design.md, wave 마다 병렬       [loop W]
                                     게이트: wave-design-insufficient               C
                                            unmarked-normative-prose                C
  3.b  /kiwi-srs 로 SRS 등록 (host root, wave 하나씩 직렬; 모든 REQ id 를 여기서 할당)   PW-1
                                     게이트: child-srs-needs-user-or-failed         C
  3.b′ /kiwi-srs-feasibility 로 stability 승급 (조건부, TARGET=wave-{n})                PW-1
  3.c  /kiwi-sds 로 wave 마다 SDS 하나, 독립 서브에이전트 병렬                          PW-2
  3.c′ readiness 파생 + 배정 검사 (SDS @req ⊆ 3.b 배정)
                                     게이트: unallocated-req-id                     C
                                            requirement-not-ready                   C
  3.d  wave 입력 커밋 (명시 pathspec) — 그 sha 가 그 wave 의 dispatch base            PW-3
  3.e  freeze-lane-plan — orchestrate schedule waves --out docs/research/{work}/waves/stage-{s}/lanes.lock.json  PW-4
                                     게이트: schedule-cycle · files-not-grounded ·
                                            lane-plan-drift                         C
  3.e′ 분할 공개 + 검토: lanes.lock.json + waves/stage-{s}/partition.md
                                     게이트: partition-review-unrecorded  business-decision
  3.f  워커 dispatch — stage 의 wave 전부를 한 번에, --serial 이면 하나씩 (§10)       PW-5 · PW-6
                                     게이트: integration-test-user-consent ·
                                            cost-warning-large-task                 C
  3.g  join + 호스트 판정 (collect-lane · verify-lane · remediate-lane)               PW-7 · PW-8
                                     게이트: worker-touched-srs · serial-unit-failed ·
                                            lane-design-refuted ·
                                            interrupted-external-action             C
  3.h  wave 순서로 병합 (integrate-lane) + 병합 뒤 전체 회귀                          PW-9
                                     게이트: serial-unit-failed                     C
  3.i  유예 SRS mutation 재생 (replay-deferred-mutations)                              PW-10
                                     게이트: srs-mutation-replay-failed             C
  3.j  워크트리 반납 (release-lane) — 수확 뒤에만                                      PW-11
  3.k  stage 마감 (§11):                                                                PW-12
       (1) 레지스트리의 수렴 레시피 실행;
       (2) 이 stage 에서 병합된 wave 들의 중복 감사 (§11.1);
       (3) validate 다음 sync-index (§11.3);
       (4) run 자신의 아티팩트 커밋;
       (5) 병합 뒤 호스트가 만든 커밋 창의 코드 리뷰 (§11.2)
                                     게이트: cross-lane-duplication-unresolved ·
                                            post-merge-index-drift ·
                                            child-pipeline-needs-user-or-failed     C
  3.l  wave 마다 실행 후 검증  [loop P]                                                 PW-13
                                     게이트: wave-verify-residual-critical ·
                                            wave-verify-fail-residual ·
                                            wave-verify-cross-wave-fix-required     C
  3.m  wave 경계 이슈 분류 + 해소    게이트: wave-issues-open ·
                                            design-contradiction-at-wave-boundary   C
  3.n  wave 하나씩: 테스트 충분성 → SDS close-out → 요구 승급 → SDS 삭제 (§14)         PW-14 ~ PW-17
                                     게이트: test-sufficiency-gap                   C
  3.o  waves.jsonl 에 complete append (3.l verdict = pass 인 뒤에만)

Phase 4  run 최종: run 창 종료 코드 리뷰 → 테스트 충분성 확인 → loop F   [loop F]
                                     게이트: test-sufficiency-gap ·
                                            final-verify-residual-critical ·
                                            wave-append-cap-exhausted               C
Phase 5  MCP workflow_pipeline_emit 으로 pipeline 이벤트 1건 emit
Phase 6  run 처분 (§15): 통합 브랜치는 그대로 두고 run 리포트에 지명한다.
```

3.a–3.o 는 stage 마다 반복되고, stage 가 끝나면 준비 집합을 다시 계산한다. **target 을 미리 등록하지 않는다** — SRS 와 SDS 는 준비 집합의 wave 에만 저작한다(`parallel-waves.md §3`). 오른쪽 `PW-n` 은 그 단계가 이행하는 `parallel-waves.md §5` 의 단계다. 3.a · 3.c′ · 3.m 은 본 스킬의 훅이다.

### 3.1 Preflight P.5 의 run lock — 취득과 해제를 판정하는 명령

P.5 의 lock 은 git common dir 를 키로 하므로 연결된 워크트리들이 하나의 lease 를 두고 경합한다. 그 취득과 해제와 조회는 MCP `orchestrate_run_lock` 에 `action` 을 `lock` · `unlock` · `status` 중 하나로 주어 수행하고, MCP 가 없으면 CLI `speckiwi orchestrate run lock|unlock|status --json` 으로 같은 판정을 받는다. 이미 다른 run 이 lease 를 들고 있으면 `lock` 이 `orchestrator-run-lock-held` 로 거절하며, 거절 응답이 보유자와 lock 파일 경로를 함께 싣는다. 그 게이트를 내는 것은 세 action 가운데 `lock` 뿐이다.

lock 파일이 디스크에 있는지를 읽어 스스로 내리는 판단은 이 판정을 대신하지 못한다. abort 로 끝나는 run 의 해제는 §15 가 지배한다. abort 가 아닌 종료의 해제도 같은 도구의 `unlock` 이며, 그때 응답의 `heldBy` 는 해제 자신이 본 보유자다. `unlock` 은 보유자가 다른 run 이고 그 프로세스가 살아 있어도 거절하지 않고 lease 를 해제하므로, 종료 해제는 이 run 이 취득한 lease 에 대해서만 부른다. `status` 는 아무것도 바꾸지 않는 조회이며, 보유자의 생존을 확인하지 않고 그대로 보고한다.

P.5 에서 `lock` 이 성공하면 그 응답이 방금 취득한 lease 의 `holder` 를 함께 싣는다 — `owner` · `pid` · `host` · `acquiredAt` 네 값이다. 그 넷을 P.5 pin 으로 `00.run-contract.md` 에 적어 둔다 — 대화에만 남긴 값은 컴팩션에서 없어지고, §1 의 고정 절차가 그 파일을 첫 단계로 읽으므로 재개한 세션이 대조의 한쪽을 그 파일에서 되찾는다. §15 의 abort 를 포함해 P.5 의 lease 를 해제하는 모든 자리 앞에서 `status` 를 불러 그 응답의 `holder` 를 P.5 pin 과 대조한다. 네 값이 전부 같을 때에만 `unlock` 을 부른다. 하나라도 다르면 그 lease 는 이 run 이 취득한 것이 아니고, `holder` 가 `null` 이면 보유자를 이름 붙일 근거가 없으므로, 두 경우 모두 해제 대상에서 제외한다. 재개된 run 이 stale 회수로 교체된 lease 를 만나는 것이 그 대표적인 경우다. `owner` 하나로는 갈리지 않는다 — 그 기본값이 모든 run 에서 같은 문자열이기 때문이다.

### 3.2 다섯 동결 target — 하나의 도구로 잠그고 하나의 철자로 부른다

run 이 내용 주소화하는 아티팩트 집합은 다섯이다 — `design`(1.e) · `waves`(Phase 2 끝) · `lanes`(3.e, stage 마다) · `issues`(3.m) · `postmortem`(3.k activity (4)). 다섯 전부를 MCP `orchestrate_freeze` 에 `target` 과 `body` 와 `document` 와 `head` 를 주어 동결하고, MCP 가 없으면 CLI `speckiwi orchestrate freeze design|waves|lanes|issues|postmortem --body <path> --document <path> --head <sha> --run-id <id> --out <path> --json` 으로 같은 판정을 받는다. 그 kind 가 요구하는 필드를 빠뜨린 body 는 `design-not-frozen` 으로 거절되고, 지명한 문서는 git blob id 로, 선언된 입력은 digest 로 고정된다.

lock 파일을 직접 저작하지 않는다. `--out` 은 target 마다 준다 — 도구 기본값 `kiwi/orchestrator/{run_id}/{target}.lock.json` 에는 wave 성분도 stage 성분도 없으므로, 한 run 이 같은 target 을 여러 번 동결하면 뒤엣것이 앞엣것을 덮어쓴다.

---

## 4. 라우팅 — 규모와 범위 판정

### 4.1 위치: Phase 1.c′

라우팅 분류는 **1.c′** 에 있다. 1.b 의 조사자 3 기 뒤, 1.c 의 갭 QnA 뒤, **1.d 의 설계 저작 앞**, 그리고 어떤 SRS mutation·target 등록·SDS 저작보다도 앞이다.

1.c′ 이 쓰는 아티팩트는 셋이다. `routing/probe.json` 은 동사 `probe-route` 가 게이트 **전에** 쓴다. 영문 산문 `routing/00.routing.md` 도 게이트 **전에** 쓴다 — 사용자가 프롬프트가 아니라 문서를 읽게 하기 위해서다. `routing/route.lock.json` 은 동사 `freeze-route` 가 게이트 **후에** 쓴다. 게이트에서의 해소 기록은 `routing/route-gate.json` 에 게이트 시점에 쓰고 `freeze-route` 의 세 번째 인자로 넘긴다.

**1.c′ 에서 아직 일어나지 않은 것**: `add_requirement` · `update_status` · `update_stability` 호출 없음, target 등록 없음, SDS 저작 없음, 라우팅 아티팩트 커밋 없음. run 의 **첫 SRS mutation 은 Phase 3.b** 다.

**1.c′ 까지 이미 일어난 것**: run root 고정(P.1), 회귀 baseline 포착·고정(P.4), git common dir 위의 run lock 보유(P.5), 통합 브랜치 `kiwi/orch/{run_id}/integration` 생성 또는 채택(0.b)과 그 위의 `commit-run-artifacts` 커밋 2건, 그리고 work-mode 를 **읽었고 쓰지 않았음**(P.3).

### 4.2 route probe — 12 개 필드

각 필드는 `producer` · `call` · `value` · `read_at` 를 기록한다. **`probe.json` 에 없는 값을 읽는 술어는 허용되지 않는다.**

| id | 필드 | producer — 정확한 호출 |
|---|---|---|
| S1 | `mode`, `active_task`, `source` | MCP `get_work_mode`, 아니면 CLI `speckiwi mode`, 아니면 `wait`(fail-open) |
| S3 | `anchored_reqs[]` | 각 `S5.relevant_files[].path` 에 대해 MCP `list_requirements({ traceReference: p, projection: "compact" })` 의 합집합 |
| S3c | `anchor_coverage` | MCP `list_requirements({ target, fields: [...COMPACT_FIELDS, "traceLinks"] })` 에서 `type == "Code"` 행을 가진 요구의 비율 |
| S4 | `scopes[]`, `scope_req_ids[]`, `unresolved[]` | S3 의 `record.scope` 와 architecture-fit 조사자 보고의 합집합을 CLI `speckiwi scopes --json` 의 등록 어휘로 정규화 |
| S5 | `files`, `modules`, `external_paths[]` | code-context 조사자 — `intake-investigate` 가 띄운 서브에이전트 → `code_context.json` |
| S6 | `ambiguities`, `key_entities[]` | intent 조사자 — `intake-investigate` 가 띄운 서브에이전트 → `intent.json`, 1.c 의 QnA **뒤** |
| S7 | `doc` | 1.a 소스 분류 — 1.a 가 고른 동사(`intake-qna` · `intake-document` · `intake-issue`)가 분류한 입력 자체에서 잰다(`01.intake.md` 요약이 아니다). `ordered_sections` 는 명시 순서 표식을 가진 최상위 섹션만 센다 |
| S8 | `epic` | 입력이 GitHub 이슈일 때 `gh issue view`. **`linked_sub_issues` 는 이슈 본문의 `- [ ] #NNNN` 참조를 세어 얻는다** — `gh issue view --json` 필드 목록에 하위 이슈 필드가 없고, 네이티브 하위 이슈 API 는 이 규칙이 잡으려는 추적 이슈에 **0** 을 돌려준다. 네이티브 0 을 "하위 이슈 없음"으로 읽지 않는다 |
| S9 | `target` | MCP `get_active_target` |
| S10 | `blocked_stability[]` | S3c 와 같은 `list_requirements({target})` 호출에서 `stability` 가 `deprecated` 또는 `frozen` 인 요구 |
| S11 | `unreadable[]` | 읽지 못한 필드 id — probe 를 쓰는 오케스트레이터가 선언한 id 와, route probe 파서 — MCP `orchestrate_route_probe`(CLI `speckiwi orchestrate route probe`) — 가 읽지 못한 필드의 합집합. 비어 있지 않으면 그 호출이 `route-probe-unreadable` 로 거절한다 — D8 의 fail-closed 입력 |
| S12 | `declared_existing_req_edit` | 1.b/1.c 의 기존 SRS 문맥 분석 → `existing_srs_context.json` 을 한 번 읽는다 — 그 `candidate_matches[]` 에 `potential-update` 또는 `potential-conflict` 가 1개 이상 |

**크기 필드는 어떤 임계도 구동하지 않는다.** `S5.files` 는 게이트 증거표와 사용자용 산문에만 기록된다. `existing_srs_context.json` 의 `similarity_score` 는 기록되고 임계를 구동하지 않는다. `S9.summary` 는 들어오는 작업이 아니라 **target 에 이미 있는** 요구를 센다. wave splitter 는 1.c′ 에서 호출되지 않는다.

### 4.3 disqualifier-first — 실격이 먼저다

**모든 술어는 rung 을 제거하고, 어떤 술어도 rung 을 선택하지 않는다.** `id` 와 제거된 rung 과 관측값을 전부 기록한다.

| id | 술어 | 제거 |
|---|---|---|
| **D1** `anchored-body-requirement` | `S3` 이 비지 않음 (단위: 요구 개수, 1 이상) — 단 `S3c` 가 0.2 이상일 때 (단위: 비율, 0–1) — 또는 `S12 == true` | `R-STEP` |
| **D2** `unguarded-out-of-cwd-write` | `S5.external_paths[]` 가 비지 않음 (단위: 경로 개수, 1 이상) | `R-STEP` |
| **D3** `multi-scope-write-set` | `S4` 의 크기가 2 이상 (단위: scope 개수) | `R-STEP` |
| **D4** `declared-multi-stage-input` | `S7.ordered_sections` 가 2 이상 (단위: 섹션 개수), 또는 `S8.task_list_groups` 가 1 이상 (단위: 작업 목록 묶음 개수), 또는 `S8.linked_sub_issues` 가 2 이상 (단위: 하위 이슈 개수) | `R-STEP` |
| **D8** `probe-field-unreadable` | `S11.unreadable[]` 의 id 가운데 보호하는 rung 이 있는 것이 1개 이상 (단위: 필드 id 개수) — 각 id 를 그것이 보호하는 rung 으로 보내는 전역 사상 | fail-closed |

**D8 의 사상은 전역(total)이다**: `S3` · `S3c` · `S4` · `S5` · `S7` · `S8` · `S12` 는 `R-STEP` 을 제거하고, `S1` · `S6` · `S9` · `S10` 은 **아무것도 제거하지 않는다**. `S9` 와 `S10` 은 여전히 기록되지만 보호하는 rung 이 없다. `R-ORCH` 는 결코 제거되지 않는다. 보호 rung 이 없는 필드 id 는 빈 목록으로 사상되며 정의되지 않은 값으로 사상되지 않는다.

**선택 순서는 고정이다.**

```
order: R-STEP → R-ORCH        첫 생존 rung 이 이긴다
```

`R-STEP` 이 `R-ORCH` 앞인 이유는 D3 와 D4 가 정확히 "오케스트레이션 형태"를 만드는 폭과 순서 조건에서 `R-STEP` 을 제거하기 때문이다. **`R-ORCH` 는 어떤 술어로도 제거되지 않으므로 사다리는 항상 정확히 하나의 rung 에서 끝난다.**

**분류기 안에는 tie-break 규칙이 없다. 동점이 생길 수 없기 때문이다.** 동점이 생길 수 있는 유일한 자리는 게이트의 위원회 ballot 이다(§4.6).

**잘못된 라우팅은 추적 가능해야 한다.** 두 경로 중 하나로 추적된다: `route.lock.json` 의 `removed[]` 에 기록된 **술어 하나와 관측값 하나**, 또는 게이트가 대안을 골랐을 때 같은 lock 의 `proposed_rung` 과 `overridden_by` 와 ballot 해소 기록.

`route.lock.json` 은 `rung` · `proposed_rung` · `overridden_by` · `alternative` · `decisive` 와 `{rung, by, observed}` 행을 갖는 `removed[]` 배열, 그리고 probe 경로와 probe digest 를 기록한다.

### 4.4 work-mode 충돌

**영속 work-mode 는 `R-STEP` rung 을 제거하지 않는다.** 라우팅 판정은 **오케스트레이터 자신의 판단이지 설정에서 읽은 모드가 아니고**, **기본 모드는 `wait`** 이며 `wait` 은 **fail-open** 값이기도 하다 — 모드가 rung 을 제거하면 `set_work_mode` 를 한 번도 실행하지 않은 저장소에서 사용자가 지목한 경로가 **구조적으로 도달 불가**가 된다.

| 경우 | 동작 | 기록 |
|---|---|---|
| rung `R-STEP`, `S1.mode == "tdd"` | `/kiwi-tdd` 를 dispatch | `route.lock.json` |
| D1–D4 가 step rung 을 제거해 rung 이 `R-STEP` 이 아님, mode tdd | 그대로 라우팅 | 비치명 WARN 1건 — 모드와 rung 을 지명. lock 의 `work_mode.divergence` 는 `step-rung-removed` |
| `R-STEP` 은 생존했으나 게이트가 대안 `R-ORCH` 를 골라 rung 이 `R-ORCH`, mode tdd | `R-ORCH` 로 라우팅 | 비치명 WARN 1건 — 모드·rung·무효화된 라우팅 절을 지명. lock 의 `work_mode.divergence` 는 `step-rung-overridden` — 두 rung 사다리에서는 step rung 이 순서로 지지 않으므로 이 경우는 override 로만 생긴다 |
| rung `R-STEP`, `S1.mode` 가 tdd 가 아님 | `route-step-requires-mode-switch` 발화 | 게이트의 결정·선택지·해소 규칙 |

`route-step-requires-mode-switch` 는 `business-decision` 이고 `critical_gates[]` 밖이며 세 선택지를 갖는다.

| 선택지 | 행동 | 결과 문장 | recommended |
|---|---|---|---|
| **`switch-and-step`** | `set_work_mode(mode="tdd")` 뒤 `/kiwi-tdd` dispatch | 영속 프로젝트 전역 work-mode 를 `docs/spec/steps/state.md` 에 기록한다 | 없음 |
| **`stay-and-orchestrate`** | 가장 가까운 생존 rung 으로 라우팅, 모드 그대로 | 작업은 step 형태지만 run 은 sdd 사슬로 진행한다 | **있음** |
| **`abort`** | 중단하고 probe 와 run 리포트를 기록 | 요구·target·SDS·work-mode 를 하나도 변경하지 않는다 | 없음 |

`S1.source` 가 `default-wait` 이면 이 게이트의 `recommended` 표식을 **통째로 보류**한다 — 읽히지 않은 설정이 어느 방향으로도 **무숙고 경로**를 사지 못하게 한다. 선택지가 셋이므로 1-1-1 분할은 다수가 없고, 다수가 없으면 게이트는 critical 로 격상되어 중단한다.

`--auto` 아래에서 `R-STEP` 이 살아남으면 `tdd-route-unattended` 를 올린다. 이 게이트는 `route-step-requires-mode-switch` **뒤에** 평가되고 그 게이트가 `switch-and-step` 으로 해소되지 않았을 때에만 발화한다. 선택지는 `proceed-step` 과 `orchestrate-instead` 둘이며 `recommended: true` 는 `orchestrate-instead` 에 붙는다. rung 을 실격시키는 대신 게이트로 올린다.

**오케스트레이터는 `set_work_mode` 를 자기 권한으로 호출하지 않는다.** 모드를 쓰는 유일한 경로는 사람 또는 위원회가 게이트에서 `switch-and-step` 을 고르는 것이다.

**모드가 무력화되는 것이 아니라 그 라우팅 절만 무효화된다.** `R-ORCH` 로 라우팅되어도 모든 wave SDS 는 테스트 먼저 구현된다 — `kiwi-coder` 는 언제나 TDD 다.

### 4.5 rung 별 경로표

**종료 hop 의무** — 통과 판정을 기록하는 모든 경계는 `kiwi-review-fix-loop` 을 **정확히 한 번** 거친다. R-STEP 은 그런 경계가 run 종료 하나, R-ORCH 는 각 wave 마감과 run 최종 검증이다. 두 rung 어디에도 **예외는 없다** — rung 별 면제를 쓰면 분류기의 크기 술어를 되풀이하게 되어 이후의 모든 step 라우트가 스스로를 면제한다. R-ORCH 의 wave 마감이 심판하는 커밋 창은 둘로 나뉘고 각 커밋은 정확히 한 번 리뷰된다 — 워커가 만든 커밋은 그 워커가 자기 창에서(§10), 병합 뒤 호스트가 만든 커밋은 3.k 의 호스트 hop 이(§11.2) — 호스트 커밋에 코드 파일이 없으면 hop 대신 `no-host-code-commits` 를 기록한다(§11.2).

이 의무는 자식의 **반환값에 조건 걸지 않는다**. `TASK_DONE` 이어야 도는 것이 아니고, `NEEDS_USER` · `FAILED` 는 §0.4 가 부모를 중단시키므로 애초에 hop 에 닿지 않는다 — §0.4 halt 가 **반환값으로 정해지는 유일한** 비실행 경로다. 아래의 `not-applicable-empty-window` 와 `no-host-code-commits` 도 hop 을 부르지 않지만 반환값이 아니라 **창으로 정해진다** — 앞은 창에 커밋이 없을 때, 뒤는 R-ORCH 호스트 창의 diff 에 코드 파일이 없을 때다. "무조건 실행한다"라고 쓰지 않는 이유가 이것이다: 그렇게 쓰면 §0.4 와 정면으로 부딪힌다.

경계가 심판하는 커밋 창이 비어 있으면 `terminal_review.verdict = "not-applicable-empty-window"` 로 기록하고 게이트는 **발동하지 않는다** — 코드를 한 줄도 쓰지 않은 run 은 리뷰를 빚지지 않으며, 이 분기가 없으면 요구만 저작한 run 마다 술어가 소음인 게이트가 울린다. R-ORCH 의 wave 마감에서 병합 뒤 호스트 창에 커밋은 있지만 그 diff 에 `kiwi-review-fix-loop` §11 의 부류로 코드 파일이 하나도 없으면 — 수렴 레시피·재생·인덱스 동기화 커밋뿐이면 — hop 대신 `no-host-code-commits` 를 그 stage 마감의 저널 줄 `notes` 와 run 리포트에 기록하고(§11.2) 게이트는 마찬가지로 **발동하지 않는다** — `terminal_review.verdict` 의 값이 아니다. 커밋이 착지한 **뒤** run 이 게이트에서 멈췄으면 hop 을 자동 실행하지 않고 `terminal_review.verdict = "skipped-run-halted"` 로 기록하며, 그 run 은 **완료로 보고하지 않는다** — resume 의 첫 동작이 이 hop 이다.

기록은 `waves.jsonl` 의 run 종료 줄에 `terminal_review {skill, base, head, verdict}` 로 남긴다(FR-NODE-188). 위임 유닛은 `--no-pipeline-emit` 로 돌므로 `pipeline.jsonl` 에 근거를 두면 resume 뒤에 증명할 수 없다. 이 hop 은 심판이 아니라 심판의 **선행 조건**이다 — 자신의 PASS 가 wave 게이트를 충족하지는 않는다.

모든 rung 은 종료 코드 리뷰 hop **뒤에** 테스트 충분성 확인을 한 번 돌고(`~/.claude/skills/_shared/kiwi/test-sufficiency.md`), run 리포트에 그 결과를 적는다.


#### 4.5.1 `R-STEP` → `kiwi-tdd`

**호출 전에 존재해야 하는 것**: 동결된 `routing/probe.json` 과 `rung = "R-STEP"` 인 `routing/route.lock.json`; intake 요약에서 결정론적으로 파생한 **40자 이하 kebab** `<task>` 이름; 1.c 에서 이미 쓴 작업 개요 문단 `docs/research/{work}/01.intake.md`; `S1.mode == "tdd"`; 그리고 **설계 문서 없음** — 1.d 는 실행되지 않았고 실행되어서도 안 된다. `kiwi-tdd` 가 자기 SDS 를 저작하기 때문이다.

```
Skill({ skill: "kiwi-tdd", args: "<task> --review-hop-owned-by-parent --no-pipeline-emit [--auto] [--max] [--mini | --loops N] [--model <name>]" })
```

**플래그**: `--mini` 와 `--loops N` 은 전파한다. `--model` 은 사용자가 지정했을 때 전파한다. `--max` 는 **아래 리뷰 hop 의 자식에게 전파한다** — 리뷰 루프 자신의 옵션이다. `--regression-baseline` 은 **주지 않는다**: `기존` 은 baseline 커밋 시점에 이미 있던 것으로 판정되고(kiwi-coder §0.20.1), 자식의 불가침 게이트는 `기존` 만 보호한다. run 시작에 고정된 P.4 pin 을 주면 kiwi-tdd 가 방금 쓴 red 단계 테스트가 `기존` 이 **아니게 되어 보호 밖으로 나간다**. 주지 않으면 자식이 hop 직전에 스스로 baseline 을 잡아 그 테스트들이 `기존` 이 되고, §0.17 이 삭제·약화를 막는다. `--auto-cost-warning` · `--auto-integration` · `--force` 는 전파하지 않는다 — 리뷰 루프에 그 옵션이 없다. 그것들은 `kiwi-pm` 을 거쳐 `kiwi-coder` 에 닿는 게이트이고 이 rung 에는 그 경로가 없다. `--auto` 와 `--max` 는 **`kiwi-tdd` 자신에게도 전달한다**: `kiwi-tdd` 는 `_shared/kiwi/auto-option.md` 를 따르고 자기 `critical_gates[]`(§0.AG)를 선언했으므로 `--auto` 는 자식에서 **활성**이다. 그 표 밖의 `sds-architecture-decision-approval` 은 business-decision 이라 `--auto` 에서 결정 위원회가 정하고, 그 위원회는 `--auto --max` 에서 **5인**이다(auto-option.md §2 · §7) — `--max` 를 빼면 무인 run 의 SDS 설계 결정이 3인 위원회로 조용히 줄어든다. `kiwi-tdd` 자신에게는 네 pass-through 를 전파하지 않는다 — 그 자식에게는 해당 게이트가 없다. 리뷰 hop 의 자식에 대한 전파는 이 문단 앞부분이 정한다. `--review-hop-owned-by-parent` 와 `--no-pipeline-emit` 는 반대로 **언제나 준다**: 앞의 것은 이 rung 의 step 창 리뷰를 아래 hop 이 소유한다는 뜻이므로 자식이 자기 홉을 한 번 더 돌려 §4.5 의 "정확히 한 번"을 깨지 않게 하고, 뒤의 것은 위임 유닛의 종료 줄이 `pipeline.jsonl` 에 섞이지 않게 한다. 둘은 위 "전파하지 않는" 열거에 속하지 않는다 — 자식이 그 두 인자를 **명시적으로** 받았을 때만 억제하므로, 여기서 빠지면 자식은 추론하지 않고 자기 홉을 돌린다.

**리뷰 hop** — 승급 여부와 무관하게, 아래 close-out 보다 **먼저** 이 step 의 커밋 창을 리뷰한다:

```
Skill({ skill: "kiwi-review-fix-loop", args: "--base {step_window_base} --head {step_window_head} --no-pipeline-emit [--auto] [--max] [--mini|--loops N] [--model <name>]" })
```

`--close-reqs` 는 **주지 않는다** — `kiwi-tdd` 가 이미 `promote_step_requirement` 로 승급했고, 리뷰 루프의 `denominator` 는 `implemented` 요구만 담으므로 이미 승급된 step 요구는 애초에 그 안에 없고, 따라서 `scoped` 가 비어 `TASK_DONE` 이 정당하다 — 스킵이 아니라 셀 것이 없는 것이다. 창을 명시하는 이유도 같다: 범위를 주지 않으면 커밋이 끝난 깨끗한 트리에서 직전 5커밋으로 폴백한다.

리뷰가 고친 것은 close-out **앞에서 커밋한다** — 커밋하지 않으면 아래 종료 줄의 `terminal_review.head` 가 자기 결과를 담지 않은 커밋을 가리킨다. 이 hop 은 **red 단계에서 저작한 테스트를 수정하지 않는다**. `kiwi-tdd` 는 red 테스트 약화를 금지하지만 리뷰 루프의 시니어 fixer 에게는 그 제약이 없어서, 명시하지 않으면 이 rung 이 존재하는 이유인 규율을 합법적으로 무를 수 있다.

**테스트 충분성 확인** — 리뷰 hop 이 커밋한 **뒤**, 이 step 의 요구 ID 와 `--sds docs/spec/steps/<task>/design.md` 를 범위로 `~/.claude/skills/_shared/kiwi/test-sufficiency.md` 를 돈다. 리뷰가 테스트를 고쳤을 수 있으므로 `kiwi-tdd` 가 승급 직전에 돈 확인으로 대신하지 않는다. 공백이 남으면 `test-sufficiency-gap` 으로 멈춘다.

**반환 후 네 결과**:

- *승급됨*: `dispatch-route` result line 에 `outcome: "delegated-complete"` 와 `status: "complete"` 를 함께 기록하고, **P.5 run lock 을 해제**하고, 통합 브랜치를 그대로 두고 run 리포트에 지명하고, `validate` → `sync-index` → `validate --fail-on-warning` 을 실행한다. 살아남은 드리프트는 `post-merge-index-drift`(critical)다. run 리포트에 테스트 충분성 확인 결과를 적는다. 그 뒤 `next_hint: null` 과 rung 및 step 을 지명하는 summary 로 `pipeline.jsonl` 이벤트 1건을 emit 하고 중단한다.
- *자식 자신의 게이트에서 정지*: 그대로 보고하고 멈춘다. **다시 라우팅하지 않는다.** 그것들은 misroute 가 아니라 run 안의 결함이다.
- *경계 redirect 발화*: E1 로 승격한다(§4.7).
- *리뷰 hop 이 `NEEDS_USER` · `FAILED` 를 반환하거나 잔여 CRITICAL/HIGH 로 끝남*: `child-pipeline-needs-user-or-failed` 로 중단한다. 덮는 실행이 아니므로 run 은 완료로 보고하지 않는다.

#### 4.5.3 `R-ORCH` → 공용 wave 엔진을 직접 구동

**진입 전에 probe 말고 존재해야 하는 것은 없다.** 이 rung 은 자기 전제조건을 스스로 생산한다 — 1.d 의 설계, 2.a 의 분해, 3.b 의 wave 별 SRS, 3.c 의 wave 별 SDS.

**`R-ORCH` 는 스킬 호출이 아니다.** 오케스트레이터는 자기 흐름을 계속하면서 `_shared/kiwi/wave-decomposition.md` 와 `_shared/kiwi/parallel-waves.md` 와 `_shared/kiwi/verify-loop.md` 와 `_shared/kiwi/run-ledger.md` 를 호출하고, artifact root 로 `docs/research/{work}/` 를 넘긴다 — `kiwi-wave-master` 가 `docs/analysis/kiwi-wave-master-{run_id}/` 를 넘기는 자리다.

**`kiwi-orchestrator` 는 `kiwi-wave-master` 를 결코 호출하지 않는다.** 근거 네 가지:

1. 추출 뒤에는 형제 스킬을 호출하는 것이 **중복 경로**다 — 이미 참조하는 모듈에 닿으려고 스킬을 하나 더 거치는 것이기 때문이다;
2. 형제의 **입력 계약이 맞지 않는다** — 자기가 쓰지 않은 입력 문서를 요구하고, 오케스트레이터가 저작해 동결한 기준선에서 설계 항목을 다시 파생시킨다;
3. 형제의 **run 스코프 pin 이 충돌한다** — 저널 root 와 회귀 baseline 이 오케스트레이터 자신의 P.4 pin 과 부딪힌다;
4. 중첩 run 은 하나의 논리적 run 에 대해 **두 번째 `run_id` 와 두 번째 engine 값**으로 한 저널에 줄을 쓴다 — v1.4.0 이 추가한 판별자를 무력화한다.

**사용자가 `kiwi-wave-master` 를 명시적으로 지목한 요청은 가로채지 않는다.** 분류하지도 않고 run 을 시작하지도 않는다 — 요청이 형제 스킬을 지목했다고 보고하고 멈춘다.

**wave 마다의 위임은 이름으로 개별 호출한다** — 이 rung 의 wave 위임은 `kiwi-pipeline` 을 **어떤 호출 형태로도** 거치지 않는다. `05` 의 흐름이 SDS 와 구현 사이에 `derive-readiness`(3.c′)와 `commit-wave-inputs`(3.d)를 끼우는데 파이프라인의 고정 사슬에는 그 이음매가 없기 때문이다. `--none-cycle` 도 해법이 아니다 — 단일 다음-단계 조언자 역시 이 rung 의 동작이 아니므로, 거부의 대상은 플래그가 아니라 스킬이다.

```
Skill({ skill: "kiwi-srs",
        args: "REQ_PATH=waves/wave-{n}/excerpt.md
               --research-doc waves/wave-{n}/design.md --research-doc waves/wave-{n}/excerpt.md
               --constraints-doc design/constraints.json TARGET=wave-{n} [--auto] [--max] [--mini|--loops N]" })
Skill({ skill: "kiwi-srs-feasibility", args: "TARGET=wave-{n} [--auto] [--max] [--mini|--loops N]" })   (조건부)
Skill({ skill: "kiwi-sds", args: "TARGET=wave-{n} --req-filter <3.b 배정 집합> --sds-id {run_id}-wave-{n}
        --convergence-registry design/convergence-registry.json --existing-modules design-baseline.json --no-pipeline-emit
        [--auto] [--max] [--mini|--loops N] [--model <name>]" })
/kiwi-pm SDS_PATH=docs/sds/{run_id}-wave-{n}.sds.md …          (wave 의 워커가 — §10)
Skill({ skill: "kiwi-review-fix-loop", args: "--base {last_merge_commit} --head {host_tip}
        --no-pipeline-emit [--auto] [--max] [--mini|--loops N]" })   (3.k — 병합 뒤 호스트가 만든 커밋)
```

SRS 저작의 두 호출은 호스트가 wave 하나씩 직렬로 하고(`parallel-waves.md` PW-1), SDS 작성은 wave 마다 독립 서브에이전트가 병렬로 한다 — `--serial` 이면 하나씩(`parallel-waves.md §2`). `kiwi-sds` 가 크기 상한 때문에 SDS 를 조각으로 나눠도 wave 하나 = lane 하나 = 워커 하나이고, 그 워커가 조각 순서대로 `kiwi-pm` 을 한 번씩 부른다(`parallel-waves.md §3`). 각 wave 의 워커는 자기 창을 `--close-reqs` 없이 스스로 리뷰한다(§10). 호스트의 `/kiwi-review-fix-loop` 교정 hop 은 **병합 뒤 호스트가 만든 커밋**에 대해서만 실행하며 **`--commit-lane-work` 도 `--close-reqs` 도 전달하지 않는다** — 워커의 창을 호스트가 다시 리뷰하지 않는다.

3.m 이 §13.2 의 분류로 라우팅하는 호출과 `verify-loop.md` §7 의 개선 위임이 부르는 호출도 위 블록의 호출 형태를 그대로 쓰고 `[--auto] [--max] [--mini|--loops N]` 을 함께 싣는다 — 범위를 좁히려고 `--req-filter` 나 `--sds-id` 를 더한 재실행도 마찬가지다.

**stability 승급 홉은 조건부다.** 그 wave 의 요구 중 `stability` 가 `draft` 이거나 implementability 가 미검증인 것이 하나라도 있으면, 3.b 직후이자 3.c′ 앞인 3.b′ 에서 `/kiwi-srs-feasibility` 를 `TARGET=wave-{n}` 으로 부른다. 전부 `evolving` 이상이면 건너뛴다 — `kiwi-pipeline` 의 `조건부 feasibility` 절이 이미 쓰는 조건과 같은 조건이며, 승급 판정 기준을 두 벌로 만들지 않으려고 `update_stability` 를 직접 부르지 않고 그 기준을 소유한 스킬을 부른다. **위의 `kiwi-pipeline` 거부는 wave 를 파이프라인에 라우팅하는 것을 막는 것이지 형제 스킬을 이름으로 부르는 것을 막는 것이 아니다** — 뒤 세션이 그 문장을 근거로 이 홉을 지우지 않게 여기 적는다. 홉이 없으면 3.b 가 저작한 요구가 `draft` 인 채로 3.c′ 에 도달하고, `requirement-not-ready` 는 §0.G 에 있어 `--auto` 로도 넘어가지 않는다. 범위는 `TARGET=wave-{n}` 으로 반드시 한정한다 — 이 스킬은 target 전수의 stability 를 일괄로 움직이므로 범위를 주지 않으면 다른 wave 의 요구까지 승급 평가 대상이 된다. 그 스킬이 구현 가능성을 낮게 판정해 `draft` 로 남기면 3.c′ 는 여전히 멈추며, 그때 멈추는 것이 옳다 — 그 경우 `update_stability` 시도가 저널과 요구의 Change Notes 에 남으므로, 홉이 실행되지 않은 것과 구분된다.

**wave 의미 게이트는 상속되지 않고 오케스트레이터 자신의 `critical_gates[]` 에 선언되어 있다**(§0.G): `wave-verify-residual-critical` · `wave-verify-fail-residual` · `wave-verify-cross-wave-fix-required` · `final-verify-residual-critical` · `wave-decomposition-coverage-gap` · `out-of-scope-user-consent` · `wave-append-cap-exhausted` · `decomposition-input-missing` · `child-srs-needs-user-or-failed` · `child-pipeline-needs-user-or-failed` · `unsafe-option-refused` · `wt-delegation-refused` · `invalid-loop-option` — **13개 전부**. `parallel-waves.md §4` 의 계약 게이트도 같은 이유로 전부 §0.G 에 있다.

이유를 함께 적는다. **뒤 세션이 중복이라고 지우지 않게** 하기 위해서다. **`_shared` 모듈은 자식이 아니다.** 자식 게이트 상속 규칙의 전제는 *실행 중인 자식 스킬이 `gate_id` 를 bubble 하는 것*인데, `R-ORCH` 의 `_shared` 모듈은 게이트 선언을 담지 않으며 **아무것도 bubble 하지 않는다**. **게이트 선언은 구조상 스킬 단위다.** 그리고 심각도가 선언되지 않은 게이트는 `business-decision` 으로 떨어져 `--auto` 아래에서 위원회가 승인한다.

위임 rung 에 적용되는 **상속 안전 규칙 둘**(§0.4): 자식이 `NEEDS_USER` 또는 `FAILED` 를 반환하면 `--auto` 라도 부모가 중단한다. 자식이 **자기** 게이트 표의 게이트를 bubble 하면 부모 표에 **같은 이름의 행이 없어도 무조건 중단**한다.

### 4.6 게이트와 ballot

`route-proposal` 의 ballot 은 선택된 rung 과 `decision.alternative` 이며, `alternative` 가 `null` 이면 선택된 rung 과 `abort` 다. 선택지 둘에 위원 셋이면 **동점은 산술적으로 불가능**하다. 남는 중단 사유는 **degraded quorum** — 한 명이 실패해 둘이 남고 1-1 이 되는 경우 — 이며 **critical 로 격상되어 중단**한다.

`route-proposal` 이 `recommended: true` 를 갖는 것은 **다섯 절이 모두 성립할 때뿐**이다.

1. `probe.unreadable == []` — D8 이 발화하지 않았다;
2. rung 이 `R-ORCH` 일 때 `decision.decisive` 가 `null` 이 아니고, 자기 단위에서 margin 이 1 이상이거나, 함께 발화한 다른 술어가 보강하는 boolean 이다;
3. 1.c 의 QnA 뒤 `S6.ambiguities == 0`;
4. rung 이 `R-STEP` 일 때 모드 출처가 `default-wait` 이 아니다;
5. rung 이 `R-STEP` 이고 D1 이 측정으로 그것을 통과시켰을 때 `anchor_coverage` 가 0.2 이상이다.

성립하지 않으면 표식을 보류하고 `withheld_because[]` 가 실패한 절을 지명한다.

**위원회 입력은 사실만 운반하고** 본 세션의 **잠정 제안을 절대 운반하지 않는다**. 위원은 `gate_id` 와 `severity` 와 `options[]` 와 **probe 표**와 **제거 표**를 받는다. 산문 파일 `routing/00.routing.md` 는 **사용자가 읽는 것**이고 위원회는 증거를 읽는다. fast-path 로 결정된 건은 `{"rule": "recommended-fastpath", "committee_size": 0, "marked_by": …}` 감사 행을 run 의 결정 감사 로그에 기록한다.

**어느 override 분기에서도** — 사용자든 위원회든 — lock 은 대안을 `rung` 으로, 분류기의 선택을 `proposed_rung` 으로, `overridden_by` 를 `"user"` 또는 `"committee"` 로, 그리고 ballot 해소 행을 기록한다. **override 뒤에 `computeRoute` 를 다시 실행하지 않는다.** **ballot 은 분류기 자신의 출력 위에서 닫혀 있으므로**, 두 선택지가 모두 **계산된 생존자**이며 override 는 어느 것이 실행될지를 바꿀 뿐 **분류기가 만들지 않은 rung 을 결코 도입하지 못한다**.

### 4.7 승격은 한 방향이다

**승격은 `R-STEP → R-ORCH` 한 방향뿐이다. 하향은 거부된다.** 게이트는 **전이가 아니라 이미 착지한 것**의 함수다. 저널이 하향을 허용하지 않기 때문이다 — `complete` 는 append 전용이고 역방향 간선이 없으며 재개는 완료된 wave 를 영원히 건너뛴다.

**E1 · `R-STEP → R-ORCH`** 의 두 trigger:

| trigger | 관측 시점 | 그 순간의 비용 |
|---|---|---|
| (a) SDS 가 200줄 상한에 접근 | 자식 Phase 2, **첫 red 테스트 전** | 거의 0 — 아무것도 커밋되지 않았다 |
| (b) 기존 body 요구 편집이 감지되거나 `promote_step_requirement` 가 `MUTATION_DENIED` 반환 | 자식 **Phase 6**, green 이후 | **구현이 이미 작성되어 있다** |

promote 의 `EVIDENCE_REQUIRED` 와 merge 의 `COMPLETION_GATE_BLOCKED` 는 **trigger 가 아니다**. 그것들은 run 안의 결함이고, **품질 실패로 승격하면** 막힌 run 이 rung 이 떨어질 때까지 기어오른다.

**모든 승격은 `routing/misroute-{n}.json` 을 기록한다** — probe id, trigger, **발화했어야 할 술어**, 그리고 그 술어가 **필요로 했을 값**. E1 의 두 번째 trigger 에서는 anchor 가 맞았어야 할 파일과 관측된 anchor coverage 도 함께 지명한다.

**carry manifest.** step 의 `design.md` 와 `intent.md` 는 1.d 의 연구 입력이 되고 그 뒤 wave 마다 `--research-doc` 인자가 된다. green 이후 trigger 에서는 병합된 테스트와 구현이 **통합 브랜치에 남고** `R-ORCH` 설계 기준선에 `out_of_scope` 와 `exclusion_class = "already-implemented"` 로 봉인된다. **green 구현은 결코 wave SDS 에 들어가지 않는다** — 모든 SDS 는 테스트 먼저 구현되고 **의무적 red 확인**을 거치는데 옮겨온 green 코드는 그것을 통과하지 못한다. **`already-implemented` 봉인은 `--auto` 라도 `out-of-scope-user-consent` 를 발화시킨다.** 분모에서 작업을 덜어내는 승격은 **조용할 수 없다**.

**`R-STEP` 승격의 lease 위생**: 오케스트레이터는 `update_step_state(<task>, "abandoned")` 를 호출하고 `update_step_state(<task>, "merged")` 는 호출하지 않는다. step 의 요구는 대신 `/kiwi-srs` 가 **body scope 에 저작**하기 때문이다.

`route-escalation-after-landed-state` 는 §0.G 에 선언되어 있고, 승격이 통합 브랜치의 커밋 또는 요구의 `status` 나 `stability` 를 움직인 SRS mutation 뒤에 올 때 발화한다. **첫 red 테스트 전에 감지된 승격은 자유이며 게이트가 없다.**

`route-deescalation-refused` 도 §0.G 에 선언되어 있고 Phase 3.b 이후 rung 을 내리려는 모든 시도에서 발화한다. **유일하게 합법인 하향은 Phase 2 끝의 `route-downgrade-available` 이고 그 뒤로는 없다.** 최종 출구는 `abort-run` 이며, **통합 브랜치와** `docs/research/{work}/` 에 이미 쓰인 모든 것을 그대로 두고 **run lock 을 해제**한 뒤 그 상태를 **run 리포트에 지명**한다.

**재개 시 rung 은 `frozen.route.rung` 에서 읽고 결코 다시 계산하지 않는다.** `frozen.route.probe_digest` 가 `probe.json` 과 불일치하면 `run-invariant-drift`(critical)다. **재개 세션에는 대화도 조사자도 없으므로** `computeRoute` 는 run 당 **정확히 한 번** 실행된다.

---

## 5. Phase 1 — intake

### 5.1 세 단계

1. **소스 분류** — **닫힌 분류**다. **얇은 의도**, **연구 또는 설계 문서**, **GitHub 이슈** 셋뿐이고 각각 자기 동사를 갖는다: `intake-qna` · `intake-document` · `intake-issue`.
2. **조사** — **조사자 3 기를 병렬로** 실행한다(`--serial` 이면 하나씩). stance 는 **intent** · **code-context** · **architecture-fit** 셋이며 동사는 `intake-investigate` 다.
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

1. **열린 질문 집합** — `01.intake.md` 의 모든 미해소 항목, 즉 QnA 잔여분에 `/kiwi-srs-research` 가 보존한 모든 **이견 항목**을 더한 것;
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

이 순서는 경로를 레지스트리에 매칭하는 **모든 자리에서 동일하게 적용**한다. lane 하나는 wave 하나의 워커다.

| recipe.kind | lane 적격 | 결과 |
|---|---|---|
| **`exclusive-lane`** | 적격 | wave 전체 **유일성 제약** 아래 — 그 경로를 건드리는 wave 는 모두 그것을 자기 SDS 쓰기 집합에 적으므로, 쓰기 집합 겹침이 그 wave 들을 서로 다른 stage 로 가른다. 한 stage 에서 그 경로를 소유하는 워커는 최대 하나다 |
| **`orchestrator-only`** | 부적격 | wave SDS 의 Files 에 적지 않는다. 호스트가 병합 뒤 3.k activity (1) 에서 처리한다 |
| **`regenerate`** | 부적격 | wave SDS 의 Files 에 적지 않는다. 생성기는 호스트가 병합 뒤 3.k activity (1) 에서 돌린다 |
| **`replay`** | 부적격 | wave SDS 의 Files 에 적지 않는다. 호스트 root 의 재생(3.i)이 적용한다 |

부적격 경로를 SDS 에서 빼는 것은 `kiwi-sds` 가 `--convergence-registry design/convergence-registry.json` 으로 받은 레지스트리를 읽어서 한다(`parallel-waves.md §3`). 스케줄 도구는 레지스트리 경로를 빼지 않으므로, 그 경로가 SDS 에 남으면 겹친 wave 들이 서로 다른 stage 로 갈라질 뿐 오류는 나지 않는다.

### 7.3 거부 하한과 유일하게 합법인 하향

거부 하한은 **Phase 2 끝**에서 평가한다. 거부 하한은 **`--serial` 로의 저하를 제안하지 않는다** — stage 안의 동시성은 wave 의존과 쓰기 집합이 정하고, `--serial` 은 사용자의 선택이다. 하한에서의 **유일한 명시적 거부는 `decomposition-input-missing`** 이다.

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

wave 마다 `waves/wave-{n}/design.md` 에 **영문**으로 wave 설계 문서를 저작한다. 3.a 에서 쓰고 loop W 가 검증한다. 준비 집합의 wave 들은 서로 다른 파일을 쓰므로 wave 마다 병렬로 저작하고 검증한다 — `--serial` 이면 하나씩이다.

- **검증자 1 stance**: 그 wave 의 `design_items` **커버리지**.
- **검증자 2 stance**: **동결된 설계 lock 에 대한 내부 정합성**.
- **동결 분모**: **그 wave 의 `design_items` 조각**.

**loop W 는 3.b 의 `/kiwi-srs` 등록 전에 통과해야 한다.** **3.a 가 3.b 앞이고**, 3.b 는 이 문서를 자기 **연구 문서로 소비한다**. cap 소진은 `wave-design-insufficient` 를 올리며 **통과로 세지 않는다**.

wave 설계 문서는 run 설계 문서와 **같은 표시 항목 규칙** 아래 있다. `[D-nnn]` 또는 `[I-nnn]` 행 밖의 규범 문장은 **3.a** 에서 `unmarked-normative-prose` 를 올린다.

---

## 9. Phase 3.c — wave 마다 SDS 하나

wave 마다 `/kiwi-sds` 가 `docs/sds/{run_id}-wave-{n}.sds.md` 하나를 lite 프로필로 저작한다(§4.5.3 의 호출). sds-id 는 `{run_id}-wave-{n}` 이고, `--req-filter` 는 그 wave 의 3.b 배정 집합이다. SDS 는 에이전트용이다 — `speckiwi sds check` 를 통과하면 `kiwi-sds` 가 스스로 `agreed` 로 올리고, 사용자 승인 게이트는 없다. 사용자 판단이 필요한 설계 문제는 SDS 검토가 아니라 질문(또는 `--auto` 의 결정 위원회)으로 올라온다.

**3.c′ 배정 검사**: wave 의 SDS 파일마다(조각으로 나뉘었으면 조각 전부) `speckiwi sds check <path> --json` 요약의 요구 ID 를 모은 합집합이 비어 있지 않고 그 wave 의 3.b 배정 집합과 같아야 한다 — 밖의 요구가 있거나 배정 집합의 요구가 빠졌으면(`kiwi-sds` 가 `draft` 등으로 범위에서 뺀 요구) `unallocated-req-id` 다(`parallel-waves.md` PW-2). readiness 파생은 §V.derive-readiness 가 적는다.

SDS 는 3.d 의 wave 입력 커밋에 함께 실린다 — 워커의 dispatch base 에 SDS 가 있어야 워커가 그것을 읽는다. **워커는 SDS 를 고치지 않는다.** 구현이 설계 항목을 반증하면 워커는 매니페스트로 보고하고 멈춘다(§13.4).

SDS 는 일회성이다. 3.n 의 close-out 이 해석 결정을 SRS 로 옮기고 승급 뒤 파일을 지운다(§14). 닫혔거나 지워진 SDS 를 현재 설계로 읽지 않는다 — 현재 설계는 코드다.

---

## 10. Phase 3.f – 3.j — wave 워커 실행

실행 절차는 `~/.claude/skills/_shared/kiwi/parallel-waves.md` §5 의 PW-5 ~ PW-11 이 소유한다 — dispatch, 워커가 하는 일, join, 판정, 병합, 재생, 반납. 본 절은 그 절차에 대해 이 스킬이 약속하는 것만 적는다.

**lane 하나는 wave 하나의 워커다.** 한 stage 의 워커들은 **기본이 병렬**로 한꺼번에 dispatch 되고, `--serial` 이면 하나씩이다. 직렬도 같은 실행 경로 — 워크트리 워커를 동시성 1 로 — 이며, 격리 워커를 띄울 수 없는 런타임은 직렬로 돌고 이유를 기록한다(§0.I). stage 계획 lock 의 경로는 `docs/research/{work}/waves/stage-{s}/lanes.lock.json` 하나뿐이고, 그 경로를 읽거나 쓰는 명령에는 언제나 명시적으로 넘긴다.

각 wave 의 워커가 부르는 실행자:

```
/kiwi-pm SDS_PATH=docs/sds/{run_id}-wave-{n}.sds.md
         --session-suffix w{n}s{s}l{k} --no-final --no-pipeline-emit --commit-lane-work --defer-srs-mutation <queue>
         [--resume] [--auto] [--max] [--model <name>] [--mini|--loops N]
         [--regression-baseline <the P.4 pin>]
```

SDS 가 조각으로 나뉜 wave 도 워커 하나다 — 워커가 카드의 `sds_paths` 를 k 순서로 돌며 조각마다 위 호출을 한 번씩 하고 `SDS_PATH` 는 그 조각이다(`parallel-waves.md §3` · PW-6). 그 뒤 워커는 자기 창을 `--close-reqs` 없이 리뷰하고(`parallel-waves.md` PW-6 의 호출, `[--auto] [--max] [--mini|--loops N]` 을 싣는다), wave 범위의 테스트 충분성 확인을 돈다.

### 10.1 워커 실행자의 세 약속

1. **`--commit-lane-work` 는 여전히 필수**다 — 없으면 `kiwi-pm` 이 **아무것도 커밋하지 않아** wave 의 산출물이 워커 워크트리의 커밋되지 않은 변경으로 남고 호스트가 병합할 것이 없다.
2. **커밋은 네 `Orch-*` trailer 를 유지한다** — `Orch-Run` · `Orch-Wave` · `Orch-Stage` · `Orch-Lane` — 그리고 **subject 표식을 담지 않는다**.
3. **`--serial` 은 동시성만 바꾸고 실행자를 바꾸지 않는다** — 직렬 run 도 `--defer-srs-mutation` 을 넘기고, `kiwi-coder` 의 네 의무 MCP mutation 은 호스트의 재생(3.i)이 run root 에서 적용한다.

### 10.2 `serial-unit-failed` 의 세 disjunct

- wave 의 `verification_cmd` 가 **같은 SDS 로 1회 재시도한 뒤에도** 비-0 으로 끝났다;
- wave 의 워커가 **커밋을 하나도 만들지 않았고** 워커가 그 `/kiwi-pm` 실행 자신의 `docs/analysis/` 번들에 `intentionally_empty` 사유를 선언하지도 않았다;
- 워커의 `/kiwi-pm` 이 `NEEDS_USER` 또는 `FAILED` 를 반환했다.

### 10.3 `intentionally_empty` 처분

**wave 단위**이며 운반체는 워커의 `docs/analysis/kiwi-pm-…` 번들이다. 항목은 그 wave 의 sds-id 와 **20자 이상의 `reason`** 을 담는다.

**허용 조건은 두 연언이다**: 그 wave 의 `verification_cmd` 가 0 으로 끝나고, 그 wave 의 SDS 쓰기 집합의 어떤 경로도 워커의 base 와 head 사이에서 **달라지지 않았을 것**. 두 번째 연언은 **워커의 주장이 아니라 호스트가 트리에서 다시 계산한다**.

**처분은 `checked` 이지 `expected` 에서의 제거가 아니다.** wave 는 `expected` 에 남고 위 두 연언 위에서 `checked` 에 들어간다. 승급(§14)에서는 **landed** 로 세되 `type="test"` 증거만 갖고 **`type="commit"` 참조는 없다**.

### 10.4 분할 공개와 재개 계약

stage 계획은 **3.e 에서 동결되고 3.e′ 에서 dispatch 전에 공개된다.** `partition-review-unrecorded` 는 `business-decision` 게이트이며(§0.S), **3.e** 에서 동결된 lane 계획 **digest** 와 같은 digest 를 기록하고 verdict 가 `pass` 인 `review-partition` result line 이 없는 wave 를 거부한다.

실행자의 재개 계약: 복구는 `Orch-Run` · `Orch-Wave` · `Orch-Stage` · `Orch-Lane` trailer 를 읽고, 그 wave 의 trailer 붙은 워커 커밋이 **워커 브랜치나 `frozen.integration_branch`** 에 이미 있으면 `/kiwi-pm` 을 다시 돌리지 않는다. 그 wave 의 `pm-state.json` 이 있으면 `/kiwi-pm` 에 `--resume` 을 준다. 살아 있는 워커는 다시 dispatch 하지 않는다(`parallel-waves.md §6`).

---

## 11. Phase 3.k — stage 마감

### 11.1 중복 감사

charter 의 무-중복 요구는 **선적된 탐지 기제 하나와 기록된 부재 하나**로 이행한다.

중복 감사는 **Phase 3.k activity (2) 에서**, 그 wave 의 작업이 `frozen.integration_branch` 에 착지한 뒤에 실행된다. 입력은 `frozen.integration_branch` 위 **그 wave 자신의 커밋 범위와, 같은 stage 의 다른 wave 들 중 착지한 것들의 커밋 범위**이며, 각 범위는 자기 wave 의 SDS 쓰기 집합으로 제한한다 — 비교되는 lane 은 한 stage 의 워커들이다. 한 stage 의 쓰기 집합은 서로소이므로 감사가 찾는 것은 같은 파일의 겹침이 아니라 **서로 다른 파일에 같은 심볼이나 블록이 두 번 생긴 것**이다. 워커 자신의 브랜치에서 입력을 가져오지 않는다.

산출물은 `waves/wave-{n}/duplication-audit.md` 이고 finding 마다 한 행이 `symbol_or_block` · `lanes[]` · `paths[]` · `verdict` 를 담는다. verdict 는 **닫힌 3값** `duplicate` · `parallel-evolution` · `acceptable` 이다.

`duplicate` 행의 해소는 **정확히 한 형태**만 허용한다: `issue:{id}` — 그 wave 의 `issues.md` 에 열린 `local-defect` 행을 지명하는 것. **메모는 해소가 아니다.** 그 형태가 아닌 `duplicate` 행에서 `cross-lane-duplication-unresolved` 가 발화한다.

verdict 는 **기록된 서브에이전트 판단이고, 도구는 산출된 후보마다 닫힌 enum 의 verdict 가 기록되었는지만 검사한다**.

**무-중복의 예방 절반은 주장하지 않고 부재로 기록한다.** 파일 수준에서는 한 stage 의 wave 들이 이미 서로소인 SDS 쓰기 집합을 갖고, 심볼 수준에서는 wave 사이에서 SDS Interfaces 가 선언한 심볼을 비교하는 검사가 **없다**. 이 부재는 **X-04** 로 격상되어 있다. `shared-substrate` 충돌 사유도 그에 딸린 게이트도 선언하지 않는다.

### 11.2 병합 뒤 호스트가 만든 커밋의 리뷰

3.k activity (5) 는 병합 뒤 **호스트가 만든 커밋만** 리뷰한다 — 수렴 레시피, 재생, 인덱스 동기화가 만든 커밋이다. 워커의 창은 그 워커가 이미 리뷰했으므로 다시 보지 않는다. 호출은 §4.5.3 의 마지막 줄이며 `--base` 는 그 stage 의 마지막 병합 커밋, `--head` 는 호스트의 tip 이다. 호스트가 만든 커밋이 없으면 창이 비고 `not-applicable-empty-window` 다. 커밋은 있지만 그 창의 파일을 `kiwi-review-fix-loop` §11 의 부류 표로 걸렀을 때 코드 파일이 하나도 없으면 — 수렴 레시피·재생·인덱스 동기화의 `docs/spec/` · 인덱스 · README · 스킬 미러 커밋뿐이면 — hop 을 부르지 않고 `no-host-code-commits`(호스트 코드 커밋 없음)를 그 stage 마감의 저널 줄 `notes` 와 run 리포트에 적는다(`parallel-waves.md` PW-12). 그 스킬은 코드 전용이라 불러도 `empty-code-scope` 로 멈출 뿐이고, 워커 창은 워커가, run 전체는 run 창 종료 리뷰가 본다. 리뷰가 고친 것은 3.l 앞에서 커밋한다.

### 11.3 stage 마감의 `validate` → `sync-index`

`speckiwi validate` 다음 `sync-index` 를 **Phase 3.k activity (3)** 에서 stage 마다 정확히 한 번 실행한다 — 그 stage 의 모든 wave 의 워커가 병합되고(3.h) 그 유예 SRS mutation 이 재생된(3.i) **뒤**, 그리고 **3.l 의 loop P 앞**이다. 그래서 각 wave 는 자기 착지 뒤에 이 실행을 정확히 한 번 거친다.

두 명령의 순서는 **`validate` 가 먼저, `sync-index` 가 나중**이다.

`sync_index` 가 실행된 뒤에도 `validate --fail-on-warning` 이 드리프트를 보고하면 `post-merge-index-drift` 로 run 을 중단한다.

이 실행은 **wave 워커의 병합과 그 유예 SRS mutation 의 재생 뒤**에 오므로, charter C4 의 "모든 병합 뒤" 의무가 붙는 자리가 바로 여기다. lane 하나가 wave 하나의 워커이므로 lane 의 병합이 곧 wave 의 병합이다.

---

## 12. Phase 3.l — loop P

### 12.1 증거 번들과 다섯 동결 분모

증거 번들은 `kiwi-wave-master` 의 기존 행에 더해 `lanes.lock.json` 과 그 wave 의 SDS, `Orch-Wave` 와 `Orch-Lane` trailer 로 키잉된 `frozen.integration_branch` 위 이 wave 의 **커밋 범위**, 그리고 워커의 `docs/analysis/kiwi-pm-…` 번들과 워커 매니페스트를 담는다. `00.charter.md` 와 `01.intake.md` 도 번들에 들어간다. SDS 는 3.n 의 close-out 이 지우기 전에 읽는다.

**다섯 동결 분모**: REQ/AC · wave 의 **설계 항목** · **제약** · **보존 계층** · **단위 계층**. 여기에 검증자 1 의 설계 계층을 확장하는 **의도 계층**이 더해진다. **네 분모만 지명하거나 의도 계층을 빠뜨린 본문은 잘못이다.**

**의도 계층**: `expected` 는 **loop D 의 열린 질문 집합**, `checked` 는 실행 결과가 **여전히 그 해소를 지키는** 행들이다.

**단위 계층은 하위 분모 하나**이며 둘로 쪼개지 않는다.

- `expected` = `lanes.lock.json` 이 그 wave 에 배정한 lane — 그 wave 의 워커 하나;
- `checked` = 그 wave 의 `Orch-Wave` 와 `Orch-Lane` trailer 를 운반하는 워커 커밋이 통합 head 에서 도달 가능하고 **그리고** `verification_cmd` 가 통과한 그 lane, 또는 허용 가능한 `intentionally_empty` 선언을 운반하는 그 wave. 그런 wave 는 `expected` 에 남고 `checked` 에 들어가며 **`expected` 에서 제거되지 않는다**.

스케줄되었으나 **착지하지 않은 워커 하나가 `ALL_MATCH` 를 금지한다**.

`unapproved-damage = 0` 과 `failing_tests ⊆ baseline_failing_tests` 는 통과 전제조건으로 유지된다. 워커 자신의 **worklog `TASK_DONE` 은 `checked` 의 연언으로 인정하지 않는다** — 같은 주체가 쓴 것이므로 독립성을 더하지 않는다.

**loop P 가 병합된 결과를 SRS · SDS · 기록된 결정과 다르다고 판정하면, 원래 워커가 아닌 독립 서브에이전트가 고치고 loop P 가 다시 검증한다** — 경로는 `verify-loop.md` §7 이다(`parallel-waves.md` PW-13).

### 12.2 진동

공용 검증 엔진(`verify-loop.md`)은 같은 `finding_id` 가 2 라운드 이상에 걸쳐 닫혔다 다시 열리거나 같은 hunk 가 되돌려졌다 다시 적용되면 남은 라운드 cap 을 소진하지 않고 **즉시 종료**한다. `verdict = fail-residual` 과 `reason_class` 값 `oscillation` 을 함께 기록하고 `verification-oscillation` 을 올린다. 이 규칙은 엔진에 있으므로 D·W·P·F 모든 루프에 도달한다.

---

## 13. Phase 3.m — wave 경계 이슈 프로토콜

### 13.1 입력 합집합

3.m 의 분류 입력은 loop P 의 `verification.residual[]` 만이 아니라 run 이 산출한 **모든 pre-merge 검증 루프의 잔여분** — **loop D · W** — 을 함께 담는다. 공용 엔진에 **pass-with-residual** 로 닫는 경로가 있고 모든 루프가 그것을 쓰므로 **통과한 루프도 잔여를 운반할 수 있다** — 합집합은 깨끗한 run 에서도 **공허하지 않다**. 워커 매니페스트가 보고한 `out_of_lease_paths[]` 와 워커 리뷰 보고서의 잔여도 합집합에 들어간다.

합집합에 들어온 잔여는 아래 **닫힌 6값 분류**를 받고 `P-WAVE-ISSUES-CLOSED` 의 적용을 받는다. 분류되지 않은 잔여는 3.m 에서 `wave-issues-open` 을 발화시킨 채로 남는다.

### 13.2 닫힌 분류 목록

`wave-issue-triage` 는 **3.m 에서, loop P 뒤·`promote-requirements` 앞**에 실행되며 `waves/wave-{n}/issues.md` 와 생성된 `issues.lock.json` 을 쓴다. **모든 이슈는 정확히 하나의 분류를 받고 목록은 닫혀 있다.**

합집합의 잔여는 MCP `orchestrate_issue_open` 에 `payload` 로 행 하나를 주어 원장에 열고, MCP 가 없으면 CLI `speckiwi orchestrate issue open --payload <payload> --ledger <path> --json` 이다. 이 호출은 아래 여섯 밖의 분류를 거절하고, 원장이 이미 들고 있는 `issueId` 도 함께 거절한다 — 같은 id 가 둘이면 중복 감사의 `issue:{id}` 해소가 어느 행을 가리키는지 정해지지 않으며, `orchestrate wave close` 의 분류 검사는 중복 id 를 보지 않는다. 그래서 원장에 행을 더하는 자리는 이 호출이고, 거절은 `wave-issues-open` 으로 온다.

| class | 뜻 | 경로 |
|---|---|---|
| **`local-defect`** | 코드가 틀렸고 설계는 맞다 | 그 wave 의 커밋 범위에 대한 `/kiwi-review-fix-loop`, **의존하는 wave 의 dispatch 전에 해소** |
| **`missing-task`** | 설계는 맞고 SDS 가 불완전하다 | `--req-filter` 와 `--sds-id` 를 함께 준 wave 재진입 — `kiwi-sds` 로 빠진 부분의 새 SDS 를 쓰고 새 워커를 띄운다, **의존하는 wave 의 dispatch 전에 해소** |
| **`design-gap`** | 설계가 덜 규정되었다 | 설계 항목을 **새 아티팩트**로 덧붙이고 증분 `/kiwi-srs`, SDS 작성부터 재진입. 새 `00.design.lock.json` 을 쓰고 `invariant_digest` 가 정당하게 바뀐다 |
| **`new-wave-required`** | 자기 wave 가 필요하다 | wave 를 추가한다. **run 당 3개 상한**, 초과는 `wave-append-cap-exhausted` |
| **`design-contradiction`** | 설계 항목이 **거짓**이다 | `design-contradiction-at-wave-boundary`. 중단하고, 모순되는 두 `[D-nnn]` id 를 **증거와 함께 지명**하고, `abort-run` 으로 run 을 끝낸다. **위원회가 결정할 수 없다** — 위원회는 설계의 어느 쪽 절반을 버릴지에 투표하게 되기 때문이다 |
| **`out-of-run`** | 어느 wave 에도 속하지 않는다 | 닫힌 어휘의 `exclusion_class` 와 함께 기록 |

### 13.3 `P-WAVE-ISSUES-CLOSED`

wave 의 워커 dispatch 는 그 wave 가 의존하는 모든 wave — 선언된 `depends_on[]`, 없으면 앞 wave 전부 — 가 이 전제조건을 통과할 때까지 막히며 **`orchestrate wave close --wave N` 이 평가**한다. **네 연언이다.**

1. 모든 이슈가 **종단 분류**를 갖는다;
2. 모든 `local-defect` 와 `missing-task` 가 **해소 증거** — 해소 가능한 `file:line`, **테스트 id**, 또는 **커밋 sha** — 를 갖는다;
3. 모든 `design-gap` 이 새 설계 lock digest 를 지명한다;
4. 모든 `out-of-run` 과 `new-wave-required` 가 **기록된 사용자 결정**을 갖는다.

**유예는 자유로운 탈출구가 아니다. `out-of-run` 은 `--auto` 라도 사용자 동의를 요구한다.** `--auto` 나 위원회가 이를 대신 이행할 수 없다.

**기록된 한계**: 도구는 분류의 **형식**을 검사하고 그 **옳음**을 검사하지 않는다. 보상 장치는 wave 의 loop P 가 그 wave 가 의존하는 모든 wave 의 `out-of-run` 항목을 다시 검사하는 것이다.

### 13.4 mid-wave — 워커가 설계 항목을 반증했을 때

동결된 `[D-nnn]` 설계 항목을 기술대로 구현할 수 없다고 판단한 워커는 **`design_item_id` 와 증거를 보고하고 멈춘다**. 운반체는 호스트에 돌아오는 워커의 **lane 매니페스트의 `status: design-refuted`** 이며, 호스트는 `lane-design-refuted`(critical)를 **Phase 3.g** 에서 올린다.

그 워커의 커밋은 워커 브랜치에 **되돌려지지 않은 채 그대로 남는다** — 병합되지 않고 보존된다. 그 lane 의 `verify-lane` result line 에 기록되는 **`lane_disposition` 종류는 종단값 `refuted`** 다.

**승인된 mid-wave 설계 수정**은 `amend-design` 동사로 쓴다.

1. 수정본을 **새** `design/00.design.{seq}.md` 로 저작하고 **새** `00.design.lock.json` 으로 동결한다. **어느 쪽도 제자리에서 편집하지 않는다.**
2. **옛 lock digest**, **새 lock digest**, 반증된 `[D-nnn]`, 그리고 보고 워커의 **증거**를 지명하는 **저널 줄을 append** 한다.
3. 카드의 `frozen.design_lock` 포인터가 새 lock 으로 옮겨가고 `invariant_digest` 를 다시 계산한다. 그래서 `run-invariant-drift` 는 digest 가 **카드가 현재 지시하는** lock 과 불일치할 때에만 발화한다 — **포인터를 그대로 두면** 정당한 수정이 드리프트로 읽힌다.
4. 옛 설계 항목 위에 동결되었던 loop **W · P · F** 의 분모를 새 lock 에서 **다시 동결**하고 영향받은 라운드를 **다시 시작**한다.
5. 영향받은 각 wave 의 SDS 를 `kiwi-sds` 로 **다시 저작**하고, 그 SDS 로 stage 계획 lock 을 다시 동결해 재개가 드리프트를 읽지 않게 한 뒤, 그 wave 를 워커 하나에 **다시 dispatch** 한다.

**mid-wave 수정은 wave 당 2회로 제한된다.** **세 번째는 `design-contradiction-at-wave-boundary` 로 분류된다.**

---

## 14. Phase 3.n — 테스트 충분성, SDS close-out, 요구 승급

승급은 **wave 당 한 번, host root 에서, Phase 3.n 에**, 그리고 **loop P 의 3.l verdict 가 `pass` 인 뒤에만** 일어난다. 한 stage 의 wave 들이 끝나도 3.n 은 wave 하나씩 직렬로 돈다 — SRS 쓰기는 호스트에서 하나씩이다. 순서는 넷이고 바꾸지 않는다: 테스트 충분성 확인 → SDS close-out(옮김) → 승급 → SDS close-out(삭제).

**1. 테스트 충분성 확인** — 승급 **바로 앞**에 `~/.claude/skills/_shared/kiwi/test-sufficiency.md` 를 그 wave 의 범위(3.b 배정 집합)로, wave 의 SDS 파일마다 `--sds <그 파일>` 을 주어 돈다 — 나뉘지 않았으면 `docs/sds/{run_id}-wave-{n}.sds.md` 하나다(`parallel-waves.md §3`). 재진입이 쓴 SDS(`docs/sds/{run_id}-wave-{n}-r{m}.sds.md`)도 그 wave 의 SDS 파일이다. 공백이 남으면 `test-sufficiency-gap` 으로 멈추고 그 wave 의 요구를 `verified` 로 쓰지 않는다. 도구가 AC 마다 돌려준 인용이 아래 `type="test"` 증거의 테스트 식별자다.

**2. SDS close-out, 옮김** — SDS-AC 의 해석 결정을 SRS AC 의 명확화로 옮기고, durable 로 표시된 규칙만 제약 요구로 올린다. 그 wave 의 sds-id 마다 부른다 — 기본 id `{run_id}-wave-{n}` 과 저널에 기록된 재진입 id `{run_id}-wave-{n}-r{m}` 각각이며, 아래 호출의 `{run_id}-wave-{n}` 자리에 그 id 를 넣는다(`parallel-waves.md` PW-15). `kiwi-sds --close <base id>` 는 조각만 찾고 재진입 파일은 찾지 않기 때문이다:

```
Skill({ skill: "kiwi-sds", args: "--close {run_id}-wave-{n} --no-pipeline-emit [--auto]" })
```

**3. 승급** — 집합·전이·증거는 아래와 같다.

**집합**: 그 wave 의 한 워커가 착지했을 때 그 wave 의 Phase 3.b 배정 집합, 착지하지 않았을 때 공집합. **landed** 는 그 wave 의 `Orch-Wave` 와 `Orch-Lane` trailer 를 운반하는 워커 커밋이 `frozen.integration_branch` 위에 있고 `verification_cmd` 가 통과한 것, 또는 그 wave 의 허용 가능한 `intentionally_empty` 선언이다. **lane head 에 대한 `git-ancestor` 증명이나 통과한 클레임 감사나 워커 자신의 보고로 landed 를 정의하지 않는다.**

**두 단계 전이**:

| From | To | 조건 |
|---|---|---|
| `planned` / `in_progress` | `implemented` | 3.n 에서 **그 wave 가 landed** |
| `implemented` | `verified` | **추가로** 이 wave 의 **loop P verdict 가 `pass`** 이고 그 요구를 **지명하는 잔여가 없으며**, 그 wave 가 통과한 `verification_cmd` 를 운반 |

**증거 두 행**:

- `type="test"` — 참조는 `verification_cmd`, detail 은 워커의 `docs/analysis/kiwi-pm-…` 번들(3.g 에서 수확한 사본)이고, `test-sufficiency.md` §4 대로 AC 마다 한 행이다 — `covers` 는 그 AC, notes 는 1 이 그 AC 에 돌려준 인용;
- `type="commit"` — 참조는 `frozen.integration_branch` 위 그 wave 의 `Orch-Wave` trailer 가 붙은 워커 커밋 sha 각각.

**lane `audit.json` 이나 `integrate-lane` 병합 sha 를 증거 참조로 지명하지 않는다.** `intentionally_empty` 선언으로 landed 한 wave 는 워커가 커밋을 만들지 않았으므로 **`type="test"` 증거만 운반하고 commit 참조가 없다**.

**landed 하지 않은 wave 의 요구는 현재 status 에 그대로 두고** 그 wave 의 `issues.md` 에 `missing-task` 로 기록한다. 허용 가능한 `intentionally_empty` 선언을 운반하는 wave 는 **landed 이므로 `missing-task` 가 아니다**.

`add_completed_work` 도 여기서 호스트만 한다.

**4. SDS close-out, 삭제** — 같은 호출을 2 와 같은 sds-id 마다 한 번 더 한다. `@req` 요구가 모두 `verified` 또는 `discarded` 이면 SDS 파일이 지워지고, 그 삭제를 wave 의 close-out 커밋이 싣는다:

```
Skill({ skill: "kiwi-sds", args: "--close {run_id}-wave-{n} --no-pipeline-emit [--auto]" })
```

---

## 15. 통합 브랜치·커밋·중단

run 은 이름 있는 통합 브랜치 `kiwi/orch/{run_id}/integration` 을 갖는다. Phase 0.b 에서 `--base-branch`(기본값은 현재 브랜치) 위에 생성하거나 채택하고 재개 카드의 `frozen` 블록에 기록한다. 생성도 채택도 불가하면 `integration-branch-unavailable` 이다. 워커 브랜치는 `kiwi/orch/{run_id}/{laneId}` 이고 호스트가 통합 브랜치로 `--no-ff` 병합한다.

**오케스트레이터는 그 브랜치를 base 브랜치로 결코 병합하지 않고 pull request 를 결코 열지 않는다.** 이 문장은 본문과 `00.run-contract.md` 의 금지 행동 닫힌 목록 양쪽에 있다. run 리포트에는 **오케스트레이터가 이행할 수 없는 의무** 하나를 적는다: 나중에 통합 브랜치를 **base 브랜치**로 병합하는 사람이 그 직후 base 브랜치에서 `validate` 다음 `sync-index` 를 실행해야 한다.

run 이 `docs/research/{work}/` 아래에 저작하는 모든 아티팩트는 `commit-run-artifacts` 동사 아래 선언된 일정으로 커밋한다. 커밋 지점은 Phase 0(run contract 생성), Phase 1 끝(intake·라우팅·설계와 그 lock), Phase 2 끝(waves lock·제약·레지스트리), 3.d(wave 입력과 SDS), 3.e(stage lock), 3.k activity (4)(검증 라운드·중복 감사·이슈 문서와 lock·postmortem), 3.n(wave 의 close-out — SDS 삭제 포함), Phase 6(run 리포트)이다. 이 일정의 모든 지점은 **명시 pathspec** 을 stage 한다. 이유는 `git clean -fd` 가 동결된 설계와 재개 카드의 `invariant_digest` 가 지시하는 lock 들을 파괴하지 못하게 하는 것이다.

**`abort-run` 은 `halt` 와 구별되는 동사다.** 병합을 되돌리는 일이 없으므로 `frozen.integration_branch` 를 **있는 그대로** 둔다. `docs/research/{work}/00.run-report.md` 를 쓰고 Preflight P.5 의 run lock 을 해제한다. run 리포트의 내용은 다음과 같다.

- **통합 브랜치와 그 sha**;
- **어느 wave 가 `complete`** 인지;
- run 이 **통합 브랜치에 남긴 커밋**;
- **병합되지 않은 워커 브랜치와, 반납하지 못해 아직 실행 중일 수 있는 워커 워크트리**;
- **테스트 충분성 확인 결과** — wave 마다와 run 최종;
- **run 을 끝낸 게이트**;
- 원인이 고칠 수 있는 것이면 **정확한 재개 명령**.

그 중단을 저널에 기록하는 것은 MCP `orchestrate_run_abort` 에 `reason` 을 게이트 id 로, `runId` 를 이 run 으로 주는 호출이고, MCP 가 없으면 CLI `speckiwi orchestrate run abort --reason <id> --run-id <id> --json` 이다. `reason` 은 자유 문장이 아니라 게이트 id 이며 `verification.residual[]` 의 `reason_class` 어휘와 다르다. 기록이 착지한 뒤에만 run lock 이 풀린다 — 저널 쓰기가 막히면 이 호출은 lock 을 쥔 채 `run-invariant-drift` 로, 아티팩트 락 경합이면 `journal-artifact-lock-held` 로 거절한다. 자기 종료를 기록하지 못한 run 은 다른 세션이 합류해서는 안 되는 run 이기 때문이다.

작업이 착지한 뒤 발생하는 **종단 중단**은 `wave-verify-fail-residual` · `post-merge-index-drift` · `design-contradiction-at-wave-boundary` · `srs-mutation-replay-failed` 넷이다.

---

## 16. 옵션

`kiwi-wave-master` 에서 그대로 상속: `--auto` · `--max` · `--mini` / `--loops N` · `--model <name>` · `--resume` · `--run-id` · `--constraint`(반복 가능) · `--serial`. `--drive` (FR-FLOW-119) 는 **상속하지 않는다** — 본 스킬은 자체 게이트 표와 자체 `--auto` 계약을 쓰므로, wave-master 의 함의 집합을 물려받으면 이 표에 없는 게이트를 연 것으로 읽힌다. pass-through 중 `--auto-integration` · `--auto-cost-warning` · `--force` 는 **사용자가 지정했을 때에만** 흐른다. `--regression-baseline` 은 예외로, 사용자가 주었든 아니든 오케스트레이터 자신의 run 전역 P.4 pin 을 운반한다.

| 옵션 | 뜻 |
|---|---|
| `--work <name>` | `docs/research/{work}/` 디렉터리. 해소 순서: (1) `--work` 값, (2) intake 소스의 slug, (3) `get_active_target` 이 하나를 돌려줄 때에 한해 이미 활성인 target 이름, (4) `orchestrator-{YYYY-MM-DD}`. Preflight 에서 `^[a-z0-9][a-z0-9.-]{2,39}$` 로 검증한다 |
| `--design-doc <path>` / `--issue <n>` | intake 소스(Phase 1.a) |
| `--base-branch <name>` | run 의 통합 브랜치가 갈라져 나오는 곳. 기본값은 현재 브랜치. 오케스트레이터는 여기에 쓰지 않는다 |
| `--lanes N` | **stage 당** 워커 상한, 기본 4, 최대 8. `orchestrate schedule waves --lanes N --out docs/research/{work}/waves/stage-{s}/lanes.lock.json` 으로 넘긴다 |
| `--serial` | 모든 서브에이전트 분기 — 워커, SDS 작성, 조사자, 검증자 — 를 하나씩 돌린다. 사용자가 "직렬로" · "하나씩" · "순서대로" · "serially" · "one at a time" 이라고 말해도 같다. 실행 경로는 같고 동시성만 1 이다(`parallel-waves.md §2`) |
| `--run-budget <mins>` | run 전체 벽시계. 초과 시 다음 stage 경계에서 `abort_gate` 를 `run-budget-exhausted` 로 놓고 `abort-run` 으로 멈춘다 |
| `--subagent-budget N` | run 전체 서브에이전트 spawn 상한. 소진 시 현재 루프를 `verdict = fail-cap` 과 `reason_class = "budget-exhausted"` 로 닫고, 다음 stage 경계에서 `abort_gate` 를 `subagent-budget-exhausted` 로 놓고 `abort-run` 으로 멈춘다 |
| `--strict-grounding` | wave SDS 가 선언한 모든 경로가 dispatch base 에 존재할 것을 요구한다 — `orchestrate schedule waves --strict-grounding` 으로 넘긴다 |

`run_id` 는 기본값 `{YYYY-MM-DD}.{git-toplevel-basename}.{work}` 로 **Preflight P.0 에서** 생성되고 `--run-id` 가 이를 덮어쓴다. `--run-id` 는 `frozen.integration_branch` 에 박히므로 Preflight 에서 검증한다.

---

## 17. Pipeline emit (의무)

종료 시 MCP `workflow_pipeline_emit` 으로 이벤트 **1건**을 emit 한다 — `pipeline-event.md` §5.1 이 다른 스킬에 지시하는 손수 만든 bash append 블록을 쓰지 않는다. run 수준 이벤트는 bare `{run_id}` 를 쓰고 재개 시 `{run_id}#r{n}` 을 쓴다. `next_hint` 는 `null` 이다 — run 은 자기 통합 브랜치 위에서 검증된 채로 끝나고, base 브랜치로의 commit·push 와 PR 생성은 의도적으로 자동 연쇄되지 않는다. 워커는 pipeline 이벤트를 쓰지 않는다.

---

## §V — 동사 색인

닫힌 enum 이다. **동사마다 스킬 섹션 하나**이므로 재개된 에이전트는 문서 전체가 아니라 섹션 하나를 읽는다. 각 섹션은 recovery class 를 선언한다. wave 워커를 다루는 동사는 여섯 lane 동사 — `dispatch-lane` · `collect-lane` · `verify-lane` · `remediate-lane` · `integrate-lane` · `release-lane` — 와 `probe-isolation` · `replay-deferred-mutations` 이며, 절차는 `parallel-waves.md §5` 가 소유한다. **enum 밖의 동사는 재개 시 즉시 정지다.**

### §V.probe-isolation

recovery class **externally-visible**. Preflight P.6. 런타임이 워크트리 격리 워커를 띄울 수 있는지와 `.claude/worktrees/` 가 무시 등록되어 있는지를 판정하고, `isolation.profile` 을 `worktree-parallel` 또는 `worktree-serial` 로, `isolation.reason` 에 근거(`--serial`, 자연어 요청, 런타임 사유)를 기록한다. 그 값은 `frozen` 에 들어간다. 조용히 직렬로 내리지 않는다.
복구: 저널의 `probe-isolation` result 와 카드의 `frozen.isolation_profile` 을 읽는다 — 이미 있으면 다시 판정하지 않는다.

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

recovery class **externally-visible**. Phase 1.a 의 GitHub 이슈 분기. `gh issue view {N} --json title,body,comments` 로 이슈를 읽어 `01.intake.md` 를 만든다. 그 명령은 읽기 전용이지만 `/kiwi-srs-research` 가 노트를 영속시켰을 수 있다.
복구: `docs/research/` 와 그 스킬 자신의 이벤트를 먼저 점검한다.

### §V.intake-investigate

recovery class **pure-reauthor**. Phase 1.b. intent 와 code-context 와 architecture-fit 조사자 3 기를 병렬로 실행한다 — `--serial` 이면 하나씩.
복구: 그냥 다시 한다.

### §V.probe-route

recovery class **idempotent-by-key**. Phase 1.c′, `routing/probe.json` 을 키로 한다. `pure-reauthor` 가 아니다 — S5 와 S6 은 서브에이전트 파생이라 컴팩션을 넘어 재현되지 않으므로 다시 하면 다른 rung 이 나올 수 있다.
`routing/probe.json` 은 MCP `orchestrate_route_probe` 에 `payload` 로 probe 문서를 주어 쓰고, MCP 가 없으면 CLI `speckiwi orchestrate route probe --payload <payload> --out <path> --json` 으로 같은 판정을 받는다. `--out` 은 `routing/probe.json` 이다. 파서가 읽지 못한 필드를 `unreadable[]` 에 모으고, 그것이 비어 있지 않으면 이 호출은 `route-probe-unreadable` 로 거절하며 거절 응답은 그 필드들을 `violations[].field` 로 싣는다 — 성공 응답의 `probe.unreadable` 이 언제나 빈 배열인 것은 그래서다. 읽지 못한 필드를 기본값으로 채운 채 진행하지 않는다.
복구: **영속된 probe 를 읽고 다시 판단하지 않는다.** 짝 없는 `intent` 는 probe 파일이 부분적일 수 있다는 뜻이므로 스키마로 검증하고 `unreadable[]` 로 표시된 필드만 다시 읽는다.
게이트: `route-probe-unreadable`.

### §V.freeze-route

recovery class **idempotent-by-key**. 게이트 뒤 `routing/route.lock.json` 을 쓴다. 내용 주소화되어 digest 가 같으면 다시 해도 no-op 다.
lock 은 MCP `orchestrate_route_freeze` 에 `probe`·`gate`·`out` 을 주어 쓰고, MCP 가 없으면 CLI `speckiwi orchestrate route freeze --probe <path> --gate <path> --out <path> --json` 이며 세 경로는 차례로 `routing/probe.json` 과 `routing/route-gate.json` 과 `routing/route.lock.json` 이다. 재개 카드의 경로는 이 도구의 MCP 인자가 아니다 — run id 에서 파생된 기본 경로를 쓰며, 그 경로를 지정하는 플래그는 CLI 에만 있다. 이 호출은 probe 를 다시 파싱하므로 `unreadable[]` 이 비지 않으면 여기서도 거절한다. 응답의 `noop` 이 참이면 digest 가 같아 lock 이 다시 쓰이지 않은 것이고, `card` 가 null 이 아니면 재개 카드가 같은 호출에서 함께 갱신된 것이다 — 카드 갱신은 `noop` 과 무관하다. lock 을 손으로 쓰지 않는다.
복구: 다시 실행하면 분류기의 제안이 아니라 **override 를 재현한다** — 게이트 결과가 `routing/route-gate.json` 에 영속되어 세 번째 인자로 다시 읽히기 때문이다.
게이트: `route-probe-unreadable`.

### §V.dispatch-route

recovery class **externally-visible**. 자식이 변경을 만든다.
복구: 자식 자신의 `pipeline.jsonl` 이벤트를 점검하고 그 다음 MCP `list_steps` 를 점검한 뒤 재진입한다. **실행 중일 수 있는 자식을 다시 dispatch 하지 않는다.**

### §V.escalate-route

recovery class **externally-visible**. §4.7 의 E1. lock 을 다시 쓰고, 작업을 `out_of_scope` 로 봉인할 수 있고, `/kiwi-srs` 에 재진입할 수 있다. `routing/misroute-{n}.json` 을 쓴다.
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

recovery class **externally-visible**. Phase 3.b. `/kiwi-srs` 가 요구를 저작했을 수 있다.
복구: `list_requirements --target wave-{n}` 과 `srs_authored` 표식을 점검한 뒤 재진입한다.
게이트: `child-srs-needs-user-or-failed`.
같은 phase 의 stability 승급 홉(`/kiwi-srs-feasibility`, 3.b′)도 이 동사가 덮는다 — 그 홉이 요구의 stability 를 움직였을 수 있어 recovery class 가 같고 재진입 점검도 같은 조회이므로, `§V` 동사를 새로 만들지 않는다.

### §V.sds-wave

recovery class **externally-visible**. Phase 3.c. wave 마다 `/kiwi-sds` 가 `docs/sds/{run_id}-wave-{n}.sds.md` 를 쓴다(§9) — 준비 집합의 wave 들은 독립 서브에이전트가 병렬로, `--serial` 이면 하나씩.
복구: `docs/sds/{run_id}-wave-{n}.sds.md` 가 있고 Status 가 `agreed` 이면 `kiwi-sds` 가 그것을 재사용한다 — 다시 저작하지 않는다. 없거나 `draft` 이면 그 wave 만 다시 부른다.
게이트: `child-pipeline-needs-user-or-failed`.

### §V.derive-readiness

recovery class **idempotent-by-key**. Phase 3.c′. 새 스냅샷 위의 순수 재계산이며 3.b 배정 집합에 대한 배정 검사를 함께 수행한다.
readiness 는 MCP `orchestrate_readiness_check` 에 `target`·`snapshot`·`req` 를 주어 파생하고, MCP 가 없으면 CLI `speckiwi orchestrate readiness check --target <t> --snapshot <path> --req <id> --json` 이며 `--target` 은 이 wave 의 target 이다. `--req` 에는 3.b 배정 집합을 그대로 준다 — 빈 목록은 target 전수 훑기가 아니라 오류다. 이 도구가 올리는 게이트는 `requirement-not-ready` 하나이고, 스냅샷이 담지 않은 id 도 그 게이트로 온다. 같은 절의 `unallocated-req-id` 는 배정 검사의 게이트이며 이 도구가 내는 값이 아니다 — 그 검사는 wave SDS 파일들의 `speckiwi sds check <path> --json` 요약 요구 ID 합집합이 3.b 배정 집합 밖의 요구를 담거나, 비어 있거나, 배정 집합의 요구를 빠뜨린 경우를 잡고, 배정된 요구와 wave 설계 항목이 서로 짝이 없는 자리까지 네 연언으로 본다.
스냅샷 파일은 이 wave target 의 `list_requirements` 응답과 `summarize_target` 응답을 한 JSON 문서로 합친 것이며, 레코드는 요약 투영이 아니라 전체 투영으로 받는다 — 기본 투영은 요구마다의 수용 기준과 검증 증거를 빼고 답하므로 그 응답으로 만든 문서는 게이트에 닿지 못한 채 스냅샷 해석 오류로 끝난다.
머리줄은 최상위 키 이름이고, 이어지는 두 줄은 판별자 값마다 그 문서가 함께 실어야 하는 것을 적는다 — `target` 은 이 wave 의 target 이며 마지막 칸에 적힌 이름들이 그대로 최상위 키다. 판별자가 없거나 그 줄의 키를 빠뜨린 문서는 게이트가 아니라 스냅샷 해석 오류로 끝난다. 빈 줄 뒤의 마지막 줄은 그 전체 투영의 이름과, 그것을 지정하는 MCP 인자 이름과 CLI 플래그다.

```
transport               target  그 밖의 최상위 키
mcp-list-requirements   <t>     records diagnostics summary
speckiwi-list-json      <t>     list summary

레코드 투영 full         MCP projection      CLI --format
```

복구: 다시 계산한다.
게이트: `unallocated-req-id` · `requirement-not-ready`.

### §V.commit-wave-inputs

recovery class **externally-visible**. Phase 3.d. wave 설계·excerpt·SDS(`docs/sds/{run_id}-wave-{n}.sds.md`)·3.b 가 바꾼 SRS·제약·레지스트리를 명시 pathspec 으로 wave 마다 커밋한다. 그 커밋의 sha 가 그 wave 의 dispatch base 이며, 저널의 `isolation.base_sha` 와 재개 카드의 `open[].base_sha` 에 기록한다.
복구: `git log` 에서 `Orch-Run` 과 `Orch-Verb: commit-wave-inputs` 와 `Orch-Wave: {n}` trailer 를 점검한다.

### §V.freeze-lane-plan

recovery class **idempotent-by-key**. Phase 3.e. 준비 집합의 wave SDS 로 stage 계획을 쓰고 동결한다:

```
speckiwi orchestrate schedule waves --sds <path> --depends <payload> --lanes N --existing-paths <path> --out <path> --run-id <id> --json
speckiwi orchestrate freeze lanes --body <path> --document <path> --head <sha> --run-id <id> --out <path> --json
```

`--sds` 는 준비 집합의 SDS 경로를 wave 순서로 반복해 주고, `--depends` 는 `{waveId: [waveId…]}` JSON, `--existing-paths` 는 `docs/research/{work}/waves/stage-{s}/existing-paths.json`, 동결의 `--body` 와 `--document` 는 그 lock, `--head` 는 그 lock 을 명시 pathspec 으로 커밋한 sha, `--out` 은 `docs/research/{work}/waves/stage-{s}/lanes.freeze.json` 이다 — 동결은 커밋된 문서를 고정하므로 커밋이 먼저다. `--strict-grounding` 은 사용자가 줬을 때만 더한다. **`--out` 은 `docs/research/{work}/waves/stage-{s}/lanes.lock.json` 이고 생략하지 않는다** — 도구는 경로를 run root 기준으로 풀므로 `docs/research/{work}/` 를 빼면 lock 이 run 디렉터리 밖에 쓰인다 — 도구 기본값에는 stage 성분이 없어 뒤 stage 가 앞 stage 를 덮어쓴다. `--depends` 에는 이번 `--sds` 집합 안의 의존만 적고 이미 병합된 의존은 목록에서 빼되 wave 의 키는 `[]` 로라도 남긴다(`parallel-waves.md §3`). lock 이 stage 를 여럿 내면 첫 stage 만 dispatch 한다(`parallel-waves.md §3`).
다시 계산한 결과가 바이트 동일해야 하며 아니면 `lane-plan-drift` 다.
게이트: `schedule-cycle` · `files-not-grounded` · `lane-plan-drift`.

### §V.review-partition

recovery class **pure-reauthor**. Phase 3.e′. `waves/stage-{s}/partition.md` 를 공개하고 verdict 를 받아 `partition_review` result object 로 기록한다. verdict 어휘는 닫혀 있다: `pass` · `revise` · `abort`. 게이트는 `business-decision` 이므로 `--auto` 에서는 결정 위원회가 verdict 를 기록한다.
복구: 그냥 다시 한다. 이전 verdict 는 반복이 아니라 입력이며, 현재 lane 계획 digest 에 대해 다시 묻는다.
게이트: `partition-review-unrecorded`(business-decision).

### §V.dispatch-lane

recovery class **externally-visible**. Phase 3.f, `parallel-waves.md` PW-5. dispatch 직전에 run root 의 `git status --porcelain docs/spec docs/sds` 를 기록하고, 워커 입력 카드 `waves/stage-{s}/{laneId}.dispatch.json` 을 쓴 뒤 그 stage 의 워커를 한 번에 — `--serial` 이면 하나씩 — 워크트리 격리로 띄운다. 워커는 §10 의 실행자를 부른다.
복구: `git worktree list --porcelain` 에서 그 lane 의 워크트리가 `locked … (pid N)` 이면 살아 있는 워커이므로 **다시 dispatch 하지 않는다**. 워커 브랜치 `kiwi/orch/{run_id}/{laneId}` 에 trailer 커밋이 있거나 매니페스트가 있으면 `collect-lane` 으로 넘어간다.
게이트: `integration-test-user-consent` · `cost-warning-large-task` · `interrupted-external-action`.

### §V.collect-lane

recovery class **idempotent-by-key**. Phase 3.g, PW-7. stage 의 워커가 모두 돌아오기를 기다리고 결과는 반환값이 아니라 매니페스트 파일에서 읽는다. `waves/stage-{s}/{laneId}/` 로 수확한다 — 무엇을 수확하는지는 `parallel-waves.md` PW-7 이 정한다(큐·매니페스트와, 워크트리에만 있는 세션 worklog · `pm-state.json` · `docs/analysis/kiwi-pm-…` 번들 · 리뷰 분석 디렉터리).
복구: 다시 수확한다 — 같은 파일을 같은 곳에 복사한다.

### §V.verify-lane

recovery class **idempotent-by-key**. Phase 3.g, PW-8. 호스트가 워커마다 판정을 낸다 — 워커의 green 은 판정이 아니다. 판정 항목은 `parallel-waves.md` PW-8 이 소유한다. dispatch 전후 `docs/spec` · `docs/sds` 상태가 다르면 `worker-touched-srs`, 매니페스트가 `design-refuted` 면 `lane-design-refuted` 이고, 그 lane 의 result line 에 `lane_disposition` 종단값 `refuted` 를 기록한다.
복구: 다시 판정한다 — 호스트가 워크트리에서 `verification_cmd` 를 다시 실행한다.
게이트: `worker-touched-srs` · `lane-design-refuted` · `serial-unit-failed`.

### §V.remediate-lane

recovery class **externally-visible**. Phase 3.g ~ 3.h. 판정 실패, 병합 충돌, 병합 뒤 회귀의 신규 실패는 같은 SDS 로 새 워커를 **한 번** 다시 띄운다 — 판정 실패는 같은 base, 병합 문제는 새 base 위에서, 브랜치 `kiwi/orch/{run_id}/{laneId}-r2`. 다시 실패하면 `serial-unit-failed` 다.
복구: `-r2` 브랜치와 그 워크트리를 점검한다 — 살아 있으면 다시 띄우지 않는다.
게이트: `serial-unit-failed`.

### §V.integrate-lane

recovery class **externally-visible**. Phase 3.h, PW-9. 판정을 통과한 워커 브랜치를 **wave 순서로** `frozen.integration_branch` 에 `--no-ff` 병합하고 stage 병합 뒤 전체 회귀를 돈다.
복구: `git merge-base --is-ancestor <워커 head> {frozen.integration_branch}` — 이미 조상이면 병합된 것이다. 병합 중단 상태면 `interrupted-external-action` 이다.
게이트: `serial-unit-failed` · `interrupted-external-action`.

### §V.replay-deferred-mutations

recovery class **idempotent-by-key**. Phase 3.i, PW-10. 수확한 큐를 `orchestrate replay plan` 으로 계획하고 호스트 root 에서 `orchestrate replay apply --plan <path> --applied kiwi/orchestrator/{run_id}/replay-applied.jsonl --frozen-target wave-{n}` 으로 적용한다.
복구: `replay-applied.jsonl` 의 시도 기록에서 남은 호출만 환원한다 — append 인 두 도구의 행이 중복되지 않는다. 기록이 실패로 남긴 호출은 조용히 재시도하지 않는다.
게이트: `srs-mutation-replay-failed`.

### §V.release-lane

recovery class **externally-visible**. Phase 3.j, PW-11. **수확이 끝난 뒤에만** `git worktree remove` 로 워커 워크트리를 반납한다. 워커 브랜치는 병합 뒤에도 지우지 않는다 — 증거가 가리킨다.
복구: `git worktree list --porcelain` 에 그 워크트리가 남아 있으면 수확이 끝났는지 먼저 확인하고 다시 반납한다.

### §V.post-merge-verify

recovery class **idempotent-by-key**. Phase 3.l 의 loop P 라운드. §12.1 의 다섯 동결 분모와 의도 계층 위에서 검증한다.
복구: 라운드를 다시 한다.
게이트: `wave-verify-residual-critical` · `wave-verify-fail-residual` · `wave-verify-cross-wave-fix-required` · `verification-oscillation`.

### §V.wave-issue-triage

recovery class **pure-reauthor**. Phase 3.m, loop P 뒤·`promote-requirements` 앞. §13.1 의 입력 합집합을 §13.2 의 닫힌 6값으로 분류해 `issues.md` 와 `issues.lock.json` 을 쓴다.
복구: 그냥 다시 한다. 이슈 문서는 다시 생성된다.
게이트: `wave-issues-open` · `design-contradiction-at-wave-boundary`.

### §V.resolve-wave-issues

recovery class **externally-visible**. Phase 3.m. `local-defect` 는 `/kiwi-review-fix-loop` 로, `missing-task` 는 `--sds-id` 와 `--req-filter` 를 준 wave 재진입으로 라우팅한다 — `kiwi-sds` 로 빠진 부분의 새 SDS 를 쓰고 새 워커를 띄운다.
복구: 그 스킬들의 저널을 먼저 점검한다.
게이트: `wave-append-cap-exhausted` · `out-of-scope-user-consent`.

### §V.amend-design

recovery class **externally-visible**. §13.4 의 승인된 mid-wave 수정. 새 `design/00.design.{seq}.md` 와 새 `00.design.lock.json` 을 쓰고 제자리 편집을 하지 않는다.
복구: 새 `00.design.lock.json@sha256` 과 그 저널 줄이 이미 있는지 점검한 뒤 다시 저작한다.

### §V.promote-requirements

recovery class **externally-visible**. Phase 3.n. §14 의 네 단계 — 테스트 충분성 확인, SDS close-out(옮김), 승급, SDS close-out(삭제) — 를 host root 에서 wave 하나씩 적용한다.
복구: `get_requirement` 를 먼저 점검한다. `kiwi-sds --close` 는 멱등이므로 다시 부른다.
게이트: `test-sufficiency-gap`.

### §V.final-verify

#### run 창 종료 리뷰 홉 — 이 절이 진술하는 규칙은 `FR-FLOW-131` 이 소유한다

recovery class **idempotent-by-key**. Phase 4 의 loop F 라운드. 분모는 모든 `design_items` 와 `integration_items` 의 합집합이다.

**run 창 종료 리뷰** (§4.5 가 선언한 의무의 R-ORCH 쪽 이행) — loop F 가 pass 를 기록하기 **전에** run 전체 커밋 창을 1회 리뷰한다. wave 별 홉의 분모는 그 wave 창 하나이므로, 어느 wave 창에도 온전히 들어가지 않는 결함은 여기서만 보인다:

```
Skill({ skill: "kiwi-review-fix-loop", args: "--base {run_diff_window.base_sha} --head {run_diff_window.head_sha} --no-pipeline-emit --regression-baseline {P.4 pin} [--auto] [--max] [--mini|--loops N]" })
```

`--close-reqs` 는 주지 않는다 — run 스코프에서 그것은 모든 wave target 의 status 를 한 호출로 뒤집는 bulk-finalize 다. `--regression-baseline` 은 P.4 가 run 시작에 고정한 값을 준다: 주지 않으면 자식이 run 끝에서 스스로 baseline 을 잡아 wave 1..N 이 만든 실패를 전부 "기존"으로 승격시킨다.

리뷰 뒤 **커밋한 다음** run 의 모든 wave 배정 집합을 범위로 테스트 충분성 확인을 돈다(`~/.claude/skills/_shared/kiwi/test-sufficiency.md`) — 공백이 남으면 `test-sufficiency-gap` 으로 멈추고 run 리포트에 그 결과를 적는다. 그 뒤 loop F 를 돌리고 run 종료 줄을 쓴다 — 리뷰가 고친 것이 커밋되지 않으면 `terminal_review.head` 가 자기 결과를 담지 않은 커밋을 가리킨다.

#### run 종료 줄과 그것을 판정하는 검증기 — 이 절이 진술하는 규칙은 `FR-FLOW-155` 가 소유한다

run 종료 줄에는 `terminal_review {skill, base, head, verdict}` 를 싣는다. `base` 는 그 줄의 `run_diff_window.base_sha` 와 같아야 한다. `head` 는 심판한 범위의 head 이며 run head 와 같을 필요가 없다 — 리뷰의 수정을 커밋한 뒤 이 줄을 쓰기 때문이다. verdict 은 완료를 방면하는 `pass` 와 `not-applicable-empty-window`, 그리고 방면하지 않는 `residual` 과 `skipped-run-halted` 로 갈린다(FR-NODE-188). 창이 비면 `not-applicable-empty-window`, 커밋 착지 뒤 중단이면 `skipped-run-halted`.

종료 줄을 쓴 직후 그 줄을 검증기에 통과시킨다 — `terminal_review` 가 계약대로 실렸는지는 이 절의 산문이 아니라 `validateWavesJournal` 이 판정한다. `kiwi-orchestrator` 가 쓴 저널이면 MCP `orchestrate_validate` 를 `runId` 와 `strict: true` 로 부르고, MCP 가 없으면 CLI `speckiwi orchestrate validate --run-id {run_id} --strict --json` 으로 같은 판정을 받는다. `kiwi-wave-master` 가 쓴 저널은 **MCP 로 검증하지 않는다** — 그 도구에는 엔진 인자가 없다. 그 저널은 CLI 로만 검증하며 `--engine kiwi-wave-master` 를 함께 준다. error 급 진단이 하나라도 나오면 `terminal-review-loop-missing` 으로 run 을 중단하고 **종료 줄을 다시 쓰지 않는다** — 거부를 없애려는 재작성은 결함을 고치는 것이 아니라 기록을 고치는 행위다. MCP 로 보내면 기본값 `kiwi-orchestrator` 로 파싱되어 그 run 의 줄을 한 줄도 보지 않은 채 깨끗하다고 답한다.

복구: 라운드를 다시 한다.
게이트: `final-verify-residual-critical` · `wave-append-cap-exhausted`.

### §V.emit-and-finish

recovery class **idempotent-by-key**. Phase 5. MCP `workflow_pipeline_emit` 으로 이벤트 1건을 emit 한다. 키로 멱등하며 재개 시 `{run_id}#r{n}` 을 쓴다.
복구: 같은 키로 다시 emit 한다.

### §V.abort-run

recovery class **externally-visible**. §15. `halt` 의 동의어가 **아니다** — 사용자가 어떤 저장소 상태에 남는지를 지명하고 run 리포트에 쓴다. `frozen.integration_branch` 를 그대로 두고 P.5 의 run lock 을 해제한다. `00.run-report.md` 를 쓴다.
중단 기록은 MCP `orchestrate_run_abort` 에 `reason` 을 게이트 id 로 주어 저널에 쓰고, MCP 가 없으면 CLI `speckiwi orchestrate run abort --reason <id> --run-id <id> --json` 으로 같은 판정을 받는다. 그 기록이 막히면 run lock 은 풀리지 않은 채 남는다.
복구: `00.run-report.md` 가 이미 있는지 점검한다.
게이트: `run-invariant-drift`.

### §V.halt

종단. recovery class 를 선언하지 않는다. 중단 사유가 된 게이트를 그대로 보고하고 멈춘다. 저장소 상태를 지명해야 하는 중단은 `halt` 가 아니라 `abort-run` 이다.

## 18 워크트리 절차 — 만들고, 그 안에서 일하고, 되돌려준다

**적용 대상: 이 run 이 `~/.claude/skills/_shared/kiwi/parallel-waves.md` 아래 격리 워커에 dispatch 하는 각 wave.** `--serial` 이어도 같다 — 동시성만 1 이다.

사유와 경계와 해서는 안 되는 것은 `~/.claude/skills/_shared/kiwi/worktree-lane.md` 가 소유한다. 여기에 다시 적지 않는다. 수확과 재생 사이의 join · 판정 · 병합은 `parallel-waves.md` PW-7 ~ PW-9 가 소유한다. 아래는 순서뿐이다.

1. **만든다** — base 를 같은 명령의 인자로 준다.

   ```
   git worktree add <lane-root> -b kiwi/orch/{run_id}/{laneId} <base_sha>
   ```

   base 를 두 번째 명령으로 따로 체크아웃하지 않는다 — 그러면 HEAD 가 브랜치에서 떨어지고 레인의 커밋이 어느 브랜치에도 닿지 않는다. 런타임이 워크트리를 이미 만들어 건넸으면 `git -C <lane-root> switch -C kiwi/orch/{run_id}/{laneId} <base_sha>` 를 쓴다. `<base_sha>` 는 그 wave 의 dispatch base — 3.d 의 입력 커밋 sha 다.

2. **배치를 승인받는다** — 가정하지 않고 게이트에 묻는다.

   ```
   speckiwi orchestrate preflight --json --mcp-root <path> --git-root <path> --role <id> --lane-id <id> --lane-plan <path>
   ```

   `--mcp-root` 는 MCP `mcp_workspace_info` 의 `workspaceRoot`, `--git-root` 는 레인 워크트리, `--lane-id` 는 `lane-{waveId}`, `--lane-plan` 은 `docs/research/{work}/waves/stage-{s}/lanes.lock.json` 이다 — lock 은 dispatch base 뒤에 커밋되어 워크트리에 없으므로 호스트 run root 를 앞에 붙인 **전체 경로(absolute path)**로 준다. `--role` 은 `host` 또는 `lane` 이고, 레인 배치를 승인받을 때는 **`--role lane`** 이다. exit 0 이 아니면 그 배치에서 아무것도 하지 않는다 — 거부 사유가 무엇을 고쳐야 하는지 말한다.

   같은 판정을 MCP 에서도 받는다 — `orchestrate_preflight` 바인딩이 `role`·`laneId`·`lanePlan` 을 그대로 노출한다. 이 인자들이 없으면 MCP 호출은 언제나 기본 `role=host` 로 판정되고, 역할 게이트는 호스트를 자처하는 linked worktree 를 거부하므로 워크트리 세션이 실제로 쓰는 표면에서 게이트에 닿을 수 없다. `orchestrate_preflight` 는 `workspaceRoot` 를 받지 않는다 — 판정 대상인 두 root 를 이미 필수 인자로 받기 때문이다.

   그 밖의 `orchestrate_*` 도구와 `workflow_*` 계열 전부는 선택적 인자 `workspaceRoot` (absolute path) 를 받는다. 호스트에 고정된 MCP 서버로도 레인 워크트리의 세션 상태·파이프라인·워크로그를 그 root 기준으로 다룰 수 있다는 뜻이다. `orchestrate_replay_apply` 는 거부한다 — 유예된 SRS mutation 은 호스트 root 에서만 재생되며, 그것이 유예가 존재하는 이유다. 어느 체크아웃의 SRS 를 읽되 아무것도 쓰지 않는 조회 계열도 같은 인자를 받아 그 체크아웃의 SRS 로 답하므로, 레인의 요구 상태를 호스트 세션에서 그대로 물을 수 있다. 그 계열은 지명된 체크아웃에 `docs/spec/00.index.md` 가 없으면 거부하며, 거부는 수리 명령이 아니라 검사한 체크아웃을 이름으로 밝힌다. `docs/spec` 아래에 쓰거나 Requirement ID 를 발급하는 도구는 전부 거부하고, 자기가 어느 root 에 결속되었는지 답하는 도구도 거부한다 — 그 답을 인자로 받으면 P.1 대조의 두 변이 한 출처에서 나온다. 수용된 root 라도 `docs/spec` 아래로 떨어지는 경로 인자는 거부된다. 다만 호출자가 넘기는 경로 인자를 아예 받지 않는다고 선언한 도구는 예외이고, SRS 조회가 `docs/spec` 참조로 필터링할 수 있는 것이 그 선언 덕분이다. 계열마다 어느 도구가 인자를 받는지는 README 의 per-call `workspaceRoot` 표가 이름으로 싣는다. **`workspaceRoot` 를 빠뜨린 SRS 쓰기는 거부되지 않고 호스트 root 에 조용히 떨어진다** — 3.g 의 `worker-touched-srs` 비교가 그 경로를 잡는다.

   **target 범위의 조회·mutation 전에 응답의 `mcpWorkspace.workspaceRoot` 와 `mcpWorkspace.rootSource` 로 워크스페이스 정체를 확인한다** — `rootSource` 가 `per-call-workspace-root` 인 호출만 넘긴 root 에서 답한 것이고, `server-cwd-discovery` 나 `auto-init` 이면 기동 root 가 답한 것이다.

3. **부트스트랩** — 레인에서 1회.

   ```
   npm ci --include=dev --ignore-scripts
   ```

4. **코드 작업** — 레인 안에서, 워커가 §10 의 실행자로. SRS mutation 은 `--defer-srs-mutation <queue>` 로 큐에만 적는다.

5. **수확(harvest)** — 큐와 매니페스트, 그리고 워크트리에만 있는 세션 worklog · `pm-state.json` · `docs/analysis/kiwi-pm-…` 번들 · 리뷰 분석 디렉터리를 호스트 run 디렉터리 `waves/stage-{s}/{laneId}/` 로 가져온다(`parallel-waves.md` PW-7). 그 뒤 join · 판정 · 병합은 `parallel-waves.md` PW-7 ~ PW-9 를 따른다.

6. **재생** — 호스트 root 에서.

   ```
   speckiwi orchestrate replay apply --json --plan <path> --applied <path> --frozen-target <id>
   ```

   `--applied` 는 `kiwi/orchestrator/{run_id}/replay-applied.jsonl`, `--frozen-target` 은 그 wave 의 target 이다.

7. **반납(release)** — **수확이 끝난 뒤에만.** 워크트리를 먼저 제거하면 그 안의 ignored 산출물이 함께 증발한다.
