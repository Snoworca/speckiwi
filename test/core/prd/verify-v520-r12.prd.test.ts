import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";
import { createMcpServer, createSdkServer } from "../../../src/mcp/server.js";
import { PRD_PATH, prdWorkspace } from "../../cli/prd-surface-fixture.js";

// Round 12 of the 5.2.0 PRD tool verification. The shared required-argument check
// (src/mcp/required-args.ts, missingRequiredArguments) answers USAGE when a handler is called in
// process, but a real MCP client goes through createSdkServer, whose input schema (sdkToolInputSchema)
// declares the same arguments as required, so the SDK rejects the call first with JSON-RPC -32602.
// Lead decision (round 12): -32602 "Invalid params" is the protocol's own usage-error category and is
// how every SpecKiwi MCP tool already answers a missing required argument over the protocol; no AC asks
// for the USAGE envelope there. The kept property is that a missing required argument is refused as a
// usage error over the protocol and never reaches the tool as an empty value (which answered NOT_FOUND).

async function protocolCall(tool: string, args: Record<string, unknown>): Promise<string> {
  const root = await prdWorkspace();
  const sdk = createSdkServer(createMcpServer({ root }));
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "verify-r12", version: "0" });
  await Promise.all([sdk.connect(serverTransport), client.connect(clientTransport)]);
  const result = (await client.callTool({ name: tool, arguments: args })) as { content: { text: string }[] };
  await client.close();
  return result.content[0]!.text;
}

function refusedAsUsage(text: string): boolean {
  if (text.startsWith("{")) return (JSON.parse(text) as { error?: { code?: string } }).error?.code === "USAGE";
  return text.includes("-32602");
}

describe("verify 5.2.0 round 12 — required arguments over the MCP protocol", () => {
  // @req FR-NODE-240 AC-3
  it("refuses a get_prd_item call without id over the protocol as a usage error", async () => {
    const text = await protocolCall("get_prd_item", { path: PRD_PATH });
    expect(refusedAsUsage(text), text.slice(0, 120)).toBe(true);
  });

  // @req IR-MCP-006 AC-1
  it("refuses a rename_scope call without from over the protocol as a usage error", async () => {
    const text = await protocolCall("rename_scope", { to: "02.renamed" });
    expect(refusedAsUsage(text), text.slice(0, 120)).toBe(true);
  });
});
