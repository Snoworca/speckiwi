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
import { registerOrchestrateCommands } from "../../src/cli/commands/orchestrate.js";
import { toolSchemas } from "../../src/mcp/server.js";
import { GATE_IDS } from "../../src/core/orchestrator/auto-gate.js";

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
  // @req FR-NODE-128 — the orchestrate namespace is part of the real tree a skill cites.
  registerOrchestrateCommands(program, { io });
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

// FR-NODE-122 — gate-id parity between the bundled kiwi-orchestrator SKILL.md variants and the
// exported `GateId` union (05 §10.4's third parity class, §13).
//
// This extends the harness above rather than adding a second one: FR-FLOW-061 already asserts the
// ids agree across the three variants, and nothing bound them to the id a kernel module emits at
// exit 2. A divergence is silent — a gate absent from `critical_gates[]` defaults to
// `business-decision`, which a committee auto-approves at confidence at or above 0.7, so a mistyped
// critical gate becomes committee-approvable while all three variants stay green.

const ORCHESTRATOR_SKILL_ROOTS = ["skills/claude", "skills/codex", "skills/etc", ".agents/skills"];

/** The severity vocabulary a gate-severity row is recognised by (`auto-option.md` §4). */
const GATE_SEVERITIES = ["critical", "business-decision", "clarification", "rollback-confirmation"];

function tableCells(line: string): string[] | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith("|") || !trimmed.endsWith("|")) return null;
  return trimmed
    .slice(1, -1)
    .split("|")
    .map((cell) => cell.trim());
}

function bareGateId(cell: string): string | null {
  const token = cell.replace(/`/g, "").trim();
  return /^[a-z][a-z0-9-]*$/.test(token) && token.includes("-") ? token : null;
}

/**
 * Every gate id a variant body declares: the first column of its three-column `critical_gates[]`
 * table, plus the first column of any row that also carries a severity from the closed vocabulary.
 */
function extractDeclaredGateIds(body: string): { criticalGates: string[]; severityRows: string[]; criticalTableWidths: number[] } {
  const lines = body.split(/\r?\n/);
  const criticalGates: string[] = [];
  const severityRows: string[] = [];
  const criticalTableWidths: number[] = [];

  let inCriticalTable = false;
  let sawCriticalMarker = false;
  for (const line of lines) {
    if (/critical_gates/.test(line)) {
      sawCriticalMarker = true;
      inCriticalTable = false;
    }
    const cells = tableCells(line);
    if (!cells) {
      if (line.trim() === "") continue;
      inCriticalTable = false;
      continue;
    }
    if (cells.every((cell) => /^:?-{3,}:?$/.test(cell))) {
      if (sawCriticalMarker) inCriticalTable = true;
      continue;
    }
    const id = bareGateId(cells[0] ?? "");
    if (!id) continue;
    if (inCriticalTable) {
      criticalGates.push(id);
      criticalTableWidths.push(cells.length);
      sawCriticalMarker = false;
    }
    if (cells.slice(1).some((cell) => GATE_SEVERITIES.includes(cell.replace(/`/g, "").trim()))) severityRows.push(id);
  }

  return { criticalGates, severityRows, criticalTableWidths };
}

const FIXTURE_VARIANT = [
  "# kiwi-orchestrator",
  "",
  "## critical_gates[]",
  "",
  "| gate_id | reason | location |",
  "| --- | --- | --- |",
  "| `run-root-preflight-mismatch` | MCP workspaceRoot is not the git toplevel | Preflight P.1 |",
  "| `handoff-not-english` | non-Latin script in a handoff body | Phase 3.f |",
  "| `cross-lane-duplication-unresolved` | a duplicate row carries no resolution | Phase 3.k |",
  "",
  "## Gate severities",
  "",
  "| gate_id | severity | note |",
  "| --- | --- | --- |",
  "| `route-proposal` | business-decision | fires on every run |",
  "| `route-step-requires-mode-switch` | business-decision | marks stay-and-orchestrate |",
  "| `tdd-route-unattended` | business-decision | marks orchestrate-instead |",
  "| `route-downgrade-available` | business-decision | marks continue-orchestrated |",
  ""
].join("\n");

async function orchestratorVariantBodies(): Promise<Array<{ file: string; body: string }>> {
  const bodies: Array<{ file: string; body: string }> = [];
  for (const root of ORCHESTRATOR_SKILL_ROOTS) {
    const candidate = path.join(process.cwd(), root, "kiwi-orchestrator", "SKILL.md");
    try {
      bodies.push({ file: path.relative(process.cwd(), candidate), body: await readFile(candidate, "utf8") });
    } catch {
      // The skill body is authored last (§10.5 step 8). The fixture cases below carry the class
      // until it exists, which is why they are not conditioned on this loop finding anything.
    }
  }
  return bodies;
}

// §13's three provenance groups. The union must contain them, or the harness fails on skill text
// that is correct — the wrong direction to fail, since `critical_gates[]` is what the skill declares.
const INHERITED_FROM_WAVE_MASTER = [
  "unsafe-option-refused",
  "wt-delegation-refused",
  "decomposition-input-missing",
  "wave-decomposition-coverage-gap",
  "out-of-scope-user-consent",
  "wave-append-cap-exhausted",
  "wave-verify-residual-critical",
  "wave-verify-fail-residual",
  "wave-verify-cross-wave-fix-required",
  "final-verify-residual-critical",
  "child-pipeline-needs-user-or-failed",
  "child-srs-needs-user-or-failed",
  "invalid-loop-option"
];

const NEVER_AUTO_GRANTED = ["integration-test-user-consent", "cost-warning-large-task"];

const ADOPTED_FROM_AUTO_OPTION = ["external-module-impact", "mcp-cli-both-unavailable", "self-recursive-spawn"];

describe("FR-NODE-122 gate-id parity", () => {
  it("AC-2 — the union covers every group §13 requires the skill to declare", () => {
    for (const gateId of [...INHERITED_FROM_WAVE_MASTER, ...NEVER_AUTO_GRANTED, ...ADOPTED_FROM_AUTO_OPTION]) {
      expect(GATE_IDS as readonly string[]).toContain(gateId);
    }
    // 39 orchestrator-owned phase-1 rows + 4 routing gates + 13 inherited + 2 never-auto-granted + 3 adopted.
    expect(GATE_IDS).toHaveLength(61);
    expect(new Set(GATE_IDS).size).toBe(61);
  });

  it("AC-1 — extracts gate ids from the three-column critical_gates[] table and from the severity rows", () => {
    const extracted = extractDeclaredGateIds(FIXTURE_VARIANT);

    expect(extracted.criticalGates).toEqual(["run-root-preflight-mismatch", "handoff-not-english", "cross-lane-duplication-unresolved"]);
    expect(extracted.criticalTableWidths.every((width) => width === 3)).toBe(true);
    expect(extracted.severityRows).toEqual(["route-proposal", "route-step-requires-mode-switch", "tdd-route-unattended", "route-downgrade-available"]);
  });

  it("AC-2 — asserts every extracted gate id is a member of the exported GateId union", async () => {
    const variants = [{ file: "fixture", body: FIXTURE_VARIANT }, ...(await orchestratorVariantBodies())];
    const offenders: Array<{ file: string; gateId: string }> = [];

    for (const variant of variants) {
      const extracted = extractDeclaredGateIds(variant.body);
      expect([...extracted.criticalGates, ...extracted.severityRows].length).toBeGreaterThan(0);
      for (const gateId of [...extracted.criticalGates, ...extracted.severityRows]) {
        if (!(GATE_IDS as readonly string[]).includes(gateId)) offenders.push({ file: variant.file, gateId });
      }
    }

    expect(offenders).toEqual([]);
  });

  it("AC-3 — the assertion is set inclusion, not set equality", async () => {
    const declared = new Set([...(await orchestratorVariantBodies()), { file: "fixture", body: FIXTURE_VARIANT }].flatMap((variant) => {
      const extracted = extractDeclaredGateIds(variant.body);
      return [...extracted.criticalGates, ...extracted.severityRows];
    }));

    const undeclared = GATE_IDS.filter((gateId) => !declared.has(gateId));
    expect(undeclared.length).toBeGreaterThan(0);
    expect([...declared].every((gateId) => (GATE_IDS as readonly string[]).includes(gateId))).toBe(true);
  });

  it("AC-4 — a variant declaring an id absent from the union is red", () => {
    const mistyped = FIXTURE_VARIANT.replace("`handoff-not-english`", "`handoff-not-englsh`");
    expect(mistyped).not.toBe(FIXTURE_VARIANT);

    const extracted = extractDeclaredGateIds(mistyped);
    expect(extracted.criticalGates).toContain("handoff-not-englsh");
    expect([...extracted.criticalGates, ...extracted.severityRows].every((gateId) => (GATE_IDS as readonly string[]).includes(gateId))).toBe(false);
  });

  it("AC-5 — the four business-decision routing gates are in the union on the same footing", () => {
    for (const gateId of ["route-proposal", "route-step-requires-mode-switch", "tdd-route-unattended", "route-downgrade-available"]) {
      expect(GATE_IDS as readonly string[]).toContain(gateId);
    }
    expect(extractDeclaredGateIds(FIXTURE_VARIANT).severityRows).toHaveLength(4);
  });
});
