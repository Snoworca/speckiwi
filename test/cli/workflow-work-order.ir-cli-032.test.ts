import { describe, expect, it } from "vitest";
import { WORK_ORDER_ACTION_TOOLS, type WorkOrderAction } from "../../src/core/workflow/work-order.js";
import { copyFixtureWorkspace } from "../fixtures/fixture-utils.js";
import { createWorkflowFixture } from "../fixtures/workflow-artifacts.js";
import { editIndex, eventLine, jsonl, runCli, writeText, type Json } from "../support/workflow-harness.js";

// @req IR-CLI-032 — `speckiwi workflow work-order next`.

async function next(root: string, args: string[] = []): Promise<Json> {
  const run = await runCli(root, ["workflow", "work-order", "next", ...args]);
  expect(run.code, `work-order next ${args.join(" ")}`).toBe(0);
  return run.json;
}

/** A registered target that no requirement names: the one state with nothing to hand out. */
async function idleTargetRoot(): Promise<string> {
  const root = await copyFixtureWorkspace("valid-basic");
  await editIndex(root, { extraTargetRows: ["| v2.0.0 | release | planned | Registered, with no requirements yet |"] });
  return root;
}

describe("IR-CLI-032 AC-1 — the command returns the no-action kind", () => {
  it("IR-CLI-032 AC-1: a registered target with no requirements yields no-action, without blocking", async () => {
    const order = await next(await idleTargetRoot(), ["--target", "v2.0.0"]);
    expect(order).toMatchObject({
      action: "no-action",
      blocking: false,
      target: "v2.0.0",
      targetSource: "explicit",
      requirementIds: [],
      nextAction: { kind: "no-action", tool: WORK_ORDER_ACTION_TOOLS["no-action"] }
    });
    expect(JSON.stringify(order)).not.toContain("create-plan");
  });
});

describe("IR-CLI-032 AC-3 — the command fails closed", () => {
  for (const [status, action] of [["FAILED", "blocked"], ["NEEDS_USER", "ask-user"]] as const) {
    it(`IR-CLI-032 AC-3: a latest pipeline state of ${status} is answered with a blocking ${action}, not with work`, async () => {
      const root = await copyFixtureWorkspace("valid-basic");
      expect(await next(root)).toMatchObject({ action: "create-sds", blocking: false });

      await writeText(root, "kiwi/pipeline.jsonl", jsonl(eventLine("run-a"), eventLine("run-b", status)));
      expect(await next(root)).toMatchObject({ action, blocking: true, pipeline: { latestStatus: status } });
    });
  }

  it("IR-CLI-032 AC-3: with no active target and no explicit target the command blocks", async () => {
    const root = await copyFixtureWorkspace("valid-basic");
    await editIndex(root, { activeTarget: "" });
    expect(await next(root)).toMatchObject({
      action: "blocked",
      blocking: true,
      target: null,
      targetSource: "none",
      reason: "no active target or explicit target is available",
      diagnostics: expect.arrayContaining([expect.objectContaining({ code: "SRS-W002" })])
    });
    // An explicit target is what lifts it.
    expect(await next(root, ["--target", "v1.0.0"])).toMatchObject({ action: "create-sds", targetSource: "explicit" });
  });
});

describe("IR-CLI-032 AC-5 — one deterministic fixture for every action kind", () => {
  it("IR-CLI-032 AC-5: every kind the command can return has a fixture, and each answers the same twice", async () => {
    const fixture = await createWorkflowFixture();
    const stopped = await createWorkflowFixture();
    await writeText(stopped.root, "kiwi/pipeline.jsonl", jsonl(eventLine("run-a", "NEEDS_USER")));
    const fresh = await copyFixtureWorkspace("valid-basic");
    const idle = await idleTargetRoot();

    const cases: Array<{ action: WorkOrderAction; root: string; args: string[] }> = [
      { action: "create-sds", root: fresh, args: [] },
      { action: "execute-sds", root: fixture.root, args: ["--path", fixture.freshSdsPath] },
      { action: "resume-session", root: fixture.root, args: ["--path", fixture.sdsPath] },
      { action: "ask-user", root: stopped.root, args: ["--path", stopped.freshSdsPath] },
      { action: "fix-artifact", root: fixture.root, args: ["--path", fixture.invalidSdsPath] },
      { action: "blocked", root: fixture.root, args: ["--path", fixture.blockedSdsPath] },
      { action: "complete", root: fixture.root, args: ["--path", fixture.completeSdsPath] },
      { action: "no-action", root: idle, args: ["--target", "v2.0.0"] }
    ];
    // The denominator is the action union itself, so a kind added later without a fixture fails here.
    expect(cases.map((item) => item.action).sort()).toEqual(Object.keys(WORK_ORDER_ACTION_TOOLS).sort());

    for (const item of cases) {
      const first = await next(item.root, item.args);
      const second = await next(item.root, item.args);
      expect(first, item.action).toMatchObject({ action: item.action, nextAction: { kind: item.action, tool: WORK_ORDER_ACTION_TOOLS[item.action] } });
      expect(second, `${item.action} is not deterministic`).toEqual(first);
    }
  });
});
