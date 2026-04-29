# DIRECTORY_STRUCTURE — `.speckiwi/` 표준 구조

## 1. 목적

이 문서는 SpecKiwi v1 workspace의 표준 디렉토리 구조와 각 파일/디렉토리의 책임을 정의한다.

## 2. 표준 구조

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

## 3. 파일과 디렉토리 책임

| 경로 | 필수 | 원본 여부 | 설명 |
|---|---:|---:|---|
| `index.yaml` | 예 | 예 | workspace manifest, documents/scopes/links/settings 정의 |
| `overview.yaml` | 예 | 예 | 프로젝트 최상위 요약, 목표, 비목표, 용어집 |
| `dictionary.yaml` | 아니오 | 예 | 검색 동의어, 용어 정규화, query expansion |
| `prd/` | 아니오 | 예 | PRD 문서 |
| `srs/` | 예 | 예 | scope별 SRS 문서 |
| `tech/` | 아니오 | 예 | 기술 설계 문서 |
| `adr/` | 아니오 | 예 | Architecture Decision Record |
| `rules/` | 아니오 | 예 | 에이전트/개발/코딩 규칙 |
| `proposals/` | 아니오 | 예 | 변경 제안 문서. 적용 전까지 원본 수정 없음 |
| `templates/` | 아니오 | 예 | Markdown export template |
| `cache/` | 아니오 | 아니오 | graph/search/diagnostics cache. 삭제 가능 |
| `exports/` | 아니오 | 아니오 | Markdown export 산출물 |

`proposals/*.yaml`은 schema-validated managed artifact지만 `index.yaml`의 `documents[]` registry에는 등록하지 않는다. `templates/*.md.tmpl`은 YAML document가 아니라 export asset이다.

## 4. `index.yaml`

`index.yaml`은 workspace의 entrypoint다.

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

## 5. `overview.yaml`

`overview.yaml`은 사람과 에이전트가 처음 읽는 프로젝트 설명이다.

```yaml
schemaVersion: speckiwi/overview/v1

id: overview
type: overview
title: Project Overview
status: active

summary: >
  이 프로젝트는 ...

goals:
  - id: G-001
    statement: ...

nonGoals:
  - id: NG-001
    statement: ...

glossary:
  - term: SRS
    definition: 검증 가능한 시스템 요구사항 명세.
```

## 6. `srs/`

SRS는 scope 단위로 분할한다.

```text
.speckiwi/srs/agent-kernel.loop.yaml
.speckiwi/srs/llm-provider.streaming.yaml
.speckiwi/srs/tool-manager.execution.yaml
```

규칙:

```text
- 하나의 SRS 파일은 하나의 primary scope를 표현한다.
- requirement 하나당 파일 하나를 만들지 않는다.
- 전체 프로젝트 SRS를 단일 파일로 강제하지 않는다.
- requirement id는 workspace 전체에서 유일해야 한다.
```

## 7. `tech/`

기술 설계 문서는 SRS 요구사항을 구현 관점에서 구체화한다.

```text
.speckiwi/tech/agent-state-machine.yaml
.speckiwi/tech/search-index-builder.yaml
.speckiwi/tech/mcp-transport.yaml
```

## 8. `adr/`

ADR 파일명은 번호와 slug를 포함한다.

```text
.speckiwi/adr/0001-local-yaml-storage.yaml
.speckiwi/adr/0002-stdio-mcp-only.yaml
.speckiwi/adr/0003-no-database-v1.yaml
```

## 9. `rules/`

rules는 에이전트와 개발자에게 적용되는 정책 문서다.

예:

```text
.speckiwi/rules/coding-agent-safe-write.yaml
.speckiwi/rules/requirement-id-policy.yaml
.speckiwi/rules/korean-search-policy.yaml
```

## 10. `proposals/`

propose mode에서 생성되는 변경 제안이다.

```text
.speckiwi/proposals/2026-04-28T091500.update.FR-AGK-LOOP-0001.yaml
```

원칙:

```text
- propose는 원본 YAML을 수정하지 않는다.
- proposal도 YAML 원본으로 version control 가능하다.
- apply는 proposal을 읽어 검증 후 원본에 반영할 수 있다.
```

## 11. `cache/`

cache는 언제든 삭제 가능해야 한다.

```text
.speckiwi/cache/manifest.json
.speckiwi/cache/graph.json
.speckiwi/cache/search-index.json
.speckiwi/cache/diagnostics.json
```

캐시 무효화 기준:

```text
- index.yaml hash 변경
- overview.yaml hash 변경
- dictionary.yaml hash 변경
- 문서 YAML hash 변경
- schemaVersion 변경
- speckiwi package version 변경
- search settings 변경
```

## 12. `exports/`

Markdown export 기본 위치다.

```text
.speckiwi/exports/index.md
.speckiwi/exports/overview.md
.speckiwi/exports/srs/agent-kernel.loop.md
.speckiwi/exports/tech/agent-state-machine.md
.speckiwi/exports/adr/0001-local-yaml-storage.md
```

원칙:

```text
- export는 산출물이다.
- export 파일 수정은 원본 YAML에 반영되지 않는다.
- Markdown → YAML import는 v1 범위가 아니다.
```

## 13. Path 안전성 규칙

```text
- documents[].path는 .speckiwi 내부 상대 경로여야 한다.
- absolute path는 금지한다.
- .. segment는 금지한다.
- symlink는 기본적으로 따라가지 않는다.
- export target 외부 지정은 명시 옵션이 있을 때만 허용한다.
```
