import type { Diagnostic } from "../types.js";
import type { LinkCheckResult } from "./links.js";

/**
 * A previous `validate --json` or `links check --json` output read back as a baseline. Entries match
 * without their line, because a line moves with every insertion above it, and only warnings leave the
 * result: an error stays a failure whether or not the baseline holds it (IR-CLI-051's intent).
 * @req IR-CLI-123
 */
export interface Baseline {
  readonly file: string;
  readonly keys: ReadonlySet<string>;
}

export interface BaselineReport {
  file: string;
  suppressed: number;
}

export type BaselineCommand = "validate" | "links check";

type Parsed = { ok: true; baseline: Baseline } | { ok: false; message: string };

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const text = (value: unknown) => (typeof value === "string" ? value : "");

function diagnosticKey(entry: Record<string, unknown>): string {
  return JSON.stringify([text(entry.code), text(entry.filePath), text(entry.requirementId), text(entry.message)]);
}

function linkKey(entry: Record<string, unknown>): string {
  return JSON.stringify([text(entry.code), text(entry.requirementId), text(entry.filePath), text(entry.reference), text(entry.reason)]);
}

const isWarningCode = (code: string) => code.startsWith("SRS-W");

/** Reads the baseline text a caller handed in; a text that is not that command's `--json` output is refused. */
export function parseBaseline(command: BaselineCommand, file: string, content: string | undefined): Parsed {
  const refuse = (why: string): Parsed => ({ ok: false, message: `--baseline ${file} ${why}; pass a file that a previous \`speckiwi ${command} --json\` wrote` });
  if (content === undefined) return refuse("cannot be read");
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return refuse("is not JSON");
  }
  if (!isRecord(parsed)) return refuse("is not a JSON object");
  if (command === "validate") {
    if (!Array.isArray(parsed.warnings) || !Array.isArray(parsed.errors) || "broken" in parsed) return refuse("is not a validate output");
    return { ok: true, baseline: { file, keys: new Set(parsed.warnings.filter(isRecord).map(diagnosticKey)) } };
  }
  if (!Array.isArray(parsed.broken) || !Array.isArray(parsed.brokenIndexLinks)) return refuse("is not a links check output");
  return { ok: true, baseline: { file, keys: new Set([...parsed.broken, ...parsed.brokenIndexLinks].filter(isRecord).map(linkKey)) } };
}

/** The diagnostics without the warnings the baseline holds, and how many it removed. */
export function withoutBaselineWarnings(diagnostics: readonly Diagnostic[], baseline: Baseline): { diagnostics: Diagnostic[]; report: BaselineReport } {
  // @req IR-CLI-123 AC-2 — the severity of the diagnostic found now decides, not the baseline file:
  // a hand-edited baseline that lists an error among its warnings must not hide it.
  const kept = diagnostics.filter((entry) => entry.severity !== "warning" || !baseline.keys.has(diagnosticKey(entry as unknown as Record<string, unknown>)));
  return { diagnostics: kept, report: { file: baseline.file, suppressed: diagnostics.length - kept.length } };
}

/** The link check without the warning entries the baseline holds; an error entry such as SRS-E012 stays. */
export function withoutBaselineLinks(result: LinkCheckResult, baseline: Baseline): LinkCheckResult & { baseline: BaselineReport } {
  const held = (entry: { code: string }) => isWarningCode(entry.code) && baseline.keys.has(linkKey(entry as unknown as Record<string, unknown>));
  const broken = result.broken.filter((entry) => !held(entry));
  const brokenIndexLinks = result.brokenIndexLinks.filter((entry) => !held(entry));
  const suppressed = result.broken.length - broken.length + result.brokenIndexLinks.length - brokenIndexLinks.length;
  return { ...result, broken, brokenIndexLinks, baseline: { file: baseline.file, suppressed } };
}
