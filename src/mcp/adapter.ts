import { createRequire } from "node:module";
import path from "node:path";

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
const requirePackage = createRequire(import.meta.url);
const PACKAGE_VERSION = (requirePackage("../../package.json") as { version?: string }).version ?? "unknown";

export function assertMutationKind(name: string, metadata?: { kind?: MutationToolKind }): MutationToolKind {
  const kind = metadata?.kind;
  if (!kind || !VALID_KINDS.includes(kind)) {
    throw new Error(`Mutation tool '${name}' missing kind metadata (expected one of: ${VALID_KINDS.join(", ")})`);
  }
  return kind;
}

export function createTestMcpServer(deps: McpDependencies): McpServerHandle {
  const tools: Record<string, McpToolHandler> = {};
  const resourceTemplates: string[] = [];
  const toolKinds: Record<string, MutationToolKind> = {};
  const workspaceRoot = deps.root ? path.resolve(deps.root) : path.resolve(process.cwd());
  const workspaceIdentity = {
    workspaceRoot,
    // REL-MCP-004 AC-2: explicit root 소스는 존재하지 않는다. 내부 DI seam(deps.root)은 서버 cwd 를 대체하는 테스트 전용 경로다.
    rootSource: "server-cwd-discovery",
    indexPath: path.posix.join("docs", "spec", "00.index.md"),
    packageVersion: PACKAGE_VERSION
  };
  const unsupportedWorkspaceInput = (input: Record<string, unknown>): unknown | null => {
    if (!("root" in input) && !("workspaceRoot" in input)) return null;
    return {
      ok: false,
      error: {
        code: "MCP_WORKSPACE_ROOT_UNSUPPORTED",
        message: "Per-call workspace root override is not supported; start a server for the intended workspace root."
      },
      diagnostics: [
        {
          code: "SRS-E075",
          severity: "error",
          message: "MCP per-call workspace root override is not supported",
          details: { root: input.root, workspaceRoot: input.workspaceRoot, rootSource: workspaceIdentity.rootSource }
        }
      ],
      diagnosticsSummary: { errors: 1, warnings: 0, byCode: { "SRS-E075": 1 } },
      mcpWorkspace: workspaceIdentity,
      // @req FR-MCP-055: no tool can move an already-running server, so name the operator action
      // instead of a tool this server does not register.
      recovery: {
        message:
          "The workspace root is resolved only from the MCP server process working directory. Start the SpecKiwi MCP server — or the agent session that owns it — in the intended project directory instead of passing root per call."
      }
    };
  };
  const attachWorkspace = (value: unknown): unknown => {
    if (typeof value !== "object" || value === null || Array.isArray(value)) return value;
    if ("mcpWorkspace" in value) return value;
    return { ...(value as Record<string, unknown>), mcpWorkspace: workspaceIdentity };
  };
  return {
    tools,
    resourceTemplates,
    toolKinds,
    registerTool(name, handler, metadata) {
      tools[name] = async (input) => unsupportedWorkspaceInput(input) ?? attachWorkspace(await handler(input));
      if (metadata?.kind && VALID_KINDS.includes(metadata.kind)) {
        toolKinds[name] = metadata.kind;
      }
    },
    registerResource(template, handler) {
      resourceTemplates.push(template);
      tools[`resource:${template}`] = async (input) => unsupportedWorkspaceInput(input) ?? attachWorkspace(await handler(input));
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
