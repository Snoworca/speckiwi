import { PassThrough } from "node:stream";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";
import { buildProgram, main } from "../../../src/cli/index.js";
import { appendSectionNote } from "../../../src/core/mutation/append-section-note.js";
import { resolveProjectRoot } from "../../../src/core/project-root.js";
import { createMcpServer, createSdkServer } from "../../../src/mcp/server.js";
import { acFixture, scopeText } from "../ac-expiry-fixture.js";

// @req FR-MCP-018 AC-1 AC-2 AC-3 — append_section_note says which sections it takes, takes the parser's
// own section headings and the get_requirement field names for the same three sections, and answers a
// structured table the same way whichever spelling names it. Two OG lanes (D, J) hit `unknown section:
// Implementation Notes` with no list anywhere, and found the keys only by reading the built source.

type Envelope = { ok: boolean; value?: { section?: string; written?: boolean }; error?: { code: string; message: string } };

const KEYS = ["rationale", "research", "implementation_notes"];
/** Everything AC-1 says the field description and the CLI help name: keys, headings, field names. */
const NAMED = [...KEYS, "Rationale", "Research / Analysis", "Implementation Notes", "implementationNotes"];

async function fixture(): Promise<string> {
  return acFixture({ acLines: ["- [ ] AC-1: first", "- [ ] AC-2: second"] });
}

async function core(rootPath: string, section: string, dryRun = true): Promise<Envelope> {
  return (await appendSectionNote(await resolveProjectRoot(rootPath), { id: "FR-ARCH-001", section, text: "a note", dryRun })) as Envelope;
}

/** A real MCP client over the SDK server, so the declared schema is what admits the argument. */
async function sdkCall(rootPath: string, args: Record<string, unknown>): Promise<Envelope> {
  const sdk = createSdkServer(createMcpServer({ root: rootPath, rootSource: "server-cwd-discovery" }));
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await sdk.connect(serverTransport);
  const client = new Client({ name: "fr-mcp-018", version: "1.0.0" }, { capabilities: {} });
  await client.connect(clientTransport);
  const result = (await client.callTool({ name: "append_section_note", arguments: args })) as { content: Array<{ type: string; text: string }> };
  await client.close();
  return JSON.parse(result.content.find((item) => item.type === "text")?.text ?? "{}") as Envelope;
}

async function cli(rootPath: string, section: string): Promise<Envelope> {
  const streams = { stdout: new PassThrough(), stderr: new PassThrough() };
  await main(["--root", rootPath, "append-note", "FR-ARCH-001", "--section", section, "--text", "a note", "--dry-run", "--json"], streams);
  return JSON.parse(streams.stdout.read()?.toString() ?? "{}") as Envelope;
}

describe("FR-MCP-018 AC-2 — the section headings and get_requirement field names are taken too", () => {
  // @req FR-MCP-018 AC-2
  it.each([
    ["Implementation Notes", "implementation_notes"],
    ["  implementation   NOTES ", "implementation_notes"],
    ["Research / Analysis", "research"],
    ["research / analysis", "research"],
    ["Rationale", "rationale"],
    ["implementationNotes", "implementation_notes"],
    ["research", "research"],
    ["rationale", "rationale"],
    ["implementation-notes", "implementation_notes"],
    ["Implementation_Notes", "implementation_notes"]
  ])("%j resolves to %s on a dry run and writes nothing", async (section, key) => {
    const rootPath = await fixture();
    const before = await scopeText(rootPath);
    const result = await core(rootPath, section);
    expect(result.ok, JSON.stringify(result.error)).toBe(true);
    expect(result.value?.section).toBe(key);
    expect(await scopeText(rootPath)).toBe(before);
  });

  // @req FR-MCP-018 AC-2
  it("a heading spelling writes the same bytes as the key", async () => {
    const byKey = await fixture();
    const byHeading = await fixture();
    expect((await core(byKey, "implementation_notes", false)).ok).toBe(true);
    expect((await core(byHeading, "Implementation Notes", false)).ok).toBe(true);
    expect(await scopeText(byHeading)).toBe(await scopeText(byKey));
  });
});

describe("FR-MCP-018 AC-2 — anything else is unknown, and the refusal lists what is taken", () => {
  // @req FR-MCP-018 AC-2
  it.each(["implementation", "notes", "analysis", "research_analysis", "Research/Analysis", "implementationnotes", "ImplementationNotes", "bogus", "trace_linkss", "change_notess", "acceptance_criteriass"])(
    "%j is refused USAGE with the accepted keys named, writing nothing",
    async (section) => {
      const rootPath = await fixture();
      const before = await scopeText(rootPath);
      const result = await core(rootPath, section, false);
      expect(result.ok).toBe(false);
      expect(result.error?.code).toBe("USAGE");
      for (const key of KEYS) expect(result.error?.message).toContain(key);
      expect(result.error?.message).toContain("Implementation Notes");
      expect(result.error?.message).toContain("implementationNotes");
      expect(await scopeText(rootPath)).toBe(before);
    }
  );
});

describe("FR-MCP-018 AC-3 — a structured table is refused the same way whatever spelling names it", () => {
  // @req FR-MCP-018 AC-3
  it.each([
    ["acceptance_criteria", "append_acceptance_criterion"],
    ["Acceptance Criteria", "append_acceptance_criterion"],
    ["acceptanceCriteria", "edit_acceptance_criterion"],
    ["verification_evidence", "add_verification_evidence"],
    ["Verification Evidence", "add_verification_evidence"],
    ["verificationEvidence", "add_verification_evidence"],
    ["trace_links", "add_trace_link"],
    ["Trace Links", "add_trace_link"],
    ["traceLinks", "add_trace_link"],
    ["change_notes", "add_change_note"],
    ["Change Notes", "add_change_note"],
    ["changeNotes", "add_change_note"],
    ["acceptance_criterias", "append_acceptance_criterion"]
  ])("%j is refused MUTATION_DENIED naming %s, writing nothing", async (section, tool) => {
    const rootPath = await fixture();
    const before = await scopeText(rootPath);
    const result = await core(rootPath, section, false);
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("MUTATION_DENIED");
    expect(result.error?.message).toContain(tool);
    expect(await scopeText(rootPath)).toBe(before);
  });
});

describe("FR-MCP-018 AC-1 AC-2 — both surfaces resolve the section the same way and say what they take", () => {
  // @req FR-MCP-018 AC-1
  it("the MCP section field describes every accepted key", async () => {
    const sdk = createSdkServer(createMcpServer({ root: process.cwd(), rootSource: "server-cwd-discovery" }));
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await sdk.connect(serverTransport);
    const client = new Client({ name: "fr-mcp-018", version: "1.0.0" }, { capabilities: {} });
    await client.connect(clientTransport);
    const tools = await client.listTools();
    await client.close();
    const schema = tools.tools.find((tool) => tool.name === "append_section_note")?.inputSchema as { properties?: Record<string, { type?: string; description?: string; enum?: unknown }> };
    const field = schema.properties?.section;
    expect(field?.type).toBe("string");
    expect(field?.enum).toBeUndefined();
    for (const name of NAMED) expect(field?.description ?? "").toContain(name);
  });

  // @req FR-MCP-018 AC-2 — the tool's own description must not say the opposite of the field's.
  it("the append_section_note tool description says the heading and the field name are taken too", async () => {
    const sdk = createSdkServer(createMcpServer({ root: process.cwd(), rootSource: "server-cwd-discovery" }));
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await sdk.connect(serverTransport);
    const client = new Client({ name: "fr-mcp-018", version: "1.0.0" }, { capabilities: {} });
    await client.connect(clientTransport);
    const tools = await client.listTools();
    await client.close();
    const description = tools.tools.find((tool) => tool.name === "append_section_note")?.description ?? "";
    expect(description).not.toMatch(/rather than as its heading/);
    expect(description).toContain("heading");
    expect(description).toContain("get_requirement field name");
  });

  // @req FR-MCP-018 AC-1
  it("the CLI --section help names every accepted key", () => {
    const option = buildProgram().commands.find((entry) => entry.name() === "append-note")?.options.find((entry) => entry.long === "--section");
    for (const name of NAMED) expect(option?.description ?? "").toContain(name);
  });

  // @req FR-MCP-018 AC-2
  it.each([["Implementation Notes"], ["implementation"], ["Change Notes"]])("MCP over the SDK and the CLI answer %j alike on a dry run", async (section) => {
    const viaMcp = await sdkCall(await fixture(), { id: "FR-ARCH-001", section, text: "a note", dryRun: true });
    const viaCli = await cli(await fixture(), section);
    expect(viaCli.ok).toBe(viaMcp.ok);
    expect(viaCli.error?.code).toBe(viaMcp.error?.code);
    expect(viaCli.error?.message).toBe(viaMcp.error?.message);
    expect(viaCli.value?.section).toBe(viaMcp.value?.section);
  });
});
