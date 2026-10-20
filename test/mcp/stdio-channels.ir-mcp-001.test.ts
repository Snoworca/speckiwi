import { execFile, spawn } from "node:child_process";
import { cp, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..");
const BIN = path.join(REPO_ROOT, "bin", "speckiwi");

/**
 * IR-MCP-001 AC-1..AC-4 / IR-CLI-045 AC-1..AC-4 — `speckiwi mcp` is a stdio JSON-RPC server: stdout
 * carries MCP messages and nothing else; anything for a human goes to stderr. Raw pipes rather than
 * the SDK client, so a stray line on stdout is seen instead of being swallowed by a parser.
 */

let home = "";
let project = "";

beforeAll(async () => {
  await execFileAsync(process.execPath, [path.join(REPO_ROOT, "node_modules", "typescript", "bin", "tsc"), "-p", "tsconfig.json"], { cwd: REPO_ROOT });
  home = await mkdtemp(path.join(tmpdir(), "speckiwi-stdio-home-"));
  project = path.join(home, "project");
  await cp(path.join(REPO_ROOT, "test", "fixtures", "workspaces", "valid-basic"), project, { recursive: true });
}, 300_000);

afterAll(async () => {
  if (home) await rm(home, { recursive: true, force: true });
});

function homeEnv(): NodeJS.ProcessEnv {
  const parsed = path.parse(home);
  return { ...process.env, HOME: home, USERPROFILE: home, HOMEDRIVE: parsed.root.replace(/\\$/, ""), HOMEPATH: home.slice(parsed.root.length - 1) };
}

/** Runs `speckiwi <args>` in the project, writes `requests` as JSON-RPC lines, and collects both streams. */
async function run(args: string[], requests: object[]): Promise<{ stdout: string; stderr: string; code: number | null }> {
  const child = spawn(process.execPath, [BIN, ...args], { cwd: project, env: homeEnv(), stdio: ["pipe", "pipe", "pipe"] });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => (stdout += chunk));
  child.stderr.on("data", (chunk) => (stderr += chunk));
  const exited = new Promise<number | null>((resolve) => child.on("exit", (code) => resolve(code)));
  for (const request of requests) child.stdin.write(`${JSON.stringify(request)}\n`);
  const want = requests.filter((request) => "id" in request).length;
  const deadline = Date.now() + 20_000;
  while (stdout.split("\n").filter((line) => line.trim() !== "").length < want && Date.now() < deadline && child.exitCode === null) {
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  child.stdin.end();
  const code = await Promise.race([exited, new Promise<null>((resolve) => setTimeout(() => (child.kill(), resolve(null)), 5_000))]);
  return { stdout, stderr, code };
}

const INITIALIZE = { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "raw-stdio-test", version: "1.0.0" } } };
const INITIALIZED = { jsonrpc: "2.0", method: "notifications/initialized" };
const LIST = { jsonrpc: "2.0", id: 2, method: "tools/list" };

function messages(stdout: string): Array<Record<string, unknown>> {
  return stdout
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

describe("IR-MCP-001 / IR-CLI-045 — the stdio server and its two streams", () => {
  for (const args of [["mcp"], ["mcp", "--transport", "stdio"]]) {
    it(`IR-MCP-001 AC-1 AC-2 AC-3 / IR-CLI-045 AC-1 AC-2 AC-3: \`speckiwi ${args.join(" ")}\` answers JSON-RPC on stdout and prints nothing else there`, async () => {
      const { stdout } = await run(args, [INITIALIZE, INITIALIZED, LIST]);
      const lines = stdout.split("\n").filter((line) => line.trim() !== "");
      expect(lines.length, "one response per request").toBe(2);
      for (const line of lines) {
        expect(() => JSON.parse(line), `stdout carries only JSON-RPC: ${line.slice(0, 80)}`).not.toThrow();
      }
      const replies = messages(stdout);
      expect(replies.every((message) => message.jsonrpc === "2.0")).toBe(true);
      expect(replies.map((message) => message.id)).toEqual([1, 2]);
      expect((replies[1]?.result as { tools?: unknown[] } | undefined)?.tools?.length).toBeGreaterThan(0);
    }, 60_000);
  }

  for (const args of [["mcp", "--transport", "bogus"], ["mcp", "--root", "C:/anywhere"]]) {
    it(`IR-MCP-001 AC-4 / IR-CLI-045 AC-4: \`speckiwi ${args.join(" ")}\` writes its message to stderr and nothing to stdout`, async () => {
      const { stdout, stderr, code } = await run(args, []);
      expect(stdout).toBe("");
      expect(stderr.trim().length).toBeGreaterThan(0);
      expect(code).toBe(2);
    }, 60_000);
  }
});
