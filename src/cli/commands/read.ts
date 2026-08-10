import type { Command } from "commander";
import { resolveProjectRoot } from "../../core/project-root.js";
import { parseWorkspace } from "../../core/parser/workspace-parser.js";
import { getWorkMode, setWorkMode } from "../../core/mutation/work-mode.js";
import { claimStep } from "../../core/mutation/claim-step.js";
import { updateStepState } from "../../core/mutation/update-step-state.js";
import { scaffoldStep } from "../../core/mutation/scaffold-step.js";
import { setSdsStatus } from "../../core/mutation/set-sds-status.js";
import { promoteStepRequirement } from "../../core/mutation/add-requirement.js";
import { synthesizeStepSrs } from "../../core/mutation/synthesis.js";
import { getDiagnosticDefinition } from "../../core/diagnostic-registry.js";
import { mutationFail, mutationOk } from "../../core/mutation/guards.js";
import { PRIORITY_LEVELS, RISK_LEVELS } from "../../core/types.js";
import { renderReadOnlyToolNames, toolSpecs, type ToolSpec } from "../../mcp/schemas.js";
import { validateWorkspace } from "../../core/validator/validate-workspace.js";
import { checkLinks } from "../../core/query/links.js";
import { getRequirement, listRequirements } from "../../core/query/lookup.js";
import { matchesRequirementFilter } from "../../core/query/filter.js";
import { normalizeDiscoveryFields, projectRequirementRecords, searchRequirementRecords, type RequirementDiscoveryOptions } from "../../core/query/discovery.js";
import { buildReadEnvelope, resolveTargetSelection, summarizeTarget } from "../../core/query/summary.js";
import { loadStepDesign, validateWorkspaceScoped } from "../../core/validator/validate-scoped.js";
import { evaluateVibeGate } from "../../core/query/vibe-gate.js";
import { summarizeReleaseReadiness } from "../../core/workflow/release-readiness.js";
import { completedWorkReadModel, type CompletedWorkFilter } from "../../core/query/completed-work.js";
import { splitDiagnostics, summarizeDiagnostics } from "../../core/diagnostic.js";
import type { CliContext } from "../command.js";
import type { Diagnostic, DiagnosticsSummary, ParsedWorkspace, RequirementRecord, StepStateMode } from "../../core/types.js";
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

// @req IR-CLI-062 / IR-CLI-069
/** Whether a string is a shape-valid AND calendar-valid ISO date (YYYY-MM-DD). */
function isValidIsoDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

// @req IR-CLI-062 / IR-CLI-069
/** The most recent (max) Change Notes date string for a record, or undefined when it has none. */
function latestChangeDate(record: RequirementRecord): string | undefined {
  let latest: string | undefined;
  for (const row of record.changeNotes) {
    if (latest === undefined || row.date > latest) latest = row.date;
  }
  return latest;
}

// @req IR-CLI-069
/** Whole-day age of an ISO date relative to today (UTC), or null when the date is unparseable. */
function ageInDays(dateString: string | undefined): number | null {
  if (!dateString || !isValidIsoDate(dateString)) return null;
  const now = new Date();
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateString) as RegExpExecArray;
  const then = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return Math.floor((today - then) / 86_400_000);
}

// @req IR-CLI-052
/** Renders a diagnostic definition as human text, surfacing remediation only when present. */
function formatDiagnosticDefinition(definition: ToolSpecDiagnosticDefinition): string {
  const lines = [
    definition.code,
    definition.title,
    `severity: ${definition.severity}`,
    `messageTemplate: ${definition.messageTemplate}`,
    `sourceRule: ${definition.sourceRule}`,
    `since: ${definition.since}`
  ];
  if (typeof definition.remediation === "string" && definition.remediation.trim() !== "") {
    lines.push(`remediation: ${definition.remediation}`);
  }
  return lines.join("\n");
}

// DiagnosticDefinition may carry a remediation string (DR-PARSE-001). The core type does not yet
// declare it, so surface it structurally without depending on the type shape.
type ToolSpecDiagnosticDefinition = ReturnType<typeof getDiagnosticDefinition> & { remediation?: string };

// @req IR-CLI-063
/** Rank index for a priority (lower = more urgent); missing priority ranks last. */
function priorityRank(priority: RequirementRecord["priority"]): number {
  const index = priority ? PRIORITY_LEVELS.indexOf(priority) : -1;
  return index < 0 ? PRIORITY_LEVELS.length : index;
}

// @req IR-CLI-063
/** Rank index for a risk (higher risk ranks first); missing risk ranks lowest. */
function riskRank(risk: RequirementRecord["risk"]): number {
  const index = risk ? RISK_LEVELS.indexOf(risk) : -1;
  return index;
}

const ATTENTION_STATUS_ORDER = ["blocked", "in_progress", "implemented", "planned", "verified", "discarded"];

// @req IR-CLI-063
function statusRank(status: string): number {
  const index = ATTENTION_STATUS_ORDER.indexOf(status);
  return index < 0 ? ATTENTION_STATUS_ORDER.length : index;
}

// @req IR-CLI-051
function collectDiagnosticCode(value: string, previous: string[]): string[] {
  previous.push(value);
  return previous;
}

// @req IR-CLI-052
/** Prints a diagnostic definition (explain / validate --explain), rejecting unknown codes non-zero. */
function renderExplain(context: CliContext, rootCommand: Command, code: string, json: boolean): void {
  let definition: ToolSpecDiagnosticDefinition;
  try {
    definition = getDiagnosticDefinition(code) as ToolSpecDiagnosticDefinition;
  } catch {
    const message = `Unknown diagnostic code: ${code}`;
    if (json) {
      writeCliStructuredError(context.io, "NOT_FOUND", message, { recovery: { command: "validate" } });
      rootCommand.setOptionValue("exitCode", 5);
      return;
    }
    rootCommand.error(message, { exitCode: 5 });
    return;
  }
  if (json) writeJson(context.io, definition);
  else writeHuman(context.io, formatDiagnosticDefinition(definition));
}

// @req IR-CLI-064
/** One command-catalog entry rendered from a ToolSpec registry entry (order-preserving 1:1). */
function renderCommandCatalog(): Array<Record<string, unknown>> {
  const readOnlyMcpNames = new Set(renderReadOnlyToolNames());
  const isReadOnly = (spec: ToolSpec): boolean =>
    spec.kind === "read" && typeof spec.mcpName === "string" && readOnlyMcpNames.has(spec.mcpName);
  return toolSpecs.map((spec) => ({
    name: spec.cliName,
    kind: spec.kind,
    args: spec.args,
    options: spec.options,
    readOnly: isReadOnly(spec),
    resultExitMap: spec.resultExitMap
  }));
}

export function registerReadCommands(command: Command, context: CliContext): void {
  const validateCommand = command
    .command("validate")
    .option("--fail-on-warning", "fail when warnings exist")
    .option("--severity <severity>", "display only diagnostics of this severity (error or warning)")
    .option("--only <code>", "display only the listed diagnostic codes (repeatable)", collectDiagnosticCode, [])
    .option("--ignore <code>", "hide the listed diagnostic codes from display (repeatable)", collectDiagnosticCode, [])
    .option("--explain <code>", "print the diagnostic definition for a code and exit")
    .option("--json", "JSON output")
    .action(async (options) => {
      const json = options.json || command.opts().json;
      // @req IR-CLI-052 AC-3 — --explain short-circuits to a definition print, never a workspace run.
      if (typeof options.explain === "string") {
        renderExplain(context, validateCommand, options.explain, json);
        return;
      }
      const workspace = await workspaceFrom(command.opts());
      const diagnostics = readDiagnostics(workspace);
      // @req IR-CLI-051 — exit code is computed from the UNFILTERED error set; display filters only
      // change which diagnostics are shown, never the pass/fail decision.
      const unfiltered = splitDiagnostics(diagnostics);
      const displayed = diagnostics.filter((diagnostic) => {
        if (typeof options.severity === "string" && diagnostic.severity !== options.severity) return false;
        const only = options.only as string[];
        const ignore = options.ignore as string[];
        if (only.length > 0 && !only.includes(diagnostic.code)) return false;
        if (ignore.length > 0 && ignore.includes(diagnostic.code)) return false;
        return true;
      });
      const result = splitDiagnostics(displayed);
      const diagnosticsSummary = summarizeDiagnostics(displayed);
      const value = { ...result, summary: diagnosticsSummary, diagnosticsSummary };
      if (json) output(context, { json: true }, value);
      else output(context, { json: false }, formatValidateHuman(value));
      if (unfiltered.errors.length > 0 || (options.failOnWarning && unfiltered.warnings.length > 0)) command.setOptionValue("exitCode", 1);
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
  const reclassifyRecord = workflow
    .command("reclassify-record")
    .requiredOption("--run-id <runId>")
    .option("--path <path>")
    .requiredOption("--record-type <type>", "pipeline or worklog")
    .requiredOption("--line <line>", "one-based source line")
    .requiredOption("--byte-offset <offset>", "zero-based UTF-8 byte offset")
    .requiredOption("--raw-sha256 <sha>")
    .requiredOption("--event-key <key>")
    .requiredOption("--target-run-id <runId>")
    .requiredOption("--preimage-prefix-sha256 <sha>")
    .requiredOption("--expected-sha256 <sha>")
    .requiredOption("--owner <owner>")
    .requiredOption("--reason <text>")
    .option("--task-id <taskId>")
    .option("--req-id <reqId>")
    .option("--idempotency-key <key>")
    .option("--dry-run")
    .option("--repair-token <token>")
    .option("--json", "JSON output");
  reclassifyRecord.action(async (options) => {
    const recordType = requireStringOption(options, "recordType", reclassifyRecord);
    if (recordType !== "pipeline" && recordType !== "worklog") {
      reclassifyRecord.error("record-type must be pipeline or worklog", { exitCode: 2 });
    }
    const reason = requireStringOption(options, "reason", reclassifyRecord);
    if (reason.trim().length === 0) {
      reclassifyRecord.error("reason must not be blank", { exitCode: 2 });
    }
    const repairToken = typeof options.repairToken === "string" ? options.repairToken : undefined;
    if (options.dryRun !== true && (repairToken === undefined || repairToken.trim().length === 0)) {
      reclassifyRecord.error("repair-token is required unless --dry-run is set", { exitCode: 2 });
    }
    const line = parsePositiveInteger(options.line, "line", reclassifyRecord);
    if (line === undefined) reclassifyRecord.error("line is required", { exitCode: 2 });
    const byteOffset = parseNonNegativeInteger(options.byteOffset, "byte-offset", reclassifyRecord);
    if (byteOffset === undefined) reclassifyRecord.error("byte-offset is required", { exitCode: 2 });
    const jsonlPath = typeof options.path === "string" ? options.path : undefined;
    await workflowMutationOutput(
      options,
      {
        ...workflowMutationBase("workflow_record_reclassification", options, reclassifyRecord),
        ...(jsonlPath !== undefined ? { jsonlPath } : {}),
        recordType,
        line: line!,
        byteOffset: byteOffset!,
        rawSha256: requireStringOption(options, "rawSha256", reclassifyRecord),
        eventKey: requireStringOption(options, "eventKey", reclassifyRecord),
        targetRunId: requireStringOption(options, "targetRunId", reclassifyRecord),
        preimagePrefixSha256: requireStringOption(options, "preimagePrefixSha256", reclassifyRecord),
        ...(repairToken !== undefined ? { repairToken } : {})
      }
    );
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

  // @req IR-CLI-052 — explain a diagnostic code from the DiagnosticDefinition registry.
  command
    .command("explain")
    .argument("<code>", "diagnostic code (e.g. SRS-E001)")
    .option("--json", "JSON output")
    .action((code, options) => {
      renderExplain(context, command, code, Boolean(options.json) || command.opts().json);
    });

  // @req IR-CLI-048 @req IR-CLI-071 — read or switch the work mode over docs/spec/steps/state.md.
  const validModes = new Set<StepStateMode>(["sdd", "vibe", "wait", "tdd"]);
  command
    .command("mode")
    .argument("[value]", "switch target: sdd, vibe, wait, or tdd")
    .option("--json", "JSON output")
    .action(async (value, options) => {
      const json = Boolean(options.json) || command.opts().json;
      const root = await resolveProjectRoot(process.cwd(), command.opts().root);
      if (value === undefined) {
        output(context, { json }, mutationOk(await getWorkMode(root)));
        return;
      }
      if (!validModes.has(value as StepStateMode)) {
        output(context, { json }, mutationFail("INVALID_MODE", `Invalid mode: ${value} (expected sdd, vibe, wait, or tdd)`));
        command.setOptionValue("exitCode", 2);
        return;
      }
      const result = await setWorkMode(root, { mode: value as StepStateMode });
      output(context, { json }, result);
      if (!result.ok) command.setOptionValue("exitCode", 5);
    });

  // @req IR-CLI-049 @req IR-CLI-072 — CI-wireable work-mode gate. Wire as a remote required status
  // check to block unsynthesized vibe/tdd commits (and SDS-less tdd commits) where local hooks can
  // be bypassed.
  const vibeGate = command
    .command("vibe-gate")
    .description("Vibe/tdd-synthesis gate for CI. Wire `vibe-gate check` as a remote required status check to block unsynthesized vibe/tdd commits.");
  vibeGate
    .command("check")
    .description("Exit non-zero when an active vibe/tdd task has no synthesized step directory, or a tdd task has no design.md; use as a remote required status check.")
    .option("--json", "JSON output")
    .action(async (options) => {
      const json = Boolean(options.json) || command.opts().json;
      const root = await resolveProjectRoot(process.cwd(), command.opts().root);
      // @req FR-MCP-054 — the gate logic lives in the shared core query (also `check_vibe_gate`).
      const gate = await evaluateVibeGate(root);
      output(
        context,
        { json },
        gate.blocked
          ? mutationFail("VIBE_GATE_BLOCKED", gate.blockedReason ?? "vibe gate blocked")
          : mutationOk({ mode: gate.mode, activeTask: gate.activeTask, blocked: false })
      );
      if (gate.blocked) command.setOptionValue("exitCode", 1);
    });

  // @req IR-CLI-062 — cross-requirement timeline: requirements whose most recent Change Notes date
  // is on or after a given date, with optional target/scope filters. Never writes a file.
  const changedSince = command
    .command("changed-since")
    .argument("<date>", "inclusive lower bound (YYYY-MM-DD)")
    .option("--target <target>")
    .option("--scope <scope>")
    .option("--json", "JSON output")
    .action(async (date, options) => {
      if (!isValidIsoDate(date)) {
        changedSince.error("date must use YYYY-MM-DD", { exitCode: 2 });
        return;
      }
      const workspace = await workspaceFrom(command.opts());
      const filter = parseFilter(options);
      const requirements = workspace.records
        .filter((record) => matchesRequirementFilter(record, filter))
        .map((record) => ({ record, latest: latestChangeDate(record) }))
        .filter(({ latest }) => typeof latest === "string" && isValidIsoDate(latest) && latest >= date)
        .sort((a, b) => a.record.id.localeCompare(b.record.id))
        .map(({ record, latest }) => ({ id: record.id, target: record.target, scope: record.scope, latestChangeDate: latest }));
      outputRead(context, { json: Boolean(options.json) || command.opts().json }, workspace, { requirements });
    });

  // @req IR-CLI-069 — aging requirements: evolving-stability requirements whose most recent Change
  // Notes date is older than a threshold (default 90 days). Never writes a file.
  const stale = command
    .command("stale")
    .option("--target <target>")
    .option("--evolving-age <days>", "age threshold in days (default 90)")
    .option("--json", "JSON output")
    .action(async (options) => {
      const threshold = parsePositiveInteger(options.evolvingAge, "evolving-age", stale) ?? 90;
      const workspace = await workspaceFrom(command.opts());
      const filter = parseFilter(options);
      const requirements = workspace.records
        .filter((record) => matchesRequirementFilter(record, filter))
        .filter((record) => record.stability === "evolving")
        .map((record) => {
          const latest = latestChangeDate(record);
          return { record, latest, ageDays: ageInDays(latest) };
        })
        // FND-007: an undecidable age (null) is never treated as fresh — surface it rather than drop it.
        .filter(({ ageDays }) => ageDays === null || ageDays > threshold)
        .sort((a, b) => a.record.id.localeCompare(b.record.id))
        .map(({ record, latest, ageDays }) => ({
          id: record.id,
          target: record.target,
          stability: record.stability,
          latestChangeDate: latest ?? null,
          ageDays
        }));
      outputRead(context, { json: Boolean(options.json) || command.opts().json }, workspace, { requirements, evolvingAge: threshold });
    });

  // @req IR-CLI-061 — Change Notes of one requirement, chronologically, with optional --since. Never
  // writes a file.
  command
    .command("history")
    .argument("<id>")
    .option("--since <date>", "include rows on or after YYYY-MM-DD inclusive")
    .option("--json", "JSON output")
    .action(async (id, options) => {
      const json = Boolean(options.json) || command.opts().json;
      const workspace = await workspaceFrom(command.opts());
      const record = workspace.records.find((candidate) => candidate.id === id);
      if (!record) {
        readFailure(context, command, { json }, "NOT_FOUND", `Requirement not found: ${id}`, "show", 5);
        return;
      }
      const since = typeof options.since === "string" ? options.since : undefined;
      const changeNotes = record.changeNotes
        .filter((row) => since === undefined || row.date >= since)
        .slice()
        .sort((a, b) => a.date.localeCompare(b.date))
        .map((row) => ({ date: row.date, change: row.change, reason: row.reason }));
      // Plain value (no diagnostics envelope): the timeline is the requirement's own Change Notes.
      output(context, { json }, { id: record.id, changeNotes });
    });

  // @req IR-CLI-063 — priority-ranked work queue merging the readiness buckets. Never writes a file.
  const attention = command
    .command("attention")
    .option("--target <target>")
    .option("--top <n>", "limit to the first n ranked entries")
    .option("--json", "JSON output")
    .action(async (options) => {
      const top = parsePositiveInteger(options.top, "top", attention);
      const workspace = await workspaceFrom(command.opts());
      const diagnostics = readDiagnostics(workspace);
      const summary = summarizeTarget(workspace, typeof options.target === "string" ? { target: options.target, diagnostics } : { diagnostics });
      const ids = new Set<string>([
        ...summary.blocked,
        ...summary.implementedNotVerified,
        ...summary.missingEvidence,
        ...summary.stabilityBlockers
      ]);
      const byId = new Map(workspace.records.map((record) => [record.id, record]));
      const ranked = [...ids]
        .map((id) => byId.get(id))
        .filter((record): record is RequirementRecord => record !== undefined)
        .sort((a, b) =>
          priorityRank(a.priority) - priorityRank(b.priority) ||
          riskRank(b.risk) - riskRank(a.risk) ||
          statusRank(a.status) - statusRank(b.status) ||
          a.id.localeCompare(b.id))
        .map((record) => ({ id: record.id, priority: record.priority ?? null, risk: record.risk ?? null, status: record.status, stability: record.stability ?? null }));
      const requirements = top === undefined ? ranked : ranked.slice(0, top);
      output(context, { json: Boolean(options.json) || command.opts().json }, { requirements });
    });

  // @req IR-CLI-064 — full command catalog rendered from the ToolSpec registry. Never writes a file.
  command
    .command("commands")
    .option("--json", "JSON output")
    .action((options) => {
      output(context, { json: Boolean(options.json) || command.opts().json }, { commands: renderCommandCatalog() });
    });

  const links = command.command("links");
  links.command("check").option("--json").action(async (options) => {
    const workspace = await workspaceFrom(command.opts());
    outputRead(context, { json: options.json || command.opts().json }, workspace, await checkLinks(workspace));
  });

  // @req IR-CLI-046 — step-local validation surface: run validateWorkspaceScoped for the named step
  // and print its step-local diagnostics with an exit code reflecting step-local errors only.
  const step = command.command("step");
  step
    .command("validate")
    .argument("<name>", "step name under docs/spec/steps/<name>/")
    .option("--json", "JSON output")
    .action(async (name, options) => {
      const json = Boolean(options.json) || command.opts().json;
      const workspace = await workspaceFrom(command.opts());
      // @req FR-PARSE-033 — design.md is outside ParsedWorkspace, so the surface loads it.
      const root = await resolveProjectRoot(process.cwd(), command.opts().root);
      const result = validateWorkspaceScoped(workspace, { step: name, design: await loadStepDesign(root, name) });
      const diagnosticsSummary = summarizeDiagnostics(result.diagnostics);
      output(context, { json }, { ...result, diagnosticsSummary });
      if (result.errors.length > 0) command.setOptionValue("exitCode", 1);
    });

  // @req IR-CLI-073 — expose the idempotent step SRS synthesis engine (FR-NODE-041/073) on the CLI.
  step
    .command("synthesize")
    .argument("<task>", "step name under docs/spec/steps/<task>/")
    .option("--dry-run", "evaluate without writing")
    .option("--json", "JSON output")
    .action(async (task, options) => {
      const json = Boolean(options.json) || command.opts().json;
      const root = await resolveProjectRoot(process.cwd(), command.opts().root);
      const result = await synthesizeStepSrs(root, { task, ...(options.dryRun === true ? { dryRun: true } : {}) });
      output(context, { json }, result);
      if (!result.ok) command.setOptionValue("exitCode", 5);
    });

  // @req IR-CLI-074 — CLI mirrors of the step mutations (claim/update-state/promote) so the tdd
  // cycle stays reachable when MCP is unavailable (MCP-preferred, CLI fallback).
  step
    .command("claim")
    .argument("<step>", "step name to claim in docs/spec/steps/state.md")
    .option("--touches-scope <scope>", "scope prefix the step touches")
    .option("--touches-req <id>", "requirement id the step touches; repeatable", collectOption, [])
    .option("--force", "override the write-skew soft gate")
    .option("--supersede <id>", "supersede an existing step claim")
    .option("--dry-run", "evaluate without writing")
    .option("--json", "JSON output")
    .action(async (stepName, options) => {
      const json = Boolean(options.json) || command.opts().json;
      const root = await resolveProjectRoot(process.cwd(), command.opts().root);
      const result = await claimStep(root, {
        step: stepName,
        touchesScope: String(options.touchesScope ?? ""),
        touchesReq: options.touchesReq ?? [],
        ...(options.force === true ? { force: true } : {}),
        ...(typeof options.supersede === "string" ? { supersede: options.supersede } : {}),
        ...(options.dryRun === true ? { dryRun: true } : {})
      });
      output(context, { json }, result);
      if (!result.ok) command.setOptionValue("exitCode", 5);
    });

  step
    .command("update-state")
    .argument("<step>", "step name whose state.md row to update")
    .option("--status <status>", "active, merging, merged, or abandoned")
    .option("--depends-on <steps>", "comma-separated DependsOn list")
    .option("--acknowledged", "acknowledge non-clean closure edges for the merged gate (FR-NODE-078)")
    .option("--dry-run", "evaluate without writing")
    .option("--json", "JSON output")
    .action(async (stepName, options) => {
      const json = Boolean(options.json) || command.opts().json;
      const root = await resolveProjectRoot(process.cwd(), command.opts().root);
      const result = await updateStepState(root, {
        step: stepName,
        ...(typeof options.status === "string" ? { status: options.status } : {}),
        ...(typeof options.dependsOn === "string" ? { dependsOn: options.dependsOn } : {}),
        ...(options.acknowledged === true ? { acknowledged: true } : {}),
        ...(options.dryRun === true ? { dryRun: true } : {})
      });
      output(context, { json }, result);
      if (!result.ok) command.setOptionValue("exitCode", 5);
    });

  // @req FR-NODE-080 — writeIfMissing SDS/intent stub scaffold (content stays directly authored).
  step
    .command("scaffold")
    .argument("<task>", "step name under docs/spec/steps/<task>/")
    .option("--target <target>", "target stamped into the SDS metadata table")
    .option("--dry-run", "evaluate without writing")
    .option("--json", "JSON output")
    .action(async (task, options) => {
      const json = Boolean(options.json) || command.opts().json;
      const root = await resolveProjectRoot(process.cwd(), command.opts().root);
      const result = await scaffoldStep(root, {
        task,
        ...(typeof options.target === "string" ? { target: options.target } : {}),
        ...(options.dryRun === true ? { dryRun: true } : {})
      });
      output(context, { json }, result);
      if (!result.ok) command.setOptionValue("exitCode", 5);
    });

  // @req FR-NODE-081 — forward-only SDS lifecycle transition (draft -> agreed -> superseded).
  step
    .command("sds-status")
    .argument("<task>", "step name under docs/spec/steps/<task>/")
    .argument("<status>", "target SDS status: draft, agreed, or superseded")
    .option("--dry-run", "evaluate without writing")
    .option("--json", "JSON output")
    .action(async (task, status, options) => {
      const json = Boolean(options.json) || command.opts().json;
      const root = await resolveProjectRoot(process.cwd(), command.opts().root);
      const result = await setSdsStatus(root, {
        task,
        status,
        ...(options.dryRun === true ? { dryRun: true } : {})
      });
      output(context, { json }, result);
      if (!result.ok) command.setOptionValue("exitCode", 5);
    });

  step
    .command("promote")
    .argument("<id>", "pre-minted step requirement id to promote into a body scope")
    .option("--from-step <step>", "origin step name")
    .option("--to-scope <scope>", "target body scope prefix")
    .option("--dry-run", "evaluate without writing")
    .option("--ignore-lock", "bypass the SRS mutation lock")
    .option("--json", "JSON output")
    .action(async (id, options) => {
      const json = Boolean(options.json) || command.opts().json;
      const root = await resolveProjectRoot(process.cwd(), command.opts().root);
      const result = await promoteStepRequirement(root, {
        id,
        fromStep: String(options.fromStep ?? ""),
        toScope: String(options.toScope ?? ""),
        ...(options.dryRun === true ? { dryRun: true } : {}),
        ...(options.ignoreLock === true ? { ignoreLock: true } : {})
      });
      output(context, { json }, result);
      if (!result.ok) command.setOptionValue("exitCode", 5);
    });

  // @req IR-CLI-053 — release-readiness, coverage, and rtm read surfaces over the core release
  // readiness module, defaulting to the Active Target, with a per-requirement verified-gate banner.
  const VERIFIED_GATE_BANNER =
    "Warning: the verified transition requires per-requirement verification evidence and is not auto-applied.";
  command
    .command("release-readiness")
    .option("--target <target>")
    .option("--json", "JSON output")
    .action(async (options) => {
      const json = Boolean(options.json) || command.opts().json;
      const workspace = await workspaceFrom(command.opts());
      const summary = summarizeReleaseReadiness(workspace, typeof options.target === "string" ? { target: options.target } : {});
      const hasVerifiedCandidates = summary.implementedNotVerified.length > 0;
      if (json) {
        writeJson(context.io, hasVerifiedCandidates ? { ...summary, verifiedGateBanner: VERIFIED_GATE_BANNER } : summary);
        return;
      }
      if (hasVerifiedCandidates) context.io.stderr.write(`${VERIFIED_GATE_BANNER}\n`);
      writeHuman(context.io, summary);
    });

  command
    .command("coverage")
    .option("--target <target>")
    .option("--json", "JSON output")
    .action(async (options) => {
      const json = Boolean(options.json) || command.opts().json;
      const workspace = await workspaceFrom(command.opts());
      const summary = summarizeReleaseReadiness(workspace, typeof options.target === "string" ? { target: options.target } : {});
      output(context, { json }, { target: summary.target, acCoverageGaps: summary.acCoverageGaps });
    });

  command
    .command("rtm")
    .option("--target <target>")
    .option("--json", "JSON output")
    .action(async (options) => {
      const json = Boolean(options.json) || command.opts().json;
      const workspace = await workspaceFrom(command.opts());
      const target = resolveTargetSelection(workspace, typeof options.target === "string" ? { target: options.target } : {}).target;
      const requirements = workspace.records
        .filter((record) => record.target === target)
        .map((record) => ({
          id: record.id,
          status: record.status,
          evidence: record.verificationEvidence.map((row) => ({ evidenceId: row.id, reference: row.reference, covers: row.covers }))
        }));
      output(context, { json }, { target, requirements });
    });
}

// @req IR-CLI-074 — commander collector for repeatable options (e.g. --touches-req).
function collectOption(value: string, previous: string[]): string[] {
  previous.push(value);
  return previous;
}
