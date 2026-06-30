import type { Command } from "commander";
import { resolveProjectRoot } from "../../core/project-root.js";
import { parseWorkspace } from "../../core/parser/workspace-parser.js";
import { validateWorkspace } from "../../core/validator/validate-workspace.js";
import { checkLinks } from "../../core/query/links.js";
import { getRequirement, listRequirements } from "../../core/query/lookup.js";
import { normalizeDiscoveryFields, projectRequirementRecords, searchRequirementRecords, type RequirementDiscoveryOptions } from "../../core/query/discovery.js";
import { buildReadEnvelope, summarizeTarget } from "../../core/query/summary.js";
import { completedWorkReadModel, type CompletedWorkFilter } from "../../core/query/completed-work.js";
import { splitDiagnostics, summarizeDiagnostics } from "../../core/diagnostic.js";
import type { CliContext } from "../command.js";
import type { Diagnostic, DiagnosticsSummary, ParsedWorkspace } from "../../core/types.js";
import { planCompletedWorkMigration } from "../../core/completed-work/migration.js";
import { parseFilter } from "../options.js";
import { writeHuman, writeJson } from "../formatters.js";
import { readRecoveryForCommand, writeCliStructuredError } from "../errors.js";
import {
  workflowArtifacts,
  workflowDiff,
  workflowDoctor,
  workflowNextPlanTask,
  workflowPipelineCompact,
  workflowPipelineNext,
  workflowPipelineStatus,
  workflowPipelineTail,
  workflowPlanStatus,
  workflowPlanTask,
  workflowMigrationPreview,
  workflowResumeHint,
  workflowSchemaCheck,
  workflowSessionStatus,
  workflowWorklogTail,
  workflowWorkspaceInfo
} from "../../core/workflow/read.js";
import { buildNextWorkOrder } from "../../core/workflow/work-order.js";
import { applyWorkflowMutation, type WorkflowMutationInput, type WorkflowMutationKind } from "../../core/workflow/mutation.js";
import type { WorkflowArtifactKind } from "../../core/workflow/artifacts.js";

async function workspaceFrom(options: { root?: string }) {
  return parseWorkspace(await resolveProjectRoot(process.cwd(), options.root));
}

function output(context: CliContext, options: { json?: boolean }, value: unknown): void {
  if (options.json) writeJson(context.io, value);
  else writeHuman(context.io, value);
}

// @req REL-PARSE-002
function diagnosticLocation(diagnostic: Diagnostic): string {
  if (diagnostic.filePath && typeof diagnostic.line === "number") return `${diagnostic.filePath}:${diagnostic.line}`;
  if (diagnostic.filePath) return diagnostic.filePath;
  return "-";
}

// @req REL-PARSE-002
function plural(count: number, singular: string, pluralized: string): string {
  return `${count} ${count === 1 ? singular : pluralized}`;
}

// @req REL-PARSE-002
function formatValidateHuman(value: { diagnostics: Diagnostic[]; summary: DiagnosticsSummary }): string {
  const lines = [`Diagnostics: ${plural(value.summary.errors, "error", "errors")}, ${plural(value.summary.warnings, "warning", "warnings")}`];
  for (const item of value.diagnostics) {
    lines.push(`${item.severity} ${item.code} ${diagnosticLocation(item)} ${item.message}`);
  }
  return lines.join("\n");
}

function readDiagnostics(workspace: ParsedWorkspace): Diagnostic[] {
  return [...workspace.diagnostics, ...validateWorkspace(workspace).diagnostics];
}

function outputRead<T extends object>(context: CliContext, options: { json?: boolean }, workspace: ParsedWorkspace, value: T, diagnostics = readDiagnostics(workspace)): void {
  if (options.json) writeJson(context.io, buildReadEnvelope(workspace, value, diagnostics));
  else writeHuman(context.io, value);
}

function readFailure(context: CliContext, command: Command, options: { json?: boolean }, code: string, message: string, recoveryCommand: string, exitCode: number): void {
  if (options.json) {
    writeCliStructuredError(context.io, code, message, { recovery: readRecoveryForCommand(recoveryCommand) });
    command.setOptionValue("exitCode", exitCode);
    return;
  }
  command.error(message, { exitCode });
}

function targetExists(workspace: ParsedWorkspace, target: string): boolean {
  return workspace.index.targets.some((entry) => entry.target === target);
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
  if (typeof raw.offset === "string") {
    const parsed = Number(raw.offset);
    if (!Number.isInteger(parsed) || parsed < 0) command.error("offset must be a non-negative integer", { exitCode: 2 });
    filter.offset = parsed;
  }
  if (typeof raw.order === "string") {
    if (raw.order !== "latest" && raw.order !== "file") command.error("order must be latest or file", { exitCode: 2 });
    filter.order = raw.order;
  }
  return filter;
}

function parseNonNegativeInteger(value: unknown, label: string, command: Command): number | undefined {
  if (typeof value !== "string") return undefined;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) command.error(`${label} must be a non-negative integer`, { exitCode: 2 });
  return parsed;
}

function parsePositiveInteger(value: unknown, label: string, command: Command): number | undefined {
  if (typeof value !== "string") return undefined;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) command.error(`${label} must be a positive integer`, { exitCode: 2 });
  return parsed;
}

function parseDiscoveryOptions(raw: Record<string, unknown>, command: Command): RequirementDiscoveryOptions {
  const options: RequirementDiscoveryOptions = {};
  if (typeof raw.format === "string") {
    if (!["ids", "compact", "full"].includes(raw.format)) command.error("format must be ids, compact, or full", { exitCode: 2 });
    options.projection = raw.format;
  }
  if (typeof raw.fields === "string") {
    try {
      const fields = normalizeDiscoveryFields(raw.fields);
      if (fields !== undefined) options.fields = fields;
    } catch (error) {
      command.error((error as Error).message, { exitCode: 2 });
    }
  }
  if (raw.includeMarkdown === true) options.includeMarkdown = true;
  const limit = parsePositiveInteger(raw.limit, "limit", command);
  if (limit !== undefined) options.limit = limit;
  const offset = parseNonNegativeInteger(raw.offset, "offset", command);
  if (offset !== undefined) options.offset = offset;
  return options;
}

function parseWorkflowReadOptions(raw: Record<string, unknown>, command: Command) {
  const options: {
    path?: string;
    runId?: string;
    target?: string;
    kind?: WorkflowArtifactKind;
    includeBody?: boolean;
    includeDeleted?: boolean;
    limit?: number;
    offset?: number;
    allowAmbiguous?: boolean;
  } = {};
  if (typeof raw.path === "string") options.path = raw.path;
  if (typeof raw.runId === "string") options.runId = raw.runId;
  if (typeof raw.target === "string") options.target = raw.target;
  if (typeof raw.kind === "string") options.kind = raw.kind as WorkflowArtifactKind;
  if (raw.includeBody === true) options.includeBody = true;
  if (raw.includeDeleted === true) options.includeDeleted = true;
  if (raw.allowAmbiguous === true) options.allowAmbiguous = true;
  const limit = parsePositiveInteger(raw.limit, "limit", command);
  if (limit !== undefined) options.limit = limit;
  const offset = parseNonNegativeInteger(raw.offset, "offset", command);
  if (offset !== undefined) options.offset = offset;
  return options;
}

function parseWorkOrderOptions(raw: Record<string, unknown>, command: Command) {
  const options = parseWorkflowReadOptions(raw, command) as ReturnType<typeof parseWorkflowReadOptions> & {
    measure?: boolean;
    pipelinePath?: string;
    explain?: boolean;
    profile?: "default" | "compact" | "explain";
    contextProfile?: "default" | "compact";
  };
  if (raw.measure === true) options.measure = true;
  if (typeof raw.pipelinePath === "string") options.pipelinePath = raw.pipelinePath;
  if (raw.explain === true) options.explain = true;
  if (typeof raw.profile === "string") {
    if (!["default", "compact", "explain"].includes(raw.profile)) command.error("profile must be default, compact, or explain", { exitCode: 2 });
    options.profile = raw.profile as "default" | "compact" | "explain";
  }
  if (typeof raw.contextProfile === "string") {
    if (!["default", "compact"].includes(raw.contextProfile)) command.error("context-profile must be default or compact", { exitCode: 2 });
    options.contextProfile = raw.contextProfile as "default" | "compact";
  }
  return options;
}

function requireStringOption(raw: Record<string, unknown>, key: string, command: Command): string {
  const value = raw[key];
  if (typeof value === "string" && value.length > 0) return value;
  command.error(`${key} is required`, { exitCode: 2 });
}

function parseJsonObjectOption(value: unknown, label: string, command: Command): Record<string, unknown> {
  if (typeof value !== "string") command.error(`${label} is required`, { exitCode: 2 });
  try {
    const parsed = JSON.parse(value) as unknown;
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
  } catch (error) {
    command.error(`${label} must be valid JSON: ${(error as Error).message}`, { exitCode: 2 });
  }
  command.error(`${label} must be a JSON object`, { exitCode: 2 });
}

function workflowMutationBase(kind: WorkflowMutationKind, raw: Record<string, unknown>, command: Command): WorkflowMutationInput {
  return {
    kind,
    owner: typeof raw.owner === "string" ? raw.owner : "kiwi-pm",
    runId: requireStringOption(raw, "runId", command),
    ...(typeof raw.taskId === "string" ? { taskId: raw.taskId } : {}),
    ...(typeof raw.reqId === "string" ? { reqId: raw.reqId } : {}),
    ...(typeof raw.reason === "string" ? { reason: raw.reason } : {}),
    ...(typeof raw.expectedSha256 === "string" ? { expectedSha256: raw.expectedSha256 } : {}),
    ...(typeof raw.idempotencyKey === "string" ? { idempotencyKey: raw.idempotencyKey } : {}),
    ...(raw.dryRun === true ? { dryRun: true } : {})
  };
}

function unsupportedWorkflowMigrationOperation(raw: Record<string, unknown>) {
  const flag = ["apply", "write", "fix", "normalize", "migrate"].find((name) => raw[name] === true);
  if (!flag) return null;
  const message = `workflow migrate-preview is read-only; --${flag} is unsupported`;
  const diagnostic: Diagnostic = { code: "UNSUPPORTED_OPERATION", severity: "error", message, details: { flag, operation: "workflow migrate-preview" } };
  return {
    ok: false,
    written: false,
    error: { code: "UNSUPPORTED_OPERATION", message },
    diagnostics: [diagnostic],
    diagnosticsSummary: summarizeDiagnostics([diagnostic])
  };
}

function addRequirementFilterOptions(target: Command): Command {
  return target
    .option("--target <target>")
    .option("--status <status>")
    .option("--type <type>")
    .option("--scope <scope>")
    .option("--tag <tag>")
    .option("--stability <stability>")
    .option("--priority <priority>")
    .option("--missing-evidence [state]", "filter by missing verification evidence")
    .option("--related-doc <reference>")
    .option("--evidence-reference <reference>")
    .option("--trace-reference <reference>")
    .option("--new-work-candidate [state]", "filter by new-work-candidate state");
}

function addDiscoveryOptions(target: Command): Command {
  return target.option("--format <format>", "ids, compact, or full").option("--fields <fields>", "comma-separated RequirementRecord fields").option("--include-markdown").option("--limit <n>").option("--offset <n>");
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
      const diagnosticsSummary = summarizeDiagnostics(diagnostics);
      const value = { ...result, summary: diagnosticsSummary, diagnosticsSummary };
      if (options.json || command.opts().json) output(context, { json: true }, value);
      else output(context, { json: false }, formatValidateHuman(value));
      if (result.errors.length > 0 || (options.failOnWarning && result.warnings.length > 0)) command.setOptionValue("exitCode", 1);
    });

  command
    .command("extract")
    .option("--include-markdown", "include raw Markdown")
    .option("--format <format>", "ids, compact, or full")
    .option("--fields <fields>", "comma-separated RequirementRecord fields")
    .option("--limit <n>")
    .option("--offset <n>")
    .option("--json", "JSON output")
    .action(async (options) => {
      const workspace = await workspaceFrom(command.opts());
      outputRead(context, { json: options.json || command.opts().json }, workspace, projectRequirementRecords(workspace.records, parseDiscoveryOptions(options, command)));
    });

  const listCommand = addDiscoveryOptions(addRequirementFilterOptions(command.command("list")))
    .option("--json", "JSON output")
    .action(async (options) => {
      const workspace = await workspaceFrom(command.opts());
      const records = listRequirements(workspace, parseFilter(options));
      outputRead(context, { json: options.json || command.opts().json }, workspace, projectRequirementRecords(records, parseDiscoveryOptions(options, listCommand)));
    });

  const searchCommand = addDiscoveryOptions(addRequirementFilterOptions(command.command("search").argument("<query>")))
    .option("--json", "JSON output")
    .action(async (query, options) => {
      const workspace = await workspaceFrom(command.opts());
      outputRead(
        context,
        { json: options.json || command.opts().json },
        workspace,
        searchRequirementRecords(workspace.records, {
          query,
          filter: parseFilter(options),
          ...parseDiscoveryOptions(options, searchCommand)
        })
      );
    });

  command
    .command("show")
    .argument("<id>")
    .option("--markdown", "include Markdown")
    .option("--json", "JSON output")
    .action(async (id, options) => {
      const workspace = await workspaceFrom(command.opts());
      const json = options.json || command.opts().json;
      try {
        outputRead(context, { json }, workspace, getRequirement(workspace, id, { includeMarkdown: options.markdown }));
      } catch (error) {
        readFailure(context, command, { json }, "NOT_FOUND", (error as Error).message, "show", 5);
      }
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
    .option("--offset <n>", "number of rows to skip")
    .option("--order <order>", "ordering: latest or file", "latest")
    .option("--json", "JSON output")
    .action(async (options) => {
      const workspace = await workspaceFrom(command.opts());
      outputRead(context, { json: options.json || command.opts().json }, workspace, completedWorkReadModel(workspace, parseCompletedWorkFilter(options, completedWork)));
    });

  command.command("completed-work-migration-plan").option("--json", "JSON output").action(async (options) => {
    const workspace = await workspaceFrom(command.opts());
    outputRead(context, { json: options.json || command.opts().json }, workspace, { completedWorkMigration: planCompletedWorkMigration(workspace, { dryRun: true }) });
  });

  const workflow = command.command("workflow");
  const addWorkflowOptions = (target: Command): Command =>
    target
      .option("--path <path>")
      .option("--run-id <runId>")
      .option("--target <target>")
      .option("--kind <kind>")
      .option("--include-body")
      .option("--include-deleted")
      .option("--allow-ambiguous")
      .option("--limit <n>")
      .option("--offset <n>")
      .option("--json", "JSON output");
  const workflowRoot = () => resolveProjectRoot(process.cwd(), command.opts().root);
  const workflowOutput = (options: Record<string, unknown>, value: unknown): void => {
    output(context, { json: Boolean(options.json) || command.opts().json }, value);
  };

  workflow.command("workspace").option("--json", "JSON output").action(async (options) => {
    workflowOutput(options, await workflowWorkspaceInfo(await workflowRoot()));
  });
  addWorkflowOptions(workflow.command("artifacts")).action(async (options) => {
    workflowOutput(options, await workflowArtifacts(await workflowRoot(), parseWorkflowReadOptions(options, workflow)));
  });
  addWorkflowOptions(workflow.command("latest")).action(async (options) => {
    workflowOutput(options, await workflowArtifacts(await workflowRoot(), { ...parseWorkflowReadOptions(options, workflow), limit: 1 }));
  });
  addWorkflowOptions(workflow.command("resolve")).action(async (options) => {
    workflowOutput(options, await workflowArtifacts(await workflowRoot(), { ...parseWorkflowReadOptions(options, workflow), limit: 1 }));
  });
  addWorkflowOptions(workflow.command("plan-status")).action(async (options) => {
    workflowOutput(options, await workflowPlanStatus(await workflowRoot(), parseWorkflowReadOptions(options, workflow)));
  });
  addWorkflowOptions(workflow.command("plan-task").argument("<taskId>")).action(async (taskId, options) => {
    workflowOutput(options, await workflowPlanTask(await workflowRoot(), taskId, parseWorkflowReadOptions(options, workflow)));
  });
  addWorkflowOptions(workflow.command("next-task")).action(async (options) => {
    workflowOutput(options, await workflowNextPlanTask(await workflowRoot(), parseWorkflowReadOptions(options, workflow)));
  });
  addWorkflowOptions(workflow.command("doctor")).action(async (options) => {
    workflowOutput(options, await workflowDoctor(await workflowRoot(), parseWorkflowReadOptions(options, workflow)));
  });
  addWorkflowOptions(workflow.command("diff")).action(async (options) => {
    workflowOutput(options, await workflowDiff(await workflowRoot(), parseWorkflowReadOptions(options, workflow)));
  });
  addWorkflowOptions(workflow.command("schema-check")).action(async (options) => {
    workflowOutput(options, await workflowSchemaCheck(await workflowRoot(), parseWorkflowReadOptions(options, workflow)));
  });
  addWorkflowOptions(workflow.command("pipeline-status")).action(async (options) => {
    workflowOutput(options, await workflowPipelineStatus(await workflowRoot(), parseWorkflowReadOptions(options, workflow)));
  });
  addWorkflowOptions(workflow.command("pipeline-tail")).action(async (options) => {
    workflowOutput(options, await workflowPipelineTail(await workflowRoot(), parseWorkflowReadOptions(options, workflow)));
  });
  addWorkflowOptions(workflow.command("pipeline-next")).action(async (options) => {
    workflowOutput(options, await workflowPipelineNext(await workflowRoot(), parseWorkflowReadOptions(options, workflow)));
  });
  addWorkflowOptions(workflow.command("pipeline-compact")).action(async (options) => {
    workflowOutput(options, await workflowPipelineCompact(await workflowRoot(), parseWorkflowReadOptions(options, workflow)));
  });
  const pipeline = workflow.command("pipeline");
  addWorkflowOptions(pipeline.command("status")).action(async (options) => {
    workflowOutput(options, await workflowPipelineStatus(await workflowRoot(), parseWorkflowReadOptions(options, pipeline)));
  });
  addWorkflowOptions(pipeline.command("tail")).action(async (options) => {
    workflowOutput(options, await workflowPipelineTail(await workflowRoot(), parseWorkflowReadOptions(options, pipeline)));
  });
  addWorkflowOptions(pipeline.command("compact")).action(async (options) => {
    workflowOutput(options, await workflowPipelineCompact(await workflowRoot(), parseWorkflowReadOptions(options, pipeline)));
  });
  addWorkflowOptions(workflow.command("session-status")).action(async (options) => {
    workflowOutput(options, await workflowSessionStatus(await workflowRoot(), parseWorkflowReadOptions(options, workflow)));
  });
  addWorkflowOptions(workflow.command("resume-hint")).action(async (options) => {
    workflowOutput(options, await workflowResumeHint(await workflowRoot(), parseWorkflowReadOptions(options, workflow)));
  });
  addWorkflowOptions(workflow.command("worklog-tail")).action(async (options) => {
    workflowOutput(options, await workflowWorklogTail(await workflowRoot(), parseWorkflowReadOptions(options, workflow)));
  });

  const addWorkflowMutationOptions = (target: Command): Command =>
    addWorkflowOptions(target)
      .option("--owner <owner>", "workflow mutation owner", "kiwi-pm")
      .option("--req-id <reqId>")
      .option("--reason <text>")
      .option("--expected-sha256 <sha>")
      .option("--idempotency-key <key>")
      .option("--dry-run");
  const workflowMutationOutput = async (options: Record<string, unknown>, input: WorkflowMutationInput): Promise<void> => {
    const result = await applyWorkflowMutation(await workflowRoot(), input);
    workflowOutput(options, result);
    if (!result.ok) command.setOptionValue("exitCode", 5);
  };

  addWorkflowMutationOptions(workflow.command("task-check").argument("<taskId>")).action(async (taskId, options) => {
    await workflowMutationOutput(options, {
      ...workflowMutationBase("plan_checkbox_check", { ...options, taskId }, workflow),
      planPath: requireStringOption(options, "path", workflow)
    });
  });
  addWorkflowMutationOptions(workflow.command("task-uncheck").argument("<taskId>")).action(async (taskId, options) => {
    await workflowMutationOutput(options, {
      ...workflowMutationBase("plan_checkbox_uncheck", { ...options, taskId }, workflow),
      planPath: requireStringOption(options, "path", workflow)
    });
  });
  addWorkflowMutationOptions(workflow.command("checklist-set").argument("<taskId>").requiredOption("--checked <checked>", "true or false")).action(async (taskId, options) => {
    await workflowMutationOutput(options, {
      ...workflowMutationBase("plan_checklist_item_update", { ...options, taskId }, workflow),
      planPath: requireStringOption(options, "path", workflow),
      checked: String(options.checked).toLowerCase() === "true"
    });
  });
  addWorkflowMutationOptions(workflow.command("task-status-set").argument("<taskId>").argument("<status>").requiredOption("--pm-state-path <path>")).action(async (taskId, status, options) => {
    await workflowMutationOutput(options, {
      ...workflowMutationBase("pm_task_status_update", { ...options, taskId }, workflow),
      pmStatePath: String(options.pmStatePath),
      status: String(status)
    });
  });
  addWorkflowMutationOptions(workflow.command("pipeline-emit").requiredOption("--event <json>", "JSON event object")).action(async (options) => {
    await workflowMutationOutput(options, {
      ...workflowMutationBase("pipeline_event_append", options, workflow),
      jsonlPath: typeof options.path === "string" ? options.path : "kiwi/pipeline.jsonl",
      event: parseJsonObjectOption(options.event, "event", workflow)
    });
  });
  addWorkflowMutationOptions(workflow.command("worklog-emit").requiredOption("--event <json>", "JSON event object")).action(async (options) => {
    const runId = requireStringOption(options, "runId", workflow);
    await workflowMutationOutput(options, {
      ...workflowMutationBase("worklog_event_append", options, workflow),
      jsonlPath: typeof options.path === "string" ? options.path : `.kiwi/sessions/${runId}/worklog.jsonl`,
      event: parseJsonObjectOption(options.event, "event", workflow)
    });
  });
  addWorkflowMutationOptions(workflow.command("repair-record").requiredOption("--event <json>", "JSON repair event object")).action(async (options) => {
    const runId = requireStringOption(options, "runId", workflow);
    await workflowMutationOutput(options, {
      ...workflowMutationBase("workflow_repair_record", options, workflow),
      jsonlPath: typeof options.path === "string" ? options.path : `.kiwi/sessions/${runId}/worklog.jsonl`,
      event: parseJsonObjectOption(options.event, "event", workflow)
    });
  });
  addWorkflowMutationOptions(workflow.command("logical-delete").requiredOption("--record-type <type>").requiredOption("--record-id <id>")).action(async (options) => {
    requireStringOption(options, "reason", workflow);
    await workflowMutationOutput(options, {
      ...workflowMutationBase("workflow_logical_delete", options, workflow),
      jsonlPath: typeof options.path === "string" ? options.path : "kiwi/pipeline.jsonl",
      recordType: String(options.recordType),
      recordId: String(options.recordId)
    });
  });
  addWorkflowOptions(workflow.command("migrate-preview"))
    .option("--dry-run", "accepted for parity; preview never writes")
    .option("--apply", "unsupported: migration apply is out of scope")
    .option("--write", "unsupported: migration preview is read-only")
    .option("--fix", "unsupported: migration preview is read-only")
    .option("--normalize", "unsupported: migration preview is read-only")
    .option("--migrate", "unsupported: migration apply is out of scope")
    .action(async (options) => {
      const unsupported = unsupportedWorkflowMigrationOperation(options);
      if (unsupported) {
        workflowOutput(options, unsupported);
        command.setOptionValue("exitCode", 5);
        return;
      }
      workflowOutput(options, await workflowMigrationPreview(await workflowRoot(), parseWorkflowReadOptions(options, workflow)));
    });
  const workOrder = workflow.command("work-order");
  addWorkflowOptions(workOrder.command("next"))
    .option("--measure", "include payload measurement fields")
    .option("--pipeline-path <path>", "explicit pipeline JSONL artifact path")
    .option("--explain", "include decision trace, rejected candidates, and blockers")
    .option("--profile <profile>", "output profile: default, compact, or explain")
    .option("--context-profile <profile>", "context profile: default or compact")
    .action(async (options) => {
      workflowOutput(options, await buildNextWorkOrder(await workflowRoot(), parseWorkOrderOptions(options, workOrder)));
    });

  command.command("scopes").option("--json").action(async (options) => {
    const workspace = await workspaceFrom(command.opts());
    outputRead(context, { json: options.json || command.opts().json }, workspace, { scopes: workspace.index.scopes });
  });

  command.command("summary").option("--target <target>").option("--markdown").option("--json").action(async (options) => {
    const workspace = await workspaceFrom(command.opts());
    const diagnostics = readDiagnostics(workspace);
    const json = options.json || command.opts().json;
    if (typeof options.target === "string" && !targetExists(workspace, options.target)) {
      readFailure(context, command, { json }, "TARGET_NOT_FOUND", `Target is not registered: ${options.target}`, "summary", 5);
      return;
    }
    outputRead(context, { json: options.json || command.opts().json }, workspace, summarizeTarget(workspace, { target: options.target, diagnostics }), diagnostics);
  });

  const links = command.command("links");
  links.command("check").option("--json").action(async (options) => {
    const workspace = await workspaceFrom(command.opts());
    outputRead(context, { json: options.json || command.opts().json }, workspace, await checkLinks(workspace));
  });
}
