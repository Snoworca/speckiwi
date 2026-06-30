# Final Validation

Run only after Phases 1-4 complete.

## Required Commands

```sh
git diff --check
npm run typecheck
npm run lint
npm test
npm run test:integration
npm run release:acceptance
npm run perf:srs
npm run release:check
node bin/speckiwi validate --fail-on-warning --json
node bin/speckiwi summary --target v2.3.0 --json
node bin/speckiwi links check --json
node bin/speckiwi doctor --json
npm pack --dry-run --ignore-scripts --json
```

## Expected Release-Readiness State

- `ready: true`
- `implementedNotVerified: []`
- `missingEvidence: []`
- `acCoverageGaps: []`
- `missingEvidenceReferences: []`
- `brokenTraceLinks: []`
- `commandEvidencePolicyViolations: []`
- `baselineCommand: "git tag srs-v2.3.0-baseline"`

## Live MCP Gate

Fresh-process doctor currently proves the checkout exposes 53 MCP tools. Before cutting a release or claiming live agent readiness, restart/reload the configured Codex MCP session and verify the live tool surface includes at least:

- `mcp_workspace_info`
- `workflow_doctor`
- `sync_index`
- `apply_requirement_id_collision_repair`

If live Codex MCP remains stale, do not block SRS closeout, but record it as deployment/config follow-up before release publishing.

## Release-Cut Boundary

Do not run the package version bump in this closeout. Once this plan is complete and `release:check` passes, perform release-cut separately:

```sh
npm version 2.3.0 --no-git-tag-version
npm install --package-lock-only --ignore-scripts
npm run build
node scripts/version-check.mjs
npm pack --dry-run --json
node bin/speckiwi --root . doctor --json
SPECKIWI_TARGET=v2.3.0 npm run release:check
```
