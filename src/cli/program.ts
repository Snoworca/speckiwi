import { Command } from "commander";
import { initWorkspace } from "../core/init.js";
import { validateWorkspace } from "../core/validate.js";
import { doctor } from "../core/doctor.js";
import { cleanCache, rebuildCache } from "../core/cache.js";
import { doctorExitCode, validationExitCode } from "./exit-code.js";
import { addCommonOptions, CliExit, executeCliCommand } from "./options.js";
import type { InitInput } from "../core/inputs.js";
import { registerGraphCommand } from "./commands/graph.js";
import { registerImpactCommand } from "./commands/impact.js";
import { registerListCommands } from "./commands/list.js";
import { registerMcpCommand } from "./commands/mcp.js";
import { registerOverviewCommand } from "./commands/overview.js";
import { registerRequirementCommands } from "./commands/req.js";
import { registerSearchCommand } from "./commands/search.js";
import { registerExportCommand } from "./commands/export.js";

export function buildProgram(): Command {
  const program = addCommonOptions(new Command())
    .name("speckiwi")
    .description("Validate and query local SpecKiwi YAML knowledge graphs.")
    .version("0.1.0")
    .helpCommand(false)
    .showHelpAfterError();

  const init = addCommonOptions(program.command("init").description("initialize a SpecKiwi workspace"))
    .option("--project-id <id>", "project id")
    .option("--project-name <name>", "project name")
    .option("--language <language>", "project language")
    .option("--force", "skip files that already exist");
  init.action(() =>
    executeCliCommand(
      init,
      async (context) => {
        const input: InitInput = {
          root: context.root,
          cacheMode: context.cacheMode,
          force: init.opts().force === true
        };
        const projectId = stringOption(init.opts().projectId);
        const projectName = stringOption(init.opts().projectName);
        const language = stringOption(init.opts().language);
        if (projectId !== undefined) {
          input.projectId = projectId;
        }
        if (projectName !== undefined) {
          input.projectName = projectName;
        }
        if (language !== undefined) {
          input.language = language;
        }
        return initWorkspace(input);
      },
      { resolveWorkspace: false }
    )
  );

  const validate = addCommonOptions(program.command("validate").description("validate workspace YAML"));
  validate.action(() =>
    executeCliCommand(validate, async (context) => validateWorkspace(context), { exitCode: validationExitCode })
  );

  const doctorCommand = addCommonOptions(program.command("doctor").description("check local runtime and workspace health"));
  doctorCommand.action(() =>
    executeCliCommand(doctorCommand, async (context) => doctor(context), {
      resolveWorkspace: false,
      exitCode: doctorExitCode
    })
  );

  registerOverviewCommand(program);
  registerListCommands(program);
  registerSearchCommand(program);
  registerRequirementCommands(program);
  registerGraphCommand(program);
  registerImpactCommand(program);
  registerExportCommand(program);
  registerCacheCommands(program);
  registerMcpCommand(program);

  return program;
}

export async function runCli(argv: string[], env: NodeJS.ProcessEnv = process.env): Promise<number> {
  const program = buildProgram();
  program.exitOverride();

  if (argv.length === 0) {
    program.outputHelp();
    return 0;
  }

  try {
    await program.parseAsync(argv, { from: "user" });
    return 0;
  } catch (error) {
    if (error instanceof CliExit) {
      return error.exitCode;
    }

    if (isCommanderError(error)) {
      return error.exitCode;
    }

    if (env.SPECKIWI_DEBUG === "1") {
      console.error(error);
    } else {
      const message = error instanceof Error ? error.message : String(error);
      console.error(message);
    }
    return 1;
  }
}

function registerCacheCommands(program: Command): void {
  const cache = program.command("cache").description("cache commands");
  const rebuild = addCommonOptions(cache.command("rebuild").description("rebuild generated cache files"));
  rebuild.action(() => executeCliCommand(rebuild, async (context) => rebuildCache(context)));

  const clean = addCommonOptions(cache.command("clean").description("remove generated cache files"));
  clean.action(() => executeCliCommand(clean, async (context) => cleanCache(context)));
}

function stringOption(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function isCommanderError(error: unknown): error is { code: string; exitCode: number } {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    "exitCode" in error &&
    typeof (error as { exitCode: unknown }).exitCode === "number"
  );
}
