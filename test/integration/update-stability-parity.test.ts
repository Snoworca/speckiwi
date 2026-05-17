import { readFile } from "node:fs/promises";
import path from "node:path";
import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { main } from "../../src/cli/index.js";
import { createTestMcpServer } from "../../src/mcp/adapter.js";
import { registerMutationTools } from "../../src/mcp/tools/mutation-tools.js";
import { copyFixtureWorkspace } from "../fixtures/fixture-utils.js";

const ARCH_FILE = path.join("docs", "spec", "10.product-architecture.srs.md");

function io() {
  return { stdout: new PassThrough() as NodeJS.WriteStream, stderr: new PassThrough() as NodeJS.WriteStream };
}

async function readArch(rootPath: string): Promise<string> {
  return readFile(path.join(rootPath, ARCH_FILE), "utf8");
}

interface ParityCase {
  label: string;
  cliArgs: string[];
  mcpInput: Record<string, unknown>;
}

const cases: ParityCase[] = [
  {
    label: "stable → evolving with reason",
    cliArgs: ["update-stability", "FR-ARCH-001", "evolving", "--reason", "parity-evolving", "--json"],
    mcpInput: { id: "FR-ARCH-001", stability: "evolving", reason: "parity-evolving" }
  },
  {
    label: "stable → draft (DRAFT marker apply)",
    cliArgs: ["update-stability", "FR-ARCH-001", "draft", "--json"],
    mcpInput: { id: "FR-ARCH-001", stability: "draft" }
  },
  {
    label: "stable → frozen (reason mandatory)",
    cliArgs: ["update-stability", "FR-ARCH-001", "frozen", "--reason", "parity-frozen", "--json"],
    mcpInput: { id: "FR-ARCH-001", stability: "frozen", reason: "parity-frozen" }
  },
  {
    label: "stable → evolving dryRun (no write)",
    cliArgs: ["update-stability", "FR-ARCH-001", "evolving", "--reason", "parity-dry", "--dry-run", "--json"],
    mcpInput: { id: "FR-ARCH-001", stability: "evolving", reason: "parity-dry", dryRun: true }
  }
];

describe("FR-MCP-017 AC-5 — update_stability CLI ↔ MCP byte parity", () => {
  for (const c of cases) {
    it(`produces byte-identical Markdown for: ${c.label}`, async () => {
      const rootCli = await copyFixtureWorkspace("mutation-target");
      const rootMcp = await copyFixtureWorkspace("mutation-target");

      const cliStreams = io();
      const exitCode = await main(["--root", rootCli, ...c.cliArgs], cliStreams);
      expect(exitCode).toBe(0);

      const server = createTestMcpServer({ root: rootMcp });
      registerMutationTools(server, { root: rootMcp });
      const mcpResult = await server.callTool("update_stability", c.mcpInput);
      expect(mcpResult).toMatchObject({ ok: true });

      const cliMarkdown = await readArch(rootCli);
      const mcpMarkdown = await readArch(rootMcp);
      expect(mcpMarkdown).toBe(cliMarkdown);
    });
  }
});
