import { execFile } from "node:child_process";
import { cp, mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { beforeAll, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const execFileAsync = promisify(execFile);

// @req REL-MCP-005 AC-2 — `rootSource` is exactly one of server-cwd-discovery, per-call-workspace-root
// or unbound, and `unbound` is reported precisely when the startup search found no SRS
// (FR-MCP-067). Asserted against a real spawned server rather than by inspection: a startup path
// that stops passing the source cannot fail a source scan. HOME is a temporary directory above each
// working directory, so the search never reaches the real home.
async function workspaceInfo(cwd: string, home: string): Promise<Record<string, unknown>> {
  const parsed = path.parse(home);
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [path.resolve("bin/speckiwi"), "mcp"],
    cwd,
    env: { ...(process.env as Record<string, string>), HOME: home, USERPROFILE: home, HOMEDRIVE: parsed.root.replace(/\\$/, ""), HOMEPATH: home.slice(parsed.root.length - 1) },
    stderr: "pipe"
  });
  const client = new Client({ name: "speckiwi-root-source-test", version: "1.0.0" }, { capabilities: {} });
  await client.connect(transport);
  try {
    const result = await client.callTool({ name: "mcp_workspace_info", arguments: {} });
    const first = (result.content as Array<{ type: string; text?: string }> | undefined)?.[0];
    const text = first?.type === "text" ? (first.text ?? "") : "";
    return JSON.parse(text) as Record<string, unknown>;
  } finally {
    await client.close();
  }
}

describe("REL-MCP-005 AC-2 — the startup root reports the source it came from", { timeout: 120_000 }, () => {
  beforeAll(async () => {
    await execFileAsync(process.execPath, ["node_modules/typescript/bin/tsc", "-p", "tsconfig.json"], { cwd: process.cwd() });
  }, 300_000);

  it("REL-MCP-005 AC-2 / FR-MCP-067 AC-7: reports unbound when the startup search found no SRS, and server-cwd-discovery (bound as before) when it did", async () => {
    const home = await mkdtemp(path.join(tmpdir(), "speckiwi-rootsource-home-"));
    const fresh = path.join(home, "fresh");
    const existing = path.join(home, "existing");
    await mkdir(fresh, { recursive: true });
    await cp(path.resolve("test", "fixtures", "workspaces", "valid-basic"), existing, { recursive: true });
    try {
      const unbound = await workspaceInfo(fresh, home);
      expect(unbound).toMatchObject({
        ok: false,
        error: { code: "MCP_WORKSPACE_UNBOUND" },
        mcpWorkspace: { rootSource: "unbound", workspaceRoot: null }
      });
      expect(await readdir(fresh), "an unbound server creates nothing").toEqual([]);

      const discovered = await workspaceInfo(existing, home);
      expect(discovered).toMatchObject({
        ok: true,
        value: { rootSource: "server-cwd-discovery" },
        mcpWorkspace: { rootSource: "server-cwd-discovery" }
      });
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });
});
