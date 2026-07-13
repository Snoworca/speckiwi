---
name: kiwi-step
description: "Lightweight step-local SRS authoring skill. Claims the target step via claim_step (MCP-only) before authoring, writes requirement drafts only under docs/spec/steps/<name>/ (never into body-scope SRS files), and runs validate_step for step-local verification. Triggers — kiwi step, author step requirement, step-local authoring, claim step, kiwi-step, step SRS draft, /kiwi-step."
---

# kiwi-step v0.1

Lightweight skill for authoring **step-local requirement drafts** under `docs/spec/steps/<name>/`. It never edits body-scope SRS documents (`docs/spec/*.srs.md`); it claims the step first, writes only inside the step directory, and then validates the step locally. This is the lightweight counterpart of `kiwi-srs` (which authors body-scope requirements). A step is an isolated draft workspace that is later promoted into body scope.

---

## 0. Rules (SSOT)

| Key | Rule |
|---|---|
| §0.1 | **Claim first.** Before authoring any step-local requirement, claim the target step with `claim_step`. |
| §0.2 | **Step directory only.** Author requirements exclusively under `docs/spec/steps/<name>/<NN>.<slug>.srs.md`. Never write into body-scope SRS files (`docs/spec/*.srs.md`). |
| §0.3 | **Validate after authoring.** Run `validate_step` as part of the authoring workflow to check step-local integrity. |
| §0.4 | **MCP-only claim guard.** `claim_step` is an MCP-only tool (no CLI fallback). If the MCP server is unavailable the skill MUST halt immediately — there is no degraded path. |
| §0.5 | **No signatures / no changelog.** Never leave AI-identifying information in outputs or commits; this skill contains no changelog section. |
| §0.6 | **ID / heading rules.** Step requirements follow the SRS-MD Authoring Rules (heading / ID regex), identical to body-scope requirements even while still a draft. |
| §0.7 | `--mini` / `--loops N` accepted as a no-op. This skill has no verify/improve loop, so per `_shared/kiwi/loop-option.md` §5 it accepts them as a documented no-op (orchestration uniformity). |

---

## 1. Inputs / Outputs

- Input: the step `<name>` (ask the user if absent) and a requirement outline (statement + acceptance criteria draft).
- Output: requirement blocks under `docs/spec/steps/<name>/<NN>.<slug>.srs.md`, plus the `validate_step` result.

---

## 2. Phase flow

```
Phase 0 : Check MCP availability (halt if unavailable — §0.4)
Phase 1 : Claim the target step with claim_step before authoring (§0.1)
Phase 2 : Author only inside the step directory; never body-scope (§0.2)
Phase 3 : Run validate_step for step-local verification (§0.3)
```

### 2.1 Phase 0 — MCP availability
`claim_step` is MCP-only. If the MCP server is unavailable the skill halts (no CLI fallback exists, so there is no degraded path). Advise the user to check the MCP configuration, then stop.

### 2.2 Phase 1 — Claim
Claim the target step via `claim_step` before authoring — that is, complete the claim before writing any requirement. If the claim is rejected by the write-skew gate (STEP_DIRECT_CONFLICT / STEP_OVERLAP / STEP_SUPERSEDE_PROTECTED), report the reason and stop.

### 2.3 Phase 2 — Author (step directory only)
Write requirement blocks only under `docs/spec/steps/<name>/<NN>.<slug>.srs.md`. **Never write into body-scope SRS files** (`docs/spec/*.srs.md`); a step is a pre-promotion isolated workspace, so touching the canonical body documents directly is a governance violation. A file placed directly under `docs/spec/steps/` (without the `<name>/` subdirectory) is not a step file — it falls back to body scope — so always author under the `<name>/` path.

There is no MCP/CLI step-authoring tool. Author the step requirement by writing the file directly (Write/Edit) under `docs/spec/steps/<name>/<NN>.<slug>.srs.md`, following the SRS-MD ID/heading rules. Do NOT use `add_requirement` — it writes into body scope and would violate the step-only rule.

### 2.4 Phase 3 — Validate
Run `validate_step` (MCP tool, or CLI `speckiwi step validate <name>`) to verify step-local integrity. Fix and re-validate on error.

---

## 3. Pipeline position

```
kiwi-step (step-local draft authoring) → kiwi-srs-sync (promote / merge step → body)
```

This skill does not perform promotion. Step -> body promotion / merge is handled by the existing `kiwi-srs-sync` skill. The promotion mechanism that actually runs today is the `promote_step_requirement` MCP tool, which promotes a validated step requirement into body scope.

---

## 4. External dependencies

| Tool | Purpose | If absent |
|---|---|---|
| `claim_step` (MCP-only) | Claim the step §0.1 | halt (no CLI fallback) |
| `validate_step` (MCP / CLI `speckiwi step validate <name>`) | Step-local verification §0.3 | try CLI fallback, otherwise advise the user |

**No step-authoring tool.** There is no MCP/CLI tool that authors a step requirement. Write the `docs/spec/steps/<name>/<NN>.<slug>.srs.md` file directly with Write/Edit, following the SRS-MD ID/heading rules. Do NOT use `add_requirement` — it writes into body scope and would violate the step-only rule.
