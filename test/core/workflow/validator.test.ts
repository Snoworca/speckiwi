import { describe, expect, it } from "vitest";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseWorkspace } from "../../../src/core/parser/workspace-parser.js";
import { validateWorkflowArtifacts } from "../../../src/core/workflow/validate.js";
import { createWorkflowFixture } from "../../fixtures/workflow-artifacts.js";

async function write(root: string, relativePath: string, text: string): Promise<void> {
  const absolutePath = path.join(root, relativePath);
  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, text, "utf8");
}

describe("REL-NODE-002 agent workflow fixture corpus", () => {
  it("creates a multi-document SRS corpus large enough for compact payload measurement", async () => {
    const fixture = await createWorkflowFixture();
    const workspace = await parseWorkspace({ root: fixture.root });

    const workflowCorpusRecords = workspace.records.filter((record) => record.filePath.endsWith("70.workflow-corpus.srs.md"));
    const fullPayload = JSON.stringify(workflowCorpusRecords.map((record) => ({ id: record.id, title: record.title, markdown: record.markdown })));
    const compactPayload = JSON.stringify(workflowCorpusRecords.map((record) => ({ id: record.id, title: record.title, status: record.status, target: record.target })));
    const measurement = {
      baselineBytes: Buffer.byteLength(fullPayload),
      baselineApproxTokens: Math.ceil(Buffer.byteLength(fullPayload) / 4),
      compactBytes: Buffer.byteLength(compactPayload),
      compactApproxTokens: Math.ceil(Buffer.byteLength(compactPayload) / 4),
      requiredFieldsPresent: workflowCorpusRecords.every((record) => record.id && record.title && record.status && record.target),
      reductionRatio: Buffer.byteLength(compactPayload) / Buffer.byteLength(fullPayload)
    };

    expect(workflowCorpusRecords.length).toBeGreaterThanOrEqual(16);
    expect(measurement).toMatchObject({
      baselineBytes: expect.any(Number),
      baselineApproxTokens: expect.any(Number),
      compactBytes: expect.any(Number),
      compactApproxTokens: expect.any(Number),
      requiredFieldsPresent: true
    });
    expect(measurement.reductionRatio).toBeLessThan(0.45);
  });
});

describe("REL-NODE-003 workflow artifact validators and hallucination guards", () => {
  it("validates the normal workflow path and preserves sidecar order instead of sorting task IDs", async () => {
    const fixture = await createWorkflowFixture();

    const normal = await validateWorkflowArtifacts({ root: fixture.root }, { path: fixture.planPath });
    expect(normal).toMatchObject({
      outcome: "ok",
      blocking: false,
      nextTask: { id: "T-002", status: "pending", req_ids: ["FR-ARCH-001"] },
      diagnosticsSummary: { errors: 0 }
    });

    const idOrder = await validateWorkflowArtifacts({ root: fixture.root }, { path: fixture.idOrderPlanPath });
    expect(idOrder).toMatchObject({
      outcome: "ok",
      blocking: false,
      nextTask: { id: "T-PH001-10", title: "Declared first" }
    });
  });

  it("reports dependency, hash, checkbox, state, req-id, and worklog drift with explicit outcomes", async () => {
    const fixture = await createWorkflowFixture();

    await expect(validateWorkflowArtifacts({ root: fixture.root }, { path: fixture.cyclePlanPath })).resolves.toMatchObject({
      outcome: "invalid_artifact",
      blocking: true,
      nextTask: null,
      diagnosticsSummary: { byCode: { "SRS-W057": expect.any(Number) } }
    });

    await expect(validateWorkflowArtifacts({ root: fixture.root }, { path: fixture.blockedPlanPath })).resolves.toMatchObject({
      outcome: "blocked_dependency",
      blocking: true,
      nextTask: null,
      blockedBy: ["T-BLOCK-2"]
    });

    await expect(validateWorkflowArtifacts({ root: fixture.root }, { path: fixture.stalePlanPath })).resolves.toMatchObject({
      outcome: "stale_artifact",
      blocking: true,
      nextTask: null,
      diagnosticsSummary: { byCode: { "SRS-W059": 2 } }
    });

    await expect(validateWorkflowArtifacts({ root: fixture.root }, { path: fixture.checkboxDriftPlanPath })).resolves.toMatchObject({
      outcome: "repairable_drift",
      blocking: false,
      nextTask: { id: "T-CHECK-2" },
      diagnosticsSummary: { byCode: { "SRS-W060": 1 } }
    });

    await expect(validateWorkflowArtifacts({ root: fixture.root }, { path: fixture.conflictPlanPath })).resolves.toMatchObject({
      outcome: "resume-blocked",
      blocking: true,
      nextTask: null,
      diagnosticsSummary: { byCode: { "SRS-W058": expect.any(Number) } }
    });

    await expect(validateWorkflowArtifacts({ root: fixture.root }, { path: fixture.worklogMismatchPlanPath })).resolves.toMatchObject({
      outcome: "resume-blocked",
      blocking: true,
      diagnosticsSummary: { byCode: { "SRS-W063": 1 } }
    });
  });

  it("normalizes canonical req_ids and flags legacy trace fields without outranking req_ids", async () => {
    const fixture = await createWorkflowFixture();

    const legacy = await validateWorkflowArtifacts({ root: fixture.root }, { path: fixture.legacyTracePlanPath });
    expect(legacy).toMatchObject({
      outcome: "ok",
      taskCatalog: [
        expect.objectContaining({ id: "T-LEGACY-1", req_ids: ["FR-ARCH-001"], legacyReqIds: ["FR-ARCH-001"] }),
        expect.objectContaining({ id: "T-LEGACY-2", req_ids: ["FR-ARCH-001"], legacyReqIds: ["FR-ARCH-999"] })
      ],
      diagnosticsSummary: { byCode: { "SRS-W061": 2 } }
    });

    const missing = await validateWorkflowArtifacts({ root: fixture.root }, { path: fixture.missingReqIdsPlanPath });
    expect(missing).toMatchObject({
      outcome: "needs_user",
      blocking: false,
      diagnosticsSummary: { byCode: { "SRS-W064": 1 } }
    });
  });

  it("folds JSONL parse and correction-chain diagnostics into resume validation", async () => {
    const fixture = await createWorkflowFixture();

    const validation = await validateWorkflowArtifacts({ root: fixture.root }, { path: fixture.planPath });

    expect(validation.diagnostics.map((item) => item.code)).toContain("SRS-W052");
    expect(validation).toMatchObject({
      pipeline: { total: 2, invalidLines: [expect.objectContaining({ line: 2 })] },
      worklog: { total: 2 }
    });
  });

  it("prefers the canonical pipeline artifact over nested same-score pipeline files for explicit plan validation", async () => {
    const fixture = await createWorkflowFixture();
    await write(fixture.root, "kiwi/pipeline.jsonl", "{\"schema_version\":\"1.0.0\",\"skill\":\"kiwi-planner\",\"run_id\":\"pipeline-a\",\"status\":\"TASK_DONE\"}\n");
    await write(fixture.root, "kiwi/bad/pipeline.jsonl", "{bad json\n");

    const validation = await validateWorkflowArtifacts({ root: fixture.root }, { path: fixture.planPath });

    expect(validation).toMatchObject({ outcome: "ok", blocking: false });
    expect(validation.artifacts).toEqual(expect.arrayContaining([expect.objectContaining({ relativePath: "kiwi/pipeline.jsonl" })]));
    expect(validation.diagnostics.map((item) => item.code)).not.toContain("SRS-W052");
  });

  it("reports invalid sidecar, missing sidecar, and stale lock workflow hazards", async () => {
    const fixture = await createWorkflowFixture();

    await expect(validateWorkflowArtifacts({ root: fixture.root }, { path: fixture.invalidSidecarPlanPath })).resolves.toMatchObject({
      outcome: "invalid_artifact",
      blocking: true,
      diagnosticsSummary: { byCode: { "SRS-W050": expect.any(Number) } }
    });

    await expect(validateWorkflowArtifacts({ root: fixture.root }, { path: fixture.missingSidecarPlanPath })).resolves.toMatchObject({
      outcome: "invalid_artifact",
      blocking: true,
      diagnosticsSummary: { byCode: { "SRS-W051": expect.any(Number) } }
    });

    await expect(validateWorkflowArtifacts({ root: fixture.root }, { path: fixture.staleLockPlanPath })).resolves.toMatchObject({
      outcome: "ok",
      blocking: false,
      nextTask: { id: "T-LOCK-1" },
      diagnosticsSummary: { byCode: { "SRS-W062": 1 } }
    });
  });

  it("fails closed for wrong explicit artifact paths", async () => {
    const fixture = await createWorkflowFixture();

    const invalid = await validateWorkflowArtifacts({ root: fixture.root }, { path: "../outside.plan.md" });

    expect(invalid).toMatchObject({
      outcome: "invalid_artifact",
      blocking: true,
      nextTask: null,
      diagnosticsSummary: { byCode: { "SRS-E050": 1 } }
    });
  });
});
