import { fail, ok, type Result } from "../result.js";
import { isReviewCodeFile } from "./code-file-class.js";

// @req FR-NODE-274 — the read-only review-round check. It reads the `limits` and `rounds[]` record a
// kiwi-review-fix-loop run keeps in `.kiwi/sessions/{run-id}/state.json` and computes the round-N
// scope, the earlier-round-fix majority and the verdict. Every judgement in that record — a finding's
// tier and family, the tokens a round used, its residuals, the coverage comparison — is the lead's and
// is read as recorded (AC-7). The state file and git are reached only through {@link ReviewRoundSources}.

/** What the check reads. Nothing here writes. */
export interface ReviewRoundSources {
  /** The text of a file relative to the workspace root, or undefined when there is none. */
  readState(relativePath: string): Promise<string | undefined>;
  /** Whether `sha` names a tree object in the repository. */
  isTree(sha: string): Promise<boolean>;
  /** The repository-relative POSIX paths that differ between two trees, or undefined when git cannot tell. */
  changedPaths(fromTree: string, toTree: string): Promise<string[] | undefined>;
  /** The first line of a file as a tree holds it, or undefined when the tree holds no such file. */
  firstLine(tree: string, posixPath: string): Promise<string | undefined>;
}

export type ReviewRoundVerdict = "PASS" | "CONTINUE" | "NEEDS_USER";

/** Why the verdict is what it is: empty for PASS and for a plain CONTINUE, `scope` on a scope failure. */
export type ReviewRoundStopReason = "scope" | "earlier-fix-majority" | "residual" | "round-cap" | "token-budget";

export interface ReviewRoundReport {
  readonly statePath: string;
  /** The latest round, the one judged. */
  readonly round: number;
  readonly verdict: ReviewRoundVerdict;
  readonly reasons: ReviewRoundStopReason[];
  readonly scope: {
    /** False for round 1, whose scope AC-2 does not define. */
    readonly checked: boolean;
    readonly scope: RoundScope;
    readonly failed: boolean;
    /** Code files of the filtered diff that the round's `files[]` does not list. */
    readonly missingFiles: string[];
    /** A `full` round whose widen reason is null or empty. */
    readonly widenReasonMissing: boolean;
  };
  readonly counts: {
    readonly block: number;
    readonly record: number;
    readonly blockIntroducedEarlier: number;
    readonly residual: number;
    readonly tokensUsed: number;
    readonly tokenBudget: number | null;
    readonly roundCap: number;
  };
}

const SCOPES = ["since-prev", "full"] as const;
type RoundScope = (typeof SCOPES)[number];
const TIERS = ["block", "record"] as const;
type Tier = (typeof TIERS)[number];

interface RoundFinding {
  readonly tier: Tier;
  readonly introducedByRound: number | null;
}

interface RoundEntry {
  readonly round: number;
  readonly treeSha: string;
  readonly scope: RoundScope;
  readonly scopeWidenReason: string | null;
  readonly files: string[];
  readonly tokensUsed: number;
  readonly residualCount: number;
  readonly coveragePassed: boolean;
  readonly findings: RoundFinding[];
}

interface RoundRecord {
  readonly roundCap: number;
  readonly tokenBudget: number | null;
  readonly rounds: RoundEntry[];
}

/** One path segment, so the run ID cannot leave `.kiwi/sessions/`. */
const RUN_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const TREE_SHA = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;

/** Where a run keeps its state, relative to the workspace root. */
export function reviewRoundStatePath(runId: string): string {
  return `.kiwi/sessions/${runId}/state.json`;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isCount(value: unknown, least: number): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= least;
}

function isOneOf<T extends string>(value: unknown, set: readonly T[]): value is T {
  return typeof value === "string" && (set as readonly string[]).includes(value);
}

/** A repository-relative path as the diff prints it: forward slashes, no leading `./`. */
function posixPath(value: string): string {
  return value.replace(/\\/g, "/").replace(/^(?:\.\/)+/, "");
}

/** Reads the record or names the first field that breaks it; a string is that field's complaint. */
function parseFinding(value: unknown, at: string): RoundFinding | string {
  if (!isObject(value)) return `${at} must be an object`;
  if (typeof value.id !== "string") return `${at}.id must be a string`;
  if (!isOneOf(value.tier, TIERS)) return `${at}.tier must be "block" or "record"`;
  if (typeof value.family !== "string") return `${at}.family must be a string`;
  if (value.introduced_by_round !== null && !isCount(value.introduced_by_round, 1)) return `${at}.introduced_by_round must be a round number or null`;
  return { tier: value.tier, introducedByRound: value.introduced_by_round };
}

function parseRound(value: unknown, index: number): RoundEntry | string {
  const at = `rounds[${index}]`;
  if (!isObject(value)) return `${at} must be an object`;
  if (value.round !== index + 1) return `${at}.round must be ${index + 1}: round numbers run 1, 2, … in order`;
  if (typeof value.tree_sha !== "string" || !TREE_SHA.test(value.tree_sha)) return `${at}.tree_sha must be a git tree object ID`;
  if (!isOneOf(value.scope, SCOPES)) return `${at}.scope must be "since-prev" or "full"`;
  if (value.scope_widen_reason !== null && typeof value.scope_widen_reason !== "string") return `${at}.scope_widen_reason must be a string or null`;
  if (!Array.isArray(value.files) || !value.files.every((file) => typeof file === "string")) return `${at}.files must be an array of paths`;
  if (!isCount(value.tokens_used, 0)) return `${at}.tokens_used must be a non-negative integer`;
  if (!isCount(value.residual_count, 0)) return `${at}.residual_count must be a non-negative integer`;
  if (typeof value.coverage_passed !== "boolean") return `${at}.coverage_passed must be a boolean`;
  if (!Array.isArray(value.findings)) return `${at}.findings must be an array`;
  const findings: RoundFinding[] = [];
  for (const [position, item] of value.findings.entries()) {
    const finding = parseFinding(item, `${at}.findings[${position}]`);
    if (typeof finding === "string") return finding;
    findings.push(finding);
  }
  return {
    round: value.round,
    treeSha: value.tree_sha,
    scope: value.scope,
    scopeWidenReason: value.scope_widen_reason,
    files: value.files.map(posixPath),
    tokensUsed: value.tokens_used,
    residualCount: value.residual_count,
    coveragePassed: value.coverage_passed,
    findings
  };
}

function parseRecord(value: unknown): RoundRecord | string {
  if (!isObject(value)) return "the state must be a JSON object";
  const { limits, rounds } = value;
  if (!isObject(limits)) return "limits is absent";
  if (!isCount(limits.round_cap, 1)) return "limits.round_cap must be a positive integer";
  if (limits.token_budget !== null && !isCount(limits.token_budget, 1)) return "limits.token_budget must be a positive integer or null";
  if (!Array.isArray(rounds)) return "rounds is absent";
  if (rounds.length === 0) return "rounds is empty";
  const entries: RoundEntry[] = [];
  for (const [index, item] of rounds.entries()) {
    const entry = parseRound(item, index);
    if (typeof entry === "string") return entry;
    entries.push(entry);
  }
  return { roundCap: limits.round_cap, tokenBudget: limits.token_budget, rounds: entries };
}

function parseJson(text: string): { value: unknown } | undefined {
  try {
    return { value: JSON.parse(text) as unknown };
  } catch {
    return undefined;
  }
}

/** @req FR-NODE-274 AC-2 — the scope of the latest round N >= 2, or unchecked for round 1. */
async function judgeScope(record: RoundRecord, sources: ReviewRoundSources): Promise<ReviewRoundReport["scope"] | string> {
  const latest = record.rounds[record.rounds.length - 1] as RoundEntry;
  const previous = record.rounds[record.rounds.length - 2];
  const unchecked = { checked: false, scope: latest.scope, failed: false, missingFiles: [], widenReasonMissing: false };
  if (previous === undefined) return unchecked;
  if (latest.scope === "full") {
    const widenReasonMissing = (latest.scopeWidenReason ?? "").trim() === "";
    return { ...unchecked, checked: true, failed: widenReasonMissing, widenReasonMissing };
  }
  const changed = await sources.changedPaths(previous.treeSha, latest.treeSha);
  if (changed === undefined) return `git could not diff rounds[${record.rounds.length - 2}].tree_sha and rounds[${record.rounds.length - 1}].tree_sha`;
  const listed = new Set(latest.files);
  const missingFiles: string[] = [];
  for (const file of new Set(changed.map(posixPath))) {
    if (file.startsWith(".kiwi/") || listed.has(file)) continue;
    if (await isReviewCodeFile(file, () => sources.firstLine(latest.treeSha, file))) missingFiles.push(file);
  }
  missingFiles.sort();
  return { ...unchecked, checked: true, failed: missingFiles.length > 0, missingFiles };
}

/** @req FR-NODE-274 AC-4 — the round-cap and token-budget stops. */
function limitStops(record: RoundRecord, counts: ReviewRoundReport["counts"], latest: RoundEntry): ReviewRoundStopReason[] {
  const stops: ReviewRoundStopReason[] = [];
  if (latest.round >= record.roundCap) stops.push("round-cap");
  if (record.tokenBudget !== null && counts.tokensUsed > record.tokenBudget) stops.push("token-budget");
  return stops;
}

/**
 * @req FR-NODE-274 AC-2 AC-3 AC-4 — the verdict and its reasons; `record` findings never enter it. The
 * majority stop comes first; a scope failure continues, so the lead repeats that round's review over
 * the missing files, unless a cap or budget stop applies.
 */
function judgeVerdict(record: RoundRecord, scopeFailed: boolean, counts: ReviewRoundReport["counts"], latest: RoundEntry): { verdict: ReviewRoundVerdict; reasons: ReviewRoundStopReason[] } {
  const scope: ReviewRoundStopReason[] = scopeFailed ? ["scope"] : [];
  if (counts.blockIntroducedEarlier * 2 > counts.block) return { verdict: "NEEDS_USER", reasons: [...scope, "earlier-fix-majority"] };
  if (!scopeFailed && counts.block === 0 && latest.coveragePassed) {
    return latest.residualCount === 0 ? { verdict: "PASS", reasons: [] } : { verdict: "NEEDS_USER", reasons: ["residual"] };
  }
  const limits = limitStops(record, counts, latest);
  return limits.length > 0 ? { verdict: "NEEDS_USER", reasons: [...scope, ...limits] } : { verdict: "CONTINUE", reasons: scope };
}

/**
 * Checks the latest round of a run. An invalid run ID is a usage error; a missing state, text that is
 * not JSON, a record that breaks AC-1 or a tree_sha naming no tree is an error naming the state file
 * and the field, with no verdict (AC-5).
 */
export async function checkReviewRound(runId: string, sources: ReviewRoundSources): Promise<Result<ReviewRoundReport>> {
  if (!RUN_ID.test(runId)) return fail("USAGE", `run ID '${runId}' must be one path segment of letters, digits, '.', '_' or '-'`);
  const statePath = reviewRoundStatePath(runId);
  const text = await sources.readState(statePath);
  if (text === undefined) return fail("NOT_FOUND", `${statePath}: the run state does not exist`);
  const parsed = parseJson(text);
  if (parsed === undefined) return fail("PARSE", `${statePath}: the run state is not valid JSON`);
  const record = parseRecord(parsed.value);
  if (typeof record === "string") return fail("VALIDATION", `${statePath}: ${record}`);
  for (const [index, entry] of record.rounds.entries()) {
    if (!(await sources.isTree(entry.treeSha))) return fail("VALIDATION", `${statePath}: rounds[${index}].tree_sha ${entry.treeSha} names no tree object in the repository`);
  }
  const scope = await judgeScope(record, sources);
  if (typeof scope === "string") return fail("IO", `${statePath}: ${scope}`);
  const latest = record.rounds[record.rounds.length - 1] as RoundEntry;
  const blocking = latest.findings.filter((finding) => finding.tier === "block");
  const counts = {
    block: blocking.length,
    record: latest.findings.length - blocking.length,
    blockIntroducedEarlier: blocking.filter((finding) => finding.introducedByRound !== null && finding.introducedByRound < latest.round).length,
    residual: latest.residualCount,
    tokensUsed: record.rounds.reduce((sum, entry) => sum + entry.tokensUsed, 0),
    tokenBudget: record.tokenBudget,
    roundCap: record.roundCap
  };
  return ok({ statePath, round: latest.round, ...judgeVerdict(record, scope.failed, counts, latest), scope, counts });
}
