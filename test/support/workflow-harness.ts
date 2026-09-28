import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { PassThrough } from "node:stream";
import { main } from "../../src/cli/index.js";
import { createTestMcpServer } from "../../src/mcp/adapter.js";
import { registerMutationTools } from "../../src/mcp/tools/mutation-tools.js";
import { registerReadTools } from "../../src/mcp/tools/read-tools.js";

// The IO the workflow read, work-order and mutation tests share: one way to write a fixture file, to
// run the CLI, to call the MCP tools and to prove a tree was not written.

export type Json = Record<string, unknown>;

export async function writeText(root: string, relativePath: string, text: string): Promise<void> {
  const absolutePath = path.join(root, relativePath);
  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, text, "utf8");
}

export async function readText(root: string, relativePath: string): Promise<string> {
  return readFile(path.join(root, relativePath), "utf8");
}

export function sha256Of(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

/** One JSONL workflow event line (no trailing LF), in the shape kiwi-pm writes. */
export function eventLine(runId: string, status = "TASK_DONE", extra: Json = {}): string {
  return JSON.stringify({ schema_version: "1.0.0", skill: "kiwi-pm", run_id: runId, status, ...extra });
}

/** A JSONL file body: the lines joined with LF and terminated by one. */
export function jsonl(...lines: string[]): string {
  return `${lines.join("\n")}\n`;
}

export interface CliRun {
  code: number;
  json: Json;
}

/** Runs `speckiwi --root <root> <args> --json` in process and parses its stdout. */
export async function runCli(root: string, args: string[]): Promise<CliRun> {
  const stdout = new PassThrough() as unknown as NodeJS.WriteStream;
  const stderr = new PassThrough() as unknown as NodeJS.WriteStream;
  const code = await main(["--root", root, ...args, "--json"], { stdout, stderr });
  const text = stdout.read()?.toString() ?? "";
  return { code, json: text.length > 0 ? (JSON.parse(text) as Json) : {} };
}

/** An MCP server over `root` with the read and mutation tool families registered. */
export function workflowMcp(root: string) {
  const server = createTestMcpServer({ root });
  registerReadTools(server, { root });
  registerMutationTools(server, { root });
  return {
    server,
    call: async (name: string, args: Json = {}): Promise<Json> => (await server.callTool(name, args)) as Json
  };
}

/** Every file under `root` as relativePath → sha256, so "nothing was written" is an exact claim. */
export async function treeDigest(root: string): Promise<Record<string, string>> {
  const digest: Record<string, string> = {};
  const entries = await readdir(root, { recursive: true, withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const absolutePath = path.join(entry.parentPath, entry.name);
    digest[path.relative(root, absolutePath).replace(/\\/g, "/")] = sha256Of(await readFile(absolutePath));
  }
  return digest;
}

/** Rewrites the fixture index's Active Target cell and appends Target Map rows. */
export async function editIndex(root: string, edit: { activeTarget?: string; extraTargetRows?: string[] }): Promise<void> {
  const indexPath = "docs/spec/00.index.md";
  let text = await readText(root, indexPath);
  if (edit.activeTarget !== undefined) text = text.replace(/\| Active Target \| [^|]* \|/, `| Active Target | ${edit.activeTarget} |`);
  for (const row of edit.extraTargetRows ?? []) {
    text = text.replace("| v1.0.0 | release | active | Fixture release |", `| v1.0.0 | release | active | Fixture release |\n${row}`);
  }
  await writeText(root, indexPath, text);
}
