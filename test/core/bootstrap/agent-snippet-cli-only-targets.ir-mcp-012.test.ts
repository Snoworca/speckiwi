import { describe, expect, it } from "vitest";
import { renderAgentInstructionSnippet } from "../../../src/core/bootstrap/templates.js";
import { renderToolNames } from "../../../src/mcp/schemas.js";

// @req IR-MCP-012 — the MCP-only rule names every target-scoped mutation that has no MCP tool, so an
// agent following it is never left without a permitted path.

function mcpOnlyRule(): string {
  return renderAgentInstructionSnippet().split("\n").find((line) => line.includes("Normal target-scoped SRS mutations go through MCP only")) ?? "";
}

describe("IR-MCP-012 — the CLI-only target mutations are stated where the MCP-only rule is", () => {
  it("AC-1: renaming a target is a permitted CLI operation, named beside registration and target status", () => {
    const rule = mcpOnlyRule();
    expect(rule).not.toBe("");
    expect(rule).not.toMatch(/single exception/);
    expect(rule).toMatch(/`speckiwi rename-target`/);
    expect(rule).toMatch(/`speckiwi set-target-status`/);
    expect(rule).toMatch(/registering an unregistered target/i);
  });

  it("AC-1: the two named CLI operations really have no MCP tool", () => {
    const names = renderToolNames();
    expect(names).not.toContain("rename_target");
    expect(names).not.toContain("set_target_status");
  });
});
