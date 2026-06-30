import { attachInheritedOptionsHelp, buildCommand } from "./command.js";
import { registerReadCommands } from "./commands/read.js";
import { registerMutationCommands } from "./commands/mutations.js";
import { registerMcpCommand } from "./commands/mcp.js";
import { registerSkillCommands } from "./commands/skills.js";
import { registerDoctorCommand } from "./commands/doctor.js";
import { registerRepairCommands } from "./commands/repair.js";
import { readRecoveryForCommand, writeCliStructuredError } from "./errors.js";

export interface CliIo {
  stdout: NodeJS.WriteStream;
  stderr: NodeJS.WriteStream;
}

function jsonMode(argv: string[], command: ReturnType<typeof buildCommand>): boolean {
  return argv.includes("--json") || Boolean(command.getOptionValue("json"));
}

function commandNameFromArgv(argv: string[]): string {
  const valueOptions = new Set(["--root", "--format", "--fields", "--target", "--status", "--type", "--scope", "--tag", "--stability", "--priority", "--related-doc", "--evidence-reference", "--trace-reference", "--limit", "--offset"]);
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index] ?? "";
    if (token === "--") break;
    if (valueOptions.has(token)) {
      index += 1;
      continue;
    }
    if (token.startsWith("-")) continue;
    return token;
  }
  return "list";
}

function classifyUnhandledError(error: { code?: string; message?: string }): { code: string; exitCode: number; recoveryCommand: string } {
  if (error.code === "ENOENT" || /docs\/spec|00\.index\.md|Could not resolve SpecKiwi project root/.test(error.message ?? "")) {
    return { code: "WORKSPACE_PARSE_ERROR", exitCode: 4, recoveryCommand: "init" };
  }
  return { code: "CLI_READ_ERROR", exitCode: 2, recoveryCommand: "validate" };
}

export async function main(argv: string[], io: CliIo): Promise<number> {
  const command = buildCommand({ io });
  registerReadCommands(command, { io });
  registerMutationCommands(command, { io });
  registerMcpCommand(command, { io });
  registerSkillCommands(command, { io });
  registerDoctorCommand(command, { io });
  registerRepairCommands(command, { io });
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
    if (isCommanderUsageError && jsonMode(argv, command)) {
      const commandName = commandNameFromArgv(argv);
      writeCliStructuredError(io, "CLI_USAGE_ERROR", maybeCode.message ?? "command failed", { recovery: readRecoveryForCommand(commandName) });
      return exitCode;
    }
    if (jsonMode(argv, command)) {
      const classified = classifyUnhandledError(maybeCode);
      writeCliStructuredError(io, classified.code, maybeCode.message ?? "command failed", { recovery: { command: classified.recoveryCommand } });
      return classified.exitCode;
    }
    if (maybeCode.message) {
      io.stderr.write(`${maybeCode.message}\n`);
    }
    return exitCode;
  }
}
