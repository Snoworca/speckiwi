import { execFileSync, spawnSync } from "node:child_process";
import { cp, mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpError } from "@modelcontextprotocol/sdk/types.js";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { rebuildCache } from "../../src/core/cache.js";
import { exportMarkdown } from "../../src/core/export-markdown.js";
import { createProposal } from "../../src/core/propose-change.js";
import { validateWorkspace } from "../../src/core/validate.js";
import { createMcpServer } from "../../src/mcp/server.js";

const repoRoot = resolve(import.meta.dirname, "../..");
const validFixtureRoot = resolve(repoRoot, "test/fixtures/workspaces/valid-basic");
const tempRoots: string[] = [];

beforeAll(() => {
  execFileSync("npm", ["run", "build"], { cwd: repoRoot, stdio: "pipe" });
});

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("cross-platform and environment hardening", () => {
  it("runs main CLI read/export commands with roots containing spaces", async () => {
    const workspace = await copyFixture("speckiwi root with spaces ");
    const commands = [
      ["validate", "--root", workspace, "--json"],
      ["list", "docs", "--root", workspace, "--json"],
      ["list", "reqs", "--root", workspace, "--json"],
      ["search", "validation", "--root", workspace, "--json"],
      ["req", "get", "FR-CORE-0001", "--root", workspace, "--json"],
      ["export", "markdown", "--root", workspace, "--json"]
    ];

    for (const args of commands) {
      const result = runCli(args);
      expect(result.status, `${args.join(" ")} stderr=${result.stderr}`).toBe(0);
      expect(result.stderr).toBe("");
      expect(JSON.parse(result.stdout)).toMatchObject({ ok: true });
    }
  }, 20_000);

  it("keeps ambient environment secrets out of YAML, proposals, cache, diagnostics, CLI JSON, MCP content, and Markdown export", async () => {
    const workspace = await copyFixture("speckiwi-env-leak-");
    const sentinel = `SPECKIWI_SENTINEL_${Date.now()}_DO_NOT_LEAK`;
    const previous = process.env.SPECKIWI_HARDENING_SENTINEL;
    process.env.SPECKIWI_HARDENING_SENTINEL = sentinel;

    try {
      const validation = await validateWorkspace({ root: workspace });
      const proposal = await createProposal({
        root: workspace,
        operation: "update_requirement",
        target: { kind: "requirement", requirementId: "FR-CORE-0001" },
        changes: [{ op: "replace", path: "/requirements/0/statement", value: "The system shall not serialize ambient environment values." }],
        reason: "Exercise environment leak guard."
      });
      const cache = await rebuildCache({ root: workspace });
      const exported = await exportMarkdown({ root: workspace });
      const cli = runCli(["validate", "--root", workspace, "--json"], { SPECKIWI_HARDENING_SENTINEL: sentinel });

      expect(validation.ok).toBe(true);
      expect(proposal).toMatchObject({ ok: true });
      expect(cache).toMatchObject({ ok: true });
      expect(exported).toMatchObject({ ok: true });
      expect(cli.status).toBe(0);

      await withMcpClient(workspace, async (client) => {
        const result = await client.callTool({ name: "speckiwi_validate", arguments: {} });
        expect(JSON.stringify(result.structuredContent)).not.toContain(sentinel);
        expect(JSON.stringify(result.content)).not.toContain(sentinel);
      });

      const generatedText = [
        JSON.stringify(validation),
        JSON.stringify(proposal),
        JSON.stringify(cache),
        JSON.stringify(exported),
        cli.stdout,
        ...(await readGeneratedTexts(join(workspace, ".speckiwi")))
      ].join("\n");
      expect(generatedText).not.toContain(sentinel);
    } finally {
      if (previous === undefined) {
        delete process.env.SPECKIWI_HARDENING_SENTINEL;
      } else {
        process.env.SPECKIWI_HARDENING_SENTINEL = previous;
      }
    }
  });

  it("starts the stdio MCP command without out-of-band logs", async () => {
    const transport = new StdioClientTransport({
      command: "node",
      args: ["bin/speckiwi", "mcp", "--root", validFixtureRoot],
      cwd: repoRoot,
      stderr: "pipe"
    });
    const stderrChunks: Buffer[] = [];
    transport.stderr?.on("data", (chunk: Buffer) => stderrChunks.push(chunk));
    const client = new Client({ name: "speckiwi-hardening-stdio", version: "1.0.0" });

    await client.connect(transport);
    const listed = await client.listTools();
    expect(listed.tools.some((tool) => tool.name === "speckiwi_validate")).toBe(true);
    await client.close().catch((error: unknown) => {
      if (!(error instanceof McpError)) {
        throw error;
      }
    });
    expect(Buffer.concat(stderrChunks).toString("utf8")).toBe("");
  });
});

function runCli(args: string[], extraEnv: NodeJS.ProcessEnv = {}) {
  return spawnSync("node", ["bin/speckiwi", ...args], {
    cwd: repoRoot,
    env: { ...process.env, ...extraEnv },
    encoding: "utf8"
  });
}

async function copyFixture(prefix: string): Promise<string> {
  const workspace = await mkdtemp(join(tmpdir(), prefix));
  tempRoots.push(workspace);
  await cp(validFixtureRoot, workspace, { recursive: true });
  return workspace;
}

async function withMcpClient(workspace: string, callback: (client: Client) => Promise<void>): Promise<void> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "speckiwi-hardening-mcp", version: "1.0.0" });
  const server = createMcpServer({ root: workspace });

  try {
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    await callback(client);
  } finally {
    await client.close().catch((error: unknown) => {
      if (!(error instanceof McpError)) {
        throw error;
      }
    });
    await server.close();
  }
}

async function readGeneratedTexts(root: string): Promise<string[]> {
  const output: string[] = [];
  await walk(root, async (path) => {
    if (/\.(yaml|json|md)$/i.test(path)) {
      output.push(await readFile(path, "utf8"));
    }
  });
  return output;
}

async function walk(root: string, visit: (path: string) => Promise<void>): Promise<void> {
  const entries = await readdir(root, { withFileTypes: true });
  for (const entry of entries) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) {
      await walk(path, visit);
    } else if (entry.isFile()) {
      await visit(path);
    }
  }
}
