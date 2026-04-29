# MCP_TOOL_SPEC — SpecKiwi v1 stdio MCP 명세

## 1. 목적

SpecKiwi는 AI 코딩 에이전트가 프로젝트의 SDD context를 안정적으로 조회하고 변경 제안을 만들 수 있도록 stdio MCP 서버를 제공한다.

MCP tool의 구현 계약은 `12_IMPLEMENTATION_READINESS_DECISIONS.md`를 따른다.
MCP `structuredContent`는 CLI `--json`과 같은 Core DTO를 사용한다.
MCP tool result error는 JSON-RPC protocol error와 구분한다.
Resource read 응답은 Core DTO envelope가 아니라 MCP `contents[]` 계약을 따른다.

## 2. 실행 방식

```bash
speckiwi mcp --root /absolute/path/to/project
```

MCP host 설정 예:

```json
{
  "mcpServers": {
    "speckiwi": {
      "command": "speckiwi",
      "args": ["mcp", "--root", "/absolute/path/to/project"]
    }
  }
}
```

## 3. Transport 요구사항

| ID | 요구사항 |
|---|---|
| MCP-TR-001 | MCP 서버는 stdio transport를 사용해야 한다. |
| MCP-TR-002 | MCP 서버는 HTTP port를 열지 않아야 한다. |
| MCP-TR-003 | MCP 서버는 protocol message 외 로그를 stdout에 쓰지 않아야 한다. |
| MCP-TR-004 | MCP 서버는 로그를 stderr 또는 파일로 출력해야 한다. |
| MCP-TR-005 | MCP 서버는 workspace root 밖의 파일을 기본적으로 읽거나 쓰지 않아야 한다. |
| MCP-TR-006 | MCP tool `structuredContent`에 들어가는 Core DTO는 JSON-compatible object여야 한다. |

## 4. Tools 목록

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

## 5. Resources 목록

```text
speckiwi://overview
speckiwi://index
speckiwi://documents/{id}
speckiwi://requirements/{id}
speckiwi://scopes/{id}
```

Resource 계약:

```text
static resources:
  speckiwi://overview -> .speckiwi/overview.yaml, application/yaml
  speckiwi://index -> .speckiwi/index.yaml, application/yaml

resource templates:
  speckiwi://documents/{id} -> raw YAML text
  speckiwi://requirements/{id} -> stable JSON requirement context
  speckiwi://scopes/{id} -> stable JSON scope context

error:
  unknown resource -> JSON-RPC -32002
  malformed URI -> JSON-RPC -32602
```

`{id}`는 percent-decoding 후 빈 문자열, `/`, `\`, NUL, path traversal sequence를 거부해야 한다.

MCP process root는 `speckiwi mcp --root <path>`로 고정한다. v1 MCP tool input은 `root` override를 허용하지 않으며, `root` field가 들어오면 invalid input으로 처리한다.

JSON resource context는 Core DTO envelope를 쓰지 않는다.

```ts
type RequirementResourceContext = {
  id: string;
  documentId: string;
  scope?: string;
  path: string;
  requirement: Record<string, unknown>;
  relations: {
    incoming: Record<string, unknown>[];
    outgoing: Record<string, unknown>[];
  };
};

type ScopeResourceContext = {
  id: string;
  name: string;
  type: string;
  parent?: string;
  children: string[];
  documents: string[];
  requirements: string[];
};
```

## 6. Tool 상세

이 절의 output 예시는 사람이 읽기 위한 축약 예시다.
구현과 contract test는 항상 `ok`와 `DiagnosticBag`를 포함하는 `12_IMPLEMENTATION_READINESS_DECISIONS.md`의 Core DTO를 사용해야 한다.
MCP `outputSchema`는 MCP CallToolResult outer envelope가 아니라 `structuredContent`의 JSON Schema만 설명해야 한다.
MCP adapter는 `structuredContent`와 `content[0].text`에 동일 Core DTO를 넣고, `ErrorResult`일 때만 `isError=true`를 설정해야 한다.

### 6.1 `speckiwi_overview`

프로젝트 overview와 주요 통계를 반환한다.

Input:

```json
{}
```

Output:

```json
{
  "project": {
    "id": "speckiwi",
    "name": "SpecKiwi",
    "language": "ko"
  },
  "overview": {
    "id": "overview",
    "title": "SpecKiwi Overview",
    "summary": "..."
  },
  "stats": {
    "documents": 10,
    "scopes": 4,
    "requirements": 120
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

### 6.2 `speckiwi_list_documents`

문서 manifest를 반환한다.

Input:

```json
{
  "type": "srs",
  "scope": "agent-kernel.loop",
  "status": "active"
}
```

Output:

```json
{
  "documents": [
    {
      "id": "srs.agent-kernel.loop",
      "type": "srs",
      "scope": "agent-kernel.loop",
      "path": "srs/agent-kernel.loop.yaml",
      "title": "Agent Kernel Loop SRS"
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

### 6.3 `speckiwi_read_document`

문서 ID 기준으로 원본 YAML 구조와 선택적 rendered text를 반환한다.

Input:

```json
{
  "id": "srs.agent-kernel.loop",
  "includeRawYaml": false,
  "includeParsed": true
}
```

Output:

```json
{
  "document": {
    "id": "srs.agent-kernel.loop",
    "type": "srs",
    "path": ".speckiwi/srs/agent-kernel.loop.yaml",
    "parsed": {}
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

### 6.4 `speckiwi_search`

검색을 수행한다.

Input:

```json
{
  "query": "상태 전이",
  "mode": "auto",
  "filters": {
    "scope": "agent-kernel.loop",
    "entityType": "requirement",
    "status": ["draft", "active"]
  },
  "limit": 10
}
```

Output:

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

### 6.5 `speckiwi_get_requirement`

Requirement ID exact lookup을 수행한다.

Input:

```json
{
  "id": "FR-AGK-LOOP-0001",
  "includeRelations": true,
  "includeDocument": true
}
```

Output:

```json
{
  "requirement": {
    "id": "FR-AGK-LOOP-0001",
    "type": "functional",
    "title": "LLM 응답 기반 상태 전이",
    "status": "draft",
    "statement": "...",
    "documentId": "srs.agent-kernel.loop",
    "path": ".speckiwi/srs/agent-kernel.loop.yaml"
  },
  "relations": {
    "outgoing": [],
    "incoming": []
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

### 6.6 `speckiwi_list_requirements`

필터 조건에 맞는 requirement 목록을 반환한다.

Input:

```json
{
  "scope": "agent-kernel.loop",
  "type": "functional",
  "status": ["draft", "active"],
  "tags": ["state-machine"],
  "limit": 50
}
```

### 6.7 `speckiwi_trace_requirement`

Requirement relation graph를 반환한다.

Input:

```json
{
  "id": "FR-AGK-LOOP-0001",
  "depth": 2,
  "direction": "both"
}
```

Output:

```json
{
  "root": "FR-AGK-LOOP-0001",
  "nodes": [],
  "edges": [],
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

### 6.8 `speckiwi_graph`

GraphResult를 반환한다.

Input:

```json
{
  "graphType": "traceability"
}
```

`graphType`은 `document`, `scope`, `requirement`, `dependency`, `traceability` 중 하나다. 기본값은 `traceability`다.

Output은 `12_IMPLEMENTATION_READINESS_DECISIONS.md`의 `GraphResult` DTO를 따른다.

### 6.9 `speckiwi_preview_requirement_id`

Requirement ID preview를 원본 수정 없이 반환한다.

Input:

```json
{
  "requirementType": "functional",
  "scope": "agent-kernel.loop"
}
```

Output은 `12_IMPLEMENTATION_READINESS_DECISIONS.md`의 `RequirementIdPreviewResult` DTO를 따른다.

### 6.10 `speckiwi_impact`

변경 영향 범위를 계산한다.

Input:

```json
{
  "id": "FR-AGK-LOOP-0001",
  "depth": 1,
  "includeDocuments": true,
  "includeScopes": true
}
```

Output:

```json
{
  "ok": true,
  "root": "FR-AGK-LOOP-0001",
  "requirementId": "FR-AGK-LOOP-0001",
  "impacted": [],
  "nodes": [],
  "edges": [],
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

### 6.11 `speckiwi_validate`

Validation diagnostics를 반환한다.

Input:

```json
{}
```

Output:

```json
{
  "ok": false,
  "valid": false,
  "diagnostics": {
    "errors": [
      {
        "code": "DUPLICATE_REQUIREMENT_ID",
        "message": "Duplicate requirement id: FR-AGK-LOOP-0001",
        "severity": "error",
        "path": ".speckiwi/srs/agent-kernel.loop.yaml"
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

### 6.12 `speckiwi_propose_change`

원본 YAML을 수정하지 않고 proposal을 생성한다.

Input:

```json
{
  "operation": "update_requirement",
  "target": {
    "kind": "requirement",
    "requirementId": "FR-AGK-LOOP-0001"
  },
  "changes": [
    {
      "op": "replace",
      "path": "/requirements/0/statement",
      "value": "새 statement"
    }
  ],
  "reason": "tool_call 조건 구체화"
}
```

Output:

```json
{
  "proposal": {
    "id": "proposal.2026-04-28T091500.update.FR-AGK-LOOP-0001",
    "path": ".speckiwi/proposals/2026-04-28T091500.update.FR-AGK-LOOP-0001.yaml"
  },
  "applied": false,
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

### 6.13 `speckiwi_apply_change`

설정과 validation이 허용할 때 원본 YAML을 수정한다.

Input:

```json
{
  "proposalId": "proposal.2026-04-28T091500.update.FR-AGK-LOOP-0001",
  "confirm": true
}
```

Output:

```json
{
  "applied": true,
  "modifiedFiles": [
    ".speckiwi/srs/agent-kernel.loop.yaml"
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

## 7. Error model

모든 tool은 실패 시 다음 구조를 사용해야 한다.

```json
{
  "ok": false,
  "error": {
    "code": "REQUIREMENT_NOT_FOUND",
    "message": "Requirement not found: FR-AGK-LOOP-9999",
    "details": {
      "id": "FR-AGK-LOOP-9999"
    }
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

## 8. MCP 안전 정책

```text
- propose_change는 원본 수정 금지
- apply_change는 allowApply=false이면 거부
- apply_change는 validation error가 있으면 거부
- path traversal 입력 거부
- stdout log 금지
- workspace root 밖 파일 접근 금지
```
