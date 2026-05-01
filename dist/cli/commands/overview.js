import { overview } from "../../core/overview.js";
import { addCommonOptions, executeCliCommand } from "../options.js";
export function registerOverviewCommand(program) {
    const command = addCommonOptions(program.command("overview").description("print the overview document"));
    command.action(() => executeCliCommand(command, async (context) => overview({ root: context.root, cacheMode: context.cacheMode })));
}
//# sourceMappingURL=overview.js.map