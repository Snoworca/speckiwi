import type { Command } from "commander";
import { attachInheritedOptionsHelp, buildCommand } from "../../src/cli/command.js";
import { registerReadCommands } from "../../src/cli/commands/read.js";
import { registerMutationCommands } from "../../src/cli/commands/mutations.js";
import { registerMcpCommand } from "../../src/cli/commands/mcp.js";
import { registerSkillCommands } from "../../src/cli/commands/skills.js";
import { registerDoctorCommand } from "../../src/cli/commands/doctor.js";
import { registerRepairCommands } from "../../src/cli/commands/repair.js";
import { registerOrchestrateCommands } from "../../src/cli/commands/orchestrate.js";

// The citation harness FR-NODE-128 introduced, shared so one resolver does not become two.
//
// FR-NODE-128 resolves every `speckiwi` invocation a bundled `SKILL.md` cites against the real
// command tree. FR-FLOW-179 AC-2 asserts that a section moved out of a body keeps its citations
// inside that denominator, which means measuring the same thing over a reader that follows the
// pointer. Both need the same extractor and the same resolver, and a second copy of either would
// drift exactly where nobody is looking — a fabricated option name would resolve in one and not the
// other, and the floor would be measured against the lenient one.

/** The three bundled variants. `.agents/skills` is a mirror of them, not a fourth variant. */
export const BUNDLED_SKILL_VARIANTS = ["skills/claude", "skills/codex", "skills/etc"] as const;

/**
 * The thirteen documented placeholder forms. A citation carrying a bracketed or braced token outside
 * this set fails rather than being normalised — a silent normalisation is exactly what would let a
 * fabricated option name through. @req FR-NODE-128 AC-4
 */
export const PLACEHOLDER_FORMS = [
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

export function buildProgram(): Command {
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

export interface SkillInvocation {
  readonly file: string;
  readonly raw: string;
  readonly tokens: string[];
}

/** Splits an invocation body into tokens, keeping a multi-word `<a b c>` placeholder whole. */
export function tokenizeInvocation(text: string): string[] {
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

export const MARKER = "speckiwi ";

/**
 * One extracted invocation per `speckiwi ` occurrence — the same measure AC-1 compares the count
 * against, so the extractor and the floor cannot drift apart.
 */
export function extractInvocations(file: string, body: string): SkillInvocation[] {
  const invocations: SkillInvocation[] = [];
  let index = body.indexOf(MARKER);
  while (index >= 0) {
    const raw = (body.slice(index + MARKER.length).split(/[\n`]/)[0] ?? "").trim();
    invocations.push({ file, raw, tokens: tokenizeInvocation(raw) });
    index = body.indexOf(MARKER, index + MARKER.length);
  }
  return invocations;
}

export function countOccurrences(body: string, needle: string): number {
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
  return (
    token.startsWith("<") ||
    token.endsWith(">") ||
    (token.startsWith("{") && token.endsWith("}")) ||
    /^[NSL]$/.test(token)
  );
}

export interface CitationFailure {
  readonly file: string;
  readonly raw: string;
  readonly reason: string;
}

/** Resolves one citation against the built tree; returns why it does not resolve, or null. */
export function resolveCitation(program: Command, invocation: SkillInvocation): CitationFailure | null {
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
