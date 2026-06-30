# Merge-time Requirement ID Collision Repair

Use this runbook only after a merge, rebase, or parallel worktree integration produces `SRS-E002` duplicate Requirement ID diagnostics.

1. Run `speckiwi validate --json` or MCP `validate_spec`.
2. Resolve normal Git conflict markers before any SRS repair.
3. Diagnose duplicate groups with MCP `diagnose_requirement_id_collisions` or CLI `speckiwi repair requirement-id-collisions diagnose --json`.
4. Select one keep occurrence and one rename occurrence using `filePath`, `headingLine`, and `blockHash`.
5. Plan with MCP `plan_requirement_id_collision_repair` or CLI `speckiwi repair requirement-id-collisions plan --duplicate-id <id> --keep <file:line:blockHash> --rename <file:line:blockHash> [--replacement-id <id>|--allocate-next] --write-plan <path> --json`.
6. Apply with MCP `apply_requirement_id_collision_repair` or CLI `speckiwi repair requirement-id-collisions apply --plan <path> --json`.
7. Use `--ignore-lock` only on apply, and only to bypass the SRS mutation lock. It does not bypass stale snapshots, generated-ID collisions, occurrence identity checks, table safety, or validation.
8. Finish with `speckiwi validate --fail-on-warning --json`, `speckiwi summary --target <target> --json`, and `speckiwi links check --json`.

Do not use this workflow for general renumbering, gap filling, ID beautification, bulk archive, bulk finalize, or Status/Stability changes. If two duplicate logical requirements should be merged or discarded, first repair IDs to uniqueness, then use separate guarded SRS mutations for discard, supersedes, Status, Stability, AC, or evidence changes.
