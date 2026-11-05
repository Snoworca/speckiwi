import { readFile } from "node:fs/promises";
import path from "node:path";
import { PassThrough } from "node:stream";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";
import { main } from "../../src/cli/index.js";
import { addRequirement } from "../../src/core/mutation/add-requirement.js";
import { addTraceLink } from "../../src/core/mutation/add-trace.js";
import { parseWorkspace } from "../../src/core/parser/workspace-parser.js";
import { checkLinks } from "../../src/core/query/links.js";
import { createMcpServer, createSdkServer } from "../../src/mcp/server.js";
import { A, B, LIVE, S, SPEC_FILE, discardedTargetWorkspace, snapshotTree } from "../support/discarded-target-fixture.js";

// @req FR-NODE-272 — add-trace and add-requirement refuse a new Requirement trace row to a discarded
// requirement unless the row records the supersede, and the refusal writes no file at all.

interface Envelope {
  ok: boolean;
  error?: { code: string; message: string };
  value?: { written?: boolean; requirementId?: string };
}

async function cli(rootPath: string, args: string[]): Promise<Envelope> {
  const streams = { stdout: new PassThrough(), stderr: new PassThrough() };
  await main(["--root", rootPath, ...args, "--json"], streams);
  return JSON.parse(streams.stdout.read()?.toString() ?? "{}") as Envelope;
}

async function mcpClient(rootPath: string): Promise<{ call: (name: string, args: Record<string, unknown>) => Promise<Envelope>; descriptions: Map<string, string> }> {
  const sdk = createSdkServer(createMcpServer({ root: rootPath, rootSource: "server-cwd-discovery" }));
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await sdk.connect(serverTransport);
  const client = new Client({ name: "fr-node-272", version: "1.0.0" }, { capabilities: {} });
  await client.connect(clientTransport);
  const descriptions = new Map((await client.listTools()).tools.map((tool) => [tool.name, tool.description ?? ""]));
  return {
    descriptions,
    call: async (name, args) => {
      const result = (await client.callTool({ name, arguments: args })) as { content: Array<{ type: string; text: string }> };
      const text = result.content.find((item) => item.type === "text")?.text ?? "{}";
      if (!text.startsWith("{")) throw new Error(text);
      return JSON.parse(text) as Envelope;
    }
  };
}

const DRY_RUN_MODES = [{ label: "without --dry-run", flags: [] as string[] }, { label: "under --dry-run", flags: ["--dry-run"] }];

const ADD_REQUIREMENT_ARGS = ["add-requirement", "--type", "functional", "--scope", "ARCH", "--target", "v1.0.0", "--title", "Late requirement", "--statement", "SpecKiwi SHALL keep the late requirement.", "--ac", "The requirement can be listed."];

describe("FR-NODE-272 AC-1 — add-trace refuses a row to a discarded requirement and writes nothing", () => {
  // @req FR-NODE-272 AC-1
  it.each(DRY_RUN_MODES)("refuses with USAGE naming A and S, leaving every file byte-identical, $label", async ({ flags }) => {
    const { rootPath } = await discardedTargetWorkspace();
    const before = await snapshotTree(rootPath);
    const result = await cli(rootPath, ["add-trace", B, "--type", "Requirement", "--reference", A, "--relation", "extends", ...flags]);
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("USAGE");
    expect(result.error?.message).toContain(A);
    expect(result.error?.message).toContain(S);
    expect(await snapshotTree(rootPath)).toEqual(before);
  });
});

describe("FR-NODE-272 AC-2 — a row that records the supersede is written as today", () => {
  // @req FR-NODE-272 AC-2
  it.each(["supersedes", "superseded_by"])("writes the %s row", async (relation) => {
    const { rootPath } = await discardedTargetWorkspace();
    const result = await cli(rootPath, ["add-trace", B, "--type", "Requirement", "--reference", A, "--relation", relation]);
    expect(result.ok, JSON.stringify(result.error)).toBe(true);
    expect(result.value?.written).toBe(true);
    expect(await readFile(path.join(rootPath, SPEC_FILE), "utf8")).toContain(`| Requirement | ${A} | ${relation} | - |`);
  });
});

describe("FR-NODE-272 AC-3 — MCP add_trace_link refuses and allows the same calls, and says so", () => {
  // @req FR-NODE-272 AC-3
  it("refuses the extends row with USAGE and writes nothing, and writes the supersedes row", async () => {
    const { rootPath } = await discardedTargetWorkspace();
    const { call } = await mcpClient(rootPath);
    for (const dryRun of [false, true]) {
      const before = await snapshotTree(rootPath);
      const refused = await call("add_trace_link", { id: B, type: "Requirement", reference: A, relation: "extends", dryRun });
      expect(refused.ok).toBe(false);
      expect(refused.error?.code).toBe("USAGE");
      expect(refused.error?.message).toContain(S);
      expect(await snapshotTree(rootPath)).toEqual(before);
    }
    const allowed = await call("add_trace_link", { id: B, type: "Requirement", reference: A, relation: "superseded_by" });
    expect(allowed.ok, JSON.stringify(allowed.error)).toBe(true);
    expect(allowed.value?.written).toBe(true);
  });

  // @req FR-NODE-272 AC-3
  it("states in its tool description that a row to a discarded requirement is refused unless it records the supersede", async () => {
    const { rootPath } = await discardedTargetWorkspace();
    const description = (await mcpClient(rootPath)).descriptions.get("add_trace_link") ?? "";
    expect(description).toMatch(/discarded requirement is refused unless (it|the row) records the supersede/);
  });
});

describe("FR-NODE-272 AC-4 — add-requirement refuses such a trace row and creates nothing", () => {
  // @req FR-NODE-272 AC-4
  it.each(DRY_RUN_MODES)("refuses CLI --trace with USAGE and leaves every file byte-identical, $label", async ({ flags }) => {
    const { rootPath } = await discardedTargetWorkspace();
    const before = await snapshotTree(rootPath);
    const result = await cli(rootPath, [...ADD_REQUIREMENT_ARGS, "--trace", `Requirement|${A}|refines|-`, ...flags]);
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("USAGE");
    expect(result.error?.message).toContain(S);
    expect(await snapshotTree(rootPath)).toEqual(before);
  });

  // @req FR-NODE-272 AC-4
  it.each([false, true])("refuses MCP add_requirement with USAGE and leaves every file byte-identical, dryRun %s", async (dryRun) => {
    const { rootPath } = await discardedTargetWorkspace();
    const { call } = await mcpClient(rootPath);
    const before = await snapshotTree(rootPath);
    const result = await call("add_requirement", {
      type: "functional",
      scope: "ARCH",
      target: "v1.0.0",
      title: "Late requirement",
      requirement: "SpecKiwi SHALL keep the late requirement.",
      acceptanceCriteria: ["The requirement can be listed."],
      trace: [{ type: "Requirement", reference: A, relation: "depends_on" }],
      dryRun
    });
    expect(result.ok, "the requirement was created").toBe(false);
    expect(result.error?.code).toBe("USAGE");
    expect(await snapshotTree(rootPath)).toEqual(before);
  });

  // @req FR-NODE-272 AC-4
  it("still creates a requirement whose trace row records the supersede", async () => {
    const { rootPath } = await discardedTargetWorkspace();
    const result = await cli(rootPath, [...ADD_REQUIREMENT_ARGS, "--trace", `Requirement|${A}|supersedes|-`]);
    expect(result.ok, JSON.stringify(result.error)).toBe(true);
    expect(result.value?.written).toBe(true);
  });
});

describe("FR-NODE-272 AC-5 — no row these writers accept is one links check reports", () => {
  const RELATIONS = ["extends", "depends_on", "related_to", "refines", "conflicts_with", "checked_compatible", "supersedes", "superseded_by"];

  // @req FR-NODE-272 AC-4, AC-5
  it("refuses an MCP add_requirement row that leaves out its type and relation, since the block would hold it as a Requirement row", async () => {
    const { rootPath } = await discardedTargetWorkspace();
    const { call } = await mcpClient(rootPath);
    const seed = (title: string, reference: string): Promise<Envelope> =>
      call("add_requirement", {
        type: "functional",
        scope: "ARCH",
        target: "v1.0.0",
        title,
        requirement: "SpecKiwi SHALL keep the seeded requirement.",
        acceptanceCriteria: ["The requirement can be listed."],
        trace: [{ reference }]
      });
    const written = await seed("Seeded to a live target", S);
    expect(written.ok, JSON.stringify(written.error)).toBe(true);
    expect(await readFile(path.join(rootPath, SPEC_FILE), "utf8")).toContain(`| Requirement | ${S} | related_to | - |`);

    const before = await snapshotTree(rootPath);
    const refused = await seed("Seeded to a discarded target", A);
    expect(refused.ok, "a row links check would report was accepted").toBe(false);
    expect(refused.error?.code).toBe("USAGE");
    expect(await snapshotTree(rootPath)).toEqual(before);
  });

  // @req FR-NODE-272 AC-5
  it("leaves links check with no discarded-target entry after every row add-trace and add-requirement accepted", async () => {
    const { root } = await discardedTargetWorkspace();
    const accepted: string[] = [];
    for (const relation of RELATIONS) {
      const traced = await addTraceLink(root, { id: LIVE, type: "Requirement", reference: A, relation });
      if (traced.ok) accepted.push(`add-trace ${relation}`);
      const added = await addRequirement(root, {
        type: "functional",
        scope: "ARCH",
        target: "v1.0.0",
        title: `Holder of ${relation}`,
        statement: "SpecKiwi SHALL keep the holder.",
        acceptanceCriteria: ["The requirement can be listed."],
        stability: "evolving",
        trace: [{ type: "Requirement", reference: A, relation }]
      });
      if (added.ok) accepted.push(`add-requirement ${relation}`);
    }
    expect(accepted.sort()).toEqual(["add-requirement superseded_by", "add-requirement supersedes", "add-trace superseded_by", "add-trace supersedes"]);
    const reported = (await checkLinks(await parseWorkspace(root))).broken.filter((entry) => entry.code === "SRS-W081");
    // Only the two rows written while A was live remain reported; nothing the writers accepted joins them.
    expect(reported.map((entry) => entry.requirementId).sort()).toEqual(["FR-ARCH-003", "FR-ARCH-004"]);
  });
});

describe("FR-NODE-272 AC-6 — a reference that names no requirement keeps its refusal", () => {
  // @req FR-NODE-272 AC-6
  it("refuses add-trace with MUTATION_DENIED and `Trace target not found`", async () => {
    const { rootPath } = await discardedTargetWorkspace();
    const result = await cli(rootPath, ["add-trace", B, "--type", "Requirement", "--reference", "FR-ARCH-404", "--relation", "extends"]);
    expect(result.error).toEqual({ ...result.error, code: "MUTATION_DENIED", message: "Trace target not found: FR-ARCH-404" });
  });

  // @req FR-NODE-272 AC-6
  it("refuses add-requirement --trace with MUTATION_DENIED and `Trace target not found`", async () => {
    const { rootPath } = await discardedTargetWorkspace();
    const result = await cli(rootPath, [...ADD_REQUIREMENT_ARGS, "--trace", "Requirement|FR-ARCH-404|refines|-"]);
    expect(result.error).toEqual({ ...result.error, code: "MUTATION_DENIED", message: "Trace target not found: FR-ARCH-404" });
  });
});
