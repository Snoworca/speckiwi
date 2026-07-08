# CLI-SSOT 도구확장 (P0/P1) 구현 인계 (2026-06-08)

> **목적**: "MCP 를 CLI 에 맞춰 자동생성"(CLI=정본) 아키텍처 + 누락 명령어/검증툴 대확장의 **구현(TDD)** 을 새 세션이 이어받기 위한 지시서. 설계·등록·§5 검증은 **완료**. 남은 것은 구현뿐.

---

## 0. 현황 — 설계·등록·검증 완료, 구현 대기

- 3인 위원회(만장일치 cli-ssot-mcp-autogen) → 5축 심층 갭분석+위원회 → **신규 25 REQ 등록** → §5 3축 등록검증(**minor_fixes**, 블로킹 0) 완료.
- target = **v3.0.0**(active 확장, 사용자 직접결정). 전부 `planned` / `stability=evolving`. `validate` clean(errors 0/warnings 0). v3.0.0 = 85 total(81 planned + 4 implemented).
- **남은 것: 29 REQ 구현**(신규 25 + 기존 implement 4). P0+P1 만(P2/P3=delete/diff/deps/CRUD 제외, search 만 P1 포함).

---

## 1. 권위 문서 (SSOT)
| 문서 | 역할 |
|---|---|
| doculight "위원회 보고"(앞 세션) + 합성안 | 아키텍처 결정 |
| `docs/analysis/2026-06-08-p0p1-reqs.json` | 등록된 25 REQ 원본(statement/AC/depends_on/guard) + implement_existing + registration_order |
| `docs/analysis/2026-06-08-p0p1-id-map.json` | title → REQ-ID 맵 |
| `docs/spec/{10,20,30,40,50}.*.srs.md` | 등록된 REQ 본문 SSOT(speckiwi 관리) |

---

## 2. 결정 (사용자 확정 + §5 must-fix 해소)
- **아키텍처**: ToolSpec 메타 레지스트리(SSOT) 1선언 → CLI/MCP/zod/toolNames/toolKinds 4-렌더러. FR-ARCH-005(verified, kind 분류) 위에 additive. **drift=0 enumerate + handler-forwarding** 테스트로 FR-MCP-020/029 류 silently-drop 영구 차단.
- **위험도구 전면허용**: update-field 가 type/scope 도 편집(단 `generateNextRequirementId` 재생성=마이그레이션 + dry-run + 사인오프 + inbound trace rewrite). retarget 은 verified 포함(--exclude opt-out). 물리 delete 는 P2(미포함).
- **거버넌스 불변**: bulk-finalize 금지는 **schema-level 구조배제** — retarget/update-field 입력 타입에 status·active-target 필드 부재(런타임검증 아닌 타입 부재). ID 수동변경 금지(type/scope 편집은 재생성=마이그레이션).
- **§5 must-fix 해소(Implementation Notes 에 기록됨)**:
  1. `IR-CLI-038` AC-5 의 frozen 진단은 **SRS-W009**(SRS-E028 아님 — 그건 Evidence missing). §16 rule 5.
  2. retarget kind = **신규 4번째 kind `target-scoped`**(id 배열 허용 + status/stability/active-target 구조배제). 기존 3 kind(req-scoped 배열금지/log-append flip금지/workspace id없음) 어디에도 안 맞음. **구현 시 SRS-MD-Rules §30.3 에 4번째 kind 문서화 + FR-ARCH-005 kind enum 확장 + REL-ARCH-002 toolKinds enumerate 가 retarget 을 target-scoped 로 검증**. (FR-ARCH-006/FR-NODE-047/FR-MCP-031 IN 에 기록.)

---

## 3. 구현 대상 (29 REQ) — 등록순서대로 TDD

> `speckiwi show <ID> --json` 또는 srs 블록으로 AC 확인 → red→green→typecheck→eslint→evidence→implemented. **각 REQ 의 Implementation Notes(§5 노트) 반드시 먼저 확인**.

### P0 (먼저)
1. **FR-ARCH-006** ToolSpec 메타 레지스트리 SSOT (4-렌더러). 25건 거의 전부의 depends_on 루트 — **최우선, feasibility 임계경로**. `src/mcp/{schemas.ts,server.ts,metadata.ts,adapter.ts}`, `src/cli/commands/*`, `src/core/mutation/*`. kind enum 에 `target-scoped` 추가.
2. **REL-PARSE-002** 진단 이중카운트 버그수정. **실제 seam = `readDiagnostics` 3경로**(`src/cli/commands/read.ts:25`, `src/mcp/resources.ts:23`, `src/mcp/tools/read-tools.ts:17`)가 `[...workspace.diagnostics, ...validateWorkspace(workspace).diagnostics]` 로 중복합산(validateWorkspace 가 이미 workspace.diagnostics 포함). **TDD red 먼저**(빈 SRS 에서 SRS-E013/E014 정확히 1건). 단일 seam 수정.
3. **DR-PARSE-001** `DiagnosticDefinition`(types.ts:66)에 `remediation`(+optional docsAnchor) 추가 + 런타임 `Diagnostic`(types.ts:100)에 title/sourceRule registry-join 노출. remediation 61코드 전수 채움(AC-2). docsAnchor 는 YAGNI(미채움, IN 참조).
4. **REL-ARCH-002** zero-drift enumerate + handler-forwarding 테스트. **실제 드리프트**: `schemas.ts` toolNames(14)에 `update_stability/append_section_note/set_target_goal` 누락(server.ts toolSchemas 는 16). red-first.
5. **IR-CLI-033** validate 그룹화 human 렌더러(`file:line code severity message (rule)`, 파일/코드 그룹화, 헤더). 현재 `src/core/display/text.ts` 가 JSON.stringify fallback. **IR-CLI-034**(--severity/--only/--ignore + exit 계약), **IR-CLI-035**(explain<code> + validate --explain), **IR-CLI-036**(release-readiness/coverage/rtm 노출 — `src/core/workflow/release-readiness.ts` core 완성, import 0건, verified-gate 배너).

### P1
6. **NODE core**: FR-NODE-046(full-text search, 신규 query 모듈 — trace-search 는 검색기 아님), FR-NODE-047(retarget, per-item dry-run, target-scoped kind), FR-NODE-048(update-field, type/scope ID 재생성), FR-NODE-049(add-related-doc/add-change-note).
7. **기존 planned 구현**: FR-NODE-019(discard EXIT 하드닝 — update-status.ts 는 현재 verified-MARK 만 가드), FR-NODE-025(update_requirement_statement, 신규 Requirement range helper), FR-NODE-026(edit_acceptance_criteria), FR-MCP-023(statement/edit-ac MCP 등록).
8. **CLI 표면**: IR-CLI-037(search), 038(retarget), 039(update-field), 040(update-statement), 041(edit-ac), 042(add-related-doc/add-change-note), 043(--input-json/stdin + --help --json).
9. **MCP 표면**(SSOT 파생): FR-MCP-031(retarget_requirements), 032(update_requirement_field), 033(add_related_doc/add_change_note), 034(search_requirements), 035(summarize_release_readiness), 036(explain_diagnostic).

### §5 검증 후 verified 전이
REQ별 적대적 §5(코드↔AC, 비공허 테스트, SSOT byte-identical을 enumerate parity 로 박제, json envelope strict 소비자 breaking 점검) → gap 보강 → verified.

---

## 4. 핵심 함정·근거 (§5 검증으로 확인)
- ToolSpec enumerate 테스트는 **registry 를 유일 권위**로(expected 도구목록 하드코딩 금지 — 그러면 4번째 drift 원천).
- json envelope 에 sourceRule/title/remediation 추가 시 **IR-CLI-021 strict 소비자(MCP/release-check.mjs/테스트)** breaking 점검 필수(grep 전수).
- byte-identical 비파괴는 **enumerate parity 테스트로 박제** 못하면 무효(옵션순서/JSON키순서 차이).
- add-requirement 는 00.index §5/§6 카운트 자동갱신 안 함 → 수동 Edit. (현재 §5 planned 85/§6 data DR 1 추가됨.)
- 기존 결함(범위 외): FR-FLOW-007↔008 depends_on cycle(verified, HEAD 기존, 별도 백로그).

## 5. 미커밋 / 정책
- 전부 미커밋. 커밋은 사용자 요청 시(시그니처 금지). 일회성 `docs/analysis/register-p0p1.mjs` 는 커밋 전 삭제 검토.
- TDD test-first 강제, §5 서브에이전트 검증, SRS 결정은 위원회.

## 6. 새 세션 첫 메시지 권장
> "CLI-SSOT 도구확장 구현 이어서. `docs/next/2026-06-08-cli-ssot-tooling-implementation-handoff.md` 읽고 P0 부터 TDD 로 쭉 진행해. FR-ARCH-006(ToolSpec SSOT) 또는 REL-PARSE-002(진단 dedup 버그수정)부터. 각 REQ 의 §5 Implementation Notes 먼저 확인."
