# SpecKiwi SRS Verification Findings - 2026-05-02

## Purpose

This report freezes the SRS compliance verification findings used as input for
`docs/plans/plan-20260502-speckiwi-verification-hardening-v1.md`.

## Verification Commands

| Command | Result |
|---|---|
| `npm run typecheck` | PASS |
| `npm run lint` | PASS |
| `npm test` | PASS, 27 files / 160 tests |
| `npm run perf:srs` | PASS in the main verification run, with one subagent reporting a prior exact lookup budget miss |
| `npm run release:check` | PASS |

## Residual Findings

| ID | Severity | Finding | Evidence |
|---|---|---|---|
| VF-001 | HIGH | Cache manifest read and read-model manifest hash paths can read `cache/manifest.json` through direct filesystem paths instead of the realpath guard used by cache artifacts. | `src/cache/manifest.ts`, `src/core/read-model.ts`, `src/indexing/serialization.ts` |
| VF-002 | HIGH | `validateWorkspace()` can throw on store-root symlink escape instead of returning deterministic validation diagnostics. | `src/core/validate.ts`, `src/validate/semantic.ts`, `src/io/path.ts` |
| VF-003 | HIGH | The `--no-cache` contract needs full read/write regression coverage: `speckiwi req update --apply --no-cache` does not pass `cacheMode` into requirement patch context resolution, and search/graph/export need explicit poisoned or pre-existing cache tests. | `src/cli/commands/req-write.ts`, `src/core/requirements.ts`, `src/core/read-model.ts`, `src/cli/commands/search.ts`, `src/cli/commands/graph.ts`, `src/cli/commands/export.ts`, `src/export/markdown.ts` |
| VF-004 | HIGH | `zod` is directly imported by shipped MCP modules but is not declared as a direct runtime dependency. | `src/mcp/schemas.ts`, `src/mcp/structured-content.ts`, `package.json` |
| VF-005 | MEDIUM | Graph cache is generated but graph read-model requests fall back to source because only search cache has a read path; any cached graph branch must preserve source graph diagnostics for invalid relation fixtures. | `src/cache/rebuild.ts`, `src/core/api.ts`, `src/core/read-model.ts`, `src/graph/builder.ts`, `test/graph/graph.test.ts` |
| VF-006 | MEDIUM | SRS performance test labels an MCP tool timing but currently measures Core direct search, not MCP client/tool/structuredContent path. | `test/perf/perf.test.ts`, `test/mcp/tools.test.ts`, `src/mcp/tools.ts` |
| VF-007 | LOW | Release acceptance matrix is useful as a coverage anchor check but should remain secondary to behavior tests. | `test/release/acceptance.test.ts` |

## Planning Scope Decision

The remediation plan covers VF-001 through VF-006. It does not perform search
or indexing performance optimization, and it does not relax SRS performance
budgets.
