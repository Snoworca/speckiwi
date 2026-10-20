import { createRequire } from "node:module";
import path from "node:path";
import {
  decideWorkspaceRoot,
  hasSrsIndex,
  isWorkspaceScope,
  srsDestination,
  SRS_INDEX_RELATIVE,
  type WorkspaceRootReason,
  type WorkspaceScope
} from "./workspace-root.js";

export type MutationToolKind = "req-scoped" | "log-append" | "workspace";

/** Where the root that answered a call came from, or `unbound` when none could. @req REL-MCP-005 AC-2 */
export type McpRootSource = "server-cwd-discovery" | "per-call-workspace-root" | "unbound";

/**
 * A server whose startup search found no SRS. @req FR-MCP-067 — it answers every call with the
 * unbound refusal; `initHint` is true only when the checked directory is inside a git work tree and is
 * not the home directory, the one case where the refusal may suggest `speckiwi init`.
 */
export interface McpUnboundStartup {
  checkedCwd: string;
  initHint: boolean;
}

export interface McpDependencies {
  root?: string;
  /** How the startup root was decided; defaults to cwd discovery. @req REL-MCP-005 AC-2 */
  rootSource?: McpRootSource;
  /** Set when the startup search found no SRS; every call is then refused. @req FR-MCP-067 */
  unbound?: McpUnboundStartup;
}

/**
 * The root one call runs against, decided at the registration seam and handed down.
 *
 * Handed to the handler rather than read from its input on purpose: `root(deps, input)` in
 * mutation-tools has 38 call sites and only 9 are `workflow_*`, so teaching that shared helper to
 * honour `input.workspaceRoot` would open the whole SRS family. @req REL-MCP-005 AC-3
 */
export interface McpCallContext {
  readonly root: string | undefined;
  readonly rootSource: McpRootSource;
}

/**
 * `context` is optional in the signature because the map this server exposes holds the *guarded*
 * wrappers, and a wrapper decides the context itself — an outside caller has nothing to supply.
 */
export type McpToolHandler = (input: Record<string, unknown>, context?: McpCallContext) => Promise<unknown> | unknown;

/**
 * A tool declares the subject it admits a per-call root for: `worktree-local` for run state that
 * lives in a worktree, `srs-read-only` for a query that reads a checkout's SRS and writes nothing.
 * Absence is the refusal: a newly added SRS mutation tool is fail-closed without being listed
 * anywhere, and so is a tool whose declared scope is misspelt.
 *
 * `callerPathKeys` names which of the tool's arguments are paths, for the destination rule in
 * {@link srsDestination}. Absence there is also the safe side — every argument is scanned.
 * @req REL-MCP-005 AC-3 / AC-6 @req FR-MCP-064 AC-7
 */
export interface McpToolMetadata {
  kind?: MutationToolKind;
  workspaceScope?: WorkspaceScope;
  callerPathKeys?: readonly string[];
  workspaceRootRefusal?: { reason: WorkspaceRootReason; message: string };
  [key: string]: unknown;
}

export interface McpServerHandle {
  tools: Record<string, McpToolHandler>;
  resourceTemplates: string[];
  toolKinds: Record<string, MutationToolKind>;
  registerTool(name: string, handler: McpToolHandler, metadata?: McpToolMetadata): void;
  registerResource(template: string, handler: McpToolHandler): void;
  callTool(name: string, input: Record<string, unknown>): Promise<unknown>;
}

const VALID_KINDS: readonly MutationToolKind[] = ["req-scoped", "log-append", "workspace"];
const requirePackage = createRequire(import.meta.url);
const PACKAGE_VERSION = (requirePackage("../../package.json") as { version?: string }).version ?? "unknown";

const UNSUPPORTED_MESSAGE =
  "Per-call workspace root override is not supported; start a server for the intended workspace root.";
// @req FR-MCP-055: no tool can move an already-running server, so name the operator action instead
// of a tool this server does not register.
const UNSUPPORTED_RECOVERY =
  "The workspace root is resolved only from the MCP server process working directory. Start the SpecKiwi MCP server — or the agent session that owns it — in the intended project directory instead of passing root per call.";
/** @req FR-MCP-067 AC-5 — what an unbound server tells the caller to do. */
export function unboundRecovery(unbound: McpUnboundStartup): string {
  const common =
    `The MCP server checked ${unbound.checkedCwd} and found no SRS there or above it. ` +
    "The workspace root is resolved only from the MCP server process working directory, so start the MCP server with its working directory set to the project: " +
    "start the agent session in the project, or set the working directory in the client's MCP server configuration. " +
    "The server stays unbound until the session or server is restarted";
  return unbound.initHint
    ? `${common}; if this project has no SRS yet, run \`speckiwi init\` in the project directory, then restart the session.`
    : `${common}. It was started outside any project.`;
}

const REFUSED_RECOVERY =
  "Supply workspaceRoot as the absolute path of a git top level that is a worktree of the MCP server's own repository, and never point a path argument at docs/spec.";

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
  const startupRoot = deps.root ? path.resolve(deps.root) : path.resolve(process.cwd());
  const identityFor = (workspaceRoot: string, rootSource: McpRootSource) => ({
    workspaceRoot,
    rootSource,
    indexPath: path.posix.join("docs", "spec", "00.index.md"),
    packageVersion: PACKAGE_VERSION
  });
  const startupSource: McpRootSource = deps.rootSource ?? "server-cwd-discovery";
  const startupIdentity = identityFor(startupRoot, startupSource);
  const startupContext: McpCallContext = { root: deps.root, rootSource: startupSource };

  /**
   * @req FR-MCP-067 AC-4 AC-5 AC-6 — the answer to every call on an unbound server, decided before the
   * per-call gate and before any handler exists, so neither a `workspaceRoot` nor `init_project` can
   * reach a directory the server was never bound to.
   */
  const unboundRefusal = (unbound: McpUnboundStartup): unknown => {
    const message = `This SpecKiwi MCP server is unbound: its startup search found no ${SRS_INDEX_RELATIVE}, so it answers no call.`;
    return {
      ok: false,
      error: { code: "MCP_WORKSPACE_UNBOUND", message },
      diagnostics: [{ code: "SRS-E077", severity: "error", message, details: { checkedCwd: unbound.checkedCwd, rootSource: "unbound" } }],
      diagnosticsSummary: { errors: 1, warnings: 0, byCode: { "SRS-E077": 1 } },
      mcpWorkspace: { workspaceRoot: null, rootSource: "unbound", indexPath: null, packageVersion: PACKAGE_VERSION, checkedCwd: unbound.checkedCwd },
      recovery: { message: unboundRecovery(unbound) }
    };
  };

  /**
   * What a caller who named a checkout holding no SRS index is told.
   *
   * It names the checkout that was examined and stops there. It is deliberately not a repair
   * command: `speckiwi init --force` is on record as removing requirements without a symptom, and a
   * refusal that teaches it turns a typo into data loss. @req FR-MCP-064 AC-6
   */
  const missingIndexRecovery = (examined: string): string =>
    `No ${SRS_INDEX_RELATIVE} was found under the workspaceRoot that was examined: ${examined}. Name a checkout that holds an SRS index, or omit workspaceRoot to read the root this server was started in.`;

  const refusal = (
    errorCode: "MCP_WORKSPACE_ROOT_UNSUPPORTED" | "MCP_WORKSPACE_ROOT_REFUSED",
    reason: WorkspaceRootReason,
    message: string,
    details: Record<string, unknown>,
    recoveryMessage?: string
  ): unknown => ({
    ok: false,
    error: { code: errorCode, reason, message },
    diagnostics: [
      {
        code: "SRS-E075",
        severity: "error",
        message,
        details: { ...details, reason, rootSource: startupIdentity.rootSource }
      }
    ],
    diagnosticsSummary: { errors: 1, warnings: 0, byCode: { "SRS-E075": 1 } },
    mcpWorkspace: startupIdentity,
    recovery: {
      message: recoveryMessage ?? (errorCode === "MCP_WORKSPACE_ROOT_UNSUPPORTED" ? UNSUPPORTED_RECOVERY : REFUSED_RECOVERY)
    }
  });

  const attachWorkspace = (value: unknown, identity: ReturnType<typeof identityFor>): unknown => {
    if (typeof value !== "object" || value === null || Array.isArray(value)) return value;
    if ("mcpWorkspace" in value) return value;
    return { ...(value as Record<string, unknown>), mcpWorkspace: identity };
  };

  /**
   * Everything that decides which root answers a call, run before the handler exists as a promise.
   * Returns the refusal payload, or the context the handler is to be called with.
   * @req REL-MCP-005 AC-3 / AC-5 / AC-6
   */
  const admit = async (
    input: Record<string, unknown>,
    metadata: McpToolMetadata | undefined
  ): Promise<{ refused: unknown } | { context: McpCallContext; identity: ReturnType<typeof identityFor> }> => {
    if (!("root" in input) && !("workspaceRoot" in input)) {
      return { context: startupContext, identity: startupIdentity };
    }
    // Membership of the closed scope set, not the presence of a value: a scope nobody declared and a
    // scope somebody misspelt must land on the same side. @req REL-MCP-005 AC-3
    if ("root" in input || !isWorkspaceScope(metadata?.workspaceScope)) {
      const override = "root" in input ? undefined : metadata?.workspaceRootRefusal;
      return {
        refused: refusal(
          "MCP_WORKSPACE_ROOT_UNSUPPORTED",
          override?.reason ?? "workspace-root-unsupported-for-tool",
          override?.message ?? UNSUPPORTED_MESSAGE,
          { root: input.root, workspaceRoot: input.workspaceRoot }
        )
      };
    }
    const decision = await decideWorkspaceRoot(input.workspaceRoot, startupRoot);
    if (!decision.ok) {
      return { refused: refusal("MCP_WORKSPACE_ROOT_REFUSED", decision.reason, decision.message, decision.details) };
    }
    // Scoped to the SRS query family, never gate-wide: a `workflow_*` tool answers today for a
    // checkout that holds no `docs/` at all, and a gate-wide check would refuse it. @req FR-MCP-064 AC-6
    if (metadata?.workspaceScope === "srs-read-only" && !(await hasSrsIndex(decision.root))) {
      return {
        refused: refusal(
          "MCP_WORKSPACE_ROOT_REFUSED",
          "workspace-root-missing-srs-index",
          `The named workspaceRoot holds no ${SRS_INDEX_RELATIVE}, so it has no SRS to read.`,
          { workspaceRoot: decision.root, indexPath: SRS_INDEX_RELATIVE },
          missingIndexRecovery(decision.root)
        )
      };
    }
    const destination = srsDestination(input, [decision.root, startupRoot], metadata?.callerPathKeys);
    if (destination !== null) {
      return {
        refused: refusal(
          "MCP_WORKSPACE_ROOT_REFUSED",
          "workspace-root-forbidden-for-srs",
          "A path argument under docs/spec is refused: SRS is written only at the startup root, through the SRS tools.",
          { workspaceRoot: decision.root, destination }
        )
      };
    }
    return {
      context: { root: decision.root, rootSource: "per-call-workspace-root" },
      identity: identityFor(decision.root, "per-call-workspace-root")
    };
  };

  const guard = (handler: McpToolHandler, metadata?: McpToolMetadata): McpToolHandler => async (input) => {
    if (deps.unbound) return unboundRefusal(deps.unbound);
    const admitted = await admit(input, metadata);
    if ("refused" in admitted) return admitted.refused;
    return attachWorkspace(await handler(input, admitted.context), admitted.identity);
  };

  return {
    tools,
    resourceTemplates,
    toolKinds,
    registerTool(name, handler, metadata) {
      tools[name] = guard(handler, metadata);
      if (metadata?.kind && VALID_KINDS.includes(metadata.kind)) {
        toolKinds[name] = metadata.kind;
      }
    },
    registerResource(template, handler) {
      resourceTemplates.push(template);
      tools[`resource:${template}`] = guard(handler);
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
