# SpecKiwi 성능 개선 연구: Unified Indexed Read Model

작성일: 2026-05-01

## 1. 결론

현재 성능 문제는 단순한 미세 최적화 문제가 아니다. 핵심 병목은 다음 두 가지다.

1. `getRequirement`, `searchWorkspace`, MCP tool 호출이 cache hit 여부를 판단하기 전에 전체 YAML workspace를 로드하고 검증한다.
2. `search-index.json`이 실제 런타임 인덱스가 아니라 flattened document 목록만 저장하므로, cache를 읽어도 exact map, token counts, document frequency, BM25 구조를 매번 다시 만든다.

따라서 최선의 개선 방향은 **Unified Indexed Read Model**이다. 단, 이것은 하나의 거대한 mutable object를 만들자는 뜻이 아니다. `facts`, `entities`, `relations`, `fullText`, `graph`를 독립 모듈로 나누고, `core/read-model`에서 불변 snapshot으로 조립하는 구조다.

목표는 다음이다.

| SRS | 목표 | 현재 관측 |
|---|---:|---:|
| NFR-PERF-001 | 10,000 requirement exact lookup <= 50ms | 약 1.5s-4.4s |
| NFR-PERF-002 | 10,000 requirement cache search <= 500ms | 약 4.8s-5.4s |
| NFR-PERF-005 | 정상 cache MCP tool call <= 1s | 약 3.3s-5.6s |

`release:check`는 통과하지만 `npm run perf:srs`는 strict budget을 만족하지 못한다. 성능 요구사항은 아직 미충족이다.

## 2. 연구 방식

5개 서브에이전트가 독립적으로 조사한 뒤 상호 비판 라운드를 거쳤다.

| 역할 | 초점 | 주요 결론 |
|---|---|---|
| Exact lookup | requirement registry fast path | requirement ID lookup은 search와 분리된 1급 index여야 한다. |
| Search index | cache/search/BM25 구조 | serialized exact/filter/BM25 postings가 필요하다. |
| Validation/cache | incremental validation | per-file artifact와 facts 기반 semantic rules가 필요하다. |
| MCP/CLI | adapter 경계 | `createSpecKiwiCore`는 MCP가 아니라 core API로 이동해야 한다. |
| Indexing design | 전체 read model | facts/entities/relations/search/graph sub-index를 가진 immutable read model이 최종 구조다. |

토론 후 합의된 방향은 **Incremental Workspace Facts + Sectional ReadModel + SearchIndexV2**이다.

## 3. 현재 병목 증거

### 3.1 Requirement exact lookup

`src/core/requirements.ts:81`:

```ts
export async function loadRequirementRegistry(input: RootInput = {}): Promise<RequirementRegistry> {
  const root = workspaceRootFromPath(resolve(input.root ?? process.cwd()));
  const workspace = await loadWorkspaceForValidation(root);
  return buildRequirementRegistry(workspace);
}
```

`src/core/requirements.ts:135`:

```ts
export async function getRequirement(input: GetRequirementInput): Promise<RequirementResult> {
  return getRequirementFromRegistry(input, await loadRequirementRegistry(input));
}
```

`Map#get` 자체는 빠르지만, 거기에 도달하기 전 1,000개 YAML 파일을 모두 로드한다. exact lookup 목표 50ms를 만족할 수 없는 구조다.

### 3.2 Search cache

`src/core/search.ts:15`:

```ts
export async function searchWorkspace(input: SearchInput): Promise<SearchResultSet> {
  const root = workspaceRootFromPath(resolve(input.root ?? process.cwd()));
  const workspace = await loadWorkspaceForValidation(root);
```

cache를 읽기 전에 이미 전체 workspace를 로드한다.

`src/cache/manifest.ts:57`:

```ts
export async function buildCacheInputs(root: WorkspaceRoot, workspace: LoadedWorkspace): Promise<CacheInputs> {
```

freshness 판단이 `LoadedWorkspace`에 의존한다. 즉 stale 여부 확인 자체가 전체 YAML parse 이후에만 가능하다.

`src/search/bm25.ts:51`:

```ts
export function serializeSearchIndex(index: SearchIndex): SerializedSearchIndex {
  return {
    documents: index.documents
  };
}
```

cache가 실제 index를 저장하지 않는다.

`src/search/bm25.ts:57`:

```ts
export function deserializeSearchIndex(serialized: SerializedSearchIndex): SearchIndex {
  return buildSearchIndex(serialized.documents);
}
```

cache hit 후에도 index를 다시 만든다.

### 3.3 BM25 query path

`src/search/bm25.ts:65`의 `bm25Search`는 모든 indexed document를 순회한다. 필터도 `src/search/index.ts`에서 매번 전체 document scan으로 `allowedIndexes`를 만든다. 10,000 requirement 규모에서 query-time scan이 반복된다.

### 3.4 MCP/CLI 경계

`createSpecKiwiCore`가 `src/mcp/tools.ts`에 있다. MCP adapter가 core orchestration까지 들고 있어 CLI와 MCP가 같은 read path를 강제하기 어렵다. `src/mcp/tools.ts:140`의 graph 함수도 매 호출마다 workspace를 로드한다.

## 4. 최종 아키텍처

### 4.1 이름

**Unified Indexed Read Model**

### 4.2 원칙

1. YAML은 계속 source of truth다.
2. cache는 disposable artifact다.
3. cache fresh path에서는 YAML을 parse하지 않는다.
4. `--no-cache` / `cacheMode: "bypass"`는 cache read/write를 모두 하지 않는다.
5. public CLI/MCP DTO와 internal index shape를 분리한다.
6. index는 불변 snapshot으로 다룬다.
7. graph/search/requirement/validation이 각자 YAML을 다시 읽지 않는다.

### 4.3 모듈 경계

제안 디렉토리:

```text
src/core/api.ts
src/core/read-model.ts

src/cache/fingerprint.ts
src/cache/document-artifacts.ts
src/cache/index-manifest.ts

src/validate/facts.ts
src/validate/semantic-rules.ts

src/indexing/workspace-index.ts
src/indexing/entities.ts
src/indexing/relations.ts
src/indexing/search-documents.ts
src/indexing/full-text.ts
src/indexing/graph-index.ts
src/indexing/serialization.ts
```

책임:

| 모듈 | 책임 |
|---|---|
| `core/api.ts` | CLI/MCP가 공유하는 root-bound facade. MCP type에 의존하지 않는다. |
| `core/read-model.ts` | cache/source에서 immutable read model을 로드하고 process-local memoization을 관리한다. |
| `cache/fingerprint.ts` | `.speckiwi/**/*.yaml` 발견, store path 정규화, size/mtime/hash 기반 fingerprint 생성. |
| `cache/document-artifacts.ts` | per-file parse/schema/fact artifact 저장/로드. |
| `validate/facts.ts` | YAML object에서 manifest, document, requirement, relation, dictionary, search text facts 추출. |
| `validate/semantic-rules.ts` | `WorkspaceFacts`에 대한 pure global semantic validation. |
| `indexing/entities.ts` | documents/scopes/requirements/nested entities의 canonical arrays/maps. |
| `indexing/relations.ts` | requirement/document/scope relation과 adjacency map. |
| `indexing/full-text.ts` | exact index, filter buckets, inverted postings, BM25 runtime. |
| `indexing/graph-index.ts` | graph views와 trace/impact adjacency. |
| `indexing/serialization.ts` | versioned JSON envelope 검증/upgrade/fallback. |

## 5. Cache artifact 설계

### 5.1 Manifest v2

timestamp-free, deterministic manifest를 사용한다.

```ts
type IndexManifestV2 = {
  format: "speckiwi/cache-manifest/v2";
  speckiwiVersion: string;
  cacheSchemaVersion: 2;
  parserVersion: string;
  schemaBundleHash: string;
  files: Array<{
    path: string;
    size: number;
    mtimeMs: number;
    sha256: string;
    schemaKind?: string;
    artifactHash?: string;
  }>;
  sections: {
    facts: SectionFingerprint;
    entities: SectionFingerprint;
    relations: SectionFingerprint;
    search: SectionFingerprint & {
      tokenizerVersion: string;
      searchSettingsHash: string;
      dictionaryHash: string;
    };
    graph: SectionFingerprint & {
      graphRulesVersion: string;
    };
    diagnostics: SectionFingerprint;
  };
};
```

`isCacheStale()`처럼 모든 section을 한 번에 비교하지 않는다. search command는 search section만, graph command는 graph section만 확인한다.

### 5.2 Document artifact

Per-file artifact는 source file 단위로 저장한다.

```text
.speckiwi/cache/artifacts/<sha256>.json
```

각 artifact:

```ts
type DocumentArtifact = {
  format: "speckiwi/document-artifact/v1";
  path: string;
  sha256: string;
  parserVersion: string;
  schemaBundleHash: string;
  schemaKind: string;
  yamlDiagnostics: Diagnostic[];
  schemaDiagnostics: Diagnostic[];
  facts: DocumentFacts;
};
```

중요: semantic diagnostics를 delta로 저장하지 않는다. global semantic diagnostics는 항상 `WorkspaceFacts`에서 재계산한다.

### 5.3 Read model artifacts

첫 구현은 split artifact를 권장한다.

```text
.speckiwi/cache/entities.json
.speckiwi/cache/relations.json
.speckiwi/cache/search-index.json
.speckiwi/cache/graph-index.json
.speckiwi/cache/diagnostics.json
.speckiwi/cache/manifest.json
```

이유:

- exact lookup은 search/BM25/graph를 deserialize하지 않아도 된다.
- search command는 graph를 읽지 않아도 된다.
- corrupt section fallback을 더 좁게 처리할 수 있다.

## 6. Exact lookup fast path

### 6.1 목표

10,000 requirement 기준 `speckiwi req get <id>` 및 core `getRequirement()`를 50ms 안에 넣는다.

### 6.2 Runtime structure

`entities.json`에는 작은 lookup index를 저장한다.

```ts
type EntityIndexV1 = {
  format: "speckiwi/entities/v1";
  project: ProjectSummary;
  documents: DocumentSummary[];
  scopes: ScopeSummary[];
  requirements: RequirementSummary[];
  requirementLookup: Array<[requirementId: string, ordinal: number]>;
  documentLookup: Array<[documentId: string, ordinal: number]>;
  requirementPayloadShards: Array<{
    path: string;
    requirementIds: string[];
    shardPath: string;
  }>;
};
```

Full requirement payload는 document artifact 또는 별도 shard에서 읽는다.

```text
.speckiwi/cache/requirements/<document-hash>.json
```

### 6.3 Query path

1. root resolve
2. `cacheMode !== "bypass"` 확인
3. manifest와 `entities.json` shape/version 확인
4. filesystem fingerprint로 freshness 확인
5. `requirementLookup`에서 ID lookup
6. 필요한 shard만 읽어 payload materialize
7. `includeDocument`, `includeRelations`는 `entities`/`relations`에서 materialize
8. 실패 시 source YAML fallback

금지:

- `getRequirement()`가 search exact mode를 호출하는 구조
- exact lookup을 위해 BM25/search index를 deserialize하는 구조
- ID를 찾기 위해 모든 document shard를 scan하는 구조

## 7. SearchIndexV2

### 7.1 목표

10,000 requirement 기준 cache 기반 search <= 500ms.

### 7.2 Serialized shape

```ts
type SearchIndexV2 = {
  format: "speckiwi/search-index/v2";
  tokenizerVersion: string;
  searchSettingsHash: string;
  sourceFingerprint: string;
  documents: SearchDocumentSummary[];
  exact: Array<[normalizedKey: string, entries: Array<[docIndex: number, field: SearchFieldName]>]>;
  filters: {
    entityType: Array<[string, number[]]>;
    documentId: Array<[string, number[]]>;
    scope: Array<[string, number[]]>;
    type: Array<[string, number[]]>;
    status: Array<[string, number[]]>;
    tag: Array<[string, number[]]>;
    path: Array<[string, number[]]>;
  };
  bm25: {
    docCount: number;
    averageFieldLengths: Record<SearchFieldName, number>;
    fieldLengths: number[][];
    documentFrequency: Array<[token: string, df: number]>;
    postings: Array<[token: string, fields: Array<[field: SearchFieldName, docs: Array<[docIndex: number, tf: number]>]>]>;
  };
  dictionary: {
    groups: string[][];
  };
};
```

### 7.3 Query path

Exact mode:

1. query normalize
2. optional dictionary expansion
3. `exact` lookup
4. filter posting intersection
5. sort deterministic result
6. paginate

BM25 mode:

1. tokenize query
2. read postings for query tokens only
3. intersect filter candidates if filters exist
4. score only candidate docs
5. top-K heap for `offset + limit`

Korean n-gram:

- high document frequency 2-gram/3-gram token은 downweight 또는 skip한다.
- query에 식별자/id/path token이 있으면 exact 우선순위를 유지한다.

## 8. Incremental validation and cache rebuild

### 8.1 추천 방향

처음부터 BM25 posting을 incremental patch하지 않는다. 대신 다음 순서를 따른다.

1. changed file만 parse/schema/fact artifact 재생성
2. `WorkspaceFacts`를 artifact에서 재조립
3. semantic diagnostics는 facts에서 전체 재계산
4. derived indexes(search/graph/entities/relations)는 facts에서 재생성

이 접근은 “부분 업데이트”보다 단순하고 안전하다. 비싼 YAML parse/schema validation을 제거하면서 global rule 정확성을 유지한다.

### 8.2 `index.yaml` 특수 처리

`index.yaml`은 control plane이다. 다음을 바꾼다.

- manifest registry
- document type/schema kind resolution
- scopes
- links
- search settings

따라서 `index.yaml` 변경 시 affected document의 schema artifact를 보수적으로 invalidation한다.

### 8.3 Diagnostics determinism

요구사항:

- cold path와 warm path의 diagnostics JSON은 byte-stable이어야 한다.
- diagnostics는 path/id/code 기준으로 deterministic sort한다.
- absolute path, OS-specific separator, timestamp를 diagnostics/cache에 넣지 않는다.
- semantic diagnostics delta patching은 금지한다.

## 9. CLI/MCP integration

### 9.1 Core facade 이동

`createSpecKiwiCore`는 `src/mcp/tools.ts`에서 `src/core/api.ts`로 이동한다.

MCP adapter는 다음만 담당한다.

- input schema validation
- JSON-RPC `InvalidParams`
- `toMcpToolResult`
- tool/resource registration

CLI adapter는 다음만 담당한다.

- commander parsing
- exit code
- human/json rendering

Core API는 `core/inputs.ts`, `core/dto.ts`만 사용한다. MCP schema type에 의존하지 않는다.

### 9.2 ReadModel memoization

MCP 서버처럼 long-lived process에서는 root/cacheMode/sourceFingerprint 기준으로 `ReadModel`을 memoize한다.

주의:

- mutable singleton 금지
- apply/write 이후 refresh 필요
- manifest/cache metadata가 바뀌면 invalidation
- `cacheMode: "bypass"`는 memoized cache-backed model을 사용하지 않음

## 10. Security and correctness constraints

1. cache JSON 안의 path를 신뢰하지 않는다.
2. source file을 읽을 때는 `normalizeStorePath`와 realpath 기반 workspace escape 방지를 유지한다.
3. cache file은 fixed path에서만 읽는다.
4. corrupt cache는 fallback + diagnostic warning으로 처리한다.
5. unsupported major version은 stale/unreadable로 처리한다.
6. public DTO에 `Map`, `Set`, class instance, `BigInt`, `undefined`를 노출하지 않는다.
7. MCP stdio에는 protocol 외 log를 쓰지 않는다.
8. no-cache 모드는 cache read/write를 모두 금지한다.

## 11. 구현 단계

### Phase 0: Perf harness 고정

- `npm run perf:srs`를 baseline으로 유지한다.
- 각 측정에 cache hit/miss, parsed file count, artifact hit count, fallback reason을 출력한다.
- release gate에는 strict perf를 바로 넣기보다 별도 gate로 유지한다.

### Phase 1: Core API and ReadModel skeleton

- `src/core/api.ts` 생성
- `createSpecKiwiCore` 이동
- `src/core/read-model.ts` 생성
- 기존 source path를 `SourceReadModel`로 감싼다.
- CLI/MCP가 같은 core API를 사용하게 한다.

### Phase 2: Requirement exact lookup fast path

- `entities.json` 및 requirement payload shard 작성
- filesystem fingerprint 기반 freshness check 추가
- `getRequirement()`가 cache-backed exact path를 먼저 사용
- fallback은 기존 YAML full registry 사용
- 목표: `NFR-PERF-001 <= 50ms`

### Phase 3: SearchIndexV2

- `search-index.json` v2 envelope 추가
- exact map, filter buckets, BM25 postings serialize
- `searchWorkspace()`가 cache before YAML load로 전환
- search section-specific freshness 적용
- 목표: `NFR-PERF-002 <= 500ms`

### Phase 4: MCP/CLI fast path parity

- MCP tool이 core ReadModel을 사용
- process-local memoization 추가
- graph/search/get/list/trace/impact CLI/MCP parity test 추가
- 목표: `NFR-PERF-005 <= 1s`

### Phase 5: Per-file artifacts and semantic rules

- `DocumentArtifactStore`
- `WorkspaceFacts`
- pure `SemanticValidator`
- cold/warm diagnostics byte-stability test
- one-file change incremental artifact test

### Phase 6: Graph and impact index

- graph/trace/impact가 edge array scan 대신 adjacency map 사용
- graph DTO는 materialization output으로만 사용
- relation semantics를 한 곳에 중앙화

## 12. 테스트 계획

### Performance

- fresh cache exact lookup 10,000 req <= 50ms
- fresh cache exact search 10,000 req <= 500ms
- fresh cache BM25 search 10,000 req <= 500ms 또는 별도 realistic budget
- MCP `speckiwi_search` fresh cache <= 1s
- cache rebuild 10,000 req / 1,000 docs <= 10s
- validation 1,000 docs <= 10s

### Correctness

- cold source path와 warm cache path의 DTO equality
- `includeDocument`/`includeRelations` parity
- list filters: project/scope/type/status/tag 조합
- search filters: scope/type/status/tag/path/entityType 조합
- graph/trace/impact parity

### Cache invalidation

- one SRS file changed
- one SRS file deleted
- `index.yaml` path/type/scope/search setting changed
- `dictionary.yaml` changed
- package version changed
- schema bundle changed
- tokenizer version changed
- graph rules version changed

### Fault tolerance

- corrupt `manifest.json`
- corrupt `entities.json`
- corrupt `search-index.json`
- unsupported major version
- missing shard
- cache directory absent
- rebuild failure fallback

### Security

- cache JSON에 `../` path 삽입
- absolute path 삽입
- symlink escape source path
- MCP invalid params는 계속 JSON-RPC `InvalidParams`
- MCP stdout/stderr cleanliness 유지

### No-cache

- `cacheMode: "bypass"`는 cache read 없음
- cache write 없음
- stale marker 생성 없음
- source YAML path로 정상 동작

## 13. 거부한 접근

| 접근 | 거부 이유 |
|---|---|
| `req get`을 search exact mode로 처리 | identity lookup이 search ranking/filter semantics에 묶인다. |
| BM25 루프만 미세 최적화 | cache 전에 YAML을 다 읽는 구조가 그대로라 목표 미달. |
| giant mutable `IndexedWorkspace` | 불변 sub-index가 아니면 cache god object가 된다. |
| command별 fast path | CLI/MCP/core drift가 커진다. |
| semantic diagnostics delta patch | stale diagnostic 위험이 높다. |
| file watcher 기반 invalidation | Git/local-first CLI에서 신뢰하기 어렵다. hash/fingerprint가 기준이어야 한다. |
| cache path 신뢰 | path traversal/symlink hardening을 우회할 수 있다. |

## 14. 구현 우선순위

1. `searchWorkspace()` cache-before-YAML 구조 전환
2. requirement exact lookup 전용 `entities` index 추가
3. SearchIndexV2 exact/filter/BM25 postings 직렬화
4. `createSpecKiwiCore`를 `core/api.ts`로 이동
5. MCP/CLI가 동일 ReadModel 사용
6. per-file artifact와 facts 기반 validation으로 확장
7. graph/impact adjacency index 정리

가장 빠른 실질 개선은 1-3이다. 하지만 장기 유지보수까지 고려하면 4-6을 같은 설계 안에 넣어야 한다. 그렇지 않으면 search cache, requirement cache, graph cache가 서로 다른 extraction logic을 갖는 스파게티가 된다.

## 15. 최종 권고

성능 개선은 “cache를 더 자주 rebuild”가 아니라 “fresh cache를 믿고 빠르게 읽는 read model” 문제다.

구현은 다음 원칙으로 진행해야 한다.

- 첫 PR은 read model skeleton과 exact lookup fast path에 집중한다.
- 두 번째 PR은 SearchIndexV2와 cache-before-YAML search path를 구현한다.
- 세 번째 PR은 MCP/CLI core API 통합과 memoization을 넣는다.
- 네 번째 PR부터 incremental artifact/facts/semantic rules로 rebuild 비용을 낮춘다.

이 순서가 가장 안전하다. exact lookup과 cached search 목표를 먼저 맞추면서도, 나중에 graph/validation/export까지 흡수할 수 있는 모듈 경계를 유지한다.
