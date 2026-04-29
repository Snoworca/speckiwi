# IMPLEMENTATION_READINESS_DECISIONS — SpecKiwi v1 보완 결정

## 1. 목적

이 문서는 SpecKiwi v1 SRS와 세부 명세에서 구현자가 임의로 해석할 수 있는 지점을 닫기 위한 보완 결정 문서다.

다음 원칙을 우선한다.

```text
1. 구현자가 같은 입력에 대해 같은 결과를 내야 한다.
2. CLI JSON 출력과 MCP structuredContent는 같은 Core DTO를 사용해야 한다.
3. validation, search, impact, apply, export 결과는 자동 테스트로 판정 가능해야 한다.
4. v1은 기능 확장성보다 deterministic behavior를 우선해야 한다.
```

## 2. 연구 근거

보완 결정은 다음 외부 기준과 로컬 문서 검토를 기준으로 한다.

| 영역 | 근거 | 참조 |
|---|---|---|
| MCP tool/resource contract | MCP tool은 `content`와 `structuredContent`를 병행할 수 있고, resource read는 `contents[]`를 반환한다. | https://ts.sdk.modelcontextprotocol.io/documents/server.html |
| MCP TypeScript SDK | TypeScript SDK는 `McpServer`, `StdioServerTransport`, `registerTool`, resource API를 제공한다. | https://ts.sdk.modelcontextprotocol.io/ |
| YAML parser | `yaml` package의 `parseDocument()`는 Document API와 AST visitor를 제공하고 anchor/alias node를 식별할 수 있다. | https://eemeli.org/yaml/ |
| JSON Pointer/Patch | RFC 6901은 JSON Pointer syntax와 error handling을 정의하고, RFC 6902는 JSON Patch operation 구조를 정의한다. | https://datatracker.ietf.org/doc/html/rfc6901, https://datatracker.ietf.org/doc/html/rfc6902 |
| Canonical JSON | RFC 8785 JCS는 hash/signature에 쓸 수 있는 deterministic JSON serialization을 정의한다. | https://datatracker.ietf.org/doc/html/rfc8785 |
| Search | MiniSearch는 BM25+ option, field boost, filter, tokenizer hook을 제공한다. | https://lucaong.github.io/minisearch/types/MiniSearch.SearchOptions.html |
| JSON Schema/Ajv | JSON Schema 2020-12는 `unevaluatedProperties`를 제공하고, Ajv는 JSON Schema validation과 strict mode를 제공한다. `additionalProperties`는 같은 schema object의 `properties`/`patternProperties` 기준으로 동작한다. | https://json-schema.org/draft/2020-12/json-schema-core, https://ajv.js.org/options.html |

## 3. 우선순위

문서 간 충돌이 있을 경우 다음 순서로 해석한다.

```text
1. docs/spec/srs.md의 제품 범위와 release 기준
2. speckiwi-v1-docs/12_IMPLEMENTATION_READINESS_DECISIONS.md의 구현 계약
3. speckiwi-v1-docs/01_SRS.md
4. speckiwi-v1-docs/02_ARCHITECTURE.md ... 11_IMPLEMENTATION_PLAN.md
```

Core DTO, CLI JSON, MCP envelope, schema dialect, validation code mapping, graph/search ordering, cache hash, proposal/apply, export deterministic behavior는 이 문서의 구현 계약을 우선한다.

이 문서가 명시적으로 "보완 결정"으로 닫은 항목은 기존 문서의 `가능`, `경고 또는 오류`, `할 수 있다` 표현보다 우선한다.

## 4. Core DTO 계약

### 4.1 공통 원칙

Core는 CLI와 MCP를 몰라야 한다.

```text
Core result DTO:
  - JSON-compatible object여야 한다.
  - CLI --json stdout에 그대로 출력된다.
  - MCP structuredContent에 그대로 들어간다.
  - MCP content[0].text에는 같은 DTO의 JSON 문자열을 넣는다.
```

CLI human output은 CLI adapter가 별도로 렌더링한다.

### 4.2 Diagnostic

모든 응답의 `diagnostics`는 다음 구조를 사용해야 한다.

```ts
type Severity = "error" | "warning" | "info";

type Diagnostic = {
  code: string;
  message: string;
  severity: Severity;
  path?: string;
  line?: number;
  column?: number;
  details?: Record<string, unknown>;
};

type DiagnosticBag = {
  errors: Diagnostic[];
  warnings: Diagnostic[];
  infos: Diagnostic[];
  summary: {
    errorCount: number;
    warningCount: number;
    infoCount: number;
  };
};
```

v1은 `info` severity를 출력 계약에 예약하지만, validator는 `info` diagnostic을 생성하지 않아야 한다.

```text
v1 invariant:
  diagnostics.infos == []
  diagnostics.summary.infoCount == 0
```

### 4.3 ErrorResult

실행 실패는 다음 구조로 표현한다.

```ts
type CoreError = {
  code: string;
  message: string;
  details?: Record<string, unknown>;
};

type ErrorResult = {
  ok: false;
  error: CoreError;
  diagnostics: DiagnosticBag;
};
```

Validation 실패와 tool 실행 실패는 구분한다.

```text
validation error:
  - validate 명령/tool은 정상 실행된 것이다.
  - result.ok=false
  - result.error 필드는 없다.

tool execution error:
  - workspace not found, invalid argument, internal error 등이다.
  - result.ok=false
  - result.error 필드가 있다.
```

### 4.4 Pagination

v1은 cursor가 아니라 offset pagination을 사용한다.

```ts
type PageInput = {
  limit?: number;
  offset?: number;
};

type PageInfo = {
  limit: number;
  offset: number;
  returned: number;
  total: number;
  hasMore: boolean;
  nextOffset: number | null;
};
```

기본값은 다음과 같다.

| 항목 | 기본값 | 최대값 |
|---|---:|---:|
| search limit | 10 | 100 |
| list limit | 50 | 500 |
| offset | 0 | 제한 없음 |
| trace depth | 1 | 5 |

`limit`은 `1..max`, `offset`은 `>=0` 정수여야 한다.

### 4.5 CoreResult Taxonomy

Public Core API는 CLI/MCP adapter가 그대로 사용할 수 있는 Core DTO만 반환해야 한다.

```ts
type SuccessResult<T extends Record<string, unknown>> =
  { ok: true; diagnostics: DiagnosticBag } & T;

type CoreResult<T extends Record<string, unknown>> =
  | SuccessResult<T>
  | ErrorResult;

type ValidationOutcome = {
  ok: boolean;
  valid: boolean;
  diagnostics: DiagnosticBag;
};

type ValidateResult = ValidationOutcome | ErrorResult;
```

결과 분류는 다음과 같다.

| 조건 | `ok` | `error` |
|---|---:|---:|
| 정상 조회/search/list/export 성공 | true | 없음 |
| validation error가 있는 validate 결과 | false | 없음 |
| not found, invalid argument, path traversal | false | 있음 |
| allowApply=false, stale proposal, confirm 누락 | false | 있음 |
| 내부 예외 | false | 있음 |

`diagnostics`는 모든 Core DTO에서 항상 `DiagnosticBag`이어야 하며 배열 축약형을 사용하지 않아야 한다.

`ValidateResult`는 intentionally 별도 union이다. `CoreResult<T>` 안에 `ValidationOutcome`을 넣지 않아야 하며, validation-only shape가 다른 API 결과로 반환되는 것을 허용하지 않는다.

### 4.6 Path Contract

v1은 두 종류의 path 문자열을 구분한다.

| 이름 | 형식 | 사용 위치 |
|---|---|---|
| `StorePath` | `.speckiwi/` 내부 POSIX 상대 경로. 예: `srs/agent-kernel.loop.yaml` | `index.yaml`의 `documents[].path`, proposal `base.documentPath`, internal file store |
| `WorkspacePath` | workspace root 기준 POSIX 상대 경로이며 `.speckiwi/`로 시작. 예: `.speckiwi/srs/agent-kernel.loop.yaml` | diagnostics `path`, Core DTO의 user-facing `path`, CLI/MCP JSON output |
| `ExportPath` | export outputRoot 기준 POSIX 상대 경로. 예: `srs/agent-kernel.loop.md` | export result `writtenFiles[].path` |

StorePath, WorkspacePath, ExportPath는 `/` separator를 사용해야 한다. Absolute path, `..` segment, backslash, NUL은 input에서 거부해야 한다.

### 4.7 Public Result DTO

v1 public API는 최소한 다음 DTO를 고정한다.

```ts
type DocumentType =
  | "overview"
  | "prd"
  | "srs"
  | "technical"
  | "adr"
  | "rule"
  | "dictionary";

type ExportableDocumentType =
  | "overview"
  | "prd"
  | "srs"
  | "technical"
  | "adr";

type EntityType =
  | "document"
  | "scope"
  | "requirement"
  | "prd_item"
  | "technical_section"
  | "adr"
  | "rule";

type RequirementRelation = {
  type: string;
  target: string;
  source?: string;
  description?: string;
};

type RequirementSummary = {
  id: string;
  type: string;
  title: string;
  status: string;
  priority?: string;
  statement: string;
  documentId: string;
  scope?: string;
  tags: string[];
  path: string; // WorkspacePath
};

type RequirementType =
  | "functional"
  | "non_functional"
  | "interface"
  | "data"
  | "constraint"
  | "security"
  | "performance"
  | "reliability"
  | "usability"
  | "maintainability"
  | "operational"
  | "compliance"
  | "migration"
  | "observability";

type SearchResultItem = {
  entityType: EntityType;
  id: string;
  documentId?: string;
  scope?: string;
  title?: string;
  score: number;
  matchedFields: string[];
  path: string; // WorkspacePath
};

type DoctorCheck = {
  id: string;
  title: string;
  status: "ok" | "warning" | "error";
  message?: string;
  diagnostics: Diagnostic[];
};

type InitResult = CoreResult<{
  created: string[]; // WorkspacePath[]
  skipped: string[]; // WorkspacePath[]
}>;

type OverviewResult = CoreResult<{
  project: { id: string; name: string; language?: string };
  overview: { id: string; title: string; summary?: string };
  stats: { documents: number; scopes: number; requirements: number };
}>;

type DocumentSummary = {
  id: string;
  type: DocumentType;
  path: string; // StorePath in manifest-derived lists
  title?: string;
  status?: string;
  scope?: string;
  tags?: string[];
};

type DocumentListResult = CoreResult<{
  documents: DocumentSummary[];
  page: PageInfo;
}>;

type ReadDocumentResult = CoreResult<{
  documentId: string;
  path: string;
  rawYaml?: string;
  parsed?: Record<string, unknown>;
}>;

type RequirementResult = CoreResult<{
  requirement: Record<string, unknown>;
  document?: DocumentSummary;
  relations?: {
    incoming: RequirementRelation[];
    outgoing: RequirementRelation[];
  };
}>;

type RequirementListResult = CoreResult<{
  requirements: RequirementSummary[];
  page: PageInfo;
}>;

type SearchResultSet = CoreResult<{
  query: string;
  mode: "auto" | "exact" | "bm25";
  results: SearchResultItem[];
  page: PageInfo;
}>;

type DoctorResult = CoreResult<{
  checks: DoctorCheck[];
}>;

type CacheResult = CoreResult<{
  operation: "rebuild" | "clean";
  touchedFiles: string[]; // WorkspacePath[]
  staleBefore?: boolean;
}>;
```

`GraphResult`, `TraceResult`, `ImpactResult`, `ProposalResult`, `ApplyResult`, `ExportResult`는 각 기능 결정 섹션의 DTO를 따른다.

### 4.8 Public Input DTO

Public Core API와 MCP tool `inputSchema`는 다음 input DTO를 기준으로 한다. 모든 input object는 `additionalProperties=false`여야 한다.

```ts
type RootInput = {
  root?: string;
  cacheMode?: CacheMode;
};

type InitInput = RootInput & {
  projectId?: string;
  projectName?: string;
  language?: string;
  force?: boolean;
};

type OverviewInput = RootInput;
type ValidateInput = RootInput;
type DoctorInput = RootInput;
type CacheRebuildInput = RootInput;
type CacheCleanInput = RootInput;

type ListDocumentsInput = RootInput & PageInput & {
  type?: DocumentType;
  scope?: string;
  status?: string | string[];
};

type ReadDocumentInput = RootInput & {
  id: string;
  includeRawYaml?: boolean;
  includeParsed?: boolean;
};

type SearchFilters = {
  entityType?: EntityType | EntityType[];
  documentId?: string | string[];
  scope?: string | string[];
  type?: string | string[];
  status?: string | string[];
  tag?: string | string[];
  path?: string | string[];
};

type SearchInput = RootInput & PageInput & {
  query: string;
  mode?: "auto" | "exact" | "bm25";
  filters?: SearchFilters;
};

type GetRequirementInput = RootInput & {
  id: string;
  includeRelations?: boolean;
  includeDocument?: boolean;
};

type ListRequirementsInput = RootInput & PageInput & {
  scope?: string | string[];
  type?: string | string[];
  status?: string | string[];
  tag?: string | string[];
  documentId?: string | string[];
};

type GenerateRequirementIdInput = RootInput & {
  requirementType: RequirementType;
  scope: string;
  explicitId?: string;
};

type RequirementIdPreviewResult = CoreResult<{
  id: string;
  generated: boolean;
  prefix: string;
  projectSegment: string;
  scopeSegment: string;
  sequence: number;
  formattedSequence: string;
  collisionCount: number;
}>;

type RequirementCreateInput = RootInput & {
  scope: string;
  type: RequirementType;
  title: string;
  statement: string;
  id?: string;
  priority?: string;
  rationale?: string;
  description?: string;
  acceptanceCriteria?: Record<string, unknown>[];
  tags?: string[];
};

type TraceRequirementInput = RootInput & {
  id: string;
  direction?: TraceDirection;
  depth?: number;
};

type GraphInput = RootInput & {
  graphType?: "document" | "scope" | "requirement" | "dependency" | "traceability";
};

type ImpactInput = RootInput & {
  id: string;
  depth?: number;
  includeDocuments?: boolean;
  includeScopes?: boolean;
};

type ProposalOperation =
  | "create_requirement"
  | "update_requirement"
  | "change_requirement_status"
  | "add_relation"
  | "remove_relation"
  | "update_document";

type ProposalTarget =
  | {
      kind: "requirement";
      requirementId?: string;
      documentId?: string;
      scope?: string;
    }
  | {
      kind: "document";
      documentId: string;
    }
  | {
      kind: "manifest";
    };

type JsonPatchOperation =
  | { op: "add"; path: string; value: unknown }
  | { op: "replace"; path: string; value: unknown }
  | { op: "remove"; path: string };

type BaseTarget =
  | {
      entityType: "requirement";
      id?: string;
      jsonPointer: string;
    }
  | {
      entityType: "document";
      id: string;
      jsonPointer: string;
    }
  | {
      entityType: "manifest";
      jsonPointer: string;
    };

type ProposeChangeInput = RootInput & {
  operation: ProposalOperation;
  target: ProposalTarget;
  changes: JsonPatchOperation[];
  reason: string;
};

type ApplyChangeInput = RootInput & {
  proposalId?: string;
  proposalPath?: string;
  change?: ProposeChangeInput;
  confirm: boolean;
};

type ExportMarkdownInput = RootInput & {
  outputRoot?: string;
  type?: string | string[];
  documentId?: string | string[];
  strict?: boolean;
};
```

`SearchFilters.type`는 entity의 domain type을 뜻한다. 예를 들어 requirement type은 `functional`, document type은 `srs`다. `SearchFilters.entityType`은 `requirement`, `document` 같은 search entity category를 뜻한다.

`ProposeChangeInput` operation별 target rule은 다음과 같다.

| operation | target rule |
|---|---|
| `create_requirement` | `target.kind=requirement`, `target.scope` 또는 `target.documentId` 필수, `target.requirementId` optional |
| `update_requirement` | `target.kind=requirement`, `target.requirementId` 필수 |
| `change_requirement_status` | `target.kind=requirement`, `target.requirementId` 필수 |
| `add_relation` | `target.kind=requirement`, `target.requirementId` 필수 |
| `remove_relation` | `target.kind=requirement`, `target.requirementId` 필수 |
| `update_document` | `target.kind=document` 또는 `target.kind=manifest` |

`ApplyChangeInput`은 `proposalId`, `proposalPath`, `change` 중 정확히 하나를 가져야 한다. `confirm`은 항상 `true`여야 한다.

Stored proposal YAML의 top-level `target`은 `ProposalTarget`과 같은 discriminated union shape를 사용해야 한다. 구형 `target.path` field는 v1 proposal schema에서 허용하지 않는다. Target path는 `base.documentPath`로만 표현한다.

### 4.8.1 Requirement ID 생성 계약

Requirement ID 자동 생성은 다음 deterministic 규칙을 따른다.

| Requirement type | Prefix |
|---|---|
| `functional` | `FR` |
| `non_functional` | `NFR` |
| `interface` | `IR` |
| `data` | `DR` |
| `constraint` | `CON` |
| `security` | `SEC` |
| `performance` | `PERF` |
| `reliability` | `REL` |
| `usability` | `UX` |
| `maintainability` | `MAINT` |
| `operational` | `OPS` |
| `compliance` | `COMP` |
| `migration` | `MIG` |
| `observability` | `OBS` |

Project segment는 `index.project.id`에서 만든다.

```text
1. Unicode NFKD normalize
2. ASCII letter/digit만 유지하고 separator(`-`, `_`, `.`, space)는 단어 경계로 처리
3. 각 단어의 첫 3글자를 사용한다.
4. 결과를 uppercase로 만든다.
5. 빈 결과면 `PRJ`를 사용한다.
```

Scope segment는 scope id의 마지막 segment에서 만든다. Segment separator는 `.`, `/`, `_`, `-`다. 각 단어의 첫 4글자까지 사용하고 uppercase로 결합한다. 빈 결과면 `GEN`을 사용한다.

Generated ID format:

```text
<PREFIX>-<PROJECT_SEGMENT>-<SCOPE_SEGMENT>-<NNNN>
```

Sequence는 workspace 전체 requirement id 중 같은 `<PREFIX>-<PROJECT_SEGMENT>-<SCOPE_SEGMENT>-` prefix를 가진 id의 최대 4자리 numeric suffix를 찾아 `+1` 한다. 없으면 `0001`이다. 충돌이 있으면 다음 sequence를 시도한다.

사용자가 `--id` 또는 `explicitId`를 제공하면 자동 생성보다 우선한다. 명시 ID가 중복되면 `DUPLICATE_REQUIREMENT_ID`로 거부한다. Preview는 같은 규칙으로 생성하되 파일을 쓰지 않는다.

Public preview 계약은 다음과 같다.

```text
Core:
  previewRequirementId(input: GenerateRequirementIdInput): Promise<RequirementIdPreviewResult>

CLI:
  speckiwi req id preview --scope <scope-id> --type <requirement-type>
  speckiwi req create ... --preview-id

MCP:
  speckiwi_preview_requirement_id
```

Preview는 proposal 파일, 원본 YAML, cache를 쓰지 않는다. `explicitId`가 있으면 `generated=false`로 반환하고 중복이면 `DUPLICATE_REQUIREMENT_ID` ErrorResult를 반환한다.

### 4.9 Root Resolution Contract

CLI `--root`와 MCP process `--root`는 absolute path를 허용한다. 이 예외는 workspace root resolution 전용이며 StorePath/WorkspacePath/path traversal 규칙과 분리한다.

```text
CLI:
  --root가 있으면 자동 탐색보다 우선한다.
  --root는 absolute path 또는 현재 process cwd 기준 relative path를 받을 수 있다.
  resolved root는 realpath 후 workspace root로 사용한다.

MCP:
  speckiwi mcp --root <path>로 process root를 고정한다.
  MCP tool input의 root field는 v1에서 허용하지 않는다.
  MCP tool이 root를 포함하면 invalid input으로 처리한다.

Core:
  RootInput.root는 CLI adapter와 library caller 전용이다.
  MCP adapter는 RootInput.root를 제거하고 process root를 주입해야 한다.
```

## 5. CLI 계약

### 5.1 JSON 출력

`--json` 옵션은 stdout에 Core DTO JSON 객체 하나만 출력해야 한다.

```text
stdout:
  JSON.stringify(result) + "\n"

stderr:
  diagnostics log, verbose log, warning
```

Pretty print는 v1 기본 동작이 아니다.

### 5.2 Exit Code

| Code | 의미 |
|---:|---|
| 0 | 성공. warning만 있는 validation도 포함한다. |
| 1 | 일반 실행 오류 또는 not found |
| 2 | validation error가 존재한다. `validate` 또는 `export --strict`에 사용한다. |
| 3 | workspace not found |
| 4 | invalid argument, input schema validation 실패, path traversal 입력 |
| 5 | apply rejected. `allowApply=false`, confirm 누락, stale proposal, validation error로 apply 중단 |

세부 규칙은 다음과 같다.

```text
speckiwi validate:
  errors.length > 0 => exit 2
  errors.length == 0 => exit 0

speckiwi search:
  result count 0 => exit 0

speckiwi req get <id>:
  not found => exit 1

speckiwi export markdown --strict:
  validation error before write => exit 2

speckiwi req update ... --apply:
  rejected => exit 5
```

### 5.3 공통 옵션 추가

다음 옵션을 `search`, `list docs`, `list reqs`에 추가한다.

```text
--offset <n>
```

다음 옵션은 cache read/write를 모두 우회한다.

```text
--no-cache
```

## 6. MCP 계약

### 6.1 Adapter 원칙

MCP adapter는 Core DTO를 다음 방식으로 반환한다.

```ts
return {
  structuredContent: result,
  content: [{ type: "text", text: JSON.stringify(result) }],
  isError: result.ok === false && "error" in result ? true : undefined
};
```

MCP adapter는 tool result error와 JSON-RPC protocol error를 구분해야 한다.

```text
protocol error:
  - malformed JSON-RPC
  - unknown tool/resource
  - invalid MCP request shape
  - handler crash before Core DTO 생성

tool result:
  - validation error
  - not found
  - allowApply=false
  - stale proposal
  - export --strict validation failure
```

Validation failure는 validate tool이 정상 실행된 결과이므로 `isError`를 설정하지 않는다.

```text
MCP validate result:
  isError: false
  structuredContent.ok: false
  structuredContent.valid: false
```

`ErrorResult`는 tool call이 실패한 것으로 표시한다. 단, 이는 JSON-RPC protocol error가 아니라 MCP tool result다.

```ts
return {
  isError: true,
  structuredContent: errorResult,
  content: [{ type: "text", text: JSON.stringify(errorResult) }]
};
```

### 6.2 SDK 및 Schema

v1 MCP adapter는 다음 SDK 형태를 기준으로 한다.

```ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
```

MCP tool은 `inputSchema`를 가져야 하며, 가능한 경우 Core DTO에 대응하는 `outputSchema`를 가져야 한다.

```text
inputSchema:
  - root type은 object여야 한다.
  - 모든 object는 기본 additionalProperties=false다.

outputSchema:
  - MCP CallToolResult outer envelope가 아니라 structuredContent의 JSON Schema다.
  - content, isError, _meta는 outputSchema에 포함하지 않는다.
  - outputSchema가 있는 tool은 structuredContent를 해당 schema에 맞춰 반환해야 한다.
```

Invalid input은 두 계층으로 나눈다.

```text
MCP request/arguments shape가 handler 전에 깨짐:
  - JSON-RPC -32602

Core가 해석한 domain/policy error:
  - ErrorResult
  - MCP tool result isError=true
```

MCP tool annotation은 client hint이며 보안 게이트가 아니다. `allowApply`, `confirm`, stale hash, path safety는 Core/adapter에서 직접 검증해야 한다.

Tool별 inputSchema는 4.8 Public Input DTO를 기준으로 작성해야 한다.

| Tool | Input DTO | StructuredContent DTO |
|---|---|---|
| `speckiwi_overview` | `OverviewInput` | `OverviewResult` |
| `speckiwi_list_documents` | `ListDocumentsInput` | `DocumentListResult` |
| `speckiwi_read_document` | `ReadDocumentInput` | `ReadDocumentResult` |
| `speckiwi_search` | `SearchInput` | `SearchResultSet` |
| `speckiwi_get_requirement` | `GetRequirementInput` | `RequirementResult` |
| `speckiwi_list_requirements` | `ListRequirementsInput` | `RequirementListResult` |
| `speckiwi_preview_requirement_id` | `GenerateRequirementIdInput` | `RequirementIdPreviewResult` |
| `speckiwi_trace_requirement` | `TraceRequirementInput` | `TraceResult` |
| `speckiwi_graph` | `GraphInput` | `GraphResult` |
| `speckiwi_impact` | `ImpactInput` | `ImpactResult` |
| `speckiwi_validate` | `ValidateInput` | `ValidateResult` |
| `speckiwi_propose_change` | `ProposeChangeInput` | `ProposalResult` |
| `speckiwi_apply_change` | `ApplyChangeInput` | `ApplyResult` 또는 `ErrorResult` |

### 6.3 MCP 기본값

| Tool | 기본값 |
|---|---|
| `speckiwi_search` | `mode=auto`, `limit=10`, `offset=0`, `cacheMode=auto` |
| `speckiwi_list_documents` | `limit=50`, `offset=0`, `cacheMode=auto` |
| `speckiwi_list_requirements` | `limit=50`, `offset=0`, `cacheMode=auto` |
| `speckiwi_get_requirement` | `includeRelations=true`, `includeDocument=false` |
| `speckiwi_read_document` | `includeRawYaml=false`, `includeParsed=true` |
| `speckiwi_trace_requirement` | `direction=both`, `depth=1`, `maxDepth=5` |
| `speckiwi_graph` | `graphType=traceability`, `cacheMode=auto` |
| `speckiwi_impact` | `includeDocuments=true`, `includeScopes=true` |
| `speckiwi_apply_change` | `confirm` must be `true` |

### 6.4 Tool Annotations

| Tool group | readOnlyHint | destructiveHint |
|---|---:|---:|
| overview/list/read/search/get/trace/impact/validate | true | false |
| graph | true | false |
| propose_change | false | false |
| apply_change | false | true |

### 6.5 MCP Resources

MCP resources는 Core DTO envelope를 반환하지 않고 MCP `ReadResourceResult.contents[]` 형태를 사용한다.

v1 capability는 다음으로 제한한다.

```json
{
  "resources": {}
}
```

`subscribe`와 `listChanged`는 v1에서 지원하지 않는다.

Static resources:

| URI | Source | MIME |
|---|---|---|
| `speckiwi://overview` | `.speckiwi/overview.yaml` | `application/yaml` |
| `speckiwi://index` | `.speckiwi/index.yaml` | `application/yaml` |

Resource templates:

| URI template | Response content |
|---|---|
| `speckiwi://documents/{id}` | manifest에 등록된 문서의 raw YAML |
| `speckiwi://requirements/{id}` | stable JSON requirement context |
| `speckiwi://scopes/{id}` | stable JSON scope context |

Read response 예시는 다음과 같다.

```ts
{
  contents: [
    {
      uri: "speckiwi://documents/srs.agent-kernel.loop",
      mimeType: "application/yaml",
      text: "schemaVersion: speckiwi/srs/v1\n..."
    }
  ]
}
```

Resource URI의 `{id}`는 percent-decoding 후 검증해야 한다.

```text
invalid id:
  - empty string
  - contains "/"
  - contains "\\"
  - contains NUL
  - path traversal sequence
```

Resource error mapping:

| 조건 | JSON-RPC code |
|---|---:|
| unknown resource | -32002 |
| malformed URI | -32602 |
| internal error | -32603 |

## 7. YAML 및 Schema 결정

### 7.1 YAML Subset

v1은 YAML anchor, alias, merge key를 모두 error로 처리한다.

| 조건 | Severity | Code |
|---|---|---|
| YAML anchor 사용 | error | `YAML_ANCHOR_FORBIDDEN` |
| YAML alias 사용 | error | `YAML_ALIAS_FORBIDDEN` |
| YAML merge key 사용 | error | `YAML_MERGE_KEY_FORBIDDEN` |

Anchor/alias/merge key error가 있는 문서는 apply 대상이 될 수 없다.

### 7.2 Parser 및 Serialization

YAML loader는 `yaml` package의 `parseDocument()` 계열 API를 사용해 parser error와 source location을 수집해야 한다.

Parser option은 v1 contract로 고정한다.

```ts
parseDocument(source, {
  version: "1.2",
  schema: "core",
  merge: false,
  strict: true,
  uniqueKeys: true,
  stringKeys: true,
  prettyErrors: true,
  lineCounter
});
```

`yaml` package parse error/warning은 throw에 의존하지 않고 `doc.errors`와 `doc.warnings`를 읽어 `DiagnosticBag`으로 변환해야 한다.

Schema validation은 parse/subset error가 없는 문서에만 수행한다. Registry/reference validation은 schema-valid 문서 기준으로 수행해 cascading error를 줄인다.

v1 apply는 deterministic serialization을 우선한다.

```text
apply serialization policy:
  - 전체 YAML document를 다시 serialize할 수 있다.
  - field order는 SpecKiwi schema order를 따른다.
  - 기존 comment/style 보존은 v1 필수 요구사항이 아니다.
  - line/column diagnostics는 parseDocument source location을 우선 사용한다.
```

### 7.3 JSON Schema 및 Ajv Contract

v1은 JSON Schema draft 2020-12만 사용한다. 모든 schema 파일은 다음 값을 가져야 한다.

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://speckiwi.dev/schemas/<name>.schema.json"
}
```

Ajv 설정은 다음으로 고정한다.

| 항목 | 값 |
|---|---|
| Ajv class | `ajv/dist/2020`의 `Ajv2020` |
| `strict` | `true` |
| `allErrors` | `true` |
| `validateSchema` | `true` |
| `coerceTypes` | `false` |
| `useDefaults` | `false` |
| `removeAdditional` | `false` |
| `allowUnionTypes` | `false` |
| `allowMatchingProperties` | `false` |

Strict compile warning은 허용하지 않는다. Schema가 strict mode에서 compile되지 않으면 구현 오류로 간주한다.

모든 JSON Schema 객체는 기본적으로 닫힌 구조를 사용한다.

```json
{
  "additionalProperties": false
}
```

임의 확장은 `metadata` 하위에서만 허용한다.

```json
{
  "metadata": {
    "type": "object",
    "additionalProperties": true
  }
}
```

`allOf`로 공통 필드를 합성하는 schema object에는 `additionalProperties: false`를 직접 붙이지 않아야 한다. 공통 필드를 flatten하거나 draft 2020-12의 `unevaluatedProperties: false`를 사용해야 한다.

Schema 파일명은 document type 이름을 따른다.

```text
schemas/index.schema.json
schemas/overview.schema.json
schemas/dictionary.schema.json
schemas/srs.schema.json
schemas/prd.schema.json
schemas/technical.schema.json
schemas/adr.schema.json
schemas/rule.schema.json
schemas/proposal.schema.json
```

### 7.4 Document Category

v1 YAML 파일은 다음 category 중 하나로 분류한다.

| Category | 대상 | Registry | Search | Graph | Export |
|---|---|---|---|---|---|
| manifest | `index.yaml` | 아니오 | 아니오 | 아니오 | 아니오 |
| registered content document | `overview`, `prd`, `srs`, `technical`, `adr`, `rule`, `dictionary` | 예 | 예 | 예 | `ExportableDocumentType`만 |
| managed proposal artifact | `proposals/*.yaml` with `type: proposal` | 아니오 | 아니오 | 아니오 | 아니오 |
| template asset | `templates/*.md.tmpl` | 아니오 | 아니오 | 아니오 | 아니오 |

`index.yaml`은 content document가 아니라 workspace manifest다.

```text
index.yaml:
  - schemaVersion: speckiwi/index/v1
  - id/type/title/status 필드를 요구하지 않는다.
  - documents[]에 자기 자신을 등록하지 않는다.
  - document registry에 content document로 등록하지 않는다.
  - MCP resource speckiwi://index로는 제공한다.
```

공통 문서 필드는 content document에만 적용한다.

```text
content document:
  overview
  prd
  srs
  technical
  adr
  rule
  dictionary
```

`proposal` YAML은 schema-validated managed artifact이며 content document registry에 등록하지 않는다. `index.documents[]`에 `proposal`이 등록되면 validation error다.

`template`은 v1 YAML document type이 아니다. `.speckiwi/templates/*.md.tmpl`은 Markdown export용 asset이며 JSON Schema validation 대상에서 제외한다.

### 7.4.1 Registry 정합성

Schema dispatch는 다음 순서로 결정한다.

```text
1. index.yaml은 index schema로 검증한다.
2. proposals/*.yaml은 proposal schema로 검증한다.
3. registered content document는 index.documents[].type 기준 schema로 검증한다.
4. registered path 밖의 .speckiwi/**/*.yaml은 content/proposal/template/cache/export 예외 여부를 판정한다.
```

Registered content document는 manifest entry와 실제 YAML top-level field가 일치해야 한다.

| Invariant | Error code |
|---|---|
| `index.documents[].id === yaml.id` | `DOCUMENT_ID_MISMATCH` |
| `index.documents[].type === yaml.type` | `DOCUMENT_TYPE_MISMATCH` |
| `yaml.schemaVersion === speckiwi/<type>/v1` | `SCHEMA_VERSION_TYPE_MISMATCH` |

`.speckiwi/overview.yaml`, `.speckiwi/dictionary.yaml`, `prd/**/*.yaml`, `srs/**/*.yaml`, `tech/**/*.yaml`, `adr/**/*.yaml`, `rules/**/*.yaml`에 있는 content YAML이 `index.documents[]`에 등록되지 않았으면 `UNREGISTERED_CONTENT_DOCUMENT` error다.

다음 path는 unregistered content 검사에서 제외한다.

```text
index.yaml
proposals/**/*.yaml
cache/**/*.json
exports/**
templates/**/*.md.tmpl
```

### 7.5 Metadata

`metadata`는 모든 content document와 metadata를 지원한다고 명시된 하위 entity에서 optional이다.

```text
metadata 없음:
  - validation 통과
  - Core in-memory model에서는 필요 시 {}로 정규화할 수 있다.

metadata 있음:
  - object여야 한다.
  - metadata 하위만 arbitrary extension을 허용한다.
```

`metadata: null`은 `INVALID_METADATA` error다.

### 7.6 Status Enum

`status`는 전역 공통 enum이 아니라 문서 타입별 enum이다.

| Type | 허용 status |
|---|---|
| overview, prd, srs, technical, rule, dictionary | `draft`, `active`, `deprecated`, `archived` |
| adr | `proposed`, `accepted`, `superseded`, `deprecated`, `rejected` |
| proposal | `proposed`, `accepted`, `applied`, `rejected`, `superseded` |
| requirement | `draft`, `active`, `in_progress`, `done`, `blocked`, `deprecated`, `replaced`, `discarded` |

잘못된 document status는 `INVALID_DOCUMENT_STATUS` error다.

### 7.7 PRD Item Link

PRD item link enum은 requirement relation enum과 분리한다.

```text
relates_to
derived_to
derives_from
supports
conflicts_with
references
implements
```

`target`이 requirement id 형식이면 workspace에 존재해야 하며, 없으면 `UNKNOWN_REQUIREMENT_RELATION_TARGET` error다.

외부 target은 다음처럼 명시해야 한다.

```yaml
links:
  - type: references
    targetType: external
    target: https://example.com/spec
```

## 8. Validation 결정

### 8.1 Severity 정책

| Severity | Apply | Exit 영향 |
|---|---:|---|
| error | 불가 | `validate` exit 2 |
| warning | 가능 | exit 0 |
| info | 가능 | v1에서는 생성하지 않음 |

### 8.2 Deterministic Diagnostics

Diagnostics는 다음 순서로 정렬해야 한다.

```text
1. severity group: error, warning, info
2. path asc
3. line asc
4. column asc
5. code asc
6. message asc
```

Diagnostic `path`는 file path만 의미한다. JSON Pointer나 schema instance path는 `details.pointer` 또는 `details.instancePath`에 넣어야 한다.

### 8.3 Error Code Catalog 보강

다음 code는 v1 validator와 apply engine이 반드시 고정된 의미로 사용해야 한다.

| Code | Severity | 조건 |
|---|---|---|
| `YAML_ANCHOR_FORBIDDEN` | error | YAML node에 anchor가 있음 |
| `YAML_ALIAS_FORBIDDEN` | error | YAML alias node 사용 |
| `YAML_MERGE_KEY_FORBIDDEN` | error | mapping key가 `<<` |
| `UNKNOWN_FIELD` | error | 닫힌 schema object의 미정의 필드 |
| `INVALID_METADATA` | error | `metadata`가 object가 아니거나 null |
| `INVALID_DOCUMENT_STATUS` | error | 문서 타입별 status enum 위반 |
| `INVALID_JSON_POINTER` | error | RFC 6901 JSON Pointer string syntax 위반 |
| `UNSUPPORTED_PATCH_OP` | error | v1 미지원 JSON Patch op |
| `PATCH_PATH_NOT_FOUND` | error | `replace`/`remove` target 미존재 |
| `PATCH_ARRAY_INDEX_INVALID` | error | array index 또는 `-` 사용 규칙 위반 |
| `PATCH_ROOT_REPLACE_FORBIDDEN` | error | root pointer로 전체 문서 교체 시도 |
| `EXPORT_TYPE_NOT_SUPPORTED` | error | v1 Markdown export 대상이 아닌 type 명시 |
| `IMPACT_TARGET_TYPE_NOT_SUPPORTED` | error | requirement id가 아닌 impact target 요청 |

### 8.4 Warning Threshold

| Code | 조건 |
|---|---|
| `LARGE_DOCUMENT` | 단일 YAML 원문이 256 KiB를 초과한다. |
| `WEAK_REQUIREMENT_STATEMENT` | `statement.trim().length < 20`이거나 `해야 한다`, `shall`, `must` 계열 검증 동사가 없다. |
| `EMPTY_SEARCH_TEXT` | 검색 대상 text field가 모두 비어 있다. |

`MISSING_TAGS`는 v1 기본 validator에서 생성하지 않는다.

### 8.5 Cycle Severity

| 조건 | Severity | Code |
|---|---|---|
| requirement `depends_on` cycle | error | `DEPENDS_ON_CYCLE` |
| document link `depends_on` cycle | warning | `DOCUMENT_DEPENDS_ON_CYCLE` |

Graph는 cycle path를 deterministic하게 반환해야 한다.

## 9. Search 결정

### 9.1 Search Engine

v1 기본 search engine은 MiniSearch 기반 adapter를 사용한다.

```text
Search Engine:
  - MiniSearch BM25+ scoring을 사용한다.
  - 외부 계약은 "BM25 mode"로 유지한다.
  - SearchEngine interface 뒤에 감싸 교체 가능하게 둔다.
```

Search index 대상은 content document와 그 하위 entity다.

```text
included:
  overview
  prd
  srs
  technical
  adr
  rule
  dictionary terms when used for expansion metadata

excluded:
  index.yaml as a document result
  proposals/*.yaml
  templates/*.md.tmpl
  cache files
  export files
```

### 9.2 Flat Document Schema

Search engine에는 다음 flat item을 입력한다.

```ts
type SearchFlatDocument = {
  entityType: EntityType;
  id: string;
  documentId?: string;
  scope?: string;
  title?: string;
  path: string; // WorkspacePath
  fields: {
    id?: string;
    title?: string;
    tags?: string[];
    scope?: string;
    statement?: string;
    acceptanceCriteria?: string[];
    rationale?: string;
    description?: string;
    body?: string;
  };
  filters: {
    type?: string;
    status?: string;
    tags?: string[];
    scope?: string;
  };
};
```

### 9.3 Score

최종 score 범위는 `0.0 <= score <= 1.0`이다.

```text
exact-only result:
  score = 1.0

BM25 result:
  score = raw / maxRaw * 0.999
```

`maxRaw`는 filter 적용 후, pagination 전 candidate 집합에서 계산한다. `maxRaw == 0`이면 BM25 result를 반환하지 않는다.

### 9.4 Merge

Exact와 BM25 결과는 `entityType + id` 기준으로 병합한다.

```text
same entity:
  - single result로 반환한다.
  - matchedFields는 union한다.
  - score는 max(exactScore, bm25Score)를 사용한다.
```

필터는 exact와 BM25 모두에 적용한다.

`matchedFields`는 exact field와 BM25 token hit field의 union이다. 중복 제거 후 field boost 표의 순서대로 정렬한다.

### 9.5 Sort

Search 결과는 pagination 전에 다음 순서로 정렬한다.

```text
1. score desc
2. entityType priority
3. id asc
4. documentId asc
5. path asc
```

Entity type priority는 다음과 같다.

```text
requirement
document
scope
prd_item
technical_section
adr
rule
```

## 10. Graph, Trace, Impact 결정

### 10.1 GraphResult

Graph JSON 출력은 다음 DTO를 사용한다.

```ts
type GraphNode = {
  key: string;             // `${entityType}:${id}`
  entityType: "document" | "scope" | "requirement";
  id: string;
  title?: string;
  documentId?: string;
  path?: string;
  scope?: string;
  status?: string;
};

type GraphEdge = {
  key: string;             // `${source}|${relationType}|${target}`
  source: string;          // GraphNode.key
  target: string;          // GraphNode.key
  relationType: string;
  sourceType: GraphNode["entityType"];
  targetType: GraphNode["entityType"];
  sourceId: string;
  targetId: string;
};

type GraphResult = CoreResult<{
  graphType: "document" | "scope" | "requirement" | "dependency" | "traceability";
  nodes: GraphNode[];
  edges: GraphEdge[];
}>;
```

`GraphInput.graphType` 기본값은 `traceability`다. CLI plural alias는 다음처럼 canonical graphType으로 정규화한다.

| CLI value | Canonical graphType |
|---|---|
| `documents` | `document` |
| `scopes` | `scope` |
| `requirements` | `requirement` |
| `dependencies` | `dependency` |
| `traceability` | `traceability` |

정렬은 다음 순서를 따른다.

```text
nodes:
  1. entityType priority: document, scope, requirement
  2. id asc

edges:
  1. source asc
  2. target asc
  3. relationType asc
  4. key asc
```

동일한 `GraphEdge.key`는 하나로 병합한다.

Graph type별 포함 규칙은 다음과 같다.

| graphType | Nodes | Edges |
|---|---|---|
| `document` | registered content document | `index.links[]` |
| `scope` | `index.scopes[]` | scope parent edge |
| `requirement` | all requirements | all requirement relations |
| `dependency` | all requirements | `depends_on` edges only |
| `traceability` | documents, scopes, requirements | document-scope, document-requirement, requirement relation, document link |

Synthetic edge relationType과 방향은 다음으로 고정한다.

| Edge | source | target | relationType |
|---|---|---|---|
| scope parent | parent scope node | child scope node | `contains_scope` |
| document-scope | document node | scope node | `belongs_to_scope` |
| document-requirement | document node | requirement node | `contains_requirement` |
| document link | link `from` document node | link `to` document node | `index.links[].type` |
| requirement relation | source requirement node | target requirement node | requirement relation type |

Synthetic edge key도 `${source}|${relationType}|${target}`을 사용한다.

### 10.2 TraceResult

Trace는 requirement relation graph 전용이다.

```ts
type TraceDirection = "upstream" | "downstream" | "both";

type TraceResult = CoreResult<{
  root: string;
  requirementId: string;
  direction: TraceDirection;
  depth: number;
  nodes: GraphNode[];
  edges: GraphEdge[];
}>;
```

`depth`는 기본 `1`, 최대 `5`다. `both`는 upstream과 downstream 결과를 병합한 뒤 위 Graph 정렬 규칙을 적용한다.

`index.yaml`은 graph node가 아니라 registry source다. `document` graph node는 `index.yaml`의 `documents[]`에 등록된 content document만 의미한다.

Trace traversal은 BFS를 사용한다.

```text
upstream:
  root에서 outgoing edge 방향으로 이동한다.

downstream:
  root로 들어오는 incoming edge를 역방향으로 이동한다.

adjacency order:
  1. relation enum order
  2. target GraphNode.key asc
```

`TraceResult.nodes`에는 root requirement를 포함한다.

### 10.3 Impact

Impact는 "변경된 requirement 때문에 downstream에서 영향을 받을 수 있는 requirement"를 계산한다.

Relation edge는 다음처럼 정의한다.

```text
source --relationType--> target
```

Impact는 아래 traversal matrix에 따라 BFS로 계산한다.

| Relation `source -> target` | 의미 | `impact(source)` 포함 | `impact(target)` 포함 | Transitive |
|---|---|---|---|---|
| `depends_on` | source가 target에 의존 | no | source | yes |
| `blocks` | source가 target을 막음 | target | no | yes |
| `relates_to` | 약한 관련 | target | source | no |
| `duplicates` | 중복 후보 | target | source | no |
| `conflicts_with` | 충돌 | target | source | no |
| `refines` | source가 target을 구체화 | no | source | yes |
| `generalizes` | source가 target을 일반화 | target | no | yes |
| `replaces` | source가 target을 대체 | no | source | no |
| `replaced_by` | source가 target으로 대체됨 | target | no | no |
| `derived_from` | source가 target에서 파생 | no | source | yes |
| `implements` | source가 target을 구현/실현 | no | source | yes |
| `documents` | source가 target을 문서화 | no | source | no |
| `tests` | source가 target을 테스트 | no | source | no |
| `requires_review_with` | 함께 검토 필요 | target | source | no |

Impact result는 다음 정보를 포함해야 한다.

```ts
type ImpactItem = {
  id: string;
  depth: number;
  via: string[];
  relationType: string;
  path?: string;
};

type ImpactResult = CoreResult<{
  root: string;
  requirementId: string;
  impacted: ImpactItem[];
  nodes: GraphNode[];
  edges: GraphEdge[];
}>;
```

Impact traversal은 BFS이며 adjacency order는 Trace와 동일하다. `ImpactItem`에는 root requirement를 포함하지 않는다. `via`는 root에서 impacted item까지의 requirement id 배열이며 root와 impacted id를 모두 포함한다.

v1 public impact input은 requirement id 전용이다. Document/scope impact는 v1에서 별도 public API로 제공하지 않는다. CLI `--document` 또는 `--scope` impact 요청은 `IMPACT_TARGET_TYPE_NOT_SUPPORTED` invalid argument로 거부한다. Document/scope 주변 그래프 조회는 `speckiwi graph --type document|scope|traceability` 또는 MCP `speckiwi_graph`를 사용한다.

`includeDocuments`와 `includeScopes`는 `ImpactResult.nodes/edges`의 context 포함 여부만 제어한다. 기본값은 둘 다 `true`다.

```text
includeDocuments=false:
  - document GraphNode를 nodes에서 제외한다.
  - document가 source 또는 target인 edge를 edges에서 제외한다.

includeScopes=false:
  - scope GraphNode를 nodes에서 제외한다.
  - scope가 source 또는 target인 edge를 edges에서 제외한다.
```

`impacted` 배열은 항상 requirement만 포함하며 include 옵션의 영향을 받지 않는다.

## 11. Cache 결정

### 11.1 Cache Mode

```ts
type CacheMode = "auto" | "bypass";
```

기본값은 `auto`다.

```text
auto:
  - cache manifest를 확인한다.
  - stale이면 자동 rebuild한다.
  - rebuild 실패 시 YAML 직접 로드로 degrade하고 warning을 반환한다.

bypass:
  - cache read를 하지 않는다.
  - cache write를 하지 않는다.
  - CLI --no-cache와 같다.
```

### 11.2 Manifest

`manifest.json`은 cache 단위별 입력/출력 hash를 가져야 한다.

```json
{
  "speckiwiVersion": "1.0.0",
  "schemaVersions": [
    "speckiwi/index/v1",
    "speckiwi/srs/v1"
  ],
  "sections": {
    "graph": {
      "inputs": [
        {
          "path": "index.yaml",
          "sha256": "..."
        }
      ],
      "outputs": [
        {
          "path": "cache/graph.json",
          "sha256": "..."
        }
      ]
    },
    "search": {
      "searchSettingsHash": "sha256:...",
      "inputs": [
        {
          "path": "srs/example.yaml",
          "sha256": "..."
        }
      ],
      "outputs": [
        {
          "path": "cache/search-index.json",
          "sha256": "..."
        }
      ]
    },
    "diagnostics": {
      "inputs": [],
      "outputs": [
        {
          "path": "cache/diagnostics.json",
          "sha256": "..."
        }
      ]
    },
    "export": {
      "outputRoot": "exports",
      "templateSettingsHash": "sha256:...",
      "inputs": [],
      "outputs": [
        {
          "path": "exports/index.md",
          "sha256": "..."
        }
      ]
    }
  }
}
```

Dictionary 변경은 search cache를 stale로 만든다.

Manifest path는 `StorePath` 또는 cache/export internal path를 POSIX separator로 저장하고 lexicographic order로 정렬한다. `sections.graph`, `sections.search`, `sections.diagnostics`, `sections.export`는 항상 존재해야 한다.

Stale 판단에는 다음 값만 사용한다.

```text
- input file sha256
- output file sha256 존재 여부
- speckiwiVersion
- schemaVersions
- searchSettingsHash
- templateSettingsHash
```

`createdAt`, wall-clock timestamp, host path, OS별 separator는 cache manifest에 기록하지 않는다.

`cache clean`은 `.speckiwi/cache/` 내부의 재생성 가능 파일만 삭제해야 하며 `backups/`가 존재하면 기본 삭제 대상에서 제외한다. `cache rebuild`는 graph/search/diagnostics cache와 manifest를 다시 생성하고 실패 시 partial output을 제거해야 한다.

## 12. Proposal 및 Apply 결정

### 12.1 Patch Format

Proposal `changes[]`는 RFC 6902 JSON Patch의 `add`, `replace`, `remove` subset을 사용한다.

```text
supported:
  add
  replace
  remove

not supported in v1:
  move
  copy
  test
```

`path`는 RFC 6901 JSON Pointer이며 document-root 기준이다.

```text
patch safety:
  - URI fragment form(`#/...`)은 허용하지 않는다.
  - 빈 문자열 root pointer는 v1 apply에서 금지한다.
  - `-` token은 `add`가 array append를 수행할 때만 허용한다.
  - array index는 `0` 또는 leading zero 없는 양의 정수여야 한다.
  - operation object의 extra field는 proposal schema에서 거부한다.
  - patch는 in-memory document에 순차 적용한다.
  - 하나라도 실패하면 전체 apply를 거부하고 파일을 쓰지 않는다.
```

MCP/CLI에서 target-relative path를 입력받는 편의 기능은 v1 contract가 아니다. 모든 stored proposal의 `changes[].path`는 document-root JSON Pointer여야 한다.

### 12.2 Base Snapshot

Proposal은 `base`를 필수 필드로 가져야 한다.

```yaml
base:
  documentId: srs.agent-kernel.loop
  documentPath: srs/agent-kernel.loop.yaml
  target:
    entityType: requirement
    id: FR-AGK-LOOP-0001
    jsonPointer: /requirements/0
  documentHash: sha256:<file-bytes-hash>
  targetHash: sha256:<canonical-target-json-hash>
  schemaVersion: speckiwi/srs/v1
  generatedAt: "2026-04-28T09:15:00.000Z"
```

`base.target`은 `BaseTarget` shape를 사용한다.

| operation/target | base.documentPath | base.target.entityType | base.target.id | base.target.jsonPointer | targetHash |
|---|---|---|---|---|---|
| existing requirement update/status/relation | target SRS StorePath | `requirement` | requirement id 필수 | existing requirement pointer, 예 `/requirements/0` | existing requirement hash |
| `create_requirement` | target SRS StorePath | `requirement` | generated/explicit id optional | insertion parent pointer `/requirements` | RFC 8785 canonical `null` hash |
| document update | target document StorePath | `document` | document id 필수 | empty root pointer is forbidden, use concrete field pointer | target document hash |
| manifest update | `index.yaml` | `manifest` | 사용하지 않음 | concrete index field pointer, 예 `/documents` | full index manifest hash |

`base.target.jsonPointer`는 patch 대상 entity 또는 insertion parent를 가리킨다. v1은 document-root 전체 교체를 금지하므로 empty pointer는 사용할 수 없다.

Manifest update의 `targetHash`는 `base.target.jsonPointer` fragment가 아니라 전체 parsed `index.yaml` manifest를 RFC 8785 JCS canonical JSON으로 serialize한 SHA-256이다. `base.target.jsonPointer`는 patch 위치와 diagnostics를 위한 위치 정보로만 사용한다.

Hash 규칙은 다음과 같다.

```text
documentHash:
  target YAML file bytes의 SHA-256

targetHash:
  target entity를 location metadata 없이 RFC 8785 JCS canonical JSON으로 serialize한 뒤 SHA-256
```

사용자 YAML의 `metadata` 필드는 target entity의 일부이므로 `targetHash`에 포함한다. Parser/source-location metadata는 포함하지 않는다.

`create_requirement`처럼 target entity가 아직 없는 proposal은 `targetHash`를 RFC 8785 canonical JSON `null`의 SHA-256으로 계산한다. Apply 시 같은 ID가 이미 생성되어 있으면 target hash가 달라지므로 stale proposal로 거부된다.

`index.yaml` 자체를 수정하는 proposal은 top-level `target.kind: manifest`를 사용해야 한다. 이 경우 `target.documentId`는 사용하지 않고 `base.documentPath`는 `index.yaml`이어야 한다.

### 12.3 Stale Proposal

Apply 시 현재 hash가 proposal `base`와 다르면 apply를 거부해야 한다.

| 조건 | Error code | Exit |
|---|---|---:|
| documentHash 불일치 | `APPLY_REJECTED_STALE_PROPOSAL` | 5 |
| targetHash 불일치 | `APPLY_REJECTED_STALE_PROPOSAL` | 5 |

Stale proposal은 warning이 아니다.

v1은 `--force` apply를 제공하지 않는다.

Requirement ID preview는 stale/apply flow에 참여하지 않는다. Preview는 read-only operation이며 proposal `base`를 만들지 않는다.

### 12.4 Result DTO

```ts
type ProposalSummary = {
  id: string;
  path: string; // WorkspacePath
  operation: ProposalOperation;
  target: ProposalTarget;
};

type ProposalResult = CoreResult<{
  mode: "propose";
  applied: false;
  proposal: ProposalSummary;
}>;

type ApplyResult = CoreResult<{
  mode: "apply";
  applied: true;
  modifiedFiles: string[]; // WorkspacePath[]
  cacheStale: boolean;
}>;
```

Apply 거부는 `ApplyResult`가 아니라 `ErrorResult`를 반환한다. 이때 `diagnostics`는 반드시 `DiagnosticBag`이어야 한다.

### 12.5 Atomic Write

Apply는 다음 순서를 지켜야 한다.

```text
1. target path safety 검증
2. base hash 검증
3. patch 적용 in-memory document 생성
4. 전체 workspace validation
5. validation error가 있으면 중단
6. temp file write
7. 가능하면 fsync
8. atomic rename
9. cache stale 처리
```

## 13. Export 결정

### 13.1 Default Mode

`speckiwi export markdown` 기본값은 non-strict best-effort다.

```text
non-strict:
  - parse/schema validation 가능한 문서만 export한다.
  - parse/schema validation 불가 문서는 skip한다.
  - result.ok=true일 수 있다.
  - skippedFiles와 diagnostics를 반환한다.
```

### 13.2 Strict Mode

`--strict`는 validation error가 있을 때 파일 쓰기 전에 중단한다.

```text
strict:
  - validation errors.length > 0이면 어떤 export 파일도 쓰지 않는다.
  - CLI exit code는 2다.
  - warning만 있으면 export한다.
```

### 13.3 Export Result

```ts
type ExportedFile = {
  path: string; // ExportPath
  sourceDocumentId?: string;
  sourcePath?: string; // StorePath
  sha256?: string;
};

type SkippedExportFile = {
  sourceDocumentId?: string;
  sourcePath: string; // StorePath
  reasonCode: string;
  message: string;
};

type ExportResult =
  | {
      ok: true;
      strict: boolean;
      outputRoot: string; // resolved export root display path
      writtenFiles: ExportedFile[];
      skippedFiles: SkippedExportFile[];
      diagnostics: DiagnosticBag;
    }
  | {
      ok: false;
      strict: true;
      outputRoot: string; // resolved export root display path
      writtenFiles: [];
      skippedFiles: SkippedExportFile[];
      diagnostics: DiagnosticBag;
    }
  | ErrorResult;
```

Non-strict export의 `index.md` 상단에는 diagnostics summary를 포함해야 한다.

Markdown export는 `index.yaml`을 원본 문서로 export하지 않는다. `exports/index.md`는 manifest가 제공한 content document registry에서 생성한다.

`writtenFiles`는 `path asc`, `skippedFiles`는 `sourcePath asc`로 정렬한다.

`writtenFiles[].path`는 항상 `outputRoot` 기준 `ExportPath`다. 기본 export에서는 `index.md`, `overview.md`, `srs/foo.md`처럼 표시한다. Absolute `--out`을 사용해도 `writtenFiles[].path`는 absolute path가 아니며 outputRoot 기준 상대 경로다.

`outputRoot`는 CLI 입력에서 absolute path 또는 workspace root 기준 relative path를 받을 수 있다. Relative `outputRoot`는 workspace root 기준으로 resolve한다. Resolve 후 symlink traversal과 path traversal을 검사해야 한다.

v1 export 대상은 `ExportableDocumentType`으로 제한한다.

```text
overview
prd
srs
technical
adr
```

`rule`과 `dictionary`는 v1 export 대상이 아니다. `--type rule` 또는 `--type dictionary`는 invalid argument `EXPORT_TYPE_NOT_SUPPORTED`로 거부한다. 전체 export에서는 rule/dictionary를 skip이 아니라 export 대상 집합에서 제외한다.

`ExportMarkdownInput.type`은 JSON Schema layer에서 string/string array로 받는다. Core domain validation에서 `ExportableDocumentType` 외 값을 `EXPORT_TYPE_NOT_SUPPORTED` ErrorResult로 반환한다.

Export output은 기본적으로 deterministic해야 한다.

```text
- generated timestamp는 기본 export header에 포함하지 않는다.
- source path, source document id, schemaVersion은 포함할 수 있다.
- --out path는 명시적으로 허용된 export target이며 absolute path를 허용한다.
- --out path traversal, NUL, symlink traversal은 거부한다.
- 기존 export 파일은 같은 output path를 덮어쓸 수 있다.
- 현재 run에서 생성하지 않은 과거 export 파일 삭제는 v1 기본 동작이 아니다.
```

사용자 template은 `.speckiwi/templates/*.md.tmpl`만 허용한다. v1 placeholder 문법은 `{{name}}`과 dotted path `{{document.title}}`만 지원하며, loop/condition/helper execution은 지원하지 않는다. 알 수 없는 placeholder는 `TEMPLATE_PLACEHOLDER_UNKNOWN` warning을 만들고 빈 문자열로 렌더링한다.

## 14. 테스트 기준

v1 구현은 최소한 다음 테스트를 가져야 한다.

```text
Core DTO:
  [ ] DiagnosticBag JSON serialization round-trip
  [ ] ErrorResult와 ValidateResult 구분
  [ ] 모든 machine-readable DTO는 ok와 diagnostics 포함
  [ ] WorkspacePath/StorePath fixture

Validation:
  [ ] 모든 schema가 Ajv2020 strict mode에서 compile
  [ ] index.yaml은 manifest이며 id/type/title/status 없이 통과
  [ ] documents[]에 index/template/proposal 등록 시 error
  [ ] proposals/*.yaml은 schema validation 대상이지만 registry/search/export 제외
  [ ] proposal target은 kind 기반 discriminated union이고 target.path는 거부
  [ ] template .md.tmpl은 JSON Schema validation 대상 제외
  [ ] metadata optional, metadata object 통과, metadata null 실패
  [ ] 하위 object field matrix의 required/optional/additionalProperties fixture
  [ ] anchor/alias/merge key error
  [ ] additionalProperties false
  [ ] metadata extension 허용
  [ ] document type별 status enum
  [ ] requirement depends_on cycle error
  [ ] document depends_on cycle warning
  [ ] deterministic diagnostics ordering

CLI:
  [ ] --json stdout에는 JSON 객체 1개만 출력
  [ ] diagnostics/log는 stderr로 출력
  [ ] validate error exit 2
  [ ] search 0건 exit 0
  [ ] req get not found exit 1
  [ ] apply rejected exit 5

MCP:
  [ ] structuredContent와 content[0].text JSON이 같은 DTO
  [ ] outputSchema는 structuredContent schema만 설명한다
  [ ] validate error는 MCP isError가 아니다
  [ ] ErrorResult는 MCP tool result isError=true로 반환된다
  [ ] policy rejection은 JSON-RPC protocol error가 아니다
  [ ] resources/read는 contents[]를 반환하고 Core DTO envelope를 쓰지 않는다
  [ ] unknown resource는 -32002를 반환한다
  [ ] stdout에 protocol message 외 로그가 없다

Search:
  [ ] SearchResultItem DTO fixture
  [ ] exact score 1.0
  [ ] BM25 score <= 0.999
  [ ] exact/BM25 duplicate merge
  [ ] deterministic tie-break
  [ ] filter는 exact/BM25 모두에 적용
  [ ] matchedFields field boost order 정렬

Impact:
  [ ] GraphResult nodes/edges deterministic ordering
  [ ] graphType별 포함 노드/엣지 fixture
  [ ] TraceResult upstream/downstream/both fixture
  [ ] relation type별 traversal matrix fixture
  [ ] transitive relation만 depth > 1 확장

Write:
  [ ] proposal base hash 생성
  [ ] targetHash는 RFC 8785 JCS canonical JSON 사용
  [ ] stale proposal apply 거부
  [ ] create_requirement targetHash는 canonical null hash를 사용
  [ ] RFC 6901 pointer edge case(~0, ~1, -, invalid index)
  [ ] validation error에서 원본 미수정
  [ ] atomic write 실패 시 temp file cleanup

Cache:
  [ ] cache 삭제 후 YAML 기반 동작
  [ ] stale cache auto rebuild
  [ ] graph/search/diagnostics/export manifest section 생성
  [ ] --no-cache read/write 우회
  [ ] manifest에 wall-clock timestamp 미포함

Export:
  [ ] non-strict best-effort export
  [ ] strict validation error에서 파일 쓰기 전 중단
  [ ] writtenFiles/skippedFiles typed item과 diagnostics 반환
  [ ] generated timestamp 미포함 deterministic output
  [ ] --type rule/dictionary는 EXPORT_TYPE_NOT_SUPPORTED
  [ ] writtenFiles[].path는 outputRoot 기준 ExportPath
```

## 15. 구현 순서 보정

기존 milestone은 유지하되, Milestone 0 직후 다음 작업을 먼저 수행해야 한다.

```text
Milestone 0.5 — Contract Freeze
  - Core DTO type 작성
  - Core public API surface 작성
  - DiagnosticBag 작성
  - CLI JSON renderer 작성
  - MCP structuredContent adapter skeleton 작성
  - MCP resource URI parser/read handler skeleton 작성
  - MCP inputSchema/outputSchema fixture 작성
  - Ajv2020 strict schema compile test 작성
  - JSON Schema additionalProperties 정책 반영
  - index manifest/template/proposal/metadata schema 결정 반영
  - SearchResultItem/GraphResult/TraceResult/ImpactResult DTO 작성
  - ProposalResult/ApplyResult/ExportResult DTO 작성
  - RFC 8785 canonical JSON helper 작성
  - test fixture workspace 추가
```

MCP 전체 기능은 후반 milestone에서 구현하더라도, MCP adapter skeleton과 DTO 공유 검증은 초기에 둔다.
