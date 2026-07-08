# v3 REQ ID remap (충돌 52건)

| old (v3 계획) | new (충돌 회피) | v3 의미 |
|---|---|---|
| `FR-MCP-021` | `FR-MCP-040` | MCP validate_step tool registration |
| `FR-MCP-022` | `FR-MCP-041` | MCP registration of compatibility-check tools and edge read tools |
| `FR-MCP-023` | `FR-MCP-042` | MCP registration of gap mutation tools statement and AC edit |
| `FR-MCP-024` | `FR-MCP-043` | MCP registration of step state tools |
| `FR-MCP-025` | `FR-MCP-044` | MCP registration of supersede and promote mutation tools |
| `FR-MCP-026` | `FR-MCP-045` | MCP registration of diff_steps read tool |
| `FR-MCP-027` | `FR-MCP-046` | set_work_mode and get_work_mode MCP tools |
| `FR-MCP-028` | `FR-MCP-047` | start_vibe_task MCP tool with intent-first ordering and task-name or a |
| `FR-MCP-031` | `FR-MCP-048` | MCP retarget_requirements bulk mutation tool |
| `FR-MCP-032` | `FR-MCP-049` | MCP update_requirement_field mutation tool with id-regeneration guard |
| `FR-MCP-033` | `FR-MCP-050` | MCP add_related_doc and add_change_note mutation tools |
| `FR-MCP-034` | `FR-MCP-051` | MCP search_requirements read tool |
| `FR-MCP-035` | `FR-MCP-052` | MCP summarize_release_readiness read tool |
| `FR-MCP-036` | `FR-MCP-053` | MCP explain_diagnostic read tool |
| `FR-NODE-017` | `FR-NODE-055` | Origin-aware record loading for mutation routing |
| `FR-NODE-018` | `FR-NODE-056` | Successor trace search over union records to prevent slot regression |
| `FR-NODE-019` | `FR-NODE-057` | updateStatus verified-regression exit guard with explicit override |
| `FR-NODE-020` | `FR-NODE-058` | computeSemanticSha content-hash utility with fpv1 frozen vector |
| `FR-NODE-021` | `FR-NODE-059` | compareReqId raw-byte ordering and computeBlastRadius closure utility |
| `FR-NODE-022` | `FR-NODE-060` | add_compatibility_check mutation with dedup frozen liveness guards and |
| `FR-NODE-023` | `FR-NODE-061` | refresh_compatibility_check and revoke_compatibility_check mutations |
| `FR-NODE-024` | `FR-NODE-062` | list_dirty_edges read path with clean whitelist gate |
| `FR-NODE-025` | `FR-NODE-063` | update_requirement_statement mutation with new Requirement range helpe |
| `FR-NODE-026` | `FR-NODE-064` | edit_acceptance_criteria mutation |
| `FR-NODE-027` | `FR-NODE-065` | claim_step mutation with write-skew two-stage gate |
| `FR-NODE-028` | `FR-NODE-066` | update_step_state mutation |
| `FR-NODE-029` | `FR-NODE-067` | list_steps topological ordering with cycle detection and advisories |
| `FR-NODE-030` | `FR-NODE-068` | supersede_requirement strict two-call mutation with guards and A1 inva |
| `FR-NODE-031` | `FR-NODE-069` | promote_step_requirement mutation with reservation uniqueness verbatim |
| `FR-NODE-032` | `FR-NODE-070` | MultiFileCommit four-phase engine with durable merge-journal crash rec |
| `FR-PARSE-019` | `FR-PARSE-029` | Origin-isolating SRS file discovery with steps directory partition |
| `FR-PARSE-020` | `FR-PARSE-030` | Workspace parser origin split into body and step records |
| `FR-PARSE-021` | `FR-PARSE-031` | Optional origin and stepName fields on RequirementRecord and ParsedWor |
| `FR-PARSE-026` | `FR-PARSE-032` | parseCompatibilityNotes strict tokenizer for compatibility Notes |
| `IR-CLI-028` | `IR-CLI-056` | speckiwi step validate command |
| `IR-CLI-029` | `IR-CLI-057` | speckiwi init hook-install extension |
| `IR-CLI-030` | `IR-CLI-058` | speckiwi mode command |
| `IR-CLI-031` | `IR-CLI-059` | speckiwi vibe-gate check CI subcommand |
| `IR-CLI-033` | `IR-CLI-060` | validate grouped human renderer with file and code grouping |
| `IR-CLI-034` | `IR-CLI-061` | validate severity only and ignore filters with exit-code-from-unfilter |
| `IR-CLI-035` | `IR-CLI-062` | explain command and validate --explain for diagnostic codes |
| `IR-CLI-036` | `IR-CLI-063` | release-readiness coverage and rtm read commands with verified-gate ba |
| `IR-CLI-037` | `IR-CLI-064` | search command over requirement fields |
| `IR-CLI-038` | `IR-CLI-065` | retarget command with dry-run default and per-item skip reasons |
| `IR-CLI-039` | `IR-CLI-066` | update-field command with id-regenerating type and scope migration gua |
| `IR-CLI-040` | `IR-CLI-067` | update-statement CLI command |
| `IR-CLI-041` | `IR-CLI-068` | edit-ac CLI command |
| `IR-CLI-042` | `IR-CLI-069` | add-related-doc and add-change-note commands |
| `IR-CLI-043` | `IR-CLI-070` | common --input-json stdin and --help --json for all mutation commands |
| `IR-CLI-044` | `IR-CLI-071` | speckiwi sync-counts command |
| `IR-CLI-045` | `IR-CLI-072` | speckiwi supersede command |
| `REL-PARSE-002` | `REL-PARSE-004` | Diagnostic dedup single-source read envelope fix |