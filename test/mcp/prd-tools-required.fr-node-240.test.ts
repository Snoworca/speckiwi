import { describe, expect, it } from "vitest";
import { toolSchemas } from "../../src/mcp/server.js";
import { mcp, PRD_PATH, prdWorkspace } from "../cli/prd-surface-fixture.js";

// @req FR-NODE-240 AC-1, AC-3, FR-NODE-241 AC-1, FR-NODE-242 AC-2, IR-MCP-006 AC-1, FR-NODE-243 AC-6 — an argument the MCP input schema
// declares required is refused as a usage error when it is missing, as the CLI refuses a missing
// argument; it is never read as an empty string that then fails as "not found". The required keys come
// from the schema itself, so a key made required there is covered here too.

// The 5.2.0 tools: the PRD tools, rename_scope and expire_acceptance_criterion.
const PRD_TOOLS = ["check_prd", "list_prd_items", "get_prd_item", "search_prd_items", "prd_cursor", "check_prd_coverage", "rename_scope", "expire_acceptance_criterion"] as const;

/** A complete, valid input for each tool. */
const VALID: Record<(typeof PRD_TOOLS)[number], Record<string, unknown>> = {
  check_prd: { path: PRD_PATH },
  list_prd_items: { path: PRD_PATH },
  get_prd_item: { path: PRD_PATH, id: "PRD-1" },
  search_prd_items: { query: "reset" },
  prd_cursor: { action: "current", path: PRD_PATH, runId: "req" },
  check_prd_coverage: { path: PRD_PATH, target: "v1.0.0" },
  rename_scope: { from: "10.product-architecture.srs.md", to: "11.product-architecture" },
  expire_acceptance_criterion: { id: "FR-ARCH-001", acId: "AC-1", reason: "moved elsewhere", dryRun: true }
};

const requiredKeys = (tool: string) =>
  Object.entries(toolSchemas[tool]!)
    .filter(([, schema]) => !schema.isOptional())
    .map(([key]) => key);

describe("PRD MCP tools refuse a missing required argument", () => {
  it("declares the required arguments in the schema", () => {
    expect(requiredKeys("get_prd_item")).toEqual(["path", "id"]);
    expect(requiredKeys("check_prd_coverage")).toEqual(["path", "target"]);
    expect(requiredKeys("prd_cursor")).toEqual(["action", "path", "runId"]);
    expect(requiredKeys("rename_scope")).toEqual(["from", "to"]);
    expect(requiredKeys("expire_acceptance_criterion")).toEqual(["id", "acId", "reason"]);
  });

  it.each(PRD_TOOLS.flatMap((tool) => requiredKeys(tool).map((key) => [tool, key] as const)))("%s without %s is a usage error", async (tool, key) => {
    const root = await prdWorkspace();
    const input = { ...VALID[tool] };
    // The complete input passes the argument check; a mutation may still refuse it for its own reasons.
    expect((await mcp(root, tool, input)).error?.code, "the complete input is no usage error").not.toBe("USAGE");
    delete input[key];
    const answer = await mcp(root, tool, input);
    expect(answer.ok).toBe(false);
    expect(answer.error?.code).toBe("USAGE");
    expect(answer.error?.message).toContain(key);
  });
});
