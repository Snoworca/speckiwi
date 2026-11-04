import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { PassThrough } from "node:stream";
import { main } from "../../src/cli/index.js";
import { createMcpServer } from "../../src/mcp/server.js";
import { copyFixtureWorkspace } from "../fixtures/fixture-utils.js";
import { buildPrd, type FixtureOptions } from "../core/prd/prd-fixture.js";

// Shared by the PRD surface tests (FR-NODE-240/241/242): a valid-basic workspace with PRD files under
// docs/prd, the CLI run in process, and the MCP server called in process.

export const PRD_PATH = "docs/prd/2026-11-04.reset.prd.md";

export interface Answer<T = unknown> {
  ok: boolean;
  value?: T;
  error?: { code?: string; message?: string };
  diagnostics?: unknown[];
}

export async function writePrd(root: string, relativePath: string, content: string | Uint8Array): Promise<void> {
  const file = path.join(root, ...relativePath.split("/"));
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, content);
}

export async function prdWorkspace(options: FixtureOptions = {}): Promise<string> {
  const root = await copyFixtureWorkspace("valid-basic");
  await writePrd(root, PRD_PATH, buildPrd(options));
  return root;
}

export async function cli(root: string, ...args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  const streams = { stdout: new PassThrough(), stderr: new PassThrough() };
  const code = await main(["--root", root, "prd", ...args], streams);
  return { code, stdout: streams.stdout.read()?.toString() ?? "", stderr: streams.stderr.read()?.toString() ?? "" };
}

export async function cliJson<T = unknown>(root: string, ...args: string[]): Promise<{ code: number; json: T }> {
  const { code, stdout } = await cli(root, ...args, "--json");
  return { code, json: JSON.parse(stdout) as T };
}

export async function mcp<T = unknown>(root: string, tool: string, input: Record<string, unknown>): Promise<Answer<T>> {
  return (await createMcpServer({ root }).callTool(tool, input)) as Answer<T>;
}
