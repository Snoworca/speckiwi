import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createTestMcpServer } from "../../src/mcp/adapter.js";
import { isReadOnlyTool, toolSchemas } from "../../src/mcp/server.js";
import { registerMutationTools } from "../../src/mcp/tools/mutation-tools.js";
import { parseWorkspace } from "../../src/core/parser/workspace-parser.js";
import { resolveProjectRoot } from "../../src/core/project-root.js";
import { validateWorkspace } from "../../src/core/validator/validate-workspace.js";
import { copyFixtureWorkspace } from "../fixtures/fixture-utils.js";

async function codes(root: string): Promise<string[]> {
  return validateWorkspace(await parseWorkspace(await resolveProjectRoot(root))).diagnostics.map((item) => item.code);
}

async function addRollupTables(root: string): Promise<void> {
  const indexPath = path.join(root, "docs", "spec", "00.index.md");
  const text = await readFile(indexPath, "utf8");
  await writeFile(
    indexPath,
    text.replace(
      "## 5. Completed Work Log",
      [
        "## 5. Status Summary",
        "",
        "| Status | Count |",
        "|---|---:|",
        "| planned | 1 |",
        "",
        "## 6. Requirement Type Summary",
        "",
        "| Type | Prefix | Count |",
        "|---|---|---:|",
        "| functional | FR | 1 |",
        "",
        "## 7. Completed Work Log"
      ].join("\n")
    ),
    "utf8"
  );
}

describe("FR-NODE-018 MCP sync_index tool", () => {
  it("keeps validation clean after MCP add_requirement and update_status tool flows", async () => {
    const addRoot = await copyFixtureWorkspace("mutation-target");
    await addRollupTables(addRoot);
    const addServer = createTestMcpServer({ root: addRoot });
    registerMutationTools(addServer, { root: addRoot });

    await expect(
      addServer.callTool("add_requirement", {
        type: "reliability",
        scope: "ARCH",
        target: "v1.0.0",
        title: "MCP rollup-safe requirement",
        requirement: "MCP must keep rollups synchronized after requirement creation.",
        acceptanceCriteria: ["rollups synchronized"],
        stability: "stable"
      })
    ).resolves.toMatchObject({ ok: true, value: { written: true }, indexSync: { written: true, statusSummaryChanged: true, typeSummaryChanged: true } });
    expect(await codes(addRoot)).toEqual([]);

    const statusRoot = await copyFixtureWorkspace("mutation-target");
    await addRollupTables(statusRoot);
    const statusServer = createTestMcpServer({ root: statusRoot });
    registerMutationTools(statusServer, { root: statusRoot });

    await expect(statusServer.callTool("update_status", { id: "FR-ARCH-001", status: "implemented" })).resolves.toMatchObject({
      ok: true,
      value: { written: true },
      indexSync: { written: true, statusSummaryChanged: true }
    });
    expect(await codes(statusRoot)).toEqual([]);
  });

  it("registers as a workspace mutation and repairs rollup drift", async () => {
    const root = await copyFixtureWorkspace("index-drift-status-summary");
    const server = createTestMcpServer({ root });
    registerMutationTools(server, { root });

    expect(server.tools.sync_index).toBeDefined();
    expect(server.toolKinds.sync_index).toBe("workspace");
    expect(toolSchemas.sync_index).toBeDefined();
    expect(isReadOnlyTool("sync_index")).toBe(false);

    const dryRun = (await server.callTool("sync_index", { dryRun: true })) as Record<string, unknown>;
    expect(dryRun).toMatchObject({
      ok: true,
      value: { written: false, statusSummaryChanged: true },
      mutation: { kind: "sync_index_rollups", dryRun: true, written: false }
    });
    expect(await codes(root)).toContain("SRS-W019");

    const written = (await server.callTool("sync_index", {})) as Record<string, unknown>;
    expect(written).toMatchObject({ ok: true, value: { written: true, statusSummaryChanged: true } });
    expect(await codes(root)).not.toContain("SRS-W019");
  });
});
