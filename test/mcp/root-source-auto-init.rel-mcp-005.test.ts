import { execFile } from "node:child_process";
import { cp, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { beforeAll, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const execFileAsync = promisify(execFile);

// @req REL-MCP-005 AC-2 — `auto-init` is one of the three sources a caller may be told about, so it
// has to be a source the server actually reports. Asserted against a real spawned server rather
// than by inspection: a startup path that stops passing the source cannot fail a source scan.
async function workspaceInfo(cwd: string): Promise<Record<string, unknown>> {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [path.resolve("bin/speckiwi"), "mcp"],
    cwd,
    stderr: "pipe"
  });
  const client = new Client({ name: "speckiwi-root-source-test", version: "1.0.0" }, { capabilities: {} });
  await client.connect(transport);
  try {
    const result = await client.callTool({ name: "mcp_workspace_info", arguments: {} });
    const text = "content" in result && result.content[0]?.type === "text" ? result.content[0].text : "";
    return JSON.parse(text) as Record<string, unknown>;
  } finally {
    await client.close();
  }
}

describe("REL-MCP-005 AC-2 — the startup root reports the source it came from", { timeout: 120_000 }, () => {
  beforeAll(async () => {
    await execFileAsync(process.execPath, ["node_modules/typescript/bin/tsc", "-p", "tsconfig.json"], { cwd: process.cwd() });
  }, 300_000);

  it("reports auto-init when the server had to create the workspace, and server-cwd-discovery when it did not", async () => {
    const fresh = await mkdtemp(path.join(tmpdir(), "speckiwi-rootsource-fresh-"));
    const existing = await mkdtemp(path.join(tmpdir(), "speckiwi-rootsource-existing-"));
    await cp(path.resolve("test", "fixtures", "workspaces", "valid-basic"), existing, { recursive: true });
    try {
      const created = await workspaceInfo(fresh);
      expect(created).toMatchObject({
        ok: true,
        value: { rootSource: "auto-init" },
        mcpWorkspace: { rootSource: "auto-init" }
      });

      const discovered = await workspaceInfo(existing);
      expect(discovered).toMatchObject({
        ok: true,
        value: { rootSource: "server-cwd-discovery" },
        mcpWorkspace: { rootSource: "server-cwd-discovery" }
      });
    } finally {
      await rm(fresh, { recursive: true, force: true });
      await rm(existing, { recursive: true, force: true });
    }
  });
});
