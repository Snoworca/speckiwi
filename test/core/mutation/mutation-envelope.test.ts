import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { resolveProjectRoot } from "../../../src/core/project-root.js";
import { addCompletedWork } from "../../../src/core/mutation/add-completed-work.js";
import { addVerificationEvidence } from "../../../src/core/mutation/add-evidence.js";
import { addRequirement } from "../../../src/core/mutation/add-requirement.js";
import { addTraceLink } from "../../../src/core/mutation/add-trace.js";
import { appendSectionNote } from "../../../src/core/mutation/append-section-note.js";
import { setAcceptanceCriteriaChecked } from "../../../src/core/mutation/check-ac.js";
import { setActiveTarget } from "../../../src/core/mutation/set-active-target.js";
import { setTargetGoal } from "../../../src/core/mutation/set-target-goal.js";
import { updateStability } from "../../../src/core/mutation/update-stability.js";
import { updateStatus } from "../../../src/core/mutation/update-status.js";
import { copyFixtureWorkspace } from "../../fixtures/fixture-utils.js";

interface MutationEnvelopeShape {
  kind: string;
  filePath: string;
  dryRun: boolean;
  written: boolean;
  operations: Array<Record<string, unknown>>;
  preview: string[];
}

function expectFrNode017MutationEnvelope(result: unknown, kind: string): MutationEnvelopeShape {
  expect(result).toMatchObject({
    ok: true,
    diagnostics: [],
    diagnosticsSummary: { errors: 0, warnings: 0, byCode: {} },
    mutation: {
      kind,
      filePath: expect.stringMatching(/^docs\/spec\//),
      dryRun: true,
      written: false,
      operations: expect.any(Array),
      preview: expect.any(Array)
    }
  });
  const mutation = (result as { mutation: MutationEnvelopeShape }).mutation;
  expect(mutation.operations.length, `FR-NODE-017 AC-4 ${kind} operation detail`).toBeGreaterThan(0);
  expect(mutation.preview.length, `FR-NODE-017 AC-3 ${kind} dry-run preview`).toBeGreaterThan(0);
  expect(mutation.operations[0]).toEqual(expect.objectContaining({ type: expect.any(String) }));
  return mutation;
}

describe("FR-NODE-017 unified mutation envelope", () => {
  it("returns the shared success envelope for existing core SRS mutations", async () => {
    const rootPath = await copyFixtureWorkspace("mutation-target");
    const root = await resolveProjectRoot(rootPath);
    const originalIndex = await readFile(path.join(rootPath, "docs", "spec", "00.index.md"), "utf8");
    const originalScope = await readFile(path.join(rootPath, "docs", "spec", "10.product-architecture.srs.md"), "utf8");

    const cases = [
      {
        kind: "add_requirement",
        result: await addRequirement(root, {
          type: "functional",
          scope: "ARCH",
          target: "v1.0.0",
          title: "Envelope dry-run requirement",
          statement: "Dry-run requirement creation must expose the shared mutation envelope.",
          acceptanceCriteria: ["envelope is returned"],
          dryRun: true
        })
      },
      {
        kind: "update_status",
        result: await updateStatus(root, { id: "FR-ARCH-001", status: "blocked", reason: "envelope dry-run", dryRun: true })
      },
      {
        kind: "check_acceptance_criteria",
        result: await setAcceptanceCriteriaChecked(root, { id: "FR-ARCH-001", acIds: ["AC-1"], checked: true, dryRun: true })
      },
      {
        kind: "add_verification_evidence",
        result: await addVerificationEvidence(root, {
          id: "FR-ARCH-001",
          type: "test",
          reference: "test/core/mutation/mutation-envelope.test.ts",
          covers: "AC-1",
          notes: "FR-NODE-017 dry-run",
          dryRun: true
        })
      },
      {
        kind: "add_trace_link",
        result: await addTraceLink(root, {
          id: "FR-ARCH-001",
          type: "Requirement",
          reference: "FR-ARCH-001",
          relation: "self",
          notes: "FR-NODE-017 dry-run",
          dryRun: true
        })
      },
      {
        kind: "update_stability",
        result: await updateStability(root, { id: "FR-ARCH-001", stability: "evolving", dryRun: true })
      },
      {
        kind: "set_target_goal",
        result: await setTargetGoal(root, { target: "v1.0.0", goal: "Envelope dry-run goal", dryRun: true })
      },
      {
        kind: "set_active_target",
        result: await setActiveTarget(root, { target: "v1.1.0", dryRun: true })
      },
      {
        kind: "add_completed_work",
        result: await addCompletedWork(root, {
          date: "2026-06-29",
          summary: "Envelope dry-run completed work.",
          requirementIds: ["FR-ARCH-001"],
          allowIncomplete: true,
          dryRun: true
        })
      },
      {
        kind: "append_section_note",
        result: await appendSectionNote(root, {
          id: "FR-ARCH-001",
          section: "implementation_notes",
          text: "Envelope dry-run note.",
          dryRun: true
        })
      }
    ];

    for (const item of cases) {
      expectFrNode017MutationEnvelope(item.result, item.kind);
    }

    await expect(readFile(path.join(rootPath, "docs", "spec", "00.index.md"), "utf8")).resolves.toBe(originalIndex);
    await expect(readFile(path.join(rootPath, "docs", "spec", "10.product-architecture.srs.md"), "utf8")).resolves.toBe(originalScope);
  });

  it("returns the shared failure envelope with diagnostics summary and structured error", async () => {
    const root = await resolveProjectRoot(await copyFixtureWorkspace("mutation-target"));
    const result = await updateStatus(root, { id: "FR-ARCH-001", status: "not-a-status", dryRun: true } as never);

    expect(result).toMatchObject({
      ok: false,
      error: {
        code: "USAGE",
        message: expect.any(String)
      },
      diagnostics: [],
      diagnosticsSummary: { errors: 0, warnings: 0, byCode: {} }
    });
    expect(result).not.toHaveProperty("mutation");
  });
});
