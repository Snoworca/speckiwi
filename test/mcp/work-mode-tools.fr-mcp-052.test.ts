import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { renderToolNames } from "../../src/mcp/schemas.js";
import { createMcpServer, isReadOnlyTool } from "../../src/mcp/server.js";
import { copyFixtureWorkspace } from "../fixtures/fixture-utils.js";

// FR-MCP-052 — MCP work-mode tools get_work_mode and set_work_mode. RED suite
// (one case per AC). The suite fails while the schemas.ts `mode` row carries no
// mcpName (the work-mode is CLI-only), so neither tool exists on the running
// server, until the registry rows, zod schemas, and handlers land.
//
// Contract under test (docs/spec/40.mcp-stdio-interface.srs.md FR-MCP-052):
//   - AC-1: get_work_mode returns the persisted mode (+ activeTask for tdd) and
//           falls open to wait when state.md is absent.
//   - AC-2: set_work_mode persists Mode/Active Task for tdd; dryRun writes nothing.
//   - AC-3: set_work_mode rejects an out-of-enum mode with INVALID_MODE, no write.
//   - AC-4: both tools are registered consistently; get_work_mode is read-only.

const GET_TOOL = "get_work_mode";
const SET_TOOL = "set_work_mode";
const STATE_PATH = path.join("docs", "spec", "steps", "state.md");

async function writeStateMd(root: string, options: { mode: string; activeTask?: string }): Promise<void> {
  const stepsDir = path.join(root, "docs", "spec", "steps");
  await mkdir(stepsDir, { recursive: true });
  const lines = [
    "# Step State",
    "",
    `Mode: ${options.mode}`,
    ...(options.activeTask !== undefined ? [`Active Task: ${options.activeTask}`] : []),
    "",
    "| Step | Status | DependsOn | TouchesScope | TouchesReq | Created | Updated |",
    "| --- | --- | --- | --- | --- | --- | --- |",
    "| step-a | active | - | ARCH | - | 2026-07-16 | 2026-07-16 |",
    ""
  ];
  await writeFile(path.join(stepsDir, "state.md"), lines.join("\n"), "utf8");
}

describe("FR-MCP-052 MCP work-mode tools", () => {
  it("FR-MCP-052 AC-1: get_work_mode returns the persisted tdd mode and falls open to wait", async () => {
    const rootPath = await copyFixtureWorkspace("valid-basic");
    await writeStateMd(rootPath, { mode: "tdd", activeTask: "T-TDD-01" });
    const server = createMcpServer({ root: rootPath });

    const result = await server.callTool(GET_TOOL, {});
    expect(result.ok).toBe(true);
    expect(result.value.mode).toBe("tdd");
    expect(result.value.activeTask).toBe("T-TDD-01");

    // Fail-open: no state.md at all still reads as wait.
    const bareRoot = await copyFixtureWorkspace("valid-basic");
    const bareServer = createMcpServer({ root: bareRoot });
    const bare = await bareServer.callTool(GET_TOOL, {});
    expect(bare.ok).toBe(true);
    expect(bare.value.mode).toBe("wait");
  });

  it("FR-MCP-052 AC-2: set_work_mode persists tdd with its Active Task and dryRun writes nothing", async () => {
    const rootPath = await copyFixtureWorkspace("valid-basic");
    await writeStateMd(rootPath, { mode: "sdd" });
    const server = createMcpServer({ root: rootPath });

    const result = await server.callTool(SET_TOOL, { mode: "tdd", activeTask: "T-TDD-02" });
    expect(result.ok).toBe(true);
    expect(result.value.mode).toBe("tdd");

    const persisted = await readFile(path.join(rootPath, STATE_PATH), "utf8");
    expect(persisted).toMatch(/^\s*Mode:\s*tdd\s*$/m);
    expect(persisted).toMatch(/^\s*Active Task:\s*T-TDD-02\s*$/m);

    const readBack = await server.callTool(GET_TOOL, {});
    expect(readBack.value.mode).toBe("tdd");
    expect(readBack.value.activeTask).toBe("T-TDD-02");

    // dryRun: a switch away from tdd must not touch the file.
    const dry = await server.callTool(SET_TOOL, { mode: "sdd", dryRun: true });
    expect(dry.ok).toBe(true);
    const afterDry = await readFile(path.join(rootPath, STATE_PATH), "utf8");
    expect(afterDry).toMatch(/^\s*Mode:\s*tdd\s*$/m);
  });

  it("FR-MCP-052 AC-3: set_work_mode rejects an out-of-enum mode with INVALID_MODE and no write", async () => {
    const rootPath = await copyFixtureWorkspace("valid-basic");
    await writeStateMd(rootPath, { mode: "sdd" });
    const server = createMcpServer({ root: rootPath });

    const result = await server.callTool(SET_TOOL, { mode: "tddx" });
    expect(result.ok).toBe(false);
    expect(result.error.code).toBe("INVALID_MODE");

    const persisted = await readFile(path.join(rootPath, STATE_PATH), "utf8");
    expect(persisted).toMatch(/^\s*Mode:\s*sdd\s*$/m);
    expect(persisted).not.toMatch(/tddx/);
  });

  it("FR-MCP-052 AC-4: both tools are registered and get_work_mode is read-only", () => {
    // Registry surface (schemas.ts).
    const registry = renderToolNames();
    expect(registry).toContain(GET_TOOL);
    expect(registry).toContain(SET_TOOL);

    // Runtime surface (createMcpServer).
    const handle = createMcpServer({});
    const runtime = Object.keys(handle.tools).filter((name) => !name.startsWith("resource:"));
    expect(runtime).toContain(GET_TOOL);
    expect(runtime).toContain(SET_TOOL);

    // Read-only classification.
    expect(isReadOnlyTool(GET_TOOL)).toBe(true);
    expect(isReadOnlyTool(SET_TOOL)).toBe(false);
  });
});
