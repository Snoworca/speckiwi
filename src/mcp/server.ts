import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { CacheMode } from "../core/inputs.js";
import { readMcpResource } from "./resources.js";
import { createSpecKiwiCore, registerMcpTools } from "./tools.js";

export type McpServerInput = {
  root: string;
  cacheMode?: CacheMode;
};

export function createMcpServer(input: McpServerInput): McpServer {
  const core = createSpecKiwiCore(input);
  const server = new McpServer(
    {
      name: "speckiwi",
      version: "0.1.0"
    },
    {
      capabilities: {
        resources: {}
      }
    }
  );

  registerMcpTools(server, core);

  server.registerResource(
    "speckiwi_overview",
    "speckiwi://overview",
    {
      title: "SpecKiwi overview",
      description: "Raw .speckiwi/overview.yaml",
      mimeType: "application/yaml"
    },
    (uri) => readMcpResource(uri.toString(), core)
  );
  server.registerResource(
    "speckiwi_index",
    "speckiwi://index",
    {
      title: "SpecKiwi index",
      description: "Raw .speckiwi/index.yaml",
      mimeType: "application/yaml"
    },
    (uri) => readMcpResource(uri.toString(), core)
  );
  server.registerResource(
    "speckiwi_document",
    new ResourceTemplate("speckiwi://documents/{id}", { list: undefined }),
    {
      title: "SpecKiwi document",
      description: "Raw YAML for a registered document",
      mimeType: "application/yaml"
    },
    (uri) => readMcpResource(uri.toString(), core)
  );
  server.registerResource(
    "speckiwi_requirement",
    new ResourceTemplate("speckiwi://requirements/{id}", { list: undefined }),
    {
      title: "SpecKiwi requirement context",
      description: "Stable JSON context for a requirement",
      mimeType: "application/json"
    },
    (uri) => readMcpResource(uri.toString(), core)
  );
  server.registerResource(
    "speckiwi_scope",
    new ResourceTemplate("speckiwi://scopes/{id}", { list: undefined }),
    {
      title: "SpecKiwi scope context",
      description: "Stable JSON context for a scope",
      mimeType: "application/json"
    },
    (uri) => readMcpResource(uri.toString(), core)
  );

  return server;
}

export async function runMcpServer(input: McpServerInput): Promise<void> {
  const server = createMcpServer(input);
  await server.connect(new StdioServerTransport());
  await new Promise<void>((resolve) => {
    process.stdin.once("end", resolve);
    process.stdin.once("close", resolve);
    process.once("SIGINT", resolve);
    process.once("SIGTERM", resolve);
  });
  await server.close();
}
