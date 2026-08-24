import { readFile, readdir } from "node:fs/promises";
import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { main } from "../../src/cli/index.js";
import { SAFETY_BYPASS_OPTION_HELP } from "../../src/cli/safety-bypass-options.js";

// @req IR-CLI-099 — an option that bypasses a safety gate carries its warning in its own help line,
// rendered from one registry entry so it cannot read differently on two commands offering the same
// gate.
//
// The gates and their flags are named here rather than read out of the registry: a test that asks
// the registry which gates exist agrees with it by construction and would stay green if an entry
// were dropped.
//
// `speckiwi step claim --force` spells the same flag as `init --force` but bypasses a write-skew
// soft gate, which is a different gate with different consequences. It is deliberately not part of
// this contract, so this suite keys on the gate and never on the flag spelling alone.

// AC-4 pins the text exactly. Substring checks were tried first and are not enough: a text with
// every claim negated — "nothing is replaced ... are safe and no backup is needed" — satisfied
// every one of them. Prose cannot be asserted by keyword, so any edit to a destructive warning
// must come here too, which is the review point this contract wants.
const EXPECTED_TEXT = {
  initOverwrite:
    "DESTRUCTIVE: rewrite every file init would otherwise leave alone, from templates — the requirements index, the appendix and the step state under docs/spec, the hook runners under docs/.kiwi, and the agent settings in .claude and .codex. Local edits to any of them are lost, no backup is kept, and the run reports them as updated.",
  mutationLock:
    "bypass the SRS mutation lock; another writer may be mid-write, and the two writes can interleave"
} as const;

const GATES = [
  { gate: "initOverwrite", flag: "--force" },
  { gate: "mutationLock", flag: "--ignore-lock" }
] as const;

const CLI_DIR = new URL("../../src/cli/", import.meta.url);

function io() {
  return { stdout: new PassThrough() as NodeJS.WriteStream, stderr: new PassThrough() as NodeJS.WriteStream };
}

function drain(stream: NodeJS.WriteStream): string {
  return (stream as unknown as PassThrough).read()?.toString() ?? "";
}

async function collectCliSources(dir: URL): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const child = new URL(`${entry.name}${entry.isDirectory() ? "/" : ""}`, dir);
    if (entry.isDirectory()) files.push(...(await collectCliSources(child)));
    else if (entry.name.endsWith(".ts") && entry.name !== "safety-bypass-options.ts") {
      files.push(await readFile(child, "utf8"));
    }
  }
  return files;
}

/** Every `.option("<flag>" ...)` call in the CLI sources, with whatever followed the flag. */
function optionDeclarations(source: string, flag: string): string[] {
  const pattern = new RegExp(`\\.option\\(\\s*"${flag}"([^)]*)\\)`, "g");
  return [...source.matchAll(pattern)].map((match) => match[1]!.trim());
}

async function helpFor(pathParts: string[]): Promise<string> {
  const streams = io();
  await main([...pathParts, "--help"], streams);
  return drain(streams.stdout);
}

/** Subcommand names listed under a help text's Commands: section. */
function subcommandsIn(help: string): string[] {
  const names: string[] = [];
  let inCommands = false;
  for (const line of help.split(/\r?\n/)) {
    if (/^Commands:/.test(line)) { inCommands = true; continue; }
    if (!inCommands) continue;
    if (/^\S/.test(line) && line.trim() !== "") break;
    const match = /^\s{2}(\S+)/.exec(line);
    if (match && match[1] !== "help") names.push(match[1]!);
  }
  return names;
}

/** Every command path in the CLI, to any depth. */
async function allCommandPaths(): Promise<string[][]> {
  const found: string[][] = [];
  const seed = subcommandsIn(await helpFor([])).map((name) => [name]);
  const queue = [...seed];
  while (queue.length > 0) {
    const current = queue.shift() as string[];
    found.push(current);
    const help = await helpFor(current);
    for (const child of subcommandsIn(help)) queue.push([...current, child]);
  }
  return found;
}

/** The description commander printed for one flag, joined across its wrapped lines. */
function descriptionForFlag(help: string, flag: string): string | null {
  const lines = help.split(/\r?\n/);
  const start = lines.findIndex((line) => new RegExp(`^\\s{2}${flag}(\\s|$)`).test(line));
  if (start === -1) return null;
  const indent = /^(\s*)/.exec(lines[start] as string)![1]!.length;
  const parts = [(lines[start] as string).slice(indent + flag.length)];
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index] as string;
    if (line.trim() === "" || /^\s{2}\S/.test(line)) break;
    parts.push(line);
  }
  return parts.join(" ").replace(/\s+/g, " ").trim();
}

const collapse = (text: string) => text.replace(/\s+/g, " ").trim();

describe("IR-CLI-099 — safety-bypass options carry their warning", () => {
  // AC-1: one registry entry per gate, and it is the text this contract fixed.
  it.each(GATES)("AC-1: the $gate gate has its registry entry", ({ gate }) => {
    expect(SAFETY_BYPASS_OPTION_HELP[gate]).toBe(EXPECTED_TEXT[gate]);
  });

  // AC-2: no declaration site offers the flag without the registry entry.
  it("AC-2: every --ignore-lock declaration passes the registry entry", async () => {
    const sources = await collectCliSources(CLI_DIR);
    const declarations = sources.flatMap((source) => optionDeclarations(source, "--ignore-lock"));
    expect(declarations.length, "--ignore-lock should be declared somewhere").toBeGreaterThan(0);
    for (const rest of declarations) {
      expect(rest, "--ignore-lock declared without the registry entry").toMatch(
        /^,\s*SAFETY_BYPASS_OPTION_HELP\.mutationLock$/
      );
    }
  });

  it("AC-2: no --force declaration carries a hand-written overwrite warning", async () => {
    const sources = await collectCliSources(CLI_DIR);
    const declarations = sources.flatMap((source) => optionDeclarations(source, "--force"));
    expect(declarations.length, "--force should be declared somewhere").toBeGreaterThan(0);
    for (const rest of declarations) {
      expect(rest, "--force declared with no description at all").not.toBe("");
    }
    expect(
      declarations.some((rest) => /^,\s*SAFETY_BYPASS_OPTION_HELP\.initOverwrite$/.test(rest)),
      "init's overwrite gate must come from the registry"
    ).toBe(true);
  });

  // AC-3: a different gate must not borrow this gate's text.
  it("AC-3: no other gate reuses the overwrite text", async () => {
    const paths = await allCommandPaths();
    const overwrite = collapse(EXPECTED_TEXT.initOverwrite);
    const carrying: string[] = [];
    for (const path of paths) {
      const description = descriptionForFlag(await helpFor(path), "--force");
      if (description !== null && collapse(description) === overwrite) carrying.push(path.join(" "));
    }
    expect(carrying, "only init bypasses the overwrite gate").toEqual(["init"]);
  });

  // AC-3 and AC-5: the same gate reads identically wherever it is offered, on the flag's own line,
  // at every depth of the command tree.
  it("AC-3/AC-5: --ignore-lock reads identically on every command that offers it", async () => {
    const expected = collapse(EXPECTED_TEXT.mutationLock);
    const paths = await allCommandPaths();
    const offering: string[] = [];
    for (const path of paths) {
      const description = descriptionForFlag(await helpFor(path), "--ignore-lock");
      if (description === null) continue;
      offering.push(path.join(" "));
      expect(collapse(description), `${path.join(" ")} --ignore-lock`).toBe(expected);
    }
    expect(offering.length, "--ignore-lock should be offered by many commands").toBeGreaterThan(20);
    expect(
      offering.some((name) => name.includes(" ")),
      "the walk must reach nested subcommands, not only top-level ones"
    ).toBe(true);
  });

  it("AC-5: init --help carries the overwrite warning on the --force line", async () => {
    const description = descriptionForFlag(await helpFor(["init"]), "--force");
    expect(description).not.toBeNull();
    expect(collapse(description as string)).toBe(collapse(EXPECTED_TEXT.initOverwrite));
  });

  // AC-4: the warning must not understate what the flag does. These names come from reading the
  // call sites that receive `force`; a site outside them means the text is narrower than the truth.
  it("AC-4: the overwrite warning names every place the flag rewrites", async () => {
    const source = await readFile(new URL("../../src/core/bootstrap/init-project.ts", import.meta.url), "utf8");
    const text = EXPECTED_TEXT.initOverwrite.toLowerCase();

    // Each destination that writeIfMissing reaches with force set, and the words that must cover it.
    const destinations: Array<[string, string]> = [
      ["docs", "docs/spec"],
      [".claude", ".claude"],
      [".codex", ".codex"],
      ["kiwiHooksDir", "docs/.kiwi"]
    ];
    for (const [marker, mustMention] of destinations) {
      expect(source, `${marker} should still be a force destination`).toContain(marker);
      expect(text, `the warning must mention ${mustMention}`).toContain(mustMention);
    }
    expect(text, "must say local edits are lost").toContain("lost");
    expect(text, "must say there is no backup").toContain("no backup");
  });

  it("AC-4: the lock-bypass warning keeps its concurrent-writer claim", () => {
    const text = EXPECTED_TEXT.mutationLock.toLowerCase();
    expect(text).toContain("lock");
    expect(text).toMatch(/another|concurrent|second/);
  });
});
