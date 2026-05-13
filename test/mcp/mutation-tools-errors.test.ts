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
    expect(await server.callTool("set_active_target", { target: "v1.1.0" })).toMatchObject({ ok: true, value: { activeTarget: "v1.1.0" } });
    expect(await server.callTool("add_completed_work", { date: "2026-05-10", requirementIds: ["FR-ARCH-001"], summary: "MCP incomplete denied." })).toMatchObject({
      ok: false,
      error: { code: "MUTATION_DENIED" }
    });
    expect(
      await server.callTool("add_completed_work", {
        date: "2026-05-10",
        requirementIds: ["FR-ARCH-001"],
        summary: "MCP report path dry-run row.",
        reportPaths: ["docs/reports/mcp.md", "docs/reports/mcp.md"],
        allowIncomplete: true,
        dryRun: true
      })
    ).toMatchObject({
      ok: true,
      value: { written: false, reportPaths: ["docs/reports/mcp.md", "docs/reports/mcp.md"] },
      patch: { dryRun: true }
    });
    expect(await server.callTool("update_status", { id: "FR-ARCH-001", status: "verified" })).toMatchObject({ ok: true });
    expect(await server.callTool("add_completed_work", { date: "2026-05-10", target: "v1.1.0", scope: "ARCH", requirementIds: ["FR-ARCH-001"], summary: "MCP completed work row." })).toMatchObject({
      ok: true,
      value: { written: true }
    });
    expect(await server.callTool("add_completed_work", { date: "2026-05-10", summary: "MCP dry-run completed work row.", dryRun: true })).toMatchObject({
      ok: true,
      value: { written: false },
      patch: { dryRun: true }
    });
    expect(await server.callTool("add_completed_work", { date: "2026-05-10", summary: "Bad report path.", reportPaths: ["../escape.md"] })).toMatchObject({
      ok: false,
      error: { code: "MUTATION_DENIED" }
    });
    expect(await server.callTool("add_completed_work", { date: "2026-05-10", summary: "Bad | row" })).toMatchObject({ ok: false, error: { code: "MUTATION_DENIED" } });
    expect(await server.callTool("update_status", { id: "MISSING", status: "verified" })).toMatchObject({ ok: false, error: { code: "NOT_FOUND" } });
    const mcpAdd = await server.callTool("add_requirement", {
      root: otherRoot,
      type: "functional",
      scope: "ARCH",
      target: "v1.0.0",
      title: "MCP 추가",
      requirement: "MCP가 요구사항을 추가한다.",
      acceptanceCriteria: ["created"],
      priority: "high",
      dryRun: true
    });
    expect(mcpAdd).toMatchObject({ ok: true, value: { requirementId: "FR-ARCH-002", written: false, record: { metadata: { Stability: "draft" }, stability: "draft" } } });
    expect(
      await server.callTool("add_requirement", {
        root: otherRoot,
        type: "functional",
        scope: "ARCH",
        target: "v1.0.0",
        title: "MCP volatile",
        requirement: "MCP must reject legacy stability for new requirements.",
        acceptanceCriteria: ["rejected"],
        stability: "volatile"
      })
    ).toMatchObject({ ok: false, error: { code: "MUTATION_DENIED" } });
    expect(await readFile(path.join(root, "docs", "spec", "00.index.md"), "utf8")).toContain("| Active Target | v1.1.0 |");
    expect(await readFile(path.join(root, "docs", "spec", "00.index.md"), "utf8")).toContain("| 2026-05-10 | v1.1.0 | ARCH | FR-ARCH-001 | MCP completed work row. |");
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
    expect(await readFile(path.join(root, "docs", "spec", "00.index.md"), "utf8")).toContain("| Active Target |  |");
    expect(await readFile(path.join(root, "docs", "spec", "00.index.md"), "utf8")).toContain("| v1.0.0 | release | planned | Initial target |");
    expect(await readFile(path.join(root, "AGENTS.md"), "utf8")).toContain("# SpecKiwi SRS 워크플로 v1.3");
    expect(await readFile(path.join(root, "AGENTS.md"), "utf8")).toContain("Agents MUST follow TDD for behavior changes");
    expect(await readFile(path.join(root, "CLAUDE.md"), "utf8")).toContain("# SpecKiwi SRS 워크플로 v1.3");
    expect(await readFile(path.join(root, "CLAUDE.md"), "utf8")).toContain("Agents MUST follow TDD for behavior changes");
  });
});
