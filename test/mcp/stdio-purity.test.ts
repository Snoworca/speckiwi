import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { describe, expect, it } from "vitest";
import { copyFixtureWorkspace } from "../fixtures/fixture-utils.js";
const execFileAsync = promisify(execFile);

/** The text of a tools/call result's first content item when that item is text, else "". */
function firstText(result: Awaited<ReturnType<Client["callTool"]>>): string {
  const first = (result.content as Array<{ type: string; text?: string }> | undefined)?.[0];
  return first?.type === "text" ? (first.text ?? "") : "";
}

async function readPackageVersion(): Promise<string> {
  const pkg = JSON.parse(await readFile("package.json", "utf8")) as { version: string };
  return pkg.version;
}

describe("real stdio MCP server", () => {
  it("exposes tools, schemas, and resources without human stdout", async () => {
    const root = await copyFixtureWorkspace("valid-basic");
    await execFileAsync(process.execPath, ["node_modules/typescript/bin/tsc", "-p", "tsconfig.json"], { cwd: process.cwd() });

    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [path.resolve("bin/speckiwi"), "mcp"],
      cwd: root,
      stderr: "pipe"
    });
    const client = new Client({ name: "speckiwi-test", version: "1.0.0" }, { capabilities: {} });
    await client.connect(transport);
    try {
      expect(client.getServerVersion()).toMatchObject({ name: "speckiwi", version: await readPackageVersion() });

      const tools = await client.listTools();
      const addRequirement = tools.tools.find((tool) => tool.name === "add_requirement");
      const addCompletedWork = tools.tools.find((tool) => tool.name === "add_completed_work");
      const initProject = tools.tools.find((tool) => tool.name === "init_project");
      const listRequirements = tools.tools.find((tool) => tool.name === "list_requirements");
      const listCompletedWork = tools.tools.find((tool) => tool.name === "list_completed_work");
      const getActiveTarget = tools.tools.find((tool) => tool.name === "get_active_target");
      expect(addRequirement?.inputSchema.properties).toHaveProperty("requirement");
      expect(addRequirement?.inputSchema.required).toContain("requirement");
      expect(addCompletedWork?.inputSchema.properties).toHaveProperty("date");
      expect(addCompletedWork?.inputSchema.properties).toHaveProperty("reportPaths");
      expect(addCompletedWork?.inputSchema.properties).toHaveProperty("allowIncomplete");
      const reportPathsSchema = addCompletedWork?.inputSchema.properties?.reportPaths as { items?: { minLength?: number; pattern?: string; description?: string } } | undefined;
      expect(reportPathsSchema?.items).toMatchObject({ minLength: 1 });
      expect(reportPathsSchema?.items?.pattern).toContain("A-Za-z");
      expect(reportPathsSchema?.items?.description).toContain("repository-relative POSIX");
      expect(initProject?.inputSchema.properties).not.toHaveProperty("agentFile");
      expect(initProject?.inputSchema.properties).not.toHaveProperty("agentFiles");
      expect(listRequirements?.annotations?.readOnlyHint).toBe(true);
      expect(listCompletedWork?.annotations?.readOnlyHint).toBe(true);
      expect(getActiveTarget?.annotations?.readOnlyHint).toBe(true);

      const resources = await client.listResources();
      expect(resources.resources.map((resource) => resource.uri)).toContain("speckiwi://index");
      expect(resources.resources.map((resource) => resource.uri)).toContain("speckiwi://active-target");
      expect(resources.resources.map((resource) => resource.uri)).toContain("speckiwi://completed-work");

      const templates = await client.listResourceTemplates();
      expect(templates.resourceTemplates.map((template) => template.uriTemplate).sort()).toEqual([
        "speckiwi://completed-work/{target}",
        "speckiwi://requirements/{id}",
        "speckiwi://scopes/{scope}",
        "speckiwi://targets/{target}"
      ]);

      const result = await client.callTool({ name: "list_requirements", arguments: {} });
      const text = firstText(result);
      expect(JSON.parse(text)).toMatchObject({ ok: true });

      await expect(client.callTool({ name: "add_completed_work", arguments: { date: "2026-05-10", summary: "Blank report path.", reportPaths: [""] } })).resolves.toMatchObject({ isError: true });
      await expect(client.callTool({ name: "add_completed_work", arguments: { date: "2026-05-10", summary: "Invalid report path.", reportPaths: ["../escape.md"] } })).resolves.toMatchObject({
        isError: true
      });

      const completedResource = await client.readResource({ uri: "speckiwi://completed-work" });
      const completedContent = completedResource.contents[0];
      const completedText = completedContent !== undefined && "text" in completedContent ? completedContent.text : undefined;
      expect(typeof completedText).toBe("string");
      expect(JSON.parse(String(completedText))).toMatchObject({
        ok: true,
        value: { completedWork: [expect.objectContaining({ reportPaths: [] }), expect.objectContaining({ reportPaths: [] })] },
        diagnostics: expect.any(Array),
        diagnosticsSummary: expect.any(Object)
      });
    } finally {
      await client.close();
    }
  }, 30000);

  it("uses the process current working directory when --root is omitted", async () => {
    const root = await copyFixtureWorkspace("valid-basic");
    const nested = path.join(root, "nested", "agent-workdir");
    await mkdir(nested, { recursive: true });
    await execFileAsync(process.execPath, ["node_modules/typescript/bin/tsc", "-p", "tsconfig.json"], { cwd: process.cwd() });

    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [path.resolve("bin/speckiwi"), "mcp"],
      cwd: nested,
      stderr: "pipe"
    });
    const client = new Client({ name: "speckiwi-rootless-test", version: "1.0.0" }, { capabilities: {} });
    await client.connect(transport);
    try {
      const result = await client.callTool({ name: "list_requirements", arguments: {} });
      const text = firstText(result);
      const parsed = JSON.parse(text);
      expect(parsed).toMatchObject({ ok: true });
      expect(parsed.value.records.map((record: { id: string }) => record.id)).toContain("FR-ARCH-001");
    } finally {
      await client.close();
    }
  }, 30000);

  // @req IR-MCP-001 AC-6 AC-7 @req FR-MCP-011 AC-12 — startup never initialises: a directory with no
  // docs/spec/00.index.md on the way up stays unbound and nothing is created. HOME is a temporary
  // directory above the working directory, so the search never reaches the real home (FR-MCP-067).
  for (const withGit of [false, true]) {
    it(`IR-MCP-001 AC-6 AC-7 / FR-MCP-011 AC-12 / FR-ARCH-002 AC-5 / FR-NODE-009 AC-12 / IR-CLI-045 AC-6: does not initialise a missing SRS workspace${withGit ? " in an existing git root" : ""}; the server stays unbound`, async () => {
      const home = await mkdtemp(path.join(tmpdir(), "speckiwi-mcp-no-auto-init-"));
      const root = path.join(home, "project");
      await mkdir(withGit ? path.join(root, ".git") : root, { recursive: true });
      await execFileAsync(process.execPath, ["node_modules/typescript/bin/tsc", "-p", "tsconfig.json"], { cwd: process.cwd() });

      const parsed = path.parse(home);
      const transport = new StdioClientTransport({
        command: process.execPath,
        args: [path.resolve("bin/speckiwi"), "mcp"],
        cwd: root,
        env: { ...(process.env as Record<string, string>), HOME: home, USERPROFILE: home, HOMEDRIVE: parsed.root.replace(/\\$/, ""), HOMEPATH: home.slice(parsed.root.length - 1) },
        stderr: "pipe"
      });
      const client = new Client({ name: "speckiwi-no-auto-init-test", version: "1.0.0" }, { capabilities: {} });
      await client.connect(transport);
      try {
        const result = await client.callTool({ name: withGit ? "validate_spec" : "list_requirements", arguments: {} });
        expect(JSON.parse(firstText(result))).toMatchObject({ ok: false, error: { code: "MCP_WORKSPACE_UNBOUND" } });
        for (const created of [path.join("docs", "spec", "00.index.md"), "AGENTS.md", "CLAUDE.md", "kiwi"]) {
          await expect(readFile(path.join(root, created), "utf8"), created).rejects.toBeDefined();
        }
      } finally {
        await client.close();
        await rm(home, { recursive: true, force: true });
      }
    }, 30000);
  }

  it("IR-CLI-045 AC-7 / IR-MCP-001 AC-8 / FR-ARCH-002 AC-6: rejects --root with a usage error instead of starting the server", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "speckiwi-mcp-explicit-root-"));
    const missing = path.join(root, "typo");
    await execFileAsync(process.execPath, ["node_modules/typescript/bin/tsc", "-p", "tsconfig.json"], { cwd: process.cwd() });

    try {
      await expect(execFileAsync(process.execPath, [path.resolve("bin/speckiwi"), "--root", missing, "mcp"], { cwd: process.cwd(), timeout: 5000 })).rejects.toMatchObject({
        code: 2,
        stderr: expect.stringContaining("does not support --root")
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, 30000);

  it("IR-CLI-045 AC-7: rejects --root even when the path exists", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "speckiwi-mcp-existing-root-"));
    await execFileAsync(process.execPath, ["node_modules/typescript/bin/tsc", "-p", "tsconfig.json"], { cwd: process.cwd() });

    try {
      await expect(execFileAsync(process.execPath, [path.resolve("bin/speckiwi"), "--root", root, "mcp"], { cwd: process.cwd(), timeout: 5000 })).rejects.toMatchObject({
        code: 2,
        stderr: expect.stringContaining("does not support --root")
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, 30000);
});
