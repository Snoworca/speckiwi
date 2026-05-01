---
plan_contract: "1.1.0"
plan_id: "plan-20260501-speckiwi-v1-remediation"
previous_hash: null
produced_by: "snoworca-planner@2.2.2"
title: "SpecKiwi v1 remediation implementation and test plan"
mode: "NORMAL"
produced_at: "2026-05-01T14:05:00+09:00"
spec_path: "docs/spec/srs.md"
spec_refs:
  - "docs/spec/srs.md"
code_path: "."
scope_freeze: true
change_log: []
platforms:
  - "posix"
  - "win32"
auto_recommend_policy:
  default_confidence_threshold: "medium"
  cap: 0
  forbidden_for_business_decision: true
pre_commit_gate:
  - {shell: "bash", cmd: "npm run build", expected_exit: 0}
  - {shell: "pwsh", cmd: "npm run build", expected_exit: 0}
  - {shell: "bash", cmd: "npm run typecheck", expected_exit: 0}
  - {shell: "pwsh", cmd: "npm run typecheck", expected_exit: 0}
  - {shell: "bash", cmd: "npm run lint", expected_exit: 0}
  - {shell: "pwsh", cmd: "npm run lint", expected_exit: 0}
  - {shell: "bash", cmd: "npm test", expected_exit: 0}
  - {shell: "pwsh", cmd: "npm test", expected_exit: 0}
  - {shell: "bash", cmd: "npm run release:check", expected_exit: 0}
  - {shell: "pwsh", cmd: "npm run release:check", expected_exit: 0}
forbidden_patterns:
  - {pattern: "\\brm\\s+-[rRfF]+\\s+(/|~|\\$HOME|C:\\\\)", flags: ""}
  - {pattern: "\\brm\\s+-[rRfF]+\\s+\\*", flags: ""}
  - {pattern: "\\bdd\\s+if=.*\\s+of=/dev/(sd|nvme|hd)", flags: ""}
  - {pattern: "\\b(mkfs|fdisk|parted)\\b", flags: ""}
  - {pattern: "\\bchmod\\s+(-R\\s+)?[0-7]*777\\b", flags: ""}
  - {pattern: "\\bchown\\s+-R\\s+.*\\s+/", flags: ""}
  - {pattern: "\\bsudo\\s+(rm|chmod|chown|dd|mkfs)", flags: ""}
  - {pattern: "curl\\s+[^|]*\\|\\s*(sh|bash|zsh|powershell)", flags: ""}
  - {pattern: "wget\\s+[^|]*\\|\\s*sh", flags: ""}
  - {pattern: "iwr\\s+[^;]+;\\s*iex", flags: ""}
  - {pattern: "git\\s+push\\s+.*--force(-with-lease)?\\s+.*\\b(main|master|prod)\\b", flags: ""}
  - {pattern: "git\\s+reset\\s+--hard\\s+(?!HEAD\\b)", flags: ""}
  - {pattern: "git\\s+clean\\s+-[fdx]+", flags: ""}
  - {pattern: "적절히|필요 시|알아서|상황에 맞게|기존 방식대로|어떻게든", flags: ""}
phases:
  - id: "PHASE-P0"
    title: "Validation, filters, and pagination contract"
    tasks:
      - {id: "TASK-P0-001"}
      - {id: "TASK-P0-002"}
      - {id: "TASK-P0-003"}
  - id: "PHASE-P1"
    title: "Cache read path and no-cache semantics"
    tasks:
      - {id: "TASK-P1-001"}
      - {id: "TASK-P1-002"}
  - id: "PHASE-P2"
    title: "Cross-process apply locking"
    tasks:
      - {id: "TASK-P2-001"}
      - {id: "TASK-P2-002"}
  - id: "PHASE-P3"
    title: "MCP security and protocol contract"
    tasks:
      - {id: "TASK-P3-001"}
      - {id: "TASK-P3-002"}
      - {id: "TASK-P3-003"}
  - id: "PHASE-P4"
    title: "Release and performance gates"
    tasks:
      - {id: "TASK-P4-001"}
      - {id: "TASK-P4-002"}
  - id: "PHASE-P5"
    title: "Integration regression and documentation alignment"
    tasks:
      - {id: "TASK-P5-001"}
---

# SpecKiwi v1 Remediation Implementation And Test Plan

## 개요

이 계획은 `docs/spec/srs.md`의 34장에 추가된 구현 검토 기반 보완 요구사항을 구현하고 테스트하기 위한 remediation 계획이다. 기존 v1 구현 계획은 제품 골격과 기능 범위를 만들기 위한 계획이고, 본 계획은 검토에서 확인된 SRS-구현 간극을 release 가능한 수준으로 닫는 후속 계획이다.

JSON 사이드카: `docs/plans/plan-20260501-speckiwi-v1-remediation.md.json`

Feasibility 요약: 총 13개 TASK 중 High 7개, Medium 5개, Low 1개다. Infeasible 항목은 없다. 보안, apply 동시성, release gate는 실패 시 제품 신뢰성에 직접 영향을 주므로 strict review를 요구한다.

## 선행 조건 및 전제

- 현재 저장소는 Node.js 20 이상, ESM TypeScript, Vitest, ESLint 기반이다.
- 기존 상태/스코프/타입/태그 requirement 필터는 유지한다.
- 새 `project` 필터는 기존 필터와 조합 가능해야 한다.
- cache는 재생성 가능한 산출물이며 source of truth가 아니다.
- MCP는 stdio transport만 사용하고 HTTP port를 열지 않는다.
- 보완 구현은 기존 Core DTO와 CLI/MCP 공유 계약을 깨지 않아야 한다.

## 프로젝트 온보딩 컨텍스트

SpecKiwi는 `.speckiwi/**/*.yaml`을 원본으로 사용해 validation, graph, search, proposal, apply, export를 제공하는 local-first SDD context tool이다. CLI와 MCP는 같은 Core API와 DTO를 공유한다.

주요 수정 영역:

| 경로 | 역할 |
|---|---|
| `src/validate/semantic.ts` | semantic validation과 중복 검출 |
| `src/core/requirements.ts` | requirement registry, list filter, ID preview |
| `src/core/documents.ts` | document list/read와 pagination |
| `src/core/search.ts`, `src/search/index.ts` | search orchestration, index build, result paging |
| `src/cache/` | graph/search/diagnostics cache 생성과 manifest stale 판정 |
| `src/write/apply.ts`, `src/write/lock.ts` | proposal apply, backup, stale marker, write lock |
| `src/io/path.ts` | `.speckiwi/` 내부 path safety |
| `src/mcp/` | MCP tools/resources/schema/structuredContent |
| `scripts/release-check.mjs` | release gate command sequence |
| `test/` | fixture 기반 regression, hardening, perf, release tests |

빌드·테스트 치트시트:

| 목적 | 명령 |
|---|---|
| 빌드 | `npm run build` |
| 타입 검사 | `npm run typecheck` |
| lint | `npm run lint` |
| 전체 테스트 | `npm test` |
| validation 테스트 | `npm test -- validate` |
| search/cache 테스트 | `npm test -- search cache` |
| write 테스트 | `npm test -- write` |
| MCP/hardening 테스트 | `npm test -- mcp hardening` |
| release 테스트 | `npm test -- release` |
| release gate | `npm run release:check` |

핵심 규칙:

- Core는 CLI/MCP에 의존하지 않는다.
- 테스트는 fixture workspace 또는 temp directory를 사용한다.
- destructive 테스트는 temp directory 안에서만 수행한다.
- cache bypass 모드는 read와 write를 모두 우회한다.
- MCP tool input root override는 process-level root와 구분해서 거부한다.

## AI 에이전트 실행 가드

이 문서의 frontmatter가 실행 가드의 SSOT다. `scope_freeze: true` 상태이므로 새 Phase, 새 파일 ownership, 신규 요구사항 매핑은 사용자 승인과 `change_log[]` 기록이 있어야 한다.

## Phase P0 - Validation, Filters, And Pagination Contract

목표: 문서 모델 검증 누락과 list/search 계약 불일치를 먼저 닫아 이후 Phase의 fixture와 CLI/MCP 테스트 기반을 안정화한다.

### TASK-P0-001 - Add PRD Item ID Duplicate Validation

- 관련 REQ-ID: `FR-PRD-006`
- 파일 경로: `src/validate/semantic.ts`, `test/validate/semantic.test.ts`, `test/fixtures/workspaces/invalid-schema/.speckiwi/prd/duplicate-items.yaml`
- 메서드/함수 시그니처:
  - `function validatePrdAndTechnicalReferences(workspace: LoadedWorkspace, requirementIds: Set<string>, diagnostics: Diagnostic[]): void`
  - `function validatePrdItemIds(document: LoadedSpecDocument, diagnostics: Diagnostic[]): void`
- 참고 패턴: SRS requirement 중복은 `validateRequirements()`에서 `Set`과 `firstPathById`로 처리한다.
- source_anchors: `src/validate/semantic.ts:377-424`, `src/validate/semantic.ts:537-560`, `docs/spec/srs.md:1596-1596`
- 구현 가이드:
  1. PRD 문서 처리 경로에서 `items[]`를 순회한다.
  2. item `id`가 string이면 `Map<string, number>` 또는 `Map<string, string>`에 최초 위치를 저장한다.
  3. 같은 PRD 문서 안에서 중복 id를 발견하면 `DUPLICATE_PRD_ITEM_ID` error diagnostic을 추가한다.
  4. diagnostic에는 `path`, `details.id`, 최초 item 식별 정보, 중복 item 식별 정보를 포함한다.
  5. PRD item link target 검증은 기존 동작 그대로 유지한다.
- Rationale: PRD item은 SRS requirement의 근거가 될 수 있으므로 문서 내부 id 중복을 허용하면 traceability가 불안정해진다.
- 함정 / 주의사항: PRD item id 유일성은 문서 내부 범위다. 서로 다른 PRD 문서의 item id 전역 중복까지 금지하지 않는다.
- 테스트 작성 지침: PRD item id 중복 실패, 서로 다른 PRD 파일의 같은 item id 허용, 기존 PRD link target 검증 유지 3가지를 추가한다.
- 검증 명령어: `npm test -- validate`
- acceptance_tests:
  - {shell: "bash", cmd: "npm test -- validate", expected_exit: 0}
  - {shell: "pwsh", cmd: "npm test -- validate", expected_exit: 0}
- DoD: `DUPLICATE_PRD_ITEM_ID`가 실패 fixture에서 반환되고 기존 semantic validation 테스트가 모두 통과한다.
- rollback: {strategy: "manual", command: "1) Restore src/validate/semantic.ts and test/validate/semantic.test.ts from git. 2) Remove only the new duplicate PRD fixture file, then run npm test -- validate."}

### TASK-P0-002 - Add Project Filter To Requirement Listing

- 관련 REQ-ID: `FR-REQ-016`
- 파일 경로: `src/core/inputs.ts`, `src/core/requirements.ts`, `src/cli/commands/list.ts`, `src/mcp/schemas.ts`, `test/cli/read-commands.test.ts`, `test/mcp/tools.test.ts`
- 메서드/함수 시그니처:
  - `export type ListRequirementsInput = RootInput & PageInput & { project?: string | string[]; ... }`
  - `function matchesRequirementFilters(requirement: RegisteredRequirement, input: ListRequirementsInput, registry: RequirementRegistry): boolean`
- 참고 패턴: 현재 scope/type/status/tag/documentId 필터는 `matchesFilter()`와 `matchesTagFilter()`를 사용한다.
- source_anchors: `src/core/inputs.ts:59-64`, `src/core/requirements.ts:438-445`, `src/core/requirements.ts:475-482`, `src/cli/commands/list.ts:45-83`, `src/mcp/schemas.ts:112-120`, `docs/spec/srs.md:1597-1597`
- 구현 가이드:
  1. Core input DTO와 MCP schema에 `project` 필드를 추가한다.
  2. CLI `speckiwi list reqs`에 `--project <project>` 옵션을 추가한다.
  3. `registry.project.id`와 `registry.project.name` 중 하나와 매칭되면 통과하게 한다.
  4. 기존 scope/type/status/tag/documentId 필터와 AND 조건으로 조합한다.
  5. `--json` 출력의 page metadata는 기존 구조를 유지한다.
- Rationale: SRS는 requirement 목록을 project 기준으로 필터링할 수 있어야 한다고 요구한다.
- 함정 / 주의사항: repository-local v1은 한 workspace에 project가 하나이므로 필터 결과는 전체 또는 빈 목록이다. 이 동작을 명시적으로 테스트한다.
- 테스트 작성 지침: project id match, project name match, unknown project empty result, scope/status 조합 4가지를 추가한다.
- 검증 명령어: `npm test -- cli mcp`
- acceptance_tests:
  - {shell: "bash", cmd: "npm test -- cli mcp", expected_exit: 0}
  - {shell: "pwsh", cmd: "npm test -- cli mcp", expected_exit: 0}
- DoD: CLI/Core/MCP 모두 `project` 필터를 받아 동일한 requirement count와 page metadata를 반환한다.
- rollback: {strategy: "manual", command: "1) Restore owned Core, CLI, MCP schema, and test files from git. 2) Run npm test -- cli mcp to confirm the previous filter set still works."}

### TASK-P0-003 - Align Pagination Defaults And Limits

- 관련 REQ-ID: `FR-CLI-013`
- 파일 경로: `src/search/index.ts`, `src/core/documents.ts`, `src/core/requirements.ts`, `src/mcp/schemas.ts`, `test/search/search.test.ts`, `test/cli/read-commands.test.ts`, `test/mcp/tools.test.ts`
- 메서드/함수 시그니처:
  - `function normalizeSearchLimit(value: number | undefined): number`
  - `function normalizeListLimit(value: number | undefined): number`
  - `const searchPageSchema = { limit: z.number().int().min(1).max(100).optional(), offset: ... }`
  - `const listPageSchema = { limit: z.number().int().min(1).max(500).optional(), offset: ... }`
- 참고 패턴: 현재 search와 list limit clamp는 각각 `normalizeLimit()` 함수에 분산되어 있다.
- source_anchors: `src/search/index.ts:189-194`, `src/core/documents.ts:111-113`, `src/core/requirements.ts:501-505`, `src/mcp/schemas.ts:26-29`, `docs/spec/srs.md:1605-1605`
- 구현 가이드:
  1. search limit 기본값을 10, 최대값을 100으로 변경한다.
  2. document/requirement list limit 기본값을 50, 최대값을 500으로 변경한다.
  3. MCP schema는 search와 list page schema를 분리한다.
  4. CLI tests에서 `--limit 999` clamp 결과와 기본 limit 결과를 검증한다.
  5. search/list JSON page 객체에 적용된 `limit`, `offset`, `hasMore`, `nextOffset`이 반영되는지 검증한다.
- Rationale: 보완 결정 문서의 pagination 계약과 Core 구현이 일치해야 agent가 안정적으로 page를 순회한다.
- 함정 / 주의사항: search와 list는 서로 다른 limit 계약을 가진다. 하나의 `pageSchema`로 두 도메인을 계속 공유하지 않는다.
- 테스트 작성 지침: search default/max, list default/max, MCP schema max validation 3축으로 작성한다.
- 검증 명령어: `npm test -- search cli mcp`
- acceptance_tests:
  - {shell: "bash", cmd: "npm test -- search cli mcp", expected_exit: 0}
  - {shell: "pwsh", cmd: "npm test -- search cli mcp", expected_exit: 0}
- DoD: search 기본 page limit 10, search max 100, list 기본 50, list max 500이 Core/CLI/MCP에서 동일하다.
- rollback: {strategy: "manual", command: "1) Restore pagination-owned files from git. 2) Run npm test -- search cli mcp."}

## Phase P1 - Cache Read Path And No-Cache Semantics

목표: cache 파일을 생성만 하는 상태에서 실제 read path로 연결하고, bypass 모드가 모든 cache 입출력을 우회하게 만든다.

### TASK-P1-001 - Use Valid Search Cache In Search Workspace

- 관련 REQ-ID: `FR-CACHE-009`, `NFR-PERF-002`, `NFR-PERF-006`
- 파일 경로: `src/core/search.ts`, `src/search/index.ts`, `src/cache/rebuild.ts`, `src/cache/manifest.ts`, `test/search/search.test.ts`, `test/cache/cache.test.ts`
- 메서드/함수 시그니처:
  - `export function deserializeSearchIndex(value: unknown): SearchIndex | undefined`
  - `async function readSearchCache(root: WorkspaceRoot): Promise<SearchIndex | undefined>`
  - `export async function searchWorkspace(input: SearchInput): Promise<SearchResultSet>`
- 참고 패턴: `rebuildCache()` already writes serialized search index and manifest output hashes.
- source_anchors: `src/core/search.ts:11-32`, `src/cache/rebuild.ts:27-45`, `src/cache/manifest.ts:104-119`, `docs/spec/srs.md:1603-1603`
- 구현 가이드:
  1. `serializeSearchIndex()`의 역함수 `deserializeSearchIndex()`를 만든다.
  2. `searchWorkspace()`에서 manifest가 stale이 아니고 `cacheMode !== "bypass"`이면 `.speckiwi/cache/search-index.json`을 읽는다.
  3. deserialize 실패나 파일 누락이면 warning을 추가하고 YAML rebuild/degrade 경로를 사용한다.
  4. cache hit 여부를 테스트에서 관찰할 수 있게 diagnostics info 또는 test-only fixture mutation 방식 중 하나를 고른다.
  5. cache hit 경로에서도 search result ordering은 기존 deterministic sort를 유지한다.
- Rationale: SRS는 cache 기반 검색 성능 목표를 제시하므로 cache 생성과 실제 사용이 모두 필요하다.
- 함정 / 주의사항: cache는 source of truth가 아니다. cache read 실패는 fatal error가 아니라 YAML fallback이어야 한다.
- 테스트 작성 지침: stale false cache hit, corrupt cache fallback warning, stale true rebuild 3가지를 추가한다.
- 검증 명령어: `npm test -- search cache`
- acceptance_tests:
  - {shell: "bash", cmd: "npm test -- search cache", expected_exit: 0}
  - {shell: "pwsh", cmd: "npm test -- search cache", expected_exit: 0}
- DoD: search cache hit 테스트가 YAML 원본 변경 전 stale manifest 기준으로 cache result를 사용하고, corrupt cache에서 fallback warning을 반환한다.
- rollback: {strategy: "manual", command: "1) Restore search/cache owned files from git. 2) Run npm test -- search cache."}

### TASK-P1-002 - Enforce No-Cache As Full Cache Read And Write Bypass

- 관련 REQ-ID: `FR-CACHE-010`
- 파일 경로: `src/write/apply.ts`, `src/core/search.ts`, `src/core/documents.ts`, `src/core/requirements.ts`, `src/graph/builder.ts`, `src/core/export-markdown.ts`, `src/export/markdown.ts`, `test/write/apply.test.ts`, `test/cache/cache.test.ts`, `test/cli/req-write.test.ts`, `test/cli/export.test.ts`, `test/graph/graph.test.ts`
- 메서드/함수 시그니처:
  - `async function applyResolvedProposal(root: WorkspaceRoot, targetStorePath: StorePath, proposal: ProposalDocument, cacheMode: CacheMode): Promise<ApplyResult>`
  - `async function markCacheStale(root: WorkspaceRoot, modifiedFiles: string[]): Promise<void>`
- 참고 패턴: `rebuildCache()` already returns without touching files when `cacheMode === "bypass"`.
- source_anchors: `src/write/apply.ts:27-47`, `src/write/apply.ts:97-120`, `src/write/apply.ts:252-257`, `src/cache/rebuild.ts:19-25`, `docs/spec/srs.md:1604-1604`
- 구현 가이드:
  1. `applyChange()`에서 `input.cacheMode`를 `applyResolvedProposal()`로 전달한다.
  2. `cacheMode === "bypass"`이면 `markCacheStale()` 호출을 건너뛰고 result `cacheStale`을 false 또는 별도 명시 필드로 반환한다.
  3. search/cache/list/graph/export path에서 bypass가 cache read/write를 수행하지 않는지 기존 경로를 점검한다.
  4. CLI `req update --apply --no-cache` 테스트가 `.speckiwi/cache/stale.json` 미생성을 검증한다.
  5. 기존 auto mode apply는 stale marker 생성 동작을 유지한다.
- Rationale: `--no-cache`는 read와 write를 모두 우회한다는 보완 결정이 있어 apply 후 stale marker 생성도 금지된다.
- 함정 / 주의사항: bypass 모드에서도 source YAML apply 자체는 수행되어야 한다. 금지 대상은 cache 입출력이다.
- 테스트 작성 지침: apply auto creates stale marker, apply bypass does not create stale marker, search bypass does not create cache files, graph bypass does not create cache files, export bypass does not create cache files 5가지를 추가한다.
- 검증 명령어: `npm test -- write cache cli`
- acceptance_tests:
  - {shell: "bash", cmd: "npm test -- write cache cli", expected_exit: 0}
  - {shell: "pwsh", cmd: "npm test -- write cache cli", expected_exit: 0}
- DoD: bypass mode는 apply/search/graph/export 실행 중 `.speckiwi/cache/`에 새 파일 또는 stale marker를 만들지 않고, auto mode는 기존 stale marker behavior를 보존한다.
- rollback: {strategy: "manual", command: "1) Restore write/cache/cli test files from git. 2) Run npm test -- write cache cli."}

## Phase P2 - Cross-Process Apply Locking

목표: apply 동시성 요구사항을 프로세스 경계까지 확장하고, lock 복구 가능성을 테스트한다.

### TASK-P2-001 - Replace In-Memory Apply Lock With File-Based Target Lock

- 관련 REQ-ID: `NFR-REL-008`
- 파일 경로: `src/write/lock.ts`, `src/write/apply.ts`, `test/write/apply-concurrency.test.ts`
- 메서드/함수 시그니처:
  - `export async function withTargetWriteLock<T>(root: WorkspaceRoot, target: StorePath, fn: () => Promise<T>): Promise<T>`
  - `async function acquireFileLock(root: WorkspaceRoot, target: StorePath): Promise<WriteLockHandle>`
- 참고 패턴: current lock is a module-scope `Set` and only protects one process.
- source_anchors: `src/write/lock.ts:1-26`, `src/write/apply.ts:43-47`, `docs/spec/srs.md:1611-1611`
- 구현 가이드:
  1. Lock key를 target store path의 safe filename hash로 만든다.
  2. `.speckiwi/.locks/` 아래 lock file을 exclusive create mode로 만든다. 이 디렉토리는 cache가 아니라 apply 안전성 상태다.
  3. lock payload에 pid, target, createdAt, processStartHint를 저장한다.
  4. acquire 실패 시 `APPLY_REJECTED_LOCK_CONFLICT`를 반환한다.
  5. finally에서 lock file을 제거한다.
- Rationale: CLI는 별도 node 프로세스로 동시에 실행될 수 있으므로 module-scope lock은 same-target race를 막지 못한다.
- 함정 / 주의사항: lock 파일 이름은 user input path를 그대로 쓰지 않는다. `cacheMode: bypass`여도 apply lock은 safety mechanism이므로 동작해야 한다. lock file을 `.speckiwi/cache/` 아래에 두면 `--no-cache` 요구사항과 충돌하므로 금지한다.
- 테스트 작성 지침: 두 별도 node process를 spawn해 같은 proposal 또는 같은 target apply를 시도하고 하나만 성공하는지 검증한다.
- 검증 명령어: `npm test -- write`
- acceptance_tests:
  - {shell: "bash", cmd: "npm test -- write", expected_exit: 0}
  - {shell: "pwsh", cmd: "npm test -- write", expected_exit: 0}
- DoD: same-target cross-process apply에서 성공 1건, `APPLY_REJECTED_LOCK_CONFLICT` 1건이 deterministic하게 관찰된다.
- rollback: {strategy: "manual", command: "1) Restore src/write/lock.ts, src/write/apply.ts, and write tests from git. 2) Run npm test -- write."}

### TASK-P2-002 - Add Stale Lock Recovery And Cleanup Tests

- 관련 REQ-ID: `NFR-REL-009`
- 파일 경로: `src/write/lock.ts`, `test/write/apply-concurrency.test.ts`, `test/hardening/reliability.test.ts`
- 메서드/함수 시그니처:
  - `function isStaleLock(payload: WriteLockPayload, now: Date): boolean`
  - `async function releaseFileLock(handle: WriteLockHandle): Promise<void>`
- 참고 패턴: apply already performs stale proposal checks before and after validation.
- source_anchors: `src/write/apply.ts:62-80`, `src/write/apply.ts:176-210`, `docs/spec/srs.md:1612-1612`
- 구현 가이드:
  1. Lock payload parse 실패나 pid-not-running 조건을 stale 후보로 분류한다.
  2. stale lock은 target 재확인 후 제거하고 acquire를 재시도한다.
  3. 정상 apply 후 lock directory가 비어 있거나 해당 target lock이 제거됐는지 테스트한다.
  4. active lock은 제거하지 않고 conflict를 반환한다.
  5. Windows에서 pid check가 불안정하면 TTL 기반 stale lock만 사용하고 테스트를 clock injection으로 구성한다.
- Rationale: 비정상 종료 후 lock이 영구적으로 apply를 막으면 recovery 요구사항을 만족하지 못한다.
- 함정 / 주의사항: stale 판정은 너무 짧은 TTL로 정상 apply를 끊지 않도록 보수적으로 둔다.
- 테스트 작성 지침: stale lock file precreate 후 apply 성공, active lock conflict, success cleanup 3가지를 추가한다.
- 검증 명령어: `npm test -- write hardening`
- acceptance_tests:
  - {shell: "bash", cmd: "npm test -- write hardening", expected_exit: 0}
  - {shell: "pwsh", cmd: "npm test -- write hardening", expected_exit: 0}
- DoD: stale lock recovery와 정상 cleanup이 test fixture로 검증된다.
- rollback: {strategy: "manual", command: "1) Restore lock and hardening test files from git. 2) Run npm test -- write hardening."}

## Phase P3 - MCP Security And Protocol Contract

목표: workspace 외부 read 방지와 MCP protocol metadata를 명확히 하여 agent-facing interface를 안정화한다.

### TASK-P3-001 - Reject Symlink Traversal On Core And MCP Reads

- 관련 REQ-ID: `NFR-SEC-010`
- 파일 경로: `src/io/path.ts`, `src/io/file-store.ts`, `src/io/yaml-loader.ts`, `src/core/documents.ts`, `src/write/apply.ts`, `src/write/proposal.ts`, `src/mcp/resources.ts`, `test/hardening/security.test.ts`, `test/mcp/mcp-resources.test.ts`, `test/write/apply.test.ts`
- 메서드/함수 시그니처:
  - `export async function resolveRealStorePath(root: WorkspaceRoot, storePath: StorePath): Promise<WorkspacePath>`
  - `export async function assertRealPathInsideWorkspace(path: WorkspacePath): Promise<void>`
- 참고 패턴: `resolveStorePath()` currently performs lexical containment only.
- source_anchors: `src/io/path.ts:55-75`, `src/core/documents.ts:35-69`, `src/mcp/resources.ts:11-33`, `docs/spec/srs.md:1618-1618`
- 구현 가이드:
  1. `realpath()` 기반 검사를 추가해 symlink target까지 workspace `.speckiwi/` 아래인지 확인한다.
  2. Core `readDocument()`, YAML loader, proposal/apply write target, MCP overview/index/document resource read가 real path 검사를 통과한 파일만 읽거나 쓰게 한다.
  3. write path는 symlink target이 workspace 밖이면 atomic write 전에 deterministic security error로 중단한다.
  4. security violation은 deterministic error code를 사용한다.
  5. test workspace에 외부 temp file을 만들고 `.speckiwi/overview.yaml`, registered document, apply target symlink를 생성한다.
  6. CLI read, MCP resource, apply write가 외부 file content를 읽거나 쓰지 않는지 검증한다.
- Rationale: lexical path check만으로는 symlink가 workspace 밖을 가리키는 공격을 막을 수 없다.
- 함정 / 주의사항: 일반 상대 경로 검증과 symlink target 검증을 분리한다. normalizeStorePath는 문자열 정책을 유지한다.
- 테스트 작성 지침: overview symlink read rejection, registered document symlink read rejection, apply target symlink write rejection, 정상 regular file read/write 4가지를 추가한다.
- 검증 명령어: `npm test -- mcp hardening`
- acceptance_tests:
  - {shell: "bash", cmd: "npm test -- mcp hardening", expected_exit: 0}
  - {shell: "pwsh", cmd: "npm test -- mcp hardening", expected_exit: 0}
- DoD: symlink traversal fixture에서 외부 파일 내용이 반환되거나 수정되지 않고 security diagnostic 또는 MCP error가 반환된다.
- rollback: {strategy: "manual", command: "1) Restore path, document, MCP resource, and test files from git. 2) Run npm test -- mcp hardening."}

### TASK-P3-002 - Return Invalid Params For MCP Input Shape Errors

- 관련 REQ-ID: `FR-MCP-014`
- 파일 경로: `src/mcp/tools.ts`, `src/mcp/schemas.ts`, `test/mcp/tools.test.ts`
- 메서드/함수 시그니처:
  - `function registerStrictTool<T>(server: McpServer, name: string, config: ToolConfig<T>, handler: (input: T) => Promise<CallToolResult>): void`
  - `function toInvalidParams(error: unknown): McpError`
- 참고 패턴: current root override test expects `isError=true` result for schema rejection.
- source_anchors: `src/mcp/schemas.ts:68-120`, `src/mcp/tools.ts:186-228`, `test/mcp/tools.test.ts:66-82`, `docs/spec/srs.md:1619-1619`
- 구현 가이드:
  1. SDK registration behavior를 확인하고 handler 전 input schema 오류를 JSON-RPC invalid params로 관찰되게 한다.
  2. root override는 domain error가 아니라 invalid params category로 테스트한다.
  3. apply policy rejection 같은 domain failure는 기존 `isError=true` Core DTO result를 유지한다.
  4. test assertion을 `McpError` code 또는 SDK 노출 형태에 맞춰 고정한다.
  5. README나 docs에 root는 process option으로만 허용된다는 문장을 유지한다.
- Rationale: MCP client는 input shape 문제와 business/domain failure를 다르게 처리할 수 있어야 한다.
- 함정 / 주의사항: 모든 Core error를 throw로 바꾸면 structuredContent 계약이 깨진다. schema/input category만 분리한다.
- 테스트 작성 지침: root override invalid params, unknown field invalid params, apply allowApply false domain error 3가지를 분리한다.
- 검증 명령어: `npm test -- mcp`
- acceptance_tests:
  - {shell: "bash", cmd: "npm test -- mcp", expected_exit: 0}
  - {shell: "pwsh", cmd: "npm test -- mcp", expected_exit: 0}
- DoD: invalid params와 Core domain failure가 서로 다른 observable error model로 테스트된다.
- rollback: {strategy: "manual", command: "1) Restore MCP tool/schema tests and source from git. 2) Run npm test -- mcp."}

### TASK-P3-003 - Add MCP Output Schemas For Structured Content

- 관련 REQ-ID: `FR-MCP-015`
- 파일 경로: `src/mcp/tools.ts`, `src/mcp/schemas.ts`, `src/mcp/structured-content.ts`, `test/mcp/tools.test.ts`
- 메서드/함수 시그니처:
  - `export const machineResultOutputSchema: z.ZodType`
  - `function toolOutputSchemaFor(name: string): unknown`
- 참고 패턴: registered tools currently provide inputSchema and annotations only.
- source_anchors: `src/mcp/tools.ts:186-228`, `src/mcp/tools.ts:297-328`, `src/mcp/structured-content.ts:9-24`, `docs/spec/srs.md:1620-1620`
- 구현 가이드:
  1. 최소 공통 MachineResult output schema를 정의한다.
  2. tool registration config에 `outputSchema`를 포함한다.
  3. output schema는 `structuredContent` shape를 설명하고 text content JSON string까지 강제하지 않는다.
  4. 모든 13개 `speckiwi_*` tool이 outputSchema를 노출하는지 테스트한다.
  5. `structuredContent` 실제 결과와 schema의 `ok` 필수 필드가 충돌하지 않게 한다.
- Rationale: MCP tool metadata는 agent가 tool 결과를 안정적으로 예측하게 하는 계약 표면이다.
- 함정 / 주의사항: 너무 세부적인 per-tool schema를 먼저 작성하면 유지보수 비용이 커진다. 공통 envelope부터 시작한다.
- 테스트 작성 지침: listTools metadata outputSchema 존재, success result schema compatibility, error result schema compatibility 3가지를 추가한다.
- 검증 명령어: `npm test -- mcp`
- acceptance_tests:
  - {shell: "bash", cmd: "npm test -- mcp", expected_exit: 0}
  - {shell: "pwsh", cmd: "npm test -- mcp", expected_exit: 0}
- DoD: listTools 결과의 모든 SpecKiwi tool에 outputSchema가 있고 structuredContent와 envelope가 일치한다.
- rollback: {strategy: "manual", command: "1) Restore MCP output schema source and tests from git. 2) Run npm test -- mcp."}

## Phase P4 - Release And Performance Gates

목표: release gate가 실패를 숨기지 않게 하고, SRS 성능 목표를 대표 fixture로 검증한다.

### TASK-P4-001 - Include Release Acceptance In Release Check

- 관련 REQ-ID: `NFR-REL-010`
- 파일 경로: `scripts/release-check.mjs`, `test/release/acceptance.test.ts`, `package.json`
- 메서드/함수 시그니처:
  - `export function releaseCommands(): ReleaseCommand[]`
  - `export async function runReleaseCheck(options?: RunReleaseCheckOptions): Promise<number>`
- 참고 패턴: current `releaseCommands()` excludes `test/release/**`.
- source_anchors: `scripts/release-check.mjs:9-16`, `test/release/acceptance.test.ts:57-60`, `docs/spec/srs.md:1626-1626`
- 구현 가이드:
  1. Release check sequence에 release acceptance command를 추가한다.
  2. Long-running acceptance test에는 explicit timeout을 부여하거나 Vitest config를 조정한다.
  3. 기존 non-release test command는 유지해 빠른 regression 범위를 보존한다.
  4. release command list test의 expected sequence를 업데이트한다.
  5. `npm run release:check`가 acceptance failure를 non-zero로 전파하는 failure injection 테스트를 유지한다.
- Rationale: release gate가 acceptance 실패를 제외하면 release readiness 판정이 거짓 양성이 된다.
- 함정 / 주의사항: release test 내부의 `beforeAll npm run build`와 release check build step 중복으로 timeout이 늘어날 수 있다. timeout은 명시적으로 관리한다.
- 테스트 작성 지침: release command sequence, timeout 안정화, failure propagation 3가지를 확인한다.
- 검증 명령어: `npm test -- release`
- acceptance_tests:
  - {shell: "bash", cmd: "npm test -- release", expected_exit: 0}
  - {shell: "pwsh", cmd: "npm test -- release", expected_exit: 0}
  - {shell: "bash", cmd: "npm run release:check", expected_exit: 0}
  - {shell: "pwsh", cmd: "npm run release:check", expected_exit: 0}
- DoD: default `npm test`, `npm test -- release`, `npm run release:check`가 모두 timeout 없이 통과하고 release acceptance failure가 숨겨지지 않는다.
- rollback: {strategy: "manual", command: "1) Restore scripts/release-check.mjs, package.json, and release tests from git. 2) Run npm test -- release."}

### TASK-P4-002 - Expand Performance Tests To SRS Scale Targets

- 관련 REQ-ID: `NFR-PERF-007`
- 파일 경로: `test/perf/perf.test.ts`, `src/core/search.ts`, `src/mcp/tools.ts`
- 메서드/함수 시그니처:
  - `async function buildLargeWorkspaceFixture(input: { requirementCount: number; documentCount?: number }): Promise<PerfFixture>`
  - `async function measureMcpToolCall(root: string, toolName: string, args: Record<string, unknown>): Promise<number>`
- 참고 패턴: current perf fixture defaults to 600 requirements and measures core lookup/search/cache/validation.
- source_anchors: `test/perf/perf.test.ts:27-55`, `test/perf/perf.test.ts:143-180`, `docs/spec/srs.md:1349-1354`, `docs/spec/srs.md:1627-1627`
- 구현 가이드:
  1. Default perf fixture count를 CI-friendly로 유지하되 SRS-scale mode를 별도 npm script로 제공한다.
  2. `SPECKIWI_PERF_REQUIREMENTS=10000`에서 exact lookup, cached search, cache rebuild를 측정한다.
  3. `SPECKIWI_PERF_DOCUMENTS=1000`에서 validation path를 측정한다.
  4. MCP in-memory client 또는 stdio client로 정상 cache 상태 단일 tool call 1초 목표를 측정한다.
  5. `npm run perf:srs` 또는 동등 script를 release acceptance matrix에 포함할 수 있게 만든다. 기본 `npm test -- perf`는 빠른 smoke로 유지하고, SRS-scale 직접 검증은 명시 script로 실행한다.
- Rationale: 기존 600개 fixture는 성능 회귀 탐지에는 도움이 되지만 SRS의 대표 목표를 직접 확인하지 않는다.
- 함정 / 주의사항: 일반 unit test를 지나치게 느리게 만들지 않는다. SRS-scale은 env flag와 npm script 양쪽으로 실행 가능하게 한다.
- 테스트 작성 지침: default perf smoke, env-driven SRS-scale perf, MCP call timing 3가지를 작성한다.
- 검증 명령어: `npm test -- perf`
- acceptance_tests:
  - {shell: "bash", cmd: "npm test -- perf", expected_exit: 0}
  - {shell: "pwsh", cmd: "npm test -- perf", expected_exit: 0}
- DoD: default perf test는 빠르게 통과하고, `npm run perf:srs` 또는 동등 script로 10,000 requirement, 1,000 YAML validation, MCP 단일 호출 목표를 직접 측정할 수 있다.
- rollback: {strategy: "manual", command: "1) Restore perf tests and any touched core/MCP files from git. 2) Run npm test -- perf."}

## Phase P5 - Integration Regression And Documentation Alignment

목표: 모든 보완 요구사항을 통합 검증하고 문서와 command examples가 실제 CLI/MCP 동작과 일치하도록 마감한다.

### TASK-P5-001 - Add Remediation Acceptance Matrix And Final Regression Gate

- 관련 REQ-ID: `FR-PRD-006`, `FR-REQ-016`, `FR-CACHE-009`, `FR-CACHE-010`, `FR-CLI-013`, `NFR-REL-008`, `NFR-REL-009`, `NFR-SEC-010`, `FR-MCP-014`, `FR-MCP-015`, `NFR-REL-010`, `NFR-PERF-007`
- 파일 경로: `README.md`, `test/release/acceptance.test.ts`, `package.json`
- 메서드/함수 시그니처:
  - `export async function assertV1Acceptance(root: string): Promise<void>`
- 참고 패턴: existing release acceptance already runs core CLI commands against fixture workspace.
- source_anchors: `test/release/acceptance.test.ts:102-120`, `docs/spec/srs.md:1633-1642`, `README.md:1-33`, `package.json:42-53`
- 구현 가이드:
  1. Release acceptance에 remediation acceptance matrix를 추가한다.
  2. README command examples에 `--scope`, `--status`, `--project`, `--no-cache` 중 사용자-facing 항목을 반영한다.
  3. SRS 34.6 체크리스트가 테스트 이름 또는 assertion으로 추적되는지 확인하되, `docs/spec/srs.md` 자체의 요구사항 문구는 수정하지 않는다.
  4. SRS-scale 성능 검증 script가 추가됐다면 release acceptance 또는 release-check 문서화 경로에 포함한다.
  5. 전체 pre-commit gate를 실행한다.
  6. 실패가 남으면 해당 Phase로 되돌려 수정한다.
- Rationale: 개별 테스트가 통과해도 사용자-facing release acceptance가 빠지면 regression을 놓칠 수 있다.
- 함정 / 주의사항: SRS 문서는 요구사항 원본이다. 구현하면서 SRS 의미를 바꾸지 않는다.
- 테스트 작성 지침: release acceptance에서 보완 요구사항별 최소 one assertion을 둔다.
- 검증 명령어: `npm run release:check`
- acceptance_tests:
  - {shell: "bash", cmd: "npm run build", expected_exit: 0}
  - {shell: "bash", cmd: "npm run typecheck", expected_exit: 0}
  - {shell: "bash", cmd: "npm run lint", expected_exit: 0}
  - {shell: "bash", cmd: "npm test", expected_exit: 0}
  - {shell: "bash", cmd: "npm run release:check", expected_exit: 0}
  - {shell: "pwsh", cmd: "npm run build", expected_exit: 0}
  - {shell: "pwsh", cmd: "npm run typecheck", expected_exit: 0}
  - {shell: "pwsh", cmd: "npm run lint", expected_exit: 0}
  - {shell: "pwsh", cmd: "npm test", expected_exit: 0}
  - {shell: "pwsh", cmd: "npm run release:check", expected_exit: 0}
- DoD: SRS 34.6 체크리스트의 모든 항목이 자동 테스트 또는 release acceptance assertion으로 추적되고, pre-commit gate가 통과한다.
- rollback: {strategy: "manual", command: "1) Restore README, release acceptance, and package script edits owned by this task from git. 2) Run npm run release:check to confirm rollback state."}

## 스펙 매핑 표

| REQ-ID | TASK-ID |
|---|---|
| `FR-PRD-006` | `TASK-P0-001`, `TASK-P5-001` |
| `FR-REQ-016` | `TASK-P0-002`, `TASK-P5-001` |
| `FR-CACHE-009` | `TASK-P1-001`, `TASK-P5-001` |
| `FR-CACHE-010` | `TASK-P1-002`, `TASK-P5-001` |
| `FR-CLI-013` | `TASK-P0-003`, `TASK-P5-001` |
| `NFR-REL-008` | `TASK-P2-001`, `TASK-P5-001` |
| `NFR-REL-009` | `TASK-P2-002`, `TASK-P5-001` |
| `NFR-SEC-010` | `TASK-P3-001`, `TASK-P5-001` |
| `FR-MCP-014` | `TASK-P3-002`, `TASK-P5-001` |
| `FR-MCP-015` | `TASK-P3-003`, `TASK-P5-001` |
| `NFR-REL-010` | `TASK-P4-001`, `TASK-P5-001` |
| `NFR-PERF-007` | `TASK-P4-002`, `TASK-P5-001` |

## 리스크 및 완화

| 리스크 | 영향 | 완화 |
|---|---|---|
| File lock이 Windows에서 POSIX와 다르게 동작 | apply concurrency test flake | exclusive create와 explicit cleanup 위주로 구현하고 platform-specific pid check는 보수적으로 둔다. |
| SRS-scale perf test가 기본 CI를 느리게 함 | release gate 불안정 | 기본 perf smoke와 env opt-in SRS-scale을 분리한다. |
| MCP SDK의 outputSchema/invalid params 노출 방식 차이 | test assertion 불안정 | SDK가 노출하는 official shape를 고정하고 domain error와 input error를 별도 테스트로 분리한다. |
| symlink 생성이 Windows 권한에 막힘 | security test platform flake | symlink test는 capability detection 후 skip reason을 남기고, path realpath helper unit test로 보완한다. |

## 용어집

| 용어 | 정의 |
|---|---|
| remediation | 구현 검토에서 발견된 SRS-구현 간극을 닫는 후속 수정 |
| source of truth | SpecKiwi에서 원본으로 취급하는 `.speckiwi/**/*.yaml` |
| stale cache | YAML 원본 또는 search setting과 manifest hash가 달라져 재생성이 필요한 cache |
| bypass | cache read와 cache write를 모두 사용하지 않는 실행 모드 |
| target lock | 하나의 `.speckiwi` 문서 target에 대한 apply 동시 실행 방지 장치 |
| invalid params | MCP JSON-RPC 입력 shape 오류를 나타내는 protocol-level 오류 |

## 메타

- mode: NORMAL
- 평가 기준: 스펙 매핑 100%, CRITICAL/HIGH 0 목표
- routing_hint: `snoworca-pm PLAN_PATH=docs/plans/plan-20260501-speckiwi-v1-remediation.md --tdd --headless`
