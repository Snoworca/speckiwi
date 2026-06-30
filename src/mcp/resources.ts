import { resolveProjectRoot } from "../core/project-root.js";
import { parseWorkspace } from "../core/parser/workspace-parser.js";
import { validateWorkspace } from "../core/validator/validate-workspace.js";
import { getRequirement } from "../core/query/lookup.js";
import { summarizeTarget } from "../core/query/summary.js";
import { completedWorkReadModel } from "../core/query/completed-work.js";
import { summarizeDiagnostics } from "../core/diagnostic.js";
import type { Diagnostic, DiagnosticsSummary, ParsedWorkspace } from "../core/types.js";
import type { McpDependencies, McpServerHandle } from "./adapter.js";
import { mcpFailure } from "./errors.js";

const MCP_COMPLETED_WORK_RESOURCE_LIMIT = 20;

interface ResourceEnvelope<T> {
  ok: true;
  value: T;
  diagnostics: Diagnostic[];
  diagnosticsSummary: DiagnosticsSummary;
}

async function workspace(deps: McpDependencies): Promise<ParsedWorkspace> {
  return parseWorkspace(await resolveProjectRoot(process.cwd(), deps.root));
}

function readDiagnostics(workspace: ParsedWorkspace): Diagnostic[] {
  return [...workspace.diagnostics, ...validateWorkspace(workspace).diagnostics];
}

export function resourceEnvelope<T>(workspace: ParsedWorkspace, value: T, diagnostics: Diagnostic[] = readDiagnostics(workspace)): ResourceEnvelope<T> {
  return {
    ok: true,
    value,
    diagnostics,
    diagnosticsSummary: summarizeDiagnostics(diagnostics)
  };
}

export function registerResources(server: McpServerHandle, deps: McpDependencies): void {
  server.registerResource("speckiwi://index", async () => {
    const parsed = await workspace(deps);
    return resourceEnvelope(parsed, parsed.index);
  });
  server.registerResource("speckiwi://active-target", async () => {
    const parsed = await workspace(deps);
    const diagnostics = readDiagnostics(parsed);
    return resourceEnvelope(parsed, { activeTarget: parsed.index.activeTarget, summary: summarizeTarget(parsed, { diagnostics }) }, diagnostics);
  });
  server.registerResource("speckiwi://completed-work", async () => {
    const parsed = await workspace(deps);
    return resourceEnvelope(parsed, completedWorkReadModel(parsed, {}, { defaultLimit: MCP_COMPLETED_WORK_RESOURCE_LIMIT }));
  });
  server.registerResource("speckiwi://completed-work/{target}", async (input) => {
    const parsed = await workspace(deps);
    return resourceEnvelope(parsed, completedWorkReadModel(parsed, { target: String(input.target) }, { defaultLimit: MCP_COMPLETED_WORK_RESOURCE_LIMIT }));
  });
  server.registerResource("speckiwi://requirements/{id}", async (input) => {
    const parsed = await workspace(deps);
    const diagnostics = readDiagnostics(parsed);
    try {
      return resourceEnvelope(parsed, getRequirement(parsed, String(input.id), { includeMarkdown: true }), diagnostics);
    } catch (error) {
      return mcpFailure("NOT_FOUND", (error as Error).message, {
        diagnostics,
        recovery: { tool: "search_requirements", message: "Search for the requirement ID or title, then retry the requirement resource with the exact ID." }
      });
    }
  });
  server.registerResource("speckiwi://targets/{target}", async (input) => {
    const parsed = await workspace(deps);
    const diagnostics = readDiagnostics(parsed);
    return resourceEnvelope(parsed, summarizeTarget(parsed, { target: String(input.target), diagnostics }), diagnostics);
  });
  server.registerResource("speckiwi://scopes/{scope}", async (input) => {
    const parsed = await workspace(deps);
    return resourceEnvelope(parsed, parsed.records.filter((record) => record.scope === input.scope));
  });
}
