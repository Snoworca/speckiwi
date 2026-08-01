import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import type { Command } from "commander";
import { describe, expect, it } from "vitest";
import { createMcpServer } from "../../src/mcp/server.js";
import { isReadOnlyTool, toolSchemas } from "../../src/mcp/server.js";
import { toolSpecs } from "../../src/mcp/schemas.js";
import { buildCommand } from "../../src/cli/command.js";
import {
  ORCHESTRATE_MCP_TOOLS,
  ORCHESTRATE_PHASE1_VERB_ROWS,
  ORCHESTRATE_PHASE2_VERB_ROWS,
  ORCHESTRATE_TOOL_BINDINGS,
  orchestrateVerbRow,
  registerOrchestrateCommands
} from "../../src/cli/commands/orchestrate.js";

// @req IR-MCP-003 — the `orchestrate_*` MCP family mirrors the phase-1 CLI namespace, registered
// through the existing schemas/server/{read,mutation}-tools pattern.

const NAMED_IN_REQUIREMENT = [
  "orchestrate_resume",
  "orchestrate_preflight",
  "orchestrate_route_probe",
  "orchestrate_route_freeze",
  "orchestrate_route_show",
  "orchestrate_run_lock",
  "orchestrate_run_abort",
  "orchestrate_journal_append",
  "orchestrate_card_write",
  "orchestrate_freeze",
  "orchestrate_readiness_check",
  "orchestrate_schedule_plan",
  "orchestrate_coupling_check",
  "orchestrate_schedule_show",
  "orchestrate_handoff_validate",
  "orchestrate_round_record",
  // `orchestrate_issue_*` in the requirement, expanded over the row's five alternatives.
  "orchestrate_issue_open",
  "orchestrate_issue_plan",
  "orchestrate_issue_resolve",
  "orchestrate_issue_defer",
  "orchestrate_issue_list",
  "orchestrate_wave_close",
  "orchestrate_duplication_plan",
  "orchestrate_validate",
  "orchestrate_auto_gate"
] as const;

const DEFERRED_TOOLS = [
  "orchestrate_lane_audit",
  "orchestrate_lane_harvest",
  "orchestrate_lane_release",
  "orchestrate_lane_status",
  "orchestrate_replay_plan"
] as const;

async function tempRoot(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), "speckiwi-orchestrate-mcp-"));
}

async function write(root: string, relativePath: string, text: string): Promise<void> {
  const absolute = path.join(root, relativePath);
  await mkdir(path.dirname(absolute), { recursive: true });
  await writeFile(absolute, text, "utf8");
}

function serverToolNames(root: string): string[] {
  return Object.keys(createMcpServer({ root }).tools).filter((name) => !name.startsWith("resource:"));
}

/** The CLI leaf paths under `orchestrate`, walked from the real registrar. */
function cliLeafPaths(): string[][] {
  const io = { stdout: new PassThrough() as NodeJS.WriteStream, stderr: new PassThrough() as NodeJS.WriteStream };
  const command = buildCommand({ io });
  registerOrchestrateCommands(command, { io });
  const root = command.commands.find((sub) => sub.name() === "orchestrate") as Command;
  const leaves: string[][] = [];
  const walk = (cmd: Command, prefix: string[]): void => {
    if (cmd.commands.length === 0) {
      leaves.push(prefix);
      return;
    }
    for (const sub of cmd.commands) walk(sub, [...prefix, sub.name()]);
  };
  walk(root, []);
  return leaves;
}

describe("IR-MCP-003 AC-1 / AC-2 — the family is registered and the five lane tools are not", () => {
  it("registers every orchestrate_* tool the requirement names", async () => {
    const registered = new Set(serverToolNames(await tempRoot()));
    for (const name of NAMED_IN_REQUIREMENT) {
      expect(registered.has(name), `${name} must be registered`).toBe(true);
    }
    expect(NAMED_IN_REQUIREMENT).toHaveLength(25);
  });

  it("registers no deferred lane or replay tool", async () => {
    const registered = new Set(serverToolNames(await tempRoot()));
    for (const name of DEFERRED_TOOLS) {
      expect(registered.has(name), `${name} is phase 2 and must not be registered`).toBe(false);
    }
  });

  it("registers no orchestrate_* tool beyond the named family", async () => {
    const orchestrateTools = serverToolNames(await tempRoot()).filter((name) => name.startsWith("orchestrate_"));
    expect([...orchestrateTools].sort()).toEqual([...NAMED_IN_REQUIREMENT].sort());
  });
});

describe("IR-MCP-003 AC-3 — every tool resolves to a phase-1 CLI verb row, and no phase-2 row has one", () => {
  it("maps each tool onto a registered leaf whose row is a phase-1 row", () => {
    const leafKeys = new Set(cliLeafPaths().map((leaf) => leaf.join(" ")));
    for (const binding of ORCHESTRATE_TOOL_BINDINGS) {
      expect(leafKeys.has(binding.path.join(" ")), `${binding.tool} must name a registered CLI leaf`).toBe(true);
      const row = orchestrateVerbRow(binding.path);
      expect(row, `${binding.tool} must resolve to a verb row`).not.toBeNull();
      expect(ORCHESTRATE_PHASE1_VERB_ROWS).toContain(row);
      expect(ORCHESTRATE_MCP_TOOLS[binding.tool]).toBe(row);
    }
  });

  it("gives no phase-2 verb row an MCP counterpart", () => {
    const mirroredRows = new Set(Object.values(ORCHESTRATE_MCP_TOOLS));
    for (const row of ORCHESTRATE_PHASE2_VERB_ROWS) expect(mirroredRows.has(row)).toBe(false);
  });

  it("classifies every orchestrate tool's read-only hint from its binding kind", () => {
    for (const binding of ORCHESTRATE_TOOL_BINDINGS) {
      expect(isReadOnlyTool(binding.tool), `${binding.tool} read-only classification`).toBe(binding.kind === "read");
    }
  });
});

describe("IR-MCP-003 AC-4 / AC-5 — the mutation envelope, refusal, and dry run", () => {
  it("returns an envelope carrying applied, and a refusal carries applied:false with a gate", async () => {
    const root = await tempRoot();
    await write(root, "kiwi/waves.jsonl", "");
    const server = createMcpServer({ root });

    const accepted = (await server.callTool("orchestrate_journal_append", {
      runId: "run-a",
      payload: { schema_version: "1.4.0", run_id: "run-a", engine: "kiwi-orchestrator", verb: "author-design", kind: "intent", wave: "wave-1" }
    })) as Record<string, unknown>;
    expect(accepted.applied).toBe(true);
    expect(accepted.exitCode).toBe(0);

    const refused = (await server.callTool("orchestrate_journal_append", {
      runId: "run-a",
      payload: { schema_version: "1.4.0", run_id: "run-a", engine: "kiwi-orchestrator", verb: "emit-and-finish", kind: "result", wave: "wave-1", status: "complete" }
    })) as Record<string, unknown>;
    expect(refused.applied).toBe(false);
    expect(typeof refused.gate).toBe("string");
    expect(refused.exitCode).toBe(2);
  });

  it("leaves the target file byte-identical on a dry run, and refuses identically", async () => {
    const root = await tempRoot();
    await write(root, "kiwi/waves.jsonl", "");
    const before = await readFile(path.join(root, "kiwi/waves.jsonl"), "utf8");
    const server = createMcpServer({ root });

    const dryAccepted = (await server.callTool("orchestrate_journal_append", {
      runId: "run-a",
      dryRun: true,
      payload: { schema_version: "1.4.0", run_id: "run-a", engine: "kiwi-orchestrator", verb: "author-design", kind: "intent", wave: "wave-1" }
    })) as Record<string, unknown>;
    expect(dryAccepted.dryRun).toBe(true);
    expect(dryAccepted.exitCode).toBe(0);
    expect(await readFile(path.join(root, "kiwi/waves.jsonl"), "utf8")).toBe(before);

    const dryRefused = (await server.callTool("orchestrate_journal_append", {
      runId: "run-a",
      dryRun: true,
      payload: { schema_version: "1.4.0", run_id: "run-a", engine: "kiwi-orchestrator", verb: "emit-and-finish", kind: "result", wave: "wave-1", status: "complete" }
    })) as Record<string, unknown>;
    expect(dryRefused.applied).toBe(false);
    expect(typeof dryRefused.gate).toBe("string");
    expect(dryRefused.exitCode).toBe(2);
    expect(await readFile(path.join(root, "kiwi/waves.jsonl"), "utf8")).toBe(before);
  });
});

describe("IR-MCP-003 AC-6 — registered through the existing pattern, with no second path", () => {
  it("declares every tool in the ToolSpec registry and gives each an input schema", () => {
    const registryNames = new Set(toolSpecs.map((spec) => spec.mcpName).filter((name): name is string => typeof name === "string"));
    for (const binding of ORCHESTRATE_TOOL_BINDINGS) {
      expect(registryNames.has(binding.tool), `${binding.tool} must be declared in toolSpecs`).toBe(true);
      expect(toolSchemas[binding.tool], `${binding.tool} must declare an input schema in server.ts`).toBeDefined();
    }
  });

  it("declares every binding option as a field of that tool's schema", () => {
    for (const binding of ORCHESTRATE_TOOL_BINDINGS) {
      const shape = Object.keys(toolSchemas[binding.tool] ?? {});
      for (const option of binding.options) {
        expect(shape, `${binding.tool} must accept ${option.dest}`).toContain(option.dest);
      }
      if (binding.selector) expect(shape).toContain(binding.selector.dest);
    }
  });
});
