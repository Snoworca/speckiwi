import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { resolveProjectRoot } from "../../src/core/project-root.js";
import { parseWorkspace } from "../../src/core/parser/workspace-parser.js";
import type { ParsedWorkspace, RequirementRecord } from "../../src/core/types.js";
import {
  collectAcCoverageGaps,
  collectCommandEvidencePolicyViolations,
  collectStabilityBlockers,
  collectStabilityWarnings,
  collectMissingEvidenceReferences,
  collectTraceabilityCoverage,
  summarizeReleaseReadiness
} from "../../src/core/workflow/release-readiness.js";
import { copyFixtureWorkspace } from "../fixtures/fixture-utils.js";

function requirement(overrides: Partial<RequirementRecord> = {}): RequirementRecord {
  return {
    id: "FR-ARCH-001",
    title: "Fixture requirement",
    type: "functional",
    target: "v1.0.0",
    status: "verified",
    scope: "ARCH",
    filePath: "docs/spec/10.product-architecture.srs.md",
    headingLine: 24,
    metadata: { Type: "functional", Target: "v1.0.0", Status: "verified" },
    acceptanceCriteria: [
      { id: "AC-1", text: "First criterion.", checked: true, line: 40 },
      { id: "AC-2", text: "Second criterion.", checked: true, line: 41 }
    ],
    verificationEvidence: [{ id: "VE-1", type: "test", reference: "evidence/release.txt", covers: "all", notes: "-", line: 47 }],
    traceLinks: [],
    tags: [],
    priority: "high",
    risk: "low",
    stability: "stable",
    ...overrides
  };
}

function workspace(root: string, records: RequirementRecord[]): ParsedWorkspace {
  return {
    root: { root },
    index: {
      metadata: { "Active Target": "v1.0.0" },
      activeTarget: "v1.0.0",
      targets: [{ target: "v1.0.0", type: "release", status: "active", description: "Fixture target" }],
      scopes: [{ scope: "ARCH", prefix: "ARCH", document: "docs/spec/10.product-architecture.srs.md", description: "Architecture" }],
      completedWork: []
    },
    files: [],
    records,
    diagnostics: []
  };
}

describe("SRS traceability coverage", () => {
  it("accepts a coverage index containing all requirement IDs", () => {
    const coverage = collectTraceabilityCoverage(["FR-ARCH-001"], { "FR-ARCH-001": ["test/release/srs-traceability.test.ts"] });
    expect(coverage.coveragePercent).toBe(100);
  });

  it("accepts all and explicit AC evidence coverage", () => {
    expect(collectAcCoverageGaps([requirement()])).toEqual([]);
    expect(
      collectAcCoverageGaps([
        requirement({
          verificationEvidence: [{ id: "VE-1", type: "test", reference: "evidence/release.txt", covers: "AC-1, AC-2", notes: "-", line: 47 }]
        })
      ])
    ).toEqual([]);
  });

  it("reports unchecked and uncovered AC coverage gaps", () => {
    expect(
      collectAcCoverageGaps([
        requirement({
          acceptanceCriteria: [
            { id: "AC-1", text: "First criterion.", checked: true, line: 40 },
            { id: "AC-2", text: "Second criterion.", checked: false, line: 41 }
          ],
          verificationEvidence: [{ id: "VE-1", type: "test", reference: "evidence/release.txt", covers: "AC-1", notes: "-", line: 47 }]
        })
      ])
    ).toEqual([{ requirementId: "FR-ARCH-001", missingAcIds: ["AC-2"] }]);
  });

  it("reports missing local evidence, invalid URLs, and command policy violations separately", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "speckiwi-release-gate-"));
    await mkdir(path.join(root, "evidence"));
    await writeFile(path.join(root, "evidence", "release.txt"), "ok\n", "utf8");
    const record = requirement({
      verificationEvidence: [
        { id: "VE-1", type: "test", reference: "evidence/release.txt", covers: "AC-1", notes: "-", line: 47 },
        { id: "VE-2", type: "test", reference: "evidence/missing.txt", covers: "AC-1", notes: "-", line: 48 },
        { id: "VE-3", type: "url", reference: "not a url", covers: "AC-1", notes: "-", line: 49 },
        { id: "VE-4", type: "test", reference: "python scripts/release.py", covers: "AC-1", notes: "-", line: 50 }
      ]
    });

    expect(collectMissingEvidenceReferences(workspace(root, [record]))).toEqual([
      { requirementId: "FR-ARCH-001", evidenceId: "VE-2", reference: "evidence/missing.txt", issue: "missing" },
      { requirementId: "FR-ARCH-001", evidenceId: "VE-3", reference: "not a url", issue: "invalid-url" }
    ]);
    expect(collectCommandEvidencePolicyViolations([record])).toEqual([
      {
        requirementId: "FR-ARCH-001",
        evidenceId: "VE-4",
        reference: "python scripts/release.py",
        policy: "command evidence must use npm test, npm run release gates, or npx vitest run without shell operators"
      }
    ]);
    const summary = summarizeReleaseReadiness(workspace(root, [record]));
    expect(summary.ready).toBe(false);
    expect(summary.acCoverageGaps).toEqual([{ requirementId: "FR-ARCH-001", missingAcIds: ["AC-2"] }]);
    expect(summary.missingEvidenceReferences).toEqual([
      { requirementId: "FR-ARCH-001", evidenceId: "VE-2", reference: "evidence/missing.txt", issue: "missing" },
      { requirementId: "FR-ARCH-001", evidenceId: "VE-3", reference: "not a url", issue: "invalid-url" }
    ]);
    expect(summary.commandEvidencePolicyViolations).toEqual([
      {
        requirementId: "FR-ARCH-001",
        evidenceId: "VE-4",
        reference: "python scripts/release.py",
        policy: "command evidence must use npm test, npm run release gates, or npx vitest run without shell operators"
      }
    ]);
  });

  it("collects release stability blockers without treating deprecated requirements as draft blockers", () => {
    const records = [
      requirement({ id: "FR-ARCH-001", status: "planned", stability: "draft" }),
      requirement({ id: "FR-ARCH-002", status: "verified", stability: "deprecated" }),
      requirement({ id: "FR-ARCH-003", status: "discarded", stability: "draft" }),
      requirement({ id: "FR-ARCH-004", status: "planned", stability: "evolving" })
    ];

    expect(collectStabilityBlockers(records)).toEqual(["FR-ARCH-001"]);
    expect(collectStabilityWarnings(records)).toEqual(["FR-ARCH-002"]);
  });

  it("rejects command evidence with shell pipes", () => {
    expect(
      collectCommandEvidencePolicyViolations([
        requirement({
          verificationEvidence: [{ id: "VE-1", type: "command", reference: "npx vitest run | bash", covers: "all", notes: "-", line: 47 }]
        })
      ])
    ).toEqual([
      {
        requirementId: "FR-ARCH-001",
        evidenceId: "VE-1",
        reference: "npx vitest run | bash",
        policy: "command evidence must use npm test, npm run release gates, or npx vitest run without shell operators"
      }
    ]);
  });

  it("separates broken trace links in release readiness summaries", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "speckiwi-release-trace-"));
    await mkdir(path.join(root, "evidence"));
    await writeFile(path.join(root, "evidence", "release.txt"), "ok\n", "utf8");
    const summary = summarizeReleaseReadiness(
      workspace(root, [
        requirement({
          traceLinks: [{ type: "Requirement", reference: "FR-MISSING-001", relation: "depends_on", notes: "-", line: 52 }]
        })
      ])
    );

    expect(summary.ready).toBe(false);
    expect(summary.brokenTraceLinks).toEqual(["FR-ARCH-001 -> FR-MISSING-001"]);
  });

  it("parses release gate evidence and trace tables from a fixture workspace", async () => {
    const root = await resolveProjectRoot(await copyFixtureWorkspace("release-gate"));
    const summary = summarizeReleaseReadiness(await parseWorkspace(root));

    expect(summary.ready).toBe(false);
    expect(summary.acCoverageGaps).toEqual([{ requirementId: "FR-FLOW-901", missingAcIds: ["AC-2"] }]);
    expect(summary.missingEvidenceReferences).toEqual([
      { requirementId: "FR-FLOW-901", evidenceId: "VE-2", reference: "docs/spec/evidence/missing.txt", issue: "missing" },
      { requirementId: "FR-FLOW-901", evidenceId: "VE-3", reference: "not a url", issue: "invalid-url" }
    ]);
    expect(summary.commandEvidencePolicyViolations).toEqual([
      {
        requirementId: "FR-FLOW-901",
        evidenceId: "VE-4",
        reference: "python scripts/release.py",
        policy: "command evidence must use npm test, npm run release gates, or npx vitest run without shell operators"
      }
    ]);
    expect(summary.brokenTraceLinks).toEqual(["FR-FLOW-901 -> FR-MISSING-001"]);
  });
});
