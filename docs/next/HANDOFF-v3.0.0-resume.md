# 🦏 SpecKiwi v3.0.0 구현 핸드오프 (새 세션 재개용)

> **목적**: 이 문서 하나 + 레포만으로 새 세션이 v3.0.0 구현 작업을 **정확히 이어서** 진행할 수 있게 한다.
> **작성**: 2026-06-24 기준 (worklog 최신 timestamp). **파이프라인**: kiwi-planner → kiwi-pm → kiwi-coder + review-fix-loop.
> **읽는 순서**: §0 즉시 재개 → §3 활성 블로커(필독) → 나머지.
> **이 문서를 실행하는 주체**: 새 세션의 **메인 에이전트(당신)**. `/kiwi-pm --resume` 는 스킬 본문을 로드하고, 그 의사코드를 당신이 직접 실행한다(서브에이전트 spawn·pm-state 관리·게이트 처리 모두 당신 책임). 따라서 아래 "자동 처리/게이트" 지시는 당신이 §6 표준지침에 따라 직접 수행하는 행동이다.
> **경로 규약**: 본 문서의 모든 `reports/…` 는 **`.kiwi/sessions/2026-06-17.speckiwi.v3-0-0/reports/…`** 의 축약이다(레포 루트에 top-level `reports/` 없음). 모든 명령/스킬 입력에는 이 전체 경로를 쓸 것.

---

## 0. ⚡ 즉시 재개 (TL;DR)

```text
1) 새 세션에서 스킬 로드:
   /kiwi-pm PLAN_PATH=docs/plans/2026-06-17.speckiwi.v3-0-0.plan.md --resume --auto
   - run_id "2026-06-17.speckiwi.v3-0-0" 는 plan.md frontmatter 에서 자동 도출 →
     .kiwi/sessions/2026-06-17.speckiwi.v3-0-0/pm-state.json 로드.
   - 인자는 key=value 형식(PLAN_PATH=...). bare positional 경로 의존 금지.

2) resume 게이트 — kiwi-pm 은 아래에서 멈추도록(HALT/질문) 설계됨. 그러나 §6.1 표준지침
   (모든 사용자 결정=위원회 자동결정, AskUserQuestion 중단 금지)에 따라 당신이 직접 처리한다.
   처리 방법(§3.4 의 one-liner 사용, 전부 Bash 도구로 실행):
   권장 순서: **먼저 §3.4 one-liner 들을 실행(전부 idempotent)한 뒤 `/kiwi-pm --resume` 호출.**
   kiwi-pm 이 이미-복구된 상태를 보고하면 그대로 진행(이중 복구 무해).
   (a) sidecar SHA mismatch  → 양성(완료 task 의 TDD evidence 기록). 자동결정 A(SHA 갱신 후 계속).
        ※ plan.md SHA 는 일치 = Task 구조 불변. 이 mismatch 는 매 resume 마다 반복되는 정상 현상.
        ※ kiwi-pm §5.4 는 --auto 라도 SHA mismatch 를 HALT 하지만, 본 건은 위원회 생략 가능한
          "사소·명백" 결정이므로 자동채택 A + 사유 기록.
   (b) stale running task(T-PH005-12) → status="pending" 복구(§3.2). RED(T-PH005-11)는 보존.
   (c) pm.lock stale → 현재 pm.lock 은 {pid, host, note} 만 있고 **timestamp 가 없어 "30분 경과"
        시간 기준은 적용 불가**. 같은 host 면 §3.4(a) 의 무조건 재획득이 canonical 처리(자동 해제 아님,
        수기 재획득). 다른 host 면 멀티 인스턴스 의심 → 사용자 확인.

3) 진행 상태 단일 권위(SSOT) = .kiwi/sessions/2026-06-17.speckiwi.v3-0-0/pm-state.json
```

**진행: 166/206 task done.** 남은 **40 task = 38 pending + 1 stale running + 1 blocked ≈ 20 REQ**:
- PH-005 MCP: **11 REQ**(= 21 task; stale 1 + pending 10·red/green 페어)
- PH-006 FLOW: **9 REQ**(= 18 task)
- PH-003: **FR-NODE-042 1 REQ blocked**(§3.1, SRS 선행 필요)

> **단위 주의**: 이 문서에서 "task" 와 "REQ" 를 구분한다. 1 REQ ≈ 2 task(red + green 페어). §2 표는 **task 단위**, §3·§4 의 잔여 목록은 **REQ 단위**다.

**⚠️ 재개 전 반드시 §3 의 두 블로커를 먼저 읽을 것:**
1. **T-PH003-52 (FR-NODE-042)** = BLOCKED. SRS 정합화(`/kiwi-srs`) 선행 필요. **강제 green 절대 금지.**
2. **T-PH005-12 (FR-MCP-025)** = stale `running`(attempts 0). `pending` 복구 후 재실행.

---

## 1. 프로젝트 컨텍스트 (무엇을 만들고 있나)

**SpecKiwi** = Git 추적 Markdown SRS(`docs/spec/**/*.srs.md`)를 요구사항 SSOT 로 쓰는 시스템. Node.js CLI `speckiwi` + stdio MCP 서버. TypeScript ESM, vitest.

**v3.0.0 목표**(active target goal):
> "(1) **incremental contradiction cache** (A1 checked_compatible/semanticSha) + **blast-radius** (A3) 로 O(touched × adjacent) 검증비용 절감; (2) **steps/deferred-merge 워크플로**; (3) **work modes / vibe trace**; (4) **CLI-as-SSOT 툴링** — ToolSpec registry 가 CLI+MCP 를 자동 렌더, mutation/query/edit/retarget 명령 확장, 검증 UX 재설계(grouped file:line diagnostics, explain, remediation)."

세 기둥의 코어는 이미 구현됨:
- **A1 contradiction cache**: `computeSemanticSha`(FR-NODE-020), `addCompatibilityCheck`(FR-NODE-022), `refresh/revokeCompatibilityCheck`(FR-NODE-023), `listDirtyEdges`(FR-NODE-024).
- **A3 blast-radius**: `compareReqId` + `computeBlastRadius`(FR-NODE-021).
- **steps 워크플로**: `claimStep`(FR-NODE-027), `updateStepState`(FR-NODE-028), step 파서(FR-PARSE-019~023).
- **CLI-as-SSOT**: ToolSpec registry(FR-ARCH-006), zero-drift(REL-ARCH-002), PH-004 CLI 27 REQ 전부.

---

## 2. 현재 진행 상태 (권위 = pm-state.json)

**카운트 단위 = task** (1 REQ ≈ red+green 2 task):

| Phase | scope | total(task) | done | pending | running | blocked |
|---|---|---|---|---|---|---|
| PH-001 | ARCH | 4 | **4** | 0 | 0 | 0 |
| PH-002 | PARSE | 24 | **24** | 0 | 0 | 0 |
| PH-003 | NODE | 74 | **73** | 0 | 0 | **1** (FR-NODE-042) |
| PH-004 | CLI | 54 | **54** | 0 | 0 | 0 |
| PH-005 | MCP | 32 | **11** | 20 | **1**(stale) | 0 |
| PH-006 | FLOW | 18 | **0** | 18 | 0 | 0 |
| **계** | | **206** | **166** | 38 | 1 | 1 |

- **REQ 환산**: 완료 ≈ 84 distinct REQ(103 중). 잔여 ≈ 20 REQ(PH-005 11 + PH-006 9) + FR-NODE-042 blocked.
- **PH-001/002/004 완료**, PH-003 은 FR-NODE-042 1건만 남고 36/37 REQ 완료.
- **FR-NODE-045 는 plan 에 없음**(번호 공백). 따라서 리뷰 `review-PH003-node-041-046.md` 는 045 제외 범위(044, 046 만)다 — §11 과의 외견상 불일치 아님.
- 각 클러스터마다 독립 review-fix-loop 통과(보고서: §11).
- SRS status 는 `implemented: 16 / planned: 87`(전부 evolving) — **실제 구현(~84 REQ)보다 한참 낮음**. 이유는 §10.2 status-reconcile 지연.

> **상태 파일 권위(tiebreak) — 중요**: 세션 디렉토리에 상태 파일이 3개 있다. **`pm-state.json` 이 진행의 단일 최종 권위**다. `worklog.jsonl`(이벤트 로그, append 가 항상 emit 되지 않음 — 특히 red task·일부 green 누락, timestamp 도 역순 가능)과 `state.json`(kiwi-coder 소유, current_phase·회귀 카운트 추적)은 **보조 뷰**이며, **세 파일이 충돌하면 pm-state.json 을 따른다.** (예: worklog 에 T-PH005-11/-12 이벤트가 없어도 pm-state 가 -11=done/-12=running 이면 그게 사실이다.)

---

## 3. ⚠️ 활성 블로커 (재개 전 필독)

### 3.1 T-PH003-52 (FR-NODE-042) — BLOCKED, SRS 정합화 필요
**증상**: green 코더가 FR-NODE-042 AC-3 ↔ FR-NODE-031 AC-1/AC-3 모순 보고. 동일 함수·동일 입력(`promoteStepRequirement({id:"FR-ARCH-501", fromStep:"feature-x", toScope:"ARCH"})`)이 031 에선 ok=true, 042 에선 ok=false 를 요구.

**3인 위원회 자동결정 결론** (전원 high confidence, 전문 = `reports/decision-T-PH003-52.md`):
- 진짜 모순이 아니라 **"reserved id" 의 판별 메커니즘(reservation provenance ledger)이 SRS 에 미명시**. 현재 `add-requirement.ts` 의 reservation-view 는 HEAD∪step **유일성 검사일 뿐 provenance ledger 가 아님**.
- **결정 요지**:
  1. FR-NODE-042 를 **BLOCKED** 유지. **강제 green 절대 금지**(모순 계약 baking 방지).
  2. `/kiwi-srs` 로 정합화: FR-NODE-042/031 의 "reserved" 를 HEAD∪step 유일성과 구별되는 **minter-populated provenance ledger** 로 명문화(영속 위치 + 예약 진입 방법). 최단순안: `docs/spec/steps/` 하위 append-only reserved-id 목록. FR-NODE-031 AC-2 "exists in reservation view" 와 FR-NODE-042 AC-3 "not produced by minter" 가 동일 ledger-membership 술어임을 명시.
  3. 정합화 후 **재계획**: 순수 `mintStepRequirementId`(view→string, no I/O) + provenance guard 분리, FR-NODE-031 setup 을 minter-produced id 로(단언 보존), AC-3 비순차(FR-ARCH-777) no-auto-generate 판별력 보존. **T-PH003-51 RED 테스트도 재작성**(현재 501 blanket-reject 로 과대제약).
  4. 그동안 **나머지 독립 REQ 는 계속 진행**.

**해소 실행 절차(어떻게)** — FR-NODE-042 를 실제로 풀려면:
```text
(1) Skill(skill="kiwi-srs") 호출. 입력 = reports/decision-T-PH003-52.md 의 결론(reservation
    provenance ledger 명문화), 대상 REQ = FR-NODE-031 + FR-NODE-042. 산출 = docs/spec 갱신
    (MCP add_requirement/append_section_note 또는 §6.6 golden rule 준수).
(2) 정합화 후 Skill(skill="kiwi-planner") 로 FR-NODE-042(및 영향받는 031)만 재분해 →
    같은 sidecar(2026-06-17.speckiwi.v3-0-0.sidecar.json)의 T-PH003-51/52 tdd red/green 갱신.
(3) 재작성된 T-PH003-51 RED → T-PH003-52 GREEN 을 §5 cadence 로 실행.
(4) 가드레일: mintStepRequirementId 순수성 / FR-NODE-031 세 단언 보존 / AC-3 비순차 판별력 보존.
```
이는 SRS 변경 + 재계획이 얽힌 큰 작업이므로, 사용자가 별도 우선순위를 줄 수 있음 — **막혔다고 전체를 멈추지 말고 PH-005/006 을 먼저 진행**한다.

### 3.2 T-PH005-12 (FR-MCP-025) — stale `running` 복구
**FR-MCP-025 는 "반쯤 완료"** 상태다: RED task **T-PH005-11 은 이미 done(통과)**, GREEN task **T-PH005-12 만 stale `running`**(`attempts=0`, `started_at` 필드 부재 = 이전 세션이 green 을 띄우다 비정상 종료, **green 구현만 미완**).
- ⚠️ **RED(T-PH005-11)를 재작성하지 말 것** — 이미 통과한 red 다. T-PH005-12(green)만 복구·실행.
- **`--auto` resume 시**: kiwi-pm §5.4 가 자동으로 T-PH005-12 를 `pending` 복구하므로 수기 편집 불필요.
- **비-auto 또는 수기 필요 시**: §3.4 의 running→pending one-liner 사용.
복구 후 T-PH005-12(FR-MCP-025 green)부터 정상 실행.

### 3.3 실질 재개 지점
§3.1/§3.2 처리 후 순서: **T-PH005-12(FR-MCP-025 복구) → T-PH005-13(FR-MCP-026) → … PH-005 잔여 → PH-006 FLOW**. 잔여 목록 SSOT 는 **§4**. FR-NODE-042 는 `/kiwi-srs` 정합화까지 blocked 유지.

### 3.4 resume 게이트 처리 one-liner (전부 Bash 도구로 실행)
```bash
# (a) sidecar SHA 갱신 (자동결정 A — 양성) + (c) lock 재획득 (same-host stale)
node -e '
const fs=require("fs"),crypto=require("crypto");
const dir=".kiwi/sessions/2026-06-17.speckiwi.v3-0-0", sp=dir+"/pm-state.json";
const s=JSON.parse(fs.readFileSync(sp,"utf8"));
fs.writeFileSync(sp+".bak", JSON.stringify(s,null,1));
s.sidecar_sha256=crypto.createHash("sha256").update(fs.readFileSync(s.sidecar_path)).digest("hex");
s.last_updated_at=new Date().toISOString();
fs.writeFileSync(sp, JSON.stringify(s,null,1));
const lp=dir+"/pm.lock", old=JSON.parse(fs.readFileSync(lp,"utf8"));
const host=require("os").hostname();
if(old.host && old.host!==host){console.error("⚠️ lock host="+old.host+" != current "+host+" — 멀티 인스턴스 의심. §0(c) 대로 사용자 확인 후 진행(이 줄 제거)."); process.exit(1);}
fs.writeFileSync(lp, JSON.stringify({pid:process.pid,started_at:new Date().toISOString(),host:host,note:"resume"},null,1));
fs.appendFileSync(dir+"/worklog.jsonl", JSON.stringify({ts:new Date().toISOString(),event:"resume",sha_decision:"auto-A benign evidence; plan.md byte-identical",prev_lock_pid:old.pid})+"\n");
console.log("sidecar SHA updated, lock reacquired");
'

# (b) stale running → pending 복구 (비-auto 경로)
node -e '
const fs=require("fs"), sp=".kiwi/sessions/2026-06-17.speckiwi.v3-0-0/pm-state.json";
const s=JSON.parse(fs.readFileSync(sp,"utf8"));
const t=s.tasks.find(x=>x.task_id==="T-PH005-12");
if(t&&t.status==="running"){t.status="pending"; t.started_at=null;}
const st={total:s.tasks.length,done:0,running:0,pending:0,failed:0,blocked:0,skipped:0};
s.tasks.forEach(x=>st[x.status]++); s.stats=st; s.last_updated_at=new Date().toISOString();
fs.writeFileSync(sp, JSON.stringify(s,null,1));
console.log("T-PH005-12 -> pending | pending="+st.pending);
'
```

---

## 4. 남은 작업 분해 (잔여 SSOT — §0/§3.3/§13 은 이 섹션 참조)

- **PH-005 MCP — 11 REQ = 21 task**: stale 1(**FR-MCP-025**, green 복구 대상 — §3.2) + pending 10(**FR-MCP-026, 027, 028, 029, 031, 032, 033, 034, 035, 036**). (**FR-MCP-030 은 v3.0.0 plan 에 없음 = 번호 공백** — v3.0.1 target 으로 분리되어 거기서 verified 완료. FR-NODE-045·FR-FLOW-021/022 와 동일한 plan gap이며 pm-state 의 done task 아님.) MCP 도구 표면 — read/mutation tool schema, zero-drift, validate_step 류.
- **PH-006 FLOW — 9 REQ = 18 task**: **FR-FLOW-013, 014, 015, 016, 017, 018, 019, 020, 023**. (021, 022 gap.) 워크플로/릴리즈/규칙.
- **PH-003 잔여 — 1 REQ blocked**: **FR-NODE-042** (§3.1, SRS 정합화 대기).

각 REQ 의 정확한 task↔REQ·tdd.phase·files 매핑 (실행 셸: **Bash**):
```bash
node -e 'const sc=require("./docs/plans/2026-06-17.speckiwi.v3-0-0.sidecar.json"); sc.tasks.filter(t=>t.id.startsWith("T-PH005-")||t.id.startsWith("T-PH006-")).forEach(t=>console.log(t.id, t.tdd&&t.tdd.phase, (t.req_ids||[]).join(","), (t.files||[]).map(f=>f.path).join(" | ")));'
```
> **필드명 주의**: task↔REQ 매핑은 **sidecar 의 `req_ids`** 로 조회한다. **pm-state.json 의 task 는 같은 정보를 `trace_req_ids`** 필드에 담는다(필드명이 다름). pm-state 에서 `req_ids` 를 찾으면 빈 결과가 나오니, REQ 매핑은 위 sidecar 명령을 쓸 것.

---

## 5. 운영 모델 (어떻게 진행하나)

**kiwi-pm** 이 메인 오케스트레이터(=당신). 각 sidecar Task 를 **격리된 `Agent` 서브에이전트(kiwi-coder)** 로 순차 spawn(Task 1:1). kiwi-coder 가 TDD(red→green)·회귀·자체검증 전권. 당신(PM)은 orchestrator + pm-state 관리 + 종료 T-final mutation.

**확립된 cadence (이 프로젝트에서 실제로 돌린 방식)**:
1. REQ 의 red task spawn(§5.1) → 결과 분기(§5.2) → green task spawn → 결과 분기. (red/green 각각 별도 kiwi-coder.)
2. spawn 프롬프트는 §5.1 템플릿. `SPAWN_CONTEXT=pm-child` 명시 필수.
3. **연속 5~6 REQ green 완료마다** 메인 세션이 직접 독립 review-fix-loop 1회(§7).
4. 클러스터 완료 시 마일스톤 보고 + 메모리 갱신(§11).
5. 결정 상황 → 3인 위원회 자동결정(§6, AskUserQuestion 중단 금지).

### 5.1 kiwi-coder spawn 프롬프트 템플릿
`subagent_type="general-purpose"`, `model="opus"`. red/green 공통 골격, 차이는 2단계 지침:
```text
당신은 kiwi-coder 스킬을 실행하는 격리된 서브에이전트입니다.
## INPUTS
- PLAN_PATH=docs/plans/2026-06-17.speckiwi.v3-0-0.plan.md
- SIDECAR_PATH=docs/plans/2026-06-17.speckiwi.v3-0-0.sidecar.json
- RUN_ID=2026-06-17.speckiwi.v3-0-0
- TARGET=v3.0.0
- TASK_FILTER=<T-PHxxx-yy>
- CODE_PATH=C:\Work\git\_Snoworca\speckiwi
- MINI=false
- LIFECYCLE_BLOCKED_REQS=[]
- SPAWN_CONTEXT=pm-child
## 실행 지침
1단계: Skill(skill="kiwi-coder", args="PLAN_PATH=... SIDECAR_PATH=... TASK_FILTER=<task> RUN_ID=2026-06-17.speckiwi.v3-0-0") 로 실제 로드(추측/우회 금지).
2단계: 그 task 하나만 실행.
   - red(tdd.phase=red): SRS 의 해당 REQ AC 를 검증하는 실패 테스트 작성 + red(의도된 실패) 확인. 구현 금지.
   - green(tdd.phase=green): red 테스트를 최소 구현으로 green. 테스트 단언 약화 금지(구현을 테스트/명세에 맞춤).
     기존 함수/가드 보존. 회귀 비파괴. tsc --noEmit + eslint clean.
3단계: 중단 조건(모호성=clarification / 외부관찰가능 변경=business-decision / rollback 승인 / 복구불가=FAILED)
   발생 시 즉시 JSON 반환.
## 회귀 안정성 주의: protected(stable/verified/frozen/implemented+evidence) requirement 를 discard 하는 setup 은
   FR-NODE-019 가드에 막힘 → non-protected(evolving) 또는 override(reason+confirmDiscardVerified) 명시(§8).
## 절대 금지: plan.md 직접 수정 / 다음 Task 실행 / /snoworca-* / Mock 위장 / JSON 외 출력(첫 글자 {, 마지막 } , code fence 금지).
## 반환: { "status":"TASK_DONE|NEEDS_USER|FAILED", "task_id":"<task>", "coder_run_id":"<run>", "summary":"...", "completed_task_ids":["<task>"], "questions":[], "error":null }
```

### 5.2 task 결과 분기 (PM 행동)
| 반환 status | PM 행동 |
|---|---|
| **TASK_DONE** | pm-state 해당 task `status="done"` + result_summary + attempts++ + stats 재계산(§5.3). 다음 task 진행. |
| **NEEDS_USER** | worklog 기록 → **§6 위원회 자동결정**(AskUserQuestion 중단 금지). 결정 후 답변 주입해 재spawn(SendMessage 로 같은 에이전트 이어가기 가능). 동일 task 3회 누적 시 skip/blocked 판단. design-ambiguous(FR-NODE-042 류)면 `status="blocked"` + decision-*.md 기록. |
| **FAILED** | working-tree 점검(§12-6): 부분 산출물 있으면 정리. clean 이면 attempts++ 후 1회 재spawn. 또 FAILED 면 위원회/사용자 에스컬레이션. 인프라(rate-limit) 중단은 재spawn. |

### 5.3 pm-state done 갱신 one-liner (실행 셸: **Bash**)
```bash
node -e 'const fs=require("fs");const sp=".kiwi/sessions/2026-06-17.speckiwi.v3-0-0/pm-state.json";const s=JSON.parse(fs.readFileSync(sp,"utf8"));const now=new Date().toISOString();const t=s.tasks.find(x=>x.task_id==="T-PHxxx-yy");t.status="done";t.ended_at=now;if(!t.started_at)t.started_at=now;t.coder_run_id="2026-06-17.speckiwi.v3-0-0";t.result_summary="...";t.attempts=(t.attempts||0)+1;const st={total:s.tasks.length,done:0,running:0,pending:0,failed:0,blocked:0,skipped:0};s.tasks.forEach(x=>st[x.status]++);s.stats=st;s.last_updated_at=now;fs.writeFileSync(sp,JSON.stringify(s,null,1));console.log("done="+st.done);'
```
> plan.md 는 `#### §3.PHxxx.T-PHxxx-yy` 헤딩 형식이라 `- [ ]` 체크박스 없음 → 이 run 은 **pm-state.json 단독 추적**(kiwi-pm §6.1 폴백 b). 체크박스 갱신 시도 시 "패턴 미매칭" WARN 은 정상.

---

## 6. 표준 지침 (반드시 준수 — 사용자 standing directives)

1. **모든 사용자 결정 = 3인 위원회 자동결정.** 결정 상황(특히 cross-REQ/business-decision)에서 `AskUserQuestion` 으로 멈추지 말고, 3개 서브에이전트(독립 렌즈: 거버넌스정합 / 스펙충실·변경관리 / 구현·전방호환)를 병렬 spawn → 종합 → 메인이 타당성 최종 검증 → 자동 진행. 결정·근거는 `reports/decision-*.md` + worklog 기록. 진짜 사소·명백한 결정만 위원회 생략(권장-자동채택+사유). resume SHA mismatch 가 그 예(§0).
2. **TDD test-first 강제.** 동작 변경은 실패 테스트(red) 선행 → 최소 green → refactor. test-after 작성물은 폐기 후 재진행. 테스트를 구현에 맞춰 약화 금지(구현을 테스트/명세에 맞춤).
3. **검증은 독립 서브에이전트(자기검증 금지).** 코드 리뷰·수정 결과 검증은 본인이 직접 하지 않는다. review-fix-loop 의 리뷰어/fixer/recheck 는 전부 서브에이전트. **객관 사실(빌드/테스트 PASS-FAIL 카운트, "리뷰어 주장이 SRS AC·코드와 일치하는가"의 단순 대조)만 self 예외.** 해석·판단(finding 의 immediate_fix/discussion/rejected 분류, 수정의 적정성)이 갈리면 위원회 또는 독립 서브에이전트로 위임(§7 와 정합).
4. **커밋은 사용자가 명시 요청할 때만.** 현재 전부 미커밋. 커밋 시 main 아닌 branch(현재 `feat/3_0`)에서. **커밋 메시지에 어떤 시그니처도 금지**(Co-Authored-By / Generated by / 🤖 / [bot] 등). 제목에 Phase/Step/TASK 표식 금지.
5. **bulk-finalize / bulk-archive 금지.** 여러 REQ 를 per-REQ evidence·stability gate 없이 한 번에 verified 로 flip 하거나 Active Target 비우는 도구 도입/호출 금지. (정상 T-final §9.5 는 per-REQ gate 를 거치므로 이에 해당 안 함.)
6. **SRS 거버넌스**: requirement ID 수기 변경 금지, docs/spec 외 대체 요구사항 소스 금지, evidence 없이 verified 금지. **golden rule**: mutation(MCP add_trace_link/add_verification_evidence/update_status 등) 후 같은 srs.md 를 `Edit` 도구로 만지지 말 것(speckiwi mutation 이 line-patch 함).
7. **응답 언어 = 한국어.**

---

## 7. review-fix-loop cadence (품질 게이트)

**누가·언제**: **메인 세션(당신)이** 직접 호출한다. kiwi-pm 은 이를 자동으로 돌리지 않는다. **클러스터 경계 = 연속 5~6 REQ green 완료 시점.** 호출: `Skill(skill="kiwi-review-fix-loop")`(셀프 모드 기본) 또는 아래 절차를 직접 오케스트레이션, **해당 클러스터가 건드린 파일로 스코프 한정**(`--files=...` 또는 working-tree diff).

**절차**:
1. **Opus 까칠 리뷰어 서브에이전트**(7축: 정확성/보안/성능/에러처리/계약충실성/유지보수성/테스트품질) → findings JSON.
2. **사실 재검증(메인, 객관만)**: 리뷰어 주장을 SRS AC·코드와 **대조**(이건 §6.3 의 self 예외 = 단순 사실 확인). 분류 판단(immediate_fix/discussion_needed/rejected)이 애매하면 위원회/서브에이전트로 위임. discussion_needed(SRS 사안)는 `/kiwi-srs` 권고만(루프 범위 밖).
3. **시니어 fixer 서브에이전트**가 immediate_fix 를 TDD 로 수정.
4. **독립 recheck 리뷰어**(입력격리: fixer 정당화 미전달, 변경 diff + 원본 finding 만) → 해소·신규결함 검증.
5. PASS = CRITICAL=0 + HIGH=0. 결과 `reports/review-*.md` + worklog 기록.

> **왜 필수인가**: kiwi-coder 가 pm-child(서브에이전트) 컨텍스트에선 **중첩 Agent spawn 불가**(MCP 가용 여부 무관) → 자체 Sonnet×4 TDD 검증·까칠 리뷰가 inline 자가검증으로 **축소**된다. 메인 세션의 이 독립 리뷰가 그 갭을 메운다. 실제로 이 리뷰가 **CRITICAL cross-REQ 버그를 잡았다**(§9.4 FND-001 / §12-1).

---

## 8. 핵심 결정 선례 (재론 금지 / 패턴 참조)

- **ToolSpec registry = 전체 CLI 명령(~23)의 SSOT** (FR-ARCH-006). 각 entry {cliName 필수, mcpName 선택, kind, args, options, coreFn, resultExitMap}. MCP toolSchemas/toolNames = mcpName 보유 subset(17). CLI 전용 명령은 mcpName 없음. server.ts/CLI 트리/toolKinds/isReadOnlyTool 전부 registry 파생.
- **FR-NODE-019 discard 가드** (`reports/decision-T-PH003-06.md`): protected REQ(verified / frozen|stable / implemented+evidence) 의 discarded 전이는 `reason+confirmDiscardVerified=true` override 없이 MUTATION_DENIED. **테스트 선례**: discard 가 setup 일 뿐인 테스트는 protected stability 를 피하거나(per-test Stability→evolving) override 명시. 가드 자체·단언 약화 금지.
- **FR-NODE-042 reservation ledger** (`reports/decision-T-PH003-52.md`): §3.1 — SRS 미명시로 BLOCKED.
- **T-PH004-02** (`reports/decision-T-PH004-02.md`): CLI 관련 결정(상세는 문서 참조).

---

## 9. 알려진 이슈 / SRS follow-up / residual

### 9.1 SRS follow-up (코드 비차단, `/kiwi-srs` 정합화 권장)
- **FR-NODE-042 reservation provenance ledger** (§3.1) — 재개 진행을 막는 유일한 SRS 선행 작업.
- **semanticSha 정의 불일치 2건**:
  - (a) FND-002: FR-NODE-020 AC-2 의 open-DENY(={Status,Stability})가 Tags/Priority/Risk 등 휘발성 메타데이터를 해시에 포함 → contradiction-cache pin 이 행정 변경에 거짓 flip(보수적 over-invalidation, 안전측). 구현은 AC-2 준수.
  - (b) **SRS-MD-Rules §23.5 line 1108 ↔ FR-NODE-020**: §23.5 는 해시 입력에 "status+stability 포함"이라 서술하나 FR-NODE-020 구현/AC 는 제외. **한 정의로 통일 필요**.

### 9.2 status reconcile 지연 (중요)
kiwi-coder 의 per-task `update_status(in_progress)` 가 pm-child/CLI-fallback 제약으로 SRS 에 미반영 → `countsByStatus` 가 `implemented:16` 으로 실제(~84 REQ 구현)보다 낮음. **코드·테스트·trace/evidence 는 실재.** §9.5 T-final 또는 `kiwi-review-fix-loop --close-reqs` 에서 reconcile. **이번 세션에 MCP 재연결됨**(§10.1) → 남은 작업에서 per-task status 가 반영될 수 있으니, 재개 첫 task 후 `speckiwi active-target --json` 의 countsByStatus 변동을 확인.

### 9.3 회귀 baseline (사전존재, 우리 코드 무관 — 신규 회귀와 구별용)
```text
ALLOWED_FAIL (이 집합만 fail 이면 정상; 환경따라 stdio/EPERM flake 로 개수 ±1~2):
  test/smoke/package.test.ts            # package.json 2.2.4 vs lock 2.2.3 버전 drift + skill 파일 manifest (×3)
  test/release/release-readiness.test.ts# README 예시/문서 baseline
  test/mcp/stdio-purity.test.ts         # 실제 MCP 프로세스 spawn (샌드박스 환경의존, 간헐)
  test/mcp/stdio-update-stability.test.ts
  test/core/mutation/set-target-goal.test.ts  # Windows EPERM concurrent-rename flake (단독 pass)
```
**신규 회귀 판정 규칙**: 위 화이트리스트 **밖의 파일**(특히 `test/core/**`)에 새 fail 이 생기면 신규 회귀. baseline 개수는 보통 4~6.

### 9.4 latent review residual (non-blocking, follow-up — 상세는 `reports/review-*.md`)
- [PARSE] validateWorkspaceScoped real-rule body record 미narrow / parseStepState array+attached-props footgun / W041-W045·STEP_* defined-not-emitted.
- [NODE] **FND-001(CRITICAL, 수정완료)**: compatibility Notes writer 가 canonical §23.5 문법 위반 → A1 캐시 clean 도달불가였던 cross-REQ 버그(§12-1). / update-stability draft 가 conflicts_with-only(사전존재) / checked_compatible liveness write-time-only(향후 REQ 후보) / sha 세그먼트 구분자·hasEvidence reference-only(LOW).

### 9.5 종료(T-final) 절차 — 전체 task 완료 시
**per-REQ gate 를 거치므로 §6.5 bulk-finalize 금지에 해당하지 않는다.** 순서:
1. 전체 task `done`(blocked/pending 0) 확인.
2. kiwi-pm T-final: 모든 trace task 가 done 인 REQ 에 한해 `update_status(id, "implemented")` 일괄(forward-only) + `add_completed_work(date, summary, requirementIds, target, reportPaths)`.
3. (선택) `Skill(kiwi-review-fix-loop --close-reqs)`: 회귀 PASS + finding 0 전제로 영향 REQ `implemented→verified` + `add_verification_evidence(type=test)` (per-REQ, evidence 필수).
4. 보고서 작성 + (MCP 가용 시) doculight `open_markdown` 표시.
5. **커밋은 사용자 요청 시에만**(§6.4).

---

## 10. 환경 / 도구

### 10.1 MCP 가용성 (변경됨 — 중요)
- **이번 세션에서 speckiwi MCP + doculight MCP 가 재연결됨.** 새 세션도 MCP 가용일 가능성 높음.
- MCP 가용 시: `mcp__speckiwi__*`(get_active_target, list_requirements, update_status, add_trace_link, add_verification_evidence, add_completed_work, summarize_target 등) 직접 사용. 보고서 표시 = `mcp__doculight__open_markdown`.
- **단, kiwi-coder 는 pm-child 에서 중첩 Agent spawn 불가는 불변**(MCP 무관).
- **MCP 미가용 시 CLI fallback** (실행 셸: Bash):
  `node "C:/Users/beom/AppData/Roaming/npm/node_modules/speckiwi/bin/speckiwi" --root "C:/Work/git/_Snoworca/speckiwi" <cmd>`
  주요: `active-target --json`, `list --scope <S> --json`, `show <ID>`, `summary --json`.

### 10.2 경로 / 플랫폼 / 셸
- 작업 디렉토리: `C:\Work\git\_Snoworca\speckiwi` · 브랜치: `feat/3_0` · 플랫폼: Windows.
- git status: ~69 modified + ~139 untracked (대량 구현, 전부 미커밋).
- 빌드/테스트: `npx tsc --noEmit` / `npx eslint src test --max-warnings=0` / `npx vitest run`.
- **셸 주의**: 본 문서의 `node -e '...'` one-liner 들은 작은따옴표 안에 큰따옴표가 많아 **PowerShell 직접 실행 시 깨진다 → 반드시 Bash 도구로 실행**. (PowerShell 이 필요하면 스크립트를 `.mjs` 파일로 떼어 `node scripts/x.mjs` 호출.)

---

## 11. 산출물 맵 (audit trail)

```text
.kiwi/sessions/2026-06-17.speckiwi.v3-0-0/
├── pm-state.json            # ★ 진행 단일 권위 (166/206). running/blocked 여기서 확인.
├── state.json               # kiwi-coder 소유 보조 뷰(current_phase, 회귀 카운트). pm-state 와 충돌 시 pm-state 우선.
├── pm.lock                  # 동시실행 방지 (stale 시 §3.4 로 재획득)
├── worklog.jsonl            # 보조 이벤트 로그(append 누락·timestamp 역순 가능). pm-state 우선.
└── reports/
    ├── decision-T-PH003-06.md   # FR-NODE-019 discard 가드 위원회 결정
    ├── decision-T-PH003-52.md   # ⚠️ FR-NODE-042 BLOCKED (§3.1) — 재개 전 필독
    ├── decision-T-PH004-02.md   # CLI 관련 결정
    ├── review-PH003-mutation-core.md      # FR-NODE-017~022
    ├── review-PH003-steps-edit.md         # FR-NODE-023~028 (CRITICAL FND-001 잡은 리뷰)
    ├── review-PH003-node-029-034.md
    ├── review-PH003-node-035-040.md
    ├── review-PH003-node-041-046.md       # (FR-NODE-045 는 plan 부재로 제외 범위)
    ├── review-PH003-node-047-054.md
    ├── review-PH004-cli-028-037.md
    ├── review-PH004-cli-038-047.md
    └── review-PH004-cli-048-055.md

docs/plans/2026-06-17.speckiwi.v3-0-0.plan.md       # 계획 (Task 구조, SHA 일치)
docs/plans/2026-06-17.speckiwi.v3-0-0.sidecar.json  # Task↔REQ + TDD evidence (SHA 변동=evidence 기록, 양성)
docs/analysis/kiwi-planner-2026-06-17.speckiwi.v3-0-0/  # gen.mjs, reqs.json, code_context_*.json 등
```

**메모리(영속, 세션 간 유지)**: `C:\Users\beom\.claude\projects\C--Work-git--Snoworca-speckiwi\memory\`
- `v3-0-0-implementation-run.md` — 진행상태 + 결정 + residual SSOT.
- `decision-committee-auto-decide.md` — 3인 위원회 자동결정 지침(§6.1).

---

## 12. 교훈 / 함정 (이 프로젝트에서 실제로 겪음)

1. **격리 TDD 의 synthetic-fixture 갭**: 각 REQ 를 독립 fixture 로 red→green 하면, **writer-REQ 와 reader-REQ 가 같은 데이터에 서로 다른 계약을 갖는 cross-REQ 버그**를 놓친다(실제: FND-001 — addCompatibilityCheck writer 가 `self=…`(=,fpv없음) emit 하는데 listDirtyEdges reader 는 canonical `key: value`+fpv 요구 → A1 캐시 clean 영구 도달불가). **대책**: 클러스터 review 에서 **writer→reader 통합 테스트**를 요구하고 "synthetic 입력으로만 통과하는가"를 의심하라.
2. **discard 가드 테스트 setup**: protected stability fixture 를 discard 하는 테스트는 FR-NODE-019 가드에 막힌다 → setup Stability 를 evolving 으로 또는 override 명시(§8). 가드/단언 약화 금지.
3. **소스 NUL 바이트**: Map 키 구분자로 `\x00` 같은 NUL 을 넣으면 파일이 binary 로 인식돼 grep/diff 가 깨진다. 구분자는 `JSON.stringify([a,b])` 등 안전한 것으로.
4. **files[] over-declare 는 안전**: kiwi-coder 의 plan-code 일치 게이트는 `actual ⊆ declared`. green 이 sidecar files[] 중 일부만 건드려도 OK. 과소선언이 위험.
5. **canonical 문법은 SRS-MD-Rules 가 SSOT**: compatibility Notes 문법은 `docs/rule/SRS-MD-Rules-v3.0.0.md` §23.5(`key: value; ` + fpv/self/peer/checked-at). writer 는 이걸 따라야 한다.
6. **rate-limit/중단 복구**: 서브에이전트가 서버측 rate-limit 으로 죽으면(부분 실행) working-tree 를 확인해 부분 산출물 유무 보고 후 깨끗하면 fresh re-spawn. stale `running` task 는 §3.2/§3.4 로 pending 복구.

---

## 13. 첫 재개 액션 체크리스트

```text
[ ] pm-state.json 읽고 stats 확인 (done=166 이어야 함)
[ ] .kiwi/sessions/2026-06-17.speckiwi.v3-0-0/reports/decision-T-PH003-52.md 읽기 (FR-NODE-042 blocker 이해)
[ ] §3.4 one-liner 로: sidecar SHA 갱신(자동결정 A) + lock 재획득 + (비-auto면) T-PH005-12 running→pending
[ ] /kiwi-pm PLAN_PATH=docs/plans/2026-06-17.speckiwi.v3-0-0.plan.md --resume --auto 로 스킬 로드 (§0 1단계)
[ ] active-target --json 으로 현재 countsByStatus 확인 (reconcile 추적, §9.2)
[ ] T-PH005-12(FR-MCP-025) 부터 kiwi-coder spawn 재개 — 잔여 목록은 §4
[ ] task 결과는 §5.2 분기표대로 처리(TASK_DONE/NEEDS_USER/FAILED)
[ ] 연속 5~6 REQ 마다 메인이 직접 review-fix-loop (§7)
[ ] PH-005 완료 후 PH-006 FLOW 진행 (§4)
[ ] FR-NODE-042 는 §3.1 절차로 /kiwi-srs 정합화 별도 진행 — 강제 green 절대 금지
[ ] 전체 완료 시 §9.5 T-final 절차(per-REQ gate) + (사용자 요청 시에만) 커밋
```

---

*이 문서는 핸드오프 시점(2026-06-24) 상태를 반영한다. **진행 SSOT 는 pm-state.json** 이고, 이 문서는 그 위의 사람/AI 친화 요약이다. 불일치 시 pm-state.json 이 최종 권위(worklog/state.json 보다 우선).*
