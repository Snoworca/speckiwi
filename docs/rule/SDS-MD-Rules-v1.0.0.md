# SDS-MD Authoring Rules v1.0.0

| Field | Value |
|---|---|
| Document Type | authoring_rules |
| Applies To | tdd work-mode step design documents (SDS) |
| Rules Version | 1.0.0 |
| Requirement | FR-FLOW-036 |
| Status | baseline |

## 1. Purpose

The SDS (Software Design Spec) is the lightweight natural-language contract a tdd-mode step writes **before any test or implementation code**. It fixes the architecture decisions, interfaces, and testable acceptance contracts that (a) the red tests are translated from and (b) the post-hoc SRS promotion derives its Acceptance Criteria from. A test suite without an SDS is not a specification — the SDS is the reward-hacking defence and the implementation-bias defence of TDD First mode.

## 2. Location and Naming

- The SDS lives at `docs/spec/steps/<task>/design.md`, beside the step's `intent.md`.
- One step, one SDS. A step whose SDS would need to be split has outgrown the step — split the task instead.
- `intent.md` states **what/why**; `design.md` states **how**. For small tasks a single combined `intent.md` is acceptable only when the trivial-change skip-gate (§6) applies.

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
- **Trivial-change skip-gate**: a change with no trade-off (typo, comment, mechanical rename, obvious one-line fix) may skip the SDS entirely and record an EARS stub (one to three `SDS-AC` statements) in `intent.md` instead. The skip decision is the first checklist item of the tdd cycle — skipping MUST be an explicit decision, never a default.

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
