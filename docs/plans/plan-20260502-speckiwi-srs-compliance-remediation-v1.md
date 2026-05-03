---
plan_contract: "1.1.0"
plan_id: "plan-20260502-speckiwi-srs-compliance-remediation-v1"
previous_hash: null
produced_by: "snoworca-planner@2.2.2"
title: "SpecKiwi SRS compliance remediation plan"
mode: "NORMAL"
produced_at: "2026-05-02T11:40:00+09:00"
spec_path: "docs/spec/srs.md"
spec_refs:
  - "docs/spec/srs.md"
  - "docs/plans/plan-20260502-speckiwi-integrity-remed-v1.md"
  - "docs/research/20260501-speckiwi-performance-indexing-research.md"
x-snoworca-code-path: "."
x-srs-scope: "residual-findings-remediation"
output_path: "docs/plans/plan-20260502-speckiwi-srs-compliance-remediation-v1.md"
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
  - {shell: "bash", cmd: "npm test -- test/cache/cache.test.ts test/search/search.test.ts test/mcp/tools.test.ts test/graph/graph.test.ts test/write/apply.test.ts test/cli/read-commands.test.ts test/cli/doctor.test.ts", expected_exit: 0}
  - {shell: "pwsh", cmd: "npm test -- test/cache/cache.test.ts test/search/search.test.ts test/mcp/tools.test.ts test/graph/graph.test.ts test/write/apply.test.ts test/cli/read-commands.test.ts test/cli/doctor.test.ts", expected_exit: 0}
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
  - {pattern: "적[절]히|필요\\s*시|알아[서]|상황에\\s*맞게|기존\\s*방식대로|어떻게[든]", flags: ""}
phases:
  - id: "PHASE-P0"
    title: "Cache source-of-truth hardening"
    tasks:
      - {id: "TASK-P0-001"}
      - {id: "TASK-P0-002"}
  - id: "PHASE-P1"
    title: "MCP schema and output contract hardening"
    tasks:
      - {id: "TASK-P1-001"}
      - {id: "TASK-P1-002"}
      - {id: "TASK-P1-003"}
  - id: "PHASE-P2"
    title: "Graph diagnostics preservation"
    tasks:
      - {id: "TASK-P2-001"}
      - {id: "TASK-P2-002"}
  - id: "PHASE-P3"
    title: "Write proposal validation and user recovery"
    tasks:
      - {id: "TASK-P3-001"}
      - {id: "TASK-P3-002"}
  - id: "PHASE-P4"
    title: "CLI and SRS coverage tests"
    tasks:
      - {id: "TASK-P4-001"}
      - {id: "TASK-P4-002"}
---

# SpecKiwi SRS Compliance Remediation Plan

## 개요

이 계획은 `docs/spec/srs.md`와 기능 검증 리뷰 결과를 기준으로 남은 SRS 미충족 항목을 보완하기 위한 실행 계획이다. 테스트와 release gate는 통과했지만, 엄격한 SRS 판정에서 발견된 cache source-of-truth 위험, MCP invalid params와 output schema 약점, graph diagnostics 손실, proposal patch 검증 약점, CLI/MCP black-box 커버리지 공백을 해결한다.

JSON 사이드카: `docs/plans/plan-20260502-speckiwi-srs-compliance-remediation-v1.md.json`

이번 계획의 제외 범위:

- `NFR-PERF-002` cached search 500ms 목표 달성을 위한 성능 최적화
- `SPECKIWI_ASSERT_SEARCH_PERF=1 npm run perf:srs` 실패 보완
- 인덱싱 구조 재설계와 latency budget 조정

## SRS 34.6 범위 선언

이 문서는 전체 v1.0 구현을 처음부터 다시 계획하는 문서가 아니라, 2026-05-02 SRS 대조 검증에서 남은 미충족과 커버리지 공백을 닫는 보완 계획이다. 이미 구현과 release gate로 확인된 항목은 새 TASK를 만들지 않고 아래 상태 표로 고정한다.

| SRS 34.6 항목 | 상태 | 근거 |
|---|---|---|
| PRD item ID 중복 validation | 이미 충족, 유지 검증 | `src/validate/semantic.ts`, `test/validate/semantic.test.ts`, `test/release/acceptance.test.ts` |
| requirement list `project` 필터 | 이미 충족, 유지 검증 | `src/core/requirements.ts`, `src/cli/commands/list.ts`, `test/cli/read-commands.test.ts`, `test/mcp/tools.test.ts` |
| valid search cache read path | 부분 충족, source-of-truth 보완 필요 | `TASK-P0-001`, `TASK-P0-002` |
| `--no-cache` read/write 우회 | 이미 충족, CLI black-box 보강 | `TASK-P4-001`, 기존 `test/cli/req-write.test.ts`, `test/cli/export.test.ts` |
| apply concurrency와 stale lock cleanup | 이미 충족, 유지 검증 | `test/write/apply-concurrency.test.ts`, `test/hardening/reliability.test.ts` |
| symlink traversal read/write 거부 | 이미 충족, 유지 검증 | `test/hardening/security.test.ts`, `test/write/apply.test.ts`, `test/write/proposal.test.ts` |
| MCP invalid params와 domain error 구분 | 보완 필요 | `TASK-P1-001` |
| MCP output schema | 보완 필요 | `TASK-P1-002` |
| release acceptance gate | 이미 충족, 유지 검증 | `scripts/release-check.mjs`, `test/release/acceptance.test.ts` |
| 성능 목표 직접 검증 | 잔존 성능 리스크, 본 계획 제외 | 별도 성능 계획에서 처리 |

## 선행 조건 및 전제

- `.speckiwi/**/*.yaml`은 유일한 source of truth다.
- `.speckiwi/cache/**/*.json`과 `.speckiwi/cache/manifest.json`은 모두 재생성 가능한 artifact이며 사용자 입력으로 신뢰하지 않는다.
- default read path의 정합성 보완이 일시적인 cache hit rate 저하를 만들 수 있다. 이번 계획은 정합성 우선이며 500ms 성능 달성은 별도 계획에서 다룬다.
- Core DTO의 `diagnostics`는 CLI JSON 출력과 MCP `structuredContent`에서 같은 의미로 관찰되어야 한다.
- 파일 수정은 `src/`, `schemas/`, `test/`와 이 계획에서 지정한 문서 산출물로 한정한다.

## 프로젝트 온보딩 컨텍스트

SpecKiwi는 repository-local `.speckiwi/` YAML 문서를 읽어 CLI와 stdio MCP로 SDD context 조회, 검색, 검증, graph, write proposal, markdown export를 제공하는 Node.js/TypeScript 도구다. 데이터베이스와 HTTP 서버는 v1 범위 밖이다.

주요 디렉토리 맵:

| 경로 | 역할 |
|---|---|
| `src/core/` | CLI/MCP가 공유하는 Core API와 DTO orchestration |
| `src/cache/` | cache manifest, fingerprint, rebuild, clean |
| `src/search/`, `src/indexing/` | search document flattening, BM25, exact/filter index serialization |
| `src/graph/` | graph, trace, impact DTO 생성 |
| `src/mcp/` | stdio MCP tool/resource schema, handler, structuredContent |
| `src/write/` | proposal 생성, JSON Patch 적용, apply lock, atomic write |
| `schemas/` | YAML/managed artifact JSON Schema |
| `test/` | Vitest unit, CLI, MCP, hardening, release acceptance tests |

핵심 규칙:

- cache를 source data로 반환하지 않는다. cache hit 결과는 source-derived validity 조건을 만족해야 한다.
- MCP shape 오류는 handler 진입 전 `InvalidParams` 계열로 분리한다.
- `--no-cache`는 cache read와 write를 모두 우회한다.
- destructive write는 confirm, allowApply, validation, lock, stale check를 모두 통과해야 한다.
- 테스트 fixture의 `.speckiwi/cache` 갱신은 의도된 테스트 결과일 때만 허용한다.

빌드와 테스트 치트시트:

| 목적 | 명령 |
|---|---|
| 빌드 | `npm run build` |
| 타입 검사 | `npm run typecheck` |
| 정적 분석 | `npm run lint` |
| 전체 테스트 | `npm test` |
| release gate | `npm run release:check` |

## AI 에이전트 실행 가드

`scope_freeze`는 이 계획 생성 게이트 통과 후 `true`로 고정했다. scope 확장은 사용자 승인을 받은 별도 `change_log` 항목으로만 추가한다.

`pre_commit_gate`와 `forbidden_patterns`는 frontmatter를 SSOT로 사용한다. 각 TASK의 `acceptance_tests`는 TASK 종료 시점 검증이고, `pre_commit_gate`는 전체 작업 완료 뒤 커밋 직전 검증이다.

## Phase P0 - Cache Source-Of-Truth Hardening

목표: cache artifact와 manifest가 동시에 조작되어도 YAML에 없는 entity가 public read result로 반환되지 않도록 source-authenticated cache 정책을 도입한다.

### TASK-P0-001 - Add Source-Authenticated Search Result Hydration

- 관련 REQ-ID: `FR-STOR-001`, `FR-STOR-002`, `FR-CACHE-001`, `FR-CACHE-002`, `FR-CACHE-007`, `FR-SRCH-009`
- 파일 경로: `src/core/search.ts`, `src/core/read-model.ts`, `src/search/index.ts`, `src/search/document.ts`, `src/indexing/full-text.ts`, `test/search/search.test.ts`, `test/cache/cache.test.ts`
- 메서드/함수 시그니처:
  - `export function rehydrateSearchResultsFromSource(result: SearchResultSet, sourceDocuments: readonly SearchDocument[]): { result: SearchResultSet; mismatchCount: number }`
  - `async function loadSearchSourceAudit(root: WorkspaceRoot): Promise<readonly SearchDocument[]>`
  - `export function searchWorkspaceFromReadModel(input: SearchInput, model: ReadModel, options?: { extraWarnings?: Diagnostic[]; sourceDocuments?: readonly SearchDocument[] }): SearchResultSet`
- 참고 패턴:
  - `src/core/search.ts:11-31`의 `searchWorkspace()` flow
  - `src/search/index.ts:52-99`의 search result construction
  - `src/search/document.ts:52-62`의 source flattening
  - `src/indexing/full-text.ts:48-72`의 indexed document shape
- source_anchors:
  - `src/core/search.ts:11-31`
  - `src/search/index.ts:52-99`
  - `src/search/document.ts:52-62`
  - `src/indexing/full-text.ts:48-72`
- 구현 가이드:
  1. `searchWorkspace()`에서 `model.stats.mode === "cache"`인 경우 source YAML을 로드해 `flattenWorkspace()` 기반 audit document set을 만든다.
  2. `searchWorkspaceFromReadModel()`은 sync helper로 유지하되 `options.sourceDocuments`를 받아 public result rehydration을 수행한다. async source load는 `searchWorkspace()` 안에서 끝낸다.
  3. cache result의 `(entityType, id, path, documentId?)`가 source audit set에 없으면 result에서 제거하고 warning `SEARCH_CACHE_SOURCE_MISMATCH`를 추가한다.
  4. source audit set에 같은 entity가 있으면 cache의 `title`, `scope`, `path`, `documentId` 등 public DTO 필드를 source document 값으로 재수화한다. cache와 source public field가 다르면 재수화 후 warning을 추가한다.
  5. `score`와 `matchedFields`는 source text에서 query token이 관찰되는 경우에만 유지한다. 관찰되지 않으면 해당 result를 제거한다.
  6. 제거 또는 재수화가 발생하면 `page.total`과 `page.returned`를 재계산한다.
  7. BM25 scoring 개선과 500ms latency 최적화는 이 TASK에 넣지 않는다.
- Rationale: manifest와 artifact를 동시에 조작하는 공격은 순수 hash freshness만으로는 식별할 수 없다. public DTO 필드를 source에서 재수화하고 query 관찰 여부를 확인해야 cache가 원본처럼 동작하지 않는다.
- 함정 / 주의사항:
  - `cacheMode: "bypass"`는 기존 YAML source path만 사용해야 한다.
  - cache 후보 누락을 완벽히 검출하려면 search index 재생성이 필요하다. 이 TASK는 fake result 차단과 warning을 우선한다.
  - exact ID query에서 fake cache result가 score 1.0으로 통과하지 않도록 먼저 테스트를 작성한다.
- 테스트 작성 지침:
  - success: 정상 cache hit에서 YAML source와 같은 `id`, `title`, `scope`, `path`, `matchedFields`가 반환된다.
  - failure: search-index와 manifest hash를 함께 조작해 YAML에 없는 fake requirement ID를 넣으면 result에서 제거되고 `SEARCH_CACHE_SOURCE_MISMATCH` warning이 포함된다.
  - boundary: 기존 requirement ID는 같지만 cache의 `title` 또는 `scope`만 조작하면 source 값으로 재수화되고 warning이 포함된다.
- 검증 명령어: `npm test -- test/cache/cache.test.ts test/search/search.test.ts`
- acceptance_tests:
  - {shell: "bash", cmd: "npm test -- test/cache/cache.test.ts test/search/search.test.ts", expected_exit: 0}
  - {shell: "pwsh", cmd: "npm test -- test/cache/cache.test.ts test/search/search.test.ts", expected_exit: 0}
- DoD:
  - cache와 manifest를 함께 조작해도 YAML에 없는 search result가 반환되지 않는다.
  - source audit mismatch는 warning으로 관찰된다.
- rollback: {strategy: "manual", command: "1) Revert edits in src/core/search.ts, src/search/index.ts, src/search/document.ts, src/indexing/full-text.ts. 2) Run npm test -- test/cache/cache.test.ts test/search/search.test.ts and confirm baseline behavior."}
- 예상 소요: 4~7시간

### TASK-P0-002 - Make Entity Cache Hits Source-Verified Before Returning Requirements

- 관련 REQ-ID: `FR-STOR-001`, `FR-STOR-002`, `FR-REQ-002`, `FR-CACHE-002`, `FR-CACHE-007`
- 파일 경로: `src/core/requirements.ts`, `src/core/read-model.ts`, `test/cache/cache.test.ts`
- 메서드/함수 시그니처:
  - `async function confirmCachedRequirementAgainstSource(root: WorkspaceRoot, cached: RegisteredRequirement): Promise<boolean>`
  - `async function getRequirementFromEntityCache(input: GetRequirementInput, root: WorkspaceRoot): Promise<{ result?: RequirementResult; warnings: Diagnostic[] }>`
- 참고 패턴:
  - `src/core/requirements.ts:588-660`의 entity cache exact lookup path
  - `src/core/requirements.ts:540-560`의 deterministic filter helpers
  - `src/core/read-model.ts:185-210`의 source read model construction
- source_anchors:
  - `src/core/requirements.ts:588-660`
  - `src/core/requirements.ts:540-560`
  - `src/core/read-model.ts:185-210`
- 구현 가이드:
  1. entity cache hit에서 summary path와 shard requirement를 얻은 뒤 source YAML document를 로드한다.
  2. source document에 같은 requirement ID가 없으면 cache miss로 처리하고 warning `ENTITY_CACHE_SOURCE_MISMATCH`를 반환한다.
  3. source requirement의 `statement`, `status`, `type`, `title`, `scope`, `documentId`, `path`가 cached DTO와 불일치하면 cache miss로 처리한다.
  4. `includeRelations: true`에서는 relation target set도 source relation과 비교한다.
  5. mismatch 시 `getRequirementFromReadModel()` 또는 source registry path로 이동해 YAML 값을 반환한다.
- Rationale: exact requirement lookup은 SRS의 핵심 API이므로 cache artifact를 단독 source로 삼으면 안 된다.
- 함정 / 주의사항:
  - 이 TASK는 exact lookup 정합성 보완이다. 대형 workspace latency 최적화는 별도 성능 계획에서 다룬다.
  - source document load 실패는 기존 diagnostics policy를 따라 source validation warning 또는 error로 드러낸다.
- 테스트 작성 지침:
  - requirement shard와 manifest를 함께 fake statement로 조작한다.
  - `getRequirement()`가 YAML source statement를 반환하고 warning을 포함하는지 확인한다.
  - `includeRelations: true`에서도 fake relation이 반환되지 않는지 확인한다.
- 검증 명령어: `npm test -- test/cache/cache.test.ts`
- acceptance_tests:
  - {shell: "bash", cmd: "npm test -- test/cache/cache.test.ts", expected_exit: 0}
  - {shell: "pwsh", cmd: "npm test -- test/cache/cache.test.ts", expected_exit: 0}
- DoD:
  - exact requirement cache hit은 source document 확인 후에만 반환된다.
  - cache와 manifest 동시 조작이 fake requirement DTO 반환으로 이어지지 않는다.
- rollback: {strategy: "manual", command: "1) Revert edits in src/core/requirements.ts and src/core/read-model.ts. 2) Run npm test -- test/cache/cache.test.ts."}
- 예상 소요: 4~6시간

## Phase P1 - MCP Schema And Output Contract Hardening

목표: MCP input invalid params와 output schema가 SRS의 observable contract와 일치하도록 만든다.

### TASK-P1-001 - Enforce Apply Change XOR In MCP Input Schema

- 관련 REQ-ID: `FR-MCP-014`, `FR-MCP-013`, `NFR-MAINT-007`
- 파일 경로: `src/mcp/schemas.ts`, `src/mcp/tools.ts`, `test/mcp/tools.test.ts`
- 메서드/함수 시그니처:
  - `export const applyChangeInputSchema = z.strictObject(...).superRefine((value, ctx) => void)`
  - `async function parseToolInput(tool: RegisteredTool, input: unknown, toolName: string): Promise<unknown>`
- 참고 패턴:
  - `src/core/inputs.ts:117-135`의 TypeScript XOR type
  - `src/mcp/schemas.ts:167-173`의 현재 zod schema
  - `src/mcp/tools.ts:223-232`의 InvalidParams conversion
- source_anchors:
  - `src/core/inputs.ts:117-135`
  - `src/mcp/schemas.ts:167-173`
  - `src/mcp/tools.ts:223-232`
- 구현 가이드:
  1. `proposalId`, `proposalPath`, `change` 중 정의된 값의 개수를 계산하는 schema-level refine을 추가한다.
  2. count가 1이 아니면 zod issue를 추가해 `parseToolInput()`에서 `McpError(ErrorCode.InvalidParams, ...)`로 변환되게 한다.
  3. `confirm`은 boolean required로 유지한다.
  4. `change` 내부에는 `cacheMode`를 허용하지 않는 현재 구조를 유지한다.
- Rationale: handler 내부 domain error와 JSON-RPC invalid params는 SRS에서 구분되어야 한다.
- 함정 / 주의사항:
  - Core `applyChange()`의 `hasExactlyOneChangeSource()` guard는 defense-in-depth로 유지한다.
  - `undefined` property와 property 부재를 같은 미정의 값으로 계산한다.
- 테스트 작성 지침:
  - `{ confirm: true }` 호출이 JSON-RPC `InvalidParams`로 실패하는지 검증한다.
  - `{ confirm: true, proposalId: "x", proposalPath: "proposals/x.yaml" }`도 handler 진입 전 실패해야 한다.
  - valid `proposalId` 단일 입력은 기존 domain path로 이동한다.
- 검증 명령어: `npm test -- test/mcp/tools.test.ts`
- acceptance_tests:
  - {shell: "bash", cmd: "npm test -- test/mcp/tools.test.ts", expected_exit: 0}
  - {shell: "pwsh", cmd: "npm test -- test/mcp/tools.test.ts", expected_exit: 0}
- DoD:
  - MCP apply shape 오류는 `isError` Core result가 아니라 JSON-RPC invalid params로 관찰된다.
- rollback: {strategy: "manual", command: "1) Revert edits in src/mcp/schemas.ts and test/mcp/tools.test.ts. 2) Run npm test -- test/mcp/tools.test.ts."}
- 예상 소요: 2~3시간

### TASK-P1-002 - Replace Generic MCP Output Schema With Tool-Specific DTO Schemas

- 관련 REQ-ID: `FR-MCP-015`, `FR-MCP-TR-006`, `NFR-MAINT-007`
- 파일 경로: `src/mcp/structured-content.ts`, `src/mcp/tools.ts`, `src/mcp/schemas.ts`, `test/mcp/tools.test.ts`
- 메서드/함수 시그니처:
  - `export function toolOutputSchemaFor(name: string): z.ZodTypeAny`
  - `export const searchOutputSchema: z.ZodTypeAny`
  - `export const graphOutputSchema: z.ZodTypeAny`
  - `export const applyOutputSchema: z.ZodTypeAny`
- 참고 패턴:
  - `src/mcp/structured-content.ts:4-27`의 structuredContent conversion
  - `src/mcp/tools.ts:191-194`의 generic output schema
  - `src/mcp/tools.ts:235-248`의 output validation
- source_anchors:
  - `src/mcp/structured-content.ts:4-27`
  - `src/mcp/tools.ts:191-194`
  - `src/mcp/tools.ts:235-248`
- 구현 가이드:
  1. 공통 `machineResultBaseSchema`를 `ok`, `diagnostics` 중심으로 정의한다.
  2. tool별 `data` payload schema를 최소한의 DTO 필수 필드로 정의한다. 예: search는 `query`, `mode`, `results`, `page`; graph는 `graphType`, `nodes`, `edges`; apply는 `mode`, `applied`, `modifiedFiles?`, `cacheStale?`.
  3. `toolOutputSchemaFor(name)`이 tool name별 schema를 반환하게 한다.
  4. error result도 `ok:false`, `error`, `diagnostics` schema로 검증한다. `validateToolOutput()`의 `result.isError === true` skip을 제거하거나 error schema 검증 branch로 교체한다.
  5. DTO의 optional 확장은 `.passthrough()`로 허용하되 필수 observable fields는 고정한다.
- Rationale: outputSchema가 `{ ok }`만 요구하면 MCP metadata가 Core DTO를 설명한다는 SRS 조건을 충족하기 어렵다.
- 함정 / 주의사항:
  - 모든 Core DTO를 완전 복제하지 않는다. public 필수 필드 중심으로 schema를 둔다.
  - error result의 `content[0].text` JSON 문자열은 structuredContent 검증과 별개다.
- 테스트 작성 지침:
  - 모든 `speckiwi_*` tool의 outputSchema가 generic object와 다른 필수 field를 갖는지 검증한다.
  - 성공 result와 error result 모두 `validateToolOutput()`을 통과하는지 검증한다.
  - 깨진 error structuredContent가 validation error를 유발하는지 단위 테스트한다.
- 검증 명령어: `npm test -- test/mcp/tools.test.ts`
- acceptance_tests:
  - {shell: "bash", cmd: "npm test -- test/mcp/tools.test.ts", expected_exit: 0}
  - {shell: "pwsh", cmd: "npm test -- test/mcp/tools.test.ts", expected_exit: 0}
- DoD:
  - tool별 outputSchema가 실제 structuredContent의 핵심 DTO 필드를 설명한다.
  - error output도 schema validation 대상이다.
- rollback: {strategy: "manual", command: "1) Revert edits in src/mcp/structured-content.ts, src/mcp/tools.ts, src/mcp/schemas.ts. 2) Run npm test -- test/mcp/tools.test.ts."}
- 예상 소요: 4~6시간

### TASK-P1-003 - Add MCP Success Path Black-Box Coverage

- 관련 REQ-ID: `FR-MCP-003`, `FR-MCP-007`, `FR-MCP-008`, `FR-MCP-012`, `FR-MCP-013`
- 파일 경로: `test/mcp/tools.test.ts`, `src/mcp/tools.ts`
- 메서드/함수 시그니처:
  - `async function callRegisteredTool(server: McpServer, name: string, args: unknown): Promise<CallToolResult>`
- 참고 패턴:
  - `src/mcp/tools.ts:49-58` for `speckiwi_read_document`
  - `src/mcp/tools.ts:100-121` for preview and trace tools
  - `src/mcp/tools.ts:160-181` for propose and apply tools
- source_anchors:
  - `src/mcp/tools.ts:49-58`
  - `src/mcp/tools.ts:100-121`
  - `src/mcp/tools.ts:160-181`
- 구현 가이드:
  1. test helper를 통해 registered MCP tool handler를 실제 schema parse와 output validation path로 호출한다.
  2. `speckiwi_read_document`가 registered document DTO를 반환하는지 확인한다.
  3. `speckiwi_preview_requirement_id`가 source YAML을 수정하지 않고 preview DTO를 반환하는지 확인한다.
  4. `speckiwi_trace_requirement`가 trace DTO를 반환하는지 확인한다.
  5. `speckiwi_propose_change`가 proposal file을 만들고 source YAML을 변경하지 않는지 확인한다.
  6. `speckiwi_apply_change`가 confirm, allowApply, validation을 통과하는 temp workspace에서 원본 YAML을 수정하고 success DTO를 반환하는지 확인한다.
- Rationale: 등록과 schema 존재만으로는 MCP tool의 성공 path contract를 보장할 수 없다.
- 함정 / 주의사항:
  - propose test는 temp workspace에서 실행한다.
  - generated proposal file은 source registry 대상이 아님을 함께 확인한다.
- 테스트 작성 지침:
  - success: `read_document`, `preview_requirement_id`, `trace_requirement`, `propose_change`, `apply_change`가 각각 expected DTO 필드를 반환한다.
  - failure: apply는 allowApply=false 또는 invalid params가 기존 negative path로 실패한다.
  - boundary: propose 후 apply를 같은 temp workspace에서 연결하고 proposal 생성 전후 source YAML hash 변화를 분리 검증한다.
- 검증 명령어: `npm test -- test/mcp/tools.test.ts`
- acceptance_tests:
  - {shell: "bash", cmd: "npm test -- test/mcp/tools.test.ts", expected_exit: 0}
  - {shell: "pwsh", cmd: "npm test -- test/mcp/tools.test.ts", expected_exit: 0}
- DoD:
  - 위 5개 MCP tool은 adapter-level success path 테스트를 가진다.
- rollback: {strategy: "manual", command: "1) Remove the new MCP success path tests. 2) Run npm test -- test/mcp/tools.test.ts."}
- 예상 소요: 3~5시간

## Phase P2 - Graph Diagnostics Preservation

목표: invalid workspace relation diagnostics가 graph, trace, impact result에서 사라지지 않도록 만든다.

### TASK-P2-001 - Preserve Workspace Diagnostics In GraphResult

- 관련 REQ-ID: `FR-GRAPH-010`, `FR-GRAPH-011`, `VAL-ERR-010`, `NFR-REL-007`
- 파일 경로: `src/graph/builder.ts`, `src/core/api.ts`, `src/core/read-model.ts`, `src/cli/commands/graph.ts`, `test/graph/graph.test.ts`
- 메서드/함수 시그니처:
  - `export function buildGraph(workspace: LoadedWorkspace, graphType?: GraphType): GraphResult`
  - `export function buildGraphFromRegistry(registry: RequirementRegistry, graphType?: GraphType, diagnostics?: DiagnosticBag): GraphResult`
  - `buildGraph(graphType?: GraphType): GraphResult`
- 참고 패턴:
  - `src/graph/builder.ts:9-44`의 GraphResult creation
  - `src/validate/semantic.ts:465-492`의 unknown relation diagnostic
  - `src/core/api.ts:113-120`의 Core graph path
  - `src/cli/commands/graph.ts:28-32`의 CLI graph path
- source_anchors:
  - `src/graph/builder.ts:9-44`
  - `src/validate/semantic.ts:465-492`
  - `src/core/api.ts:113-120`
  - `src/cli/commands/graph.ts:28-32`
- 구현 가이드:
  1. `buildGraph(workspace, graphType)`가 `workspace.diagnostics`를 GraphResult에 포함하게 한다.
  2. graph result는 graph DTO를 반환하되 validation errors가 있으면 `diagnostics.summary.errorCount`를 유지한다.
  3. Core read model path의 `model.buildGraph()`도 source diagnostics를 보존한다.
  4. cache graph artifact가 사용되는 경우에도 diagnostics cache section freshness를 확인하거나 source diagnostics를 병합한다.
  5. missing edge drop은 유지할 수 있지만, drop의 원인이 validation error라면 diagnostics로 관찰되어야 한다.
- Rationale: graph consumer가 invalid relation을 "관계 없음"으로 오판하면 traceability 결과가 SRS와 달라진다.
- 함정 / 주의사항:
  - GraphResult DTO의 `ok` semantics를 변경하는 경우 CLI exit code 회귀를 확인한다.
  - diagnostics 병합 시 같은 code/path/details가 중복되지 않도록 deterministic dedupe를 적용한다.
- 테스트 작성 지침:
  - success: valid workspace의 `graph --json`은 기존 deterministic nodes/edges와 errorCount 0을 유지한다.
  - failure: unknown relation target fixture에서 `validate --json`과 `graph --json` 모두 `UNKNOWN_REQUIREMENT_RELATION_TARGET` code를 포함한다.
  - boundary: graph type별 filtering 후에도 diagnostics summary는 동일하게 보존되고 nodes/edges sorting은 변하지 않는다.
- 검증 명령어: `npm test -- test/graph/graph.test.ts test/cli/read-commands.test.ts`
- acceptance_tests:
  - {shell: "bash", cmd: "npm test -- test/graph/graph.test.ts test/cli/read-commands.test.ts", expected_exit: 0}
  - {shell: "pwsh", cmd: "npm test -- test/graph/graph.test.ts test/cli/read-commands.test.ts", expected_exit: 0}
- DoD:
  - invalid relation diagnostics가 graph JSON에서 사라지지 않는다.
- rollback: {strategy: "manual", command: "1) Revert graph diagnostics edits in src/graph, src/core, src/cli. 2) Run npm test -- test/graph/graph.test.ts."}
- 예상 소요: 4~6시간

### TASK-P2-002 - Propagate Graph Diagnostics Through Trace And Impact

- 관련 REQ-ID: `FR-GRAPH-011`, `FR-MCP-008`, `FR-MCP-010`, `VAL-ERR-010`
- 파일 경로: `src/graph/trace.ts`, `src/graph/impact.ts`, `src/core/api.ts`, `test/graph/graph.test.ts`, `test/mcp/tools.test.ts`
- 메서드/함수 시그니처:
  - `export function traceRequirement(input: TraceRequirementInput, graph: GraphResult): TraceResult`
  - `export function impactRequirement(input: ImpactInput, graph: GraphResult): ImpactResult`
- 참고 패턴:
  - `src/graph/trace.ts:6-41`의 trace result creation
  - `src/graph/impact.ts:29-102`의 impact result creation
  - `src/core/api.ts:157-159`의 graph reuse path
- source_anchors:
  - `src/graph/trace.ts:6-41`
  - `src/graph/impact.ts:29-102`
  - `src/core/api.ts:157-159`
- 구현 가이드:
  1. graph input이 `ok:true`지만 diagnostics warnings/errors를 가진 경우 trace/impact result에 diagnostics를 병합한다.
  2. trace/impact 자체 not-found errors와 graph diagnostics가 동시에 발생하면 더 구체적인 operation error를 유지하고 graph diagnostics를 보존한다.
  3. MCP `speckiwi_trace_requirement`와 `speckiwi_impact` outputSchema가 diagnostics를 허용하는지 TASK-P1-002와 맞춘다.
- Rationale: trace와 impact는 graph를 소비하는 public API이므로 graph validation context를 잃으면 SRS diagnostics contract가 끊긴다.
- 함정 / 주의사항:
  - traversal algorithm 자체의 relation matrix는 변경하지 않는다.
  - `duplicates`, `conflicts_with` impact rules의 existing semantics는 회귀 테스트로 고정한다.
- 테스트 작성 지침:
  - invalid relation target workspace에서 trace/impact diagnostics에 unknown target code가 보존되는지 확인한다.
  - `duplicates`와 `conflicts_with` relation이 impact result에 non-transitive로 나타나는지 test case를 추가한다.
- 검증 명령어: `npm test -- test/graph/graph.test.ts test/mcp/tools.test.ts`
- acceptance_tests:
  - {shell: "bash", cmd: "npm test -- test/graph/graph.test.ts test/mcp/tools.test.ts", expected_exit: 0}
  - {shell: "pwsh", cmd: "npm test -- test/graph/graph.test.ts test/mcp/tools.test.ts", expected_exit: 0}
- DoD:
  - trace/impact 결과가 graph diagnostics를 보존한다.
  - `duplicates`, `conflicts_with` relation behavior가 테스트로 고정된다.
- rollback: {strategy: "manual", command: "1) Revert edits in src/graph/trace.ts and src/graph/impact.ts. 2) Run npm test -- test/graph/graph.test.ts test/mcp/tools.test.ts."}
- 예상 소요: 3~5시간

## Phase P3 - Write Proposal Validation And User Recovery

목표: 저장된 proposal YAML과 apply failure가 SRS write policy와 UX 요구사항을 더 명확히 만족하게 한다.

### TASK-P3-001 - Validate Stored Proposal Patch Paths Before Apply

- 관련 REQ-ID: `VAL-ERR-020`, `FR-WRITE-005`, `FR-WRITE-006`, `FR-MCP-012`, `FR-MCP-013`
- 파일 경로: `schemas/proposal.schema.json`, `src/write/proposal.ts`, `src/write/apply.ts`, `test/write/apply.test.ts`, `test/mcp/tools.test.ts`
- 메서드/함수 시그니처:
  - `export async function readProposalAt(root: WorkspaceRoot, storePath: StorePath): Promise<ProposalDocument>`
  - `export function buildPatchOperations(change: ProposedChange): JsonPatchOperation[]`
- 참고 패턴:
  - `schemas/proposal.schema.json:49-84`의 patch operation schema
  - `src/write/proposal.ts:134-142`의 stored proposal load
  - `src/write/patch.ts:56-99`의 JSON Pointer and operation validation
  - `src/write/yaml-update.ts:13-23`의 apply path
- source_anchors:
  - `schemas/proposal.schema.json:49-84`
  - `src/write/proposal.ts:134-142`
  - `src/write/patch.ts:56-99`
  - `src/write/yaml-update.ts:13-23`
- 구현 가이드:
  1. proposal schema의 `changes[].path`와 `base.target.jsonPointer`에 JSON Pointer pattern을 추가한다. root replacement는 금지한다.
  2. `readProposalAt()`에서 schema validation 뒤 `buildPatchOperations({ changes: proposal.changes })`를 호출해 stored proposal의 operation semantics를 검증한다.
  3. invalid patch는 `ProposalError("PROPOSAL_SCHEMA_INVALID" 또는 "INVALID_PATCH", ...)`로 일관되게 변환한다.
  4. `applyChange()`는 invalid stored proposal을 `APPLY_REJECTED_TARGET_INVALID`가 아니라 patch/proposal validation code로 반환하게 한다.
  5. CLI/MCP tests에서 stored malformed proposal이 source YAML을 변경하지 않는지 검증한다.
- Rationale: write API 생성 path만 검증하면 외부에서 작성된 managed proposal YAML이 apply 단계에서 늦게 실패한다.
- 함정 / 주의사항:
  - JSON Schema pattern은 RFC 6901 escape `~0`, `~1`을 허용한다.
  - schema만으로 array index semantic을 검증하지 않는다. semantic validation은 `buildPatchOperations()`와 apply path가 담당한다.
- 테스트 작성 지침:
  - path가 `requirements/0`처럼 slash 없는 proposal은 apply 전에 거부되어야 한다.
  - URI fragment pointer `#/requirements/0`도 거부되어야 한다.
  - valid add/replace/remove proposal은 기존 테스트가 계속 통과해야 한다.
- 검증 명령어: `npm test -- test/write/apply.test.ts test/mcp/tools.test.ts`
- acceptance_tests:
  - {shell: "bash", cmd: "npm test -- test/write/apply.test.ts test/mcp/tools.test.ts", expected_exit: 0}
  - {shell: "pwsh", cmd: "npm test -- test/write/apply.test.ts test/mcp/tools.test.ts", expected_exit: 0}
- DoD:
  - malformed stored proposal patch는 deterministic validation error로 거부된다.
  - source YAML은 malformed proposal apply 시 변경되지 않는다.
- rollback: {strategy: "manual", command: "1) Revert edits in schemas/proposal.schema.json and src/write proposal/apply files. 2) Run npm test -- test/write/apply.test.ts test/mcp/tools.test.ts."}
- 예상 소요: 3~5시간

### TASK-P3-002 - Add Recovery Guidance To Apply Failures

- 관련 REQ-ID: `NFR-UX-007`, `FR-WRITE-005`, `FR-WRITE-006`, `NFR-REL-003`, `NFR-REL-004`
- 파일 경로: `src/write/apply.ts`, `src/cli/human-renderer.ts`, `test/write/apply.test.ts`, `test/cli/req-write.test.ts`
- 메서드/함수 시그니처:
  - `function applyFailure(code: ApplyFailureCode | string, message: string, diagnostics?: DiagnosticBag): ApplyResult`
  - `function recoveryDetailsForApplyFailure(code: string): JsonObject`
- 참고 패턴:
  - `src/write/apply.ts:35-65`의 apply failure branches
  - `src/write/apply.ts:70-110`의 stale, validation, atomic write failure path
  - `src/write/apply.ts:300-314`의 diagnostic creation
- source_anchors:
  - `src/write/apply.ts:35-65`
  - `src/write/apply.ts:70-110`
  - `src/write/apply.ts:300-314`
- 구현 가이드:
  1. apply failure code별 recovery message map을 만든다.
  2. confirm missing, allowApply false, stale proposal, validation error, lock conflict, invalid patch, target invalid에 `details.recovery`를 추가한다.
  3. 기존 atomic write recovery details는 유지하고 map과 중복되지 않게 한다.
  4. CLI human renderer가 diagnostic details recovery를 출력하는지 확인한다. 출력하지 않으면 apply failure branch에만 최소 표시를 추가한다.
  5. JSON output은 `diagnostics.errors[0].details.recovery`로 파싱 가능해야 한다.
- Rationale: apply 실패가 발생했을 때 사용자가 source YAML과 proposal 상태를 어떻게 복구하거나 재시도할지 알 수 있어야 한다.
- 함정 / 주의사항:
  - recovery text에 destructive VCS 명령을 직접 넣지 않는다.
  - machine-readable error code와 message는 호환성을 위해 유지한다.
- 테스트 작성 지침:
  - stale proposal, allowApply false, validation error, lock conflict 중 최소 3개 failure code에서 recovery details가 있는지 검증한다.
  - CLI JSON output과 human output 중 하나 이상에서 recovery가 관찰되는지 확인한다.
- 검증 명령어: `npm test -- test/write/apply.test.ts test/cli/req-write.test.ts`
- acceptance_tests:
  - {shell: "bash", cmd: "npm test -- test/write/apply.test.ts test/cli/req-write.test.ts", expected_exit: 0}
  - {shell: "pwsh", cmd: "npm test -- test/write/apply.test.ts test/cli/req-write.test.ts", expected_exit: 0}
- DoD:
  - 주요 apply failure에는 deterministic recovery guidance가 포함된다.
- rollback: {strategy: "manual", command: "1) Revert edits in src/write/apply.ts and renderer/tests. 2) Run npm test -- test/write/apply.test.ts test/cli/req-write.test.ts."}
- 예상 소요: 2~4시간

## Phase P4 - CLI And SRS Coverage Tests

목표: 기능은 있으나 black-box 증거가 약한 CLI, doctor, OOS coverage를 release confidence 수준으로 올린다.

### TASK-P4-001 - Add CLI Black-Box Tests For Init And Cache Commands

- 관련 REQ-ID: `FR-CLI-001`, `FR-CLI-003`, `FR-CLI-004`, `FR-CACHE-003`, `FR-CACHE-004`, `FR-CACHE-010`
- 파일 경로: `test/cli/read-commands.test.ts`, `test/cache/cache.test.ts`
- 메서드/함수 시그니처:
  - `async function runCli(args: string[], options: { cwd?: string }): Promise<{ status: number; stdout: string; stderr: string }>`
- 참고 패턴:
  - `test/cli/read-commands.test.ts:1-120`의 CLI invocation pattern
  - `src/cli/program.ts` command registration
  - `src/core/cache.ts:1-21` cache command wrappers
- source_anchors:
  - `test/cli/read-commands.test.ts:1-120`
  - `src/core/cache.ts:1-21`
- 구현 가이드:
  1. `speckiwi init --root <tmp>` black-box test로 `.speckiwi` standard tree와 editable YAML files를 검증한다.
  2. `speckiwi cache rebuild --root <tmp> --json`이 manifest/search/graph/diagnostics artifacts를 생성하는지 확인한다.
  3. `speckiwi cache clean --root <tmp> --json`이 generated cache artifacts를 제거하고 source YAML을 유지하는지 확인한다.
  4. `--no-cache` command가 cache directory에 신규 artifact를 만들지 않는 기존 tests와 연결한다.
- Rationale: SRS CLI acceptance는 process-level behavior를 요구한다.
- 함정 / 주의사항:
  - test fixture cache output이 repo fixture를 dirty하게 만들지 않도록 temp workspace를 사용한다.
  - JSON stdout만 parse하고 diagnostic log는 stderr로 분리되는지 확인한다.
- 테스트 작성 지침:
  - success: temp workspace에서 `init`, `cache rebuild --json`, `cache clean --json`이 각각 expected files/result fields를 만든다.
  - failure: invalid `--root` 또는 workspace 누락은 non-zero와 machine-readable error를 반환한다.
  - boundary: `--no-cache` graph/search/export/apply 실행 후 cache artifact와 stale marker가 새로 생기지 않는다.
- 검증 명령어: `npm test -- test/cli/read-commands.test.ts test/cache/cache.test.ts`
- acceptance_tests:
  - {shell: "bash", cmd: "npm test -- test/cli/read-commands.test.ts test/cache/cache.test.ts", expected_exit: 0}
  - {shell: "pwsh", cmd: "npm test -- test/cli/read-commands.test.ts test/cache/cache.test.ts", expected_exit: 0}
- DoD:
  - init, cache rebuild, cache clean은 CLI black-box test로 검증된다.
- rollback: {strategy: "manual", command: "1) Remove new CLI black-box tests. 2) Run npm test -- test/cli/read-commands.test.ts test/cache/cache.test.ts."}
- 예상 소요: 3~5시간

### TASK-P4-002 - Strengthen Doctor, Quiet Option, And OOS Negative Tests

- 관련 REQ-ID: `FR-DOC-CHK-006`, `FR-DOC-CHK-007`, `FR-DOC-CHK-008`, `NFR-SEC-001`, `NFR-SEC-002`, `NFR-UX-001`, `NFR-UX-002`
- 파일 경로: `src/core/doctor.ts`, `test/cli/doctor.test.ts`, `test/hardening/security.test.ts`, `test/cli/read-commands.test.ts`
- 메서드/함수 시그니처:
  - `export async function doctor(input: DoctorInput): Promise<DoctorResult>`
  - `function renderHumanResult(result: MachineResult): string`
- 참고 패턴:
  - `src/core/doctor.ts:87-170`의 current doctor checks
  - `test/cli/doctor.test.ts:1-58`의 doctor test style
  - `test/hardening/security.test.ts`의 security boundary tests
- source_anchors:
  - `src/core/doctor.ts:87-170`
  - `test/cli/doctor.test.ts:1-58`
  - `test/hardening/security.test.ts:1-80`
- 구현 가이드:
  1. doctor가 MCP command availability와 stdout/stderr policy를 더 구체적으로 점검하도록 test first로 고정한다.
  2. `--quiet`가 success human output을 억제하고 JSON output은 machine-readable contract를 유지하는지 CLI test를 추가한다.
  3. OOS negative smoke test에서 HTTP listen, DB file creation, background daemon spawn 부재를 package/runtime level로 확인한다.
  4. 이 TASK는 product behavior 변경보다 SRS 증거 보강에 초점을 둔다.
- Rationale: release 판정에서 OOS와 doctor 요구사항은 기능 부재와 process behavior를 검증해야 한다.
- 함정 / 주의사항:
  - 네트워크 port scan 같은 flaky test는 넣지 않는다. Node module/static process behavior 중심으로 검증한다.
  - `--quiet --json` 조합은 JSON parse 가능성을 깨지 않는다.
- 테스트 작성 지침:
  - success: doctor JSON에 MCP command availability와 stdout/stderr policy check code가 포함된다.
  - failure: `.speckiwi`가 없는 temp root에서 doctor는 필수 파일 누락 diagnostics를 반환한다.
  - boundary: `--quiet`는 human success stdout을 억제하고 `--quiet --json`은 JSON parse 가능성을 유지한다.
  - OOS: static/runtime smoke에서 HTTP server, DB file creation, background daemon spawn이 기본 command path에서 관찰되지 않는다.
- 검증 명령어: `npm test -- test/cli/doctor.test.ts test/hardening/security.test.ts test/cli/read-commands.test.ts`
- acceptance_tests:
  - {shell: "bash", cmd: "npm test -- test/cli/doctor.test.ts test/hardening/security.test.ts test/cli/read-commands.test.ts", expected_exit: 0}
  - {shell: "pwsh", cmd: "npm test -- test/cli/doctor.test.ts test/hardening/security.test.ts test/cli/read-commands.test.ts", expected_exit: 0}
- DoD:
  - doctor MCP/stdout policy, quiet option, OOS negative checks가 observable tests로 존재한다.
- rollback: {strategy: "manual", command: "1) Revert edits in doctor and related tests. 2) Run npm test -- test/cli/doctor.test.ts test/hardening/security.test.ts test/cli/read-commands.test.ts."}
- 예상 소요: 3~5시간

## 스펙 매핑 표

| SRS 요구사항 | TASK |
|---|---|
| `FR-STOR-001`, `FR-STOR-002` | `TASK-P0-001`, `TASK-P0-002` |
| `FR-CACHE-001`, `FR-CACHE-002`, `FR-CACHE-007` | `TASK-P0-001`, `TASK-P0-002` |
| `FR-SRCH-009` | `TASK-P0-001` |
| `FR-REQ-002` | `TASK-P0-002` |
| `FR-MCP-014` | `TASK-P1-001` |
| `FR-MCP-013` | `TASK-P1-001`, `TASK-P1-003`, `TASK-P3-001` |
| `NFR-MAINT-007` | `TASK-P1-001`, `TASK-P1-002` |
| `FR-MCP-015`, `FR-MCP-TR-006` | `TASK-P1-002` |
| `FR-MCP-003`, `FR-MCP-007` | `TASK-P1-003` |
| `FR-MCP-008` | `TASK-P1-003`, `TASK-P2-002` |
| `FR-MCP-012` | `TASK-P1-003`, `TASK-P3-001` |
| `FR-MCP-010` | `TASK-P2-002` |
| `FR-GRAPH-010`, `NFR-REL-007` | `TASK-P2-001` |
| `FR-GRAPH-011`, `VAL-ERR-010` | `TASK-P2-001`, `TASK-P2-002` |
| `VAL-ERR-020` | `TASK-P3-001` |
| `FR-WRITE-005`, `FR-WRITE-006` | `TASK-P3-001`, `TASK-P3-002` |
| `NFR-UX-007`, `NFR-REL-003`, `NFR-REL-004` | `TASK-P3-002` |
| `FR-CLI-001`, `FR-CLI-003`, `FR-CLI-004`, `FR-CACHE-003`, `FR-CACHE-004`, `FR-CACHE-010` | `TASK-P4-001` |
| `FR-DOC-CHK-006`, `FR-DOC-CHK-007`, `FR-DOC-CHK-008`, `NFR-SEC-001`, `NFR-SEC-002`, `NFR-UX-001`, `NFR-UX-002` | `TASK-P4-002` |

## 리스크 및 완화

| 리스크 | 영향 | 완화 |
|---|---|---|
| source-authenticated cache audit가 search latency를 증가시킴 | `NFR-PERF-002`와 충돌 가능 | 이번 계획에서는 correctness를 우선하고, 500ms 달성은 별도 성능 계획으로 분리 |
| MCP output schema를 과도하게 엄격화 | DTO 확장 시 테스트 취약 | 필수 observable field만 고정하고 `.passthrough()`로 확장 허용 |
| graph diagnostics를 error로 승격하면 CLI exit behavior 변화 | 기존 사용자 workflow 영향 | diagnostics 보존을 먼저 적용하고 exit code 변경은 test로 명시 |
| proposal schema pattern이 valid JSON Pointer를 과도하게 거부 | write path false negative | RFC 6901 escape case 테스트를 포함 |

## 용어집

| 용어 | 정의 |
|---|---|
| source of truth | 최종 사실로 신뢰하는 원본 데이터. SpecKiwi v1에서는 `.speckiwi/**/*.yaml`이다. |
| cache artifact | source YAML에서 재생성할 수 있는 `.speckiwi/cache/**/*.json` 파일이다. |
| manifest | cache input/output hash와 version fingerprint를 담는 `.speckiwi/cache/manifest.json`이다. |
| source-authenticated hydration | cache result를 반환하기 전에 source YAML에서 유래한 entity set으로 존재성과 주요 필드를 확인하는 절차다. |
| InvalidParams | MCP JSON-RPC에서 handler 실행 전 request shape가 틀렸음을 나타내는 오류 계열이다. |
| GraphResult | graph nodes, edges, diagnostics를 포함하는 Core DTO다. |
| JSON Pointer | RFC 6901 형식의 `/path/to/value` pointer다. |

## 메타

- mode: NORMAL
- evaluator policy: xhigh semantic reviewer + normal structure reviewer
- Dew File path: `.snoworca/dew/planner/plan-20260502-speckiwi-srs-compliance-remediation-v1/`
- remaining performance risk: `NFR-PERF-002`, `NFR-PERF-005`, `NFR-PERF-007`
- route to coder: `$snoworca-coder PLAN_PATH=docs/plans/plan-20260502-speckiwi-srs-compliance-remediation-v1.md`
