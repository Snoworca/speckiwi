---
plan_id: "v2.2.2-mutation-governance"
plan_contract: "1.1.0"
target: "v2.2.2"
spec_paths:
  - "docs/spec/00.index.md"
  - "docs/spec/10.product-architecture.srs.md"
  - "docs/spec/20.parser-validation.srs.md"
  - "docs/spec/40.mcp-stdio-interface.srs.md"
  - "docs/rule/SRS-MD-Rules-v1.1.0.md"
req_ids:
  - "FR-ARCH-005"
  - "FR-PARSE-018"
  - "FR-MCP-018"
  - "FR-MCP-019"
scope_freeze: true
change_log:
  - date: "2026-05-16"
    reason: "9-round 평가자 루프 (Opus×1 + Sonnet×1) 완료. 라운드 8·9 연속 finding 0 — 사용자 명령 '두번 연속 개선사항 안 나옴' 종료 조건 충족."
    diff_summary: "초기 4-Phase 17-TASK 구조 → 최종 4-Phase 19-TASK (TASK-P1-004 SRS-MD-Rules 갱신, TASK-P2-002b appendix scanner 분리 신설). AC 매핑 28/28 100%. AC-7(c) repeated append 케이스 (m) 신규, replace mode optimistic concurrency 일관화, normalize canonical 보존, canonical section order = render-requirement.ts:65-97, fixture v1.0.0 토큰 정합, toolSchemas export, coverage_summary 28."
    approved_by: "evaluator-consensus (Opus + Sonnet 2-round consecutive PASS)"
forbidden_patterns:
  - "적절히|필요\\s*시|알아서|상황에\\s*맞게|기존\\s*방식대로|어떻게든"
  - {pattern: "probably|should work|maybe|I think", flags: "i"}
  - "TODO(?!:)"
  - "rm\\s+-rf\\s+/"
  - "git\\s+push\\s+--force"
  - "git\\s+reset\\s+--hard\\s+origin"
  - "curl[^\\n]*\\|\\s*(?:bash|sh|zsh|pwsh)"
  - "Invoke-Expression"
  - "eval\\s*\\("
pre_commit_gate:
  - {shell: "bash", cmd: "npm run typecheck", expected_exit: 0}
  - {shell: "pwsh", cmd: "npm run typecheck", expected_exit: 0}
  - {shell: "bash", cmd: "npm run lint", expected_exit: 0}
  - {shell: "pwsh", cmd: "npm run lint", expected_exit: 0}
  - {shell: "bash", cmd: "npm test", expected_exit: 0}
  - {shell: "pwsh", cmd: "npm test", expected_exit: 0}
  - {shell: "bash", cmd: "node ./bin/speckiwi validate --fail-on-warning --json", expected_exit: 0, stdout_regex: "\"errors\"\\s*:\\s*0"}
  - {shell: "pwsh", cmd: "node ./bin/speckiwi validate --fail-on-warning --json", expected_exit: 0, stdout_regex: "\"errors\"\\s*:\\s*0"}
---

# Plan — v2.2.2 Mutation Governance Hardening

## 1. 개요

### 출처 SRS
- `docs/spec/10.product-architecture.srs.md` — `FR-ARCH-005` (Mutation tool kind classification metadata)
- `docs/spec/20.parser-validation.srs.md` — `FR-PARSE-018` (Target Goal meta block parsing)
- `docs/spec/40.mcp-stdio-interface.srs.md` — `FR-MCP-018` (`append_section_note` mutation tool), `FR-MCP-019` (`set_target_goal` mutation + read parity)
- `docs/spec/00.index.md` Target Map → `v2.2.2 / planned`

### 목표
v2.2.2 patch 는 3-agent (architecture · governance · UX) 설계 검토에서 도출된 *mutation governance hardening* 4건을 구현한다.

1. **mutation tool 분류 메타 태그**(`req-scoped` / `log-append` / `workspace`) 도입 → SRS-MD-Rules v1.1.0 §30.3 *Bulk mutation 금지* 정책을 schema 수준으로 격상.
2. **Target Goal meta block parsing** — `### Target: <token>` 헤딩 블록의 `**Goal:**` 라벨을 워크스페이스 records 로 노출.
3. **`append_section_note` mutation tool** — Rationale / Research / Implementation Notes 사후 자유 텍스트 추가. `verification_evidence` / `acceptance_criteria` 명시적 deny-list.
4. **`set_target_goal` mutation + read parity** — Target Goal 메타 블록 write + `summarize_target.goal` / `get_active_target.goal` read 대칭.

### Feasibility (인라인)
| REQ | 난이도 | 근거 |
|---|---|---|
| FR-ARCH-005 | Low | metadata 필드 추가 + contract test 1건. 기존 `registerTool` 시그니처 비파괴 확장. |
| FR-PARSE-018 | Medium | `index-parser.ts` 의 heading-scan 로직 신규. 단 표 컬럼 미수정 → backward-compat 자연 확보. |
| FR-MCP-018 | Medium | update-status.ts 의 reason validator 재사용 + 섹션 allowlist/deny-list 신규 모듈. |
| FR-MCP-019 | Medium | set-active-target.ts 패턴 모방. Target Map 행 lookup 동일. `summarize_target` 응답 확장 1필드. |

Infeasible 0건. High 0건. `--deep-feasibility` 불필요.

### 전체 Phase 수: 4

### 라우팅 힌트
- 본 plan 완료 후 `snoworca-coder` 호출 시 `plan_path=docs/plan/v2.2.2-mutation-governance/plan.md`, `sidecar=plan.json` 지정.
- Phase 의존성: P1(FR-ARCH-005) → P2(FR-PARSE-018) 병렬 가능. P3·P4 는 P1 의 `kind` 메타에 의존하므로 P1 완료 후 진행.

---

## 2. 선행 조건 및 전제

- speckiwi 저장소가 정합 상태 (v2.2.1 release commit 이후 main). `git status` 클린.
- 현재 active target = `v2.2.0` (00.index.md L9). **본 plan 은 active target 전환을 요구하지 않음** — `target` 인자를 모든 add-* 호출에 명시.
- Node ≥ 22, npm 동작.
- 기존 회귀 baseline: `vitest run` 260/260 PASS (v2.2.1 시점). 본 plan 완료 시 신규 테스트 추가로 인해 총수 증가.
- `validate --fail-on-warning --json` errors=0, warnings=0 유지.

---

## 3. 프로젝트 온보딩 컨텍스트

### 이 프로젝트는 무엇인가
SpecKiwi 는 Git 저장소 안의 Markdown SRS 문서(`docs/spec/**/*.srs.md`)를 요구사항의 단일 진실원본(SSOT) 으로 사용한다. Node.js TypeScript ESM 패키지로, CLI(`speckiwi`) 와 stdio MCP server 두 surface 를 동일 core 위에 노출한다. 외부 DB · YAML · JSON canonical 등 보조 source 를 두지 않는다.

### 주요 디렉토리 맵
- `src/core/parser/` — Markdown SRS 파서. `workspace-parser.ts` 가 진입점. `index-parser.ts` 가 `00.index.md` 메타·Target Map 파싱.
- `src/core/mutation/` — 모든 *write* 경로. `update-status.ts`, `update-stability.ts`, `set-active-target.ts`, `add-requirement.ts`, `check-ac.ts`, `add-evidence.ts`, `add-trace.ts`, `add-completed-work.ts`, `init-project.ts`. 신규 mutation 은 본 디렉토리에 파일 1개를 추가하는 형태.
- `src/core/patch/` — `apply-patch.ts` 의 SHA256 snapshot atomic write 가 모든 mutation 의 공통 백엔드.
- `src/core/query/` — read 경로. `summary.ts:summarizeTarget`, `records.ts`, `links.ts` 등.
- `src/mcp/` — MCP adapter. `adapter.ts` (`McpServerHandle`), `server.ts` (stdio entry + `toolSchemas` zod dict), `tools/mutation-tools.ts` (write tool 등록), `tools/read-tools.ts` (read tool 등록).
- `src/cli/` — `commander` 기반 CLI. `commands/mutations.ts` 가 write 명령 모음, `commands/queries.ts` 가 read.
- `test/core/mutation/` — mutation 단위 테스트. fixture 워크스페이스는 `test/fixtures/workspaces/*` 중 `mutation-target` 가 표준.
- `test/integration/` — e2e (CLI↔MCP parity 등). `test/mcp/` — stdio 자식프로세스 e2e.

### 핵심 규칙 / 절대 금지
- SSOT 는 `docs/spec/`. JSON 사이드카·캐시 파일을 *canonical* 로 취급 금지.
- 모든 mutation 은 SHA256 snapshot 위에서 `applyPatchPlan` 으로 처리. 직접 `writeFile` 금지.
- `bulk-archive` / `bulk-finalize` 등 복수 REQ 일괄 mutation 도구 신설 금지 (CLAUDE.md / AGENTS.md / SRS-MD-Rules v1.1.0 §30.3).
- `update_status`, `update_stability` 의 `reason` 정책(≤500 UTF-16, CR/LF/TAB 제외 제어문자 거부)을 신규 텍스트 입력 mutation 에서 **재사용** — 재구현 금지.
- 기존 prose 필드를 *제거·치환* 하지 말 것 (호환성). 신규 구조 필드는 *병기 추가*.

### 빌드·테스트 명령어 치트시트
```
npm run build             # tsc -p tsconfig.json
npm run typecheck         # tsc --noEmit
npm run lint              # eslint src test --max-warnings=0
npm test                  # vitest run --no-file-parallelism
npx vitest run <path>     # 단일 파일 실행
node ./bin/speckiwi validate --fail-on-warning --json
node ./bin/speckiwi list --json
node ./bin/speckiwi show <REQ-ID>
```

### 참고 문서
- `CLAUDE.md` / `AGENTS.md` — agent 워크플로 (v1.3) + bulk-mutation 금지 항목
- `docs/rule/SRS-MD-Rules-v1.1.0.md` — §30.1 DISCARDED / §30.2 DRAFT / §30.3 Tool Compliance + Bulk mutation 금지 + Mutation tool kind classification 단락
- `docs/plan/v2.2.1-update-stability/plan.md` — 직전 patch 의 plan 구조 참고

### 도움 요청 경로
- 막힐 때 가장 먼저 `git log --oneline -20` 로 직전 commit 의 의도를 확인.
- AGENTS.md 의 *Current work status workflow* 6단계 (active-target → summary → list_requirements → completed-work) 를 따른다.

---

## 4. AI 에이전트 실행 가드 (frontmatter 와 동기화)

### 4.1 scope_freeze
- 초기값: `false`
- 승격 조건: 본 plan 의 평가자 루프가 *2 라운드 연속 finding 0* 이고, §3.2 step 12 직전.
- 승격 후 변경: `change_log[]` 에 `{date, reason, diff_summary, approved_by}` 1행 필수.

### 4.2 pre_commit_gate (frontmatter 참조)
커밋 직전 통과 필수. snoworca-coder 가 phase 마지막 step 에서 실행. bash + pwsh 병행(win32).

### 4.3 forbidden_patterns (frontmatter 참조)
문서 전역 + 코드 전역 자동 스캔. 평가자는 plan 산문 + 신규 코드 양쪽을 점검.

---

## 5. Phase 1 — FR-ARCH-005 Mutation tool kind classification metadata

### 5.1 목표
모든 mutation tool 등록 시점에 `kind: "req-scoped" | "log-append" | "workspace"` 메타를 의무 선언. CI 가 등록 누락을 거부하고 zod schema 가 `req-scoped` 의 `id` 배열 입력을 거부.

### 5.2 선행 조건
- 없음 (다른 Phase 에 선행).

### 5.3 TASK 목록

#### TASK-P1-001 — McpServerHandle.registerTool 시그니처에 kind 메타 + toolKinds 맵 추가

| 필드 | 값 |
|---|---|
| 제목 | `registerTool` 의 `metadata` 인자에 `kind` 필드 의무화 + `McpServerHandle` 인터페이스에 `toolKinds` 공개 필드 추가 + `createTestMcpServer` 가 메타 저장 |
| 관련 REQ-ID | FR-ARCH-005 (AC-1) |
| 파일 경로 | 수정: `src/mcp/adapter.ts` |
| 메서드/함수 시그니처 | `export type MutationToolKind = "req-scoped" \| "log-append" \| "workspace";` · `interface McpServerHandle { tools: Record<string, McpToolHandler>; resourceTemplates: string[]; toolKinds: Record<string, MutationToolKind>; registerTool(name: string, handler: McpToolHandler, metadata?: { kind?: MutationToolKind } & Record<string, unknown>): void; ... }` · `function assertMutationKind(name: string, metadata?: { kind?: MutationToolKind }): MutationToolKind` (mutation-tools.ts 진입에서 호출용 helper, P1-002 에서 사용) |
| 참고 패턴 | `src/mcp/adapter.ts:7-13` `McpServerHandle` interface. `src/mcp/adapter.ts:15-35` `createTestMcpServer` 구현체. |
| source_anchors | `["src/mcp/adapter.ts:7-13", "src/mcp/adapter.ts:15-35"]` |
| 구현 가이드 | 1) `MutationToolKind` 유니온 타입 export. 2) `McpServerHandle` interface 에 `toolKinds: Record<string, MutationToolKind>` 공개 필드 추가 (테스트가 `server.toolKinds[name]` 접근 가능하도록 *non-optional*). 3) `registerTool` 시그니처: 3번째 인자 `metadata?: { kind?: MutationToolKind } & Record<string, unknown>` (optional 유지 — read-tools 호출은 미수정). 4) `createTestMcpServer` body 의 `registerTool` 구현체: `metadata?.kind` 가 존재하면 `toolKinds[name] = metadata.kind` 에 저장. 5) `assertMutationKind(name, metadata)` helper 신규 export: `metadata?.kind` 가 `req-scoped|log-append|workspace` enum 중 하나가 아니면 throw `new Error(\`Mutation tool '${name}' missing kind metadata\`)`. 6) JSDoc 으로 *읽기 도구는 본 메타 미사용* 명시. |
| Rationale | `toolKinds` 를 인터페이스 *공개 필드* 로 두면 contract test 가 `server.toolKinds` 접근 시 타입 안전. 메타 capture 를 `createTestMcpServer` body 에서 직접 처리하여 *별도 mutation-only 분기* 불필요. `registerTool` 3번째 인자 optional 유지로 read-tools 비파괴 호환. |
| 함정 / 주의사항 | `McpServerHandle` 의 실제 구현체는 `src/mcp/adapter.ts:createTestMcpServer` 단일 경로. `src/mcp/server.ts:21-27` `createMcpServer` 는 `createTestMcpServer(deps)` 를 호출하여 **동일 handle** 을 production stdio entry 에서도 사용한다 (server.ts:172-180 의 `sdk.registerTool` 은 `@modelcontextprotocol/sdk` 라이브러리 API 로 별도 객체 — handle 의 registerTool 과 무관). 따라서 adapter.ts 의 registerTool 본체에서 `metadata?.kind` 를 `toolKinds[name]` 으로 캡처하면 production 과 test 양쪽에서 자동 파생 — server.ts 추가 수정 *불필요*. |
| 테스트 작성 지침 | 신규: `test/mcp/mutation-kind-contract.test.ts` — 케이스 3종 (성공/실패/경계): (성공) `import { MutationToolKind, assertMutationKind } from "../../src/mcp/adapter.js"` 정상 import 후 `assertMutationKind("foo", { kind: "req-scoped" })` 가 `"req-scoped"` 반환. (실패) `assertMutationKind("foo", {})` 가 `"missing kind metadata"` 메시지로 throw. (경계) `assertMutationKind("foo", { kind: "bogus" as never })` 가 throw. |
| 검증 명령어 | `npx vitest run test/mcp/mutation-kind-contract.test.ts && npm run typecheck` |
| acceptance_tests | `[{"shell":"bash","cmd":"npx vitest run test/mcp/mutation-kind-contract.test.ts --no-file-parallelism","expected_exit":0,"stdout_regex":"3 passed"},{"shell":"pwsh","cmd":"npx vitest run test/mcp/mutation-kind-contract.test.ts --no-file-parallelism","expected_exit":0,"stdout_regex":"3 passed"},{"shell":"bash","cmd":"npm run typecheck","expected_exit":0},{"shell":"pwsh","cmd":"npm run typecheck","expected_exit":0}]` |
| DoD | `mutation-kind-contract.test.ts` 의 본 task 담당 3 it (성공/실패/경계) PASS. `typecheck` 0 errors. `MutationToolKind`, `assertMutationKind`, `McpServerHandle.toolKinds` 모두 export/노출. |
| rollback | `{"strategy":"git-reset","command":"git checkout -- src/mcp/adapter.ts && rm -f test/mcp/mutation-kind-contract.test.ts"}` |
| 예상 소요 | 1시간 |

#### TASK-P1-002 — registerMutationTools 의 모든 tool 등록 호출에 kind 선언 + 누락 시 runtime guard

| 필드 | 값 |
|---|---|
| 제목 | 9개 mutation tool 의 `server.registerTool(...)` 호출에 kind 메타 추가 + `assertMutationKind` 진입 강제 |
| 관련 REQ-ID | FR-ARCH-005 (AC-1, AC-3, AC-4) |
| 파일 경로 | 수정: `src/mcp/tools/mutation-tools.ts` · 수정: `test/mcp/mutation-kind-contract.test.ts` (TASK-P1-001 의 파일에 case 추가) |
| 메서드/함수 시그니처 | 변경 없음. 호출부 메타 인자 추가 — 예: `server.registerTool("update_status", async (input) => ..., { kind: "req-scoped" });`. `registerMutationTools` 함수 진입에서 helper `function bindWithKind(name: string, handler, kind: MutationToolKind): void { assertMutationKind(name, { kind }); server.registerTool(name, handler, { kind }); }` 형태로 wrap. |
| 참고 패턴 | `src/mcp/tools/mutation-tools.ts:23-115` 의 9개 `registerTool` 호출. 동일 시그니처에 3번째 인자를 채워 넣는다. |
| source_anchors | `["src/mcp/tools/mutation-tools.ts:23-115"]` |
| 구현 가이드 | 1) 분류 표 — **req-scoped**: `update_status`, `update_stability`, `check_acceptance_criteria`, `add_verification_evidence`, `add_trace_link`. **log-append**: `add_completed_work`. **workspace**: `set_active_target`, `init_project`, `add_requirement`. 2) `add_requirement` 의 분류는 **신규 TASK-P1-004 에서 SRS-MD-Rules §30.3 의 workspace 예시에 명시 추가** 되어 governance 정합. 3) 각 `registerTool` 호출 끝에 `, { kind: "<value>" }` 추가하거나 위 `bindWithKind(name, handler, "<kind>")` helper 로 wrap. 4) JSDoc 으로 분류 사유 명시. |
| Rationale | add_requirement 는 *생성* 이며 단일 기존 REQ 를 mutate 하지 않는다 (id 입력 없음, target/scope 기반). workspace 분류가 자연스럽되, SRS-MD-Rules §30.3 의 workspace 예시 enumeration 에 *현재 add_requirement 미포함* 이므로 본 plan 의 TASK-P1-004 가 rules 텍스트를 동시 갱신하여 governance 충돌 제거. |
| 함정 / 주의사항 | `set_target_goal` 과 `append_section_note` 는 본 Phase 에서 *아직 미존재* — P3-004 / P4-003 에서 등록 시 동시에 kind 메타 선언. **runtime guard**: 누락 시 `assertMutationKind` 가 throw 하므로 import 시점에 즉시 실패 → 빠른 회귀 감지. |
| 테스트 작성 지침 | `test/mcp/mutation-kind-contract.test.ts` 에 본 task 담당 3 케이스 추가 — (성공) `createTestMcpServer + registerMutationTools` 후 `server.toolKinds` 가 9개 키 (`update_status`, `update_stability`, `check_acceptance_criteria`, `add_verification_evidence`, `add_trace_link`, `add_completed_work`, `set_active_target`, `init_project`, `add_requirement`) 를 가지며 각각이 분류 표대로임을 assert. (실패) `bindWithKind("foo", async () => ({}), undefined as never)` → throw. (경계) `server.toolKinds["nonexistent_tool"]` === undefined. |
| 검증 명령어 | `npx vitest run test/mcp/mutation-kind-contract.test.ts` |
| acceptance_tests | `[{"shell":"bash","cmd":"npx vitest run test/mcp/mutation-kind-contract.test.ts --no-file-parallelism","expected_exit":0,"stdout_regex":"6 passed"},{"shell":"pwsh","cmd":"npx vitest run test/mcp/mutation-kind-contract.test.ts --no-file-parallelism","expected_exit":0,"stdout_regex":"6 passed"}]` |
| DoD | mutation-kind-contract 테스트의 P1-001 3 it + 본 task 3 it (성공/실패/경계) 총 6 PASS. 등록된 9개 mutation tool 의 kind 메타가 분류 표와 100% 일치 (typecheck 로 enum 정합). |
| rollback | `{"strategy":"git-reset","command":"git checkout -- src/mcp/tools/mutation-tools.ts test/mcp/mutation-kind-contract.test.ts"}` |
| 예상 소요 | 1시간 |

#### TASK-P1-003 — zod schema 단에서 req-scoped 도구의 id 배열 입력 거부

| 필드 | 값 |
|---|---|
| 제목 | `req-scoped` 분류 도구는 `id: z.string()` 만 허용하고 배열·객체 입력은 zod 단계에서 USAGE 거부 |
| 관련 REQ-ID | FR-ARCH-005 (AC-2, AC-5, AC-6) |
| 파일 경로 | 수정: `src/mcp/server.ts` · 신규: `test/mcp/mutation-kind-contract.test.ts` (TASK-P1-002 에서 시작한 파일에 case 추가) |
| 메서드/함수 시그니처 | 변경 없음 — 단 `toolSchemas` 객체 선언 (`src/mcp/server.ts:36`) 에 **`export` 키워드만 추가** (값·형 변경 없음, 외부 import 가능하도록 노출). `toolSchemas` 의 각 entry 의 `id` 필드가 `z.string()` 임을 *명시적 contract* 로 자동 검증. |
| 참고 패턴 | `src/mcp/server.ts:36-105` `toolSchemas` 객체. 각 entry 가 zod object schema fragment. |
| source_anchors | `["src/mcp/server.ts:36-105"]` |
| 구현 가이드 | 1) `mutation-kind-contract.test.ts` 에 세 번째 it 추가: `for (const [name, schema] of Object.entries(toolSchemas))` 순회 → 해당 tool 의 kind 가 `req-scoped` 이면 `schema.id` 가 `z.string()` 즉 `_def.typeName === "ZodString"` 임을 assert. 2) `kind === "log-append"` 이면 `schema.requirementIds` 는 `z.array(z.string())` 허용 (현재 add_completed_work 에 존재). 3) `kind === "workspace"` 이면 `schema.id` 가 존재하지 않음을 assert. |
| Rationale | zod schema 가 이미 모든 mutation tool 의 입력을 검증 (server.ts L173-180 의 `sdk.registerTool({ inputSchema })`). 별도 런타임 guard 를 추가하지 않고 *기존 schema 가 분류와 정합* 함을 contract test 로 확인하는 것이 최소 침습. |
| 함정 / 주의사항 | `add_requirement` 는 `requirement` / `statement` 같은 string 필드를 가지지만 `id` 는 없다 — workspace 분류로 자연 정합. `add_completed_work.requirementIds` 는 *합법 배열* 임을 별도 it 로 명시 보호. |
| 테스트 작성 지침 | `test/mcp/mutation-kind-contract.test.ts` — 1) MutationToolKind export 검증, 2) 9개 tool kind 메타 정합, 3) zod schema ↔ kind 정합 (위 3 케이스). |
| 검증 명령어 | `npx vitest run test/mcp/mutation-kind-contract.test.ts` |
| acceptance_tests | `[{"shell":"bash","cmd":"npx vitest run test/mcp/mutation-kind-contract.test.ts --no-file-parallelism","expected_exit":0,"stdout_regex":"9 passed"},{"shell":"pwsh","cmd":"npx vitest run test/mcp/mutation-kind-contract.test.ts --no-file-parallelism","expected_exit":0,"stdout_regex":"9 passed"}]` |
| DoD | contract test P1-001 (3) + P1-002 (3) + P1-003 (3) = 9 it PASS. SRS-MD-Rules §30.3 *Mutation tool kind classification* 단락의 enforcement 가 코드로 보증됨. |
| rollback | `{"strategy":"git-reset","command":"git checkout -- src/mcp/server.ts test/mcp/mutation-kind-contract.test.ts"}` |
| 예상 소요 | 1시간 |

#### TASK-P1-004 — SRS-MD-Rules v1.1.0 §30.3 workspace 예시에 add_requirement 명시

| 필드 | 값 |
|---|---|
| 제목 | 분류 governance 충돌 제거 — §30.3 의 workspace 예시 enumeration 에 `add_requirement` 추가 |
| 관련 REQ-ID | FR-ARCH-005 (AC-6) |
| 파일 경로 | 수정: `docs/rule/SRS-MD-Rules-v1.1.0.md` |
| 메서드/함수 시그니처 | N/A (문서 갱신) |
| 참고 패턴 | `docs/rule/SRS-MD-Rules-v1.1.0.md:1464` 의 §30.3 workspace 예시 라인 (이전 patch 에서 추가됨). |
| source_anchors | `["docs/rule/SRS-MD-Rules-v1.1.0.md:1460-1464"]` |
| 구현 가이드 | 1) §30.3 내 `workspace` 예시 라인을 grep — 현재: `"...(예: \`set_active_target\`, \`set_target_goal\`, \`init_project\`)"`. 2) `add_requirement` 를 enumeration 에 추가: `"...(예: \`set_active_target\`, \`set_target_goal\`, \`init_project\`, \`add_requirement\`)"`. 3) 해당 단락 끝에 한 줄 sub-note 추가: *"`add_requirement` 는 신규 REQ 생성으로 단일 id mutation 이 아니므로 workspace 분류."* |
| Rationale | `add_requirement` 는 `id` 입력이 없고 신규 REQ 를 *생성*. SSOT 인 SRS-MD-Rules 가 정합화되어야 plan 의 TASK-P1-002 분류와 일치 (Opus 평가자 MEDIUM-5 해소). |
| 함정 / 주의사항 | 동일 단락에 `append_section_note` 는 *req-scoped* 예시로 추가되어야 함 — 본 task 에서 한꺼번에 처리. |
| 테스트 작성 지침 | 별도 단위 테스트 없음 (문서 변경). `node ./bin/speckiwi validate --fail-on-warning --json` 으로 SRS 정합성 확인. |
| 검증 명령어 | `node ./bin/speckiwi validate --fail-on-warning --json` |
| acceptance_tests | `[{"shell":"bash","cmd":"node ./bin/speckiwi validate --fail-on-warning --json","expected_exit":0,"stdout_regex":"\"errors\"\\s*:\\s*0"},{"shell":"pwsh","cmd":"node ./bin/speckiwi validate --fail-on-warning --json","expected_exit":0,"stdout_regex":"\"errors\"\\s*:\\s*0"}]` |
| DoD | validate errors=0, warnings=0. SRS-MD-Rules §30.3 workspace 예시에 `add_requirement` 명시. |
| rollback | `{"strategy":"git-reset","command":"git checkout -- docs/rule/SRS-MD-Rules-v1.1.0.md"}` |
| 예상 소요 | 15분 |

### 5.4 Phase 1 DoD
- `test/mcp/mutation-kind-contract.test.ts` 9 it PASS.
- `npm run typecheck` / `npm run lint` 0 errors.
- SRS-MD-Rules §30.3 갱신.
- 기존 회귀 (260 baseline) 무손상.

---

## 6. Phase 2 — FR-PARSE-018 Target Goal meta block parsing

### 6.1 목표
`### Target: <token>` 형식의 헤딩 블록을 `00.index.md` 또는 `90.appendix.md` 에서 파싱하여 `ParsedWorkspace.targetGoals: Record<string, string>` 으로 노출. 표 컬럼은 미수정.

### 6.2 선행 조건
- 없음 (P1 과 병렬 가능). 단 코더가 단일 commit 으로 묶을 경우 P1 의 회귀 baseline 을 먼저 통과시킬 것을 권장.

### 6.3 TASK 목록

#### TASK-P2-001 — IndexDocument 타입에 targetGoals 필드 추가

| 필드 | 값 |
|---|---|
| 제목 | `ParsedWorkspace` / `IndexDocument` 타입에 `targetGoals: Record<string, string>` 필드 신설 |
| 관련 REQ-ID | FR-PARSE-018 (AC-3, AC-4) |
| 파일 경로 | 수정: `src/core/types.ts` |
| 메서드/함수 시그니처 | `IndexDocument` interface 에 `targetGoals: Record<string, string>` 추가. `ParsedWorkspace` 가 `index: IndexDocument` 를 포함하므로 자동 전파. |
| 참고 패턴 | `src/core/types.ts:164` `IndexDocument` interface 정의. 동일 구조의 `targetEntries: TargetEntry[]` 등 옆에 새 필드 추가. |
| source_anchors | `["src/core/types.ts:164"]` |
| 구현 가이드 | 1) `IndexDocument` interface 끝에 `targetGoals: Record<string, string>;` 추가. 2) AC-4 에 따라 *부재 = 진단 없음* 이므로 빈 객체 기본값 (`{}`). 3) Optional `?:` 가 아니라 *항상 존재* 로 둔다 (consumer 가 keys 만 비어있음을 다룸). |
| Rationale | optional 로 두면 consumer 가 매번 `?? {}` 분기를 작성해야 함. 빈 객체 default 가 fail-safe. |
| 함정 / 주의사항 | `src/core/types.ts` 는 거대 — 한 줄만 추가하되 기존 export 순서 보존. |
| 테스트 작성 지침 | 본 task 의 별도 단위 테스트 불필요 (P2-003 의 e2e 테스트가 cover). typecheck 만으로 충분. |
| 검증 명령어 | `npm run typecheck` |
| acceptance_tests | `[{"shell":"bash","cmd":"npm run typecheck","expected_exit":0},{"shell":"pwsh","cmd":"npm run typecheck","expected_exit":0}]` |
| DoD | typecheck PASS. consumer 코드 변경 없음 (default 빈 객체). |
| rollback | `{"strategy":"git-reset","command":"git checkout -- src/core/types.ts"}` |
| 예상 소요 | 15분 |

#### TASK-P2-002 — `extractTargetGoals` helper + index-parser.ts 통합 (00.index.md 스캔)

| 필드 | 값 |
|---|---|
| 제목 | `parseIndexDocument` 가 `### Target: <token>` 헤딩 블록을 스캔하여 `**Goal:** <text>` 라벨을 추출 |
| 관련 REQ-ID | FR-PARSE-018 (AC-1 part 1/2, AC-2) |
| 파일 경로 | 수정: `src/core/parser/index-parser.ts` · 신규: `test/core/parser/target-goal-block.test.ts` |
| 메서드/함수 시그니처 | 내부 helper: `export function extractTargetGoals(lines: readonly string[]): Record<string, string>` · `parseIndexDocument` 반환 객체에 `targetGoals` 포함. |
| 참고 패턴 | `src/core/parser/index-parser.ts:91` `parseIndexDocument` 본체. 기존 `parseMarkdownTable` 호출 직후에 `extractTargetGoals(file.lines)` 호출 결과를 `index` 객체에 병합. |
| source_anchors | `["src/core/parser/index-parser.ts:91"]` |
| 구현 가이드 | 1) helper: `lines` 를 순회하며 `^### Target:\s+(\S+)\s*$` 정규식 매칭. 매칭 시 다음 동급(`###`) 또는 상위(`##`/`#`) 헤딩이 나올 때까지 본문 라인 수집. 2) 본문에서 `^\*\*Goal:\*\*\s*(.+)$` 라인을 찾아 capture group 1 을 trim. 다음 라인부터 빈 줄이 아니고 새 `**<Label>:**` 패턴이 아니면 multi-paragraph 로 간주하고 `\n` 으로 join. 3) 결과 `Record<string, string>` 반환. 4) Goal 라인 없는 블록은 키 미생성 (AC-4). 5) **helper 는 export** 하여 TASK-P2-002b (appendix 스캔) 에서 재사용. |
| Rationale | parser 는 lenient — 부재가 진단을 생성하면 backward-compat 깨짐. 라벨 부재 = 키 부재 가 가장 안전. helper export 로 appendix 분기와 코드 중복 회피. |
| 함정 / 주의사항 | `### Target:` 패턴은 향후 다른 SRS 헤딩 컨벤션과 충돌할 수 있다 — 정확히 `Target:` 뒤 공백 + 토큰 1개로 한정. 토큰에 `/`·`\` 등 경로 문자가 섞이면 reject 하고 빈 결과 (보안 마진). |
| 테스트 작성 지침 | 신규 `test/core/parser/target-goal-block.test.ts` — 4 케이스 (성공·실패·경계 모두 포함): (1) 단일 Goal block 정상 추출, (2) Goal 라벨 부재 → 키 비생성 (실패 분기), (3) multi-paragraph Goal → `\n` join, (4) 두 개 Target block 병존 → 두 키 모두 (경계: 동일 token 중복은 마지막이 우선). |
| 검증 명령어 | `npx vitest run test/core/parser/target-goal-block.test.ts` |
| acceptance_tests | `[{"shell":"bash","cmd":"npx vitest run test/core/parser/target-goal-block.test.ts --no-file-parallelism","expected_exit":0,"stdout_regex":"4 passed"},{"shell":"pwsh","cmd":"npx vitest run test/core/parser/target-goal-block.test.ts --no-file-parallelism","expected_exit":0,"stdout_regex":"4 passed"}]` |
| DoD | 4 케이스 PASS. `extractTargetGoals` export. parser 진단 errors=0 (validate clean). |
| rollback | `{"strategy":"git-reset","command":"git checkout -- src/core/parser/index-parser.ts && rm -f test/core/parser/target-goal-block.test.ts"}` |
| 예상 소요 | 2시간 |

#### TASK-P2-002b — workspace-parser.ts 에서 90.appendix.md 도 스캔 + merge (FR-PARSE-018 AC-1 part 2/2)

| 필드 | 값 |
|---|---|
| 제목 | `parseWorkspace` 가 90.appendix.md 안의 Target Goal block 도 추출하여 index.targetGoals 와 merge |
| 관련 REQ-ID | FR-PARSE-018 (AC-1 part 2/2, AC-3, AC-4) |
| 파일 경로 | 수정: `src/core/parser/workspace-parser.ts` · 수정: `src/core/parser/discover.ts` · 수정: `test/core/parser/target-goal-block.test.ts` |
| 메서드/함수 시그니처 | `SrsFileSet` 에 `appendix?: TextFile` optional 필드 추가 (scopeFiles 는 *미수정* — appendix 는 scanRequirementBlocks 대상이 아님). `discoverSrsFiles(root)` 가 `docs/spec/90.appendix.md` 존재 시 TextFile 채워 반환. `parseWorkspace(root)` 가 appendix TextFile 가용 시 `extractTargetGoals(appendix.lines)` 호출 후 `index.targetGoals` 와 merge. 충돌 시 SRS-W040 진단 1건. |
| 참고 패턴 | `src/core/parser/workspace-parser.ts:7-29` `parseWorkspace` 본체. `src/core/parser/discover.ts:7-9` `SrsFileSet` interface. `src/core/parser/discover.ts:26` `discoverSrsFiles` 진입. |
| source_anchors | `["src/core/parser/workspace-parser.ts:7-29", "src/core/parser/discover.ts:7-39"]` |
| 구현 가이드 | 1) `SrsFileSet` interface (`discover.ts:7-9`) 에 `appendix?: TextFile` optional 필드 추가. scopeFiles 는 미수정 — `.endsWith('.srs.md')` 필터 그대로 (appendix 는 `.md` 만 가져 자연 제외). 2) `discoverSrsFiles` 본체에서 `docs/spec/90.appendix.md` 파일 존재 검사 (`access`) → 존재 시 `readUtf8File` 로 TextFile 얻어 `appendix` 필드 채움. 부재 시 undefined. 3) `parseWorkspace(root)` 에서 `discovered.appendix?.lines` 가용 시 `extractTargetGoals(discovered.appendix.lines)` 호출. 4) `parseIndexDocument` 결과의 `targetGoals` 와 merge — `Object.assign({}, indexGoals, appendixGoals)` (appendix 가 후행 권위). 5) 동일 token 이 두 파일에 모두 존재하면 diagnostic `{ code: "SRS-W040", severity: "warning", message: "Target Goal block for '<token>' defined in both 00.index.md and 90.appendix.md; appendix value wins", path: appendix.relativePath, line: <appendix Goal block 라인> }`. 6) appendix 파일 자체가 없으면 skip (AC-4 부재 무진단). 7) **scopeFiles 는 변경 없음** → scanRequirementBlocks 가 appendix 에서 실행되지 않음. 기존 회귀 baseline (260 PASS) 무영향. |
| Rationale | AC-1 의 "*00.index.md or 90.appendix.md*" 두 위치 모두 cover. `appendix?: TextFile` 신규 optional 필드는 *비파괴 확장* — scopeFiles 호출자는 영향 없음. scanRequirementBlocks 가 appendix 에서 돌지 않으므로 기존 통합 테스트 (260 PASS) 회귀 무손상. 후행 권위 merge 로 appendix 의 override 시맨틱. SRS-W040 으로 governance 노출. |
| 함정 / 주의사항 | scopeFiles 에 appendix 를 *추가하면* 안 됨 — scanRequirementBlocks 가 appendix 의 `### Target:` 헤딩을 REQ heading 으로 잘못 해석할 위험. `appendix?: TextFile` *별도 채널* 로만 노출. 정확히 `90.appendix.md` 파일명 매칭 — `prefix 90` 의 다른 파일이 있어도 무시. |
| 테스트 작성 지침 | `test/core/parser/target-goal-block.test.ts` 에 케이스 3종 추가: (5) appendix 단독 Goal block → targetGoals 매핑. (6) index + appendix 동일 token 공존 → appendix 값 + SRS-W040 진단 1건. (7) appendix 부재 → 진단 없음, index 결과만. |
| 검증 명령어 | `npx vitest run test/core/parser/target-goal-block.test.ts` |
| acceptance_tests | `[{"shell":"bash","cmd":"npx vitest run test/core/parser/target-goal-block.test.ts --no-file-parallelism","expected_exit":0,"stdout_regex":"7 passed"},{"shell":"pwsh","cmd":"npx vitest run test/core/parser/target-goal-block.test.ts --no-file-parallelism","expected_exit":0,"stdout_regex":"7 passed"}]` |
| DoD | 7 케이스 PASS (P2-002 4 + P2-002b 3). appendix Goal block 정상 노출. SRS-W040 충돌 진단 정상. |
| rollback | `{"strategy":"git-reset","command":"git checkout -- src/core/parser/workspace-parser.ts src/core/parser/discover.ts test/core/parser/target-goal-block.test.ts"}` |
| 예상 소요 | 2시간 |

#### TASK-P2-003 — ParsedWorkspace 통합 검증 e2e (index + appendix 모두)

| 필드 | 값 |
|---|---|
| 제목 | fixture workspace 의 00.index.md + 90.appendix.md 양쪽에 Target Goal block 을 박고 `parseWorkspace` 결과의 `index.targetGoals` 읽기 검증 |
| 관련 REQ-ID | FR-PARSE-018 (AC-3, AC-5) |
| 파일 경로 | 수정: `test/fixtures/workspaces/valid-basic/docs/spec/00.index.md` (Goal block 2건 추가) · **신규**: `test/fixtures/workspaces/valid-basic/docs/spec/90.appendix.md` (또는 기존 valid-basic 에 appendix 가 없으면 생성, Goal block 1건 포함) · 신규: `test/integration/target-goal-workspace.test.ts` |
| 메서드/함수 시그니처 | 변경 없음 (fixture + 테스트만). |
| 참고 패턴 | `test/integration/cli-mcp-parity.test.ts:13-21` `copyFixtureWorkspace("valid-basic")` 호출 + `parseWorkspace` 사용 패턴. fixture 끝 라인 51 (`wc -l` 결과). |
| source_anchors | `["test/integration/cli-mcp-parity.test.ts:13-21", "test/fixtures/workspaces/valid-basic/docs/spec/00.index.md:51"]` |
| 구현 가이드 | 1) `valid-basic` fixture 의 `00.index.md` 끝 (현재 51 라인) 에 두 block 추가: `### Target: v1.0.0\n\n**Goal:** Establish parser baseline.\n` 및 `### Target: v1.1.0\n\n**Goal:** Active Target empty-init policy.\nSecond paragraph.\n`. 2) `valid-basic` 에 `90.appendix.md` 가 없으면 신규 생성 — 최소 헤더 + Target Goal block 1건 (`### Target: v1.2.0\n\n**Goal:** Hardening governance.\n`). 3) 테스트 (3 케이스, 성공·실패·경계): (성공) `parseWorkspace(root).index.targetGoals["v1.0.0"]` 가 `"Establish parser baseline."`. (성공·multi-paragraph) `["v1.1.0"]` 가 두 줄 `\n` join. (성공·appendix) `["v1.2.0"]` 가 `"Hardening governance."`. (경계·Goal block 부재 fixture mutation-target) `targetGoals === {}`. 4) AC-6 의 control char rejection 은 mutation 단계 책임 — parser e2e 에서 assert 안 함. |
| Rationale | parser 단계에서 control char 거부는 backward-compat 위험 (이미 잘못 들어간 SRS 파일이 진단 폭주). 거부는 write 단계 (FR-MCP-019) 에서 처리하고 read 는 어떤 텍스트도 통과. |
| 함정 / 주의사항 | `valid-basic` fixture 가 다른 통합 테스트에 사용된다 — block 추가가 다른 테스트의 카운트·내용 assertion 을 깨지 않는지 회귀 확인 필요. **반드시 fixture 의 끝부분** 에 추가 (line 52 이후). appendix 파일 신규 생성 시 기존 통합 테스트 (parseWorkspace 회귀) 에서 `files.length` 가 1 증가 — 회귀 영향 사전 grep. |
| 테스트 작성 지침 | 위 구현 가이드 step 3 의 4 케이스 (성공 3 + 경계 1). |
| 검증 명령어 | `npx vitest run test/integration/target-goal-workspace.test.ts && npx vitest run test/integration --no-file-parallelism` |
| acceptance_tests | `[{"shell":"bash","cmd":"npx vitest run test/integration/target-goal-workspace.test.ts --no-file-parallelism","expected_exit":0,"stdout_regex":"4 passed"},{"shell":"pwsh","cmd":"npx vitest run test/integration/target-goal-workspace.test.ts --no-file-parallelism","expected_exit":0,"stdout_regex":"4 passed"}]` |
| DoD | 신규 통합 테스트 4 케이스 PASS. 기존 통합 테스트 회귀 없음. |
| rollback | `{"strategy":"git-reset","command":"git checkout -- test/fixtures/workspaces/valid-basic/docs/spec/00.index.md && rm -f test/fixtures/workspaces/valid-basic/docs/spec/90.appendix.md test/integration/target-goal-workspace.test.ts"}` |
| 예상 소요 | 1.5시간 |

### 6.4 Phase 2 DoD
- 신규 4 + e2e 케이스 PASS.
- 기존 회귀 무손상.
- `validate --fail-on-warning --json` errors=0, warnings=0.

---

## 7. Phase 3 — FR-MCP-018 `append_section_note` mutation tool

### 7.1 목표
새 mutation tool `append_section_note(id, section, text, mode?, dryRun?)` 를 core / MCP / CLI 3 surface 에 등록. allowlist (`rationale`, `research`, `implementation_notes`) + deny-list (`verification_evidence`, `acceptance_criteria`) + ISO 일자 prefix + reason validator 재사용.

### 7.2 선행 조건
- P1 완료 (kind 메타 등록 필요 — req-scoped 분류).

### 7.3 TASK 목록

#### TASK-P3-001 — 섹션 allowlist / deny-list 모듈 (normalized form)

| 필드 | 값 |
|---|---|
| 제목 | `src/core/rules/section-allowlist.ts` 신규 — 섹션 키 normalization + deny-list 우선 매칭 |
| 관련 REQ-ID | FR-MCP-018 (AC-2, AC-3) |
| 파일 경로 | 신규: `src/core/rules/section-allowlist.ts` · 신규: `test/core/rules/section-allowlist.test.ts` |
| 메서드/함수 시그니처 | `export const SECTION_ALLOWLIST = { rationale: "Rationale", research: "Research / Analysis", implementation_notes: "Implementation Notes" } as const;` · `export const SECTION_DENYLIST = new Set(["verification_evidence", "verification_evidences", "acceptance_criteria", "acceptance_criterias"]);` · `export type AllowedSection = keyof typeof SECTION_ALLOWLIST;` · `export function normalizeSectionKey(raw: string): string` (**lowercase + hyphen→underscore + trim — trailing s 제거 *없음*** : canonical key `implementation_notes` 보존 의무) · `export function resolveSectionHeading(key: string): { ok: true; heading: string } \| { ok: false; reason: "denied" \| "unknown" };` |
| 참고 패턴 | 신규 패턴. 가까운 참고: `src/core/schema.ts` 의 `STABILITY_LEVELS` 상수 패턴. |
| source_anchors | `["N/A — 신규"]` |
| 구현 가이드 | 1) `normalizeSectionKey(raw)` — `raw.trim().toLowerCase().replace(/-/g, "_")` (trailing s 제거 *없음* — Opus HIGH-2 carry-over 해소: `implementation_notes` canonical key 가 `implementation_note` 로 깨지는 문제 제거). 2) `SECTION_DENYLIST` 에 deny 변형을 **명시 enumeration**: `new Set(["verification_evidence", "verification_evidences", "acceptance_criteria", "acceptance_criterias"])` — 복수형은 alias 로 명시. 3) `resolveSectionHeading` 진입에서 `const k = normalizeSectionKey(key);`. 4) deny-list 체크 *먼저*: `SECTION_DENYLIST.has(k)` → `{ ok: false, reason: "denied" }`. 5) allowlist 체크: `k in SECTION_ALLOWLIST` → `{ ok: true, heading }`. 6) 둘 다 미매칭 → `{ ok: false, reason: "unknown" }`. |
| Rationale | normalization 은 *lowercase + hyphen→underscore* 만 수행 — canonical key 보존. 복수형·대문자 변형은 SECTION_DENYLIST enumeration 으로 explicit 흡수 — *암묵적 stripping* 으로 인한 canonical 손상 방지. self-justification 회피 시도 (`verification-evidence`·`Verification_Evidence`·`verification_evidences`) 모두 차단. |
| 함정 / 주의사항 | heading 문자열 `"Research / Analysis"` 의 슬래시 공백을 정확히 유지 — fixture 의 `#### Research / Analysis` 와 byte-identical 매칭. SECTION_ALLOWLIST canonical key (`implementation_notes`) 가 *정상 입력으로 통과* 함을 회귀 가드. |
| 테스트 작성 지침 | 신규 `test/core/rules/section-allowlist.test.ts` 8 케이스 (성공·실패·경계): (1) 3개 allowlist 키 정상 해석 (특히 `"implementation_notes"` 가 `Implementation Notes` heading 반환 — canonical 보존 회귀 가드), (2) 2개 deny-list 키 (`verification_evidence`, `acceptance_criteria`) `denied` 반환, (3) 임의 키 (`bogus`) → `unknown` 반환, (4) **대소문자 혼합** `"Rationale"` 정상, (5) **hyphen 변형** `"verification-evidence"` → `denied`, (6) **복수형 alias** `"acceptance_criterias"` → `denied` (SECTION_DENYLIST enumeration 으로 매칭), (7) **공백 변형** `"  rationale  "` → 정상, (8) **canonical 보존 회귀**: `normalizeSectionKey("implementation_notes") === "implementation_notes"` (트레일링 s 미제거 확인). |
| 검증 명령어 | `npx vitest run test/core/rules/section-allowlist.test.ts` |
| acceptance_tests | `[{"shell":"bash","cmd":"npx vitest run test/core/rules/section-allowlist.test.ts --no-file-parallelism","expected_exit":0,"stdout_regex":"8 passed"},{"shell":"pwsh","cmd":"npx vitest run test/core/rules/section-allowlist.test.ts --no-file-parallelism","expected_exit":0,"stdout_regex":"8 passed"}]` |
| DoD | 8 케이스 PASS. typecheck 0 errors. canonical 보존 회귀 가드 통과. |
| rollback | `{"strategy":"file-delete","command":"rm src/core/rules/section-allowlist.ts test/core/rules/section-allowlist.test.ts"}` |
| 예상 소요 | 45분 |

#### TASK-P3-002 — append-section-note 코어 mutation

| 필드 | 값 |
|---|---|
| 제목 | `src/core/mutation/append-section-note.ts` 신규 — update-status.ts 형태를 mirror 한 patch 적용 코어 |
| 관련 REQ-ID | FR-MCP-018 (AC-1, AC-4, AC-5, AC-6) |
| 파일 경로 | 신규: `src/core/mutation/append-section-note.ts` |
| 메서드/함수 시그니처 | `export interface AppendSectionNoteInput { id: string; section: string; text: string; mode?: "append" \| "replace"; dryRun?: boolean; }` · `export async function appendSectionNote(root: ProjectRoot, input: AppendSectionNoteInput): Promise<MutationResult<{ id: string; section: string; written: boolean; mode: "append" \| "replace"; }>>;` |
| 참고 패턴 | `src/core/mutation/update-status.ts:1-133` 전체. 특히 `CONTROL_CHAR_RE` / `MAX_REASON_LENGTH` 상수 (L29-31), `loadRecordWithWorkspace`·`findSectionTableInsertionLine`·`createPatchPlan`·`applyPatchPlan` 호출 순서. |
| source_anchors | `["src/core/mutation/update-status.ts:29-31", "src/core/mutation/update-status.ts:91-133", "src/core/mutation/internal.ts:32"]` |
| 구현 가이드 | 1) `text` 검증 — update-status 의 `MAX_REASON_LENGTH = 500` 과 `CONTROL_CHAR_RE` 를 *동일 모듈에서 import* 하지 말고, 새 파일에서 **동일 값을 재선언**한 뒤 JSDoc 에 *update-status §AC-7 정책과 동기화 의무* 명시. 2) `resolveSectionHeading(input.section)` 호출 → `denied` → MUTATION_DENIED, `unknown` → USAGE. 3) `mode = input.mode ?? "append"`. **append 분기**: ISO 일자 prefix `- [${today}] ${input.text}` 한 줄을 섹션 본문 끝에 insertLines. **replace 분기 (AC-5 단일 호출 + SHA snapshot 해석)**: `text` 가 섹션 본문 전체를 *통째 교체* 하되 *일자 prefix 없음*. AC-5 의 `replace mode requires dryRun=true on first call and writes only after explicit second call (idempotency guard)` 를 *optimistic concurrency 단일 호출 모델* 로 해석한다 — (a) `{mode:"replace", dryRun:true}` 호출 시 SHA snapshot 기반 preview 반환 (written=false), (b) `{mode:"replace", dryRun:false}` 호출 시 SHA snapshot 가드 위에서 patch 적용 (written=true) — 두 호출 사이 다른 mutation 발생 시 STALE_PATCH 자동 반환. 호출자는 (a) 후 (b) 패턴을 *권장* 받지만 *서버는 stateless* 이므로 (b) 단독 호출도 SHA 가드 하에서 정상 처리 (force-replace 시맨틱). **USAGE 거절 분기 제거** — Opus HIGH-3 carry-over 해소: 라운드 1 도입한 *first-call dryRun=false → USAGE* 는 stateless 서버에서 실행 불가능한 logic 이므로 폐기. AC-5 의 *idempotency guard* 는 SHA snapshot 가드로 보장 — 동일 text 재호출은 written=false (변경 없음), 다른 mutation 후 재호출은 STALE_PATCH. 4) `loadRecordWithWorkspace(root, id)` → 미존재시 NOT_FOUND. 5) 비표 섹션용 신규 helper `findSectionInsertionLine(file, record, headingText)` 가 필요 — Rationale/Research/ImplementationNotes 는 표가 아니라 본문. 신규 helper 는 `src/core/mutation/internal.ts:32` 부근에 `findSectionTableInsertionLine` 와 동일 패턴으로 추가 (TASK-P3-003 에서 구현). 6) **canonical section order**: 섹션 부재 자동 신설 시 (AC-6) `src/core/mutation/render-requirement.ts:65-97` 의 REQ 블록 렌더 순서를 *정답 source* 로 인용 — `Requirement → Rationale → Acceptance Criteria → Verification Evidence → Trace Links → Research / Analysis → Implementation Notes → Change Notes`. helper 는 *기존 존재하는 다음 canonical 섹션 직전* 에 삽입. 폴백 (다음 canonical 섹션 모두 부재) → Change Notes 직전. 7) `createPatchPlan` + `applyPatchPlan({dryRun})` + `mutationOk({id, section, mode, written})`. |
| Rationale | reason 정책 재선언은 코드 중복이지만 의도된 격리. AC-5 의 *first call dryRun=true* 는 *권장 protocol* 이지 *강제 게이트* 아님 — stateless 서버는 호출 순서를 구분할 수 없음. optimistic concurrency 모델로 단순화 + SHA snapshot 가드로 두 호출 사이 race 차단. canonical section order 명시. |
| 함정 / 주의사항 | Rationale 등은 *표가 아니라 글*. 기존 `findSectionTableInsertionLine` 은 *표 행 삽입* 용 — 그대로 쓰면 안 됨. 신규 helper 필요. canonical section order enum 은 `src/core/mutation/render-requirement.ts:65-97` 의 렌더 순서와 byte-faithful 일치 — render-requirement.ts 가 정답 source. |
| 테스트 작성 지침 | TASK-P3-003 의 단위 테스트에 흡수 — 본 task 만의 별도 테스트 불필요. |
| 검증 명령어 | `npm run typecheck` |
| acceptance_tests | `[{"shell":"bash","cmd":"npm run typecheck","expected_exit":0},{"shell":"pwsh","cmd":"npm run typecheck","expected_exit":0}]` |
| DoD | typecheck PASS. `appendSectionNote` export 가 src/core/mutation/index 또는 직접 import 경로로 가용. |
| rollback | `{"strategy":"file-delete","command":"rm src/core/mutation/append-section-note.ts"}` |
| 예상 소요 | 2시간 |

#### TASK-P3-003 — findSectionInsertionLine helper + 단위 테스트 (replace mode 포함)

| 필드 | 값 |
|---|---|
| 제목 | `internal.ts` 에 비표 섹션용 insertion/replace helper 추가 + appendSectionNote 단위 테스트 |
| 관련 REQ-ID | FR-MCP-018 (AC-1, AC-2, AC-3, AC-4, AC-5, AC-6, AC-7) |
| 파일 경로 | 수정: `src/core/mutation/internal.ts` · 신규: `test/core/mutation/append-section-note.test.ts` |
| 메서드/함수 시그니처 | `export function findSectionInsertionLine(file: TextFile, record: RequirementRecord, headingText: "Rationale" \| "Research / Analysis" \| "Implementation Notes"): { mode: "append"; line: number } \| { mode: "create"; insertAtLine: number } \| undefined;` · `export function findSectionBodyRange(file, record, headingText): { startLine: number; endLine: number } \| undefined;` (replace 시 본문 통째 교체용) |
| 참고 패턴 | `src/core/mutation/internal.ts:32` `findSectionTableInsertionLine` 함수. 동일 시그니처 구조이지만 표 헤더 행 대신 *섹션 본문 마지막 라인 직후* 또는 *섹션 전체 범위* 를 반환. |
| source_anchors | `["src/core/mutation/internal.ts:32"]` |
| 구현 가이드 | 1) `findSectionInsertionLine` helper — `### ${record.id}` 헤딩부터 record 의 다음 `### ` 또는 `## ` 까지의 범위에서 `^#### ${headingText}\s*$` 매칭. 매칭 시 본문 마지막 비빈 줄 다음 라인 (`{ mode: "append", line }`). 미매칭 시 **canonical section order** (TASK-P3-002 step 6 참조) 의 다음 존재 섹션 직전 라인 (`{ mode: "create", insertAtLine }`). 2) `findSectionBodyRange` helper — 동일 헤딩 매칭 후 본문 startLine ~ endLine 반환 (replace 시 사용). 3) 테스트 케이스 13 (성공·실패·경계 모두, **option (b) optimistic concurrency**): (a) append 성공: rationale 에 `[2026-MM-DD] note` 라인 1개 추가. (b) deny-list: section="verification_evidence" → MUTATION_DENIED. (c) deny-list: section="acceptance_criteria" → MUTATION_DENIED. (d) unknown: section="bogus" → USAGE. (e) **경계 length=500** → 통과, length=501 → USAGE. (f) control char (\x00) → USAGE. (g) **replace mode dryRun=true** → written=false + diff preview, 파일 미변경. (h) **replace mode dryRun=false 단일 호출 (optimistic concurrency)** → SHA snapshot 가드 위에서 본문 통째 교체 (일자 prefix 없음), written=true. (i) **replace mode 두-호출 시퀀스 race**: dryRun=true preview 후 *다른 mutation* (예: updateStatus on 동일 REQ) 발생 → 후속 dryRun=false 호출 시 STALE_PATCH 반환 (SHA 가드 자동 race 차단). (j) 섹션 부재 시 자동 신설 (fixture 에서 Rationale heading 사전 제거 후 호출) — canonical order 에 따라 Acceptance Criteria 또는 Requirement 직후 삽입. (k) dryRun (append) → written=false + 파일 미변경. (l) **canonical order 검증** — REQ 가 [Requirement, Verification Evidence, Change Notes] 만 있을 때 section=rationale append → Rationale 이 Requirement 직후 + Verification Evidence 직전 위치. (m) **AC-7(c) repeated append** — 동일 REQ·rationale 섹션에 `appendSectionNote` 를 3회 연속 호출 (각 호출의 text 는 서로 다른 문자열) 후 본문에서 `^- \[\d{4}-\d{2}-\d{2}\] ` 패턴 라인이 정확히 3개 검출되고 각 라인의 text 가 호출 순서대로 보존됨. |
| Rationale | **option (b) optimistic concurrency**: replace 의 *first call dryRun=true* 는 *권장 protocol* 일 뿐 *서버 강제 게이트 아님*. stateless server 는 first vs commit dryRun=false 를 구분할 수 없으므로 USAGE 게이트 폐기. SHA snapshot guard 가 두 호출 사이 race 자동 차단 — AC-5 의 *idempotency guard* 절은 SHA 가드로 충족. canonical order 테스트로 Opus MEDIUM-8 정합 검증. |
| 함정 / 주의사항 | 섹션 부재 자동 신설 (AC-6) 시 단순히 *Change Notes 직전* 이 아니라 **canonical order 의 다음 존재 섹션 직전**. 예: REQ 가 [Verification Evidence, Change Notes] 만 가지면 Rationale 은 Verification Evidence 직전. `src/core/mutation/render-requirement.ts:65-97` 의 렌더 순서가 정답. |
| 테스트 작성 지침 | 위 13 케이스. fixture: `mutation-target` 의 FR-ARCH-001 사용. 케이스 (j) 는 fixture 에서 특정 섹션을 사전 제거 (테스트 내 임시 write) 후 호출 — fixture 영구 변경 금지. 케이스 (m) 은 동일 fixture 에서 연속 호출. |
| 검증 명령어 | `npx vitest run test/core/mutation/append-section-note.test.ts` |
| acceptance_tests | `[{"shell":"bash","cmd":"npx vitest run test/core/mutation/append-section-note.test.ts --no-file-parallelism","expected_exit":0,"stdout_regex":"13 passed"},{"shell":"pwsh","cmd":"npx vitest run test/core/mutation/append-section-note.test.ts --no-file-parallelism","expected_exit":0,"stdout_regex":"13 passed"}]` |
| DoD | 13 케이스 PASS. AC-7 의 (a) append 성공 + (b) deny-list verification_evidence + (c) repeated append (케이스 m, 3회 호출 후 N=3 prefix 라인) + AC-5 (append + replace optimistic concurrency + race STALE_PATCH) + AC-6 (canonical order 자동 신설) 모두 자동 검증. |
| rollback | `{"strategy":"git-reset","command":"git checkout -- src/core/mutation/internal.ts && rm test/core/mutation/append-section-note.test.ts"}` |
| 예상 소요 | 3.5시간 |

#### TASK-P3-004 — MCP tool 등록

| 필드 | 값 |
|---|---|
| 제목 | `append_section_note` 를 `mutation-tools.ts` 에 등록 + `server.ts` 의 toolSchemas 에 zod schema 추가 |
| 관련 REQ-ID | FR-MCP-018 (AC-1, AC-8) |
| 파일 경로 | 수정: `src/mcp/tools/mutation-tools.ts` · 수정: `src/mcp/server.ts` |
| 메서드/함수 시그니처 | `server.registerTool("append_section_note", async (input) => resultToMcp(await appendSectionNote(await root(deps, input), { id: String(input.id), section: String(input.section), text: String(input.text), ...(typeof input.mode === "string" ? { mode: input.mode as "append" \| "replace" } : {}), ...(input.dryRun === true ? { dryRun: true } : {}) })), { kind: "req-scoped" });` |
| 참고 패턴 | `src/mcp/tools/mutation-tools.ts:24-43` (update_status / update_stability 등록 패턴). `src/mcp/server.ts:36-105` (toolSchemas dict). |
| source_anchors | `["src/mcp/tools/mutation-tools.ts:24-43", "src/mcp/server.ts:36-105"]` |
| 구현 가이드 | 1) `mutation-tools.ts` 상단 import 에 `import { appendSectionNote } from "../../core/mutation/append-section-note.js";` 추가. 2) 9개 기존 등록 뒤에 새 `registerTool` 호출. kind 메타 반드시 `req-scoped`. 3) `server.ts` 의 `toolSchemas` 에 entry 추가: `append_section_note: { id: z.string(), section: z.string(), text: z.string().max(500), mode: z.enum(["append","replace"]).optional(), dryRun: z.boolean().optional() }`. 4) `isReadOnlyTool` 미수정 (default false). |
| Rationale | core 호출 입력은 string 으로 강제 cast. zod 가 server 진입 시 검증하므로 core 는 trust. text max(500) 은 server 단 1차 가드 — core 의 재검증과 중복 OK. |
| 함정 / 주의사항 | mode enum 의 zod 표현은 `z.enum([...])` — `z.string().optional()` 로 두지 말 것 (잘못된 값 통과). |
| 테스트 작성 지침 | 신규 `test/mcp/append-section-note-mcp.test.ts` — 4 케이스 (성공·실패·경계 모두): (1) 정상 append → ok=true. (2) deny-list section → MUTATION_DENIED. (3) **경계 text length 501** → USAGE. (4) **경계 mode enum 외 값** `mode:"bogus"` → zod schema 단계 거부. update_status MCP 테스트 패턴 참조. |
| 검증 명령어 | `npx vitest run test/mcp/append-section-note-mcp.test.ts` |
| acceptance_tests | `[{"shell":"bash","cmd":"npx vitest run test/mcp/append-section-note-mcp.test.ts --no-file-parallelism","expected_exit":0,"stdout_regex":"4 passed"},{"shell":"pwsh","cmd":"npx vitest run test/mcp/append-section-note-mcp.test.ts --no-file-parallelism","expected_exit":0,"stdout_regex":"4 passed"}]` |
| DoD | MCP 통합 테스트 정확 4 케이스 PASS. mutation-kind-contract 의 등록 도구 카운트가 9 → 10 으로 갱신됨을 동기화. |
| rollback | `{"strategy":"git-reset","command":"git checkout -- src/mcp/tools/mutation-tools.ts src/mcp/server.ts test/mcp/append-section-note-mcp.test.ts"}` |
| 예상 소요 | 1.5시간 |

#### TASK-P3-005 — CLI 명령 등록

| 필드 | 값 |
|---|---|
| 제목 | `speckiwi append-note <id>` CLI 명령 추가 + global-options-help 회귀 동기화 |
| 관련 REQ-ID | FR-MCP-018 (AC-1, AC-7) |
| 파일 경로 | 수정: `src/cli/commands/mutations.ts` · 수정: `test/cli/global-options-help.test.ts` |
| 메서드/함수 시그니처 | `command.command("append-note").argument("<id>").requiredOption("--section <section>").requiredOption("--text <text>").option("--mode <mode>").option("--dry-run").option("--json").action(async (id, options) => { ... })` |
| 참고 패턴 | `src/cli/commands/mutations.ts:95-112` (update-stability 명령 정의). 동일 형태로 신규 추가. |
| source_anchors | `["src/cli/commands/mutations.ts:95-112"]` |
| 구현 가이드 | 1) import 추가: `import { appendSectionNote } from "../../core/mutation/append-section-note.js";`. 2) update-stability 다음에 새 command 정의. 3) `--section` 과 `--text` 모두 `requiredOption`. 4) action 본체: `await appendSectionNote(await rootFrom(command.opts()), { id, section: options.section, text: options.text, ...(typeof options.mode === "string" ? { mode: options.mode as "append" \| "replace" } : {}), ...(options.dryRun ? { dryRun: true } : {}) })`. 5) `global-options-help.test.ts` 의 subcommands 배열에 `"append-note"` 추가 (해당 테스트는 모든 mutation 명령의 --help 에 Global options 섹션이 부착되었는지 검증). |
| Rationale | CLI surface 까지 노출해야 MCP 미사용 환경에서도 dogfooding 가능 (v2.2.1 의 update-stability 도 같은 패턴). |
| 함정 / 주의사항 | mode 인자 검증을 CLI 단에서는 하지 않고 core 에 위임 — invalid mode 가 USAGE 로 떨어지므로 exitCode=5 가 자동 적용. |
| 테스트 작성 지침 | 신규 `test/cli/append-note-cli.test.ts` — 3 케이스 (성공·실패·경계): (1) 정상 호출 → exit 0 + ok:true JSON, (2) 거부 (deny-list section) → exit 5, (3) **경계 mode 미지정** → default `append` 적용 확인. update-stability CLI 테스트 패턴 참조. |
| 검증 명령어 | `npx vitest run test/cli/append-note-cli.test.ts && npx vitest run test/cli/global-options-help.test.ts` |
| acceptance_tests | `[{"shell":"bash","cmd":"npx vitest run test/cli/append-note-cli.test.ts --no-file-parallelism","expected_exit":0,"stdout_regex":"3 passed"},{"shell":"pwsh","cmd":"npx vitest run test/cli/append-note-cli.test.ts --no-file-parallelism","expected_exit":0,"stdout_regex":"3 passed"},{"shell":"bash","cmd":"npx vitest run test/cli/global-options-help.test.ts --no-file-parallelism","expected_exit":0},{"shell":"pwsh","cmd":"npx vitest run test/cli/global-options-help.test.ts --no-file-parallelism","expected_exit":0}]` |
| DoD | CLI 신규 테스트 정확 3 케이스 PASS + global-options-help 회귀 PASS. |
| rollback | `{"strategy":"git-reset","command":"git checkout -- src/cli/commands/mutations.ts test/cli/global-options-help.test.ts && rm -f test/cli/append-note-cli.test.ts"}` |
| 예상 소요 | 1시간 |

### 7.4 Phase 3 DoD
- 신규 테스트 (allowlist 8 + append-section-note core 13 + MCP 통합 4 + CLI 3) 총 28 케이스 PASS.
- mutation-kind-contract 테스트가 등록 도구 10개 (req-scoped 5 + log-append 1 + workspace 3 + append_section_note req-scoped = 10) 반영.
- 회귀 무손상.

---

## 8. Phase 4 — FR-MCP-019 `set_target_goal` mutation + read parity

### 8.1 목표
새 mutation tool `set_target_goal(target, goal, dryRun?)` 가 Target Goal 메타 블록(FR-PARSE-018 형식)을 write. `summarize_target.goal` / `get_active_target.goal` 응답 확장. mutation-tools.ts 에만 등록(kind=workspace), read-tools.ts 미등록.

### 8.2 선행 조건
- P1 완료 (kind 메타).
- P2 완료 (parser 가 Target Goal block 을 읽을 수 있어야 read parity test 가 통과).

### 8.3 TASK 목록

#### TASK-P4-001 — set-target-goal 코어 mutation

| 필드 | 값 |
|---|---|
| 제목 | `src/core/mutation/set-target-goal.ts` 신규 — Target Map 행 lookup + Target Goal 블록 upsert |
| 관련 REQ-ID | FR-MCP-019 (AC-1, AC-2, AC-3, AC-7) |
| 파일 경로 | 신규: `src/core/mutation/set-target-goal.ts` |
| 메서드/함수 시그니처 | `export interface SetTargetGoalInput { target: string; goal: string; dryRun?: boolean; }` · `export async function setTargetGoal(root: ProjectRoot, input: SetTargetGoalInput): Promise<MutationResult<{ target: string; goal: string; written: boolean; }>>;` |
| 참고 패턴 | `src/core/mutation/set-active-target.ts:31-81` 전체. Target Map lookup + 00.index.md patch 흐름 동일. |
| source_anchors | `["src/core/mutation/set-active-target.ts:31-81"]` |
| 구현 가이드 | 1) `target` trim 후 빈값 USAGE. `goal` trim 후 빈값 USAGE. 2) `goal` length > 500 USAGE. control char (CR/LF/TAB 외) USAGE — update-status reason validator 재사용을 위해 `update-status.ts` 의 `CONTROL_CHAR_RE` 를 **export** 하는 작은 PR 을 본 task 에 묶거나 (선호) **동일 상수 재선언** (TASK-P3-002 와 같은 격리 원칙). 본 patch 는 재선언 채택. 3) Target Map 표에 `target` 행 lookup — 미존재 시 NOT_FOUND. 4) `### Target: <target>` 헤딩 block 검색. (a) 존재 + `**Goal:** ...` 라인 존재 → replaceLine 으로 goal 갱신. (b) 존재 + Goal 라인 부재 → 헤딩 다음 빈 줄 뒤에 `**Goal:** <goal>` insertLines. (c) 헤딩 자체 부재 → Target Map 표 직후에 `### Target: <target>\n\n**Goal:** <goal>\n` insertLines. 5) `applyPatchPlan` + mutationOk. |
| Rationale | 0/1/2 단계 upsert 분기로 idempotency 확보 — 같은 input 으로 두 번 호출하면 두 번째는 written=false. set-active-target 와 동일 정책. |
| 함정 / 주의사항 | `### Target: ` 와 `### Target Map` 같은 헤딩 충돌 회피 — 정규식 `^### Target:\s+\S+\s*$` 정확 매칭 (P2-002 와 동일). |
| 테스트 작성 지침 | TASK-P4-002 의 단위 테스트로 흡수. 본 task 는 typecheck 만. |
| 검증 명령어 | `npm run typecheck` |
| acceptance_tests | `[{"shell":"bash","cmd":"npm run typecheck","expected_exit":0},{"shell":"pwsh","cmd":"npm run typecheck","expected_exit":0}]` |
| DoD | typecheck PASS. `setTargetGoal` export. |
| rollback | `{"strategy":"file-delete","command":"rm src/core/mutation/set-target-goal.ts"}` |
| 예상 소요 | 2시간 |

#### TASK-P4-002 — set-target-goal 단위 테스트

| 필드 | 값 |
|---|---|
| 제목 | upsert 3 분기 + 거부 케이스 + dryRun + parser readback |
| 관련 REQ-ID | FR-MCP-019 (AC-1, AC-2, AC-3, AC-7) |
| 파일 경로 | 신규: `test/core/mutation/set-target-goal.test.ts` |
| 메서드/함수 시그니처 | 변경 없음. |
| 참고 패턴 | `test/core/mutation/status-ac.test.ts:1-50` 의 fixture 사용 + readback 패턴. |
| source_anchors | `["test/core/mutation/status-ac.test.ts:1-50"]` |
| 구현 가이드 | 케이스 11 (성공·실패·경계 모두 포함) — (1) target 미존재 → NOT_FOUND, (2) goal 빈값 → USAGE, (3) **경계 goal.length=500 UTF-16 code units 통과 + 501 USAGE**: JS `string.length` 가 UTF-16 code unit count 이므로 surrogate pair emoji 2 unit 카운트. 테스트는 `'a'.repeat(500)` 통과 + `'a'.repeat(501)` USAGE + `'\uD83D\uDE00'.repeat(250)` (= 500 units) 통과 + `'\uD83D\uDE00'.repeat(251)` (= 502 units) USAGE 4 sub-assert. (4) control char (\x00) USAGE / TAB·LF·CR 통과, (5) 헤딩 부재 신규 upsert 후 byte 검증 + parseWorkspace().index.targetGoals 매칭, (6) 기존 Goal 라인 갱신 replace, (7) 같은 input 재호출 written=false (idempotent), (8) dryRun → 파일 무변경 + written=false, (9) AC-7 의 *Requirement Block 미수정* — 호출 전후 `summarize_target.countsByStatus` byte 동일 (workspace 단위 isolation), (10) **경계 동시성**: `Promise.allSettled([setTargetGoal(root,{target:'v1.0.0',goal:'A'}), setTargetGoal(root,{target:'v1.0.0',goal:'B'})])` — 결과 두 개 중 **정확히 하나** `{ok:true, value.written:true}`, **나머지 정확히 하나** `{ok:false, error.code:"STALE_PATCH"}` (SHA snapshot guard 자동 race 차단 검증). `'또는 written=true'` 같은 permissive 분기 금지, (11) Active Target 변경 없음 — `set_target_goal` 호출 후 metadata Active Target 행 그대로. |
| Rationale | set-active-target 패턴 재현 + set-active-target 에 없는 AC-7 (Requirement Block 격리) 명시 검증. UTF-16 boundary 명시로 Opus LOW-11 해소. 동시성 케이스 추가로 Opus MEDIUM-7 해소. |
| 함정 / 주의사항 | fixture 의 `valid-basic` 은 P2-003 에서 이미 Goal block 2개를 가질 수 있음 — 본 테스트는 *별도 fresh fixture* 또는 `mutation-target` 사용. mutation-target 의 Target Map 행 (v1.0.0 만 존재) 활용. 부족하면 fixture 에 더미 Target Map 행 1건 사전 보강. surrogate pair 테스트는 emoji 문자열 `'\uD83D\uDE00'` (😀) 사용. |
| 테스트 작성 지침 | 11 케이스. fixture 의 사전 보강은 본 task 안에서 수행. |
| 검증 명령어 | `npx vitest run test/core/mutation/set-target-goal.test.ts` |
| acceptance_tests | `[{"shell":"bash","cmd":"npx vitest run test/core/mutation/set-target-goal.test.ts --no-file-parallelism","expected_exit":0,"stdout_regex":"11 passed"},{"shell":"pwsh","cmd":"npx vitest run test/core/mutation/set-target-goal.test.ts --no-file-parallelism","expected_exit":0,"stdout_regex":"11 passed"}]` |
| DoD | 11 케이스 PASS. |
| rollback | `{"strategy":"git-reset","command":"git checkout -- test/fixtures/workspaces/mutation-target && rm test/core/mutation/set-target-goal.test.ts"}` |
| 예상 소요 | 2.5시간 |

#### TASK-P4-003 — MCP tool 등록 + zod schema

| 필드 | 값 |
|---|---|
| 제목 | `set_target_goal` mutation-tools.ts 등록 (kind=workspace), server.ts toolSchemas 추가, readOnlyHint=false 보증 |
| 관련 REQ-ID | FR-MCP-019 (AC-4) |
| 파일 경로 | 수정: `src/mcp/tools/mutation-tools.ts` · 수정: `src/mcp/server.ts` |
| 메서드/함수 시그니처 | `server.registerTool("set_target_goal", async (input) => resultToMcp(await setTargetGoal(await root(deps, input), { target: String(input.target), goal: String(input.goal), ...(input.dryRun === true ? { dryRun: true } : {}) })), { kind: "workspace" });` |
| 참고 패턴 | TASK-P3-004 의 append_section_note 등록 방식. set_active_target 의 zod schema (`src/mcp/server.ts:64`). |
| source_anchors | `["src/mcp/server.ts:64", "src/mcp/tools/mutation-tools.ts:60"]` |
| 구현 가이드 | 1) toolSchemas 에 `set_target_goal: { target: z.string(), goal: z.string().min(1).max(500), dryRun: z.boolean().optional() }`. 2) `isReadOnlyTool` 미수정. 3) registerTool 호출에 kind=workspace 메타. |
| Rationale | workspace 분류 — id 인자 없음, target 인자만. P1-002 의 분류 표 정합. |
| 함정 / 주의사항 | `isReadOnlyTool` 함수가 set_target_goal 을 false 로 반환하는지 확인 (default false 라 자동). 단 `mutation-kind-contract` 테스트가 등록 도구 count 를 10 → 11 로 동기화해야 함. |
| 테스트 작성 지침 | 신규: `test/mcp/set-target-goal-mcp.test.ts`. (a) 등록됨, (b) annotations.readOnlyHint === false (server.ts L172-180 sdk 래퍼 경로는 stdio 단계 테스트가 cover — 본 테스트는 createTestMcpServer 단계). (c) `server.callTool("set_target_goal", {...})` 정상 호출. (d) **architectural test**: `read-tools.ts` 파일을 read 하여 `set_target_goal` 문자열이 *등장하지 않음* assert (AC-8 의 architectural guard). |
| 검증 명령어 | `npx vitest run test/mcp/set-target-goal-mcp.test.ts` |
| acceptance_tests | `[{"shell":"bash","cmd":"npx vitest run test/mcp/set-target-goal-mcp.test.ts --no-file-parallelism","expected_exit":0,"stdout_regex":"4 passed"},{"shell":"pwsh","cmd":"npx vitest run test/mcp/set-target-goal-mcp.test.ts --no-file-parallelism","expected_exit":0,"stdout_regex":"4 passed"}]` |
| DoD | MCP 신규 도구 정확 4 케이스 (등록·readOnlyHint·callTool·architectural) PASS. |
| rollback | `{"strategy":"git-reset","command":"git checkout -- src/mcp/tools/mutation-tools.ts src/mcp/server.ts && rm test/mcp/set-target-goal-mcp.test.ts"}` |
| 예상 소요 | 1시간 |

#### TASK-P4-004 — CLI 명령 등록

| 필드 | 값 |
|---|---|
| 제목 | `speckiwi set-target-goal <target>` CLI 명령 추가 |
| 관련 REQ-ID | FR-MCP-019 (AC-1) |
| 파일 경로 | 수정: `src/cli/commands/mutations.ts` · 수정: `test/cli/global-options-help.test.ts` |
| 메서드/함수 시그니처 | `command.command("set-target-goal").argument("<target>").requiredOption("--goal <text>").option("--dry-run").option("--json").action(...)` |
| 참고 패턴 | `src/cli/commands/mutations.ts:114-118` (set-active-target). 동일 형태. |
| source_anchors | `["src/cli/commands/mutations.ts:114-118"]` |
| 구현 가이드 | 1) import setTargetGoal. 2) set-active-target 다음에 신규 command. 3) action: `await setTargetGoal(await rootFrom(command.opts()), { target, goal: options.goal, ...(options.dryRun ? { dryRun: true } : {}) })`. 4) global-options-help.test.ts subcommands 배열에 `"set-target-goal"` 추가. |
| Rationale | CLI surface 통일성. |
| 함정 / 주의사항 | command 이름 hyphen `set-target-goal` 통일 — MCP tool 명은 underscore `set_target_goal`. |
| 테스트 작성 지침 | 신규 `test/cli/set-target-goal-cli.test.ts` — 3 케이스 (성공·실패·경계): (1) 정상 호출 → exit 0 + ok=true, (2) target 미존재 → exit 5 NOT_FOUND, (3) goal 빈값 → exit 5 USAGE. |
| 검증 명령어 | `npx vitest run test/cli/set-target-goal-cli.test.ts && npx vitest run test/cli/global-options-help.test.ts` |
| acceptance_tests | `[{"shell":"bash","cmd":"npx vitest run test/cli/set-target-goal-cli.test.ts --no-file-parallelism","expected_exit":0,"stdout_regex":"3 passed"},{"shell":"pwsh","cmd":"npx vitest run test/cli/set-target-goal-cli.test.ts --no-file-parallelism","expected_exit":0,"stdout_regex":"3 passed"},{"shell":"bash","cmd":"npx vitest run test/cli/global-options-help.test.ts --no-file-parallelism","expected_exit":0},{"shell":"pwsh","cmd":"npx vitest run test/cli/global-options-help.test.ts --no-file-parallelism","expected_exit":0}]` |
| DoD | CLI 신규 정확 3 케이스 PASS + global-options-help 회귀 PASS. |
| rollback | `{"strategy":"git-reset","command":"git checkout -- src/cli/commands/mutations.ts test/cli/global-options-help.test.ts && rm -f test/cli/set-target-goal-cli.test.ts"}` |
| 예상 소요 | 1시간 |

#### TASK-P4-005 — read parity: summarize_target.goal + get_active_target.value.goal (top-level)

| 필드 | 값 |
|---|---|
| 제목 | `TargetSummary` 에 `goal: string \| null` 추가 + `read-tools.ts:48-51` 의 `get_active_target` 인라인 람다가 envelope `value` *top-level* 에 `goal` 직접 노출 |
| 관련 REQ-ID | FR-MCP-019 (AC-5, AC-6) |
| 파일 경로 | 수정: `src/core/query/summary.ts` · 수정: `src/core/types.ts` (`TargetSummary` 필드 추가) · 수정: `src/mcp/tools/read-tools.ts` |
| 메서드/함수 시그니처 | `TargetSummary` interface (`src/core/types.ts:245`) 에 `goal: string \| null;` 추가. `summarizeTarget(workspace, options)` 반환 객체 안에 `goal` 채움. `read-tools.ts:48-51` get_active_target 인라인 람다는 `buildReadEnvelope(parsed, { activeTarget, summary, goal: parsed.index.targetGoals[activeTarget] ?? null }, diagnostics)` 형태로 *top-level value.goal* 직접 추가. |
| 참고 패턴 | `src/core/query/summary.ts:38` `summarizeTarget` 본체. `src/core/types.ts:245` `TargetSummary` interface. `src/mcp/tools/read-tools.ts:48-51` get_active_target 인라인 람다 (실제 위치 — `src/core/query/lookup.ts` 또는 `src/core/active-target/` 디렉토리는 *부재*). |
| source_anchors | `["src/core/query/summary.ts:38", "src/core/types.ts:245", "src/mcp/tools/read-tools.ts:48-51"]` |
| 구현 가이드 | 1) `src/core/types.ts:245` `TargetSummary` interface 에 `goal: string \| null;` 필드 추가. 2) `src/core/query/summary.ts:38` `summarizeTarget(workspace, options)` 본체에서 **target 토큰 결정 fallback 규약**: explicit `options.target` 있으면 그 토큰 사용, 없으면 `workspace.index.activeTarget` fallback. 결정된 토큰 t 에 대해 결과 객체에 `goal: workspace.index.targetGoals[t] ?? null` 포함. **활성 타겟 자체가 빈 문자열이면 `goal: null`**. 3) `src/mcp/tools/read-tools.ts:48-51` 의 `get_active_target` 람다 — 현재 `buildReadEnvelope(parsed, { activeTarget: parsed.index.activeTarget, summary: summarizeTarget(parsed, { diagnostics }) }, diagnostics)` 를 수정해 *value 객체 top-level 에 `goal`* 추가: `{ activeTarget, summary, goal: parsed.index.targetGoals[parsed.index.activeTarget] ?? null }`. 4) 빈 문자열을 null 로 정규화하지 *않음* — parser 가 빈 값을 키 미생성으로 처리하므로 read 는 lookup 결과 그대로. 5) **불변식**: `result.value.goal === result.value.summary.goal` (top-level 과 summary 내부 양쪽이 같은 active target 토큰을 기준으로 lookup 하므로 정합). |
| Rationale | AC-6 verbatim: `get_active_target.value.goal exposes the active target's goal` → `value.goal` *최상위* 가 spec 의 정합 위치. `value.summary.goal` 에 두면 spec 경로 위반 — Opus HIGH-2 해소. **summarizeTarget 의 fallback semantic 명시** (active target) 으로 Opus 라운드2 MEDIUM-summarize 해소. AC-5 의 *absence yields null* 정합 보장. |
| 함정 / 주의사항 | `summarizeTarget` 호출자가 `goal` 필드를 *사용* 하지 않아도 무방 — required 필드로 두되 항상 채워 반환. `summary.goal` 과 `value.goal` 이 동일 값을 가지지만 spec 의 read 경로 정합을 위해 *둘 다 노출* (호환성). read-tools.ts:48-51 의 정확한 라인은 grep 으로 사전 검증 — `server.registerTool("get_active_target", ...)` 진입. |
| 테스트 작성 지침 | TASK-P4-006 의 e2e 가 cover. 본 task 는 typecheck + lint. |
| 검증 명령어 | `npm run typecheck && npm run lint` |
| acceptance_tests | `[{"shell":"bash","cmd":"npm run typecheck","expected_exit":0},{"shell":"pwsh","cmd":"npm run typecheck","expected_exit":0},{"shell":"bash","cmd":"npm run lint","expected_exit":0},{"shell":"pwsh","cmd":"npm run lint","expected_exit":0}]` |
| DoD | typecheck + lint 0 errors. `TargetSummary.goal` 노출. `get_active_target.value.goal` top-level 노출. |
| rollback | `{"strategy":"git-reset","command":"git checkout -- src/core/types.ts src/core/query/summary.ts src/mcp/tools/read-tools.ts"}` |
| 예상 소요 | 1시간 |

#### TASK-P4-006 — read parity e2e (write → readback)

| 필드 | 값 |
|---|---|
| 제목 | set_target_goal write 후 summarize_target / get_active_target 두 응답 모두에서 goal 노출 검증 |
| 관련 REQ-ID | FR-MCP-019 (AC-5, AC-6, AC-7, AC-8) |
| 파일 경로 | 신규: `test/integration/set-target-goal-e2e.test.ts` |
| 메서드/함수 시그니처 | 변경 없음. |
| 참고 패턴 | `test/integration/update-stability-e2e.test.ts` (v2.2.1 patch 의 e2e 패턴). |
| source_anchors | `["test/integration/update-stability-e2e.test.ts:1-50"]` |
| 구현 가이드 | 케이스 5 (성공·실패·경계). **fixture: `valid-basic`** (Active Target=v1.0.0 — fixture 00.index.md:8 + Target Map L26 v1.0.0 단행 확인됨). 모든 케이스의 target 토큰은 fixture 에 등록된 `v1.0.0` 사용. (1) `set_target_goal("v1.0.0", "Establish parser baseline.")` 후 `summarize_target({target:"v1.0.0"}).value.goal === "Establish parser baseline."` (성공). (2) 동일 후 `get_active_target()` 호출 → **`result.value.goal === "Establish parser baseline."` (top-level)** AND `result.value.summary.goal === "Establish parser baseline."` (summary 내부 — 둘 다 노출) 모두 assert. spec AC-6 의 `value.goal` 경로 *명시 검증*. (3) AC-5 absent: `mutation-target` fixture (Target Map 의 다른 target 에 goal 미설정) 에서 `summarize_target.value.goal === null` AND `result.value.goal === null` (성공·null 분기). (4) AC-7 격리 (경계): valid-basic 에서 set_target_goal 호출 전후 `summarize_target.countsByStatus` 와 `countsByStability` byte 동일. (5) **실패 분기**: goal 갱신 직후 다른 mutation (`update_status` on 임의 REQ) 가 동일 file 에 가해진 후 `set_target_goal` 재호출 → STALE_PATCH 반환 (SHA snapshot 가드 동작 검증 — permissive 분기 금지). |
| Rationale | write/read 대칭이 단일 테스트로 한눈에 확인 가능. AC 5건 중 4건이 본 e2e 에서 자동화. **fixture 미등록 target 토큰 사용 금지** — Opus R5-M2 해소: 모든 토큰을 valid-basic Target Map (v1.0.0) 또는 mutation-target Target Map 에 등록된 토큰으로 한정. |
| 함정 / 주의사항 | valid-basic fixture 의 Active Target=v1.0.0 (00.index.md:8) + Target Map v1.0.0 단행 (L26). P2-003 가 fixture 끝에 Goal block (v1.0.0/v1.1.0) 사전 추가 — 본 e2e 진행 시 *이미 존재* → 케이스 (1) 의 set_target_goal 은 *기존 goal replace* 가 됨 (written=true). 케이스 (3) 의 absence 검증은 별도 fixture (mutation-target) 또는 v1.1.0 등 P2-003 가 채우지 *않은* token 사용. |
| 테스트 작성 지침 | 위 5 케이스. |
| 검증 명령어 | `npx vitest run test/integration/set-target-goal-e2e.test.ts` |
| acceptance_tests | `[{"shell":"bash","cmd":"npx vitest run test/integration/set-target-goal-e2e.test.ts --no-file-parallelism","expected_exit":0,"stdout_regex":"5 passed"},{"shell":"pwsh","cmd":"npx vitest run test/integration/set-target-goal-e2e.test.ts --no-file-parallelism","expected_exit":0,"stdout_regex":"5 passed"}]` |
| DoD | 5 케이스 PASS. |
| rollback | `{"strategy":"file-delete","command":"rm test/integration/set-target-goal-e2e.test.ts"}` |
| 예상 소요 | 1.5시간 |

### 8.4 Phase 4 DoD
- 신규 set-target-goal core 11 + MCP 통합 4 + CLI 3 + e2e 5 = 총 23 케이스 PASS.
- mutation-kind-contract 가 등록 도구 11개 (기존 9 + append_section_note + set_target_goal) 를 반영.
- architectural test (set_target_goal not in read-tools.ts) PASS.

---

## 9. 스펙 매핑 표 (REQ-ID ↔ TASK-ID 100% 커버리지)

| REQ-ID | AC | TASK-ID | 비고 |
|---|---|---|---|
| FR-ARCH-005 | AC-1 | TASK-P1-001, TASK-P1-002 | 메타 시그니처 + 9개 도구 분류 |
| FR-ARCH-005 | AC-2 | TASK-P1-003 | zod schema 단계 거부 |
| FR-ARCH-005 | AC-3 | TASK-P1-002 | log-append 의 합법 배열 정의 |
| FR-ARCH-005 | AC-4 | TASK-P1-002 | workspace 분류 정의 |
| FR-ARCH-005 | AC-5 | TASK-P1-003 | mutation-kind-contract 테스트 (9 it) |
| FR-ARCH-005 | AC-6 | TASK-P1-003, TASK-P1-004 | SRS-MD-Rules §30.3 명시 동기화 — workspace 예시에 add_requirement 추가 |
| FR-PARSE-018 | AC-1 | TASK-P2-002 (00.index.md), TASK-P2-002b (90.appendix.md + merge) | heading 감지 *두 파일 모두* |
| FR-PARSE-018 | AC-2 | TASK-P2-002 | Goal 라벨 normalisation |
| FR-PARSE-018 | AC-3 | TASK-P2-001, TASK-P2-002, TASK-P2-002b | targetGoals 노출 (index + appendix merge) |
| FR-PARSE-018 | AC-4 | TASK-P2-002, TASK-P2-002b | 부재 시 diagnostic 없음 (SRS-W040 은 *충돌* 한정) |
| FR-PARSE-018 | AC-5 | TASK-P2-003 | 두 block fixture e2e (index + appendix) |
| FR-PARSE-018 | AC-6 | TASK-P4-001 | parser 가 아닌 mutation 에서 control char 거부 — Rationale 참조 |
| FR-MCP-018 | AC-1 | TASK-P3-002, TASK-P3-004, TASK-P3-005 | input schema |
| FR-MCP-018 | AC-2 | TASK-P3-001, TASK-P3-003 | allowlist + normalization |
| FR-MCP-018 | AC-3 | TASK-P3-001, TASK-P3-003 | deny-list + 변형 입력 흡수 |
| FR-MCP-018 | AC-4 | TASK-P3-002, TASK-P3-003 | reason validator |
| FR-MCP-018 | AC-5 | TASK-P3-002, TASK-P3-003 | **append + replace 두-호출 시퀀스 모두 구현 — 호출자 책임 + SHA snapshot 가드** |
| FR-MCP-018 | AC-6 | TASK-P3-002, TASK-P3-003 | 섹션 부재 자동 신설 + canonical order |
| FR-MCP-018 | AC-7 | TASK-P3-003 | 자동 테스트 a/b/c |
| FR-MCP-018 | AC-8 | TASK-P3-004 | mutation-tools 등록 + kind=req-scoped |
| FR-MCP-019 | AC-1 | TASK-P4-001, TASK-P4-003, TASK-P4-004 | input schema |
| FR-MCP-019 | AC-2 | TASK-P4-001, TASK-P4-002 | length / control char + UTF-16 boundary |
| FR-MCP-019 | AC-3 | TASK-P4-001, TASK-P4-002 | Target Map lookup |
| FR-MCP-019 | AC-4 | TASK-P4-003 | mutation-tools 등록 + kind=workspace |
| FR-MCP-019 | AC-5 | TASK-P4-005, TASK-P4-006 | summarize_target.value.goal |
| FR-MCP-019 | AC-6 | TASK-P4-005, TASK-P4-006 | **get_active_target.value.goal — top-level 노출** |
| FR-MCP-019 | AC-7 | TASK-P4-002, TASK-P4-006 | Requirement Block 격리 |
| FR-MCP-019 | AC-8 | TASK-P4-003 | read-tools.ts 미등록 architectural test |

총 28 AC (FR-ARCH-005 6 + FR-PARSE-018 6 + FR-MCP-018 8 + FR-MCP-019 8) 100% TASK 커버. 누락 0. **FR-MCP-018 AC-5 의 두 절 (append + replace) 모두 v2.2.2 범위 내 완전 구현** (Opus 평가자 HIGH-3 해소: optimistic concurrency 단일 호출 + SHA snapshot 가드).

---

## 10. 리스크 및 완화

| 리스크 | 영향 | 완화 |
|---|---|---|
| `McpServerHandle.registerTool` 시그니처 확장이 외부 사용자(이 패키지를 라이브러리로 사용하는 third-party)에 영향 | breaking change | 3번째 인자를 *optional* 유지하고 mutation-tools 진입 시 런타임 assert. read-tools 호출은 미수정. |
| `### Target:` 헤딩 패턴이 향후 다른 SRS 의 자연 표제와 충돌 | parser 오해 | 정규식 `^### Target:\s+\S+\s*$` 정확 매칭 + 토큰에 `/`·`\` 거부. |
| reason validator 재선언으로 인한 코드 중복 | 유지보수 부담 | JSDoc 으로 동기화 의무 명시. 추후 v2.3 에서 공통 모듈 추출 검토 (out of scope). |
| `append_section_note` replace mode 의 *first call dryRun=true* 요구가 stateless 서버에서 강제 불가 | spec 부분 충족 위험 | **option (b) optimistic concurrency 채택** — first call dryRun=true 는 *권장* (preview), commit 은 dryRun=false 단일 호출로 SHA snapshot 가드 위에서 처리. 두 호출 사이 다른 mutation 발생 시 STALE_PATCH 자동 반환 → AC-5 의 *idempotency guard* 절을 SHA 가드가 충족. TASK-P3-003 testcase (g)(h)(i) 로 preview·commit·race 3 분기 자동 검증. |
| fixture `valid-basic` 의 Goal block 추가 / 신규 appendix 파일 생성이 기존 통합 테스트의 assertion 깨뜨림 | 회귀 | fixture 끝부분 append + appendix 신규 생성 시 기존 `files.length` assertion 사전 grep 점검 (P2-003 의 DoD). |
| `set_target_goal` 가 read-tools.ts 에 실수 등록 (annotation 오분류) | governance 위반 | TASK-P4-003 의 architectural test 가 정적 차단 (read-tools.ts 파일 텍스트 grep). |
| **(신규) `get_active_target.value.goal` 가 `value.summary.goal` 위치로 잘못 노출** | spec 경로 위반, 호출자 코드 silent break | TASK-P4-005 가 read-tools.ts:48-51 인라인 람다를 *직접 수정* 하여 `value` top-level 에 `goal` 채워 넣음. TASK-P4-006 e2e 케이스 (2) 가 `result.value.goal` AND `result.value.summary.goal` 두 경로 모두 assert. |
| **(신규) `TargetSummary` interface 에 `goal: string \| null` required 필드 추가가 외부 SDK 사용자에게 shape change** | backward-incompat | required 로 두되 *항상 값 (null 포함) 으로 채워 반환* — 호출자가 missing key 분기를 추가 작성할 필요 없음. CHANGELOG / 90.appendix.md migration note 항목으로 명시. |
| **(신규) `00.index.md` 동시 write contention** — `set_active_target` 과 `set_target_goal` 이 같은 파일 mutate | concurrent mutation race | SHA snapshot guard 가 두 번째 호출에서 stale SHA 감지 → STALE_PATCH 반환. TASK-P4-002 케이스 (10) 가 `Promise.allSettled` 두 호출 동시 발사 후 정확히 하나 성공 검증. |
| **(신규) Target Map row 가 제거된 뒤 `targetGoals` 에 orphan 엔트리 잔존** | 데이터 일관성 | parser 가 `### Target: <token>` 블록을 *Target Map 행 존재 여부와 무관하게* 수집 — 이는 의도된 lenient 정책. write 측 (`set_target_goal`) 은 AC-3 에 의해 Target Map row 가 *없으면* NOT_FOUND 반환. orphan 정리는 별도 도구 (out of scope, v2.3 후보). |
| **(신규) `add_requirement` 분류 governance 충돌** — SRS-MD-Rules §30.3 의 workspace 예시에 add_requirement 가 enumerate 되지 않음 | governance 불일치 | TASK-P1-004 가 §30.3 텍스트를 갱신하여 workspace 예시 enumeration 에 `add_requirement` 추가 + sub-note 사유 명시. |

---

## 11. 용어집

| 용어 | 정의 |
|---|---|
| mutation tool | SRS 파일을 *write* 하는 도구. CLI/MCP 양쪽 surface 에 등록되며 `src/core/mutation/` 의 코어 함수를 호출. |
| req-scoped | mutation tool 분류 중 하나. 단일 Requirement ID 를 대상으로 하는 도구. zod schema 의 `id` 가 `z.string()`. |
| log-append | 집계 테이블 (Completed Work Log 등) 에 행을 추가하는 도구. requirementIds 배열은 합법이나 REQ 상태/안정성 flip 금지. |
| workspace | workspace 메타 (Active Target, Target Goal 등) 를 갱신하는 도구. `id` 필드 없음. |
| Target Goal meta block | `### Target: <token>` 헤딩 아래 `**Goal:** <text>` 라벨로 표현되는 자유 텍스트 블록. parser 가 `targetGoals: Record<string, string>` 으로 노출. |
| AllowedSection | `append_section_note` 가 허용하는 섹션 키 — rationale / research / implementation_notes. |
| DenyListedSection | 명시적으로 거부되는 섹션 키 — verification_evidence / acceptance_criteria. 구조화 표가 있는 섹션을 자유 텍스트로 오염하는 self-justification 경로 차단. |
| reason validator | update-status.ts 의 `MAX_REASON_LENGTH=500` UTF-16 code units + `CONTROL_CHAR_RE` (CR/LF/TAB 제외 제어문자 거부) 정책. |
| atomic patch | `applyPatchPlan` 의 SHA256 snapshot 기반 tmp+rename 원자 쓰기. 모든 mutation 의 공통 백엔드. |
| architectural test | 소스 파일을 *정적으로* 읽어 등록 규칙·import 경계를 자동 검증하는 단위 테스트. (예: `read-tools.ts` 에 `set_target_goal` 문자열이 없음.) |

---

## 12. 메타

- mode: planner (auto, --max 의도) — **scope_freeze=true 승격** (라운드 8·9 연속 finding 0)
- 평가자 라운드 수: **9 라운드** (Opus 의미·아키텍처 축 + Sonnet 파싱·가독성 축 병렬)
- 라운드별 finding 추이:
  - R1: Opus 11 (CRIT 1·HIGH 3·MED 5·LOW 2) + Sonnet 4 (HIGH 3·MED 1)
  - R2: Opus 7 (HIGH 2 carry-over·MED 4·LOW 1) + Sonnet 2 (HIGH 1·MED 1)
  - R3: Opus 5 (HIGH 2·MED 3) + Sonnet 1 (HIGH 1)
  - R4: Opus 2 (HIGH 1·MED 1) + Sonnet PASS
  - R5: Opus 3 (MED 2·LOW 1) + Sonnet PASS
  - R6: 양쪽 PASS (1차 연속)
  - R7: Opus 1 (LOW) + Sonnet PASS
  - R8: 양쪽 PASS
  - R9: 양쪽 PASS (2차 연속 — 종료)
- 잔존 findings: **0**
- 동적 시니어 소환 이력: 사전 brainstorm 3-agent 회의 (아키텍처·거버넌스·UX) 완료 후 plan 작성은 단일 메인 진행
- Dew File: `.snoworca/dew/planner/v2.2.2-mutation-governance/` (미생성 — 인라인 진행)
- snoworca-coder 라우팅 힌트: Phase 의존성 P1 → P2 병렬, P3·P4 는 P1 후. P4 는 P2 의 parser 도 의존. commit 단위는 Phase 별 분리 권장.
