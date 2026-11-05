import type { Command } from "commander";
import { resolveProjectRoot } from "../../core/project-root.js";
import { syncAppendix, type ToolSummaryEntry } from "../../core/mutation/sync-appendix.js";
import { renderToolDescriptions, renderToolNames } from "../../mcp/schemas.js";
import { isReadOnlyTool } from "../../mcp/server.js";
import type { CliContext } from "../command.js";
import { writeHuman, writeJson } from "../formatters.js";
import { SAFETY_BYPASS_OPTION_HELP } from "../safety-bypass-options.js";

/** The tools the MCP server registers, as the ToolSpec registry names, describes and classifies them. */
function registeredTools(): ToolSummaryEntry[] {
  const descriptions = renderToolDescriptions();
  return renderToolNames().map((name) => ({ name, description: descriptions[name] ?? "", readOnly: isReadOnlyTool(name) }));
}

/**
 * `speckiwi sync-appendix` — checks the appendix Tool Summary table against the registry (exit 1 on
 * any difference), or rewrites its rows with `--write`. @req FR-NODE-253 AC-1
 */
export function registerSyncAppendixCommand(command: Command, context: CliContext): void {
  command
    .command("sync-appendix")
    .description("check the docs/spec/90.appendix.md Tool Summary table against the MCP tool registry, or rewrite its rows with --write")
    .option("--write", "rewrite the table's rows from the registry")
    .option("--dry-run", "report the patch without writing")
    .option("--ignore-lock", SAFETY_BYPASS_OPTION_HELP.mutationLock)
    .option("--json")
    .action(async (options) => {
      const result = await syncAppendix(await resolveProjectRoot(process.cwd(), command.opts().root), {
        tools: registeredTools(),
        ...(options.write ? { write: true } : {}),
        ...(options.dryRun ? { dryRun: true } : {}),
        ...(options.ignoreLock ? { ignoreLock: true } : {})
      });
      if (options.json || command.opts().json) writeJson(context.io, result);
      else writeHuman(context.io, result);
      if (!result.ok) command.setOptionValue("exitCode", 5);
      else if (!options.write && result.value?.changed) command.setOptionValue("exitCode", 1);
    });
}
