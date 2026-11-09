import { readFile } from "node:fs/promises";
import path from "node:path";
import { PassThrough } from "node:stream";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";
import { main } from "../../src/cli/index.js";
import { addRequirement } from "../../src/core/mutation/add-requirement.js";
import { resolveProjectRoot } from "../../src/core/project-root.js";
import { createMcpServer, createSdkServer } from "../../src/mcp/server.js";
import { copyFixtureWorkspace } from "../fixtures/fixture-utils.js";
import { snapshotTree } from "../support/discarded-target-fixture.js";

// @req FR-NODE-281 — MCP add_requirement rows go through the core row normalizer, and a mutation
// tool refuses an argument it does not declare.

const SPEC_FILE = "docs/spec/10.product-architecture.srs.md";

interface Envelope {
  ok?: boolean;
  error?: { code: string; message: string };
  value?: { written?: boolean };
}

const BASE = {
  type: "functional",
  scope: "ARCH",
  target: "v1.0.0",
  title: "Row normalizer",
  requirement: "The system SHALL keep trace rows.",
  acceptanceCriteria: ["THE SYSTEM SHALL keep trace rows."]
};

async function callTool(rootPath: string, name: string, args: Record<string, unknown>): Promise<Envelope> {
  return (await createMcpServer({ root: rootPath }).callTool(name, args)) as Envelope;
}

/** A real MCP client over the SDK server, so the argument handling of the protocol path is what runs. */
async function protocolCall(rootPath: string, name: string, args: Record<string, unknown>): Promise<Envelope> {
  const sdk = createSdkServer(createMcpServer({ root: rootPath, rootSource: "server-cwd-discovery" }));
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await sdk.connect(serverTransport);
  const client = new Client({ name: "fr-node-281", version: "1.0.0" }, { capabilities: {} });
  await client.connect(clientTransport);
  const result = (await client.callTool({ name, arguments: args })) as { content: Array<{ type: string; text: string }> };
  await client.close();
  return JSON.parse(result.content.find((item) => item.type === "text")?.text ?? "{}") as Envelope;
}

async function expectRefused(call: (rootPath: string) => Promise<Envelope>, named: readonly string[]): Promise<void> {
  const rootPath = await copyFixtureWorkspace("mutation-target");
  const before = await snapshotTree(rootPath);
  const envelope = await call(rootPath);
  expect(envelope.ok).toBe(false);
  expect(envelope.error?.code).toBe("USAGE");
  for (const text of named) expect(envelope.error?.message).toContain(text);
  expect(await snapshotTree(rootPath)).toEqual(before);
}

describe("FR-NODE-281 AC-6 — trace and evidence rows pass one core row normalizer", () => {
  // @req FR-NODE-281 AC-6
  it.each([
    { label: "an unknown trace key", rows: { trace: [{ kind: "Code", ref: "src/app.ts" }] }, named: ["Trace row 1", "kind"] },
    { label: "an unknown evidence key", rows: { evidence: [{ type: "test", reference: "t.ts", ac: "AC-1" }] }, named: ["Evidence row 1", "ac"] },
    { label: "an object cell", rows: { evidence: [{ type: "test", reference: { path: "t.ts" } }] }, named: ["Evidence row 1", "reference"] },
    { label: "an array cell", rows: { trace: [{ type: ["Code"], reference: "src/app.ts" }] }, named: ["Trace row 1", "type"] },
    { label: "a null cell", rows: { trace: [{ type: "Code", reference: "src/app.ts" }, { type: "Code", reference: "src/b.ts", notes: null }] }, named: ["Trace row 2", "notes"] }
  ])("MCP add_requirement refuses $label, naming row and key, and writes nothing", async ({ rows, named }) => {
    await expectRefused((rootPath) => callTool(rootPath, "add_requirement", { ...BASE, ...rows }), named);
  });

  // @req FR-NODE-281 AC-6 — a row with no reference is a row of defaults; add_verification_evidence refuses it too.
  it.each([
    { label: "an empty evidence row", rows: { evidence: [{}] }, named: ["Evidence row 1", "reference"] },
    { label: "an empty trace row", rows: { trace: [{}] }, named: ["Trace row 1", "reference"] },
    { label: "a blank trace reference", rows: { trace: [{ type: "Code", reference: "  ", relation: "implements" }] }, named: ["Trace row 1", "reference"] }
  ])("MCP add_requirement refuses $label through the protocol, and writes nothing", async ({ rows, named }) => {
    await expectRefused((rootPath) => protocolCall(rootPath, "add_requirement", { ...BASE, ...rows }), named);
  });

  // @req FR-NODE-281 AC-6 — the CLI string row passes the same rule.
  it("the CLI refuses a string trace row with an empty reference", async () => {
    const rootPath = await copyFixtureWorkspace("mutation-target");
    const before = await snapshotTree(rootPath);
    const streams = { stdout: new PassThrough(), stderr: new PassThrough() };
    const code = await main(
      ["--root", rootPath, "add-requirement", "--type", "functional", "--scope", "ARCH", "--target", "v1.0.0", "--title", BASE.title, "--statement", BASE.requirement, "--ac", BASE.acceptanceCriteria[0] as string, "--trace", "Code||implements|n", "--json"],
      streams
    );
    const envelope = JSON.parse(streams.stdout.read()?.toString() ?? "{}") as Envelope;
    expect(code).not.toBe(0);
    expect(envelope.error?.code).toBe("USAGE");
    expect(envelope.error?.message).toContain("Trace row 1");
    expect(envelope.error?.message).toContain("reference");
    expect(await snapshotTree(rootPath)).toEqual(before);
  });

  // @req FR-NODE-281 AC-6 — the core function the CLI calls refuses the same row, so the check is not MCP's own.
  it("core addRequirement, which the CLI calls with its split string rows, refuses the same row", async () => {
    const rootPath = await copyFixtureWorkspace("mutation-target");
    const before = await snapshotTree(rootPath);
    const result = await addRequirement(await resolveProjectRoot(rootPath, rootPath), {
      type: "functional",
      scope: "ARCH",
      target: "v1.0.0",
      title: "Row normalizer",
      statement: "The system SHALL keep trace rows.",
      acceptanceCriteria: ["THE SYSTEM SHALL keep trace rows."],
      trace: [{ kind: "Code", ref: "src/app.ts" } as never]
    });
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("USAGE");
    expect(result.error?.message).toContain("Trace row 1");
    expect(result.error?.message).toContain("kind");
    expect(await snapshotTree(rootPath)).toEqual(before);
  });

  // @req FR-NODE-281 AC-6
  it("a CLI string row and the equal MCP object row write the same table rows", async () => {
    const cliRoot = await copyFixtureWorkspace("mutation-target");
    const streams = { stdout: new PassThrough(), stderr: new PassThrough() };
    const code = await main(
      ["--root", cliRoot, "add-requirement", "--type", "functional", "--scope", "ARCH", "--target", "v1.0.0", "--title", BASE.title, "--statement", BASE.requirement, "--ac", BASE.acceptanceCriteria[0] as string, "--trace", "Code|src/app.ts|implements|n", "--evidence", "test|test/app.test.ts|AC-1|n", "--json"],
      streams
    );
    expect(code).toBe(0);

    const mcpRoot = await copyFixtureWorkspace("mutation-target");
    const envelope = await callTool(mcpRoot, "add_requirement", {
      ...BASE,
      trace: [{ type: "Code", reference: "src/app.ts", relation: "implements", notes: "n" }],
      evidence: [{ type: "test", reference: "test/app.test.ts", covers: "AC-1", notes: "n" }]
    });
    expect(envelope.ok, JSON.stringify(envelope.error)).toBe(true);

    for (const rootPath of [cliRoot, mcpRoot]) {
      const text = await readFile(path.join(rootPath, SPEC_FILE), "utf8");
      expect(text).toContain("| Code | src/app.ts | implements | n |");
      expect(text).toContain("| VE-1 | test | test/app.test.ts | AC-1 | n |");
    }
  });
});

describe("FR-NODE-281 AC-7 — a mutation tool refuses an argument it does not declare", () => {
  const traceLinks = [{ type: "Code", reference: "src/app.ts", relation: "implements", notes: "n" }];

  // @req FR-NODE-281 AC-7
  it("add_requirement with traceLinks is refused naming the argument, through the handle", async () => {
    await expectRefused((rootPath) => callTool(rootPath, "add_requirement", { ...BASE, traceLinks }), ["traceLinks"]);
  });

  // @req FR-NODE-281 AC-7
  it("add_requirement with traceLinks is refused naming the argument, through the protocol", async () => {
    await expectRefused((rootPath) => protocolCall(rootPath, "add_requirement", { ...BASE, traceLinks }), ["traceLinks"]);
  });

  // @req FR-NODE-281 AC-7
  it("update_status with an undeclared argument is refused through the protocol", async () => {
    await expectRefused((rootPath) => protocolCall(rootPath, "update_status", { id: "FR-ARCH-001", status: "implemented", "dry-run": true }), ["dry-run"]);
  });

  // @req FR-NODE-281 AC-7
  it.each([
    { label: "through the handle", call: callTool },
    { label: "through the protocol", call: protocolCall }
  ])("a read-only tool keeps ignoring an undeclared argument $label", async ({ call }) => {
    const rootPath = await copyFixtureWorkspace("mutation-target");
    const envelope = await call(rootPath, "list_requirements", { traceLinks: true });
    expect(envelope.ok, JSON.stringify(envelope.error)).toBe(true);
  });

  // @req FR-NODE-281 AC-7 — the gate's own keys keep their meaning on a mutation tool.
  it("workspaceRoot on add_requirement is still answered by the workspace gate, not by USAGE", async () => {
    const rootPath = await copyFixtureWorkspace("mutation-target");
    const envelope = await callTool(rootPath, "add_requirement", { ...BASE, workspaceRoot: rootPath });
    expect(envelope.ok).toBe(false);
    expect(envelope.error?.code).toBe("MCP_WORKSPACE_ROOT_UNSUPPORTED");
  });
});
