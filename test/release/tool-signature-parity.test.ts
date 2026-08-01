import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import type { Command } from "commander";
import { describe, expect, it } from "vitest";
import { attachInheritedOptionsHelp, buildCommand } from "../../src/cli/command.js";
import { registerDoctorCommand } from "../../src/cli/commands/doctor.js";
import { registerMcpCommand } from "../../src/cli/commands/mcp.js";
import { registerMutationCommands } from "../../src/cli/commands/mutations.js";
import { registerReadCommands } from "../../src/cli/commands/read.js";
import { registerSkillCommands } from "../../src/cli/commands/skills.js";
import { registerRepairCommands } from "../../src/cli/commands/repair.js";
import { toolSchemas } from "../../src/mcp/server.js";

const DOC_AND_SKILL_ROOTS = ["docs/spec/90.appendix.md", "AGENTS.md", "CLAUDE.md", "skills/codex", "skills/claude", "skills/etc", ".agents/skills"];

function fakeIo() {
  const stream = { write: () => true } as unknown as NodeJS.WriteStream;
  return { stdout: stream, stderr: stream };
}

function buildProgram(): Command {
  const io = fakeIo();
  const program = buildCommand({ io });
  registerReadCommands(program, { io });
  registerMutationCommands(program, { io });
  registerMcpCommand(program, { io });
  registerSkillCommands(program, { io });
  registerDoctorCommand(program, { io });
  registerRepairCommands(program, { io });
  attachInheritedOptionsHelp(program);
  return program;
}

function findCommand(parent: Command, names: string[]): Command {
  let current = parent;
  for (const name of names) {
    const next = current.commands.find((command) => command.name() === name);
    if (!next) throw new Error(`command not found: ${names.join(" ")}`);
    current = next;
  }
  return current;
}

function helpFor(command: Command): string {
  let captured = "";
  command.configureOutput({
    writeOut: (text) => {
      captured += text;
      return true;
    },
    writeErr: (text) => {
      captured += text;
      return true;
    }
  });
  command.outputHelp();
  return captured;
}

async function collectTextFiles(entry: string): Promise<string[]> {
  const absolute = path.join(process.cwd(), entry);
  if (entry.endsWith(".md")) return [absolute];
  const files: string[] = [];
  async function walk(dir: string): Promise<void> {
    for (const item of await readdir(dir, { withFileTypes: true })) {
      const itemPath = path.join(dir, item.name);
      if (item.isDirectory()) await walk(itemPath);
      else if (/\.(md|yaml|yml|json)$/i.test(item.name)) files.push(itemPath);
    }
  }
  await walk(absolute);
  return files;
}

describe("REL-FLOW-002 tool signature parity", () => {
  it("keeps target lifecycle CLI docs aligned with runtime help", async () => {
    const appendix = await readFile("docs/spec/90.appendix.md", "utf8");
    const agents = await readFile("AGENTS.md", "utf8");
    const claude = await readFile("CLAUDE.md", "utf8");
    const program = buildProgram();
    const setActiveTargetHelp = helpFor(findCommand(program, ["set-active-target"]));
    const addRequirementHelp = helpFor(findCommand(program, ["add-requirement"]));

    for (const flag of ["--create", "--type <type>", "--description <text>", "--dry-run", "--json"]) {
      expect(setActiveTargetHelp).toContain(flag);
    }
    expect(appendix).toContain("speckiwi set-active-target <Target> [--create] [--type <version|release|milestone|phase|objective|experiment>] [--description <text>] [--dry-run] [--json]");
    expect(agents).toContain("speckiwi set-active-target <target> --create");
    expect(claude).toContain("speckiwi set-active-target <target> --create");

    expect(addRequirementHelp).toContain("--target <target>");
    expect(appendix).toContain("speckiwi add-requirement --type <Type> --scope <Scope> [--target <Target>]");
  });

  it("keeps MCP schemas aligned with documented target creation and compact projection names", () => {
    expect(toolSchemas.set_active_target.create?.safeParse(true).success).toBe(true);
    expect(toolSchemas.set_active_target.type?.safeParse("version").success).toBe(true);
    expect(toolSchemas.set_active_target.description?.safeParse("Tool improvement").success).toBe(true);
    expect(toolSchemas.add_requirement.target?.safeParse(undefined).success).toBe(true);
    expect(toolSchemas.list_requirements.projection?.safeParse("compact").success).toBe(true);
    expect(toolSchemas.list_requirements).not.toHaveProperty("includeContent");
    expect(toolSchemas.list_requirements).not.toHaveProperty("include-content");
  });

  it("documents every registered MCP tool name in the appendix", async () => {
    const appendix = await readFile("docs/spec/90.appendix.md", "utf8");
    for (const toolName of Object.keys(toolSchemas).sort()) {
      expect(appendix).toContain(`\`${toolName}\``);
    }
  });

  it("keeps workflow, repair, skills, and doctor CLI docs aligned with runtime commands", async () => {
    const appendix = await readFile("docs/spec/90.appendix.md", "utf8");
    const program = buildProgram();

    const workflowHelp = helpFor(findCommand(program, ["workflow"]));
    for (const commandName of [
      "workspace",
      "artifacts",
      "plan-status",
      "task-check",
      "task-uncheck",
      "pipeline-emit",
      "worklog-emit",
      "logical-delete",
      "migrate-preview"
    ]) {
      expect(workflowHelp).toContain(commandName);
    }

    const repairHelp = helpFor(findCommand(program, ["repair", "requirement-id-collisions"]));
    for (const commandName of ["diagnose", "plan", "apply"]) {
      expect(repairHelp).toContain(commandName);
    }

    const skillsHelp = helpFor(findCommand(program, ["skills"]));
    expect(skillsHelp).toContain("install");
    expect(skillsHelp).toContain("add");

    const doctorHelp = helpFor(findCommand(program, ["doctor"]));
    expect(doctorHelp).toContain("--json");

    for (const snippet of [
      "speckiwi workflow task-check <taskId> --path <plan.md> --run-id <runId>",
      "speckiwi workflow pipeline-emit --event <json> --run-id <runId>",
      "speckiwi workflow work-order next [shared read options]",
      "speckiwi repair requirement-id-collisions plan --duplicate-id <id>",
      "speckiwi repair requirement-id-collisions apply --plan <path> [--dry-run] [--ignore-lock] [--json]",
      "speckiwi skills install <codex|claude|etc|hermes> <skill|all>",
      "speckiwi doctor [--json]"
    ]) {
      expect(appendix).toContain(snippet);
    }
  });

  it("fails when docs or skill snippets mention unsupported signatures", async () => {
    const files = (await Promise.all(DOC_AND_SKILL_ROOTS.map((entry) => collectTextFiles(entry)))).flat();
    const offenders: Array<{ file: string; token: string }> = [];
    const unsupportedTokens = ["includeContent", "include-content", "include_content", "speckiwi workflow next-work-order"];
    for (const file of files) {
      const text = await readFile(file, "utf8");
      for (const token of unsupportedTokens) {
        if (text.includes(token)) offenders.push({ file: path.relative(process.cwd(), file), token });
      }
    }

    expect(offenders).toEqual([]);
  });
});
