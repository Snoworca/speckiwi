import type { Command } from "commander";
import type { EntityType } from "../../core/dto.js";
import type { SearchFilters, SearchInput } from "../../core/inputs.js";
import { searchWorkspace } from "../../core/search.js";
import { addCommonOptions, addPaginationOptions, CliUsageError, executeCliCommand, optionalString, parseOptionalInteger, splitComma } from "../options.js";

export function registerSearchCommand(program: Command): void {
  const command = addPaginationOptions(addCommonOptions(program.command("search").description("search workspace entities").argument("<query>")))
    .option("--mode <mode>", "auto, exact, or bm25")
    .option("--scope <scope>", "scope id")
    .option("--type <type>", "domain type")
    .option("--status <status>", "status list")
    .option("--tag <tag>", "tag")
    .option("--entity-type <entityType>", "entity type")
    .option("--document-id <documentId>", "document id");

  command.action((query: string) =>
    executeCliCommand(command, async (context) => {
      const filters: SearchFilters = {};
      const scope = splitComma(command.opts().scope);
      const type = splitComma(command.opts().type);
      const status = splitComma(command.opts().status);
      const tag = splitComma(command.opts().tag);
      const entityType = parseEntityTypes(command.opts().entityType);
      const documentId = splitComma(command.opts().documentId);
      if (scope !== undefined) {
        filters.scope = scope;
      }
      if (type !== undefined) {
        filters.type = type;
      }
      if (status !== undefined) {
        filters.status = status;
      }
      if (tag !== undefined) {
        filters.tag = tag;
      }
      if (entityType !== undefined) {
        filters.entityType = entityType;
      }
      if (documentId !== undefined) {
        filters.documentId = documentId;
      }
      const input: SearchInput = {
        root: context.root,
        cacheMode: context.cacheMode,
        query,
        filters
      };
      const mode = parseMode(command.opts().mode);
      const limit = parseOptionalInteger(command.opts().limit, "--limit");
      const offset = parseOptionalInteger(command.opts().offset, "--offset");
      if (mode !== undefined) {
        input.mode = mode;
      }
      if (limit !== undefined) {
        input.limit = limit;
      }
      if (offset !== undefined) {
        input.offset = offset;
      }
      return searchWorkspace(input);
    })
  );
}

function parseMode(value: unknown): "auto" | "exact" | "bm25" | undefined {
  const mode = optionalString(value);
  if (mode === undefined) {
    return undefined;
  }
  if (mode === "auto" || mode === "exact" || mode === "bm25") {
    return mode;
  }
  throw new CliUsageError("INVALID_ARGUMENT", `Invalid --mode: ${mode}`);
}

function parseEntityTypes(value: unknown): EntityType[] | undefined {
  const values = splitComma(value);
  if (values === undefined) {
    return undefined;
  }
  return values.map((item) => {
    switch (item) {
      case "document":
      case "scope":
      case "requirement":
      case "prd_item":
      case "technical_section":
      case "adr":
      case "rule":
        return item;
      default:
        throw new CliUsageError("INVALID_ARGUMENT", `Invalid --entity-type: ${item}`);
    }
  });
}
