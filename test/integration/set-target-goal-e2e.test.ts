import { describe, expect, it } from "vitest";
import { resolveProjectRoot } from "../../src/core/project-root.js";
import { parseWorkspace } from "../../src/core/parser/workspace-parser.js";
import { summarizeTarget } from "../../src/core/query/summary.js";
import { createTestMcpServer } from "../../src/mcp/adapter.js";
import { registerReadTools } from "../../src/mcp/tools/read-tools.js";
import { registerMutationTools } from "../../src/mcp/tools/mutation-tools.js";
import { copyFixtureWorkspace } from "../fixtures/fixture-utils.js";

describe("FR-MCP-019 e2e — set_target_goal write + read parity", () => {
  it("(1) summarize_target.value.goal reflects the persisted goal", async () => {
    const rootPath = await copyFixtureWorkspace("valid-basic");
    void (await resolveProjectRoot(rootPath));
    const server = createTestMcpServer({ root: rootPath });
    registerReadTools(server, { root: rootPath });
    registerMutationTools(server, { root: rootPath });
    const set = await server.callTool("set_target_goal", { target: "v1.0.0", goal: "Establish parser baseline." });
    expect(set).toMatchObject({ ok: true });
    const summary = (await server.callTool("summarize_target", { target: "v1.0.0" })) as { ok: true; value: { goal: string | null } };
    expect(summary.ok).toBe(true);
    expect(summary.value.goal).toBe("Establish parser baseline.");
  });

  it("(2) get_active_target.value.goal exposed at top-level AND inside summary", async () => {
    const rootPath = await copyFixtureWorkspace("valid-basic");
    void (await resolveProjectRoot(rootPath));
    const server = createTestMcpServer({ root: rootPath });
    registerReadTools(server, { root: rootPath });
    registerMutationTools(server, { root: rootPath });
    await server.callTool("set_target_goal", { target: "v1.0.0", goal: "Establish parser baseline." });
    const result = (await server.callTool("get_active_target", {})) as { ok: true; value: { goal: string | null; summary: { goal: string | null } } };
    expect(result.value.goal).toBe("Establish parser baseline.");
    expect(result.value.summary.goal).toBe("Establish parser baseline.");
  });

  it("(3) absence: target with no goal yields null both in summary and active-target", async () => {
    const rootPath = await copyFixtureWorkspace("mutation-target");
    const root = await resolveProjectRoot(rootPath);
    const workspace = await parseWorkspace(root);
    const summary = summarizeTarget(workspace, { target: "v1.1.0" });
    expect(summary.goal).toBeNull();
    const activeSummary = summarizeTarget(workspace, {});
    expect(activeSummary.goal).toBeNull();
  });

  it("(4) AC-7 isolation: REQ status / stability counters unchanged after set_target_goal", async () => {
    const rootPath = await copyFixtureWorkspace("mutation-target");
    const root = await resolveProjectRoot(rootPath);
    const before = await parseWorkspace(root);
    const beforeSummary = summarizeTarget(before, { target: "v1.0.0" });
    const server = createTestMcpServer({ root: rootPath });
    registerMutationTools(server, { root: rootPath });
    await server.callTool("set_target_goal", { target: "v1.0.0", goal: "Isolation check" });
    const after = await parseWorkspace(root);
    const afterSummary = summarizeTarget(after, { target: "v1.0.0" });
    expect(afterSummary.countsByStatus).toEqual(beforeSummary.countsByStatus);
    expect(afterSummary.countsByStability).toEqual(beforeSummary.countsByStability);
  });

  it("(4b) AC-7 isolation comprehensive: status/stability/AC/evidence/trace per record unchanged", async () => {
    const rootPath = await copyFixtureWorkspace("mutation-target");
    const root = await resolveProjectRoot(rootPath);
    const before = await parseWorkspace(root);
    const snapshot = (workspace: typeof before) =>
      workspace.records
        .filter((r) => r.target === "v1.0.0")
        .map((r) => ({
          id: r.id,
          status: r.status,
          stability: r.stability,
          acChecked: r.acceptanceCriteria.map((ac) => ({ id: ac.id, checked: ac.checked })),
          evidenceCount: r.verificationEvidence.length,
          traceCount: r.traceLinks.length
        }))
        .sort((a, b) => a.id.localeCompare(b.id));
    const beforeSnap = snapshot(before);
    const server = createTestMcpServer({ root: rootPath });
    registerMutationTools(server, { root: rootPath });
    await server.callTool("set_target_goal", { target: "v1.0.0", goal: "Comprehensive isolation check" });
    const after = await parseWorkspace(root);
    const afterSnap = snapshot(after);
    expect(afterSnap).toEqual(beforeSnap);
  });

  it("(6) AC-5: summarize_target envelope exposes value.goal at value level (via MCP)", async () => {
    const rootPath = await copyFixtureWorkspace("valid-basic");
    const server = createTestMcpServer({ root: rootPath });
    registerReadTools(server, { root: rootPath });
    registerMutationTools(server, { root: rootPath });
    await server.callTool("set_target_goal", { target: "v1.0.0", goal: "Envelope-level goal." });
    const envelope = (await server.callTool("summarize_target", { target: "v1.0.0" })) as {
      ok: true;
      value: { goal: string | null };
    };
    expect(envelope.ok).toBe(true);
    expect(envelope.value.goal).toBe("Envelope-level goal.");
  });

  it("(7) AC-5: absent goal returns value.goal === null (not empty string)", async () => {
    const rootPath = await copyFixtureWorkspace("mutation-target");
    const server = createTestMcpServer({ root: rootPath });
    registerReadTools(server, { root: rootPath });
    const envelope = (await server.callTool("summarize_target", { target: "v1.0.0" })) as {
      ok: true;
      value: { goal: string | null };
    };
    expect(envelope.value.goal).toBeNull();
  });

  it("(5) write-through safety: external edit between two mutations is preserved (fresh-read semantics)", async () => {
    // set_target_goal 은 매 호출마다 워크스페이스를 fresh read 후 patch 를 적용한다.
    // 따라서 두 mutation 사이의 외부 편집(아래 external marker)은 두 번째 mutation 의
    // snapshot 에 자연 포함되어 다음 write 에서도 보존된다. (SHA snapshot guard 가 발동하는
    // STALE_PATCH 케이스는 read 와 write 사이가 노출되는 다른 mutation 들의 단위 테스트에서 검증됨.)
    const rootPath = await copyFixtureWorkspace("mutation-target");
    void (await resolveProjectRoot(rootPath));
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const indexPath = path.join(rootPath, "docs/spec/00.index.md");
    const server = createTestMcpServer({ root: rootPath });
    registerMutationTools(server, { root: rootPath });
    const first = await server.callTool("set_target_goal", { target: "v1.0.0", goal: "First" });
    expect(first).toMatchObject({ ok: true });
    const original = await fs.readFile(indexPath, "utf8");
    await fs.writeFile(indexPath, original + "\n<!-- external marker -->\n", "utf8");
    const second = (await server.callTool("set_target_goal", { target: "v1.0.0", goal: "Second" })) as {
      ok: true;
      value: { written?: boolean };
    };
    expect(second.ok).toBe(true);
    expect(second.value.written).toBe(true);
    const after = await fs.readFile(indexPath, "utf8");
    expect(after).toContain("<!-- external marker -->");
    expect(after).toContain("Second");
  });
});
