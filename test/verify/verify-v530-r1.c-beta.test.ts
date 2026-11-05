import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ORCHESTRATE_TOOL_BINDINGS } from "../../src/cli/commands/orchestrate.js";
import { GATE_IDS } from "../../src/core/orchestrator/auto-gate.js";
import { createMcpServer } from "../../src/mcp/server.js";

// Independent verification, round 1, bundle c-beta: the CLI and MCP surface of 5.3.0
// (FR-NODE-253, IR-MCP-008, FR-NODE-246/247/252 AC-1). Every test here is red on the tree it was
// written against; each reads the repository and writes nothing.

const REPO = process.cwd();

function registeredTools(): string[] {
  return Object.keys(createMcpServer({ root: REPO }).tools).filter((name) => !name.startsWith("resource:"));
}

const NEW_TOOLS = ["orchestrate_wave_propose", "orchestrate_wave_check", "orchestrate_wave_show", "orchestrate_wave_actions", "orchestrate_preservation_check"];

describe("IR-MCP-008 AC-2 — the tool-count suites follow the new tool set", () => {
  // @req IR-MCP-008 AC-2
  it("the README doc-lint suite pins the number of tools the MCP server registers", async () => {
    const suite = await readFile(path.join(REPO, "test/release/doc-lint.rel-flow-003.test.ts"), "utf8");
    const pinned = /expect\(truth\.toolNames\.size\)\.toBe\((\d+)\)/.exec(suite);
    expect(pinned, "the suite pins a tool count").not.toBeNull();
    expect(Number(pinned?.[1])).toBe(registeredTools().length);
  });

  // @req IR-MCP-008 AC-2
  it("the README's orchestrate_* family count equals the orchestrate_* tools the server registers, in both languages", async () => {
    const readme = await readFile(path.join(REPO, "README.md"), "utf8");
    const orchestrateCount = registeredTools().filter((name) => name.startsWith("orchestrate_")).length;
    const english = /\| (\d+) `orchestrate_\*` tools:/.exec(readme);
    const korean = /`orchestrate_\*` (\d+)개:/.exec(readme);
    expect([Number(english?.[1]), Number(korean?.[1])]).toEqual([orchestrateCount, orchestrateCount]);
  });

  // @req IR-MCP-008 AC-2
  it("every new orchestrate_* tool has a row or an exclusion in the FR-FLOW-167 triage table the triage suite reads", async () => {
    const spec = await readFile(path.join(REPO, "docs/spec/60.workflow-release.srs.md"), "utf8");
    const start = spec.indexOf("### FR-FLOW-167 ");
    const end = spec.indexOf("\n### ", start + 1);
    const block = spec.slice(start, end);
    expect(start).toBeGreaterThan(-1);
    // The table names a tool by its tool name (a row) or by its CLI leaf (the exclusion note), as
    // `orchestrate_wave_status` / `orchestrate wave status` already are.
    const leafOf = new Map(ORCHESTRATE_TOOL_BINDINGS.map((binding) => [binding.tool, `orchestrate ${binding.path.join(" ")}`]));
    expect(block.includes("orchestrate_wave_status") || block.includes("orchestrate wave status")).toBe(true);
    const missing = NEW_TOOLS.filter((tool) => leafOf.has(tool) && !block.includes(tool) && !block.includes(leafOf.get(tool) as string));
    expect(missing).toEqual([]);
  });
});

describe("FR-NODE-247 AC-1 — the gate refusals wave propose raises at exit 2", () => {
  // @req FR-NODE-247 AC-1
  it("the gate-id parity suite pins the size of the GateId union that now carries the two propose refusals", async () => {
    expect(GATE_IDS as readonly string[]).toContain("requirement-cycle-over-cap");
    expect(GATE_IDS as readonly string[]).toContain("requirement-without-live-ac");
    const suite = await readFile(path.join(REPO, "test/release/tool-signature-parity.test.ts"), "utf8");
    const pinned = /expect\(GATE_IDS\)\.toHaveLength\((\d+)\)/.exec(suite);
    expect(pinned, "the suite pins a GateId count").not.toBeNull();
    expect(Number(pinned?.[1])).toBe(GATE_IDS.length);
  });
});
