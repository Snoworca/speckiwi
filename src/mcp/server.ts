import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { access, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { initProject } from "../core/bootstrap/init-project.js";
import { resolveProjectRoot } from "../core/project-root.js";
import type { ProjectRoot } from "../core/types.js";
import { createTestMcpServer, type McpDependencies, type McpServerHandle } from "./adapter.js";
import { registerReadTools } from "./tools/read-tools.js";
import { registerMutationTools } from "./tools/mutation-tools.js";
import { registerResources } from "./resources.js";

export interface McpServerOptions {
  root?: string;
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
    force: z.boolean().optional()
  }
};

function isReadOnlyTool(name: string): boolean {
  return ["list_requirements", "get_requirement", "validate_spec", "summarize_target"].includes(name);
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function currentWorkingDirectoryRoot(): Promise<ProjectRoot> {
  const cwd = process.cwd();
  return { root: await realpath(cwd).catch(() => path.resolve(cwd)) };
}

async function explicitStartupRoot(explicitRoot: string): Promise<ProjectRoot> {
  const resolved = await realpath(explicitRoot).catch(() => undefined);
  if (!resolved) {
    throw new Error(`Could not resolve explicit MCP project root: ${explicitRoot}`);
  }
  const info = await stat(resolved);
  if (!info.isDirectory()) {
    throw new Error(`Explicit MCP project root is not a directory: ${explicitRoot}`);
  }
  return { root: resolved };
}

async function resolveMcpStartupRoot(explicitRoot?: string): Promise<ProjectRoot> {
  if (explicitRoot) return explicitStartupRoot(explicitRoot);
  try {
    return await resolveProjectRoot(process.cwd());
  } catch {
    return currentWorkingDirectoryRoot();
  }
}

async function ensureMcpStartupWorkspace(explicitRoot?: string): Promise<ProjectRoot> {
  const root = await resolveMcpStartupRoot(explicitRoot);
  const indexPath = path.join(root.root, "docs", "spec", "00.index.md");
  if (!(await exists(indexPath))) {
    const result = await initProject(root, {});
    if (!result.ok) {
      throw new Error(result.error?.message ?? "MCP workspace initialization failed");
    }
  }
  return root;
}

export async function startMcpServer(options: McpServerOptions = {}): Promise<void> {
  const sdk = new McpServer({ name: "speckiwi", version: "1.0.0" });
  const root = await ensureMcpStartupWorkspace(options.root);
  const local = createMcpServer({ root: root.root });
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
