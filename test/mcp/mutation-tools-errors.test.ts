import { mkdir, mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createTestMcpServer } from "../../src/mcp/adapter.js";
import { registerMutationTools } from "../../src/mcp/tools/mutation-tools.js";
import { copyFixtureWorkspace } from "../fixtures/fixture-utils.js";

async function emptyRepo() {
  const root = await mkdtemp(path.join(tmpdir(), "speckiwi-mcp-init-"));
  await mkdir(path.join(root, ".git"));
  return root;
}

describe("MCP mutation tools and structured errors", () => {
  it("delegates mutations to core services", async () => {
    const root = await copyFixtureWorkspace("mutation-target");
    const otherRoot = await copyFixtureWorkspace("duplicate-id");
    const server = createTestMcpServer({ root });
    registerMutationTools(server, { root });

    expect(await server.callTool("check_acceptance_criteria", { id: "FR-ARCH-001", acIds: ["all"], checked: true })).toMatchObject({ ok: true });
    expect(await server.callTool("add_verification_evidence", { id: "FR-ARCH-001", type: "test", reference: "test/mcp/mutation-tools-errors.test.ts", covers: "all" })).toMatchObject({ ok: true });
    expect(await server.callTool("update_status", { id: "FR-ARCH-001", status: "verified" })).toMatchObject({ ok: true });
    expect(await server.callTool("update_status", { id: "MISSING", status: "verified" })).toMatchObject({ ok: false, error: { code: "NOT_FOUND" } });
    expect(
      await server.callTool("add_requirement", {
        root: otherRoot,
        type: "functional",
        scope: "ARCH",
        target: "v1.0.0",
        title: "MCP 추가",
        requirement: "MCP가 요구사항을 추가한다.",
        acceptanceCriteria: ["created"],
        priority: "high",
        dryRun: true
      })
    ).toMatchObject({ ok: true, value: { requirementId: "FR-ARCH-002", written: false } });
    expect(
      await server.callTool("add_requirement", {
        type: "functional",
        scope: "ARCH",
        target: "v1.0.0",
        title: "누락",
        acceptanceCriteria: ["created"]
      })
    ).toMatchObject({ ok: false, error: { code: "USAGE" } });
  });

  it("init_project always creates or updates both agent files", async () => {
    const root = await emptyRepo();
    const server = createTestMcpServer({ root });
    registerMutationTools(server, { root });

    expect(await server.callTool("init_project", { target: "v1.0.0", scope: "Payments:PAY" })).toMatchObject({ ok: true });
    expect(await readFile(path.join(root, "AGENTS.md"), "utf8")).toContain("docs/rule/SRS-MD-Rules-v1.0.0.md");
    expect(await readFile(path.join(root, "CLAUDE.md"), "utf8")).toContain("docs/rule/SRS-MD-Rules-v1.0.0.md");
  });
});
