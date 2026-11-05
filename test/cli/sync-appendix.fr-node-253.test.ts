import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { main } from "../../src/cli/index.js";
import { renderToolNames } from "../../src/mcp/schemas.js";
import { copyFixtureWorkspace } from "../fixtures/fixture-utils.js";

// FR-NODE-253 — `speckiwi sync-appendix` over the real ToolSpec registry, on a fixture appendix.

const APPENDIX_HEAD = ["# Appendix", "", "## 3. MCP Tool Reference", "", "### 3.1 Tool Summary", "", "| Tool | Mutates Files | Purpose |", "|---|---:|---|"];
const APPENDIX_TAIL = ["", "### 3.2 MCP Tool Input Shapes", "", "Shapes."];

function io() {
  return { stdout: new PassThrough(), stderr: new PassThrough() };
}

async function cli(root: string, args: string[]): Promise<{ code: number; stdout: string }> {
  const streams = io();
  const code = await main(["--root", root, ...args], streams);
  return { code, stdout: streams.stdout.read()?.toString() ?? "" };
}

interface SyncValue {
  changed: boolean;
  written: boolean;
  missing: string[];
  extra: string[];
  differing: string[];
}

function value(stdout: string): SyncValue {
  return (JSON.parse(stdout) as { value: SyncValue }).value;
}

async function staleWorkspace(): Promise<{ root: string; file: string }> {
  const root = await copyFixtureWorkspace("valid-basic");
  const file = path.join(root, "docs", "spec", "90.appendix.md");
  await writeFile(file, [...APPENDIX_HEAD, "| `not_a_tool` | no | Gone. |", ...APPENDIX_TAIL, ""].join("\n"), "utf8");
  return { root, file };
}

describe("FR-NODE-253 AC-1 — speckiwi sync-appendix", () => {
  // @req FR-NODE-253 AC-1
  it("checks by default: exit 1 naming the missing and extra tools, writing nothing", async () => {
    const { root, file } = await staleWorkspace();
    const before = await readFile(file, "utf8");

    const run = await cli(root, ["sync-appendix", "--json"]);

    expect(run.code, run.stdout).toBe(1);
    expect(value(run.stdout).missing).toEqual([...renderToolNames()].sort());
    expect(value(run.stdout).extra).toEqual(["not_a_tool"]);
    expect(await readFile(file, "utf8")).toBe(before);
  });

  // @req FR-NODE-253 AC-1
  it("--dry-run reports the patch and writes nothing; without --write it still exits 1", async () => {
    const { root, file } = await staleWorkspace();
    const before = await readFile(file, "utf8");

    const check = await cli(root, ["sync-appendix", "--dry-run", "--json"]);
    expect(check.code, check.stdout).toBe(1);
    expect((JSON.parse(check.stdout) as { mutation?: { dryRun: boolean } }).mutation?.dryRun).toBe(true);

    const planned = await cli(root, ["sync-appendix", "--write", "--dry-run", "--json"]);
    expect(planned.code, planned.stdout).toBe(0);
    expect((JSON.parse(planned.stdout) as { mutation?: { preview: string[] } }).mutation?.preview.length).toBe(renderToolNames().length);
    expect(await readFile(file, "utf8")).toBe(before);
  });

  // @req FR-NODE-253 AC-1 AC-3
  it("--write regenerates the table, after which check mode exits 0; a tool without its row turns it red again", async () => {
    const { root, file } = await staleWorkspace();

    const write = await cli(root, ["sync-appendix", "--write", "--json"]);
    expect(write.code, write.stdout).toBe(0);
    expect(value(write.stdout)).toMatchObject({ changed: true, written: true });
    const written = await readFile(file, "utf8");
    expect(written.startsWith(`${APPENDIX_HEAD.join("\n")}\n`)).toBe(true);
    expect(written.endsWith(`${APPENDIX_TAIL.join("\n")}\n`)).toBe(true);

    const check = await cli(root, ["sync-appendix", "--json"]);
    expect(check.code, check.stdout).toBe(0);
    expect(value(check.stdout).changed).toBe(false);

    // A registered tool whose row is absent is what a new tool without a regenerated table looks like.
    const dropped = renderToolNames()[0] as string;
    await writeFile(file, written.split("\n").filter((line) => !line.startsWith(`| \`${dropped}\` |`)).join("\n"), "utf8");
    const red = await cli(root, ["sync-appendix", "--json"]);
    expect(red.code, red.stdout).toBe(1);
    expect(value(red.stdout).missing).toEqual([dropped]);
  });

  // @req FR-NODE-253 AC-4
  it("--write exits 5 while another session holds the SRS mutation lock", async () => {
    const { root, file } = await staleWorkspace();
    const before = await readFile(file, "utf8");
    await mkdir(path.join(root, "kiwi"), { recursive: true });
    await writeFile(
      path.join(root, "kiwi", ".srs.lock"),
      `${JSON.stringify({
        schemaVersion: "1.0.0",
        owner: "another-session",
        operation: "add_requirement",
        requestId: "held",
        acquiredAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 600_000).toISOString()
      })}\n`,
      "utf8"
    );

    const run = await cli(root, ["sync-appendix", "--write", "--json"]);
    expect(run.code, run.stdout).toBe(5);
    expect(await readFile(file, "utf8")).toBe(before);
  });
});
