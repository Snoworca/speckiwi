import { resolve } from "node:path";
import type { Command } from "commander";
import type { GraphInput } from "../../core/inputs.js";
import { buildGraph, type GraphType } from "../../graph/builder.js";
import { workspaceRootFromPath } from "../../io/workspace.js";
import { loadWorkspaceForValidation } from "../../validate/semantic.js";
import { addCommonOptions, CliUsageError, executeCliCommand, optionalString } from "../options.js";

export function registerGraphCommand(program: Command): void {
  const command = addCommonOptions(program.command("graph").description("print a workspace graph"))
    .option("--type <type>", "document, scope, requirement, dependency, or traceability");

  command.action(() =>
    executeCliCommand(command, async (context) => {
      const input: GraphInput = {
        root: context.root,
        cacheMode: context.cacheMode
      };
      const graphType = parseGraphType(optionalString(command.opts().type));
      if (graphType !== undefined) {
        input.graphType = graphType;
      }
      return graph(input);
    })
  );
}

async function graph(input: GraphInput) {
  const root = workspaceRootFromPath(resolve(input.root ?? process.cwd()));
  const workspace = await loadWorkspaceForValidation(root);
  return buildGraph(workspace, input.graphType);
}

function parseGraphType(value: string | undefined): GraphType | undefined {
  if (value === undefined) {
    return undefined;
  }

  switch (value) {
    case "document":
    case "scope":
    case "requirement":
    case "dependency":
    case "traceability":
      return value;
    case "documents":
      return "document";
    case "scopes":
      return "scope";
    case "requirements":
      return "requirement";
    case "dependencies":
      return "dependency";
    default:
      throw new CliUsageError("INVALID_ARGUMENT", `Invalid graph type: ${value}`);
  }
}
