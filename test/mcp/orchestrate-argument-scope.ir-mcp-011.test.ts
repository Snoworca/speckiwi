import { cp, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Command } from "commander";
import { afterAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { buildCommand } from "../../src/cli/command.js";
import {
  ORCHESTRATE_TOOL_BINDINGS,
  orchestrateArgv,
  registerOrchestrateCommands,
  type OrchestrateToolBinding
} from "../../src/cli/commands/orchestrate.js";
import { main } from "../../src/cli/index.js";
import { createMcpServer, toolSchemas } from "../../src/mcp/server.js";
import { callOrchestrateTool } from "../../src/mcp/tools/read-tools.js";
import { resolveGitCommonDir, runLockPath } from "../../src/core/orchestrator/run-lock.js";
import { cleanupFixtures, commitAll, initRepo } from "../core/orchestrator/support/git-fixture.js";

// @req IR-MCP-011 — an `orchestrate_*` tool passes an argument only to the CLI leaves that take it,
// refuses it for the others before the CLI runs, and hands a CLI failure back as fields.
//
// Measured on 5.3.7 and 5.3.8: `orchestrate_run_lock {action:"unlock", owner}` ran
// `orchestrate run unlock --owner … --json`, commander refused `--owner`, and the caller got an
// `error` string holding commander's stderr line, the CLI envelope and a recovery pointing at
// `list`.

const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..");
const SPEC_FIXTURE = path.join(REPO_ROOT, "test", "fixtures", "workspaces", "valid-basic", "docs", "spec");
const OWNER = "kiwi-orchestrator:2026-11-07.og-exposure-sharing.exposure-sharing";

afterAll(async () => {
  await cleanupFixtures();
});

async function repository(prefix: string): Promise<string> {
  const root = await initRepo(prefix);
  await cp(SPEC_FIXTURE, path.join(root, "docs", "spec"), { recursive: true });
  await writeFile(path.join(root, "README.md"), "# fixture\n", "utf8");
  await commitAll(root, "test: seed");
  return root;
}

type Answer = Record<string, unknown> & { ok?: boolean; error?: unknown; recovery?: unknown; exitCode?: number };

async function runLock(root: string, input: Record<string, unknown>): Promise<Answer> {
  return (await createMcpServer({ root }).callTool("orchestrate_run_lock", input)) as Answer;
}

function capture(): { stream: NodeJS.WriteStream; text: () => string } {
  const chunks: string[] = [];
  const stream = { write: (chunk: string) => { chunks.push(String(chunk)); return true; } } as unknown as NodeJS.WriteStream;
  return { stream, text: () => chunks.join("") };
}

function orchestrateTree(): Command {
  const sink = { write: () => true } as unknown as NodeJS.WriteStream;
  const context = { io: { stdout: sink, stderr: sink } };
  const command = buildCommand(context);
  registerOrchestrateCommands(command, context);
  return command;
}

function leafFor(root: Command, path: readonly string[]): Command | null {
  let current = root.commands.find((entry) => entry.name() === "orchestrate");
  for (const segment of path) {
    current = current?.commands.find((entry) => entry.name() === segment);
  }
  return current ?? null;
}

/** Every CLI leaf a binding can reach: one per selector value, or its own path. */
function leavesOf(binding: OrchestrateToolBinding): Array<{ value: string | null; path: string[] }> {
  if (!binding.selector) return [{ value: null, path: [...binding.path] }];
  const selector = binding.selector;
  return selector.values.map((value) => {
    const path = [...binding.path];
    path[selector.index] = value;
    return { value, path };
  });
}

/** The option list a binding passes to one leaf: every option without a scope, and a scoped one only on its values. */
function passedTo(binding: OrchestrateToolBinding, value: string | null) {
  return binding.options.filter((option) => {
    const scope = (option as { onlyFor?: readonly string[] }).onlyFor;
    return scope === undefined || (value !== null && scope.includes(value));
  });
}

function sampleFor(encoding: string): unknown {
  if (encoding === "boolean") return true;
  if (encoding === "array") return ["x"];
  if (encoding === "json") return { x: 1 };
  return "x";
}

describe("IR-MCP-011 AC-1 — an argument the chosen action does not take is refused before the CLI runs", () => {
  it("refuses owner on unlock and keeps the lock held", async () => {
    const root = await repository("ir-mcp-011-ac1-unlock-");
    const lockPath = runLockPath(await resolveGitCommonDir(root));
    expect((await runLock(root, { action: "lock", owner: OWNER })).ok).toBe(true);
    try {
      const refused = await runLock(root, { action: "unlock", owner: OWNER });
      expect(refused.ok).toBe(false);
      expect(refused.error).toMatchObject({ code: "USAGE", message: expect.stringContaining("owner") });
      expect((refused.error as { message: string }).message).toMatch(/\block\b/);
      expect(refused.exitCode, "the CLI must not have run").toBeUndefined();
      const status = await runLock(root, { action: "status" });
      expect(status).toMatchObject({ ok: true, holder: { owner: OWNER } });
    } finally {
      await runLock(root, { action: "unlock" });
      await rm(lockPath, { force: true });
    }
  });

  it("refuses owner and dryRun on status", async () => {
    const root = await repository("ir-mcp-011-ac1-status-");
    for (const input of [{ action: "status", owner: OWNER }, { action: "status", dryRun: true }]) {
      const refused = await runLock(root, input);
      const argument = Object.keys(input).find((key) => key !== "action") as string;
      expect(refused.ok, JSON.stringify(input)).toBe(false);
      expect(refused.error).toMatchObject({ code: "USAGE", message: expect.stringContaining(argument) });
      expect(refused.exitCode, "the CLI must not have run").toBeUndefined();
    }
  });
});

describe("IR-MCP-011 AC-1 — a false boolean adds no flag, so it is not an argument the action refuses", () => {
  it("answers status with dryRun:false as 5.3.8 did", async () => {
    const binding = ORCHESTRATE_TOOL_BINDINGS.find((entry) => entry.tool === "orchestrate_run_lock") as OrchestrateToolBinding;
    expect(orchestrateArgv(binding, { action: "status", dryRun: false })).toEqual(["orchestrate", "run", "status", "--json"]);
    const root = await repository("ir-mcp-011-ac1-false-");
    expect(await runLock(root, { action: "status", dryRun: false })).toMatchObject({ ok: true, holder: null, exitCode: 0 });
  });
});

describe("IR-MCP-011 AC-2 — lock with an owner and a bare unlock behave as before", () => {
  it("takes the lock under the owner and releases it unconditionally", async () => {
    const root = await repository("ir-mcp-011-ac2-");
    const taken = await runLock(root, { action: "lock", owner: OWNER });
    expect(taken).toMatchObject({ ok: true, exitCode: 0 });
    expect(await runLock(root, { action: "status" })).toMatchObject({ ok: true, holder: { owner: OWNER } });
    const released = await runLock(root, { action: "unlock" });
    expect(released).toMatchObject({ ok: true, exitCode: 0 });
    expect(await runLock(root, { action: "status" })).toMatchObject({ ok: true, holder: null });
  });
});

describe("IR-MCP-011 AC-3 — every leaf receives only the options it declares", () => {
  it("names any binding option a reachable leaf does not declare, and refuses every option it does not pass", () => {
    const tree = orchestrateTree();
    const accepted: string[] = [];
    const undeclared: string[] = [];
    const scopedRefusals: string[] = [];
    for (const binding of ORCHESTRATE_TOOL_BINDINGS) {
      for (const leaf of leavesOf(binding)) {
        const command = leafFor(tree, leaf.path);
        expect(command, `${binding.tool} reaches ${leaf.path.join(" ")}, which must exist`).not.toBeNull();
        const declared = new Set((command as Command).options.map((option) => option.long));
        const passed = passedTo(binding, leaf.value);
        for (const option of passed) {
          accepted.push(`${binding.tool}/${leaf.path.join(" ")} ${option.flag}`);
          if (!declared.has(option.flag)) undeclared.push(`${binding.tool}: orchestrate ${leaf.path.join(" ")} does not take ${option.flag}`);
        }
        for (const option of binding.options.filter((candidate) => !passed.includes(candidate))) {
          const input: Record<string, unknown> = { [option.dest]: sampleFor(option.encoding) };
          if (binding.selector && leaf.value !== null) input[binding.selector.dest] = leaf.value;
          expect(() => orchestrateArgv(binding, input), `${binding.tool} must refuse ${option.dest} for ${leaf.value}`).toThrow(option.dest);
          scopedRefusals.push(`${binding.tool}/${leaf.value} ${option.dest}`);
        }
      }
    }
    expect(accepted.length, "the census found no option to check").toBeGreaterThan(50);
    expect(undeclared, "a binding passes an option its leaf refuses").toEqual([]);
    expect(scopedRefusals.sort()).toEqual([
      "orchestrate_run_lock/status dryRun",
      "orchestrate_run_lock/status owner",
      "orchestrate_run_lock/unlock owner"
    ]);
  });

  it("treats an omitted action as lock, and still passes dryRun to unlock", () => {
    const binding = ORCHESTRATE_TOOL_BINDINGS.find((entry) => entry.tool === "orchestrate_run_lock") as OrchestrateToolBinding;
    expect(orchestrateArgv(binding, { owner: OWNER })).toEqual(["orchestrate", "run", "lock", "--owner", OWNER, "--json"]);
    expect(orchestrateArgv(binding, { action: "unlock", dryRun: true })).toEqual(["orchestrate", "run", "unlock", "--dry-run", "--json"]);
  });
});

describe("IR-MCP-011 AC-4 — a scoped field says which actions take it", () => {
  it("describes owner and dryRun of orchestrate_run_lock with their actions", () => {
    const json = z.toJSONSchema(z.object(toolSchemas.orchestrate_run_lock ?? {})) as { properties: Record<string, { description?: string }> };
    expect(json.properties.owner?.description).toMatch(/only when action is lock\b/);
    expect(json.properties.dryRun?.description).toMatch(/only when action is lock or unlock\b/);
  });
});

describe("IR-MCP-011 AC-5 — a CLI failure reaches the MCP caller as fields", () => {
  it("returns the CLI envelope's code and recovery although commander wrote to stderr", async () => {
    const root = await repository("ir-mcp-011-ac5-");
    const binding: OrchestrateToolBinding = {
      tool: "orchestrate_probe_only",
      description: "test-only binding that passes an option the leaf does not take",
      path: ["run", "status"],
      kind: "read",
      options: [{ flag: "--bogus", dest: "bogus", encoding: "string" }]
    };
    const answer = (await callOrchestrateTool(binding, { bogus: "x" }, { root })) as Answer;
    expect(answer.ok).toBe(false);
    expect(answer.exitCode).toBe(2);
    expect(answer.error).toMatchObject({ code: "CLI_USAGE_ERROR", message: expect.stringContaining("--bogus") });
    expect(answer.recovery).toMatchObject({ command: "orchestrate run status --help" });
  });
});

describe("IR-MCP-011 AC-6 — a usage error names the failing command's own help", () => {
  it("points an orchestrate leaf and a mutation command at their help, and keeps list on list", async () => {
    const root = await repository("ir-mcp-011-ac6-");
    const cases: Array<[string[], string]> = [
      [["orchestrate", "run", "status", "--owner", "x"], "orchestrate run status --help"],
      [["orchestrate", "run", "unlock", "--owner", "x"], "orchestrate run unlock --help"],
      [["update-status", "FR-ARCH-001", "verified", "--bogus"], "update-status --help"]
    ];
    for (const [args, command] of cases) {
      const out = capture();
      const err = capture();
      expect(await main(["--root", root, ...args, "--json"], { stdout: out.stream, stderr: err.stream })).toBe(2);
      const body = JSON.parse(out.text()) as Answer;
      expect(body.error, args.join(" ")).toMatchObject({ code: "CLI_USAGE_ERROR" });
      expect(body.recovery, args.join(" ")).toMatchObject({ command });
    }
    const out = capture();
    expect(await main(["--root", root, "list", "--bogus", "--json"], { stdout: out.stream, stderr: capture().stream })).toBe(2);
    expect((JSON.parse(out.text()) as Answer).recovery).toMatchObject({ command: "list" });
  });
});
