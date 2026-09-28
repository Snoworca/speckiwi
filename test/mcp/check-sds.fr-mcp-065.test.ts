import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { PassThrough } from "node:stream";
import { afterAll, describe, expect, it } from "vitest";
import { main } from "../../src/cli/index.js";
import { createMcpServer, isReadOnlyTool, toolSchemas } from "../../src/mcp/server.js";
import { copyFixtureWorkspace } from "../fixtures/fixture-utils.js";
import { cleanupFixtures, gitWorkspaceRepo, linkedWorktree } from "./support/workspace-root-fixture.js";

// FR-MCP-065 — `check_sds` answers what `speckiwi sds check --json` answers, read-only, and takes a
// per-call workspaceRoot like the other SRS read tools.
//
// The per-call case uses two checkouts that differ in the file being checked: the host has no SDS at
// that path and the linked worktree has one. An implementation that admitted the argument at the gate
// and then read the startup root would answer NOT_FOUND inside an envelope claiming the worktree.

interface Answer {
  ok: boolean;
  value?: { path: string; passed: boolean; errors: Array<{ code: string }>; summary: { requirementIds: string[] } };
  error?: { code?: string; reason?: string };
  mcpWorkspace?: { workspaceRoot?: string; rootSource?: string };
}

function io() {
  return { stdout: new PassThrough(), stderr: new PassThrough() };
}

function drain(stream: PassThrough): string {
  return stream.read()?.toString() ?? "";
}

function sds(reqId: string): string {
  return [
    "# SDS: demo",
    "",
    "| Field | Value |",
    "|---|---|",
    "| Document Type | sds |",
    "| Profile | lite |",
    "| Target | v1.0.0 |",
    "| Status | draft |",
    "| Date | 2026-09-27 |",
    "",
    "## Interfaces",
    "",
    "### Files",
    "",
    `- \`src/demo.ts\` — lists requirements @req ${reqId}`,
    "  - `listRequirements(root: string): string[]` — returns ids ← cli",
    "",
    "## Acceptance Contracts",
    "",
    "- SDS-AC-1 (FR-ARCH-001 AC-1): WHEN the workspace holds one requirement THE SYSTEM SHALL list it → `listRequirements`",
    "",
    "## Test Plan",
    "",
    "| SDS-AC | Test file | Case summary |",
    "|---|---|---|",
    "| SDS-AC-1 | `test/demo.test.ts` | one requirement listed |",
    ""
  ].join("\n");
}

async function withSds(root: string, reqId: string): Promise<void> {
  await mkdir(path.join(root, "docs", "sds"), { recursive: true });
  await writeFile(path.join(root, "docs", "sds", "demo.sds.md"), sds(reqId), "utf8");
}

afterAll(async () => {
  await cleanupFixtures();
});

describe("FR-MCP-065 — check_sds", () => {
  it("FR-MCP-065 AC-1: returns the same diagnostics and summary as speckiwi sds check --json", async () => {
    for (const reqId of ["FR-ARCH-001", "FR-ARCH-999"]) {
      const root = await copyFixtureWorkspace("valid-basic");
      await withSds(root, reqId);
      const streams = io();
      await main(["--root", root, "sds", "check", "docs/sds/demo.sds.md", "--json"], streams);
      const cli = JSON.parse(drain(streams.stdout)) as unknown;
      const answer = (await createMcpServer({ root }).callTool("check_sds", { path: "docs/sds/demo.sds.md" })) as Answer;
      expect(answer.ok).toBe(true);
      expect(answer.value, reqId).toEqual(cli);
    }
  });

  it("FR-MCP-065 AC-1: is read-only and reports a missing file as NOT_FOUND", async () => {
    expect(isReadOnlyTool("check_sds")).toBe(true);
    const root = await copyFixtureWorkspace("valid-basic");
    const answer = (await createMcpServer({ root }).callTool("check_sds", { path: "docs/sds/none.sds.md" })) as Answer;
    expect(answer.ok).toBe(false);
    expect(answer.error?.code).toBe("NOT_FOUND");
  });

  it("FR-MCP-065 AC-1: advertises workspaceRoot and answers from the named worktree", async () => {
    expect(Object.keys(toolSchemas.check_sds ?? {})).toContain("workspaceRoot");
    const host = await gitWorkspaceRepo("fr-mcp-065-host");
    const worktree = await linkedWorktree(host, "fr-mcp-065-wt", "fr-mcp-065");
    await withSds(worktree, "FR-ARCH-999");
    const server = createMcpServer({ root: host });

    const fromHost = (await server.callTool("check_sds", { path: "docs/sds/demo.sds.md" })) as Answer;
    expect(fromHost.error?.code).toBe("NOT_FOUND");

    const fromWorktree = (await server.callTool("check_sds", { path: "docs/sds/demo.sds.md", workspaceRoot: worktree })) as Answer;
    expect(fromWorktree.ok).toBe(true);
    expect(fromWorktree.value?.errors.map((item) => item.code)).toEqual(["SDS-E062"]);
    expect(fromWorktree.mcpWorkspace).toMatchObject({ workspaceRoot: worktree, rootSource: "per-call-workspace-root" });
  }, 60_000);
});
