---
name: kiwi-pm
description: "kiwi-sds 가 합의(agreed)한 lite SDS 한 파일(docs/sds/<sds-id>.sds.md)을 입력으로 받아, 그 SDS 를 격리된 sub-agent(kiwi-coder) 실행 하나로 구현시키는 runner v0.1 — SDS 하나 = kiwi-coder 실행 하나. 3상태 프로토콜(TASK_DONE / NEEDS_USER / FAILED) 로 메인 세션과 대화하며, 부팅 시 speckiwi sds check 와 Stability lifecycle gate(evolving/stable 만 진행), 종료 시 SDS @req 요구의 implemented 승급 + add_completed_work(sds-summary), doculight MCP 가용 시 보고서 표시, 단독 실행이면 끝에서 항상 kiwi-review-fix-loop 로 넘긴다. --auto 는 공용 auto-option 정책으로 clarification/business-decision/rollback-confirmation 게이트를 자동 결정하되 critical_gates[] 는 항상 중단한다. `--model <name>` 로 kiwi-coder 검증 서브에이전트 모델 지정 전파. --resume 재개 가능. 트리거 — SDS 구현, SDS 돌려, kiwi pm, kiwi 코더 실행, 자동 코딩 실행, sds 실행, coder runner. 범위 외 — SRS/feasibility/SDS 작성 스킬 호출 안 함(§6.4 의 `kiwi-sds --close` 마감 호출만 예외), /snoworca-* 호출 절대 금지."
---
> Kiwi MCP rule: normal target-scoped SRS reads, mutations, validation, status/stability updates, acceptance-criteria changes, evidence, trace links, and completed-work logging require working `speckiwi mcp`. CLI is diagnostic/remediation only and is not a normal replacement for MCP mutations.
# kiwi-pm v0.1

> Codex clarification gate means: ask the user directly in Default mode; use `request_user_input` only in Plan mode when that tool is available.
> Model tier terms are role guidance, not provider names: `high-reasoning`, `standard`, and `lightweight` map to the current Codex model and effort options available in the session.

## Official Workflow Tool Policy

For covered workflow artifact flows, use official SpecKiwi workflow tools before raw file reads or manual appends:

1. Read the SDS and session state through MCP `check_sds`, `get_next_work_order`, `workflow_session_status`, and `workflow_worklog_tail` before reading `docs/sds`, `.kiwi/sessions`, worklogs, or pipeline JSONL directly.
2. Use guarded workflow mutations (`workflow_worklog_emit`, `workflow_pipeline_emit`, and `workflow_repair_record`) before shell JSONL append snippets.
3. Use CLI `speckiwi sds check <path> --json` and `speckiwi workflow ... --json` only as diagnostic/remediation fallback when MCP tools are unavailable; CLI is not a normal replacement for MCP SRS mutations.
4. Raw file fallback is degraded mode. It is allowed only after capturing tool diagnostics, affected artifact paths, active target, and a follow-up requirement or candidate ID in `pm-state.json`, the report, or worklog.

`$kiwi-sds` 가 합의(`agreed`)한 lite SDS 한 파일을 입력으로 받아, 그 SDS 를 격리된 sub-agent(`kiwi-coder`) 실행 하나로 구현시키는 runner. SDS 하나가 실행 단위다 — PM 은 SDS 를 나누거나 합치지 않고, 한 실행에 너무 큰 설계는 `$kiwi-sds` 가 여러 SDS 로 나눈다.

PM 자체는 read-only orchestrator 에 가깝다 — 구현/TDD/회귀/MCP mutation 4종 중 3종은 자식 `kiwi-coder` 전권. PM 은 부팅 시 `check_sds` 로 SDS 를 검사하고 speckiwi `list_requirements` read 로 Stability lifecycle gate 적용하고, 실행이 끝나면 T-final 단계에서 `update_status("implemented")` + `add_completed_work(sds-summary)` 2종 mutation 으로 마무리한다. 보고서는 doculight MCP 가용 시 doculight MCP `open_markdown` 으로 표시.

---

## 0. 공통 규약 (SSOT)

| 키 | 규칙 |
|---|---|
| §0.1 | **TDD 강제 위임**. PM 은 TDD 게이트 직접 호출 안 함 — kiwi-coder §0.1/§0.G1 가 자체 처리. 자식이 SDS 의 TDD 사이클(test → red → impl → green) 책임 |
| §0.2 | **SDS 입력 SSOT**. 입력은 `$kiwi-sds` 가 합의한 lite SDS 한 파일이다 — `docs/sds/<sds-id>.sds.md`, `Profile = lite`, Status `agreed`, `speckiwi sds check` error 0. 문법과 진단 코드는 `docs/rule/SDS-MD-Rules-v2.6.0.md` §9 가 정본이며 본 스킬에 다시 적지 않는다. 위반 시 `references/extended-workflow.md` §7.1 입력 무결성 게이트 차단. PM 도 자식도 SDS 를 고치지 않는다 — 설계가 틀렸으면 NEEDS_USER 로 올린다 |
| §0.3 | **`/snoworca-*` 호출 절대 금지** + `_shared/snoworca/` 모듈 import 절대 금지. snoworca-pm 의 로직만 차용했으며 실행은 본 스킬 내부에서 직접 수행. kiwi-* 시리즈 독립 운영 원칙 |
| §0.4 | **검증은 서브에이전트**. 판단이 끼는 모든 작업은 sub-agent로 위임 (project verification rule). 자기검증 금지. SDS 의 결정적 검사는 `speckiwi sds check` 가 한다 |
| §0.5 | **메인 세션의 직접 파일 수정 금지** — PM 은 코드 파일도 SDS 도 수정하지 않고, 자기 상태 파일(`pm-state.json` · `pm.lock` · `reports/`)만 쓴다. PM 은 자동 commit 하지 않는다 — `--commit-lane-work` 를 명시한 오케스트레이션 실행이 그 **유일한 예외**다 (§1.5) |
| §0.6 | **Mock 검출은 kiwi-coder 책임** (kiwi-coder §0.6). PM 은 무대응 |
| §0.7 | **실행 단위 = SDS 하나 = kiwi-coder 실행 하나**. PM 은 SDS 를 나누거나 합치지 않는다 — 한 실행에 너무 큰 SDS 는 `$kiwi-sds` 가 여러 SDS 로 나눈다 (kiwi-coder §0.15 정합) |
| §0.8 | **사용자 확인 의무 + `--auto` 처리** — 다음 시점에 `Codex clarification gate` 또는 `../_shared/kiwi/auto-option.md` decision worker 적용: ① lifecycle gate 차단 (§4) ② NEEDS_USER severity=business-decision (§5.1) ③ T-final mutation 제안 승인 (§6.2) ④ MCP 미가용 시 HALT 및 복구 안내 ⑤ SDS SHA256 mismatch on `--resume` (§5.4). §0.G7 critical_gates[] 는 `--auto` 로 우회하지 않는다. |
| §0.9 | **외부 모듈 영향 처리는 kiwi-coder 책임** (kiwi-coder §0.G2). 자식이 `NEEDS_USER + severity=business-decision` 으로 PM 에 버블업하면 §5 가드레일 적용 |
| §0.10 | **project signature-ban instruction** + **project change-history policy**. 본 스킬 본문에 `## 변경 이력` / `## Changelog` / `### v0.x.y` 섹션 없음 — git history 가 SSOT. 커밋 메시지·코드 주석·산출물 어디에도 AI 식별 정보 금지 |
| §0.11 | **`.kiwi/sessions/{sds_id}/pm-state.json` 영속 의무**. 실행 종료 / NEEDS_USER 버블업 / FAILED / `--resume` 진입 / lifecycle gate 평가 직후 SAVE_STATE. 손상 시 `.bak` 복구 (§7.2) |
| §0.12 | **MCP 호출 분담 + 시그니처 SSOT** — speckiwi MCP 실제 schema 기준. PM 호출 2종: (a) `update_status(id, status)` — T-final 조건부 implemented 승급, dryRun 옵션 없음. (b) `add_completed_work(date, summary, [requirementIds, target, scope, reportPaths, allowIncomplete, dryRun])` — T-final sds-summary, sds_id 같은 임의 필드는 summary 텍스트에 인코딩. read 3종: `get_active_target` / `list_requirements` / `check_sds`. 자식 kiwi-coder 4종 mutation: `add_trace_link(id, type, reference, relation)` / `add_verification_evidence(id, type, reference, [covers, notes])` / `update_status(id, status="in_progress")` / `add_completed_work(date, summary, ...)`. doculight MCP: `open_markdown` / `update_markdown` (§6.3) |
| §0.13 | **회귀 테스트는 kiwi-coder §0.13 책임**. PM 은 별도 회귀 호출 안 함. 종합 통합 테스트가 필요하면 사용자에게 별도 안내 |
| §0.14 | **세션 id SSOT**. `sds_id` 는 SDS 파일 이름에서 `.sds.md` 를 뺀 값이고 세션 `run_id` 로 그대로 쓴다. `run_id` = `[a-z0-9.-]{4,128}` — 벗어나면 §7.1 차단. 이 정규식은 **세션 식별자** 전용이며 **이벤트 emit 키**에는 **적용하지 않는다** — 재진입 emit 키 `{run_id}#r{n}` 는 다른 id 공간이다(`pipeline-event.md` §5.4) |
| §0.15 | **서브에이전트 위임 모드 단일** — 사용 가능한 Codex sub-agent/delegation 도구로 자식 `kiwi-coder` 를 실행한다. 자식 모델 = 현재 세션 모델 (또는 `--model <name>` 로 kiwi-coder 검증 서브에이전트 모델 override). legacy `--headless` CLI subprocess 폐기. 메인 컨텍스트 직접 skill 재진입 금지 (메인 컨텍스트 격리가 PM 본질 가치). 본 결정의 영향 — T1/T2/T3 forbidden_patterns 게이트 / ENV_WHITELIST / sentinel parser / process group / Python self-heal hook 모두 불필요해져 제거 |
| §0.16 | **`--auto` 옵션 SSOT**. 본 스킬은 `../_shared/kiwi/auto-option.md` v1.0 을 따른다. `business-decision` 은 더 이상 blanket hard halt 가 아니며, §0.G7 critical gate 에 해당하지 않는 경우 decision worker 가 결정할 수 있다. 자식 `$kiwi-coder` 호출에는 `--auto` 를 전파한다. |
| §0.17 | **`--mini` / `--loops N` 옵션 SSOT**. 본 스킬은 `../_shared/kiwi/loop-option.md` v1.0 을 따른다. `--mini` = 검증-개선 루프 라운드 상한 3, `--loops N` = 라운드 상한 N(정수 ≥1). 동시 지정 시 **`--loops` 우선(경고)**. `--max` 와 직교(조합). 상한 도달 시 잔여 finding 보고(안전 게이트 불우회) |
| §0.18 참고 | `--mini`/`--loops N` 는 kiwi-coder 자식 spawn 과 §6.4 hand-off 에 전파 (loop-option.md §6) |

### §0.G — 핵심 게이트 결정표

#### §0.G1 — SDS 무결성

| IF | THEN |
|---|---|
| `SDS_PATH` 없음 | HALT + `$kiwi-sds` 로 SDS 를 먼저 작성·합의하라고 안내 (§1.1) |
| 경로가 `docs/sds/` 바로 아래가 아니거나 이름이 `.sds.md` 로 끝나지 않음 | HALT — lite SDS 가 놓이는 자리가 아니다 |
| `Profile ≠ lite` | HALT — tdd step 의 `design.md` 는 `$kiwi-tdd` 몫이다 |
| Status ≠ `agreed` | HALT + `$kiwi-sds` 로 합의 안내 |
| `check_sds` (MCP) 가 error 급 진단을 하나라도 돌려줌 | HALT + 진단 코드 목록 + `$kiwi-sds` 로 수정 안내 |
| SDS `@req` 집합이 비어 있음 | HALT — 승급할 요구가 없다 |
| `sds_id` 정규식 위반 (§0.14) | HALT |

#### §0.G2 — Lifecycle gate (Stability)

§4 의 표를 SSOT 로 참조. 진행 가능 = `evolving` / `stable` 만. `draft` 는 interactive 2지선다 / `--auto` 는 그 SDS 를 실행하지 않고 `$kiwi-sds` 요구 필터로 돌려보낸다 (§3.6), `deprecated` / `frozen` 은 즉시 HALT.

#### §0.G3 — NEEDS_USER 누적 상한

같은 SDS 실행에서 NEEDS_USER 3회 누적 시 (재spawn 한도) 2지선다 게이트 발동:
- (A) 추가 질문 1회 더 시도
- (B) 중단 + `run.status = "blocked"` 기록 (`--resume` 으로 이어간다)

#### §0.G4 — FAILED 분기

자식이 `status = "FAILED"` 반환 시 2지선다:
- (A) 같은 SDS 재시도 (처음부터)
- (B) 중단 — `run.status = "failed"` 로 확정

`--auto` 모드에서는 (A) 1회 자동 재시도 후에도 FAILED 면 사용자에게 에스컬레이션.

#### §0.G5 — T-final mutation backward transition

`update_status` 가 REQ status 를 역방향 (예: `implemented → in_progress`) 으로 전이시키는 호출은 PM 측에서 차단 + 경고. forward only (planned/in_progress → implemented) 만 허용.

#### §0.G6 — T-final dryRun 거부 / transition guard 거부

speckiwi `apply-patch.ts` 또는 `stability-transition.js` 가 mutation 을 거부할 경우, dryRun 단계에서 미리 감지 → 사용자에게 거부 사유 / 대체 옵션 제시. 강제 우회 없음 (kiwi-pipeline-v1 §5.3 정합).

#### §0.G7 — `--auto` critical_gates[]

| gate_id | reason | location |
|---|---|---|
| `lifecycle-gate-policy-stop` | `deprecated` / `frozen` lifecycle blocker — 정책 위반 / 의도된 제거. `draft` 는 본 행에 포함되지 않는다 (§3.6 요구 필터로 돌려보냄) | §4 |
| `task-failure-escalation` | `--auto` 자동 재시도 1회 후에도 kiwi-coder 실행이 FAILED — 사용자 에스컬레이션 (§0.G4 / §5.3). 본 표만 읽고도 중단 지점을 예측할 수 있어야 하므로 본문에만 있던 HALT 를 등재 | §5.3 |
| `existing-public-contract-change` | 자식 kiwi-coder 가 기존 public 심볼의 삭제 · 시그니처 변경을 버블업 (kiwi-coder 동명 게이트) — **경로와 무관**하게 critical. 아래 `path-heuristic-business-decision` 은 auth/schema/migration 경로 토큰에만 걸리므로 그 밖의 경로에서 깨지는 공개 계약을 잡지 못한다 | §5.1 |
| `existing-test-weakened-or-deleted` | 자식 kiwi-coder 가 기존 테스트 파일 삭제 · 케이스 제거 · 단언 약화를 버블업 (kiwi-coder 동명 게이트) — 회귀 안전망 자체를 제거하는 가장 비가역적 변경. 본 행이 없으면 `business-decision` 기본 분류로 떨어져 `--auto` 에서 decision worker 가 승인한다 | §5.1 |
| `auto-skip-lifecycle-gate-combo` | `--auto --skip-lifecycle-gate` 조합은 사용자 책임 범위 | §1.3 |
| `path-heuristic-business-decision` | SDS Files 경로의 auth/schema/migration 등 외부 관찰 가능 정책 변경 | §5.1 |
| `sha-mismatch-on-resume` | SDS SHA mismatch 는 외부 변경 의심 | §5.4 |
| `t-final-backward-transition` | status 역방향 전이 금지 | §0.G5 |
| `t-final-dryrun-rejected` | final mutation dryRun/transition guard 거부 | §0.G6 |
| `mcp-mutation-batch-large` | MCP mutation ≥10건 batch (kiwi-coder §0.8 버블업) | §5.1 |
| `external-module-impact` | 외부 모듈 영향 (kiwi-coder §0.G2 버블업) | §5.1 |
| `mcp-cli-both-unavailable` | speckiwi MCP + CLI 모두 부재 — lifecycle 또는 final mutation 판단 불가. CLI 진단 가능 여부와 무관하게 정상 SRS read/mutation 대체 금지 | §4.4 / §6.2 |
| `followup-review-fix-loop-close-unsafe` | §6.4 hand-off 에 `--close-reqs` 를 붙이려는 시점에 kiwi-coder 실행이 `done` 으로 끝나지 않았거나 critical 로 격상된 NEEDS_USER 가 잔존 — 그 상태로 `--close-reqs` 를 시작하면 되감을 수 없는 `verified` 를 향한다. 자식 `kiwi-coder` 가 §8.4 에 같은 이름으로 이미 선언한 게이트이며, 본 행이 없으면 PM 자신의 판단이라 승계되지 않고 `business-decision` 기본 분류로 떨어져 `--auto` 에서 결정 위원회가 승인한다 | §6.4 hand-off |
| `validate-spec-error` | `validate_spec` 가 error 급 진단을 하나라도 돌려줌 — 오류를 안은 요구 위에 증거와 승급을 쌓으면 그 통과가 무엇을 근거로 기록되었는지 되읽을 수 없다 | T-final — `add_completed_work` 직전 |

**이 게이트를 관측하는 자리**: 위 표에서 이 행의 세 번째 칸이 가리키는 홉에서 MCP `validate_spec` 을 실행한다 — MCP 가 없으면 CLI `speckiwi validate --json` 이다. error 급 진단이 하나라도 남아 있으면 그 홉을 진행하지 않고 `validate-spec-error` 로 중단하며, `--auto` 도 이 중단을 덮지 못한다. 실행하지 않은 채 통과로 기록하지 않는다.

**자식 선언 승계 (일반 규칙)**: 자식 스킬이 `NEEDS_USER` payload 의 `gate_id` 로 올린 게이트가 그 **자식 자신의** `critical_gates` 목록에 있으면, 본 표에 동명 행이 **없더라도** severity 로 재분류하지 않고 **무조건 HALT** 한다. 게이트별 수동 전사는 자식이 게이트를 추가할 때마다 누락되며, 누락된 게이트는 `auto-option.md` §4 의 기본 분류에 따라 `business-decision` 으로 떨어져 `--auto` 에서 결정 위원회가 승인한다 — 승계는 표의 동기화가 아니라 규칙으로 성립해야 한다.

---

## 1. 입력 / 출력

### 1.1 필수 입력

**`SDS_PATH`** — `$kiwi-sds` 가 합의(`agreed`)한 lite SDS 한 파일, `docs/sds/<sds-id>.sds.md`. 문법과 검사는 `docs/rule/SDS-MD-Rules-v2.6.0.md` §9 가 정본이다.

- `SDS_PATH` 가 없으면 HALT 하고 `$kiwi-sds` 로 SDS 를 먼저 작성·합의하라고 안내한다. `docs/sds/` 에서 파일을 골라 대신 쓰지 않는다.
- Status 가 `agreed` 가 아니거나 `speckiwi sds check` 가 error 를 내면 HALT 하고 `$kiwi-sds` 로 돌려보낸다.

### 1.2 선택 입력 + 자연어 매핑

| 자연어 신호 | 인자 | 기본값 |
|---|---|---|
| "SDS X 로", "X 구현", "{sds_id} 실행" | `SDS_PATH` | 없음 — 없으면 HALT (§1.1) |
| "코드는 Y 디렉토리에서" | `CODE_PATH` | 현재 작업 디렉토리 |
| "자동", "auto", "묻지 말고" | `--auto` | false (interactive) |
| "재개", "이어서", "resume" | `--resume` | false (신규 세션) |
| "검증 모델 지정", "다른 모델로 검증" | `--model <name>` | 현재 세션 모델 |
| "이전 lock 무시", "강제" | `--force` | false |
| "lifecycle 무시" (위험) | `--skip-lifecycle-gate` | false |
| "미니 모드", "빠른 모드", "3라운드" | `--mini` | off (스킬 기본 상한) |
| "루프 N회", "N라운드", "N번 돌려" | `--loops N` | off (스킬 기본 상한) |
| "max 모드", "정밀하게" | `--max` | off — PM 자체는 소비하지 않고 kiwi-coder 로 pass-through (§3.2) |
| "비용 경고 자동 skip" (부모 전달) | `--auto-cost-warning` | off — 명시 입력만 kiwi-coder 로 pass-through (§3.2) |
| "통합 테스트 자동 동의" (부모 전달) | `--auto-integration` | off — 명시 입력만 kiwi-coder 로 pass-through (§3.2) |
| "무인 완주" (부모 전달) | `--drive` | off — 명시 입력만 kiwi-coder 로 pass-through (§3.2, FR-FLOW-119) |
| "doculight 끄고" | `--no-doculight` | doculight 자동 표시 |
| "레인 세션", "세션 분리" (오케스트레이터 전달) | `--session-suffix <lane>` (세션 디렉터리 재배치, §1.5) | off (평면 배치) |
| "T-final 승급 생략" (오케스트레이터 전달) | `--no-final` (T-final 요구 승급 skip, §1.5) | off |
| "파이프라인 이벤트 억제" (오케스트레이터 전달) | `--no-pipeline-emit` (인자 없음 — `kiwi/pipeline.jsonl` append 를 수행하지 않는다, §1.5) | off (emit 수행) |
| "unit 산출물 commit" (오케스트레이터 전달) | `--commit-lane-work` (인자 없음 — SDS 쓰기 집합만 stage, §1.5) | off (자동 commit 없음 — `--commit-lane-work` 가 유일한 예외, §1.5) |
| "mutation 이연" (오케스트레이터 전달) | `--defer-srs-mutation <path>` (kiwi-coder spawn 프롬프트로 그대로 전달, §1.5) | off (coder 가 즉시 호출) |
| "리뷰는 부모가" (부모 전달) | `--review-hop-owned-by-parent` (인자 없음 — 부모가 이 실행 뒤 리뷰 홉을 직접 돈다, §6.4) | off (§6.4 hand-off 수행) |

### 1.3 CLI 인자 요약

```
$kiwi-pm SDS_PATH=docs/sds/<sds-id>.sds.md
         [CODE_PATH=.]                   # 부재 시 cwd
         [--auto]                         # auto-option decision worker 활성, critical gates 는 HALT
         [--model <name>]                 # kiwi-coder 자식에 --model 전파 (검증 서브에이전트 모델 지정)
         [--max]                          # kiwi-coder 자식에 --max 전파 (PM 자체는 소비 안 함, §3.2)
         [--auto-cost-warning]            # 명시 입력 시에만 kiwi-coder 로 pass-through (§3.2)
         [--auto-integration]             # 명시 입력 시에만 kiwi-coder 로 pass-through (§3.2)
         [--drive]                        # 명시 입력 시에만 kiwi-coder 로 pass-through (§3.2, FR-FLOW-119)
         [--regression-baseline <path>]   # 부모가 pin 한 회귀 기준선을 kiwi-coder 로 pass-through
         [--resume]                       # .kiwi/sessions/{sds_id}/pm-state.json 이어가기
         [--force]                        # stale lock 강제 해제 (주의 경고 후 진행)
         [--skip-lifecycle-gate]          # §4 게이트 우회 (사용자 책임, --auto 와 함께 사용 불가)
         [--session-suffix <lane>]        # 세션 디렉터리를 .kiwi/sessions/{sds_id}/lanes/{lane}/ 로 재배치 (§1.5)
         [--no-final]                     # T-final 요구 승급과 §6.4 hand-off skip (§1.5)
         [--no-pipeline-emit]             # 인자 없음 — kiwi/pipeline.jsonl append 를 수행하지 않는다 (§1.5)
         [--commit-lane-work]             # 인자 없음 — SDS 쓰기 집합만 stage 해 SDS 실행당 commit 1개 (§1.5)
         [--defer-srs-mutation <path>]    # kiwi-coder spawn 프롬프트로 그대로 전달 (§1.5)
         [--review-hop-owned-by-parent]   # 인자 없음 — §6.4 hand-off 를 부모가 소유 (§6.4)
         [--no-doculight]                 # doculight MCP 표시 강제 skip
```

**`--auto` 와 `--skip-lifecycle-gate` 동시 사용 금지** — lifecycle gate 의 정책 차단(`deprecated` / `frozen`)은 §0.G7 critical_gates `lifecycle-gate-policy-stop` / `auto-skip-lifecycle-gate-combo` 로 `--auto` 무관 항상 HALT. 두 플래그가 함께 명시되면 HALT + 안내.

### 1.4 산출물

| 산출물 | 시점 | 주체 |
|---|---|---|
| `.kiwi/sessions/{sds_id}/pm-state.json` | 실행 종료 / NEEDS_USER / FAILED / `--resume` 진입 시 갱신 | PM |
| `.kiwi/sessions/{sds_id}/pm.lock` | 시작 시 생성, 종료/HALT 시 삭제 (finally) | PM |
| `.kiwi/sessions/{sds_id}/state.json` | SDS 실행의 TDD 단계 영속 | kiwi-coder (자식) |
| `.kiwi/sessions/{sds_id}/worklog.jsonl` | append-only 이벤트 로그 | PM + 자식 공유 |
| `.kiwi/sessions/{sds_id}/reports/pm-{ts}.md` | T-final 단계 | PM |
| SDS 쓰기 집합 commit 1개 | `--commit-lane-work` 가 있고 실행이 `done` 일 때 (§1.5) | PM |
| speckiwi REQ status `implemented` 승급 | T-final mutation | PM (조건부) |
| speckiwi `add_completed_work(sds-summary)` | T-final mutation | PM |
| doculight viewer 표시 | T-final 보고서 작성 직후 | PM (가용 시) |

### 1.5 오케스트레이션 위임 플래그 (`--session-suffix` / `--no-final` / `--no-pipeline-emit` / `--commit-lane-work` / `--defer-srs-mutation`)

상위 오케스트레이터(`kiwi-orchestrator` · `kiwi-wave-master`)의 워커가 wave 하나의 SDS 를 실행할 때 쓰는 5개 플래그. 단독 실행에는 어느 것도 필요 없고, 명시하지 않으면 본 스킬의 기존 동작이 그대로 유지된다.

#### `--session-suffix <lane>` — 세션 디렉터리 재배치

세션 디렉터리 **전체**를 `.kiwi/sessions/{sds_id}/lanes/{lane}/` 로 옮긴다 — §2.1 의 `pm-state.json` · `pm.lock` · `worklog.jsonl` · `state.json` · `reports/` 다섯 산출물이 **모두** 그 아래로 간다. 일부만 옮기면 공유된 파일 하나가 남고, 그 하나가 곧 race 다.

§3.2 spawn 프롬프트의 **`RUN_ID`** 줄도 같은 재배치를 따른다 — `kiwi-coder` 가 자기 `.kiwi/` 경로를 그 줄에서 도출하므로, 이 줄이 따라가지 않으면 자식이 평면 경로에 쓴다. unit 마다 자기 파일을 갖는다.

#### `--no-final` — T-final 승급 skip

§6.2 T-final 의 **요구 승급을 건너뛴다**(보고서 작성은 그대로). 근거: 한 요구는 여러 unit 에 걸치므로, 한 unit 이 구현한 몫을 `all_done` **분모**로 삼으면 부분 증거로 승급하게 된다. 이 플래그가 있으면 §6.4 hand-off 도 하지 않는다 — 리뷰는 호출자가 돈다.

#### `--no-pipeline-emit` — 자식 파이프라인 기록 억제

- **`--no-pipeline-emit`** — **인자를 받지 않는다**. 명시하면 §10 의 `kiwi/pipeline.jsonl` append 를 수행하지 않는다. 플래그가 **없으면** 기존 emit 동작이 그대로다.
- 오케스트레이터의 실행기는 **매 unit** 실행마다 `--no-pipeline-emit` 을 넘긴다. 빠뜨리면 그 unit 이 **거짓 파이프라인 기록**을 남긴다 — 저널에는 `kiwi-pm` run 하나가 완료한 것으로 보이지만 실제로는 한 wave · 한 stage 의 unit 하나가 끝났을 뿐이고, 그 기록을 부모가 자식 대신 정정하는 것은 허용되지 않는다.
- `kiwi-pipeline` 은 `--no-pipeline-emit` 을 **갖지 않는다** — 오케스트레이션된 unit 이 `kiwi-pipeline` 을 호출하지 않기 때문이다.

#### `--commit-lane-work` — unit 산출물 commit

- **`--commit-lane-work`** — **인자를 받지 않는다**. 같은 호출이 실행하는 합의된 SDS 의 쓰기 집합 — Files 경로와 Test Plan 테스트 파일 — 을 그대로 stage 한다.
- SDS 의 kiwi-coder 실행 하나당 commit 1개를 만든다 — 실행이 `done` 으로 끝났을 때만. stage 대상은 쓰기 집합에서 뽑은 **명시 pathspec** 이며, **작업 트리 전체를 stage 하지 않는다**(`git add -A` 금지) — unit 밖의 미커밋 변경과 오케스트레이터 자신의 상태 파일까지 딸려 들어간다.
- run 좌표(`Orch-Run` · `Orch-Wave` · `Orch-Stage` · `Orch-Lane`)는 git **trailer** 로 싣는다. commit **제목**에는 run 좌표를 **넣지 않는다** — 제목의 단계·진행 표식은 CLAUDE.md §6 이 금지한다.
- **pathspec 파일은 쓰지 않는다**: 오케스트레이터 자신의 상태 디렉터리(`kiwi/orchestrator/`) 아래 경로는 git-ignore 대상이라 격리된 워크스페이스에는 아예 존재하지 않는다. pathspec 은 같은 호출이 실행하는 SDS 에서 와야 한다.
- **플래그를 생략하면** 본 스킬은 **아무것도 commit 하지 않는다**. 그 unit 의 산출물은 **미커밋** 작업 트리로 남고, **다음 unit** 의 실행이 그것을 밟는다. §0.5 의 "PM 은 자동 commit 하지 않는다" 는 이 플래그를 명시하지 않은 경우의 규칙이며, `--commit-lane-work` 가 그 유일한 예외다.

#### `--defer-srs-mutation <path>` — kiwi-coder 로 그대로 전달 (FR-FLOW-121)

`kiwi-pm` 은 이 플래그를 해석하지 않고, 자신이 spawn 하는 `kiwi-coder` 의 프롬프트에 **그대로 전달**한다. 큐 파일을 열지도, 읽지도, 쓰지도 않는다.

전달이 없으면 플래그는 도달하지 않는다 — `kiwi-pm` 이 spawn 을 소유하므로 `kiwi-coder` 만 아는 플래그에는 호출자가 없다. 반대로 `kiwi-coder` 가 읽지 않으면 전달된 값은 버려진다. 두 절반은 따로 랜딩하면 무력하다.

## 2. 상태 관리

### 2.1 디렉토리 SSOT

`.kiwi/sessions/{sds_id}/` — kiwi-coder 의 `.kiwi/` 영역을 공유. `sds_id` 는 SDS 파일 이름에서 `.sds.md` 를 뺀 값이다 (§0.14). PM 이 새 id 를 만들지 않는다.

```
.kiwi/sessions/{sds_id}/
├── pm-state.json           # pm 진행 상태 (본 스킬 소유)
├── pm.lock                 # pm 동시 실행 방지 (본 스킬 소유)
├── state.json              # kiwi-coder 소유 — 자식이 SDS 실행 진행 영속
├── coder.lock              # kiwi-coder 소유 — 자식 자체 lock (이름 분리로 충돌 회피)
├── worklog.jsonl           # 공유 append-only 로그 (PM + 자식)
└── reports/pm-{ts}.md      # 종료 보고서 (PM 소유)
```

자식 `kiwi-coder` 는 자기 영역 (`state.json` / `coder.lock`) 만 수정. PM 은 자기 영역 (`pm-state.json` / `pm.lock` / `reports/`) 만 수정. `worklog.jsonl` 만 양쪽이 append (race 없음 — 실행이 하나다).

### 2.2 pm-state.json 스키마

```json
{
  "run_id": "4.0.0-todo-service",
  "sds_path": "docs/sds/4.0.0-todo-service.sds.md",
  "sds_sha256": "abcdef0123...",
  "target_slug": "4.0.0",
  "req_ids": ["REQ-CORE-001", "REQ-CORE-002"],
  "write_set": ["src/service.ts", "test/service.test.ts"],
  "started_at": "2026-09-27T09:00:00Z",
  "last_updated_at": "2026-09-27T11:30:00Z",
  "pm_version": "0.1",
  "run": {
    "status": "done",
    "started_at": "2026-09-27T09:01:00Z",
    "ended_at": "2026-09-27T09:48:00Z",
    "coder_run_id": "4.0.0-todo-service",
    "result_summary": "테스트 7개 PASS, 구현 완료",
    "changed": true,
    "commit_sha": null,
    "questions": [],
    "attempts": 1
  },
  "last_question": null,
  "last_error": null,
  "lifecycle_gate_state": {
    "evaluated_at": "2026-09-27T09:00:30Z",
    "blocked_req_ids": [],
    "stability_snapshot": {
      "REQ-CORE-001": "evolving",
      "REQ-CORE-002": "stable"
    },
    "status_snapshot": {
      "REQ-CORE-001": "planned",
      "REQ-CORE-002": "in_progress"
    }
  },
  "req_coverage": {},
  "final_mutations": [],
  "pending_mutations": [],
  "report_path": null,
  "doculight_viewer_id": null
}
```

**필드 의미**:

- `sds_path` / `sds_sha256` — 입력 SDS 와 부팅 SHA256 (외부 변경 감지, §5.4 `--resume`)
- `req_ids` — SDS `@req` 집합, `write_set` — SDS 쓰기 집합(Files 경로 ∪ Test Plan 테스트 파일). 둘 다 부팅 시 `check_sds` 요약에서 옮긴다
- `run.status` enum: `pending` | `running` | `done` | `failed` | `blocked`
- `run.changed` — 이번 실행이 쓰기 집합 안에 commit 이나 작업 트리 변경을 남겼는지 (§10 무동작 판정)
- `run.commit_sha` — `--commit-lane-work` 로 만든 commit (§1.5), 없으면 null
- `run.attempts` — sub-agent spawn 횟수 (재spawn 포함). §0.G3/§0.G4 카운터
- `lifecycle_gate_state` — 부팅 T0 평가 결과 캐싱. stability_snapshot 은 부팅 시점의 REQ Stability 스냅샷 (종료 시 drift 감지 가능)
- `req_coverage` — T-final 단계에 채워짐. REQ-ID 별 `{status_at_start, status_at_end, all_done: bool}`
- `final_mutations[]` — T-final mutation 로그. 각 항목: `{ts, kind, req_id, from, to, dry_run, summary?}`
- `pending_mutations[]` — MCP 일시 미가용 / transition guard 거부 등으로 보류된 mutation proposal. 보고서 §4 에 명시 + 사용자 수동 처리 안내
- `report_path` — T-final mutation 호출 전 결정적으로 계산된 종료 보고서 path. `add_completed_work` 의 `reportPaths` 인자에 전달. 실제 파일 작성은 T-final 직후
- `doculight_viewer_id` — doculight `open_markdown` 1회 호출 후 viewer ID 보존 (`--resume` 후속 실행 시 `update_markdown` 으로 재사용)

### 2.3 동시 실행 방지 (pm.lock)

```json
{
  "pid": 12345,
  "started_at": "2026-05-19T09:00:00Z",
  "host": "hostname"
}
```

**부팅 시 동작**:

1. lock 존재 + `started_at` 30분 이내 + 동일 host → "다른 세션 실행 중" HALT. `--force` 로만 해제
2. lock 존재 + 30분 경과 → stale 자동 해제 + 경고 log
3. lock 존재 + 다른 host → 네트워크 파일 시스템 의심, 명시적 차단 (`--force` 필요)
4. lock 없음 → 신규 lock 생성 후 진행

**종료 시 동작** (정상 / HALT / FAILED 무관, finally):
- `pm.lock` 파일 삭제

**kiwi-coder `coder.lock` 과의 분리**: 파일명을 분리하여 PM 과 자식이 서로의 lock 을 잘못 해제하는 일을 방지. 자식 `kiwi-coder` 가 자기 `coder.lock` 만 관리하므로 PM 측은 PM `pm.lock` 만 본다.

`--force` 사용 시: 사용자에게 "lock 강제 해제 — 다른 PM 인스턴스가 실행 중이라면 충돌 위험" 경고를 출력한 뒤 진행 (interactive). `--auto --force` 조합은 허용 (자율 운영 의도).

---

## 3. 메인 루프 + 3상태 프로토콜

### 3.1 실행 의사코드

```
FUNCTION MAIN(args):
    # T-1: 부팅
    sds = LOAD_AND_CHECK_SDS(args.sds_path)      # §7.1 — check_sds (MCP). 위반 시 HALT
    state = LOAD_OR_INIT_STATE(sds)              # --resume 분기 (§5.4)
    ACQUIRE_LOCK(state.run_id, args.force)
    SAVE_STATE(state)

    # T0: lifecycle gate
    IF NOT args.skip_lifecycle_gate:
        APPLY_LIFECYCLE_GATE(sds, state, args)   # §4 — draft/deprecated/frozen 차단

    # T-run: SDS 하나 = kiwi-coder 실행 하나
    IF state.run.status NOT IN {done, failed}:
        state.run.status = "running"; state.run.started_at = NOW(); SAVE_STATE(state)
        user_answers = None
        WHILE True:
            result = SUBAGENT_RUN_KIWI_CODER(sds, state, args, user_answers)
            state.run.attempts += 1
            SWITCH result.status:
              CASE "TASK_DONE":
                state.run.status = "done"
                state.run.result_summary = result.summary
                state.run.coder_run_id = result.coder_run_id
                state.run.ended_at = NOW()
                BREAK
              CASE "NEEDS_USER":
                IF state.run.attempts >= 3 AND Codex clarification gate(§0.G3 2지선다) == "B":
                    state.run.status = "blocked"; state.last_question = result.questions
                    SAVE_STATE(state); RELEASE_LOCK(); RETURN   # 멈춤 — --resume 으로 이어간다
                user_answers = HANDLE_QUESTIONS(result.questions, args)   # §5 — severity 분기
              CASE "FAILED":
                state.last_error = result.error
                IF HANDLE_FAILED(result, args) == "B":              # §0.G4 2지선다
                    state.run.status = "failed"; BREAK
        state.run.changed = WRITE_SET_CHANGED(state.write_set)      # §6.1
        IF args.commit_lane_work AND state.run.status == "done":
            state.run.commit_sha = COMMIT_WRITE_SET(state)          # §1.5
        SAVE_STATE(state)

    # T-final: 종료 마무리 (§6.2 ~ §6.4)
    state.report_path = COMPUTE_REPORT_PATH(state)   # .kiwi/sessions/{sds_id}/reports/pm-{ts}.md
    IF NOT args.no_final AND state.run.status == "done":
        T_FINAL_SRS_MUTATION(state, args)            # update_status implemented + add_completed_work(sds-summary)
    WRITE_REPORT(state)                              # state.report_path 에 8섹션 보고서 작성
    DOCULIGHT_DISPLAY(state.report_path, args, state)
    RELEASE_LOCK()
    EMIT_PIPELINE_EVENT(state, args)                 # §10 — hand-off 앞에 쓴다
    HAND_OFF_REVIEW(state, args)                     # §6.4 — 단독 실행이면 항상
    PRINT_FINAL_SUMMARY(state)
```

### 3.2 서브에이전트 자식 실행 프롬프트

사용 가능한 Codex 서브에이전트 위임 도구로 자식에게 다음 프롬프트를 전달한다. 권장 실행 속성: worker 역할, high reasoning effort (또는 `--model <name>` 로 kiwi-coder 검증 서브에이전트 모델 override).

```
당신은 kiwi-coder 스킬을 실행하는 격리된 서브에이전트입니다.

## INPUTS
- SDS_PATH={args.sds_path}
- RUN_ID={state.run_id}                # .kiwi/sessions/{run_id}/ 영속화에 사용. --session-suffix 지정 시 .kiwi/sessions/{run_id}/lanes/{lane}/ (§1.5)
- TARGET={state.target_slug}           # lifecycle gate 일관성 확인용
- CODE_PATH={args.code_path}
- AUTO={true if args.auto else false}
- LOOP_FLAGS={forward --mini / --loops N round-cap to the kiwi-coder child}
- PASS_THROUGH_FLAGS={부모에게서 명시 입력으로 받은 --auto-cost-warning / --auto-integration / --regression-baseline / --drive / --defer-srs-mutation 을 그대로 재현}
- LIFECYCLE_BLOCKED_REQS={state.lifecycle_gate_state.blocked_req_ids}
- SPAWN_CONTEXT=pm-child   # 이 자식 호출이 PM 자식임을 식별 — args 에도 싣는다. coder 는 이 값으로 §8.4 자동 시작 게이트를 건너뛰고 §3.3 에서 부모의 lifecycle override 를 승계한다
- 이전 NEEDS_USER 답변 (재spawn 시):
{user_answers OR "없음"}

## 실행 지침

**1단계: kiwi-coder 스킬 사용**
Codex skill invocation prose로 `kiwi-coder` 를 사용하라:

```
Use $kiwi-coder with SDS_PATH={args.sds_path} RUN_ID={state.run_id} SPAWN_CONTEXT=pm-child{' --auto' if args.auto else ''}{' --max' if args.max else ''}{' --model ' + args.model if args.model else ''}{LOOP_FLAGS}{PASS_THROUGH_FLAGS}
```

스킬 내용을 추측하거나 우회하지 말 것. 가능한 경우 실제 `kiwi-coder` skill body를 로드하고, 스킬 로딩 기능이 없으면 해당 skill folder의 `SKILL.md`를 직접 읽어 따른다.

**`--auto` 자식 전파**: 본 스킬이 `--auto` 활성 상태에서 `kiwi-coder` 를 실행할 때 자식 args 에 `--auto` 명시 전파 (SSOT auto-option.md §7). 단, kiwi-coder 의 `--yes-all` / `--auto-integration` / `--auto-cost-warning` 3종 옵션은 별개이며 자동 활성하지 않음.

**pass-through 전파**: `--max` 와 `--mini` / `--loops N` (loop-option.md §6), 그리고 부모(`$kiwi-pipeline` / `$kiwi-wave-master`)에게서 **명시 입력으로 받은** `--auto-cost-warning` / `--auto-integration` / `--drive` 는 자식 args 에 그대로 전달한다 — `kiwi-pipeline → kiwi-pm → kiwi-coder` 사슬과 `kiwi-wave-master`/`kiwi-orchestrator` → 워커(`_shared/kiwi/parallel-waves.md` PW-6) → `kiwi-pm` → `kiwi-coder` 사슬에서 중간 홉이 옵션을 떨어뜨리면 kiwi-coder 의 비용 경고 · 통합 테스트 동의 게이트가 무인 실행을 멈춘다. 위 §0.16 원칙은 그대로다 — 본 스킬은 그 3종을 `--auto` 만으로 **스스로 만들어내지 않으며**, 명시 입력을 중계할 뿐이다.

부모가 pin 한 `--regression-baseline <path>` 도 같은 방식으로 자식 args 에 그대로 전달한다 — 중간 홉이 이 값을 떨어뜨리면 kiwi-coder 가 자기 시점 기준선을 다시 캡처해, 앞 실행이 만든 실패가 "원래 있던 실패"로 분류된다.

**2단계: 이 SDS 하나를 구현**
SDS 의 Files 밖 파일을 고치지 않고, SDS 자체도 고치지 않는다 — 설계가 틀렸으면 NEEDS_USER 로 올린다.

**3단계: 중단 조건**
다음 발생 시 즉시 중단하고 아래 JSON 반환:
- 구현 세부 모호성 (severity = clarification)
- 외부 관찰 가능 변경 필요 (severity = business-decision — 의심되면 이쪽으로 상향)
- rollback 실행 승인 필요 (severity = rollback-confirmation)
- 복구 불가 오류 (status = FAILED)

## 절대 금지 사항
- **SDS 수정 금지** — 설계 반증은 NEEDS_USER 로 올린다. 본 자식은 SDS Files 의 코드와 Test Plan 의 테스트 파일만 수정.
- **`/snoworca-*` 호출 금지** — `_shared/snoworca/` 모듈 import 금지 (kiwi 시리즈 독립 운영).
- **JSON 외 텍스트 출력 금지** — 첫 글자 `{`, 마지막 글자 `}`. markdown code fence (```) 금지. 설명 산문 금지.

## 반환 형식 (단일 JSON 객체)

{{
  "status": "TASK_DONE" | "NEEDS_USER" | "FAILED",
  "coder_run_id": "<kiwi-coder 가 쓴 run_id>",
  "summary": "<1~3줄 요약>",

  // NEEDS_USER 시 필수
  "questions": [
    {{
      "id": "Q-001",
      "severity": "clarification | business-decision | rollback-confirmation | critical",
      "gate_id": "<자기 §0.G6 게이트 id — severity=critical 시 필수, 그 외 null>",
      "question": "...",
      "context": "<왜 묻는가 + 근거>",
      "options": [
        // "recommended": opt-in 구조화 boolean. 생략 가능하며 생략 시 false — 필드가 없는 옵션은 권장이 아니다.
        // true 인 옵션은 `--auto` 가 위원회 없이 즉시 채택한다 (`_shared/kiwi/auto-option.md` §3 0단계).
        // 산문으로 적힌 권장 표기는 이 필드가 아니며 기계적 의미가 없다.
        // 어떤 옵션이 왜 권장되는지를 기술하는 필드는 두지 않는다 — 권장 동기를 심사하는 게이트는 본 버전의 범위 밖이다.
        {{ "key": "A", "label": "...", "consequence": "...", "recommended": false }},
        {{ "key": "B", "label": "...", "consequence": "...", "recommended": false }}
      ],
      "default_if_auto": "A | null"  // business-decision 도 critical_gates[] 외에는 auto-option decision worker 대상
    }}
  ],

  // FAILED 시 필수
  "error": {{
    "reason": "<원인 1~2줄>",
    "attempted": ["<시도한 것 1>", "<시도한 것 2>"],
    "suggestion": "retry | rollback-and-halt | user-decision"
  }}
}}
```

### 3.3 자식 내부에서 자체 해결되는 영역 (메인까지 안 올라옴)

kiwi-coder §0.G4 자체 게이트가 처리. PM 무대응:

- TDD red 실패 → kiwi-coder 시니어 코더 재시도
- TDD 검증 finding → kiwi-coder Phase 1.3 개선 루프
- 까칠 코드 리뷰어 finding → kiwi-coder Phase 2.g 개선 루프
- 회귀 테스트 fail → kiwi-coder §0.13 개선 루프
- Mock 검출 (§0.6) → kiwi-coder CRITICAL 자체 차단

이들은 자식 안에서 처리되며 외부에서 보면 단순히 자식 spawn 시간이 길어질 뿐 PM 메인의 NEEDS_USER 인터럽트 없음.

### 3.4 메인까지 올라오는 NEEDS_USER

다음 시점에만 자식이 PM 으로 버블업:

- 외부 모듈 영향 (kiwi-coder §0.G2) — cwd 외부 path 수정 필요 시
- 비즈니스 결정 (severity=business-decision) — UX/API/권한/세션 정책 변경
- MCP mutation guard 위반 (kiwi-coder §0.G5) — backward status 시도 등
- 개선 루프 발산 (kiwi-coder §0.G4) — 시니어 3회 / 리뷰어 2회 / TDD 검증 3회 누적 + 동일 finding 잔존
- 사용자 결정 의무 (kiwi-coder §0.8) — 외부 모듈 / 통합 테스트 / MCP mutation ≥10건 batch / SDS Files 밖 파일 변경
- SDS 반증 — SDS 의 설계가 코드나 SRS 와 맞지 않아 자식이 SDS 를 고쳐야만 진행할 수 있을 때

자식(`kiwi-coder`) 이 자기 §0.G6 게이트로 중단한 경우 그 payload 의 `gate_id` 를 그대로 읽어 **동명**의 §0.G7 게이트로 매핑한다 — severity 로 재분류하지 않는다. 재분류하면 always-HALT 로 선언한 두 보존 게이트가 `business-decision` 기본 분류로 되돌아간다.
§0.G7 에 동명 행이 없는 `gate_id` 는 §0.G7 **자식 선언 승계** 규칙으로 처리한다 — 전사 누락이 곧 자동 승인이 되는 경로를 닫는 잔여 규칙이다.

### 3.5 severity enum + 판단 휴리스틱

| severity | 의미 | 예시 |
|---|---|---|
| `clarification` | 구현 세부의 모호성 해소 | 파일명 camelCase ↔ snake_case, 에러 메시지 문구, 로그 레벨, private 함수 시그니처 |
| `business-decision` | 외부 관찰 가능 동작 변경 | 기존 API 응답 스키마 변경, UX 문구 수정, 권한 정책 변경, 세션 타임아웃 정책, 마이그레이션 호환성 |
| `rollback-confirmation` | 실패 후 rollback 실행 승인 | `git reset --hard HEAD~1`, 부분 커밋 폐기, 직전 mutation 되돌리기 |
| `critical` | 자식이 자기 `critical_gates` 로 선언한 게이트의 버블업 | `existing-public-contract-change` / `existing-test-weakened-or-deleted` / `existing-file-deleted-or-moved` — `--auto` 무관 항상 **HALT** (`auto-option.md` §4 severity 분기 / §0.G7 자식 선언 승계) |

**판단 휴리스틱** (자식이 severity 분류 시 적용):

- **의심되면 business-decision 으로 상향** — clarification 오분류가 `--auto` 자동 처리 위험으로 직결되므로 보수적으로 상향.
- 외부 관찰 가능 (API / UX / 권한 / 세션 / 호환성) → business-decision
- 순수 구현 세부 (naming / 로그 레벨 / 내부 private 함수) → clarification
- 명시적 rollback 키워드 (`git reset` / `revert` / `되돌` / `복구`) → rollback-confirmation
- SDS Files 경로에 `migration` / `schema` / `auth` 경로 토큰 포함 → business-decision 강제 (path 기반 휴리스틱 — SDS Files 목록만 참조)
- 기존 테스트의 **약화·삭제** 버블업은 severity 로 분류하지 않는다 → §0.G7 `existing-test-weakened-or-deleted` 로 always HALT (`references/extended-workflow.md` §5.1) — 회귀 안전망 제거는 decision worker 의 판단 대상이 아니다

### 3.6 Lifecycle gate 차단의 `--auto` 동작

§4 lifecycle gate (`references/extended-workflow.md`) 가 REQ 를 차단했을 때의 `--auto` 분기 SSOT. 무인 실행의 중단 지점을 결정하므로 core map 에 둔다. SDS 하나는 실행 하나라 요구 하나만 떼어 내 진행할 수 없다.

- `draft` 차단 → 이 SDS 를 실행하지 않는다(자식 spawn 없음). 요구 단위 부분 진행은 SDS 범위에서 한다 — `$kiwi-sds` 요구 필터로 draft REQ 를 SDS 범위에서 뺀 SDS 를 다시 쓰게 돌려보낸다
- draft REQ 목록은 skip 목록으로 보고한다 (worklog `lifecycle_skip_per_req`, 보고서 §7). 실행은 `NEEDS_USER` 로 끝나며 사유에 그 목록과 요구 필터 재작성 안내를 싣는다
- skip 된 REQ 는 조용히 사라지지 않는다 — `reason_class = "draft-stability-skip"` 로 종료 보고서 §7 과 부모 wave 검증의 `verification.residual` 에 잔여로 표면화한다
- `deprecated` / `frozen` → 즉시 HALT (정책 위반 / 의도된 제거, §0.G7 `lifecycle-gate-policy-stop`)
- target 비어있음 → HALT
- `--auto --skip-lifecycle-gate` 조합은 §1.3 에서 차단

본 절의 완화는 `draft` 한 종류에 한정한다 — `deprecated` / `frozen` 의 HALT, `--auto` 가 자식의 안전 우회 옵션(`--yes-all` 등)을 자동 생성하지 않는다는 §0.16 원칙, §5.1 의 나머지 예외는 그대로 유지한다.

---


## Extended References

- Read `references/extended-workflow.md` when executing or validating
lifecycle gate, auto/resume handling, run outcome and final SRS status mutations, reporting, the kiwi-review-fix-loop hand-off, and pipeline event emission
.
- Keep `SKILL.md` as the core trigger and workflow map; load the reference file only after the relevant phase is reached.
