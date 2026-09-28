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

function legacyPlan(runId: string, target: string): string {
  return ["---", `run_id: ${runId}`, `target: ${target}`, "generated_at: 2026-06-29T08:05:04.654Z", "---", "# Plan"].join("\n");
}

function sds(target: string): string {
  return ["# SDS: run-a", "", "| Field | Value |", "|---|---|", "| Document Type | sds |", "| Profile | lite |", `| Target | ${target} |`, "| Status | agreed |", "| Date | 2026-09-27 |", ""].join("\n");
}

describe("FR-NODE-020 workflow artifact resolver", () => {
  it("FR-NODE-020 AC-1: discovers current SDS, legacy, session and pipeline artifacts with deterministic scoring", async () => {
    const root = await tempRoot();
    await write(root, "docs/sds/run-a.sds.md", sds("v2.3.0"));
    await write(root, "docs/plan/legacy.plan.md", legacyPlan("run-a", "v2.3.0"));
    await write(root, ".kiwi/sessions/run-a/pm-state.json", JSON.stringify({ run_id: "run-a", target: "v2.3.0" }));
    await write(root, ".kiwi/sessions/run-a/worklog.jsonl", "{\"schema_version\":\"1.0.0\",\"skill\":\"kiwi-pm\",\"run_id\":\"run-a\"}\n");
    await write(root, ".snoworca/sessions/old/state.json", JSON.stringify({ run_id: "old", target: "v1.0.0" }));
    await write(root, "kiwi/pipeline.jsonl", "{\"schema_version\":\"1.0.0\",\"skill\":\"kiwi-srs\",\"run_id\":\"run-a\"}\n");

    const resolution = await resolveWorkflowArtifacts({ root }, { kind: "sds", runId: "run-a", target: "v2.3.0" });

    expect(resolution.diagnosticsSummary.errors).toBe(0);
    expect(resolution.selected).toMatchObject({ relativePath: "docs/sds/run-a.sds.md", kind: "sds", legacy: false, runId: "run-a", target: "v2.3.0" });

    const everything = await resolveWorkflowArtifacts({ root }, { runId: "run-a" });
    expect(everything.candidates.map((candidate) => candidate.relativePath).sort()).toEqual([
      ".kiwi/sessions/run-a/pm-state.json",
      ".kiwi/sessions/run-a/worklog.jsonl",
      ".snoworca/sessions/old/state.json",
      "docs/plan/legacy.plan.md",
      "docs/sds/run-a.sds.md",
      "kiwi/pipeline.jsonl"
    ]);

    const explicitLegacy = await resolveWorkflowArtifacts({ root }, { explicitPath: "docs/plan/legacy.plan.md", runId: "run-a" });
    expect(explicitLegacy.selected).toMatchObject({ relativePath: "docs/plan/legacy.plan.md", kind: "legacy", legacy: true });
  });

  it("FR-NODE-020 AC-3: returns diagnostics for ambiguous ties and outside explicit paths", async () => {
    const root = await tempRoot();
    await write(root, "docs/sds/a.sds.md", sds("v2.3.0"));
    await write(root, "docs/sds/b.sds.md", sds("v2.3.0"));
    const mtime = new Date("2026-06-29T00:00:00Z");
    await utimes(path.join(root, "docs/sds/a.sds.md"), mtime, mtime);
    await utimes(path.join(root, "docs/sds/b.sds.md"), mtime, mtime);

    const ambiguous = await resolveWorkflowArtifacts({ root }, { kind: "sds", target: "v2.3.0" });
    expect(ambiguous.selected).toBeNull();
    expect(ambiguous.diagnostics.map((item) => item.code)).toContain("SRS-E051");

    const outside = await resolveWorkflowArtifacts({ root }, { explicitPath: "../outside.sds.md" });
    expect(outside.selected).toBeNull();
    expect(outside.diagnostics.map((item) => item.code)).toContain("SRS-E050");
  });
});
