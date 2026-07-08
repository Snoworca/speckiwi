import { readFile } from "node:fs/promises";
import path from "node:path";
import type { ParsedWorkspace } from "../types.js";
import { splitDiagnostics } from "../diagnostic.js";
import {
  AGENT_INSTRUCTION_END_MARKER,
  AGENT_INSTRUCTION_HEADING_PREFIX,
  AGENT_INSTRUCTION_VERSION,
  BUNDLED_RULES_VERSION
} from "../bootstrap/templates.js";

// @req IR-CLI-051
// IR-CLI-051 — `speckiwi doctor` consolidated environment health diagnosis.
//
// The doctor reports one diagnosis check per health topic the SRS enumerates: docs spec presence and
// parseability, agent workflow block version currency, bundled-versus-installed rules version drift,
// Active Target set, scope and target consistency, and Node version. Every check carries a closed
// {ok, warn, fail} state plus a non-empty remediation hint (AC-1). The report is rendered as a plain
// data object so the CLI can serialize it for --json (AC-2). The diagnosis is pure read — it never
// writes a file (AC-3); the optional repair is the CLI's --fix path, which re-runs the idempotent init
// workflow-block upsert only (AC-4) and lives in the CLI layer, not here.

/** A single health-state verdict in the doctor's closed state set. */
export type HealthState = "ok" | "warn" | "fail";

/** One diagnosis check the doctor reports. */
export interface DoctorCheck {
  /** The SRS health topic this check covers. */
  topic: string;
  /** Short human label for the check. */
  label: string;
  /** The closed {ok, warn, fail} health verdict. */
  state: HealthState;
  /** Human-readable finding for this check. */
  message: string;
  /** Non-empty actionable remediation hint (always present, even when ok). */
  remediation: string;
}

/** The consolidated doctor diagnosis: the ordered set of per-topic checks. */
export interface DoctorReport {
  checks: DoctorCheck[];
}

// @req IR-CLI-051
// The agent files the workflow-block currency check inspects (the same pair init upserts).
const AGENT_FILES: readonly string[] = ["CLAUDE.md", "AGENTS.md"];

// @req IR-CLI-051
/** Extracts the leading semver (X.Y.Z or X.Y) token from a string, or undefined when absent. */
function extractVersion(text: string): string | undefined {
  return /\bv?(\d+(?:\.\d+){1,2})\b/.exec(text)?.[1];
}

// @req IR-CLI-051
/** Reads a file as UTF-8, returning undefined when it is absent or unreadable. */
async function readOrUndefined(target: string): Promise<string | undefined> {
  try {
    return await readFile(target, "utf8");
  } catch {
    return undefined;
  }
}

// @req IR-CLI-051
/**
 * Docs spec presence and parseability: the workspace must expose at least one parsed requirement
 * record and carry no structural parse-time errors. A parse error is a fail; an empty-but-clean
 * spec is a warn (nothing to diagnose yet); otherwise ok.
 */
function checkSpecPresence(workspace: ParsedWorkspace): DoctorCheck {
  const topic = "docs spec presence and parseability";
  const { errors } = splitDiagnostics(workspace.diagnostics);
  if (errors.length > 0) {
    return {
      topic,
      label: "Docs spec parseable",
      state: "fail",
      message: `docs/spec has ${errors.length} parse-time error(s)`,
      remediation: "Run `speckiwi validate` and fix the reported SRS parse errors so the spec parses cleanly."
    };
  }
  if (workspace.records.length === 0) {
    return {
      topic,
      label: "Docs spec present",
      state: "warn",
      message: "docs/spec parses but holds no requirement records",
      remediation: "Add at least one requirement with `speckiwi add-requirement`, or run `speckiwi init` to scaffold the spec."
    };
  }
  return {
    topic,
    label: "Docs spec present",
    state: "ok",
    message: `docs/spec parses with ${workspace.records.length} requirement record(s)`,
    remediation: "No action needed; docs/spec is present and parses cleanly."
  };
}

// @req IR-CLI-051
/**
 * Agent workflow block version currency: each agent file (CLAUDE.md / AGENTS.md) should carry the
 * current versioned workflow heading plus its end marker. A missing file or a stale/markerless block
 * warns (repairable with --fix); all present and current is ok.
 */
async function checkWorkflowCurrency(root: string): Promise<DoctorCheck> {
  const topic = "agent workflow block version currency";
  const currentHeading = `${AGENT_INSTRUCTION_HEADING_PREFIX}${AGENT_INSTRUCTION_VERSION}`;
  const stale: string[] = [];
  for (const agentFile of AGENT_FILES) {
    const body = await readOrUndefined(path.join(root, agentFile));
    if (body === undefined || !body.includes(currentHeading) || !body.includes(AGENT_INSTRUCTION_END_MARKER)) {
      stale.push(agentFile);
    }
  }
  if (stale.length > 0) {
    return {
      topic,
      label: "Agent workflow block current",
      state: "warn",
      message: `workflow block missing or outdated in: ${stale.join(", ")} (current v${AGENT_INSTRUCTION_VERSION})`,
      remediation: "Run `speckiwi doctor --fix` (or `speckiwi init`) to re-upsert the current agent workflow block."
    };
  }
  return {
    topic,
    label: "Agent workflow block current",
    state: "ok",
    message: `agent workflow block is current (v${AGENT_INSTRUCTION_VERSION}) in ${AGENT_FILES.join(", ")}`,
    remediation: "No action needed; the agent workflow block is current."
  };
}

// @req IR-CLI-051
/**
 * Bundled-versus-installed rules version drift: compares this package's bundled SRS-MD rules version
 * against the version the workspace index's Rules link advertises. A mismatch warns; a match is ok;
 * an index that declares no rules version warns (cannot confirm currency).
 */
function checkRulesDrift(workspace: ParsedWorkspace): DoctorCheck {
  const topic = "bundled versus installed rules version drift";
  const rulesMeta = workspace.index.metadata.Rules ?? workspace.index.metadata.rules;
  const installed = typeof rulesMeta === "string" ? extractVersion(rulesMeta) : undefined;
  if (installed === undefined) {
    return {
      topic,
      label: "Rules version drift",
      state: "warn",
      message: `cannot determine the installed rules version; bundled is v${BUNDLED_RULES_VERSION}`,
      remediation: "Add a Rules row to docs/spec/00.index.md, or run `speckiwi init` to install the bundled rules document."
    };
  }
  if (installed !== BUNDLED_RULES_VERSION) {
    return {
      topic,
      label: "Rules version drift",
      state: "warn",
      message: `installed rules v${installed} differs from bundled rules v${BUNDLED_RULES_VERSION}`,
      remediation: `Update the docs/rule rules document to v${BUNDLED_RULES_VERSION} (run \`speckiwi init --force\` to refresh the bundled rules).`
    };
  }
  return {
    topic,
    label: "Rules version drift",
    state: "ok",
    message: `installed rules v${installed} matches bundled rules v${BUNDLED_RULES_VERSION}`,
    remediation: "No action needed; the installed rules document matches the bundled version."
  };
}

// @req IR-CLI-051
/** Active Target set: the index must declare a non-empty Active Target. */
function checkActiveTarget(workspace: ParsedWorkspace): DoctorCheck {
  const topic = "Active Target set";
  const activeTarget = workspace.index.activeTarget.trim();
  if (activeTarget === "") {
    return {
      topic,
      label: "Active Target set",
      state: "warn",
      message: "no Active Target is set in docs/spec/00.index.md",
      remediation: "Set the Active Target with `speckiwi set-active-target <target>` before doing target-scoped work."
    };
  }
  return {
    topic,
    label: "Active Target set",
    state: "ok",
    message: `Active Target is ${activeTarget}`,
    remediation: "No action needed; an Active Target is set."
  };
}

// @req IR-CLI-051
/**
 * Scope and target consistency: every requirement's scope must be a registered scope in the index
 * Scope Map, and its target must be a registered target in the Target Map. Any unregistered scope or
 * target referenced by a record is a fail (the index and the records have drifted apart); otherwise ok.
 */
function checkScopeTargetConsistency(workspace: ParsedWorkspace): DoctorCheck {
  const topic = "scope and target consistency";
  const knownScopes = new Set(workspace.index.scopes.map((scope) => scope.prefix));
  const knownTargets = new Set(workspace.index.targets.map((target) => target.target));
  const unknownScopes = new Set<string>();
  const unknownTargets = new Set<string>();
  // FND-004: an EMPTY index map (no registered scopes/targets) cannot confirm registration for any
  // record that references a scope/target. The drift gate below skips records when the map is empty,
  // so track whether records reference values an empty map could not vouch for, and surface that as a
  // warn (the index Scope Map / Target Map is missing or empty) instead of a false ok.
  const unconfirmedScope = knownScopes.size === 0 && workspace.records.some((record) => record.scope !== "");
  const unconfirmedTarget = knownTargets.size === 0 && workspace.records.some((record) => record.target !== "");
  for (const record of workspace.records) {
    if (knownScopes.size > 0 && record.scope !== "" && !knownScopes.has(record.scope)) unknownScopes.add(record.scope);
    if (knownTargets.size > 0 && record.target !== "" && !knownTargets.has(record.target)) unknownTargets.add(record.target);
  }
  if (unknownScopes.size > 0 || unknownTargets.size > 0) {
    const parts: string[] = [];
    if (unknownScopes.size > 0) parts.push(`unregistered scope(s): ${[...unknownScopes].join(", ")}`);
    if (unknownTargets.size > 0) parts.push(`unregistered target(s): ${[...unknownTargets].join(", ")}`);
    return {
      topic,
      label: "Scope and target consistency",
      state: "fail",
      message: parts.join("; "),
      remediation: "Register the missing scope(s)/target(s) in docs/spec/00.index.md, or retarget the affected requirements."
    };
  }
  if (unconfirmedScope || unconfirmedTarget) {
    const parts: string[] = [];
    if (unconfirmedScope) parts.push("the index Scope Map is empty");
    if (unconfirmedTarget) parts.push("the index Target Map is empty");
    return {
      topic,
      label: "Scope and target consistency",
      state: "warn",
      message: `${parts.join("; ")}, so requirement scope/target registration cannot be confirmed`,
      remediation: "Populate the Scope Map / Target Map in docs/spec/00.index.md so requirement scopes and targets can be verified."
    };
  }
  return {
    topic,
    label: "Scope and target consistency",
    state: "ok",
    message: "every requirement scope and target is registered in the index",
    remediation: "No action needed; requirement scopes and targets are consistent with the index."
  };
}

// @req IR-CLI-051
/**
 * Node version: the running Node major version must meet the supported floor. Below the floor is a
 * fail; an unparseable process.version warns; at or above the floor is ok.
 */
function checkNodeVersion(nodeVersion: string): DoctorCheck {
  const topic = "Node version";
  const floorMajor = 18;
  const major = Number(/^v?(\d+)/.exec(nodeVersion)?.[1]);
  if (!Number.isInteger(major)) {
    return {
      topic,
      label: "Node version",
      state: "warn",
      message: `could not parse the running Node version (${nodeVersion})`,
      remediation: `Verify the Node runtime is version ${floorMajor} or newer.`
    };
  }
  if (major < floorMajor) {
    return {
      topic,
      label: "Node version",
      state: "fail",
      message: `Node ${nodeVersion} is below the supported floor (>= ${floorMajor})`,
      remediation: `Upgrade Node to version ${floorMajor} or newer.`
    };
  }
  return {
    topic,
    label: "Node version",
    state: "ok",
    message: `Node ${nodeVersion} meets the supported floor (>= ${floorMajor})`,
    remediation: "No action needed; the Node runtime is supported."
  };
}

// @req IR-CLI-051
/**
 * IR-CLI-051 — build the consolidated doctor diagnosis. Returns one check per SRS health topic, each
 * with a {ok, warn, fail} state and a non-empty remediation hint. Pure read: no file is written.
 */
export async function diagnoseHealth(
  workspace: ParsedWorkspace,
  options: { nodeVersion?: string } = {}
): Promise<DoctorReport> {
  const nodeVersion = options.nodeVersion ?? process.version;
  const checks: DoctorCheck[] = [
    checkSpecPresence(workspace),
    await checkWorkflowCurrency(workspace.root.root),
    checkRulesDrift(workspace),
    checkActiveTarget(workspace),
    checkScopeTargetConsistency(workspace),
    checkNodeVersion(nodeVersion)
  ];
  return { checks };
}
