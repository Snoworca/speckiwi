import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { PassThrough } from "node:stream";
import { afterAll, describe, expect, it } from "vitest";
import { main } from "../../src/cli/index.js";
import { createMcpServer, isReadOnlyTool, toolSchemas } from "../../src/mcp/server.js";
import { copyFixtureWorkspace } from "../fixtures/fixture-utils.js";
import { cleanupFixtures, gitWorkspaceRepo, linkedWorktree } from "./support/workspace-root-fixture.js";

// FR-MCP-066 — `check_test_sufficiency` answers what `speckiwi coverage --tests --json` answers for the
// same scope, read-only, and takes a per-call workspaceRoot.
//
// The per-call case gives the linked worktree a test file the host does not have, so the gap FR-ARCH-001
// AC-2 is open at the host and closed in the worktree; the answer has to say which checkout it read.

interface Answer {
  ok: boolean;
  value?: { passed: boolean; gaps: { requirements: Array<{ requirementId: string; acIds: string[] }> } };
  error?: { code?: string; message?: string };
  mcpWorkspace?: { workspaceRoot?: string; rootSource?: string };
}

function io() {
  return { stdout: new PassThrough(), stderr: new PassThrough() };
}

function drain(stream: PassThrough): string {
  return stream.read()?.toString() ?? "";
}

async function put(root: string, relative: string, text: string): Promise<void> {
  await mkdir(path.dirname(path.join(root, relative)), { recursive: true });
  await writeFile(path.join(root, relative), text, "utf8");
}

const SDS = [
  "# SDS: demo",
  "",
  "| Field | Value |",
  "|---|---|",
  "| Document Type | sds |",
  "| Profile | lite |",
  "| Target | v1.0.0 |",
  "| Status | agreed |",
  "| Date | 2026-09-27 |",
  "",
  "## Interfaces",
  "",
  "### Files",
  "",
  "- `src/demo.ts` — demo @req FR-ARCH-001",
  "  - `list(): string[]` — lists ← cli",
  "",
  "## Acceptance Contracts",
  "",
  "- SDS-AC-1 (FR-ARCH-001 AC-1): WHEN one requirement exists THE SYSTEM SHALL list it → `list`",
  "",
  "## Test Plan",
  "",
  "| SDS-AC | Test file | Case summary |",
  "|---|---|---|",
  "| SDS-AC-1 | `test/demo.test.ts` | lists |",
  ""
].join("\n");

async function cli(root: string, ...args: string[]): Promise<unknown> {
  const streams = io();
  await main(["--root", root, "coverage", "--tests", "--json", ...args], streams);
  return JSON.parse(drain(streams.stdout)) as unknown;
}

afterAll(async () => {
  await cleanupFixtures();
});

describe("FR-MCP-066 — check_test_sufficiency", () => {
  it("FR-MCP-066 AC-1: returns the same result as coverage --tests for a target, an id list and an SDS", async () => {
    const root = await copyFixtureWorkspace("valid-basic");
    await put(root, "test/demo.test.ts", "it('FR-ARCH-001 AC-1 SDS-AC-1', () => {});\n");
    await put(root, "docs/sds/demo.sds.md", SDS);
    const server = createMcpServer({ root });
    const cases: Array<[Record<string, unknown>, string[]]> = [
      [{ target: "v1.0.0" }, ["--target", "v1.0.0"]],
      [{ ids: ["FR-ARCH-001"] }, ["--ids", "FR-ARCH-001"]],
      [{ target: "v1.0.0", sds: "docs/sds/demo.sds.md" }, ["--target", "v1.0.0", "--sds", "docs/sds/demo.sds.md"]],
      [{ target: "v1.0.0", testGlob: ["src/**"] }, ["--target", "v1.0.0", "--test-glob", "src/**"]]
    ];
    for (const [input, args] of cases) {
      const answer = (await server.callTool("check_test_sufficiency", input)) as Answer;
      expect(answer.ok, JSON.stringify(input)).toBe(true);
      expect(answer.value, JSON.stringify(input)).toEqual(await cli(root, ...args));
    }
  });

  it("FR-MCP-066 AC-1: is read-only and refuses a contradictory scope the way the CLI does", async () => {
    expect(isReadOnlyTool("check_test_sufficiency")).toBe(true);
    const root = await copyFixtureWorkspace("valid-basic");
    const answer = (await createMcpServer({ root }).callTool("check_test_sufficiency", { target: "v1.0.0", ids: ["FR-ARCH-001"] })) as Answer;
    expect(answer.ok).toBe(false);
    expect(answer.error?.code).toBe("USAGE");
    expect(answer.error?.message, "an MCP caller has no --target flag to pass").not.toMatch(/--(target|ids)\b/);
    const empty = (await createMcpServer({ root }).callTool("check_test_sufficiency", { ids: [] })) as Answer;
    expect(empty.error?.code).toBe("USAGE");
    expect(empty.error?.message, "an MCP caller has no --ids flag to pass").not.toMatch(/--(target|ids)\b/);
  });

  it("FR-MCP-066 AC-1: advertises workspaceRoot and answers from the named worktree", async () => {
    expect(Object.keys(toolSchemas.check_test_sufficiency ?? {})).toContain("workspaceRoot");
    const host = await gitWorkspaceRepo("fr-mcp-066-host");
    const worktree = await linkedWorktree(host, "fr-mcp-066-wt", "fr-mcp-066");
    await put(host, "test/arch.test.ts", "it('FR-ARCH-001 AC-1', () => {});\n");
    await put(worktree, "test/arch.test.ts", "it('FR-ARCH-001 AC-1', () => {});\nit('FR-ARCH-001 AC-2', () => {});\n");
    const server = createMcpServer({ root: host });

    const fromHost = (await server.callTool("check_test_sufficiency", { target: "v1.0.0" })) as Answer;
    expect(fromHost.value?.gaps.requirements).toEqual([{ requirementId: "FR-ARCH-001", acIds: ["AC-2"] }]);

    const fromWorktree = (await server.callTool("check_test_sufficiency", { target: "v1.0.0", workspaceRoot: worktree })) as Answer;
    expect(fromWorktree.ok).toBe(true);
    expect(fromWorktree.value?.passed).toBe(true);
    expect(fromWorktree.mcpWorkspace).toMatchObject({ workspaceRoot: worktree, rootSource: "per-call-workspace-root" });
  }, 60_000);
});
