import { normalizeDashQueryArgv } from "./dash-query-argv.js";
import { attachInheritedOptionsHelp, buildCommand } from "./command.js";
import { registerReadCommands } from "./commands/read.js";
import { registerMutationCommands } from "./commands/mutations.js";
import { registerMcpCommand } from "./commands/mcp.js";
import { registerOrchestrateCommands } from "./commands/orchestrate.js";
import { registerSkillCommands } from "./commands/skills.js";
import { registerDoctorCommand } from "./commands/doctor.js";
import { registerRepairCommands } from "./commands/repair.js";
import { registerSyncAppendixCommand } from "./commands/sync-appendix.js";
import { usageRecoveryForCommand, writeCliStructuredError } from "./errors.js";
import { attachInputJsonHelp, expandInputJsonArgv, tryRenderHelpJson } from "./input-json.js";

/**
 * The two sinks the CLI writes to. Declared as `WritableStream` rather than `WriteStream` because
 * `write` is the only member anything here calls: the narrower type additionally promises a tty's
 * `columns`, `rows` and `fd`, which nothing reads and which no in-process caller can honestly supply.
 * Over-declaring it forced every test double through a double cast and made the compiler's complaint
 * about a mismatch the tests' problem rather than this declaration's.
 */
export interface CliIo {
  stdout: NodeJS.WritableStream;
  stderr: NodeJS.WritableStream;
}

function jsonMode(argv: string[], command: ReturnType<typeof buildCommand>): boolean {
  return argv.includes("--json") || Boolean(command.getOptionValue("json"));
}

/** Where the command name sits in argv, or -1 when there is none. */
function commandIndexFromArgv(argv: string[]): number {
  const valueOptions = new Set(["--root", "--format", "--fields", "--target", "--status", "--type", "--scope", "--tag", "--stability", "--priority", "--related-doc", "--evidence-reference", "--trace-reference", "--limit", "--offset"]);
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index] ?? "";
    if (token === "--") break;
    if (valueOptions.has(token)) {
      index += 1;
      continue;
    }
    if (token.startsWith("-")) continue;
    return index;
  }
  return -1;
}

function commandNameFromArgv(argv: string[]): string {
  const index = commandIndexFromArgv(argv);
  return index < 0 ? "list" : (argv[index] as string);
}

/**
 * The command path a usage error belongs to: the command name and each subcommand token after it
 * that the command tree knows (`orchestrate run status`). Empty when the name is not a command.
 * @req IR-MCP-011 AC-6
 */
function commandPathFromArgv(argv: string[], program: ReturnType<typeof buildProgram>): string[] {
  const name = commandNameFromArgv(argv);
  const childNamed = (parent: typeof program, token: string) =>
    parent.commands.find((child) => child.name() === token || child.aliases().includes(token));
  let current = childNamed(program, name);
  if (!current) return [];
  const path = [current.name()];
  for (let index = commandIndexFromArgv(argv) + 1; index < argv.length; index += 1) {
    const next = childNamed(current, argv[index] ?? "");
    if (!next) break;
    current = next;
    path.push(next.name());
  }
  return path;
}

/** System calls that only change the filesystem; a failure in one is a write failure, never a read or parse one. */
const FILESYSTEM_WRITE_SYSCALLS: ReadonlySet<string> = new Set(["rename", "write", "unlink", "rmdir", "mkdir", "copyfile"]);

interface UnhandledError {
  code?: string;
  message?: string;
  syscall?: string;
  cause?: { syscall?: string };
}

/** A failed filesystem write, either the error itself or the write a failed restore was answering. */
function isFilesystemWriteError(error: UnhandledError): boolean {
  const syscall = error.syscall ?? error.cause?.syscall;
  return syscall !== undefined && FILESYSTEM_WRITE_SYSCALLS.has(syscall);
}

function classifyUnhandledError(error: UnhandledError): { code: string; exitCode: number; recoveryCommand: string } {
  // @req FR-ARCH-002 AC-3 — no root found exits 2 in every output mode.
  if ((error.message ?? "").startsWith("Could not resolve SpecKiwi project root")) {
    return { code: "PROJECT_ROOT_NOT_FOUND", exitCode: 2, recoveryCommand: "init" };
  }
  // @req FR-NODE-279 AC-4 — a write that failed names its path in the message; calling it a workspace
  // parse error, because that path is 00.index.md, sent the user to `init` for a read-only file.
  if (isFilesystemWriteError(error)) {
    return { code: "FILESYSTEM_WRITE_ERROR", exitCode: 5, recoveryCommand: "validate" };
  }
  if (error.code === "ENOENT" || /docs\/spec|00\.index\.md/.test(error.message ?? "")) {
    return { code: "WORKSPACE_PARSE_ERROR", exitCode: 4, recoveryCommand: "init" };
  }
  return { code: "CLI_READ_ERROR", exitCode: 2, recoveryCommand: "validate" };
}

/** The whole command tree `main` parses with, every registrar and help decoration applied. */
export function buildProgram(io: CliIo): ReturnType<typeof buildCommand> {
  const command = buildCommand({ io });
  registerReadCommands(command, { io });
  registerMutationCommands(command, { io });
  registerMcpCommand(command, { io });
  registerSkillCommands(command, { io });
  registerDoctorCommand(command, { io });
  registerRepairCommands(command, { io });
  // @req FR-NODE-253 — a CLI-only maintenance command, registered outside the read and mutation
  // registrars because it has no ToolSpec row and no MCP tool.
  registerSyncAppendixCommand(command, { io });
  // @req IR-CLI-082 — the orchestrate namespace, registered exactly as `workflow` is.
  registerOrchestrateCommands(command, { io });
  attachInheritedOptionsHelp(command);
  // @req IR-CLI-117
  attachInputJsonHelp(command);
  return command;
}

export async function main(argv: string[], io: CliIo): Promise<number> {
  const command = buildProgram(io);
  if (tryRenderHelpJson(argv, io, command)) return 0;
  try {
    argv = normalizeDashQueryArgv(await expandInputJsonArgv([...argv], command), command);
  } catch (error) {
    const message = (error as { message?: string }).message ?? "invalid --input-json payload";
    if (jsonMode(argv, command)) {
      writeCliStructuredError(io, "CLI_USAGE_ERROR", message, { recovery: usageRecoveryForCommand(commandPathFromArgv(argv, command)) });
    } else {
      io.stderr.write(`${message}\n`);
    }
    return 2;
  }
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
      writeCliStructuredError(io, "CLI_USAGE_ERROR", maybeCode.message ?? "command failed", { recovery: usageRecoveryForCommand(commandPathFromArgv(argv, command)) });
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
