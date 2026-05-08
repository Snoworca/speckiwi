import { describe, expect, it } from "vitest";
import { performance } from "node:perf_hooks";
import { resolveProjectRoot } from "../../src/core/project-root.js";
import { parseWorkspace } from "../../src/core/parser/workspace-parser.js";
import { validateWorkspace } from "../../src/core/validator/validate-workspace.js";
import { buildLargeSrsFixture, copyFixtureWorkspace } from "../fixtures/fixture-utils.js";

describe("parser performance", () => {
  it("parses and validates 500 requirement blocks under two seconds", async () => {
    const root = await copyFixtureWorkspace("valid-basic");
    await buildLargeSrsFixture(500, root);
    const start = performance.now();
    const workspace = await parseWorkspace(await resolveProjectRoot(root));
    const result = validateWorkspace(workspace);
    const elapsedMs = performance.now() - start;
    console.info(JSON.stringify({ elapsedMs, node: process.version, platform: process.platform }));
    expect(result.errors).toHaveLength(0);
    expect(workspace.records.length).toBeGreaterThanOrEqual(500);
    expect(elapsedMs).toBeLessThan(2000);
  });
});
