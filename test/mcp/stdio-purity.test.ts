import { execFile } from "node:child_process";
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
      const listRequirements = tools.tools.find((tool) => tool.name === "list_requirements");
      expect(addRequirement?.inputSchema.properties).toHaveProperty("requirement");
      expect(addRequirement?.inputSchema.required).toContain("requirement");
      expect(listRequirements?.annotations?.readOnlyHint).toBe(true);

      const resources = await client.listResources();
      expect(resources.resources.map((resource) => resource.uri)).toContain("speckiwi://index");

      const templates = await client.listResourceTemplates();
      expect(templates.resourceTemplates.map((template) => template.uriTemplate).sort()).toEqual([
        "speckiwi://requirements/{id}",
        "speckiwi://scopes/{scope}",
        "speckiwi://targets/{target}"
      ]);

      const result = await client.callTool({ name: "list_requirements", arguments: {} });
      const text = "content" in result && result.content[0]?.type === "text" ? result.content[0].text : "";
      expect(JSON.parse(text)).toMatchObject({ ok: true });
    } finally {
      await client.close();
    }
  }, 30000);
});
