# SRS v1.0 — SpecKiwi YAML 기반 Local-first SDD Context Tool

## 0. 문서 메타데이터

| 항목 | 내용 |
|---|---|
| 문서명 | SpecKiwi v1.0 Software Requirements Specification |
| 문서 유형 | SRS |
| 제품명 | SpecKiwi |
| 제품 버전 | v1.0 |
| 기준 결정 | DB 미사용, YAML 원본, Node CLI, stdio MCP |
| 원본 저장 위치 | 프로젝트 루트의 `.speckiwi/` |
| 주요 인터페이스 | CLI, MCP stdio |
| 원본 포맷 | YAML |
| 기계 응답 포맷 | JSON |
| 산출물 포맷 | Markdown |
| 상태 | Draft |

---

## 1. 목적

SpecKiwi는 Git 저장소 내부의 `.speckiwi/` 디렉토리에 저장된 YAML 기반 PRD/SRS/기술 문서/ADR/규칙 문서를 읽고, 이를 메모리 그래프로 구성하여 CLI와 stdio MCP 인터페이스를 통해 AI 코딩 에이전트와 개발자에게 다음 기능을 제공해야 한다.

```text
요구사항 조회
문서 조회
검색
검증
관계 추적
영향 분석
변경 제안
선택적 변경 적용
Markdown export
```

## 2. 제품 범위

SpecKiwi v1.0은 다음 범위를 포함한다.

```text
Local-first
Repository-local
YAML source of truth
Node.js 기반 CLI
stdio MCP 서버 프로세스
in-memory graph
exact search
BM25 search
Korean n-gram tokenizer
dictionary-based synonym expansion
JSON cache
Markdown export
```

## 3. 제외 범위

| ID | 제외 항목 | 설명 |
|---|---|---|
| OOS-001 | SQLite | 원본 저장소로 SQLite를 사용하지 않는다. |
| OOS-002 | DB migration | 데이터베이스 migration 체계를 제공하지 않는다. |
| OOS-003 | HTTP 서버 | Express, Fastify 등 HTTP 서버를 실행하지 않는다. |
| OOS-004 | JSON-RPC over HTTP | HTTP 기반 JSON-RPC API를 제공하지 않는다. |
| OOS-005 | Web console | 웹 UI는 v1.0 범위에서 제외한다. |
| OOS-006 | Team server | 중앙 서버 또는 멀티유저 서버 모드를 제공하지 않는다. |
| OOS-007 | Auth enforcement | 사용자 인증/권한 검사를 제공하지 않는다. |
| OOS-008 | Vector DB | LanceDB, Qdrant 등 벡터 DB를 기본 기능으로 포함하지 않는다. |
| OOS-009 | Markdown import | Markdown을 원본 YAML로 역변환하지 않는다. |
| OOS-010 | Background daemon | 상주 서버 프로세스를 요구하지 않는다. |

## 4. 시스템 정의

```text
SpecKiwi는 Git 저장소 안에서 동작하는 YAML 기반 SDD 메모리 MCP 도구다.
```

### 4.1 시스템 구성

```text
Developer
  └─ speckiwi CLI
       └─ SpecKiwi Core
            └─ .speckiwi/**/*.yaml
```

```text
AI Coding Agent
  └─ MCP stdio
       └─ speckiwi mcp
            └─ SpecKiwi Core
                 └─ .speckiwi/**/*.yaml
```

## 5. 저장소 구조 요구사항

### FR-DIR

| ID | 요구사항 |
|---|---|
| FR-DIR-001 | 시스템은 `speckiwi init` 실행 시 `.speckiwi/` 디렉토리를 생성해야 한다. |
| FR-DIR-002 | 시스템은 `.speckiwi/index.yaml`을 생성해야 한다. |
| FR-DIR-003 | 시스템은 `.speckiwi/overview.yaml`을 생성해야 한다. |
| FR-DIR-004 | 시스템은 `.speckiwi/dictionary.yaml`을 생성해야 한다. |
| FR-DIR-005 | 시스템은 `prd`, `srs`, `tech`, `adr`, `rules`, `proposals`, `templates`, `cache`, `exports` 하위 디렉토리를 생성해야 한다. |
| FR-DIR-006 | 시스템은 현재 디렉토리부터 상위 디렉토리로 탐색하여 가장 가까운 `.speckiwi/`를 workspace root로 판단해야 한다. |
| FR-DIR-007 | 사용자가 `--root`를 지정한 경우 시스템은 자동 탐색보다 `--root`를 우선해야 한다. |
| FR-DIR-008 | 시스템은 명시적 export target을 제외하고 `.speckiwi/` 외부 파일을 수정하지 않아야 한다. |
| FR-DIR-009 | 시스템은 `.speckiwi/cache/` 내용을 재생성 가능한 데이터로 취급해야 한다. |
| FR-DIR-010 | 시스템은 `.speckiwi/exports/` 내용을 원본이 아닌 산출물로 취급해야 한다. |

## 6. 원본 저장 포맷 요구사항

### FR-STOR

| ID | 요구사항 |
|---|---|
| FR-STOR-001 | 시스템은 `.speckiwi/**/*.yaml` 파일을 원본 데이터로 취급해야 한다. |
| FR-STOR-002 | 시스템은 JSON cache를 원본으로 취급하지 않아야 한다. |
| FR-STOR-003 | 시스템은 Markdown export 결과물을 원본으로 취급하지 않아야 한다. |
| FR-STOR-004 | 시스템은 SQLite, PostgreSQL, MySQL, DuckDB 등 데이터베이스를 원본 저장소로 사용하지 않아야 한다. |
| FR-STOR-005 | 시스템은 `.db`, `.sqlite`, `.sqlite3` 파일을 생성하지 않아야 한다. |
| FR-STOR-006 | 시스템은 cache 삭제 후 YAML 파일만으로 graph와 search index를 재구성할 수 있어야 한다. |
| FR-STOR-007 | 시스템은 Git history를 변경 이력의 1차 수단으로 간주해야 한다. |

### FR-YAML

| ID | 요구사항 |
|---|---|
| FR-YAML-001 | 시스템은 YAML을 원본 문서 포맷으로 사용해야 한다. |
| FR-YAML-002 | 시스템은 YAML anchor 사용을 오류로 탐지해야 한다. |
| FR-YAML-003 | 시스템은 YAML alias 사용을 오류로 탐지해야 한다. |
| FR-YAML-004 | 시스템은 YAML merge key 사용을 오류로 처리해야 한다. |
| FR-YAML-005 | 시스템은 문서의 최상위 `schemaVersion` 필드를 요구해야 한다. |
| FR-YAML-006 | 시스템은 `index.yaml`을 제외한 content document의 최상위 `id` 필드를 요구해야 한다. |
| FR-YAML-007 | 시스템은 `index.yaml`을 제외한 content document의 최상위 `type` 필드를 요구해야 한다. |
| FR-YAML-008 | 시스템은 사전에 정의되지 않은 확장 필드를 `metadata` 하위에서만 허용해야 한다. |
| FR-YAML-009 | 시스템은 YAML 문서를 JSON Schema로 검증해야 한다. |
| FR-YAML-010 | 시스템은 YAML parse 실패 시 해당 파일 경로, line, column을 diagnostics에 포함해야 한다. |

## 7. 문서 모델 요구사항

`index.yaml`을 제외한 content document는 다음 공통 필드를 가져야 한다.
`metadata`는 optional extension slot이다.

```yaml
schemaVersion: speckiwi/<document-type>/v1
id: string
type: string
title: string
status: draft | active | deprecated | archived
metadata: {} # optional
```

지원 registered content document type:

```text
overview
prd
srs
technical
adr
rule
dictionary
```

`index.yaml`은 workspace manifest이며 content document type이 아니다.
`proposal`은 schema-validated managed artifact이며 index document registry/search/graph/export 대상이 아니다.
`.speckiwi/templates/*.md.tmpl`은 Markdown export용 asset이며 v1 YAML document type이 아니다.

| ID | 요구사항 |
|---|---|
| FR-DOC-001 | 시스템은 모든 문서의 `schemaVersion`을 검증해야 한다. |
| FR-DOC-002 | 시스템은 모든 문서의 `id`가 workspace 내에서 유일한지 검증해야 한다. |
| FR-DOC-003 | 시스템은 모든 문서의 `type`이 허용된 문서 타입인지 검증해야 한다. |
| FR-DOC-004 | 시스템은 모든 문서의 `status`가 허용된 상태인지 검증해야 한다. |
| FR-DOC-005 | 시스템은 문서 경로가 `index.yaml`에 등록되어 있는지 검증해야 한다. |
| FR-DOC-006 | 시스템은 `index.yaml`에 등록된 문서 path가 실제 파일로 존재하는지 검증해야 한다. |
| FR-DOC-007 | 시스템은 `.speckiwi/proposals/*.yaml`을 schema validation 대상으로 처리하되 index registry에는 등록하지 않아야 한다. |

## 8. SRS 요구사항

SRS 문서는 scope 단위 파일로 관리한다.

```yaml
schemaVersion: speckiwi/srs/v1

id: srs.agent-kernel.loop
type: srs
scope: agent-kernel.loop
title: Agent Kernel Loop SRS
status: active

requirements:
  - id: FR-AGK-LOOP-0001
    type: functional
    title: LLM 응답 기반 상태 전이
    status: draft
    priority: high
    statement: >
      에이전트 커널은 LLM 응답 타입에 따라 다음 실행 상태를 결정해야 한다.
    rationale: >
      에이전트 루프는 final answer, tool call, error, continuation 요청을
      명확히 구분해야 한다.
    acceptanceCriteria:
      - id: AC-001
        method: test
        description: LLM 응답이 tool_call이면 tool execution 단계로 전이한다.
    relations:
      - type: depends_on
        target: IR-LLM-STREAM-0001
    tags:
      - agent-loop
      - state-machine
```

### Requirement Type

```text
functional
non_functional
interface
data
constraint
security
performance
reliability
usability
maintainability
operational
compliance
migration
observability
```

### Requirement Status

```text
draft
active
in_progress
done
blocked
deprecated
replaced
discarded
```

### FR-REQ

| ID | 요구사항 |
|---|---|
| FR-REQ-001 | 시스템은 workspace 전체에서 requirement `id`가 유일한지 검증해야 한다. |
| FR-REQ-002 | 시스템은 requirement `id`로 단일 requirement를 조회할 수 있어야 한다. |
| FR-REQ-003 | 시스템은 requirement `id`를 exact index에 등록해야 한다. |
| FR-REQ-004 | 시스템은 requirement `statement`를 필수로 요구해야 한다. |
| FR-REQ-005 | 시스템은 requirement `type`을 허용된 enum으로 검증해야 한다. |
| FR-REQ-006 | 시스템은 requirement `status`를 허용된 enum으로 검증해야 한다. |
| FR-REQ-007 | 시스템은 `acceptanceCriteria`가 없는 requirement에 대해 warning을 생성해야 한다. |
| FR-REQ-008 | 시스템은 `rationale`이 없는 requirement에 대해 warning을 생성해야 한다. |
| FR-REQ-009 | 시스템은 requirement relation target이 존재하는지 검증해야 한다. |
| FR-REQ-010 | 시스템은 `depends_on` relation cycle을 탐지해야 한다. |
| FR-REQ-011 | 시스템은 requirement 목록을 project, scope, type, status, tag 기준으로 필터링할 수 있어야 한다. |
| FR-REQ-012 | 시스템은 requirement를 Markdown export에 포함할 수 있어야 한다. |
| FR-REQ-013 | 시스템은 requirement 생성 시 ID 자동 생성을 지원해야 한다. |
| FR-REQ-014 | 시스템은 사용자가 명시한 requirement ID를 사용할 수 있어야 한다. |
| FR-REQ-015 | 시스템은 명시 ID가 중복될 경우 생성을 거부해야 한다. |

## 9. ID 체계

Requirement ID 권장 형식:

```text
<PREFIX>-<PROJECT>-<SCOPE>-<0001>
```

예:

```text
FR-AGK-LOOP-0001
NFR-AGK-LOOP-0001
IR-LLM-STREAM-0001
CON-TOOL-EXEC-0001
```

| Prefix | Type |
|---|---|
| FR | functional |
| NFR | non_functional |
| IR | interface |
| DR | data |
| CON | constraint |
| SEC | security |
| PERF | performance |
| REL | reliability |
| UX | usability |
| MAINT | maintainability |
| OPS | operational |
| COMP | compliance |
| OBS | observability |
| MIG | migration |

## 10. Relation 및 Link

Requirement relation type:

```text
depends_on
blocks
relates_to
duplicates
conflicts_with
refines
generalizes
replaces
replaced_by
derived_from
implements
documents
tests
requires_review_with
```

문서 link type:

```text
relates_to
refines
supersedes
depends_on
documents
implements
references
```

## 11. 검색 요구사항

| ID | 요구사항 |
|---|---|
| FR-SRCH-001 | 시스템은 YAML 문서를 검색용 flat document로 변환해야 한다. |
| FR-SRCH-002 | 시스템은 requirement id, document id, scope id를 exact index에 등록해야 한다. |
| FR-SRCH-003 | 시스템은 title, statement, rationale, description, tags, acceptanceCriteria를 BM25 index에 포함해야 한다. |
| FR-SRCH-004 | 시스템은 field별 boost를 적용해야 한다. |
| FR-SRCH-005 | 시스템은 query가 exact id와 일치할 경우 exact result를 우선 반환해야 한다. |
| FR-SRCH-006 | 시스템은 검색 결과에 score, matchedFields, entityType, id, title, path를 포함해야 한다. |
| FR-SRCH-007 | 시스템은 검색 결과를 `--json` 또는 MCP 응답에서 JSON으로 반환해야 한다. |
| FR-SRCH-008 | 시스템은 scope, type, status, tag 기준 필터를 지원해야 한다. |
| FR-SRCH-009 | 시스템은 cache가 stale인 경우 검색 전 자동 재생성하거나 stale warning을 반환해야 한다. |

## 12. Validation 요구사항

Error 조건:

```text
index.yaml 없음
overview.yaml 없음
YAML parse 실패
schemaVersion 누락 또는 불일치
document id 중복
requirement id 중복
index path missing
존재하지 않는 document link 참조
존재하지 않는 requirement relation target
잘못된 requirement type/status
scope parent cycle
YAML merge key 사용
.speckiwi/ 외부 path 참조
```

Warning 조건:

```text
acceptanceCriteria 없음
rationale 없음
optional document link target 누락
cache stale
단일 YAML 문서가 크기 임계값 초과
depends_on cycle 의심
dictionary 미사용 synonym entry
검색 대상 text 비어 있음
```

## 13. CLI 요구사항

```bash
speckiwi init
speckiwi validate
speckiwi doctor
speckiwi overview
speckiwi list docs
speckiwi list reqs
speckiwi search "..."
speckiwi req get <id>
speckiwi req create
speckiwi req update <id>
speckiwi graph
speckiwi impact <id>
speckiwi export markdown
speckiwi cache rebuild
speckiwi cache clean
speckiwi mcp
```

공통 옵션:

```text
--root <path>
--json
--no-cache
--verbose
--quiet
```

## 14. MCP 요구사항

Tools:

```text
speckiwi_overview
speckiwi_list_documents
speckiwi_read_document
speckiwi_search
speckiwi_get_requirement
speckiwi_list_requirements
speckiwi_trace_requirement
speckiwi_impact
speckiwi_validate
speckiwi_propose_change
speckiwi_apply_change
```

Resources:

```text
speckiwi://overview
speckiwi://index
speckiwi://documents/{id}
speckiwi://requirements/{id}
speckiwi://scopes/{id}
```

## 15. 비기능 요구사항

### 보안

| ID | 요구사항 |
|---|---|
| NFR-SEC-001 | 시스템은 기본 동작에서 네트워크 포트를 열지 않아야 한다. |
| NFR-SEC-002 | 시스템은 HTTP 서버를 시작하지 않아야 한다. |
| NFR-SEC-003 | 시스템은 workspace root 밖의 파일을 기본적으로 읽지 않아야 한다. |
| NFR-SEC-004 | 시스템은 workspace root 밖의 파일을 기본적으로 쓰지 않아야 한다. |
| NFR-SEC-005 | 시스템은 path traversal 입력을 거부해야 한다. |

### 성능

| ID | 요구사항 |
|---|---|
| NFR-PERF-001 | 10,000개 requirement 기준 exact lookup은 50ms 이내를 목표로 해야 한다. |
| NFR-PERF-002 | 10,000개 requirement 기준 cache 기반 검색은 500ms 이내를 목표로 해야 한다. |
| NFR-PERF-003 | 10,000개 requirement 기준 cache rebuild는 10초 이내를 목표로 해야 한다. |
| NFR-PERF-004 | 1,000개 YAML 문서 기준 validation은 10초 이내를 목표로 해야 한다. |

### 호환성

| ID | 요구사항 |
|---|---|
| NFR-COMP-001 | 시스템은 Node.js 20 이상에서 실행되어야 한다. |
| NFR-COMP-002 | 시스템은 macOS, Linux, Windows에서 실행 가능해야 한다. |
| NFR-COMP-003 | 시스템은 native dependency 없이 기본 기능을 설치할 수 있어야 한다. |
| NFR-COMP-004 | 시스템은 Java, Python, database runtime을 기본 의존성으로 요구하지 않아야 한다. |

## 16. 수용 기준

- [ ] `.speckiwi/` workspace를 초기화할 수 있다.
- [ ] SQLite를 사용하지 않는다.
- [ ] DB 파일을 생성하지 않는다.
- [ ] YAML만으로 cache를 재생성할 수 있다.
- [ ] `speckiwi validate`가 동작한다.
- [ ] `speckiwi search`가 동작한다.
- [ ] `speckiwi req get <id>`가 동작한다.
- [ ] `speckiwi mcp --root <path>`가 stdio MCP 프로세스로 실행된다.
- [ ] MCP가 stdout에 protocol message 외 로그를 쓰지 않는다.
- [ ] propose mode는 원본 YAML을 수정하지 않는다.
- [ ] apply mode는 validation error가 없을 때만 원본 YAML을 수정한다.
- [ ] overview/SRS/PRD/technical/ADR Markdown export가 가능하다.

## 17. 최종 시스템 요구사항 요약

```text
1. 데이터베이스를 사용하지 않는다.
2. 프로젝트 루트의 .speckiwi YAML 파일을 유일한 원본으로 사용한다.
3. CLI와 stdio MCP를 제공한다.
4. 모든 core 기능은 파일 기반, 메모리 그래프 기반으로 동작한다.
5. 검색은 exact index + BM25 + 한글 n-gram + dictionary 기반으로 제공한다.
6. 에이전트 쓰기는 propose를 기본으로 하며 apply는 검증 후 허용한다.
7. JSON cache와 Markdown export는 재생성 가능한 산출물이다.
8. Git이 변경 이력의 1차 수단이다.
```

## 18. 구현 준비성 보완 결정

상세 구현은 `12_IMPLEMENTATION_READINESS_DECISIONS.md`의 보완 결정을 따라야 한다.

핵심 결정은 다음과 같다.

```text
- CLI JSON과 MCP structuredContent는 동일 Core DTO를 사용한다.
- diagnostics는 DiagnosticBag 구조로 통일한다.
- YAML anchor/alias/merge key는 error다.
- JSON Schema는 metadata 외 additionalProperties=false를 기본으로 한다.
- index.yaml은 content document가 아니라 workspace manifest다.
- proposal은 managed artifact이며 index registry/search/graph/export 대상이 아니다.
- template은 v1 YAML document type이 아니라 Markdown export asset이다.
- metadata는 optional이며 있으면 object여야 한다.
- JSON Schema는 draft 2020-12와 Ajv2020 strict mode를 사용한다.
- status enum은 문서 타입별로 검증한다.
- search score와 tie-break는 deterministic하게 계산한다.
- GraphResult, TraceResult, ImpactResult는 deterministic nodes/edges DTO를 사용한다.
- impact는 relation type별 traversal matrix를 따른다.
- proposal은 base hash와 RFC 8785 JCS 기반 targetHash를 포함하고 stale proposal apply는 거부한다.
- JSON Patch는 RFC 6902 add/replace/remove subset이며 path는 document-root RFC 6901 JSON Pointer다.
- cache stale은 기본 자동 rebuild하고 --no-cache는 cache read/write를 우회한다.
- cache manifest는 graph/search/diagnostics/export section을 포함하고 wall-clock timestamp를 포함하지 않는다.
- export는 기본 non-strict best-effort, --strict는 validation error에서 쓰기 전 중단한다.
- export 결과는 writtenFiles/skippedFiles typed item DTO를 사용하고 generated timestamp를 기본 포함하지 않는다.
```
