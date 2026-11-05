import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { PassThrough } from "node:stream";
import type { Command } from "commander";
import { buildCommand } from "../../src/cli/command.js";
import { ORCHESTRATE_TOOL_BINDINGS, registerOrchestrateCommands } from "../../src/cli/commands/orchestrate.js";
import { createMcpServer, isReadOnlyTool, toolSchemas } from "../../src/mcp/server.js";
import { cleanupFixtures, commitAll, initRepo, rawGit } from "../core/orchestrator/support/git-fixture.js";
import { writeUnder } from "../core/orchestrator/sds-fixtures.js";
import { GRAPH, graphOf, node, orchestrate, waveLine, workGraphWorkspace, type RequirementSpec } from "../cli/wave-graph-fixtures.js";

// IR-MCP-008 — the work-graph MCP tools are generated from the CLI binding table, read-only, answer
// as the CLI answers, and keep the CLI's bounds.

afterAll(cleanupFixtures);

const NEW_TOOLS = ["orchestrate_wave_propose", "orchestrate_wave_check", "orchestrate_wave_show", "orchestrate_wave_actions", "orchestrate_preservation_check"] as const;
const PER_CALL_ROOT = "workspaceRoot";

const REQS: RequirementSpec[] = [
  { id: "FR-ARCH-001", acs: [{ n: 1, checked: true }, { n: 2 }], covers: "all" },
  { id: "FR-ARCH-002", acs: [{ n: 1 }] }
];
const GRAPH_VALUE = graphOf([node(1, ["FR-ARCH-001 AC-1", "FR-ARCH-001 AC-2"], { on_complete: [{ kind: "notify", id: "tell", channel: "team" }] }), node(2, ["FR-ARCH-002 AC-1"])], [{ from: "wave-1", to: "wave-2" }]);

/** What a tool call answers, without what the MCP layer adds beside the CLI's JSON: the exit code and the workspace envelope. */
async function viaMcp(root: string, tool: string, input: Record<string, unknown>): Promise<Record<string, unknown>> {
  const answer = (await createMcpServer({ root }).callTool(tool, input)) as Record<string, unknown>;
  return Object.fromEntries(Object.entries(answer).filter(([key]) => key !== "exitCode" && key !== "mcpWorkspace"));
}

function bindingOf(tool: string) {
  const binding = ORCHESTRATE_TOOL_BINDINGS.find((entry) => entry.tool === tool);
  if (binding === undefined) throw new Error(`${tool} has no binding`);
  return binding;
}

/** The CLI leaf a binding mirrors, walked from the real registrar. */
function leafOf(segments: readonly string[]): Command {
  const io = { stdout: new PassThrough(), stderr: new PassThrough() };
  const program = buildCommand({ io });
  registerOrchestrateCommands(program, { io });
  let current = program.commands.find((sub) => sub.name() === "orchestrate") as Command;
  for (const segment of segments) current = current.commands.find((sub) => sub.name() === segment) as Command;
  return current;
}

async function sourceFiles(directory: string): Promise<string[]> {
  const entries = await readdir(path.join(process.cwd(), directory), { recursive: true });
  return entries.filter((entry) => entry.endsWith(".ts")).map((entry) => path.join(directory, entry));
}

describe("IR-MCP-008 AC-1 generated from the binding table", () => {
  // @req IR-MCP-008 AC-1
  it("IR-MCP-008 AC-1 registers the five tools, each with exactly its CLI leaf's options as input-schema properties", () => {
    const registered = Object.keys(createMcpServer({ root: process.cwd() }).tools);
    for (const tool of [...NEW_TOOLS, "orchestrate_wave_status"]) {
      expect(registered, tool).toContain(tool);
      const leafOptions = leafOf(bindingOf(tool).path).options.filter((option) => option.long !== "--json").map((option) => option.attributeName()).sort();
      expect(Object.keys(toolSchemas[tool] ?? {}).filter((key) => key !== PER_CALL_ROOT).sort(), tool).toEqual(leafOptions);
    }
  });

  // @req IR-MCP-008 AC-1
  it("IR-MCP-008 AC-1 no MCP source names the five tools: their handler is the generated one", async () => {
    for (const file of await sourceFiles("src/mcp")) {
      const source = await readFile(path.join(process.cwd(), file), "utf8");
      for (const tool of NEW_TOOLS) expect(source.includes(tool), `${file} names ${tool}`).toBe(false);
    }
  });

  // @req IR-MCP-008 AC-1
  it("IR-MCP-008 AC-1 wave status, show, actions and check answer over MCP as the CLI answers", async () => {
    const { root } = await workGraphWorkspace({ requirements: REQS, graph: GRAPH_VALUE, lines: [waveLine(1, "complete")], files: { "test/c.test.ts": "// FR-ARCH-001 AC-1\n" } });
    const cases: Array<[string, Record<string, unknown>, string[]]> = [
      ["orchestrate_wave_status", { runId: "r1", withTests: true }, ["wave", "status", "--run-id", "r1", "--with-tests"]],
      ["orchestrate_wave_show", { req: "FR-ARCH-001", full: true }, ["wave", "show", "--req", "FR-ARCH-001", "--full"]],
      ["orchestrate_wave_actions", { runId: "r1" }, ["wave", "actions", "--run-id", "r1"]],
      ["orchestrate_wave_check", { waves: GRAPH, runId: "r1" }, ["wave", "check", "--waves", GRAPH, "--run-id", "r1"]]
    ];
    for (const [tool, input, argv] of cases) {
      const cli = await orchestrate(root, argv);
      expect(await viaMcp(root, tool, input), tool).toEqual(cli.payload);
    }
  });

  // @req IR-MCP-008 AC-1
  it("IR-MCP-008 AC-1 wave propose and preservation check answer over MCP as the CLI answers", async () => {
    const root = await initRepo("ir-mcp-008");
    await writeUnder(root, "src/a.ts", "export const a = 1;\n");
    const base = await commitAll(root, "base");
    await writeUnder(root, "src/a.ts", "export const a = 1;\nexport const b = 2;\n");
    await commitAll(root, "head");
    const preservation = await orchestrate(root, ["preservation", "check", "--base", base]);
    expect(await viaMcp(root, "orchestrate_preservation_check", { base })).toEqual(preservation.payload);

    const { root: proposalRoot } = await workGraphWorkspace({ requirements: REQS, noJournal: true, files: { "files.json": JSON.stringify({ "FR-ARCH-001": ["src/a.ts"] }) } });
    await rawGit(proposalRoot, "init", "--initial-branch", "main");
    await rawGit(proposalRoot, "config", "user.name", "Propose Fixture");
    await rawGit(proposalRoot, "config", "user.email", "propose@example.invalid");
    await rawGit(proposalRoot, "config", "commit.gpgsign", "false");
    await commitAll(proposalRoot, "srs");
    const proposal = await orchestrate(proposalRoot, ["wave", "propose", "--target", "v1.0.0", "--files", "files.json", "--run-id", "r9", "--max-acs", "2"]);
    expect(proposal.exit, JSON.stringify(proposal.payload)).toBe(0);
    expect(await viaMcp(proposalRoot, "orchestrate_wave_propose", { target: "v1.0.0", files: "files.json", runId: "r9", maxAcs: "2" })).toEqual(proposal.payload);
  });
});

describe("IR-MCP-008 AC-2 read-only, and wave status gains its new input", () => {
  // @req IR-MCP-008 AC-2
  it("IR-MCP-008 AC-2 registers all five read-only", () => {
    for (const tool of NEW_TOOLS) {
      expect(bindingOf(tool).kind, tool).toBe("read");
      expect(isReadOnlyTool(tool), tool).toBe(true);
    }
  });

  // @req IR-MCP-008 AC-2
  it("IR-MCP-008 AC-2 orchestrate_wave_status takes the with-tests input", () => {
    const option = bindingOf("orchestrate_wave_status").options.find((entry) => entry.flag === "--with-tests");
    expect(option).toMatchObject({ dest: "withTests", encoding: "boolean" });
    expect(Object.keys(toolSchemas.orchestrate_wave_status ?? {})).toContain("withTests");
  });
});

describe("IR-MCP-008 AC-3 the CLI bounds hold over MCP", () => {
  // @req IR-MCP-008 AC-3
  it("IR-MCP-008 AC-3 orchestrate_wave_check returns 50 diagnostics, and allDiagnostics every one", async () => {
    const many: RequirementSpec = { id: "FR-ARCH-003", acs: Array.from({ length: 60 }, (_, index) => ({ n: index + 1 })) };
    const { root } = await workGraphWorkspace({ requirements: [...REQS, many], graph: GRAPH_VALUE, firstLine: null });
    const bounded = await viaMcp(root, "orchestrate_wave_check", { waves: GRAPH });
    expect(bounded.diagnostics as unknown[]).toHaveLength(50);
    expect(bounded.diagnosticsTruncation).toEqual({ total: 60, returned: 50, limit: 50 });
    const all = await viaMcp(root, "orchestrate_wave_check", { waves: GRAPH, allDiagnostics: true });
    expect(all.diagnostics as unknown[]).toHaveLength(60);
  });

  // @req IR-MCP-008 AC-3
  it("IR-MCP-008 AC-3 orchestrate_wave_show returns 20 journal lines and the first citation per AC, and full every one", async () => {
    const lines = Array.from({ length: 24 }, () => waveLine(1, "in_progress"));
    const { root } = await workGraphWorkspace({ requirements: REQS, graph: GRAPH_VALUE, lines, files: { "test/c.test.ts": "// FR-ARCH-001 AC-1\n// FR-ARCH-001 AC-1\n" } });
    const [bounded] = (await viaMcp(root, "orchestrate_wave_show", { wave: "wave-1" })).nodes as Array<Record<string, unknown>>;
    expect(bounded?.journal as unknown[]).toHaveLength(20);
    expect(bounded?.journal_truncation).toEqual({ total: 25, returned: 20, limit: 20 });
    expect((bounded?.acs as Array<Record<string, unknown>>)[0]).toMatchObject({ cited_count: 2, first_citation: { file: "test/c.test.ts", line: 1 } });
    expect((bounded?.acs as Array<Record<string, unknown>>)[0]).not.toHaveProperty("citations");
    const [full] = (await viaMcp(root, "orchestrate_wave_show", { wave: "wave-1", full: true })).nodes as Array<Record<string, unknown>>;
    expect(full?.journal as unknown[]).toHaveLength(25);
    expect((full?.acs as Array<Record<string, unknown>>)[0]?.citations).toHaveLength(2);
  });
});
