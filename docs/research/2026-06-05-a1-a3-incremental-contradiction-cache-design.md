# SpecKiwi v3.0.0 통합 설계 — A1 증분 모순 캐시 + A3 blast-radius + steps/deferred-merge + work modes/vibe trace

| Field | Value |
|---|---|
| Status | design draft (brainstorming 산출물, SRS REQ 등록 전) |
| Date | 2026-06-05 |
| 제안 Target | **v3.0.0 (major)** — A1 증분 모순 캐시 + A3 blast-radius + steps/deferred-merge 통합 |
| 근거 워크플로 | `wf_1b47d5b3-3cc`(P1, A1+A3 5측면) · `wf_c3600158-570`(P2, steps/merge 5측면) — 각 16 에이전트, 정밀화→adversarial 검증→종합 |
| 선행 분석 | 3-에이전트 구조 분석 (코어 아키텍처 / 거버넌스 / 워크플로 UX) |
| 검증 | P1 2-에이전트 교차검증 완료(critical/high 0). P2 검증 진행 |

> **구성**: Part 1 = A1+A3(증분 모순 캐시·검증 총량 감축). Part 2 = steps/deferred-merge(경량 캡처·배치 병합). Part 2 는 Part 1 **위에** 얹힌다.

---

## 0. 동기

기능 하나당 모순/의미 검증에 ~80% 시간(코딩 20%). 본질은 **모순 검증을 매 기능마다 전역 O(N²)로 재계산**. 두 겹 해법: **A1(검증 총량 감축)** + **steps(워크플로 마찰 감축)**. steps 는 "지연"이라 A1 없이는 총량을 못 줄이므로, A1 을 토대로 둔다.

불변식(전 Part 공통): Markdown-only(no YAML/DB), REQ-ID 거버넌스, mutation 은 도구로만, per-REQ evidence, **bulk-finalize 금지**.

---

# Part 1 — A1 증분 모순 캐시 + A3 blast-radius

## 1.1 데이터 모델 — 단일 row, 양방향 핀

`#### Trace Links` 표에 row 하나:
```
| Type | Reference | Relation | Notes |
|---|---|---|---|
| Requirement | FR-USER-012 | checked_compatible | fpv=1; self=FR-AUTH-005@9f86d081; peer=FR-USER-012@2c26b46b; checked-at=2026-06-05 |
```
- 무효화 키 = git SHA 아님, **content-hash(semanticSha)**. git 의존 0(false-dirty 제거).
- 단방향 정규화: `compareReqId`(raw byte)로 작은 REQ-ID 블록에만 1 row, `(min,max)` 쌍당 최대 1개. 대칭성은 self/peer 양방향 핀.
- `Reference`=bare live REQ-ID → SRS-E012/`addTraceLink` 가드 통과. `types.ts` 변경 0(relation free-string).

**semanticSha 공식** (fpv=1, test vector 동결):
```
sha1( "fpv1" | norm(requirement) | AC.text(checked 제외) | status | stability |
      metadata(DENY={Status,Stability}, Scope 포함) )
// norm = CRLF→LF, 행별 trailing-ws strip, 연속공백 1칸, 양끝 trim
// Trace Links/Evidence/Change Notes 제외(자기 해시 순환 차단)
// DENY={Status,Stability}: record.metadata 가 그 키를 raw 로 담아 독립항과 이중카운트 → 제외 (검증 I-5)
```

**Notes 토큰**(§23.x strict, `parseCompatibilityNotes`): 항목 `; `, 키 `[a-z-]+`, 값 `[A-Za-z0-9:.@_-]+`(`…` 금지). `fpv`·`self`·`peer`·`checked-at`. `table-cell.ts:4`는 `/[|\r\n]/`만 거부하므로 charset 검증은 tokenizer 책임.

## 1.2 무효화 — clean 화이트리스트 게이트 (false-clean 방지)

clean 유일 조건(전부 AND): row 정확히 1개 · self핀==현재 semanticSha · peer핀==현재 · 양끝 캐시-live(존재 & status≠discarded & stability≠deprecated) · Notes 파싱 · fpv 일치. **그 외 전부 dirty.** blacklist 금지.

**명시 dirty 트리거**: self/peer discarded·deprecated 전이; 신규/삭제 REQ → 폐쇄집합+인접쌍 dirty 시드, 누락 compat 은 W042.

**false-clean 4대 차단**: A. 자기참조 해시 차단(Trace Links 제외, `records.ts:142`) / B. 양방향 핀 / C. discard liveness(E012 status-blind `rules.ts:216`/`:111` → 캐시-live 별도) / D. dedup + 양방향 스캔(`findIncomingTraceRows` `trace-search.ts:33-58`).

**advisory 2겹**: semanticSha 가 Markdown 파생이라 fresh parse 시 자동 교정 + 보수적 dirty. **fresh parse 책임=read 핸들러**(`summarizeTarget`(`summary.ts:38-42`)은 workspace 를 인자로 받음, 자체 parse 안 함 — 검증 I-1).

## 1.3 A3 blast-radius
`touches_req[]`/`touches_scope[]` 선언 → transitive depends_on 폐쇄집합(2-hop + frozen/stable 절단)으로 검증 한정. LLM 은 dirty/누락만 확인.

## 1.4 도구·validator (Part 1)
- mutation(req-scoped): `add_compatibility_check`(dedup·frozen·liveness 가드·핀 자동계산), `refresh_compatibility_check`(`{aReqId,bReqId}`→min-side row locate→`replaceLine`, row 0=NOT_FOUND/2+=거부), `revoke_compatibility_check`(`replaceRange`).
- read: `list_dirty_edges`(핸들러 fresh parse→`summarizeTarget` 역색인, clean/dirty/orphaned/missing), `list_compat_edges`.
- util: `computeSemanticSha`·`compareReqId`·`parseCompatibilityNotes`·**`computeBlastRadius`(순수함수 export 계약)**.
- 갭 도구(고빈도, 1단계 확정): `update_requirement_statement`(`findSectionBodyRange`는 Requirement 못 받음→신규 range 헬퍼+GFM/펜스/AC 가드, 검증 I-2), `edit_acceptance_criteria`.
- validator: SRS-E012 messageTemplate `{relation}` + W041(stale)/W042(missing)/W043(conflict 은폐). `ValidationRule (workspace, ctx?)` 확장 + `validateWorkspaceScoped`.
- 선결: **`add_trace_link` notes 드롭 버그**(MCP 핸들러 `mutation-tools.ts:76` 이 `input.notes` 미전달; `server.ts:70` zod 스키마는 notes optional 이미 보유 — `schemas.ts` 무관; 코어 `add-trace.ts:44,60` 정상) 수정.

---

# Part 2 — steps + deferred-merge (A1 위 적층)

## 2.1 step 모델 — origin 격리 (난제1 해소)

디렉토리: `docs/spec/steps/{step-name}/*.srs.md`(본체 동일 scope 파일명, 건드리는 scope 만) + `docs/spec/steps/state.md`. **물리 archive/ 폴더 없음**(in-place discarded).

**격리 = discover/workspace-parser 층에서 files+records 동시 origin 분리** (핵심):
- discover 필터: body=`.srs.md && !/docs/rule/ && !/docs/spec/steps/`, step=`/docs/spec/steps/<name>/*.srs.md` → `SrsFileSet.stepFiles[]`.
- workspace-parser: body→`records` / step→`stepRecords` 분리 평탄화, `RequirementRecord.origin('body'|'step')`+`stepName` 주입. **step 파일은 `workspace.files`·`workspace.records` 양쪽에서 제외**.
- 효과(규칙 코드 무수정): `rules.ts:126` `discoveredScopeDocuments`(files 기반)에 step 없음 → **W018/E025 false-positive 0**. `rules.ts:164-169` `seen`(records 순회)이 body 만 → **E002 무발동**(step↔body 동일 ID=의도된 supersede-예정). `rules.ts:111` `ids`만 `[...records,...stepRecords]` 합집합 → E012 교차 trace 통과.
- `ParsedWorkspace` 에 `stepRecords`/`stepFiles`/`stateFile` 추가.

**state.md**: discover 가 appendix 패턴(`discover.ts:41-44` 동형 access→readUtf8File)으로 명시 로드. 컬럼=`Step|Status|DependsOn|TouchesScope|TouchesReq|Created|Updated`, Status enum=`active|merging|merged|abandoned`, metadata=`Step Warn Threshold=7`/`Stale Days=14`. `parseStepState`는 `table.ts parseMarkdownTable` 재사용. **TouchesReq 는 merge 시점 step 파일 내용에서 derive(컬럼은 hint, derived 가 authoritative)**.

**mutation 라우팅**(난제 회피 필수): `loadRecord`/`loadRecordWithWorkspace`에 `origin?`/`stepName?`(미지정=body 우선 호환). step mutation 은 MCP/CLI 진입점에서 명시 라우팅. 반환 records 는 body∪step 합집합 → `update-status.ts:117`/`update-stability.ts:69` `findIncomingTraceRows` successor 슬롯 회귀 차단. **이 라우팅 없이 records-split 머지 금지(즉시 본체 오염)**.

**step-local 검증**: `validateWorkspaceScoped(workspace, ctx{origin,stepName,touches})`. 진입점 CLI `speckiwi step validate <name>` + MCP `validate_step`. step 디렉토리 내부 중복은 SRS-W044 계열 warning.

## 2.2 merge 모델 — per-REQ 오케스트레이션 (난제2·3 해소)

**merge 는 단일 batch 도구가 절대 아니다.** `kiwi-spec-merge` 스킬이 **per-REQ 1-REQ req-scoped 호출을 순차 오케스트레이션**한다.

- **§30.3 bulk-finalize 준수** = 도구 kind 아닌 **per-call REQ-count=1 + 콜마다 자체 게이트**. `add_requirement`(`mutation-tools.ts:139` workspace-kind 이나 콜당 1 REQ + `canBeVerified` 게이트), `update_status`(req-scoped, verified 하드가드). **N-REQ batch finalize 도구·caller-선택 REQ-ID 입력 경로 신설 금지**.
- **4분류**(`diff_steps`, key=`computeSemanticSha`): NEW / UPDATE / CONFLICT-PARTIAL / CONFLICT-FULL-GUARDED. "나중 step 이 이긴다"(draft/evolving 동급).
  - **NEW**: `promote_step_requirement{id,fromStep,toScope}`(신규 req-scoped) — step 의 pre-minted canonical id 를 reservation view(HEAD∪step∪reserved) 전역 유일성 검증 후 verbatim insert. `add_requirement`는 id 자동생성(`add-requirement.ts:28-35`)이라 ID-stability 보장 불가 → 부적합.
  - **UPDATE**: 본체 id 블록에 `append_section_note`/`check_acceptance_criteria`/`update_status`. verified 전이는 하드가드 우회 불가.
  - **CONFLICT**: supersede(2.3) + verified 가드.
- **원자성 = crash-RECOVERY**(NTFS N-rename 비원자): `MultiFileCommit`(Option A, net-new merge 전용, '단일-REQ 가 step+본체 단일파일 동시 변경'). 4-phase(전부 render→stale-check→tmp→일괄 rename) + **durable merge-journal**(renames+sha256+backup) → 중단 시 다음 merge 가 half-applied 감지 roll-forward/back. `assertFreshSnapshot`(`apply-patch.ts:40`) export 승격 재사용. **명문화할 엣지케이스(REQ 분리)**: journal write 자체 원자성(tmp-rename), 재진입(roll-forward 중 재crash) 멱등성, 부분 stale 시 전부-or-전무 abort. **state.md 는 commit plan 미포함**(mutable↔atomic 순환의존 차단).
- **dry-run 게이트**: 지원(update_status/append_section_note/add_requirement) / 미지원(add_verification_evidence/add_trace_link/check_acceptance_criteria) → 선결(Stage 0)에서 dryRun 전달 보강, 그 전엔 evidence/trace 행 'preview unavailable' 명시.
- **A1 연동**: `diff_steps` 판정 key=`computeSemanticSha`, O(N²)→dirty 감축=`list_dirty_edges`, supersede 후 oldId 끝점 무효화=`revoke_compatibility_check`. **A1 src 0건 → hard dependency**(Stage 1e 선행). 미인도 시 cache-free per-pair LLM degraded.

## 2.3 archive/supersede 무결성 (난제4·6 해소)

- **archive = in-place discarded**(`update-status.ts:54-83` heading marker `[DISCARDED → see Y +N]`+strikethrough+블록보존, status='discarded'). **dangling 0**: E012(`rules.ts:215-221`)는 ids=합집합 referential-existence 만 → discarded REQ 가 records 잔존, incoming trace 계속 resolve. 물리 .srs.md 이동은 E002 폭발/trace broken → 배제.
- **successor SSOT = supersedes Trace row**(E012-checked). `'Superseded By'` metadata 제거(writer 부재 `render-requirement.ts:36-47` 고정 10필드, `findMetadataLine` 삽입 불가, A1 route-deny; 규칙 doc 은 'Superseded By'를 권장 metadata 로 정의하나 코드 writer 부재 = 문서/코드 비대칭) → 선택적 annotation 격하.
- **supersede strict 2-call**(비원자): T1 `add_requirement`(id 미지정, trace=supersedes→oldId)→반환 newId 캡처 → T2 hardened `updateStatus`(oldId, discarded). 순서 강제, 부분실패=저널 재개. 같은-파일도 successor marker 가 reparse 의존이라 본질 2-step. **멱등 재개**: `update-status.ts:122` Change Notes append 는 reason 동반 시 비멱등(중복 row) → 저널 재개는 reason 생략 또는 사전 Change-Note 존재 검사로 멱등 보장. 가드 3종: 자기참조·역방향 중복·N>1 모호.
- **verified 역행 가드 = updateStatus chokepoint**(난제6): `status→discarded` 시 `current==='verified' || stability∈{frozen,stable} || (implemented && evidence)` 면 MUTATION_DENIED, 명시 override(`reason`+`confirmDiscardVerified`) 시만. supersede 도구도 이 hardened updateStatus 호출. **기존 도구 behavior change → 독립 REQ-ID + TDD 선행**.
- **evidence 승계**: 승인된 supersede 는 (i) loser evidence 마이그레이션(winner 가 가드 재통과) 또는 (ii) 'reverification owed' Change Note + (iii) post-merge verification-decrease report. §2.7 을 OUTCOME 으로 보존.

## 2.4 write-skew (난제5 해소)
`claim_step` 이 TouchesScope/TouchesReq 선언 + **2단계 게이트**: (a) 동일 REQ 직접 교집합 = **HARD-BLOCK** `STEP_DIRECT_CONFLICT`(lost-update, force 불가), (b) transitive-only = **SOFT-BLOCK** `STEP_OVERLAP`(force 시 overlaps 핀). 폐쇄집합=`computeBlastRadius`(A1). 미인도 시 1-hop direct 만 hard-block, transitive advisory. verified/frozen supersede 대상 step 은 `STEP_SUPERSEDE_PROTECTED`(자동 승 박탈).

## 2.5 6개 난제 해법 요약

| 난제 | 해법 |
|---|---|
| 1. discover ID 중복 | files+records origin 분리(step 양쪽 제외), ids 만 합집합 → E002/W018/E025 무발동 |
| 2. 다파일 원자성 | crash-RECOVERY(MultiFileCommit 4-phase + durable merge-journal roll-forward/back) |
| 3. bulk-finalize | per-REQ 1-REQ 콜 순차 오케스트레이션, N-REQ batch 도구 금지 |
| 4. archive dangling | in-place discarded(물리이동 금지), E012 referential-existence 로 resolve |
| 5. write-skew | touches 교집합 2단계 게이트(직접=HARD, transitive=SOFT) |
| 6. verified 역행 | updateStatus EXIT 가드(verified/frozen/evidence→discarded MUTATION_DENIED) |

## 2.6 도구 셋 (Part 2)
| 도구 | 종류 | 역할 |
|---|---|---|
| `parseStepState` | util(read) | state.md 파싱(`table.ts` 재사용) |
| `claim_step` | mutation(state-scoped) | touches 선언 + write-skew 2단계 게이트 + state row append |
| `update_step_state` | mutation(state-scoped) | step row Status/DependsOn/Updated 갱신 |
| `list_steps` | read | Kahn 위상정렬+순환탐지+STEP_SUPERSEDE_PROTECTED+orphan/drift advisory |
| `validateWorkspaceScoped` | validator | step-local 1패스 |
| `promote_step_requirement` | mutation(req-scoped) | NEW step REQ id verbatim insert(reservation 유일성) |
| `supersede_requirement` | mutation(req-scoped) | strict 2-call(add→discard), 자기참조/역방향/N>1 가드, A1 무효화 |
| `MultiFileCommit` | engine | net-new merge 전용 4-phase + merge-journal crash-recovery |
| `diff_steps` | util | 4분류(key=computeSemanticSha) |
| `merge-journal` | mutation(log-append) | renames+sha256+capturedId, 재개 skip |
| `kiwi-step` | skill | 경량 step-local authoring |
| `kiwi-spec-merge` | skill | per-REQ 순차 오케스트레이터(dry-run→승인→1-REQ 콜→저널→재개) |

## 2.7 validator (Part 2)
- `SRS-W044` step-shadows-body(warning) · `SRS-W045` step-overload(≥7, warning; validator-rule vs read-time 은 §5 openDecision) — `diagnostic-registry.ts:468`(현재 최대 W040) 뒤 등록, A1 W041~W043 비충돌.
- `SRS-E012` ids 합집합 단일화(origin 분기 폐기), `seen`(E002)은 body-only 유지.
- `STEP_*` 진단(DIRECT_CONFLICT/OVERLAP/CYCLE/STALE/DRIFT/SUPERSEDE_PROTECTED): **별 네임스페이스, release 게이트 구조적 배제(advisory-only)**.
- updateStatus EXIT 가드 + CONFLICT-FULL-GUARDED 트리거 확장(evidence/verified/implemented/frozen/stable).
- governance prereq: **SRS-MD-Rules-v3.0.0** §23.3 `checked_compatible` enum 등록 + kiwi-srs §0.18 allowlist + CLAUDE.md v1.0.0→v3.0.0 포인터 수정 (rules 버전을 product target v3.0.0 에 일치).

---

# Part 3 — work modes + vibe trace + deferred SRS synthesis (A1/Part2 위 적층)

> 동기: sdd(spec→plan→TDD→verify)는 정확하지만 빠른 수정·구현엔 검증 오버헤드가 과함. vibe 는 구현 중 게이트·검증을 0으로 미루고, Part 2 steps/merge 로 모으고, Part 1 A1 으로 그 merge 한 점을 싸게 만든다. 즉 vibe 는 검증을 *없애는* 게 아니라 *한 점으로 모으는* 것이고 A1 이 그 점을 싸게 만든다 — 세 파트의 결합점.

> **구현 전제(검증 반영)**: §3.1–§3.6 의 'Part 2 재사용' 대상(`parseStepState`/`state.md`/origin-split parser/A1 util/`promote_step_requirement` 등)은 **현재 `src/` 에 없고 Part 1·2 가 먼저 인도되어야 존재**한다 — '기존 코드 재사용'이 아니라 '미구현 Part 2 코드 확장'. Part 3 는 Stage 1a/1d/3a 뒤에 게이트된다.

## 3.1 work mode 모델 — sdd / vibe / wait

**SSOT = state.md 상단 metadata** (`docs/spec/steps/state.md`, Part 2 재사용): `Mode=sdd|vibe|wait` + `Active Task=<task-id>`(vibe 한정). `parseStepState` 확장으로 동일 1패스에서 읽음 — **별도 mode store 신설 금지**(drift 차단, hook·게이트 단일 진실). init 은 vibe 사용 여부와 무관하게 **최소 state.md 를 항상 스캐폴드**(steps 미사용 repo 도 mode 만 사용 가능). **fail-open 기본값(검증 MED)**: state.md 부재·파싱불가·Mode 라인 불량 → `Mode=wait` 취급(hook no-op, 거버넌스 게이트 미해제) — 손상된 state 가 vibe trace 를 몰래 켜거나 거버넌스를 막지 못함.

| mode | 거버넌스 게이트 | trace | 기본 |
|---|---|---|---|
| `sdd` | 전부 적용(spec-before·stability gate·REQ-coverage·TDD-before) = 현 동작 | 없음 | — |
| `vibe` | **전면 해제**("다 바꿔도 됨"). 단 commit 게이트(3.4)가 spec-eventually 강제 | hook 누적 | — |
| `wait` | 없음(중립·탐색·결정 대기) | 없음 | ✅ init 직후 |

**거버넌스 mode-conditional 화**(핵심): 현 CLAUDE.md/AGENTS.md "SRS 워크플로 MUST" 블록(`init-project.ts:58 upsertAgentInstruction`, 버전드-마커 `# SpecKiwi SRS 워크플로 v{n}` + `AGENT_INSTRUCTION_END_MARKER`)을 **mode 분기 서술로 교체** + `AGENT_INSTRUCTION_VERSION` bump. MUST 들은 "sdd 에서" 한정, vibe 는 `Work-Modes-Rules` 위임. → 기존 upsert 멱등 패턴(`renderAgentInstructionSnippet` 갱신)으로 자동 이행, 신규 설치 로직 불필요.

## 3.2 vibe 라이프사이클 + trace 계약

```
[mode=vibe 진입]  kiwi-vibe 스킬: ① 의도 질문 → intent.md  ② 작업 이름 질문(또는 'auto' → 의도 분석해 slug 도출)
  → state.md: Mode=vibe, Active Task={작업이름} ; task row(active) append   (intent.md 먼저 → Active Task 나중)
[코딩]  PostToolUse hook(mode-aware) → docs/.kiwi/trace/{작업이름}/trace.{sessionId}.jsonl (append-only, per-edit)
        ＋ 코딩 스킬이 변경 코드 주석에 `step: {작업이름}` 삽입(vibe 는 REQ-ID 부재)
[commit/PR]  합성 스킬: intent.md + trace + `step:` 주석 + 최종 git diff → docs/spec/steps/{작업이름}/*.srs.md + step row
           → /kiwi-spec-merge (A1 싼 모순검증) → 본체
```

- **작업 이름 = 단일 식별자(신규)**: vibe 진입 시 `kiwi-vibe` 가 의도와 함께 **작업 이름**을 질문(사용자가 'auto' 선택 시 직전 intent 를 분석해 slug 자동 도출). 이 이름이 곧 `Active Task`(state.md) = trace 디렉토리 `docs/.kiwi/trace/{작업이름}/` = step 디렉토리 `docs/spec/steps/{작업이름}/` = 코드 주석 `step: {작업이름}` 의 **단일 키**. 중복 시 suffix(`-2`). hook payload 엔 speckiwi 식별자 없음(Claude=session_id / Codex=session_id+turn_id, 연구 R3) → **hook 은 작업 이름을 payload 가 아닌 state.md `Active Task` 에서 읽는다**(mode 게이트와 동일 소스).
- **코드 주석 trace 태그(신규)**: 기존 sdd 는 변경 코드 주석에 SRS REQ-ID 를 넣는다. vibe 는 REQ 부재이므로 코딩 스킬이 **`step: {작업이름}`** 주석을 삽입 — 합성 시 `trace.jsonl.files[]` + 이 주석으로 **코드 영역↔작업 귀속**의 1차 단서. sdd 라도 step 작업이면 REQ-ID 와 병기 가능. 규약 SSOT = `Work-Modes-Rules`.
- **intent-first 원자성(검증 MED)**: 쓰기 순서 = **intent.md 먼저 → state.md `Active Task` 나중**(crash 시 'ActiveTask 有 + intent 無' 차단). `trace.mjs` 는 `Active Task` 有 + intent.md 無면 **fail-closed no-op** + 'intent 복구' 안내. abandon 된 stale Active Task 는 Stale Days TTL 로 감지(§5 #10).
- **trace.jsonl 1행 계약**: `{ts, agent:"claude"|"codex", sessionId, turnId?, tool, files:[path...], op:"edit"|"write"|"bash", intentRef}`. Claude=`tool_input.file_path` 직접; Codex=apply_patch 봉투(`tool_input.command`) 파싱 추출(**공식 hooks 문서 확정**: canonical `tool_name=apply_patch`, PostToolUse 에 `tool_input` 제공 → 경로 파싱; 빌드 floor 만 확인 #7).
- **동시쓰기 안전(검증 MED)**: 하나의 `Active Task` 를 Claude+Codex 또는 복수 세션이 동시에 쓰면 단일 `trace.jsonl` 에 cross-process append 가 interleave/tear(win32 node hook = O_APPEND 원자성·flock 미보장). → **per-writer shard `trace/{task}/trace.{sessionId}.jsonl`**, 합성 시 ts 로 merge. shard 당 단일 writer 불변식 + 합성 시 부분-기록 trailing line 복구.
- **canonical 트리(R10 해소)**: `docs/.kiwi/` 단일 트리 = `hooks/`(스크립트) + `trace/{작업이름}/`(데이터). 루트 `.kiwi/` 없음(net-new). 기존 `.speckiwi/*.yaml`(레거시 YAML, MD-only 불변식과 별개)과 무관 — **미접촉**.
- **trace 보존 + 민감정보(검증 LOW)**: jsonl=경로만(크기 bound). **합성 입력(intent.md + 최종 git diff)은 SRS 로 커밋·git history 영속** → diff 크기 cap + secret 패턴 redact + .gitignore/secret 경로 제외. merge 성공 후 `trace/{task}/` prune/이관(§5 결정).

## 3.3 hook 자동 설치 — `speckiwi init` 확장 (양 에이전트)

기존 `speckiwi init`(`mutations.ts:69` → `initProject`)**에 hook 설치 추가**(신규 명령 아님). 멱등=`upsertAgentInstruction` 버전드-마커 패턴 차용. **단 `.claude/settings.json` 의 key-보존 JSON 머지는 net-new(검증 HIGH)** — `install-skill.ts` 는 *whole-dir stage→swap* 설치자(비-skill 콘텐츠를 conflict 로 거부)라 JSON 키-머지 선례가 아님(원자성·conflict-aware·멱등 *방식*만 차용). settings.json 머저는 별도 REQ: read → JSONC-aware parse → matcher 배열 머지 → backup → BOM 보존 → 마커 멱등.

| 대상 | 파일 | 내용 |
|---|---|---|
| Claude | `<repo>/.claude/settings.json` **머지** | `hooks.PostToolUse[matcher="Edit\|Write\|MultiEdit\|NotebookEdit"]` → `node docs/.kiwi/hooks/trace.mjs`. Bash 제외(파일 trace 순수성, Bash 는 `.command`). hot-reload. 기존 BOM 보존(신규 no-BOM). **타 키 보존 JSON 머지(net-new 컴포넌트, §3.3)** |
| Codex | `<repo>/.codex/hooks.json` **전용** | `PostToolUse[matcher="apply_patch\|Edit\|Write"]` type=command(async 미지원, timeout 기본 600s) + `commandWindows`(win32). config.toml inline 회피(혼재 시 startup warn). **trust 게이트(아래)** |
| 공유 | `docs/.kiwi/hooks/trace.mjs` | tool_name 분기(Claude `file_path` / Codex apply_patch 파싱). mode≠vibe → no-op. node(win32, no-bash) |
| 공유 | `.git/hooks/pre-commit` (+`docs/.kiwi/hooks/pre-commit.mjs`) | **로컬 best-effort 게이트**(권위 아님): 미합성 vibe trace 잔존 시 raw commit 차단. 우회 가능 → 아래 게이트 한계·§5 #12 |

- **Codex 버전 게이트(필수)**: apply_patch→PostToolUse 는 PR #18391(2026-04-22 머지, ≈v0.135.0) 이전 빌드 미발화(issue #16732, hardcoded `tool_name:"Bash"`). init 은 `codex --version` 검출 → floor 미만 거부/경고 + 최소버전 문서화. 검출 불가 시 경고 후 설치.
- **Codex trust 게이트(필수, 신규)**: Codex 는 비-managed hook 을 **hash trust 전까지 skip** + **project-local `.codex/` 는 trusted project 에서만 로드**(공식 hooks 문서). 즉 init 이 `.codex/hooks.json` 을 떨궈도 **자동 활성 아님** — init 은 ① repo 를 Codex 에서 trust ② `/hooks` 로 hook trust(1회) 를 안내. Claude 는 hot-reload 라 trust 게이트 없음(**비대칭**). hook 정의 변경 시 재-trust 필요(automation 은 `--dangerously-bypass-hook-trust`).
- **enterprise 억제 감지(R6)**: Codex `requirements.toml allow_managed_hooks_only=true` / Claude `managed-settings.json` 이면 설치 hook 무시 → init 감지·경고.
- **clobber 방지(R7)**: 기존 `.git/hooks/pre-commit`·`core.hooksPath`·husky/lefthook 감지 → 마커-한정 머지 또는 경고, 무단 덮어쓰기 금지. `.git/hooks` 는 클론별(비커밋) → init 은 **클론마다 1회** 필요(문서화).
- **in-agent 소프트넛지(R8, 선택)**: Claude PreToolUse `Bash`+`if:"Bash(git commit *)"`. Codex 는 matcher 가 tool_name 레벨이라 git-commit 만 좁히는 동형 필터 미확인(실측 필요) — 자기 commit 만 잡고 비권위.
- **게이트 한계(검증 HIGH)**: `.git/hooks/pre-commit` 도 **구조적으로 우회 가능** — `git commit --no-verify`, init 안 한 fresh clone, CI/bot commit, 비-Claude/Codex 클라이언트, `core.hooksPath`/husky 덮어쓰기. 따라서 "spec-eventually 강제"가 아니라 **best-effort 로컬 넛지**. *진짜* 강제는 server-side(CI required-status-check / pre-receive hook)로만 가능.
- **server-side 강제(확정 P3-8)**: speckiwi 가 `speckiwi vibe-gate --check`(CI 서브커맨드) 제공 — `Mode=vibe` + 미합성 `Active Task` 상태의 commit 을 비-0 exit 로 차단. 팀이 CI **required-status-check** 에 연결(speckiwi 는 *도구* 제공, 강제는 remote 가). **로컬 hook(best-effort) + remote check(강제) 2층** — `--no-verify`·fresh clone·CI commit 우회를 remote 층이 막음.

## 3.4 멱등 commit 게이트 + 합성 스킬

- **합성 = 전담 스킬**(`kiwi-vibe-commit` 가칭): 직접 실행 OR commit 흐름이 호출. **멱등 마커 = Active Task 의 step row / `steps/{task}/` 존재 여부**(Q1): `Active Task 有 + step row 無` → 합성 1회 / `step row 有`(이미 수동 합성) → no-op(중복 호출 금지).
- **pre-commit.mjs**: state.md `Mode=vibe` + `Active Task` 有 + 대응 step row 無(미합성) → exit≠0 차단 + "합성 스킬 먼저 실행" 안내. 합성 후 step row 존재 → 통과. **단 우회 가능(§3.3 게이트 한계) — best-effort.**
- **합성 산출 → Part 2 재사용**: `promote_step_requirement` / per-REQ 오케스트레이션 / `kiwi-spec-merge` / A1 그대로. 합성은 **intent.md(=why) + trace(=what) + 코드**로 SRS 생성 → 순수 역생성 품질 리스크 원천 차단.
- **REQ-ID 거버넌스(검증 MED)**: 합성 스킬이 ID 를 직접 고르면 caller-선택 경로(Part 2 §2.2 금지). vibe step REQ-ID 는 **reservation minter(HEAD∪step∪reserved)로만 발급**, `promote_step_requirement` 가 미예약 ID 거부.
- **모순검증 게이트(검증 MED → 확정 P3-9)**: compat 누락=W042 *warning*(advisory)이라 step row 존재만으로 모순 미해결 merge 가 통과 가능. → **'synthesized'(step row 존재) ≠ 'contradiction-verified'(touched closure `list_dirty_edges` 공집합/명시 ack) 분리**. **결정: vibe 한정 hard-gate** — vibe 합성/merge 는 touched closure 의 dirty-edge 가 공집합(또는 명시 ack)이어야 step row 를 '완료'로 표기. Part 2 STEP_* 의 advisory 철학은 유지(vibe 만 예외 — vibe 의 안전 서사가 '검증을 merge 한 점에 모음'이므로 그 점이 advisory 면 vibe=영영 미검증).

## 3.5 도구 셋 (Part 3)

| 도구 | 종류 | 역할 |
|---|---|---|
| `set_work_mode`/`get_work_mode` | mutation/read(state-scoped) | state.md Mode 전환·조회; vibe 진입 시 task-id 발급+intent 트리거 |
| `parseStepState`(확장) | util(read) | Mode/Active Task metadata 파싱(Part 2 재사용) |
| init hook installer | engine | initProject 확장: docs/.kiwi 스캐폴드 + 최소 state.md + .claude/.codex/.git hook 설치(멱등·clobber·버전게이트·enterprise 감지) |
| `settings.json` JSON 머저 | engine(net-new) | key-보존 JSONC 머지 + matcher 배열 dedup + BOM 보존 + 마커 멱등(install-skill 키-머지 선례 없음) |
| `trace.mjs` | hook script | per-edit jsonl append(mode-aware, 양 에이전트 분기) |
| `pre-commit.mjs` | hook script | 미합성 vibe trace 차단(로컬 best-effort, 우회가능 §3.3) |
| `kiwi-vibe` | skill | vibe 진입: 의도+작업이름 질문(auto 도출)·state 설정·`step:` 주석 가이드 |
| `kiwi-vibe-commit` | skill | trace→step SRS 합성(멱등) → kiwi-spec-merge 연계 |
| `vibe-gate`(CLI) | engine | `speckiwi vibe-gate --check` — CI 용 미합성 vibe commit 차단(P3-8 server-side 층) |
| `Work-Modes-Rules-v1.0.0.md` | bundled rule | init 작성(`loadBundledRulesDocument` 패턴); intent-first·mode 게이트 규약 |

## 3.6 거버넌스/규약

- **CLAUDE.md(repo) MUST → mode-conditional**: spec-before·stability gate·TDD-before 는 sdd 한정, vibe 는 Work-Modes-Rules 위임. `renderAgentInstructionSnippet` 갱신 + `AGENT_INSTRUCTION_VERSION` bump(upsert 멱등 자동 이행).
- **Work-Modes-Rules-v1.0.0.md 신설**(CLAUDE.md 참조 라인 추가): vibe intent-first 의무, 작업 이름 질문(auto 도출), 코드 주석 `step: {작업이름}` 규약, 3 mode 의미, trace 계약, 합성 멱등, commit 게이트.
- **SRS-MD-Rules 와 분리**: 모드는 *워크플로* 규약이라 *구조* 규약(SRS-MD-Rules)과 별개 문서.

## 3.7 Part 3 난제·해법 요약 (검증 반영)

| 난제(검증) | 심각도 | 해법 |
|---|---|---|
| 7-1 commit 게이트 우회(`--no-verify`·fresh clone·CI·husky) | HIGH | 로컬=best-effort 넛지 + remote 강제(`speckiwi vibe-gate --check` → CI required-check) 2층, P3-8 |
| 7-2 settings.json 머지 선례 부재 | HIGH | install-skill 은 dir stage→swap(키-머지 아님); key-보존 JSON 머저 net-new REQ(BOM·JSONC·배열 dedup·마커) |
| 7-3 trace.jsonl 동시쓰기 tear(Claude+Codex 동일 task) | MED | per-writer shard `trace.{sessionId}.jsonl` + 합성 merge, 단일-writer 불변식, 부분 trailing line 복구 (Codex 문서도 "병렬 hook shared-write 주의" 경고) |
| 7-9 Codex hook trust/skip | MED | init=설치≠활성; 사용자 `/hooks` trust + project trust 1회 안내(Claude 비대칭) |
| 7-4 intent↔ActiveTask 비원자 crash | MED | intent.md 먼저 → ActiveTask 나중; trace.mjs intent 無면 fail-closed; stale TTL abandon |
| 7-5 모순검증 advisory passthrough | MED | synthesized(step row) ≠ contradiction-verified(dirty-edge 공집합) 분리; **vibe 한정 hard-gate**(P3-9) |
| 7-6 vibe REQ-ID caller-선택(불변식 위반) | MED | reservation minter 전용, promote 미예약 ID 거부 |
| 7-7 state.md fail-mode | MED/LOW | 부재·불량 → Mode=wait fail-open, hook no-op |
| 7-8 합성 입력 민감정보 영속 | LOW | diff cap + secret redact + .gitignore 제외(SRS 커밋되므로 history 영속) |

---

## 3. 통합 구현 순서 (전 단계 TDD test-first)

- **Stage 0 (거버넌스+버그 선결)**: (a) `add_trace_link` notes 복원(핸들러 `mutation-tools.ts:76` 이 `input.notes` 전달 — `server.ts:70` 스키마는 정상) + dryRun 전달(`mutation-tools.ts:64-77`) (b) SRS-MD-Rules-v3.0.0(§23.3 enum) (c) kiwi-srs §0.18 allowlist (d) CLAUDE.md 포인터 수정. 각자 REQ-ID.
- **Stage 1a (난제1 parser 격리 — 모든 후속 hard precondition)**: discover steps/ 제외 필터+stepFiles, workspace-parser origin 분리, types.ts origin/stepName, ids 합집합. **신규 필드(stepRecords/stepFiles/stateFile·origin/stepName)는 optional + 소비측 `?? []`/`?? 'body'` 기본값**(단일 생성자 `workspace-parser.ts`·fixture 호환). 회귀: 동일 ID step+미등록 scope → HEAD 진단 0.
- **Stage 1b (mutation 라우팅 + successor 회귀)**: loadRecord origin?/stepName?, findIncomingTraceRows 합집합 입력.
- **Stage 1c (난제6 정문)**: updateStatus EXIT 가드 + override. 독립 REQ-ID + 실패테스트 선행.
- **Stage 1d (state.md + scoped validator)**: stateFile 로드, parseStepState, validateWorkspaceScoped + CLI/MCP, W044/W045, STEP_* 네임스페이스.
- **Stage 1e (A1 1단계 — write-skew transitive·merge dirty 감축의 blocking dependency)**: computeSemanticSha/list_dirty_edges/add·refresh·revoke_compatibility_check/compareReqId + **computeBlastRadius export 계약**. + Part 1 갭 도구(statement/AC).
- **Stage 2a (steps 도구 — A1 없이 degraded 가능)**: claim_step(1-hop degraded)/update_step_state/list_steps + kiwi-step.
- **Stage 2b (supersede+원자성)**: supersede_requirement(2-call), MultiFileCommit(Option A+merge-journal), promote_step_requirement.
- **Stage 2c (merge 스킬)**: diff_steps(A1 후 cache-consumption 전환), kiwi-spec-merge(per-REQ 순차·dry-run·재개·evidence 마이그레이션·verification-decrease report). write-skew transitive A1 활성화.
- **Stage 3a (work mode 모델 — Part 2 state.md 선행)**: parseStepState 에 `Mode`/`Active Task` metadata 확장, set/get_work_mode, governance snippet mode-conditional 화(`renderAgentInstructionSnippet` + `AGENT_INSTRUCTION_VERSION` bump) + `Work-Modes-Rules-v1.0.0.md` 번들(`loadBundledRulesDocument` 패턴) + CLAUDE.md 참조 라인.
- **Stage 3b (vibe trace + init hook)**: docs/.kiwi 스캐폴드, trace.mjs/pre-commit.mjs, initProject hook 설치(Claude settings.json 머지 / Codex hooks.json+버전게이트 / .git pre-commit, clobber·enterprise 감지), trace.jsonl 계약, intent-first 캡처. **Codex per-edit 실측(R2) 선행** — 실패 시 git turn-diff fallback.
- **Stage 3c (합성 스킬)**: kiwi-vibe / kiwi-vibe-commit(멱등 합성), 멱등 commit 게이트, Part 2 merge 연계.

## 4. 확정 결정

| # | 결정 | 확정 |
|---|---|---|
| P1-1 | 갭 도구 범위 | 고빈도만(statement+AC), metadata-field 2단계 *(사용자)* |
| P1-2~8 | A3 2-hop / cross-target 전역색인 / peer삭제 orphaned분류 / 중복row warning / DENY={Status,Stability} / fpv test vector | 종합 권장안 |
| P2-1 | merge | per-REQ 오케스트레이션(batch 도구 금지) |
| P2-2 | archive | in-place discarded(물리이동 금지) |
| P2-3 | verified 가드 | updateStatus chokepoint EXIT 가드 |
| P2-4 | write-skew | 직접=HARD-BLOCK, transitive=SOFT-BLOCK |
| P2-5 | successor SSOT | supersedes Trace row('Superseded By' 제거) |
| P2-6 | A1 의존 | hard dependency(Stage 1e 선행), 미인도 시 degraded |
| 범위 | 1+2단계 통합 = **v3.0.0 (major)** | *(사용자)* |
| P3-1 | mode SSOT | state.md metadata(`Mode`+`Active Task`), 별도 store 금지 *(사용자)* |
| P3-2 | vibe 거버넌스 | 전면 해제 + commit 게이트 spec-eventually *(사용자)* |
| P3-3 | intent | vibe intent-first(질문→intent.md), Work-Modes-Rules 정의 *(사용자)* |
| P3-4 | hook 설치 | speckiwi init 확장 — Claude PostToolUse 머지 / Codex hooks.json+버전게이트(install model 확정) / .git pre-commit **best-effort**(권위 아님, #12) |
| P3-5 | 멱등 | step row 존재=합성됨, 중복 합성 no-op *(사용자)* |
| P3-6 | canonical 트리 | `docs/.kiwi/{hooks,trace}`, `.speckiwi/` 미접촉 |
| P3-7 | Part 3 난제 | §3.7 8종 해법(검증 HIGH2·MED5·LOW 반영) |
| P3-8 | commit 게이트 강제 | 로컬 best-effort hook + `speckiwi vibe-gate --check` CI 서브커맨드(remote required-check) 2층 *(위임결정)* |
| P3-9 | vibe 모순검증 | vibe 한정 hard-gate(dirty-edge 공집합 강제); Part 2 STEP_* advisory 유지 *(위임결정)* |
| P3-10 | 작업 이름 | vibe 진입 시 질문(또는 auto 도출); Active Task=trace/step/`step:`주석 단일 키 *(사용자)* |

## 5. 남은 사용자 결정 (openDecisions)

P2 워크플로가 12건 제기 — 주요:
1. **A1 미인도 degraded 기간 정책**: transitive write-skew advisory-only 로 merge 빅뱅 이월 허용 vs A1 인도까지 steps 워크플로 gate.
2. **verified 보호 플래그 판정 시점**: claim_step vs merge (step 생성 후 본체가 verified 전이된 TOCTOU → merge 시점 재검증 의무).
3. **override granularity**: frozen 은 confirm 만으로 부족 → 별도 unfreeze(update_stability) 선행 요구할지.
4. **STEP_DIRECT_CONFLICT UX**: 같은 REQ 의 서로 다른 AC 추가를 과도 차단 — AC-level 분할 허용 vs REQ-level hard-block.
5. **evidence 마이그레이션 규칙**: 자동 복사(stale 위험) vs manual + 'reverification owed' 기본.
6. SRS-W045 validator-rule vs read-time / merge-journal 위치(monorepo) / ParsedWorkspace 직렬화 노출 / multi-root stateFiles 확장 / CONFLICT-PARTIAL AC-level sub-hashing / P2 미인도 전 merge GA 게이트.

**Part 3 (work modes/vibe) 제기:**
7. ~~Codex per-edit 실측(R2)~~ **[해소 — 공식 hooks 문서]**: canonical `tool_name=apply_patch`(Edit/Write alias) + PostToolUse `tool_input`(patch body) 제공 → 경로 파싱으로 per-edit 추적 가능(fallback finding 의 "tool_name 항상 Bash" 는 구버전). 남은 것 = **빌드 floor 확인 + Codex trust 게이트 UX**(§3.3). git turn-diff fallback 은 floor 미만/trust 불가 시에만.
8. **trace 보존/prune**: merge 성공 후 `trace/{task}` prune vs `trace/_merged` 이관 vs 영구 보존.
9. **Codex floor 버전 문자열 + 검출 명령** 확정(≈v0.135.0 / PR #18391 포함 릴리스).
10. **wait↔sdd/vibe 전환 시 미완 trace 처리**(미합성 잔존 경고/차단 정책).
11. **multi-project 동시 vibe**: 다른 `docs/.../steps/state.md` 의 복수 Active Task — per-root state 확장(Part 2 multi-root 확장과 연동).
12. ~~commit 게이트 강제 수준~~ **[확정 → P3-8]**: 로컬 best-effort hook + `speckiwi vibe-gate --check` CI 서브커맨드(2층). speckiwi 는 도구 제공, remote required-check 가 강제.
13. ~~vibe merge 모순검증 강도~~ **[확정 → P3-9]**: vibe 한정 hard-gate(dirty-edge 공집합 강제); Part 2 STEP_* 는 advisory 유지.

## 6. 다음 단계
이 통합 design 을 기반으로 speckiwi SRS 에 **v3.0.0 target + REQ 묶음 등록(kiwi-srs)**. scope 배치(추정): PARSE(origin 격리/파서/tokenizer + state.md `Mode`/`Active Task` metadata), MCP(도구·어댑터·schemas + set/get_work_mode), CLI(step 명령 + `speckiwi init` hook 확장 + `speckiwi mode`), NODE(util/mutation/MultiFileCommit/validator + initProject hook installer + trace.mjs/pre-commit.mjs + 합성 util), FLOW(워크플로/규약 v3.0.0 + Work-Modes-Rules + mode-conditional governance + kiwi-vibe/kiwi-vibe-commit). 그 다음 Stage 순서대로 TDD 착수.

---

> **검증 이력**: P1(`wf_1b47d5b3-3cc`) 종합 + 2-에이전트 교차검증(critical/high 0, I-1~I-8 + E035·Superseded By 반영). P2(`wf_c3600158-570`) 종합(6난제 코드근거 해소, crossAspectConflicts 10건 해소) + 2-에이전트 교차검증(critical/high 0; 코드사실 HIGH 1[schemas.ts→`server.ts:70` 오인용]·MEDIUM 3[updateStatus 멱등·ParsedWorkspace optional·MultiFileCommit 엣지케이스], 충실성 LOW 3 반영).
