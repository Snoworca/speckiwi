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
  parseScopeOption,
  renderAgentInstructionSnippet,
  renderAppendixTemplate,
  renderEmptyScopeTemplate,
  renderIndexTemplate
} from "./templates.js";

export type AgentFileMode = "AGENTS.md" | "CLAUDE.md";

const REQUIRED_AGENT_FILES: readonly AgentFileMode[] = ["AGENTS.md", "CLAUDE.md"];

export interface InitProjectInput {
  product?: string;
  target?: string;
  scope?: string;
  force?: boolean;
  ignoreLock?: boolean;
  skipLock?: boolean;
}

export interface InitProjectOutput {
  created: string[];
  skipped: string[];
  updated: string[];
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

async function installHooks(root: string, output: InitProjectOutput, warnings: string[], force: boolean): Promise<void> {
  // docs/.kiwi scaffold: hook runner directory, trace output directory, and the
  // best-effort runner scripts the installed hooks delegate to.
  const kiwiHooksDir = path.join(root, "docs", ".kiwi", "hooks");
  await mkdir(kiwiHooksDir, { recursive: true });
  await mkdir(path.join(root, "docs", ".kiwi", "trace"), { recursive: true });
  for (const runner of ["pre-commit.mjs", "trace.mjs"] as const) {
    const bundled = await loadBundledHookRunner(runner);
    await writeIfMissing(path.join(kiwiHooksDir, runner), bundled ?? "#!/usr/bin/env node\nprocess.exit(0);\n", output, force);
  }

  await installGitPreCommitHook(root, output, warnings);
  await installClaudeSettings(root, output, warnings, force);
  await installCodexHooks(root, output, warnings, force);
}

async function installGitPreCommitHook(root: string, output: InitProjectOutput, warnings: string[]): Promise<void> {
  const gitDir = path.join(root, ".git");
  if (!(await pathExists(gitDir))) {
    warnings.push("No .git directory found; skipped installing the pre-commit hook.");
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
    await mkdir(path.dirname(hookPath), { recursive: true });
    await writeFile(hookPath, renderGitPreCommitHook(), "utf8");
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

async function installClaudeSettings(root: string, output: InitProjectOutput, warnings: string[], force: boolean): Promise<void> {
  const claudeDir = path.join(root, ".claude");
  if (await pathExists(path.join(claudeDir, "managed-settings.json"))) {
    warnings.push(
      "Claude enterprise policy detected (.claude/managed-settings.json); skipped installing .claude/settings.json PostToolUse hook."
    );
    return;
  }
  await writeIfMissing(path.join(claudeDir, "settings.json"), renderClaudeSettings(), output, force);
}

async function installCodexHooks(root: string, output: InitProjectOutput, warnings: string[], force: boolean): Promise<void> {
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
    await writeIfMissing(path.join(codexDir, "hooks.json"), renderCodexHooks(), output, force);
  }
  // Codex only runs project hooks after the repository is trusted, so this
  // advisory is always surfaced regardless of the managed-hooks policy.
  warnings.push("Codex runs project hooks only after you trust the repository (codex: trust the repo when prompted).");
}

async function writeIfMissing(filePath: string, content: string, output: InitProjectOutput, force = false): Promise<void> {
  try {
    await readFile(filePath, "utf8");
    if (!force) {
      output.skipped.push(filePath);
      return;
    }
  } catch {
    // create
  }
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, content.endsWith("\n") ? content : `${content}\n`, "utf8");
  output.created.push(filePath);
}

export async function upsertAgentInstruction(root: string, agentFile: AgentFileMode, output: InitProjectOutput): Promise<void> {
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
  await writeFile(filePath, next, "utf8");
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
  const warnings: string[] = [];
  const output: InitProjectOutput = { created: [], skipped: [], updated: [], warnings };
  await mkdir(path.join(root.root, "docs", "spec"), { recursive: true });
  await mkdir(path.join(root.root, "docs", "rule"), { recursive: true });
  const scope = parseScopeOption(input.scope);
  await writeIfMissing(path.join(root.root, "docs", "spec", "00.index.md"), renderIndexTemplate(input), output, input.force);
  await writeIfMissing(path.join(root.root, "docs", "spec", "90.appendix.md"), renderAppendixTemplate(), output, input.force);
  await writeIfMissing(path.join(root.root, "docs", "spec", scope.document), renderEmptyScopeTemplate(scope), output, input.force);
  await writeIfMissing(path.join(root.root, "docs", "spec", "steps", "state.md"), renderStepStateTemplate(), output, input.force);
  await writeIfMissing(path.join(root.root, "docs", "rule", "SRS-MD-Rules-v1.0.0.md"), await loadBundledRulesDocument(), output, input.force);
  for (const agentFile of REQUIRED_AGENT_FILES) {
    await upsertAgentInstruction(root.root, agentFile, output);
  }
  await installHooks(root.root, output, warnings, Boolean(input.force));
  return mutationOk(output);
}
