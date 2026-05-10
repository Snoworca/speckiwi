import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { describe, expect, it } from "vitest";
import { copyFixtureWorkspace } from "../fixtures/fixture-utils.js";

const execFileAsync = promisify(execFile);

describe("real stdio MCP server", () => {
  it("exposes tools, schemas, and resources without human stdout", async () => {
    const root = await copyFixtureWorkspace("valid-basic");
    await execFileAsync(process.execPath, ["node_modules/typescript/bin/tsc", "-p", "tsconfig.json"], { cwd: process.cwd() });

    const transport = new StdioClientTransport({
      command: process.execPath,
      args: ["bin/speckiwi", "--root", root, "mcp"],
      cwd: process.cwd(),
      stderr: "pipe"
    });
    const client = new Client({ name: "speckiwi-test", version: "1.0.0" }, { capabilities: {} });
    await client.connect(transport);
    try {
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
      const text = "content" in result && result.content[0]?.type === "text" ? result.content[0].text : "";
      expect(JSON.parse(text)).toMatchObject({ ok: true });

      const completedResource = await client.readResource({ uri: "speckiwi://completed-work" });
      const completedText = completedResource.contents[0]?.text;
      expect(typeof completedText).toBe("string");
      expect(JSON.parse(String(completedText))).toMatchObject({
        ok: true,
        value: { completedWork: expect.any(Array) },
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
      const text = "content" in result && result.content[0]?.type === "text" ? result.content[0].text : "";
      const parsed = JSON.parse(text);
      expect(parsed).toMatchObject({ ok: true });
      expect(parsed.value.records.map((record: { id: string }) => record.id)).toContain("FR-ARCH-001");
    } finally {
      await client.close();
    }
  }, 30000);

  it("auto-initializes a missing SRS workspace before handling MCP calls", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "speckiwi-mcp-auto-init-"));
    await execFileAsync(process.execPath, ["node_modules/typescript/bin/tsc", "-p", "tsconfig.json"], { cwd: process.cwd() });

    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [path.resolve("bin/speckiwi"), "mcp"],
      cwd: root,
      stderr: "pipe"
    });
    const client = new Client({ name: "speckiwi-auto-init-test", version: "1.0.0" }, { capabilities: {} });
    await client.connect(transport);
    try {
      const result = await client.callTool({ name: "list_requirements", arguments: {} });
      const text = "content" in result && result.content[0]?.type === "text" ? result.content[0].text : "";
      expect(JSON.parse(text)).toMatchObject({ ok: true, value: { records: [] } });
      expect(await readFile(path.join(root, "docs", "spec", "00.index.md"), "utf8")).toContain("SRS Index");
      expect(await readFile(path.join(root, "docs", "spec", "00.index.md"), "utf8")).toContain("| Active Target |  |");
      expect(await readFile(path.join(root, "AGENTS.md"), "utf8")).toContain("# SpecKiwi SRS 워크플로 v1.2");
      expect(await readFile(path.join(root, "CLAUDE.md"), "utf8")).toContain("# SpecKiwi SRS 워크플로 v1.2");
    } finally {
      await client.close();
      await rm(root, { recursive: true, force: true });
    }
  }, 30000);

  it("auto-initializes an existing git root when only the SRS index is missing", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "speckiwi-mcp-missing-index-"));
    await mkdir(path.join(root, ".git"));
    await execFileAsync(process.execPath, ["node_modules/typescript/bin/tsc", "-p", "tsconfig.json"], { cwd: process.cwd() });

    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [path.resolve("bin/speckiwi"), "mcp"],
      cwd: root,
      stderr: "pipe"
    });
    const client = new Client({ name: "speckiwi-missing-index-test", version: "1.0.0" }, { capabilities: {} });
    await client.connect(transport);
    try {
      const result = await client.callTool({ name: "validate_spec", arguments: {} });
      const text = "content" in result && result.content[0]?.type === "text" ? result.content[0].text : "";
      expect(JSON.parse(text)).toMatchObject({ ok: true });
      expect(await readFile(path.join(root, "docs", "spec", "00.index.md"), "utf8")).toContain("SRS Index");
      expect(await readFile(path.join(root, "docs", "spec", "00.index.md"), "utf8")).toContain("| Active Target |  |");
      expect(await readFile(path.join(root, "AGENTS.md"), "utf8")).toContain("# SpecKiwi SRS 워크플로 v1.2");
      expect(await readFile(path.join(root, "CLAUDE.md"), "utf8")).toContain("# SpecKiwi SRS 워크플로 v1.2");
    } finally {
      await client.close();
      await rm(root, { recursive: true, force: true });
    }
  }, 30000);

  it("rejects a missing explicit MCP root instead of creating it", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "speckiwi-mcp-explicit-root-"));
    const missing = path.join(root, "typo");
    await execFileAsync(process.execPath, ["node_modules/typescript/bin/tsc", "-p", "tsconfig.json"], { cwd: process.cwd() });

    try {
      await expect(execFileAsync(process.execPath, [path.resolve("bin/speckiwi"), "--root", missing, "mcp"], { cwd: process.cwd(), timeout: 5000 })).rejects.toMatchObject({
        stderr: expect.stringContaining("Could not resolve explicit MCP project root")
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, 30000);

  it("rejects an explicit MCP root that is not a directory", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "speckiwi-mcp-file-root-"));
    const fileRoot = path.join(root, "not-a-directory");
    await writeFile(fileRoot, "not a directory", "utf8");
    await execFileAsync(process.execPath, ["node_modules/typescript/bin/tsc", "-p", "tsconfig.json"], { cwd: process.cwd() });

    try {
      await expect(execFileAsync(process.execPath, [path.resolve("bin/speckiwi"), "--root", fileRoot, "mcp"], { cwd: process.cwd(), timeout: 5000 })).rejects.toMatchObject({
        stderr: expect.stringContaining("Explicit MCP project root is not a directory")
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, 30000);
});
