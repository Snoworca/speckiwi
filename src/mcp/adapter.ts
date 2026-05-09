export interface McpDependencies {
  root?: string;
}

export type McpToolHandler = (input: Record<string, unknown>) => Promise<unknown> | unknown;

export interface McpServerHandle {
  tools: Record<string, McpToolHandler>;
  resourceTemplates: string[];
  registerTool(name: string, handler: McpToolHandler, metadata?: Record<string, unknown>): void;
  registerResource(template: string, handler: McpToolHandler): void;
  callTool(name: string, input: Record<string, unknown>): Promise<unknown>;
}

export function createTestMcpServer(deps: McpDependencies): McpServerHandle {
  void deps;
  const tools: Record<string, McpToolHandler> = {};
  const resourceTemplates: string[] = [];
  return {
    tools,
    resourceTemplates,
    registerTool(name, handler) {
      tools[name] = handler;
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
