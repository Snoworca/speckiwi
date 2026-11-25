import path from "node:path";
import { PassThrough } from "node:stream";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";
import { main } from "../../../src/cli/index.js";
import { addVerificationEvidence } from "../../../src/core/mutation/add-evidence.js";
import { editRequirementTableRows } from "../../../src/core/mutation/edit-requirement.js";
import { resolveProjectRoot } from "../../../src/core/project-root.js";
import { createMcpServer, createSdkServer } from "../../../src/mcp/server.js";
import { copyFixtureWorkspace } from "../../fixtures/fixture-utils.js";
import { snapshotTree } from "../../support/discarded-target-fixture.js";

// @req FR-NODE-093 AC-7 AC-8 AC-9 AC-10 — the operation object itself is checked, not only `values`:
// an external session wrote `notes` beside `values` and got ok, written false and a changed: stamp.

const ID = "FR-ARCH-001";

/** The SRS documents only: the status cache beside them is refreshed by the mutation lock whatever the outcome. */
const specTree = (rootPath: string) => snapshotTree(path.join(rootPath, "docs", "spec"));

interface Envelope {
  ok?: boolean;
  error?: { code: string; message: string };
  value?: { written?: boolean; updatedFields?: string[] };
}

async function seeded(): Promise<string> {
  const rootPath = await copyFixtureWorkspace("valid-basic");
  const evidence = await addVerificationEvidence(await resolveProjectRoot(rootPath), { id: ID, type: "test", reference: "test/example.test.ts", covers: "AC-1", notes: "first" });
  if (!evidence.ok) throw new Error(evidence.error?.message ?? "evidence seed failed");
  return rootPath;
}

async function core(rootPath: string, operations: unknown[], dryRun = false): Promise<Envelope> {
  return (await editRequirementTableRows(await resolveProjectRoot(rootPath), { id: ID, section: "verification_evidence", operations: operations as never, dryRun })) as Envelope;
}

async function cli(rootPath: string, operations: unknown[]): Promise<{ exit: number; payload: Envelope }> {
  const pipes = { stdout: new PassThrough(), stderr: new PassThrough() };
  const exit = await main(["--root", rootPath, "edit-requirement-table-rows", ID, "--section", "verification_evidence", "--operations", JSON.stringify(operations), "--json"], pipes);
  return { exit, payload: JSON.parse(pipes.stdout.read()?.toString() ?? "{}") as Envelope };
}

async function mcp(rootPath: string, operations: unknown[]): Promise<Envelope> {
  const sdk = createSdkServer(createMcpServer({ root: rootPath, rootSource: "server-cwd-discovery" }));
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await sdk.connect(serverTransport);
  const client = new Client({ name: "fr-node-093", version: "1.0.0" }, { capabilities: {} });
  await client.connect(clientTransport);
  const result = (await client.callTool({ name: "edit_requirement_table_rows", arguments: { id: ID, section: "verification_evidence", operations } })) as { content: Array<{ type: string; text: string }> };
  await client.close();
  return JSON.parse(result.content.find((item) => item.type === "text")?.text ?? "{}") as Envelope;
}

const BESIDE_VALUES = [{ kind: "update", rowId: "VE-1", notes: "changed" }];

describe("FR-NODE-093 AC-7 — a key beside values is refused and the caller is told where it goes", () => {
  it("FR-NODE-093 AC-7: core refuses `notes` beside values, names it, points to values.notes and writes nothing", async () => {
    const rootPath = await seeded();
    const before = await specTree(rootPath);
    const result = await core(rootPath, BESIDE_VALUES);
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("USAGE");
    expect(result.error?.message).toContain("'notes'");
    expect(result.error?.message).toContain("values.notes");
    expect(await specTree(rootPath)).toEqual(before);
  });

  it("FR-NODE-093 AC-7: a key that is no column is refused without the values hint", async () => {
    const rootPath = await seeded();
    const result = await core(rootPath, [{ kind: "update", rowId: "VE-1", values: { notes: "x" }, colour: "red" }]);
    expect(result.error?.code).toBe("USAGE");
    expect(result.error?.message).toContain("'colour'");
    expect(result.error?.message).not.toContain("values.colour");
  });

  it("FR-NODE-093 AC-7: the CLI answers the same refusal with exit 5", async () => {
    const rootPath = await seeded();
    const before = await specTree(rootPath);
    const { exit, payload } = await cli(rootPath, BESIDE_VALUES);
    expect(exit).toBe(5);
    expect(payload.error?.code).toBe("USAGE");
    expect(payload.error?.message).toContain("values.notes");
    expect(await specTree(rootPath)).toEqual(before);
  });
});

describe("FR-NODE-093 AC-8 — an update with nothing to set is refused", () => {
  it.each([
    ["no values", [{ kind: "update", rowId: "VE-1" }]],
    ["empty values", [{ kind: "update", rowId: "VE-1", values: {} }]]
  ])("FR-NODE-093 AC-8: refuses an update with %s", async (_label, operations) => {
    const rootPath = await seeded();
    const before = await specTree(rootPath);
    const result = await core(rootPath, operations);
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("USAGE");
    expect(result.error?.message).toContain("values");
    expect(await specTree(rootPath)).toEqual(before);
  });

  it("FR-NODE-093 AC-8: a delete still needs no values", async () => {
    const rootPath = await seeded();
    const result = await core(rootPath, [{ kind: "delete", rowId: "VE-1" }]);
    expect(result.ok).toBe(true);
    expect(result.value?.written).toBe(true);
  });
});

describe("FR-NODE-093 AC-9 — MCP reaches the same core refusal", () => {
  it("FR-NODE-093 AC-9: MCP refuses `notes` beside values with the core message instead of stripping it", async () => {
    const rootPath = await seeded();
    const before = await specTree(rootPath);
    const result = await mcp(rootPath, BESIDE_VALUES);
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("USAGE");
    expect(result.error?.message).toContain("values.notes");
    expect(await specTree(rootPath)).toEqual(before);
  });

  it("FR-NODE-093 AC-9: MCP refuses an update without values", async () => {
    const rootPath = await seeded();
    const result = await mcp(rootPath, [{ kind: "update", rowId: "VE-1" }]);
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("USAGE");
  });
});

describe("FR-NODE-093 AC-10 — the changed: stamp means the document changed", () => {
  const stamped = (fields: string[] | undefined) => (fields ?? []).some((field) => field.startsWith("changed:"));

  it("FR-NODE-093 AC-10: an update to the values the row already holds is not stamped", async () => {
    const rootPath = await seeded();
    const result = await core(rootPath, [{ kind: "update", rowId: "VE-1", values: { notes: "first" } }]);
    expect(result.ok).toBe(true);
    expect(result.value?.written).toBe(false);
    expect(stamped(result.value?.updatedFields)).toBe(false);
  });

  it("FR-NODE-093 AC-10: a real update is stamped, written and under dry-run", async () => {
    const rootPath = await seeded();
    const dry = await core(rootPath, [{ kind: "update", rowId: "VE-1", values: { notes: "second" } }], true);
    expect(dry.value?.written).toBe(false);
    expect(stamped(dry.value?.updatedFields)).toBe(true);
    const wet = await core(rootPath, [{ kind: "update", rowId: "VE-1", values: { notes: "second" } }]);
    expect(wet.value?.written).toBe(true);
    expect(stamped(wet.value?.updatedFields)).toBe(true);
  });
});
