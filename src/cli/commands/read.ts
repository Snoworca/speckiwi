import type { Command } from "commander";
import { resolveProjectRoot } from "../../core/project-root.js";
import { parseWorkspace } from "../../core/parser/workspace-parser.js";
import { validateWorkspace } from "../../core/validator/validate-workspace.js";
import { checkLinks } from "../../core/query/links.js";
import { getRequirement, listRequirements } from "../../core/query/lookup.js";
import { summarizeTarget } from "../../core/query/summary.js";
import type { CliContext } from "../command.js";
import { parseFilter } from "../options.js";
import { writeHuman, writeJson } from "../formatters.js";

async function workspaceFrom(options: { root?: string }) {
  return parseWorkspace(await resolveProjectRoot(process.cwd(), options.root));
}

function output(context: CliContext, options: { json?: boolean }, value: unknown): void {
  if (options.json) writeJson(context.io, value);
  else writeHuman(context.io, value);
}

export function registerReadCommands(command: Command, context: CliContext): void {
  command
    .command("validate")
    .option("--fail-on-warning", "fail when warnings exist")
    .option("--json", "JSON output")
    .action(async (options) => {
      const workspace = await workspaceFrom(command.opts());
      const result = validateWorkspace(workspace);
      output(context, { json: options.json || command.opts().json }, result);
      if (result.errors.length > 0 || (options.failOnWarning && result.warnings.length > 0)) command.setOptionValue("exitCode", 1);
    });

  command
    .command("extract")
    .option("--include-markdown", "include raw Markdown")
    .option("--json", "JSON output")
    .action(async (options) => {
      const workspace = await workspaceFrom(command.opts());
      output(context, { json: options.json || command.opts().json }, { records: workspace.records.map((record) => (options.includeMarkdown ? record : { ...record, markdown: undefined })) });
    });

  command
    .command("list")
    .option("--target <target>")
    .option("--status <status>")
    .option("--type <type>")
    .option("--scope <scope>")
    .option("--tag <tag>")
    .option("--format <format>")
    .option("--json", "JSON output")
    .action(async (options) => {
      const workspace = await workspaceFrom(command.opts());
      const records = listRequirements(workspace, parseFilter(options));
      output(context, { json: options.json || command.opts().json }, { records });
    });

  command
    .command("show")
    .argument("<id>")
    .option("--markdown", "include Markdown")
    .option("--json", "JSON output")
    .action(async (id, options) => {
      const workspace = await workspaceFrom(command.opts());
      output(context, { json: options.json || command.opts().json }, getRequirement(workspace, id, { includeMarkdown: options.markdown }));
    });

  command.command("targets").option("--json").action(async (options) => {
    output(context, { json: options.json || command.opts().json }, { targets: (await workspaceFrom(command.opts())).index.targets });
  });

  command.command("scopes").option("--json").action(async (options) => {
    output(context, { json: options.json || command.opts().json }, { scopes: (await workspaceFrom(command.opts())).index.scopes });
  });

  command.command("summary").option("--target <target>").option("--markdown").option("--json").action(async (options) => {
    const workspace = await workspaceFrom(command.opts());
    output(context, { json: options.json || command.opts().json }, summarizeTarget(workspace, options.target));
  });

  const links = command.command("links");
  links.command("check").option("--json").action(async (options) => {
    output(context, { json: options.json || command.opts().json }, await checkLinks(await workspaceFrom(command.opts())));
  });
}
