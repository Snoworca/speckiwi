# Extended Workflow Reference

This file was split from `SKILL.md` for progressive disclosure. Read it only when the active task needs the detailed phases, schemas, reports, fallback rules, or pipeline event instructions listed below.

## Table of Contents
- 8. Phase 4 — Integrity validation (validator.mjs)
- 8.1 실행
- 8.2 검증 항목 (25개 + R 시리즈 4종, --tdd-policy=disabled 시 C21~C25 + R04 skip)
- 8.3 출력 + exit code
- 9. plan.md 스키마
- 9.1 frontmatter
- 9.2 본문 구조 (heading level SSOT — §0.16)
- §1 개요                                  (h2)
- 1.1 목표                                (h3)
- 1.2 범위 (in_scope[])                   (h3)
- 1.3 제외사항 (out_of_scope[], excluded_reqs 포함)
- 1.4 전제조건 / 가정
- §2 Phase 목록                            (h2)
- §3 Task 상세                             (h2)
- §3.<phase_id>                           (h3, 각 Phase 별 하위 섹션)
- §4 REQ ↔ Task 역색인                     (h2)
- 9.3 acceptance_tests 형식 매트릭스 (확장)
- 9.4 canonical form (C08 hash 입력 SSOT)
- 9.5 mcp_call_log `args` 직렬화 SSOT — sidecar plan 표현과 실 MCP 호출 schema 분리
- 9.6 test_case id 정규식 SSOT (TDD)
- 10. 사이드카 JSON 스키마
- 11. 검증 항목 — §8.2 참조
- 12. 개선 루프 분기 (통합표)
- 13. 다음 단계 결정표 (§12.3 패턴)
- 14. axis enum — §6.3 참조
- 15. 옵션 매핑 — §1.2 참조
- 16. 보고 채널
- 16.1 1차: doculight
- 16.2 fallback 순차
- 16.3 보고 본문 항목
- 17. Pipeline event emit (의무)

---

## 8. Phase 4 — Integrity validation (validator.mjs)

### 8.1 실행

```
node ../scripts/validator.mjs \
  docs/plans/{run-id}.plan.md \
  docs/plans/{run-id}.sidecar.json \
  --target {TARGET} \
  --inventory-file docs/analysis/kiwi-planner-{run-id}/inventory.json \
  --out docs/plans/{run-id}.validator.json \
  [--check-files] \
  [--dry-run]
```

**inventory-file 필수**. 부모(메인 세션)가 Phase 0.2 에서 `list_requirements` 결과를 `inventory.json` 으로 dump 한다. 형식:

```json
[
  { "id": "FR-TODO-001", "stability": "evolving", "ac_total": 3, "ac_ids": ["AC-1","AC-2","AC-3"] },
  ...
]
```

### 8.2 검증 항목 (25개 + R 시리즈 4종, --tdd-policy=disabled 시 C21~C25 + R04 skip)

| # | 항목 | severity |
|---|---|---|
| C01 | 사이드카 JSON parse | ERROR |
| C02 | plan.md frontmatter 필수 필드 (run_id, target, plan_version, plan_contract, generated_at, tool_versions, sidecar_path) | ERROR |
| C03 | phase.id 유일성 + task.id 유일성 + trace_link.link_id 유일성 (사이드카 전역) | ERROR |
| C04 | task.phase_id ∈ phases[].id **양방향** — phase.task_ids 와 task 집합 multiset 동등 | ERROR |
| C05 | task.req_ids ⊆ inventory(target) (deprecated 제외). **inventory 미제공 시 ERROR** (skipped 아님) | ERROR |
| C06 | plan.md §2 phase 수 == sidecar.phases.length (table 첫 번째 표 본문 행만 카운트) | ERROR |
| C07 | plan.md §3 task 수 == sidecar.tasks.length (h4 정확 매칭) | ERROR |
| C08 | plan.md 각 task 표현 == sidecar 필드 — **canonical form 정규화 후** hash 비교 (title trim, type 소문자, req_ids sort, files sort by path:line_range) | ERROR |
| C09 | coverage[]: ac_covered + missing_ac_ids.length == ac_total, 모든 필드 비음수 + 정수 | ERROR |
| C10 | orphans: 0=OK / 1-2=WARN / ≥3=ERROR | WARN/ERROR |
| C11 | unreferenced_reqs (deprecated 제외) ≥1 = ERROR | ERROR |
| C12 | acceptance_tests.kind ↔ task.type 정합 (§9.3 표) | ERROR |
| C13 | verification_cmd: `null` 또는 `{posix: non-empty, windows: non-empty}` 둘 중 하나. 빈 문자열·한쪽만 정의 금지 | ERROR |
| C14 | trace_links[].target.reference ⊆ task.req_ids (target.type=Requirement 만, Code 타입 제외) | ERROR |
| C15 | mcp_call_log multiset 정합 (§9.5 (가) SSOT): `add_trace_link` entry 의 nested key `(source.id, target.type, target.reference)` multiset == Σ tasks[].trace_links 의 `(source.id, target.type, target.reference)` multiset. + `add_verification_evidence` entry 의 `args.id` multiset == coverage 의 req_id 집합 (flat) | ERROR |
| C16 | phase.depends_on DAG (순환 금지) | ERROR |
| C17 | (선택, `--check-files` 시) task.files[].path 실재 존재 + line_range 유효 (파일 라인 수 이하) | ERROR |
| C18 | plan_contract enum: `["1.1.0", "1.2.0"]` 외 값 거부 (dual-accept) | ERROR |
| C19 | (`--dry-run` 시) mcp_call_log 모든 entry 에 `dry_run: true` | ERROR |
| C20 | plan.fm.sidecar_path 가 실제 입력 sidecar 경로와 일치 (canonical path 비교) | WARN |
| C21 | (`--tdd-policy ≠ disabled`) `type=code` Task 는 `tdd` 필드 필수. `tdd.applicable=true` 면 `tdd.test_cases.length ≥ 1` AND `tdd.phase ∈ {red,green,refactor}`. `applicable=false` 면 `tdd.phase = "n/a"` 강제 | ERROR |
| C22 | (`--tdd-policy ≠ disabled`) `type ∈ {code, perf_test, infra}` Task 가 `tdd.applicable=false` 이면 `tdd.exempt_reason` 길이 ≥ 20자. 자동 면제 type (doc/file_op/issue/pr/review) 은 reason 강제 X | ERROR |
| C23 | (`--tdd-policy ≠ disabled`) 각 `tdd.test_cases[]` 에 대해 `req_id ∈ task.req_ids` AND `ac_refs[] ⊆ inventory(test_case.req_id).ac_ids` (test_case 단위 명시적 매칭, ambiguity 제거) | ERROR |
| C24 | (`--tdd-policy ≠ disabled`) Task-level `depends_on_task` 그래프 DAG (순환 금지, 정규화된 cycle 중복 제거) + 참조 무결성 (모두 sidecar.tasks[].id) | ERROR |
| C25 | (`--tdd-policy ≠ disabled`) `green_evidence ≠ null` 이면 `red_evidence ≠ null` 그리고 `red_evidence.exit_code ≠ 0` (red 는 실제로 실패해야 함). `--tdd-policy=strict` 시 ERROR, `relaxed` 시 WARN | WARN/ERROR |

추가 정규식 (ERROR, R 시리즈):
- R01 run_id ∈ `[a-z0-9.-]{4,40}`
- R02 phase.id ∈ `^PH-\d{3}$`, max 999개
- R03 task.id ∈ `^T-PH\d{3}-\d{2}$`, Phase당 max 99개
- R04 test_case.id ∈ `^TC-REQ-[A-Z][A-Z0-9-]*-AC\d+-\d{2}$` — `--tdd-policy ≠ disabled` 시 ERROR. 예: `TC-REQ-KP-TEST-001-AC2-01`

### 8.3 출력 + exit code

JSON 보고서 `validator.json`. exit code: `0`=pass / `1`=warn-only / `2`=error.

---

## 9. plan.md 스키마

### 9.1 frontmatter

```yaml
---
run_id: 2026-05-18.skf.v01
target: skf-v0.1
plan_version: 0.1.0
plan_contract: "1.2.0"
generated_at: 2026-05-18T03:54:41Z
tool_versions:
  speckiwi: 2.2.3
  kiwi_planner: 0.6.0
  validator: 0.6.0
stability_summary:
  frozen: 0
  stable: 3
  evolving: 7
  draft: 0
tdd_policy: relaxed
sidecar_path: ./2026-05-18.skf.v01.sidecar.json
md_sha256: <자동 계산>
---
```

### 9.2 본문 구조 (heading level SSOT — §0.16)

```
## §1 개요                                  (h2)
### 1.1 목표                                (h3)
### 1.2 범위 (in_scope[])                   (h3)
### 1.3 제외사항 (out_of_scope[], excluded_reqs 포함)
### 1.4 전제조건 / 가정

## §2 Phase 목록                            (h2)
  표 (단일 표만 허용. 첫 두 행 = 헤더 + separator, 본문 행만 카운트):
  | phase_id | title | goal | depends_on | task_count |

## §3 Task 상세                             (h2)
### §3.<phase_id>                           (h3, 각 Phase 별 하위 섹션)
#### §3.<phase_id>.<task_id>                (h4, validator 가 정확 매칭)
    필드 형식 — 각 필드 1줄, key: value (canonical form):
    - id: T-PH001-01
    - phase_id: PH-001
    - title: <한 줄>
    - type: code|doc|file_op|issue|pr|perf_test|infra|review
    - req_ids: [FR-A, FR-B]            (정렬된 콤마+공백 구분 리스트)
    - files: [src/x.ts:45-67, docs/y.md]   (path:line_range, 정렬)
    - action: <자연어 + 코드 변경 시 시그니처>
    - acceptance_tests: <상세 하위 블록 또는 JSON inline>
    - verification_cmd: {posix: ..., windows: ...} 또는 null
    - dod: <체크리스트>
    - rollback: <한두 줄>
    - estimated_effort: S|M|L
    - depends_on_task: [T-PH001-01]    (선택, TDD 페어/순서 표현)
    - covers_ac: [AC-1, AC-2]          (선택, TDD 분해 시 페어 대상 AC)
    - tdd: {applicable, phase, test_cases_count, exempt_reason?}  (inline 요약 — 상세는 사이드카)

## §4 REQ ↔ Task 역색인                     (h2)

§4 REQ ↔ Task 역색인 표
  | req_id | stability | task_ids[] | ac_covered/ac_total |

§5 위험 · 미해결
  5.1 위험 (risk_id, severity, mitigation, affected_task_ids)
  5.2 Open Questions (id, question, blocks_task_ids)
  5.3 unreferenced_reqs (deprecated 외 미커버 REQ)
  5.4 deferred_ac (§0.G4 accept-as-deferred 결정 기록)
  5.5 TDD 결정 (§0.G7 accept-as-exempt 또는 add-test-task 결정 요약; user_decision_id + sidecar.tdd_decisions[] 참조)

§6 부록
  6.1 사이드카 JSON 경로 / md_sha256
  6.2 검증 스크립트 실행 방법
  6.3 mcp_call_log 요약 (호출 수 / mutation 수)
```

### 9.3 acceptance_tests 형식 매트릭스 (확장)

| task.type | 허용 kind (≥1 필수) |
|---|---|
| code | `shell`, `http`, `perf`, `checklist` (단순 주석/문서 코멘트만 변경 시) |
| doc | `checklist`, `file_state` |
| file_op | `file_state`, `shell` |
| issue | `checklist` (issue URL 포함 권장) |
| pr | `checklist` (PR URL + CI 통과 항목), `file_state` |
| perf_test | `perf`, `shell` |
| infra | `shell`, `file_state`, `http` (헬스체크) |
| review | `checklist` |

acceptance_tests 가 빈 배열이면 ERROR. 각 entry 는 `kind` 필드 필수.

### 9.4 canonical form (C08 hash 입력 SSOT)

Task md ↔ sidecar 비교 시 사용되는 직렬화 규칙:
- **입력 허용 형식 (md)**: `req_ids` 와 `files` 는 `[a, b, c]` (공백 포함 콤마 구분) 또는 `[a,b,c]` 둘 다 허용. md 작성자는 가독성을 위해 공백을 자유롭게 사용 가능.
- **canonical 정규화** (양쪽 동일 적용):
  - `title` = `trim()`
  - `type` = `toLowerCase()`
  - `req_ids` = `[...new Set(entries.map(s => s.trim()))]` → 알파벳 정렬 → `,` (공백 없음) join
  - `files` = 각 entry `{path}:{line_range}` 단일 문자열로 평탄화 (line_range 부재 시 path만), `[...new Set(...).map(trim)]` → 알파벳 정렬 → `,` join
  - **files 표기 SSOT**: sidecar 의 `{path, line_range}` 객체는 평탄화 시 `path:line_range` (line_range 부재 시 path 단독) 단일 형식
- **hash 입력** = `{task_id}|{title}|{type}|{req_ids_joined}|{files_joined}`
- **algorithm** = sha1 hex digest (소문자 40자)

md 와 sidecar 양쪽 모두 위 정규화로 동일 입력 생성 후 hash 비교. **공백·중복·순서 차이는 모두 같은 hash 생성**.

### 9.5 mcp_call_log `args` 직렬화 SSOT — sidecar plan 표현과 실 MCP 호출 schema 분리

**중요 — 두 가지 다른 표현이 존재한다**:

(가) **sidecar `mcp_call_log[].args`** — plan 단계 sidecar 내부 표현. `sidecar.tasks[].trace_links[]` 와 **동일한 nested schema** 사용 (validator C15 multiset 비교를 위한 의도된 dual representation). 호출 인자 원본이 아님.

(나) **실 MCP 호출 args** — kiwi-coder §6.2 가 mutation 시점에 speckiwi MCP 로 전달하는 인자. speckiwi MCP 실 schema 는 **flat** (`{id, type, reference, relation}`).

planner 본 스킬은 (가) 만 다룬다. (나) 평탄화는 kiwi-coder §6.2 의 책임.

**(가) sidecar mcp_call_log nested schema (validator C15 SSOT)**:

| call | nested args 필수 필드 | C15 multiset key |
|---|---|---|
| `add_trace_link` | `{ source: {type, id}, target: {type, reference}, relation }` | `{source.id}|{target.type}|{target.reference}` |
| `add_verification_evidence` | `{ id, type, reference }` (flat — verification_evidence 는 nested 가 아님) | `{id}` |

- `add_trace_link.source.id` = Task ID (sidecar.tasks[].id 와 동일). `target.type` ∈ {"Requirement", "Code", "Task", "Doc"}. `target.reference` = REQ id 또는 path:line_range.
- `add_verification_evidence` 는 verification 1건이 REQ 1개와 1:1 매핑되므로 sidecar 단에서도 flat 으로 충분.
- `add_trace_link` entry 는 `sidecar.tasks[].trace_links[]` 와 multiset (count 동일) 일치 필수 (C15).
- `add_verification_evidence` entry 의 `args.id` 집합 = `sidecar.coverage[].req_id` 집합 (uniq 후 동일) (C15).
- `args_hash` 는 멱등 dedupe 전용 보조 필드.

**(나) 실 MCP 호출 flat schema (kiwi-coder §6.2 가 평탄화 후 호출)**:

| call | flat args (speckiwi MCP 실 schema) |
|---|---|
| `add_trace_link` | `{ id, type, reference, relation }` (`notes` 선택) — `id` = REQ id, `type` = target type, `reference` = target reference |
| `add_verification_evidence` | `{ id, type, reference }` (`covers, notes` 선택) |
| `update_status` | `{ id, status }` |
| `add_completed_work` | `{ date, summary, [requirementIds, target, scope, reportPaths, allowIncomplete, dryRun] }` |

**sidecar nested ↔ 실 MCP flat 변환 매핑** (kiwi-coder §6.2 가 mutation 호출 시 적용):

| sidecar `mcp_call_log[].args` 또는 `tasks[].trace_links[i]` (nested) | 실 MCP `add_trace_link` args (flat) |
|---|---|
| `source: {type: "Task", id: "T-PHnnn-mm"}` | (메타. flat args 에는 직접 매핑되지 않음 — Task 단계 traceability 는 별도 add_trace_link 호출로 처리 가능) |
| `target: {type: "Requirement", reference: "REQ-X-001"}` | `id: "REQ-X-001"`, `type: <task type 또는 "Code">`, `reference: <task.files[].path:line_range 또는 source.id>` |
| `target: {type: "Code", reference: "src/x.ts:45-67"}` | `id: <task.req_ids 의 한 REQ>`, `type: "Code"`, `reference: "src/x.ts:45-67"` |
| `relation` | `relation` |

즉 sidecar 의 nested 표현은 plan 작성 / validator 검증 / 사람 가독성을 위한 SSOT 표현이고, 실 MCP 호출은 kiwi-coder 가 (나) flat schema 로 평탄화해 호출한다.

### 9.6 test_case id 정규식 SSOT (TDD)

`tasks[].tdd.test_cases[].id` 는 다음 패턴 (validator R04):

```
^TC-REQ-([A-Z][A-Z0-9-]*)-AC(\d+)-(\d{2})$
```

- prefix `TC-REQ-` 고정 (literal)
- **capture (1)** = REQ id 부분. task.req_ids 의 entry 와 정확히 일치해야 함 (C23 매칭 기준). 예: req_ids 가 `FR-KP-TEST-001` 이면 capture(1) = `FR-KP-TEST-001` → id 전체는 `TC-REQ-FR-KP-TEST-001-AC2-01`
- **capture (2)** = AC 번호 (1자리 이상)
- **capture (3)** = seq 2자리 zero-pad (정렬 안정성)

예: req_ids=[`FR-KP-TEST-001`] 일 때 → `TC-REQ-FR-KP-TEST-001-AC2-01`. cross-cutting (여러 AC 검증) 시 primary AC 를 id 에 박고 나머지는 `ac_refs[]` 에 추가 등재.

`test_case.id` 는 사이드카 전역에서 유일 (validator R04 + C25 보조).

---

## 10. 사이드카 JSON 스키마

```ts
interface PlanSidecar {
  schema_version: "1.0.0" | "1.1.0";    // 1.1.0 = TDD 필드 포함 (v0.6+). 매핑: 1.0.0 ⇔ plan_contract 1.1.0, 1.1.0 ⇔ plan_contract 1.2.0
  plan_contract: "1.1.0" | "1.2.0";     // 1.2.0 = TDD 필드 포함. dual-accept (§0.15)
  run_id: string;
  target: string;
  plan_version: string;
  generated_at: string;          // ISO-8601 UTC
  tool_versions: { speckiwi: string; kiwi_planner: string; validator: string; };
  tdd_policy?: "strict" | "relaxed" | "disabled";  // plan_contract=1.2.0 시 필수, 1.1.0 시 optional (default 'disabled')
  md_path: string;
  md_sha256: string;

  phases: Phase[];
  tasks: Task[];
  coverage: Coverage[];
  orphans: Orphan[];
  unreferenced_reqs: UnreferencedReq[];
  excluded_reqs: ExcludedReq[];   // deprecated / §0.G3 exclude-draft 기록
  deferred_ac: DeferredAc[];      // §0.G4 accept-as-deferred 기록
  risks: Risk[];
  open_questions: OpenQuestion[];
  external_module_impact: ExternalImpact[];  // §0.G2 기록
  tdd_decisions: TddDecision[];   // §0.G7 결정 기록 (v0.6+)
  coder_handoff_readiness: CoderHandoffReadiness[];  // $kiwi-coder 인계 신호 (v0.6+)
  mcp_call_log: McpCall[];
}

interface Phase { id: string; title: string; goal: string; depends_on: string[]; task_ids: string[]; }

type TaskType = "code"|"doc"|"file_op"|"issue"|"pr"|"perf_test"|"infra"|"review";

interface Task {
  id: string; phase_id: string; title: string; type: TaskType;
  req_ids: string[];
  files: Array<{ path: string; line_range?: string }>;
  action: string;
  acceptance_tests: AcTest[];
  verification_cmd: { posix: string; windows: string; cwd?: string } | null;
  dod: string[];
  rollback: string;
  trace_links: TraceLink[];
  estimated_effort?: "S"|"M"|"L";
  needs_clarification?: Array<{ slug: string; question: string; blocks_task: boolean;
                                auto_severity: "clarification"|"business-decision"|"rollback-confirmation" }>;
  // === v0.6+ TDD 필드 (additive) ===
  tdd?: TaskTdd;                  // tdd_policy=disabled 시 모든 type 에서 optional. tdd_policy ≠ disabled 시 type=code 는 필수 (C21 ERROR)
  test_files?: Array<{ path: string; line_range?: string }>;  // 테스트 파일 (impl files[] 와 분리)
  depends_on_task?: string[];     // Task ID 배열. 동일 phase 내 선후. §0.G8 / validator C24
  covers_ac?: string[];           // 이 Task 가 다루는 AC ID (TDD 페어 분해 시)
}

interface TaskTdd {
  applicable: boolean;            // false 이면 exempt_reason 필수 (validator C22)
  exempt_reason?: string;         // 자유 텍스트 ≥20자 (C22)
  phase: "red"|"green"|"refactor"|"n/a";
  test_cases: TestCase[];         // applicable=true 면 ≥1 (C21). 면제 시 []
  red_evidence?:   RedEvidence | null;   // planner 는 null slot 만 예약, $kiwi-coder 가 채움
  green_evidence?: GreenEvidence | null;
}

interface TestCase {
  id: string;                     // §9.6 정규식 SSOT: ^TC-REQ-...-AC\d+-\d{2}$
  req_id: string;                 // 이 case 의 primary REQ. task.req_ids 에 포함되어야 함 (C23 매칭 기준)
  ac_refs: string[];              // 이 case 가 검증하는 AC id (cross-cutting 허용 — 모두 req_id 의 ac_ids 에 속해야 함)
  test_file: string;              // path (test_files[] 와 일관)
  test_symbol?: string;           // function / describe 이름
  kind: "unit"|"integration"|"e2e"|"contract"|"property";
  expected_failure_signature?: string;  // red 단계 기대 실패 메시지 regex
}
interface RedEvidence   { command: string; exit_code: number; captured_failure: string; timestamp: string; }
interface GreenEvidence { command: string; exit_code: number; timestamp: string; }

interface TddDecision {
  task_id: string;
  decision: "add-test-task"|"accept-as-exempt"|"block";
  reason?: string;                // accept-as-exempt 시 ≥20자
  user_decision_id: string;       // Codex clarification gate 응답 식별자
  decided_at: string;             // ISO-8601
  spawned_test_task_id?: string;  // add-test-task 결정 시 생성된 T-test Task ID
}

interface CoderHandoffReadiness {
  phase_id: string;
  ready: boolean;                 // false 면 blockers[] 가 비어있지 않음
  blockers: string[];             // e.g. ["tdd_decision_pending:T-PH001-02", "tdd_test_cases_missing:T-PH001-03"]
}

type AcTest =
  | { kind: "shell";    cmd: string; expected_exit: number; stdout_regex?: string }
  | { kind: "checklist"; items: string[] }
  | { kind: "file_state"; path: string; exists: boolean; sha256?: string }
  | { kind: "http";      method: string; url: string; expected_status: number }
  | { kind: "perf";      metric: string; threshold: string; tool: string };

interface Coverage {
  req_id: string;            // unique key — coverage 배열에서 req_id 중복 금지
  stability: string;
  ac_total: number;
  ac_covered: number;
  missing_ac_ids: string[];
  covered_tasks: string[];
  // === v0.6+ ===
  ac_test_map?: Array<{      // AC ↔ test_case 매핑 (test_case-level 커버리지 SSOT, A12 검증 기반)
    ac_id: string;
    test_case_ids: string[]; // tasks[].tdd.test_cases[].id 참조. 0 개면 missing_ac_ids 에 포함되어야 함
  }>;
}

interface Orphan { task_id: string; reason: string; }
interface UnreferencedReq { req_id: string; stability: string; reason: string; }
interface ExcludedReq { req_id: string; stability: string; reason: string; }
interface DeferredAc { req_id: string; ac_id: string; reason: string; user_decision_id: string; }
interface Risk { id: string; severity: "low"|"med"|"high"|"critical";
                 description: string; mitigation: string; affected_task_ids: string[]; }
interface OpenQuestion { id: string; question: string; blocks_task_ids: string[]; }
interface ExternalImpact { path: string; source: "files"|"trace"|"code_context"; user_decision: string; }

interface TraceLink {
  link_id: string;           // required, unique across sidecar. validator C03 에서 누락·중복 모두 ERROR
  source: { type: "Task"; id: string };
  target: { type: "Requirement"|"Code"; reference: string };
  relation: string;
  trace_intent?: "verifies"|"addition_site"|"negative";
}

interface McpCall {
  seq: number;
  call: string;             // "add_trace_link"|"add_verification_evidence"|...
  args: object;             // sidecar 내부 nested schema (§9.5 (가)) — add_trace_link: {source:{type,id}, target:{type,reference}, relation, [notes]}, add_verification_evidence: {id, type, reference, [covers, notes]}. 실 MCP 호출 인자는 §9.5 (나) flat — kiwi-coder §6.2 가 평탄화.
  args_hash: string;        // sha1(call|canonicalJson(args)). 멱등 dedupe 용
  response_hash: string | null;
  timestamp: string;        // ISO-8601
  ok: boolean | null;       // dry-run 일 때 null
  dry_run?: boolean;        // dry-run 모드 entry 표시
}
```

---

## 11. 검증 항목 — §8.2 참조

(중복 회피, §8 에서 정의)

---

## 12. 개선 루프 분기 (통합표)

| 실패 분류 | 분기 | 비고 |
|---|---|---|
| 평가자 CRITICAL/HIGH (A1·A2·A3·A4·A5·A7) | 작성자 재호출 | 상한 3회 |
| 평가자 MEDIUM (A6·A8·A10) | 작성자 재호출 1회 후 사용자 confirm | |
| 평가자 LOW (A9) | 사이드카 기록 후 진행 | 보고에 잔존 표시 |
| validator C01-04, C06-09, C12-15 | 작성자 재호출 | 형식·동기화 오류 |
| validator C15 (mcp_call_log mismatch) | 작성자 재호출 + replay | 2회 잔존 시 §0.G5 발동 |
| validator C05 (req 미존재) | 평가자 재호출 | 사실 검증 필요 |
| validator C10 (orphan ≥3) | 평가자 재호출 | "정당성 있는가" 판단 |
| validator C11 (unreferenced ≥1, non-deprecated) | 평가자 재호출 | "의도적 제외인가" 판단 |
| **validator C21·C22·C23·C24 (TDD ERROR)** | 작성자 재호출 | A11·A12·A13 와 짝. 형식·schema 오류 |
| **validator R04 (test_case.id 형식)** | 작성자 재호출 | 정규식 위반 |
| **validator C25 (red→green 논리)** | strict=작성자 재호출 / relaxed=사이드카 기록 후 진행 | $kiwi-coder 단계에서 채워지므로 plan-time 에는 WARN |
| 동일 finding 2 라운드 연속 잔존 | 사용자 알림 (Codex clarification gate) | §0.G5 |

---

## 13. 다음 단계 결정표 (§12.3 패턴)

Phase 5 보고 시 plan 의 상태에 따라 도출. 자동 chain 호출 금지 — 사용자에게 권고만 표시. 권고 ≤6개, 우선순위 A 항목은 ⚠️ 마커.

| 우선 | 조건 | 권고 |
|---|---|---|
| A ⚠️ | CRITICAL/HIGH 잔존 | "계획 재검토 필요 — 결정적 결함 잔존" |
| A ⚠️ | validator exit=2 | "validator FAIL — 사이드카 정합성 회복 후 재실행" |
| A ⚠️ | unreferenced_reqs (non-deprecated) ≥1 | "REQ 누락 — 사용자 결정 또는 Phase 2 재spawn" |
| A ⚠️ | external_module_impact 미해결 | "외부 모듈 결정 대기" |
| A ⚠️ | A12 (test_ac_coverage) CRITICAL 잔존 | "test_case 가 frozen/stable AC 미커버 — Phase 2 재spawn 필수" |
| A ⚠️ | §0.G7 `block` 결정 잔존 (tdd_decisions) | "TDD 면제 결정 대기 — 사용자 응답 필요" |
| B | draft REQ 가 plan 에 포함됨 | "$kiwi-srs-feasibility 로 Stability 확정 권장 (해당 스킬이 `update_stability` 호출, 본 스킬은 권한 없음)" |
| B | feasibility_hint 가 `low|unknown` 인 REQ 존재 | "$kiwi-srs-feasibility --req-id ... 로 평가 권장. 모호 부분은 `$kiwi-srs-research --req-id ...` 선행 가능" |
| B | tdd_decisions[].decision == accept-as-exempt ≥1 | "면제 Task 존재 — $kiwi-coder 가 대체 검증증거(integration test / manual checklist) 작성 필요" |
| C | Stability=evolving REQ 의 plan 통과 | "$kiwi-coder 로 구현 진행 가능 (해당 스킬이 `update_status` 호출, red→green 증명도 coder 책임)" |
| C | Stability=stable + feasibility=high REQ | "$kiwi-coder 우선 대상" |
| C | open_questions ≥1 | "사용자 답변 후 Phase 2 재spawn" |
| C | deferred_ac ≥1 | "추후 라운드에서 미커버 AC 재검토" |
| C | A13 (tdd_exemption_justification) MEDIUM 잔존 | "면제 사유 약함 — $kiwi-coder 진입 전 보강 권장" |
| D | 위 모두 미해당 + LOW 잔존 | "계획 확정 — 구현 진행 가능. LOW 잔존은 보고 참조" |

---

## 14. axis enum — §6.3 참조

(중복 회피, §6 에서 정의)

---

## 15. 옵션 매핑 — §1.2 참조

(중복 회피, §1.2 에서 정의)

---

## 16. 보고 채널

### 16.1 1차: doculight

- `open_markdown` 으로 plan.md viewer 오픈
- 사용자 메시지에 viewer URL + 검증 요약 (3-5 라인)

### 16.2 fallback 순차

doculight MCP 부재 시:

| 우선 | 채널 | 동작 |
|---|---|---|
| 1 | doculight `update_markdown` (이미 열린 viewer 갱신) | 재오픈 대신 갱신 |
| 2 | telegram MCP (`send_telegram_markdown`) | plan.md 요약 + 경로 |
| 3 | google-chat (`send_google_chat_markdown`) | 동일 |
| 4 | path-only | 사용자 메시지에 plan.md 절대경로 + 검증 보고 경로 |

`--report-channel` 인자로 1차 채널 강제 가능.

### 16.3 보고 본문 항목

- run_id / target / plan_version
- phase 수 / task 수 / coverage% / orphan 수 / unreferenced 수
- validator exit code + 주요 findings 3건
- §13 다음 단계 권고 ≤6개

---

## 17. Pipeline event emit (의무)

`../../_shared/kiwi/pipeline-event.md` v1.0.0 의 §2 schema 와 §5 emit 패턴을 따라 본 스킬 1회 실행 종료 직전 `./kiwi/pipeline.jsonl` 에 정확히 1줄 append. 멱등성: 동일 `run_id` 의 이벤트가 이미 존재하면 skip.

- `skill`: `"kiwi-planner"`
- `status`: plan 확정 + mutation 완료 = `TASK_DONE`; plan freeze (G5 발산) = `NEEDS_USER`; 실패 = `FAILED`; dry-run = `DRY_RUN`
- `next_hint`: 통상 `"kiwi-pm"` (plan 자동 실행 권장). plan 이 단일 Task 인 경우 `"kiwi-coder"` 직행 가능
- `req_ids`: plan 의 coverage[].req_id 합집합
- `artifacts.plan_file`: `docs/plans/{run-id}.plan.md`
- `artifacts.sidecar_file`: `docs/plans/{run-id}.sidecar.json`
- `artifacts.analysis_dir`: `docs/analysis/kiwi-planner-{run-id}/`
- `notes`: phase 수 / task 수 / coverage% / validator exit code 권장

emit 실패는 best-effort.
