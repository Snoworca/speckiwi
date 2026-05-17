import { resolveProjectRoot } from "../../core/project-root.js";
import { parseWorkspace } from "../../core/parser/workspace-parser.js";
import { validateWorkspace } from "../../core/validator/validate-workspace.js";
import { getRequirement, listRequirements } from "../../core/query/lookup.js";
import { buildReadEnvelope, summarizeTarget } from "../../core/query/summary.js";
import { listCompletedWork } from "../../core/query/completed-work.js";
import { splitDiagnostics, summarizeDiagnostics } from "../../core/diagnostic.js";
import type { Diagnostic, ParsedWorkspace } from "../../core/types.js";
import type { McpDependencies, McpServerHandle } from "../adapter.js";

async function workspace(deps: McpDependencies) {
  const root = await resolveProjectRoot(process.cwd(), deps.root);
  return parseWorkspace(root);
}

function readDiagnostics(workspace: ParsedWorkspace): Diagnostic[] {
  return [...workspace.diagnostics, ...validateWorkspace(workspace).diagnostics];
}

export function registerReadTools(server: McpServerHandle, deps: McpDependencies): void {
  server.registerTool("list_requirements", async (input) => {
    const parsed = await workspace(deps);
    const diagnostics = readDiagnostics(parsed);
    return { ok: true, value: buildReadEnvelope(parsed, { records: listRequirements(parsed, input) }, diagnostics) };
  }, { readOnlyHint: true });
  server.registerTool("get_requirement", async (input) => {
    const parsed = await workspace(deps);
    const diagnostics = readDiagnostics(parsed);
    try {
      return { ok: true, value: buildReadEnvelope(parsed, getRequirement(parsed, String(input.id), { includeMarkdown: Boolean(input.includeMarkdown) }), diagnostics) };
    } catch (error) {
      return { ok: false, error: { code: "NOT_FOUND", message: (error as Error).message } };
    }
  }, { readOnlyHint: true });
  server.registerTool("validate_spec", async () => {
    const parsed = await workspace(deps);
    const diagnostics = readDiagnostics(parsed);
    const result = splitDiagnostics(diagnostics);
    return { ok: true, value: { ...result, summary: summarizeDiagnostics(diagnostics) } };
  }, { readOnlyHint: true });
  server.registerTool("summarize_target", async (input) => {
    const parsed = await workspace(deps);
    const diagnostics = readDiagnostics(parsed);
    const target = typeof input.target === "string" ? input.target : undefined;
    const summary = typeof target === "string" ? summarizeTarget(parsed, { target, diagnostics }) : summarizeTarget(parsed, { diagnostics });
    return { ok: true, value: buildReadEnvelope(parsed, summary, diagnostics) };
  }, { readOnlyHint: true });
  server.registerTool("get_active_target", async () => {
    const parsed = await workspace(deps);
    const diagnostics = readDiagnostics(parsed);
    const activeTarget = parsed.index.activeTarget;
    const summary = summarizeTarget(parsed, { diagnostics });
    const goal = activeTarget && parsed.index.targetGoals[activeTarget] ? parsed.index.targetGoals[activeTarget] : null;
    return { ok: true, value: buildReadEnvelope(parsed, { activeTarget, summary, goal }, diagnostics) };
  }, { readOnlyHint: true });
  server.registerTool("list_completed_work", async (input) => {
    const parsed = await workspace(deps);
    const diagnostics = readDiagnostics(parsed);
    return { ok: true, value: buildReadEnvelope(parsed, { completedWork: listCompletedWork(parsed, input) }, diagnostics) };
  }, { readOnlyHint: true });
}
