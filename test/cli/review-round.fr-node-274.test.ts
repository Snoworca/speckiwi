import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { main } from "../../src/cli/index.js";
import { createMcpServer, isReadOnlyTool } from "../../src/mcp/server.js";
import { acceptsPerCallWorkspaceRoot } from "../../src/mcp/tools/read-tools.js";
import { copyFixtureWorkspace } from "../fixtures/fixture-utils.js";

// FR-NODE-274 — `speckiwi review-round check` and MCP `check_review_round` over a real repository:
// the lead's snapshot method writes the trees, then both surfaces read them and leave every byte as
// it was. The verdict rules themselves are tested over a fake git in test/core/review.

const RUN = "r1";
const STATE = `.kiwi/sessions/${RUN}/state.json`;

/** git with the repository chosen by `-C` alone, as the lead's snapshot runs it. */
function git(root: string, args: string[], env: Record<string, string> = {}): string {
  const clean = { ...process.env };
  for (const name of ["GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE", "GIT_COMMON_DIR", "GIT_OBJECT_DIRECTORY"]) delete clean[name];
  return execFileSync("git", ["-C", root, ...args], { encoding: "utf8", env: { ...clean, ...env } }).trim();
}

/** The Implementation Notes snapshot: a temporary index, `add -A`, `write-tree`, the index removed. */
async function snapshot(root: string): Promise<string> {
  const index = path.join(root, ".git", "snapshot-index");
  const env = { GIT_INDEX_FILE: index };
  git(root, ["read-tree", "HEAD"], env);
  git(root, ["add", "-A"], env);
  const tree = git(root, ["write-tree"], env);
  await rm(index, { force: true });
  return tree;
}

function round(n: number, tree: string, files: string[]): Record<string, unknown> {
  return {
    round: n,
    tree_sha: tree,
    scope: n === 1 ? "full" : "since-prev",
    scope_widen_reason: null,
    files,
    tokens_used: 10,
    residual_count: 0,
    coverage_passed: true,
    findings: n === 1 ? [{ id: "B-1", tier: "block", family: "f", introduced_by_round: null }] : []
  };
}

async function writeState(root: string, rounds: unknown[]): Promise<void> {
  await mkdir(path.join(root, ".kiwi", "sessions", RUN), { recursive: true });
  await writeFile(path.join(root, STATE), JSON.stringify({ limits: { round_cap: 5, token_budget: null }, rounds }), "utf8");
}

/** Every file under `dir` with its SHA-256, so a write anywhere below it shows. */
async function fingerprint(dir: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const entry of await readdir(dir, { recursive: true })) {
    const file = path.join(dir, entry);
    if ((await stat(file)).isFile()) out[entry] = createHash("sha256").update(await readFile(file)).digest("hex");
  }
  return out;
}

async function cli(root: string): Promise<{ code: number; stdout: string }> {
  const streams = { stdout: new PassThrough(), stderr: new PassThrough() };
  const code = await main(["--root", root, "review-round", "check", "--run-id", RUN, "--json"], streams);
  return { code, stdout: streams.stdout.read()?.toString() ?? "" };
}

interface Answer {
  ok: boolean;
  value?: { verdict: string; reasons: string[]; scope: { missingFiles: string[] }; counts: Record<string, unknown> };
  error?: { code?: string; message?: string };
}

describe("FR-NODE-274 — the review-round check over a real repository", () => {
  // @req FR-NODE-274 AC-2 AC-5 AC-6 AC-8
  it("diffs the recorded snapshots, answers the same verdict on both surfaces, refuses a tree that is absent, and writes nothing", async () => {
    const root = await copyFixtureWorkspace("valid-basic");
    git(root, ["init", "-q"]);
    git(root, ["-c", "user.name=t", "-c", "user.email=t@t", "add", "-A"]);
    git(root, ["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "base"]);
    const first = await snapshot(root);
    await mkdir(path.join(root, "src"), { recursive: true });
    await writeFile(path.join(root, "src", "a.ts"), "export const a = 1;\n", "utf8");
    await writeFile(path.join(root, "docs", "notes.md"), "prose\n", "utf8");
    // Extensionless files new since round 1: a #! script is code, plain text is not (read from tree N).
    await writeFile(path.join(root, "run-me"), "#!/bin/sh\necho fixed\n", "utf8");
    await writeFile(path.join(root, "NOTICE"), "plain text\n", "utf8");
    await writeState(root, [round(1, first, [])]);
    const second = await snapshot(root);
    await writeState(root, [round(1, first, []), round(2, second, ["src/other.ts"])]);

    const before = { git: await fingerprint(path.join(root, ".git")), spec: await fingerprint(path.join(root, "docs", "spec")), state: await readFile(path.join(root, STATE)) };
    const command = await cli(root);
    const tool = (await createMcpServer({ root }).callTool("check_review_round", { runId: RUN })) as Answer;

    expect(command.code).toBe(0);
    const printed = JSON.parse(command.stdout) as NonNullable<Answer["value"]>;
    expect(printed.scope.missingFiles).toEqual(["run-me", "src/a.ts"]);
    expect(printed.verdict).toBe("CONTINUE");
    expect(printed.reasons).toEqual(["scope"]);
    expect(tool.ok).toBe(true);
    expect({ verdict: tool.value?.verdict, reasons: tool.value?.reasons, counts: tool.value?.counts, scope: tool.value?.scope }).toEqual({
      verdict: printed.verdict,
      reasons: printed.reasons,
      counts: printed.counts,
      scope: printed.scope
    });
    expect(await fingerprint(path.join(root, ".git"))).toEqual(before.git);
    expect(await fingerprint(path.join(root, "docs", "spec"))).toEqual(before.spec);
    expect(await readFile(path.join(root, STATE))).toEqual(before.state);

    await writeState(root, [round(1, first, []), round(2, "f".repeat(40), [])]);
    const absent = await cli(root);
    expect(absent.code).not.toBe(0);
    expect(absent.stdout).toContain(STATE);
    expect(absent.stdout).toContain("rounds[1].tree_sha");
    const refused = (await createMcpServer({ root }).callTool("check_review_round", { runId: RUN })) as Answer;
    expect(refused.ok).toBe(false);
    expect(refused.value).toBeUndefined();
    expect(refused.error?.message).toContain("rounds[1].tree_sha");

    // A commit is an object, but not a tree: git can diff it, and the check still refuses it.
    await writeState(root, [round(1, first, []), round(2, git(root, ["rev-parse", "HEAD"]), [])]);
    const commit = await cli(root);
    expect(commit.code).not.toBe(0);
    expect(commit.stdout).toContain("rounds[1].tree_sha");
    expect(commit.stdout).toContain("names no tree object");
  });

  // @req FR-NODE-274 AC-6
  it("is classified read-only", () => {
    expect(isReadOnlyTool("check_review_round")).toBe(true);
  });

  // @req FR-NODE-274 AC-8
  it("does not accept a workspaceRoot argument", async () => {
    const root = await copyFixtureWorkspace("valid-basic");
    expect(acceptsPerCallWorkspaceRoot("check_review_round")).toBe(false);
    const refused = (await createMcpServer({ root }).callTool("check_review_round", { runId: RUN, workspaceRoot: root })) as Answer;
    expect(refused.ok).toBe(false);
    expect(JSON.stringify(refused)).toContain("workspaceRoot");
  });
});
