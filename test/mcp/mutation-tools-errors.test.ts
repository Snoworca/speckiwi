import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { diagnostic } from "../../src/core/diagnostic.js";
import { createTestMcpServer } from "../../src/mcp/adapter.js";
import { resultToMcp } from "../../src/mcp/errors.js";
import { registerMutationTools } from "../../src/mcp/tools/mutation-tools.js";
import { copyFixtureWorkspace } from "../fixtures/fixture-utils.js";

async function emptyRepo() {
  const root = await mkdtemp(path.join(tmpdir(), "speckiwi-mcp-init-"));
  await mkdir(path.join(root, ".git"));
  return root;
}

async function writeSrsLock(root: string): Promise<void> {
  await mkdir(path.join(root, "kiwi"), { recursive: true });
  await writeFile(
    path.join(root, "kiwi", ".srs.lock"),
    `${JSON.stringify(
      {
        schemaVersion: "1.0.0",
        owner: "mcp-test",
        operation: "update_status",
        requestId: "mcp-lock",
        acquiredAt: new Date(Date.now()).toISOString(),
        expiresAt: new Date(Date.now() + 60_000).toISOString()
      },
      null,
      2
    )}\n`,
    "utf8"
  );
}

describe("MCP mutation tools and structured errors", () => {
  it("maps mutation result envelopes without dropping diagnostics or stale guards", () => {
    const staleDiagnostic = diagnostic("SRS-E032", "error", "Mutation snapshot is stale", { filePath: "docs/spec/10.product-architecture.srs.md" });
    const mapped = resultToMcp({
      ok: false,
      error: {
        code: "STALE_PATCH",
        message: "Mutation snapshot is stale",
        diagnostics: [staleDiagnostic],
        staleGuard: { filePath: "docs/spec/10.product-architecture.srs.md", retry: "rerun the command" }
      },
      diagnostics: [staleDiagnostic],
      diagnosticsSummary: { errors: 1, warnings: 0, byCode: { "SRS-E032": 1 } },
      mutation: {
        kind: "add_trace_link",
        filePath: "docs/spec/10.product-architecture.srs.md",
        dryRun: false,
        written: false,
        operations: [],
        preview: []
      }
    });

    expect(mapped).toMatchObject({
      ok: false,
      error: { code: "STALE_PATCH", message: "Mutation snapshot is stale" },
      diagnostics: [expect.objectContaining({ code: "SRS-E032" })],
      diagnosticsSummary: { errors: 1, warnings: 0, byCode: { "SRS-E032": 1 } },
      staleGuard: { filePath: "docs/spec/10.product-architecture.srs.md", retry: "rerun the command" },
      mutation: { kind: "add_trace_link", written: false }
    });
  });

  it("preserves dry-run envelopes, notes, and core diagnostics on mutation tools", async () => {
    const root = await copyFixtureWorkspace("mutation-target");
    const scopePath = path.join(root, "docs", "spec", "10.product-architecture.srs.md");
    const before = await readFile(scopePath, "utf8");
    const server = createTestMcpServer({ root });
    registerMutationTools(server, { root });

    expect(await server.callTool("check_acceptance_criteria", { id: "FR-ARCH-001", acIds: ["all"], checked: true, dryRun: true })).toMatchObject({
      ok: true,
      value: { id: "FR-ARCH-001", written: false },
      diagnosticsSummary: { errors: 0, warnings: 0, byCode: {} },
      mcpWorkspace: { workspaceRoot: root, rootSource: "explicit", indexPath: "docs/spec/00.index.md", packageVersion: expect.any(String) },
      mutation: {
        kind: "check_acceptance_criteria",
        dryRun: true,
        written: false,
        filePath: "docs/spec/10.product-architecture.srs.md"
      }
    });
    await expect(readFile(scopePath, "utf8")).resolves.toBe(before);

    expect(
      await server.callTool("add_verification_evidence", {
        id: "FR-ARCH-001",
        type: "test",
        reference: "test/mcp/mutation-tools-errors.test.ts",
        covers: "AC-1",
        notes: "mcp evidence note",
        dryRun: true
      })
    ).toMatchObject({
      ok: true,
      value: { id: "FR-ARCH-001", written: false },
      mutation: {
        kind: "add_verification_evidence",
        dryRun: true,
        written: false,
        preview: [expect.stringContaining("mcp evidence note")]
      }
    });
    await expect(readFile(scopePath, "utf8")).resolves.toBe(before);

    expect(
      await server.callTool("add_trace_link", {
        id: "FR-ARCH-001",
        type: "Requirement",
        reference: "FR-ARCH-001",
        relation: "self",
        notes: "mcp trace note",
        dryRun: true
      })
    ).toMatchObject({
      ok: true,
      value: { id: "FR-ARCH-001", written: false },
      mutation: {
        kind: "add_trace_link",
        dryRun: true,
        written: false,
        preview: [expect.stringContaining("mcp trace note")]
      }
    });
    await expect(readFile(scopePath, "utf8")).resolves.toBe(before);

    expect(
      await server.callTool("add_verification_evidence", {
        id: "FR-ARCH-001",
        type: "test",
        reference: "test/mcp/mutation-tools-errors.test.ts",
        covers: "AC-1",
        notes: "mcp evidence note"
      })
    ).toMatchObject({ ok: true, value: { written: true } });
    expect(
      await server.callTool("add_trace_link", {
        id: "FR-ARCH-001",
        type: "Requirement",
        reference: "FR-ARCH-001",
        relation: "self",
        notes: "mcp trace note"
      })
    ).toMatchObject({ ok: true, value: { written: true } });

    const afterWrites = await readFile(scopePath, "utf8");
    expect(afterWrites).toContain("| VE-");
    expect(afterWrites).toContain("| test/mcp/mutation-tools-errors.test.ts | AC-1 | mcp evidence note |");
    expect(afterWrites).toContain("| Requirement | FR-ARCH-001 | self | mcp trace note |");

    expect(await server.callTool("add_completed_work", { date: "2026-05-10", requirementIds: ["FR-ARCH-001"], summary: "MCP incomplete denied." })).toMatchObject({
      ok: false,
      error: { code: "MUTATION_DENIED" },
      diagnostics: expect.arrayContaining([expect.objectContaining({ code: "SRS-W015" })]),
      diagnosticsSummary: { warnings: 1, byCode: { "SRS-W015": 1 } }
    });
  });

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
    expect(await server.callTool("set_active_target", { target: "v2.3.0", create: true, type: "version", description: "Tool improvement" })).toMatchObject({
      ok: true,
      value: { activeTarget: "v2.3.0", created: true, written: true }
    });
    const mcpAdd = await server.callTool("add_requirement", {
      root: otherRoot,
      type: "functional",
      scope: "ARCH",
      title: "MCP 추가",
      requirement: "MCP가 요구사항을 추가한다.",
      acceptanceCriteria: ["created"],
      priority: "high",
      dryRun: true
    });
    expect(mcpAdd).toMatchObject({
      ok: false,
      error: { code: "MCP_WORKSPACE_ROOT_UNSUPPORTED" },
      diagnosticsSummary: { byCode: { "SRS-E075": 1 } },
      mcpWorkspace: { workspaceRoot: root }
    });
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
    ).toMatchObject({ ok: false, error: { code: "MCP_WORKSPACE_ROOT_UNSUPPORTED" } });
    expect(await readFile(path.join(root, "docs", "spec", "00.index.md"), "utf8")).toContain("| Active Target | v2.3.0 |");
    expect(await readFile(path.join(root, "docs", "spec", "00.index.md"), "utf8")).toContain("| 2026-05-10 | v1.1.0 | ARCH | FR-ARCH-001 | MCP completed work row. |");
    expect(
      await server.callTool("add_requirement", {
        type: "functional",
        scope: "ARCH",
        target: "v1.0.0",
        title: "누락",
        acceptanceCriteria: ["created"]
      })
    ).toMatchObject({
      ok: false,
      error: { code: "USAGE" },
      diagnostics: [],
      diagnosticsSummary: { errors: 0, warnings: 0, byCode: {} },
      recovery: { tool: "add_requirement" }
    });

    const emptyTargetRoot = await copyFixtureWorkspace("mutation-target");
    const emptyIndexPath = path.join(emptyTargetRoot, "docs", "spec", "00.index.md");
    await writeFile(emptyIndexPath, (await readFile(emptyIndexPath, "utf8")).replace("| Active Target | v1.0.0 |", "| Active Target |  |"), "utf8");
    const emptyTargetServer = createTestMcpServer({ root: emptyTargetRoot });
    registerMutationTools(emptyTargetServer, { root: emptyTargetRoot });
    expect(
      await emptyTargetServer.callTool("add_requirement", {
        type: "functional",
        scope: "ARCH",
        title: "MCP no target",
        requirement: "MCP must fail when neither explicit target nor Active Target exists.",
        acceptanceCriteria: ["rejected"]
      })
    ).toMatchObject({
      ok: false,
      error: { code: "USAGE", message: expect.stringContaining("Active Target is empty") }
    });
  });

  it("FR-MCP-032 reports SRS locks and supports narrow ignoreLock", async () => {
    const root = await copyFixtureWorkspace("mutation-target");
    const scopePath = path.join(root, "docs", "spec", "10.product-architecture.srs.md");
    const before = await readFile(scopePath, "utf8");
    await writeSrsLock(root);
    const server = createTestMcpServer({ root });
    registerMutationTools(server, { root });

    await expect(server.callTool("update_status", { id: "FR-ARCH-001", status: "blocked" })).resolves.toMatchObject({
      ok: false,
      error: {
        code: "SRS_LOCKED",
        lock: {
          owner: "mcp-test",
          operation: "update_status",
          requestId: "mcp-lock",
          retry: expect.any(Object)
        }
      },
      diagnosticsSummary: { errors: 1, byCode: { "SRS-E065": 1 } }
    });
    await expect(readFile(scopePath, "utf8")).resolves.toBe(before);

    await expect(server.callTool("update_status", { id: "FR-ARCH-001", status: "blocked", dryRun: true })).resolves.toMatchObject({
      ok: false,
      error: { code: "SRS_LOCKED" }
    });
    await expect(readFile(scopePath, "utf8")).resolves.toBe(before);

    await expect(server.callTool("init_project", { force: true })).resolves.toMatchObject({
      ok: false,
      error: { code: "SRS_LOCKED" }
    });
    await expect(readFile(scopePath, "utf8")).resolves.toBe(before);

    await expect(
      server.callTool("add_verification_evidence", {
        id: "FR-ARCH-001",
        type: "test",
        reference: "bad|cell",
        ignoreLock: true
      })
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "MUTATION_DENIED" }
    });
    await expect(readFile(scopePath, "utf8")).resolves.toBe(before);

    await expect(server.callTool("update_status", { id: "FR-ARCH-001", status: "blocked", ignoreLock: true })).resolves.toMatchObject({
      ok: true,
      diagnostics: expect.arrayContaining([expect.objectContaining({ code: "SRS-W067" })])
    });
    await expect(readFile(scopePath, "utf8")).resolves.toContain("| Status | blocked |");
  });

  it("FR-MCP-032 applies SRS locks to init_project and allows explicit SRS-only bypass", async () => {
    const root = await emptyRepo();
    await writeSrsLock(root);
    const server = createTestMcpServer({ root });
    registerMutationTools(server, { root });

    await expect(server.callTool("init_project", { target: "v1.0.0", scope: "Payments:PAY" })).resolves.toMatchObject({
      ok: false,
      error: { code: "SRS_LOCKED" }
    });
    await expect(readFile(path.join(root, "docs", "spec", "00.index.md"), "utf8")).rejects.toMatchObject({ code: "ENOENT" });

    await expect(server.callTool("init_project", { target: "v1.0.0", scope: "Payments:PAY", ignoreLock: true })).resolves.toMatchObject({
      ok: true,
      diagnostics: expect.arrayContaining([expect.objectContaining({ code: "SRS-W067" })])
    });
    await expect(readFile(path.join(root, "docs", "spec", "00.index.md"), "utf8")).resolves.toContain("10.payments.srs.md");
  });

  it("init_project always creates or updates both agent files", async () => {
    const root = await emptyRepo();
    const server = createTestMcpServer({ root });
    registerMutationTools(server, { root });

    expect(await server.callTool("init_project", { target: "v1.0.0", scope: "Payments:PAY" })).toMatchObject({ ok: true });
    expect(await readFile(path.join(root, "docs", "spec", "00.index.md"), "utf8")).toContain("| Active Target |  |");
    expect(await readFile(path.join(root, "docs", "spec", "00.index.md"), "utf8")).toContain("| v1.0.0 | release | planned | Initial target |");
    expect(await readFile(path.join(root, "AGENTS.md"), "utf8")).toContain("# SpecKiwi SRS 워크플로 v1.4");
    expect(await readFile(path.join(root, "AGENTS.md"), "utf8")).toContain("Agents MUST follow TDD for behavior changes");
    expect(await readFile(path.join(root, "CLAUDE.md"), "utf8")).toContain("# SpecKiwi SRS 워크플로 v1.4");
    expect(await readFile(path.join(root, "CLAUDE.md"), "utf8")).toContain("Agents MUST follow TDD for behavior changes");
  });
});
