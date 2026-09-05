import { access, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";
import { createTestMcpServer } from "../../src/mcp/adapter.js";
import { registerReadTools } from "../../src/mcp/tools/read-tools.js";
import { registerMutationTools } from "../../src/mcp/tools/mutation-tools.js";
import { resolveMcpStartupRoot, type McpServerOptions } from "../../src/mcp/server.js";
import { cleanupFixtures, gitWorkspaceRepo, linkedWorktree, tempDir } from "./support/workspace-root-fixture.js";

interface Refusal {
  ok: false;
  error: { code: string; reason: string; message: string };
  diagnostics: Array<{ code: string; severity: string; message: string; details?: Record<string, unknown> }>;
  diagnosticsSummary: { errors: number; warnings: number; byCode: Record<string, number> };
  mcpWorkspace: { workspaceRoot: string; rootSource: string; indexPath: string; packageVersion: string };
}

interface Envelope {
  mcpWorkspace: { workspaceRoot: string; rootSource: string; indexPath: string; packageVersion: string };
}

async function exists(target: string): Promise<boolean> {
  return access(target).then(() => true).catch(() => false);
}

const SIBLING_BODY_MARKER = "SIBLING-SECRET-PLAN-BODY";
const SIBLING_RUN_MARKER = "SIBLING-ONLY-RUN";
const SIBLING_EVENT_MARKER = "SIBLING-ONLY-JOURNAL-LINE";

/** Content that exists ONLY in the sibling repository, so any leak of it is unambiguous. */
async function seedSiblingContent(root: string): Promise<void> {
  await mkdir(path.join(root, "docs", "plan"), { recursive: true });
  await writeFile(
    path.join(root, "docs", "plan", "sibling.plan.md"),
    [
      "---",
      `run_id: ${SIBLING_RUN_MARKER}`,
      "target: v1.0.0",
      'plan_contract: "1.2.0"',
      "generated_at: 2026-06-29T08:05:04.654Z",
      "sidecar_path: ./sibling.sidecar.json",
      "---",
      `# ${SIBLING_BODY_MARKER}`,
      ""
    ].join("\n"),
    "utf8"
  );
  await writeFile(
    path.join(root, "docs", "plan", "sibling.sidecar.json"),
    JSON.stringify({
      schema_version: "1.1.0",
      plan_contract: "1.2.0",
      run_id: SIBLING_RUN_MARKER,
      target: "v1.0.0",
      generated_at: "2026-06-29T08:05:04.654Z",
      tasks: [{ id: "T-001", title: SIBLING_BODY_MARKER, status: "pending", depends_on: [], req_ids: ["FR-ARCH-001"] }]
    }, null, 2),
    "utf8"
  );
  await mkdir(path.join(root, "kiwi"), { recursive: true });
  await writeFile(
    path.join(root, "kiwi", "pipeline.jsonl"),
    `${JSON.stringify({ schema_version: "1.0.0", skill: "kiwi-pm", run_id: SIBLING_RUN_MARKER, status: "TASK_DONE", summary: SIBLING_EVENT_MARKER })}\n`,
    "utf8"
  );
}

/** Every file under `root` (excluding `.git`) as relativePath → sha256, so "unchanged" is exact. */
async function treeDigest(root: string): Promise<Record<string, string>> {
  const digest: Record<string, string> = {};
  const walk = async (dir: string, prefix: string): Promise<void> => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (entry.name === ".git") continue;
      const relative = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
      if (entry.isDirectory()) await walk(path.join(dir, entry.name), relative);
      else digest[relative] = createHash("sha256").update(await readFile(path.join(dir, entry.name))).digest("hex");
    }
  };
  await walk(root, "");
  return digest;
}

async function settle(call: Promise<unknown>): Promise<{ ok: boolean; payload: unknown }> {
  try {
    const value = await call;
    return { ok: (value as { ok?: unknown }).ok === true, payload: value };
  } catch (error) {
    return { ok: false, payload: (error as Error).message };
  }
}

function serverFor(root: string) {
  const server = createTestMcpServer({ root });
  registerReadTools(server, { root });
  registerMutationTools(server, { root });
  return server;
}

afterAll(async () => {
  await cleanupFixtures();
});

describe("REL-MCP-005 — MCP workspace root identity and safety", { timeout: 180_000 }, () => {
  it("AC-1: every result envelope carries the workspace identity fields", async () => {
    const host = await gitWorkspaceRepo("relmcp005-ac1");
    const server = serverFor(host);

    const read = (await server.callTool("list_requirements", {})) as Envelope;
    expect(read.mcpWorkspace).toMatchObject({
      workspaceRoot: host,
      rootSource: "server-cwd-discovery",
      indexPath: "docs/spec/00.index.md",
      packageVersion: expect.any(String)
    });
    expect(await server.callTool("mcp_workspace_info", {})).toMatchObject({
      ok: true,
      value: { workspaceRoot: host, rootSource: "server-cwd-discovery", indexPath: "docs/spec/00.index.md", activeTarget: expect.any(String), diagnosticsSummary: expect.any(Object) }
    });
  });

  it("AC-2: rootSource reports per-call-workspace-root exactly when a supplied workspaceRoot passed every gate", async () => {
    const host = await gitWorkspaceRepo("relmcp005-ac2");
    const lane = await linkedWorktree(host, "relmcp005-ac2-wt", "lane-ac2");
    const server = serverFor(host);

    const startup = (await server.callTool("workflow_workspace_info", {})) as Envelope;
    expect(startup.mcpWorkspace).toMatchObject({ workspaceRoot: host, rootSource: "server-cwd-discovery" });

    const perCall = (await server.callTool("workflow_workspace_info", { workspaceRoot: lane })) as Envelope;
    expect(perCall.mcpWorkspace).toMatchObject({ workspaceRoot: lane, rootSource: "per-call-workspace-root" });

    // A refused call never claims the per-call source.
    const refused = (await server.callTool("workflow_workspace_info", { workspaceRoot: path.join(host, "docs") })) as Refusal;
    expect(refused.mcpWorkspace).toMatchObject({ workspaceRoot: host, rootSource: "server-cwd-discovery" });
  });

  it("AC-3: an SRS tool refuses a per-call workspaceRoot fail-closed", async () => {
    const host = await gitWorkspaceRepo("relmcp005-ac3");
    const lane = await linkedWorktree(host, "relmcp005-ac3-wt", "lane-ac3");
    const server = serverFor(host);
    const laneIndexBefore = await readFile(path.join(lane, "docs", "spec", "00.index.md"), "utf8");

    const refused = (await server.callTool("update_status", { workspaceRoot: lane, id: "FR-ARCH-001", status: "verified" })) as Refusal;
    expect(refused).toMatchObject({
      ok: false,
      error: { code: "MCP_WORKSPACE_ROOT_UNSUPPORTED", reason: "workspace-root-unsupported-for-tool" },
      diagnosticsSummary: { errors: 1, warnings: 0, byCode: { "SRS-E075": 1 } },
      mcpWorkspace: { workspaceRoot: host, rootSource: "server-cwd-discovery" }
    });
    expect(refused.diagnostics[0]).toMatchObject({ code: "SRS-E075", severity: "error", details: { reason: "workspace-root-unsupported-for-tool" } });
    expect(await readFile(path.join(lane, "docs", "spec", "00.index.md"), "utf8")).toBe(laneIndexBefore);
  });

  it("AC-3: refusal is the registration default — an undeclared tool inherits it without being listed", async () => {
    const host = await gitWorkspaceRepo("relmcp005-ac3-default");
    const lane = await linkedWorktree(host, "relmcp005-ac3-default-wt", "lane-ac3-default");
    const server = createTestMcpServer({ root: host });
    const handler = vi.fn(async () => ({ ok: true }));
    // Registered with no workspace declaration at all, exactly as a newly added SRS tool would be.
    server.registerTool("newly_added_srs_tool", handler);

    const refused = (await server.callTool("newly_added_srs_tool", { workspaceRoot: lane })) as Refusal;
    expect(refused).toMatchObject({ ok: false, error: { code: "MCP_WORKSPACE_ROOT_UNSUPPORTED", reason: "workspace-root-unsupported-for-tool" } });
    expect(handler).not.toHaveBeenCalled();
  });

  // @req REL-MCP-005 AC-3 — the declaration is read as membership of a closed set, so a scope that
  // is not one of the two lands where an absent one lands. A presence test would admit this tool:
  // the compiler catches a misspelt scope in this repository's own registrations, and catches
  // nothing in a test that registers a synthetic tool or in a consumer on plain JavaScript.
  it("AC-3: a tool whose declared workspace scope is misspelt inherits the refusal", async () => {
    const host = await gitWorkspaceRepo("relmcp005-ac3-typo");
    const lane = await linkedWorktree(host, "relmcp005-ac3-typo-wt", "lane-ac3-typo");
    const server = createTestMcpServer({ root: host });
    const handler = vi.fn(async () => ({ ok: true }));
    server.registerTool("misspelt_scope_tool", handler, {
      // @ts-expect-error the scope union rejects this spelling; the gate must refuse it at runtime too.
      workspaceScope: "worktree_local"
    });

    const refused = (await server.callTool("misspelt_scope_tool", { workspaceRoot: lane })) as Refusal;
    expect(refused).toMatchObject({ ok: false, error: { code: "MCP_WORKSPACE_ROOT_UNSUPPORTED", reason: "workspace-root-unsupported-for-tool" } });
    expect(handler).not.toHaveBeenCalled();
  });

  it("AC-4: startMcpServer and McpServerOptions expose no root parameter", () => {
    expect(resolveMcpStartupRoot.length).toBe(0);
    // @ts-expect-error McpServerOptions must not declare a root; `npm run typecheck:test` fails here if it does.
    const rejected: McpServerOptions = { transport: "stdio", root: "/tmp/anywhere" };
    expect(rejected).toBeDefined();
  });

  it("AC-5: a relative workspaceRoot is refused", async () => {
    const host = await gitWorkspaceRepo("relmcp005-ac5-rel");
    const server = serverFor(host);
    const refused = (await server.callTool("workflow_workspace_info", { workspaceRoot: "../elsewhere" })) as Refusal;
    expect(refused).toMatchObject({
      ok: false,
      error: { code: "MCP_WORKSPACE_ROOT_REFUSED", reason: "workspace-root-not-absolute" },
      diagnosticsSummary: { byCode: { "SRS-E075": 1 } }
    });
  });

  it("AC-5: a workspaceRoot naming a path that does not exist is refused rather than created", async () => {
    const host = await gitWorkspaceRepo("relmcp005-ac5-missing");
    const server = serverFor(host);
    const typo = path.join(host, "wrktree-typo");
    expect(await exists(typo)).toBe(false);

    const refused = (await server.callTool("workflow_pipeline_emit", {
      workspaceRoot: typo,
      runId: "run-1",
      event: { kind: "note" }
    })) as Refusal;

    expect(refused).toMatchObject({
      ok: false,
      error: { code: "MCP_WORKSPACE_ROOT_REFUSED", reason: "workspace-root-not-a-directory" }
    });
    expect(await exists(typo), "a refused workspaceRoot must never be created").toBe(false);
  });

  it("AC-5: a subdirectory of a git top level is refused", async () => {
    const host = await gitWorkspaceRepo("relmcp005-ac5-subdir");
    const server = serverFor(host);
    const refused = (await server.callTool("workflow_workspace_info", { workspaceRoot: path.join(host, "docs") })) as Refusal;
    expect(refused).toMatchObject({
      ok: false,
      error: { code: "MCP_WORKSPACE_ROOT_REFUSED", reason: "workspace-root-not-a-git-toplevel" }
    });
  });

  it("AC-5: a directory outside any git repository is refused", async () => {
    const host = await gitWorkspaceRepo("relmcp005-ac5-nogit");
    const loose = await tempDir("relmcp005-ac5-loose");
    await mkdir(path.join(loose, "docs", "spec"), { recursive: true });
    const server = serverFor(host);
    const refused = (await server.callTool("workflow_workspace_info", { workspaceRoot: loose })) as Refusal;
    expect(refused).toMatchObject({
      ok: false,
      error: { code: "MCP_WORKSPACE_ROOT_REFUSED", reason: "workspace-root-not-a-git-toplevel" }
    });
  });

  it("AC-5: a linked worktree of the startup root is accepted", async () => {
    const host = await gitWorkspaceRepo("relmcp005-ac5-ok");
    const lane = await linkedWorktree(host, "relmcp005-ac5-ok-wt", "lane-ac5");
    const server = serverFor(host);
    const accepted = (await server.callTool("workflow_workspace_info", { workspaceRoot: lane })) as Envelope;
    expect(accepted.mcpWorkspace).toMatchObject({ workspaceRoot: lane, rootSource: "per-call-workspace-root" });
  });

  it("AC-5: every gate completes before the tool handler runs, and an accepted root reaches it", async () => {
    const host = await gitWorkspaceRepo("relmcp005-ac5-order");
    const lane = await linkedWorktree(host, "relmcp005-ac5-order-wt", "lane-ac5-order");
    const server = createTestMcpServer({ root: host });
    const handler = vi.fn(async () => ({ ok: true }));
    server.registerTool("worktree_local_probe", handler, { workspaceScope: "worktree-local" });

    expect(await server.callTool("worktree_local_probe", { workspaceRoot: path.join(host, "absent") })).toMatchObject({ ok: false });
    expect(handler, "a refused root must not reach the handler").not.toHaveBeenCalled();

    await server.callTool("worktree_local_probe", { workspaceRoot: lane });
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0]?.[1], "an accepted root must be handed to the handler, not read from its input").toMatchObject({
      root: lane,
      rootSource: "per-call-workspace-root"
    });

    await server.callTool("worktree_local_probe", {});
    expect(handler.mock.calls[1]?.[1]).toMatchObject({ root: host, rootSource: "server-cwd-discovery" });
  });

  it("AC-6: refusal is by destination — an accepting tool refuses a path landing under docs/spec", async () => {
    const host = await gitWorkspaceRepo("relmcp005-ac6");
    const lane = await linkedWorktree(host, "relmcp005-ac6-wt", "lane-ac6");
    const server = serverFor(host);
    const specPath = path.join(lane, "docs", "spec", "10.product-architecture.srs.md");
    const before = await readFile(specPath, "utf8");

    for (const tool of ["workflow_task_check", "workflow_task_uncheck"]) {
      const refused = (await server.callTool(tool, {
        workspaceRoot: lane,
        runId: "run-ac6",
        taskId: "AC-1",
        path: "docs/spec/10.product-architecture.srs.md"
      })) as Refusal;
      expect(refused, `${tool} must refuse an SRS destination`).toMatchObject({
        ok: false,
        error: { code: "MCP_WORKSPACE_ROOT_REFUSED", reason: "workspace-root-forbidden-for-srs" }
      });
    }
    const refusedSet = (await server.callTool("workflow_checklist_set", {
      workspaceRoot: lane,
      runId: "run-ac6",
      taskId: "AC-1",
      path: specPath,
      checked: true
    })) as Refusal;
    expect(refusedSet).toMatchObject({ ok: false, error: { reason: "workspace-root-forbidden-for-srs" } });

    expect(await readFile(specPath, "utf8"), "no acceptance-criteria checkbox may be toggled").toBe(before);
  });

  it("AC-7: a separate repository is neither read nor mutated", async () => {
    const host = await gitWorkspaceRepo("relmcp005-ac7-host");
    const foreign = await gitWorkspaceRepo("relmcp005-ac7-foreign");
    const server = serverFor(host);
    const foreignMarker = path.join(foreign, "docs", "spec", "00.index.md");
    const before = await readFile(foreignMarker, "utf8");

    const refusedRead = (await server.callTool("workflow_workspace_info", { workspaceRoot: foreign })) as Refusal;
    expect(refusedRead).toMatchObject({
      ok: false,
      error: { code: "MCP_WORKSPACE_ROOT_REFUSED", reason: "workspace-root-foreign-repository" }
    });
    expect(JSON.stringify(refusedRead), "a refused read must not leak the foreign workspace").not.toContain("Fixture requirement");

    const refusedWrite = (await server.callTool("workflow_pipeline_emit", {
      workspaceRoot: foreign,
      runId: "run-ac7",
      event: { kind: "note" }
    })) as Refusal;
    expect(refusedWrite).toMatchObject({ ok: false, error: { reason: "workspace-root-foreign-repository" } });
    expect(await exists(path.join(foreign, "kiwi", "pipeline.jsonl"))).toBe(false);
    expect(await readFile(foreignMarker, "utf8")).toBe(before);
  });

  // The inherited case: no per-call argument at all, and the caller's intended workspace differs
  // from the resolved root identity. Dropping `workspaceRoot` does not remove the channel — every
  // path argument is still caller-supplied, and an absolute one names any repository on the disk.
  // So the sibling is attacked through that channel, with both verbs, rather than merely observed.
  it("AC-7: with no per-call argument a sibling repository is neither read nor mutated", async () => {
    const host = await gitWorkspaceRepo("relmcp005-ac7-inherited");
    const sibling = await gitWorkspaceRepo("relmcp005-ac7-other");
    await seedSiblingContent(sibling);
    const server = serverFor(host);
    const before = await treeDigest(sibling);
    const siblingPlan = path.join(sibling, "docs", "plan", "sibling.plan.md");
    const siblingJsonl = path.join(sibling, "kiwi", "pipeline.jsonl");
    const siblingSpec = path.join(sibling, "docs", "spec", "10.product-architecture.srs.md");

    // Identity: the answer names the root that produced it, so the mismatch is detectable.
    const info = (await server.callTool("workflow_workspace_info", {})) as Envelope;
    expect(info.mcpWorkspace).toMatchObject({ workspaceRoot: host, rootSource: "server-cwd-discovery" });
    expect(JSON.stringify(info)).not.toContain(sibling);

    // Reads: each one would return the sibling's bytes if containment were absent.
    const reads = [
      ["workflow_resolve_artifact", { path: siblingPlan, includeBody: true }],
      ["workflow_plan_status", { path: siblingPlan, includeBody: true }],
      ["workflow_pipeline_tail", { path: siblingJsonl }],
      ["workflow_worklog_tail", { path: siblingJsonl }]
    ] as const;
    for (const [tool, input] of reads) {
      const outcome = await settle(server.callTool(tool, input));
      const rendered = JSON.stringify(outcome.payload);
      expect(rendered, `${tool} must not return the sibling's plan body`).not.toContain(SIBLING_BODY_MARKER);
      expect(rendered, `${tool} must not return the sibling's run id`).not.toContain(SIBLING_RUN_MARKER);
      expect(rendered, `${tool} must not return the sibling's journal line`).not.toContain(SIBLING_EVENT_MARKER);
    }

    // Writes: each one would land in the sibling if containment were absent.
    const writes = [
      ["workflow_pipeline_emit", {
        runId: "run-ac7-inherited",
        owner: "kiwi-pm",
        path: siblingJsonl,
        event: { schema_version: "1.0.0", skill: "kiwi-pm", run_id: "run-ac7-inherited", status: "TASK_DONE", summary: "intrusion" }
      }],
      ["workflow_worklog_emit", {
        runId: "run-ac7-inherited",
        owner: "kiwi-pm",
        path: siblingJsonl,
        event: { schema_version: "1.0.0", skill: "kiwi-pm", run_id: "run-ac7-inherited", status: "TASK_DONE", summary: "intrusion" }
      }],
      ["workflow_task_check", { runId: "run-ac7-inherited", taskId: "T-001", path: siblingPlan }],
      ["workflow_checklist_set", { runId: "run-ac7-inherited", taskId: "AC-1", path: siblingSpec, checked: true }]
    ] as const;
    for (const [tool, input] of writes) {
      const outcome = await settle(server.callTool(tool, input));
      expect(outcome.ok, `${tool} must not report success against the sibling`).toBe(false);
    }

    expect(await treeDigest(sibling), "the sibling repository must be byte-for-byte unchanged").toEqual(before);
  });
});
