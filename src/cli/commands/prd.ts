import type { Command } from "commander";
import { parseWorkspace } from "../../core/parser/workspace-parser.js";
import { resolveProjectRoot } from "../../core/project-root.js";
import type { PrdCoverageReport } from "../../core/prd/coverage.js";
import {
  checkPrdFile,
  listPrdFileItems,
  PRD_CURSOR_ACTIONS,
  prdFileCoverage,
  readPrdFileItem,
  runPrdCursor,
  searchPrdFiles,
  type PrdCheckReport
} from "../../core/prd/files.js";
import type { Result } from "../../core/result.js";
import type { CliContext } from "../command.js";
import { writeHuman, writeJson } from "../formatters.js";
import { integerOption } from "../option-parsers.js";
import { failRead } from "./sds.js";

// @req FR-NODE-240 FR-NODE-241 FR-NODE-242 — `speckiwi prd <check|items|show|search|cursor|coverage>`:
// the PRD readers and the verdict cursor over `docs/prd/*.prd.md`. Every subcommand answers from the
// same core as its MCP tool, so `--json` prints exactly the tool's value.

function collect(value: string, previous: string[]): string[] {
  return [...previous, value];
}

function formatCheck(report: PrdCheckReport): string {
  const { errors, warnings } = report.diagnosticsSummary;
  return [
    `PRD ${report.prd}: ${errors} error${errors === 1 ? "" : "s"}, ${warnings} warning${warnings === 1 ? "" : "s"}`,
    ...report.diagnostics.map((item) => `${item.severity} ${item.code} ${item.filePath ?? "-"}:${item.line ?? "-"} ${item.message}`)
  ].join("\n");
}

function formatCoverage(report: PrdCoverageReport): string {
  const listed = (lines: string[]) => (lines.length === 0 ? ["  -"] : lines.map((line) => `  ${line}`));
  return [
    `PRD ${report.prd}, target ${report.target}`,
    "Items no requirement or criterion cites:",
    ...listed(report.uncitedItems.map((item) => `${item.id} (${item.kind}) ${item.title}`)),
    "Requirements that cite no PRD item:",
    ...listed(report.uncitedRequirements.map((item) => `${item.requirementId} ${item.title}`)),
    "Criteria with neither a PRD citation nor a fills: basis:",
    ...listed(report.ungroundedCriteria.map((item) => `${item.requirementId} ${item.criterionId} ${item.text}`)),
    report.notJudged
  ].join("\n");
}

export function registerPrdCommands(command: Command, context: CliContext): void {
  const projectRoot = () => resolveProjectRoot(process.cwd(), command.opts().root);
  const root = async () => (await projectRoot()).root;
  const isJson = (options: { json?: boolean }) => Boolean(options.json) || Boolean(command.opts().json);

  /** Prints a result: its value as JSON or through `human`, or the refusal with the read family's exit code. */
  function answer<T>(options: { json?: boolean }, result: Result<T>, human?: (value: T) => string): boolean {
    const json = isJson(options);
    if (!result.ok) {
      failRead(command, context, json, result.error);
      return false;
    }
    if (json) writeJson(context.io, result.value);
    else writeHuman(context.io, human ? human(result.value) : result.value);
    return true;
  }

  const prd = command.command("prd").description("PRD files under docs/prd: check, items, search, the verdict cursor and coverage");

  prd
    .command("check")
    .description("check one PRD file against the kiwi-prd grammar; exits 1 while an error remains")
    .argument("<path>", "PRD file, e.g. docs/prd/<date>.<slug>.prd.md")
    .option("--json", "JSON output")
    .action(async (prdPath: string, options: { json?: boolean }) => {
      const result = await checkPrdFile(await root(), prdPath);
      if (answer(options, result, formatCheck) && result.ok && !result.value.passed) command.setOptionValue("exitCode", 1);
    });

  prd
    .command("items")
    .description("list a PRD's items in document order")
    .argument("<path>", "PRD file")
    .option("--offset <n>", "items to skip", integerOption(0))
    .option("--limit <n>", "most items to return", integerOption(1))
    .option("--json", "JSON output")
    .action(async (prdPath: string, options: { offset?: number; limit?: number; json?: boolean }) => {
      answer(options, await listPrdFileItems(await root(), prdPath, { offset: options.offset, limit: options.limit }));
    });

  prd
    .command("show")
    .description("read one PRD item with its kind, quote, source and the PRD pointer")
    .argument("<path>", "PRD file")
    .argument("<id>", "item ID, e.g. PRD-3")
    .option("--json", "JSON output")
    .action(async (prdPath: string, id: string, options: { json?: boolean }) => {
      answer(options, await readPrdFileItem(await root(), prdPath, id));
    });

  prd
    .command("search")
    .description("rank PRD items for a query with the requirement search index; reads every PRD under docs/prd unless --file names one")
    .argument("<query>")
    .option("--file <path>", "search only this PRD file")
    .option("--offset <n>", "hits to skip", integerOption(0))
    .option("--limit <n>", "most hits to return (default 20)", integerOption(1))
    .option("--json", "JSON output")
    .action(async (query: string, options: { file?: string; offset?: number; limit?: number; json?: boolean }) => {
      answer(options, await searchPrdFiles(await root(), query, { path: options.file, offset: options.offset, limit: options.limit }));
    });

  prd
    .command("cursor")
    .description("walk a PRD's items, or a target's requirements, one verdict at a time; next and reset append to kiwi/prd/<run-id>.jsonl")
    .argument("<action>", PRD_CURSOR_ACTIONS.join(" | "))
    .argument("<path>", "PRD file")
    .requiredOption("--run-id <id>", "lower-case run ID; names the ledger kiwi/prd/<run-id>.jsonl")
    .option("--direction <direction>", "prd-to-srs (the PRD items, default) or srs-to-prd (the target's requirements and criteria)")
    .option("--target <target>", "the target srs-to-prd walks")
    .option("--verdict <verdict>", "next: the verdict for the current item; skip one only with deferred and --note")
    .option("--note <text>", "next: why, required for deferred")
    .option("--ref <ref>", "next: a requirement or item the verdict rests on (repeatable)", collect, [])
    .option("--index <n>", "seek: the 1-based item to show", integerOption(1))
    .option("--json", "JSON output")
    .action(async (action: string, prdPath: string, options: { runId: string; direction?: string; target?: string; verdict?: string; note?: string; ref: string[]; index?: number; json?: boolean }) => {
      const workspace = await parseWorkspace(await projectRoot());
      const result = await runPrdCursor(workspace, {
        action,
        path: prdPath,
        runId: options.runId,
        ...(options.direction !== undefined ? { direction: options.direction } : {}),
        ...(options.target !== undefined ? { target: options.target } : {}),
        ...(options.verdict !== undefined ? { verdict: options.verdict } : {}),
        ...(options.note !== undefined ? { note: options.note } : {}),
        ...(options.ref.length > 0 ? { refs: options.ref } : {}),
        ...(options.index !== undefined ? { index: options.index } : {})
      });
      answer(options, result);
    });

  prd
    .command("coverage")
    .description("list the PRD items a target's SRS does not cite, and the requirements and criteria that cite no item")
    .argument("<path>", "PRD file")
    .requiredOption("--target <target>", "the target whose requirements are compared")
    .option("--json", "JSON output")
    .action(async (prdPath: string, options: { target: string; json?: boolean }) => {
      const workspace = await parseWorkspace(await projectRoot());
      answer(options, await prdFileCoverage(workspace, prdPath, options.target), formatCoverage);
    });
}
