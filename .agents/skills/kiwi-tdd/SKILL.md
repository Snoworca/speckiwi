---
name: kiwi-tdd
description: "Orchestrates the step-scoped TDD First cycle of the tdd work-mode (SDS design.md → red tests → green implementation → regression → post-hoc SRS promotion). Verifies Mode: tdd (halt otherwise) → claims the step via claim_step → authors design.md per SDS-MD Rules (EARS SDS-AC) → translates SDS-ACs into failing tests (red) → green without weakening tests → regression → synthesize + promote_step_requirement (verification evidence required). Triggers — kiwi tdd, tdd mode, TDD First, tdd step, author SDS, /kiwi-tdd."
---

# kiwi-tdd v0.1

Orchestration skill that drives one step through the **SDS-first TDD First cycle** in the tdd work-mode. It extends the `kiwi-step` step-local authoring conventions with SDS (design.md) authoring, red/green discipline, and the post-hoc SRS promotion, as a single flow.

Backing requirements: FR-FLOW-037 (SDS standard FR-FLOW-036, gates IR-CLI-072 / FR-NODE-072 / FR-NODE-074, synthesis FR-NODE-073).

---

## 0. Rules (SSOT)

| Key | Rule |
|---|---|
| §0.1 | **Mode check first.** Before starting, read the persisted work-mode with `speckiwi mode`. When it is not `Mode: tdd`, halt immediately and guide the user to either switch with `speckiwi mode tdd` or use the sdd workflow (kiwi-srs family). |
| §0.2 | **Claim first.** Never author any artifact (including design.md) before claiming the step via `claim_step` (MCP preferred) or the CLI fallback `speckiwi step claim`. Halt immediately when both MCP and CLI are unavailable. |
| §0.3 | **Step-directory confinement.** All spec artifacts are written only under `docs/spec/steps/<task>/`. Never edit body-scope SRS files (`docs/spec/*.srs.md`) — promotion happens only through the promote tool. |
| §0.4 | **SDS before tests.** Never write tests before the SDS (design.md) exists — the moment tests are the only spec, the flow is exposed to reward hacking. |
| §0.5 | **Tests are inviolable.** Commit tests first, and never weaken or edit a test during the green phase to make it pass. When the contract itself is wrong, supersede the SDS and restart from red. |
| §0.6 | **No promotion without evidence.** `promote_step_requirement` promotes only blocks carrying at least one Verification Evidence entry (FR-NODE-074 hard-refuses in tdd mode). |
| §0.7 | **Boundary (sdd redirect).** Edits to existing body REQs and large / architecture changes are out of scope — redirect them to sdd mode (SRS-first, kiwi-srs / kiwi-planner family). |
| §0.8 | **No AI signatures anywhere / no changelog section in this skill.** |
| §0.9 | Accepts `--mini` / `--loops N` per the `_shared/kiwi/loop-option.md` convention. The only internal loop is red→green, so the round cap applies to regression-fix iterations only. |

---

## 1. Input / Output

### 1.1 Input

| Signal | Meaning |
|---|---|
| task name `<task>` | Target step. Ask the user when absent. |
| work outline | What to build (research/intent). Source of intent.md. |

### 1.2 Output

- `docs/spec/steps/<task>/design.md` — the SDS (per SDS-MD Authoring Rules v1.0.0)
- red→green tests + implementation code
- `docs/spec/steps/<task>/<task>.srs.md` — synthesized step SRS
- the requirement block promoted into body scope (with evidence)

---

## 2. Phase flow

```
Phase 0 : mode + tool check (halt unless Mode: tdd; step CLI fallback when MCP is unavailable, halt when both are — §0.1/§0.2)
Phase 1 : claim the step via claim_step + set the Active Task
Phase 2 : author the SDS — design.md (mandatory checklist, §3)
Phase 3 : red — translate SDS-ACs into failing tests, confirm failure, commit tests first
Phase 4 : green — pass with the smallest change, never weakening tests
Phase 5 : regression — full impacted tests + `speckiwi vibe-gate check`
Phase 6 : post-hoc SRS — synthesize → fold SDS-ACs and evidence into the step SRS → promote_step_requirement
Phase 7 : update_step_state(merged) + report
```

### 2.1 Phase 0 — mode + MCP check

Read the current mode with the MCP `get_work_mode` tool (preferred when available) or the CLI `speckiwi mode`. When it is not `tdd`, **halt**: "The current mode is X. Switch with MCP `set_work_mode` (mode=tdd) or `speckiwi mode tdd` to run the TDD First cycle, or use the sdd workflow." When the MCP server is unavailable, fall back to the step CLI commands (`speckiwi step claim/scaffold/synthesize/promote`); halt immediately only when both MCP and the CLI are unavailable.

### 2.2 Phase 1 — claim

Claim the target step via `claim_step` (MCP preferred) or `speckiwi step claim <task> --touches-scope <scope> --touches-req <id>` (CLI fallback). When the write-skew gate refuses (same-REQ conflict etc.), report the reason and stop. After claiming, make sure the Active Task points at the target task while in `speckiwi mode tdd` (the vibe-gate checks this task).

### 2.3 Phase 2 — author the SDS (mandatory checklist)

Generate the empty design.md/intent.md stubs with `speckiwi step scaffold <task>` (MCP `scaffold_step`; writeIfMissing — it never overwrites, and the stubs are skeletons only: the content is still authored directly), then author `docs/spec/steps/<task>/design.md` per the SDS-MD Authoring Rules v1.0.0. **This checklist is mandatory and cannot be skipped**:

1. **Skip-gate first**: is this a trivial change with no trade-off? Then skip the SDS and record only an EARS stub (one to three SDS-AC statements) in intent.md, then go to Phase 3.
2. All seven required headings exist: Context & Scope / Goals / Non-goals / Architecture Decisions / Interfaces / Acceptance Contracts / Test Plan / Open Questions.
3. Acceptance Contracts use the **EARS** form (`SDS-AC-n: WHEN … THE SYSTEM SHALL …`).
4. **Every SDS-AC maps to at least one Test Plan row.**
5. Stay under the 200-line cap — split the task when the draft approaches it.
6. When Architecture Decisions carries a substantive decision, get user approval (agreed) before proceeding; otherwise proceed self-agreed.
7. Run `speckiwi step validate <task>` and confirm zero SDS advisories (SDS-W050..W053).

### 2.4 Phase 3 — red

Translate each SDS-AC of SDS §5 into a failing test (at least one case per SDS-AC). Run the tests and **confirm they fail (red)**, then commit the tests first. Never start implementation before red is confirmed.

### 2.5 Phase 4 — green

Make the tests pass with the smallest implementation, without touching the tests. Weakening a test because it is hard to pass is absolutely forbidden (§0.5) — when the contract is wrong, supersede the SDS and restart from red.

### 2.6 Phase 5 — regression

Run the full impacted existing test set and confirm zero regressions, then pass the step gate (synthesis + design.md) via `speckiwi vibe-gate check`.

### 2.7 Phase 6 — post-hoc SRS promotion

1. Synthesize the step SRS with `speckiwi step synthesize <task>` (MCP `synthesize_step_srs`; idempotent — a no-op when the step SRS already exists), then carry the design.md SDS-ACs over as the requirement block's Acceptance Criteria and record the Phase 3–5 tests as Verification Evidence rows.
2. Promote into body scope via `promote_step_requirement` (MCP) or `speckiwi step promote <id> --from-step <task> --to-scope <scope>` (CLI fallback). **A block with zero verification evidence is refused with EVIDENCE_REQUIRED in tdd mode** — fill in the evidence and retry (no bypass).

### 2.8 Phase 7 — wrap-up

Transition the step to merged via `update_step_state` (CLI `speckiwi step update-state <task> --status merged`). **The merged transition must pass the completion gate (FR-NODE-078)** — when non-clean compatibility edges remain in the step's TouchesReq closure it is refused with COMPLETION_GATE_BLOCKED; resolve the contradictions (re-run the compatibility checks) or, after user confirmation, override explicitly with acknowledged. Then report the artifact paths, test results, and the promoted REQ id to the user.

---

## 3. Boundary (sdd redirect)

Never run the following through this skill — stop on detection and point the user to sdd mode:

- **Edits to existing body REQs**: a step↔body same-REQ conflict only surfaces as MUTATION_DENIED at promote time, so send it to sdd before starting.
- **Large features / architecture changes**: the SDS approaching the 200-line cap is the signal — that is the zone where SRS-first (sdd) is faster and safer.

---

## 4. External dependencies

| Tool | Purpose | When absent |
|---|---|---|
| `get_work_mode` / `set_work_mode` (MCP, preferred) or `speckiwi mode` (CLI) | mode check/switch §0.1 | halt |
| `claim_step` (MCP preferred / CLI `speckiwi step claim`) | step claim §0.2 | halt when both are unavailable |
| `scaffold_step` (MCP / CLI `speckiwi step scaffold`) | SDS/intent stub generation §2.3 | copy the template manually |
| `speckiwi step validate` / `validate_step` | SDS advisory validation §2.3 | CLI fallback; when both are absent, run the checklist manually |
| `check_vibe_gate` (MCP) / `speckiwi vibe-gate check` (CLI) | synthesis/SDS presence gate §2.6 | guide the user |
| `synthesize_step_srs` (MCP / CLI `speckiwi step synthesize`) | step SRS synthesis §2.7 | curate the step SRS by hand |
| `promote_step_requirement` (MCP / CLI `speckiwi step promote`) | post-hoc SRS promotion §2.7 | halt when both are unavailable + never promote by hand |
