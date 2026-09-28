import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createWorkflowFixture } from "../fixtures/workflow-artifacts.js";
import { eventLine, jsonl, runCli, sha256Of, workflowMcp, writeText, type Json } from "../support/workflow-harness.js";

// @req FR-MCP-023 — the MCP workflow reads, and their parity with the CLI reads.

type Artifact = { relativePath: string; kind: string; legacy: boolean; sha256?: string; mtimeMs: number };

async function fileFacts(root: string, relativePath: string): Promise<{ sha256: string; mtimeMs: number }> {
  const absolutePath = path.join(root, relativePath);
  return { sha256: sha256Of(await readFile(absolutePath)), mtimeMs: (await stat(absolutePath)).mtimeMs };
}

describe("FR-MCP-023 AC-4 — the MCP reads keep what a resume decision needs", () => {
  it("FR-MCP-023 AC-4: artifact references carry the sha256 and mtime of the file they name", async () => {
    const fixture = await createWorkflowFixture();
    const { call } = workflowMcp(fixture.root);

    const reads: Array<[string, Json, string]> = [
      ["workflow_pipeline_status", {}, "kiwi/pipeline.jsonl"],
      ["workflow_pipeline_tail", {}, "kiwi/pipeline.jsonl"],
      ["workflow_pipeline_compact", {}, "kiwi/pipeline.jsonl"],
      ["workflow_session_status", { runId: fixture.runId }, `.kiwi/sessions/${fixture.runId}/pm-state.json`],
      ["workflow_worklog_tail", { runId: fixture.runId }, `.kiwi/sessions/${fixture.runId}/worklog.jsonl`],
      ["workflow_resolve_artifact", { path: fixture.sdsPath }, fixture.sdsPath]
    ];
    for (const [name, args, relativePath] of reads) {
      const result = await call(name, args);
      const artifact = (result.artifacts as Artifact[]).find((item) => item.relativePath === relativePath);
      expect(artifact, `${name} lost its artifact reference`).toBeDefined();
      expect({ sha256: artifact!.sha256, mtimeMs: artifact!.mtimeMs }, name).toEqual(await fileFacts(fixture.root, relativePath));
    }
  });

  it("FR-MCP-023 AC-4: the diagnostics of an unreadable line survive with the line they point at", async () => {
    const fixture = await createWorkflowFixture();
    const status = await workflowMcp(fixture.root).call("workflow_pipeline_status", {});
    expect(status.diagnostics).toEqual(expect.arrayContaining([expect.objectContaining({ code: "SRS-W052", filePath: "kiwi/pipeline.jsonl", line: 2 })]));
    expect(status.diagnosticsSummary).toMatchObject({ byCode: { "SRS-W052": 1 } });
    expect((status.value as Json).invalidLines).toEqual([expect.objectContaining({ line: 2, excerpt: "{bad json" })]);
  });

  it("FR-MCP-023 AC-4: a tail carries the cursor that resumes it where it stopped", async () => {
    const fixture = await createWorkflowFixture();
    await writeText(fixture.root, "kiwi/pipeline.jsonl", jsonl(eventLine("run-1"), eventLine("run-2"), eventLine("run-3")));
    const { call } = workflowMcp(fixture.root);

    const first = await call("workflow_pipeline_tail", { limit: 2 });
    expect(first.cursor).toEqual({ limit: 2, returned: 2, total: 3, nextOffset: 2 });
    const rest = await call("workflow_pipeline_tail", { limit: 2, offset: (first.cursor as Json).nextOffset });
    expect(rest.cursor).toEqual({ limit: 2, returned: 1, total: 3, nextOffset: null });
    expect(((rest.value as Json).events as Array<{ event: Json }>).map((entry) => entry.event.run_id)).toEqual(["run-3"]);
  });

  it("FR-MCP-023 AC-4: the reasons a resume is blocked travel with the read — ambiguity names its candidates, the projection its codes", async () => {
    const fixture = await createWorkflowFixture();
    const { call } = workflowMcp(fixture.root);

    const ambiguous = await call("workflow_artifacts_list", { kind: "pm-state", runId: "tie-run" });
    expect((ambiguous.value as Json).selected).toBeNull();
    const tie = (ambiguous.diagnostics as Array<{ code: string; details?: Json }>).find((item) => item.code === "SRS-E051");
    expect(tie?.details?.candidates).toEqual(expect.arrayContaining([
      ".kiwi/sessions/tie-run/lanes/a/pm-state.json",
      ".kiwi/sessions/tie-run/lanes/b/pm-state.json"
    ]));

    const compact = await call("workflow_pipeline_compact", {});
    expect(compact.value).toMatchObject({ blocking: true, outcomeCodes: ["invalid_artifact"] });
  });
});

describe("FR-MCP-023 AC-5 — the MCP and CLI reads answer the same fixture the same way", () => {
  it("FR-MCP-023 AC-5: legacy, ambiguous, invalid-JSONL and current reads are value-, artifact-, cursor- and diagnostic-equal", async () => {
    const fixture = await createWorkflowFixture();
    const { call } = workflowMcp(fixture.root);

    const pairs: Array<{ label: string; cli: string[]; tool: string; args: Json }> = [
      { label: "workspace info", cli: ["workflow", "workspace"], tool: "workflow_workspace_info", args: {} },
      { label: "resolve an artifact", cli: ["workflow", "resolve", "--path", fixture.sdsPath], tool: "workflow_resolve_artifact", args: { path: fixture.sdsPath } },
      { label: "legacy artifact", cli: ["workflow", "latest", "--kind", "legacy"], tool: "workflow_latest_artifact", args: { kind: "legacy" } },
      { label: "all artifacts", cli: ["workflow", "artifacts"], tool: "workflow_artifacts_list", args: {} },
      { label: "ambiguous artifact", cli: ["workflow", "artifacts", "--kind", "pm-state", "--run-id", "tie-run"], tool: "workflow_artifacts_list", args: { kind: "pm-state", runId: "tie-run" } },
      { label: "invalid JSONL status", cli: ["workflow", "pipeline-status"], tool: "workflow_pipeline_status", args: {} },
      { label: "invalid JSONL tail", cli: ["workflow", "pipeline-tail", "--limit", "1", "--offset", "1"], tool: "workflow_pipeline_tail", args: { limit: 1, offset: 1 } },
      { label: "invalid JSONL compact", cli: ["workflow", "pipeline-compact"], tool: "workflow_pipeline_compact", args: {} },
      { label: "pipeline next", cli: ["workflow", "pipeline-next"], tool: "workflow_pipeline_next", args: {} },
      { label: "current session", cli: ["workflow", "session-status", "--run-id", fixture.runId], tool: "workflow_session_status", args: { runId: fixture.runId } },
      { label: "current worklog", cli: ["workflow", "worklog-tail", "--run-id", fixture.runId], tool: "workflow_worklog_tail", args: { runId: fixture.runId } }
    ];
    for (const pair of pairs) {
      const cli = await runCli(fixture.root, pair.cli);
      const mcp = await call(pair.tool, pair.args);
      expect(cli.code, pair.label).toBe(0);
      for (const key of ["ok", "value", "artifacts", "cursor", "diagnostics", "diagnosticsSummary"] as const) {
        expect(mcp[key], `${pair.label}: ${key}`).toEqual(cli.json[key]);
      }
    }
    // The legacy pair is about a legacy artifact, not an empty answer that happens to agree.
    const legacy = await call("workflow_latest_artifact", { kind: "legacy" });
    expect((legacy.value as Json).selected).toMatchObject({ relativePath: "docs/plan/legacy.plan.md", legacy: true, kind: "legacy" });
  });
});
