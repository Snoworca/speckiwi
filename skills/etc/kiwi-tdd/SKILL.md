---
name: kiwi-tdd
description: "Orchestrates the step-scoped TDD First cycle of the tdd work-mode (opencode / hermes mirror) (acceptance lines → red tests → green implementation → regression → post-hoc SRS promotion). Verifies Mode: tdd (halt otherwise) → claims the step via claim_step → records EARS acceptance lines in intent.md `## Acceptance` and checks them with step validate (under --sds, authors design.md per SDS-MD Rules) → translates the acceptance lines into failing tests (red) → green without weakening tests → regression → synthesize + promote_step_requirement (verification evidence required). Triggers — kiwi tdd, tdd mode, TDD First, tdd step, /kiwi-tdd. Options — --sds (step SDS design.md — only when the user asks)."
---

# kiwi-tdd v0.1

Orchestration skill that drives one step through the **acceptance-first TDD First cycle** in the tdd work-mode. It extends the `kiwi-step` step-local authoring conventions with acceptance-line authoring (SDS design.md authoring under `--sds`), red/green discipline, and the post-hoc SRS promotion, as a single flow.

Backing requirements: FR-FLOW-037 · FR-FLOW-196 (acceptance contract FR-PARSE-042, SDS standard FR-FLOW-036, gates IR-CLI-072 / FR-NODE-072 / FR-NODE-074, synthesis FR-NODE-073).

## 핵심 규칙 — 컴팩션 뒤에도 남는 PRD 판정 (FR-FLOW-204 AC-10 AC-12)

이 블록은 아래 본문보다 앞선다. 판정할 PRD 는 `PRD_PATH` 로 받은 PRD 이고, 없으면 입력이 가리키는 `docs/prd/` 의 PRD 다. 둘 다 없으면 Phase 2 보다 먼저 `kiwi-prd` 를 불러 입력(작업 개요·연구 문서·이슈)을 `U-1` 의 원천으로 PRD 를 만들고 그 PRD 로 판정한다 — PRD 없이 acceptance 줄을 쓰는 경로는 없다. `--auto` 는 `kiwi-prd` 에 그대로 넘긴다. `Status` 행이 승인 값이 아닌 PRD 로는 판정하지 않고 `NEEDS_USER` 로 끝난다 — `--auto` 에서도 그렇게 끝나며 결정 위원회가 정하지 않는다(critical gate `prd-unapproved-user-decision`). 예외는 `kiwi-prd` 가 `--auto` 로 만든 PRD(`Status` 행이 `unapproved` 이고 승인 행에 `--auto` 가 적힌 PRD) 하나이며, 그 PRD 로 판정했으면 완료 보고에 `Status` 행 값을 그대로 싣는다.

Phase 2 에서 쓴 acceptance 줄은 Phase 3 에서 테스트로 옮기기 전에 그 PRD 로 판정한다. 줄마다 근거를 intent.md 의 설명 문단에 `AC-<n> ← PRD-<m>` 또는 `AC-<n> fills: PRD-<m> / <hole|contradiction|defect> / <reason>` 으로 적는다. (a) `intent` · `goal` · `in-scope` 항목을 근거로 인용한 줄이 없거나 그 항목과 반대로 말하는 줄이 있으면 fail 이고, 줄을 고쳐 다시 판정해 통과하기 전에는 Phase 3 으로 가지 않는다. `State` 가 `rejected` 인 항목은 이 fail 검사에서 빠진다. `Effect` 가 in-scope 인 확정 proposal 은 in-scope 항목처럼 이 fail 검사를 받는다. (b) 근거가 없거나 exclusion 항목에 걸리는 줄은 지우고 사유를 보고한다 — 필요하다는 주장이 메우는 구멍을 대지 못하면 지우지 않고 `NEEDS_USER` 로 멈춘다 — `--auto` 에서도 멈추며 결정 위원회가 정하지 않는다(critical gate `prd-residual-user-decision`). `State` 가 `rejected` 인 항목은 근거가 되지 못하므로, 거절된 항목만 인용한 줄도 지운다. `Effect` 가 exclusion 인 확정 proposal 은 exclusion 항목으로 작동하므로, 그 proposal 에 걸리는 줄도 지운다. (c) `fills:` 근거가 있는 줄만 메우기로 받아들이고, 항목 사이의 모순은 의도 항목에 맞는 쪽으로 직접 풀어 `kiwi-prd` 를 통해 PRD 에 `Reason` 이 `contradiction resolved:` 로 시작하는 proposal 로 기록한다 — 그 해소가 in-scope 항목을 없애거나 exclusion 을 좁혀도 그렇게 한다. 해소 proposal 은 확정되지 않은 채 `State` 를 바꾸지 않고, `State` 가 아니라 기록된 해소로서 효력을 가진다. 기록된 해소가 없앤 in-scope 항목은 (a) 의 fail 로 세지 않고, exclusion 을 좁힌 해소가 허용한 줄은 그 exclusion 항목에 걸리지 않는 것으로 보고 (b) 로 지우지 않는다. PRD 는 `kiwi-prd` 만 고친다. 요청에 관한 질문(`NEEDS_USER` 로 멈춘 질문 포함)에 사용자가 답하면 그 답을 쓰기 전에 `kiwi-prd` 를 통해 PRD 의 다음 `U-<n>` 으로 원문 그대로 덧붙인다(FR-FLOW-204 AC-11) — 답이 더한 범위는 그래야 PRD 에 근거를 갖는다.

---

## 0. Rules (SSOT)

| Key | Rule |
|---|---|
| §0.1 | **Mode check first.** Before starting, read the persisted work-mode with `speckiwi mode`. When it is not `Mode: tdd`, halt immediately and guide the user to either switch with `speckiwi mode tdd` or use the sdd workflow (kiwi-srs family). |
| §0.2 | **Claim first.** Never author any artifact (including intent.md and design.md) before claiming the step via `claim_step` (MCP preferred) or the CLI fallback `speckiwi step claim`. Halt immediately when both MCP and CLI are unavailable. A bug reproduction test a caller hands over (the §0.4 exception) was written by another skill before the claim, so it is not an artifact of this step; it is adopted after the claim, in §2.4. |
| §0.3 | **Step-directory confinement.** All spec artifacts are written only under `docs/spec/steps/<task>/`. Never edit body-scope SRS files (`docs/spec/*.srs.md`) — promotion happens only through the promote tool. |
| §0.4 | **Acceptance contract first.** No test is written before the step's acceptance contract exists — intent.md `## Acceptance` checked by `step validate`, or design.md under `--sds`. The moment tests are the only spec, the flow is exposed to reward hacking. Without an acceptance line `speckiwi step validate` stops the step with the error `STEP_ACCEPTANCE_MISSING`. **One exception**: a bug reproduction test a caller hands over (`kiwi-orchestrator` on R-STEP) is adopted as the test of the step's acceptance line after that line is written (§2.4). It came from the reported symptom and is cited only once the acceptance line exists, so the test is never the only spec. |
| §0.5 | **Tests are inviolable.** Commit tests first, and never weaken or edit a test during the green phase to make it pass. When the contract itself is wrong, go back to a revised acceptance line (a superseded SDS under `--sds`) and restart from red. |
| §0.6 | **No promotion without evidence.** `promote_step_requirement` promotes only blocks carrying at least one Verification Evidence entry (FR-NODE-074 hard-refuses in tdd mode). |
| §0.7 | **Boundary (sdd redirect).** Edits to existing body REQs and large / architecture changes are out of scope — redirect them to sdd mode (SRS-first — the `kiwi-srs` → `kiwi-pm` chain). |
| §0.8 | **No AI signatures anywhere / no changelog section in this skill.** |
| §0.9 | Accepts `--mini` / `--loops N` per the `_shared/kiwi/loop-option.md` convention. The only internal loop is red→green, so the round cap applies to regression-fix iterations only. |
| §0.10 | **Code traceability is post-promote and non-gating.** Restore the code Trace Links (`add_trace_link` Code anchor) and `@req` tags only after Phase 6 promote confirms the body REQ ID — never attach at Phase 2/4. The Code anchor is the **authoritative** traceability SSOT and the `@req` breadcrumb is **auxiliary**; both are **non-gating** (a missing or stale one never blocks promote and is **separate** from the FR-NODE-074 EVIDENCE_REQUIRED gate). Reuse the FR-FLOW-020 convention, and cite kiwi-coder §0.17 for tag format/exemption only (no operational-hook import). |
| §0.11 | **`--auto` option SSOT.** This skill follows `../_shared/kiwi/auto-option.md` v1.0. Its `critical_gates[]` are declared in §0.AG below — with the table declared, the shared safe default (`auto-option.md` §1) that leaves `--auto` **inactive** for this skill no longer applies. |
| §0.12 | **The step SDS is opt-in.** design.md is written only when the user passes `--sds` or asks for an SDS in words — without the opt-in the run writes no SDS and implements from none. The default contract is intent.md `## Acceptance` (§2.3). |

### §0.AG — `--auto` critical_gates[] declaration

Gates that force a user decision when `--auto` is active (SSOT: the `auto-option.md` §5 interface).
Each one halts **regardless of** `--auto` and cannot be routed to the decision committee:

| gate_id | reason | location |
|---|---|---|
| `step-claim-write-skew` | `claim_step` rejects on write skew — another step already holds a REQ this step touches, and two steps authoring one requirement is not auto-approvable | Phase 1 (§2.2) |
| `promote-evidence-required` | `promote_step_requirement` refuses with `EVIDENCE_REQUIRED` on zero verification evidence (§0.6) — a promotion with no evidence is a defect to fill, not a gate to bypass | Phase 6 (§2.7) |
| `step-completion-gate-blocked` | `update_step_state(merged)` refuses with `COMPLETION_GATE_BLOCKED` (FR-NODE-078) — acknowledging a non-clean compatibility edge is an irreversible judgement | Phase 7 (§2.8) |
| `test-sufficiency-gap` | citation gaps remain after the one fill attempt of the pre-promotion test-sufficiency check — a requirement whose gaps remain is not promoted (`_shared/kiwi/test-sufficiency.md`) | Phase 6 — before `promote_step_requirement` (§2.7) |
| `validate-spec-error` | `validate_spec` returns at least one error-severity diagnostic — evidence and promotion stacked on a requirement that carries an error cannot be read back to what admitted them | Phase 6 — before `promote_step_requirement` |
| `prd-residual-user-decision` | the PRD verdict (b) before Phase 3 leaves an acceptance line whose necessity claim names no hole it fills — the line is not deleted, the run stops `NEEDS_USER`, and under `--auto` the decision committee does not settle it (FR-FLOW-205) | core-rule block — before Phase 3 |
| `prd-unapproved-user-decision` | the PRD to judge against has a `Status` row other than the value `kiwi-prd` writes on approval and is not an `--auto` PRD (`Status` row `unapproved` with `--auto` in its approval row) — the run does not judge against it, stops `NEEDS_USER`, and under `--auto` the decision committee does not settle it (FR-FLOW-205) | core-rule block — before the PRD verdict |

**Where this gate is observed**: at the hop this row's third cell names, run MCP `validate_spec` — the CLI fallback is `speckiwi validate --json`. While any error-severity diagnostic remains, do not proceed with that hop: halt at `validate-spec-error`, which `--auto` does not lift. Never record a pass without having run it.

Until this table was declared, `auto-option.md` §1's **safe default** left `--auto` **inactive** for
this skill — a silent ignore rather than a failure, so an unattended run stopping at one of its own
gates was indistinguishable from a normal halt. The two paragraphs below draw that distinction.

**What `--auto` cannot resolve**: the gates above. They halt regardless of `--auto` and are
never handed to the decision committee.

**What `--auto` can resolve**: `sds-architecture-decision-approval` — raised only on a run that has an SDS (`--sds`). The Architecture-Decisions user approval of §2.3.1 checklist item 5 carries severity `business-decision`, so under `--auto` the decision committee resolves it automatically (escalated to critical below confidence 0.7). It is deliberately not critical: making it so would turn every SDS carrying a substantive decision into an unattended dead stop.

**The other two interaction points are omitted** because they cannot fire on a correctly dispatched
run — the Phase 0 mode halt (§2.1) fires only when the mode is not `tdd`, and the missing-task-name
query (§1.1) fires only when `<task>` is absent, and a routed dispatch discharges both in advance.

---

## 1. Input / Output

### 1.1 Input

| Signal | Meaning |
|---|---|
| task name `<task>` | Target step. Ask the user when absent. |
| work outline | The task description (research/intent). The PRD, not this outline, decides what to build — without `PRD_PATH`, `kiwi-prd` turns it into the PRD's `U-1` (core rule). intent.md is judged against that PRD. |
| `PRD_PATH` | The PRD to judge against. Given or not (without it `kiwi-prd` writes one first), the acceptance lines are judged against the PRD before they become tests (core rule). |
| `--review-hop-owned-by-parent` | The parent's **explicit** signal that it already owns the review of this step window. Skips the Phase 5.5 hop of its own (§2.6.1). |
| `--no-pipeline-emit` | Delegated-run marker. Suppresses the Phase 7 pipeline event (§2.8). |
| `--sds` | off — set only when the user wants a step SDS ("SDS 로", "SDS 써서", "SDS 를 써", "use SDS", "with an SDS"); the run then authors design.md per the SDS rules on the §2.3.1 path |

### 1.2 Output

- the `## Acceptance` section of `docs/spec/steps/<task>/intent.md` — EARS acceptance lines (checked by `step validate`)
- (`--sds` only) `docs/spec/steps/<task>/design.md` — the SDS (per SDS-MD Authoring Rules v2.6.0)
- red→green tests + implementation code
- `docs/spec/steps/<task>/<task>.srs.md` — synthesized step SRS
- the requirement block promoted into body scope (with evidence)

---

## 2. Phase flow

```
Phase 0 : mode + tool check (halt unless Mode: tdd; step CLI fallback when MCP is unavailable, halt when both are — §0.1/§0.2)
Phase 1 : claim the step via claim_step + set the Active Task
Phase 2 : record the acceptance lines — intent.md `## Acceptance` + step validate (under --sds, author the design.md SDS, §2.3.1)
Phase 3 : red — translate the acceptance lines (SDS-ACs under --sds) into failing tests, confirm failure, commit tests first
Phase 4 : green — pass with the smallest change, never weakening tests
Phase 5 : regression — full impacted tests + `speckiwi vibe-gate check`
Phase 5.5 : review hop — `kiwi-review-fix-loop` exactly once before promotion (skipped when `--review-hop-owned-by-parent` is passed)
Phase 6 : post-hoc SRS — synthesize → fold the acceptance lines (SDS-ACs under --sds) into the step SRS → test-sufficiency check → record evidence → promote_step_requirement → restore traceability (add_trace_link code/implements + @req reconcile, post-promote / non-gating, §0.10)
Phase 7 : update_step_state(merged) + report
```

### 2.1 Phase 0 — mode + MCP check

Read the current mode with the MCP `get_work_mode` tool (preferred when available) or the CLI `speckiwi mode`. When it is not `tdd`, **halt**: "The current mode is X. Switch with MCP `set_work_mode` (mode=tdd) or `speckiwi mode tdd` to run the TDD First cycle, or use the sdd workflow." When the MCP server is unavailable, fall back to the step CLI commands (`speckiwi step claim/scaffold/synthesize/promote`); halt immediately only when both MCP and the CLI are unavailable.

### 2.2 Phase 1 — claim

Claim the target step via `claim_step` (MCP preferred) or `speckiwi step claim <task> --touches-scope <scope> --touches-req <id>` (CLI fallback). When the write-skew gate refuses (same-REQ conflict etc.), report the reason and stop. After claiming, make sure the Active Task points at the target task while in `speckiwi mode tdd` (the vibe-gate checks this task).

### 2.3 Phase 2 — record the acceptance lines

Generate the empty intent.md stub with `speckiwi step scaffold <task>` (MCP `scaffold_step`; writeIfMissing — it never overwrites, and the stub is a skeleton only: the content is still authored directly). The default path does not create `design.md` and writes no skip record.

1. Write at least one EARS acceptance line in the `## Acceptance` section of `docs/spec/steps/<task>/intent.md` — `AC-<n>: WHEN … THE SYSTEM SHALL …`. The scaffold's `<…>` placeholder line is not an acceptance line — replace it with the real condition and behaviour.
2. Check with `speckiwi step validate <task>`. Go to Phase 3 only when it reports no `STEP_ACCEPTANCE_MISSING` — otherwise go back to step 1.

#### 2.3.1 `--sds` — author the step SDS (mandatory checklist)

Under `--sds`, also generate the design.md stub with `speckiwi step scaffold <task> --sds` (MCP `scaffold_step` with `sds: true`), then author `docs/spec/steps/<task>/design.md` per the SDS-MD Authoring Rules v2.6.0. **This checklist is mandatory and cannot be skipped**:

1. All seven required headings exist: Context & Scope / Goals / Non-goals / Architecture Decisions / Interfaces / Acceptance Contracts / Test Plan / Open Questions.
2. Acceptance Contracts use the **EARS** form (`SDS-AC-n: WHEN … THE SYSTEM SHALL …`).
3. **Every SDS-AC maps to at least one Test Plan row.**
4. Stay under the 200-line cap — split the task when the draft approaches it.
5. When Architecture Decisions carries a substantive decision, get user approval (agreed) before proceeding; otherwise proceed self-agreed.
6. Run `speckiwi step validate <task>` and confirm zero SDS advisories (SDS-W051..W053).

On this path the Phase 3 red tests cite `SDS-AC-<n>`, and the Phase 6 test-sufficiency check adds `--sds docs/spec/steps/<task>/design.md`.

### 2.4 Phase 3 — red

Translate each `AC-<n>` line of `## Acceptance` into a failing test whose title line cites `<task> AC-<n>` (at least one case per line; citation convention in `_shared/kiwi/test-sufficiency.md` §1). Under `--sds`, translate each SDS-AC of SDS §5 the same way, citing that `SDS-AC-<n>` on the title line. Run the tests and **confirm they fail (red)**, then commit the tests first. Never start implementation before red is confirmed.

**A reproduction test from the caller**: when the task overview carries a bug reproduction test, write the acceptance line that fixes that symptom first (Phase 2) and adopt that reproduction test as the line's test. Cite that `<task> AC-<n>` on the reproduction test's title line. Run it again and confirm it is still red. It is used instead of writing a new test for the same symptom.

### 2.5 Phase 4 — green

Make the tests pass with the smallest implementation, without touching the tests. Weakening a test because it is hard to pass is absolutely forbidden (§0.5) — when the contract is wrong, revise the acceptance line (supersede the SDS under `--sds`) and restart from red. During green, record the newly defined/edited **production file paths as the touched list** (Phase 6's traceability step cites these paths), and leave the FR-FLOW-020 vibe-style active step **task-name** trace tag as a breadcrumb on the code (no canonical REQ-ID yet — reconciled in Phase 6).

### 2.6 Phase 5 — regression

Run the full impacted existing test set and confirm zero regressions, then pass the step gate via `speckiwi vibe-gate check` — it checks the synthesized step directory and the step's acceptance contract (intent.md `## Acceptance`, design.md under `--sds`).

### 2.6.1 Phase 5.5 — review hop (before promotion, exactly once)

Review this step's commit window **before** promoting. `promote_step_requirement` is where the requirement is closed, so a review that runs after that has to overturn a verdict already on record.

```
Skill({ skill: "kiwi-review-fix-loop", args: "--base {step_window_base} --head {step_window_head} [--auto] [--max] [--mini | --loops N] [--model <name>] [--skip-clean-code | --keep-clean-code]" })
```

On a speed signal (`kiwi-review-fix-loop` 클린 코드 라운드 block), ask once in Phase 0 whether to skip the clean-code check (`--auto` skips it without asking). When the parent passed `--skip-clean-code` or `--keep-clean-code`, do not ask and add that flag to the args above unchanged; otherwise add `--skip-clean-code` when the user confirmed or `--keep-clean-code` when the user declined. This skill keeps no resume state file, so the answer is recorded by this hop's `kiwi-review-fix-loop` in its own `state.json` `clean_code_skip`. A run that received `--review-hop-owned-by-parent` does not ask — the review hop and its question belong to the parent.

Take the window from the commits this step made: `{step_window_base}` is the commit just before Phase 3 committed the tests first, and `{step_window_head}` is the current HEAD. Without an explicit range the review loop falls back to the last five commits and judges someone else's window.

Do not pass `--close-reqs` — promotion belongs to Phase 6, and this hop is that promotion's precondition rather than its judge. This hop does not modify the tests authored in the red phase (§0.5).

**There is exactly one condition for skipping it** — the parent passed `--review-hop-owned-by-parent` as an **explicit argument**. With that argument the parent already owns this window's review, so the skill does not run a hop of its own (`kiwi-orchestrator` §4.5, "exactly once"). Without it, never infer the entry path: always run the hop. A parent misread from the entry path is silent, and this hop then never happens at all.

The table below is the whole decision. The entry path, any trace of a parent and any earlier run are not inputs to it.

| Did the parent pass `--review-hop-owned-by-parent` as an explicit argument? | This skill's own hop |
| --- | --- |
| Yes | skip it |
| No | run it |

When the review hop ends in any status other than `TASK_DONE` (`NEEDS_USER` or `FAILED`), do not enter Phase 6 promotion — name the residual and remaining findings and stop.

### 2.7 Phase 6 — post-hoc SRS promotion

1. Synthesize the step SRS with `speckiwi step synthesize <task>` (MCP `synthesize_step_srs`; idempotent — a no-op when the step SRS already exists), then copy the intent.md `## Acceptance` lines in the same order and numbering into the requirement block's Acceptance Criteria (under `--sds`, carry the design.md SDS-ACs over). Once the block has its ID, append the `<REQ-ID> AC-<n>` citation to the title line of each Phase 3 test — a citation added to a title changes no assertion, so §0.5 is not touched, and the test that was red first becomes the evidence of the requirement AC.
2. **Test-sufficiency check (right before promotion)** — follow `_shared/kiwi/test-sufficiency.md` with the scope `--ids <the requirement block ID from step 1>` with `--sds` omitted (under `--sds`, add `--sds docs/spec/steps/<task>/design.md`). When gaps remain, halt at `test-sufficiency-gap` and do not promote.
3. Record the tests the tool cited for each AC (the Phase 3–5 tests and any the fill added) as Verification Evidence rows.
4. Promote into body scope via `promote_step_requirement` (MCP) or `speckiwi step promote <id> --from-step <task> --to-scope <scope>` (CLI fallback). **A block with zero verification evidence is refused with EVIDENCE_REQUIRED in tdd mode** — fill in the evidence and retry (no bypass).
5. **Traceability restoration (post-promote, non-gating, §0.10)** — apply only after promote confirms the body Requirement ID (never attach at Phase 2/4):
   - (a) Add the **authoritative Trace Links Code anchor** (traceability SSOT) on the promoted body requirement via `add_trace_link(type=code, relation=implements, reference=<Phase 4 touched production file>)`. One row per file when several were touched.
   - (b) Reconcile the Phase 4 production code's vibe-style **task-name** trace tag to the final promoted REQ-ID and leave it as the `@req <REQ-ID>` **auxiliary breadcrumb** — following the **FR-FLOW-020** convention, citing **kiwi-coder §0.17** for tag format/exemption only (single-line format, test-file exemption, placement; no operational-hook import).
   - (c) Both are **non-gating** — a missing or stale code Trace Link or `@req` never blocks promote and is separate from the EVIDENCE_REQUIRED gate (§0.10). Remember the Code anchor is **authoritative** and `@req` is the **auxiliary breadcrumb**.

### 2.8 Phase 7 — wrap-up

Transition the step to merged via `update_step_state` (CLI `speckiwi step update-state <task> --status merged`). **The merged transition must pass the completion gate (FR-NODE-078)** — when non-clean compatibility edges remain in the step's TouchesReq closure it is refused with COMPLETION_GATE_BLOCKED; resolve the contradictions (re-run the compatibility checks) or, after user confirmation, override explicitly with acknowledged. Then report the artifact paths, test results, and the promoted REQ id to the user.

**Pipeline emit (mandatory)**: right after the user report, append exactly one termination event per `_shared/kiwi/pipeline-event.md` v1.0.0 (idempotent on `run_id`). Take `next_hint` from the `kiwi-tdd` row of that file's §4 decision table. The fields and the emit procedure live in that SSOT and are not restated here. Do not append when the parent passed `--no-pipeline-emit` — a delegated unit's line pollutes the parent run's journal.


---

## 3. Boundary (sdd redirect)

Never run the following through this skill — stop on detection and point the user to sdd mode:

- **Edits to existing body REQs**: a step↔body same-REQ conflict only surfaces as MUTATION_DENIED at promote time, so send it to sdd before starting.
- **Large features / architecture changes**: acceptance lines that do not fit one step, or under `--sds` the SDS approaching the 200-line cap, are the signal — that is the zone where SRS-first (sdd) is faster and safer.

---

## 4. External dependencies

| Tool | Purpose | When absent |
|---|---|---|
| `get_work_mode` / `set_work_mode` (MCP, preferred) or `speckiwi mode` (CLI) | mode check/switch §0.1 | halt |
| `claim_step` (MCP preferred / CLI `speckiwi step claim`) | step claim §0.2 | halt when both are unavailable |
| `scaffold_step` (MCP / CLI `speckiwi step scaffold`) | intent stub generation §2.3 (the design.md stub too under `--sds`, §2.3.1) | copy the template manually |
| `speckiwi step validate` / `validate_step` | acceptance-line check (`STEP_ACCEPTANCE_MISSING`) §2.3, SDS advisories under `--sds` §2.3.1 | CLI fallback; when both are absent, run the checklist manually |
| `check_vibe_gate` (MCP) / `speckiwi vibe-gate check` (CLI) | synthesis/acceptance-contract gate §2.6 | guide the user |
| `synthesize_step_srs` (MCP / CLI `speckiwi step synthesize`) | step SRS synthesis §2.7 | curate the step SRS by hand |
| `check_test_sufficiency` (MCP) / `speckiwi coverage --tests` (CLI) | pre-promotion test-sufficiency check §2.7 (`_shared/kiwi/test-sufficiency.md`) | when both are absent the result is `gap` per contract §3 — do not promote |
| `promote_step_requirement` (MCP / CLI `speckiwi step promote`) | post-hoc SRS promotion §2.7 | halt when both are unavailable + never promote by hand |
| `add_trace_link` (MCP) | restore the code anchor on the promoted requirement §2.7 (non-gating) | skill continues — only traceability is missing, promote is never blocked |
