import type { Command } from "commander";
import { describe, expect, it } from "vitest";
import { buildCommand } from "../../src/cli/command.js";
import {
  ORCHESTRATE_TOOL_BINDINGS,
  orchestrateArgv,
  registerOrchestrateCommands
} from "../../src/cli/commands/orchestrate.js";

// @req IR-MCP-004 — a tool that cannot be called is not a mirror of the verb it names.
//
// `IR-MCP-003` AC-6 asserts binding → schema. Nothing asserted CLI → binding, and that is the
// direction that makes a tool invocable: `orchestrateArgv` emits a flag only for an option the
// binding declares, so a required CLI option missing from the binding can never be passed, and
// commander refuses the call. Measured: `orchestrate round record` shipped a required `--proof`
// whose binding entry had none, so every `orchestrate_round_record` call exited 2 from day one.

/** The leaf a binding names, or null when the path resolves to nothing. */
function leafFor(root: Command, path: readonly string[]): Command | null {
  let current: Command = root.commands.find((entry) => entry.name() === "orchestrate") as Command;
  if (!current) return null;
  for (const segment of path) {
    const next: Command | undefined = current.commands.find((entry) => entry.name() === segment);
    if (!next) return null;
    current = next;
  }
  return current;
}

/** The `--flag` of every option the leaf declares mandatory. */
function requiredFlagsOf(leaf: Command): string[] {
  return (leaf.options as Array<{ required?: boolean; mandatory?: boolean; long?: string | null }>)
    .filter((option) => option.mandatory === true)
    .map((option) => option.long ?? "")
    .filter((flag) => flag.length > 0);
}

function orchestrateTree(): Command {
  const sink = { write: () => true } as unknown as NodeJS.WriteStream;
  const context = { io: { stdout: sink, stderr: sink } };
  const command = buildCommand(context);
  registerOrchestrateCommands(command, context);
  return command;
}

describe("IR-MCP-004 AC-1 — round record carries its proof through the binding", () => {
  it("declares --proof required on the binding and emits it in argv", () => {
    const binding = ORCHESTRATE_TOOL_BINDINGS.find((entry) => entry.tool === "orchestrate_round_record");
    expect(binding, "orchestrate_round_record must be a registered binding").toBeDefined();

    const proof = binding?.options.find((option) => option.flag === "--proof");
    expect(proof, "the binding must declare --proof, or no caller can supply it").toBeDefined();
    expect(proof?.required, "--proof is mandatory on the CLI leaf, so the binding must say so").toBe(true);

    const argv = orchestrateArgv(binding!, { runId: "run-a", payload: { scope: "run" }, proof: { kind: "git-ref" } });
    expect(argv, "argv emits a flag only for a declared option").toContain("--proof");
  });
});

describe("IR-MCP-004 AC-2 / AC-3 — every binding covers its leaf's required options", () => {
  it("names any tool whose binding omits a required flag", () => {
    const root = orchestrateTree();

    // AC-3, first direction: every binding must resolve to a leaf that exists, so a renamed verb
    // fails here rather than silently contributing no required flags to the census.
    const missingLeaves = ORCHESTRATE_TOOL_BINDINGS.filter((binding) => leafFor(root, binding.path) === null).map(
      (binding) => binding.tool
    );
    expect(missingLeaves, "every binding must name a CLI leaf that exists").toEqual([]);

    const declared: string[] = [];
    const gaps: string[] = [];
    for (const binding of ORCHESTRATE_TOOL_BINDINGS) {
      const leaf = leafFor(root, binding.path);
      if (!leaf) continue;
      const bound = new Set(binding.options.map((option) => option.flag));
      for (const flag of requiredFlagsOf(leaf)) {
        declared.push(`${binding.tool} ${flag}`);
        // Named, not counted: a bare count tells the next reader nothing about which tool is broken.
        if (!bound.has(flag)) gaps.push(`${binding.tool} omits ${flag}`);
      }
    }

    // AC-3, second direction: a traversal that found no required option anywhere would report zero
    // gaps and read as compliance. The floor makes an empty census a failure instead.
    expect(ORCHESTRATE_TOOL_BINDINGS.length, "the binding list resolved to nothing").toBeGreaterThan(10);
    expect(declared.length, "no leaf declared a required option; the census found nothing to check").toBeGreaterThan(5);

    expect(gaps, "a binding omitting a required flag leaves its tool uncallable").toEqual([]);
  });
});
