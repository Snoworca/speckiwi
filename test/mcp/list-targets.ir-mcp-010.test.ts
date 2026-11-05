import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { PassThrough } from "node:stream";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { main } from "../../src/cli/index.js";
import { splitDiagnostics, summarizeDiagnostics } from "../../src/core/diagnostic.js";
import { parseWorkspace } from "../../src/core/parser/workspace-parser.js";
import { resolveProjectRoot } from "../../src/core/project-root.js";
import { validateWorkspace } from "../../src/core/validator/validate-workspace.js";
import { MCP_READ_DIAGNOSTICS_LIMIT } from "../../src/mcp/read-diagnostics.js";
import { createMcpServer, createSdkServer, isReadOnlyTool } from "../../src/mcp/server.js";
import { copyFixtureWorkspace } from "../fixtures/fixture-utils.js";
import { cleanupFixtures, gitWorkspaceRepo, linkedWorktree, rawGit } from "./support/workspace-root-fixture.js";

// IR-MCP-010 — `get_active_target` was the only MCP target reader, so an agent resolving a list of
// targets had to shell out to `speckiwi targets`. Calls go through an SDK client so the arguments must
// survive the tool's declared schema to reach the handler.

interface Answer {
  ok?: boolean;
  value?: Record<string, unknown>;
  error?: { code?: string; reason?: string };
  mcpWorkspace?: { workspaceRoot?: string; rootSource?: string };
}

const TOOL = "list_targets";
const opened: Client[] = [];

async function connect(root: string): Promise<{ call: (args?: Record<string, unknown>) => Promise<Answer>; tools: Tool[] }> {
  const sdk = createSdkServer(createMcpServer({ root, rootSource: "server-cwd-discovery" }));
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await sdk.connect(serverTransport);
  const client = new Client({ name: "ir-mcp-010", version: "1.0.0" }, { capabilities: {} });
  await client.connect(clientTransport);
  opened.push(client);
  const call = async (args: Record<string, unknown> = {}): Promise<Answer> => {
    const result = (await client.callTool({ name: TOOL, arguments: args })) as { content: Array<{ type: string; text: string }> };
    return JSON.parse(result.content.find((item) => item.type === "text")?.text ?? "{}") as Answer;
  };
  return { call, tools: (await client.listTools()).tools };
}

async function cliTargets(root: string): Promise<Record<string, unknown>> {
  const io = { stdout: new PassThrough(), stderr: new PassThrough() };
  const code = await main(["--root", root, "targets", "--json"], io);
  expect(code, "speckiwi targets --json must succeed").toBe(0);
  return JSON.parse(io.stdout.read()?.toString() ?? "{}") as Record<string, unknown>;
}

afterAll(async () => {
  for (const client of opened) await client.close();
  await cleanupFixtures();
});

describe("IR-MCP-010 AC-1 — list_targets answers what speckiwi targets --json answers", () => {
  // @req IR-MCP-010 AC-1
  it("is registered and advertised as read-only", async () => {
    const root = await copyFixtureWorkspace("mutation-target");
    const { tools } = await connect(root);
    const tool = tools.find((candidate) => candidate.name === TOOL);
    expect(tool, `${TOOL} must be listed by tools/list`).toBeDefined();
    expect(tool?.annotations?.readOnlyHint).toBe(true);
    expect(isReadOnlyTool(TOOL)).toBe(true);
  });

  // @req IR-MCP-010 AC-1
  it.each(["mutation-target", "problem-matrix", "valid-basic"])("returns the same targets and per-target summaries for %s, and writes nothing", async (fixture) => {
    const root = await copyFixtureWorkspace(fixture);
    const indexPath = path.join(root, "docs", "spec", "00.index.md");
    const before = await readFile(indexPath, "utf8");
    const { call } = await connect(root);

    const answer = await call({ includeAllDiagnostics: true });
    const cli = await cliTargets(root);

    expect(answer.ok, JSON.stringify(answer).slice(0, 300)).toBe(true);
    const targets = answer.value?.targets as Array<{ target: string; summary: unknown }>;
    expect(targets.length, "the fixture registers targets").toBeGreaterThan(0);
    expect(targets.every((entry) => entry.summary !== undefined), "each target carries its summary").toBe(true);
    expect(answer.value?.activeTarget).toEqual(cli.activeTarget);
    expect(targets).toEqual(cli.targets);
    await expect(readFile(indexPath, "utf8")).resolves.toBe(before);
  });

  // @req IR-MCP-010 AC-1 — the Active Target is the one the index names, not the first row.
  it("names the Active Target the index records when it is not the first Target Map row", async () => {
    const root = await copyFixtureWorkspace("mutation-target");
    const indexPath = path.join(root, "docs", "spec", "00.index.md");
    const moved = (await readFile(indexPath, "utf8"))
      .replace("| Active Target | v1.0.0 |", "| Active Target | v1.1.0 |")
      .replace("| v1.0.0 | release | active |", "| v1.0.0 | release | planned |")
      .replace("| v1.1.0 | version | planned |", "| v1.1.0 | version | active |");
    await writeFile(indexPath, moved, "utf8");
    const { call } = await connect(root);

    const answer = await call();

    expect(answer.value?.activeTarget).toBe("v1.1.0");
    expect((await cliTargets(root)).activeTarget).toBe("v1.1.0");
  });
});

describe("IR-MCP-010 AC-2 — bounded diagnostics", () => {
  let call: (args?: Record<string, unknown>) => Promise<Answer>;
  let description = "";
  let total = 0;
  let fullSummary: unknown;

  beforeAll(async () => {
    const root = await copyFixtureWorkspace("problem-matrix");
    const workspace = await parseWorkspace(await resolveProjectRoot(process.cwd(), root));
    const all = [...workspace.diagnostics, ...validateWorkspace(workspace).diagnostics];
    total = splitDiagnostics(all).diagnostics.length;
    fullSummary = summarizeDiagnostics(all);
    expect(total, "the fixture must hold more diagnostics than the default limit").toBeGreaterThan(MCP_READ_DIAGNOSTICS_LIMIT);
    const connected = await connect(root);
    call = connected.call;
    description = connected.tools.find((tool) => tool.name === TOOL)?.description ?? "";
  });

  // @req IR-MCP-010 AC-2
  it("bounds the entries to 20 by default while diagnosticsSummary counts all of them", async () => {
    const answer = await call();
    expect(answer.value?.diagnostics).toHaveLength(MCP_READ_DIAGNOSTICS_LIMIT);
    expect(answer.value?.diagnosticsTruncation).toEqual({ total, returned: MCP_READ_DIAGNOSTICS_LIMIT, limit: MCP_READ_DIAGNOSTICS_LIMIT });
    expect(answer.value?.diagnosticsSummary).toEqual(fullSummary);
    expect(description).toContain(`${MCP_READ_DIAGNOSTICS_LIMIT} entries`);
    expect(description).toContain("includeAllDiagnostics");
  });

  // @req IR-MCP-010 AC-2
  it("returns every entry when includeAllDiagnostics is true", async () => {
    const answer = await call({ includeAllDiagnostics: true });
    expect(answer.value?.diagnostics).toHaveLength(total);
    expect(answer.value?.diagnosticsTruncation).toBeUndefined();
    expect(answer.value?.diagnosticsSummary).toEqual(fullSummary);
  });
});

describe("IR-MCP-010 AC-2 — the per-call workspace root", { timeout: 120_000 }, () => {
  const WORKTREE_TARGET = "v9.9.9-WT";
  let host = "";
  let worktree = "";
  let call: (args?: Record<string, unknown>) => Promise<Answer>;

  beforeAll(async () => {
    host = await gitWorkspaceRepo("ir-mcp-010-host");
    worktree = await linkedWorktree(host, "ir-mcp-010-wt", "ir-mcp-010");
    const indexPath = path.join(worktree, "docs", "spec", "00.index.md");
    await writeFile(indexPath, (await readFile(indexPath, "utf8")).split("v1.0.0").join(WORKTREE_TARGET), "utf8");
    call = (await connect(host)).call;
  }, 120_000);

  afterAll(async () => {
    await rawGit(host, "worktree", "prune").catch(() => "");
  });

  const names = (answer: Answer): string[] => ((answer.value?.targets ?? []) as Array<{ target: string }>).map((entry) => entry.target);

  // @req IR-MCP-010 AC-2
  it("answers from the startup root when the argument is omitted", async () => {
    const answer = await call();
    expect(names(answer)).toContain("v1.0.0");
    expect(names(answer)).not.toContain(WORKTREE_TARGET);
    expect(answer.mcpWorkspace).toMatchObject({ workspaceRoot: host, rootSource: "server-cwd-discovery" });
  });

  // @req IR-MCP-010 AC-2
  it("answers from the named worktree, in its content and in its envelope", async () => {
    const answer = await call({ workspaceRoot: worktree });
    expect(answer.error, "the call must not be refused").toBeUndefined();
    expect(answer.value?.activeTarget).toBe(WORKTREE_TARGET);
    expect(names(answer)).toContain(WORKTREE_TARGET);
    expect(names(answer)).not.toContain("v1.0.0");
    expect(answer.mcpWorkspace).toMatchObject({ workspaceRoot: worktree, rootSource: "per-call-workspace-root" });
    expect(await cliTargets(worktree)).toMatchObject({ activeTarget: answer.value?.activeTarget, targets: answer.value?.targets });
  });
});
