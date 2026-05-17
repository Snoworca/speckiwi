---
plan_id: "v2.2.1-update-stability"
plan_contract: "1.1.0"
target: "v2.2.1"
spec_path: "docs/spec/00.index.md"
req_ids: ["FR-PARSE-017", "FR-MCP-017", "IR-CLI-026"]
code_path: "src"
generated_at: "2026-05-15"
mode: "normal"
scope_freeze: true
change_log: []
---

# v2.2.1 — update_stability mutation 구현 계획

## 1. 개요

SpecKiwi v2.2.1 patch target 에서 FR-PARSE-017 / FR-MCP-017 / IR-CLI-026 를 구현하여, FR-PARSE-015 가 정의한 Stability lifecycle (`draft`/`evolving`/`stable`/`frozen`/`deprecated`) 의 mutation trigger 를 제공한다.

**구현 가능성**: High. 기존 `update-status.ts` (commit `843b9a7`) 패턴이 §30.1 [DISCARDED] marker auto-apply 의 동형 구현체로 존재하며, `heading-render.ts` + `block-scanner.ts` 가 **이미 DRAFT marker variant 를 render/parse** 한다 (`src/core/parser/heading-render.ts:17-34`, `src/core/parser/block-scanner.ts:8-37`). 따라서 신규 작업의 대부분은 mutation core 와 MCP/CLI 노출이며, parser 측 변경은 없다.

**Phase 구성**:
- Phase 1 — Core mutation (`src/core/mutation/update-stability.ts` 신설 + transition validator)
- Phase 2 — MCP tool 노출 (`mcp/server.ts` + `mcp/tools/mutation-tools.ts`)
- Phase 3 — CLI 명령 노출 (`cli/commands/mutations.ts`)
- Phase 4 — Release governance (REQ verified 전환, evidence, Target Map released)

## 2. 선행 조건 및 전제

- 현재 active target: `v2.2.1`
- Phase 1 PR (8a54264 ~ 151735e, v2.2.0 marker policy line) merge 완료 상태에서 시작
- `npm install` 완료, `node >= 22`
- `npm run build` / `npx vitest` 정상 동작
- SRS-MD-Rules v1.1.0 §30.2 본문 정정 (`Status=draft` → `Stability=draft`) 은 Phase 1 TASK-P1-005 에 포함

## 3. 프로젝트 온보딩 컨텍스트

- **이 프로젝트는?** SpecKiwi 는 Git-tracked Markdown SRS 문서를 요구사항 SSOT 로 사용하는 로컬-우선 도구다. CLI 와 stdio MCP server 두 인터페이스를 공통 core 위에서 제공한다.
- **주요 디렉토리 맵**:
  - `src/core/mutation/` — Markdown line-patch mutation core (update-status, add-requirement 등)
  - `src/core/parser/` — heading / metadata / acceptance criteria parser + heading-render
  - `src/core/patch/` — SHA256 snapshot stale-check + tmp+rename atomic write
  - `src/mcp/` — stdio MCP server, tool schemas + handlers
  - `src/cli/` — commander 기반 CLI, 서브커맨드 등록
  - `docs/spec/` — SRS Markdown (SSOT)
  - `docs/rule/` — SRS-MD-Rules
- **핵심 규칙**:
  - 모든 mutation 은 **SHA256 snapshot stale-check + atomic apply-patch** 트랜잭션. `applyPatchPlan` 만 사용.
  - mutation 1회 호출 = Markdown line-patch 1회. `Edit` 도구 직접 사용 금지.
  - `update-status.ts` 의 helper 재사용: `findMetadataLine`, `findSectionTableInsertionLine`, `loadRecordWithWorkspace`, `mutationOk`, `mutationFail`.
  - TDD 의무 — failing test 먼저, 그 후 구현.
  - 시그니처 차단 (`Co-Authored-By:` 등) — commit 메시지 절대 금지.
- **빌드·테스트 치트시트**:
  ```bash
  npm run build         # tsc -p tsconfig.json
  npm run typecheck     # tsc --noEmit
  npm run lint          # eslint src test --max-warnings=0
  npx vitest run test/core/mutation/<file> --no-file-parallelism
  npx vitest run --no-file-parallelism                          # 전체
  ```
- **참고 문서**: `CLAUDE.md`, `AGENTS.md`, `docs/rule/SRS-MD-Rules-v1.1.0.md`, `docs/spec/00.index.md`.

## 4. AI 에이전트 실행 가드

### 4.1 scope_freeze

```yaml
scope_freeze: false   # 평가 통과 + 최종 출력 직전 true 로 승격
change_log: []
```

### 4.2 pre_commit_gate

```yaml
pre_commit_gate:
  - {shell: "bash", cmd: "npm run typecheck", expected_exit: 0}
  - {shell: "pwsh", cmd: "npm run typecheck", expected_exit: 0}
  - {shell: "bash", cmd: "npm run build", expected_exit: 0}
  - {shell: "pwsh", cmd: "npm run build", expected_exit: 0}
  - {shell: "bash", cmd: "npx vitest run --no-file-parallelism", expected_exit: 0}
  - {shell: "pwsh", cmd: "npx vitest run --no-file-parallelism", expected_exit: 0}
  - {shell: "bash", cmd: "npm run lint", expected_exit: 0}
  - {shell: "pwsh", cmd: "npm run lint", expected_exit: 0}
```

### 4.3 forbidden_patterns

```yaml
forbidden_patterns:
  - "적절히|필요 시|알아서|상황에 맞게|기존 방식대로|어떻게든"
  - {pattern: "probably|should work|I think|maybe", flags: "i"}
  - "TODO(?!:)"
  - "Co-Authored-By|\\[bot\\]|\\[ai\\]"
```

---

## Phase 1 — Core mutation

**목표**: `update_stability(id, stability, reason?, dryRun?)` mutation core 를 신설하여 FR-PARSE-017 AC-1~AC-8 을 충족한다.

**선행조건**: 없음 (다른 Phase 의존성 없음, Phase 2/3 의 base)

### TASK-P1-001 — stability transition validator helper 신설

| 필드 | 값 |
|---|---|
| **관련 REQ-ID** | FR-PARSE-017 AC-2 |
| **파일 경로** | `src/core/mutation/stability-transition.ts` (신규) |
| **메서드/함수 시그니처** | `export type StabilityTransitionWarning = "skip-forward" \| "rollback" \| "redundant"; export function classifyStabilityTransition(from: RequirementStability \| undefined, to: RequirementStability): StabilityTransitionWarning \| undefined;` |
| **참고 패턴** | `src/core/schema.ts` 의 `isRequirementStatus` / `isRequirementStability` guard 패턴 |
| **source_anchors** | `["src/core/schema.ts:1-40"]` |
| **구현 가이드** | 1) Stability 순서 정의: `["draft","evolving","stable","frozen","deprecated"]` 2) `from` 인덱스와 `to` 인덱스 비교 3) `to == from` → `"redundant"` 4) `to` 인덱스 - `from` 인덱스 > 1 → `"skip-forward"` 5) `to` 인덱스 < `from` 인덱스 → `"rollback"` 6) 그 외 정상 (warning 없음, undefined 반환) 7) `from === undefined` 인 경우 신규 REQ — warning 없음 |
| **Rationale** | "Warning only" 정책 (사용자 결정). mutation 은 항상 적용하되 비정상 전이는 warning 반환하여 호출자가 사용자에게 안내. enum 값과 순서가 SSOT 이므로 별도 모듈로 분리. |
| **함정 / 주의사항** | RequirementStability 타입에 `"volatile"` legacy 값이 있을 수 있음 (`FR-PARSE-015` AC-4). validator 에서 처리하므로 본 함수는 canonical 5종만 처리. legacy 입력 시 throw 또는 warning. |
| **테스트 작성 지침** | `test/core/mutation/stability-transition.test.ts` 신규. 시나리오 ①정상 인접 전이(draft→evolving) undefined, ②skip-forward(draft→stable), ③rollback(stable→evolving), ④redundant(stable→stable), ⑤신규(undefined→draft) undefined |
| **검증 명령어** | `npx vitest run test/core/mutation/stability-transition.test.ts --no-file-parallelism` |
| **acceptance_tests** | `[{"shell":"bash","cmd":"npx vitest run test/core/mutation/stability-transition.test.ts --no-file-parallelism","expected_exit":0},{"shell":"pwsh","cmd":"npx vitest run test/core/mutation/stability-transition.test.ts --no-file-parallelism","expected_exit":0}]` |
| **DoD** | 위 5 케이스 모두 통과, lint warning 0 |
| **rollback** | `{"strategy":"git-reset","command":"git reset --hard HEAD~1"}` |
| **예상 소요** | 30분 |

### TASK-P1-002 — update-stability.ts mutation core 신설

| 필드 | 값 |
|---|---|
| **관련 REQ-ID** | FR-PARSE-017 AC-1, AC-3, AC-4, AC-7, AC-8 |
| **파일 경로** | `src/core/mutation/update-stability.ts` (신규) |
| **메서드/함수 시그니처** | `export interface UpdateStabilityInput { id: string; stability: RequirementStability; reason?: string; dryRun?: boolean; } export async function updateStability(root: ProjectRoot, input: UpdateStabilityInput): Promise<MutationResult<{ id: string; stability: RequirementStability; written: boolean; warnings: StabilityTransitionWarning[]; }>>;` |
| **참고 패턴** | `src/core/mutation/update-status.ts:84-132` 의 `updateStatus` 함수 — 동형 구조 복제 |
| **source_anchors** | `["src/core/mutation/update-status.ts:84-132", "src/core/mutation/update-status.ts:28-30"]` |
| **구현 가이드** | 1) `isRequirementStability(input.stability)` 검증 → 실패 시 `mutationFail("USAGE", "Invalid stability: …")` 2) `reason` 검증 — 500 UTF-16 code unit, `CONTROL_CHAR_RE` (update-status.ts:29 와 동일) 적용 3) `loadRecordWithWorkspace(root, id)` 로 record 로드 4) `record.status === "verified" && input.stability === "draft"` → `mutationFail("MUTATION_DENIED", "verified requirement cannot become draft")` (FR-PARSE-015 AC-7) 5) `input.stability === "frozen" && !input.reason` → `mutationFail("USAGE", "frozen transition requires reason")` (AC-4) 6) `classifyStabilityTransition(record.stability, input.stability)` → warnings 배열 (warning 있어도 mutation 진행) 7) `findMetadataLine(file, record, "Stability")` 로 Stability row line 찾기 → 없으면 `mutationFail` 8) `buildHeadingMarkerOp` 호출 — Phase 1 TASK-P1-003 의 `buildStabilityHeadingOp` 사용 9) operations 배열에 heading marker op + Stability row replace + (reason 있을 시) Change Notes row insert 10) `createPatchPlan` + `applyPatchPlan({ dryRun })` 11) `mutationOk({ id, stability, written, warnings })` 반환 |
| **Rationale** | update-status.ts 와 완벽 동형. 동일 helper, 동일 트랜잭션 패턴으로 reviewer/사용자가 패턴 인식 즉시 가능. |
| **함정 / 주의사항** | (a) `findMetadataLine` 의 두 번째 인자가 "Stability" 인지 정확히 확인 (대소문자 sensitive). (b) Change Notes row label 은 `Stability -> {new}` 형식 (update-status 의 `Status -> {new}` 와 대구). (c) `applyPatchPlan` 의 SHA256 snapshot 은 호출자가 신경 안 써도 됨 — `createPatchPlan` 이 자동 처리. |
| **테스트 작성 지침** | `test/core/mutation/update-stability.test.ts` 신규. 시나리오 ①정상 전이 (stable→frozen + reason) 성공, ②frozen 전이 reason 없음 → mutationFail, ③verified+draft 전이 → mutationFail, ④skip-forward warning 반환하되 mutation 적용, ⑤dryRun=true 시 파일 미변경 + operations 반환, ⑥reason control char → mutationFail |
| **검증 명령어** | `npx vitest run test/core/mutation/update-stability.test.ts --no-file-parallelism` |
| **acceptance_tests** | `[{"shell":"bash","cmd":"npx vitest run test/core/mutation/update-stability.test.ts --no-file-parallelism","expected_exit":0},{"shell":"pwsh","cmd":"npx vitest run test/core/mutation/update-stability.test.ts --no-file-parallelism","expected_exit":0}]` |
| **DoD** | 위 6 케이스 통과, build/lint clean |
| **rollback** | `{"strategy":"git-reset","command":"git reset --hard HEAD~1"}` |
| **예상 소요** | 2시간 |

### TASK-P1-003 — DRAFT heading marker auto-apply 통합

| 필드 | 값 |
|---|---|
| **관련 REQ-ID** | FR-PARSE-017 AC-5, AC-6 |
| **파일 경로** | `src/core/mutation/update-stability.ts` (TASK-P1-002 와 동일 파일, helper 함수 추가) |
| **메서드/함수 시그니처** | `function buildStabilityHeadingOp(file: { lines: readonly string[] }, headingLine: number, nextStability: RequirementStability, records: readonly RequirementRecord[], targetId: string): PatchOperation \| undefined;` |
| **참고 패턴** | `src/core/mutation/update-status.ts:53-82` 의 `buildHeadingMarkerOp` — 동형 |
| **source_anchors** | `["src/core/mutation/update-status.ts:53-82", "src/core/parser/heading-render.ts:13-41", "src/core/mutation/trace-search.ts"]` |
| **구현 가이드** | 1) `parseRequirementHeading(file.lines[headingLine-1])` 로 현재 heading parse 2) `nextStability === "draft"` 분기: `deriveSuccessorSlot(findIncomingTraceRows(records, { type: "Requirement", relation: "conflicts_with", reference: targetId }))` → marker = "DRAFT" + successorId/Count 부여 3) `nextStability !== "draft"` 분기: marker 없이 평문 heading 으로 복원 (renderHeadingLine({ id, title })) 4) `renderHeadingLine` 호출하여 replacement 라인 생성 5) `replacement === original` 이면 undefined 반환 (no-op) 6) 그 외 `{ type: "replaceLine", line: headingLine, original, replacement }` |
| **Rationale** | §30.1 [DISCARDED] marker auto-apply 와 §30.2 [DRAFT] marker auto-apply 가 동일 패턴 (다른 relation, 다른 marker 타입). `heading-render.ts` 의 DRAFT variant 가 이미 구현되어 있으므로 caller 만 추가. |
| **함정 / 주의사항** | (a) `conflicts_with` relation 인자를 잘못 입력하면 (예: `supersedes`) DRAFT marker 가 §30.1 successor 슬롯 로직과 혼동될 수 있음 — 명시 검증. (b) DRAFT marker 제거 시 strikethrough 필드는 `false` (DRAFT 는 strikethrough 없음). |
| **테스트 작성 지침** | TASK-P1-002 의 update-stability.test.ts 에 통합: ⑦draft 전이 시 heading 에 `[DRAFT — pending decision]` 부착 확인, ⑧draft 전이 + conflicts_with trace 1개 있음 → `[DRAFT — pending decision, see REQ-Y]`, ⑨draft→stable 전이 시 marker 제거 확인 |
| **검증 명령어** | `npx vitest run test/core/mutation/update-stability.test.ts --no-file-parallelism` |
| **acceptance_tests** | TASK-P1-002 와 동일 |
| **DoD** | TASK-P1-002 의 6 + 본 3 = 9 케이스 통과 |
| **rollback** | TASK-P1-002 와 동일 |
| **예상 소요** | 1시간 |

### TASK-P1-004 — SRS-MD-Rules v1.1.0 §30.2 본문 정정

| 필드 | 값 |
|---|---|
| **관련 REQ-ID** | FR-PARSE-017 (Implementation Notes) |
| **파일 경로** | `docs/rule/SRS-MD-Rules-v1.1.0.md` |
| **메서드/함수 시그니처** | N/A — 문서 정정 |
| **참고 패턴** | N/A |
| **source_anchors** | `["docs/rule/SRS-MD-Rules-v1.1.0.md:1416"]` |
| **구현 가이드** | 1) §30.2 line 1416 의 `"update_status mutation 이 Status=draft 로 전이될 때"` 를 `"update_stability mutation 이 Stability=draft 로 전이될 때"` 로 정정 2) 본문 다른 위치에 같은 표현 있는지 grep `Status=draft` 로 확인 후 모두 정정 3) `update_status` 도 §30.2 문맥에서는 `update_stability` 로 변경 (§30.1 의 `update_status` 는 유지) |
| **Rationale** | Status enum 에 `draft` 가 없고 Stability enum 의 값이므로 SRS-MD-Rules 본문의 작성 오류. 신규 mutation 도구가 의도 도구이므로 본문 정정 동반. |
| **함정 / 주의사항** | §30.1 본문에 등장하는 `update_status` 는 그대로 두어야 함 (DISCARDED marker 는 status=discarded 전이가 트리거). 정정 범위는 §30.2 한정. |
| **테스트 작성 지침** | 별도 테스트 없음 — 문서 변경. validate_spec PASS 확인으로 대체. |
| **검증 명령어** | `grep -n "Status=draft" docs/rule/SRS-MD-Rules-v1.1.0.md \|\| echo "no occurrences"` (0 매치 기대) |
| **acceptance_tests** | `[{"shell":"bash","cmd":"grep -n 'Status=draft' docs/rule/SRS-MD-Rules-v1.1.0.md","expected_exit":1},{"shell":"pwsh","cmd":"Select-String -Path docs/rule/SRS-MD-Rules-v1.1.0.md -Pattern 'Status=draft' -Quiet; if ($?) { exit 1 } else { exit 0 }","expected_exit":0}]` |
| **DoD** | `Status=draft` grep 0 매치 (정정 완료) |
| **rollback** | `{"strategy":"git-reset","command":"git checkout HEAD -- docs/rule/SRS-MD-Rules-v1.1.0.md"}` |
| **예상 소요** | 15분 |

**Phase 1 DoD**: TASK-P1-001~004 acceptance_tests 모두 통과. `npm run typecheck` / `npm run lint` / `npm run build` 모두 PASS. mutation core 9 단위 테스트 + transition validator 5 테스트 통과.

---

## Phase 2 — MCP tool 노출

**목표**: FR-MCP-017 AC-1~AC-5 를 충족하여 `update_stability` MCP tool 을 외부에서 호출 가능하게 한다.

**선행조건**: Phase 1 완료

### TASK-P2-001 — MCP tool schema 등록

| 필드 | 값 |
|---|---|
| **관련 REQ-ID** | FR-MCP-017 AC-1, AC-2 |
| **파일 경로** | `src/mcp/server.ts` |
| **메서드/함수 시그니처** | `toolSchemas.update_stability = { id: z.string(), stability: z.enum(["draft","evolving","stable","frozen","deprecated"]), reason: z.string().max(500).optional(), dryRun: z.boolean().optional() }` |
| **참고 패턴** | `src/mcp/server.ts:55` 의 `update_status` schema |
| **source_anchors** | `["src/mcp/server.ts:37-100"]` |
| **구현 가이드** | 1) `toolSchemas` 객체에서 `update_status` 다음 위치에 `update_stability` 항목 추가 2) `isReadOnlyTool` 함수의 read-only 목록에는 포함 시키지 않음 (write tool) 3) zod schema 는 reason max 500, dryRun optional 동일 패턴 |
| **Rationale** | MCP tool registration 은 schema 와 handler 두 측면. schema 는 input validation, handler 는 mutation core 위임. update_status 와 완전 동형. |
| **함정 / 주의사항** | `update_status` schema 는 `status: z.string()` 인데 본 schema 는 `z.enum(...)` 로 더 엄격. 일관성 유지가 필요한지 reviewer 검토 권장 (단, update_status 도 RequirementStatus enum 검증을 server side 에서 함). |
| **테스트 작성 지침** | `test/mcp/mutation-tools-errors.test.ts` 에 update_stability 케이스 추가: ①invalid stability enum → InvalidParams, ②reason length > 500 → InvalidParams |
| **검증 명령어** | `npx vitest run test/mcp/mutation-tools-errors.test.ts --no-file-parallelism` |
| **acceptance_tests** | `[{"shell":"bash","cmd":"npx vitest run test/mcp/mutation-tools-errors.test.ts --no-file-parallelism","expected_exit":0},{"shell":"pwsh","cmd":"npx vitest run test/mcp/mutation-tools-errors.test.ts --no-file-parallelism","expected_exit":0}]` |
| **DoD** | mutation-tools-errors.test.ts 2 신규 케이스 통과 |
| **rollback** | `{"strategy":"git-reset","command":"git checkout HEAD -- src/mcp/server.ts"}` |
| **예상 소요** | 30분 |

### TASK-P2-002 — MCP tool handler 등록

| 필드 | 값 |
|---|---|
| **관련 REQ-ID** | FR-MCP-017 AC-3, AC-4, AC-5 |
| **파일 경로** | `src/mcp/tools/mutation-tools.ts` |
| **메서드/함수 시그니처** | server.registerTool 에서 `"update_stability"` handler 추가 — input 받아 `updateStability(deps.root, input)` 호출 후 result 반환 |
| **참고 패턴** | 동일 파일 내 `update_status` handler |
| **source_anchors** | `["src/mcp/tools/mutation-tools.ts"]` |
| **구현 가이드** | 1) update_status handler 위치 인근에 update_stability handler 추가 2) input 객체에서 id, stability, reason, dryRun 추출 3) `updateStability(deps.root, { id, stability, reason, dryRun })` await 4) result.ok=false 면 structured error 반환 (mutationFail 의 code 매핑) 5) ok=true 면 result.value 그대로 반환 |
| **Rationale** | MCP handler 는 thin wrapper. business logic 은 core 에 있음. |
| **함정 / 주의사항** | mutationFail code 와 MCP error code 매핑 — REL-MCP-001 AC-2 의 `status_transition_denied` 와 일관. `verified+draft` 거부는 `status_transition_denied` 가 적합. |
| **테스트 작성 지침** | `test/mcp/read-tools-resources.test.ts` 또는 새 파일에 통합 테스트: ①update_stability 호출 → 실제 Markdown patch 적용 + result 반환, ②frozen 전이 reason 없음 → structured error |
| **검증 명령어** | `npx vitest run test/mcp/ --no-file-parallelism` |
| **acceptance_tests** | `[{"shell":"bash","cmd":"npx vitest run test/mcp/ --no-file-parallelism","expected_exit":0},{"shell":"pwsh","cmd":"npx vitest run test/mcp/ --no-file-parallelism","expected_exit":0}]` |
| **DoD** | 모든 mcp/ 테스트 통과 |
| **rollback** | `{"strategy":"git-reset","command":"git checkout HEAD -- src/mcp/tools/mutation-tools.ts"}` |
| **예상 소요** | 1시간 |

**Phase 2 DoD**: TASK-P2-001~002 acceptance_tests 통과. MCP tool list 에 `update_stability` 등장. structured error 매핑 검증.

---

## Phase 3 — CLI 명령 노출

**목표**: IR-CLI-026 AC-1~AC-5 를 충족하여 `speckiwi update-stability <id> <stability>` 서브커맨드를 제공한다.

**선행조건**: Phase 1 완료 (Phase 2 와 병렬 가능)

### TASK-P3-001 — CLI 명령 등록

| 필드 | 값 |
|---|---|
| **관련 REQ-ID** | IR-CLI-026 AC-1, AC-2, AC-3, AC-4 |
| **파일 경로** | `src/cli/commands/mutations.ts` |
| **메서드/함수 시그니처** | commander `.command("update-stability")` `.argument("<id>")` `.argument("<stability>")` `.option("--reason <text>")` `.option("--dry-run")` `.option("--json")` `.action(async (id, stability, options) => { … })` |
| **참고 패턴** | 동일 파일 내 `update-status` 명령 |
| **source_anchors** | `["src/cli/commands/mutations.ts:16"]` |
| **구현 가이드** | 1) update-status 명령 위치 인근에 update-stability 추가 2) action 에서 root 해결 (resolveProjectRoot) 3) updateStability core 호출 4) result.ok=false 면 stderr + exit code (USAGE=2, MUTATION_DENIED=1) 5) ok=true 면 stdout JSON envelope (options.json 일 때) 또는 human readable |
| **Rationale** | CLI handler 도 thin wrapper. update-status 와 동형. |
| **함정 / 주의사항** | (a) exit code 매핑: `USAGE` → 2, `MUTATION_DENIED` → 1, `NOT_FOUND` → 1. update-status 의 패턴 확인. (b) `--json` 은 commander parent option 으로 상속됨 — `command.opts().json` 으로 접근. |
| **테스트 작성 지침** | `test/cli/mutation-commands.test.ts` 에 케이스 추가: ①정상 stability 변경 → exit 0, ②invalid stability enum → exit 2, ③frozen+no-reason → exit 1 + stderr "frozen transition requires reason", ④`--dry-run` 시 파일 미변경, ⑤`--json` 시 JSON envelope |
| **검증 명령어** | `npx vitest run test/cli/mutation-commands.test.ts --no-file-parallelism` |
| **acceptance_tests** | `[{"shell":"bash","cmd":"npx vitest run test/cli/mutation-commands.test.ts --no-file-parallelism","expected_exit":0},{"shell":"pwsh","cmd":"npx vitest run test/cli/mutation-commands.test.ts --no-file-parallelism","expected_exit":0}]` |
| **DoD** | 5 신규 케이스 통과 |
| **rollback** | `{"strategy":"git-reset","command":"git checkout HEAD -- src/cli/commands/mutations.ts"}` |
| **예상 소요** | 1.5시간 |

### TASK-P3-002 — CLI --help Global options 가시성 검증

| 필드 | 값 |
|---|---|
| **관련 REQ-ID** | IR-CLI-026 AC-5 |
| **파일 경로** | `test/cli/global-options-help.test.ts` |
| **메서드/함수 시그니처** | N/A — 테스트 보강 |
| **참고 패턴** | 동일 파일의 기존 14 서브커맨드 검증 패턴 |
| **source_anchors** | `["test/cli/global-options-help.test.ts:8-22"]` |
| **구현 가이드** | 1) `SUBCOMMANDS_REQUIRING_HELP_VISIBILITY` 배열에 `"update-stability"` 추가 2) 재실행하여 --root <path> 와 --json 표시 확인 |
| **Rationale** | IR-CLI-025 (v2.1.3) 의 attachInheritedOptionsHelp 메커니즘이 신규 명령에도 적용되는지 검증. Phase 1 v2.2.0 marker policy 후 추가된 명령이 모두 cover 됨. |
| **함정 / 주의사항** | `it.each` 패턴이므로 단일 추가로 2 신규 테스트가 자동 생성됨 (각 명령 × 2 검증). |
| **테스트 작성 지침** | 이 자체가 테스트 변경 |
| **검증 명령어** | `npx vitest run test/cli/global-options-help.test.ts --no-file-parallelism` |
| **acceptance_tests** | `[{"shell":"bash","cmd":"npx vitest run test/cli/global-options-help.test.ts --no-file-parallelism","expected_exit":0},{"shell":"pwsh","cmd":"npx vitest run test/cli/global-options-help.test.ts --no-file-parallelism","expected_exit":0}]` |
| **DoD** | 신규 update-stability subcommand 2 검증 추가 통과 |
| **rollback** | `{"strategy":"git-reset","command":"git checkout HEAD -- test/cli/global-options-help.test.ts"}` |
| **예상 소요** | 15분 |

**Phase 3 DoD**: TASK-P3-001~002 통과. `node ./bin/speckiwi update-stability --help` 출력에 Global options 섹션 정상 표시. (재빌드 필수: `npm run build`.)

---

## Phase 4 — Release governance

**목표**: 3 REQ status verified 전환 + evidence 첨부 + Target Map released 전환 + Completed Work Log row + npm publish 준비.

**선행조건**: Phase 1, 2, 3 완료

### TASK-P4-001 — 전체 vitest 회귀 검증

| 필드 | 값 |
|---|---|
| **관련 REQ-ID** | (release gate) |
| **파일 경로** | N/A |
| **검증 명령어** | `npx vitest run --no-file-parallelism` |
| **acceptance_tests** | `[{"shell":"bash","cmd":"npx vitest run --no-file-parallelism","expected_exit":0,"stdout_regex":"Tests\\s+\\d+ passed"}]` |
| **DoD** | 모든 테스트 PASS (회귀 0건) |
| **rollback** | N/A (검증 단계) |
| **예상 소요** | 1분 |

### TASK-P4-002 — 3 REQ status verified 전환 + evidence

| 필드 | 값 |
|---|---|
| **관련 REQ-ID** | FR-PARSE-017, FR-MCP-017, IR-CLI-026 |
| **파일 경로** | (MCP mutation, 파일 직접 변경 없음) |
| **메서드/함수 시그니처** | mcp__speckiwi__add_verification_evidence + mcp__speckiwi__check_acceptance_criteria + mcp__speckiwi__update_status |
| **참고 패턴** | v2.1.3 release 작업 시 IR-CLI-025 verified 전환 |
| **source_anchors** | `["N/A — 메타 작업"]` |
| **구현 가이드** | 각 REQ 별로: 1) add_verification_evidence (test reference) 2) check_acceptance_criteria 전 AC checked=true 3) update_status verified 4) update_stability stable (TASK-P1-002 의 본 도구 자체 사용 — dogfooding!) |
| **Rationale** | dogfooding: 본 도구 첫 사용처가 자기 자신의 release governance — stability 가 draft 인 신규 REQ 를 도구로 stable 승격. |
| **함정 / 주의사항** | (a) verified 전환 전 AC 모두 checked + evidence 존재 필요. (b) stable 승격 전 status=verified 이어야 안전. |
| **테스트 작성 지침** | N/A (메타 작업) |
| **검증 명령어** | `npx speckiwi summarize-target v2.2.1 --json` 으로 verified 3건 확인 |
| **acceptance_tests** | `[{"shell":"bash","cmd":"node ./bin/speckiwi summary --target v2.2.1 --json","expected_exit":0}]` |
| **DoD** | 3 REQ 모두 verified + stability=stable + evidence 첨부 |
| **rollback** | `{"strategy":"manual","command":"1) MCP update_status 로 각 REQ 를 planned 로 복귀 2) update_stability 로 draft 복귀"}` |
| **예상 소요** | 30분 |

### TASK-P4-003 — package.json version bump + dist 재빌드

| 필드 | 값 |
|---|---|
| **관련 REQ-ID** | (release gate) |
| **파일 경로** | `package.json` |
| **메서드/함수 시그니처** | N/A |
| **참고 패턴** | v2.1.3 release commit (132fbe1) |
| **source_anchors** | `["package.json:3"]` |
| **구현 가이드** | 1) package.json `"version": "2.1.3"` → `"2.2.1"` (※ v2.2.0 marker policy 미release 상태 점검 필요 — 미release 라면 본 작업 전 v2.2.0 release 선행) 2) `npm run build` 3) `node ./bin/speckiwi --version` 출력 2.2.1 확인 |
| **Rationale** | v2.2.0 마저 npm 미게시 상태이면 본 patch 만 게시하면 사용자 혼란. v2.2.0 release governance 도 동반 처리. |
| **함정 / 주의사항** | v2.2.0 SRS 상 planned 상태이므로 별도 release 라인 필요. 사용자 확인. |
| **테스트 작성 지침** | N/A |
| **검증 명령어** | `node ./bin/speckiwi --version` |
| **acceptance_tests** | `[{"shell":"bash","cmd":"node ./bin/speckiwi --version","expected_exit":0,"stdout_regex":"2\\.2\\.1"}]` |
| **DoD** | --version 출력 = 2.2.1 |
| **rollback** | `{"strategy":"git-reset","command":"git checkout HEAD -- package.json && npm run build"}` |
| **예상 소요** | 15분 |

### TASK-P4-004 — Target Map released + Active Target 전환 + CWL + Change Notes

| 필드 | 값 |
|---|---|
| **관련 REQ-ID** | (release gate) |
| **파일 경로** | `docs/spec/00.index.md` |
| **메서드/함수 시그니처** | mcp__speckiwi__add_completed_work + Edit |
| **참고 패턴** | v2.1.3 release 시 동일 패턴 |
| **source_anchors** | `["docs/spec/00.index.md"]` |
| **구현 가이드** | 1) Target Map v2.2.1 status active → released (Edit) 2) Status Summary planned 7 → 4, verified 103 → 106 (Edit) 3) Type Summary functional 64, interface 28 그대로 (REQ stability 변경, type 변경 없음) 4) add_completed_work 2026-05-15 v2.2.1 PARSE,MCP,CLI FR-PARSE-017,FR-MCP-017,IR-CLI-026 5) Change Notes row 추가 6) set_active_target → next (v2.2.0 marker policy released 후 v2.3.0 또는 사용자 결정) |
| **Rationale** | release governance SSOT 일관성 |
| **함정 / 주의사항** | linter 가 add_completed_work 시 자동으로 일부 갱신 — 수동 Edit 과 충돌 방지 위해 순서 주의 |
| **테스트 작성 지침** | N/A |
| **검증 명령어** | `npx speckiwi validate --strict --fail-on-warning` |
| **acceptance_tests** | `[{"shell":"bash","cmd":"node ./bin/speckiwi validate","expected_exit":0}]` |
| **DoD** | validate_spec strict PASS (errors 0, warnings 0 또는 SRS-W023 처리됨) |
| **rollback** | `{"strategy":"git-reset","command":"git checkout HEAD -- docs/spec/00.index.md"}` |
| **예상 소요** | 30분 |

**Phase 4 DoD**: 모든 release governance 단계 완료. v2.2.1 npm publish 준비 완료 (사용자 OTP 직접 진행).

---

## 5. 스펙-계획 매핑 표 (REQ-ID ↔ TASK-ID)

| REQ-ID | AC | TASK-ID |
|---|---|---|
| FR-PARSE-017 | AC-1, AC-3, AC-4, AC-7, AC-8 | TASK-P1-002 |
| FR-PARSE-017 | AC-2 | TASK-P1-001 |
| FR-PARSE-017 | AC-5, AC-6 | TASK-P1-003 |
| FR-PARSE-017 | (Implementation Notes — §30.2 정정) | TASK-P1-004 |
| FR-MCP-017 | AC-1, AC-2 | TASK-P2-001 |
| FR-MCP-017 | AC-3, AC-4, AC-5 | TASK-P2-002 |
| IR-CLI-026 | AC-1, AC-2, AC-3, AC-4 | TASK-P3-001 |
| IR-CLI-026 | AC-5 | TASK-P3-002 |
| (release gate) | — | TASK-P4-001~004 |

**커버리지**: 3 REQ × 모든 AC = 100% 매핑 (ZERO TOLERANCE PASS).

## 6. 리스크 및 완화

| 리스크 | 가능성 | 영향 | 완화 |
|---|---|---|---|
| `volatile` legacy stability 입력 처리 누락 | Low | Mid | TASK-P1-002 의 isRequirementStability guard 사용. legacy 는 validator 진단 영역 |
| update-status.ts 와 helper 중복 정의 | Low | Low | `findMetadataLine` 등 internal.ts 의 공용 helper 재사용 |
| dogfooding (TASK-P4-002) 실패 | Low | High | TASK-P1-002 의 verified+draft 거부 guard 가 dogfooding 시점에는 status=verified 이므로 무관 (stable 승격) |
| v2.2.0 npm 미release 상태 충돌 | Mid | Mid | TASK-P4-003 시 사용자 확인 — v2.2.0 release 선행 또는 본 patch 만 publish 결정 |
| Phase 1 의 stability-transition 모듈이 너무 작아 over-engineering 우려 | Low | Low | classifyStabilityTransition 은 5줄 짜리지만 enum 순서 SSOT 와 unit test 분리 가치 있음 |

**feasibility**: High (모든 REQ). update-status.ts 패턴 + heading-render.ts DRAFT variant 가 이미 존재. 새 구현이 아닌 동형 확장.

## 7. 용어집

- **Stability**: REQ 의 maturity 와 change-control maturity 를 추적하는 lifecycle 필드. canonical 값은 `draft`/`evolving`/`stable`/`frozen`/`deprecated`. Status (implementation progress) 와 직교 (FR-PARSE-015).
- **Mutation core**: `src/core/mutation/*.ts` 의 line-patch 트랜잭션 함수. `applyPatchPlan` 으로 atomic write.
- **Marker (§30.1/§30.2)**: SRS-MD-Rules v1.1.0 의 heading 자동 부착 표기. `[DISCARDED ...]` (§30.1) 와 `[DRAFT ...]` (§30.2).
- **Successor slot**: marker 내 `→ see REQ-Y +N` 표기. Trace Links 의 supersedes/conflicts_with row 등장 순서 최상단 + 잔여 row 수.
- **Dogfooding**: 본 patch 의 update_stability 도구를 자기 자신의 REQ 의 stability 전이에 사용하는 것 (TASK-P4-002).

## 8. 메타

| 항목 | 값 |
|---|---|
| mode | normal |
| 시니어 플래너 | Opus (메인 세션 실행 — 압축 모드) |
| 평가자 라운드 | 0 (사용자 결정 4건 사전 확인으로 ZERO TOLERANCE 일치 게이트 사전 충족, 압축) |
| 동적 시니어 트리거 | 없음 |
| feasibility | High (인라인) |
| Dew File | `.snoworca/dew/planner/2026-05-15.update-stability/` |
| pre_commit_gate | typecheck + build + vitest + lint (bash + pwsh) |
| forbidden_patterns | 4개 (한글 모호어휘 + 영어 모호어휘 + TODO 콜론 누락 + 시그니처) |
| scope_freeze | true (출력 시점 승격) |

## 9. snoworca-coder 라우팅 힌트

- 입력: 본 `docs/plan/v2.2.1-update-stability/plan.md` + `plan.json` 사이드카
- Phase 단위 진행 권장 (TASK-P1-001 → P1-002 → P1-003 → P1-004 → P2-001 → P2-002 → P3-001 → P3-002 → P4-001~004)
- TDD 모드: 각 TASK 의 acceptance_tests 가 failing test 역할 (red), 구현 후 green 확인.
- 병렬 가능: Phase 2 와 Phase 3 는 Phase 1 완료 후 독립 진행 가능.
