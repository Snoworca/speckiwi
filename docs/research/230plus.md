# Doc230 Plus: Workflow Tool Utility and Validity Review

| Field | Value |
| --- | --- |
| Date | 2026-06-29 |
| Target | v2.3.0 |
| Related SRS Anchor | `OPS-FLOW-001` |
| Related Requirements | `FR-NODE-020`, `FR-NODE-021`, `REL-NODE-003`, `REL-NODE-006`, `FR-NODE-029`, `FR-NODE-030`, `FR-NODE-031`, `IR-CLI-031`, `IR-CLI-032`, `IR-CLI-040`, `IR-CLI-041`, `IR-CLI-042`, `IR-CLI-043`, `FR-MCP-023`, `FR-MCP-024`, `FR-MCP-034`, `FR-MCP-035`, `FR-MCP-037`, `FR-MCP-038`, `MIG-FLOW-003`, `MIG-FLOW-004` |
| Related Research | `docs/research/10.kiwi-planner-jsonl-tooling-research.md`, `docs/research/11.v2.3.0-tooling-code-improvement-plan.md`, `docs/research/230.md` |
| Method | Ten read-only sub-agent research axes plus main-agent source validation |
| Status | Research complete; no implementation evidence claimed |

## 1. Scope

This document evaluates ten additional workflow tools proposed after Doc230:

1. `workflow doctor`
2. `workflow explain-next`
3. `workflow context-pack`
4. `workflow diff`
5. `workflow repair`
6. `workflow journal`
7. `pipeline emit`
8. `pipeline compact`
9. `workflow schema-check`
10. `workflow migrate-preview`

The question is not whether these commands exist today. They do not. The question is whether they are useful, valid under the current v2.3.0 SRS direction, and worth recording as implementation work.

This report is research, not implementation evidence. It must not be used to mark any acceptance criteria checked.

## 2. Current-State Evidence

The current target is `v2.3.0`, and the target goal is tool improvement: make SpecKiwi tools more reliable, ergonomic, diagnosable, and safer in real project use before expanding non-tool surface area.

SRS validation at research time:

```text
node bin/speckiwi validate --fail-on-warning --json
=> errors: 0, warnings: 0

node bin/speckiwi summary --target v2.3.0 --json
=> planned: 39, discarded: 9, verified: 1, total: 49, diagnostics: 0
```

Runtime CLI surface at research time has no workflow/pipeline command family. `node bin/speckiwi --help` lists SRS-oriented commands such as `validate`, `list`, `show`, `summary`, `completed-work`, SRS mutation commands, `mcp`, and `skills`, but no `workflow`, `pipeline`, `plan`, `session`, `worklog`, or `work-order` command family.

Artifact reality at research time:

- Current repository contains legacy `docs/plan/**` planning artifacts.
- Current repository contains legacy `.snoworca/sessions/**` PM/worklog artifacts.
- Current repository contains `kiwi/pipeline.jsonl`.
- Current repository does not provide enough current `docs/plans/**` and `.kiwi/sessions/**` examples to treat current-format workflow fixtures as already covered.

This reinforces the existing v2.3.0 sequence: shared resolver first, JSONL core second, validators third, read-only compact tools fourth, work-order fifth, guarded mutation later.

## 3. Executive Conclusion

The ten proposed tools are mostly valid, but most should not become independent foundational tools. The safe architecture is:

1. Implement the shared substrate:
   - `FR-NODE-020` workflow artifact resolver.
   - `FR-NODE-021` workflow JSONL core.
   - `REL-NODE-003` workflow validators and hallucination guards.

2. Expose compact read projections:
   - `REL-NODE-006` defines the core projection contracts.
   - `IR-CLI-041` and `FR-MCP-035` name public CLI/MCP projection surfaces over the older read substrates `IR-CLI-031` and `FR-MCP-023`.
   - `workflow doctor`, `workflow diff`, `pipeline compact`, and `schema-check` fit here as read-only projections.

3. Expose next-action orchestration:
   - `IR-CLI-032` and `FR-MCP-024`.
   - `workflow explain-next` and `workflow context-pack` should be modes or aliases of work-order, not separate selectors.

4. Expose guarded mutation:
   - `FR-NODE-030`, `IR-CLI-042`, and `FR-MCP-037`.
   - `pipeline emit`, `workflow repair`, and `workflow journal` fit here, with different risk levels.

5. Keep logical deletion separate:
   - `FR-NODE-031`, `IR-CLI-043`, and `FR-MCP-038`.
   - Deletion remains effective state/tombstone behavior, not a physical delete and not a pipeline `status`.

6. Defer migration apply:
   - `workflow migrate-preview` is registered as read-only diagnostic work under `FR-NODE-029`, `IR-CLI-040`, and `FR-MCP-034`.
   - Actual migration apply/write must be a later requirement.

## 4. Ten-Axis Findings

| Axis | Proposed Tool | Verdict | Existing SRS Fit | New SRS Needed? |
| --- | --- | --- | --- | --- |
| 1 | `workflow doctor` | Valid as read-only diagnostic wrapper. | `REL-NODE-006`, `IR-CLI-041`, `FR-MCP-035`, with `FR-NODE-020`, `FR-NODE-021`, `REL-NODE-003` substrate | No broad new REQ; use registered projection successor requirements for public names. |
| 2 | `workflow explain-next` | Valid as `work-order next` explain/provenance mode. | `IR-CLI-032`, `FR-MCP-024`, plus `IR-CLI-041`/`FR-MCP-035` for public profile naming | No duplicate REQ; use the registered work-order and projection/profile requirements. |
| 3 | `workflow context-pack` | Valid as compact work-order profile, not independent resolver. | `IR-CLI-041`, `FR-MCP-035`, `IR-CLI-032`, `FR-MCP-024`, `REL-NODE-002` | No broad new REQ; use registered profile/projection successor requirements. |
| 4 | `workflow diff` | Valid as normalized drift report. | `REL-NODE-006`, `IR-CLI-041`, `FR-MCP-035`, `REL-NODE-003` | No; registered projection successor requirements reserve the public surface. |
| 5 | `workflow repair` | Useful but high-risk; only for recorded `pendingRepair` and dry-run first. | `FR-NODE-030`, `IR-CLI-042`, `FR-MCP-037` | Maybe narrow repair-orchestrator REQ if it goes beyond repair record creation. |
| 6 | `workflow journal` | Useful as mutation ledger/inspect/repair support, not alternate source of truth. | `FR-NODE-030`, `IR-CLI-042`, `FR-MCP-037`, `FR-NODE-031` | Update existing REQs for journal key precision; no broad new REQ. |
| 7 | `pipeline emit` | Valid as official JSONL append surface. | `FR-NODE-021`, `FR-NODE-030`, `IR-CLI-042`, `FR-MCP-037`, `MIG-FLOW-003` | No; clarify command/tool names. |
| 8 | `pipeline compact` | Valid as compact read projection over JSONL core. | `REL-NODE-006`, `IR-CLI-041`, `FR-MCP-035`, `FR-NODE-021`, `FR-NODE-031` | No; registered projection successor requirements own the alias. |
| 9 | `workflow schema-check` | Valid as fail-closed preflight; avoid separate schema authority. | `REL-NODE-006`, `IR-CLI-041`, `FR-MCP-035`, `FR-NODE-020`, `FR-NODE-021`, `REL-NODE-003` | Prefer successor AC clarification over a duplicate REQ. |
| 10 | `workflow migrate-preview` | Accepted only as read-only migration diagnostic; migration apply remains deferred. | `FR-NODE-029`, `IR-CLI-040`, `FR-MCP-034`, plus resolver, JSONL, validators, and read tools | No for preview; yes only for a future migration-apply/write surface. |

## 5. Tool-by-Tool Analysis

### 5.1 `workflow doctor`

Verdict: accepted as a read-only diagnostic wrapper.

Expected utility is high after prerequisites exist. It can gather resolver diagnostics, JSONL diagnostics, validator outcomes, stale hash results, dependency cycles, PM/checklist drift, blocked resume state, and logical-delete visibility into one report.

It should not:

- choose a next action independently from `work-order next`;
- mutate artifacts;
- repair drift;
- reimplement parsing or state precedence outside the shared core.

Recommended shape:

```text
speckiwi workflow doctor --json
MCP: diagnose_workflow
```

This should be exposed through the registered projection successors `REL-NODE-006`, `IR-CLI-041`, and `FR-MCP-035` after `FR-NODE-020`, `FR-NODE-021`, and `REL-NODE-003` are implemented. `IR-CLI-031` and `FR-MCP-023` remain lower-level read substrates, not the public projection owner.

### 5.2 `workflow explain-next`

Verdict: accepted only as an explainability view over the work-order engine.

The safest form is:

```text
speckiwi work-order next --explain --json
MCP: get_next_work_order({ explain: true })
```

It must not recompute next-task selection separately. If it does, selector drift becomes likely. The output should expose deterministic provenance:

- selected action;
- rule decisions;
- source artifacts;
- hashes or mtimes;
- blockers;
- rejected candidates;
- diagnostics;
- raw bodies omitted by default.

The work-order decision semantics belong under `IR-CLI-032` and `FR-MCP-024`. Public explain/profile naming belongs under `IR-CLI-041` and `FR-MCP-035`.

### 5.3 `workflow context-pack`

Verdict: accepted as a compact output profile, not an independent tool.

This is useful if it returns a bounded agent-ready context:

- active target;
- related requirement IDs;
- next action;
- artifact references;
- hashes or mtimes;
- pipeline/session/worklog summaries;
- blocking diagnostics;
- no raw Markdown or raw JSON bodies by default.

It should be implemented as a work-order output mode or alias. Implementing it first would duplicate unresolved resolver, JSONL, validator, and work-order logic.

The work-order payload semantics belong under `IR-CLI-032`, `FR-MCP-024`, and the payload measurement requirement `REL-NODE-002`. Public context-pack/profile naming belongs under `IR-CLI-041` and `FR-MCP-035`.

### 5.4 `workflow diff`

Verdict: accepted as a read-only normalized drift report.

The tool should not emit textual diffs as the main answer. The important comparison is whether the workflow sources agree under their proper precedence:

- sidecar `tasks[]`: task catalog source of truth;
- sidecar `depends_on_task`: legal ordering source of truth;
- PM state: execution status source of truth;
- coder state: active-task and resume-detail evidence;
- worklog and pipeline: audit evidence;
- plan checkboxes: display and repair evidence.

Useful drift classes:

- plan checkbox says done but PM state does not;
- PM says done but worklog lacks terminal evidence;
- sidecar task exists but plan display is missing;
- dependency blocks next task;
- PM state and coder state disagree;
- stale plan or sidecar hash;
- invalid JSONL line or duplicate event key;
- deleted/corrected records filtered differently between views.

This belongs under `REL-NODE-006`, backed by `REL-NODE-003` validator outcomes. CLI/MCP exposure belongs through `IR-CLI-041` and `FR-MCP-035`, while `IR-CLI-031` and `FR-MCP-023` remain lower-level read substrates.

### 5.5 `workflow repair`

Verdict: conditionally accepted, high-risk.

The safe version is not "fix my workflow automatically." It is:

```text
speckiwi workflow repair diagnose --dry-run --json
speckiwi workflow repair apply --repair-id <id> --json
```

Repair must be limited to recorded `pendingRepair` entries and current stale guards. It must return the shared mutation envelope and must not infer repairs from unchecked plan boxes alone.

It should never:

- treat plan display state as execution truth;
- hide partial writes;
- bypass stale guards;
- physically delete history;
- use repair to bury invalid workflow records.

This is mostly covered by `FR-NODE-030`, `IR-CLI-042`, and `FR-MCP-037`, but a narrow follow-up SRS may be useful if a user-facing repair orchestrator is required beyond repair-record creation.

### 5.6 `workflow journal`

Verdict: accepted as an internal mutation ledger and optional inspect/repair surface.

It is useful because workflow mutations touch several artifacts:

- plan Markdown;
- PM state;
- worklog JSONL;
- pipeline events;
- repair records.

Journal support should help answer:

- was this mutation planned?
- was it applied?
- was it confirmed?
- did it partially fail?
- what repair remains?
- is this retry idempotent?

Critical issue found by the review:

Earlier research/SRS draft wording was inconsistent about journal key material.

- Earlier Doc10 drafts said idempotency could be computed from `kind|run_id|task_id|canonicalJson(args)`.
- Earlier Doc10 and first-wave SRS drafts mentioned `sha256(tool|task_id|req_id|canonicalJson(flat_args))`, which omitted `runId`.

The safer canonical key should include workflow identity:

```text
sha256(tool|run_id|task_id|req_id|canonicalJson(flat_args))
```

Where `req_id` may be an empty stable token for non-REQ-scoped workflow operations. Omitting `run_id` can create cross-run collisions for repeated task IDs.

This should be clarified in `FR-NODE-030`, `IR-CLI-042`, and `FR-MCP-037` before implementation.

### 5.7 `pipeline emit`

Verdict: accepted as an official append surface.

This tool would replace current shell snippets that append hand-built JSON into `kiwi/pipeline.jsonl`. A narrow MVP is valuable:

```text
speckiwi pipeline emit --json
MCP: emit_pipeline_event
```

Minimum behavior:

- validate pipeline event schema;
- resolve the correct pipeline path;
- serialize one JSON object per line;
- enforce trailing LF;
- dedupe by parsed `skill + run_id`, not substring search;
- support dry-run no-write;
- expose best-effort append result;
- return a mutation envelope compatible with `FR-NODE-017`.

This belongs under `FR-NODE-021`, `FR-NODE-030`, `IR-CLI-042`, `FR-MCP-037`, and later `MIG-FLOW-003` for skill text migration.

Do not edit Kiwi skill text to call `pipeline emit` until the runtime command and MCP equivalent actually exist.

### 5.8 `pipeline compact`

Verdict: accepted as a compact read projection.

It should be implemented as `pipeline status` or `pipeline tail` with compact defaults; `pipeline compact` can be an alias if desired.

Required effective-state rules:

1. Parse JSONL structurally.
2. Validate schema, status, timestamp, and event identity.
3. Apply logical-delete tombstones before normal correction.
4. Exclude invalid, corrected, deleted, and meta records from default latest-state selection.
5. Sort by timestamp descending, then line number descending.
6. Active `FAILED` and `NEEDS_USER` block automation.
7. Corrected or deleted failures do not block automation.
8. `includeDeleted` belongs only to read/list/tail surfaces.
9. `deleted` is not a pipeline `status`.
10. `status=DELETED` is invalid.

Pipeline compact cannot replace `work-order next`, because pipeline state alone cannot evaluate plan DAG, PM task status, session hashes, or worklog evidence.

This belongs under `REL-NODE-006`, `FR-NODE-021`, and `FR-NODE-031`, with public CLI/MCP exposure through `IR-CLI-041` and `FR-MCP-035`.

### 5.9 `workflow schema-check`

Verdict: accepted as a fail-closed preflight, but not as a separate schema authority.

The current skill-local planner validator checks important plan and sidecar contracts, but the review found a gap: it documents `schema_version` and `plan_contract` compatibility, but sidecar `schema_version` enforcement is not yet clearly covered by official SpecKiwi runtime tools.

Recommended behavior:

```text
speckiwi plan validate <plan> --json
speckiwi workflow schema-check --run-id <runId> --json
```

If both names exist, `workflow schema-check` should compose lower-level validators rather than define another schema system.

Failure should be fail-closed:

```json
{
  "ok": false,
  "error": { "code": "invalid_plan_contract" },
  "diagnosticsSummary": { "errors": 1, "warnings": 0 }
}
```

No next action should be guessed after schema failure.

This belongs under `REL-NODE-006`, backed by `REL-NODE-003`, with public CLI/MCP exposure through `IR-CLI-041` and `FR-MCP-035`.

### 5.10 `workflow migrate-preview`

Verdict: accept only the registered read-only diagnostic preview; defer any migration apply/write surface.

Earlier drafts treated this as the only proposal without SRS coverage. That is no longer true: the read-only preview contract is now registered in `FR-NODE-029`, `IR-CLI-040`, and `FR-MCP-034`. Existing resolver, JSONL, validator, and read requirements remain prerequisites.

Useful future behavior:

- classify legacy `docs/plan/**` and `.snoworca/sessions/**` artifacts;
- report proposed current-format destinations;
- show unsupported fields;
- warn about data loss;
- report target/path drift;
- compute source hashes;
- return `written:false`;
- include no raw bodies by default.

It must not:

- move files;
- delete files;
- normalize JSONL;
- rewrite plan/session state;
- treat legacy artifacts as current state without explicit confidence and legacy flags.

This preview has already been promoted into registered v2.3.0 requirements:

- `FR-NODE-029` — core read-only legacy workflow migration preview.
- `IR-CLI-040` — CLI read-only workflow migration preview command.
- `FR-MCP-034` — MCP read-only workflow migration preview tool.

Dependencies should include `FR-NODE-020`, `FR-NODE-021`, `REL-NODE-003`, `IR-CLI-031`, and `FR-MCP-023`, with public preview surfaces owned by `IR-CLI-040` and `FR-MCP-034`. Actual migration apply/write should be a later separate requirement.

## 6. Priority Order

Recommended order:

1. `workflow schema-check` behavior inside validators.
2. `pipeline compact` through JSONL read projection.
3. `workflow diff` as normalized drift report.
4. `workflow doctor` as diagnostic aggregation.
5. `workflow explain-next` as `work-order next --explain`.
6. `workflow context-pack` as compact work-order profile.
7. `pipeline emit` as official pipeline append.
8. `workflow journal` as mutation ledger inspection.
9. `workflow repair` for recorded pending repairs only.
10. `workflow migrate-preview` after legacy/current fixture coverage exists.

This order differs slightly from perceived user convenience. The safest early tools are read-only and validator-based. Mutation and repair should wait until drift is observable and reproducible.

## 7. SRS Update Recommendations

No broad new SRS requirement is needed for nine of the ten tools. However, several existing requirements should be clarified before implementation:

| Requirement | Recommended Clarification |
| --- | --- |
| `REL-NODE-003` | Add structured drift report and schema/preflight outcomes: `invalid_plan_contract`, `unsupported_schema_version`, `task_state_conflict`, `repairable_drift`, `stale_artifact`, `blocked_dependency`, `invalid_artifact`. |
| `REL-NODE-006` | Own core read-only diagnostic projection contracts for workflow doctor, workflow diff, schema-check, and pipeline compact style views. |
| `IR-CLI-041` | Name public CLI projection/profile surfaces such as `workflow doctor`, `workflow diff`, `plan validate`, `pipeline status`, `pipeline tail`, optional `pipeline compact`, and work-order explain/context profiles. |
| `FR-MCP-035` | Add MCP projection/profile equivalents for named CLI surfaces, preserving compact defaults and no raw body inclusion. |
| `IR-CLI-031` | Keep as the lower-level compact workflow read substrate consumed by projection commands. |
| `FR-MCP-023` | Keep as the lower-level MCP workflow read substrate consumed by projection tools. |
| `IR-CLI-032` | Add optional explain/context-pack output modes if these become public surfaces; require `decisionTrace` and rejected-candidate provenance to be generated by the work-order engine. |
| `FR-MCP-024` | Add `explain` and compact context profile input options if CLI work-order exposes them. |
| `FR-NODE-030` | Clarify journal key formula to include `run_id`; define canonical JSON and journal inspect/repair semantics. |
| `IR-CLI-042` | Name `pipeline emit` and any journal/repair CLI surfaces only after core behavior is fixed. |
| `FR-MCP-037` | Add MCP parity names such as `emit_pipeline_event` only after CLI/core schema is stable. |
| `FR-NODE-029`, `IR-CLI-040`, `FR-MCP-034` | Use the registered read-only legacy workflow migration preview requirements; do not create a duplicate preview requirement. |

## 8. Measurement Requirements

Utility claims remain hypotheses until fixtures measure them.

Required measurement fields:

```json
{
  "scenario": "workflow-context-pack",
  "measurementStatus": "fixture_required",
  "baselineBytes": null,
  "baselineApproxTokens": null,
  "compactBytes": null,
  "compactApproxTokens": null,
  "requiredFieldsPresent": true,
  "reductionRatio": null,
  "deterministicNextAction": true,
  "rawBodiesIncluded": false
}
```

The before/after benchmark should cover at least:

- raw full reads versus `pipeline compact`;
- raw plan/sidecar/PM/worklog reads versus `workflow diff`;
- raw full workflow inspection versus `workflow doctor`;
- raw full workflow inspection versus `work-order next --explain`;
- raw full workflow inspection versus `context-pack`.

No percentage should be reported as verified until fixture output records baseline and compact sizes.

## 9. Risk Register

| Risk | Severity | Mitigation |
| --- | --- | --- |
| Tool proliferation creates duplicate selectors. | High | Keep explain/context-pack as work-order modes, not independent selectors. |
| Read tools silently include raw Markdown/JSON. | High | Raw bodies require explicit `includeBody`. Add tests. |
| Plan checkbox treated as execution truth. | Critical | `REL-NODE-003` precedence: PM state owns execution status. |
| Journal key collision across runs. | High | Include `run_id` in canonical journal key. |
| Pipeline logical delete becomes `status=DELETED`. | Critical | Keep deleted as effective state only; reject `status=DELETED`. |
| Repair tool hides partial writes. | Critical | Use shared mutation envelope, `pendingRepair`, and dry-run first. |
| Migration preview writes files. | High | Preview must be read-only; apply/write requires separate future REQ. |
| Skill docs migrate before tools exist. | Medium | Gate skill migration under `MIG-FLOW-003` after runtime commands exist. |
| Legacy artifacts are treated as current. | High | Resolver must expose `legacy`, `confidence`, hashes, and diagnostics. |
| Token reduction is claimed without measurement. | Medium | Require `REL-NODE-002` fixture measurements. |

## 10. Final Decision

The additional tools are useful, but the implementation strategy should be conservative:

- Add read-only diagnostic projections first.
- Keep next-action explanation and context packing as work-order output modes.
- Add official JSONL append only after shared JSONL core exists.
- Add repair and journal inspect only after guarded mutation envelopes and validators exist.
- Defer migration preview or give it a separate read-only requirement.

The most valuable immediate SRS improvement is not adding ten independent requirements. It is tightening existing v2.3.0 requirements so they explicitly cover:

1. read-only doctor/diff/schema-check projections;
2. work-order explain/context profiles;
3. canonical journal key including `run_id`;
4. official pipeline emit naming;
5. optional future legacy migration preview.

Implementation should continue to use the canonical requirements listed at the top of this document. `OPS-FLOW-001` remains a research anchor, not an implementation contract.
