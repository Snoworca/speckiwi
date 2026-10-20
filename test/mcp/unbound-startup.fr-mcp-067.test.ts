import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { createMcpServer, decideMcpStartupFrom } from "../../src/mcp/server.js";
import { renderToolNames } from "../../src/mcp/schemas.js";

const execFileAsync = promisify(execFile);
const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..");
const BIN = path.join(REPO_ROOT, "bin", "speckiwi");

/**
 * FR-MCP-067 — an MCP server whose startup search finds no SRS stays unbound: it writes nothing and
 * refuses every call.
 *
 * Every case runs under a temporary home: HOME, USERPROFILE, HOMEDRIVE and HOMEPATH point at a fresh
 * directory, so the upward search stops there and never reaches the real home directory or any stray
 * index in it. Nothing outside the temporary directories is read, written or deleted.
 */

let scratch = "";

beforeAll(async () => {
  scratch = await realpath(await mkdtemp(path.join(tmpdir(), "speckiwi-unbound-")));
  // The stdio cases run the built server, so build it from the current sources.
  await execFileAsync(process.execPath, [path.join(REPO_ROOT, "node_modules", "typescript", "bin", "tsc"), "-p", "tsconfig.json"], { cwd: REPO_ROOT });
}, 300_000);

afterAll(async () => {
  if (scratch) await rm(scratch, { recursive: true, force: true });
});

function homeEnv(home: string): Record<string, string> {
  const parsed = path.parse(home);
  return {
    ...(process.env as Record<string, string>),
    HOME: home,
    USERPROFILE: home,
    HOMEDRIVE: parsed.root.replace(/\\$/, ""),
    HOMEPATH: home.slice(parsed.root.length - 1)
  };
}

/** Every file below `dir`, with its bytes, so "byte-identical" is checked rather than assumed. */
async function snapshot(dir: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  const walk = async (current: string): Promise<void> => {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        out[`${path.relative(dir, full)}/`] = "";
        await walk(full);
      } else {
        out[path.relative(dir, full)] = await readFile(full, "base64");
      }
    }
  };
  await walk(dir);
  return out;
}

async function stdioClient(cwd: string, home: string): Promise<Client> {
  const transport = new StdioClientTransport({ command: process.execPath, args: [BIN, "mcp"], cwd, env: homeEnv(home), stderr: "pipe" });
  const client = new Client({ name: "speckiwi-unbound-test", version: "1.0.0" }, { capabilities: {} });
  await client.connect(transport);
  return client;
}

function parseText(result: unknown): Record<string, unknown> {
  const first = (result as { content?: Array<{ type: string; text?: string }> }).content?.[0];
  return JSON.parse(first?.type === "text" ? (first.text ?? "{}") : "{}") as Record<string, unknown>;
}

function expectUnboundRefusal(answer: unknown, checkedCwd: string): void {
  expect(answer).toMatchObject({
    ok: false,
    error: { code: "MCP_WORKSPACE_UNBOUND" },
    mcpWorkspace: { workspaceRoot: null, rootSource: "unbound", indexPath: null, packageVersion: expect.any(String), checkedCwd }
  });
  const diagnostics = (answer as { diagnostics?: Array<{ code: string; severity: string }> }).diagnostics ?? [];
  expect(diagnostics).toHaveLength(1);
  expect(diagnostics[0]).toMatchObject({ code: "SRS-E077", severity: "error" });
}

async function freshHome(name: string): Promise<{ home: string; cwd: string }> {
  const home = path.join(scratch, name, "home");
  const cwd = path.join(home, "work", "empty");
  await mkdir(cwd, { recursive: true });
  return { home, cwd };
}

describe("FR-MCP-067 AC-1 — a stdio server started in an empty directory under a temporary home", () => {
  it("FR-MCP-067 AC-1: starts, lists every registered tool, and leaves the tree byte-identical", async () => {
    const { home, cwd } = await freshHome("ac1");
    const before = await snapshot(home);
    const client = await stdioClient(cwd, home);
    try {
      const listed = (await client.listTools()).tools.map((tool) => tool.name).sort();
      expect(listed).toEqual([...renderToolNames()].sort());
      expectUnboundRefusal(parseText(await client.callTool({ name: "mcp_workspace_info", arguments: {} })), cwd);
    } finally {
      await client.close();
    }
    expect(await snapshot(home)).toEqual(before);
  }, 60_000);
});

describe("FR-MCP-067 AC-2 — the search seam: no index between the start and the ceiling is unbound", () => {
  it("FR-MCP-067 AC-2: a start outside home with no index below the ceiling gives an unbound decision", async () => {
    const base = path.join(scratch, "ac2");
    const home = path.join(base, "home");
    const ceiling = path.join(base, "outside");
    const start = path.join(ceiling, "proj", "deep");
    await mkdir(home, { recursive: true });
    await mkdir(start, { recursive: true });
    // An index above the ceiling exists and must not be reached.
    await mkdir(path.join(base, "docs", "spec"), { recursive: true });
    await writeFile(path.join(base, "docs", "spec", "00.index.md"), "# above the ceiling\n", "utf8");

    const decision = await decideMcpStartupFrom(start, { home, ceiling });
    expect(decision).toMatchObject({ bound: false, checkedCwd: start });

    // Control: an index between the start and the ceiling binds.
    await mkdir(path.join(ceiling, "proj", "docs", "spec"), { recursive: true });
    await writeFile(path.join(ceiling, "proj", "docs", "spec", "00.index.md"), "# project\n", "utf8");
    expect(await decideMcpStartupFrom(start, { home, ceiling })).toMatchObject({ bound: true, root: path.join(ceiling, "proj") });
  });

  it("FR-MCP-067 AC-2: the seam is not a startup surface", async () => {
    const server = await import("../../src/mcp/server.js");
    expect(server.startMcpServer.length).toBeLessThanOrEqual(1);
    expect(server.resolveMcpStartupRoot.length).toBe(0);
  });
});

describe("FR-MCP-067 AC-3 — a server whose working directory is the home directory", () => {
  for (const stray of [false, true]) {
    it(`FR-MCP-067 AC-3: is unbound and writes nothing ${stray ? "even with a stray docs/spec/00.index.md in home" : "with no index in home"}`, async () => {
      const home = path.join(scratch, `ac3-${stray}`, "home");
      await mkdir(home, { recursive: true });
      if (stray) {
        await mkdir(path.join(home, "docs", "spec"), { recursive: true });
        await writeFile(path.join(home, "docs", "spec", "00.index.md"), "# stray\n", "utf8");
      }
      const before = await snapshot(home);
      const client = await stdioClient(home, home);
      try {
        expectUnboundRefusal(parseText(await client.callTool({ name: "list_requirements", arguments: {} })), home);
      } finally {
        await client.close();
      }
      expect(await snapshot(home)).toEqual(before);
    }, 60_000);
  }
});

describe("FR-MCP-067 AC-4 — every call on an unbound server is refused", () => {
  it("FR-MCP-067 AC-4 (a) / REL-MCP-005 AC-1: every registered tool and resource answers MCP_WORKSPACE_UNBOUND through the adapter seam, and nothing is written", async () => {
    const { cwd, home } = await freshHome("ac4a");
    const before = await snapshot(home);
    // `root` points into the temporary home so that a server which ignored `unbound` could only write there.
    const server = createMcpServer({ root: cwd, unbound: { checkedCwd: cwd, initHint: false } });
    const names = Object.keys(server.tools);
    for (const required of ["init_project", "mcp_workspace_info", "orchestrate_run_lock", "workflow_pipeline_emit"]) expect(names).toContain(required);
    expect(names.some((name) => name.startsWith("resource:"))).toBe(true);
    for (const name of names) expectUnboundRefusal(await server.callTool(name, {}), cwd);
    expect(await snapshot(home)).toEqual(before);
  });

  it("FR-MCP-067 AC-4 (b): over stdio, a sample of tools with schema-valid input and one resource read are refused", async () => {
    const { home, cwd } = await freshHome("ac4b");
    const before = await snapshot(home);
    const client = await stdioClient(cwd, home);
    try {
      for (const [name, args] of [
        ["list_requirements", {}],
        ["mcp_workspace_info", {}],
        ["get_requirement", { id: "FR-X-001" }],
        ["orchestrate_run_lock", { action: "status" }],
        ["init_project", {}]
      ] as const) {
        expectUnboundRefusal(parseText(await client.callTool({ name, arguments: args })), cwd);
      }
      const resource = await client.readResource({ uri: "speckiwi://index" });
      const text = (resource.contents[0] as { text?: string } | undefined)?.text ?? "{}";
      expectUnboundRefusal(JSON.parse(text), cwd);
    } finally {
      await client.close();
    }
    expect(await snapshot(home)).toEqual(before);
  }, 60_000);
});

describe("FR-MCP-067 AC-5 — the refusal tells the caller what to do, and never to init the home directory", () => {
  async function recoveryFor(checkedCwd: string, initHint: boolean): Promise<string> {
    const { cwd } = await freshHome(`ac5-${initHint}`);
    const server = createMcpServer({ root: cwd, unbound: { checkedCwd, initHint } });
    const answer = (await server.callTool("list_requirements", {})) as { recovery?: { message?: string } };
    return answer.recovery?.message ?? "";
  }

  function expectCommon(message: string, checkedCwd: string): void {
    expect(message).toContain(checkedCwd);
    expect(message).toMatch(/start the MCP server with its working directory set to the project/i);
    expect(message).toMatch(/start the agent session in the project/i);
    expect(message).toMatch(/set the working directory in the client's MCP server configuration/i);
    expect(message).toMatch(/stays unbound until the session or server is restarted/i);
    expect(message).not.toContain("--force");
    expect(message).not.toMatch(/restart_mcp_server|"cwd"|cwd:/);
  }

  it("FR-MCP-067 AC-5: inside a git work tree, not home, the recovery adds the init line for the project directory", async () => {
    const message = await recoveryFor("/work/project", true);
    expectCommon(message, "/work/project");
    expect(message).toContain("if this project has no SRS yet, run `speckiwi init` in the project directory, then restart the session");
  });

  it("FR-MCP-067 AC-5: otherwise the recovery says the server was started outside any project and does not mention init", async () => {
    const message = await recoveryFor("/home/someone", false);
    expectCommon(message, "/home/someone");
    expect(message).toMatch(/started outside any project/i);
    expect(message).not.toMatch(/init/i);
  });

  it("FR-MCP-067 AC-5: the startup decision offers the init line only inside a git work tree that is not home", async () => {
    const base = path.join(scratch, "ac5");
    const home = path.join(base, "home");
    const repo = path.join(home, "repo");
    const plain = path.join(home, "plain");
    await mkdir(path.join(repo, ".git"), { recursive: true });
    await mkdir(path.join(repo, "sub"), { recursive: true });
    await mkdir(plain, { recursive: true });
    const bounds = { home, ceiling: path.parse(base).root };
    expect(await decideMcpStartupFrom(path.join(repo, "sub"), bounds)).toMatchObject({ bound: false, initHint: true });
    expect(await decideMcpStartupFrom(plain, bounds)).toMatchObject({ bound: false, initHint: false });
    expect(await decideMcpStartupFrom(home, bounds)).toMatchObject({ bound: false, initHint: false });
    // Home itself is a git work tree here; it still gets no init line.
    await mkdir(path.join(home, ".git"), { recursive: true });
    expect(await decideMcpStartupFrom(home, bounds)).toMatchObject({ bound: false, initHint: false });
  });
});

describe("FR-MCP-067 AC-6 — a per-call workspaceRoot on an unbound server", () => {
  it("FR-MCP-067 AC-6: gets the unbound refusal before any gate, and nothing is created at that path", async () => {
    const { cwd, home } = await freshHome("ac6");
    const target = path.join(scratch, "ac6-target");
    await mkdir(path.join(target, ".git"), { recursive: true });
    const before = await snapshot(target);
    // `root` points into the temporary home so that a server which ignored `unbound` could only write there.
    const server = createMcpServer({ root: cwd, unbound: { checkedCwd: cwd, initHint: false } });
    for (const name of ["workflow_pipeline_emit", "list_requirements", "orchestrate_run_lock"]) {
      const answer = await server.callTool(name, { workspaceRoot: target, runId: "r", event: { status: "TASK_DONE" } });
      expectUnboundRefusal(answer, cwd);
      expect((answer as { error?: { code?: string } }).error?.code).not.toBe("MCP_WORKSPACE_ROOT_UNSUPPORTED");
    }
    expect(await snapshot(target)).toEqual(before);
    expect(await snapshot(home)).toBeDefined();
  });
});
