import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { renderToolKinds, renderToolNames, toolSpecs } from "../../src/mcp/schemas.js";
import { createMcpServer, createSdkServer, isReadOnlyTool, toolSchemas } from "../../src/mcp/server.js";
import { roadmapText } from "../core/roadmap/roadmap-fixture.js";
import { AS_OF, cli, cliJson, DEFAULT_ITEMS, mcp, roadmapFile, roadmapWorkspace, startRequirement, type Answer } from "../cli/roadmap-surface-fixture.js";
import { cleanupFixtures, gitWorkspaceRepo, linkedWorktree, rawGit } from "./support/workspace-root-fixture.js";

// IR-MCP-009 — one MCP tool per `speckiwi roadmap` command, each answering what its command prints
// under --json: the three readers take the per-call workspace root, the three writers refuse it.

const READERS = ["list_roadmap_items", "get_roadmap_item", "check_roadmap"] as const;
const WRITERS = ["add_roadmap_item", "update_roadmap_item", "sync_roadmap_actuals"] as const;
const SIX = [...READERS, ...WRITERS];

const opened: Client[] = [];

async function connect(root: string): Promise<{ call: (tool: string, args?: Record<string, unknown>) => Promise<Answer<Record<string, unknown>>>; tools: Tool[] }> {
  const sdk = createSdkServer(createMcpServer({ root, rootSource: "server-cwd-discovery" }));
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await sdk.connect(serverTransport);
  const client = new Client({ name: "ir-mcp-009", version: "1.0.0" }, { capabilities: {} });
  await client.connect(clientTransport);
  opened.push(client);
  const call = async (tool: string, args: Record<string, unknown> = {}) => {
    const result = (await client.callTool({ name: tool, arguments: args })) as { content: Array<{ type: string; text: string }>; isError?: boolean };
    const text = result.content.find((item) => item.type === "text")?.text ?? "{}";
    // An argument the declared schema refuses is answered by the SDK in prose, not by the tool.
    if (result.isError === true && !text.startsWith("{")) return { ok: false, error: { code: "INVALID_ARGUMENTS", message: text } };
    return JSON.parse(text) as Answer<Record<string, unknown>>;
  };
  return { call, tools: (await client.listTools()).tools };
}

afterAll(async () => {
  for (const client of opened) await client.close();
  await cleanupFixtures();
});

describe("IR-MCP-009 AC-1 — each tool answers what its roadmap command prints", () => {
  // @req IR-MCP-009 AC-1
  it("registers the six tools over tools/list", async () => {
    const root = await roadmapWorkspace();
    const { tools } = await connect(root);
    for (const name of SIX) expect(tools.map((tool) => tool.name), name).toContain(name);
  });

  // @req IR-MCP-009 AC-1
  it.each([
    ["list_roadmap_items", { asOf: AS_OF }, ["list", "--as-of", AS_OF]],
    ["list_roadmap_items", { asOf: AS_OF, status: "paused", kind: "feature", milestone: "RM-1" }, ["list", "--as-of", AS_OF, "--status", "paused", "--kind", "feature", "--milestone", "RM-1"]],
    ["list_roadmap_items", { asOf: AS_OF, target: "v1.0.0" }, ["list", "--as-of", AS_OF, "--target", "v1.0.0"]],
    ["list_roadmap_items", { asOf: AS_OF, limit: 2, offset: 1 }, ["list", "--as-of", AS_OF, "--limit", "2", "--offset", "1"]],
    ["get_roadmap_item", { item: "RM-2", asOf: AS_OF }, ["show", "RM-2", "--as-of", AS_OF]],
    ["check_roadmap", {}, ["check"]]
  ] as const)("%s %j equals the CLI JSON", async (tool, input, args) => {
    const root = await roadmapWorkspace();
    await startRequirement(root);
    const { code, json } = await cliJson(root, ...args);
    expect(code).toBe(0);
    const answer = await mcp(root, tool, { ...input });
    expect(answer.ok, JSON.stringify(answer).slice(0, 300)).toBe(true);
    expect(answer.value).toEqual(json);
  });

  // @req IR-MCP-009 AC-1
  it("check_roadmap equals the CLI JSON for a roadmap with errors and for none", async () => {
    const broken = await roadmapWorkspace([...DEFAULT_ITEMS, { n: 5, fields: { Kind: "epic" } }]);
    expect((await mcp(broken, "check_roadmap", {})).value).toEqual((await cliJson(broken, "check")).json);
    const absent = await roadmapWorkspace(null);
    expect((await mcp(absent, "check_roadmap", {})).value).toEqual((await cliJson(absent, "check")).json);
  });

  // @req IR-MCP-009 AC-1
  it("refuses a status or kind outside its set as the CLI does", async () => {
    const root = await roadmapWorkspace();
    const { call } = await connect(root);
    for (const input of [{ status: "started" }, { kind: "epic" }]) {
      const answer = await call("list_roadmap_items", input);
      expect(answer.ok, JSON.stringify(answer).slice(0, 200)).toBe(false);
      expect((await cli(root, "list", ...Object.entries(input).flatMap(([key, value]) => [`--${key}`, value]), "--json")).code).not.toBe(0);
    }
  });

  // @req IR-MCP-009 AC-1
  it("get_roadmap_item refuses an unknown ID as the CLI does", async () => {
    const root = await roadmapWorkspace();
    const answer = await mcp(root, "get_roadmap_item", { item: "RM-9" });
    expect(answer.ok).toBe(false);
    expect(answer.error?.code).toBe("NOT_FOUND");
    const refused = await cli(root, "show", "RM-9", "--json");
    expect(refused.code).not.toBe(0);
    expect(JSON.parse(refused.stdout).error.code).toBe("NOT_FOUND");
  });

  // @req IR-MCP-009 AC-1
  it.each([
    ["add_roadmap_item", { kind: "feature", title: "Feature C", milestone: "RM-1", targets: ["v1.0.0"], dependsOn: ["RM-2"], githubIssue: ["#1"], plannedEnd: "2026-Q4", purpose: "Why.", reason: "plan", dryRun: true },
      ["add", "--kind", "feature", "--title", "Feature C", "--milestone", "RM-1", "--targets", "v1.0.0", "--depends-on", "RM-2", "--issue", "#1", "--planned-end", "2026-Q4", "--purpose", "Why.", "--reason", "plan", "--dry-run"]],
    ["add_roadmap_item", { kind: "milestone", title: "From target", fromTarget: "v1.0.0", reason: "import", dryRun: true },
      ["add", "--kind", "milestone", "--title", "From target", "--from-target", "v1.0.0", "--reason", "import", "--dry-run"]],
    ["update_roadmap_item", { item: "RM-2", title: "Feature A2", plannedEnd: "2026-11-20", requirements: [], prd: ["-"], owner: "kim", actualStart: "2026-11-04", lifecycle: "open", reason: "slip", dryRun: true },
      ["update", "RM-2", "--title", "Feature A2", "--planned-end", "2026-11-20", "--requirements", "-", "--prd", "-", "--owner", "kim", "--actual-start", "2026-11-04", "--lifecycle", "open", "--reason", "slip", "--dry-run"]],
    ["update_roadmap_item", { item: "RM-2", owner: "-" }, ["update", "RM-2", "--owner", "-"]],
    ["sync_roadmap_actuals", { asOf: AS_OF }, ["sync", "--as-of", AS_OF]],
    ["sync_roadmap_actuals", { asOf: AS_OF, item: "RM-2" }, ["sync", "--as-of", AS_OF, "--item", "RM-2"]]
  ] as const)("%s %j returns the CLI's value and mutation envelope without writing", async (tool, input, args) => {
    const root = await roadmapWorkspace();
    await startRequirement(root);
    const before = await readFile(roadmapFile(root), "utf8");
    const { code, json } = await cliJson<{ ok: boolean; value: unknown; mutation: unknown }>(root, ...args);
    expect(code).toBe(0);
    const answer = await mcp(root, tool, { ...input });
    expect(answer.ok, JSON.stringify(answer).slice(0, 400)).toBe(true);
    expect(answer.value).toEqual(json.value);
    expect(answer.mutation).toEqual(json.mutation);
    expect(await readFile(roadmapFile(root), "utf8")).toBe(before);
  });

  // @req IR-MCP-009 AC-1
  it("writes the same bytes as the CLI for the same add, update and sync", async () => {
    const viaCli = await roadmapWorkspace();
    const viaMcp = await roadmapWorkspace();
    for (const root of [viaCli, viaMcp]) await startRequirement(root);
    await cli(viaCli, "add", "--kind", "feature", "--title", "Feature C", "--targets", "v1.0.0", "--reason", "plan", "--json");
    await mcp(viaMcp, "add_roadmap_item", { kind: "feature", title: "Feature C", targets: ["v1.0.0"], reason: "plan" });
    await cli(viaCli, "update", "RM-2", "--planned-end", "2026-11-20", "--reason", "slip", "--json");
    await mcp(viaMcp, "update_roadmap_item", { item: "RM-2", plannedEnd: "2026-11-20", reason: "slip" });
    await cli(viaCli, "sync", "--as-of", AS_OF, "--apply", "--json");
    await mcp(viaMcp, "sync_roadmap_actuals", { asOf: AS_OF, apply: true });
    const written = await readFile(roadmapFile(viaCli), "utf8");
    expect(written).toContain("### RM-5 — Feature C");
    expect(written).toContain(`| Actual Start | ${AS_OF} |`);
    expect(await readFile(roadmapFile(viaMcp), "utf8")).toBe(written);
  });

  // @req IR-MCP-009 AC-1
  it("refuses a write the CLI refuses, writing nothing", async () => {
    const root = await roadmapWorkspace();
    const before = await readFile(roadmapFile(root), "utf8");
    const answer = await mcp(root, "update_roadmap_item", { item: "RM-2", plannedEnd: "2026-11-20" });
    expect(answer.ok).toBe(false);
    expect(answer.error?.code).toBe("USAGE");
    const missing = await mcp(root, "add_roadmap_item", { kind: "feature", title: "No reason" });
    expect(missing.ok).toBe(false);
    expect(await readFile(roadmapFile(root), "utf8")).toBe(before);
  });
});

describe("IR-MCP-009 AC-2 — readers take the per-call workspace root, writers refuse it", { timeout: 120_000 }, () => {
  let host = "";
  let worktree = "";
  let call: (tool: string, args?: Record<string, unknown>) => Promise<Answer<Record<string, unknown>>>;
  let tools: Tool[] = [];

  beforeAll(async () => {
    host = await gitWorkspaceRepo("ir-mcp-009-host");
    worktree = await linkedWorktree(host, "ir-mcp-009-wt", "ir-mcp-009");
    await writeFile(roadmapFile(host), roadmapText(DEFAULT_ITEMS[0]!), "utf8");
    await writeFile(roadmapFile(worktree), roadmapText(...DEFAULT_ITEMS.slice(0, 2), { n: 3, fields: { Kind: "epic" } }), "utf8");
    ({ call, tools } = await connect(host));
  }, 120_000);

  afterAll(async () => {
    await rawGit(host, "worktree", "prune").catch(() => "");
  });

  // @req IR-MCP-009 AC-2
  it("registers the readers read-only and the writers as mutations", () => {
    for (const name of READERS) {
      expect(isReadOnlyTool(name), name).toBe(true);
      expect(tools.find((tool) => tool.name === name)?.annotations?.readOnlyHint, name).toBe(true);
      expect(renderToolKinds()[name], name).toBe("read");
    }
    for (const name of WRITERS) {
      expect(isReadOnlyTool(name), name).toBe(false);
      expect(tools.find((tool) => tool.name === name)?.annotations?.readOnlyHint, name).not.toBe(true);
      expect(renderToolKinds()[name], name).toBe("workspace");
    }
  });

  // @req IR-MCP-009 AC-2
  it("advertises workspaceRoot on the readers only", () => {
    for (const name of READERS) expect(toolSchemas[name], name).toHaveProperty("workspaceRoot");
    for (const name of WRITERS) expect(toolSchemas[name], name).not.toHaveProperty("workspaceRoot");
  });

  // @req IR-MCP-009 AC-2
  it("answers each reader from the named worktree, and from the startup root without it", async () => {
    const hostList = await call("list_roadmap_items", { asOf: AS_OF });
    expect((hostList.value?.items as Array<{ id: string }>).map((item) => item.id)).toEqual(["RM-1"]);
    const list = await call("list_roadmap_items", { asOf: AS_OF, workspaceRoot: worktree });
    expect(list.error, JSON.stringify(list.error)).toBeUndefined();
    expect((list.value?.items as Array<{ id: string }>).map((item) => item.id)).toEqual(["RM-1", "RM-2", "RM-3"]);
    expect(list.mcpWorkspace).toMatchObject({ workspaceRoot: worktree, rootSource: "per-call-workspace-root" });

    expect((await call("get_roadmap_item", { item: "RM-2" })).error?.code).toBe("NOT_FOUND");
    const shown = await call("get_roadmap_item", { item: "RM-2", asOf: AS_OF, workspaceRoot: worktree });
    expect((shown.value?.item as { title: string }).title).toBe("Feature A");

    expect((await call("check_roadmap")).value).toMatchObject({ passed: true });
    const checked = await call("check_roadmap", { workspaceRoot: worktree });
    expect(checked.value).toMatchObject({ passed: false });
    expect((checked.value?.diagnostics as Array<{ code: string }>).map((item) => item.code)).toContain("ROADMAP-E004");
  });

  // @req IR-MCP-009 AC-2
  it.each([
    ["add_roadmap_item", { kind: "feature", title: "Nope", reason: "r" }],
    ["update_roadmap_item", { item: "RM-1", owner: "kim" }],
    ["sync_roadmap_actuals", { asOf: AS_OF, apply: true }]
  ] as const)("%s refuses workspaceRoot and writes nothing in either checkout", async (tool, input) => {
    const hostBefore = await readFile(roadmapFile(host), "utf8");
    const worktreeBefore = await readFile(roadmapFile(worktree), "utf8");
    const answer = await call(tool, { ...input, workspaceRoot: worktree });
    expect(answer.ok).toBe(false);
    expect(answer.error?.code).toBe("MCP_WORKSPACE_ROOT_UNSUPPORTED");
    expect(await readFile(roadmapFile(host), "utf8")).toBe(hostBefore);
    expect(await readFile(roadmapFile(worktree), "utf8")).toBe(worktreeBefore);
  });
});

describe("IR-MCP-009 AC-3 — sync writes only under apply, and the surface suites count the six", () => {
  // @req IR-MCP-009 AC-3
  it("writes nothing unless apply is true", async () => {
    const root = await roadmapWorkspace();
    await startRequirement(root);
    const before = await readFile(roadmapFile(root), "utf8");
    for (const input of [{ asOf: AS_OF }, { asOf: AS_OF, apply: false }]) {
      const answer = await mcp<{ dryRun: boolean; written: boolean; proposals: unknown[] }>(root, "sync_roadmap_actuals", input);
      expect(answer.ok).toBe(true);
      expect(answer.value).toMatchObject({ dryRun: true, written: false });
      expect(answer.value?.proposals).toHaveLength(2);
      expect(await readFile(roadmapFile(root), "utf8")).toBe(before);
    }
    const applied = await mcp<{ written: boolean }>(root, "sync_roadmap_actuals", { asOf: AS_OF, apply: true });
    expect(applied.value?.written).toBe(true);
    expect(await readFile(roadmapFile(root), "utf8")).not.toBe(before);
  });

  // @req IR-MCP-009 AC-3
  it("declares the six in the registry the parity and count suites read, once each, beside their CLI leaf", () => {
    for (const name of SIX) expect(renderToolNames(), name).toContain(name);
    const leaves = Object.fromEntries(toolSpecs.filter((spec) => spec.mcpName && (SIX as readonly string[]).includes(spec.mcpName)).map((spec) => [spec.mcpName, spec.cliName]));
    expect(leaves).toEqual({
      list_roadmap_items: "list",
      get_roadmap_item: "show",
      check_roadmap: "check",
      add_roadmap_item: "add",
      update_roadmap_item: "update",
      sync_roadmap_actuals: "sync"
    });
    expect(toolSpecs.some((spec) => spec.cliName === "roadmap" && spec.mcpName === undefined)).toBe(true);
  });

  // @req IR-MCP-009 AC-3
  it("does not create docs/roadmap.md on a read of a workspace without one", async () => {
    const root = await roadmapWorkspace(null);
    for (const tool of READERS) await mcp(root, tool, tool === "get_roadmap_item" ? { item: "RM-1" } : {});
    await mcp(root, "sync_roadmap_actuals", { apply: true });
    expect(existsSync(path.join(root, "docs", "roadmap.md"))).toBe(false);
  });
});

describe("IR-MCP-009 AC-1 — the date inputs of update answer alike on both surfaces", () => {
  // One item whose four date cells all hold a value, so `-` and a new day are each a change.
  const DATED = [
    {
      n: 1,
      title: "Dated item",
      fields: { "Planned Start": "2026-11", "Planned End": "2026-11-20", "Actual Start": "2026-11-01", "Actual End": "2026-11-02" }
    }
  ];
  const FIELDS = [
    { dest: "actualStart", flag: "--actual-start", day: "2026-10-30", invalid: "2026-11" },
    { dest: "actualEnd", flag: "--actual-end", day: "2026-11-04", invalid: "2026-11" },
    { dest: "plannedStart", flag: "--planned-start", day: "2026-11-05", invalid: "2026-Q5" },
    { dest: "plannedEnd", flag: "--planned-end", day: "2026-11-25", invalid: "2026-13" }
  ] as const;
  const withoutWorkspace = (answer: Record<string, unknown>) => Object.fromEntries(Object.entries(answer).filter(([key]) => key !== "mcpWorkspace"));

  // @req IR-MCP-009 AC-1 IR-CLI-115 AC-4
  it.each(FIELDS.flatMap((field) => [[field.dest, field.flag, "-"], [field.dest, field.flag, field.day]] as const))(
    "%s %s %s: the CLI exits 0 and prints the tool's answer, and both write the same bytes",
    async (dest, flag, value) => {
      const viaCli = await roadmapWorkspace(DATED);
      const viaMcp = await roadmapWorkspace(DATED);
      const printed = await cli(viaCli, "update", "RM-1", flag, value, "--reason", "corrected", "--json");
      const answer = await mcp(viaMcp, "update_roadmap_item", { item: "RM-1", [dest]: value, reason: "corrected" });
      expect(answer.ok, JSON.stringify(answer).slice(0, 300)).toBe(true);
      expect({ code: printed.code, answer: printed.code === 0 ? JSON.parse(printed.stdout) : printed.stdout + printed.stderr }).toEqual({
        code: 0,
        answer: withoutWorkspace(answer as unknown as Record<string, unknown>)
      });
      expect(await readFile(roadmapFile(viaMcp), "utf8")).toBe(await readFile(roadmapFile(viaCli), "utf8"));
    }
  );

  // @req IR-MCP-009 AC-1 IR-CLI-115 AC-4
  it.each(FIELDS.map((field) => [field.dest, field.flag, field.invalid] as const))(
    "%s %s %s: both surfaces refuse the value before the core runs, naming it, and write nothing",
    async (dest, flag, value) => {
      const root = await roadmapWorkspace(DATED);
      const before = await readFile(roadmapFile(root), "utf8");
      const printed = await cli(root, "update", "RM-1", flag, value, "--reason", "corrected", "--json");
      expect(printed.code).toBe(2);
      expect(printed.stdout + printed.stderr).toContain(value);
      const { call } = await connect(root);
      const answer = await call("update_roadmap_item", { item: "RM-1", [dest]: value, reason: "corrected" });
      expect(answer.ok).toBe(false);
      expect(answer.error?.code).toBe("INVALID_ARGUMENTS");
      expect(answer.error?.message).toContain(dest);
      expect(await readFile(roadmapFile(root), "utf8")).toBe(before);
    }
  );
});
