import path from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";
import { createTestMcpServer } from "../../src/mcp/adapter.js";
import { cleanupFixtures, gitWorkspaceRepo, linkedWorktree } from "./support/workspace-root-fixture.js";

// REL-MCP-005 AC-6 — which arguments are paths is declared, never inferred. A tool that declares
// nothing has EVERY argument treated as a path (so a newly added tool is guarded without being listed,
// whatever its arguments are called); a tool that declares its path arguments is scanned on those only.

interface Refusal {
  ok: false;
  error: { code: string; reason: string };
  diagnostics: Array<{ details?: Record<string, unknown> }>;
}

afterAll(async () => {
  await cleanupFixtures();
});

describe("REL-MCP-005 AC-6 — undeclared tools have every argument scanned", { timeout: 120_000 }, () => {
  it("REL-MCP-005 AC-6: a newly added tool that declares nothing is refused for a docs/spec value in an argument not named as a path", async () => {
    const host = await gitWorkspaceRepo("relmcp005-ac6-undeclared");
    const lane = await linkedWorktree(host, "relmcp005-ac6-undeclared-wt", "lane-ac6-undeclared");
    const server = createTestMcpServer({ root: host });
    const handler = vi.fn(async () => ({ ok: true }));
    // Registered with a workspace scope and no path declaration, as a newly added tool would be.
    server.registerTool("newly_added_reader", handler, { workspaceScope: "worktree-local" });

    const values: Array<[string, unknown]> = [
      ["note", "docs/spec/00.index.md"],
      ["label", path.join(lane, "docs", "spec", "10.product-architecture.srs.md")],
      ["filters", ["harmless", "docs/spec/steps/alpha/design.md"]],
      ["query", path.join(host, "docs", "spec")]
    ];
    for (const [key, value] of values) {
      const refused = (await server.callTool("newly_added_reader", { workspaceRoot: lane, [key]: value })) as Refusal;
      expect(refused, key).toMatchObject({ ok: false, error: { code: "MCP_WORKSPACE_ROOT_REFUSED", reason: "workspace-root-forbidden-for-srs" } });
    }
    expect(handler, "no refused call reaches the handler").not.toHaveBeenCalled();

    // The same arguments outside docs/spec are admitted, so the refusal is the destination's.
    await server.callTool("newly_added_reader", { workspaceRoot: lane, note: "docs/other/readme.md", label: "kiwi/pipeline.jsonl" });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("REL-MCP-005 AC-6: a tool that declares its path arguments is scanned on those alone, and the empty declaration scans none", async () => {
    const host = await gitWorkspaceRepo("relmcp005-ac6-declared");
    const lane = await linkedWorktree(host, "relmcp005-ac6-declared-wt", "lane-ac6-declared");
    const server = createTestMcpServer({ root: host });
    const declared = vi.fn(async () => ({ ok: true }));
    const none = vi.fn(async () => ({ ok: true }));
    server.registerTool("declares_path", declared, { workspaceScope: "worktree-local", callerPathKeys: ["path"] });
    server.registerTool("declares_none", none, { workspaceScope: "worktree-local", callerPathKeys: [] });

    const onPath = (await server.callTool("declares_path", { workspaceRoot: lane, path: "docs/spec/00.index.md" })) as Refusal;
    expect(onPath).toMatchObject({ ok: false, error: { reason: "workspace-root-forbidden-for-srs" } });
    expect(onPath.diagnostics[0]?.details?.destination).toBe("docs/spec/00.index.md");

    await server.callTool("declares_path", { workspaceRoot: lane, path: "kiwi/x.jsonl", note: "docs/spec/00.index.md" });
    expect(declared, "an argument outside the declaration is not scanned").toHaveBeenCalledTimes(1);

    await server.callTool("declares_none", { workspaceRoot: lane, path: "docs/spec/00.index.md", relatedDoc: "docs/spec/00.index.md" });
    expect(none, "the empty declaration scans no argument").toHaveBeenCalledTimes(1);
  });
});
