import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { Command, InvalidArgumentError } from "commander";
import type { CliContext } from "../command.js";
import { writeHuman, writeJson } from "../formatters.js";
import type { ParsedWorkspace, ProjectRoot } from "../../core/types.js";
import { decideAutoGate, GATE_IDS, type AutoGateInput, type GateId } from "../../core/orchestrator/auto-gate.js";
import { planDuplicationAudit } from "../../core/orchestrator/duplication-audit.js";
import { replayDeferredMutations, type DeferredMutation, type ReplayIndex, type ReplayPlan } from "../../core/orchestrator/replay.js";
import { applyReplayPlan, type ReplayDispatch } from "../../core/orchestrator/replay-apply.js";
import { addTraceLink } from "../../core/mutation/add-trace.js";
import { addVerificationEvidence } from "../../core/mutation/add-evidence.js";
import { updateStatus } from "../../core/mutation/update-status.js";
import { addCompletedWork } from "../../core/mutation/add-completed-work.js";
import { groundFiles, isGroundingRefusal } from "../../core/orchestrator/grounding.js";
import { closeWave, deferIssue, openIssue, planIssue, resolveIssue, type IssueRow, type ResolutionSet } from "../../core/orchestrator/issue-ledger.js";
import { computeLanePlan, LanePlanError } from "../../core/orchestrator/lane-plan.js";
import type { WaveDependencies, WaveInput } from "../../core/orchestrator/conflict.js";
import { buildLanesLockBody, freezeLock, serializeLock, type WaveSdsDigest } from "../../core/orchestrator/freeze.js";
import { HandoffPinError, pinHandoff } from "../../core/orchestrator/pinning.js";
import { normaliseRoot, preflightRunRoot } from "../../core/orchestrator/preflight.js";
import { gitCommonDirOf, gitToplevelOf, realpathProbe, registeredWorktreesOf } from "../../core/root-facts.js";
import { preflightRunRootForRole, type FrozenLanePlan } from "../../core/orchestrator/worktree-topology.js";
import {
  acquireArtifactLock,
  releaseArtifactLock,
  type AcquireArtifactLockResult,
  type ArtifactLockCapability
} from "../../core/workflow/artifact-lock.js";
import { appendUtf8LineAndSync } from "../../core/workflow/mutation.js";
import { RequirementNotReadyError, assertRequirementsReady, parseRequirementSnapshot } from "../../core/orchestrator/readiness.js";
import { computeInvariantDigest, readCard, stampCard, validateCard, writeCard, resumeCardPath, type ResumeCard } from "../../core/orchestrator/resume-card.js";
import { computeResumeState, retiredRunMarkers, type DriftInputs, type GitFacts } from "../../core/orchestrator/resume.js";
import { computeRoute } from "../../core/orchestrator/route.js";
import { freezeRoute, frozenRouteEntry, resumeRung, routeLockDigest, serializeRouteLock, type RouteGateRecord, type RouteLock } from "../../core/orchestrator/route-lock.js";
import { parseRouteProbe } from "../../core/orchestrator/route-probe.js";
import {
  acquire,
  acquisitionRefused,
  foreignReleaseBlocker,
  inspectRunLock,
  readHolder,
  releaseHeldRunLock,
  resolveGitCommonDir,
  RUN_LOCK_GATE,
  RunLockHeldError,
  reportedFence,
  runLockPath,
  type RunLockRelease,
  type RunLockState
} from "../../core/orchestrator/run-lock.js";
import { evaluateRound, projectRound, type Round } from "../../core/orchestrator/verification-gate.js";
import { engineOf, listJournalRunIds, parseWavesJournal, WAVES_JOURNAL_PATH, type WavesJournalView } from "../../core/orchestrator/waves-journal.js";
import { computeRunProgress, isRunAborted, validateWavesJournal } from "../../core/orchestrator/waves-validate.js";
import {
  declarationEntryDigest,
  parseWaveDeclaration,
  waveReadiness,
  type WaveDeclaration,
  type WaveDeclarationEntry
} from "../../core/orchestrator/wave-declaration.js";
import { collectResumeFacts, filePointer, trackedPathsAtHead } from "./orchestrate-facts.js";
import {
  CURRENT_WAVES_SCHEMA_VERSION,
  ENGINES,
  WAVES_EVENT_REQUIRED_BY_SCOPE,
  eventScopeOf,
  type Engine,
  type WavesEvent
} from "../../core/orchestrator/journal-schema.js";
import { LITE_SDS_SUFFIX, checkSdsFile } from "../../core/sds/check-sds.js";
import { parseWorkspace } from "../../core/parser/workspace-parser.js";

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
  "freeze design|waves|lanes|issues|postmortem",
  "readiness check",
  "schedule waves",
  "schedule show",
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
 * Rows a requirement after the two phases registers. Declared apart from the phase rows so neither
 * phase's census grows when one lands. @req IR-CLI-082 AC-1, IR-CLI-104
 */
export const ORCHESTRATE_LATER_VERB_ROWS = ["wave status"] as const;

/**
 * Every row the CLI actually registers: the phase-1 surface plus each phase-2 row already landed.
 * Derived rather than restated, so a row cannot be registered without leaving the deferred list.
 * @req IR-CLI-091
 */
export const ORCHESTRATE_REGISTERED_VERB_ROWS: readonly string[] = [
  ...ORCHESTRATE_PHASE1_VERB_ROWS,
  ...ORCHESTRATE_PHASE2_VERB_ROWS.filter((row) => !(ORCHESTRATE_DEFERRED_VERB_ROWS as readonly string[]).includes(row)),
  ...ORCHESTRATE_LATER_VERB_ROWS
];

/** The freeze targets of 05 §3.3a — five since `handoff` left in 4.0.0. @req IR-CLI-082 AC-2 */
export const FREEZE_TARGETS = ["design", "waves", "lanes", "issues", "postmortem"] as const;

export type FreezeTarget = (typeof FREEZE_TARGETS)[number];

/** The rows 05 §10.6 classifies as mutations: each returns an envelope and honours `--dry-run`. */
export const ORCHESTRATE_MUTATION_VERB_ROWS = [
  "route probe",
  "route freeze",
  "run lock|unlock|status",
  "run abort",
  "journal append",
  "card write",
  "freeze design|waves|lanes|issues|postmortem",
  "schedule waves",
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
  /**
   * The description the MCP tool ships with, declared beside the name it describes rather than in a
   * table keyed by that name — a table outlives the row it describes. @req FR-MCP-060
   */
  readonly description: string;
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
const ENGINE_OPTION = o("--engine", "engine");

/**
 * The `orchestrate_*` family. The CLI namespace is the authority and every binding names the leaf it
 * mirrors, which is what makes "the MCP family mirrors the CLI" checkable in both directions rather
 * than by inspection. @req IR-MCP-003
 */
export const ORCHESTRATE_TOOL_BINDINGS: readonly OrchestrateToolBinding[] = [
  { tool: "orchestrate_resume", description: "Rebuilds the resume state of an orchestrator run from its journal and resume card — which wave and lane it stopped in, and whether anything drifted since. Without run_id it resumes the most recent run under the engine (kiwi-orchestrator by default) that is neither complete nor aborted. Without facts it reads the git facts and drift inputs from the repository itself, and then reports the intent-digest comparison as unchecked with a warning; a facts file, when given, must carry both halves. Read-only.", path: ["resume"], kind: "read", options: [RUN_ID_OPTION, ENGINE_OPTION, JOURNAL_OPTION, o("--card", "card"), o("--facts", "facts")] },
  // @req IR-MCP-005 — the role declaration is bound too. Without it the binding could only ever
  // produce the default host role, and the role-aware gate refuses a linked worktree claiming to be
  // a host, which leaves the topology gate unreachable from the surface a worktree session uses.
  {
    tool: "orchestrate_preflight", description: "Compares the MCP workspace root against the git root a caller passes and judges whether this session may run there, given its declared role and lane. Both roots are arguments; nothing is taken from the process working directory. Read-only.",
    path: ["preflight"],
    kind: "read",
    options: [
      o("--mcp-root", "mcpRoot", "string", true),
      o("--git-root", "gitRoot", "string", true),
      o("--role", "role"),
      o("--lane-id", "laneId"),
      o("--lane-plan", "lanePlan")
    ]
  },
  { tool: "orchestrate_route_probe", description: "Records one routing probe — the facts a rung classifier reads — and refuses a schema-invalid probe instead of substituting defaults. Writes the probe file the routing decision later consumes.", path: ["route", "probe"], kind: "mutation", options: [o("--probe", "probe"), o("--payload", "payload", "json"), o("--out", "out"), DRY_RUN_OPTION] },
  { tool: "orchestrate_route_freeze", description: "Commits the run to one routing rung and records the gate ballot behind it. Writes the route lock together with the resume card's frozen route entry and invariant digest, so a later byte change to the lock surfaces as drift on resume; re-freezing over a different probe rewrites both rather than refusing.", path: ["route", "freeze"], kind: "mutation", options: [o("--probe", "probe"), o("--gate", "gate"), o("--out", "out"), o("--auto", "auto", "boolean"), DRY_RUN_OPTION] },
  { tool: "orchestrate_route_show", description: "Reads the frozen routing lock and reports the rung this run is committed to. Read-only.", path: ["route", "show"], kind: "read", options: [o("--lock", "lock")] },
  {
    tool: "orchestrate_run_lock", description: "Takes, releases or reports the repository-wide orchestrator run lock, keyed on the git common directory so linked worktrees contend for one lock. Writes the lock file under that directory when taking it and removes that file when releasing it; the status action changes nothing at all. While the session that took the lock is alive, only that session can release it (unlock here, or orchestrate_run_abort); any other caller is refused and nothing is removed. A refusal and the status answer name the lease, the fence state and the release step that can work.",
    path: ["run", "lock"],
    kind: "mutation",
    options: [o("--owner", "owner"), DRY_RUN_OPTION],
    selector: { dest: "action", index: 1, values: ["lock", "unlock", "status"] }
  },
  { tool: "orchestrate_run_abort", description: "Ends the current run on purpose and records why, so a later session reads a halted run rather than an abandoned one, and releases the repository-wide run lock once that record lands — a refused record keeps the lock deliberately, because a run that could not record its own end is one nobody should join. Writes an abort event into the run journal.", path: ["run", "abort"], kind: "mutation", options: [o("--reason", "reason", "string", true), RUN_ID_OPTION, JOURNAL_OPTION, DRY_RUN_OPTION] },
  { tool: "orchestrate_journal_append", description: "Appends one event to the run journal, stamped with this tool's writer identity, after validating the journal as it would stand once that line landed: an error-severity diagnostic refuses the append and leaves the file byte-identical, and no argument skips the check. The candidate view holds only the lines matching the run id and the engine it was given. Writes the journal file.", path: ["journal", "append"], kind: "mutation", options: [RUN_ID_OPTION, o("--payload", "payload", "json"), JOURNAL_OPTION, DRY_RUN_OPTION] },
  { tool: "orchestrate_card_write", description: "Replaces the resume card of a run — the frozen block a resumed session compares its world against. Writes the card file.", path: ["card", "write"], kind: "mutation", options: [RUN_ID_OPTION, o("--payload", "payload", "json"), JOURNAL_OPTION, DRY_RUN_OPTION] },
  {
    tool: "orchestrate_freeze", description: "Content-addresses one run artifact set — design, waves, lanes, issues or postmortem — pinning the named document by its git blob id and the declared inputs by their digest, and refusing a body that omits a field its kind requires. Writes the freeze lock for the target you name.",
    path: ["freeze", "design"],
    kind: "mutation",
    options: [o("--body", "body", "string", true), o("--document", "document", "string", true), o("--head", "head", "string", true), RUN_ID_OPTION, o("--declared-inputs", "declaredInputs"), o("--out", "out"), DRY_RUN_OPTION],
    selector: { dest: "target", index: 1, values: [...FREEZE_TARGETS] }
  },
  { tool: "orchestrate_readiness_check", description: "Derives whether the requirements you name are ready to be worked, from a requirement snapshot rather than any self-attestation, and fails closed on dependency cycles or duplicate ids. That allowlist of requirement ids is mandatory in practice: an empty one is an error, never a sweep of the whole target. Read-only.", path: ["readiness", "check"], kind: "read", options: [o("--target", "target", "string", true), o("--snapshot", "snapshot", "string", true), o("--req", "req", "array")] },
  {
    tool: "orchestrate_schedule_waves", description: "Computes the stage schedule for a set of waves: one lane per wave, every wave in a stage after the waves it depends on, the waves of one stage writing disjoint paths, and at most the lane cap per stage. Give exactly one of waves or sds. waves is a wave declaration file ({schema_version, waves: [{wave: \"wave-<n>\", depends_on?, files, requirements, sds?}]}) read with run_id: only the entries whose dependencies the run journal shows complete are planned, the rest are reported as deferred, and a wave declaring no files and no SDS is planned alone with a warning. sds is the older form, which needs depends: an sds entry is one SDS file, which is one wave named after the file, or <waveId>=<file>,<file>, which makes several SDS files one wave named waveId and keys that wave's dependencies by waveId; a wave the dependency map leaves out depends on every wave listed before it. Writes the lanes lock unless the call is a dry run, and, when strict grounding is asked for beside a run id, a freeze-lane-plan line into the run journal — which lands before the grounding verdict, so a call refused for ungrounded files has journalled itself all the same.",
    path: ["schedule", "waves"],
    kind: "mutation",
    options: [o("--waves", "waves"), o("--sds", "sds", "array"), o("--depends", "depends", "json"), o("--lanes", "lanes"), o("--strict-grounding", "strictGrounding", "boolean"), o("--existing-paths", "existingPaths"), o("--out", "out"), RUN_ID_OPTION, ENGINE_OPTION, JOURNAL_OPTION, DRY_RUN_OPTION]
  },
  { tool: "orchestrate_schedule_show", description: "Reads a lanes lock and reports the stages it fixed and the one lane per wave in each. Read-only.", path: ["schedule", "show"], kind: "read", options: [o("--lock", "lock")] },
  // @req IR-MCP-004 AC-1 — `--proof` is mandatory on the leaf, so it has to be declared here too:
  // `orchestrateArgv` emits a flag only for a declared option, and the input schema is derived from
  // this same list, so an omission leaves the tool uncallable in every case rather than degraded.
  { tool: "orchestrate_round_record", description: "Records one verification round with the proof it rests on, which the argument list makes mandatory. The gate it refuses at is the round scope: one outside the closed vocabulary, or one belonging to a loop other than the round declares, is turned away before anything is appended. Writes a round event into the run journal.", path: ["round", "record"], kind: "mutation", options: [RUN_ID_OPTION, o("--payload", "payload", "json"), o("--proof", "proof", "json", true), JOURNAL_OPTION, DRY_RUN_OPTION] },
  { tool: "orchestrate_issue_open", description: "Opens a new issue in the wave ledger from the payload you supply, refusing a classification outside the closed six-value list and an issue id the ledger already carries. Writes the ledger row.", path: ["issue", "open"], kind: "mutation", options: [LEDGER_OPTION, o("--payload", "payload", "json"), DRY_RUN_OPTION] },
  { tool: "orchestrate_issue_plan", description: "Assigns a classification to one issue in the wave ledger, which decides how it must be discharged. Writes the ledger row.", path: ["issue", "plan"], kind: "mutation", options: [LEDGER_OPTION, o("--issue-id", "issueId", "string", true), o("--class", "class", "string", true), DRY_RUN_OPTION] },
  { tool: "orchestrate_issue_resolve", description: "Closes one issue with the proof for it, which is mandatory and has to resolve against the facts you supply rather than merely be well shaped — a syntactically perfect sha naming no commit in that set is refused. Writes the ledger row.", path: ["issue", "resolve"], kind: "mutation", options: [LEDGER_OPTION, o("--issue-id", "issueId", "string", true), o("--proof", "proof", "json", true), o("--resolution", "resolution", "string", true), DRY_RUN_OPTION] },
  { tool: "orchestrate_issue_defer", description: "Records a closed-vocabulary deferral reason against one issue, with no resolution. The row stays in its wave and the wave-close judge still weighs it, so deferring does not clear the way to close. Writes the ledger row.", path: ["issue", "defer"], kind: "mutation", options: [LEDGER_OPTION, o("--issue-id", "issueId", "string", true), o("--reason", "reason", "string", true), DRY_RUN_OPTION] },
  { tool: "orchestrate_issue_list", description: "Lists the wave issue ledger's rows, optionally for one wave, each with its classification and disposition. Read-only.", path: ["issue", "list"], kind: "read", options: [LEDGER_OPTION, o("--wave", "wave")] },
  { tool: "orchestrate_wave_close", description: "Judges whether a wave may close, by the evidence each issue's classification demands: a local defect or a missing task needs a resolution proof that resolves against the facts you supply, a design gap needs a fresh design-lock digest, an out-of-run or new-wave issue needs a recorded user decision, and a design contradiction needs a valid classification and nothing more. The supplied set is what proofs are checked against, never a list of outcomes the caller declares acceptable. Read-only.", path: ["wave", "close"], kind: "read", options: [o("--wave", "wave", "string", true), LEDGER_OPTION, o("--resolution", "resolution", "string", true)] },
  // @req IR-CLI-104 — the wave-state reader; `engine` is bound so a kiwi-wave-master journal is readable over MCP.
  { tool: "orchestrate_wave_status", description: "Reports, for every wave of one run, its latest status, phase, sds_id, stage, lane and time by the same predicate resume uses — a round record or a statusless verb line never changes a wave's status — and whether the run is complete, needs its final verification, or was aborted. With a wave declaration file it also lists the waves schedule waves would plan now. Without run_id it reads the most recent run under the engine that is neither complete nor aborted. Read-only.", path: ["wave", "status"], kind: "read", options: [RUN_ID_OPTION, ENGINE_OPTION, JOURNAL_OPTION, o("--waves", "waves")] },
  { tool: "orchestrate_duplication_plan", description: "Audits lane diffs against the lanes' declared write sets, which bound each lane's candidates to the paths it said it would touch, and proposes the duplication candidates a reviewer should look at. Which wave that is comes from how the caller assembled the diff file; this tool applies no wave filter of its own. Read-only.", path: ["duplication", "plan"], kind: "read", options: [o("--diffs", "diffs", "string", true), o("--write-sets", "writeSets", "string", true), o("--wave", "wave")] },
  { tool: "orchestrate_validate", description: "Validates a kiwi-orchestrator run journal against the waves-event contract and reports each violation by its named code; the strict flag additionally fails an unstamped 1.4.0 line and a run-scoped version downgrade. This binding declares no engine, so a journal another engine wrote is read as zero lines and answers clean without having been judged. Read-only.", path: ["validate"], kind: "read", options: [RUN_ID_OPTION, JOURNAL_OPTION, o("--strict", "strict", "boolean")] },
  { tool: "orchestrate_auto_gate", description: "Applies the --auto decision rule to one gate ballot the caller supplies and returns the verdict: adopt the recommended option, adopt the default-if-auto option, adopt a majority over the votes already in the payload, or escalate and halt for the user. It convenes nobody and gathers no votes of its own, and a critical gate, a degraded quorum and an absent majority each escalate. Read-only.", path: ["auto-gate", "decide"], kind: "read", options: [o("--payload", "payload", "json", true)] },
  // @req IR-CLI-091 — the first phase-2 row to register. Both options are declared because the MCP
  // input schema is derived from this list: an omission here leaves the field uncallable over MCP
  // while the CLI accepts it, which is how `orchestrate_round_record` once shipped uncallable.
  { tool: "orchestrate_replay_plan", description: "Reads the deferred SRS-mutation queue and says whether replaying each recorded call would apply it or skip it as a duplicate, beside the index that state would leave behind. It does not judge whether a call is permitted at all; the allowlist runs at apply time, so a forbidden tool is planned as an apply here. Nothing is replayed. Read-only.", path: ["replay", "plan"], kind: "read", options: [o("--queue", "queue", "string", true), o("--index", "index")] },
  // @req IR-CLI-092 — kind `mutation`, so the generated mirror carries the dry-run option and the
  // write envelope. A leaf without a binding ships an absent MCP tool and nothing says so.
  {
    tool: "orchestrate_replay_apply", description: "Applies a deferred SRS-mutation replay plan at the host root, refusing anything outside the allowlist and refusing a per-call workspace root outright. Writes the SRS documents those calls address, and one attempt line per dispatch into the applied-record file, which is what lets an interrupted replay resume without repeating itself.",
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
 * @req IR-CLI-093 — the role-aware run-root verdict, decided by the topology gate.
 *
 * Both extra facts — the git common directory and the registered worktree list — are read from git
 * here rather than taken as arguments. That is the whole point: the caller supplies the two roots and
 * its claimed role, and the repository itself supplies what corroborates them.
 */
async function roleAwarePreflight(
  command: Command,
  options: Record<string, unknown>,
  role: "host" | "lane"
): Promise<VerbResult> {
  const mcpRoot = options.mcpRoot as string;
  const gitRoot = options.gitRoot as string;

  const toplevels = new Map<string, string | undefined>();
  const commonDirs = new Map<string, string | undefined>();
  for (const target of [mcpRoot, gitRoot]) {
    if (!toplevels.has(target)) toplevels.set(target, await gitToplevelOf(target));
    if (!commonDirs.has(target)) commonDirs.set(target, await gitCommonDirOf(target));
  }
  const hostCommon = commonDirs.get(mcpRoot);
  const candidateCommon = commonDirs.get(gitRoot);
  const registered = new Map<string, readonly string[]>();
  for (const dir of [hostCommon, candidateCommon]) {
    if (dir !== undefined && !registered.has(dir)) registered.set(dir, await registeredWorktreesOf(dir));
  }

  const probes = {
    realpath: realpathProbe,
    gitToplevel: (target: string) => toplevels.get(target),
    gitCommonDir: (target: string) => commonDirs.get(target),
    registeredWorktrees: (dir: string) => registered.get(dir) ?? []
  };

  let request;
  if (role === "lane") {
    const laneId = requireOption(options.laneId, "--lane-id");
    const planPath = path.resolve(runRoot(command), requireOption(options.lanePlan, "--lane-plan"));
    const lanePlan = lanePlanFromJson(await readJsonFile(planPath, "--lane-plan"), "--lane-plan", planPath);
    request = { role, mcpRoot, gitRoot, laneId, lanePlan } as const;
  } else {
    request = { role, mcpRoot, gitRoot } as const;
  }

  // @req FR-NODE-178 — the equality verdict still runs on the host path, and its refusal still wins,
  // so IR-CLI-090's three conditions and their reported shape are untouched. The topology gate adds
  // one refusal the equality test structurally cannot see: a host that is itself a linked worktree,
  // where both roots agree and SRS is written into a checkout still waiting to be merged.
  if (role === "host") {
    const legacy = preflightRunRoot(mcpRoot, gitRoot, {
      realpath: realpathProbe,
      gitToplevel: (target: string) => toplevels.get(target)
    });
    if (!legacy.ok) {
      return refuse("run-root-preflight-mismatch", [
        { reason: legacy.reason, gitToplevel: legacy.gitToplevel, ...legacy.comparison }
      ]);
    }
    const role_ = preflightRunRootForRole(request, probes);
    if (!role_.ok) {
      return refuse("run-root-preflight-mismatch", [
        { reason: role_.reason, topology: role_.topology, role, gitToplevel: legacy.gitToplevel }
      ]);
    }
    return { comparison: legacy.comparison, gitToplevel: legacy.gitToplevel, role, topology: role_.topology };
  }

  const verdict = preflightRunRootForRole(request, probes);
  if (!verdict.ok) {
    return refuse("run-root-preflight-mismatch", [{ reason: verdict.reason, topology: verdict.topology, role }]);
  }
  return { ok: true, role, topology: verdict.topology };
}

/**
 * The per-stage lane cap the orchestrator skill declares for `--lanes`. @req IR-CLI-098
 *
 * Exported so a test can hold it against the number the skill body states. A bound that only the
 * code knows drifts the moment either side is edited alone, and the drift is invisible: a widened
 * bound refuses nothing, so nothing fails.
 */
export const MAX_LANE_CAP = 8;

/**
 * How long the wave append waits for the journal lock before refusing.
 * @req FR-NODE-196 — a wait rather than a single try. The lock is taken for the length of one
 * validate-and-append, so contention at the documented `--lanes` ceiling of 8 is routine rather than
 * exceptional; refusing on the first miss turned half of eight concurrent appends into hard failures.
 */
const WAVES_LOCK_WAIT_MS = 10_000;

/**
 * @req IR-CLI-098 — validated where the argument arrives, not where the plan is built. Reaching
 * `computeLanePlan` through a bare `Number.parseInt` let a typo clamp silently inside the planner, far
 * from the option that caused it.
 */
function laneCapOption(value: string): number {
  if (!/^\d+$/.test(value)) {
    throw new InvalidArgumentError(`--lanes must be a whole number between 1 and ${MAX_LANE_CAP}, not ${value}`);
  }
  const cap = Number.parseInt(value, 10);
  if (cap < 1 || cap > MAX_LANE_CAP) {
    throw new InvalidArgumentError(`--lanes must be between 1 and ${MAX_LANE_CAP}, not ${value}`);
  }
  return cap;
}

/**
 * A frozen lane plan read back for the gate. Validated rather than cast: it decides an admission.
 *
 * @req IR-CLI-097 — two shapes, because the file the scheduler writes and the shape this reader was
 * built for were never the same. `schedule waves` writes a lanes lock, whose lanes live in an
 * array under `lanes`; the reader only knew a map keyed by lane id, so handing it the real file
 * made it walk `lanes` as if that key were a lane and refuse with `lanes.writeSet is not a list of
 * paths`. The skill's worktree procedure instructs exactly that call, so no lane could be admitted.
 * The discriminator is an array-valued `lanes` key: a legacy map cannot collide with it, because
 * its keys are lane ids and a lane id is not the literal `lanes`.
 */
function lanePlanFromJson(value: unknown, label: string, absolutePath: string): FrozenLanePlan {
  const fail = (detail: string): never => {
    throw new OperationalError(`${label} is not a lane plan at ${absolutePath}: ${detail}`);
  };
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return fail("expected an object with a `lanes` array, or a map of lane ids to write sets");
  }
  const plan = Object.create(null) as Record<string, { writeSet: readonly string[] }>;
  const readWriteSet = (laneId: string, entry: unknown): readonly string[] => {
    if (typeof entry !== "object" || entry === null) fail(`${laneId} is not an object`);
    const writeSet = (entry as { writeSet?: unknown }).writeSet;
    if (!Array.isArray(writeSet) || writeSet.some((item) => typeof item !== "string")) {
      fail(`lane ${laneId} has no write set of paths`);
    }
    return writeSet as string[];
  };

  const lanes = (value as { lanes?: unknown }).lanes;
  if (Array.isArray(lanes)) {
    for (const [index, lane] of lanes.entries()) {
      if (typeof lane !== "object" || lane === null) fail(`lanes[${index}] is not an object`);
      const laneId = (lane as { laneId?: unknown }).laneId;
      // The id names the lane in every later refusal, so a plan without one is unusable rather than
      // merely odd — the index it would fall back to means nothing to whoever reads the message.
      if (typeof laneId !== "string" || laneId.length === 0) fail(`lanes[${index}] has no laneId`);
      // Two lanes under one id would leave the later one's write set deciding admission for both,
      // and the gate would answer for a lane nobody planned. Refuse rather than let one win.
      if (Object.prototype.hasOwnProperty.call(plan, laneId as string)) fail(`lane ${laneId} appears twice`);
      plan[laneId as string] = { writeSet: readWriteSet(laneId as string, lane) };
    }
    return plan;
  }
  if ("lanes" in (value as Record<string, unknown>)) {
    return fail("`lanes` is present but is not an array, so this is neither a lane plan nor a map of lane ids");
  }

  for (const [laneId, entry] of Object.entries(value as Record<string, unknown>)) {
    plan[laneId] = { writeSet: readWriteSet(laneId, entry) };
  }
  return plan;
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

function jsonObject(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new OperationalError(`${label} must be a JSON object`);
  return value as Record<string, unknown>;
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

/**
 * `parseWavesJournal` drops every line whose engine differs, so coercing an unrecognised `--engine`
 * to a default does not fail loudly — it validates the other producer's lines, finds none, and
 * reports a clean run for a journal it never opened. @req FR-NODE-188
 */
function requireEngine(value: unknown): Engine {
  if (typeof value !== "string" || !(ENGINES as readonly string[]).includes(value)) {
    throw new OperationalError(`--engine must be one of ${ENGINES.join(" | ")}`);
  }
  return value as Engine;
}

async function writeUnderRoot(root: string, relativePath: string, text: string): Promise<string> {
  const absolute = path.resolve(root, relativePath);
  await mkdir(path.dirname(absolute), { recursive: true });
  await writeFile(absolute, text, "utf8");
  return absolute;
}

/** One wave the scheduler places: the kernel's input plus what the lock records beside it. */
interface ScheduledWave extends WaveInput {
  /** The wave's SDS path, or its SDS files in order when it has several; `null` for a wave with none. */
  readonly sds: string | string[] | null;
  readonly sdsDigest: WaveSdsDigest | null;
}

/** One SDS file that passed `speckiwi sds check`. */
interface CheckedSds {
  readonly path: string;
  readonly writeSet: readonly string[];
  readonly digest: string;
}

/**
 * Runs the check behind `speckiwi sds check` on one `--sds` file and refuses on any error it reports —
 * a structural one, an `@req` or `(REQ AC-n)` naming nothing, or a listed requirement no `@req` names
 * alike: a write set read from such a file cannot be trusted, and a missing path would schedule two
 * colliding waves side by side. @req FR-NODE-213 AC-1
 */
async function checkScheduledSds(root: string, workspace: ParsedWorkspace, sdsPath: string): Promise<CheckedSds> {
  const checked = await checkSdsFile(workspace, sdsPath);
  if (!checked.ok) throw new OperationalError(`--sds ${sdsPath}: ${checked.error.message}`);
  const report = checked.value;
  if (!report.passed) {
    const reasons = report.errors.map((entry) => `${entry.code} ${entry.message}`);
    throw new OperationalError(`--sds ${report.path} cannot be scheduled; speckiwi sds check reports: ${reasons.join("; ")}`);
  }
  if (!report.path.endsWith(LITE_SDS_SUFFIX)) throw new OperationalError(`--sds ${report.path} is not named <sds-id>${LITE_SDS_SUFFIX}`);
  const bytes = await readFile(path.resolve(root, report.path));
  return { path: report.path, writeSet: report.summary.writeSet, digest: createHash("sha256").update(bytes).digest("hex") };
}

/**
 * `--sds <file>` is one wave named after the file; `--sds <waveId>=<file>,<file>...` is one wave made
 * of several SDS files — the parts of one design — named by the id before `=`. @req FR-NODE-213 AC-1
 */
function parseSdsEntry(entry: string): { readonly waveId: string | null; readonly paths: string[] } {
  const separator = entry.indexOf("=");
  if (separator < 0) return { waveId: null, paths: [entry] };
  const waveId = entry.slice(0, separator);
  const paths = entry.slice(separator + 1).split(",");
  if (waveId.length === 0 || paths.some((sdsPath) => sdsPath.length === 0)) {
    throw new OperationalError(`--sds ${entry} must be <waveId>=<file>[,<file>...] with a wave id and no empty file`);
  }
  // The wave id becomes a lane id and a branch segment, which a resume matches as `lane-[^/]+`.
  if (!LANE_ID_SEGMENT.test(waveId)) throw new OperationalError(`--sds ${entry}: the wave id must match ${LANE_ID_SEGMENT.source}`);
  return { waveId, paths };
}

/**
 * An id that becomes part of a lane id and a branch segment: the `--sds` group wave id, and with
 * `--waves` the run id (`lane-{run_id}-wave-{n}`, FR-NODE-216 AC-11).
 */
const LANE_ID_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/** Whether this file system treats two spellings that differ only in case as one file. */
const CASE_INSENSITIVE_PATHS = process.platform === "win32" || process.platform === "darwin";

/**
 * The SDS files one call names more than once — twice in a group, or in two waves. A design scheduled
 * twice cannot sit in exactly one lane, which is what `lane-plan-incomplete` refuses. @req FR-NODE-213 AC-1
 */
function sdsNamedTwice(waves: ReadonlyArray<Pick<ScheduledWave, "waveId" | "sds">>): Array<{ sds: string; waves: string[] }> {
  const owners = new Map<string, { sds: string; waves: string[] }>();
  for (const wave of waves) {
    for (const sds of wave.sds === null ? [] : typeof wave.sds === "string" ? [wave.sds] : wave.sds) {
      const key = CASE_INSENSITIVE_PATHS ? sds.toLowerCase() : sds;
      const entry = owners.get(key) ?? { sds, waves: [] };
      entry.waves.push(wave.waveId);
      owners.set(key, entry);
    }
  }
  return [...owners.values()].filter((entry) => entry.waves.length > 1);
}

/** Reads each `--sds` entry into one wave, checking every SDS file it names. @req FR-NODE-213 AC-1, AC-2 */
async function loadScheduledWaves(root: string, entries: readonly string[]): Promise<ScheduledWave[]> {
  const workspace = await parseWorkspace({ root });
  const waves: ScheduledWave[] = [];
  for (const entry of entries) {
    const { waveId, paths } = parseSdsEntry(entry);
    const files: CheckedSds[] = [];
    for (const sdsPath of paths) files.push(await checkScheduledSds(root, workspace, sdsPath));
    const writeSet = [...new Set(files.flatMap((file) => file.writeSet))].sort();
    if (waveId === null) {
      const [file] = files as [CheckedSds];
      waves.push({ waveId: path.posix.basename(file.path).slice(0, -LITE_SDS_SUFFIX.length), writeSet, sds: file.path, sdsDigest: file.digest });
      continue;
    }
    waves.push({
      waveId,
      writeSet,
      sds: files.map((file) => file.path),
      sdsDigest: Object.fromEntries(files.map((file) => [file.path, file.digest]))
    });
  }
  return waves;
}

/**
 * `--depends` validated into `{waveId -> waveId[]}`. Which list members exist is the kernel's to judge;
 * a key naming no scheduled wave is not read at all. @req FR-NODE-213 AC-1
 */
function waveDependenciesFrom(value: Record<string, unknown>, waveIds: ReadonlySet<string>): WaveDependencies {
  const dependencies: WaveDependencies = {};
  for (const [waveId, list] of Object.entries(value)) {
    if (!waveIds.has(waveId)) continue;
    if (!Array.isArray(list) || list.some((entry) => typeof entry !== "string")) {
      throw new OperationalError(`--depends ${waveId} must be a list of wave ids`);
    }
    dependencies[waveId] = list as string[];
  }
  return dependencies;
}

/** What either `schedule waves` form hands the shared planning tail. */
interface ScheduleInput {
  readonly waves: readonly ScheduledWave[];
  readonly dependencies: WaveDependencies;
  readonly existingPaths: readonly string[];
  readonly declaration?: { readonly path: string; readonly digests: Readonly<Record<string, string>> };
  /** Extra output fields the form reports beside the lock. */
  readonly report: Record<string, unknown>;
}

/**
 * Which `schedule waves` form a call uses, refusing every mixed or incomplete one before anything is
 * read: `--waves` excludes `--sds` and `--depends` and needs `--run-id`; `--sds` needs `--depends`.
 * @req FR-NODE-216 AC-8, AC-11, FR-NODE-213 AC-1
 */
function scheduleForm(options: Record<string, unknown>): "waves" | "sds" {
  if (options.waves !== undefined) {
    if (options.sds !== undefined) throw new OperationalError("--waves cannot be combined with --sds");
    if (options.depends !== undefined) throw new OperationalError("--waves cannot be combined with --depends");
    // @req FR-NODE-216 AC-11 — the run id is spelled into every wave, lane, branch and worktree name.
    if (!LANE_ID_SEGMENT.test(requireOption(options.runId, "--run-id"))) {
      throw new OperationalError(`--run-id ${JSON.stringify(options.runId)} must match ${LANE_ID_SEGMENT.source}: it becomes part of every lane id`);
    }
    return "waves";
  }
  if (options.sds === undefined) throw new OperationalError("schedule waves needs --waves <file> or --sds <path...>");
  if (options.depends === undefined) throw new OperationalError("--depends is required with --sds");
  return "sds";
}

/** The `--existing-paths` list, read as given. */
async function existingPathsOption(root: string, value: unknown): Promise<string[]> {
  return (await readJsonFile(path.resolve(root, value as string), "--existing-paths")) as string[];
}

/** The `--sds` form, as 4.0.0 shipped it. @req FR-NODE-213 AC-1 */
async function sdsSchedule(root: string, options: Record<string, unknown>): Promise<ScheduleInput | GateRefusal> {
  const declaredDependencies = parseInlineJson(options.depends, "--depends");
  const waves = await loadScheduledWaves(root, options.sds as string[]);
  const dependencies = waveDependenciesFrom(declaredDependencies, new Set(waves.map((wave) => wave.waveId)));
  const namedTwice = sdsNamedTwice(waves);
  if (namedTwice.length > 0) return refuse("lane-plan-incomplete", namedTwice);
  const existingPaths = options.existingPaths ? await existingPathsOption(root, options.existingPaths) : [];
  return { waves, dependencies, existingPaths, report: {} };
}

/** The lock's wave id for a declaration entry `wave-<n>`: the unit id. @req FR-NODE-216 AC-11 */
function declaredWaveId(runId: string, entry: WaveDeclarationEntry): string {
  return `${runId}-${entry.wave}`;
}

/**
 * The planned entries' requirements that are not ready: absent from the SRS, `draft` or `deprecated`,
 * or `discarded`. @req FR-NODE-216 AC-10
 */
function requirementsNotReady(workspace: ParsedWorkspace, entries: readonly WaveDeclarationEntry[]): Array<Record<string, string>> {
  const byId = new Map(workspace.records.map((record) => [record.id, record]));
  const notReady: Array<Record<string, string>> = [];
  for (const entry of entries) {
    for (const requirement of entry.requirements) {
      const record = byId.get(requirement);
      const reason =
        record === undefined
          ? "missing"
          : record.status === "discarded"
            ? "status-discarded"
            : record.stability === "draft" || record.stability === "deprecated"
              ? `stability-${record.stability}`
              : null;
      if (reason !== null) notReady.push({ wave: entry.wave, requirement, reason });
    }
  }
  return notReady;
}

/** The SDS files a declaration entry names, checked as `--sds` checks them. @req FR-NODE-216 AC-5 */
async function declaredSdsFiles(root: string, workspace: ParsedWorkspace, entry: WaveDeclarationEntry): Promise<CheckedSds[]> {
  const files: CheckedSds[] = [];
  for (const sdsPath of entry.sds ?? []) files.push(await checkScheduledSds(root, workspace, sdsPath));
  return files;
}

/**
 * The `--waves` form: the ready entries of the declaration, judged against the run's journal, each
 * written as `files[]` ∪ its SDS write sets. @req FR-NODE-216
 */
async function declaredSchedule(command: Command, root: string, options: Record<string, unknown>): Promise<ScheduleInput | GateRefusal> {
  const runId = options.runId as string;
  const declarationPath = options.waves as string;
  const declaration = await readWaveDeclaration(root, declarationPath);
  // @req FR-NODE-216 AC-1 — the `--sds` form's rule: one SDS file belongs to one wave, across every entry.
  const namedTwice = sdsNamedTwice(declaration.waves.map((entry) => ({ waveId: entry.wave, sds: entry.sds === undefined ? null : [...entry.sds] })));
  if (namedTwice.length > 0) return refuse("lane-plan-incomplete", namedTwice);

  const view = await readJournalView(projectRoot(command), runId, options.journal as string, requireEngine(options.engine));
  const readiness = waveReadiness(declaration, computeRunProgress(view).waveStatuses);
  const unallocated = readiness.ready.find((entry) => entry.requirements.length === 0);
  if (unallocated !== undefined) throw new OperationalError(`${unallocated.wave} is ready to plan but declares no requirements`);

  const workspace = await parseWorkspace({ root });
  const notReady = requirementsNotReady(workspace, readiness.ready);
  if (notReady.length > 0) return refuse("requirement-not-ready", notReady);

  const waves: ScheduledWave[] = [];
  for (const entry of readiness.ready) {
    const sdsFiles = await declaredSdsFiles(root, workspace, entry);
    const [single] = sdsFiles;
    waves.push({
      waveId: declaredWaveId(runId, entry),
      writeSet: [...new Set([...entry.files, ...sdsFiles.flatMap((file) => file.writeSet)])].sort(),
      ...(entry.files.length === 0 && sdsFiles.length === 0 ? { declared: false } : {}),
      sds: sdsFiles.length === 0 ? null : sdsFiles.length === 1 ? (single as CheckedSds).path : sdsFiles.map((file) => file.path),
      sdsDigest:
        sdsFiles.length === 0
          ? null
          : sdsFiles.length === 1
            ? (single as CheckedSds).digest
            : Object.fromEntries(sdsFiles.map((file) => [file.path, file.digest]))
    });
  }

  let existingPaths: string[];
  if (options.existingPaths) existingPaths = await existingPathsOption(root, options.existingPaths);
  else {
    const tracked = await trackedPathsAtHead(root);
    if (tracked === null) throw new OperationalError("cannot read the paths tracked at HEAD here; pass --existing-paths <file>");
    existingPaths = tracked;
  }

  // @req FR-NODE-216 AC-4 — the isolation is a recorded conflict and a warning, never silent.
  const diagnostics = readiness.ready
    .filter((entry) => entry.files.length === 0 && (entry.sds ?? []).length === 0)
    .map((entry) => ({
      code: "undeclared-write-set",
      severity: "warning",
      wave: entry.wave,
      message: `${entry.wave} declares no files and no SDS, so it is planned alone in its stage`
    }));
  return {
    waves,
    // Every dependency of a ready entry is complete, so no planned wave waits on another planned one.
    dependencies: Object.fromEntries(waves.map((wave) => [wave.waveId, []])),
    existingPaths,
    declaration: {
      path: declarationPath,
      digests: Object.fromEntries(readiness.ready.map((entry) => [declaredWaveId(runId, entry), declarationEntryDigest(entry)]))
    },
    report: {
      deferred: readiness.deferred.map((entry) => entry.wave),
      complete: readiness.complete.map((entry) => entry.wave),
      diagnostics
    }
  };
}

/** The release a lease left by an abandoned run may take: `run unlock` only, never `run abort`. @req IR-CLI-105 AC-2 */
const RELEASE_IF_ABANDONED = Object.freeze({
  cli: "speckiwi orchestrate run unlock --json",
  mcp: 'orchestrate_run_lock with action: "unlock"',
  condition: "use this only if the holding run has been abandoned",
  warning: "unlocking a live run lets two runs share the repository without either being told"
});

/** A held fence with a readable lease: the session that took it releases it. @req IR-CLI-105 AC-3 */
const SESSION_RELEASES = 'the session holding the lock releases it through MCP orchestrate_run_lock with action: "unlock" or orchestrate_run_abort, or must be closed';

/** A held fence with no readable lease: the ghost an earlier release left, or a brief acquisition. @req IR-CLI-105 AC-4 */
const OPEN_SESSION_HOLDS = "if this lasts more than a few seconds, an open session holds the lock: release it from that session or close it";

/** The fence this very session holds: it releases the lock itself. @req FR-NODE-221 */
const THIS_SESSION_HOLDS = 'this session holds the lock: release it here with MCP orchestrate_run_lock action: "unlock" or orchestrate_run_abort';

/**
 * POSIX has no fence, so nothing establishes that no live process holds the lock and the release
 * offer, which says exactly that, is not made. @req IR-CLI-105 AC-2
 */
const NO_FENCE_TO_ASK = "this platform has no fence to tell whether the holding run is alive; if it has been abandoned, speckiwi orchestrate run unlock --json releases it, and unlocking a live run lets two runs share the repository without either being told";

/** What the run lock state tells a caller to do, or nothing beyond the release offer. */
function runLockGuidance(state: RunLockState): string | null {
  if (state.fence === "not-applicable") return NO_FENCE_TO_ASK;
  if (state.fence !== "held") return null;
  if (state.heldByThisProcess) return THIS_SESSION_HOLDS;
  return state.holder === null ? OPEN_SESSION_HOLDS : SESSION_RELEASES;
}

/**
 * What a refusal and `run status` say about the run lock: the lease, the fence, and the one release
 * step that can work in that state. Pid and host are reported, never judged. @req IR-CLI-105
 */
export function runLockReport(state: RunLockState): Record<string, unknown> {
  const fields = {
    owner: state.holder?.owner ?? null,
    pid: state.holder?.pid ?? null,
    host: state.holder?.host ?? null,
    acquiredAt: state.holder?.acquiredAt ?? null,
    leaseExpiresAt: state.leaseExpiresAt,
    fence: reportedFence(state),
    holderUnreadable: state.holderUnreadable,
    lockPath: state.lockPath
  };
  const guidance = runLockGuidance(state);
  return guidance === null ? { ...fields, releaseIfAbandoned: RELEASE_IF_ABANDONED } : { ...fields, guidance };
}

/** A release refused because another live process holds the fence. @req FR-NODE-221 AC-1 */
function liveSessionRefusal(state: RunLockState, extra: Record<string, unknown> = {}): GateRefusal {
  return refuse("run-lock-held-by-live-session", [{
    code: "run-lock-held-by-live-session",
    message: "the run lock is held by a live process: the MCP server of the session that took it, which may be the caller's own session",
    release: 'that session releases it with MCP orchestrate_run_lock action: "unlock" or orchestrate_run_abort, or by being closed',
    ...runLockReport(state),
    ...extra
  }]);
}

/**
 * A release that did not happen, as the verb's answer. A failed fence release by the holder is an
 * operational failure whose diagnostic is reported; the sentinel stays. @req FR-NODE-221 AC-5, AC-6
 */
function unreleased(outcome: Exclude<RunLockRelease, { ok: true }>, extra: Record<string, unknown> = {}): GateRefusal {
  if (outcome.reason === "cleanup-failed") {
    // @req FR-NODE-197 AC-3 — and an abort says its line is already recorded, so a retry only releases.
    const recorded = extra.journalWritten === true ? "; the abort line was recorded, so a retry only releases the lock" : "";
    throw new OperationalError(`the run lock could not be released and stays held${recorded}: ${JSON.stringify(outcome.diagnostic)}`);
  }
  if (outcome.reason === "live-session") return liveSessionRefusal(outcome.state, extra);
  return refuse(RUN_LOCK_GATE, [{
    code: "run-lock-changed-hands",
    message: "the run lock changed hands while it was being released; the new holder was left in place",
    ...runLockReport(outcome.state),
    ...extra
  }]);
}

// --- the journal --------------------------------------------------------------------------------

interface JournalDiagnostic {
  readonly code: string;
  readonly message: string;
  readonly severity: string;
}

interface JournalAppendOutcome {
  readonly written: boolean;
  readonly diagnostics: readonly JournalDiagnostic[];
  /**
   * True when the write was refused because another writer held the journal's lock.
   *
   * @req FR-NODE-197 AC-1 — a typed answer rather than a regex over the diagnostic's prose. The
   * caller has to tell contention from a journal that would be left invalid, and `SRS-E075` carries
   * both here and elsewhere; matching on the message made rewording a sentence a behaviour change.
   */
  readonly contended?: boolean;
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
  const stamped = JSON.stringify({ ...payload, writer: JOURNAL_WRITER_STAMP });
  // @req FR-FLOW-155 AC-2 — the candidate is read under the engine of the line being appended, and
  // the engine comes from `engineOf` because that is the resolver the parser filters with. Pinned to
  // a literal, the candidate view was empty for every `kiwi-wave-master` line, an empty view raises
  // no diagnostics, and the whole family wrote past a guard the skill text says refuses it.
  const engine = engineOf(payload as WavesEvent);

  // @req FR-NODE-196 AC-9 — a dry run takes no lock. It changes nothing, and acquiring an exclusive
  // lock to preview made a concurrent real append fail; `runLockedJsonlMutation` short-circuits its
  // own dry runs past the lock for the same reason.
  if (dryRun) return { written: false, diagnostics: await validateProspectiveJournal(root, relativePath, runId, stamped, engine) };

  const acquired = await acquireJournalLock(absolute);
  if (!acquired.ok) {
    return {
      written: false,
      contended: true,
      diagnostics: [
        {
          code: "SRS-E075",
          message: `Workflow artifact mutation lock is held for ${relativePath}`,
          severity: "error"
        }
      ]
    };
  }

  try {
    const diagnostics = await validateProspectiveJournal(root, relativePath, runId, stamped, engine);
    if (diagnostics.some((entry) => entry.severity === "error")) {
      return withCleanupDiagnostic({ written: false, diagnostics }, await releaseJournalLock(acquired.capability, relativePath));
    }

    // @req FR-NODE-196 AC-2 — one O_APPEND write, not a rewrite of the file. The previous shape read
    // the journal whole, built a copy with one line added and renamed it over the original; every
    // line another writer appended after that read was overwritten by the rename, and the survivor
    // was well-formed JSONL so nothing could see it. Guarding the rename with a byte comparison only
    // narrowed the window - the compare and the rename are separate syscalls - and measurement found
    // the loss alive at 55% to 80% of the command's own duration, peaking at 7 of 10 trials. An
    // append has no window to narrow: it cannot overwrite what it never read.
    const existing = await readJournalBytes(absolute);
    await mkdir(path.dirname(absolute), { recursive: true });
    await appendUtf8LineAndSync(absolute, stamped, existing.length > 0 && !existing.endsWith("\n"));
    return withCleanupDiagnostic({ written: true, diagnostics }, await releaseJournalLock(acquired.capability, relativePath));
  } catch (error) {
    // @req FR-NODE-196 AC-4 — the throw path releases too. A stranded lock is invisible across
    // processes, because one whose owning pid is dead is stolen as stale and each CLI call is its own
    // short-lived process; the MCP server runs `main` in-process and stays alive, so a lock stranded
    // there is one nobody may steal and the journal stops accepting writes until restart.
    await releaseJournalLock(acquired.capability, relativePath);
    throw error;
  }
}

/**
 * Reads the journal, treating **only** a missing file as empty.
 *
 * @req FR-NODE-196 AC-8 — every other errno used to collapse to "" as well, and the write then put a
 * one-line journal in place of the real one and reported success. The byte comparison that was
 * supposed to guard it compared "" against "" and certified the truncation. EACCES, EMFILE under the
 * lane fan-out, EBUSY from an indexer and EIO on a share all reach here.
 */
async function readJournalBytes(absolute: string): Promise<string> {
  try {
    return await readFile(absolute, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return "";
    throw error;
  }
}

/**
 * Validates the journal as it **would** be once this line lands, using the same parser a reader uses
 * rather than a reconstruction of it.
 *
 * @req FR-NODE-196 AC-3 — the candidate carries a per-attempt name and is removed by the attempt that
 * wrote it. Under one fixed name two concurrent runs wrote the same path and each one's cleanup
 * deleted the other's work in progress.
 */
async function validateProspectiveJournal(
  root: ProjectRoot,
  relativePath: string,
  runId: string,
  stamped: string,
  engine: Engine
): Promise<JournalDiagnostic[]> {
  const absolute = path.resolve(root.root, relativePath);
  const candidateRelative = `${relativePath}.candidate.${process.pid}.${randomUUID()}`;
  const candidateAbsolute = path.resolve(root.root, candidateRelative);
  const existing = await readJournalBytes(absolute);
  const separator = existing.length === 0 || existing.endsWith("\n") ? "" : "\n";

  await mkdir(path.dirname(candidateAbsolute), { recursive: true });
  try {
    await writeFile(candidateAbsolute, `${existing}${separator}${stamped}\n`, "utf8");
    const view = await parseWavesJournal(root, { runId, engine, relativePath: candidateRelative });
    return validateWavesJournal(view).map((entry) => ({
      code: entry.code,
      message: entry.message,
      severity: entry.severity
    }));
  } finally {
    await rm(candidateAbsolute, { force: true });
  }
}

/**
 * Waits for the journal lock rather than refusing on the first miss.
 *
 * @req FR-NODE-196 AC-1 — the lock is held for one validate-and-append, so at the documented
 * `--lanes` ceiling of 8 two writers colliding is ordinary. A single non-blocking try turned four of
 * eight concurrent appends into hard refusals, and it refused `run abort` - the one verb an
 * orchestrator calls when it must stop - whenever a lane happened to be journalling. An acquire that
 * throws is left to throw: reporting a permission fault as contention tells the operator to wait for
 * a holder that does not exist.
 */
async function acquireJournalLock(absolute: string): Promise<AcquireArtifactLockResult> {
  const deadline = process.hrtime.bigint() + BigInt(WAVES_LOCK_WAIT_MS) * 1_000_000n;
  for (;;) {
    const result = await acquireArtifactLock({ artifactPath: absolute, owner: JOURNAL_WRITER_STAMP });
    if (result.ok || process.hrtime.bigint() >= deadline) return result;
    await delay(15);
  }
}

/**
 * Releases the journal lock and reports a release that did not take.
 *
 * @req FR-NODE-196 AC-10 — the result used to be discarded. `releaseArtifactLock` answers
 * `cleanup_failed` when the sentinel survives, parks the capability for a later retry and leaves the
 * lock in place; in the MCP server, whose pid stays alive, that is a journal nobody can write again
 * until restart. Silence there is the worst available answer.
 */
async function releaseJournalLock(
  capability: ArtifactLockCapability,
  relativePath: string
): Promise<JournalDiagnostic | null> {
  const released = await releaseArtifactLock(capability);
  if (released.ok && released.released) return null;
  return {
    code: "SRS-E075",
    message: `Workflow artifact lock cleanup failed for ${relativePath} (${released.reason ?? "unknown"}); the lock may still be held`,
    severity: "warning"
  };
}

function withCleanupDiagnostic(outcome: JournalAppendOutcome, cleanup: JournalDiagnostic | null): JournalAppendOutcome {
  return cleanup === null ? outcome : { ...outcome, diagnostics: [...outcome.diagnostics, cleanup] };
}

/** Reads a run's journal view, or throws an operational error when the file cannot be parsed. */
async function readJournalView(
  root: ProjectRoot,
  runId: string,
  relativePath: string,
  engine: Engine = "kiwi-orchestrator"
): Promise<WavesJournalView> {
  try {
    return await parseWavesJournal(root, { runId, engine, relativePath });
  } catch (error) {
    throw new OperationalError(`the run journal is unreadable at ${relativePath}: ${(error as Error).message}`, { cause: error });
  }
}

/**
 * The run a verb reads: `--run-id` as given, or else the most recent run under the engine whose
 * run-scope state is neither complete nor aborted. None left is a usage error, not a gate.
 * @req FR-NODE-217 AC-1, IR-CLI-104 AC-6
 */
async function selectRunId(root: ProjectRoot, runId: unknown, engine: Engine, relativePath: string): Promise<string> {
  if (typeof runId === "string" && runId.length > 0) return runId;
  if ((await readJournalBytes(path.resolve(root.root, relativePath))).length === 0) {
    throw new OperationalError(`no run journal at ${relativePath} (missing or empty): nothing to resume`);
  }
  for (const candidate of await listJournalRunIds(root, { engine, relativePath })) {
    const view = await readJournalView(root, candidate, relativePath, engine);
    if (!computeRunProgress(view).runComplete && !isRunAborted(view)) return candidate;
  }
  throw new OperationalError(`no resumable run: every ${engine} run in ${relativePath} is complete or aborted; pass --run-id`);
}

/** A wave declaration file, parsed or refused as an operational error naming what is wrong. @req FR-NODE-216 AC-1 */
async function readWaveDeclaration(root: string, declarationPath: string): Promise<WaveDeclaration> {
  const parsed = parseWaveDeclaration(await readJsonFile(path.resolve(root, declarationPath), "--waves"));
  if (!parsed.ok) throw new OperationalError(`--waves ${declarationPath}: ${parsed.gate === null ? "" : `${parsed.gate}: `}${parsed.message}`);
  return parsed.declaration;
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
    .option("--run-id <id>", "the run whose lines are read; defaults to the most recent resumable run")
    // @req FR-NODE-217 AC-1 — kiwi-orchestrator by default: only that engine writes resume cards.
    .option("--engine <engine>", "journal engine (kiwi-orchestrator | kiwi-wave-master)", "kiwi-orchestrator")
    .option("--journal <path>", "run journal path", WAVES_JOURNAL_PATH)
    .option("--card <path>", "resume card path")
    .option("--facts <path>", "git facts and drift inputs, as JSON; collected from the repository when absent")
    .action(async (options) => {
      await read(orchestrate, options, async () => {
        const root = projectRoot(command);
        const engine = requireEngine(options.engine);
        const runId = await selectRunId(root, options.runId, engine, options.journal as string);
        const view = await readJournalView(root, runId, options.journal as string, engine);
        // @req FR-NODE-127 AC-3 — an invalid journal refuses before any resume state is computed.
        // @req FR-NODE-213 AC-6 — a retired term is a warning on history only so that appends into the
        // run are not blocked; resume refuses it at any severity, or the retired verb comes back as the
        // next action.
        const invalid = validateWavesJournal(view).filter(
          (entry) => entry.severity === "error" || entry.code === "vocabulary-retired-in-4-0-0"
        );
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
        // @req FR-NODE-213 AC-6 — an R-PLAN or handoff-era run is refused by name, beside whatever the
        // card check found: 4.0.0 has no path that continues it, and the old lines it settled its lanes
        // on must not be read as lanes never dispatched.
        const markers = retiredRunMarkers(view, parsed.card);
        const predates = markers.length === 0 ? [] : [{ code: "run-predates-4.0.0", message: "this run was written before 4.0.0 and cannot be resumed; start a new run", markers }];
        if (!cardValidation.ok || predates.length > 0) {
          return refuse("resume-card-missing-or-invalid", [...cardValidation.violations.map((code) => ({ code })), ...predates]);
        }
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
        // @req FR-NODE-217 AC-2, AC-4 — a facts file keeps its 4.0.0 meaning; without one the facts are
        // read from the repository here, and the kernel stays pure.
        const collected = options.facts === undefined;
        const facts = collected
          ? await collectResumeFacts(root.root, runId, parsed.card, view)
          : ((await readJsonFile(path.resolve(root.root, options.facts as string), "--facts")) as {
              gitFacts?: GitFacts;
              driftInputs?: DriftInputs;
            });
        if (!facts.gitFacts || !facts.driftInputs) {
          throw new OperationalError("--facts must supply both gitFacts and driftInputs; the tool never invents them");
        }
        const state = computeResumeState(view, parsed.card, facts.gitFacts, facts.driftInputs);
        if (state.blocking !== null) return refuse(state.blocking, state.drift.digests.filter((entry) => entry.gate !== null));
        // @req FR-NODE-217 AC-3 — with self-collected facts digest 2 had no comparand, so it is reported
        // as not checked rather than as a match.
        const reported = collected
          ? {
              ...state,
              drift: {
                digests: state.drift.digests.map((entry) =>
                  entry.index === 2
                    ? { index: 2, outcome: "unchecked", gate: null, detail: "intent inputs were not re-digested: no per-verb declared-input list exists" }
                    : entry
                )
              }
            }
          : state;
        const warnings = collected
          ? [{ code: "intent-digest-unchecked", severity: "warning", message: "drift digest 2 (intent inputs) was not checked; pass --facts with freshIntentDigests to check it" }]
          : [];
        // @req FR-NODE-113 AC-5 — 09 §9.5 step 2: the rung is READ off the card. `computeRoute` is
        // reachable from this file, so the read is written out here rather than left implicit — a
        // resumed session has no conversation and no investigators, and several probe fields are not
        // reproducible across a compaction, so a recomputation could legally switch ladders mid-run.
        // Reported only past the drift gate above: a refused resume dispatches nothing.
        const route = parsed.card.frozen?.route;
        return { runId, resume: reported, rung: route === undefined ? null : resumeRung(route), warnings };
      });
    });

  // ---- preflight ----------------------------------------------------------------------------------
  addCommonOptions(orchestrate.command("preflight"))
    // @req IR-CLI-082 AC-6 — both roots are arguments; neither is derived from the process cwd,
    // because the CLI resolves cwd and the MCP server fixes its own, so an in-tool read is vacuous.
    .requiredOption("--mcp-root <path>", "the root the MCP server reports")
    .requiredOption("--git-root <path>", "the root `git rev-parse --show-toplevel` reports")
    // @req IR-CLI-093 — the role is DECLARED. Inferring it from the roots would let any worktree of
    // the repository satisfy "this must be a lane", including one the run never planned.
    .option("--role <host|lane>", "which relation this run root is claiming", "host")
    .option("--lane-id <id>", "the lane this root claims to be, required with --role lane")
    .option("--lane-plan <path>", "the frozen lane plan the id must appear in, required with --role lane")
    .action(async (options) => {
      await read(orchestrate, options, async () => {
        const role = options.role as string;
        if (role !== "host" && role !== "lane") {
          throw new OperationalError(`--role must be host or lane, not ${role}`);
        }
        // Every call routes through the gate, the default host included. Reaching it only when a
        // role is typed would make the safe behaviour the one you have to ask for, and would leave a
        // host rooted in a worktree passing for every caller that never heard of the option.
        return await roleAwarePreflight(command, options, role);
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
          // @req IR-CLI-105 AC-8 — the acquisition's own decision, not a second rule: an expired lease
          // or a dead legacy holder is reclaimed by both, an unexpired lease refused by both.
          const state = await inspectRunLock(commonDir);
          if (acquisitionRefused(state)) return refuse(RUN_LOCK_GATE, [runLockReport(state)]);
          return { lockPath: state.lockPath };
        }
        try {
          const lock = await acquire({ commonDir, owner: options.owner as string });
          // @req FR-NODE-204 AC-1 — the lease this call took, in the shape `run status` reports, so a
          // run that resumes can decide whether the lease on disk is still the one it holds. Without
          // it the response named only the path, which every run shares, and so did `--owner`.
          return { lockPath: lock.lockPath, holder: lock.holder };
        } catch (error) {
          // @req IR-CLI-105 AC-1 — the refusal names the lease and the release step that can work.
          if (error instanceof RunLockHeldError) return refuse(error.gate, [runLockReport(await inspectRunLock(commonDir))]);
          throw error;
        }
      });
    });

  addMutationOptions(run.command("unlock")).action(async (options) => {
    await mutate(options, async () => {
      const commonDir = await resolveGitCommonDir(runRoot(command));
      // @req FR-NODE-197 AC-7 — the holder reported is the one the release itself saw, not one read
      // a moment earlier by a second call. Two reads over one sentinel can disagree, and the answer
      // that matters is what was there when it was removed.
      // @req FR-NODE-221 AC-9 — the dry run refuses exactly where the real call would, and releases nothing.
      if (options.dryRun === true) {
        const blocker = await foreignReleaseBlocker(commonDir);
        if (blocker) return liveSessionRefusal(blocker);
        return { lockPath: runLockPath(commonDir), heldBy: (await readHolder(commonDir))?.owner ?? null };
      }
      const outcome = await releaseHeldRunLock(commonDir);
      if (!outcome.ok) return unreleased(outcome);
      return { lockPath: runLockPath(commonDir), heldBy: outcome.owner };
    });
  });

  addCommonOptions(run.command("status")).action(async (options) => {
    await read(orchestrate, options, async () => {
      const commonDir = await resolveGitCommonDir(runRoot(command));
      // @req IR-CLI-105 AC-7 — `holder` keeps its four keys (FR-NODE-204); the lease and fence sit beside it.
      const state = await inspectRunLock(commonDir);
      return {
        lockPath: state.lockPath,
        holder: state.holder,
        leaseExpiresAt: state.leaseExpiresAt,
        fence: reportedFence(state),
        holderUnreadable: state.holderUnreadable,
        ...(state.fence === "held" ? { guidance: runLockGuidance(state) } : {})
      };
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
        // @req FR-NODE-221 AC-3, FR-NODE-197 AC-3/AC-4 — refused before the journal is touched while
        // another live process holds the fence; the refusal still says the lock is held and names it.
        const blocker = await foreignReleaseBlocker(commonDir);
        if (blocker) return liveSessionRefusal(blocker, { runLockHeld: true, lockPath: blocker.lockPath });
        // @req FR-NODE-197 AC-3 — a retry after a failed release finds its own abort line (same run, same
        // gate) and only releases; appending again would record the run's end twice.
        const alreadyRecorded = (await readJournalView(root, runId, options.journal as string)).lines.some(
          (line) => line.verb === "abort-run" && line.event === "result" && line.abort_gate === options.reason
        );
        let outcome: JournalAppendOutcome = { written: true, diagnostics: [] };
        if (!alreadyRecorded) outcome = await appendWavesLine(
          root,
          options.journal as string,
          runId,
          // @req FR-NODE-167 — `abort_gate`, never `reason_class`: that name belongs to
          // `verification.residual[]` over a different closed vocabulary, and at top level it was
          // both undeclared and unenforced.
          { schema_version: CURRENT_WAVES_SCHEMA_VERSION, run_id: runId, engine: "kiwi-orchestrator", verb: "abort-run", event: "result", wave: "all", abort_gate: options.reason },
          options.dryRun === true
        );
        if (!outcome.written && options.dryRun !== true) {
          // @req FR-NODE-197 AC-1/AC-3 — the cause decides the gate, and the refusal says the run
          // lock is still held. Reporting contention as invariant drift sent the operator after a
          // corrupted journal; refusing without mentioning the lock left the run wedged behind a
          // fact nothing had told them. Keeping the lock is deliberate: an abort that could not
          // record itself has left the run in a state another session must not join.
          return refuse(outcome.contended === true ? "journal-artifact-lock-held" : "run-invariant-drift", [
            ...outcome.diagnostics,
            { runLockHeld: true, lockPath: runLockPath(commonDir) }
          ]);
        }
        if (options.dryRun !== true) {
          const released = await releaseHeldRunLock(commonDir);
          if (!released.ok) return unreleased(released, { runLockHeld: true, journalWritten: outcome.written });
        }
        return { reason: options.reason, journalWritten: outcome.written, ...(alreadyRecorded ? { alreadyRecorded: true } : {}) };
      });
    });

  // ---- journal ---------------------------------------------------------------------------------------
  const journal = orchestrate.command("journal").description("the run journal");

  addMutationOptions(journal.command("append"))
    .option("--run-id <id>", "the run the line belongs to")
    .option("--payload <json>", "the journal line, inline")
    .option("--payload-file <path>", "the journal line, as a JSON file; instead of --payload")
    .option("--journal <path>", "run journal path", WAVES_JOURNAL_PATH)
    .action(async (options) => {
      await mutate(options, async () => {
        const root = projectRoot(command);
        const runId = requireOption(options.runId, "--run-id");
        // @req FR-NODE-218 AC-4 — exactly one of the two sources.
        if ((options.payload === undefined) === (options.payloadFile === undefined)) {
          throw new OperationalError("give exactly one of --payload and --payload-file");
        }
        const payload =
          options.payloadFile === undefined
            ? parseInlineJson(options.payload, "--payload")
            : jsonObject(await readJsonFile(path.resolve(root.root, options.payloadFile as string), "--payload-file"), "--payload-file");
        // @req FR-NODE-218 AC-5 — a line missing a field of its scope is refused before any byte is written.
        const scope = eventScopeOf(payload);
        const missing = scope === null ? [] : WAVES_EVENT_REQUIRED_BY_SCOPE[scope].filter((field) => payload[field] === undefined || payload[field] === null);
        if (scope !== null && missing.length > 0) {
          return refuse("run-invariant-drift", [
            { code: "journal-required-field-missing", scope, fields: missing, message: `${scope === "intent" ? "an" : "a"} ${scope} line needs ${missing.join(", ")}` }
          ]);
        }
        // @req FR-NODE-218 AC-3 — the tool's clock fills `ts`; a supplied one is kept.
        const line = payload.ts === undefined ? { ...payload, ts: new Date().toISOString() } : payload;
        const outcome = await appendWavesLine(root, options.journal as string, runId, line, options.dryRun === true);
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
        // @req FR-NODE-218 AC-1, AC-2 — the digest and the time are the tool's to compute.
        const payload = stampCard(parseInlineJson(options.payload, "--payload") as unknown as ResumeCard, new Date().toISOString());
        const view = await readJournalView(root, runId, options.journal as string);
        const written = writeCard(payload, view);
        if (!written.ok) return refuse("resume-card-missing-or-invalid", written.violations);
        if (options.dryRun !== true) await writeUnderRoot(root.root, written.relativePath, written.text);
        return { path: written.relativePath, writtenAt: payload.written_at };
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
          const text = serializeLock(frozen.lock);
          if (options.dryRun !== true) await writeUnderRoot(root, out, text);
          // @req FR-NODE-217 AC-2 — the card records this pointer; resume recomputes it the same way.
          return { lock: frozen.lock, out, pointer: filePointer(out, text) };
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
  const schedule = orchestrate.command("schedule").description("the wave schedule");

  // @req FR-NODE-213 AC-1, FR-NODE-216 — one lane per wave, from a wave declaration file or SDS files.
  addMutationOptions(schedule.command("waves"))
    .option("--waves <path>", "a wave declaration file; plans its ready waves from the run journal (needs --run-id)")
    .option("--sds <path...>", "the wave SDS files, in wave order; <waveId>=<file>,<file> makes several SDS files one wave")
    .option("--depends <json>", "with --sds: declared dependencies {waveId: [waveId, ...]}; a wave with no key depends on every earlier wave")
    .option("--lanes <n>", `per-stage lane cap, 1 to ${MAX_LANE_CAP}`, laneCapOption, 4)
    // @req IR-CLI-084 AC-6 — off by default, and journalled when used.
    .option("--strict-grounding", "require every declared path to exist at the dispatch base")
    .option("--existing-paths <path>", "the dispatch base path list, as JSON; with --waves, defaults to the paths tracked at HEAD")
    .option("--out <path>", "where the lanes lock is written", "waves/lanes.lock.json")
    .option("--run-id <id>", "the run whose journal records the option use, and with --waves the run whose waves are read")
    .option("--engine <engine>", "with --waves: the journal engine read for readiness (kiwi-orchestrator | kiwi-wave-master)", "kiwi-orchestrator")
    .option("--journal <path>", "run journal path", WAVES_JOURNAL_PATH)
    .action(async (options) => {
      await mutate(options, async () => {
        const root = runRoot(command);
        const input = scheduleForm(options) === "waves" ? await declaredSchedule(command, root, options) : await sdsSchedule(root, options);
        if (isRefusal(input)) return input;
        const { waves, dependencies } = input;
        // @req FR-NODE-216 AC-2 — nothing ready is a report, not a lock: a zero-lane lock would read as a
        // stage that ran.
        if (waves.length === 0) return { lock: null, out: null, ...input.report };
        const engine = requireEngine(options.engine);
        // @req IR-CLI-084 AC-4, AC-5 — every declared path, judged by the pure detector over the paths the
        // command collected, BEFORE the planner is called.
        const declared = [...new Set(waves.flatMap((wave) => wave.writeSet))].sort();
        const grounding = groundFiles(declared, input.existingPaths, options.strictGrounding === true);
        const ungrounded = grounding
          .filter((entry) => isGroundingRefusal(entry.verdict))
          .map((entry) => ({ ...entry, waves: waves.filter((wave) => wave.writeSet.includes(entry.path)).map((wave) => wave.waveId) }));
        // @req FR-NODE-165 — the outcome is read, not discarded. A refused append leaves the journal
        // byte-identical, so returning a lock here would report the option use as recorded against a
        // journal that never received it.
        let journalWritten = false;
        if (options.strictGrounding === true && typeof options.runId === "string" && options.runId.length > 0) {
          const outcome = await appendWavesLine(
            projectRoot(command),
            options.journal as string,
            options.runId,
            {
              schema_version: CURRENT_WAVES_SCHEMA_VERSION,
              run_id: options.runId,
              engine,
              verb: "freeze-lane-plan",
              event: "intent",
              wave: "all",
              strict_grounding: true
            },
            options.dryRun === true
          );
          if (!outcome.written && options.dryRun !== true) return refuse("run-invariant-drift", outcome.diagnostics);
          journalWritten = outcome.written;
        }
        if (ungrounded.length > 0) return refuse("files-not-grounded", ungrounded);
        try {
          const laneCap = options.lanes as number;
          const plan = computeLanePlan({
            waves: waves.map(({ waveId, writeSet, declared: isDeclared }) => ({ waveId, writeSet, ...(isDeclared === false ? { declared: false } : {}) })),
            dependencies,
            laneCap
          });
          const withSds = waves.filter((wave) => wave.sds !== null);
          const lock = buildLanesLockBody({
            plan,
            dependencies,
            laneCap,
            sdsDigests: Object.fromEntries(withSds.map((wave) => [wave.waveId, wave.sdsDigest as WaveSdsDigest])),
            sdsPaths: Object.fromEntries(withSds.map((wave) => [wave.waveId, wave.sds as string | string[]])),
            ...(input.declaration === undefined ? {} : { declaration: input.declaration })
          });
          const text = `${JSON.stringify(lock, null, 2)}\n`;
          if (options.dryRun !== true) await writeUnderRoot(root, options.out as string, text);
          return { lock, grounding, out: options.out, pointer: filePointer(options.out as string, text), journalWritten, ...input.report };
        } catch (error) {
          if (error instanceof LanePlanError) return refuse(error.code, [{ message: error.message }]);
          throw new OperationalError((error as Error).message, { cause: error });
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

  // ---- round ------------------------------------------------------------------------------------------------
  const round = orchestrate.command("round").description("a verification round");

  addMutationOptions(round.command("record"))
    .option("--run-id <id>", "the run the round belongs to")
    .option("--payload <json>", "the round, inline")
    // @req FR-NODE-169 AC-7 — required, not optional. A round record is verdict-bearing and
    // `waves-event.md` §2.2 requires one externally recomputable proof on such a line, but
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
            schema_version: CURRENT_WAVES_SCHEMA_VERSION,
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

  // @req IR-CLI-104 — read-only: the journal and the declaration are read, nothing is written.
  addCommonOptions(wave.command("status"))
    .option("--run-id <id>", "the run whose waves are reported; defaults to the most recent resumable run")
    .option("--engine <engine>", "journal engine (kiwi-orchestrator | kiwi-wave-master)", "kiwi-orchestrator")
    .option("--journal <path>", "run journal path", WAVES_JOURNAL_PATH)
    .option("--waves <path>", "a wave declaration file; also lists the waves schedule waves --waves would plan")
    .action(async (options) => {
      await read(orchestrate, options, async () => {
        const root = projectRoot(command);
        const engine = requireEngine(options.engine);
        const relativePath = options.journal as string;
        const runId = await selectRunId(root, options.runId, engine, relativePath);
        const view = await readJournalView(root, runId, relativePath, engine);
        // A run the journal does not hold is an error, not an empty report that reads as "no waves yet".
        if (view.lines.length === 0) throw new OperationalError(`run ${runId} has no ${engine} line in ${relativePath}`);
        const progress = computeRunProgress(view);
        const field = (value: unknown, type: "string" | "number"): unknown => (typeof value === type ? value : null);
        const waves = [...view.latestPerWave.entries()]
          .sort(([left], [right]) => left - right)
          .map(([n, event]) => ({
            wave: `wave-${n}`,
            status: progress.waveStatuses.get(n) ?? null,
            phase: field(event.phase, "string"),
            sds_id: field(event.sds_id, "string"),
            stage: field(event.stage, "number"),
            lane: field(event.lane, "string"),
            ts: field(event.ts, "string")
          }));
        const ready =
          typeof options.waves === "string"
            ? { ready: waveReadiness(await readWaveDeclaration(root.root, options.waves), progress.waveStatuses).ready.map((entry) => entry.wave) }
            : {};
        return {
          waves,
          run: { runId, engine, complete: progress.runComplete, needsFinalVerify: progress.needsFinalVerify, aborted: isRunAborted(view) },
          ...ready
        };
      });
    });

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
    // @req FR-NODE-188 — without this a kiwi-wave-master run has no enforcement caller: every
    // reader here is scoped to the orchestrator engine and `parseWavesJournal` drops the other's
    // lines, so its run-close record would be validated by nothing that ships.
    .option("--engine <engine>", "journal engine to validate (kiwi-orchestrator | kiwi-wave-master)", "kiwi-orchestrator")
    .action(async (options) => {
      await read(orchestrate, options, async () => {
        const root = projectRoot(command);
        const runId = requireOption(options.runId, "--run-id");
        const engine = requireEngine(options.engine);
        const view = await readJournalView(root, runId, options.journal as string, engine);
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
