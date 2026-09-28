---
name: kiwi-sds
description: "Authors one ultra-light Software Design Spec (the lite profile of the SDS rules) at `docs/sds/<sds-id>.sds.md` for the requirements about to be implemented, checks it with the deterministic `speckiwi sds check` (MCP `check_sds`) and self-agrees it. The SDS is written for coding agents (English, no narrative) and has no user approval gate. The default mode runs no LLM verification loop; `--max` adds exactly one independent verifier pass. `--close <sds-id>` moves the SDS's interpretation decisions into the SRS as acceptance-criterion clarifications and deletes the file after promotion. Triggers — kiwi sds, author SDS, design spec, lite SDS, sds close, SDS close-out, $kiwi-sds. Options — --req-filter, --sds-id, --convergence-registry, --existing-modules, --close, --auto, --max, --mini / --loops N, --model, --no-pipeline-emit."
---
> Kiwi MCP rule: normal target-scoped SRS reads, mutations, validation, status/stability updates, acceptance-criteria changes, evidence, trace links, and completed-work logging require working `speckiwi mcp`. CLI is diagnostic/remediation only and is not a normal replacement for MCP mutations.
# kiwi-sds v0.1

The design stage of the sdd chain `kiwi-srs → (kiwi-srs-feasibility) → kiwi-sds → kiwi-pm → kiwi-review-fix-loop`. It writes one lite SDS for the requirements in scope, checks it deterministically and agrees it itself. Once the code is implemented, `--close` closes the SDS — what must survive moves into the SRS and the file is deleted.

Backing requirements: FR-FLOW-182 (authoring), FR-FLOW-183 (close-out), FR-FLOW-184 (chain).

**SDS grammar SSOT**: `docs/rule/SDS-MD-Rules-v2.6.0.md` §9 (Lite Profile). This skill does not restate the grammar — location, metadata, sections, line grammar, the 100-line cap and the diagnostic codes are all that section's. Authoring starts from its §9.7 template.

## Official Workflow Tool Policy

The normal path for workflow status reads, next-work selection and event recording is MCP `workflow_pipeline_tail`, `workflow_pipeline_status`, `get_next_work_order`, `workflow_pipeline_emit`, or the equivalent `speckiwi workflow ...` CLI. Raw file append/read is allowed only in degraded mode, and must record capturing tool diagnostics, affected artifact paths, active target, and follow-up requirement or candidate ID in the user report and the pipeline notes.

---

## 0. Rules (SSOT)

| Key | Rule |
|---|---|
| §0.1 | **The SDS is written for coding agents.** Write it in English with no narrative prose — every line either declares something a checker reads or states a contract. People read the SRS. |
| §0.2 | **The check is deterministic.** Check the SDS with MCP `check_sds` (CLI `speckiwi sds check <path> --json` only when MCP is unavailable). While any error remains, do not set Status to `agreed`. |
| §0.3 | **The default mode runs no LLM verification loop.** `--max` adds exactly one independent verifier pass — a pass, not a loop (§2.5). |
| §0.4 | **There is no user approval gate.** Once the check passes, kiwi-sds sets Status to `agreed` itself. Never ask the user to review or approve the SDS before implementation. A substantive design question that needs the user is raised as a question, not as an SDS review; under `--auto` the decision committee of `../_shared/kiwi/auto-option.md` decides it. |
| §0.5 | **The SDS is disposable.** It lives for one run. A closed (`closed`) or deleted SDS is never read as the current design — the current design is the code. No permanent SDS-to-code drift gate exists; SDS-to-code checks run only inside the run. |
| §0.6 | **The SRS is written only by `--close`**, through guarded MCP mutations (`replace_acceptance_criteria`, `add_requirement`). Authoring never writes the SRS. This skill changes no requirement status and never writes `verified`. |
| §0.7 | **No AI signatures anywhere / no changelog section in this skill.** |
| §0.8 | **`--auto` option SSOT.** This skill follows `../_shared/kiwi/auto-option.md` v1.0. Its `critical_gates[]` are declared in §0.AG. |
| §0.9 | **`--mini` / `--loops N` option SSOT.** Follows `../_shared/kiwi/loop-option.md` v1.0. A round of this skill is one "check → fix errors → re-check" cycle of §2.4. Default cap 5, `--mini` 3, `--loops N` N (`--loops` wins when both are given, with a warning). Orthogonal to the one verifier pass of `--max`. |

### §0.AG — `--auto` critical_gates[] declaration

Each gate below halts **regardless of** `--auto` for a user decision and is never handed to the decision committee.

| gate_id | reason | location |
|---|---|---|
| `sds-check-errors-unresolved` | `check_sds` errors remain at the round cap — an SDS carrying an error cannot become `agreed`, and kiwi-pm accepts no SDS that is not `agreed` | §2.4 |
| `sds-close-after-promotion` | a requirement whose interpretation `--close` must move into the SRS is already `verified` — moving after promotion would silently edit a closed requirement, so it is not done | §3.1 step 3 |
| `validate-spec-error` | `validate_spec` returns at least one error-severity diagnostic — the moved clarification broke the SRS | §3.1 step 6 — after the SRS is written |
| `stability-frozen-violation` | a requirement whose AC `--close` must clarify has Stability `frozen` — a frozen requirement's body is not changed on this path | §3.1 step 3 — before any SRS write |

**Where `validate-spec-error` is observed**: at the hop this row's third cell names, run MCP `validate_spec` — the CLI fallback is `speckiwi validate --json`. While any error-severity diagnostic remains, do not proceed with that hop: halt at `validate-spec-error`, which `--auto` does not lift. Never record a pass without having run it.

**What `--auto` resolves**: a substantive design question (§0.4) — severity `business-decision`, so the decision committee decides it (escalated to critical below confidence 0.7). A draft requirement left out of the scope (§2.1) is a report item, not a gate.

---

## 1. Input / Output

### 1.1 Input

| Input | Meaning | Default |
|---|---|---|
| `TARGET` (positional) | the target of the scope | MCP `get_active_target` |
| `--req-filter <REQ-ID,...>` | narrows the scope to these requirements | every open requirement of the target |
| `--sds-id <id>` | the SDS identifier — the file is `docs/sds/<sds-id>.sds.md`; lowercase letters, digits, `.` and `-` only, 4 to 128 characters — the same rule as `kiwi-pm` §0.14's session id | `<target>-<slug>` (the slug is the work's gist in kebab-case) |
| `--convergence-registry <path>` | for a wave SDS: paths whose recipe in this registry is `regenerate` or `orchestrator-only` are not written into Files or the Test Plan (§2.3) | none — no path is excluded |
| `--existing-modules <path>` | the wave design-baseline JSON — the `existing_modules` of the entry of the wave `TARGET` names (`wave-{n}`) are read; the baseline is keyed per wave, so no other wave's modules are read (§2.2, FR-FLOW-063 AC-7) | none |
| `--close <sds-id>` | close-out mode (§3) | off |
| `--auto` · `--max` · `--mini` / `--loops N` · `--model <name>` | §0.8 · §0.3 · §0.9 · the verifier subagent's model | off / current session model |
| `--no-pipeline-emit` | delegated-run marker — no pipeline event is appended (§2.6) | off |

R-ORCH and kiwi-wave-master pass, for every wave, `--sds-id {run_id}-wave-{n}`, that wave's `--req-filter`, the run's `--convergence-registry`, and that wave's design baseline as `--existing-modules`.

### 1.2 Output

- `docs/sds/<sds-id>.sds.md` — one lite SDS. Past the cap, several files `docs/sds/<sds-id>-<k>.sds.md` (k = 1, 2, …) (§2.3).
- One pipeline event (§2.6).

---

## 2. Authoring flow

```
Phase 0 : fix the scope + check for a file with the same sds-id
Phase 1 : read the requirement ACs and the relevant code
Phase 2 : write the draft (§9.7 template)
Phase 3 : deterministic check — until errors reach 0 (round cap §0.9)
Phase 4 : (only under --max) one independent verifier pass
Phase 5 : Status agreed + report + event
```

### 2.1 Phase 0 — Scope

1. Resolve the target (`TARGET` or `get_active_target`).
2. Read the target's requirements with `list_requirements`. The scope is every requirement whose status is neither `verified` nor `discarded`.
3. When the input carries a requirement filter, narrow the scope to its IDs (`--req-filter`).
4. Leave requirements whose Stability is `draft` or `deprecated` **out of the scope** and report them (FR-FLOW-053 AC-1) — a design exists to be implemented, and the pre-implementation stability gate is kiwi-srs-feasibility's.
5. When the scope is empty, write no SDS and report so.
6. When `docs/sds/<sds-id>.sds.md` or a split file `docs/sds/<sds-id>-<k>.sds.md` already exists, that SDS's Status decides (per file for split files):

| Existing SDS `Status` | Handling |
|---|---|
| `agreed` | **Do not rewrite it** — run only the Phase 3 check and reuse it when it passes (a resume never re-authors the SDS, FR-FLOW-064 AC-4) |
| `draft` | continue writing it |
| `closed` | do not write it — a closed SDS is not the current design (§0.5). Report that a new `--sds-id` is needed |

When split files carry mixed Status values (for example `closed` and `agreed`), write nothing and report their states.

### 2.2 Phase 1 — Read

Read every in-scope requirement's ACs with `get_requirement`. Read the relevant code so the paths and symbols the SDS names match the repository's real modules — never re-create a module that already exists. With `--existing-modules`, read the `existing_modules` of the entry of the wave `TARGET` names in that JSON; the Interfaces never re-create or rename a module listed there — that list is what the wave verification holds the result to.

### 2.3 Phase 2 — Write

Copy the §9.7 template of `docs/rule/SDS-MD-Rules-v2.6.0.md` to `docs/sds/<sds-id>.sds.md` and fill it. The metadata is `Document Type` = `sds`, `Profile` = `lite`, `Target`, `Status` = `draft`, `Date`, `Requirements` = the §2.1 scope IDs (a split file lists the IDs it covers); the sections are `## Interfaces` (a `### Depends` chain and a `### Files` list of paths, signatures and one-line responsibilities), `## Acceptance Contracts` and `## Test Plan`. The line grammar is §9.4's. Authoring rules:

1. Name **every in-scope requirement ID** with `@req` on at least one Files or symbol line. The same IDs go into the `Requirements` row, so a missing one is the error `SDS-E070` (§9.2).
2. Write every decision that interprets an SRS AC as one contract line `SDS-AC-n (<REQ-ID> AC-m): WHEN … THE SYSTEM SHALL …`. Do not write a contract that only repeats what the AC already fixes.
3. Give **every SDS-AC** a Test Plan row naming a test file. That test cites `SDS-AC-<n>` on its test line (`../_shared/kiwi/test-sufficiency.md` §1).
4. Keep within the **100-line cap** (§9.5). When the work does not fit one file, never grow the SDS — **split** it into one file per work unit: `docs/sds/<sds-id>-<k>.sds.md`. Each split file keeps every rule here, and every in-scope requirement ID appears with `@req` somewhere across the split files.
5. List only **structural rules** the code must keep after the run (module boundaries, dependency direction, forbidden couplings) in a `## Durable Rules` section, one line each: `- <rule> — <why it must outlive this run>`. §9.3 allows this unread section and `sds check` does not read it. Only rules written there are raised into the SRS by §3.1 — every other structural note is discarded with the SDS.
6. **When `--convergence-registry` is given** (a wave SDS), write no path whose recipe in that registry is `regenerate` or `orchestrator-only` — shared hot files such as indexes, registration arrays, README, skill mirrors and generated artifacts — into Files or the Test Plan. The registry's location, shape, path matching and precedence are defined by the convergence-registry sections of `../_shared/kiwi/run-ledger.md`. Those paths must stay out of the worker write set (Files ∪ Test Plan files) for the disjointness test between waves to hold, and the host handles them after the merge.

Raise a substantive design choice that needs the user here, as a question (§0.4). There is no step that shows the SDS for approval.

### 2.4 Phase 3 — Deterministic check

1. Call `check_sds` on every file written (`speckiwi sds check docs/sds/<sds-id>.sds.md --json` when MCP is unavailable).
2. Fix every error and check again. One check → fix → re-check is one round, capped by §0.9.
3. An in-scope requirement ID missing from every `@req` is the error `SDS-E070`, because of the `Requirements` row — fix it like any other error. `SDS-E070` looks at one file at a time, so for a split SDS confirm from the check summaries that the union of the pieces' `Requirements` rows equals the §2.1 scope, and put a missing ID into the piece that covers it.
4. When errors remain at the cap, halt at `sds-check-errors-unresolved` — Status stays `draft`.

Report warnings.

### 2.5 Phase 4 — One independent verifier pass (`--max` only)

Without `--max`, skip this phase. Under `--max`, run **exactly one** independent verifier subagent once (current session model, overridden by `--model <name>`). Its input is the SDS file, the in-scope requirements' AC text and repository paths, never the author's justification. It returns, with severities, SDS-ACs that misread an AC, missing contracts, and paths or symbols that do not match the code. The author applies CRITICAL and HIGH findings once and re-runs the Phase 3 check. There is no second verification pass — the remaining findings go into the report.

### 2.6 Phase 5 — Agreement, report, event

1. With zero check errors, set the metadata Status to `agreed`. That is the agreement (§0.4).
2. Report the files written, the scope, the requirements left out of it, the remaining warnings and the `--max` verifier's remaining findings.
3. **Pipeline emit (mandatory)**: append exactly one closing event per `../_shared/kiwi/pipeline-event.md` v1.0.0 — `skill` = `kiwi-sds`, `next_hint` = `kiwi-pm`, `artifacts.sds_files` = every file written. The normal path is MCP `workflow_pipeline_emit`; the hand-written append of §5.1 of that document is the **degraded fallback** for when the tool cannot be used (the event's location is set by §1 of the same document). A delegated run that received `--no-pipeline-emit` appends nothing.
4. The event's `run_id` is the sds-id. A **re-entry** run called again with the same sds-id emits under the key `{run_id}#r{n}` (`../_shared/kiwi/pipeline-event.md` §5.4), and a re-entry emit is never skipped because an event with the same `run_id` already exists.

---

## 3. Close-out — `--close <sds-id>`

Closes an implemented SDS. It is **idempotent** and is called twice: once **before** the SDS's requirements are promoted (move, §3.1) and once **after** (delete, §3.2). Each call does the next step the SDS's state allows.

Start by reading the summary of `docs/sds/<sds-id>.sds.md` (the contracts with their `(<REQ-ID> AC-m)`, the `@req` set) with MCP `check_sds`. When `<sds-id>.sds.md` does not exist but split files `<sds-id>-<k>.sds.md` do, run this section for each split file in k order. Only when neither exists is the SDS already closed — do nothing and report so. When Status is `closed`, go to §3.2.

### 3.1 Move — before promotion

1. For every contract, decide whether it **interprets** its `(<REQ-ID> AC-m)` — it does when it fixes a value, boundary, error form or order the AC left open. A contract that only repeats the AC is not moved.
2. Read the requirement of every interpreting contract with `get_requirement`.
3. Check all those requirements before writing any SRS text — halt at `sds-close-after-promotion` when one has status `verified`, or at `stability-frozen-violation` when one has Stability `frozen`, and write the SRS for none of this SDS's requirements. The user chooses one of two: move that requirement down to `implemented` by the repository's procedure, call `--close` again, then return it to `verified` (for a frozen one, lift the stability first), or record the unmoved decisions in the report and set Status to `closed` so §3.2 runs.
4. For every interpreting contract, **clarify** AC-m: keep every word of the existing AC-m sentence and append the decision to it. A sentence that drops a condition, weakens a SHALL or narrows what the AC requires is a weakening and is never written. Write a requirement's clarifications in one `replace_acceptance_criteria({ id, items, dryRun })` call — `items` carries **every** AC of that requirement in its current order with its current `checked` value, and only AC-m's `text` changes (a changed order repoints AC numbers and evidence rows). Run it with `dryRun: true` first, confirm that only AC-m changes, then apply it. When AC-m already carries the decision, do not append it again.
5. For every rule under `## Durable Rules`, raise a **constraint requirement** with `add_requirement({ type, scope, target, title, requirement, acceptanceCriteria, rationale, dryRun })` — `type` is `constraint`, `target` is the SDS's Target, `scope` is the scope of the requirements the rule binds, and `rationale` names this SDS's id. When the scope is split, ask (the committee under `--auto`). A structural rule not listed under `## Durable Rules` is not moved.
6. When any SRS text was written, run `validate_spec` — an error-severity diagnostic halts at `validate-spec-error` (§0.AG).
7. Set the SDS metadata Status to `closed`. From here on this SDS is not the current design (§0.5). The file stays until §3.2 — the test-sufficiency check right before promotion reads its Test Plan.

### 3.2 Delete — after promotion

1. Read the status of every requirement of the `@req` set with `get_requirement`.
2. When all are `verified` or `discarded`, **delete** the SDS file from the working tree (`git rm <path>` when git tracks it). The caller's close-out commit carries the deletion (a caller that does not commit reports that), and git history keeps the file's content.
3. Otherwise keep the file and report the requirements not yet promoted.

### 3.3 Event

A `--close` run also appends one event as in §2.6 step 3 (omitted under `--no-pipeline-emit`). Its `run_id` is `<sds-id>-close`, and the second call is a re-entry of that run, so it emits under the `{run_id}#r{n}` key of §2.6 step 4. It sets its own `next_hint`: `kiwi-review-fix-loop` when any file was kept, `kiwi-commit-auto-push` when all were deleted — so this last event does not hide the next step the review hop's event recommended. The `kiwi-pipeline` cycle does not chain that recommendation itself (its §2.5).

### 3.4 Call order

| Caller | Move (§3.1) | Delete (§3.2) |
|---|---|---|
| `kiwi-pipeline` | after `kiwi-pm`, **before** the `kiwi-review-fix-loop --close-reqs` hop — that hop promotes | after that hop and the test-sufficiency check |
| `kiwi-orchestrator` · `kiwi-wave-master` (`../_shared/kiwi/parallel-waves.md`) | after the test-sufficiency check, before the promotion step | after promotion |
| `kiwi-pm` standalone (without `--no-final` or `--review-hop-owned-by-parent`) | in its §6.4 hand-off, **before** the `kiwi-review-fix-loop` hop — only when CLOSE_SAFE | after that hop — only when the move happened (MOVED) |
| `kiwi-coder` standalone (not a `kiwi-pm` child) | before its §8.4 follow-up review — only when neither `state.failed` nor a remaining regression failure | after that review — only when the move happened (MOVED) |

---

## 4. External dependencies

| Tool | Use | When absent |
|---|---|---|
| `get_active_target` · `list_requirements` · `get_requirement` (MCP) | scope and AC text §2.1 · §2.2 · §3.1 | halt — MCP rule |
| `check_sds` (MCP) / `speckiwi sds check <path> --json` (CLI) | deterministic check §2.4, close-out summary §3 | halt when both are absent — never set `agreed` without the check |
| `replace_acceptance_criteria` · `add_requirement` (MCP) | the close-out's SRS writes §3.1 | halt — CLI is not the normal mutation path |
| `validate_spec` (MCP) / `speckiwi validate --json` (CLI) | validation after the close-out §3.1 step 6 | halt when both are absent |
| `workflow_pipeline_emit` (MCP) | the event §2.6 | the degraded fallback of `../_shared/kiwi/pipeline-event.md` §5.1 |
