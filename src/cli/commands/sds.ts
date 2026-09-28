import type { Command } from "commander";
import { parseWorkspace } from "../../core/parser/workspace-parser.js";
import { resolveProjectRoot } from "../../core/project-root.js";
import { checkSdsFile, type SdsCheckReport } from "../../core/sds/check-sds.js";
import type { Diagnostic } from "../../core/types.js";
import type { CliContext } from "../command.js";
import { writeCliStructuredError } from "../errors.js";
import { writeJson } from "../formatters.js";

// @req IR-CLI-102 — `speckiwi sds check <path> [--json]`: one lite SDS file's diagnostics and parsed
// summary, exiting non-zero while an error-level diagnostic remains.

const FAILURE_EXIT: Readonly<Record<string, number>> = { NOT_FOUND: 5, TARGET_NOT_FOUND: 5, USAGE: 2 };

/**
 * Ends a read command on a refused input: a structured error under `--json`, a commander error
 * otherwise, with the exit code the read family uses for that refusal (2 usage, 5 not found).
 */
export function failRead(command: Command, context: CliContext, json: boolean, error: { code: string; message: string }): void {
  const exitCode = FAILURE_EXIT[error.code] ?? 1;
  if (!json) command.error(error.message, { exitCode });
  writeCliStructuredError(context.io, error.code, error.message);
  command.setOptionValue("exitCode", exitCode);
}

function location(diagnostic: Diagnostic): string {
  if (diagnostic.filePath && typeof diagnostic.line === "number") return `${diagnostic.filePath}:${diagnostic.line}`;
  return diagnostic.filePath ?? "-";
}

function listed(values: readonly string[]): string {
  return values.length === 0 ? "-" : values.join(", ");
}

function formatReport(report: SdsCheckReport): string {
  const { summary } = report;
  const count = (n: number, word: string): string => `${n} ${word}${n === 1 ? "" : "s"}`;
  return [
    `SDS ${report.path}: ${count(report.errors.length, "error")}, ${count(report.warnings.length, "warning")}`,
    ...report.diagnostics.map((item) => `${item.severity} ${item.code} ${location(item)} ${item.message}`),
    `Target: ${summary.target ?? "-"}  Status: ${summary.status ?? "-"}`,
    `Files: ${listed(summary.files)}`,
    `Test files: ${listed(summary.testFiles)}`,
    `Requirements: ${listed(summary.requirementIds)}`,
    `SDS-ACs: ${listed(summary.sdsAcs.map((ac) => `${ac.id} (${ac.requirementId ?? "?"} ${ac.acId ?? "?"}) → ${listed(ac.targets)}`))}`,
    `Depends: ${listed(summary.depends.map((chain) => chain.map((layer) => layer.join(", ")).join(" → ")))}`
  ].join("\n");
}

export function registerSdsCommands(command: Command, context: CliContext): void {
  const sds = command.command("sds").description("lite-profile SDS documents under docs/sds");
  sds
    .command("check")
    .description("check one lite SDS file and print its diagnostics and parsed summary")
    .argument("<path>", "SDS file, relative to the project root")
    .option("--json", "JSON output")
    .action(async (sdsPath: string, options: { json?: boolean }) => {
      const json = Boolean(options.json) || Boolean(command.opts().json);
      const workspace = await parseWorkspace(await resolveProjectRoot(process.cwd(), command.opts().root));
      const result = await checkSdsFile(workspace, sdsPath);
      if (!result.ok) {
        failRead(command, context, json, result.error);
        return;
      }
      if (json) writeJson(context.io, result.value);
      else context.io.stdout.write(`${formatReport(result.value)}\n`);
      if (!result.value.passed) command.setOptionValue("exitCode", 1);
    });
}
