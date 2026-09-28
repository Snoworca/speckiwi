import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { copyFixtureWorkspace } from "../../fixtures/fixture-utils.js";
import { createWorkflowFixture } from "../../fixtures/workflow-artifacts.js";
import { buildNextWorkOrder, WORK_ORDER_ACTION_TOOLS } from "../../../src/core/workflow/work-order.js";

async function write(root: string, relativePath: string, text: string): Promise<void> {
  const absolutePath = path.join(root, relativePath);
  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, text, "utf8");
}

function pipelineEvent(status: string): string {
  return JSON.stringify({
    ts: "2026-06-29T00:00:00.000Z",
    schema_version: "1.0.0",
    skill: "kiwi-pm",
    run_id: `pipeline-${status.toLowerCase()}`,
    status,
    summary: status,
    next_hint: null,
    dry_run: false
  });
}

describe("IR-CLI-032 / FR-MCP-024 next work-order core", () => {
  it("FR-NODE-211 AC-4: returns deterministic SDS-vocabulary actions for the execute, session, blocker and completion states", async () => {
    const fixture = await createWorkflowFixture();

    await expect(buildNextWorkOrder({ root: fixture.root }, { path: fixture.freshSdsPath })).resolves.toMatchObject({
      action: "execute-sds",
      nextAction: { kind: "execute-sds", tool: "check_sds" },
      sds: { relativePath: fixture.freshSdsPath, sdsId: "fresh-run", status: "agreed" },
      requirementIds: ["FR-ARCH-001"],
      blocking: false
    });

    await expect(buildNextWorkOrder({ root: fixture.root }, { path: fixture.sdsPath })).resolves.toMatchObject({
      action: "resume-session",
      nextAction: { kind: "resume-session", tool: "workflow_session_status" },
      sds: { relativePath: fixture.sdsPath, sdsId: fixture.runId },
      artifacts: expect.arrayContaining([expect.objectContaining({ relativePath: `.kiwi/sessions/${fixture.runId}/pm-state.json`, kind: "pm-state" })]),
      blocking: false
    });

    await expect(buildNextWorkOrder({ root: fixture.root }, { path: fixture.draftSdsPath })).resolves.toMatchObject({
      action: "create-sds",
      nextAction: { kind: "create-sds", tool: "list_requirements" },
      sds: { relativePath: fixture.draftSdsPath, status: "draft" },
      blocking: false
    });

    await expect(buildNextWorkOrder({ root: fixture.root }, { path: fixture.invalidSdsPath })).resolves.toMatchObject({
      action: "fix-artifact",
      blocking: true,
      nextAction: { kind: "fix-artifact", tool: "check_sds" },
      blockingDiagnostics: expect.arrayContaining([expect.objectContaining({ code: "SDS-E062" })])
    });

    await expect(buildNextWorkOrder({ root: fixture.root }, { path: fixture.blockedSdsPath })).resolves.toMatchObject({
      action: "blocked",
      blocking: true,
      nextAction: { kind: "blocked", tool: "workflow_session_status" },
      reason: expect.stringContaining("blocked")
    });

    await expect(buildNextWorkOrder({ root: fixture.root }, { path: fixture.completeSdsPath })).resolves.toMatchObject({
      action: "complete",
      blocking: false,
      nextAction: { kind: "complete", tool: "add_completed_work" }
    });
  });

  it("FR-NODE-211 AC-4: reads the kiwi-pm run status of the SDS session — failed blocks, pending resumes, anything else fails closed", async () => {
    const fixture = await createWorkflowFixture();
    const session = (status: string): string => JSON.stringify({ run_id: "fresh-run", run: { status } });

    await write(fixture.root, ".kiwi/sessions/fresh-run/pm-state.json", session("failed"));
    await expect(buildNextWorkOrder({ root: fixture.root }, { path: fixture.freshSdsPath })).resolves.toMatchObject({ action: "blocked", blocking: true });

    await write(fixture.root, ".kiwi/sessions/fresh-run/pm-state.json", session("pending"));
    await expect(buildNextWorkOrder({ root: fixture.root }, { path: fixture.freshSdsPath })).resolves.toMatchObject({ action: "resume-session", blocking: false });

    // A session whose run status is missing or outside kiwi-pm's vocabulary is neither live, finished
    // nor stopped: it is an artifact to repair, and the order blocks on it.
    for (const malformed of [{ run_id: "fresh-run" }, { run_id: "fresh-run", run: { status: "DONE" } }, { run_id: "fresh-run", run: "done" }, { run_id: "fresh-run", tasks: [{ status: "failed" }] }]) {
      await write(fixture.root, ".kiwi/sessions/fresh-run/pm-state.json", JSON.stringify(malformed));
      await expect(buildNextWorkOrder({ root: fixture.root }, { path: fixture.freshSdsPath }), JSON.stringify(malformed)).resolves.toMatchObject({ action: "fix-artifact", blocking: true });
    }
  });

  it("FR-NODE-211 AC-4: a named run id that matches no open SDS fails closed instead of widening to the target", async () => {
    const fixture = await createWorkflowFixture();

    await expect(buildNextWorkOrder({ root: fixture.root }, { runId: "no-such-sds" })).resolves.toMatchObject({ action: "fix-artifact", blocking: true, sds: null });
  });

  it("FR-NODE-211 AC-4: once every open SDS is finished, active-target requirements no SDS names still get create-sds", async () => {
    const fixture = await createWorkflowFixture();
    for (const other of [fixture.sdsPath, fixture.freshSdsPath, fixture.draftSdsPath, fixture.invalidSdsPath, fixture.blockedSdsPath]) {
      await rm(path.join(fixture.root, other));
    }

    const order = await buildNextWorkOrder({ root: fixture.root }, {});

    expect(order).toMatchObject({ action: "create-sds", sds: null });
    expect(order.requirementIds).toContain("FR-ARCH-011");
    expect(order.requirementIds).not.toContain("FR-ARCH-001");

    // Where the finished SDS names every open requirement of the target, the order is complete.
    const onlyNamed = await copyFixtureWorkspace("valid-basic");
    await write(onlyNamed, "docs/sds/done-run.sds.md", await readFile(path.join(fixture.root, fixture.completeSdsPath), "utf8"));
    await write(onlyNamed, ".kiwi/sessions/done-run/pm-state.json", JSON.stringify({ run_id: "done-run", run: { status: "done" } }));
    await expect(buildNextWorkOrder({ root: onlyNamed }, {})).resolves.toMatchObject({ action: "complete", sds: { sdsId: "done-run" } });
  });

  it("FR-NODE-211 AC-4: picks the first open SDS of the target by path when no path is named", async () => {
    const fixture = await createWorkflowFixture();

    // blocked-run sorts first among the fixture's SDS files of v1.0.0.
    await expect(buildNextWorkOrder({ root: fixture.root }, {})).resolves.toMatchObject({
      action: "blocked",
      sds: { relativePath: fixture.blockedSdsPath }
    });
    await expect(buildNextWorkOrder({ root: fixture.root }, { runId: "fresh-run" })).resolves.toMatchObject({
      action: "execute-sds",
      sds: { relativePath: fixture.freshSdsPath }
    });
  });

  it("FR-NODE-211 AC-4: a named path that is not a docs/sds SDS fails closed instead of reading a plan", async () => {
    const fixture = await createWorkflowFixture();

    const order = await buildNextWorkOrder({ root: fixture.root }, { path: "docs/plan/legacy.plan.md" });

    expect(order).toMatchObject({ action: "fix-artifact", blocking: true, sds: null });
    expect(order.reason).toContain("docs/sds");
  });

  it("FR-NODE-211 AC-4: returns create-sds when the target has requirements and no open SDS, plus ask-user and measured compact payloads", async () => {
    const noSdsRoot = await copyFixtureWorkspace("valid-basic");
    const createSds = await buildNextWorkOrder({ root: noSdsRoot }, { target: "v1.0.0", measure: true });
    expect(createSds).toMatchObject({
      action: "create-sds",
      target: "v1.0.0",
      sds: null,
      nextAction: { kind: "create-sds", tool: "list_requirements" },
      measurement: {
        baselineBytes: expect.any(Number),
        baselineApproxTokens: expect.any(Number),
        compactBytes: expect.any(Number),
        compactApproxTokens: expect.any(Number),
        requiredFieldsPresent: true,
        reductionRatio: expect.any(Number)
      }
    });
    expect(JSON.stringify(createSds)).not.toContain("#### Requirement");
    expect(createSds.measurement?.compactBytes).toBeLessThan(createSds.measurement?.baselineBytes ?? 0);

    const fixture = await createWorkflowFixture();
    await write(fixture.root, "kiwi/pipeline.jsonl", `${pipelineEvent("NEEDS_USER")}\n`);
    await expect(buildNextWorkOrder({ root: fixture.root }, { path: fixture.freshSdsPath })).resolves.toMatchObject({
      action: "ask-user",
      blocking: true,
      nextAction: { kind: "ask-user" },
      pipeline: { latestStatus: "NEEDS_USER" }
    });
  });

  it("FR-NODE-211 AC-4: the action vocabulary carries no plan action and every action names a tool", () => {
    expect(Object.keys(WORK_ORDER_ACTION_TOOLS).sort()).toEqual(
      ["ask-user", "blocked", "complete", "create-sds", "execute-sds", "fix-artifact", "no-action", "resume-session"].sort()
    );
  });
});

// FR-NODE-211 AC-4 · FR-FLOW-183 AC-4 — a `closed` SDS has had its decisions moved into the SRS and is
// never written again (SDS-MD-Rules §9.1), so the work order must not send kiwi-sds back to finish it.
describe("FR-NODE-211 AC-4 — a closed SDS is finished work, not an SDS to author", () => {
  it("FR-NODE-211 AC-4: a closed SDS yields complete rather than create-sds", async () => {
    const fixture = await createWorkflowFixture();
    const closedPath = "docs/sds/closed-run.sds.md";
    const draft = await readFile(path.join(fixture.root, fixture.draftSdsPath), "utf8");
    expect(draft).toContain("| Status | draft |");
    await write(fixture.root, closedPath, draft.replace("| Status | draft |", "| Status | closed |"));

    const order = await buildNextWorkOrder({ root: fixture.root }, { path: closedPath });
    expect(order).toMatchObject({ action: "complete", blocking: false, sds: { relativePath: closedPath, status: "closed" } });
  });
});
