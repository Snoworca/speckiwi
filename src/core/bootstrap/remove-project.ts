import { lstat, readFile, realpath, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { MutationResult, ProjectRoot } from "../types.js";
import { mutationFail, mutationOk } from "../mutation/guards.js";
import { withSrsMutationLock } from "../mutation/srs-lock.js";
import {
  removeManagedKiwiSkills,
  resolveSkillDestinationRoot,
  resolveSkillSourceRoot,
  type SkillKeepReason
} from "../skills/install-skill.js";
import type { SkillAgent } from "../skills/types.js";
import { unregisterSpeckiwiMcp } from "./mcp-registration.js";
import {
  GIT_PRE_COMMIT_RUNNER,
  SKILL_PROVISION_AGENTS,
  TRACE_HOOK_RUNNER,
  findAgentInstructionBlock,
  isAgentHomePresent,
  loadBundledHookRunner,
  renderClaudeSettings,
  renderCodexHooks,
  renderGitPreCommitHook,
  resolveGlobalSkillContext,
  type AgentFileMode
} from "./init-project.js";

// @req FR-NODE-191 / FR-NODE-192
//
// `init` writes eight kinds of thing, and only one of them — the skill directories — carries a record
// of who wrote it. The rest are written with `writeIfMissing`, so their existence proves nothing: a
// `.claude/settings.json` on disk may be entirely the operator's, with init having skipped it. That is
// why nothing here deletes a file because of where it sits. Each entry is undone by the narrowest edit
// that undoes it, and every edit is preceded by a proof — a metadata record, a JSON key, a marker pair,
// or a byte-for-byte comparison against what the installer renders.
//
// Three locations are refused outright rather than defaulted off, and there is no flag that opens them.
// A flag that deletes requirements is eventually recommended by some document or agent; that is how
// `init --force` came to be run against a real project, and the resulting loss was symptomless.

export type RemoveScope = "project" | "global";

export interface RemoveProjectInput {
  /** Perform the removals. Absent or false plans and writes nothing. */
  apply?: boolean;
  /** `project` undoes this project's wiring; `global` undoes only the agents' global skills. */
  scope?: RemoveScope;
  ignoreLock?: boolean;
  /** Test/DI seams, matching init's, so a run can be made hermetic. */
  globalHomeDir?: string;
  globalCodexHome?: string;
  skillSourceBaseDir?: string;
}

/** A path left in place because ownership could not be proved. */
export interface KeptPath {
  path: string;
  reason: SkillKeepReason;
  detail?: string;
}

/** A path this command refuses to touch, with the policy that refuses it. */
export interface ExcludedPath {
  path: string;
  reason: string;
}

export interface RemoveProjectOutput {
  /** False for a plan: everything below describes an intention. */
  applied: boolean;
  /** The root this run decided it was operating on. Reported first so a caller can check it. */
  root: string;
  scope: RemoveScope;
  removed: string[];
  kept: KeptPath[];
  excluded: ExcludedPath[];
  /**
   * False when anything was kept. A caller branching on `ok` alone would read a partial removal as a
   * finished one, and the next thing they do is uninstall the package that could have finished it.
   */
  complete: boolean;
  warnings: string[];
  notes: string[];
}

/** What is refused, and why, stated in the report rather than left to be discovered. */
const EXCLUSIONS: ReadonlyArray<readonly [relativePath: string, reason: string]> = [
  ["docs/spec", "requirements are what you wrote with the tool, not what the tool wrote; no option removes them"],
  ["docs/rule", "the index metadata Rules row cites these documents, so removing them would leave that reference dangling"],
  ["docs/.kiwi/trace", "accumulated hook output with no second copy; speckiwi installs no ignore rule, so it cannot tell whether you track it"]
];

const NPM_NOTE =
  "The speckiwi program itself is installed by npm and is not removed by this command — run `npm uninstall -g speckiwi` to remove it.";

export async function removeProject(root: ProjectRoot, input: RemoveProjectInput): Promise<MutationResult<RemoveProjectOutput>> {
  const apply = input.apply === true;
  // The lock guards this project's workspace against a concurrent init. A global-scope run touches no
  // file under the project, so taking it would write a lock and a status file into a workspace the
  // caller explicitly asked not to touch — measured: `remove -g` created `<root>/kiwi/.status.json`.
  // Global skill directories are outside every project's lock anyway; `init --global` does not hold
  // one over them either.
  if ((input.scope ?? "project") === "global") return removeUnlocked(root, input, apply);
  return withSrsMutationLock(root, { operation: "remove_project", ignoreLock: input.ignoreLock, dryRun: !apply }, () =>
    removeUnlocked(root, input, apply)
  );
}

async function removeUnlocked(root: ProjectRoot, input: RemoveProjectInput, apply: boolean): Promise<MutationResult<RemoveProjectOutput>> {
  const scope: RemoveScope = input.scope ?? "project";
  const state: RemoveProjectOutput = {
    applied: apply,
    root: root.root,
    scope,
    removed: [],
    kept: [],
    excluded: [],
    complete: true,
    warnings: [],
    notes: [NPM_NOTE]
  };

  // @req FR-NODE-192 AC-1 — before anything else. The root resolver stops at the first `.git` or
  // `docs/spec/00.index.md` above the cwd and never asks whether that directory is the project the
  // caller meant. A home directory holding an index and no `.git` therefore resolves to itself, and
  // `<root>/.claude/skills` is then literally the global skill directory — so a project-scope run
  // would delete global state, including the operator's own skills, without `-g` ever being typed.
  if (scope === "project") {
    const collision = await findGlobalDestinationCollision(root.root, input);
    if (collision) {
      return mutationFail(
        "REMOVE_ROOT_IS_GLOBAL_HOME",
        `the resolved project root ${root.root} puts this project's ${collision.agent} skills at ${collision.destination}, which is also that agent's global skill directory; ` +
          "refusing a project-scope removal that would delete global state. Pass an explicit --root, or ask for global scope if that is what you meant."
      );
    }
  }

  // Every step runs inside `step`, which turns a thrown filesystem error into a kept path plus a
  // warning. A step that escaped would abort the whole call AFTER the destructive steps before it had
  // already run — measured: a read-only `.claude/settings.json` aborted the run once 34 skill
  // directories and the MCP key were already gone, and the caller got an error envelope with no
  // `removed` and, worse, no `kept`. That list is the one thing telling them what still needs doing
  // by hand, so losing it is the expensive half of the failure.
  const step = async (label: string, target: string, run: () => Promise<void>): Promise<void> => {
    try {
      await run();
    } catch (error) {
      state.kept.push({ path: target, reason: "error", detail: `${label} failed: ${(error as Error).message}` });
      state.warnings.push(`${label}: ${(error as Error).message}`);
    }
  };

  if (scope === "global") {
    await step("global skills", root.root, () => removeGlobalSkills(root.root, input, apply, state));
    // The refusals are project-relative, so at global scope there is nothing to list rather than an
    // empty list meaning "nothing is protected".
    state.notes.push("Global scope touches only the agents' skill directories; this project's requirements and wiring are untouched.");
  } else {
    await step("project skills", root.root, () => removeProjectSkills(root.root, input, apply, state));
    await step("mcp registration", path.join(root.root, ".mcp.json"), () => removeMcpRegistration(root.root, apply, state));
    await step("agent hook entries", path.join(root.root, ".claude"), () => removeAgentHookEntries(root.root, apply, state));
    await step("git hook", path.join(root.root, ".git", "hooks", "pre-commit"), () => removeGitHook(root.root, apply, state));
    await step("hook runners", path.join(root.root, "docs", ".kiwi", "hooks"), () => removeHookRunners(root.root, apply, state));
    await step("agent instruction blocks", root.root, () => removeAgentInstructionBlocks(root.root, apply, state));
    for (const [relativePath, reason] of EXCLUSIONS) {
      state.excluded.push({ path: path.join(root.root, ...relativePath.split("/")), reason });
    }
    await step("global leftover probe", root.root, () => reportGlobalLeftovers(root.root, input, state));
  }

  state.complete = state.kept.length === 0;
  return mutationOk(state);
}

/**
 * The agent whose project skill destination is also its global one, if any.
 *
 * Both sides come from the installer's own resolver, so this asks the question in exactly the terms the
 * installer answers it — a second opinion about where a global install lands is how IR-CLI-086's three
 * entry points came to disagree.
 */
async function findGlobalDestinationCollision(
  rootPath: string,
  input: RemoveProjectInput
): Promise<{ agent: SkillAgent; destination: string } | undefined> {
  const context = resolveGlobalSkillContext(input);
  if (!context.homeDir) return undefined;
  for (const agent of SKILL_PROVISION_AGENTS) {
    const projectDestination = await resolveSkillDestinationRoot({ projectRoot: { root: rootPath }, agent, selector: "all", scope: "project" });
    const globalDestination = await resolveSkillDestinationRoot({
      projectRoot: { root: rootPath },
      agent,
      selector: "all",
      scope: "global",
      homeDir: context.homeDir,
      ...(context.codexHome ? { env: { CODEX_HOME: context.codexHome } } : {})
    });
    if ((await canonicalPath(projectDestination)) === (await canonicalPath(globalDestination))) {
      return { agent, destination: globalDestination };
    }
  }
  return undefined;
}

/**
 * A path reduced to the form two spellings of the same location share.
 *
 * `path.resolve` alone is not enough here, and the asymmetry is silent: the project root arrives
 * already realpath'd (`resolveProjectRoot` calls it), while the home directory does not — it is the
 * raw `HOME`/`USERPROFILE`/seam value. A home reached through a junction, a symlink, or a redirected
 * folder therefore produces two different strings for one directory, the equality below never holds,
 * and the guard waves through exactly the run it exists to stop. Measured on a junction fixture: the
 * managed global skills were deleted by a project-scope call.
 *
 * A destination that does not exist yet cannot be realpath'd, so this resolves the nearest ancestor
 * that does and reattaches the rest — the links are always in the ancestors.
 */
async function canonicalPath(target: string): Promise<string> {
  let current = path.resolve(target);
  const trailing: string[] = [];
  for (;;) {
    const resolved = await realpath(current).catch(() => undefined);
    if (resolved !== undefined) return path.join(resolved, ...trailing.reverse());
    const parent = path.dirname(current);
    if (parent === current) return path.resolve(target);
    trailing.push(path.basename(current));
    current = parent;
  }
}

async function removeProjectSkills(rootPath: string, input: RemoveProjectInput, apply: boolean, state: RemoveProjectOutput): Promise<void> {
  for (const agent of SKILL_PROVISION_AGENTS) {
    const destinationRoot = await resolveSkillDestinationRoot({ projectRoot: { root: rootPath }, agent, selector: "all", scope: "project" });
    await removeSkillsAt(destinationRoot, agent, apply, state, await bundledSourceRoot(rootPath, agent, input));
  }
}

async function removeGlobalSkills(rootPath: string, input: RemoveProjectInput, apply: boolean, state: RemoveProjectOutput): Promise<void> {
  const context = resolveGlobalSkillContext(input);
  if (!context.homeDir) {
    state.warnings.push("home directory is unavailable — no global skill destination could be resolved");
    return;
  }
  for (const agent of SKILL_PROVISION_AGENTS) {
    if (!(await isAgentHomePresent(agent, context))) {
      state.warnings.push(`skills(${agent}) global: ${agent} home directory not found — skipped`);
      continue;
    }
    const destinationRoot = await resolveSkillDestinationRoot({
      projectRoot: { root: rootPath },
      agent,
      selector: "all",
      scope: "global",
      homeDir: context.homeDir,
      ...(context.codexHome ? { env: { CODEX_HOME: context.codexHome } } : {})
    });
    await removeSkillsAt(destinationRoot, agent, apply, state, await bundledSourceRoot(rootPath, agent, input));
  }
}

/**
 * The bundled skill source for an agent, or undefined when it cannot be located.
 *
 * Only the mirror reconciliation needs it, and only for the exclusion branch; a package installed
 * without its skills still removes everything else, which is why this degrades to undefined rather
 * than failing the run.
 */
async function bundledSourceRoot(rootPath: string, agent: SkillAgent, input: RemoveProjectInput): Promise<string | undefined> {
  return resolveSkillSourceRoot({
    projectRoot: { root: rootPath },
    agent,
    selector: "all",
    scope: "project",
    ...(input.skillSourceBaseDir ? { sourceBaseDir: input.skillSourceBaseDir } : {})
  }).catch(() => undefined);
}

/**
 * Names the managed skills a project-scope run leaves at the global destinations.
 *
 * @req FR-NODE-192 / IR-CLI-096 AC-8 — without this the operator clears the project roots, sees an
 * unchanged skill list because the agent still loads the global copies, and concludes the command did
 * nothing. The probe runs the real verdict in dry-run, so it counts what `-g` would actually remove
 * rather than every `kiwi-*` directory it can see.
 */
async function reportGlobalLeftovers(rootPath: string, input: RemoveProjectInput, state: RemoveProjectOutput): Promise<void> {
  const context = resolveGlobalSkillContext(input);
  if (!context.homeDir) return;
  for (const agent of SKILL_PROVISION_AGENTS) {
    if (!(await isAgentHomePresent(agent, context))) continue;
    const destinationRoot = await resolveSkillDestinationRoot({
      projectRoot: { root: rootPath },
      agent,
      selector: "all",
      scope: "global",
      homeDir: context.homeDir,
      ...(context.codexHome ? { env: { CODEX_HOME: context.codexHome } } : {})
    });
    const probe = await removeManagedKiwiSkills({ destinationRoot, agent, keepNames: [], dryRun: true });
    if (probe.removed.length === 0) continue;
    state.notes.push(
      `${probe.removed.length} managed kiwi skill(s) remain at ${destinationRoot} — this run removed only this project's. Run \`speckiwi remove --global --apply\` to remove those.`
    );
  }
}

async function removeSkillsAt(
  destinationRoot: string,
  agent: SkillAgent,
  apply: boolean,
  state: RemoveProjectOutput,
  sourceRoot: string | undefined
): Promise<void> {
  // An empty keep set: every managed mirror is a candidate. Everything else about the verdict — the
  // metadata, the identity fields, the checksum, the symlink refusal — is the installer's, unchanged.
  const outcome = await removeManagedKiwiSkills({
    destinationRoot,
    agent,
    keepNames: [],
    dryRun: !apply,
    reconcileSharedMirror: true,
    ...(sourceRoot ? { sourceRoot } : {})
  });
  state.removed.push(...outcome.removed);
  state.kept.push(...outcome.kept);
}

async function removeMcpRegistration(rootPath: string, apply: boolean, state: RemoveProjectOutput): Promise<void> {
  const result = await unregisterSpeckiwiMcp(rootPath, { dryRun: !apply });
  if (result.status === "removed") state.removed.push(`${result.filePath}#mcpServers.speckiwi`);
  if (result.status === "unreadable") {
    state.kept.push({
      path: result.filePath,
      reason: "error",
      detail: "not readable as a JSON object with an mcpServers map; left untouched rather than rewritten"
    });
  }
}

/** Reads and parses a JSON file, or undefined when it is absent or not parseable. */
async function readJsonFile(filePath: string): Promise<{ parsed: unknown; text: string } | undefined> {
  const text = await readFile(filePath, "utf8").catch(() => undefined);
  if (text === undefined) return undefined;
  try {
    return { parsed: JSON.parse(text), text };
  } catch {
    return undefined;
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Whether a value mentions the trace runner anywhere inside it — the token that marks our hook entry. */
function invokesTraceRunner(value: unknown): boolean {
  if (typeof value === "string") return value.includes(TRACE_HOOK_RUNNER);
  if (Array.isArray(value)) return value.some(invokesTraceRunner);
  if (isPlainObject(value)) return Object.values(value).some(invokesTraceRunner);
  return false;
}

/**
 * Strips the speckiwi entries from an agent hook configuration, pruning containers that become empty.
 *
 * Returns the reduced configuration, or undefined when nothing is left — which is the only condition
 * under which the caller deletes the file.
 */
function stripHookEntries(config: Record<string, unknown>): Record<string, unknown> | undefined {
  const hooks = config.hooks;
  if (!isPlainObject(hooks)) return config;
  const remainingEvents: Record<string, unknown> = {};
  for (const [event, entries] of Object.entries(hooks)) {
    if (!Array.isArray(entries)) {
      remainingEvents[event] = entries;
      continue;
    }
    const kept = entries
      .map((entry) => pruneHookEntry(entry))
      .filter((entry): entry is unknown => entry !== undefined);
    // An event we emptied is dropped; one that arrived empty is left alone. Otherwise removal quietly
    // deletes an `"Empty": []` the operator put there, which is not ours to tidy.
    if (kept.length > 0 || entries.length === 0) remainingEvents[event] = kept;
  }
  const rest = Object.fromEntries(Object.entries(config).filter(([key]) => key !== "hooks"));
  if (Object.keys(remainingEvents).length > 0) return { ...rest, hooks: remainingEvents };
  return Object.keys(rest).length > 0 ? rest : undefined;
}

/**
 * One entry of a hook event array, with our commands removed.
 *
 * Claude nests the commands one level deeper (`{matcher, hooks: [...]}`) than Codex (`{match, command}`),
 * so the inner list is pruned first and the entry is dropped only when that empties it. Dropping the
 * whole entry on any mention would take an operator's command that happens to sit in the same matcher
 * group as ours.
 */
function pruneHookEntry(entry: unknown): unknown | undefined {
  if (!isPlainObject(entry)) return invokesTraceRunner(entry) ? undefined : entry;
  if (Array.isArray(entry.hooks)) {
    const inner = entry.hooks.filter((hook) => !invokesTraceRunner(hook));
    if (inner.length === 0) return undefined;
    return { ...entry, hooks: inner };
  }
  return invokesTraceRunner(entry) ? undefined : entry;
}

async function removeAgentHookEntries(rootPath: string, apply: boolean, state: RemoveProjectOutput): Promise<void> {
  const targets: ReadonlyArray<readonly [filePath: string, rendered: string]> = [
    [path.join(rootPath, ".claude", "settings.json"), renderClaudeSettings()],
    [path.join(rootPath, ".codex", "hooks.json"), renderCodexHooks()]
  ];
  for (const [filePath] of targets) {
    const file = await readJsonFile(filePath);
    if (file === undefined) {
      // Absent is nothing to do; unparseable is not ours to rewrite.
      if (await pathExists(filePath)) {
        state.kept.push({ path: filePath, reason: "error", detail: "not parseable as JSON; left untouched rather than rewritten" });
      }
      continue;
    }
    if (!isPlainObject(file.parsed) || !invokesTraceRunner(file.parsed)) continue;
    const reduced = stripHookEntries(file.parsed);
    if (reduced === undefined) {
      if (apply) await rm(filePath, { force: true });
      state.removed.push(filePath);
      continue;
    }
    // A shape the pruning does not understand — `hooks` as an array, an event whose value is an
    // object — comes back unchanged. Reporting that as a removal is the worst of both: the file is
    // rewritten for nothing and the caller is told the wiring is gone while the hook still fires on
    // every edit. Say what is true instead.
    if (invokesTraceRunner(reduced)) {
      state.kept.push({
        path: filePath,
        reason: "foreign-metadata",
        detail: "the speckiwi hook entry is in a shape this command does not recognise; remove it by hand."
      });
      continue;
    }
    if (apply) await writeFile(filePath, `${JSON.stringify(reduced, null, 2)}\n`, "utf8");
    state.removed.push(`${filePath}#hooks.speckiwi`);
  }
}

async function pathExists(target: string): Promise<boolean> {
  return lstat(target).then(() => true).catch(() => false);
}

/**
 * Removes a file only when its bytes equal what the installer renders.
 *
 * This is the ownership proof for everything that carries no marker. `init` skips an existing file
 * whenever it merely *contains* the runner path, so a marker-bearing hook can be entirely the
 * operator's with our delegation line added among their own — a marker test would delete it.
 */
async function removeIfRendered(filePath: string, rendered: string, apply: boolean, state: RemoveProjectOutput): Promise<void> {
  const existing = await readFile(filePath, "utf8").catch(() => undefined);
  if (existing === undefined) return;
  if (existing !== rendered) {
    // A CRLF checkout differs from the rendered LF text in every line ending and nothing else, and
    // telling that operator they "edited it after install" is both wrong and unactionable. Naming the
    // line endings costs one comparison and turns the message into something they can act on.
    const onlyLineEndings = existing.split("\r\n").join("\n") === rendered.split("\r\n").join("\n");
    state.kept.push({
      path: filePath,
      reason: "locally-modified",
      detail: onlyLineEndings
        ? "identical to what speckiwi installs except for line endings (CRLF vs LF); kept rather than assumed ours — delete it by hand if you want it gone"
        : "contents differ from what speckiwi installs; edited after install"
    });
    return;
  }
  if (apply) await rm(filePath, { force: true });
  state.removed.push(filePath);
}

async function removeGitHook(rootPath: string, apply: boolean, state: RemoveProjectOutput): Promise<void> {
  const hookPath = path.join(rootPath, ".git", "hooks", "pre-commit");
  const existing = await readFile(hookPath, "utf8").catch(() => undefined);
  if (existing === undefined) return;
  // Not ours at all: no delegation line, so init never wrote it and never claimed it.
  if (!existing.includes(GIT_PRE_COMMIT_RUNNER)) return;
  await removeIfRendered(hookPath, renderGitPreCommitHook(), apply, state);
}

async function removeHookRunners(rootPath: string, apply: boolean, state: RemoveProjectOutput): Promise<void> {
  const hooksDir = path.join(rootPath, "docs", ".kiwi", "hooks");
  for (const runner of ["pre-commit.mjs", "trace.mjs"] as const) {
    const bundled = await loadBundledHookRunner(runner);
    if (bundled === undefined) continue; // Nothing to compare against; never guess.
    await removeIfRendered(path.join(hooksDir, runner), bundled, apply, state);
  }
}

const AGENT_FILES: readonly AgentFileMode[] = ["AGENTS.md", "CLAUDE.md"];

async function removeAgentInstructionBlocks(rootPath: string, apply: boolean, state: RemoveProjectOutput): Promise<void> {
  for (const agentFile of AGENT_FILES) {
    const filePath = path.join(rootPath, agentFile);
    let existing = await readFile(filePath, "utf8").catch(() => undefined);
    if (existing === undefined) continue;
    // Loop, because a file can hold more than one managed block — an older heading beside the current
    // one, or a block pasted twice. Removing the first and reporting success left the file still
    // instructing agents to follow the workflow of a tool that had just been removed.
    let removedAny = false;
    for (;;) {
      const block = findAgentInstructionBlock(existing);
      if (!block) break;
      // @req FR-NODE-191 AC-5 — the marker pair is what makes the block's extent a fact rather than a
      // guess. The legacy finder infers the end as "the next top-level heading, or EOF"; init replaces
      // that span so a wrong inference is repaired on the spot, but a removal would delete to EOF and
      // take the operator's prose with it.
      if (!block.hasEndMarker) {
        state.kept.push({
          path: filePath,
          reason: "foreign-metadata",
          detail: "the managed block has no end marker, so its extent cannot be established; remove it by hand"
        });
        break;
      }
      existing = `${existing.slice(0, block.start).trimEnd()}\n${existing.slice(block.end).trimStart()}`;
      removedAny = true;
    }
    if (!removedAny) continue;
    if (existing.trim() === "") {
      if (apply) await rm(filePath, { force: true });
      state.removed.push(filePath);
      continue;
    }
    if (apply) await writeFile(filePath, existing, "utf8");
    state.removed.push(`${filePath}#speckiwi-workflow-block`);
  }
}
