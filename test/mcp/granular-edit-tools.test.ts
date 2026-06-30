import { describe, expect, it } from "vitest";
import { createTestMcpServer } from "../../src/mcp/adapter.js";
import { addVerificationEvidence } from "../../src/core/mutation/add-evidence.js";
import { resolveProjectRoot } from "../../src/core/project-root.js";
import { registerMutationTools } from "../../src/mcp/tools/mutation-tools.js";
import { registerReadTools } from "../../src/mcp/tools/read-tools.js";
import { toolSchemas } from "../../src/mcp/server.js";
import { copyFixtureWorkspace } from "../fixtures/fixture-utils.js";

describe("FR-NODE-019 MCP granular edit tools", () => {
  it("updates fields, replaces ACs, and edits evidence rows through req-scoped mutation tools", async () => {
    const root = await copyFixtureWorkspace("mutation-target");
    const server = createTestMcpServer({ root });
    registerReadTools(server, { root });
    registerMutationTools(server, { root });

    expect(toolSchemas.edit_requirement_fields.id?.safeParse("FR-ARCH-001").success).toBe(true);
    expect(server.toolKinds.edit_requirement_fields).toBe("req-scoped");
    expect(server.toolKinds.replace_acceptance_criteria).toBe("req-scoped");
    expect(server.toolKinds.edit_requirement_table_rows).toBe("req-scoped");

    await expect(
      server.callTool("edit_requirement_fields", {
        id: "FR-ARCH-001",
        title: "MCP edited requirement",
        statement: "MCP edits structured requirement text.",
        priority: "medium"
      })
    ).resolves.toMatchObject({ ok: true, value: { written: true } });

    await expect(
      server.callTool("replace_acceptance_criteria", {
        id: "FR-ARCH-001",
        items: [{ text: "MCP criterion one", checked: true }, { text: "MCP criterion two" }]
      })
    ).resolves.toMatchObject({ ok: true, value: { written: true } });

    await addVerificationEvidence(await resolveProjectRoot(root), { id: "FR-ARCH-001", type: "test", reference: "old.ts", covers: "all", notes: "-" });
    await expect(
      server.callTool("edit_requirement_table_rows", {
        id: "FR-ARCH-001",
        section: "verification_evidence",
        operations: [{ kind: "update", rowId: "VE-1", values: { reference: "test/mcp/granular-edit-tools.test.ts" } }]
      })
    ).resolves.toMatchObject({ ok: true, value: { written: true } });

    const shown = await server.callTool("get_requirement", { id: "FR-ARCH-001" });
    expect(shown).toMatchObject({
      ok: true,
      value: {
        title: "MCP edited requirement",
        acceptanceCriteria: [expect.objectContaining({ id: "AC-1", checked: true }), expect.objectContaining({ id: "AC-2" })],
        verificationEvidence: [expect.objectContaining({ reference: "test/mcp/granular-edit-tools.test.ts" })]
      }
    });
  });
});
