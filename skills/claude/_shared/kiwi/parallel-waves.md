# kiwi parallel-waves v1.0.0 — wave 를 워커로 병렬 실행하는 공용 계약

`kiwi-orchestrator`(`R-ORCH`) 와 `kiwi-wave-master` 가 wave 를 실행하는 절차의 SSOT. 두 스킬은 이 절차를 다시 적지 않고 §0 에서 본 문서를 지목한다 — 같은 책임을 두 곳이 나눠 가지면 한쪽만 고쳐지고 다른 쪽은 조용히 어긋난다.

관장 요구: `FR-FLOW-188`(본 계약) · `FR-FLOW-195`(wave 선언 파일) · `FR-FLOW-187`(`--sds` 면 wave 당 SDS) · `FR-NODE-216`(선언 파일 스케줄) · `FR-FLOW-186`(테스트 충분성) · `FR-FLOW-183`(SDS close-out) · `FR-NODE-213`(wave 스케줄 커널) · `FR-FLOW-122`(워크트리 계약).

본 계약 안의 `§n` 은 이 파일의 절을 가리킨다. 다른 문서의 절은 문서명과 함께 적는다.

---

## 0. 호출자가 넘기는 것

| 인자 | `kiwi-orchestrator` | `kiwi-wave-master` |
|---|---|---|
| `artifact_root` | `docs/research/{work}/` | `docs/analysis/kiwi-wave-master-{run_id}/` |
| `engine` | `kiwi-orchestrator` | `kiwi-wave-master` |
| wave 검증 단계(§5 PW-13) | 자기 §12 loop P | 자기 §5.5 |
| 호스트 훅 | 3.a wave 설계와 loop W(PW-1 앞), 3.c′ readiness 와 배정 검사(PW-1 뒤, `--sds` 면 PW-2 뒤), 3.m wave 경계 이슈(PW-13 뒤) | 없음 |
| 통합 브랜치(PW-9 가 병합하고 PW-16 이 착지를 보는 곳) | `kiwi/orch/{run_id}/integration`(자기 §15) | run 을 시작할 때 run root 가 있던 현재 브랜치 — 호스트는 run 동안 그 브랜치를 바꾸지 않는다 |

아래 `{artifact_root}` 는 이 인자로 치환한다.

**wave 의 `verification_cmd`** 는 호출자가 run 시작에 pin 한 회귀 명령(`kiwi-orchestrator` Preflight P.4, `kiwi-wave-master` §2.1)이다 — 전체 회귀 스위트이므로 그 wave 의 테스트도 거기 든다. 통과는 `failing_tests ⊆ baseline_failing_tests`(기준선 캡처에 실패했으면 exit 0)다. 호출자는 이 값을 dispatch 카드와 저널에 그대로 싣고, 판정·재시도·착지·승급 증거가 모두 같은 명령을 쓴다 — wave 마다 다른 명령을 고르지 않는다. wave 의 **단위 id** 는 두 호출자 모두 `{run_id}-wave-{n}` 이다 — 저널의 `sds_id`, 워커 `kiwi-pm` 의 `--run-id`, lock 의 wave id 가 이 값이고, `--sds` 면 SDS 경로 `docs/sds/{run_id}-wave-{n}.sds.md` 의 이름이기도 하다. wave 선언 파일은 `{artifact_root}waves/waves.json` 이다(`wave-decomposition.md`). 단위 id 안의 `{run_id}` 는 run_id 를 소문자로 바꾸고 `[a-z0-9.-]` 밖의 문자를 모두 `-` 로 바꾼 값이다 — 단위 id 는 워커 `kiwi-pm` 의 세션 id 이기도 해서 `kiwi-pm` §0.14 의 `[a-z0-9.-]{4,128}` 을 지켜야 한다. 기본 run_id 에 가장 긴 접미사(`-wave-12-r2-3`)를 붙여도 이 상한 안에 든다.

---

## 1. 역할 — 누가 무엇을 쓰는가

- **호스트** — run root 에 머무는 메인 세션.
- **워커** — wave 하나를 맡아 자기 워크트리에서 도는 서브에이전트. lane 하나가 곧 wave 하나의 워커다.
- **독립 서브에이전트** — 호스트가 run root 에서 띄우는 검증자·개선자(`--sds` 면 SDS 작성자도). 워커가 아니다.

| 쓰는 것 | 쓰는 쪽 |
|---|---|
| SRS — Requirement ID 발급, status·stability·증거·trace, Completed Work Log, `docs/spec/` | 호스트만, 하나씩 |
| `docs/sds/` | 호스트와 그 독립 서브에이전트만 |
| `kiwi/waves.jsonl` · `kiwi/pipeline.jsonl` | 호스트만, 도구를 거쳐 |
| lane 쓰기 집합(stage lock 의 `writeSet`) 안의 코드·테스트 | 워커만, 자기 브랜치에 |
| 통합 브랜치 병합 | 호스트만 |

**워커는 SRS 를 쓰지 않고 `docs/spec/` · `docs/sds/` · `kiwi/pipeline.jsonl` · `kiwi/waves.jsonl` 에 쓰지 않는다.** SRS 쓰기가 워커에 가면 막는 장치가 없는 경합이 넷 생긴다: 요구 ID 카운터와 SRS 락이 root 마다 따로이고, 같은 root 에서도 SRS 락은 기다리지 않고 즉시 실패하며, `kiwi-srs` 가 전역 상태인 활성 target 을 바꾸고, 워커 워크트리의 `@req` 해소 테스트는 그 워크트리의 SRS 로 판정한다. 워커의 SRS mutation 은 `--defer-srs-mutation` 큐에 적히고 호스트가 재생한다(PW-10).

---

## 2. 동시성 — 병렬이 기본이고 `--serial` 은 모든 분기를 하나씩

- **기본은 병렬이다.** 한 stage 의 wave 워커를 한꺼번에 dispatch 하고, 조사자·검증자(`--sds` 면 SDS 작성도)처럼 서브에이전트가 여럿으로 갈라지는 자리도 병렬로 띄운다.
- **`--serial`**, 또는 사용자의 자연어 요청 "직렬로" · "하나씩" · "순서대로" · "serially" · "one at a time" 은 **모든 서브에이전트 분기**를 하나씩 돌린다 — 워커, SDS 작성(`--sds`), 조사자, 검증자, `--auto` 의 결정 위원회(`auto-option.md` §2.3 — 위원을 한 명씩 격리해 부른다) 전부다. 실행 경로는 병렬과 **같다**: 워크트리 워커를 동시성 1 로 돌릴 뿐이고, 호스트 root 에서 단위를 직접 실행하는 두 번째 경로를 두지 않는다. 그래서 직렬 run 도 `--defer-srs-mutation` 을 주고 호스트가 재생한다.
- **격리 워커를 띄울 수 없는 런타임은 직렬로 돌고 그 이유를 기록한다.** Preflight 의 `probe-isolation` 이 런타임이 워크트리 격리 워커를 띄울 수 있는지, `.claude/worktrees/` 가 무시 등록되어 있는지를 판정하고 `isolation.profile` 에 `worktree-parallel` 또는 `worktree-serial` 을, `isolation.reason` 에 그 근거(`--serial`, 자연어 요청, 런타임 사유)를 적는다. 조용히 내리지 않는다. 그런 런타임에서는 호스트가 `git worktree add` 로 워크트리를 만들고, 워커 체인은 그 워크트리를 작업 디렉터리로 하는 위임 워커 하나가 돈다.
- 직렬이어도 stage 계산과 공개는 그대로 한다 — 어느 wave 가 독립이었는지는 기록에 남는다.

---

## 3. wave 선언과 stage

- 분해가 wave 마다 선언 항목을 `{artifact_root}waves/waves.json` 에 쓴다 — `wave`(`wave-1`, `wave-2`, …) · `depends_on[]` · `files[]` · `requirements[]` · (`--sds` 면) `sds[]` (`wave-decomposition.md §2`). **`depends_on` 이 없는 wave 는 앞 wave 전부에 의존한다.**
- **준비 집합**은 `complete` 가 아니고 의존한 wave 가 모두 `complete` 인 wave 들이다 — 손으로 세지 않고 `speckiwi orchestrate wave status --waves {artifact_root}waves/waves.json --run-id {run_id} --json` 의 `ready[]` 로 읽는다. SRS(와 `--sds` 면 SDS)는 준비 집합의 wave 에만 저작한다 — target 을 미리 등록하지 않는다. 이월(`verify-loop.md §8`)이 받는 "남은 wave" 는 SRS 저작을 아직 시작하지 않은 wave 이고, 그런 wave 가 없으면 새 wave 를 추가한다.
- 그 wave 의 SRS 저작이 끝나면 호스트가 그 항목의 `requirements[]` 를 배정 집합(`allocation.requirement_ids[]`)으로 채운다 — 스케줄 전에.
- **stage** 는 준비 집합에서 도구가 고른 묶음이다 — 의존이 모두 `complete` 이고 쓰기 집합(항목의 `files[]`, `--sds` 면 그 SDS 의 Files 경로 ∪ Test Plan 테스트 파일도)이 서로소인 wave 들, stage 당 최대 `--lanes N` 개. 계산은 손으로 하지 않는다:

  ```
  speckiwi orchestrate schedule waves --waves {artifact_root}waves/waves.json --run-id {run_id} --lanes N --out {artifact_root}waves/stage-{s}/lanes.lock.json --json [--strict-grounding]
  ```

  두 명령(`wave status` · `schedule waves`)은 호출자 자신의 run 저널을 읽으므로, 엔진 인자는 각 호출자가 자기 스킬에 적은 대로 더한다(`kiwi-wave-master` §5). 도구는 준비 집합만 계획하고, 이미 `complete` 인 의존은 충족으로 친다. `files[]` 는 도구가 dispatch base 의 추적 경로와 스스로 대조한다. `--out` 은 언제나 넘긴다 — lock 경로는 이 한 가지 철자뿐이다. 거절은 `schedule-cycle`(의존 사이클) · `files-not-grounded`(기존 경로의 오타) · `requirement-not-ready`(`requirements[]` 의 요구가 없거나 `draft` · `deprecated` · `discarded`)이며, 거절하면 lock 을 쓰지 않는다. `files[]` 가 빈 wave 는 혼자 stage 에 들고 `undeclared-write-set` 충돌로 기록된다.
- 도구는 lock 에 stage 를 여럿 낼 수 있다. **첫 stage 만 dispatch 한다.** 들지 못한 wave 는 저작이 끝난 채 다음 계산에 다시 들어간다. 충돌 사유는 `wave-dependency` · `write-set-overlap` · `undeclared-write-set` 셋이다.
- 수렴 레지스트리의 `orchestrator-only` · `regenerate` 경로는 wave 항목의 `files[]` 에도, `--sds` 면 SDS 의 Files 에도 적지 않는다 — 분해가 `files[]` 에서 빼고 `kiwi-sds` 에 `--convergence-registry` 를 넘기는 이유다. 그 경로는 **호스트가 병합 뒤에** 처리한다(PW-12).
- `--sds` 면: `kiwi-sds` 가 크기 상한 때문에 wave 의 SDS 를 `{run_id}-wave-{n}-{k}.sds.md` 로 나눠도 **wave 하나 = lane 하나 = 워커 하나** 다. 그 wave 항목의 `sds[]` 에 조각을 k 순서로 모두 적는다 — 도구가 `files[]` 와 조각 쓰기 집합의 합집합을 그 wave 의 쓰기 집합으로 쓰고 digest 는 조각마다 기록한다. 조각끼리는 의존을 적지 않는다. 그 wave 의 워커가 조각 순서대로 `kiwi-pm` 을 한 번씩 부르고(PW-6) — SDS 하나는 `kiwi-pm` 실행 하나다 — 모든 조각을 끝낸 뒤 돌아온다. 그래서 `kiwi-sds --close {run_id}-wave-{n}`(PW-15)은 모든 조각이 착지한 뒤 한 번 돈다.
- (`--sds`) **wave 의 SDS 파일**은 `kiwi-sds` 가 쓴 파일 전부다 — 그 호출이 돌려준 `artifacts.sds_files`(`--no-pipeline-emit` 이면 `docs/sds/` 에서 `{sds-id}.sds.md` 와 `{sds-id}-{k}.sds.md` 를 찾은 결과). 워커 카드의 `sds_paths` 는 이 파일들을 k 순서로 담고(나뉘지 않았으면 하나), 아래에서 워커가 `kiwi-pm` 에 주는 `<sds_path>` 는 그중 파일 하나이며, 테스트 충분성(PW-14)은 wave 의 SDS 파일마다 `--sds` 로 한 번씩 돈다. close-out 은 파일이 아니라 sds-id 로 부른다 — `kiwi-sds --close <sds-id>` 가 조각을 k 순서로 스스로 닫는다.
- **재진입**의 단위 id 는 `{run_id}-wave-{n}-r{m}` 이다(m = 그 wave 의 재진입 순번, 1 부터) — 워커 `kiwi-pm` 의 `--run-id` 와 저널 `sds_id` 가 이 값이다. 재진입은 갭의 `--req-filter` 범위로 갱신한 그 wave 항목 하나만 든 stage 로 PW-3 부터 다시 돈다 — 입력 커밋이 새 dispatch base 가 되고, 그 항목으로 stage lock 을 새로 쓰고 동결한 뒤에야 워커를 띄운다. 그래야 새 lane 이 동결 계획에 있다. 이미 `--sds` 로 opt-in 한 run 이면 재진입도 그 id 로 새 SDS 를 쓴다 — 같은 id 로 다시 부르면 `kiwi-sds` 가 agreed SDS 를 재사용할 뿐 새로 쓰지 않으므로 새 갭은 언제나 새 id 로 쓰고, 중단된 재진입을 이어갈 때만 같은 id 를 `--sds-id` 로 다시 준다. 그 wave 의 단위 id 는 전부 저널에 기록되고, close-out(PW-15 · PW-17)은 SDS 가 있는 id 마다 돈다.

---

## 4. 게이트 — 이 계약이 올리는 것

게이트 선언은 구조상 스킬 단위다. 두 스킬은 아래 행을 **모두** 자기 `critical_gates[]` 에 선언한다 — 선언하지 않은 중단은 `business-decision` 으로 떨어져 `--auto` 에서 위원회가 넘긴다.

| gate_id | 술어 | 자리 |
|---|---|---|
| `child-srs-needs-user-or-failed` | 호스트가 부른 `/kiwi-srs` 또는 `/kiwi-srs-feasibility` 가 `NEEDS_USER`/`FAILED` | PW-1 |
| `child-pipeline-needs-user-or-failed` | 호스트가 부른 `/kiwi-sds`(`--sds`) · 호스트 리뷰 hop · 개선 위임의 `/kiwi-review-fix-loop` 가 `NEEDS_USER`/`FAILED`, 또는 워커 자기 창 리뷰의 `review_outcome` 이 중단이거나 잔여 CRITICAL·HIGH | PW-2 · PW-8 · PW-12 · PW-13 |
| `unallocated-req-id` | wave 항목의 `requirements[]` 가 비었거나 그 wave 의 배정 집합과 다름(선언을 손으로 고친 경우 포함), 또는 `--sds` 면 wave SDS 들의 `@req` 합집합이 배정 집합과 다름(`kiwi-sds` 가 `draft` 등으로 범위에서 뺀 요구) | PW-1 뒤 · PW-2 뒤(`--sds`) |
| `requirement-not-ready` | `schedule waves` 가 `requirements[]` 의 요구(없음 · `draft` · `deprecated` · `discarded`)로 거절 — 그 wave 는 dispatch 전에 멈춘다 | PW-4 |
| `schedule-cycle` | `schedule waves` 가 의존 사이클로 거절 | PW-4 |
| `files-not-grounded` | `schedule waves` 가 `files[]`(`--sds` 면 SDS Files 도)의 경로를 기존 경로의 오타로 판정 | PW-4 |
| `lane-plan-drift` | 재개 때 lock 이 기록한 입력(선언 항목 digest, 있으면 SDS digest)으로 다시 계산한 계획이 lock 과 다름 | 재개 |
| `worker-touched-srs` | dispatch 전후 `git status --porcelain docs/spec docs/sds` 가 다름 | PW-8 |
| `lane-worker-possibly-live` | 워커 워크트리가 `locked` 로 보고되어 그 워커가 살아 있을 수 있음 — 다시 dispatch 하지 않는다(FR-FLOW-118). `--auto` 가 결정하지 않는다 — `NEEDS_USER` | PW-5 · §6 |
| `serial-unit-failed` | 같은 단위로 1회 재시도한 뒤에도 워커 판정 실패, 커밋도 `intentionally_empty` 사유도 없음, 또는 워커의 `/kiwi-pm` 이 `NEEDS_USER`/`FAILED` | PW-8 · PW-9 |
| `lane-design-refuted` | 워커 매니페스트가 `status: design-refuted` 를 싣고 돌아옴 | PW-8 |
| `srs-mutation-replay-failed` | `orchestrate replay apply` 가 재생을 거절하거나 실패를 기록 | PW-10 |
| `post-merge-index-drift` | `sync_index` 뒤에도 `validate --fail-on-warning` 이 드리프트를 보고 | PW-10 |
| `cross-lane-duplication-unresolved` | 중복 감사의 `duplicate` 판정이 그 wave 의 이슈로 해소되지 않음 | PW-12 |
| `test-sufficiency-gap` | 테스트 충분성 확인이 한 번 채운 뒤에도 공백을 남김 (`test-sufficiency.md`) | PW-14 · 종료 |
| `integration-test-user-consent` · `cost-warning-large-task` | 워커의 `kiwi-coder` 동의·비용 게이트 — `--auto-integration` · `--auto-cost-warning` 이 명시되지 않으면 `--auto` 라도 멈춘다 | 워커 |

분할 공개의 `partition-review-unrecorded` 는 `business-decision` 이다 — 잘못된 분할은 병합 뒤 판정과 직렬 재실행으로 복구되므로 `--auto` 에서 멈추지 않는다.

---

## 5. stage 한 번의 순서

**PW-1 · SRS 저작 — 호스트, 하나씩.** 준비 집합의 wave 마다 wave 순서로 `/kiwi-srs` 로 `wave-{n}` target 을 저작하고(`wave-srs-registration.md`), 조건부로 `/kiwi-srs-feasibility TARGET=wave-{n}` 을 부른다. **절대 병렬로 돌리지 않는다**(§1 의 네 경합). 저작 전후 요구 스냅샷의 차집합이 그 wave 의 **배정 집합**이고 `register-wave-srs` result 줄의 `allocation` 에 적는다. 그 wave 의 선언 항목 `requirements[]` 를 이 배정 집합으로 채우고, 비었거나 다르면 `unallocated-req-id` 로 멈춘다. 두 호출의 인자 형태는 호출자가 적는다.

**PW-2 · SDS 작성 — `--sds` 일 때만, 독립 서브에이전트, wave 마다 병렬.** `--sds` 가 없으면 이 단계를 건너뛴다 — wave 는 선언 항목의 `requirements[]` 로 구현된다. 서로 다른 파일을 쓰고 SRS 를 쓰지 않으므로 병렬이 안전하다. `--serial` 이면 하나씩.

```
Skill({ skill: "kiwi-sds", args: "TARGET=wave-{n} --req-filter <배정 집합> --sds-id {run_id}-wave-{n}
        --convergence-registry <수렴 레지스트리 경로> --existing-modules <설계 기준선 경로> --no-pipeline-emit [--auto] [--max] [--mini|--loops N] [--model <name>]" })
```

`--existing-modules` 는 그 wave 의 `design_baseline.path`(설계 기준선 JSON)이고, `kiwi-sds` 는 거기 기록된 `existing_modules` 를 보고 Interfaces 를 쓴다 — 검증 계층이 대조할 기존 구조를 저작 계층도 본다. `kiwi-sds` 는 `speckiwi sds check` 를 통과시킨 뒤 스스로 `agreed` 로 올린다. 호스트는 wave 의 SDS 파일마다 `sds check --json` 요약의 요구 ID 를 모아, 그 합집합이 비어 있지 않고 배정 집합과 같은지 확인한다. 밖의 요구가 있거나 배정 집합의 요구가 빠졌으면(`kiwi-sds` 가 `draft` 등으로 범위에서 뺀 요구 — 코드도 테스트도 받지 못한 채 승급 집합에 남는다) `unallocated-req-id` 로 멈춘다. SDS 파일은 선언 항목의 `sds[]` 에 k 순서로 적는다.

**PW-3 · 입력 커밋 — 호스트.** wave 마다 그 wave 의 SRS 변경·선언 파일(`--sds` 면 SDS 도)·호출자의 wave 입력을 명시 pathspec 으로 커밋한다(`commit-wave-inputs`, trailer `Orch-Run` · `Orch-Verb` · `Orch-Wave`). **그 커밋의 sha 가 그 wave 의 dispatch base** 이며 저널 `isolation.base_sha` 에 기록하고, 재개 카드를 쓰는 호출자(`kiwi-orchestrator`, `run-ledger.md §1`)는 `open[].base_sha` 에도 적는다. `git add -A` 와 `git commit -a` 는 쓰지 않는다.

**PW-4 · stage 계획 동결과 공개 — 호스트.** §3 의 명령으로 lock 을 쓰고, 그 lock 을 명시 pathspec 으로 커밋한 뒤(`commit-run-artifacts`) `orchestrate freeze lanes --body <그 lock> --document <그 lock> --head <그 커밋 sha> --run-id {run_id} --out {artifact_root}waves/stage-{s}/lanes.freeze.json` 으로 동결한다(`freeze-lane-plan`) — 동결은 커밋된 문서를 git blob 으로 고정하므로 커밋이 먼저다. lock 과 `{artifact_root}waves/stage-{s}/partition.md` 를 공개하고 `review-partition` 결과를 기록한다.

**PW-5 · dispatch — 워커, stage 의 wave 전부를 한 번에.** dispatch 직전에 호스트는 자기가 만든 `docs/spec` · `docs/sds` 변경을 전부 커밋해 두 경로를 깨끗하게 하고, run root 에서 `git status --porcelain docs/spec docs/sds` 가 비어 있음을 기록한다 — 비어 있지 않으면 dispatch 하지 않는다. 이미 바뀐 파일을 다시 고친 쓰기는 status 줄이 같아 비교에 보이지 않기 때문이다. 워커 입력은 대화가 아니라 파일 `{artifact_root}waves/stage-{s}/{laneId}.dispatch.json` 로 준다 — 서브에이전트 반환이 비는 일이 반복됐다. 카드는 `run_id` · `wave` · 단위 id `{run_id}-wave-{n}` · `stage` · `laneId` · `target` · 배정 집합(`requirements[]`) · (`--sds` 면) `sds_paths`(lock 의 그 lane `sds` 값 — 선언 항목 `sds[]` 순서) · `base_sha` · 브랜치 `kiwi/orch/{run_id}/{laneId}` · `write_set`(lock 의 그 lane `writeSet`) · `verification_cmd` · 회귀 기준선 pin · 큐와 매니페스트 경로 · 금지 목록 · 전파 플래그(`--auto` `--max` `--mini`/`--loops N` `--model` `--auto-integration` `--auto-cost-warning` `--drive`)를 싣는다. 런타임이 허락하면 `Agent` 를 워크트리 격리로 띄운다(`dispatch-lane`).

`git worktree list --porcelain` 이 그 lane 을 `locked … (pid N)` 로 보고하면 그 워커는 살아 있을 수 있다(FR-FLOW-118: 살아 있을 수 있는 워커는 다시 dispatch 하지 않는다) — 그 lane 을 다시 dispatch 하지 않고 `git worktree unlock` 도 하지 않으며, critical 게이트 `lane-worker-possibly-live` 로 멈춘다(`--auto` 가 결정하지 않는다 — `NEEDS_USER`). 보고에는 워크트리 경로, pid N, 생존 확인 힌트(Windows `tasklist /FI "PID eq N"`, POSIX `kill -0 N`)를 적고, pid N 이 어느 프로세스인지는 확정되지 않았으며 WSL 이나 다른 namespace 의 pid 는 죽은 것처럼 보일 수 있다고 덧붙인다. 다시 dispatch 하거나 잠금을 푸는 것은 사용자의 답이 있을 때만이다.

**PW-6 · 워커가 하는 일.** 순서대로다.

1. `git -C <워크트리> switch -C kiwi/orch/{run_id}/{laneId} <base_sha>` — 런타임이 만든 워크트리의 기본 HEAD 를 믿지 않는다(`worktree-lane.md §2`).
2. `npm ci --include=dev --ignore-scripts`.
3. `speckiwi orchestrate preflight --json --mcp-root <path> --git-root <워크트리> --role lane --lane-id {laneId} --lane-plan <run root>/{artifact_root}waves/stage-{s}/lanes.lock.json` — lock 은 dispatch base 뒤에 커밋되므로 워크트리에는 없다. 그래서 `--lane-plan` 은 호스트 run root 의 **절대 경로**다(dispatch 카드가 싣는다). exit 0 이 아니면 아무것도 하지 않고 매니페스트에 그 사유만 적어 돌아온다.
4. 구현 — 그 wave 의 요구 집합으로 `/kiwi-pm` 을 한 번 부른다:

   ```
   /kiwi-pm --req-filter <그 wave 의 requirements[]> --run-id {run_id}-wave-{n}[-r{m}] --session-suffix w{n}s{s}l{k} --no-final --no-pipeline-emit --commit-lane-work --defer-srs-mutation <큐 경로>
            [--resume] [--auto] [--max] [--model <name>] [--mini|--loops N] [--regression-baseline <P.4 pin>] [--auto-integration] [--auto-cost-warning] [--force] [--drive]
   ```

   `--sds` 면 `--req-filter` 대신 `--sds <sds_path>` 를 주고 `sds_paths` 의 파일마다 `sds_paths` 순서로(조각 번호 순서) 한 번씩 부른다 — 앞 조각의 `/kiwi-pm` 이 `TASK_DONE` 으로 끝나야 다음 조각으로 간다. `{k}` 는 그 stage 의 `laneIds` 에서 그 lane 의 1-기반 순번이다. 뒤의 네 pass-through 는 호출자가 사용자에게서 받은 것만 싣는다. `--commit-lane-work` 가 없으면 `kiwi-pm` 이 아무것도 커밋하지 않아 호스트가 병합할 것이 없다. 커밋은 `Orch-Run` · `Orch-Wave` · `Orch-Stage` · `Orch-Lane` trailer 를 싣고 제목에 단계 표식을 넣지 않는다.
5. 자기 창 리뷰 — `--close-reqs` 없이:

   ```
   Skill({ skill: "kiwi-review-fix-loop", args: "--base <base_sha> --head HEAD --req-filter <배정 집합>
           [--sds <sds_path>] --no-pipeline-emit [--auto] [--max] [--mini|--loops N]" })
   ```

   고친 것은 쓰기 집합 pathspec 으로 커밋한다. 리뷰는 조각 수와 관계없이 워커의 창 전체에 한 번 돈다 — `--sds` 는 `--sds` run 에서 SDS 파일이 하나일 때만 넘긴다.
6. 테스트 충분성 확인은 따로 한 번 더 돌지 않는다 — 위 리뷰가 `--req-filter`(`--sds` 면 `--sds` 도)로 범위를 받았으므로 그 리뷰의 마지막 단계가 wave 범위의 이 확인이다(`test-sufficiency.md`). `--sds` run 에서 조각으로 나뉘었으면 리뷰 뒤에 조각마다 그 조각의 `Requirements` ID 와 `--sds <그 조각>` 으로 `test-sufficiency.md` 를 한 번씩 돈다. 확인은 **워커의 워크트리**를 읽는다 — `test-sufficiency.md` §3 1번의 워크트리 규칙이다. 결과는 매니페스트의 `test_sufficiency` 에 싣는다.
7. 매니페스트를 쓰고 돌아온다: `{branch, head_sha, commits[], deferred_queue, reports[], red_evidence[], review_outcome, intentionally_empty, design_refuted[], out_of_lease_paths[], test_sufficiency}`. `review_outcome` 은 5 단계 리뷰의 반환(`TASK_DONE` · `NEEDS_USER` · `FAILED`)과 잔여 CRITICAL/HIGH 수다. `/kiwi-pm` 이 커밋을 하나도 만들지 않은 wave 에서 워커는 `intentionally_empty` 선언 — `{sds_id, reason}`, reason 은 20자 이상 — 을 그 `/kiwi-pm` 실행의 `docs/analysis/kiwi-pm-…` 번들에 `intentionally-empty.json` 으로 쓰고 매니페스트에 같은 값을 싣는다. 호스트가 판정에 쓰는 것은 수확한 번들의 사본이다. `red_evidence[]` 는 red 단계의 **기대 실패 서명**이다 — 구현 전에 실패한 테스트마다 `{test_id, failure}`(테스트 식별자와 실패 메시지 요약). run 당 커밋이 하나라 커밋 순서로는 테스트가 먼저였음을 보일 수 없으므로(FR-FLOW-115 AC-2), red 증거는 이 필드에만 남는다.

워커가 하지 않는 것: SRS mutation 도구 호출, `docs/spec/` · `docs/sds/` · `kiwi/pipeline.jsonl` · `kiwi/waves.jsonl` 쓰기, `--root`, 병합과 push, `/kiwi-sds` 호출, 기존 테스트 약화.

**PW-7 · join — 호스트.** stage 의 워커가 모두 돌아오기를 기다리고 결과는 반환값이 아니라 매니페스트 파일에서 읽는다. `{artifact_root}waves/stage-{s}/{laneId}/` 로 수확한다(`collect-lane`) — 큐와 매니페스트, 그리고 워크트리에만 있고 커밋되지 않는 증거: 워커 `kiwi-pm` 세션의 `.kiwi/sessions/…` (worklog · `pm-state.json`), `docs/analysis/kiwi-pm-…` 번들, 워커 리뷰의 분석 디렉터리. 이후 단계(PW-8 의 `intentionally_empty` 판정, PW-13 의 증거 번들, PW-16 의 증거 detail)는 수확한 사본을 읽는다 — 워크트리는 PW-11 에서 반납된다.

**PW-8 · 판정 — 호스트, 워커마다.** 워커의 green 은 판정이 아니다(`worktree-lane.md §5`). 호스트가 확인한다(`verify-lane`):

```
base..head 커밋이 0 이 아니다                      (또는 허용 가능한 intentionally_empty)
매니페스트의 red_evidence[] 가 비어 있지 않다      (intentionally_empty 면 면제)
review_outcome 이 TASK_DONE 이고 잔여 CRITICAL·HIGH 가 0 이다
base 가 head 의 조상이다
변경 경로 ⊆ lane 쓰기 집합(lock 의 `writeSet`)        (밖의 편집은 아래 규칙으로 판정)
변경 경로 ∩ (docs/spec/ ∪ docs/sds/) = ∅
호스트가 워크트리에서 verification_cmd 를 직접 1회 실행해 통과한다(§0)
run root 의 git status --porcelain docs/spec docs/sds 가 dispatch 전과 같다
```

마지막 줄이 다르면 `worker-touched-srs` 로 멈춘다 — `workspaceRoot` 를 빠뜨린 MCP 쓰기는 호스트에 조용히 떨어지므로 이 비교가 그 경로를 막는 유일한 기계 장치다. 매니페스트가 `design-refuted` 면 `lane-design-refuted` 다. `review_outcome` 이 `NEEDS_USER` · `FAILED` 이거나 잔여 CRITICAL·HIGH 가 남았으면 `child-pipeline-needs-user-or-failed` 로 멈춘다 — 자식의 중단은 부모를 멈춘다(각 스킬 §0.4). 판정 실패는 같은 단위와 같은 base 로 새 워커를 **한 번** 다시 띄운다(`remediate-lane`, 브랜치 `…/{laneId}-r2`). 다시 실패하면 `serial-unit-failed` 다. 쓰기 집합 밖 편집은 같은 stage 의 다른 워커가 그 경로를 건드리지 않았으면 기록하고 받아들이고, 건드렸으면 그 wave 를 PW-9 뒤 새 base 위에서 혼자 다시 돌린다.

**PW-9 · 병합 — 호스트, wave 순서로.** 판정을 통과한 브랜치를 통합 브랜치에 `--no-ff` 로 병합한다(`integrate-lane`). 병합 충돌이나 병합 뒤 전체 회귀의 신규 실패는 그 wave 만 새 base 위에서 한 번 다시 돌린다. 다시 실패하면 `serial-unit-failed` 다. 텍스트 충돌은 git 이 잡고, 따로는 green 인데 합치면 red 인 의미 충돌은 병합 뒤 회귀가 잡는다.

**PW-10 · 재생 — 호스트 root 에서.** `orchestrate replay plan` 으로 수확한 큐를 계획하고 `orchestrate replay apply --plan <path> --applied kiwi/orchestrator/{run_id}/replay-applied.jsonl --frozen-target wave-{n}` 으로 적용한다(`replay-deferred-mutations`). 거절이나 실패 기록은 `srs-mutation-replay-failed` 다.

**PW-11 · 반납 — 호스트, 수확 뒤에만.** `git worktree remove` 로 워커 워크트리를 반납한다(`release-lane`). 수확 전에 반납하면 그 안의 ignored 산출물이 사라진다. 반납이 실패하면: `Permission denied` 면 lane 안을 작업 디렉터리로 둔 프로세스(셸, vitest, 편집기)를 끝낸 뒤 다시 시도한다. `is not a working tree` 면 Windows 에서 반쯤 지워진 상태다 — 남은 디렉터리를 지우고 `git worktree prune` 을 돈다. 그래도 계속 실패하면 run 리포트에 적고 run 은 멈추지 않는다. 워크트리가 `locked` 면 `lane-worker-possibly-live` 절차가 먼저이고, `git worktree remove -f -f` 는 사용자의 결정 없이 쓰지 않는다.

**PW-12 · stage 마감 — 호스트.** (1) 수렴 레지스트리의 `regenerate` · `orchestrator-only` 경로를 호스트가 레시피대로 처리한다. (2) 중복 감사 — 같은 stage 에서 병합된 wave 들끼리, 그리고 병합 전 base 와 비교한다. `duplicate` 판정은 그 wave 의 이슈로 열어 해소하고, 해소되지 않으면 `cross-lane-duplication-unresolved` 다. (3) stage 의 모든 병합과 재생이 끝난 뒤 `validate` → `sync-index` → `validate --fail-on-warning` 을 한 번 돌리고, 남은 드리프트는 `post-merge-index-drift` 다. (4) **호스트 코드 리뷰는 병합 뒤 호스트가 만든 커밋만** 본다 — 워커의 창은 그 워커가 이미 리뷰했다:

```
Skill({ skill: "kiwi-review-fix-loop", args: "--base <마지막 병합 커밋> --head <호스트 tip> --no-pipeline-emit
        [--auto] [--max] [--mini|--loops N]" })
```

`--commit-lane-work` 도 `--close-reqs` 도 주지 않는다. 호스트가 만든 커밋이 없으면 창이 비고 `not-applicable-empty-window` 다.

부르기 전에 `git diff --name-only <마지막 병합 커밋>..<호스트 tip>` 을 `kiwi-review-fix-loop` §11 의 파일 부류 표로 거른다. 코드 파일이 하나도 남지 않으면 — 수렴 레시피·재생·인덱스 동기화가 만든 `docs/spec/` · 인덱스 · README · 스킬 미러 커밋뿐이면 — hop 을 부르지 않고 `no-host-code-commits`(호스트 코드 커밋 없음)를 그 stage 마감을 기록하는 저널 줄의 `notes` 와 최종 보고에 적는다. 그 스킬은 코드 전용이라 불러도 `empty-code-scope` 로 멈출 뿐이다. 워커의 창은 그 워커가 리뷰했고, run 창 종료 리뷰가 run 전체를 본다. 코드 파일이 하나라도 있으면 위 호출을 그대로 돈다.

**PW-13 · 설계 적합 검증 — wave 마다.** 호출자의 검증 단계(§0 표)가 병합된 결과를 SRS · (있으면) SDS · 기록된 결정에 대조한다. 증거 번들에는 선언 항목 · (있으면) SDS · 워커 매니페스트 · 워커 리뷰 보고서 · 워커의 테스트 충분성 결과가 들어간다 — SDS 는 PW-17 이 지우기 전에 읽는다. **결과가 SRS · SDS · 결정과 다르면 원래 워커가 아닌 독립 서브에이전트가 고치고, 호스트는 다시 검증한다.** 경로는 `verify-loop.md §7` 이다 — 코드 결함은 명시 범위의 `kiwi-review-fix-loop`, 요구(와 있으면 SDS)가 덮지 않은 의도 갭은 그 wave 의 재진입(§3 의 재진입 단위 id 와 `--req-filter` 범위로 새 워커를 띄운다 — 이미 `--sds` 로 opt-in 한 run 이면 그 id 로 새 SDS 를 `kiwi-sds` 로 쓰고 `--sds-id` 도 준다). 입력은 사실만 준다 — 원본 요구, diff, (있으면) SDS.

**PW-14 · 테스트 충분성 — 호스트, 승급 바로 앞.** `test-sufficiency.md` 를 wave 범위(배정 집합)로 돈다 — SDS 파일이 있는 wave 면 그 wave 의 SDS 파일마다 `--sds <그 파일>` 을 주어 돈다. 남은 공백은 `test-sufficiency-gap` 이다.

**PW-15 · SDS close-out, 옮김 — 호스트, SDS 파일이 있는 wave 만(`--sds`).** `Skill({ skill: "kiwi-sds", args: "--close {run_id}-wave-{n} --no-pipeline-emit [--auto]" })` — 그 wave 의 sds-id 마다(재진입 id 포함). SDS-AC 의 해석 결정을 SRS AC 의 명확화로 옮기고 durable 로 표시된 규칙만 제약 요구로 올린다.

**PW-16 · 승급 — 호스트, wave 하나씩.** 설계 적합 검증이 `pass` 인 wave 만 승급한다. 집합은 그 wave 의 워커가 **착지했을 때** 배정 집합이고 착지하지 않았으면 공집합이다. 착지는 그 wave 의 `Orch-Wave` · `Orch-Lane` trailer 가 붙은 워커 커밋이 통합 브랜치에 있고 `verification_cmd` 가 통과한 것, 또는 허용 가능한 `intentionally_empty` 선언이다. 전이는 두 단계다 — 착지하면 `planned`/`in_progress` → `implemented`, 검증이 `pass` 이고 그 요구를 지명한 잔여가 없으면 `implemented` → `verified`. 증거는 `type="test"` 와 `type="commit"` 이다. `type="test"` 는 `test-sufficiency.md` §4 대로 AC 마다 한 행 — 참조는 `verification_cmd`, `covers` 는 그 AC, notes 는 PW-14 가 그 AC 에 돌려준 인용과 수확한 워커 `docs/analysis/kiwi-pm-…` 번들 경로다. `type="commit"` 은 그 wave 의 trailer 커밋 sha 각각이고, `intentionally_empty` 로 착지한 wave 는 test 증거만 싣는다. 착지하지 않은 wave 의 요구는 현재 status 에 둔다. `add_completed_work` 도 호스트만 한다. `kiwi-orchestrator` 는 같은 규칙을 자기 §14 에 적는다.

**PW-17 · SDS close-out, 삭제 — 호스트, SDS 파일이 있는 wave 만(`--sds`).** 같은 `kiwi-sds --close` 를 한 번 더 부른다. `@req` 요구가 모두 `verified` 또는 `discarded` 이면 SDS 파일이 지워지고, 그 삭제를 close-out 커밋이 싣는다. git 기록이 파일을 남긴다. 닫힌 SDS 를 현재 설계로 읽지 않는다 — 현재 설계는 코드다.

그 뒤 호출자가 그 wave 의 `complete` 를 기록한다. 다음 stage 는 준비 집합을 다시 계산해 PW-1 부터 돈다.

---

## 6. 재개

- 재개 카드를 쓰는 호출자(`kiwi-orchestrator`)는 현재 stage 의 진행 중 wave 들을 `open[]` 에 lane 마다 한 항목으로 담는다. 카드가 없는 호출자(`kiwi-wave-master`)는 같은 사실을 `speckiwi orchestrate wave status --waves {artifact_root}waves/waves.json --run-id {run_id} --json` 으로 읽는다 — wave 마다 최신 `status` · `phase` · `sds_id` · `stage` · `lane` 과 `ready[]` 를 도구가 낸다. 저널 줄을 손으로 읽지 않는다.
- `git worktree list --porcelain` 이 그 lane 을 `locked … (pid N)` 로 보고하면 그 워커는 살아 있을 수 있다(FR-FLOW-118: 살아 있을 수 있는 워커는 다시 dispatch 하지 않는다) — 그 lane 을 다시 dispatch 하지 않고 `git worktree unlock` 도 하지 않으며, critical 게이트 `lane-worker-possibly-live` 로 멈춘다(`--auto` 가 결정하지 않는다 — `NEEDS_USER`). 보고에는 워크트리 경로, pid N, 생존 확인 힌트(Windows `tasklist /FI "PID eq N"`, POSIX `kill -0 N`)를 적고, pid N 이 어느 프로세스인지는 확정되지 않았으며 WSL 이나 다른 namespace 의 pid 는 죽은 것처럼 보일 수 있다고 덧붙인다. 다시 dispatch 하거나 잠금을 푸는 것은 사용자의 답이 있을 때만이다.
- **남은 git `index.lock`**: `.git/index.lock` 이 남아 git 명령이 거절되면, git 프로세스가 돌고 있지 않음을 확인한 뒤에만 그 파일을 지운다 — Windows `tasklist /FI "IMAGENAME eq git.exe"`, POSIX `pgrep -x git`. 돌고 있으면 기다렸다가 다시 시도한다. WSL 안의 git 은 Windows `tasklist` 에 보이지 않으므로, WSL 을 쓰고 있을 수 있으면 사용자에게 묻는다.
- 매니페스트가 있으면 PW-7 부터 이어간다. 워커 브랜치나 통합 브랜치에 그 lane 의 trailer 커밋이 이미 있으면 `/kiwi-pm` 을 다시 돌리지 않고, `pm-state.json` 이 있으면 `--resume` 을 준다. 조각으로 나뉜 wave 는 이 판단을 조각마다 한다 — 세션이 `done` 인 조각은 건너뛰고 첫 미완 조각부터 이어간다.
- lock 의 선언 항목 digest 와 (있으면) SDS digest 를 다시 잰다 — `orchestrate resume` 이 사실을 스스로 모아 비교한다(`run-ledger.md §4`). 조각 wave 의 `sds_digests` 는 파일마다 digest 를 담으므로 파일마다 비교한다. close-out 이 이미 손댄 wave — SDS Status 가 `closed` 이거나 파일이 지워진 wave(PW-15 · PW-17) — 는 비교하지 않고 close-out wave 목록으로 넘긴다. 그 밖의 wave 의 digest 가 달라졌으면 `lane-plan-drift` 다.
