# SpecKiwi 스펙 관리 효과성 분석

| 항목 | 값 |
|---|---|
| 문서 유형 | analysis |
| 주제 | SpecKiwi SRS/spec 관리 효과성 |
| 작성일 | 2026-05-10 |
| 검토 방식 | 5개 서브에이전트 병렬 검토 및 메인 세션 취합 |
| 저장소 상태 | Active Target/Completed Work 변경사항을 포함한 현재 작업 트리 |
| 종합 판단 | 조건부로 효과적 |

## 1. 종합 판단

SpecKiwi는 Git에 저장되는 Markdown SRS를 요구사항의 원본으로 받아들이는 disciplined small-to-medium 규모의 엔지니어링 프로젝트에서는 이미 스펙을 효과적으로 관리할 수 있다. 현재 구조의 중심은 올바르다. `docs/spec/`가 source of truth이고, parser가 요구사항 record를 정규화하며, CLI와 MCP가 같은 core service를 공유하고, agent-facing instruction이 SRS workflow를 명시한다.

하지만 SpecKiwi를 고신뢰 릴리스 승인 도구나 규제형 요구사항 관리 게이트로 보기에는 아직 부족하다. 현재 시스템은 다음처럼 보는 것이 정확하다.

> 실용적인 Git-native SRS workflow 도구이며 CLI/MCP 자동화는 유용하지만, 아직 완전한 strict consistency engine은 아니다.

### 핵심 결론

| 질문 | 판단 |
|---|---|
| 일상적인 SRS/spec 관리가 가능한가? | 가능하다. 단, 팀이 제한형 Markdown workflow를 지켜야 한다. |
| 코딩 에이전트가 현재 작업과 완료 작업을 파악할 수 있는가? | 대부분 가능하다. Active Target, requirement status query, summary, Completed Work Log가 연결되어 있다. |
| 잘못되거나 오래된 spec을 강하게 막을 수 있는가? | 부분적으로 가능하다. 기본 validation은 있지만 parser/rule coverage에 중요한 빈틈이 있다. |
| 릴리스 승인 게이트로 신뢰할 수 있는가? | 아직 어렵다. evidence와 traceability 검사가 너무 얕다. |
| 종합 준비도 | B- / Conditional. 지금도 유용하지만 strict governance 전에는 hardening이 필요하다. |

## 2. 서브에이전트 검토 범위

5개 독립 관점으로 검토했다.

| 검토 역할 | 판단 요약 |
|---|---|
| Architecture/Data Model | 모델은 단순하고 일관되며 사용 가능하다. 다만 mutation 동시성, table escaping, scope/index validation, summary drift가 약하다. |
| CLI/MCP Workflow | CLI와 MCP는 필요한 workflow 표면을 제공한다. 다만 payload 일관성, init 배포 동작, completed-work 검증, resource shape는 보강이 필요하다. |
| Parser/Validator Correctness | 잘 작성된 제한형 Markdown에서는 동작하지만, SRS가 문서화된 규칙을 모두 만족한다고 증명하기에는 부족하다. |
| Agent Guidance/Operations | agent workflow는 잘 설명되어 있다. 다만 현재 repo에는 canonical `AGENTS.md`/`CLAUDE.md`가 없고 `agents.md`만 있어 자동 discoverability가 약하다. |
| Test/Release Maturity | 젊은 도구치고 test breadth는 좋다. 그러나 release acceptance와 evidence traceability는 strong governance 기준에는 얕다. |

## 3. 잘 되어 있는 점

### 3.1 명확한 Canonical Source

이 저장소에서 요구사항 원본을 `docs/spec/` 아래 Markdown SRS 문서로 삼은 방향은 맞다. README는 SpecKiwi가 local-first이고 Git-tracked Markdown SRS 문서를 요구사항 source로 사용한다고 설명한다(`README.md:3`, `README.md:8`). rule 문서도 Markdown source-of-truth 원칙을 정의한다(`docs/rule/SRS-MD-Rules-v1.0.0.md:42`).

이 방식은 review, diff, branch, history workflow를 Git 안에 그대로 유지할 수 있다는 점에서 강하다.

### 3.2 일관된 Core Model

core type은 index, target, scope, completed work, requirement 개념을 비교적 잘 분리한다.

- `TargetEntry`, `ScopeEntry`, `CompletedWorkEntry`, `IndexDocument`: `src/core/types.ts:85-114`
- `RequirementRecord`: `src/core/types.ts:140-163`
- `ParsedWorkspace`: `src/core/types.ts:165-171`

이 모델은 외부 데이터베이스 없이도 사람과 agent가 이해하기에 충분히 단순하다.

### 3.3 CLI와 MCP의 Core 공유

CLI와 MCP가 같은 parser/query/mutation service를 호출한다. 이는 좋은 경계다. 사람이 CLI를 사용할 때와 agent가 MCP를 사용할 때 동작이 갈라지는 위험을 줄인다.

근거:

- CLI read command는 core parser/query를 사용한다: `src/cli/commands/read.ts:2-8`
- CLI mutation command는 core mutation service를 호출한다: `src/cli/commands/mutations.ts:3-10`
- MCP read tool은 같은 core query function을 사용한다: `src/mcp/tools/read-tools.ts:1-6`
- MCP mutation tool은 같은 core mutation function을 사용한다: `src/mcp/tools/mutation-tools.ts:1-9`

### 3.4 Active Target과 Completed Work의 연결

현재 index는 `Active Target`과 `Completed Work Log`를 기록한다(`docs/spec/00.index.md:9`, `docs/spec/00.index.md:85`). parser는 이 값을 노출한다(`src/core/parser/index-parser.ts:66-69`). CLI는 `active-target`과 `completed-work`를 제공한다(`src/cli/commands/read.ts:84-104`). MCP는 `get_active_target`과 `list_completed_work`를 제공한다(`src/mcp/tools/read-tools.ts:25-29`).

이 정도면 agent가 다음 질문에 답할 수 있다.

- 현재 active target은 무엇인가?
- 진행 중, blocked, implemented 상태의 요구사항은 무엇인가?
- 최근 완료된 작업은 무엇인가?
- implemented/verified 요구사항 중 evidence가 빠진 항목은 무엇인가?

### 3.5 Verified Guard 존재

프로젝트는 `implemented`와 `verified`를 구분한다. validator는 verified requirement에 checked acceptance criteria와 하나 이상의 evidence reference를 요구한다(`src/core/validator/rules.ts:25-30`, `src/core/validator/rules.ts:84-85`). mutation layer도 invalid verified requirement 생성을 막는다(`src/core/mutation/add-requirement.ts:35-40`, `src/core/mutation/add-requirement.ts:120`).

이는 SRS 관리 도구에서 매우 중요한 동작이다.

### 3.6 Init과 Agent Managed Block 방향성

`initProject`는 `docs/spec`, `docs/rule`, agent instruction file을 생성 또는 갱신한다(`src/core/bootstrap/init-project.ts:126-138`). managed block은 `# SpecKiwi SRS 워크플로 v1.1`로 versioning되어 있고 current-work status workflow를 포함한다(`src/core/bootstrap/templates.ts:14-16`, `src/core/bootstrap/templates.ts:175-206`).

managed block은 agent가 구현 전에 index를 읽고, Requirement ID를 찾고, 해당 requirement가 없으면 구현을 멈추도록 요구한다(`agents.md:13-17`).

## 4. 주요 약점

### 4.1 현재 repo에 Canonical Agent 파일이 없음

init 정책과 README는 `AGENTS.md`와 `CLAUDE.md`를 표준으로 설명하고, init도 그 이름으로 파일을 생성한다(`src/core/bootstrap/init-project.ts:16-18`). 하지만 현재 repo root에는 lowercase `agents.md`만 있고 `AGENTS.md`나 `CLAUDE.md`가 없다.

근거:

- 현재 root listing에는 `agents.md`만 있고 `AGENTS.md`, `CLAUDE.md`는 없다.
- README는 init이 `AGENTS.md`와 `CLAUDE.md`를 생성/갱신한다고 말한다(`README.md:40-54`).
- 현재 managed block은 `agents.md:9-36`에만 있다.

영향: 많은 coding agent는 대소문자를 구분해 `AGENTS.md`를 찾는다. lowercase `agents.md`를 자동 로드하지 않는 환경에서는 이 저장소의 SRS workflow가 자동으로 강제되지 않는다.

### 4.2 Parser가 Line-Based이고 Code Fence를 인식하지 않음

requirement scanner는 `### `로 시작하는 모든 줄을 검사하고, `In Scope`/`Out of Scope`를 제외한 malformed heading을 requirement error로 처리한다(`src/core/parser/block-scanner.ts:23-34`). requirement block은 다음 requirement heading 또는 파일 끝에서 종료된다(`src/core/parser/block-scanner.ts:36-40`).

리스크:

- fenced code block 안의 `###`가 heading으로 오인될 수 있다.
- 마지막 requirement의 markdown에 문서 후속 section이 섞일 수 있다.
- heading 내부 link, emoji, emphasis 금지 같은 문서화된 restriction이 명시적으로 검증되지 않는다.
- 중복 requirement sub-section은 diagnostic 없이 overwrite될 수 있다.

이는 팀이 제한형 Markdown을 잘 지킬 때는 괜찮지만, strong correctness gate로는 부족하다.

### 4.3 Diagnostic 문서와 구현이 일치하지 않음

rule 문서는 diagnostic code 의미를 표로 정의한다(`docs/rule/SRS-MD-Rules-v1.0.0.md:1439-1466`). 하지만 구현은 일부 code를 다르게 사용한다. 예를 들어 scanner는 malformed requirement heading에 `SRS-E001`을 emit한다(`src/core/parser/block-scanner.ts:31-32`). 반면 rule 문서의 초기 error code mapping은 이와 맞지 않는다.

영향: 사람, agent, test가 validation output을 잘못 해석할 수 있다. 이는 validation gate에 대한 신뢰를 낮춘다.

### 4.4 Table Safety가 불완전함

Completed Work Log는 write 전에 pipe 문자를 거부한다(`src/core/mutation/add-completed-work.ts:121-123`). 그러나 다른 table-writing path는 사용자 입력을 그대로 table row에 넣는다.

- requirement metadata/evidence/trace rendering: `src/core/mutation/render-requirement.ts:50-61`
- evidence row mutation: `src/core/mutation/add-evidence.ts:20-24`

table parser는 단순히 `split("|")`로 cell을 나눈다(`src/core/parser/table.ts:16-18`). 따라서 unescaped pipe나 malformed table cell이 parsed structure를 깨뜨릴 수 있다.

### 4.5 Index Consistency 검증이 약함

index는 Status Summary와 Requirement Type Summary 같은 rollup을 포함한다(`docs/spec/00.index.md:61-82`). 하지만 index parser는 metadata, target, scope, completed work만 정규화한다(`src/core/parser/index-parser.ts:39-69`).

약하거나 없는 검증:

- duplicate target
- duplicate scope prefix
- scope document link 존재 여부
- Scope Map에 등록되지 않은 `.srs.md` 파일
- 실제 record와 Status Summary의 drift
- 실제 record와 Requirement Type Summary의 drift
- multiple active target row

따라서 index는 navigation document로는 유용하지만, 아직 완전히 검증되는 control plane은 아니다.

### 4.6 Completed Work Log는 유용하지만 강제력이 약함

Completed Work Log parser/query는 존재하고 동작한다(`src/core/parser/index-parser.ts:22-37`, `src/core/query/completed-work.ts:32-35`). validator는 completed-work reference 불일치를 warning으로 보고한다(`src/core/validator/rules.ts:110-130`).

리스크:

- `addCompletedWork`는 write 전에 target/scope/requirement ID를 검증하지 않는다(`src/core/mutation/add-completed-work.ts:111-133`).
- unknown target/scope/requirement reference는 mutation blocker가 아니라 warning이다.
- `limit`은 matching row의 처음 N개를 반환하므로 반드시 최신 N개가 아니다(`src/core/query/completed-work.ts:32-35`).

Completed Work Log가 summary로만 유지된다면 허용 가능하지만, completion source-of-truth로 취급하면 안 된다.

### 4.7 Release Acceptance가 너무 얕음

release readiness는 validation error와 target status를 확인한다(`src/core/workflow/release-readiness.ts:36-52`). 하지만 traceability acceptance는 작은 hard-coded coverage example만 검증한다(`test/release/srs-traceability.test.ts:5-8`).

부족한 release-grade 검사:

- 모든 verified requirement의 evidence reference가 실제 존재하는지
- 모든 AC가 evidence `Covers`로 커버되는지
- evidence reference가 test, doc, PR, command 등 검증 가능한 대상과 연결되는지
- active target을 기본으로 쓰거나 명시적으로 요구하는지
- warning을 policy에 따라 실패로 승격할 수 있는지
- CI가 실제로 모든 gate를 실행하는지

서브에이전트들은 이 지점이 "유용한 workflow tool"과 "release approval tool"의 가장 큰 차이라고 판단했다.

### 4.8 배포 환경의 Rules Loading이 취약함

`loadBundledRulesDocument`는 `path.resolve(...)`로 `docs/rule/SRS-MD-Rules-v1.0.0.md`를 읽는다(`src/core/bootstrap/templates.ts:160-164`). 설치된 package를 다른 repository에서 사용할 때 이 경로는 package 내부가 아니라 호출자의 repository를 가리킬 수 있고, 그 결과 full rules 문서 대신 fallback stub rules가 생성될 수 있다.

`package.json`은 `docs/rule/SRS-MD-Rules-v1.0.0.md`를 package files에 포함한다(`package.json:36-40`). 따라서 의도한 artifact는 존재하지만, runtime lookup은 cwd-relative가 아니라 package-relative여야 한다.

### 4.9 Mutation 동시성 Guard가 없음

`add-requirement`는 현재 parsed records에서 다음 requirement ID를 계산한다(`src/core/mutation/add-requirement.ts:26-33`). 이후 patch를 작성한다(`src/core/mutation/add-requirement.ts:122-156`). patch layer에는 atomic file replacement가 있지만, ID 선택 후 optimistic re-parse/revalidate 단계는 없다.

동시에 두 mutation process가 실행되면 같은 next ID를 선택할 수 있다.

## 5. Risk Matrix

| 심각도 | 리스크 | 중요한 이유 | 우선순위 |
|---|---|---|---|
| Release governance 기준 Critical | Evidence와 traceability gate가 얕음 | verified requirement가 AC-level coverage나 evidence 실재성 없이 ready처럼 보일 수 있다. | P0 |
| Validator trust 기준 Critical | Diagnostic code 문서와 구현이 불일치 | 사용자와 agent가 validation result를 신뢰하기 어렵다. | P0 |
| High | Parser가 fenced-code aware가 아니고 block boundary가 느슨함 | 정상 문서에서 false positive가 나거나 잘못된 문서가 통과할 수 있다. | P0 |
| High | 현재 repo에 canonical `AGENTS.md`/`CLAUDE.md` 부재 | agent workflow가 자동 로드되지 않아 SRS 강제력이 약해진다. | P0 |
| High | Table cell safety가 불완전함 | 사용자 입력이 Markdown table과 parsed record를 깨뜨릴 수 있다. | P0 |
| High | Init rules loading이 cwd-relative임 | 설치된 CLI가 full bundled rules 대신 stub rule doc을 만들 수 있다. | P0 |
| High | Scope/index consistency 검증이 약함 | 미등록 문서, 중복 prefix, stale map이 조용히 누적될 수 있다. | P1 |
| Medium | Completed Work Log mutation이 reference를 사전 검증하지 않음 | summary row가 unknown 또는 incomplete work를 가리킬 수 있다. | P1 |
| Medium | MCP resource payload shape가 일관되지 않음 | agent가 resource별로 다른 handling을 해야 하고 응답을 오해할 수 있다. | P1 |
| Medium | Status/type rollup이 drift될 수 있음 | index summary가 실제 requirement record와 모순될 수 있다. | P1 |
| Medium | `completed-work --limit`이 "latest N" 의미가 아님 | current-work summary가 최근 row를 놓칠 수 있다. | P1 |
| Medium | CI가 실제 workflow가 아니라 문서 예시 수준임 | 회귀 방지가 로컬 discipline에 의존한다. | P1 |
| Low | Read command가 diagnostics를 기본 노출하지 않음 | agent가 invalid workspace에서 추론된 record를 그대로 소비할 수 있다. | P2 |

## 6. 권장 로드맵

### P0: 현재 Workflow를 신뢰 가능하게 만들기

1. 이 repo에 canonical `AGENTS.md`와 `CLAUDE.md`를 추가하거나, lowercase `agents.md`를 명확히 non-canonical 보조 문서로 격하시킨다.
2. diagnostic registry를 single source of truth로 만들고 docs/tests/implementation을 동기화한다.
3. parser가 fenced code block을 인식하게 하고, requirement block을 다음 requirement heading 또는 관련 top-level section boundary에서 종료하게 한다.
4. 중복 requirement sub-section과 SRS-MD rule에서 금지한 heading content를 검출한다.
5. Markdown table을 작성하는 모든 mutation path에 shared table-cell safety policy를 적용한다.
6. bundled rules를 caller cwd가 아니라 package location에서 읽게 한다.
7. 얕은 traceability acceptance test를 실제 `docs/spec` 전체 parsing 기반의 verified-requirement evidence 검사로 교체한다.

### P1: Consistency와 Agent Reliability 강화

1. duplicate target, duplicate scope prefix, multiple active target row, missing scope document file, unregistered scope file을 검증한다.
2. Status Summary와 Requirement Type Summary를 실제 parsed records와 비교하거나, manually maintained source에서 제외한다.
3. `addCompletedWork`가 write 전에 target/scope/requirement ID와 completed status를 검증하게 한다. 의도적 예외가 필요하다면 명시적 override를 둔다.
4. MCP resource payload shape를 전체적으로 통일한다.
5. `completed-work --limit`이 최신 row를 반환하게 하거나, file order 기준임을 문서화한다.
6. GitHub Actions로 build, typecheck, lint, test, release check, package smoke test를 실행한다.
7. `release-check`는 `SPECKIWI_TARGET`이 명시되지 않으면 Active Target을 기본으로 사용하게 한다.

### P2: 장기 성숙도 개선

1. ID를 생성하는 mutation에 optimistic concurrency check를 추가한다.
2. CLI/MCP read response에 diagnostics summary를 선택적으로 포함한다.
3. malformed table, escaped pipe, code fence heading, duplicate section, stale evidence, broken local evidence path, CRLF, multiple scopes fixture를 추가한다.
4. parser, validator, mutation, CLI, MCP layer에 coverage threshold를 둔다.
5. line-based parsing이 correctness 한계가 되기 시작하면 AST-backed Markdown parser 도입을 검토한다.

## 7. 실무 운영 가이드

P0/P1 개선이 끝나기 전까지는 다음 원칙으로 SpecKiwi를 운영하는 것이 좋다.

1. Requirement Block, Acceptance Criteria, Verification Evidence, Change Notes를 source of truth로 취급한다.
2. Completed Work Log는 summary로만 취급한다.
3. SRS 변경을 수락하기 전에 `speckiwi validate --fail-on-warning`을 실행한다.
4. release decision 전에는 `npm run typecheck`, `npm run lint`, `npm test`, `npm run release:acceptance`를 실행한다.
5. 모든 구현 요약에는 Requirement ID를 포함하게 한다.
6. 모든 verified requirement를 검사하기 전까지는 `release:acceptance`만으로 traceability가 증명됐다고 보지 않는다.

## 8. 최종 평가

SpecKiwi는 이미 유용하고 일관된 SRS 관리 프로젝트다. day-to-day spec management에 필요한 핵심 요소는 갖추고 있다.

- Markdown source of truth
- normalized requirement records
- active target tracking
- completed work summary
- CLI와 MCP 접근
- line-based patch mutation
- verified state separation
- agent workflow instruction

남은 과제는 방향 전환이 아니다. 방향은 맞다. 필요한 작업은 hardening이다. parser correctness, diagnostics alignment, table safety, evidence traceability, CI, canonical agent discoverability를 강화해야 한다.

따라서 최종 판단은 다음과 같다.

> SpecKiwi는 disciplined local development의 스펙 관리를 오늘부터 효과적으로 수행할 수 있다. 다만 P0 hardening이 끝나기 전까지는 strict release/governance gate로 사용해서는 안 된다.
