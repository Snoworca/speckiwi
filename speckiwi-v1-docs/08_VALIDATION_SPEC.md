# VALIDATION_SPEC — SpecKiwi v1 검증 명세

## 1. 목적

SpecKiwi validation은 `.speckiwi/` YAML 원본이 구조적으로 올바르고, 문서/스코프/요구사항/관계 참조가 일관적인지 검증한다.

Diagnostics DTO, severity, warning threshold, cycle severity, deterministic ordering의 최종 결정은 `12_IMPLEMENTATION_READINESS_DECISIONS.md`를 따른다.

## 2. Diagnostics 모델

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
        "column": 7,
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

## 3. Severity

| Severity | 의미 | apply 가능 여부 |
|---|---|---|
| `error` | 구조/참조/정책 위반 | 불가 |
| `warning` | 품질 또는 잠재 문제 | 가능 |
| `info` | 참고 정보 | 가능 |

## 4. Error 조건

| Code | 조건 |
|---|---|
| `MISSING_INDEX` | `.speckiwi/index.yaml` 없음 |
| `MISSING_OVERVIEW` | `.speckiwi/overview.yaml` 없음 |
| `YAML_PARSE_ERROR` | YAML parse 실패 |
| `MISSING_SCHEMA_VERSION` | `schemaVersion` 누락 |
| `UNSUPPORTED_SCHEMA_VERSION` | 지원하지 않는 `schemaVersion` |
| `MISSING_DOCUMENT_ID` | 문서 `id` 누락 |
| `DUPLICATE_DOCUMENT_ID` | document id 중복 |
| `DUPLICATE_REQUIREMENT_ID` | requirement id 중복 |
| `MISSING_DOCUMENT_PATH` | index 문서 path 없음 |
| `DOCUMENT_PATH_NOT_FOUND` | index에 등록된 path가 존재하지 않음 |
| `UNREGISTERED_CONTENT_DOCUMENT` | content YAML이 index.documents[]에 등록되지 않음 |
| `DOCUMENT_ID_MISMATCH` | index.documents[].id와 실제 YAML id 불일치 |
| `DOCUMENT_TYPE_MISMATCH` | index.documents[].type과 실제 YAML type 불일치 |
| `SCHEMA_VERSION_TYPE_MISMATCH` | schemaVersion과 document type 불일치 |
| `PATH_OUTSIDE_WORKSPACE` | `.speckiwi/` 밖 path 참조 |
| `PATH_TRAVERSAL` | `..` 등 path traversal |
| `UNKNOWN_DOCUMENT_LINK_TARGET` | 존재하지 않는 document link 참조 |
| `UNKNOWN_REQUIREMENT_RELATION_TARGET` | 존재하지 않는 requirement relation target (`targetType=requirement`) |
| `UNKNOWN_DOCUMENT_RELATION_TARGET` | 존재하지 않는 document를 가리키는 requirement relation target (`targetType=document`) |
| `INVALID_EXTERNAL_RELATION_TARGET` | URI scheme prefix 형식이 아닌 external relation target (`targetType=external`) |
| `INVALID_REQUIREMENT_TYPE` | 잘못된 requirement type |
| `INVALID_REQUIREMENT_STATUS` | 잘못된 requirement status |
| `INVALID_RELATION_TYPE` | 잘못된 relation type |
| `SELF_RELATION` | requirement가 자기 자신을 relation target으로 참조 |
| `SCOPE_PARENT_NOT_FOUND` | scope parent가 존재하지 않음 |
| `SCOPE_PARENT_CYCLE` | scope parent cycle |
| `YAML_ANCHOR_FORBIDDEN` | YAML anchor 사용 |
| `YAML_ALIAS_FORBIDDEN` | YAML alias 사용 |
| `YAML_MERGE_KEY_FORBIDDEN` | YAML merge key 사용 |
| `UNKNOWN_FIELD` | 닫힌 schema object의 미정의 필드 |
| `INVALID_METADATA` | `metadata`가 object가 아니거나 null |
| `INVALID_DOCUMENT_STATUS` | 문서 타입별 status enum 위반 |
| `INVALID_JSON_POINTER` | RFC 6901 JSON Pointer syntax 위반 |
| `UNSUPPORTED_PATCH_OP` | v1 미지원 JSON Patch op |
| `PATCH_PATH_NOT_FOUND` | `replace`/`remove` target 미존재 |
| `PATCH_ARRAY_INDEX_INVALID` | array index 또는 `-` 사용 규칙 위반 |
| `PATCH_ROOT_REPLACE_FORBIDDEN` | root pointer로 전체 문서 교체 시도 |

## 5. Warning 조건

| Code | 조건 |
|---|---|
| `MISSING_ACCEPTANCE_CRITERIA` | requirement에 acceptanceCriteria 없음 |
| `MISSING_RATIONALE` | requirement에 rationale 없음 |
| `OPTIONAL_LINK_DANGLING` | optional link target 누락 |
| `CACHE_STALE` | cache stale |
| `LARGE_DOCUMENT` | 단일 YAML 문서가 설정된 크기 임계값 초과 |
| `POSSIBLE_DEPENDS_ON_CYCLE` | depends_on cycle 의심 |
| `UNUSED_DICTIONARY_ENTRY` | dictionary에 사용되지 않는 synonym entry 존재 |
| `EMPTY_SEARCH_TEXT` | 검색 대상 text가 비어 있음 |
| `MISSING_TAGS` | requirement에 tags 없음 |
| `WEAK_REQUIREMENT_STATEMENT` | statement가 너무 짧거나 검증 가능성이 낮음 |

`MISSING_TAGS`는 v1 기본 validator에서 생성하지 않는 reserved warning code다.

## 6. Validation 단계

```text
1. Workspace root resolve
2. Required file check
3. Path safety check
4. YAML parse
5. YAML subset policy check
6. JSON Schema validation
7. Document registry build
8. Scope registry build
9. Requirement registry build
10. Link/relation reference validation
11. Graph cycle validation
12. Quality warning generation
13. Cache state check
14. Diagnostics return
```

Schema validation은 parse/subset error가 없는 문서에만 수행한다. Registry/reference validation은 schema-valid 문서 기준으로 수행하며, schema-invalid 문서에서 파생되는 cascading reference error는 만들지 않는다.

Manifest registry 검증은 다음 invariant를 포함한다.

```text
- registered content document의 yaml.id는 index.documents[].id와 같아야 한다.
- registered content document의 yaml.type은 index.documents[].type과 같아야 한다.
- yaml.schemaVersion은 speckiwi/<index.documents[].type>/v1과 같아야 한다.
- content YAML path가 index.documents[]에 없으면 UNREGISTERED_CONTENT_DOCUMENT error다.
- proposals/**/*.yaml, templates/**/*.md.tmpl, cache/**, exports/**는 unregistered content 검사에서 제외한다.
```

## 7. JSON Schema 검증

각 content document 타입은 별도 JSON Schema를 가진다.
`index.schema.json`은 content document schema가 아니라 workspace manifest schema다.

v1 schema dialect와 validator는 다음으로 고정한다.

```text
JSON Schema draft 2020-12 only
Ajv2020 strict mode
allErrors=true
coerceTypes=false
useDefaults=false
removeAdditional=false
```

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

`template.schema.json`은 v1에서 제공하지 않는다. `.speckiwi/templates/*.md.tmpl`은 JSON Schema validation 대상이 아니며 Markdown export 단계에서만 path safety와 파일 확장자를 점검한다.

## 8. Path Safety 검증

금지:

```text
- absolute path
- .. segment
- .speckiwi 외부 상대 경로
- symlink traversal 기본 허용 안 함
- null byte
```

허용:

```text
- .speckiwi 내부 상대 경로
- export 명령에서 명시적으로 허용한 외부 out path
```

## 9. Graph 검증

### 9.1 Scope Tree

```text
- parent 존재 여부 확인
- cycle 탐지
- orphan scope warning 가능
```

### 9.2 Requirement Relation

```text
- target 존재 여부 확인
- self relation 금지
- depends_on cycle 탐지
- duplicate/conflict relation은 export 대상
```

### 9.3 Document Link

```text
- from/to document 존재 확인
- type enum 확인
- depends_on document cycle은 warning 또는 error 정책 가능
```

## 10. Apply 전 검증

`apply`는 다음 조건에서만 가능하다.

```text
- allowApply=true
- target path 안전
- patch 적용 후 YAML parse 성공
- patch 적용 후 schema validation 성공
- 전체 workspace validation error 없음
```

Warning만 있을 경우 apply는 허용 가능하다.

## 11. CLI 출력

```bash
speckiwi validate
```

출력 예:

```text
SpecKiwi validation failed

Errors: 1
  [DUPLICATE_REQUIREMENT_ID] .speckiwi/srs/agent-kernel.loop.yaml:12:7
    Duplicate requirement id: FR-AGK-LOOP-0001

Warnings: 1
  [MISSING_ACCEPTANCE_CRITERIA] .speckiwi/srs/agent-kernel.loop.yaml:34:5
    Requirement FR-AGK-LOOP-0002 has no acceptanceCriteria
```

## 12. MCP 출력

MCP tool `speckiwi_validate`는 diagnostics object를 반환한다.

```json
{
  "ok": false,
  "valid": false,
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

## 13. Validation 성능 목표

```text
1,000 YAML documents: 10초 이내 목표
10,000 requirements: 10초 이내 목표
cache 상태 확인: 500ms 이내 목표
```
