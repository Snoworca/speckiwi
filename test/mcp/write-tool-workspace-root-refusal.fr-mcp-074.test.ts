import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createMcpServer, isReadOnlyTool, toolSchemas } from "../../src/mcp/server.js";
import { renderAgentInstructionSnippet } from "../../src/core/bootstrap/templates.js";
import { cleanupFixtures, gitWorkspaceRepo, linkedWorktree } from "./support/workspace-root-fixture.js";

// @req FR-MCP-074 — a tool that writes keeps refusing a per-call workspaceRoot, and the refusal now
// says why writes stay in one checkout and how to write in a worktree.

interface Refusal {
  ok: false;
  error: { code: string; reason: string; message: string };
  diagnostics: Array<{ code: string; message: string }>;
  recovery: { message: string };
  mcpWorkspace: { workspaceRoot: string; rootSource: string };
}

const REASON = /Requirement ID counter and the SRS mutation lock are kept per checkout/;

async function specDigest(root: string): Promise<string> {
  const hash = createHash("sha256");
  const dir = path.join(root, "docs", "spec");
  for (const name of (await readdir(dir)).sort()) hash.update(name).update(await readFile(path.join(dir, name)));
  return hash.digest("hex");
}

let host = "";
let worktree = "";
let server: ReturnType<typeof createMcpServer>;

beforeAll(async () => {
  // A real git repository first, so the server binds to the temporary checkout and never to an
  // ancestor such as the home directory.
  host = await gitWorkspaceRepo("fr-mcp-074-host-", "mutation-target");
  worktree = await linkedWorktree(host, "fr-mcp-074-wt-", "fr-mcp-074");
  server = createMcpServer({ root: host, rootSource: "server-cwd-discovery" });
});

afterAll(async () => {
  await cleanupFixtures();
});

describe("FR-MCP-074 — write tools refuse workspaceRoot with the reason and the worktree procedure", () => {
  it("binds to the temporary checkout, not an ancestor", async () => {
    const answer = (await server.callTool("get_active_target", {})) as { mcpWorkspace: { workspaceRoot: string } };
    expect(path.resolve(answer.mcpWorkspace.workspaceRoot)).toBe(path.resolve(host));
  });

  it.each([
    ["add_requirement", { scope: "ARCH", type: "functional", title: "t", statement: "s" }],
    ["append_section_note", { id: "FR-ARCH-001", section: "rationale", text: "note" }],
    ["update_status", { id: "FR-ARCH-001", status: "in_progress" }],
    ["supersede_requirement", { oldId: "FR-ARCH-001", scope: "ARCH", target: "v1.0.0", title: "t", statement: "s" }]
  ])("AC-1 AC-2: %s refuses, writes nothing, and says why and what to do", async (tool, input) => {
    const before = [await specDigest(host), await specDigest(worktree)];
    const answer = (await server.callTool(tool, { ...input, workspaceRoot: worktree })) as Refusal;
    expect(answer.ok).toBe(false);
    expect(answer.error.code).toBe("MCP_WORKSPACE_ROOT_UNSUPPORTED");
    expect(answer.error.reason).toBe("workspace-root-unsupported-for-tool");
    expect(answer.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(["SRS-E075"]);
    expect([await specDigest(host), await specDigest(worktree)]).toEqual(before);
    expect(answer.error.message).toMatch(REASON);
    expect(answer.error.message).toMatch(/writes only in the checkout this MCP server was started in/);
    // The reason is what a per-call root adds over a session started in the worktree, which keeps
    // its own counter too: one session drawing on two counters, and a forgotten argument.
    expect(answer.error.message).toMatch(/one session writing into two checkouts would allocate Requirement IDs from two counters that neither lock excludes/);
    expect(answer.error.message).toMatch(/a write that omitted the argument would land in this checkout unnoticed/);
    expect(answer.recovery.message).toMatch(/start a new agent session with that worktree as its working directory/);
    expect(answer.recovery.message).toMatch(/--defer-srs-mutation[^.]*orchestrate_replay_apply/);
    expect(answer.recovery.message).toMatch(/resolved only from the MCP server process working directory/);
    expect(answer.recovery.message).toMatch(/collide between branches[^.]*duplicate Requirement ID repair/);
  });

  it("AC-3: every tool outside the read-only set that declares no scope gets the write refusal, unlisted", async () => {
    const refusedWriters: string[] = [];
    // A tool whose schema takes workspaceRoot would run here, so only the ones that refuse it are called.
    const undeclared = (tool: string) => !Object.prototype.hasOwnProperty.call(toolSchemas[tool] ?? {}, "workspaceRoot");
    for (const name of Object.keys(server.tools).filter((tool) => !tool.startsWith("resource:") && !isReadOnlyTool(tool) && undeclared(tool))) {
      const answer = (await server.callTool(name, { workspaceRoot: worktree })) as Refusal;
      if (answer.ok !== false || answer.error?.reason !== "workspace-root-unsupported-for-tool") continue;
      refusedWriters.push(name);
      expect(answer.error.message, name).toMatch(REASON);
      expect(answer.recovery.message, name).toMatch(/start a new agent session with that worktree/);
    }
    // The writers that carry no `kind` metadata are among them: the default does not read `kind`.
    expect(refusedWriters).toEqual(expect.arrayContaining(["supersede_requirement", "claim_step", "set_work_mode", "add_requirement"]));
  });

  it("AC-4: a read-only tool without a scope says it does not take the argument, not that none does", async () => {
    for (const name of ["mcp_workspace_info", "get_next_work_order"]) {
      const answer = (await server.callTool(name, { workspaceRoot: worktree })) as Refusal;
      expect(answer.error.code, name).toBe("MCP_WORKSPACE_ROOT_UNSUPPORTED");
      expect(answer.error.message, name).toMatch(/^This tool does not take a per-call workspace root/);
      expect(answer.error.message, name).not.toMatch(/override is not supported/);
      expect(answer.error.message, name).not.toMatch(REASON);
    }
  });

  it("AC-5: the instruction block's refusal item gives the reason and the session procedure", () => {
    const item = renderAgentInstructionSnippet().split("\n").find((line) => line.startsWith("4. Every other tool refuses `workspaceRoot`")) ?? "";
    expect(item).toMatch(/Requirement ID counter and the SRS mutation lock are kept per checkout/);
    expect(item).toMatch(/to write in a worktree, start an agent session in that worktree/);
    expect(item).toMatch(/one session writing into two checkouts would allocate IDs from two counters that neither lock excludes/);
    expect(item).toMatch(/repair IDs that collide between branches at merge/);
  });
});
