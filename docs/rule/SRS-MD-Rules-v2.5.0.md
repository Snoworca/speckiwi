# SRS-MD Authoring Rules v2.5.0

Subtitle: **Git-native Markdown SRS authoring rules based on an extended ISO/IEC/IEEE 29148**

---

## 0. Document Metadata

| Field | Value |
|---|---|
| Document ID | SRS-MD-RULES |
| Document Type | authoring_rules |
| Version | 1.0.0 |
| Status | stable |
| Audience | developers, reviewers, maintainers, AI coding agents |
| Primary Use | SRS authoring, review, search, status updates, implementation verification |
| Source Format | GitHub Flavored Markdown |
| Canonical Location | `docs/rule/SRS-MD-Rules-v2.5.0.md` |
| Last Updated | 2026-05-10 |

---

## 1. Purpose

This document defines the rules for authoring and maintaining a Software Requirements Specification, hereafter SRS, in Markdown inside a repository.

The purposes of these rules are as follows.

1. Keep SRS documents as Markdown that is easy for humans to read.
2. Let scripts and AI coding agents locate and interpret requirement blocks reliably.
3. Manage functional scope, target version, status, acceptance criteria, verification evidence, related documents, issues, and change rationale within a single requirement unit.
4. Distinguish implementation completion from verification completion.
5. Manage requirements in the smallest change unit suitable for Git diff and code review.
6. Make operation possible using only in-repository documents and optional repo-local scripts, without a separate global tool.

These rules condense and extend the requirements engineering principles of ISO/IEC/IEEE 29148 to suit Markdown-based operation. This document is not a replacement for the official standard; it is a practical authoring convention for use in a software development repository.

---

## 2. Core Principles

### 2.1 Markdown Source-of-Truth Principle

The SRS Markdown documents are the source of truth for requirements.

```text
SRS Markdown = source of truth
Index Markdown = navigation and summary
Repo-local scripts = validation and convenience tools
Git history = change history
Issue / PR / tests / docs = trace and evidence
```

Managing requirements must not presuppose a separate database, server, global CLI, or bidirectional conversion system.

### 2.2 Restricted Markdown Principle

An SRS document is not free-form Markdown. It must read naturally for humans, but requirement blocks follow a restricted Markdown structure that scripts can parse.

### 2.3 Single Requirement Principle

One Requirement Block expresses exactly one verifiable requirement. When multiple behaviors, multiple policies, or multiple system boundaries are mixed together, split the requirement.

### 2.4 Separation of Implementation Status and Verification Status Principle

The fact that code has been written differs from the fact that a requirement has been verified. These rules separate the `implemented` and `verified` statuses.

### 2.5 Minimal Change Principle

When modifying an SRS, change only the relevant Requirement Block. Avoid full-document rewrites, section reordering, and bulk formatting changes.

### 2.6 Traceability Principle

As far as possible, link requirements to GitHub Issues, Pull Requests, tests, implementation files, research/analysis documents, technical documents, and other requirements.

### 2.7 Verification Evidence First Principle

To mark a requirement as `verified`, the acceptance criteria must be satisfied and evidence supporting that fact must exist.

---

## 3. Terms

| Term | Definition |
|---|---|
| SRS | Software Requirements Specification. The specification of requirements that a system or software must satisfy. |
| SRS Index | The index document for navigating the whole SRS document set. The default file is `docs/spec/00.index.md`. |
| Scope SRS | The requirements document for each functional scope. Example: `docs/spec/01.auth.srs.md`. |
| Requirement Block | The Markdown block that expresses one requirement. It starts with a `### {ID} — {Title}` heading. |
| Requirement ID | The globally unique identifier of a requirement. Example: `FR-AUTH-001`. |
| Scope | The function, module, domain, component, package, or subsystem unit that groups requirements. |
| Target | The version, release, milestone, phase, or objective that a requirement targets. |
| Status | The implementation and verification progress of a requirement. |
| Acceptance Criteria | The acceptance criteria used to judge whether a requirement is satisfied. |
| Verification Evidence | The test, PR, code, review, analysis, demo, or operational evidence supporting that a requirement is satisfied. |
| Trace Links | The relationships between a requirement and issues, PRs, tests, documents, code, and other requirements. |
| Research / Analysis | The investigation, comparison, analysis, experiment, and decision rationale that support a requirement. |
| Implementation Notes | The design, constraints, and caveats an implementer needs to know. Not the requirement itself. |

---

## 4. Recommended Repository Structure

```text
docs/
├─ rule/
│  └─ SRS-MD-Rules-v2.5.0.md
│
├─ spec/
│  ├─ 00.index.md
│  ├─ 01.auth.srs.md
│  ├─ 02.user.srs.md
│  ├─ 03.payment.srs.md
│  ├─ 04.observability.srs.md
│  └─ 90.appendix.md
│
├─ analysis/
│  ├─ session-timeout-analysis.md
│  └─ payment-provider-comparison.md
│
├─ tech/
│  ├─ auth-token-design.md
│  └─ payment-webhook-design.md
│
└─ adr/
   ├─ 0001-use-session-cookie.md
   └─ 0002-payment-provider-selection.md

scripts/
└─ spec/
   ├─ validate-spec.js
   ├─ list-by-target.js
   ├─ list-by-status.js
   ├─ update-status.js
   ├─ summarize-target.js
   ├─ check-links.js
   └─ extract-requirements.js
```

The responsibility of each path is as follows.

| Path | Responsibility |
|---|---|
| `docs/rule/SRS-MD-Rules-v2.5.0.md` | SRS-MD authoring, parsing, validation, agent workflow rules |
| `docs/spec/00.index.md` | Entry point for the whole SRS document set, target list, scope document links, summary |
| `docs/spec/*.srs.md` | Source of truth for requirements per functional scope |
| `docs/spec/90.appendix.md` | Common terms, enums, status definitions, cross-scope map, supplementary rules |
| `docs/analysis/*.md` | Investigation, comparison, analysis, experiment results, rationale documents |
| `docs/tech/*.md` | Technical design, API design, data model, operational policy |
| `docs/adr/*.md` | Architectural decision records |
| `scripts/spec/*.js` | Helper scripts for document validation, search, summary, and status updates |

---

## 5. File Naming Rules

### 5.1 SRS Index

The following index document filename is recommended.

```text
docs/spec/00.index.md
```

### 5.2 Scope SRS

Scope SRS filenames follow the following format.

```text
docs/spec/{NN}.{scope-slug}.srs.md
```

Example:

```text
docs/spec/01.auth.srs.md
docs/spec/02.agent-loop.srs.md
docs/spec/03.llm-provider.srs.md
docs/spec/04.observability.srs.md
```

Rules:

1. `{NN}` is a zero-padded ordering number, two digits at minimum. A number below ten carries a leading zero, so `01` sorts beside `02` rather than after `10`. A project with more than ninety-nine scope documents continues with three digits.
2. Allocate the number of a new scope document as one above the highest number already present among the project's scope documents. The first scope document of a project is `01`.
3. A number in use is never reused, and an existing document is never renumbered. A gap left by a removed document stays a gap, because the ordering position it held may already be cited elsewhere.
4. Two scope documents must not share a leading number. A document set in which they do is ambiguous to order and is reported as `SRS-W070`.
5. A project that already numbers its documents by tens (`10`, `20`, `30`) is valid and must not be renumbered. Its next document is the number one above its highest, not the next ten.
6. `{scope-slug}` uses lowercase kebab-case.
7. The filename must reveal the meaning of the scope.
8. One file represents one primary scope.
9. Place a cross-scope requirement in the scope document that carries the greatest responsibility for it.

---

## 6. Markdown Syntax Rules

### 6.1 Base Syntax

SRS documents are authored on the basis of GitHub Flavored Markdown, hereafter GFM.

### 6.2 Allowed Syntax

| Markdown Feature | Allowed | Use |
|---|---:|---|
| ATX headings, `#` to `####` | yes | Document, section, and requirement structure |
| Pipe tables | yes | metadata, evidence, trace links |
| Task lists | yes | Acceptance Criteria |
| Bullet lists | yes | Descriptions, notes, analysis links |
| Ordered lists | yes | Procedure descriptions |
| Fenced code blocks | yes | API examples, configuration examples, pseudo-code |
| Inline code | yes | Enums, filenames, endpoints, identifiers |
| Markdown links | yes | Links to documents, issues, PRs, and external material |

### 6.3 Restricted or Forbidden Syntax

| Markdown Feature | Rule | Reason |
|---|---|---|
| YAML front matter | forbidden | The source structure becomes scattered outside the Markdown body |
| Raw HTML | forbidden | Increases the divergence between renderer and parser results |
| Link inside a heading | forbidden | Unstable parsing of Requirement ID and title |
| Emoji inside a heading | forbidden | Unstable parsing of Requirement ID and title |
| Emphasis inside a heading | forbidden, except the tool-written markers of §30.1 and §30.2 | Unstable title normalization |
| Line break inside a metadata table cell | forbidden | Unstable table parser |
| Nested task list | forbidden | Unstable Acceptance Criteria evaluation |
| Complex list inside a metadata table | forbidden | Unstable value extraction |
| Duplicate section heading inside the same requirement | forbidden | Unstable block parser |

### 6.4 Blank Line Rules

1. Put one blank line before a heading.
2. Put one blank line before a table.
3. Put one blank line before and after a fenced code block.
4. Put the metadata table directly below the Requirement heading.
5. Put at most two blank lines between Requirement Blocks.

---

## 7. SRS Index Document Rules

`docs/spec/00.index.md` is the document for navigating the whole requirements document set. This document must not contain long requirement source text.

### 7.1 Required Structure

```md
# SRS Index

| Field | Value |
|---|---|
| Document Type | srs_index |
| Version | 1.0.0 |
| Active Target |  |
| Last Updated | YYYY-MM-DD |

## 1. Purpose

## 2. SRS Documents

## 3. Target Map

## 4. Scope Map

## 5. Status Summary

## 6. Requirement Type Summary

## 7. Completed Work Log

| Date | Target | Scope | Requirement IDs | Summary | Report Paths |
|---|---|---|---|---|---|

## 8. Cross-scope Dependencies

## 9. Open Questions

## 10. Reference Documents
```

The §7 Completed Work Log heading must be present in the index, but its inline data rows are optional. The rows may live in the separate history file `docs/spec/91.completed-work-log.md`, and the parser merges both sources — see §7.4.

### 7.2 SRS Documents Section

```md
## 2. SRS Documents

| Scope | Document | Prefix | Description |
|---|---|---|---|
| Auth | [01.auth.srs.md](./01.auth.srs.md) | AUTH | Authentication, session, and authorization requirements |
| User | [02.user.srs.md](./02.user.srs.md) | USER | Profile and account requirements |
| Payment | [03.payment.srs.md](./03.payment.srs.md) | PAY | Payment, webhook, and settlement requirements |
| Observability | [04.observability.srs.md](./04.observability.srs.md) | OBS | Logging, metrics, and tracing requirements |
```

Rules:

1. Register every Scope SRS document in this table.
2. `Document` uses a relative link.
3. `Prefix` must match the scope segment of the Requirement ID.
4. When a document is deleted or renamed, update the index along with it.

### 7.3 Target Map Section

```md
## 3. Target Map

| Target | Type | Status | Description |
|---|---|---|---|
| v0.1 | version | active | Basic authentication and user features |
| v0.2 | version | planned | Payment webhook and observability improvements |
| MVP | milestone | planned | Minimum features required for the initial release |
```

Target status values:

| Status | Meaning |
|---|---|
| `planned` | Not started yet |
| `active` | Currently in progress |
| `frozen` | The scope is frozen. Changing it requires an explicit review |
| `completed` | The requirements of that target are complete |
| `released` | An immutable baseline target that passed release-readiness |
| `archived` | A past target. Normally not modified |

Rules:

1. The `Active Target` row of the index metadata table must always exist.
2. An empty `Active Target` value means that no active target is selected.
3. When the `Active Target` row exists but its value is empty, do not perform a Target Map fallback.
4. When the `Active Target` value is not empty, it must be one of the `Target` values in the Target Map.
5. The `Status` of the Target Map row that matches `Active Target` must be `active`.
6. A target that is complete and fixed as a release baseline may use `released`; `completed` is used for a target that is complete but has not been formalized as a release baseline.
7. Under the v1.2.0 hardening policy, the whole Target Map allows at most one `active` status row, and multiple active rows are subject to an index consistency diagnostic.

### 7.4 Completed Work Log Section

```md
## 7. Completed Work Log

| Date | Target | Scope | Requirement IDs | Summary | Report Paths |
|---|---|---|---|---|---|
| 2026-05-10 | v1.0.0 | CLI, MCP | IR-CLI-008, FR-MCP-008 | Connected the Active Target read/update UX to the CLI and MCP. | docs/reports/v1.0.0.md |
```

Rules:

1. The Completed Work Log is an index-level summary, not the source of truth for completion decisions.
2. Completion decisions give precedence to the Requirement Block `Status`, Acceptance Criteria, Verification Evidence, and Change Notes.
3. `Date` uses the `YYYY-MM-DD` format.
4. `Target` may be empty, and an empty row is interpreted as cross-target completed work.
5. `Scope` and `Requirement IDs` allow comma-separated values.
6. `Report Paths` is an optional column. The parser must read both the legacy five-column Completed Work Log and the six-column Completed Work Log with a trailing `Report Paths`.
7. The `Report Paths` cell is a comma-separated list of repository-relative POSIX paths. A blank cell is interpreted as an empty array.
8. A report path token must not use an absolute path, a `./` or `../` prefix, a `..` segment, a URL scheme, a backslash, a pipe, a comma, CR/LF, `#`, or a value that is empty after trimming.
9. Report a malformed report path as an `SRS-W024` warning. A report path is Completed Work Log summary metadata and is not Verification Evidence.
10. Do not put the pipe character `|` in a table cell.
11. The Completed Work Log may live inline in `00.index.md` §7, in the separate history file `docs/spec/91.completed-work-log.md`, or in both. The parser reads both sources and merges them into one completed-work list (dual-read).
12. The history file is a plain `.md` rather than a `.srs.md`, so it is not discovered as a scope or step file. It carries a read-only summary banner above its heading, stating that it is not the source of truth for completion decisions, and it follows the same table grammar as §7 — both the legacy five-column form and the six-column form with a trailing `Report Paths`.
13. The merge is an append-concatenation: index rows first, then history rows. Sorting and de-duplication happen in the query layer. A row duplicated across both sources — identical `Date`, `Target`, `Requirement IDs`, and `Summary` — is de-duplicated and reported as an `SRS-W025` warning.
14. A new completed-work row is written only to the history file, bootstrapping the file with its banner when it is absent. Inline index rows continue to be read for backward compatibility but are no longer written. Migrating inline rows into the history file is opt-in and defaults to a dry run.
15. The history file is an append-only summary. It is per-row and status-independent, and it does not weaken the prohibition on bulk finalization in §30.3.
16. The §7 Completed Work Log diagnostics (`SRS-W011` through `SRS-W015`, and `SRS-W024`) report the originating file of each entry — the history file or the index — as the diagnostic location.

Target type values:

| Type | Meaning |
|---|---|
| `version` | A product or software version |
| `release` | A deployment bundle |
| `milestone` | A schedule-based or achievement-based milestone |
| `phase` | A development phase |
| `objective` | A specific objective |
| `experiment` | An experiment or validation stage |

---

## 8. Scope SRS Document Rules

A Scope SRS is the source of truth for the requirements of one functional scope.

### 8.1 Required Structure

```md
# Auth SRS

| Field | Value |
|---|---|
| Document Type | scope_srs |
| Scope | AUTH |
| Scope Name | Authentication |
| Version | 1.0.0 |
| Last Updated | YYYY-MM-DD |

## 1. Scope Overview

## 2. Scope Boundaries

## 3. Assumptions and Constraints

## 4. Requirements

## 5. Cross-scope Dependencies

## 6. Open Questions

## 7. Change Notes
```

### 8.2 Scope Overview

The Scope Overview describes the functional area that this document covers.

Authoring example:

```md
## 1. Scope Overview

This document defines the requirements related to user authentication, login sessions, token refresh, and authorization checks.
```

### 8.3 Scope Boundaries

Scope Boundaries distinguish what is in scope from what is out of scope.

```md
## 2. Scope Boundaries

### In Scope

- User login
- Session expiration handling
- Refresh token rotation
- Protected API access control

### Out of Scope

- Administrator permission model
- Payment authorization policy
- External SSO integration
```

### 8.4 Assumptions and Constraints

```md
## 3. Assumptions and Constraints

- The server operates in an HTTPS environment.
- Access tokens have a short lifetime.
- The refresh token storage method follows `docs/tech/auth-token-design.md`.
```

### 8.5 Requirements

Place every Requirement Block under `## 4. Requirements`.

The parser reads Requirement Block headings only inside a section whose title names requirements. A well-formed block placed in any other section is not parsed as a requirement: its id cannot be listed, shown or mutated. Such a heading is reported as `SRS-W071` — a warning rather than an error, because an illustrative heading elsewhere in a document is legitimate. Move the block into the Requirements section, or rename the heading so it is not requirement-shaped.

### 8.6 Cross-scope Dependencies

Summarize the main dependencies on other scopes at the document level.

```md
## 5. Cross-scope Dependencies

| From | To | Relation | Notes |
|---|---|---|---|
| AUTH | USER | depends_on | Reads user summary information after authentication. |
| AUTH | OBS | requires | Authentication failures and token errors must be recorded in logs. |
```

---

## 9. Requirement Block Overview

The Requirement Block is the smallest management unit of SRS-MD.

A block starts with the following heading.

```md
### FR-AUTH-001 — Require re-login when the session expires
```

The metadata table comes after the heading.

```md
| Field | Value |
|---|---|
| Type | functional |
| Target | v0.1 |
| Status | planned |
```

The fixed sections come next.

```md
#### Requirement

#### Rationale

#### Acceptance Criteria

#### Verification Evidence

#### Trace Links

#### Research / Analysis

#### Implementation Notes

#### Change Notes
```

### 9.1 Requirement Block Boundaries

A Requirement Block ends when it meets one of the following.

1. The next `### {RequirementID} — {Title}` heading
2. The end of the current Scope SRS file

Therefore, do not use a `###` heading inside a Requirement Block. Sections inside a Requirement Block must use a `####` heading.

---

## 10. Requirement Heading Rules

### 10.1 Format

A requirement heading must follow the following format.

```md
### {RequirementID} — {Title}
```

Example:

```md
### FR-AUTH-001 — Require re-login when the session expires
```

### 10.2 Regular Expression

The heading is recognised with the following regular expression. The type prefix is the closed set in §11.2, not an open run of capitals, and the optional trailing group is the marker slot that §30.1 and §30.2 write:

```regex
^###\s+(~~)?((?:FR|NFR|IR|DR|SEC|PERF|REL|OBS|OPS|MIG|CON)-[A-Z0-9][A-Z0-9-]{1,24}-[0-9]{3,4})\s+—\s+(.+?)(~~)?\s*(?:\[(DISCARDED|DRAFT)(?:[^\]]*)\])?\s*$
```

A heading written to a looser pattern — a type prefix outside the closed set, for instance — parses as prose rather than as a requirement, and the requirement it was meant to declare goes unseen.

### 10.3 Heading Rules

1. Use a three-level `###` heading.
2. Use an em dash `—` between the ID and the Title.
3. Do not use a hyphen `-`, an en dash `–`, or a colon `:`.
4. The title must be a single line.
5. Do not put a link, emoji, emphasis, or inline code in the title.
6. The title must express the core outcome of the requirement.
7. A title of 80 characters or fewer is recommended.
8. Rule 5 does not reach the heading strikethrough and the `[DISCARDED]` / `[DRAFT — pending decision]` markers of §30.1 and §30.2. Those are written and removed by the status and stability mutations, and a consumer must not add or strip them by hand.

---

## 11. Requirement ID Rules

### 11.1 Base Format

```text
{PREFIX}-{SCOPE}-{NNN}
```

Example:

```text
FR-AUTH-001
SEC-AUTH-001
IR-PAY-001
PERF-SEARCH-001
OBS-AGENT-001
```

### 11.2 ID Regular Expression

```regex
^(FR|NFR|IR|DR|SEC|PERF|REL|OBS|OPS|MIG|CON)-[A-Z0-9][A-Z0-9-]{1,24}-[0-9]{3,4}$
```

### 11.3 Prefix and Type Mapping

| Prefix | Type | Meaning |
|---|---|---|
| `FR` | `functional` | Functional requirement |
| `NFR` | `non_functional` | General non-functional requirement |
| `IR` | `interface` | External API, internal API, UI boundary, integration interface |
| `DR` | `data` | Data model, storage, retrieval, consistency, retention |
| `SEC` | `security` | Authentication, authorization, encryption, security policy |
| `PERF` | `performance` | latency, throughput, resource usage |
| `REL` | `reliability` | Failure recovery, fault tolerance, retry, availability |
| `OBS` | `observability` | logging, metrics, tracing, alerting |
| `OPS` | `operational` | Deployment, operations, configuration, runbook |
| `MIG` | `migration` | Data or system migration |
| `CON` | `constraint` | Technical, legal, organizational, and environmental constraints |

### 11.4 ID Operation Rules

1. A Requirement ID must be globally unique across the whole repository.
2. Do not reuse a discarded ID.
3. Keep the ID even when the wording of the same requirement is modified.
4. When a requirement is split in two, create a new ID.
5. When merging multiple requirements, keep one representative ID and handle the rest with `discarded` or `Superseded By`.
6. The prefix of the ID and the `Type` in the metadata table must match.
7. The scope segment of the ID must match a prefix registered in the Scope Map of the SRS Index.

---

## 12. Metadata Table Rules

### 12.1 Base Format

Put the metadata table directly below the Requirement heading.

```md
| Field | Value |
|---|---|
| Type | functional |
| Target | v0.1 |
| Status | planned |
| Priority | high |
| Tags | auth, session, security |
```

### 12.2 Required Fields

| Field | Required | Description |
|---|---:|---|
| `Type` | yes | The requirement type. It must match the ID prefix. |
| `Target` | yes | The target version, release, milestone, phase, or objective. |
| `Status` | yes | The progress status of the requirement. |

### 12.3 Recommended Fields

| Field | Required | Description |
|---|---:|---|
| `Priority` | no | The priority. |
| `Tags` | no | Comma-separated tags for search and classification. |
| `Scope` | no | The scope code. State it explicitly when it differs from the primary scope of the file. |
| `Owner` | no | The owner, team, or role. |
| `Risk` | no | The risk level. |
| `Stability` | no | The stability of the requirement. |
| `Verification Method` | no | The verification method. |
| `GitHub Issue` | no | The tracking issue URL. |
| `Related Docs` | no | Links to related analysis, technical, and decision documents. |
| `Source` | no | The origin of the requirement. |
| `Supersedes` | no | The ID of the requirement that this requirement supersedes. |
| `Superseded By` | no | The ID of the requirement that supersedes this requirement. |
| `Last Reviewed` | no | The last review date, `YYYY-MM-DD`. |

### 12.4 Metadata Value Rules

1. Field names use the exact English key.
2. Write field values on a single line.
3. Do not put a line break inside a table cell.
4. Use `-` when there is no value.
5. Write `Tags` as comma-separated values.
6. Write `Related Docs` as a list of Markdown links.
7. Do not write long, complex sentences inside the metadata table.
8. Write detailed explanations that do not belong in the metadata table in the body sections.

---

## 13. Type Rules

Allowed Type values:

| Type | Meaning |
|---|---|
| `functional` | Functional behavior that a user sees or that the system performs |
| `non_functional` | A general non-functional requirement that does not belong to a specific quality attribute |
| `interface` | API, UI, protocol, external system boundary |
| `data` | Data structure, storage, retrieval, consistency, retention |
| `security` | Authentication, authorization, secret management, security controls |
| `performance` | Response time, throughput, load, resource usage |
| `reliability` | Failure recovery, retry, availability, consistency maintenance |
| `observability` | Logs, metrics, tracing, alerting |
| `operational` | Deployment, configuration, operations, runbook, admin task |
| `migration` | Data or system transition |
| `constraint` | Implementation method, technical, legal, organizational, and environmental constraints |

Rules:

1. Type values use lowercase snake_case.
2. The Type must match the ID prefix.
3. When a requirement spans two or more Types, choose one primary Type and support the rest with `Tags` or `Trace Links`.
4. When functional behavior and a quality criterion appear together, split the requirement.

---

## 14. Status Rules

### 14.1 Allowed Status Values

| Status | Meaning |
|---|---|
| `planned` | The requirement is defined but not yet implemented |
| `in_progress` | Implementation is in progress |
| `blocked` | Implementation or verification is blocked |
| `implemented` | Code implementation is complete but verification evidence is insufficient |
| `verified` | The acceptance criteria are satisfied and verification evidence is linked |
| `discarded` | Discarded. Recommended instead of physical deletion |

### 14.2 Status Transitions

Allowed normal transitions:

```text
planned -> in_progress
planned -> discarded
in_progress -> blocked
blocked -> in_progress
in_progress -> implemented
implemented -> in_progress
implemented -> verified
verified -> in_progress
verified -> discarded
```

### 14.3 implemented Conditions

To change to `implemented`, at least one of the following must exist.

1. A link to the related Pull Request
2. A link or path to the related implementation file
3. The related commit, branch, or code location
4. Implementation Notes left by the implementer

`implemented` does not mean “verification complete”.

### 14.4 verified Conditions

To change to `verified`, all of the following conditions must be satisfied.

1. The `#### Acceptance Criteria` section exists.
2. At least one acceptance criterion exists.
3. Every acceptance criterion is in the `- [x]` state.
4. The `#### Verification Evidence` section exists.
5. The Verification Evidence table has at least one evidence row.
6. The `Reference` value of the evidence row is not empty.
7. Where possible, each AC is covered in the `Covers` column of the evidence either directly or by `all`.

---

## 15. Priority, Risk, and Stability Rules

### 15.1 Priority

| Priority | Meaning |
|---|---|
| `critical` | Absolutely required to achieve the target; release is impossible if it is missing |
| `high` | Important to core functionality or quality |
| `medium` | A normal requirement |
| `low` | A lower-priority requirement |
| `optional` | An optional improvement |

### 15.2 Risk

| Risk | Meaning |
|---|---|
| `low` | Implementation and verification risk is low |
| `medium` | Some uncertainty exists |
| `high` | Technical, schedule, policy, or external dependency risk is large |
| `critical` | A serious risk to the target or to system stability |

When `Risk = high` or `Risk = critical`, linking a rationale document in `Research / Analysis` or `Trace Links` is recommended.

### 15.3 Stability

Canonical `Stability` values are:

| Stability | Meaning |
|---|---|
| `draft` | A draft that must not yet be trusted as an implementation contract |
| `evolving` | Still being made concrete, but reviewable as an implementation candidate |
| `stable` | Stable enough to be implemented |
| `frozen` | Frozen within the target scope. A change requires review |
| `deprecated` | Can still be looked up explicitly, but excluded from new work candidates |

Legacy compatibility:

- `volatile` is a legacy value kept for compatibility with older documents.
- A new Requirement Block must not produce `volatile`.
- The validator reports an unknown `Stability` as an error, and reports legacy `volatile` as a migration warning.
- A `verified` requirement must not be `Stability=draft`.
- When a non-discarded `draft` requirement is in an active or released target, report a stability warning.
- An agent must not start implementing a non-discarded `draft` or `deprecated` requirement unless the user explicitly overrides that.

---

## 16. Target Rules

A Target means the implementation goal, release, version, phase, or milestone that a requirement belongs to.

Example:

```text
MVP
v0.1
v0.2
alpha-1
2026-Q2
phase-1
```

Rules:

1. By default, one requirement has only one `Target`.
2. Split a requirement that spans multiple targets as far as possible.
3. Register every Target value in the Target Map of `docs/spec/00.index.md`.
4. An unregistered Target is a validation warning.
5. When changing a requirement that belongs to a `frozen` target, record the reason for the change in `Change Notes`.
6. When the target changes, do not change only the `Target` row of the Requirement Block; also update `Rationale` or `Change Notes` when needed.

---

## 17. Tags Rules

Tags are a supplementary attribute that aids search and classification.

Example:

```md
| Tags | auth, session, security |
```

Rules:

1. Use comma-separated values.
2. lowercase kebab-case is recommended.
3. Trim the whitespace before and after a tag.
4. A tag does not replace status or target.
5. Five or fewer tags are recommended.
6. Do not use duplicate tags.
7. Unify tags that have the same meaning into one. Example: choose one of `login` and `sign-in`.

---

## 18. Requirement Section Rules

### 18.1 Fixed Section List

Sections inside a Requirement Block use the following headings.

| Section | Required | Purpose |
|---|---:|---|
| `#### Requirement` | yes | The requirement statement |
| `#### Rationale` | recommended | Why the requirement is needed |
| `#### Acceptance Criteria` | yes | Verifiable acceptance criteria |
| `#### Verification Evidence` | required for `implemented`, `verified` | Implementation or verification evidence |
| `#### Trace Links` | recommended | Relationships to issues, PRs, code, documents, and other requirements |
| `#### Research / Analysis` | optional | Investigation, comparison, analysis, and experiment rationale |
| `#### Implementation Notes` | optional | Details for the implementer to refer to |
| `#### Change Notes` | optional | A summary of the requirement change history |

### 18.2 Section Heading Rules

1. A section heading must use `####`.
2. Do not change section heading names.
3. Do not write the same section twice inside the same Requirement Block.
4. When a required section is empty, a validation error or warning occurs.

---

## 19. Requirement Statement Authoring Rules

### 19.1 Base Sentence Pattern

When the condition is stated ahead of the behavior, the following pattern is recommended.

```text
The system shall, in {condition/context}, {perform/provide/guarantee} {behavior/result/constraint}.
```

When the behavior is stated first and the condition trails it, the following pattern is recommended.

```text
The system shall {behavior/result/constraint} when {condition/context}.
```

### 19.2 Good Example

```md
#### Requirement

The system shall return an HTTP 401 response for a request whose access token has expired.
```

Why it is good:

1. The system behavior is clear.
2. The condition is clear.
3. The expected result is clear.
4. It is testable.

### 19.3 Bad Example

```md
#### Requirement

The system shall handle tokens appropriately.
```

Why it is bad:

1. The meaning of “appropriately” is unclear.
2. Which token is meant is unclear.
3. What result is expected is unclear.
4. It is hard to build verification criteria.

### 19.4 Forbidden or Warned Expressions

Avoid the following expressions where possible.

| Expression | Reason |
|---|---|
| appropriately | The judgment criterion is unclear |
| sufficiently | There is no measurement criterion |
| quickly | There is no performance criterion |
| securely | There is no security criterion |
| user-friendly | There is no UX criterion |
| in most cases | The range of the condition is unclear |
| if possible | Whether it is mandatory is unclear |
| if needed | The condition is unclear |
| later | The target is unclear |
| for now | Whether the requirement is temporary is unclear |

When such an expression is necessary, make the criterion concrete in the Acceptance Criteria or the Measurement Criteria.

---

## 20. Quality Criteria for Good Requirements

A requirement must satisfy the following criteria.

| Quality | Rule |
|---|---|
| Atomic | One requirement contains only one verifiable demand. |
| Verifiable | It can be confirmed by at least one of test, analysis, inspection, demonstration, or review. |
| Unambiguous | It does not give rise to differing interpretations. |
| Necessary | It is connected to an actual system goal, quality, constraint, user value, or operational need. |
| Feasible | It is implementable within the current technology, schedule, and environment. |
| Bounded | Its scope of application and its exclusions are clear. |
| Consistent | It does not conflict with other requirements. |
| Traceable | It can be linked to issues, PRs, tests, code, docs, and other requirements. |
| Reviewable | A reviewer can quickly judge the change scope and the verification criteria. |
| Maintainable | It is traceable in a Git diff with minimal changes. |

---

## 21. Acceptance Criteria Rules

### 21.1 Base Format

Acceptance Criteria must be written as a task list.

```md
#### Acceptance Criteria

- [ ] AC-1: Calling `GET /api/me` with an expired access token returns HTTP 401.
- [ ] AC-2: Calling `GET /api/me` with a valid access token returns HTTP 200 and the user summary information.
- [ ] AC-3: Re-requesting with an expired token does not restore the session.
```

### 21.2 AC ID Rules

1. The `AC-{N}:` format is recommended for each item.
2. Numbers increase from 1 within a Requirement Block.
3. When an item in the middle is deleted, renumbering is allowed.
4. AC IDs may be referenced from the `Covers` column of Verification Evidence.

### 21.3 Authoring Rules

1. Write at least one.
2. One AC expresses only one expected result.
3. Where possible, include the condition, the input, and the expected result.
4. A non-functional requirement includes a measurable criterion.
5. In the `verified` status, every AC must be `- [x]`.
6. Deleting an AC in order to meet the `verified` conditions is forbidden. When the criterion has changed, record the reason in `Change Notes`.

### 21.4 Functional Requirement AC Example

```md
- [ ] AC-1: When a signed-out user calls a protected API, HTTP 401 is returned.
- [ ] AC-2: When a signed-in user calls the same API, HTTP 200 is returned.
- [ ] AC-3: The 401 response does not expose the authentication failure reason.
```

### 21.5 Performance Requirement AC Example

```md
- [ ] AC-1: A load test confirms that the p95 response time is 300ms or less.
- [ ] AC-2: Confirm that the error rate is 1% or less under a condition of 500 concurrent users.
```

### 21.6 Security Requirement AC Example

```md
- [ ] AC-1: Refresh tokens are not recorded in logs in plaintext.
- [ ] AC-2: Only hashed or encrypted values are stored in the refresh token store.
- [ ] AC-3: When token rotation fails, the existing token becomes unusable for reuse.
```

---

## 22. Verification Evidence Rules

### 22.1 Base Format

```md
#### Verification Evidence

| Evidence ID | Type | Reference | Covers | Notes |
|---|---|---|---|---|
| VE-1 | Test | `src/test/AuthSessionExpirationTest.java` | AC-1, AC-2 | Session expiration API test |
| VE-2 | PR | https://github.com/org/repo/pull/456 | all | Implementation and test PR |
```

### 22.2 Evidence Type

| Type | Meaning |
|---|---|
| `Test` | A test file, test case, or test execution result |
| `PR` | An implementation or verification Pull Request |
| `Issue` | A requirement tracking issue |
| `Code` | A core implementation file or code location |
| `Review` | A review result, approval, or checklist |
| `Analysis` | An analysis document, experiment result, or benchmark |
| `Demo` | A demo video, screenshot, or demonstration record |
| `Monitoring` | An operational log, metric, alert, or dashboard |
| `Manual` | A manual verification record |

### 22.3 Evidence ID Rules

1. The `VE-{N}` format is recommended for an Evidence ID.
2. Numbers increase from 1 within a Requirement Block.
3. Use `AC-1`, `AC-2`, `all`, or `-` in `Covers`.
4. In the `verified` status, `Covers = all`, or having every AC covered by evidence, is recommended.

### 22.4 Evidence Reference Rules

1. Write a local file as an inline code path. Example: `` `src/auth/session.ts` ``.
2. Write a GitHub Issue or PR as a URL.
3. Write a document as a Markdown link.
4. Do not write a file path that does not exist.
5. Do not write a false URL.
6. When evidence does not yet exist, do not change the status to `verified`.

---

## 23. Trace Links Rules

Trace Links record the relationship between a requirement and an external artifact or another requirement.

### 23.1 Base Format

```md
#### Trace Links

| Type | Reference | Relation | Notes |
|---|---|---|---|
| Issue | https://github.com/org/repo/issues/123 | tracks | Tracks the session expiration requirement |
| PR | https://github.com/org/repo/pull/456 | implements | Implementation PR |
| Requirement | IR-FE-ROUTER-001 | depends_on | Depends on frontend routing handling |
| Doc | [Session policy analysis](../analysis/session-timeout-analysis.md) | informed_by | Policy decision rationale |
```

### 23.2 Trace Type

| Type | Meaning |
|---|---|
| `Issue` | A GitHub Issue, Linear ticket, Jira ticket, and the like |
| `PR` | Pull Request |
| `Commit` | Git commit |
| `Code` | A source file or code location |
| `Test` | A test file or test result |
| `Doc` | An analysis document, technical document, or operations document |
| `ADR` | architecture decision record |
| `Requirement` | Another requirement ID |
| `External` | An external standard, external document, or vendor document |

### 23.3 Relation Values

| Relation | Meaning |
|---|---|
| `tracks` | An issue or ticket tracks the requirement. |
| `implements` | A PR, commit, or code implements the requirement. |
| `verifies` | A test, review, analysis, or demo verifies the requirement. |
| `depends_on` | This requirement depends on another requirement. |
| `blocks` | This requirement blocks another requirement. |
| `conflicts_with` | It conflicts with another requirement. |
| `refines` | It makes another requirement more concrete. |
| `generalizes` | It generalizes another requirement further. |
| `supersedes` | It supersedes an existing requirement. |
| `superseded_by` | It is superseded by another requirement. |
| `informed_by` | It was informed by a document, an analysis, or external rationale. |
| `related_to` | A general related relationship. |
| `checked_compatible` | A compatibility cache row recording that two requirements were consistent with each other at a particular content revision. See §23.5. |

### 23.4 Relationship Rules

1. A `Requirement` reference must be a Requirement ID that actually exists.
2. Do not reference itself.
3. When a `depends_on` relationship forms a cycle, treat it as a warning or higher.
4. For a `conflicts_with` relationship, record the resolution plan in `Open Questions` or `Change Notes`.
5. When using `supersedes` or `superseded_by`, also updating `Supersedes` or `Superseded By` in the metadata is recommended.

### 23.5 checked_compatible (compatibility cache)

`checked_compatible` is an advisory cache relation recording that two requirements were consistent with each other at a particular content revision, identified by a `semanticSha`. Unlike the other relations it follows the rules below.

1. **Notes token grammar.** The `Notes` cell of the Trace Links row holds `key: value` items separated by `; ` (a semicolon and a space), and a key uses lowercase letters and hyphens only. The recognised keys are `fpv` (the formula version, for example `fpv1`), `self` (this requirement's semanticSha), `peer` (the other requirement's semanticSha), and `checked-at` (the time or marker of the check). The value character set is restricted to alphanumerics, hyphen, colon, and dot; arbitrary text is not accepted. The general cell-safety rule that rejects `|`, CR, and LF is not sufficient on its own, so a dedicated tokeniser enforces the character set.

2. **semanticSha normalisation contract (`fpv1`).** The `self` and `peer` pins are normalised content hashes of a requirement. Normalisation converts CRLF to LF, strips trailing whitespace from each line, collapses each run of whitespace to one space, and trims the ends. The hash input is the normalised requirement statement, the Acceptance Criteria text excluding their checked state, the scope, and the metadata excluding `Status` and `Stability`. Status and stability are deliberately excluded, so a lifecycle transition alone does not invalidate a pin — and neither does it re-validate one. Trace Links, Verification Evidence, and Change Notes are excluded too, so recording a check does not by itself invalidate the pin it records.

3. **Validation treatment.** A `checked_compatible` row is validated for referential existence only: the referenced Requirement ID must exist. Liveness — whether a pin has gone stale against the current content, and the status or stability of either endpoint — is not enforced and never blocks a release gate. A stale or missing pin surfaces as advisory data through the compatibility edge listing rather than as a validation error. Create, refresh, and revoke these rows with the dedicated compatibility mutations rather than by editing the table.

---

## 24. Research / Analysis Rules

### 24.1 Purpose

Research / Analysis links the investigation, experiment, comparison, technical analysis, and decision rationale that support a requirement.

### 24.2 Base Format

```md
#### Research / Analysis

- [Session expiration policy analysis](../analysis/session-timeout-analysis.md)
- [Comparison of JWT and opaque tokens](../analysis/token-strategy-comparison.md)
- [ADR on the token storage method](../adr/0001-use-session-cookie.md)
```

### 24.3 Rules

1. Research / Analysis is not required.
2. Writing it is recommended when `Risk = high`, `Risk = critical`, or `Stability = draft`.
3. When it depends on an external system, a vendor API, a security policy, or a performance figure, link the rationale document.
4. When the conclusion of an analysis document changes, re-review the linked requirements.
5. Do not put the research content itself at length into the Requirement Statement.

---

## 25. Implementation Notes Rules

Implementation Notes are the details for the implementer to refer to. This section is not the requirement itself.

```md
#### Implementation Notes

- The backend middleware detects token expiration.
- Frontend redirect handling is covered by `IR-FE-ROUTER-001`.
- The test uses an expired token fixture.
```

Rules:

1. Do not hide mandatory behavior that belongs in the Requirement Statement inside Implementation Notes.
2. When the implementation method is a mandatory condition, split it into a separate `constraint` requirement.
3. The meaning of the requirement must not change even when the implementation details change.
4. When implementation notes become excessively long, split them into `docs/tech/*.md`.

---

## 26. Change Notes Rules

Change Notes briefly record the reason for and the impact of a requirement change. Git is responsible for the detailed change history.

```md
#### Change Notes

| Date | Change | Reason |
|---|---|---|
| 2026-05-07 | Changed Target from `v0.1` to `v0.2` | Delay in finalizing the refresh token policy |
| 2026-05-10 | Added AC-3 | Need to prevent session restoration on re-request |
```

Rules:

1. It is not necessary to record every trivial wording fix.
2. Record it when the meaning of Target, Status, Acceptance Criteria, or Requirement Statement changes.
3. When a requirement of a `frozen` target is modified, write Change Notes.
4. Write the reason for the change concretely.

---

## 27. Complete Requirement Block Example

```md
### FR-AUTH-001 — Require re-login when the session expires

| Field | Value |
|---|---|
| Type | functional |
| Target | v0.1 |
| Status | in_progress |
| Priority | high |
| Tags | auth, session, security |
| Risk | medium |
| Stability | stable |
| Verification Method | test, inspection |
| GitHub Issue | https://github.com/org/repo/issues/123 |
| Related Docs | [Session policy analysis](../analysis/session-timeout-analysis.md), [Token design](../tech/auth-token-design.md) |

#### Requirement

The system shall return an HTTP 401 response for a request whose access token has expired.

#### Rationale

If access to protected APIs continues to be allowed in an expired authentication state, security and user state consistency problems arise.

#### Acceptance Criteria

- [ ] AC-1: Calling `GET /api/me` with an expired access token returns HTTP 401.
- [ ] AC-2: The HTTP 401 response does not expose the refresh token value.
- [ ] AC-3: Re-requesting with an expired access token does not restore the session.

#### Verification Evidence

| Evidence ID | Type | Reference | Covers | Notes |
|---|---|---|---|---|
| VE-1 | Test | `src/test/AuthSessionExpirationTest.java` | AC-1, AC-3 | Session expiration API test |
| VE-2 | Review | https://github.com/org/repo/pull/456 | AC-2 | Security response field review |

#### Trace Links

| Type | Reference | Relation | Notes |
|---|---|---|---|
| Issue | https://github.com/org/repo/issues/123 | tracks | Session expiration requirement |
| PR | https://github.com/org/repo/pull/456 | implements | Implementation PR |
| Doc | [Session policy analysis](../analysis/session-timeout-analysis.md) | informed_by | Policy decision rationale |

#### Research / Analysis

- [Session policy analysis](../analysis/session-timeout-analysis.md)
- [Token design](../tech/auth-token-design.md)

#### Implementation Notes

- The authentication middleware determines access token expiration.
- The refresh token reissue flow is covered by a separate requirement.

#### Change Notes

| Date | Change | Reason |
|---|---|---|
| 2026-05-07 | Initial authoring | Definition of authentication scope v0.1 |
```

---

## 28. Non-functional Requirement Authoring Rules

A non-functional requirement includes a measurable criterion as far as possible.

### 28.1 Performance

```md
### PERF-SEARCH-001 — Search response time criterion

| Field | Value |
|---|---|
| Type | performance |
| Target | v0.2 |
| Status | planned |
| Priority | high |
| Tags | search, performance |
| Verification Method | test, analysis |

#### Requirement

The system shall keep the p95 response time of a normal search request at 500ms or less on an index of 10,000 documents.

#### Rationale

When search responses are slow, the implementer's flow of exploring requirements is broken.

#### Acceptance Criteria

- [ ] AC-1: In a benchmark using a 10,000-document fixture, the p95 response time is 500ms or less.
- [ ] AC-2: The benchmark result is recorded in `docs/analysis/search-benchmark.md`.
```

### 28.2 Security

```md
### SEC-AUTH-001 — Forbid authentication token exposure in logs

| Field | Value |
|---|---|
| Type | security |
| Target | v0.1 |
| Status | planned |
| Priority | critical |
| Tags | auth, token, logging |
| Verification Method | test, inspection |

#### Requirement

The system shall not record raw access tokens and refresh tokens in the application log.

#### Acceptance Criteria

- [ ] AC-1: The authentication failure log does not contain a raw token.
- [ ] AC-2: The debug log does not contain a raw token either.
- [ ] AC-3: A related logging test exists.
```

### 28.3 Observability

```md
### OBS-AUTH-001 — Record authentication failure metrics

| Field | Value |
|---|---|
| Type | observability |
| Target | v0.1 |
| Status | planned |
| Priority | medium |
| Tags | auth, metrics |
| Verification Method | test, monitoring |

#### Requirement

The system shall record authentication failure events as metrics broken down by cause.

#### Acceptance Criteria

- [ ] AC-1: An expired-token failure is recorded as `auth_failure_total{reason="expired"}`.
- [ ] AC-2: An invalid-signature failure is recorded as `auth_failure_total{reason="invalid_signature"}`.
- [ ] AC-3: A metric label does not contain a raw token or user secret information.
```

---

## 29. Requirement Splitting and Merging Rules

### 29.1 Cases That Must Be Split

Split the requirement in the following cases.

1. Different actors are involved.
2. Different system boundaries are involved.
3. Different verification methods are required.
4. Functional behavior and a performance criterion are mixed together.
5. A single AC list becomes too long.
6. They must be placed in different targets.
7. One part is implemented while another part is blocked.

### 29.2 Cases That May Be Merged

Merging is allowed in the following cases.

1. The two requirements demand effectively the same behavior.
2. Even though they are separate, their verification criteria are completely identical.
3. One is a simple repetition of the other.
4. Keeping them causes duplicate implementation or conflict.

### 29.3 Merge Handling

Keep the representative requirement and leave the removed requirement in the `discarded` status.

```md
| Status | discarded |
| Superseded By | FR-AUTH-001 |
```

Add the following to the Trace Links of the representative requirement.

```md
| Requirement | FR-AUTH-009 | supersedes | Merge of a duplicate requirement |
```

---

## 30. Deletion and Discard Rules

By default, handle requirement deletion as a change to the `discarded` status rather than as physical deletion.

Cases where physical deletion is allowed:

1. The requirement was added by mistake.
2. There is no related issue, PR, test, code, or evidence.
3. No other requirement references it.
4. It has no separate tracking value beyond Git history.

Otherwise, discard it as follows.

```md
| Status | discarded |
```

Record the reason for discarding in `Change Notes`.

```md
#### Change Notes

| Date | Change | Reason |
|---|---|---|
| 2026-05-07 | Changed Status to `discarded` | Merged into `FR-AUTH-001` |
```

### 30.1 Discarded Marker

When an `update_status` mutation moves a requirement to `Status=discarded`, the following marker is applied automatically to that Requirement Block's heading. The author never has to attach the marker with a separate `Edit`: one mutation call completes as one line patch, which preserves the Markdown-as-source principle in §2.1.

Base transformation:

```text
### REQ-ID — Title
  →  ### ~~REQ-ID — Title~~ [DISCARDED]
```

When a single `supersedes` trace link exists:

```text
### ~~REQ-ID — Title~~ [DISCARDED → see REQ-Y]
```

When several `supersedes` trace links exist, the count of the remaining ones is written as `+N`:

```text
### ~~REQ-ID — Title~~ [DISCARDED → see REQ-Y +2]
```

`REQ-Y` is the requirement that supersedes this one, and `N` is the number of further requirements that also supersede it. The successor is found by looking for rows that point **at** this requirement, not by reading this requirement's own table:

- Scan every requirement in the repository for a `Trace Links` row matching `Type=Requirement`, `Relation=supersedes`, `Reference=<this requirement's ID>`.
- Order the matches by source file path and then by line.
- The **owning** requirement of the first match — the one whose block the row sits in — fills the `see` slot.
- The number of remaining matches is `N`.

This is the direction §29.3 already asks you to author: the row lives on the requirement that supersedes, not on the one being superseded. A `supersedes` row placed in the discarded requirement's own table names no successor and leaves the marker bare.

On revival — a transition to any other status — the mutation removes both the strikethrough (`~~`) and the `[DISCARDED ...]` marker, restoring the original `### REQ-ID — Title` form.

Because the marker is part of the heading the tool writes, the heading emphasis restriction in §6.3 and §10.3 does not apply to it. A consumer must not strip a tool-written marker by hand: doing so breaks the coupling between the heading and the `Status` row that the mutation maintains.

### 30.2 Draft Marker

Any requirement at `Stability=draft` carries this marker, whether it reached draft by an `update_stability` mutation or was created that way. The marker states the stability, not how the requirement arrived at it. Unlike the discarded marker, no strikethrough is applied.

When `add_requirement` omits `stability` the tool applies `draft`, so a requirement created without an explicit stability is written with this marker and is subject to the draft gates in §14 and §30.2.

Base transformation:

```text
### REQ-ID — Title
  →  ### REQ-ID — Title [DRAFT — pending decision]
```

When a single `conflicts_with` trace link exists:

```text
### REQ-ID — Title [DRAFT — pending decision, see REQ-Y]
```

When several `conflicts_with` trace links exist:

```text
### REQ-ID — Title [DRAFT — pending decision, see REQ-Y +1]
```

The `see` slot and the `+N` count follow the same four steps as §30.1, matching `Relation=conflicts_with` rows that point at this requirement.

When the stability leaves draft, the mutation removes the `[DRAFT ...]` marker, restoring the original `### REQ-ID — Title` form.

### 30.3 Tool Compliance

The mutation, parser, validator, and renderer must recognise and produce the §30.1 and §30.2 notation together. An `update_status` call applies the following as a single line-patch transaction:

1. Toggle the marker on the heading line.
2. Update the `Status` row of the metadata table.
3. Append a row to the `Change Notes` table, when the call supplies a change note.

The three changes are applied on one snapshot with a temp-file-and-rename atomic write, so a partially applied result is not possible.

**One mutation targets one requirement.** A mutation tool takes a single Requirement ID per call. Do not introduce or expose a bulk-archive or bulk-finalize tool that flips the `Status` or `Stability` of several requirements at once, or that empties the Active Target in one call. Such a tool becomes a route around the per-requirement evidence and stability gates. Express an operational scenario such as a release cleanup as repeated per-requirement calls, reporting through a dry run first.

**Mutation tool kinds.** The policy is expressed as a classification rather than as a negotiated exception list. Every mutation tool declares exactly one of three kinds in its schema metadata:

- `req-scoped` — atomically changes one Requirement Block. An `id` is required and an array is rejected. Examples: `update_status`, `update_stability`, `check_acceptance_criteria`, `add_verification_evidence`, `add_trace_link`, `append_section_note`.
- `log-append` — appends a row to an aggregate table. A legitimate array input such as `requirementIds` is allowed, because it carries no status or stability change. Example: `add_completed_work`.
- `workspace` — updates workspace or target scoped metadata and takes no `id`. Examples: `set_active_target`, `set_target_goal`, `init_project`, and `add_requirement`, which creates a new requirement rather than mutating a single existing one.

A tool classified `req-scoped` rejects an array `id` at schema validation. A new mutation tool must declare one of the three kinds.

### 30.4 Non-standard Markers

An existing SRS may carry notation that differs from §30.1 and §30.2 — `[OBSOLETE]`, `[deprecated]`, an empty strikethrough, and the like. Only `DISCARDED` and `DRAFT` are recognised as markers; any other `[...]` token is read as part of the requirement title, so the heading still parses and the requirement is still found.

Within the title portion of a heading (`### REQ-ID — Title`):

- The `[<REQ-ID>]` form, for example `[FR-AUTH-002]`, is a dependency citation or cross reference and is fine to keep.
- Any other `[...]` token, for example `[TBD]`, `[NOTE]`, or `[OBSOLETE]`, carries no meaning to the tool. It is not a status signal, and no mutation will ever add, change, or remove it. Do not use one where §30.1 or §30.2 already defines a marker: a requirement marked `[OBSOLETE]` by hand is not discarded, and every query and gate will treat it as live.

Validation does not report a non-standard marker. Nothing in the tool converts one to the standard form either — that is deliberate, so a parse or a validate run never rewrites a consumer's heading. Use `update_status` and `update_stability` to reach the standard markers.

### 30.5 Governing Rules Version

Which rules version governs an SRS package is determined by the version token in the file name that the `Rules` row of its metadata table links to. Front matter is not used, which preserves the Markdown-as-source principle in §2.1.

The `Rules` row appears in the metadata table of `docs/spec/00.index.md`, and a package may additionally carry one in `docs/spec/90.appendix.md`. The file name is matched with:

```text
SRS-MD-Rules-v(\d+\.\d+\.\d+)\.md
```

Recognition rules for the row:

- Key spelling: `| Rules | ... |` is canonical; `| rules | ... |` is accepted after case normalisation.
- Surrounding padding: cells are trimmed by the Markdown table parser before the expression is applied.
- Link body: both a relative path (`../rule/...`) and a repository-root path (`./docs/rule/...`) are accepted.

The markers in §30.1 and §30.2 are part of every rules version from `1.1.0` onward, so a package whose `Rules` row names this document governs by them. `speckiwi init` keeps the row aligned with the rules document it installs, so the row and the installed document do not drift apart.

---

## 31. Script Parsing Contract

This section is the contract that a repo-local script or an AI agent must follow when interpreting SRS documents.

### 31.1 Files the Parser Must Recognize

Default glob:

```text
docs/spec/**/*.srs.md
```

Index document:

```text
docs/spec/00.index.md
```

### 31.2 Minimum Fields the Parser Must Extract

| Field | Source |
|---|---|
| `id` | requirement heading |
| `title` | requirement heading |
| `file` | file path |
| `type` | metadata table |
| `target` | metadata table |
| `status` | metadata table |
| `priority` | metadata table |
| `tags` | metadata table |
| `githubIssue` | metadata table |
| `relatedDocs` | metadata table |
| `requirement` | `#### Requirement` section |
| `acceptanceCriteria` | task list under `#### Acceptance Criteria` |
| `verificationEvidence` | table under `#### Verification Evidence` |
| `traceLinks` | table under `#### Trace Links` |

### 31.3 Parsing Steps

1. Read the index metadata, Target Map, and Scope Map from `docs/spec/00.index.md`.
2. Find the list of `docs/spec/**/*.srs.md` files.
3. Find the Requirement headings in each file.
4. Extract the range from a heading up to just before the next Requirement heading as a block.
5. Read the first table of the block as the metadata table.
6. Extract the body of each `####` section heading.
7. Read the Acceptance Criteria task list.
8. Read the Verification Evidence and Trace Links tables.
9. Apply the validation rules.

In the v1.2.0 hardening target, the parser ignores heading-like text inside fenced code blocks and limits the Requirement Block boundary to the next valid requirement heading, the next relevant top-level `##` section, or the end of the file. Duplicate section headings inside the same Requirement Block, nested Acceptance Criteria, forbidden heading content, and malformed table rows must also be reported as diagnostics.

### 31.4 What the Parser Must Not Do

1. Do not automatically reorder the whole SRS document.
2. Do not change formatting arbitrarily.
3. Do not automatically translate section heading names.
4. Do not infer Markdown meaning to create hidden state.
5. Do not replace the source text by arbitrarily summarizing the Requirement Statement.
6. Do not generate links or evidence that do not exist.

---

## 32. Validation Script Specification

Repo-local scripts are not required, but when a repository provides them, the following behavior is recommended.

### 32.1 validate-spec

```bash
node scripts/spec/validate-spec.js
```

Validation items:

| Code | Severity | Title |
|---|---|---|
| `SRS-E001` | error | Malformed requirement heading |
| `SRS-E002` | error | Duplicate requirement ID |
| `SRS-E003` | error | Required metadata field missing |
| `SRS-E004` | error | Type does not match requirement ID prefix |
| `SRS-E005` | error | Invalid requirement status |
| `SRS-E006` | error | Invalid requirement priority |
| `SRS-E007` | error | Invalid requirement risk |
| `SRS-E008` | error | Acceptance Criteria section missing |
| `SRS-E009` | error | Verified requirement has unchecked acceptance criteria |
| `SRS-E010` | error | Verified requirement lacks checked AC or evidence |
| `SRS-E011` | error | Invalid requirement stability |
| `SRS-E012` | error | Trace requirement reference missing |
| `SRS-E013` | error | Target Map table missing |
| `SRS-E014` | error | Scope Map table missing |
| `SRS-E015` | error | Scope prefix is not registered |
| `SRS-E016` | error | Scope document is missing |
| `SRS-E017` | error | Active Target is not registered |
| `SRS-E018` | error | Duplicate requirement section |
| `SRS-E019` | error | Nested acceptance criterion |
| `SRS-E020` | error | Forbidden requirement heading content |
| `SRS-E021` | error | Malformed metadata table row |
| `SRS-E022` | error | Duplicate Target Map target |
| `SRS-E023` | error | Duplicate Scope Map prefix |
| `SRS-E024` | error | Multiple active targets |
| `SRS-E025` | error | Scope document file missing |
| `SRS-E026` | error | Release target is empty |
| `SRS-E027` | error | Acceptance Criteria coverage gap |
| `SRS-E028` | error | Evidence reference missing |
| `SRS-E029` | error | Evidence URL invalid |
| `SRS-E030` | error | Command evidence violates policy |
| `SRS-E031` | error | Trace link target is broken |
| `SRS-E032` | error | Stale mutation snapshot |
| `SRS-E033` | error | Verified draft requirement |
| `SRS-E050` | error | Workflow artifact path escapes workspace |
| `SRS-E051` | error | Ambiguous workflow artifact |
| `SRS-E065` | error | SRS mutation lock active |
| `SRS-E070` | error | Workflow mutation owner denied |
| `SRS-E071` | error | Invalid workflow mutation request |
| `SRS-E072` | error | Workflow mutation idempotency mismatch |
| `SRS-E073` | error | Workflow logical-delete denied |
| `SRS-E074` | error | Workflow dependency blocked |
| `SRS-E075` | error | MCP workspace root override rejected |
| `SRS-E076` | error | Ambiguous Requirement ID reference |
| `SRS-W001` | warning | Rationale section missing |
| `SRS-W002` | warning | Target is not registered |
| `SRS-W003` | warning | Related Docs local link missing |
| `SRS-W004` | warning | GitHub Issue URL format invalid |
| `SRS-W005` | warning | Heading dash is not an em dash |
| `SRS-W006` | warning | Discouraged wording used |
| `SRS-W007` | warning | Too many tags |
| `SRS-W008` | warning | High risk requirement lacks Research / Analysis |
| `SRS-W009` | warning | Frozen target changed without Change Notes |
| `SRS-W010` | warning | Active Target row is not active |
| `SRS-W011` | warning | Completed Work Log date is invalid |
| `SRS-W012` | warning | Completed Work Log target is not registered |
| `SRS-W013` | warning | Completed Work Log scope is not registered |
| `SRS-W014` | warning | Completed Work Log requirement is missing |
| `SRS-W015` | warning | Completed Work Log requirement is not completed |
| `SRS-W016` | warning | Malformed Verification Evidence table row |
| `SRS-W017` | warning | Malformed Trace Links table row |
| `SRS-W018` | warning | Unregistered scope SRS document |
| `SRS-W019` | warning | Status Summary drift |
| `SRS-W020` | warning | Requirement Type Summary drift |
| `SRS-W021` | warning | Release readiness warning |
| `SRS-W022` | warning | Legacy volatile stability |
| `SRS-W023` | warning | Draft requirement in active or released target |
| `SRS-W024` | warning | Malformed Completed Work Log report path |
| `SRS-W025` | warning | Completed Work Log duplicate across index and history |
| `SRS-W040` | warning | Target Goal block conflict between index and appendix |
| `SRS-W041` | warning | Completed Work Log duplicate source |
| `SRS-W050` | warning | Workflow artifact parse warning |
| `SRS-W051` | warning | Workflow artifact companion missing |
| `SRS-W052` | warning | Invalid workflow JSONL line |
| `SRS-W053` | warning | Duplicate workflow JSONL event key |
| `SRS-W054` | warning | Invalid workflow JSONL correction chain |
| `SRS-W055` | warning | Unsupported workflow JSONL schema version |
| `SRS-W056` | warning | Workflow JSONL missing trailing LF |
| `SRS-W057` | warning | Workflow task dependency issue |
| `SRS-W058` | warning | Workflow PM and coder state conflict |
| `SRS-W059` | warning | Workflow artifact hash is stale |
| `SRS-W060` | warning | Workflow plan checkbox drift |
| `SRS-W061` | warning | Workflow legacy trace field |
| `SRS-W062` | warning | Workflow stale lock |
| `SRS-W063` | warning | Workflow worklog audit mismatch |
| `SRS-W064` | warning | Workflow task missing req_ids |
| `SRS-W065` | warning | SRS status cache fallback |
| `SRS-W066` | warning | SRS status cache write failed |
| `SRS-W067` | warning | SRS mutation lock bypassed |
| `SRS-W068` | warning | Stale SRS mutation lock recovered |
| `SRS-W069` | warning | Invalid workflow deleted status |
| `SRS-W070` | warning | Scope documents share a leading number |
| `SRS-W071` | warning | Requirement heading outside a Requirements section |

In the v1.2.0 hardening target, the diagnostic code table above is aligned with the code-level diagnostic registry through a contract-tested or generated relationship. A registry entry must include the code, severity, title, message template, source rule, and since values, and every diagnostic code that the implementation emits must be registered in the registry.

In the v1.2.0 hardening target, index consistency diagnostics are extended as well. A duplicate Target Map target, a duplicate Scope Map prefix, multiple active target rows, a missing scope document file, an unregistered `.srs.md` file, Status Summary drift, and Requirement Type Summary drift must be reported as diagnostics.

### 32.2 list-by-target

```bash
node scripts/spec/list-by-target.js v0.1
```

Recommended output:

```text
Target: v0.1

planned
- FR-AUTH-001 Require re-login when the session expires

in_progress
- SEC-AUTH-001 Forbid authentication token exposure in logs

verified
- OBS-AUTH-001 Record authentication failure metrics
```

Recommended JSON output:

```bash
node scripts/spec/list-by-target.js v0.1 --json
```

### 32.3 list-by-status

```bash
node scripts/spec/list-by-status.js in_progress
```

### 32.4 update-status

```bash
node scripts/spec/update-status.js FR-AUTH-001 implemented
```

Rules:

1. Find the block by Requirement ID.
2. Modify only the `Status` row of the metadata table.
3. On the transition to `verified`, validate the Acceptance Criteria and the Verification Evidence.
4. On failure, do not change the document.
5. Do not change the formatting of the whole document.

### 32.5 summarize-target

```bash
node scripts/spec/summarize-target.js v0.1
```

Output items:

1. Total count per target
2. Count per status
3. Count per type
4. List of blocked requirements
5. List of implemented but not verified requirements
6. List of verified requirements
7. List of requirements with missing evidence

### 32.6 extract-requirements

```bash
node scripts/spec/extract-requirements.js --json
```

Outputs JSON for machine processing. This output is a derived result, not the source of truth.

---

## 33. AI Coding Agent Work Rules

### 33.1 Before Implementation

Before implementation, the AI coding agent performs the following.

1. Check `docs/spec/00.index.md`.
2. Find the Scope SRS document related to the work.
3. Read the related Requirement Block.
4. Check `Requirement`, `Rationale`, `Acceptance Criteria`, `Trace Links`, and `Implementation Notes`.
5. When multiple requirements are involved, decide the implementation order on the basis of target and status.

### 33.2 During Implementation

1. Use the Acceptance Criteria as the implementation criteria.
2. Do not add large behavior that is not in the specification.
3. When a requirement is ambiguous, first consider adding an `Open Question` or `Change Notes` to the Requirement Block.
4. When a constraint discovered during implementation changes the meaning of the requirement, update the SRS along with it.

### 33.3 After Implementation

1. Add the related test, PR, and code path to the Verification Evidence.
2. Update satisfied Acceptance Criteria to `- [x]`.
3. When the code is implemented but verification evidence is insufficient, leave it as `implemented`.
4. When every AC is satisfied and evidence exists, it may be changed to `verified`.
5. When the reason for a change is important, record it in `Change Notes`.

### 33.4 Forbidden Actions

The AI coding agent must not do the following.

1. Do not arbitrarily rewrite the whole SRS document.
2. Do not reuse a Requirement ID.
3. Do not delete Acceptance Criteria in order to meet the `verified` conditions.
4. Do not fabricate issues, PRs, tests, code paths, or evidence.
5. Do not write a local file link that does not exist.
6. Do not arbitrarily change heading, metadata table, or section heading names.
7. Do not add YAML front matter or raw HTML.
8. Do not use a disallowed status such as `done`.

---

## 34. Review Rules

Check the following when reviewing an SRS change.

| Check | Question |
|---|---|
| ID | Is the ID globally unique? |
| Type | Do the ID prefix and the Type match? |
| Scope | Is it in the correct scope document? |
| Target | Is it a target registered in the Target Map? |
| Status | Does it match the actual implementation/verification state? |
| Statement | Is it a single requirement, and is it free of ambiguity? |
| AC | Are the acceptance criteria verifiable? |
| Evidence | Is there evidence appropriate to the status? |
| Trace | Are the related issues, PRs, tests, and docs linked? |
| Diff | Is it free of unnecessary bulk formatting changes? |
| Conflict | Is it free of conflicts with other requirements? |

---

## 35. Baseline and Release Operations

### 35.1 Baseline

A baseline means the state of the SRS at a specific point in time. Managing it with a Git tag or a release branch is recommended.

Example:

```bash
git tag srs-v0.1-baseline
```

### 35.2 Target Freeze

When a Target is `frozen`, apply the following rules.

1. Adding a new requirement requires review.
2. Changing Acceptance Criteria requires Change Notes.
3. Status changes are allowed, but the evidence conditions must be observed.
4. Reviewer confirmation is recommended for moving a Target.

### 35.3 Release Check

To judge a specific target as a release candidate, check the following.

1. Are there no `blocked` requirements?
2. Do any `planned` or `in_progress` requirements remain in the release scope?
3. Among the `implemented` requirements, is there any that needs verification?
4. Is the evidence of the `verified` requirements valid?
5. Have all critical/high priority requirements been handled?

---

## 36. Anti-patterns

### 36.1 Oversized Requirement

Bad example:

```md
### FR-AUTH-001 — Implement the authentication system
```

Problems:

1. It is too broad.
2. The number of ACs becomes excessive.
3. It is hard to distinguish the parts that are implemented from the parts that are not.

Improvement:

```md
### FR-AUTH-001 — Issue an access token on successful login
### FR-AUTH-002 — Require re-login when the session expires
### FR-AUTH-003 — Handle refresh token rotation
```

### 36.2 Unmeasurable Quality Requirement

Bad example:

```md
The system shall respond quickly.
```

Improvement:

```md
The system shall keep the p95 response time of a normal search request at 500ms or less on an index of 10,000 documents.
```

### 36.3 Marking Complete Without Verification

Bad example:

```md
| Status | verified |

#### Acceptance Criteria

- [ ] AC-1: On login failure, HTTP 401 is returned.
```

Problems:

1. The AC is not checked.
2. There is no evidence.
3. The verified conditions are not satisfied.

### 36.4 Hiding a Requirement in Implementation Notes

Bad example:

```md
#### Requirement

The system shall provide a login feature.

#### Implementation Notes

- On failure it must return 401.
- The token must expire after 30 minutes.
```

Improvement:

1. Split the 401 response requirement into a separate requirement.
2. Split the token expiration policy into a separate security or functional requirement.

---

## 37. Minimal Template

Use the following template when adding a new requirement.

```md
### FR-SCOPE-001 — Requirement title

| Field | Value |
|---|---|
| Type | functional |
| Target | v0.1 |
| Status | planned |
| Priority | medium |
| Tags | example |
| Risk | medium |
| Stability | evolving |
| Verification Method | test |
| GitHub Issue | - |
| Related Docs | - |

#### Requirement

The system shall perform {expected behavior} in {condition}.

#### Rationale

Write the reason why this requirement is needed.

#### Acceptance Criteria

- [ ] AC-1: When {condition}, {expected result} occurs.

#### Verification Evidence

| Evidence ID | Type | Reference | Covers | Notes |
|---|---|---|---|---|

#### Trace Links

| Type | Reference | Relation | Notes |
|---|---|---|---|

#### Research / Analysis

- -

#### Implementation Notes

- -

#### Change Notes

| Date | Change | Reason |
|---|---|---|
```

---

## 38. Extended ISO/IEC/IEEE 29148 Mapping

These rules map the practical purposes of the requirements engineering standard onto Git-native Markdown as follows.

| Requirements Engineering Concern | SRS-MD Representation |
|---|---|
| Requirement identification | Requirement ID heading |
| Requirement statement | `#### Requirement` |
| Requirement attributes | metadata table |
| Scope context | Scope SRS document and Scope Overview |
| Requirement rationale | `#### Rationale` |
| Verification planning | `Verification Method` and `#### Acceptance Criteria` |
| Verification evidence | `#### Verification Evidence` |
| Traceability | `#### Trace Links` |
| Change management | Git history and `#### Change Notes` |
| Baseline management | Git tag, branch, release, target freeze |
| Stakeholder review | Pull Request review and Review evidence |
| Requirements quality | Section 20 quality criteria |
| Iterative refinement | Status, Stability, Change Notes |

---

## 39. Reference Basis

This document takes the following public documents as its reference basis.

- ISO/IEC/IEEE 29148:2018, Systems and software engineering — Life cycle processes — Requirements engineering: https://www.iso.org/standard/72089.html
- IEEE/ISO/IEC 29148-2018 standard page: https://standards.ieee.org/ieee/29148/6937/
- GitHub Flavored Markdown Spec: https://github.github.com/gfm/
- GitHub Docs, Basic writing and formatting syntax: https://docs.github.com/en/get-started/writing-on-github/getting-started-with-writing-and-formatting-on-github/basic-writing-and-formatting-syntax
- GitHub Docs, Organizing information with tables: https://docs.github.com/en/get-started/writing-on-github/working-with-advanced-formatting/organizing-information-with-tables

---

## 40. AGENTS.md / CLAUDE.md Additional Statements

Add the managed block below to `AGENTS.md`, `CLAUDE.md`, or both at the repository root. When the existing block has a different version or a legacy unversioned heading, replace everything from the heading through the suffix marker with the current block.

This block is managed by `speckiwi init`. The copy reproduced below is a reference snapshot, so when it differs from the tool output, the tool output is authoritative.

```md
# SpecKiwi SRS workflow v1.9

This repository uses `docs/spec/` as the required source of truth for requirements.

Before making any code, test, CLI, MCP, or documentation change, agents MUST:
1. Read `docs/spec/00.index.md`.
2. Find the relevant Requirement ID in the scope SRS files.
3. Mention the Requirement ID in the work summary.
4. If no matching requirement exists, stop and ask whether to create/update an SRS requirement first.

Requirement metadata has two separate lifecycle fields:
- `Status` tracks implementation and verification progress.
- `Stability` tracks requirement maturity and change-control maturity.

Agents MUST stop before implementing a non-discarded requirement with `Stability=draft` or `Stability=deprecated` unless the user explicitly overrides that workflow.

TDD principle:
- Agents MUST follow TDD for behavior changes: write or update a failing automated test for the relevant Requirement ID before implementation, make the smallest change to pass, then refactor while keeping tests green.
- If no meaningful automated test can be written, agents MUST stop before implementation and explain the exception and alternative verification evidence.

Work-mode and the TDD First (tdd) workflow:
1. Before starting work, read the persisted work-mode with the MCP `get_work_mode` tool, or CLI `speckiwi mode` when MCP is unavailable (stored in `docs/spec/steps/state.md`). When no mode is set the mode is wait and the sdd (SRS-first) rules in this document apply.
2. Switch modes with the MCP `set_work_mode` tool (mode plus an optional activeTask for vibe/tdd) or CLI `speckiwi mode <value>`. Any mode may switch to any other of sdd, vibe, wait, and tdd; switching to sdd or wait drops a stale Active Task line, and an out-of-enum value is rejected with INVALID_MODE.
3. When the mode is `tdd`, step-scoped work follows the TDD First cycle: author the step SDS at `docs/spec/steps/<task>/design.md` per the installed SDS-MD Authoring Rules (`docs/rule/SDS-MD-Rules-v2.5.0.md`) with EARS acceptance contracts (SDS-AC), translate the SDS-ACs into failing tests and confirm they fail, implement the smallest change to green, run regression, then synthesize the step SRS and promote the step requirement with verification evidence.
4. tdd gates (all mandatory): do not write tests before the step's SDS exists; commit tests first and never weaken a test to reach green; never promote a step requirement without verification evidence.
5. In tdd mode the rule "do not implement behavior not covered by an SRS requirement" is satisfied for step-scoped work by the agreed SDS plus the mandatory post-hoc promotion; body-scope work keeps the sdd rules in this document.
6. Edits to existing body requirements and large architecture changes stay in sdd mode — never route them through a tdd step.

Scope SRS document naming:
1. A scope SRS document is named `docs/spec/{NN}.{scope-slug}.srs.md`, where `{NN}` is a two-digit ordering number. The full rules are in `docs/rule/SRS-MD-Rules-v2.5.0.md` §5.2.
2. Allocate `{NN}` as one above the highest number already present among the project's scope documents. The first scope document of a project is `01`, the next `02`. Do not number by tens.
3. Never reuse a number another scope document holds, and never renumber an existing document.
4. Prefer `speckiwi scaffold-scope <Name>:<PREFIX> --apply`, which allocates the number and registers the document in both index sections in one operation, over writing the file and the index rows by hand.

Agents MUST NOT:
- Implement behavior that is not covered by an SRS requirement.
- Create an alternate requirements source outside `docs/spec/`.
- Change requirement IDs manually.
- Mark requirements as verified without evidence.
- Introduce or invoke bulk-archive / bulk-finalize tooling that flips multiple requirements to `verified` or empties Active Target without per-requirement evidence and stability gate checks.

When SpecKiwi MCP tools are available, agents MUST use them for requirement lookup and safe SRS updates. If MCP is unavailable, use the `speckiwi` CLI.

Current work status workflow:
1. Read the active target with MCP `get_active_target`, or CLI `speckiwi active-target --json` if MCP is unavailable.
2. If `activeTarget` is empty, report that no active target is set and ask which target to use before making target-scoped changes.
3. Read `summary.countsByStatus`, `summary.countsByStability`, `summary.stabilityBlockers`, `summary.stabilityWarnings`, and `summary.newWorkCandidates` before selecting work.
4. Read open work with MCP `list_requirements` for `status=in_progress`, `status=blocked`, and `status=implemented`; CLI fallback is `speckiwi list --status <status> --json`.
5. Check missing verification evidence through `summary` or MCP `summarize_target` before saying work is complete.
6. Read recent completed work with MCP `list_completed_work`; CLI fallback is `speckiwi completed-work --json`.

Next target authoring workflow:
1. If the user asks to set the next target, first read the current Active Target and Target Map.
2. If the target is not registered, use a supported target-registration mutation such as MCP `set_active_target` with creation support, or CLI `speckiwi set-active-target <target> --create` when that option is available.
3. If the configured MCP/CLI cannot register the target, stop before target-scoped SRS changes and report the tool gap, unless the user explicitly authorizes a minimal SRS-MD patch.
4. After target assignment, confirm the resolved Active Target with MCP `get_active_target`, or CLI `speckiwi active-target --json` if MCP is unavailable.
5. When the user provides a target goal, record it with MCP `set_target_goal`, or CLI `speckiwi set-target-goal <target> --goal <text>` if MCP is unavailable.
6. For later SRS creation, omit the target only when the tool supports Active Target defaulting; otherwise pass the confirmed Active Target explicitly.
7. If the user provides an explicit different target for a requirement, the explicit target wins over Active Target.

Merge-time duplicate Requirement ID repair workflow:
1. Run `speckiwi validate --json` or MCP `validate_spec` first. Use repair only when `SRS-E002` duplicate Requirement ID diagnostics exist, or when a named duplicate ID is confirmed in parsed diagnostics.
2. Resolve normal Git conflict markers before repair. Then run MCP `diagnose_requirement_id_collisions` or CLI `speckiwi repair requirement-id-collisions diagnose --json`.
3. Select explicit keep and rename occurrences by `filePath`, `headingLine`, and `blockHash`. A duplicate ID alone is never enough to write.
4. Create a dry-run plan with MCP `plan_requirement_id_collision_repair` or CLI `speckiwi repair requirement-id-collisions plan --duplicate-id <id> --keep <file:line:blockHash> --rename <file:line:blockHash> [--replacement-id <id>|--allocate-next] --write-plan <path> --json`.
5. Apply only from the explicit plan or equivalent explicit mapping with MCP `apply_requirement_id_collision_repair` or CLI `speckiwi repair requirement-id-collisions apply --plan <path> --json`. `--ignore-lock` is allowed only on apply and bypasses only the SRS mutation lock.
6. Do not use collision repair for general renumbering, gap filling, ID beautification, bulk archive, bulk finalize, or Status/Stability changes. When two duplicate logical requirements should be merged or discarded, first repair IDs to uniqueness, then use separate guarded SRS mutations for discard, supersedes, Status, Stability, AC, or evidence changes.
7. When implemented runtime CLI or MCP repair tooling is available, do not hand-edit Requirement IDs. If tooling is unavailable and the user explicitly authorizes a degraded SRS-MD patch, limit it to the selected occurrence and explicitly mapped references.
8. Finish with `speckiwi validate --fail-on-warning --json`, `speckiwi summary --target <target> --json`, and `speckiwi links check --json` or MCP equivalents. Evidence must show duplicate IDs are zero and ambiguous references were reported or explicitly mapped.

The Completed Work Log — inline in `docs/spec/00.index.md` §7 and its split history file `docs/spec/91.completed-work-log.md` — is a read-only summary for agents. Requirement Block status, Acceptance Criteria, Verification Evidence, and Change Notes remain the source of truth for completion.

<!-- /SpecKiwi SRS workflow -->
```

---

## 41. Document End

This document is the reference document for SRS-MD Authoring Rules v2.5.0. Detailed enums, scope prefixes, and target naming that suit each repository's situation may be extended in `docs/spec/00.index.md` and `docs/spec/90.appendix.md`. However, the Requirement Block heading format, the metadata table, the status meanings, and the Acceptance Criteria, Verification Evidence, and Trace Links rules must be kept for compatibility.
