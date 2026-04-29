# IMPLEMENTATION_PLAN — SpecKiwi v1 구현 계획

## 1. 구현 원칙

```text
- DB를 만들지 않는다.
- HTTP 서버를 만들지 않는다.
- CLI와 MCP가 동일 core를 사용한다.
- v1은 native dependency 없이 설치 가능해야 한다.
- 먼저 읽기/검증/검색을 완성하고, 그 다음 쓰기/apply를 구현한다.
```

## 2. Milestone 0 — 패키지 골격

목표:

```text
npm package
TypeScript
ESM
CLI binary
테스트 환경
```

작업:

```text
- package.json 작성
- tsconfig.json 작성
- bin/speckiwi 추가
- src/cli entrypoint 추가
- src/core public API 초안 작성
- schemas/ 디렉토리 추가
```

완료 기준:

```bash
npm install -g .
speckiwi --help
```

## 2.5 Milestone 0.5 — Contract Freeze

목표:

```text
구현자가 임의로 해석할 수 있는 계약을 먼저 고정한다.
CLI JSON과 MCP structuredContent가 같은 Core DTO를 사용하도록 만든다.
```

작업:

```text
- 12_IMPLEMENTATION_READINESS_DECISIONS.md 반영
- Core DTO type 작성
- Core public API surface 작성
- DiagnosticBag 작성
- ErrorResult와 ValidateResult 구분
- CLI JSON renderer 작성
- MCP structuredContent adapter skeleton 작성
- MCP resource URI parser/read handler skeleton 작성
- MCP inputSchema/outputSchema fixture 작성
- Ajv2020 strict schema compile test 작성
- JSON Schema additionalProperties=false 정책 반영
- index manifest/proposal/template/metadata schema 결정 반영
- SearchResultItem/GraphResult/TraceResult/ImpactResult DTO 작성
- ProposalResult/ApplyResult/ExportResult DTO 작성
- Public Input DTO와 MCP inputSchema fixture 작성
- RFC 8785 canonical JSON helper 작성
- test fixture workspace 추가
```

완료 기준:

```bash
npm test -- contract
```

## 3. Milestone 1 — Workspace Init/Load

작업:

```text
- workspace root 탐색
- --root 처리
- .speckiwi 구조 생성
- index.yaml/overview.yaml/dictionary.yaml template 생성
- YAML loader 구현
- path safety 구현
```

완료 기준:

```bash
speckiwi init
speckiwi doctor
```

## 4. Milestone 2 — Schema Validation

작업:

```text
- JSON Schema 작성
- AJV validator 구성
- schemaVersion 검증
- YAML parse diagnostics
- document id 중복 검증
- requirement id 중복 검증
- relation target 검증
```

완료 기준:

```bash
speckiwi validate
speckiwi validate --json
```

## 5. Milestone 3 — Graph Builder

작업:

```text
- document registry
- scope registry
- requirement registry
- scope tree
- document link graph
- requirement relation graph
- incoming/outgoing relation 계산
- depends_on cycle 탐지
- GraphResult nodes/edges deterministic ordering
- TraceResult upstream/downstream/both depth 처리
```

완료 기준:

```bash
speckiwi graph --json
speckiwi impact FR-AGK-LOOP-0001 --json
```

## 6. Milestone 4 — Search

작업:

```text
- flatten document 생성
- exact index 구현
- tokenizer 구현
- Korean 2-gram/3-gram 구현
- dictionary expansion 구현
- BM25 engine 통합
- field boost 적용
- search filters 구현
```

완료 기준:

```bash
speckiwi search "상태 전이"
speckiwi search "FR-AGK-LOOP-0001" --json
```

## 7. Milestone 5 — Cache

작업:

```text
- manifest.json
- 파일 hash 계산
- graph.json
- search-index.json
- diagnostics.json
- stale detection
- rebuild/clean 명령
```

완료 기준:

```bash
speckiwi cache rebuild
speckiwi cache clean
speckiwi search "상태 전이"
```

## 8. Milestone 6 — CLI 전체 명령

작업:

```text
- overview
- list docs
- list reqs
- req get
- req create propose
- req update propose
- impact
- export markdown
```

완료 기준:

```bash
speckiwi list docs
speckiwi list reqs
speckiwi req get FR-AGK-LOOP-0001
speckiwi req update FR-AGK-LOOP-0001 --statement "..."
```

## 9. Milestone 7 — Proposal/Apply

작업:

```text
- proposal schema
- proposal filename policy
- patch operation
- propose mode
- apply mode
- atomic write
- validation before apply
- cache stale 처리
```

완료 기준:

```bash
speckiwi req update FR-AGK-LOOP-0001 --statement "..."
speckiwi req update FR-AGK-LOOP-0001 --statement "..." --apply
```

## 10. Milestone 8 — MCP

작업:

```text
- @modelcontextprotocol/sdk 통합
- speckiwi mcp subcommand
- tools 등록
- resources 등록
- stdout/stderr 정책 검증
- MCP JSON schema 정의
```

완료 기준:

```bash
speckiwi mcp --root /path/to/project
```

MCP tools:

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

## 11. Milestone 9 — Markdown Export

작업:

```text
- overview export
- srs export
- prd export
- tech export
- adr export
- export index
- --out 옵션
- --strict 옵션
- JSON 결과
```

완료 기준:

```bash
speckiwi export markdown
speckiwi export markdown --json
```

## 12. Milestone 10 — Hardening

작업:

```text
- path traversal 테스트
- invalid YAML 테스트
- duplicate id 테스트
- cache corruption 테스트
- MCP stdout log 금지 테스트
- Windows path 테스트
- large workspace 테스트
```

완료 기준:

```text
- 핵심 테스트 통과
- v1 acceptance criteria 통과
- npm package dry-run 성공
```

## 13. 권장 기술 스택

```text
Runtime: Node.js >= 20
Language: TypeScript
Module: ESM
CLI: commander 또는 cac
YAML: yaml
Schema validation: ajv
Search: MiniSearch 또는 자체 BM25 wrapper
MCP: @modelcontextprotocol/sdk
Test: vitest
Package manager: pnpm 또는 npm
```

## 14. v1 Acceptance Checklist

```text
[ ] DB 파일을 생성하지 않는다.
[ ] HTTP 서버를 시작하지 않는다.
[ ] .speckiwi YAML만으로 workspace를 로드한다.
[ ] init/validate/search/req get/export가 동작한다.
[ ] stdio MCP가 동작한다.
[ ] MCP stdout에 로그를 쓰지 않는다.
[ ] propose는 원본을 수정하지 않는다.
[ ] apply는 validation error에서 중단한다.
[ ] Korean n-gram 검색이 동작한다.
[ ] dictionary expansion이 동작한다.
[ ] Markdown export는 원본으로 취급되지 않는다.
```
