import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  renderToolNames,
  renderToolSchemas,
  renderReadOnlyToolNames,
  renderToolKinds,
  assertZeroDriftToolSurface
} from "../../src/mcp/schemas.js";
import { createMcpServer, isReadOnlyTool } from "../../src/mcp/server.js";
import { copyFixtureWorkspace } from "../fixtures/fixture-utils.js";

// FR-MCP-054 — vibe-gate check core extraction with the check_vibe_gate MCP read tool.
//
// Red-phase suite: one test case per acceptance criterion (AC-1..AC-3; AC-4 is the
// CLI regression covered by the existing IR-CLI-031/072 suites staying green). The
// suite fails while the gate logic lives inline in the CLI and no check_vibe_gate
// tool exists, until the green step extracts the synthesis-presence check into a
// core query function and registers the read-only MCP counterpart.
//
// Contract under test (docs/spec/40.mcp-stdio-interface.srs.md FR-MCP-054):
//   - AC-1: blocked=false for wait/sdd or a satisfied vibe/tdd gate.
//   - AC-2: blocked=true with a blockedReason naming the missing artifact.
//   - AC-3: registered read-only with zero-drift and appendix parity.

const TOOL = "check_vibe_gate";

function registeredMcpToolNames(): string[] {
  const handle = createMcpServer({});
  return Object.keys(handle.tools)
    .filter((name) => !name.startsWith("resource:"))
    .sort();
}

async function writeStateMd(root: string, options: { mode: string; activeTask?: string }): Promise<void> {
  const stepsDir = path.join(root, "docs", "spec", "steps");
  await mkdir(stepsDir, { recursive: true });
  const lines = [
    "# Step State",
    "",
    `Mode: ${options.mode}`,
    ...(options.activeTask !== undefined ? [`Active Task: ${options.activeTask}`] : []),
    "",
    "| Step | Status | DependsOn | TouchesScope | TouchesReq | Created | Updated |",
    "| --- | --- | --- | --- | --- | --- | --- |",
    "| step-a | active | - | ARCH | - | 2026-06-01 | 2026-06-02 |",
    ""
  ];
  await writeFile(path.join(stepsDir, "state.md"), lines.join("\n"), "utf8");
}

async function synthesizeStepDir(root: string, task: string, options: { design?: boolean } = {}): Promise<void> {
  const stepDir = path.join(root, "docs", "spec", "steps", task);
  await mkdir(stepDir, { recursive: true });
  await writeFile(path.join(stepDir, "intent.md"), "# Intent\n", "utf8");
  if (options.design) {
    await writeFile(path.join(stepDir, "design.md"), "# SDS: sample\n", "utf8");
  }
}

describe("FR-MCP-054 — check_vibe_gate MCP read tool", () => {
  it("FR-MCP-054 AC-1: blocked=false for wait/sdd and for a satisfied tdd gate", async () => {
    // wait/sdd pass through regardless of step directories.
    for (const mode of ["wait", "sdd"] as const) {
      const root = await copyFixtureWorkspace("valid-basic");
      await writeStateMd(root, { mode });
      const server = createMcpServer({ root });
      const result = (await server.callTool(TOOL, {})) as { ok: boolean; value: { mode: string; blocked: boolean } };
      expect(result.ok).toBe(true);
      expect(result.value.mode).toBe(mode);
      expect(result.value.blocked).toBe(false);
    }

    // A tdd task with a synthesized step directory and design.md is satisfied.
    const root = await copyFixtureWorkspace("valid-basic");
    await writeStateMd(root, { mode: "tdd", activeTask: "T-TDD-01" });
    await synthesizeStepDir(root, "T-TDD-01", { design: true });
    const server = createMcpServer({ root });
    const result = (await server.callTool(TOOL, {})) as {
      ok: boolean;
      value: { mode: string; activeTask?: string; blocked: boolean };
    };
    expect(result.ok).toBe(true);
    expect(result.value.mode).toBe("tdd");
    expect(result.value.activeTask).toBe("T-TDD-01");
    expect(result.value.blocked).toBe(false);
  });

  it("FR-MCP-054 AC-2: blocked=true names the missing artifact", async () => {
    // tdd + no step directory → blocked, reason names the step directory.
    const noDir = await copyFixtureWorkspace("valid-basic");
    await writeStateMd(noDir, { mode: "tdd", activeTask: "T-TDD-01" });
    const noDirServer = createMcpServer({ root: noDir });
    const noDirResult = (await noDirServer.callTool(TOOL, {})) as {
      ok: boolean;
      value: { blocked: boolean; blockedReason?: string };
    };
    expect(noDirResult.ok).toBe(true);
    expect(noDirResult.value.blocked).toBe(true);
    expect(noDirResult.value.blockedReason).toContain("step directory");

    // tdd + step directory without design.md → blocked, reason names design.md.
    const noDesign = await copyFixtureWorkspace("valid-basic");
    await writeStateMd(noDesign, { mode: "tdd", activeTask: "T-TDD-01" });
    await synthesizeStepDir(noDesign, "T-TDD-01", { design: false });
    const noDesignServer = createMcpServer({ root: noDesign });
    const noDesignResult = (await noDesignServer.callTool(TOOL, {})) as {
      ok: boolean;
      value: { blocked: boolean; blockedReason?: string };
    };
    expect(noDesignResult.ok).toBe(true);
    expect(noDesignResult.value.blocked).toBe(true);
    expect(noDesignResult.value.blockedReason).toContain("design.md");

    // vibe requires only the step directory: a design-less synthesized dir passes.
    const vibe = await copyFixtureWorkspace("valid-basic");
    await writeStateMd(vibe, { mode: "vibe", activeTask: "T-VIBE-01" });
    await synthesizeStepDir(vibe, "T-VIBE-01", { design: false });
    const vibeServer = createMcpServer({ root: vibe });
    const vibeResult = (await vibeServer.callTool(TOOL, {})) as { ok: boolean; value: { blocked: boolean } };
    expect(vibeResult.ok).toBe(true);
    expect(vibeResult.value.blocked).toBe(false);
  });

  it("FR-MCP-054 AC-3: registered read-only with zero-drift and appendix parity", async () => {
    const registered = registeredMcpToolNames();
    const toolNames = new Set(renderToolNames());
    const schemas = renderToolSchemas();
    const kinds = renderToolKinds();
    const readOnly = new Set(renderReadOnlyToolNames());

    expect(registered, `${TOOL} must be a registered MCP tool`).toContain(TOOL);
    expect(toolNames.has(TOOL), `${TOOL} must appear in renderToolNames()`).toBe(true);
    expect(schemas[TOOL], `${TOOL} must have a rendered input schema`).toBeTypeOf("object");

    expect(kinds[TOOL]).toBe("read");
    expect(readOnly.has(TOOL), `${TOOL} must be in the read-only set`).toBe(true);
    expect(isReadOnlyTool(TOOL), `${TOOL} must be a read-only tool`).toBe(true);

    expect(() => assertZeroDriftToolSurface()).not.toThrow();

    const appendix = await readFile(path.join(process.cwd(), "docs", "spec", "90.appendix.md"), "utf8");
    expect(appendix).toContain("`check_vibe_gate`");
  });
});
