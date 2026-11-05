import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { PassThrough } from "node:stream";
import { main } from "../../src/cli/index.js";
import { createMcpServer } from "../../src/mcp/server.js";
import { copyFixtureWorkspace } from "../fixtures/fixture-utils.js";
import { roadmapText, type ItemSpec } from "../core/roadmap/roadmap-fixture.js";

// Shared by the roadmap surface tests (IR-CLI-115, IR-MCP-009): a valid-basic workspace with a
// docs/roadmap.md, the CLI run in process, and the MCP server called in process.

export const AS_OF = "2026-11-05";

/**
 * Four items over valid-basic (target v1.0.0 active, FR-ARCH-001): a milestone on the target, a
 * feature of it listing the requirement, a paused feature of it, and an idea with no scope.
 */
export const DEFAULT_ITEMS: ItemSpec[] = [
  { n: 1, title: "Release one", fields: { Kind: "milestone", Targets: "v1.0.0", "Planned End": "2026-Q4" } },
  {
    n: 2,
    title: "Feature A",
    fields: { Milestone: "RM-1", Requirements: "FR-ARCH-001", "Planned Start": "2026-11", "Planned End": "2026-11-10" },
    history: [
      ["2026-11-01", "Created", "-", "-", "fixture"],
      ["2026-11-02", "Planned End", "2026-11-03", "2026-11-10", "slip"]
    ]
  },
  {
    n: 3,
    title: "Feature B",
    fields: { Milestone: "RM-1", Lifecycle: "paused" },
    history: [
      ["2026-11-01", "Created", "-", "-", "fixture"],
      ["2026-11-02", "Lifecycle", "open", "paused", "waiting"]
    ]
  },
  { n: 4, title: "An idea" }
];

export interface Answer<T = unknown> {
  ok: boolean;
  value?: T;
  error?: { code?: string; message?: string; reason?: string };
  diagnostics?: unknown[];
  mutation?: unknown;
  mcpWorkspace?: { workspaceRoot?: string; rootSource?: string };
}

export function roadmapFile(root: string): string {
  return path.join(root, "docs", "roadmap.md");
}

/** valid-basic with `items` in docs/roadmap.md, or with no roadmap file when `items` is null. */
export async function roadmapWorkspace(items: ItemSpec[] | null = DEFAULT_ITEMS): Promise<string> {
  const root = await copyFixtureWorkspace("valid-basic");
  if (items !== null) await writeFile(roadmapFile(root), roadmapText(...items), "utf8");
  return root;
}

/** Moves FR-ARCH-001 to in_progress with a Status change note, so a status rule rests on it. */
export async function startRequirement(root: string): Promise<void> {
  const file = path.join(root, "docs", "spec", "10.product-architecture.srs.md");
  const text = await readFile(file, "utf8");
  await writeFile(
    file,
    text
      .replace("| Status | planned |", "| Status | in_progress |")
      .replace("| 2026-05-08 | Created | Fixture |", "| 2026-05-08 | Created | Fixture |\n| 2026-06-01 | Status -> in_progress | started |"),
    "utf8"
  );
}

export async function cli(root: string, ...args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  const streams = { stdout: new PassThrough(), stderr: new PassThrough() };
  const code = await main(["--root", root, "roadmap", ...args], streams);
  return { code, stdout: streams.stdout.read()?.toString() ?? "", stderr: streams.stderr.read()?.toString() ?? "" };
}

export async function cliJson<T = unknown>(root: string, ...args: string[]): Promise<{ code: number; json: T; stdout: string }> {
  const { code, stdout } = await cli(root, ...args, "--json");
  return { code, json: JSON.parse(stdout) as T, stdout };
}

export async function mcp<T = unknown>(root: string, tool: string, input: Record<string, unknown>): Promise<Answer<T>> {
  return (await createMcpServer({ root }).callTool(tool, input)) as Answer<T>;
}
