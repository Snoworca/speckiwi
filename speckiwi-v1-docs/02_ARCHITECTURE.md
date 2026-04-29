# ARCHITECTURE — SpecKiwi v1

## 1. 아키텍처 목표

SpecKiwi v1의 아키텍처 목표는 다음과 같다.

```text
- DB 없이 파일 기반으로 동작한다.
- CLI와 MCP가 동일한 core를 사용한다.
- stdio MCP를 기본 에이전트 인터페이스로 제공한다.
- 원본은 YAML이고, JSON cache와 Markdown export는 재생성 가능해야 한다.
- Node.js 전역 설치만으로 동작해야 한다.
```

구현 계약의 세부 결정은 `12_IMPLEMENTATION_READINESS_DECISIONS.md`를 따른다.
특히 Core DTO, CLI JSON 출력, MCP `structuredContent`, cache mode, proposal stale 처리 정책은 해당 문서의 결정을 우선한다.

## 2. 전체 구조

```text
                    ┌────────────────────┐
                    │     Developer      │
                    └─────────┬──────────┘
                              │ CLI
                              ▼
┌──────────────────────────────────────────────────────────┐
│                    speckiwi CLI Adapter                  │
└──────────────────────────┬───────────────────────────────┘
                           │
                           ▼
┌──────────────────────────────────────────────────────────┐
│                    SpecKiwi Core Service                 │
│                                                          │
│  ┌──────────────┐  ┌──────────────┐  ┌────────────────┐ │
│  │ YAML Loader  │  │ Validator    │  │ Graph Builder  │ │
│  └──────────────┘  └──────────────┘  └────────────────┘ │
│  ┌──────────────┐  ┌──────────────┐  ┌────────────────┐ │
│  │ Search       │  │ Cache        │  │ Exporter       │ │
│  └──────────────┘  └──────────────┘  └────────────────┘ │
│  ┌──────────────┐  ┌──────────────┐                     │
│  │ Change Plan  │  │ Apply Engine │                     │
│  └──────────────┘  └──────────────┘                     │
└──────────────────────────┬───────────────────────────────┘
                           │
                           ▼
┌──────────────────────────────────────────────────────────┐
│                    .speckiwi File Store                  │
│  index.yaml, overview.yaml, srs/*.yaml, cache/*.json     │
└──────────────────────────────────────────────────────────┘
```

MCP 경로는 다음과 같다.

```text
AI Coding Agent
  └─ MCP stdio
      └─ speckiwi mcp
          └─ MCP Adapter
              └─ SpecKiwi Core Service
                  └─ .speckiwi File Store
```

## 3. 컴포넌트 책임

| 컴포넌트 | 책임 |
|---|---|
| CLI Adapter | 명령 파싱, 옵션 처리, stdout/stderr 출력, exit code 관리 |
| MCP Adapter | stdio transport, tool/resource 등록, JSON-compatible 응답 반환 |
| Core Service | workspace load, validation, graph/search/write/export orchestration |
| File Store | workspace root 확인, 안전한 path resolve, atomic write 수행 |
| YAML Loader | YAML parse, 제한된 YAML subset 검사, source location 추적 |
| Schema Validator | JSON Schema 기반 구조 검증 |
| Graph Builder | document/scope/requirement/relation graph 구성 |
| Search Engine | exact index, BM25, tokenizer, dictionary expansion 수행 |
| Cache Manager | hash manifest, cache stale 판단, cache rebuild/clean 수행 |
| Change Planner | proposal 파일 생성, patch operation 구성 |
| Apply Engine | proposal 또는 직접 변경을 validation 후 YAML에 반영 |
| Markdown Exporter | YAML 원본을 Markdown 산출물로 변환 |

## 4. Runtime Boundary

SpecKiwi v1은 다음 boundary를 가진다.

```text
In process:
  CLI Adapter
  MCP Adapter
  Core Service
  YAML parser
  Search index
  Graph builder

Out of process:
  없음

Not used:
  Database
  HTTP server
  Vector DB
  Remote service
```

## 5. Core API 개념

Core는 CLI와 MCP에서 동일하게 호출할 수 있는 함수형 API를 제공해야 한다.
Public Core API는 `12_IMPLEMENTATION_READINESS_DECISIONS.md`의 `CoreResult<T>` 또는 `ValidateResult` DTO를 반환한다.
`loadWorkspace()` 같은 내부 로딩 함수는 adapter public contract가 아니다.

```ts
interface SpecKiwiCore {
  init(input: InitInput): Promise<InitResult>;
  overview(input: OverviewInput): Promise<OverviewResult>;
  listDocuments(input: ListDocumentsInput): Promise<DocumentListResult>;
  readDocument(input: ReadDocumentInput): Promise<ReadDocumentResult>;
  validate(input: ValidateInput): Promise<ValidateResult>;
  doctor(input: DoctorInput): Promise<DoctorResult>;
  search(input: SearchInput): Promise<SearchResultSet>;
  getRequirement(input: GetRequirementInput): Promise<RequirementResult>;
  listRequirements(input: ListRequirementsInput): Promise<RequirementListResult>;
  previewRequirementId(input: GenerateRequirementIdInput): Promise<RequirementIdPreviewResult>;
  traceRequirement(input: TraceRequirementInput): Promise<TraceResult>;
  graph(input: GraphInput): Promise<GraphResult>;
  impact(input: ImpactInput): Promise<ImpactResult>;
  proposeChange(input: ProposeChangeInput): Promise<ProposalResult>;
  applyChange(input: ApplyChangeInput): Promise<ApplyResult>;
  exportMarkdown(input: ExportMarkdownInput): Promise<ExportResult>;
  cacheRebuild(input: CacheRebuildInput): Promise<CacheResult>;
  cacheClean(input: CacheCleanInput): Promise<CacheResult>;
}
```

## 6. Workspace Load Flow

```text
1. root 결정
2. .speckiwi 존재 확인
3. index.yaml 로드
4. overview.yaml 로드
5. index.yaml documents[].path 로드
6. dictionary.yaml 로드. 없으면 빈 dictionary로 정규화
7. schema validation
8. graph 구성
9. exact index 구성
10. BM25 search document flatten
11. cache stale 여부 판단
12. diagnostics 반환
```

## 7. Search Flow

```text
query 입력
  ├─ normalize
  ├─ dictionary expansion
  ├─ exact index lookup
  ├─ tokenizer
  ├─ BM25 search
  ├─ filter 적용
  ├─ score 정렬
  └─ JSON-compatible result 반환
```

## 8. Write Flow

### propose

```text
변경 요청
  ├─ workspace load
  ├─ target resolve
  ├─ patch/proposal 생성
  ├─ proposal schema validation
  └─ .speckiwi/proposals/*.yaml 저장
```

### apply

```text
변경 요청 또는 proposal
  ├─ workspace load
  ├─ allowApply 확인
  ├─ target resolve
  ├─ patch 적용한 in-memory document 생성
  ├─ validation 실행
  ├─ error 있으면 중단
  ├─ temp file write
  ├─ atomic rename
  ├─ cache stale 처리
  └─ apply result 반환
```

## 9. stdout/stderr 정책

CLI는 결과를 stdout에 출력하고 diagnostics/log는 stderr에 출력할 수 있다.

MCP는 stdout을 protocol channel로 사용하므로 protocol message 외 로그를 stdout에 출력하지 않아야 한다.

```text
MCP stdout: JSON-RPC protocol message only
MCP stderr: logs and diagnostics
```

## 10. 보안 경계

```text
- root 밖 path 접근 금지
- path traversal 거부
- .speckiwi 내부 원본만 기본 수정 대상
- export target은 명시 옵션이 있을 때만 외부 허용 가능
- MCP apply는 allowApply 설정과 validation 통과가 필요
```

## 11. 확장 지점

| 확장 지점 | v1 기본 | 향후 확장 |
|---|---|---|
| Tokenizer | Pure JS Korean n-gram | 형태소 분석 plugin |
| Search | BM25 | semantic/vector optional plugin |
| Export | Markdown | HTML/PDF optional |
| Transport | CLI, stdio MCP | HTTP MCP optional |
| Storage | YAML files | 계속 YAML 우선, DB는 v1 제외 |
