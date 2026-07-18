import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import type { MutationResult, ProjectRoot } from "../types.js";
import { mutationOk } from "../mutation/guards.js";
import { withSrsMutationLock } from "../mutation/srs-lock.js";
import {
  AGENT_INSTRUCTION_END_MARKER,
  AGENT_INSTRUCTION_VERSION,
  loadBundledRulesDocument,
  loadBundledSdsRulesDocument,
  parseScopeOption,
  renderAgentInstructionSnippet,
  renderAppendixTemplate,
  renderEmptyScopeTemplate,
  renderIndexTemplate
} from "./templates.js";
import { installSkill, planSkillInstall, pruneOrphanKiwiSkills } from "../skills/install-skill.js";
import type { SkillAgent, SkillInstallPlan } from "../skills/types.js";
import { registerSpeckiwiMcp } from "./mcp-registration.js";

export type AgentFileMode = "AGENTS.md" | "CLAUDE.md";

const REQUIRED_AGENT_FILES: readonly AgentFileMode[] = ["AGENTS.md", "CLAUDE.md"];

// FR-NODE-068 — init provisions the bundled kiwi skills for the fixed Claude + Codex agent pair,
// matching init's existing dual AGENTS.md/CLAUDE.md + dual-hook policy.
const SKILL_PROVISION_AGENTS: readonly SkillAgent[] = ["claude", "codex"];

export interface InitProjectInput {
  product?: string;
  target?: string;
  scope?: string;
  force?: boolean;
  ignoreLock?: boolean;
  skipLock?: boolean;
  // FR-NODE-067/068/070 — onboarding steps. These default OFF so the MCP `init_project` tool (which
  // never sets them) is unaffected; the CLI init path enables them (opt-out via --no-mcp/--no-skills).
  registerMcp?: boolean;
  installSkills?: boolean;
  // FR-NODE-084 — when set (CLI --global/-g), init also provisions skills into each present agent's global skills dir.
  installSkillsGlobal?: boolean;
  dryRun?: boolean;
  /** Test/DI seam — overrides the bundled skills source root used by skill provisioning. */
  skillSourceBaseDir?: string;
  /** Test/DI seam — overrides the home dir used to resolve global skill destinations (default: process.env HOME/USERPROFILE). */
  globalHomeDir?: string;
  /** Test/DI seam — overrides CODEX_HOME for the codex global destination (default: process.env.CODEX_HOME). */
  globalCodexHome?: string;
}

export interface InitProjectOutput {
  created: string[];
  skipped: string[];
  updated: string[];
  removed: string[];
  warnings?: string[];
}

interface AgentInstructionBlock {
  start: number;
  end: number;
  version?: string;
  hasEndMarker: boolean;
}

const VERSIONED_AGENT_HEADING_PATTERN = /^# SpecKiwi SRS 워크플로 v(?<version>[0-9]+(?:\.[0-9]+)*)$/gm;
const LEGACY_AGENT_HEADING_PATTERN = /^# SpecKiwi SRS workflow$/m;

// FND-001 / FR-NODE-050 — scaffold docs/spec/steps/state.md at the reader SSOT
// path with a parseable `Mode: wait` metadata block above an empty FR-PARSE-026
// step-state table, so getWorkMode/setWorkMode operate on a fresh repo instead of
// failing-open to wait and erroring NOT_FOUND on the first setWorkMode.
function renderStepStateTemplate(): string {
  return [
    "# Step State",
    "",
    "Mode: wait",
    "",
    "| Step | Status | DependsOn | TouchesScope | TouchesReq | Created | Updated |",
    "| --- | --- | --- | --- | --- | --- | --- |",
    ""
  ].join("\n");
}

// FND-005 / FR-NODE-053 — the `speckiwi init` hook installer materialises the
// Claude PostToolUse trace hook, the Codex apply_patch hook, the git pre-commit
// gate that delegates to the docs/.kiwi runner, and the docs/.kiwi scaffold
// directories, while surfacing clobber and enterprise-policy suppression
// warnings instead of silently overwriting existing files.

const GIT_PRE_COMMIT_RUNNER = "docs/.kiwi/hooks/pre-commit.mjs";

function renderGitPreCommitHook(): string {
  return [
    "#!/bin/sh",
    "# speckiwi managed pre-commit hook — delegates to the docs/.kiwi runner.",
    `node "\${CLAUDE_PROJECT_DIR:-.}/${GIT_PRE_COMMIT_RUNNER}" "$@"`,
    ""
  ].join("\n");
}

function renderClaudeSettings(): string {
  return `${JSON.stringify(
    {
      hooks: {
        PostToolUse: [
          {
            matcher: "Edit|Write|MultiEdit",
            hooks: [{ type: "command", command: "node docs/.kiwi/hooks/trace.mjs" }]
          }
        ]
      }
    },
    null,
    2
  )}\n`;
}

function renderCodexHooks(): string {
  return `${JSON.stringify(
    {
      hooks: {
        PostToolUse: [{ match: { tool: "apply_patch" }, command: ["node", "docs/.kiwi/hooks/trace.mjs"] }]
      }
    },
    null,
    2
  )}\n`;
}

async function pathExists(target: string): Promise<boolean> {
  try {
    await stat(target);
    return true;
  } catch {
    return false;
  }
}

/** Reads a bundled docs/.kiwi runner shipped with the package, or undefined when absent. */
async function loadBundledHookRunner(name: string): Promise<string | undefined> {
  const candidate = fileURLToPath(new URL(`../../../docs/.kiwi/hooks/${name}`, import.meta.url));
  try {
    return await readFile(candidate, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    return undefined;
  }
}

async function installHooks(root: string, output: InitProjectOutput, warnings: string[], force: boolean, dryRun = false): Promise<void> {
  // docs/.kiwi scaffold: hook runner directory, trace output directory, and the
  // best-effort runner scripts the installed hooks delegate to.
  const kiwiHooksDir = path.join(root, "docs", ".kiwi", "hooks");
  if (!dryRun) {
    await mkdir(kiwiHooksDir, { recursive: true });
    await mkdir(path.join(root, "docs", ".kiwi", "trace"), { recursive: true });
  }
  for (const runner of ["pre-commit.mjs", "trace.mjs"] as const) {
    const bundled = await loadBundledHookRunner(runner);
    await writeIfMissing(path.join(kiwiHooksDir, runner), bundled ?? "#!/usr/bin/env node\nprocess.exit(0);\n", output, force, dryRun);
  }

  await installGitPreCommitHook(root, output, warnings, dryRun);
  await installClaudeSettings(root, output, warnings, force, dryRun);
  await installCodexHooks(root, output, warnings, force, dryRun);
}

async function installGitPreCommitHook(root: string, output: InitProjectOutput, warnings: string[], dryRun = false): Promise<void> {
  const gitDir = path.join(root, ".git");
  const gitDirStat = await stat(gitDir).catch(() => undefined);
  if (!gitDirStat) {
    warnings.push("No .git directory found; skipped installing the pre-commit hook.");
    return;
  }
  if (!gitDirStat.isDirectory()) {
    // In a linked git worktree or a submodule, .git is a `gitdir:` pointer file,
    // not a directory, so `.git/hooks` cannot be created here — mkdir would throw
    // ENOTDIR and abort the whole init. Git resolves hooks from the shared common
    // dir, so the pre-commit hook belongs in the main working tree; skip with a
    // warning instead of crashing.
    warnings.push(
      "Detected a git worktree or submodule (.git is a file, not a directory); skipped installing the pre-commit hook. " +
        "Run speckiwi init in the main working tree to install the shared pre-commit hook."
    );
    return;
  }
  const hookPath = path.join(gitDir, "hooks", "pre-commit");
  let existing: string | undefined;
  try {
    existing = await readFile(hookPath, "utf8");
  } catch {
    existing = undefined;
  }
  if (existing === undefined) {
    if (!dryRun) {
      await mkdir(path.dirname(hookPath), { recursive: true });
      await writeFile(hookPath, renderGitPreCommitHook(), "utf8");
    }
    output.created.push(hookPath);
    return;
  }
  if (existing.includes(GIT_PRE_COMMIT_RUNNER)) {
    output.skipped.push(hookPath);
    return;
  }
  warnings.push(
    "Existing .git/hooks/pre-commit hook left unchanged; speckiwi did not overwrite it. " +
      `Delegate to node ${GIT_PRE_COMMIT_RUNNER} manually to enable the pre-commit gate.`
  );
}

async function installClaudeSettings(root: string, output: InitProjectOutput, warnings: string[], force: boolean, dryRun = false): Promise<void> {
  const claudeDir = path.join(root, ".claude");
  if (await pathExists(path.join(claudeDir, "managed-settings.json"))) {
    warnings.push(
      "Claude enterprise policy detected (.claude/managed-settings.json); skipped installing .claude/settings.json PostToolUse hook."
    );
    return;
  }
  await writeIfMissing(path.join(claudeDir, "settings.json"), renderClaudeSettings(), output, force, dryRun);
}

async function installCodexHooks(root: string, output: InitProjectOutput, warnings: string[], force: boolean, dryRun = false): Promise<void> {
  const codexDir = path.join(root, ".codex");
  let managedHooksOnly = false;
  try {
    const config = await readFile(path.join(codexDir, "config.toml"), "utf8");
    managedHooksOnly = /^\s*allow_managed_hooks_only\s*=\s*true/m.test(config);
  } catch {
    managedHooksOnly = false;
  }
  if (managedHooksOnly) {
    warnings.push(
      "Codex enterprise policy allow_managed_hooks_only = true detected in .codex/config.toml; skipped installing .codex/hooks.json."
    );
  } else {
    await writeIfMissing(path.join(codexDir, "hooks.json"), renderCodexHooks(), output, force, dryRun);
  }
  // Codex only runs project hooks after the repository is trusted, so this
  // advisory is always surfaced regardless of the managed-hooks policy.
  warnings.push("Codex runs project hooks only after you trust the repository (codex: trust the repo when prompted).");
}

async function writeIfMissing(filePath: string, content: string, output: InitProjectOutput, force = false, dryRun = false): Promise<void> {
  try {
    await readFile(filePath, "utf8");
    if (!force) {
      output.skipped.push(filePath);
      return;
    }
  } catch {
    // create
  }
  if (!dryRun) {
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, content.endsWith("\n") ? content : `${content}\n`, "utf8");
  }
  output.created.push(filePath);
}

export async function upsertAgentInstruction(root: string, agentFile: AgentFileMode, output: InitProjectOutput, dryRun = false): Promise<void> {
  const filePath = path.join(root, agentFile);
  const snippet = renderAgentInstructionSnippet();
  let fileExists = true;
  let existing = "";
  try {
    existing = await readFile(filePath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    fileExists = false;
  }
  const block = findAgentInstructionBlock(existing);
  if (block?.version === AGENT_INSTRUCTION_VERSION && block.hasEndMarker) {
    output.skipped.push(filePath);
    return;
  }
  const next = block ? replaceAgentInstructionBlock(existing, block, snippet) : appendAgentInstructionBlock(existing, snippet);
  if (!dryRun) await writeFile(filePath, next, "utf8");
  (fileExists ? output.updated : output.created).push(filePath);
}

function findAgentInstructionBlock(content: string): AgentInstructionBlock | undefined {
  for (const versioned of content.matchAll(VERSIONED_AGENT_HEADING_PATTERN)) {
    if (versioned.index === undefined) continue;
    const start = versioned.index;
    const marker = findEndMarker(content, start + versioned[0].length);
    if (!marker) continue;
    const nextHeading = findNextTopLevelHeadingStart(content, start + versioned[0].length);
    if (nextHeading !== undefined && nextHeading < marker.start) continue;
    const version = versioned.groups?.version;
    return {
      start,
      end: marker.end,
      ...(version ? { version } : {}),
      hasEndMarker: true
    };
  }

  const legacy = LEGACY_AGENT_HEADING_PATTERN.exec(content);
  if (legacy?.index !== undefined) {
    return {
      start: legacy.index,
      end: findFallbackBlockEnd(content, legacy.index + legacy[0].length),
      hasEndMarker: false
    };
  }

  return undefined;
}

function findEndMarker(content: string, start: number): { start: number; end: number } | undefined {
  const markerStart = content.indexOf(AGENT_INSTRUCTION_END_MARKER, start);
  if (markerStart === -1) return undefined;
  return { start: markerStart, end: markerStart + AGENT_INSTRUCTION_END_MARKER.length };
}

function findNextTopLevelHeadingStart(content: string, searchStart: number): number | undefined {
  const nextHeadingOffset = content.slice(searchStart).search(/\n# /);
  return nextHeadingOffset === -1 ? undefined : searchStart + nextHeadingOffset;
}

function findFallbackBlockEnd(content: string, searchStart: number): number {
  return findNextTopLevelHeadingStart(content, searchStart) ?? content.length;
}

function appendAgentInstructionBlock(existing: string, snippet: string): string {
  return existing.trim() ? `${existing.trimEnd()}\n\n${snippet}\n` : `${snippet}\n`;
}

function replaceAgentInstructionBlock(existing: string, block: AgentInstructionBlock, snippet: string): string {
  const before = existing.slice(0, block.start).trimEnd();
  const after = existing.slice(block.end).trimStart();
  return [before, snippet, after].filter(Boolean).join("\n\n") + "\n";
}

export async function initProject(root: ProjectRoot, input: InitProjectInput): Promise<MutationResult<InitProjectOutput>> {
  return withSrsMutationLock(root, { operation: "init_project", ignoreLock: input.ignoreLock, skipLock: input.skipLock }, () => initProjectUnlocked(root, input));
}

async function initProjectUnlocked(root: ProjectRoot, input: InitProjectInput): Promise<MutationResult<InitProjectOutput>> {
  const dryRun = Boolean(input.dryRun);
  const warnings: string[] = [];
  const output: InitProjectOutput = { created: [], skipped: [], updated: [], removed: [], warnings };
  if (!dryRun) {
    await mkdir(path.join(root.root, "docs", "spec"), { recursive: true });
    await mkdir(path.join(root.root, "docs", "rule"), { recursive: true });
  }
  const scope = parseScopeOption(input.scope);
  await writeIfMissing(path.join(root.root, "docs", "spec", "00.index.md"), renderIndexTemplate(input), output, input.force, dryRun);
  await writeIfMissing(path.join(root.root, "docs", "spec", "90.appendix.md"), renderAppendixTemplate(), output, input.force, dryRun);
  await writeIfMissing(path.join(root.root, "docs", "spec", scope.document), renderEmptyScopeTemplate(scope), output, input.force, dryRun);
  await writeIfMissing(path.join(root.root, "docs", "spec", "steps", "state.md"), renderStepStateTemplate(), output, input.force, dryRun);
  await writeIfMissing(path.join(root.root, "docs", "rule", "SRS-MD-Rules-v1.0.0.md"), await loadBundledRulesDocument(), output, input.force, dryRun);
  // FR-NODE-076 — the tdd work-mode snippet references the SDS rules, so init ships them too.
  await writeIfMissing(path.join(root.root, "docs", "rule", "SDS-MD-Rules-v1.0.0.md"), await loadBundledSdsRulesDocument(), output, input.force, dryRun);
  for (const agentFile of REQUIRED_AGENT_FILES) {
    await upsertAgentInstruction(root.root, agentFile, output, dryRun);
  }
  await installHooks(root.root, output, warnings, Boolean(input.force), dryRun);
  if (input.registerMcp) await registerMcpStep(root.root, output, warnings, dryRun);
  if (input.installSkills) {
    await provisionSkills(root.root, input, output, warnings, dryRun, "project");
    // FR-NODE-084 — --global adds a global-scope pass, gated per agent by agent-home presence.
    if (input.installSkillsGlobal) await provisionSkills(root.root, input, output, warnings, dryRun, "global");
  }
  return mutationOk(output);
}

// FR-NODE-067 — register the SpecKiwi stdio MCP server into the project (.mcp.json), idempotent.
async function registerMcpStep(root: string, output: InitProjectOutput, warnings: string[], dryRun: boolean): Promise<void> {
  let result: Awaited<ReturnType<typeof registerSpeckiwiMcp>>;
  try {
    result = await registerSpeckiwiMcp(root, { dryRun });
  } catch (error) {
    warnings.push(`mcp registration: ${(error as Error).message}`);
    return; // MCP registration degrades to a warning; init proceeds.
  }
  warnings.push(...result.warnings);
  switch (result.status) {
    case "created":
      output.created.push(result.filePath);
      break;
    case "updated":
      output.updated.push(result.filePath);
      break;
    case "skipped":
      output.skipped.push(result.filePath);
      break;
    case "warning":
      break; // warnings already recorded; no file change
  }
}

type SkillProvisionScope = "project" | "global";

interface GlobalSkillContext {
  homeDir: string;
  codexHome?: string;
}

// FR-NODE-084 — resolve the home dir + CODEX_HOME used to locate global skill destinations. Test/DI seams
// (globalHomeDir/globalCodexHome) override the process env so the global pass is deterministic under test.
function resolveGlobalSkillContext(input: InitProjectInput): GlobalSkillContext {
  const homeDir = input.globalHomeDir ?? process.env.HOME ?? process.env.USERPROFILE ?? "";
  const codexHome = input.globalCodexHome ?? process.env.CODEX_HOME;
  return codexHome ? { homeDir, codexHome } : { homeDir };
}

async function directoryExists(dir: string): Promise<boolean> {
  const info = await stat(dir).catch(() => undefined);
  return Boolean(info?.isDirectory());
}

// FR-NODE-084 — an agent is provisioned globally only when its home directory is present: Claude uses
// `~/.claude`, Codex uses `${CODEX_HOME:-~/.codex}`. An absent home means the agent is not installed.
async function isAgentHomePresent(agent: SkillAgent, ctx: GlobalSkillContext): Promise<boolean> {
  if (agent === "claude") return directoryExists(path.join(ctx.homeDir, ".claude"));
  if (agent === "codex") {
    const codexHome = ctx.codexHome ? path.resolve(ctx.codexHome) : path.join(ctx.homeDir, ".codex");
    return directoryExists(codexHome);
  }
  return false;
}

// FR-NODE-068/069/084 — provision the bundled kiwi skills for Claude + Codex at the given scope, then prune
// orphaned kiwi-* skill directories. The global scope is additionally gated per agent by agent-home presence.
// Skill degradation (missing source, conflicts, absent agent) warns without aborting.
async function provisionSkills(root: string, input: InitProjectInput, output: InitProjectOutput, warnings: string[], dryRun: boolean, scope: SkillProvisionScope): Promise<void> {
  const label = scope === "global" ? " global" : "";
  let globalCtx: GlobalSkillContext | undefined;
  if (scope === "global") {
    globalCtx = resolveGlobalSkillContext(input);
    if (!globalCtx.homeDir) {
      warnings.push("skills global: home directory is unavailable — global skill provisioning skipped");
      return;
    }
  }
  for (const agent of SKILL_PROVISION_AGENTS) {
    if (scope === "global" && globalCtx && !(await isAgentHomePresent(agent, globalCtx))) {
      warnings.push(`skills(${agent}) global: ${agent} home directory not found — skipped`);
      continue;
    }
    try {
      const options = {
        projectRoot: { root },
        agent,
        selector: "all",
        scope,
        dryRun,
        ...(scope === "global" && globalCtx
          ? { homeDir: globalCtx.homeDir, ...(globalCtx.codexHome ? { env: { CODEX_HOME: globalCtx.codexHome } } : {}) }
          : {}),
        ...(input.skillSourceBaseDir ? { sourceBaseDir: input.skillSourceBaseDir } : {})
      };
      const provisioned = dryRun ? await planSkillInstall(options) : await installSkill(options);
      if (!provisioned.ok) {
        warnings.push(`skills(${agent})${label}: ${provisioned.error.message}`);
        continue;
      }
      foldSkillResults(provisioned.value, output, warnings);
      // FR-NODE-084 — the orphan kiwi-* prune runs ONLY at project scope. The shared global home may host
      // skills provisioned by another project or a different speckiwi version; pruning by one project's
      // source set could delete them. The global pass installs/updates only, never prunes.
      if (scope === "project") {
        const prune = await pruneOrphanKiwiSkills({
          destinationRoot: provisioned.value.destinationRoot,
          agent,
          sourceSkillNames: provisioned.value.results.map((result) => result.name),
          dryRun
        });
        output.removed.push(...prune.removed);
        warnings.push(...prune.warnings);
      }
    } catch (error) {
      // The skills step degrades non-fatally: any per-agent failure (Result error or raw throw, e.g. an
      // fs error against a read-only home) is recorded as a warning and init proceeds.
      warnings.push(`skills(${agent})${label}: ${(error as Error).message}`);
    }
  }
}

function foldSkillResults(plan: SkillInstallPlan, output: InitProjectOutput, warnings: string[]): void {
  for (const result of plan.results) {
    switch (result.operation) {
      case "install":
        output.created.push(result.destination);
        break;
      case "update":
        output.updated.push(result.destination);
        break;
      case "skip":
        output.skipped.push(result.destination);
        break;
      case "conflict":
        warnings.push(`skills(${plan.agent}) ${result.name}: ${result.conflicts.join("; ") || "conflict"}`);
        break;
    }
  }
}
