import { readFile } from "node:fs/promises";
import path from "node:path";
import { PassThrough } from "node:stream";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";
import { main } from "../../../src/cli/index.js";
import { PRIORITY_LEVELS, RISK_LEVELS } from "../../../src/core/types.js";
import { createMcpServer, createSdkServer } from "../../../src/mcp/server.js";
import { copyFixtureWorkspace } from "../../fixtures/fixture-utils.js";

// @req FR-NODE-319 — found 2026-11-20: add_requirement wrote priority "not-a-value" into the metadata
// cell with ok:true, while edit_requirement_fields refused the same value.

type Answer = { ok: boolean; value?: { requirementId?: string }; error?: { code: string; message: string } };

const SPEC = path.join("docs", "spec", "10.product-architecture.srs.md");
const REQUIREMENT = { type: "functional", scope: "ARCH", target: "v1.0.0", title: "Closed values", requirement: "SpecKiwi SHALL keep it.", acceptanceCriteria: ["It is kept."] };
const BAD = "not-a-value";

async function call(rootPath: string, tool: string, args: Record<string, unknown>): Promise<Answer> {
  return (await createMcpServer({ root: rootPath }).callTool(tool, args)) as Answer;
}

describe("FR-NODE-319 AC-1 AC-2 — a priority or risk outside its set is refused as edit_requirement_fields refuses it", () => {
  for (const field of ["priority", "risk"] as const) {
    for (const dryRun of [true, false]) {
      // @req FR-NODE-319 AC-1 AC-2
      it(`${field}${dryRun ? " in a dry run" : ""}: the same USAGE message, and nothing written`, async () => {
        const rootPath = await copyFixtureWorkspace("mutation-target");
        const before = await readFile(path.join(rootPath, SPEC), "utf8");
        const added = await call(rootPath, "add_requirement", { ...REQUIREMENT, [field]: BAD, dryRun });
        const edited = await call(rootPath, "edit_requirement_fields", { id: "FR-ARCH-001", [field]: BAD, dryRun: true });
        expect(added.ok).toBe(false);
        expect(added.error?.code).toBe("USAGE");
        expect(edited.error?.code).toBe("USAGE");
        expect(added.error?.message).toBe(edited.error?.message);
        for (const value of field === "priority" ? PRIORITY_LEVELS : RISK_LEVELS) expect(added.error?.message).toContain(value);
        expect(await readFile(path.join(rootPath, SPEC), "utf8")).toBe(before);
      });
    }
  }
});

describe("FR-NODE-319 AC-3 — every accepted value, and an omitted one, still pass", () => {
  // @req FR-NODE-319 AC-3
  it("accepts each priority and risk", async () => {
    const rootPath = await copyFixtureWorkspace("mutation-target");
    for (const priority of PRIORITY_LEVELS) expect((await call(rootPath, "add_requirement", { ...REQUIREMENT, priority, dryRun: true })).ok, priority).toBe(true);
    for (const risk of RISK_LEVELS) expect((await call(rootPath, "add_requirement", { ...REQUIREMENT, risk, dryRun: true })).ok, risk).toBe(true);
  });

  // @req FR-NODE-319 AC-3
  it("an omitted priority and risk still write medium", async () => {
    const rootPath = await copyFixtureWorkspace("mutation-target");
    const added = await call(rootPath, "add_requirement", REQUIREMENT);
    expect(added.ok).toBe(true);
    const text = await readFile(path.join(rootPath, SPEC), "utf8");
    const block = text.slice(text.indexOf(`### ${added.value?.requirementId ?? "?"} `));
    expect(block).toMatch(/\| Priority \| medium \|/);
    expect(block).toMatch(/\| Risk \| medium \|/);
  });
});

describe("FR-NODE-319 AC-4 AC-5 — the field says what it takes, and the CLI refuses the same way", () => {
  // @req FR-NODE-319 AC-4
  it("add_requirement priority and risk describe their values", async () => {
    const sdk = createSdkServer(createMcpServer({ root: process.cwd(), rootSource: "server-cwd-discovery" }));
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await sdk.connect(serverTransport);
    const client = new Client({ name: "fr-node-319", version: "1.0.0" }, { capabilities: {} });
    await client.connect(clientTransport);
    const tools = await client.listTools();
    await client.close();
    const schema = tools.tools.find((tool) => tool.name === "add_requirement")?.inputSchema as { properties?: Record<string, { type?: string; description?: string }> };
    const words = (text: string | undefined) => (text ?? "").split(/[\s,;:]+/);
    expect(schema.properties?.priority?.type).toBe("string");
    for (const value of PRIORITY_LEVELS) expect(words(schema.properties?.priority?.description)).toContain(value);
    for (const value of RISK_LEVELS) expect(words(schema.properties?.risk?.description)).toContain(value);
  });

  // @req FR-NODE-319 AC-5
  it("the CLI add-requirement refuses --priority and --risk outside their sets", async () => {
    for (const flag of ["--priority", "--risk"]) {
      const rootPath = await copyFixtureWorkspace("mutation-target");
      const streams = { stdout: new PassThrough(), stderr: new PassThrough() };
      await main(["--root", rootPath, "add-requirement", "--type", "functional", "--scope", "ARCH", "--target", "v1.0.0", "--title", "T", "--statement", "SpecKiwi SHALL keep it.", "--ac", "It is kept.", flag, BAD, "--dry-run", "--json"], streams);
      const answer = JSON.parse(streams.stdout.read()?.toString() ?? "{}") as Answer;
      expect(answer.ok, flag).toBe(false);
      expect(answer.error?.code, flag).toBe("USAGE");
      expect(answer.error?.message, flag).toContain(BAD);
    }
  });
});
