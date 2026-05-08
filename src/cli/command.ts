import { Command } from "commander";
import type { CliIo } from "./index.js";

export interface CliContext {
  io: CliIo;
}

export type CliCommandRegistrar = (command: Command, context: CliContext) => void;

export function buildCommand(context: CliContext, registrars: CliCommandRegistrar[] = []): Command {
  const command = new Command();
  command
    .name("speckiwi")
    .description("Markdown SRS CLI and MCP server")
    .version("1.0.0")
    .exitOverride()
    .configureOutput({
      writeOut: (text) => context.io.stdout.write(text),
      writeErr: (text) => context.io.stderr.write(text)
    })
    .option("--root <path>", "project root")
    .option("--json", "write JSON to stdout")
    .option("--no-color", "disable color")
    .option("--quiet", "suppress non-essential human output");
  for (const registrar of registrars) registrar(command, context);
  return command;
}
