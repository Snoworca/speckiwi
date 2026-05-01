import type { Command } from "commander";
import type { GetRequirementInput } from "../../core/inputs.js";
import { getRequirement } from "../../core/requirements.js";
import { addCommonOptions, executeCliCommand } from "../options.js";
import { registerRequirementWriteCommands } from "./req-write.js";

export function registerRequirementCommands(program: Command): void {
  const req = program.command("req").description("requirement commands");

  const get = addCommonOptions(req.command("get").description("get a requirement by exact id").argument("<id>"))
    .option("--relations", "include incoming and outgoing relations")
    .option("--document", "include containing document summary");

  get.action((id: string) =>
    executeCliCommand(get, async (context) => {
      const input: GetRequirementInput = {
        root: context.root,
        cacheMode: context.cacheMode,
        id
      };
      if (get.opts().relations === true) {
        input.includeRelations = true;
      }
      if (get.opts().document === true) {
        input.includeDocument = true;
      }
      return getRequirement(input);
    })
  );

  registerRequirementWriteCommands(req);
}
