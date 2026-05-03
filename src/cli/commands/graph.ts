import type { Command } from "commander";
import { createSpecKiwiCore } from "../../core/api.js";
import type { GraphInput } from "../../core/inputs.js";
import type { GraphType } from "../../graph/builder.js";
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
  return createSpecKiwiCore({
    root: input.root ?? process.cwd(),
    ...(input.cacheMode === undefined ? {} : { cacheMode: input.cacheMode })
  }).graph(input);
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
