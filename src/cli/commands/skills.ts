import { type Command } from "commander";
import { fail } from "../../core/result.js";
import { installSkill } from "../../core/skills/install-skill.js";
import { SKILL_AGENTS, type SkillAgent, type SkillInstallScope } from "../../core/skills/types.js";
import { resolveProjectRoot } from "../../core/project-root.js";
import type { CliContext } from "../command.js";
import { writeHuman, writeJson } from "../formatters.js";

function isSkillAgent(value: string): value is SkillAgent {
  return (SKILL_AGENTS as readonly string[]).includes(value);
}

function output(context: CliContext, commandOptions: { json?: boolean }, value: unknown): void {
  if (commandOptions.json) writeJson(context.io, value);
  else writeHuman(context.io, value);
}

function wantsJson(command: Command, options: { json?: boolean }): boolean {
  return options.json || Boolean(command.parent?.parent?.opts().json);
}

function writeUsageFailure(context: CliContext, command: Command, options: { json?: boolean }, code: string, message: string): void {
  output(context, { json: wantsJson(command, options) }, fail(code, message));
  command.parent?.parent?.setOptionValue("exitCode", 2);
}

function registerInstallAction(parent: Command, context: CliContext, alias: "install" | "add"): Command {
  return parent
    .command(alias)
    .argument("<agent>", `target coding agent: ${SKILL_AGENTS.join(" | ")}`)
    .argument("[skill]", "required skill name or all")
    .option("-g, --global", "install into the user-level skill directory")
    .option("--dest <dir>", "custom destination root; each skill is installed under <dir>/<skill>")
    .option("--category <name>", "Hermes global category (default: kiwi)")
    .option("--dry-run", "plan without copying files")
    .option("--json", "write JSON to stdout")
    .action(async (agentValue: string, selector: string | undefined, options: { global?: boolean; dest?: string; category?: string; dryRun?: boolean; json?: boolean }, command: Command) => {
      if (!isSkillAgent(agentValue)) {
        writeUsageFailure(context, command, options, "SKILL_INSTALL_UNSUPPORTED_AGENT", `agent must be one of: ${SKILL_AGENTS.join(", ")}`);
        return;
      }
      const agent = agentValue;
      if (!selector) {
        writeUsageFailure(context, command, options, "CLI_USAGE_ERROR", "missing required argument 'skill'");
        return;
      }
      if (options.global && options.dest) {
        writeUsageFailure(context, command, options, "SKILL_INSTALL_INVALID_OPTIONS", "--global and --dest cannot be used together");
        return;
      }
      const scope: SkillInstallScope = options.dest ? "custom" : options.global ? "global" : "project";
      if (options.category && !(agent === "hermes" && scope === "global")) {
        writeUsageFailure(context, command, options, "SKILL_INSTALL_INVALID_OPTIONS", "--category is only valid for Hermes global installs");
        return;
      }
      const rootOption = command.parent?.parent?.opts().root;
      const root = await resolveProjectRoot(process.cwd(), typeof rootOption === "string" ? rootOption : undefined);
      const result = await installSkill({
        projectRoot: root,
        agent,
        selector,
        scope,
        ...(typeof options.dest === "string" ? { dest: options.dest } : {}),
        ...(typeof options.category === "string" ? { category: options.category } : {}),
        dryRun: Boolean(options.dryRun)
      });
      output(context, { json: wantsJson(command, options) }, result);
      if (!result.ok) command.parent?.parent?.setOptionValue("exitCode", 5);
    });
}

export function registerSkillCommands(command: Command, context: CliContext): void {
  const skills = command.command("skills").description("Install repository-managed Kiwi skills for coding agents");
  registerInstallAction(skills, context, "install");
  registerInstallAction(skills, context, "add");
}
