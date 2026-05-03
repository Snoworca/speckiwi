---
plan_contract: "1.1.0"
plan_id: "plan-20260502-speckiwi-verification-hardening-v1"
previous_hash: null
produced_by: "snoworca-planner@2.2.2"
title: "SpecKiwi SRS verification hardening plan"
mode: "NORMAL"
produced_at: "2026-05-02T22:20:00+09:00"
spec_path: "docs/spec/srs.md"
spec_refs:
  - "docs/spec/srs.md"
  - "docs/reports/20260502-speckiwi-srs-verification-findings.md"
code_path: "."
output_path: "docs/plans/plan-20260502-speckiwi-verification-hardening-v1.md"
scope_freeze: true
change_log: []
platforms:
  - "posix"
  - "win32"
pre_commit_gate:
  - {shell: "bash", cmd: "npm run build", expected_exit: 0}
  - {shell: "pwsh", cmd: "npm run build", expected_exit: 0}
  - {shell: "bash", cmd: "npm run typecheck", expected_exit: 0}
  - {shell: "pwsh", cmd: "npm run typecheck", expected_exit: 0}
  - {shell: "bash", cmd: "npm run lint", expected_exit: 0}
  - {shell: "pwsh", cmd: "npm run lint", expected_exit: 0}
  - {shell: "bash", cmd: "npm test -- test/hardening/security.test.ts test/cli/req-write.test.ts test/cli/read-commands.test.ts test/cli/export.test.ts test/mcp/tools.test.ts test/perf/perf.test.ts test/cache/cache.test.ts test/graph/graph.test.ts test/smoke/package.test.ts", expected_exit: 0}
  - {shell: "pwsh", cmd: "npm test -- test/hardening/security.test.ts test/cli/req-write.test.ts test/cli/read-commands.test.ts test/cli/export.test.ts test/mcp/tools.test.ts test/perf/perf.test.ts test/cache/cache.test.ts test/graph/graph.test.ts test/smoke/package.test.ts", expected_exit: 0}
  - {shell: "bash", cmd: "npm run perf:srs", expected_exit: 0}
  - {shell: "pwsh", cmd: "npm run perf:srs", expected_exit: 0}
  - {shell: "bash", cmd: "npm run release:check", expected_exit: 0}
  - {shell: "pwsh", cmd: "npm run release:check", expected_exit: 0}
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
  - {pattern: "적[절]히|필요\\s*시|알아[서]|상황에\\s*맞게|기존\\s*방식대로|어떻게[든]", flags: ""}
phases:
  - id: "PHASE-P1"
    title: "Cache path security and source boundary"
    tasks:
      - {id: "TASK-P1-001"}
      - {id: "TASK-P1-002"}
  - id: "PHASE-P2"
    title: "Deterministic validation diagnostics"
    tasks:
      - {id: "TASK-P2-001"}
  - id: "PHASE-P3"
    title: "Strict no-cache write path"
    tasks:
      - {id: "TASK-P3-001"}
      - {id: "TASK-P3-002"}
  - id: "PHASE-P4"
    title: "Package dependency hardening"
    tasks:
      - {id: "TASK-P4-001"}
  - id: "PHASE-P5"
    title: "Graph cache read path"
    tasks:
      - {id: "TASK-P5-001"}
  - id: "PHASE-P6"
    title: "MCP performance evidence"
    tasks:
      - {id: "TASK-P6-001"}
---

# SpecKiwi SRS Verification Hardening Plan

## 개요

이 계획은 `docs/spec/srs.md`와 2026-05-02 기능 검증 보고서에서 남은 SRS 불일치 항목을 닫기 위한 보완 계획이다. 현재 `typecheck`, `lint`, 전체 테스트, `perf:srs`, `release:check`는 메인 검증에서 통과했지만, 3개 서브에이전트 검토에서 보안 경계, `--no-cache` 계약, 패키징 의존성, graph cache 활용, 실제 MCP 성능 증거가 완전하지 않다고 판정했다.

목표는 기능 구현 자체를 확장하는 것이 아니라 SRS의 관찰 가능한 계약을 더 엄격하게 만드는 것이다. 성능 알고리즘 개선은 본 계획의 범위가 아니며, 성능 계측이 실제 MCP 경로를 보도록 고치는 작업만 포함한다.

JSON 사이드카: `docs/plans/plan-20260502-speckiwi-verification-hardening-v1.md.json`

## 선행 조건 및 전제

- `.speckiwi/**/*.yaml`은 source of truth다.
- `.speckiwi/cache/**/*.json`과 `.speckiwi/cache/manifest.json`은 재생성 가능한 artifact다.
- `--no-cache`는 cache read와 write를 모두 우회해야 한다.
- workspace 밖 realpath escape는 CLI, Core, MCP에서 deterministic diagnostic 또는 MCP error data로 관찰되어야 한다.
- 새 외부 dependency 추가는 direct runtime import가 이미 있는 경우에만 허용한다.
- 성능 최적화는 별도 성능 계획으로 넘긴다.

## 프로젝트 온보딩 컨텍스트

SpecKiwi는 repository-local `.speckiwi/` YAML 문서를 읽어 CLI와 stdio MCP로 SDD context 조회, 검색, 검증, graph, write proposal, markdown export를 제공하는 Node.js/TypeScript 도구다. 데이터베이스와 HTTP 서버는 v1 범위 밖이다.

주요 디렉토리 맵:

| 경로 | 역할 |
|---|---|
| `src/core/` | CLI/MCP가 공유하는 Core API와 read model orchestration |
| `src/cache/` | cache manifest, fingerprint, rebuild, clean |
| `src/indexing/` | serialized cache artifact envelope와 runtime index |
| `src/io/` | workspace path, realpath guard, YAML loader |
| `src/mcp/` | stdio MCP tool/resource schema, handler, structuredContent |
| `src/write/` | proposal 생성, JSON Patch 적용, apply lock, atomic write |
| `src/graph/` | graph, trace, impact DTO 생성 |
| `test/` | Vitest unit, CLI, MCP, hardening, release acceptance tests |

빌드와 테스트 치트시트:

| 목적 | 명령 |
|---|---|
| 빌드 | `npm run build` |
| 타입 검사 | `npm run typecheck` |
| 정적 분석 | `npm run lint` |
| 전체 테스트 | `npm test` |
| SRS 성능 검증 | `npm run perf:srs` |
| release gate | `npm run release:check` |

## AI 에이전트 실행 가드

`scope_freeze`는 계획 생성 게이트 통과 후 `true`로 고정했다. scope 확장은 사용자 승인을 받은 `change_log` 항목으로만 추가한다.

`pre_commit_gate`와 `forbidden_patterns`는 frontmatter를 SSOT로 사용한다. 각 TASK의 `acceptance_tests`는 TASK 종료 시점 검증이고, `pre_commit_gate`는 전체 작업 완료 뒤 커밋 직전 검증이다.

## Phase P1 - Cache Path Security And Source Boundary

목표: cache manifest와 read-model metadata 경로가 artifact 본문과 같은 realpath guard를 사용하게 만들어 workspace 밖 파일 read/write를 차단한다.

### TASK-P1-001 - Guard Cache Manifest Read And Write Paths

- 관련 REQ-ID: `NFR-SEC-003`, `NFR-SEC-004`, `NFR-SEC-005`, `NFR-SEC-010`, `FR-CACHE-002`, `FR-CACHE-008`
- 파일 경로: `src/cache/manifest.ts`, `src/cache/rebuild.ts`, `src/core/read-model.ts`, `src/core/requirements.ts`, `test/hardening/security.test.ts`, `test/cache/cache.test.ts`
- 메서드/함수 시그니처:
  - `export async function readCacheManifest(root: WorkspaceRoot): Promise<CacheManifest | undefined>`
  - `export async function readCacheManifestFile(root: WorkspaceRoot): Promise<{ manifest?: CacheManifest; warning?: Diagnostic }>`
  - `export async function writeCacheManifest(root: WorkspaceRoot, manifest: CacheManifest): Promise<void>`
  - `async function hashManifestOrMissing(root: WorkspaceRoot): Promise<string>`
- 참고 패턴:
  - `src/cache/manifest.ts:64-75`의 현재 direct manifest read 경로를 realpath guard 경로로 교체한다.
  - `src/cache/rebuild.ts:89-93`의 manifest write도 direct path가 아니라 guarded helper로 이동한다.
  - `src/core/read-model.ts:261-280`의 memo key manifest hash 산출에서 direct path read를 제거한다.
  - `src/indexing/serialization.ts:31-52`의 cache artifact read guard 패턴을 따른다.
- source_anchors:
  - `src/cache/manifest.ts:64-75`
  - `src/cache/rebuild.ts:89-93`
  - `src/core/read-model.ts:261-280`
  - `src/core/read-model.ts:347-353`
  - `src/core/requirements.ts:1072-1085`
  - `src/core/requirements.ts:1145-1148`
  - `src/indexing/serialization.ts:31-52`
- 구현 가이드:
  1. `readCacheManifest()` 내부에서 `resolve(root.speckiwiPath, ...)`를 직접 쓰지 말고 `resolveRealStorePath(root, normalizeStorePath("cache/manifest.json"))`를 사용한다.
  2. manifest parse 실패와 shape 불일치는 기존처럼 `undefined`로 degrade한다.
  3. realpath escape는 outside content를 읽지 않고 `undefined` 또는 security warning으로 처리한다. public API가 warning을 받을 수 있는 위치에는 `readCacheManifestFile()`을 사용한다.
  4. `rebuildCache()`의 manifest write는 `writeCacheManifest()` helper로 이동하고 helper 안에서 `resolveRealStorePath()`와 `atomicWriteText()`를 결합한다.
  5. `buildReadModelCacheKey()`의 `hashFileOrMissing()`은 `hashManifestOrMissing(root)`로 바꾸고, helper 안에서 guarded manifest read를 사용한다.
  6. cache artifact 본문 read/write와 manifest read/write의 보안 경계를 동일하게 만든다.
- Rationale: artifact 본문은 realpath guard를 쓰지만 manifest만 direct path를 사용하면 cache freshness 판단이 workspace 밖 symlink에 의해 오염될 수 있다.
- 함정 / 주의사항:
  - manifest read 실패를 validation error로 승격하지 않는다. cache miss로 degrade해야 한다.
  - `cacheMode: "bypass"`에서는 read-model memo key 경로가 manifest를 읽지 않아야 한다.
  - `readCacheManifest()` 반환 타입을 바꾸면 호출자가 많아지므로 호환 wrapper를 유지한다.
- 테스트 작성 지침:
  - 성공: 정상 cache manifest는 기존처럼 fresh 판단에 사용된다.
  - 실패: `.speckiwi/cache/manifest.json`이 workspace 밖 symlink이면 외부 JSON을 읽지 않고 stale/cache-miss로 degrade한다.
  - 경계: `.speckiwi/cache` 디렉토리 자체가 workspace 밖 symlink이면 rebuild manifest write가 실패하고 외부 파일이 생성되지 않는다.
- 검증 명령어: `npm test -- test/hardening/security.test.ts test/cache/cache.test.ts`
- acceptance_tests:
  - {shell: "bash", cmd: "npm test -- test/hardening/security.test.ts test/cache/cache.test.ts", expected_exit: 0}
  - {shell: "pwsh", cmd: "npm test -- test/hardening/security.test.ts test/cache/cache.test.ts", expected_exit: 0}
- DoD:
  - manifest read/write와 read-model manifest hash path가 realpath guard를 사용한다.
  - `src/core/requirements.ts`의 `manifestCache`/`cacheArtifactSha256()` guard 패턴과 새 manifest path guard가 일관된다.
  - manifest symlink escape 테스트가 실패-성공 순서로 추가된다.
  - `npm run typecheck`에서 public 타입 오류가 없다.
- rollback: {strategy: "manual", command: "1) Revert edits in src/cache/manifest.ts, src/cache/rebuild.ts, and src/core/read-model.ts. 2) Run npm test -- test/hardening/security.test.ts test/cache/cache.test.ts."}
- 예상 소요: 4~6시간

### TASK-P1-002 - Add Cache Boundary Regression Coverage To Release Acceptance

- 관련 REQ-ID: `NFR-SEC-010`, `NFR-REL-010`, `FR-CACHE-002`
- 파일 경로: `test/release/acceptance.test.ts`, `test/hardening/security.test.ts`
- 메서드/함수 시그니처:
  - `it("rejects workspace-external cache manifest symlinks", async () => Promise<void>)`
  - `it("maps cache manifest symlink hardening to release acceptance coverage", async () => Promise<void>)`
- 참고 패턴:
  - `test/hardening/security.test.ts:128-149`의 cache artifact symlink test 구조를 manifest에도 확장한다.
  - `test/release/acceptance.test.ts:43-116`의 remediation coverage matrix에 새 anchor를 추가한다.
- source_anchors:
  - `test/hardening/security.test.ts:128-149`
  - `test/release/acceptance.test.ts:43-116`
- 구현 가이드:
  1. security test에 cache manifest symlink escape case를 추가한다.
  2. release acceptance matrix에 `NFR-SEC-010` coverage anchor를 manifest symlink case까지 확장한다.
  3. anchor-only 테스트에 의존하지 않도록 behavior test가 먼저 존재하게 한다.
- Rationale: 이전 release acceptance는 보완 항목 anchor를 강제했지만 cache manifest symlink case는 빠져 있었다.
- 함정 / 주의사항:
  - Windows symlink 권한 차이 때문에 symlink 생성 불가 환경에서는 기존 테스트 helper의 skip 정책을 따른다.
  - release acceptance에 긴 integration scenario를 새로 넣지 않는다.
- 테스트 작성 지침:
  - success: anchor matrix가 새 security test 문자열을 찾는다.
  - failure: manifest symlink가 외부 JSON을 fresh manifest로 인정하지 않는다.
  - boundary: artifact symlink test는 유지된다.
- 검증 명령어: `npm test -- test/hardening/security.test.ts test/release/acceptance.test.ts`
- acceptance_tests:
  - {shell: "bash", cmd: "npm test -- test/hardening/security.test.ts test/release/acceptance.test.ts", expected_exit: 0}
  - {shell: "pwsh", cmd: "npm test -- test/hardening/security.test.ts test/release/acceptance.test.ts", expected_exit: 0}
- DoD:
  - release acceptance가 cache manifest symlink hardening coverage를 추적한다.
  - hardening behavior test가 실제로 external symlink를 구성한다.
- rollback: {strategy: "manual", command: "1) Revert edits in test/hardening/security.test.ts and test/release/acceptance.test.ts. 2) Run npm test -- test/hardening/security.test.ts test/release/acceptance.test.ts."}
- 예상 소요: 1~2시간

## Phase P2 - Deterministic Validation Diagnostics

목표: `.speckiwi` store root 또는 필수 read path가 workspace 밖 symlink일 때 Core validate와 MCP validate가 throw 대신 deterministic diagnostics를 반환하게 한다.

### TASK-P2-001 - Convert Workspace Path Guard Failures Into ValidateResult Diagnostics

- 관련 REQ-ID: `NFR-REL-001`, `NFR-REL-002`, `NFR-REL-007`, `NFR-SEC-010`, `FR-VAL-004`
- 파일 경로: `src/core/validate.ts`, `src/io/path.ts`, `test/hardening/security.test.ts`, `test/mcp/tools.test.ts`, `test/cli/doctor.test.ts`
- 메서드/함수 시그니처:
  - `export async function validateWorkspace(input?: ValidateInput): Promise<ValidateResult>`
  - `function workspacePathDiagnostic(error: WorkspacePathError): Diagnostic`
- 참고 패턴:
  - `src/core/validate.ts:9-14`의 현재 uncaught validation flow를 감싼다.
  - `src/core/result.ts:70-76`의 `validationResult()`로 deterministic `ok:false` result를 만든다.
  - `test/hardening/security.test.ts:173-189`의 store directory symlink expectation을 validate/MCP validate로 확장한다.
- source_anchors:
  - `src/core/validate.ts:9-14`
  - `src/core/result.ts:70-76`
  - `src/validate/semantic.ts:76-78`
  - `test/hardening/security.test.ts:173-189`
- 구현 가이드:
  1. `validateWorkspace()`에서 `WorkspacePathError`를 catch한다.
  2. error code가 `WORKSPACE_ESCAPE` 또는 `INVALID_STORE_PATH`이면 severity `error` diagnostic으로 변환한다.
  3. `validationResult(createDiagnosticBag([diagnostic]))`를 반환한다.
  4. 비 path error는 기존 throw 동작을 유지한다.
  5. MCP `speckiwi_validate` test는 `structuredContent.ok === false`와 diagnostic code를 확인한다.
  6. CLI `speckiwi validate --json` test는 non-zero exit와 JSON diagnostics를 확인한다.
- Rationale: SRS는 문서 하나의 오류나 parse 실패가 전체 프로세스를 비정상 종료시키지 않는 deterministic diagnostics를 요구한다.
- 함정 / 주의사항:
  - 모든 Error를 swallow하지 않는다. path guard error만 diagnostic으로 변환한다.
  - MCP resource read의 `InternalError` 정책과 validate tool의 `structuredContent` 정책을 섞지 않는다.
- 테스트 작성 지침:
  - success: 정상 workspace validate는 기존 결과를 유지한다.
  - failure: `.speckiwi`가 외부 symlink이면 Core validate가 `ok:false`와 `WORKSPACE_ESCAPE` diagnostic을 반환한다.
  - boundary: MCP validate는 handler crash 없이 structuredContent를 반환한다.
- 검증 명령어: `npm test -- test/hardening/security.test.ts test/mcp/tools.test.ts test/cli/doctor.test.ts`
- acceptance_tests:
  - {shell: "bash", cmd: "npm test -- test/hardening/security.test.ts test/mcp/tools.test.ts test/cli/doctor.test.ts", expected_exit: 0}
  - {shell: "pwsh", cmd: "npm test -- test/hardening/security.test.ts test/mcp/tools.test.ts test/cli/doctor.test.ts", expected_exit: 0}
- DoD:
  - Core validate does not throw for workspace escape path guard failures.
  - CLI and MCP validate expose deterministic diagnostics.
- rollback: {strategy: "manual", command: "1) Revert edits in src/core/validate.ts and related tests. 2) Run npm test -- test/hardening/security.test.ts test/mcp/tools.test.ts test/cli/doctor.test.ts."}
- 예상 소요: 3~5시간

## Phase P3 - Strict No-Cache Write Path

목표: `speckiwi req update --apply --no-cache`의 proposal build와 apply 전 경로 모두 cache read/write를 우회하고, search/graph/export의 no-cache 계약을 회귀 테스트로 고정한다.

### TASK-P3-001 - Propagate CacheMode Into Requirement Update Patch Context

- 관련 REQ-ID: `FR-CACHE-010`, `FR-WRITE-005`, `FR-WRITE-009`
- 파일 경로: `src/cli/commands/req-write.ts`, `src/core/requirements.ts`, `test/cli/req-write.test.ts`, `test/cache/cache.test.ts`
- 메서드/함수 시그니처:
  - `async function buildUpdateChange(input: { root: string; cacheMode: "auto" | "bypass"; id: string; raw: Record<string, unknown> }): Promise<ProposeChangeInput>`
  - `async function requirementPatchContext(root: string, cacheMode: "auto" | "bypass", id: string): Promise<{ pointer: string; requirement: JsonObject } | undefined>`
  - `export async function loadRequirementRegistry(input?: RootInput): Promise<RequirementRegistry>`
- 참고 패턴:
  - `src/cli/commands/req-write.ts:123-160`의 `cacheMode` 미전달 경로를 수정한다.
  - `src/core/requirements.ts:104-110`의 registry load가 `cacheMode`를 이미 받을 수 있음을 사용한다.
  - `test/cli/req-write.test.ts:60-81`의 no-cache test를 cache-existing scenario로 확장한다.
- source_anchors:
  - `src/cli/commands/req-write.ts:123-160`
  - `src/core/requirements.ts:104-110`
  - `test/cli/req-write.test.ts:60-81`
  - `src/core/read-model.ts:75-90`
- 구현 가이드:
  1. `buildUpdateChange()` 호출부의 `cacheMode`를 `requirementPatchContext()`로 전달한다.
  2. `requirementPatchContext()`가 `loadRequirementRegistry({ root, cacheMode })`를 호출하게 한다.
  3. `cacheMode === "bypass"`에서는 registry read가 `loadReadModel()`의 bypass branch를 타는지 테스트로 관찰한다.
  4. CLI no-cache test는 cache 디렉토리를 지우는 기존 case와 cache가 존재하는 case를 모두 포함한다.
  5. cache가 존재하는 case에서는 cache manifest와 artifacts를 변조해도 update target resolution이 YAML source 기준으로 수행되는지 확인한다.
- Rationale: SRS 34.2는 no-cache 모드에서 cache write뿐 아니라 cache read도 금지한다.
- 함정 / 주의사항:
  - apply 단계에서 lock 파일은 cache가 아니다. no-cache에서도 apply lock은 유지되어야 한다.
  - proposal file 생성은 write policy 산출물이며 cache가 아니다.
  - CLI black-box만으로 read 여부 확인이 어려우면 unit-level memo stats 또는 intentionally invalid cache state를 함께 사용한다.
- 테스트 작성 지침:
  - success: 기존 no-cache update는 cache directory를 만들지 않는다.
  - failure: cache artifacts에 stale target data가 있어도 no-cache update는 YAML source target을 수정한다.
  - boundary: active apply lock은 no-cache에서도 거부된다.
- 검증 명령어: `npm test -- test/cli/req-write.test.ts test/cache/cache.test.ts test/hardening/reliability.test.ts`
- acceptance_tests:
  - {shell: "bash", cmd: "npm test -- test/cli/req-write.test.ts test/cache/cache.test.ts test/hardening/reliability.test.ts", expected_exit: 0}
  - {shell: "pwsh", cmd: "npm test -- test/cli/req-write.test.ts test/cache/cache.test.ts test/hardening/reliability.test.ts", expected_exit: 0}
- DoD:
  - `--no-cache` update path passes `cacheMode: "bypass"` before requirement patch context resolution.
  - no-cache tests cover both absent-cache and existing-poisoned-cache scenarios.
- rollback: {strategy: "manual", command: "1) Revert edits in src/cli/commands/req-write.ts and tests. 2) Run npm test -- test/cli/req-write.test.ts test/cache/cache.test.ts test/hardening/reliability.test.ts."}
- 예상 소요: 2~4시간

### TASK-P3-002 - Add No-Cache Regression Matrix For Search Graph And Export

- 관련 REQ-ID: `FR-CACHE-010`
- 파일 경로: `src/cli/commands/search.ts`, `src/cli/commands/graph.ts`, `src/cli/commands/export.ts`, `src/export/markdown.ts`, `test/cli/read-commands.test.ts`, `test/cli/export.test.ts`, `test/cache/cache.test.ts`
- 메서드/함수 시그니처:
  - `registerSearchCommand(program: Command): void`
  - `registerGraphCommand(program: Command): void`
  - `registerExportCommand(program: Command): void`
  - `export async function exportMarkdown(input?: ExportMarkdownInput): Promise<ExportResult>`
- 참고 패턴:
  - `src/cli/commands/search.ts:17-64`의 `--no-cache` option과 `cacheMode` 전달 경로를 검증한다.
  - `src/cli/commands/graph.ts:13-31`의 graph command no-cache option이 source path를 강제하는지 확인한다.
  - `src/cli/commands/export.ts:16-40`와 `src/export/markdown.ts:30-44`의 export no-cache 전달을 검증한다.
  - `test/cli/export.test.ts:64-73`의 cache directory assertion 패턴을 재사용한다.
- source_anchors:
  - `src/cli/commands/search.ts:17-64`
  - `src/cli/commands/graph.ts:13-31`
  - `src/cli/commands/export.ts:16-40`
  - `src/export/markdown.ts:30-44`
  - `test/cli/export.test.ts:64-73`
- 구현 가이드:
  1. search no-cache test는 cache rebuild 후 artifact를 의도적으로 오염시킨 뒤 `speckiwi search --no-cache`가 YAML source 결과를 반환하는지 확인한다.
  2. graph no-cache test는 pre-existing cache directory가 있어도 command 실행 전후 cache artifact set이 변하지 않는지 확인한다.
  3. export no-cache test는 기존 `.speckiwi/cache`가 있는 workspace에서 export 실행 후 cache stale marker 또는 새 cache artifact가 생성되지 않는지 확인한다.
  4. 테스트가 실패하는 command만 `cacheMode: "bypass"` 전달 경로를 수정한다.
  5. `--no-cache`는 lock/proposal/output markdown 같은 비-cache 산출물 생성을 막지 않는다.
- Rationale: SRS의 no-cache 계약은 req write 하나가 아니라 cache read/write를 사용할 수 있는 CLI 표면 전체에 적용된다.
- 함정 / 주의사항:
  - no-cache 테스트는 cache 디렉토리 존재 여부만 보지 말고 read 결과가 source 기준인지도 확인한다.
  - export output 파일은 cache artifact가 아니므로 생성 금지 대상으로 취급하지 않는다.
  - graph cache read path 작업(`TASK-P5-001`)과 충돌하지 않게 bypass mode에서는 graph artifact를 읽지 않는지만 검증한다.
- 테스트 작성 지침:
  - success: search, graph, export는 `--no-cache`에서 기존 cache directory가 있어도 cache artifact를 읽거나 쓰지 않는다.
  - failure: poisoned search cache가 있어도 no-cache search 결과는 source YAML과 일치한다.
  - boundary: export output 파일은 정상 생성되고 `.speckiwi/cache`는 변경되지 않는다.
- 검증 명령어: `npm test -- test/cli/read-commands.test.ts test/cli/export.test.ts test/cache/cache.test.ts`
- acceptance_tests:
  - {shell: "bash", cmd: "npm test -- test/cli/read-commands.test.ts test/cli/export.test.ts test/cache/cache.test.ts", expected_exit: 0}
  - {shell: "pwsh", cmd: "npm test -- test/cli/read-commands.test.ts test/cli/export.test.ts test/cache/cache.test.ts", expected_exit: 0}
- DoD:
  - search, graph, export no-cache regression tests exist.
  - poisoned or pre-existing cache artifacts do not affect no-cache output.
  - no-cache write suppression is verified without blocking non-cache command outputs.
- rollback: {strategy: "manual", command: "1) Revert no-cache regression tests and any command cacheMode propagation edits. 2) Run npm test -- test/cli/read-commands.test.ts test/cli/export.test.ts test/cache/cache.test.ts."}
- 예상 소요: 3~5시간

## Phase P4 - Package Dependency Hardening

목표: runtime direct import가 transitive dependency에 의존하지 않게 하여 global install과 packed install 환경의 MCP runtime risk를 제거한다.

### TASK-P4-001 - Declare Zod As A Direct Runtime Dependency And Add Package Smoke Coverage

- 관련 REQ-ID: `FR-CLI-002`, `FR-PKG-004`, `FR-PKG-005`, `FR-PKG-006`
- 파일 경로: `package.json`, `package-lock.json`, `test/smoke/package.test.ts`, `test/release/acceptance.test.ts`
- 메서드/함수 시그니처:
  - `it("declares runtime dependencies for direct imports", async () => Promise<void>)`
  - `it("loads MCP schema modules from the packed dependency graph", async () => Promise<void>)`
- 참고 패턴:
  - `src/mcp/schemas.ts:1-3`와 `src/mcp/structured-content.ts:1-4`의 direct zod import를 package dependency로 반영한다.
  - `package.json:79-85`의 runtime dependencies에 `zod`를 추가한다.
  - `test/smoke/package.test.ts`의 package metadata smoke를 확장한다.
- source_anchors:
  - `src/mcp/schemas.ts:1-3`
  - `src/mcp/structured-content.ts:1-4`
  - `package.json:79-85`
  - `test/smoke/package.test.ts:1-65`
- 구현 가이드:
  1. `package.json.dependencies`에 `zod`를 직접 추가한다. 버전은 현재 lock에 존재하는 major-compatible range를 사용한다.
  2. lockfile을 package manager로 갱신한다.
  3. smoke test가 `src/mcp/schemas.ts`와 `src/mcp/structured-content.ts`의 direct import name을 확인하고, 해당 package가 dependencies에 있는지 검사한다.
  4. release acceptance는 direct dependency coverage anchor를 추가한다.
- Rationale: npm transitive dependency는 public runtime import 계약이 아니다. direct import는 direct dependency로 선언해야 packed/global install에서 안전하다.
- 함정 / 주의사항:
  - `zod`를 devDependency에 넣지 않는다.
  - SDK transitive version에 맞춰 과도한 major upgrade를 하지 않는다.
- 테스트 작성 지침:
  - success: package metadata test에서 `dependencies.zod`가 존재한다.
  - failure: direct runtime import 목록에 없는 dependency 누락이 있으면 smoke test가 실패한다.
  - boundary: `npm pack --dry-run`은 release gate에서 계속 통과해야 한다.
- 검증 명령어: `npm test -- test/smoke/package.test.ts test/release/acceptance.test.ts`
- acceptance_tests:
  - {shell: "bash", cmd: "npm test -- test/smoke/package.test.ts test/release/acceptance.test.ts", expected_exit: 0}
  - {shell: "pwsh", cmd: "npm test -- test/smoke/package.test.ts test/release/acceptance.test.ts", expected_exit: 0}
- DoD:
  - `zod` is listed under runtime dependencies.
  - package smoke test guards direct runtime imports.
- rollback: {strategy: "manual", command: "1) Remove zod dependency and revert package-lock plus smoke test edits. 2) Run npm test -- test/smoke/package.test.ts test/release/acceptance.test.ts."}
- 예상 소요: 1~2시간

## Phase P5 - Graph Cache Read Path

목표: graph cache가 생성만 되고 사용되지 않는 상태를 끝내고, 정상 cache 상태에서 graph/trace/impact read path가 artifact를 사용할 수 있게 한다.

### TASK-P5-001 - Read And Filter Cached Graph Artifacts In ReadModel

- 관련 REQ-ID: `FR-GRAPH-008`, `FR-GRAPH-009`, `FR-GRAPH-010`, `FR-GRAPH-011`, `NFR-PERF-006`
- 파일 경로: `src/core/read-model.ts`, `src/graph/builder.ts`, `src/graph/model.ts`, `src/cache/rebuild.ts`, `test/graph/graph.test.ts`, `test/cache/cache.test.ts`
- 메서드/함수 시그니처:
  - `export function deserializeGraphResult(value: unknown): GraphResult | undefined`
  - `export function filterGraphResult(graph: GraphResult, graphType: GraphType): GraphResult`
  - `buildGraph(graphType?: GraphType): GraphResult`
- 참고 패턴:
  - `src/cache/rebuild.ts:52-67`에서 graph artifact가 이미 생성된다.
  - `src/core/api.ts:113-120`의 Core graph path는 `loadReadModel({ sections: ["graph"] })`를 사용한다.
  - `src/core/read-model.ts:157-184`에는 search-only cache branch가 있다.
  - `src/graph/builder.ts:193-219`의 graphType filter 조건을 reusable helper로 추출한다.
- source_anchors:
  - `src/cache/rebuild.ts:52-67`
  - `src/core/api.ts:113-120`
  - `src/core/read-model.ts:157-184`
  - `src/graph/builder.ts:193-219`
- 선행 조건:
  - `TASK-P1-001`이 완료되어 cache manifest path IO가 realpath guard를 통과해야 한다.
  - cached graph branch는 `isIndexSectionFresh(root, "graph")` 또는 동등한 output hash/freshness 검증을 통과한 경우에만 사용할 수 있다.
- 구현 가이드:
  1. graph artifact deserializer를 추가한다. `ok:true`, `nodes[]`, `edges[]`, `graphType` shape를 최소 검증한다.
  2. `buildGraphFromRegistry()` 내부 filtering logic을 `filterGraphPayload()` 또는 `filterGraphResult()` helper로 분리한다.
  3. rebuild는 full traceability graph를 계속 저장한다.
  4. read-model `sections.every(section => section === "graph")` branch에서 fresh graph artifact를 읽고 `stats.mode = "cache"`로 ReadModel을 생성한다.
  5. cached graph branch의 `buildGraph(graphType)`는 cached full graph를 requested graphType으로 filter한다.
  6. artifact unreadable 또는 stale이면 source graph로 degrade한다.
  7. cached graph branch는 source graph path와 같은 diagnostics를 반환해야 한다. 구현 전 `diagnostics artifact merge`, `graph artifact에 diagnostics 포함`, `diagnostics unavailable 시 source fallback` 중 하나를 선택하고 테스트로 고정한다.
  8. `traceRequirement()`와 `impact()`가 cached graph를 소비할 때도 invalid relation diagnostics가 source path와 동일하게 노출되게 한다.
- Rationale: SRS는 graph cache 생성 가능성을 요구하고, 대형 workspace에서는 필요한 파일만 재로드할 수 있어야 한다. graph cache를 read path에 연결해야 cache artifact가 기능적으로 의미를 갖는다.
- 함정 / 주의사항:
  - graph cache는 source-of-truth가 아니다. freshness와 output hash 검증을 통과한 경우에만 사용한다.
  - diagnostics cache와 graph diagnostics를 혼동하지 않는다. cached graph가 stale이면 source build로 돌아간다.
  - impact/trace는 graph result를 소비하므로 graph cache filtering이 deterministic해야 한다.
- 테스트 작성 지침:
  - success: cache rebuild 후 `core.graph()`가 `stats.cacheHit`을 관찰할 수 있는 test helper 또는 memo stats로 cache path를 입증한다.
  - failure: graph artifact를 malformed shape로 바꾸면 source fallback이 동작하고 graph result는 여전히 ok다.
  - boundary: `graphType: "dependency"` 요청은 cached traceability graph에서 dependency edge만 반환한다.
  - diagnostics: invalid relation fixture에서 cache rebuild 후 `core.graph`, `traceRequirement`, `impact` cached path가 source/bypass path와 같은 diagnostic code set을 반환한다.
- 검증 명령어: `npm test -- test/graph/graph.test.ts test/cache/cache.test.ts`
- acceptance_tests:
  - {shell: "bash", "cmd": "npm test -- test/graph/graph.test.ts test/cache/cache.test.ts", "expected_exit": 0}
  - {shell: "pwsh", "cmd": "npm test -- test/graph/graph.test.ts test/cache/cache.test.ts", "expected_exit": 0}
- DoD:
  - fresh graph cache can serve graph requests without full source parse.
  - cached graph filtering returns deterministic GraphResult DTO for every graphType.
  - cached graph path preserves source graph diagnostics and filtering semantics when manifest freshness passes.
- rollback: {strategy: "manual", command: "1) Revert graph cache read-model changes and graph helper extraction. 2) Run npm test -- test/graph/graph.test.ts test/cache/cache.test.ts."}
- 예상 소요: 5~8시간

## Phase P6 - MCP Performance Evidence

목표: SRS 성능 테스트가 Core direct call을 MCP tool call로 오인하지 않게 하고, 실제 MCP handler/schema/structuredContent 경로를 측정한다. 이 Phase는 성능 최적화가 아니라 검증 정확도 보완이다.

### TASK-P6-001 - Measure Actual MCP Tool Path In SRS Performance Test

- 관련 REQ-ID: `NFR-PERF-005`, `NFR-PERF-007`, `FR-MCP-004`, `FR-MCP-TR-006`
- 파일 경로: `test/perf/perf.test.ts`, `test/mcp/tools.test.ts`, `src/mcp/tools.ts`, `src/mcp/server.ts`
- 메서드/함수 시그니처:
  - `async function measureMcpToolCall(root: string, counters: Record<string, PerfCounters>, toolName: string, args: Record<string, unknown>): Promise<number>`
  - `async function withPerfMcpClient(root: string, callback: (client: Client) => Promise<void>): Promise<void>`
- 참고 패턴:
  - `test/perf/perf.test.ts:102-128`에서 MCP timing budget을 이미 계산한다.
  - `test/perf/perf.test.ts:264-284`의 현재 implementation은 Core direct call이므로 교체 대상이다.
  - `test/mcp/tools.test.ts:493-513`의 InMemory MCP client helper 패턴을 재사용한다.
- source_anchors:
  - `test/perf/perf.test.ts:102-128`
  - `test/perf/perf.test.ts:264-284`
  - `test/mcp/tools.test.ts:493-513`
  - `src/mcp/tools.ts:202-244`
- 구현 가이드:
  1. perf test에 lightweight InMemory MCP client helper를 둔다.
  2. `measureMcpToolCall()`에서 `client.callTool({ name: toolName, arguments: args })`를 호출한다.
  3. `structuredContent.ok`와 first result ID를 검증한다.
  4. counters는 structuredContent diagnostics 기준으로 채운다.
  5. stdio process launch overhead는 별도 smoke에서 이미 다루므로 SRS tool latency는 in-memory transport로 측정한다.
  6. 이 task에서 budget 완화나 search optimization은 하지 않는다.
- Rationale: SRS 34.5는 MCP 정상 cache 상태 단일 tool 호출 1초 목표를 테스트하라고 요구한다. Core direct call은 handler validation과 structuredContent 변환 비용을 포함하지 않는다.
- 함정 / 주의사항:
  - perf fixture 생성 시간을 measurement에 포함하지 않는다.
  - MCP client setup time을 single tool call timing에 포함하지 않는다.
  - performance flake가 있으면 측정 구간을 좁히고 counter를 더 명확히 기록한다. budget 완화는 사용자 승인 없이 하지 않는다.
- 테스트 작성 지침:
  - success: normal perf profile에서 actual MCP `speckiwi_search` call이 성공한다.
  - failure: unsupported toolName은 deterministic error를 던진다.
  - boundary: SRS profile에서 `SPECKIWI_ASSERT_SEARCH_PERF=1`일 때 MCP cache-hit budget assertion이 유지된다.
- 검증 명령어: `npm test -- test/perf/perf.test.ts test/mcp/tools.test.ts`
- acceptance_tests:
  - {shell: "bash", cmd: "npm test -- test/perf/perf.test.ts test/mcp/tools.test.ts", expected_exit: 0}
  - {shell: "pwsh", cmd: "npm test -- test/perf/perf.test.ts test/mcp/tools.test.ts", expected_exit: 0}
  - {shell: "bash", cmd: "npm run perf:srs", expected_exit: 0}
  - {shell: "pwsh", cmd: "npm run perf:srs", expected_exit: 0}
- DoD:
  - `mcpToolCallMs` measures MCP tool handler path through client call.
  - SRS perf command still asserts exact lookup, cached search, cache rebuild, validation, and MCP tool budgets.
- rollback: {strategy: "manual", command: "1) Revert edits in test/perf/perf.test.ts. 2) Run npm test -- test/perf/perf.test.ts test/mcp/tools.test.ts and npm run perf:srs."}
- 예상 소요: 3~5시간

## 스펙 매핑 표

| REQ-ID | TASK-ID |
|---|---|
| `NFR-SEC-003` | `TASK-P1-001` |
| `NFR-SEC-004` | `TASK-P1-001` |
| `NFR-SEC-005` | `TASK-P1-001` |
| `NFR-SEC-010` | 잔여 보완: `TASK-P1-001`, `TASK-P1-002`, `TASK-P2-001`; 기존 Core/MCP symlink escape coverage 유지 |
| `FR-CACHE-002` | `TASK-P1-001`, `TASK-P1-002` |
| `FR-CACHE-008` | `TASK-P1-001` |
| `FR-CACHE-009` | 기존 search cache read-path 테스트 유지 검증, 신규 TASK 없음 |
| `FR-CACHE-010` | `TASK-P3-001`, `TASK-P3-002` |
| `NFR-REL-001` | `TASK-P2-001` |
| `NFR-REL-002` | `TASK-P2-001` |
| `NFR-REL-007` | `TASK-P2-001` |
| `FR-VAL-004` | `TASK-P2-001` |
| `FR-WRITE-005` | `TASK-P3-001` |
| `FR-WRITE-009` | `TASK-P3-001` |
| `FR-CLI-002` | `TASK-P4-001` |
| `FR-PKG-004` | `TASK-P4-001` |
| `FR-PKG-005` | `TASK-P4-001` |
| `FR-PKG-006` | `TASK-P4-001` |
| `FR-MCP-014` | 기존 MCP invalid params 테스트 유지 검증, 신규 TASK 없음 |
| `FR-MCP-015` | 기존 MCP output schema 테스트 유지 검증, 신규 TASK 없음 |
| `FR-GRAPH-008` | `TASK-P5-001` |
| `FR-GRAPH-009` | `TASK-P5-001` |
| `FR-GRAPH-010` | `TASK-P5-001` |
| `FR-GRAPH-011` | `TASK-P5-001` |
| `NFR-PERF-005` | `TASK-P6-001` |
| `NFR-PERF-006` | `TASK-P5-001` |
| `NFR-PERF-007` | `TASK-P6-001` |
| `FR-MCP-004` | `TASK-P6-001` |
| `FR-MCP-TR-006` | `TASK-P6-001` |

## 리스크 및 완화

| 리스크 | 영향 | 완화 |
|---|---|---|
| Manifest guard 변경이 stale 판단을 보수적으로 만들어 cache hit가 줄어듦 | 성능 회귀 가능 | cache miss는 YAML source degrade로 유지하고 `perf:srs`를 pre_commit_gate에 둔다. |
| Graph cache filtering helper 추출 중 edge inclusion logic이 바뀜 | graph/impact 회귀 | `dependency`, `requirement`, `traceability` graphType별 regression test를 둔다. |
| 실제 MCP perf measurement가 기존 Core direct measurement보다 느림 | `perf:srs` 실패 가능 | setup time 제외, cache warm-up 유지, budget 변경은 별도 사용자 승인으로 분리한다. |
| zod direct dependency 추가로 lockfile 변경 발생 | package churn | `package.json`과 lockfile 변경을 dependency addition으로만 제한한다. |

## 용어집

| 용어 | 정의 |
|---|---|
| source of truth | 기능 판단의 원본으로 신뢰할 수 있는 `.speckiwi/**/*.yaml` 데이터 |
| cache artifact | `.speckiwi/cache/*.json` 아래 재생성 가능한 JSON 산출물 |
| realpath guard | symlink를 해소한 실제 경로가 workspace root 내부인지 확인하는 보안 경계 |
| Core DTO | CLI JSON 출력과 MCP structuredContent가 공유하는 machine-readable 결과 객체 |
| MCP tool path | MCP client call, input schema validation, handler, output schema validation, structuredContent 변환을 포함한 호출 경로 |

## 메타

- mode: NORMAL
- feasibility summary: High risk 2개(`TASK-P1-001`, `TASK-P5-001`), Infeasible 없음
- dynamic senior trigger: security, cache, MCP performance
- Dew file: `.snoworca/dew/planner/plan-20260502-speckiwi-verification-hardening-v1/execution-guard.yaml`
