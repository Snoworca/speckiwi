import type { Command } from "commander";
import { exportMarkdown } from "../../core/export-markdown.js";
import type { ExportMarkdownInput } from "../../core/inputs.js";
import { addCommonOptions, executeCliCommand, optionalString, splitComma } from "../options.js";
import { mapCoreResultToExitCode, type CliExitCode, exitCodes } from "../exit-code.js";

export function registerExportCommand(program: Command): void {
  const exportCommand = program.command("export").description("export generated artifacts");

  const markdown = addCommonOptions(exportCommand.command("markdown").description("export YAML source documents to Markdown"))
    .option("--out <path>", "output root")
    .option("--type <type>", "overview, srs, prd, technical, or adr")
    .option("--document <id>", "document id")
    .option("--strict", "abort before writing when validation errors exist");

  markdown.action(() =>
    executeCliCommand(
      markdown,
      async (context) => {
        const input: ExportMarkdownInput = {
          root: context.root,
          cacheMode: context.cacheMode
        };
        const outputRoot = optionalString(markdown.opts().out);
        const type = splitComma(markdown.opts().type);
        const documentId = splitComma(markdown.opts().document);
        if (outputRoot !== undefined) {
          input.outputRoot = outputRoot;
        }
        if (type !== undefined) {
          input.type = type;
        }
        if (documentId !== undefined) {
          input.documentId = documentId;
        }
        if (markdown.opts().strict === true) {
          input.strict = true;
        }
        return exportMarkdown(input);
      },
      { exitCode: exportExitCode }
    )
  );
}

function exportExitCode(result: unknown): CliExitCode {
  if (isObject(result) && result.ok === true && Array.isArray(result.writtenFiles)) {
    return exitCodes.success;
  }
  return mapCoreResultToExitCode(result);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
