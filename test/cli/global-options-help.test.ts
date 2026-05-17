import type { Command } from "commander";
import { describe, expect, it } from "vitest";
import { attachInheritedOptionsHelp, buildCommand } from "../../src/cli/command.js";
import { registerReadCommands } from "../../src/cli/commands/read.js";
import { registerMutationCommands } from "../../src/cli/commands/mutations.js";
import { registerMcpCommand } from "../../src/cli/commands/mcp.js";

const SUBCOMMANDS_REQUIRING_HELP_VISIBILITY = [
  "validate",
  "extract",
  "list",
  "show",
  "targets",
  "active-target",
  "completed-work",
  "scopes",
  "summary",
  "mcp",
  "init",
  "update-status",
  "update-stability",
  "append-note",
  "set-active-target",
  "set-target-goal",
  "add-completed-work"
];

function fakeIo() {
  const noop = () => true;
  const stream = { write: noop } as unknown as NodeJS.WriteStream;
  return { stdout: stream, stderr: stream };
}

function buildProgram(): Command {
  const io = fakeIo();
  const program = buildCommand({ io });
  registerReadCommands(program, { io });
  registerMutationCommands(program, { io });
  registerMcpCommand(program, { io });
  attachInheritedOptionsHelp(program);
  return program;
}

function findSubcommand(program: Command, name: string): Command {
  const sub = program.commands.find((cmd) => cmd.name() === name);
  if (!sub) throw new Error(`subcommand not found: ${name}`);
  return sub;
}

function captureHelpOutput(sub: Command): string {
  let captured = "";
  const sink = (text: string): boolean => {
    captured += text;
    return true;
  };
  sub.configureOutput({ writeOut: sink, writeErr: sink });
  sub.outputHelp();
  return captured;
}

describe("IR-CLI-025 — 서브커맨드 --help 에 공통 옵션 가시성 노출", () => {
  it.each(SUBCOMMANDS_REQUIRING_HELP_VISIBILITY)("AC-1, AC-4: `speckiwi %s --help` 출력은 --root <path> 를 포함한다", (name) => {
    const program = buildProgram();
    const sub = findSubcommand(program, name);
    const help = captureHelpOutput(sub);
    expect(help).toMatch(/--root\s+<path>/);
  });

  it.each(SUBCOMMANDS_REQUIRING_HELP_VISIBILITY)("AC-4: `speckiwi %s --help` 출력은 --json 을 포함한다", (name) => {
    const program = buildProgram();
    const sub = findSubcommand(program, name);
    const help = captureHelpOutput(sub);
    expect(help).toMatch(/--json\b/);
  });

  it("AC-2: 공통 옵션 섹션은 구분 가능한 표제 아래에 표시된다", () => {
    const program = buildProgram();
    const sub = findSubcommand(program, "mcp");
    const help = captureHelpOutput(sub);
    expect(help).toMatch(/Global options:/);
  });

  it("AC-3: parser 동작은 변경되지 않고 부모 --root 가 그대로 인식된다", async () => {
    const program = buildProgram();
    program.exitOverride();
    await program.parseAsync(["--root", "/tmp/some-root", "active-target", "--help"], { from: "user" }).catch((err: { code?: string }) => {
      if (err.code !== "commander.helpDisplayed") throw err;
    });
    expect(program.opts().root).toBe("/tmp/some-root");
  });
});
