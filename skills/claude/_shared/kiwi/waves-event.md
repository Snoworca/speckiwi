# kiwi waves event v1.4.0

본 파일은 `kiwi-wave-master`(FR-FLOW-029) 와 `kiwi-orchestrator` 가 멀티-웨이브 진행을 추적하기 위해 append 하는 **wave 진행 이벤트**(`./kiwi/waves.jsonl`) 의 SSOT. `_shared/kiwi/pipeline-event.md` 를 모델로 하며, 변경은 SemVer 를 따른다 (minor: 필드 추가, 그리고 **이미 기록된 이벤트의 해석을 바꾸지 않는** 버전-스코프 규칙 추가 / major: breaking).

**v1.4.0 확장은 순수 additive 다** — 추가된 20개 필드는 전부 **선택 필드**이며, v1.4.0 은 **이미 기록된 이벤트의 해석을** 어떤 방식으로도 **바꾸지 않는다**. 저널은 두 생산자가 공유하지만 파일은 하나이며, 생산자 구분은 §2.2 의 `engine` 필드와 §4 의 재개 술어가 담당한다.

**버전 다운그레이드 가드 (v1.4.0)**: `1.4.0` 줄을 하나라도 포함한 run 안에서, 그 뒤에 오는 줄이 더 **낮은** `schema_version` 을 실으면 `journal-version-downgrade` 진단이다. §3 의 run 스코프 downgrade-bypass 폐쇄와 같은 논리다 — 버전은 policing 대상인 생산자가 스스로 쓰는 값이므로, 낮춰 쓰는 것이 곧 우회가 된다.

`./kiwi/pipeline.jsonl`(스킬-간 파이프라인 이벤트) 와는 **별개 파일**이다 — `waves.jsonl` 은 한 실행 안의 wave 별 상태만 담는다.

본 계약 안의 `§n` 은 이 파일의 절을 가리킨다. 다른 문서의 절을 참조할 때는 **문서명을 함께 적는다**(`pipeline-event.md §1`, `kiwi-wave-master §5.5.6`) — 문서명 없는 참조가 이 파일 밖을 가리키면 읽는 쪽이 해소할 수 없다.

---

## 1. 파일 위치

해석 순서 (pipeline-event.md §1 과 동일):

1. `git rev-parse --show-toplevel` exit 0 → `{git_root}/kiwi/waves.jsonl`
2. 위 실패 + cwd 에 `kiwi/` 디렉토리 존재 → `{cwd}/kiwi/waves.jsonl`
3. 둘 다 부재 → `~/.kiwi/waves.jsonl` (홈 fallback)

디렉토리 부재 시 `mkdir -p`.

**Run-root pin**: 위 순서는 run 시작 시 한 번만 평가해 root 를 pin 하고, 그 run 의 이후 emit 마다 재해석하지 않는다 — 실행 도중 cwd 나 git root 가 바뀌어도 한 run 의 저널이 두 저장소로 갈라지지 않게 한다.

---

## 2. 이벤트 JSON schema

각 줄은 정확히 1개의 JSON object (JSONL, 줄 끝 LF 단일).

### 2.1 필수 필드

| 필드 | 타입 | 값 |
|---|---|---|
| `ts` | string (ISO-8601 UTC) | `2026-07-10T13:45:12.345Z` |
| `schema_version` | string (SemVer) | `1.4.0` |
| `run_id` | string | 그 실행(run)의 run_id |
| `wave` | string | `wave-{n}` (예: `wave-1`) |
| `order` | number | wave 실행 순서 (1-based) |
| `target` | string | 그 wave 의 전용 SRS target (`wave-{n}`) |
| `status` | string (enum) | `pending` / `in_progress` / `complete` / `failed` |
| `summary` | string | 1-3 문장 사람-읽기용 요약 |

### 2.2 선택 필드

| 필드 | 타입 | 용도 |
|---|---|---|
| `scope` | string | wave 에 지정한 작업 범위 (해당 wave 로 한정) |
| `pipeline_run_id` | string | 그 wave 의 `/kiwi-pipeline` 사이클 run_id |
| `req_ids` | string[] | 그 wave 에서 다룬 REQ-ID 목록 |
| `notes` | string | 자유 텍스트 부연 |
| `phase` | string (enum) | `pipeline` / `srs-authoring` / `wave-verify` / `final-verify` / `intake` / `design` / `wave-design` / `schedule` / `handoff` / `lane` / `integrate` / `stage-close` — `in_progress` 이벤트가 어느 단계에 있는지. 뒤의 8개는 v1.4.0 신설 (오케스트레이터 단계) |
| `verification` | object | 웨이브 종료 상호검증 결과. 아래 §2.3 |
| `design_baseline` | object | 그 wave 의 설계 기준선 포인터. 아래 §2.4 |
| `constraints_path` | string | 선언된 사용자 제약 아티팩트 경로 |
| `srs_authored` | bool | 그 wave 의 SRS 저작 완료 표식. `phase="srs-authoring"` 이벤트에만 싣는다 |
| `diff_window` | object | `{ base_sha, head_sha }` — 그 wave 의 diff 창을 여는 git ref 쌍 (v1.3.0 신설) |
| `pipeline_run_ids` | string[] | 그 wave 에서 실행한 **모든** `/kiwi-pipeline` run_id 를 순서대로. `pipeline_run_id` 는 그중 최신 값을 그대로 유지한다(하위호환) (v1.3.0 신설) |
| `plan_run_id` | string | 그 wave 의 **계획 run-id** (`docs/plans/{plan_run_id}.plan.md` · `.kiwi/sessions/{plan_run_id}/`). `pipeline_run_id` 와 **다른 값**이며, 재개가 `--plan-run-id` 로 되돌려 줄 값이다 (v1.3.0 신설) |
| `run_diff_window` | object | `{ base_sha, head_sha }` — run 전체의 diff 창. `phase="final-verify"` 이벤트에만 싣는다 (v1.3.0 신설) |
| `engine` | string (enum) | `kiwi-wave-master` / `kiwi-orchestrator` — 이 줄을 쓴 **생산자**. **부재 ⇒ `kiwi-wave-master`** 로 읽는다. §4 의 재개 술어가 이 값으로 필터한다 (v1.4.0 신설) |
| `writer` | string | `speckiwi-orchestrate/{pkgVersion}` — 도구가 **매 write 마다** 찍는 스탬프. `schema_version` **1.4.0 이상** 줄에만 요구하며, 그보다 낮은 줄은 `unstamped` 로 보고하고 **실패하지 않는다** (v1.4.0 신설) |
| `event` | string (enum) | `intent` / `result` — write-ahead intent 와 write-behind fact 의 짝. 어떤 `(verb, wave, lane)` 키의 마지막 줄이 `intent` 면 그 verb 는 중단된 것이다 (v1.4.0 신설) |
| `verb` | string (enum) | 이 줄이 다루는 프로그램 카운터 값. 닫힌 verb enum 은 오케스트레이터 스킬 본문이 SSOT 다 (v1.4.0 신설) |
| `inputs_digest` | string | intent 시점의 그 verb 선언 입력들에 대한 sha256 (v1.4.0 신설) |
| `lane` | string | `lane-{k}` — 이 줄이 특정 lane 을 다룰 때 (v1.4.0 신설) |
| `stage` | number | 이 줄이 다루는 wave 내부 layer. wave 스코프 줄에는 싣지 않는다 (v1.4.0 신설) |
| `lane_plan` | object | `{ lock_path, digest, lane_count, stage_count }` — `freeze-lane-plan` **result** 줄 (v1.4.0 신설) |
| `partition_review` | object | `{ doc_path, digest, lane_plan_digest, reviewer, verdict }` — `review-partition` **result** 줄. `lane_plan_digest` 는 `freeze-lane-plan` 이 기록한 값이며 이것이 판정을 정확히 그 고정된 계획에 묶는다. `verdict` ∈ `pass` / `revise` / `abort`, `reviewer` 는 `"user"` (v1.4.0 신설) |
| `isolation` | object | `{ profile, reason, rejected[], workspace_ref, base_sha, head_sha, merge_sha, probe_evidence }` — `reason` 과 `rejected[]` 가 격리 프로파일 **선택 기록**을 싣는다 (v1.4.0 신설) |
| `lane_layer` | object | 검증자-1 의 다섯째 분모 — lane 계층의 `{ expected, checked, rows }` (v1.4.0 신설) |
| `wave_issues` | object | `{ doc_path, digest, open, planned, resolved, deferred }` — wave 종료 시 정리한 이슈 문서 포인터. 산출물이 **wave 스코프**(`waves/wave-{n}/issues.md`) 이므로 이름도 wave 스코프다 (v1.4.0 신설) |
| `convergence` | object | `{ registry_digest, recipes_applied[], validate_exit, sync_index_changed }` (v1.4.0 신설) |
| `allocation` | object | `{ target, pre_snapshot_digest, requirement_ids[], design_item_map }` — `register-wave-srs` **result** 줄. `unallocated-req-id` 검사가 비교하는 3.b 할당 집합이며, `design_item_map` 은 `{req_id: string[]}` 로 lane 별 설계 항목의 생산자다 (v1.4.0 신설) |
| `decision` | object | `{ question, options, decision, rule, committee_size, confidence, origin }` — 위원회가 결정한 intake 행마다 1건, lane 결정 재생마다 1건. 심의 없이 내려진 결정이야말로 증거를 남기지 않는 결정이다 (v1.4.0 신설) |
| `deadline_at` | string (ISO-8601 UTC) | `dispatch-lane` **intent** 줄의 lane 마감 시각 (v1.4.0 신설) |
| `postmortem` | object | `{ doc_path, digest }` — 그 wave 의 포스트모템 기록 (v1.4.0 신설) |
| `coverage_residual` | array | `{req_id, reason, owner}` 행 — **`R-PLAN`** rung 의 `dispatch-route` **result** 줄에만 싣는다. `plan-coverage-unclosed` 게이트가 읽는 잔여 사유의 거처이며, digest 로 고정된 route lock 밖에 둔다 (v1.4.0 신설) |
| `lane_disposition` | object | `{ kind, reason, at }` — lane 이 병합 없이 run 을 떠날 때의 **종국 처분**. `kind` 는 `demoted` / `quarantined` / `coupling-reset` / `refuted` 의 **닫힌 4값 enum** 이다. 이 필드가 없으면 강등·반증된 lane 이 재개 시 병합 가능으로 읽혀 run 이 버린 작업을 다시 병합한다 (v1.4.0 신설) |
| `card_digest` | string | 이 줄 직후에 쓴 재개 카드의 sha256 (v1.4.0 신설) |
| `proof` | object \| object[] | `{ kind, ref? }` — 그 줄이 싣는 주장을 뒷받침하는 **증명**. §4.3 write discipline 의 `result` 줄에 싣는다. `kind` 는 아래에 선언한 `proof_kind` 값 중 하나이고, `ref` 는 그 종류가 재계산에 쓰는 인자(브랜치·sha·경로·digest)다. 증명이 여럿이면 배열로 싣는다 (v1.4.0 신설) |
| `strict_grounding` | bool | `--strict-grounding` 이 적용된 채로 그 verb 를 실행했다는 기록. `freeze-lane-plan` **intent** 줄에 싣는다 — 판정을 조인 옵션은 판정 자체의 일부이므로, 저널 밖에만 있으면 재개하는 쪽이 그 run 이 어느 기준으로 경로를 거절했는지 알 수 없다 (v1.4.0 신설) |

`pipeline_run_id` 는 `complete` 와 `phase=wave-verify` 이벤트에서는 사실상 필수다 — 그 wave 의 `pipeline.jsonl` 창을 여는 유일한 키이기 때문이다. wave 시작 시의 첫 `in_progress` 에서는 pipeline 사이클이 아직 없으므로 생략한다.

`diff_window` 와 `pipeline_run_ids` 도 `phase=wave-verify` 와 `complete` 이벤트에서는 **사실상 필수**다 — 보존 계층의 분모가 이 두 값에서만 도출되므로, 없으면 그 라운드의 판정을 재개 후 재구성할 수 없다.

증거 창은 `pipeline_run_ids` 의 **모든** run 을 합집합으로 연다 — `pipeline_run_id` 하나만 보면 재진입이 만든 새 run 의 산출물이 창 밖으로 떨어져, 수정 전 증거로 재검증하거나 낡은 clean 증거로 통과한다.

`srs_authored` 가 `true` 인 `phase="srs-authoring"` 기록이 그 wave 의 저작 완료 표식이며, 저작 **진행 중인 것과 구분된다** — `phase` 만으로는 저작 시작 시점의 줄과 구분되지 않는다.

`proof_kind` ∈ `git-ancestor` / `git-ref` / `git-trailer` / `digest` / `mcp-state` / `fs-exists` / `journal` — **신뢰 순서**다(앞쪽이 강하다). 저널 없이 재계산 가능한 종류의 비중을 최대화한다 — 저널은 잘려 나가기 가장 쉬운 산출물이기 때문이다.

판정(verdict)을 싣는 줄에서 `journal` 은 **단독 증명이 될 수 없다**. 루프의 통과, lane 의 병합, wave 의 완료처럼 판정을 기록하는 줄은 외부에서 재계산 가능한 종류를 최소 1개 함께 실어야 한다: `git-ancestor`, `git-ref`, `git-trailer`, `digest`, `mcp-state` 다섯 중 하나다. `fs-exists` 는 그 다섯에 들지 않는다 — 파일이 존재한다는 사실은 어떤 판정도 증언하지 않는다. §2.2 의 `writer` 스탬프는 줄이 **어느 경로로** 쓰였는지를 인증할 뿐 **무엇을 실었는지**를 인증하지 않으므로, `journal` 단독 판정은 증인이 아예 없는 주장이 된다.


### 2.3 `verification` object (선택, v1.1.0 신설)

| 키 | 타입 | 값 |
|---|---|---|
| `rounds` | number | 실제 수행한 라운드 수 |
| `cap` | number | 그 run 에 적용된 라운드 상한 (기본 5 / `--max` 8 / `--mini` 3 / `--loops N`) |
| `verdict` | string (enum) | `in-progress` / `pass` / `fail-residual` / `fail-cap` — `in-progress` 는 루프가 아직 도는 **비종료** 라운드, `fail-cap` 은 상한 소진, `fail-residual` 은 상한 전에 미해소 finding 을 남기고 끝낸 경우 |
| `axis_a` | object | `{ roll_up: "ALL_MATCH" \| "GAPS", expected: n, checked: n }` |
| `axis_b` | object | `{ substantive_clean: bool, open: { critical, high, medium, low } }` |
| `design_layer` | object | `{ expected: n, mapped: n, unmapped: [...] }` — 설계 기준선 범위의 설계 항목 분모 (v1.2.0 신설) |
| `constraint_layer` | object | `{ expected: n, checked: n, violations: [...] }` — 선언된 사용자 제약 분모 (v1.3.0 신설) |
| `preservation_layer` | object | `{ expected: n, checked: n, rows: [{ item, verdict, evidence }] }` — 행마다의 판정은 `intended-improvement` / `unapproved-damage` 두 값이며, `evidence` 는 그 판정의 근거 REQ-ID 또는 Task-ID (v1.2.0 신설, `evidence` 는 v1.3.0 신설) |
| `regression` | object | `{ command, exit_code, failing_tests: [...], baseline_failing_tests: [...] }` — 그 wave 의 head 에서 실행한 전체 회귀 스위트와 run 시작 시 pin 한 기준선 (v1.2.0 신설, `baseline_failing_tests` 는 v1.3.0 신설) |
| `frozen_denominator` | object | `{ round: n, req_ac: n, design_items: n, preservation: n, constraints: n }` — 그 라운드 진입 시 freeze 한 분모 개수 (v1.3.0 신설) |
| `residual` | array | 종료 시점의 미해소 finding **전량**. 각 항목 `{ id, severity, summary, reason_class, cross_wave, carried_into }` |
| `report_path` | string | 상호검증 보고서 경로 |

- `design_layer.expected` 는 그 wave 의 `design_items` 길이로 외부에서 고정하며, 검증자가 스스로 산정하지 않는다.
- `constraint_layer.expected` 는 최신 `constraints_path` 아티팩트의 항목 수로 외부에서 고정하며, 검증자가 스스로 산정하지 않는다.
- `wave="all"` 이벤트의 `design_layer.expected` 는 모든 wave `design_items` 의 **합집합** 크기에 `integration_items` 길이를 더한 값이다 — 어느 한 wave 의 분모도 아니다.
- `constraint_layer.violations` 에 **1건이라도** 항목이 있으면 `axis_a.roll_up` 을 `ALL_MATCH` 로 기록할 수 없다 — 제약 위반은 요구 실현 여부와 별개의 실패다.
- 제약이 선언되지 않은 run 도 **빈 배열** 아티팩트를 쓰고 `constraints_path` 를 기록한다 — 빈 배열은 반증 가능한 주장이고 필드 부재는 침묵이다.
- `residual` 은 **전량**이어야 하며 잘라내지 않는다 — 상위 N 건만 남기면 "전부 커버했다"로 읽힌다. 미해소 건이 정말로 없으면 빈 배열을 명시한다(빈 배열은 반증 가능한 주장이고, 필드 부재는 침묵이다).
- `reason_class` ∈ `draft-stability-skip` / `task-failure-skip` / `scope-boundary-deferred` / `srs-level-unclosable` / `design-gap` / `cross-wave-carry-forward` / `oscillation` / `budget-exhausted` — 하위 스킬이 skip 하거나 보류한 REQ 가 왜 남았는지를 자유 텍스트가 아니라 분류로 남긴다. 뒤의 두 값은 v1.4.0 신설이며, 각각 라운드가 진동해 수렴하지 못한 경우와 `--subagent-budget` / `--run-budget` 상한이 소진된 경우를 가리킨다.
- `cross_wave` 가 `true` 인 항목은 이전 wave 가 만든 산출물을 건드리는 finding 이며, `carried_into` 에 그것을 이월한 wave id 를 적는다.
- **미매핑 설계 항목**이 `design_layer.unmapped` 에 **1건이라도** 있으면 `axis_a.roll_up` 을 `ALL_MATCH` 로 기록할 수 없다 — REQ·AC 계층이 완결하더라도 마찬가지다.
- `preservation_layer.rows` 에 `verdict` 가 `unapproved-damage` 인 행이 **1건이라도** 있으면 `verdict` 를 `pass` 로 기록하지 않는다 — 파손을 정직하게 기록한 것이 통과를 막지 못하면 그 계층은 기록 전용이다.
- `unmapped` 은 **전량**이어야 하며 잘라내지 않는다 — 상위 N 건만 남기면 설계 계층이 커버된 것으로 읽힌다.
- `regression.failing_tests` 가 `baseline_failing_tests` 의 부분집합이 아니면(`failing_tests ⊆ baseline_failing_tests` 위반, 즉 **신규 실패 0 건**이 아니면) `verdict` 를 `pass` 로 기록하지 않는다.
- 기준선 **캡처에 실패**해 `baseline_failing_tests` 가 부재한 라운드에서는 `regression.exit_code` 가 0 이 아니면 `verdict` 를 `pass` 로 기록하지 않는다 — 기준선이 없으면 신규 실패를 분리할 수 없고, 그때의 통과 조건은 `exit_code` 0 하나뿐이다.
- 열거한 **행 수**가 `frozen_denominator` 에 기록된 고정 분모의 개수와 다른 라운드는 두 검증자 **모두**에 대해 **무효**이며, cap 은 소비하되 연속 clean 스트릭은 0 으로 되돌린다.
- `complete` 이벤트에 `verification` 이 **부재**하면 clean 이 아니라 **미검증**으로 읽는다. v1.0.0 시절 이벤트가 여기에 해당하며, 하드 실패가 아니라 보고 대상이다.
- `verification` 은 **증거일 뿐 권한이 아니다**. `status` 가 완료의 **유일한 긍정 신호**이고 `verification` 은 그것을 **무효화할 수 있는 선행 조건**일 뿐이다 — 즉 `verification` 만으로 완료를 추론하는 읽기 측은 진실 출처를 둘로 만들지만, §3 대로 선행 기록이 없거나 통과가 아니면 `status=complete` 도 완료로 읽지 않는다.

### 2.4 `design_baseline` object (선택, v1.2.0 신설)

| 키 | 타입 | 값 |
|---|---|---|
| `path` | string | 설계 기준선 아티팩트 경로 (`docs/analysis/kiwi-wave-master-{run_id}/design-baseline.json`) |
| `source_file` | string | 그 wave 를 고정한 입력 문서 경로 |
| `heading_path` | string | 그 wave 가 대응하는 헤딩 경로 |
| `line_start` | number | 소스 범위 시작 줄 |
| `line_end` | number | 소스 범위 끝 줄 |
| `out_of_scope` | array | 어느 wave 에도 배정되지 않고 명시적으로 범위 밖으로 기록한 최상위 섹션 `{ heading, reason, exclusion_class }` **전량** |
| `existing_modules` | string[] | 그 wave 가 건드릴 것으로 예상되는 기존 모듈 |
| `design_items` | array | 그 wave 범위의 설계 항목 **전량**. 각 항목 `{ id, heading_path, line_start, line_end, statement }` (v1.3.0 신설) |
| `excerpt_path` | string | 그 wave 의 설계 **본문 발췌** markdown 경로 (`docs/analysis/kiwi-wave-master-{run_id}/design-baseline/wave-{n}.md`) (v1.3.0 신설) |
| `integration_items` | array | wave 경계를 가로지르는 **통합 항목** 전량 — 어느 한 wave 의 scope 에도 속하지 않는 설계 항목. 각 항목 `{ id, heading_path, line_start, line_end, statement }` (v1.3.0 신설) |

설계 기준선 아티팩트는 `waves.jsonl` 만으로 해소된다 — 대화 상태가 사라진 재개 세션에서도 `design_baseline.path` 하나로 도달할 수 있어야 한다.

`exclusion_class` ∈ `already-implemented` / `superseded` / `external-ownership` / `user-excluded` / `non-normative` — 배제 사유를 **자유 텍스트**가 아니라 닫힌 분류로 남긴다(`reason` 은 그 분류의 부연이다). 목록 밖의 값은 쓰지 않는다.

---

## 3. status 전이 규칙

```
pending → in_progress → complete
                     ↘ failed
```

- wave 시작 시 `in_progress` 1줄 append.
- **`complete` 는 그 wave 의 `/kiwi-pipeline` 이 성공적으로 완료된 뒤에만** append (mark-complete-only-after-success). 실행 중/실패 wave 는 `complete` 로 기록하지 않는다.
- 실패 시 `failed` append 후 오케스트레이션 중단(사용자 결정).

**검증 게이트 (v1.1.0)**: `complete` 는 그 wave 의 `/kiwi-pipeline` 성공에 더해 **웨이브 종료 상호검증 통과**를 함께 요구한다. 같은 run 안에 그 wave 의 **최신** wave-verify 기록의 `verification.verdict` 가 `pass` 가 아니거나 그런 기록 자체가 없는 `complete` 이벤트는 **무효**이며, 재개는 그 wave 를 **미완료**로 간주한다. 루프는 라운드마다 기록을 남기므로 게이트는 항상 **최신 1줄**을 보며, 비종료 라운드의 `in-progress` 는 게이트를 통과시키지 않는다. 이 조항이 없으면 검증 단계를 통째로 건너뛴 저널이 기존 저널과 바이트 동일해져 사후 탐지가 불가능하다. 이 조항은 `schema_version` **1.1.0 이상** 이벤트에만 적용한다 — 1.1.0 미만으로 기록된 기존 `complete` 는 그대로 완료로 존중하고(멱등 재개 §4 유지) §2.3 대로 **미검증**으로 보고만 한다. 단 이 면제는 **run 단위**로 판정한다: 같은 run 에 1.1.0 이벤트가 하나라도 있으면 그 run 의 `complete` 는 버전 표기와 무관하게 본 조항의 적용을 받는다. 버전은 policing 대상인 생산자가 스스로 쓰는 값이므로, 버전만 보고 면제하면 1.0.0 으로 낮춰 쓰는 것이 곧 우회(downgrade bypass)가 된다.

이 게이트는 `wave="all"` 인 run-scope 이벤트에는 **적용하지 않는다** — run-scope 에는 자기 wave 의 wave-verify 기록이 원리적으로 존재하지 않아 항상 무효가 된다. run-scope 완료의 선행 조건은 §4 의 최종 검증 술어다.

**run-scope 최종 검증 이벤트 (v1.2.0)**: 전체 wave 최종 검증 결과는 하나의 wave 가 아니라 **run 전체**에 붙는다: 그 이벤트는 `wave` 는 `"all"`, `order` 는 `0`, `phase` 는 `"final-verify"` 를 싣고, `target` 도 `"all"` 로 쓴다 — run-scope 에는 단일 wave target 이 없다. wave 별 최신 상태를 계산할 때는 `wave="all"` 이벤트를 **제외**한다 — 포함하면 존재하지 않는 wave 하나가 영원히 미완료로 읽힌다.

`final-verify` 이벤트가 **통과하지 못한** 경우 그 이벤트의 `status` 는 `failed` 로 쓴다 — `complete` 는 통과한 최종 검증에만 쓴다.

---

## 4. 재개 (resume) 규약

`waves.jsonl` 에서 **현재 run 의 `run_id` 와 일치하는 이벤트만**을 골라 각 wave 의 **마지막(latest)** 이벤트 status 를 계산한다. 이 계산에서 `wave="all"` 인 run-scope 최종 검증 이벤트는 **제외**한다(§3) — 그것은 어느 wave 의 상태도 아니다:

- 모든 wave 가 `complete` 이고 **그리고** 최신 `final-verify` 이벤트의 `verification.verdict` 가 `pass` → 전체 완료.
- 그 외 → status 가 `complete` 가 아닌 **첫 번째 미완료(first incomplete) wave** 부터 재개한다. 이미 `complete` 인 앞 wave 는 건너뛴다.

최종 검증이 통과하지 않은 run 은 완료로 보고하지 않고 **최종 검증으로 재개한다** — 모든 wave 가 `complete` 여도 마찬가지다.

append-only 이므로 최신 상태는 항상 각 `wave` 의 마지막 줄이다.

**엔진 필터 (v1.4.0)**: 재개는 현재 run 의 `run_id` 와 일치하고 **그리고** 자기 `engine` 과 일치하는 줄만 읽는다 — 두 필터는 **모두** 적용되며, 엔진 필터는 위 run 스코프 필터를 **대체하지 않는다**(추가 연언지다). `engine` 필드가 없는 줄은 `kiwi-wave-master` 가 쓴 것으로 읽는다: v1.4.0 이전에 기록된 모든 줄은 예외 없이 그 엔진이 쓴 것이므로, 이 기본값은 추정이 아니라 코퍼스에 대한 사실이다.

이 필터가 닫는 결함: 저널에는 오늘 **생산자 판별자**가 없어 `kiwi-wave-master --resume` 이 orchestrator 의 run 을 자기 "가장 최근 미완료 run" 으로 선택할 수 있다. 이는 가설이 아니라 **현존 결함**이며, 본 조항은 `kiwi-wave-master` 와 `kiwi-orchestrator` **양쪽**에 같은 강도로 적용된다 — 두 생산자가 한 파일을 공유하는 한, 한쪽만 필터하면 반대 방향의 오독이 그대로 남는다.

**재개 대상 run 의 선택 (v1.3.0)**: 재개 대상 run 은 **자기 `engine` 이 쓴 run 중** `complete` 로 끝나지 않은 **가장 최근 미완료** run_id 이며, 호출자가 `--run-id` 로 **명시**하면 그것이 우선한다.

**run 스코프 규칙의 버전 스코프 (v1.3.0)**: 본 run 스코프 조항에는 **버전 면제를 두지 않는다** — 면제는 다른 run 의 `complete` 를 자기 것으로 읽는 경로를 이미 기록된 저널에 그대로 남기고, 그 오독의 귀결이 구현 0 건으로 전체 완료를 보고하는 것이기 때문이다. §3 의 1.1.0 게이트나 아래 1.2.0 조항과 달리, 면제가 지키는 것이 없고 잃는 것만 있어 소급 적용한다.

**도달 불가한 PASS 탐지 (v1.3.0)**: 재개 시점에 **남은 라운드** 수(`cap - rounds`)가 그 모드의 연속 clean **스트릭** 요구치보다 작으면 PASS 가 산술적으로 불가능하므로, 라운드를 더 돌지 않고 `verdict` 를 `fail-cap` 으로 기록하고 사용자 결정을 받는다. 그 **스트릭 요구치**는 Normal 이 **1** 이고(스트릭이 없는 모드도 clean 라운드 1회는 필요하다), `--max` 의 값은 변형마다 다르므로 `kiwi-wave-master §5.5.4` 의 표를 SSOT 로 읽는다.

**최종 검증 조건의 버전 스코프 (v1.2.0)**: 위 술어의 `final-verify` 조건은 `schema_version` **1.2.0 이상** 이벤트에만 적용한다 — 1.2.0 미만으로만 기록된 기존 run 은 모든 wave 가 `complete` 인 것만으로 완료로 존중한다(§3 의 1.1.0 게이트와 같은 논리로, 이미 기록된 저널의 해석을 소급해 바꾸지 않는다). 단 이 면제도 **run 단위**로 판정한다: 같은 run 에 1.2.0 이벤트가 하나라도 있으면 그 run 은 버전 표기와 무관하게 본 조항의 적용을 받는다.

**재개 시 상태 처리**: 재개된 오케스트레이션은 **같은 `run_id` 를 그대로 재사용**한다 — 새 run_id 를 발급하면 §3 게이트가 보는 run 과 카운터가 누적된 run 이 갈라져, 누적 자체가 무의미해진다. 라운드 카운터는 재개를 가로질러 **누적**된다 — 크래시 루프가 상한을 리셋하지 못하게 한다. 반대로 통과 verdict 는 **영속되지 않는다** — 부분적으로 기록된 검증은 종료 조건에 산입하지 않으며, 재개된 검증은 항상 라운드 1 의 판정부터 다시 시작한다. 소비는 영속시키고 승인은 영속시키지 않는다.

---

## 5. Emit 패턴

`WAVE_DIR` 는 **run 시작 시 1회** 계산해 재사용한다 — 아래 해석 블록을 emit 마다 다시 실행하지 않는다(§1 run-root pin). kiwi-wave-master §5.5.6 이 라운드마다 append 를 요구하므로 이 구분이 v1.0.0 때보다 중요하다.

```bash
WAVE_ROOT=$(git rev-parse --show-toplevel 2>/dev/null)
if [ -n "$WAVE_ROOT" ]; then WAVE_DIR="$WAVE_ROOT/kiwi"
elif [ -d "./kiwi" ]; then WAVE_DIR="./kiwi"
else WAVE_DIR="$HOME/.kiwi"; fi
mkdir -p "$WAVE_DIR"
# 1) 웨이브 종료 상호검증 기록 (§3 이 요구하는 선행 통과 기록). 라운드마다 1줄.
echo '{"ts":"<ISO>","schema_version":"1.4.0","engine":"kiwi-wave-master","writer":"speckiwi-orchestrate/{pkgVersion}","run_id":"<rid>","wave":"wave-1","order":1,"target":"wave-1","status":"in_progress","phase":"wave-verify","pipeline_run_id":"<prid>","pipeline_run_ids":["<prid>"],"diff_window":{"base_sha":"<sha>","head_sha":"<sha>"},"verification":{"rounds":2,"cap":5,"verdict":"pass","axis_a":{"roll_up":"ALL_MATCH","expected":8,"checked":8},"axis_b":{"substantive_clean":true,"open":{"critical":0,"high":0,"medium":0,"low":0}},"design_layer":{"expected":6,"mapped":6,"unmapped":[]},"constraint_layer":{"expected":3,"checked":3,"violations":[]},"preservation_layer":{"expected":3,"checked":3,"rows":[]},"regression":{"command":"npm test","exit_code":0,"failing_tests":[],"baseline_failing_tests":[]},"frozen_denominator":{"round":2,"req_ac":8,"design_items":6,"preservation":3,"constraints":3},"residual":[],"report_path":"docs/analysis/..."},"summary":"<one-liner>"}' >> "$WAVE_DIR/waves.jsonl"

# 2) 그 다음에야 complete. verdict 가 pass 가 아니면 이 줄을 쓰지 않는다.
echo '{"ts":"<ISO>","schema_version":"1.4.0","engine":"kiwi-wave-master","writer":"speckiwi-orchestrate/{pkgVersion}","run_id":"<rid>","wave":"wave-1","order":1,"target":"wave-1","status":"complete","pipeline_run_id":"<prid>","pipeline_run_ids":["<prid>"],"diff_window":{"base_sha":"<sha>","head_sha":"<sha>"},"verification":{"rounds":2,"cap":5,"verdict":"pass","axis_a":{"roll_up":"ALL_MATCH","expected":8,"checked":8},"axis_b":{"substantive_clean":true,"open":{"critical":0,"high":0,"medium":0,"low":0}},"design_layer":{"expected":6,"mapped":6,"unmapped":[]},"constraint_layer":{"expected":3,"checked":3,"violations":[]},"preservation_layer":{"expected":3,"checked":3,"rows":[]},"regression":{"command":"npm test","exit_code":0,"failing_tests":[],"baseline_failing_tests":[]},"frozen_denominator":{"round":2,"req_ac":8,"design_items":6,"preservation":3,"constraints":3},"residual":[],"report_path":"docs/analysis/..."},"summary":"<one-liner>"}' >> "$WAVE_DIR/waves.jsonl"

# 3) 마지막 wave 의 complete 뒤 1회. run-scope 최종 검증 (§3): wave 는 "all", order 는 0. run 창은 `run_diff_window` 로 싣는다(wave 단위 `diff_window` 는 싣지 않는다).
echo '{"ts":"<ISO>","schema_version":"1.4.0","engine":"kiwi-wave-master","writer":"speckiwi-orchestrate/{pkgVersion}","run_id":"<rid>","wave":"all","order":0,"target":"all","status":"complete","phase":"final-verify","run_diff_window":{"base_sha":"<sha>","head_sha":"<sha>"},"verification":{"rounds":1,"cap":5,"verdict":"pass","axis_a":{"roll_up":"ALL_MATCH","expected":21,"checked":21},"axis_b":{"substantive_clean":true,"open":{"critical":0,"high":0,"medium":0,"low":0}},"design_layer":{"expected":21,"mapped":21,"unmapped":[]},"constraint_layer":{"expected":9,"checked":9,"violations":[]},"preservation_layer":{"expected":9,"checked":9,"rows":[]},"regression":{"command":"npm test","exit_code":0,"failing_tests":[],"baseline_failing_tests":[]},"frozen_denominator":{"round":1,"req_ac":21,"design_items":21,"preservation":9,"constraints":9},"residual":[],"report_path":"docs/analysis/..."},"summary":"<one-liner>"}' >> "$WAVE_DIR/waves.jsonl"
```

emit 은 best-effort — 실패가 본 오케스트레이션 실패로 이어지면 안 된다 (stderr WARN).
