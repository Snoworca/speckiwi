import type { Command } from "commander";

// @req IR-CLI-100 — the identifiers worth searching for include CLI flags, and a query that starts
// with a dash is read by commander as an option. The double-dash escape already worked; what fails
// is the form an agent types first, and the usage error it gets back reads like a dead end rather
// than like "quote it differently".
//
// Normalising argv keeps this out of the option parser: the query token is lifted out and re-added
// after a separator, so options keep being parsed as options wherever the caller put them.
//
// Two earlier drafts each missed a way a token can be an option. The first asked the subcommand
// alone, so commander's own help option — added after the fact, absent from that list — was
// searched for as a string, and options declared on the parent were captured as the query, which
// broke `search --root <path> <query>`, a form with no dash-leading query at all. The second still
// looked for the command name at argv[0], so a global option written before it, as
// `speckiwi --root <path> search --force`, was never considered.
//
// Note for whoever touches this next: src/cli/index.ts and src/cli/input-json.ts each walk argv
// looking for the command name too, but they are not copies of this. commandNameFromArgv falls back
// to "list" when it finds none, and its hand-written skip list is mostly subcommand options rather
// than global ones; findMutationCommand gives up at the first bare token that is not a mutation
// command. This one derives its set from the command tree, so a new global option needs no edit
// here. Merging the three would change what those two decide, which is not this requirement's
// business.

/** Commands whose single operand is free text a user may reasonably start with a dash. */
const DASH_QUERY_COMMANDS = new Set(["search"]);

/** Tokens commander answers itself, which never appear in any `options` array. */
const IMPLICIT_TOKENS: ReadonlyArray<readonly [string, boolean]> = [
  ["-h", false],
  ["--help", false],
  ["-V", false],
  ["--version", false]
];

/** The flag part of a token, with any `=value` removed. */
function flagOf(token: string): string {
  return token.includes("=") ? token.slice(0, token.indexOf("=")) : token;
}

/**
 * Every option token in effect for the command, keyed to whether it takes a value.
 *
 * Walks up the parent chain, because a global option stays parseable after the subcommand name.
 */
function optionTokens(command: Command): Map<string, boolean> {
  const tokens = new Map<string, boolean>();
  for (const [token, takesValue] of IMPLICIT_TOKENS) tokens.set(token, takesValue);

  let current: Command | null = command;
  while (current) {
    for (const option of current.options) {
      const takesValue = option.required || option.optional;
      if (option.short) tokens.set(option.short, takesValue);
      if (option.long) tokens.set(option.long, takesValue);
    }
    current = current.parent;
  }
  return tokens;
}

/** Index of the command name in argv, skipping any global options written before it. */
function commandIndex(argv: readonly string[], root: Command): number {
  const globals = optionTokens(root);
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index] as string;
    if (token === "--") return -1;
    if (token.startsWith("-") && token !== "-") {
      if (globals.get(flagOf(token)) === true && !token.includes("=")) index += 1;
      continue;
    }
    return index;
  }
  return -1;
}

function findSubcommand(root: Command, name: string): Command | undefined {
  return root.commands.find((child) => child.name() === name || child.aliases().includes(name));
}

/**
 * Moves a dash-leading query out of option position for the commands that take one.
 *
 * Returns argv unchanged when there is nothing to do: a different command, an explicit `--`
 * already present, or no dash-leading token that is not an option.
 */
export function normalizeDashQueryArgv(argv: string[], root: Command): string[] {
  if (argv.includes("--")) return argv;

  const nameIndex = commandIndex(argv, root);
  if (nameIndex === -1) return argv;

  const name = argv[nameIndex] as string;
  if (!DASH_QUERY_COMMANDS.has(name)) return argv;

  const subcommand = findSubcommand(root, name);
  if (subcommand === undefined) return argv;

  const tokens = optionTokens(subcommand);
  const prefix = argv.slice(0, nameIndex + 1);
  const rest = argv.slice(nameIndex + 1);
  const kept: string[] = [];
  let query: string | undefined;

  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index] as string;

    if (token.startsWith("-") && token !== "-") {
      const flag = flagOf(token);
      if (tokens.has(flag)) {
        kept.push(token);
        // A value-taking flag consumes the next token, which must not be mistaken for the query.
        if (tokens.get(flag) === true && !token.includes("=") && index + 1 < rest.length) {
          index += 1;
          kept.push(rest[index] as string);
        }
        continue;
      }
      // An unknown dash token: the query, if we have not already taken one.
      if (query === undefined) { query = token; continue; }
      kept.push(token);
      continue;
    }

    // A plain operand is left alone: commander already handles it, and moving it would change
    // which error an already-invalid command reports for no gain.
    kept.push(token);
  }

  if (query === undefined) return argv;
  return [...prefix, ...kept, "--", query];
}
