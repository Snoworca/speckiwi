# SDS-MD Authoring Rules v2.6.0

| Field | Value |
|---|---|
| Document Type | authoring_rules |
| Applies To | tdd work-mode step design documents (full profile, §1–§8) and body-scope lite SDS files (lite profile, §9) |
| Rules Version | 1.0.0 |
| Requirement | FR-FLOW-036 |
| Status | baseline |

## 1. Purpose

The SDS (Software Design Spec) is the lightweight natural-language contract a tdd-mode step writes **before any test or implementation code**. It fixes the architecture decisions, interfaces, and testable acceptance contracts that (a) the red tests are translated from and (b) the post-hoc SRS promotion derives its Acceptance Criteria from. A test suite without an SDS is not a specification — the SDS is the reward-hacking defence and the implementation-bias defence of TDD First mode.

## 2. Location and Naming

- The SDS lives at `docs/spec/steps/<task>/design.md`, beside the step's `intent.md`.
- One step, one SDS. A step whose SDS would need to be split has outgrown the step — split the task instead.
- `intent.md` states **what/why**; `design.md` states **how**. For small tasks a single combined `intent.md` is acceptable only when the trivial-change skip-gate (§6) applies, and only with the skip record that gate reads.

## 3. Required Structure

A design.md MUST carry a metadata table with the fields `Document Type` (value `sds`), `Task`, `Target`, `Status`, and `Date`, followed by exactly these seven headings in order:

1. **Context & Scope** — background and boundary, five lines or fewer.
2. **Goals / Non-goals** — bullets; explicit Non-goals block over-implementation.
3. **Architecture Decisions** — ADR-style: decision / basis / trade-off / rejected alternative, five lines or fewer per decision.
4. **Interfaces** — signatures and contracts of new or changed functions, CLI commands, and MCP tools. Signatures only.
5. **Acceptance Contracts** — EARS statements with `SDS-AC-n` ids. Format: `SDS-AC-n: WHEN <condition> THE SYSTEM SHALL <observable behavior>.`
6. **Test Plan** — a table mapping every SDS-AC to at least one planned test: `| SDS-AC | Test file (planned) | Case summary |`.
7. **Open Questions** — unresolved items; business-decision items block implementation until answered.

## 4. Size Cap

A design.md MUST NOT exceed **200 lines** (roughly three pages). When a draft approaches the cap, split the task into smaller steps — do not grow the document. The cap is what keeps SDS authoring cheaper than the SRS-first path it replaces.

## 5. Prohibitions

| # | Rule |
|---|---|
| P1 | Do not paste full schemas, API responses, or implementation code into the SDS. Reference the decision, not the artifact. |
| P2 | Do not exceed the 200-line cap (§4). |
| P3 | No changelog section — git history is the single source of truth for document history. |
| P4 | A Test Plan MUST NOT exist without Acceptance Contracts — tests derive from contracts, never the reverse. |
| P5 | Once implementation starts, an existing SDS-AC MUST NOT be retroactively weakened or rewritten to match the implementation. Add new contracts freely; to change an existing one, supersede the SDS (§6) and state the impact on already-written red tests. |

## 6. Lifecycle

```
draft ──(approval, size-scoped)──> agreed ──(design change needed)──> superseded
```

- **draft → agreed** is size-scoped: a small task whose Architecture Decisions section carries no substantive decision is **self-agreed** (the agent proceeds and the SDS is reviewed post-hoc); a task with substantive architecture decisions requires user approval before red tests are written.
- **agreed** gates implementation: no test or implementation code before the SDS is agreed (or self-agreed).
- **superseded**: a design change replaces the SDS with a new one; the superseding SDS MUST state which SDS-ACs changed and how existing red tests are affected.
- **Trivial-change skip-gate**: a change with no trade-off (typo, comment, mechanical rename, obvious one-line fix) may skip the SDS entirely, provided the skip is **recorded** in `intent.md` under a `## SDS Skip` heading. `speckiwi step validate` reads that record and refuses an unrecorded skip with `SDS-E054`, which is an error rather than an advisory — so an EARS stub on its own does not clear the gate. The skip decision is the first checklist item of the tdd cycle: skipping MUST be an explicit decision, never a default.

The `## SDS Skip` section of `intent.md` MUST carry all three of:

1. a `Decision` row whose value is `skipped`. Backticks are stripped and case is ignored; any other value is refused.
2. a `Reason` row whose value is neither empty nor a bare `-`.
3. at least one EARS stub line carrying an `SDS-AC-n` id and naming both `WHEN` and `SHALL` — one to three `SDS-AC` statements, in the form §3 requires of the Acceptance Contracts.

An absent `intent.md`, an absent section, an absent or wrongly valued row, and an absent EARS stub are each refused by `SDS-E054`, and each refusal names the part that failed. Copy this record:

```markdown
# Intent: <task>

<what this change does, and why it carries no trade-off>

## SDS Skip

| Field | Value |
| --- | --- |
| Decision | skipped |
| Reason | Renames one private helper; no interface and no behaviour change. |

- SDS-AC-1: WHEN the helper is renamed THE SYSTEM SHALL keep every caller resolving.
```

## 7. Relation to Tests and the Post-hoc SRS

- Red tests are translated from §5 Acceptance Contracts — one failing test per SDS-AC at minimum, before any implementation.
- Tests are committed before implementation and MUST NOT be weakened to reach green.
- At promotion time (`promote_step_requirement`), the SDS-ACs become the promoted requirement's Acceptance Criteria and the tests become its Verification Evidence. A promotion without evidence is refused in tdd mode.

## 8. design.md Template

Copy this template into `docs/spec/steps/<task>/design.md`:

```markdown
# SDS: <task title>

| Field | Value |
|---|---|
| Document Type | sds |
| Task | <step task name> |
| Target | <SpecKiwi target> |
| Status | draft |
| Date | YYYY-MM-DD |

## 1. Context & Scope

<background and boundary, five lines or fewer>

## 2. Goals / Non-goals

- Goal:
- Non-goal:

## 3. Architecture Decisions

- **Decision**: <what> / basis: <why> / trade-off: <cost> / rejected: <alternative>

## 4. Interfaces

- `<signature>` — <contract, one line>

## 5. Acceptance Contracts

- SDS-AC-1: WHEN <condition> THE SYSTEM SHALL <observable behavior>.

## 6. Test Plan

| SDS-AC | Test file (planned) | Case summary |
|---|---|---|
| SDS-AC-1 | test/... | ... |

## 7. Open Questions

- (none)
```

## 9. Lite Profile

The lite profile is the body-scope SDS a workflow writes before implementing a set of requirements outside a tdd step. It is written for coding agents, not human readers: English, no narrative prose, and every line either declares something a checker reads or states a contract. §2–§8 govern the full profile (the tdd step `design.md`); they apply to a lite SDS only where this section repeats them.

### 9.1 Location and lifecycle

- A lite SDS lives at `docs/sds/<sds-id>.sds.md`, outside `docs/spec`. Only files directly in `docs/sds/` whose name ends in `.sds.md` are read.
- One file per work unit. Work that does not fit the size cap (§9.5) is split into more files, never grown past it.
- `draft` → `agreed` → `closed`. `draft → agreed`: the author runs `speckiwi sds check`, resolves every error, and then sets Status to `agreed` itself. No user approval gate precedes implementation; a design question that needs the user is asked as a question.
- `agreed → closed`: the close-out moves the durable content into the SRS before the requirements are promoted, then sets Status to `closed`. A `closed` SDS is never read as the current design — the code is — and nothing is written into it again; further work takes a new sds-id. No diagnostic depends on the Status value; `speckiwi sds check` reports it in its summary.
- The file is disposable. After promotion the close-out deletes it; git history keeps it.

### 9.2 Metadata

The metadata table carries `Document Type` (`sds`), `Profile` (`lite`), `Target`, `Status` and `Date`. The `| Profile | lite |` row is what marks a file as lite; a file in `docs/sds/` without it is reported and not checked.

The optional `Requirements` row lists, comma-separated, the requirement ids this SDS is written for. A wave SDS and an SDS written for a requirement filter always carry it. It sets the scope of the no-`@req` check. With the row, every listed requirement must be named by an `@req` in this file, and a listed requirement no `@req` names is the error `SDS-E070`, which must be resolved before the SDS is agreed. Without the row, every open requirement of the `Target` should be named by an `@req` in some lite SDS of that target, and a miss is the warning `SDS-W068`, because a later wave's SDS may not exist yet.

### 9.3 Required sections

`## Interfaces` with a `### Files` subsection, `## Acceptance Contracts`, and `## Test Plan`. `### Depends` under `## Interfaces` is optional. A heading may carry a number prefix (`## 1. Interfaces`). Other sections (Context & Scope, Goals / Non-goals, Architecture Decisions, Open Questions) may be present and are not read.

The optional `## Durable Rules` section is the only durable marker: one line per structural rule the code must keep after the run — `- <rule> — <why it must outlive this run>`. The checker does not read it; at close-out each rule there is raised as a constraint requirement, and every structural note outside it is discarded with the file.

### 9.4 Grammar

The machine markers are exactly four: `@req`, `←`, `→`, and `SDS-AC-n (<REQ-ID> AC-m)`. Signatures are opaque text; only the declared name is read from them. Every entry of Depends, Files and Acceptance Contracts is one list item on one line (`-`, `*` or `1.`); any other non-blank line there is reported. An Acceptance Contracts line in another shape is reported and still declares every `SDS-AC-n` it names, so no contract drops out of the Test Plan check. Lines inside a fenced code block are not read.

- **Depends** — one chain per line: `- cli → service → store, validate`. Layers are joined by `→` and members by commas; a module name is letters, digits and `_ . @ / -`. `*` standing alone as the first layer means every module. Braces, brackets and `->` are malformed.
- **Files** — a list item at the list's left margin declares one file: `` - `src/service.ts` — <responsibility> @req <REQ-ID> ``. The path is repository-relative, one per line, and may not be absolute or leave the root. The file's `@req` ids are inherited by every symbol under it.
- **Symbols** — a nested bullet declares one or more symbols of that file: `` - `createTask(input: TaskInput): Task` / `parsePatch(v: unknown): Patch` — <contract> ← cli, worker @req <REQ-ID> ``. Each backtick span is one declaration. A bullet nested under a symbol declares a member, reachable as `Parent.member`. The declared name is the identifier after a declaration keyword (`class`, `interface`, `type`, `function`, `def`, `const`, …), otherwise the last identifier before the first `(`, `:` or `=`, ignoring generic `<…>` groups; write a Go method as `Store.Touch(t Task) error`. `← callers` names the callers that must stay connected. The annotations `←` and `@req` come after the text.
- **Acceptance Contracts** — one line per contract: `` - SDS-AC-n (<REQ-ID> AC-m): WHEN <condition> THE SYSTEM SHALL <behaviour> → `symbol`, `Parent.member` ``. The reference names the requirement criterion the contract interprets; each `→` target names a declared symbol, bare or qualified.
- **Test Plan** — the table `| SDS-AC | Test file | Case summary |`. Every SDS-AC needs at least one row naming a repository-relative test file (comma-separated for more than one), and every row names a declared SDS-AC. The test that implements the row cites `SDS-AC-n` on its test line, which `speckiwi coverage --tests --sds <path>` checks. That check reads the Test Plan of a full-profile step `design.md` the same way.

The write set of an SDS is its Files paths together with its Test Plan test files; its `@req` set is every id an `@req` names. Both are read by wave scheduling.

### 9.5 Size cap

A lite SDS MUST NOT exceed **100 lines** (a trailing newline is not a line). Split the work into more SDS files instead of growing one.

### 9.6 Checks

`speckiwi sds check <path> [--json]` (MCP `check_sds`) checks one file, prints its diagnostics and parsed summary, and exits non-zero when any error remains. `speckiwi validate` (MCP `validate_spec`) checks every `docs/sds/*.sds.md` in every work-mode. The full-profile checks (`SDS-W050` through `SDS-W053`, `SDS-E054`) are unchanged and never run on a lite file.

| Code | Severity | Meaning |
|---|---|---|
| `SDS-E060` | error | A metadata field or a required section is missing, or `Profile` is not `lite` when one file is checked. |
| `SDS-E061` | error | The file is over the 100-line cap. |
| `SDS-E062` | error | An `@req`, or an id in the `Requirements` row, names no existing requirement. |
| `SDS-E063` | error | An Acceptance Contracts line is not a contract list item, repeats an SDS-AC number, or its `(<REQ-ID> AC-m)` is missing or names no existing requirement criterion. |
| `SDS-E064` | error | An SDS-AC has no Test Plan row naming a test file, a Test Plan row names an invalid path, or a Test Plan row names an SDS-AC no contract declares. |
| `SDS-E065` | error | A `→` target names a symbol no Interfaces line declares. |
| `SDS-E066` | error | A Depends line is malformed or is not a list item. |
| `SDS-E067` | error | A Files or symbol line is not a list item, has no path or signature span, names an invalid path, or yields no declared name. |
| `SDS-W068` | warning | An SDS without a `Requirements` row leaves a still open requirement of its `Target` named by no `@req` in any lite SDS of that target. |
| `SDS-W069` | warning | A file in `docs/sds/` is not lite profile, so `speckiwi validate` did not check it. |
| `SDS-E070` | error | A requirement the `Requirements` row lists is named by no `@req` in this file. |

### 9.7 Lite template

Copy this template into `docs/sds/<sds-id>.sds.md`:

```markdown
# SDS: todo-service

| Field | Value |
|---|---|
| Document Type | sds |
| Profile | lite |
| Target | v1.0.0 |
| Status | draft |
| Date | 2026-09-27 |

## Interfaces

### Depends

- cli → service → store, validate
- * → types

### Files

- `src/service.ts` — task lifecycle and version checks @req FR-TODO-001
  - `createTask(input: TaskInput): Task` — stores a task at version 1 ← cli
  - `class TaskService` — owns the store
    - `archive(id: string): void` — marks a task archived once ← cli @req FR-TODO-002
- `src/validate.ts` — argument validation and normalisation @req FR-TODO-001
  - `parseExpectedVersion(v: unknown): number` — positive integer or VALIDATION ← service

## Acceptance Contracts

- SDS-AC-1 (FR-TODO-001 AC-3): WHEN expectedVersion is not a positive integer THE SYSTEM SHALL throw VALIDATION before comparing versions → `parseExpectedVersion`
- SDS-AC-2 (FR-TODO-002 AC-1): WHEN a task is archived twice THE SYSTEM SHALL keep the first archive time → `TaskService.archive`

## Test Plan

| SDS-AC | Test file | Case summary |
|---|---|---|
| SDS-AC-1 | `test/validate.test.ts` | 0, -1 and 1.5 are refused with VALIDATION |
| SDS-AC-2 | `test/service.test.ts` | a second archive keeps the first time |
```
