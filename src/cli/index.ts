import { attachInheritedOptionsHelp, buildCommand } from "./command.js";
import { registerReadCommands } from "./commands/read.js";
import { registerMutationCommands } from "./commands/mutations.js";
import { registerMcpCommand } from "./commands/mcp.js";
import { registerSkillCommands } from "./commands/skills.js";
import { fail } from "../core/result.js";
import { writeJson } from "./formatters.js";

export interface CliIo {
  stdout: NodeJS.WriteStream;
  stderr: NodeJS.WriteStream;
}

export async function main(argv: string[], io: CliIo): Promise<number> {
  const command = buildCommand({ io });
  registerReadCommands(command, { io });
  registerMutationCommands(command, { io });
  registerMcpCommand(command, { io });
  registerSkillCommands(command, { io });
  attachInheritedOptionsHelp(command);
  try {
    await command.parseAsync(argv, { from: "user" });
    return typeof command.getOptionValue("exitCode") === "number"
      ? (command.getOptionValue("exitCode") as number)
      : 0;
  } catch (error) {
    const maybeCode = error as { exitCode?: number; code?: string; message?: string };
    if (maybeCode.code === "commander.helpDisplayed" || maybeCode.code === "commander.version") {
      return 0;
    }
    const exitCode = maybeCode.exitCode === 1 || maybeCode.exitCode === undefined ? 2 : maybeCode.exitCode;
    const isCommanderUsageError = typeof maybeCode.code === "string" && maybeCode.code.startsWith("commander.");
    if (isCommanderUsageError && (argv.includes("--json") || Boolean(command.getOptionValue("json")))) {
      writeJson(io, fail("CLI_USAGE_ERROR", maybeCode.message ?? "command failed"));
      return exitCode;
    }
    if (maybeCode.message) {
      io.stderr.write(`${maybeCode.message}\n`);
    }
    return exitCode;
  }
}
