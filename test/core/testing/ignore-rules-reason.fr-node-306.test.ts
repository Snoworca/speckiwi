import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { PassThrough } from "node:stream";
import { afterAll, describe, expect, it, vi } from "vitest";
import { main } from "../../../src/cli/index.js";
import * as rootFacts from "../../../src/core/root-facts.js";
import { findTestFiles } from "../../../src/core/testing/test-citations.js";
import { createMcpServer } from "../../../src/mcp/server.js";
import { copyFixtureWorkspace } from "../../fixtures/fixture-utils.js";
import { cleanupFixtures, gitWorkspaceRepo, tempDir } from "../../mcp/support/workspace-root-fixture.js";

// @req FR-NODE-306 — when the git ignore rules were not applied, the report says why: git stopped at
// its time limit, git that could not be started, or git that ended with a failing status.

vi.mock("../../../src/core/root-facts.js", async (importOriginal) => {
  const actual = await importOriginal<typeof rootFacts>();
  return { ...actual, git: vi.fn(actual.git) };
});

vi.setConfig({ testTimeout: 60_000 });

afterAll(async () => {
  await cleanupFixtures();
});

interface Reason {
  kind: string;
  status: number | null;
  stderr: string | null;
}

interface Report {
  testFileCount: number;
  ignoreRules: string;
  ignoreRulesReason: Reason | null;
}

async function put(root: string, relative: string, content: string): Promise<void> {
  await mkdir(path.dirname(path.join(root, relative)), { recursive: true });
  await writeFile(path.join(root, relative), content);
}

async function coverage(root: string, ...args: string[]): Promise<{ code: number; stdout: string }> {
  const streams = { stdout: new PassThrough(), stderr: new PassThrough() };
  const code = await main(["--root", root, "coverage", "--tests", "--ids", "FR-ARCH-001", ...args], streams);
  return { code, stdout: streams.stdout.read()?.toString() ?? "" };
}

async function report(root: string): Promise<Report> {
  const { code, stdout } = await coverage(root, "--json");
  expect(code, stdout).toBe(0);
  return JSON.parse(stdout) as Report;
}

/** A copy of valid-basic outside any repository: git answers it with status 128. */
async function noRepository(): Promise<string> {
  const root = await copyFixtureWorkspace("valid-basic");
  await put(root, "test/a.test.ts", "// FR-ARCH-001 AC-1\n");
  const outside = (() => {
    try {
      execFileSync("git", ["-C", root, "rev-parse", "--show-toplevel"], { stdio: "pipe" });
      return false;
    } catch {
      return true;
    }
  })();
  expect(outside, `${root} must lie in no git repository`).toBe(true);
  return root;
}

/** Runs `call` with git missing from PATH, restoring PATH whatever happens. */
async function withoutGit<T>(call: () => Promise<T>): Promise<T> {
  const saved = process.env.PATH;
  process.env.PATH = "";
  try {
    return await call();
  } finally {
    process.env.PATH = saved;
  }
}

describe("FR-NODE-306 AC-3 — the git runner tells a time limit and a missing git apart", () => {
  // @req FR-NODE-306 AC-3
  it("reports a run stopped at its time limit as timeout, keeping code, stdout and stderr", async () => {
    const dir = await tempDir("fr-node-306-timeout");
    // `hash-object --stdin` waits for input that never ends: only the time limit stops it.
    const answer = await rootFacts.git(dir, ["hash-object", "--stdin"], undefined, undefined, 300);
    expect(answer.failure).toBe("timeout");
    expect(answer.code).toBeNull();
    expect(typeof answer.stdout).toBe("string");
    expect(typeof answer.stderr).toBe("string");
  });

  // @req FR-NODE-306 AC-3
  it("reports a git that cannot be started as unavailable", async () => {
    const dir = await tempDir("fr-node-306-unavailable");
    const answer = await withoutGit(() => rootFacts.git(dir, ["--version"]));
    expect(answer.failure).toBe("unavailable");
    expect(answer.code).toBeNull();
  });

  // @req FR-NODE-306 AC-3
  it("leaves an exit status as it was, with no failure kind", async () => {
    const root = await noRepository();
    const answer = await rootFacts.git(root, ["rev-parse", "--show-toplevel"]);
    expect(answer.code).toBe(128);
    expect(answer.failure).toBeUndefined();
  });
});

describe("FR-NODE-306 AC-1 AC-2 — the report says why the rules were not applied", () => {
  // @req FR-NODE-306 AC-1 AC-2
  it("a root in no repository reports exit, its status and git's first stderr line", async () => {
    const root = await noRepository();
    const value = await report(root);
    expect(value.ignoreRules).toBe("none");
    expect(value.ignoreRulesReason?.kind).toBe("exit");
    expect(value.ignoreRulesReason?.status).toBe(128);
    expect(value.ignoreRulesReason?.stderr ?? "").toMatch(/^fatal: /);
    expect(value.ignoreRulesReason?.stderr ?? "").not.toContain("\n");
    const { stdout } = await coverage(root);
    expect(stdout.split("\n")[0]).toContain("(ids FR-ARCH-001, 1 test files, git ignore rules not applied: exit)");
  });

  // @req FR-NODE-306 AC-1 AC-2
  it("git missing from PATH reports unavailable, on both surfaces", async () => {
    const root = await gitWorkspaceRepo("fr-node-306-nogit");
    await put(root, "test/a.test.ts", "// FR-ARCH-001 AC-1\n");
    await withoutGit(async () => {
      const value = await report(root);
      expect(value.ignoreRules).toBe("none");
      expect(value.ignoreRulesReason).toEqual({ kind: "unavailable", status: null, stderr: null });
      const { stdout } = await coverage(root);
      expect(stdout.split("\n")[0]).toContain("git ignore rules not applied: unavailable)");
      const answer = (await createMcpServer({ root, rootSource: "server-cwd-discovery" }).callTool("check_test_sufficiency", { ids: ["FR-ARCH-001"] })) as {
        ok: boolean;
        value: Report;
      };
      expect(answer.ok, JSON.stringify(answer)).toBe(true);
      expect(answer.value.ignoreRulesReason).toEqual({ kind: "unavailable", status: null, stderr: null });
    });
  });

  // @req FR-NODE-306 AC-1 AC-2
  it("git stopped at its time limit reports timeout", async () => {
    const root = await gitWorkspaceRepo("fr-node-306-timeout-report");
    await put(root, "test/a.test.ts", "// FR-ARCH-001 AC-1\n");
    vi.mocked(rootFacts.git).mockImplementation(async () => ({ code: null, stdout: "", stderr: "", failure: "timeout" }));
    try {
      const value = await report(root);
      expect(value.ignoreRules).toBe("none");
      expect(value.ignoreRulesReason).toEqual({ kind: "timeout", status: null, stderr: null });
      const { stdout } = await coverage(root);
      expect(stdout.split("\n")[0]).toContain("git ignore rules not applied: timeout)");
    } finally {
      vi.mocked(rootFacts.git).mockReset();
      const actual = await vi.importActual<typeof rootFacts>("../../../src/core/root-facts.js");
      vi.mocked(rootFacts.git).mockImplementation(actual.git);
    }
  });

  // @req FR-NODE-306 AC-1
  it("keeps only the first line of a multi-line stderr", async () => {
    const root = await gitWorkspaceRepo("fr-node-306-first-line");
    await put(root, "test/a.test.ts", "// FR-ARCH-001 AC-1\n");
    const search = await (async () => {
      vi.mocked(rootFacts.git).mockImplementation(async () => ({ code: 129, stdout: "", stderr: "error: first\nusage: second\n" }));
      try {
        return await findTestFiles(root);
      } finally {
        vi.mocked(rootFacts.git).mockReset();
        const actual = await vi.importActual<typeof rootFacts>("../../../src/core/root-facts.js");
        vi.mocked(rootFacts.git).mockImplementation(actual.git);
      }
    })();
    expect(search.ignoreRules).toBe("none");
    expect(search.ignoreRulesReason).toEqual({ kind: "exit", status: 129, stderr: "error: first" });
  });

  // @req FR-NODE-306 AC-1
  it("is null when the rules were applied", async () => {
    const root = await gitWorkspaceRepo("fr-node-306-applied");
    await put(root, "test/a.test.ts", "// FR-ARCH-001 AC-1\n");
    const value = await report(root);
    expect(value.ignoreRules).toBe("git");
    expect(value.ignoreRulesReason).toBeNull();
  });
});
