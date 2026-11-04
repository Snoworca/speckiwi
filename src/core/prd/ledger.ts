import { existsSync } from "node:fs";
import { appendFile, mkdir, readFile, truncate } from "node:fs/promises";
import path from "node:path";
import { canonicalPath } from "../fs/canonical-path.js";
import { fail, ok, type Result } from "../result.js";
import { parsePrdPointer } from "./pointer.js";

// @req FR-NODE-241 AC-3 — the verdict ledger `kiwi/prd/<run_id>.jsonl`: one JSON object per line,
// appended only. A run's file is named by its run ID alone, so two runs never touch each other's
// ledger, and a run ID that could name a path outside kiwi/prd is refused.

export type PrdCursorDirection = "prd-to-srs" | "srs-to-prd";

/** The verdicts kiwi-srs records per direction (`prd_items[]` / `srs_items[]`), plus `deferred` to skip. */
export const PRD_CURSOR_VERDICTS: Readonly<Record<PrdCursorDirection, readonly string[]>> = {
  "prd-to-srs": ["accepted", "fail", "respected", "violated", "other-wave", "not-applicable", "resolved", "deferred"],
  "srs-to-prd": ["grounded", "fills", "drop", "residual", "deferred"]
};

export interface PrdVerdictLine {
  event: "verdict";
  prd: string;
  direction: PrdCursorDirection;
  round: number;
  index: number;
  item: string;
  verdict: string;
  refs: string[];
  note: string;
  ts: string;
}

export interface PrdResetLine {
  event: "reset";
  prd: string;
  direction: PrdCursorDirection;
  round: number;
  ts: string;
}

export type PrdLedgerLine = PrdVerdictLine | PrdResetLine;

// Lower case only: on a case-insensitive file system `Run1` and `run1` would name one ledger.
const RUN_ID_RE = /^[a-z0-9][a-z0-9._-]{0,127}$/;

export function prdLedgerPath(root: string, runId: string): Result<string> {
  if (!RUN_ID_RE.test(runId)) {
    return fail("PRD_CURSOR_RUN_ID_INVALID", `Run ID "${runId}" must be lower-case letters, digits, '.', '_' or '-' and start with a letter or digit`);
  }
  return ok(path.join(root, "kiwi", "prd", `${runId}.jsonl`));
}

type FieldCheck = (value: unknown, line: Readonly<Record<string, unknown>>) => boolean;

const isText = (value: unknown): value is string => typeof value === "string";
const isFilledText = (value: unknown) => isText(value) && value !== "";
const isCount = (value: unknown) => Number.isInteger(value) && (value as number) >= 1;
const isDirection = (value: unknown): value is PrdCursorDirection => isText(value) && Object.hasOwn(PRD_CURSOR_VERDICTS, value);

const COMMON_FIELDS = {
  prd: (value: unknown) => isText(value) && parsePrdPointer(value) !== undefined,
  direction: isDirection,
  round: isCount,
  ts: isFilledText
} satisfies Record<string, FieldCheck>;

/**
 * @req FR-NODE-241 AC-3 — the one shape of a ledger line, per event: exactly these fields, each passing
 * its check. The writer's line types below are this shape, and the reader accepts a line only when it
 * matches it, so a line the writer never writes — a field missing, extra, of another type or with a
 * value outside its list — is a corrupt ledger, never a line read and then silently ignored.
 */
export const PRD_LEDGER_SCHEMA = {
  verdict: {
    event: (value: unknown) => value === "verdict",
    ...COMMON_FIELDS,
    index: isCount,
    item: isFilledText,
    verdict: (value: unknown, line: Readonly<Record<string, unknown>>) => isDirection(line.direction) && PRD_CURSOR_VERDICTS[line.direction].includes(value as string),
    refs: (value: unknown) => Array.isArray(value) && value.every(isText),
    note: isText
  },
  reset: {
    event: (value: unknown) => value === "reset",
    ...COMMON_FIELDS
  }
} as const satisfies Record<PrdLedgerLine["event"], Record<string, FieldCheck>>;

function matches(line: Readonly<Record<string, unknown>>, fields: Readonly<Record<string, FieldCheck>>): boolean {
  const keys = Object.keys(line);
  return keys.length === Object.keys(fields).length && keys.every((key) => Object.hasOwn(fields, key) && fields[key]!(line[key], line));
}

export function isPrdLedgerLine(value: unknown): value is PrdLedgerLine {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const line = value as Record<string, unknown>;
  return Object.values(PRD_LEDGER_SCHEMA).some((fields) => matches(line, fields));
}

function parseJson(text: string): unknown {
  // A corrupt ledger is an exceptional condition, and JSON.parse reports it only by throwing.
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

export interface PrdLedgerRead {
  lines: PrdLedgerLine[];
  /** The last line ends without a line break and does not parse as JSON: an append that was cut off. */
  tornTail: boolean;
}

/**
 * The byte length of the ledger without an interrupted append: a last line that ends without a line
 * break and does not parse as JSON. Undefined when there is none. The writer appends one
 * `JSON.stringify` output per line, so a cut-off append never leaves a prefix that parses: a last line
 * that parses but is no ledger entry is corruption, like any other bad line, and the reader refuses it
 * instead of the writer cutting it away.
 */
function tornTailStart(bytes: Buffer): number | undefined {
  if (bytes.length === 0 || bytes[bytes.length - 1] === 0x0a) return undefined;
  const lineStart = bytes.lastIndexOf(0x0a) + 1;
  return parseJson(bytes.subarray(lineStart).toString("utf8")) === undefined ? lineStart : undefined;
}

export async function readPrdLedger(file: string): Promise<Result<PrdLedgerRead>> {
  if (!existsSync(file)) return ok({ lines: [], tornTail: false });
  const bytes = await readFile(file);
  const torn = tornTailStart(bytes);
  const lines: PrdLedgerLine[] = [];
  const rows = bytes.subarray(0, torn ?? bytes.length).toString("utf8").split(/\r?\n/);
  for (const [position, row] of rows.entries()) {
    if (row.trim() === "") continue;
    const value = parseJson(row);
    if (!isPrdLedgerLine(value)) {
      return fail("PRD_LEDGER_CORRUPT", `${file} line ${position + 1} is not a ledger entry; fix or remove it, nothing was skipped`);
    }
    lines.push(value);
  }
  return ok({ lines, tornTail: torn !== undefined });
}

/**
 * Appends one line. An interrupted append left at the end is cut first, and a complete last line that
 * lost its line break gets one, so the new line never joins the previous one.
 */
export async function appendPrdLedger(file: string, line: PrdLedgerLine): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  const bytes = existsSync(file) ? await readFile(file) : Buffer.alloc(0);
  const torn = tornTailStart(bytes);
  if (torn !== undefined) await truncate(file, torn);
  const kept = torn ?? bytes.length;
  const separator = kept > 0 && bytes[kept - 1] !== 0x0a ? "\n" : "";
  await appendFile(file, `${separator}${JSON.stringify(line)}\n`, "utf8");
}

const pending = new Map<string, Promise<unknown>>();

/**
 * Runs `task` after every earlier task on the same ledger in this process has settled, so two calls
 * on one run cannot both read index i and both append it. Different ledgers never wait on each other.
 * The key is the canonical path, so two spellings of one root (a drive letter's case, a junction)
 * share it. Separate processes are not serialised: a run has one writer (research 41 §7.2).
 */
export async function onLedger<T>(file: string, task: () => Promise<T>): Promise<T> {
  const canonical = await canonicalPath(file);
  const key = process.platform === "win32" ? canonical.toLowerCase() : canonical;
  const previous = pending.get(key) ?? Promise.resolve();
  const run = previous.then(task, task);
  const settled = run.then(
    () => undefined,
    () => undefined
  );
  pending.set(key, settled);
  void settled.then(() => {
    if (pending.get(key) === settled) pending.delete(key);
  });
  return run;
}
