import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { main } from "../../../src/cli/index.js";
import { createTestMcpServer } from "../../../src/mcp/adapter.js";
import { registerMutationTools } from "../../../src/mcp/tools/mutation-tools.js";
import { copyFixtureWorkspace } from "../../fixtures/fixture-utils.js";

// IR-CLI-112 — when the rollup sync that follows a written change fails, the CLI and the MCP tool both
// show it: the result is ok, and the INDEX_ROLLUP_SYNC_FAILED warning tells the user to run sync-index.

const INDEX = path.join("docs", "spec", "00.index.md");

/** valid-basic with its planned Status Summary row read cut, so the sync after a status change fails. */
async function cutRollup(): Promise<string> {
  const rootPath = await copyFixtureWorkspace("valid-basic");
  const file = path.join(rootPath, INDEX);
  const text = (await readFile(file, "utf8")).replace(/\r\n/g, "\n");
  expect(text).toContain("| planned | 1 |");
  await writeFile(file, text.replace("| planned | 1 |", "| planned \| x | 1 |"), "utf8");
  return rootPath;
}

const WARNING = { code: "INDEX_ROLLUP_SYNC_FAILED", severity: "warning", message: expect.stringMatching(/speckiwi sync-index/) };

describe("IR-CLI-112 a failed follow-up rollup sync is shown by the CLI and MCP", () => {
  // @req IR-CLI-112 AC-1
  it("CLI update-status --json exits 0 and prints the warning and rollupSync", async () => {
    const root = await cutRollup();
    const io = { stdout: new PassThrough(), stderr: new PassThrough() };
    expect(await main(["--root", root, "update-status", "FR-ARCH-001", "in_progress", "--json"], io)).toBe(0);
    const output = JSON.parse(io.stdout.read()?.toString() ?? "");
    expect(output).toMatchObject({ ok: true, rollupSync: { ok: false }, diagnostics: expect.arrayContaining([expect.objectContaining(WARNING)]) });
  });

  // @req IR-CLI-112 AC-1
  it("CLI update-status in human output names the warning", async () => {
    const root = await cutRollup();
    const io = { stdout: new PassThrough(), stderr: new PassThrough() };
    expect(await main(["--root", root, "update-status", "FR-ARCH-001", "in_progress"], io)).toBe(0);
    const printed = `${io.stdout.read()?.toString() ?? ""}${io.stderr.read()?.toString() ?? ""}`;
    expect(printed).toMatch(/INDEX_ROLLUP_SYNC_FAILED|speckiwi sync-index/);
  });

  // @req IR-CLI-112 AC-1
  it("MCP update_status answers ok with the warning", async () => {
    const root = await cutRollup();
    const server = createTestMcpServer({ root });
    registerMutationTools(server, { root });
    const result = await server.callTool("update_status", { id: "FR-ARCH-001", status: "in_progress" });
    expect(result).toMatchObject({ ok: true, rollupSync: { ok: false, code: "MUTATION_DENIED" }, diagnostics: expect.arrayContaining([expect.objectContaining(WARNING)]) });
  });
});
