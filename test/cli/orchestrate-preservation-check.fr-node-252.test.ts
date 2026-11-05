import { rm } from "node:fs/promises";
import path from "node:path";
import { PassThrough } from "node:stream";
import { afterAll, describe, expect, it } from "vitest";
import { main } from "../../src/cli/index.js";
import { ORCHESTRATE_TOOL_BINDINGS, orchestrateVerbKind } from "../../src/cli/commands/orchestrate.js";
import { formatPreservationReport, type PreservationReport } from "../../src/core/orchestrator/preservation.js";
import { cleanupFixtures, commitAll, initRepo, rawGit } from "../core/orchestrator/support/git-fixture.js";
import { writeUnder } from "../core/orchestrator/sds-fixtures.js";
import { orchestrate } from "./wave-graph-fixtures.js";

// FR-NODE-252 AC-1 — `orchestrate preservation check --base <rev> [--head <rev>] --json` is a read
// verb that writes nothing and returns the same rows for the same two revisions.

afterAll(cleanupFixtures);

async function twoCommits(): Promise<{ root: string; base: string; head: string }> {
  const root = await initRepo("preservation-cli");
  await writeUnder(root, "src/api.ts", "export function run(a: number): number { return a; }\n");
  await writeUnder(root, "src/gone.ts", "export const gone = 1;\n");
  const base = await commitAll(root, "base");
  await writeUnder(root, "src/api.ts", "export function run(a: number, b: number): number { return a + b; }\n");
  await rm(path.join(root, "src/gone.ts"));
  const head = await commitAll(root, "head");
  return { root, base, head };
}

type Row = { kind: string; path: string };

describe("FR-NODE-252 AC-1 orchestrate preservation check", () => {
  // @req FR-NODE-252 AC-1
  it("FR-NODE-252 AC-1 reports the rows between two revisions, head defaulting to HEAD, and the same rows each time", async () => {
    const { root, base, head } = await twoCommits();
    const first = await orchestrate(root, ["preservation", "check", "--base", base]);
    expect(first.exit, JSON.stringify(first.payload)).toBe(0);
    const rows = first.payload.rows as Row[];
    expect(rows.map((row) => [row.kind, row.path]).sort()).toEqual([
      ["existing-file-deleted-or-moved", "src/gone.ts"],
      ["existing-public-contract-change", "src/api.ts"],
      ["existing-public-contract-change", "src/gone.ts"]
    ]);
    expect((first.payload.head as Record<string, unknown>).commit).toBe(head);
    const second = await orchestrate(root, ["preservation", "check", "--base", base, "--head", head]);
    expect(second.payload.rows).toEqual(first.payload.rows);
    expect(first.payload.passed).toBe(false);
  });

  // @req FR-NODE-252 AC-1
  it("FR-NODE-252 AC-1 is a read verb that leaves the working tree and the refs unchanged", async () => {
    expect(orchestrateVerbKind(["preservation", "check"])).toBe("read");
    const binding = ORCHESTRATE_TOOL_BINDINGS.find((entry) => entry.tool === "orchestrate_preservation_check");
    expect(binding?.kind).toBe("read");
    expect(binding?.options.map((option) => option.flag).sort()).toEqual(["--base", "--head"]);
    const { root, base } = await twoCommits();
    const refs = await rawGit(root, "show-ref");
    const status = await rawGit(root, "status", "--porcelain", "--ignored");
    const run = await orchestrate(root, ["preservation", "check", "--base", base]);
    expect(run.exit, JSON.stringify(run.payload)).toBe(0);
    expect(await rawGit(root, "show-ref")).toBe(refs);
    expect(await rawGit(root, "status", "--porcelain", "--ignored")).toBe(status);
  });

  // @req FR-NODE-252 AC-1 AC-4
  it("FR-NODE-252 AC-1 AC-4 without --json writes the report as text, with the statement of what it does not check", async () => {
    const { root, base } = await twoCommits();
    const json = await orchestrate(root, ["preservation", "check", "--base", base]);
    const pipes = { stdout: new PassThrough(), stderr: new PassThrough() };
    const exit = await main(["--root", root, "orchestrate", "preservation", "check", "--base", base], pipes);
    expect(exit).toBe(0);
    const report = Object.fromEntries(Object.entries(json.payload).filter(([key]) => key !== "ok" && key !== "violations"));
    expect(pipes.stdout.read()?.toString()).toBe(`${formatPreservationReport(report as unknown as PreservationReport)}\n`);
  });

  // @req FR-NODE-252 AC-1
  it("FR-NODE-252 AC-1 a revision that names no commit is an operational error at exit 1", async () => {
    const { root } = await twoCommits();
    const run = await orchestrate(root, ["preservation", "check", "--base", "no-such-rev"]);
    expect(run.exit).toBe(1);
    expect(String(run.payload.error)).toMatch(/no-such-rev/);
    expect(run.payload).not.toHaveProperty("gate");
  });
});
