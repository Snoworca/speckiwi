import { resolveProjectRoot } from "../../core/project-root.js";
import { parseWorkspace } from "../../core/parser/workspace-parser.js";
import { validateWorkspace } from "../../core/validator/validate-workspace.js";
import { getRequirement, listRequirements } from "../../core/query/lookup.js";
import { summarizeTarget } from "../../core/query/summary.js";
import type { McpDependencies, McpServerHandle } from "../adapter.js";

async function workspace(deps: McpDependencies) {
  const root = await resolveProjectRoot(process.cwd(), deps.root);
  return parseWorkspace(root);
}

export function registerReadTools(server: McpServerHandle, deps: McpDependencies): void {
  server.registerTool("list_requirements", async (input) => ({ ok: true, value: { records: listRequirements(await workspace(deps), input) } }), { readOnlyHint: true });
  server.registerTool("get_requirement", async (input) => {
    try {
      return { ok: true, value: getRequirement(await workspace(deps), String(input.id), { includeMarkdown: Boolean(input.includeMarkdown) }) };
    } catch (error) {
      return { ok: false, error: { code: "NOT_FOUND", message: (error as Error).message } };
    }
  }, { readOnlyHint: true });
  server.registerTool("validate_spec", async () => ({ ok: true, value: validateWorkspace(await workspace(deps)) }), { readOnlyHint: true });
  server.registerTool("summarize_target", async (input) => ({ ok: true, value: summarizeTarget(await workspace(deps), typeof input.target === "string" ? input.target : undefined) }), { readOnlyHint: true });
}
