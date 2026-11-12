import { mkdir, realpath } from "node:fs/promises";
import path from "node:path";
import { PassThrough } from "node:stream";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { main } from "../../src/cli/index.js";
import { createTestMcpServer } from "../../src/mcp/adapter.js";
import { registerReadTools } from "../../src/mcp/tools/read-tools.js";
import { cleanupFixtures, gitWorkspaceRepo, linkedWorktree, rawGit, tempDir } from "../mcp/support/workspace-root-fixture.js";

// @req IR-CLI-119 — a host preflight refused because the git root is a worktree of the same
// repository says how to open the run there.
//
// 2026-11-12 (OG session, lead's verdict step 7): `orchestrate preflight --mcp-root <main> --git-root
// <worktree>` answered `roots-differ` with the two paths and nothing else, and the session went looking
// for a way to write the worktree's SRS from the main session.

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

const GATE = "run-root-preflight-mismatch";

let host = "";
let worktree = "";
let foreign = "";

/** A repository made first and checked to be its own top level, never an ancestor's. */
async function checkedRepo(prefix: string): Promise<string> {
  const root = await gitWorkspaceRepo(prefix, "mutation-target");
  expect(path.resolve(await rawGit(root, "rev-parse", "--show-toplevel")).toLowerCase()).toBe(path.resolve(await realpath(root)).toLowerCase());
  return root;
}

beforeAll(async () => {
  host = await checkedRepo("ir-cli-119-host-");
  worktree = await linkedWorktree(host, "ir-cli-119-wt-", "ir-cli-119");
  foreign = await checkedRepo("ir-cli-119-foreign-");
});

afterAll(async () => {
  await cleanupFixtures();
});

interface Violation {
  reason: string;
  recovery?: string;
}

async function preflight(args: string[], json = true): Promise<{ code: number; text: string; violations: Violation[]; gate?: string }> {
  const pipes = { stdout: new PassThrough(), stderr: new PassThrough() };
  const code = await main(["orchestrate", "preflight", ...args, ...(json ? ["--json"] : [])], pipes);
  const text = pipes.stdout.read()?.toString() ?? "";
  if (!json) return { code, text, violations: [] };
  const parsed = JSON.parse(text) as { gate?: string; violations?: Violation[] };
  return { code, text, violations: parsed.violations ?? [], ...(parsed.gate ? { gate: parsed.gate } : {}) };
}

function expectRecoveryFor(recovery: string | undefined, root: string): void {
  expect(recovery ?? "").toMatch(/start a new agent session/i);
  // The path as mcp_workspace_info prints it (native separators), so the two compare as text.
  expect(recovery ?? "").toContain(`with ${path.resolve(root)} as its working directory`);
  expect(recovery ?? "").toContain(`its workspaceRoot is ${path.resolve(root)}`);
  expect(recovery ?? "").toContain("another checkout of this repository");
  expect(recovery ?? "").toContain("mcp_workspace_info");
  expect(recovery ?? "").toContain("workspaceRoot");
  expect(recovery ?? "").toMatch(/start the run there/);
  expect(recovery ?? "").toContain("worktree-lane.md");
}

describe("IR-CLI-119 AC-1 — a worktree of the same repository gets the session recovery", () => {
  it("the host refusal of a linked worktree carries the recovery, with gate and exit code unchanged", async () => {
    const answer = await preflight(["--mcp-root", host, "--git-root", worktree]);
    expect(answer.code).toBe(2);
    expect(answer.gate).toBe(GATE);
    expect(answer.violations.map((violation) => violation.reason)).toEqual(["roots-differ"]);
    expectRecoveryFor(answer.violations[0]?.recovery, worktree);
  });

  it("a session in the worktree that names the main tree is sent to the main tree, as another checkout", async () => {
    const answer = await preflight(["--mcp-root", worktree, "--git-root", host]);
    expect(answer.code).toBe(2);
    expect(answer.violations.map((violation) => violation.reason)).toEqual(["roots-differ"]);
    expectRecoveryFor(answer.violations[0]?.recovery, host);
  });

  it("names the worktree as the MCP server would when the git root is given through a link or in another case", async () => {
    // mcp_workspace_info reports the server's realpath of its cwd; the recovery must name the same text.
    const { symlink, realpath: realpathOf } = await import("node:fs/promises");
    const link = path.join(await tempDir("ir-cli-119-link-"), "wt-link");
    await symlink(worktree, link, process.platform === "win32" ? "junction" : "dir");
    const viaLink = await preflight(["--mcp-root", host, "--git-root", link]);
    expect(viaLink.violations[0]?.recovery ?? "").toContain(`its workspaceRoot is ${await realpathOf(worktree)}`);
    if (process.platform === "win32") {
      const lowered = worktree.charAt(0).toLowerCase() + worktree.slice(1);
      const viaCase = await preflight(["--mcp-root", host, "--git-root", lowered]);
      expect(viaCase.violations[0]?.recovery ?? "").toContain(`its workspaceRoot is ${await realpathOf(worktree)}`);
    }
  });

  it("the run passes from that worktree, which is where the recovery sends it (FR-NODE-186 AC-8)", async () => {
    const answer = await preflight(["--mcp-root", worktree, "--git-root", worktree]);
    expect(answer.code).toBe(0);
  });
});

describe("IR-CLI-119 AC-2 — no recovery where the git root is not this repository's worktree", () => {
  it("another repository", async () => {
    const answer = await preflight(["--mcp-root", host, "--git-root", foreign]);
    expect(answer.code).toBe(2);
    expect(answer.violations.map((violation) => violation.recovery)).toEqual([undefined]);
  });

  it("a worktree of this repository that the repository does not register", async () => {
    // A directory whose .git file points at the host's common directory, with no entry under worktrees/.
    const unregistered = await tempDir("ir-cli-119-unreg-");
    const { writeFile } = await import("node:fs/promises");
    await writeFile(path.join(unregistered, ".git"), `gitdir: ${path.join(host, ".git").split(path.sep).join("/")}\n`, "utf8");
    const answer = await preflight(["--mcp-root", host, "--git-root", unregistered]);
    expect(answer.code).toBe(2);
    expect(answer.violations[0]?.reason).toBe("roots-differ");
    expect(answer.violations[0]?.recovery).toBeUndefined();
  });

  it("a path in no repository", async () => {
    const plain = await tempDir("ir-cli-119-plain-");
    const answer = await preflight(["--mcp-root", host, "--git-root", plain]);
    expect(answer.code).toBe(2);
    expect(answer.violations[0]?.reason).toBe("git-root-not-a-repository");
    expect(answer.violations[0]?.recovery).toBeUndefined();
  });

  it("a subdirectory of the worktree", async () => {
    const sub = path.join(worktree, "nested");
    await mkdir(sub, { recursive: true });
    const answer = await preflight(["--mcp-root", host, "--git-root", sub]);
    expect(answer.code).toBe(2);
    expect(answer.violations[0]?.reason).toBe("git-root-not-toplevel");
    expect(answer.violations[0]?.recovery).toBeUndefined();
  });

  it("a lane-role refusal", async () => {
    const plan = path.join(await tempDir("ir-cli-119-plan-"), "lanes.lock.json");
    const { writeFile } = await import("node:fs/promises");
    await writeFile(plan, JSON.stringify({ "lane-1": { writeSet: ["src/a.ts"] } }), "utf8");
    const answer = await preflight(["--mcp-root", host, "--git-root", worktree, "--role", "lane", "--lane-id", "lane-9", "--lane-plan", plan]);
    expect(answer.code).toBe(2);
    expect(answer.violations.every((violation) => violation.recovery === undefined)).toBe(true);
  });
});

describe("IR-CLI-119 AC-3 — the human output and MCP say the same", () => {
  it("prints the recovery without --json", async () => {
    const json = await preflight(["--mcp-root", host, "--git-root", worktree]);
    const human = await preflight(["--mcp-root", host, "--git-root", worktree], false);
    expect(human.code).toBe(2);
    // The refusal renderer prints the payload as JSON in both modes, so the text holds the string encoded.
    expect(human.text).toContain(JSON.stringify(json.violations[0]?.recovery ?? "<no recovery>"));
  });

  it("MCP orchestrate_preflight returns the same recovery", async () => {
    const json = await preflight(["--mcp-root", host, "--git-root", worktree]);
    const server = createTestMcpServer({ root: host });
    registerReadTools(server, { root: host });
    const answer = (await server.callTool("orchestrate_preflight", { mcpRoot: host, gitRoot: worktree })) as { gate?: string; violations?: Violation[] };
    expect(answer.gate).toBe(GATE);
    expect(answer.violations?.[0]?.recovery).toBe(json.violations[0]?.recovery);
    expectRecoveryFor(answer.violations?.[0]?.recovery, worktree);
  });
});
