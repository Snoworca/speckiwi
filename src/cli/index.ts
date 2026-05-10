import { buildCommand } from "./command.js";
import { registerReadCommands } from "./commands/read.js";
import { registerMutationCommands } from "./commands/mutations.js";
import { registerMcpCommand } from "./commands/mcp.js";

export interface CliIo {
  stdout: NodeJS.WriteStream;
  stderr: NodeJS.WriteStream;
}

export async function main(argv: string[], io: CliIo): Promise<number> {
  const command = buildCommand({ io });
  registerReadCommands(command, { io });
  registerMutationCommands(command, { io });
  registerMcpCommand(command, { io });
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
    if (maybeCode.message) {
      io.stderr.write(`${maybeCode.message}\n`);
    }
    return maybeCode.exitCode ?? 2;
  }
}
