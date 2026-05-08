# SpecKiwi

SpecKiwi is a Node.js CLI and stdio MCP server for Git-native Markdown SRS documents.

Core decisions:

- Requirements source of truth is Markdown under `docs/spec/`.
- YAML is not used for requirements, front matter, or exports.
- No database or requirement server is required.
- CLI and MCP use the same core parser, validator, query, and mutation services.
- MCP support is stdio transport in v1.0.0.
- Runtime baseline is Node.js LTS with Node.js 22 or newer.

Start here:

- [SRS Index](docs/spec/00.index.md)
- [Appendix](docs/spec/90.appendix.md)
- [SRS-MD Rules](docs/rule/SRS-MD-Rules-v1.0.0.md)

Requirement discovery:

```sh
speckiwi validate
speckiwi list --target v1.0.0
speckiwi show IR-CLI-010 --markdown
speckiwi summary --target v1.0.0
```

Post-implementation evidence flow:

```sh
speckiwi add-evidence IR-CLI-010 --type test --reference test/cli/mutation-commands.test.ts --covers AC-1
speckiwi check-ac IR-CLI-010 AC-1
speckiwi update-status IR-CLI-010 implemented
```

Keep a completed but not fully evidenced requirement at `implemented`. Use `verified` only after all Acceptance Criteria are checked and Verification Evidence is present.

MCP agent flow:

```text
list_requirements -> get_requirement -> implementation -> add_verification_evidence -> check_acceptance_criteria -> update_status
```

Server startup:

```sh
speckiwi mcp
```

Baseline management is Git-native. To capture an SRS baseline, review SRS Change Notes and then create a tag such as:

```sh
git tag srs-v1.0.0-baseline
```
