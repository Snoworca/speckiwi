import { createSpecKiwiCore } from "../../core/api.js";
import { listDocuments } from "../../core/documents.js";
import { addCommonOptions, addPaginationOptions, CliUsageError, executeCliCommand, optionalString, parseOptionalInteger, splitComma } from "../options.js";
export function registerListCommands(program) {
    const list = program.command("list").description("list documents and requirements");
    const docs = addPaginationOptions(addCommonOptions(list.command("docs").description("list registered documents")))
        .option("--type <type>", "document type")
        .option("--scope <scope>", "scope id")
        .option("--status <status>", "document status");
    docs.action(() => executeCliCommand(docs, async (context) => {
        const input = {
            root: context.root,
            cacheMode: context.cacheMode
        };
        const type = parseDocumentType(docs.opts().type);
        const scope = optionalString(docs.opts().scope);
        const status = splitComma(docs.opts().status);
        const limit = parseOptionalInteger(docs.opts().limit, "--limit");
        const offset = parseOptionalInteger(docs.opts().offset, "--offset");
        if (type !== undefined) {
            input.type = type;
        }
        if (scope !== undefined) {
            input.scope = scope;
        }
        if (status !== undefined) {
            input.status = status;
        }
        if (limit !== undefined) {
            input.limit = limit;
        }
        if (offset !== undefined) {
            input.offset = offset;
        }
        return listDocuments(input);
    }));
    const reqs = addPaginationOptions(addCommonOptions(list.command("reqs").description("list requirements")))
        .option("--scope <scope>", "scope id")
        .option("--type <type>", "requirement type")
        .option("--status <status>", "requirement status list")
        .option("--tag <tag>", "tag")
        .option("--project <project>", "project id or name");
    reqs.action(() => executeCliCommand(reqs, async (context) => {
        const core = createSpecKiwiCore({ root: context.root, cacheMode: context.cacheMode });
        const input = {
            root: context.root,
            cacheMode: context.cacheMode
        };
        const scope = splitComma(reqs.opts().scope);
        const type = splitComma(reqs.opts().type);
        const status = splitComma(reqs.opts().status);
        const tag = splitComma(reqs.opts().tag);
        const project = splitComma(reqs.opts().project);
        const limit = parseOptionalInteger(reqs.opts().limit, "--limit");
        const offset = parseOptionalInteger(reqs.opts().offset, "--offset");
        if (scope !== undefined) {
            input.scope = scope;
        }
        if (type !== undefined) {
            input.type = type;
        }
        if (status !== undefined) {
            input.status = status;
        }
        if (tag !== undefined) {
            input.tag = tag;
        }
        if (project !== undefined) {
            input.project = project;
        }
        if (limit !== undefined) {
            input.limit = limit;
        }
        if (offset !== undefined) {
            input.offset = offset;
        }
        return core.listRequirements(input);
    }));
}
function parseDocumentType(value) {
    const type = optionalString(value);
    if (type === undefined) {
        return undefined;
    }
    switch (type) {
        case "overview":
        case "prd":
        case "srs":
        case "technical":
        case "adr":
        case "rule":
        case "dictionary":
            return type;
        default:
            throw new CliUsageError("INVALID_ARGUMENT", `Invalid --type: ${type}`);
    }
}
//# sourceMappingURL=list.js.map