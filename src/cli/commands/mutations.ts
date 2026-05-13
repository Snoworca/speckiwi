import { InvalidArgumentError, type Command } from "commander";
import { resolveProjectRoot } from "../../core/project-root.js";
import { initProject } from "../../core/bootstrap/init-project.js";
import { updateStatus } from "../../core/mutation/update-status.js";
import { setAcceptanceCriteriaChecked } from "../../core/mutation/check-ac.js";
import { addVerificationEvidence } from "../../core/mutation/add-evidence.js";
import { addTraceLink } from "../../core/mutation/add-trace.js";
import { addRequirement } from "../../core/mutation/add-requirement.js";
import { setActiveTarget } from "../../core/mutation/set-active-target.js";
import { addCompletedWork } from "../../core/mutation/add-completed-work.js";
import { validateReportPathToken } from "../../core/completed-work/report-paths.js";
import type { CliContext } from "../command.js";
import { writeHuman, writeJson } from "../formatters.js";

async function rootFrom(options: { root?: string }) {
  return resolveProjectRoot(process.cwd(), options.root);
}

function output(context: CliContext, commandOptions: { json?: boolean }, value: unknown): void {
  if (commandOptions.json) writeJson(context.io, value);
  else writeHuman(context.io, value);
}

function collect(value: unknown): string[] {
  if (!value) return [];
  return Array.isArray(value) ? value.map(String) : [String(value)];
}

function pushOption(value: string, previous: string[]): string[] {
  previous.push(value);
  return previous;
}

function pushReportPathOption(value: string, previous: string[]): string[] {
  const trimmed = value.trim();
  const issue = validateReportPathToken(trimmed);
  if (issue) throw new InvalidArgumentError(`invalid report path: ${issue.reason}`);
  previous.push(trimmed);
  return previous;
}

function parseEvidenceOptions(rows: string[]) {
  return rows.map((row) => {
    const [type = "test", reference = "", covers = "all", notes = "-"] = row.split("|");
    return { type, reference, covers, notes };
  });
}

function parseTraceOptions(rows: string[]) {
  return rows.map((row) => {
    const [type = "Requirement", reference = "", relation = "related_to", notes = "-"] = row.split("|");
    return { type, reference, relation, notes };
  });
}

function parseDate(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new InvalidArgumentError("date must use YYYY-MM-DD");
  return value;
}

function parseRequirementIds(value?: string): string[] {
  return typeof value === "string" ? value.split(",").map((id) => id.trim()).filter(Boolean) : [];
}

export function registerMutationCommands(command: Command, context: CliContext): void {
  command.command("init").option("--target <target>").option("--scope <scope>").option("--force").option("--json").action(async (options) => {
    const root = await resolveProjectRoot(process.cwd(), command.opts().root ?? process.cwd());
    const result = await initProject(root, {
      ...(typeof options.target === "string" ? { target: options.target } : {}),
      ...(typeof options.scope === "string" ? { scope: options.scope } : {}),
      force: Boolean(options.force)
    });
    output(context, { json: options.json || command.opts().json }, result);
    if (!result.ok) command.setOptionValue("exitCode", 5);
  });

  command.command("update-status").argument("<id>").argument("<status>").option("--json").action(async (id, status, options) => {
    const result = await updateStatus(await rootFrom(command.opts()), { id, status });
    output(context, { json: options.json || command.opts().json }, result);
    if (!result.ok) command.setOptionValue("exitCode", 5);
  });

  command.command("set-active-target").argument("<target>").option("--dry-run").option("--json").action(async (target, options) => {
    const result = await setActiveTarget(await rootFrom(command.opts()), { target, dryRun: Boolean(options.dryRun) });
    output(context, { json: options.json || command.opts().json }, result);
    if (!result.ok) command.setOptionValue("exitCode", 5);
  });

  command
    .command("add-completed-work")
    .requiredOption("--date <date>", "completion date as YYYY-MM-DD", parseDate)
    .requiredOption("--summary <summary>")
    .option("--target <target>")
    .option("--scope <scope>")
    .option("--requirements <ids>")
    .option("--report <path>", "completion report path; repeatable, stored comma-separated; forbids absolute paths, traversal, URL schemes, backslash, pipe, comma, newline, and #", pushReportPathOption, [])
    .option("--allow-incomplete", "allow historical or incomplete Completed Work Log references")
    .option("--dry-run")
    .option("--json")
    .action(async (options) => {
      const result = await addCompletedWork(await rootFrom(command.opts()), {
        date: options.date,
        summary: options.summary,
        ...(typeof options.target === "string" ? { target: options.target } : {}),
        ...(typeof options.scope === "string" ? { scope: options.scope } : {}),
        requirementIds: parseRequirementIds(options.requirements),
        reportPaths: collect(options.report),
        allowIncomplete: Boolean(options.allowIncomplete),
        dryRun: Boolean(options.dryRun)
      });
      output(context, { json: options.json || command.opts().json }, result);
      if (!result.ok) command.setOptionValue("exitCode", 5);
    });

  for (const [name, checked] of [
    ["check-ac", true],
    ["uncheck-ac", false]
  ] as const) {
    command
      .command(name)
      .argument("<id>")
      .argument("[acIds...]")
      .option("--all")
      .option("--json")
      .action(async (id, acIds, options) => {
        const result = await setAcceptanceCriteriaChecked(await rootFrom(command.opts()), { id, acIds: options.all ? ["all"] : collect(acIds), checked });
        output(context, { json: options.json || command.opts().json }, result);
        if (!result.ok) command.setOptionValue("exitCode", 5);
      });
  }

  command.command("add-evidence").argument("<id>").requiredOption("--type <type>").requiredOption("--reference <reference>").option("--covers <covers>").option("--notes <notes>").option("--json").action(async (id, options) => {
    const result = await addVerificationEvidence(await rootFrom(command.opts()), { id, type: options.type, reference: options.reference, covers: options.covers, notes: options.notes });
    output(context, { json: options.json || command.opts().json }, result);
    if (!result.ok) command.setOptionValue("exitCode", 5);
  });

  command.command("add-trace").argument("<id>").requiredOption("--type <type>").requiredOption("--reference <reference>").requiredOption("--relation <relation>").option("--notes <notes>").option("--json").action(async (id, options) => {
    const result = await addTraceLink(await rootFrom(command.opts()), { id, type: options.type, reference: options.reference, relation: options.relation, notes: options.notes });
    output(context, { json: options.json || command.opts().json }, result);
    if (!result.ok) command.setOptionValue("exitCode", 5);
  });

  command
    .command("add-requirement")
    .requiredOption("--type <type>")
    .requiredOption("--scope <scope>")
    .requiredOption("--target <target>")
    .requiredOption("--title <title>")
    .option("--statement <statement>")
    .option("--requirement <requirement>")
    .option("--ac <criterion>", "acceptance criterion; repeatable", pushOption, [])
    .option("--checked-ac <criterion>", "checked AC id or text; repeatable", pushOption, [])
    .option("--status <status>")
    .option("--priority <priority>")
    .option("--tags <tags>")
    .option("--risk <risk>")
    .option("--stability <stability>")
    .option("--verification-method <method>")
    .option("--github-issue <issue>")
    .option("--related-docs <doc>", "related Markdown link; repeatable", pushOption, [])
    .option("--rationale <text>")
    .option("--implementation-notes <text>")
    .option("--research <text>")
    .option("--change-notes <text>")
    .option("--evidence <row>", "evidence as type|reference|covers|notes; repeatable", pushOption, [])
    .option("--trace <row>", "trace as type|reference|relation|notes; repeatable", pushOption, [])
    .option("--dry-run")
    .option("--json")
    .action(async (options) => {
      const statement = options.requirement ?? options.statement;
      if (!statement) {
        command.error("required option '--requirement <requirement>' or '--statement <statement>' not specified", { exitCode: 2 });
      }
      const result = await addRequirement(await rootFrom(command.opts()), {
        type: options.type,
        scope: options.scope,
        target: options.target,
        title: options.title,
        statement,
        acceptanceCriteria: collect(options.ac),
        checkedAcceptanceCriteria: collect(options.checkedAc),
        status: options.status,
        priority: options.priority,
        tags: typeof options.tags === "string" ? options.tags.split(",").map((tag: string) => tag.trim()).filter(Boolean) : [],
        risk: options.risk,
        stability: options.stability,
        verificationMethod: options.verificationMethod,
        githubIssue: options.githubIssue,
        relatedDocs: collect(options.relatedDocs),
        rationale: options.rationale,
        implementationNotes: options.implementationNotes,
        research: options.research,
        changeNotes: options.changeNotes,
        evidence: parseEvidenceOptions(collect(options.evidence)),
        trace: parseTraceOptions(collect(options.trace)),
        dryRun: Boolean(options.dryRun)
      });
      output(context, { json: options.json || command.opts().json }, result);
      if (!result.ok) command.setOptionValue("exitCode", 5);
    });
}
