import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { createTestMcpServer } from "../../src/mcp/adapter.js";
import { registerReadTools } from "../../src/mcp/tools/read-tools.js";
import { registerMutationTools } from "../../src/mcp/tools/mutation-tools.js";
import { toolSchemas } from "../../src/mcp/server.js";
import { workflowWorkspaceInfo } from "../../src/core/workflow/read.js";
import { cleanupFixtures, gitWorkspaceRepo, linkedWorktree } from "./support/workspace-root-fixture.js";

const PLAN_RELATIVE = path.posix.join("docs", "plan", "lane.plan.md");
const SIDECAR_RELATIVE = path.posix.join("docs", "plan", "lane.sidecar.json");

function serverFor(root: string) {
  const server = createTestMcpServer({ root });
  registerReadTools(server, { root });
  registerMutationTools(server, { root });
  return server;
}

/** A plan the workflow read tools can project, written only where it is asked for. */
async function writePlan(root: string, runId: string): Promise<void> {
  await mkdir(path.join(root, "docs", "plan"), { recursive: true });
  await writeFile(
    path.join(root, PLAN_RELATIVE),
    [
      "---",
      `run_id: ${runId}`,
      "target: v1.0.0",
      'plan_contract: "1.2.0"',
      "generated_at: 2026-06-29T08:05:04.654Z",
      "sidecar_path: ./lane.sidecar.json",
      "---",
      "# Lane plan",
      ""
    ].join("\n"),
    "utf8"
  );
  await writeFile(
    path.join(root, SIDECAR_RELATIVE),
    JSON.stringify(
      {
        schema_version: "1.1.0",
        plan_contract: "1.2.0",
        run_id: runId,
        target: "v1.0.0",
        generated_at: "2026-06-29T08:05:04.654Z",
        tasks: [
          { id: "T-001", title: "lane task one", status: "done", depends_on: [], req_ids: ["FR-ARCH-001"] },
          { id: "T-002", title: "lane task two", status: "pending", depends_on: [], req_ids: ["FR-ARCH-001"] }
        ]
      },
      null,
      2
    ),
    "utf8"
  );
}

async function tree(root: string): Promise<string[]> {
  const found: string[] = [];
  const walk = async (dir: string, prefix: string): Promise<void> => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (entry.name === ".git") continue;
      const relative = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
      if (entry.isDirectory()) await walk(path.join(dir, entry.name), relative);
      else found.push(relative);
    }
  };
  await walk(root, "");
  return found.sort();
}

async function settle(call: Promise<unknown>): Promise<{ ok: boolean; payload: unknown }> {
  try {
    const value = await call;
    return { ok: (value as { ok?: unknown }).ok === true, payload: value };
  } catch (error) {
    return { ok: false, payload: (error as Error).message };
  }
}

afterAll(async () => {
  await cleanupFixtures();
});

describe("FR-MCP-058 — workflow_* tools resolve their paths against a per-call workspace root", { timeout: 180_000 }, () => {
  it("AC-1: every workflow_* tool accepts workspaceRoot, and omitting it leaves the call unchanged", async () => {
    const host = await gitWorkspaceRepo("frmcp058-ac1");
    const lane = await linkedWorktree(host, "frmcp058-ac1-wt", "lane-058-ac1");
    const server = serverFor(host);

    // The family is derived from the registered surface, so a workflow tool added later cannot be
    // silently left out of the guarantee.
    const family = Object.keys(server.tools).filter((name) => name.startsWith("workflow_"));
    expect(family.length).toBe(26);
    for (const name of family) {
      expect(toolSchemas[name]?.workspaceRoot, `${name} must declare workspaceRoot in its schema`).toBeDefined();
      // Probed with a root that fails the first gate, so acceptance is read off the refusal reason
      // without any handler running: a tool that does not take the argument answers
      // `workspace-root-unsupported-for-tool` instead.
      const probed = (await server.callTool(name, { workspaceRoot: "relative/not/absolute" })) as { error?: { reason?: string } };
      expect(probed.error?.reason, `${name} must accept workspaceRoot`).toBe("workspace-root-not-absolute");
    }
    expect(await server.callTool("workflow_workspace_info", { workspaceRoot: lane })).toMatchObject({ ok: true });

    // Additive: with no workspaceRoot the payload is byte for byte what the core produces at the
    // startup root, and the envelope is the startup identity.
    const unchanged = (await server.callTool("workflow_workspace_info", {})) as Record<string, unknown>;
    const { mcpWorkspace, ...payload } = unchanged;
    const direct = await workflowWorkspaceInfo({ root: host });
    // `meta.generatedAt` is a clock reading and the only field two runs of the same call may differ
    // on; every other byte of the payload must be the core's own output.
    const withoutClock = (value: Record<string, unknown>): Record<string, unknown> => ({
      ...value,
      meta: { ...(value.meta as Record<string, unknown>), generatedAt: "<clock>" }
    });
    expect(withoutClock(payload)).toEqual(withoutClock(direct as unknown as Record<string, unknown>));
    expect((payload.meta as { generatedAt: string }).generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(mcpWorkspace).toMatchObject({ workspaceRoot: host, rootSource: "server-cwd-discovery" });
  });

  it("AC-2: a relative path resolves against the supplied root", async () => {
    const host = await gitWorkspaceRepo("frmcp058-ac2");
    const lane = await linkedWorktree(host, "frmcp058-ac2-wt", "lane-058-ac2");
    await writePlan(lane, "run-lane-only");
    const server = serverFor(host);

    const found = await server.callTool("workflow_plan_status", { path: PLAN_RELATIVE, workspaceRoot: lane });
    expect(found).toMatchObject({ ok: true, value: { taskCount: 2 } });

    const notFound = await settle(server.callTool("workflow_plan_status", { path: PLAN_RELATIVE }));
    expect(notFound.ok, "the same call without workspaceRoot must not find the worktree's plan").toBe(false);
  });

  it("AC-3: an absolute path inside the supplied root is accepted and one outside it is refused", async () => {
    const host = await gitWorkspaceRepo("frmcp058-ac3");
    const lane = await linkedWorktree(host, "frmcp058-ac3-wt", "lane-058-ac3");
    await writePlan(lane, "run-lane-abs");
    await writePlan(host, "run-host-abs");
    const server = serverFor(host);

    const inside = await server.callTool("workflow_plan_status", {
      path: path.join(lane, PLAN_RELATIVE),
      workspaceRoot: lane
    });
    expect(inside).toMatchObject({ ok: true, value: { taskCount: 2 } });

    // Refused by the reused containment check, which reports itself as SRS-E050 rather than by
    // failing the envelope — the plan outside the accepted root is never read.
    const outside = (await server.callTool("workflow_plan_status", {
      path: path.join(host, PLAN_RELATIVE),
      workspaceRoot: lane
    })) as { value: { plan: unknown; taskCount: number }; diagnostics: Array<{ code: string }> };
    expect(outside.diagnostics.map((item) => item.code)).toContain("SRS-E050");
    expect(outside.value).toMatchObject({ plan: null, taskCount: 0 });
    expect(JSON.stringify(outside)).not.toContain("run-host-abs");

    // Containment alone is not enough: docs/spec is an ordinary subdirectory of the accepted root.
    const spec = (await server.callTool("workflow_plan_status", {
      path: path.join(lane, "docs", "spec", "00.index.md"),
      workspaceRoot: lane
    })) as { ok: boolean; error?: { reason?: string } };
    expect(spec).toMatchObject({ ok: false, error: { reason: "workspace-root-forbidden-for-srs" } });
  });

  it("AC-4: a write-capable workflow_* tool writes inside the supplied root and leaves the startup root untouched", async () => {
    const host = await gitWorkspaceRepo("frmcp058-ac4");
    const lane = await linkedWorktree(host, "frmcp058-ac4-wt", "lane-058-ac4");
    const server = serverFor(host);
    // The jsonl append locks an existing artifact at any root, so the lane's file is seeded first.
    await mkdir(path.join(lane, "kiwi"), { recursive: true });
    await writeFile(path.join(lane, "kiwi", "pipeline.jsonl"), "", "utf8");
    const before = await tree(host);

    const written = await server.callTool("workflow_pipeline_emit", {
      workspaceRoot: lane,
      runId: "run-058-ac4",
      owner: "kiwi-pm",
      event: { schema_version: "1.0.0", skill: "kiwi-pm", run_id: "run-058-ac4", status: "TASK_DONE", summary: "lane" }
    });
    expect(written).toMatchObject({ ok: true });

    expect(await readFile(path.join(lane, "kiwi", "pipeline.jsonl"), "utf8")).toContain("run-058-ac4");
    expect(await tree(host), "the startup root's tree must be unchanged").toEqual(before);
  });

  it("AC-5: the envelope of an accepted call reports the per-call root and source", async () => {
    const host = await gitWorkspaceRepo("frmcp058-ac5");
    const lane = await linkedWorktree(host, "frmcp058-ac5-wt", "lane-058-ac5");
    const server = serverFor(host);

    const result = (await server.callTool("workflow_workspace_info", { workspaceRoot: lane })) as {
      mcpWorkspace: { workspaceRoot: string; rootSource: string };
    };
    expect(result.mcpWorkspace).toMatchObject({ workspaceRoot: lane, rootSource: "per-call-workspace-root" });
  });

  it("AC-6: the checkbox-mutation tools refuse an SRS document under the accepted root", async () => {
    const host = await gitWorkspaceRepo("frmcp058-ac6");
    const lane = await linkedWorktree(host, "frmcp058-ac6-wt", "lane-058-ac6");
    const server = serverFor(host);
    const specPath = path.join(lane, "docs", "spec", "10.product-architecture.srs.md");
    const before = await readFile(specPath, "utf8");
    expect(before, "the fixture must carry the plan-shaped checkbox this criterion is about").toContain("- [ ] ");

    for (const [tool, extra] of [
      ["workflow_task_check", {}],
      ["workflow_task_uncheck", {}],
      ["workflow_checklist_set", { checked: true }]
    ] as const) {
      const refused = (await server.callTool(tool, {
        workspaceRoot: lane,
        runId: "run-058-ac6",
        taskId: "AC-1",
        path: "docs/spec/10.product-architecture.srs.md",
        ...extra
      })) as { ok: boolean; error?: { code?: string; reason?: string } };
      expect(refused, `${tool} must refuse an SRS destination`).toMatchObject({
        ok: false,
        error: { code: "MCP_WORKSPACE_ROOT_REFUSED", reason: "workspace-root-forbidden-for-srs" }
      });
    }
    expect(await readFile(specPath, "utf8"), "no acceptance-criteria checkbox may be toggled").toBe(before);
  });
});
