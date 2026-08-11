import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { Command } from "commander";
import type { CliContext } from "../command.js";
import { writeHuman, writeJson } from "../formatters.js";
import type { ProjectRoot } from "../../core/types.js";
import { decideAutoGate, GATE_IDS, type AutoGateInput, type GateId } from "../../core/orchestrator/auto-gate.js";
import { planDuplicationAudit } from "../../core/orchestrator/duplication-audit.js";
import { replayDeferredMutations, type DeferredMutation, type ReplayIndex, type ReplayPlan } from "../../core/orchestrator/replay.js";
import { applyReplayPlan, type ReplayDispatch } from "../../core/orchestrator/replay-apply.js";
import { addTraceLink } from "../../core/mutation/add-trace.js";
import { addVerificationEvidence } from "../../core/mutation/add-evidence.js";
import { updateStatus } from "../../core/mutation/update-status.js";
import { addCompletedWork } from "../../core/mutation/add-completed-work.js";
import { groundFiles, isGroundingRefusal, type DeclaredEntry } from "../../core/orchestrator/grounding.js";
import { validateHandoff } from "../../core/orchestrator/handoff.js";
import { closeWave, deferIssue, openIssue, planIssue, resolveIssue, type IssueRow, type ResolutionSet } from "../../core/orchestrator/issue-ledger.js";
import { computeLanePlan, LanePlanError, type LanePlanInput } from "../../core/orchestrator/lane-plan.js";
import { freezeLock, serializeLock } from "../../core/orchestrator/freeze.js";
import { HandoffPinError, pinHandoff } from "../../core/orchestrator/pinning.js";
import { normaliseRoot, preflightRunRoot } from "../../core/orchestrator/preflight.js";
import { gitToplevelOf, realpathProbe } from "../../core/root-facts.js";
import { RequirementNotReadyError, assertRequirementsReady, parseRequirementSnapshot } from "../../core/orchestrator/readiness.js";
import { computeInvariantDigest, readCard, validateCard, writeCard, resumeCardPath, type ResumeCard } from "../../core/orchestrator/resume-card.js";
import { computeResumeState, type DriftInputs, type GitFacts } from "../../core/orchestrator/resume.js";
import { computeRoute } from "../../core/orchestrator/route.js";
import { freezeRoute, frozenRouteEntry, resumeRung, routeLockDigest, serializeRouteLock, type RouteGateRecord, type RouteLock } from "../../core/orchestrator/route-lock.js";
import { parseRouteProbe } from "../../core/orchestrator/route-probe.js";
import { acquire, readHolder, release, resolveGitCommonDir, RunLockHeldError, runLockPath } from "../../core/orchestrator/run-lock.js";
import { planStageCoupling, type ParsedHandoff } from "../../core/orchestrator/substrate.js";
import { normalizeTasks, type SidecarPhase, type SidecarTask, type TaskCatalogEntry } from "../../core/orchestrator/task-catalog.js";
import { evaluateRound, projectRound, type Round } from "../../core/orchestrator/verification-gate.js";
import { parseWavesJournal, WAVES_JOURNAL_PATH, type WavesJournalView } from "../../core/orchestrator/waves-journal.js";
import { validateWavesJournal } from "../../core/orchestrator/waves-validate.js";

// @req IR-CLI-082 / IR-CLI-083 / IR-CLI-084 / IR-MCP-003 / FR-NODE-127 / FR-NODE-137
//
// The impure shell over `src/core/orchestrator/`'s pure kernels. Every judgment lives in a kernel;
// this file collects the facts a kernel needs from disk, calls it, and maps its answer onto the one
// exit-code table 05 §10.6 states for the whole namespace.

const requirePackage = createRequire(import.meta.url);
const { version: PACKAGE_VERSION } = requirePackage("../../../package.json") as { version: string };

/** 05 §4.2's writer stamp, required on every `schema_version >= 1.4.0` line this tool writes. */
export const JOURNAL_WRITER_STAMP = `speckiwi-orchestrate/${PACKAGE_VERSION}`;

/**
 * The twenty-one phase-1 verb rows of 05 §10.6, written exactly as the requirement names them.
 *
 * A row is the unit the design tables and the skill body cite; a row whose last segment is an
 * alternation (`a|b|c`) registers one leaf command per alternative. The vocabulary is declared once
 * here and every derived view — the registrar, the MCP mirror, the parity tests — reads it.
 * @req IR-CLI-082
 */
export const ORCHESTRATE_PHASE1_VERB_ROWS = [
  "resume",
  "preflight",
  "route probe",
  "route freeze",
  "route show",
  "run lock|unlock|status",
  "run abort",
  "journal append",
  "card write",
  "freeze design|waves|lanes|handoff|issues|postmortem",
  "readiness check",
  "schedule plan",
  "coupling check",
  "schedule show",
  "handoff validate",
  "round record",
  "issue open|plan|resolve|defer|list",
  "wave close",
  "duplication plan",
  "validate",
  "auto-gate decide"
] as const;

/**
 * The six rows 05 §10.6 assigns to `2.6.0-phase2-parallel-lanes`. Each takes a lane workspace, a
 * lane manifest or a harvested lane queue as its subject, and phase 1 creates none of those.
 *
 * This is **phase membership**, which is a fixed fact about the design, not registration state — a
 * row stays here after it ships. What changes as phase 2 lands is
 * {@link ORCHESTRATE_DEFERRED_VERB_ROWS}. Keeping the two apart is what lets the phase-1 boundary
 * assertions stay meaningful while the surface grows. @req IR-CLI-082
 */
export const ORCHESTRATE_PHASE2_VERB_ROWS = [
  "lane audit",
  "lane harvest",
  "lane release",
  "lane status",
  "replay plan",
  "replay apply"
] as const;

/**
 * The phase-2 rows that are **not yet registered**. Declared so the absence is asserted rather than
 * assumed; it shrinks as phase 2 lands and is empty when phase 2 is complete. @req IR-CLI-091
 */
export const ORCHESTRATE_DEFERRED_VERB_ROWS = ["lane audit", "lane harvest", "lane release", "lane status"] as const;

/**
 * Every row the CLI actually registers: the phase-1 surface plus each phase-2 row already landed.
 * Derived rather than restated, so a row cannot be registered without leaving the deferred list.
 * @req IR-CLI-091
 */
export const ORCHESTRATE_REGISTERED_VERB_ROWS: readonly string[] = [
  ...ORCHESTRATE_PHASE1_VERB_ROWS,
  ...ORCHESTRATE_PHASE2_VERB_ROWS.filter((row) => !(ORCHESTRATE_DEFERRED_VERB_ROWS as readonly string[]).includes(row))
];

/** The six freeze targets of 05 §3.3a. @req IR-CLI-082 */
export const FREEZE_TARGETS = ["design", "waves", "lanes", "handoff", "issues", "postmortem"] as const;

export type FreezeTarget = (typeof FREEZE_TARGETS)[number];

/** The rows 05 §10.6 classifies as mutations: each returns an envelope and honours `--dry-run`. */
export const ORCHESTRATE_MUTATION_VERB_ROWS = [
  "route probe",
  "route freeze",
  "run lock|unlock|status",
  "run abort",
  "journal append",
  "card write",
  "freeze design|waves|lanes|handoff|issues|postmortem",
  "schedule plan",
  "round record",
  "issue open|plan|resolve|defer|list",
  // @req IR-CLI-092 — applying a replay writes SRS at the host root, so the leaf is a mutation and
  // carries `--dry-run`. Omitting it here classified the leaf as a read and the surface test caught it.
  "replay apply"
] as const;

/**
 * The two leaves inside a mutation row that 05 §10.6 types `mutation / read`: they inspect the lock
 * and the ledger and write nothing, so neither carries `--dry-run` — an option that would request
 * the behaviour the verb already has. Declared here because the kind is per leaf, not per row.
 */
export const ORCHESTRATE_READ_LEAVES_IN_MUTATION_ROWS = ["run status", "issue list"] as const;

/** A row parsed into its fixed prefix segments and the alternatives its last segment admits. */
interface ParsedRow {
  readonly row: string;
  readonly prefix: readonly string[];
  readonly alternatives: readonly string[];
}

function parseRow(row: string): ParsedRow {
  const segments = row.split(" ");
  const last = segments[segments.length - 1] as string;
  return { row, prefix: segments.slice(0, -1), alternatives: last.split("|") };
}

const PARSED_REGISTERED_ROWS: readonly ParsedRow[] = ORCHESTRATE_REGISTERED_VERB_ROWS.map(parseRow);

/**
 * The registered verb row a walked command path belongs to, or `null` when it belongs to none —
 * which is how a leaf outside the declared surface is detected rather than silently accepted.
 *
 * The set it matches against is {@link ORCHESTRATE_REGISTERED_VERB_ROWS}, not the phase-1 rows
 * alone: a landed phase-2 row is registered, so a path that folds into one is inside the surface.
 * @req IR-CLI-082 / IR-CLI-091
 */
export function orchestrateVerbRow(segments: readonly string[]): string | null {
  for (const parsed of PARSED_REGISTERED_ROWS) {
    if (segments.length !== parsed.prefix.length + 1) continue;
    if (!parsed.prefix.every((segment, index) => segments[index] === segment)) continue;
    if (parsed.alternatives.includes(segments[segments.length - 1] as string)) return parsed.row;
  }
  return null;
}

/** How one MCP input field is encoded back into the CLI option it mirrors. */
export interface OrchestrateToolOption {
  readonly flag: string;
  readonly dest: string;
  readonly encoding: "boolean" | "string" | "json" | "array";
  readonly required?: boolean;
}

/**
 * One `orchestrate_*` MCP tool, bound to the CLI leaf it mirrors.
 *
 * `selector` covers the two rows whose leaf is chosen by an input value rather than by the tool name
 * — `freeze <target>` and `run lock|unlock|status` — so a single tool still resolves to exactly one
 * registered leaf. @req IR-MCP-003
 */
export interface OrchestrateToolBinding {
  readonly tool: string;
  readonly path: readonly string[];
  readonly kind: "read" | "mutation";
  readonly options: readonly OrchestrateToolOption[];
  readonly selector?: { readonly dest: string; readonly index: number; readonly values: readonly string[] };
}

function o(flag: string, dest: string, encoding: OrchestrateToolOption["encoding"] = "string", required = false): OrchestrateToolOption {
  return { flag, dest, encoding, ...(required ? { required: true } : {}) };
}

const DRY_RUN_OPTION = o("--dry-run", "dryRun", "boolean");
const RUN_ID_OPTION = o("--run-id", "runId");
const JOURNAL_OPTION = o("--journal", "journal");
const LEDGER_OPTION = o("--ledger", "ledger");

/**
 * The `orchestrate_*` family. The CLI namespace is the authority and every binding names the leaf it
 * mirrors, which is what makes "the MCP family mirrors the CLI" checkable in both directions rather
 * than by inspection. @req IR-MCP-003
 */
export const ORCHESTRATE_TOOL_BINDINGS: readonly OrchestrateToolBinding[] = [
  { tool: "orchestrate_resume", path: ["resume"], kind: "read", options: [RUN_ID_OPTION, JOURNAL_OPTION, o("--card", "card"), o("--facts", "facts")] },
  { tool: "orchestrate_preflight", path: ["preflight"], kind: "read", options: [o("--mcp-root", "mcpRoot", "string", true), o("--git-root", "gitRoot", "string", true)] },
  { tool: "orchestrate_route_probe", path: ["route", "probe"], kind: "mutation", options: [o("--probe", "probe"), o("--payload", "payload", "json"), o("--out", "out"), DRY_RUN_OPTION] },
  { tool: "orchestrate_route_freeze", path: ["route", "freeze"], kind: "mutation", options: [o("--probe", "probe"), o("--gate", "gate"), o("--out", "out"), o("--auto", "auto", "boolean"), DRY_RUN_OPTION] },
  { tool: "orchestrate_route_show", path: ["route", "show"], kind: "read", options: [o("--lock", "lock")] },
  {
    tool: "orchestrate_run_lock",
    path: ["run", "lock"],
    kind: "mutation",
    options: [o("--owner", "owner"), DRY_RUN_OPTION],
    selector: { dest: "action", index: 1, values: ["lock", "unlock", "status"] }
  },
  { tool: "orchestrate_run_abort", path: ["run", "abort"], kind: "mutation", options: [o("--reason", "reason", "string", true), RUN_ID_OPTION, JOURNAL_OPTION, DRY_RUN_OPTION] },
  { tool: "orchestrate_journal_append", path: ["journal", "append"], kind: "mutation", options: [RUN_ID_OPTION, o("--payload", "payload", "json"), JOURNAL_OPTION, DRY_RUN_OPTION] },
  { tool: "orchestrate_card_write", path: ["card", "write"], kind: "mutation", options: [RUN_ID_OPTION, o("--payload", "payload", "json"), JOURNAL_OPTION, DRY_RUN_OPTION] },
  {
    tool: "orchestrate_freeze",
    path: ["freeze", "design"],
    kind: "mutation",
    options: [o("--body", "body", "string", true), o("--document", "document", "string", true), o("--head", "head", "string", true), RUN_ID_OPTION, o("--declared-inputs", "declaredInputs"), o("--out", "out"), DRY_RUN_OPTION],
    selector: { dest: "target", index: 1, values: [...FREEZE_TARGETS] }
  },
  { tool: "orchestrate_readiness_check", path: ["readiness", "check"], kind: "read", options: [o("--target", "target", "string", true), o("--snapshot", "snapshot", "string", true), o("--req", "req", "array")] },
  {
    tool: "orchestrate_schedule_plan",
    path: ["schedule", "plan"],
    kind: "mutation",
    options: [o("--plan", "plan", "string", true), o("--lanes", "lanes"), o("--allow-inferred-write-set", "allowInferredWriteSet", "boolean"), o("--strict-grounding", "strictGrounding", "boolean"), o("--existing-paths", "existingPaths"), o("--out", "out"), RUN_ID_OPTION, JOURNAL_OPTION, DRY_RUN_OPTION]
  },
  { tool: "orchestrate_coupling_check", path: ["coupling", "check"], kind: "read", options: [o("--handoffs", "handoffs", "string", true), o("--wave", "wave"), o("--stage", "stage")] },
  { tool: "orchestrate_schedule_show", path: ["schedule", "show"], kind: "read", options: [o("--lock", "lock")] },
  { tool: "orchestrate_handoff_validate", path: ["handoff", "validate"], kind: "read", options: [o("--lane", "lane", "string", true), o("--path", "path", "string", true), o("--catalog", "catalog", "string", true), o("--base", "base", "string", true)] },
  // @req IR-MCP-004 AC-1 — `--proof` is mandatory on the leaf, so it has to be declared here too:
  // `orchestrateArgv` emits a flag only for a declared option, and the input schema is derived from
  // this same list, so an omission leaves the tool uncallable in every case rather than degraded.
  { tool: "orchestrate_round_record", path: ["round", "record"], kind: "mutation", options: [RUN_ID_OPTION, o("--payload", "payload", "json"), o("--proof", "proof", "json", true), JOURNAL_OPTION, DRY_RUN_OPTION] },
  { tool: "orchestrate_issue_open", path: ["issue", "open"], kind: "mutation", options: [LEDGER_OPTION, o("--payload", "payload", "json"), DRY_RUN_OPTION] },
  { tool: "orchestrate_issue_plan", path: ["issue", "plan"], kind: "mutation", options: [LEDGER_OPTION, o("--issue-id", "issueId", "string", true), o("--class", "class", "string", true), DRY_RUN_OPTION] },
  { tool: "orchestrate_issue_resolve", path: ["issue", "resolve"], kind: "mutation", options: [LEDGER_OPTION, o("--issue-id", "issueId", "string", true), o("--proof", "proof", "json", true), o("--resolution", "resolution", "string", true), DRY_RUN_OPTION] },
  { tool: "orchestrate_issue_defer", path: ["issue", "defer"], kind: "mutation", options: [LEDGER_OPTION, o("--issue-id", "issueId", "string", true), o("--reason", "reason", "string", true), DRY_RUN_OPTION] },
  { tool: "orchestrate_issue_list", path: ["issue", "list"], kind: "read", options: [LEDGER_OPTION, o("--wave", "wave")] },
  { tool: "orchestrate_wave_close", path: ["wave", "close"], kind: "read", options: [o("--wave", "wave", "string", true), LEDGER_OPTION, o("--resolution", "resolution", "string", true)] },
  { tool: "orchestrate_duplication_plan", path: ["duplication", "plan"], kind: "read", options: [o("--diffs", "diffs", "string", true), o("--write-sets", "writeSets", "string", true), o("--wave", "wave")] },
  { tool: "orchestrate_validate", path: ["validate"], kind: "read", options: [RUN_ID_OPTION, JOURNAL_OPTION, o("--strict", "strict", "boolean")] },
  { tool: "orchestrate_auto_gate", path: ["auto-gate", "decide"], kind: "read", options: [o("--payload", "payload", "json", true)] },
  // @req IR-CLI-091 — the first phase-2 row to register. Both options are declared because the MCP
  // input schema is derived from this list: an omission here leaves the field uncallable over MCP
  // while the CLI accepts it, which is how `orchestrate_round_record` once shipped uncallable.
  { tool: "orchestrate_replay_plan", path: ["replay", "plan"], kind: "read", options: [o("--queue", "queue", "string", true), o("--index", "index")] },
  // @req IR-CLI-092 — kind `mutation`, so the generated mirror carries the dry-run option and the
  // write envelope. A leaf without a binding ships an absent MCP tool and nothing says so.
  {
    tool: "orchestrate_replay_apply",
    path: ["replay", "apply"],
    kind: "mutation",
    options: [o("--plan", "plan", "string", true), o("--applied", "applied", "string", true), o("--frozen-target", "frozenTarget"), DRY_RUN_OPTION]
  }
];

/**
 * Each `orchestrate_*` tool against the phase-1 verb row it mirrors, derived from the bindings so
 * the two cannot drift. @req IR-MCP-003 AC-3
 */
export const ORCHESTRATE_MCP_TOOLS: Readonly<Record<string, string>> = Object.freeze(
  Object.fromEntries(ORCHESTRATE_TOOL_BINDINGS.map((binding) => [binding.tool, orchestrateVerbRow(binding.path) as string]))
);

/**
 * The argv one MCP call becomes. The MCP surface is a thin re-encoding of the CLI, so the tool and
 * the command cannot diverge in behaviour — there is one implementation of every verb.
 * @req IR-MCP-003 AC-6
 */
export function orchestrateArgv(
  binding: OrchestrateToolBinding,
  input: Record<string, unknown>,
  root?: string
): string[] {
  const segments = [...binding.path];
  if (binding.selector) {
    const chosen = input[binding.selector.dest];
    if (typeof chosen === "string") {
      if (!binding.selector.values.includes(chosen)) {
        throw new Error(`${binding.selector.dest} must be one of ${binding.selector.values.join(", ")}`);
      }
      segments[binding.selector.index] = chosen;
    }
  }
  const argv = [...(root ? ["--root", root] : []), "orchestrate", ...segments];
  for (const option of binding.options) {
    const value = input[option.dest];
    if (value === undefined || value === null) continue;
    if (option.encoding === "boolean") {
      if (value === true) argv.push(option.flag);
      continue;
    }
    if (option.encoding === "array") {
      for (const item of Array.isArray(value) ? value : [value]) argv.push(option.flag, String(item));
      continue;
    }
    argv.push(option.flag, option.encoding === "json" && typeof value !== "string" ? JSON.stringify(value) : String(value));
  }
  argv.push("--json");
  return argv;
}

/**
 * Whether a walked leaf is a read or a mutation, or `null` when it is outside the phase-1 surface.
 * A mutation leaf returns the envelope and honours `--dry-run`; a read leaf does neither.
 * @req IR-CLI-082 AC-5
 */
export function orchestrateVerbKind(segments: readonly string[]): "read" | "mutation" | null {
  const row = orchestrateVerbRow(segments);
  if (row === null) return null;
  if ((ORCHESTRATE_READ_LEAVES_IN_MUTATION_ROWS as readonly string[]).includes(segments.join(" "))) return "read";
  return (ORCHESTRATE_MUTATION_VERB_ROWS as readonly string[]).includes(row) ? "mutation" : "read";
}

// --- outcomes and the exit-code table -------------------------------------------------------------

/** 05 §10.6: 2 is gate refusal, 1 is an operational error, 0 is success. @req FR-NODE-137 */
const EXIT_OK = 0;
const EXIT_OPERATIONAL_ERROR = 1;
const EXIT_GATE_REFUSAL = 2;

interface GateRefusal {
  readonly refusedGate: string;
  readonly violations: readonly unknown[];
}

/** Narrows a runtime string to `GateId`. @req FR-NODE-166 AC-5 */
function isGateId(value: string): value is GateId {
  return (GATE_IDS as readonly string[]).includes(value);
}

/**
 * Refuses with a named gate. Read verbs exit 2 with it; mutation verbs exit 2 and write nothing.
 *
 * The parameter is `GateId` and not `GateId | string`: the widening made the union advisory at every
 * call site, and the emitted vocabulary was then checked only dynamically, only for the four verbs
 * one test drives. @req FR-NODE-166 AC-1
 */
function refuse(gate: GateId, violations: readonly unknown[] = []): GateRefusal {
  return { refusedGate: gate, violations };
}

function isRefusal(value: unknown): value is GateRefusal {
  return typeof value === "object" && value !== null && typeof (value as GateRefusal).refusedGate === "string";
}

/**
 * An operational failure — an unreadable file, malformed JSON — as distinct from a gate refusal.
 * Thrown rather than returned so a kernel's own throw lands on the same exit code.
 */
class OperationalError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "OperationalError";
  }
}

type VerbResult = Record<string, unknown> | GateRefusal;

interface RunVerbOptions {
  readonly program: Command;
  readonly context: CliContext;
  readonly json: boolean;
  readonly kind: "read" | "mutation";
  readonly dryRun?: boolean;
}

/**
 * Runs one verb body and maps its outcome onto 05 §10.6's exit-code table.
 *
 * Success is `{ok: true, violations: []}`; a refusal is `{ok: false, gate, violations}` at exit 2;
 * an operational error is `{ok: false, error}` at exit 1 and deliberately carries **no** `gate`
 * field, so a caller distinguishes refusal from crash without parsing the payload.
 * A mutation adds `applied` and `dryRun`, and `--dry-run` changes neither exit code.
 * @req FR-NODE-137
 */
async function runVerb(options: RunVerbOptions, body: () => Promise<VerbResult>): Promise<void> {
  const write = (value: unknown): void => {
    if (options.json) writeJson(options.context.io, value);
    else writeHuman(options.context.io, value);
  };
  const mutation = options.kind === "mutation";
  const dryRun = options.dryRun === true;
  try {
    const outcome = await body();
    if (isRefusal(outcome)) {
      write({
        ok: false,
        ...(mutation ? { applied: false, dryRun } : {}),
        gate: outcome.refusedGate,
        violations: [...outcome.violations]
      });
      options.program.setOptionValue("exitCode", EXIT_GATE_REFUSAL);
      return;
    }
    write({
      ok: true,
      ...(mutation ? { applied: !dryRun, dryRun } : {}),
      violations: [],
      ...outcome
    });
    options.program.setOptionValue("exitCode", EXIT_OK);
  } catch (error) {
    write({ ok: false, error: (error as Error).message ?? "orchestrate command failed" });
    options.program.setOptionValue("exitCode", EXIT_OPERATIONAL_ERROR);
  }
}

// --- impure collection ----------------------------------------------------------------------------

/**
 * The run root. Deliberately not `resolveProjectRoot`: the orchestrator's artifacts live beside the
 * git root, and a run may execute in a repository that carries no `docs/spec/`.
 */
function runRoot(program: Command): string {
  const declared = program.opts().root as string | undefined;
  return path.resolve(declared ?? process.cwd());
}

function projectRoot(program: Command): ProjectRoot {
  return { root: runRoot(program) };
}

async function readJsonFile(absolutePath: string, label: string): Promise<unknown> {
  let text: string;
  try {
    text = await readFile(absolutePath, "utf8");
  } catch (error) {
    throw new OperationalError(`${label} is unreadable at ${absolutePath}: ${(error as Error).message}`, { cause: error });
  }
  try {
    return JSON.parse(text) as unknown;
  } catch (error) {
    throw new OperationalError(`${label} is not valid JSON at ${absolutePath}: ${(error as Error).message}`, { cause: error });
  }
}

/**
 * A JSONL file as one parsed value per non-blank line.
 *
 * A malformed line is an error and never a skip. The queue this reads is the only record that a
 * lane's SRS mutations happened at all, so dropping an unreadable line would report a complete plan
 * over an incomplete one — the traceability break deferring the mutations exists to prevent.
 * @req IR-CLI-091 AC-4
 */
async function readJsonLinesFile(absolutePath: string, label: string): Promise<Array<{ value: unknown; line: number }>> {
  let text: string;
  try {
    text = await readFile(absolutePath, "utf8");
  } catch (error) {
    throw new OperationalError(`${label} is unreadable at ${absolutePath}: ${(error as Error).message}`, { cause: error });
  }
  const values: Array<{ value: unknown; line: number }> = [];
  for (const [offset, line] of text.split("\n").entries()) {
    if (line.trim() === "") continue;
    try {
      values.push({ value: JSON.parse(line) as unknown, line: offset + 1 });
    } catch (error) {
      throw new OperationalError(`${label} line ${offset + 1} is not valid JSON at ${absolutePath}: ${(error as Error).message}`, {
        cause: error
      });
    }
  }
  return values;
}

/**
 * Dispatches one admitted replay call to the SRS mutation it names, at the HOST root.
 *
 * The four are exhaustive by construction: `admitReplayCalls` refuses everything else before a call
 * reaches here, so the default branch is unreachable rather than a fallback. It still returns a
 * failure instead of throwing, because a replay's account of what it attempted must survive the
 * attempt that went wrong. @req IR-CLI-092
 */
function hostRootDispatch(root: ProjectRoot): ReplayDispatch {
  return async (tool, args) => {
    // The queue carries each mutation's own argument object; admission has already refused every
    // tool but these four, so the cast is narrowing to a shape the plan was built from.
    const input = (args ?? {}) as never;
    const outcome =
      tool === "add_trace_link"
        ? await addTraceLink(root, input)
        : tool === "add_verification_evidence"
          ? await addVerificationEvidence(root, input)
          : tool === "update_status"
            ? await updateStatus(root, input)
            : tool === "add_completed_work"
              ? await addCompletedWork(root, input)
              : null;
    if (outcome === null) return { ok: false, error: `no host-root dispatch for ${tool}` };
    if (outcome.ok) return { ok: true };
    return { ok: false, error: outcome.error?.message ?? outcome.error?.code ?? "mutation refused" };
  };
}

/**
 * A `replay plan` output read back for application. Validated rather than cast: the plan is a file a
 * previous step wrote and a human reviewed, and a malformed one must not be applied silently.
 * @req IR-CLI-092
 */
function replayPlanFromJson(value: unknown, label: string, absolutePath: string): ReplayPlan {
  const fail = (detail: string): never => {
    throw new OperationalError(`${label} is not a replay plan at ${absolutePath}: ${detail}`);
  };
  if (typeof value !== "object" || value === null) return fail("not an object");
  const calls = (value as { calls?: unknown }).calls;
  if (!Array.isArray(calls)) return fail("no calls array");
  calls.forEach((call, index) => {
    if (typeof call !== "object" || call === null) fail(`calls[${index}] is not an object`);
    const row = call as { tool?: unknown; argsHash?: unknown; action?: unknown };
    if (typeof row.tool !== "string" || row.tool.length === 0) fail(`calls[${index}].tool is not a name`);
    if (typeof row.argsHash !== "string" || row.argsHash.length === 0) fail(`calls[${index}].argsHash is missing`);
    if (row.action !== "apply" && row.action !== "skip-duplicate") fail(`calls[${index}].action is not a plan action`);
  });
  return value as ReplayPlan;
}

/**
 * The persisted replay index, validated into the planner's input type rather than cast onto it.
 *
 * `new Set("abc")` is a set of three CHARACTERS. A string where a hash array belongs would not throw
 * — it would dedupe against nonsense and then persist that nonsense back as the index, so every
 * later run keys against it too.
 *
 * The result is null-prototype for the same reason `replayDeferredMutations` builds its output that
 * way: `index["__proto__"] = [...]` on an ordinary object sets the prototype and stores nothing, so
 * a mutation the index recorded as applied would be replayed again. @req IR-CLI-091 AC-4
 */
function replayIndexFromJson(value: unknown, label: string, absolutePath: string): ReplayIndex {
  const reject = (detail: string): never => {
    throw new OperationalError(`${label} is not a replay index at ${absolutePath}: ${detail}`);
  };
  if (typeof value !== "object" || value === null || Array.isArray(value)) return reject("expected a JSON object");
  const index = Object.create(null) as ReplayIndex;
  for (const [tool, hashes] of Object.entries(value as Record<string, unknown>)) {
    if (!Array.isArray(hashes) || hashes.some((hash) => typeof hash !== "string")) {
      return reject(`\`${tool}\` must map to an array of hash strings`);
    }
    index[tool] = hashes as string[];
  }
  return index;
}

/**
 * The harvested queue, validated into the planner's input type rather than cast onto it.
 *
 * `JSON.parse` accepts `5`, `"x"` and `[]`, and an entry missing `tool` plans a call whose tool is
 * `undefined` — measured: it produced an `"undefined"` key in `indexAfter` and still reported
 * success. The queue is written by a skill rather than by this code, so a line that is valid JSON of
 * the wrong shape is the realistic corruption, and a replay that silently drops or mis-keys a lane's
 * mutation is the exact traceability break deferring those mutations exists to prevent.
 * @req IR-CLI-091 AC-4
 */
function deferredMutationsFromQueue(entries: Array<{ value: unknown; line: number }>, label: string, absolutePath: string): DeferredMutation[] {
  return entries.map(({ value, line }) => {
    const reject = (detail: string): never => {
      throw new OperationalError(`${label} line ${line} is not a deferred mutation at ${absolutePath}: ${detail}`);
    };
    if (typeof value !== "object" || value === null || Array.isArray(value)) return reject("expected a JSON object");
    const record = value as Record<string, unknown>;
    if (typeof record.tool !== "string" || record.tool === "") return reject("`tool` must be a non-empty string");
    // `args` is `unknown` to the kernel, but it must be PRESENT: a missing one hashes as `undefined`
    // and would collide with every other entry that also omitted it.
    if (!("args" in record)) return reject("`args` is missing");
    return { tool: record.tool, args: record.args };
  });
}

function parseInlineJson(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "string" || value.length === 0) throw new OperationalError(`${label} is required`);
  let parsed: unknown;
  try {
    parsed = JSON.parse(value) as unknown;
  } catch (error) {
    throw new OperationalError(`${label} is not valid JSON: ${(error as Error).message}`, { cause: error });
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new OperationalError(`${label} must be a JSON object`);
  }
  return parsed as Record<string, unknown>;
}

/**
 * `auto-gate decide`'s `--payload`, validated into the kernel's declared shape.
 *
 * The rung is **refused, not ignored**. A7 is DECLINED 5-0 (`08` §2), so no rung is implemented
 * behind the parameter and this is the one shipped construction — it passes `false` and reads
 * nothing from the payload. Ignoring a caller's `true` would leave that caller believing a rung ran
 * and reading the resulting `escalate-critical` as the rung's own answer; refusing says the rung
 * does not exist, which is the same treatment a gate id outside the closed vocabulary gets below.
 * A reversal deletes the refusal and reads the field, which stays additive. @req FR-NODE-124 AC-9
 *
 * Every other field is checked rather than cast: `critical` in particular is required, because
 * defaulting it would silently drop the halt a `critical_gates[]` member exists to force.
 */
export function autoGateInputFromPayload(payload: Record<string, unknown>): AutoGateInput {
  if (payload.tieRung !== undefined && payload.tieRung !== false) {
    throw new OperationalError("--payload cannot enable the tie rung: it is declined (08 §2) and no rung is implemented behind the parameter");
  }

  const gateId = payload.gateId;
  if (typeof gateId !== "string") throw new OperationalError("--payload.gateId must be a string");
  if (!(GATE_IDS as readonly string[]).includes(gateId)) {
    throw new OperationalError(`gate '${gateId}' is outside the closed GateId vocabulary`);
  }

  const critical = payload.critical;
  if (typeof critical !== "boolean") throw new OperationalError("--payload.critical must be a boolean");

  const mode = payload.mode;
  if (mode !== "auto" && mode !== "auto-max") throw new OperationalError("--payload.mode must be 'auto' or 'auto-max'");

  if (!Array.isArray(payload.options)) throw new OperationalError("--payload.options must be an array");
  const options = payload.options.map((entry, index) => {
    const option = entry as Record<string, unknown> | null;
    if (typeof option?.id !== "string" || typeof option.recommended !== "boolean" || typeof option.defaultIfAuto !== "boolean") {
      throw new OperationalError(`--payload.options[${index}] must carry a string id and boolean recommended and defaultIfAuto`);
    }
    return { id: option.id, recommended: option.recommended, defaultIfAuto: option.defaultIfAuto };
  });

  let votes: AutoGateInput["votes"] = null;
  if (payload.votes !== undefined && payload.votes !== null) {
    if (!Array.isArray(payload.votes)) throw new OperationalError("--payload.votes must be an array or null");
    votes = payload.votes.map((entry, index) => {
      const vote = entry as Record<string, unknown> | null;
      if (typeof vote?.member !== "string" || typeof vote.optionId !== "string" || typeof vote.confidence !== "number") {
        throw new OperationalError(`--payload.votes[${index}] must carry a string member, a string optionId and a numeric confidence`);
      }
      return { member: vote.member, optionId: vote.optionId, confidence: vote.confidence };
    });
  }

  const quorum = payload.quorum as Record<string, unknown> | null | undefined;
  if (typeof quorum?.expected !== "number" || typeof quorum.present !== "number") {
    throw new OperationalError("--payload.quorum must carry numeric expected and present counts");
  }

  return { gateId, critical, options, mode, votes, quorum: { expected: quorum.expected, present: quorum.present }, tieRung: false };
}

function requireOption(value: unknown, flag: string): string {
  if (typeof value !== "string" || value.length === 0) throw new OperationalError(`${flag} is required`);
  return value;
}

async function writeUnderRoot(root: string, relativePath: string, text: string): Promise<string> {
  const absolute = path.resolve(root, relativePath);
  await mkdir(path.dirname(absolute), { recursive: true });
  await writeFile(absolute, text, "utf8");
  return absolute;
}

/**
 * Every declared entry of the normalised catalogue, `files[]` and `test_files[]` alike.
 *
 * Read off `TaskCatalogEntry` rather than the raw sidecar so grounding sees the same normalised,
 * `[INFERRED:]`-stripped paths the conflict analysis does — a label-bearing string would defeat both.
 * @req IR-CLI-084 AC-4
 */
function declaredEntriesOf(catalog: readonly TaskCatalogEntry[]): DeclaredEntry[] {
  const entries: DeclaredEntry[] = [];
  for (const task of catalog) {
    for (const entry of [...task.files, ...task.testFiles]) {
      entries.push({ path: entry.path, ...(entry.lineRange ? { lineRange: entry.lineRange } : {}) });
    }
  }
  return entries;
}

/** Line counts for the declared entries that exist, read once so the detector stays pure. */
async function collectLineCounts(root: string, existingPaths: readonly string[]): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  for (const relativePath of existingPaths) {
    try {
      const text = await readFile(path.resolve(root, relativePath), "utf8");
      counts[relativePath] = text.length === 0 ? 0 : text.split(/\r?\n/).length;
    } catch {
      // A path the caller declared existing but that cannot be read is simply not counted; the
      // line-range rule then has no comparand and the entry is grounded on existence alone.
    }
  }
  return counts;
}


/**
 * Releases a run lock this process may not have acquired.
 *
 * `release` takes the `RunLock` its own `acquire` returned, and a fresh `speckiwi orchestrate run
 * unlock` has no such handle — so the token is read back off the sentinel here (impure collection)
 * and the module's own release performs the token check and closes the kernel fence. Unlinking the
 * sentinel directly would skip both, which within one process leaves the fence held and makes the
 * next acquire refuse a lock nobody holds.
 *
 * **This belongs in `src/core/orchestrator/run-lock.ts` as a release-by-path entry point**, beside
 * `acquire` / `renew` / `release`: the sentinel's format is that module's business, and reading its
 * token from outside couples this file to a shape it does not own.
 */
async function releaseRunLock(commonDir: string): Promise<{ owner: string | null }> {
  const lockPath = runLockPath(commonDir);
  const raw = await readFile(lockPath, "utf8").catch(() => null);
  if (raw === null) return { owner: null };
  let record: { token?: unknown; owner?: unknown } = {};
  try {
    record = JSON.parse(raw) as { token?: unknown; owner?: unknown };
  } catch {
    // A torn sentinel names no token and no owner; removing it is the only available recovery.
    await rm(lockPath, { force: true });
    return { owner: null };
  }
  const owner = typeof record.owner === "string" ? record.owner : null;
  if (typeof record.token !== "string") {
    await rm(lockPath, { force: true });
    return { owner };
  }
  await release({ commonDir, lockPath, token: record.token, owner: owner ?? "" });
  return { owner };
}

// --- the journal --------------------------------------------------------------------------------

interface JournalAppendOutcome {
  readonly written: boolean;
  readonly diagnostics: readonly { code: string; message: string; severity: string }[];
}

/**
 * Appends one stamped line, validating the **resulting** journal before the write lands.
 *
 * The candidate is materialised beside the journal and parsed with the same parser a reader uses,
 * so validation runs over a real view rather than a reconstructed one. A refusal unlinks the
 * candidate, which leaves the journal byte-identical. There is no flag that skips this.
 *
 * **This belongs in `src/core/orchestrator/waves-journal.ts` as `appendWavesEvent`**, which 05 §10.6
 * names as the kernel behind `orchestrate journal append`. That module exports only the parse today,
 * so the write lives here; the stamp, the validate-then-rename and the refusal path move with it.
 * @req FR-NODE-127
 */
async function appendWavesLine(
  root: ProjectRoot,
  relativePath: string,
  runId: string,
  payload: Record<string, unknown>,
  dryRun: boolean
): Promise<JournalAppendOutcome> {
  const absolute = path.resolve(root.root, relativePath);
  const candidateRelative = `${relativePath}.candidate`;
  const candidateAbsolute = path.resolve(root.root, candidateRelative);
  const existing = await readFile(absolute, "utf8").catch(() => "");
  const stamped = { ...payload, writer: JOURNAL_WRITER_STAMP };
  const separator = existing.length === 0 || existing.endsWith("\n") ? "" : "\n";
  await mkdir(path.dirname(candidateAbsolute), { recursive: true });
  await writeFile(candidateAbsolute, `${existing}${separator}${JSON.stringify(stamped)}\n`, "utf8");
  try {
    const view = await parseWavesJournal(root, { runId, engine: "kiwi-orchestrator", relativePath: candidateRelative });
    const diagnostics = validateWavesJournal(view).map((entry) => ({
      code: entry.code,
      message: entry.message,
      severity: entry.severity
    }));
    if (diagnostics.some((entry) => entry.severity === "error")) return { written: false, diagnostics };
    if (dryRun) return { written: false, diagnostics };
    await rename(candidateAbsolute, absolute);
    return { written: true, diagnostics };
  } finally {
    await rm(candidateAbsolute, { force: true });
  }
}

/** Reads a run's journal view, or throws an operational error when the file cannot be parsed. */
async function readJournalView(root: ProjectRoot, runId: string, relativePath: string): Promise<WavesJournalView> {
  try {
    return await parseWavesJournal(root, { runId, engine: "kiwi-orchestrator", relativePath });
  } catch (error) {
    throw new OperationalError(`the run journal is unreadable at ${relativePath}: ${(error as Error).message}`, { cause: error });
  }
}

/**
 * The card bytes a `freeze-route` must leave behind, or `null` when there are none to write.
 *
 * `null` covers the two cases that are not defects: a run that has not written its first card yet —
 * the route is frozen at 1.c′ and the card may follow — and a redo whose card already carries this
 * exact entry, which must not touch the file at all or `noop` would be true of the lock and false of
 * the run. Everything else is a refusal, and the caller writes nothing at all on one, so a card that
 * fails validation cannot leave a lock on disk that no card names.
 * @req FR-NODE-113 AC-4
 */
async function planRouteCardUpdate(
  root: string,
  options: Record<string, unknown>,
  lock: RouteLock
): Promise<{ relativePath: string; text: string } | GateRefusal | null> {
  const relativePath = (options.card as string | undefined) ?? resumeCardPath(lock.run_id);
  const existing = await readFile(path.resolve(root, relativePath), "utf8").catch(() => null);
  if (existing === null) return null;

  const parsed = readCard(existing);
  if (!parsed.ok) return refuse("resume-card-missing-or-invalid", parsed.violations);
  const frozen = { ...parsed.card.frozen, route: frozenRouteEntry(options.out as string, lock) };
  // `invariant_digest` is recomputed here rather than left to the next `card write`: the digest is
  // what makes a post-freeze byte change surface as drift, and a card whose frozen block moved
  // without it is a card the resume path refuses.
  const next: ResumeCard = { ...parsed.card, frozen, invariant_digest: computeInvariantDigest(frozen) };
  const view = await readJournalView({ root }, lock.run_id, options.journal as string);
  const written = writeCard(next, view);
  if (!written.ok) return refuse("resume-card-missing-or-invalid", written.violations);
  return written.text === existing ? null : { relativePath, text: written.text };
}

// --- registration ----------------------------------------------------------------------------------

/** Options every verb carries. `--json` is mandatory on every row (05 §10.6). */
function addCommonOptions(target: Command): Command {
  return target.option("--json", "JSON output");
}

/** Options every mutation verb carries on top of {@link addCommonOptions}. */
function addMutationOptions(target: Command): Command {
  return addCommonOptions(target).option("--dry-run", "compute and report without writing");
}

function jsonMode(program: Command, options: Record<string, unknown>): boolean {
  return Boolean(options.json) || Boolean(program.opts().json);
}

export function registerOrchestrateCommands(command: Command, context: CliContext): void {
  const orchestrate = command.command("orchestrate").description("kiwi-orchestrator run surface (phase 1)");

  const read = (target: Command, options: Record<string, unknown>, body: () => Promise<VerbResult>): Promise<void> =>
    runVerb({ program: command, context, json: jsonMode(command, options), kind: "read" }, body);
  const mutate = (options: Record<string, unknown>, body: () => Promise<VerbResult>): Promise<void> =>
    runVerb(
      { program: command, context, json: jsonMode(command, options), kind: "mutation", dryRun: options.dryRun === true },
      body
    );

  // ---- resume -------------------------------------------------------------------------------------
  addCommonOptions(orchestrate.command("resume"))
    .option("--run-id <id>", "the run whose lines are read")
    .option("--journal <path>", "run journal path", WAVES_JOURNAL_PATH)
    .option("--card <path>", "resume card path")
    .option("--facts <path>", "collected git facts and drift inputs, as JSON")
    .action(async (options) => {
      await read(orchestrate, options, async () => {
        const root = projectRoot(command);
        const runId = requireOption(options.runId, "--run-id");
        const view = await readJournalView(root, runId, options.journal as string);
        // @req FR-NODE-127 AC-3 — an invalid journal refuses before any resume state is computed.
        const invalid = validateWavesJournal(view).filter((entry) => entry.severity === "error");
        if (invalid.length > 0) {
          return refuse("ledger-reconciliation-divergent", invalid.map((entry) => ({ code: entry.code, message: entry.message })));
        }
        const cardPath = (options.card as string | undefined) ?? resumeCardPath(runId);
        const cardText = await readFile(path.resolve(root.root, cardPath), "utf8").catch(() => null);
        if (cardText === null) return refuse("resume-card-missing-or-invalid", [{ code: "card-unreadable", path: cardPath }]);
        const parsed = readCard(cardText);
        if (!parsed.ok) return refuse("resume-card-missing-or-invalid", parsed.violations);
        // @req FR-NODE-162 - validate the card we READ, against the journal as it stands now.
        // `readCard` only parses; `validateCard`'s ten violations were enforced by `writeCard` alone,
        // so nine of them passed here, including the byte cap this gate names and the closed-verb
        // check the skill body promises. Three of the ten compare the card against the journal, and
        // the journal grows after the card is written, so write-time validation cannot cover them.
        const cardValidation = validateCard(parsed.card, view);
        if (!cardValidation.ok) return refuse("resume-card-missing-or-invalid", cardValidation.violations.map((code) => ({ code })));
        // @req FR-NODE-180 — the card has always carried the run's two roots and the invariant digest
        // has always covered them, but nothing compared them to the world: the digest proves the card
        // did not change, not that this session is in the repository the run was pinned to. The
        // preflight guards the start of a run; a resume had no equivalent, and a resumed session has
        // no conversation to contradict it. Neither side is derived from the other — the pinned side
        // was written in an earlier session, the observed side is measured from the root being
        // resumed — so this comparison is not the vacuous one the preflight arguments exist to avoid.
        const pinnedToplevel = parsed.card.frozen?.run_root?.git_toplevel;
        // @req FR-NODE-180 AC-7 — a missing pin refuses rather than skipping the check. Skipping was
        // the same forgery this requirement's sibling was written against: `validateCard` never
        // mentions `run_root` and `computeInvariantDigest` hashes whatever `frozen` holds, so a card
        // with the field deleted and the digest recomputed is self-consistent, passes validation, and
        // would have resumed anywhere at all. Every card `writeCard` produces carries the field.
        if (typeof pinnedToplevel !== "string" || pinnedToplevel.length === 0) {
          return refuse("run-invariant-drift", [{ code: "run-root-unpinned", resumedRoot: root.root }]);
        }
        const observed = await gitToplevelOf(root.root);
        if (observed === undefined || !normaliseRoot(pinnedToplevel, observed, realpathProbe).match) {
          return refuse("run-invariant-drift", [
            { code: "run-root-moved", pinned: pinnedToplevel, observed: observed ?? null, resumedRoot: root.root }
          ]);
        }
        const facts = options.facts
          ? ((await readJsonFile(path.resolve(root.root, options.facts as string), "--facts")) as {
              gitFacts?: GitFacts;
              driftInputs?: DriftInputs;
            })
          : {};
        if (!facts.gitFacts || !facts.driftInputs) {
          throw new OperationalError("--facts must supply both gitFacts and driftInputs; the tool never invents them");
        }
        const state = computeResumeState(view, parsed.card, facts.gitFacts, facts.driftInputs);
        if (state.blocking !== null) return refuse(state.blocking, state.drift.digests.filter((entry) => entry.gate !== null));
        // @req FR-NODE-113 AC-5 — 09 §9.5 step 2: the rung is READ off the card. `computeRoute` is
        // reachable from this file, so the read is written out here rather than left implicit — a
        // resumed session has no conversation and no investigators, and several probe fields are not
        // reproducible across a compaction, so a recomputation could legally switch ladders mid-run.
        // Reported only past the drift gate above: a refused resume dispatches nothing.
        const route = parsed.card.frozen?.route;
        return { resume: state, rung: route === undefined ? null : resumeRung(route) };
      });
    });

  // ---- preflight ----------------------------------------------------------------------------------
  addCommonOptions(orchestrate.command("preflight"))
    // @req IR-CLI-082 AC-6 — both roots are arguments; neither is derived from the process cwd,
    // because the CLI resolves cwd and the MCP server fixes its own, so an in-tool read is vacuous.
    .requiredOption("--mcp-root <path>", "the root the MCP server reports")
    .requiredOption("--git-root <path>", "the root `git rev-parse --show-toplevel` reports")
    .action(async (options) => {
      await read(orchestrate, options, async () => {
        // @req FR-NODE-178 — resolved before the pure verdict rather than inside it: the answer needs
        // a subprocess, and the comparison module holds no facility to run one, which is the same
        // reason `realpath` arrives injected.
        const toplevel = await gitToplevelOf(options.gitRoot as string);
        const verdict = preflightRunRoot(options.mcpRoot as string, options.gitRoot as string, {
          realpath: realpathProbe,
          gitToplevel: () => toplevel
        });
        // @req IR-CLI-090 — the reason travels inside the violation. The gate vocabulary is a closed
        // union with a parity assertion over it, so three conditions share one gate id and are told
        // apart by a field; widening the union would cost more than the diagnosis is worth.
        if (!verdict.ok) {
          return refuse("run-root-preflight-mismatch", [
            { reason: verdict.reason, gitToplevel: verdict.gitToplevel, ...verdict.comparison }
          ]);
        }
        return { comparison: verdict.comparison, gitToplevel: verdict.gitToplevel };
      });
    });

  // ---- route --------------------------------------------------------------------------------------
  const route = orchestrate.command("route").description("routing probe, freeze and review");

  addMutationOptions(route.command("probe"))
    .option("--probe <path>", "a probe document produced by the declared producers")
    .option("--payload <json>", "the probe document, inline")
    .option("--out <path>", "where the parsed probe is written", "routing/probe.json")
    .action(async (options) => {
      await mutate(options, async () => {
        const root = runRoot(command);
        const document = options.probe
          ? await readJsonFile(path.resolve(root, options.probe as string), "--probe")
          : parseInlineJson(options.payload, "--payload");
        const probe = parseRouteProbe(document);
        // @req IR-CLI-082 AC-7 — the parser reports what it could not read rather than defaulting it,
        // and an unreadable field is a refusal, never a substituted value.
        if (probe.unreadable.length > 0) {
          return refuse("route-probe-unreadable", probe.unreadable.map((field) => ({ field })));
        }
        if (options.dryRun !== true) await writeUnderRoot(root, options.out as string, `${JSON.stringify(document, null, 2)}\n`);
        return { probe, out: options.out };
      });
    });

  addMutationOptions(route.command("freeze"))
    .option("--probe <path>", "the frozen probe document", "routing/probe.json")
    .option("--gate <path>", "the gate-resolution record", "routing/route-gate.json")
    .option("--out <path>", "where the route lock is written", "routing/route.lock.json")
    .option("--card <path>", "the resume card the frozen route joins")
    .option("--journal <path>", "run journal path", WAVES_JOURNAL_PATH)
    .option("--auto", "the run is unattended")
    .action(async (options) => {
      await mutate(options, async () => {
        const root = runRoot(command);
        const probe = parseRouteProbe(await readJsonFile(path.resolve(root, options.probe as string), "--probe"));
        if (probe.unreadable.length > 0) {
          return refuse("route-probe-unreadable", probe.unreadable.map((field) => ({ field })));
        }
        const gate = (await readJsonFile(path.resolve(root, options.gate as string), "--gate")) as RouteGateRecord;
        const decision = computeRoute(probe, { auto: options.auto === true });
        const lock = freezeRoute(probe, decision, gate);
        const digest = routeLockDigest(lock);
        const existing = await readFile(path.resolve(root, options.out as string), "utf8").catch(() => null);
        // Content-addressed: a redo whose digest matches is a no-op, not a rewrite (05 §4.4).
        const unchanged = existing !== null && routeLockDigest(JSON.parse(existing) as RouteLock) === digest;
        // @req FR-NODE-113 AC-4 — the freeze is not finished when the lock lands: `frozen.route` is
        // what pulls the lock's digest into `invariant_digest` (09 §9.3), and a lock no card names is
        // a decision of record nothing on the resume path can find. Computed before either write, so
        // a card that fails validation leaves the lock untouched too.
        const update = await planRouteCardUpdate(root, options, lock);
        if (isRefusal(update)) return update;
        if (options.dryRun !== true) {
          if (!unchanged) await writeUnderRoot(root, options.out as string, serializeRouteLock(lock));
          if (update !== null) await writeUnderRoot(root, update.relativePath, update.text);
        }
        return { lock, digest, noop: unchanged, out: options.out, card: update?.relativePath ?? null };
      });
    });

  addCommonOptions(route.command("show"))
    .option("--lock <path>", "the route lock to read", "routing/route.lock.json")
    .action(async (options) => {
      await read(orchestrate, options, async () => {
        const lock = (await readJsonFile(path.resolve(runRoot(command), options.lock as string), "--lock")) as RouteLock;
        return { lock, digest: routeLockDigest(lock) };
      });
    });

  // ---- run lifecycle -------------------------------------------------------------------------------
  const run = orchestrate.command("run").description("run lock and abort");

  addMutationOptions(run.command("lock"))
    .option("--owner <owner>", "the run holding the lock", "kiwi-orchestrator")
    .action(async (options) => {
      await mutate(options, async () => {
        const commonDir = await resolveGitCommonDir(runRoot(command));
        if (options.dryRun === true) {
          const holder = await readHolder(commonDir);
          if (holder) return refuse("orchestrator-run-lock-held", [holder]);
          return { lockPath: runLockPath(commonDir) };
        }
        try {
          const lock = await acquire({ commonDir, owner: options.owner as string });
          return { lockPath: lock.lockPath };
        } catch (error) {
          if (error instanceof RunLockHeldError) return refuse(error.gate, [{ owner: error.owner, lockPath: error.lockPath }]);
          throw error;
        }
      });
    });

  addMutationOptions(run.command("unlock")).action(async (options) => {
    await mutate(options, async () => {
      const commonDir = await resolveGitCommonDir(runRoot(command));
      const holder = await readHolder(commonDir);
      if (holder === null) return { lockPath: runLockPath(commonDir), heldBy: null };
      if (options.dryRun !== true) await releaseRunLock(commonDir);
      return { lockPath: runLockPath(commonDir), heldBy: holder.owner };
    });
  });

  addCommonOptions(run.command("status")).action(async (options) => {
    await read(orchestrate, options, async () => {
      const commonDir = await resolveGitCommonDir(runRoot(command));
      return { lockPath: runLockPath(commonDir), holder: await readHolder(commonDir) };
    });
  });

  addMutationOptions(run.command("abort"))
    // @req IR-CLI-085 AC-5 — the help names the vocabulary. Described as free text, the option took
    // a `reason_class` member for a gate id, and a fixture had already made that mistake.
    .requiredOption("--reason <gate-id>", "the gate that ended the run; a GateId member, not free text")
    .option("--run-id <id>", "the run being abandoned")
    .option("--journal <path>", "run journal path", WAVES_JOURNAL_PATH)
    .action(async (options) => {
      await mutate(options, async () => {
        const root = projectRoot(command);
        const runId = requireOption(options.runId, "--run-id");
        const commonDir = await resolveGitCommonDir(root.root);
        const outcome = await appendWavesLine(
          root,
          options.journal as string,
          runId,
          // @req FR-NODE-167 — `abort_gate`, never `reason_class`: that name belongs to
          // `verification.residual[]` over a different closed vocabulary, and at top level it was
          // both undeclared and unenforced.
          { schema_version: "1.4.0", run_id: runId, engine: "kiwi-orchestrator", verb: "abort-run", event: "result", wave: "all", abort_gate: options.reason },
          options.dryRun === true
        );
        if (!outcome.written && options.dryRun !== true) return refuse("run-invariant-drift", outcome.diagnostics);
        if (options.dryRun !== true) await releaseRunLock(commonDir);
        return { reason: options.reason, journalWritten: outcome.written };
      });
    });

  // ---- journal ---------------------------------------------------------------------------------------
  const journal = orchestrate.command("journal").description("the run journal");

  addMutationOptions(journal.command("append"))
    .option("--run-id <id>", "the run the line belongs to")
    .option("--payload <json>", "the journal line, inline")
    .option("--journal <path>", "run journal path", WAVES_JOURNAL_PATH)
    .action(async (options) => {
      await mutate(options, async () => {
        const root = projectRoot(command);
        const runId = requireOption(options.runId, "--run-id");
        const payload = parseInlineJson(options.payload, "--payload");
        const outcome = await appendWavesLine(root, options.journal as string, runId, payload, options.dryRun === true);
        // @req FR-NODE-127 AC-1 — a write that would leave the journal invalid is refused, and the
        // journal is byte-identical after the attempt.
        if (outcome.diagnostics.some((entry) => entry.severity === "error")) {
          return refuse("run-invariant-drift", outcome.diagnostics);
        }
        // @req FR-NODE-127 AC-2 — the validation ran; an empty set is reported, never skipped.
        return { written: outcome.written, diagnostics: outcome.diagnostics, journal: options.journal };
      });
    });

  // ---- resume card -----------------------------------------------------------------------------------
  const card = orchestrate.command("card").description("the resume card");

  addMutationOptions(card.command("write"))
    .option("--run-id <id>", "the run the card belongs to")
    .option("--payload <json>", "the resume card, inline")
    .option("--journal <path>", "run journal path", WAVES_JOURNAL_PATH)
    .action(async (options) => {
      await mutate(options, async () => {
        const root = projectRoot(command);
        const runId = requireOption(options.runId, "--run-id");
        const payload = parseInlineJson(options.payload, "--payload") as unknown as ResumeCard;
        const view = await readJournalView(root, runId, options.journal as string);
        const written = writeCard(payload, view);
        if (!written.ok) return refuse("resume-card-missing-or-invalid", written.violations);
        if (options.dryRun !== true) await writeUnderRoot(root.root, written.relativePath, written.text);
        return { path: written.relativePath };
      });
    });

  // ---- freeze -----------------------------------------------------------------------------------------
  const freeze = orchestrate.command("freeze").description("content-address a run artifact set");
  for (const target of FREEZE_TARGETS) {
    addMutationOptions(freeze.command(target))
      .requiredOption("--body <path>", "the lock body for this kind, as JSON")
      .requiredOption("--document <path>", "the artifact the lock pins")
      .requiredOption("--head <sha>", "the commit the document is pinned at")
      .option("--run-id <id>", "the run the lock belongs to")
      .option("--declared-inputs <path>", "the declared inputs recorded in the lock, as JSON")
      .option("--out <path>", "where the lock is written")
      .action(async (options) => {
        await mutate(options, async () => {
          const root = runRoot(command);
          const runId = requireOption(options.runId, "--run-id");
          const body = (await readJsonFile(path.resolve(root, options.body as string), "--body")) as Record<string, unknown>;
          const declaredInputs = options.declaredInputs
            ? ((await readJsonFile(path.resolve(root, options.declaredInputs as string), "--declared-inputs")) as Record<string, unknown>)
            : {};
          // H1: the real `git_blob_oid` comes from `pinning.ts`; `freeze.ts` makes no git call, and
          // a null placeholder would make the §4.7 drift digest unprovable.
          let gitBlobOid: string;
          try {
            const pinned = await pinHandoff({ root, expectedHead: options.head as string, documentPaths: [options.document as string] });
            gitBlobOid = pinned.documents[0]?.gitBlobOid ?? "";
          } catch (error) {
            if (error instanceof HandoffPinError) return refuse(error.gate, [{ message: error.message }]);
            throw error;
          }
          const frozen = freezeLock(target, body, { runId, gitBlobOid, writtenAt: new Date().toISOString(), declaredInputs });
          if (!frozen.ok) return refuse("design-not-frozen", [{ code: frozen.code, detail: frozen.detail }]);
          const out = (options.out as string | undefined) ?? `kiwi/orchestrator/${runId}/${target}.lock.json`;
          if (options.dryRun !== true) await writeUnderRoot(root, out, serializeLock(frozen.lock));
          return { lock: frozen.lock, out };
        });
      });
  }

  // ---- readiness ----------------------------------------------------------------------------------------
  const readiness = orchestrate.command("readiness").description("derived requirement readiness");

  addCommonOptions(readiness.command("check"))
    .requiredOption("--target <target>", "the target whose requirements are checked")
    .requiredOption("--snapshot <path>", "a requirement snapshot, as JSON")
    .option("--req <id>", "a requirement id to check (repeatable)", (value: string, previous: string[]) => [...previous, value], [])
    .action(async (options) => {
      await read(orchestrate, options, async () => {
        const payload = await readJsonFile(path.resolve(runRoot(command), options.snapshot as string), "--snapshot");
        const snapshot = parseRequirementSnapshot(payload as never);
        try {
          return { readiness: assertRequirementsReady(snapshot, options.target as string, options.req as string[]) };
        } catch (error) {
          if (error instanceof RequirementNotReadyError) {
            return refuse(error.gate, [...error.notReady, ...error.unresolved.map((id) => ({ id, reason: "unresolved" }))]);
          }
          throw error;
        }
      });
    });

  // ---- schedule -------------------------------------------------------------------------------------------
  const schedule = orchestrate.command("schedule").description("the lane partition");

  addMutationOptions(schedule.command("plan"))
    .requiredOption("--plan <path>", "the planner sidecar")
    .option("--lanes <n>", "per-stage lane cap", "4")
    .option("--allow-inferred-write-set", "permit [INFERRED: write sets to be lane-eligible")
    // @req IR-CLI-084 AC-6 — off by default, and journalled when used.
    .option("--strict-grounding", "require every declared path to exist at the dispatch base")
    .option("--existing-paths <path>", "the dispatch base path list, as JSON")
    .option("--out <path>", "where the lane plan is written", "waves/lanes.lock.json")
    .option("--run-id <id>", "the run whose journal records the option use")
    .option("--journal <path>", "run journal path", WAVES_JOURNAL_PATH)
    .action(async (options) => {
      await mutate(options, async () => {
        const root = runRoot(command);
        const sidecar = (await readJsonFile(path.resolve(root, options.plan as string), "--plan")) as Record<string, unknown>;
        const existingPaths = options.existingPaths
          ? ((await readJsonFile(path.resolve(root, options.existingPaths as string), "--existing-paths")) as string[])
          : [];
        const catalog = normalizeTasks(
          (sidecar.tasks ?? []) as SidecarTask[],
          null,
          [],
          options.plan as string,
          (sidecar.phases ?? []) as SidecarPhase[]
        );
        const declared = declaredEntriesOf(catalog);
        const lineCounts = await collectLineCounts(root, existingPaths);
        // @req IR-CLI-084 AC-5 — the impure collection above ends here; the judgment is the pure
        // detector, and it runs BEFORE the planner is called.
        const grounding = groundFiles(declared, existingPaths, lineCounts, options.strictGrounding === true);
        const ungrounded = grounding.filter((entry) => isGroundingRefusal(entry.verdict));
        // @req FR-NODE-165 — the outcome is read, not discarded. A refused append leaves the journal
        // byte-identical, so returning a plan here would report the option use as recorded against a
        // journal that never received it.
        let journalWritten = false;
        if (options.strictGrounding === true && typeof options.runId === "string" && options.runId.length > 0) {
          const outcome = await appendWavesLine(
            projectRoot(command),
            options.journal as string,
            options.runId,
            { schema_version: "1.4.0", run_id: options.runId, engine: "kiwi-orchestrator", verb: "freeze-lane-plan", event: "intent", wave: "all", strict_grounding: true },
            options.dryRun === true
          );
          if (!outcome.written && options.dryRun !== true) return refuse("run-invariant-drift", outcome.diagnostics);
          journalWritten = outcome.written;
        }
        if (ungrounded.length > 0) return refuse("files-not-grounded", ungrounded);
        const input: LanePlanInput = {
          catalog,
          registry: (sidecar.registry ?? []) as LanePlanInput["registry"],
          existingModules: (sidecar.existing_modules ?? []) as string[],
          // @req IR-CLI-084 AC-5 — injected by the command; the planner never reads the filesystem.
          existingPaths: [...existingPaths],
          priorPostmortems: (sidecar.prior_postmortems ?? []) as LanePlanInput["priorPostmortems"],
          designItemMap: (sidecar.design_item_map ?? {}) as Record<string, string[]>,
          laneCap: Number.parseInt(options.lanes as string, 10),
          // Globs, because `insideRoots` matches them as globs; a bare `src` would classify every
          // code task `non-code-write-set` and route the whole wave to the serial epilogue.
          codeRoots: (sidecar.code_roots ?? ["src/**"]) as string[],
          testRoots: (sidecar.test_roots ?? ["test/**"]) as string[]
        };
        try {
          const plan = computeLanePlan(input);
          if (options.dryRun !== true) await writeUnderRoot(root, options.out as string, `${JSON.stringify(plan, null, 2)}\n`);
          return { plan, grounding, out: options.out, journalWritten };
        } catch (error) {
          if (error instanceof LanePlanError) return refuse(error.code, [{ message: error.message }]);
          throw error;
        }
      });
    });

  addCommonOptions(schedule.command("show"))
    .option("--lock <path>", "the lane plan lock", "waves/lanes.lock.json")
    .action(async (options) => {
      await read(orchestrate, options, async () => ({
        plan: await readJsonFile(path.resolve(runRoot(command), options.lock as string), "--lock")
      }));
    });

  // ---- coupling ---------------------------------------------------------------------------------------------
  const coupling = orchestrate.command("coupling").description("cross-lane coupling within a stage");

  addCommonOptions(coupling.command("check"))
    .requiredOption("--handoffs <path>", "the stage's parsed handoffs, as JSON")
    .option("--wave <n>", "the wave under inspection")
    .option("--stage <s>", "the stage under inspection")
    // @req FR-NODE-136 AC-7 — 3.f-prime-prime is bounded at one re-partition pass per stage. The
    // caller states which pass this is; the tool never infers it, having no memory between calls.
    .option(
      "--repartition-pass <n>",
      "re-partition passes this stage has already had; 0 (the default) reports couplings and asks for one pass, 1 or more raises stage-coupling-unresolved",
      "0"
    )
    .action(async (options) => {
      await read(orchestrate, options, async () => {
        const handoffs = (await readJsonFile(path.resolve(runRoot(command), options.handoffs as string), "--handoffs")) as ParsedHandoff[];
        const { couplings } = planStageCoupling(handoffs);
        const pass = Number.parseInt(options.repartitionPass as string, 10);
        if (!Number.isInteger(pass) || pass < 0) throw new OperationalError("--repartition-pass must be a non-negative integer");
        // A stage needing two rounds of re-partitioning is mis-partitioned rather than merely
        // coupled, which is why the second hit is a gate and the first is an instruction.
        if (couplings.length > 0 && pass >= 1) return refuse("stage-coupling-unresolved", couplings);
        return { couplings, repartitionRequired: couplings.length > 0, repartitionPass: pass };
      });
    });

  // ---- handoff ----------------------------------------------------------------------------------------------
  const handoff = orchestrate.command("handoff").description("the lane handoff document");

  addCommonOptions(handoff.command("validate"))
    .requiredOption("--lane <path>", "the lane row from lanes.lock.json, as JSON")
    .requiredOption("--path <path>", "the handoff document")
    .requiredOption("--catalog <path>", "the sidecar task catalog, as JSON")
    .requiredOption("--base <path>", "the dispatch base facts, as JSON")
    // @req FR-NODE-155 AC-3 — the allowance in force is journalled, so a raised cap is auditable
    // rather than a fact only the invocation knew. Omitting `--run-id` keeps the verb a pure read.
    .option("--run-id <id>", "the run whose journal records the allowance used")
    .option("--journal <path>", "run journal path", WAVES_JOURNAL_PATH)
    .action(async (options) => {
      await read(orchestrate, options, async () => {
        const root = runRoot(command);
        const text = await readFile(path.resolve(root, options.path as string), "utf8").catch((error: Error) => {
          throw new OperationalError(`the handoff document is unreadable: ${error.message}`, { cause: error });
        });
        const lane = (await readJsonFile(path.resolve(root, options.lane as string), "--lane")) as never;
        const catalog = (await readJsonFile(path.resolve(root, options.catalog as string), "--catalog")) as never;
        const base = (await readJsonFile(path.resolve(root, options.base as string), "--base")) as never;
        const validation = validateHandoff(text, lane, catalog, base);
        if (!validation.ok) {
          // Three of the six `HandoffViolationCode` values are themselves §13 gates; the other three
          // are layer findings whose gate is the umbrella `handoff-verify-failed`. The reported gate
          // is always a `GateId` member, so a caller can branch on it. @req FR-NODE-137 AC-1
          // `.includes()` on a widened `readonly string[]` does not narrow, so the collapse needs a
          // type predicate rather than a bare membership test. Admitting the other three codes to
          // `GATE_IDS` would close the same compile error by stopping the collapse, which is the one
          // thing AC-1 above forbids. @req FR-NODE-166 AC-5
          const first = validation.violations[0]?.code;
          const gate = first !== undefined && isGateId(first) ? first : "handoff-verify-failed";
          return refuse(gate, validation.violations);
        }
        // @req FR-NODE-165 — as at `schedule plan` above: a refused append is reported, not swallowed,
        // so `counts` is never returned alongside a claim that the allowance was recorded.
        let journalWritten = false;
        if (typeof options.runId === "string" && options.runId.length > 0) {
          const outcome = await appendWavesLine(
            projectRoot(command),
            options.journal as string,
            options.runId,
            {
              schema_version: "1.4.0",
              run_id: options.runId,
              engine: "kiwi-orchestrator",
              verb: "verify-handoff",
              event: "result",
              wave: "all",
              lane: (lane as { laneId?: string }).laneId ?? null,
              untested_allowance: validation.counts.untestedAllowance ?? 0
            },
            false
          );
          if (!outcome.written) return refuse("run-invariant-drift", outcome.diagnostics);
          journalWritten = outcome.written;
        }
        return { counts: validation.counts, journalWritten };
      });
    });

  // ---- round ------------------------------------------------------------------------------------------------
  const round = orchestrate.command("round").description("a verification round");

  addMutationOptions(round.command("record"))
    .option("--run-id <id>", "the run the round belongs to")
    .option("--payload <json>", "the round, inline")
    // @req FR-NODE-169 AC-7 — required, not optional. A round record is verdict-bearing and
    // `waves-event.md:96` requires one externally recomputable proof on such a line, but
    // `checkJournalOnlyProofs` skips a proofless line entirely, so omitting it violates the contract
    // silently. The verb reads no filesystem, so the caller supplies it.
    .requiredOption("--proof <json>", "one externally recomputable proof for the round, inline")
    .option("--journal <path>", "run journal path", WAVES_JOURNAL_PATH)
    .action(async (options) => {
      await mutate(options, async () => {
        const root = projectRoot(command);
        const runId = requireOption(options.runId, "--run-id");
        const payload = parseInlineJson(options.payload, "--payload") as unknown as Round;
        const proof = parseInlineJson(options.proof, "--proof");
        const outcome = evaluateRound(payload);
        // @req FR-NODE-169 AC-1, AC-2 — `null` covers both an out-of-vocabulary scope and one
        // belonging to a loop other than the round declares; neither describes a round that ran.
        const line = projectRound(payload, outcome);
        if (!line) {
          return refuse("invalid-run-scope-option", [{ scope: payload.scope, loop: payload.loop }]);
        }
        const appended = await appendWavesLine(
          root,
          options.journal as string,
          runId,
          {
            schema_version: "1.4.0",
            run_id: runId,
            engine: "kiwi-orchestrator",
            event: "result",
            ts: new Date().toISOString(),
            proof,
            ...line
          },
          options.dryRun === true
        );
        if (appended.diagnostics.some((entry) => entry.severity === "error")) {
          return refuse("run-invariant-drift", appended.diagnostics);
        }
        return { outcome, written: appended.written };
      });
    });

  // ---- issue ledger -----------------------------------------------------------------------------------------
  const issue = orchestrate.command("issue").description("the wave issue ledger");
  const ledgerOption = (target: Command): Command =>
    target.option("--ledger <path>", "the issue ledger, as JSON", "kiwi/orchestrator/issues.json");

  const readLedger = async (relativePath: string): Promise<IssueRow[]> =>
    ((await readFile(path.resolve(runRoot(command), relativePath), "utf8").catch(() => "[]").then((text) => JSON.parse(text))) as IssueRow[]);

  const writeLedger = async (relativePath: string, rows: IssueRow[]): Promise<void> => {
    await writeUnderRoot(runRoot(command), relativePath, `${JSON.stringify(rows, null, 2)}\n`);
  };

  ledgerOption(addMutationOptions(issue.command("open")))
    .option("--payload <json>", "the issue row, inline")
    .action(async (options) => {
      await mutate(options, async () => {
        const rows = await readLedger(options.ledger as string);
        const row = parseInlineJson(options.payload, "--payload") as unknown as IssueRow;
        const result = openIssue(rows, row);
        if (!result.ok) return refuse("wave-issues-open", result.violations);
        if (options.dryRun !== true) await writeLedger(options.ledger as string, [...rows, row]);
        return { issueId: row.issueId };
      });
    });

  ledgerOption(addMutationOptions(issue.command("plan")))
    .requiredOption("--issue-id <id>", "the issue being classified")
    .requiredOption("--class <class>", "the closed-list classification")
    .action(async (options) => {
      await mutate(options, async () => {
        const rows = await readLedger(options.ledger as string);
        const result = planIssue(rows, options.issueId as string, options.class as string);
        if (!result.ok) return refuse("wave-issues-open", result.violations);
        if (options.dryRun !== true) {
          await writeLedger(
            options.ledger as string,
            rows.map((row) => (row.issueId === options.issueId ? { ...row, class: options.class as string } : row))
          );
        }
        return { issueId: options.issueId, class: options.class };
      });
    });

  ledgerOption(addMutationOptions(issue.command("resolve")))
    .requiredOption("--issue-id <id>", "the issue being resolved")
    .requiredOption("--proof <json>", "the resolution proof, inline")
    .requiredOption("--resolution <path>", "the collected resolution set, as JSON")
    .action(async (options) => {
      await mutate(options, async () => {
        const rows = await readLedger(options.ledger as string);
        const proof = parseInlineJson(options.proof, "--proof") as unknown as { kind: string; ref: string };
        // The resolution set is impurely collected here and handed to the pure predicate.
        const resolution = (await readJsonFile(path.resolve(runRoot(command), options.resolution as string), "--resolution")) as ResolutionSet;
        const result = resolveIssue(rows, options.issueId as string, proof, resolution);
        if (!result.ok) return refuse("wave-issues-open", result.violations);
        if (options.dryRun !== true) {
          await writeLedger(
            options.ledger as string,
            rows.map((row) => (row.issueId === options.issueId ? { ...row, resolutionKind: proof.kind, resolutionRef: proof.ref } : row))
          );
        }
        return { issueId: options.issueId };
      });
    });

  ledgerOption(addMutationOptions(issue.command("defer")))
    .requiredOption("--issue-id <id>", "the issue being deferred")
    .requiredOption("--reason <class>", "the closed-list deferral reason")
    .action(async (options) => {
      await mutate(options, async () => {
        const rows = await readLedger(options.ledger as string);
        const result = deferIssue(rows, options.issueId as string, options.reason as string);
        if (!result.ok) return refuse("wave-issues-open", result.violations);
        if (options.dryRun !== true) {
          await writeLedger(
            options.ledger as string,
            rows.map((row) => (row.issueId === options.issueId ? { ...row, deferralReason: options.reason as string } : row))
          );
        }
        return { issueId: options.issueId, reason: options.reason };
      });
    });

  ledgerOption(addCommonOptions(issue.command("list")))
    .option("--wave <n>", "only issues of one wave")
    .action(async (options) => {
      await read(orchestrate, options, async () => {
        const rows = await readLedger(options.ledger as string);
        const wave = options.wave === undefined ? null : Number.parseInt(options.wave as string, 10);
        return { issues: wave === null ? rows : rows.filter((row) => row.wave === wave) };
      });
    });

  // ---- wave close ---------------------------------------------------------------------------------------------
  const wave = orchestrate.command("wave").description("wave boundaries");

  addCommonOptions(wave.command("close"))
    .requiredOption("--wave <n>", "the wave being closed")
    .option("--ledger <path>", "the issue ledger, as JSON", "kiwi/orchestrator/issues.json")
    .requiredOption("--resolution <path>", "the collected resolution set, as JSON")
    .action(async (options) => {
      await read(orchestrate, options, async () => {
        const rows = await readLedger(options.ledger as string);
        const resolution = (await readJsonFile(path.resolve(runRoot(command), options.resolution as string), "--resolution")) as ResolutionSet;
        const result = closeWave(rows, Number.parseInt(options.wave as string, 10), resolution);
        if (!result.ok) return refuse("wave-issues-open", result.violations);
        return { wave: Number.parseInt(options.wave as string, 10) };
      });
    });

  // ---- duplication ---------------------------------------------------------------------------------------------
  const duplication = orchestrate.command("duplication").description("the cross-lane duplication audit");

  addCommonOptions(duplication.command("plan"))
    .requiredOption("--diffs <path>", "the wave's lane diffs, as JSON")
    .requiredOption("--write-sets <path>", "the wave's lane write sets, as JSON")
    .option("--wave <n>", "the wave under audit")
    .action(async (options) => {
      await read(orchestrate, options, async () => {
        const root = runRoot(command);
        const diffs = (await readJsonFile(path.resolve(root, options.diffs as string), "--diffs")) as never;
        const writeSets = (await readJsonFile(path.resolve(root, options.writeSets as string), "--write-sets")) as Record<string, string[]>;
        return { rows: planDuplicationAudit(diffs, writeSets) };
      });
    });

  // ---- replay ---------------------------------------------------------------------------------------------------
  const replay = orchestrate.command("replay").description("the deferred SRS-mutation replay at the host root");

  addCommonOptions(replay.command("plan"))
    .requiredOption("--queue <path>", "a harvested lane's deferred-mutations.jsonl")
    .option("--index <path>", "the persisted replay-index.json of what has already been applied")
    .action(async (options) => {
      await read(orchestrate, options, async () => {
        const root = runRoot(command);
        const queuePath = path.resolve(root, options.queue as string);
        const queue = deferredMutationsFromQueue(await readJsonLinesFile(queuePath, "--queue"), "--queue", queuePath);
        // Absent means nothing has been applied yet, which is the first wave's true state. Defaulting
        // to an empty index is not a fallback for an unreadable file: a path that was GIVEN and
        // cannot be read still fails, because that is a lost record of what already ran.
        let index: ReplayIndex = {};
        if (options.index !== undefined) {
          const indexPath = path.resolve(root, options.index as string);
          index = replayIndexFromJson(await readJsonFile(indexPath, "--index"), "--index", indexPath);
        }
        const plan = replayDeferredMutations(queue, index);
        return { calls: plan.calls, indexAfter: plan.indexAfter };
      });
    });

  // @req IR-CLI-092 — the applier. Takes `--plan`, not `--queue`: re-planning here would let the
  // applied set differ from the reviewed one, and review is the only place a human sees what a lane
  // asked the host to do.
  addMutationOptions(replay.command("apply"))
    .requiredOption("--plan <path>", "a reviewed `replay plan` output")
    .requiredOption("--applied <path>", "append-only record of attempts; what makes a resume exact")
    .option("--frozen-target <target>", "refuse any call carrying a different target")
    .action(async (options) => {
      await mutate(options, async () => {
        const root = runRoot(command);
        const planPath = path.resolve(root, options.plan as string);
        const plan = replayPlanFromJson(await readJsonFile(planPath, "--plan"), "--plan", planPath);
        const result = await applyReplayPlan(plan, {
          appliedPath: path.resolve(root, options.applied as string),
          frozenTarget: typeof options.frozenTarget === "string" ? options.frozenTarget : null,
          dispatch: hostRootDispatch(projectRoot(command)),
          ...(options.dryRun === true ? { dryRun: true } : {})
        });
        // The refusals and the applied count are reported either way — a run that stopped still has
        // to say what it did before it stopped.
        if (!result.ok) {
          throw new OperationalError(
            `${result.gate}: ${result.failure?.tool} — ${result.failure?.error} (applied ${result.applied})`
          );
        }
        return {
          applied: result.applied,
          refused: result.refused,
          ...(result.wouldApply === undefined ? {} : { wouldApply: result.wouldApply })
        };
      });
    });

  // ---- validate ---------------------------------------------------------------------------------------------------
  addCommonOptions(orchestrate.command("validate"))
    .option("--run-id <id>", "the run whose lines are validated")
    .option("--journal <path>", "run journal path", WAVES_JOURNAL_PATH)
    // @req IR-CLI-083 — `--strict` is what makes an unstamped 1.4.0 line and a version downgrade fail.
    .option("--strict", "fail on an unstamped 1.4.0 line or a run-scoped version downgrade")
    .action(async (options) => {
      await read(orchestrate, options, async () => {
        const root = projectRoot(command);
        const runId = requireOption(options.runId, "--run-id");
        const view = await readJournalView(root, runId, options.journal as string);
        const diagnostics = validateWavesJournal(view).map((entry) => ({
          code: entry.code,
          message: entry.message,
          severity: entry.severity,
          line: entry.line ?? null
        }));
        const stampAudit = diagnostics.filter((entry) => entry.code === "unstamped-writer" || entry.code === "journal-version-downgrade");
        // A line below 1.4.0 is reported `unstamped` and never fails; the report says so explicitly
        // rather than leaving the reader to infer it from an empty diagnostic set. @req IR-CLI-083
        const unstamped = view.lines
          .filter((event) => typeof event.writer !== "string")
          .map((event) => ({ line: event.journalLine ?? null, schemaVersion: event.schema_version ?? null, state: "unstamped" }));
        const failing = options.strict === true
          ? diagnostics.filter((entry) => entry.severity === "error")
          : diagnostics.filter((entry) => entry.severity === "error" && !stampAudit.includes(entry));
        if (failing.length > 0) return refuse("run-invariant-drift", failing);
        return { diagnostics, unstamped, strict: options.strict === true };
      });
    });

  // ---- auto-gate ---------------------------------------------------------------------------------------------------
  const autoGate = orchestrate.command("auto-gate").description("the --auto decision committee");

  addCommonOptions(autoGate.command("decide"))
    .requiredOption("--payload <json>", "the gate input, inline")
    .action(async (options) => {
      await read(orchestrate, options, async () => {
        // The payload is validated into `AutoGateInput` rather than cast: `as never` silenced the
        // very error that would have said `tieRung` was never constructed here. @req FR-NODE-124
        return { decision: decideAutoGate(autoGateInputFromPayload(parseInlineJson(options.payload, "--payload"))) };
      });
    });
}


// --- the built tree, enumerated -------------------------------------------------------------------

interface OrchestratePaths {
  readonly containers: readonly (readonly string[])[];
  readonly leaves: readonly (readonly string[])[];
}

function walkOrchestrate(): OrchestratePaths {
  const sink = (): NodeJS.WriteStream => ({ write: () => true }) as unknown as NodeJS.WriteStream;
  const program = new Command();
  registerOrchestrateCommands(program, { io: { stdout: sink(), stderr: sink() } });
  const root = program.commands.find((sub) => sub.name() === "orchestrate") as Command;
  const containers: string[][] = [["orchestrate"]];
  const leaves: string[][] = [];
  const walk = (cmd: Command, prefix: string[]): void => {
    for (const sub of cmd.commands) {
      const next = [...prefix, sub.name()];
      if (sub.commands.length === 0) leaves.push(next);
      else {
        containers.push(["orchestrate", ...next]);
        walk(sub, next);
      }
    }
  };
  walk(root, []);
  return { containers, leaves };
}

const ORCHESTRATE_PATHS = walkOrchestrate();

/**
 * Every container node of the built tree, rooted at `orchestrate` itself. Containers carry no own
 * handler; they are enumerated so a registry that must hold the whole CLI tree can be projected
 * from the namespace rather than retyped beside it. @req IR-CLI-082
 */
export const ORCHESTRATE_CONTAINER_PATHS: readonly (readonly string[])[] = ORCHESTRATE_PATHS.containers;

/** Every leaf of the built tree, as segments **under** `orchestrate` — what {@link orchestrateVerbRow} takes. */
export const ORCHESTRATE_LEAF_PATHS: readonly (readonly string[])[] = ORCHESTRATE_PATHS.leaves;
