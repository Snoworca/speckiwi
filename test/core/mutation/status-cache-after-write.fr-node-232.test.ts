import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { expireAcceptanceCriterion } from "../../../src/core/mutation/expire-ac.js";
import { renameScope } from "../../../src/core/mutation/rename-scope.js";
import { renameTarget } from "../../../src/core/mutation/rename-target.js";
import { retarget } from "../../../src/core/mutation/retarget.js";
import { scaffoldScope } from "../../../src/core/mutation/scaffold-scope.js";
import { parseWorkspace } from "../../../src/core/parser/workspace-parser.js";
import { resolveProjectRoot } from "../../../src/core/project-root.js";
import { readFreshSrsStatusCache } from "../../../src/core/status-cache.js";
import type { MutationResult, ProjectRoot } from "../../../src/core/types.js";
import { copyFixtureWorkspace } from "../../fixtures/fixture-utils.js";

// The SRS mutation lock rebuilds kiwi/.status.json after a write only when the tool's output says
// `written: true`. A tool that writes without saying so leaves the cache describing the files before
// the write, with the lock still marked active. Denominator: every SRS mutation that 5.2.0 adds or
// changes and that runs under withSrsMutationLock (prd_cursor writes its ledger, not docs/spec, and
// takes no SRS lock, so it is outside this set).

async function withSecondTarget(rootPath: string): Promise<void> {
  const index = path.join(rootPath, "docs", "spec", "00.index.md");
  const text = await readFile(index, "utf8");
  const row = "| v1.0.0 | release | active | Fixture release |";
  expect(text).toContain(row);
  await writeFile(index, text.replace(row, `${row}\n| v1.1.0 | release | planned | Next release |`), "utf8");
}

const CASES: Array<{ tool: string; run: (root: ProjectRoot, rootPath: string) => Promise<MutationResult<unknown>> }> = [
  { tool: "rename_scope", run: (root) => renameScope(root, { from: "10.product-architecture", to: "10.platform-architecture", apply: true }) },
  { tool: "scaffold_scope", run: (root) => scaffoldScope(root, { name: "Reporting", prefix: "RPT", apply: true }) },
  { tool: "rename_target", run: (root) => renameTarget(root, { from: "v1.0.0", to: "v1.0.1", dryRun: false }) },
  {
    tool: "expire_acceptance_criterion",
    run: (root) => expireAcceptanceCriterion(root, { id: "FR-ARCH-001", acId: "AC-2", reason: "covered elsewhere", dryRun: false })
  },
  {
    tool: "retarget",
    run: async (root, rootPath) => {
      await withSecondTarget(rootPath);
      return retarget(root, { ids: ["FR-ARCH-001"], toTarget: "v1.1.0", reason: "moved", dryRun: false });
    }
  }
];

describe("FR-NODE-232 an applied SRS mutation leaves the status cache fresh and unlocked", () => {
  for (const { tool, run } of CASES) {
    // @req FR-NODE-232 AC-1
    it(`${tool}: kiwi/.status.json matches the files after the write and the lock is released`, async () => {
      const rootPath = await copyFixtureWorkspace("valid-basic");
      const root = await resolveProjectRoot(rootPath);

      const result = await run(root, rootPath);

      expect(result.ok, JSON.stringify(result.error)).toBe(true);
      expect((result.value as { written?: unknown }).written).toBe(true);
      const fresh = await readFreshSrsStatusCache(root, await parseWorkspace(root));
      expect(fresh.ok, JSON.stringify(fresh.ok ? {} : fresh.diagnostics)).toBe(true);
      expect(fresh.ok && fresh.value.lock.active).toBe(false);
    });
  }
});
