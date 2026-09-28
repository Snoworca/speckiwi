import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { createTestMcpServer } from "../../src/mcp/adapter.js";
import { registerReadTools } from "../../src/mcp/tools/read-tools.js";
import { registerMutationTools } from "../../src/mcp/tools/mutation-tools.js";
import { toolSchemas } from "../../src/mcp/server.js";
import { workflowWorkspaceInfo } from "../../src/core/workflow/read.js";
import { cleanupFixtures, gitWorkspaceRepo, linkedWorktree } from "./support/workspace-root-fixture.js";

const SDS_RELATIVE = path.posix.join("docs", "sds", "lane.sds.md");

function serverFor(root: string) {
  const server = createTestMcpServer({ root });
  registerReadTools(server, { root });
  registerMutationTools(server, { root });
  return server;
}

/** An SDS the workflow read tools can resolve, written only where it is asked for; `marker` tells the roots apart. */
async function writeSds(root: string, marker: string): Promise<void> {
  await mkdir(path.join(root, "docs", "sds"), { recursive: true });
  await writeFile(
    path.join(root, SDS_RELATIVE),
    ["# SDS: lane", "", "| Field | Value |", "|---|---|", "| Document Type | sds |", "| Profile | lite |", "| Target | v1.0.0 |", "| Status | draft |", `| Date | ${marker} |`, ""].join("\n"),
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
    // Fifteen since the eleven plan-mode workflow_* tools left (FR-NODE-211 AC-1).
    const family = Object.keys(server.tools).filter((name) => name.startsWith("workflow_"));
    expect(family.length).toBe(15);
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
    await writeSds(lane, "lane-only-marker");
    const server = serverFor(host);

    const found = await server.callTool("workflow_resolve_artifact", { path: SDS_RELATIVE, includeBody: true, workspaceRoot: lane });
    expect(found).toMatchObject({ ok: true, value: { selected: { relativePath: SDS_RELATIVE, kind: "sds" } } });
    expect(JSON.stringify(found)).toContain("lane-only-marker");

    const notFound = await settle(server.callTool("workflow_resolve_artifact", { path: SDS_RELATIVE, includeBody: true }));
    expect(JSON.stringify(notFound.payload), "the same call without workspaceRoot must not find the worktree's SDS").not.toContain("lane-only-marker");
  });

  it("AC-3: an absolute path inside the supplied root is accepted and one outside it is refused", async () => {
    const host = await gitWorkspaceRepo("frmcp058-ac3");
    const lane = await linkedWorktree(host, "frmcp058-ac3-wt", "lane-058-ac3");
    await writeSds(lane, "lane-abs-marker");
    await writeSds(host, "host-abs-marker");
    const server = serverFor(host);

    const inside = await server.callTool("workflow_resolve_artifact", {
      path: path.join(lane, SDS_RELATIVE),
      includeBody: true,
      workspaceRoot: lane
    });
    expect(inside).toMatchObject({ ok: true, value: { selected: { relativePath: SDS_RELATIVE } } });
    expect(JSON.stringify(inside)).toContain("lane-abs-marker");

    // Refused by the reused containment check, which reports itself as SRS-E050 rather than by
    // failing the envelope — the SDS outside the accepted root is never read.
    const outside = (await server.callTool("workflow_resolve_artifact", {
      path: path.join(host, SDS_RELATIVE),
      includeBody: true,
      workspaceRoot: lane
    })) as { value: { selected: unknown }; diagnostics: Array<{ code: string }> };
    expect(outside.diagnostics.map((item) => item.code)).toContain("SRS-E050");
    expect(outside.value).toMatchObject({ selected: null });
    expect(JSON.stringify(outside)).not.toContain("host-abs-marker");

    // Containment alone is not enough: docs/spec is an ordinary subdirectory of the accepted root.
    const spec = (await server.callTool("workflow_resolve_artifact", {
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

  // The checkbox tools this case named before 4.0.0 left with the plan tools (FR-NODE-211 AC-1).
  it("FR-MCP-058 AC-6: a surviving write-capable workflow_* tool refuses an SRS document under the accepted root", async () => {
    const host = await gitWorkspaceRepo("frmcp058-ac6");
    const lane = await linkedWorktree(host, "frmcp058-ac6-wt", "lane-058-ac6");
    const server = serverFor(host);
    const specPath = path.join(lane, "docs", "spec", "10.product-architecture.srs.md");
    const before = await readFile(specPath, "utf8");
    const event = { schema_version: "1.0.0", skill: "kiwi-pm", run_id: "run-058-ac6", status: "TASK_DONE" };

    for (const tool of ["workflow_pipeline_emit", "workflow_worklog_emit", "workflow_repair_record"]) {
      const refused = (await server.callTool(tool, {
        workspaceRoot: lane,
        runId: "run-058-ac6",
        owner: "kiwi-pm",
        path: "docs/spec/10.product-architecture.srs.md",
        event
      })) as { ok: boolean; error?: { code?: string; reason?: string } };
      expect(refused, `${tool} must refuse an SRS destination`).toMatchObject({
        ok: false,
        error: { code: "MCP_WORKSPACE_ROOT_REFUSED", reason: "workspace-root-forbidden-for-srs" }
      });
    }
    expect(await readFile(specPath, "utf8"), "no SRS document may be written through a workflow tool").toBe(before);
  });
});
