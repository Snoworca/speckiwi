import { mkdir, mkdtemp, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { resolveWorkflowArtifacts } from "../../../src/core/workflow/artifacts.js";

async function tempRoot(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), "speckiwi-workflow-artifacts-"));
}

async function write(root: string, relativePath: string, text: string): Promise<void> {
  const absolutePath = path.join(root, relativePath);
  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, text, "utf8");
}

function plan(runId: string, target: string, sidecarPath = `./${runId}.sidecar.json`): string {
  return [
    "---",
    `run_id: ${runId}`,
    `target: ${target}`,
    "plan_contract: \"1.2.0\"",
    "generated_at: 2026-06-29T08:05:04.654Z",
    `sidecar_path: ${sidecarPath}`,
    "---",
    "# Plan"
  ].join("\n");
}

function sidecar(runId: string, target: string, generatedAt = "2026-06-29T08:05:04.654Z"): string {
  return JSON.stringify({ schema_version: "1.1.0", plan_contract: "1.2.0", run_id: runId, target, generated_at: generatedAt, tasks: [] }, null, 2);
}

describe("FR-NODE-020 workflow artifact resolver", () => {
  it("discovers current, legacy, session, pipeline, and companion artifacts with deterministic scoring", async () => {
    const root = await tempRoot();
    await write(root, "docs/plans/run-a.plan.md", plan("run-a", "v2.3.0"));
    await write(root, "docs/plans/run-a.sidecar.json", sidecar("run-a", "v2.3.0"));
    await write(root, "docs/plans/run-a.validator.json", JSON.stringify({ ok: true }));
    await write(root, "docs/plan/legacy.plan.md", plan("run-a", "v2.3.0"));
    await write(root, ".kiwi/sessions/run-a/pm-state.json", JSON.stringify({ run_id: "run-a", target: "v2.3.0" }));
    await write(root, ".kiwi/sessions/run-a/worklog.jsonl", "{\"schema_version\":\"1.0.0\",\"skill\":\"kiwi-pm\",\"run_id\":\"run-a\"}\n");
    await write(root, ".snoworca/sessions/old/state.json", JSON.stringify({ run_id: "old", target: "v1.0.0" }));
    await write(root, "kiwi/pipeline.jsonl", "{\"schema_version\":\"1.0.0\",\"skill\":\"kiwi-srs\",\"run_id\":\"run-a\"}\n");

    const resolution = await resolveWorkflowArtifacts({ root }, { kind: "plan", runId: "run-a", target: "v2.3.0" });

    expect(resolution.diagnosticsSummary.errors).toBe(0);
    expect(resolution.selected).toMatchObject({
      relativePath: "docs/plans/run-a.plan.md",
      kind: "plan",
      legacy: false,
      runId: "run-a",
      target: "v2.3.0",
      companion: { sidecarPath: "docs/plans/run-a.sidecar.json" }
    });
    expect(resolution.candidates.map((candidate) => candidate.relativePath)).toContain("docs/plan/legacy.plan.md");

    const explicitLegacy = await resolveWorkflowArtifacts({ root }, { explicitPath: "docs/plan/legacy.plan.md", kind: "plan", runId: "run-a" });
    expect(explicitLegacy.selected).toMatchObject({ relativePath: "docs/plan/legacy.plan.md", legacy: true });
  });

  it("returns diagnostics for missing companions, ambiguous ties, and outside explicit paths", async () => {
    const root = await tempRoot();
    await write(root, "docs/plans/no-sidecar.plan.md", plan("no-sidecar", "v2.3.0", "./missing.sidecar.json"));
    await write(root, "docs/plans/a.sidecar.json", sidecar("tie", "v2.3.0"));
    await write(root, "docs/plans/b.sidecar.json", sidecar("tie", "v2.3.0"));
    const mtime = new Date("2026-06-29T00:00:00Z");
    await utimes(path.join(root, "docs/plans/a.sidecar.json"), mtime, mtime);
    await utimes(path.join(root, "docs/plans/b.sidecar.json"), mtime, mtime);

    const missingCompanion = await resolveWorkflowArtifacts({ root }, { explicitPath: "docs/plans/no-sidecar.plan.md", kind: "plan" });
    expect(missingCompanion.diagnostics.map((item) => item.code)).toContain("SRS-W051");

    const ambiguous = await resolveWorkflowArtifacts({ root }, { kind: "sidecar", runId: "tie", target: "v2.3.0" });
    expect(ambiguous.selected).toBeNull();
    expect(ambiguous.diagnostics.map((item) => item.code)).toContain("SRS-E051");

    const outside = await resolveWorkflowArtifacts({ root }, { explicitPath: "../outside.plan.md" });
    expect(outside.selected).toBeNull();
    expect(outside.diagnostics.map((item) => item.code)).toContain("SRS-E050");
  });

  it("does not leak irrelevant plan companion diagnostics into kind-filtered pipeline resolution", async () => {
    const root = await tempRoot();
    await write(root, "docs/plans/no-sidecar.plan.md", plan("no-sidecar", "v2.3.0", "./missing.sidecar.json"));
    await write(root, "kiwi/pipeline.jsonl", "{\"schema_version\":\"1.0.0\",\"skill\":\"kiwi-pm\",\"run_id\":\"pipeline-a\",\"status\":\"TASK_DONE\"}\n");

    const resolution = await resolveWorkflowArtifacts({ root }, { kind: "pipeline" });

    expect(resolution.selected).toMatchObject({ relativePath: "kiwi/pipeline.jsonl", kind: "pipeline" });
    expect(resolution.diagnostics.map((item) => item.code)).not.toContain("SRS-W051");
  });
});
