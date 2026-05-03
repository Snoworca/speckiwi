---
plan_contract: "1.1.0"
plan_id: "plan-20260502-speckiwi-integrity-remed-v1"
previous_hash: null
produced_by: "snoworca-planner@2.2.2"
title: "SpecKiwi functional integrity remediation plan"
mode: "NORMAL"
produced_at: "2026-05-02T09:07:12+09:00"
spec_path: "docs/spec/srs.md"
spec_refs:
  - "docs/spec/srs.md"
  - "docs/research/20260501-speckiwi-performance-indexing-research.md"
  - "docs/plans/plan-20260501-speckiwi-performance-indexing-v1.md"
code_path: "."
output_path: "docs/plans/plan-20260502-speckiwi-integrity-remed-v1.md"
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
  - {shell: "bash", cmd: "npm test -- test/hardening/security.test.ts test/cache/cache.test.ts test/search/search.test.ts test/cli/read-commands.test.ts test/mcp/tools.test.ts test/graph/graph.test.ts", expected_exit: 0}
  - {shell: "pwsh", cmd: "npm test -- test/hardening/security.test.ts test/cache/cache.test.ts test/search/search.test.ts test/cli/read-commands.test.ts test/mcp/tools.test.ts test/graph/graph.test.ts", expected_exit: 0}
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
    title: "Secure cache artifact cleanup"
    tasks:
      - {id: "TASK-P0-001"}
      - {id: "TASK-P0-002"}
  - id: "PHASE-P1"
    title: "Cache output hash freshness"
    tasks:
      - {id: "TASK-P1-001"}
      - {id: "TASK-P1-002"}
  - id: "PHASE-P2"
    title: "Read model memo integrity"
    tasks:
      - {id: "TASK-P2-001"}
  - id: "PHASE-P3"
    title: "Functional verification hardening"
    tasks:
      - {id: "TASK-P3-001"}
      - {id: "TASK-P3-002"}
      - {id: "TASK-P3-003"}
---

# SpecKiwi Functional Integrity Remediation Plan

## 개요

이 계획은 3개 서브에이전트의 개선 조사 결과를 `snoworca-planner` 형식으로 통합한 실행 계획이다. 목표는 SRS 기능 검증의 남은 위험을 낮추는 것이다. 범위는 cache artifact 삭제 안전성, cache output hash 무결성, read model memo 무결성, CLI/MCP 기능 검증 테스트 보강으로 고정한다.

JSON 사이드카: `docs/plans/plan-20260502-speckiwi-integrity-remed-v1.md.json`

이번 계획에서 제외하는 항목:

- `NFR-PERF-002`의 cached search 500ms 목표 미달 보완
- `SPECKIWI_ASSERT_SEARCH_PERF=1 npm run perf:srs` 실패 보완
- 순수 성능 최적화, indexing 구조 재설계, latency budget 조정

최종 gate에도 `npm run perf:srs`를 넣지 않는다. 기능과 무결성 회귀는 build, typecheck, lint, targeted tests, release check로 검증한다.

## 조사 결과 요약

| 조사 축 | 핵심 결론 | 계획 반영 |
|---|---|---|
| 보안/파일시스템 cleanup | `src/cache/rebuild.ts`와 `src/cache/clean.ts`의 shard cleanup이 symlink escape guard 없이 `resolve()` 기반 삭제를 수행한다. | Phase P0 |
| cache 무결성/read path | manifest output hash가 저장되지만 freshness check에서 실제 bytes hash와 비교되지 않는다. exact requirement cache도 output 존재만 본다. | Phase P1 |
| memo 무결성 | read model memo key가 artifact stat 기반이라 size/mtime 보존 변조에서 stale model 재사용 위험이 남는다. | Phase P2 |
| 기능 검증 | 상태, scope, type, tag, project filter와 MCP invalid params, graph no-cache 직접 테스트가 부족하다. | Phase P3 |

## 선행 조건

- Node.js 20 이상, TypeScript ESM, Vitest, ESLint 구성을 유지한다.
- `.speckiwi/**/*.yaml`이 source of truth이고 cache JSON은 재생성 가능한 산출물이라는 원칙을 유지한다.
- cache artifact 경로 검증은 `src/io/path.ts`의 realpath guard 계열과 같은 trust boundary를 사용한다.
- corrupt 또는 hash mismatch cache는 fresh가 아니며, 정상 source fallback 또는 cache rebuild 경로로 흘러야 한다.
- CLI와 MCP public schema, error envelope, structuredContent 형태를 변경하지 않는다.

## Phase P0 - Secure Cache Artifact Cleanup

목표: cache shard cleanup이 workspace 밖 파일을 삭제하지 못하도록 guard된 삭제 경로를 적용한다.

### TASK-P0-001 - Add Guarded Cache Artifact Deletion

- 관련 REQ-ID: `NFR-SEC-001`, `NFR-SEC-002`, `FR-CACHE-001`, `FR-CACHE-006`
- 파일 경로: `src/cache/rebuild.ts`, `src/cache/clean.ts`, `src/io/path.ts`
- 메서드/함수 시그니처:
  - `async function deleteCacheArtifactIfInside(root: WorkspaceRoot, storePath: string, guard: RealPathGuard): Promise<boolean>`
  - 또는 동일 책임의 `src/cache` 내부 helper
- source_anchors: `src/cache/rebuild.ts:73-82`, `src/cache/clean.ts:38-47`, `src/io/path.ts:83-107`, `src/indexing/serialization.ts:59-70`
- 구현 가이드:
  1. stale shard cleanup 전에 `createRealPathGuard(root)`를 만든다.
  2. `cache/requirements/<64hex>.json` store path를 `resolveRealStorePathWithGuard(root, storePath, guard)`로 검증한다.
  3. 삭제는 검증 결과의 `absolutePath`에만 수행한다.
  4. `WORKSPACE_ESCAPE` 성격의 오류는 삼키지 않는다. 없는 디렉터리 또는 없는 파일만 무해한 상태로 처리한다.
  5. `rebuildCache()`의 catch cleanup도 generated cache output 삭제에 guard helper를 사용하도록 맞춘다.
- Rationale: cache directory나 shard directory가 symlink일 때 외부 파일 삭제가 가능하면 local-first 도구의 보안 경계가 깨진다.
- 함정 / 주의사항:
  - `resolve(root.speckiwiPath, storePath)`만 사용하는 삭제 경로를 남기지 않는다.
  - path 문자열 regex 통과가 realpath workspace 내부성을 보장하지 않는다.
- 테스트 작성 지침: TASK-P0-002에서 symlink fixture로 검증한다.
- 검증 명령어: `npm test -- test/hardening/security.test.ts test/cache/cache.test.ts`
- acceptance_tests:
  - {shell: "bash", cmd: "npm test -- test/hardening/security.test.ts test/cache/cache.test.ts", expected_exit: 0}
  - {shell: "pwsh", cmd: "npm test -- test/hardening/security.test.ts test/cache/cache.test.ts", expected_exit: 0}
- DoD: shard cleanup과 generated artifact cleanup이 모두 guard helper를 통과한다.
- rollback: {strategy: "manual", command: "Restore src/cache/rebuild.ts and src/cache/clean.ts from git, then run npm test -- test/cache/cache.test.ts."}
- 예상 소요: 2~4시간

### TASK-P0-002 - Add Symlink Cleanup Security Tests

- 관련 REQ-ID: `NFR-SEC-001`, `NFR-SEC-002`, `FR-CACHE-006`
- 파일 경로: `test/hardening/security.test.ts`, `test/cache/cache.test.ts`
- 메서드/함수 시그니처:
  - `async function createSymlinkedRequirementCacheFixture(): Promise<{ root: string; externalFile: string }>`
- source_anchors: `test/hardening/security.test.ts:112-134`, `test/cache/cache.test.ts:1-80`, `src/cache/rebuild.ts:73-82`, `src/cache/clean.ts:38-47`
- 구현 가이드:
  1. temp external directory에 `aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.json`을 만든다.
  2. workspace의 `.speckiwi/cache/requirements`를 external directory symlink로 만든다.
  3. `rebuildCache()`를 실행하고 external shard file이 남아 있는지 검증한다.
  4. `cleanCache()`를 실행하고 external shard file이 남아 있는지 검증한다.
  5. 결과는 `ok:false` failure 또는 safe no-delete 중 하나를 허용하되, 외부 파일 삭제는 실패로 본다.
- Rationale: 보안 수정은 실제 symlink 공격 형태로 회귀 테스트해야 한다.
- 함정 / 주의사항:
  - Windows symlink 권한 차이를 고려해 test helper가 junction 또는 platform skip을 명확히 선택한다.
  - skip하는 경우에도 POSIX에서는 반드시 실행한다.
- 검증 명령어: `npm test -- test/hardening/security.test.ts test/cache/cache.test.ts`
- acceptance_tests:
  - {shell: "bash", cmd: "npm test -- test/hardening/security.test.ts test/cache/cache.test.ts", expected_exit: 0}
  - {shell: "pwsh", cmd: "npm test -- test/hardening/security.test.ts test/cache/cache.test.ts", expected_exit: 0}
- DoD: symlinked cache shard directory가 외부 파일 삭제로 이어지지 않는 테스트가 red-green으로 추가된다.
- rollback: {strategy: "manual", command: "Remove the new symlink cleanup tests, then run npm test -- test/hardening/security.test.ts."}
- 예상 소요: 2~3시간

## Phase P1 - Cache Output Hash Freshness

목표: manifest에 기록된 output hash를 실제 artifact bytes와 비교해 stale 또는 tampered cache를 fresh로 인정하지 않는다.

### TASK-P1-001 - Verify Manifest Output Hashes In Section Freshness

- 관련 REQ-ID: `FR-CACHE-001`, `FR-CACHE-002`, `FR-CACHE-005`, `FR-CACHE-006`, `FR-CACHE-007`, `NFR-REL-006`
- 파일 경로: `src/cache/manifest.ts`, `src/cache/index-manifest.ts`, `test/cache/cache.test.ts`, `test/search/search.test.ts`
- 메서드/함수 시그니처:
  - `export async function outputsMatchManifest(root: WorkspaceRoot, outputs: CacheFileHash[]): Promise<boolean>`
  - `async function hashCacheOutput(root: WorkspaceRoot, storePath: string): Promise<string | undefined>`
- source_anchors: `src/cache/manifest.ts:102-149`, `src/cache/hash.ts:1-34`, `src/core/search.ts:21-43`, `src/core/read-model.ts:154-178`
- 구현 가이드:
  1. 현재 `outputsExist()`를 hash 검증 helper로 교체한다.
  2. 각 output store path의 실제 file bytes sha256을 계산한다.
  3. `CacheFileHash.sha256` 저장 형식과 같은 prefix 규칙으로 비교한다.
  4. mismatch가 하나라도 있으면 `isIndexSectionFresh(root, section)`은 `false`를 반환한다.
  5. search path는 `false` 결과를 통해 cache read를 건너뛰고 rebuild 또는 source fallback 경로로 이동한다.
- Rationale: output hash를 기록하고도 read freshness에서 쓰지 않으면 valid JSON 변조가 cache hit로 통과한다.
- 함정 / 주의사항:
  - warning만 내고 cache hit를 유지하지 않는다.
  - search section freshness가 graph output hash에 묶이지 않도록 section outputs만 검사한다.
- 테스트 작성 지침:
  - cache rebuild 후 `cache/search-index.json`을 valid JSON이지만 다른 bytes로 수정한다.
  - `isIndexSectionFresh(root, "search")`가 `false`인지 확인한다.
  - `searchWorkspace()`가 stale artifact의 sentinel 값을 반환하지 않는지 검증한다.
- 검증 명령어: `npm test -- test/cache/cache.test.ts test/search/search.test.ts`
- acceptance_tests:
  - {shell: "bash", cmd: "npm test -- test/cache/cache.test.ts test/search/search.test.ts", expected_exit: 0}
  - {shell: "pwsh", cmd: "npm test -- test/cache/cache.test.ts test/search/search.test.ts", expected_exit: 0}
- DoD: manifest output hash mismatch가 모든 index section freshness에서 stale 처리된다.
- rollback: {strategy: "manual", command: "Restore src/cache/manifest.ts and tests from git, then run npm test -- test/cache/cache.test.ts test/search/search.test.ts."}
- 예상 소요: 3~5시간

### TASK-P1-002 - Apply Output Hash Checks To Exact Requirement Cache

- 관련 REQ-ID: `FR-REQ-001`, `FR-REQ-002`, `FR-CACHE-001`, `FR-CACHE-005`, `FR-CACHE-007`
- 파일 경로: `src/core/requirements.ts`, `src/cache/manifest.ts`, `test/cache/cache.test.ts`
- 메서드/함수 시그니처:
  - `async function cacheOutputMatchesManifest(root: WorkspaceRoot, manifest: IndexManifestV2, storePath: string): Promise<boolean>`
  - 또는 TASK-P1-001의 exported helper 재사용
- source_anchors: `src/core/requirements.ts:724-740`, `src/core/requirements.ts:758-764`, `src/core/requirements.ts:783-790`, `src/cache/manifest.ts:138-149`
- 구현 가이드:
  1. `isRequirementCacheFresh()`에서 `cache/entities.json`과 requirement shard의 output hash를 manifest와 비교한다.
  2. `includeRelations === true` 경로에서는 `cache/relations.json`도 hash 검증 대상에 포함한다.
  3. shard store path는 `requirementPayloadShardStorePath(documentHash)`로만 계산한다.
  4. output hash mismatch는 cache miss로 처리하고 YAML source path 결과를 반환한다.
  5. cache-only stale statement, stale entity, stale relation이 응답에 섞이지 않도록 테스트한다.
- Rationale: exact lookup은 SRS 기능의 중심 read path이고, cache artifact 변조가 사용자에게 오답을 주면 안 된다.
- 함정 / 주의사항:
  - source file stat이 unchanged여도 output mismatch는 stale이다.
  - entity cache memo가 hash mismatch 후 stale artifact를 재사용하지 않도록 함께 확인한다.
- 테스트 작성 지침:
  - target requirement shard를 valid JSON이지만 다른 statement로 바꾸고 `getRequirement()`가 source YAML statement를 반환하는지 확인한다.
  - `relations.json`을 valid JSON이지만 다른 relation으로 바꾸고 `includeRelations: true` 결과가 source relation과 일치하는지 확인한다.
- 검증 명령어: `npm test -- test/cache/cache.test.ts`
- acceptance_tests:
  - {shell: "bash", cmd: "npm test -- test/cache/cache.test.ts", expected_exit: 0}
  - {shell: "pwsh", cmd: "npm test -- test/cache/cache.test.ts", expected_exit: 0}
- DoD: exact requirement, entity, shard, relation artifact mismatch가 cache fresh로 처리되지 않는다.
- rollback: {strategy: "manual", command: "Restore src/core/requirements.ts and cache tests from git, then run npm test -- test/cache/cache.test.ts."}
- 예상 소요: 3~5시간

## Phase P2 - Read Model Memo Integrity

목표: process-local memo가 stale artifact 기반 read model을 재사용하지 않도록 cache key를 hash 검증 결과와 연결한다.

### TASK-P2-001 - Include Verified Artifact Hash Signal In Memo Key

- 관련 REQ-ID: `FR-CACHE-005`, `FR-CACHE-006`, `NFR-REL-006`, `NFR-MAINT-001`
- 파일 경로: `src/core/read-model.ts`, `src/cache/manifest.ts`, `test/search/search.test.ts`, `test/mcp/tools.test.ts`
- 메서드/함수 시그니처:
  - `async function hashArtifactIntegrityInputs(root: WorkspaceRoot, sections: readonly IndexSectionName[]): Promise<string>`
  - 또는 manifest helper가 반환하는 verified output hash token
- source_anchors: `src/core/read-model.ts:110-138`, `src/core/read-model.ts:254-301`, `src/core/read-model.ts:304-317`, `src/cache/manifest.ts:102-149`
- 구현 가이드:
  1. read model memo key에 manifest output hash 또는 실제 verified artifact hash token을 포함한다.
  2. `hashArtifactStats()`의 size/mtime-only 결과만으로 cache hit를 만들지 않는다.
  3. `isIndexSectionFresh()`가 hash mismatch를 확인한 뒤에만 artifact-based memo hit가 가능하도록 순서를 정리한다.
  4. source fallback read model은 source stat/hash key와 구분한다.
  5. memo clear API와 current stats contract는 유지한다.
- Rationale: stat-only memo key는 같은 size와 mtime을 보존한 artifact 변조를 놓칠 수 있다.
- 함정 / 주의사항:
  - 이 task는 성능 최적화가 아니라 integrity 보강이다.
  - artifact hash 계산 비용을 줄이기 위한 별도 최적화는 이번 scope에 넣지 않는다.
- 테스트 작성 지침:
  - memo를 채운 뒤 artifact를 같은 size로 변경하거나 mtime을 보존한다.
  - 다음 read에서 stale model이 재사용되지 않는지 확인한다.
  - MCP tool memo 통계 테스트가 새 key 전략과 충돌하지 않는지 확인한다.
- 검증 명령어: `npm test -- test/search/search.test.ts test/mcp/tools.test.ts`
- acceptance_tests:
  - {shell: "bash", cmd: "npm test -- test/search/search.test.ts test/mcp/tools.test.ts", expected_exit: 0}
  - {shell: "pwsh", cmd: "npm test -- test/search/search.test.ts test/mcp/tools.test.ts", expected_exit: 0}
- DoD: artifact bytes mismatch가 stat 보존 상태에서도 memo cache hit로 통과하지 않는다.
- rollback: {strategy: "manual", command: "Restore src/core/read-model.ts and memo tests from git, then run npm test -- test/search/search.test.ts test/mcp/tools.test.ts."}
- 예상 소요: 3~6시간

## Phase P3 - Functional Verification Hardening

목표: SRS 기능 충족 여부를 테스트가 직접 증명하도록 CLI/Core/MCP no-cache, filter, schema, error-path 회귀를 보강한다.

### TASK-P3-001 - Strengthen CLI And Core Requirement Filter Tests

- 관련 REQ-ID: `FR-REQ-016`, `FR-CLI-001`, `FR-CLI-002`, `NFR-REL-006`
- 파일 경로: `test/cli/read-commands.test.ts`, `src/cli/commands/list.ts`, `src/core/requirements.ts`
- 메서드/함수 시그니처:
  - `async function createMultiRequirementWorkspace(): Promise<string>`
  - `async function runListReqs(args: string[]): Promise<CliResult>`
- source_anchors: `src/cli/commands/list.ts:45-87`, `src/core/requirements.ts:214-243`, `test/cli/read-commands.test.ts:28-53`
- 구현 가이드:
  1. 2~3개 requirement가 있는 temp fixture를 만든다.
  2. CLI `list reqs`에서 `--project`, `--scope`, `--type`, `--status`, `--tag` 조합 positive case를 검증한다.
  3. unknown scope, wrong status, wrong tag, wrong type, mixed comma values negative case를 검증한다.
  4. Core direct `listRequirements()`에도 string input과 string array input을 모두 넣는다.
  5. pagination metadata의 `total`, `returned`, `hasMore`, `nextOffset`이 filter 결과와 일치하는지 확인한다.
- Rationale: 상태별 filter와 scope별 filter는 사용자가 직접 질문한 기능이고 SRS read path의 핵심이다.
- 함정 / 주의사항:
  - `valid-basic` fixture 하나에만 의존하면 filter 조합 오류를 잡지 못한다.
  - filter 값 다중 입력은 comma split과 array 입력 모두 검증한다.
- 검증 명령어: `npm test -- test/cli/read-commands.test.ts`
- acceptance_tests:
  - {shell: "bash", cmd: "npm test -- test/cli/read-commands.test.ts", expected_exit: 0}
  - {shell: "pwsh", cmd: "npm test -- test/cli/read-commands.test.ts", expected_exit: 0}
- DoD: CLI와 Core filter 조합이 positive, negative, array input, pagination을 모두 통과한다.
- rollback: {strategy: "manual", command: "Remove the new filter tests, then run npm test -- test/cli/read-commands.test.ts."}
- 예상 소요: 3~5시간

### TASK-P3-002 - Strengthen MCP Filter, Invalid Params, And Output Schema Tests

- 관련 REQ-ID: `FR-MCP-001`, `FR-MCP-004`, `FR-MCP-005`, `FR-REQ-016`, `NFR-REL-006`
- 파일 경로: `test/mcp/tools.test.ts`, `src/mcp/schemas.ts`, `src/mcp/tools.ts`
- 메서드/함수 시그니처:
  - `async function callMcpTool(name: string, args: unknown): Promise<McpToolResult>`
  - `function expectInvalidParams(promise: Promise<unknown>): Promise<void>`
- source_anchors: `src/mcp/schemas.ts:117-145`, `src/mcp/tools.ts:31-178`, `test/mcp/tools.test.ts:47-120`, `test/mcp/tools.test.ts:131-180`
- 구현 가이드:
  1. `speckiwi_list_requirements`에 string filter와 array filter 테스트를 추가한다.
  2. empty page, wrong project, wrong status, wrong tag, wrong type case를 추가한다.
  3. invalid params rejection을 추가한다: `project: 123`, `status: [true]`, `speckiwi_graph { graphType: "bad" }`, `speckiwi_trace_requirement { id: "x", depth: 6 }`, `speckiwi_search { query: 1 }`.
  4. domain error는 protocol rejection이 아니라 tool result error envelope인지 검증한다: missing requirement id는 `isError: true`, `structuredContent.ok: false`, `error.code: "REQUIREMENT_NOT_FOUND"`.
  5. read-only tools의 outputSchema parse coverage를 overview, list_documents, list_requirements, search, graph, impact, validate에 적용한다.
- Rationale: MCP는 AI agent가 사용하는 public interface라 schema와 domain error 구분이 깨지면 자동화 안정성이 떨어진다.
- 함정 / 주의사항:
  - Zod invalid params와 domain error envelope를 섞지 않는다.
  - outputSchema 검증은 tool-specific schema가 아직 common schema라도 현재 contract를 명확히 테스트한다.
- 검증 명령어: `npm test -- test/mcp/tools.test.ts`
- acceptance_tests:
  - {shell: "bash", cmd: "npm test -- test/mcp/tools.test.ts", expected_exit: 0}
  - {shell: "pwsh", cmd: "npm test -- test/mcp/tools.test.ts", expected_exit: 0}
- DoD: MCP filter, invalid params, domain error, outputSchema compatibility가 test로 고정된다.
- rollback: {strategy: "manual", command: "Remove the new MCP tests, then run npm test -- test/mcp/tools.test.ts."}
- 예상 소요: 3~5시간

### TASK-P3-003 - Add Graph No-Cache CLI Test

- 관련 REQ-ID: `FR-CACHE-010`, `FR-CLI-001`, `FR-GRAPH-001`
- 파일 경로: `test/cli/read-commands.test.ts`, `test/graph/graph.test.ts`, `src/cli/commands/graph.ts`
- 메서드/함수 시그니처:
  - `async function runGraphNoCache(root: string): Promise<CliResult>`
- source_anchors: `src/cli/commands/graph.ts:9-31`, `test/graph/graph.test.ts:1-90`, `docs/spec/srs.md:1603-1605`
- 구현 가이드:
  1. temp workspace에서 `.speckiwi/cache`를 삭제한다.
  2. `node bin/speckiwi graph --root <tmp> --no-cache --json`을 실행한다.
  3. exit code 0, result ok true, graph payload 존재를 검증한다.
  4. 실행 뒤 `.speckiwi/cache` directory가 생성되지 않았는지 확인한다.
- Rationale: SRS의 no-cache semantics는 search뿐 아니라 graph read command에도 적용되어야 한다.
- 함정 / 주의사항:
  - graph command는 현재 source 기반이므로 구현 변경보다 직접 CLI 회귀 테스트가 우선이다.
  - JSON stdout에 warning이 섞이지 않도록 기존 CLI helper를 사용한다.
- 검증 명령어: `npm test -- test/cli/read-commands.test.ts test/graph/graph.test.ts`
- acceptance_tests:
  - {shell: "bash", cmd: "npm test -- test/cli/read-commands.test.ts test/graph/graph.test.ts", expected_exit: 0}
  - {shell: "pwsh", cmd: "npm test -- test/cli/read-commands.test.ts test/graph/graph.test.ts", expected_exit: 0}
- DoD: graph `--no-cache`가 cache directory를 만들지 않는다는 CLI-level evidence가 생긴다.
- rollback: {strategy: "manual", command: "Remove the graph no-cache CLI test, then run npm test -- test/cli/read-commands.test.ts test/graph/graph.test.ts."}
- 예상 소요: 2~3시간

## 통합 검증

최종 구현 후 아래 명령을 모두 통과해야 한다.

```sh
npm run build
npm run typecheck
npm run lint
npm test -- test/hardening/security.test.ts test/cache/cache.test.ts test/search/search.test.ts test/cli/read-commands.test.ts test/mcp/tools.test.ts test/graph/graph.test.ts
npm run release:check
```

명시적으로 제외한 명령:

```sh
npm run perf:srs
SPECKIWI_ASSERT_SEARCH_PERF=1 npm run perf:srs
```
