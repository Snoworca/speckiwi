---
plan_contract: "1.1.0"
plan_id: "plan-20260503-speckiwi-final-srs-gap-remed-v1"
previous_hash: null
produced_by: "snoworca-planner@2.2.2"
title: "SpecKiwi Final SRS Gap Remediation Plan"
mode: "NORMAL"
produced_at: "2026-05-03T15:45:00+09:00"
spec_path: "docs/spec/srs.md"
spec_refs:
  - "docs/spec/srs.md"
  - "previous verification: 2026-05-03 three-agent SRS compliance report"
x-snoworca-code-path: "."
output_path: "docs/plans/plan-20260503-speckiwi-final-srs-gap-remediation-v1.md"
scope_freeze: true
change_log:
  - {ts: "2026-05-03T16:20:00+09:00", reason: "planner evaluator re-review: make TASK-P1-002 independent from generated core test read", tasks: ["TASK-P1-002"]}
  - {ts: "2026-05-03T16:20:00+09:00", reason: "planner evaluator re-review: document concrete releaseCommands return shape", tasks: ["TASK-P4-002"]}
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
  - {shell: "bash", cmd: "npm test -- test/core/api.test.ts test/validate/semantic.test.ts test/search/search.test.ts test/cache/cache.test.ts test/graph/graph.test.ts test/release/acceptance.test.ts test/hardening/security.test.ts", expected_exit: 0}
  - {shell: "pwsh", cmd: "npm test -- test/core/api.test.ts test/validate/semantic.test.ts test/search/search.test.ts test/cache/cache.test.ts test/graph/graph.test.ts test/release/acceptance.test.ts test/hardening/security.test.ts", expected_exit: 0}
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
    title: "Public Core Facade Completion"
    tasks:
      - {id: "TASK-P1-001"}
      - {id: "TASK-P1-002"}
  - id: "PHASE-P2"
    title: "Semantic Validation Gaps"
    tasks:
      - {id: "TASK-P2-001"}
      - {id: "TASK-P2-002"}
  - id: "PHASE-P3"
    title: "Cache Regeneration Evidence"
    tasks:
      - {id: "TASK-P3-001"}
      - {id: "TASK-P3-002"}
  - id: "PHASE-P4"
    title: "Packaging And Release Gates"
    tasks:
      - {id: "TASK-P4-001"}
      - {id: "TASK-P4-002"}
  - id: "PHASE-P5"
    title: "Out Of Scope Policy Evidence"
    tasks:
      - {id: "TASK-P5-001"}
      - {id: "TASK-P5-002"}
      - {id: "TASK-P5-003"}
---

# SpecKiwi Final SRS Gap Remediation Plan

## 개요

이 계획은 2026-05-03 SRS 대조 검증에서 남은 모든 결함을 닫기 위한 보완 계획이다. 직전 검증에서 `npm run build`, `npm run typecheck`, `npm run lint`, `npm test`, `npm run perf:srs`, `npm run release:check`, `npm audit --omit=dev --json`은 통과했다. 그러나 strict SRS release 판정에는 public Core facade 누락, dictionary cycle 명시 검증 부족, SRS primary scope semantic evidence 부족, cache section 자동 재생성 증거 부족, global install smoke 부재, release gate 성능 누락, Git history 정책과 HTTP/DB out-of-scope evidence 부족이 남았다.

본 계획은 성능 알고리즘 대수술을 범위에 넣지 않는다. 단, `perf:srs`가 반복 실패하면 exact lookup cache path의 관찰 가능한 낭비를 줄이는 좁은 보정은 허용한다.

JSON 사이드카: `docs/plans/plan-20260503-speckiwi-final-srs-gap-remediation-v1.md.json`

## 선행 조건 및 전제

- SRS 기준 문서는 `docs/spec/srs.md`다.
- `.speckiwi/**/*.yaml`이 source of truth다.
- JSON cache와 Markdown export는 재생성 가능한 artifact다.
- `createSpecKiwiCore()`는 public library facade다.
- CLI와 MCP는 Core DTO를 공유해야 한다.
- Windows 실행성은 shell 항목으로 문서화하되, 현재 Termux 환경에서 `pwsh` 실행 검증은 환경 제약으로 남긴다.
- 새 runtime dependency 추가는 범위 밖이다.
- Mock 또는 fake production implementation은 금지한다. 테스트 데이터에 한정된 sentinel 이름은 허용한다.

## 프로젝트 온보딩 컨텍스트

SpecKiwi는 repository-local `.speckiwi/` YAML 문서를 읽어 CLI와 stdio MCP로 SDD context 조회, 검색, 검증, graph, write proposal, Markdown export를 제공하는 Node.js/TypeScript 도구다. 데이터베이스, HTTP 서버, background daemon, web console은 v1 범위 밖이다.

주요 디렉토리 맵:

| 경로 | 역할 |
|---|---|
| `src/core/` | CLI와 MCP가 공유하는 Core facade, DTO orchestration, read model |
| `src/cli/` | Commander 기반 CLI adapter |
| `src/mcp/` | stdio MCP tools, resources, schemas, structuredContent |
| `src/validate/` | workspace YAML load 이후 semantic validation |
| `src/search/` | flat search document, dictionary expansion, tokenizer, BM25 |
| `src/cache/` | cache manifest, fingerprint, rebuild, clean |
| `src/indexing/` | serialized search/entity/relation cache artifact |
| `src/write/` | proposal, JSON Patch apply, process lock, atomic write |
| `test/` | Vitest unit, CLI, MCP, hardening, release, perf tests |

빌드와 테스트 치트시트:

| 목적 | 명령 |
|---|---|
| 빌드 | `npm run build` |
| 타입 검사 | `npm run typecheck` |
| 정적 분석 | `npm run lint` |
| 전체 테스트 | `npm test` |
| SRS 성능 검증 | `npm run perf:srs` |
| release gate | `npm run release:check` |
| 취약점 확인 | `npm audit --omit=dev --json` |

참고 문서:

| 문서 | 용도 |
|---|---|
| `docs/spec/srs.md` | SRS SSOT |
| `docs/research/20260501-speckiwi-performance-indexing-research.md` | 성능/인덱싱 연구 |
| `docs/reports/20260502-speckiwi-srs-verification-findings.md` | 이전 검증 findings |

## AI 에이전트 실행 가드

`scope_freeze`는 본 계획 확정 시점에 `true`로 고정했다. 이후 scope 확장은 사용자 승인과 `change_log` 추가를 요구한다.

`pre_commit_gate`는 frontmatter를 SSOT로 사용한다. 각 TASK의 `acceptance_tests`는 task 종료 시점 검증이고, `pre_commit_gate`는 전체 구현 뒤 커밋 직전 검증이다.

## Phase P1 - Public Core Facade Completion

목표: public `./core/api` export가 CLI/MCP 수준의 주요 Core 작업을 빠짐없이 노출하게 한다.

### TASK-P1-001 - Extend `SpecKiwiCore` With Missing Public Methods

- 관련 REQ-ID: `FR-PKG-003`, `FR-DIR-001`, `FR-DOC-CHK-001`, `FR-CACHE-003`, `FR-CACHE-004`, `FR-EXP-001`, `FR-CLI-001`
- 파일 경로: `src/core/api.ts`, `src/core/inputs.ts`, `src/core/cache.ts`, `src/core/export-markdown.ts`, `src/core/init.ts`, `src/core/doctor.ts`, `test/core/api.test.ts`
- 메서드/함수 시그니처:
  - `init(input?: InitInput): Promise<InitResult>`
  - `doctor(input?: DoctorInput): Promise<DoctorResult>`
  - `cacheRebuild(input?: CacheRebuildInput): Promise<CacheResult>`
  - `cacheClean(input?: CacheCleanInput): Promise<CacheResult>`
  - `exportMarkdown(input?: ExportMarkdownInput): Promise<ExportResult>`
  - `createSpecKiwiCore(input: { root: string; cacheMode?: CacheMode }): SpecKiwiCore`
- 참고 패턴:
  - `src/core/api.ts:64-80`의 `SpecKiwiCore` type에 public methods를 추가한다.
  - `src/core/api.ts:135-169`의 factory return object에 bound method를 추가한다.
  - `src/core/cache.ts:8-18`의 memo invalidation wrapper를 facade에서 그대로 호출한다.
  - `src/core/export-markdown.ts:1`의 export wrapper를 facade에서 사용한다.
  - `src/core/init.ts:11-64`와 `src/core/doctor.ts:11-62`를 facade에 bind한다.
- source_anchors:
  - `src/core/api.ts:64-80`
  - `src/core/api.ts:101-169`
  - `src/core/cache.ts:8-18`
  - `src/core/export-markdown.ts:1`
  - `src/core/init.ts:11-64`
  - `src/core/doctor.ts:11-62`
- 구현 가이드:
  1. `src/core/api.ts` imports에 `initWorkspace`, `doctor`, `rebuildCache`, `cleanCache`, `exportMarkdown`를 추가한다.
  2. `src/core/inputs.ts`에서 이미 정의된 `InitInput`, `DoctorInput`, `CacheRebuildInput`, `CacheCleanInput`, `ExportMarkdownInput`을 `api.ts` type import에 포함한다.
  3. `src/core/dto.ts`의 `ExportResult` type을 import해 `SpecKiwiCore` return type에 사용한다.
  4. `SpecKiwiCore` type에 5개 method를 추가한다.
  5. `createSpecKiwiCore().bind()`를 사용해 `root`와 기본 `cacheMode`를 주입한다. `init`은 `cacheMode`가 의미 없는 입력이어도 bind 결과에 들어가는 추가 필드를 무해하게 처리한다.
  6. `cacheRebuild`와 `cacheClean`은 `src/core/cache.ts` wrapper를 호출해서 read-model memo가 지워지게 한다.
  7. `exportMarkdown`은 `ExportMarkdownInput`의 `outputRoot`, `type`, `documentId`, `strict`를 보존한다.
- Rationale: `package.json`이 `./core/api`를 public export로 노출하므로 library consumer가 CLI와 같은 Core 작업을 facade 하나로 사용할 수 있어야 한다.
- 함정 / 주의사항:
  - CLI command 구현을 대량으로 바꾸지 않는다. facade 확장이 목표다.
  - `McpToolResultCore` union은 이미 `CacheResult`, `DoctorResult`, `InitResult`를 포함하므로 중복 alias를 만들지 않는다.
  - `cacheMode: "bypass"`에서 `cacheRebuild()`가 artifact를 쓰지 않는 기존 계약을 유지한다.
- 테스트 작성 지침:
  - 성공: `createSpecKiwiCore({ root }).doctor()`, `.cacheRebuild()`, `.cacheClean()`, `.exportMarkdown()`가 direct core module 호출과 같은 `ok` shape를 반환한다.
  - 실패: 이미 `.speckiwi/`가 있는 root에서 `.init()`은 `WORKSPACE_ALREADY_EXISTS`를 반환한다.
  - 경계: `cacheMode: "bypass"`로 만든 core의 `.cacheRebuild()`가 cache files를 생성하지 않는다.
- 검증 명령어: `npm test -- test/core/api.test.ts test/cache/cache.test.ts test/export/markdown.test.ts`
- acceptance_tests:
  - {shell: "bash", cmd: "npm test -- test/core/api.test.ts test/cache/cache.test.ts test/export/markdown.test.ts", expected_exit: 0}
  - {shell: "pwsh", cmd: "npm test -- test/core/api.test.ts test/cache/cache.test.ts test/export/markdown.test.ts", expected_exit: 0}
- DoD:
  - `SpecKiwiCore` type에 5개 public method가 추가된다.
  - `createSpecKiwiCore()` return object가 5개 method를 구현한다.
  - 새 `test/core/api.test.ts`가 direct module과 facade call을 모두 검증한다.
  - `npm run typecheck`가 public type export 오류 없이 통과한다.
- rollback: {strategy: "manual", command: "1) Revert edits in src/core/api.ts and test/core/api.test.ts. 2) Run npm run typecheck and npm test -- test/core/api.test.ts."}
- 예상 소요: 3~5시간

### TASK-P1-002 - Add Package Import Smoke For Expanded Core Facade

- 관련 REQ-ID: `FR-PKG-003`, `FR-PKG-005`, `FR-CLI-002`
- 파일 경로: `test/smoke/package.test.ts`, `package.json`
- 선행 TASK: `TASK-P1-001` 완료 후 실행한다. P1-002는 P1-001이 추가한 facade method shape를 package export 경로에서만 재검증한다.
- 메서드/함수 시그니처:
  - `it("imports public core facade methods from packaged exports", async () => Promise<void>)`
- 참고 패턴:
  - `package.json:28-31`의 `./core/api` public export를 smoke test에서 import한다.
  - `test/smoke/package.test.ts`의 direct runtime import smoke 구조를 따른다.
- source_anchors:
  - `package.json:28-31`
  - `test/smoke/package.test.ts:1-80`
- 구현 가이드:
  1. `test/smoke/package.test.ts`에서 `import("speckiwi/core/api")` 또는 repo export alias 테스트 패턴을 사용한다.
  2. imported module의 `createSpecKiwiCore`가 function인지 확인한다.
  3. 임시 workspace를 만들고 facade object에 `init`, `doctor`, `cacheRebuild`, `cacheClean`, `exportMarkdown` property가 function인지 확인한다.
  4. 이 smoke는 packaged export shape 검증이므로 heavy workspace behavior는 `TASK-P1-001`의 core facade test에 둔다.
- Rationale: public facade 누락은 typecheck만으로 놓칠 수 있다. package export smoke가 npm consumer 시나리오를 잠근다.
- 함정 / 주의사항:
  - smoke test에서 `release:check`를 실행하지 않는다.
  - package smoke는 runtime import만 검증하고 파일 write behavior는 core test에 둔다.
- 테스트 작성 지침:
  - 성공: public export import 성공.
  - 실패: method가 빠지면 test가 method 이름을 출력하며 실패.
  - 경계: ESM import path가 package exports와 일치한다.
- 검증 명령어: `npm test -- test/smoke/package.test.ts`
- acceptance_tests:
  - {shell: "bash", cmd: "npm test -- test/smoke/package.test.ts", expected_exit: 0}
  - {shell: "pwsh", cmd: "npm test -- test/smoke/package.test.ts", expected_exit: 0}
- DoD:
  - package smoke가 expanded facade method names를 검증한다.
  - `npm run typecheck`의 public smoke compile 대상이 유지된다.
- rollback: {strategy: "manual", command: "1) Revert edits in test/smoke/package.test.ts. 2) Run npm test -- test/smoke/package.test.ts."}
- 예상 소요: 1~2시간

## Phase P2 - Semantic Validation Gaps

목표: strict SRS 검증에서 "부분 구현 또는 미검증"으로 남은 dictionary cycle과 SRS primary scope 정책을 자동 테스트로 닫는다.

### TASK-P2-001 - Detect Dictionary Synonym Cycles And Preserve Bounded Search Expansion

- 관련 REQ-ID: `FR-DICT-003`, `FR-DICT-004`, `FR-DICT-005`, `FR-SRCH-009`
- 파일 경로: `src/search/document.ts`, `src/search/index.ts`, `src/validate/semantic.ts`, `test/search/search.test.ts`, `test/validate/semantic.test.ts`
- 메서드/함수 시그니처:
  - `export function buildDictionaryExpansion(workspace: ValidWorkspace): DictionaryExpansion`
  - `function expandQuery(query: string, dictionary: DictionaryExpansion): string[]`
  - `function validateDictionaryEntries(workspace: LoadedWorkspace, diagnostics: Diagnostic[]): void`
- 참고 패턴:
  - `src/search/document.ts:64-82`의 dictionary group construction을 유지한다.
  - `src/search/index.ts:101-126`의 bounded query expansion을 유지한다.
  - `src/validate/semantic.ts:581-604`의 semantic helper style을 따른다.
  - `test/search/search.test.ts:84-101`의 synonym expansion test를 cycle case로 확장한다.
- source_anchors:
  - `src/search/document.ts:64-82`
  - `src/search/index.ts:101-126`
  - `src/validate/semantic.ts:141-156`
  - `src/validate/semantic.ts:581-604`
  - `test/search/search.test.ts:84-101`
- 구현 가이드:
  1. `validateRegistry()` flow에 dictionary semantic helper를 추가한다.
  2. helper는 `dictionary.yaml`의 `synonyms` map을 normalized directed edges로 읽는다. key `a`의 values에 `b`, key `b`의 values에 `a`가 있으면 cycle로 판단한다.
  3. multi-hop cycle도 DFS로 탐지한다. 예: `a -> b`, `b -> c`, `c -> a`.
  4. diagnostic code는 `DICTIONARY_SYNONYM_CYCLE`로 고정하고 severity는 `error`로 둔다. Validation은 실패해야 하지만 search runtime은 bounded expansion으로 비정상 종료 없이 수행되어야 한다.
  5. `expandQuery()`의 10 round cap은 유지한다. cycle diagnostic은 validation evidence이고 runtime loop guard는 runtime safety다.
  6. search test는 cycle dictionary에서도 query expansion이 finite이며 duplicate results를 만들지 않음을 검증한다.
- Rationale: SRS는 circular entry를 만들지 않도록 처리하라고 요구한다. 현재 runtime cap은 무한 루프를 막지만, 사용자가 cycle 원인을 관찰할 diagnostic이 없다.
- 함정 / 주의사항:
  - dictionary가 없어도 기본 검색은 계속 성공해야 한다.
  - cycle diagnostic은 validation error다. 기존 valid fixture가 error를 내면 fixture가 잘못된 것이므로 fixture dictionary를 고친다.
  - normalized term 비교는 `normalizeExactKey()`와 같은 방식으로 맞춘다.
- 테스트 작성 지침:
  - 성공: cycle 없는 dictionary는 새 diagnostic을 내지 않는다.
  - 실패: reciprocal cycle은 `DICTIONARY_SYNONYM_CYCLE` error를 낸다.
  - 경계: three-node cycle과 self alias가 finite expansion으로 끝난다.
- 검증 명령어: `npm test -- test/search/search.test.ts test/validate/semantic.test.ts`
- acceptance_tests:
  - {shell: "bash", cmd: "npm test -- test/search/search.test.ts test/validate/semantic.test.ts", expected_exit: 0}
  - {shell: "pwsh", cmd: "npm test -- test/search/search.test.ts test/validate/semantic.test.ts", expected_exit: 0}
- DoD:
  - `DICTIONARY_SYNONYM_CYCLE` error test가 추가된다.
  - cycle dictionary search가 timeout 없이 성공한다.
  - existing synonym expansion test가 유지된다.
- rollback: {strategy: "manual", command: "1) Revert edits in src/validate/semantic.ts, src/search/document.ts, src/search/index.ts, and related tests. 2) Run npm test -- test/search/search.test.ts test/validate/semantic.test.ts."}
- 예상 소요: 4~6시간

### TASK-P2-002 - Enforce SRS Document Primary Scope Consistency

- 관련 REQ-ID: `FR-SRS-DOC-001`, `FR-SRS-DOC-002`, `FR-SRS-DOC-004`, `FR-DOC-010`, `FR-IDX-008`, `FR-REQ-011`
- 파일 경로: `src/validate/semantic.ts`, `src/schema/compile.ts`, `test/validate/semantic.test.ts`, `test/fixtures/workspaces/invalid-schema/.speckiwi/srs/unregistered.yaml`
- 메서드/함수 시그니처:
  - `function validateManifestEntries(workspace: LoadedWorkspace, documentsByPath: Map<string, LoadedSpecDocument>, registeredPaths: Set<string>, documentIds: Set<string>, diagnostics: Diagnostic[]): void`
  - `function validateRequirements(workspace: LoadedWorkspace, scopeParents: Map<string, string | undefined>, diagnostics: Diagnostic[]): { ids: Set<string>; dependsOn: Map<string, string[]> }`
  - `function isFastValidSrsDocument(value: unknown): boolean`
- 참고 패턴:
  - `src/schema/compile.ts:119-133` already requires top-level SRS `scope`.
  - `src/validate/semantic.ts:221-257` checks index entry id/type/schemaVersion against YAML.
  - `src/validate/semantic.ts:393-403` checks that SRS scope exists in `index.scopes`.
- source_anchors:
  - `src/schema/compile.ts:119-133`
  - `src/validate/semantic.ts:159-258`
  - `src/validate/semantic.ts:393-403`
  - `test/validate/semantic.test.ts:15-90`
- 구현 가이드:
  1. `validateManifestEntries()`에서 entry type이 `srs`이고 entry has `scope`, YAML has `scope`, 두 값이 다르면 `SRS_SCOPE_MISMATCH` error를 낸다.
  2. entry type이 `srs`인데 `entry.scope`가 없으면 YAML `scope`만 primary scope로 인정한다. 이 경우 error를 내지 않는다.
  3. YAML `scope`가 schema 단계에서 빠진 경우 schema validation이 이미 실패한다. semantic helper는 schema-valid 문서 중심으로 동작한다.
  4. `validateRequirements()` 시작부에 `Map<string, string>`을 두어 schema-valid SRS document의 primary scope별 first path를 추적한다.
  5. 같은 primary scope를 가진 SRS document가 둘 이상이면 `DUPLICATE_SRS_PRIMARY_SCOPE` error를 낸다. 하나의 scope를 여러 파일로 쪼개는 구조를 금지하고, 여러 scope 파일은 허용한다.
  6. requirement summary scope가 document primary scope에서만 파생되는 기존 동작을 유지한다.
  7. test fixture에 index scope와 YAML scope가 다른 SRS 문서를 만들고 `SRS_SCOPE_MISMATCH`를 assert한다.
  8. 별도 fixture 또는 in-test workspace에 같은 `scope`를 가진 두 SRS 파일을 만들고 `DUPLICATE_SRS_PRIMARY_SCOPE`를 assert한다.
- Rationale: SRS 파일은 하나의 primary scope를 표현해야 한다. index entry scope와 YAML scope가 갈라지면 list/search scope filter가 서로 다른 의미로 동작할 수 있다.
- 함정 / 주의사항:
  - index entry `scope`는 optional이다. optional 부재를 error로 만들지 않는다.
  - document type이 `prd`, `technical`, `adr`이면 이 rule을 적용하지 않는다.
  - requirement item에 `scope` 필드를 새로 허용하지 않는다.
- 테스트 작성 지침:
  - 성공: matching index/YAML scope는 diagnostics error 없음.
  - 실패: mismatch는 `SRS_SCOPE_MISMATCH` error.
  - 실패: two SRS files with same primary scope는 `DUPLICATE_SRS_PRIMARY_SCOPE` error.
  - 경계: index scope omitted, YAML scope present는 valid.
- 검증 명령어: `npm test -- test/validate/semantic.test.ts test/search/search.test.ts`
- acceptance_tests:
  - {shell: "bash", cmd: "npm test -- test/validate/semantic.test.ts test/search/search.test.ts", expected_exit: 0}
  - {shell: "pwsh", cmd: "npm test -- test/validate/semantic.test.ts test/search/search.test.ts", expected_exit: 0}
- DoD:
  - `SRS_SCOPE_MISMATCH` semantic error가 추가된다.
  - `DUPLICATE_SRS_PRIMARY_SCOPE` semantic error가 추가된다.
  - scope filter tests still pass.
  - SRS primary scope policy가 release acceptance matrix에 연결된다.
- rollback: {strategy: "manual", command: "1) Revert edits in src/validate/semantic.ts and test/validate/semantic.test.ts. 2) Run npm test -- test/validate/semantic.test.ts."}
- 예상 소요: 3~4시간

## Phase P3 - Cache Regeneration Evidence

목표: SRS의 broad cache stale/degrade wording을 search-only evidence에서 graph/entities/relations/diagnostics coverage까지 확장한다.

### TASK-P3-001 - Add Section-Level Stale Cache Regeneration Tests

- 관련 REQ-ID: `FR-CACHE-001`, `FR-CACHE-005`, `FR-CACHE-006`, `FR-CACHE-007`, `FR-CACHE-008`, `FR-STOR-006`, `FR-SRCH-009`, `NFR-REL-005`
- 파일 경로: `src/core/read-model.ts`, `src/core/search.ts`, `test/cache/cache.test.ts`, `test/graph/graph.test.ts`
- 메서드/함수 시그니처:
  - `export async function loadReadModel(input: { root: string; cacheMode?: CacheMode; sections: IndexSectionName[] }): Promise<ReadModel>`
  - `async function buildReadModel(root: WorkspaceRoot, sections: readonly IndexSectionName[]): Promise<ReadModel>`
  - `export async function searchWorkspace(input: SearchInput): Promise<SearchResultSet>`
- 참고 패턴:
  - `src/core/read-model.ts:157-210` has cache read and source fallback.
  - `src/core/search.ts:38-75` triggers search rebuild when search cache is stale.
  - `test/cache/cache.test.ts:226-237` covers corrupt search cache degrade.
  - `test/graph/graph.test.ts:142-165` covers fresh graph cache read.
- source_anchors:
  - `src/core/read-model.ts:157-210`
  - `src/core/search.ts:38-75`
  - `test/cache/cache.test.ts:226-237`
  - `test/graph/graph.test.ts:142-165`
- 구현 가이드:
  1. Add tests that make `graph.json`, `entities.json`, `relations.json`, and `diagnostics.json` stale after a valid manifest by changing YAML source.
  2. In `cacheMode: "auto"`, public graph/list/get/search calls must trigger `rebuildCache()` before returning cached-section results when `isIndexSectionFresh()` is false.
  3. After the public call, re-read `.speckiwi/cache/manifest.json` and assert the affected section input/output fingerprint changed to a fresh value.
  4. For graph, call `createSpecKiwiCore({ root }).graph()` and assert it returns source-equivalent result, not stale artifact content, and the graph section artifact is regenerated.
  5. For list/get requirement, call `listRequirements()` and `getRequirement()` and assert stale entity/relation artifacts do not leak cache-only sentinel values, then assert entity/relation sections are regenerated.
  6. For validation/diagnostics cache, assert stale diagnostics artifact is not treated as source of truth, then assert diagnostics section is regenerated when validation path supports diagnostics cache.
  7. Keep corrupt artifact behavior separate: corrupt artifacts may degrade to source with `*_CACHE_UNREADABLE` warning, satisfying `FR-CACHE-007`; stale-but-readable artifacts must be rebuilt for `FR-CACHE-006`.
  8. Do not add a new cache subsystem. Reuse existing `isIndexSectionFresh()` and read-model stats.
- Rationale: Previous verification accepted search cache coverage but found SRS wording broader than verified behavior.
- 함정 / 주의사항:
  - `--no-cache` bypass must not write artifacts while these tests run.
  - Cache-only sentinel data must not match valid source data.
  - Preserve exact lookup performance by not hashing all artifacts on each lookup.
- 테스트 작성 지침:
  - 성공: fresh graph cache hit still reports `mode: "cache"`.
  - 실패: corrupt graph cache returns source-equivalent result with unreadable-cache warning.
  - 실패: stale graph/entity/relation cache triggers auto rebuild and refreshed manifest section.
  - 경계: stale entity shard cannot create a requirement absent from YAML.
- 검증 명령어: `npm test -- test/cache/cache.test.ts test/graph/graph.test.ts`
- acceptance_tests:
  - {shell: "bash", cmd: "npm test -- test/cache/cache.test.ts test/graph/graph.test.ts", expected_exit: 0}
  - {shell: "pwsh", cmd: "npm test -- test/cache/cache.test.ts test/graph/graph.test.ts", expected_exit: 0}
- DoD:
  - stale cache tests cover search, graph, entity, relation, diagnostics sections.
  - stale-but-readable graph/entity/relation/diagnostics sections are regenerated before public result is returned.
  - corrupt cache tests cover degrade warnings separately.
  - no stale artifact content appears in public Core results.
  - `--no-cache` tests still assert no cache read/write.
- rollback: {strategy: "manual", command: "1) Revert edits in src/core/read-model.ts, src/core/search.ts, test/cache/cache.test.ts, and test/graph/graph.test.ts. 2) Run npm test -- test/cache/cache.test.ts test/graph/graph.test.ts."}
- 예상 소요: 5~8시간

### TASK-P3-002 - Add Release Matrix Coverage For Cache Section Evidence

- 관련 REQ-ID: `FR-CACHE-006`, `FR-CACHE-007`, `NFR-REL-010`
- 파일 경로: `test/release/acceptance.test.ts`, `test/cache/cache.test.ts`, `test/graph/graph.test.ts`
- 메서드/함수 시그니처:
  - `it("maps every remediation checklist item to automated coverage", async () => Promise<void>)`
- 참고 패턴:
  - `test/release/acceptance.test.ts:43-123` maps remediation requirements to test anchors.
  - `test/cache/cache.test.ts:226-237` is an existing cache degrade anchor.
- source_anchors:
  - `test/release/acceptance.test.ts:43-123`
  - `test/cache/cache.test.ts:226-237`
  - `test/graph/graph.test.ts:142-165`
- 구현 가이드:
  1. Extend the release acceptance matrix with anchors for graph/entity/relation/diagnostics stale cache behavior.
  2. Use existing requirement IDs where possible: `FR-CACHE-006`, `FR-CACHE-007`.
  3. Keep matrix as anchor coverage, not long-running behavior test.
- Rationale: The release gate should fail when a known SRS gap loses its automated evidence.
- 함정 / 주의사항:
  - Do not duplicate heavy cache behavior in release acceptance.
  - Anchor text must be stable and descriptive.
- 테스트 작성 지침:
  - 성공: matrix finds all new anchors.
  - 실패: removing a stale-cache test fails release acceptance.
  - 경계: release acceptance still runs within 60 seconds.
- 검증 명령어: `npm test -- test/release/acceptance.test.ts`
- acceptance_tests:
  - {shell: "bash", cmd: "npm test -- test/release/acceptance.test.ts", expected_exit: 0}
  - {shell: "pwsh", cmd: "npm test -- test/release/acceptance.test.ts", expected_exit: 0}
- DoD:
  - release acceptance matrix includes cache section coverage.
  - `npm run release:acceptance` passes.
- rollback: {strategy: "manual", command: "1) Revert edits in test/release/acceptance.test.ts. 2) Run npm test -- test/release/acceptance.test.ts."}
- 예상 소요: 1~2시간

## Phase P4 - Packaging And Release Gates

목표: global install support와 성능 gate를 release 판단에 포함한다.

### TASK-P4-001 - Add Global Install Smoke From Packed Tarball

- 관련 REQ-ID: `FR-CLI-001`, `FR-CLI-002`, `FR-PKG-001`, `FR-PKG-004`, `FR-PKG-005`, `FR-PKG-006`
- 파일 경로: `test/release/acceptance.test.ts`, `package.json`, `bin/speckiwi`
- 메서드/함수 시그니처:
  - `it("installs packed tarball into a temporary global prefix and runs speckiwi", () => void)`
- 참고 패턴:
  - `test/release/acceptance.test.ts:187-202` already verifies `npm pack --dry-run`.
  - `package.json:6-9` declares `bin`.
  - `bin/speckiwi` is the shipped executable.
- source_anchors:
  - `test/release/acceptance.test.ts:187-202`
  - `package.json:6-9`
  - `bin/speckiwi:1-5`
- 구현 가이드:
  1. In release acceptance, run `npm pack --json` in a temp directory or repo root and capture tarball filename.
  2. Create a temp prefix under `tmpdir()`.
  3. Run `npm install --global --prefix <prefix> <tarball>`.
  4. Resolve executable path as `<prefix>/bin/speckiwi` on POSIX and `<prefix>/speckiwi.cmd` or `<prefix>/bin/speckiwi.cmd` on Windows.
  5. Run `speckiwi --help` and assert exit `0` and stdout contains `Usage`.
  6. Run `speckiwi init --root <temp-workspace> --json` and assert `.speckiwi/index.yaml` exists.
  7. Clean temp directories in `afterEach`.
- Rationale: `npm pack --dry-run` proves package contents, not install behavior. SRS requires global install support.
- 함정 / 주의사항:
  - Use temp prefix, not system global prefix.
  - Do not rely on shell path lookup. Execute resolved binary path.
  - Remove generated tarball after test if `npm pack` creates it in repo root.
- 테스트 작성 지침:
  - 성공: packed tarball installs in temp prefix and CLI starts.
  - 실패: missing `bin/speckiwi` or missing `dist` causes command failure.
  - 경계: Windows path resolution handles `.cmd`.
- 검증 명령어: `npm test -- test/release/acceptance.test.ts`
- acceptance_tests:
  - {shell: "bash", cmd: "npm test -- test/release/acceptance.test.ts", expected_exit: 0}
  - {shell: "pwsh", cmd: "npm test -- test/release/acceptance.test.ts", expected_exit: 0}
- DoD:
  - release acceptance contains global install smoke.
  - test uses temp prefix and does not mutate system npm global path.
  - packed CLI can run `init`.
- rollback: {strategy: "manual", command: "1) Revert edits in test/release/acceptance.test.ts. 2) Remove any speckiwi-0.1.0.tgz tarball generated by the test. 3) Run npm test -- test/release/acceptance.test.ts."}
- 예상 소요: 3~5시간

### TASK-P4-002 - Put SRS Performance Gate Into Release Check

- 관련 REQ-ID: `NFR-PERF-001`, `NFR-PERF-002`, `NFR-PERF-003`, `NFR-PERF-004`, `NFR-PERF-005`, `NFR-PERF-007`, `NFR-REL-010`
- 파일 경로: `scripts/release-check.mjs`, `package.json`, `test/release/acceptance.test.ts`, `test/perf/perf.test.ts`
- 메서드/함수 시그니처:
  - `/** @returns {Array<{ name: string, command: string, args: string[], timeoutMs?: number }>} */`
  - `export function releaseCommands()`
  - `it("defines a release-check command sequence and propagates command failures", async () => Promise<void>)`
- 참고 패턴:
  - `scripts/release-check.mjs:10-18` is the release command sequence.
  - `test/release/acceptance.test.ts:133-145` asserts the sequence.
  - `test/perf/perf.test.ts:46-151` contains SRS-scale perf budgets.
- source_anchors:
  - `scripts/release-check.mjs:10-18`
  - `test/release/acceptance.test.ts:133-145`
  - `test/perf/perf.test.ts:46-151`
  - `package.json:53-59`
- 구현 가이드:
  1. Add `{ name: "perf-srs", command: "npm", args: ["run", "perf:srs"], timeoutMs: 120_000 }` before `pack`.
  2. Update release acceptance expected command sequence.
  3. Add an assertion that `perf-srs` timeout is at least `120_000`.
  4. Keep `perf:srs` script unchanged unless exact lookup repeatedly fails in the same clean run.
  5. If repeated exact lookup failures occur, add a narrow performance task in the same code review: cache exact lookup must avoid reparsing and must use warmed requirement shard path.
- Rationale: `release:check` passing while `perf:srs` fails makes release readiness misleading.
- 함정 / 주의사항:
  - `perf:srs` is heavy. It belongs near the end of release gate.
  - Do not relax perf budgets in this task.
  - If Termux variability causes a single failure, rerun once and report both timings.
- 테스트 작성 지침:
  - 성공: release command sequence includes `npm run perf:srs`.
  - 실패: fake failing command still returns its non-zero exit.
  - 경계: timeout kills hung perf command and returns non-zero.
- 검증 명령어: `npm test -- test/release/acceptance.test.ts test/perf/perf.test.ts`
- acceptance_tests:
  - {shell: "bash", cmd: "npm test -- test/release/acceptance.test.ts test/perf/perf.test.ts", expected_exit: 0}
  - {shell: "pwsh", cmd: "npm test -- test/release/acceptance.test.ts test/perf/perf.test.ts", expected_exit: 0}
- DoD:
  - `releaseCommands()` includes `perf-srs`.
  - `npm run release:check` executes perf gate.
  - Perf budget remains SRS-scale strict.
- rollback: {strategy: "manual", command: "1) Revert edits in scripts/release-check.mjs and test/release/acceptance.test.ts. 2) Run npm test -- test/release/acceptance.test.ts."}
- 예상 소요: 2~3시간

## Phase P5 - Out Of Scope Policy Evidence

목표: policy-like SRS items를 behavior evidence와 documentation evidence로 닫는다.

### TASK-P5-001 - Add Git-History-Primary Policy Evidence

- 관련 REQ-ID: `FR-STOR-001`, `FR-STOR-002`, `FR-STOR-003`, `FR-STOR-007`, `FR-WRITE-003`, `FR-WRITE-009`
- 파일 경로: `README.md`, `test/hardening/security.test.ts`, `test/write/apply.test.ts`
- 메서드/함수 시그니처:
  - `it("does not create alternate history stores during write and export workflows", async () => Promise<void>)`
- 참고 패턴:
  - `docs/spec/srs.md:169-175` defines source of truth and Git history policy.
  - `test/hardening/security.test.ts:224-225` scans DB-like outputs.
  - `test/write/apply.test.ts:21-80` contains write behavior tests.
- source_anchors:
  - `docs/spec/srs.md:169-175`
  - `test/hardening/security.test.ts:224-225`
  - `test/write/apply.test.ts:21-80`
  - `README.md:1-41`
- 구현 가이드:
  1. Add README section stating that SpecKiwi stores source YAML and proposals only, and Git history is the primary change history.
  2. Add hardening test that runs propose/apply/export/cache rebuild on a temp workspace and then scans `.speckiwi/` for forbidden alternate history stores: `history`, `audit-log`, `.db`, `.sqlite`, `.sqlite3`.
  3. Allow `.speckiwi/proposals/*.yaml` because proposal is a managed artifact, not a change-history database.
  4. Keep the test file-based. Do not call `git` from the product.
- Rationale: The product cannot force Git usage, but it can avoid creating a parallel history store and document the operating contract.
- 함정 / 주의사항:
  - Do not delete user files while scanning.
  - Do not reject user-created arbitrary files in `.speckiwi/`. This is release evidence, not runtime enforcement.
  - README wording must not claim automatic git commits.
- 테스트 작성 지침:
  - 성공: normal workflows create YAML proposal/cache/export artifacts only.
  - 실패: adding `.speckiwi/history.db` in test fixture makes scanner fail.
  - 경계: `.speckiwi/proposals/*.yaml` is allowed.
- 검증 명령어: `npm test -- test/hardening/security.test.ts test/write/apply.test.ts`
- acceptance_tests:
  - {shell: "bash", cmd: "npm test -- test/hardening/security.test.ts test/write/apply.test.ts", expected_exit: 0}
  - {shell: "pwsh", cmd: "npm test -- test/hardening/security.test.ts test/write/apply.test.ts", expected_exit: 0}
- DoD:
  - README states Git history policy.
  - hardening test proves no alternate history database is produced by product workflows.
  - DB file prohibition remains enforced.
- rollback: {strategy: "manual", command: "1) Revert edits in README.md, test/hardening/security.test.ts, and test/write/apply.test.ts. 2) Run npm test -- test/hardening/security.test.ts test/write/apply.test.ts."}
- 예상 소요: 2~4시간

### TASK-P5-002 - Document And Test HTTP Server Out-Of-Scope Boundary

- 관련 REQ-ID: `OOS-003`, `OOS-004`, `NFR-SEC-001`, `NFR-SEC-002`, `FR-MCP-TR-001`, `FR-MCP-TR-004`
- 파일 경로: `README.md`, `test/hardening/security.test.ts`, `package-lock.json`, `src/mcp/server.ts`
- 메서드/함수 시그니처:
  - `it("keeps HTTP packages as unused transitive dependencies only", () => void)`
  - `it("starts MCP over stdio without opening HTTP ports", async () => Promise<void>)`
- 참고 패턴:
  - `src/mcp/server.ts:13-30` creates MCP server.
  - `test/hardening/security.test.ts:45-93` scans runtime package surface.
  - `package-lock.json:289` shows transitive HTTP packages from MCP SDK.
- source_anchors:
  - `src/mcp/server.ts:13-30`
  - `test/hardening/security.test.ts:45-93`
  - `package-lock.json:289-330`
  - `README.md:1-41`
- 구현 가이드:
  1. Keep direct dependencies unchanged.
  2. Add README note that HTTP packages may appear transitively via MCP SDK but SpecKiwi v1 exposes only CLI and stdio MCP.
  3. Add test that scans `src/**` and `bin/**` for HTTP server start APIs: `listen(`, `createServer(`, `express(`, `fastify(`.
  4. Add lockfile allowlist for MCP SDK transitive HTTP packages so audit reports them as transitive-only, not product surface.
  5. Existing MCP stdio test remains the behavior source.
- Rationale: Strict dependency-surface interpretation raised risk, while SRS out-of-scope requirement is behavioral. The plan makes that distinction testable.
- 함정 / 주의사항:
  - Do not remove MCP SDK transitive packages manually from lockfile.
  - Do not block the package only because `package-lock.json` contains transitive HTTP package names.
  - The direct product code must stay HTTP-server free.
- 테스트 작성 지침:
  - 성공: source scan finds no HTTP server startup code.
  - 실패: adding `server.listen(` in `src` fails.
  - 경계: lockfile transitive package names are accepted only when not direct dependencies and not imported by source.
- 검증 명령어: `npm test -- test/hardening/security.test.ts test/mcp/tools.test.ts`
- acceptance_tests:
  - {shell: "bash", cmd: "npm test -- test/hardening/security.test.ts test/mcp/tools.test.ts", expected_exit: 0}
  - {shell: "pwsh", cmd: "npm test -- test/hardening/security.test.ts test/mcp/tools.test.ts", expected_exit: 0}
- DoD:
  - README explains stdio-only runtime boundary.
  - source scan blocks HTTP server startup code.
  - MCP stdio tests remain green.
- rollback: {strategy: "manual", command: "1) Revert edits in README.md and test/hardening/security.test.ts. 2) Run npm test -- test/hardening/security.test.ts test/mcp/tools.test.ts."}
- 예상 소요: 2~3시간

### TASK-P5-003 - Document And Test Database And Vector Store Out-Of-Scope Boundary

- 관련 REQ-ID: `OOS-001`, `OOS-002`, `OOS-008`, `FR-STOR-004`, `FR-STOR-005`, `NFR-COMP-007`
- 파일 경로: `README.md`, `test/hardening/security.test.ts`, `package.json`, `package-lock.json`
- 메서드/함수 시그니처:
  - `it("does not define database or vector-store direct dependencies", async () => Promise<void>)`
  - `it("does not create database or vector-store artifacts during product workflows", async () => Promise<void>)`
- 참고 패턴:
  - `docs/spec/srs.md:66-73` lists SQLite, DB migration, and Vector DB as out of scope.
  - `docs/spec/srs.md:169-175` forbids database source stores and DB files.
  - `package.json:80-85` lists direct runtime dependencies.
  - `test/hardening/security.test.ts:80-93` already scans package surface.
- source_anchors:
  - `docs/spec/srs.md:66-73`
  - `docs/spec/srs.md:169-175`
  - `package.json:80-85`
  - `test/hardening/security.test.ts:80-93`
  - `package-lock.json:289-330`
- 구현 가이드:
  1. Extend the existing package surface test so direct dependencies, bin entries, and npm scripts do not contain database, migration, vector DB, daemon, or HTTP server packages.
  2. Add explicit forbidden package names or patterns: `sqlite`, `better-sqlite3`, `postgres`, `pg`, `mysql`, `mongodb`, `duckdb`, `lancedb`, `qdrant`, `chroma`, `weaviate`, `typeorm`, `prisma`, `knex`, `sequelize`.
  3. Add source import scan for `src/**` and `bin/**` to reject direct imports from those packages.
  4. Add workflow artifact scan after validate/search/cache/export/propose/apply to reject `.db`, `.sqlite`, `.sqlite3`, `.sqlite-journal`, `.db-journal`, vector index directories, and migration directories created by the product.
  5. README must state that DB and vector DB packages may not be added as direct dependencies for v1.0.
  6. Do not fail only because `package-lock.json` contains transitive packages unrelated to direct product source. If a transitive entry is allowed, document the parent package and assert the product source does not import it.
- Rationale: The previous plan covered HTTP behavior but did not explicitly map DB/vector out-of-scope requirements. SRS requires no database source store and no DB files.
- 함정 / 주의사항:
  - Do not manually edit `package-lock.json` to remove transitive packages.
  - This is a policy and behavior gate; it must not block the MCP SDK solely for having HTTP transitive dependencies.
  - Keep the scan case-insensitive and path-normalized for Windows.
- 테스트 작성 지침:
  - 성공: current direct dependencies pass DB/vector denylist.
  - 실패: adding `better-sqlite3` or `lancedb` to a synthetic package JSON object fails the matcher.
  - 경계: MCP SDK transitive HTTP entries are documented as transitive and not imported by product source.
- 검증 명령어: `npm test -- test/hardening/security.test.ts`
- acceptance_tests:
  - {shell: "bash", cmd: "npm test -- test/hardening/security.test.ts", expected_exit: 0}
  - {shell: "pwsh", cmd: "npm test -- test/hardening/security.test.ts", expected_exit: 0}
- DoD:
  - `OOS-001`, `OOS-002`, `OOS-008`, `FR-STOR-004`, `FR-STOR-005`, and `NFR-COMP-007` have direct automated evidence.
  - direct dependency and source import scans reject DB/vector packages.
  - product workflows create no DB/vector artifacts.
- rollback: {strategy: "manual", command: "1) Revert edits in README.md and test/hardening/security.test.ts. 2) Run npm test -- test/hardening/security.test.ts."}
- 예상 소요: 2~4시간

## 스펙 매핑 표

| REQ-ID | TASK-ID |
|---|---|
| `FR-PKG-003` | `TASK-P1-001`, `TASK-P1-002` |
| `FR-PKG-005` | `TASK-P1-002`, `TASK-P4-001` |
| `FR-DIR-001` | `TASK-P1-001` |
| `FR-DOC-CHK-001` | `TASK-P1-001` |
| `FR-CACHE-003` | `TASK-P1-001` |
| `FR-CACHE-004` | `TASK-P1-001` |
| `FR-EXP-001` | `TASK-P1-001` |
| `FR-CLI-001` | `TASK-P1-001`, `TASK-P4-001` |
| `FR-CLI-002` | `TASK-P1-002`, `TASK-P4-001` |
| `FR-DICT-003` | `TASK-P2-001` |
| `FR-DICT-004` | `TASK-P2-001` |
| `FR-DICT-005` | `TASK-P2-001` |
| `FR-SRCH-009` | `TASK-P2-001`, `TASK-P3-001` |
| `FR-SRS-DOC-001` | `TASK-P2-002` |
| `FR-SRS-DOC-002` | `TASK-P2-002` |
| `FR-SRS-DOC-004` | `TASK-P2-002` |
| `FR-DOC-010` | `TASK-P2-002` |
| `FR-IDX-008` | `TASK-P2-002` |
| `FR-REQ-011` | `TASK-P2-002` |
| `FR-CACHE-001` | `TASK-P3-001` |
| `FR-CACHE-005` | `TASK-P3-001` |
| `FR-CACHE-006` | `TASK-P3-001`, `TASK-P3-002` |
| `FR-CACHE-007` | `TASK-P3-001`, `TASK-P3-002` |
| `FR-CACHE-008` | `TASK-P3-001` |
| `FR-STOR-006` | `TASK-P3-001` |
| `NFR-REL-005` | `TASK-P3-001` |
| `NFR-REL-010` | `TASK-P3-002`, `TASK-P4-002` |
| `FR-PKG-001` | `TASK-P4-001` |
| `FR-PKG-004` | `TASK-P4-001` |
| `FR-PKG-006` | `TASK-P4-001` |
| `NFR-PERF-001` | `TASK-P4-002` |
| `NFR-PERF-002` | `TASK-P4-002` |
| `NFR-PERF-003` | `TASK-P4-002` |
| `NFR-PERF-004` | `TASK-P4-002` |
| `NFR-PERF-005` | `TASK-P4-002` |
| `NFR-PERF-007` | `TASK-P4-002` |
| `FR-STOR-001` | `TASK-P5-001` |
| `FR-STOR-002` | `TASK-P5-001` |
| `FR-STOR-003` | `TASK-P5-001` |
| `FR-STOR-007` | `TASK-P5-001` |
| `FR-WRITE-003` | `TASK-P5-001` |
| `FR-WRITE-009` | `TASK-P5-001` |
| `OOS-003` | `TASK-P5-002` |
| `OOS-004` | `TASK-P5-002` |
| `NFR-SEC-001` | `TASK-P5-002` |
| `NFR-SEC-002` | `TASK-P5-002` |
| `FR-MCP-TR-001` | `TASK-P5-002` |
| `FR-MCP-TR-004` | `TASK-P5-002` |
| `OOS-001` | `TASK-P5-003` |
| `OOS-002` | `TASK-P5-003` |
| `OOS-008` | `TASK-P5-003` |
| `FR-STOR-004` | `TASK-P5-003` |
| `FR-STOR-005` | `TASK-P5-003` |
| `NFR-COMP-007` | `TASK-P5-003` |

## 리스크 및 완화

| 리스크 | 영향 | 완화 |
|---|---|---|
| `perf:srs`가 release gate에 들어가면서 CI 시간이 늘어남 | release check duration 증가 | perf timeout 120초 고정, command order를 pack 직전으로 배치 |
| Termux/Android 환경에서 exact lookup 50ms가 간헐 초과 | local gate flake | 실패 시 verbose timings를 기록하고 clean run에서 재검증 |
| dictionary cycle을 error로 승격하면서 기존 fixture가 실패할 수 있음 | validation result 변화 | cycle이 없는 fixture는 유지하고, cycle fixture는 `DICTIONARY_SYNONYM_CYCLE` error를 명시적으로 기대 |
| global install smoke가 npm tarball을 repo root에 남김 | dirty worktree 증가 | test cleanup에서 generated tarball을 제거 |
| HTTP transitive package allowlist가 느슨해짐 | out-of-scope 회귀 은폐 | source import/startup scan을 direct behavior gate로 둠 |

## 용어집

| 용어 | 정의 |
|---|---|
| Core facade | `createSpecKiwiCore()`가 반환하는 public library API 표면 |
| Source of truth | 사용자가 편집하는 원본 데이터. SpecKiwi v1에서는 `.speckiwi/**/*.yaml` |
| Cache section | manifest가 추적하는 search, graph, entities, relations, diagnostics 같은 cache artifact 묶음 |
| Stale cache | source YAML 또는 settings 변경 뒤 더 이상 신뢰할 수 없는 cache artifact |
| Degrade | cache를 쓰지 못할 때 source YAML을 직접 읽어 같은 기능을 제공하는 동작 |
| Primary scope | 하나의 SRS YAML 파일이 대표하는 top-level `scope` |
| Global install smoke | temp npm prefix에 패키지를 전역 설치한 뒤 CLI binary 실행을 검증하는 release test |
| Transitive dependency | direct dependency가 내부적으로 끌어오는 package |
| Vector DB | embedding/vector similarity search용 외부 저장소. SpecKiwi v1.0 범위 밖 |

## 메타

| 항목 | 값 |
|---|---|
| mode | NORMAL |
| feasibility | 모든 TASK feasible. 성능 알고리즘 재설계는 scope 밖이며 gate 연결만 포함 |
| dynamic senior triggers | 다중 모듈 변경, 성능 gate, release policy |
| evaluator requirement | GPT-5.5 xhigh evaluator 1명 + normal evaluator 1명 검토 후 보정 |
| dew file | `.snoworca/dew/planner/plan-20260503-speckiwi-final-srs-gap-remed-v1/` |
| planned output | `docs/plans/plan-20260503-speckiwi-final-srs-gap-remediation-v1.md` |
| sidecar | `docs/plans/plan-20260503-speckiwi-final-srs-gap-remediation-v1.md.json` |
