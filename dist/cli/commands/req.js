import { createSpecKiwiCore } from "../../core/api.js";
import { addCommonOptions, executeCliCommand } from "../options.js";
import { registerRequirementWriteCommands } from "./req-write.js";
export function registerRequirementCommands(program) {
    const req = program.command("req").description("requirement commands");
    const get = addCommonOptions(req.command("get").description("get a requirement by exact id").argument("<id>"))
        .option("--relations", "include incoming and outgoing relations")
        .option("--document", "include containing document summary");
    get.action((id) => executeCliCommand(get, async (context) => {
        const core = createSpecKiwiCore({ root: context.root, cacheMode: context.cacheMode });
        const input = {
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
        return core.getRequirement(input);
    }));
    registerRequirementWriteCommands(req);
}
//# sourceMappingURL=req.js.map