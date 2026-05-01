---
plan_contract: "1.1.0"
plan_id: "plan-20260501-speckiwi-v1-implementation"
title: "SpecKiwi v1 implementation plan"
mode: "NORMAL"
produced_at: "2026-05-01T08:56:19+09:00"
spec_path: "docs/spec/srs.md"
code_path: "."
scope_freeze: true
change_log:
  - date: "2026-05-01"
    reason: "Phase-1 evaluator remediation after scope freeze"
    diff_summary: "Expanded search target coverage, apply concurrency and recovery semantics, rollback tracked/untracked handling, environment leak hardening, and synchronized sidecar/execution guard."
    approved_by: "user"
platforms:
  - "posix"
  - "windows"
auto_recommend_policy:
  default_confidence_threshold: "medium"
  cap: 0
  forbidden_for_business_decision: true
pre_commit_gate:
  - {shell: "bash", cmd: "npm run build", expected_exit: 0}
  - {shell: "pwsh", cmd: "npm run build", expected_exit: 0}
  - {shell: "bash", cmd: "npm run typecheck", expected_exit: 0}
  - {shell: "pwsh", cmd: "npm run typecheck", expected_exit: 0}
  - {shell: "bash", cmd: "npm run lint", expected_exit: 0}
  - {shell: "pwsh", cmd: "npm run lint", expected_exit: 0}
  - {shell: "bash", cmd: "npm test", expected_exit: 0}
  - {shell: "pwsh", cmd: "npm test", expected_exit: 0}
forbidden_patterns:
  - {pattern: "\\brm\\s+-[rRfF]+\\s+(/|~|\\$HOME|C:\\\\)", flags: ""}
  - {pattern: "\\brm\\s+-[rRfF]+\\s+\\*", flags: ""}
  - {pattern: "\\bdd\\s+if=.*\\s+of=/dev/(sd|nvme|hd)", flags: ""}
  - {pattern: "\\b(mkfs|fdisk|parted)\\b", flags: ""}
  - {pattern: "\\bchmod\\s+(-R\\s+)?[0-7]*777\\b", flags: ""}
  - {pattern: "\\bchown\\s+-R\\s+.*\\s+/", flags: ""}
  - {pattern: "\\bsudo\\s+(rm|chmod|chown|dd|mkfs)", flags: ""}
  - {pattern: "curl\\s+[^|]*\\|\\s*(sh|bash|zsh|powershell)", flags: ""}
  - {pattern: "wget\\s+[^|]*\\|\\s*sh", flags: ""}
  - {pattern: "iwr\\s+[^;]+;\\s*iex", flags: ""}
  - {pattern: "git\\s+push\\s+.*--force(-with-lease)?\\s+.*\\b(main|master|prod)\\b", flags: ""}
  - {pattern: "git\\s+reset\\s+--hard\\s+(?!HEAD\\b)", flags: ""}
  - {pattern: "git\\s+clean\\s+-[fdx]+", flags: ""}
  - {pattern: "적절히|필요 시|알아서|상황에 맞게|기존 방식대로|어떻게든", flags: ""}
phases:
  - id: "PHASE-P0"
    title: "Package skeleton and contract freeze"
    tasks:
      - {id: "TASK-P0-001"}
      - {id: "TASK-P0-002"}
  - id: "PHASE-P1"
    title: "Workspace init, file store, and YAML load"
    tasks:
      - {id: "TASK-P1-001"}
      - {id: "TASK-P1-002"}
  - id: "PHASE-P2"
    title: "Schema validation and diagnostics"
    tasks:
      - {id: "TASK-P2-001"}
      - {id: "TASK-P2-002"}
  - id: "PHASE-P3"
    title: "Graph, requirement lookup, trace, impact, and ID generation"
    tasks:
      - {id: "TASK-P3-001"}
      - {id: "TASK-P3-002"}
  - id: "PHASE-P4"
    title: "Search and cache"
    tasks:
      - {id: "TASK-P4-001"}
      - {id: "TASK-P4-002"}
  - id: "PHASE-P5"
    title: "CLI read commands and doctor"
    tasks:
      - {id: "TASK-P5-001"}
      - {id: "TASK-P5-002"}
  - id: "PHASE-P6"
    title: "Proposal, apply, and requirement mutations"
    tasks:
      - {id: "TASK-P6-001"}
      - {id: "TASK-P6-002"}
  - id: "PHASE-P7"
    title: "MCP stdio adapter"
    tasks:
      - {id: "TASK-P7-001"}
      - {id: "TASK-P7-002"}
  - id: "PHASE-P8"
    title: "Markdown export"
    tasks:
      - {id: "TASK-P8-001"}
  - id: "PHASE-P9"
    title: "Hardening, performance, and release readiness"
    tasks:
      - {id: "TASK-P9-001"}
      - {id: "TASK-P9-002"}
---

# SpecKiwi v1 Implementation Plan

## 개요

이 계획은 `docs/spec/srs.md`를 기준 스펙으로 삼아 SpecKiwi v1을 구현하기 위한 snoworca plan-contract-v1.1 산출물이다. 보완 결정은 `speckiwi-v1-docs/12_IMPLEMENTATION_READINESS_DECISIONS.md`가 우선하며, 기존 milestone 문서 `speckiwi-v1-docs/11_IMPLEMENTATION_PLAN.md`의 Milestone 0~10을 Phase P0~P9로 재구성한다.

목표는 Git 저장소 내부의 `.speckiwi/**/*.yaml`을 단일 원본으로 읽고, CLI와 stdio MCP를 통해 조회, 검증, 검색, 관계 추적, 변경 제안, 검증된 적용, Markdown export를 제공하는 Node.js 20+ ESM TypeScript 패키지를 완성하는 것이다.

Feasibility 요약: 총 19개 TASK 중 High 6개, Medium 10개, Low 3개다. Infeasible 항목은 없다. High TASK는 validation, graph/search, proposal/apply, MCP처럼 스펙 간 결합도가 높은 영역이며 strict review를 요구한다.

JSON 사이드카: `docs/plans/plan-20260501-speckiwi-v1-implementation.md.json`

Dew File: `.snoworca/dew/planner/plan-20260501-speckiwi-v1-implementation/`

## 선행 조건 및 전제

- Node.js 20 이상을 사용한다.
- 현재 `package.json`의 `name: speckiwi`, `type: module`, `engines.node: >=20`은 유지한다.
- DB, HTTP 서버, background daemon, vector DB, Markdown import는 v1 범위 밖이다.
- TypeScript, Vitest, ESLint, commander, yaml, Ajv2020, MiniSearch 또는 자체 BM25 wrapper, MCP SDK를 사용한다. 모든 런타임 기본 기능은 native dependency 없이 설치되어야 한다.
- Phase P0에서 `npm run build`, `npm run typecheck`, `npm run lint`, `npm test` 스크립트를 확정한다. 이후 Phase의 검증 명령은 이 스크립트가 존재한다는 전제에서 실행한다.

## 프로젝트 온보딩 컨텍스트

SpecKiwi는 로컬 Git 저장소의 `.speckiwi/` 디렉토리에 있는 YAML 문서를 원본으로 사용한다. 이 YAML 문서에는 overview, dictionary, PRD, SRS, technical, ADR, rule, proposal이 포함된다. Core는 YAML을 읽고 검증한 뒤 graph, search, proposal, export 결과를 DTO로 반환한다. CLI와 MCP는 같은 Core DTO를 사용한다.

주요 디렉토리 맵:

| 경로 | 역할 |
|---|---|
| `bin/speckiwi` | 전역 설치 후 실행되는 CLI binary |
| `src/core/` | CLI/MCP와 분리된 public Core API |
| `src/cli/` | 명령 파싱, human output, exit code |
| `src/mcp/` | stdio MCP tools/resources adapter |
| `src/io/` | workspace root, file store, path safety, YAML loader |
| `src/schema/`, `schemas/` | Ajv2020 schema compile 및 배포 JSON Schema |
| `src/validate/` | parse/schema/semantic diagnostics |
| `src/graph/` | document, scope, requirement graph |
| `src/search/` | exact/BM25/Korean n-gram/dictionary search |
| `src/cache/` | 재생성 가능한 JSON cache |
| `src/write/` | proposal/apply/atomic write |
| `src/export/` | YAML to Markdown exporter |
| `test/fixtures/workspaces/` | 실제 YAML fixture workspace |

핵심 규칙:

- Core는 CLI와 MCP를 몰라야 한다.
- CLI `--json` stdout은 Core DTO JSON 객체 하나만 출력한다.
- MCP stdout에는 protocol message 외 로그를 쓰지 않는다.
- `.speckiwi/` 외부 쓰기는 export target을 제외하고 금지한다.
- `index.yaml`은 manifest이며 content document가 아니다.
- proposal은 schema-validated managed artifact지만 `index.documents[]`에 등록하지 않는다.
- write 기본 모드는 `propose`다. apply는 validation, confirm, allowApply, stale hash 검사를 통과해야 한다.
- Mock 기반 Core 테스트는 금지한다. 테스트는 fixture workspace와 temp directory를 사용한다.

빌드·테스트 치트시트:

| 목적 | 명령 |
|---|---|
| 전체 빌드 | `npm run build` |
| 타입 검사 | `npm run typecheck` |
| lint | `npm run lint` |
| 전체 테스트 | `npm test` |
| 계약 테스트 | `npm test -- contract` |
| CLI 테스트 | `npm test -- cli` |
| MCP 테스트 | `npm test -- mcp` |
| 패키지 dry run | `npm pack --dry-run` |

참고 문서:

- `docs/spec/srs.md`
- `speckiwi-v1-docs/00_README.md`
- `speckiwi-v1-docs/05_MCP_TOOL_SPEC.md`
- `speckiwi-v1-docs/06_CLI_SPEC.md`
- `speckiwi-v1-docs/08_VALIDATION_SPEC.md`
- `speckiwi-v1-docs/10_MARKDOWN_EXPORT_SPEC.md`
- `speckiwi-v1-docs/12_IMPLEMENTATION_READINESS_DECISIONS.md`

도움 요청 경로: SRS와 보완 결정이 충돌하면 `speckiwi-v1-docs/12_IMPLEMENTATION_READINESS_DECISIONS.md:30-43` 우선순위를 따른다. 그래도 결정할 수 없는 항목은 TASK의 `needs_clarification`에 `auto_severity: business-decision`으로 기록하고 구현을 멈춘다.

## AI 에이전트 실행 가드

이 문서의 frontmatter와 Dew File `execution-guard.yaml`이 실행 가드의 SSOT다. `scope_freeze: true`이므로 새 기능, 새 Phase, TASK 소유 파일 변경은 사용자 승인과 `change_log[]` 기록 없이는 추가하지 않는다.

Pre-commit gate는 build, typecheck, lint, test 네 종류를 bash와 pwsh 모두에 대해 요구한다. acceptance command에는 shell별 파싱 차이를 만드는 복합 연산자를 넣지 않는다.

## Phase P0 - Package Skeleton And Contract Freeze

목표: 현재 npm 초기화 상태를 TypeScript ESM CLI 패키지로 확장하고, Core DTO 계약을 먼저 고정한다.

### TASK-P0-001 - Complete Package Skeleton, Scripts, And CLI Binary

- 관련 요구사항: `FR-PKG-001..006`, `NFR-COMP-001..007`, `NFR-MAINT-001`, `NFR-MAINT-008`
- 파일 경로: `package.json`, `package-lock.json`, `tsconfig.json`, `bin/speckiwi`, `src/cli/index.ts`, `src/cli/command.ts`, `test/smoke/package.test.ts`
- 메서드/함수 시그니처:
  - `export async function main(argv: string[], env?: NodeJS.ProcessEnv): Promise<number>`
  - `export function buildProgram(): Command`
- 참고 패턴: 현재 `package.json` 초기화 내용을 보존하면서 scripts/bin/files/dependencies를 확장한다.
- source_anchors: `package.json:1-28`, `docs/spec/srs.md:1402-1444`, `speckiwi-v1-docs/11_IMPLEMENTATION_PLAN.md:13-40`
- 구현 가이드: TypeScript/Vitest/ESLint/commander/yaml/ajv/minisearch/MCP SDK 의존성을 추가하고, `bin.speckiwi`를 등록하고, `node bin/speckiwi --help`가 0으로 종료되게 만든다.
- Rationale: SRS는 Node 20+, ESM TypeScript, 전역 CLI install, native dependency 없는 설치를 요구한다.
- 함정/주의사항: DB/HTTP 서버 패키지를 추가하지 않는다. CLI binary는 stdout 정책을 이후 Phase에서 확장할 수 있게 얇게 유지한다.
- 테스트 작성 지침: `test/smoke/package.test.ts`에 help 성공, 알 수 없는 명령 실패, package metadata 확인 세 가지를 둔다.
- 검증 명령어: `npm test -- package`
- acceptance_tests: bash/pwsh 각각 `npm run build`, `npm test -- package`, expected_exit 0
- DoD: build 통과, package smoke 통과, `node bin/speckiwi --help` 통과, package name `speckiwi` 유지
- rollback: `manual` - 1) Git에 추적된 owns 경로는 `git restore -- <tracked owns>`로 되돌린다. 2) Git에 아직 추적되지 않은 owns 파일/디렉토리만 목록과 대조해 삭제한 뒤 task 검증 명령으로 rollback을 확인한다.

### TASK-P0-002 - Define Core DTO, Input DTO, Diagnostics, And JSON Renderer Contracts

- 관련 요구사항: `FR-CLI-005..012`, `FR-MCP-001..013`, `FR-MCP-TR-006`, `NFR-UX-001..008`, `NFR-MAINT-001`, `NFR-MAINT-008`
- 파일 경로: `src/core/dto.ts`, `src/core/result.ts`, `src/core/inputs.ts`, `src/cli/json-renderer.ts`, `src/mcp/structured-content.ts`, `test/contract/core-dto.test.ts`
- 메서드/함수 시그니처:
  - `export type CoreResult<T> = { ok: true; data: T; diagnostics: DiagnosticBag } | ErrorResult`
  - `export function renderJson(result: unknown): string`
  - `export function toStructuredContent<T>(result: CoreResult<T>): Record<string, unknown>`
- 참고 패턴: DTO와 DiagnosticBag 계약은 보완 결정 문서의 Core DTO 계약을 따른다.
- source_anchors: `speckiwi-v1-docs/12_IMPLEMENTATION_READINESS_DECISIONS.md:45-80`, `speckiwi-v1-docs/12_IMPLEMENTATION_READINESS_DECISIONS.md:163-203`
- 구현 가이드: DiagnosticBag, ErrorResult, ValidateResult, SearchResultSet, GraphResult, TraceResult, ImpactResult, ProposalResult, ApplyResult, ExportResult, Input DTO를 작성하고 fixtures로 JSON shape를 고정한다.
- Rationale: CLI JSON과 MCP structuredContent가 같은 DTO를 쓰게 만들어 adapter 분기를 줄인다.
- 함정/주의사항: diagnostics를 배열 축약형으로 반환하지 않는다. human output 필드는 Core DTO에 넣지 않는다.
- 테스트 작성 지침: 성공/오류/validation/JSON renderer fixture를 각각 snapshot 또는 deep equality로 검증한다.
- 검증 명령어: `npm test -- contract`
- acceptance_tests: bash/pwsh 각각 `npm test -- contract`, expected_exit 0
- DoD: CoreResult/ValidateResult fixture 통과, CLI JSON renderer가 JSON 객체 하나만 출력, MCP helper가 Core DTO를 재사용
- rollback: `manual` - 1) Git에 추적된 owns 경로는 `git restore -- <tracked owns>`로 되돌린다. 2) Git에 아직 추적되지 않은 owns 파일/디렉토리만 목록과 대조해 삭제한 뒤 task 검증 명령으로 rollback을 확인한다.

## Phase P1 - Workspace Init, File Store, And YAML Load

목표: `.speckiwi/` workspace를 생성하고 root/path/YAML load 경계를 고정한다.

### TASK-P1-001 - Implement Workspace Root Discovery, Root Override, And Safe File Store

- 관련 요구사항: `FR-DIR-006..010`, `FR-STOR-001..007`, `NFR-SEC-001..007`, `NFR-REL-001..004`
- 파일 경로: `src/io/workspace.ts`, `src/io/file-store.ts`, `src/io/path.ts`, `test/io/workspace.test.ts`
- 시그니처: `findWorkspaceRoot`, `resolveStorePath`, `atomicWriteText`
- 참고 패턴: 없음 - 신규 패턴. SRS storage/security 요구사항이 기준이다.
- source_anchors: `docs/spec/srs.md:146-159`, `docs/spec/srs.md:1313-1325`
- 구현 가이드: cwd에서 상위로 `.speckiwi`를 찾고, explicit `--root`가 있으면 우선한다. StorePath는 POSIX 상대 경로로 정규화하고 traversal을 거부한다. atomic write는 temp file 후 rename을 사용한다.
- Rationale: 이후 모든 기능의 보안 경계다.
- 함정/주의사항: Windows drive path를 StorePath로 받아들이지 않는다.
- 테스트: root 발견, explicit root, traversal rejection, atomic write cleanup
- 검증: `npm test -- io`
- acceptance_tests: bash/pwsh 각각 `npm test -- io`, expected_exit 0
- DoD: traversal rejection, explicit root priority, partial write 방지
- rollback: `manual` - 1) Git에 추적된 owns 경로는 `git restore -- <tracked owns>`로 되돌린다. 2) Git에 아직 추적되지 않은 owns 파일/디렉토리만 목록과 대조해 삭제한 뒤 task 검증 명령으로 rollback을 확인한다.

### TASK-P1-002 - Implement Speckiwi Init Templates And YAML Parser Subset

- 관련 요구사항: `FR-DIR-001..005`, `FR-YAML-001..010`, `FR-IDX-001..014`, `FR-OVR-001`, `FR-DICT-001..002`, `NFR-UX-008`
- 파일 경로: `src/core/init.ts`, `src/io/yaml-loader.ts`, `src/templates/workspace.ts`, `test/fixtures/workspaces/init-empty`, `test/core/init.test.ts`, `test/io/yaml-loader.test.ts`
- 시그니처: `initWorkspace`, `loadYamlDocument`
- 참고 패턴: init tree와 YAML subset은 SRS와 보완 결정 문서에 고정되어 있다.
- source_anchors: `docs/spec/srs.md:124-159`, `docs/spec/srs.md:177-190`, `speckiwi-v1-docs/12_IMPLEMENTATION_READINESS_DECISIONS.md:900-928`
- 구현 가이드: `index.yaml`, `overview.yaml`, `dictionary.yaml`, 하위 디렉토리를 생성한다. `yaml` package `parseDocument()`로 errors/warnings/source location을 수집하고 anchor/alias/merge key를 diagnostics로 만든다.
- Rationale: YAML source-of-truth 모델의 시작점이다.
- 함정/주의사항: `index.yaml`을 content document registry에 넣지 않는다.
- 테스트: init 성공, 기존 workspace 충돌, invalid YAML, anchor/alias/merge rejection
- 검증: `npm test -- workspace`
- acceptance_tests: bash/pwsh 각각 `npm test -- workspace`, expected_exit 0
- DoD: full directory tree 생성, line/column diagnostics 반환, YAML subset fixture 통과
- rollback: `manual` - 1) Git에 추적된 owns 경로는 `git restore -- <tracked owns>`로 되돌린다. 2) Git에 아직 추적되지 않은 owns 파일/디렉토리만 목록과 대조해 삭제한 뒤 task 검증 명령으로 rollback을 확인한다.

## Phase P2 - Schema Validation And Diagnostics

목표: 모든 YAML 문서 타입의 schema validation과 semantic validation을 deterministic diagnostics로 제공한다.

### TASK-P2-001 - Add JSON Schema Files And Ajv2020 Strict Compile Layer

- 관련 요구사항: `FR-YAML-005..010`, `FR-DOC-001..011`, `FR-PRD-001..005`, `FR-TECH-001..005`, `FR-ADR-001..005`, `FR-DICT-001..005`, `FR-PKG-004`, `NFR-MAINT-006`
- 파일 경로: `schemas/*.schema.json`, `src/schema/compile.ts`, `test/schema/schema-compile.test.ts`
- 시그니처: `compileSchemas`, `validateAgainstSchema`
- 참고 패턴: schema dialect와 Ajv2020 strict mode는 보완 결정 문서가 기준이다.
- source_anchors: `speckiwi-v1-docs/04_YAML_SCHEMA_SPEC.md:1-40`, `speckiwi-v1-docs/12_IMPLEMENTATION_READINESS_DECISIONS.md:946-990`
- 구현 가이드: 문서 타입별 schema를 작성하고 `additionalProperties: false`와 metadata 확장 지점을 명시한다. 모든 schema compile 테스트를 먼저 통과시킨다.
- Rationale: graph/search/write는 schema-valid 문서만 신뢰해야 한다.
- 함정/주의사항: proposal은 managed artifact이며 registry 등록 대상이 아니다.
- 테스트: 타입별 valid/invalid fixture와 strict compile
- 검증: `npm test -- schema`
- acceptance_tests: bash/pwsh 각각 `npm test -- schema`, expected_exit 0
- DoD: schemas compile, invalid fixture diagnostics stable, package 배포물에 schemas 포함
- rollback: `manual` - 1) Git에 추적된 owns 경로는 `git restore -- <tracked owns>`로 되돌린다. 2) Git에 아직 추적되지 않은 owns 파일/디렉토리만 목록과 대조해 삭제한 뒤 task 검증 명령으로 rollback을 확인한다.

### TASK-P2-002 - Implement Semantic Validation Registry And Validate Command Service

- 관련 요구사항: `FR-VAL-001..007`, `VAL-ERR-001..022`, `VAL-WARN-001..008`, `FR-IDX-001..014`, `FR-REQ-001..015`, `FR-REL-001..007`, `FR-LINK-001..003`, `NFR-REL-001..007`
- 파일 경로: `src/validate/diagnostics.ts`, `src/validate/semantic.ts`, `src/core/validate.ts`, `test/validate/semantic.test.ts`, `test/fixtures/workspaces/invalid-*`
- 시그니처: `validateWorkspace`, `validateRegistry`
- 참고 패턴: validation code mapping과 cascading suppression은 validation spec과 보완 결정 문서가 기준이다.
- source_anchors: `docs/spec/srs.md:910-999`, `speckiwi-v1-docs/08_VALIDATION_SPEC.md:1-90`, `speckiwi-v1-docs/12_IMPLEMENTATION_READINESS_DECISIONS.md:1037-1058`
- 구현 가이드: schema-valid 문서에서 document/scope/requirement/relation registry를 만들고 중복, 누락, relation target, cycle, warning을 순서 있게 반환한다.
- Rationale: write/apply 전 validation이 source mutation의 안전장치다.
- 함정/주의사항: parse/schema 실패 문서에서 파생되는 reference error를 만들지 않는다.
- 테스트: VAL-ERR/VAL-WARN family별 fixture와 stable ordering snapshot
- 검증: `npm test -- validate`
- acceptance_tests: bash/pwsh 각각 `npm test -- validate`, expected_exit 0
- DoD: 주요 error/warning fixture 존재, ValidateResult ordering stable, warning-only 결과는 Core에서 실패로 취급하지 않음
- rollback: `manual` - 1) Git에 추적된 owns 경로는 `git restore -- <tracked owns>`로 되돌린다. 2) Git에 아직 추적되지 않은 owns 파일/디렉토리만 목록과 대조해 삭제한 뒤 task 검증 명령으로 rollback을 확인한다.

## Phase P3 - Graph, Requirement Lookup, Trace, Impact, And ID Generation

목표: deterministic graph와 requirement access primitive를 구현한다.

### TASK-P3-001 - Build Registries, Graph Builder, Trace, And Impact Services

- 관련 요구사항: `FR-GRAPH-001..011`, `FR-REQ-001..012`, `FR-REL-001..007`, `FR-LINK-001..003`, `NFR-MAINT-003`, `NFR-UX-005`
- 파일 경로: `src/graph/model.ts`, `src/graph/builder.ts`, `src/graph/trace.ts`, `src/graph/impact.ts`, `src/core/requirements.ts`, `test/graph/graph.test.ts`
- 시그니처: `buildGraph`, `traceRequirement`, `impactRequirement`
- 참고 패턴: graph node/edge semantics와 ordering은 보완 결정 문서에 고정되어 있다.
- source_anchors: `docs/spec/srs.md:894-906`, `speckiwi-v1-docs/12_IMPLEMENTATION_READINESS_DECISIONS.md:1367-1402`
- 구현 가이드: document/scope/requirement node와 relation edge를 만들고 stable key로 정렬한다. upstream/downstream/both trace와 impact context 포함 옵션을 구현한다.
- Rationale: graph 결과는 CLI/MCP/search/export의 공통 컨텍스트다.
- 함정/주의사항: `index.yaml`은 graph node가 아니다.
- 테스트: graph 종류별 fixture, depth-limited trace, impact, ordering
- 검증: `npm test -- graph`
- acceptance_tests: bash/pwsh 각각 `npm test -- graph`, expected_exit 0
- DoD: GraphResult/TraceResult/ImpactResult snapshot stable, root requirement 포함, downstream impact 계산
- rollback: `manual` - 1) Git에 추적된 owns 경로는 `git restore -- <tracked owns>`로 되돌린다. 2) Git에 아직 추적되지 않은 owns 파일/디렉토리만 목록과 대조해 삭제한 뒤 task 검증 명령으로 rollback을 확인한다.

### TASK-P3-002 - Implement Requirement ID Preview And Generation Policy

- 관련 요구사항: `FR-ID-001..008`, `FR-REQ-013..015`, `FR-MCP-007`, `FR-CLI-009`
- 파일 경로: `src/core/id-generator.ts`, `src/core/requirement-create.ts`, `test/core/id-generator.test.ts`
- 시그니처: `previewRequirementId`, `assertExplicitRequirementId`
- 참고 패턴: requirement ID 정책은 SRS와 보완 결정 문서가 기준이다.
- source_anchors: `docs/spec/srs.md:505-576`, `speckiwi-v1-docs/12_IMPLEMENTATION_READINESS_DECISIONS.md:596-612`
- 구현 가이드: type prefix, scope segment, max sequence, explicit ID priority, duplicate rejection, read-only preview를 구현한다.
- Rationale: proposal 생성과 requirement create가 같은 ID 규칙을 공유해야 한다.
- 함정/주의사항: preview는 proposal/YAML/cache를 쓰지 않는다.
- 테스트: next sequence, collision retry, explicit ID, duplicate explicit ID, read-only preview
- 검증: `npm test -- id-generator`
- acceptance_tests: bash/pwsh 각각 `npm test -- id-generator`, expected_exit 0
- DoD: ID 정책 fixture 통과, duplicate explicit ID ErrorResult, preview read-only
- rollback: `manual` - 1) Git에 추적된 owns 경로는 `git restore -- <tracked owns>`로 되돌린다. 2) Git에 아직 추적되지 않은 owns 파일/디렉토리만 목록과 대조해 삭제한 뒤 task 검증 명령으로 rollback을 확인한다.

## Phase P4 - Search And Cache

목표: exact/BM25/Korean search와 재생성 가능한 JSON cache를 구현한다.

### TASK-P4-001 - Implement Flat Document Indexing, Exact Lookup, BM25, Korean N-Gram, And Dictionary Expansion

- 관련 요구사항: `FR-SRCH-001..009`, `FR-KR-001..009`, `FR-DICT-001..005`, `NFR-PERF-001`, `NFR-PERF-002`, `NFR-MAINT-003`, `NFR-MAINT-004`, `NFR-UX-004`
- 파일 경로: `src/search/document.ts`, `src/search/tokenizer.ts`, `src/search/korean.ts`, `src/search/bm25.ts`, `src/search/index.ts`, `src/core/search.ts`, `test/search/search.test.ts`
- 시그니처: `flattenWorkspace`, `tokenizeKorean`, `search`
- 참고 패턴: search spec이 exact, BM25, Korean n-gram, dictionary expansion을 정의한다.
- source_anchors: `docs/spec/srs.md:776-842`, `speckiwi-v1-docs/07_SEARCH_SPEC.md:1-40`
- 구현 가이드: overview goals/nonGoals/glossary, PRD item, SRS requirement, technical section, ADR, rule, document metadata, scope metadata를 모두 typed SearchDocument row로 만든다. requirement/document/scope/PRD item/technical section/ADR/rule ID exact index를 만들고, title/statement/rationale/description/tags/acceptanceCriteria/glossary/section heading/ADR decision/rule text를 BM25 field로 인덱싱한다. Korean 2/3-gram tokenizer와 dictionary synonym expansion을 검색 전 처리하고, 결과에는 entity type, source path, score, matchedFields를 포함한다.
- Rationale: local search는 사람과 AI 에이전트의 primary discovery path다.
- 함정/주의사항: vector DB를 도입하지 않는다. exact ID lookup은 score ranking에 묻히지 않아야 한다.
- 테스트: requirement/document/scope/PRD item/technical section/ADR/rule exact ID, overview goals/nonGoals/glossary, requirement fields, PRD item text, technical section text, ADR decision text, rule text, filters, pagination, score order, matchedFields, Korean phrase, synonym expansion
- 검증: `npm test -- search`
- acceptance_tests: bash/pwsh 각각 `npm test -- search`, expected_exit 0
- DoD: entity type/score/source path/matchedFields 포함, 모든 SRS search target entity exact ID 테스트 통과, overview/PRD/SRS/technical/ADR/rule BM25 field 테스트 통과, Korean tokenizer pass, dictionary absence fallback pass
- rollback: `manual` - 1) Git에 추적된 owns 경로는 `git restore -- <tracked owns>`로 되돌린다. 2) Git에 아직 추적되지 않은 owns 파일/디렉토리만 목록과 대조해 삭제한 뒤 task 검증 명령으로 rollback을 확인한다.

### TASK-P4-002 - Implement Cache Manifest, Stale Detection, Rebuild, Clean, And Degraded Fallback

- 관련 요구사항: `FR-CACHE-001..008`, `FR-DIR-009`, `FR-STOR-002`, `FR-STOR-006`, `NFR-REL-005`, `NFR-REL-006`, `NFR-PERF-003`, `NFR-PERF-006`
- 파일 경로: `src/cache/hash.ts`, `src/cache/manifest.ts`, `src/cache/rebuild.ts`, `src/cache/clean.ts`, `src/core/cache.ts`, `test/cache/cache.test.ts`
- 시그니처: `rebuildCache`, `cleanCache`, `isCacheStale`
- 참고 패턴: cache manifest와 hash behavior는 보완 결정 문서가 기준이다.
- source_anchors: `docs/spec/srs.md:999-1038`, `speckiwi-v1-docs/12_IMPLEMENTATION_READINESS_DECISIONS.md:1499-1591`
- 구현 가이드: input YAML/schema/package version hash를 기록하고 graph/search/diagnostics cache를 성공 시에만 쓴다. `--no-cache`는 read/write를 모두 우회한다.
- Rationale: cache는 성능 장치이지 원본이 아니다.
- 함정/주의사항: timestamp, host path, OS separator를 manifest에 쓰지 않는다.
- 테스트: stale, corruption fallback, rebuild, clean, no-cache
- 검증: `npm test -- cache`
- acceptance_tests: bash/pwsh 각각 `npm test -- cache`, expected_exit 0
- DoD: manifest와 section cache 생성, clean이 cache 내부만 제거, corrupt cache fallback
- rollback: `manual` - 1) Git에 추적된 owns 경로는 `git restore -- <tracked owns>`로 되돌린다. 2) Git에 아직 추적되지 않은 owns 파일/디렉토리만 목록과 대조해 삭제한 뒤 task 검증 명령으로 rollback을 확인한다.

## Phase P5 - CLI Read Commands And Doctor

목표: Core read services를 human/JSON CLI로 노출한다.

### TASK-P5-001 - Implement CLI Adapter Common Options, Exit Codes, And Doctor

- 관련 요구사항: `FR-CLI-001..012`, `FR-DOC-CHK-001..008`, `NFR-UX-001..008`, `NFR-SEC-001..005`
- 파일 경로: `src/cli/program.ts`, `src/cli/options.ts`, `src/cli/exit-code.ts`, `src/cli/human-renderer.ts`, `src/core/doctor.ts`, `test/cli/common.test.ts`, `test/cli/doctor.test.ts`
- 시그니처: `runCli`, `mapCoreResultToExitCode`, `doctor`
- 참고 패턴: CLI JSON stdout과 exit code는 CLI spec과 보완 결정 문서가 기준이다.
- source_anchors: `speckiwi-v1-docs/06_CLI_SPEC.md:22-49`, `speckiwi-v1-docs/12_IMPLEMENTATION_READINESS_DECISIONS.md:638-659`
- 구현 가이드: 공통 옵션을 한 곳에서 parse하고, human renderer와 JSON renderer를 분리한다. Doctor는 Node version, workspace, 필수 파일, YAML parse, cache, MCP 실행 가능성, stdout 정책을 점검한다.
- Rationale: CLI는 개발자와 자동화의 기본 진입점이다.
- 함정/주의사항: `--json` 모드의 diagnostic log는 stdout에 쓰지 않는다.
- 테스트: child process 기반 stdout/stderr/exit code
- 검증: `npm test -- cli`
- acceptance_tests: bash/pwsh 각각 `npm test -- cli`, expected_exit 0
- DoD: JSON stdout 객체 1개, doctor human/JSON, exit code mapping
- rollback: `manual` - 1) Git에 추적된 owns 경로는 `git restore -- <tracked owns>`로 되돌린다. 2) Git에 아직 추적되지 않은 owns 파일/디렉토리만 목록과 대조해 삭제한 뒤 task 검증 명령으로 rollback을 확인한다.

### TASK-P5-002 - Wire Read-Only CLI Commands For Overview, List, Search, Req Get, Graph, And Impact

- 관련 요구사항: `FR-OVR-002..005`, `FR-REQ-002..012`, `FR-SRCH-001..009`, `FR-GRAPH-001..011`, `FR-CLI-003..010`, `NFR-UX-001..006`
- 파일 경로: `src/cli/commands/overview.ts`, `src/cli/commands/list.ts`, `src/cli/commands/search.ts`, `src/cli/commands/req.ts`, `src/cli/commands/graph.ts`, `src/cli/commands/impact.ts`, `test/cli/read-commands.test.ts`
- 시그니처: `registerOverviewCommand`, `registerListCommands`, `registerSearchCommand`, `registerRequirementCommands`, `registerGraphCommand`, `registerImpactCommand`
- 참고 패턴: CLI spec의 command examples를 따른다.
- source_anchors: `speckiwi-v1-docs/06_CLI_SPEC.md:163-324`
- 구현 가이드: 각 command는 Core input DTO를 만들고 Core 결과를 renderer로 전달한다. list/search filters, graph alias normalization, impact requirement-ID 전용 정책을 구현한다.
- Rationale: write 기능 전에도 workspace 조회와 검증 가능한 탐색이 가능해야 한다.
- 함정/주의사항: CLI에서 Core filtering을 재구현하지 않는다.
- 테스트: fixture workspace에서 human/JSON command 출력
- 검증: `npm test -- read-commands`
- acceptance_tests: bash/pwsh 각각 `npm test -- read-commands`, expected_exit 0
- DoD: overview/list/search/req get/graph/impact 동작, JSON parse 가능, search score order
- rollback: `manual` - 1) Git에 추적된 owns 경로는 `git restore -- <tracked owns>`로 되돌린다. 2) Git에 아직 추적되지 않은 owns 파일/디렉토리만 목록과 대조해 삭제한 뒤 task 검증 명령으로 rollback을 확인한다.

## Phase P6 - Proposal, Apply, And Requirement Mutations

목표: agent write 기본값을 propose로 유지하고, validation을 통과한 apply만 허용한다.

### TASK-P6-001 - Implement Proposal Schema, Hashes, Stale Detection, And Propose Mode

- 관련 요구사항: `FR-WRITE-001..003`, `FR-WRITE-010..011`, `FR-REQ-013..015`, `NFR-SEC-006..009`, `NFR-UX-006`
- 파일 경로: `src/write/hash.ts`, `src/write/proposal.ts`, `src/write/patch.ts`, `src/core/propose-change.ts`, `test/write/proposal.test.ts`
- 시그니처: `createProposal`, `canonicalJsonHash`, `buildPatchOperations`
- 참고 패턴: proposal target shape, targetHash, stale behavior는 보완 결정 문서가 기준이다.
- source_anchors: `docs/spec/srs.md:1041-1123`, `speckiwi-v1-docs/12_IMPLEMENTATION_READINESS_DECISIONS.md:1619-1686`
- 구현 가이드: `.speckiwi/proposals`에 proposal YAML을 쓰고, discriminated target.kind와 RFC 8785 canonical hash를 사용한다. req create/update 기본 경로는 proposal 생성이다.
- Rationale: AI agent가 원본 YAML을 바로 바꾸지 않게 한다.
- 함정/주의사항: root JSON Pointer로 전체 문서를 교체하지 않는다.
- 테스트: proposal shape, no source mutation, hash determinism, stale detection, duplicate explicit ID
- 검증: `npm test -- proposal`
- acceptance_tests: bash/pwsh 각각 `npm test -- proposal`, expected_exit 0
- DoD: propose mode는 proposal만 작성, target.path schema reject, target hash stable
- rollback: `manual` - 1) Git에 추적된 owns 경로는 `git restore -- <tracked owns>`로 되돌린다. 2) Git에 아직 추적되지 않은 owns 파일/디렉토리만 목록과 대조해 삭제한 뒤 task 검증 명령으로 rollback을 확인한다.

### TASK-P6-002 - Implement Apply Engine, Atomic Writes, Cache Stale Marking, And Req Create/Update CLI

- 관련 요구사항: `FR-WRITE-004..009`, `FR-VAL-005..007`, `FR-CLI-011`, `NFR-REL-003..004`, `NFR-UX-007`
- 파일 경로: `src/write/apply.ts`, `src/write/yaml-update.ts`, `src/write/lock.ts`, `src/core/apply-change.ts`, `src/cli/commands/req-write.ts`, `test/write/apply.test.ts`, `test/write/apply-concurrency.test.ts`, `test/cli/req-write.test.ts`
- 시그니처: `applyChange`, `applyProposalToDocument`, `withTargetWriteLock`, `registerRequirementWriteCommands`
- 참고 패턴: ApplyChangeInput union과 confirm rule은 보완 결정 문서가 기준이다.
- source_anchors: `speckiwi-v1-docs/12_IMPLEMENTATION_READINESS_DECISIONS.md:551-553`, `speckiwi-v1-docs/12_IMPLEMENTATION_READINESS_DECISIONS.md:1675-1727`
- 구현 가이드: proposalId/proposalPath/change 중 정확히 하나만 허용하고 confirm true를 요구한다. validation error와 stale hash는 apply를 막는다. target별 write lock을 획득하고, validation 이후 rename 직전에 base hash를 다시 확인해 race를 deterministic conflict로 반환한다. temp path는 process/target별로 유일해야 한다. rename 전 rollback-capable backup 또는 temp copy를 만들고, permission/lock/atomic write 실패의 ErrorResult에는 원인과 복구 절차를 포함한다. cache stale marker는 target rename 성공 이후에만 쓴다.
- Rationale: apply는 최고 위험 기능이므로 좁고 검증 가능해야 한다.
- 함정/주의사항: `allowApply=false`에서는 apply를 거부한다. partial write를 남기지 않는다.
- 테스트: confirm missing, stale proposal, validation error, permission failure, lock conflict, same-file concurrent apply, stale-after-validation race, atomic write failure, backup/temp copy reporting, recovery guidance in ErrorResult, successful apply, cache stale marker consistency
- 검증: `npm test -- apply`
- acceptance_tests: bash/pwsh 각각 `npm test -- apply`, expected_exit 0
- DoD: stale proposal reject, same-target concurrent apply는 한쪽 성공과 한쪽 deterministic conflict/stale error, validation 이후 rename 직전 base hash 재확인, atomic failure 원본 보존과 복구 절차 출력, backup/temp copy test 통과, cache stale marker는 successful rename 이후 기록, req update 기본 propose
- rollback: `manual` - 1) Git에 추적된 owns 경로는 `git restore -- <tracked owns>`로 되돌린다. 2) Git에 아직 추적되지 않은 owns 파일/디렉토리만 목록과 대조해 삭제한 뒤 task 검증 명령으로 rollback을 확인한다.

## Phase P7 - MCP Stdio Adapter

목표: AI coding agent가 stdio MCP로 Core를 안전하게 호출하게 한다.

### TASK-P7-001 - Implement MCP Server, Stdio Transport, Tools, And Input Schemas

- 관련 요구사항: `FR-MCP-001..013`, `FR-MCP-TR-001..006`, `FR-PKG-002`, `NFR-SEC-001..005`, `NFR-SEC-008`
- 파일 경로: `src/mcp/server.ts`, `src/mcp/tools.ts`, `src/mcp/schemas.ts`, `src/cli/commands/mcp.ts`, `test/mcp/tools.test.ts`
- 시그니처: `runMcpServer`, `registerMcpTools`, `toolResultFromCore`
- 참고 패턴: MCP tool list와 structuredContent 규칙은 MCP spec이 기준이다.
- source_anchors: `speckiwi-v1-docs/05_MCP_TOOL_SPEC.md:31-117`, `speckiwi-v1-docs/05_MCP_TOOL_SPEC.md:124-572`
- 구현 가이드: `speckiwi mcp --root`에서만 stdio server를 시작하고 tool input의 root override를 거부한다. 13개 required tool을 등록하고 Core DTO를 structuredContent로 반환한다.
- Rationale: MCP는 AI 에이전트용 공식 인터페이스다.
- 함정/주의사항: stdout에는 protocol 외 로그를 쓰지 않는다. HTTP endpoint를 만들지 않는다.
- 테스트: tool schema, read-only calls, apply rejection, stdout policy
- 검증: `npm test -- mcp`
- acceptance_tests: bash/pwsh 각각 `npm test -- mcp`, expected_exit 0
- DoD: 13개 tool 등록, stdout 정책 통과, root override reject
- rollback: `manual` - 1) Git에 추적된 owns 경로는 `git restore -- <tracked owns>`로 되돌린다. 2) Git에 아직 추적되지 않은 owns 파일/디렉토리만 목록과 대조해 삭제한 뒤 task 검증 명령으로 rollback을 확인한다.

### TASK-P7-002 - Implement MCP Resources For Overview, Index, Documents, Requirements, And Scopes

- 관련 요구사항: `FR-OVR-002`, `FR-MCP-TR-005..006`, `FR-MCP-001..013`, `NFR-UX-002`
- 파일 경로: `src/mcp/resources.ts`, `src/mcp/resource-uri.ts`, `test/mcp/resources.test.ts`
- 시그니처: `parseSpeckiwiResourceUri`, `readMcpResource`
- 참고 패턴: MCP resources는 Core DTO envelope가 아니라 `ReadResourceResult.contents[]`를 사용한다.
- source_anchors: `speckiwi-v1-docs/05_MCP_TOOL_SPEC.md:60-91`, `speckiwi-v1-docs/12_IMPLEMENTATION_READINESS_DECISIONS.md:824-858`
- 구현 가이드: `speckiwi://overview`, `speckiwi://index`, registered documents, requirement context, scope context를 읽는다. malformed/unknown URI는 명세의 JSON-RPC error로 반환한다.
- Rationale: 에이전트가 context를 resource로 직접 로드할 수 있어야 한다.
- 함정/주의사항: resource 결과를 CoreResult envelope로 감싸지 않는다.
- 테스트: URI별 성공, malformed URI, unknown ID, MIME type, root boundary
- 검증: `npm test -- mcp-resources`
- acceptance_tests: bash/pwsh 각각 `npm test -- mcp-resources`, expected_exit 0
- DoD: overview/index YAML MIME, requirement/scope JSON, malformed URI error
- rollback: `manual` - 1) Git에 추적된 owns 경로는 `git restore -- <tracked owns>`로 되돌린다. 2) Git에 아직 추적되지 않은 owns 파일/디렉토리만 목록과 대조해 삭제한 뒤 task 검증 명령으로 rollback을 확인한다.

## Phase P8 - Markdown Export

목표: YAML 원본을 사람이 읽는 Markdown 산출물로 deterministic export한다.

### TASK-P8-001 - Implement Markdown Exporter For Overview, SRS, PRD, Technical, ADR, And Export Index

- 관련 요구사항: `FR-EXP-001..012`, `FR-OVR-005`, `FR-REQ-012`, `FR-PRD-004`, `FR-TECH-004`, `FR-ADR-005`, `FR-DIR-010`, `FR-STOR-003`
- 파일 경로: `src/export/markdown.ts`, `src/export/templates.ts`, `src/core/export-markdown.ts`, `src/cli/commands/export.ts`, `test/export/markdown.test.ts`, `test/cli/export.test.ts`
- 시그니처: `exportMarkdown`, `renderDocumentMarkdown`, `renderExportIndex`
- 참고 패턴: Markdown export spec이 지원 type, index behavior, JSON result를 정의한다.
- source_anchors: `speckiwi-v1-docs/10_MARKDOWN_EXPORT_SPEC.md:1-80`, `speckiwi-v1-docs/10_MARKDOWN_EXPORT_SPEC.md:104-226`
- 구현 가이드: export 전 validation option을 처리하고, exportable document type만 렌더링한다. `index.md`는 manifest registry에서 만들며 `index.yaml` 원본 export가 아니다.
- Rationale: Markdown은 읽기 산출물이고 YAML이 원본이다.
- 함정/주의사항: Markdown import를 추가하지 않는다. rule/dictionary export는 v1 지원 대상이 아니다.
- 테스트: overview/SRS/PRD/technical/ADR/index/out/type/document/unsupported/JSON
- 검증: `npm test -- export`
- acceptance_tests: bash/pwsh 각각 `npm test -- export`, expected_exit 0
- DoD: supported files 생성, ExportResult relative writtenFiles, unsupported type error
- rollback: `manual` - 1) Git에 추적된 owns 경로는 `git restore -- <tracked owns>`로 되돌린다. 2) Git에 아직 추적되지 않은 owns 파일/디렉토리만 목록과 대조해 삭제한 뒤 task 검증 명령으로 rollback을 확인한다.

## Phase P9 - Hardening, Performance, And Release Readiness

목표: release gate, security, reliability, cross-platform, packaging을 닫는다.

### TASK-P9-001 - Add Hardening Suites For Security, Reliability, Cross-Platform, And Performance Targets

- 관련 요구사항: `OOS-001..010`, `NFR-SEC-001..009`, `NFR-REL-001..007`, `NFR-PERF-001..006`, `NFR-COMP-001..007`, `NFR-UX-001..008`
- 파일 경로: `test/hardening/security.test.ts`, `test/hardening/reliability.test.ts`, `test/hardening/cross-platform.test.ts`, `test/perf/perf.test.ts`
- 시그니처: `buildLargeWorkspaceFixture`, `assertNoDbOrHttpArtifacts`
- 참고 패턴: SRS release criteria와 hardening milestone을 따른다.
- source_anchors: `docs/spec/srs.md:1313-1368`, `docs/spec/srs.md:1450-1516`, `speckiwi-v1-docs/11_IMPLEMENTATION_PLAN.md:295-315`
- 구현 가이드: traversal, invalid YAML, duplicate ID, cache corruption, MCP stdout, Windows path, large workspace, no DB/HTTP artifact 테스트를 작성한다. sentinel 환경변수 값을 주입하고, 명시적 user content로 전달하지 않은 값이 `.speckiwi/**/*.yaml`, proposal, cache, diagnostics, CLI JSON, MCP structuredContent, Markdown export에 직렬화되지 않는지 검증한다.
- Rationale: v1은 기능뿐 아니라 금지 범위 준수로 release 가능성이 결정된다.
- 함정/주의사항: temp directory만 사용하고 developer home path를 건드리지 않는다.
- 테스트: hardening suite, environment-leak suite, perf report
- 검증: `npm test -- hardening`
- acceptance_tests: bash/pwsh 각각 `npm test -- hardening`, expected_exit 0
- DoD: traversal reject, DB/HTTP artifact 없음, sentinel 환경변수 값이 generated YAML/proposal/cache/diagnostics/CLI JSON/MCP structuredContent/export에 없음, cache corruption fallback, performance timing report
- rollback: `manual` - 1) Git에 추적된 owns 경로는 `git restore -- <tracked owns>`로 되돌린다. 2) Git에 아직 추적되지 않은 owns 파일/디렉토리만 목록과 대조해 삭제한 뒤 task 검증 명령으로 rollback을 확인한다.

### TASK-P9-002 - Add Package Dry-Run, Release Checklist, And V1 Acceptance Gate

- 관련 요구사항: `FR-PKG-001..006`, `FR-CLI-001..012`, `FR-MCP-001..013`, `FR-EXP-001..012`, `NFR-COMP-001..007`
- 파일 경로: `test/release/acceptance.test.ts`, `scripts/release-check.mjs`, `package.json`, `README.md`
- 시그니처: `runReleaseCheck`, `assertV1Acceptance`
- 참고 패턴: v1 acceptance checklist와 install examples가 release gate다.
- source_anchors: `docs/spec/srs.md:1450-1516`, `speckiwi-v1-docs/00_README.md:24-51`, `speckiwi-v1-docs/11_IMPLEMENTATION_PLAN.md:332-340`
- 구현 가이드: build/typecheck/lint/test/npm pack dry-run을 실행하는 release-check를 만들고, fixture workspace에서 CLI acceptance command와 MCP smoke startup을 검증한다. README command examples를 실제 CLI와 맞춘다.
- Rationale: package dry-run과 문서 예제가 맞아야 v1을 설치 가능 상태로 볼 수 있다.
- 함정/주의사항: release-check는 publish를 실행하지 않는다. Java, Python, DB runtime, daemon을 요구하지 않는다.
- 테스트: release-check success/failure propagation과 fixture acceptance
- 검증: `npm test -- release`
- acceptance_tests: bash/pwsh 각각 `npm test -- release`, `npm pack --dry-run`, expected_exit 0
- DoD: release-check 0, npm pack includes dist/schemas/bin/package metadata, README examples match CLI
- rollback: `manual` - 1) Git에 추적된 owns 경로는 `git restore -- <tracked owns>`로 되돌린다. 2) Git에 아직 추적되지 않은 owns 파일/디렉토리만 목록과 대조해 삭제한 뒤 task 검증 명령으로 rollback을 확인한다.

## 스펙 매핑 표

| 요구사항 범위 | TASK |
|---|---|
| `OOS-001..010` | `TASK-P0-001`, `TASK-P9-001`, `TASK-P9-002` |
| `FR-DIR-001..010`, `FR-STOR-001..007`, `FR-YAML-001..010` | `TASK-P1-001`, `TASK-P1-002`, `TASK-P2-002` |
| `FR-DOC-001..011`, `FR-IDX-001..014`, `FR-OVR-001..005`, `FR-SRS-DOC-001..004`, `FR-PRD-001..005`, `FR-TECH-001..005`, `FR-ADR-001..005`, `FR-DICT-001..005` | `TASK-P1-002`, `TASK-P2-001`, `TASK-P2-002`, `TASK-P5-002`, `TASK-P8-001` |
| `FR-REQ-001..015`, `FR-ID-001..008`, `FR-REL-001..007`, `FR-LINK-001..003`, `FR-GRAPH-001..011` | `TASK-P2-002`, `TASK-P3-001`, `TASK-P3-002`, `TASK-P5-002`, `TASK-P6-001`, `TASK-P6-002` |
| `FR-SRCH-001..009`, `FR-KR-001..009`, `FR-CACHE-001..008` | `TASK-P4-001`, `TASK-P4-002`, `TASK-P5-002` |
| `VAL-ERR-001..022`, `VAL-WARN-001..008`, `FR-VAL-001..007` | `TASK-P2-002`, `TASK-P5-001`, `TASK-P7-001` |
| `FR-WRITE-001..011` | `TASK-P6-001`, `TASK-P6-002`, `TASK-P7-001` |
| `FR-CLI-001..012`, `FR-DOC-CHK-001..008` | `TASK-P0-001`, `TASK-P0-002`, `TASK-P5-001`, `TASK-P5-002`, `TASK-P6-002`, `TASK-P8-001` |
| `FR-MCP-001..013`, `FR-MCP-TR-001..006` | `TASK-P0-002`, `TASK-P7-001`, `TASK-P7-002` |
| `FR-EXP-001..012` | `TASK-P8-001` |
| `FR-PKG-001..006` | `TASK-P0-001`, `TASK-P9-002` |
| `NFR-SEC-001..009`, `NFR-REL-001..007`, `NFR-PERF-001..006`, `NFR-COMP-001..007`, `NFR-MAINT-001..008`, `NFR-UX-001..008` | `TASK-P0-001`, `TASK-P0-002`, `TASK-P1-001`, `TASK-P2-002`, `TASK-P4-001`, `TASK-P4-002`, `TASK-P5-001`, `TASK-P6-002`, `TASK-P7-001`, `TASK-P9-001`, `TASK-P9-002` |

## 리스크 및 완화

| 리스크 | 심각도 | 완화 |
|---|---|---|
| validation과 proposal/apply는 cross-document invariant가 많아 회귀 위험이 높다. | High | semantic validation을 write보다 먼저 완성하고 apply test를 strict로 운영한다. |
| MCP stdout log가 protocol transport를 깨뜨릴 수 있다. | High | MCP 완료 조건에 process-level stdout/stderr test를 포함한다. |
| search performance target은 fixture 규모와 local IO 영향을 받는다. | Medium | correctness test와 measured performance report를 분리하고 cache fallback을 deterministic하게 유지한다. |

## 용어집

| 용어 | 정의 |
|---|---|
| SDD | Spec-Driven Development. 요구사항과 설계 문서를 구현 맥락의 중심에 두는 개발 방식 |
| StorePath | `.speckiwi/` 내부 POSIX 상대 경로 |
| WorkspacePath | workspace root 기준 `.speckiwi/`로 시작하는 표시용 경로 |
| Core DTO | Core가 반환하고 CLI JSON 및 MCP structuredContent가 공유하는 JSON-compatible 객체 |
| DiagnosticBag | errors, warnings, info를 분리해 담는 diagnostics 구조 |
| Proposal | 원본 YAML을 바로 수정하지 않고 변경 의도를 저장하는 managed YAML artifact |
| Stale proposal | proposal 생성 당시 target hash와 현재 target hash가 달라 apply를 거부해야 하는 proposal |
| BM25 | term frequency 기반 ranking search 알고리즘 |
| MCP | Model Context Protocol. AI coding agent와 local tool을 연결하는 stdio protocol |

## 메타

- planner mode: NORMAL
- 프리스크린: Phase 수 10개이므로 별도 Phase 그룹핑은 기존 implementation milestone을 재사용
- QNA: 사용자 결정이 필요한 business-decision 질문 없음
- 동적 시니어 트리거: 보안/쓰기/MCP/high-risk 키워드 감지됨. 본 계획은 High TASK에 strict review를 부여하는 방식으로 완화
- 평가 라운드: xhigh-depth evaluator 1명과 normal-formal evaluator 1명으로 검토 완료
- 잔존 findings: CRITICAL 0, HIGH 0, MEDIUM 0
- 게이트 결과: Normal Phase-1 clean PASS, plan-contract validator 0 error/0 warning
- 다음 실행 힌트: `/snoworca-coder PLAN_PATH=docs/plans/plan-20260501-speckiwi-v1-implementation.md --tdd`
