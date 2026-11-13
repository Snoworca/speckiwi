import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { PassThrough } from "node:stream";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { main } from "../../src/cli/index.js";
import { renderAgentInstructionSnippet } from "../../src/core/bootstrap/templates.js";
import type { McpServerHandle, McpToolHandler, McpToolMetadata } from "../../src/mcp/adapter.js";
import { createMcpServer } from "../../src/mcp/server.js";
import { registerMutationTools } from "../../src/mcp/tools/mutation-tools.js";
import { acceptsPerCallWorkspaceRoot, registerReadTools } from "../../src/mcp/tools/read-tools.js";
import { cleanupFixtures, gitWorkspaceRepo, linkedWorktree, rawGit, tempDir } from "./support/workspace-root-fixture.js";

// IR-MCP-013 — a lane worker checks its own worktree's review rounds through the host MCP: the host
// server is bound to the run root, the run state lives in the lane, and `workspaceRoot` names the lane.
// The host and the lane hold different states under the same run ID, so an answer read from the wrong
// checkout cannot pass for the right one.

const RUN = "rfl-lane-1";
const STATE = `.kiwi/sessions/${RUN}/state.json`;
const TOOL = "check_review_round";

interface Answer {
  ok: boolean;
  value?: { verdict: string; reasons: string[]; scope: { missingFiles: string[] }; counts: Record<string, unknown> };
  error?: { code?: string; reason?: string; message?: string };
  mcpWorkspace?: { workspaceRoot?: string; rootSource?: string };
}

/** git with the environment's repository overrides removed, so `-C` alone picks the repository. */
function git(root: string, args: string[], env: Record<string, string> = {}): string {
  const clean = { ...process.env };
  for (const name of ["GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE", "GIT_COMMON_DIR", "GIT_OBJECT_DIRECTORY"]) delete clean[name];
  return execFileSync("git", ["-C", root, ...args], { encoding: "utf8", env: { ...clean, ...env } }).trim();
}

/** FR-NODE-274's snapshot method, with the temporary index outside the checkout (a lane's `.git` is a file). */
async function snapshot(root: string, scratch: string): Promise<string> {
  const index = path.join(scratch, "snapshot-index");
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
    findings: []
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

/** What each read and mutation tool registers with, read off the registration surface. */
function registrations(root: string): Map<string, { arity: number; metadata: McpToolMetadata | undefined }> {
  const captured = new Map<string, { arity: number; metadata: McpToolMetadata | undefined }>();
  const probe = {
    tools: {} as Record<string, McpToolHandler>,
    resourceTemplates: [] as string[],
    toolKinds: {} as Record<string, never>,
    registerTool(name: string, handler: McpToolHandler, metadata?: McpToolMetadata) {
      captured.set(name, { arity: handler.length, metadata });
    },
    registerResource() {
      /* resources carry no workspace metadata */
    },
    async callTool() {
      throw new Error("the registration probe never calls a tool");
    }
  } as unknown as McpServerHandle;
  registerReadTools(probe, { root });
  registerMutationTools(probe, { root });
  return captured;
}

const sameDir = (a: string, b: string): boolean => path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();

let host = "";
let lane = "";
let foreign = "";
/** Both checkouts as they stood before any call of this file, so an idempotent write by an earlier call still shows. */
let untouched: Awaited<ReturnType<typeof bothCheckouts>>;

async function bothCheckouts() {
  return {
    hostGit: await fingerprint(path.join(host, ".git")),
    hostSpec: await fingerprint(path.join(host, "docs", "spec")),
    hostKiwi: await fingerprint(path.join(host, ".kiwi")),
    laneGitFile: await readFile(path.join(lane, ".git")),
    laneKiwi: await fingerprint(path.join(lane, ".kiwi"))
  };
}

beforeAll(async () => {
  // .git first, then the top level it resolves to is checked before anything is written.
  host = await gitWorkspaceRepo("ir-mcp-013-host");
  expect(sameDir(await rawGit(host, "rev-parse", "--show-toplevel"), host)).toBe(true);
  lane = await linkedWorktree(host, "ir-mcp-013-lane", "lane");
  expect(sameDir(await rawGit(lane, "rev-parse", "--show-toplevel"), lane)).toBe(true);
  foreign = await gitWorkspaceRepo("ir-mcp-013-foreign");
  expect(sameDir(await rawGit(foreign, "rev-parse", "--show-toplevel"), foreign)).toBe(true);

  // The lane has no SRS index: the check reads run state, not the SRS (AC-3).
  await rm(path.join(lane, "docs", "spec"), { recursive: true, force: true });
  const scratch = await tempDir("ir-mcp-013-index");
  const first = await snapshot(lane, scratch);
  await mkdir(path.join(lane, "src"), { recursive: true });
  await writeFile(path.join(lane, "src", "a.ts"), "export const a = 1;\n", "utf8");
  await writeState(lane, [round(1, first, [])]);
  const second = await snapshot(lane, scratch);
  // Round 2 lists none of the change since round 1, so the lane's verdict is CONTINUE on scope.
  await writeState(lane, [round(1, first, []), round(2, second, [])]);

  // The host's state under the same run ID passes, so a lane call answered from the host reads PASS.
  await writeState(host, [round(1, await snapshot(host, scratch), [])]);
  await writeState(foreign, [round(1, await snapshot(foreign, scratch), [])]);
  untouched = await bothCheckouts();
}, 120_000);

afterAll(async () => {
  await rawGit(host, "worktree", "prune").catch(() => "");
  await cleanupFixtures();
});

describe("IR-MCP-013 — check_review_round answers from the per-call workspace root", { timeout: 120_000 }, () => {
  // @req IR-MCP-013 AC-1
  it("reads the lane's run state, answers as the CLI does in the lane, and reports the lane in the envelope", async () => {
    const tool = (await createMcpServer({ root: host }).callTool(TOOL, { runId: RUN, workspaceRoot: lane })) as Answer;
    const command = await cli(lane);
    expect(command.code).toBe(0);
    const printed = JSON.parse(command.stdout) as NonNullable<Answer["value"]>;

    expect(tool.error).toBeUndefined();
    expect(tool.ok).toBe(true);
    // The answer's own content, not only the envelope: the lane's round 2 misses src/a.ts.
    expect(tool.value?.verdict).toBe("CONTINUE");
    expect(tool.value?.scope.missingFiles).toEqual(["src/a.ts"]);
    expect({ verdict: tool.value?.verdict, reasons: tool.value?.reasons, counts: tool.value?.counts, scope: tool.value?.scope }).toEqual({
      verdict: printed.verdict,
      reasons: printed.reasons,
      counts: printed.counts,
      scope: printed.scope
    });
    expect(sameDir(tool.mcpWorkspace?.workspaceRoot ?? "", lane)).toBe(true);
    expect(tool.mcpWorkspace?.rootSource).toBe("per-call-workspace-root");
  });

  // @req IR-MCP-013 AC-2
  it("answers from the startup root when the argument is omitted", async () => {
    const tool = (await createMcpServer({ root: host }).callTool(TOOL, { runId: RUN })) as Answer;
    expect(tool.ok).toBe(true);
    expect(tool.value?.verdict).toBe("PASS");
    expect(sameDir(tool.mcpWorkspace?.workspaceRoot ?? "", host)).toBe(true);
    expect(tool.mcpWorkspace?.rootSource).toBe("server-cwd-discovery");
  });

  // @req IR-MCP-013 AC-3
  it("declares the worktree-local scope and no caller path, so a lane without an SRS index is admitted", () => {
    expect(acceptsPerCallWorkspaceRoot(TOOL)).toBe(true);
    const registered = registrations(host).get(TOOL);
    expect(registered?.metadata).toMatchObject({ readOnlyHint: true, workspaceScope: "worktree-local", callerPathKeys: [] });
    expect(registered?.arity, "the handler must take the call context").toBeGreaterThanOrEqual(2);
    expect(existsSync(path.join(lane, "docs", "spec", "00.index.md"))).toBe(false);
  });

  // @req IR-MCP-013 AC-3
  it("refuses a checkout of another repository before reading its state", async () => {
    const refused = (await createMcpServer({ root: host }).callTool(TOOL, { runId: RUN, workspaceRoot: foreign })) as Answer;
    expect(refused.ok).toBe(false);
    expect(refused.error?.reason).toBe("workspace-root-foreign-repository");
    expect(refused.value).toBeUndefined();
  });

  // @req IR-MCP-013 AC-4
  // Compared with the checkouts as setup left them, not with a baseline taken just before this call:
  // the calls above already ran, and a write that repeats the same bytes would hide behind a later one.
  it("writes nothing in either checkout", async () => {
    const tool = (await createMcpServer({ root: host }).callTool(TOOL, { runId: RUN, workspaceRoot: lane })) as Answer;
    expect(tool.ok).toBe(true);
    expect(await bothCheckouts()).toEqual(untouched);
  });
});

describe("IR-MCP-013 — the documents name the tool", () => {
  // @req IR-MCP-013 AC-5 — the per-call root list in the managed block and both README rows.
  it("the managed agent instruction block's list names check_review_round", () => {
    const line = renderAgentInstructionSnippet()
      .split(/\r?\n/)
      .find((candidate) => candidate.startsWith("3. The SRS query tools"));
    expect((line ?? "").split(" — ")[0]).toContain(`\`${TOOL}\``);
  });

  it("both README rows name check_review_round", () => {
    const rows = readFileSync("README.md", "utf8")
      .split(/\r?\n/)
      .filter((row) => row.startsWith("| The SRS query tools — ") || row.startsWith("| SRS 조회 도구 — "));
    expect(rows.length).toBe(2);
    for (const row of rows) expect(row.split(" | ")[0]).toContain(`\`${TOOL}\``);
  });

  // @req IR-MCP-013 AC-6 — every rendering of the review loop and its mirror tells a lane run how to call the check.
  const LANE_SENTENCE =
    "워커 워크트리 같은 linked worktree 에서 돌면 회차 검사도 그 워크트리를 읽는다 — MCP `check_review_round` 에 `workspaceRoot` = 그 워크트리 절대 경로를 주고, CLI 면 그 워크트리를 cwd 로 부른다.";
  it.each(["skills/claude", "skills/codex", "skills/etc", ".agents/skills"])("%s kiwi-review-fix-loop tells a lane run to pass its worktree", (root) => {
    const text = readFileSync(path.join(root, "kiwi-review-fix-loop", "SKILL.md"), "utf8");
    expect(text).toContain(LANE_SENTENCE);
  });
});
