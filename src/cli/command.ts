import { createRequire } from "node:module";
import { Command } from "commander";
import type { CliIo } from "./index.js";

export interface CliContext {
  io: CliIo;
}

export type CliCommandRegistrar = (command: Command, context: CliContext) => void;

const requirePackage = createRequire(import.meta.url);
const { version: PACKAGE_VERSION } = requirePackage("../../package.json") as { version: string };

const INHERITED_OPTIONS_HELP = [
  "",
  "Global options:",
  "  --root <path>     project root",
  "  --json            write JSON to stdout",
  "  --no-color        disable color",
  "  --quiet           suppress non-essential human output"
].join("\n");

// IR-CLI-045 AC-9: mcp 는 --root 를 지원하지 않으므로 help 에서 안내하지 않는다.
const INHERITED_OPTIONS_HELP_NO_ROOT = [
  "",
  "Global options:",
  "  --json            write JSON to stdout",
  "  --no-color        disable color",
  "  --quiet           suppress non-essential human output"
].join("\n");

export function buildCommand(context: CliContext, registrars: CliCommandRegistrar[] = []): Command {
  const command = new Command();
  command
    .name("speckiwi")
    .description("Markdown SRS CLI and MCP server")
    .version(PACKAGE_VERSION)
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

export function attachInheritedOptionsHelp(program: Command): void {
  function decorate(parent: Command): void {
    for (const sub of parent.commands) {
      sub.addHelpText("after", sub.name() === "mcp" ? INHERITED_OPTIONS_HELP_NO_ROOT : INHERITED_OPTIONS_HELP);
      decorate(sub);
    }
  }
  decorate(program);
}
