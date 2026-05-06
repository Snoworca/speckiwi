# YAML_SCHEMA_SPEC — SpecKiwi v1 YAML 스키마 명세

## 1. 목적

SpecKiwi v1은 YAML을 원본 데이터 형식으로 사용하지만, 구조는 엄격하게 관리해야 한다. 이 문서는 각 YAML 문서 타입의 필드, enum, 제약, 예시를 정의한다.

구현 시 모호한 schema/validation 결정은 `12_IMPLEMENTATION_READINESS_DECISIONS.md`를 따른다.
해당 문서는 JSON Schema draft 2020-12, Ajv2020 strict mode, YAML parser option, YAML anchor/alias/merge key error, `additionalProperties: false`, metadata 확장, `index.yaml` manifest 예외, proposal artifact 정책, template asset 정책, 문서 타입별 status enum, PRD item link enum을 고정한다.

## 2. 공통 정책

### 2.1 공통 필드

`index.yaml`을 제외한 content document는 다음 공통 필드를 가져야 한다.
`metadata`는 optional extension slot이다.

```yaml
schemaVersion: speckiwi/<type>/v1
id: string
type: string
title: string
status: string
metadata: {} # optional
```

`index.yaml`은 workspace manifest이며 `id`, `type`, `title`, `status`를 요구하지 않는다.

### 2.1.1 Top-level Required Fields

Schema별 최소 필수 top-level field는 다음과 같다.

| Schema | Required fields |
|---|---|
| `index.schema.json` | `schemaVersion`, `project`, `documents` |
| `overview.schema.json` | `schemaVersion`, `id`, `type`, `title`, `status` |
| `dictionary.schema.json` | `schemaVersion`, `id`, `type`, `title`, `status` |
| `srs.schema.json` | `schemaVersion`, `id`, `type`, `scope`, `title`, `status`, `requirements` |
| `prd.schema.json` | `schemaVersion`, `id`, `type`, `title`, `status`, `items` |
| `technical.schema.json` | `schemaVersion`, `id`, `type`, `title`, `status`, `sections` |
| `adr.schema.json` | `schemaVersion`, `id`, `type`, `title`, `status`, `decision` |
| `rule.schema.json` | `schemaVersion`, `id`, `type`, `title`, `status`, `rules` |
| `proposal.schema.json` | `schemaVersion`, `id`, `type`, `status`, `operation`, `target`, `base`, `changes`, `reason` |

모든 object schema는 기본적으로 닫힌 구조다. 임의 확장은 `metadata` 하위 object에서만 허용한다. `metadata`가 있으면 object여야 하며 `null`은 오류다.

### 2.2 제한 YAML subset

금지 또는 제한:

```text
- YAML merge key: 금지
- anchor/alias: 오류
- 임의 필드 남발: 금지
- 확장 필드: metadata 하위만 허용
- 날짜 자동 파싱 의존: 금지
```

### 2.3 SchemaVersion

```text
speckiwi/index/v1
speckiwi/overview/v1
speckiwi/dictionary/v1
speckiwi/srs/v1
speckiwi/prd/v1
speckiwi/technical/v1
speckiwi/adr/v1
speckiwi/rule/v1
speckiwi/prose/v1
speckiwi/proposal/v1
```

`speckiwi/template/v1`은 v1 schemaVersion이 아니다. `.speckiwi/templates/*.md.tmpl`은 Markdown export용 asset으로만 취급한다.

## 3. `index.yaml`

### 3.1 구조

```yaml
schemaVersion: speckiwi/index/v1

project:
  id: string
  name: string
  language: ko | en | string

settings:
  agent:
    defaultWriteMode: propose | apply
    allowApply: boolean
  search:
    defaultMode: auto | exact | bm25
    koreanNgram:
      min: 2
      max: 3

documents:
  - id: string
    type: overview | prd | srs | technical | adr | rule | dictionary | prose
    path: string
    scope: string?
    title: string?
    tags: string[]?

scopes:
  - id: string
    parent: string?
    name: string
    type: module | submodule | feature | domain | component | package | conceptual | external_boundary
    description: string?
    tags: string[]?

links:
  - from: string
    to: string
    type: relates_to | refines | supersedes | depends_on | documents | implements | references
    description: string?
```

### 3.2 검증 규칙

```text
- project.id 필수
- project.name 필수
- documents[].id 중복 금지
- documents[]에 index, template, proposal 등록 금지
- documents[].path는 .speckiwi 내부 상대 경로
- documents[].path 실제 존재 필요
- scopes[].id 중복 금지
- scopes[].parent 존재 필요
- scope parent cycle 금지
- links[].from/to는 document id여야 함
- documents[].id는 실제 YAML top-level id와 일치해야 함
- documents[].type은 실제 YAML top-level type과 일치해야 함
- 실제 YAML schemaVersion은 `speckiwi/<documents[].type>/v1`과 일치해야 함
- content YAML은 index.documents[]에 등록되어야 함
```

## 4. `overview.yaml`

```yaml
schemaVersion: speckiwi/overview/v1

id: overview
type: overview
title: Project Overview
status: active

summary: string

goals:
  - id: G-001
    statement: string

nonGoals:
  - id: NG-001
    statement: string

glossary:
  - term: string
    definition: string

metadata: {}
```

검증 규칙:

```text
- id는 overview 권장
- summary는 검색 대상
- goals/nonGoals/glossary는 선택이지만 있으면 구조 검증
```

## 5. `dictionary.yaml`

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

normalizations:
  jsonrpc: json-rpc
  json rpc: json-rpc
  JSON-RPC: json-rpc
```

검증 규칙:

```text
- synonyms key는 string
- synonyms value는 string array
- 빈 synonym array 경고
- 순환 참조는 query expansion 시 중복 제거로 처리
```

## 6. `srs/*.yaml`

### 6.1 구조

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
      상태 전이 조건을 명확히 해야 구현과 테스트가 가능하다.
    description: string?
    acceptanceCriteria:
      - id: AC-001
        method: test
        description: LLM 응답이 tool_call이면 tool execution 단계로 전이한다.
    relations:
      - type: depends_on
        target: IR-LLM-STREAM-0001
        targetType: requirement       # requirement | document | external (default: requirement)
        anchor: string?               # 대상 안의 위치 (예: "#section-3", "L42")
        excerpt: string?              # 대상 본문 인용 슬라이스 (검색 인덱스 body에 합류)
        description: string?
    tags:
      - agent-loop
      - state-machine
    metadata: {}
```

### 6.2 Requirement Type

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

### 6.3 Requirement Status

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

### 6.4 Priority

```text
critical
high
medium
low
optional
```

### 6.5 Acceptance Method

```text
inspection
analysis
test
demonstration
review
```

### 6.6 Relation Type

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

### 6.7 검증 규칙

```text
- srs.scope는 index.scopes[].id에 존재해야 함
- requirement.id는 workspace 전체에서 유일해야 함
- requirement.statement 필수
- requirement.type/status enum 검증
- relation target은 targetType별로 검증:
    - requirement (기본): 등록된 requirement id 존재 검사
    - document: index.yaml documents에 등록된 document id 존재 검사
    - external: URI scheme prefix 형식만 검사. 외부 본문 존재 검사는 하지 않음
- self relation 금지 (targetType=requirement에서만 적용)
- depends_on cycle 탐지 (targetType=requirement만 cycle 분석에 포함)
- rationale 없음: warning
- acceptanceCriteria 없음: warning
```

## 7. `prd/*.yaml`

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
      SDD 프로젝트에서 문서가 증가하여 에이전트가 정확한 맥락을 찾기 어렵다.
    links:
      - type: derived_to
        target: FR-SKW-SRCH-0001
    tags:
      - context
```

PRD item type:

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

검증 규칙:

```text
- item.id는 문서 내 유일
- item.type enum 검증
- links target이 requirement id이면 존재 여부 검증
```

## 8. `tech/*.yaml`

```yaml
schemaVersion: speckiwi/technical/v1

id: tech.search-index-builder
type: technical
title: Search Index Builder Technical Design
status: active

scope: search

implements:
  - FR-SRCH-001
  - FR-SRCH-002

sections:
  - id: SEC-001
    title: Flatten Document Model
    body: >
      YAML 문서를 검색 가능한 flat document로 변환한다.
```

검증 규칙:

```text
- implements target은 requirement id일 수 있음
- sections[].id는 문서 내 유일
- sections[].body는 검색 대상
```

## 9. `adr/*.yaml`

```yaml
schemaVersion: speckiwi/adr/v1

id: adr.0001-local-yaml-storage
type: adr
title: Local YAML Storage
status: accepted

date: "2026-04-28"

decision: >
  SpecKiwi v1은 SQLite를 사용하지 않고 YAML 파일을 원본으로 사용한다.

context: >
  DB 서버 구조는 로컬 SDD context tool의 v1 목표에 비해 과하다.

consequences:
  - Git diff와 review가 쉬워진다.
  - 대규모 동시 편집 기능은 v1에서 제공하지 않는다.

supersedes: []
```

ADR status:

```text
proposed
accepted
superseded
deprecated
rejected
```

## 10. `rules/*.yaml`

```yaml
schemaVersion: speckiwi/rule/v1

id: rule.coding-agent-safe-write
type: rule
title: Coding Agent Safe Write Policy
status: active

rules:
  - id: RULE-001
    level: must
    statement: MCP apply는 validation error가 있을 때 원본 YAML을 수정하지 않아야 한다.
```

Rule level:

```text
must
should
may
must_not
should_not
```

## 10.5. `prose/*.yaml`

prose는 회의록·인터뷰·디자인 노트·외부 문서 인용 등 비정형 자료를 단일 Markdown body로 보관하는 문서 타입이다. body는 BM25 인덱싱 대상이며, SRS requirement에서 `relations[].targetType: document`로 참조할 수 있다.

```yaml
schemaVersion: speckiwi/prose/v1

id: prose.payment-flow-interview
type: prose
title: 결제 흐름 사용자 인터뷰
status: active
scope: payments.checkout       # optional

body: |
  ## 인터뷰 요약
  결제 실패 시 사용자는 ...

sources:                        # optional
  - kind: interview              # meeting | interview | external_url | imported | other
    uri: https://example.com/notes/2026-04-15
    title: 인터뷰 노트
    capturedAt: 2026-04-15
    description: 외부에서 가져온 원본 인터뷰 본문 링크

tags:
  - payments
metadata: {}
```

검증 규칙:

```text
- schemaVersion은 speckiwi/prose/v1
- type은 prose
- body 필수, 비어있는 문자열 거부
- title 필수
- status enum: draft | active | deprecated | archived
- scope는 optional이며 지정 시 index.scopes[].id에 존재해야 함
- additionalProperties: false (sources/metadata 제외)
```

## 11. `proposals/*.yaml`

Proposal YAML은 schema-validated managed artifact다. `index.yaml`의 `documents[]`에 등록하지 않으며 search/graph/export 대상도 아니다.

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
  targetHash: sha256:<jcs-canonical-target-json-hash>
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

Proposal operation:

```text
create_requirement
update_requirement
change_requirement_status
add_relation
remove_relation
update_document
```

Patch op:

```text
add
replace
remove
```

검증 규칙:

```text
- target.kind는 requirement, document, manifest 중 하나
- requirement target은 requirementId 또는 create 대상 scope/documentId를 포함해야 함
- document target은 documentId를 포함해야 함
- manifest target은 추가 id field를 포함하지 않음
- target requirement/document 존재 필요
- base 필수
- changes[].path는 JSON Pointer 형식
- changes[] operation object는 닫힌 object이며 op/path/value 외의 임의 필드를 거부
- apply 전 patch 결과 전체 validation 필요
```

### 11.1 하위 Object Field Matrix

모든 하위 object는 `additionalProperties: false`다. 필수/선택 필드는 다음 표를 따른다.

| Object | Required fields | Optional fields |
|---|---|---|
| `index.project` | `id`, `name` | `language` |
| `index.settings` | 없음 | `agent`, `search` |
| `index.settings.agent` | 없음 | `defaultWriteMode`, `allowApply` |
| `index.settings.search` | 없음 | `defaultMode`, `koreanNgram` |
| `index.settings.search.koreanNgram` | 없음 | `min`, `max` |
| `index.documents[]` | `id`, `type`, `path` | `scope`, `title`, `tags` |
| `index.scopes[]` | `id`, `name`, `type` | `parent`, `description`, `tags` |
| `index.links[]` | `from`, `to`, `type` | `description` |
| `overview.goals[]` | `id`, `statement` | 없음 |
| `overview.nonGoals[]` | `id`, `statement` | 없음 |
| `overview.glossary[]` | `term`, `definition` | 없음 |
| `dictionary.synonyms` entry | key와 string array value | 없음 |
| `dictionary.normalizations` entry | key와 string value | 없음 |
| `requirements[]` | `id`, `type`, `title`, `status`, `statement` | `priority`, `rationale`, `description`, `acceptanceCriteria`, `relations`, `tags`, `metadata` |
| `requirements[].acceptanceCriteria[]` | `id`, `method`, `description` | 없음 |
| `requirements[].relations[]` | `type`, `target` | `targetType`, `anchor`, `excerpt`, `description` |
| `prose` document | `schemaVersion`, `id`, `type`, `title`, `status`, `body` | `scope`, `tags`, `sources`, `metadata` |
| `prose.sources[]` | `kind` | `uri`, `title`, `capturedAt`, `description` |
| `prd.items[]` | `id`, `type`, `title`, `body` | `links`, `tags`, `metadata` |
| `prd.items[].links[]` | `type`, `target` | `targetType`, `description` |
| `technical.sections[]` | `id`, `title`, `body` | `metadata` |
| `adr.consequences[]` | string item | 없음 |
| `rules[]` | `id`, `level`, `statement` | `rationale`, `tags`, `metadata` |
| `proposal.target` | `kind` | `requirementId`, `documentId`, `scope` |
| `proposal.base` | `documentPath`, `target`, `documentHash`, `targetHash`, `schemaVersion`, `generatedAt` | `documentId` |
| `proposal.base.target requirement` | `entityType=requirement`, `jsonPointer` | `id` |
| `proposal.base.target document` | `entityType=document`, `id`, `jsonPointer` | 없음 |
| `proposal.base.target manifest` | `entityType=manifest`, `jsonPointer` | 없음 |
| `proposal.changes[] add/replace` | `op`, `path`, `value` | 없음 |
| `proposal.changes[] remove` | `op`, `path` | 없음 |
