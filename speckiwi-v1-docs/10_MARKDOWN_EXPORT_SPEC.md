# MARKDOWN_EXPORT_SPEC — SpecKiwi v1 Markdown Export 명세

## 1. 목적

SpecKiwi는 YAML 원본 문서를 사람이 읽기 쉬운 Markdown 산출물로 export할 수 있어야 한다. Markdown은 원본이 아니며, export 결과를 수정해도 YAML에 반영되지 않는다.

Export strict/non-strict 동작, skipped file 처리, export result DTO의 최종 결정은 `12_IMPLEMENTATION_READINESS_DECISIONS.md`를 따른다.

## 2. 기본 정책

```text
YAML → Markdown export 허용
Markdown → YAML import v1 제외
Markdown 수정 → YAML 반영 안 됨
```

## 3. 기본 export 위치

```text
.speckiwi/exports/
```

## 4. 기본 export 구조

```text
.speckiwi/exports/
├─ index.md
├─ overview.md
├─ srs/
│  ├─ agent-kernel.loop.md
│  └─ llm-provider.streaming.md
├─ prd/
│  └─ spec-context.md
├─ tech/
│  └─ search-index-builder.md
└─ adr/
   └─ 0001-local-yaml-storage.md
```

## 5. CLI

```bash
speckiwi export markdown
speckiwi export markdown --out .speckiwi/exports
speckiwi export markdown --type srs
speckiwi export markdown --document srs.agent-kernel.loop
speckiwi export markdown --json
```

`--type`은 `overview`, `srs`, `prd`, `technical`, `adr`만 허용한다. `rule`과 `dictionary`는 v1 Markdown export 대상이 아니며 명시 요청 시 `EXPORT_TYPE_NOT_SUPPORTED`로 거부한다.

`--out`은 absolute path 또는 workspace root 기준 relative path를 받을 수 있다. JSON 결과의 `writtenFiles[].path`는 항상 `outputRoot` 기준 상대 경로다.

## 6. Export index

`index.md`는 전체 문서 목록과 링크를 포함한다.

```markdown
# SpecKiwi Documentation Index

## Overview

- [Overview](overview.md)

## SRS

- [Agent Kernel Loop SRS](srs/agent-kernel.loop.md)

## Technical Documents

- [Search Index Builder](tech/search-index-builder.md)

## ADR

- [ADR-0001 Local YAML Storage](adr/0001-local-yaml-storage.md)
```

## 7. Overview Export

`overview.yaml`은 다음 구조로 export한다.

```markdown
# {title}

## Summary

{summary}

## Goals

- **G-001** — ...

## Non-goals

- **NG-001** — ...

## Glossary

| Term | Definition |
|---|---|
| SRS | ... |
```

## 8. SRS Export

SRS 문서는 scope별 Markdown으로 export한다.

```markdown
# Agent Kernel Loop SRS

- Document ID: `srs.agent-kernel.loop`
- Scope: `agent-kernel.loop`
- Status: `active`

## Requirements

### FR-AGK-LOOP-0001 — LLM 응답 기반 상태 전이

- Type: `functional`
- Status: `draft`
- Priority: `high`
- Tags: `agent-loop`, `state-machine`

#### Statement

에이전트 커널은 LLM 응답 타입에 따라 다음 실행 상태를 결정해야 한다.

#### Rationale

상태 전이 조건을 명확히 해야 구현과 테스트가 가능하다.

#### Acceptance Criteria

1. **AC-001** `[test]` LLM 응답이 tool_call이면 tool execution 단계로 전이한다.

#### Relations

- `depends_on`: `IR-LLM-STREAM-0001`
```

## 9. PRD Export

```markdown
# Spec Context PRD

## Items

### PRD-001 — 요구사항 문서 폭증

- Type: `problem`

SDD 프로젝트에서 문서가 증가하여 에이전트가 정확한 맥락을 찾기 어렵다.
```

## 10. Technical Export

```markdown
# Search Index Builder Technical Design

- Document ID: `tech.search-index-builder`
- Scope: `search`

## Implements

- `FR-SRCH-001`
- `FR-SRCH-002`

## Sections

### SEC-001 — Flatten Document Model

YAML 문서를 검색 가능한 flat document로 변환한다.
```

## 11. ADR Export

```markdown
# ADR-0001 — Local YAML Storage

- Status: `accepted`
- Date: `2026-04-28`

## Context

...

## Decision

SpecKiwi v1은 SQLite를 사용하지 않고 YAML 파일을 원본으로 사용한다.

## Consequences

- Git diff와 review가 쉬워진다.
- 대규모 동시 편집 기능은 v1에서 제공하지 않는다.
```

## 12. Export 전 Validation

기본 정책:

```text
- validation error가 있어도 export를 완전히 금지하지는 않을 수 있다.
- 단, export 결과에는 diagnostics summary를 포함할 수 있다.
- --strict 옵션에서는 validation error가 있으면 export를 중단한다.
```

CLI:

```bash
speckiwi export markdown --strict
```

## 13. JSON 결과

```json
{
  "ok": true,
  "strict": false,
  "outputRoot": ".speckiwi/exports",
  "writtenFiles": [
    {
      "path": "index.md",
      "sha256": "sha256:..."
    },
    {
      "path": "overview.md",
      "sourceDocumentId": "overview",
      "sourcePath": "overview.yaml",
      "sha256": "sha256:..."
    },
    {
      "path": "srs/agent-kernel.loop.md",
      "sourceDocumentId": "srs.agent-kernel.loop",
      "sourcePath": "srs/agent-kernel.loop.yaml",
      "sha256": "sha256:..."
    }
  ],
  "skippedFiles": [],
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

## 14. Template 정책

기본 템플릿은 내장한다. 사용자 템플릿은 `.speckiwi/templates/`에서 읽을 수 있다.

```text
.speckiwi/templates/overview.md.tmpl
.speckiwi/templates/srs.md.tmpl
.speckiwi/templates/prd.md.tmpl
.speckiwi/templates/technical.md.tmpl
.speckiwi/templates/adr.md.tmpl
```

v1에서는 간단한 placeholder 기반 템플릿으로 충분하다. 고급 템플릿 엔진은 필수 사항이 아니다.

Placeholder 문법은 다음으로 제한한다.

```text
{{name}}
{{document.title}}
```

Loop, condition, helper execution은 v1에서 지원하지 않는다. 알 수 없는 placeholder는 `TEMPLATE_PLACEHOLDER_UNKNOWN` warning을 만들고 빈 문자열로 렌더링한다.

## 15. 원본성 정책

```text
- export 파일은 원본이 아니다.
- export 파일 수정은 무시된다.
- Markdown import는 v1에서 제공하지 않는다.
- source path와 source document id는 export header에 포함할 수 있다.
- generated timestamp는 deterministic output을 위해 기본 포함하지 않는다.
```
