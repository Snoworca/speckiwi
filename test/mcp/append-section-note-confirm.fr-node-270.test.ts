import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createTestMcpServer } from "../../src/mcp/adapter.js";
import { registerMutationTools } from "../../src/mcp/tools/mutation-tools.js";
import { sdkToolInputSchema } from "../../src/mcp/server.js";
import { findSpecByCliName } from "../../src/mcp/schemas.js";
import { copyFixtureWorkspace } from "../fixtures/fixture-utils.js";

// @req FR-NODE-270 — the MCP surface of the replace confirmation.

const ARCH_FILE = path.join("docs", "spec", "10.product-architecture.srs.md");

interface ToolResult {
  ok: boolean;
  value?: { written?: boolean; removedItems?: number; removedLines?: string[] };
  error?: { code?: string; message?: string };
}

async function twoNotes(): Promise<string> {
  const root = await copyFixtureWorkspace("mutation-target");
  const file = path.join(root, ARCH_FILE);
  const original = await readFile(file, "utf8");
  await writeFile(file, original.replace("#### Implementation Notes\n\n- src/core/mutation\n", "#### Implementation Notes\n\n- note a\n- note b\n"), "utf8");
  return root;
}

describe("FR-NODE-270 AC-5 — MCP confirmReplace", () => {
  // @req FR-NODE-270 AC-5
  it("confirmReplace: true writes the replacement and reports the removed items", async () => {
    const root = await twoNotes();
    const server = createTestMcpServer({ root });
    registerMutationTools(server, { root });
    const args = { id: "FR-ARCH-001", section: "implementation_notes", text: "only one", mode: "replace" };

    const refused = (await server.callTool("append_section_note", args)) as ToolResult;
    const confirmed = (await server.callTool("append_section_note", { ...args, confirmReplace: true })) as ToolResult;

    expect(refused.ok).toBe(false);
    expect(refused.error?.code).toBe("USAGE");
    expect(confirmed.ok).toBe(true);
    expect(confirmed.value?.written).toBe(true);
    expect(confirmed.value?.removedItems).toBe(2);
    expect(confirmed.value?.removedLines).toEqual(["- note a", "- note b"]);
  });
});

describe("FR-NODE-270 AC-8 — MCP input shape and description", () => {
  // @req FR-NODE-270 AC-8
  it("declares confirmReplace as an optional boolean", () => {
    const schema = sdkToolInputSchema("append_section_note");
    const base = { id: "FR-ARCH-001", section: "implementation_notes", text: "x", mode: "replace" };

    expect(schema.safeParse(base).success).toBe(true);
    expect(schema.safeParse({ ...base, confirmReplace: true }).success).toBe(true);
    expect(schema.safeParse({ ...base, confirmReplace: "yes" }).success).toBe(false);
  });

  // @req FR-NODE-270 AC-8
  it("the tool description says that a replace removing an item needs confirmReplace", () => {
    const description = findSpecByCliName("append-note")?.description ?? "";
    expect(description).toContain("confirmReplace");
  });
});
