---
plan_contract: "1.1.0"
plan_id: "plan-20260501-speckiwi-performance-indexing-v1"
previous_hash: null
produced_by: "snoworca-planner@2.2.2"
title: "SpecKiwi performance indexing and read model implementation plan"
mode: "NORMAL"
produced_at: "2026-05-01T23:10:00+09:00"
spec_path: "docs/research/20260501-speckiwi-performance-indexing-research.md"
spec_refs:
  - "docs/research/20260501-speckiwi-performance-indexing-research.md"
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
  - {shell: "bash", cmd: "npm run perf:srs", expected_exit: 0, stdout_regex: "SpecKiwi performance timings"}
  - {shell: "pwsh", cmd: "npm run perf:srs", expected_exit: 0, stdout_regex: "SpecKiwi performance timings"}
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
    title: "Performance contract and observability"
    tasks:
      - {id: "TASK-P0-001"}
      - {id: "TASK-P0-002"}
  - id: "PHASE-P1"
    title: "Cache manifest v2 and artifact IO"
    tasks:
      - {id: "TASK-P1-001"}
      - {id: "TASK-P1-002"}
      - {id: "TASK-P1-003"}
      - {id: "TASK-P1-004"}
  - id: "PHASE-P2"
    title: "Core API and immutable read model skeleton"
    tasks:
      - {id: "TASK-P2-001"}
      - {id: "TASK-P2-002"}
      - {id: "TASK-P2-003"}
  - id: "PHASE-P3"
    title: "Entity index and requirement exact lookup"
    tasks:
      - {id: "TASK-P3-001"}
      - {id: "TASK-P3-002"}
      - {id: "TASK-P3-003"}
  - id: "PHASE-P4"
    title: "SearchIndexV2 serialized full-text index"
    tasks:
      - {id: "TASK-P4-001"}
      - {id: "TASK-P4-002"}
      - {id: "TASK-P4-003"}
  - id: "PHASE-P5"
    title: "MCP and CLI fast-path parity"
    tasks:
      - {id: "TASK-P5-001"}
      - {id: "TASK-P5-002"}
  - id: "PHASE-P6"
    title: "Incremental facts and graph index stabilization"
    tasks:
      - {id: "TASK-P6-001"}
      - {id: "TASK-P6-002"}
      - {id: "TASK-P6-003"}
---

# SpecKiwi Performance Indexing And Read Model Implementation Plan

## 개요

이 계획은 5개 서브에이전트 연구 결과를 정리한 `docs/research/20260501-speckiwi-performance-indexing-research.md`를 구현 가능한 Phase 계획으로 변환한다. 목표는 SRS의 성능 요구사항 중 현재 실패하는 항목을 실제로 만족시키는 것이다.

핵심 결론은 `Unified Indexed Read Model`이다. YAML은 계속 원본이고 cache는 재생성 가능한 산출물이지만, 정상 cache 상태의 read path에서는 YAML 전체 parse와 schema validation을 선행하지 않는다. `facts`, `entities`, `relations`, `fullText`, `graph`를 독립 index로 만들고 `core/read-model`이 불변 snapshot으로 조립한다.

JSON 사이드카: `docs/plans/plan-20260501-speckiwi-performance-indexing-v1.md.json`

Feasibility 요약: 총 20개 TASK 중 High 13개, Medium 6개, Low 1개다. Infeasible 항목은 없다. 성능 목표는 수치 기준이 명확하므로 `npm run perf:srs`를 최종 pre-commit gate에 포함한다.

## 선행 조건 및 전제

- Node.js 20 이상, ESM TypeScript, Vitest, ESLint 기반을 유지한다.
- `.speckiwi/**/*.yaml`은 source of truth이고 cache JSON은 disposable artifact다.
- `cacheMode: "bypass"`에서는 cache read와 cache write를 모두 수행하지 않는다.
- public Core DTO는 JSON-compatible object만 노출한다.
- CLI와 MCP는 같은 Core API를 호출해야 하며 MCP schema type이 Core로 역류하지 않아야 한다.
- 정상 cache 상태에서 exact requirement lookup은 YAML 전체 load 없이 동작해야 한다.
- 성능 테스트 예산은 `test/perf/perf.test.ts`의 strict budget을 기준으로 한다.

## 프로젝트 온보딩 컨텍스트

SpecKiwi는 Git 저장소 내부 `.speckiwi/` YAML 문서를 검증 가능한 SDD 컨텍스트 그래프로 만들고 CLI와 stdio MCP를 통해 조회, 검색, graph, proposal, apply, export 기능을 제공하는 local-first 도구다. 현재 release gate는 통과하지만, SRS-scale strict performance gate는 exact lookup/search/MCP fast path가 전체 YAML workspace load에 묶여 실패한다.

주요 수정 영역:

| 경로 | 역할 |
|---|---|
| `src/core/api.ts` | 신규 Core facade. CLI/MCP 공통 root-bound API를 제공한다. |
| `src/core/read-model.ts` | 신규 immutable read model loader와 process-local memoization을 담당한다. |
| `src/cache/fingerprint.ts` | 신규 workspace source fingerprint 계산을 담당한다. |
| `src/cache/index-manifest.ts` | 신규 manifest v2와 section freshness 검사를 담당한다. |
| `src/cache/document-artifacts.ts` | 신규 per-file artifact store를 담당한다. |
| `src/indexing/` | 신규 entities, relations, full-text, graph index 생성과 직렬화를 담당한다. |
| `src/validate/facts.ts` | 신규 WorkspaceFacts 추출을 담당한다. |
| `src/validate/semantic-rules.ts` | 신규 facts 기반 semantic rule 실행을 담당한다. |
| `src/core/requirements.ts` | exact requirement lookup과 list path를 read model로 전환한다. |
| `src/core/search.ts`, `src/search/` | SearchIndexV2와 cache-before-YAML search path를 구현한다. |
| `src/mcp/tools.ts` | MCP adapter만 남기고 core orchestration을 제거한다. |
| `test/perf/perf.test.ts` | SRS-scale budget과 instrumentation을 검증한다. |

빌드·테스트 치트시트:

| 목적 | 명령 |
|---|---|
| 빌드 | `npm run build` |
| 타입 검사 | `npm run typecheck` |
| lint | `npm run lint` |
| 전체 테스트 | `npm test` |
| release gate | `npm run release:check` |
| SRS 성능 gate | `npm run perf:srs` |
| search/cache 단위 회귀 | `npm test -- search cache` |
| MCP 회귀 | `npm test -- mcp` |
| graph 회귀 | `npm test -- graph` |

핵심 규칙:

- cache hit 여부 판단은 YAML 전체 workspace load보다 먼저 실행한다.
- cache JSON 내부 path는 신뢰하지 않고 fixed path와 workspace path normalization을 유지한다.
- corrupt cache는 warning diagnostic과 source fallback으로 처리한다.
- exact requirement lookup은 SearchIndexV2/BM25를 deserialize하지 않는다.
- BM25 query는 전체 indexed document scan을 반복하지 않고 postings 기반 후보만 점수화한다.
- apply/write 이후 process-local memoized read model은 무효화한다.

## AI 에이전트 실행 가드

이 문서의 frontmatter가 실행 가드의 SSOT다. 최종 평가자 게이트 통과 전에는 `scope_freeze: false`이며, 게이트 통과 직후 `true`로 승격한다. `scope_freeze: true` 이후 새 Phase, 새 파일 ownership, 신규 요구사항 매핑은 사용자 승인과 `change_log[]` 기록이 있어야 한다.

## Phase P0 - Performance Contract And Observability

목표: 기존 SRS-scale perf test를 구현 가이드의 중심 gate로 고정하고, 실패 원인을 수치와 counters로 관찰 가능하게 만든다.

### TASK-P0-001 - Add Read-Path Instrumentation To Perf Harness

- 관련 REQ-ID: `NFR-PERF-001`, `NFR-PERF-002`, `NFR-PERF-003`, `NFR-PERF-004`, `NFR-PERF-005`, `NFR-PERF-007`
- 파일 경로: `test/perf/perf.test.ts`, `src/core/dto.ts`
- 메서드/함수 시그니처:
  - `type PerfCounters = { cacheHit: boolean; parsedFileCount: number; artifactHitCount: number; fallbackReason?: string }`
  - `function recordPerfCounters(label: string, counters: PerfCounters): void`
- 참고 패턴: 현재 perf test는 `measure()`로 duration만 기록하고 `console.info()`에 timings JSON을 출력한다.
- source_anchors: `test/perf/perf.test.ts:40-90`, `test/perf/perf.test.ts:94-108`, `docs/research/20260501-speckiwi-performance-indexing-research.md:445-452`
- 구현 가이드:
  1. `test/perf/perf.test.ts`의 timings JSON에 `cacheHit`, `parsedFileCount`, `artifactHitCount`, `fallbackReason` 필드를 명령별로 추가한다.
  2. 아직 counters를 Core가 제공하지 않는 Phase P0에서는 test-local placeholder를 `cacheHit: false`, `parsedFileCount: fixture.documentCount + 2`, `artifactHitCount: 0`으로 기록한다.
  3. Phase P2 이후 `ReadModelLoadStats`가 생기면 placeholder를 실제 stats로 교체할 수 있도록 helper 함수를 분리한다.
  4. strict budget 값은 유지한다.
- Rationale: 성능 실패가 재발했을 때 시간만 보면 YAML load, cache miss, corrupt fallback 중 어디서 비용이 발생했는지 구분할 수 없다.
- 함정 / 주의사항: perf budget을 완화하지 않는다. instrumentation은 stdout JSON에만 추가하고 assertion은 기존 strict budget을 유지한다.
- 테스트 작성 지침: perf test가 `SpecKiwi performance timings`를 계속 출력하고 JSON parse 가능한 counters를 포함하는지 검증한다.
- 검증 명령어: `npm test -- test/perf/perf.test.ts`
- acceptance_tests:
  - {shell: "bash", cmd: "npm test -- test/perf/perf.test.ts", expected_exit: 0, stdout_regex: "SpecKiwi performance timings"}
  - {shell: "pwsh", cmd: "npm test -- test/perf/perf.test.ts", expected_exit: 0, stdout_regex: "SpecKiwi performance timings"}
- DoD: local perf profile 출력에 counters가 포함되고 strict profile 예산은 변경되지 않는다.
- rollback: {strategy: "manual", command: "1) Restore test/perf/perf.test.ts from git. 2) Run npm test -- test/perf/perf.test.ts and confirm the previous timings-only output is restored."}
- 예상 소요: 1~2시간

### TASK-P0-002 - Add Cold/Warm DTO Equality And Filter Baselines

- 관련 REQ-ID: `FR-CACHE-001`, `FR-CACHE-002`, `FR-CACHE-005`, `FR-CACHE-006`, `FR-CACHE-007`, `FR-REQ-016`, `NFR-REL-006`
- 파일 경로: `test/cache/cache.test.ts`, `test/search/search.test.ts`, `test/graph/graph.test.ts`, `test/mcp/tools.test.ts`
- 메서드/함수 시그니처:
  - `async function expectColdWarmEqual<T>(label: string, cold: () => Promise<T>, warm: () => Promise<T>): Promise<void>`
- 참고 패턴: cache rebuild와 search cache 회귀는 현재 `test/cache/cache.test.ts`와 `test/search/search.test.ts`에 분산되어 있다.
- source_anchors: `src/core/search.ts:21-43`, `src/cache/rebuild.ts:14-45`, `test/perf/perf.test.ts:59-72`, `docs/research/20260501-speckiwi-performance-indexing-research.md:508-546`
- 구현 가이드:
  1. cold path는 `cacheMode: "bypass"` 또는 cache directory 제거 후 source YAML로 결과를 만든다.
  2. warm path는 `rebuildCache()` 후 default cache mode로 결과를 만든다.
  3. search exact, search BM25, get requirement with relations, graph traceability, MCP search 응답을 비교한다.
  4. requirement list filter는 `project`, `scope`, `type`, `status`, `tag` 조합을 source/warm cache 양쪽에서 비교한다.
  5. diagnostics warning은 cache path에 따라 달라질 수 있으므로 DTO `data` payload를 우선 비교하고, diagnostics는 code multiset만 비교한다.
- Rationale: 성능 개선은 read path를 바꾸므로 결과 parity가 깨지면 빠른 오답이 된다.
- 함정 / 주의사항: absolute temp path와 duration 같은 환경 의존 필드는 equality 대상에서 제외한다.
- 테스트 작성 지침: 성공 workspace, stale cache workspace, corrupt cache workspace, project/scope/type/status/tag list filter 조합 4축을 포함한다.
- 검증 명령어: `npm test -- cache search graph mcp`
- acceptance_tests:
  - {shell: "bash", cmd: "npm test -- cache search graph mcp", expected_exit: 0}
  - {shell: "pwsh", cmd: "npm test -- cache search graph mcp", expected_exit: 0}
- DoD: cold/warm DTO equality baseline이 실패하면 후속 Phase 구현이 merge되지 않는다.
- rollback: {strategy: "manual", command: "1) Remove only the new cold/warm equality helper and tests. 2) Run npm test -- cache search graph mcp to confirm existing tests still pass."}
- 예상 소요: 2~4시간

## Phase P1 - Cache Manifest V2 And Artifact IO

목표: YAML 전체 load 없이 section별 freshness를 판단할 수 있는 manifest v2와 artifact IO 경계를 만든다.

### TASK-P1-001 - Add Workspace Fingerprint Module

- 관련 REQ-ID: `FR-CACHE-005`, `FR-CACHE-008`, `NFR-PERF-006`
- 파일 경로: `src/cache/fingerprint.ts`, `test/cache/cache.test.ts`
- 메서드/함수 시그니처:
  - `export type SourceFileStat = { path: string; size: number; mtimeMs: number }`
  - `export type SourceFileFingerprint = { path: string; size: number; mtimeMs: number; sha256: string }`
  - `export async function statWorkspaceInputs(root: WorkspaceRoot): Promise<SourceFileStat[]>`
  - `export async function fingerprintWorkspace(root: WorkspaceRoot): Promise<SourceFileFingerprint[]>`
  - `export async function fingerprintStorePath(root: WorkspaceRoot, storePath: string): Promise<SourceFileFingerprint | undefined>`
- 참고 패턴: 현재 `buildCacheInputs()`는 loaded workspace raw YAML에서 sha256를 만든다.
- source_anchors: `src/cache/manifest.ts:57-90`, `src/cache/hash.ts:1-34`, `src/validate/semantic.ts:76-78`, `docs/research/20260501-speckiwi-performance-indexing-research.md:176-204`
- 구현 가이드:
  1. `.speckiwi/**/*.yaml`만 대상으로 recursive directory walk를 구현한다.
  2. hot read에서는 `statWorkspaceInputs()`로 `path`, `size`, `mtimeMs`만 비교해 manifest quick accept를 수행한다.
  3. `fingerprintWorkspace()`의 sha256 계산은 quick stat mismatch, cache rebuild, artifact regeneration 때만 실행한다.
  4. `normalizeStorePath()`와 `resolveStorePath()`를 사용해 store path escape와 symlink traversal 정책을 유지한다.
  5. fingerprint는 `path`, `size`, `mtimeMs`, `sha256` 순으로 stable JSON이 가능하도록 정렬한다.
  6. cache 출력 파일과 proposals/templates/exports는 input fingerprint에서 제외한다.
- Rationale: cache freshness 판단이 `LoadedWorkspace`에 의존하면 cache hit path에서도 YAML parse가 선행된다.
- 함정 / 주의사항: hot read에서 1,000개 YAML sha256을 매번 계산하면 exact lookup 50ms 목표를 깨뜨린다. stat quick accept 후 hash 검증은 rebuild 또는 mismatch branch에서만 수행한다.
- 테스트 작성 지침: nested YAML 발견, non-YAML 제외, symlink escape 거부, deterministic sort, hot read quick stat no-hash 5가지를 검증한다.
- 검증 명령어: `npm test -- cache`
- acceptance_tests:
  - {shell: "bash", cmd: "npm test -- cache", expected_exit: 0}
  - {shell: "pwsh", cmd: "npm test -- cache", expected_exit: 0}
- DoD: hot read quick stat path는 `loadWorkspaceForValidation()`과 sha256 file hashing을 호출하지 않고 fresh 여부를 판정한다.
- rollback: {strategy: "manual", command: "1) Delete src/cache/fingerprint.ts and its tests. 2) Run npm test -- cache to confirm old cache tests still pass."}
- 예상 소요: 3~5시간

### TASK-P1-002 - Introduce Manifest V2 With Section Freshness APIs

- 관련 REQ-ID: `FR-CACHE-005`, `FR-CACHE-008`, `NFR-PERF-006`
- 파일 경로: `src/cache/index-manifest.ts`, `src/cache/manifest.ts`, `test/cache/cache.test.ts`
- 메서드/함수 시그니처:
  - `export type IndexManifestV2 = { format: "speckiwi/cache-manifest/v2"; cacheSchemaVersion: 2; sections: Record<IndexSectionName, SectionFingerprint> }`
  - `export type CacheVersionFingerprint = { speckiwiVersion: string; parserVersion: string; schemaBundleHash: string; tokenizerVersion: string; graphRulesVersion: string; dictionaryHash: string; searchSettingsHash: string }`
  - `export type IndexSectionName = "facts" | "entities" | "relations" | "search" | "graph" | "diagnostics"`
  - `export async function readIndexManifest(root: WorkspaceRoot): Promise<IndexManifestV2 | undefined>`
  - `export async function isIndexSectionFresh(root: WorkspaceRoot, section: IndexSectionName): Promise<boolean>`
- 참고 패턴: 현재 `isCacheStale()`는 graph/search/diagnostics/export 전체 section을 한 번에 비교한다.
- source_anchors: `src/cache/manifest.ts:27-45`, `src/cache/manifest.ts:112-124`, `docs/research/20260501-speckiwi-performance-indexing-research.md:176-204`, `docs/spec/srs.md:1003-1037`
- 구현 가이드:
  1. 기존 `src/cache/manifest.ts`는 v1 compatibility wrapper로 유지한다.
  2. 신규 `src/cache/index-manifest.ts`에 manifest v2 type guard, read/write, section freshness helper를 둔다.
  3. manifest v2는 `speckiwiVersion`, `parserVersion`, `schemaBundleHash`, `tokenizerVersion`, `graphRulesVersion`, `dictionaryHash`, `searchSettingsHash`를 포함한다.
  4. search command는 search section만 확인하되 tokenizer, dictionary, search settings fingerprint가 바뀌면 stale 처리한다.
  5. exact requirement lookup은 entities와 relations section만 확인하되 parser/schema bundle/package version이 바뀌면 stale 처리한다.
  6. graph command는 graph rules version과 relation/entity section fingerprint를 함께 확인한다.
  7. unsupported major version은 stale로 처리한다.
- Rationale: section별 freshness가 없으면 exact lookup이 search/graph output hash까지 읽게 되어 작은 조회가 큰 artifact에 묶인다.
- 함정 / 주의사항: manifest v1 파일을 읽는 기존 command가 즉시 깨지면 안 된다. v2가 없으면 v1 fallback 후 source rebuild로 degrade한다.
- 테스트 작성 지침: v2 fresh, v2 stale by file hash, package version change, schema bundle change, tokenizer version change, dictionary.yaml change, graph rules version change, unsupported major stale, v1 fallback 9가지를 검증한다.
- 검증 명령어: `npm test -- cache`
- acceptance_tests:
  - {shell: "bash", cmd: "npm test -- cache", expected_exit: 0}
  - {shell: "pwsh", cmd: "npm test -- cache", expected_exit: 0}
- DoD: `isIndexSectionFresh(root, "search")`가 workspace YAML parse와 full-file hashing 없이 boolean을 반환하고 version/tokenizer/dictionary/settings 변경은 stale로 판정한다.
- rollback: {strategy: "manual", command: "1) Remove src/cache/index-manifest.ts and restore src/cache/manifest.ts from git. 2) Run npm test -- cache."}
- 예상 소요: 4~6시간

### TASK-P1-003 - Add Versioned Artifact Serialization Helpers

- 관련 REQ-ID: `FR-CACHE-001`, `FR-CACHE-002`, `FR-CACHE-007`, `NFR-REL-005`
- 파일 경로: `src/indexing/serialization.ts`, `test/cache/cache.test.ts`
- 메서드/함수 시그니처:
  - `export type ArtifactEnvelope<TFormat extends string, TPayload> = { format: TFormat; createdBy: string; payload: TPayload }`
  - `export async function readArtifact<T>(root: WorkspaceRoot, storePath: string, guard: (value: unknown) => T | undefined): Promise<{ artifact?: T; warning?: Diagnostic }>`
  - `export async function writeArtifact(root: WorkspaceRoot, storePath: string, value: unknown): Promise<void>`
- 참고 패턴: current search cache reader parses JSON and returns warning on invalid shape.
- source_anchors: `src/core/search.ts:67-83`, `src/cache/rebuild.ts:40-45`, `src/cache/hash.ts:1-34`, `docs/research/20260501-speckiwi-performance-indexing-research.md:433-440`
- 구현 가이드:
  1. fixed `.speckiwi/cache/...` store path만 허용한다.
  2. JSON parse failure, invalid shape, unsupported format은 warning diagnostic으로 반환한다.
  3. write는 existing `atomicWriteText()`와 `stableJson()`을 사용한다.
  4. DTO에는 `Map`, `Set`, class instance, `undefined`, `BigInt`가 들어가지 않도록 guard test를 추가한다.
- Rationale: 여러 artifact가 생기면 각 모듈이 제각각 JSON parse와 fallback을 구현하는 구조가 스파게티가 된다.
- 함정 / 주의사항: cache JSON 안의 path field로 read path를 결정하지 않는다.
- 테스트 작성 지침: corrupt JSON warning, invalid shape warning, fixed path enforcement, stable write 4가지를 검증한다.
- 검증 명령어: `npm test -- cache`
- acceptance_tests:
  - {shell: "bash", cmd: "npm test -- cache", expected_exit: 0}
  - {shell: "pwsh", cmd: "npm test -- cache", expected_exit: 0}
- DoD: cache artifact read failure가 source YAML fallback을 막지 않는다.
- rollback: {strategy: "manual", command: "1) Delete src/indexing/serialization.ts and related tests. 2) Run npm test -- cache."}
- 예상 소요: 3~5시간

### TASK-P1-004 - Enforce Bypass-First No-Cache Semantics

- 관련 REQ-ID: `FR-CACHE-010`
- 파일 경로: `src/cache/rebuild.ts`, `src/cache/clean.ts`, `src/core/search.ts`, `src/core/read-model.ts`, `src/core/export-markdown.ts`, `src/write/apply.ts`, `test/cache/cache.test.ts`, `test/write/apply.test.ts`, `test/cli/export.test.ts`, `test/graph/graph.test.ts`
- 메서드/함수 시그니처:
  - `function shouldBypassCache(cacheMode: CacheMode | undefined): boolean`
  - `export async function rebuildCache(input: CacheRebuildInput = {}): Promise<CacheResult>`
  - `export async function loadReadModel(input: { root: string; cacheMode?: CacheMode; sections: IndexSectionName[] }): Promise<ReadModel>`
- 참고 패턴: `cleanCache()` already checks bypass immediately after root resolution, while `rebuildCache()` currently loads the workspace before the bypass branch.
- source_anchors: `src/cache/rebuild.ts:14-24`, `src/cache/clean.ts:9-16`, `src/core/search.ts:21-43`, `docs/spec/srs.md:1603-1605`, `docs/research/20260501-speckiwi-performance-indexing-research.md:543-548`
- 구현 가이드:
  1. `rebuildCache()`는 root resolve 직후 `cacheMode: "bypass"`를 검사하고 workspace load, manifest read, output hash read를 모두 건너뛴다.
  2. `loadReadModel()`과 `searchWorkspace()`는 bypass mode에서 artifact read, manifest read, memo read, cache write를 수행하지 않는다.
  3. apply/write path는 bypass mode에서 stale marker와 cache invalidation artifact를 만들지 않는다.
  4. graph/export/read commands는 bypass mode에서 source YAML path로 동작하고 `.speckiwi/cache/`에 새 파일을 만들지 않는다.
  5. tests는 before/after directory listing으로 cache directory side effect가 없음을 검증한다.
- Rationale: SRS는 no-cache를 performance option이 아니라 observable cache read/write prohibition으로 정의한다.
- 함정 / 주의사항: bypass는 validation/source read를 금지하지 않는다. cache artifact와 manifest에만 접근하지 않는다는 뜻이다.
- 테스트 작성 지침: `speckiwi req update --apply --no-cache`, search, graph, export, cache rebuild bypass 5축에서 cache file 또는 stale marker가 생성되지 않는지 검증한다.
- 검증 명령어: `npm test -- cache write graph export`
- acceptance_tests:
  - {shell: "bash", cmd: "npm test -- cache write graph export", expected_exit: 0}
  - {shell: "pwsh", cmd: "npm test -- cache write graph export", expected_exit: 0}
- DoD: bypass mode read/write commands perform zero cache artifact reads and zero cache artifact writes in tests.
- rollback: {strategy: "manual", command: "1) Restore cache, read-model, apply, export, and graph-owned files from git. 2) Run npm test -- cache write graph export."}
- 예상 소요: 4~7시간

## Phase P2 - Core API And Immutable Read Model Skeleton

목표: MCP에 있던 core orchestration을 Core 계층으로 이동하고, source/cache read model을 같은 interface로 감싼다.

### TASK-P2-001 - Move SpecKiwi Core Facade Out Of MCP Adapter

- 관련 REQ-ID: `NFR-MAINT-001`, `NFR-MAINT-008`, `FR-MCP-001`, `FR-MCP-004`, `FR-MCP-005`
- 파일 경로: `src/core/api.ts`, `src/mcp/tools.ts`, `test/mcp/tools.test.ts`, `test/contract/core-dto.test.ts`
- 메서드/함수 시그니처:
  - `export type SpecKiwiCore = { root: string; cacheMode: CacheMode; search(input: SearchInput): Promise<SearchResultSet>; getRequirement(input: GetRequirementInput): Promise<RequirementResult>; ... }`
  - `export function createSpecKiwiCore(input: { root: string; cacheMode?: CacheMode }): SpecKiwiCore`
- 참고 패턴: `createSpecKiwiCore()` currently lives in `src/mcp/tools.ts`.
- source_anchors: `src/mcp/tools.ts:91-174`, `src/core/inputs.ts:1-8`, `src/core/dto.ts:43-45`, `docs/research/20260501-speckiwi-performance-indexing-research.md:399-418`
- 구현 가이드:
  1. `SpecKiwiCore` type and `createSpecKiwiCore()`를 `src/core/api.ts`로 이동한다.
  2. MCP-specific `ToolInput` type aliases를 Core API signature에서 제거하고 `core/inputs.ts` types만 사용한다.
  3. `src/mcp/tools.ts`는 schema validation, tool registration, `toMcpToolResult()`만 담당하게 한다.
  4. package export에 `./core/api`를 추가한다.
- Rationale: MCP adapter가 core orchestration을 들고 있으면 CLI와 MCP가 같은 read model fast path를 공유하기 어렵다.
- 함정 / 주의사항: MCP invalid params behavior는 기존대로 유지한다. adapter boundary만 옮기고 public tool names는 바꾸지 않는다.
- 테스트 작성 지침: core API direct call, MCP tool call, package export contract 3축을 검증한다.
- 검증 명령어: `npm test -- mcp contract`
- acceptance_tests:
  - {shell: "bash", cmd: "npm test -- mcp contract", expected_exit: 0}
  - {shell: "pwsh", cmd: "npm test -- mcp contract", expected_exit: 0}
- DoD: `src/mcp/tools.ts`가 `loadWorkspaceForValidation()`을 직접 import하지 않는다.
- rollback: {strategy: "manual", command: "1) Restore src/mcp/tools.ts, package.json, and tests from git. 2) Run npm test -- mcp contract."}
- 예상 소요: 4~6시간

### TASK-P2-002 - Add ReadModel Skeleton With Source Fallback

- 관련 REQ-ID: `FR-CACHE-001`, `FR-CACHE-007`, `NFR-PERF-006`
- 파일 경로: `src/core/read-model.ts`, `src/core/api.ts`, `test/cache/cache.test.ts`
- 메서드/함수 시그니처:
  - `export type ReadModelLoadMode = "cache" | "source"`
  - `export type ReadModelLoadStats = { mode: ReadModelLoadMode; cacheHit: boolean; parsedFileCount: number; artifactHitCount: number; fallbackReason?: string }`
  - `export type ReadModel = { registry: RequirementRegistry; search?: SearchIndex; graph?: GraphResult; stats: ReadModelLoadStats }`
  - `export async function loadReadModel(input: { root: string; cacheMode?: CacheMode; sections: IndexSectionName[] }): Promise<ReadModel>`
- 참고 패턴: existing source path is `loadWorkspaceForValidation()` then `buildRequirementRegistry()`, `buildSearchIndex()`, or `buildGraph()`.
- source_anchors: `src/core/requirements.ts:81-87`, `src/core/search.ts:15-43`, `src/graph/builder.ts:9-13`, `docs/research/20260501-speckiwi-performance-indexing-research.md:121-165`
- 구현 가이드:
  1. 첫 버전은 source fallback만 구현하고 `sections` 인자를 보존한다.
  2. `cacheMode: "bypass"`이면 `mode: "source"`, `cacheHit: false`를 반환한다.
  3. source fallback은 기존 `loadWorkspaceForValidation()` 결과에서 registry/search/graph를 만든다.
  4. `ReadModel` 객체는 생성 후 mutation하지 않는다.
  5. P3/P4에서 cache-backed branch를 채울 수 있도록 function boundary를 고정한다.
- Rationale: 기능별로 fast path를 따로 붙이면 cache/search/graph extraction logic이 분기되어 유지보수 비용이 커진다.
- 함정 / 주의사항: 이 Phase에서 기존 behavior를 바꾸지 않는다. skeleton merge 후 모든 tests가 green이어야 한다.
- 테스트 작성 지침: source mode get/search/graph parity, bypass mode stats, corrupt cache fallback placeholder 3축을 검증한다.
- 검증 명령어: `npm test -- cache search graph`
- acceptance_tests:
  - {shell: "bash", cmd: "npm test -- cache search graph", expected_exit: 0}
  - {shell: "pwsh", cmd: "npm test -- cache search graph", expected_exit: 0}
- DoD: Core call sites can opt into `loadReadModel()` without changing output DTO.
- rollback: {strategy: "manual", command: "1) Delete src/core/read-model.ts and restore src/core/api.ts tests from git. 2) Run npm test -- cache search graph."}
- 예상 소요: 5~8시간

### TASK-P2-003 - Preserve Realpath Security Across Core And MCP Reads

- 관련 REQ-ID: `NFR-SEC-010`
- 파일 경로: `src/io/path.ts`, `src/core/documents.ts`, `src/mcp/resources.ts`, `src/write/apply.ts`, `src/io/file-store.ts`, `test/hardening/security.test.ts`, `test/mcp/mcp-resources.test.ts`
- 메서드/함수 시그니처:
  - `export async function resolveRealStorePath(root: WorkspaceRoot, storePath: StorePath): Promise<WorkspacePath>`
  - `export async function assertRealPathInsideWorkspace(path: WorkspacePath): Promise<void>`
  - `export async function readMcpResource(uri: string, core: SpecKiwiCore): Promise<ReadResourceResult>`
- 참고 패턴: `resolveRealStorePath()` checks realpath containment for MCP resources, while some Core read paths still use `resolveStorePath()` before loading YAML.
- source_anchors: `src/io/path.ts:71-89`, `src/core/documents.ts:76-88`, `src/mcp/resources.ts:15-35`, `src/write/apply.ts:76-93`, `docs/spec/srs.md:1618-1618`, `docs/research/20260501-speckiwi-performance-indexing-research.md:535-540`
- 구현 가이드:
  1. Core document read with `includeRawYaml` or `includeParsed` uses `resolveRealStorePath()` before reading.
  2. MCP resources keep `resolveRealStorePath()` for overview, index, and registered documents after the Core API move.
  3. write/apply keeps `assertRealPathInsideWorkspace()` immediately before atomic write.
  4. cache artifact paths use fixed cache paths and never use cache JSON-provided absolute or parent paths.
  5. tests create symlinks from `.speckiwi/overview.yaml` and registered documents to files outside the workspace and assert security diagnostics or MCP errors.
- Rationale: performance cache shortcuts must not bypass existing symlink and realpath hardening.
- 함정 / 주의사항: logical store path validation is not enough for symlinks. Realpath containment must be checked before reading or writing existing files.
- 테스트 작성 지침: CLI read, MCP resource read, apply target write, cache artifact path injection 4축을 검증한다.
- 검증 명령어: `npm test -- hardening mcp`
- acceptance_tests:
  - {shell: "bash", cmd: "npm test -- hardening mcp", expected_exit: 0}
  - {shell: "pwsh", cmd: "npm test -- hardening mcp", expected_exit: 0}
- DoD: symlink escape attempts through Core read, MCP resource, apply target, and cache artifact path injection return security failure without exposing outside file contents.
- rollback: {strategy: "manual", command: "1) Restore path, documents, resources, apply, and security test files from git. 2) Run npm test -- hardening mcp."}
- 예상 소요: 4~7시간

## Phase P3 - Entity Index And Requirement Exact Lookup

목표: requirement ID exact lookup을 search/BM25와 분리된 1급 entity index로 구현하고 50ms budget을 만족시킨다.

### TASK-P3-001 - Build Entity And Relation Index Modules

- 관련 REQ-ID: `FR-REQ-002`, `FR-REQ-003`, `FR-REQ-011`, `NFR-PERF-001`
- 파일 경로: `src/indexing/entities.ts`, `src/indexing/relations.ts`, `test/cache/cache.test.ts`, `test/core/id-generator.test.ts`
- 메서드/함수 시그니처:
  - `export type EntityIndexV1 = { format: "speckiwi/entities/v1"; project: ProjectSummary; documents: DocumentSummary[]; scopes: ScopeSummary[]; requirements: RequirementSummary[]; requirementLookup: Array<[string, number]>; documentLookup: Array<[string, number]> }`
  - `export type RelationIndexV1 = { format: "speckiwi/relations/v1"; incomingByRequirement: Array<[string, RequirementRelation[]]>; outgoingByRequirement: Array<[string, RequirementRelation[]]> }`
  - `export function buildEntityIndex(registry: RequirementRegistry): EntityIndexV1`
  - `export function buildRelationIndex(registry: RequirementRegistry): RelationIndexV1`
- 참고 패턴: `buildRequirementRegistry()` already creates documents, scopes, requirements, maps, incoming relations, and outgoing relations.
- source_anchors: `src/core/requirements.ts:87-133`, `src/core/requirements.ts:139-170`, `docs/research/20260501-speckiwi-performance-indexing-research.md:260-297`
- 구현 가이드:
  1. `RequirementRegistry`에서 JSON-serializable arrays만 추출한다.
  2. `requirementLookup`은 normalized ID가 아니라 exact public ID를 key로 사용한다.
  3. runtime loader는 `new Map(requirementLookup)`을 만들어 O(1) ordinal lookup을 제공한다.
  4. relations는 incoming/outgoing arrays를 stable sort한 뒤 저장한다.
- Rationale: exact lookup이 search index를 deserialize하거나 all documents를 scan하면 50ms 목표를 만족하기 어렵다.
- 함정 / 주의사항: full raw requirement payload는 `RequirementSummary`와 분리한다. DTO parity를 위해 P3-002 shard에서 materialize한다.
- 테스트 작성 지침: lookup ordinal, duplicate handling, relation parity, JSON shape guard 4가지를 검증한다.
- 검증 명령어: `npm test -- cache core`
- acceptance_tests:
  - {shell: "bash", cmd: "npm test -- cache core", expected_exit: 0}
  - {shell: "pwsh", cmd: "npm test -- cache core", expected_exit: 0}
- DoD: `EntityIndexV1` and `RelationIndexV1` contain no `Map`, `Set`, or `undefined`.
- rollback: {strategy: "manual", command: "1) Delete src/indexing/entities.ts and src/indexing/relations.ts plus related tests. 2) Run npm test -- cache core."}
- 예상 소요: 5~8시간

### TASK-P3-002 - Write Entity Artifacts And Requirement Payload Shards

- 관련 REQ-ID: `FR-CACHE-003`, `FR-CACHE-008`, `NFR-PERF-001`, `NFR-PERF-006`
- 파일 경로: `src/cache/rebuild.ts`, `src/cache/index-manifest.ts`, `src/indexing/entities.ts`, `test/cache/cache.test.ts`
- 메서드/함수 시그니처:
  - `export type RequirementPayloadShardV1 = { format: "speckiwi/requirements-shard/v1"; documentPath: string; requirements: Array<{ id: string; requirement: JsonObject }> }`
  - `export function requirementShardStorePath(documentHash: string): string`
  - `async function writeEntityArtifacts(root: WorkspaceRoot, registry: RequirementRegistry, sourceFiles: SourceFileFingerprint[]): Promise<void>`
- 참고 패턴: `rebuildCache()` currently writes graph, search-index, diagnostics, manifest in one pass.
- source_anchors: `src/cache/rebuild.ts:27-45`, `src/cache/manifest.ts:40-45`, `src/search/document.ts:144-176`, `docs/research/20260501-speckiwi-performance-indexing-research.md:239-244`, `docs/research/20260501-speckiwi-performance-indexing-research.md:276-297`
- 구현 가이드:
  1. Rebuild writes `.speckiwi/cache/entities.json`, `.speckiwi/cache/relations.json`, and `.speckiwi/cache/requirements/<document-hash>.json`.
  2. Each requirement summary stores only trusted shard identity fields such as `documentHash` and ordinal metadata.
  3. Loader recomputes the shard store path with `requirementShardStorePath(documentHash)` and rejects any cache JSON field that looks like a direct path override.
  4. Manifest v2 records entities and relations section output hashes.
  5. Existing v1 outputs remain during transition.
- Rationale: exact get requires full requirement JSON but should not read every YAML document.
- 함정 / 주의사항: entity summaries must not contain a cache-controlled `payloadShardPath` that the loader trusts. The only allowed shard location is the fixed path recomputed from trusted source fingerprint data.
- 테스트 작성 지침: rebuild writes artifacts, shard contains target payload, deleted YAML makes section stale, corrupt shard falls back to source, cache JSON path injection is rejected 5축을 검증한다.
- 검증 명령어: `npm test -- cache`
- acceptance_tests:
  - {shell: "bash", cmd: "npm test -- cache", expected_exit: 0}
  - {shell: "pwsh", cmd: "npm test -- cache", expected_exit: 0}
- DoD: cache rebuild creates entity artifacts and manifest v2 without removing legacy cache files.
- rollback: {strategy: "manual", command: "1) Restore src/cache/rebuild.ts and manifest-related files from git. 2) Remove entity artifact tests. 3) Run npm test -- cache."}
- 예상 소요: 6~10시간

### TASK-P3-003 - Use Entity Index In getRequirement Fast Path

- 관련 REQ-ID: `FR-REQ-002`, `FR-REQ-003`, `FR-MCP-005`, `NFR-PERF-001`
- 파일 경로: `src/core/requirements.ts`, `src/core/read-model.ts`, `test/perf/perf.test.ts`, `test/mcp/tools.test.ts`
- 메서드/함수 시그니처:
  - `async function getRequirementFromEntityIndex(input: GetRequirementInput, model: EntityReadModel): Promise<RequirementResult | undefined>`
  - `export async function getRequirement(input: GetRequirementInput): Promise<RequirementResult>`
- 참고 패턴: current `getRequirement()` delegates to `loadRequirementRegistry()` before Map lookup.
- source_anchors: `src/core/requirements.ts:81-87`, `src/core/requirements.ts:135-170`, `test/perf/perf.test.ts:49-52`, `docs/research/20260501-speckiwi-performance-indexing-research.md:276-297`
- 구현 가이드:
  1. `getRequirement()` resolves root and checks `cacheMode !== "bypass"`.
  2. It asks `loadReadModel({ sections: ["entities", "relations"] })` for cache-backed entity read model.
  3. On fresh entity index, lookup requirement ID in runtime `Map` and read only the target shard.
  4. `includeDocument` uses entity documents array. `includeRelations` uses relation index.
  5. Missing/corrupt/stale cache falls back to current full YAML registry path with warning diagnostic.
- Rationale: this is the highest-value fast path because exact lookup currently pays the full workspace parse cost.
- 함정 / 주의사항: not-found result must remain `REQUIREMENT_NOT_FOUND`, not cache corruption.
- 테스트 작성 지침: cache hit exact lookup, includeDocument parity, includeRelations parity, corrupt entity fallback, strict perf target 5축을 검증한다.
- 검증 명령어: `npm run perf:srs`
- acceptance_tests:
  - {shell: "bash", cmd: "npm run perf:srs", expected_exit: 0, stdout_regex: "exactLookupMs"}
  - {shell: "pwsh", cmd: "npm run perf:srs", expected_exit: 0, stdout_regex: "exactLookupMs"}
- DoD: SRS-scale exact lookup is <= 50ms in strict perf run.
- rollback: {strategy: "manual", command: "1) Restore src/core/requirements.ts and src/core/read-model.ts from git. 2) Keep artifact writer code only if cache tests remain green, otherwise restore cache files too. 3) Run npm test -- cache core."}
- 예상 소요: 6~10시간

## Phase P4 - SearchIndexV2 Serialized Full-Text Index

목표: search cache가 flattened document list가 아니라 exact map, filter buckets, postings, field lengths, dictionary를 보존하는 실제 runtime index가 되게 한다.

### TASK-P4-001 - Define SearchIndexV2 Runtime And Serialized Shapes

- 관련 REQ-ID: `FR-SRCH-009`, `FR-CACHE-009`, `NFR-PERF-002`
- 파일 경로: `src/indexing/full-text.ts`, `src/search/bm25.ts`, `src/search/index.ts`, `test/search/search.test.ts`
- 메서드/함수 시그니처:
  - `export type SearchIndexV2 = { format: "speckiwi/search-index/v2"; documents: SearchDocumentSummary[]; exact: Array<[string, ExactEntry[]]>; filters: SerializedFilterBuckets; bm25: SerializedBm25Postings; dictionary: DictionaryExpansion }`
  - `export function buildSearchIndexV2(documents: SearchDocument[], dictionary: DictionaryExpansion): SearchRuntimeIndexV2`
  - `export function serializeSearchIndexV2(index: SearchRuntimeIndexV2): SearchIndexV2`
  - `export function deserializeSearchIndexV2(value: unknown): SearchRuntimeIndexV2 | undefined`
- 참고 패턴: current serialized search index stores only `documents` and rebuilds runtime index on deserialize.
- source_anchors: `src/search/bm25.ts:4-14`, `src/search/bm25.ts:36-65`, `src/search/index.ts:21-60`, `docs/research/20260501-speckiwi-performance-indexing-research.md:307-358`
- 구현 가이드:
  1. Keep v1 deserializer fallback for existing `documents`-only caches.
  2. Add `format: "speckiwi/search-index/v2"` guard.
  3. Serialize exact index as arrays sorted by normalized key.
  4. Serialize filter buckets by entityType, documentId, scope, type, status, tag, path.
  5. Serialize BM25 postings by token, field, docIndex, term frequency.
  6. Runtime shape can use `Map` and typed arrays internally, but serialized shape must be plain JSON.
- Rationale: cache hit currently rebuilds exact map and BM25 structures, so cache search remains several seconds at SRS scale.
- 함정 / 주의사항: public search result ordering must remain deterministic across v1 fallback, v2 warm cache, and source path.
- 테스트 작성 지침: serialize/deserialize equality, v1 fallback, invalid v2 fallback, deterministic stableJson 4축을 검증한다.
- 검증 명령어: `npm test -- search`
- acceptance_tests:
  - {shell: "bash", cmd: "npm test -- search", expected_exit: 0}
  - {shell: "pwsh", cmd: "npm test -- search", expected_exit: 0}
- DoD: deserializing search-index v2 does not call `buildSearchIndex()` on the full document list.
- rollback: {strategy: "manual", command: "1) Restore src/search/bm25.ts and src/search/index.ts from git. 2) Delete src/indexing/full-text.ts and new search tests. 3) Run npm test -- search."}
- 예상 소요: 8~12시간

### TASK-P4-002 - Switch searchWorkspace To Cache-Before-YAML Path

- 관련 REQ-ID: `FR-SRCH-009`, `FR-CACHE-006`, `FR-CACHE-007`, `FR-CACHE-009`, `NFR-PERF-002`
- 파일 경로: `src/core/search.ts`, `src/core/read-model.ts`, `src/cache/rebuild.ts`, `test/search/search.test.ts`, `test/cache/cache.test.ts`
- 메서드/함수 시그니처:
  - `async function loadSearchIndexFromCache(root: WorkspaceRoot): Promise<{ index?: SearchRuntimeIndexV2; warning?: Diagnostic; stats: ReadModelLoadStats }>`
  - `export async function searchWorkspace(input: SearchInput): Promise<SearchResultSet>`
- 참고 패턴: current `searchWorkspace()` loads workspace before checking manifest and cache.
- source_anchors: `src/core/search.ts:15-43`, `src/cache/manifest.ts:57-124`, `docs/research/20260501-speckiwi-performance-indexing-research.md:62-102`, `docs/research/20260501-speckiwi-performance-indexing-research.md:470-472`
- 구현 가이드:
  1. Resolve root.
  2. If cache mode is not bypass, read manifest v2 and check only search section freshness using stat quick accept, manifest section fingerprints, tokenizer version, dictionary hash, and search settings hash.
  3. If fresh, read `.speckiwi/cache/search-index.json` and deserialize v2.
  4. If cache hit succeeds, call search runtime directly without `loadWorkspaceForValidation()`.
  5. If stat quick accept fails or version fingerprints differ, compute sha256 fingerprints and rebuild or fallback using current YAML path with warning diagnostic.
  6. Bypass mode jumps directly to source path and writes no cache files.
- Rationale: cache search cannot meet 500ms when YAML parse is unconditionally first.
- 함정 / 주의사항: fresh cache path must not hash every YAML file. Full sha256 work belongs to mismatch/rebuild branches.
- 테스트 작성 지침: monkeypatch or stats assertion should prove parsed file count is 0 on fresh cache search.
- 검증 명령어: `npm run perf:srs`
- acceptance_tests:
  - {shell: "bash", cmd: "npm run perf:srs", expected_exit: 0, stdout_regex: "cachedSearchMs"}
  - {shell: "pwsh", cmd: "npm run perf:srs", expected_exit: 0, stdout_regex: "cachedSearchMs"}
- DoD: SRS-scale cached exact search is <= 500ms and cache hit stats show parsedFileCount 0.
- rollback: {strategy: "manual", command: "1) Restore src/core/search.ts, src/core/read-model.ts, and cache rebuild changes from git. 2) Run npm test -- search cache."}
- 예상 소요: 8~12시간

### TASK-P4-003 - Replace Query-Time Full Scans With Filter Buckets And Postings

- 관련 REQ-ID: `FR-SRCH-001`, `FR-SRCH-005`, `FR-SRCH-006`, `NFR-PERF-002`
- 파일 경로: `src/indexing/full-text.ts`, `src/search/index.ts`, `src/search/bm25.ts`, `test/search/search.test.ts`
- 메서드/함수 시그니처:
  - `function candidateSetForFilters(index: SearchRuntimeIndexV2, filters: SearchFilters | undefined): Set<number>`
  - `function exactSearchV2(index: SearchRuntimeIndexV2, queries: string[], allowed: Set<number>): SearchResultItem[]`
  - `function bm25SearchV2(index: SearchRuntimeIndexV2, queryTokens: string[], allowed: Set<number>, limit: number, offset: number): Bm25Candidate[]`
- 참고 패턴: current `allowedDocumentIndexes()` scans all documents and `bm25Search()` loops through every indexed document.
- source_anchors: `src/search/index.ts:62-99`, `src/search/index.ts:142-150`, `src/search/bm25.ts:65-116`, `docs/research/20260501-speckiwi-performance-indexing-research.md:348-358`
- 구현 가이드:
  1. Convert filters to sorted doc index sets from serialized bucket maps.
  2. Intersect filter candidate sets starting from the smallest set.
  3. Exact mode reads exact map entries and intersects with allowed set.
  4. BM25 mode reads postings only for query tokens and accumulates scores by docIndex.
  5. Use top-K selection for `offset + limit` before materializing result DTOs.
- Rationale: once YAML load is removed, query-time all-document scans become the next bottleneck.
- 함정 / 주의사항: `mode: "auto"` must merge exact and BM25 results with the existing scoring and deterministic sort contract.
- 테스트 작성 지침: unfiltered exact, multi-filter exact, BM25 with high-frequency tokens, auto mode merge, pagination stability 5축을 검증한다.
- 검증 명령어: `npm test -- search`
- acceptance_tests:
  - {shell: "bash", cmd: "npm test -- search", expected_exit: 0}
  - {shell: "pwsh", cmd: "npm test -- search", expected_exit: 0}
- DoD: filtered search does not scan every document for allowed candidates in v2 runtime.
- rollback: {strategy: "manual", command: "1) Restore search algorithm files from git. 2) Keep serialization code only if tests remain green, otherwise restore it too. 3) Run npm test -- search."}
- 예상 소요: 8~12시간

## Phase P5 - MCP And CLI Fast-Path Parity

목표: MCP 서버와 CLI가 같은 Core read model을 쓰고, long-lived MCP process에서 safe memoization을 적용한다.

### TASK-P5-001 - Route Search, Requirement, And List Tools Through Core API ReadModel

- 관련 REQ-ID: `FR-MCP-004`, `FR-MCP-005`, `FR-MCP-006`, `FR-MCP-014`, `FR-MCP-015`, `FR-REQ-016`, `NFR-PERF-005`, `NFR-MAINT-008`
- 파일 경로: `src/mcp/tools.ts`, `src/core/api.ts`, `src/core/search.ts`, `src/core/requirements.ts`, `src/cli/commands/search.ts`, `src/cli/commands/req.ts`, `src/cli/commands/list.ts`, `test/mcp/tools.test.ts`, `test/cli/read-commands.test.ts`, `test/perf/perf.test.ts`
- 메서드/함수 시그니처:
  - `export function registerMcpTools(server: McpServer, core: SpecKiwiCore): void`
  - `SpecKiwiCore["search"]`
  - `SpecKiwiCore["getRequirement"]`
- 참고 패턴: MCP registration already delegates search/get/list to `core`, but `core` currently lives in MCP tools. Graph/trace/impact warm graph parity is handled later in `TASK-P6-003`.
- source_anchors: `src/mcp/tools.ts:186-256`, `src/cli/commands/graph.ts:28-31`, `src/cli/commands/impact.ts:28-41`, `test/perf/perf.test.ts:226-235`, `docs/research/20260501-speckiwi-performance-indexing-research.md:474-479`
- 구현 가이드:
  1. MCP imports `createSpecKiwiCore` from `src/core/api.ts`.
  2. MCP `search`, `getRequirement`, and `listRequirements` use the same Core read model path as CLI commands.
  3. CLI `search`, `req get`, and `list reqs` are covered by parity tests with MCP for query, filters, project filter, pagination, and diagnostics.
  4. Graph/trace/impact CLI and MCP direct workspace loads are documented as owned by `TASK-P6-003`, after graph index exists.
  5. Tool input root override restrictions remain in schema/handler layer and invalid request shape returns JSON-RPC InvalidParams.
  6. Tool metadata keeps `outputSchema` aligned with JSON-compatible Core DTO structuredContent.
- Rationale: SRS `NFR-PERF-005` measures MCP calls, so CLI-only fast paths are insufficient.
- 함정 / 주의사항: stdio protocol cleanliness and InvalidParams behavior are not part of read model and must remain adapter-owned.
- 테스트 작성 지침: MCP search fast path, MCP get requirement fast path, list project filter parity, CLI/MCP search parity, invalid params regression, outputSchema regression 6축을 검증한다.
- 검증 명령어: `npm test -- mcp`
- acceptance_tests:
  - {shell: "bash", cmd: "npm test -- mcp", expected_exit: 0}
  - {shell: "pwsh", cmd: "npm test -- mcp", expected_exit: 0}
- DoD: SRS-scale MCP search call is <= 1s in `npm run perf:srs`, and CLI/MCP search/get/list return matching Core DTO payloads for the same inputs.
- rollback: {strategy: "manual", command: "1) Restore src/mcp/tools.ts and src/core/api.ts from git. 2) Run npm test -- mcp."}
- 예상 소요: 5~8시간

### TASK-P5-002 - Add Process-Local ReadModel Memoization With Invalidation

- 관련 REQ-ID: `NFR-PERF-005`, `NFR-PERF-006`, `FR-WRITE-009`
- 파일 경로: `src/core/read-model.ts`, `src/core/api.ts`, `src/core/apply-change.ts`, `test/mcp/tools.test.ts`, `test/write/apply.test.ts`
- 메서드/함수 시그니처:
  - `export type ReadModelCacheKey = { root: string; cacheMode: CacheMode; sourceStatHash: string; manifestHash: string; artifactStatHash: string; sections: string[] }`
  - `export function clearReadModelMemo(root?: string): void`
  - `export function createReadModelMemo(): { get(...): Promise<ReadModel>; clear(root?: string): void }`
- 참고 패턴: MCP core object is long-lived and currently calls underlying functions per request.
- source_anchors: `src/mcp/tools.ts:128-174`, `src/write/apply.ts:1-80`, `docs/research/20260501-speckiwi-performance-indexing-research.md:422-429`
- 구현 가이드:
  1. Memoize immutable read models by root, cacheMode, source stat hash, manifest hash, artifact stat hash, and requested sections.
  2. Do not memoize `cacheMode: "bypass"`.
  3. Clear memo after apply/write success and after cache rebuild/clean.
  4. Recompute memo key from cheap source stats and cache artifact stats on each request so external cache rebuild or clean in another process invalidates the memo.
  5. Limit memo entries with a small LRU cap such as 8 roots.
  6. Expose test-only stats through returned `ReadModelLoadStats`, not through global mutable DTO.
- Rationale: MCP server process handles repeated calls; deserializing the same fresh cache artifact for every tool call wastes the budget.
- 함정 / 주의사항: memoized models must be immutable snapshots. Do not expose mutable arrays that adapters can mutate.
- 테스트 작성 지침: repeated MCP search reuses memo, apply clears memo, cache clean clears memo, external cache rebuild changes manifestHash and invalidates memo, corrupt artifact replacement changes artifactStatHash, bypass does not memoize 6축을 검증한다.
- 검증 명령어: `npm test -- mcp write cache`
- acceptance_tests:
  - {shell: "bash", cmd: "npm test -- mcp write cache", expected_exit: 0}
  - {shell: "pwsh", cmd: "npm test -- mcp write cache", expected_exit: 0}
- DoD: repeated MCP search on fresh cache records one artifact load followed by memo hits, write invalidation prevents stale responses, and external cache metadata changes invalidate memo without process restart.
- rollback: {strategy: "manual", command: "1) Restore memoization-owned files from git. 2) Run npm test -- mcp write cache."}
- 예상 소요: 6~10시간

## Phase P6 - Incremental Facts And Graph Index Stabilization

목표: per-file artifacts와 facts 기반 semantic rules를 도입해 cache rebuild/validation 확장성을 확보하고 graph traversal scan을 adjacency 기반으로 전환한다.

### TASK-P6-001 - Add DocumentArtifactStore And WorkspaceFacts

- 관련 REQ-ID: `FR-CACHE-005`, `FR-CACHE-008`, `NFR-PERF-003`, `NFR-PERF-004`, `NFR-PERF-006`
- 파일 경로: `src/cache/document-artifacts.ts`, `src/cache/rebuild.ts`, `src/validate/facts.ts`, `src/indexing/entities.ts`, `src/indexing/relations.ts`, `src/indexing/full-text.ts`, `src/indexing/graph-index.ts`, `test/cache/cache.test.ts`, `test/validate/semantic.test.ts`
- 메서드/함수 시그니처:
  - `export type DocumentArtifactV1 = { format: "speckiwi/document-artifact/v1"; path: string; sha256: string; schemaKind?: string; yamlDiagnostics: Diagnostic[]; schemaDiagnostics: Diagnostic[]; facts: DocumentFacts }`
  - `export type WorkspaceFacts = { project: ProjectFact; documents: DocumentFact[]; requirements: RequirementFact[]; relations: RelationFact[]; dictionary: DictionaryFact }`
  - `export async function loadDocumentArtifacts(root: WorkspaceRoot, fingerprints: SourceFileFingerprint[]): Promise<DocumentArtifactLoadResult>`
  - `export function buildWorkspaceIndexesFromFacts(facts: WorkspaceFacts): { entities: EntityIndexV1; relations: RelationIndexV1; search: SearchRuntimeIndexV2; graph: GraphIndexV1 }`
- 참고 패턴: current validation loads every YAML document and runs schema validation in `loadWorkspaceForValidation()`.
- source_anchors: `src/validate/semantic.ts:36-138`, `src/validate/semantic.ts:140-155`, `docs/research/20260501-speckiwi-performance-indexing-research.md:205-234`, `docs/research/20260501-speckiwi-performance-indexing-research.md:365-397`
- 구현 가이드:
  1. Artifact key is source file sha256.
  2. Changed files regenerate YAML parse, schema diagnostics, and facts.
  3. Unchanged files load facts from artifact.
  4. `rebuildCache()` rebuilds entities, relations, search, graph, and diagnostics artifacts from `WorkspaceFacts`.
  5. `index.yaml` change invalidates control-plane dependent schema resolution conservatively.
  6. Semantic diagnostics are not stored as deltas; they are recomputed from `WorkspaceFacts`.
- Rationale: full incremental BM25 patching is too risky initially, but per-file parse/schema artifacts remove the expensive repeated YAML work.
- 함정 / 주의사항: byte-stable diagnostics cannot include absolute paths, timestamps, or OS-specific separators. Facts 도입 후 rebuild가 다시 full `LoadedWorkspace` traversal에만 의존하면 `NFR-PERF-003` 구현 범위가 충족되지 않는다.
- 테스트 작성 지침: one-file change artifact hit, index.yaml conservative invalidation, corrupt artifact fallback, facts deterministic sort, SRS-scale cache rebuild budget 5축을 검증한다.
- 검증 명령어: `npm run perf:srs`
- acceptance_tests:
  - {shell: "bash", cmd: "npm run perf:srs", expected_exit: 0, stdout_regex: "cacheRebuildMs"}
  - {shell: "pwsh", cmd: "npm run perf:srs", expected_exit: 0, stdout_regex: "cacheRebuildMs"}
- DoD: changing one SRS file regenerates one document artifact, global diagnostics remain correct, and SRS-scale cache rebuild is <= 10s.
- rollback: {strategy: "manual", command: "1) Delete document artifact and facts modules plus related tests. 2) Run npm test -- cache validate."}
- 예상 소요: 10~16시간

### TASK-P6-002 - Move Semantic Validation Rules To Facts

- 관련 REQ-ID: `FR-VAL-001`, `FR-REQ-001`, `FR-REQ-009`, `FR-REQ-010`, `NFR-PERF-004`
- 파일 경로: `src/validate/semantic-rules.ts`, `src/validate/semantic.ts`, `test/validate/semantic.test.ts`
- 메서드/함수 시그니처:
  - `export function validateWorkspaceFacts(facts: WorkspaceFacts): DiagnosticBag`
  - `export function loadedWorkspaceToFacts(workspace: LoadedWorkspace): WorkspaceFacts`
- 참고 패턴: `validateRegistry()` currently runs semantic checks over `LoadedWorkspace`.
- source_anchors: `src/validate/semantic.ts:140-155`, `src/validate/semantic.ts:158-220`, `docs/research/20260501-speckiwi-performance-indexing-research.md:365-397`
- 구현 가이드:
  1. Extract duplicate document, duplicate requirement, relation target, cycle, PRD/technical reference checks into pure functions over facts.
  2. Keep `validateRegistry(workspace)` as compatibility wrapper that converts workspace to facts and calls `validateWorkspaceFacts()`.
  3. Sort diagnostics by path, code, id, message.
  4. Add byte-stability snapshot tests for cold source facts and warm artifact facts.
- Rationale: facts are the shared input for validation, entity index, search document creation, and graph index, removing repeated YAML-object traversal.
- 함정 / 주의사항: schema validation stays per-document. Global semantic diagnostics are recomputed from all facts each run.
- 테스트 작성 지침: duplicate IDs, relation target missing, cycle detection, PRD references, cold/warm diagnostic equality 5축을 검증한다.
- 검증 명령어: `npm test -- validate`
- acceptance_tests:
  - {shell: "bash", cmd: "npm test -- validate", expected_exit: 0}
  - {shell: "pwsh", cmd: "npm test -- validate", expected_exit: 0}
- DoD: existing semantic validation behavior is preserved and facts warm path produces equal diagnostics.
- rollback: {strategy: "manual", command: "1) Restore src/validate/semantic.ts from git and delete semantic-rules tests. 2) Run npm test -- validate."}
- 예상 소요: 10~16시간

### TASK-P6-003 - Add Graph Index Adjacency And Graph ReadModel Section

- 관련 REQ-ID: `FR-LINK-003`, `FR-MCP-008`, `FR-MCP-009`, `FR-MCP-010`, `NFR-PERF-005`
- 파일 경로: `src/indexing/graph-index.ts`, `src/graph/builder.ts`, `src/graph/trace.ts`, `src/graph/impact.ts`, `src/core/read-model.ts`, `src/core/api.ts`, `src/mcp/tools.ts`, `src/cli/commands/graph.ts`, `src/cli/commands/impact.ts`, `test/graph/graph.test.ts`, `test/mcp/tools.test.ts`, `test/cli/read-commands.test.ts`
- 메서드/함수 시그니처:
  - `export type GraphIndexV1 = { format: "speckiwi/graph-index/v1"; nodes: GraphNode[]; edges: GraphEdge[]; outgoing: Array<[string, string[]]>; incoming: Array<[string, string[]]> }`
  - `export function buildGraphIndex(registry: RequirementRegistry): GraphIndexV1`
  - `export function graphResultFromIndex(index: GraphIndexV1, graphType: GraphType): GraphResult`
  - `export function traceRequirementFromIndex(input: TraceRequirementInput, index: GraphIndexV1): TraceResult`
  - `export function impactRequirementFromIndex(input: ImpactInput, index: GraphIndexV1): ImpactResult`
- 참고 패턴: trace and impact currently filter edge arrays repeatedly to find adjacent edges.
- source_anchors: `src/graph/builder.ts:9-44`, `src/graph/trace.ts:20-85`, `src/graph/impact.ts:41-126`, `docs/research/20260501-speckiwi-performance-indexing-research.md:474-479`
- 구현 가이드:
  1. Build graph nodes and edges once from entity/relation indexes.
  2. Serialize incoming/outgoing adjacency as arrays of edge keys.
  3. Runtime graph index reconstructs maps for traversal.
  4. `traceRequirement` and `impactRequirement` use adjacency for traversal and keep output sorting identical.
  5. `loadReadModel({ sections: ["graph"] })` reads graph artifact on fresh cache and falls back to source graph builder otherwise.
  6. CLI `graph` and `impact`, MCP `speckiwi_graph`, `speckiwi_trace_requirement`, and `speckiwi_impact` all call the same Core graph read model path.
- Rationale: after search/get are fixed, graph/MCP calls should share the same indexed read model instead of reloading workspace.
- 함정 / 주의사항: graph DTO remains materialized output. Internal adjacency maps are not exposed in Core DTO.
- 테스트 작성 지침: graph type parity, trace direction parity, impact context parity, CLI/MCP graph/trace/impact parity, corrupt graph fallback 5축을 검증한다.
- 검증 명령어: `npm test -- graph mcp`
- acceptance_tests:
  - {shell: "bash", cmd: "npm test -- graph mcp", expected_exit: 0}
  - {shell: "pwsh", cmd: "npm test -- graph mcp", expected_exit: 0}
- DoD: graph, trace, and impact warm cache path does not call `loadWorkspaceForValidation()`, CLI/MCP graph outputs match source path, and all graph DTOs remain JSON-compatible.
- rollback: {strategy: "manual", command: "1) Restore graph and read-model files from git. 2) Delete graph-index tests. 3) Run npm test -- graph mcp."}
- 예상 소요: 8~14시간

## 스펙 매핑 표

| REQ-ID | TASK-ID |
|---|---|
| `NFR-PERF-001` | `TASK-P0-001`, `TASK-P3-001`, `TASK-P3-002`, `TASK-P3-003` |
| `NFR-PERF-002` | `TASK-P0-001`, `TASK-P4-001`, `TASK-P4-002`, `TASK-P4-003` |
| `NFR-PERF-003` | `TASK-P0-001`, `TASK-P6-001` |
| `NFR-PERF-004` | `TASK-P0-001`, `TASK-P6-001`, `TASK-P6-002` |
| `NFR-PERF-005` | `TASK-P0-001`, `TASK-P5-001`, `TASK-P5-002`, `TASK-P6-003` |
| `NFR-PERF-006` | `TASK-P1-001`, `TASK-P1-002`, `TASK-P2-002`, `TASK-P3-002`, `TASK-P5-002`, `TASK-P6-001` |
| `NFR-PERF-007` | `TASK-P0-001` |
| `FR-CACHE-001` | `TASK-P0-002`, `TASK-P1-003`, `TASK-P2-002` |
| `FR-CACHE-002` | `TASK-P0-002`, `TASK-P1-003` |
| `FR-CACHE-003` | `TASK-P3-002` |
| `FR-CACHE-005` | `TASK-P0-002`, `TASK-P1-001`, `TASK-P1-002`, `TASK-P6-001` |
| `FR-CACHE-006` | `TASK-P0-002`, `TASK-P4-002` |
| `FR-CACHE-007` | `TASK-P0-002`, `TASK-P1-003`, `TASK-P2-002`, `TASK-P4-002` |
| `FR-CACHE-008` | `TASK-P1-001`, `TASK-P1-002`, `TASK-P3-002`, `TASK-P6-001` |
| `FR-CACHE-009` | `TASK-P4-001`, `TASK-P4-002` |
| `FR-CACHE-010` | `TASK-P1-004` |
| `FR-REQ-016` | `TASK-P0-002`, `TASK-P5-001` |
| `FR-REQ-002` | `TASK-P3-001`, `TASK-P3-003` |
| `FR-REQ-003` | `TASK-P3-001`, `TASK-P3-003` |
| `FR-REQ-011` | `TASK-P3-001` |
| `FR-SRCH-001` | `TASK-P4-003` |
| `FR-SRCH-005` | `TASK-P4-003` |
| `FR-SRCH-006` | `TASK-P4-003` |
| `FR-SRCH-009` | `TASK-P4-001`, `TASK-P4-002` |
| `FR-MCP-004` | `TASK-P5-001` |
| `FR-MCP-005` | `TASK-P3-003`, `TASK-P5-001` |
| `FR-MCP-006` | `TASK-P5-001` |
| `FR-MCP-008` | `TASK-P6-003` |
| `FR-MCP-009` | `TASK-P6-003` |
| `FR-MCP-010` | `TASK-P6-003` |
| `FR-MCP-014` | `TASK-P5-001` |
| `FR-MCP-015` | `TASK-P5-001` |
| `FR-LINK-003` | `TASK-P6-003` |
| `FR-VAL-001` | `TASK-P6-002` |
| `FR-REQ-001` | `TASK-P6-002` |
| `FR-REQ-009` | `TASK-P6-002` |
| `FR-REQ-010` | `TASK-P6-002` |
| `FR-WRITE-009` | `TASK-P5-002` |
| `NFR-SEC-010` | `TASK-P2-003` |
| `NFR-MAINT-001` | `TASK-P2-001` |
| `NFR-MAINT-008` | `TASK-P2-001`, `TASK-P5-001` |

## 리스크 및 완화

| 리스크 | 심각도 | 완화 |
|---|---|---|
| cache-backed path와 source path의 DTO drift | High | Phase P0 cold/warm DTO equality를 선행 gate로 둔다. |
| manifest v2 전환 중 기존 v1 cache 사용자가 깨짐 | Medium | v1 compatibility wrapper와 source fallback을 유지한다. |
| SearchIndexV2가 너무 커져 deserialize 비용이 커짐 | Medium | exact lookup은 entities artifact만 읽고, search는 postings/filter sections만 사용한다. |
| process-local memoization이 stale response를 반환함 | High | fingerprint key와 apply/cache rebuild invalidation test를 추가한다. |
| facts 기반 validation 전환 중 diagnostic 순서가 흔들림 | Medium | path/code/id/message deterministic sort와 byte-stability test를 둔다. |
| SRS strict perf가 개발 장비별 편차로 흔들림 | Medium | local profile과 strict profile을 분리하되 strict budget 자체는 유지한다. |

## 용어집

| 용어 | 정의 |
|---|---|
| ReadModel | Core read operation이 사용하는 불변 snapshot. source YAML 또는 fresh cache artifacts에서 생성된다. |
| Source path | YAML 파일을 직접 parse/schema validate한 뒤 결과를 만드는 경로다. |
| Warm cache path | manifest가 fresh인 cache artifacts를 읽어 결과를 만드는 경로다. |
| EntityIndex | documents, scopes, requirements, lookup tables를 담는 직렬화 가능한 index다. |
| RelationIndex | requirement incoming/outgoing relation을 담는 직렬화 가능한 index다. |
| SearchIndexV2 | exact map, filter buckets, BM25 postings, dictionary를 직렬화하는 full-text index다. |
| WorkspaceFacts | YAML document에서 추출한 validation/indexing 공용 사실 집합이다. |
| DocumentArtifact | source YAML 파일 하나의 parse/schema/facts 결과를 저장한 cache artifact다. |
| Section freshness | entities/search/graph 같은 cache section 단위로 stale 여부를 판단하는 방식이다. |
| DTO parity | source path와 warm cache path가 같은 public Core DTO를 반환해야 한다는 조건이다. |

## 메타

- Mode: NORMAL
- Dew File: `.snoworca/dew/planner/plan-20260501-speckiwi-performance-indexing-v1/`
- Senior triggers: multi-module architecture, cache invalidation, MCP boundary, performance-critical indexing
- Pre-screen: Phase count is 7, so phase grouping was checked against the research document before drafting.
- Evaluator gate target: CRITICAL 0, HIGH 0 before `scope_freeze` is promoted to true.
