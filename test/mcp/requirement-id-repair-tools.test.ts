import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createTestMcpServer } from "../../src/mcp/adapter.js";
import { registerReadTools } from "../../src/mcp/tools/read-tools.js";
import { registerMutationTools } from "../../src/mcp/tools/mutation-tools.js";
import { isReadOnlyTool, toolSchemas } from "../../src/mcp/server.js";
import { copyFixtureWorkspace } from "../fixtures/fixture-utils.js";

interface Occurrence {
  filePath: string;
  headingLine: number;
  blockHash: string;
}

interface DiagnoseResult {
  ok: true;
  value: {
    groups: Array<{
      duplicateId: string;
      occurrences: Occurrence[];
      candidateReplacementIds: string[];
    }>;
  };
  mcpWorkspace: { workspaceRoot: string };
}

function firstGroup(result: unknown): DiagnoseResult["value"]["groups"][number] {
  expect(result).toMatchObject({ ok: true });
  const typed = result as DiagnoseResult;
  const group = typed.value.groups[0];
  if (!group) throw new Error("expected duplicate group");
  return group;
}

describe("FR-MCP-039 Requirement ID collision repair tools", () => {
  it("exposes read-only diagnose and plan tools plus a workspace apply mutation", async () => {
    const root = await copyFixtureWorkspace("duplicate-id");
    const server = createTestMcpServer({ root });
    registerReadTools(server, { root });
    registerMutationTools(server, { root });

    expect(isReadOnlyTool("diagnose_requirement_id_collisions")).toBe(true);
    expect(isReadOnlyTool("plan_requirement_id_collision_repair")).toBe(true);
    expect(isReadOnlyTool("apply_requirement_id_collision_repair")).toBe(false);
    expect(server.toolKinds.apply_requirement_id_collision_repair).toBe("workspace");
    expect(toolSchemas.diagnose_requirement_id_collisions.dryRun?.safeParse(true).success).toBe(true);
    expect(toolSchemas.plan_requirement_id_collision_repair.dryRun?.safeParse(true).success).toBe(true);
    expect(toolSchemas.apply_requirement_id_collision_repair.ignoreLock?.safeParse(true).success).toBe(true);

    const diagnosed = (await server.callTool("diagnose_requirement_id_collisions", {})) as DiagnoseResult;
    expect(diagnosed).toMatchObject({ ok: true, mcpWorkspace: { workspaceRoot: root } });
    const group = firstGroup(diagnosed);

    const plan = await server.callTool("plan_requirement_id_collision_repair", {
      duplicateId: group.duplicateId,
      keep: group.occurrences[0],
      rename: group.occurrences[1],
      allocationStrategy: "next_available",
      dryRun: true
    });
    expect(plan).toMatchObject({ ok: true, value: { replacementId: "FR-ARCH-002", written: false }, mcpWorkspace: { workspaceRoot: root } });

    const applied = await server.callTool("apply_requirement_id_collision_repair", {
      duplicateId: group.duplicateId,
      keep: group.occurrences[0],
      rename: group.occurrences[1],
      allocationStrategy: "next_available"
    });
    expect(applied).toMatchObject({
      ok: true,
      value: { replacementId: "FR-ARCH-002", written: true, completedOperations: 1 },
      mutation: { kind: "repair_requirement_id_collision", written: true },
      mcpWorkspace: { workspaceRoot: root }
    });

    const validation = await server.callTool("validate_spec", {});
    expect(validation).toMatchObject({ ok: true, value: { summary: { byCode: {} } } });
  });

  it("rejects ignoreLock on read-only repair tools and honors it on apply", async () => {
    const root = await copyFixtureWorkspace("duplicate-id");
    const server = createTestMcpServer({ root });
    registerReadTools(server, { root });
    registerMutationTools(server, { root });
    const group = firstGroup(await server.callTool("diagnose_requirement_id_collisions", {}));

    await expect(server.callTool("diagnose_requirement_id_collisions", { ignoreLock: true })).resolves.toMatchObject({ ok: false, error: { code: "USAGE" } });
    await expect(
      server.callTool("plan_requirement_id_collision_repair", {
        duplicateId: group.duplicateId,
        keep: group.occurrences[0],
        rename: group.occurrences[1],
        replacementId: "FR-ARCH-002",
        ignoreLock: true
      })
    ).resolves.toMatchObject({ ok: false, error: { code: "USAGE" } });

    await mkdir(path.join(root, "kiwi"), { recursive: true });
    await writeFile(
      path.join(root, "kiwi/.srs.lock"),
      JSON.stringify({
        schemaVersion: "1.0.0",
        owner: "mcp-test",
        operation: "other_mutation",
        requestId: "repair-mcp",
        acquiredAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 60_000).toISOString()
      }),
      "utf8"
    );

    await expect(
      server.callTool("apply_requirement_id_collision_repair", {
        duplicateId: group.duplicateId,
        keep: group.occurrences[0],
        rename: group.occurrences[1],
        replacementId: "FR-ARCH-002"
      })
    ).resolves.toMatchObject({ ok: false, error: { code: "SRS_LOCKED" } });

    await expect(
      server.callTool("apply_requirement_id_collision_repair", {
        duplicateId: group.duplicateId,
        keep: group.occurrences[0],
        rename: group.occurrences[1],
        replacementId: "FR-ARCH-002",
        ignoreLock: true
      })
    ).resolves.toMatchObject({ ok: true, diagnosticsSummary: { byCode: { "SRS-W067": 1 } } });
  });
});
