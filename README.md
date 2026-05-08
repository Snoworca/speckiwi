# SpecKiwi

SpecKiwi is a local-first requirements tool for Git-tracked Markdown SRS documents. It gives a project two interfaces over the same `docs/spec` source of truth:

- a Node.js CLI for people and scripts
- a stdio MCP server for coding agents

SpecKiwi does not use YAML requirement files, front matter, generated JSON as canonical data, a database, or a remote requirements service. The canonical requirements are Markdown files in the repository.

## Requirements

- Node.js 22 or newer
- npm
- Git

From a source checkout:

```sh
npm ci
npm run build
node bin/speckiwi --help
```

After the package is installed as a command, use `speckiwi` instead of `node bin/speckiwi`.

## Start a New SRS Workspace

Run `init` at the root of a Git project:

```sh
speckiwi init --target v1.0.0 --scope "Payments:PAY" --agent-file both
```

From a source checkout:

```sh
node bin/speckiwi --root . init --target v1.0.0 --scope "Payments:PAY" --agent-file both
```

This creates the standard structure if it is missing:

```text
docs/
├─ rule/
│  └─ SRS-MD-Rules-v1.0.0.md
└─ spec/
   ├─ 00.index.md
   ├─ 10.payments.srs.md
   └─ 90.appendix.md
```

`--scope` accepts `Name:PREFIX`. The example above creates a Payments scope with the `PAY` requirement ID segment. `--agent-file both` updates `AGENTS.md` and `CLAUDE.md` with a short pointer to the SRS rules. Existing files are skipped unless `--force` is provided.

## How the SRS Is Organized

Start at:

- [docs/spec/00.index.md](docs/spec/00.index.md): target map, scope map, SRS document list
- [docs/rule/SRS-MD-Rules-v1.0.0.md](docs/rule/SRS-MD-Rules-v1.0.0.md): authoring and parsing rules
- [docs/spec/90.appendix.md](docs/spec/90.appendix.md): local reference material

A scope SRS file contains requirement blocks under `## 4. Requirements`.

```md
### FR-PAY-001 — Payment approval is recorded

| Field | Value |
|---|---|
| Type | functional |
| Target | v1.0.0 |
| Status | planned |

#### Requirement

The system shall record each successful payment approval.

#### Acceptance Criteria

- [ ] AC-1: A successful approval stores an approval reference.

#### Verification Evidence

| Evidence ID | Type | Reference | Covers | Notes |
|---|---|---|---|---|

#### Trace Links

| Type | Reference | Relation | Notes |
|---|---|---|---|
```

The heading, metadata table, Acceptance Criteria task list, Verification Evidence table, and Trace Links table are parsed by SpecKiwi. Preserve those names and structures.

## Daily CLI Workflow

Validate first:

```sh
speckiwi validate
speckiwi validate --json
speckiwi validate --fail-on-warning
```

Find requirements:

```sh
speckiwi targets
speckiwi scopes
speckiwi list --target v1.0.0
speckiwi list --scope PAY --status planned --json
speckiwi show FR-PAY-001 --markdown
speckiwi summary --target v1.0.0 --json
speckiwi links check --json
```

Machine-readable automation should use `--json`. Human output is intentionally simple and stable enough for quick inspection, but JSON is the safer interface for scripts.

## Add a Requirement

Use `add-requirement` instead of manually choosing an ID. SpecKiwi generates the next ID from the requirement type and scope prefix, then appends the block to the target scope document.

Preview without writing:

```sh
speckiwi add-requirement \
  --type functional \
  --scope PAY \
  --target v1.0.0 \
  --title "Payment approval is recorded" \
  --requirement "The system shall record each successful payment approval." \
  --ac "A successful approval stores an approval reference." \
  --dry-run \
  --json
```

Write the requirement:

```sh
speckiwi add-requirement \
  --type functional \
  --scope PAY \
  --target v1.0.0 \
  --title "Payment approval is recorded" \
  --requirement "The system shall record each successful payment approval." \
  --ac "A successful approval stores an approval reference."
```

Useful options:

```text
--status <status>
--priority <priority>
--tags <comma,separated,tags>
--risk <risk>
--stability <stability>
--verification-method <method>
--github-issue <issue>
--related-docs <doc>
--rationale <text>
--implementation-notes <text>
--research <text>
--change-notes <text>
--evidence "type|reference|covers|notes"
--trace "type|reference|relation|notes"
```

`--ac`, `--checked-ac`, `--related-docs`, `--evidence`, and `--trace` can be repeated.

## Implement and Verify a Requirement

The normal lifecycle is:

```text
planned -> in_progress -> implemented -> verified
```

Use `implemented` when code is complete but verification evidence is incomplete. Use `verified` only after every Acceptance Criteria item is checked and at least one evidence row exists.

Example:

```sh
speckiwi update-status FR-PAY-001 in_progress

# run implementation and tests outside SpecKiwi
npm test

speckiwi add-evidence FR-PAY-001 \
  --type test \
  --reference test/payments/approval.test.ts \
  --covers AC-1 \
  --notes "Payment approval persistence test"

speckiwi check-ac FR-PAY-001 AC-1
speckiwi update-status FR-PAY-001 verified
speckiwi validate --fail-on-warning
```

If all acceptance criteria are satisfied:

```sh
speckiwi check-ac FR-PAY-001 --all
```

To reverse a checked item:

```sh
speckiwi uncheck-ac FR-PAY-001 AC-1
```

Add traceability:

```sh
speckiwi add-trace FR-PAY-001 \
  --type Requirement \
  --reference IR-PAY-001 \
  --relation depends_on \
  --notes "Payment approval depends on the payment API contract"
```

## CLI Reference

Global options:

```text
--root <path>   Project root. If omitted, SpecKiwi searches upward.
--json          Print JSON to stdout.
--no-color      Disable color.
--quiet         Suppress non-essential human output.
--help          Print help.
--version       Print version.
```

Read commands:

| Command | Purpose |
|---|---|
| `speckiwi validate [--fail-on-warning] [--json]` | Validate the SRS workspace. |
| `speckiwi extract [--include-markdown] [--json]` | Extract normalized requirement records. |
| `speckiwi list [--target T] [--status S] [--type T] [--scope S] [--tag T] [--format F] [--json]` | List requirements by filter. |
| `speckiwi show <id> [--markdown] [--json]` | Show one requirement. |
| `speckiwi targets [--json]` | Show target map entries. |
| `speckiwi scopes [--json]` | Show scope map entries. |
| `speckiwi summary [--target T] [--markdown] [--json]` | Summarize a target. |
| `speckiwi links check [--json]` | Check local links and requirement references. |

Mutation commands:

| Command | Purpose |
|---|---|
| `speckiwi init [--target T] [--scope Name:PREFIX] [--agent-file agents\|claude\|both] [--force] [--json]` | Create or refresh the SRS skeleton. |
| `speckiwi add-requirement ...` | Add a new requirement block. |
| `speckiwi update-status <id> <status> [--json]` | Update the `Status` metadata row. |
| `speckiwi check-ac <id> [AC...] [--all] [--json]` | Mark acceptance criteria as checked. |
| `speckiwi uncheck-ac <id> [AC...] [--all] [--json]` | Mark acceptance criteria as unchecked. |
| `speckiwi add-evidence <id> --type T --reference R [--covers C] [--notes N] [--json]` | Add a Verification Evidence row. |
| `speckiwi add-trace <id> --type T --reference R --relation R [--notes N] [--json]` | Add a Trace Links row. |

Allowed requirement statuses:

```text
planned
in_progress
blocked
implemented
verified
discarded
```

Allowed requirement types:

```text
functional
non_functional
interface
data
security
performance
reliability
observability
operational
migration
constraint
```

## MCP Server

Start the stdio MCP server:

```sh
speckiwi --root /path/to/project mcp
```

Only stdio transport is supported. stdout is reserved for MCP JSON-RPC messages; logs belong on stderr. The project root is fixed when the server starts, so tool inputs should not be used to switch roots.

Read tools:

| Tool | Input |
|---|---|
| `list_requirements` | `target?`, `status?`, `type?`, `scope?`, `tag?` |
| `get_requirement` | `id`, `includeMarkdown?` |
| `validate_spec` | `strict?`, `failOnWarning?`; validates the current workspace |
| `summarize_target` | `target?` |

Mutation tools:

| Tool | Input |
|---|---|
| `init_project` | `target?`, `scope?`, `force?`, `agentFile?` or `agentFiles?` |
| `add_requirement` | `type`, `scope`, `target`, `title`, `requirement`, `acceptanceCriteria`, optional metadata |
| `update_status` | `id`, `status` |
| `check_acceptance_criteria` | `id`, `acIds`, `checked` |
| `add_verification_evidence` | `id`, `type`, `reference`, `covers?` |
| `add_trace_link` | `id`, `type`, `reference`, `relation` |

Resources:

```text
speckiwi://index
speckiwi://requirements/{id}
speckiwi://targets/{target}
speckiwi://scopes/{scope}
```

Recommended agent flow:

```text
speckiwi://index
-> list_requirements
-> get_requirement(includeMarkdown: true)
-> implement and test
-> add_verification_evidence
-> check_acceptance_criteria
-> update_status
-> validate_spec
```

## Release and Baseline Workflow

Before treating an SRS target as ready:

```sh
npm run build
npm run typecheck
npm run lint
npm test
npm run test:integration
npm run release:acceptance
npm run release:check
```

When a target is accepted, record the baseline in Git:

```sh
git tag srs-v1.0.0-baseline
```

## Development Commands

```sh
npm run build
npm run typecheck
npm run lint
npm test
npm run test:integration
npm run release:acceptance
npm run release:check
npm run perf:srs
```

## Package API

The package exposes these ESM entry points:

```text
speckiwi
speckiwi/cli
speckiwi/cli/command
speckiwi/core/result
speckiwi/core/types
speckiwi/mcp/server
```

The CLI and MCP server are the stable user-facing interfaces. Treat JSON command output as a derived view of the Markdown SRS, not as a separate source of truth.

## What SpecKiwi Does Not Do

- It does not manage YAML requirement files.
- It does not use YAML front matter.
- It does not run a database or background requirements server.
- It does not expose an HTTP MCP transport in v1.0.0.
- It does not make generated JSON canonical.
- It does not create evidence for you. Evidence should point to real tests, code, PRs, reviews, analysis, demos, or operational records.
