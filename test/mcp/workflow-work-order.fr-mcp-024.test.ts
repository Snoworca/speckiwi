import { describe, expect, it } from "vitest";
import { copyFixtureWorkspace } from "../fixtures/fixture-utils.js";
import { editIndex, eventLine, jsonl, workflowMcp, writeText } from "../support/workflow-harness.js";

// @req FR-MCP-024 — get_next_work_order hands out work only when the workspace, the target and the
// pipeline all say it is safe to.

describe("FR-MCP-024 AC-3 — the work-order tool fails closed", () => {
  it("FR-MCP-024 AC-3: a per-call workspace identity is refused instead of answered for the server's root", async () => {
    const root = await copyFixtureWorkspace("valid-basic");
    const { call } = workflowMcp(root);
    expect(await call("get_next_work_order", {})).toMatchObject({ action: "create-sds", blocking: false });

    const refused = await call("get_next_work_order", { workspaceRoot: root });
    expect(refused).toMatchObject({ ok: false, error: { code: "MCP_WORKSPACE_ROOT_UNSUPPORTED" }, diagnosticsSummary: { errors: 1 } });
    expect(refused).not.toHaveProperty("action");
  });

  it("FR-MCP-024 AC-3: no active target and no explicit target blocks", async () => {
    const root = await copyFixtureWorkspace("valid-basic");
    await editIndex(root, { activeTarget: "" });
    expect(await workflowMcp(root).call("get_next_work_order", {})).toMatchObject({
      action: "blocked",
      blocking: true,
      target: null,
      targetSource: "none",
      nextAction: { kind: "blocked" }
    });
  });

  it("FR-MCP-024 AC-3: an Active Target the Target Map does not register is unavailable, so the tool blocks", async () => {
    const root = await copyFixtureWorkspace("valid-basic");
    await editIndex(root, { activeTarget: "v9.9.9" });
    expect(await workflowMcp(root).call("get_next_work_order", {})).toMatchObject({
      action: "blocked",
      blocking: true,
      target: "v9.9.9",
      targetSource: "active-target",
      blockingDiagnostics: expect.arrayContaining([expect.objectContaining({ code: "SRS-E017" })])
    });
  });

  it("FR-MCP-024 AC-3: an explicit target the Target Map does not register is unavailable, so the tool blocks", async () => {
    const root = await copyFixtureWorkspace("valid-basic");
    const order = await workflowMcp(root).call("get_next_work_order", { target: "v9.9.9" });
    expect(order).toMatchObject({ action: "blocked", blocking: true, target: "v9.9.9", targetSource: "explicit" });
    expect(String(order.reason)).toContain("v9.9.9");
  });

  for (const [status, action] of [["FAILED", "blocked"], ["NEEDS_USER", "ask-user"]] as const) {
    it(`FR-MCP-024 AC-3: a latest pipeline state of ${status} blocks automation with ${action}`, async () => {
      const root = await copyFixtureWorkspace("valid-basic");
      await writeText(root, "kiwi/pipeline.jsonl", jsonl(eventLine("run-a"), eventLine("run-b", status)));
      expect(await workflowMcp(root).call("get_next_work_order", {})).toMatchObject({
        action,
        blocking: true,
        pipeline: { latestStatus: status },
        nextAction: { kind: action }
      });
    });
  }
});
