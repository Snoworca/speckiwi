import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { isReadOnlyTool } from "../../src/mcp/server.js";
import { copyFixtureWorkspace } from "../fixtures/fixture-utils.js";
import { cleanupFixtures, gitWorkspaceRepo } from "./support/workspace-root-fixture.js";
import { createWorkflowFixture } from "../fixtures/workflow-artifacts.js";
import { editIndex, eventLine, jsonl, treeDigest, workflowMcp, writeText, type Json } from "../support/workflow-harness.js";

// @req FR-MCP-035 — the pipeline projections and the work-order profiles over MCP.

const PROJECTIONS = ["workflow_pipeline_status", "workflow_pipeline_tail", "workflow_pipeline_compact"] as const;
const SDS_BODY_MARKER = "SDS-AC-1";

afterAll(async () => {
  await cleanupFixtures();
});

function value(result: Json): Json {
  return result.value as Json;
}

/** Every `body` key anywhere in a payload — the raw artifact text a projection must not carry. */
function bodyKeys(payload: unknown, at = "$"): string[] {
  if (Array.isArray(payload)) return payload.flatMap((item, index) => bodyKeys(item, `${at}[${index}]`));
  if (typeof payload !== "object" || payload === null) return [];
  return Object.entries(payload).flatMap(([key, item]) => [...(key === "body" ? [`${at}.body`] : []), ...bodyKeys(item, `${at}.${key}`)]);
}

describe("FR-MCP-035 AC-1 — the pipeline projections return compact envelopes without raw bodies", () => {
  it("FR-MCP-035 AC-1: pipeline status, tail and compact are read-only and carry no body by default", async () => {
    const fixture = await createWorkflowFixture();
    const { call } = workflowMcp(fixture.root);
    const before = await treeDigest(fixture.root);

    for (const name of PROJECTIONS) {
      expect(isReadOnlyTool(name), `${name} must be registered read-only`).toBe(true);
      const result = await call(name, {});
      expect(result, name).toMatchObject({ ok: true, value: expect.any(Object), meta: expect.any(Object), artifacts: expect.any(Array), diagnosticsSummary: expect.any(Object) });
      expect(bodyKeys(result), `${name} carried a raw body`).toEqual([]);
      expect(JSON.stringify(result), `${name} carried SDS text`).not.toContain(SDS_BODY_MARKER);
      expect((result.artifacts as Json[]).map((artifact) => artifact.relativePath), name).toEqual(["kiwi/pipeline.jsonl"]);
    }
    expect(await treeDigest(fixture.root)).toEqual(before);
  });

  it("FR-MCP-035 AC-1: status and compact answer with the latest event, not the journal's text", async () => {
    const fixture = await createWorkflowFixture();
    const early = "EARLY-LINE-THAT-ONLY-A-BODY-WOULD-CARRY";
    await writeText(fixture.root, "kiwi/pipeline.jsonl", jsonl(eventLine("run-early", "TASK_DONE", { summary: early }), eventLine("run-late")));
    const { call } = workflowMcp(fixture.root);

    for (const name of ["workflow_pipeline_status", "workflow_pipeline_compact"]) {
      const result = await call(name, {});
      expect((value(result).latestEvent as { event: Json }).event.run_id, name).toBe("run-late");
      expect(JSON.stringify(result), `${name} carried the journal's earlier text`).not.toContain(early);
    }
    // The control: the same line is reachable, through the tail, when it is asked for.
    expect(JSON.stringify(await call("workflow_pipeline_tail", {}))).toContain(early);
  });

  it("FR-MCP-035 AC-1: the tail projection is compact — bounded by a cursor, not the whole journal", async () => {
    const fixture = await createWorkflowFixture();
    await writeText(fixture.root, "kiwi/pipeline.jsonl", jsonl(...Array.from({ length: 30 }, (_, index) => eventLine(`run-${index}`))));
    const { call } = workflowMcp(fixture.root);

    const tail = await call("workflow_pipeline_tail", {});
    expect((value(tail).events as unknown[]).length).toBe(20);
    expect(tail.cursor).toMatchObject({ limit: 20, returned: 20, total: 30, nextOffset: 20 });
  });
});

describe("FR-MCP-035 AC-3 — projections and profiles fail closed", () => {
  it("FR-MCP-035 AC-3: an invalid artifact makes the compact projection block with invalid_artifact", async () => {
    const fixture = await createWorkflowFixture();
    const compact = value(await workflowMcp(fixture.root).call("workflow_pipeline_compact", {}));
    expect(compact).toMatchObject({ blocking: true, outcomeCodes: expect.arrayContaining(["invalid_artifact"]) });
  });

  it("FR-MCP-035 AC-3: an unsupported schema version makes the compact projection block with unsupported_schema_version", async () => {
    const fixture = await createWorkflowFixture();
    await writeText(fixture.root, "kiwi/pipeline.jsonl", jsonl(eventLine("run-a", "TASK_DONE", { schema_version: "9.0.0" })));
    const compact = value(await workflowMcp(fixture.root).call("workflow_pipeline_compact", {}));
    expect(compact).toMatchObject({ blocking: true, outcomeCodes: ["unsupported_schema_version"] });
  });

  for (const status of ["FAILED", "NEEDS_USER"] as const) {
    it(`FR-MCP-035 AC-3: an active ${status} pipeline state makes the compact projection and both work-order profiles block`, async () => {
      const fixture = await createWorkflowFixture();
      await writeText(fixture.root, "kiwi/pipeline.jsonl", jsonl(eventLine("run-a"), eventLine("run-b", status)));
      const { call } = workflowMcp(fixture.root);

      const compact = value(await call("workflow_pipeline_compact", {}));
      expect(compact).toMatchObject({ latestStatus: status, blocking: true });
      expect(compact.outcomeCodes, "a stop is something to act on").not.toContain("no_actionable_drift");

      for (const profile of ["compact", "explain"] as const) {
        const order = await call("get_next_work_order", { path: fixture.freshSdsPath, profile });
        expect(order, profile).toMatchObject({ action: status === "FAILED" ? "blocked" : "ask-user", blocking: true, profile, pipeline: { latestStatus: status } });
      }
    });
  }

  it("FR-MCP-035 AC-3: showing deleted and corrected lines does not hide a live FAILED stop", async () => {
    const fixture = await createWorkflowFixture();
    await writeText(fixture.root, "kiwi/pipeline.jsonl", jsonl(eventLine("run-x"), eventLine("run-a", "FAILED"), eventLine("fix-x", "CORRECTION", { corrects_run_id: "run-x" })));
    const { call } = workflowMcp(fixture.root);

    const shown = value(await call("workflow_pipeline_compact", { includeDeleted: true }));
    expect((shown.latestEvent as { event: Json }).event.status, "the display view ends on the correction").toBe("CORRECTION");
    expect(shown.blocking).toBe(true);
    expect(value(await call("workflow_pipeline_compact", {}))).toMatchObject({ latestStatus: "FAILED", blocking: true });
  });

  it("FR-MCP-035 AC-3: a clean journal whose latest state is not a stop leaves the compact projection unblocked", async () => {
    const fixture = await createWorkflowFixture();
    await writeText(fixture.root, "kiwi/pipeline.jsonl", jsonl(eventLine("run-a", "FAILED"), eventLine("run-b", "TASK_DONE")));
    const compact = value(await workflowMcp(fixture.root).call("workflow_pipeline_compact", {}));
    expect(compact).toMatchObject({ latestStatus: "TASK_DONE", blocking: false, outcomeCodes: ["no_actionable_drift"] });
  });

  it("FR-MCP-035 AC-3: an ambiguous workspace identity is refused before any projection answers", async () => {
    const host = await gitWorkspaceRepo("fr-mcp-035-ac3");
    await writeText(host, "kiwi/pipeline.jsonl", jsonl(eventLine("run-a")));
    const { call } = workflowMcp(host);
    for (const name of PROJECTIONS) {
      // The control: the checkout's own top level is an identity the projection answers for.
      expect(await call(name, { workspaceRoot: host }), name).toMatchObject({ ok: true, mcpWorkspace: { workspaceRoot: host, rootSource: "per-call-workspace-root" } });
      // A directory inside it could belong to that checkout or to one nested there: refused, not guessed.
      const refused = await call(name, { workspaceRoot: path.join(host, "docs") });
      expect(refused, name).toMatchObject({ ok: false, error: { code: "MCP_WORKSPACE_ROOT_REFUSED", reason: "workspace-root-not-a-git-toplevel" } });
      expect(refused, name).not.toHaveProperty("value");
    }
    const order = await call("get_next_work_order", { workspaceRoot: host, profile: "explain" });
    expect(order).toMatchObject({ ok: false, error: { code: "MCP_WORKSPACE_ROOT_UNSUPPORTED" } });
    expect(order).not.toHaveProperty("action");
  }, 120_000);

  it("FR-MCP-035 AC-3: an invalid SDS artifact makes both work-order profiles block with fix-artifact", async () => {
    const fixture = await createWorkflowFixture();
    const { call } = workflowMcp(fixture.root);
    for (const profile of ["compact", "explain"] as const) {
      // The control: a valid SDS in the same workspace is handed out.
      expect(await call("get_next_work_order", { path: fixture.freshSdsPath, profile }), profile).toMatchObject({ action: "execute-sds", blocking: false });
      expect(await call("get_next_work_order", { path: fixture.invalidSdsPath, profile }), profile).toMatchObject({ action: "fix-artifact", blocking: true, profile });
    }
  });

  it("FR-MCP-035 AC-3: an ambiguous target state — two active Target Map rows — blocks both work-order profiles", async () => {
    const root = await copyFixtureWorkspace("valid-basic");
    const { call } = workflowMcp(root);
    // The control: the same workspace with one active row has work to hand out.
    expect(await call("get_next_work_order", { profile: "compact" })).toMatchObject({ action: "create-sds", blocking: false });

    await editIndex(root, { extraTargetRows: ["| v2.0.0 | release | active | A second active row |"] });
    for (const profile of ["compact", "explain"] as const) {
      const order = await call("get_next_work_order", { profile });
      expect(order, profile).toMatchObject({ action: "blocked", blocking: true, blockingDiagnostics: expect.arrayContaining([expect.objectContaining({ code: "SRS-E024" })]) });
    }
  });
});
