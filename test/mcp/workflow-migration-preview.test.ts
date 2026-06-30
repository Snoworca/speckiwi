import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createTestMcpServer } from "../../src/mcp/adapter.js";
import { registerReadTools } from "../../src/mcp/tools/read-tools.js";
import { copyFixtureWorkspace } from "../fixtures/fixture-utils.js";

async function write(root: string, relativePath: string, text: string): Promise<void> {
  const absolutePath = path.join(root, relativePath);
  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, text, "utf8");
}

async function sha256(filePath: string): Promise<string> {
  return createHash("sha256").update(await readFile(filePath)).digest("hex");
}

describe("FR-MCP-034 preview_legacy_workflow_migration", () => {
  it("returns read-only migration previews and rejects apply-style behavior", async () => {
    const root = await copyFixtureWorkspace("valid-basic");
    await write(root, "docs/plan/legacy.plan.md", "---\nrun_id: legacy-run\ntarget: v9.9.9\n---\n# Legacy\n");
    await write(root, ".snoworca/sessions/legacy-run/state.json", JSON.stringify({ run_id: "legacy-run", target: "v9.9.9", legacy_only: true }, null, 2));
    await write(root, ".snoworca/sessions/bad/state.json", "{bad\n");
    const legacyPlanPath = path.join(root, "docs/plan/legacy.plan.md");
    const before = await sha256(legacyPlanPath);
    const server = createTestMcpServer({ root });
    registerReadTools(server, { root });

    await expect(server.callTool("preview_legacy_workflow_migration", { target: "v1.0.0" })).resolves.toMatchObject({
      ok: true,
      value: {
        written: false,
        legacyArtifacts: expect.arrayContaining([
          expect.objectContaining({
            source: expect.objectContaining({ relativePath: "docs/plan/legacy.plan.md", sha256: expect.any(String) }),
            proposedDestination: "docs/plans/legacy.plan.md",
            targetMismatch: true
          }),
          expect.objectContaining({
            source: expect.objectContaining({ relativePath: ".snoworca/sessions/legacy-run/state.json" }),
            unsupportedFields: expect.arrayContaining(["legacy_only"])
          })
        ])
      },
      diagnosticsSummary: { byCode: { "SRS-W050": 1 } }
    });
    expect(await sha256(legacyPlanPath)).toBe(before);

    await expect(server.callTool("preview_legacy_workflow_migration", { runId: "legacy-run", includeBody: true })).resolves.toMatchObject({
      ok: true,
      value: {
        legacyArtifacts: expect.arrayContaining([
          expect.objectContaining({
            source: expect.objectContaining({ body: expect.stringContaining("# Legacy") })
          })
        ])
      }
    });

    await expect(server.callTool("preview_legacy_workflow_migration", { apply: true })).resolves.toMatchObject({
      ok: false,
      written: false,
      error: { code: "UNSUPPORTED_OPERATION" },
      diagnosticsSummary: { errors: 1, byCode: { UNSUPPORTED_OPERATION: 1 } }
    });
  });
});
