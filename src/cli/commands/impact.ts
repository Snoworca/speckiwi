import { resolve } from "node:path";
import type { Command } from "commander";
import type { ImpactInput } from "../../core/inputs.js";
import { fail } from "../../core/result.js";
import { buildGraph } from "../../graph/builder.js";
import { impactRequirement } from "../../graph/impact.js";
import { workspaceRootFromPath } from "../../io/workspace.js";
import { loadWorkspaceForValidation } from "../../validate/semantic.js";
import { addCommonOptions, executeCliCommand, parseOptionalInteger } from "../options.js";

export function registerImpactCommand(program: Command): void {
  const command = addCommonOptions(program.command("impact").description("calculate requirement impact").argument("<id>"))
    .option("--depth <n>", "maximum traversal depth")
    .option("--no-documents", "exclude document context")
    .option("--no-scopes", "exclude scope context")
    .option("--document", "unsupported v1 document impact target")
    .option("--scope", "unsupported v1 scope impact target");

  command.action((id: string) =>
    executeCliCommand(command, async (context) => {
      if (command.opts().document === true || command.opts().scope === true) {
        return fail({
          code: "IMPACT_TARGET_TYPE_NOT_SUPPORTED",
          message: "v1 impact supports requirement IDs only."
        });
      }

      const root = workspaceRootFromPath(resolve(context.root ?? process.cwd()));
      const workspace = await loadWorkspaceForValidation(root);
      const input: ImpactInput = {
          root: context.root,
          cacheMode: context.cacheMode,
          id,
          includeDocuments: command.opts().documents !== false,
          includeScopes: command.opts().scopes !== false
      };
      const depth = parseOptionalInteger(command.opts().depth, "--depth");
      if (depth !== undefined) {
        input.depth = depth;
      }
      return impactRequirement(input, buildGraph(workspace));
    })
  );
}
