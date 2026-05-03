import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { CallToolRequestSchema, ErrorCode, McpError, type CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { SpecKiwiCore } from "../core/api.js";
import type { MachineResult } from "../core/dto.js";
import { machineErrorOutputSchema, toolOutputSchemaFor, toMcpToolResult } from "./structured-content.js";
import {
  applyChangeInputSchema,
  generateRequirementIdInputSchema,
  getRequirementInputSchema,
  graphInputSchema,
  impactInputSchema,
  listDocumentsInputSchema,
  listRequirementsInputSchema,
  overviewInputSchema,
  proposeChangeInputSchema,
  readDocumentInputSchema,
  searchInputSchema,
  traceRequirementInputSchema,
  validateInputSchema
} from "./schemas.js";

export { createSpecKiwiCore } from "../core/api.js";

export function registerMcpTools(server: McpServer, core: SpecKiwiCore): void {
  server.registerTool(
    "speckiwi_overview",
    {
      title: "Overview",
      description: "Return project overview and workspace statistics.",
      inputSchema: overviewInputSchema,
      outputSchema: toolOutputSchemaFor("speckiwi_overview"),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
    },
    async (input) => toolResultFromCore(await core.overview(input as Parameters<SpecKiwiCore["overview"]>[0]))
  );

  server.registerTool(
    "speckiwi_list_documents",
    {
      title: "List documents",
      description: "List registered SpecKiwi documents.",
      inputSchema: listDocumentsInputSchema,
      outputSchema: toolOutputSchemaFor("speckiwi_list_documents"),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
    },
    async (input) => toolResultFromCore(await core.listDocuments(input as Parameters<SpecKiwiCore["listDocuments"]>[0]))
  );

  server.registerTool(
    "speckiwi_read_document",
    {
      title: "Read document",
      description: "Read a registered document by id.",
      inputSchema: readDocumentInputSchema,
      outputSchema: toolOutputSchemaFor("speckiwi_read_document"),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
    },
    async (input) => toolResultFromCore(await core.readDocument(input as Parameters<SpecKiwiCore["readDocument"]>[0]))
  );

  server.registerTool(
    "speckiwi_search",
    {
      title: "Search",
      description: "Search workspace entities.",
      inputSchema: searchInputSchema,
      outputSchema: toolOutputSchemaFor("speckiwi_search"),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
    },
    async (input) => toolResultFromCore(await core.search(input as Parameters<SpecKiwiCore["search"]>[0]))
  );

  server.registerTool(
    "speckiwi_get_requirement",
    {
      title: "Get requirement",
      description: "Get one requirement by exact id.",
      inputSchema: getRequirementInputSchema,
      outputSchema: toolOutputSchemaFor("speckiwi_get_requirement"),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
    },
    async (input) =>
      toolResultFromCore(
        await core.getRequirement({ includeRelations: true, ...input } as Parameters<SpecKiwiCore["getRequirement"]>[0])
      )
  );

  server.registerTool(
    "speckiwi_list_requirements",
    {
      title: "List requirements",
      description: "List requirements with optional filters.",
      inputSchema: listRequirementsInputSchema,
      outputSchema: toolOutputSchemaFor("speckiwi_list_requirements"),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
    },
    async (input) => toolResultFromCore(await core.listRequirements(input as Parameters<SpecKiwiCore["listRequirements"]>[0]))
  );

  server.registerTool(
    "speckiwi_preview_requirement_id",
    {
      title: "Preview requirement id",
      description: "Preview deterministic requirement id generation without writing files.",
      inputSchema: generateRequirementIdInputSchema,
      outputSchema: toolOutputSchemaFor("speckiwi_preview_requirement_id"),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
    },
    async (input) => toolResultFromCore(await core.previewRequirementId(input as Parameters<SpecKiwiCore["previewRequirementId"]>[0]))
  );

  server.registerTool(
    "speckiwi_trace_requirement",
    {
      title: "Trace requirement",
      description: "Trace upstream and downstream requirement relations.",
      inputSchema: traceRequirementInputSchema,
      outputSchema: toolOutputSchemaFor("speckiwi_trace_requirement"),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
    },
    async (input) => toolResultFromCore(await core.traceRequirement(input as Parameters<SpecKiwiCore["traceRequirement"]>[0]))
  );

  server.registerTool(
    "speckiwi_graph",
    {
      title: "Graph",
      description: "Return a workspace graph.",
      inputSchema: graphInputSchema,
      outputSchema: toolOutputSchemaFor("speckiwi_graph"),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
    },
    async (input) => toolResultFromCore(await core.graph(input as Parameters<SpecKiwiCore["graph"]>[0]))
  );

  server.registerTool(
    "speckiwi_impact",
    {
      title: "Impact",
      description: "Calculate requirement impact.",
      inputSchema: impactInputSchema,
      outputSchema: toolOutputSchemaFor("speckiwi_impact"),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
    },
    async (input) => toolResultFromCore(await core.impact(input as Parameters<SpecKiwiCore["impact"]>[0]))
  );

  server.registerTool(
    "speckiwi_validate",
    {
      title: "Validate",
      description: "Validate workspace YAML and semantic rules.",
      inputSchema: validateInputSchema,
      outputSchema: toolOutputSchemaFor("speckiwi_validate"),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
    },
    async (input) => toolResultFromCore(await core.validate(input as Parameters<SpecKiwiCore["validate"]>[0]))
  );

  server.registerTool(
    "speckiwi_propose_change",
    {
      title: "Propose change",
      description: "Create a managed proposal without changing source YAML.",
      inputSchema: proposeChangeInputSchema,
      outputSchema: toolOutputSchemaFor("speckiwi_propose_change"),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false }
    },
    async (input) => toolResultFromCore(await core.proposeChange(input as Parameters<SpecKiwiCore["proposeChange"]>[0]))
  );

  server.registerTool(
    "speckiwi_apply_change",
    {
      title: "Apply change",
      description: "Apply a validated proposal or change when workspace policy allows it.",
      inputSchema: applyChangeInputSchema,
      outputSchema: toolOutputSchemaFor("speckiwi_apply_change"),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false }
    },
    async (input) => toolResultFromCore(await core.applyChange(input as Parameters<SpecKiwiCore["applyChange"]>[0]))
  );

  installStrictToolCallHandler(server);
}

export function toolResultFromCore<T extends MachineResult>(result: T): CallToolResult {
  return toMcpToolResult(result);
}

type ParseSchema = {
  safeParseAsync(input: unknown): Promise<{ success: true; data: unknown } | { success: false; error: unknown }>;
};

type RegisteredTool = {
  inputSchema?: ParseSchema;
  outputSchema?: ParseSchema;
  handler: (input: unknown, extra: unknown) => Promise<CallToolResult> | CallToolResult;
  enabled: boolean;
};

function installStrictToolCallHandler(server: McpServer): void {
  const registeredTools = (server as unknown as { _registeredTools: Record<string, RegisteredTool> })._registeredTools;

  server.server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
    const tool = registeredTools[request.params.name];
    if (tool === undefined || !tool.enabled) {
      throw new McpError(ErrorCode.InvalidParams, `Tool ${request.params.name} not found`);
    }

    const input = await parseToolInput(tool, request.params.arguments ?? {}, request.params.name);
    const result = await Promise.resolve(tool.handler(input, extra));
    await validateToolOutput(tool, result, request.params.name);
    return result;
  });
}

async function parseToolInput(tool: RegisteredTool, input: unknown, toolName: string): Promise<unknown> {
  if (tool.inputSchema === undefined) {
    return undefined;
  }

  const parsed = await tool.inputSchema.safeParseAsync(input);
  if (!parsed.success) {
    throw new McpError(ErrorCode.InvalidParams, `Input validation error: Invalid arguments for tool ${toolName}: ${formatSchemaError(parsed.error)}`);
  }
  return parsed.data;
}

async function validateToolOutput(tool: RegisteredTool, result: CallToolResult, toolName: string): Promise<void> {
  if (tool.outputSchema === undefined) {
    return;
  }

  if (result.structuredContent === undefined) {
    throw new McpError(ErrorCode.InvalidParams, `Output validation error: Tool ${toolName} has an output schema but no structured content was provided`);
  }

  const outputSchema = result.isError === true ? machineErrorOutputSchema : tool.outputSchema;
  const parsed = await outputSchema.safeParseAsync(result.structuredContent);
  if (!parsed.success) {
    throw new McpError(ErrorCode.InvalidParams, `Output validation error: Invalid structured content for tool ${toolName}: ${formatSchemaError(parsed.error)}`);
  }
}

function formatSchemaError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
