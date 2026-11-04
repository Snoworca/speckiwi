import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { isReadOnlyTool } from "../../src/mcp/server.js";
import { cli, cliJson, mcp, PRD_PATH, prdWorkspace } from "./prd-surface-fixture.js";

// FR-NODE-242 AC-2, AC-3 — `speckiwi prd coverage <file> --target <t>` and the MCP tool
// check_prd_coverage. valid-basic holds FR-ARCH-001 (AC-1, AC-2) in target v1.0.0; its Rationale is
// rewritten here to cite PRD-2 for AC-1.

interface Coverage {
  prd: string;
  target: string;
  uncitedItems: Array<{ id: string }>;
  uncitedRequirements: Array<{ requirementId: string }>;
  ungroundedCriteria: Array<{ requirementId: string; criterionId: string }>;
  notJudged: string;
}

const SCOPE = path.join("docs", "spec", "10.product-architecture.srs.md");

async function cite(root: string, rationale: string): Promise<void> {
  const file = path.join(root, SCOPE);
  const text = await readFile(file, "utf8");
  await writeFile(file, text.replace("The parser needs a small valid workspace.", rationale), "utf8");
}

describe("FR-NODE-242 AC-2 — prd coverage / check_prd_coverage", () => {
  // @req FR-NODE-242 AC-2
  it("lists the uncited items, the uncited requirements and the ungrounded criteria, and the MCP answer equals the CLI JSON", async () => {
    const root = await prdWorkspace();
    await cite(root, "AC-1 ← PRD-2");
    const { code, json } = await cliJson<Coverage>(root, "coverage", PRD_PATH, "--target", "v1.0.0");
    expect(code).toBe(0);
    expect(json.target).toBe("v1.0.0");
    expect(json.uncitedItems.map((item) => item.id)).toEqual(["PRD-1"]);
    expect(json.uncitedRequirements).toEqual([]);
    expect(json.ungroundedCriteria.map((item) => `${item.requirementId}#${item.criterionId}`)).toEqual(["FR-ARCH-001#AC-2"]);
    expect((await mcp<Coverage>(root, "check_prd_coverage", { path: PRD_PATH, target: "v1.0.0" })).value).toEqual(json);
  });

  // @req FR-NODE-242 AC-2
  it("lists a requirement that cites no PRD item", async () => {
    const root = await prdWorkspace();
    const { json } = await cliJson<Coverage>(root, "coverage", PRD_PATH, "--target", "v1.0.0");
    expect(json.uncitedRequirements.map((item) => item.requirementId)).toEqual(["FR-ARCH-001"]);
    expect(json.uncitedItems.map((item) => item.id)).toEqual(["PRD-1", "PRD-2"]);
  });

  // @req FR-NODE-242 AC-2
  it("refuses a missing --target as a usage error and an unknown target as TARGET_NOT_FOUND, on both surfaces", async () => {
    const root = await prdWorkspace();
    expect((await cli(root, "coverage", PRD_PATH)).code).toBe(2);
    const unknown = await cliJson<{ error: { code: string } }>(root, "coverage", PRD_PATH, "--target", "v9.9.9");
    expect(unknown.code).toBe(5);
    expect(unknown.json.error.code).toBe("TARGET_NOT_FOUND");
    expect((await mcp(root, "check_prd_coverage", { path: PRD_PATH, target: "v9.9.9" })).error?.code).toBe("TARGET_NOT_FOUND");
    expect((await mcp(root, "check_prd_coverage", { path: "docs/prd/none.prd.md", target: "v1.0.0" })).error?.code).toBe("NOT_FOUND");
  });
});

describe("FR-NODE-242 AC-3 — coverage judges only string comparison", () => {
  // @req FR-NODE-242 AC-3
  it("states that scope and contradiction are left to the verifier, in JSON and in human output", async () => {
    const root = await prdWorkspace();
    const { json } = await cliJson<Coverage>(root, "coverage", PRD_PATH, "--target", "v1.0.0");
    expect(json.notJudged).toMatch(/left to the verifier/);
    const { stdout } = await cli(root, "coverage", PRD_PATH, "--target", "v1.0.0");
    expect(stdout).toContain(json.notJudged);
    expect(stdout).toContain("PRD-1");
    expect(isReadOnlyTool("check_prd_coverage")).toBe(true);
  });
});
