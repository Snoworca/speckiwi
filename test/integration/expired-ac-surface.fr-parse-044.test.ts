import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { PassThrough } from "node:stream";
import { beforeAll, describe, expect, it } from "vitest";
import { main } from "../../src/cli/index.js";
import { createTestMcpServer } from "../../src/mcp/adapter.js";
import { registerReadTools } from "../../src/mcp/tools/read-tools.js";
import { acFixture } from "../core/ac-expiry-fixture.js";

// @req FR-PARSE-044 — the read surfaces carry what the core now reports about expired criteria: the
// block's `expiredAcceptanceCriteria` and the test-sufficiency report's `expiredCitations`, on the CLI
// (JSON and the human coverage report) and over MCP.

let root: string;

async function cli(argv: string[]): Promise<{ code: number; stdout: string }> {
  const streams = { stdout: new PassThrough(), stderr: new PassThrough() };
  const code = await main(["--root", root, ...argv], streams);
  return { code, stdout: streams.stdout.read()?.toString() ?? "" };
}

beforeAll(async () => {
  root = await acFixture({
    acLines: ["- [ ] AC-1: The status can be updated.", "- [ ] AC-2: ~~Evidence can be added.~~ [EXPIRED 2026-11-03 → FR-ARCH-002]"]
  });
  await mkdir(path.join(root, "test"), { recursive: true });
  await writeFile(path.join(root, "test", "arch.test.ts"), "it('FR-ARCH-001 AC-1: live', () => {});\nit('FR-ARCH-001 AC-2: expired', () => {});\n", "utf8");
});

const EXPIRED = { id: "AC-2", expiredOn: "2026-11-03", successor: "FR-ARCH-002" };

describe("FR-PARSE-044 — expired criteria on the read surfaces", () => {
  // @req FR-PARSE-044 AC-1
  it("AC-1: show --json and get_requirement carry the expired criterion outside the live list", async () => {
    const shown = JSON.parse((await cli(["show", "FR-ARCH-001", "--json"])).stdout) as Record<string, unknown>;
    const server = createTestMcpServer({ root });
    registerReadTools(server, { root });
    const fetched = ((await server.callTool("get_requirement", { id: "FR-ARCH-001" })) as { value: Record<string, unknown> }).value;
    for (const record of [shown, fetched]) {
      expect(record.expiredAcceptanceCriteria).toEqual([expect.objectContaining(EXPIRED)]);
      expect((record.acceptanceCriteria as Array<{ id: string }>).map((criterion) => criterion.id)).toEqual(["AC-1"]);
    }
  });

  // @req FR-PARSE-044 AC-3
  it("AC-3: coverage --tests (JSON and human) and check_test_sufficiency list the expired citation apart", async () => {
    const json = JSON.parse((await cli(["coverage", "--tests", "--json", "--ids", "FR-ARCH-001"])).stdout) as Record<string, unknown>;
    const server = createTestMcpServer({ root });
    registerReadTools(server, { root });
    const mcp = ((await server.callTool("check_test_sufficiency", { ids: ["FR-ARCH-001"] })) as { value: Record<string, unknown> }).value;
    for (const report of [json, mcp]) {
      expect(report.expiredCitations).toEqual([expect.objectContaining({ requirementId: "FR-ARCH-001", acId: "AC-2" })]);
    }

    const human = (await cli(["coverage", "--tests", "--ids", "FR-ARCH-001"])).stdout;
    expect(human).toMatch(/^expired FR-ARCH-001 AC-2 cited by test\/arch\.test\.ts:2$/m);
    expect(human).not.toMatch(/^gap FR-ARCH-001 AC-2/m);
  });
});
