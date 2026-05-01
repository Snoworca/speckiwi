import { ErrorCode, McpError } from "@modelcontextprotocol/sdk/types.js";
import { describe, expect, it } from "vitest";
import { createSpecKiwiCore } from "../../src/mcp/tools.js";
import { parseSpeckiwiResourceUri } from "../../src/mcp/resource-uri.js";
import { readMcpResource } from "../../src/mcp/resources.js";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "../..");
const validRoot = resolve(root, "test/fixtures/workspaces/valid-basic");

describe("mcp-resources", () => {
  it("parses resource URIs and rejects malformed ids", () => {
    expect(parseSpeckiwiResourceUri("speckiwi://overview")).toEqual({ kind: "overview", uri: "speckiwi://overview" });
    expect(parseSpeckiwiResourceUri("speckiwi://documents/srs.core")).toEqual({
      kind: "document",
      uri: "speckiwi://documents/srs.core",
      id: "srs.core"
    });

    expect(() => parseSpeckiwiResourceUri("speckiwi://documents/%2E%2E")).toThrow(McpError);
    expect(() => parseSpeckiwiResourceUri("speckiwi://documents/a%2Fb")).toThrow(McpError);
  });

  it("reads static YAML and registered document resources", async () => {
    const core = createSpecKiwiCore({ root: validRoot });
    const overview = await readMcpResource("speckiwi://overview", core);
    const index = await readMcpResource("speckiwi://index", core);
    const document = await readMcpResource("speckiwi://documents/srs.core", core);

    expect(overview.contents[0]).toMatchObject({ uri: "speckiwi://overview", mimeType: "application/yaml" });
    expect(overview.contents[0]?.text).toContain("title: SpecKiwi");
    expect(index.contents[0]).toMatchObject({ uri: "speckiwi://index", mimeType: "application/yaml" });
    expect(document.contents[0]).toMatchObject({ uri: "speckiwi://documents/srs.core", mimeType: "application/yaml" });
    expect(document.contents[0]?.text).toContain("id: FR-CORE-0001");
  });

  it("reads stable JSON requirement and scope contexts", async () => {
    const core = createSpecKiwiCore({ root: validRoot });
    const requirement = await readMcpResource("speckiwi://requirements/FR-CORE-0001", core);
    const scope = await readMcpResource("speckiwi://scopes/core", core);

    expect(requirement.contents[0]).toMatchObject({ mimeType: "application/json" });
    expect(JSON.parse(requirement.contents[0]?.text ?? "{}")).toMatchObject({
      id: "FR-CORE-0001",
      documentId: "srs.core",
      relations: { incoming: [], outgoing: [] }
    });
    expect(JSON.parse(scope.contents[0]?.text ?? "{}")).toMatchObject({
      id: "core",
      documents: ["srs.core"],
      requirements: ["FR-CORE-0001"]
    });
  });

  it("maps malformed and unknown resources to documented JSON-RPC errors", async () => {
    const core = createSpecKiwiCore({ root: validRoot });

    await expect(readMcpResource("speckiwi://documents/%2E%2E", core)).rejects.toMatchObject({ code: ErrorCode.InvalidParams });
    await expect(readMcpResource("speckiwi://requirements/FR-NOPE-9999", core)).rejects.toMatchObject({ code: -32002 });
  });
});
