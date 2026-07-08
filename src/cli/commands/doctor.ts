import type { Command } from "commander";
import { resolveProjectRoot } from "../../core/project-root.js";
import { runPackageDoctor } from "../../doctor/package-doctor.js";
import { parseWorkspace } from "../../core/parser/workspace-parser.js";
import { diagnoseHealth } from "../../core/health/doctor.js";
import { upsertAgentInstruction, type AgentFileMode, type InitProjectOutput } from "../../core/bootstrap/init-project.js";
import type { CliContext } from "../command.js";
import { writeHuman, writeJson } from "../formatters.js";

// @req IR-CLI-065 / OPS-NODE-003
// `speckiwi doctor` reports a consolidated environment-health diagnosis (IR-CLI-065) alongside the
// package/MCP smoke checks (OPS-NODE-003). The env-health `checks` are exposed under `health` so the
// two check shapes (package `{id,status}` vs health `{topic,state,remediation}`) stay distinct. With
// `--fix`, only the missing/outdated agent workflow blocks are re-upserted (the idempotent init upsert);
// Requirement Block data is never touched. A read-only diagnosis never writes and always exits 0.

const FIXABLE_AGENT_FILES: readonly AgentFileMode[] = ["CLAUDE.md", "AGENTS.md"];

async function fixWorkflowBlocks(rootPath: string): Promise<void> {
  const output: InitProjectOutput = { created: [], skipped: [], updated: [] };
  for (const agentFile of FIXABLE_AGENT_FILES) {
    await upsertAgentInstruction(rootPath, agentFile, output);
  }
}

export function registerDoctorCommand(command: Command, context: CliContext): void {
  command
    .command("doctor")
    .option("--json", "JSON output")
    .option("--fix", "re-upsert missing or outdated agent workflow blocks only")
    .action(async (options) => {
      const root = await resolveProjectRoot(process.cwd(), command.opts().root);
      if (options.fix) await fixWorkflowBlocks(root.root);

      const report = await runPackageDoctor(root);
      const workspace = await parseWorkspace(root);
      const health = await diagnoseHealth(workspace);
      const merged = { ...report, health: health.checks };

      if (options.json || command.opts().json) writeJson(context.io, merged);
      else writeHuman(context.io, merged);
    });
}
