import { execFile } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

// verify-v536-r1 bundle B — IR-CLI-093 AC-7, second clause: a `--role host` root that differs from
// the MCP root is refused by the equality gate, which runs first, as `roots-differ`.
// Two plain repositories (no worktree) are enough for "differs from the MCP root".

const run = promisify(execFile);
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const CLI = path.join(REPO_ROOT, "bin", "speckiwi");

async function repo(prefix: string): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), prefix));
  await run("git", ["-C", dir, "init", "-q", "--initial-branch", "main"]);
  await run("git", ["-C", dir, "config", "user.name", "v536"]);
  await run("git", ["-C", dir, "config", "user.email", "v536@example.invalid"]);
  await run("git", ["-C", dir, "config", "commit.gpgsign", "false"]);
  await writeFile(path.join(dir, "a.txt"), "a\n");
  await run("git", ["-C", dir, "add", "."]);
  await run("git", ["-C", dir, "commit", "-q", "-m", "seed"]);
  return dir;
}

async function preflight(args: string[]): Promise<{ code: number; stdout: string }> {
  try {
    const { stdout } = await run("node", [CLI, "orchestrate", "preflight", "--json", ...args], { encoding: "utf8" });
    return { code: 0, stdout };
  } catch (error) {
    const failure = error as { code?: number; stdout?: string };
    return { code: typeof failure.code === "number" ? failure.code : 1, stdout: failure.stdout ?? "" };
  }
}

describe("IR-CLI-093 AC-7 — a host root that differs from the MCP root", () => {
  it("is refused by the equality gate as roots-differ", async () => {
    const mcpRoot = await repo("v536-b-mcp-");
    const gitRoot = await repo("v536-b-git-");
    const result = await preflight(["--mcp-root", mcpRoot, "--git-root", gitRoot, "--role", "host"]);
    console.log(result.stdout);
    expect(result.code).toBe(2);
    expect(result.stdout).toContain('"reason":"roots-differ"');
  }, 60_000);
});
