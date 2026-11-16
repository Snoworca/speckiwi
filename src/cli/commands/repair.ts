import { SAFETY_BYPASS_OPTION_HELP } from "../safety-bypass-options.js";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import type { Command } from "commander";
import { resolveProjectRoot } from "../../core/project-root.js";
import {
  applyRequirementIdCollisionRepair,
  diagnoseRequirementIdCollisions,
  planRequirementIdCollisionRepair,
  readRequirementIdCollisionRepairPlan,
  writeRequirementIdCollisionRepairPlan,
  type RequirementIdCollisionRepairPlanInput,
  keepReferencesFromInput,
  referenceEditsFromInput,
  type RequirementKeepReference,
  type RequirementReferenceEdit,
  type RequirementOccurrenceIdentity
} from "../../core/mutation/repair-requirement-id.js";
import { repairRulesReferences } from "../../core/mutation/repair-rules-references.js";
import type { CliContext } from "../command.js";
import { writeHuman, writeJson } from "../formatters.js";

function output(context: CliContext, commandOptions: { json?: boolean }, value: unknown): void {
  if (commandOptions.json) writeJson(context.io, value);
  else writeHuman(context.io, value);
}

function parseOccurrence(value: string, command: Command): RequirementOccurrenceIdentity {
  const parts = value.split(":");
  if (parts.length < 3) command.error("occurrence must use <file:line:blockHash>", { exitCode: 2 });
  const blockHash = parts.pop() ?? "";
  const line = Number(parts.pop());
  const filePath = parts.join(":");
  if (!filePath || !Number.isInteger(line) || line <= 0 || !blockHash) command.error("occurrence must use <file:line:blockHash>", { exitCode: 2 });
  return { filePath, headingLine: line, blockHash };
}

function collectReferenceEdit(value: string, previous: RequirementReferenceEdit[]): RequirementReferenceEdit[] {
  const [edit] = referenceEditsFromInput([JSON.parse(value)]);
  if (!edit) throw new Error("reference-edit must be JSON with filePath, line, from, to and an optional occurrence (\"all\" or a match number)");
  previous.push(edit);
  return previous;
}

/** @req FR-NODE-317 AC-6 */
function collectKeepReference(value: string, previous: RequirementKeepReference[]): RequirementKeepReference[] {
  const [keep] = keepReferencesFromInput([JSON.parse(value)]);
  if (!keep) throw new Error("keep-reference must be JSON with filePath and line");
  previous.push(keep);
  return previous;
}

function workspaceRelativeFile(rootPath: string, value: string, command: Command): string {
  const normalized = value.replace(/\\/g, "/");
  if (path.isAbsolute(normalized) || normalized.split("/").includes("..") || normalized.length === 0) {
    command.error("plan path must be a workspace-relative path without traversal", { exitCode: 2 });
  }
  return path.join(rootPath, normalized);
}

async function rootFrom(command: Command): Promise<string> {
  return (await resolveProjectRoot(process.cwd(), command.opts().root)).root;
}

function inputFromOptions(options: Record<string, unknown>, command: Command): RequirementIdCollisionRepairPlanInput {
  if (typeof options.duplicateId !== "string") command.error("duplicate-id is required", { exitCode: 2 });
  if (typeof options.keep !== "string") command.error("keep is required", { exitCode: 2 });
  if (typeof options.rename !== "string") command.error("rename is required", { exitCode: 2 });
  if (typeof options.replacementId !== "string" && options.allocateNext !== true) command.error("replacement-id or --allocate-next is required", { exitCode: 2 });
  return {
    duplicateId: options.duplicateId,
    keep: parseOccurrence(options.keep, command),
    rename: parseOccurrence(options.rename, command),
    ...(typeof options.replacementId === "string" ? { replacementId: options.replacementId } : { allocationStrategy: "next_available" as const }),
    referenceEdits: Array.isArray(options.referenceEdit) ? (options.referenceEdit as RequirementReferenceEdit[]) : [],
    keepReferences: Array.isArray(options.keepReference) ? (options.keepReference as RequirementKeepReference[]) : []
  };
}

export function registerRepairCommands(command: Command, context: CliContext): void {
  const repair = command.command("repair");
  const collisions = repair.command("requirement-id-collisions");

  // @req IR-CLI-079 — a dangling `Related Docs` link to a renamed rules document. It lives here
  // rather than in `upgrade`, which excludes docs/spec by contract, or in edit_requirement_fields,
  // which refuses verified requirements. CLI-only: it writes inside requirement blocks.
  const rulesReferences = repair.command("rules-references");
  for (const [leaf, apply] of [
    ["diagnose", false],
    ["apply", true]
  ] as const) {
    rulesReferences
      .command(leaf)
      .option("--ignore-lock", SAFETY_BYPASS_OPTION_HELP.mutationLock)
      .option("--json")
      .action(async (options) => {
        const result = await repairRulesReferences(await resolveProjectRoot(process.cwd(), command.opts().root), {
          ...(apply ? { apply: true } : {}),
          ...(options.ignoreLock ? { ignoreLock: true } : {})
        });
        output(context, { json: options.json || command.opts().json }, result);
        if (!result.ok) command.setOptionValue("exitCode", 5);
      });
  }

  collisions.command("diagnose").option("--json").action(async (options) => {
    const result = await diagnoseRequirementIdCollisions(await resolveProjectRoot(process.cwd(), command.opts().root));
    output(context, { json: options.json || command.opts().json }, result);
  });

  collisions
    .command("plan")
    .requiredOption("--duplicate-id <id>")
    .requiredOption("--keep <file:line:blockHash>")
    .requiredOption("--rename <file:line:blockHash>")
    .option("--replacement-id <id>")
    .option("--allocate-next")
    .option("--reference-edit <json>", 'explicit mapped reference edit {filePath, line, from, to, occurrence?: "all" | n}; to swaps the duplicate id only; repeatable', collectReferenceEdit, [])
    .option("--keep-reference <json>", "line {filePath, line} confirmed as naming the kept occurrence; repeatable", collectKeepReference, [])
    .option("--write-plan <path>")
    .option("--json")
    .action(async (options) => {
      const rootPath = await rootFrom(command);
      const result = await planRequirementIdCollisionRepair({ root: rootPath }, inputFromOptions(options, collisions));
      if (result.ok && result.value && typeof options.writePlan === "string") {
        const planPath = workspaceRelativeFile(rootPath, options.writePlan, collisions);
        await mkdir(path.dirname(planPath), { recursive: true });
        await writeRequirementIdCollisionRepairPlan(planPath, result.value);
      }
      output(context, { json: options.json || command.opts().json }, result);
      if (!result.ok) command.setOptionValue("exitCode", 5);
    });

  collisions
    .command("apply")
    .requiredOption("--plan <path>")
    .option("--dry-run")
    .option("--ignore-lock", SAFETY_BYPASS_OPTION_HELP.mutationLock)
    .option("--json")
    .action(async (options) => {
      const rootPath = await rootFrom(command);
      const planPath = workspaceRelativeFile(rootPath, String(options.plan), collisions);
      const input = await readRequirementIdCollisionRepairPlan(planPath);
      const result = await applyRequirementIdCollisionRepair(
        { root: rootPath },
        {
          ...input,
          ...(options.dryRun ? { dryRun: true } : {}),
          ...(options.ignoreLock ? { ignoreLock: true } : {})
        }
      );
      output(context, { json: options.json || command.opts().json }, result);
      if (!result.ok) command.setOptionValue("exitCode", 5);
    });
}
