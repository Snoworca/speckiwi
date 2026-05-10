import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { MutationResult, ProjectRoot } from "../types.js";
import { mutationOk } from "../mutation/guards.js";
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
}

export interface InitProjectOutput {
  created: string[];
  skipped: string[];
  updated: string[];
}

interface AgentInstructionBlock {
  start: number;
  end: number;
  version?: string;
  hasEndMarker: boolean;
}

const VERSIONED_AGENT_HEADING_PATTERN = /^# SpecKiwi SRS 워크플로 v(?<version>[0-9]+(?:\.[0-9]+)*)$/gm;
const LEGACY_AGENT_HEADING_PATTERN = /^# SpecKiwi SRS workflow$/m;

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
  const output: InitProjectOutput = { created: [], skipped: [], updated: [] };
  await mkdir(path.join(root.root, "docs", "spec"), { recursive: true });
  await mkdir(path.join(root.root, "docs", "rule"), { recursive: true });
  const scope = parseScopeOption(input.scope);
  await writeIfMissing(path.join(root.root, "docs", "spec", "00.index.md"), renderIndexTemplate(input), output, input.force);
  await writeIfMissing(path.join(root.root, "docs", "spec", "90.appendix.md"), renderAppendixTemplate(), output, input.force);
  await writeIfMissing(path.join(root.root, "docs", "spec", scope.document), renderEmptyScopeTemplate(scope), output, input.force);
  await writeIfMissing(path.join(root.root, "docs", "rule", "SRS-MD-Rules-v1.0.0.md"), await loadBundledRulesDocument(), output, input.force);
  for (const agentFile of REQUIRED_AGENT_FILES) {
    await upsertAgentInstruction(root.root, agentFile, output);
  }
  return mutationOk(output);
}
