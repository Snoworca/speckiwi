import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { main } from "../../../src/cli/index.js";
import { createTestMcpServer } from "../../../src/mcp/adapter.js";
import { registerMutationTools } from "../../../src/mcp/tools/mutation-tools.js";
import { resolveProjectRoot } from "../../../src/core/project-root.js";
import { supersedeRequirement } from "../../../src/core/mutation/supersede-requirement.js";
import { copyFixtureWorkspace } from "../../fixtures/fixture-utils.js";

// Verification probes, round 15: supersede drops the rollup-sync failure its own steps report.

const INDEX = path.join("docs", "spec", "00.index.md");
const WARNING = { code: "INDEX_ROLLUP_SYNC_FAILED", severity: "warning" };

/** valid-basic with its planned Status Summary row read cut, so a sync that must change planned fails. */
async function cutPlanned(): Promise<string> {
  const rootPath = await copyFixtureWorkspace("valid-basic");
  const file = path.join(rootPath, INDEX);
  const text = (await readFile(file, "utf8")).replace(/\r\n/g, "\n");
  await writeFile(file, text.replace("| planned | 1 |", "| planned \\| x | 1 |"), "utf8");
  return rootPath;
}

const SUCCESSOR = { oldId: "FR-ARCH-001", scope: "ARCH", target: "v1.0.0", title: "Successor", statement: "The system shall succeed.", acceptanceCriteria: ["succeeds"], confirmDiscardVerified: true };

describe("a supersede whose follow-up rollup sync fails", () => {
  // @req FR-NODE-045 AC-1
  it("S1 core supersede reports the written change with rollupSync and the warning", async () => {
    const root = await resolveProjectRoot(await cutPlanned());
    const result = await supersedeRequirement(root, SUCCESSOR);
    expect(result.ok).toBe(true);
    expect(result.value?.written).toBe(true);
    expect({ rollupSync: (result as { rollupSync?: unknown }).rollupSync !== undefined, warning: result.diagnostics.some((item) => item.code === WARNING.code) }).toEqual({ rollupSync: true, warning: true });
  });

  // @req IR-CLI-112 AC-1
  it("S2 MCP supersede_requirement answers ok with the warning", async () => {
    const root = await cutPlanned();
    const server = createTestMcpServer({ root });
    registerMutationTools(server, { root });
    const { oldId, scope, target, title, statement, acceptanceCriteria } = SUCCESSOR;
    const result = (await server.callTool("supersede_requirement", { oldId, scope, target, title, statement, acceptanceCriteria })) as { ok: boolean; diagnostics: { code: string }[] };
    expect(result.ok).toBe(true);
    expect(result.diagnostics.some((item) => item.code === WARNING.code)).toBe(true);
  });

  // @req IR-CLI-112 AC-1
  it("S3 CLI supersede --json prints the warning", async () => {
    const root = await cutPlanned();
    const io = { stdout: new PassThrough(), stderr: new PassThrough() };
    const code = await main(["--root", root, "supersede", "--old", "FR-ARCH-001", "--scope", "ARCH", "--target", "v1.0.0", "--new-title", "Successor", "--new-statement", "The system shall succeed.", "--ac", "succeeds", "--confirm-discard-verified", "--apply", "--json"], io);
    const output = JSON.parse(io.stdout.read()?.toString() ?? "{}");
    expect({ code, ok: output.ok, warning: (output.diagnostics ?? []).some((item: { code: string }) => item.code === WARNING.code) }).toEqual({ code: 0, ok: true, warning: true });
  });
});
