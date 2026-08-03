import { type Command } from "commander";
import { fail, ok } from "../../core/result.js";
import { installSkill } from "../../core/skills/install-skill.js";
import { mirrorSkills } from "../../core/skills/mirror-skills.js";
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
    .argument("<skill>", "skill name, or all")
    .option("-g, --global", "install into the user-level skill directory")
    .option("--dest <dir>", "custom destination root, resolved against the project root when relative; each skill is installed under <dir>/<skill>")
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
        // @req IR-CLI-086 AC-1 — without this the service resolved the codex global root from the
        // home directory while `init --global` and `doctor` both read CODEX_HOME, so the three entry
        // points disagreed about where a global install lands.
        env: process.env,
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

/**
 * @req FR-NODE-105 — the sanctioned writer for `.agents/skills/**` (05 §9.5), and neither `init` nor
 * `skills install`, so `00.charter.md:303-304`'s prohibition is untouched.
 *
 * The mode is required and the two modes are mutually exclusive. `--write` is the destructive branch,
 * so a bare `speckiwi skills mirror` fails immediately rather than regenerating the tree; defaulting
 * to `--check` would be safe today but would leave `--write` reachable by a dropped flag the day the
 * default changed. An explicit mode keeps regeneration an act of intent.
 */
function registerMirrorAction(parent: Command, context: CliContext): Command {
  return parent
    .command("mirror")
    .description("Regenerate or verify .agents/skills/** against skills/codex/**")
    .option("--check", "report divergence without writing any file")
    .option("--write", "regenerate the mirror from skills/codex")
    .option("--json", "write JSON to stdout")
    .action(async (options: { check?: boolean; write?: boolean; json?: boolean }, command: Command) => {
      if (options.check && options.write) {
        writeUsageFailure(context, command, options, "SKILLS_MIRROR_MODE_CONFLICT", "--check and --write cannot be used together");
        return;
      }
      if (!options.check && !options.write) {
        writeUsageFailure(context, command, options, "SKILLS_MIRROR_MODE_REQUIRED", "one of --check or --write is required");
        return;
      }
      const rootOption = command.parent?.parent?.opts().root;
      const root = await resolveProjectRoot(process.cwd(), typeof rootOption === "string" ? rootOption : undefined);
      const result = await mirrorSkills({ projectRoot: root.root, mode: options.write ? "write" : "check" });
      const json = wantsJson(command, options);
      if (result.ok) {
        output(context, { json }, ok(result));
        return;
      }
      output(context, { json }, fail("SKILLS_MIRROR_DIVERGENT", `${result.divergences.length} mirrored path(s) diverge from skills/codex; run \`speckiwi skills mirror --write\``));
      command.parent?.parent?.setOptionValue("exitCode", 5);
    });
}

export function registerSkillCommands(command: Command, context: CliContext): void {
  const skills = command.command("skills").description("Install repository-managed Kiwi skills for coding agents");
  registerInstallAction(skills, context, "install");
  registerInstallAction(skills, context, "add");
  registerMirrorAction(skills, context);
}
