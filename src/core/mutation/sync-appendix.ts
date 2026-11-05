import path from "node:path";
import { readUtf8File } from "../fs/read-text.js";
import { applyPatchPlan, isStalePatchError } from "../patch/apply-patch.js";
import { createPatchPlan } from "../patch/patch-plan.js";
import { findHeadingMatching } from "../parser/index-parser.js";
import { parseMarkdownTable, splitTableRow } from "../parser/table.js";
import type { MutationResult, ProjectRoot, TextFile } from "../types.js";
import { mutationEnvelopeFromPlan, mutationNoopEnvelope, patchSummaryFromPlan, withMutationEnvelope } from "./envelope.js";
import { mutationFail, mutationOk } from "./guards.js";
import { withSrsMutationLock } from "./srs-lock.js";

// @req FR-NODE-253 — the appendix §3.1 Tool Summary table is generated from the tool registry and
// checked against it, so adding an MCP tool never needs a hand-written row. The registry arrives as
// an argument: this module knows the table, not the MCP server.

const APPENDIX_PATH = "docs/spec/90.appendix.md";
const SECTION_HEADING = /^## 3\. MCP Tool Reference$/;
const TABLE_HEADING = /^### 3\.1 Tool Summary$/;
const TABLE_HEADERS = ["Tool", "Mutates Files", "Purpose"];

/** One registered MCP tool as the table needs it. */
export interface ToolSummaryEntry {
  readonly name: string;
  readonly description: string;
  readonly readOnly: boolean;
}

export interface SyncAppendixInput {
  tools: readonly ToolSummaryEntry[];
  /** Rewrite the table's rows; without it the run only checks. */
  write?: boolean;
  /** Report the patch without writing. */
  dryRun?: boolean;
  ignoreLock?: boolean;
}

export interface SyncAppendixOutput {
  filePath: string;
  /** Whether the generated rows differ from the file's rows, in content or in order. */
  changed: boolean;
  written: boolean;
  rows: { file: number; generated: number };
  missing: string[];
  extra: string[];
  differing: string[];
  outOfOrder: boolean;
}

/** Code-unit order, so the table sorts the same under every locale. */
function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

/** The text up to the first `.`, `!` or `?` that ends a sentence outside a code span; the whole text when none does. */
function firstSentence(text: string): string {
  let inCode = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index] as string;
    if (char === "`") inCode = !inCode;
    else if (!inCode && ".!?".includes(char) && (index + 1 === text.length || /\s/.test(text[index + 1] as string))) return text.slice(0, index + 1);
  }
  return text;
}

/** A cell value that stays one cell on one line. */
function tableCell(text: string): string {
  return text.replace(/\s+/g, " ").trim().replace(/\|/g, "\\|");
}

/** The table rows the registry generates: one per tool, sorted by name. @req FR-NODE-253 AC-2 */
export function renderToolSummaryRows(entries: readonly ToolSummaryEntry[]): string[] {
  return [...entries]
    .sort((left, right) => compareCodeUnits(left.name, right.name))
    .map((entry) => `| \`${entry.name}\` | ${entry.readOnly ? "no" : "yes"} | ${tableCell(firstSentence(entry.description))} |`);
}

function toolNameOfRow(row: string): string {
  return (splitTableRow(row)[0] ?? "").replace(/^`|`$/g, "");
}

/** The 1-based line of the first row slot and the rows the file holds, or the reason the table cannot be used. */
function locateTable(file: TextFile): { ok: true; firstRowLine: number; rows: string[] } | { ok: false; code: string; message: string } {
  const section = findHeadingMatching(file.lines, SECTION_HEADING);
  const heading = findHeadingMatching(file.lines, TABLE_HEADING);
  const between = file.lines.slice(section + 1, heading);
  if (section < 0 || heading < section || between.some((line) => /^##\s/.test(line))) {
    return { ok: false, code: "NOT_FOUND", message: `${APPENDIX_PATH} has no "### 3.1 Tool Summary" under "## 3. MCP Tool Reference"` };
  }
  const table = parseMarkdownTable(file.lines, heading + 1);
  if (!table) return { ok: false, code: "NOT_FOUND", message: `${APPENDIX_PATH} has no table under "### 3.1 Tool Summary"` };
  if (table.headers.join("|") !== TABLE_HEADERS.join("|")) {
    return { ok: false, code: "MUTATION_DENIED", message: `Tool Summary header is [${table.headers.join(", ")}], not [${TABLE_HEADERS.join(", ")}]; nothing was written` };
  }
  return { ok: true, firstRowLine: table.startLine + 2, rows: table.rowLines.map((line) => file.lines[line - 1] as string) };
}

function compareRows(fileRows: readonly string[], generatedRows: readonly string[]): Omit<SyncAppendixOutput, "filePath" | "written"> {
  const generated = new Map(generatedRows.map((row) => [toolNameOfRow(row), row]));
  const inFile = new Map<string, string>();
  const extra: string[] = [];
  for (const row of fileRows) {
    const name = toolNameOfRow(row);
    if (!generated.has(name) || inFile.has(name)) extra.push(name);
    else inFile.set(name, row);
  }
  const missing = [...generated.keys()].filter((name) => !inFile.has(name));
  const differing = [...inFile].filter(([name, row]) => generated.get(name) !== row).map(([name]) => name);
  const fileOrder = [...inFile.keys()];
  const generatedOrder = [...generated.keys()].filter((name) => inFile.has(name));
  return {
    changed: fileRows.join("\n") !== generatedRows.join("\n"),
    rows: { file: fileRows.length, generated: generatedRows.length },
    missing,
    extra,
    differing,
    outOfOrder: fileOrder.some((name, index) => generatedOrder[index] !== name)
  };
}

/** Replaces only the rows between the common leading and trailing rows of the two lists. */
function rowsPatch(file: TextFile, firstRowLine: number, fileRows: readonly string[], generatedRows: readonly string[]) {
  let head = 0;
  while (head < fileRows.length && head < generatedRows.length && fileRows[head] === generatedRows[head]) head += 1;
  let tail = 0;
  while (tail < fileRows.length - head && tail < generatedRows.length - head && fileRows[fileRows.length - 1 - tail] === generatedRows[generatedRows.length - 1 - tail]) tail += 1;
  const startLine = firstRowLine + head;
  return createPatchPlan(file, [{ type: "replaceRange", startLine, endLine: firstRowLine + fileRows.length - tail - 1, lines: generatedRows.slice(head, generatedRows.length - tail) }]);
}

async function runSync(root: ProjectRoot, input: SyncAppendixInput, planning: boolean): Promise<MutationResult<SyncAppendixOutput>> {
  const file = await readUtf8File(path.join(root.root, APPENDIX_PATH), root.root);
  const located = locateTable(file);
  if (!located.ok) return mutationFail(located.code, located.message);
  const generatedRows = renderToolSummaryRows(input.tools);
  const comparison = compareRows(located.rows, generatedRows);
  const base = { filePath: file.relativePath, ...comparison };
  if (!planning) return mutationOk({ ...base, written: false });
  const dryRun = input.dryRun === true;
  if (!comparison.changed) {
    return withMutationEnvelope(mutationOk({ ...base, written: false }), mutationNoopEnvelope("sync_appendix", file.relativePath, dryRun), {
      filePath: file.relativePath,
      operations: 0,
      dryRun,
      preview: []
    });
  }
  const plan = rowsPatch(file, located.firstRowLine, located.rows, generatedRows);
  try {
    const applied = await applyPatchPlan(plan, { dryRun });
    return withMutationEnvelope(mutationOk({ ...base, written: applied.written }), mutationEnvelopeFromPlan("sync_appendix", plan, dryRun, applied.written), patchSummaryFromPlan(plan, dryRun));
  } catch (error) {
    if (isStalePatchError(error)) return mutationFail("STALE_PATCH", `${APPENDIX_PATH} changed while the table was being regenerated; rerun sync-appendix`);
    throw error;
  }
}

/**
 * Checks the Tool Summary rows against the registry, or with `write` rewrites them — only those rows,
 * under the SRS mutation lock as `sync-index` takes it. `dryRun` plans the patch and writes nothing.
 * @req FR-NODE-253 AC-1 AC-4
 */
export async function syncAppendix(root: ProjectRoot, input: SyncAppendixInput): Promise<MutationResult<SyncAppendixOutput>> {
  if (input.write !== true && input.dryRun !== true) return runSync(root, input, false);
  if (input.write !== true) return runSync(root, { ...input, dryRun: true }, true);
  return withSrsMutationLock(root, { operation: "sync_appendix", dryRun: input.dryRun, ignoreLock: input.ignoreLock }, () => runSync(root, input, true));
}
