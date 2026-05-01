import type { Command } from "commander";
import { overview } from "../../core/overview.js";
import { addCommonOptions, executeCliCommand } from "../options.js";

export function registerOverviewCommand(program: Command): void {
  const command = addCommonOptions(program.command("overview").description("print the overview document"));
  command.action(() =>
    executeCliCommand(command, async (context) => overview({ root: context.root, cacheMode: context.cacheMode }))
  );
}
