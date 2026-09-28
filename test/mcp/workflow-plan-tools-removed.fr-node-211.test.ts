import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { PassThrough } from "node:stream";
import type { Command } from "commander";
import { describe, expect, it } from "vitest";
import { buildCommand } from "../../src/cli/command.js";
import { registerMutationCommands } from "../../src/cli/commands/mutations.js";
import { registerReadCommands } from "../../src/cli/commands/read.js";
import { EXPECTED_KIWI_SKILLS } from "../../src/doctor/package-doctor.js";
import { createTestMcpServer } from "../../src/mcp/adapter.js";
import { assertZeroDriftToolSurface, renderCliCommandNames, renderToolNames } from "../../src/mcp/schemas.js";
import { renderAgentInstructionSnippet } from "../../src/core/bootstrap/templates.js";
import { isReadOnlyTool, toolSchemas } from "../../src/mcp/server.js";
import { registerMutationTools } from "../../src/mcp/tools/mutation-tools.js";
import { registerReadTools } from "../../src/mcp/tools/read-tools.js";

// @req FR-NODE-211 — the plan-mode tools, their CLI commands and the workflow validator leave with plan mode,
// while the ToolSpec registry, the MCP schemas and the CLI command tree stay in parity.

const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..");

/** FR-NODE-211 AC-1 names these twelve MCP tools. */
const REMOVED_TOOLS = [
  "workflow_plan_status",
  "workflow_plan_task",
  "workflow_next_plan_task",
  "workflow_resume_hint",
  "workflow_doctor",
  "workflow_diff",
  "workflow_schema_check",
  "workflow_task_check",
  "workflow_task_uncheck",
  "workflow_checklist_set",
  "workflow_task_status_set",
  "preview_legacy_workflow_migration"
] as const;

/** Their CLI commands, all under `speckiwi workflow`. */
const REMOVED_WORKFLOW_COMMANDS = [
  "plan-status",
  "plan-task",
  "next-task",
  "resume-hint",
  "doctor",
  "diff",
  "schema-check",
  "task-check",
  "task-uncheck",
  "checklist-set",
  "task-status-set",
  "migrate-preview"
] as const;

function io() {
  return { stdout: new PassThrough(), stderr: new PassThrough() };
}

function workflowSubcommands(): string[] {
  const program = buildCommand({ io: io() });
  registerReadCommands(program, { io: io() });
  registerMutationCommands(program, { io: io() });
  const workflow = program.commands.find((command: Command) => command.name() === "workflow");
  expect(workflow, "the workflow command group is gone, so this suite has stopped watching anything").toBeDefined();
  return (workflow as Command).commands.map((command) => command.name());
}

async function sourceFiles(dir: string): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const absolute = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...(await sourceFiles(absolute)));
    else if (entry.name.endsWith(".ts")) files.push(absolute);
  }
  return files;
}

describe("FR-NODE-211 AC-1 — the plan-mode tools and their CLI commands are absent, and the surfaces stay in parity", () => {
  it("FR-NODE-211 AC-1: no removed tool is declared by the registry, the MCP schemas or the read-only predicate", () => {
    const registry = renderToolNames();
    const schemas = Object.keys(toolSchemas);
    for (const tool of REMOVED_TOOLS) {
      expect(registry, `${tool} is still in the ToolSpec registry`).not.toContain(tool);
      expect(schemas, `${tool} still has an MCP schema`).not.toContain(tool);
      expect(isReadOnlyTool(tool), `${tool} is still classified read-only`).toBe(false);
    }
  });

  it("FR-NODE-211 AC-1: no removed tool is registered on the MCP server", () => {
    const root = REPO_ROOT;
    const server = createTestMcpServer({ root });
    registerReadTools(server, { root });
    registerMutationTools(server, { root });

    const registered = Object.keys(server.tools);
    expect(registered.length, "nothing registered, so the absence below proves nothing").toBeGreaterThan(0);
    expect(registered).toEqual(expect.arrayContaining(["workflow_pipeline_status", "workflow_pipeline_emit", "get_next_work_order"]));
    for (const tool of REMOVED_TOOLS) expect(registered, `${tool} is still registered`).not.toContain(tool);
  });

  it("FR-NODE-211 AC-1: no removed CLI command is in the workflow command tree or the registry's CLI names", () => {
    const subcommands = workflowSubcommands();
    expect(subcommands).toEqual(expect.arrayContaining(["pipeline-status", "pipeline-emit", "session-status", "work-order"]));
    const registryCli = renderCliCommandNames();
    for (const name of REMOVED_WORKFLOW_COMMANDS) {
      expect(subcommands, `speckiwi workflow ${name} is still registered`).not.toContain(name);
      expect(registryCli, `the registry still names CLI command ${name}`).not.toContain(name);
    }
  });

  it("FR-NODE-211 AC-1: the registry, the MCP schemas and the CLI command tree are in zero-drift parity", () => {
    expect(() => assertZeroDriftToolSurface()).not.toThrow();
  });
});

describe("FR-NODE-211 AC-3 — the workflow validator module is gone", () => {
  it("FR-NODE-211 AC-3: src/core/workflow/validate.ts does not exist and no source file imports it", async () => {
    expect(existsSync(path.join(REPO_ROOT, "src", "core", "workflow", "validate.ts"))).toBe(false);

    const workflowDir = path.join(REPO_ROOT, "src", "core", "workflow");
    const importers: string[] = [];
    for (const file of await sourceFiles(path.join(REPO_ROOT, "src"))) {
      const text = await readFile(file, "utf8");
      const sibling = path.dirname(file) === workflowDir && /from\s+["']\.\/validate(?:\.js)?["']/.test(text);
      if (sibling || /from\s+["'][^"']*\/workflow\/validate(?:\.js)?["']/.test(text)) importers.push(path.relative(REPO_ROOT, file));
    }
    expect(importers).toEqual([]);
  });
});

describe("FR-NODE-211 AC-7 — the package doctor expects kiwi-sds, not kiwi-planner", () => {
  it("FR-NODE-211 AC-7: EXPECTED_KIWI_SKILLS lists kiwi-sds and does not list kiwi-planner", () => {
    expect(EXPECTED_KIWI_SKILLS as readonly string[]).toContain("kiwi-sds");
    expect(EXPECTED_KIWI_SKILLS as readonly string[]).not.toContain("kiwi-planner");
  });
});

describe("FR-NODE-211 AC-1 — the managed agent instructions name no removed tool", () => {
  it("FR-NODE-211 AC-1: the block init writes into CLAUDE.md and AGENTS.md names none of the twelve", () => {
    // The block is installed into every consumer's own instructions, so a removed tool it still names
    // is a tool an agent is told about and cannot call.
    const snippet = renderAgentInstructionSnippet();
    expect(REMOVED_TOOLS.filter((tool) => snippet.includes(tool))).toEqual([]);
  });
});
