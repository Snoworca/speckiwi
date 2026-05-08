import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { createTestMcpServer, type McpDependencies, type McpServerHandle } from "./adapter.js";
import { registerReadTools } from "./tools/read-tools.js";
import { registerMutationTools } from "./tools/mutation-tools.js";
import { registerResources } from "./resources.js";

export interface McpServerOptions {
  root: string;
  transport?: "stdio";
}

export function createMcpServer(deps: McpDependencies): McpServerHandle {
  const server = createTestMcpServer(deps);
  registerReadTools(server, deps);
  registerMutationTools(server, deps);
  registerResources(server, deps);
  return server;
}

const toolSchemas: Record<string, Record<string, z.ZodTypeAny>> = {
  list_requirements: {
    target: z.string().optional(),
    status: z.string().optional(),
    type: z.string().optional(),
    scope: z.string().optional(),
    tag: z.string().optional()
  },
  get_requirement: { id: z.string(), includeMarkdown: z.boolean().optional() },
  validate_spec: { strict: z.boolean().optional(), failOnWarning: z.boolean().optional() },
  summarize_target: { target: z.string().optional() },
  update_status: { id: z.string(), status: z.string() },
  check_acceptance_criteria: { id: z.string(), acIds: z.array(z.string()), checked: z.boolean() },
  add_verification_evidence: { id: z.string(), type: z.string(), reference: z.string(), covers: z.string().optional(), notes: z.string().optional() },
  add_trace_link: { id: z.string(), type: z.string(), reference: z.string(), relation: z.string(), notes: z.string().optional() },
  add_requirement: {
    type: z.string(),
    scope: z.string(),
    target: z.string(),
    title: z.string(),
    requirement: z.string(),
    statement: z.string().optional(),
    acceptanceCriteria: z.array(z.string()),
    checkedAcceptanceCriteria: z.array(z.string()).optional(),
    status: z.string().optional(),
    priority: z.string().optional(),
    tags: z.array(z.string()).optional(),
    risk: z.string().optional(),
    stability: z.string().optional(),
    verificationMethod: z.string().optional(),
    githubIssue: z.string().optional(),
    relatedDocs: z.array(z.string()).optional(),
    rationale: z.string().optional(),
    implementationNotes: z.string().optional(),
    research: z.string().optional(),
    changeNotes: z.string().optional(),
    evidence: z.array(z.record(z.string(), z.unknown())).optional(),
    trace: z.array(z.record(z.string(), z.unknown())).optional(),
    dryRun: z.boolean().optional()
  },
  init_project: {
    target: z.string().optional(),
    scope: z.string().optional(),
    force: z.boolean().optional(),
    agentFile: z.union([z.string(), z.array(z.string())]).optional(),
    agentFiles: z.union([z.string(), z.array(z.string())]).optional()
  }
};

function isReadOnlyTool(name: string): boolean {
  return ["list_requirements", "get_requirement", "validate_spec", "summarize_target"].includes(name);
}

export async function startMcpServer(options: McpServerOptions): Promise<void> {
  const sdk = new McpServer({ name: "speckiwi", version: "1.0.0" });
  const local = createMcpServer({ root: options.root });
  for (const [name, handler] of Object.entries(local.tools).filter(([name]) => !name.startsWith("resource:"))) {
    sdk.registerTool(name, {
      title: name,
      inputSchema: toolSchemas[name] ?? {},
      annotations: { readOnlyHint: isReadOnlyTool(name) }
    }, async (input) => ({
      content: [{ type: "text", text: JSON.stringify(await handler(input as Record<string, unknown>)) }]
    }));
  }
  sdk.registerResource("speckiwi-index", "speckiwi://index", { title: "SpecKiwi SRS Index", mimeType: "application/json" }, async (uri) => {
    const value = await local.tools["resource:speckiwi://index"]?.({});
    return { contents: [{ uri: uri.href, text: JSON.stringify(value), mimeType: "application/json" }] };
  });
  sdk.registerResource(
    "speckiwi-requirements",
    new ResourceTemplate("speckiwi://requirements/{id}", { list: undefined }),
    { title: "SpecKiwi Requirement", mimeType: "application/json" },
    async (uri, variables) => {
      const value = await local.tools["resource:speckiwi://requirements/{id}"]?.({ id: variables.id });
      return { contents: [{ uri: uri.href, text: JSON.stringify(value), mimeType: "application/json" }] };
    }
  );
  sdk.registerResource(
    "speckiwi-targets",
    new ResourceTemplate("speckiwi://targets/{target}", { list: undefined }),
    { title: "SpecKiwi Target Summary", mimeType: "application/json" },
    async (uri, variables) => {
      const value = await local.tools["resource:speckiwi://targets/{target}"]?.({ target: variables.target });
      return { contents: [{ uri: uri.href, text: JSON.stringify(value), mimeType: "application/json" }] };
    }
  );
  sdk.registerResource(
    "speckiwi-scopes",
    new ResourceTemplate("speckiwi://scopes/{scope}", { list: undefined }),
    { title: "SpecKiwi Scope Requirements", mimeType: "application/json" },
    async (uri, variables) => {
      const value = await local.tools["resource:speckiwi://scopes/{scope}"]?.({ scope: variables.scope });
      return { contents: [{ uri: uri.href, text: JSON.stringify(value), mimeType: "application/json" }] };
    }
  );
  await sdk.connect(new StdioServerTransport());
}
