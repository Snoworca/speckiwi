import { readFile } from "node:fs/promises";
import path from "node:path";
import type { Command } from "commander";
import { describe, expect, it } from "vitest";
import { attachInheritedOptionsHelp, buildCommand } from "../../src/cli/command.js";
import { registerReadCommands } from "../../src/cli/commands/read.js";
import { registerMutationCommands } from "../../src/cli/commands/mutations.js";
import { registerMcpCommand } from "../../src/cli/commands/mcp.js";
import { registerSkillCommands } from "../../src/cli/commands/skills.js";
import { registerDoctorCommand } from "../../src/cli/commands/doctor.js";
import { registerRepairCommands } from "../../src/cli/commands/repair.js";
import { registerOrchestrateCommands } from "../../src/cli/commands/orchestrate.js";

// @req FR-NODE-128 — every `speckiwi` invocation cited in a bundled SKILL.md resolves against the
// real command tree.
//
// The tree is built with `buildCommand` and walked with `outputHelp()`. `program.parse()` is never
// called: commander has no parse-only mode, so parsing would execute action handlers, which in this
// repository would trip the hermeticity guards.

/** The three bundled variants. `.agents/skills` is a mirror of them, not a fourth variant. */
const BUNDLED_SKILL_VARIANTS = ["skills/claude", "skills/codex", "skills/etc"] as const;

/**
 * The thirteen documented placeholder forms. A citation carrying a bracketed or braced token outside
 * this set fails rather than being normalised — a silent normalisation is exactly what would let a
 * fabricated option name through. @req FR-NODE-128 AC-4
 */
const PLACEHOLDER_FORMS = [
  "<path>",
  "<path to routing/route-gate.json>",
  "<sha>",
  "<id>",
  "<payload>",
  "<manifest…>",
  "<v>",
  "<t>",
  "N",
  "S",
  "L",
  "{run_id}",
  "a|b|c"
] as const;

const PLACEHOLDER_SET: ReadonlySet<string> = new Set(PLACEHOLDER_FORMS);

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
  registerOrchestrateCommands(program, { io });
  attachInheritedOptionsHelp(program);
  return program;
}

/** Every long flag `outputHelp()` prints for a command, including the inherited global options. */
function longFlagsFromHelp(command: Command): Set<string> {
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
  const flags = new Set<string>();
  for (const match of captured.matchAll(/(--[a-z0-9][a-z0-9-]*)/gi)) flags.add(match[1] as string);
  return flags;
}

interface SkillInvocation {
  readonly file: string;
  readonly raw: string;
  readonly tokens: string[];
}

/** Splits an invocation body into tokens, keeping a multi-word `<a b c>` placeholder whole. */
function tokenizeInvocation(text: string): string[] {
  const tokens: string[] = [];
  let buffer = "";
  let depth = 0;
  for (const character of text) {
    if (character === "<") depth += 1;
    if (character === ">") depth = Math.max(0, depth - 1);
    if (/\s/.test(character) && depth === 0) {
      if (buffer.length > 0) tokens.push(buffer);
      buffer = "";
      continue;
    }
    buffer += character;
  }
  if (buffer.length > 0) tokens.push(buffer);
  return tokens;
}

const MARKER = "speckiwi ";

/**
 * One extracted invocation per `speckiwi ` occurrence — the same measure AC-1 compares the count
 * against, so the extractor and the floor cannot drift apart.
 */
function extractInvocations(file: string, body: string): SkillInvocation[] {
  const invocations: SkillInvocation[] = [];
  let index = body.indexOf(MARKER);
  while (index >= 0) {
    const raw = (body.slice(index + MARKER.length).split(/[\n`]/)[0] ?? "").trim();
    invocations.push({ file, raw, tokens: tokenizeInvocation(raw) });
    index = body.indexOf(MARKER, index + MARKER.length);
  }
  return invocations;
}

function countOccurrences(body: string, needle: string): number {
  let count = 0;
  let index = body.indexOf(needle);
  while (index >= 0) {
    count += 1;
    index = body.indexOf(needle, index + needle.length);
  }
  return count;
}

/** Whether a token is shaped like a placeholder, whether or not the table admits it. */
function looksLikePlaceholder(token: string): boolean {
  return token.startsWith("<") || token.endsWith(">") || (token.startsWith("{") && token.endsWith("}")) || /^[NSL]$/.test(token);
}

interface CitationFailure {
  readonly file: string;
  readonly raw: string;
  readonly reason: string;
}

/** Resolves one citation against the built tree; returns why it does not resolve, or null. */
function resolveCitation(program: Command, invocation: SkillInvocation): CitationFailure | null {
  const fail = (reason: string): CitationFailure => ({ file: invocation.file, raw: invocation.raw, reason });
  let current = program;
  let consumed = 0;
  for (const token of invocation.tokens) {
    if (token.startsWith("-")) break;
    // An alternation cites several sibling leaves at once; every alternative must exist.
    const alternatives = token.includes("|") ? token.split("|") : [token];
    const cursor = current;
    if (!alternatives.every((name) => cursor.commands.some((sub) => sub.name() === name))) break;
    current = cursor.commands.find((sub) => sub.name() === alternatives[0]) as Command;
    consumed += 1;
  }
  if (consumed === 0) return fail(`no verb of '${invocation.raw}' resolves against the command tree`);

  const flags = longFlagsFromHelp(current);
  const positionals = (current as unknown as { registeredArguments?: unknown[] }).registeredArguments ?? [];
  for (const token of invocation.tokens.slice(consumed)) {
    if (token.startsWith("--")) {
      const name = token.split("=")[0] as string;
      if (!flags.has(name)) return fail(`flag ${name} is not declared on the cited command`);
      continue;
    }
    if (token.startsWith("-")) continue;
    if (looksLikePlaceholder(token)) {
      if (!PLACEHOLDER_SET.has(token)) return fail(`placeholder ${token} is outside the declared table`);
      continue;
    }
    // A bare token left over after a container command is an unresolved verb — which is how a cited
    // phase-2 row is caught rather than read as an argument value.
    if (current.commands.length > 0) return fail(`'${token}' does not resolve against the command tree`);
    if (positionals.length === 0) return fail(`'${token}' is not an argument of the cited command`);
  }
  return null;
}

async function bundledSkillBodies(skill: string): Promise<Array<{ file: string; body: string }>> {
  const bodies: Array<{ file: string; body: string }> = [];
  for (const variant of BUNDLED_SKILL_VARIANTS) {
    const candidate = path.join(process.cwd(), variant, skill, "SKILL.md");
    try {
      bodies.push({ file: `${variant}/${skill}/SKILL.md`, body: await readFile(candidate, "utf8") });
    } catch {
      // A missing body is reported by the count assertion below rather than swallowed here.
    }
  }
  return bodies;
}

describe("FR-NODE-128 AC-1 / AC-2 — a measured invocation floor, per variant", () => {
  it("extracts, from each of the three variants, exactly its own count of `speckiwi ` occurrences", async () => {
    const bodies = await bundledSkillBodies("kiwi-orchestrator");
    expect(bodies.map((entry) => entry.file), "all three bundled variants must exist").toHaveLength(
      BUNDLED_SKILL_VARIANTS.length
    );

    for (const { file, body } of bodies) {
      expect(body.trim().length, `${file} must not be empty`).toBeGreaterThan(0);
      const extracted = extractInvocations(file, body);
      // Measured from the same body at test time; no numeric literal stands in for it.
      expect(extracted.length, `${file} extraction count`).toBe(countOccurrences(body, MARKER));
      expect(extracted.length, `${file} cites no speckiwi invocation`).toBeGreaterThan(0);
    }
  });

  it("fails a non-empty body from which zero invocations are extracted", () => {
    const body = "# kiwi-orchestrator\n\nThis body cites no command at all.\n";

    expect(body.trim().length).toBeGreaterThan(0);
    expect(extractInvocations("fixture", body)).toHaveLength(0);
    expect(countOccurrences(body, MARKER)).toBe(0);
  });
});

describe("FR-NODE-128 AC-3 — every cited verb and flag resolves against the walked tree", () => {
  it("rejects a fabricated verb and a fabricated flag, and accepts a real citation", () => {
    const program = buildProgram();

    // The negative fixture, observable before the real body is authored: a phase-2 verb.
    const fabricatedVerb = extractInvocations("fixture", "run `speckiwi orchestrate lane status --json`\n");
    expect(fabricatedVerb).toHaveLength(1);
    expect(resolveCitation(program, fabricatedVerb[0] as SkillInvocation)?.reason).toMatch(/does not resolve against the command tree/);

    const fabricatedFlag = extractInvocations("fixture", "run `speckiwi orchestrate validate --skip-validation`\n");
    expect(resolveCitation(program, fabricatedFlag[0] as SkillInvocation)?.reason).toMatch(/not declared on the cited command/);

    const real = extractInvocations("fixture", "run `speckiwi orchestrate validate --strict --json`\n");
    expect(resolveCitation(program, real[0] as SkillInvocation)).toBeNull();

    const alternation = extractInvocations("fixture", "run `speckiwi orchestrate run lock|unlock|status --json`\n");
    expect(resolveCitation(program, alternation[0] as SkillInvocation)).toBeNull();
  });

  it("resolves every citation of every bundled variant", async () => {
    const program = buildProgram();
    const failures: CitationFailure[] = [];
    for (const { file, body } of await bundledSkillBodies("kiwi-orchestrator")) {
      for (const invocation of extractInvocations(file, body)) {
        const failure = resolveCitation(program, invocation);
        if (failure) failures.push(failure);
      }
    }
    expect(failures).toEqual([]);
  });
});

describe("FR-NODE-128 AC-4 — the thirteen-form placeholder table", () => {
  it("declares thirteen forms and rejects a token outside the set rather than normalising it", () => {
    expect(PLACEHOLDER_FORMS).toHaveLength(13);

    const program = buildProgram();
    const outside = extractInvocations("fixture", "run `speckiwi orchestrate journal append <not-a-declared-form>`\n");
    expect(resolveCitation(program, outside[0] as SkillInvocation)?.reason).toMatch(/outside the declared table/);

    const declared = extractInvocations("fixture", "run `speckiwi orchestrate journal append <payload>`\n");
    expect(resolveCitation(program, declared[0] as SkillInvocation)).toBeNull();
  });
});

describe("FR-NODE-128 AC-5 — the harness builds and walks, it never parses", () => {
  it("resolves every citation with outputHelp() while parse and parseAsync are booby-trapped", () => {
    // Behavioural rather than textual: a source scan for `parse(` would match its own assertion, and
    // this repository has already shipped one guard that could never fire. Every command of the tree
    // gets a throwing parse; the resolution below then proves no action handler could have executed.
    const program = buildProgram();
    let helpCalls = 0;
    const trap = (): never => {
      throw new Error("the citation harness must never parse the command tree");
    };
    const arm = (command: Command): void => {
      Object.assign(command, { parse: trap, parseAsync: trap });
      const realOutputHelp = command.outputHelp.bind(command);
      Object.assign(command, {
        outputHelp: (...args: Parameters<Command["outputHelp"]>) => {
          helpCalls += 1;
          return realOutputHelp(...args);
        }
      });
      for (const sub of command.commands) arm(sub);
    };
    arm(program);

    const citation = extractInvocations("fixture", "run `speckiwi orchestrate validate --strict --json`");
    expect(resolveCitation(program, citation[0] as SkillInvocation)).toBeNull();
    expect(helpCalls, "the tree is walked with outputHelp()").toBeGreaterThan(0);

    // The trap itself is live, so the absence of a throw above is evidence rather than luck.
    expect(() => (program as unknown as { parse: () => void }).parse()).toThrow(/never parse/);
  });
});
