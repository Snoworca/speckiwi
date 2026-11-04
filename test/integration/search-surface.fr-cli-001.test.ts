import { PassThrough } from "node:stream";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { beforeAll, describe, expect, it } from "vitest";
import { main } from "../../src/cli/index.js";
import { BILINGUAL_SEARCH_EXAMPLE, BILINGUAL_SEARCH_RULE } from "../../src/core/bootstrap/templates.js";
import { parseWorkspace } from "../../src/core/parser/workspace-parser.js";
import { resolveProjectRoot } from "../../src/core/project-root.js";
import { searchRequirementRecords } from "../../src/core/query/discovery.js";
import { createMcpServer, createSdkServer } from "../../src/mcp/server.js";
import { buildLargeSrsFixture, copyFixtureWorkspace } from "../fixtures/fixture-utils.js";

// @req FR-CLI-001 @req FR-FLOW-207 — the two search surfaces: `speckiwi search` and MCP
// `search_requirements`. Every MCP call goes through an SDK client, so the argument schema is part of
// what is measured: a `match` the schema does not declare is stripped before the handler sees it.

interface SearchValue {
  records: Array<Record<string, unknown> & { id: string }>;
  page: { total: number; offset: number; limit: number | null; returned: number; nextOffset: number | null; truncated: boolean };
}

const RECORD_COUNT = 60;
const RANKED_QUERY = "generated requirement";
// No record holds this phrase, but every record holds its words, so ranked and exact disagree.
const WORDS_NOT_PHRASE = "requirement 7 generated";

let root: string;
let call: (args: Record<string, unknown>) => Promise<Record<string, unknown>>;
let description: string;

async function cli(argv: string[]): Promise<{ code: number; stdout: string }> {
  const streams = { stdout: new PassThrough(), stderr: new PassThrough() };
  const code = await main(argv, streams);
  return { code, stdout: streams.stdout.read()?.toString() ?? "" };
}

async function cliSearch(argv: string[]): Promise<SearchValue> {
  const result = await cli(["--root", root, "search", ...argv, "--json"]);
  expect(result.code, result.stdout.slice(0, 300)).toBe(0);
  return JSON.parse(result.stdout) as SearchValue;
}

async function mcpSearch(args: Record<string, unknown>): Promise<SearchValue> {
  const response = await call(args);
  expect(response.ok, JSON.stringify(response).slice(0, 300)).toBe(true);
  return response.value as SearchValue;
}

beforeAll(async () => {
  root = await copyFixtureWorkspace("valid-basic");
  await buildLargeSrsFixture(RECORD_COUNT, root);
  const sdk = createSdkServer(createMcpServer({ root, rootSource: "server-cwd-discovery" }));
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await sdk.connect(serverTransport);
  const client = new Client({ name: "fr-cli-001", version: "1.0.0" }, { capabilities: {} });
  await client.connect(clientTransport);
  call = async (args) => {
    const result = (await client.callTool({ name: "search_requirements", arguments: args })) as { content: Array<{ type: string; text: string }> };
    return JSON.parse(result.content.find((item) => item.type === "text")?.text ?? "{}") as Record<string, unknown>;
  };
  const listed = await client.listTools();
  description = listed.tools.find((tool) => tool.name === "search_requirements")?.description ?? "";
});

describe("FR-CLI-001 — ranked search on both surfaces", () => {
  // @req FR-CLI-001 AC-1
  it("AC-1: without a limit both surfaces return at most 20 records and report the page", async () => {
    const expectedPage = { total: RECORD_COUNT, offset: 0, limit: 20, returned: 20, nextOffset: 20, truncated: true };
    const viaCli = await cliSearch([RANKED_QUERY]);
    const viaMcp = await mcpSearch({ query: RANKED_QUERY });
    expect(viaCli.records).toHaveLength(20);
    expect(viaCli.page).toEqual(expectedPage);
    expect(viaMcp.records).toHaveLength(20);
    expect(viaMcp.page).toEqual(expectedPage);
  });

  // @req FR-CLI-001 AC-2
  it("AC-2: --exact and match \"exact\" return the core's exact result", async () => {
    const workspace = await parseWorkspace(await resolveProjectRoot(process.cwd(), root));
    const exact = searchRequirementRecords(workspace.records, { query: WORDS_NOT_PHRASE, match: "exact" });
    const ranked = searchRequirementRecords(workspace.records, { query: WORDS_NOT_PHRASE });
    expect((ranked as unknown as SearchValue).records.length, "the query must separate the two modes").toBeGreaterThan(0);

    const viaCli = await cliSearch([WORDS_NOT_PHRASE, "--exact"]);
    const viaMcp = await mcpSearch({ query: WORDS_NOT_PHRASE, match: "exact" });
    expect(viaCli).toMatchObject(exact);
    expect(viaMcp).toMatchObject(exact);
    expect(viaCli.records).toEqual([]);

    const phraseCli = await cliSearch(["Generated requirement 7", "--exact"]);
    const phraseMcp = await mcpSearch({ query: "Generated requirement 7", match: "exact" });
    const phraseCore = searchRequirementRecords(workspace.records, { query: "Generated requirement 7", match: "exact" });
    expect(phraseCli).toMatchObject(phraseCore);
    expect(phraseMcp).toMatchObject(phraseCore);
    expect(phraseCli.records.length).toBeGreaterThan(0);
  });

  // @req FR-CLI-001 AC-3
  it("AC-3: the same query, filters, limit and offset give the same records, snippets and page", async () => {
    const cases: Array<{ argv: string[]; args: Record<string, unknown> }> = [
      { argv: [RANKED_QUERY], args: { query: RANKED_QUERY } },
      { argv: [RANKED_QUERY, "--limit", "7", "--offset", "15"], args: { query: RANKED_QUERY, limit: 7, offset: 15 } },
      { argv: [WORDS_NOT_PHRASE, "--status", "planned", "--limit", "5"], args: { query: WORDS_NOT_PHRASE, status: "planned", limit: 5 } },
      { argv: [WORDS_NOT_PHRASE, "--status", "verified"], args: { query: WORDS_NOT_PHRASE, status: "verified" } },
      { argv: ["Generated requirement 4", "--exact", "--offset", "2"], args: { query: "Generated requirement 4", match: "exact", offset: 2 } },
      { argv: [BILINGUAL_SEARCH_EXAMPLE], args: { query: BILINGUAL_SEARCH_EXAMPLE } }
    ];
    for (const { argv, args } of cases) {
      const viaCli = await cliSearch(argv);
      const viaMcp = await mcpSearch(args);
      expect(viaMcp.records, argv.join(" ")).toEqual(viaCli.records);
      expect(viaMcp.page, argv.join(" ")).toEqual(viaCli.page);
    }
  });

  // @req FR-CLI-001 AC-4
  it("AC-4: a query none of whose words occur returns an empty result and exit code 0", async () => {
    const result = await cli(["--root", root, "search", "qxzv wkpj", "--json"]);
    expect(result.code).toBe(0);
    expect((JSON.parse(result.stdout) as SearchValue).records).toEqual([]);
    expect((await mcpSearch({ query: "qxzv wkpj" })).records).toEqual([]);
  });

  // @req FR-CLI-001 AC-5
  it("AC-5: the tool description and --help describe ranking, Korean handling, the default limit and exact mode", async () => {
    const help = (await cli(["search", "--help"])).stdout;
    for (const [surface, text] of [["search_requirements description", description], ["speckiwi search --help", help]] as const) {
      expect(text, surface).toMatch(/rank/i);
      expect(text, surface).toMatch(/Korean/);
      expect(text, surface).toMatch(/bigram/i);
      expect(text, surface).toMatch(/\b20\b/);
      expect(text, surface).toMatch(/exact/i);
    }
    expect(help).toContain("--exact");
    expect(description).toMatch(/match: "exact"|`match`/);
  });
});

describe("FR-FLOW-207 — the bilingual rule on the search surfaces", () => {
  // @req FR-FLOW-207 AC-1
  it("AC-1: the listed search_requirements description states the rule and pairs Korean with English in one example", () => {
    expect(description).toContain(BILINGUAL_SEARCH_RULE);
    expect(description).toContain(BILINGUAL_SEARCH_EXAMPLE);
    expect(BILINGUAL_SEARCH_EXAMPLE).toMatch(/[가-힣]/);
    expect(BILINGUAL_SEARCH_EXAMPLE).toMatch(/[a-z]/);
  });

  // @req FR-FLOW-207 AC-3
  it("AC-3: speckiwi search --help shows one example query carrying Korean and English words", async () => {
    const help = (await cli(["search", "--help"])).stdout;
    expect(help).toContain(BILINGUAL_SEARCH_EXAMPLE);
  });
});
