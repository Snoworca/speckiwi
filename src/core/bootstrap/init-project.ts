import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { MutationResult, ProjectRoot } from "../types.js";
import { mutationOk } from "../mutation/guards.js";
import {
  loadBundledRulesDocument,
  parseScopeOption,
  renderAgentInstructionSnippet,
  renderAppendixTemplate,
  renderEmptyScopeTemplate,
  renderIndexTemplate
} from "./templates.js";

export type AgentFileMode = "AGENTS.md" | "CLAUDE.md";

export interface InitProjectInput {
  product?: string;
  target?: string;
  scope?: string;
  agentFiles?: AgentFileMode[];
  force?: boolean;
}

export interface InitProjectOutput {
  created: string[];
  skipped: string[];
  updated: string[];
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
  const existing = await readFile(filePath, "utf8").catch(() => "");
  if (existing.includes("docs/rule/SRS-MD-Rules-v1.0.0.md")) {
    output.skipped.push(filePath);
    return;
  }
  const next = existing.trim() ? `${existing.trim()}\n\n${snippet}\n` : `${snippet}\n`;
  await writeFile(filePath, next, "utf8");
  output.updated.push(filePath);
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
  for (const agentFile of input.agentFiles ?? []) {
    await upsertAgentInstruction(root.root, agentFile, output);
  }
  return mutationOk(output);
}
