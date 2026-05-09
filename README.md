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

----

# SpecKiwi (한국어)

SpecKiwi는 Git으로 추적되는 Markdown SRS 문서를 위한 local-first 요구사항 도구입니다. 하나의 `docs/spec` 원본을 두 가지 인터페이스로 다룹니다.

- 사람과 스크립트를 위한 Node.js CLI
- 코딩 에이전트를 위한 stdio MCP 서버

SpecKiwi는 YAML 요구사항 파일, YAML front matter, canonical data로서의 생성 JSON, 데이터베이스, 원격 요구사항 서버를 사용하지 않습니다. canonical 요구사항은 저장소 안의 Markdown 파일입니다.

## 요구 사항

- Node.js 22 이상
- npm
- Git

소스 체크아웃에서 실행할 때:

```sh
npm ci
npm run build
node bin/speckiwi --help
```

패키지를 명령으로 설치한 뒤에는 `node bin/speckiwi` 대신 `speckiwi`를 사용합니다.

## 새 SRS Workspace 시작

Git 프로젝트 루트에서 `init`을 실행합니다.

```sh
speckiwi init --target v1.0.0 --scope "Payments:PAY" --agent-file both
```

소스 체크아웃에서는 다음처럼 실행합니다.

```sh
node bin/speckiwi --root . init --target v1.0.0 --scope "Payments:PAY" --agent-file both
```

필요한 구조가 없으면 다음 표준 구조를 생성합니다.

```text
docs/
├─ rule/
│  └─ SRS-MD-Rules-v1.0.0.md
└─ spec/
   ├─ 00.index.md
   ├─ 10.payments.srs.md
   └─ 90.appendix.md
```

`--scope`는 `Name:PREFIX` 형식을 받습니다. 위 예시는 `PAY` requirement ID segment를 사용하는 Payments scope를 만듭니다. `--agent-file both`는 `AGENTS.md`와 `CLAUDE.md`에 SRS 규칙 링크를 짧게 추가합니다. 기존 파일은 `--force`가 없으면 덮어쓰지 않고 건너뜁니다.

## SRS 구성 방식

먼저 다음 문서를 봅니다.

- [docs/spec/00.index.md](docs/spec/00.index.md): target map, scope map, SRS 문서 목록
- [docs/rule/SRS-MD-Rules-v1.0.0.md](docs/rule/SRS-MD-Rules-v1.0.0.md): 작성 및 파싱 규칙
- [docs/spec/90.appendix.md](docs/spec/90.appendix.md): 저장소 내부 참고 자료

Scope SRS 파일은 `## 4. Requirements` 아래에 requirement block을 둡니다.

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

SpecKiwi는 heading, metadata table, Acceptance Criteria task list, Verification Evidence table, Trace Links table을 파싱합니다. 이 이름과 구조는 유지해야 합니다.

## 일상 CLI Workflow

먼저 검증합니다.

```sh
speckiwi validate
speckiwi validate --json
speckiwi validate --fail-on-warning
```

요구사항을 찾습니다.

```sh
speckiwi targets
speckiwi scopes
speckiwi list --target v1.0.0
speckiwi list --scope PAY --status planned --json
speckiwi show FR-PAY-001 --markdown
speckiwi summary --target v1.0.0 --json
speckiwi links check --json
```

자동화에서는 `--json`을 사용합니다. 사람용 출력은 빠른 확인에 충분하도록 단순하게 유지되지만, 스크립트에는 JSON이 더 안전한 인터페이스입니다.

## 요구사항 추가

ID를 직접 고르는 대신 `add-requirement`를 사용합니다. SpecKiwi는 requirement type과 scope prefix로 다음 ID를 생성한 뒤, 대상 scope 문서에 block을 추가합니다.

쓰기 없이 미리 확인합니다.

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

요구사항을 실제로 작성합니다.

```sh
speckiwi add-requirement \
  --type functional \
  --scope PAY \
  --target v1.0.0 \
  --title "Payment approval is recorded" \
  --requirement "The system shall record each successful payment approval." \
  --ac "A successful approval stores an approval reference."
```

유용한 옵션:

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

`--ac`, `--checked-ac`, `--related-docs`, `--evidence`, `--trace`는 반복해서 사용할 수 있습니다.

## 요구사항 구현과 검증

일반적인 lifecycle은 다음과 같습니다.

```text
planned -> in_progress -> implemented -> verified
```

코드는 완료됐지만 verification evidence가 부족하면 `implemented`를 사용합니다. 모든 Acceptance Criteria가 체크되고 evidence row가 하나 이상 있을 때만 `verified`를 사용합니다.

예시:

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

모든 acceptance criteria가 충족되었다면 다음을 사용할 수 있습니다.

```sh
speckiwi check-ac FR-PAY-001 --all
```

체크된 항목을 되돌리려면:

```sh
speckiwi uncheck-ac FR-PAY-001 AC-1
```

추적 관계를 추가합니다.

```sh
speckiwi add-trace FR-PAY-001 \
  --type Requirement \
  --reference IR-PAY-001 \
  --relation depends_on \
  --notes "Payment approval depends on the payment API contract"
```

## CLI Reference

전역 옵션:

```text
--root <path>   Project root. 생략하면 SpecKiwi가 상위 디렉터리를 검색합니다.
--json          stdout에 JSON을 출력합니다.
--no-color      색상 출력을 비활성화합니다.
--quiet         중요하지 않은 사람용 출력을 줄입니다.
--help          도움말을 출력합니다.
--version       버전을 출력합니다.
```

읽기 명령:

| Command | Purpose |
|---|---|
| `speckiwi validate [--fail-on-warning] [--json]` | SRS workspace를 검증합니다. |
| `speckiwi extract [--include-markdown] [--json]` | 정규화된 requirement record를 추출합니다. |
| `speckiwi list [--target T] [--status S] [--type T] [--scope S] [--tag T] [--format F] [--json]` | 필터로 요구사항을 나열합니다. |
| `speckiwi show <id> [--markdown] [--json]` | 단일 요구사항을 표시합니다. |
| `speckiwi targets [--json]` | target map 항목을 표시합니다. |
| `speckiwi scopes [--json]` | scope map 항목을 표시합니다. |
| `speckiwi summary [--target T] [--markdown] [--json]` | target을 요약합니다. |
| `speckiwi links check [--json]` | local link와 requirement reference를 확인합니다. |

변경 명령:

| Command | Purpose |
|---|---|
| `speckiwi init [--target T] [--scope Name:PREFIX] [--agent-file agents\|claude\|both] [--force] [--json]` | SRS skeleton을 생성하거나 갱신합니다. |
| `speckiwi add-requirement ...` | 새 requirement block을 추가합니다. |
| `speckiwi update-status <id> <status> [--json]` | `Status` metadata row를 갱신합니다. |
| `speckiwi check-ac <id> [AC...] [--all] [--json]` | acceptance criteria를 checked 상태로 표시합니다. |
| `speckiwi uncheck-ac <id> [AC...] [--all] [--json]` | acceptance criteria를 unchecked 상태로 표시합니다. |
| `speckiwi add-evidence <id> --type T --reference R [--covers C] [--notes N] [--json]` | Verification Evidence row를 추가합니다. |
| `speckiwi add-trace <id> --type T --reference R --relation R [--notes N] [--json]` | Trace Links row를 추가합니다. |

허용되는 requirement status:

```text
planned
in_progress
blocked
implemented
verified
discarded
```

허용되는 requirement type:

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

stdio MCP 서버를 시작합니다.

```sh
speckiwi --root /path/to/project mcp
```

지원되는 transport는 stdio뿐입니다. stdout은 MCP JSON-RPC message 전용이고, log는 stderr에 기록해야 합니다. 서버 시작 시 project root가 고정되므로 tool input으로 root를 바꾸는 방식은 사용하지 않습니다.

읽기 도구:

| Tool | Input |
|---|---|
| `list_requirements` | `target?`, `status?`, `type?`, `scope?`, `tag?` |
| `get_requirement` | `id`, `includeMarkdown?` |
| `validate_spec` | `strict?`, `failOnWarning?`; 현재 workspace를 검증합니다. |
| `summarize_target` | `target?` |

변경 도구:

| Tool | Input |
|---|---|
| `init_project` | `target?`, `scope?`, `force?`, `agentFile?` 또는 `agentFiles?` |
| `add_requirement` | `type`, `scope`, `target`, `title`, `requirement`, `acceptanceCriteria`, optional metadata |
| `update_status` | `id`, `status` |
| `check_acceptance_criteria` | `id`, `acIds`, `checked` |
| `add_verification_evidence` | `id`, `type`, `reference`, `covers?` |
| `add_trace_link` | `id`, `type`, `reference`, `relation` |

리소스:

```text
speckiwi://index
speckiwi://requirements/{id}
speckiwi://targets/{target}
speckiwi://scopes/{scope}
```

권장 에이전트 흐름:

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

## Release와 Baseline Workflow

SRS target을 준비 완료로 보기 전에 다음을 실행합니다.

```sh
npm run build
npm run typecheck
npm run lint
npm test
npm run test:integration
npm run release:acceptance
npm run release:check
```

target이 승인되면 Git tag로 baseline을 기록합니다.

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

패키지는 다음 ESM entry point를 제공합니다.

```text
speckiwi
speckiwi/cli
speckiwi/cli/command
speckiwi/core/result
speckiwi/core/types
speckiwi/mcp/server
```

CLI와 MCP 서버는 안정적인 사용자-facing interface입니다. JSON 명령 출력은 Markdown SRS에서 파생된 view로 취급하고, 별도 source of truth로 사용하지 않습니다.

## SpecKiwi가 하지 않는 일

- YAML requirement file을 관리하지 않습니다.
- YAML front matter를 사용하지 않습니다.
- 데이터베이스나 background requirements server를 실행하지 않습니다.
- v1.0.0에서 HTTP MCP transport를 제공하지 않습니다.
- 생성된 JSON을 canonical data로 만들지 않습니다.
- evidence를 대신 만들어주지 않습니다. Evidence는 실제 test, code, PR, review, analysis, demo, 운영 기록을 가리켜야 합니다.
