import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { describe, expect, it } from "vitest";
import { copyFixtureWorkspace } from "../fixtures/fixture-utils.js";

const execFileAsync = promisify(execFile);

interface ToolResponse {
  content: Array<{ type: string; text?: string }>;
}

function extractText(result: unknown): string {
  if (!result || typeof result !== "object") return "";
  const tool = result as ToolResponse;
  return tool.content?.[0]?.type === "text" ? (tool.content[0].text ?? "") : "";
}

describe("real stdio MCP server — update_stability (v2.2.1 §5.2)", () => {
  it("exposes update_stability tool schema and mutates Stability via spawned process", async () => {
    const root = await copyFixtureWorkspace("mutation-target");
    await execFileAsync(process.execPath, ["node_modules/typescript/bin/tsc", "-p", "tsconfig.json"], { cwd: process.cwd() });

    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [path.resolve("bin/speckiwi"), "mcp"],
      cwd: root,
      stderr: "pipe"
    });
    const client = new Client({ name: "speckiwi-update-stability-test", version: "1.0.0" }, { capabilities: {} });
    await client.connect(transport);
    try {
      const tools = await client.listTools();
      const updateStability = tools.tools.find((tool) => tool.name === "update_stability");
      expect(updateStability).toBeDefined();
      const properties = updateStability?.inputSchema.properties as Record<string, unknown> | undefined;
      expect(properties).toBeDefined();
      expect(properties).toHaveProperty("id");
      expect(properties).toHaveProperty("stability");
      expect(properties).toHaveProperty("reason");
      expect(properties).toHaveProperty("dryRun");
      const stabilitySchema = properties?.stability as { enum?: string[] } | undefined;
      expect(stabilitySchema?.enum).toEqual(["draft", "evolving", "stable", "frozen", "deprecated"]);
      expect(updateStability?.annotations?.readOnlyHint).toBe(false);

      const mutate = await client.callTool({
        name: "update_stability",
        arguments: { id: "FR-ARCH-001", stability: "evolving", reason: "stdio e2e" }
      });
      const mutateBody = JSON.parse(extractText(mutate));
      expect(mutateBody).toMatchObject({ ok: true });
      expect(mutateBody.value).toMatchObject({ id: "FR-ARCH-001", stability: "evolving", written: true });

      const list = await client.callTool({ name: "list_requirements", arguments: {} });
      const listBody = JSON.parse(extractText(list));
      expect(listBody).toMatchObject({ ok: true });
      const target = (listBody.value.records as Array<{ id: string; stability?: string }>).find((record) => record.id === "FR-ARCH-001");
      expect(target?.stability).toBe("evolving");

      const denied = await client.callTool({
        name: "update_stability",
        arguments: { id: "FR-ARCH-001", stability: "frozen" }
      });
      const deniedBody = JSON.parse(extractText(denied));
      expect(deniedBody).toMatchObject({ ok: false });
    } finally {
      await client.close();
    }
  }, 60000);
});
