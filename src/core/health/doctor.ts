import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { ParsedWorkspace } from "../types.js";
import { splitDiagnostics } from "../diagnostic.js";
import {
  AGENT_INSTRUCTION_END_MARKER,
  AGENT_INSTRUCTION_HEADING_PREFIX,
  AGENT_INSTRUCTION_VERSION,
  BUNDLED_RULES_VERSION,
  BUNDLED_SDS_RULES_FILENAME,
  BUNDLED_SRS_RULES_FILENAME
} from "../bootstrap/templates.js";
import { scanAgentFileRulesReferences } from "../bootstrap/rules-references.js";

// @req IR-CLI-065
// IR-CLI-065 — `speckiwi doctor` consolidated environment health diagnosis.
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

// @req IR-CLI-065
// The agent files the workflow-block currency check inspects (the same pair init upserts).
const AGENT_FILES: readonly string[] = ["CLAUDE.md", "AGENTS.md"];

// @req IR-CLI-065
/** Extracts the leading semver (X.Y.Z or X.Y) token from a string, or undefined when absent. */
function extractVersion(text: string): string | undefined {
  return /\bv?(\d+(?:\.\d+){1,2})\b/.exec(text)?.[1];
}

// @req IR-CLI-065
/** Reads a file as UTF-8, returning undefined when it is absent or unreadable. */
async function readOrUndefined(target: string): Promise<string | undefined> {
  try {
    return await readFile(target, "utf8");
  } catch {
    return undefined;
  }
}

// @req IR-CLI-065
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

// @req IR-CLI-065
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

// @req IR-CLI-065 @req FR-NODE-085
/**
 * Bundled-versus-installed rules version drift: compares this package's bundled SRS-MD rules version
 * against the version the workspace index's Rules link advertises, and confirms the bundled-version
 * rules document exists on disk (FR-NODE-085 AC-8) rather than trusting the index pointer alone.
 * A missing document, a mismatch, or an index that declares no rules version warns; otherwise ok.
 *
 * Every remediation names a plain `speckiwi init`, never the force flag (AC-7): init owns the rules
 * documents and refreshes them in place, while the force flag would overwrite the requirements index
 * and the scope SRS documents from templates.
 */
async function checkRulesDrift(workspace: ParsedWorkspace): Promise<DoctorCheck> {
  const topic = "bundled versus installed rules version drift";
  const label = "Rules version drift";
  const relPath = `docs/rule/${BUNDLED_SRS_RULES_FILENAME}`;
  const remediation = `Run \`speckiwi init\` to refresh the bundled rules document at ${relPath}; it leaves the requirements index and the scope SRS documents untouched.`;
  const rulesMeta = workspace.index.metadata.Rules ?? workspace.index.metadata.rules;
  const installed = typeof rulesMeta === "string" ? extractVersion(rulesMeta) : undefined;
  const present = await stat(path.join(workspace.root.root, "docs", "rule", BUNDLED_SRS_RULES_FILENAME))
    .then((entry) => entry.isFile())
    .catch(() => false);
  if (!present) {
    return {
      topic,
      label,
      state: "warn",
      message: `${relPath} is missing (the bundled rules document is not installed)`,
      remediation
    };
  }
  if (installed === undefined) {
    return {
      topic,
      label,
      state: "warn",
      message: `cannot determine the installed rules version; bundled is v${BUNDLED_RULES_VERSION}`,
      // init refreshes a stale Rules row but never inserts a missing one into the author-owned index,
      // so this remediation asks for the row rather than promising a command that would not add it.
      remediation: `Add a Rules row to docs/spec/00.index.md pointing at ${relPath}.`
    };
  }
  if (installed !== BUNDLED_RULES_VERSION) {
    return {
      topic,
      label,
      state: "warn",
      message: `installed rules v${installed} differs from bundled rules v${BUNDLED_RULES_VERSION}`,
      remediation
    };
  }
  return {
    topic,
    label,
    state: "ok",
    message: `installed rules v${installed} matches bundled rules v${BUNDLED_RULES_VERSION} (${relPath})`,
    remediation: "No action needed; the installed rules document matches the bundled version."
  };
}

// @req IR-CLI-077
/**
 * A rules reference with nothing behind it: an agent instruction file citing a rules document that is
 * not installed under `docs/rule`. The drift check above cannot see this — it reads only the index
 * Rules row — and this is the defect this repository shipped and hand-fixed twice, in CLAUDE.md,
 * AGENTS.md and three skills left pointing at a document a release had pruned.
 *
 * The verdict is presence on disk, so this check reports the current state and nothing more. A citation
 * of a non-bundled document that is still installed does not warn here; the version mismatch is what
 * `checkRulesDrift` above reports. Note that the two states are not both stable: init prunes every
 * non-bundled rules document, and this check warns from that point on.
 *
 * Scope is the managed agent instruction files. Requirement bodies are out of scope for this check
 * because `speckiwi links check` already reports a broken reference in one, with a diagnosis suited to
 * governance content; reporting it here too would give one defect two verdicts.
 */
async function checkRulesReferencePresence(rootPath: string): Promise<DoctorCheck> {
  const topic = "rules document reference presence";
  const label = "Rules reference presence";
  const dangling: string[] = [];
  let bundledMissing = false;
  for (const match of await scanAgentFileRulesReferences(rootPath)) {
    const present = await stat(path.join(rootPath, "docs", "rule", match.document))
      .then((entry) => entry.isFile())
      .catch(() => false);
    if (present) continue;
    dangling.push(`${match.location} -> ${match.document}`);
    if (match.document === BUNDLED_SRS_RULES_FILENAME || match.document === BUNDLED_SDS_RULES_FILENAME) bundledMissing = true;
  }
  if (dangling.length === 0) {
    return {
      topic,
      label,
      state: "ok",
      message: "every rules document referenced by an agent instruction file is installed",
      remediation: "No action needed; every rules reference resolves to an installed document."
    };
  }
  return {
    topic,
    label,
    state: "warn",
    message: `agent instruction files reference rules documents that are not installed: ${dangling.join(", ")}`,
    // Which command clears this depends on which document is missing. When it is a bundled one the
    // reference is already correct and the document simply is not installed, so `upgrade` would rewrite
    // nothing — init is what fixes it. Naming `upgrade` there would describe an action the tool does
    // not take.
    remediation: bundledMissing
      ? `Run \`speckiwi init\` to install the bundled rules documents at docs/rule/${BUNDLED_SRS_RULES_FILENAME} and docs/rule/${BUNDLED_SDS_RULES_FILENAME}.`
      : "Run `speckiwi upgrade` to see the planned repairs, then `speckiwi upgrade --apply` to rewrite each reference to the bundled rules document."
  };
}

// @req FR-NODE-082
/**
 * SDS authoring rules installation: the tdd work-mode snippet cites
 * docs/rule/SDS-MD-Rules-v2.5.0.md, so its absence warns with the init remediation.
 * Existence-only by design — no index coupling and no version-drift tracking.
 */
async function checkSdsRulesPresence(rootPath: string): Promise<DoctorCheck> {
  const topic = "SDS authoring rules installation";
  const relPath = `docs/rule/${BUNDLED_SDS_RULES_FILENAME}`;
  const present = await stat(path.join(rootPath, "docs", "rule", BUNDLED_SDS_RULES_FILENAME))
    .then((entry) => entry.isFile())
    .catch(() => false);
  if (!present) {
    return {
      topic,
      label: "SDS rules installed",
      state: "warn",
      message: `${relPath} is missing (the tdd work-mode SDS rules are not installed)`,
      remediation: "Run `speckiwi init` to install the bundled SDS-MD Authoring Rules document."
    };
  }
  return {
    topic,
    label: "SDS rules installed",
    state: "ok",
    message: `${relPath} is installed`,
    remediation: "No action needed; the SDS authoring rules are installed."
  };
}

// @req FR-NODE-083
/** The bundled codex skills source tree shipped inside this package. */
function bundledCodexSkillsRoot(): string {
  return fileURLToPath(new URL("../../../skills/codex", import.meta.url));
}

function bundledClaudeSkillsRoot(): string {
  return fileURLToPath(new URL("../../../skills/claude", import.meta.url));
}

// @req FR-NODE-083
/** Skill names in a source tree: every direct subdirectory carrying a SKILL.md. */
async function listSkillNames(sourceRoot: string): Promise<string[]> {
  const entries = await readdir(sourceRoot, { withFileTypes: true }).catch(() => []);
  const names: string[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const hasSkill = await stat(path.join(sourceRoot, entry.name, "SKILL.md"))
      .then((skillEntry) => skillEntry.isFile())
      .catch(() => false);
    if (hasSkill) names.push(entry.name);
  }
  return names.sort();
}

// @req FR-NODE-083
/**
 * AC-5 — a workspace-committed exclusions manifest names skills that are intentionally not
 * mirrored (e.g. this repo reserves kiwi-step/kiwi-wave-master as hermeticity leak sentinels,
 * FR-FLOW-029 / committee 2026-07-17 Q7:B). Absent or unparseable manifests fall back to the
 * full source scan so end-user workspaces keep the complete expectation.
 */
async function readMirrorExclusions(mirrorRoot: string): Promise<Set<string>> {
  const raw = await readOrUndefined(path.join(mirrorRoot, ".speckiwi-mirror-exclusions.json"));
  if (raw === undefined) return new Set();
  try {
    const parsed = JSON.parse(raw) as { excluded?: unknown };
    if (!Array.isArray(parsed.excluded)) return new Set();
    return new Set(parsed.excluded.filter((name): name is string => typeof name === "string"));
  } catch {
    return new Set();
  }
}

// @req FR-NODE-083
/**
 * Codex skills mirror drift: compares the bundled skills/codex source tree against the workspace
 * .agents/skills install mirror. The expected set is derived by scanning the source tree (never a
 * hardcoded list) minus the workspace mirror-exclusions manifest (AC-5); a workspace without a
 * mirror is ok (not provisioned is not drift). A skill that is missing from the mirror or whose
 * SKILL.md content diverges from the source warns.
 */
async function checkCodexSkillsMirror(rootPath: string, sourceRoot?: string): Promise<DoctorCheck> {
  const topic = "codex skills mirror drift";
  const label = "Codex skills mirror";
  const mirrorRoot = path.join(rootPath, ".agents", "skills");
  const mirrorExists = await stat(mirrorRoot).then((entry) => entry.isDirectory()).catch(() => false);
  if (!mirrorExists) {
    return {
      topic,
      label,
      state: "ok",
      message: "no .agents/skills mirror is provisioned in this workspace",
      remediation: "No action needed; provision codex skills with `speckiwi init --install-skills` when wanted."
    };
  }
  const source = sourceRoot ?? bundledCodexSkillsRoot();
  const exclusions = await readMirrorExclusions(mirrorRoot);
  const expected = (await listSkillNames(source)).filter((name) => !exclusions.has(name));
  const missing: string[] = [];
  const diverged: string[] = [];
  // Line endings are transport noise, not drift — normalize before comparing.
  const normalizeEol = (text: string): string => text.replace(/\r\n/g, "\n");
  for (const name of expected) {
    const mirrorSkill = await readOrUndefined(path.join(mirrorRoot, name, "SKILL.md"));
    if (mirrorSkill === undefined) {
      missing.push(name);
      continue;
    }
    const sourceSkill = await readOrUndefined(path.join(source, name, "SKILL.md"));
    if (sourceSkill !== undefined && normalizeEol(sourceSkill) !== normalizeEol(mirrorSkill)) diverged.push(name);
  }
  if (missing.length > 0 || diverged.length > 0) {
    const parts = [
      ...(missing.length > 0 ? [`missing from the mirror: ${missing.join(", ")}`] : []),
      ...(diverged.length > 0 ? [`diverged from the source: ${diverged.join(", ")}`] : [])
    ];
    return {
      topic,
      label,
      state: "warn",
      message: `.agents/skills drifted from the bundled codex skills — ${parts.join("; ")}`,
      remediation: "Run `speckiwi skills install codex all` to regenerate the mirror, then review the diff."
    };
  }
  return {
    topic,
    label,
    state: "ok",
    message: `.agents/skills matches the bundled codex skills (${expected.length} skills${exclusions.size > 0 ? `; ${exclusions.size} excluded by manifest` : ""})`,
    remediation: "No action needed; the codex skills mirror is in sync."
  };
}

// @req IR-CLI-080
/**
 * An installed skill destination: where a copy lives, which bundled tree it came from, and how a
 * reader refreshes it. The codex project mirror is deliberately absent — checkCodexSkillsMirror owns
 * that one, and reporting it twice would double-count one drift.
 */
interface InstalledSkillLocation {
  label: string;
  destinationRoot: string;
  sourceRoot: string;
  refresh: string;
}

// @req IR-CLI-080
/** Line endings are transport noise, not drift. */
function normalizeEol(text: string): string {
  return text.replace(/\r\n/g, "\n");
}

// @req IR-CLI-080
/** Every file under a skill source's `_shared/kiwi`, as names relative to that directory. */
async function listSharedContractNames(sourceRoot: string): Promise<string[]> {
  const sharedRoot = path.join(sourceRoot, "_shared", "kiwi");
  const entries = await readdir(sharedRoot, { withFileTypes: true }).catch(() => []);
  return entries.filter((entry) => entry.isFile()).map((entry) => entry.name).sort();
}

// @req IR-CLI-080
/**
 * IR-CLI-080 — drift between the bundled skills and the copies an agent actually loads.
 *
 * The motivating measurement: every other check reported ok while the globally installed
 * kiwi-wave-master was 404 lines behind the bundled one, missing the run-root preflight gate a
 * verified requirement had shipped. An agent reads the installed copy, so that is what has to be
 * compared.
 *
 * The home directory is injected rather than read from the environment. A project's doctor reporting
 * on the developer's own home would be both non-deterministic and none of its business; the caller
 * that wants the real home passes it.
 *
 * A destination that does not exist is not drift. Most projects install for one agent, or none.
 */
async function checkInstalledSkillDrift(
  rootPath: string,
  options: { homeDir?: string; claudeSourceRoot?: string; codexSourceRoot?: string }
): Promise<DoctorCheck> {
  const topic = "installed skill drift";
  const label = "Installed skill drift";
  const claudeSource = options.claudeSourceRoot ?? bundledClaudeSkillsRoot();
  const codexSource = options.codexSourceRoot ?? bundledCodexSkillsRoot();
  const homeDir = options.homeDir;

  const candidates: InstalledSkillLocation[] = [
    {
      label: "project .claude/skills",
      destinationRoot: path.join(rootPath, ".claude", "skills"),
      sourceRoot: claudeSource,
      refresh: "`speckiwi init`"
    },
    ...(homeDir
      ? [
          {
            label: "global .claude/skills",
            destinationRoot: path.join(homeDir, ".claude", "skills"),
            sourceRoot: claudeSource,
            refresh: "`speckiwi init --global`"
          },
          {
            label: "global codex skills",
            destinationRoot: path.join(homeDir, ".codex", "skills"),
            sourceRoot: codexSource,
            refresh: "`speckiwi init --global`"
          }
        ]
      : [])
  ];

  const present: InstalledSkillLocation[] = [];
  for (const candidate of candidates) {
    if (await stat(candidate.destinationRoot).then((entry) => entry.isDirectory()).catch(() => false)) {
      present.push(candidate);
    }
  }
  if (present.length === 0) {
    return {
      topic,
      label,
      state: "ok",
      message: "no installed skill location is provisioned for this project or agent home",
      remediation: "No action needed; install the bundled kiwi skills with `speckiwi init` when wanted."
    };
  }

  const findings: string[] = [];
  const refreshes = new Set<string>();
  for (const location of present) {
    const missing: string[] = [];
    const diverged: string[] = [];
    // An installed skill's entrypoint is always SKILL.md; the claude source spells it skill.md.
    for (const name of await listSkillNames(location.sourceRoot)) {
      const installed = await readOrUndefined(path.join(location.destinationRoot, name, "SKILL.md"));
      if (installed === undefined) {
        missing.push(name);
        continue;
      }
      const source =
        (await readOrUndefined(path.join(location.sourceRoot, name, "SKILL.md"))) ??
        (await readOrUndefined(path.join(location.sourceRoot, name, "skill.md")));
      if (source !== undefined && normalizeEol(source) !== normalizeEol(installed)) diverged.push(name);
    }
    // A stale shared contract changes every skill that cites it, without changing any skill body.
    for (const name of await listSharedContractNames(location.sourceRoot)) {
      const relative = `_shared/kiwi/${name}`;
      const installed = await readOrUndefined(path.join(location.destinationRoot, "_shared", "kiwi", name));
      if (installed === undefined) {
        missing.push(relative);
        continue;
      }
      const source = await readOrUndefined(path.join(location.sourceRoot, "_shared", "kiwi", name));
      if (source !== undefined && normalizeEol(source) !== normalizeEol(installed)) diverged.push(relative);
    }
    if (missing.length === 0 && diverged.length === 0) continue;
    const parts = [
      ...(missing.length > 0 ? [`missing: ${missing.join(", ")}`] : []),
      ...(diverged.length > 0 ? [`diverged: ${diverged.join(", ")}`] : [])
    ];
    findings.push(`${location.label} — ${parts.join("; ")}`);
    refreshes.add(location.refresh);
  }

  const scope = `${present.length} installed location${present.length === 1 ? "" : "s"}`;
  if (findings.length > 0) {
    return {
      topic,
      label,
      state: "warn",
      message: `installed skills drifted from the bundled source (${scope} compared) — ${findings.join(" | ")}`,
      remediation: `Run ${[...refreshes].join(" and ")} to reinstall the drifted skills, then review the diff.`
    };
  }
  return {
    topic,
    label,
    state: "ok",
    message: `every installed skill matches the bundled source (${scope} compared)`,
    remediation: "No action needed; the installed skills are in sync with the bundled source."
  };
}

// @req IR-CLI-065
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

// @req IR-CLI-065
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

// @req IR-CLI-065
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

// @req IR-CLI-065
/**
 * IR-CLI-065 — build the consolidated doctor diagnosis. Returns one check per SRS health topic, each
 * with a {ok, warn, fail} state and a non-empty remediation hint. Pure read: no file is written.
 */
export async function diagnoseHealth(
  workspace: ParsedWorkspace,
  options: {
    nodeVersion?: string;
    codexSkillsSourceRoot?: string;
    claudeSkillsSourceRoot?: string;
    /** IR-CLI-080 — the home whose global skill installs are compared. Absent means global is skipped. */
    installedSkillsHomeDir?: string;
  } = {}
): Promise<DoctorReport> {
  const nodeVersion = options.nodeVersion ?? process.version;
  const checks: DoctorCheck[] = [
    checkSpecPresence(workspace),
    await checkWorkflowCurrency(workspace.root.root),
    await checkRulesDrift(workspace),
    // IR-CLI-077 — a reference the drift check cannot see, because it reads only the index pointer.
    await checkRulesReferencePresence(workspace.root.root),
    // FR-NODE-082 / FR-NODE-083 — SDS rules installation + codex skills mirror drift.
    await checkSdsRulesPresence(workspace.root.root),
    await checkCodexSkillsMirror(workspace.root.root, options.codexSkillsSourceRoot),
    // IR-CLI-080 — the mirror check above covers the project's codex mirror; this one covers the copies
    // an agent loads, which is where a shipped fix can be silently absent.
    await checkInstalledSkillDrift(workspace.root.root, {
      ...(options.installedSkillsHomeDir ? { homeDir: options.installedSkillsHomeDir } : {}),
      ...(options.claudeSkillsSourceRoot ? { claudeSourceRoot: options.claudeSkillsSourceRoot } : {}),
      ...(options.codexSkillsSourceRoot ? { codexSourceRoot: options.codexSkillsSourceRoot } : {})
    }),
    checkActiveTarget(workspace),
    checkScopeTargetConsistency(workspace),
    checkNodeVersion(nodeVersion)
  ];
  return { checks };
}
