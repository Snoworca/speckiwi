import { describe, expect, it } from "vitest";
import { createTestMcpServer } from "../../src/mcp/adapter.js";
import { registerMutationTools } from "../../src/mcp/tools/mutation-tools.js";
import { registerReadTools } from "../../src/mcp/tools/read-tools.js";
import { isReadOnlyTool } from "../../src/mcp/server.js";
import { copyFixtureWorkspace } from "../fixtures/fixture-utils.js";

describe("FR-MCP-018 MCP — append_section_note", () => {
  it("registers the tool with kind=req-scoped", async () => {
    const root = await copyFixtureWorkspace("mutation-target");
    const server = createTestMcpServer({ root });
    registerMutationTools(server, { root });
    expect(server.toolKinds.append_section_note).toBe("req-scoped");
  });

  it("appends a note via callTool successfully", async () => {
    const root = await copyFixtureWorkspace("mutation-target");
    const server = createTestMcpServer({ root });
    registerMutationTools(server, { root });
    const result = await server.callTool("append_section_note", {
      id: "FR-ARCH-001",
      section: "rationale",
      text: "MCP path note"
    });
    expect(result).toMatchObject({ ok: true });
  });

  it.each(["verification_evidence", "acceptance_criteria"])(
    "AC-3 deny-list: rejects '%s' through MCP envelope with error.code='MUTATION_DENIED'",
    async (denied) => {
      const root = await copyFixtureWorkspace("mutation-target");
      const server = createTestMcpServer({ root });
      registerMutationTools(server, { root });
      const result = (await server.callTool("append_section_note", {
        id: "FR-ARCH-001",
        section: denied,
        text: "blocked"
      })) as { ok: false; error: { code: string } };
      expect(result.ok).toBe(false);
      expect(result.error.code).toBe("MUTATION_DENIED");
    }
  );

  it("AC-4 boundary: accepts text exactly at 500 UTF-16 code units", async () => {
    const root = await copyFixtureWorkspace("mutation-target");
    const server = createTestMcpServer({ root });
    registerMutationTools(server, { root });
    const result = await server.callTool("append_section_note", {
      id: "FR-ARCH-001",
      section: "rationale",
      text: "x".repeat(500)
    });
    expect(result).toMatchObject({ ok: true });
  });

  it("AC-4 boundary: rejects text at 501 UTF-16 code units", async () => {
    const root = await copyFixtureWorkspace("mutation-target");
    const server = createTestMcpServer({ root });
    registerMutationTools(server, { root });
    const result = await server.callTool("append_section_note", {
      id: "FR-ARCH-001",
      section: "rationale",
      text: "x".repeat(501)
    });
    expect(result).toMatchObject({ ok: false });
  });

  it("AC-4 boundary: rejects surrogate-pair string at 502 UTF-16 code units (=251 codepoints)", async () => {
    const root = await copyFixtureWorkspace("mutation-target");
    const server = createTestMcpServer({ root });
    registerMutationTools(server, { root });
    const result = await server.callTool("append_section_note", {
      id: "FR-ARCH-001",
      section: "rationale",
      text: "𝕏".repeat(251)
    });
    expect(result).toMatchObject({ ok: false });
  });

  it("AC-8 architectural guard: append_section_note MUST NOT be registered by registerReadTools", async () => {
    const root = await copyFixtureWorkspace("mutation-target");
    const server = createTestMcpServer({ root });
    registerReadTools(server, { root });
    expect(server.tools.append_section_note).toBeUndefined();
    expect(server.toolKinds.append_section_note).toBeUndefined();
  });

  it("AC-8: append_section_note is classified non read-only (readOnlyHint=false)", () => {
    expect(isReadOnlyTool("append_section_note")).toBe(false);
  });
});
