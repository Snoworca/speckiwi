import type { Command } from "commander";
import { resolveProjectRoot } from "../../core/project-root.js";
import { parseWorkspace } from "../../core/parser/workspace-parser.js";
import { validateWorkspace } from "../../core/validator/validate-workspace.js";
import { checkLinks } from "../../core/query/links.js";
import { getRequirement, listRequirements } from "../../core/query/lookup.js";
import { buildReadEnvelope, summarizeTarget } from "../../core/query/summary.js";
import { listCompletedWork, type CompletedWorkFilter } from "../../core/query/completed-work.js";
import { splitDiagnostics, summarizeDiagnostics } from "../../core/diagnostic.js";
import type { CliContext } from "../command.js";
import type { Diagnostic, ParsedWorkspace } from "../../core/types.js";
import { parseFilter } from "../options.js";
import { writeHuman, writeJson } from "../formatters.js";

async function workspaceFrom(options: { root?: string }) {
  return parseWorkspace(await resolveProjectRoot(process.cwd(), options.root));
}

function output(context: CliContext, options: { json?: boolean }, value: unknown): void {
  if (options.json) writeJson(context.io, value);
  else writeHuman(context.io, value);
}

function readDiagnostics(workspace: ParsedWorkspace): Diagnostic[] {
  return [...workspace.diagnostics, ...validateWorkspace(workspace).diagnostics];
}

function outputRead<T extends object>(context: CliContext, options: { json?: boolean }, workspace: ParsedWorkspace, value: T, diagnostics = readDiagnostics(workspace)): void {
  if (options.json) writeJson(context.io, buildReadEnvelope(workspace, value, diagnostics));
  else writeHuman(context.io, value);
}

function parseCompletedWorkFilter(raw: Record<string, unknown>, command: Command): CompletedWorkFilter {
  const filter: CompletedWorkFilter = {};
  if (typeof raw.target === "string") filter.target = raw.target;
  if (typeof raw.scope === "string") filter.scope = raw.scope;
  if (typeof raw.since === "string") {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(raw.since)) command.error("date must use YYYY-MM-DD", { exitCode: 2 });
    filter.since = raw.since;
  }
  if (typeof raw.limit === "string") {
    const parsed = Number(raw.limit);
    if (!Number.isInteger(parsed) || parsed <= 0) command.error("limit must be a positive integer", { exitCode: 2 });
    filter.limit = parsed;
  }
  if (typeof raw.order === "string") {
    if (raw.order !== "latest" && raw.order !== "file") command.error("order must be latest or file", { exitCode: 2 });
    filter.order = raw.order;
  }
  return filter;
}

export function registerReadCommands(command: Command, context: CliContext): void {
  command
    .command("validate")
    .option("--fail-on-warning", "fail when warnings exist")
    .option("--json", "JSON output")
    .action(async (options) => {
      const workspace = await workspaceFrom(command.opts());
      const diagnostics = readDiagnostics(workspace);
      const result = splitDiagnostics(diagnostics);
      output(context, { json: options.json || command.opts().json }, { ...result, summary: summarizeDiagnostics(diagnostics) });
      if (result.errors.length > 0 || (options.failOnWarning && result.warnings.length > 0)) command.setOptionValue("exitCode", 1);
    });

  command
    .command("extract")
    .option("--include-markdown", "include raw Markdown")
    .option("--json", "JSON output")
    .action(async (options) => {
      const workspace = await workspaceFrom(command.opts());
      outputRead(context, { json: options.json || command.opts().json }, workspace, { records: workspace.records.map((record) => (options.includeMarkdown ? record : { ...record, markdown: undefined })) });
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
      outputRead(context, { json: options.json || command.opts().json }, workspace, { records });
    });

  command
    .command("show")
    .argument("<id>")
    .option("--markdown", "include Markdown")
    .option("--json", "JSON output")
    .action(async (id, options) => {
      const workspace = await workspaceFrom(command.opts());
      outputRead(context, { json: options.json || command.opts().json }, workspace, getRequirement(workspace, id, { includeMarkdown: options.markdown }));
    });

  command.command("targets").option("--json").action(async (options) => {
    const workspace = await workspaceFrom(command.opts());
    const diagnostics = readDiagnostics(workspace);
    outputRead(
      context,
      { json: options.json || command.opts().json },
      workspace,
      { activeTarget: workspace.index.activeTarget, targets: workspace.index.targets.map((target) => ({ ...target, summary: summarizeTarget(workspace, { target: target.target, diagnostics }) })) },
      diagnostics
    );
  });

  command.command("active-target").option("--json").action(async (options) => {
    const workspace = await workspaceFrom(command.opts());
    const diagnostics = readDiagnostics(workspace);
    outputRead(context, { json: options.json || command.opts().json }, workspace, { activeTarget: workspace.index.activeTarget, summary: summarizeTarget(workspace, { diagnostics }) }, diagnostics);
  });

  const completedWork = command
    .command("completed-work")
    .option("--target <target>")
    .option("--scope <scope>")
    .option("--since <date>", "include rows on or after YYYY-MM-DD")
    .option("--limit <n>", "maximum number of rows")
    .option("--order <order>", "ordering: latest or file", "latest")
    .option("--json", "JSON output")
    .action(async (options) => {
      const workspace = await workspaceFrom(command.opts());
      outputRead(context, { json: options.json || command.opts().json }, workspace, { completedWork: listCompletedWork(workspace, parseCompletedWorkFilter(options, completedWork)) });
    });

  command.command("scopes").option("--json").action(async (options) => {
    const workspace = await workspaceFrom(command.opts());
    outputRead(context, { json: options.json || command.opts().json }, workspace, { scopes: workspace.index.scopes });
  });

  command.command("summary").option("--target <target>").option("--markdown").option("--json").action(async (options) => {
    const workspace = await workspaceFrom(command.opts());
    const diagnostics = readDiagnostics(workspace);
    outputRead(context, { json: options.json || command.opts().json }, workspace, summarizeTarget(workspace, { target: options.target, diagnostics }), diagnostics);
  });

  const links = command.command("links");
  links.command("check").option("--json").action(async (options) => {
    const workspace = await workspaceFrom(command.opts());
    outputRead(context, { json: options.json || command.opts().json }, workspace, await checkLinks(workspace));
  });
}
