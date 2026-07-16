import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  renderToolNames,
  renderToolSchemas,
  renderReadOnlyToolNames,
  renderToolKinds,
  assertZeroDriftToolSurface
} from "../../src/mcp/schemas.js";
import { createMcpServer, isReadOnlyTool } from "../../src/mcp/server.js";
import { copyFixtureWorkspace } from "../fixtures/fixture-utils.js";

// FR-MCP-053 — synthesize_step_srs MCP mutation tool.
//
// Red-phase suite: one test case per acceptance criterion (AC-1..AC-4). The suite
// fails while the MCP server exposes no synthesize_step_srs tool, until the green
// step registers it (registry row + zod schema + handler forwarding to the core
// synthesizeStepSrs engine, FR-NODE-041/FR-NODE-073).
//
// Contract under test (docs/spec/40.mcp-stdio-interface.srs.md FR-MCP-053):
//   - AC-1: callTool writes the step SRS and reports written=true.
//   - AC-2: an existing step SRS is an idempotent no-op (skipped=true).
//   - AC-3: dryRun=true writes nothing.
//   - AC-4: registered mutation tool (not read-only) with appendix documentation
//           and green zero-drift / kind-contract surfaces.

const TOOL = "synthesize_step_srs";
const TASK = "feature-synth-mcp";

function registeredMcpToolNames(): string[] {
  const handle = createMcpServer({});
  return Object.keys(handle.tools)
    .filter((name) => !name.startsWith("resource:"))
    .sort();
}

async function isFile(target: string): Promise<boolean> {
  try {
    return (await stat(target)).isFile();
  } catch {
    return false;
  }
}

async function writeStepArtifacts(root: string, task: string): Promise<void> {
  const stepDir = path.join(root, "docs", "spec", "steps", task);
  await mkdir(stepDir, { recursive: true });
  await writeFile(path.join(stepDir, "intent.md"), "# Intent\n\nSynthesize fixture intent.\n", "utf8");
}

function stepSrsPath(root: string, task: string): string {
  return path.join(root, "docs", "spec", "steps", task, `${task}.srs.md`);
}

describe("FR-MCP-053 — synthesize_step_srs MCP mutation tool", () => {
  it("FR-MCP-053 AC-1: callTool writes the step SRS and reports written=true", async () => {
    const root = await copyFixtureWorkspace("valid-basic");
    await writeStepArtifacts(root, TASK);
    const server = createMcpServer({ root });

    const result = await server.callTool(TOOL, { task: TASK });

    expect(result).toMatchObject({ ok: true });
    expect((result as { ok: true; value: { written: boolean } }).value.written).toBe(true);
    expect(await isFile(stepSrsPath(root, TASK))).toBe(true);
  });

  it("FR-MCP-053 AC-2: an existing step SRS is an idempotent no-op reporting skipped=true", async () => {
    const root = await copyFixtureWorkspace("valid-basic");
    await writeStepArtifacts(root, TASK);
    const server = createMcpServer({ root });

    expect(await server.callTool(TOOL, { task: TASK })).toMatchObject({ ok: true });
    const before = await readFile(stepSrsPath(root, TASK), "utf8");

    const second = await server.callTool(TOOL, { task: TASK });

    expect(second).toMatchObject({ ok: true });
    const value = (second as { ok: true; value: { skipped: boolean; written: boolean } }).value;
    expect(value.skipped).toBe(true);
    expect(value.written).toBe(false);
    expect(await readFile(stepSrsPath(root, TASK), "utf8")).toBe(before);
  });

  it("FR-MCP-053 AC-3: dryRun=true writes nothing", async () => {
    const root = await copyFixtureWorkspace("valid-basic");
    await writeStepArtifacts(root, TASK);
    const server = createMcpServer({ root });

    const result = await server.callTool(TOOL, { task: TASK, dryRun: true });

    expect(result).toMatchObject({ ok: true });
    expect((result as { ok: true; value: { written: boolean } }).value.written).toBe(false);
    expect(await isFile(stepSrsPath(root, TASK))).toBe(false);
  });

  it("FR-MCP-053 AC-4: registered mutation tool with zero-drift surfaces and appendix documentation", async () => {
    const registered = registeredMcpToolNames();
    const toolNames = new Set(renderToolNames());
    const schemas = renderToolSchemas();
    const kinds = renderToolKinds();
    const readOnly = new Set(renderReadOnlyToolNames());

    expect(registered, `${TOOL} must be a registered MCP tool`).toContain(TOOL);
    expect(toolNames.has(TOOL), `${TOOL} must appear in renderToolNames()`).toBe(true);

    const schema = schemas[TOOL];
    expect(schema, `${TOOL} must have a rendered zod input schema`).toBeTypeOf("object");
    expect(schema?.task instanceof z.ZodType, `${TOOL}.task must be a zod schema`).toBe(true);

    expect(["req-scoped", "workspace", "log-append"]).toContain(kinds[TOOL]);
    expect(readOnly.has(TOOL), `${TOOL} must not be in the read-only set`).toBe(false);
    expect(isReadOnlyTool(TOOL), `${TOOL} must not be a read-only tool`).toBe(false);

    expect(() => assertZeroDriftToolSurface()).not.toThrow();

    // Appendix tool-table documentation (REL-FLOW-002 tool-signature parity input).
    const appendix = await readFile(path.join(process.cwd(), "docs", "spec", "90.appendix.md"), "utf8");
    expect(appendix).toContain("`synthesize_step_srs`");
  });
});
