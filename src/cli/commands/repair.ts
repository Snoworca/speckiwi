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
  type RequirementOccurrenceIdentity
} from "../../core/mutation/repair-requirement-id.js";
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

function parseReferenceEdit(value: string): { filePath: string; line: number; from: string; to: string } {
  const parsed = JSON.parse(value) as Partial<{ filePath: string; line: number; from: string; to: string }>;
  if (typeof parsed.filePath !== "string" || typeof parsed.line !== "number" || typeof parsed.from !== "string" || typeof parsed.to !== "string") {
    throw new Error("reference-edit must be JSON with filePath, line, from, and to");
  }
  return { filePath: parsed.filePath, line: parsed.line, from: parsed.from, to: parsed.to };
}

function collectReferenceEdit(value: string, previous: Array<{ filePath: string; line: number; from: string; to: string }>): Array<{ filePath: string; line: number; from: string; to: string }> {
  previous.push(parseReferenceEdit(value));
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
    referenceEdits: Array.isArray(options.referenceEdit) ? (options.referenceEdit as Array<{ filePath: string; line: number; from: string; to: string }>) : []
  };
}

export function registerRepairCommands(command: Command, context: CliContext): void {
  const repair = command.command("repair");
  const collisions = repair.command("requirement-id-collisions");

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
    .option("--reference-edit <json>", "explicit mapped reference edit; repeatable", collectReferenceEdit, [])
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
    .option("--ignore-lock")
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
