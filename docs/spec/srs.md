# SRS v1.0 — SpecKiwi YAML 기반 Local-first SDD Context Tool

## 0. 문서 메타데이터

| 항목       | 내용                                                |
| -------- | ------------------------------------------------- |
| 문서명      | SpecKiwi v1.0 Software Requirements Specification |
| 문서 유형    | SRS                                               |
| 제품명      | SpecKiwi                                          |
| 제품 버전    | v1.0                                              |
| 문서 버전    | SRS v1.0                                          |
| 기준 결정    | DB 미사용, YAML 원본, Node CLI, stdio MCP              |
| 원본 저장 위치 | 프로젝트 루트의 `.speckiwi/`                             |
| 주요 인터페이스 | CLI, MCP stdio                                    |
| 원본 포맷    | YAML                                              |
| 기계 응답 포맷 | JSON                                              |
| 산출물 포맷   | Markdown                                          |
| 상태       | Draft                                             |
| 비고       | 기존 DB/서버 중심 PRD 방향을 대체한다.                         |

---

# 1. 개요

## 1.1 목적

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

## 1.2 제품 범위

SpecKiwi v1.0은 다음 범위만 포함한다.

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

## 1.3 제외 범위

SpecKiwi v1.0은 다음을 제공하지 않아야 한다.

| ID      | 제외 항목              | 설명                                         |
| ------- | ------------------ | ------------------------------------------ |
| OOS-001 | SQLite             | 원본 저장소로 SQLite를 사용하지 않는다.                  |
| OOS-002 | DB migration       | 데이터베이스 migration 체계를 제공하지 않는다.             |
| OOS-003 | HTTP 서버            | Express, Fastify 등 HTTP 서버를 실행하지 않는다.      |
| OOS-004 | JSON-RPC over HTTP | HTTP 기반 JSON-RPC API를 제공하지 않는다.            |
| OOS-005 | Web console        | 웹 UI는 v1.0 범위에서 제외한다.                      |
| OOS-006 | Team server        | 중앙 서버 또는 멀티유저 서버 모드를 제공하지 않는다.             |
| OOS-007 | Auth enforcement   | 사용자 인증/권한 검사를 제공하지 않는다.                    |
| OOS-008 | Vector DB          | LanceDB, Qdrant 등 벡터 DB를 기본 기능으로 포함하지 않는다. |
| OOS-009 | Markdown import    | Markdown을 원본 YAML로 역변환하지 않는다.              |
| OOS-010 | Background daemon  | 상주 서버 프로세스를 요구하지 않는다.                      |

---

# 2. 시스템 정의

## 2.1 시스템 한 줄 정의

```text
SpecKiwi는 Git 저장소 안에서 동작하는 YAML 기반 SDD 메모리 MCP 도구다.
```

## 2.2 시스템 구성

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

## 2.3 주요 컴포넌트

| 컴포넌트               | 책임                                          |
| ------------------ | ------------------------------------------- |
| CLI Adapter        | 사용자의 터미널 명령을 처리한다.                          |
| MCP Adapter        | stdio MCP tools/resources를 제공한다.            |
| Core Service       | 문서 로드, 검증, 검색, 그래프, 변경 제안 로직을 조정한다.         |
| File Store         | `.speckiwi/` 파일을 읽고 쓴다.                     |
| YAML Loader        | YAML 문서를 파싱하고 제한된 YAML subset 정책을 적용한다.     |
| Schema Validator   | YAML 문서를 JSON Schema 기준으로 검증한다.             |
| Graph Builder      | 문서, scope, requirement, relation 그래프를 구성한다. |
| Search Engine      | exact search, BM25, 한글 n-gram 검색을 수행한다.     |
| Cache Manager      | 재생성 가능한 JSON cache를 생성/무효화한다.               |
| Change Planner     | 변경 제안 proposal을 생성한다.                       |
| Apply Engine       | 검증된 변경을 원본 YAML에 적용한다.                      |
| Markdown Exporter  | YAML 원본으로부터 Markdown 산출물을 생성한다.             |
| Diagnostics Engine | error/warning 진단 결과를 생성한다.                  |

---

# 3. 저장소 구조 요구사항

## 3.1 표준 디렉토리 구조

시스템은 프로젝트 루트에 다음 구조를 생성하고 사용해야 한다.

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
├─ proposals/
├─ templates/
├─ cache/
└─ exports/
```

## 3.2 디렉토리 요구사항

| ID         | 요구사항                                                                                                      |
| ---------- | --------------------------------------------------------------------------------------------------------- |
| FR-DIR-001 | 시스템은 `speckiwi init` 실행 시 `.speckiwi/` 디렉토리를 생성해야 한다.                                                     |
| FR-DIR-002 | 시스템은 `.speckiwi/index.yaml`을 생성해야 한다.                                                                     |
| FR-DIR-003 | 시스템은 `.speckiwi/overview.yaml`을 생성해야 한다.                                                                  |
| FR-DIR-004 | 시스템은 `.speckiwi/dictionary.yaml`을 생성해야 한다.                                                                |
| FR-DIR-005 | 시스템은 `prd`, `srs`, `tech`, `adr`, `rules`, `proposals`, `templates`, `cache`, `exports` 하위 디렉토리를 생성해야 한다. |
| FR-DIR-006 | 시스템은 현재 디렉토리부터 상위 디렉토리로 탐색하여 가장 가까운 `.speckiwi/`를 workspace root로 판단해야 한다.                                |
| FR-DIR-007 | 사용자가 `--root`를 지정한 경우 시스템은 자동 탐색보다 `--root`를 우선해야 한다.                                                     |
| FR-DIR-008 | 시스템은 명시적 export target을 제외하고 `.speckiwi/` 외부 파일을 수정하지 않아야 한다.                                             |
| FR-DIR-009 | 시스템은 `.speckiwi/cache/` 내용을 재생성 가능한 데이터로 취급해야 한다.                                                         |
| FR-DIR-010 | 시스템은 `.speckiwi/exports/` 내용을 원본이 아닌 산출물로 취급해야 한다.                                                        |

---

# 4. 원본 저장 포맷 요구사항

## 4.1 Source of Truth

| ID          | 요구사항                                                                  |
| ----------- | --------------------------------------------------------------------- |
| FR-STOR-001 | 시스템은 `.speckiwi/**/*.yaml` 파일을 원본 데이터로 취급해야 한다.                       |
| FR-STOR-002 | 시스템은 JSON cache를 원본으로 취급하지 않아야 한다.                                    |
| FR-STOR-003 | 시스템은 Markdown export 결과물을 원본으로 취급하지 않아야 한다.                           |
| FR-STOR-004 | 시스템은 SQLite, PostgreSQL, MySQL, DuckDB 등 데이터베이스를 원본 저장소로 사용하지 않아야 한다. |
| FR-STOR-005 | 시스템은 `.db`, `.sqlite`, `.sqlite3` 파일을 생성하지 않아야 한다.                    |
| FR-STOR-006 | 시스템은 cache 삭제 후 YAML 파일만으로 graph와 search index를 재구성할 수 있어야 한다.        |
| FR-STOR-007 | 시스템은 Git history를 변경 이력의 1차 수단으로 간주해야 한다.                             |

## 4.2 YAML 제한 정책

| ID          | 요구사항                                                               |
| ----------- | ------------------------------------------------------------------ |
| FR-YAML-001 | 시스템은 YAML을 원본 문서 포맷으로 사용해야 한다.                                     |
| FR-YAML-002 | 시스템은 YAML parser에서 anchor 사용을 오류로 탐지해야 한다.                          |
| FR-YAML-003 | 시스템은 YAML alias 사용을 오류로 탐지해야 한다.                                    |
| FR-YAML-004 | 시스템은 YAML merge key 사용을 오류로 처리해야 한다.                               |
| FR-YAML-005 | 시스템은 문서의 최상위 `schemaVersion` 필드를 요구해야 한다.                          |
| FR-YAML-006 | 시스템은 `index.yaml`을 제외한 content document의 최상위 `id` 필드를 요구해야 한다.       |
| FR-YAML-007 | 시스템은 `index.yaml`을 제외한 content document의 최상위 `type` 필드를 요구해야 한다.     |
| FR-YAML-008 | 시스템은 사전에 정의되지 않은 확장 필드를 `metadata` 하위에서만 허용해야 한다.                  |
| FR-YAML-009 | 시스템은 YAML 문서를 JSON Schema로 검증해야 한다.                                |
| FR-YAML-010 | 시스템은 YAML parse 실패 시 해당 파일 경로, line, column을 diagnostics에 포함해야 한다. |

---

# 5. 문서 모델 요구사항

## 5.1 공통 문서 필드

`index.yaml`을 제외한 모든 SpecKiwi content document는 다음 공통 필드를 가져야 한다.
`metadata`는 optional extension slot이다.

```yaml
schemaVersion: speckiwi/<document-type>/v1
id: string
type: string
title: string
status: draft | active | deprecated | archived
metadata: {} # optional
```

| ID         | 요구사항                                                  |
| ---------- | ----------------------------------------------------- |
| FR-DOC-001 | 시스템은 모든 문서의 `schemaVersion`을 검증해야 한다.                 |
| FR-DOC-002 | 시스템은 모든 문서의 `id`가 workspace 내에서 유일한지 검증해야 한다.         |
| FR-DOC-003 | 시스템은 모든 문서의 `type`이 허용된 문서 타입인지 검증해야 한다.              |
| FR-DOC-004 | 시스템은 모든 문서의 `status`가 허용된 상태인지 검증해야 한다.               |
| FR-DOC-005 | 시스템은 content document 경로가 `index.yaml`에 등록되어 있는지 검증해야 한다. |
| FR-DOC-006 | 시스템은 `index.yaml`에 등록된 문서 path가 실제 파일로 존재하는지 검증해야 한다. |
| FR-DOC-007 | 시스템은 `index.yaml`을 workspace manifest로 취급하고 content document registry에 등록하지 않아야 한다. |
| FR-DOC-008 | 시스템은 `metadata`가 없더라도 content document를 유효하게 처리해야 한다. |
| FR-DOC-009 | 시스템은 `.speckiwi/proposals/*.yaml`을 schema-validated managed artifact로 취급하고 `index.yaml` document registry에는 등록하지 않아야 한다. |
| FR-DOC-010 | 시스템은 `index.documents[].id/type`과 실제 YAML `id/type/schemaVersion`의 정합성을 검증해야 한다. |
| FR-DOC-011 | 시스템은 content YAML이 `index.documents[]`에 등록되지 않은 경우 error를 생성해야 한다. |

## 5.2 문서 타입

시스템은 다음 registered content document type을 지원해야 한다.

```text
overview
prd
srs
technical
adr
rule
dictionary
```

`index.yaml`은 manifest schema를 갖지만 content document type은 아니다.
`proposal`은 `speckiwi/proposal/v1` schema를 갖는 managed artifact type이며 search/graph/export 대상 content document는 아니다.
`.speckiwi/templates/*.md.tmpl`은 Markdown export용 asset이며 v1 YAML document type은 아니다.

---

# 6. `index.yaml` 요구사항

## 6.1 책임

`index.yaml`은 workspace의 기계 판독용 manifest 역할을 해야 한다.

`index.yaml`은 다음 정보를 포함해야 한다.

```text
project
settings
documents
scopes
links
```

## 6.2 예시 구조

```yaml
schemaVersion: speckiwi/index/v1

project:
  id: speckiwi
  name: SpecKiwi
  language: ko

settings:
  agent:
    defaultWriteMode: propose
    allowApply: true
  search:
    defaultMode: auto
    koreanNgram:
      min: 2
      max: 3

documents:
  - id: overview
    type: overview
    path: overview.yaml

  - id: srs.agent-kernel.loop
    type: srs
    scope: agent-kernel.loop
    path: srs/agent-kernel.loop.yaml

scopes:
  - id: agent-kernel
    name: Agent Kernel
    type: module

  - id: agent-kernel.loop
    parent: agent-kernel
    name: Agent Loop
    type: feature

links:
  - from: srs.agent-kernel.loop
    to: tech.agent-state-machine
    type: refines
```

## 6.3 요구사항

| ID         | 요구사항                                                                         |
| ---------- | ---------------------------------------------------------------------------- |
| FR-IDX-001 | 시스템은 `.speckiwi/index.yaml`을 필수 파일로 요구해야 한다.                                 |
| FR-IDX-002 | 시스템은 `project.id`를 필수로 요구해야 한다.                                              |
| FR-IDX-003 | 시스템은 `project.name`을 필수로 요구해야 한다.                                            |
| FR-IDX-004 | 시스템은 `documents` 배열을 필수로 요구해야 한다.                                            |
| FR-IDX-005 | 시스템은 `documents[].id`가 중복되지 않는지 검증해야 한다.                                     |
| FR-IDX-006 | 시스템은 `documents[].path`가 `.speckiwi/` 내부 상대 경로인지 검증해야 한다.                    |
| FR-IDX-007 | 시스템은 `scopes[].id`가 중복되지 않는지 검증해야 한다.                                        |
| FR-IDX-008 | 시스템은 scope parent 참조가 존재하는지 검증해야 한다.                                         |
| FR-IDX-009 | 시스템은 scope parent 관계에 cycle이 없는지 검증해야 한다.                                    |
| FR-IDX-010 | 시스템은 `links[].from`과 `links[].to`가 존재하는 document id인지 검증해야 한다.               |
| FR-IDX-011 | 시스템은 `settings.agent.defaultWriteMode`가 `propose` 또는 `apply` 중 하나인지 검증해야 한다. |
| FR-IDX-012 | 시스템은 `settings.search`가 없을 경우 기본 검색 설정을 적용해야 한다.                             |
| FR-IDX-013 | 시스템은 `index.yaml`에 `id`, `type`, `title`, `status` 필드를 요구하지 않아야 한다.             |
| FR-IDX-014 | 시스템은 `documents[]`에 `index`, `template`, `proposal` type이 등록된 경우 오류를 생성해야 한다. |

---

# 7. `overview.yaml` 요구사항

## 7.1 책임

`overview.yaml`은 프로젝트의 최상위 요약 문서로 사용되어야 한다.

## 7.2 예시 구조

```yaml
schemaVersion: speckiwi/overview/v1

id: overview
type: overview
title: SpecKiwi Overview
status: active

summary: >
  SpecKiwi는 YAML 기반 SDD context tool이다.

goals:
  - id: G-001
    statement: AI 코딩 에이전트가 요구사항을 안정적으로 조회할 수 있어야 한다.

nonGoals:
  - id: NG-001
    statement: v1에서는 데이터베이스를 사용하지 않는다.

glossary:
  - term: SRS
    definition: 검증 가능한 시스템 요구사항 명세.
```

## 7.3 요구사항

| ID         | 요구사항                                                               |
| ---------- | ------------------------------------------------------------------ |
| FR-OVR-001 | 시스템은 `.speckiwi/overview.yaml`을 필수 파일로 요구해야 한다.                    |
| FR-OVR-002 | 시스템은 overview 문서를 MCP resource `speckiwi://overview`로 제공해야 한다.     |
| FR-OVR-003 | 시스템은 overview 문서를 CLI `speckiwi overview` 또는 동등 명령으로 조회할 수 있어야 한다. |
| FR-OVR-004 | 시스템은 overview의 `goals`, `nonGoals`, `glossary`를 검색 대상으로 포함해야 한다.   |
| FR-OVR-005 | 시스템은 overview 문서를 Markdown export에 포함할 수 있어야 한다.                   |

---

# 8. SRS 문서 요구사항

## 8.1 SRS 파일 분할 단위

| ID             | 요구사항                                             |
| -------------- | ------------------------------------------------ |
| FR-SRS-DOC-001 | 시스템은 SRS 문서를 scope 단위 파일로 관리해야 한다.               |
| FR-SRS-DOC-002 | 시스템은 하나의 SRS 파일이 하나의 primary scope를 표현하도록 해야 한다. |
| FR-SRS-DOC-003 | 시스템은 requirement 하나당 파일 하나를 기본 구조로 사용하지 않아야 한다.  |
| FR-SRS-DOC-004 | 시스템은 전체 프로젝트 SRS를 단일 파일로 강제하지 않아야 한다.            |

## 8.2 SRS 문서 예시

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

## 8.3 Requirement 필드

각 requirement는 다음 필드를 지원해야 한다.

| 필드                   |  필수 | 설명                   |
| -------------------- | --: | -------------------- |
| `id`                 |   예 | 전역 유일 requirement ID |
| `type`               |   예 | requirement 유형       |
| `title`              |   예 | 짧은 제목                |
| `status`             |   예 | 현재 상태                |
| `priority`           | 아니오 | 우선순위                 |
| `statement`          |   예 | 검증 가능한 요구사항 문장       |
| `rationale`          | 아니오 | 근거                   |
| `description`        | 아니오 | 상세 설명                |
| `acceptanceCriteria` | 아니오 | 수용 기준                |
| `relations`          | 아니오 | requirement 간 관계     |
| `tags`               | 아니오 | 검색/분류용 태그            |
| `metadata`           | 아니오 | 확장 정보                |

## 8.4 Requirement 유형

시스템은 다음 requirement type을 지원해야 한다.

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

## 8.5 Requirement 상태

시스템은 다음 requirement status를 지원해야 한다.

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

## 8.6 Requirement 우선순위

시스템은 다음 priority를 지원해야 한다.

```text
critical
high
medium
low
optional
```

## 8.7 Requirement 요구사항

| ID         | 요구사항                                                                       |
| ---------- | -------------------------------------------------------------------------- |
| FR-REQ-001 | 시스템은 workspace 전체에서 requirement `id`가 유일한지 검증해야 한다.                        |
| FR-REQ-002 | 시스템은 requirement `id`로 단일 requirement를 조회할 수 있어야 한다.                       |
| FR-REQ-003 | 시스템은 requirement `id`를 exact index에 등록해야 한다.                               |
| FR-REQ-004 | 시스템은 requirement `statement`를 필수로 요구해야 한다.                                 |
| FR-REQ-005 | 시스템은 requirement `type`을 허용된 enum으로 검증해야 한다.                               |
| FR-REQ-006 | 시스템은 requirement `status`를 허용된 enum으로 검증해야 한다.                             |
| FR-REQ-007 | 시스템은 `acceptanceCriteria`가 없는 requirement에 대해 warning을 생성해야 한다.            |
| FR-REQ-008 | 시스템은 `rationale`이 없는 requirement에 대해 warning을 생성해야 한다.                     |
| FR-REQ-009 | 시스템은 requirement relation target이 존재하는지 검증해야 한다.                           |
| FR-REQ-010 | 시스템은 `depends_on` relation cycle을 탐지해야 한다.                                 |
| FR-REQ-011 | 시스템은 requirement 목록을 project, scope, type, status, tag 기준으로 필터링할 수 있어야 한다. |
| FR-REQ-012 | 시스템은 requirement를 Markdown export에 포함할 수 있어야 한다.                           |
| FR-REQ-013 | 시스템은 requirement 생성 시 ID 자동 생성을 지원해야 한다.                                   |
| FR-REQ-014 | 시스템은 사용자가 명시한 requirement ID를 사용할 수 있어야 한다.                                |
| FR-REQ-015 | 시스템은 명시 ID가 중복될 경우 생성을 거부해야 한다.                                            |

---

# 9. ID 체계 요구사항

## 9.1 문서 ID

문서 ID는 다음 형식을 권장한다.

```text
overview
srs.<scope-id>
prd.<topic-id>
tech.<topic-id>
adr.<number>-<slug>
rule.<topic-id>
```

예:

```text
srs.agent-kernel.loop
tech.agent-state-machine
adr.0001-local-yaml-storage
rule.coding-agent-safe-write
```

## 9.2 Requirement ID

Requirement ID는 다음 형식을 권장한다.

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

## 9.3 Prefix

| Prefix | Type           |
| ------ | -------------- |
| FR     | functional     |
| NFR    | non_functional |
| IR     | interface      |
| DR     | data           |
| CON    | constraint     |
| SEC    | security       |
| PERF   | performance    |
| REL    | reliability    |
| UX     | usability      |
| MAINT  | maintainability |
| OPS    | operational    |
| COMP   | compliance     |
| OBS    | observability  |
| MIG    | migration      |

## 9.4 요구사항

| ID        | 요구사항                                                                |
| --------- | ------------------------------------------------------------------- |
| FR-ID-001 | 시스템은 requirement type에 따라 기본 prefix를 결정해야 한다.                       |
| FR-ID-002 | 시스템은 scope id로부터 ID segment를 생성할 수 있어야 한다.                          |
| FR-ID-003 | 시스템은 같은 prefix/project/scope 조합에서 가장 큰 sequence를 찾아 다음 ID를 생성해야 한다. |
| FR-ID-004 | 시스템은 자동 생성된 ID를 생성 전 preview할 수 있어야 한다.                             |
| FR-ID-005 | 시스템은 ID 충돌 시 자동으로 다음 sequence를 시도해야 한다.                             |
| FR-ID-006 | 시스템은 사용자가 `--id`를 명시한 경우 자동 생성보다 명시 ID를 우선해야 한다.                    |
| FR-ID-007 | 시스템은 문서 ID와 requirement ID를 서로 다른 namespace로 관리해야 한다.               |
| FR-ID-008 | 시스템은 requirement ID 자동 생성 시 보완 결정 문서의 prefix, project segment, scope segment, sequence 규칙을 따라야 한다. |

---

# 10. Relation 및 Link 요구사항

## 10.1 Relation Type

시스템은 requirement 간 relation으로 다음 타입을 지원해야 한다.

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

## 10.2 문서 Link Type

시스템은 문서 간 link로 다음 타입을 지원해야 한다.

```text
relates_to
refines
supersedes
depends_on
documents
implements
references
```

## 10.3 요구사항

| ID          | 요구사항                                                               |
| ----------- | ------------------------------------------------------------------ |
| FR-REL-001  | 시스템은 requirement relation target이 존재하는지 검증해야 한다.                   |
| FR-REL-002  | 시스템은 requirement가 자기 자신을 relation target으로 참조하는 것을 오류로 처리해야 한다.    |
| FR-REL-003  | 시스템은 `depends_on` relation graph에서 cycle을 탐지해야 한다.                 |
| FR-REL-004  | 시스템은 `duplicates` relation을 중복 후보 표시와 연결해야 한다.                     |
| FR-REL-005  | 시스템은 `conflicts_with` relation을 impact 및 export 결과에 포함할 수 있어야 한다.  |
| FR-REL-006  | 시스템은 특정 requirement의 incoming/outgoing relation을 조회할 수 있어야 한다.     |
| FR-REL-007  | 시스템은 특정 requirement 변경 시 영향을 받을 수 있는 requirement 목록을 계산할 수 있어야 한다. |
| FR-LINK-001 | 시스템은 `index.yaml`의 문서 link source와 target이 존재하는지 검증해야 한다.          |
| FR-LINK-002 | 시스템은 문서 link graph를 구성해야 한다.                                       |
| FR-LINK-003 | 시스템은 문서 link graph를 CLI와 MCP에서 조회할 수 있어야 한다.                       |

---

# 11. PRD 문서 요구사항

PRD는 v1에서 원본 문서 타입으로 지원하되, 제품 목표와 요구사항 근거를 저장하는 보조 문서로 취급한다.

## 11.1 예시 구조

```yaml
schemaVersion: speckiwi/prd/v1

id: prd.spec-context
type: prd
title: Spec Context PRD
status: active

items:
  - id: PRD-001
    type: problem
    title: 요구사항 문서 폭증
    body: >
      SDD 프로젝트에서 PRD/SRS/기술 문서가 빠르게 증가하여
      AI 에이전트가 정확한 맥락을 찾기 어렵다.
```

## 11.2 PRD Item Type

```text
problem
goal
persona
scenario
feature
constraint
metric
risk
decision
open_question
```

## 11.3 요구사항

| ID         | 요구사항                                                     |
| ---------- | -------------------------------------------------------- |
| FR-PRD-001 | 시스템은 PRD 문서를 로드하고 검증할 수 있어야 한다.                          |
| FR-PRD-002 | 시스템은 PRD item을 검색 대상으로 포함해야 한다.                          |
| FR-PRD-003 | 시스템은 PRD item과 SRS requirement 간 relation을 표현할 수 있어야 한다. |
| FR-PRD-004 | 시스템은 PRD 문서를 Markdown으로 export할 수 있어야 한다.                |
| FR-PRD-005 | 시스템은 PRD item `id`가 해당 PRD 문서 내에서 유일한지 검증해야 한다.          |

---

# 12. Technical 문서 요구사항

## 12.1 책임

Technical 문서는 SRS requirement를 구현 관점에서 구체화하는 기술 설계 문서로 사용된다.

## 12.2 요구사항

| ID          | 요구사항                                                   |
| ----------- | ------------------------------------------------------ |
| FR-TECH-001 | 시스템은 technical 문서를 로드하고 검증할 수 있어야 한다.                  |
| FR-TECH-002 | 시스템은 technical 문서를 검색 대상으로 포함해야 한다.                    |
| FR-TECH-003 | 시스템은 technical 문서가 관련 SRS requirement를 참조할 수 있게 해야 한다. |
| FR-TECH-004 | 시스템은 technical 문서를 Markdown으로 export할 수 있어야 한다.        |
| FR-TECH-005 | 시스템은 technical 문서 내 section id를 검색 결과에 포함할 수 있어야 한다.   |

---

# 13. ADR 문서 요구사항

## 13.1 책임

ADR 문서는 아키텍처 의사결정을 기록한다.

## 13.2 ADR 상태

```text
proposed
accepted
superseded
deprecated
rejected
```

## 13.3 요구사항

| ID         | 요구사항                                     |
| ---------- | ---------------------------------------- |
| FR-ADR-001 | 시스템은 ADR 문서를 로드하고 검증할 수 있어야 한다.          |
| FR-ADR-002 | 시스템은 ADR 상태를 enum으로 검증해야 한다.             |
| FR-ADR-003 | 시스템은 ADR이 다른 ADR을 supersede할 수 있게 해야 한다. |
| FR-ADR-004 | 시스템은 ADR을 검색 대상으로 포함해야 한다.               |
| FR-ADR-005 | 시스템은 ADR을 Markdown으로 export할 수 있어야 한다.   |

---

# 14. Dictionary 요구사항

## 14.1 책임

`dictionary.yaml`은 검색 품질 향상을 위한 동의어, 용어, 정규화 규칙을 제공해야 한다.

## 14.2 예시 구조

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
    - 소프트웨어 요구사항 명세

  state-transition:
    - 상태 전이
    - 상태전이
    - state transition

  jsonrpc:
    - JSON-RPC
    - json rpc
    - jsonrpc
```

## 14.3 요구사항

| ID          | 요구사항                                              |
| ----------- | ------------------------------------------------- |
| FR-DICT-001 | 시스템은 `.speckiwi/dictionary.yaml`을 로드할 수 있어야 한다.   |
| FR-DICT-002 | 시스템은 dictionary가 없어도 기본 검색을 수행할 수 있어야 한다.         |
| FR-DICT-003 | 시스템은 `synonyms`를 검색 query expansion에 사용해야 한다.     |
| FR-DICT-004 | 시스템은 dictionary 변경 시 search cache를 stale 처리해야 한다. |
| FR-DICT-005 | 시스템은 dictionary entry가 순환 참조를 만들지 않도록 처리해야 한다.    |

---

# 15. 검색 요구사항

## 15.1 검색 모드

시스템은 다음 검색 모드를 지원해야 한다.

```text
auto
exact
bm25
```

v1에서 vector search는 필수 기능이 아니다.

## 15.2 검색 대상

시스템은 다음 엔티티를 검색 대상으로 포함해야 한다.

```text
document
scope
requirement
prd_item
technical_section
adr
rule
```

## 15.3 검색 인덱싱

| ID          | 요구사항                                                                                          |
| ----------- | --------------------------------------------------------------------------------------------- |
| FR-SRCH-001 | 시스템은 YAML 문서를 검색용 flat document로 변환해야 한다.                                                     |
| FR-SRCH-002 | 시스템은 requirement id, document id, scope id를 exact index에 등록해야 한다.                             |
| FR-SRCH-003 | 시스템은 title, statement, rationale, description, tags, acceptanceCriteria를 BM25 index에 포함해야 한다. |
| FR-SRCH-004 | 시스템은 field별 boost를 적용해야 한다.                                                                   |
| FR-SRCH-005 | 시스템은 query가 exact id와 일치할 경우 exact result를 우선 반환해야 한다.                                        |
| FR-SRCH-006 | 시스템은 검색 결과에 score, matchedFields, entityType, id, title, path를 포함해야 한다.                       |
| FR-SRCH-007 | 시스템은 검색 결과를 `--json` 또는 MCP 응답에서 JSON으로 반환해야 한다.                                              |
| FR-SRCH-008 | 시스템은 scope, type, status, tag 기준 필터를 지원해야 한다.                                                 |
| FR-SRCH-009 | 시스템은 cache가 stale인 경우 검색 전 자동 재생성하거나 stale warning을 반환해야 한다.                                  |

## 15.4 Field Boost 기본값

| Field              | Boost |
| ------------------ | ----: |
| id                 |    10 |
| title              |     6 |
| tags               |     5 |
| scope              |     4 |
| statement          |     3 |
| acceptanceCriteria |     2 |
| rationale          |     1 |
| description        |     1 |

## 15.5 한글 Tokenizer 요구사항

| ID        | 요구사항                                                                       |
| --------- | -------------------------------------------------------------------------- |
| FR-KR-001 | 시스템은 한글 chunk에 대해 원문 token을 유지해야 한다.                                       |
| FR-KR-002 | 시스템은 한글 chunk에 대해 2-gram token을 생성해야 한다.                                   |
| FR-KR-003 | 시스템은 한글 chunk에 대해 3-gram token을 생성해야 한다.                                   |
| FR-KR-004 | 시스템은 한 글자 한글 token을 기본적으로 제외해야 한다.                                         |
| FR-KR-005 | 시스템은 영문 token을 lowercase 처리해야 한다.                                          |
| FR-KR-006 | 시스템은 kebab-case, snake_case, camelCase를 분리해야 한다.                           |
| FR-KR-007 | 시스템은 `JSON-RPC`, `json rpc`, `jsonrpc` 같은 변형을 dictionary로 보정할 수 있어야 한다.    |
| FR-KR-008 | 시스템은 형태소 분석기를 기본 의존성으로 요구하지 않아야 한다.                                        |
| FR-KR-009 | 시스템은 향후 optional tokenizer plugin을 추가할 수 있도록 tokenizer interface를 분리해야 한다. |

## 15.6 검색 결과 JSON 예시

```json
{
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

---

# 16. Graph 요구사항

## 16.1 Graph 구성 대상

시스템은 다음 graph를 구성해야 한다.

```text
document graph
scope graph
requirement relation graph
dependency graph
traceability graph
```

## 16.2 요구사항

| ID           | 요구사항                                                                |
| ------------ | ------------------------------------------------------------------- |
| FR-GRAPH-001 | 시스템은 `index.yaml`의 scopes로 scope tree를 구성해야 한다.                     |
| FR-GRAPH-002 | 시스템은 document와 scope 간 매핑을 구성해야 한다.                                 |
| FR-GRAPH-003 | 시스템은 requirement와 document 간 매핑을 구성해야 한다.                           |
| FR-GRAPH-004 | 시스템은 requirement relation graph를 구성해야 한다.                           |
| FR-GRAPH-005 | 시스템은 document link graph를 구성해야 한다.                                  |
| FR-GRAPH-006 | 시스템은 특정 requirement의 upstream dependency를 조회할 수 있어야 한다.             |
| FR-GRAPH-007 | 시스템은 특정 requirement의 downstream impacted requirement를 조회할 수 있어야 한다. |
| FR-GRAPH-008 | 시스템은 graph를 JSON으로 출력할 수 있어야 한다.                                    |
| FR-GRAPH-009 | 시스템은 graph cache를 `.speckiwi/cache/graph.json`에 저장할 수 있어야 한다.       |
| FR-GRAPH-010 | 시스템은 graph JSON 출력에 deterministic `nodes[]`, `edges[]`, `diagnostics`를 포함하는 GraphResult DTO를 사용해야 한다. |
| FR-GRAPH-011 | 시스템은 requirement trace 출력에 `direction`, `depth`, `nodes[]`, `edges[]`, `diagnostics`를 포함하는 TraceResult DTO를 사용해야 한다. |

---

# 17. Validation 요구사항

## 17.1 Diagnostics 모델

시스템은 validation 결과를 다음 구조로 표현해야 한다.

```json
{
  "ok": false,
  "valid": false,
  "diagnostics": {
    "errors": [
      {
        "code": "DUPLICATE_REQUIREMENT_ID",
        "message": "Duplicate requirement id: FR-AGK-LOOP-0001",
        "path": ".speckiwi/srs/agent-kernel.loop.yaml",
        "line": 12,
        "severity": "error"
      }
    ],
    "warnings": [],
    "infos": [],
    "summary": {
      "errorCount": 1,
      "warningCount": 0,
      "infoCount": 0
    }
  }
}
```

## 17.2 Error 조건

다음 조건은 error로 처리해야 한다.

| ID          | 조건                                  |
| ----------- | ----------------------------------- |
| VAL-ERR-001 | `.speckiwi/index.yaml` 없음           |
| VAL-ERR-002 | `.speckiwi/overview.yaml` 없음        |
| VAL-ERR-003 | YAML parse 실패                       |
| VAL-ERR-004 | schemaVersion 누락                    |
| VAL-ERR-005 | schemaVersion 불일치                   |
| VAL-ERR-006 | document id 중복                      |
| VAL-ERR-007 | requirement id 중복                   |
| VAL-ERR-008 | index에 등록된 path가 존재하지 않음            |
| VAL-ERR-009 | 존재하지 않는 document link 참조            |
| VAL-ERR-010 | 존재하지 않는 requirement relation target |
| VAL-ERR-011 | 잘못된 requirement type                |
| VAL-ERR-012 | 잘못된 requirement status              |
| VAL-ERR-013 | scope parent cycle                  |
| VAL-ERR-014 | YAML merge key 사용                   |
| VAL-ERR-015 | `.speckiwi/` 외부 path 참조             |
| VAL-ERR-016 | YAML anchor 사용                       |
| VAL-ERR-017 | YAML alias 사용                        |
| VAL-ERR-018 | 닫힌 schema object의 미정의 필드             |
| VAL-ERR-019 | `metadata`가 object가 아님               |
| VAL-ERR-020 | 잘못된 JSON Pointer 또는 patch operation |
| VAL-ERR-021 | content YAML이 index에 등록되지 않음         |
| VAL-ERR-022 | index document entry와 실제 YAML id/type/schemaVersion 불일치 |

## 17.3 Warning 조건

다음 조건은 warning으로 처리해야 한다.

| ID           | 조건                                   |
| ------------ | ------------------------------------ |
| VAL-WARN-001 | requirement에 `acceptanceCriteria` 없음 |
| VAL-WARN-002 | requirement에 `rationale` 없음          |
| VAL-WARN-003 | optional document link target 누락     |
| VAL-WARN-004 | cache stale                          |
| VAL-WARN-005 | 단일 YAML 문서가 설정된 크기 임계값 초과            |
| VAL-WARN-006 | `depends_on` cycle 의심                |
| VAL-WARN-007 | dictionary에 사용되지 않는 synonym entry 존재 |
| VAL-WARN-008 | 검색 대상 text가 비어 있음                    |

## 17.4 요구사항

| ID         | 요구사항                                                       |
| ---------- | ---------------------------------------------------------- |
| FR-VAL-001 | 시스템은 `speckiwi validate` 명령을 제공해야 한다.                      |
| FR-VAL-002 | 시스템은 validation 결과를 사람이 읽기 쉬운 형식으로 출력해야 한다.                |
| FR-VAL-003 | 시스템은 `--json` 옵션에서 validation 결과를 JSON으로 출력해야 한다.          |
| FR-VAL-004 | 시스템은 MCP tool `speckiwi_validate`로 validation 결과를 반환해야 한다. |
| FR-VAL-005 | 시스템은 apply 작업 전 validation을 수행해야 한다.                       |
| FR-VAL-006 | 시스템은 validation error가 존재할 경우 apply 작업을 중단해야 한다.           |
| FR-VAL-007 | 시스템은 warning만 존재하는 경우 apply를 허용할 수 있어야 한다.                 |

---

# 18. Cache 요구사항

## 18.1 Cache 파일

시스템은 다음 cache 파일을 생성할 수 있어야 한다.

```text
.speckiwi/cache/graph.json
.speckiwi/cache/search-index.json
.speckiwi/cache/diagnostics.json
.speckiwi/cache/manifest.json
```

## 18.2 Cache 무효화 기준

시스템은 다음 변경을 cache invalidation 조건으로 사용해야 한다.

```text
index.yaml hash 변경
overview.yaml hash 변경
dictionary.yaml hash 변경
문서 YAML hash 변경
schemaVersion 변경
speckiwi package version 변경
search settings 변경
```

## 18.3 요구사항

| ID           | 요구사항                                           |
| ------------ | ---------------------------------------------- |
| FR-CACHE-001 | 시스템은 cache 없이도 모든 기능을 수행할 수 있어야 한다.            |
| FR-CACHE-002 | 시스템은 cache를 원본 데이터로 취급하지 않아야 한다.               |
| FR-CACHE-003 | 시스템은 `speckiwi cache rebuild` 명령을 제공해야 한다.     |
| FR-CACHE-004 | 시스템은 `speckiwi cache clean` 명령을 제공해야 한다.       |
| FR-CACHE-005 | 시스템은 cache stale 여부를 감지해야 한다.                  |
| FR-CACHE-006 | 시스템은 stale cache를 자동 재생성할 수 있어야 한다.            |
| FR-CACHE-007 | 시스템은 cache 재생성 실패 시 원본 YAML 기반으로 degrade해야 한다. |
| FR-CACHE-008 | 시스템은 cache manifest에 입력 파일 hash를 저장해야 한다.      |

---

# 19. Agent Write Policy 요구사항

## 19.1 Write Mode

시스템은 다음 write mode를 지원해야 한다.

```text
propose
apply
```

## 19.2 기본 정책

기본값은 다음과 같아야 한다.

```yaml
agent:
  defaultWriteMode: propose
  allowApply: true
```

## 19.3 Proposal 파일

변경 제안은 `.speckiwi/proposals/`에 저장되어야 한다.

예:

```text
.speckiwi/proposals/2026-04-28T091500.update.FR-AGK-LOOP-0001.yaml
```

## 19.4 Proposal 구조

```yaml
schemaVersion: speckiwi/proposal/v1

id: proposal.2026-04-28T091500.update.FR-AGK-LOOP-0001
type: proposal
status: proposed
operation: update_requirement

target:
  kind: requirement
  requirementId: FR-AGK-LOOP-0001
  documentId: srs.agent-kernel.loop

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

changes:
  - op: replace
    path: /requirements/0/statement
    value: >
      에이전트 커널은 LLM 응답 타입과 tool_call 여부에 따라 상태를 전이해야 한다.

reason: >
  기존 statement가 tool_call 조건을 충분히 구체화하지 못한다.
```

## 19.5 요구사항

| ID           | 요구사항                                                        |
| ------------ | ----------------------------------------------------------- |
| FR-WRITE-001 | 시스템은 agent write 기본 모드를 `propose`로 설정해야 한다.                 |
| FR-WRITE-002 | 시스템은 propose 모드에서 원본 YAML을 수정하지 않아야 한다.                     |
| FR-WRITE-003 | 시스템은 propose 모드에서 proposal YAML 파일을 생성해야 한다.                |
| FR-WRITE-004 | 시스템은 apply 모드에서 원본 YAML을 수정할 수 있어야 한다.                      |
| FR-WRITE-005 | 시스템은 apply 전 validation을 수행해야 한다.                           |
| FR-WRITE-006 | 시스템은 validation error가 있으면 apply를 중단해야 한다.                  |
| FR-WRITE-007 | 시스템은 apply 시 임시 파일 작성 후 atomic rename 방식으로 저장해야 한다.         |
| FR-WRITE-008 | 시스템은 apply 전 대상 파일의 백업 또는 rollback 가능한 임시 사본을 생성할 수 있어야 한다. |
| FR-WRITE-009 | 시스템은 apply 후 cache를 stale 처리해야 한다.                          |
| FR-WRITE-010 | 시스템은 MCP tool에서 destructive write를 기본적으로 수행하지 않아야 한다.       |
| FR-WRITE-011 | 시스템은 `allowApply: false` 설정에서 apply 요청을 거부해야 한다.            |

---

# 20. CLI 요구사항

## 20.1 기본 명령

시스템은 다음 CLI 명령을 제공해야 한다.

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
speckiwi impact <requirement-id>
speckiwi export markdown
speckiwi cache rebuild
speckiwi cache clean
speckiwi mcp
```

## 20.2 공통 옵션

```text
--root <path>
--json
--no-cache
--offset <n>
--verbose
--quiet
```

## 20.3 요구사항

| ID         | 요구사항                                                      |
| ---------- | --------------------------------------------------------- |
| FR-CLI-001 | 시스템은 `speckiwi` 실행 파일을 제공해야 한다.                           |
| FR-CLI-002 | 시스템은 `npm install -g speckiwi` 방식의 전역 설치를 지원해야 한다.        |
| FR-CLI-003 | CLI는 현재 디렉토리 기준 workspace root를 자동 탐색해야 한다.               |
| FR-CLI-004 | CLI는 `--root` 옵션을 지원해야 한다.                                |
| FR-CLI-005 | CLI는 사람이 읽기 쉬운 기본 출력을 제공해야 한다.                            |
| FR-CLI-006 | CLI는 `--json` 옵션에서 machine-readable JSON을 출력해야 한다.        |
| FR-CLI-007 | CLI는 실패 시 non-zero exit code를 반환해야 한다.                    |
| FR-CLI-008 | CLI는 validation error 발생 시 error code를 출력해야 한다.           |
| FR-CLI-009 | CLI는 requirement 조회를 ID exact match로 수행할 수 있어야 한다.        |
| FR-CLI-010 | CLI는 search 결과를 score 순으로 정렬해야 한다.                        |
| FR-CLI-011 | CLI는 apply 작업 전 사용자 확인 또는 명시적 `--apply` 옵션을 요구할 수 있어야 한다. |
| FR-CLI-012 | CLI는 stdout에 결과를 출력하고, diagnostic log는 stderr에 출력해야 한다.   |

---

# 21. MCP 요구사항

## 21.1 실행 방식

시스템은 다음 명령으로 stdio MCP 프로세스를 실행할 수 있어야 한다.

```bash
speckiwi mcp --root /absolute/path/to/project
```

## 21.2 MCP Tools

시스템은 다음 MCP tools를 제공해야 한다.

```text
speckiwi_overview
speckiwi_list_documents
speckiwi_read_document
speckiwi_search
speckiwi_get_requirement
speckiwi_list_requirements
speckiwi_preview_requirement_id
speckiwi_trace_requirement
speckiwi_graph
speckiwi_impact
speckiwi_validate
speckiwi_propose_change
speckiwi_apply_change
```

## 21.3 MCP Resources

시스템은 다음 MCP resources를 제공해야 한다.

```text
speckiwi://overview
speckiwi://index
speckiwi://documents/{id}
speckiwi://requirements/{id}
speckiwi://scopes/{id}
```

## 21.4 Tool 요구사항

| ID         | Tool                         | 요구사항                                            |
| ---------- | ---------------------------- | ----------------------------------------------- |
| FR-MCP-001 | `speckiwi_overview`          | 프로젝트 overview를 반환해야 한다.                         |
| FR-MCP-002 | `speckiwi_list_documents`    | 문서 목록을 반환해야 한다.                                 |
| FR-MCP-003 | `speckiwi_read_document`     | document id 기준으로 문서를 반환해야 한다.                   |
| FR-MCP-004 | `speckiwi_search`            | query, mode, filters, limit을 받아 검색 결과를 반환해야 한다. |
| FR-MCP-005 | `speckiwi_get_requirement`   | requirement id 기준으로 단일 requirement를 반환해야 한다.    |
| FR-MCP-006 | `speckiwi_list_requirements` | 필터 조건에 맞는 requirement 목록을 반환해야 한다.              |
| FR-MCP-007 | `speckiwi_preview_requirement_id` | requirement ID preview를 원본 수정 없이 반환해야 한다. |
| FR-MCP-008 | `speckiwi_trace_requirement` | requirement relation graph를 반환해야 한다.            |
| FR-MCP-009 | `speckiwi_graph`             | graphType 기준 GraphResult를 반환해야 한다.              |
| FR-MCP-010 | `speckiwi_impact`            | 변경 영향 범위를 반환해야 한다.                              |
| FR-MCP-011 | `speckiwi_validate`          | validation diagnostics를 반환해야 한다.                |
| FR-MCP-012 | `speckiwi_propose_change`    | 원본 수정 없이 proposal을 생성해야 한다.                     |
| FR-MCP-013 | `speckiwi_apply_change`      | 설정과 validation이 허용할 때만 원본 YAML을 수정해야 한다.        |

## 21.5 MCP Transport 요구사항

| ID            | 요구사항                                                 |
| ------------- | ---------------------------------------------------- |
| FR-MCP-TR-001 | MCP 프로세스는 stdio transport를 사용해야 한다.                  |
| FR-MCP-TR-002 | MCP 프로세스는 protocol message 외의 로그를 stdout에 쓰지 않아야 한다. |
| FR-MCP-TR-003 | MCP 프로세스의 log는 stderr 또는 파일로 출력해야 한다.                |
| FR-MCP-TR-004 | MCP 프로세스는 HTTP port를 열지 않아야 한다.                      |
| FR-MCP-TR-005 | MCP 프로세스는 workspace root 밖의 파일을 읽거나 쓰지 않아야 한다.       |
| FR-MCP-TR-006 | MCP tool `structuredContent`에 들어가는 Core DTO는 JSON-compatible object여야 한다. |

---

# 22. Markdown Export 요구사항

## 22.1 Export 정책

Markdown은 사람이 읽기 위한 산출물이다.

```text
YAML → Markdown export 허용
Markdown → YAML import v1 제외
Markdown 수정 → YAML 반영 안 됨
```

## 22.2 기본 export 위치

```text
.speckiwi/exports/
```

## 22.3 요구사항

| ID         | 요구사항                                             |
| ---------- | ------------------------------------------------ |
| FR-EXP-001 | 시스템은 `speckiwi export markdown` 명령을 제공해야 한다.     |
| FR-EXP-002 | 시스템은 overview 문서를 Markdown으로 export할 수 있어야 한다.   |
| FR-EXP-003 | 시스템은 SRS 문서를 scope별 Markdown으로 export할 수 있어야 한다. |
| FR-EXP-004 | 시스템은 PRD 문서를 Markdown으로 export할 수 있어야 한다.        |
| FR-EXP-005 | 시스템은 technical 문서를 Markdown으로 export할 수 있어야 한다.  |
| FR-EXP-006 | 시스템은 ADR 문서를 Markdown으로 export할 수 있어야 한다.        |
| FR-EXP-007 | 시스템은 export index Markdown을 생성할 수 있어야 한다.        |
| FR-EXP-008 | export index는 문서별 링크를 포함해야 한다.                   |
| FR-EXP-009 | export 결과는 원본으로 취급되지 않아야 한다.                     |
| FR-EXP-010 | 시스템은 export 전 validation을 수행할 수 있어야 한다.          |
| FR-EXP-011 | 시스템은 export 결과 파일 목록을 출력해야 한다.                   |
| FR-EXP-012 | 시스템은 export 결과 파일 목록을 JSON으로 출력할 수 있어야 한다.       |

---

# 23. Doctor 요구사항

## 23.1 책임

`doctor`는 실행 환경과 workspace 상태를 점검해야 한다.

## 23.2 요구사항

| ID             | 요구사항                                           |
| -------------- | ---------------------------------------------- |
| FR-DOC-CHK-001 | 시스템은 Node.js 버전을 확인해야 한다.                      |
| FR-DOC-CHK-002 | 시스템은 `.speckiwi/` 존재 여부를 확인해야 한다.              |
| FR-DOC-CHK-003 | 시스템은 필수 파일 존재 여부를 확인해야 한다.                     |
| FR-DOC-CHK-004 | 시스템은 YAML parse 가능 여부를 확인해야 한다.                |
| FR-DOC-CHK-005 | 시스템은 cache 상태를 확인해야 한다.                        |
| FR-DOC-CHK-006 | 시스템은 MCP 실행 가능 여부를 확인해야 한다.                    |
| FR-DOC-CHK-007 | 시스템은 stdout/stderr 사용 정책 위반 가능성을 점검해야 한다.      |
| FR-DOC-CHK-008 | 시스템은 결과를 사람이 읽기 쉬운 형식과 JSON 형식으로 출력할 수 있어야 한다. |

---

# 24. 보안 요구사항

| ID          | 요구사항                                                    |
| ----------- | ------------------------------------------------------- |
| NFR-SEC-001 | 시스템은 기본 동작에서 네트워크 포트를 열지 않아야 한다.                        |
| NFR-SEC-002 | 시스템은 HTTP 서버를 시작하지 않아야 한다.                              |
| NFR-SEC-003 | 시스템은 workspace root 밖의 파일을 기본적으로 읽지 않아야 한다.             |
| NFR-SEC-004 | 시스템은 workspace root 밖의 파일을 기본적으로 쓰지 않아야 한다.             |
| NFR-SEC-005 | 시스템은 path traversal 입력을 거부해야 한다.                        |
| NFR-SEC-006 | 시스템은 proposal/apply 대상 path가 `.speckiwi/` 내부인지 검증해야 한다. |
| NFR-SEC-007 | 시스템은 환경변수 값을 YAML 원본에 자동 저장하지 않아야 한다.                   |
| NFR-SEC-008 | 시스템은 MCP apply tool을 기본적으로 제한적으로 동작시켜야 한다.              |
| NFR-SEC-009 | 시스템은 destructive 작업에 대해 명시적 모드 또는 설정을 요구해야 한다.          |

---

# 25. 신뢰성 요구사항

| ID          | 요구사항                                                    |
| ----------- | ------------------------------------------------------- |
| NFR-REL-001 | 시스템은 YAML parse 실패 파일이 있어도 diagnostics를 반환해야 한다.        |
| NFR-REL-002 | 시스템은 하나의 문서 오류 때문에 전체 프로세스가 비정상 종료되지 않아야 한다.            |
| NFR-REL-003 | 시스템은 apply 작업 시 partial write를 남기지 않아야 한다.              |
| NFR-REL-004 | 시스템은 atomic write 전략을 사용해야 한다.                          |
| NFR-REL-005 | 시스템은 cache 파일 손상 시 cache를 삭제하고 재생성할 수 있어야 한다.           |
| NFR-REL-006 | 시스템은 search cache 생성 실패 시 YAML 직접 로드 방식으로 degrade해야 한다. |
| NFR-REL-007 | 시스템은 validation error를 deterministic하게 반환해야 한다.         |

---

# 26. 성능 요구사항

다음 성능 목표는 일반적인 로컬 개발 환경, Node.js 20 이상, SSD 기준으로 측정한다.

| ID           | 요구사항                                                                        |
| ------------ | --------------------------------------------------------------------------- |
| NFR-PERF-001 | 10,000개 requirement 기준 exact lookup은 50ms 이내를 목표로 해야 한다.                    |
| NFR-PERF-002 | 10,000개 requirement 기준 cache 기반 검색은 500ms 이내를 목표로 해야 한다.                    |
| NFR-PERF-003 | 10,000개 requirement 기준 cache rebuild는 10초 이내를 목표로 해야 한다.                    |
| NFR-PERF-004 | 1,000개 YAML 문서 기준 validation은 10초 이내를 목표로 해야 한다.                            |
| NFR-PERF-005 | MCP tool 단일 호출은 정상 cache 상태에서 1초 이내 응답을 목표로 해야 한다.                          |
| NFR-PERF-006 | 시스템은 대형 workspace에서 필요한 파일만 재로드할 수 있도록 hash 기반 cache invalidation을 제공해야 한다. |

---

# 27. 호환성 요구사항

| ID           | 요구사항                                                       |
| ------------ | ---------------------------------------------------------- |
| NFR-COMP-001 | 시스템은 Node.js 20 이상에서 실행되어야 한다.                             |
| NFR-COMP-002 | 시스템은 macOS에서 실행되어야 한다.                                     |
| NFR-COMP-003 | 시스템은 Linux에서 실행되어야 한다.                                     |
| NFR-COMP-004 | 시스템은 Windows에서 실행 가능해야 한다.                                 |
| NFR-COMP-005 | 시스템은 ESM 기반 TypeScript 프로젝트로 구현되어야 한다.                     |
| NFR-COMP-006 | 시스템은 native dependency 없이 기본 기능을 설치할 수 있어야 한다.             |
| NFR-COMP-007 | 시스템은 Java, Python, database runtime을 기본 의존성으로 요구하지 않아야 한다. |

---

# 28. 유지보수성 요구사항

| ID            | 요구사항                                              |
| ------------- | ------------------------------------------------- |
| NFR-MAINT-001 | CLI Adapter와 MCP Adapter는 Core Service와 분리되어야 한다. |
| NFR-MAINT-002 | YAML Loader는 Schema Validator와 분리되어야 한다.          |
| NFR-MAINT-003 | Search Engine은 tokenizer interface를 분리해야 한다.      |
| NFR-MAINT-004 | BM25 구현은 교체 가능해야 한다.                              |
| NFR-MAINT-005 | Markdown Exporter는 template layer와 분리되어야 한다.      |
| NFR-MAINT-006 | schema 파일은 코드와 분리된 JSON Schema 파일로 관리되어야 한다.      |
| NFR-MAINT-007 | MCP tool schema는 TypeScript type과 동기화 가능해야 한다.    |
| NFR-MAINT-008 | Core Service는 CLI/MCP에 의존하지 않아야 한다.               |

---

# 29. 사용성 요구사항

| ID         | 요구사항                                                    |
| ---------- | ------------------------------------------------------- |
| NFR-UX-001 | CLI 기본 출력은 사람이 읽기 쉬워야 한다.                               |
| NFR-UX-002 | CLI `--json` 출력은 AI 에이전트가 안정적으로 파싱 가능해야 한다.             |
| NFR-UX-003 | validation error는 파일 path와 가능한 경우 line/column을 포함해야 한다. |
| NFR-UX-004 | search 결과는 score와 matchedFields를 포함해야 한다.               |
| NFR-UX-005 | requirement 조회 결과는 원본 파일 path를 포함해야 한다.                 |
| NFR-UX-006 | proposal 생성 결과는 proposal 파일 path를 포함해야 한다.              |
| NFR-UX-007 | apply 실패 시 실패 원인과 복구 방법을 출력해야 한다.                       |
| NFR-UX-008 | init 결과물은 사용자가 바로 편집 가능한 YAML이어야 한다.                    |

---

# 30. 패키지 구조 요구사항

## 30.1 권장 패키지 구조

```text
speckiwi/
├─ package.json
├─ tsconfig.json
├─ bin/
│  └─ speckiwi
├─ src/
│  ├─ cli/
│  ├─ mcp/
│  ├─ core/
│  ├─ io/
│  ├─ schema/
│  ├─ search/
│  ├─ graph/
│  ├─ validate/
│  ├─ export/
│  └─ write/
└─ schemas/
   ├─ index.schema.json
   ├─ overview.schema.json
   ├─ dictionary.schema.json
   ├─ srs.schema.json
   ├─ prd.schema.json
   ├─ technical.schema.json
   ├─ adr.schema.json
   ├─ rule.schema.json
   └─ proposal.schema.json
```

## 30.2 요구사항

| ID         | 요구사항                                      |
| ---------- | ----------------------------------------- |
| FR-PKG-001 | 패키지는 `speckiwi` CLI binary를 제공해야 한다.      |
| FR-PKG-002 | 패키지는 `speckiwi mcp` subcommand를 제공해야 한다.  |
| FR-PKG-003 | 패키지는 core logic을 library module로 분리해야 한다. |
| FR-PKG-004 | 패키지는 JSON Schema 파일을 배포물에 포함해야 한다.        |
| FR-PKG-005 | 패키지는 TypeScript type definition을 제공해야 한다. |
| FR-PKG-006 | 패키지는 native dependency 없이 설치 가능해야 한다.     |

---

# 31. 수용 기준

SpecKiwi v1.0은 다음 조건을 만족해야 release 가능하다.

## 31.1 Core

* [ ] `.speckiwi/` workspace를 초기화할 수 있다.
* [ ] `index.yaml`을 로드하고 검증할 수 있다.
* [ ] `overview.yaml`을 로드하고 검증할 수 있다.
* [ ] SRS YAML 문서를 로드하고 검증할 수 있다.
* [ ] requirement ID 중복을 탐지할 수 있다.
* [ ] document link 오류를 탐지할 수 있다.
* [ ] requirement relation 오류를 탐지할 수 있다.
* [ ] graph를 구성할 수 있다.

## 31.2 Storage

* [ ] SQLite를 사용하지 않는다.
* [ ] DB 파일을 생성하지 않는다.
* [ ] YAML만으로 cache를 재생성할 수 있다.
* [ ] Markdown export 결과를 원본으로 취급하지 않는다.

## 31.3 CLI

* [ ] `speckiwi init`이 동작한다.
* [ ] `speckiwi validate`가 동작한다.
* [ ] `speckiwi search`가 동작한다.
* [ ] `speckiwi req get <id>`가 동작한다.
* [ ] `speckiwi list docs`가 동작한다.
* [ ] `speckiwi list reqs`가 동작한다.
* [ ] `speckiwi export markdown`이 동작한다.
* [ ] 모든 주요 명령은 `--json` 출력을 지원한다.

## 31.4 MCP

* [ ] `speckiwi mcp --root <path>`가 stdio MCP 프로세스로 실행된다.
* [ ] MCP가 stdout에 protocol message 외 로그를 쓰지 않는다.
* [ ] `speckiwi_overview` tool이 동작한다.
* [ ] `speckiwi_search` tool이 동작한다.
* [ ] `speckiwi_get_requirement` tool이 동작한다.
* [ ] `speckiwi_validate` tool이 동작한다.
* [ ] `speckiwi_propose_change` tool이 원본을 수정하지 않고 proposal을 생성한다.
* [ ] `speckiwi_apply_change` tool은 설정과 validation이 허용할 때만 원본을 수정한다.

## 31.5 Search

* [ ] requirement ID exact search가 동작한다.
* [ ] document ID exact search가 동작한다.
* [ ] BM25 검색이 동작한다.
* [ ] 한글 2-gram/3-gram tokenizer가 동작한다.
* [ ] `dictionary.yaml` synonym expansion이 동작한다.
* [ ] search 결과에 score와 matchedFields가 포함된다.
* [ ] search cache를 rebuild할 수 있다.

## 31.6 Write Policy

* [ ] 기본 write mode는 `propose`다.
* [ ] propose mode는 원본 YAML을 수정하지 않는다.
* [ ] proposal 파일이 `.speckiwi/proposals/`에 생성된다.
* [ ] apply mode는 validation error가 없을 때만 원본 YAML을 수정한다.
* [ ] apply 후 cache가 stale 처리된다.

## 31.7 Export

* [ ] overview Markdown export가 가능하다.
* [ ] SRS scope별 Markdown export가 가능하다.
* [ ] export index Markdown이 생성된다.
* [ ] export 결과 파일 목록이 출력된다.
* [ ] export 결과는 원본으로 취급되지 않는다.

---

# 32. 최종 시스템 요구사항 요약

SpecKiwi v1.0은 다음 시스템이어야 한다.

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

이 SRS 기준으로 구현하면 SpecKiwi v1.0의 핵심은 다음 한 문장으로 고정된다.

```text
SpecKiwi v1.0 shall manage SDD context as repository-local YAML files and expose validated search, trace, proposal, and export capabilities through a Node.js CLI and stdio MCP interface without using a database.
```

---

# 33. 구현 준비성 보완 결정

SpecKiwi v1.0 구현 시 `speckiwi-v1-docs/12_IMPLEMENTATION_READINESS_DECISIONS.md`를 보완 결정 문서로 사용해야 한다.

해당 문서는 다음 결정을 고정한다.

```text
1. CLI JSON 출력과 MCP structuredContent는 동일 Core DTO를 사용한다.
2. 모든 diagnostics는 DiagnosticBag(errors, warnings, infos, summary) 구조를 사용한다.
3. v1 validator는 info diagnostic을 생성하지 않는다.
4. YAML anchor, alias, merge key는 모두 validation error다.
5. JSON Schema 객체는 기본 additionalProperties=false이며 metadata 하위만 확장 가능하다.
6. index.yaml은 content document가 아니라 workspace manifest다.
7. proposal은 schema-validated managed artifact이며 index document registry/search/graph/export 대상이 아니다.
8. template은 v1 YAML document type이 아니라 Markdown export asset이다.
9. metadata는 optional이며 있으면 object여야 한다.
10. JSON Schema는 draft 2020-12와 Ajv2020 strict mode를 사용한다.
11. schema 파일명은 document type 기준이며 technical.schema.json, dictionary.schema.json, rule.schema.json을 포함한다.
12. document status는 문서 타입별 enum으로 검증한다.
13. exact search score는 1.0이고 BM25 normalized score는 0.999 이하로 제한한다.
14. search 결과는 score, entityType priority, id, documentId, path 순으로 deterministic 정렬한다.
15. GraphResult, TraceResult, ImpactResult는 deterministic nodes/edges DTO를 사용한다.
16. impact 분석은 relation type별 traversal matrix를 따른다.
17. MCP는 speckiwi_graph tool로 GraphResult를 제공한다.
18. content YAML은 index.documents[] 등록 정보와 실제 id/type/schemaVersion이 일치해야 한다.
19. unregistered content YAML은 validation error다.
20. requirement ID 자동 생성은 보완 결정 문서의 prefix/project/scope/sequence 규칙을 따른다.
21. proposal은 kind 기반 target과 operation별 base.target 규칙을 사용한다.
22. proposal은 base documentHash와 RFC 8785 JCS 기반 targetHash를 필수로 포함한다.
23. stale proposal apply는 APPLY_REJECTED_STALE_PROPOSAL error로 거부한다.
24. JSON Patch는 RFC 6902 add/replace/remove subset이며 path는 document-root RFC 6901 JSON Pointer다.
25. impact public API는 v1에서 requirement ID 전용이다.
26. cache 기본 모드는 stale 자동 rebuild이며 --no-cache는 cache read/write를 모두 우회한다.
27. cache manifest는 graph/search/diagnostics/export section을 포함하고 wall-clock timestamp를 포함하지 않는다.
28. Markdown export 기본 모드는 non-strict best-effort이고 --strict는 validation error에서 쓰기 전 중단한다.
29. Markdown export 결과는 writtenFiles/skippedFiles typed item DTO를 사용하며 generated timestamp를 기본 포함하지 않는다.
30. Markdown export 대상 type은 overview, srs, prd, technical, adr로 제한한다.
31. CLI --root와 MCP process --root는 workspace root resolution 전용으로 absolute path를 허용하고, MCP tool input root override는 v1에서 거부한다.
```

기존 문서의 `오류 또는 경고`, `할 수 있다`, `가능` 표현이 위 결정과 충돌할 경우, 구현 계약은 위 보완 결정이 우선한다.
