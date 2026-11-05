import { readFile } from "node:fs/promises";
import path from "node:path";
import { PassThrough, Readable } from "node:stream";
import type { Command } from "commander";
import { describe, expect, it } from "vitest";
import { buildProgram, main } from "../../src/cli/index.js";
import { tryRenderHelpJson } from "../../src/cli/input-json.js";
import { copyFixtureWorkspace } from "../fixtures/fixture-utils.js";

// @req IR-CLI-117 — the help of a command that takes --input-json says how a multi-line value
// arrives whole, and the help of no other command says so.

function io() {
  return { stdout: new PassThrough(), stderr: new PassThrough() };
}

function drain(stream: PassThrough): string {
  return stream.read()?.toString() ?? "";
}

/** The four facts AC-1 asks of the note, checked one by one so each can redden on its own. */
function carriesNote(help: string): boolean {
  const flat = help.replace(/\s+/g, " ");
  return (
    flat.includes("--input-json -") &&
    flat.includes("cmd.exe") &&
    /first newline/.test(flat) &&
    /flags written after it.*--dry-run/.test(flat)
  );
}

describe("IR-CLI-117 AC-1 — the three commands that take long values print the note", () => {
  // @req IR-CLI-117 AC-1
  it.each(["append-note", "edit-requirement", "add-requirement"])("%s --help names --input-json - and the cmd.exe cut", async (name) => {
    const streams = io();
    const code = await main([name, "--help"], streams);
    const help = drain(streams.stdout);

    expect(code).toBe(0);
    const flat = help.replace(/\s+/g, " ");
    expect(flat).toContain("--input-json -");
    expect(flat).toContain("cmd.exe");
    expect(flat).toMatch(/everything after the value's first newline/);
    expect(flat).toMatch(/flags written after it.*--dry-run/);
  });
});

/** Runs `args` with `stdin` as the process's standard input; resolves to the exit code and stdout. */
async function runWithStdin(args: string[], stdin: string): Promise<{ code: number; stdout: string }> {
  const original = process.stdin;
  const fake = Readable.from([stdin]) as unknown as NodeJS.ReadStream;
  (fake as unknown as { isTTY: boolean }).isTTY = false;
  Object.defineProperty(process, "stdin", { value: fake, configurable: true });
  try {
    const streams = io();
    const code = await main(args, streams);
    return { code, stdout: drain(streams.stdout) };
  } finally {
    Object.defineProperty(process, "stdin", { value: original, configurable: true });
  }
}

/** Runs `args` without stdin and parses what it printed as JSON. */
async function printedJson(args: string[]): Promise<unknown> {
  const streams = io();
  expect(await main(args, streams)).toBe(0);
  return JSON.parse(drain(streams.stdout)) as unknown;
}

/**
 * The places a reader of the note could take the payload keys from, each with the way that place
 * spells the key for `--dry-run`. The note must name at least one, and every one it names must give a
 * key that `--input-json -` honours.
 */
const KEY_SOURCES: ReadonlyArray<{ named: string; dryRunKey: (command: string) => Promise<string> }> = [
  {
    named: "--help --json",
    dryRunKey: async (command) => {
      const help = (await printedJson([command, "--help", "--json"])) as { parameters: Array<{ name: string }> };
      const param = help.parameters.find((entry) => /^dry-?run$/i.test(entry.name));
      expect(param, `${command} --help --json lists the dry-run parameter`).toBeDefined();
      return param!.name;
    }
  },
  {
    named: "commands --json",
    dryRunKey: async (command) => {
      const listed = (await printedJson(["commands", "--json"])) as { commands: Array<{ name: string; options: Array<{ flag: string; dest: string }> }> };
      const option = listed.commands.find((entry) => entry.name === command)?.options.find((entry) => entry.flag.split(" ")[0] === "--dry-run");
      expect(option, `commands --json lists ${command}'s --dry-run`).toBeDefined();
      return option!.dest;
    }
  }
];

describe("IR-CLI-117 AC-1 — the keys the note points to are the keys --input-json honours", () => {
  // @req IR-CLI-117 AC-1
  it("a dry run passed under the key from the note's source previews and leaves the file unchanged", async () => {
    const streams = io();
    expect(await main(["edit-requirement", "--help"], streams)).toBe(0);
    const note = drain(streams.stdout).replace(/\s+/g, " ");
    const named = KEY_SOURCES.filter((source) => note.includes(source.named));
    expect(named.map((source) => source.named), "the note names where the payload keys are listed").not.toEqual([]);

    for (const source of named) {
      const key = await source.dryRunKey("edit-requirement");
      const rootPath = await copyFixtureWorkspace("mutation-target");
      const file = path.join(rootPath, "docs", "spec", "10.product-architecture.srs.md");
      const before = await readFile(file, "utf8");
      const payload = JSON.stringify({ id: "FR-ARCH-001", statement: "The system SHALL do one thing.\n\nAnd a second line.", [key]: true });

      const { code, stdout } = await runWithStdin(["--root", rootPath, "edit-requirement", "--input-json", "-", "--json"], payload);

      expect(code, `${source.named} gave the key ${key}`).toBe(0);
      expect((JSON.parse(stdout) as { value?: { written?: boolean } }).value?.written, `${source.named} gave the key ${key}`).toBe(false);
      expect(await readFile(file, "utf8"), `${source.named} gave the key ${key}: the dry run wrote`).toBe(before);
    }
  });
});

/** Every command of the built program with its path from the root, grouped subcommands included. */
function everyCommand(program: Command): Array<{ path: string[]; command: Command }> {
  const found: Array<{ path: string[]; command: Command }> = [];
  function walk(parent: Command, prefix: string[]): void {
    for (const sub of parent.commands) {
      const path = [...prefix, sub.name()];
      found.push({ path, command: sub });
      walk(sub, path);
    }
  }
  walk(program, []);
  return found;
}

/** The gate's own answer: `<path> --help --json` renders the registry description only for an admitted command. */
function admitted(program: Command, path: readonly string[]): boolean {
  return tryRenderHelpJson([...path, "--help", "--json"], io(), program);
}

/** What `--help` prints for one command, through the output the program configured. */
function helpOf(command: Command, streams: ReturnType<typeof io>): string {
  drain(streams.stdout);
  command.outputHelp();
  return drain(streams.stdout);
}

describe("IR-CLI-117 AC-2 — the note follows the --input-json gate over the built program", () => {
  const streams = io();
  const program = buildProgram(streams);
  const commands = everyCommand(program).map((entry) => ({ ...entry, admitted: admitted(program, entry.path) }));

  // @req IR-CLI-117 AC-2
  it("finds both sides of the gate, grouped subcommands among the refused", () => {
    // An empty side would make the sweep below pass without measuring it.
    expect(commands.filter((entry) => entry.admitted).length).toBeGreaterThanOrEqual(25);
    expect(commands.filter((entry) => !entry.admitted).length).toBeGreaterThanOrEqual(25);
    const worklogEmit = commands.find((entry) => entry.path.join(" ") === "workflow worklog-emit");
    expect(worklogEmit?.admitted).toBe(false);
  });

  // @req IR-CLI-117 AC-2
  it("every admitted command prints the note and no refused command does", () => {
    const wrong = commands
      .filter((entry) => carriesNote(helpOf(entry.command, streams)) !== entry.admitted)
      .map((entry) => `${entry.path.join(" ")} (admitted: ${entry.admitted})`);
    expect(wrong).toEqual([]);
  });
});
