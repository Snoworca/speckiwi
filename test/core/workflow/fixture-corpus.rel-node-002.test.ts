import { describe, expect, it } from "vitest";
import { parseWorkspace } from "../../../src/core/parser/workspace-parser.js";
import { createWorkflowFixture } from "../../fixtures/workflow-artifacts.js";

// @req REL-NODE-002 — moved here from validator.test.ts when the workflow validator it sat beside was
// removed (FR-NODE-211 AC-3); the corpus measurement never read the validator.

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
