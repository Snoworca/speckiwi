import { cp, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { afterAll, describe, expect, it } from "vitest";
import { main } from "../../src/cli/index.js";
import { createMcpServer } from "../../src/mcp/server.js";
import { roadmapText, type ItemSpec } from "../core/roadmap/roadmap-fixture.js";

const REPO = path.resolve(__dirname, "..", "..");
const made: string[] = [];

afterAll(async () => {
  for (const dir of made) await rm(dir, { recursive: true, force: true });
});

/** A copy of this repository's real SRS (docs/spec) and PRD files, with `items` as docs/roadmap.md when given. */
async function realWorkspace(items?: ItemSpec[]): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "verify-v531-r1-"));
  made.push(root);
  await cp(path.join(REPO, "docs", "spec"), path.join(root, "docs", "spec"), { recursive: true });
  await cp(path.join(REPO, "docs", "prd"), path.join(root, "docs", "prd"), { recursive: true });
  if (items) await writeFile(path.join(root, "docs", "roadmap.md"), roadmapText(...items), "utf8");
  return root;
}

async function run(root: string, ...args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  const io = { stdout: new PassThrough(), stderr: new PassThrough() };
  const code = await main(["--root", root, ...args], io);
  return { code, stdout: io.stdout.read()?.toString() ?? "", stderr: io.stderr.read()?.toString() ?? "" };
}

async function mcp(root: string, tool: string, input: Record<string, unknown>): Promise<Record<string, unknown>> {
  return (await createMcpServer({ root }).callTool(tool, input)) as Record<string, unknown>;
}

function withoutWorkspace(answer: Record<string, unknown>): Record<string, unknown> {
  const rest = { ...answer };
  delete rest.mcpWorkspace;
  return rest;
}

describe("r1 tools: the CLI and MCP roadmap surfaces answer the same input alike", () => {
  // @req IR-MCP-009 AC-1
  // Input: `Actual Start` written as `-`, the empty value docs/rule/SRS-MD-Rules-v2.6.0.md Appendix A.2 lists for that row.
  it("IR-MCP-009 AC-1 update_roadmap_item and speckiwi roadmap update give the same answer for an Actual Start of -", async () => {
    const items: ItemSpec[] = [
      {
        n: 1,
        title: "Started item",
        fields: { "Actual Start": "2026-11-01" },
        history: [
          ["2026-11-01", "Created", "-", "-", "fixture"],
          ["2026-11-01", "Actual Start", "-", "2026-11-01", "started"]
        ]
      }
    ];
    const viaCli = await realWorkspace(items);
    const viaMcp = await realWorkspace(items);
    const cli = await run(viaCli, "roadmap", "update", "RM-1", "--actual-start", "-", "--reason", "recorded by mistake", "--json");
    const tool = await mcp(viaMcp, "update_roadmap_item", { item: "RM-1", actualStart: "-", reason: "recorded by mistake" });
    expect(tool.ok).toBe(true);
    expect({ code: cli.code, answer: cli.stdout === "" ? cli.stderr.trim() : withoutWorkspace(JSON.parse(cli.stdout)) }).toEqual({ code: 0, answer: withoutWorkspace(tool) });
  });
});
