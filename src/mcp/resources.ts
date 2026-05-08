import { resolveProjectRoot } from "../core/project-root.js";
import { parseWorkspace } from "../core/parser/workspace-parser.js";
import { getRequirement } from "../core/query/lookup.js";
import { summarizeTarget } from "../core/query/summary.js";
import type { McpDependencies, McpServerHandle } from "./adapter.js";

export function registerResources(server: McpServerHandle, deps: McpDependencies): void {
  server.registerResource("speckiwi://index", async () => {
    const workspace = await parseWorkspace(await resolveProjectRoot(process.cwd(), deps.root));
    return { ok: true, value: workspace.index };
  });
  server.registerResource("speckiwi://requirements/{id}", async (input) => {
    const workspace = await parseWorkspace(await resolveProjectRoot(process.cwd(), deps.root));
    return { ok: true, value: getRequirement(workspace, String(input.id), { includeMarkdown: true }) };
  });
  server.registerResource("speckiwi://targets/{target}", async (input) => {
    const workspace = await parseWorkspace(await resolveProjectRoot(process.cwd(), deps.root));
    return { ok: true, value: summarizeTarget(workspace, String(input.target)) };
  });
  server.registerResource("speckiwi://scopes/{scope}", async (input) => {
    const workspace = await parseWorkspace(await resolveProjectRoot(process.cwd(), deps.root));
    return { ok: true, value: workspace.records.filter((record) => record.scope === input.scope) };
  });
}
