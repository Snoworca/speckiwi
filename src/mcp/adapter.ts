export type MutationToolKind = "req-scoped" | "log-append" | "workspace";

export interface McpDependencies {
  root?: string;
}

export type McpToolHandler = (input: Record<string, unknown>) => Promise<unknown> | unknown;

export interface McpServerHandle {
  tools: Record<string, McpToolHandler>;
  resourceTemplates: string[];
  toolKinds: Record<string, MutationToolKind>;
  registerTool(name: string, handler: McpToolHandler, metadata?: { kind?: MutationToolKind } & Record<string, unknown>): void;
  registerResource(template: string, handler: McpToolHandler): void;
  callTool(name: string, input: Record<string, unknown>): Promise<unknown>;
}

const VALID_KINDS: readonly MutationToolKind[] = ["req-scoped", "log-append", "workspace"];

export function assertMutationKind(name: string, metadata?: { kind?: MutationToolKind }): MutationToolKind {
  const kind = metadata?.kind;
  if (!kind || !VALID_KINDS.includes(kind)) {
    throw new Error(`Mutation tool '${name}' missing kind metadata (expected one of: ${VALID_KINDS.join(", ")})`);
  }
  return kind;
}

export function createTestMcpServer(deps: McpDependencies): McpServerHandle {
  void deps;
  const tools: Record<string, McpToolHandler> = {};
  const resourceTemplates: string[] = [];
  const toolKinds: Record<string, MutationToolKind> = {};
  return {
    tools,
    resourceTemplates,
    toolKinds,
    registerTool(name, handler, metadata) {
      tools[name] = handler;
      if (metadata?.kind && VALID_KINDS.includes(metadata.kind)) {
        toolKinds[name] = metadata.kind;
      }
    },
    registerResource(template, handler) {
      resourceTemplates.push(template);
      tools[`resource:${template}`] = handler;
    },
    async callTool(name, input) {
      const handler = tools[name];
      if (!handler) throw new Error(`Unknown MCP tool: ${name}`);
      return handler(input);
    }
  };
}

export function toMcpToolResult(value: unknown): { ok: true; value: unknown } {
  return { ok: true, value };
}
