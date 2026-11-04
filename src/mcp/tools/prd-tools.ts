import { parseWorkspace } from "../../core/parser/workspace-parser.js";
import { resolveProjectRoot } from "../../core/project-root.js";
import {
  checkPrdFile,
  listPrdFileItems,
  prdFileCoverage,
  readPrdFileItem,
  runPrdCursor,
  searchPrdFiles,
  type PrdCursorRequest
} from "../../core/prd/files.js";
import { z } from "zod";
import type { Result } from "../../core/result.js";
import type { McpDependencies, McpServerHandle } from "../adapter.js";
import { mcpSuccess, resultToMcp } from "../errors.js";
import { missingRequiredArguments } from "../required-args.js";

// @req FR-NODE-240 FR-NODE-241 FR-NODE-242 — the PRD tools answer from the same core as `speckiwi prd`,
// so each value is the CLI's `--json` output. They read the startup root only: none declares a
// workspace scope, so a per-call workspaceRoot is refused at the gate.

/**
 * The input schemas of the PRD tools, the one place their arguments are declared: server.ts lists them
 * to MCP clients, and each handler refuses an input that leaves out a required one before reading it.
 */
export const PRD_TOOL_SCHEMAS = {
  // FR-NODE-240 — the PRD readers (mirror `speckiwi prd check|items|show|search`).
  check_prd: { path: z.string().describe("PRD file relative to the workspace root, e.g. docs/prd/<date>.<slug>.prd.md") },
  list_prd_items: {
    path: z.string().describe("PRD file under docs/prd"),
    offset: z.number().int().nonnegative().optional(),
    limit: z.number().int().positive().optional()
  },
  get_prd_item: { path: z.string().describe("PRD file under docs/prd"), id: z.string().describe("item ID, e.g. PRD-3") },
  search_prd_items: {
    query: z.string(),
    path: z.string().describe("search only this PRD file; every docs/prd/*.prd.md when omitted").optional(),
    offset: z.number().int().nonnegative().optional(),
    limit: z.number().int().positive().optional()
  },
  // FR-NODE-241 — the verdict cursor (mirrors `speckiwi prd cursor`); next and reset append to the ledger.
  prd_cursor: {
    action: z.enum(["count", "current", "next", "seek", "reset"]),
    path: z.string().describe("PRD file under docs/prd"),
    runId: z.string().describe("lower-case run ID; names the ledger kiwi/prd/<runId>.jsonl"),
    direction: z.enum(["prd-to-srs", "srs-to-prd"]).describe("prd-to-srs walks the PRD items (default); srs-to-prd walks the requirements and criteria of target").optional(),
    target: z.string().describe("the target srs-to-prd walks").optional(),
    verdict: z.string().describe("next: the verdict for the current item; skip one only with deferred and a note").optional(),
    note: z.string().optional(),
    refs: z.array(z.string()).optional(),
    index: z.number().int().positive().describe("seek: the 1-based item to show").optional()
  },
  // FR-NODE-242 — PRD coverage of a target (mirrors `speckiwi prd coverage`).
  check_prd_coverage: { path: z.string().describe("PRD file under docs/prd"), target: z.string() }
} satisfies Record<string, Record<string, z.ZodTypeAny>>;

type PrdTool = keyof typeof PRD_TOOL_SCHEMAS;

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function optionalText(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function optionalNumber(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined;
}

/** A read answer: a check report lists its diagnostics in the value, and the envelope does not repeat them (FR-MCP-070 AC-1). */
function answer<T>(result: Result<T>): unknown {
  if (!result.ok) return resultToMcp(result);
  const value = result.value as { diagnostics?: unknown };
  return mcpSuccess(result.value, Array.isArray(value.diagnostics) ? value.diagnostics : []);
}

function cursorRequest(input: Record<string, unknown>): PrdCursorRequest {
  const refs = Array.isArray(input.refs) ? input.refs.filter((item): item is string => typeof item === "string") : undefined;
  const direction = optionalText(input.direction);
  const target = optionalText(input.target);
  const verdict = optionalText(input.verdict);
  const note = optionalText(input.note);
  const index = optionalNumber(input.index);
  return {
    action: text(input.action),
    path: text(input.path),
    runId: text(input.runId),
    ...(direction !== undefined ? { direction } : {}),
    ...(target !== undefined ? { target } : {}),
    ...(verdict !== undefined ? { verdict } : {}),
    ...(note !== undefined ? { note } : {}),
    ...(refs !== undefined ? { refs } : {}),
    ...(index !== undefined ? { index } : {})
  };
}

export function registerPrdTools(server: McpServerHandle, deps: McpDependencies): void {
  const projectRoot = () => resolveProjectRoot(process.cwd(), deps.root);
  const root = async () => (await projectRoot()).root;
  const read = { readOnlyHint: true } as const;
  const register = (tool: PrdTool, handler: (input: Record<string, unknown>) => Promise<unknown>, metadata: Parameters<McpServerHandle["registerTool"]>[2]) =>
    server.registerTool(tool, async (input) => missingRequiredArguments(tool, PRD_TOOL_SCHEMAS[tool], input) ?? handler(input), metadata);
  register("check_prd", async (input) => answer(await checkPrdFile(await root(), text(input.path))), read);
  register("list_prd_items", async (input) =>
    answer(await listPrdFileItems(await root(), text(input.path), { offset: optionalNumber(input.offset), limit: optionalNumber(input.limit) })), read);
  register("get_prd_item", async (input) => answer(await readPrdFileItem(await root(), text(input.path), text(input.id))), read);
  register("search_prd_items", async (input) =>
    answer(await searchPrdFiles(await root(), text(input.query), { path: optionalText(input.path), offset: optionalNumber(input.offset), limit: optionalNumber(input.limit) })), read);
  register("check_prd_coverage", async (input) =>
    answer(await prdFileCoverage(await parseWorkspace(await projectRoot()), text(input.path), text(input.target))), read);
  // @req FR-NODE-241 AC-3 — next and reset append to kiwi/prd/<runId>.jsonl, so the tool is a writer.
  register("prd_cursor", async (input) => answer(await runPrdCursor(await parseWorkspace(await projectRoot()), cursorRequest(input))), { kind: "workspace" });
}
