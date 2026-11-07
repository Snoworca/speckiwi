# kiwi wave-decomposition v1.0.0

요구 분해의 **공용 계약** SSOT. `kiwi-wave-master` 와 `kiwi-orchestrator`(`R-ORCH`)가 이 문서를 고치지 않고 그대로 인용한다 — 분해 방식은 하나뿐이고 그 곁에 wave 마다 저작하는 두 번째 방식은 없다. 분해하는 것은 문서의 머리글이 아니라 run 앞에서 **한 번** 저작한 제품 target 의 요구 집합이다.

본 계약 안의 `§n` 은 이 파일의 절을 가리킨다.

---

## 1. 입력 — 호출자가 넘기는 것

| 파라미터 | 의미 |
|---|---|
| `artifact_root` | 아래 아티팩트의 루트. **호출자가 인자로 전달하며 본 문서는 하드코딩하지 않는다** — `kiwi-wave-master` 는 `docs/analysis/kiwi-wave-master-{run_id}/`, `kiwi-orchestrator` 는 `docs/research/{work}/` 를 넘긴다 |
| PRD | 승인된 PRD 경로 — 없으면 `kiwi-prd` 가 먼저 만든다 |
| 제품 target | 이 run 이 구현하는 target — 요구는 모두 여기에 저작한다 |
| `existing_modules` | 기존 모듈과 그 의존 방향의 요약 — 영향 분석의 입력. 분해가 끝나면 노드마다 건드릴 것으로 예상되는 기존 모듈을 `{artifact_root}existing-modules.json`(노드 → 모듈 목록)에 적는다 — 교차 wave 회귀 판정과 `kiwi-sds --existing-modules` 가 읽는다 |
| `constraints_path` | 선언 제약 아티팩트 경로. 사용자 프롬프트 · 대화 로그 · `--constraint` 에서 제약을 수집한다 — 제약 문장 1건 = 1 항목(`id` · `statement` · `source`)으로 모은다. **제약이 없어도 빈 배열** 아티팩트를 반드시 만들고 그 경로를 항상 기록한다 — 빈 배열은 반증 가능한 주장이고 필드 부재는 침묵이다. **후발 제약** — run 도중 새로 선언된 제약 — 은 앞선 아티팩트를 제자리에서 고치지 않고 새 아티팩트로 쓰고, 그 경로를 실은 `in_progress` 줄을 append 하며, 해소는 언제나 **최신** `constraints_path` 를 읽는다 |

아래 `orchestrate` 도구 호출에는 호출자가 자기 스킬에 적은 엔진 인자를 더한다 — 그 도구들은 호출자 자신의 run 저널을 읽는다.

## 2. 순서 — run 당 한 번

1. **PRD** — 요청에 PRD 경로가 없으면 `kiwi-prd` 를 먼저 부른다.
2. **처음 저작** — `wave-srs-registration.md §1` 의 호출 하나로 제품 target 의 SRS 를 쓴다. `kiwi-orchestrator --existing-srs` 면 이 단계를 건너뛰고, 4 의 PRD 커버리지는 그대로 돈다.
3. **feasibility 한 번** — `Skill({ skill: "kiwi-srs-feasibility", args: "TARGET=<제품 target> [--auto] [--max] [--mini|--loops N]" })` 을 처음 저작 뒤, 첫 dispatch 앞에 한 번 부른다. wave 마다 부르지 않는다. 뒤 wave 의 요구는 `draft` 로 남겨도 되고, 그 노드를 스케줄하기 직전에 올린다(`parallel-waves.md` PW-4).
4. **PRD 커버리지** — §5.
5. **영향 분석** — 서브에이전트 하나가 요구마다 바꿀 것으로 예상되는 파일을 `{artifact_root}waves/expected-files.json`(요구 ID → 경로 목록)으로 쓴다. 입력은 요구 ID 와 AC, `existing_modules`, 저장소다. 수렴 레지스트리(`run-ledger.md`)가 `orchestrator-only` · `regenerate` 로 표시한 경로는 넣지 않는다 — 그 경로는 호스트가 병합 뒤에 처리한다(`parallel-waves.md` PW-12). 이 지도는 다음 단계의 `--files` 로만 넘기고 어느 SRS 필드에도 쓰지 않는다.
6. **초안** — `speckiwi orchestrate wave propose --target <제품 target> --files {artifact_root}waves/expected-files.json --run-id {run_id} --json`. 도구가 노드(`wave-1`, `wave-2`, …) · `acs` · `edges` · `files` 를 정한다. run 이 target 의 요구 일부만 구현하면 `--target` 대신 `--requirements <남기는 요구 ID>` 를 주어 그래프의 `scope.requirements` 에 남기는 요구를 적고, 그 좁힘에 대한 사용자 동의를 run 당 한 번 받아 기록한다(`out-of-scope-user-consent`, `--auto` 도 멈춘다).
7. **메타데이터** — 에이전트가 그래프 최상위 `prd` 에 run 의 PRD 경로(1단계의 PRD)를 적고, 노드마다 `title` · `purpose` · `description` · `cautions` · `done_when` · `on_complete` · `github_issues` 를 채운다. `wave show` 는 그 `prd` 로 노드의 PRD 항목(§4)을 푼다 — 없으면 `prd_items` 가 비어 검증자가 받을 PRD 항목도 빈다.
8. **확정** — `{artifact_root}waves/waves.json` 에 `schema_version` 2.0.0 으로 쓰고 `speckiwi orchestrate wave check --waves {artifact_root}waves/waves.json --run-id {run_id} --json` 을 통과시킨 뒤 명시 pathspec 으로 커밋한다. error 진단이 하나라도 있으면 dispatch 하지 않고 그래프를 고쳐 다시 check 한다. 커밋한 그래프의 `graph {path, digest}`(digest 는 그래프 파일 바이트의 sha256)를 run 의 첫 graph 줄(그래프를 커밋한 뒤 처음 쓰는 저널 줄)에 싣는다 — 도구가 run 의 최신 그래프를 그 줄과 `redecompose` 줄에서 찾는다.

## 3. 배정은 그래프의 `acs` 다

범위의 살아 있는 AC 는 정확히 한 노드의 `acs` 에 든다 — 그것이 배정이다. 판정은 `orchestrate wave check` 의 분할 검사(`ac-unassigned` · `ac-assigned-twice` · `ac-out-of-scope`)가 하고, 저작 전후 요구 스냅샷의 차집합도 손으로 채우는 요구 목록도 없다. 한 요구의 AC 가 여러 노드로 나뉘면 같은 검사가 `ac-split` 경고를 낸다 — 요구 하나는 한 노드에 통째로 든다. 노드의 요구 집합은 `acs` 에서 계산되며 `speckiwi orchestrate wave show --wave <id> --json` 의 요구 집합으로 읽는다.

## 4. 노드의 PRD 항목

노드의 PRD 항목은 그 노드 요구들의 Rationale 이 인용한 PRD 항목의 합집합이고 `orchestrate wave show` 의 `prd_items` 로 읽는다. 노드마다 PRD 항목을 적는 발췌는 쓰지 않는다.

## 5. PRD 커버리지 — `wave-decomposition-coverage-gap`

처음 저작 뒤와 증분 저작(`wave-srs-registration.md §2`) 뒤마다 `speckiwi prd coverage <PRD> --target <제품 target> --json` 을 돌린다. 그 `uncitedItems` 의 항목은 `speckiwi targets --json` 이 나열하는 다른 target `t` 마다 `speckiwi prd coverage <PRD> --target <t> --json` 의 `uncitedItems` 에도 있을 때만 이 run 에서 빠진 항목으로 센다. 빠진 항목이 하나라도 있으면 다음 dispatch 전에 `wave-decomposition-coverage-gap` 으로 멈춘다. 다른 target 의 요구가 인용한 항목(그 target 의 `uncitedItems` 에 없는 항목)은 멈추지 않고 그 target 에 배정되었다고 보고한다.

## 6. 재분해 — 아직 dispatch 하지 않은 노드만

**남은 노드**는 `speckiwi orchestrate wave status --waves <그래프> --run-id {run_id} --json` 의 행이 `dispatched: false` 이고 저널 줄이 없는(`ts` 가 null) 노드다 — 저널을 손으로 읽지 않는다. 그 밖의 노드 — dispatch 했거나, `--sds` 의 SDS 줄처럼 이미 저널 줄에 이름이 오른 노드 — 의 순서 · 범위 · 의존은 바꾸지 않는다.

run 도중 새 요구가 생기면(`wave-srs-registration.md §2`) 영향 분석으로 그 요구의 예상 파일 F 를 정하고 아래 규칙으로만 배치한다.

- **R1** — F 가 남은 노드 하나와만 겹치면 그 노드에 넣는다.
- **R2** — F 가 남은 노드 여럿과 겹치면 위상 순서로 마지막인 노드에 넣고, 나머지 노드에서 그 노드로 간선을 더하며, 그 결과 사이클을 이루는 노드는 합친다.
- **R3** — F 가 남은 노드가 아닌 노드와만 겹치면 새 노드를 만든다. run 당 추가 wave 상한 3 에 센다(`wave-append-cap-exhausted`).
- **R4** — F 가 어느 노드와도 겹치지 않으면 간선 없는 새 노드를 만들거나, 그 요구가 의존하는 요구를 가진 노드에 넣는다.
- **R5** — 그 결과 노드가 `wave propose` 의 크기 상한을 넘으면, 남은 노드일 때만 둘로 나눈다.

변경마다 그래프의 새 판을 늘 같은 경로 `{artifact_root}waves/waves.json` 에 덮어쓰고, 그 판의 `graph {path, digest}` 를 실은 `phase="redecompose"` 줄을 `speckiwi orchestrate journal append --run-id {run_id} --payload-file <그 줄>` 로 덧붙인 뒤, 다음 dispatch 전에 `orchestrate wave check` 와 `orchestrate schedule waves` 를 다시 통과시킨다.

## 7. 제외 분류

제외는 판단이 아니라 기록이다. PRD 의 exclusion 항목과 §2 의 범위 좁힘 기록은 `exclusion_class` 를 `already-implemented` / `superseded` / `external-ownership` / `user-excluded` / `non-normative` 다섯 값의 **closed** 목록에서 고른다 — 목록 밖의 값을 쓰지 않는다. 자유 텍스트 사유 한 줄로 범위를 줄이는 경로를 닫는다.
