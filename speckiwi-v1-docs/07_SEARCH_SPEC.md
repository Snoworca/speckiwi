# SEARCH_SPEC — SpecKiwi v1 검색 명세

## 1. 목적

SpecKiwi v1 검색은 DB와 벡터 DB 없이 `.speckiwi/**/*.yaml` 원본을 로드하여 exact index와 in-memory BM25 기반으로 수행한다. 한글 검색 품질을 확보하기 위해 pure JS Korean n-gram tokenizer와 `dictionary.yaml` 기반 query expansion을 사용한다.

Search score, exact/BM25 merge, deterministic tie-break, pagination, cache mode의 최종 결정은 `12_IMPLEMENTATION_READINESS_DECISIONS.md`를 따른다.
Public search input filter 이름과 의미는 `12_IMPLEMENTATION_READINESS_DECISIONS.md`의 `SearchInput`/`SearchFilters` DTO를 따른다.

## 2. 검색 원칙

```text
- DB 사용 안 함
- Vector DB 사용 안 함
- 형태소 분석기 기본 의존성 없음
- YAML 원본에서 검색 문서를 flatten
- exact result 우선
- BM25 result 보조
- 한글은 2-gram/3-gram 기반
- dictionary.yaml로 동의어 보정
```

## 3. 검색 모드

| Mode | 설명 |
|---|---|
| `auto` | exact lookup 후 BM25 검색 수행 |
| `exact` | id/code/scope/path exact lookup만 수행 |
| `bm25` | BM25 검색만 수행 |

## 4. 검색 대상

```text
document
scope
requirement
prd_item
technical_section
adr
rule
```

## 5. Flatten Document Model

YAML 문서는 검색용 flat document로 변환된다.

```json
{
  "entityType": "requirement",
  "id": "FR-AGK-LOOP-0001",
  "documentId": "srs.agent-kernel.loop",
  "scope": "agent-kernel.loop",
  "type": "functional",
  "status": "draft",
  "title": "LLM 응답 기반 상태 전이",
  "statement": "에이전트 커널은 LLM 응답 타입에 따라 다음 실행 상태를 결정해야 한다.",
  "rationale": "...",
  "acceptanceCriteria": ["..."],
  "tags": ["agent-loop", "state-machine"],
  "path": ".speckiwi/srs/agent-kernel.loop.yaml"
}
```

## 6. Exact Index

Exact index는 다음 key를 등록한다.

```text
requirement id
requirement id lowercase
document id
scope id
file path
ADR id
PRD item id
technical section id
```

Exact query 예:

```text
FR-AGK-LOOP-0001
srs.agent-kernel.loop
agent-kernel.loop
adr.0001-local-yaml-storage
```

Exact result는 BM25 result보다 우선한다.

## 7. BM25 필드

BM25 index에는 다음 필드를 포함한다.

| Field | Boost |
|---|---:|
| `id` | 10 |
| `title` | 6 |
| `tags` | 5 |
| `scope` | 4 |
| `statement` | 3 |
| `acceptanceCriteria` | 2 |
| `rationale` | 1 |
| `description` | 1 |
| `body` | 1 |

## 8. Tokenizer 정책

### 8.1 Normalize

```text
1. Unicode normalize NFKC
2. 영문 lowercase
3. punctuation normalize
4. code token 보존
5. whitespace normalize
```

### 8.2 영문/기호 처리

```text
- kebab-case 분리
- snake_case 분리
- camelCase 분리
- slash/dot segment 분리
- JSON-RPC 같은 기술 용어는 원형 보존 + 분리형 추가
```

예:

```text
agent-kernel.loop
→ agent-kernel.loop
→ agent
→ kernel
→ loop
→ agent-kernel
```

### 8.3 한글 처리

한글 chunk는 다음 token을 생성한다.

```text
원형 token
2-gram
3-gram
```

예:

```text
상태전이
→ 상태전이
→ 상태
→ 태전
→ 전이
→ 상태전
→ 태전이
```

띄어쓰기 입력:

```text
상태 전이
→ 상태
→ 전이
→ 상태전이
→ 상태
→ 태전
→ 전이
```

정책:

```text
- 한 글자 한글 token은 기본 제외
- 조사/어미 제거는 v1 기본 기능 아님
- 형태소 분석기는 optional plugin 확장 지점으로만 유지
```

## 9. Dictionary Expansion

`dictionary.yaml` 예:

```yaml
schemaVersion: speckiwi/dictionary/v1

id: dictionary
type: dictionary
title: Search Dictionary
status: active

synonyms:
  srs:
    - 요구사항
    - 요구 사항
    - 요구사항명세
  state-transition:
    - 상태 전이
    - 상태전이
    - state transition
  jsonrpc:
    - JSON-RPC
    - json rpc
    - jsonrpc
```

Query expansion 예:

```text
입력: 상태 전이
확장: 상태 전이, 상태전이, state transition, state-transition
```

## 10. 검색 알고리즘

```text
1. query normalize
2. dictionary expansion
3. exact index lookup
4. mode가 exact이면 반환
5. tokenizer 적용
6. BM25 query 실행
7. filters 적용
8. exact result와 BM25 result merge
9. score normalize
10. matchedFields 계산
11. score desc 정렬
12. limit 적용
13. diagnostics 포함 반환
```

## 11. Filter

지원 필터:

```text
entityType
scope
documentId
type
status
tag
path
```

`type`은 entity의 domain type이다. Requirement에서는 `functional`, document에서는 `srs` 같은 값을 의미한다.

CLI 예:

```bash
speckiwi search "상태 전이" --scope agent-kernel.loop --status draft,active
```

MCP input 예:

```json
{
  "query": "상태 전이",
  "mode": "auto",
  "filters": {
    "scope": "agent-kernel.loop",
    "status": ["draft", "active"]
  },
  "limit": 10
}
```

## 12. Search Result

```json
{
  "ok": true,
  "query": "상태 전이",
  "mode": "auto",
  "results": [
    {
      "entityType": "requirement",
      "id": "FR-AGK-LOOP-0001",
      "documentId": "srs.agent-kernel.loop",
      "scope": "agent-kernel.loop",
      "title": "LLM 응답 기반 상태 전이",
      "score": 0.999,
      "matchedFields": ["title", "statement"],
      "path": ".speckiwi/srs/agent-kernel.loop.yaml"
    }
  ],
  "page": {
    "limit": 10,
    "offset": 0,
    "returned": 1,
    "total": 1,
    "hasMore": false,
    "nextOffset": null
  },
  "diagnostics": {
    "errors": [],
    "warnings": [],
    "infos": [],
    "summary": {
      "errorCount": 0,
      "warningCount": 0,
      "infoCount": 0
    }
  }
}
```

`SearchResultItem` DTO, score normalization, `matchedFields` 정렬, exact/BM25 merge, pagination 전 deterministic sort는 `12_IMPLEMENTATION_READINESS_DECISIONS.md`의 Search 결정을 따른다.

## 13. Cache

Search cache 파일:

```text
.speckiwi/cache/search-index.json
.speckiwi/cache/manifest.json
```

Cache invalidation:

```text
- index.yaml hash 변경
- overview.yaml hash 변경
- dictionary.yaml hash 변경
- 문서 YAML hash 변경
- schemaVersion 변경
- speckiwi version 변경
- search settings 변경
```

## 14. 성능 목표

```text
10,000 requirements exact lookup: 50ms 이내 목표
10,000 requirements cache 기반 검색: 500ms 이내 목표
10,000 requirements cache rebuild: 10초 이내 목표
```

## 15. 확장 지점

```ts
interface Tokenizer {
  tokenize(input: string, options: TokenizeOptions): string[];
}

interface SearchEngine {
  build(docs: SearchDocument[]): Promise<SearchIndex>;
  search(query: SearchQuery): Promise<SearchResultSet>;
}
```

향후 확장:

```text
- Korean morphological tokenizer plugin
- semantic search plugin
- vector search plugin
- remote index plugin
```
