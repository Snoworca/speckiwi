# SpecKiwi

SpecKiwi는 Git 저장소 안의 `.speckiwi/` 디렉토리에 요구사항, 제품 문서, 기술 문서, ADR, 규칙을 YAML로 저장하고, 이를 검증 가능한 로컬 지식 그래프로 읽는 도구입니다. 개발자와 AI 코딩 에이전트가 같은 요구사항 맥락을 기준으로 검색, 추적, 영향 분석, 변경 제안, Markdown 내보내기를 수행하도록 돕습니다.

현재 패키지는 npm에 배포되어 있지 않습니다. 이 문서는 설치 절차를 다루지 않고, 현재 코드베이스가 제공하는 기능과 인터페이스만 설명합니다.

## 핵심 방향

- 원본 데이터는 Git 저장소 내부의 `.speckiwi/**/*.yaml`입니다.
- JSON 캐시와 Markdown export 결과물은 재생성 가능한 산출물이며 원본이 아닙니다.
- 변경 이력의 1차 기록은 별도 DB가 아니라 Git history입니다.
- 런타임 인터페이스는 Node.js CLI와 stdio MCP 서버입니다.
- HTTP 서버, 백그라운드 데몬, SQLite, DB migration, Vector DB는 v1 범위에 포함되지 않습니다.
- 검색은 exact search, BM25, 한글 n-gram tokenizer, dictionary 기반 synonym expansion을 사용합니다.

## 저장소 구조

표준 SpecKiwi 워크스페이스는 프로젝트 루트의 `.speckiwi/` 아래에 구성됩니다.

```text
.speckiwi/
├─ index.yaml
├─ overview.yaml
├─ dictionary.yaml
├─ prd/
├─ srs/
├─ tech/
├─ adr/
├─ rules/
├─ prose/
├─ proposals/
├─ templates/
├─ cache/
└─ exports/
```

주요 의미는 다음과 같습니다.

| 경로 | 역할 |
| --- | --- |
| `.speckiwi/index.yaml` | 문서 registry와 workspace 설정을 담는 manifest |
| `.speckiwi/overview.yaml` | 프로젝트 개요 문서 |
| `.speckiwi/dictionary.yaml` | 검색 synonym 등 사전 정보 |
| `.speckiwi/prd/` | PRD 문서 |
| `.speckiwi/srs/` | SRS와 requirement 문서 |
| `.speckiwi/tech/` | 기술 문서 |
| `.speckiwi/adr/` | Architecture Decision Record |
| `.speckiwi/rules/` | 프로젝트 규칙 문서 |
| `.speckiwi/prose/` | 비정형 Markdown 본문(회의록·인터뷰·디자인 노트 등). YAML wrapper의 `body` 필드에 Markdown 저장 |
| `.speckiwi/proposals/` | 변경 제안 YAML |
| `.speckiwi/cache/` | 재생성 가능한 JSON 캐시 |
| `.speckiwi/exports/` | Markdown export 산출물 |

## 주요 기능

| 기능 | 설명 |
| --- | --- |
| Workspace 초기화 | `.speckiwi/` 표준 디렉토리와 기본 YAML 파일 생성 |
| YAML 검증 | YAML 파싱, JSON Schema 검증, semantic rule 검증 |
| 문서 조회 | 등록된 문서 목록 조회와 원문/파싱 결과 조회 |
| 요구사항 조회 | requirement 단건 조회, 목록 조회, 상태/스코프/타입/태그 필터링 |
| 검색 | 문서, scope, requirement, PRD item, technical section, ADR, rule 대상 검색 |
| 관계 그래프 | document, scope, requirement, dependency, traceability 그래프 생성 |
| 추적 | requirement 기준 upstream/downstream/both 관계 추적 |
| 영향 분석 | requirement 변경 영향 범위 계산 |
| 변경 제안 | 원본 YAML을 직접 바꾸기 전에 proposal YAML 생성 |
| 변경 적용 | 정책과 검증을 통과한 proposal 또는 inline change 적용 |
| Markdown export | YAML 원본 문서를 Markdown 산출물로 내보내기 |
| 캐시 관리 | 읽기 모델 캐시 재생성 및 삭제 |

## CLI 인터페이스

CLI 엔트리포인트는 `bin/speckiwi`이며, 명령 구현은 `src/cli/`와 `src/core/`에 있습니다.

공통 옵션은 대부분의 CLI 명령에서 동일하게 사용됩니다.

| 옵션 | 설명 |
| --- | --- |
| `--root <path>` | workspace root 지정. 지정하지 않으면 현재 경로부터 상위로 `.speckiwi/`를 탐색 |
| `--json` | Core DTO JSON을 stdout에 출력 |
| `--no-cache` | 캐시 읽기와 쓰기를 우회 |
| `--verbose` | 진단 상세 정보를 stderr에 출력 |
| `--quiet` | 사람이 읽는 stdout 출력을 최소화 |

현재 코드에 구현된 명령은 다음과 같습니다.

| 명령 | 설명 |
| --- | --- |
| `speckiwi init` | SpecKiwi workspace 초기화 |
| `speckiwi validate` | workspace YAML과 semantic rule 검증 |
| `speckiwi doctor` | 로컬 런타임과 workspace 상태 점검 |
| `speckiwi overview` | overview 문서 조회 |
| `speckiwi list docs` | 등록 문서 목록 조회 |
| `speckiwi list reqs` | requirement 목록 조회 |
| `speckiwi search <query>` | workspace entity 검색 |
| `speckiwi req get <id>` | requirement 단건 조회 |
| `speckiwi req create` | requirement 생성 proposal 작성 또는 적용 |
| `speckiwi req update <id>` | requirement 수정 proposal 작성 또는 적용 |
| `speckiwi graph` | workspace graph 출력 |
| `speckiwi impact <id>` | requirement 영향 분석 |
| `speckiwi export markdown` | YAML 문서 Markdown export |
| `speckiwi cache rebuild` | JSON 캐시 재생성 |
| `speckiwi cache clean` | JSON 캐시 삭제 |
| `speckiwi mcp` | stdio MCP 서버 실행. `--root` 생략 시 현재 디렉터리부터 상위로 `.speckiwi/`를 자동 탐색 |

## MCP 개요

MCP 서버는 `src/mcp/server.ts`에서 생성되며 `StdioServerTransport`만 사용합니다. SpecKiwi는 MCP용 HTTP 서버를 열지 않습니다.

MCP tool 입력은 `src/mcp/schemas.ts`의 Zod strict object schema로 검증됩니다. 따라서 정의되지 않은 파라미터가 들어오면 `InvalidParams` 오류가 발생합니다. MCP tool 입력에는 `root`가 없습니다. workspace root는 MCP 서버를 시작할 때 고정됩니다.

MCP 응답은 `structuredContent`에 Core DTO JSON을 담고, `content[0].text`에도 같은 JSON 문자열을 담습니다. 성공 응답은 `ok: true`, 실패 응답은 `ok: false`와 `error`를 포함합니다.

## MCP 공통 파라미터

| 파라미터 | 타입 | 설명 |
| --- | --- | --- |
| `cacheMode` | `"auto"` 또는 `"bypass"` | 선택 값. 생략 시 서버 기본값인 `auto` 사용. `bypass`는 캐시 읽기/쓰기를 우회 |
| `limit` | 정수 | 페이지 크기. search 계열은 1-100, list 계열은 1-500 |
| `offset` | 정수 | 페이지 시작 위치. 0 이상 |

## MCP enum 값

| 이름 | 허용 값 |
| --- | --- |
| Document type | `overview`, `prd`, `srs`, `technical`, `adr`, `rule`, `dictionary`, `prose` |
| Entity type | `document`, `scope`, `requirement`, `prd_item`, `technical_section`, `adr`, `rule` |
| Requirement type | `functional`, `non_functional`, `interface`, `data`, `constraint`, `security`, `performance`, `reliability`, `usability`, `maintainability`, `operational`, `compliance`, `migration`, `observability` |
| Search mode | `auto`, `exact`, `bm25` |
| Graph type | `document`, `scope`, `requirement`, `dependency`, `traceability` |
| Trace direction | `upstream`, `downstream`, `both` |
| Proposal operation | `create_requirement`, `update_requirement`, `change_requirement_status`, `add_relation`, `remove_relation`, `update_document` |
| JSON Patch op | `add`, `replace`, `remove` |

## MCP 도구 목록과 파라미터

### `speckiwi_overview`

프로젝트 overview와 workspace 통계를 반환합니다.

| 파라미터 | 필수 | 타입 | 설명 |
| --- | --- | --- | --- |
| `cacheMode` | 아니오 | `"auto"` 또는 `"bypass"` | 캐시 사용 방식 |

### `speckiwi_list_documents`

등록된 SpecKiwi 문서 목록을 반환합니다.

| 파라미터 | 필수 | 타입 | 설명 |
| --- | --- | --- | --- |
| `cacheMode` | 아니오 | `"auto"` 또는 `"bypass"` | 캐시 사용 방식 |
| `limit` | 아니오 | 정수, 1-500 | 최대 결과 수 |
| `offset` | 아니오 | 정수, 0 이상 | 페이지 시작 위치 |
| `type` | 아니오 | Document type | 문서 타입 필터 |
| `scope` | 아니오 | 문자열 | scope id 필터 |
| `status` | 아니오 | 문자열 또는 문자열 배열 | 문서 상태 필터 |

### `speckiwi_read_document`

등록 문서를 id로 읽습니다.

| 파라미터 | 필수 | 타입 | 설명 |
| --- | --- | --- | --- |
| `cacheMode` | 아니오 | `"auto"` 또는 `"bypass"` | 캐시 사용 방식 |
| `id` | 예 | 문자열 | 문서 id |
| `includeRawYaml` | 아니오 | boolean | 원본 YAML 문자열 포함 여부 |
| `includeParsed` | 아니오 | boolean | 파싱된 객체 포함 여부 |

### `speckiwi_search`

workspace entity를 검색합니다.

| 파라미터 | 필수 | 타입 | 설명 |
| --- | --- | --- | --- |
| `cacheMode` | 아니오 | `"auto"` 또는 `"bypass"` | 캐시 사용 방식 |
| `query` | 예 | 문자열 | 검색어 |
| `mode` | 아니오 | Search mode | `auto`, `exact`, `bm25` 중 선택 |
| `limit` | 아니오 | 정수, 1-100 | 최대 결과 수 |
| `offset` | 아니오 | 정수, 0 이상 | 페이지 시작 위치 |
| `filters` | 아니오 | object | 검색 필터 |

`filters`의 허용 필드는 다음과 같습니다.

| 필드 | 타입 | 설명 |
| --- | --- | --- |
| `entityType` | Entity type 또는 Entity type 배열 | 검색 대상 entity 타입 |
| `documentId` | 문자열 또는 문자열 배열 | 문서 id 필터 |
| `scope` | 문자열 또는 문자열 배열 | scope id 필터 |
| `type` | 문자열 또는 문자열 배열 | domain type 필터 |
| `status` | 문자열 또는 문자열 배열 | 상태 필터 |
| `tag` | 문자열 또는 문자열 배열 | 태그 필터 |
| `path` | 문자열 또는 문자열 배열 | 경로 필터 |

### `speckiwi_get_requirement`

requirement를 정확한 id로 조회합니다.

| 파라미터 | 필수 | 타입 | 설명 |
| --- | --- | --- | --- |
| `cacheMode` | 아니오 | `"auto"` 또는 `"bypass"` | 캐시 사용 방식 |
| `id` | 예 | 문자열 | requirement id |
| `includeRelations` | 아니오 | boolean | incoming/outgoing relation 포함 여부. MCP에서는 기본적으로 포함 |
| `includeDocument` | 아니오 | boolean | requirement가 속한 문서 요약 포함 여부 |

### `speckiwi_list_requirements`

requirement 목록을 필터링해 반환합니다.

| 파라미터 | 필수 | 타입 | 설명 |
| --- | --- | --- | --- |
| `cacheMode` | 아니오 | `"auto"` 또는 `"bypass"` | 캐시 사용 방식 |
| `limit` | 아니오 | 정수, 1-500 | 최대 결과 수 |
| `offset` | 아니오 | 정수, 0 이상 | 페이지 시작 위치 |
| `scope` | 아니오 | 문자열 또는 문자열 배열 | scope id 필터 |
| `type` | 아니오 | 문자열 또는 문자열 배열 | requirement type 필터 |
| `status` | 아니오 | 문자열 또는 문자열 배열 | requirement 상태 필터 |
| `tag` | 아니오 | 문자열 또는 문자열 배열 | 태그 필터 |
| `documentId` | 아니오 | 문자열 또는 문자열 배열 | 문서 id 필터 |
| `project` | 아니오 | 문자열 또는 문자열 배열 | project id 또는 project name 필터 |

### `speckiwi_preview_requirement_id`

파일을 쓰지 않고 deterministic requirement id 생성을 미리 계산합니다.

| 파라미터 | 필수 | 타입 | 설명 |
| --- | --- | --- | --- |
| `cacheMode` | 아니오 | `"auto"` 또는 `"bypass"` | 캐시 사용 방식 |
| `requirementType` | 예 | Requirement type | requirement 타입 |
| `scope` | 예 | 문자열 | 대상 scope id |
| `explicitId` | 아니오 | 문자열 | 사용자가 지정한 id 후보 |

### `speckiwi_trace_requirement`

requirement 관계를 upstream, downstream 또는 양방향으로 추적합니다.

| 파라미터 | 필수 | 타입 | 설명 |
| --- | --- | --- | --- |
| `cacheMode` | 아니오 | `"auto"` 또는 `"bypass"` | 캐시 사용 방식 |
| `id` | 예 | 문자열 | requirement id |
| `direction` | 아니오 | Trace direction | 생략 시 core 기본값 사용 |
| `depth` | 아니오 | 정수, 0-5 | 관계 탐색 깊이 |

### `speckiwi_graph`

workspace graph를 반환합니다.

| 파라미터 | 필수 | 타입 | 설명 |
| --- | --- | --- | --- |
| `cacheMode` | 아니오 | `"auto"` 또는 `"bypass"` | 캐시 사용 방식 |
| `graphType` | 아니오 | Graph type | 반환할 graph 종류 |

### `speckiwi_impact`

requirement 기준 영향 범위를 계산합니다.

| 파라미터 | 필수 | 타입 | 설명 |
| --- | --- | --- | --- |
| `cacheMode` | 아니오 | `"auto"` 또는 `"bypass"` | 캐시 사용 방식 |
| `id` | 예 | 문자열 | requirement id |
| `depth` | 아니오 | 정수, 0-5 | 영향 탐색 깊이 |
| `includeDocuments` | 아니오 | boolean | 관련 문서 context 포함 여부 |
| `includeScopes` | 아니오 | boolean | 관련 scope context 포함 여부 |

### `speckiwi_validate`

workspace YAML과 semantic rule을 검증합니다.

| 파라미터 | 필수 | 타입 | 설명 |
| --- | --- | --- | --- |
| `cacheMode` | 아니오 | `"auto"` 또는 `"bypass"` | 캐시 사용 방식 |

### `speckiwi_propose_change`

원본 YAML을 직접 수정하지 않고 `.speckiwi/proposals/` 아래에 변경 제안을 생성합니다.

| 파라미터 | 필수 | 타입 | 설명 |
| --- | --- | --- | --- |
| `cacheMode` | 아니오 | `"auto"` 또는 `"bypass"` | 캐시 사용 방식 |
| `operation` | 예 | Proposal operation | 수행하려는 변경 종류 |
| `target` | 예 | object | 변경 대상 |
| `changes` | 예 | JSON Patch 배열 | 적용할 변경 목록 |
| `reason` | 예 | 문자열 | 변경 사유 |

`target`은 다음 셋 중 하나입니다.

| target 형태 | 필드 |
| --- | --- |
| requirement 대상 | `{ "kind": "requirement", "requirementId"?: string, "documentId"?: string, "scope"?: string }` |
| document 대상 | `{ "kind": "document", "documentId": string }` |
| manifest 대상 | `{ "kind": "manifest" }` |

`changes` 항목은 다음 형태를 받습니다.

| op | 형태 |
| --- | --- |
| `add` | `{ "op": "add", "path": string, "value": unknown }` |
| `replace` | `{ "op": "replace", "path": string, "value": unknown }` |
| `remove` | `{ "op": "remove", "path": string }` |

### `speckiwi_apply_change`

검증된 proposal 또는 inline change를 원본 YAML에 적용합니다.

| 파라미터 | 필수 | 타입 | 설명 |
| --- | --- | --- | --- |
| `cacheMode` | 아니오 | `"auto"` 또는 `"bypass"` | 캐시 사용 방식 |
| `proposalId` | 조건부 | 문자열 | 적용할 proposal id |
| `proposalPath` | 조건부 | 문자열 | 적용할 proposal YAML 경로 |
| `change` | 조건부 | `speckiwi_propose_change` 입력과 같은 change object | inline 변경 |
| `confirm` | 예 | boolean | 실제 적용 확인. 적용하려면 `true` 필요 |

`proposalId`, `proposalPath`, `change` 중 정확히 하나만 지정해야 합니다. `confirm`이 `false`이면 입력 schema는 통과할 수 있지만 core 정책에서 적용이 거부됩니다.

## MCP 리소스

MCP resource는 tool과 별도로 원본 YAML 또는 stable JSON context를 읽기 위한 인터페이스입니다.

| URI | MIME type | 설명 |
| --- | --- | --- |
| `speckiwi://overview` | `application/yaml` | `.speckiwi/overview.yaml` 원문 |
| `speckiwi://index` | `application/yaml` | `.speckiwi/index.yaml` 원문 |
| `speckiwi://documents/{id}` | `application/yaml` | 등록된 문서 YAML 원문 |
| `speckiwi://requirements/{id}` | `application/json` | requirement와 incoming/outgoing relation context |
| `speckiwi://scopes/{id}` | `application/json` | scope, child scope, 관련 문서, 관련 requirement context |

리소스 id는 URI decode 후 빈 문자열, `/`, `\`, NUL, `..`를 포함할 수 없습니다.

## 공개 모듈

`package.json` 기준으로 다음 ESM export가 공개되어 있습니다.

| export | 용도 |
| --- | --- |
| `speckiwi/cli` | CLI 실행 API |
| `speckiwi/cli/command` | CLI command contract |
| `speckiwi/cli/json-renderer` | Core DTO JSON renderer |
| `speckiwi/core/api` | `createSpecKiwiCore`와 core service API |
| `speckiwi/core/dto` | Core DTO 타입 |
| `speckiwi/core/inputs` | Core input 타입 |
| `speckiwi/core/result` | Core result helper |
| `speckiwi/mcp/structured-content` | MCP structuredContent schema/helper |

## 개발 품질 게이트

현재 저장소에는 다음 검증 명령이 정의되어 있습니다.

```bash
npm run build
npm run typecheck
npm run lint
npm test
npm run release:acceptance
npm run release:check
npm run perf:srs
npm pack --dry-run
```

릴리스 검증은 빌드, 타입 검사, lint, 전체 테스트, release acceptance, SRS 성능 게이트, 패키징 사전 검사를 포함합니다.
