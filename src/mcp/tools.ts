import { resolve } from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { CallToolRequestSchema, ErrorCode, McpError, type CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type {
  ApplyResult,
  CacheResult,
  CoreResult,
  DoctorResult,
  GraphResult,
  ImpactResult,
  InitResult,
  JsonObject,
  MachineResult,
  OverviewResult,
  ReadDocumentResult,
  RequirementIdPreviewResult,
  RequirementListResult,
  RequirementResult,
  SearchResultSet,
  TraceResult,
  ValidateResult
} from "../core/dto.js";
import type {
  ApplyChangeInput,
  CacheMode,
  GenerateRequirementIdInput,
  GraphInput,
  GetRequirementInput,
  ImpactInput,
  ListDocumentsInput,
  ListRequirementsInput,
  OverviewInput,
  ProposeChangeInput,
  ReadDocumentInput,
  SearchInput,
  TraceRequirementInput,
  ValidateInput
} from "../core/inputs.js";
import { applyChange } from "../core/apply-change.js";
import { listDocuments, readDocument } from "../core/documents.js";
import { overview } from "../core/overview.js";
import { createProposal } from "../core/propose-change.js";
import { getRequirement, listRequirements, loadRequirementRegistry, previewRequirementId, type RequirementRegistry } from "../core/requirements.js";
import { searchWorkspace } from "../core/search.js";
import { validateWorkspace } from "../core/validate.js";
import { createDiagnosticBag, fail } from "../core/result.js";
import { buildGraph } from "../graph/builder.js";
import { impactRequirement } from "../graph/impact.js";
import { traceRequirement } from "../graph/trace.js";
import { workspaceRootFromPath } from "../io/workspace.js";
import { loadWorkspaceForValidation } from "../validate/semantic.js";
import { machineResultOutputSchema, toMcpToolResult } from "./structured-content.js";
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
  validateInputSchema,
  type ApplyChangeToolInput,
  type GenerateRequirementIdToolInput,
  type GetRequirementToolInput,
  type GraphToolInput,
  type ImpactToolInput,
  type ListDocumentsToolInput,
  type ListRequirementsToolInput,
  type OverviewToolInput,
  type ProposeChangeToolInput,
  type ReadDocumentToolInput,
  type SearchToolInput,
  type TraceRequirementToolInput,
  type ValidateToolInput
} from "./schemas.js";

type BindableInput = {
  cacheMode?: CacheMode | undefined;
};

type RootBound<T extends BindableInput> = Omit<T, "root"> & {
  root: string;
  cacheMode: CacheMode;
};

export type SpecKiwiCore = {
  root: string;
  cacheMode: CacheMode;
  overview(input?: OverviewToolInput): Promise<OverviewResult>;
  listDocuments(input?: ListDocumentsToolInput): ReturnType<typeof listDocuments>;
  readDocument(input: ReadDocumentToolInput): Promise<ReadDocumentResult>;
  search(input: SearchToolInput): Promise<SearchResultSet>;
  getRequirement(input: GetRequirementToolInput): Promise<RequirementResult>;
  listRequirements(input?: ListRequirementsToolInput): Promise<RequirementListResult>;
  previewRequirementId(input: GenerateRequirementIdToolInput): Promise<RequirementIdPreviewResult>;
  traceRequirement(input: TraceRequirementToolInput): Promise<TraceResult>;
  graph(input?: GraphToolInput): Promise<GraphResult>;
  impact(input: ImpactToolInput): Promise<ImpactResult>;
  validate(input?: ValidateToolInput): Promise<ValidateResult>;
  proposeChange(input: ProposeChangeToolInput): ReturnType<typeof createProposal>;
  applyChange(input: ApplyChangeToolInput): Promise<ApplyResult>;
  loadRequirementRegistry(): Promise<RequirementRegistry>;
};

export type McpToolResultCore =
  | OverviewResult
  | ReturnType<typeof fail>
  | ReadDocumentResult
  | SearchResultSet
  | RequirementResult
  | RequirementListResult
  | RequirementIdPreviewResult
  | GraphResult
  | TraceResult
  | ImpactResult
  | ValidateResult
  | ApplyResult
  | CacheResult
  | DoctorResult
  | InitResult
  | CoreResult<JsonObject>;

export function createSpecKiwiCore(input: { root: string; cacheMode?: CacheMode }): SpecKiwiCore {
  const root = resolve(input.root);
  const cacheMode = input.cacheMode ?? "auto";

  function bind<T extends BindableInput>(value: T | undefined): RootBound<T> {
    return {
      ...stripUndefined(value ?? ({} as T)),
      root,
      cacheMode: value?.cacheMode ?? cacheMode
    } as RootBound<T>;
  }

  async function graph(inputValue: GraphInput = {}): Promise<GraphResult> {
    const workspaceRoot = workspaceRootFromPath(resolve(root));
    const workspace = await loadWorkspaceForValidation(workspaceRoot);
    return buildGraph(workspace, inputValue.graphType);
  }

  return {
    root,
    cacheMode,
    overview: (value = {}) => overview(bind(value) as OverviewInput),
    listDocuments: (value = {}) => listDocuments(bind(value) as ListDocumentsInput),
    readDocument: (value) => readDocument(bind(value) as ReadDocumentInput),
    search: (value) => searchWorkspace(bind(value) as SearchInput),
    getRequirement: (value) => getRequirement(bind(value) as GetRequirementInput),
    listRequirements: (value = {}) => listRequirements(bind(value) as ListRequirementsInput),
    previewRequirementId: async (value) => previewRequirementId(bind(value) as GenerateRequirementIdInput, await loadRequirementRegistry({ root, cacheMode: value.cacheMode ?? cacheMode })),
    traceRequirement: async (value) => traceRequirement(bind(value) as TraceRequirementInput, await graph({ graphType: "traceability" })),
    graph,
    impact: async (value) => impactRequirement(bind(value) as ImpactInput, await graph({ graphType: "traceability" })),
    validate: (value = {}) => validateWorkspace(bind(value) as ValidateInput),
    proposeChange: (value) => createProposal(bind(value) as ProposeChangeInput),
    applyChange: (value) => {
      if (value.confirm !== true) {
        return Promise.resolve(
          fail(
            { code: "APPLY_REJECTED_CONFIRM_REQUIRED", message: "Apply requires confirm=true." },
            createDiagnosticBag([{ severity: "error", code: "APPLY_REJECTED_CONFIRM_REQUIRED", message: "Apply requires confirm=true." }])
          ) as ApplyResult
        );
      }
      return applyChange(bind(value) as ApplyChangeInput);
    },
    loadRequirementRegistry: () => loadRequirementRegistry({ root, cacheMode })
  };
}

function stripUndefined<T extends BindableInput>(value: T): Partial<T> {
  const output: Partial<T> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (entry !== undefined) {
      output[key as keyof T] = entry as T[keyof T];
    }
  }
  return output;
}

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
    async (input) => toolResultFromCore(await core.overview(input))
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
    async (input) => toolResultFromCore(await core.listDocuments(input))
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
    async (input) => toolResultFromCore(await core.readDocument(input))
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
    async (input) => toolResultFromCore(await core.search(input))
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
    async (input) => toolResultFromCore(await core.getRequirement({ includeRelations: true, ...input }))
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
    async (input) => toolResultFromCore(await core.listRequirements(input))
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
    async (input) => toolResultFromCore(await core.previewRequirementId(input))
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
    async (input) => toolResultFromCore(await core.traceRequirement(input))
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
    async (input) => toolResultFromCore(await core.graph(input))
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
    async (input) => toolResultFromCore(await core.impact(input))
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
    async (input) => toolResultFromCore(await core.validate(input))
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
    async (input) => toolResultFromCore(await core.proposeChange(input))
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
    async (input) => toolResultFromCore(await core.applyChange(input))
  );

  installStrictToolCallHandler(server);
}

export function toolResultFromCore<T extends MachineResult>(result: T): CallToolResult {
  return toMcpToolResult(result);
}

export function toolOutputSchemaFor(name: string): typeof machineResultOutputSchema {
  void name;
  return machineResultOutputSchema;
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
  if (tool.outputSchema === undefined || result.isError === true) {
    return;
  }

  if (result.structuredContent === undefined) {
    throw new McpError(ErrorCode.InvalidParams, `Output validation error: Tool ${toolName} has an output schema but no structured content was provided`);
  }

  const parsed = await tool.outputSchema.safeParseAsync(result.structuredContent);
  if (!parsed.success) {
    throw new McpError(ErrorCode.InvalidParams, `Output validation error: Invalid structured content for tool ${toolName}: ${formatSchemaError(parsed.error)}`);
  }
}

function formatSchemaError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
