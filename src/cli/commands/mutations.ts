import { InvalidArgumentError, type Command } from "commander";
import { resolveProjectRoot } from "../../core/project-root.js";
import { initProject } from "../../core/bootstrap/init-project.js";
import { updateStatus, restore } from "../../core/mutation/update-status.js";
import { updateStability } from "../../core/mutation/update-stability.js";
import { appendSectionNote } from "../../core/mutation/append-section-note.js";
import { setAcceptanceCriteriaChecked, editAcceptanceCriteria } from "../../core/mutation/check-ac.js";
import { addVerificationEvidence } from "../../core/mutation/add-evidence.js";
import { addTraceLink, setSupersede } from "../../core/mutation/add-trace.js";
import { addRequirement } from "../../core/mutation/add-requirement.js";
import { setActiveTarget } from "../../core/mutation/set-active-target.js";
import { setTargetGoal } from "../../core/mutation/set-target-goal.js";
import { addCompletedWork } from "../../core/mutation/add-completed-work.js";
import { syncIndexRollups } from "../../core/mutation/sync-index.js";
import { editRequirementTableRows, replaceAcceptanceCriteria, updateRequirementFields } from "../../core/mutation/edit-requirement.js";
import { updateField, type UpdateFieldName } from "../../core/mutation/update-field.js";
import { retarget } from "../../core/mutation/retarget.js";
import { supersedeRequirement } from "../../core/mutation/supersede-requirement.js";
import { syncCounts } from "../../core/mutation/sync-counts.js";
import { scaffoldScope } from "../../core/mutation/scaffold-scope.js";
import { registerScopes } from "../../core/mutation/register-scopes.js";
import { addRelatedDoc } from "../../core/mutation/add-related-doc.js";
import { addChangeNote } from "../../core/mutation/add-change-note.js";
import { updateRequirementStatement } from "../../core/mutation/update-statement.js";
import { parseWorkspace } from "../../core/parser/workspace-parser.js";
import { listRequirements } from "../../core/query/lookup.js";
import { validateReportPathToken } from "../../core/completed-work/report-paths.js";
import type { CliContext } from "../command.js";
import type { RequirementFilter, RequirementStatus, RequirementType } from "../../core/types.js";
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

function parseJsonArrayOption(value: string, label: string): unknown[] {
  const parsed = JSON.parse(value) as unknown;
  if (!Array.isArray(parsed)) throw new InvalidArgumentError(`${label} must be a JSON array`);
  return parsed;
}

function parseDate(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new InvalidArgumentError("date must use YYYY-MM-DD");
  return value;
}

function parseRequirementIds(value?: string): string[] {
  return typeof value === "string" ? value.split(",").map((id) => id.trim()).filter(Boolean) : [];
}

export function registerMutationCommands(command: Command, context: CliContext): void {
  command.command("init").option("--target <target>").option("--scope <scope>").option("--force").option("--ignore-lock").option("--json").action(async (options) => {
    const root = await resolveProjectRoot(process.cwd(), command.opts().root ?? process.cwd());
    const result = await initProject(root, {
      ...(typeof options.target === "string" ? { target: options.target } : {}),
      ...(typeof options.scope === "string" ? { scope: options.scope } : {}),
      force: Boolean(options.force),
      ...(options.ignoreLock ? { ignoreLock: true } : {})
    });
    output(context, { json: options.json || command.opts().json }, result);
    if (!result.ok) command.setOptionValue("exitCode", 5);
  });

  command
    .command("sync-index")
    .option("--expected-sha256 <sha>")
    .option("--dry-run")
    .option("--ignore-lock")
    .option("--json")
    .action(async (options) => {
      const result = await syncIndexRollups(await rootFrom(command.opts()), {
        ...(typeof options.expectedSha256 === "string" ? { expectedSha256: options.expectedSha256 } : {}),
        ...(options.dryRun ? { dryRun: true } : {}),
        ...(options.ignoreLock ? { ignoreLock: true } : {})
      });
      output(context, { json: options.json || command.opts().json }, result);
      if (!result.ok) command.setOptionValue("exitCode", 5);
    });

  command
    .command("update-status")
    .argument("<id>")
    .argument("<status>")
    .option("--reason <text>", "Append a Change Notes row with the given reason (SRS-MD-Rules v1.1.0 §30.3)")
    .option("--dry-run")
    .option("--ignore-lock")
    .option("--json")
    .action(async (id, status, options) => {
      const result = await updateStatus(await rootFrom(command.opts()), {
        id,
        status,
        ...(typeof options.reason === "string" ? { reason: options.reason } : {}),
        ...(options.dryRun ? { dryRun: true } : {}),
        ...(options.ignoreLock ? { ignoreLock: true } : {})
      });
      output(context, { json: options.json || command.opts().json }, result);
      if (!result.ok) command.setOptionValue("exitCode", 5);
    });

  command
    .command("update-stability")
    .argument("<id>")
    .argument("<stability>")
    .option("--reason <text>", "Append a Change Notes row with the given reason")
    .option("--dry-run")
    .option("--ignore-lock")
    .option("--json")
    .action(async (id, stability, options) => {
      const result = await updateStability(await rootFrom(command.opts()), {
        id,
        stability,
        ...(typeof options.reason === "string" ? { reason: options.reason } : {}),
        ...(options.dryRun ? { dryRun: true } : {}),
        ...(options.ignoreLock ? { ignoreLock: true } : {})
      });
      output(context, { json: options.json || command.opts().json }, result);
      if (!result.ok) command.setOptionValue("exitCode", 5);
    });

  command
    .command("append-note")
    .argument("<id>")
    .requiredOption("--section <section>", "rationale | research | implementation_notes")
    .requiredOption("--text <text>", "note text (max 500 UTF-16 code units)")
    .option("--mode <mode>", "append (default) or replace")
    .option("--dry-run")
    .option("--ignore-lock")
    .option("--json")
    .action(async (id, options) => {
      const result = await appendSectionNote(await rootFrom(command.opts()), {
        id,
        section: options.section,
        text: options.text,
        ...(typeof options.mode === "string" ? { mode: options.mode as "append" | "replace" } : {}),
        ...(options.dryRun ? { dryRun: true } : {}),
        ...(options.ignoreLock ? { ignoreLock: true } : {})
      });
      output(context, { json: options.json || command.opts().json }, result);
      if (!result.ok) command.setOptionValue("exitCode", 5);
    });

  command
    .command("edit-requirement")
    .argument("<id>")
    .option("--title <title>")
    .option("--statement <statement>")
    .option("--priority <priority>")
    .option("--risk <risk>")
    .option("--tags <csv>")
    .option("--related-docs <csv>")
    .option("--verification-method <method>")
    .option("--github-issue <url>")
    .option("--dry-run")
    .option("--ignore-lock")
    .option("--json")
    .action(async (id, options) => {
      const result = await updateRequirementFields(await rootFrom(command.opts()), {
        id,
        ...(typeof options.title === "string" ? { title: options.title } : {}),
        ...(typeof options.statement === "string" ? { statement: options.statement } : {}),
        ...(typeof options.priority === "string" ? { priority: options.priority } : {}),
        ...(typeof options.risk === "string" ? { risk: options.risk } : {}),
        ...(typeof options.tags === "string" ? { tags: options.tags.split(",").map((item: string) => item.trim()).filter(Boolean) } : {}),
        ...(typeof options.relatedDocs === "string" ? { relatedDocs: options.relatedDocs.split(",").map((item: string) => item.trim()).filter(Boolean) } : {}),
        ...(typeof options.verificationMethod === "string" ? { verificationMethod: options.verificationMethod } : {}),
        ...(typeof options.githubIssue === "string" ? { githubIssue: options.githubIssue } : {}),
        ...(options.dryRun ? { dryRun: true } : {}),
        ...(options.ignoreLock ? { ignoreLock: true } : {})
      });
      output(context, { json: options.json || command.opts().json }, result);
      if (!result.ok) command.setOptionValue("exitCode", 5);
    });

  command
    .command("replace-acceptance-criteria")
    .argument("<id>")
    .requiredOption("--items <json>", "JSON array of {text, checked?}")
    .option("--dry-run")
    .option("--ignore-lock")
    .option("--json")
    .action(async (id, options) => {
      const result = await replaceAcceptanceCriteria(await rootFrom(command.opts()), {
        id,
        items: parseJsonArrayOption(options.items, "items") as Array<{ text: string; checked?: boolean }>,
        ...(options.dryRun ? { dryRun: true } : {}),
        ...(options.ignoreLock ? { ignoreLock: true } : {})
      });
      output(context, { json: options.json || command.opts().json }, result);
      if (!result.ok) command.setOptionValue("exitCode", 5);
    });

  command
    .command("edit-requirement-table-rows")
    .argument("<id>")
    .requiredOption("--section <section>", "verification_evidence or trace_links")
    .requiredOption("--operations <json>", "JSON array of row operations")
    .option("--dry-run")
    .option("--ignore-lock")
    .option("--json")
    .action(async (id, options) => {
      const result = await editRequirementTableRows(await rootFrom(command.opts()), {
        id,
        section: options.section,
        operations: parseJsonArrayOption(options.operations, "operations") as never,
        ...(options.dryRun ? { dryRun: true } : {}),
        ...(options.ignoreLock ? { ignoreLock: true } : {})
      });
      output(context, { json: options.json || command.opts().json }, result);
      if (!result.ok) command.setOptionValue("exitCode", 5);
    });

  command
    .command("set-active-target")
    .argument("<target>")
    .option("--create", "register the target in Target Map when missing")
    .option("--type <type>", "target type when --create is used: version, release, or milestone")
    .option("--description <text>", "target description when --create is used")
    .option("--dry-run")
    .option("--ignore-lock")
    .option("--json")
    .action(async (target, options) => {
      const result = await setActiveTarget(await rootFrom(command.opts()), {
        target,
        create: Boolean(options.create),
        ...(typeof options.type === "string" ? { targetType: options.type } : {}),
        ...(typeof options.description === "string" ? { description: options.description } : {}),
        dryRun: Boolean(options.dryRun),
        ignoreLock: Boolean(options.ignoreLock)
      });
      output(context, { json: options.json || command.opts().json }, result);
      if (!result.ok) command.setOptionValue("exitCode", 5);
    });

  command
    .command("set-target-goal")
    .argument("<target>")
    .requiredOption("--goal <text>", "goal text (max 500 UTF-16 code units)")
    .option("--dry-run")
    .option("--ignore-lock")
    .option("--json")
    .action(async (target, options) => {
      const result = await setTargetGoal(await rootFrom(command.opts()), {
        target,
        goal: options.goal,
        ...(options.dryRun ? { dryRun: true } : {}),
        ...(options.ignoreLock ? { ignoreLock: true } : {})
      });
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
    .option("--ignore-lock")
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
        dryRun: Boolean(options.dryRun),
        ignoreLock: Boolean(options.ignoreLock)
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
      .option("--dry-run")
      .option("--ignore-lock")
      .option("--json")
      .action(async (id, acIds, options) => {
        const result = await setAcceptanceCriteriaChecked(await rootFrom(command.opts()), {
          id,
          acIds: options.all ? ["all"] : collect(acIds),
          checked,
          ...(options.dryRun ? { dryRun: true } : {}),
          ...(options.ignoreLock ? { ignoreLock: true } : {})
        });
        output(context, { json: options.json || command.opts().json }, result);
        if (!result.ok) command.setOptionValue("exitCode", 5);
      });
  }

  command
    .command("add-evidence")
    .argument("<id>")
    .requiredOption("--type <type>")
    .option("--reference <reference>")
    .option("--ref <reference>", "alias for --reference")
    .option("--covers <covers>")
    .option("--notes <notes>")
    .option("--dry-run")
    .option("--ignore-lock")
    .option("--json")
    .action(async (id, options) => {
      const reference = options.reference ?? options.ref;
      if (!reference) command.error("required option '--reference <reference>' not specified", { exitCode: 2 });
      const result = await addVerificationEvidence(await rootFrom(command.opts()), {
        id,
        type: options.type,
        reference,
        covers: options.covers,
        notes: options.notes,
        ...(options.dryRun ? { dryRun: true } : {}),
        ...(options.ignoreLock ? { ignoreLock: true } : {})
      });
      output(context, { json: options.json || command.opts().json }, result);
      if (!result.ok) command.setOptionValue("exitCode", 5);
    });

  command
    .command("add-trace")
    .argument("<id>")
    .requiredOption("--type <type>")
    .option("--reference <reference>")
    .option("--ref <reference>", "alias for --reference")
    .requiredOption("--relation <relation>")
    .option("--notes <notes>")
    .option("--dry-run")
    .option("--ignore-lock")
    .option("--json")
    .action(async (id, options) => {
      const reference = options.reference ?? options.ref;
      if (!reference) command.error("required option '--reference <reference>' not specified", { exitCode: 2 });
      const result = await addTraceLink(await rootFrom(command.opts()), {
        id,
        type: options.type,
        reference,
        relation: options.relation,
        notes: options.notes,
        ...(options.dryRun ? { dryRun: true } : {}),
        ...(options.ignoreLock ? { ignoreLock: true } : {})
      });
      output(context, { json: options.json || command.opts().json }, result);
      if (!result.ok) command.setOptionValue("exitCode", 5);
    });

  command
    .command("add-requirement")
    .requiredOption("--type <type>")
    .requiredOption("--scope <scope>")
    .option("--target <target>")
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
    .option("--ignore-lock")
    .option("--json")
    .action(async (options) => {
      const statement = options.requirement ?? options.statement;
      if (!statement) {
        command.error("required option '--requirement <requirement>' or '--statement <statement>' not specified", { exitCode: 2 });
      }
      const result = await addRequirement(await rootFrom(command.opts()), {
        type: options.type,
        scope: options.scope,
        ...(typeof options.target === "string" ? { target: options.target } : {}),
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
        dryRun: Boolean(options.dryRun),
        ignoreLock: Boolean(options.ignoreLock)
      });
      output(context, { json: options.json || command.opts().json }, result);
      if (!result.ok) command.setOptionValue("exitCode", 5);
    });

  command
    .command("update-statement")
    .argument("<id>")
    .requiredOption("--text <text>", "new requirement statement body")
    .option("--dry-run")
    .option("--ignore-lock")
    .option("--json")
    .action(async (id, options) => {
      const result = await updateRequirementStatement(await rootFrom(command.opts()), {
        id,
        text: options.text,
        ...(options.dryRun ? { dryRun: true } : {})
      });
      output(context, { json: options.json || command.opts().json }, result);
      if (!result.ok) command.setOptionValue("exitCode", 5);
    });

  command
    .command("edit-ac")
    .argument("<id>")
    .argument("<acId>")
    .requiredOption("--text <text>", "new acceptance criterion text")
    .option("--dry-run")
    .option("--ignore-lock")
    .option("--json")
    .action(async (id, acId, options) => {
      const result = await editAcceptanceCriteria(await rootFrom(command.opts()), {
        id,
        acId,
        text: options.text,
        ...(options.dryRun ? { dryRun: true } : {}),
        ...(options.ignoreLock ? { ignoreLock: true } : {})
      });
      output(context, { json: options.json || command.opts().json }, result);
      if (!result.ok) command.setOptionValue("exitCode", 5);
    });

  command
    .command("add-related-doc")
    .argument("<id>")
    .requiredOption("--link <link>", "Related Docs reference to append")
    .option("--dry-run")
    .option("--json")
    .action(async (id, options) => {
      const result = await addRelatedDoc(await rootFrom(command.opts()), {
        id,
        reference: options.link,
        ...(options.dryRun ? { dryRun: true } : {})
      });
      output(context, { json: options.json || command.opts().json }, result);
      if (!result.ok) command.setOptionValue("exitCode", 5);
    });

  command
    .command("add-change-note")
    .argument("<id>")
    .requiredOption("--change <change>")
    .requiredOption("--reason <reason>")
    .option("--date <date>", "change-note date as YYYY-MM-DD (defaults to today)", parseDate)
    .option("--dry-run")
    .option("--json")
    .action(async (id, options) => {
      const result = await addChangeNote(await rootFrom(command.opts()), {
        id,
        date: typeof options.date === "string" ? options.date : new Date().toISOString().slice(0, 10),
        change: options.change,
        reason: options.reason,
        ...(options.dryRun ? { dryRun: true } : {})
      });
      output(context, { json: options.json || command.opts().json }, result);
      if (!result.ok) command.setOptionValue("exitCode", 5);
    });

  command
    .command("update-field")
    .argument("<id>")
    .requiredOption("--field <field>", "priority | risk | title | target | verification-method | type | scope")
    .requiredOption("--value <value>")
    .option("--apply", "apply a type/scope migration (still requires --confirm)")
    .option("--confirm", "confirm sign-off for a type/scope migration write")
    .option("--dry-run")
    .option("--json")
    .action(async (id, options) => {
      const dryRun = options.dryRun ? true : options.apply ? false : undefined;
      const result = await updateField(await rootFrom(command.opts()), {
        id,
        field: options.field as UpdateFieldName,
        value: options.value,
        signOff: Boolean(options.confirm),
        ...(dryRun !== undefined ? { dryRun } : {})
      });
      output(context, { json: options.json || command.opts().json }, result);
      if (!result.ok) command.setOptionValue("exitCode", 5);
    });

  command
    .command("retarget")
    .requiredOption("--from <target>", "source target whose requirements are moved")
    .requiredOption("--to <target>", "destination target")
    .requiredOption("--reason <text>")
    .option("--scope <scope>", "limit the move set to a scope prefix")
    .option("--status <status>", "limit the move set to a status")
    .option("--type <type>", "limit the move set to a requirement type")
    .option("--id <id>", "explicit requirement id to move; repeatable", pushOption, [])
    .option("--exclude <id>", "requirement id to exclude; repeatable", pushOption, [])
    .option("--apply")
    .option("--json")
    .action(async (options) => {
      const root = await rootFrom(command.opts());
      const explicitIds = collect(options.id);
      let ids: string[];
      if (explicitIds.length > 0) {
        ids = explicitIds;
      } else {
        const workspace = await parseWorkspace(root);
        const filter: RequirementFilter = {
          target: options.from,
          ...(typeof options.scope === "string" ? { scope: options.scope } : {}),
          ...(typeof options.status === "string" ? { status: options.status as RequirementStatus } : {}),
          ...(typeof options.type === "string" ? { type: options.type as RequirementType } : {})
        };
        ids = listRequirements(workspace, filter).map((record) => record.id);
      }
      const result = await retarget(root, {
        ids,
        toTarget: options.to,
        reason: options.reason,
        exclude: collect(options.exclude),
        dryRun: options.apply !== true
      });
      output(context, { json: options.json || command.opts().json }, result);
      if (!result.ok) {
        command.setOptionValue("exitCode", 5);
      } else if (result.value?.items?.some((item) => item.skipReason === "target-not-registered")) {
        command.setOptionValue("exitCode", 5);
      }
    });

  command
    .command("supersede")
    .requiredOption("--old <id>", "requirement to supersede and discard")
    .requiredOption("--new-title <title>", "successor requirement title")
    .requiredOption("--new-statement <statement>", "successor requirement statement")
    .requiredOption("--scope <scope>", "successor scope prefix")
    .option("--type <type>", "successor requirement type")
    .option("--target <target>", "successor target (defaults to Active Target)")
    .option("--successor <id>", "intended successor identity for the self-reference guard")
    .option("--ac <criterion>", "successor acceptance criterion; repeatable", pushOption, [])
    .option("--reason <text>")
    .option("--apply")
    .option("--dry-run")
    .option("--ignore-lock")
    .option("--json")
    .action(async (options) => {
      const acceptanceCriteria = collect(options.ac);
      const result = await supersedeRequirement(await rootFrom(command.opts()), {
        oldId: options.old,
        scope: options.scope,
        target: typeof options.target === "string" ? options.target : "",
        title: options.newTitle,
        statement: options.newStatement,
        acceptanceCriteria: acceptanceCriteria.length > 0 ? acceptanceCriteria : [`Successor of ${options.old}.`],
        confirmDiscardVerified: true,
        ...(typeof options.successor === "string" ? { successorId: options.successor } : {}),
        ...(typeof options.reason === "string" ? { reason: options.reason } : {}),
        dryRun: options.dryRun === true || options.apply !== true
      });
      output(context, { json: options.json || command.opts().json }, result);
      if (!result.ok) command.setOptionValue("exitCode", 5);
    });

  command
    .command("set-supersede")
    .argument("<id>")
    .option("--supersedes <id>", "write the Supersedes metadata field")
    .option("--superseded-by <id>", "write the Superseded By metadata field")
    .option("--sync-trace", "also insert the matching Trace Link row")
    .option("--dry-run")
    .option("--ignore-lock")
    .option("--json")
    .action(async (id, options) => {
      const result = await setSupersede(await rootFrom(command.opts()), {
        id,
        ...(typeof options.supersedes === "string" ? { supersedes: options.supersedes } : {}),
        ...(typeof options.supersededBy === "string" ? { supersededBy: options.supersededBy } : {}),
        ...(options.syncTrace ? { syncTrace: true } : {}),
        ...(options.dryRun ? { dryRun: true } : {}),
        ...(options.ignoreLock ? { ignoreLock: true } : {})
      });
      output(context, { json: options.json || command.opts().json }, result);
      if (!result.ok) command.setOptionValue("exitCode", 5);
    });

  command
    .command("restore")
    .argument("<id>")
    .option("--to <status>", "active status to restore to (defaults to planned)")
    .option("--reason <text>")
    .option("--dry-run")
    .option("--ignore-lock")
    .option("--json")
    .action(async (id, options) => {
      const result = await restore(await rootFrom(command.opts()), {
        id,
        reason: typeof options.reason === "string" ? options.reason : "",
        ...(typeof options.to === "string" ? { status: options.to as RequirementStatus } : {}),
        ...(options.dryRun ? { dryRun: true } : {}),
        ...(options.ignoreLock ? { ignoreLock: true } : {})
      });
      output(context, { json: options.json || command.opts().json }, result);
      if (!result.ok) command.setOptionValue("exitCode", 5);
    });

  command
    .command("sync-counts")
    .option("--apply", "rewrite the index summary count cells")
    .option("--check", "exit non-zero when count drift exists (CI gate)")
    .option("--json")
    .action(async (options) => {
      const result = await syncCounts(await rootFrom(command.opts()), { apply: Boolean(options.apply) });
      output(context, { json: options.json || command.opts().json }, result);
      if (!result.ok) {
        command.setOptionValue("exitCode", 5);
      } else if (options.check && (result.value?.cells?.length ?? 0) > 0) {
        command.setOptionValue("exitCode", 1);
      }
    });

  command
    .command("scaffold-scope")
    .argument("<name>", "scope name or name:PREFIX")
    .option("--apply", "create the scope file and register the index rows")
    .option("--dry-run")
    .option("--json")
    .action(async (name, options) => {
      const separator = name.indexOf(":");
      const scopeName = separator >= 0 ? name.slice(0, separator) : name;
      const prefix = separator >= 0 ? name.slice(separator + 1) : scopeName.slice(0, 4).toUpperCase();
      const result = await scaffoldScope(await rootFrom(command.opts()), {
        name: scopeName,
        prefix,
        apply: Boolean(options.apply) && options.dryRun !== true
      });
      output(context, { json: options.json || command.opts().json }, result);
      if (!result.ok) command.setOptionValue("exitCode", 5);
    });

  command
    .command("register-scopes")
    .option("--apply", "insert the planned Scope Map rows")
    .option("--dry-run")
    .option("--json")
    .action(async (options) => {
      const result = await registerScopes(await rootFrom(command.opts()), {
        apply: Boolean(options.apply),
        ...(options.dryRun ? { dryRun: true } : {})
      });
      output(context, { json: options.json || command.opts().json }, result);
      if (!result.ok) command.setOptionValue("exitCode", 5);
    });
}
